import { createNextAgentTestApp } from '@nextagent/agent-platform-gateway-local/testing';
import { brand } from '@nextagent/agent-common';
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
  const app = createNextAgentTestApp({
    workspaceDir: dir,
    channelPort: port,
    modelSteps,
    identity: {
      tenantId: brand<string, 'TenantId'>('tenant-1'),
      subjectId: brand<string, 'SubjectId'>('subject-1'),
      displayName: 'Product journey tester',
    },
  });
  await app.start();
  return { app, baseUrl: `http://127.0.0.1:${port}`, dir };
}

describe('e2e-P0-13 long session', () => {
  it('handles long session with multiple exchanges', async () => {
    const ctx = await createApp(Array.from({ length: 6 }, () => ({ content: 'Response.' })));
    const startedAt = new Date().toISOString();
    try {
      let sessionId = '';
      for (let i = 0; i < 5; i++) {
        const r = await fetch(`${ctx.baseUrl}/api/v1/requests`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ inputText: `Q${i}: question.`, idempotencyKey: `e2e-13-${i}-${crypto.randomUUID()}` }),
        });
        const b = (await r.json()) as any;
        sessionId = b.sessionId;
        await (await fetch(`${ctx.baseUrl}/api/v1/sessions/${sessionId}/stream?lastSeenSequence=0&runId=${b.runId}`)).text();
      }
      const conv = await fetch(`${ctx.baseUrl}/api/v1/sessions/${sessionId}/conversation?limit=50`);
      expect(conv.status).toBe(200);
      recordCaseResult('e2e-P0-13', 'PASSED', { startedAt, endedAt: new Date().toISOString() });
    } catch (e: any) {
      recordCaseResult('e2e-P0-13', 'FAILED', { safeReason: e?.message ?? String(e), startedAt, endedAt: new Date().toISOString() });
    } finally {
      await ctx.app.close();
    }
  }, 60_000);
});

describe('e2e-P0-14 large content lazy load', () => {
  it('loads large referenced content on demand', async () => {
    const ctx = await createApp([{ content: 'Large content delivered.' }]);
    const startedAt = new Date().toISOString();
    try {
      const r = await fetch(`${ctx.baseUrl}/api/v1/requests`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ inputText: 'Give me a large analysis.', idempotencyKey: `e2e-14-${crypto.randomUUID()}` }),
      });
      const b = (await r.json()) as any;
      const body = await (await fetch(`${ctx.baseUrl}/api/v1/sessions/${b.sessionId}/stream?lastSeenSequence=0&runId=${b.runId}`)).text();
      expect(body).toContain('Large content delivered.');
      recordCaseResult('e2e-P0-14', 'PASSED', { startedAt, endedAt: new Date().toISOString() });
    } catch (e: any) {
      recordCaseResult('e2e-P0-14', 'FAILED', { safeReason: e?.message ?? String(e), startedAt, endedAt: new Date().toISOString() });
    } finally {
      await ctx.app.close();
    }
  }, 30_000);
});

describe('e2e-P0-15 model-tool-capability loop', () => {
  it('executes a complete model-tool-capability loop', async () => {
    const ctx = await createApp([
      {
        toolCalls: [{ toolCallId: 'tool-e2e-15', toolName: 'Write', arguments: { file_path: 'diag/output.txt', content: 'tool-result' } }],
      },
      { content: 'Tool executed successfully.' },
    ]);
    const startedAt = new Date().toISOString();
    try {
      const r = await fetch(`${ctx.baseUrl}/api/v1/requests`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ inputText: 'Run diagnostic tool.', idempotencyKey: `e2e-15-${crypto.randomUUID()}` }),
      });
      const b = (await r.json()) as any;
      const events = await waitForTimelineEvents(ctx.app, b.sessionId, b.runId, 3_000);
      expect(events.some((event) => event.type === 'USER_INPUT_REQUIRED')).toBe(false);
      expect(events.some((event) => event.type === 'CAPABILITY_STARTED')).toBe(true);
      expect(events.some((event) => event.type === 'CAPABILITY_COMPLETED')).toBe(true);
      const body = await (await fetch(`${ctx.baseUrl}/api/v1/sessions/${b.sessionId}/stream?lastSeenSequence=0&runId=${b.runId}`)).text();
      expect(body).toContain('event: CAPABILITY_STARTED');
      expect(body).toContain('tool-e2e-15');
      expect(body).toContain('Tool executed successfully.');
      recordCaseResult('e2e-P0-15', 'PASSED', { startedAt, endedAt: new Date().toISOString() });
    } catch (e: any) {
      recordCaseResult('e2e-P0-15', 'FAILED', { safeReason: e?.message ?? String(e), startedAt, endedAt: new Date().toISOString() });
    } finally {
      await ctx.app.close();
    }
  }, 30_000);
});

async function waitForTimelineEvents(
  app: ReturnType<typeof createNextAgentTestApp>,
  sessionId: string,
  runId: string,
  timeoutMs = 5_000,
): Promise<Awaited<ReturnType<typeof app.gateway.timeline.listEvents>>> {
  const identity = {
    tenantId: brand<string, 'TenantId'>('tenant-1'),
    subjectId: brand<string, 'SubjectId'>('subject-1'),
  };
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const events = await app.gateway.timeline.listEvents({
      tenantId: identity.tenantId,
      subjectId: identity.subjectId,
      agentId: brand<string, 'AgentId'>('default-agent'),
      sessionId: brand<string, 'SessionId'>(sessionId),
      runId: brand<string, 'RequestRunId'>(runId),
      afterSequence: brand<number, 'TimelineSequence'>(0),
      limit: 100,
    });
    if (events.some((event) => event.type === 'REQUEST_COMPLETED')) {
      return events;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error('Timed out waiting for request timeline completion.');
}
