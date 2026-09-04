import type { SafeError } from '@nextagent/agent-common';
import type {
  BatchCreateLongTermMemoryRequest,
  BatchCreateLongTermMemoryResult,
  GuardrailGatewayPort,
  LongTermMemoryRecord,
  LongTermMemoryStoreGateway,
  ManualSaveLongTermMemoryRequest,
  SaveLongTermMemoryRequest,
  VersionedWriteOptions,
} from '@nextagent/agent-contracts/gateway';

type LongTermMemoryWriteStore = Pick<LongTermMemoryStoreGateway, 'saveLongTermMemory' | 'batchCreateLongTermMemory' | 'manualSaveLongTermMemory'>;

const maxKnowledgeFragmentCodePoints = 2000;
const maxKnowledgeFragmentsPerRequest = 5;

export interface LongTermMemorySaveCoordinator {
  saveLongTermMemory: (
    request: SaveLongTermMemoryRequest,
    options?: VersionedWriteOptions,
    signal?: AbortSignal,
  ) => Promise<LongTermMemoryRecord | SafeError>;
}

export interface LongTermMemoryWriteCoordinator extends LongTermMemorySaveCoordinator {
  batchCreateLongTermMemory: (
    request: BatchCreateLongTermMemoryRequest,
    signal?: AbortSignal,
  ) => Promise<BatchCreateLongTermMemoryResult | SafeError>;
  manualSaveLongTermMemory: (request: ManualSaveLongTermMemoryRequest, signal?: AbortSignal) => Promise<LongTermMemoryRecord | SafeError>;
}

export interface LongTermMemorySaveCoordinatorDependencies {
  readonly store: Pick<LongTermMemoryWriteStore, 'saveLongTermMemory'>;
  readonly guardrail?: GuardrailGatewayPort;
}

export interface LongTermMemoryWriteCoordinatorDependencies extends LongTermMemorySaveCoordinatorDependencies {
  readonly store: LongTermMemoryWriteStore;
}

export function createLongTermMemorySaveCoordinator(dependencies: LongTermMemorySaveCoordinatorDependencies): LongTermMemorySaveCoordinator {
  return {
    async saveLongTermMemory(request, options, signal) {
      const admissionFailure = await admitMemoryContent(dependencies.guardrail, request, signal);
      return admissionFailure ?? dependencies.store.saveLongTermMemory(request, options);
    },
  };
}

export function createLongTermMemoryWriteCoordinator(dependencies: LongTermMemoryWriteCoordinatorDependencies): LongTermMemoryWriteCoordinator {
  const saveCoordinator = createLongTermMemorySaveCoordinator(dependencies);
  return {
    ...saveCoordinator,
    async batchCreateLongTermMemory(request, signal) {
      const admittedItems: Array<BatchCreateLongTermMemoryRequest['items'][number]> = [];
      let failCount = 0;
      for (const item of request.items) {
        if (isAborted(signal)) {
          return contentGuardCanceledError();
        }
        const admissionFailure = await admitMemoryContent(dependencies.guardrail, item, signal);
        if (admissionFailure === undefined) {
          admittedItems.push(item);
        } else {
          failCount += 1;
        }
      }
      if (admittedItems.length === 0) {
        return { successCount: 0, failCount, memoryIds: [] };
      }
      const result = await dependencies.store.batchCreateLongTermMemory({ ...request, items: admittedItems });
      return isSafeError(result) ? result : { ...result, failCount: result.failCount + failCount };
    },
    async manualSaveLongTermMemory(request, signal) {
      const admissionFailure = await admitMemoryContent(dependencies.guardrail, request, signal);
      return admissionFailure ?? dependencies.store.manualSaveLongTermMemory(request);
    },
  };
}

async function admitMemoryContent(
  guardrail: GuardrailGatewayPort | undefined,
  request: Pick<SaveLongTermMemoryRequest, 'briefIndex' | 'content'>,
  signal?: AbortSignal,
): Promise<SafeError | undefined> {
  if (isAborted(signal)) {
    return contentGuardCanceledError();
  }
  if (guardrail === undefined) {
    return undefined;
  }

  const batches = createKnowledgeBatches(`${request.briefIndex}\n${request.content}`);
  for (const texts of batches) {
    if (isAborted(signal)) {
      return contentGuardCanceledError();
    }
    const result = await invokeKnowledgeGuardrail(guardrail, texts, signal);
    if (isSafeError(result)) {
      return mapKnowledgeGuardrailError(result);
    }
    if (!result.isLegal) {
      return contentGuardBlockedError();
    }
  }
  return isAborted(signal) ? contentGuardCanceledError() : undefined;
}

async function invokeKnowledgeGuardrail(guardrail: GuardrailGatewayPort, texts: readonly string[], signal?: AbortSignal) {
  try {
    return await guardrail.checkKnowledge({ texts, isPrivacy: true }, signal);
  } catch {
    return isAborted(signal) ? contentGuardCanceledError() : contentGuardUnavailableError(true);
  }
}

function createKnowledgeBatches(text: string): ReadonlyArray<readonly string[]> {
  const codePoints = Array.from(text);
  const fragments: string[] = [];
  for (let offset = 0; offset < codePoints.length; offset += maxKnowledgeFragmentCodePoints) {
    fragments.push(codePoints.slice(offset, offset + maxKnowledgeFragmentCodePoints).join(''));
  }

  const batches: string[][] = [];
  for (let offset = 0; offset < fragments.length; offset += maxKnowledgeFragmentsPerRequest) {
    batches.push(fragments.slice(offset, offset + maxKnowledgeFragmentsPerRequest));
  }
  return batches;
}

function mapKnowledgeGuardrailError(error: SafeError): SafeError {
  if (error.code === 'GUARDRAIL_KNOWLEDGE_CANCELED' || error.category === 'CANCELED') {
    return contentGuardCanceledError();
  }
  return contentGuardUnavailableError(error.code !== 'GUARDRAIL_KNOWLEDGE_REQUEST_INVALID');
}

function isSafeError(value: unknown): value is SafeError {
  return value !== null && typeof value === 'object' && 'code' in value && 'category' in value && 'retryable' in value;
}

function isAborted(signal?: AbortSignal): boolean {
  return signal?.aborted === true;
}

function contentGuardBlockedError(): SafeError {
  return {
    code: 'LTM_CONTENT_GUARD_BLOCKED',
    message:
      'The security guardrail blocked this long-term memory write, so no memory was saved. Do not attempt to bypass the guardrail; continue without saving this content or stop and report the policy boundary.',
    category: 'POLICY_DENIED',
    retryable: false,
  };
}

function contentGuardUnavailableError(retryable: boolean): SafeError {
  return {
    code: 'LTM_CONTENT_GUARD_UNAVAILABLE',
    message:
      'The long-term memory write did not start because its security check is temporarily unavailable. Continue without saving, try again later, or stop and report the unavailable guardrail.',
    category: 'UNAVAILABLE',
    retryable,
  };
}

function contentGuardCanceledError(): SafeError {
  return {
    code: 'LTM_CONTENT_GUARD_CANCELED',
    message: 'Long-term memory content security check was canceled.',
    category: 'CANCELED',
    retryable: false,
  };
}
