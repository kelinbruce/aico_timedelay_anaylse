import {
  AgentError,
  brand,
  type AgentId,
  type AgentType,
  type AgentVersion,
  type EpochMillis,
  type IdempotencyKey,
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
  RequestContext,
  RequestRun,
  SubmitRequestCommand,
} from '@nextagent/agent-contracts/runtime';
import type { UserSession, UserSessionPort } from '@nextagent/agent-contracts/session';
import { RequestLifecycleCoordinator } from '@nextagent/agent-runtime';
import { describe, expect, it } from 'vitest';

const tenantId = brand<string, 'TenantId'>('tenant-request-model-recovery');
const subjectId = brand<string, 'SubjectId'>('subject-request-model-recovery');
const agentId = brand<string, 'AgentId'>('agent-request-model-recovery');
const agentVersion = brand<string, 'AgentVersion'>('v1');
const sessionId = brand<string, 'SessionId'>('session-request-model-recovery');

describe('request model options retry and recovery', () => {
  it('preserves requestModelOptions on retry', async () => {
    const captured: RequestContext[] = [];
    const harness = makeHarness(captured);
    const coordinator = new RequestLifecycleCoordinator(harness.deps);
    const submitCommand: SubmitRequestCommand = {
      sessionId,
      identityContext: { tenantId, subjectId, displayName: 'Request Model Retry' },
      inputText: 'diagnose retry path',
      attachmentIds: [],
      locale: brand<string, 'RequestLocale'>('zh-CN'),
      requestModelOptions: { thinking: { depth: 'OFF' }, toolChoice: 'REQUIRED' },
      idempotencyKey: brand<string, 'IdempotencyKey'>('idem-request-model-retry-submit'),
    };

    const accepted = await coordinator.submit(submitCommand);
    await coordinator.waitForIdle({ timeoutMs: 5_000 });

    await coordinator.retryLatest({
      sessionId,
      identityContext: submitCommand.identityContext,
      expectedLatestRequestId: accepted.requestId,
      action: 'RETRY_LATEST',
      idempotencyKey: brand<string, 'IdempotencyKey'>('idem-request-model-retry'),
    });
    await coordinator.waitForIdle({ timeoutMs: 5_000 });

    expect(captured).toHaveLength(2);
    expect(captured[1]?.requestModelOptions).toEqual({ thinking: { depth: 'OFF' }, toolChoice: 'REQUIRED' });
  });

  it('reconstructs requestModelOptions from root message metadata during recovery', async () => {
    const captured: RequestContext[] = [];
    const harness = makeHarness(captured);
    const coordinator = new RequestLifecycleCoordinator(harness.deps);
    const submitCommand: SubmitRequestCommand = {
      sessionId,
      identityContext: { tenantId, subjectId, displayName: 'Request Model Recovery' },
      inputText: 'diagnose recovery path',
      attachmentIds: [],
      locale: brand<string, 'RequestLocale'>('zh-CN'),
      requestModelOptions: { thinking: { depth: 'OFF' }, toolChoice: 'REQUIRED' },
      idempotencyKey: brand<string, 'IdempotencyKey'>('idem-request-model-recovery-submit'),
    };

    const accepted = await coordinator.submit(submitCommand);
    await coordinator.waitForIdle({ timeoutMs: 5_000 });

    const record = [...harness.runRecords.values()].find((item) => item.runId === accepted.runId);
    expect(record).toBeDefined();

    const recoveryCommand = await (coordinator as any).toRecoverySubmitCommand(record);
    expect(recoveryCommand.requestModelOptions).toEqual({ thinking: { depth: 'OFF' }, toolChoice: 'REQUIRED' });

    const recoveryContext = await (coordinator as any).reconstructRecoveryContext(record, recoveryCommand, 'BEFORE_MODEL_INVOKE');
    expect(recoveryContext.requestModelOptions).toEqual({ thinking: { depth: 'OFF' }, toolChoice: 'REQUIRED' });
  });

  it('recovers taskEventId from the persisted REQUEST_ACCEPTED anchor for retry and recovery', async () => {
    const captured: RequestContext[] = [];
    const harness = makeHarness(captured);
    const coordinator = new RequestLifecycleCoordinator({
      ...harness.deps,
      traceEnabled: true,
    });
    const submitCommand: SubmitRequestCommand = {
      sessionId,
      identityContext: { tenantId, subjectId, displayName: 'Task Event Recovery' },
      inputText: 'diagnose task event recovery',
      attachmentIds: [],
      locale: brand<string, 'RequestLocale'>('zh-CN'),
      propagationAttributes: {
        taskEventId: brand<string, 'TaskEventId'>('task-event-01'),
      },
      idempotencyKey: brand<string, 'IdempotencyKey'>('idem-task-event-recovery-submit'),
    };

    const accepted = await coordinator.submit(submitCommand);
    await coordinator.waitForIdle({ timeoutMs: 5_000 });
    const sourceRecord = harness.runRecords.get(accepted.runId)!;
    const recoveryCommand = await (coordinator as any).toRecoverySubmitCommand(sourceRecord);

    expect(recoveryCommand.propagationAttributes).toEqual({
      taskEventId: 'task-event-01',
    });

    await coordinator.retryLatest({
      sessionId,
      identityContext: submitCommand.identityContext,
      expectedLatestRequestId: accepted.requestId,
      action: 'RETRY_LATEST',
      idempotencyKey: brand<string, 'IdempotencyKey'>('idem-task-event-retry'),
    });
    await coordinator.waitForIdle({ timeoutMs: 5_000 });

    expect(captured[1]?.propagationAttributes).toEqual({
      taskEventId: 'task-event-01',
    });
  });
});

function makeHarness(captured: RequestContext[]) {
  const assembly = makeAssembly();
  const session: UserSession = {
    tenantId,
    subjectId,
    agentId: assembly.agentId,
    sessionId,
    title: 'Request Model Recovery Session',
    createdAt: brand<number, 'EpochMillis'>(1),
    updatedAt: brand<number, 'EpochMillis'>(1),
    hasInFlightRequest: false,
  };
  const runRecords = new Map<string, RequestRunRecord>();
  const idempotencyRecords = new Map<string, RequestRunRecord>();
  const timelineEvents: RunTimelineEventRecord[] = [];
  const messageRecords = new Map<string, SessionMessageRecord>();
  const checkpoints = new Map<string, CheckpointRecord>();

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
      const records = [...runRecords.values()].filter((record) => record.sessionId === request.sessionId && record.agentId === request.agentId);
      const latestRun = records.at(-1);
      return {
        tenantId: request.tenantId,
        subjectId: request.subjectId,
        agentId: request.agentId,
        sessionId: request.sessionId,
        ...(latestRun === undefined ? {} : { latestRequestId: latestRun.requestId, latestRun }),
        queuedRuns: records.filter((record) => record.status === 'QUEUED'),
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
      return timelineEvents.filter((record) => record.sessionId === request.sessionId && Number(record.sequence) > Number(request.afterSequence));
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

  return {
    runRecords,
    deps: {
      defaultRouteAgentId: assembly.agentId,
      agentConstructors: [makeAgentConstructor(captured) as AgentConstructor<{ captured: RequestContext[] }>],
      agentRuntimeDependencies: { captured },
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
      capabilityCatalog: {} as CapabilityCatalog,
    },
  };
}

function makeAssembly(): AgentAssembly {
  return {
    agentId,
    agentVersion,
    agentAssemblyRef: 'agent-request-model-recovery@v1',
    agentType: brand<string, 'AgentType'>('DEFAULT') as AgentType,
    title: 'Request Model Recovery',
    displayName: 'Request Model Recovery',
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

function makeAgentConstructor(captured: RequestContext[]): AgentConstructor {
  return class TestAgent implements Agent {
    static getType(): AgentType {
      return brand<string, 'AgentType'>('DEFAULT') as AgentType;
    }

    async execute(_run: RequestRun, context: RequestContext): Promise<AgentExecutionOutcome> {
      captured.push(context);
      return { status: 'COMPLETED' };
    }
  };
}
