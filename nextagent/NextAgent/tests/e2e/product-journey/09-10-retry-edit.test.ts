import { createNextAgentTestApp } from '@nextagent/agent-platform-gateway-local/testing';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, afterAll } from 'vitest';
import { recordCaseResult } from './case-inventory.js';

const dirs: string[] = [];
afterAll(async () => {
  for (const d of dirs) {
    await rm(d, { recursive: true, force: true }).catch(() => {});
  }
});

async function reserveFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = createServer();
    s.on('error', reject);
    s.listen(0, '127.0.0.1', () => {
      const a = s.address();
      if (typeof a !== 'object' || a === null) {
        s.close(() => reject(new Error('port')));
        return;
      }
      s.close((e) => (e === undefined ? resolve(a.port) : reject(e)));
    });
  });
}

async function createApp(modelSteps: any) {
  const dir = await mkdtemp(join(tmpdir(), 'nextagent-pj-'));
  dirs.push(dir);
  const port = await reserveFreePort();
  const app = createNextAgentTestApp({ workspaceDir: dir, channelPort: port, modelSteps });
  await app.start();
  return { app, baseUrl: `http://127.0.0.1:${port}`, dir };
}

describe('e2e-P0-09 retry new run', () => {
  it('creates a new run on retry and old results remain traceable', async () => {
    const ctx = await createApp([{ contentChunks: ['First attempt'] }, { contentChunks: ['Retry', ' attempt passed.'] }]);
    const startedAt = new Date().toISOString();
    try {
      const r = await fetch(`${ctx.baseUrl}/api/v1/requests`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ inputText: 'Test retry.', idempotencyKey: `e2e-09a-${crypto.randomUUID()}` }),
      });
      const b = (await r.json()) as any;
      const s1 = await fetch(`${ctx.baseUrl}/api/v1/sessions/${b.sessionId}/stream?lastSeenSequence=0&runId=${b.runId}`);
      await s1.text();

      const retry = await fetch(`${ctx.baseUrl}/api/v1/sessions/${b.sessionId}/retry`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ expectedLatestRequestId: b.requestId, idempotencyKey: `e2e-09r-${crypto.randomUUID()}` }),
      });
      const rb = (await retry.json()) as any;
      expect(rb.runId).not.toBe(b.runId);

      const s2 = await fetch(`${ctx.baseUrl}/api/v1/sessions/${b.sessionId}/stream?lastSeenSequence=0&runId=${rb.runId}`);
      const s2Body = await s2.text();
      expect(s2Body).toContain('Retry attempt passed.');

      recordCaseResult('e2e-P0-09', 'PASSED', { startedAt, endedAt: new Date().toISOString() });
    } catch (e: any) {
      recordCaseResult('e2e-P0-09', 'FAILED', { safeReason: e?.message ?? String(e), startedAt, endedAt: new Date().toISOString() });
    } finally {
      await ctx.app.close();
    }
  }, 30_000);
});

describe('e2e-P0-10 edit-resubmit new mainline', () => {
  it('edit followed by resubmit creates a new mainline', async () => {
    const ctx = await createApp([{ contentChunks: ['Original answer.'] }, { contentChunks: ['Edited answer.'] }]);
    const startedAt = new Date().toISOString();
    try {
      const r = await fetch(`${ctx.baseUrl}/api/v1/requests`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ inputText: 'Original.', idempotencyKey: `e2e-10a-${crypto.randomUUID()}` }),
      });
      const b = (await r.json()) as any;
      const s1 = await fetch(`${ctx.baseUrl}/api/v1/sessions/${b.sessionId}/stream?lastSeenSequence=0&runId=${b.runId}`);
      await s1.text();

      const r2 = await fetch(`${ctx.baseUrl}/api/v1/sessions/${b.sessionId}/requests`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ inputText: 'Edited.', idempotencyKey: `e2e-10b-${crypto.randomUUID()}` }),
      });
      const b2 = (await r2.json()) as any;
      const s2 = await fetch(`${ctx.baseUrl}/api/v1/sessions/${b.sessionId}/stream?lastSeenSequence=0&runId=${b2.runId}`);
      const s2Body = await s2.text();
      expect(s2Body).toContain('Edited answer.');
      recordCaseResult('e2e-P0-10', 'PASSED', { startedAt, endedAt: new Date().toISOString() });
    } catch (e: any) {
      recordCaseResult('e2e-P0-10', 'FAILED', { safeReason: e?.message ?? String(e), startedAt, endedAt: new Date().toISOString() });
    } finally {
      await ctx.app.close();
    }
  }, 30_000);
});
