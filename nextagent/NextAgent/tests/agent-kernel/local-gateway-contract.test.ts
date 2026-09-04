import { brand, type EpochMillis } from '@nextagent/agent-common';
import type {
  CheckpointRecord,
  PendingInputRecord,
  RequestRunRecord,
  RunTimelineEventRecord,
  RuntimeRunTimelineEventRecord,
  SessionMessageRecord,
  SessionRecord,
} from '@nextagent/agent-contracts/gateway';
import { createTestGatewayStores, createTestGatewayStoresWithSqliteFile } from '../fixtures/local-gateway.js';
import { createUserSessionService } from '@nextagent/agent-session';
import { createSqliteGatewayStores, type LocalGatewayStores } from '@nextagent/agent-platform-gateway-local';
import { createDisabledLongTermMemoryGateway } from '@nextagent/agent-memory';
import type { UserSessionPort } from '@nextagent/agent-contracts/session';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { describe, it, expect, beforeEach, vi } from 'vitest';

function fakeNow(): EpochMillis {
  return brand<number, 'EpochMillis'>(Date.now());
}

function makeSession(overrides: Partial<SessionRecord> = {}): SessionRecord {
  return {
    tenantId: brand<string, 'TenantId'>('tenant-ct'),
    subjectId: brand<string, 'SubjectId'>('subject-ct'),
    agentId: brand<string, 'AgentId'>('agent-ct'),
    sessionId: brand<string, 'SessionId'>('session-ct'),
    title: 'test session',
    createdAt: fakeNow(),
    updatedAt: fakeNow(),
    ...overrides,
  };
}

function makeUntitledSession(overrides: Partial<SessionRecord> = {}): SessionRecord {
  const record = { ...makeSession(overrides) };
  delete (record as { title?: string }).title;
  return record;
}

function makeMessage(overrides: Partial<SessionMessageRecord> = {}): SessionMessageRecord {
  return {
    tenantId: brand<string, 'TenantId'>('tenant-ct'),
    subjectId: brand<string, 'SubjectId'>('subject-ct'),
    agentId: brand<string, 'AgentId'>('agent-ct'),
    messageId: brand<string, 'MessageId'>('msg-ct'),
    sessionId: brand<string, 'SessionId'>('session-ct'),
    requestId: brand<string, 'MessageId'>('request-ct'),
    runId: brand<string, 'RequestRunId'>('run-ct'),
    role: 'USER',
    content: 'hello',
    contentType: 'PLAIN_TEXT',
    metadata: {},
    visible: true,
    createdAt: fakeNow(),
    ...overrides,
  };
}

function makeRun(overrides: Partial<RequestRunRecord> = {}): RequestRunRecord {
  return {
    tenantId: brand<string, 'TenantId'>('tenant-ct'),
    subjectId: brand<string, 'SubjectId'>('subject-ct'),
    runId: brand<string, 'RequestRunId'>('run-ct0'),
    sessionId: brand<string, 'SessionId'>('session-ct'),
    requestId: brand<string, 'MessageId'>('request-ct'),
    agentId: brand<string, 'AgentId'>('agent-ct'),
    agentVersion: brand<string, 'AgentVersion'>('1.0'),
    agentAssemblyRef: 'assembly-ref',
    attempt: 1,
    status: 'EXECUTING',
    version: 1,
    terminalCommitState: 'NOT_STARTED',
    createdAt: fakeNow(),
    updatedAt: fakeNow(),
    ...overrides,
  };
}

function makeTimelineEvent(overrides: Partial<RuntimeRunTimelineEventRecord> = {}): RuntimeRunTimelineEventRecord {
  return {
    tenantId: brand<string, 'TenantId'>('tenant-ct'),
    subjectId: brand<string, 'SubjectId'>('subject-ct'),
    agentId: brand<string, 'AgentId'>('agent-ct'),
    agentVersion: brand<string, 'AgentVersion'>('1.0'),
    eventId: 'event-ct',
    sessionId: brand<string, 'SessionId'>('session-ct'),
    runId: brand<string, 'RequestRunId'>('run-ct'),
    requestId: brand<string, 'MessageId'>('request-ct'),
    requestContextId: brand<string, 'RequestContextId'>('ctx-ct'),
    sequence: brand<number, 'TimelineSequence'>(0),
    type: 'LLM_CONTENT_DELTA',
    inlinePayload: { content: 'delta' },
    createdAt: fakeNow(),
    ...overrides,
  };
}

function makeCheckpoint(overrides: Partial<CheckpointRecord> = {}): CheckpointRecord {
  return {
    tenantId: brand<string, 'TenantId'>('tenant-ct'),
    subjectId: brand<string, 'SubjectId'>('subject-ct'),
    agentId: brand<string, 'AgentId'>('agent-ct'),
    checkpointId: brand<string, 'CheckpointId'>('cp-ct'),
    sessionId: brand<string, 'SessionId'>('session-ct'),
    requestId: brand<string, 'MessageId'>('request-ct'),
    runId: brand<string, 'RequestRunId'>('run-ct'),
    requestContextId: brand<string, 'RequestContextId'>('ctx-ct'),
    runVersion: 1,
    triggerReason: 'RUN_ACCEPTED',
    lastSequence: brand<number, 'TimelineSequence'>(0),
    activeContextVersion: 0,
    flowVariables: {},
    savedAt: fakeNow(),
    ...overrides,
    agentTurnIndex: overrides.agentTurnIndex ?? 0,
  };
}

function makePendingInput(overrides: Partial<PendingInputRecord> = {}): PendingInputRecord {
  const pendingInputId = overrides.pendingInputId ?? brand<string, 'PendingInputId'>('pending-ct');
  const sessionId = overrides.sessionId ?? brand<string, 'SessionId'>('session-ct-pending');
  return {
    tenantId: brand<string, 'TenantId'>('tenant-ct'),
    subjectId: brand<string, 'SubjectId'>('subject-ct'),
    agentId: brand<string, 'AgentId'>('agent-ct'),
    pendingInputId,
    requestRunId: overrides.requestRunId ?? brand<string, 'RequestRunId'>(`run-${pendingInputId}`),
    sessionId,
    requestId: overrides.requestId ?? brand<string, 'MessageId'>(`request-${pendingInputId}`),
    requestContextId: brand<string, 'RequestContextId'>(`context-${pendingInputId}`),
    checkpointId: brand<string, 'CheckpointId'>(`checkpoint-${pendingInputId}`),
    kind: 'QUESTION',
    request: overrides.request ?? {
      id: pendingInputId,
      sessionId,
      kind: 'QUESTION',
      questions: [{ prompt: 'Continue?', options: [{ label: 'yes', value: 'yes' }] }],
    },
    producerRef: { kind: 'LIFECYCLE_HOOK' },
    status: 'PENDING',
    createdAt: fakeNow(),
    updatedAt: fakeNow(),
    ...overrides,
  };
}

describe('local gateway contract tests', () => {
  let gateway: LocalGatewayStores;
  let sessions: UserSessionPort;

  beforeEach(() => {
    gateway = createTestGatewayStores();
    sessions = createUserSessionService({
      sessionStore: gateway.sessions,
      messageStore: gateway.messages,
      activeContextStore: gateway.activeContext,
    });
  });

  // ── SessionStoreGateway ──

  describe('SessionStoreGateway', () => {
    it('loadSession returns record for correct scope', async () => {
      const session = makeSession();
      await gateway.sessions.saveSession(session, { idempotencyKey: brand<string, 'IdempotencyKey'>('idem-s1') });

      const result = await gateway.sessions.loadSession({
        tenantId: session.tenantId,
        subjectId: session.subjectId,
        agentId: session.agentId,
        sessionId: session.sessionId,
      });
      expect(result).toBeDefined();
      expect(result?.sessionId).toBe(session.sessionId);
    });

    it('loadSession returns undefined for mismatched tenantId', async () => {
      const session = makeSession();
      await gateway.sessions.saveSession(session, { idempotencyKey: brand<string, 'IdempotencyKey'>('idem-s2') });

      const result = await gateway.sessions.loadSession({
        tenantId: brand<string, 'TenantId'>('tenant-other'),
        subjectId: session.subjectId,
        agentId: session.agentId,
        sessionId: session.sessionId,
      });
      expect(result).toBeUndefined();
    });

    it('listSessions returns only matching agent and owner scope', async () => {
      await gateway.sessions.saveSession(
        makeSession({ sessionId: brand<string, 'SessionId'>('session-ct-a1'), agentId: brand<string, 'AgentId'>('agent-a1') }),
        { idempotencyKey: brand<string, 'IdempotencyKey'>('idem-a1') },
      );
      await gateway.sessions.saveSession(
        makeSession({ sessionId: brand<string, 'SessionId'>('session-ct-a2'), agentId: brand<string, 'AgentId'>('agent-a2') }),
        { idempotencyKey: brand<string, 'IdempotencyKey'>('idem-a2') },
      );

      const result = await gateway.sessions.listSessions({
        tenantId: brand<string, 'TenantId'>('tenant-ct'),
        subjectId: brand<string, 'SubjectId'>('subject-ct'),
        agentId: brand<string, 'AgentId'>('agent-a1'),
        offset: 0,
        limit: 10,
      });
      expect(result.entries).toHaveLength(1);
      expect(result.entries[0]?.sessionId).toBe('session-ct-a1');
    });

    it('deleteSessionCascade physically deletes terminal session facts and scoped dependents', async () => {
      const session = makeSession({ sessionId: brand<string, 'SessionId'>('session-delete-cascade') });
      const run = makeRun({
        sessionId: session.sessionId,
        runId: brand<string, 'RequestRunId'>('run-delete-cascade'),
        status: 'COMPLETED',
        terminalCommitState: 'COMMITTED',
      });
      const message = makeMessage({
        sessionId: session.sessionId,
        messageId: brand<string, 'MessageId'>('msg-delete-cascade'),
        requestId: run.requestId,
        runId: run.runId,
      });
      const timeline = makeTimelineEvent({
        sessionId: session.sessionId,
        runId: run.runId,
        requestId: run.requestId,
        eventId: 'event-delete-cascade',
      });
      const checkpoint = makeCheckpoint({
        sessionId: session.sessionId,
        runId: run.runId,
        requestId: run.requestId,
        checkpointId: brand<string, 'CheckpointId'>('cp-delete-cascade'),
      });
      const pendingInput = makePendingInput({
        tenantId: session.tenantId,
        subjectId: session.subjectId,
        agentId: session.agentId,
        sessionId: session.sessionId,
        requestRunId: run.runId,
        requestId: run.requestId,
        checkpointId: checkpoint.checkpointId,
        pendingInputId: brand<string, 'PendingInputId'>('pending-delete-cascade'),
        status: 'TIMED_OUT',
        request: {
          id: brand<string, 'PendingInputId'>('pending-delete-cascade'),
          sessionId: session.sessionId,
          kind: 'QUESTION',
          questions: [{ prompt: 'Deleted timeout?', options: [] }],
          timeoutAt: brand<number, 'EpochMillis'>(5),
        },
      });

      await gateway.sessions.saveSession(session, { idempotencyKey: brand<string, 'IdempotencyKey'>('idem-delete-cascade-session') });
      await gateway.requestRuns.saveRun(run, {});
      await gateway.messages.appendSessionMessage(message, { idempotencyKey: brand<string, 'IdempotencyKey'>('idem-delete-cascade-message') });
      await gateway.timeline.appendEvent(timeline, { idempotencyKey: brand<string, 'IdempotencyKey'>('idem-delete-cascade-event') });
      await gateway.checkpoints.saveCheckpoint(checkpoint, { idempotencyKey: brand<string, 'IdempotencyKey'>('idem-delete-cascade-checkpoint') });
      await gateway.pendingInputs.createPendingInput({ tenantId: pendingInput.tenantId, subjectId: pendingInput.subjectId, record: pendingInput });
      await gateway.conversationAnnotations.saveAnnotation(
        {
          tenantId: session.tenantId,
          subjectId: session.subjectId,
          agentId: session.agentId,
          annotationId: 'annotation-delete-cascade',
          sessionId: session.sessionId,
          requestRunId: run.runId,
          sentiment: 'UP',
          isFavorited: true,
          createdAt: fakeNow(),
          updatedAt: fakeNow(),
        },
        { idempotencyKey: brand<string, 'IdempotencyKey'>('idem-delete-cascade-annotation') },
      );
      await gateway.conversationShares.createShare(
        {
          tenantId: session.tenantId,
          subjectId: session.subjectId,
          agentId: session.agentId,
          shareId: 'share-delete-cascade',
          sessionId: session.sessionId,
          runIds: [run.runId],
          originUrl: 'https://host',
          allowedOps: null,
          expiresAt: null,
          createdAt: fakeNow(),
        },
        { idempotencyKey: brand<string, 'IdempotencyKey'>('idem-delete-cascade-share') },
      );

      await expect(
        gateway.sessions.deleteSessionCascade({
          tenantId: session.tenantId,
          subjectId: session.subjectId,
          agentId: session.agentId,
          sessionId: session.sessionId,
        }),
      ).resolves.toEqual({ status: 'DELETED' });

      await expect(gateway.sessions.loadSession(session)).resolves.toBeUndefined();
      await expect(gateway.requestRuns.loadRun(run)).resolves.toBeUndefined();
      await expect(gateway.messages.loadMessage(message)).resolves.toBeUndefined();
      await expect(
        gateway.timeline.listEvents({
          tenantId: session.tenantId,
          subjectId: session.subjectId,
          agentId: session.agentId,
          sessionId: session.sessionId,
          afterSequence: brand<number, 'TimelineSequence'>(0),
          limit: 10,
        }),
      ).resolves.toEqual([]);
      await expect(
        gateway.checkpoints.loadCheckpoint({
          tenantId: session.tenantId,
          subjectId: session.subjectId,
          agentId: session.agentId,
          sessionId: session.sessionId,
          requestId: run.requestId,
          runId: run.runId,
        }),
      ).resolves.toBeUndefined();
      await expect(
        gateway.pendingInputs.loadPendingInput({
          tenantId: pendingInput.tenantId,
          subjectId: pendingInput.subjectId,
          agentId: pendingInput.agentId,
          pendingInputId: pendingInput.pendingInputId,
        }),
      ).resolves.toBeUndefined();
      await expect(
        gateway.pendingInputs.listUnresolvedPendingInputTimeoutFacts({
          agentId: pendingInput.agentId,
          limit: 10,
        }),
      ).resolves.toEqual([]);
      await expect(
        gateway.conversationAnnotations.listSessionAnnotations({
          tenantId: session.tenantId,
          subjectId: session.subjectId,
          agentId: session.agentId,
          sessionId: session.sessionId,
        }),
      ).resolves.toEqual([]);
      await expect(
        gateway.conversationAnnotations.listFavoriteTurns({
          tenantId: session.tenantId,
          subjectId: session.subjectId,
          agentId: session.agentId,
          offset: 0,
          limit: 10,
        }),
      ).resolves.toEqual([]);
      await expect(gateway.conversationShares.loadShare({ shareId: 'share-delete-cascade' })).resolves.toBeUndefined();
    });

    it('deleteSessionCascade does not cross owner or agent scope for the same session id', async () => {
      const sharedSessionId = brand<string, 'SessionId'>('session-delete-scope');
      const current = makeSession({ sessionId: sharedSessionId, agentId: brand<string, 'AgentId'>('agent-delete-current') });
      const otherAgent = makeSession({ sessionId: sharedSessionId, agentId: brand<string, 'AgentId'>('agent-delete-other') });
      const otherSubject = makeSession({
        sessionId: sharedSessionId,
        subjectId: brand<string, 'SubjectId'>('subject-delete-other'),
        agentId: current.agentId,
      });
      await gateway.sessions.saveSession(current, { idempotencyKey: brand<string, 'IdempotencyKey'>('idem-delete-current') });
      await gateway.sessions.saveSession(otherAgent, { idempotencyKey: brand<string, 'IdempotencyKey'>('idem-delete-other-agent') });
      await gateway.sessions.saveSession(otherSubject, { idempotencyKey: brand<string, 'IdempotencyKey'>('idem-delete-other-subject') });

      await expect(
        gateway.sessions.deleteSessionCascade({
          tenantId: current.tenantId,
          subjectId: current.subjectId,
          agentId: current.agentId,
          sessionId: current.sessionId,
        }),
      ).resolves.toEqual({ status: 'DELETED' });

      await expect(gateway.sessions.loadSession(current)).resolves.toBeUndefined();
      await expect(gateway.sessions.loadSession(otherAgent)).resolves.toMatchObject({ agentId: otherAgent.agentId });
      await expect(gateway.sessions.loadSession(otherSubject)).resolves.toMatchObject({ subjectId: otherSubject.subjectId });
    });

    it('deleteSessionCascade fails closed when a non-terminal run exists', async () => {
      const session = makeSession({ sessionId: brand<string, 'SessionId'>('session-delete-active') });
      const run = makeRun({
        sessionId: session.sessionId,
        runId: brand<string, 'RequestRunId'>('run-delete-active'),
        status: 'EXECUTING',
        terminalCommitState: 'NOT_STARTED',
      });
      const message = makeMessage({ sessionId: session.sessionId, runId: run.runId, requestId: run.requestId });
      await gateway.sessions.saveSession(session, { idempotencyKey: brand<string, 'IdempotencyKey'>('idem-delete-active-session') });
      await gateway.requestRuns.saveRun(run, {});
      await gateway.messages.appendSessionMessage(message, { idempotencyKey: brand<string, 'IdempotencyKey'>('idem-delete-active-message') });

      await expect(
        gateway.sessions.deleteSessionCascade({
          tenantId: session.tenantId,
          subjectId: session.subjectId,
          agentId: session.agentId,
          sessionId: session.sessionId,
        }),
      ).resolves.toEqual({ status: 'CONFLICT_ACTIVE_RUN' });

      await expect(gateway.sessions.loadSession(session)).resolves.toMatchObject({ sessionId: session.sessionId });
      await expect(gateway.requestRuns.loadRun(run)).resolves.toMatchObject({ runId: run.runId, status: 'EXECUTING' });
      await expect(gateway.messages.loadMessage(message)).resolves.toMatchObject({ messageId: message.messageId });
    });

    it('deleteSessionCascade rolls back when a later delete statement fails', async () => {
      const fixture = createTestGatewayStoresWithSqliteFile();
      const rollbackGateway = fixture.gateway;
      const db = new DatabaseSync(fixture.sqliteFile);
      db.exec(`
        CREATE TRIGGER fail_session_delete_request_runs
        BEFORE DELETE ON request_runs
        WHEN old.session_id = 'session-delete-rollback'
        BEGIN
          SELECT RAISE(FAIL, 'rollback delete');
        END;
      `);
      db.close();
      const session = makeSession({ sessionId: brand<string, 'SessionId'>('session-delete-rollback') });
      const run = makeRun({
        sessionId: session.sessionId,
        runId: brand<string, 'RequestRunId'>('run-delete-rollback'),
        status: 'COMPLETED',
        terminalCommitState: 'COMMITTED',
      });
      const message = makeMessage({
        sessionId: session.sessionId,
        messageId: brand<string, 'MessageId'>('msg-delete-rollback'),
        requestId: run.requestId,
        runId: run.runId,
      });

      await rollbackGateway.sessions.saveSession(session, { idempotencyKey: brand<string, 'IdempotencyKey'>('idem-delete-rollback-session') });
      await rollbackGateway.requestRuns.saveRun(run, {});
      await rollbackGateway.messages.appendSessionMessage(message, {
        idempotencyKey: brand<string, 'IdempotencyKey'>('idem-delete-rollback-message'),
      });
      await rollbackGateway.conversationAnnotations.saveAnnotation(
        {
          tenantId: session.tenantId,
          subjectId: session.subjectId,
          agentId: session.agentId,
          annotationId: 'annotation-delete-rollback',
          sessionId: session.sessionId,
          requestRunId: run.runId,
          sentiment: null,
          isFavorited: true,
          createdAt: fakeNow(),
          updatedAt: fakeNow(),
        },
        { idempotencyKey: brand<string, 'IdempotencyKey'>('idem-delete-rollback-annotation') },
      );

      await expect(
        rollbackGateway.sessions.deleteSessionCascade({
          tenantId: session.tenantId,
          subjectId: session.subjectId,
          agentId: session.agentId,
          sessionId: session.sessionId,
        }),
      ).rejects.toMatchObject({ code: 'LOCAL_STORE_UNAVAILABLE' });

      await expect(rollbackGateway.sessions.loadSession(session)).resolves.toMatchObject({ sessionId: session.sessionId });
      await expect(rollbackGateway.requestRuns.loadRun(run)).resolves.toMatchObject({ runId: run.runId });
      await expect(rollbackGateway.messages.loadMessage(message)).resolves.toMatchObject({ messageId: message.messageId });
      await expect(
        rollbackGateway.conversationAnnotations.listSessionAnnotations({
          tenantId: session.tenantId,
          subjectId: session.subjectId,
          agentId: session.agentId,
          sessionId: session.sessionId,
        }),
      ).resolves.toHaveLength(1);
    });

    it('listSessions hasMore is true when result exceeds limit', async () => {
      for (let i = 0; i < 3; i++) {
        await gateway.sessions.saveSession(makeSession({ sessionId: brand<string, 'SessionId'>(`session-ct-${i}`) }), {
          idempotencyKey: brand<string, 'IdempotencyKey'>(`idem-ls-${i}`),
        });
      }
      const result = await gateway.sessions.listSessions({
        tenantId: brand<string, 'TenantId'>('tenant-ct'),
        subjectId: brand<string, 'SubjectId'>('subject-ct'),
        agentId: brand<string, 'AgentId'>('agent-ct'),
        offset: 0,
        limit: 2,
      });
      expect(result.entries).toHaveLength(2);
      expect(result.hasMore).toBe(true);
    });

    it('listSessions searches titles and visible user messages without cross-scope or wildcard expansion', async () => {
      const agentId = brand<string, 'AgentId'>('agent-search');
      await gateway.sessions.saveSession(
        makeSession({
          agentId,
          sessionId: brand<string, 'SessionId'>('session-title-hit'),
          title: 'CPU_告警% triage',
          updatedAt: brand<number, 'EpochMillis'>(500),
        }),
        { idempotencyKey: brand<string, 'IdempotencyKey'>('idem-search-title') },
      );
      await gateway.sessions.saveSession(
        makeSession({
          agentId,
          sessionId: brand<string, 'SessionId'>('session-user-hit'),
          title: 'ordinary title',
          updatedAt: brand<number, 'EpochMillis'>(300),
        }),
        { idempotencyKey: brand<string, 'IdempotencyKey'>('idem-search-user') },
      );
      await gateway.messages.appendSessionMessage(
        makeMessage({
          agentId,
          sessionId: brand<string, 'SessionId'>('session-user-hit'),
          messageId: brand<string, 'MessageId'>('msg-search-user-a'),
          requestId: brand<string, 'MessageId'>('request-search-user-a'),
          content: 'literal CPU_告警% in user question',
          createdAt: brand<number, 'EpochMillis'>(300),
        }),
        { idempotencyKey: brand<string, 'IdempotencyKey'>('idem-search-user-a') },
      );
      await gateway.messages.appendSessionMessage(
        makeMessage({
          agentId,
          sessionId: brand<string, 'SessionId'>('session-user-hit'),
          messageId: brand<string, 'MessageId'>('msg-search-user-b'),
          requestId: brand<string, 'MessageId'>('request-search-user-b'),
          content: 'second CPU_告警% hit should not duplicate the session',
          createdAt: brand<number, 'EpochMillis'>(301),
        }),
        { idempotencyKey: brand<string, 'IdempotencyKey'>('idem-search-user-b') },
      );
      await gateway.sessions.saveSession(
        makeSession({
          agentId,
          sessionId: brand<string, 'SessionId'>('session-wildcard-miss'),
          title: 'CPUx告警y',
          updatedAt: brand<number, 'EpochMillis'>(450),
        }),
        { idempotencyKey: brand<string, 'IdempotencyKey'>('idem-search-wildcard') },
      );
      await gateway.sessions.saveSession(
        makeSession({
          agentId,
          sessionId: brand<string, 'SessionId'>('session-assistant-miss'),
          title: 'ordinary assistant title',
          updatedAt: brand<number, 'EpochMillis'>(400),
        }),
        { idempotencyKey: brand<string, 'IdempotencyKey'>('idem-search-assistant') },
      );
      await gateway.messages.appendSessionMessage(
        makeMessage({
          agentId,
          sessionId: brand<string, 'SessionId'>('session-assistant-miss'),
          messageId: brand<string, 'MessageId'>('msg-search-assistant'),
          requestId: brand<string, 'MessageId'>('request-search-assistant'),
          role: 'ASSISTANT',
          content: 'CPU_告警% in assistant answer',
          createdAt: brand<number, 'EpochMillis'>(400),
        }),
        { idempotencyKey: brand<string, 'IdempotencyKey'>('idem-search-assistant-msg') },
      );
      await gateway.sessions.saveSession(
        makeSession({
          agentId,
          sessionId: brand<string, 'SessionId'>('session-hidden-miss'),
          title: 'ordinary hidden title',
          updatedAt: brand<number, 'EpochMillis'>(350),
        }),
        { idempotencyKey: brand<string, 'IdempotencyKey'>('idem-search-hidden') },
      );
      await gateway.messages.appendSessionMessage(
        makeMessage({
          agentId,
          sessionId: brand<string, 'SessionId'>('session-hidden-miss'),
          messageId: brand<string, 'MessageId'>('msg-search-hidden'),
          requestId: brand<string, 'MessageId'>('request-search-hidden'),
          content: 'CPU_告警% hidden user question',
          visible: false,
          createdAt: brand<number, 'EpochMillis'>(350),
        }),
        { idempotencyKey: brand<string, 'IdempotencyKey'>('idem-search-hidden-msg') },
      );
      await gateway.sessions.saveSession(
        makeSession({
          agentId: brand<string, 'AgentId'>('agent-other-search'),
          sessionId: brand<string, 'SessionId'>('session-other-agent'),
          title: 'CPU_告警% other agent',
          updatedAt: brand<number, 'EpochMillis'>(600),
        }),
        { idempotencyKey: brand<string, 'IdempotencyKey'>('idem-search-other-agent') },
      );

      const result = await gateway.sessions.listSessions({
        tenantId: brand<string, 'TenantId'>('tenant-ct'),
        subjectId: brand<string, 'SubjectId'>('subject-ct'),
        agentId,
        offset: 0,
        limit: 10,
        questionSearchText: 'cpu_告警%',
      });

      expect(result.entries.map((entry) => entry.sessionId)).toEqual(['session-title-hit', 'session-user-hit']);
      expect(result.hasMore).toBe(false);
    });

    it('listSessions filters by last activity time and paginates deduped search sessions', async () => {
      const agentId = brand<string, 'AgentId'>('agent-created-search');
      const sessionTimes: ReadonlyArray<[number, number]> = [
        [100, 90],
        [200, 200],
        [150, 300],
      ];
      for (const [index, [createdAt, updatedAt]] of sessionTimes.entries()) {
        const sessionId = brand<string, 'SessionId'>(`session-created-${index}`);
        await gateway.sessions.saveSession(
          makeSession({
            agentId,
            sessionId,
            title: `告警 session ${index}`,
            createdAt: brand<number, 'EpochMillis'>(createdAt),
            updatedAt: brand<number, 'EpochMillis'>(updatedAt),
          }),
          { idempotencyKey: brand<string, 'IdempotencyKey'>(`idem-created-${index}`) },
        );
        await gateway.messages.appendSessionMessage(
          makeMessage({
            agentId,
            sessionId,
            messageId: brand<string, 'MessageId'>(`msg-created-${index}`),
            requestId: brand<string, 'MessageId'>(`request-created-${index}`),
            content: '告警 告警',
            createdAt: brand<number, 'EpochMillis'>(updatedAt),
          }),
          { idempotencyKey: brand<string, 'IdempotencyKey'>(`idem-created-msg-${index}`) },
        );
      }

      const range = await gateway.sessions.listSessions({
        tenantId: brand<string, 'TenantId'>('tenant-ct'),
        subjectId: brand<string, 'SubjectId'>('subject-ct'),
        agentId,
        offset: 0,
        limit: 10,
        createdAtFrom: brand<number, 'EpochMillis'>(150),
        createdAtTo: brand<number, 'EpochMillis'>(250),
      });
      expect(range.entries.map((entry) => entry.sessionId)).toEqual(['session-created-1']);

      const firstPage = await gateway.sessions.listSessions({
        tenantId: brand<string, 'TenantId'>('tenant-ct'),
        subjectId: brand<string, 'SubjectId'>('subject-ct'),
        agentId,
        offset: 0,
        limit: 1,
        questionSearchText: '告警',
      });
      const secondPage = await gateway.sessions.listSessions({
        tenantId: brand<string, 'TenantId'>('tenant-ct'),
        subjectId: brand<string, 'SubjectId'>('subject-ct'),
        agentId,
        offset: 1,
        limit: 1,
        questionSearchText: '告警',
      });
      expect(firstPage.entries).toHaveLength(1);
      expect(firstPage.hasMore).toBe(true);
      expect(secondPage.entries).toHaveLength(1);
      expect(secondPage.entries[0]?.sessionId).not.toBe(firstPage.entries[0]?.sessionId);
    });

    it('saveSession does not create duplicate session with same idempotencyKey', async () => {
      const first = await gateway.sessions.saveSession(makeSession(), { idempotencyKey: brand<string, 'IdempotencyKey'>('idem-dup') });
      const second = await gateway.sessions.saveSession(makeSession({ title: 'updated' }), {
        idempotencyKey: brand<string, 'IdempotencyKey'>('idem-dup'),
      });
      expect(second.sessionId).toBe(first.sessionId);
      // Note: upsert updates in place; title may differ on re-save of existing session
    });
  });

  // ── SessionMessageStoreGateway ──

  describe('SessionMessageStoreGateway', () => {
    it('appendSessionMessage is idempotent with same idempotencyKey', async () => {
      const msg = makeMessage();
      const first = await gateway.messages.appendSessionMessage(msg, { idempotencyKey: brand<string, 'IdempotencyKey'>('idem-msg') });
      const second = await gateway.messages.appendSessionMessage(
        { ...msg, content: 'should be ignored' },
        { idempotencyKey: brand<string, 'IdempotencyKey'>('idem-msg') },
      );
      expect(second.messageId).toBe(first.messageId);
      expect(second.content).toBe(first.content);
    });

    it('loadMessage scope isolation', async () => {
      const msg = makeMessage();
      await gateway.messages.appendSessionMessage(msg, { idempotencyKey: brand<string, 'IdempotencyKey'>('idem-lm') });

      const result = await gateway.messages.loadMessage({
        tenantId: brand<string, 'TenantId'>('tenant-other'),
        subjectId: msg.subjectId,
        agentId: msg.agentId,
        messageId: msg.messageId,
      });
      expect(result).toBeUndefined();
    });

    it('listMessages excludes hidden by default', async () => {
      const msg = makeMessage();
      await gateway.messages.appendSessionMessage(msg, { idempotencyKey: brand<string, 'IdempotencyKey'>('idem-v1') });
      await gateway.messages.hideMessage({
        tenantId: msg.tenantId,
        subjectId: msg.subjectId,
        agentId: msg.agentId,
        messageId: msg.messageId,
        reason: 'RETRY_REPLACED',
        hiddenByContextId: brand<string, 'RequestContextId'>('ctx-hide'),
        idempotencyKey: brand<string, 'IdempotencyKey'>('idem-hide1'),
      });

      const result = await gateway.messages.listMessages({
        tenantId: msg.tenantId,
        subjectId: msg.subjectId,
        agentId: msg.agentId,
        sessionId: msg.sessionId,
        includeHidden: false,
        includeCapabilityResults: true,
        limit: 10,
      });
      expect(result.items).toHaveLength(0);
    });

    it('listConversationPreview returns paged visible user markers with total count', async () => {
      const sessionId = brand<string, 'SessionId'>('session-preview');
      await gateway.messages.appendSessionMessage(
        makeMessage({
          sessionId,
          messageId: brand<string, 'MessageId'>('msg-preview-user'),
          requestId: brand<string, 'MessageId'>('request-preview-user'),
          content: '😀'.repeat(301),
          createdAt: brand<number, 'EpochMillis'>(1),
        }),
        { idempotencyKey: brand<string, 'IdempotencyKey'>('idem-preview-user') },
      );
      await gateway.messages.appendSessionMessage(
        makeMessage({
          sessionId,
          messageId: brand<string, 'MessageId'>('msg-preview-older-assistant'),
          requestId: brand<string, 'MessageId'>('request-preview-user'),
          role: 'ASSISTANT',
          content: 'older assistant should not appear',
          createdAt: brand<number, 'EpochMillis'>(0),
        }),
        { idempotencyKey: brand<string, 'IdempotencyKey'>('idem-preview-older-assistant') },
      );
      await gateway.messages.appendSessionMessage(
        makeMessage({
          sessionId,
          messageId: brand<string, 'MessageId'>('msg-preview-assistant'),
          requestId: brand<string, 'MessageId'>('request-preview-user'),
          role: 'ASSISTANT',
          content: 'A'.repeat(301),
          createdAt: brand<number, 'EpochMillis'>(2),
        }),
        { idempotencyKey: brand<string, 'IdempotencyKey'>('idem-preview-assistant') },
      );
      await gateway.messages.appendSessionMessage(
        makeMessage({
          sessionId,
          messageId: brand<string, 'MessageId'>('msg-preview-capability-result'),
          requestId: brand<string, 'MessageId'>('request-preview-user'),
          role: 'CAPABILITY_RESULT',
          content: 'capability result should not appear',
          createdAt: brand<number, 'EpochMillis'>(3),
        }),
        { idempotencyKey: brand<string, 'IdempotencyKey'>('idem-preview-capability-result') },
      );
      await gateway.messages.appendSessionMessage(
        makeMessage({
          sessionId,
          messageId: brand<string, 'MessageId'>('msg-preview-hidden-assistant'),
          requestId: brand<string, 'MessageId'>('request-preview-user'),
          role: 'ASSISTANT',
          content: 'hidden assistant should not appear',
          visible: false,
          createdAt: brand<number, 'EpochMillis'>(4),
        }),
        { idempotencyKey: brand<string, 'IdempotencyKey'>('idem-preview-hidden-assistant') },
      );
      await gateway.messages.appendSessionMessage(
        makeMessage({
          sessionId,
          messageId: brand<string, 'MessageId'>('msg-preview-hidden'),
          requestId: brand<string, 'MessageId'>('request-preview-hidden'),
          content: 'hidden should not appear',
          visible: false,
          createdAt: brand<number, 'EpochMillis'>(5),
        }),
        { idempotencyKey: brand<string, 'IdempotencyKey'>('idem-preview-hidden') },
      );
      const preview = await gateway.messages.listConversationPreview({
        tenantId: brand<string, 'TenantId'>('tenant-ct'),
        subjectId: brand<string, 'SubjectId'>('subject-ct'),
        agentId: brand<string, 'AgentId'>('agent-ct'),
        sessionId,
        offset: 0,
        limit: 100,
      });
      expect(preview.totalMarkers).toBe(1);
      expect(preview.offset).toBe(0);
      expect(preview.limit).toBe(100);
      expect(preview.markers).toHaveLength(1);
      expect(preview.markers[0]?.messageId).toBe('msg-preview-user');
      expect(Array.from(preview.markers[0]?.previewText ?? '')).toHaveLength(300);
      expect(preview.markers[0]?.previewTruncated).toBe(true);
      expect(Array.from(preview.markers[0]?.answerPreviewText ?? '')).toHaveLength(300);
      expect(preview.markers[0]?.answerPreviewTruncated).toBe(true);

      const pagedSessionId = brand<string, 'SessionId'>('session-preview-paged');
      for (let i = 0; i < 101; i++) {
        await gateway.messages.appendSessionMessage(
          makeMessage({
            sessionId: pagedSessionId,
            messageId: brand<string, 'MessageId'>(`msg-preview-paged-${i}`),
            requestId: brand<string, 'MessageId'>(`request-preview-paged-${i}`),
            content: `question ${i}`,
            createdAt: brand<number, 'EpochMillis'>(i),
          }),
          { idempotencyKey: brand<string, 'IdempotencyKey'>(`idem-preview-paged-${i}`) },
        );
      }
      const paged = await gateway.messages.listConversationPreview({
        tenantId: brand<string, 'TenantId'>('tenant-ct'),
        subjectId: brand<string, 'SubjectId'>('subject-ct'),
        agentId: brand<string, 'AgentId'>('agent-ct'),
        sessionId: pagedSessionId,
        offset: 100,
        limit: 100,
      });
      expect(paged.totalMarkers).toBe(101);
      expect(paged.offset).toBe(100);
      expect(paged.limit).toBe(100);
      expect(paged.markers).toHaveLength(1);
      expect(paged.markers[0]?.messageId).toBe('msg-preview-paged-100');

      const latest = await gateway.messages.listConversationPreview({
        tenantId: brand<string, 'TenantId'>('tenant-ct'),
        subjectId: brand<string, 'SubjectId'>('subject-ct'),
        agentId: brand<string, 'AgentId'>('agent-ct'),
        sessionId: pagedSessionId,
        limit: 100,
      });
      expect(latest.totalMarkers).toBe(101);
      expect(latest.offset).toBe(1);
      expect(latest.limit).toBe(100);
      expect(latest.markers).toHaveLength(100);
      expect(latest.markers[0]?.messageId).toBe('msg-preview-paged-1');
      expect(latest.markers[99]?.messageId).toBe('msg-preview-paged-100');

      const beyondEnd = await gateway.messages.listConversationPreview({
        tenantId: brand<string, 'TenantId'>('tenant-ct'),
        subjectId: brand<string, 'SubjectId'>('subject-ct'),
        agentId: brand<string, 'AgentId'>('agent-ct'),
        sessionId: pagedSessionId,
        offset: 200,
        limit: 100,
      });
      expect(beyondEnd).toMatchObject({ totalMarkers: 101, offset: 200, limit: 100, markers: [] });

      await expect(
        gateway.messages.listConversationPreview({
          tenantId: brand<string, 'TenantId'>('tenant-ct'),
          subjectId: brand<string, 'SubjectId'>('subject-ct'),
          agentId: brand<string, 'AgentId'>('agent-ct'),
          sessionId: pagedSessionId,
          offset: 0,
          limit: 501,
        }),
      ).rejects.toMatchObject({ code: 'REQUEST_VALIDATION_FAILED' });
    });

    it('listMessages supports recent older newer and anchored windows without falling back on hidden anchors', async () => {
      const sessionId = brand<string, 'SessionId'>('session-window');
      for (let i = 1; i <= 6; i++) {
        await gateway.messages.appendSessionMessage(
          makeMessage({
            sessionId,
            messageId: brand<string, 'MessageId'>(`msg-window-${i}`),
            requestId: brand<string, 'MessageId'>(`request-window-${i}`),
            content: `message ${i}`,
            createdAt: brand<number, 'EpochMillis'>(i),
          }),
          { idempotencyKey: brand<string, 'IdempotencyKey'>(`idem-window-${i}`) },
        );
      }
      await gateway.messages.appendSessionMessage(
        makeMessage({
          sessionId,
          messageId: brand<string, 'MessageId'>('msg-window-hidden'),
          requestId: brand<string, 'MessageId'>('request-window-hidden'),
          content: 'hidden anchor',
          visible: false,
          createdAt: brand<number, 'EpochMillis'>(7),
        }),
        { idempotencyKey: brand<string, 'IdempotencyKey'>('idem-window-hidden') },
      );
      const base = {
        tenantId: brand<string, 'TenantId'>('tenant-ct'),
        subjectId: brand<string, 'SubjectId'>('subject-ct'),
        agentId: brand<string, 'AgentId'>('agent-ct'),
        sessionId,
        includeHidden: false,
        includeCapabilityResults: false,
      };

      const recent = await gateway.messages.listMessages({ ...base, limit: 3 });
      expect(recent.items.map((message) => message.messageId)).toEqual(['msg-window-4', 'msg-window-5', 'msg-window-6']);
      expect(recent.nextBeforeCursor).toBe('msg-window-4');
      expect(recent.hasMore).toBe(true);

      const older = await gateway.messages.listMessages({ ...base, beforeCursor: 'msg-window-4', limit: 2 });
      expect(older.items.map((message) => message.messageId)).toEqual(['msg-window-2', 'msg-window-3']);
      expect(older.nextBeforeCursor).toBe('msg-window-2');
      expect(older.hasMore).toBe(true);

      const newer = await gateway.messages.listMessages({ ...base, afterCursor: 'msg-window-3', limit: 2 });
      expect(newer.items.map((message) => message.messageId)).toEqual(['msg-window-4', 'msg-window-5']);
      expect(newer.newerCursor).toBe('msg-window-5');
      expect(newer.hasMore).toBe(false);

      const anchored = await gateway.messages.listMessages({ ...base, anchorMessageId: brand<string, 'MessageId'>('msg-window-3'), limit: 3 });
      expect(anchored.items.map((message) => message.messageId)).toEqual(['msg-window-2', 'msg-window-3', 'msg-window-4']);
      expect(anchored.nextBeforeCursor).toBe('msg-window-2');
      expect(anchored.newerCursor).toBe('msg-window-4');

      await expect(
        gateway.messages.listMessages({
          ...base,
          anchorMessageId: brand<string, 'MessageId'>('msg-window-hidden'),
          limit: 3,
        }),
      ).rejects.toMatchObject({ code: 'SESSION_MESSAGE_ANCHOR_NOT_FOUND' });
    });

    it('loadMessage still returns hidden message', async () => {
      const msg = makeMessage();
      await gateway.messages.appendSessionMessage(msg, { idempotencyKey: brand<string, 'IdempotencyKey'>('idem-loadhidden') });
      await gateway.messages.hideMessage({
        tenantId: msg.tenantId,
        subjectId: msg.subjectId,
        agentId: msg.agentId,
        messageId: msg.messageId,
        reason: 'RETRY_REPLACED',
        hiddenByContextId: brand<string, 'RequestContextId'>('ctx-loadhidden'),
        idempotencyKey: brand<string, 'IdempotencyKey'>('idem-loadhidden-h'),
      });
      const loaded = await gateway.messages.loadMessage({
        tenantId: msg.tenantId,
        subjectId: msg.subjectId,
        agentId: msg.agentId,
        messageId: msg.messageId,
      });
      expect(loaded).toBeDefined();
      expect(loaded?.visible).toBe(false);
    });

    it('listCurrentRequestMessages isolates by run', async () => {
      const sessionId = brand<string, 'SessionId'>('session-run-iso');
      const requestId1 = brand<string, 'MessageId'>('request-1');
      const runId1 = brand<string, 'RequestRunId'>('run-1');
      const requestId2 = brand<string, 'MessageId'>('request-2');
      const runId2 = brand<string, 'RequestRunId'>('run-2');

      await gateway.messages.appendSessionMessage(
        makeMessage({ sessionId, requestId: requestId1, runId: runId1, messageId: brand<string, 'MessageId'>('msg-r1') }),
        { idempotencyKey: brand<string, 'IdempotencyKey'>('idem-r1') },
      );
      await gateway.messages.appendSessionMessage(
        makeMessage({ sessionId, requestId: requestId2, runId: runId2, messageId: brand<string, 'MessageId'>('msg-r2') }),
        { idempotencyKey: brand<string, 'IdempotencyKey'>('idem-r2') },
      );

      const result = await gateway.messages.listCurrentRequestMessages({
        tenantId: brand<string, 'TenantId'>('tenant-ct'),
        subjectId: brand<string, 'SubjectId'>('subject-ct'),
        agentId: brand<string, 'AgentId'>('agent-ct'),
        sessionId,
        requestId: requestId1,
        runId: runId1,
        includeHidden: false,
        offset: 0,
        limit: 10,
      });
      expect(result.items).toHaveLength(1);
      expect(result.items[0]?.messageId).toBe('msg-r1');
    });

    // ── hideMessage ──

    it('hideMessage sets visible=false and returns updated record', async () => {
      const msg = makeMessage();
      await gateway.messages.appendSessionMessage(msg, { idempotencyKey: brand<string, 'IdempotencyKey'>('idem-hide-ok') });

      const result = await gateway.messages.hideMessage({
        tenantId: msg.tenantId,
        subjectId: msg.subjectId,
        agentId: msg.agentId,
        messageId: msg.messageId,
        reason: 'EDIT_REPLACED',
        hiddenByContextId: brand<string, 'RequestContextId'>('ctx-edit'),
        idempotencyKey: brand<string, 'IdempotencyKey'>('idem-hide-ok'),
      });
      expect(result).toBeDefined();
      expect(result?.visible).toBe(false);
    });

    it('hideMessage is idempotent �?re-hide returns already hidden record', async () => {
      const msg = makeMessage();
      await gateway.messages.appendSessionMessage(msg, { idempotencyKey: brand<string, 'IdempotencyKey'>('idem-hide-dup') });
      await gateway.messages.hideMessage({
        tenantId: msg.tenantId,
        subjectId: msg.subjectId,
        agentId: msg.agentId,
        messageId: msg.messageId,
        reason: 'RETRY_REPLACED',
        hiddenByContextId: brand<string, 'RequestContextId'>('ctx-dup'),
        idempotencyKey: brand<string, 'IdempotencyKey'>('idem-hide-dup-a'),
      });
      const second = await gateway.messages.hideMessage({
        tenantId: msg.tenantId,
        subjectId: msg.subjectId,
        agentId: msg.agentId,
        messageId: msg.messageId,
        reason: 'EDIT_REPLACED',
        hiddenByContextId: brand<string, 'RequestContextId'>('ctx-dup2'),
        idempotencyKey: brand<string, 'IdempotencyKey'>('idem-hide-dup-b'),
      });
      expect(second).toBeDefined();
      expect(second?.visible).toBe(false);
    });

    it('hideMessage returns undefined for non-existent message', async () => {
      const result = await gateway.messages.hideMessage({
        tenantId: brand<string, 'TenantId'>('tenant-ct'),
        subjectId: brand<string, 'SubjectId'>('subject-ct'),
        agentId: brand<string, 'AgentId'>('agent-ct'),
        messageId: brand<string, 'MessageId'>('non-existent'),
        reason: 'RETRY_REPLACED',
        hiddenByContextId: brand<string, 'RequestContextId'>('ctx-nx'),
        idempotencyKey: brand<string, 'IdempotencyKey'>('idem-nx'),
      });
      expect(result).toBeUndefined();
    });

    it('hideMessage returns undefined for mismatched scope', async () => {
      const msg = makeMessage();
      await gateway.messages.appendSessionMessage(msg, { idempotencyKey: brand<string, 'IdempotencyKey'>('idem-hide-scope') });

      const result = await gateway.messages.hideMessage({
        tenantId: brand<string, 'TenantId'>('tenant-other'),
        subjectId: msg.subjectId,
        agentId: msg.agentId,
        messageId: msg.messageId,
        reason: 'RETRY_REPLACED',
        hiddenByContextId: brand<string, 'RequestContextId'>('ctx-sc'),
        idempotencyKey: brand<string, 'IdempotencyKey'>('idem-hide-scope'),
      });
      expect(result).toBeUndefined();
    });
  });

  // ── RequestRunStoreGateway ──

  describe('RequestRunStoreGateway', () => {
    it('saveRun creates run with expectedVersion undefined and updates with CAS', async () => {
      await gateway.requestRuns.saveRun(makeRun({ runId: brand<string, 'RequestRunId'>('run-cas'), version: 1 }), {});
      const updated = await gateway.requestRuns.saveRun(
        makeRun({ runId: brand<string, 'RequestRunId'>('run-cas'), status: 'COMPLETED', version: 2 }),
        { expectedVersion: 1 },
      );
      expect(updated.status).toBe('UPDATED');
      expect(updated.record?.version).toBe(2);
    });

    it('saveRun returns VERSION_CONFLICT when version mismatches', async () => {
      await gateway.requestRuns.saveRun(makeRun({ runId: brand<string, 'RequestRunId'>('run-conflict'), version: 1 }), {});
      const result = await gateway.requestRuns.saveRun(makeRun({ runId: brand<string, 'RequestRunId'>('run-conflict'), status: 'COMPLETED' }), {
        expectedVersion: 99,
      });
      expect(result.status).toBe('VERSION_CONFLICT');
    });

    it('loadRun scope isolation', async () => {
      const run = makeRun({ runId: brand<string, 'RequestRunId'>('run-load-scope') });
      await gateway.requestRuns.saveRun(run, {});

      const result = await gateway.requestRuns.loadRun({
        tenantId: brand<string, 'TenantId'>('tenant-other'),
        subjectId: run.subjectId,
        agentId: brand<string, 'AgentId'>('agent-ct'),
        runId: run.runId,
      });
      expect(result).toBeUndefined();
    });

    it('claimRun: UPDATED on version match', async () => {
      const run = makeRun({ runId: brand<string, 'RequestRunId'>('run-claim-ok'), terminalCommitState: 'NOT_STARTED' });
      await gateway.requestRuns.saveRun(run, {});

      const result = await gateway.requestRuns.claimRun({
        tenantId: run.tenantId,
        subjectId: run.subjectId,
        agentId: brand<string, 'AgentId'>('agent-ct'),
        runId: run.runId,
        expectedVersion: 1,
        lockedBy: 'executor-1',
        lockExpiresAt: brand<number, 'EpochMillis'>(Date.now() + 60000),
      });
      expect(result.status).toBe('UPDATED');
      expect(result.record?.version).toBe(2);
    });

    it('claimRun: VERSION_CONFLICT when version mismatches', async () => {
      const run = makeRun({ runId: brand<string, 'RequestRunId'>('run-claim-conflict') });
      await gateway.requestRuns.saveRun(run, {});

      const result = await gateway.requestRuns.claimRun({
        tenantId: run.tenantId,
        subjectId: run.subjectId,
        agentId: brand<string, 'AgentId'>('agent-ct'),
        runId: run.runId,
        expectedVersion: 99,
        lockedBy: 'executor-1',
        lockExpiresAt: brand<number, 'EpochMillis'>(Date.now() + 60000),
      });
      expect(result.status).toBe('VERSION_CONFLICT');
    });

    it('claimRun: NOT_FOUND for non-existent run', async () => {
      const result = await gateway.requestRuns.claimRun({
        tenantId: brand<string, 'TenantId'>('tenant-ct'),
        subjectId: brand<string, 'SubjectId'>('subject-ct'),
        agentId: brand<string, 'AgentId'>('agent-ct'),
        runId: brand<string, 'RequestRunId'>('run-ghost'),
        expectedVersion: 1,
        lockedBy: 'executor-1',
        lockExpiresAt: brand<number, 'EpochMillis'>(Date.now() + 60000),
      });
      expect(result.status).toBe('NOT_FOUND');
    });

    it('listRecoverableRuns returns unfinished runs', async () => {
      await gateway.requestRuns.saveRun(
        makeRun({ runId: brand<string, 'RequestRunId'>('run-recover'), status: 'EXECUTING', terminalCommitState: 'PENDING' }),
        {},
      );
      await gateway.requestRuns.saveRun(
        makeRun({ runId: brand<string, 'RequestRunId'>('run-done'), status: 'COMPLETED', terminalCommitState: 'COMMITTED' }),
        {},
      );

      const result = await gateway.requestRuns.listRecoverableRuns({
        agentId: brand<string, 'AgentId'>('agent-ct'),
        now: fakeNow(),
        limit: 10,
      });
      expect(result.length).toBeGreaterThanOrEqual(1);
      const ids = result.map((r) => r.runId);
      expect(ids).toContain('run-recover');
      expect(ids).not.toContain('run-done');
    });

    it('maps recovery leases to typed request_run columns and creates the recovery index', async () => {
      const fixture = createTestGatewayStoresWithSqliteFile();
      const run = makeRun({ runId: brand<string, 'RequestRunId'>('run-recovery-row-mapping') });
      await fixture.gateway.requestRuns.saveRun(run, {});
      await fixture.gateway.requestRuns.claimRun({
        tenantId: run.tenantId,
        subjectId: run.subjectId,
        agentId: run.agentId,
        runId: run.runId,
        expectedVersion: run.version,
        lockedBy: 'runtime-instance-a',
        lockExpiresAt: brand<number, 'EpochMillis'>(1234),
      });

      const db = new DatabaseSync(fixture.sqliteFile);
      const columns = db.prepare('PRAGMA table_info(request_runs)').all() as unknown as Array<{ name: string }>;
      const indexes = db.prepare('PRAGMA index_list(request_runs)').all() as unknown as Array<{ name: string }>;
      const row = db.prepare('SELECT locked_by, lock_expires_at, json FROM request_runs WHERE run_id = ?').get(run.runId) as {
        locked_by: string;
        lock_expires_at: number;
        json: string;
      };
      db.close();

      expect(columns.map((column) => column.name)).toEqual(expect.arrayContaining(['locked_by', 'lock_expires_at']));
      expect(indexes.map((index) => index.name)).toContain('idx_request_runs_recovery');
      expect(row).toMatchObject({ locked_by: 'runtime-instance-a', lock_expires_at: 1234 });
      expect(JSON.parse(row.json)).toMatchObject({ lockedBy: 'runtime-instance-a', lockExpiresAt: 1234 });
    });

    it('scopes recovery discovery by agent while aggregating owners and filtering leases', async () => {
      const selectedAgentId = brand<string, 'AgentId'>('agent-recovery-selected');
      const otherAgentId = brand<string, 'AgentId'>('agent-recovery-other');
      const records = [
        makeRun({
          tenantId: brand<string, 'TenantId'>('tenant-a'),
          subjectId: brand<string, 'SubjectId'>('subject-a'),
          agentId: selectedAgentId,
          runId: brand<string, 'RequestRunId'>('run-recovery-first'),
          createdAt: brand<number, 'EpochMillis'>(1),
          updatedAt: brand<number, 'EpochMillis'>(1),
        }),
        makeRun({
          tenantId: brand<string, 'TenantId'>('tenant-b'),
          subjectId: brand<string, 'SubjectId'>('subject-b'),
          agentId: selectedAgentId,
          runId: brand<string, 'RequestRunId'>('run-recovery-second'),
          createdAt: brand<number, 'EpochMillis'>(2),
          updatedAt: brand<number, 'EpochMillis'>(2),
          lockedBy: 'expired-holder',
          lockExpiresAt: brand<number, 'EpochMillis'>(99),
        }),
        makeRun({
          agentId: selectedAgentId,
          runId: brand<string, 'RequestRunId'>('run-recovery-active-lease'),
          createdAt: brand<number, 'EpochMillis'>(3),
          updatedAt: brand<number, 'EpochMillis'>(3),
          lockedBy: 'active-holder',
          lockExpiresAt: brand<number, 'EpochMillis'>(101),
        }),
        makeRun({
          agentId: otherAgentId,
          runId: brand<string, 'RequestRunId'>('run-recovery-other-agent'),
          createdAt: brand<number, 'EpochMillis'>(0),
          updatedAt: brand<number, 'EpochMillis'>(0),
        }),
      ];
      for (const record of records) {
        await gateway.requestRuns.saveRun(record, {});
      }

      const result = await gateway.requestRuns.listRecoverableRuns({
        agentId: selectedAgentId,
        now: brand<number, 'EpochMillis'>(100),
        limit: 2,
      });

      expect(result.map((record) => record.runId)).toEqual(['run-recovery-first', 'run-recovery-second']);
      expect(result.map((record) => [record.tenantId, record.subjectId])).toEqual([
        ['tenant-a', 'subject-a'],
        ['tenant-b', 'subject-b'],
      ]);
      expect(result.every((record) => record.agentId === selectedAgentId)).toBe(true);
    });

    it('rejects request run claims with mismatched tenant, subject, or agent scope', async () => {
      const run = makeRun({ runId: brand<string, 'RequestRunId'>('run-claim-scope') });
      await gateway.requestRuns.saveRun(run, {});

      const mismatchedScopes = [
        { tenantId: brand<string, 'TenantId'>('tenant-other'), subjectId: run.subjectId, agentId: run.agentId },
        { tenantId: run.tenantId, subjectId: brand<string, 'SubjectId'>('subject-other'), agentId: run.agentId },
        { tenantId: run.tenantId, subjectId: run.subjectId, agentId: brand<string, 'AgentId'>('agent-other') },
      ];
      for (const scope of mismatchedScopes) {
        await expect(
          gateway.requestRuns.claimRun({
            ...scope,
            runId: run.runId,
            expectedVersion: run.version,
            lockedBy: 'wrong-scope',
            lockExpiresAt: brand<number, 'EpochMillis'>(500),
          }),
        ).resolves.toMatchObject({ status: 'NOT_FOUND' });
      }

      const persisted = await gateway.requestRuns.loadRun({
        tenantId: run.tenantId,
        subjectId: run.subjectId,
        agentId: run.agentId,
        runId: run.runId,
      });
      expect(persisted).toMatchObject({ version: run.version });
      expect(persisted?.lockedBy).toBeUndefined();
      expect(persisted?.lockExpiresAt).toBeUndefined();
    });

    it('commitTerminal: COMMITTED on first call', async () => {
      const run = makeRun({ runId: brand<string, 'RequestRunId'>('run-term-ok') });
      await gateway.requestRuns.saveRun(run, {});

      const result = await gateway.requestRuns.commitTerminal({
        tenantId: run.tenantId,
        subjectId: run.subjectId,
        agentId: brand<string, 'AgentId'>('agent-ct'),
        runId: run.runId,
        expectedVersion: 1,
        terminalStatus: 'COMPLETED',
        terminalEvent: makeTimelineEvent({ eventId: 'event-term-ok', runId: run.runId }),
        terminalMessage: makeMessage({ messageId: brand<string, 'MessageId'>('msg-term') }),
        idempotencyKey: brand<string, 'IdempotencyKey'>('idem-term-ok'),
      });
      expect(result.status).toBe('COMMITTED');
    });

    it('commitTerminal: ALREADY_COMMITTED on repeat idempotencyKey', async () => {
      const run = makeRun({ runId: brand<string, 'RequestRunId'>('run-term-dup') });
      await gateway.requestRuns.saveRun(run, {});

      await gateway.requestRuns.commitTerminal({
        tenantId: run.tenantId,
        subjectId: run.subjectId,
        agentId: brand<string, 'AgentId'>('agent-ct'),
        runId: run.runId,
        expectedVersion: 1,
        terminalStatus: 'COMPLETED',
        terminalEvent: makeTimelineEvent({ eventId: 'event-term-dup', runId: run.runId }),
        terminalMessage: makeMessage({ messageId: brand<string, 'MessageId'>('msg-term-dup') }),
        idempotencyKey: brand<string, 'IdempotencyKey'>('idem-term-dup'),
      });
      const second = await gateway.requestRuns.commitTerminal({
        tenantId: run.tenantId,
        subjectId: run.subjectId,
        agentId: brand<string, 'AgentId'>('agent-ct'),
        runId: run.runId,
        expectedVersion: 1,
        terminalStatus: 'COMPLETED',
        terminalEvent: makeTimelineEvent({ eventId: 'event-term-dup2', runId: run.runId }),
        terminalMessage: makeMessage({ messageId: brand<string, 'MessageId'>('msg-term-dup2') }),
        idempotencyKey: brand<string, 'IdempotencyKey'>('idem-term-dup'),
      });
      expect(second.status).toBe('ALREADY_COMMITTED');
    });
  });

  // ── RunTimelineEventStoreGateway ──

  describe('RunTimelineEventStoreGateway', () => {
    it('preserves a completed thinking payload after the SQLite gateway reopens', async () => {
      const directory = mkdtempSync(join(tmpdir(), 'nextagent-thinking-reopen-'));
      const sqliteFile = join(directory, 'timeline.sqlite');
      const first = createSqliteGatewayStores({ sqliteFile });
      let firstClosed = false;
      try {
        await first.timeline.appendEvent(
          makeTimelineEvent({
            eventId: 'event-thinking-final',
            type: 'LLM_THINKING_DELTA',
            inlinePayload: { reasoning: 'checking routes', stepId: 'model:1', completed: true },
          }),
          { idempotencyKey: brand<string, 'IdempotencyKey'>('idem-thinking-final') },
        );
        first.close?.();
        firstClosed = true;

        const reopened = createSqliteGatewayStores({ sqliteFile });
        try {
          const events = await reopened.timeline.listEvents({
            tenantId: brand<string, 'TenantId'>('tenant-ct'),
            subjectId: brand<string, 'SubjectId'>('subject-ct'),
            agentId: brand<string, 'AgentId'>('agent-ct'),
            sessionId: brand<string, 'SessionId'>('session-ct'),
            runId: brand<string, 'RequestRunId'>('run-ct'),
            afterSequence: brand<number, 'TimelineSequence'>(0),
            limit: 10,
          });

          expect(events).toHaveLength(1);
          expect(events[0]?.inlinePayload).toEqual({
            reasoning: 'checking routes',
            stepId: 'model:1',
            completed: true,
          });
        } finally {
          reopened.close?.();
        }
      } finally {
        if (!firstClosed) {
          first.close?.();
        }
        rmSync(directory, { recursive: true, force: true });
      }
    });

    it('appendEvent is idempotent with same idempotencyKey', async () => {
      const first = await gateway.timeline.appendEvent(makeTimelineEvent({ eventId: 'event-idem-a' }), {
        idempotencyKey: brand<string, 'IdempotencyKey'>('idem-te-dup'),
      });
      const second = await gateway.timeline.appendEvent(makeTimelineEvent({ eventId: 'event-idem-b', inlinePayload: { content: 'different' } }), {
        idempotencyKey: brand<string, 'IdempotencyKey'>('idem-te-dup'),
      });
      expect(second.eventId).toBe(first.eventId);
      expect(second.sequence).toBe(first.sequence);
    });

    it('listEvents returns events after afterSequence', async () => {
      await gateway.timeline.appendEvent(makeTimelineEvent({ eventId: 'event-seq-1' }), {
        idempotencyKey: brand<string, 'IdempotencyKey'>('idem-te-seq-1'),
      });
      await gateway.timeline.appendEvent(makeTimelineEvent({ eventId: 'event-seq-2' }), {
        idempotencyKey: brand<string, 'IdempotencyKey'>('idem-te-seq-2'),
      });

      const result = await gateway.timeline.listEvents({
        tenantId: brand<string, 'TenantId'>('tenant-ct'),
        subjectId: brand<string, 'SubjectId'>('subject-ct'),
        agentId: brand<string, 'AgentId'>('agent-ct'),
        sessionId: brand<string, 'SessionId'>('session-ct'),
        afterSequence: brand<number, 'TimelineSequence'>(0),
        limit: 1000,
      });
      expect(result.length).toBeGreaterThanOrEqual(2);
    });

    it('timeline sequence is monotonic across runs', async () => {
      const run1 = brand<string, 'RequestRunId'>('run-tl-seq-1');
      const run2 = brand<string, 'RequestRunId'>('run-tl-seq-2');
      await gateway.timeline.appendEvent(makeTimelineEvent({ eventId: 'event-seq-r1', runId: run1 }), {
        idempotencyKey: brand<string, 'IdempotencyKey'>('idem-te-seq-r1'),
      });
      await gateway.timeline.appendEvent(makeTimelineEvent({ eventId: 'event-seq-r2', runId: run2 }), {
        idempotencyKey: brand<string, 'IdempotencyKey'>('idem-te-seq-r2'),
      });

      const events = await gateway.timeline.listEvents({
        tenantId: brand<string, 'TenantId'>('tenant-ct'),
        subjectId: brand<string, 'SubjectId'>('subject-ct'),
        agentId: brand<string, 'AgentId'>('agent-ct'),
        sessionId: brand<string, 'SessionId'>('session-ct'),
        afterSequence: brand<number, 'TimelineSequence'>(0),
        limit: 1000,
      });
      const sequences = events.map((e) => e.sequence);
      expect(sequences).toEqual([...sequences].sort((a, b) => a - b));
    });
  });

  // ── CheckpointStoreGateway ──

  describe('CheckpointStoreGateway', () => {
    it('loadCheckpoint returns latest by savedAt', async () => {
      const sessionId = brand<string, 'SessionId'>('session-cp-latest');
      const requestId = brand<string, 'MessageId'>('request-cp-latest');
      const runId = brand<string, 'RequestRunId'>('run-cp-latest');

      await gateway.checkpoints.saveCheckpoint(
        makeCheckpoint({
          checkpointId: brand<string, 'CheckpointId'>('cp-older'),
          sessionId,
          requestId,
          runId,
          savedAt: brand<number, 'EpochMillis'>(100),
        }),
        { idempotencyKey: brand<string, 'IdempotencyKey'>('idem-cp-older') },
      );
      await gateway.checkpoints.saveCheckpoint(
        makeCheckpoint({
          checkpointId: brand<string, 'CheckpointId'>('cp-newer'),
          sessionId,
          requestId,
          runId,
          savedAt: brand<number, 'EpochMillis'>(200),
        }),
        { idempotencyKey: brand<string, 'IdempotencyKey'>('idem-cp-newer') },
      );

      const result = await gateway.checkpoints.loadCheckpoint({
        tenantId: brand<string, 'TenantId'>('tenant-ct'),
        subjectId: brand<string, 'SubjectId'>('subject-ct'),
        agentId: brand<string, 'AgentId'>('agent-ct'),
        sessionId,
        requestId,
        runId,
      });
      expect(result).toBeDefined();
      expect(result?.checkpointId).toBe('cp-newer');
    });

    it('loadCheckpoint returns latest write when savedAt ties', async () => {
      const sessionId = brand<string, 'SessionId'>('session-cp-tie');
      const requestId = brand<string, 'MessageId'>('request-cp-tie');
      const runId = brand<string, 'RequestRunId'>('run-cp-tie');
      const savedAt = brand<number, 'EpochMillis'>(300);

      await gateway.checkpoints.saveCheckpoint(
        makeCheckpoint({
          checkpointId: brand<string, 'CheckpointId'>('cp-tie-first'),
          sessionId,
          requestId,
          runId,
          savedAt,
        }),
        { idempotencyKey: brand<string, 'IdempotencyKey'>('idem-cp-tie-first') },
      );
      await gateway.checkpoints.saveCheckpoint(
        makeCheckpoint({
          checkpointId: brand<string, 'CheckpointId'>('cp-tie-second'),
          sessionId,
          requestId,
          runId,
          savedAt,
        }),
        { idempotencyKey: brand<string, 'IdempotencyKey'>('idem-cp-tie-second') },
      );

      const result = await gateway.checkpoints.loadCheckpoint({
        tenantId: brand<string, 'TenantId'>('tenant-ct'),
        subjectId: brand<string, 'SubjectId'>('subject-ct'),
        agentId: brand<string, 'AgentId'>('agent-ct'),
        sessionId,
        requestId,
        runId,
      });
      expect(result?.checkpointId).toBe('cp-tie-second');
    });

    it('loadCheckpoint returns undefined for mismatched tenantId', async () => {
      const cp = makeCheckpoint({ checkpointId: brand<string, 'CheckpointId'>('cp-scope-t') });
      await gateway.checkpoints.saveCheckpoint(cp, { idempotencyKey: brand<string, 'IdempotencyKey'>('idem-cp-scope-t') });

      const result = await gateway.checkpoints.loadCheckpoint({
        tenantId: brand<string, 'TenantId'>('tenant-other'),
        subjectId: cp.subjectId,
        agentId: cp.agentId,
        sessionId: cp.sessionId,
        requestId: cp.requestId,
        runId: cp.runId,
      });
      expect(result).toBeUndefined();
    });

    it('loadCheckpoint returns undefined for mismatched subjectId', async () => {
      const cp = makeCheckpoint({ checkpointId: brand<string, 'CheckpointId'>('cp-scope-s') });
      await gateway.checkpoints.saveCheckpoint(cp, { idempotencyKey: brand<string, 'IdempotencyKey'>('idem-cp-scope-s') });

      const result = await gateway.checkpoints.loadCheckpoint({
        tenantId: cp.tenantId,
        subjectId: brand<string, 'SubjectId'>('subject-other'),
        agentId: cp.agentId,
        sessionId: cp.sessionId,
        requestId: cp.requestId,
        runId: cp.runId,
      });
      expect(result).toBeUndefined();
    });

    it('loadCheckpoint returns undefined for mismatched agentId', async () => {
      const cp = makeCheckpoint({ checkpointId: brand<string, 'CheckpointId'>('cp-scope-a') });
      await gateway.checkpoints.saveCheckpoint(cp, { idempotencyKey: brand<string, 'IdempotencyKey'>('idem-cp-scope-a') });

      const result = await gateway.checkpoints.loadCheckpoint({
        tenantId: cp.tenantId,
        subjectId: cp.subjectId,
        agentId: brand<string, 'AgentId'>('agent-other'),
        sessionId: cp.sessionId,
        requestId: cp.requestId,
        runId: cp.runId,
      });
      expect(result).toBeUndefined();
    });
  });

  describe('PendingInputStoreGateway', () => {
    it('round-trips option-attached text input metadata', async () => {
      const pending = makePendingInput({
        pendingInputId: brand<string, 'PendingInputId'>('pending-attached-input'),
        request: {
          id: brand<string, 'PendingInputId'>('pending-attached-input'),
          sessionId: brand<string, 'SessionId'>('session-ct-pending'),
          kind: 'QUESTION',
          questions: [
            {
              prompt: 'What should receive tests?',
              options: [
                {
                  label: 'Existing project',
                  value: 'existing_project',
                  requiresTextInput: true,
                  inputPlaceholder: 'Enter the project path',
                },
                { label: 'New project', value: 'new_project' },
              ],
            },
          ],
        },
      });
      await gateway.pendingInputs.createPendingInput({
        tenantId: pending.tenantId,
        subjectId: pending.subjectId,
        record: pending,
      });

      await expect(
        gateway.pendingInputs.loadPendingInput({
          tenantId: pending.tenantId,
          subjectId: pending.subjectId,
          agentId: pending.agentId,
          pendingInputId: pending.pendingInputId,
        }),
      ).resolves.toMatchObject({
        request: {
          questions: [
            {
              options: [
                {
                  value: 'existing_project',
                  requiresTextInput: true,
                  inputPlaceholder: 'Enter the project path',
                },
                { value: 'new_project' },
              ],
            },
          ],
        },
      });
    });

    it('loads active pending input by owner, agent, and session scope', async () => {
      const pending = makePendingInput({ pendingInputId: brand<string, 'PendingInputId'>('pending-active-ct') });
      await gateway.pendingInputs.createPendingInput({
        tenantId: pending.tenantId,
        subjectId: pending.subjectId,
        record: pending,
      });

      await expect(
        gateway.pendingInputs.loadActivePendingInput({
          tenantId: pending.tenantId,
          subjectId: pending.subjectId,
          agentId: pending.agentId,
          sessionId: pending.sessionId,
        }),
      ).resolves.toMatchObject({ pendingInputId: pending.pendingInputId, status: 'PENDING' });
      await expect(
        gateway.pendingInputs.loadActivePendingInput({
          tenantId: brand<string, 'TenantId'>('tenant-other'),
          subjectId: pending.subjectId,
          agentId: pending.agentId,
          sessionId: pending.sessionId,
        }),
      ).resolves.toBeUndefined();
      await expect(
        gateway.pendingInputs.loadActivePendingInput({
          tenantId: pending.tenantId,
          subjectId: pending.subjectId,
          agentId: brand<string, 'AgentId'>('agent-other'),
          sessionId: pending.sessionId,
        }),
      ).resolves.toBeUndefined();
      await expect(
        gateway.pendingInputs.createPendingInput({
          tenantId: pending.tenantId,
          subjectId: pending.subjectId,
          record: makePendingInput({
            pendingInputId: brand<string, 'PendingInputId'>('pending-active-ct-conflict'),
            sessionId: pending.sessionId,
          }),
        }),
      ).rejects.toMatchObject({ code: 'PENDING_INPUT_ACTIVE_CONFLICT' });
    });

    it('lists Agent-scoped timeout candidates with incomplete recovery and stable keyset pagination', async () => {
      const dueNow = makePendingInput({
        pendingInputId: brand<string, 'PendingInputId'>('pending-due-10'),
        sessionId: brand<string, 'SessionId'>('session-due-10'),
        request: {
          id: brand<string, 'PendingInputId'>('pending-due-10'),
          sessionId: brand<string, 'SessionId'>('session-due-10'),
          kind: 'QUESTION',
          questions: [{ prompt: 'Now?', options: [] }],
          timeoutAt: brand<number, 'EpochMillis'>(10),
        },
      });
      const dueSameTime = makePendingInput({
        pendingInputId: brand<string, 'PendingInputId'>('pending-due-10-b'),
        sessionId: brand<string, 'SessionId'>('session-due-10-b'),
        request: {
          id: brand<string, 'PendingInputId'>('pending-due-10-b'),
          sessionId: brand<string, 'SessionId'>('session-due-10-b'),
          kind: 'QUESTION',
          questions: [{ prompt: 'Same time?', options: [] }],
          timeoutAt: brand<number, 'EpochMillis'>(10),
        },
      });
      const futurePending = makePendingInput({
        pendingInputId: brand<string, 'PendingInputId'>('pending-future-30'),
        sessionId: brand<string, 'SessionId'>('session-future-30'),
        tenantId: brand<string, 'TenantId'>('tenant-other-owner'),
        subjectId: brand<string, 'SubjectId'>('subject-other-owner'),
        request: {
          id: brand<string, 'PendingInputId'>('pending-future-30'),
          sessionId: brand<string, 'SessionId'>('session-future-30'),
          kind: 'QUESTION',
          questions: [{ prompt: 'Future?', options: [] }],
          timeoutAt: brand<number, 'EpochMillis'>(30),
        },
      });
      const otherAgentDue = makePendingInput({
        agentId: brand<string, 'AgentId'>('agent-other'),
        pendingInputId: brand<string, 'PendingInputId'>('pending-other-agent'),
        sessionId: brand<string, 'SessionId'>('session-other-agent'),
        request: {
          id: brand<string, 'PendingInputId'>('pending-other-agent'),
          sessionId: brand<string, 'SessionId'>('session-other-agent'),
          kind: 'QUESTION',
          questions: [{ prompt: 'Other agent?', options: [] }],
          timeoutAt: brand<number, 'EpochMillis'>(1),
        },
      });
      const timedOutIncomplete = makePendingInput({
        pendingInputId: brand<string, 'PendingInputId'>('pending-timeout-incomplete'),
        sessionId: brand<string, 'SessionId'>('session-timeout-incomplete'),
        requestRunId: brand<string, 'RequestRunId'>('run-timeout-incomplete'),
        status: 'TIMED_OUT',
        request: {
          id: brand<string, 'PendingInputId'>('pending-timeout-incomplete'),
          sessionId: brand<string, 'SessionId'>('session-timeout-incomplete'),
          kind: 'QUESTION',
          questions: [{ prompt: 'Incomplete?', options: [] }],
          timeoutAt: brand<number, 'EpochMillis'>(5),
        },
      });
      const timedOutCommitted = makePendingInput({
        pendingInputId: brand<string, 'PendingInputId'>('pending-timeout-committed'),
        sessionId: brand<string, 'SessionId'>('session-timeout-committed'),
        requestRunId: brand<string, 'RequestRunId'>('run-timeout-committed'),
        status: 'TIMED_OUT',
        request: {
          id: brand<string, 'PendingInputId'>('pending-timeout-committed'),
          sessionId: brand<string, 'SessionId'>('session-timeout-committed'),
          kind: 'QUESTION',
          questions: [{ prompt: 'Committed?', options: [] }],
          timeoutAt: brand<number, 'EpochMillis'>(6),
        },
      });
      const noTimeout = makePendingInput({
        pendingInputId: brand<string, 'PendingInputId'>('pending-no-timeout'),
        sessionId: brand<string, 'SessionId'>('session-no-timeout'),
      });
      const receivedDue = makePendingInput({
        pendingInputId: brand<string, 'PendingInputId'>('pending-received-due'),
        sessionId: brand<string, 'SessionId'>('session-received-due'),
        status: 'RECEIVED',
        request: {
          id: brand<string, 'PendingInputId'>('pending-received-due'),
          sessionId: brand<string, 'SessionId'>('session-received-due'),
          kind: 'QUESTION',
          questions: [{ prompt: 'Received?', options: [] }],
          timeoutAt: brand<number, 'EpochMillis'>(5),
        },
        responseAnswers: [['done']],
      });

      await gateway.requestRuns.saveRun(
        makeRun({
          tenantId: timedOutIncomplete.tenantId,
          subjectId: timedOutIncomplete.subjectId,
          agentId: timedOutIncomplete.agentId,
          sessionId: timedOutIncomplete.sessionId,
          requestId: timedOutIncomplete.requestId,
          runId: timedOutIncomplete.requestRunId,
          terminalCommitState: 'NOT_STARTED',
        }),
        {},
      );
      await gateway.requestRuns.saveRun(
        makeRun({
          tenantId: timedOutCommitted.tenantId,
          subjectId: timedOutCommitted.subjectId,
          agentId: timedOutCommitted.agentId,
          sessionId: timedOutCommitted.sessionId,
          requestId: timedOutCommitted.requestId,
          runId: timedOutCommitted.requestRunId,
          status: 'FAILED',
          terminalCommitState: 'COMMITTED',
        }),
        {},
      );

      for (const record of [futurePending, dueSameTime, dueNow, otherAgentDue, timedOutIncomplete, timedOutCommitted, noTimeout, receivedDue]) {
        await gateway.pendingInputs.createPendingInput({ tenantId: record.tenantId, subjectId: record.subjectId, record });
      }

      const firstPage = await gateway.pendingInputs.listUnresolvedPendingInputTimeoutFacts({
        agentId: brand<string, 'AgentId'>('agent-ct'),
        limit: 2,
      });
      const secondPage = await gateway.pendingInputs.listUnresolvedPendingInputTimeoutFacts({
        agentId: brand<string, 'AgentId'>('agent-ct'),
        limit: 2,
        after: {
          timeoutAt: firstPage[1]!.request.timeoutAt!,
          pendingInputId: firstPage[1]!.pendingInputId,
        },
      });
      const thirdPage = await gateway.pendingInputs.listUnresolvedPendingInputTimeoutFacts({
        agentId: brand<string, 'AgentId'>('agent-ct'),
        limit: 2,
        after: {
          timeoutAt: secondPage[1]!.request.timeoutAt!,
          pendingInputId: secondPage[1]!.pendingInputId,
        },
      });

      expect(firstPage.map((record) => record.pendingInputId)).toEqual(['pending-timeout-incomplete', 'pending-due-10']);
      expect(secondPage.map((record) => record.pendingInputId)).toEqual(['pending-due-10-b', 'pending-future-30']);
      expect(thirdPage).toEqual([]);
      expect(secondPage[1]).toMatchObject({
        tenantId: 'tenant-other-owner',
        subjectId: 'subject-other-owner',
        agentId: 'agent-ct',
      });
      expect([...firstPage, ...secondPage, ...thirdPage].map((record) => record.pendingInputId)).not.toContain('pending-timeout-committed');
      expect([...firstPage, ...secondPage, ...thirdPage].map((record) => record.pendingInputId)).not.toContain('pending-other-agent');

      await expect(
        gateway.pendingInputs.listUnresolvedPendingInputTimeoutFacts({
          agentId: brand<string, 'AgentId'>('agent-ct'),
          limit: 0,
        }),
      ).rejects.toMatchObject({ code: 'PENDING_INPUT_TIMEOUT_CANDIDATE_LIMIT_INVALID' });
      await expect(
        gateway.pendingInputs.listUnresolvedPendingInputTimeoutFacts({
          agentId: brand<string, 'AgentId'>('agent-ct'),
          limit: 1001,
        }),
      ).rejects.toMatchObject({ code: 'PENDING_INPUT_TIMEOUT_CANDIDATE_LIMIT_INVALID' });
      await expect(
        gateway.pendingInputs.listUnresolvedPendingInputTimeoutFacts({
          agentId: '' as never,
          limit: 1,
        }),
      ).rejects.toMatchObject({ code: 'PENDING_INPUT_TIMEOUT_CANDIDATE_AGENT_REQUIRED' });
      await expect(
        gateway.pendingInputs.listUnresolvedPendingInputTimeoutFacts({
          agentId: brand<string, 'AgentId'>('agent-ct'),
          limit: 1,
          after: { timeoutAt: brand<number, 'EpochMillis'>(10) } as never,
        }),
      ).rejects.toMatchObject({ code: 'PENDING_INPUT_TIMEOUT_CANDIDATE_CURSOR_INVALID' });
    });

    it('resolves pending input idempotently without adding key fields to records', async () => {
      const pending = makePendingInput({ pendingInputId: brand<string, 'PendingInputId'>('pending-resolve-idem') });
      await gateway.pendingInputs.createPendingInput({
        tenantId: pending.tenantId,
        subjectId: pending.subjectId,
        record: pending,
      });
      const request = {
        tenantId: pending.tenantId,
        subjectId: pending.subjectId,
        agentId: pending.agentId,
        pendingInputId: pending.pendingInputId,
        expectedStatus: 'PENDING' as const,
        status: 'RECEIVED' as const,
        answer: {
          answers: [['yes']],
          answeredAt: brand<number, 'EpochMillis'>(30),
        },
      };
      const options = {
        idempotencyKey: brand<string, 'IdempotencyKey'>('idem-pending-resolve'),
        idempotencySemantic: JSON.stringify(['pending-input-resolve-v1', pending.pendingInputId, 'RECEIVED', [['yes']]]),
      };

      await expect(gateway.pendingInputs.resolvePendingInput(request, options)).resolves.toMatchObject({
        status: 'UPDATED',
        record: { status: 'RECEIVED', responseAnswers: [['yes']] },
      });
      await expect(gateway.pendingInputs.resolvePendingInput(request, options)).resolves.toMatchObject({
        status: 'UPDATED',
        record: { status: 'RECEIVED', responseAnswers: [['yes']] },
      });
      await expect(
        gateway.pendingInputs.resolvePendingInput(request, {
          ...options,
          idempotencySemantic: JSON.stringify(['pending-input-resolve-v1', pending.pendingInputId, 'RECEIVED', [['no']]]),
        }),
      ).resolves.toMatchObject({ status: 'IDEMPOTENCY_CONFLICT' });

      const loaded = await gateway.pendingInputs.loadPendingInput({
        tenantId: pending.tenantId,
        subjectId: pending.subjectId,
        agentId: pending.agentId,
        pendingInputId: pending.pendingInputId,
      });
      expect(loaded).not.toHaveProperty('idempotencyKey');
      expect(loaded).not.toHaveProperty('resolveIdempotencyKey');
    });

    it('returns version conflict when a timeout resolve loses the pending CAS', async () => {
      const pending = makePendingInput({ pendingInputId: brand<string, 'PendingInputId'>('pending-timeout-cas') });
      await gateway.pendingInputs.createPendingInput({
        tenantId: pending.tenantId,
        subjectId: pending.subjectId,
        record: pending,
      });
      await gateway.pendingInputs.resolvePendingInput({
        tenantId: pending.tenantId,
        subjectId: pending.subjectId,
        agentId: pending.agentId,
        pendingInputId: pending.pendingInputId,
        expectedStatus: 'PENDING',
        status: 'RECEIVED',
        answer: {
          answers: [['yes']],
          answeredAt: brand<number, 'EpochMillis'>(30),
        },
      });

      await expect(
        gateway.pendingInputs.resolvePendingInput({
          tenantId: pending.tenantId,
          subjectId: pending.subjectId,
          agentId: pending.agentId,
          pendingInputId: pending.pendingInputId,
          expectedStatus: 'PENDING',
          status: 'TIMED_OUT',
        }),
      ).resolves.toMatchObject({ status: 'VERSION_CONFLICT', record: { status: 'RECEIVED' } });
    });
  });

  describe('Long-term memory gateway composition', () => {
    it('exposes Store, Retriever, and Sharing bindings', () => {
      expect(gateway.longTermMemoryStore).toBeDefined();
      expect(gateway.longTermMemoryRetriever).toBeDefined();
      expect(gateway.longTermMemorySharing).toBeDefined();
    });

    it('returns LTM_DISABLED from all thirteen YAML-aligned operations', async () => {
      const diagnostics: Array<{ readonly operation: string }> = [];
      const disabled = createDisabledLongTermMemoryGateway({ diagnosticObserver: (event) => diagnostics.push(event) });
      const owner = {
        tenantId: brand<string, 'TenantId'>('tenant-disabled'),
        subjectId: brand<string, 'SubjectId'>('subject-disabled'),
        agentId: brand<string, 'AgentId'>('agent-disabled'),
      };
      const memoryId = brand<string, 'LongTermMemoryId'>('memory-disabled');
      const save = {
        ...owner,
        memoryType: 'FACTUAL' as const,
        knowledgeSourceType: 'CONFIGURED' as const,
        briefIndex: 'disabled memory',
        content: 'disabled content',
        confidence: 0.5,
        source: 'MANUAL',
      };
      const manual = {
        ...owner,
        memoryType: 'FACTUAL' as const,
        knowledgeSourceType: 'CONFIGURED' as const,
        briefIndex: 'disabled manual memory',
        content: 'disabled content',
        confidence: 1,
      };

      const results = await Promise.all([
        disabled.store.getLongTermMemory({ ...owner, memoryId }),
        disabled.store.saveLongTermMemory(save),
        disabled.store.batchCreateLongTermMemory({ ...owner, items: [save] }),
        disabled.store.manualSaveLongTermMemory(manual),
        disabled.store.deleteLongTermMemory({ ...owner, memoryId }),
        disabled.store.listLongTermMemory(owner),
        disabled.store.mutateLongTermMemory({ ...owner, memoryId, isPinned: true }),
        disabled.retriever.searchLongTermMemory({ ...owner, queryText: 'BGP', minConfidence: 0, limit: 10, offset: 0 }),
        disabled.retriever.getLongTermMemoryDetail({ ...owner, memoryId }),
        disabled.sharing.publishLongTermMemory({ ...owner, memoryId }),
        disabled.sharing.unpublishLongTermMemory({ ...owner, memoryId }),
        disabled.sharing.listPublishedLongTermMemory(owner),
        disabled.sharing.copyPublishedMemory({ ...owner, memoryIds: [memoryId] }),
      ]);

      expect(results).toEqual(results.map(() => expect.objectContaining({ code: 'LTM_DISABLED', category: 'UNAVAILABLE' })));
      expect(diagnostics.map((entry) => entry.operation)).toEqual([
        'getLongTermMemory',
        'saveLongTermMemory',
        'batchCreateLongTermMemory',
        'manualSaveLongTermMemory',
        'deleteLongTermMemory',
        'listLongTermMemory',
        'mutateLongTermMemory',
        'searchLongTermMemory',
        'getLongTermMemoryDetail',
        'publishLongTermMemory',
        'unpublishLongTermMemory',
        'listPublishedLongTermMemory',
        'copyPublishedMemory',
      ]);
    });
  });
  describe('Session title update', () => {
    it('updates session title and returns updated session', async () => {
      const session = makeSession();
      await gateway.sessions.saveSession(session, { idempotencyKey: brand<string, 'IdempotencyKey'>('idem-tu-session') });

      const result = await sessions.updateTitle({
        identityContext: { tenantId: session.tenantId, subjectId: session.subjectId, displayName: 'test' },
        agentId: session.agentId,
        sessionId: session.sessionId,
        title: 'New Title',
        idempotencyKey: brand<string, 'IdempotencyKey'>('idem-tu-update'),
      });
      expect(result.title).toBe('New Title');
    });

    it('rejects title exceeding 100 characters', async () => {
      const session = makeSession();
      await gateway.sessions.saveSession(session, { idempotencyKey: brand<string, 'IdempotencyKey'>('idem-tu-long') });

      await expect(
        sessions.updateTitle({
          identityContext: { tenantId: session.tenantId, subjectId: session.subjectId, displayName: 'test' },
          agentId: session.agentId,
          sessionId: session.sessionId,
          title: 'x'.repeat(101),
          idempotencyKey: brand<string, 'IdempotencyKey'>('idem-tu-long-upd'),
        }),
      ).rejects.toThrow('exceeds the maximum length');
    });

    it('accepts a single-character title', async () => {
      const session = makeSession();
      await gateway.sessions.saveSession(session, { idempotencyKey: brand<string, 'IdempotencyKey'>('idem-tu-short') });

      const result = await sessions.updateTitle({
        identityContext: { tenantId: session.tenantId, subjectId: session.subjectId, displayName: 'test' },
        agentId: session.agentId,
        sessionId: session.sessionId,
        title: '网',
        idempotencyKey: brand<string, 'IdempotencyKey'>('idem-tu-short-upd'),
      });
      expect(result.title).toBe('网');
    });

    it('rejects a whitespace-only title', async () => {
      const session = makeSession();
      await gateway.sessions.saveSession(session, { idempotencyKey: brand<string, 'IdempotencyKey'>('idem-tu-blank') });

      await expect(
        sessions.updateTitle({
          identityContext: { tenantId: session.tenantId, subjectId: session.subjectId, displayName: 'test' },
          agentId: session.agentId,
          sessionId: session.sessionId,
          title: '  \t   ',
          idempotencyKey: brand<string, 'IdempotencyKey'>('idem-tu-blank-upd'),
        }),
      ).rejects.toThrow('must be 1-100 characters');
    });

    it('trims whitespace before persisting the title', async () => {
      const session = makeSession();
      await gateway.sessions.saveSession(session, { idempotencyKey: brand<string, 'IdempotencyKey'>('idem-tu-trim') });

      const result = await sessions.updateTitle({
        identityContext: { tenantId: session.tenantId, subjectId: session.subjectId, displayName: 'test' },
        agentId: session.agentId,
        sessionId: session.sessionId,
        title: '  网络巡检  ',
        idempotencyKey: brand<string, 'IdempotencyKey'>('idem-tu-trim-upd'),
      });
      expect(result.title).toBe('网络巡检');
    });

    it('rejects title containing HTML tags', async () => {
      const session = makeSession();
      await gateway.sessions.saveSession(session, { idempotencyKey: brand<string, 'IdempotencyKey'>('idem-tu-xss') });

      await expect(
        sessions.updateTitle({
          identityContext: { tenantId: session.tenantId, subjectId: session.subjectId, displayName: 'test' },
          agentId: session.agentId,
          sessionId: session.sessionId,
          title: '<script>alert(1)</script>',
          idempotencyKey: brand<string, 'IdempotencyKey'>('idem-tu-xss-upd'),
        }),
      ).rejects.toMatchObject({ code: 'SESSION_TITLE_UNSAFE_CONTENT', message: expect.stringContaining('HTML tags') });
    });

    it('rejects title containing a secret pattern with a category-specific message', async () => {
      const session = makeSession();
      await gateway.sessions.saveSession(session, { idempotencyKey: brand<string, 'IdempotencyKey'>('idem-tu-secret') });

      await expect(
        sessions.updateTitle({
          identityContext: { tenantId: session.tenantId, subjectId: session.subjectId, displayName: 'test' },
          agentId: session.agentId,
          sessionId: session.sessionId,
          title: 'api_key=abc123',
          idempotencyKey: brand<string, 'IdempotencyKey'>('idem-tu-secret-upd'),
        }),
      ).rejects.toMatchObject({ code: 'SESSION_TITLE_UNSAFE_CONTENT', message: expect.stringContaining('credentials') });
    });

    it('does not leak the rejected title content in the unsafe error message', async () => {
      const session = makeSession();
      await gateway.sessions.saveSession(session, { idempotencyKey: brand<string, 'IdempotencyKey'>('idem-tu-noleak') });

      const xssError = await sessions
        .updateTitle({
          identityContext: { tenantId: session.tenantId, subjectId: session.subjectId, displayName: 'test' },
          agentId: session.agentId,
          sessionId: session.sessionId,
          title: '<script>alert(1)</script>',
          idempotencyKey: brand<string, 'IdempotencyKey'>('idem-tu-noleak-xss'),
        })
        .then(
          () => undefined,
          (error: unknown) => error,
        );
      expect(xssError).toMatchObject({ code: 'SESSION_TITLE_UNSAFE_CONTENT' });
      expect((xssError as { message: string }).message).not.toContain('alert(1)');

      const secretError = await sessions
        .updateTitle({
          identityContext: { tenantId: session.tenantId, subjectId: session.subjectId, displayName: 'test' },
          agentId: session.agentId,
          sessionId: session.sessionId,
          title: 'api_key=abc123',
          idempotencyKey: brand<string, 'IdempotencyKey'>('idem-tu-noleak-secret'),
        })
        .then(
          () => undefined,
          (error: unknown) => error,
        );
      expect(secretError).toMatchObject({ code: 'SESSION_TITLE_UNSAFE_CONTENT' });
      expect((secretError as { message: string }).message).not.toContain('abc123');
    });

    it('rejects an empty string title', async () => {
      const session = makeSession({ title: 'Old Title' });
      await gateway.sessions.saveSession(session, { idempotencyKey: brand<string, 'IdempotencyKey'>('idem-tu-clear') });

      await expect(
        sessions.updateTitle({
          identityContext: { tenantId: session.tenantId, subjectId: session.subjectId, displayName: 'test' },
          agentId: session.agentId,
          sessionId: session.sessionId,
          title: '',
          idempotencyKey: brand<string, 'IdempotencyKey'>('idem-tu-clear-upd'),
        }),
      ).rejects.toThrow('must be 1-100 characters');
    });

    it('returns not found for non-existent session', async () => {
      await expect(
        sessions.updateTitle({
          identityContext: {
            tenantId: brand<string, 'TenantId'>('tenant-ct'),
            subjectId: brand<string, 'SubjectId'>('subject-ct'),
            displayName: 'test',
          },
          agentId: brand<string, 'AgentId'>('agent-ct'),
          sessionId: brand<string, 'SessionId'>('non-existent'),
          title: 'Test',
          idempotencyKey: brand<string, 'IdempotencyKey'>('idem-tu-nx'),
        }),
      ).rejects.toThrow('Session was not found');
    });
  });

  describe('Session title generation', () => {
    it('falls back to the original first user question when extraction returns empty', async () => {
      const session = makeUntitledSession();
      await gateway.sessions.saveSession(session, { idempotencyKey: brand<string, 'IdempotencyKey'>('idem-tg-fallback') });

      await expect(
        sessions.generateTitle({
          identityContext: { tenantId: session.tenantId, subjectId: session.subjectId, displayName: 'test' },
          agentId: session.agentId,
          sessionId: session.sessionId,
          requestRunId: brand<string, 'RequestRunId'>('run-tg-fallback'),
          firstUserText: '你好',
          isFirstRequest: true,
        }),
      ).resolves.toBe(true);

      await expect(
        gateway.sessions.loadSession({
          tenantId: session.tenantId,
          subjectId: session.subjectId,
          agentId: session.agentId,
          sessionId: session.sessionId,
        }),
      ).resolves.toMatchObject({ title: '你好', titleSource: 'automatic' });
    });

    it('does not save an unsafe generated title', async () => {
      const session = makeUntitledSession();
      await gateway.sessions.saveSession(session, { idempotencyKey: brand<string, 'IdempotencyKey'>('idem-tg-unsafe') });

      await expect(
        sessions.generateTitle({
          identityContext: { tenantId: session.tenantId, subjectId: session.subjectId, displayName: 'test' },
          agentId: session.agentId,
          sessionId: session.sessionId,
          requestRunId: brand<string, 'RequestRunId'>('run-tg-unsafe'),
          firstUserText: 'api_key=x',
          isFirstRequest: true,
        }),
      ).resolves.toBe(false);

      const stored = await gateway.sessions.loadSession({
        tenantId: session.tenantId,
        subjectId: session.subjectId,
        agentId: session.agentId,
        sessionId: session.sessionId,
      });
      expect(stored?.title).toBeUndefined();
      expect(stored?.titleSource).toBeUndefined();
    });
  });
});
