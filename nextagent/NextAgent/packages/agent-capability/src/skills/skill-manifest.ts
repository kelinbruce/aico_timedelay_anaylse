import {
  brand,
  type CapabilityId,
  type JsonObject,
  type JsonValue,
} from '@nextagent/agent-common';
import type {
  CapabilityDescriptor,
  CapabilityProviderIdentity,
  SkillManifestDiagnostic,
  SkillManifestDiagnosticReasonCode,
  SkillManifestValidationOutcome,
  SkillMetadata,
} from '@nextagent/agent-contracts/capability';
import { ModelInferenceOptionsSchema } from '@nextagent/agent-contracts/model';
import { Ajv } from 'ajv/dist/ajv.js';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import { decodeText } from '../builtins/workspace-files/text-encoding.js';

type SkillContext = 'inline' | 'fork';
type SourceMetadataValue = string | readonly string[];
type MetadataMap = Record<string, SourceMetadataValue>;
type SkillExtension = NonNullable<SkillMetadata['extension']>;

const validateModelInferenceOptions = new Ajv({
  allErrors: true,
  strict: false,
}).compile(ModelInferenceOptionsSchema);

interface SkillFrontmatter {
  readonly name: string;
  readonly description: string;
  readonly license?: string;
  readonly compatibility?: string;
  readonly allowedTools?: readonly string[];
  readonly context: SkillContext;
  readonly agent?: string;
  readonly userInvocable: boolean;
  readonly modelInvocable: boolean;
  readonly model?: string;
  readonly modelOptions?: JsonObject;
  readonly version?: string;
  readonly deniedTools?: readonly string[];
  readonly sourceMetadata?: { readonly [key: string]: SourceMetadataValue };
  readonly extension?: SkillExtension;
}

type RawFrontmatterValue = string | boolean | number | readonly JsonValue[] | MetadataMap | JsonObject;

export interface ParseSkillFrontmatterInput {
  readonly frontmatterSource: string;
  readonly safeCandidateName?: string;
  readonly providerId?: string;
}

export type SkillFrontmatterParseResult =
  | {
      readonly outcome: 'accepted' | 'degraded';
      readonly frontmatter: SkillFrontmatter;
      readonly diagnostics: readonly SkillManifestDiagnostic[];
    }
  | {
      readonly outcome: 'rejected';
      readonly diagnostics: readonly SkillManifestDiagnostic[];
    };

/**
 * Result of decoding raw `SKILL.md` bytes through the shared decode helper.
 * Either a decoded UTF-8 text string or a rejected parse result (encoding
 * failures only ever produce the rejected outcome). The rejected shape is
 * structurally compatible with both {@link SkillFrontmatterParseResult} and
 * {@link SkillDescriptorMappingResult} rejected branches, so callers can
 * return it directly from either file-based API.
 */
export type SkillDocumentDecodeResult =
  | { readonly text: string }
  | {
      readonly outcome: 'rejected';
      readonly diagnostics: readonly SkillManifestDiagnostic[];
    };

export type SkillDescriptorMappingResult =
  | {
      readonly outcome: 'accepted' | 'degraded';
      readonly descriptor: CapabilityDescriptor;
      readonly metadata: SkillMetadata;
      readonly diagnostics: readonly SkillManifestDiagnostic[];
    }
  | {
      readonly outcome: 'rejected';
      readonly diagnostics: readonly SkillManifestDiagnostic[];
    };

export type SkillMetadataAccessResult =
  | { readonly matched: true; readonly metadata: SkillMetadata }
  | {
      readonly matched: false;
      readonly reason: 'NON_SKILL_DESCRIPTOR' | 'INVALID_SKILL_METADATA';
    };

export interface SkillDocumentConsistency {
  readonly providerId: string;
  readonly capabilityId: CapabilityId;
  readonly frontmatterHash: string;
  readonly documentHash: string;
  readonly skillVersion: string;
}

export interface SkillMetadataView {
  readonly descriptor: CapabilityDescriptor;
  readonly metadata: SkillMetadata;
  readonly diagnostics: readonly SkillManifestDiagnostic[];
  readonly consistency: SkillDocumentConsistency;
}

export interface SkillCanonicalBodyView {
  readonly providerId: string;
  readonly capabilityId: CapabilityId;
  readonly skillVersion: string;
  readonly body: string;
  readonly documentSource?: string;
  readonly sourceIdentity?: string;
  readonly frontmatterHash?: string;
  /**
   * sha256 of the full document (frontmatter + body). Only set by sources
   * that load the Skill from a file/remote document they just read, so
   * callers can detect body-only tampering that `frontmatterHash` cannot
   * catch. Sources that cannot vouch for the full document leave this
   * undefined.
   */
  readonly documentHash?: string;
  /**
   * Absolute path of the Skill's directory on disk (i.e. the parent of
   * `SKILL.md`). Sources that load Skills from a non-filesystem store
   * (e.g. remote) leave this undefined; only filesystem-backed sources
   * can vouch for a root. Callers that need to resolve Skill-bundled
   * assets (helper scripts, etc.) must treat `undefined` as "no root to
   * trust" and refuse the lookup.
   */
  readonly rootDir?: string;
}

export interface SkillDocumentLoadView extends SkillCanonicalBodyView {
  readonly frontmatterHash: string;
  readonly documentHash: string;
}

export interface SkillDocumentServiceParseInput {
  readonly documentSource: string;
  readonly provider: CapabilityProviderIdentity;
  readonly safeCandidateName: string;
}

export interface SkillDocumentServiceLoadInput extends SkillDocumentServiceParseInput {}

export class SkillDocumentService {
  parseMetadataView(
    input: SkillDocumentServiceParseInput,
  ): SkillDescriptorMappingResult & {
    readonly consistency?: SkillDocumentConsistency;
  } {
    const parsed = parseSkillFrontmatter({
      frontmatterSource: input.documentSource,
      safeCandidateName: input.safeCandidateName,
      providerId: input.provider.providerId,
    });
    if (parsed.outcome === 'rejected') {
      return parsed;
    }
    const consistency = consistencyToken(
      input.provider.providerId,
      parsed.frontmatter.name,
      parsed.frontmatter.version,
      input.documentSource,
    );
    const mapped = mapSkillFrontmatterToDescriptor(
      parsed.frontmatter,
      input.provider,
      parsed.diagnostics,
    );
    return mapped.outcome === 'rejected' ? mapped : { ...mapped, consistency };
  }

  async parseMetadataViewFromFile(
    input: Omit<SkillDocumentServiceParseInput, 'documentSource'> & {
      readonly manifestFile: string;
    },
  ): Promise<
    SkillDescriptorMappingResult & {
      readonly consistency?: SkillDocumentConsistency;
    }
  > {
    const bytes = await readFile(input.manifestFile);
    const decoded = decodeSkillDocumentBytes(bytes, input.provider, input.safeCandidateName);
    if ('outcome' in decoded) {
      return decoded;
    }
    return this.parseMetadataView({ ...input, documentSource: decoded.text });
  }

  loadCanonicalBodyView(
    input: SkillDocumentServiceLoadInput,
  ): SkillDocumentLoadView | SkillFrontmatterParseResult {
    const parsed = parseSkillFrontmatter({
      frontmatterSource: input.documentSource,
      safeCandidateName: input.safeCandidateName,
      providerId: input.provider.providerId,
    });
    if (parsed.outcome === 'rejected') {
      return parsed;
    }
    const body = sliceCanonicalBody(input.documentSource);
    if (body === undefined) {
      return reject(
        'SKILL_MD_MISSING',
        'Skill manifest frontmatter is missing.',
        input.provider.providerId,
        parsed.frontmatter.name,
      );
    }
    return {
      ...consistencyToken(
        input.provider.providerId,
        parsed.frontmatter.name,
        parsed.frontmatter.version,
        input.documentSource,
      ),
      body,
      documentSource: input.documentSource,
    };
  }

  async loadCanonicalBodyViewFromFile(
    input: Omit<SkillDocumentServiceLoadInput, 'documentSource'> & {
      readonly manifestFile: string;
    },
  ): Promise<SkillDocumentLoadView | SkillFrontmatterParseResult> {
    const bytes = await readFile(input.manifestFile);
    const decoded = decodeSkillDocumentBytes(bytes, input.provider, input.safeCandidateName);
    if ('outcome' in decoded) {
      return decoded;
    }
    return this.loadCanonicalBodyView({ ...input, documentSource: decoded.text });
  }
}

export const defaultSkillDocumentService = new SkillDocumentService();

/**
 * Decodes raw `SKILL.md` bytes through the shared BOM-aware text decoder and
 * applies the Skill-path encoding acceptance policy: only UTF-8 (with or
 * without BOM) is accepted. UTF-8 BOM is stripped by `decodeText`. UTF-16,
 * GBK, and any encoding that cannot be decoded as UTF-8 (including binary
 * content with NUL bytes or a BOM followed by invalid bytes) are rejected
 * with `SKILL_MD_UNSUPPORTED_ENCODING`.
 *
 * Both the discovery path (`parseMetadataViewFromFile`) and the invocation
 * path (`loadCanonicalBodyViewFromFile`) MUST route file bytes through this
 * helper so discovery and invocation share the same format semantics.
 */
function decodeSkillDocumentBytes(
  bytes: Buffer,
  provider: { readonly providerId: string },
  safeCandidateName?: string,
): SkillDocumentDecodeResult {
  let decoded: { readonly text: string; readonly encoding: string };
  try {
    decoded = decodeText(bytes);
  } catch {
    // decodeText throws on binary content (NUL bytes) or when a detected BOM
    // is followed by bytes invalid for that encoding. Any decode failure means
    // the file is not supported text and MUST be rejected as an encoding error
    // rather than surfacing as a misleading "SKILL.md is missing" result.
    return decodeReject(
      'SKILL_MD_UNSUPPORTED_ENCODING',
      'Skill manifest must be UTF-8 text (BOM optional); unsupported encoding or binary content detected.',
      provider.providerId,
      safeCandidateName,
    );
  }
  if (decoded.encoding === 'UTF8' || decoded.encoding === 'UTF8_BOM') {
    return { text: decoded.text };
  }
  return decodeReject(
    'SKILL_MD_UNSUPPORTED_ENCODING',
    'Skill manifest must be UTF-8 text (BOM optional); unsupported encoding detected.',
    provider.providerId,
    safeCandidateName,
  );
}

/**
 * Builds a {@link SkillDocumentDecodeResult} rejected branch. Mirrors the
 * module-private {@link reject} helper but is typed to the narrow decode
 * result so it can be returned from {@link decodeSkillDocumentBytes} without
 * widening to the full {@link SkillFrontmatterParseResult} union.
 */
function decodeReject(
  reasonCode: SkillManifestDiagnosticReasonCode,
  message: string,
  providerId?: string,
  skillName?: string,
): SkillDocumentDecodeResult {
  return {
    outcome: 'rejected',
    diagnostics: [
      diagnostic(reasonCode, 'ERROR', 'rejected', message, providerId, skillName),
    ],
  };
}

/**
 * Returns the leading frontmatter block INCLUDING the `---` delimiters, i.e.
 * the source up to and including the second `---` line. This preserves the
 * return shape of `readSkillFrontmatterSourceFromFile` (delimiters included),
 * which downstream `parseSkillFrontmatter` re-parses via
 * `extractLeadingFrontmatter`. MUST NOT use `extractLeadingFrontmatter` here:
 * that helper strips the delimiters and would break the caller.
 *
 * If no closing `---` is found, the full (decoded, BOM-stripped) source is
 * returned, matching the prior streaming behavior on EOF before the second
 * delimiter.
 */
function sliceFrontmatterBlockWithDelimiters(source: string): string {
  const normalized = source.replace(/\r\n/g, '\n');
  const lines = normalized.split('\n');
  if (lines[0] !== '---') {
    return source;
  }
  const closing = lines.findIndex((line, index) => index > 0 && line === '---');
  if (closing < 0) {
    return source;
  }
  return lines.slice(0, closing + 1).join('\n');
}

const supportedMetadataKeys = new Set([
  'version',
  'modelOptions',
]);
const arraySourceMetadataKeys = new Set([
  'exclusiveWith',
  'compatibleWith',
  'tags',
]);
const reservedSourceMetadataKeys = new Set([
  'sourceIdentity',
  'frontmatterHash',
]);
const skillMetadataKeys = new Set([
  'metadataKind',
  'context',
  'userInvocable',
  'modelInvocable',
  'agent',
  'allowedTools',
  'deniedTools',
  'model',
  'modelOptions',
  'sourceMetadata',
  'extension',
]);
const namePattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const agentIdPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const toolNamePattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const modelIdPattern = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/;
const versionPattern = /^[A-Za-z0-9][A-Za-z0-9._+-]{0,63}$/;
const unsafeKeyPattern =
  /(?:api[_-]?key|authorization|base[_-]?url|credential|endpoint|headers?|password|secret|token|url)/i;
const unsafeValuePattern =
  /(?:https?:\/\/|sk-[A-Za-z0-9]|api[_-]?key|authorization|credential|password|secret|token)/i;
const maxFrontmatterBytes = 64 * 1024;
// Chinese-containing descriptions stay at the compact limit because CJK
// characters carry more information per character; pure-English descriptions
// get the extended limit.
const maxChineseDescriptionLength = 1024;
const maxEnglishDescriptionLength = 4096;

/**
 * Reads and decodes a `SKILL.md` file, returning the leading frontmatter block
 * (including the `---` delimiters) up to the second `---` line.
 *
 * Bytes are decoded through the shared `decodeSkillDocumentBytes` helper so
 * this reader shares the same BOM-stripping and encoding-acceptance semantics
 * as the discovery (`parseMetadataViewFromFile`) and invocation
 * (`loadCanonicalBodyViewFromFile`) paths. The full file is read to validate
 * encoding (a bounded leading slice cannot reveal a non-UTF-8 body), but only
 * the frontmatter block is returned — body content never enters discovery.
 *
 * The raw-reader signature has no provider/candidate-name context, so on an
 * unsupported encoding this function throws rather than returning a rejected
 * parse result. Callers that need a structured diagnostic use
 * `parseMetadataViewFromFile` instead.
 */
export async function readSkillFrontmatterSourceFromFile(
  filePath: string,
): Promise<string> {
  const bytes = await readFile(filePath);
  if (bytes.byteLength > maxFrontmatterBytes) {
    throw new Error('Skill manifest frontmatter exceeds the safe read limit.');
  }
  const decoded = decodeSkillDocumentBytes(
    bytes,
    { providerId: 'local-skills-system' },
    undefined,
  );
  if ('outcome' in decoded) {
    throw new Error('Skill manifest uses an unsupported text encoding.');
  }
  return sliceFrontmatterBlockWithDelimiters(decoded.text);
}

export function parseSkillFrontmatter(
  input: ParseSkillFrontmatterInput,
): SkillFrontmatterParseResult {
  const extracted = extractLeadingFrontmatter(input.frontmatterSource);
  if (extracted === undefined) {
    return reject(
      'SKILL_MD_MISSING',
      'Skill manifest frontmatter is missing.',
      input.providerId,
    );
  }
  const parsed = parseFlatFrontmatter(extracted);
  if (parsed.errors.length > 0) {
    return reject(
      'INVALID_OFFICIAL_FIELD',
      `Skill manifest frontmatter shape is invalid: ${parsed.errors.join(', ')}.`,
      input.providerId,
    );
  }

  const name = stringField(parsed.values, 'name');
  if (name === undefined) {
    return reject(
      'INVALID_NAME',
      'Skill manifest name is required but missing.',
      input.providerId,
    );
  }
  if (name.length > 64) {
    return reject(
      'INVALID_NAME',
      `Skill manifest name "${name}" exceeds 64 characters (length: ${name.length}).`,
      input.providerId,
    );
  }
  if (!namePattern.test(name)) {
    return reject(
      'INVALID_NAME',
      `Skill manifest name "${name}" does not match required pattern /^[a-z0-9]+(?:-[a-z0-9]+)*$/.`,
      input.providerId,
    );
  }
  if (
    input.safeCandidateName !== undefined &&
    input.safeCandidateName !== name
  ) {
    return reject(
      'NAME_MISMATCH',
      'Skill manifest name does not match the safe source candidate name.',
      input.providerId,
      name,
    );
  }
  const description = stringField(parsed.values, 'description');
  if (description === undefined) {
    return reject(
      'INVALID_DESCRIPTION',
      'Skill manifest description is required but missing.',
      input.providerId,
      name,
    );
  }
  const descriptionLimit = /\p{Script=Han}/u.test(description)
    ? maxChineseDescriptionLength
    : maxEnglishDescriptionLength;
  if (description.length > descriptionLimit) {
    return reject(
      'INVALID_DESCRIPTION',
      `Skill manifest description exceeds ${descriptionLimit} characters (length: ${description.length}).`,
      input.providerId,
      name,
    );
  }
  const license = optionalStringField(
    parsed.values,
    'license',
    input.providerId,
    name,
  );
  if (license.status === 'rejected') {
    return license.result;
  }
  const compatibility = optionalStringField(
    parsed.values,
    'compatibility',
    input.providerId,
    name,
    500,
  );
  if (compatibility.status === 'rejected') {
    return compatibility.result;
  }
  const allowedToolsValue = parsed.values['allowed-tools'];
  const legacyToolsValue = parsed.values.tools;
  if (!isEmptyValue(allowedToolsValue) && !isEmptyValue(legacyToolsValue)) {
    return reject(
      'INVALID_TOOL_CONSTRAINTS',
      'Skill manifest must not declare both allowed-tools and tools.',
      input.providerId,
      name,
    );
  }
  const allowedTools = parseOptionalToolConstraint(
    isEmptyValue(allowedToolsValue) ? legacyToolsValue : allowedToolsValue,
    input.providerId,
    name,
  );
  if (allowedTools.status === 'rejected') {
    return allowedTools.result;
  }
  const deniedTools = parseOptionalToolConstraint(
    parsed.values['disallowed-tools'],
    input.providerId,
    name,
  );
  if (deniedTools.status === 'rejected') {
    return deniedTools.result;
  }
  const context = parseContext(parsed.values.context, input.providerId, name);
  if (context.status === 'rejected') {
    return context.result;
  }
  const agent = optionalStringField(
    parsed.values,
    'agent',
    input.providerId,
    name,
    128,
  );
  if (agent.status === 'rejected') {
    return agent.result;
  }
  if (agent.value !== undefined && !agentIdPattern.test(agent.value)) {
    return reject(
      'INVALID_AGENT',
      `Skill manifest agent "${agent.value}" does not match required pattern /^[a-z0-9]+(?:-[a-z0-9]+)*$/.`,
      input.providerId,
      name,
    );
  }
  if (
    agent.value !== undefined &&
    context.value === 'inline' &&
    !isEmptyValue(parsed.values.context)
  ) {
    return reject(
      'AGENT_REQUIRES_FORK_CONTEXT',
      `Skill manifest agent "${agent.value}" requires context "fork", but got "inline". Either set context: fork or remove the agent field.`,
      input.providerId,
      name,
    );
  }
  const userInvocable = parseOptionalBoolean(
    parsed.values['user-invocable'],
    false,
    input.providerId,
    name,
  );
  if (userInvocable.status === 'rejected') {
    return userInvocable.result;
  }
  const modelInvocable = parseOptionalBoolean(
    parsed.values['model-invocable'],
    true,
    input.providerId,
    name,
  );
  if (modelInvocable.status === 'rejected') {
    return modelInvocable.result;
  }
  const metadata = parsed.values.metadata;
  if (metadata !== undefined && !isJsonObject(metadata)) {
    return reject(
      'INVALID_OFFICIAL_FIELD',
      'Skill manifest metadata must be an object.',
      input.providerId,
      name,
    );
  }
  const metadataMap = metadata ?? {};
  const versionValue = metadataMap.version;
  const version =
    typeof versionValue === 'string'
      ? stringMetadataValue(versionValue)
      : undefined;
  if (version !== undefined && version === '') {
    return reject(
      'INVALID_OFFICIAL_FIELD',
      'Skill manifest metadata.version must not be empty.',
      input.providerId,
      name,
    );
  }
  if (version !== undefined && !versionPattern.test(version)) {
    return reject(
      'INVALID_OFFICIAL_FIELD',
      `Skill manifest metadata.version "${version}" does not match required pattern /^[A-Za-z0-9][A-Za-z0-9._+-]{0,63}$/.`,
      input.providerId,
      name,
    );
  }
  const modelMetadata: MetadataMap = {};
  for (const [key, item] of Object.entries(metadataMap)) {
    if (
      typeof item === 'string' ||
      (Array.isArray(item) && item.every((i) => typeof i === 'string'))
    ) {
      modelMetadata[key] = item as SourceMetadataValue;
    }
  }
  const model = parseModelDeclarations(
    parsed.values.model,
    modelMetadata,
    input.providerId,
    name,
  );
  if (model.status === 'rejected') {
    return model.result;
  }
  if (metadataMap.extension !== undefined && !isJsonObject(metadataMap.extension)) {
    return reject(
      'INVALID_OFFICIAL_FIELD',
      'Skill manifest metadata.extension must be an object wrapper.',
      input.providerId,
      name,
    );
  }
  const metadataParseResult = parseMetadataWithExtension(metadataMap);
  const normalizedContext: SkillContext =
    agent.value !== undefined && isEmptyValue(parsed.values.context)
      ? 'fork'
      : context.value;
  const frontmatter: SkillFrontmatter = {
    name,
    description,
    context: normalizedContext,
    userInvocable: userInvocable.value,
    modelInvocable: modelInvocable.value,
    ...(license.value !== undefined ? { license: license.value } : {}),
    ...(compatibility.value !== undefined
      ? { compatibility: compatibility.value }
      : {}),
    ...(allowedTools.value !== undefined
      ? { allowedTools: allowedTools.value }
      : {}),
    ...(agent.value !== undefined ? { agent: agent.value } : {}),
    ...(model.value.model !== undefined ? { model: model.value.model } : {}),
    ...(model.value.modelOptions !== undefined
      ? { modelOptions: model.value.modelOptions }
      : {}),
    ...(version !== undefined ? { version } : {}),
    ...(deniedTools.value !== undefined
      ? { deniedTools: deniedTools.value }
      : {}),
    ...(metadataParseResult.sourceMetadata !== undefined
      ? { sourceMetadata: metadataParseResult.sourceMetadata }
      : {}),
    ...(metadataParseResult.extension !== undefined
      ? { extension: metadataParseResult.extension }
      : {}),
  };
  return {
    outcome: 'accepted',
    frontmatter,
    diagnostics: [],
  };
}

export function mapSkillFrontmatterToDescriptor(
  frontmatter: SkillFrontmatter,
  provider: CapabilityProviderIdentity,
  diagnostics: readonly SkillManifestDiagnostic[] = [],
): SkillDescriptorMappingResult {
  const metadata = createSkillMetadata(frontmatter);
  if (!isSkillMetadata(metadata)) {
    return {
      outcome: 'rejected',
      diagnostics: [
        diagnostic(
          'DESCRIPTOR_MAPPING_FAILED',
          'ERROR',
          'rejected',
          'Skill descriptor metadata could not be produced.',
          provider.providerId,
          frontmatter.name,
        ),
      ],
    };
  }
  const descriptor: CapabilityDescriptor = {
    capabilityId: brand<string, 'CapabilityId'>(frontmatter.name),
    kind: 'SKILL',
    provider,
    displayName: frontmatter.name,
    ...skillCapabilityLocales(metadata),
    description: frontmatter.description,
    modelInvocable: frontmatter.modelInvocable,
    availabilityStatus: 'AVAILABLE',
    metadata,
    ...(frontmatter.version !== undefined
      ? { version: frontmatter.version }
      : {}),
  };
  return {
    outcome: diagnostics.some((item) => item.outcome === 'degraded')
      ? 'degraded'
      : 'accepted',
    descriptor,
    metadata,
    diagnostics,
  };
}

function skillCapabilityLocales(metadata: SkillMetadata): Pick<CapabilityDescriptor, 'locales'> | Record<string, never> {
  const language: Record<string, { readonly displayName: string }> = {};
  const zhName = metadata.sourceMetadata?.['zh-name'];
  const enName = metadata.sourceMetadata?.['en-name'];
  if (isValidLocalizedDisplayName(zhName)) {
    language['zh-CN'] = { displayName: zhName };
  }
  if (isValidLocalizedDisplayName(enName)) {
    language['en-US'] = { displayName: enName };
  }
  return Object.keys(language).length === 0 ? {} : { locales: { language } };
}

function isValidLocalizedDisplayName(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.trim().length > 0 &&
    Array.from(value).length <= 256 &&
    !/[\u0000-\u001F\u007F-\u009F]/u.test(value)
  );
}

export function readSkillMetadata(
  descriptor: CapabilityDescriptor,
): SkillMetadataAccessResult {
  if (descriptor.kind !== 'SKILL') {
    return { matched: false, reason: 'NON_SKILL_DESCRIPTOR' };
  }
  if (
    descriptor.metadata !== undefined &&
    isSkillMetadata(descriptor.metadata)
  ) {
    return { matched: true, metadata: descriptor.metadata };
  }
  return { matched: false, reason: 'INVALID_SKILL_METADATA' };
}

function createSkillMetadata(frontmatter: SkillFrontmatter): SkillMetadata {
  return {
    metadataKind: 'nextagent.skill',
    context: frontmatter.context,
    userInvocable: frontmatter.userInvocable,
    modelInvocable: frontmatter.modelInvocable,
    ...(frontmatter.agent !== undefined ? { agent: frontmatter.agent } : {}),
    ...(frontmatter.allowedTools !== undefined
      ? { allowedTools: frontmatter.allowedTools }
      : {}),
    ...(frontmatter.deniedTools !== undefined
      ? { deniedTools: frontmatter.deniedTools }
      : {}),
    ...(frontmatter.model !== undefined ? { model: frontmatter.model } : {}),
    ...(frontmatter.modelOptions !== undefined
      ? { modelOptions: frontmatter.modelOptions }
      : {}),
    ...(frontmatter.sourceMetadata !== undefined
      ? { sourceMetadata: frontmatter.sourceMetadata }
      : {}),
    ...(frontmatter.extension !== undefined
      ? { extension: frontmatter.extension }
      : {}),
  } as SkillMetadata;
}

function extractLeadingFrontmatter(source: string): string | undefined {
  const normalized = source.replace(/\r\n/g, '\n');
  const lines = normalized.split('\n');
  if (lines[0] !== '---') {
    return undefined;
  }
  const closing = lines.findIndex((line, index) => index > 0 && line === '---');
  if (closing < 0) {
    return undefined;
  }
  return lines.slice(1, closing).join('\n');
}

function sliceCanonicalBody(source: string): string | undefined {
  const normalized = source.replace(/\r\n/g, '\n');
  const lines = normalized.split('\n');
  if (lines[0] !== '---') {
    return undefined;
  }
  const closing = lines.findIndex((line, index) => index > 0 && line === '---');
  if (closing < 0) {
    return undefined;
  }
  return lines
    .slice(closing + 1)
    .join('\n')
    .replace(/^\n/, '');
}

function consistencyToken(
  providerId: string,
  capabilityId: string,
  skillVersion: string | undefined,
  source: string,
): SkillDocumentConsistency {
  const frontmatter = extractLeadingFrontmatter(source) ?? '';
  return {
    providerId,
    capabilityId: brand<string, 'CapabilityId'>(capabilityId),
    frontmatterHash: createHash('sha256')
      .update(frontmatter, 'utf8')
      .digest('hex'),
    // Covers the full document (frontmatter + body). Used by loadCanonicalBodyView
    // to detect body-only tampering that frontmatterHash cannot catch.
    documentHash: createHash('sha256')
      .update(source, 'utf8')
      .digest('hex'),
    skillVersion: skillVersion ?? 'unversioned',
  };
}

function parseFlatFrontmatter(source: string): {
  readonly values: Record<string, RawFrontmatterValue>;
  readonly errors: readonly string[];
} {
  const values: Record<string, RawFrontmatterValue> = {};
  const errors: string[] = [];
  const lines = source.split('\n');
  let lastScalarKey: string | undefined;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? '';
    if (line.trim() === '' || line.trimStart().startsWith('#')) {
      continue;
    }
    if (line.startsWith(' ') || line.startsWith('\t')) {
      if (
        lastScalarKey === 'description' &&
        typeof values[lastScalarKey] === 'string' &&
        line.trim().length > 0
      ) {
        values[lastScalarKey] = `${values[lastScalarKey]} ${line.trim()}`;
      } else {
        errors.push('unexpected-indented-line');
      }
      continue;
    }
    const separator = line.indexOf(':');
    if (separator <= 0) {
      errors.push('missing-separator');
      lastScalarKey = undefined;
      continue;
    }
    const key = line.slice(0, separator).trim();
    const rawValue = line.slice(separator + 1).trim();
    if (rawValue === '|' || rawValue === '>') {
      const blockLines: string[] = [];
      while (index + 1 < lines.length) {
        const next = lines[index + 1] ?? '';
        if (next.trim() !== '' && !next.startsWith('  ')) {
          break;
        }
        index += 1;
        blockLines.push(next.startsWith('  ') ? next.slice(2) : '');
      }
      values[key] =
        rawValue === '|'
          ? blockLines.join('\n').trimEnd()
          : foldBlockScalar(blockLines);
      lastScalarKey = undefined;
    } else if (rawValue === '') {
      const nested = parseNestedObjectOrArray(lines, index, 1, errors);
      index = nested.finalIndex;
      if (nested.kind === 'array') {
        values[key] = nested.array ?? [];
      } else if (nested.kind === 'object') {
        values[key] = nested.object ?? {};
      } else {
        values[key] = '';
      }
      lastScalarKey = undefined;
    } else {
      values[key] = parseScalar(rawValue);
      lastScalarKey = key === 'description' && typeof values[key] === 'string' ? key : undefined;
    }
  }
  return { values, errors };
}

function parseNestedObject(
  lines: readonly string[],
  startIndex: number,
  indentLevel: number,
  errors: string[],
): { readonly object: JsonObject; readonly finalIndex: number } {
  const object: Record<string, JsonValue> = {};
  let index = startIndex;
  const indentSpaces = '  '.repeat(indentLevel);
  while (index + 1 < lines.length) {
    const next = lines[index + 1] ?? '';
    if (next.trim() === '') {
      index += 1;
      continue;
    }
    if (!next.startsWith(indentSpaces)) {
      break;
    }
    index += 1;
    const lineContent = next.slice(indentSpaces.length);
    const nestedSeparator = lineContent.indexOf(':');
    if (nestedSeparator <= 0) {
      errors.push('invalid-nested-line');
      continue;
    }
    const nestedKey = lineContent.slice(0, nestedSeparator).trim();
    const nestedRawValue = lineContent.slice(nestedSeparator + 1).trim();
    if (nestedRawValue === '') {
      const deeperNested = parseNestedObjectOrArray(
        lines,
        index,
        indentLevel + 1,
        errors,
      );
      index = deeperNested.finalIndex;
      if (deeperNested.kind === 'object') {
        object[nestedKey] = deeperNested.object ?? {};
      } else if (deeperNested.kind === 'array') {
        object[nestedKey] = deeperNested.array ?? [];
      } else {
        object[nestedKey] = '';
      }
    } else {
      const value = parseInlineStringList(nestedRawValue);
      object[nestedKey] =
        value !== undefined && value.length === 0
          ? ''
          : (value ?? parseScalar(nestedRawValue));
    }
  }
  return { object: object as JsonObject, finalIndex: index };
}

function parseNestedObjectOrArray(
  lines: readonly string[],
  startIndex: number,
  indentLevel: number,
  errors: string[],
): {
  readonly kind: 'object' | 'array' | 'empty';
  readonly object?: JsonObject;
  readonly array?: JsonValue[];
  readonly finalIndex: number;
} {
  let index = startIndex;
  const indentSpaces = '  '.repeat(indentLevel);
  const firstContentLine = lines[index + 1] ?? '';
  if (firstContentLine.trim() === '') {
    index += 1;
    return { kind: 'empty', finalIndex: index };
  }
  const firstIndent = firstContentLine.match(/^\s*/u)?.[0] ?? '';
  const arrayIndentSpaces = firstContentLine.startsWith(indentSpaces)
    ? indentSpaces
    : firstIndent;
  if (
    !firstContentLine.startsWith(indentSpaces) &&
    !firstContentLine.slice(arrayIndentSpaces.length).trim().startsWith('- ')
  ) {
    return { kind: 'empty', finalIndex: index };
  }
  const firstLineContent = firstContentLine.slice(arrayIndentSpaces.length).trim();
  if (firstLineContent.startsWith('- ')) {
    const array: JsonValue[] = [];
    index += 1;
    array.push(parseScalar(firstLineContent.slice(2).trim()));
    while (index + 1 < lines.length) {
      const next = lines[index + 1] ?? '';
      if (next.trim() === '') {
        index += 1;
        continue;
      }
      if (!next.startsWith(arrayIndentSpaces)) {
        break;
      }
      const lineContent = next.slice(arrayIndentSpaces.length).trim();
      if (!lineContent.startsWith('- ')) {
        break;
      }
      index += 1;
      array.push(parseScalar(lineContent.slice(2).trim()));
    }
    return { kind: 'array', array, finalIndex: index };
  }
  const nestedResult = parseNestedObject(lines, index, indentLevel, errors);
  return {
    kind: 'object',
    object: nestedResult.object,
    finalIndex: nestedResult.finalIndex,
  };
}

function foldBlockScalar(lines: readonly string[]): string {
  const paragraphs: string[] = [];
  let current: string[] = [];
  for (const line of lines) {
    if (line.trim() === '') {
      if (current.length > 0) {
        paragraphs.push(current.join(' '));
        current = [];
      }
      continue;
    }
    current.push(line.trim());
  }
  if (current.length > 0) {
    paragraphs.push(current.join(' '));
  }
  return paragraphs.join('\n').trimEnd();
}

function parseScalar(rawValue: string): string | boolean | number | readonly string[] {
  const inlineList = parseInlineStringList(rawValue);
  if (inlineList !== undefined) {
    return inlineList;
  }
  if (rawValue === 'true') {
    return true;
  }
  if (rawValue === 'false') {
    return false;
  }
  const numericValue = Number(rawValue);
  if (!Number.isNaN(numericValue) && rawValue.trim() !== '') {
    return numericValue;
  }
  return parseStringScalar(rawValue);
}

function parseStringScalar(rawValue: string): string {
  if (
    (rawValue.startsWith('"') && rawValue.endsWith('"')) ||
    (rawValue.startsWith("'") && rawValue.endsWith("'"))
  ) {
    return rawValue.slice(1, -1);
  }
  return rawValue;
}

function parseInlineStringList(
  rawValue: string,
): readonly string[] | undefined {
  if (!rawValue.startsWith('[') || !rawValue.endsWith(']')) {
    return undefined;
  }
  const inner = rawValue.slice(1, -1).trim();
  if (inner === '') {
    return [];
  }
  return inner.split(',').map((item) => parseStringScalar(item.trim()));
}

function isEmptyValue(value: unknown): boolean {
  if (value === undefined) {
    return true;
  }
  if (typeof value === 'string' && value.length === 0) {
    return true;
  }
  if (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.keys(value).length === 0
  ) {
    return true;
  }
  return false;
}

function stringField(
  values: Record<string, RawFrontmatterValue>,
  key: string,
): string | undefined {
  const value = values[key];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function optionalStringField(
  values: Record<string, RawFrontmatterValue>,
  key: string,
  providerId: string | undefined,
  skillName: string | undefined,
  maxLength = 1024,
):
  | { readonly status: 'accepted'; readonly value?: string }
  | {
      readonly status: 'rejected';
      readonly result: SkillFrontmatterParseResult;
    } {
  const value = values[key];
  if (isEmptyValue(value)) {
    return { status: 'accepted' };
  }
  if (typeof value !== 'string') {
    return {
      status: 'rejected',
      result: reject(
        'INVALID_OFFICIAL_FIELD',
        `Skill manifest field "${key}" must be a string.`,
        providerId,
        skillName,
      ),
    };
  }
  if (value.length > maxLength) {
    return {
      status: 'rejected',
      result: reject(
        'INVALID_OFFICIAL_FIELD',
        `Skill manifest field "${key}" exceeds ${maxLength} characters (length: ${value.length}).`,
        providerId,
        skillName,
      ),
    };
  }
  return { status: 'accepted', value };
}

function parseContext(
  value?: RawFrontmatterValue,
  providerId?: string,
  skillName?: string,
):
  | { readonly status: 'accepted'; readonly value: SkillContext }
  | {
      readonly status: 'rejected';
      readonly result: SkillFrontmatterParseResult;
    } {
  if (isEmptyValue(value)) {
    return { status: 'accepted', value: 'inline' };
  }
  if (value === 'inline' || value === 'fork') {
    return { status: 'accepted', value };
  }
  return {
    status: 'rejected',
    result: reject(
      'INVALID_CONTEXT',
      `Skill manifest context must be "inline" or "fork", got: ${JSON.stringify(value)}.`,
      providerId,
      skillName,
    ),
  };
}

function parseOptionalBoolean(
  value: RawFrontmatterValue | undefined,
  defaultValue: boolean,
  providerId?: string,
  skillName?: string,
):
  | { readonly status: 'accepted'; readonly value: boolean }
  | {
      readonly status: 'rejected';
      readonly result: SkillFrontmatterParseResult;
    } {
  if (isEmptyValue(value)) {
    return { status: 'accepted', value: defaultValue };
  }
  if (typeof value === 'boolean') {
    return { status: 'accepted', value };
  }
  return {
    status: 'rejected',
    result: reject(
      'INVALID_INVOCABILITY',
      `Skill manifest invocability field must be true or false, got: ${JSON.stringify(value)}.`,
      providerId,
      skillName,
    ),
  };
}

function parseOptionalToolConstraint(
  value?: RawFrontmatterValue | SourceMetadataValue,
  providerId?: string,
  skillName?: string,
):
  | { readonly status: 'accepted'; readonly value?: readonly string[] }
  | {
      readonly status: 'rejected';
      readonly result: SkillFrontmatterParseResult;
    } {
  if (isEmptyValue(value)) {
    return { status: 'accepted' };
  }
  const tools = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? value.split(/\s+/).filter((item) => item.length > 0)
      : undefined;
  if (tools === undefined || tools.some((tool) => typeof tool !== 'string' || tool.length === 0)) {
    return {
      status: 'rejected',
      result: reject(
        'INVALID_TOOL_CONSTRAINTS',
        `Skill manifest tool constraints must be a whitespace-separated string or a string list, got: ${JSON.stringify(value)}.`,
        providerId,
        skillName,
      ),
    };
  }
  const invalidTool = tools.find((tool) => !toolNamePattern.test(tool));
  if (invalidTool !== undefined) {
    return {
      status: 'rejected',
      result: reject(
        'INVALID_TOOL_CONSTRAINTS',
        `Skill manifest tool constraint "${invalidTool}" does not match required pattern /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.`,
        providerId,
        skillName,
      ),
    };
  }
  return { status: 'accepted', value: [...new Set(tools)] };
}

function parseModelDeclarations(
  topLevelModel: RawFrontmatterValue | undefined,
  metadata: MetadataMap,
  providerId?: string,
  skillName?: string,
):
  | {
      readonly status: 'accepted';
      readonly value: {
        readonly model?: string;
        readonly modelOptions?: JsonObject;
      };
    }
  | {
      readonly status: 'rejected';
      readonly result: SkillFrontmatterParseResult;
    } {
  let model: string | undefined;
  if (!isEmptyValue(topLevelModel)) {
    if (typeof topLevelModel !== 'string') {
      return {
        status: 'rejected',
        result: reject(
          'UNSAFE_MODEL_DECLARATION',
          `Skill manifest top-level model declaration must be a model name string: ${JSON.stringify(topLevelModel)}.`,
          providerId,
          skillName,
        ),
      };
    }
    model = topLevelModel;
  }
  if (model !== undefined && !isSafeModelName(model)) {
    return {
      status: 'rejected',
      result: reject(
        'UNSAFE_MODEL_DECLARATION',
        `Skill manifest model name "${model}" is unsafe (must match /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/ and not contain credentials).`,
        providerId,
        skillName,
      ),
    };
  }
  let modelOptions: JsonObject | undefined;
  const metadataModelOptions = stringMetadataValue(metadata.modelOptions);
  if (metadataModelOptions !== undefined) {
    const options = parseJsonObject(metadataModelOptions);
    if (options === undefined) {
      return {
        status: 'rejected',
        result: reject(
          'UNSAFE_MODEL_DECLARATION',
          `Skill manifest metadata.modelOptions is not valid JSON: ${JSON.stringify(metadataModelOptions)}.`,
          providerId,
          skillName,
        ),
      };
    }
    if (options.model !== undefined) {
      return {
        status: 'rejected',
        result: reject(
          'UNSAFE_MODEL_DECLARATION',
          'Skill manifest metadata.modelOptions must not carry a "model" identifier; declare the model via top-level "model".',
          providerId,
          skillName,
        ),
      };
    }
    if (!isSafeJsonObject(options) || !validateModelInferenceOptions(options)) {
      return {
        status: 'rejected',
        result: reject(
          'UNSAFE_MODEL_DECLARATION',
          `Skill manifest modelOptions contain unsafe keys or values: ${JSON.stringify(options)}.`,
          providerId,
          skillName,
        ),
      };
    }
    modelOptions = options;
  }
  return {
    status: 'accepted',
    value: {
      ...(model !== undefined ? { model } : {}),
      ...(modelOptions !== undefined ? { modelOptions } : {}),
    },
  };
}

function parseMetadataWithExtension(metadata: JsonObject): {
  readonly sourceMetadata?: { readonly [key: string]: SourceMetadataValue };
  readonly extension?: SkillExtension;
} {
  const sourceMetadataValue: Record<string, SourceMetadataValue> = {};
  const extensionValue: Record<string, SkillExtension[string]> = {};
  for (const [key, item] of Object.entries(metadata)) {
    if (supportedMetadataKeys.has(key)) {
      continue;
    }
    if (isEmptySourceMetadataValue(item)) {
      continue;
    }
    // Reserved handles, unsafe values, and unsupported value shapes are
    // silently omitted: unknown metadata carries no governed meaning, so an
    // omitted value cannot change behavior and a diagnostic would only leak
    // authoring noise into discovery evidence.
    if (reservedSourceMetadataKeys.has(key)) {
      continue;
    }
    if (key === 'extension') {
      if (!isJsonObject(item)) {
        continue;
      }
      for (const [extKey, extItem] of Object.entries(item)) {
        if (
          isSafeExtensionKey(extKey) &&
          isSafeExtensionValue(extItem) &&
          checkExtensionSize(extItem)
        ) {
          extensionValue[extKey] = extItem;
        }
      }
      continue;
    }
    if (
      (typeof item === 'string' && isSafeSourceMetadataEntry(key, item)) ||
      (Array.isArray(item) &&
        arraySourceMetadataKeys.has(key) &&
        isSafeStringArray(item))
    ) {
      sourceMetadataValue[key] = item as SourceMetadataValue;
    }
  }
  const sourceMetadata =
    Object.keys(sourceMetadataValue).length > 0
      ? sourceMetadataValue
      : undefined;
  const extension =
    Object.keys(extensionValue).length > 0 ? extensionValue : undefined;
  return {
    ...(sourceMetadata !== undefined ? { sourceMetadata } : {}),
    ...(extension !== undefined ? { extension } : {}),
  };
}

function isSkillMetadata(value: JsonObject): value is SkillMetadata {
  return (
    Object.keys(value).every((key) => skillMetadataKeys.has(key)) &&
    value.metadataKind === 'nextagent.skill' &&
    (value.context === 'inline' || value.context === 'fork') &&
    typeof value.userInvocable === 'boolean' &&
    typeof value.modelInvocable === 'boolean' &&
    (value.agent === undefined ||
      (typeof value.agent === 'string' && agentIdPattern.test(value.agent))) &&
    (value.model === undefined ||
      (typeof value.model === 'string' && isSafeModelName(value.model))) &&
    optionalToolArray(value.allowedTools) &&
    optionalToolArray(value.deniedTools) &&
    (value.modelOptions === undefined ||
      (isJsonObject(value.modelOptions) &&
        isSafeJsonObject(value.modelOptions) &&
        validateModelInferenceOptions(value.modelOptions))) &&
    (value.sourceMetadata === undefined ||
      isSafeSourceMetadata(value.sourceMetadata)) &&
    (value.extension === undefined || isSafeExtension(value.extension))
  );
}

function isSafeExtension(value: JsonValue): boolean {
  if (!isJsonObject(value)) {
    return false;
  }
  return Object.entries(value).every(
    ([key, item]) =>
      isSafeExtensionKey(key) &&
      isSafeExtensionValue(item) &&
      checkExtensionSize(item),
  );
}

function optionalToolArray(value?: JsonValue): boolean {
  return (
    value === undefined ||
    (Array.isArray(value) &&
      value.every(
        (item) => typeof item === 'string' && toolNamePattern.test(item),
      ))
  );
}

function stringMetadataValue(
  value?: SourceMetadataValue,
): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function isStringMap(value: unknown): value is Record<string, string> {
  return (
    isJsonObject(value) &&
    Object.values(value).every((item) => typeof item === 'string')
  );
}

function isMetadataMap(value: unknown): value is MetadataMap {
  return (
    isJsonObject(value) &&
    Object.entries(value).every(
      ([key, item]) =>
        typeof item === 'string' ||
        (arraySourceMetadataKeys.has(key) && isStringArrayShape(item)),
    )
  );
}

function isSafeSourceMetadata(value: JsonValue): boolean {
  return (
    isJsonObject(value) &&
    Object.entries(value).every(([key, item]) =>
      isSafeSourceMetadataEntry(key, item),
    )
  );
}

function isSafeSourceMetadataEntry(key: string, item: JsonValue): boolean {
  if (key.length > 128 || unsafeKeyPattern.test(key)) {
    return false;
  }
  if (typeof item === 'string') {
    return item.length <= 512 && !unsafeValuePattern.test(item);
  }
  return arraySourceMetadataKeys.has(key) && isSafeStringArray(item);
}

function isSafeStringArray(value: unknown): value is readonly string[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every(
      (item) =>
        typeof item === 'string' &&
        item.length > 0 &&
        item.length <= 512 &&
        !unsafeValuePattern.test(item),
    )
  );
}

function isStringArrayShape(value: unknown): value is readonly string[] {
  return (
    Array.isArray(value) &&
    value.every((item) => typeof item === 'string' && item.length > 0)
  );
}

function isEmptySourceMetadataValue(value?: JsonValue): boolean {
  return (
    value === '' ||
    value === undefined ||
    value === null ||
    (Array.isArray(value) && value.length === 0)
  );
}

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseJsonObject(value: string): JsonObject | undefined {
  try {
    const parsed = JSON.parse(value) as unknown;
    return isJsonObject(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function isSafeModelName(value: string): boolean {
  return modelIdPattern.test(value) && !unsafeValuePattern.test(value);
}

const maxExtensionDepth = 3;
const maxExtensionSizeBytes = 32 * 1024;
const maxExtensionKeyLength = 128;
const maxExtensionStringValueLength = 512;
const reservedExtensionKeys = new Set([
  'sourceIdentity',
  'frontmatterHash',
  'metadataKind',
]);

const extensionKeyWhitelist = new Set([
  'api_header_params',
]);

function isSafeExtensionValue(
  value: JsonValue,
  depth = 0,
): value is SkillExtension[string] {
  if (depth > maxExtensionDepth) {
    return false;
  }
  if (typeof value === 'string') {
    return (
      value.length <= maxExtensionStringValueLength &&
      !unsafeValuePattern.test(value)
    );
  }
  if (typeof value === 'number' || typeof value === 'boolean' || value === null) {
    return true;
  }
  if (Array.isArray(value)) {
    // Allow arrays of safe strings for whitelisted extension keys
    // (e.g. api_request_params, api_header_params)
    return value.every(
      (item) =>
        typeof item === 'string' &&
        item.length <= maxExtensionStringValueLength &&
        !unsafeValuePattern.test(item),
    );
  }
  if (isJsonObject(value)) {
    return Object.entries(value).every(
      ([key, item]) =>
        isSafeExtensionKey(key) && isSafeExtensionValue(item, depth + 1),
    );
  }
  return false;
}

function isSafeExtensionKey(key: string): boolean {
  return (
    key.length >= 1 &&
    key.length <= maxExtensionKeyLength &&
    (!unsafeKeyPattern.test(key) || extensionKeyWhitelist.has(key)) &&
    !reservedExtensionKeys.has(key)
  );
}

function checkExtensionSize(value: JsonValue): boolean {
  try {
    const serialized = JSON.stringify(value);
    return serialized.length <= maxExtensionSizeBytes;
  } catch {
    return false;
  }
}

function isSafeJsonObject(value: JsonObject): boolean {
  return Object.entries(value).every(
    ([key, item]) => !unsafeKeyPattern.test(key) && isSafeJsonValue(item),
  );
}

function isSafeJsonValue(value: JsonValue): boolean {
  if (typeof value === 'string') {
    return !unsafeValuePattern.test(value);
  }
  if (
    typeof value === 'number' ||
    typeof value === 'boolean' ||
    value === null
  ) {
    return true;
  }
  if (Array.isArray(value)) {
    return value.every(isSafeJsonValue);
  }
  return isJsonObject(value) && isSafeJsonObject(value);
}

function reject(
  reasonCode: SkillManifestDiagnosticReasonCode,
  message: string,
  providerId?: string,
  skillName?: string,
): SkillFrontmatterParseResult {
  return {
    outcome: 'rejected',
    diagnostics: [
      diagnostic(
        reasonCode,
        'ERROR',
        'rejected',
        message,
        providerId,
        skillName,
      ),
    ],
  };
}

function diagnostic(
  reasonCode: SkillManifestDiagnosticReasonCode,
  severity: 'INFO' | 'WARNING' | 'ERROR',
  outcome: SkillManifestValidationOutcome,
  message: string,
  providerId?: string,
  skillName?: string,
): SkillManifestDiagnostic {
  return {
    reasonCode,
    severity,
    outcome,
    message,
    ...(providerId !== undefined ? { providerId } : {}),
    ...(skillName !== undefined ? { skillName } : {}),
  };
}
