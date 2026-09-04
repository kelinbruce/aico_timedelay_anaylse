import { AgentError, brand } from '@nextagent/agent-common';
import type { AgentAssembly, AgentAssemblyRegistry } from '@nextagent/agent-contracts/agent-assembly';
import type { CapabilityCatalog } from '@nextagent/agent-contracts/capability';
import type {
  ActiveContextStoreGateway,
  CheckpointStoreGateway,
  RequestRunRecord,
  RequestRunStoreGateway,
  RunTimelineEventStoreGateway,
  RunTimelineEventRecord,
  SessionMessageStoreGateway,
  TerminalCommitRequest,
} from '@nextagent/agent-contracts/gateway';
import type { AgentConstructor, RequestContext, RequestRun } from '@nextagent/agent-contracts/runtime';
import type { GenerateSessionTitleCommand, UserSessionPort } from '@nextagent/agent-contracts/session';
import { createRequestLifecycleCoordinator } from '@nextagent/agent-runtime';
import { describe, expect, it } from 'vitest';

const TENANT = brand<string, 'TenantId'>('tenant-cross-pod');
const SUBJECT = brand<string, 'SubjectId'>('subject-cross-pod');
const AGENT = brand<string, 'AgentId'>('agent-cross-pod');
const AGENT_TYPE = brand<string, 'AgentType'>('noop-agent');
const AGENT_VERSION = brand<string, 'AgentVersion'>('v1');
const SESSION = brand<string, 'SessionId'>('session-cross-pod');

describe('cross-pod timeline DB fallback', () => {
  it('delivers events persisted by another pod via DB fallback poll', async () => {
    const crossPodRecord: RunTimelineEventRecord = {
      tenantId: TENANT,
      subjectId: SUBJECT,
      agentId: AGENT,
      agentVersion: AGENT_VERSION,
      eventId: 'evt-1',
      sessionId: SESSION,
      runId: brand<string, 'RequestRunId'>('run-1'),
      requestId: brand<string, 'MessageId'>('req-1'),
      sequence: brand<number, 'TimelineSequence'>(1),
      type: 'REQUEST_COMPLETED',
      inlinePayload: {},
      createdAt: brand<number, 'EpochMillis'>(1),
      requestContextId: brand<string, 'RequestContextId'>('ctx-1'),
    };

    let listCallCount = 0;
    const timelineStore: RunTimelineEventStoreGateway = {
      async appendEvent(record) {
        return record;
      },
      async listEvents() {
        listCallCount += 1;
        // Call 1: replay phase returns empty.
        // Call 2+: live phase DB fallback returns the cross-pod event.
        if (listCallCount <= 1) {
          return [];
        }
        return [crossPodRecord];
      },
    };

    const coordinator = createRequestLifecycleCoordinator({
      agentConstructors: [createNoopAgentConstructor()],
      agentRuntimeDependencies: {},
      assemblyRegistry: makeAssemblyRegistry(),
      capabilityCatalog: makeCapabilityCatalog(),
      userSessions: makeUserSessions(),
      messageStore: makeWritableMessageStore(),
      activeContextStore: makeActiveContextStore(),
      requestRunStore: makeRequestRunStore(new Map()),
      timelineStore,
      checkpointStore: makeWritableCheckpointStore(),
      defaultRouteAgentId: AGENT,
    });

    const identityContext = { tenantId: TENANT, subjectId: SUBJECT, displayName: 'cross-pod test' };
    await coordinator.requireSession({ identityContext, sessionId: SESSION });

    const controller = new AbortController();
    const collected: string[] = [];
    const timeout = setTimeout(() => controller.abort(), 10_000);

    try {
      for await (const event of coordinator.stream({
        sessionId: SESSION,
        lastSeenSequence: brand<number, 'TimelineSequence'>(0),
        signal: controller.signal,
      })) {
        collected.push(event.type);
        if (event.type === 'REQUEST_COMPLETED') {
          break;
        }
      }
    } finally {
      clearTimeout(timeout);
    }

    expect(collected).toContain('REQUEST_COMPLETED');
    expect(listCallCount).toBeGreaterThanOrEqual(2);
  });

  it('degrades to idle without breaking the stream when DB poll throws', async () => {
    let listCallCount = 0;
    const timelineStore: RunTimelineEventStoreGateway = {
      async appendEvent(record) {
        return record;
      },
      async listEvents() {
        listCallCount += 1;
        // Call 1: replay returns empty.
        // Call 2: DB fallback throws (simulating timeout/failure).
        // Call 3+: DB fallback returns empty (idle).
        if (listCallCount === 2) {
          throw new AgentError({
            code: 'TIMELINE_READ_TIMEOUT',
            message: 'timeout',
            category: 'UNAVAILABLE',
            retryable: true,
          });
        }
        return [];
      },
    };

    const coordinator = createRequestLifecycleCoordinator({
      agentConstructors: [createNoopAgentConstructor()],
      agentRuntimeDependencies: {},
      assemblyRegistry: makeAssemblyRegistry(),
      capabilityCatalog: makeCapabilityCatalog(),
      userSessions: makeUserSessions(),
      messageStore: makeWritableMessageStore(),
      activeContextStore: makeActiveContextStore(),
      requestRunStore: makeRequestRunStore(new Map()),
      timelineStore,
      checkpointStore: makeWritableCheckpointStore(),
      defaultRouteAgentId: AGENT,
    });

    const identityContext = { tenantId: TENANT, subjectId: SUBJECT, displayName: 'cross-pod test' };
    await coordinator.requireSession({ identityContext, sessionId: SESSION });

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8_000);

    try {
      for await (const _event of coordinator.stream({
        sessionId: SESSION,
        lastSeenSequence: brand<number, 'TimelineSequence'>(0),
        signal: controller.signal,
      })) {
        // The stream should remain open (idle polling) without throwing.
      }
    } catch (error) {
      // If the DB poll failure propagates, the test fails.
      throw new Error(`stream should not throw on DB poll failure, got: ${(error as Error).message}`);
    } finally {
      clearTimeout(timeout);
    }

    // DB was called at least twice (replay + at least one fallback attempt that threw)
    expect(listCallCount).toBeGreaterThanOrEqual(2);
  });

  it('continues DB fallback during pending-input wait to resolve cross-pod USER_INPUT_RECEIVED', async () => {
    const requiredRecord: RunTimelineEventRecord = {
      tenantId: TENANT,
      subjectId: SUBJECT,
      agentId: AGENT,
      agentVersion: AGENT_VERSION,
      eventId: 'evt-req',
      sessionId: SESSION,
      runId: brand<string, 'RequestRunId'>('run-pi'),
      requestId: brand<string, 'MessageId'>('req-pi'),
      sequence: brand<number, 'TimelineSequence'>(1),
      type: 'USER_INPUT_REQUIRED',
      inlinePayload: {},
      createdAt: brand<number, 'EpochMillis'>(1),
      requestContextId: brand<string, 'RequestContextId'>('ctx-pi'),
    };
    const receivedRecord: RunTimelineEventRecord = {
      tenantId: TENANT,
      subjectId: SUBJECT,
      agentId: AGENT,
      agentVersion: AGENT_VERSION,
      eventId: 'evt-rec',
      sessionId: SESSION,
      runId: brand<string, 'RequestRunId'>('run-pi'),
      requestId: brand<string, 'MessageId'>('req-pi'),
      sequence: brand<number, 'TimelineSequence'>(2),
      type: 'USER_INPUT_RECEIVED',
      inlinePayload: {},
      createdAt: brand<number, 'EpochMillis'>(2),
      requestContextId: brand<string, 'RequestContextId'>('ctx-pi'),
    };
    let listCallCount = 0;
    const timelineStore: RunTimelineEventStoreGateway = {
      async appendEvent(record) {
        return record;
      },
      async listEvents() {
        listCallCount += 1;
        if (listCallCount === 1) {
          return [];
        }
        if (listCallCount === 2) {
          return [requiredRecord];
        }
        return [receivedRecord];
      },
    };
    const coordinator = createRequestLifecycleCoordinator({
      agentConstructors: [createNoopAgentConstructor()],
      agentRuntimeDependencies: {},
      assemblyRegistry: makeAssemblyRegistry(),
      capabilityCatalog: makeCapabilityCatalog(),
      userSessions: makeUserSessions(),
      messageStore: makeWritableMessageStore(),
      activeContextStore: makeActiveContextStore(),
      requestRunStore: makeRequestRunStore(new Map()),
      timelineStore,
      checkpointStore: makeWritableCheckpointStore(),
      defaultRouteAgentId: AGENT,
    });
    const identityContext = { tenantId: TENANT, subjectId: SUBJECT, displayName: 'pending-input test' };
    await coordinator.requireSession({ identityContext, sessionId: SESSION });
    const controller = new AbortController();
    const collected: string[] = [];
    const timeout = setTimeout(() => controller.abort(), 12_000);
    try {
      for await (const event of coordinator.stream({
        sessionId: SESSION,
        lastSeenSequence: brand<number, 'TimelineSequence'>(0),
        signal: controller.signal,
      })) {
        collected.push(event.type);
        if (event.type === 'USER_INPUT_RECEIVED') {
          break;
        }
      }
    } finally {
      clearTimeout(timeout);
    }
    expect(collected).toContain('USER_INPUT_REQUIRED');
    expect(collected).toContain('USER_INPUT_RECEIVED');
  });
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

function makeAssemblyRegistry(): AgentAssemblyRegistry {
  return {
    active: async () => makeAssembly(),
    require: async () => makeAssembly(),
  };
}

function makeAssembly(): AgentAssembly {
  return {
    agentId: AGENT,
    agentType: AGENT_TYPE,
    agentVersion: AGENT_VERSION,
    agentAssemblyRef: 'agent-cross-pod:v1',
    displayName: 'Cross-pod fallback test agent',
    description: 'test',
    workspacePolicy: { schemaVersion: 'nextagent.agent-workspace-policy.v1', isolationMode: 'subject', roots: [] },
    modelIds: ['default'],
    capabilityBindings: [],
    userInvocable: true,
    agentInvocation: 'BOUND',
    runtimeSettings: { maxContextMessages: 10 },
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
      return { items: [], limit: 20, hasMore: false };
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
    title: 'cross-pod',
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

function makeRequestRunStore(runRecords: Map<string, RequestRunRecord>): RequestRunStoreGateway {
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
    async commitTerminal(_request: TerminalCommitRequest) {
      return { status: 'COMMITTED' as const };
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
