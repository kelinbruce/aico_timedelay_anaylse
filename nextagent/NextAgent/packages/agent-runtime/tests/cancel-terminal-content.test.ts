import {
  AgentError,
  brand,
  type AgentId,
  type AgentType,
  type AgentVersion,
  type CheckpointId,
  type EpochMillis,
  type MessageId,
  type PendingInputId,
  type RequestLocale,
  type SessionId,
  type TenantId,
  type TimelineSequence,
} from '@nextagent/agent-common';
import type { AgentAssembly, AgentAssemblyRegistry } from '@nextagent/agent-contracts/agent-assembly';
import type { CapabilityCatalog } from '@nextagent/agent-contracts/capability';
import type {
  ActiveContextStoreGateway,
  CheckpointRecord,
  CheckpointStoreGateway,
  PendingInputRecord,
  PendingInputStoreGateway,
  RequestRunRecord,
  RequestRunStoreGateway,
  RunTimelineEventRecord,
  RunTimelineEventStoreGateway,
  SessionMessageRecord,
  SessionMessageStoreGateway,
} from '@nextagent/agent-contracts/gateway';
import type {
  Agent,
  AgentConstructor,
  AgentExecutionOutcome,
  AgentRunStatePort,
  PendingInputRequest,
  RequestContext,
  RequestRun,
} from '@nextagent/agent-contracts/runtime';
import type { UserSession, UserSessionPort } from '@nextagent/agent-contracts/session';
import { RequestLifecycleCoordinator } from '@nextagent/agent-runtime';
import { describe, expect, it } from 'vitest';

const tenantId = brand<string, 'TenantId'>('tenant-cancel-content');
const subjectId = brand<string, 'SubjectId'>('subject-cancel-content');
const agentId = brand<string, 'AgentId'>('agent-cancel-content');
const agentVersion = brand<string, 'AgentVersion'>('v1');
const sessionId = brand<string, 'SessionId'>('session-cancel-content');
const identityContext = { tenantId, subjectId, displayName: 'Cancel Content Test' };

describe('cancel terminal content (D1 + D7)', () => {
  it('publishes non-blocking execution-state transitions only for runs that enter execution', async () => {
    const harness = makeHarness();
    const transitions: Array<{ transition: string; activeCount: number; runId: string; queueDurationMs?: number }> = [];
    const coordinator = new RequestLifecycleCoordinator({
      ...harness.deps,
      runExecutionStateListeners: [
        () => {
          throw new Error('listener failure must be isolated');
        },
        (transition) => transitions.push(transition),
      ],
    });
    const executing = await coordinator.submit({
      sessionId,
      identityContext,
      inputText: 'first request enters execution',
      attachmentIds: [],
      locale: brand<string, 'RequestLocale'>('zh-CN'),
      idempotencyKey: brand<string, 'IdempotencyKey'>('idem-transition-executing'),
    });
    await harness.agentStartedPromise;
    await coordinator.cancel({
      sessionId,
      identityContext,
      expectedLatestRequestId: executing.requestId,
      action: 'CANCEL',
      idempotencyKey: brand<string, 'IdempotencyKey'>('idem-transition-cancel-executing'),
    });
    await coordinator.waitForIdle({ timeoutMs: 5_000 });

    expect(transitions.filter((transition) => transition.runId === executing.runId)).toEqual([
      expect.objectContaining({ transition: 'ENTERED', activeCount: 1, queueDurationMs: expect.any(Number) }),
      expect.objectContaining({ transition: 'LEFT', activeCount: 0 }),
    ]);
  });

  it('D1: cancel catch path uses fixed placeholder, not safeErrorContent', async () => {
    const harness = makeHarness();
    const coordinator = new RequestLifecycleCoordinator(harness.deps);
    const accepted = await coordinator.submit({
      sessionId,
      identityContext,
      inputText: 'diagnose RAN alarm',
      attachmentIds: [],
      locale: brand<string, 'RequestLocale'>('zh-CN'),
      idempotencyKey: brand<string, 'IdempotencyKey'>('idem-d1-submit'),
    });

    await harness.agentStartedPromise;
    await coordinator.cancel({
      sessionId,
      identityContext,
      expectedLatestRequestId: accepted.requestId,
      action: 'CANCEL',
      idempotencyKey: brand<string, 'IdempotencyKey'>('idem-d1-cancel'),
    });
    await coordinator.waitForIdle({ timeoutMs: 5_000 });

    const canceledMessages = [...harness.messageRecords.values()].filter(
      (m) => m.role === 'ASSISTANT' && (m.metadata as { status?: string })?.status === 'CANCELED',
    );
    expect(canceledMessages).toHaveLength(1);
    const content = canceledMessages[0]!.content;
    expect(content).toBe('Request canceled by user.');
    expect(content).not.toMatch(/Request failed:/);
    expect(content).not.toMatch(/Model invocation/);
  });

  it('D7: cancel of queued run uses original requestContextId in terminal event', async () => {
    const harness = makeHarness();
    const transitions: Array<{ transition: string; runId: string }> = [];
    const coordinator = new RequestLifecycleCoordinator({
      ...harness.deps,
      runExecutionStateListeners: [(transition) => transitions.push(transition)],
    });

    // Submit request 1 — it starts executing and hangs (blocking the lane).
    const accepted1 = await coordinator.submit({
      sessionId,
      identityContext,
      inputText: 'first request blocks lane',
      attachmentIds: [],
      locale: brand<string, 'RequestLocale'>('zh-CN'),
      idempotencyKey: brand<string, 'IdempotencyKey'>('idem-d7-submit-1'),
    });
    await harness.agentStartedPromise;

    // Submit request 2 — it gets queued because the lane is busy.
    const accepted2 = await coordinator.submit({
      sessionId,
      identityContext,
      inputText: 'second request queued',
      attachmentIds: [],
      locale: brand<string, 'RequestLocale'>('zh-CN'),
      idempotencyKey: brand<string, 'IdempotencyKey'>('idem-d7-submit-2'),
    });

    // Cancel request 2 while it is queued (non-executing).
    // commitCanceledRun is awaited inside cancel(), so terminal events are already persisted.
    await coordinator.cancel({
      sessionId,
      identityContext,
      expectedLatestRequestId: accepted2.requestId,
      action: 'CANCEL',
      idempotencyKey: brand<string, 'IdempotencyKey'>('idem-d7-cancel-2'),
    });

    // Find the REQUEST_ACCEPTED and REQUEST_CANCELED events for run 2.
    const run2Events = harness.timelineEvents.filter(
      (e) => e.runId === accepted2.runId && (e.type === 'REQUEST_ACCEPTED' || e.type === 'REQUEST_CANCELED'),
    );
    const acceptedEvent = run2Events.find((e) => e.type === 'REQUEST_ACCEPTED');
    const canceledEvent = run2Events.find((e) => e.type === 'REQUEST_CANCELED');
    expect(acceptedEvent).toBeDefined();
    expect(canceledEvent).toBeDefined();

    const acceptedCtx = (acceptedEvent as RuntimeRunTimelineEventRecord).requestContextId;
    const canceledCtx = (canceledEvent as RuntimeRunTimelineEventRecord).requestContextId;
    expect(canceledCtx).toBe(acceptedCtx);
    expect(canceledCtx).not.toMatch(/^context-cancel/);
    expect(transitions.filter((transition) => transition.runId === accepted2.runId)).toEqual([]);
  });
});

describe('cancel terminal content multi-stage (task 1.3)', () => {
  it('cancel during model content streaming preserves finalContent', async () => {
    const harness = makeHarness({ agentMode: 'stream-then-hang' });
    const coordinator = new RequestLifecycleCoordinator(harness.deps);
    const accepted = await coordinator.submit({
      sessionId,
      identityContext,
      inputText: 'stream content then cancel',
      attachmentIds: [],
      locale: brand<string, 'RequestLocale'>('zh-CN'),
      idempotencyKey: brand<string, 'IdempotencyKey'>('idem-1.3-content-submit'),
    });
    await harness.agentStartedPromise;
    await coordinator.cancel({
      sessionId,
      identityContext,
      expectedLatestRequestId: accepted.requestId,
      action: 'CANCEL',
      idempotencyKey: brand<string, 'IdempotencyKey'>('idem-1.3-content-cancel'),
    });
    await coordinator.waitForIdle({ timeoutMs: 5_000 });

    const canceledMessages = [...harness.messageRecords.values()].filter(
      (m) => m.role === 'ASSISTANT' && (m.metadata as { status?: string })?.status === 'CANCELED',
    );
    expect(canceledMessages).toHaveLength(1);
    const content = canceledMessages[0]!.content;
    expect(content).toBe('streamed partial content');
    expect(content).not.toMatch(/Request failed:/);
    expect(content).not.toMatch(/Model invocation/);
  });

  it('cancel during capability execution produces same placeholder as thinking stage', async () => {
    // Uses a different AgentError code/category than the thinking-stage test (D1).
    // This proves the catch path is stage-agnostic: any error from any stage
    // produces the same 'Request canceled by user.' placeholder when no content was streamed.
    const harness = makeHarness({ agentMode: 'capability-error' });
    const coordinator = new RequestLifecycleCoordinator(harness.deps);
    const accepted = await coordinator.submit({
      sessionId,
      identityContext,
      inputText: 'capability then cancel',
      attachmentIds: [],
      locale: brand<string, 'RequestLocale'>('zh-CN'),
      idempotencyKey: brand<string, 'IdempotencyKey'>('idem-1.3-cap-submit'),
    });
    await harness.agentStartedPromise;
    await coordinator.cancel({
      sessionId,
      identityContext,
      expectedLatestRequestId: accepted.requestId,
      action: 'CANCEL',
      idempotencyKey: brand<string, 'IdempotencyKey'>('idem-1.3-cap-cancel'),
    });
    await coordinator.waitForIdle({ timeoutMs: 5_000 });

    const canceledMessages = [...harness.messageRecords.values()].filter(
      (m) => m.role === 'ASSISTANT' && (m.metadata as { status?: string })?.status === 'CANCELED',
    );
    expect(canceledMessages).toHaveLength(1);
    const content = canceledMessages[0]!.content;
    expect(content).toBe('Request canceled by user.');
    expect(content).not.toMatch(/Request failed:/);
    expect(content).not.toMatch(/Model invocation/);
    expect(content).not.toMatch(/CAPABILITY/);
  });
});

describe('cancel pending input run requestContextId (task 3.3)', () => {
  it('cancel of pending-input run uses original requestContextId', async () => {
    const harness = makeHarness({ agentMode: 'pending-input' });
    const coordinator = new RequestLifecycleCoordinator(harness.deps);
    const accepted = await coordinator.submit({
      sessionId,
      identityContext,
      inputText: 'trigger pending input',
      attachmentIds: [],
      locale: brand<string, 'RequestLocale'>('zh-CN'),
      idempotencyKey: brand<string, 'IdempotencyKey'>('idem-3.3-submit'),
    });
    await harness.agentStartedPromise;

    // The run is now in pending-input state. Cancel it.
    await coordinator.cancel({
      sessionId,
      identityContext,
      expectedLatestRequestId: accepted.requestId,
      action: 'CANCEL',
      idempotencyKey: brand<string, 'IdempotencyKey'>('idem-3.3-cancel'),
    });

    // Find REQUEST_ACCEPTED and REQUEST_CANCELED events for this run.
    const runEvents = harness.timelineEvents.filter(
      (e) => e.runId === accepted.runId && (e.type === 'REQUEST_ACCEPTED' || e.type === 'REQUEST_CANCELED'),
    );
    const acceptedEvent = runEvents.find((e) => e.type === 'REQUEST_ACCEPTED');
    const canceledEvent = runEvents.find((e) => e.type === 'REQUEST_CANCELED');
    expect(acceptedEvent).toBeDefined();
    expect(canceledEvent).toBeDefined();

    const acceptedCtx = (acceptedEvent as RuntimeRunTimelineEventRecord).requestContextId;
    const canceledCtx = (canceledEvent as RuntimeRunTimelineEventRecord).requestContextId;
    expect(canceledCtx).toBe(acceptedCtx);
    expect(canceledCtx).not.toMatch(/^context-cancel/);
  });
});

// --- Harness ---

type RuntimeRunTimelineEventRecord = Extract<RunTimelineEventRecord, { requestContextId: string }>;

type AgentMode = 'hang' | 'stream-then-hang' | 'capability-error' | 'pending-input' | 'complete';

function makeHarness(opts: { agentMode?: AgentMode; commitTerminalThrows?: boolean } = {}): {
  runRecords: Map<string, RequestRunRecord>;
  messageRecords: Map<string, SessionMessageRecord>;
  timelineEvents: RunTimelineEventRecord[];
  agentStartedPromise: Promise<void>;
  deps: import('@nextagent/agent-runtime').RequestLifecycleDependencies<object>;
} {
  const agentMode = opts.agentMode ?? 'hang';
  const commitTerminalThrows = opts.commitTerminalThrows ?? false;
  const assembly = makeAssembly();
  const session: UserSession = {
    tenantId,
    subjectId,
    agentId: assembly.agentId,
    sessionId,
    title: 'Cancel Content Session',
    createdAt: brand<number, 'EpochMillis'>(1),
    updatedAt: brand<number, 'EpochMillis'>(1),
    hasInFlightRequest: false,
  };
  const runRecords = new Map<string, RequestRunRecord>();
  const idempotencyRecords = new Map<string, RequestRunRecord>();
  const timelineEvents: RunTimelineEventRecord[] = [];
  const messageRecords = new Map<string, SessionMessageRecord>();
  const checkpoints = new Map<string, CheckpointRecord>();
  const pendingInputRecords = new Map<string, PendingInputRecord>();

  let idCounter = 0;
  const nextId = (prefix: string): string => `${prefix}-${++idCounter}`;
  let resolveAgentStarted: () => void;
  const agentStartedPromise = new Promise<void>((resolve) => {
    resolveAgentStarted = resolve;
  });

  const requestRunStore: RequestRunStoreGateway = {
    async saveRun(record, options) {
      const existing = runRecords.get(record.runId);
      if (options.expectedVersion !== undefined) {
        if (existing === undefined || existing.version !== options.expectedVersion) {
          return { status: 'VERSION_CONFLICT' as const };
        }
      } else if (existing !== undefined) {
        return { status: 'UPDATED' as const, record: existing };
      }
      runRecords.set(record.runId, record);
      if (options.idempotencyKey !== undefined) {
        idempotencyRecords.set(`${record.sessionId}:${options.idempotencyKey}:${options.idempotencySemantic ?? ''}`, record);
      }
      return { status: 'UPDATED' as const, record };
    },
    async loadRun(request) {
      return runRecords.get(request.runId);
    },
    async listRuns(request) {
      return { items: [], offset: request.offset, limit: request.limit, hasMore: false };
    },
    async loadSessionLaneSnapshot(request) {
      const records = [...runRecords.values()].filter((r) => r.sessionId === request.sessionId && r.agentId === request.agentId);
      const latestRun = records.at(-1);
      return {
        tenantId: request.tenantId,
        subjectId: request.subjectId,
        agentId: request.agentId,
        sessionId: request.sessionId,
        ...(latestRun === undefined ? {} : { latestRequestId: latestRun.requestId, latestRun }),
        queuedRuns: records.filter((r) => r.status === 'QUEUED'),
      };
    },
    async loadRunByIdempotencyKey(request) {
      const record = idempotencyRecords.get(`${request.sessionId}:${request.idempotencyKey}:${request.idempotencySemantic}`);
      return record === undefined ? { status: 'NOT_FOUND' as const } : { status: 'FOUND' as const, record };
    },
    async claimRun() {
      return { status: 'VERSION_CONFLICT' as const };
    },
    async listRecoverableRuns() {
      return [];
    },
    async commitTerminal(request) {
      const existing = runRecords.get(request.runId);
      if (existing === undefined || existing.version !== request.expectedVersion) {
        return { status: 'VERSION_CONFLICT' as const };
      }
      const committed: RequestRunRecord = {
        ...existing,
        status: request.terminalStatus,
        terminalCommitState: 'COMMITTED',
        version: existing.version + 1,
        updatedAt: request.terminalEvent.createdAt,
      };
      runRecords.set(request.runId, committed);
      messageRecords.set(request.terminalMessage.messageId, request.terminalMessage);
      timelineEvents.push(request.terminalEvent);
      return { status: 'COMMITTED' as const, terminalEvent: request.terminalEvent };
    },
  };

  const messageStore: SessionMessageStoreGateway = {
    async appendSessionMessage(record) {
      messageRecords.set(record.messageId, record);
      return record;
    },
    async loadMessage(request) {
      return messageRecords.get(request.messageId);
    },
    async listSessionMessages() {
      return { items: [], limit: 20, hasMore: false };
    },
    async loadMessages() {
      return [];
    },
    async listConversationPreview() {
      return { sessionId: session.sessionId, totalMarkers: 0, offset: 0, limit: 100, markers: [] };
    },
    async listMessages() {
      return { items: [], limit: 20, hasMore: false };
    },
    async listCurrentRequestMessages(request) {
      return {
        items: [...messageRecords.values()].filter((r) => r.sessionId === request.sessionId && r.requestId === request.requestId),
        offset: request.offset,
        limit: request.limit,
        hasMore: false,
      };
    },
    async hideMessage() {
      return undefined;
    },
    async hideRequestMessages() {
      return 0;
    },
  } as SessionMessageStoreGateway;

  const timelineStore: RunTimelineEventStoreGateway = {
    async appendEvent(record) {
      const persisted = { ...record, sequence: brand<number, 'TimelineSequence'>(timelineEvents.length + 1) };
      timelineEvents.push(persisted);
      return persisted;
    },
    async listEvents(request) {
      return timelineEvents.filter((r) => r.sessionId === request.sessionId && Number(r.sequence) > Number(request.afterSequence));
    },
  };

  const checkpointStore: CheckpointStoreGateway = {
    async saveCheckpoint(record) {
      checkpoints.set(record.runId, record);
      return record;
    },
    async loadCheckpoint(request) {
      return checkpoints.get(request.runId);
    },
  } as CheckpointStoreGateway;

  const activeContextStore: ActiveContextStoreGateway = {
    async loadActiveContext() {
      return {
        state: { tenantId, subjectId, agentId: assembly.agentId, sessionId, activeContextVersion: 0, updatedAt: brand<number, 'EpochMillis'>(1) },
        items: [],
      };
    },
    async appendItem() {
      throw new AgentError({ code: 'NOT_USED', message: 'not used', category: 'INTERNAL', retryable: false });
    },
    async replaceActiveContext() {
      throw new AgentError({ code: 'NOT_USED', message: 'not used', category: 'INTERNAL', retryable: false });
    },
    async commitCompaction() {
      throw new AgentError({ code: 'NOT_USED', message: 'not used', category: 'INTERNAL', retryable: false });
    },
    async updateMetadata() {
      return { status: 'UPDATED' as const };
    },
  } as ActiveContextStoreGateway;

  const userSessions: UserSessionPort = {
    async createSession() {
      return session;
    },
    async requireSession() {
      return session;
    },
    async listSessions() {
      return { entries: [session], offset: 0, limit: 20, hasMore: false };
    },
    async deleteSession() {
      return undefined;
    },
    async listMessages() {
      return { items: [], limit: 20, hasMore: false };
    },
    async listConversationPreview() {
      return { sessionId: session.sessionId, totalMarkers: 0, offset: 0, limit: 100, markers: [] };
    },
    async listCurrentRequestMessages() {
      return { items: [], limit: 20, hasMore: false };
    },
    async generateTitle() {
      return false;
    },
    async updateTitle() {
      return session;
    },
  };

  const pendingInputStore: PendingInputStoreGateway = {
    async createPendingInput(request) {
      pendingInputRecords.set(request.record.pendingInputId, request.record);
      return request.record;
    },
    async loadPendingInput(request) {
      return pendingInputRecords.get(request.pendingInputId);
    },
    async loadActivePendingInput(request) {
      for (const record of pendingInputRecords.values()) {
        if (record.sessionId === request.sessionId && record.status === 'PENDING') {
          return record;
        }
      }
      return undefined;
    },
    async listUnresolvedPendingInputTimeoutFacts() {
      return [];
    },
    async resolvePendingInput(request) {
      const current = pendingInputRecords.get(request.pendingInputId);
      if (current === undefined || current.status !== request.expectedStatus) {
        return { status: 'VERSION_CONFLICT' as const };
      }
      const updated = { ...current, status: request.status, updatedAt: brand<number, 'EpochMillis'>(Number(current.updatedAt) + 5_000) };
      pendingInputRecords.set(request.pendingInputId, updated);
      return { status: 'UPDATED' as const, record: updated };
    },
  };

  const agentConstructor = makeAgentConstructor(agentMode, () => resolveAgentStarted!(), {
    nextId,
    pendingInputRecords,
    runRecords,
    checkpoints,
    timelineEvents,
    messageRecords,
  });

  return {
    runRecords,
    messageRecords,
    timelineEvents,
    agentStartedPromise,
    deps: {
      defaultRouteAgentId: assembly.agentId,
      agentConstructors: [agentConstructor],
      agentRuntimeDependencies: {},
      assemblyRegistry: {
        async active() {
          return assembly;
        },
        async require() {
          return assembly;
        },
      } as AgentAssemblyRegistry,
      requestRunStore,
      messageStore,
      timelineStore,
      checkpointStore,
      activeContextStore,
      userSessions,
      pendingInputStore,
      capabilityCatalog: {} as CapabilityCatalog,
      internalObserver: () => undefined,
    } as import('@nextagent/agent-runtime').RequestLifecycleDependencies<object>,
  };
}

function makeAssembly(): AgentAssembly {
  return {
    agentId,
    agentVersion,
    agentAssemblyRef: 'agent-cancel-content@v1',
    agentType: brand<string, 'AgentType'>('DEFAULT') as AgentType,
    title: 'Cancel Content',
    displayName: 'Cancel Content',
    description: 'runtime test assembly',
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
}

interface AgentHelper {
  readonly nextId: (prefix: string) => string;
  readonly pendingInputRecords: Map<string, PendingInputRecord>;
  readonly runRecords: Map<string, RequestRunRecord>;
  readonly checkpoints: Map<string, CheckpointRecord>;
  readonly timelineEvents: RunTimelineEventRecord[];
  readonly messageRecords: Map<string, SessionMessageRecord>;
}

function makeAgentConstructor(
  mode: AgentMode,
  onStarted: () => void,
  helper: AgentHelper,
): AgentConstructor<{ readonly runState: AgentRunStatePort }> {
  return class TestAgent {
    private readonly runState: AgentRunStatePort;
    constructor(kit: { readonly runState: AgentRunStatePort }) {
      this.runState = kit.runState;
    }
    static getType(): AgentType {
      return brand<string, 'AgentType'>('DEFAULT') as AgentType;
    }

    async execute(run: RequestRun, context: RequestContext, signal: AbortSignal): Promise<AgentExecutionOutcome> {
      onStarted();

      if (mode === 'stream-then-hang') {
        // Emit LLM_CONTENT_DELTA via runState so finishRun accumulates finalContent.
        await this.runState.emitEvent(run, context, {
          type: 'LLM_CONTENT_DELTA',
          inlinePayload: { content: 'streamed partial content' },
        });
        return hangUntilAbort(signal);
      }

      if (mode === 'capability-error') {
        // Simulate a capability execution stage that throws a different error
        // (not MODEL_INVOCATION_CANCELED) when aborted, proving stage-agnosticism.
        return new Promise<AgentExecutionOutcome>((_resolve, reject) => {
          signal.addEventListener('abort', () => {
            reject(
              new AgentError({
                code: 'CAPABILITY_EXECUTION_INTERRUPTED',
                message: 'Capability execution was interrupted by cancel.',
                category: 'CANCELED',
                retryable: false,
              }),
            );
          });
        });
      }

      if (mode === 'pending-input') {
        // Create a pending input record, then return PENDING_INPUT outcome.
        const pendingInputId = brand<string, 'PendingInputId'>(helper.nextId('pi'));
        const checkpointId = brand<string, 'CheckpointId'>(helper.nextId('ckpt'));
        const pendingInput: PendingInputRecord = {
          tenantId,
          subjectId,
          agentId: run.agentId,
          pendingInputId,
          requestRunId: run.runId,
          sessionId: run.sessionId,
          requestId: run.requestId,
          requestContextId: context.requestContextId,
          checkpointId,
          kind: 'QUESTION',
          request: {
            id: pendingInputId,
            sessionId: run.sessionId,
            kind: 'QUESTION',
            questions: [{ prompt: 'Select an option', options: [{ label: 'OK', value: 'ok' }] }],
          },
          producerRef: { kind: 'LIFECYCLE_HOOK' },
          status: 'PENDING',
          createdAt: brand<number, 'EpochMillis'>(Date.now()),
          updatedAt: brand<number, 'EpochMillis'>(Date.now()),
        };
        helper.pendingInputRecords.set(pendingInputId, pendingInput);
        const pendingInputRequest: PendingInputRequest = {
          id: pendingInputId,
          sessionId: run.sessionId,
          kind: 'QUESTION',
          questions: pendingInput.request.questions,
        };
        return { status: 'PENDING_INPUT', pendingInput: pendingInputRequest };
      }

      // Default: hang mode (thinking stage, no content)
      return hangUntilAbort(signal);
    }
  };
}

function hangUntilAbort(signal: AbortSignal): Promise<AgentExecutionOutcome> {
  if (signal.aborted) {
    return Promise.reject(
      new AgentError({
        code: 'MODEL_INVOCATION_CANCELED',
        message: 'Model invocation was canceled.',
        category: 'CANCELED',
        retryable: false,
      }),
    );
  }
  return new Promise<AgentExecutionOutcome>((_resolve, reject) => {
    signal.addEventListener('abort', () => {
      reject(
        new AgentError({
          code: 'MODEL_INVOCATION_CANCELED',
          message: 'Model invocation was canceled.',
          category: 'CANCELED',
          retryable: false,
        }),
      );
    });
  });
}
