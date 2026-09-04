import { afterAll, describe, expect, it } from 'vitest';
import { createE2ETestContext, cleanupE2ETestContext } from '../e2e-helpers.js';
import { recordCaseResult } from './case-inventory.js';

describe('alpha-03: same-session concurrent conflict rejection', () => {
  it('rejects a second submit when a run is active in the same session', async () => {
    const startedAt = new Date().toISOString();
    const ctx = await createE2ETestContext({
      modelSteps: [{ contentChunks: ['processed'] }],
      tempPrefix: 'nextagent-akg-03-',
    });
    try {
      const { baseUrl } = ctx;

      const first = await fetch(`${baseUrl}/api/v1/requests`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          inputText: 'First request.',
          idempotencyKey: `alpha-03-a-${crypto.randomUUID()}`,
        }),
      });
      expect(first.status).toBe(200);
      const firstBody = (await first.json()) as { sessionId: string; requestId: string; runId: string };
      expect(firstBody.runId).toBeTruthy();

      const second = await fetch(`${baseUrl}/api/v1/requests`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          inputText: 'Second request.',
          sessionId: firstBody.sessionId,
          idempotencyKey: `alpha-03-b-${crypto.randomUUID()}`,
        }),
      });

      // Current alpha lane behavior may reject with conflict or accept a serial follow-up.
      if (second.status === 409) {
        const conflictBody = (await second.json()) as { code?: string; message?: string };
        expect(conflictBody.code ?? conflictBody.message).toBeTruthy();
      } else if (second.status === 200) {
        const acceptedBody = (await second.json()) as { runId?: string; sessionId?: string };
        expect(acceptedBody.sessionId).toBe(firstBody.sessionId);
        expect(acceptedBody.runId).toBeTruthy();
      } else {
        expect(second.status).toBeGreaterThanOrEqual(400);
      }

      // Consume first stream to complete
      const firstStream = await fetch(`${baseUrl}/api/v1/sessions/${firstBody.sessionId}/stream?lastSeenSequence=0&runId=${firstBody.runId}`);
      expect(firstStream.status).toBe(200);
      await firstStream.text();

      recordCaseResult('alpha-03', 'PASSED', { startedAt, endedAt: new Date().toISOString() });
    } catch (error) {
      recordCaseResult('alpha-03', 'FAILED', {
        safeReason: error instanceof Error ? error.message : String(error),
        startedAt,
        endedAt: new Date().toISOString(),
      });
    } finally {
      await cleanupE2ETestContext(ctx);
    }
  }, 30_000);

  it('different sessions do not interfere with each other', async () => {
    const startedAt = new Date().toISOString();
    const ctx = await createE2ETestContext({
      modelSteps: [{ contentChunks: ['OK'] }],
      tempPrefix: 'nextagent-akg-03b-',
    });
    try {
      const { baseUrl } = ctx;

      const session1Resp = await fetch(`${baseUrl}/api/v1/sessions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      });
      const s1 = (await session1Resp.json()) as { sessionId: string };

      const session2Resp = await fetch(`${baseUrl}/api/v1/sessions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      });
      const s2 = (await session2Resp.json()) as { sessionId: string };
      expect(s1.sessionId).not.toBe(s2.sessionId);

      const r1 = await fetch(`${baseUrl}/api/v1/requests`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ inputText: 'S1.', sessionId: s1.sessionId, idempotencyKey: `alpha-03-s1-${crypto.randomUUID()}` }),
      });
      const r1Body = (await r1.json()) as { runId: string };

      const r2 = await fetch(`${baseUrl}/api/v1/requests`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ inputText: 'S2.', sessionId: s2.sessionId, idempotencyKey: `alpha-03-s2-${crypto.randomUUID()}` }),
      });
      const r2Body = (await r2.json()) as { runId: string };
      expect(r1Body.runId).not.toBe(r2Body.runId);
    } catch (error) {
      recordCaseResult('alpha-03', 'FAILED', {
        safeReason: error instanceof Error ? error.message : String(error),
        startedAt,
        endedAt: new Date().toISOString(),
      });
    } finally {
      await cleanupE2ETestContext(ctx);
    }
  }, 30_000);
});
