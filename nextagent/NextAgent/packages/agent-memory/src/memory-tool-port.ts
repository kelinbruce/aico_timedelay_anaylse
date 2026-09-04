import type { SafeError } from '@nextagent/agent-common';
import type { GuardrailGatewayPort, LongTermMemoryRetrieverGateway, LongTermMemoryStoreGateway } from '@nextagent/agent-contracts/gateway';
import type { LongTermMemoryToolPort, LongTermMemoryToolSearchQuery } from './memory-tools.js';
import { createLongTermMemoryWriteCoordinator } from './long-term-memory-write-coordinator.js';
import { parseMemoryContent } from './memory-data.js';

interface ConfiguredGatewayStores {
  readonly longTermMemoryStore: LongTermMemoryStoreGateway;
  readonly longTermMemoryRetriever: LongTermMemoryRetrieverGateway;
}
type LongTermMemoryStore = LongTermMemoryStoreGateway;
type LongTermMemoryRetriever = LongTermMemoryRetrieverGateway;
type LongTermMemoryListResult = Exclude<Awaited<ReturnType<LongTermMemoryStore['listLongTermMemory']>>, SafeError>;
type LongTermMemoryRecord = Exclude<Awaited<ReturnType<LongTermMemoryStore['getLongTermMemory']>>, SafeError>;
type LongTermMemorySearchResult = Exclude<Awaited<ReturnType<LongTermMemoryRetriever['searchLongTermMemory']>>, SafeError>;

export interface LongTermMemoryToolPortOptions {
  readonly getLongTermMemoryDetail?: LongTermMemoryToolPort['getLongTermMemoryDetail'];
  readonly guardrail?: GuardrailGatewayPort;
}

export function createLongTermMemoryToolPort(
  gateway: Pick<ConfiguredGatewayStores, 'longTermMemoryStore' | 'longTermMemoryRetriever'>,
  portOptions: LongTermMemoryToolPortOptions = {},
): LongTermMemoryToolPort {
  const writeCoordinator = createLongTermMemoryWriteCoordinator({
    store: gateway.longTermMemoryStore,
    ...(portOptions.guardrail === undefined ? {} : { guardrail: portOptions.guardrail }),
  });
  return {
    async searchLongTermMemory(query, signal) {
      if (signal?.aborted === true) {
        return canceledError();
      }
      const { purpose, ...gatewayQuery } = query;
      const result =
        query.queryText.trim().length === 0
          ? await listActiveMemory(gateway, query)
          : await searchWithUserCharacteristicsFallback(gateway, query, gatewayQuery);
      if (isSafeError(result) || purpose === undefined || query.memoryType !== 'USER_CHARACTERISTICS') {
        return result;
      }
      return filterUserCharacteristicsByPurpose(gateway, query, result, signal);
    },
    async getLongTermMemoryDetail(request, signal) {
      if (signal?.aborted === true) {
        return canceledError();
      }
      return portOptions.getLongTermMemoryDetail === undefined
        ? gateway.longTermMemoryRetriever.getLongTermMemoryDetail(request)
        : portOptions.getLongTermMemoryDetail(request, signal);
    },
    async saveLongTermMemory(request, writeOptions, signal) {
      if (signal?.aborted === true) {
        return canceledError();
      }
      return writeCoordinator.saveLongTermMemory(request, writeOptions, signal);
    },
  };
}

async function listActiveMemory(
  gateway: Pick<ConfiguredGatewayStores, 'longTermMemoryStore'>,
  query: LongTermMemoryToolSearchQuery,
): Promise<LongTermMemorySearchResult | SafeError> {
  const result = await gateway.longTermMemoryStore.listLongTermMemory({
    tenantId: query.tenantId,
    subjectId: query.subjectId,
    agentId: query.agentId,
    ...(query.memoryType === undefined ? {} : { memoryType: query.memoryType }),
    state: 'ACTIVE',
    ...(query.minConfidence === undefined ? {} : { minConfidence: query.minConfidence }),
    ...(query.limit === undefined ? {} : { limit: query.limit }),
    ...(query.offset === undefined ? {} : { offset: query.offset }),
  });
  if (isSafeError(result)) {
    return result;
  }
  return searchResultFromList(result);
}

/**
 * Keyword search with a graceful USER_CHARACTERISTICS fallback.
 *
 * A USER_CHARACTERISTICS keyword search that matches nothing still surfaces the
 * user's traits by falling back to listing the category. This protects the
 * proactive first-turn load (see the memory system-prompt section): trait text
 * is often free-form (e.g. Chinese), so a generic query word supplied by the
 * model can FTS-miss every entry and would otherwise hide all characteristics.
 * Other categories keep strict keyword semantics — an empty match stays empty.
 */
async function searchWithUserCharacteristicsFallback(
  gateway: ConfiguredGatewayStores,
  query: LongTermMemoryToolSearchQuery,
  gatewayQuery: Parameters<LongTermMemoryRetriever['searchLongTermMemory']>[0],
): Promise<LongTermMemorySearchResult | SafeError> {
  const result = await gateway.longTermMemoryRetriever.searchLongTermMemory(gatewayQuery);
  if (!isSafeError(result) && query.memoryType === 'USER_CHARACTERISTICS' && result.items.length === 0) {
    const listed = await listActiveMemory(gateway, query);
    if (!isSafeError(listed)) {
      return listed;
    }
  }
  return result;
}

function searchResultFromList(result: LongTermMemoryListResult): LongTermMemorySearchResult {
  return {
    items: result.items.map((summary) => ({
      summary,
      score: summary.confidence,
      relevanceScore: summary.confidence,
    })),
    total: result.total,
    offset: result.offset,
    limit: result.limit,
  };
}

async function filterUserCharacteristicsByPurpose(
  gateway: Pick<ConfiguredGatewayStores, 'longTermMemoryStore'>,
  query: LongTermMemoryToolSearchQuery,
  result: LongTermMemorySearchResult,
  signal?: AbortSignal,
): Promise<LongTermMemorySearchResult | SafeError> {
  const items = [];
  for (const entry of result.items) {
    if (signal?.aborted === true) {
      return canceledError();
    }
    const detail = await gateway.longTermMemoryStore.getLongTermMemory({
      tenantId: query.tenantId,
      subjectId: query.subjectId,
      agentId: query.agentId,
      memoryId: entry.summary.memoryId,
    });
    if (isSafeError(detail)) {
      if (detail.code === 'LTM_STORAGE_UNAVAILABLE' || detail.code === 'LTM_DISABLED') {
        return detail;
      }
      continue;
    }
    if (hasPurpose(detail, query.purpose)) {
      items.push(entry);
    }
  }
  return { items, total: items.length, offset: 0, limit: result.limit };
}

function hasPurpose(record: LongTermMemoryRecord, purpose: LongTermMemoryToolSearchQuery['purpose']): boolean {
  const content = parseMemoryContent(record.content);
  return content?.category === 'USER_CHARACTERISTICS' && purpose !== undefined && content.purpose.includes(purpose);
}

function isSafeError(value: unknown): value is SafeError {
  return value !== null && typeof value === 'object' && 'code' in value && 'category' in value;
}

function canceledError(): SafeError {
  return {
    code: 'MEMORY_TOOL_CANCELED',
    message: 'Memory tool operation was canceled.',
    category: 'CANCELED',
    retryable: false,
  };
}
