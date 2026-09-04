import {
  AgentError,
  brand,
  type AgentId,
  type AgentType,
  type AgentVersion,
  type CheckpointId,
  type EpochMillis,
  type IdempotencyKey,
  type MessageId,
  type PendingInputId,
  type RequestContextId,
  type RequestRunId,
  type SessionId,
  type TenantId,
  type TimelineSequence,
  type SubjectId,
} from '@nextagent/agent-common';
import type { AgentAssembly, AgentAssemblyRegistry } from '@nextagent/agent-contracts/agent-assembly';
import type { CapabilityCatalog } from '@nextagent/agent-contracts/capability';
import type {
  ActiveContextStoreGateway,
  CheckpointRecord,
  CheckpointStoreGateway,
  PendingInputRecord,
  PendingInputResolveResult,
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
  AnswerPendingInputCommand,
  RequestContext,
  RequestRun,
} from '@nextagent/agent-contracts/runtime';
import type { UserSession, UserSessionPort } from '@nextagent/agent-contracts/session';
import { RequestLifecycleCoordinator } from '@nextagent/agent-runtime';
import { describe, expect, it } from 'vitest';

const tenantId = brand<string, 'TenantId'>('tenant-wf-durable');
const subjectId = brand<string, 'SubjectId'>('subject-wf-durable');
const agentId = brand<string, 'AgentId'>('agent-wf-durable');
const agentVersion = brand<string, 'AgentVersion'>('v1');
const sessionId = brand<string, 'SessionId'>('session-wf-durable');

describe('RequestLifecycleCoordinator workflow pending input durable resume', () => {
  it('carries targetRecipe and workflowPendingResume on the durable resume path for WORKFLOW_NODE pending input', async () => {
    const captured: RequestContext[] = [];
    const deps = makeDeps(captured);
    const coordinator = new RequestLifecycleCoordinator(deps);

    const pendingInputId = brand<string, 'PendingInputId'>('pi-wf-durable');
    const runId = brand<string, 'RequestRunId'>('run-wf-durable');
    seedWorkflowPendingInput(deps, pendingInputId, runId);

    const command: AnswerPendingInputCommand = {
      identityContext: { tenantId, subjectId, displayName: 'Workflow Resume' },
      idempotencyKey: brand<string, 'IdempotencyKey'>('idem-wf-durable'),
      answer: {
        sessionId,
        pendingInputId,
        answers: [['approve']],
      },
    };

    await coordinator.answerPendingInput(command);
    await coordinator.waitForIdle({ timeoutMs: 5_000 });

    expect(captured).toHaveLength(1);
    const resumedContext = captured[0]!;
    expect(resumedContext.agentTurnIndex).toBe(1);
    expect(resumedContext.routingConstraints?.targetRecipe).toBe('ran-alarm-diagnosis');
    const workflowResume = (resumedContext.flowVariables as Record<string, unknown>)['workflowPendingResume'];
    expect(workflowResume).toBeDefined();
    expect((workflowResume as Record<string, unknown>)['recipeName']).toBe('ran-alarm-diagnosis');
    expect((workflowResume as Record<string, unknown>)['nodeId']).toBe('askUser');
    expect((workflowResume as Record<string, unknown>)['answers']).toEqual([['approve']]);
  });

  it('resumes WORKFLOW_NODE CONFIRMATION reject instead of terminalizing', async () => {
    const captured: RequestContext[] = [];
    const deps = makeDeps(captured);
    const coordinator = new RequestLifecycleCoordinator(deps);

    const pendingInputId = brand<string, 'PendingInputId'>('pi-wf-confirm-reject');
    const runId = brand<string, 'RequestRunId'>('run-wf-confirm-reject');
    seedWorkflowPendingInput(deps, pendingInputId, runId, 'CONFIRMATION');

    const command: AnswerPendingInputCommand = {
      identityContext: { tenantId, subjectId, displayName: 'Confirm Reject' },
      idempotencyKey: brand<string, 'IdempotencyKey'>('idem-wf-confirm-reject'),
      answer: { sessionId, pendingInputId, answers: [['reject']] },
    };

    await coordinator.answerPendingInput(command);
    await coordinator.waitForIdle({ timeoutMs: 5_000 });

    expect(captured).toHaveLength(1);
    const resumedContext = captured[0]!;
    const workflowResume = (resumedContext.flowVariables as Record<string, unknown>)['workflowPendingResume'];
    expect(workflowResume).toBeDefined();
    expect((workflowResume as Record<string, unknown>)['answers']).toEqual([['reject']]);
  });

  it('resumes WORKFLOW_NODE AUTHORIZATION deny instead of terminalizing', async () => {
    const captured: RequestContext[] = [];
    const deps = makeDeps(captured);
    const coordinator = new RequestLifecycleCoordinator(deps);

    const pendingInputId = brand<string, 'PendingInputId'>('pi-wf-auth-deny');
    const runId = brand<string, 'RequestRunId'>('run-wf-auth-deny');
    seedWorkflowPendingInput(deps, pendingInputId, runId, 'AUTHORIZATION');

    const command: AnswerPendingInputCommand = {
      identityContext: { tenantId, subjectId, displayName: 'Auth Deny' },
      idempotencyKey: brand<string, 'IdempotencyKey'>('idem-wf-auth-deny'),
      answer: { sessionId, pendingInputId, answers: [['deny']] },
    };

    await coordinator.answerPendingInput(command);
    await coordinator.waitForIdle({ timeoutMs: 5_000 });

    expect(captured).toHaveLength(1);
    const resumedContext = captured[0]!;
    const workflowResume = (resumedContext.flowVariables as Record<string, unknown>)['workflowPendingResume'];
    expect(workflowResume).toBeDefined();
    expect((workflowResume as Record<string, unknown>)['answers']).toEqual([['deny']]);
  });

  it('rejects answer with PENDING_INPUT_TIMED_OUT when scheduler already CAS-claimed the timeout', async () => {
    const captured: RequestContext[] = [];
    const deps = makeDeps(captured);

    const pendingInputId = brand<string, 'PendingInputId'>('pi-timeout-race');
    const runId = brand<string, 'RequestRunId'>('run-timeout-race');
    seedWorkflowPendingInput(deps, pendingInputId, runId);

    // Make the pending input due: set timeoutAt in the past.
    const pastTimeoutAt = brand<number, 'EpochMillis'>(Date.now() - 60_000);
    const seeded = deps.pendingInputStore.__records.get(pendingInputId)!;
    deps.pendingInputStore.__records.set(pendingInputId, {
      ...seeded,
      request: { ...seeded.request, timeoutAt: pastTimeoutAt },
    });

    // Simulate the scheduler having already CAS-claimed TIMED_OUT.
    // Timeout-path resolvePendingInput returns VERSION_CONFLICT (scheduler won the CAS).
    // Answer-path resolvePendingInput returns UPDATED — if the fix works, this is never
    // reached because answerPendingInput throws before calling it. Without the fix,
    // the answer would be accepted and the run resumed (the bug).
    let answerPathResolveCalls = 0;
    deps.pendingInputStore.resolvePendingInput = async (request) => {
      if (request.status === 'RECEIVED') {
        answerPathResolveCalls += 1;
        return {
          status: 'UPDATED' as const,
          record: {
            ...seeded,
            status: 'RECEIVED' as const,
            updatedAt: brand<number, 'EpochMillis'>(Number(seeded.updatedAt) + 5_000),
            responseAnswers: [['approve']],
          },
        };
      }
      return {
        status: 'VERSION_CONFLICT' as const,
        record: { ...seeded, status: 'TIMED_OUT' as const },
      };
    };

    const coordinator = new RequestLifecycleCoordinator(deps);
    const command: AnswerPendingInputCommand = {
      identityContext: { tenantId, subjectId, displayName: 'Timeout Race' },
      idempotencyKey: brand<string, 'IdempotencyKey'>('idem-timeout-race'),
      answer: { sessionId, pendingInputId, answers: [['approve']] },
    };

    await expect(coordinator.answerPendingInput(command)).rejects.toMatchObject({ code: 'PENDING_INPUT_TIMED_OUT' });
    expect(answerPathResolveCalls).toBe(0);
  });
});

interface WorkflowDurableDeps {
  readonly pendingInputStore: PendingInputStoreGateway & { readonly __records: Map<string, PendingInputRecord> };
  readonly requestRunStore: RequestRunStoreGateway & { readonly __records: Map<string, RequestRunRecord> };
  readonly checkpointStore: CheckpointStoreGateway & { readonly __records: Map<string, CheckpointRecord> };
  readonly messageStore: SessionMessageStoreGateway;
  readonly timelineStore: RunTimelineEventStoreGateway;
}

function makeDeps(captured: RequestContext[]) {
  const assembly = makeAssembly();
  const session: UserSession = {
    tenantId,
    subjectId,
    agentId: assembly.agentId,
    sessionId,
    title: 'Workflow Durable Session',
    createdAt: brand<number, 'EpochMillis'>(1),
    updatedAt: brand<number, 'EpochMillis'>(1),
    hasInFlightRequest: false,
  };

  const pendingRecords = new Map<string, PendingInputRecord>();
  const runRecords = new Map<string, RequestRunRecord>();
  const checkpoints = new Map<string, CheckpointRecord>();
  const messageRecords = new Map<string, SessionMessageRecord>();
  const timelineEvents: RunTimelineEventRecord[] = [];

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
        return { status: 'VERSION_CONFLICT', ...(current === undefined ? {} : { record: current }) };
      }
      // Return a record whose updatedAt differs from the caller-supplied answeredAt,
      // forcing the durable resume branch (updatedAt !== answeredAt).
      const serverTime = brand<number, 'EpochMillis'>(Number(current.updatedAt) + 5_000);
      const updated: PendingInputRecord = {
        ...current,
        status: request.status,
        updatedAt: serverTime,
        ...(request.answer === undefined ? {} : { responseAnswers: request.answer.answers }),
      };
      pendingRecords.set(request.pendingInputId, updated);
      return { status: 'UPDATED', record: updated };
    },
    async listUnresolvedPendingInputTimeoutFacts() {
      return [];
    },
  };

  const requestRunStore: RequestRunStoreGateway = {
    async saveRun(record, options) {
      const existing = runRecords.get(record.runId);
      if (options.expectedVersion !== undefined) {
        if (existing === undefined || existing.version !== options.expectedVersion) {
          return { status: 'VERSION_CONFLICT' };
        }
      }
      runRecords.set(record.runId, record);
      return { status: 'UPDATED', record };
    },
    async loadRun(request) {
      return runRecords.get(request.runId);
    },
    async listRuns(request) {
      return { items: [], offset: request.offset, limit: request.limit, hasMore: false };
    },
    async loadSessionLaneSnapshot(request) {
      const records = [...runRecords.values()].filter((record) => record.sessionId === request.sessionId);
      return {
        tenantId: request.tenantId,
        subjectId: request.subjectId,
        agentId: request.agentId,
        sessionId: request.sessionId,
        queuedRuns: records.filter((record) => record.status === 'QUEUED'),
      };
    },
    async loadRunByIdempotencyKey() {
      return { status: 'NOT_FOUND' };
    },
    async claimRun() {
      return { status: 'VERSION_CONFLICT' };
    },
    async listRecoverableRuns() {
      return [];
    },
    async commitTerminal(request) {
      const existing = runRecords.get(request.runId);
      if (existing === undefined || existing.version !== request.expectedVersion) {
        return { status: 'VERSION_CONFLICT' };
      }
      runRecords.set(request.runId, { ...existing, status: request.terminalStatus, version: existing.version + 1 });
      return { status: 'COMMITTED', terminalEvent: request.terminalEvent };
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
        items: [...messageRecords.values()].filter((record) => record.sessionId === request.sessionId && record.requestId === request.requestId),
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
      return timelineEvents.filter((record) => record.sessionId === request.sessionId);
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
    agentRuntimeDependencies: { captured },
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
    idFactory: (() => {
      let next = 0;
      return (prefix: string) => `${prefix}-${++next}`;
    })(),
  };
}

function seedWorkflowPendingInput(
  deps: WorkflowDurableDeps,
  pendingInputId: PendingInputId,
  runId: RequestRunId,
  kind: PendingInputRecord['kind'] = 'QUESTION',
): void {
  const requestId = brand<string, 'MessageId'>('req-wf-durable');
  const createdAt = brand<number, 'EpochMillis'>(1_000);

  const runRecord: RequestRunRecord = {
    tenantId,
    subjectId,
    agentId,
    runId,
    sessionId,
    requestId,
    agentVersion,
    agentAssemblyRef: 'agent-wf-durable:v1',
    attempt: 1,
    status: 'EXECUTING',
    version: 1,
    terminalCommitState: 'PENDING',
    createdAt,
    updatedAt: createdAt,
  };
  deps.requestRunStore.__records.set(runId, runRecord);

  const checkpointId = brand<string, 'CheckpointId'>('ckpt-wf-durable');
  const checkpoint: CheckpointRecord = {
    tenantId,
    subjectId,
    agentId,
    checkpointId,
    sessionId,
    requestId,
    runId,
    requestContextId: brand<string, 'RequestContextId'>('ctx-wf-durable'),
    runVersion: 1,
    agentTurnIndex: 1,
    triggerReason: 'STEP_STARTED',
    lastSequence: brand<number, 'TimelineSequence'>(0),
    activeContextVersion: 0,
    flowVariables: {
      workflowExecutionState: {
        executionId: 'exec-wf-durable',
        recipeName: 'ran-alarm-diagnosis',
        nodeId: 'askUser',
        nodeType: 'USER_CHECK',
        variables: {},
      },
    },
    savedAt: createdAt,
  };
  deps.checkpointStore.__records.set(runId, checkpoint);

  const pendingInput: PendingInputRecord = {
    tenantId,
    subjectId,
    agentId,
    pendingInputId,
    requestRunId: runId,
    sessionId,
    requestId,
    requestContextId: brand<string, 'RequestContextId'>('ctx-wf-durable'),
    checkpointId,
    kind,
    request: {
      id: pendingInputId,
      sessionId,
      kind,
      questions: buildPendingInputQuestions(kind),
    },
    producerRef: {
      kind: 'WORKFLOW_NODE',
      recipeName: 'ran-alarm-diagnosis',
      nodeId: 'askUser',
      nodeType: 'USER_CHECK',
      executionId: 'exec-wf-durable',
    },
    status: 'PENDING',
    createdAt,
    updatedAt: createdAt,
  };
  deps.pendingInputStore.__records.set(pendingInputId, pendingInput);

  const userMessage: SessionMessageRecord = {
    tenantId,
    subjectId,
    agentId,
    messageId: requestId,
    sessionId,
    requestId,
    runId,
    role: 'USER',
    content: 'diagnose gNodeB alarm burst',
    contentType: 'PLAIN_TEXT',
    metadata: { kind: 'USER' },
    visible: true,
    createdAt,
  };
  void deps.messageStore.appendSessionMessage(userMessage);
}

function buildPendingInputQuestions(kind: PendingInputRecord['kind']): PendingInputRecord['request']['questions'] {
  if (kind === 'CONFIRMATION') {
    return [
      {
        prompt: 'Confirm operation',
        options: [
          { label: 'approve', value: 'approve' },
          { label: 'reject', value: 'reject' },
        ],
      },
    ];
  }
  if (kind === 'AUTHORIZATION') {
    return [
      {
        prompt: 'Authorize operation',
        options: [
          { label: 'approve', value: 'approve' },
          { label: 'deny', value: 'deny' },
        ],
      },
    ];
  }
  return [
    {
      prompt: 'Select an option',
      options: [{ label: 'Approve', value: 'approve' }],
    },
  ];
}

class CaptureAgent implements Agent {
  static getType(): AgentType {
    return brand<string, 'AgentType'>('capture-wf-durable');
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
    agentAssemblyRef: 'agent-wf-durable:v1',
    displayName: 'Workflow Durable Agent',
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
