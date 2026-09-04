import {
  brand,
  type AgentId,
  type PendingInputKind,
  type RequestRunId,
  type SessionId,
  type SubjectId,
  type TenantId,
} from '@nextagent/agent-common';
import type {
  PendingInputRecord,
  PendingInputStoreGateway,
  RequestRunRecord,
  RequestRunStoreGateway,
  SessionHistoryEntry,
  SessionLaneSnapshot,
  SessionRecord,
  SessionStoreGateway,
} from '@nextagent/agent-contracts/gateway';
import { vi } from 'vitest';
import { createSessionActivityService } from '../src/services/session-activity-service.js';

export const tenantId = brand<string, 'TenantId'>('tenant-session-activity');
export const subjectId = brand<string, 'SubjectId'>('subject-session-activity');
export const agentId = brand<string, 'AgentId'>('agent-session-activity');
export const sessionId = brand<string, 'SessionId'>('session-activity');
export const identityContext = { tenantId, subjectId, displayName: 'Session Activity Tester' };

export function createSessionActivityFixture() {
  const sessions = new Map<SessionId, SessionRecord>();
  const historyEntries: SessionHistoryEntry[] = [];
  const laneSnapshots = new Map<SessionId, SessionLaneSnapshot>();
  const pendingInputs = new Map<SessionId, PendingInputRecord>();
  let activityIdSequence = 0;

  const sessionStore: Pick<SessionStoreGateway, 'loadSession' | 'listSessions'> = {
    loadSession: vi.fn(async (query) => {
      if (query.tenantId !== tenantId || query.subjectId !== subjectId || query.agentId !== agentId) {
        return undefined;
      }
      return sessions.get(query.sessionId);
    }),
    listSessions: vi.fn(async (query) => {
      if (query.tenantId !== tenantId || query.subjectId !== subjectId || query.agentId !== agentId) {
        return { entries: [], offset: query.offset, limit: query.limit, hasMore: false };
      }
      const entries = historyEntries.slice(query.offset, query.offset + query.limit);
      return {
        entries,
        offset: query.offset,
        limit: query.limit,
        hasMore: query.offset + query.limit < historyEntries.length,
      };
    }),
  };
  const requestRuns: Pick<RequestRunStoreGateway, 'loadSessionLaneSnapshot'> = {
    loadSessionLaneSnapshot: vi.fn(async (query) => laneSnapshots.get(query.sessionId) ?? makeLaneSnapshot(query.sessionId)),
  };
  const pendingInputStore: Pick<PendingInputStoreGateway, 'loadActivePendingInput'> = {
    loadActivePendingInput: vi.fn(async (query) => pendingInputs.get(query.sessionId)),
  };
  const service = createSessionActivityService({
    sessions: sessionStore,
    requestRuns,
    pendingInputs: pendingInputStore,
    createActivityId: () => `activity-${++activityIdSequence}`,
  });

  return {
    service,
    sessionStore,
    requestRuns,
    pendingInputStore,
    addSession(currentSessionId: SessionId, hasInFlightRequest = false) {
      sessions.set(currentSessionId, makeSessionRecord(currentSessionId));
      historyEntries.push(makeHistoryEntry(currentSessionId, hasInFlightRequest));
    },
    deleteSession(currentSessionId: SessionId) {
      sessions.delete(currentSessionId);
      const historyIndex = historyEntries.findIndex((entry) => entry.sessionId === currentSessionId);
      if (historyIndex >= 0) {
        historyEntries.splice(historyIndex, 1);
      }
      laneSnapshots.delete(currentSessionId);
      pendingInputs.delete(currentSessionId);
    },
    setLane(currentSessionId: SessionId, latestRun?: RequestRunRecord) {
      laneSnapshots.set(currentSessionId, makeLaneSnapshot(currentSessionId, latestRun));
    },
    setPending(currentSessionId: SessionId, pending?: PendingInputRecord) {
      if (pending === undefined) {
        pendingInputs.delete(currentSessionId);
      } else {
        pendingInputs.set(currentSessionId, pending);
      }
    },
  };
}

export function coordinates(currentSessionId: SessionId = sessionId) {
  return { tenantId, subjectId, agentId, sessionId: currentSessionId };
}

export function makeSessionId(value: string): SessionId {
  return brand<string, 'SessionId'>(value);
}

export function makeRun(
  currentSessionId: SessionId,
  runIdValue: string,
  status: RequestRunRecord['status'],
  terminalCommitState: RequestRunRecord['terminalCommitState'],
): RequestRunRecord {
  return {
    tenantId,
    subjectId,
    agentId,
    sessionId: currentSessionId,
    requestId: brand(`request-${runIdValue}`),
    runId: brand(runIdValue),
    agentVersion: brand('1.0.0'),
    agentAssemblyRef: 'assembly-ref',
    attempt: 1,
    status,
    version: 1,
    terminalCommitState,
    createdAt: brand(1),
    updatedAt: brand(1),
  };
}

export function makePendingInput(currentSessionId: SessionId, runIdValue: string, kind: PendingInputKind): PendingInputRecord {
  const pendingInputId = brand<string, 'PendingInputId'>(`pending-${runIdValue}`);
  return {
    tenantId,
    subjectId,
    agentId,
    pendingInputId,
    requestRunId: brand<string, 'RequestRunId'>(runIdValue),
    sessionId: currentSessionId,
    requestId: brand(`request-${runIdValue}`),
    requestContextId: brand(`context-${runIdValue}`),
    checkpointId: brand(`checkpoint-${runIdValue}`),
    kind,
    request: { id: pendingInputId, sessionId: currentSessionId, kind, questions: [] },
    producerRef: {
      kind: 'CAPABILITY_INVOCATION',
      capabilityId: brand('capability-id'),
      toolCallId: brand(`tool-${runIdValue}`),
    },
    status: 'PENDING',
    createdAt: brand(1),
    updatedAt: brand(1),
  };
}

export async function nextMessage<T>(iterator: AsyncIterator<T>): Promise<T> {
  const result = await Promise.race([
    iterator.next(),
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Timed out waiting for activity message.')), 2_000)),
  ]);
  if (result.done) {
    throw new Error('Activity stream ended before the expected message.');
  }
  return result.value;
}

function makeSessionRecord(currentSessionId: SessionId): SessionRecord {
  return {
    tenantId,
    subjectId,
    agentId,
    sessionId: currentSessionId,
    createdAt: brand(1),
    updatedAt: brand(1),
  };
}

function makeHistoryEntry(currentSessionId: SessionId, hasInFlightRequest: boolean): SessionHistoryEntry {
  return {
    ...makeSessionRecord(currentSessionId),
    hasInFlightRequest,
  };
}

function makeLaneSnapshot(currentSessionId: SessionId, latestRun?: RequestRunRecord): SessionLaneSnapshot {
  return {
    tenantId,
    subjectId,
    agentId,
    sessionId: currentSessionId,
    queuedRuns: [],
    ...(latestRun === undefined ? {} : { latestRun }),
  };
}

export interface ActivityScopeBrands {
  readonly tenantId: TenantId;
  readonly subjectId: SubjectId;
  readonly agentId: AgentId;
  readonly sessionId: SessionId;
  readonly runId: RequestRunId;
}
