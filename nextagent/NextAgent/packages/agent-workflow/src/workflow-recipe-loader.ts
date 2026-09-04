import { AgentError, brand, getLogger, type AgentId, type JsonObject } from '@nextagent/agent-common';
import type { AgentAssembly } from '@nextagent/agent-contracts/agent-assembly';
import {
  CapabilityLocalesSchema,
  type CapabilityDescriptor,
  type CapabilityLocales,
  type CapabilityProvider,
  type CapabilityProviderIdentity,
} from '@nextagent/agent-contracts/capability';
import {
  RecipeDefinitionSchema,
  type RecipeDefinition,
  type NodePresentation,
  type RetryPolicy,
  type WorkflowLoopConfig,
  type WorkflowBatchConfig,
} from '@nextagent/agent-contracts/core';
import { Ajv } from 'ajv/dist/ajv.js';
import { load as parseYaml } from 'js-yaml';
import { existsSync, lstatSync, readdirSync, readFileSync, realpathSync } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';

const recipeValidator = new Ajv({ allErrors: true, strict: false }).compile(RecipeDefinitionSchema);
const localesValidator = new Ajv({ allErrors: true, strict: false }).compile(CapabilityLocalesSchema);
const supportedRecipeExtensions = new Set(['.yaml', '.yml']);
const RECIPE_CACHE_LIMIT = 100;
const logger = getLogger({ component: 'agent-workflow', source: 'workflow-recipe-loader' });

export const localRecipeProvider: CapabilityProviderIdentity = {
  providerId: 'local-recipes',
  providerKind: 'LOCAL_DIRECTORY',
};

export interface RecipeIndex {
  readonly recipeName: RecipeDefinition['recipeName'];
  readonly displayName: string;
  readonly locales?: CapabilityLocales;
  readonly domain?: string;
  readonly scene?: string;
  readonly lang?: string;
  readonly description?: string;
  readonly filePath: string;
}

export class WorkflowRecipeDefinitionSource {
  private readonly definitionsByAgentId = new Map<AgentId, Map<RecipeDefinition['recipeName'], RecipeDefinition>>();
  private readonly agentsRoot: string;

  constructor(options: { readonly agentsRoot: string }) {
    this.agentsRoot = options.agentsRoot;
  }

  require(agentId: AgentId, recipeName: RecipeDefinition['recipeName']): RecipeDefinition {
    const cached = this.definitionsByAgentId.get(agentId)?.get(recipeName);
    if (cached !== undefined) {
      return cached;
    }
    const recipeDir = this.recipeDirectory(agentId);
    const indices = loadRecipeIndexDirectory(recipeDir, this.agentsRoot);
    const index = indices.get(recipeName);
    if (index === undefined) {
      throw new AgentError({
        code: 'RECIPE_NOT_FOUND',
        message: 'Requested workflow recipe is not registered for the accepted agent.',
        category: 'NOT_FOUND',
        retryable: false,
        safeDetails: { reasonCode: 'RECIPE_NOT_FOUND', agentId, recipeName },
      });
    }
    const definition = loadRecipeDefinition(index.filePath, this.agentsRoot);
    if (definition === undefined) {
      throw new AgentError({
        code: 'RECIPE_INVALID',
        message: 'Workflow recipe failed validation during lazy load.',
        category: 'INTERNAL',
        retryable: false,
        safeDetails: { reasonCode: 'RECIPE_INVALID', recipeName },
      });
    }
    let agentCache = this.definitionsByAgentId.get(agentId);
    if (agentCache === undefined) {
      agentCache = new Map<RecipeDefinition['recipeName'], RecipeDefinition>();
      this.definitionsByAgentId.set(agentId, agentCache);
    }
    if (agentCache.size >= RECIPE_CACHE_LIMIT) {
      const oldestKey = agentCache.keys().next().value;
      if (oldestKey !== undefined) {
        agentCache.delete(oldestKey);
      }
    }
    agentCache.set(recipeName, definition);
    return definition;
  }

  searchDescriptors(agentId: AgentId): readonly CapabilityDescriptor[] {
    return listRecipeCapabilityDescriptors(this, agentId);
  }

  list(agentId: AgentId): readonly RecipeIndex[] {
    const recipeDir = this.recipeDirectory(agentId);
    return [...loadRecipeIndexDirectory(recipeDir, this.agentsRoot).values()];
  }

  validateTrustedRecipeRoot(agentId: AgentId): void {
    assertTrustedRecipeDirectory(this.recipeDirectory(agentId), this.agentsRoot);
  }

  private recipeDirectory(agentId: AgentId): string {
    return join(this.agentsRoot, agentId, 'recipes');
  }
}

export function createRecipeDefinitionSourceForAssemblies(
  _agentAssemblies: readonly AgentAssembly[],
  agentsRoot: string,
): WorkflowRecipeDefinitionSource {
  return new WorkflowRecipeDefinitionSource({
    agentsRoot,
  });
}

export function attachRecipeCapabilitiesToAssemblies(
  assemblies: readonly AgentAssembly[],
  recipeSource: WorkflowRecipeDefinitionSource,
): readonly AgentAssembly[] {
  for (const assembly of assemblies) {
    recipeSource.list(assembly.agentId);
  }
  return assemblies;
}

export function listRecipeCapabilityDescriptors(recipeSource: WorkflowRecipeDefinitionSource, agentId: AgentId): readonly CapabilityDescriptor[] {
  return recipeSource.list(agentId).map((index) => ({
    capabilityId: brand<string, 'CapabilityId'>(index.recipeName),
    kind: 'WORKFLOW',
    provider: localRecipeProvider,
    version: '1',
    displayName: index.displayName,
    ...(index.locales === undefined ? {} : { locales: index.locales }),
    description: index.description ?? index.recipeName,
    modelInvocable: false,
    availabilityStatus: 'AVAILABLE',
    disclosurePolicy: { mode: 'EAGER' },
    inputSchema: {
      type: 'object',
      additionalProperties: true,
    },
    outputSchema: {
      type: 'object',
      additionalProperties: true,
    },
    replayPolicy: 'NON_IDEMPOTENT',
    metadata: {
      metadataKind: 'nextagent.recipe',
      recipeName: index.recipeName,
      ...(index.domain === undefined ? {} : { domain: index.domain }),
      ...(index.scene === undefined ? {} : { scene: index.scene }),
      ...(index.lang === undefined ? {} : { lang: index.lang }),
    },
  }));
}

export function createRecipeCapabilityProvider(recipeSource: WorkflowRecipeDefinitionSource): CapabilityProvider {
  return {
    identity: localRecipeProvider,
    discovery: {
      provider: localRecipeProvider,
      discoveryMode: 'SEARCH',
      async search(criteria): Promise<readonly CapabilityDescriptor[]> {
        const descriptors = recipeSource.searchDescriptors(criteria.agentId);
        return criteria.requestedCapabilityId === undefined
          ? descriptors
          : descriptors.filter((descriptor) => descriptor.capabilityId === criteria.requestedCapabilityId);
      },
      async listCurrent(criteria): Promise<readonly CapabilityDescriptor[]> {
        return recipeSource.searchDescriptors(criteria.agentId);
      },
    },
  };
}

function loadRecipeIndexDirectory(recipeDirectory: string, packageRoot: string): Map<RecipeDefinition['recipeName'], RecipeIndex> {
  assertTrustedRecipeDirectory(recipeDirectory, packageRoot);
  if (!existsSync(recipeDirectory)) {
    return new Map();
  }

  const indices = new Map<RecipeDefinition['recipeName'], RecipeIndex>();
  for (const filePath of collectRecipeFiles(recipeDirectory, packageRoot)) {
    const index = loadRecipeIndex(filePath, packageRoot);
    if (index !== undefined) {
      indices.set(index.recipeName, index);
    }
  }
  return indices;
}

function loadRecipeIndex(filePath: string, packageRoot: string): RecipeIndex | undefined {
  const recipeRef = safeRecipeRef(filePath, packageRoot);
  try {
    const parsed = normalizeRecipeDefinition(parseYaml(stripBom(readFileSync(filePath, 'utf8'))) as unknown);
    const recipeName = extractRecipeName(parsed);
    const displayName = isRecord(parsed) && typeof parsed.displayName === 'string' ? parsed.displayName : undefined;
    const locales = isRecord(parsed) ? parsed.locales : undefined;
    if (recipeName === undefined || displayName === undefined || (locales !== undefined && localesValidator(locales) !== true)) {
      logger.warn({ event: 'workflow.recipe.skip', safeReasonCode: 'WORKFLOW_RECIPE_INVALID', recipeRef });
      return undefined;
    }
    return {
      recipeName,
      displayName,
      ...(locales === undefined ? {} : { locales: locales as CapabilityLocales }),
      ...extractOptionalString(parsed, 'domain'),
      ...extractOptionalString(parsed, 'scene'),
      ...extractOptionalString(parsed, 'lang'),
      ...extractOptionalString(parsed, 'description'),
      filePath,
    };
  } catch (error) {
    logger.warn({ err: error, event: 'workflow.recipe.skip', failureStage: 'WORKFLOW_RECIPE_INDEX_PARSE', recipeRef });
    return undefined;
  }
}

function extractRecipeName(parsed: unknown): RecipeDefinition['recipeName'] | undefined {
  if (!isRecord(parsed)) {
    return undefined;
  }
  if (typeof parsed.recipeName === 'string') {
    return parsed.recipeName;
  }
  if (typeof parsed.name === 'string') {
    return parsed.name;
  }
  return undefined;
}

function extractOptionalString(parsed: unknown, key: string): Record<string, string> {
  if (!isRecord(parsed) || typeof parsed[key] !== 'string') {
    return {};
  }
  return { [key]: parsed[key] };
}

function collectRecipeFiles(directory: string, packageRoot: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const entryPath = join(directory, entry.name);
    const entryRef = safeRecipeRef(entryPath, packageRoot);
    if (entry.isSymbolicLink()) {
      logger.warn({ event: 'workflow.recipe.skip', safeReasonCode: 'WORKFLOW_RECIPE_SYMLINK_SKIPPED', recipeRef: entryRef });
      continue;
    }
    if (entry.isDirectory()) {
      files.push(...collectRecipeFiles(entryPath, packageRoot));
      continue;
    }
    if (entry.isFile() && supportedRecipeExtensions.has(extensionOf(entry.name))) {
      files.push(entryPath);
    }
  }
  return files;
}

function loadRecipeDefinition(filePath: string, packageRoot: string): RecipeDefinition | undefined {
  assertTrustedFilePath(filePath, packageRoot);
  const recipeRef = safeRecipeRef(filePath, packageRoot);
  try {
    const parsed = normalizeRecipeDefinition(parseYaml(stripBom(readFileSync(filePath, 'utf8'))) as unknown);
    if (!recipeValidator(parsed)) {
      const validationErrors = (recipeValidator.errors ?? []).slice(0, 10).map((err) => ({ instancePath: err.instancePath, keyword: err.keyword }));
      logger.warn({
        event: 'workflow.recipe.skip',
        safeReasonCode: 'WORKFLOW_RECIPE_INVALID',
        recipeRef,
        validationErrors,
      });
      return undefined;
    }
    const loopValidation = validateLoopConfigs(parsed);
    if (loopValidation !== undefined) {
      logger.warn({
        event: 'workflow.recipe.skip',
        safeReasonCode: 'WORKFLOW_RECIPE_INVALID',
        recipeRef,
      });
      return undefined;
    }
    return parsed;
  } catch (error) {
    logger.warn({ err: error, event: 'workflow.recipe.skip', failureStage: 'WORKFLOW_RECIPE_DEFINITION_PARSE', recipeRef });
    return undefined;
  }
}

function assertTrustedRecipeDirectory(recipeDirectory: string, packageRoot: string): void {
  if (isAbsolute(relative(packageRoot, recipeDirectory))) {
    throw new Error('Workflow recipe root must resolve from the packaged app root.');
  }
  if (!existsSync(recipeDirectory)) {
    return;
  }
  const stats = lstatSync(recipeDirectory);
  if (!stats.isDirectory() || stats.isSymbolicLink()) {
    throw new Error('Workflow recipe root must be a normal directory.');
  }
  const trustedPackageRoot = realpathSync(packageRoot);
  const trustedRecipeRoot = realpathSync(recipeDirectory);
  const rel = relative(trustedPackageRoot, trustedRecipeRoot);
  if (rel.startsWith('..') || isAbsolute(rel)) {
    throw new Error('Workflow recipe root must stay inside the packaged app root.');
  }
}

function assertTrustedFilePath(filePath: string, packageRoot: string): void {
  const trustedPackageRoot = realpathSync(packageRoot);
  const trustedFilePath = realpathSync(filePath);
  const rel = relative(trustedPackageRoot, trustedFilePath);
  if (rel.startsWith('..') || isAbsolute(rel)) {
    throw new Error('Workflow recipe file must stay inside the packaged app root.');
  }
}

function safeRecipeRef(path: string, packageRoot: string): string {
  const ref = relative(packageRoot, resolve(path)).replaceAll('\\', '/');
  return ref.length === 0 ? '.' : ref;
}

function stripBom(content: string): string {
  return content.charCodeAt(0) === 0xfeff ? content.slice(1) : content;
}

function extensionOf(fileName: string): string {
  const offset = fileName.lastIndexOf('.');
  return offset < 0 ? '' : fileName.slice(offset).toLowerCase();
}

function normalizeRecipeDefinition(value: unknown): unknown {
  if (!isRecord(value)) {
    return value;
  }
  if ('recipeName' in value && 'flowGraph' in value) {
    const rawNodes = asRecord((value as { flowGraph: { nodes: unknown } }).flowGraph?.nodes);
    if (rawNodes !== undefined) {
      const normalizedNodes = Object.fromEntries(
        Object.entries(rawNodes).map(([nodeId, node]) => [
          nodeId,
          normalizeNodeDefinition(node, nodeId, (value as { recipeName: string }).recipeName),
        ]),
      );
      const coercedVersion = typeof value.version === 'number' ? String(value.version) : value.version;
      return { ...value, version: coercedVersion, flowGraph: { nodes: normalizedNodes } };
    }
    return value;
  }
  const nodes = asRecord(value.nodes);
  if (typeof value.name !== 'string' || (typeof value.version !== 'string' && typeof value.version !== 'number') || nodes === undefined) {
    return value;
  }
  const recipeName = value.name;
  const inputSchema = asJsonObject(value.inputSchema);
  const outputSchema = asJsonObject(value.outputSchema);
  const runtime = normalizeRuntimeConfig(value.runtime);
  return {
    recipeName: value.name,
    version: typeof value.version === 'number' ? String(value.version) : value.version,
    displayName: typeof value.displayName === 'string' ? value.displayName : value.name,
    ...(value.locales === undefined ? {} : { locales: value.locales as NonNullable<RecipeDefinition['locales']> }),
    ...(typeof value.description === 'string' ? { description: value.description } : {}),
    ...(typeof value.domain === 'string' ? { domain: value.domain } : {}),
    ...(typeof value.scene === 'string' ? { scene: value.scene } : {}),
    ...(value.lang === 'zh' || value.lang === 'en' ? { lang: value.lang } : {}),
    flowGraph: {
      nodes: Object.fromEntries(Object.entries(nodes).map(([nodeId, node]) => [nodeId, normalizeNodeDefinition(node, nodeId, recipeName)])),
    },
    ...(runtime === undefined ? {} : { runtime }),
    ...(typeof value.priority === 'number' ? { priority: value.priority } : {}),
    ...(inputSchema === undefined ? {} : { inputSchema }),
    ...(outputSchema === undefined ? {} : { outputSchema }),
    ...((asJsonObject(value.expandFields) ?? asJsonObject(value.metadata)) === undefined
      ? {}
      : { metadata: (asJsonObject(value.expandFields) ?? asJsonObject(value.metadata)) as Record<string, unknown> }),
  } satisfies RecipeDefinition;
}

const deprecatedNodeTypes = new Set(['AGENT', 'TOOL_CHOICE', 'DATA_ANALYSIS', 'TOOL']);

function normalizeNodeDefinition(node: unknown, nodeId: string, recipeName?: string): RecipeDefinition['flowGraph']['nodes'][string] {
  if (!isRecord(node)) {
    return { type: 'TOOL', next: {} };
  }
  const rawInputs = asJsonObject(node.inputs);
  const outputs = asJsonObject(node.outputs);
  const outputParser = asJsonObject(node.outputParser) ?? asJsonObject(node.output_parser);
  // output_parser inside outputs is visibility/control config, not output data.
  // Extract it from outputs and normalize to node-level outputParser.
  const outputsOutputParser = isRecord(outputs) ? (asJsonObject(outputs.output_parser) ?? asJsonObject(outputs.outputParser)) : undefined;
  const resolvedOutputParser = outputParser ?? outputsOutputParser;
  const filteredOutputs = isRecord(outputs)
    ? asJsonObject(Object.fromEntries(Object.entries(outputs).filter(([k]) => k !== 'output_parser' && k !== 'outputParser')))
    : outputs;
  const retryPolicy = asJsonObject(node.retryPolicy);
  const onError = asJsonObject(node.onError);
  const exception = normalizeException(node.exception);
  const dependsOn = Array.isArray(node.dependsOn) ? node.dependsOn.filter((v): v is string => typeof v === 'string') : undefined;
  const retry = normalizeRetry(node.retry, retryPolicy);
  const timeout = typeof node.timeout === 'number' ? node.timeout : undefined;
  const presentation = normalizeNodePresentation(node.presentation, resolvedOutputParser);
  const normalizedType = normalizeNodeType(node.type);
  if (deprecatedNodeTypes.has(normalizedType)) {
    logger.warn({
      event: 'workflow.recipe.deprecated-node',
      reasonCode: 'WORKFLOW_NODE_DEPRECATED',
      nodeType: normalizedType,
      ...(recipeName === undefined ? {} : { recipeName }),
    });
  }
  const inputs = rawInputs;
  const loopConfig = normalizeLoopConfig(node.loopConfig ?? node.loop_config ?? node.loop, nodeId);
  const batchConfig = normalizeBatchConfig(node.batchConfig ?? node.batch_config);
  if (loopConfig !== undefined && batchConfig !== undefined) {
    throw new AgentError({
      code: 'WORKFLOW_BATCH_LOOP_CONFLICT',
      message: 'Workflow node cannot declare both loopConfig and batchConfig.',
      category: 'VALIDATION',
      retryable: false,
      safeDetails: { reasonCode: 'WORKFLOW_BATCH_LOOP_CONFLICT' },
    });
  }
  return {
    type: normalizedType,
    ...(typeof node.description === 'string' ? { description: node.description } : {}),
    ...(inputs === undefined ? {} : { inputs }),
    ...(filteredOutputs === undefined ? {} : { outputs: filteredOutputs }),
    ...(dependsOn === undefined ? {} : { dependsOn }),
    ...(retry === undefined ? {} : { retry }),
    ...(timeout === undefined ? {} : { timeout }),
    ...(presentation === undefined ? {} : { presentation }),
    ...(resolvedOutputParser === undefined ? {} : { outputParser: resolvedOutputParser }),
    ...(retryPolicy === undefined ? {} : { retryPolicy }),
    ...(onError === undefined ? {} : { onError }),
    ...(exception === undefined ? {} : { exception }),
    ...(loopConfig === undefined ? {} : { loopConfig }),
    ...(batchConfig === undefined ? {} : { batchConfig }),
    next: normalizeNext(node.next),
  };
}

function normalizeException(value: unknown): Record<string, { condition?: string }> | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  const result: Record<string, { condition?: string }> = {};
  let hasAny = false;
  for (const [key, entry] of Object.entries(record)) {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
      continue;
    }
    const entryRecord = entry as Record<string, unknown>;
    const condition = typeof entryRecord.condition === 'string' ? entryRecord.condition : undefined;
    result[key] = condition === undefined ? {} : { condition };
    hasAny = true;
  }
  return hasAny ? result : undefined;
}

function normalizeRetry(retry: unknown, legacyRetryPolicy?: JsonObject): RetryPolicy | undefined {
  const retryRecord = asJsonObject(retry);
  if (retryRecord !== undefined) {
    const maxAttempts = typeof retryRecord.maxAttempts === 'number' ? retryRecord.maxAttempts : undefined;
    // Support snake_case alias for 1.0 compat
    const maxAttemptsFromSnake = typeof retryRecord.max_attempts === 'number' ? retryRecord.max_attempts : undefined;
    const backoff = retryRecord.backoff === 'fixed' || retryRecord.backoff === 'exponential' ? retryRecord.backoff : undefined;
    const delay = typeof retryRecord.delay === 'number' ? retryRecord.delay : undefined;
    if (maxAttempts === undefined && maxAttemptsFromSnake === undefined && backoff === undefined && delay === undefined) {
      return undefined;
    }
    return {
      ...(maxAttempts === undefined ? (maxAttemptsFromSnake === undefined ? {} : { maxAttempts: maxAttemptsFromSnake }) : { maxAttempts }),
      ...(backoff === undefined ? {} : { backoff }),
      ...(delay === undefined ? {} : { delay }),
    };
  }
  if (legacyRetryPolicy !== undefined) {
    const maxRetries = typeof legacyRetryPolicy.maxRetries === 'number' ? legacyRetryPolicy.maxRetries : undefined;
    const maxAttempts =
      typeof legacyRetryPolicy.maxAttempts === 'number' ? legacyRetryPolicy.maxAttempts : typeof maxRetries === 'number' ? maxRetries + 1 : undefined;
    const delay = typeof legacyRetryPolicy.delay === 'number' ? legacyRetryPolicy.delay : undefined;
    if (maxAttempts === undefined && delay === undefined) {
      return undefined;
    }
    return {
      ...(maxAttempts === undefined ? {} : { maxAttempts }),
      ...(delay === undefined ? {} : { delay }),
    };
  }
  return undefined;
}

function normalizeNodePresentation(presentation: unknown, legacyOutputParser?: JsonObject): NodePresentation | undefined {
  const presRecord = asJsonObject(presentation);
  if (presRecord !== undefined) {
    const outputParser = asJsonObject(presRecord.outputParser) ?? legacyOutputParser;
    // Support snake_case alias output_parser for 1.0 compat
    const resolvedOutputParser = outputParser ?? asJsonObject(presRecord.output_parser);
    const recommends = Array.isArray(presRecord.recommends) ? presRecord.recommends.filter((v): v is string => typeof v === 'string') : undefined;
    const tag = typeof presRecord.tag === 'string' ? presRecord.tag : undefined;
    if (resolvedOutputParser === undefined && recommends === undefined && tag === undefined) {
      return undefined;
    }
    return {
      ...(resolvedOutputParser === undefined ? {} : { outputParser: resolvedOutputParser }),
      ...(recommends === undefined ? {} : { recommends }),
      ...(tag === undefined ? {} : { tag }),
    };
  }
  if (legacyOutputParser !== undefined) {
    return { outputParser: legacyOutputParser };
  }
  return undefined;
}

function normalizeNodeType(value: unknown): RecipeDefinition['flowGraph']['nodes'][string]['type'] {
  switch (value) {
    case 'start-event':
    case 'start_event':
      return 'START';
    case 'end-event':
    case 'end_event':
      return 'END';
    case 'llm-router':
      return 'LLM_ROUTER';
    case 'intent-recognition':
      return 'INTENT_RECOGNITION';
    case 'question-rewriting':
      return 'QUESTION_REWRITING';
    case 'translation':
      return 'TRANSLATION';
    case 'data-analysis':
      return 'DATA_ANALYSIS';
    case 'param-extract':
      return 'PARAM_EXTRACT';
    case 'tool':
    case 'tool-invoke':
      return 'TOOL';
    case 'tool-choice':
    case 'tool_choice':
      return 'TOOL_CHOICE';
    case 'restful':
    case 'api-invoke':
      return 'RESTFUL';
    case 'python':
      return 'PYTHON';
    case 'agent':
      return 'AGENT';
    case 'skill':
      return 'SKILL';
    case 'display-content':
      return 'DISPLAY';
    case 'guardrail-check':
    case 'guardrail_check':
      return 'GUARDRAIL';
    case 'knowledge-search':
      return 'KNOWLEDGE_SEARCH';
    case 'knowledge-qa':
      return 'KNOWLEDGE_QA';
    case 'api-choice':
      return 'API_CHOICE';
    case 'recipe-choice':
      return 'RECIPE_CHOICE';
    case 'user-check':
      return 'USER_CHECK';
    case 'interrupt-gateway':
    case 'suspend':
      return 'INTERRUPT';
    case 'sub-recipe':
      return 'SUBFLOW';
    case 'parallel-gateway':
      return 'PARALLEL';
    case 'inclusive-gateway':
      return 'PARALLEL';
    case 'exclusive-gateway':
      return 'CONDITION';
    case 'delay-gateway':
      return 'DELAY';
    case 'START':
    case 'END':
    case 'LLM':
    case 'LLM_ROUTER':
    case 'INTENT_RECOGNITION':
    case 'QUESTION_REWRITING':
    case 'TRANSLATION':
    case 'DATA_ANALYSIS':
    case 'PARAM_EXTRACT':
    case 'TOOL_CHOICE':
    case 'RESTFUL':
    case 'PYTHON':
    case 'AGENT':
    case 'SKILL':
    case 'DISPLAY':
    case 'GUARDRAIL':
    case 'KNOWLEDGE_SEARCH':
    case 'KNOWLEDGE_QA':
    case 'API_CHOICE':
    case 'RECIPE_CHOICE':
    case 'USER_CHECK':
    case 'INTERRUPT':
    case 'ROUTER':
    case 'CONDITION':
    case 'SUBFLOW':
    case 'PARALLEL':
    case 'DELAY':
      return value;
    default:
      throw new Error(`Unknown workflow node type: ${String(value)}`);
  }
}

function normalizeBatchConfig(value: unknown): WorkflowBatchConfig | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const result: Record<string, unknown> = {};
  const map: Array<[string, string]> = [
    ['batchInputDataItem', 'batchInputDataItem'],
    ['batch_input_data_item', 'batchInputDataItem'],
    ['batchElementVariable', 'batchElementVariable'],
    ['batch_element_variable', 'batchElementVariable'],
    ['batchSize', 'batchSize'],
    ['batch_size', 'batchSize'],
    ['batchMode', 'batchMode'],
    ['batch_mode', 'batchMode'],
    ['batchFailStrategy', 'batchFailStrategy'],
    ['batch_fail_strategy', 'batchFailStrategy'],
    ['batchParallelism', 'batchParallelism'],
    ['batch_parallelism', 'batchParallelism'],
    ['batchResultMerge', 'batchResultMerge'],
    ['batch_result_merge', 'batchResultMerge'],
  ];
  for (const [src, dst] of map) {
    if (src in value) {
      result[dst] = value[src];
    }
  }
  result.batchSize = coercePositiveIntegerString(result.batchSize);
  result.batchParallelism = coercePositiveIntegerString(result.batchParallelism);
  return Object.keys(result).length === 0 ? undefined : (result as unknown as WorkflowBatchConfig);
}

function coercePositiveIntegerString(value: unknown): unknown {
  if (typeof value === 'string' && /^\d+$/u.test(value.trim())) {
    return Number(value);
  }
  return value;
}

function normalizeNext(value: unknown): Record<string, { readonly condition?: string }> {
  const next = asRecord(value);
  if (next === undefined) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(next).map(([nodeId, branch]) => {
      const branchRecord = asRecord(branch);
      if (branchRecord !== undefined && typeof branchRecord.condition === 'string') {
        return [nodeId, { condition: branchRecord.condition }];
      }
      if (typeof branch === 'string') {
        return [nodeId, { condition: branch }];
      }
      return [nodeId, {}];
    }),
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return isRecord(value) ? value : undefined;
}

function asJsonObject(value: unknown): JsonObject | undefined {
  return isRecord(value) ? (value as JsonObject) : undefined;
}

function normalizeLoopConfig(value: unknown, nodeId: string): WorkflowLoopConfig | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const result: Record<string, unknown> = {};
  const map: Array<[string, string]> = [
    ['loopId', 'loopId'],
    ['loop_id', 'loopId'],
    ['loopCardinality', 'loopCardinality'],
    ['loop_cardinality', 'loopCardinality'],
    ['loopCompletionCondition', 'loopCompletionCondition'],
    ['loop_completion_condition', 'loopCompletionCondition'],
    ['loopInputDataItem', 'loopInputDataItem'],
    ['loop_input_data_item', 'loopInputDataItem'],
    ['loopElementVariable', 'loopElementVariable'],
    ['loop_element_variable', 'loopElementVariable'],
    ['loopTimeCycle', 'loopTimeCycle'],
    ['loop_time_cycle', 'loopTimeCycle'],
    ['loopEndNode', 'loopEndNode'],
    ['loop_end_node', 'loopEndNode'],
    ['loopStartNode', 'loopStartNode'],
    ['loop_start_node', 'loopStartNode'],
    ['loopResultVariable', 'loopResultVariable'],
    ['loop_result_variable', 'loopResultVariable'],
    ['loopResultType', 'loopResultType'],
    ['loop_result_type', 'loopResultType'],
    ['loopResultKey', 'loopResultKey'],
    ['loop_result_key', 'loopResultKey'],
    ['loopResultValue', 'loopResultValue'],
    ['loop_result_value', 'loopResultValue'],
  ];
  for (const [src, dst] of map) {
    if (src in value) {
      result[dst] = value[src];
    }
  }
  if (Object.keys(result).length === 0) {
    return undefined;
  }
  if (result['loopEndNode'] === undefined) {
    result['loopEndNode'] = nodeId;
  }
  if (result['loopStartNode'] === undefined) {
    result['loopStartNode'] = result['loopEndNode'];
  }
  return result as unknown as WorkflowLoopConfig;
}

function normalizeRuntimeConfig(value: unknown): RecipeDefinition['runtime'] | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  let result: NonNullable<RecipeDefinition['runtime']> | undefined;
  const timeout = typeof value.timeout === 'number' ? value.timeout : undefined;
  const incremental = typeof value.incremental === 'boolean' ? value.incremental : undefined;
  const persistenceRaw = asJsonObject(value.persistence);
  const checkpoint = typeof persistenceRaw?.checkpoint === 'boolean' ? persistenceRaw.checkpoint : undefined;
  const persistence = checkpoint === undefined ? undefined : { checkpoint };
  const defaultRetryRaw = value.defaultRetry ?? value.default_retry;
  const defaultRetry = normalizeRetry(typeof defaultRetryRaw === 'object' && defaultRetryRaw !== null ? defaultRetryRaw : undefined, undefined);
  const controlPolicyRaw = value.controlPolicy ?? value.control_policy;
  let controlPolicy: NonNullable<RecipeDefinition['runtime']>['controlPolicy'] | undefined;
  if (isRecord(controlPolicyRaw)) {
    const legacyFields = ['resume', 'modify', 'restart', 'strategy', 'rollbackNode', 'rollback_node'];
    for (const legacyField of legacyFields) {
      if (controlPolicyRaw[legacyField] !== undefined) {
        throw new Error(`controlPolicy.${legacyField} is deprecated and not supported; use controlPolicy.cancel`);
      }
    }
    const cancelRaw = controlPolicyRaw.cancel;
    if (isRecord(cancelRaw)) {
      const rollbackNode: Record<string, { condition?: string }> = {};
      for (const [nodeId, branchRaw] of Object.entries(cancelRaw)) {
        if (typeof nodeId !== 'string' || nodeId.length === 0) {
          throw new Error('controlPolicy.cancel rollback node id must be a non-empty string');
        }
        const condition = isRecord(branchRaw) && typeof branchRaw.condition === 'string' ? branchRaw.condition : undefined;
        rollbackNode[nodeId] = condition === undefined ? {} : { condition };
      }
      if (Object.keys(rollbackNode).length > 0) {
        const cancelTimeoutRaw = controlPolicyRaw.cancelTimeout ?? controlPolicyRaw.cancel_timeout;
        const cancelTimeout =
          typeof cancelTimeoutRaw === 'number' && Number.isInteger(cancelTimeoutRaw) && cancelTimeoutRaw >= 1 ? cancelTimeoutRaw : undefined;
        if (cancelTimeoutRaw !== undefined && cancelTimeout === undefined) {
          throw new Error('controlPolicy.cancelTimeout must be a positive integer (seconds)');
        }
        controlPolicy = {
          cancel: { rollbackNode },
          ...(cancelTimeout === undefined ? {} : { cancelTimeout }),
        };
      }
    }
  }
  if (timeout !== undefined || incremental !== undefined || persistence !== undefined || defaultRetry !== undefined || controlPolicy !== undefined) {
    result = {
      ...(timeout === undefined ? {} : { timeout }),
      ...(incremental === undefined ? {} : { incremental }),
      ...(persistence === undefined ? {} : { persistence }),
      ...(defaultRetry === undefined ? {} : { defaultRetry }),
      ...(controlPolicy === undefined ? {} : { controlPolicy }),
    };
  }
  return result;
}

function validateLoopConfigs(recipe: RecipeDefinition): string | undefined {
  for (const [nodeId, node] of Object.entries(recipe.flowGraph.nodes)) {
    if (node.loopConfig === undefined) {
      continue;
    }
    const lc = node.loopConfig;
    if (lc.loopEndNode !== undefined && lc.loopEndNode !== nodeId) {
      return `loopConfig.loopEndNode must equal the configuring node id at ${nodeId}`;
    }
    if (lc.loopStartNode !== undefined && !(lc.loopStartNode in recipe.flowGraph.nodes)) {
      return `loopConfig.loopStartNode does not exist at ${nodeId}`;
    }
  }
  return undefined;
}
