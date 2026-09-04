import { afterAll, describe, expect, it } from 'vitest';
import { createE2ETestContext, cleanupE2ETestContext } from '../e2e-helpers.js';
import { recordCaseResult } from './case-inventory.js';

describe('alpha-01: minimal Q&A main flow', () => {
  it('creates a session, submits a question, receives SSE stream, and reads history', async () => {
    const startedAt = new Date().toISOString();
    const ctx = await createE2ETestContext({
      modelSteps: [{ contentChunks: ['LTE KPIs', ' are within healthy range.'] }],
      tempPrefix: 'nextagent-akg-01-',
    });
    try {
      const { baseUrl } = ctx;

      const createSessionResp = await fetch(`${baseUrl}/api/v1/sessions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      });
      expect(createSessionResp.status).toBe(200);
      const session = (await createSessionResp.json()) as { sessionId: string };
      expect(session.sessionId).toBeTruthy();

      const accepted = await fetch(`${baseUrl}/api/v1/requests`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          inputText: 'Check LTE KPI health.',
          sessionId: session.sessionId,
          idempotencyKey: `alpha-01-a-${crypto.randomUUID()}`,
        }),
      });
      expect(accepted.status).toBe(200);
      const body = (await accepted.json()) as { sessionId: string; requestId: string; runId: string; attempt: number };
      expect(body.sessionId).toBe(session.sessionId);
      expect(body.requestId).toBeTruthy();
      expect(body.runId).toBeTruthy();
      expect(body.attempt).toBe(1);

      const stream = await fetch(`${baseUrl}/api/v1/sessions/${body.sessionId}/stream?lastSeenSequence=0&runId=${body.runId}`);
      expect(stream.status).toBe(200);
      const streamBody = await stream.text();
      expect(streamBody).toContain('event: REQUEST_ACCEPTED');
      expect(streamBody).toContain('event: REQUEST_COMPLETED');
      expect(streamBody).toContain('LTE KPIs are within healthy range.');

      const conversation = await fetch(`${baseUrl}/api/v1/sessions/${body.sessionId}/conversation?limit=10`);
      expect(conversation.status).toBe(200);
      const history = (await conversation.json()) as { items: Array<{ role: string; content: string }> };
      expect(history.items.map((item) => item.role)).toEqual(['USER', 'ASSISTANT']);
      expect(history.items.at(-1)?.content.length).toBeGreaterThan(0);

      recordCaseResult('alpha-01', 'PASSED', { startedAt, endedAt: new Date().toISOString() });
    } catch (error) {
      recordCaseResult('alpha-01', 'FAILED', {
        safeReason: error instanceof Error ? error.message : String(error),
        startedAt,
        endedAt: new Date().toISOString(),
      });
    } finally {
      await cleanupE2ETestContext(ctx);
    }
  }, 30_000);

  it('auto-creates a session when submitting without sessionId', async () => {
    const startedAt = new Date().toISOString();
    const ctx = await createE2ETestContext({
      modelSteps: [{ contentChunks: ['Hello world'] }],
      tempPrefix: 'nextagent-akg-01b-',
    });
    try {
      const { baseUrl } = ctx;

      const accepted = await fetch(`${baseUrl}/api/v1/requests`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          inputText: 'Hello.',
          idempotencyKey: `alpha-01-b-${crypto.randomUUID()}`,
        }),
      });
      expect(accepted.status).toBe(200);
      const body = (await accepted.json()) as { sessionId: string; requestId: string; runId: string };
      expect(body.sessionId).toBeTruthy();

      const stream = await fetch(`${baseUrl}/api/v1/sessions/${body.sessionId}/stream?lastSeenSequence=0&runId=${body.runId}`);
      expect(stream.status).toBe(200);
      const streamBody = await stream.text();
      expect(streamBody).toContain('event: REQUEST_COMPLETED');

      const conversation = await fetch(`${baseUrl}/api/v1/sessions/${body.sessionId}/conversation?limit=10`);
      expect(conversation.status).toBe(200);
      const history = (await conversation.json()) as { items: Array<{ role: string }> };
      expect(history.items.length).toBeGreaterThanOrEqual(2);
    } catch (error) {
      recordCaseResult('alpha-01', 'FAILED', {
        safeReason: error instanceof Error ? error.message : String(error),
        startedAt,
        endedAt: new Date().toISOString(),
      });
    } finally {
      await cleanupE2ETestContext(ctx);
    }
  }, 30_000);
});
