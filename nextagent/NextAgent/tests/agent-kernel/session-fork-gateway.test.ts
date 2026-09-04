import { brand, type EpochMillis, type MessageId, type RequestRunId } from '@nextagent/agent-common';
import { createForkActiveContextSelector } from '@nextagent/agent-context-engine';
import type { SessionMessageRecord, SessionRecord } from '@nextagent/agent-contracts/gateway';
import { createSqliteGatewayStores } from '@nextagent/agent-platform-gateway-local';
import { createTestGatewayStores } from '../fixtures/local-gateway.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const tenantId = brand<string, 'TenantId'>('tenant-fork-gateway');
const subjectId = brand<string, 'SubjectId'>('subject-fork-gateway');
const agentId = brand<string, 'AgentId'>('agent-fork-gateway');
const sourceSessionId = brand<string, 'SessionId'>('source-session');

function at(value: number): EpochMillis {
  return brand<number, 'EpochMillis'>(value);
}

function session(title = 'Source title'): SessionRecord {
  return { tenantId, subjectId, agentId, sessionId: sourceSessionId, title, createdAt: at(1), updatedAt: at(1) };
}

function message(overrides: Partial<SessionMessageRecord> = {}): SessionMessageRecord {
  return {
    tenantId,
    subjectId,
    agentId,
    sessionId: sourceSessionId,
    messageId: brand<string, 'MessageId'>('source-user'),
    requestId: brand<string, 'MessageId'>('source-user'),
    role: 'USER',
    content: 'hello',
    contentType: 'PLAIN_TEXT',
    metadata: {},
    visible: true,
    createdAt: at(1),
    ...overrides,
  };
}

async function seedSimpleFork(gateway: ReturnType<typeof createTestGatewayStores>): Promise<MessageId> {
  const anchor = brand<string, 'MessageId'>('source-answer');
  await gateway.sessions.saveSession(session());
  await gateway.messages.appendSessionMessage(message());
  await gateway.messages.appendSessionMessage(message({ messageId: anchor, role: 'ASSISTANT', content: 'answer', createdAt: at(2) }));
  return anchor;
}

async function saveTerminalRun(gateway: ReturnType<typeof createTestGatewayStores>, runId: RequestRunId, requestId: MessageId): Promise<void> {
  await gateway.requestRuns.saveRun(
    {
      tenantId,
      subjectId,
      agentId,
      runId,
      sessionId: sourceSessionId,
      requestId,
      agentVersion: brand<string, 'AgentVersion'>('v1'),
      agentAssemblyRef: 'agent-fork-gateway:v1',
      attempt: 1,
      status: 'COMPLETED',
      version: 1,
      terminalCommitState: 'COMMITTED',
      createdAt: at(1),
      updatedAt: at(2),
    },
    {},
  );
}

describe('session fork gateway-local provider application', () => {
  it('materializes all 100 conversation turns through the selected assistant anchor', async () => {
    const gateway = createTestGatewayStores();
    await gateway.sessions.saveSession(session('100 turn source'));
    let anchor = brand<string, 'MessageId'>('unused-anchor');
    for (let turn = 1; turn <= 100; turn += 1) {
      const requestId = brand<string, 'MessageId'>(`request-${turn}`);
      await gateway.messages.appendSessionMessage(
        message({
          messageId: requestId,
          requestId,
          content: `question ${turn}`,
          createdAt: at(turn * 2),
        }),
      );
      anchor = brand<string, 'MessageId'>(`answer-${turn}`);
      await gateway.messages.appendSessionMessage(
        message({
          messageId: anchor,
          requestId,
          role: 'ASSISTANT',
          content: `answer ${turn}`,
          metadata: { eventType: 'REQUEST_COMPLETED', status: 'COMPLETED' },
          createdAt: at(turn * 2 + 1),
        }),
      );
    }
    const coordinates = {
      tenantId,
      subjectId,
      agentId,
      sourceSessionId,
      sourceMessageId: anchor,
      idempotencyKey: brand<string, 'IdempotencyKey'>('fork-100-turns'),
    } as const;
    const prepared = await gateway.sessionForks.prepareFork(coordinates);
    const created = await gateway.sessionForks.forkSession({ ...coordinates, forkAttemptId: prepared.forkAttemptId });
    const firstPage = await gateway.messages.listMessages({
      tenantId,
      subjectId,
      agentId,
      sessionId: created.childSession.sessionId,
      includeHidden: true,
      includeCapabilityResults: true,
      limit: 200,
    });
    expect(firstPage.items).toHaveLength(200);
    expect(firstPage.hasMore).toBe(false);
    expect(firstPage.items[0]?.content).toBe('question 1');
    expect(firstPage.items.at(-1)?.content).toBe('answer 100');
  });

  it('prepares and atomically materializes the complete prefix with child-owned context', async () => {
    const gateway = createTestGatewayStores();
    const anchor = await seedSimpleFork(gateway);
    const coordinates = {
      tenantId,
      subjectId,
      agentId,
      sourceSessionId,
      sourceMessageId: anchor,
      idempotencyKey: brand<string, 'IdempotencyKey'>('fork-key'),
    } as const;

    const prepared = await gateway.sessionForks.prepareFork(coordinates);
    expect(prepared.requiredContentRefs).toEqual([]);
    expect(prepared.maxPromotedBytes).toBe(2_000_000);
    const created = await gateway.sessionForks.forkSession({ ...coordinates, forkAttemptId: prepared.forkAttemptId });
    expect(created.replayed).toBe(false);
    expect(created.childSession).toMatchObject({ title: 'Fork · Source title', agentId });

    const copied = await gateway.messages.listMessages({
      tenantId,
      subjectId,
      agentId,
      sessionId: created.childSession.sessionId,
      includeHidden: true,
      includeCapabilityResults: true,
      limit: 10,
    });
    expect(copied.items.map((item) => item.content)).toEqual(['hello', 'answer']);
    expect(copied.items.every((item) => item.metadata['forkInherited'] === true)).toBe(true);
    await expect(
      gateway.activeContext.loadActiveContext({ tenantId, subjectId, agentId, sessionId: created.childSession.sessionId }),
    ).resolves.toMatchObject({ state: { activeContextVersion: 0 }, items: [{}, {}] });
    await expect(
      gateway.sessionForks.loadSessionForkSource({ tenantId, subjectId, agentId, childSessionId: created.childSession.sessionId }),
    ).resolves.toMatchObject({ sourceSessionId, sourceAnchorMessageId: anchor, sourceSessionTitleSnapshot: 'Source title' });
  });

  it('preserves durable attachment metadata across recursive forks and survives source deletion', async () => {
    const gateway = createTestGatewayStores();
    await gateway.sessions.saveSession(session());
    await gateway.messages.appendSessionMessage(message({ metadata: { attachmentIds: ['attachment-1'] } }));
    const anchor = brand<string, 'MessageId'>('source-answer-recursive');
    await gateway.messages.appendSessionMessage(message({ messageId: anchor, role: 'ASSISTANT', content: 'answer', createdAt: at(2) }));
    const firstCoordinates = {
      tenantId,
      subjectId,
      agentId,
      sourceSessionId,
      sourceMessageId: anchor,
      idempotencyKey: brand<string, 'IdempotencyKey'>('fork-recursive-first'),
    } as const;
    const firstPrepared = await gateway.sessionForks.prepareFork(firstCoordinates);
    const child = await gateway.sessionForks.forkSession({
      ...firstCoordinates,
      forkAttemptId: firstPrepared.forkAttemptId,
    });
    const childSource = await gateway.sessionForks.loadSessionForkSource({
      tenantId,
      subjectId,
      agentId,
      childSessionId: child.childSession.sessionId,
    });
    expect(childSource).toBeDefined();
    const secondCoordinates = {
      tenantId,
      subjectId,
      agentId,
      sourceSessionId: child.childSession.sessionId,
      sourceMessageId: childSource!.childAnchorMessageId,
      idempotencyKey: brand<string, 'IdempotencyKey'>('fork-recursive-second'),
    } as const;
    const secondPrepared = await gateway.sessionForks.prepareFork(secondCoordinates);
    const grandchild = await gateway.sessionForks.forkSession({
      ...secondCoordinates,
      forkAttemptId: secondPrepared.forkAttemptId,
    });

    await gateway.sessions.deleteSessionCascade({ tenantId, subjectId, agentId, sessionId: sourceSessionId });
    await expect(gateway.sessions.loadSession({ tenantId, subjectId, agentId, sessionId: child.childSession.sessionId })).resolves.toBeDefined();
    const copied = await gateway.messages.listMessages({
      tenantId,
      subjectId,
      agentId,
      sessionId: grandchild.childSession.sessionId,
      includeHidden: true,
      includeCapabilityResults: true,
      limit: 10,
    });
    expect(copied.items[0]?.metadata).toMatchObject({ attachmentIds: ['attachment-1'], forkInherited: true });
    expect(copied.items.every((item) => item.metadata['forkInherited'] === true)).toBe(true);
  });

  it('materializes source process history as child-owned snapshots', async () => {
    const gateway = createTestGatewayStores();
    const requestId = brand<string, 'MessageId'>('source-request-snapshot');
    const runId = brand<string, 'RequestRunId'>('source-run-snapshot');
    const anchor = brand<string, 'MessageId'>('source-answer-snapshot');
    await gateway.sessions.saveSession(session());
    await saveTerminalRun(gateway, runId, requestId);
    await gateway.messages.appendSessionMessage(message({ messageId: requestId, requestId, runId }));
    await gateway.messages.appendSessionMessage(
      message({ messageId: anchor, requestId, runId, role: 'ASSISTANT', content: 'answer', createdAt: at(4) }),
    );
    for (const event of [
      {
        eventId: 'source-thinking-final',
        type: 'LLM_THINKING_DELTA' as const,
        inlinePayload: { reasoning: 'checked routes', stepId: 'model:1', completed: true },
        createdAt: at(2),
      },
      {
        eventId: 'source-terminal',
        type: 'REQUEST_COMPLETED' as const,
        inlinePayload: { requestId, rootMessageId: requestId, runId },
        createdAt: at(3),
      },
    ]) {
      await gateway.timeline.appendEvent({
        tenantId,
        subjectId,
        agentId,
        agentVersion: brand<string, 'AgentVersion'>('v1'),
        eventId: event.eventId,
        sessionId: sourceSessionId,
        requestId,
        runId,
        requestContextId: brand<string, 'RequestContextId'>('source-context-snapshot'),
        sequence: brand<number, 'TimelineSequence'>(0),
        type: event.type,
        inlinePayload: event.inlinePayload,
        createdAt: event.createdAt,
      });
    }
    const coordinates = {
      tenantId,
      subjectId,
      agentId,
      sourceSessionId,
      sourceMessageId: anchor,
      idempotencyKey: brand<string, 'IdempotencyKey'>('fork-snapshot-key'),
    } as const;
    const prepared = await gateway.sessionForks.prepareFork(coordinates);
    const child = await gateway.sessionForks.forkSession({ ...coordinates, forkAttemptId: prepared.forkAttemptId });
    const copied = await gateway.messages.listMessages({
      tenantId,
      subjectId,
      agentId,
      sessionId: child.childSession.sessionId,
      includeHidden: true,
      includeCapabilityResults: true,
      limit: 10,
    });
    const childRunId = copied.items[0]!.runId!;
    const childRequestId = copied.items[0]!.requestId;
    const snapshots = await gateway.timeline.listEvents({
      tenantId,
      subjectId,
      agentId,
      sessionId: child.childSession.sessionId,
      runId: childRunId,
      recordOrigin: 'FORK_SNAPSHOT',
      afterSequence: brand<number, 'TimelineSequence'>(0),
      limit: 10,
    });
    expect(snapshots).toHaveLength(2);
    expect(snapshots[1]).toMatchObject({
      requestId: childRequestId,
      runId: childRunId,
      recordOrigin: 'FORK_SNAPSHOT',
      inlinePayload: { requestId: childRequestId, rootMessageId: childRequestId, runId: childRunId },
    });
    expect(snapshots.every((event) => event.requestContextId === undefined && event.contentRef === undefined)).toBe(true);
    await expect(
      gateway.sessionForks.loadForkProcessSnapshotStatus({
        tenantId,
        subjectId,
        agentId,
        sessionId: child.childSession.sessionId,
        runId: childRunId,
      }),
    ).resolves.toMatchObject({ requestId: childRequestId, status: 'AVAILABLE' });
  });

  it('resolves request anchors inside the provider and rejects zero or multiple completed assistants', async () => {
    const gateway = createTestGatewayStores();
    const requestId = brand<string, 'MessageId'>('request-anchor');
    await gateway.sessions.saveSession(session());
    await gateway.messages.appendSessionMessage(message({ messageId: requestId, requestId }));
    const coordinates = {
      tenantId,
      subjectId,
      agentId,
      sourceSessionId,
      sourceRequestId: requestId,
      idempotencyKey: brand<string, 'IdempotencyKey'>('request-key'),
    } as const;
    await expect(gateway.sessionForks.prepareFork(coordinates)).rejects.toMatchObject({ code: 'SESSION_FORK_REQUEST_ANCHOR_NOT_FOUND' });
    for (const suffix of ['1', '2']) {
      await gateway.messages.appendSessionMessage(
        message({
          messageId: brand<string, 'MessageId'>(`answer-${suffix}`),
          requestId,
          role: 'ASSISTANT',
          content: `answer ${suffix}`,
          metadata: { eventType: 'REQUEST_COMPLETED', status: 'COMPLETED' },
          createdAt: at(Number(suffix) + 1),
        }),
      );
    }
    await expect(gateway.sessionForks.prepareFork(coordinates)).rejects.toMatchObject({ code: 'SESSION_FORK_REQUEST_ANCHOR_AMBIGUOUS' });
  });

  it('discovers, idempotently stages and commits normalized tool-result content', async () => {
    const gateway = createTestGatewayStores();
    const requestId = brand<string, 'MessageId'>('source-request-ref');
    const runId = brand<string, 'RequestRunId'>('source-run-ref');
    const anchor = brand<string, 'MessageId'>('source-answer-ref');
    await gateway.sessions.saveSession(session());
    await saveTerminalRun(gateway, runId, requestId);
    await gateway.messages.appendSessionMessage(message({ messageId: requestId, requestId, runId }));
    await gateway.messages.appendSessionMessage(
      message({
        messageId: anchor,
        requestId,
        runId,
        role: 'ASSISTANT',
        content: 'Result: workspace/tool-results/result-1',
        createdAt: at(3),
      }),
    );
    const coordinates = {
      tenantId,
      subjectId,
      agentId,
      sourceSessionId,
      sourceMessageId: anchor,
      idempotencyKey: brand<string, 'IdempotencyKey'>('fork-ref-key'),
    } as const;
    const prepared = await gateway.sessionForks.prepareFork(coordinates);
    expect(prepared.requiredContentRefs).toEqual([
      expect.objectContaining({ sourceMessageId: anchor, sourceRequestId: requestId, sourceRunId: runId, refId: 'tool-results/result-1' }),
    ]);
    const stageRequest = {
      tenantId,
      subjectId,
      agentId,
      forkAttemptId: prepared.forkAttemptId,
      sourceSessionId,
      sourceMessageId: anchor,
      sourceRefId: 'tool-results/result-1',
      refType: 'CAPABILITY_RESULT' as const,
      bytes: new Uint8Array([1, 2, 3]),
      mimeType: 'text/plain',
      sizeBytes: 3,
    };
    const first = await gateway.sessionForks.stageForkPromotion(stageRequest);
    await expect(gateway.sessionForks.stageForkPromotion(stageRequest)).resolves.toEqual(first);
    await expect(gateway.sessionForks.stageForkPromotion({ ...stageRequest, bytes: new Uint8Array([9, 9, 9]) })).rejects.toMatchObject({
      code: 'SESSION_FORK_PROMOTION_CONFLICT',
    });

    const result = await gateway.sessionForks.forkSession({ ...coordinates, forkAttemptId: prepared.forkAttemptId });
    const copied = await gateway.messages.listMessages({
      tenantId,
      subjectId,
      agentId,
      sessionId: result.childSession.sessionId,
      includeHidden: true,
      includeCapabilityResults: true,
      limit: 10,
    });
    const copiedAnchor = copied.items.at(-1)!;
    expect(copiedAnchor.content).toContain(first.promotedContentId);
    expect(copiedAnchor.content).not.toContain('tool-results/result-1');
    await expect(
      gateway.sessionForks.loadCommittedForkPromotionContent({
        tenantId,
        subjectId,
        agentId,
        childSessionId: result.childSession.sessionId,
        childMessageId: copiedAnchor.messageId,
        promotedContentId: first.promotedContentId,
      }),
    ).resolves.toEqual({ refType: 'CAPABILITY_RESULT', bytes: new Uint8Array([1, 2, 3]), mimeType: 'text/plain', sizeBytes: 3 });
    await gateway.sessionForks.abortForkPromotions({ tenantId, subjectId, agentId, forkAttemptId: prepared.forkAttemptId });
    await expect(gateway.sessionForks.cleanupExpiredForkPromotions({ now: at(Date.now() + 1_000), retentionMs: 0 })).resolves.toEqual({
      cleanedCount: 0,
      retryableCount: 0,
    });
    await expect(
      gateway.sessionForks.loadCommittedForkPromotionContent({
        tenantId,
        subjectId,
        agentId,
        childSessionId: result.childSession.sessionId,
        childMessageId: copiedAnchor.messageId,
        promotedContentId: first.promotedContentId,
      }),
    ).resolves.toBeDefined();

    const residueCoordinates = {
      ...coordinates,
      idempotencyKey: brand<string, 'IdempotencyKey'>('fork-ref-residue'),
    };
    const residuePrepared = await gateway.sessionForks.prepareFork(residueCoordinates);
    await gateway.sessionForks.stageForkPromotion({ ...stageRequest, forkAttemptId: residuePrepared.forkAttemptId });
    await gateway.sessionForks.abortForkPromotions({
      tenantId,
      subjectId,
      agentId,
      forkAttemptId: residuePrepared.forkAttemptId,
    });
    await expect(gateway.sessionForks.cleanupExpiredForkPromotions({ now: at(Date.now() + 1_000), retentionMs: 0 })).resolves.toEqual({
      cleanedCount: 1,
      retryableCount: 0,
    });
  });

  it('fails closed for unsupported execution paths and promotion ref overflow', async () => {
    const unsupportedGateway = createTestGatewayStores();
    await unsupportedGateway.sessions.saveSession(session());
    const unsupportedAnchor = brand<string, 'MessageId'>('unsupported-anchor');
    await unsupportedGateway.messages.appendSessionMessage(
      message({ messageId: unsupportedAnchor, role: 'ASSISTANT', content: 'C:\\temp\\secret.txt', createdAt: at(2) }),
    );
    await expect(
      unsupportedGateway.sessionForks.prepareFork({
        tenantId,
        subjectId,
        agentId,
        sourceSessionId,
        sourceMessageId: unsupportedAnchor,
        idempotencyKey: brand<string, 'IdempotencyKey'>('unsupported-path'),
      }),
    ).rejects.toMatchObject({ code: 'SESSION_FORK_EXECUTION_BOUND_CONTENT' });

    const overflowGateway = createTestGatewayStores();
    const requestId = brand<string, 'MessageId'>('overflow-request');
    const runId = brand<string, 'RequestRunId'>('overflow-run');
    const overflowAnchor = brand<string, 'MessageId'>('overflow-anchor');
    await overflowGateway.sessions.saveSession(session());
    await saveTerminalRun(overflowGateway, runId, requestId);
    await overflowGateway.messages.appendSessionMessage(message({ messageId: requestId, requestId, runId }));
    await overflowGateway.messages.appendSessionMessage(
      message({
        messageId: overflowAnchor,
        requestId,
        runId,
        role: 'ASSISTANT',
        content: Array.from({ length: 9 }, (_, index) => `tool-results/result-${index}`).join(' '),
        createdAt: at(3),
      }),
    );
    await expect(
      overflowGateway.sessionForks.prepareFork({
        tenantId,
        subjectId,
        agentId,
        sourceSessionId,
        sourceMessageId: overflowAnchor,
        idempotencyKey: brand<string, 'IdempotencyKey'>('overflow-refs'),
      }),
    ).rejects.toMatchObject({ code: 'SESSION_FORK_PROMOTION_LIMIT_EXCEEDED' });
  });

  it('rejects staging when the source message is not owned by the claimed source session', async () => {
    const gateway = createTestGatewayStores();
    const sourceMessageWithRef = brand<string, 'MessageId'>('source-message-with-ref');
    await gateway.sessions.saveSession(session());
    await gateway.messages.appendSessionMessage(
      message({
        messageId: sourceMessageWithRef,
        role: 'ASSISTANT',
        content: 'workspace/tool-results/result-cross-session',
      }),
    );
    await expect(
      gateway.sessionForks.stageForkPromotion({
        tenantId,
        subjectId,
        agentId,
        forkAttemptId: brand<string, 'ForkAttemptId'>('attempt-cross-session'),
        sourceSessionId: brand<string, 'SessionId'>('another-source-session'),
        sourceMessageId: sourceMessageWithRef,
        sourceRefId: 'tool-results/result-cross-session',
        refType: 'CAPABILITY_RESULT',
        bytes: new Uint8Array([1]),
        mimeType: 'text/plain',
        sizeBytes: 1,
      }),
    ).rejects.toMatchObject({ code: 'SESSION_FORK_PROMOTION_SOURCE_UNAVAILABLE' });
  });

  it('fails closed for incomplete staging and leaves no visible child', async () => {
    const gateway = createTestGatewayStores();
    const requestId = brand<string, 'MessageId'>('source-request-missing-stage');
    const runId = brand<string, 'RequestRunId'>('source-run-missing-stage');
    const anchor = brand<string, 'MessageId'>('source-answer-missing-stage');
    await gateway.sessions.saveSession(session());
    await saveTerminalRun(gateway, runId, requestId);
    await gateway.messages.appendSessionMessage(message({ messageId: requestId, requestId, runId }));
    await gateway.messages.appendSessionMessage(
      message({ messageId: anchor, requestId, runId, role: 'ASSISTANT', content: 'tool-results/missing', createdAt: at(3) }),
    );
    const coordinates = {
      tenantId,
      subjectId,
      agentId,
      sourceSessionId,
      sourceMessageId: anchor,
      idempotencyKey: brand<string, 'IdempotencyKey'>('missing-stage-key'),
    } as const;
    const prepared = await gateway.sessionForks.prepareFork(coordinates);
    await expect(gateway.sessionForks.forkSession({ ...coordinates, forkAttemptId: prepared.forkAttemptId })).rejects.toMatchObject({
      code: 'SESSION_FORK_PROMOTION_UNAVAILABLE',
    });
    const sessions = await gateway.sessions.listSessions({ tenantId, subjectId, agentId, offset: 0, limit: 20 });
    expect(sessions.entries).toHaveLength(1);
  });

  it('returns the first child for successful idempotency replay, including after reopen', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'nextagent-fork-replay-'));
    const sqliteFile = join(directory, 'fork.sqlite');
    const selector = createForkActiveContextSelector();
    const first = createSqliteGatewayStores({ sqliteFile, forkActiveContextSelector: selector });
    try {
      await first.sessions.saveSession(session());
      await first.messages.appendSessionMessage(message());
      const anchor = brand<string, 'MessageId'>('source-answer-replay');
      await first.messages.appendSessionMessage(message({ messageId: anchor, role: 'ASSISTANT', content: 'answer', createdAt: at(2) }));
      const coordinates = {
        tenantId,
        subjectId,
        agentId,
        sourceSessionId,
        sourceMessageId: anchor,
        idempotencyKey: brand<string, 'IdempotencyKey'>('replay-key'),
      } as const;
      const prepared = await first.sessionForks.prepareFork(coordinates);
      const created = await first.sessionForks.forkSession({ ...coordinates, forkAttemptId: prepared.forkAttemptId });
      first.close?.();
      const reopened = createSqliteGatewayStores({ sqliteFile, forkActiveContextSelector: selector });
      try {
        const replayPrepare = await reopened.sessionForks.prepareFork(coordinates);
        expect(replayPrepare.requiredContentRefs).toEqual([]);
        await expect(reopened.sessionForks.forkSession({ ...coordinates, forkAttemptId: replayPrepare.forkAttemptId })).resolves.toEqual({
          childSession: created.childSession,
          replayed: true,
        });
      } finally {
        reopened.close?.();
      }
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('converges concurrent attempts with the same idempotency key on one child', async () => {
    const gateway = createTestGatewayStores();
    const anchor = await seedSimpleFork(gateway);
    const coordinates = {
      tenantId,
      subjectId,
      agentId,
      sourceSessionId,
      sourceMessageId: anchor,
      idempotencyKey: brand<string, 'IdempotencyKey'>('concurrent-key'),
    } as const;
    const [firstPrepared, secondPrepared] = await Promise.all([
      gateway.sessionForks.prepareFork(coordinates),
      gateway.sessionForks.prepareFork(coordinates),
    ]);
    const results = await Promise.all([
      gateway.sessionForks.forkSession({ ...coordinates, forkAttemptId: firstPrepared.forkAttemptId }),
      gateway.sessionForks.forkSession({ ...coordinates, forkAttemptId: secondPrepared.forkAttemptId }),
    ]);
    expect(new Set(results.map((item) => item.childSession.sessionId))).toHaveLength(1);
    expect(results.map((item) => item.replayed).sort()).toEqual([false, true]);
    const sessions = await gateway.sessions.listSessions({ tenantId, subjectId, agentId, offset: 0, limit: 10 });
    expect(sessions.entries).toHaveLength(2);
  });
});
