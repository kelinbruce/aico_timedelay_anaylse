import { brand, type CapabilityId, type JsonObject } from '@nextagent/agent-common';
import type { CapabilityDescriptor, CapabilityGeneratedMessage, CapabilityInvocationResult } from '@nextagent/agent-contracts/capability';

import { defineTool, type ToolExecuteOptions } from '../tools/tool-spi.js';
import { builtinToolPresentation } from './presentation-names.js';

export const toolSearchCapabilityId = brand<string, 'CapabilityId'>('ToolSearch');
export const toolSearchDefaultLimit = 20;
export const toolSearchMaxLimit = 100;
const toolSearchQueryMaxLength = 256;

export const toolSearchInputSchema: JsonObject = {
  type: 'object',
  additionalProperties: false,
  properties: {
    query: { type: 'string', maxLength: toolSearchQueryMaxLength },
    limit: { type: 'integer', minimum: 1, maximum: toolSearchMaxLimit },
    matchMode: { enum: ['keyword', 'natural'] },
    filters: {
      type: 'object',
      additionalProperties: {
        anyOf: [{ type: 'string', minLength: 1, maxLength: 128 }, { type: 'number' }, { type: 'boolean' }],
      },
      properties: {
        kind: { enum: ['TOOL', 'SKILL'] },
      },
    },
  },
};

export const toolSearchOutputSchema: JsonObject = {
  oneOf: [
    {
      type: 'object',
      additionalProperties: false,
      required: ['tools', 'truncated'],
      properties: {
        tools: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['capability_id', 'name', 'kind'],
            properties: {
              capability_id: { type: 'string', minLength: 1 },
              name: { type: 'string', minLength: 1 },
              kind: { enum: ['TOOL', 'SKILL'] },
              description: { type: 'string', minLength: 1 },
            },
          },
        },
        truncated: { type: 'boolean' },
      },
    },
    {
      type: 'object',
      additionalProperties: false,
    },
  ],
};

export const toolSearchToolDefinition = defineTool({
  name: toolSearchCapabilityId,
  ...builtinToolPresentation('ToolSearch'),
  description:
    'Discover governed, available, non-hidden deferred Tools and Skills that are not already exposed to the model. ToolSearch does not search Agents, Workflows, files, knowledge content, or memory, and it should not rediscover an already visible Tool or enabled Skill.\n\nQuery by capability id, task intent, or keywords; omit `query`, use an empty string, or use `*` to list a bounded candidate set. `filters.kind` accepts only TOOL or SKILL; other filter fields exactly match governed scalar metadata. Returned TOOL entries become callable on the next model step through allowedTools. Returned SKILL entries must next be invoked with Skill using the exact `capability_id`. Zero results is a valid search result, not evidence that another capability domain was searched.',
  inputSchema: toolSearchInputSchema,
  outputSchema: toolSearchOutputSchema,
  replayPolicy: 'IDEMPOTENT',
  returnsCapabilityResult: true,
  async execute(input, options) {
    return executeToolSearch(input, options);
  },
});

async function executeToolSearch(input: JsonObject, options?: ToolExecuteOptions): Promise<CapabilityInvocationResult> {
  const signal = options?.signal ?? new AbortController().signal;
  if (signal.aborted) {
    return failed('EXECUTION_FAILED', 'ToolSearch execution was aborted.', 'CANCELED');
  }
  const normalized = normalizeInput(input);
  if (normalized.status === 'invalid') {
    return failed('INVALID_INPUT', normalized.message, 'VALIDATION');
  }
  const resolver = options?.context?.capabilityResolver;
  if (resolver?.listCapabilities === undefined) {
    return failed(
      'SEARCH_UNAVAILABLE',
      'ToolSearch could not read the governed deferred-capability projection. Use an already disclosed capability, answer without deferred discovery, or stop and report the unavailable search boundary.',
      'UNAVAILABLE',
    );
  }
  let descriptors: readonly CapabilityDescriptor[];
  try {
    descriptors = await resolver.listCapabilities({ modelInvocable: false }, signal);
  } catch {
    return failed(
      'SEARCH_UNAVAILABLE',
      'ToolSearch failed while reading the governed deferred-capability projection. Use an already disclosed capability, answer without deferred discovery, or stop and report the unavailable search boundary.',
      'UNAVAILABLE',
    );
  }
  if (signal.aborted) {
    return failed('EXECUTION_FAILED', 'ToolSearch execution was aborted.', 'CANCELED');
  }
  const matches = descriptors
    .filter(
      (descriptor) =>
        (descriptor.kind === 'TOOL' || descriptor.kind === 'SKILL') &&
        descriptor.availabilityStatus === 'AVAILABLE' &&
        descriptor.modelInvocable !== true &&
        descriptor.disclosurePolicy?.mode !== 'HIDDEN' &&
        matchesFilters(descriptor, normalized.filters),
    )
    .map(toSafeMetadata);
  const ranked = normalized.listAll ? sortCandidateList(matches) : rankKeywordResults(matches, normalized.query);
  const tools = projectSearchResults(await hydrateSelectedClipcResults(ranked.slice(0, normalized.limit), resolver, signal));
  const allowedTools = tools.filter((tool) => tool.kind === 'TOOL').map((tool) => brand<string, 'CapabilityId'>(tool.capability_id));
  const discoveredSkills = tools.filter((tool) => tool.kind === 'SKILL').map((tool) => brand<string, 'CapabilityId'>(tool.capability_id));
  const generatedMessages = [...availableSkillMessages(tools), ...availableClipcMessages(tools)];
  return {
    status: 'SUCCEEDED',
    structuredPayload: { tools: tools.map(toJsonObject), truncated: ranked.length > normalized.limit },
    generatedMessages,
    ...(allowedTools.length === 0 && discoveredSkills.length === 0
      ? {}
      : { contextPatch: { ...(allowedTools.length === 0 ? {} : { allowedTools }), ...(discoveredSkills.length === 0 ? {} : { discoveredSkills }) } }),
    artifactRefs: [],
    metadata: {
      reasonCode: 'OK',
      resultCount: tools.length,
      truncated: ranked.length > normalized.limit,
    },
  };
}

function availableSkillMessages(results: readonly SearchResult[]): readonly CapabilityGeneratedMessage[] {
  const skills = results.filter((result) => result.kind === 'SKILL');
  if (skills.length === 0) {
    return [];
  }
  return [
    {
      role: 'USER',
      meta: true,
      content: `<available-skills>\n${skills.map(formatAvailableSkillLine).join('\n')}\n</available-skills>\nUse the Skill tool with name equal to one capability_id above. These entries came from deferred Skill discovery and have defer_loading=true; only metadata is loaded until the Skill tool succeeds.`,
    },
  ];
}

function availableClipcMessages(results: readonly SearchResult[]): readonly CapabilityGeneratedMessage[] {
  const clipcTools = results.filter((result) => result.kind === 'TOOL' && result.source === 'CLIPC');
  if (clipcTools.length === 0) {
    return [];
  }
  return [
    {
      role: 'USER',
      meta: true,
      content: `<available-clipc>\n${clipcTools.map(formatAvailableClipcLine).join('\n')}\n</available-clipc>\nUse the exact model tool named by one capability_id above. These entries came from deferred CLIP Tool discovery and have defer_loading=true; the concrete Tool descriptor is activated through allowedTools for the next model step.`,
    },
  ];
}

function formatAvailableSkillLine(skill: SearchResult): string {
  return `- capability_id=${escapeXmlText(skill.capability_id)} | name=${escapeXmlText(skill.name)} | kind=SKILL`;
}

function formatAvailableClipcLine(tool: SearchResult): string {
  return `- capability_id=${escapeXmlText(tool.capability_id)} | name=${escapeXmlText(tool.name)} | kind=TOOL`;
}

function toJsonObject(result: SearchResult): JsonObject {
  return {
    capability_id: result.capability_id,
    name: result.name,
    kind: result.kind,
    ...(result.description === undefined ? {} : { description: result.description }),
  };
}

interface NormalizedFilters {
  readonly kind?: 'TOOL' | 'SKILL';
  readonly metadata: Readonly<Record<string, string>>;
}

function normalizeInput(input: JsonObject):
  | {
      readonly status: 'valid';
      readonly query: string;
      readonly limit: number;
      readonly matchMode: 'keyword' | 'natural';
      readonly filters: NormalizedFilters;
      readonly listAll: boolean;
    }
  | { readonly status: 'invalid'; readonly message: string } {
  if (Object.keys(input).some((key) => key !== 'query' && key !== 'limit' && key !== 'matchMode' && key !== 'filters')) {
    return {
      status: 'invalid',
      message:
        'ToolSearch validation failed before search: input supports only query, limit, matchMode, and filters. Remove unsupported fields and call again.',
    };
  }
  if (input.query !== undefined && typeof input.query !== 'string') {
    return {
      status: 'invalid',
      message: 'ToolSearch validation failed before search: query must be a string. Correct or omit query and call again.',
    };
  }
  const query = typeof input.query === 'string' ? input.query.trim() : '';
  if (query.length > toolSearchQueryMaxLength) {
    return {
      status: 'invalid',
      message: `ToolSearch validation failed before search: query must contain at most ${toolSearchQueryMaxLength} characters. Shorten the query and call again.`,
    };
  }
  const matchMode = input.matchMode ?? 'keyword';
  if (matchMode !== 'keyword' && matchMode !== 'natural') {
    return {
      status: 'invalid',
      message: 'ToolSearch validation failed before search: matchMode must be keyword or natural. Correct or omit matchMode and call again.',
    };
  }
  const filters = normalizeFilters(input.filters);
  if (filters.status === 'invalid') {
    return filters;
  }
  const limit = input.limit ?? toolSearchDefaultLimit;
  if (!Number.isInteger(limit) || typeof limit !== 'number' || limit < 1 || limit > toolSearchMaxLimit) {
    return {
      status: 'invalid',
      message: `ToolSearch validation failed before search: limit must be an integer from 1 through ${toolSearchMaxLimit}. Correct or omit limit and call again.`,
    };
  }
  return { status: 'valid', query, limit, matchMode, filters: filters.filters, listAll: query.length === 0 || query === '*' };
}

function normalizeFilters(
  value: unknown,
): { readonly status: 'valid'; readonly filters: NormalizedFilters } | { readonly status: 'invalid'; readonly message: string } {
  if (value === undefined) {
    return { status: 'valid', filters: { metadata: {} } };
  }
  if (!isJsonObject(value)) {
    return {
      status: 'invalid',
      message: 'ToolSearch validation failed before search: filters must be an object. Correct or omit filters and call again.',
    };
  }
  const kind = value['kind'];
  if (kind !== undefined && kind !== 'TOOL' && kind !== 'SKILL') {
    return {
      status: 'invalid',
      message: 'ToolSearch validation failed before search: filters.kind must be TOOL or SKILL. Correct or omit the kind filter and call again.',
    };
  }
  const metadata: Record<string, string> = {};
  for (const [key, item] of Object.entries(value)) {
    if (key === 'kind') {
      continue;
    }
    if (key.length === 0 || key.length > 128) {
      return {
        status: 'invalid',
        message:
          'ToolSearch validation failed before search: metadata filter names must be non-empty and contain at most 128 characters. Correct the filter name and call again.',
      };
    }
    const text = safeScalarText(item);
    if (text === undefined || text.length === 0 || text.length > 128) {
      return {
        status: 'invalid',
        message:
          'ToolSearch validation failed before search: metadata filter values must be non-empty string, number, or boolean scalars of at most 128 characters. Correct the filter value and call again.',
      };
    }
    metadata[key] = text;
  }
  return {
    status: 'valid',
    filters: {
      metadata,
      ...(kind === undefined ? {} : { kind }),
    },
  };
}

function matchesFilters(descriptor: CapabilityDescriptor, filters: NormalizedFilters): boolean {
  if (filters.kind !== undefined && descriptor.kind !== filters.kind) {
    return false;
  }
  for (const [key, expected] of Object.entries(filters.metadata)) {
    if (metadataScalarValue(descriptor, key) !== expected) {
      return false;
    }
  }
  return true;
}

function metadataScalarValue(descriptor: CapabilityDescriptor, key: string): string | undefined {
  const metadata = descriptor.metadata;
  if (!isJsonObject(metadata)) {
    return undefined;
  }
  return safeScalarText(metadata[key]) ?? safeScalarText(isJsonObject(metadata['sourceMetadata']) ? metadata['sourceMetadata'][key] : undefined);
}

function toSafeMetadata(descriptor: CapabilityDescriptor): SearchResult {
  const description = descriptor.description.trim();
  return {
    capability_id: descriptor.capabilityId,
    name: descriptor.displayName,
    kind: descriptor.kind === 'SKILL' ? 'SKILL' : 'TOOL',
    providerId: descriptor.provider.providerId,
    ...(isClipcTool(descriptor) ? { source: 'CLIPC' as const } : {}),
    ...(descriptor.disclosurePolicy?.searchHint === undefined ? {} : { searchHint: descriptor.disclosurePolicy.searchHint }),
    ...(description.length === 0 ? {} : { description }),
  };
}

function projectSearchResults(results: readonly SearchResult[]): readonly SearchResult[] {
  return results.map(projectSearchResult);
}

function projectSearchResult(result: SearchResult): SearchResult {
  if (result.kind !== 'SKILL' && result.source !== 'CLIPC') {
    return result;
  }
  return {
    capability_id: result.capability_id,
    name: result.name,
    kind: result.kind,
    providerId: result.providerId,
    ...(result.source === undefined ? {} : { source: result.source }),
  };
}

interface SearchResult {
  readonly capability_id: string;
  readonly name: string;
  readonly kind: 'TOOL' | 'SKILL';
  readonly providerId: string;
  readonly description?: string;
  readonly searchHint?: string;
  readonly source?: 'CLIPC';
}

async function hydrateSelectedClipcResults(
  results: readonly SearchResult[],
  resolver: NonNullable<ToolExecuteOptions['context']>['capabilityResolver'],
  signal: AbortSignal,
): Promise<readonly SearchResult[]> {
  const hydrated: SearchResult[] = [];
  for (const result of results) {
    if (result.kind !== 'TOOL' || result.source !== 'CLIPC') {
      hydrated.push(result);
      continue;
    }
    try {
      const descriptor = await resolver?.resolveCapability(
        {
          kind: 'TOOL',
          capabilityId: brand<string, 'CapabilityId'>(result.capability_id),
          providerId: result.providerId,
        },
        signal,
      );
      hydrated.push(descriptor === undefined ? result : toSafeMetadata(descriptor));
    } catch {
      hydrated.push(result);
    }
  }
  return hydrated;
}

function isClipcTool(descriptor: CapabilityDescriptor): boolean {
  return (
    descriptor.kind === 'TOOL' &&
    descriptor.provider.providerKind === 'CUSTOM' &&
    descriptor.provider.providerType === 'clip_server' &&
    descriptor.disclosurePolicy?.mode === 'DEFERRED'
  );
}

function matchesQuery(tool: SearchResult, query: string): boolean {
  const terms = searchTerms(query);
  const haystack = searchableText(tool);
  return terms.every((term) => haystack.includes(term));
}

function compareSearchResult(left: SearchResult, right: SearchResult, query: string): number {
  return (
    relevanceScore(right, query) - relevanceScore(left, query) ||
    left.kind.localeCompare(right.kind, 'en') ||
    left.name.localeCompare(right.name, 'en') ||
    left.capability_id.localeCompare(right.capability_id, 'en')
  );
}

function relevanceScore(tool: SearchResult, query: string): number {
  const terms = searchTerms(query);
  const id = tool.capability_id.toLowerCase();
  const name = tool.name.toLowerCase();
  const description = (tool.description ?? '').toLowerCase();
  const exactQuery = terms.join(' ');
  let score = 0;
  if (id === exactQuery) {
    score += 100;
  }
  if (name === exactQuery) {
    score += 90;
  }
  for (const term of terms) {
    if (id === term) {
      score += 40;
    } else if (id.startsWith(term)) {
      score += 30;
    } else if (id.includes(term)) {
      score += 15;
    }
    if (name === term) {
      score += 35;
    } else if (name.startsWith(term)) {
      score += 20;
    } else if (name.includes(term)) {
      score += 12;
    }
    if (description.includes(term)) {
      score += 5;
    }
  }
  return score;
}

function rankKeywordResults(results: readonly SearchResult[], query: string): readonly SearchResult[] {
  return results.filter((tool) => matchesQuery(tool, query)).sort((left, right) => compareSearchResult(left, right, query));
}

function sortCandidateList(results: readonly SearchResult[]): readonly SearchResult[] {
  return [...results].sort(
    (left, right) =>
      left.kind.localeCompare(right.kind, 'en') ||
      left.name.localeCompare(right.name, 'en') ||
      left.capability_id.localeCompare(right.capability_id, 'en'),
  );
}

function searchTerms(query: string): readonly string[] {
  return query
    .toLowerCase()
    .split(/\s+/u)
    .filter((term) => term.length > 0);
}

function searchableText(tool: SearchResult): string {
  return `${tool.capability_id} ${tool.name} ${tool.description ?? ''} ${tool.searchHint ?? ''}`.toLowerCase();
}

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function safeScalarText(value: unknown): string | undefined {
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }
  if (typeof value === 'boolean') {
    return String(value);
  }
  return undefined;
}

function escapeXmlText(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

function failed(code: string, message: string, category: 'VALIDATION' | 'UNAVAILABLE' | 'CANCELED'): CapabilityInvocationResult {
  return {
    status: 'FAILED',
    structuredPayload: {},
    generatedMessages: [],
    artifactRefs: [],
    safeError: { code, message, category, retryable: false },
    metadata: { reasonCode: code, resultCount: 0 },
  };
}
