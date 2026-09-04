import { AgentError, type SafeError } from '@nextagent/agent-common';
import type {
  ForkPromotionAbortRequest,
  ForkPromotionCleanupRequest,
  ForkPromotionCleanupResult,
  ForkPromotionContent,
  ForkProcessSnapshotStatusRecord,
  ForkSessionRequest,
  ForkSessionResult,
  HasUserMessageAfterForkAnchorRequest,
  LoadCommittedForkPromotionContentRequest,
  LoadForkProcessSnapshotStatusRequest,
  LoadSessionForkSourceRequest,
  PrepareForkRequest,
  PrepareForkResult,
  SessionForkSourceRecord,
  SessionForkStoreGateway,
  StageForkPromotionRequest,
  StageForkPromotionResult,
} from '@nextagent/agent-contracts/gateway';
import type { SqliteGatewayCore } from './sqlite-gateway-core.js';
import { SqliteSessionForkApplication, type SqliteSessionForkApplicationOptions } from './sqlite-session-fork-application.js';

export class SqliteSessionForkStore implements SessionForkStoreGateway {
  private readonly application: SqliteSessionForkApplication;

  constructor(
    private readonly core: SqliteGatewayCore,
    options?: SqliteSessionForkApplicationOptions,
  ) {
    this.application = new SqliteSessionForkApplication(core, options);
  }

  async prepareFork(request: PrepareForkRequest, signal?: AbortSignal): Promise<PrepareForkResult> {
    return executeForkOperation(() => this.application.prepareFork(request, signal));
  }

  async stageForkPromotion(request: StageForkPromotionRequest, signal?: AbortSignal): Promise<StageForkPromotionResult> {
    return executeForkOperation(() => this.application.stageForkPromotion(request, signal));
  }

  async forkSession(request: ForkSessionRequest, signal?: AbortSignal): Promise<ForkSessionResult> {
    return executeForkOperation(() => this.application.forkSession(request, signal));
  }

  async abortForkPromotions(request: ForkPromotionAbortRequest, signal?: AbortSignal): Promise<void> {
    return executeForkOperation(() => {
      assertNotCanceled(signal);
      return this.core.abortForkPromotions(request);
    });
  }

  async loadSessionForkSource(request: LoadSessionForkSourceRequest, signal?: AbortSignal): Promise<SessionForkSourceRecord | undefined> {
    return executeForkOperation(() => {
      assertNotCanceled(signal);
      return this.core.loadSessionForkSource(request);
    });
  }

  async loadForkProcessSnapshotStatus(
    request: LoadForkProcessSnapshotStatusRequest,
    signal?: AbortSignal,
  ): Promise<ForkProcessSnapshotStatusRecord | undefined> {
    return executeForkOperation(() => {
      assertNotCanceled(signal);
      return this.core.loadForkProcessSnapshotStatus(request);
    });
  }

  async hasUserMessageAfterForkAnchor(request: HasUserMessageAfterForkAnchorRequest, signal?: AbortSignal): Promise<boolean> {
    return executeForkOperation(() => {
      assertNotCanceled(signal);
      return this.core.hasUserMessageAfterForkAnchor(request);
    });
  }

  async loadCommittedForkPromotionContent(
    request: LoadCommittedForkPromotionContentRequest,
    signal?: AbortSignal,
  ): Promise<ForkPromotionContent | undefined> {
    return executeForkOperation(() => {
      assertNotCanceled(signal);
      return this.core.loadCommittedForkPromotionContent(request);
    });
  }

  async cleanupExpiredForkPromotions(request: ForkPromotionCleanupRequest, signal?: AbortSignal): Promise<ForkPromotionCleanupResult> {
    return executeForkOperation(() => {
      assertNotCanceled(signal);
      return this.core.cleanupExpiredForkPromotions(request);
    });
  }
}

type ForkErrorTuple = readonly [category: SafeError['category'], retryable: boolean];

const canonicalForkErrorTuples = new Map<string, ForkErrorTuple>([
  ['SESSION_NOT_FOUND', ['NOT_FOUND', false]],
  ['SESSION_FORK_REQUEST_INVALID', ['VALIDATION', false]],
  ['SESSION_FORK_IDEMPOTENCY_REQUIRED', ['VALIDATION', false]],
  ['SESSION_FORK_ANCHOR_NOT_FOUND', ['NOT_FOUND', false]],
  ['SESSION_FORK_ANCHOR_NOT_ELIGIBLE', ['VALIDATION', false]],
  ['SESSION_FORK_REQUEST_ANCHOR_NOT_FOUND', ['NOT_FOUND', false]],
  ['SESSION_FORK_REQUEST_ANCHOR_AMBIGUOUS', ['CONFLICT', false]],
  ['SESSION_FORK_SOURCE_RUN_NOT_TERMINAL', ['CONFLICT', true]],
  ['SESSION_FORK_PREFIX_TOO_LARGE', ['VALIDATION', false]],
  ['SESSION_FORK_PREFIX_CONTENT_TOO_LARGE', ['VALIDATION', false]],
  ['SESSION_FORK_PROMOTION_LIMIT_EXCEEDED', ['VALIDATION', false]],
  ['SESSION_FORK_PROMOTED_CONTENT_TOO_LARGE', ['VALIDATION', false]],
  ['SESSION_FORK_EVENT_LIMIT_EXCEEDED', ['VALIDATION', false]],
  ['SESSION_FORK_EVENT_BYTES_EXCEEDED', ['VALIDATION', false]],
  ['SESSION_FORK_SOURCE_RUN_REF', ['VALIDATION', false]],
  ['SESSION_FORK_RUNTIME_METADATA', ['VALIDATION', false]],
  ['SESSION_FORK_METADATA_INVALID', ['VALIDATION', false]],
  ['SESSION_FORK_EXECUTION_BOUND_CONTENT', ['VALIDATION', false]],
  ['SESSION_FORK_EXECUTION_BOUND_METADATA', ['VALIDATION', false]],
  ['SESSION_FORK_PROMOTION_UNAVAILABLE', ['VALIDATION', false]],
  ['SESSION_FORK_PROMOTION_SOURCE_UNAVAILABLE', ['VALIDATION', false]],
  ['SESSION_FORK_PROMOTION_CONFLICT', ['CONFLICT', false]],
  ['SESSION_FORK_EMPTY_PREFIX', ['VALIDATION', false]],
  ['SESSION_FORK_SCOPE_MISMATCH', ['VALIDATION', false]],
  ['SESSION_FORK_MESSAGE_SCOPE_MISMATCH', ['VALIDATION', false]],
  ['SESSION_FORK_DUPLICATE_CHILD_MESSAGE', ['VALIDATION', false]],
  ['SESSION_FORK_CHILD_ANCHOR_NOT_COPIED', ['VALIDATION', false]],
  ['SESSION_FORK_ACTIVE_CONTEXT_REF_NOT_COPIED', ['VALIDATION', false]],
  ['SESSION_FORK_ACTIVE_CONTEXT_INVALID', ['INTERNAL', false]],
  ['SESSION_FORK_ANCHOR_REMAP_FAILED', ['INTERNAL', false]],
  ['SESSION_FORK_EVENT_SCOPE_MISMATCH', ['VALIDATION', false]],
  ['SESSION_FORK_PROCESS_STATUS_INVALID', ['VALIDATION', false]],
  ['SESSION_FORK_TIMELINE_SNAPSHOT_INVALID', ['VALIDATION', false]],
  ['SESSION_EVENT_HISTORY_RECORD_INVALID', ['VALIDATION', false]],
  ['SESSION_FORK_EVENT_PAYLOAD_UNSAFE', ['VALIDATION', false]],
  ['SESSION_FORK_PROCESS_MESSAGE_REFERENCE_INVALID', ['VALIDATION', false]],
  ['SESSION_FORK_SOURCE_RUN_NOT_FOUND', ['VALIDATION', false]],
  ['SESSION_FORK_EVENT_REMAP_FAILED', ['VALIDATION', false]],
  ['SESSION_FORK_IDEMPOTENCY_CORRUPT', ['INTERNAL', true]],
  ['SESSION_FORK_UNAVAILABLE', ['UNAVAILABLE', true]],
  ['SESSION_FORK_CANCELED', ['CANCELED', false]],
  ['SESSION_FORK_TIMEOUT', ['TIMEOUT', true]],
  ['SESSION_FORK_PROVIDER_UNAUTHORIZED', ['AUTHORIZATION', false]],
  ['SESSION_FORK_PROVIDER_INVALID_RESPONSE', ['UNAVAILABLE', false]],
  ['SESSION_FORK_INTERNAL', ['INTERNAL', true]],
]);

async function executeForkOperation<TResult>(operation: () => Promise<TResult>): Promise<TResult> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof AgentError) {
      const tuple = canonicalForkErrorTuples.get(error.code);
      if (tuple?.[0] === error.category && tuple[1] === error.retryable) {
        throw error;
      }
    }
    throw new AgentError({
      code: 'SESSION_FORK_INTERNAL',
      message: 'Session fork failed internally.',
      category: 'INTERNAL',
      retryable: true,
    });
  }
}

function assertNotCanceled(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new AgentError({
      code: 'SESSION_FORK_CANCELED',
      message: 'Session fork was canceled.',
      category: 'CANCELED',
      retryable: false,
    });
  }
}
