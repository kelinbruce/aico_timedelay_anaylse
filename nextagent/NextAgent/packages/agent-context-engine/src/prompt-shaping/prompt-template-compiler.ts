import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, dirname, extname, isAbsolute, join, relative, resolve } from 'node:path';
import { AgentError, type JsonObject, type JsonValue } from '@nextagent/agent-common';
import type { ModelInferenceOptions, ThinkingOptions, ToolChoice } from '@nextagent/agent-contracts/model';
import {
  assertPromptPurpose,
  isWellKnownPromptPurpose,
  type PromptSection,
  type PromptSectionVariable,
  type PromptSourceLayer,
  type PromptTemplate,
  type PromptTemplateMatch,
} from './prompt-template-types.js';
import { compilePolicyForPurpose, defaultSystemPromptSectionOrder as policySystemPromptSectionOrder } from './prompt-template-purpose-policy.js';
import { createDefaultPromptTemplateVariableResolver } from './variable-resolver.js';

const schemaVersion = 'nextagent.prompt-template/v1';
const safeIdPattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;
const variablePattern = /\{\{\s*([A-Za-z_][A-Za-z0-9_]*)(\?)?\s*\}\}/gu;
const anyMustachePattern = /\{\{([^}]*)\}\}/gu;

export function defaultSystemPromptSectionOrder(): readonly string[] {
  return policySystemPromptSectionOrder();
}

export interface CompilePromptRootInput {
  readonly sourceLayer: PromptSourceLayer;
  readonly rootPath: string;
  readonly agentId?: string;
  readonly agentVersion?: string;
}

export function compilePromptRoot(input: CompilePromptRootInput): readonly PromptTemplate[] {
  if (!isAbsolute(input.rootPath)) {
    throw promptTemplateError('PROMPT_ROOT_NOT_ABSOLUTE', 'Prompt root must be absolute.');
  }
  if (input.sourceLayer === 'agent') {
    if (input.agentId === undefined || input.agentVersion === undefined) {
      throw promptTemplateError('PROMPT_AGENT_SCOPE_REQUIRED', 'Agent prompt root must include agent scope.');
    }
    assertSafeId(input.agentId, 'PROMPT_AGENT_ID_INVALID', 'Prompt agent id is invalid.');
    assertSafeId(input.agentVersion, 'PROMPT_AGENT_VERSION_INVALID', 'Prompt agent version is invalid.');
  }
  const rootPath = resolve(input.rootPath);
  if (!existsSync(rootPath)) {
    if (input.sourceLayer === 'builtin') {
      throw promptTemplateError('PROMPT_BUILTIN_ROOT_MISSING', 'Built-in prompt root is unavailable.');
    }
    return [];
  }
  if (!statSync(rootPath).isDirectory()) {
    throw promptTemplateError('PROMPT_ROOT_INVALID', 'Prompt root is invalid.');
  }
  const manifests = discoverManifestFiles(rootPath);
  const templates = manifests.map((manifest) => compileManifest({ ...input, rootPath, manifest }));
  assertUniqueTemplateIds(templates);
  return templates;
}

interface ManifestFile {
  readonly templateId: string;
  readonly path: string;
  readonly baseDir: string;
}

function discoverManifestFiles(rootPath: string): readonly ManifestFile[] {
  const manifests: ManifestFile[] = [];
  for (const entry of readdirSync(rootPath, { withFileTypes: true })) {
    if (entry.isFile() && entry.name.endsWith('.yaml')) {
      const templateId = entry.name.slice(0, -'.yaml'.length);
      manifests.push({ templateId, path: join(rootPath, entry.name), baseDir: rootPath });
      continue;
    }
    if (entry.isDirectory()) {
      const manifestPath = join(rootPath, entry.name, 'template.yaml');
      if (existsSync(manifestPath) && statSync(manifestPath).isFile()) {
        manifests.push({ templateId: entry.name, path: manifestPath, baseDir: join(rootPath, entry.name) });
      }
    }
  }
  return manifests.sort((left, right) => left.templateId.localeCompare(right.templateId));
}

function compileManifest(input: CompilePromptRootInput & { readonly manifest: ManifestFile }): PromptTemplate {
  assertSafeId(input.manifest.templateId, 'PROMPT_TEMPLATE_ID_INVALID', 'Prompt template id is invalid.');
  const parsed = parsePromptManifest(readFileSync(input.manifest.path, 'utf8'), input.manifest.templateId);
  const purpose = parsed.purpose ?? inferPurposeFromTemplateId(input.manifest.templateId);
  assertPromptPurpose(purpose);
  const sections = materializeSections({
    templateId: input.manifest.templateId,
    purpose,
    baseDir: input.manifest.baseDir,
    content: parsed.content,
  });
  const identity = {
    schemaVersion: parsed.schemaVersion,
    templateId: input.manifest.templateId,
    purpose,
    match: parsed.match,
    sections,
    modelOptions: parsed.modelOptions,
  };
  const contentHash = createHash('sha256').update(JSON.stringify(identity)).digest('hex').slice(0, 16);
  const templateRef =
    input.sourceLayer === 'agent'
      ? `agent:${input.agentId ?? 'unknown'}:${input.agentVersion ?? 'unknown'}:${input.manifest.templateId}:${contentHash}`
      : `builtin:${input.manifest.templateId}:${contentHash}`;
  return {
    templateId: input.manifest.templateId,
    templateRef,
    purpose,
    sourceLayer: input.sourceLayer,
    ...(input.sourceLayer === 'agent' ? { agentId: input.agentId, agentVersion: input.agentVersion } : {}),
    ...(parsed.match === undefined ? {} : { match: parsed.match }),
    sections,
    ...(parsed.modelOptions === undefined ? {} : { modelOptions: parsed.modelOptions }),
  };
}

function inferPurposeFromTemplateId(templateId: string): string {
  if (isWellKnownPromptPurpose(templateId)) {
    return templateId;
  }
  throw promptTemplateError('PROMPT_PURPOSE_REQUIRED', 'Prompt manifest must declare purpose.', { templateId });
}

type ParsedContent = string | readonly ParsedSectionInput[];

interface ParsedPromptManifest {
  readonly schemaVersion: string;
  readonly purpose?: string;
  readonly match?: PromptTemplateMatch;
  readonly content: ParsedContent;
  readonly modelOptions?: ModelInferenceOptions;
}

interface ParsedSectionInput {
  readonly id?: string;
  readonly file?: string;
  readonly inline?: string;
}

function parsePromptManifest(text: string, templateId: string): ParsedPromptManifest {
  const lines = text.replace(/^\uFEFF/u, '').split(/\r?\n/u);
  const topLevel = topLevelFields(lines);
  assertManifestKeys(
    topLevel.map((field) => field.key),
    templateId,
  );

  const schema = scalarField(topLevel, 'schemaVersion') ?? schemaVersion;
  if (schema !== schemaVersion) {
    throw promptTemplateError('PROMPT_SCHEMA_VERSION_UNSUPPORTED', 'Prompt manifest schemaVersion is unsupported.', { templateId });
  }
  const purpose = scalarField(topLevel, 'purpose');
  if (purpose !== undefined) {
    assertPromptPurpose(purpose);
  }
  const contentField = field(topLevel, 'content');
  if (contentField === undefined) {
    throw promptTemplateError('PROMPT_CONTENT_REQUIRED', 'Prompt manifest content is required.', { templateId });
  }
  const match = parseMatch(field(topLevel, 'match'), templateId);
  const modelOptions = parseModelOptions(field(topLevel, 'modelOptions'), templateId);
  return {
    schemaVersion: schema,
    ...(purpose === undefined ? {} : { purpose }),
    ...(match === undefined ? {} : { match }),
    content: parseContent(contentField, templateId),
    ...(modelOptions === undefined ? {} : { modelOptions }),
  };
}

interface YamlField {
  readonly key: string;
  readonly value: string;
  readonly start: number;
  readonly end: number;
  readonly lines: readonly string[];
}

function topLevelFields(lines: readonly string[]): readonly YamlField[] {
  const starts: Array<{ key: string; value: string; start: number }> = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = stripTrailingComment(lines[index]!).trimEnd();
    if (line.trim().length === 0) {
      continue;
    }
    const match = /^([A-Za-z][A-Za-z0-9]*):\s*(.*)$/u.exec(line);
    if (match !== null && !line.startsWith(' ')) {
      starts.push({ key: match[1]!, value: match[2] ?? '', start: index });
    }
  }
  return starts.map((item, index) => ({
    ...item,
    end: (starts[index + 1]?.start ?? lines.length) - 1,
    lines,
  }));
}

function assertManifestKeys(keys: readonly string[], templateId: string): void {
  const allowed = new Set(['schemaVersion', 'purpose', 'match', 'content', 'modelOptions']);
  const seen = new Set<string>();
  for (const key of keys) {
    if (seen.has(key)) {
      throw promptTemplateError('PROMPT_MANIFEST_DUPLICATE_FIELD', 'Prompt manifest contains a duplicate field.', { templateId, field: key });
    }
    seen.add(key);
    if (!allowed.has(key)) {
      throw promptTemplateError('PROMPT_MANIFEST_FIELD_UNSUPPORTED', 'Prompt manifest contains an unsupported field.', { templateId, field: key });
    }
  }
}

function scalarField(fields: readonly YamlField[], key: string): string | undefined {
  const item = field(fields, key);
  if (item === undefined) {
    return undefined;
  }
  if (item.value.length === 0 || item.value === '|') {
    throw promptTemplateError('PROMPT_MANIFEST_SCALAR_REQUIRED', 'Prompt manifest field must be a scalar.', { field: key });
  }
  return unquote(item.value);
}

function field(fields: readonly YamlField[], key: string): YamlField | undefined {
  return fields.find((item) => item.key === key);
}

function parseMatch(item: YamlField | undefined, templateId: string): PromptTemplateMatch | undefined {
  if (item === undefined) {
    return undefined;
  }
  if (item.value.length > 0) {
    throw promptTemplateError('PROMPT_MATCH_OBJECT_REQUIRED', 'Prompt match must be an object.', { templateId });
  }
  const nested = nestedFields(item);
  const allowed = new Set(['locale', 'model', 'flowVariables']);
  assertOnlyAllowed(
    nested.map((entry) => entry.key),
    allowed,
    'PROMPT_MATCH_FIELD_UNSUPPORTED',
    templateId,
  );
  const locale = scalarNested(nested, 'locale');
  const model = parseModelMatch(
    nested.find((entry) => entry.key === 'model'),
    templateId,
  );
  const flowVariables = parseStringMap(
    nested.find((entry) => entry.key === 'flowVariables'),
    'PROMPT_FLOW_VARIABLES_INVALID',
    templateId,
  );
  return {
    ...(locale === undefined ? {} : { locale }),
    ...(model === undefined ? {} : { model }),
    ...(flowVariables === undefined ? {} : { flowVariables }),
  };
}

function parseModelMatch(item: YamlField | undefined, templateId: string): string | undefined {
  if (item === undefined) {
    return undefined;
  }
  if (item.value.length === 0 || item.value === '|' || !isYamlStringScalar(item.value) || blockLines(item).some((line) => line.trim().length > 0)) {
    throw promptTemplateError('PROMPT_MODEL_MATCH_SCALAR_REQUIRED', 'Prompt match.model must be a canonical modelId scalar.', { templateId });
  }
  const modelId = unquote(item.value);
  if (!isModelId(modelId)) {
    throw promptTemplateError('PROMPT_MODEL_ID_INVALID', 'Prompt modelId is invalid.', { templateId });
  }
  return modelId;
}

function isYamlStringScalar(value: string): boolean {
  const trimmed = value.trim();
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.length >= 2;
  }
  return !/^(?:null|~|true|false|[-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?)$/iu.test(trimmed) && !trimmed.startsWith('[') && !trimmed.startsWith('{');
}

function parseStringMap(item: YamlField | undefined, code: string, templateId: string): Readonly<Record<string, string>> | undefined {
  if (item === undefined) {
    return undefined;
  }
  const nested = nestedFields(item);
  const result: Record<string, string> = {};
  for (const entry of nested) {
    if (entry.value.length === 0 || entry.value === '|') {
      throw promptTemplateError(code, 'Prompt string map entries must be scalar strings.', { templateId });
    }
    assertSafeId(entry.key, code, 'Prompt string map key is invalid.');
    result[entry.key] = unquote(entry.value);
  }
  return result;
}

function parseModelOptions(item: YamlField | undefined, templateId: string): ModelInferenceOptions | undefined {
  if (item === undefined) {
    return undefined;
  }
  if (item.value.length > 0) {
    throw promptTemplateError('PROMPT_MODEL_OPTIONS_INVALID', 'Prompt modelOptions must be an object.', { templateId });
  }
  const nested = nestedFields(item);
  const allowed = new Set([
    'temperature',
    'maxOutputTokens',
    'topP',
    'topK',
    'presencePenalty',
    'frequencyPenalty',
    'thinking',
    'toolChoice',
    'providerOptions',
  ]);
  assertOnlyAllowed(
    nested.map((entry) => entry.key),
    allowed,
    'PROMPT_MODEL_OPTIONS_FIELD_UNSUPPORTED',
    templateId,
  );
  const temperature = optionalBoundedNumber(nested, 'temperature', 0, 2, templateId);
  const maxOutputTokens = optionalPositiveInteger(nested, 'maxOutputTokens', templateId);
  const topP = optionalBoundedNumber(nested, 'topP', 0, 1, templateId);
  const topK = optionalPositiveInteger(nested, 'topK', templateId);
  const presencePenalty = optionalBoundedNumber(nested, 'presencePenalty', -2, 2, templateId);
  const frequencyPenalty = optionalBoundedNumber(nested, 'frequencyPenalty', -2, 2, templateId);
  const thinking = parseThinking(
    nested.find((entry) => entry.key === 'thinking'),
    templateId,
  );
  const toolChoice = parseToolChoice(nested, templateId);
  const providerOptions = parseProviderOptions(
    nested.find((entry) => entry.key === 'providerOptions'),
    templateId,
  );
  return {
    ...(temperature === undefined ? {} : { temperature }),
    ...(maxOutputTokens === undefined ? {} : { maxOutputTokens }),
    ...(topP === undefined ? {} : { topP }),
    ...(topK === undefined ? {} : { topK }),
    ...(presencePenalty === undefined ? {} : { presencePenalty }),
    ...(frequencyPenalty === undefined ? {} : { frequencyPenalty }),
    ...(thinking === undefined ? {} : { thinking }),
    ...(toolChoice === undefined ? {} : { toolChoice }),
    ...(providerOptions === undefined ? {} : { providerOptions }),
  };
}

function parseToolChoice(fields: readonly YamlField[], templateId: string): ToolChoice | undefined {
  const item = fields.find((entry) => entry.key === 'toolChoice');
  if (item === undefined) {
    return undefined;
  }
  const value = unquote(item.value);
  if (value !== 'AUTO' && value !== 'NONE' && value !== 'REQUIRED') {
    throw promptTemplateError('PROMPT_MODEL_OPTIONS_INVALID', 'Prompt toolChoice is invalid.', { templateId });
  }
  return value;
}

function optionalBoundedNumber(fields: readonly YamlField[], key: string, minimum: number, maximum: number, templateId: string): number | undefined {
  const item = fields.find((entry) => entry.key === key);
  if (item === undefined) {
    return undefined;
  }
  const value = Number(unquote(item.value));
  if (!Number.isFinite(value) || value < minimum || value > maximum) {
    throw promptTemplateError('PROMPT_MODEL_OPTIONS_INVALID', 'Prompt model option is outside its allowed range.', { templateId, field: key });
  }
  return value;
}

function optionalPositiveInteger(fields: readonly YamlField[], key: string, templateId: string): number | undefined {
  const item = fields.find((entry) => entry.key === key);
  if (item === undefined) {
    return undefined;
  }
  const value = Number(unquote(item.value));
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw promptTemplateError('PROMPT_MODEL_OPTIONS_INVALID', 'Prompt model option must be a positive safe integer.', { templateId, field: key });
  }
  return value;
}

function parseThinking(item: YamlField | undefined, templateId: string): ThinkingOptions | undefined {
  if (item === undefined) {
    return undefined;
  }
  if (item.value.length > 0) {
    throw promptTemplateError('PROMPT_MODEL_OPTIONS_INVALID', 'Prompt thinking must be an object.', { templateId });
  }
  const nested = nestedFields(item);
  assertOnlyAllowed(
    nested.map((entry) => entry.key),
    new Set(['depth']),
    'PROMPT_MODEL_OPTIONS_FIELD_UNSUPPORTED',
    templateId,
  );
  const depth = scalarNested(nested, 'depth');
  if (depth !== 'OFF' && depth !== 'LOW' && depth !== 'MEDIUM' && depth !== 'HIGH') {
    throw promptTemplateError('PROMPT_MODEL_OPTIONS_INVALID', 'Prompt thinking.depth is invalid.', { templateId });
  }
  return { depth };
}

function parseProviderOptions(item: YamlField | undefined, templateId: string): JsonObject | undefined {
  if (item === undefined) {
    return undefined;
  }
  if (item.value.length > 0) {
    throw promptTemplateError('PROMPT_MODEL_OPTIONS_INVALID', 'Prompt providerOptions must be an object.', { templateId });
  }
  return parseJsonMap(nestedFields(item), templateId);
}

function parseJsonMap(fields: readonly YamlField[], templateId: string): JsonObject {
  const result: Record<string, JsonValue> = {};
  for (const entry of fields) {
    if (entry.key === 'reasoning' || entry.key === 'thinking' || entry.key === 'reasoningEffort') {
      throw promptTemplateError('PROMPT_PROVIDER_REASONING_DUPLICATE', 'Prompt providerOptions cannot control reasoning.', { templateId });
    }
    if (entry.value.length === 0) {
      result[entry.key] = parseJsonMap(nestedFields(entry), templateId);
      continue;
    }
    const scalar = unquote(entry.value);
    if (scalar === 'null' || scalar === '~') {
      throw promptTemplateError('PROMPT_MODEL_OPTIONS_INVALID', 'Prompt providerOptions cannot contain null.', { templateId });
    }
    result[entry.key] = scalar === 'true' ? true : scalar === 'false' ? false : finiteNumberOrString(scalar);
  }
  return result;
}

function finiteNumberOrString(value: string): number | string {
  const number = Number(value);
  return value.trim().length > 0 && Number.isFinite(number) ? number : value;
}

function isModelId(value: string): boolean {
  return value === value.trim() && [...value].length >= 1 && [...value].length <= 256 && !/[\u0000-\u001F\u007F-\u009F]/u.test(value);
}

function parseContent(item: YamlField, templateId: string): ParsedContent {
  if (item.value === '|') {
    return blockScalar(item);
  }
  if (item.value.length > 0) {
    return unquote(item.value);
  }
  const block = blockLines(item).filter((line) => line.trim().length > 0 && !line.trimStart().startsWith('#'));
  if (block.length === 0) {
    throw promptTemplateError('PROMPT_CONTENT_REQUIRED', 'Prompt manifest content is required.', { templateId });
  }
  if (!block[0]!.trimStart().startsWith('- ')) {
    return block
      .map((line) => trimBlockIndent(line, 2))
      .join('\n')
      .trimEnd();
  }
  return parseContentArray(block, templateId);
}

function parseContentArray(lines: readonly string[], templateId: string): readonly ParsedSectionInput[] {
  const sections: ParsedSectionInput[] = [];
  let current: Record<string, string> | undefined;
  for (let index = 0; index < lines.length; index += 1) {
    const raw = lines[index]!;
    const trimmed = raw.trimStart();
    if (trimmed.startsWith('- ')) {
      if (current !== undefined) {
        sections.push(toParsedSection(current, templateId));
      }
      current = {};
      const rest = trimmed.slice(2).trim();
      if (!rest.includes(':')) {
        current.file = unquote(rest);
        continue;
      }
      const [key, value] = splitYamlPair(rest, templateId);
      if (value === '|') {
        current[key] = collectNestedBlock(lines, index);
        index = skipNestedBlock(lines, index);
      } else {
        current[key] = unquote(value);
      }
      continue;
    }
    if (current === undefined) {
      throw promptTemplateError('PROMPT_CONTENT_SECTION_INVALID', 'Prompt content section is invalid.', { templateId });
    }
    const [key, value] = splitYamlPair(trimmed, templateId);
    if (value === '|') {
      current[key] = collectNestedBlock(lines, index);
      index = skipNestedBlock(lines, index);
    } else {
      current[key] = unquote(value);
    }
  }
  if (current !== undefined) {
    sections.push(toParsedSection(current, templateId));
  }
  return sections;
}

function toParsedSection(input: Record<string, string>, templateId: string): ParsedSectionInput {
  const allowed = new Set(['id', 'file', 'inline']);
  assertOnlyAllowed(Object.keys(input), allowed, 'PROMPT_SECTION_FIELD_UNSUPPORTED', templateId);
  const hasFile = input.file !== undefined;
  const hasInline = input.inline !== undefined;
  if (hasFile === hasInline) {
    throw promptTemplateError('PROMPT_SECTION_SOURCE_INVALID', 'Prompt section must declare exactly one content source.', { templateId });
  }
  if (hasInline && input.id === undefined) {
    throw promptTemplateError('PROMPT_SECTION_ID_REQUIRED', 'Inline prompt section must declare id.', { templateId });
  }
  return {
    ...(input.id === undefined ? {} : { id: input.id }),
    ...(input.file === undefined ? {} : { file: input.file }),
    ...(input.inline === undefined ? {} : { inline: input.inline }),
  };
}

function materializeSections(input: {
  readonly templateId: string;
  readonly purpose: string;
  readonly baseDir: string;
  readonly content: ParsedContent;
}): readonly PromptSection[] {
  const policy = compilePolicyForPurpose(input.purpose);
  policy.validateContentShape({ templateId: input.templateId, contentKind: typeof input.content === 'string' ? 'string' : 'sections' });
  if (typeof input.content === 'string') {
    return [materializeSection({ id: 'main', inline: input.content }, input, policy)];
  }
  return input.content.map((section) => materializeSection(section, input, policy));
}

function materializeSection(
  section: ParsedSectionInput,
  input: { readonly templateId: string; readonly purpose: string; readonly baseDir: string },
  policy = compilePolicyForPurpose(input.purpose),
): PromptSection {
  const id = section.id ?? deriveSectionId(section.file ?? '');
  assertSafeId(id, 'PROMPT_SECTION_ID_INVALID', 'Prompt section id is invalid.');
  policy.validateSectionId({ templateId: input.templateId, sectionId: id });
  const content = section.inline ?? readSectionFile(input.baseDir, section.file, input.templateId);
  const variables = inferVariables(content, input.templateId);
  return { id, content, variables };
}

function readSectionFile(baseDir: string, file: string | undefined, templateId: string): string {
  if (file === undefined) {
    return '';
  }
  if (file.length === 0 || isAbsolute(file)) {
    throw promptTemplateError('PROMPT_SECTION_FILE_INVALID', 'Prompt section file must be relative.', { templateId });
  }
  const resolved = resolve(baseDir, file);
  const rel = relative(baseDir, resolved);
  if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) {
    throw promptTemplateError('PROMPT_SECTION_FILE_ESCAPES_ROOT', 'Prompt section file escapes template root.', { templateId });
  }
  const extension = extname(resolved);
  if (extension !== '.md' && extension !== '.txt') {
    throw promptTemplateError('PROMPT_SECTION_FILE_UNSUPPORTED', 'Prompt section file extension is unsupported.', { templateId });
  }
  if (!existsSync(resolved) || !statSync(resolved).isFile()) {
    throw promptTemplateError('PROMPT_SECTION_FILE_MISSING', 'Prompt section file is unavailable.', { templateId });
  }
  return readFileSync(resolved, 'utf8');
}

function inferVariables(content: string, templateId: string): readonly PromptSectionVariable[] {
  const supported = new Set(createDefaultPromptTemplateVariableResolver().supportedVariableNames);
  const variables: PromptSectionVariable[] = [];
  const seen = new Set<string>();
  const validTokens = new Set<string>();
  for (const match of content.matchAll(variablePattern)) {
    const token = match[0]!;
    const name = match[1]!;
    const optional = match[2] === '?';
    validTokens.add(token);
    if (!supported.has(name)) {
      throw promptTemplateError('PROMPT_VARIABLE_UNKNOWN', 'Prompt template references an unknown variable.', { templateId, variableName: name });
    }
    const key = `${name}:${optional}`;
    if (!seen.has(key)) {
      seen.add(key);
      variables.push({ name, optional });
    }
  }
  for (const match of content.matchAll(anyMustachePattern)) {
    if (!validTokens.has(match[0]!)) {
      throw promptTemplateError('PROMPT_TEMPLATE_SYNTAX_UNSUPPORTED', 'Prompt template uses unsupported variable syntax.', { templateId });
    }
  }
  return variables;
}

function deriveSectionId(file: string): string {
  return basename(file, extname(file));
}

function assertUniqueTemplateIds(templates: readonly PromptTemplate[]): void {
  const seen = new Set<string>();
  for (const template of templates) {
    if (seen.has(template.templateId)) {
      throw promptTemplateError('PROMPT_TEMPLATE_ID_DUPLICATE', 'Prompt root contains duplicate template ids.', { templateId: template.templateId });
    }
    seen.add(template.templateId);
  }
}

function nestedFields(item: YamlField): readonly YamlField[] {
  return topLevelFields(blockLines(item).map((line) => trimBlockIndent(line, 2)));
}

function scalarNested(fields: readonly YamlField[], key: string): string | undefined {
  const item = field(fields, key);
  if (item === undefined) {
    return undefined;
  }
  if (item.value.length === 0 || item.value === '|') {
    throw promptTemplateError('PROMPT_MANIFEST_SCALAR_REQUIRED', 'Prompt manifest nested field must be a scalar.', { field: key });
  }
  return unquote(item.value);
}

function blockLines(item: YamlField): readonly string[] {
  return item.lines.slice(item.start + 1, item.end + 1);
}

function blockScalar(item: YamlField): string {
  return blockLines(item)
    .map((line) => trimBlockIndent(line, 2))
    .join('\n')
    .trimEnd();
}

function collectNestedBlock(lines: readonly string[], start: number): string {
  const result: string[] = [];
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index]!;
    if (line.trim().length === 0) {
      result.push('');
      continue;
    }
    if (line.trimStart().startsWith('- ')) {
      break;
    }
    result.push(trimBlockIndent(line, 4));
  }
  return result.join('\n').trimEnd();
}

function skipNestedBlock(lines: readonly string[], start: number): number {
  let index = start;
  for (let next = start + 1; next < lines.length; next += 1) {
    const line = lines[next]!;
    if (line.trim().length > 0 && line.trimStart().startsWith('- ')) {
      break;
    }
    index = next;
  }
  return index;
}

function splitYamlPair(text: string, templateId: string): readonly [string, string] {
  const match = /^([A-Za-z][A-Za-z0-9]*):\s*(.*)$/u.exec(text);
  if (match === null) {
    throw promptTemplateError('PROMPT_MANIFEST_FIELD_INVALID', 'Prompt manifest field syntax is invalid.', { templateId });
  }
  return [match[1]!, match[2] ?? ''];
}

function trimBlockIndent(line: string, spaces: number): string {
  return line.startsWith(' '.repeat(spaces)) ? line.slice(spaces) : line.trimStart();
}

function stripTrailingComment(line: string): string {
  return line.trimStart().startsWith('#') ? '' : line;
}

function unquote(value: string): string {
  const trimmed = value.trim();
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function assertOnlyAllowed(keys: readonly string[], allowed: ReadonlySet<string>, code: string, templateId: string): void {
  for (const key of keys) {
    if (!allowed.has(key)) {
      throw promptTemplateError(code, 'Prompt manifest contains an unsupported field.', { templateId, field: key });
    }
  }
}

function assertSafeId(value: string, code: string, message: string): void {
  if (!safeIdPattern.test(value)) {
    throw promptTemplateError(code, message);
  }
}

function promptTemplateError(code: string, message: string, safeDetails: Record<string, string> = {}): AgentError {
  return new AgentError({
    code,
    message,
    category: 'VALIDATION',
    retryable: false,
    safeDetails,
  });
}
