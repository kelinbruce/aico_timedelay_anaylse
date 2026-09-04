import { afterAll, describe, expect, it } from 'vitest';
import { createE2ETestContext, cleanupE2ETestContext } from '../e2e-helpers.js';
import { recordCaseResult } from './case-inventory.js';

describe('alpha-02: SSE canonical sequence', () => {
  it('produces canonical SSE event sequence and reaches terminal state', async () => {
    const startedAt = new Date().toISOString();
    const ctx = await createE2ETestContext({
      modelSteps: [{ reasoningChunks: ['thinking'], contentChunks: ['Health'] }],
      tempPrefix: 'nextagent-akg-02-',
    });
    try {
      const { baseUrl } = ctx;

      const accepted = await fetch(`${baseUrl}/api/v1/requests`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          inputText: 'Check health.',
          idempotencyKey: `alpha-02-${crypto.randomUUID()}`,
        }),
      });
      expect(accepted.status).toBe(200);
      const body = (await accepted.json()) as { sessionId: string; runId: string };

      const stream = await fetch(`${baseUrl}/api/v1/sessions/${body.sessionId}/stream?lastSeenSequence=0&runId=${body.runId}`);
      expect(stream.status).toBe(200);
      const streamBody = await stream.text();

      const events = streamBody.split('\n').filter((line) => line.startsWith('event: '));
      const eventTypes = events.map((e) => e.replace('event: ', ''));

      expect(eventTypes).toContain('REQUEST_ACCEPTED');
      expect(eventTypes).toContain('REQUEST_COMPLETED');
      if (eventTypes.includes('LLM_REASONING_DELTA')) {
        expect(eventTypes).toContain('LLM_REASONING_COMPLETED');
      }
      if (eventTypes.includes('LLM_CONTENT_DELTA')) {
        expect(eventTypes.at(-1)).toBe('REQUEST_COMPLETED');
      }

      const acceptedIdx = eventTypes.indexOf('REQUEST_ACCEPTED');
      const completedIdx = eventTypes.indexOf('REQUEST_COMPLETED');
      expect(acceptedIdx).toBeGreaterThanOrEqual(0);
      expect(completedIdx).toBeGreaterThan(acceptedIdx);

      const terminalIdx = eventTypes.lastIndexOf('REQUEST_COMPLETED');
      expect(terminalIdx).toBe(eventTypes.length - 1);

      const replayed = await fetch(`${baseUrl}/api/v1/sessions/${body.sessionId}/stream?lastSeenSequence=0&runId=${body.runId}`);
      expect(replayed.status).toBe(200);
      const replayedBody = await replayed.text();
      expect(replayedBody).toBe(streamBody);

      const conversation = await fetch(`${baseUrl}/api/v1/sessions/${body.sessionId}/conversation?limit=10`);
      expect(conversation.status).toBe(200);
      const history = (await conversation.json()) as { items: Array<{ role: string; content: string }> };
      const assistantContent = history.items.find((item) => item.role === 'ASSISTANT')?.content ?? '';
      expect(streamBody).toContain(assistantContent);

      recordCaseResult('alpha-02', 'PASSED', { startedAt, endedAt: new Date().toISOString() });
    } catch (error) {
      recordCaseResult('alpha-02', 'FAILED', {
        safeReason: error instanceof Error ? error.message : String(error),
        startedAt,
        endedAt: new Date().toISOString(),
      });
    } finally {
      await cleanupE2ETestContext(ctx);
    }
  }, 30_000);

  it('terminal event is followed by no new events on replay', async () => {
    const startedAt = new Date().toISOString();
    const ctx = await createE2ETestContext({
      modelSteps: [{ contentChunks: ['OK'] }],
      tempPrefix: 'nextagent-akg-02b-',
    });
    try {
      const { baseUrl } = ctx;

      const accepted = await fetch(`${baseUrl}/api/v1/requests`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          inputText: 'OK?',
          idempotencyKey: `alpha-02b-${crypto.randomUUID()}`,
        }),
      });
      expect(accepted.status).toBe(200);
      const body = (await accepted.json()) as { sessionId: string; runId: string };

      const stream = await fetch(`${baseUrl}/api/v1/sessions/${body.sessionId}/stream?lastSeenSequence=0&runId=${body.runId}`);
      await stream.text();

      const replayed = await fetch(`${baseUrl}/api/v1/sessions/${body.sessionId}/stream?lastSeenSequence=0&runId=${body.runId}`);
      const replayedBody = await replayed.text();
      const replayEventLines = replayedBody.split('\n').filter((line) => line.startsWith('event: '));
      expect(replayEventLines.at(-1)).toBe('event: REQUEST_COMPLETED');
    } catch (error) {
      recordCaseResult('alpha-02', 'FAILED', {
        safeReason: error instanceof Error ? error.message : String(error),
        startedAt,
        endedAt: new Date().toISOString(),
      });
    } finally {
      await cleanupE2ETestContext(ctx);
    }
  }, 30_000);
});
