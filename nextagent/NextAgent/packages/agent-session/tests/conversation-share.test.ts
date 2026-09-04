import { createSqliteGatewayStores } from '@nextagent/agent-platform-gateway-local';
import {
  brand,
  type AgentId,
  type EpochMillis,
  type MessageId,
  type RequestRunId,
  type SessionId,
  type SubjectId,
  type TenantId,
} from '@nextagent/agent-common';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type {
  ConversationShareRecord,
  RequestRunRecord,
  RequestRunStoreGateway,
  SessionMessageRecord,
  SessionRecord,
} from '@nextagent/agent-contracts/gateway';
import { ConversationShareService } from '../src/services/conversation-share-service.js';

const T1 = 'T1' as TenantId;
const T2 = 'T2' as TenantId;
const U1 = 'U1' as SubjectId;
const U2 = 'U2' as SubjectId;
const A1 = 'A1' as AgentId;
const A2 = 'A2' as AgentId;
const S1 = 'S1' as SessionId;
const S2 = 'S2' as SessionId;
const R1 = 'R1' as RequestRunId;
const R2 = 'R2' as RequestRunId;
const R3 = 'R3' as RequestRunId;

let ts = 1000;
function clock(): EpochMillis {
  return brand<number, 'EpochMillis'>(ts++);
}

function makeIdentity(tenantId: TenantId = T1, subjectId: SubjectId = U1) {
  return { tenantId, subjectId, displayName: 'test-user' };
}

function makeSessionRecord(overrides: Partial<SessionRecord> = {}): SessionRecord {
  return {
    tenantId: T1,
    subjectId: U1,
    agentId: A1,
    sessionId: S1,
    createdAt: clock(),
    updatedAt: clock(),
    ...overrides,
  };
}

function makeMessageRecord(overrides: Partial<SessionMessageRecord> = {}): SessionMessageRecord {
  return {
    tenantId: T1,
    subjectId: U1,
    agentId: A1,
    messageId: `msg-${ts}` as MessageId,
    sessionId: S1,
    requestId: `req-${ts}` as MessageId,
    runId: R1,
    role: 'USER',
    content: 'test content',
    contentType: 'PLAIN_TEXT',
    metadata: {},
    visible: true,
    createdAt: clock(),
    ...overrides,
  };
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

function isPage(value: unknown): value is { sessionId: SessionId; messages: readonly unknown[]; createdAt: EpochMillis } {
  return typeof value === 'object' && value !== null && 'messages' in value && 'sessionId' in value;
}

/**
 * Persist a frozen share record directly via the gateway, bypassing the
 * service's create-time runId validation. Used by view-path fail-closed tests
 * that need a record for a run which is not a resolvable share unit at create
 * time (no final answer, hidden under an unknown reason, etc.) — those tests
 * assert loadSharedConversation behavior, not createShare behavior.
 */
async function persistShareDirect(
  gateway: ReturnType<typeof createSqliteGatewayStores>,
  options: { sessionId: SessionId; runIds: readonly RequestRunId[]; idempotencyKey: string; allowedOps?: readonly string[] | null },
): Promise<ConversationShareRecord> {
  const record: ConversationShareRecord = {
    tenantId: T1,
    subjectId: U1,
    agentId: A1,
    shareId: '',
    sessionId: options.sessionId,
    runIds: options.runIds,
    originUrl: 'https://host:3000',
    allowedOps: options.allowedOps ?? null,
    expiresAt: null,
    createdAt: clock(),
  };
  const result = await gateway.conversationShares.createShare(record, { idempotencyKey: brand<string, 'IdempotencyKey'>(options.idempotencyKey) });
  if ('code' in result) {
    throw new Error(`persistShareDirect failed: ${result.code}`);
  }
  return result;
}

/**
 * Seed a minimal but complete resolvable share unit (USER question + final
 * ASSISTANT answer + RequestRunRecord) so createShare's runId validation passes
 * and tests can focus on ops/expiration/lifecycle behavior rather than run
 * readability.
 */
async function seedResolvableRun(
  gateway: ReturnType<typeof createSqliteGatewayStores>,
  options: { requestId: MessageId; runId?: RequestRunId },
): Promise<void> {
  const runId = options.runId ?? R1;
  await gateway.messages.appendSessionMessage(makeMessageRecord({ requestId: options.requestId, runId, role: 'USER', content: 'seed question' }));
  await gateway.messages.appendSessionMessage(makeMessageRecord({ requestId: options.requestId, runId, role: 'ASSISTANT', content: 'seed answer' }));
  await gateway.requestRuns.saveRun(makeRunRecord({ runId, requestId: options.requestId }), {});
}

/**
 * Wrap a RequestRunStoreGateway to count listRuns and loadRun calls. Used to
 * assert that ConversationShareService uses a single batch listRuns instead of
 * per-runId loadRun (N+1 elimination).
 */
function createRunStoreSpy(inner: RequestRunStoreGateway) {
  let listRunsCalls = 0;
  let loadRunCalls = 0;
  const store: RequestRunStoreGateway = {
    saveRun: inner.saveRun.bind(inner),
    loadRun: (req) => {
      loadRunCalls++;
      return inner.loadRun(req);
    },
    listRuns: (req) => {
      listRunsCalls++;
      return inner.listRuns(req);
    },
    loadSessionLaneSnapshot: inner.loadSessionLaneSnapshot.bind(inner),
    loadRunByIdempotencyKey: inner.loadRunByIdempotencyKey.bind(inner),
    claimRun: inner.claimRun.bind(inner),
    listRecoverableRuns: inner.listRecoverableRuns.bind(inner),
    commitTerminal: inner.commitTerminal.bind(inner),
  };
  return { store, listRunsCalls: () => listRunsCalls, loadRunCalls: () => loadRunCalls };
}

describe('ConversationShareService', () => {
  let dir: string;
  let gateway: ReturnType<typeof createSqliteGatewayStores>;
  let service: ConversationShareService;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'share-svc-test-'));
    gateway = createSqliteGatewayStores({ sqliteFile: join(dir, 'test.db') });
    service = new ConversationShareService({
      shareStore: gateway.conversationShares,
      messageStore: gateway.messages,
      runStore: gateway.requestRuns,
      clock,
    });
    ts = 1000;
  });

  afterEach(() => {
    gateway.close?.();
    rmSync(dir, { recursive: true, force: true });
  });

  describe('createShare', () => {
    it('returns complete shareUrl with originUrl and shareId', async () => {
      await gateway.sessions.saveSession(makeSessionRecord());
      await seedResolvableRun(gateway, { requestId: 'request-1' as MessageId });
      const result = await service.createShare({
        identityContext: makeIdentity(),
        agentId: A1,
        sessionId: S1,
        runIds: [R1],
        originUrl: 'https://10.0.0.1:3000',
        expiresIn: '7d',
        allowedOps: null,
        idempotencyKey: brand<string, 'IdempotencyKey'>('key-1'),
      });
      expect(result.shareUrl).toMatch(/^https:\/\/10\.0\.0\.1:3000#\/shared\/.+$/);
      expect(result.shareId.length).toBeGreaterThanOrEqual(22);
    });

    it('derives share base from the full session page URL (drops the hash route)', async () => {
      await gateway.sessions.saveSession(makeSessionRecord());
      await seedResolvableRun(gateway, { requestId: 'request-href' as MessageId });
      const result = await service.createShare({
        identityContext: makeIdentity(),
        agentId: A1,
        sessionId: S1,
        runIds: [R1],
        originUrl: 'https://10.0.0.1:3000/AFWebsite/immersive.html#/session/sess-1',
        expiresIn: '7d',
        allowedOps: null,
        idempotencyKey: brand<string, 'IdempotencyKey'>('key-href'),
      });
      // Everything before the fragment is reused verbatim, then the share route is appended.
      // The base is byte-identical to the session URL base, with no extra slash before "#".
      expect(result.shareUrl).toBe('https://10.0.0.1:3000/AFWebsite/immersive.html#/shared/' + result.shareId);
    });

    it('appends the share route directly to a subpath originUrl without a hash', async () => {
      await gateway.sessions.saveSession(makeSessionRecord());
      await seedResolvableRun(gateway, { requestId: 'request-subpath' as MessageId });
      const result = await service.createShare({
        identityContext: makeIdentity(),
        agentId: A1,
        sessionId: S1,
        runIds: [R1],
        originUrl: 'https://10.0.0.1:3000/AFWebsite/immersive.html',
        expiresIn: '7d',
        allowedOps: null,
        idempotencyKey: brand<string, 'IdempotencyKey'>('key-subpath'),
      });
      expect(result.shareUrl).toBe('https://10.0.0.1:3000/AFWebsite/immersive.html#/shared/' + result.shareId);
    });

    it('computes expiresAt for 24h', async () => {
      const beforeTs = ts;
      await gateway.sessions.saveSession(makeSessionRecord());
      await seedResolvableRun(gateway, { requestId: 'request-24h' as MessageId });
      const result = await service.createShare({
        identityContext: makeIdentity(),
        agentId: A1,
        sessionId: S1,
        runIds: [R1],
        originUrl: 'https://host:3000',
        expiresIn: '24h',
        allowedOps: null,
        idempotencyKey: brand<string, 'IdempotencyKey'>('key-24h'),
      });
      const loaded = await gateway.conversationShares.loadShare({ shareId: result.shareId });
      const expiresAt = loaded && 'expiresAt' in loaded ? loaded.expiresAt : null;
      expect(expiresAt).not.toBeNull();
      expect(expiresAt! - beforeTs).toBeGreaterThan(24 * 60 * 60 * 1000);
      expect(expiresAt! - beforeTs).toBeLessThan(24 * 60 * 60 * 1000 + 10000);
    });

    it('sets expiresAt to null for permanent', async () => {
      await gateway.sessions.saveSession(makeSessionRecord());
      await seedResolvableRun(gateway, { requestId: 'request-perm' as MessageId });
      const result = await service.createShare({
        identityContext: makeIdentity(),
        agentId: A1,
        sessionId: S1,
        runIds: [R1],
        originUrl: 'https://host:3000',
        expiresIn: 'permanent',
        allowedOps: null,
        idempotencyKey: brand<string, 'IdempotencyKey'>('key-perm'),
      });
      const loaded = await gateway.conversationShares.loadShare({ shareId: result.shareId });
      expect(loaded && 'expiresAt' in loaded && loaded.expiresAt).toBeNull();
    });

    it('rejects createShare for a non-existent runId instead of producing a dead link', async () => {
      const ghostRunId = 'RUN_DOES_NOT_EXIST' as RequestRunId;
      await gateway.sessions.saveSession(makeSessionRecord());
      // No messages and no run record exist for ghostRunId.

      await expect(
        service.createShare({
          identityContext: makeIdentity(),
          agentId: A1,
          sessionId: S1,
          runIds: [ghostRunId],
          originUrl: 'https://host:3000',
          expiresIn: '7d',
          allowedOps: null,
          idempotencyKey: brand<string, 'IdempotencyKey'>('key-ghost-run'),
        }),
      ).rejects.toMatchObject({ code: 'SHARE_RUN_NOT_RESOLVABLE' });
    });

    it('rejects createShare when any one of several runIds is non-existent', async () => {
      const requestId = 'request-mixed' as MessageId;
      await gateway.sessions.saveSession(makeSessionRecord());
      await gateway.messages.appendSessionMessage(makeMessageRecord({ requestId, runId: R1, role: 'USER', content: 'q' }));
      await gateway.messages.appendSessionMessage(makeMessageRecord({ requestId, runId: R1, role: 'ASSISTANT', content: 'a' }));
      await gateway.requestRuns.saveRun(makeRunRecord({ runId: R1, requestId }), {});
      // R1 is a valid share unit; R2 does not exist.

      await expect(
        service.createShare({
          identityContext: makeIdentity(),
          agentId: A1,
          sessionId: S1,
          runIds: [R1, R2],
          originUrl: 'https://host:3000',
          expiresIn: 'permanent',
          allowedOps: null,
          idempotencyKey: brand<string, 'IdempotencyKey'>('key-mixed'),
        }),
      ).rejects.toMatchObject({ code: 'SHARE_RUN_NOT_RESOLVABLE' });
    });

    it('still creates a share for a fork-generated copied run anchor without a RequestRunRecord', async () => {
      // A copied run anchor has readable messages but no RequestRunRecord — it
      // is a legitimate share target and MUST pass create-time validation.
      const requestId = 'request-copied-anchor' as MessageId;
      await gateway.sessions.saveSession(makeSessionRecord());
      await gateway.messages.appendSessionMessage(makeMessageRecord({ requestId, runId: R1, role: 'USER', content: 'copied question' }));
      await gateway.messages.appendSessionMessage(makeMessageRecord({ requestId, runId: R1, role: 'ASSISTANT', content: 'copied answer' }));
      // Deliberately do NOT saveRun(R1) — simulates a fork-copied anchor.

      const share = await service.createShare({
        identityContext: makeIdentity(),
        agentId: A1,
        sessionId: S1,
        runIds: [R1],
        originUrl: 'https://host:3000',
        expiresIn: 'permanent',
        allowedOps: null,
        idempotencyKey: brand<string, 'IdempotencyKey'>('key-copied-anchor-create'),
      });

      const result = await service.loadSharedConversation({ shareId: share.shareId, viewerOps: null });
      expect(isPage(result)).toBe(true);
    });
  });

  describe('loadSharedConversation', () => {
    it('returns messages for shared runIds using creator scope (cross-scope read)', async () => {
      const requestId = 'request-cross-scope' as MessageId;
      await gateway.sessions.saveSession(makeSessionRecord());
      await gateway.messages.appendSessionMessage(makeMessageRecord({ requestId, runId: R1, role: 'USER', content: 'user question' }));
      await gateway.messages.appendSessionMessage(makeMessageRecord({ requestId, runId: R1, role: 'ASSISTANT', content: 'assistant answer' }));
      await gateway.messages.appendSessionMessage(makeMessageRecord({ runId: R2, role: 'USER', content: 'other run' }));
      await gateway.requestRuns.saveRun(makeRunRecord({ runId: R1, requestId }), {});

      const share = await service.createShare({
        identityContext: makeIdentity(),
        agentId: A1,
        sessionId: S1,
        runIds: [R1],
        originUrl: 'https://host:3000',
        expiresIn: 'permanent',
        allowedOps: null,
        idempotencyKey: brand<string, 'IdempotencyKey'>('key-cross'),
      });

      const result = await service.loadSharedConversation({ shareId: share.shareId, viewerOps: null });
      expect(isPage(result)).toBe(true);
      if (isPage(result)) {
        expect(result.messages.length).toBe(2);
        expect(result.messages.every((m) => 'content' in m)).toBe(true);
      }
    });

    it('only returns messages for runIds snapshot, not other runs', async () => {
      const requestOne = 'request-filter-1' as MessageId;
      const requestTwo = 'request-filter-2' as MessageId;
      await gateway.sessions.saveSession(makeSessionRecord());
      await gateway.messages.appendSessionMessage(makeMessageRecord({ requestId: requestOne, runId: R1, content: 'R1 question' }));
      await gateway.messages.appendSessionMessage(makeMessageRecord({ requestId: requestOne, runId: R1, role: 'ASSISTANT', content: 'R1 answer' }));
      await gateway.messages.appendSessionMessage(makeMessageRecord({ requestId: requestTwo, runId: R2, content: 'R2 question' }));
      await gateway.messages.appendSessionMessage(makeMessageRecord({ requestId: requestTwo, runId: R2, role: 'ASSISTANT', content: 'R2 answer' }));
      await gateway.messages.appendSessionMessage(makeMessageRecord({ runId: R3, content: 'R3 msg' }));
      await gateway.requestRuns.saveRun(makeRunRecord({ runId: R1, requestId: requestOne }), {});
      await gateway.requestRuns.saveRun(makeRunRecord({ runId: R2, requestId: requestTwo }), {});

      const share = await service.createShare({
        identityContext: makeIdentity(),
        agentId: A1,
        sessionId: S1,
        runIds: [R1, R2],
        originUrl: 'https://host:3000',
        expiresIn: 'permanent',
        allowedOps: null,
        idempotencyKey: brand<string, 'IdempotencyKey'>('key-filter'),
      });

      const result = await service.loadSharedConversation({ shareId: share.shareId, viewerOps: null });
      expect(isPage(result)).toBe(true);
      if (isPage(result)) {
        expect(result.messages.length).toBe(4);
      }
    });

    it('returns the canonical user question with only the selected retry attempt answer', async () => {
      const requestId = 'request-retry' as MessageId;
      await gateway.sessions.saveSession(makeSessionRecord());
      await gateway.messages.appendSessionMessage(
        makeMessageRecord({
          messageId: 'question-retry' as MessageId,
          requestId,
          runId: R1,
          role: 'USER',
          content: 'original question',
        }),
      );
      await gateway.messages.appendSessionMessage(
        makeMessageRecord({
          messageId: 'answer-attempt-1' as MessageId,
          requestId,
          runId: R1,
          role: 'ASSISTANT',
          content: 'old answer',
        }),
      );
      await gateway.messages.appendSessionMessage(
        makeMessageRecord({
          messageId: 'answer-attempt-2' as MessageId,
          requestId,
          runId: R2,
          role: 'ASSISTANT',
          content: 'retry answer',
        }),
      );
      await gateway.requestRuns.saveRun(makeRunRecord({ runId: R1, requestId }), {});
      await gateway.requestRuns.saveRun(
        makeRunRecord({
          runId: R2,
          requestId,
          attempt: 2,
          retryOfRunId: R1,
        }),
        {},
      );

      const share = await service.createShare({
        identityContext: makeIdentity(),
        agentId: A1,
        sessionId: S1,
        runIds: [R2],
        originUrl: 'https://host:3000',
        expiresIn: 'permanent',
        allowedOps: null,
        idempotencyKey: brand<string, 'IdempotencyKey'>('key-retry-attempt'),
      });

      const result = await service.loadSharedConversation({ shareId: share.shareId, viewerOps: null });
      expect(isPage(result)).toBe(true);
      if (isPage(result)) {
        expect(result.messages.map((message) => (message as { content: string }).content)).toEqual(['original question', 'retry answer']);
      }
    });

    it('resolves a copied retry answer to the canonical user in the same request without leaking other attempts', async () => {
      const requestId = 'request-copied-retry' as MessageId;
      await gateway.sessions.saveSession(makeSessionRecord());
      await gateway.messages.appendSessionMessage(
        makeMessageRecord({
          messageId: 'question-copied-retry' as MessageId,
          requestId,
          runId: R1,
          role: 'USER',
          content: 'copied question',
          visible: false,
          metadata: { visibility: { reason: 'EDIT_REPLACED' } },
        }),
      );
      await gateway.messages.appendSessionMessage(
        makeMessageRecord({
          messageId: 'old-answer-copied-retry' as MessageId,
          requestId,
          runId: R1,
          role: 'ASSISTANT',
          content: 'old copied answer',
          visible: false,
          metadata: { visibility: { reason: 'RETRY_REPLACED' } },
        }),
      );
      await gateway.messages.appendSessionMessage(
        makeMessageRecord({
          messageId: 'selected-answer-copied-retry' as MessageId,
          requestId,
          runId: R2,
          role: 'ASSISTANT',
          content: 'selected copied retry answer',
          visible: false,
          metadata: { visibility: { reason: 'RETRY_REPLACED' } },
        }),
      );

      const share = await service.createShare({
        identityContext: makeIdentity(),
        agentId: A1,
        sessionId: S1,
        runIds: [R2],
        originUrl: 'https://host:3000',
        expiresIn: 'permanent',
        allowedOps: null,
        idempotencyKey: brand<string, 'IdempotencyKey'>('key-copied-retry-attempt'),
      });

      const result = await service.loadSharedConversation({ shareId: share.shareId, viewerOps: null });
      expect(isPage(result)).toBe(true);
      if (isPage(result)) {
        expect(result.messages.map((message) => (message as { content: string }).content)).toEqual([
          'copied question',
          'selected copied retry answer',
        ]);
      }
    });

    it('keeps a frozen attempt readable after retry replacement hides its answer', async () => {
      const requestId = 'request-frozen-retry' as MessageId;
      const answerId = 'answer-frozen-retry' as MessageId;
      await gateway.sessions.saveSession(makeSessionRecord());
      await gateway.messages.appendSessionMessage(
        makeMessageRecord({
          messageId: 'question-frozen-retry' as MessageId,
          requestId,
          runId: R1,
          role: 'USER',
          content: 'frozen question',
        }),
      );
      await gateway.messages.appendSessionMessage(
        makeMessageRecord({
          messageId: answerId,
          requestId,
          runId: R1,
          role: 'ASSISTANT',
          content: 'frozen answer',
        }),
      );
      await gateway.requestRuns.saveRun(makeRunRecord({ runId: R1, requestId }), {});

      const share = await service.createShare({
        identityContext: makeIdentity(),
        agentId: A1,
        sessionId: S1,
        runIds: [R1],
        originUrl: 'https://host:3000',
        expiresIn: 'permanent',
        allowedOps: null,
        idempotencyKey: brand<string, 'IdempotencyKey'>('key-frozen-retry'),
      });
      await gateway.messages.hideMessage({
        tenantId: T1,
        subjectId: U1,
        agentId: A1,
        messageId: answerId,
        reason: 'RETRY_REPLACED',
        hiddenByContextId: brand<string, 'RequestContextId'>('ctx-retry'),
        idempotencyKey: brand<string, 'IdempotencyKey'>('hide-retry'),
      });

      const result = await service.loadSharedConversation({ shareId: share.shareId, viewerOps: null });
      expect(isPage(result)).toBe(true);
      if (isPage(result)) {
        expect(result.messages.map((message) => (message as { content: string }).content)).toEqual(['frozen question', 'frozen answer']);
        expect(result.messages.every((message) => (message as { visible: boolean }).visible)).toBe(true);
        expect(result.messages.every((message) => (message as { metadata: Record<string, unknown> }).metadata.visibility === undefined)).toBe(true);
      }
      const durableMessages = await gateway.messages.listMessages({
        tenantId: T1,
        subjectId: U1,
        agentId: A1,
        sessionId: S1,
        includeHidden: true,
        includeCapabilityResults: true,
        limit: 200,
      });
      expect(durableMessages.items.find((message) => message.messageId === answerId)?.visible).toBe(false);
    });

    it('excludes ordinary capability results from an edit-replaced read-only share projection', async () => {
      const requestId = 'request-frozen-edit' as MessageId;
      await gateway.sessions.saveSession(makeSessionRecord());
      await gateway.messages.appendSessionMessage(
        makeMessageRecord({
          messageId: 'question-frozen-edit' as MessageId,
          requestId,
          runId: R1,
          role: 'USER',
          content: 'edit source question',
        }),
      );
      await gateway.messages.appendSessionMessage(
        makeMessageRecord({
          messageId: 'tool-use-frozen-edit' as MessageId,
          requestId,
          runId: R1,
          role: 'ASSISTANT',
          content: JSON.stringify({
            content: 'I will inspect the private file.',
            toolCalls: [
              {
                toolCallId: 'read-frozen-edit',
                capabilityId: 'Read',
                arguments: { file_path: '/private/share-tool-use-secret.txt' },
              },
            ],
          }),
          metadata: {
            kind: 'ASSISTANT_TOOL_USE',
            toolCallIds: ['read-frozen-edit'],
          },
        }),
      );
      await gateway.messages.appendSessionMessage(
        makeMessageRecord({
          messageId: 'capability-frozen-edit' as MessageId,
          requestId,
          runId: R1,
          role: 'CAPABILITY_RESULT',
          content: JSON.stringify({
            toolCallId: 'read-frozen-edit',
            toolName: 'Read',
            payload: {
              file_path: '/private/share-secret.txt',
              content: 'SECRET_SHARED_CAPABILITY_RESULT',
            },
          }),
          metadata: {
            kind: 'CAPABILITY_RESULT',
            toolCallId: 'read-frozen-edit',
            toolName: 'Read',
            arguments: { file_path: '/private/share-argument.txt' },
            rawPayload: { content: 'SECRET_SHARED_METADATA' },
          },
        }),
      );
      await gateway.messages.appendSessionMessage(
        makeMessageRecord({
          messageId: 'answer-frozen-edit' as MessageId,
          requestId,
          runId: R1,
          role: 'ASSISTANT',
          content: 'edit source answer',
        }),
      );
      await gateway.requestRuns.saveRun(makeRunRecord({ runId: R1, requestId }), {});
      const share = await service.createShare({
        identityContext: makeIdentity(),
        agentId: A1,
        sessionId: S1,
        runIds: [R1],
        originUrl: 'https://host:3000',
        expiresIn: 'permanent',
        allowedOps: null,
        idempotencyKey: brand<string, 'IdempotencyKey'>('key-frozen-edit'),
      });
      await gateway.messages.hideRequestMessages({
        tenantId: T1,
        subjectId: U1,
        agentId: A1,
        sessionId: S1,
        requestId,
        reason: 'EDIT_REPLACED',
        hiddenByContextId: brand<string, 'RequestContextId'>('ctx-edit'),
      });

      const result = await service.loadSharedConversation({ shareId: share.shareId, viewerOps: null });
      expect(isPage(result)).toBe(true);
      if (isPage(result)) {
        expect(result.messages.map((message) => (message as { role: string }).role)).toEqual(['USER', 'ASSISTANT']);
        expect(result.messages.map((message) => (message as { content: string }).content)).toEqual(['edit source question', 'edit source answer']);
        expect(JSON.stringify(result)).not.toContain('SECRET_SHARED_CAPABILITY_RESULT');
        expect(JSON.stringify(result)).not.toContain('SECRET_SHARED_METADATA');
        expect(JSON.stringify(result)).not.toContain('/private/share-secret.txt');
        expect(JSON.stringify(result)).not.toContain('/private/share-argument.txt');
        expect(JSON.stringify(result)).not.toContain('/private/share-tool-use-secret.txt');
        expect(result.messages.every((message) => (message as { visible: boolean }).visible)).toBe(true);
      }

      const durableMessages = await gateway.messages.listMessages({
        tenantId: T1,
        subjectId: U1,
        agentId: A1,
        sessionId: S1,
        includeHidden: true,
        includeCapabilityResults: true,
        limit: 200,
      });
      const durableCapabilityResult = durableMessages.items.find((message) => message.messageId === 'capability-frozen-edit');
      expect(durableCapabilityResult?.content).toContain('SECRET_SHARED_CAPABILITY_RESULT');
      expect(durableCapabilityResult?.metadata).toMatchObject({
        rawPayload: { content: 'SECRET_SHARED_METADATA' },
      });
    });

    it('rejects createShare when any selected run is not a complete question-answer unit', async () => {
      const requestOne = 'request-complete' as MessageId;
      const requestTwo = 'request-incomplete' as MessageId;
      await gateway.sessions.saveSession(makeSessionRecord());
      await gateway.messages.appendSessionMessage(
        makeMessageRecord({
          messageId: 'question-complete' as MessageId,
          requestId: requestOne,
          runId: R1,
          role: 'USER',
          content: 'complete question',
        }),
      );
      await gateway.messages.appendSessionMessage(
        makeMessageRecord({
          messageId: 'answer-complete' as MessageId,
          requestId: requestOne,
          runId: R1,
          role: 'ASSISTANT',
          content: 'complete answer',
        }),
      );
      await gateway.messages.appendSessionMessage(
        makeMessageRecord({
          messageId: 'question-incomplete' as MessageId,
          requestId: requestTwo,
          runId: R2,
          role: 'USER',
          content: 'question without answer',
        }),
      );
      await gateway.requestRuns.saveRun(makeRunRecord({ runId: R1, requestId: requestOne }), {});
      await gateway.requestRuns.saveRun(makeRunRecord({ runId: R2, requestId: requestTwo }), {});

      // R2 has a USER but no assistant answer — not a resolvable share unit, so
      // the whole createShare is rejected at create time rather than producing a
      // dead link that only fails on view.
      await expect(
        service.createShare({
          identityContext: makeIdentity(),
          agentId: A1,
          sessionId: S1,
          runIds: [R1, R2],
          originUrl: 'https://host:3000',
          expiresIn: 'permanent',
          allowedOps: null,
          idempotencyKey: brand<string, 'IdempotencyKey'>('key-partial-unit'),
        }),
      ).rejects.toMatchObject({ code: 'SHARE_RUN_NOT_RESOLVABLE' });
    });

    it('does not treat an assistant tool-use protocol message as a final answer', async () => {
      const requestId = 'request-tool-use-only' as MessageId;
      await gateway.sessions.saveSession(makeSessionRecord());
      await gateway.messages.appendSessionMessage(
        makeMessageRecord({
          messageId: 'question-tool-use-only' as MessageId,
          requestId,
          runId: R1,
          role: 'USER',
          content: 'question without a final answer',
        }),
      );
      await gateway.messages.appendSessionMessage(
        makeMessageRecord({
          messageId: 'assistant-tool-use-only' as MessageId,
          requestId,
          runId: R1,
          role: 'ASSISTANT',
          content: JSON.stringify({
            content: 'I will call a tool.',
            toolCalls: [
              {
                toolCallId: 'tool-use-only',
                capabilityId: 'Read',
                arguments: { file_path: '/private/tool-use-only.txt' },
              },
            ],
          }),
          metadata: {
            kind: 'ASSISTANT_TOOL_USE',
            toolCallIds: ['tool-use-only'],
          },
        }),
      );
      await gateway.requestRuns.saveRun(makeRunRecord({ runId: R1, requestId }), {});
      // A run whose only assistant message is a tool-use protocol message has no
      // final answer, so createShare rejects it at create time. Persist the
      // frozen record directly to verify the view path still fails closed and
      // never leaks the tool-use protocol content.
      const share = await persistShareDirect(gateway, {
        sessionId: S1,
        runIds: [R1],
        idempotencyKey: 'key-tool-use-only',
      });

      const result = await service.loadSharedConversation({ shareId: share.shareId, viewerOps: null });
      expect(result).toMatchObject({ code: 'SHARE_CONTENT_DELETED' });
      expect(JSON.stringify(result)).not.toContain('/private/tool-use-only.txt');
    });

    it('does not expose guard-blocked content through a frozen share', async () => {
      const requestId = 'request-guard-blocked' as MessageId;
      const answerId = 'answer-guard-blocked' as MessageId;
      await gateway.sessions.saveSession(makeSessionRecord());
      await gateway.messages.appendSessionMessage(
        makeMessageRecord({
          messageId: 'question-guard-blocked' as MessageId,
          requestId,
          runId: R1,
          role: 'USER',
          content: 'guarded question',
        }),
      );
      await gateway.messages.appendSessionMessage(
        makeMessageRecord({
          messageId: answerId,
          requestId,
          runId: R1,
          role: 'ASSISTANT',
          content: 'unsafe answer',
        }),
      );
      await gateway.requestRuns.saveRun(makeRunRecord({ runId: R1, requestId }), {});
      const share = await service.createShare({
        identityContext: makeIdentity(),
        agentId: A1,
        sessionId: S1,
        runIds: [R1],
        originUrl: 'https://host:3000',
        expiresIn: 'permanent',
        allowedOps: null,
        idempotencyKey: brand<string, 'IdempotencyKey'>('key-guard-blocked'),
      });
      await gateway.messages.hideMessage({
        tenantId: T1,
        subjectId: U1,
        agentId: A1,
        messageId: answerId,
        reason: 'GUARD_BLOCKED',
        hiddenByContextId: brand<string, 'RequestContextId'>('ctx-guard'),
        idempotencyKey: brand<string, 'IdempotencyKey'>('hide-guard'),
      });

      const result = await service.loadSharedConversation({ shareId: share.shareId, viewerOps: null });
      expect(result).toMatchObject({ code: 'SHARE_CONTENT_DELETED' });
    });

    it('fails closed for an unknown hidden reason', async () => {
      const requestId = 'request-unknown-hidden' as MessageId;
      await gateway.sessions.saveSession(makeSessionRecord());
      await gateway.messages.appendSessionMessage(
        makeMessageRecord({
          messageId: 'question-unknown-hidden' as MessageId,
          requestId,
          runId: R1,
          role: 'USER',
          content: 'hidden question',
        }),
      );
      await gateway.messages.appendSessionMessage(
        makeMessageRecord({
          messageId: 'answer-unknown-hidden' as MessageId,
          requestId,
          runId: R1,
          role: 'ASSISTANT',
          content: 'must remain hidden',
          visible: false,
          metadata: { visibility: { reason: 'UNKNOWN_REASON' } },
        }),
      );
      await gateway.requestRuns.saveRun(makeRunRecord({ runId: R1, requestId }), {});
      // The answer is hidden under an unknown reason at share time, so the run
      // is not a readable share unit and createShare would reject it. Persist
      // the frozen record directly to verify the view path fails closed for an
      // unrecognized hidden reason rather than leaking the hidden content.
      const share = await persistShareDirect(gateway, {
        sessionId: S1,
        runIds: [R1],
        idempotencyKey: 'key-unknown-hidden',
      });

      const result = await service.loadSharedConversation({ shareId: share.shareId, viewerOps: null });
      expect(result).toMatchObject({ code: 'SHARE_CONTENT_DELETED' });
    });

    it('does not satisfy a share from another owner scope or parent session', async () => {
      const requestId = 'request-outside-scope' as MessageId;
      await gateway.sessions.saveSession(makeSessionRecord());
      await gateway.sessions.saveSession(
        makeSessionRecord({
          tenantId: T2,
          subjectId: U2,
          sessionId: S1,
        }),
      );
      await gateway.sessions.saveSession(makeSessionRecord({ agentId: A2 }));
      await gateway.sessions.saveSession(makeSessionRecord({ sessionId: S2 }));
      await gateway.messages.appendSessionMessage(
        makeMessageRecord({
          tenantId: T2,
          subjectId: U2,
          messageId: 'question-other-owner' as MessageId,
          requestId,
          runId: R1,
          role: 'USER',
          content: 'other owner question',
        }),
      );
      await gateway.messages.appendSessionMessage(
        makeMessageRecord({
          tenantId: T2,
          subjectId: U2,
          messageId: 'answer-other-owner' as MessageId,
          requestId,
          runId: R1,
          role: 'ASSISTANT',
          content: 'other owner answer',
        }),
      );
      await gateway.messages.appendSessionMessage(
        makeMessageRecord({
          agentId: A2,
          messageId: 'question-other-agent' as MessageId,
          requestId,
          runId: R1,
          role: 'USER',
          content: 'other agent question',
        }),
      );
      await gateway.messages.appendSessionMessage(
        makeMessageRecord({
          agentId: A2,
          messageId: 'answer-other-agent' as MessageId,
          requestId,
          runId: R1,
          role: 'ASSISTANT',
          content: 'other agent answer',
        }),
      );
      await gateway.messages.appendSessionMessage(
        makeMessageRecord({
          sessionId: S2,
          messageId: 'question-parent' as MessageId,
          requestId,
          runId: R1,
          role: 'USER',
          content: 'parent question',
        }),
      );
      await gateway.messages.appendSessionMessage(
        makeMessageRecord({
          sessionId: S2,
          messageId: 'answer-parent' as MessageId,
          requestId,
          runId: R1,
          role: 'ASSISTANT',
          content: 'parent answer',
        }),
      );
      await gateway.requestRuns.saveRun(
        makeRunRecord({
          runId: R1,
          requestId,
          sessionId: S2,
        }),
        {},
      );
      // R1 belongs to another owner scope / agent / parent session, so it does
      // not resolve under the creator's (T1, U1, A1, S1) scope. createShare
      // rejects at create time — no cross-scope dead link is ever stored.
      await expect(
        service.createShare({
          identityContext: makeIdentity(),
          agentId: A1,
          sessionId: S1,
          runIds: [R1],
          originUrl: 'https://host:3000',
          expiresIn: 'permanent',
          allowedOps: null,
          idempotencyKey: brand<string, 'IdempotencyKey'>('key-outside-scope'),
        }),
      ).rejects.toMatchObject({ code: 'SHARE_RUN_NOT_RESOLVABLE' });
    });

    it('returns SHARE_EXPIRED when share is past expiration', async () => {
      await gateway.sessions.saveSession(makeSessionRecord());
      await seedResolvableRun(gateway, { requestId: 'request-expired' as MessageId });
      const share = await service.createShare({
        identityContext: makeIdentity(),
        agentId: A1,
        sessionId: S1,
        runIds: [R1],
        originUrl: 'https://host:3000',
        expiresIn: '24h',
        allowedOps: null,
        idempotencyKey: brand<string, 'IdempotencyKey'>('key-expired'),
      });

      // Advance clock past expiry
      ts = 1000 + 25 * 60 * 60 * 1000;
      const result = await service.loadSharedConversation({ shareId: share.shareId, viewerOps: null });
      expect(typeof result === 'object' && result !== null && 'code' in result && (result as { code: string }).code).toBe('SHARE_EXPIRED');
    });

    it('returns SHARE_FORBIDDEN when viewerOps is null but allowedOps is set', async () => {
      await gateway.sessions.saveSession(makeSessionRecord());
      await seedResolvableRun(gateway, { requestId: 'request-forbidden' as MessageId });
      const share = await service.createShare({
        identityContext: makeIdentity(),
        agentId: A1,
        sessionId: S1,
        runIds: [R1],
        originUrl: 'https://host:3000',
        expiresIn: 'permanent',
        allowedOps: ['hashH'],
        idempotencyKey: brand<string, 'IdempotencyKey'>('key-forbidden'),
      });

      const result = await service.loadSharedConversation({ shareId: share.shareId, viewerOps: null });
      expect(typeof result === 'object' && result !== null && 'code' in result && (result as { code: string }).code).toBe('SHARE_FORBIDDEN');
    });

    it('returns SHARE_FORBIDDEN when viewerOps hash does not match allowedOps hash', async () => {
      await gateway.sessions.saveSession(makeSessionRecord());
      await seedResolvableRun(gateway, { requestId: 'request-forbidden2' as MessageId });
      const share = await service.createShare({
        identityContext: makeIdentity(),
        agentId: A1,
        sessionId: S1,
        runIds: [R1],
        originUrl: 'https://host:3000',
        expiresIn: 'permanent',
        allowedOps: ['hashH1'],
        idempotencyKey: brand<string, 'IdempotencyKey'>('key-forbidden2'),
      });

      const result = await service.loadSharedConversation({ shareId: share.shareId, viewerOps: ['hashH2'] });
      expect(typeof result === 'object' && result !== null && 'code' in result && (result as { code: string }).code).toBe('SHARE_FORBIDDEN');
    });

    it('returns SHARE_FORBIDDEN when viewerOps is empty array but allowedOps is set', async () => {
      await gateway.sessions.saveSession(makeSessionRecord());
      await seedResolvableRun(gateway, { requestId: 'request-empty-ops' as MessageId });
      const share = await service.createShare({
        identityContext: makeIdentity(),
        agentId: A1,
        sessionId: S1,
        runIds: [R1],
        originUrl: 'https://host:3000',
        expiresIn: 'permanent',
        allowedOps: ['hashH'],
        idempotencyKey: brand<string, 'IdempotencyKey'>('key-empty-ops'),
      });

      const result = await service.loadSharedConversation({ shareId: share.shareId, viewerOps: [] });
      expect(typeof result === 'object' && result !== null && 'code' in result && (result as { code: string }).code).toBe('SHARE_FORBIDDEN');
    });

    it('passes ops check when viewerOps hash matches allowedOps hash', async () => {
      const requestId = 'request-ops-ok' as MessageId;
      await gateway.sessions.saveSession(makeSessionRecord());
      await gateway.messages.appendSessionMessage(makeMessageRecord({ requestId, runId: R1 }));
      await gateway.messages.appendSessionMessage(makeMessageRecord({ requestId, runId: R1, role: 'ASSISTANT' }));
      await gateway.requestRuns.saveRun(makeRunRecord({ runId: R1, requestId }), {});

      const share = await service.createShare({
        identityContext: makeIdentity(),
        agentId: A1,
        sessionId: S1,
        runIds: [R1],
        originUrl: 'https://host:3000',
        expiresIn: 'permanent',
        allowedOps: ['hashH'],
        idempotencyKey: brand<string, 'IdempotencyKey'>('key-ops-ok'),
      });

      const result = await service.loadSharedConversation({ shareId: share.shareId, viewerOps: ['hashH'] });
      expect(isPage(result)).toBe(true);
    });

    it('rejects createShare when the run has no messages (no dead link)', async () => {
      await gateway.sessions.saveSession(makeSessionRecord());
      // No messages inserted for R1 — the run does not exist as a shareable unit.

      await expect(
        service.createShare({
          identityContext: makeIdentity(),
          agentId: A1,
          sessionId: S1,
          runIds: [R1],
          originUrl: 'https://host:3000',
          expiresIn: 'permanent',
          allowedOps: null,
          idempotencyKey: brand<string, 'IdempotencyKey'>('key-deleted'),
        }),
      ).rejects.toMatchObject({ code: 'SHARE_RUN_NOT_RESOLVABLE' });
    });

    it('returns SHARE_NOT_FOUND for non-existent shareId', async () => {
      const result = await service.loadSharedConversation({ shareId: 'nonexistent', viewerOps: null });
      expect(typeof result === 'object' && result !== null && 'code' in result && (result as { code: string }).code).toBe('SHARE_NOT_FOUND');
    });

    it('public share with null allowedOps passes without ops', async () => {
      const requestId = 'request-public' as MessageId;
      await gateway.sessions.saveSession(makeSessionRecord());
      await gateway.messages.appendSessionMessage(makeMessageRecord({ requestId, runId: R1 }));
      await gateway.messages.appendSessionMessage(makeMessageRecord({ requestId, runId: R1, role: 'ASSISTANT' }));
      await gateway.requestRuns.saveRun(makeRunRecord({ runId: R1, requestId }), {});

      const share = await service.createShare({
        identityContext: makeIdentity(),
        agentId: A1,
        sessionId: S1,
        runIds: [R1],
        originUrl: 'https://host:3000',
        expiresIn: 'permanent',
        allowedOps: null,
        idempotencyKey: brand<string, 'IdempotencyKey'>('key-public'),
      });

      const result = await service.loadSharedConversation({ shareId: share.shareId, viewerOps: null });
      expect(isPage(result)).toBe(true);
    });
  });

  describe('createShare does not affect request lifecycle', () => {
    it('creating a share does not modify session or messages', async () => {
      await gateway.sessions.saveSession(makeSessionRecord());
      await seedResolvableRun(gateway, { requestId: 'request-no-effect' as MessageId });

      const sessionBefore = await gateway.sessions.loadSession({ tenantId: T1, subjectId: U1, agentId: A1, sessionId: S1 });
      await service.createShare({
        identityContext: makeIdentity(),
        agentId: A1,
        sessionId: S1,
        runIds: [R1],
        originUrl: 'https://host:3000',
        expiresIn: 'permanent',
        allowedOps: null,
        idempotencyKey: brand<string, 'IdempotencyKey'>('key-no-effect'),
      });
      const sessionAfter = await gateway.sessions.loadSession({ tenantId: T1, subjectId: U1, agentId: A1, sessionId: S1 });

      expect(sessionAfter?.updatedAt).toBe(sessionBefore?.updatedAt);
    });
  });

  describe('batch listRuns query (N+1 elimination)', () => {
    it('createShare calls listRuns once and loadRun zero times for multiple runIds', async () => {
      const spy = createRunStoreSpy(gateway.requestRuns);
      const spyService = new ConversationShareService({
        shareStore: gateway.conversationShares,
        messageStore: gateway.messages,
        runStore: spy.store,
        clock,
      });

      await gateway.sessions.saveSession(makeSessionRecord());
      await seedResolvableRun(gateway, { requestId: 'request-batch-1' as MessageId, runId: R1 });
      await seedResolvableRun(gateway, { requestId: 'request-batch-2' as MessageId, runId: R2 });
      await seedResolvableRun(gateway, { requestId: 'request-batch-3' as MessageId, runId: R3 });

      await spyService.createShare({
        identityContext: makeIdentity(),
        agentId: A1,
        sessionId: S1,
        runIds: [R1, R2, R3],
        originUrl: 'https://host:3000',
        expiresIn: 'permanent',
        allowedOps: null,
        idempotencyKey: brand<string, 'IdempotencyKey'>('key-batch-create'),
      });

      expect(spy.listRunsCalls()).toBe(1);
      expect(spy.loadRunCalls()).toBe(0);
    });

    it('loadSharedConversation calls listRuns once and loadRun zero times', async () => {
      await gateway.sessions.saveSession(makeSessionRecord());
      await seedResolvableRun(gateway, { requestId: 'request-batch-view-1' as MessageId, runId: R1 });
      await seedResolvableRun(gateway, { requestId: 'request-batch-view-2' as MessageId, runId: R2 });

      const share = await service.createShare({
        identityContext: makeIdentity(),
        agentId: A1,
        sessionId: S1,
        runIds: [R1, R2],
        originUrl: 'https://host:3000',
        expiresIn: 'permanent',
        allowedOps: null,
        idempotencyKey: brand<string, 'IdempotencyKey'>('key-batch-view-create'),
      });

      const spy = createRunStoreSpy(gateway.requestRuns);
      const spyService = new ConversationShareService({
        shareStore: gateway.conversationShares,
        messageStore: gateway.messages,
        runStore: spy.store,
        clock,
      });

      const result = await spyService.loadSharedConversation({ shareId: share.shareId, viewerOps: null });
      expect(isPage(result)).toBe(true);

      expect(spy.listRunsCalls()).toBe(1);
      expect(spy.loadRunCalls()).toBe(0);
    });

    it('fork copied run anchor fallback still works with batch listRuns (no RequestRunRecord)', async () => {
      const requestId = 'request-batch-fork' as MessageId;
      await gateway.sessions.saveSession(makeSessionRecord());
      await gateway.messages.appendSessionMessage(makeMessageRecord({ requestId, runId: R1, role: 'USER', content: 'fork question' }));
      await gateway.messages.appendSessionMessage(makeMessageRecord({ requestId, runId: R1, role: 'ASSISTANT', content: 'fork answer' }));
      // Deliberately do NOT saveRun(R1) — simulates a fork-copied anchor.

      const result = await service.createShare({
        identityContext: makeIdentity(),
        agentId: A1,
        sessionId: S1,
        runIds: [R1],
        originUrl: 'https://host:3000',
        expiresIn: 'permanent',
        allowedOps: null,
        idempotencyKey: brand<string, 'IdempotencyKey'>('key-batch-fork'),
      });
      // createShare succeeds because the fork anchor resolves via message fallback
      const page = await service.loadSharedConversation({ shareId: result.shareId, viewerOps: null });
      expect(isPage(page)).toBe(true);
      if (isPage(page)) {
        expect(page.messages.length).toBe(2);
        expect(page.messages[0]!.role).toBe('USER');
        expect(page.messages[1]!.role).toBe('ASSISTANT');
      }
    });

    it('cross-session run is rejected with batch listRuns (same scope, different session)', async () => {
      await gateway.sessions.saveSession(makeSessionRecord());
      await gateway.sessions.saveSession(makeSessionRecord({ sessionId: S2 }));
      // R1 is saved under S2, not S1 — listRuns returns it (same scope) but
      // resolveShareUnit rejects it because run.sessionId !== scope.sessionId.
      await gateway.requestRuns.saveRun(makeRunRecord({ runId: R1, requestId: 'request-cross-session' as MessageId, sessionId: S2 }), {});

      await expect(
        service.createShare({
          identityContext: makeIdentity(),
          agentId: A1,
          sessionId: S1,
          runIds: [R1],
          originUrl: 'https://host:3000',
          expiresIn: 'permanent',
          allowedOps: null,
          idempotencyKey: brand<string, 'IdempotencyKey'>('key-batch-cross-session'),
        }),
      ).rejects.toMatchObject({ code: 'SHARE_RUN_NOT_RESOLVABLE' });
    });
  });
});
