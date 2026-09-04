import {
  AgentError,
  brand,
  type AgentId,
  type AgentType,
  type AgentVersion,
  type EpochMillis,
  type IdempotencyKey,
  type MessageId,
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

const tenantId = brand<string, 'TenantId'>('tenant-retry-limit');
const subjectId = brand<string, 'SubjectId'>('subject-retry-limit');
const agentId = brand<string, 'AgentId'>('agent-retry-limit');
const agentVersion = brand<string, 'AgentVersion'>('v1');
const sessionId = brand<string, 'SessionId'>('session-retry-limit');
const identityContext = { tenantId, subjectId, displayName: 'Retry Limit' };

function retryCommand(requestId: MessageId, key: string) {
  return {
    sessionId,
    identityContext,
    expectedLatestRequestId: requestId,
    action: 'RETRY_LATEST' as const,
    idempotencyKey: brand<string, 'IdempotencyKey'>(key),
  };
}

async function submitAndIdle(coordinator: RequestLifecycleCoordinator) {
  const accepted = await coordinator.submit({
    sessionId,
    identityContext,
    inputText: 'diagnose RAN alarms in sector 3',
    attachmentIds: [],
    locale: brand<string, 'RequestLocale'>('zh-CN'),
    idempotencyKey: brand<string, 'IdempotencyKey'>('idem-retry-limit-submit'),
  });
  await coordinator.waitForIdle({ timeoutMs: 5_000 });
  return accepted;
}

describe('retry attempt limit', () => {
  it('accepts 5 retries up to attempt 6 and rejects the 6th retry with a stable safe error', async () => {
    const harness = makeHarness();
    const coordinator = new RequestLifecycleCoordinator(harness.deps);
    const accepted = await submitAndIdle(coordinator);

    let lastAttempt = accepted.attempt;
    for (let index = 1; index <= 5; index += 1) {
      const retryAccepted = await coordinator.retryLatest(retryCommand(accepted.requestId, `idem-retry-limit-retry-${index}`));
      await coordinator.waitForIdle({ timeoutMs: 5_000 });
      lastAttempt = retryAccepted.attempt;
    }
    expect(lastAttempt).toBe(6);

    await expect(coordinator.retryLatest(retryCommand(accepted.requestId, 'idem-retry-limit-retry-6'))).rejects.toMatchObject({
      code: 'REQUEST_RETRY_LIMIT_EXCEEDED',
      category: 'CONFLICT',
      retryable: false,
      safeDetails: { reasonCode: 'REQUEST_RETRY_LIMIT_EXCEEDED' },
    });
  });

  it('rejection beyond the limit creates no attempt, timeline event or message side effects', async () => {
    const harness = makeHarness();
    const coordinator = new RequestLifecycleCoordinator(harness.deps);
    const accepted = await submitAndIdle(coordinator);
    for (let index = 1; index <= 5; index += 1) {
      await coordinator.retryLatest(retryCommand(accepted.requestId, `idem-retry-limit-retry-${index}`));
      await coordinator.waitForIdle({ timeoutMs: 5_000 });
    }

    const runsBefore = harness.runRecords.size;
    const eventsBefore = harness.timelineEvents.length;
    const messagesBefore = harness.messageRecords.size;
    const maxAttemptBefore = Math.max(...[...harness.runRecords.values()].map((record) => record.attempt));

    await expect(coordinator.retryLatest(retryCommand(accepted.requestId, 'idem-retry-limit-retry-6'))).rejects.toMatchObject({
      code: 'REQUEST_RETRY_LIMIT_EXCEEDED',
    });

    expect(harness.runRecords.size).toBe(runsBefore);
    expect(harness.timelineEvents.length).toBe(eventsBefore);
    expect(harness.messageRecords.size).toBe(messagesBefore);
    expect(Math.max(...[...harness.runRecords.values()].map((record) => record.attempt))).toBe(maxAttemptBefore);
  });

  it('counts a FAILED retry attempt toward the limit', async () => {
    const failOnAttempts = new Set([2]);
    const harness = makeHarness(failOnAttempts);
    const coordinator = new RequestLifecycleCoordinator(harness.deps);
    const accepted = await submitAndIdle(coordinator);

    const attempts: number[] = [];
    for (let index = 1; index <= 5; index += 1) {
      const retryAccepted = await coordinator.retryLatest(retryCommand(accepted.requestId, `idem-retry-limit-retry-${index}`));
      await coordinator.waitForIdle({ timeoutMs: 5_000 });
      attempts.push(retryAccepted.attempt);
    }
    expect(attempts).toEqual([2, 3, 4, 5, 6]);
    expect(harness.runRecords.get([...harness.runRecords.values()].find((record) => record.attempt === 2)?.runId ?? '')?.status).toBe('FAILED');

    await expect(coordinator.retryLatest(retryCommand(accepted.requestId, 'idem-retry-limit-retry-6'))).rejects.toMatchObject({
      code: 'REQUEST_RETRY_LIMIT_EXCEEDED',
    });
  });

  it('replays an already accepted retry idempotently even after the limit is reached', async () => {
    const harness = makeHarness();
    const coordinator = new RequestLifecycleCoordinator(harness.deps);
    const accepted = await submitAndIdle(coordinator);
    for (let index = 1; index <= 5; index += 1) {
      await coordinator.retryLatest(retryCommand(accepted.requestId, `idem-retry-limit-retry-${index}`));
      await coordinator.waitForIdle({ timeoutMs: 5_000 });
    }

    const runsBefore = harness.runRecords.size;
    const replayed = await coordinator.retryLatest(retryCommand(accepted.requestId, 'idem-retry-limit-retry-5'));
    expect(replayed.attempt).toBe(6);
    expect(harness.runRecords.size).toBe(runsBefore);
  });
});

function makeHarness(failOnAttempts: ReadonlySet<number> = new Set()) {
  const assembly = makeAssembly();
  const session: UserSession = {
    tenantId,
    subjectId,
    agentId: assembly.agentId,
    sessionId,
    title: 'Retry Limit Session',
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
    messageRecords,
    timelineEvents,
    deps: {
      defaultRouteAgentId: assembly.agentId,
      agentConstructors: [makeAgentConstructor(failOnAttempts) as AgentConstructor],
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
      capabilityCatalog: {} as CapabilityCatalog,
      internalObserver: () => undefined,
    },
  };
}

function makeAssembly(): AgentAssembly {
  return {
    agentId,
    agentVersion,
    agentAssemblyRef: 'agent-retry-limit@v1',
    agentType: brand<string, 'AgentType'>('DEFAULT') as AgentType,
    title: 'Retry Limit',
    displayName: 'Retry Limit',
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

function makeAgentConstructor(failOnAttempts: ReadonlySet<number>): AgentConstructor {
  return class TestAgent implements Agent {
    static getType(): AgentType {
      return brand<string, 'AgentType'>('DEFAULT') as AgentType;
    }

    async execute(run: RequestRun, _context: RequestContext): Promise<AgentExecutionOutcome> {
      if (failOnAttempts.has(run.attempt)) {
        throw new Error('simulated attempt failure');
      }
      return { status: 'COMPLETED' };
    }
  };
}
