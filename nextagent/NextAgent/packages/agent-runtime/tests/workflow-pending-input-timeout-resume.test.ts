import {
  brand,
  type AgentId,
  type AgentType,
  type AgentVersion,
  type CheckpointId,
  type EpochMillis,
  type MessageId,
  type PendingInputId,
  type RequestContextId,
  type RequestRunId,
  type SessionId,
  type SubjectId,
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
import type { Agent, AgentConstructor, AgentExecutionOutcome, RequestContext, RequestRun } from '@nextagent/agent-contracts/runtime';
import type { UserSession, UserSessionPort } from '@nextagent/agent-contracts/session';
import { RequestLifecycleCoordinator } from '@nextagent/agent-runtime';
import { describe, expect, it } from 'vitest';

const tenantId = brand<string, 'TenantId'>('tenant-timeout-resume');
const subjectId = brand<string, 'SubjectId'>('subject-timeout-resume');
const agentId = brand<string, 'AgentId'>('agent-timeout-resume');
const agentVersion = brand<string, 'AgentVersion'>('v1');
const sessionId = brand<string, 'SessionId'>('session-timeout-resume');

interface TerminalCommitEntry {
  readonly runId: RequestRunId;
  readonly terminalStatus: string;
}

interface TimeoutResumeDeps {
  readonly pendingInputStore: PendingInputStoreGateway & { readonly __records: Map<string, PendingInputRecord> };
  readonly requestRunStore: RequestRunStoreGateway & { readonly __records: Map<string, RequestRunRecord> };
  readonly checkpointStore: CheckpointStoreGateway & { readonly __records: Map<string, CheckpointRecord> };
  readonly messageStore: SessionMessageStoreGateway;
  readonly timelineStore: RunTimelineEventStoreGateway;
}

describe('RequestLifecycleCoordinator workflow pending input timeout resume', () => {
  it('resumes WORKFLOW_NODE USER_CHECK timeout with answers undefined and targetRecipe set', async () => {
    const captured: RequestContext[] = [];
    const terminalCommits: TerminalCommitEntry[] = [];
    const timelineEvents: RunTimelineEventRecord[] = [];
    const deps = makeDeps({ captured, terminalCommits, timelineEvents });
    const coordinator = new RequestLifecycleCoordinator(deps);

    const pendingInputId = brand<string, 'PendingInputId'>('pi-timeout-resume');
    const runId = brand<string, 'RequestRunId'>('run-timeout-resume');
    seedPendingInput(deps, { pendingInputId, runId, producerRefKind: 'WORKFLOW_NODE', nodeType: 'USER_CHECK', seedCheckpoint: true });

    coordinator.startPendingInputTimeoutProcessing();
    await pollForCompletion(coordinator, captured, terminalCommits);

    expect(captured).toHaveLength(1);
    // The resume path enqueued work and the CaptureAgent was invoked.
    // Terminal commit status depends on agent output content, not on the
    // timeout resume logic under test, so we only assert the resume invariants.
    const ctx = captured[0]!;
    expect(ctx.routingConstraints?.targetRecipe).toBe('ran-alarm-diagnosis');
    const resume = (ctx.flowVariables as Record<string, unknown>)['workflowPendingResume'] as Record<string, unknown> | undefined;
    expect(resume).toBeDefined();
    expect(resume!['recipeName']).toBe('ran-alarm-diagnosis');
    expect(resume!['nodeId']).toBe('askUser');
    expect(resume!['answers']).toBeUndefined();
  });

  it('falls back to FAILED when checkpoint is unavailable for WORKFLOW_NODE timeout', async () => {
    const captured: RequestContext[] = [];
    const terminalCommits: TerminalCommitEntry[] = [];
    const timelineEvents: RunTimelineEventRecord[] = [];
    const deps = makeDeps({ captured, terminalCommits, timelineEvents });
    const coordinator = new RequestLifecycleCoordinator(deps);

    const pendingInputId = brand<string, 'PendingInputId'>('pi-no-ckpt');
    const runId = brand<string, 'RequestRunId'>('run-no-ckpt');
    seedPendingInput(deps, { pendingInputId, runId, producerRefKind: 'WORKFLOW_NODE', nodeType: 'USER_CHECK', seedCheckpoint: false });

    coordinator.startPendingInputTimeoutProcessing();
    await pollForCompletion(coordinator, captured, terminalCommits);

    expect(captured).toHaveLength(0);
    expect(terminalCommits).toHaveLength(1);
    expect(terminalCommits[0]!.terminalStatus).toBe('FAILED');
  });

  it('terminalizes directly for non-WORKFLOW_NODE (LIFECYCLE_HOOK) timeout without resume', async () => {
    const captured: RequestContext[] = [];
    const terminalCommits: TerminalCommitEntry[] = [];
    const timelineEvents: RunTimelineEventRecord[] = [];
    const deps = makeDeps({ captured, terminalCommits, timelineEvents });
    const coordinator = new RequestLifecycleCoordinator(deps);

    const pendingInputId = brand<string, 'PendingInputId'>('pi-lifecycle');
    const runId = brand<string, 'RequestRunId'>('run-lifecycle');
    seedPendingInput(deps, { pendingInputId, runId, producerRefKind: 'LIFECYCLE_HOOK', seedCheckpoint: false });

    coordinator.startPendingInputTimeoutProcessing();
    await pollForCompletion(coordinator, captured, terminalCommits);

    expect(captured).toHaveLength(0);
    expect(terminalCommits).toHaveLength(1);
    expect(terminalCommits[0]!.terminalStatus).toBe('FAILED');
  });

  it('emits USER_INPUT_TIMEOUT timeline event before resume', async () => {
    const captured: RequestContext[] = [];
    const terminalCommits: TerminalCommitEntry[] = [];
    const timelineEvents: RunTimelineEventRecord[] = [];
    const deps = makeDeps({ captured, terminalCommits, timelineEvents });
    const coordinator = new RequestLifecycleCoordinator(deps);

    const pendingInputId = brand<string, 'PendingInputId'>('pi-event');
    const runId = brand<string, 'RequestRunId'>('run-event');
    seedPendingInput(deps, { pendingInputId, runId, producerRefKind: 'WORKFLOW_NODE', nodeType: 'USER_CHECK', seedCheckpoint: true });

    coordinator.startPendingInputTimeoutProcessing();
    await pollForCompletion(coordinator, captured, terminalCommits);

    expect(captured.length).toBeGreaterThan(0);
    const timeoutEvent = timelineEvents.find((e) => e.type === 'USER_INPUT_TIMEOUT');
    expect(timeoutEvent).toBeDefined();
  });
});

async function pollForCompletion(
  coordinator: RequestLifecycleCoordinator<object>,
  captured: RequestContext[],
  terminalCommits: TerminalCommitEntry[],
  timeoutMs = 5_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 50));
    try {
      await coordinator.waitForIdle({ timeoutMs: 500 });
    } catch {
      // keep polling
    }
    if (captured.length > 0 || terminalCommits.length > 0) {
      return;
    }
  }
}

function makeDeps(opts: { captured: RequestContext[]; terminalCommits: TerminalCommitEntry[]; timelineEvents: RunTimelineEventRecord[] }) {
  const assembly = makeAssembly();
  const session: UserSession = {
    tenantId,
    subjectId,
    agentId: assembly.agentId,
    sessionId,
    title: 'Timeout Resume Session',
    createdAt: brand<number, 'EpochMillis'>(1),
    updatedAt: brand<number, 'EpochMillis'>(1),
    hasInFlightRequest: false,
  };

  const pendingRecords = new Map<string, PendingInputRecord>();
  const runRecords = new Map<string, RequestRunRecord>();
  const checkpoints = new Map<string, CheckpointRecord>();
  const messageRecords = new Map<string, SessionMessageRecord>();

  const pendingInputStore: PendingInputStoreGateway = {
    async createPendingInput(request) {
      pendingRecords.set(request.record.pendingInputId, request.record);
      return request.record;
    },
    async loadPendingInput(request) {
      return pendingRecords.get(request.pendingInputId);
    },
    async loadActivePendingInput(request) {
      for (const record of pendingRecords.values()) {
        if (record.sessionId === request.sessionId && record.status === 'PENDING') {
          return record;
        }
      }
      return undefined;
    },
    async resolvePendingInput(request) {
      const current = pendingRecords.get(request.pendingInputId);
      if (current === undefined || current.status !== request.expectedStatus) {
        return { status: 'VERSION_CONFLICT' as const, ...(current === undefined ? {} : { record: current }) };
      }
      const updated: PendingInputRecord = {
        ...current,
        status: request.status,
        updatedAt: brand<number, 'EpochMillis'>(Number(current.updatedAt) + 5_000),
        ...(request.answer === undefined ? {} : { responseAnswers: request.answer.answers }),
      };
      pendingRecords.set(request.pendingInputId, updated);
      return { status: 'UPDATED' as const, record: updated };
    },
    async listUnresolvedPendingInputTimeoutFacts(request) {
      if (request.after !== undefined) {
        return [];
      }
      const result: PendingInputRecord[] = [];
      for (const record of pendingRecords.values()) {
        if (record.agentId !== request.agentId) {
          continue;
        }
        if (record.status !== 'PENDING') {
          continue;
        }
        if (record.request.timeoutAt === undefined) {
          continue;
        }
        result.push(record);
      }
      return result.slice(0, request.limit);
    },
  };

  const requestRunStore: RequestRunStoreGateway = {
    async saveRun(record, options) {
      const existing = runRecords.get(record.runId);
      if (options.expectedVersion !== undefined) {
        if (existing === undefined || existing.version !== options.expectedVersion) {
          return { status: 'VERSION_CONFLICT' as const };
        }
      }
      runRecords.set(record.runId, record);
      return { status: 'UPDATED' as const, record };
    },
    async loadRun(request) {
      return runRecords.get(request.runId);
    },
    async listRuns(request) {
      return { items: [], offset: request.offset, limit: request.limit, hasMore: false };
    },
    async loadSessionLaneSnapshot(request) {
      const records = [...runRecords.values()].filter((r) => r.sessionId === request.sessionId);
      return {
        tenantId: request.tenantId,
        subjectId: request.subjectId,
        agentId: request.agentId,
        sessionId: request.sessionId,
        queuedRuns: records.filter((r) => r.status === 'QUEUED'),
      };
    },
    async loadRunByIdempotencyKey() {
      return { status: 'NOT_FOUND' as const };
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
      runRecords.set(request.runId, { ...existing, status: request.terminalStatus, version: existing.version + 1 });
      opts.terminalCommits.push({ runId: request.runId, terminalStatus: request.terminalStatus });
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
      const persisted = { ...record, sequence: brand<number, 'TimelineSequence'>(opts.timelineEvents.length + 1) };
      opts.timelineEvents.push(persisted);
      return persisted;
    },
    async listEvents(request) {
      return opts.timelineEvents.filter((e) => e.sessionId === request.sessionId);
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
      throw new Error('not used');
    },
    async replaceActiveContext() {
      throw new Error('not used');
    },
    async commitCompaction() {
      throw new Error('not used');
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
      return { entries: [session], offset: 0, limit: 1, hasMore: false };
    },
    async deleteSession() {},
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

  return {
    agentConstructors: [CaptureAgent as AgentConstructor<{ captured: RequestContext[] }>],
    agentRuntimeDependencies: { captured: opts.captured },
    assemblyRegistry: makeAssemblyRegistry(assembly),
    capabilityCatalog: makeCapabilityCatalog(),
    userSessions,
    messageStore,
    activeContextStore,
    timelineStore,
    pendingInputStore: Object.assign(pendingInputStore, { __records: pendingRecords }),
    requestRunStore: Object.assign(requestRunStore, { __records: runRecords }),
    checkpointStore: Object.assign(checkpointStore, { __records: checkpoints }),
    defaultRouteAgentId: assembly.agentId,
    recoveryAgentId: assembly.agentId,
    idFactory: (() => {
      let next = 0;
      return (prefix: string) => `${prefix}-${++next}`;
    })(),
  };
}

function seedPendingInput(
  deps: TimeoutResumeDeps,
  opts: {
    pendingInputId: PendingInputId;
    runId: RequestRunId;
    producerRefKind: 'WORKFLOW_NODE' | 'LIFECYCLE_HOOK';
    nodeType?: 'USER_CHECK' | 'INTERRUPT';
    seedCheckpoint?: boolean;
  },
): void {
  const requestId = brand<string, 'MessageId'>('req-timeout-resume');
  const createdAt = brand<number, 'EpochMillis'>(1_000);
  const pastTimeoutAt = brand<number, 'EpochMillis'>(1_000);
  const checkpointId = brand<string, 'CheckpointId'>('ckpt-timeout-resume');
  const requestContextId = brand<string, 'RequestContextId'>('ctx-timeout-resume');

  const runRecord: RequestRunRecord = {
    tenantId,
    subjectId,
    agentId,
    runId: opts.runId,
    sessionId,
    requestId,
    agentVersion,
    agentAssemblyRef: 'agent-timeout-resume:v1',
    attempt: 1,
    status: 'EXECUTING',
    version: 1,
    terminalCommitState: 'PENDING',
    createdAt,
    updatedAt: createdAt,
  };
  deps.requestRunStore.__records.set(opts.runId, runRecord);

  if (opts.seedCheckpoint === true) {
    const checkpoint: CheckpointRecord = {
      tenantId,
      subjectId,
      agentId,
      checkpointId,
      sessionId,
      requestId,
      runId: opts.runId,
      requestContextId,
      runVersion: 1,
      agentTurnIndex: 0,
      triggerReason: 'STEP_STARTED',
      lastSequence: brand<number, 'TimelineSequence'>(0),
      activeContextVersion: 0,
      flowVariables: {
        workflowExecutionState: {
          executionId: 'exec-timeout-resume',
          recipeName: 'ran-alarm-diagnosis',
          nodeId: 'askUser',
          nodeType: opts.nodeType ?? 'USER_CHECK',
          variables: {},
        },
      },
      savedAt: createdAt,
    };
    deps.checkpointStore.__records.set(opts.runId, checkpoint);
  }

  const producerRef =
    opts.producerRefKind === 'WORKFLOW_NODE'
      ? {
          kind: 'WORKFLOW_NODE' as const,
          recipeName: 'ran-alarm-diagnosis',
          nodeId: 'askUser',
          nodeType: (opts.nodeType ?? 'USER_CHECK') as 'USER_CHECK',
          executionId: 'exec-timeout-resume',
        }
      : { kind: 'LIFECYCLE_HOOK' as const };

  const pendingInput: PendingInputRecord = {
    tenantId,
    subjectId,
    agentId,
    pendingInputId: opts.pendingInputId,
    requestRunId: opts.runId,
    sessionId,
    requestId,
    requestContextId,
    checkpointId,
    kind: 'QUESTION',
    request: {
      id: opts.pendingInputId,
      sessionId,
      kind: 'QUESTION',
      questions: [{ prompt: 'Select an option', options: [{ label: 'Approve', value: 'approve' }] }],
      timeoutAt: pastTimeoutAt,
    },
    producerRef,
    status: 'PENDING',
    createdAt,
    updatedAt: createdAt,
  };
  deps.pendingInputStore.__records.set(opts.pendingInputId, pendingInput);

  const userMessage: SessionMessageRecord = {
    tenantId,
    subjectId,
    agentId,
    messageId: requestId,
    sessionId,
    requestId,
    runId: opts.runId,
    role: 'USER',
    content: 'diagnose gNodeB alarm burst',
    contentType: 'PLAIN_TEXT',
    metadata: { kind: 'USER' },
    visible: true,
    createdAt,
  };
  void deps.messageStore.appendSessionMessage(userMessage);
}

class CaptureAgent implements Agent {
  static getType(): AgentType {
    return brand<string, 'AgentType'>('capture-timeout-resume');
  }

  constructor(private readonly kit: { readonly captured: RequestContext[] }) {}

  async execute(_run: RequestRun, context: RequestContext): Promise<AgentExecutionOutcome> {
    this.kit.captured.push(context);
    return { status: 'COMPLETED' };
  }
}

function makeAssembly(): AgentAssembly {
  return {
    agentId,
    agentType: CaptureAgent.getType(),
    agentVersion,
    agentAssemblyRef: 'agent-timeout-resume:v1',
    displayName: 'Timeout Resume Agent',
    description: 'Test agent',
    workspacePolicy: { schemaVersion: '1', isolationMode: 'subject', roots: [] },
    modelIds: ['default'],
    capabilityBindings: [],
    userInvocable: true,
    agentInvocation: 'BOUND',
    runtimeSettings: {
      requestTimeoutMs: 1_000,
      maxTurns: 1,
      maxToolCallsPerTurn: 30,
    },
  };
}

function makeAssemblyRegistry(assembly: AgentAssembly): AgentAssemblyRegistry {
  return {
    active: async () => assembly,
    require: async () => assembly,
  };
}

function makeCapabilityCatalog(): CapabilityCatalog {
  return {
    listAvailable: async () => [],
    resolve: async () => undefined,
  };
}
