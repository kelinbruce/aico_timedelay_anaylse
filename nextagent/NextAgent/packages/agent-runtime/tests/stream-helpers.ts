import {
  AgentError,
  brand,
  type AgentId,
  type AgentType,
  type AgentVersion,
  type EpochMillis,
  type MessageId,
  type RequestContextId,
  type RequestRunId,
  type SessionId,
  type TenantId,
  type SubjectId,
  type TimelineSequence,
} from '@nextagent/agent-common';
import type { AgentAssembly, AgentAssemblyRegistry } from '@nextagent/agent-contracts/agent-assembly';
import type { CapabilityCatalog } from '@nextagent/agent-contracts/capability';
import type {
  ActiveContextStoreGateway,
  CheckpointStoreGateway,
  RequestRunRecord,
  RequestRunStoreGateway,
  RunTimelineEventRecord,
  RunTimelineEventStoreGateway,
  SessionMessageStoreGateway,
} from '@nextagent/agent-contracts/gateway';
import type { AgentConstructor, RequestContext, RequestRun, SessionTimelineEventInput } from '@nextagent/agent-contracts/runtime';
import type { UserSessionPort } from '@nextagent/agent-contracts/session';
import { createRequestLifecycleCoordinator, type RequestLifecycleCoordinator } from '@nextagent/agent-runtime';

export const TENANT = brand<string, 'TenantId'>('tenant-stream-hw');
export const SUBJECT = brand<string, 'SubjectId'>('subject-stream-hw');
export const AGENT = brand<string, 'AgentId'>('agent-stream-hw');
export const AGENT_TYPE = brand<string, 'AgentType'>('noop-agent');
export const AGENT_VERSION = brand<string, 'AgentVersion'>('v1');
export const SESSION = brand<string, 'SessionId'>('session-stream-hw');
export const RUN_ID = brand<string, 'RequestRunId'>('run-stream-hw');
export const REQUEST_ID = brand<string, 'MessageId'>('request-stream-hw');
export const CONTEXT_ID = brand<string, 'RequestContextId'>('ctx-stream-hw');

export function createCoordinator(): RequestLifecycleCoordinator {
  return createRequestLifecycleCoordinator({
    agentConstructors: [createNoopAgentConstructor()],
    agentRuntimeDependencies: {},
    assemblyRegistry: makeAssemblyRegistry(),
    capabilityCatalog: makeCapabilityCatalog(),
    userSessions: makeUserSessions(),
    messageStore: makeWritableMessageStore(),
    activeContextStore: makeActiveContextStore(),
    requestRunStore: makeRequestRunStore(),
    timelineStore: makeWritableTimelineStore(),
    checkpointStore: makeWritableCheckpointStore(),
    defaultRouteAgentId: AGENT,
  });
}

export function makeEventInput(index: number): SessionTimelineEventInput {
  return {
    identityContext: { tenantId: TENANT, subjectId: SUBJECT, displayName: 'test' },
    agentId: AGENT,
    agentVersion: AGENT_VERSION,
    sessionId: SESSION,
    runId: RUN_ID,
    requestId: REQUEST_ID,
    requestContextId: CONTEXT_ID,
    type: 'LLM_CONTENT_DELTA',
    inlinePayload: { content: `event-${index}` },
  };
}

export interface CoordinatorOverrideOptions {
  readonly timelineStore?: RunTimelineEventStoreGateway;
  readonly requestRunStore?: RequestRunStoreGateway;
}

export function createCoordinatorWithOptions(options: CoordinatorOverrideOptions = {}): RequestLifecycleCoordinator {
  return createRequestLifecycleCoordinator({
    agentConstructors: [createNoopAgentConstructor()],
    agentRuntimeDependencies: {},
    assemblyRegistry: makeAssemblyRegistry(),
    capabilityCatalog: makeCapabilityCatalog(),
    userSessions: makeUserSessions(),
    messageStore: makeWritableMessageStore(),
    activeContextStore: makeActiveContextStore(),
    requestRunStore: options.requestRunStore ?? makeRequestRunStore(),
    timelineStore: options.timelineStore ?? makeWritableTimelineStore(),
    checkpointStore: makeWritableCheckpointStore(),
    defaultRouteAgentId: AGENT,
  });
}

export function makeRunRecord(): RequestRunRecord {
  return {
    tenantId: TENANT,
    subjectId: SUBJECT,
    agentId: AGENT,
    agentVersion: AGENT_VERSION,
    agentAssemblyRef: brand<string, 'AgentAssemblyRef'>('assembly-stream-hw'),
    runId: RUN_ID,
    requestId: REQUEST_ID,
    sessionId: SESSION,
    attempt: 1,
    status: 'COMPLETED' as const,
    version: 1,
    terminalCommitState: 'COMMITTED' as const,
    createdAt: brand<number, 'EpochMillis'>(1),
    updatedAt: brand<number, 'EpochMillis'>(1),
  };
}

export function makeRequestRunStoreWithRun(): RequestRunStoreGateway {
  const runRecord = makeRunRecord();
  return {
    async saveRun(record) {
      return { status: 'UPDATED' as const, record };
    },
    async loadRun() {
      return runRecord;
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
      return { status: 'NOT_FOUND' as const };
    },
    async claimRun() {
      return { status: 'VERSION_CONFLICT' as const };
    },
    async listRecoverableRuns() {
      return [];
    },
    async commitTerminal() {
      throw new Error('unused');
    },
  };
}

export function flushMicrotasks(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

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
    agentAssemblyRef: 'agent-stream-hw:v1',
    displayName: 'Stream HW test agent',
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

function makeUserSessions(): UserSessionPort {
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
    async generateTitle() {
      return false;
    },
    async updateTitle() {
      return createSessionRecord();
    },
  };
}

function createSessionRecord() {
  return {
    tenantId: TENANT,
    subjectId: SUBJECT,
    agentId: AGENT,
    sessionId: SESSION,
    title: 'stream hw',
    createdAt: brand<number, 'EpochMillis'>(1),
    updatedAt: brand<number, 'EpochMillis'>(1),
    hasInFlightRequest: false,
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

function makeRequestRunStore(): RequestRunStoreGateway {
  return {
    async saveRun(record) {
      return { status: 'UPDATED', record };
    },
    async loadRun() {
      return undefined;
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
