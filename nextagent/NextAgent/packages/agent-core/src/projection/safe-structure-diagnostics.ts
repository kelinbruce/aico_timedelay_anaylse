import type { JsonObject } from '@nextagent/agent-common';
import type { CapabilityDescriptor, CapabilityInvocationResult } from '@nextagent/agent-contracts/capability';

const MAX_NAME_ITEMS = 100;
const MAX_NAME_ARRAY_BYTES = 4_096;
const SAFE_NAME = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/u;
const CREDENTIAL_SEGMENTS = new Set(['password', 'secret', 'credential', 'authorization', 'cookie']);
const TOKEN_PREFIX_SEGMENTS = new Set(['api', 'access', 'auth', 'refresh', 'bearer', 'id']);
const CONTEXT_PATCH_FIELDS = ['allowedTools', 'deniedTools', 'discoveredSkills', 'modelId', 'modelOptions'] as const;

export interface BoundedSafeNames {
  readonly names: readonly string[];
  readonly truncated: 'true' | 'false';
}

export function boundedSafeNames(names: readonly string[]): BoundedSafeNames {
  const safe: string[] = [];
  let isTruncated = false;
  for (const name of names) {
    if (!SAFE_NAME.test(name)) {
      isTruncated = true;
      continue;
    }
    if (safe.length >= MAX_NAME_ITEMS || Buffer.byteLength(JSON.stringify([...safe, name])) > MAX_NAME_ARRAY_BYTES) {
      isTruncated = true;
      break;
    }
    safe.push(name);
  }
  return { names: safe, truncated: isTruncated ? 'true' : 'false' };
}

export function capabilityStructureDiagnostics(
  descriptor: CapabilityDescriptor,
  argumentsValue: JsonObject,
  result?: CapabilityInvocationResult,
): JsonObject {
  const argumentProjection = projectSchemaFields(argumentsValue, descriptor.inputSchema);
  const resultProjection =
    result === undefined ? { status: 'NOT_PRODUCED' as const } : projectSchemaFields(result.structuredPayload, descriptor.outputSchema);
  const generatedMessageKinds =
    result === undefined
      ? []
      : (['USER', 'USER_META'] as const).filter((kind) =>
          result.generatedMessages.some((message) => (message.meta === true ? 'USER_META' : 'USER') === kind),
        );
  const contextPatchFields =
    result?.contextPatch === undefined
      ? []
      : CONTEXT_PATCH_FIELDS.filter((field) => Object.prototype.hasOwnProperty.call(result.contextPatch, field));
  return {
    argumentProjectionStatus: argumentProjection.status,
    ...projectionFields('validatedArgumentNames', argumentProjection),
    resultProjectionStatus: resultProjection.status,
    ...projectionFields('validatedResultFieldNames', resultProjection),
    ...(generatedMessageKinds.length === 0 ? {} : { generatedMessageKinds }),
    ...(contextPatchFields.length === 0 ? {} : { contextPatchFields }),
  };
}

interface SchemaFieldProjection {
  readonly status: 'EMPTY' | 'SCHEMA_PROPERTIES_UNAVAILABLE' | 'NO_SCHEMA_MATCH' | 'PROJECTED' | 'PARTIALLY_PROJECTED' | 'FILTERED' | 'NOT_PRODUCED';
  readonly names?: readonly string[];
  readonly truncated?: 'true' | 'false';
}

function projectSchemaFields(value: JsonObject, schema?: JsonObject): SchemaFieldProjection {
  const actualNames = Object.keys(value);
  if (actualNames.length === 0) {
    return { status: 'EMPTY' };
  }
  const properties = schemaProperties(schema);
  if (properties === undefined) {
    return { status: 'SCHEMA_PROPERTIES_UNAVAILABLE' };
  }
  const matchedNames = actualNames.filter((name) => Object.prototype.hasOwnProperty.call(properties, name));
  if (matchedNames.length === 0) {
    return { status: 'NO_SCHEMA_MATCH' };
  }
  const safeNames = boundedSafeNames(matchedNames.filter((name) => !isCredentialSemanticName(name)));
  const omittedForSafety = safeNames.names.length < matchedNames.length;
  if (safeNames.names.length === 0) {
    return { status: 'FILTERED' };
  }
  const isPartial = omittedForSafety || safeNames.truncated === 'true';
  return {
    status: isPartial ? 'PARTIALLY_PROJECTED' : 'PROJECTED',
    names: safeNames.names,
    truncated: isPartial ? 'true' : 'false',
  };
}

function schemaProperties(schema?: JsonObject): Readonly<Record<string, unknown>> | undefined {
  const properties = schema?.['properties'];
  return properties !== null && typeof properties === 'object' && !Array.isArray(properties)
    ? (properties as Readonly<Record<string, unknown>>)
    : undefined;
}

function isCredentialSemanticName(name: string): boolean {
  const segments = name
    .replace(/([a-z0-9])([A-Z])/gu, '$1 $2')
    .split(/[\s._:-]+/u)
    .filter((segment) => segment.length > 0)
    .map((segment) => segment.toLowerCase());
  return (
    segments.some((segment) => CREDENTIAL_SEGMENTS.has(segment)) ||
    (segments.length === 1 && segments[0] === 'token') ||
    segments.some((segment, index) => segment === 'token' && index > 0 && TOKEN_PREFIX_SEGMENTS.has(segments[index - 1]!)) ||
    segments.some((segment, index) => segment === 'api' && segments[index + 1] === 'key')
  );
}

function projectionFields(key: 'validatedArgumentNames' | 'validatedResultFieldNames', projection: SchemaFieldProjection): JsonObject {
  if (projection.names === undefined || projection.truncated === undefined) {
    return {};
  }
  const markerKey = key === 'validatedArgumentNames' ? 'validatedArgumentNamesTruncated' : 'validatedResultFieldNamesTruncated';
  return { [key]: projection.names, [markerKey]: projection.truncated };
}
