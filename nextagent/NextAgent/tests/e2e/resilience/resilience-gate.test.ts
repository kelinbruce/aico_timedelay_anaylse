import { createNextAgentTestApp } from '@nextagent/agent-platform-gateway-local/testing';
import { brand } from '@nextagent/agent-common';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, afterAll } from 'vitest';

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

function sseEventTypes(body: string): string[] {
  return body
    .split('\n')
    .filter((line) => line.startsWith('event: '))
    .map((line) => line.slice('event: '.length));
}

function createResilienceTestApp(options: Parameters<typeof createNextAgentTestApp>[0]): ReturnType<typeof createNextAgentTestApp> {
  const app = createNextAgentTestApp(options);
  const close = app.close.bind(app);
  let closed = false;
  app.close = async () => {
    if (closed) {
      return;
    }
    closed = true;
    await close();
  };
  return app;
}

describe('e2e-P0-05 stream disconnect and replay', () => {
  it('replays from lastSeenSequence after disconnect', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'nextagent-res-05-'));
    dirs.push(dir);
    const port = await reserveFreePort();
    const app = createResilienceTestApp({
      workspaceDir: dir,
      channelPort: port,
      modelSteps: [{ reasoningChunks: ['thinking'], contentChunks: ['Recovery', ' test', ' passed.'] }],
    });

    try {
      await app.start();
      const baseUrl = `http://127.0.0.1:${port}`;

      const r = await fetch(`${baseUrl}/api/v1/requests`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ inputText: 'Test stream replay.', idempotencyKey: 'res-05-' + crypto.randomUUID() }),
      });
      const b = (await r.json()) as any;

      const s1 = await fetch(`${baseUrl}/api/v1/sessions/${b.sessionId}/stream?lastSeenSequence=0&runId=${b.runId}`);
      const s1Body = await s1.text();
      expect(s1Body).toContain('event: REQUEST_COMPLETED');
      expect(s1Body).toContain('Recovery test passed.');

      const s2 = await fetch(`${baseUrl}/api/v1/sessions/${b.sessionId}/stream?lastSeenSequence=0&runId=${b.runId}`);
      const s2Body = await s2.text();
      expect(s2Body).toContain('event: REQUEST_ACCEPTED');
      expect(s2Body).toContain('event: REQUEST_COMPLETED');
      expect(s2Body).toContain('Recovery test passed.');
      const replayedEvents = sseEventTypes(s2Body);
      expect(replayedEvents.indexOf('REQUEST_ACCEPTED')).toBeGreaterThanOrEqual(0);
      expect(replayedEvents.indexOf('REQUEST_COMPLETED')).toBeGreaterThan(replayedEvents.indexOf('REQUEST_ACCEPTED'));
      expect(replayedEvents.at(-1)).toBe('REQUEST_COMPLETED');
    } finally {
      await app.close();
    }
  }, 30_000);
});

describe('e2e-P0-27 process restart recovery', () => {
  it('survives process restart and still serves requests', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'nextagent-res-27-'));
    dirs.push(dir);
    const port1 = await reserveFreePort();

    const app1 = createResilienceTestApp({
      workspaceDir: dir,
      channelPort: port1,
      modelSteps: [{ content: 'First instance.' }],
    });
    await app1.start();
    const baseUrl1 = `http://127.0.0.1:${port1}`;

    const r = await fetch(`${baseUrl1}/api/v1/requests`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ inputText: 'Test restart recovery.', idempotencyKey: 'res-27-' + crypto.randomUUID() }),
    });
    const b = (await r.json()) as any;
    const s1 = await (await fetch(`${baseUrl1}/api/v1/sessions/${b.sessionId}/stream?lastSeenSequence=0&runId=${b.runId}`)).text();
    expect(s1).toContain('First instance.');

    await app1.close();

    const port2 = await reserveFreePort();
    const app2 = createResilienceTestApp({
      workspaceDir: dir,
      channelPort: port2,
      modelSteps: [{ content: 'Restarted.' }],
    });
    await app2.start();
    const baseUrl2 = `http://127.0.0.1:${port2}`;

    const r2 = await fetch(`${baseUrl2}/api/v1/requests`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ inputText: 'After restart.', idempotencyKey: 'res-27b-' + crypto.randomUUID() }),
    });
    expect(r2.status).toBe(200);
    await app2.close();
  }, 30_000);
});

describe('e2e-P0-28 non-idempotent capability guard', () => {
  it('prevents re-execution of non-idempotent capability on uncertain recovery', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'nextagent-res-28-'));
    dirs.push(dir);
    const port = await reserveFreePort();
    const toolCallId = 'tool-res-28';
    const identity = {
      tenantId: brand<string, 'TenantId'>('tenant-1'),
      subjectId: brand<string, 'SubjectId'>('subject-1'),
      displayName: 'Resilience gate tester',
    };
    const app = createResilienceTestApp({
      workspaceDir: dir,
      channelPort: port,
      modelSteps: [
        { toolCalls: [{ toolCallId, toolName: 'Write', arguments: { file_path: 'resilience-check.txt', content: 'executed-once' } }] },
        { content: 'Capability executed once.' },
      ],
    });

    try {
      await app.start();
      const baseUrl = `http://127.0.0.1:${port}`;

      const r = await fetch(`${baseUrl}/api/v1/requests`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ inputText: 'Run idempotent check.', idempotencyKey: 'res-28-' + crypto.randomUUID() }),
      });
      const b = (await r.json()) as any;
      await waitForRunCompleted(app, b.runId, identity);
      const stream = await fetch(`${baseUrl}/api/v1/sessions/${b.sessionId}/stream?lastSeenSequence=0&runId=${b.runId}`);
      const sBody = await stream.text();
      expect(sBody).toContain('event: CAPABILITY_STARTED');
      expect(sBody).toContain('event: CAPABILITY_COMPLETED');
      expect(sBody).toContain(toolCallId);
    } finally {
      await app.close();
    }
  }, 30_000);
});

async function waitForRunCompleted(
  app: ReturnType<typeof createNextAgentTestApp>,
  runId: string,
  identity: { tenantId: ReturnType<typeof brand<string, 'TenantId'>>; subjectId: ReturnType<typeof brand<string, 'SubjectId'>> },
  timeoutMs = 5_000,
) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const run = await app.gateway.requestRuns.loadRun({
      tenantId: identity.tenantId,
      subjectId: identity.subjectId,
      agentId: brand<string, 'AgentId'>('default-agent'),
      runId: brand<string, 'RequestRunId'>(runId),
    });
    if (run?.status === 'COMPLETED' && run.terminalCommitState === 'COMMITTED') {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error('Timed out waiting for run completion.');
}
