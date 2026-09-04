import type { SafeError } from '@nextagent/agent-common';
import type {
  LongTermMemoryManagementPage,
  LongTermMemoryManagementPort,
  LongTermMemoryManagementScope,
  LongTermMemoryManagementView,
  LongTermMemoryMutationManagementResult,
  LongTermMemorySearchManagementPage,
  LongTermMemorySummaryManagementView,
  PublishedLongTermMemoryManagementPage,
} from '@nextagent/agent-contracts/channel';
import type {
  BatchCreateLongTermMemoryRequest,
  GuardrailGatewayPort,
  LongTermMemoryGatewayBindings,
  LongTermMemoryRecord,
  LongTermMemorySummary,
  SearchItemPage,
  SharedMemorySummary,
  SharedMemorySummaryPage,
  UserQueryGateway,
} from '@nextagent/agent-contracts/gateway';
import { createLongTermMemoryWriteCoordinator } from './long-term-memory-write-coordinator.js';

export interface LongTermMemoryManagementServiceDependencies extends LongTermMemoryGatewayBindings {
  readonly guardrail?: GuardrailGatewayPort;
  readonly userQuery?: UserQueryGateway;
}

export function createLongTermMemoryManagementService(dependencies: LongTermMemoryManagementServiceDependencies): LongTermMemoryManagementPort {
  const { store, retriever, sharing } = dependencies;
  const writeCoordinator = createLongTermMemoryWriteCoordinator({
    store,
    ...(dependencies.guardrail === undefined ? {} : { guardrail: dependencies.guardrail }),
  });

  return {
    async saveLongTermMemory(command, signal) {
      const { writeOptions, ...request } = command;
      return invoke(signal, () => writeCoordinator.saveLongTermMemory(toGatewayRequest(request), writeOptions, signal), projectRecord);
    },
    async listLongTermMemory(query, signal) {
      return invoke(signal, () => store.listLongTermMemory(toGatewayRequest(query)), projectSummaryPage);
    },
    async batchCreateLongTermMemory(command, signal) {
      const request = toGatewayRequest({
        ...command,
        items: command.items.map(({ idempotencyKey, ...item }) => ({
          ...item,
          ...(idempotencyKey === undefined ? {} : { writeOptions: { idempotencyKey } }),
        })),
      });
      if (!command.items.some((item) => item.memoryId === undefined && item.knowledgeSourceType === 'CONFIGURED')) {
        return invoke(
          signal,
          () => writeCoordinator.batchCreateLongTermMemory(request, signal),
          (result) => result,
        );
      }
      const configuredTotal = await countConfiguredPersonalMemories(store, command, signal);
      if (isSafeError(configuredTotal)) {
        return configuredTotal;
      }
      let remainingSlots = MAX_CONFIGURED_PERSONAL_MEMORIES - configuredTotal;
      const admittedItems: Array<BatchCreateLongTermMemoryRequest['items'][number]> = [];
      let capacityFailCount = 0;
      for (const item of request.items) {
        if (item.memoryId === undefined && item.knowledgeSourceType === 'CONFIGURED') {
          if (remainingSlots <= 0) {
            capacityFailCount += 1;
            continue;
          }
          remainingSlots -= 1;
        }
        admittedItems.push(item);
      }
      if (admittedItems.length === 0) {
        return { successCount: 0, failCount: capacityFailCount, memoryIds: [] };
      }
      return invoke(
        signal,
        () => writeCoordinator.batchCreateLongTermMemory({ ...request, items: admittedItems }, signal),
        (result) => ({ ...result, failCount: result.failCount + capacityFailCount }),
      );
    },
    async manualSaveLongTermMemory(command, signal) {
      if (command.memoryId === undefined && command.knowledgeSourceType === 'CONFIGURED') {
        const configuredTotal = await countConfiguredPersonalMemories(store, command, signal);
        if (isSafeError(configuredTotal)) {
          return configuredTotal;
        }
        if (configuredTotal + 1 > MAX_CONFIGURED_PERSONAL_MEMORIES) {
          return configuredPersonalMemoryCapacityError();
        }
      }
      return invoke(signal, () => writeCoordinator.manualSaveLongTermMemory(toGatewayRequest(command), signal), projectRecord);
    },
    async getLongTermMemory(query, signal) {
      return invoke(signal, () => store.getLongTermMemory(toGatewayRequest(query)), projectRecord);
    },
    async deleteLongTermMemory(command, signal) {
      return invoke(
        signal,
        () => store.deleteLongTermMemory(toGatewayRequest(command)),
        (result) => ({ memoryId: result.memoryId }),
      );
    },
    async mutateLongTermMemory(command, signal) {
      const { writeOptions, ...request } = command;
      return invoke(signal, () => store.mutateLongTermMemory(toGatewayRequest(request), writeOptions), projectMutationResult);
    },
    async searchLongTermMemory(query, signal) {
      return invoke(signal, () => retriever.searchLongTermMemory(toGatewayRequest(query)), projectSearchPage);
    },
    async getLongTermMemoryDetail(query, signal) {
      return invoke(signal, () => retriever.getLongTermMemoryDetail(toGatewayRequest(query)), projectRecord);
    },
    async publishLongTermMemory(command, signal) {
      return invoke(
        signal,
        () => sharing.publishLongTermMemory(toGatewayRequest(command)),
        (result) => ({
          publishedMemory: projectRecord(result.publishedMemory),
          sourceMemoryId: result.sourceMemoryId,
          ownerSubjectId: result.ownerSubjectId,
        }),
      );
    },
    async unpublishLongTermMemory(command, signal) {
      return invoke(
        signal,
        () => sharing.unpublishLongTermMemory(toGatewayRequest(command)),
        (result) => ({ memoryId: result.memoryId }),
      );
    },
    async listPublishedLongTermMemory(query, signal) {
      const page = await invoke(signal, () => sharing.listPublishedLongTermMemory(toGatewayRequest(query)), projectPublishedPage);
      if (isSafeError(page)) {
        return page;
      }
      return resolvePublishedOwnerNames(page, query.identityContext, dependencies.userQuery, signal);
    },
    async copyPublishedMemory(command, signal) {
      return invoke(
        signal,
        () => sharing.copyPublishedMemory(toGatewayRequest(command)),
        (result) => ({
          results: result.results.map((item) => ({
            memoryId: item.memoryId,
            record: projectRecord(item.record),
            sourceMemoryId: item.sourceMemoryId,
            copyStatus: item.copyStatus,
          })),
        }),
      );
    },
  };
}

const MAX_CONFIGURED_PERSONAL_MEMORIES = 50;

async function countConfiguredPersonalMemories(
  store: LongTermMemoryGatewayBindings['store'],
  scope: LongTermMemoryManagementScope & { readonly memoryInstance?: string },
  signal: AbortSignal | undefined,
): Promise<number | SafeError> {
  const countQuery = {
    identityContext: scope.identityContext,
    agentId: scope.agentId,
    memoryInstance: scope.memoryInstance ?? 'defaultInstance',
    knowledgeSourceType: 'CONFIGURED' as const,
    minConfidence: 0,
    limit: 1,
    offset: 0,
  };
  const activeTotal = await invoke(
    signal,
    () => store.listLongTermMemory(toGatewayRequest({ ...countQuery, state: 'ACTIVE' as const })),
    (page) => page.total,
  );
  if (isSafeError(activeTotal)) {
    return activeTotal;
  }
  const archivedTotal = await invoke(
    signal,
    () => store.listLongTermMemory(toGatewayRequest({ ...countQuery, state: 'ARCHIVED' as const })),
    (page) => page.total,
  );
  if (isSafeError(archivedTotal)) {
    return archivedTotal;
  }
  return activeTotal + archivedTotal;
}

function toGatewayRequest<T extends LongTermMemoryManagementScope>(value: T) {
  const { identityContext, agentId, ...operationInput } = value;
  return {
    tenantId: identityContext.tenantId,
    subjectId: identityContext.subjectId,
    agentId,
    ...operationInput,
  };
}

async function invoke<TResult, TView>(
  signal: AbortSignal | undefined,
  operation: () => Promise<TResult | SafeError>,
  project: (result: TResult) => TView,
): Promise<TView | SafeError> {
  if (signal?.aborted === true) {
    return canceledError();
  }
  try {
    const result = await operation();
    return isSafeError(result) ? result : project(result);
  } catch (error) {
    return isSafeError(error) ? error : unavailableError();
  }
}

function projectRecord(record: LongTermMemoryRecord): LongTermMemoryManagementView {
  return {
    memoryId: record.memoryId,
    memoryInstance: record.memoryInstance,
    memoryType: record.memoryType,
    knowledgeSourceType: record.knowledgeSourceType,
    sharingState: record.sharingState,
    ...(record.sourceMemoryId === undefined ? {} : { sourceMemoryId: record.sourceMemoryId }),
    state: record.state,
    briefIndex: record.briefIndex,
    content: record.content,
    labels: record.labels,
    confidence: record.confidence,
    version: record.version,
    accessCount: record.accessCount,
    recallCount: record.recallCount,
    extractionCount: record.extractionCount,
    ...(record.lastAccessedAt === undefined ? {} : { lastAccessedAt: record.lastAccessedAt }),
    archivedAt: record.archivedAt,
    archiveReason: record.archiveReason,
    isPinned: record.isPinned,
    source: record.source,
    createTime: record.createTime,
    updateTime: record.updateTime,
  };
}

function projectSummary(summary: LongTermMemorySummary): LongTermMemorySummaryManagementView {
  return {
    memoryId: summary.memoryId,
    memoryType: summary.memoryType,
    knowledgeSourceType: summary.knowledgeSourceType,
    state: summary.state,
    briefIndex: summary.briefIndex,
    content: summary.content,
    labels: summary.labels,
    confidence: summary.confidence,
    isPinned: summary.isPinned,
    accessCount: summary.accessCount,
    createTime: summary.createTime,
    updateTime: summary.updateTime,
    version: summary.version,
  };
}

function projectSummaryPage(page: {
  readonly items: readonly LongTermMemorySummary[];
  readonly total: number;
  readonly offset: number;
  readonly limit: number;
}): LongTermMemoryManagementPage {
  return { items: page.items.map(projectSummary), total: page.total, offset: page.offset, limit: page.limit };
}

function projectMutationResult(result: {
  readonly status: LongTermMemoryMutationManagementResult['status'];
  readonly memoryId?: LongTermMemoryMutationManagementResult['memoryId'];
  readonly currentVersion?: number;
  readonly record?: LongTermMemoryRecord;
}): LongTermMemoryMutationManagementResult {
  return {
    status: result.status,
    ...(result.memoryId === undefined ? {} : { memoryId: result.memoryId }),
    ...(result.currentVersion === undefined ? {} : { currentVersion: result.currentVersion }),
    ...(result.record === undefined ? {} : { record: projectRecord(result.record) }),
  };
}

function projectSearchPage(page: SearchItemPage): LongTermMemorySearchManagementPage {
  return {
    items: page.items.map((item) => ({
      summary: projectSummary(item.summary),
      score: item.score,
      relevanceScore: item.relevanceScore,
    })),
    total: page.total,
    offset: page.offset,
    limit: page.limit,
  };
}

function projectPublishedSummary(summary: SharedMemorySummary) {
  return {
    ...projectSummary(summary),
    sourceMemoryId: summary.sourceMemoryId,
    ownerSubjectId: summary.ownerSubjectId,
  };
}

function projectPublishedPage(page: SharedMemorySummaryPage): PublishedLongTermMemoryManagementPage {
  return {
    items: page.items.map(projectPublishedSummary),
    total: page.total,
    offset: page.offset,
    limit: page.limit,
  };
}

async function resolvePublishedOwnerNames(
  page: PublishedLongTermMemoryManagementPage,
  identityContext: LongTermMemoryManagementScope['identityContext'],
  userQuery?: UserQueryGateway,
  signal?: AbortSignal,
): Promise<PublishedLongTermMemoryManagementPage | SafeError> {
  if (page.items.length === 0 || userQuery === undefined) {
    return page;
  }
  if (signal?.aborted === true) {
    return canceledError();
  }

  const targetSubjectIds = [...new Set(page.items.map((item) => item.ownerSubjectId))];
  try {
    const result = await userQuery.queryUsers(
      {
        tenantId: identityContext.tenantId,
        subjectId: identityContext.subjectId,
        targetSubjectIds,
      },
      signal,
    );
    if (isSafeError(result)) {
      return result.category === 'CANCELED' ? canceledError() : page;
    }
    const requestedIds = new Set(targetSubjectIds);
    const userNames = new Map(
      result.users.filter((user) => requestedIds.has(user.subjectId)).map((user) => [user.subjectId, user.userName] as const),
    );
    return {
      ...page,
      items: page.items.map((item) => {
        const ownerUserName = userNames.get(item.ownerSubjectId);
        return ownerUserName === undefined ? item : { ...item, ownerUserName };
      }),
    };
  } catch (error) {
    return isSignalAborted(signal) || (isSafeError(error) && error.category === 'CANCELED') ? canceledError() : page;
  }
}

function isSignalAborted(signal?: AbortSignal): boolean {
  return signal?.aborted === true;
}

function isSafeError(value: unknown): value is SafeError {
  return value !== null && typeof value === 'object' && 'code' in value && 'category' in value && 'retryable' in value;
}

function canceledError(): SafeError {
  return {
    code: 'LTM_OPERATION_CANCELED',
    message: 'Long-term memory operation was canceled.',
    category: 'CANCELED',
    retryable: false,
  };
}

function unavailableError(): SafeError {
  return {
    code: 'LTM_STORAGE_UNAVAILABLE',
    message:
      'Long-term memory storage is temporarily unavailable. Use the current conversation context, try again later, or continue without memory.',
    category: 'UNAVAILABLE',
    retryable: true,
  };
}

function configuredPersonalMemoryCapacityError(): SafeError {
  return {
    code: 'LTM_WRITE_INVALID',
    message: `At most ${MAX_CONFIGURED_PERSONAL_MEMORIES} configured long-term memories are allowed. Remove or consolidate an existing configured memory before adding another one.`,
    category: 'VALIDATION',
    retryable: false,
  };
}
