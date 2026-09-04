import { AgentError, bindRuntimeLoggerProvider, brand, type RuntimeLoggerProviderBinding } from '@nextagent/agent-common';
import type { AgentAssembly, AgentAssemblyRegistry } from '@nextagent/agent-contracts/agent-assembly';
import type { CapabilityCatalog } from '@nextagent/agent-contracts/capability';
import type {
  ActiveContextStoreGateway,
  CheckpointStoreGateway,
  RequestRunRecord,
  RequestRunStoreGateway,
  RunTimelineEventStoreGateway,
  RunTimelineEventRecord,
  SessionMessageRecord,
  SessionMessageStoreGateway,
  TerminalCommitRequest,
} from '@nextagent/agent-contracts/gateway';
import type { AgentConstructor, RequestContext, RequestRun } from '@nextagent/agent-contracts/runtime';
import type { GenerateSessionTitleCommand, UserSessionPort } from '@nextagent/agent-contracts/session';
import { createRequestLifecycleCoordinator } from '@nextagent/agent-runtime';
import { afterEach, describe, expect, it } from 'vitest';

const TENANT = brand<string, 'TenantId'>('tenant-submit-acceptance');
const SUBJECT = brand<string, 'SubjectId'>('subject-submit-acceptance');
const AGENT = brand<string, 'AgentId'>('agent-submit-acceptance');
const AGENT_TYPE = brand<string, 'AgentType'>('noop-agent');
const AGENT_VERSION = brand<string, 'AgentVersion'>('v1');
const SESSION = brand<string, 'SessionId'>('session-submit-acceptance');

describe('submit acceptance ordering', () => {
  it('forgets session-owned stream state after deleting the session', async () => {
    const coordinator = createRequestLifecycleCoordinator({
      agentConstructors: [createNoopAgentConstructor()],
      agentRuntimeDependencies: {},
      assemblyRegistry: makeAssemblyRegistry(),
      capabilityCatalog: makeCapabilityCatalog(),
      userSessions: makeUserSessions(),
      messageStore: makeWritableMessageStore(),
      activeContextStore: makeActiveContextStore(),
      requestRunStore: makeRequestRunStore(new Map()),
      timelineStore: makeWritableTimelineStore(),
      checkpointStore: makeWritableCheckpointStore(),
      defaultRouteAgentId: AGENT,
    });
    const identityContext = { tenantId: TENANT, subjectId: SUBJECT, displayName: 'submit test' };
    await coordinator.requireSession({ identityContext, sessionId: SESSION });
    await coordinator.deleteSession({ identityContext, sessionId: SESSION });
    const signal = AbortSignal.abort();

    await expect(
      coordinator
        .stream({
          sessionId: SESSION,
          lastSeenSequence: brand<number, 'TimelineSequence'>(0),
          signal,
        })
        [Symbol.asyncIterator]()
        .next(),
    ).rejects.toMatchObject({ code: 'OWNER_SCOPE_UNAVAILABLE' });
  });

  it('does not queue a run when durable root message persistence fails', async () => {
    const runRecords = new Map<string, RequestRunRecord>();
    const titleCommands: GenerateSessionTitleCommand[] = [];
    const messageStore: SessionMessageStoreGateway = {
      async appendSessionMessage() {
        throw new Error('root message write failed');
      },
      async loadMessage() {
        return undefined;
      },
      async loadMessages() {
        return [];
      },
      async listConversationPreview() {
        return { sessionId: SESSION, totalMarkers: 0, offset: 0, limit: 100, markers: [] };
      },
      async listMessages() {
        return { items: [], limit: 20, hasMore: false };
      },
      async listCurrentRequestMessages() {
        return { items: [], offset: 0, limit: 20, hasMore: false };
      },
      async hideMessage() {
        return undefined;
      },
      async hideRequestMessages() {
        return 0;
      },
    };
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
      async loadSessionLaneSnapshot() {
        return {
          tenantId: TENANT,
          subjectId: SUBJECT,
          agentId: AGENT,
          sessionId: SESSION,
          queuedRuns: [],
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
      async commitTerminal() {
        throw new Error('unused');
      },
    };
    const coordinator = createRequestLifecycleCoordinator({
      agentConstructors: [createNoopAgentConstructor()],
      agentRuntimeDependencies: {},
      assemblyRegistry: makeAssemblyRegistry(),
      capabilityCatalog: makeCapabilityCatalog(),
      userSessions: makeUserSessions((titleCommand) => {
        titleCommands.push(titleCommand);
        return false;
      }),
      messageStore,
      activeContextStore: makeActiveContextStore(),
      requestRunStore,
      timelineStore: makeTimelineStore(),
      checkpointStore: makeCheckpointStore(),
      defaultRouteAgentId: AGENT,
    });

    await expect(
      coordinator.submit({
        sessionId: SESSION,
        identityContext: { tenantId: TENANT, subjectId: SUBJECT, displayName: 'submit test' },
        inputText: 'hello',
        attachmentIds: [],
        locale: brand<string, 'RequestLocale'>('zh-CN'),
        idempotencyKey: brand<string, 'IdempotencyKey'>('idem-submit-acceptance'),
      }),
    ).rejects.toThrow('root message write failed');

    const snapshot = await requestRunStore.loadSessionLaneSnapshot({
      tenantId: TENANT,
      subjectId: SUBJECT,
      agentId: AGENT,
      sessionId: SESSION,
    });
    expect(snapshot.queuedRuns).toEqual([]);
    expect(Array.from(runRecords.values()).some((record) => record.status === 'QUEUED' || record.status === 'EXECUTING')).toBe(false);
    expect(titleCommands).toEqual([]);
  });

  it('starts title generation immediately after request acceptance', async () => {
    const runRecords = new Map<string, RequestRunRecord>();
    const titleCommands: GenerateSessionTitleCommand[] = [];
    const coordinator = createRequestLifecycleCoordinator({
      agentConstructors: [createNoopAgentConstructor()],
      agentRuntimeDependencies: {},
      assemblyRegistry: makeAssemblyRegistry(),
      capabilityCatalog: makeCapabilityCatalog(),
      userSessions: makeUserSessions((titleCommand) => {
        titleCommands.push(titleCommand);
        return true;
      }),
      messageStore: makeWritableMessageStore(),
      activeContextStore: makeActiveContextStore(),
      requestRunStore: makeRequestRunStore(runRecords),
      timelineStore: makeWritableTimelineStore(),
      checkpointStore: makeWritableCheckpointStore(),
      defaultRouteAgentId: AGENT,
    });

    const accepted = await coordinator.submit({
      sessionId: SESSION,
      identityContext: { tenantId: TENANT, subjectId: SUBJECT, displayName: 'submit test' },
      inputText: '你好',
      attachmentIds: [],
      locale: brand<string, 'RequestLocale'>('zh-CN'),
      idempotencyKey: brand<string, 'IdempotencyKey'>('idem-submit-title-generation'),
    });

    expect(titleCommands).toHaveLength(1);
    expect(titleCommands[0]).toMatchObject({
      agentId: AGENT,
      sessionId: SESSION,
      requestRunId: accepted.runId,
      firstUserText: '你好',
      isFirstRequest: true,
    });
  });

  it('submit with guardBlockRefusal creates a run and immediately terminalizes it COMPLETED without invoking the model', async () => {
    const appended: SessionMessageRecord[] = [];
    const messageStore: SessionMessageStoreGateway = {
      ...makeWritableMessageStore(),
      async appendSessionMessage(record) {
        appended.push(record);
        return record;
      },
    };
    const runRecords = new Map<string, RequestRunRecord>();
    const commits: TerminalCommitRequest[] = [];
    const titleCommands: GenerateSessionTitleCommand[] = [];
    const coordinator = createRequestLifecycleCoordinator({
      agentConstructors: [createNoopAgentConstructor()],
      agentRuntimeDependencies: {},
      assemblyRegistry: makeAssemblyRegistry(),
      capabilityCatalog: makeCapabilityCatalog(),
      userSessions: makeUserSessions((titleCommand) => {
        titleCommands.push(titleCommand);
        return true;
      }),
      messageStore,
      activeContextStore: makeActiveContextStore(),
      requestRunStore: makeRequestRunStore(runRecords, commits),
      timelineStore: makeWritableTimelineStore(),
      checkpointStore: makeWritableCheckpointStore(),
      defaultRouteAgentId: AGENT,
    });

    const accepted = await coordinator.submit({
      sessionId: SESSION,
      identityContext: { tenantId: TENANT, subjectId: SUBJECT, displayName: 'guard test' },
      inputText: '被拦截的输入',
      attachmentIds: [],
      locale: brand<string, 'RequestLocale'>('zh-CN'),
      idempotencyKey: brand<string, 'IdempotencyKey'>('idem-guard-submit-1'),
      guardBlockRefusal: '请修改输入',
    });

    // A run was created and persisted.
    expect(runRecords.size).toBe(1);
    const run = runRecords.get(accepted.runId)!;
    expect(run.requestId).toBe(accepted.requestId);
    // The run was terminalized as COMPLETED (not FAILED) — the frontend treats
    // this as a normal completed turn, not a failure.
    expect(run.status).toBe('COMPLETED');
    expect(run.terminalCommitState).toBe('COMMITTED');
    // commitTerminal was called exactly once with COMPLETED + guardBlockedVisible
    // terminal message (visible=true + modelVisibility.excluded + guardReason, no
    // guardPhase so the frontend conversation adapter routes it via REQUEST_COMPLETED).
    expect(commits).toHaveLength(1);
    const commit = commits[0]!;
    expect(commit.terminalStatus).toBe('COMPLETED');
    const terminalMessage = commit.terminalMessage;
    expect(terminalMessage.role).toBe('ASSISTANT');
    expect(terminalMessage.content).toBe('请修改输入');
    expect(terminalMessage.visible).toBe(true);
    expect(terminalMessage.runId).toBe(accepted.runId);
    expect((terminalMessage.metadata as Record<string, unknown>).guardReason).toBe('INPUT_VIOLATION');
    expect((terminalMessage.metadata as Record<string, unknown>).modelVisibility).toEqual({ excluded: true, reason: 'GUARD_BLOCKED' });
    // The user input message was persisted (visible=true).
    const userMessage = appended.find((message) => message.role === 'USER');
    expect(userMessage).toBeDefined();
    expect(userMessage!.content).toBe('被拦截的输入');
    expect(userMessage!.visible).toBe(true);
    // Title generation fires on the guard round too (first message).
    expect(titleCommands).toHaveLength(1);
    expect(titleCommands[0]).toMatchObject({ firstUserText: '被拦截的输入', isFirstRequest: true });
  });
});

let runtimeLoggerBinding: RuntimeLoggerProviderBinding | undefined;
afterEach(() => runtimeLoggerBinding?.unbind());

function createRuntimeRecordingLogger() {
  const calls: Array<{ level: string; obj: object }> = [];
  return {
    calls,
    info(obj: object) {
      calls.push({ level: 'info', obj });
    },
    error() {},
    warn() {},
    debug() {},
  };
}

function makeDispatchCapableRequestRunStore(runRecords: Map<string, RequestRunRecord>): RequestRunStoreGateway {
  return {
    async saveRun(record, options) {
      const existing = runRecords.get(record.runId);
      if (options?.expectedVersion !== undefined) {
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
      return { status: 'COMMITTED' as const, terminalEvent: request.terminalEvent };
    },
  };
}

it('logs runtime.run.dispatched at info level with runCreatedAtMs after scheduler dispatch', async () => {
  const logs = createRuntimeRecordingLogger();
  runtimeLoggerBinding?.unbind();
  runtimeLoggerBinding = bindRuntimeLoggerProvider({ getLogger: () => logs as any });
  const runRecords = new Map<string, RequestRunRecord>();
  const coordinator = createRequestLifecycleCoordinator({
    agentConstructors: [createNoopAgentConstructor()],
    agentRuntimeDependencies: {},
    assemblyRegistry: makeAssemblyRegistry(),
    capabilityCatalog: makeCapabilityCatalog(),
    userSessions: makeUserSessions(),
    messageStore: makeWritableMessageStore(),
    activeContextStore: makeActiveContextStore(),
    requestRunStore: makeDispatchCapableRequestRunStore(runRecords),
    timelineStore: makeWritableTimelineStore(),
    checkpointStore: makeWritableCheckpointStore(),
    defaultRouteAgentId: AGENT,
  });
  await coordinator.requireSession({ identityContext: { tenantId: TENANT, subjectId: SUBJECT, displayName: 'dispatch test' }, sessionId: SESSION });

  await coordinator.submit({
    sessionId: SESSION,
    identityContext: { tenantId: TENANT, subjectId: SUBJECT, displayName: 'dispatch test' },
    inputText: 'hello',
    attachmentIds: [],
    locale: brand<string, 'RequestLocale'>('zh-CN'),
    idempotencyKey: brand<string, 'IdempotencyKey'>('idem-dispatch-log'),
  });
  await coordinator.waitForIdle({ timeoutMs: 5_000 });

  const dispatchedLog = logs.calls.find((c) => (c.obj as { event?: string }).event === 'runtime.run.dispatched');
  expect(dispatchedLog).toBeDefined();
  expect(dispatchedLog!.level).toBe('info');
  const fields = dispatchedLog!.obj as Record<string, unknown>;
  expect(typeof fields.runCreatedAtMs).toBe('number');
  expect(fields.runCreatedAtMs).toBeGreaterThan(0);
});

it('logs runtime.run.turn_completed at info level with durationMs on terminal', async () => {
  const logs = createRuntimeRecordingLogger();
  runtimeLoggerBinding?.unbind();
  runtimeLoggerBinding = bindRuntimeLoggerProvider({ getLogger: () => logs as any });
  const runRecords = new Map<string, RequestRunRecord>();
  const coordinator = createRequestLifecycleCoordinator({
    agentConstructors: [createNoopAgentConstructor()],
    agentRuntimeDependencies: {},
    assemblyRegistry: makeAssemblyRegistry(),
    capabilityCatalog: makeCapabilityCatalog(),
    userSessions: makeUserSessions(),
    messageStore: makeWritableMessageStore(),
    activeContextStore: makeActiveContextStore(),
    requestRunStore: makeDispatchCapableRequestRunStore(runRecords),
    timelineStore: makeWritableTimelineStore(),
    checkpointStore: makeWritableCheckpointStore(),
    defaultRouteAgentId: AGENT,
  });
  await coordinator.requireSession({ identityContext: { tenantId: TENANT, subjectId: SUBJECT, displayName: 'turn test' }, sessionId: SESSION });
  await coordinator.submit({
    sessionId: SESSION,
    identityContext: { tenantId: TENANT, subjectId: SUBJECT, displayName: 'turn test' },
    inputText: 'hello',
    attachmentIds: [],
    locale: brand<string, 'RequestLocale'>('zh-CN'),
    idempotencyKey: brand<string, 'IdempotencyKey'>('idem-turn-completed'),
  });
  await coordinator.waitForIdle({ timeoutMs: 5_000 });
  const turnLog = logs.calls.find((c) => (c.obj as { event?: string }).event === 'runtime.run.turn_completed');
  expect(turnLog).toBeDefined();
  expect(turnLog!.level).toBe('info');
  const fields = turnLog!.obj as Record<string, unknown>;
  expect(fields.runId).toBeDefined();
  expect(fields.runStatus).toBeDefined();
  expect(typeof fields.durationMs).toBe('number');
  expect(fields.durationMs as number).toBeGreaterThanOrEqual(0);
});

it('does not write runtime.run.dispatched or turn_completed to timeline store', async () => {
  const logs = createRuntimeRecordingLogger();
  runtimeLoggerBinding?.unbind();
  runtimeLoggerBinding = bindRuntimeLoggerProvider({ getLogger: () => logs as any });
  const runRecords = new Map<string, RequestRunRecord>();
  const timelineStore = makeCapturingTimelineStore();
  const coordinator = createRequestLifecycleCoordinator({
    agentConstructors: [createNoopAgentConstructor()],
    agentRuntimeDependencies: {},
    assemblyRegistry: makeAssemblyRegistry(),
    capabilityCatalog: makeCapabilityCatalog(),
    userSessions: makeUserSessions(),
    messageStore: makeWritableMessageStore(),
    activeContextStore: makeActiveContextStore(),
    requestRunStore: makeDispatchCapableRequestRunStore(runRecords),
    timelineStore,
    checkpointStore: makeWritableCheckpointStore(),
    defaultRouteAgentId: AGENT,
  });
  await coordinator.requireSession({ identityContext: { tenantId: TENANT, subjectId: SUBJECT, displayName: 'negative test' }, sessionId: SESSION });
  await coordinator.submit({
    sessionId: SESSION,
    identityContext: { tenantId: TENANT, subjectId: SUBJECT, displayName: 'negative test' },
    inputText: 'hello',
    attachmentIds: [],
    locale: brand<string, 'RequestLocale'>('zh-CN'),
    idempotencyKey: brand<string, 'IdempotencyKey'>('idem-negative-timeline'),
  });
  await coordinator.waitForIdle({ timeoutMs: 5_000 });
  const dispatchedLog = logs.calls.find((c) => (c.obj as { event?: string }).event === 'runtime.run.dispatched');
  expect(dispatchedLog).toBeDefined();
  const turnLog = logs.calls.find((c) => (c.obj as { event?: string }).event === 'runtime.run.turn_completed');
  expect(turnLog).toBeDefined();
  const diagnosticEvents = timelineStore.appended.filter((record) => {
    const payload = record.inlinePayload as Record<string, unknown> | undefined;
    return payload?.event === 'runtime.run.dispatched' || payload?.event === 'runtime.run.turn_completed';
  });
  expect(diagnosticEvents).toHaveLength(0);
});

function createNoopAgentConstructor(): AgentConstructor {
  return class NoopAgent {
    static getType() {
      return AGENT_TYPE;
    }

    async execute(_run: RequestRun, _context: RequestContext): Promise<{ readonly status: 'COMPLETED' }> {
      return { status: 'COMPLETED' };
    }
  };
}

function makeAssembly(): AgentAssembly {
  return {
    agentId: AGENT,
    agentType: AGENT_TYPE,
    agentVersion: AGENT_VERSION,
    agentAssemblyRef: 'agent-submit-acceptance:v1',
    displayName: 'Submit acceptance test agent',
    description: 'test',
    workspacePolicy: { schemaVersion: 'nextagent.agent-workspace-policy.v1', isolationMode: 'subject', roots: [] },
    modelIds: ['default'],
    capabilityBindings: [],
    userInvocable: true,
    agentInvocation: 'BOUND',
    runtimeSettings: { maxContextMessages: 10 },
  };
}

function makeAssemblyRegistry(): AgentAssemblyRegistry {
  return {
    active: async () => makeAssembly(),
    require: async () => makeAssembly(),
  };
}

function makeCapabilityCatalog(): CapabilityCatalog {
  return {
    listAvailable: async () => [],
    resolve: async () => undefined,
  };
}

function makeUserSessions(generateTitle: (command: GenerateSessionTitleCommand) => boolean | Promise<boolean> = async () => false): UserSessionPort {
  return {
    async createSession() {
      return createSessionRecord();
    },
    async requireSession() {
      return createSessionRecord();
    },
    async listSessions() {
      return { entries: [], offset: 0, limit: 20, hasMore: false };
    },
    async deleteSession() {},
    async listMessages() {
      return { items: [], limit: 20, hasMore: false };
    },
    async listConversationPreview() {
      return { sessionId: SESSION, totalMarkers: 0, offset: 0, limit: 100, markers: [] };
    },
    async listCurrentRequestMessages() {
      return { items: [], limit: 20, hasMore: false };
    },
    async generateTitle(command) {
      return generateTitle(command);
    },
    async updateTitle() {
      return createSessionRecord();
    },
  };
}

function makeWritableMessageStore(): SessionMessageStoreGateway {
  return {
    async appendSessionMessage(record) {
      return record;
    },
    async loadMessage() {
      return undefined;
    },
    async loadMessages() {
      return [];
    },
    async listConversationPreview() {
      return { sessionId: SESSION, totalMarkers: 0, offset: 0, limit: 100, markers: [] };
    },
    async listMessages() {
      return { items: [], limit: 20, hasMore: false };
    },
    async listCurrentRequestMessages() {
      return { items: [], offset: 0, limit: 20, hasMore: false };
    },
    async hideMessage() {
      return undefined;
    },
    async hideRequestMessages() {
      return 0;
    },
  };
}

function createSessionRecord() {
  return {
    tenantId: TENANT,
    subjectId: SUBJECT,
    agentId: AGENT,
    sessionId: SESSION,
    title: 'submit acceptance',
    createdAt: brand<number, 'EpochMillis'>(1),
    updatedAt: brand<number, 'EpochMillis'>(1),
    hasInFlightRequest: false,
  };
}

function makeActiveContextStore(): ActiveContextStoreGateway {
  return {
    async loadActiveContext() {
      return {
        state: {
          tenantId: TENANT,
          subjectId: SUBJECT,
          agentId: AGENT,
          sessionId: SESSION,
          activeContextVersion: 1,
          updatedAt: brand<number, 'EpochMillis'>(1),
        },
        items: [],
      };
    },
    async updateMetadata() {
      return {
        status: 'UPDATED' as const,
        record: {
          state: {
            tenantId: TENANT,
            subjectId: SUBJECT,
            agentId: AGENT,
            sessionId: SESSION,
            activeContextVersion: 1,
            updatedAt: brand<number, 'EpochMillis'>(1),
          },
          items: [],
        },
      };
    },
    async appendItem() {
      throw new AgentError({ code: 'NOT_USED', message: 'not used', category: 'INTERNAL', retryable: false });
    },
    async commitCompaction() {
      throw new AgentError({ code: 'NOT_USED', message: 'not used', category: 'INTERNAL', retryable: false });
    },
  };
}

function makeTimelineStore(): RunTimelineEventStoreGateway {
  return {
    async appendEvent() {
      throw new AgentError({ code: 'NOT_USED', message: 'not used', category: 'INTERNAL', retryable: false });
    },
    async listEvents() {
      return [];
    },
  };
}

function makeWritableTimelineStore(): RunTimelineEventStoreGateway {
  return {
    async appendEvent(record) {
      return record;
    },
    async listEvents() {
      return [];
    },
  };
}

function makeCapturingTimelineStore(): RunTimelineEventStoreGateway & { appended: RunTimelineEventRecord[] } {
  const appended: RunTimelineEventRecord[] = [];
  return {
    appended,
    async appendEvent(record) {
      appended.push(record);
      return record;
    },
    async listEvents() {
      return appended;
    },
  };
}

function makeCheckpointStore(): CheckpointStoreGateway {
  return {
    async saveCheckpoint() {
      throw new AgentError({ code: 'NOT_USED', message: 'not used', category: 'INTERNAL', retryable: false });
    },
    async loadCheckpoint() {
      return undefined;
    },
  };
}

function makeWritableCheckpointStore(): CheckpointStoreGateway {
  return {
    async saveCheckpoint(record) {
      return record;
    },
    async loadCheckpoint() {
      return undefined;
    },
  };
}

function makeRequestRunStore(runRecords: Map<string, RequestRunRecord>, commits: TerminalCommitRequest[] = []): RequestRunStoreGateway {
  return {
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
    async loadSessionLaneSnapshot() {
      return {
        tenantId: TENANT,
        subjectId: SUBJECT,
        agentId: AGENT,
        sessionId: SESSION,
        queuedRuns: [],
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
      commits.push(request);
      const updated: RequestRunRecord = {
        ...runRecords.get(request.runId)!,
        status: request.terminalStatus,
        terminalCommitState: 'COMMITTED',
        version: request.expectedVersion + 1,
        updatedAt: brand<number, 'EpochMillis'>(0),
      };
      runRecords.set(request.runId, updated);
      return { status: 'COMMITTED' as const, terminalEvent: request.terminalEvent };
    },
  };
}
