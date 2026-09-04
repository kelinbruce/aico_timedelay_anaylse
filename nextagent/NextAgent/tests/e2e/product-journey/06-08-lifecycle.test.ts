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

function sseEventTypes(body: string): string[] {
  return body
    .split('\n')
    .filter((line) => line.startsWith('event: '))
    .map((line) => line.slice('event: '.length));
}

describe('e2e-P0-06 terminal commit consistency', () => {
  it('stream history and refresh are consistent after terminal commit', async () => {
    const ctx = await createApp([{ content: 'Terminal check passed.' }]);
    const startedAt = new Date().toISOString();
    try {
      const r1 = await fetch(`${ctx.baseUrl}/api/v1/requests`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ inputText: 'Run terminal check.', idempotencyKey: `e2e-06-${crypto.randomUUID()}` }),
      });
      const b1 = (await r1.json()) as any;
      const stream = await fetch(`${ctx.baseUrl}/api/v1/sessions/${b1.sessionId}/stream?lastSeenSequence=0&runId=${b1.runId}`);
      const streamBody = await stream.text();
      expect(streamBody).toContain('event: REQUEST_COMPLETED');
      expect(streamBody).toContain('Terminal check passed.');

      const conv = await fetch(`${ctx.baseUrl}/api/v1/sessions/${b1.sessionId}/conversation?limit=10`);
      const h = (await conv.json()) as any;
      expect(h.items.at(-1)?.content).toContain('Terminal check passed.');

      const replayed = await fetch(`${ctx.baseUrl}/api/v1/sessions/${b1.sessionId}/stream?lastSeenSequence=0&runId=${b1.runId}`);
      expect(replayed.status).toBe(200);
      const replayedBody = await replayed.text();
      expect(replayedBody).toContain('event: REQUEST_ACCEPTED');
      expect(replayedBody).toContain('event: REQUEST_COMPLETED');
      expect(replayedBody).toContain('Terminal check passed.');
      const replayedEvents = sseEventTypes(replayedBody);
      expect(replayedEvents.indexOf('REQUEST_ACCEPTED')).toBeGreaterThanOrEqual(0);
      expect(replayedEvents.indexOf('REQUEST_COMPLETED')).toBeGreaterThan(replayedEvents.indexOf('REQUEST_ACCEPTED'));
      expect(replayedEvents.at(-1)).toBe('REQUEST_COMPLETED');
      recordCaseResult('e2e-P0-06', 'PASSED', { startedAt, endedAt: new Date().toISOString() });
    } catch (e: any) {
      recordCaseResult('e2e-P0-06', 'FAILED', { safeReason: e?.message ?? String(e), startedAt, endedAt: new Date().toISOString() });
      throw e;
    } finally {
      await ctx.app.close();
    }
  }, 30_000);
});

describe('e2e-P0-07 same-session submit', () => {
  it('accepts multiple submits on the same session', async () => {
    const ctx = await createApp([{ content: 'First response.' }, { content: 'Second response.' }]);
    const startedAt = new Date().toISOString();
    try {
      const r1 = await fetch(`${ctx.baseUrl}/api/v1/requests`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ inputText: 'First prompt.', idempotencyKey: `e2e-07a-${crypto.randomUUID()}` }),
      });
      const b1 = (await r1.json()) as any;
      const s1 = await (await fetch(`${ctx.baseUrl}/api/v1/sessions/${b1.sessionId}/stream?lastSeenSequence=0&runId=${b1.runId}`)).text();

      const r2 = await fetch(`${ctx.baseUrl}/api/v1/sessions/${b1.sessionId}/requests`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ inputText: 'Second prompt.', idempotencyKey: `e2e-07b-${crypto.randomUUID()}` }),
      });
      const b2 = (await r2.json()) as any;
      expect(b2.sessionId).toBe(b1.sessionId);
      const s2 = await (await fetch(`${ctx.baseUrl}/api/v1/sessions/${b1.sessionId}/stream?lastSeenSequence=0&runId=${b2.runId}`)).text();
      expect(s2).toContain('Second response.');

      recordCaseResult('e2e-P0-07', 'PASSED', { startedAt, endedAt: new Date().toISOString() });
    } catch (e: any) {
      recordCaseResult('e2e-P0-07', 'FAILED', { safeReason: e?.message ?? String(e), startedAt, endedAt: new Date().toISOString() });
      throw e;
    } finally {
      await ctx.app.close();
    }
  }, 30_000);
});

describe('e2e-P0-08 cancel', () => {
  it('accepts cancel request and stream shows a canceled terminal without a completed terminal', async () => {
    const ctx = await createApp([{ contentChunks: ['partial answer'], delayBeforeFinalMs: 750 }]);
    const startedAt = new Date().toISOString();
    try {
      const r = await fetch(`${ctx.baseUrl}/api/v1/requests`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ inputText: 'Cancel me.', idempotencyKey: `e2e-08a-${crypto.randomUUID()}` }),
      });
      const b = (await r.json()) as any;

      const cancel = await fetch(`${ctx.baseUrl}/api/v1/sessions/${b.sessionId}/cancel`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ expectedLatestRequestId: b.requestId, idempotencyKey: `e2e-08c-${crypto.randomUUID()}` }),
      });
      expect(cancel.status).toBe(200);

      let streamBody = '';
      for (let attempt = 0; attempt < 10; attempt++) {
        const stream = await fetch(`${ctx.baseUrl}/api/v1/sessions/${b.sessionId}/stream?lastSeenSequence=0&runId=${b.runId}`);
        streamBody = await stream.text();
        if (streamBody.includes('event: REQUEST_CANCELED')) {
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 75));
      }
      expect(streamBody).toContain('event: REQUEST_ACCEPTED');
      expect(streamBody).toContain('event: REQUEST_CANCELED');
      expect(streamBody).not.toContain('event: REQUEST_COMPLETED');
      recordCaseResult('e2e-P0-08', 'PASSED', { startedAt, endedAt: new Date().toISOString() });
    } catch (e: any) {
      recordCaseResult('e2e-P0-08', 'FAILED', { safeReason: e?.message ?? String(e), startedAt, endedAt: new Date().toISOString() });
      throw e;
    } finally {
      await ctx.app.close();
    }
  }, 30_000);
});
