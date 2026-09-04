import {
  brand,
  deriveCapabilityInvocationIdempotencyKey,
  type CapabilityId,
  type JsonObject,
  type LongTermMemoryId,
  type MemoryCategory,
  type SafeError,
} from '@nextagent/agent-common';
import type {
  CapabilityDescriptor,
  CapabilityProviderIdentity,
  CapabilityProvider,
  ExecutableTool,
  ToolCatalogConfig,
  ToolConfig,
  ToolDefinition,
  ToolDependencies,
  ToolExecuteOptions,
  ToolExecutableDiscovery,
  ToolMetadata,
} from '@nextagent/agent-contracts/capability';
import type {
  LongTermMemoryRecord,
  SaveLongTermMemoryRequest,
  SearchItem,
  SearchItemPage,
  SearchLongTermMemoryQuery,
  VersionedWriteOptions,
} from '@nextagent/agent-contracts/gateway';
import {
  parseMemoryContent,
  parseMemorySource,
  serializeMemoryContent,
  serializeMemorySource,
  type MemoryContentByCategory,
  type UserCharacteristicsPurpose,
} from './memory-data.js';

type MemoryToolExecutionResult = Awaited<ReturnType<ToolDefinition['tool']['execute']>>;

const memoryCategories = ['FACTUAL', 'CONCEPTUAL', 'PROCEDURAL', 'USER_CHARACTERISTICS'] as const;
const userCharacteristicsPurposes = ['PERSONALIZATION', 'TROUBLESHOOTING', 'WORKFLOW_ADAPTATION', 'GENERAL'] as const;
const maxBriefIndexChars = 100;
const memoryToolDescriptionMaxLength = 512;

export const memoryToolsProviderId = 'memory-tools';
export const memoryToolsProvider: CapabilityProviderIdentity = { providerId: memoryToolsProviderId, providerKind: 'BUNDLED' };
export const searchMemoryCapabilityId = brand<string, 'CapabilityId'>('search_memory');
export const getMemoryDetailCapabilityId = brand<string, 'CapabilityId'>('get_memory_detail');
export const addMemoryCapabilityId = brand<string, 'CapabilityId'>('add_memory');

export type MemoryConfigurationMetricOutcome = 'success' | 'failure' | 'disabled' | 'degraded';

export interface MemoryToolDescriptionOverrideDiagnostic {
  readonly issueCode: 'MEMORY_DESCRIPTION_OVERRIDE_REJECTED' | 'MEMORY_DESCRIPTION_OVERRIDE_APPLIED' | 'MEMORY_DESCRIPTION_TRUNCATED';
  readonly observationOutcome: 'success' | 'degraded';
  readonly metricOutcome: MemoryConfigurationMetricOutcome;
  readonly capabilityId?: string;
  readonly safeMessage: string;
}

export interface MemoryToolsRegistrationProjection {
  readonly optedIn: boolean;
  readonly config: ToolCatalogConfig;
  readonly descriptionDiagnostics: readonly MemoryToolDescriptionOverrideDiagnostic[];
}

export interface MemoryToolsRegistrationAssemblyInput {
  readonly capabilityBindings: readonly MemoryToolsRegistrationBindingInput[];
}

export interface MemoryToolsRegistrationBindingInput {
  readonly capabilityId: CapabilityId | string;
  readonly capabilityType: string;
  readonly providerId: string;
  readonly enabled?: boolean;
  readonly description?: string;
}

export interface LongTermMemoryToolSearchQuery extends SearchLongTermMemoryQuery {
  readonly purpose?: UserCharacteristicsPurpose;
}

export interface LongTermMemoryToolPort {
  searchLongTermMemory: (query: LongTermMemoryToolSearchQuery, signal?: AbortSignal) => Promise<SearchItemPage | SafeError>;
  getLongTermMemoryDetail: (
    request: Pick<SearchLongTermMemoryQuery, 'tenantId' | 'subjectId' | 'agentId'> & { readonly memoryId: LongTermMemoryId },
    signal?: AbortSignal,
  ) => Promise<LongTermMemoryRecord | SafeError>;
  saveLongTermMemory: (
    request: SaveLongTermMemoryRequest,
    options?: VersionedWriteOptions,
    signal?: AbortSignal,
  ) => Promise<LongTermMemoryRecord | SafeError>;
}

export function createMemoryToolDefinitions(port: LongTermMemoryToolPort): readonly ToolDefinition[] {
  return [searchMemoryToolDefinition(port), getMemoryDetailToolDefinition(port), addMemoryToolDefinition(port)];
}

export function createMemoryToolsProvider(
  port: LongTermMemoryToolPort,
  options: { readonly config?: ToolCatalogConfig; readonly dependencies?: ToolDependencies; readonly enabled?: boolean } = {},
): CapabilityProvider {
  return {
    identity: memoryToolsProvider,
    discovery: new MemoryToolDiscovery(createMemoryToolDefinitions(port), options.config, options.dependencies, options.enabled ?? true),
  };
}

export function projectMemoryToolsRegistration(input: {
  readonly assembly: MemoryToolsRegistrationAssemblyInput;
  readonly registered: boolean;
}): MemoryToolsRegistrationProjection {
  const enabledBindings = new Set(
    input.assembly.capabilityBindings
      .filter((binding) => binding.capabilityType === 'TOOL' && binding.providerId === memoryToolsProviderId && binding.enabled !== false)
      .map((binding) => String(binding.capabilityId)),
  );
  const optedIn = [searchMemoryCapabilityId, getMemoryDetailCapabilityId, addMemoryCapabilityId].every((capabilityId) =>
    enabledBindings.has(String(capabilityId)),
  );
  const registered = input.registered && optedIn;
  const tools: Record<string, { safeDescriptionOverride?: string }> = {};
  const descriptionDiagnostics: MemoryToolDescriptionOverrideDiagnostic[] = [];
  for (const binding of input.assembly.capabilityBindings) {
    if (binding.description === undefined) {
      continue;
    }
    const isEnabledMemoryTool =
      binding.capabilityType === 'TOOL' &&
      binding.providerId === memoryToolsProviderId &&
      binding.enabled !== false &&
      isMemoryToolCapabilityId(String(binding.capabilityId));
    if (!isEnabledMemoryTool || !registered) {
      descriptionDiagnostics.push({
        issueCode: 'MEMORY_DESCRIPTION_OVERRIDE_REJECTED',
        observationOutcome: 'degraded',
        metricOutcome: 'degraded',
        safeMessage: registered
          ? 'Capability description override was rejected because it is only supported for enabled memory tools.'
          : 'Capability description override was rejected because memory tools are not registered.',
      });
      continue;
    }
    const capabilityId = String(binding.capabilityId);
    const description = binding.description.trim();
    if (description.length > memoryToolDescriptionMaxLength) {
      descriptionDiagnostics.push({
        issueCode: 'MEMORY_DESCRIPTION_TRUNCATED',
        observationOutcome: 'degraded',
        metricOutcome: 'degraded',
        capabilityId,
        safeMessage: 'Memory Tool description override was truncated to the Tool description limit.',
      });
      tools[capabilityId] = { safeDescriptionOverride: description.slice(0, memoryToolDescriptionMaxLength) };
      continue;
    }
    descriptionDiagnostics.push({
      issueCode: 'MEMORY_DESCRIPTION_OVERRIDE_APPLIED',
      observationOutcome: 'success',
      metricOutcome: 'success',
      capabilityId,
      safeMessage: 'Memory Tool description override was applied.',
    });
    tools[capabilityId] = { safeDescriptionOverride: description };
  }
  return { optedIn, config: { tools }, descriptionDiagnostics };
}

class MemoryToolDiscovery implements ToolExecutableDiscovery {
  readonly provider = memoryToolsProvider;
  readonly discoveryMode = 'EAGER' as const;
  private readonly descriptors: readonly CapabilityDescriptor[];
  private readonly executables: ReadonlyMap<string, ExecutableTool>;

  constructor(tools: readonly ToolDefinition[], config: ToolCatalogConfig | undefined, dependencies: ToolDependencies | undefined, enabled: boolean) {
    assertKnownMemoryToolConfig(tools, config);
    assertUniqueMemoryToolNames(tools);
    if (!enabled) {
      this.descriptors = [];
      this.executables = new Map();
      return;
    }
    const descriptorEntries: CapabilityDescriptor[] = [];
    const executableEntries: Array<[string, ExecutableTool]> = [];
    for (const definition of tools) {
      const configured = configureMemoryTool(definition, config?.tools?.[definition.metadata.name], dependencies);
      descriptorEntries.push(configured.descriptor);
      if (configured.executable !== undefined) {
        executableEntries.push([memoryToolKey(definition.metadata.name), configured.executable]);
      }
    }
    this.descriptors = descriptorEntries;
    this.executables = new Map(executableEntries);
  }

  async listAll(_signal: AbortSignal): Promise<readonly CapabilityDescriptor[]> {
    return this.descriptors;
  }

  async resolve(capabilityId: CapabilityId, _signal: AbortSignal): Promise<CapabilityDescriptor | undefined> {
    return this.descriptors.find((descriptor) => descriptor.capabilityId === capabilityId);
  }

  resolveExecutable(capabilityId: CapabilityId): ExecutableTool | undefined {
    return this.executables.get(memoryToolKey(capabilityId));
  }
}

function configureMemoryTool(
  definition: ToolDefinition,
  config?: ToolConfig,
  dependencies?: ToolDependencies,
): { readonly descriptor: CapabilityDescriptor; readonly executable?: ExecutableTool } {
  const metadata = definition.metadata;
  const description = readSafeDescription(metadata.description, config?.safeDescriptionOverride);
  const unavailable = (reason: string): { readonly descriptor: CapabilityDescriptor } => ({
    descriptor: projectMemoryToolDescriptor(metadata, description, 'UNAVAILABLE', reason),
  });
  if (!hasRequiredDependencies(metadata, dependencies)) {
    return unavailable('TOOL_DEPENDENCY_MISSING');
  }
  const toolConfig = config?.config ?? {};
  if (!isMemoryToolConfigValid(metadata, toolConfig)) {
    return unavailable('TOOL_CONFIG_INVALID');
  }
  try {
    const tool = definition.tool.configure === undefined ? definition.tool : definition.tool.configure(toolConfig, dependencies);
    return {
      descriptor: projectMemoryToolDescriptor(metadata, description, 'AVAILABLE'),
      executable: { metadata, tool, ...(dependencies === undefined ? {} : { deps: dependencies }) },
    };
  } catch {
    return unavailable('TOOL_CONFIG_INVALID');
  }
}

function projectMemoryToolDescriptor(
  metadata: ToolMetadata,
  description: string,
  availabilityStatus: CapabilityDescriptor['availabilityStatus'],
  availabilityReason?: string,
): CapabilityDescriptor {
  return {
    capabilityId: metadata.name,
    kind: 'TOOL',
    provider: memoryToolsProvider,
    version: '1',
    displayName: metadata.displayName ?? metadata.name,
    ...(metadata.locales === undefined ? {} : { locales: metadata.locales }),
    description,
    modelInvocable: true,
    availabilityStatus,
    ...(availabilityReason === undefined ? {} : { availabilityReason }),
    ...(metadata.disclosurePolicy === undefined ? {} : { disclosurePolicy: metadata.disclosurePolicy }),
    inputSchema: metadata.inputSchema,
    outputSchema: metadata.outputSchema,
    replayPolicy: metadata.replayPolicy ?? 'NON_IDEMPOTENT',
  };
}

function assertKnownMemoryToolConfig(tools: readonly ToolDefinition[], config?: ToolCatalogConfig): void {
  const toolNames = new Set(tools.map((tool) => tool.metadata.name));
  for (const configuredName of Object.keys(config?.tools ?? {})) {
    if (!toolNames.has(configuredName as CapabilityId)) {
      throw new Error('Unknown memory Tool configuration.');
    }
  }
}

function assertUniqueMemoryToolNames(tools: readonly ToolDefinition[]): void {
  const names = new Set<string>();
  for (const definition of tools) {
    if (names.has(definition.metadata.name)) {
      throw new Error(`Duplicate memory Tool name for provider ${memoryToolsProvider.providerId}.`);
    }
    names.add(definition.metadata.name);
  }
}

function readSafeDescription(defaultDescription: string, override?: string): string {
  const candidate = override?.trim();
  return candidate === undefined || candidate.length === 0 ? defaultDescription : candidate.slice(0, memoryToolDescriptionMaxLength);
}

function hasRequiredDependencies(metadata: ToolMetadata, dependencies?: ToolDependencies): boolean {
  return (metadata.requiredDependencies ?? []).every((dependency) => dependencies?.[dependency] !== undefined);
}

function isMemoryToolConfigValid(metadata: ToolMetadata, config: JsonObject): boolean {
  return metadata.configSchema === undefined ? Object.keys(config).length === 0 : true;
}

function memoryToolKey(capabilityId: CapabilityId): string {
  return `${memoryToolsProvider.providerId}:${capabilityId}`;
}

function isMemoryToolCapabilityId(capabilityId: string): boolean {
  return capabilityId === searchMemoryCapabilityId || capabilityId === getMemoryDetailCapabilityId || capabilityId === addMemoryCapabilityId;
}

function searchMemoryToolDefinition(port: LongTermMemoryToolPort): ToolDefinition {
  return {
    metadata: {
      name: searchMemoryCapabilityId,
      ...memoryToolPresentation('Search long-term memory', '检索长期记忆'),
      description:
        "Search the current user's ACTIVE long-term memory. See the memory strategy section for when to recall. Returns L1 summaries only; call get_memory_detail for full content.\n\nParameter guidance:\n- If the memory category is uncertain, make exactly one broad search without categoryFilter. Do not fan out by calling this once per category.\n- Use categoryFilter only when the user request clearly names a fact, concept, procedure, or user trait, or after one broad search is too noisy.\n- Do NOT use categoryFilter when the query spans multiple categories or the user's intent is exploratory.\n- categoryFilter=USER_CHARACTERISTICS requires a purpose field to filter effectively; omitting purpose returns all user traits.",
      inputSchema: searchMemoryInputSchema,
      outputSchema: searchMemoryOutputSchema,
      returnsCapabilityResult: true,
      replayPolicy: 'IDEMPOTENT',
      observability: memoryToolObservability,
    },
    tool: {
      async execute(input, options) {
        const context = options?.context;
        if (context === undefined) {
          return failedResult('MEMORY_TOOL_INVALID_TRIGGER', 'INTERNAL', false);
        }
        const typed = input as unknown as SearchMemoryInput;
        return executeWithBudget(options, async (signal) => {
          const effectivePurpose = typed.categoryFilter === 'USER_CHARACTERISTICS' ? typed.purpose : undefined;
          const result = await port.searchLongTermMemory(
            {
              tenantId: context.identityContext.tenantId,
              subjectId: context.identityContext.subjectId,
              agentId: context.agentId,
              queryText: typed.queryText ?? '',
              ...(typed.categoryFilter === undefined ? {} : { memoryType: typed.categoryFilter }),
              ...(effectivePurpose === undefined ? {} : { purpose: effectivePurpose }),
              minConfidence: typed.minConfidence ?? 0.3,
              limit: typed.limit ?? 20,
              offset: typed.offset ?? 0,
            },
            signal,
          );
          if (isSafeError(result)) {
            return failedFromSafeError(mapMemorySafeError(result, 'query'));
          }
          const payload = {
            entries: result.items.map((entry) => projectSearchEntry(entry, effectivePurpose)),
            totalCount: result.total,
            limit: typed.limit ?? 20,
            offset: typed.offset ?? 0,
          };
          return succeeded(payload);
        });
      },
    },
  };
}

function getMemoryDetailToolDefinition(port: LongTermMemoryToolPort): ToolDefinition {
  return {
    metadata: {
      name: getMemoryDetailCapabilityId,
      ...memoryToolPresentation('View memory details', '查看记忆详情'),
      description:
        'Fetch full L2 details for long-term memory entries returned by search_memory. Pass up to 20 longTermMemoryIds. Returns per-entry results with full structured fields such as procedural text or conceptual definitions.',
      inputSchema: getMemoryDetailInputSchema,
      outputSchema: getMemoryDetailOutputSchema,
      returnsCapabilityResult: true,
      replayPolicy: 'IDEMPOTENT',
      observability: memoryToolObservability,
    },
    tool: {
      async execute(input, options) {
        const context = options?.context;
        if (context === undefined) {
          return failedResult('MEMORY_TOOL_INVALID_TRIGGER', 'INTERNAL', false);
        }
        const typed = input as unknown as GetMemoryDetailInput;
        return executeWithBudget(options, async (signal) => {
          const results = [];
          const sourceTrace: JsonObject[] = [];
          for (const longTermMemoryId of typed.longTermMemoryIds) {
            const result = await port.getLongTermMemoryDetail(
              {
                tenantId: context.identityContext.tenantId,
                subjectId: context.identityContext.subjectId,
                agentId: context.agentId,
                memoryId: brand<string, 'LongTermMemoryId'>(longTermMemoryId),
              },
              signal,
            );
            if (isSafeError(result)) {
              const safeError = mapMemorySafeError(result, 'detail');
              if (safeError.category !== 'NOT_FOUND') {
                return failedFromSafeError(safeError);
              }
              results.push({ longTermMemoryId, error: safeErrorPayload(safeError) });
              continue;
            }
            results.push({ longTermMemoryId, entry: projectDetailEntry(result) });
            const source = parseMemorySource(result.source);
            if (source !== undefined) {
              sourceTrace.push({ longTermMemoryId, source: source as unknown as JsonObject });
            }
          }
          return succeeded({ results }, sourceTrace.length === 0 ? undefined : { sourceTrace });
        });
      },
    },
  };
}

function addMemoryToolDefinition(port: LongTermMemoryToolPort): ToolDefinition {
  return {
    metadata: {
      name: addMemoryCapabilityId,
      ...memoryToolPresentation('Save long-term memory', '保存长期记忆'),
      description:
        'Add a new ACTIVE long-term memory. See the memory strategy section for when to save.\n\nContent format by category:\n- FACTUAL → subject (string) + claim (string) + optional evidence (string[]) + optional qualifiers (string[])\n- CONCEPTUAL → concept (string) + definition (string) + optional aliases (string[]) + optional relatedConcepts (string[])\n- PROCEDURAL → procedureName (string) + procedureText (string)\n- USER_CHARACTERISTICS → traits (string[]) + purpose (string[])',
      inputSchema: addMemoryInputSchema,
      outputSchema: addMemoryOutputSchema,
      returnsCapabilityResult: true,
      replayPolicy: 'NON_IDEMPOTENT',
      observability: memoryToolObservability,
    },
    tool: {
      async execute(input, options) {
        const context = options?.context;
        if (context === undefined) {
          return failedResult('MEMORY_TOOL_INVALID_TRIGGER', 'INTERNAL', false);
        }
        const typed = input as unknown as AddMemoryInput;
        const normalized = normalizeAddMemoryContent(typed.category, typed.content, typed.briefIndex);
        if (normalized === undefined) {
          return failedResult('MEMORY_TOOL_WRITE_INVALID', 'VALIDATION', false, addMemoryContentSafeDetails(typed.category, typed.content));
        }
        const briefIndex = truncateBriefIndex(typed.briefIndex ?? deriveBriefIndex(normalized));
        return executeWithBudget(options, async (signal) => {
          const result = await port.saveLongTermMemory(
            {
              tenantId: context.identityContext.tenantId,
              subjectId: context.identityContext.subjectId,
              agentId: context.agentId,
              memoryType: typed.category,
              knowledgeSourceType: 'LEARNED',
              content: serializeMemoryContent(normalized),
              confidence: typed.confidence ?? 0.5,
              ...(typed.tags === undefined ? {} : { labels: typed.tags }),
              briefIndex: briefIndex.value,
              source: serializeMemorySource({
                sessionId: context.sessionId,
                requestId: context.requestId,
                runId: context.runId,
                messageRefs: [context.requestId],
                refs: [
                  {
                    sessionId: context.sessionId,
                    rootMessageId: context.requestId,
                    runId: context.runId,
                    messageRefs: [context.requestId],
                  },
                ],
              }),
            },
            { idempotencyKey: deriveCapabilityInvocationIdempotencyKey(context.runId, context.toolCallId) },
            signal,
          );
          if (isSafeError(result)) {
            return failedFromSafeError(mapMemorySafeError(result, 'write'));
          }
          return succeeded({
            longTermMemoryId: result.memoryId,
            state: result.state,
            briefIndexTruncated: briefIndex.truncated,
            createdAt: result.createTime,
            outcome: 'CREATED_ACTIVE',
            nextAction: 'ACKNOWLEDGE_USER_DO_NOT_CALL_ADD_MEMORY_AGAIN',
          });
        });
      },
    },
  };
}

function memoryToolPresentation(displayName: string, zhName: string): Pick<ToolMetadata, 'displayName' | 'locales'> {
  return {
    displayName,
    locales: { language: { 'zh-CN': { displayName: zhName }, 'en-US': { displayName } } },
  };
}

interface SearchMemoryInput {
  readonly queryText?: string;
  readonly categoryFilter?: MemoryCategory;
  readonly purpose?: UserCharacteristicsPurpose;
  readonly minConfidence?: number;
  readonly limit?: number;
  readonly offset?: number;
}

interface GetMemoryDetailInput {
  readonly longTermMemoryIds: readonly string[];
}

interface AddMemoryInput {
  readonly category: MemoryCategory;
  readonly content: MemoryContentByCategory | JsonObject | string;
  readonly tags?: readonly string[];
  readonly briefIndex?: string;
  readonly confidence?: number;
}

const safeString = { type: 'string', minLength: 1, maxLength: 2048 } as const;
const stringArray = {
  type: 'array',
  minItems: 1,
  maxItems: 50,
  items: safeString,
} as const;
const optionalStringArray = {
  type: 'array',
  maxItems: 50,
  items: safeString,
} as const;
const memoryCategorySchema = { enum: memoryCategories } as const;
const purposeSchema = { enum: userCharacteristicsPurposes } as const;

const searchMemoryInputSchema: JsonObject = {
  type: 'object',
  additionalProperties: false,
  properties: {
    queryText: {
      type: 'string',
      maxLength: 512,
      description:
        'Optional natural-language keyword query. Omit it (with categoryFilter set) to list every ACTIVE entry of that category for the current user — use this to load a category such as USER_CHARACTERISTICS up front instead of keyword-searching. When provided, only entries whose content contains the query words are returned, so do not pass a generic word (e.g. "preferences") when you want the whole category.',
    },
    categoryFilter: {
      ...memoryCategorySchema,
      description: 'Optional precision filter. Omit when the memory category is uncertain; do not issue parallel searches over categories.',
    },
    purpose: {
      ...purposeSchema,
      description: 'Only use with categoryFilter=USER_CHARACTERISTICS. Ignored for other categories.',
    },
    minConfidence: {
      type: 'number',
      minimum: 0,
      maximum: 1,
      description: 'Optional confidence threshold. Omit unless the user explicitly asks for high-confidence memory.',
    },
    limit: { type: 'integer', minimum: 1, maximum: 100, description: 'Maximum number of L1 memory results. Omit to use the default.' },
    offset: { type: 'integer', minimum: 0, maximum: 10000, description: 'Pagination offset. Omit for the first search.' },
  },
};

const getMemoryDetailInputSchema: JsonObject = {
  type: 'object',
  additionalProperties: false,
  required: ['longTermMemoryIds'],
  properties: {
    longTermMemoryIds: {
      type: 'array',
      minItems: 1,
      maxItems: 20,
      items: { type: 'string', minLength: 1, maxLength: 128 },
    },
  },
};

const factualContentSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['category', 'subject', 'claim'],
  properties: {
    category: { const: 'FACTUAL' },
    subject: safeString,
    claim: safeString,
    evidence: optionalStringArray,
    qualifiers: optionalStringArray,
  },
} as const;
const conceptualContentSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['category', 'concept', 'definition'],
  properties: {
    category: { const: 'CONCEPTUAL' },
    concept: safeString,
    definition: safeString,
    aliases: optionalStringArray,
    relatedConcepts: optionalStringArray,
  },
} as const;
const proceduralContentSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['category', 'procedureName', 'procedureText'],
  properties: {
    category: { const: 'PROCEDURAL' },
    procedureName: safeString,
    procedureText: safeString,
  },
} as const;
const userCharacteristicsContentSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['category', 'traits', 'purpose'],
  properties: {
    category: { const: 'USER_CHARACTERISTICS' },
    traits: stringArray,
    purpose: {
      type: 'array',
      minItems: 1,
      maxItems: 4,
      items: purposeSchema,
    },
  },
} as const;

const memoryContentSchema = {
  anyOf: [factualContentSchema, conceptualContentSchema, proceduralContentSchema, userCharacteristicsContentSchema],
} as const;

const addMemoryInputSchema: JsonObject = {
  type: 'object',
  additionalProperties: false,
  required: ['category', 'content'],
  properties: {
    category: memoryCategorySchema,
    content: {
      anyOf: [
        { type: 'object', additionalProperties: true },
        { type: 'string', minLength: 1, maxLength: 2048 },
      ],
    },
    tags: { type: 'array', maxItems: 20, items: { type: 'string', minLength: 1, maxLength: 64 } },
    briefIndex: { type: 'string', minLength: 1, maxLength: 512 },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
  },
};

const safeErrorPayloadSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['code', 'category', 'retryable'],
  properties: {
    code: { type: 'string', minLength: 1, maxLength: 128 },
    category: { enum: ['VALIDATION', 'AUTHORIZATION', 'POLICY_DENIED', 'UNAVAILABLE', 'TIMEOUT', 'CANCELED', 'CONFLICT', 'NOT_FOUND', 'INTERNAL'] },
    retryable: { type: 'boolean' },
    message: { type: 'string', maxLength: 256 },
    safeDetails: { type: 'object' },
  },
} as const;

const l1EntrySchema = {
  type: 'object',
  additionalProperties: false,
  required: ['longTermMemoryId', 'category', 'confidence', 'tags', 'briefIndex', 'createdAt', 'hybridScore'],
  properties: {
    longTermMemoryId: { type: 'string', minLength: 1 },
    category: memoryCategorySchema,
    confidence: { type: 'number', minimum: 0, maximum: 1 },
    tags: { type: 'array', items: { type: 'string' } },
    briefIndex: { type: 'string' },
    createdAt: { type: 'number' },
    hybridScore: { type: 'number' },
    traitName: { type: 'string' },
    lastUpdatedAt: { type: 'number' },
  },
} as const;

const emptyResultSchema = {
  type: 'object',
  additionalProperties: false,
  maxProperties: 0,
} as const;

const searchMemoryOutputSchema: JsonObject = {
  anyOf: [
    {
      type: 'object',
      additionalProperties: false,
      required: ['entries', 'totalCount', 'limit', 'offset'],
      properties: {
        entries: { type: 'array', items: l1EntrySchema },
        totalCount: { type: 'integer', minimum: 0 },
        limit: { type: 'integer', minimum: 1, maximum: 100 },
        offset: { type: 'integer', minimum: 0 },
      },
    },
    emptyResultSchema,
  ],
};

const detailEntrySchema = {
  type: 'object',
  additionalProperties: false,
  required: ['longTermMemoryId', 'version', 'category', 'confidence', 'state', 'tags', 'briefIndex', 'content', 'createdAt', 'updatedAt'],
  properties: {
    longTermMemoryId: { type: 'string', minLength: 1 },
    version: { type: 'integer', minimum: 1 },
    category: memoryCategorySchema,
    confidence: { type: 'number', minimum: 0, maximum: 1 },
    state: { enum: ['ACTIVE', 'ARCHIVED'] },
    tags: { type: 'array', items: { type: 'string' } },
    briefIndex: { type: 'string' },
    content: memoryContentSchema,
    createdAt: { type: 'number' },
    updatedAt: { type: 'number' },
    lastAccessedAt: { type: 'number' },
    archivedAt: { type: 'number' },
    archiveReason: { type: 'string' },
    isPinned: { type: 'boolean' },
  },
} as const;

const getMemoryDetailOutputSchema: JsonObject = {
  anyOf: [
    {
      type: 'object',
      additionalProperties: false,
      required: ['results'],
      properties: {
        results: {
          type: 'array',
          maxItems: 20,
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['longTermMemoryId'],
            properties: {
              longTermMemoryId: { type: 'string', minLength: 1 },
              entry: detailEntrySchema,
              error: safeErrorPayloadSchema,
            },
          },
        },
      },
    },
    emptyResultSchema,
  ],
};

const addMemoryOutputSchema: JsonObject = {
  anyOf: [
    {
      type: 'object',
      additionalProperties: false,
      required: ['longTermMemoryId', 'state', 'briefIndexTruncated', 'createdAt', 'outcome', 'nextAction'],
      properties: {
        longTermMemoryId: { type: 'string', minLength: 1 },
        state: { const: 'ACTIVE' },
        briefIndexTruncated: { type: 'boolean' },
        createdAt: { type: 'number' },
        outcome: { const: 'CREATED_ACTIVE' },
        nextAction: { const: 'ACKNOWLEDGE_USER_DO_NOT_CALL_ADD_MEMORY_AGAIN' },
      },
    },
    emptyResultSchema,
  ],
};

const memoryToolObservability = {
  safeCompletionDiagnostics(input: { readonly status: string; readonly structuredPayload: JsonObject }) {
    return [
      { key: 'toolResultStatus' as const, value: input.status },
      { key: 'reasonCode' as const, value: input.status },
    ];
  },
};

function normalizeAddMemoryContent(
  category: MemoryCategory,
  content: MemoryContentByCategory | JsonObject | string,
  briefIndex?: string,
): MemoryContentByCategory | undefined {
  if (typeof content === 'string') {
    return normalizeStringMemoryContent(category, content, briefIndex);
  }
  const normalized = normalizeStructuredMemoryContent(category, content);
  if (normalized === undefined || !isValidMemoryContentShape(normalized)) {
    return undefined;
  }
  return normalized;
}

function normalizeStringMemoryContent(category: MemoryCategory, content: string, briefIndex?: string): MemoryContentByCategory | undefined {
  const trimmed = content.trim();
  if (trimmed.length === 0) {
    return undefined;
  }
  const parsed = parseJsonObjectString(trimmed);
  if (parsed !== undefined) {
    return normalizeAddMemoryContent(category, parsed, briefIndex);
  }
  if (category === 'FACTUAL') {
    return { category: 'FACTUAL', subject: trimmed, claim: trimmed };
  }
  if (category === 'PROCEDURAL') {
    return { category: 'PROCEDURAL', procedureName: deriveProcedureNameFromText(trimmed, briefIndex), procedureText: trimmed };
  }
  if (category === 'USER_CHARACTERISTICS') {
    return { category: 'USER_CHARACTERISTICS', traits: [trimmed], purpose: ['GENERAL'] };
  }
  return undefined;
}

function parseJsonObjectString(value: string): JsonObject | undefined {
  if (!value.startsWith('{') || !value.endsWith('}')) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as JsonObject) : undefined;
  } catch {
    return undefined;
  }
}

function deriveProcedureNameFromText(content: string, briefIndex?: string): string {
  const brief = briefIndex?.trim();
  if (brief !== undefined && brief.length > 0) {
    return brief.slice(0, 2048);
  }
  const flowMatch = /(?:可复用流程|流程|procedure)\s*[:：]\s*([^。；;\n]+)/iu.exec(content);
  const name = flowMatch?.[1]?.trim() ?? content.split(/[。；;\n]/u)[0]?.trim() ?? content;
  return name.slice(0, 2048);
}

function normalizeStructuredMemoryContent(
  category: MemoryCategory,
  content: MemoryContentByCategory | JsonObject,
): MemoryContentByCategory | undefined {
  if (content === null || typeof content !== 'object' || Array.isArray(content)) {
    return undefined;
  }
  const rawCategory = (content as { readonly category?: unknown }).category;
  if (rawCategory !== undefined && rawCategory !== category) {
    return undefined;
  }
  switch (category) {
    case 'FACTUAL': {
      const claim =
        stringProperty(content, 'claim') ?? stringProperty(content, 'fact') ?? stringProperty(content, 'text') ?? stringProperty(content, 'value');
      const subject = stringProperty(content, 'subject') ?? claim;
      const evidence = optionalStringArrayProperty(content, 'evidence');
      const qualifiers = optionalStringArrayProperty(content, 'qualifiers');
      return claim === undefined || subject === undefined || evidence === false || qualifiers === false
        ? undefined
        : {
            category: 'FACTUAL',
            subject,
            claim,
            ...(evidence === undefined ? {} : { evidence }),
            ...(qualifiers === undefined ? {} : { qualifiers }),
          };
    }
    case 'CONCEPTUAL': {
      const concept = stringProperty(content, 'concept');
      const definition = stringProperty(content, 'definition');
      const aliases = optionalStringArrayProperty(content, 'aliases');
      const relatedConcepts = optionalStringArrayProperty(content, 'relatedConcepts');
      return concept === undefined || definition === undefined || aliases === false || relatedConcepts === false
        ? undefined
        : {
            category: 'CONCEPTUAL',
            concept,
            definition,
            ...(aliases === undefined ? {} : { aliases }),
            ...(relatedConcepts === undefined ? {} : { relatedConcepts }),
          };
    }
    case 'PROCEDURAL': {
      const procedureName = stringProperty(content, 'procedureName');
      const procedureText = stringProperty(content, 'procedureText') ?? legacyProcedureTextFromSteps(content);
      return procedureName === undefined || procedureText === undefined
        ? undefined
        : {
            category: 'PROCEDURAL',
            procedureName,
            procedureText,
          };
    }
    case 'USER_CHARACTERISTICS': {
      const traits = stringArrayProperty(content, 'traits');
      const purpose = userCharacteristicsPurposeArrayProperty(content, 'purpose');
      return traits === undefined || purpose === undefined
        ? undefined
        : {
            category: 'USER_CHARACTERISTICS',
            traits,
            purpose,
          };
    }
    default: {
      const exhaustive: never = category;
      throw new Error(`Unhandled case: ${String(exhaustive)}`);
    }
  }
}

function legacyProcedureTextFromSteps(content: object): string | undefined {
  const steps = stringArrayProperty(content, 'steps');
  return steps === undefined ? undefined : steps.join('; ');
}

function addMemoryContentSafeDetails(category: unknown, content: unknown): JsonObject {
  const normalizedCategory =
    typeof category === 'string' && memoryCategories.includes(category as MemoryCategory) ? (category as MemoryCategory) : undefined;
  if (normalizedCategory === undefined) {
    return { reasonCode: 'MEMORY_CONTENT_CATEGORY_INVALID' };
  }
  if (typeof content === 'string') {
    return normalizedCategory === 'USER_CHARACTERISTICS'
      ? { reasonCode: 'USER_CHARACTERISTICS_CONTENT_STRING_EMPTY' }
      : {
          reasonCode: `${normalizedCategory}_CONTENT_REQUIRES_STRUCTURED_OBJECT`,
          expectedFields: expectedContentFields(normalizedCategory),
        };
  }
  if (content === null || typeof content !== 'object') {
    return {
      reasonCode: `${normalizedCategory}_CONTENT_REQUIRES_STRUCTURED_OBJECT`,
      expectedFields: expectedContentFields(normalizedCategory),
    };
  }
  const contentCategory = (content as { readonly category?: unknown }).category;
  if (contentCategory !== undefined && contentCategory !== normalizedCategory) {
    return {
      reasonCode: 'MEMORY_CONTENT_CATEGORY_MISMATCH',
      expectedCategory: normalizedCategory,
      actualCategory:
        typeof contentCategory === 'string' && memoryCategories.includes(contentCategory as MemoryCategory) ? contentCategory : 'INVALID',
    };
  }
  return {
    reasonCode: `${normalizedCategory}_CONTENT_INVALID_SHAPE`,
    expectedFields: expectedContentFields(normalizedCategory),
  };
}

function stringProperty(content: object, key: string): string | undefined {
  const value = (content as Record<string, unknown>)[key];
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function stringArrayProperty(content: object, key: string): readonly string[] | undefined {
  const value = (content as Record<string, unknown>)[key];
  return isNonEmptyStringArray(value) ? value.map((item) => item.trim()) : undefined;
}

function optionalStringArrayProperty(content: object, key: string): readonly string[] | undefined | false {
  const value = (content as Record<string, unknown>)[key];
  if (value === undefined) {
    return undefined;
  }
  return isOptionalStringArray(value) ? value.map((item) => item.trim()) : false;
}

function userCharacteristicsPurposeArrayProperty(content: object, key: string): readonly UserCharacteristicsPurpose[] | undefined {
  const value = (content as Record<string, unknown>)[key];
  return Array.isArray(value) && value.length >= 1 && value.length <= 4 && value.every((item) => userCharacteristicsPurposes.includes(item))
    ? value
    : undefined;
}

function expectedContentFields(category: MemoryCategory): readonly string[] {
  switch (category) {
    case 'FACTUAL':
      return ['category', 'subject', 'claim'];
    case 'CONCEPTUAL':
      return ['category', 'concept', 'definition'];
    case 'PROCEDURAL':
      return ['category', 'procedureName', 'procedureText'];
    case 'USER_CHARACTERISTICS':
      return ['category', 'traits', 'purpose'];
    default: {
      const exhaustive: never = category;
      throw new Error(`Unhandled case: ${String(exhaustive)}`);
    }
  }
}

function isMemoryContent(value: unknown): value is MemoryContentByCategory {
  if (value === null || typeof value !== 'object' || !('category' in value)) {
    return false;
  }
  const content = value as { readonly category?: string };
  return memoryCategories.includes(content.category as MemoryCategory);
}

function isValidMemoryContentShape(content: MemoryContentByCategory): boolean {
  if (!isMemoryContent(content)) {
    return false;
  }
  switch (content.category) {
    case 'FACTUAL':
      return (
        isNonEmptyString(content.subject) &&
        isNonEmptyString(content.claim) &&
        isOptionalStringArray(content.evidence) &&
        isOptionalStringArray(content.qualifiers)
      );
    case 'CONCEPTUAL':
      return (
        isNonEmptyString(content.concept) &&
        isNonEmptyString(content.definition) &&
        isOptionalStringArray(content.aliases) &&
        isOptionalStringArray(content.relatedConcepts)
      );
    case 'PROCEDURAL':
      return isNonEmptyString(content.procedureName) && isNonEmptyString(content.procedureText);
    case 'USER_CHARACTERISTICS':
      return (
        isNonEmptyStringArray(content.traits) &&
        Array.isArray(content.purpose) &&
        content.purpose.length >= 1 &&
        content.purpose.length <= 4 &&
        content.purpose.every((item) => userCharacteristicsPurposes.includes(item))
      );
    default: {
      const exhaustive: never = content;
      throw new Error(`Unhandled case: ${String(exhaustive)}`);
    }
  }
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= 2048;
}

function isNonEmptyStringArray(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.length >= 1 && value.length <= 50 && value.every(isNonEmptyString);
}

function isOptionalStringArray(value: unknown): value is readonly string[] | undefined {
  return value === undefined || (Array.isArray(value) && value.length <= 50 && value.every(isNonEmptyString));
}

function deriveBriefIndex(content: MemoryContentByCategory): string {
  switch (content.category) {
    case 'FACTUAL':
      return content.subject === content.claim ? content.claim : `${content.subject}: ${content.claim}`;
    case 'CONCEPTUAL':
      return `${content.concept}: ${content.definition}`;
    case 'PROCEDURAL':
      return `${content.procedureName}: ${content.procedureText}`;
    case 'USER_CHARACTERISTICS':
      return content.traits.join('; ');
    default: {
      const exhaustive: never = content;
      throw new Error(`Unhandled case: ${String(exhaustive)}`);
    }
  }
}

function truncateBriefIndex(value: string): { readonly value: string; readonly truncated: boolean } {
  const trimmed = value.trim();
  if (trimmed.length <= maxBriefIndexChars) {
    return { value: trimmed, truncated: false };
  }
  return { value: trimmed.slice(0, maxBriefIndexChars), truncated: true };
}

function projectSearchEntry(entry: SearchItem, purpose?: UserCharacteristicsPurpose): JsonObject {
  const summary = entry.summary;
  return {
    longTermMemoryId: summary.memoryId,
    category: summary.memoryType,
    confidence: summary.confidence,
    tags: summary.labels,
    briefIndex: summary.briefIndex,
    createdAt: summary.createTime,
    hybridScore: entry.score,
    ...(summary.memoryType === 'USER_CHARACTERISTICS' && purpose !== undefined
      ? { traitName: summary.briefIndex, lastUpdatedAt: summary.updateTime }
      : {}),
  };
}

function projectDetailEntry(record: LongTermMemoryRecord): JsonObject {
  return {
    longTermMemoryId: record.memoryId,
    version: record.version,
    category: record.memoryType,
    confidence: record.confidence,
    state: record.state,
    tags: record.labels,
    briefIndex: record.briefIndex,
    content: (parseMemoryContent(record.content) ?? {}) as unknown as JsonObject,
    createdAt: record.createTime,
    updatedAt: record.updateTime,
    ...(record.lastAccessedAt === undefined ? {} : { lastAccessedAt: record.lastAccessedAt }),
    archivedAt: record.archivedAt,
    archiveReason: record.archiveReason,
    isPinned: record.isPinned,
  };
}

async function executeWithBudget(
  options: ToolExecuteOptions | undefined,
  operation: (signal: AbortSignal) => Promise<MemoryToolExecutionResult>,
): Promise<MemoryToolExecutionResult> {
  const context = options?.context;
  if (context === undefined) {
    return failedResult('MEMORY_TOOL_INVALID_TRIGGER', 'INTERNAL', false);
  }
  const signal = options?.signal;
  if (signal?.aborted === true) {
    return failedResult('MEMORY_TOOL_CANCELED', 'CANCELED', false);
  }
  const controller = new AbortController();
  const abortFromParent = () => controller.abort();
  signal?.addEventListener('abort', abortFromParent, { once: true });
  let timedOut = false;
  const timeout = setTimeout(
    () => {
      timedOut = true;
      controller.abort();
    },
    Math.max(1, context.timeoutMs),
  );
  try {
    return await Promise.race([
      operation(controller.signal),
      new Promise<MemoryToolExecutionResult>((resolve) => {
        controller.signal.addEventListener(
          'abort',
          () => {
            resolve(failedResult(timedOut ? 'MEMORY_TOOL_TIMEOUT' : 'MEMORY_TOOL_CANCELED', timedOut ? 'TIMEOUT' : 'CANCELED', timedOut));
          },
          { once: true },
        );
      }),
    ]);
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', abortFromParent);
  }
}

function succeeded(structuredPayload: JsonObject, metadata?: JsonObject): MemoryToolExecutionResult {
  return {
    status: 'SUCCEEDED',
    structuredPayload,
    generatedMessages: [],
    artifactRefs: [],
    ...(metadata === undefined ? {} : { metadata }),
  };
}

function failedResult(
  code: string,
  category: SafeError['category'],
  retryable: boolean,
  safeDetails?: JsonObject,
  message = memoryToolFailureMessage(code),
): MemoryToolExecutionResult {
  return {
    status: category === 'TIMEOUT' ? 'TIMED_OUT' : 'FAILED',
    structuredPayload: {},
    generatedMessages: [],
    artifactRefs: [],
    safeError: { code, message, category, retryable, ...(safeDetails === undefined ? {} : { safeDetails }) },
  };
}

function failedFromSafeError(error: SafeError): MemoryToolExecutionResult {
  return failedResult(error.code, error.category, error.retryable, error.safeDetails, error.message);
}

function mapMemorySafeError(error: SafeError, operation: 'query' | 'detail' | 'write'): SafeError {
  if (operation === 'query' && error.code === 'LTM_QUERY_INVALID') {
    return { ...error, code: 'MEMORY_TOOL_QUERY_INVALID' };
  }
  if (operation === 'write' && error.code === 'LTM_WRITE_INVALID') {
    return { ...error, code: 'MEMORY_TOOL_WRITE_INVALID' };
  }
  if (operation === 'detail' && error.category === 'NOT_FOUND') {
    return entryNotFoundSafeError();
  }
  return error;
}

function entryNotFoundSafeError(): SafeError {
  return {
    code: 'LTM_ENTRY_NOT_FOUND',
    message: 'Long-term memory entry was not found. Run search_memory to obtain a current entry id.',
    category: 'NOT_FOUND',
    retryable: false,
  };
}

function safeErrorPayload(error: SafeError): JsonObject {
  return {
    code: error.code,
    message: error.message,
    category: error.category,
    retryable: error.retryable,
    ...(error.safeDetails === undefined ? {} : { safeDetails: error.safeDetails }),
  };
}

function memoryToolFailureMessage(code: string): string {
  switch (code) {
    case 'MEMORY_TOOL_INVALID_TRIGGER':
      return 'Trusted memory invocation context is unavailable, so the memory operation has stopped. Continue using the current conversation context or end the memory action.';
    case 'MEMORY_TOOL_WRITE_INVALID':
      return 'Memory content does not satisfy the declared category contract. Correct the listed constraints before calling add_memory again.';
    case 'MEMORY_TOOL_CANCELED':
      return 'The memory operation was canceled.';
    case 'MEMORY_TOOL_TIMEOUT':
      return 'The memory operation timed out. Use the current context, try again later, or end the memory operation.';
    default:
      return 'The memory operation failed. Use the current context or end the memory operation.';
  }
}

function isSafeError(value: unknown): value is SafeError {
  return value !== null && typeof value === 'object' && 'code' in value && 'category' in value && 'retryable' in value;
}
