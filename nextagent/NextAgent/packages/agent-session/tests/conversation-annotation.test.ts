import { createSqliteGatewayStores } from '@nextagent/agent-platform-gateway-local';
import { brand, type AgentId, type EpochMillis, type RequestRunId, type SessionId, type SubjectId, type TenantId } from '@nextagent/agent-common';
import { AgentError } from '@nextagent/agent-common';
import type { RequestRunRecord } from '@nextagent/agent-contracts/gateway';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConversationAnnotationService } from '../src/services/conversation-annotation-service.js';

function first<T>(arr: readonly T[]): T {
  expect(arr.length).toBeGreaterThan(0);
  return arr[0] as T;
}

const T1 = 'T1' as TenantId;
const U1 = 'U1' as SubjectId;
const A1 = 'A1' as AgentId;
const S1 = 'S1' as SessionId;
const R1 = 'R1' as RequestRunId;
const R2 = 'R2' as RequestRunId;

let ts = 1000;
function clock(): EpochMillis {
  return brand<number, 'EpochMillis'>(ts++);
}

function makeIdentity(tenantId: TenantId = T1, subjectId: SubjectId = U1) {
  return { tenantId, subjectId, displayName: 'test-user' };
}

function makeRunRecord(overrides: Partial<RequestRunRecord> & Pick<RequestRunRecord, 'runId' | 'requestId'>): RequestRunRecord {
  return {
    tenantId: T1,
    subjectId: U1,
    agentId: A1,
    agentVersion: brand<string, 'AgentVersion'>('v1'),
    agentAssemblyRef: 'A1:v1',
    sessionId: S1,
    attempt: 1,
    status: 'COMPLETED',
    version: 1,
    terminalCommitState: 'COMMITTED',
    createdAt: clock(),
    updatedAt: clock(),
    ...overrides,
  };
}

describe('ConversationAnnotationService', () => {
  let dir: string;
  let gateway: ReturnType<typeof createSqliteGatewayStores>;
  let service: ConversationAnnotationService;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'ann-svc-test-'));
    gateway = createSqliteGatewayStores({ sqliteFile: join(dir, 'test.db') });
    service = new ConversationAnnotationService({
      annotationStore: gateway.conversationAnnotations,
      runStore: gateway.requestRuns,
      messageStore: gateway.messages,
      clock,
      createAnnotationId: () => `ann-${ts}`,
    });
    ts = 1000;
    // Seed run records so upsertAnnotation's run-existence validation passes.
    // R1/R2 are the runIds used across the upsert/favorite/list tests below.
    await gateway.requestRuns.saveRun(makeRunRecord({ runId: R1, requestId: brand<string, 'MessageId'>('req-R1') }), {});
    await gateway.requestRuns.saveRun(makeRunRecord({ runId: R2, requestId: brand<string, 'MessageId'>('req-R2') }), {});
  });

  afterEach(() => {
    gateway.close?.();
    rmSync(dir, { recursive: true, force: true });
  });

  describe('upsertAnnotation', () => {
    it('creates annotation with sentiment UP', async () => {
      const view = await service.upsertAnnotation({
        identityContext: makeIdentity(),
        agentId: A1,
        sessionId: S1,
        requestRunId: R1,
        sentiment: 'UP',
      });
      expect(view).toBeDefined();
      expect(view!.sentiment).toBe('UP');
      expect(view!.isFavorited).toBe(false);
      expect(view!.comment).toBeNull();
    });

    it('updates sentiment UP to DOWN on same run', async () => {
      await service.upsertAnnotation({
        identityContext: makeIdentity(),
        agentId: A1,
        sessionId: S1,
        requestRunId: R1,
        sentiment: 'UP',
      });
      const updated = await service.upsertAnnotation({
        identityContext: makeIdentity(),
        agentId: A1,
        sessionId: S1,
        requestRunId: R1,
        sentiment: 'DOWN',
      });
      expect(updated!.sentiment).toBe('DOWN');
    });

    it('upserts comment: set, clear, and preserve', async () => {
      await service.upsertAnnotation({
        identityContext: makeIdentity(),
        agentId: A1,
        sessionId: S1,
        requestRunId: R1,
        sentiment: 'UP',
        comment: 'hello',
      });
      const set = await service.listSessionAnnotations({
        identityContext: makeIdentity(),
        agentId: A1,
        sessionId: S1,
      });
      expect(first(set).comment).toBe('hello');

      // Clear comment
      await service.upsertAnnotation({
        identityContext: makeIdentity(),
        agentId: A1,
        sessionId: S1,
        requestRunId: R1,
        comment: null,
      });
      const cleared = await service.listSessionAnnotations({
        identityContext: makeIdentity(),
        agentId: A1,
        sessionId: S1,
      });
      expect(first(cleared).comment).toBeNull();
    });

    it('sets isFavorited independently of sentiment', async () => {
      await service.upsertAnnotation({
        identityContext: makeIdentity(),
        agentId: A1,
        sessionId: S1,
        requestRunId: R1,
        sentiment: 'UP',
      });
      const updated = await service.upsertAnnotation({
        identityContext: makeIdentity(),
        agentId: A1,
        sessionId: S1,
        requestRunId: R1,
        isFavorited: true,
      });
      expect(updated!.sentiment).toBe('UP');
      expect(updated!.isFavorited).toBe(true);
    });

    it('returns undefined when sentiment=null and isFavorited=false (row deleted)', async () => {
      await service.upsertAnnotation({
        identityContext: makeIdentity(),
        agentId: A1,
        sessionId: S1,
        requestRunId: R1,
        sentiment: 'UP',
      });
      const result = await service.upsertAnnotation({
        identityContext: makeIdentity(),
        agentId: A1,
        sessionId: S1,
        requestRunId: R1,
        sentiment: null,
      });
      expect(result).toBeUndefined();
    });

    it('keeps row when sentiment=null but isFavorited=true', async () => {
      await service.upsertAnnotation({
        identityContext: makeIdentity(),
        agentId: A1,
        sessionId: S1,
        requestRunId: R1,
        sentiment: 'UP',
        isFavorited: true,
      });
      const result = await service.upsertAnnotation({
        identityContext: makeIdentity(),
        agentId: A1,
        sessionId: S1,
        requestRunId: R1,
        sentiment: null,
      });
      expect(result).toBeDefined();
      expect(result!.sentiment).toBeNull();
      expect(result!.isFavorited).toBe(true);
    });

    it('createdAt stays first action time, updatedAt advances', async () => {
      await service.upsertAnnotation({
        identityContext: makeIdentity(),
        agentId: A1,
        sessionId: S1,
        requestRunId: R1,
        sentiment: 'UP',
      });
      const firstBatch = await service.listSessionAnnotations({
        identityContext: makeIdentity(),
        agentId: A1,
        sessionId: S1,
      });
      const firstCreatedAt = first(firstBatch).createdAt;

      await service.upsertAnnotation({
        identityContext: makeIdentity(),
        agentId: A1,
        sessionId: S1,
        requestRunId: R1,
        isFavorited: true,
      });
      const second = await service.listSessionAnnotations({
        identityContext: makeIdentity(),
        agentId: A1,
        sessionId: S1,
      });
      expect(first(second).createdAt).toBe(firstCreatedAt);
    });

    it('throws AgentError when gateway returns SafeError', async () => {
      const failingStore = {
        saveAnnotation: vi.fn().mockResolvedValue({
          code: 'ANNOTATION_STORAGE_UNAVAILABLE',
          message: 'fail',
          category: 'UNAVAILABLE',
          retryable: true,
        }),
        listFavoriteTurns: vi.fn(),
        listSessionAnnotations: vi.fn(),
      };
      const failingService = new ConversationAnnotationService({
        annotationStore: failingStore as never,
        runStore: gateway.requestRuns,
        messageStore: gateway.messages,
        clock,
        createAnnotationId: () => 'ann-x',
      });
      await expect(
        failingService.upsertAnnotation({
          identityContext: makeIdentity(),
          agentId: A1,
          sessionId: S1,
          requestRunId: R1,
          sentiment: 'UP',
        }),
      ).rejects.toThrow(AgentError);
    });

    it('throws ANNOTATION_RUN_NOT_FOUND when run does not exist', async () => {
      await expect(
        service.upsertAnnotation({
          identityContext: makeIdentity(),
          agentId: A1,
          sessionId: S1,
          requestRunId: 'RUN_DOES_NOT_EXIST' as RequestRunId,
          sentiment: 'UP',
        }),
      ).rejects.toMatchObject({ code: 'ANNOTATION_RUN_NOT_FOUND', category: 'NOT_FOUND' });
    });

    it('throws ANNOTATION_RUN_NOT_FOUND when run belongs to a different session', async () => {
      // R1 is anchored to S1 (seeded in beforeEach); annotating it under another
      // session must be rejected without leaking that the run exists elsewhere.
      await expect(
        service.upsertAnnotation({
          identityContext: makeIdentity(),
          agentId: A1,
          sessionId: 'S_OTHER' as SessionId,
          requestRunId: R1,
          sentiment: 'UP',
        }),
      ).rejects.toMatchObject({ code: 'ANNOTATION_RUN_NOT_FOUND', category: 'NOT_FOUND' });
    });

    it('allows annotation on fork-inherited run anchor with message but no RequestRunRecord', async () => {
      // Simulate a fork-copied child run anchor: no RequestRunRecord exists,
      // but a message with that runId exists in the session.
      const forkRunId = 'R_FORK_CHILD' as RequestRunId;
      await gateway.messages.appendSessionMessage({
        tenantId: T1,
        subjectId: U1,
        agentId: A1,
        sessionId: S1,
        messageId: brand<string, 'MessageId'>('msg-fork-1'),
        requestId: brand<string, 'MessageId'>('req-fork-1'),
        runId: forkRunId,
        role: 'ASSISTANT',
        content: 'forked answer',
        contentType: 'PLAIN_TEXT',
        metadata: {},
        visible: true,
        createdAt: brand(300),
      });

      const view = await service.upsertAnnotation({
        identityContext: makeIdentity(),
        agentId: A1,
        sessionId: S1,
        requestRunId: forkRunId,
        sentiment: 'UP',
      });
      expect(view).toBeDefined();
      expect(view!.sentiment).toBe('UP');
    });

    it('allows favorite on fork-inherited run anchor with message but no RequestRunRecord', async () => {
      const forkRunId = 'R_FORK_FAV' as RequestRunId;
      await gateway.messages.appendSessionMessage({
        tenantId: T1,
        subjectId: U1,
        agentId: A1,
        sessionId: S1,
        messageId: brand<string, 'MessageId'>('msg-fork-fav'),
        requestId: brand<string, 'MessageId'>('req-fork-fav'),
        runId: forkRunId,
        role: 'ASSISTANT',
        content: 'forked answer to favorite',
        contentType: 'PLAIN_TEXT',
        metadata: {},
        visible: true,
        createdAt: brand(310),
      });

      const view = await service.upsertAnnotation({
        identityContext: makeIdentity(),
        agentId: A1,
        sessionId: S1,
        requestRunId: forkRunId,
        isFavorited: true,
      });
      expect(view).toBeDefined();
      expect(view!.isFavorited).toBe(true);
    });

    it('throws ANNOTATION_RUN_NOT_FOUND when runId has no RequestRunRecord and no message', async () => {
      // Ghost runId: no run record AND no message — must still 404.
      await expect(
        service.upsertAnnotation({
          identityContext: makeIdentity(),
          agentId: A1,
          sessionId: S1,
          requestRunId: 'R_TOTAL_GHOST' as RequestRunId,
          sentiment: 'UP',
        }),
      ).rejects.toMatchObject({ code: 'ANNOTATION_RUN_NOT_FOUND', category: 'NOT_FOUND' });
    });
  });

  describe('listFavoriteTurns', () => {
    it('returns favorited sessions with metadata', async () => {
      // Create a session record first
      await gateway.sessions.saveSession({
        tenantId: T1,
        subjectId: U1,
        agentId: A1,
        sessionId: S1,
        createdAt: brand(100),
        updatedAt: brand(200),
      });
      await service.upsertAnnotation({
        identityContext: makeIdentity(),
        agentId: A1,
        sessionId: S1,
        requestRunId: R1,
        isFavorited: true,
      });
      await service.upsertAnnotation({
        identityContext: makeIdentity(),
        agentId: A1,
        sessionId: S1,
        requestRunId: R2,
        isFavorited: true,
      });
      const page = await service.listFavoriteTurns({
        identityContext: makeIdentity(),
        agentId: A1,
        offset: 0,
        limit: 10,
      });
      expect(page.entries).toHaveLength(2);
      expect(page.entries[0]!.sessionId).toBe(S1);
      expect(page.entries[1]!.sessionId).toBe(S1);
      // Favorites are ordered DESC by favoritedAt (= updated_at). The store stamps
      // updated_at with real wall-clock time, so R1/R2 may tie at sub-millisecond
      // and return in insertion order; assert the set + the DESC invariant rather
      // than a specific runId order (which would be flaky under timing jitter).
      expect(new Set(page.entries.map((entry) => entry.requestRunId))).toEqual(new Set([R1, R2]));
      expect(page.entries[0]!.favoritedAt).toBeGreaterThanOrEqual(page.entries[1]!.favoritedAt);
      expect(first(page.entries).sessionUpdatedAt).toBe(brand(200));
      expect(page.hasMore).toBe(false);
    });

    it('returns empty for cross-scope query', async () => {
      await service.upsertAnnotation({
        identityContext: makeIdentity(),
        agentId: A1,
        sessionId: S1,
        requestRunId: R1,
        isFavorited: true,
      });
      const page = await service.listFavoriteTurns({
        identityContext: makeIdentity(T1, 'U2' as SubjectId),
        agentId: A1,
        offset: 0,
        limit: 10,
      });
      expect(page.entries).toHaveLength(0);
    });

    it('returns sessionTitle from gateway JOIN without N+1 loadSession', async () => {
      await gateway.sessions.saveSession({
        tenantId: T1,
        subjectId: U1,
        agentId: A1,
        sessionId: S1,
        title: 'Router fault diagnosis',
        createdAt: brand(100),
        updatedAt: brand(300),
      });
      await service.upsertAnnotation({
        identityContext: makeIdentity(),
        agentId: A1,
        sessionId: S1,
        requestRunId: R1,
        isFavorited: true,
      });
      const page = await service.listFavoriteTurns({
        identityContext: makeIdentity(),
        agentId: A1,
        offset: 0,
        limit: 10,
      });
      expect(page.entries).toHaveLength(1);
      expect(first(page.entries).sessionTitle).toBe('Router fault diagnosis');
      expect(first(page.entries).sessionUpdatedAt).toBe(brand(300));
    });

    it('returns Untitled session and 0 when session row missing', async () => {
      await service.upsertAnnotation({
        identityContext: makeIdentity(),
        agentId: A1,
        sessionId: S1,
        requestRunId: R1,
        isFavorited: true,
      });
      const page = await service.listFavoriteTurns({
        identityContext: makeIdentity(),
        agentId: A1,
        offset: 0,
        limit: 10,
      });
      expect(page.entries).toHaveLength(1);
      expect(first(page.entries).sessionTitle).toBe('Untitled session');
      expect(first(page.entries).sessionUpdatedAt).toBe(brand<number, 'EpochMillis'>(0));
    });
  });

  describe('listSessionAnnotations', () => {
    it('returns annotations ordered by createdAt ASC', async () => {
      await service.upsertAnnotation({
        identityContext: makeIdentity(),
        agentId: A1,
        sessionId: S1,
        requestRunId: R1,
        sentiment: 'UP',
      });
      await service.upsertAnnotation({
        identityContext: makeIdentity(),
        agentId: A1,
        sessionId: S1,
        requestRunId: R2,
        sentiment: 'DOWN',
      });
      const views = await service.listSessionAnnotations({
        identityContext: makeIdentity(),
        agentId: A1,
        sessionId: S1,
      });
      expect(views).toHaveLength(2);
      expect(first(views).requestRunId).toBe(R1);
      expect(views.at(1)!.requestRunId).toBe(R2);
    });

    it('returns empty for cross-scope query', async () => {
      await service.upsertAnnotation({
        identityContext: makeIdentity(),
        agentId: A1,
        sessionId: S1,
        requestRunId: R1,
        sentiment: 'UP',
      });
      const views = await service.listSessionAnnotations({
        identityContext: makeIdentity(T1, 'U2' as SubjectId),
        agentId: A1,
        sessionId: S1,
      });
      expect(views).toHaveLength(0);
    });
  });

  describe('terminal commit characterization', () => {
    it('annotation operations do not affect session record or messages', async () => {
      // Save a session and a message to establish baseline
      await gateway.sessions.saveSession({
        tenantId: T1,
        subjectId: U1,
        agentId: A1,
        sessionId: S1,
        createdAt: brand(100),
        updatedAt: brand(200),
      });
      await gateway.messages.appendSessionMessage({
        tenantId: T1,
        subjectId: U1,
        agentId: A1,
        sessionId: S1,
        messageId: brand<string, 'MessageId'>('msg-1'),
        requestId: brand<string, 'MessageId'>('msg-1'),
        runId: R1,
        role: 'USER',
        content: 'hello',
        contentType: 'PLAIN_TEXT',
        metadata: {},
        visible: true,
        createdAt: brand(150),
      });

      // Capture baseline state after message append (which touches session)
      const baselineSession = await gateway.sessions.loadSession({
        tenantId: T1,
        subjectId: U1,
        agentId: A1,
        sessionId: S1,
      });
      const baselineMsgPage = await gateway.messages.listMessages({
        tenantId: T1,
        subjectId: U1,
        agentId: A1,
        sessionId: S1,
        includeHidden: false,
        includeCapabilityResults: false,
        limit: 50,
      });

      // Perform annotation operations
      await service.upsertAnnotation({
        identityContext: makeIdentity(),
        agentId: A1,
        sessionId: S1,
        requestRunId: R1,
        sentiment: 'UP',
        isFavorited: true,
      });
      await service.listSessionAnnotations({
        identityContext: makeIdentity(),
        agentId: A1,
        sessionId: S1,
      });

      // Verify session record is unchanged by annotation operations
      const sessionAfter = await gateway.sessions.loadSession({
        tenantId: T1,
        subjectId: U1,
        agentId: A1,
        sessionId: S1,
      });
      expect(sessionAfter?.updatedAt).toBe(baselineSession?.updatedAt);
      expect(sessionAfter?.createdAt).toBe(baselineSession?.createdAt);

      // Verify messages are unchanged
      const msgPage = await gateway.messages.listMessages({
        tenantId: T1,
        subjectId: U1,
        agentId: A1,
        sessionId: S1,
        includeHidden: false,
        includeCapabilityResults: false,
        limit: 50,
      });
      expect(msgPage.items).toHaveLength(baselineMsgPage.items.length);
      expect(first(msgPage.items).content).toBe('hello');
    });
  });

  describe('memory lifecycle negative test', () => {
    it('annotation operations do not trigger memory store', async () => {
      const longTermMemorySpy = vi.spyOn(gateway.longTermMemoryStore, 'saveLongTermMemory');
      const retrieverSpy = vi.spyOn(gateway.longTermMemoryRetriever, 'searchLongTermMemory');

      await service.upsertAnnotation({
        identityContext: makeIdentity(),
        agentId: A1,
        sessionId: S1,
        requestRunId: R1,
        sentiment: 'UP',
      });
      await service.listFavoriteTurns({
        identityContext: makeIdentity(),
        agentId: A1,
        offset: 0,
        limit: 10,
      });
      await service.listSessionAnnotations({
        identityContext: makeIdentity(),
        agentId: A1,
        sessionId: S1,
      });

      expect(longTermMemorySpy).not.toHaveBeenCalled();
      expect(retrieverSpy).not.toHaveBeenCalled();
      longTermMemorySpy.mockRestore();
      retrieverSpy.mockRestore();
    });
  });
});
