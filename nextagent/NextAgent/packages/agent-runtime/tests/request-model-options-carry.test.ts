import {
  AgentError,
  brand,
  type AgentId,
  type AgentType,
  type AgentVersion,
  type EpochMillis,
  type MessageId,
  type RequestLocale,
  type RequestRunId,
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

const tenantId = brand<string, 'TenantId'>('tenant-request-model-runtime');
const subjectId = brand<string, 'SubjectId'>('subject-request-model-runtime');
const agentId = brand<string, 'AgentId'>('agent-request-model-runtime');
const agentVersion = brand<string, 'AgentVersion'>('v1');
const sessionId = brand<string, 'SessionId'>('session-request-model-runtime');

describe('RequestLifecycleCoordinator request model options carry', () => {
  it('carries requestModelOptions into the accepted RequestContext', async () => {
    const captured: RequestContext[] = [];
    const coordinator = new RequestLifecycleCoordinator(makeCoordinatorDeps(makeAssembly(), captured));
    const command: SubmitRequestCommand = {
      sessionId,
      identityContext: { tenantId, subjectId, displayName: 'Request Model Runtime' },
      inputText: 'diagnose gNodeB alarm summary',
      attachmentIds: [],
      locale: brand<string, 'RequestLocale'>('zh-CN'),
      requestModelOptions: { thinking: { depth: 'OFF' }, toolChoice: 'REQUIRED' },
      idempotencyKey: brand<string, 'IdempotencyKey'>('idem-request-model-runtime'),
    };

    await coordinator.submit(command);
    await coordinator.waitForIdle({ timeoutMs: 5_000 });

    expect(captured).toHaveLength(1);
    expect(captured[0]?.requestModelOptions).toEqual({ thinking: { depth: 'OFF' }, toolChoice: 'REQUIRED' });
    expect(captured[0]?.acceptedInputText).toBe(command.inputText);
  });

  it('keeps requestModelOptions absent when submit command does not provide them', async () => {
    const captured: RequestContext[] = [];
    const coordinator = new RequestLifecycleCoordinator(makeCoordinatorDeps(makeAssembly(), captured));
    const command: SubmitRequestCommand = {
      sessionId: brand<string, 'SessionId'>('session-request-model-runtime-absent'),
      identityContext: { tenantId, subjectId, displayName: 'Request Model Runtime Absent' },
      inputText: 'diagnose BSC reachability',
      attachmentIds: [],
      locale: brand<string, 'RequestLocale'>('zh-CN'),
      idempotencyKey: brand<string, 'IdempotencyKey'>('idem-request-model-runtime-absent'),
    };

    await coordinator.submit(command);
    await coordinator.waitForIdle({ timeoutMs: 5_000 });

    expect(captured).toHaveLength(1);
    expect(Object.hasOwn(captured[0]!, 'requestModelOptions')).toBe(false);
  });
});

function makeCoordinatorDeps(assembly: AgentAssembly, captured: RequestContext[]) {
  const session: UserSession = {
    tenantId,
    subjectId,
    agentId: assembly.agentId,
    sessionId,
    title: 'Request Model Runtime Session',
    createdAt: brand<number, 'EpochMillis'>(1),
    updatedAt: brand<number, 'EpochMillis'>(1),
    hasInFlightRequest: false,
  };
  const runRecords = new Map<string, RequestRunRecord>();
  const timelineEvents: RunTimelineEventRecord[] = [];
  const messageRecords = new Map<string, SessionMessageRecord>();
  const checkpoints = new Map<string, CheckpointRecord>();

  const requestRunStore: RequestRunStoreGateway = {
    async saveRun(record) {
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
      if (existing === undefined) {
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
        items: [...messageRecords.values()].filter((record) => record.requestId === request.requestId),
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
  };
}

function makeAssembly(): AgentAssembly {
  return {
    agentId,
    agentVersion,
    agentAssemblyRef: 'agent-request-model-runtime@v1',
    agentType: brand<string, 'AgentType'>('DEFAULT') as AgentType,
    title: 'Request Model Runtime',
    displayName: 'Request Model Runtime',
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
