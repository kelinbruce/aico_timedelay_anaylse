import { afterAll, describe, expect, it } from 'vitest';
import { createE2ETestContext, cleanupE2ETestContext } from '../e2e-helpers.js';
import { recordCaseResult } from './case-inventory.js';

describe('alpha-05: idempotent convenience submit', () => {
  it('reuses the same session and run for repeated submit idempotency', async () => {
    const startedAt = new Date().toISOString();
    const ctx = await createE2ETestContext({
      modelSteps: [{ contentChunks: ['first idempotent answer'] }, { contentChunks: ['unexpected duplicate answer'] }],
      tempPrefix: 'nextagent-akg-05-',
    });
    try {
      const { baseUrl } = ctx;
      const payload = { inputText: 'same user request', idempotencyKey: `alpha-05-${crypto.randomUUID()}` };

      const first = await fetch(`${baseUrl}/api/v1/requests`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      expect(first.status).toBe(200);
      const firstBody = (await first.json()) as { sessionId: string; requestId: string; runId: string };
      expect(firstBody.sessionId).toBeTruthy();
      expect(firstBody.requestId).toBeTruthy();
      expect(firstBody.runId).toBeTruthy();

      const second = await fetch(`${baseUrl}/api/v1/requests`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      expect(second.status).toBe(200);
      const secondBody = (await second.json()) as { sessionId: string; requestId: string; runId: string };
      expect(secondBody).toEqual(firstBody);

      const stream = await fetch(`${baseUrl}/api/v1/sessions/${firstBody.sessionId}/stream?lastSeenSequence=0&runId=${firstBody.runId}`);
      const streamBody = await stream.text();
      expect(streamBody).toContain('event: REQUEST_COMPLETED');
      expect(streamBody).toContain('first idempotent answer');
      expect(streamBody).not.toContain('unexpected duplicate answer');

      const sessions = await fetch(`${baseUrl}/api/v1/sessions?offset=0&limit=10`);
      expect(sessions.status).toBe(200);
      const sessionPage = (await sessions.json()) as { entries: Array<{ sessionId: string }> };
      expect(sessionPage.entries.filter((entry) => entry.sessionId === firstBody.sessionId)).toHaveLength(1);

      const conversation = await fetch(`${baseUrl}/api/v1/sessions/${firstBody.sessionId}/conversation?limit=10`);
      expect(conversation.status).toBe(200);
      const conversationBody = (await conversation.json()) as {
        items: Array<{ role: string; content?: string; messageId?: string; runId?: string }>;
      };
      expect(conversationBody.items.filter((item) => item.role === 'USER' && item.messageId === firstBody.requestId)).toHaveLength(1);
      expect(conversationBody.items.filter((item) => item.role === 'ASSISTANT' && item.runId === firstBody.runId)).toHaveLength(1);
      expect(JSON.stringify(conversationBody)).not.toContain('unexpected duplicate answer');

      recordCaseResult('alpha-05', 'PASSED', { startedAt, endedAt: new Date().toISOString() });
    } catch (error) {
      recordCaseResult('alpha-05', 'FAILED', {
        safeReason: error instanceof Error ? error.message : String(error),
        startedAt,
        endedAt: new Date().toISOString(),
      });
    } finally {
      await cleanupE2ETestContext(ctx);
    }
  }, 30_000);
});
