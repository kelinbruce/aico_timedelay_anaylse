import type { JsonObject } from '@nextagent/agent-common';
import { Ajv } from 'ajv/dist/ajv.js';

export type ModelInvocationSafePayloadKind = 'started' | 'completed' | 'failed';

const stringField = { type: 'string', minLength: 1, maxLength: 256 } as const;
const optionalStringField = { type: 'string', minLength: 1, maxLength: 256 } as const;
const boundedStringArray = {
  type: 'array',
  maxItems: 100,
  items: stringField,
} as const;
const safeNameArray = {
  type: 'array',
  maxItems: 100,
  items: { type: 'string', pattern: '^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$' },
} as const;
const truncationMarker = { enum: ['true', 'false'] } as const;

const safeJsonObject = {
  type: 'object',
  additionalProperties: {
    anyOf: [
      { type: 'string', maxLength: 256 },
      { type: 'number' },
      { type: 'boolean' },
      { type: 'null' },
      { type: 'array', maxItems: 100 },
      { type: 'object', additionalProperties: true },
    ],
  },
} as const;

const modelOptionSummarySchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    temperature: { type: 'number' },
    maxOutputTokens: { type: 'number' },
    topP: { type: 'number' },
    thinkingDepth: optionalStringField,
    timeoutMs: { type: 'number', minimum: 0 },
    toolCount: { type: 'number', minimum: 0 },
  },
  required: ['toolCount'],
} as const;

const modelUsageSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    inputTokens: { type: 'number', minimum: 0 },
    outputTokens: { type: 'number', minimum: 0 },
    totalTokens: { type: 'number', minimum: 0 },
  },
} as const;
const timingField = { type: 'integer', minimum: 0 } as const;

const modelStartedPayloadSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    stepId: stringField,
    modelId: stringField,
    messageCountBucket: { enum: ['0', '1', '2-10', '11-100', '101+'] },
    timeoutMsBucket: { enum: ['unspecified', '1-1000', '1001-5000', '5001-30000', '30001-120000', '120001+'] },
    maxOutputTokensBucket: { enum: ['unspecified', '1-1024', '1025-4096', '4097-16384', '16385+'] },
    disclosedCapabilityNames: safeNameArray,
    disclosedCapabilityNamesTruncated: truncationMarker,
    modelOptionSummary: modelOptionSummarySchema,
    providerOptionKeys: boundedStringArray,
    promptTemplateRef: optionalStringField,
    promptTemplateVersion: optionalStringField,
    selectedMessageRefs: boundedStringArray,
    disclosedCapabilityIds: boundedStringArray,
    modelMessageCount: { type: 'number', minimum: 0, maximum: 10_000 },
    projectionUnavailable: optionalStringField,
  },
  required: [
    'stepId',
    'modelId',
    'messageCountBucket',
    'timeoutMsBucket',
    'maxOutputTokensBucket',
    'disclosedCapabilityNames',
    'disclosedCapabilityNamesTruncated',
    'modelOptionSummary',
    'providerOptionKeys',
    'selectedMessageRefs',
    'disclosedCapabilityIds',
    'modelMessageCount',
  ],
} as const;

const modelCompletedPayloadSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    stepId: stringField,
    modelId: stringField,
    resolvedToolNames: safeNameArray,
    resolvedToolNamesTruncated: truncationMarker,
    finishReason: optionalStringField,
    usage: modelUsageSchema,
    durationMs: timingField,
    firstContentLatencyMs: timingField,
    toolCallCount: { type: 'number', minimum: 0 },
    projectionUnavailable: optionalStringField,
  },
  required: ['stepId', 'modelId', 'resolvedToolNames', 'resolvedToolNamesTruncated', 'toolCallCount'],
} as const;

const modelFailedPayloadSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    stepId: stringField,
    modelId: stringField,
    safeErrorCode: stringField,
    safeErrorCategory: stringField,
    usage: modelUsageSchema,
    durationMs: timingField,
    firstContentLatencyMs: timingField,
    projectionUnavailable: optionalStringField,
  },
  required: ['stepId', 'modelId', 'safeErrorCode', 'safeErrorCategory'],
} as const;

const policyProjectionPayloadSchema = {
  type: 'object',
  additionalProperties: true,
  properties: {
    policyId: stringField,
    policyVersion: stringField,
    policyDomain: stringField,
    policyPoint: stringField,
  },
  required: ['policyId', 'policyVersion', 'policyDomain', 'policyPoint'],
} as const;

const ajv = new Ajv({ allErrors: true });
const validateModelStartedPayload = ajv.compile<JsonObject>(modelStartedPayloadSchema);
const validateModelCompletedPayload = ajv.compile<JsonObject>(modelCompletedPayloadSchema);
const validateModelFailedPayload = ajv.compile<JsonObject>(modelFailedPayloadSchema);
const validatePolicyProjectionPayload = ajv.compile<JsonObject>(policyProjectionPayloadSchema);

export function isModelInvocationSafePayload(kind: ModelInvocationSafePayloadKind, value: unknown): value is JsonObject {
  if (!hasValidNameArrayBudgets(kind, value)) {
    return false;
  }
  if (!hasValidTimingOrder(value)) {
    return false;
  }
  switch (kind) {
    case 'started':
      return validateModelStartedPayload(value);
    case 'completed':
      return validateModelCompletedPayload(value);
    case 'failed':
      return validateModelFailedPayload(value);
    default: {
      const exhaustive: never = kind;
      throw new Error(`Unhandled case: ${String(exhaustive)}`);
    }
  }
}

function hasValidTimingOrder(value: unknown): boolean {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const payload = value as Record<string, unknown>;
  return (
    payload['firstContentLatencyMs'] === undefined ||
    payload['durationMs'] === undefined ||
    (typeof payload['firstContentLatencyMs'] === 'number' &&
      typeof payload['durationMs'] === 'number' &&
      payload['firstContentLatencyMs'] <= payload['durationMs'])
  );
}

function hasValidNameArrayBudgets(kind: ModelInvocationSafePayloadKind, value: unknown): boolean {
  if (kind === 'failed') {
    return true;
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const key = kind === 'started' ? 'disclosedCapabilityNames' : 'resolvedToolNames';
  const names = (value as Record<string, unknown>)[key];
  return Array.isArray(names) && Buffer.byteLength(JSON.stringify(names), 'utf8') <= 4_096;
}

export function isPolicyProjectionPayload(value: unknown): value is JsonObject {
  return validatePolicyProjectionPayload(value);
}

const ARGUMENT_PROJECTION_STATUSES = new Set([
  'EMPTY',
  'SCHEMA_PROPERTIES_UNAVAILABLE',
  'NO_SCHEMA_MATCH',
  'PROJECTED',
  'PARTIALLY_PROJECTED',
  'FILTERED',
]);
const RESULT_PROJECTION_STATUSES = new Set([...ARGUMENT_PROJECTION_STATUSES, 'NOT_PRODUCED']);
const GENERATED_MESSAGE_KINDS = new Set(['USER', 'USER_META']);
const CONTEXT_PATCH_FIELDS = new Set(['allowedTools', 'deniedTools', 'discoveredSkills', 'modelId', 'modelOptions']);

export function isCapabilityStructureSafePayload(value: unknown): value is JsonObject {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const payload = value as Record<string, unknown>;
  if (
    !ARGUMENT_PROJECTION_STATUSES.has(String(payload['argumentProjectionStatus'])) ||
    !RESULT_PROJECTION_STATUSES.has(String(payload['resultProjectionStatus']))
  ) {
    return false;
  }
  const argumentNames = validateOptionalSafeNames(payload, 'validatedArgumentNames', 'validatedArgumentNamesTruncated');
  const resultNames = validateOptionalSafeNames(payload, 'validatedResultFieldNames', 'validatedResultFieldNamesTruncated');
  if (argumentNames === undefined || resultNames === undefined) {
    return false;
  }
  if (Buffer.byteLength(JSON.stringify(argumentNames), 'utf8') + Buffer.byteLength(JSON.stringify(resultNames), 'utf8') > 8_192) {
    return false;
  }
  return (
    validateFixedArray(payload['generatedMessageKinds'], GENERATED_MESSAGE_KINDS) &&
    validateFixedArray(payload['contextPatchFields'], CONTEXT_PATCH_FIELDS)
  );
}

function validateOptionalSafeNames(payload: Record<string, unknown>, key: string, markerKey: string): readonly string[] | undefined {
  const names = payload[key];
  const marker = payload[markerKey];
  if (names === undefined) {
    return marker === undefined ? [] : undefined;
  }
  if (
    !Array.isArray(names) ||
    names.length === 0 ||
    names.length > 100 ||
    Buffer.byteLength(JSON.stringify(names), 'utf8') > 4_096 ||
    names.some((name) => typeof name !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/u.test(name)) ||
    (marker !== 'true' && marker !== 'false')
  ) {
    return undefined;
  }
  return names as readonly string[];
}

function validateFixedArray(value: unknown, allowed: ReadonlySet<string>): boolean {
  return (
    value === undefined ||
    (Array.isArray(value) && value.length > 0 && value.length <= allowed.size && value.every((item) => typeof item === 'string' && allowed.has(item)))
  );
}
