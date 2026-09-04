import { afterEach, describe, expect, it } from 'vitest';
import {
  cleanupP1P2GateContext,
  createP1P2GateContext,
  createShare,
  readSharedConversation,
  submitRequest,
  waitForTerminalCommit,
  type P1P2GateContext,
} from './helpers.js';
import { recordCaseResult } from './case-inventory.js';

describe('p1-p2 scenario gate: conversation share', () => {
  let ctx: P1P2GateContext | undefined;

  afterEach(async () => {
    if (ctx !== undefined) {
      await cleanupP1P2GateContext(ctx);
      ctx = undefined;
    }
  });

  it('creates and reads a shared conversation over the real web and persistence path', async () => {
    try {
      ctx = await createP1P2GateContext({
        modelSteps: [{ content: '第一轮共享回答。' }, { content: '第二轮权限回答。' }],
      });

      const first = await submitRequest(ctx, {
        inputText: '第一轮共享问题。',
        idempotencyKey: `p1p2-share-first-${crypto.randomUUID()}`,
      });
      await waitForTerminalCommit(ctx, first.runId);

      const second = await submitRequest(ctx, {
        sessionId: first.sessionId,
        inputText: '第二轮权限问题。',
        idempotencyKey: `p1p2-share-second-${crypto.randomUUID()}`,
      });
      await waitForTerminalCommit(ctx, second.runId);

      const publicShare = await createShare(ctx, first.sessionId, {
        runIds: [first.runId],
        originUrl: ctx.baseUrl,
        expiresIn: 'permanent',
        allowedOps: null,
      });
      expect(publicShare.shareUrl).toBe(`${ctx.baseUrl}#/shared/${publicShare.shareId}`);

      const publicResponse = await readSharedConversation(ctx, publicShare.shareId);
      expect(publicResponse.status).toBe(200);
      const publicBody = (await publicResponse.json()) as {
        readonly sessionId: string;
        readonly messages: Array<{ readonly runId?: string; readonly role: string; readonly content: string }>;
      };
      expect(publicBody.sessionId).toBe(first.sessionId);
      expect(publicBody.messages.length).toBeGreaterThanOrEqual(2);
      expect(publicBody.messages.every((message) => message.runId === first.runId)).toBe(true);
      expect(publicBody.messages.some((message) => message.content === '第一轮共享问题。')).toBe(true);
      expect(publicBody.messages.some((message) => message.content === '第一轮共享回答。')).toBe(true);
      expect(publicBody.messages.some((message) => message.content === '第二轮权限问题。')).toBe(false);
      expect(publicBody.messages.some((message) => message.content === '第二轮权限回答。')).toBe(false);

      const restrictedShare = await createShare(ctx, first.sessionId, {
        runIds: [second.runId],
        originUrl: `${ctx.baseUrl}/immersive.html#/session/${first.sessionId}`,
        expiresIn: '7d',
        allowedOps: ['hashH'],
      });
      expect(restrictedShare.shareUrl).toBe(`${ctx.baseUrl}/immersive.html#/shared/${restrictedShare.shareId}`);

      const forbiddenResponse = await readSharedConversation(ctx, restrictedShare.shareId, ['hashH2']);
      expect(forbiddenResponse.status).toBe(403);
      const forbiddenBody = (await forbiddenResponse.json()) as { readonly error: { readonly code: string } };
      expect(forbiddenBody.error.code).toBe('SHARE_FORBIDDEN');

      const allowedResponse = await readSharedConversation(ctx, restrictedShare.shareId, ['hashH']);
      expect(allowedResponse.status).toBe(200);
      const allowedBody = (await allowedResponse.json()) as {
        readonly messages: Array<{ readonly runId?: string; readonly content: string }>;
      };
      expect(allowedBody.messages.length).toBeGreaterThanOrEqual(2);
      expect(allowedBody.messages.every((message) => message.runId === second.runId)).toBe(true);
      expect(allowedBody.messages.some((message) => message.content === '第二轮权限问题。')).toBe(true);
      expect(allowedBody.messages.some((message) => message.content === '第二轮权限回答。')).toBe(true);

      recordCaseResult('e2e-P1P2-06', 'PASSED', {
        evidenceRefs: ['evidence://p1-p2/conversation-share/create-share', 'evidence://p1-p2/conversation-share/shared-view'],
      });
    } catch (error) {
      recordCaseResult('e2e-P1P2-06', 'FAILED', {
        safeReason: 'conversation share gate case failed',
        evidenceRefs: ['evidence://p1-p2/conversation-share/failure'],
      });
      throw error;
    }
  }, 20_000);
});
