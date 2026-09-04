import {
  AgentError,
  brand,
  type AgentId,
  type AgentType,
  type AgentVersion,
  type AttachmentId,
  type EpochMillis,
  type IdempotencyKey,
  type MessageId,
  type RequestContextId,
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
  VersionedUpdateResult,
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

const tenantId = brand<string, 'TenantId'>('tenant-routing-runtime');
const subjectId = brand<string, 'SubjectId'>('subject-routing-runtime');
const agentId = brand<string, 'AgentId'>('agent-routing-runtime');
const agentVersion = brand<string, 'AgentVersion'>('v1');
const sessionId = brand<string, 'SessionId'>('session-routing-runtime');

describe('RequestLifecycleCoordinator routing constraints carry', () => {
  it('carries typed routingConstraints into the accepted RequestContext without runtime governance', async () => {
    const captured: RequestContext[] = [];
    const assembly = makeAssembly();
    const deps = makeCoordinatorDeps(assembly, captured);
    const coordinator = new RequestLifecycleCoordinator(deps);
    const command: SubmitRequestCommand = {
      sessionId,
      identityContext: { tenantId, subjectId, displayName: 'Routing Runtime' },
      inputText: 'diagnose gNodeB alarm burst',
      attachmentIds: [],
      locale: brand<string, 'RequestLocale'>('zh-CN'),
      routingConstraints: {
        targetSkill: 'alarm-diagnosis',
        targetRecipe: 'ran-alarm-diagnosis',
        forbiddenCapabilityIds: ['write-config'],
        executionMode: 'model-only',
        locale: 'en-US',
        allowHumanInput: false,
        allowSubagents: false,
      },
      idempotencyKey: brand<string, 'IdempotencyKey'>('idem-routing-runtime'),
    };

    await coordinator.submit(command);
    await coordinator.waitForIdle({ timeoutMs: 5_000 });

    expect(captured).toHaveLength(1);
    expect(captured[0]?.routingConstraints).toEqual(command.routingConstraints);
    expect(captured[0]?.identityContext).toEqual(command.identityContext);
    expect(captured[0]?.acceptedInputText).toBe(command.inputText);
  });

  it('keeps routingConstraints absent when submit command does not provide them', async () => {
    const captured: RequestContext[] = [];
    const coordinator = new RequestLifecycleCoordinator(makeCoordinatorDeps(makeAssembly(), captured));
    const command: SubmitRequestCommand = {
      sessionId: brand<string, 'SessionId'>('session-routing-runtime-absent'),
      identityContext: { tenantId, subjectId, displayName: 'Routing Runtime Absent' },
      inputText: 'diagnose BSC reachability',
      attachmentIds: [],
      locale: brand<string, 'RequestLocale'>('zh-CN'),
      idempotencyKey: brand<string, 'IdempotencyKey'>('idem-routing-runtime-absent'),
    };

    await coordinator.submit(command);
    await coordinator.waitForIdle({ timeoutMs: 5_000 });

    expect(captured).toHaveLength(1);
    expect(captured[0]?.acceptedInputText).toBe(command.inputText);
    expect(Object.hasOwn(captured[0]!, 'routingConstraints')).toBe(false);
  });

  it('resolves the session-bound agent scope before delegating deleteSession', async () => {
    const assembly = makeAssembly();
    const deps = makeCoordinatorDeps(assembly, []);
    const deleted: Array<Parameters<UserSessionPort['deleteSession']>[0]> = [];
    deps.userSessions.deleteSession = async (command) => {
      deleted.push(command);
    };
    const coordinator = new RequestLifecycleCoordinator(deps);
    const identityContext = { tenantId, subjectId, displayName: 'Routing Runtime Delete' };

    await coordinator.deleteSession({ identityContext, sessionId });

    expect(deleted).toEqual([
      {
        identityContext,
        agentId: assembly.agentId,
        sessionId,
      },
    ]);
  });
});

function makeCoordinatorDeps(assembly: AgentAssembly, captured: RequestContext[]) {
  const session: UserSession = {
    tenantId,
    subjectId,
    agentId: assembly.agentId,
    sessionId,
    title: 'Routing Runtime Session',
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
          return { status: 'VERSION_CONFLICT' };
        }
      } else if (existing !== undefined) {
        return { status: 'UPDATED', record: existing };
      }
      runRecords.set(record.runId, record);
      if (options.idempotencyKey !== undefined) {
        idempotencyRecords.set(`${record.sessionId}:${options.idempotencyKey}:${options.idempotencySemantic ?? ''}`, record);
      }
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
      const executingRun = records.find((record) => record.status === 'EXECUTING');
      return {
        tenantId: request.tenantId,
        subjectId: request.subjectId,
        agentId: request.agentId,
        sessionId: request.sessionId,
        ...(latestRun === undefined ? {} : { latestRequestId: latestRun.requestId, latestRun }),
        ...(executingRun === undefined ? {} : { executingRun }),
        queuedRuns: records.filter((record) => record.status === 'QUEUED'),
      };
    },
    async loadRunByIdempotencyKey(request) {
      const record = idempotencyRecords.get(`${request.sessionId}:${request.idempotencyKey}:${request.idempotencySemantic}`);
      return record === undefined ? { status: 'NOT_FOUND' } : { status: 'FOUND', record };
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
        items: [...messageRecords.values()].filter(
          (record) => record.sessionId === request.sessionId && record.requestId === request.requestId && record.runId === request.runId,
        ),
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
      const persisted = {
        ...record,
        sequence: brand<number, 'TimelineSequence'>(timelineEvents.length + 1),
      };
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
        state: {
          tenantId,
          subjectId,
          agentId: assembly.agentId,
          sessionId,
          activeContextVersion: 0,
          updatedAt: brand<number, 'EpochMillis'>(1),
        },
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
    requestRunStore,
    timelineStore,
    checkpointStore,
    defaultRouteAgentId: assembly.agentId,
    idFactory: (() => {
      let next = 0;
      return (prefix: string) => `${prefix}-${++next}`;
    })(),
  };
}

class CaptureAgent implements Agent {
  static getType(): AgentType {
    return brand<string, 'AgentType'>('capture-agent');
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
    agentAssemblyRef: 'agent-routing-runtime:v1',
    displayName: 'Routing Runtime Agent',
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
