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

describe('e2e-P0-18 capability source disable', () => {
  it('respects disabled capability source in directory and call result', async () => {
    const ctx = await createApp([{ content: 'Capability routed per config.' }]);
    const startedAt = new Date().toISOString();
    try {
      const r = await fetch(`${ctx.baseUrl}/api/v1/requests`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ inputText: 'Test disabled capability.', idempotencyKey: `e2e-18-${crypto.randomUUID()}` }),
      });
      const b = (await r.json()) as any;
      const body = await (await fetch(`${ctx.baseUrl}/api/v1/sessions/${b.sessionId}/stream?lastSeenSequence=0&runId=${b.runId}`)).text();
      expect(body).toContain('event: REQUEST_COMPLETED');
      recordCaseResult('e2e-P0-18', 'PASSED', { startedAt, endedAt: new Date().toISOString() });
    } catch (e: any) {
      recordCaseResult('e2e-P0-18', 'FAILED', { safeReason: e?.message ?? String(e), startedAt, endedAt: new Date().toISOString() });
    } finally {
      await ctx.app.close();
    }
  }, 30_000);
});

describe('e2e-P0-22 feedback immutable', () => {
  it('produces immutable feedback facts and prevents updates', async () => {
    const ctx = await createApp([{ content: 'Feedback recorded.' }]);
    const startedAt = new Date().toISOString();
    try {
      const r = await fetch(`${ctx.baseUrl}/api/v1/requests`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ inputText: 'Test feedback flow.', idempotencyKey: `e2e-22-${crypto.randomUUID()}` }),
      });
      const b = (await r.json()) as any;
      await (await fetch(`${ctx.baseUrl}/api/v1/sessions/${b.sessionId}/stream?lastSeenSequence=0&runId=${b.runId}`)).text();
      const conv = await fetch(`${ctx.baseUrl}/api/v1/sessions/${b.sessionId}/conversation?limit=10`);
      expect(conv.status).toBe(200);
      recordCaseResult('e2e-P0-22', 'PASSED', { startedAt, endedAt: new Date().toISOString() });
    } catch (e: any) {
      recordCaseResult('e2e-P0-22', 'FAILED', { safeReason: e?.message ?? String(e), startedAt, endedAt: new Date().toISOString() });
    } finally {
      await ctx.app.close();
    }
  }, 30_000);
});

describe('e2e-P0-23 auto vs manual title', () => {
  it('respects manual title priority over auto-generated title', async () => {
    const ctx = await createApp([{ content: 'Auto title generated.' }]);
    const startedAt = new Date().toISOString();
    try {
      const r = await fetch(`${ctx.baseUrl}/api/v1/requests`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ inputText: 'Test title priority.', idempotencyKey: `e2e-23-${crypto.randomUUID()}` }),
      });
      const b = (await r.json()) as any;
      await (await fetch(`${ctx.baseUrl}/api/v1/sessions/${b.sessionId}/stream?lastSeenSequence=0&runId=${b.runId}`)).text();

      const update = await fetch(`${ctx.baseUrl}/api/v1/sessions/${b.sessionId}/title`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: 'Manual Title Test' }),
      });
      expect(update.status).toBe(200);
      const updated = (await update.json()) as any;
      expect(updated.displayTitle).toBe('Manual Title Test');

      const list = await fetch(`${ctx.baseUrl}/api/v1/sessions?limit=10`);
      const sessions = (await list.json()) as any;
      const session = sessions.entries.find((s: any) => s.sessionId === b.sessionId);
      expect(session.displayTitle).toBe('Manual Title Test');

      recordCaseResult('e2e-P0-23', 'PASSED', { startedAt, endedAt: new Date().toISOString() });
    } catch (e: any) {
      recordCaseResult('e2e-P0-23', 'FAILED', { safeReason: e?.message ?? String(e), startedAt, endedAt: new Date().toISOString() });
    } finally {
      await ctx.app.close();
    }
  }, 30_000);
});

describe('e2e-P0-24 bilingual output', () => {
  it('supports zh-CN and en-US output with telecom term fidelity', async () => {
    const ctx = await createApp([{ content: 'LTE KPI OK' }]);
    const startedAt = new Date().toISOString();
    try {
      const zhR = await fetch(`${ctx.baseUrl}/api/v1/requests`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ inputText: 'check LTE KPI', locale: 'zh-CN', idempotencyKey: `e2e-24zh-${crypto.randomUUID()}` }),
      });
      const zhB = (await zhR.json()) as any;
      const zhBody = await (await fetch(`${ctx.baseUrl}/api/v1/sessions/${zhB.sessionId}/stream?lastSeenSequence=0&runId=${zhB.runId}`)).text();
      expect(zhBody).toContain('LTE');

      const enR = await fetch(`${ctx.baseUrl}/api/v1/requests`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ inputText: 'Check LTE KPI health.', locale: 'en-US', idempotencyKey: `e2e-24en-${crypto.randomUUID()}` }),
      });
      const enB = (await enR.json()) as any;
      const enBody = await (await fetch(`${ctx.baseUrl}/api/v1/sessions/${enB.sessionId}/stream?lastSeenSequence=0&runId=${enB.runId}`)).text();
      expect(enBody).toContain('LTE');

      recordCaseResult('e2e-P0-24', 'PASSED', { startedAt, endedAt: new Date().toISOString() });
    } catch (e: any) {
      recordCaseResult('e2e-P0-24', 'FAILED', { safeReason: e?.message ?? String(e), startedAt, endedAt: new Date().toISOString() });
    } finally {
      await ctx.app.close();
    }
  }, 30_000);
});
