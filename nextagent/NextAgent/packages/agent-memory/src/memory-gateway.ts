import type { SafeError } from '@nextagent/agent-common';
import type { LongTermMemoryRetrieverGateway, LongTermMemorySharingGateway, LongTermMemoryStoreGateway } from '@nextagent/agent-contracts/gateway';

export interface MemoryGatewayConfiguration {
  readonly status: 'VALID' | string;
  readonly search: {
    readonly defaultLimit: number;
    readonly minConfidence: number;
  };
}

export interface MemoryGatewayStores {
  readonly longTermMemoryStore: LongTermMemoryStoreGateway;
  readonly longTermMemoryRetriever: LongTermMemoryRetrieverGateway;
  readonly longTermMemorySharing: LongTermMemorySharingGateway;
  close?: () => void;
}

type ConfiguredLongTermMemorySearchQuery = Parameters<LongTermMemoryRetrieverGateway['searchLongTermMemory']>[0];

export function createMemoryConfiguredGateway<TGateway extends MemoryGatewayStores>(
  gateway: TGateway,
  memoryConfig: MemoryGatewayConfiguration,
  options: DisabledLongTermMemoryGatewayOptions = {},
): TGateway {
  if (memoryConfig.status === 'VALID') {
    return {
      ...gateway,
      longTermMemoryRetriever: createConfiguredLongTermMemoryRetriever(gateway.longTermMemoryRetriever, memoryConfig.search),
      close: () => gateway.close?.(),
    };
  }
  const disabled = createDisabledLongTermMemoryGateway(options);
  return {
    ...gateway,
    longTermMemoryStore: disabled.store,
    longTermMemoryRetriever: disabled.retriever,
    longTermMemorySharing: disabled.sharing,
    close: () => gateway.close?.(),
  };
}

function createConfiguredLongTermMemoryRetriever(
  retriever: LongTermMemoryRetrieverGateway,
  searchConfig: MemoryGatewayConfiguration['search'],
): LongTermMemoryRetrieverGateway {
  return {
    searchLongTermMemory: (query) => retriever.searchLongTermMemory(applyMemorySearchDefaults(query, searchConfig)),
    getLongTermMemoryDetail: (request) => retriever.getLongTermMemoryDetail(request),
  };
}

function applyMemorySearchDefaults(
  query: ConfiguredLongTermMemorySearchQuery,
  searchConfig: MemoryGatewayConfiguration['search'],
): ConfiguredLongTermMemorySearchQuery {
  return {
    ...query,
    limit: query.limit ?? searchConfig.defaultLimit,
    minConfidence: query.minConfidence ?? searchConfig.minConfidence,
    offset: query.offset ?? 0,
  };
}

export interface DisabledLongTermMemoryGateway {
  readonly store: LongTermMemoryStoreGateway;
  readonly retriever: LongTermMemoryRetrieverGateway;
  readonly sharing: LongTermMemorySharingGateway;
}

export type DisabledLongTermMemoryOperation =
  | 'getLongTermMemory'
  | 'saveLongTermMemory'
  | 'batchCreateLongTermMemory'
  | 'manualSaveLongTermMemory'
  | 'deleteLongTermMemory'
  | 'listLongTermMemory'
  | 'mutateLongTermMemory'
  | 'searchLongTermMemory'
  | 'getLongTermMemoryDetail'
  | 'publishLongTermMemory'
  | 'unpublishLongTermMemory'
  | 'listPublishedLongTermMemory'
  | 'copyPublishedMemory';

export interface DisabledLongTermMemoryDiagnostic {
  readonly eventType: 'LTM_DISABLED';
  readonly safeReasonCode: 'LTM_DISABLED';
  readonly operation: DisabledLongTermMemoryOperation;
}

export interface DisabledLongTermMemoryGatewayOptions {
  readonly diagnosticObserver?: (event: DisabledLongTermMemoryDiagnostic) => void;
}

export function createDisabledLongTermMemoryGateway(options: DisabledLongTermMemoryGatewayOptions = {}): DisabledLongTermMemoryGateway {
  const adapter = new DisabledLongTermMemoryAdapter(options.diagnosticObserver);
  return {
    store: adapter,
    retriever: adapter,
    sharing: adapter,
  };
}

class DisabledLongTermMemoryAdapter implements LongTermMemoryStoreGateway, LongTermMemoryRetrieverGateway, LongTermMemorySharingGateway {
  constructor(private readonly diagnosticObserver?: (event: DisabledLongTermMemoryDiagnostic) => void) {}

  async getLongTermMemory(): Promise<SafeError> {
    return this.disabled('getLongTermMemory');
  }

  async saveLongTermMemory(): Promise<SafeError> {
    return this.disabled('saveLongTermMemory');
  }

  async batchCreateLongTermMemory(): Promise<SafeError> {
    return this.disabled('batchCreateLongTermMemory');
  }

  async manualSaveLongTermMemory(): Promise<SafeError> {
    return this.disabled('manualSaveLongTermMemory');
  }

  async deleteLongTermMemory(): Promise<SafeError> {
    return this.disabled('deleteLongTermMemory');
  }

  async listLongTermMemory(): Promise<SafeError> {
    return this.disabled('listLongTermMemory');
  }

  async mutateLongTermMemory(): Promise<SafeError> {
    return this.disabled('mutateLongTermMemory');
  }

  async searchLongTermMemory(): Promise<SafeError> {
    return this.disabled('searchLongTermMemory');
  }

  async getLongTermMemoryDetail(): Promise<SafeError> {
    return this.disabled('getLongTermMemoryDetail');
  }

  async publishLongTermMemory(): Promise<SafeError> {
    return this.disabled('publishLongTermMemory');
  }

  async unpublishLongTermMemory(): Promise<SafeError> {
    return this.disabled('unpublishLongTermMemory');
  }

  async listPublishedLongTermMemory(): Promise<SafeError> {
    return this.disabled('listPublishedLongTermMemory');
  }

  async copyPublishedMemory(): Promise<SafeError> {
    return this.disabled('copyPublishedMemory');
  }

  private disabled(operation: DisabledLongTermMemoryOperation): SafeError {
    this.emitDiagnostic(operation);
    return ltmDisabledSafeError();
  }

  private emitDiagnostic(operation: DisabledLongTermMemoryOperation): void {
    try {
      this.diagnosticObserver?.({
        eventType: 'LTM_DISABLED',
        safeReasonCode: 'LTM_DISABLED',
        operation,
      });
    } catch {
      /* diagnostics are non-blocking */
    }
  }
}

function ltmDisabledSafeError(): SafeError {
  return {
    code: 'LTM_DISABLED',
    message: 'Long-term memory is disabled for this Agent. Continue using the current conversation context without memory, or end the memory action.',
    category: 'UNAVAILABLE',
    retryable: false,
    safeDetails: { reason: 'memory_disabled' },
  };
}
