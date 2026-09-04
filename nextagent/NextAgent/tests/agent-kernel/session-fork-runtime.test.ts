import { AgentError, brand, type AgentType, type EpochMillis } from '@nextagent/agent-common';
import type { AgentAssembly } from '@nextagent/agent-contracts/agent-assembly';
import type {
  ForkPromotionContent,
  ForkProcessSnapshotStatusRecord,
  ForkSessionResult,
  PrepareForkResult,
  SessionForkSourceRecord,
  SessionForkStoreGateway,
  SessionRecord,
} from '@nextagent/agent-contracts/gateway';
import { createRequestLifecycleCoordinator, type RequestLifecycleDependencies } from '@nextagent/agent-runtime';
import { createUserSessionService } from '@nextagent/agent-session';
import { createTestAgentConstructor } from '../fixtures/test-agent.js';
import { createTestGatewayStores } from '../fixtures/local-gateway.js';
import { describe, expect, it, vi } from 'vitest';

const identityContext = {
  tenantId: brand<string, 'TenantId'>('tenant-fork-runtime'),
  subjectId: brand<string, 'SubjectId'>('subject-fork-runtime'),
  displayName: 'runtime fork tester',
};
const agentId = brand<string, 'AgentId'>('agent-fork-runtime');
const sourceSessionId = brand<string, 'SessionId'>('source-runtime');
const sourceMessageId = brand<string, 'MessageId'>('source-answer');
const sourceRequestId = brand<string, 'MessageId'>('source-request');
const forkAttemptId = brand<string, 'ForkAttemptId'>('fork-attempt');

function at(value: number): EpochMillis {
  return brand<number, 'EpochMillis'>(value);
}

function sourceSession(): SessionRecord {
  return {
    tenantId: identityContext.tenantId,
    subjectId: identityContext.subjectId,
    agentId,
    sessionId: sourceSessionId,
    title: 'Source title',
    createdAt: at(1),
    updatedAt: at(1),
  };
}

function childResult(replayed = false): ForkSessionResult {
  return {
    childSession: {
      tenantId: identityContext.tenantId,
      subjectId: identityContext.subjectId,
      agentId,
      sessionId: brand<string, 'SessionId'>('child-session'),
      title: 'Fork · Source title',
      createdAt: at(2),
      updatedAt: at(2),
    },
    replayed,
  };
}

function forkStore(overrides: Partial<SessionForkStoreGateway> = {}): SessionForkStoreGateway {
  const prepared: PrepareForkResult = { forkAttemptId, requiredContentRefs: [], maxPromotedBytes: 2_000_000 };
  return {
    prepareFork: vi.fn(async () => prepared),
    stageForkPromotion: vi.fn(async (request) => ({
      forkAttemptId: request.forkAttemptId,
      sourceMessageId: request.sourceMessageId,
      sourceRefId: request.sourceRefId,
      promotedContentId: 'fork-promoted:1',
    })),
    forkSession: vi.fn(async () => childResult()),
    abortForkPromotions: vi.fn(async () => undefined),
    loadSessionForkSource: vi.fn(async (): Promise<SessionForkSourceRecord | undefined> => undefined),
    loadForkProcessSnapshotStatus: vi.fn(async (): Promise<ForkProcessSnapshotStatusRecord | undefined> => undefined),
    hasUserMessageAfterForkAnchor: vi.fn(async () => false),
    loadCommittedForkPromotionContent: vi.fn(async (): Promise<ForkPromotionContent | undefined> => undefined),
    cleanupExpiredForkPromotions: vi.fn(async () => ({ cleanedCount: 0, retryableCount: 0 })),
    ...overrides,
  };
}

async function setupRuntime(store: SessionForkStoreGateway, resolver?: RequestLifecycleDependencies['forkPromotionContentResolver']) {
  const gateway = createTestGatewayStores();
  await gateway.sessions.saveSession(sourceSession());
  const assembly: AgentAssembly = {
    agentId,
    agentVersion: brand<string, 'AgentVersion'>('v1'),
    agentAssemblyRef: 'agent-fork-runtime:v1',
    agentType: brand<string, 'AgentType'>('default') as AgentType,
    title: 'Fork runtime',
    displayName: 'Fork runtime',
    description: 'fork runtime test assembly',
    capabilityBindings: [],
    prompts: [],
    recipes: [],
    hooks: [],
    runtimeSettings: {},
    workspacePolicy: { mode: 'DEFAULT' },
    modelIds: [],
    userInvocable: false,
    agentInvocation: { enabled: false },
  } as unknown as AgentAssembly;
  const runtime = createRequestLifecycleCoordinator({
    agentConstructors: [createTestAgentConstructor(async () => undefined)],
    agentRuntimeDependencies: {},
    assemblyRegistry: {
      async active() {
        return assembly;
      },
      async require() {
        return assembly;
      },
    },
    capabilityCatalog: {} as RequestLifecycleDependencies['capabilityCatalog'],
    defaultRouteAgentId: agentId,
    userSessions: createUserSessionService({
      sessionStore: gateway.sessions,
      messageStore: gateway.messages,
      sessionForkStore: store,
      activeContextStore: gateway.activeContext,
    }),
    messageStore: gateway.messages,
    sessionForkStore: store,
    ...(resolver === undefined ? {} : { forkPromotionContentResolver: resolver }),
    activeContextStore: gateway.activeContext,
    requestRunStore: gateway.requestRuns,
    timelineStore: gateway.timeline,
    checkpointStore: gateway.checkpoints,
    recoveryAgentId: agentId,
  });
  return { runtime, gateway };
}

describe('runtime session fork bounded coordination', () => {
  it('delegates a message anchor as independent scalar fields without reading source history', async () => {
    const store = forkStore();
    const { runtime } = await setupRuntime(store);
    const result = await runtime.forkFromMessage({
      identityContext,
      sourceSessionId,
      sourceAnchorMessageId: sourceMessageId,
      idempotencyKey: brand<string, 'IdempotencyKey'>('message-key'),
    });
    expect(result.childSession.sessionId).toBe('child-session');
    expect(store.prepareFork).toHaveBeenCalledWith(
      {
        tenantId: identityContext.tenantId,
        subjectId: identityContext.subjectId,
        agentId,
        sourceSessionId,
        sourceMessageId,
        idempotencyKey: 'message-key',
      },
      undefined,
    );
    expect(store.forkSession).toHaveBeenCalledWith(expect.objectContaining({ sourceMessageId, forkAttemptId }), undefined);
    expect(store.stageForkPromotion).not.toHaveBeenCalled();
  });

  it('delegates request anchors without resolving them in Runtime', async () => {
    const store = forkStore();
    const { runtime } = await setupRuntime(store);
    await runtime.forkFromRequest({
      identityContext,
      sourceSessionId,
      sourceRequestId,
      idempotencyKey: brand<string, 'IdempotencyKey'>('request-key'),
    });
    expect(store.prepareFork).toHaveBeenCalledWith(expect.objectContaining({ sourceRequestId }), undefined);
    expect(store.forkSession).toHaveBeenCalledWith(expect.objectContaining({ sourceRequestId, forkAttemptId }), undefined);
    expect((store.prepareFork as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]).not.toHaveProperty('sourceMessageId');
  });

  it('resolves and stages only refs returned by prepare in canonical order', async () => {
    const requiredContentRefs = [
      {
        sourceMessageId,
        sourceRequestId,
        sourceRunId: brand<string, 'RequestRunId'>('source-run'),
        agentVersion: brand<string, 'AgentVersion'>('v1'),
        refType: 'CAPABILITY_RESULT' as const,
        refId: 'tool-results/result-1',
      },
    ];
    const store = forkStore({
      prepareFork: vi.fn(async () => ({ forkAttemptId, requiredContentRefs, maxPromotedBytes: 10 })),
    });
    const resolver = {
      resolveForkPromotionContent: vi.fn(async () => ({ bytes: new Uint8Array([1, 2, 3]), mimeType: 'text/plain' })),
    };
    const { runtime } = await setupRuntime(store, resolver);
    await runtime.forkFromMessage({
      identityContext,
      sourceSessionId,
      sourceAnchorMessageId: sourceMessageId,
      idempotencyKey: brand<string, 'IdempotencyKey'>('ref-key'),
    });
    expect(resolver.resolveForkPromotionContent).toHaveBeenCalledWith(
      expect.objectContaining({ refId: 'tool-results/result-1', maxBytes: 10 }),
      undefined,
    );
    expect(store.stageForkPromotion).toHaveBeenCalledWith(
      expect.objectContaining({ forkAttemptId, sourceMessageId, sourceRefId: 'tool-results/result-1', sizeBytes: 3 }),
      undefined,
    );
  });

  it('best-effort aborts staged residue without replacing the original failure', async () => {
    const original = new AgentError({
      code: 'SESSION_FORK_PROMOTION_SOURCE_UNAVAILABLE',
      message: 'source unavailable',
      category: 'VALIDATION',
      retryable: false,
    });
    const store = forkStore({
      prepareFork: vi.fn(async () => ({
        forkAttemptId,
        maxPromotedBytes: 10,
        requiredContentRefs: [
          {
            sourceMessageId,
            sourceRequestId,
            sourceRunId: brand<string, 'RequestRunId'>('source-run'),
            agentVersion: brand<string, 'AgentVersion'>('v1'),
            refType: 'CAPABILITY_RESULT' as const,
            refId: 'tool-results/result-1',
          },
        ],
      })),
      abortForkPromotions: vi.fn(async () => {
        throw new Error('abort failed');
      }),
    });
    const { runtime } = await setupRuntime(store, {
      resolveForkPromotionContent: vi.fn(async () => {
        throw original;
      }),
    });
    await expect(
      runtime.forkFromMessage({
        identityContext,
        sourceSessionId,
        sourceAnchorMessageId: sourceMessageId,
        idempotencyKey: brand<string, 'IdempotencyKey'>('failure-key'),
      }),
    ).rejects.toBe(original);
    expect(store.abortForkPromotions).toHaveBeenCalledWith(expect.objectContaining({ forkAttemptId }));
    expect(store.forkSession).not.toHaveBeenCalled();
  });

  it('propagates cancellation to prepare, resolver, stage and fork', async () => {
    const controller = new AbortController();
    const store = forkStore();
    const { runtime } = await setupRuntime(store);
    controller.abort();
    await expect(
      runtime.forkFromMessage(
        {
          identityContext,
          sourceSessionId,
          sourceAnchorMessageId: sourceMessageId,
          idempotencyKey: brand<string, 'IdempotencyKey'>('cancel-key'),
        },
        controller.signal,
      ),
    ).rejects.toMatchObject({ code: 'SESSION_FORK_CANCELED' });
    expect(store.prepareFork).not.toHaveBeenCalled();
  });

  it('uses an uncanceled cleanup call when cancellation happens after prepare', async () => {
    const controller = new AbortController();
    const store = forkStore({
      prepareFork: vi.fn(async () => ({
        forkAttemptId,
        maxPromotedBytes: 10,
        requiredContentRefs: [
          {
            sourceMessageId,
            sourceRequestId,
            sourceRunId: brand<string, 'RequestRunId'>('source-run'),
            agentVersion: brand<string, 'AgentVersion'>('v1'),
            refType: 'CAPABILITY_RESULT' as const,
            refId: 'tool-results/result-1',
          },
        ],
      })),
    });
    const resolver = {
      resolveForkPromotionContent: vi.fn(async () => {
        controller.abort();
        throw new AgentError({ code: 'SESSION_FORK_CANCELED', message: 'canceled', category: 'CANCELED', retryable: false });
      }),
    };
    const { runtime } = await setupRuntime(store, resolver);
    await expect(
      runtime.forkFromMessage(
        {
          identityContext,
          sourceSessionId,
          sourceAnchorMessageId: sourceMessageId,
          idempotencyKey: brand<string, 'IdempotencyKey'>('cancel-after-prepare'),
        },
        controller.signal,
      ),
    ).rejects.toMatchObject({ code: 'SESSION_FORK_CANCELED' });
    expect(store.abortForkPromotions).toHaveBeenCalledWith(expect.objectContaining({ forkAttemptId }));
    expect((store.abortForkPromotions as ReturnType<typeof vi.fn>).mock.calls[0]).toHaveLength(1);
  });

  it('aborts the current attempt after a successful idempotency replay', async () => {
    const store = forkStore({ forkSession: vi.fn(async () => childResult(true)) });
    const { runtime } = await setupRuntime(store);
    await runtime.forkFromMessage({
      identityContext,
      sourceSessionId,
      sourceAnchorMessageId: sourceMessageId,
      idempotencyKey: brand<string, 'IdempotencyKey'>('replay-key'),
    });
    expect(store.abortForkPromotions).toHaveBeenCalledWith(expect.objectContaining({ forkAttemptId }));
  });
});
