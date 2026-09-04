import { brand, type SafeError } from '@nextagent/agent-common';
import type { AgentAssembly, AgentAssemblyRegistry } from '@nextagent/agent-contracts/agent-assembly';
import type { CapabilityCatalog } from '@nextagent/agent-contracts/capability';
import type {
  ActiveContextStoreGateway,
  CheckpointStoreGateway,
  ConversationAnnotationStoreGateway,
  DeleteAnnotationsByRunRequest,
  RequestRunRecord,
  RequestRunStoreGateway,
  RunTimelineEventStoreGateway,
  SessionMessageStoreGateway,
} from '@nextagent/agent-contracts/gateway';
import type { AgentConstructor, RequestContext, RequestRun } from '@nextagent/agent-contracts/runtime';
import type { UserSessionPort } from '@nextagent/agent-contracts/session';
import { createRequestLifecycleCoordinator } from '@nextagent/agent-runtime';
import { describe, expect, it } from 'vitest';

const TENANT = brand<string, 'TenantId'>('tenant-supersede-cleanup');
const SUBJECT = brand<string, 'SubjectId'>('subject-supersede-cleanup');
const AGENT = brand<string, 'AgentId'>('agent-supersede-cleanup');
const AGENT_TYPE = brand<string, 'AgentType'>('noop-agent');
const AGENT_VERSION = brand<string, 'AgentVersion'>('v1');
const SESSION = brand<string, 'SessionId'>('session-supersede-cleanup');
const REQUEST_ID = brand<string, 'MessageId'>('request-source');
const SOURCE_RUN_ID = brand<string, 'RequestRunId'>('run-source');

function makeSourceRun(): RequestRunRecord {
  const now = brand<number, 'EpochMillis'>(1000);
  return {
    tenantId: TENANT,
    subjectId: SUBJECT,
    agentId: AGENT,
    runId: SOURCE_RUN_ID,
    sessionId: SESSION,
    requestId: REQUEST_ID,
    agentVersion: AGENT_VERSION,
    agentAssemblyRef: 'agent-supersede-cleanup:v1',
    attempt: 1,
    status: 'COMPLETED',
    version: 1,
    terminalCommitState: 'COMMITTED',
    createdAt: now,
    updatedAt: now,
  };
}

function makeUserSession() {
  return {
    tenantId: TENANT,
    subjectId: SUBJECT,
    agentId: AGENT,
    sessionId: SESSION,
    title: 'supersede cleanup test',
    createdAt: brand<number, 'EpochMillis'>(1),
    updatedAt: brand<number, 'EpochMillis'>(1),
    hasInFlightRequest: false,
  };
}

describe('supersede annotation cleanup', () => {
  it('deletes source run annotations on retry', async () => {
    const sourceRun = makeSourceRun();
    const deletedRuns: DeleteAnnotationsByRunRequest[] = [];

    const annotationStore: ConversationAnnotationStoreGateway = {
      async saveAnnotation() {
        throw new Error('unused');
      },
      async deleteAnnotationsByRun(request) {
        deletedRuns.push(request);
      },
      async listFavoriteTurns() {
        return [];
      },
      async listQuestionFavoriteTurns() {
        return [];
      },
      async listSessionAnnotations() {
        return [];
      },
    };

    const coordinator = createRequestLifecycleCoordinator({
      agentConstructors: [createNoopAgentConstructor()],
      agentRuntimeDependencies: {},
      assemblyRegistry: makeAssemblyRegistry(),
      capabilityCatalog: makeCapabilityCatalog(),
      userSessions: makeUserSessions(),
      messageStore: makeMessageStore(),
      activeContextStore: makeActiveContextStore(),
      requestRunStore: makeRequestRunStore(sourceRun),
      timelineStore: makeTimelineStore(),
      checkpointStore: makeCheckpointStore(),
      conversationAnnotationStore: annotationStore,
      defaultRouteAgentId: AGENT,
    });

    await coordinator.retryLatest({
      sessionId: SESSION,
      identityContext: { tenantId: TENANT, subjectId: SUBJECT, displayName: 'retry test' },
      expectedLatestRequestId: REQUEST_ID,
      action: 'RETRY_LATEST',
      idempotencyKey: brand<string, 'IdempotencyKey'>('idem-retry-cleanup'),
    });

    expect(deletedRuns).toHaveLength(1);
    const deletedRun = deletedRuns[0];
    expect(deletedRun?.requestRunId).toBe(SOURCE_RUN_ID);
    expect(deletedRun?.agentId).toBe(AGENT);
    expect(deletedRun?.tenantId).toBe(TENANT);
    expect(deletedRun?.subjectId).toBe(SUBJECT);
  });

  it('fails the retry when annotation cleanup returns SafeError', async () => {
    const sourceRun = makeSourceRun();
    const storageError: SafeError = {
      code: 'ANNOTATION_STORAGE_UNAVAILABLE',
      message: 'Annotation storage is unavailable.',
      category: 'UNAVAILABLE',
      retryable: true,
    };

    const annotationStore: ConversationAnnotationStoreGateway = {
      async saveAnnotation() {
        throw new Error('unused');
      },
      async deleteAnnotationsByRun() {
        return storageError;
      },
      async listFavoriteTurns() {
        return [];
      },
      async listQuestionFavoriteTurns() {
        return [];
      },
      async listSessionAnnotations() {
        return [];
      },
    };

    const coordinator = createRequestLifecycleCoordinator({
      agentConstructors: [createNoopAgentConstructor()],
      agentRuntimeDependencies: {},
      assemblyRegistry: makeAssemblyRegistry(),
      capabilityCatalog: makeCapabilityCatalog(),
      userSessions: makeUserSessions(),
      messageStore: makeMessageStore(),
      activeContextStore: makeActiveContextStore(),
      requestRunStore: makeRequestRunStore(sourceRun),
      timelineStore: makeTimelineStore(),
      checkpointStore: makeCheckpointStore(),
      conversationAnnotationStore: annotationStore,
      defaultRouteAgentId: AGENT,
    });

    await expect(
      coordinator.retryLatest({
        sessionId: SESSION,
        identityContext: { tenantId: TENANT, subjectId: SUBJECT, displayName: 'retry failure test' },
        expectedLatestRequestId: REQUEST_ID,
        action: 'RETRY_LATEST',
        idempotencyKey: brand<string, 'IdempotencyKey'>('idem-retry-cleanup-failure'),
      }),
    ).rejects.toThrow();
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

function makeAssembly(): AgentAssembly {
  return {
    agentId: AGENT,
    agentType: AGENT_TYPE,
    agentVersion: AGENT_VERSION,
    agentAssemblyRef: 'agent-supersede-cleanup:v1',
    displayName: 'Supersede cleanup test agent',
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
  return { active: async () => makeAssembly(), require: async () => makeAssembly() };
}

function makeCapabilityCatalog(): CapabilityCatalog {
  return { listAvailable: async () => [], resolve: async () => undefined };
}

function makeUserSessions(): UserSessionPort {
  return {
    async createSession() {
      return makeUserSession();
    },
    async requireSession() {
      return makeUserSession();
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
      return makeUserSession();
    },
  };
}

function makeMessageStore(): SessionMessageStoreGateway {
  return {
    async appendSessionMessage(record) {
      return record;
    },
    async loadMessage() {
      return undefined;
    },
    async listConversationPreview() {
      return { sessionId: SESSION, totalMarkers: 0, offset: 0, limit: 100, markers: [] };
    },
    async loadMessages() {
      return [];
    },
    async listMessages() {
      return { items: [], limit: 20, hasMore: false };
    },
    async listCurrentRequestMessages() {
      return { items: [], offset: 0, limit: 100, hasMore: false };
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
  const state = {
    tenantId: TENANT,
    subjectId: SUBJECT,
    agentId: AGENT,
    sessionId: SESSION,
    activeContextVersion: 1,
    updatedAt: brand<number, 'EpochMillis'>(1),
  };
  return {
    async loadActiveContext() {
      return { state, items: [] };
    },
    async appendItem() {
      return { status: 'UPDATED' as const, record: { state, items: [] } };
    },
    async commitCompaction() {
      return { status: 'UPDATED' as const, record: { state, items: [] } };
    },
    async updateMetadata() {
      return { status: 'UPDATED' as const, record: { state, items: [] } };
    },
  };
}

function makeRequestRunStore(sourceRun: RequestRunRecord): RequestRunStoreGateway {
  return {
    async saveRun(record) {
      return { status: 'UPDATED', record };
    },
    async loadRun(request) {
      if (request.runId === sourceRun.runId) {
        return sourceRun;
      }
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
        latestRequestId: REQUEST_ID,
        latestRun: sourceRun,
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
    async commitTerminal(record) {
      return { status: 'COMMITTED' };
    },
  };
}

function makeTimelineStore(): RunTimelineEventStoreGateway {
  return {
    async appendEvent(record) {
      return record;
    },
    async listEvents() {
      return [];
    },
  };
}

function makeCheckpointStore(): CheckpointStoreGateway {
  return {
    async saveCheckpoint(record) {
      return record;
    },
    async loadCheckpoint() {
      return undefined;
    },
  };
}
