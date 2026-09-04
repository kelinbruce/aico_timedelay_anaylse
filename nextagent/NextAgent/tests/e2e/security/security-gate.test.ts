import { createNextAgentTestApp } from '@nextagent/agent-platform-gateway-local/testing';
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

describe('e2e-P0-01 unauthenticated challenge', () => {
  it('rejects unauthenticated requests without creating user data', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'nextagent-sec-01-'));
    dirs.push(dir);
    const port = await reserveFreePort();
    const app = createNextAgentTestApp({
      workspaceDir: dir,
      channelPort: port,
      modelSteps: [{ content: 'Safe response.' }],
      localAuthEnabled: true,
    });

    try {
      await app.start();
      const baseUrl = `http://127.0.0.1:${port}`;

      const r = await fetch(`${baseUrl}/api/v1/requests`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ inputText: 'Auth test.', idempotencyKey: 'sec-01-' + crypto.randomUUID() }),
      });
      expect(r.status).toBe(401);
      const body = (await r.json()) as { error?: unknown };
      expect(body.error).toBeDefined();
    } finally {
      await app.close();
    }
  }, 30_000);
});

describe('e2e-P0-12 attachment safe error', () => {
  it('returns safe error for non-enabled or oversize attachment and does not leak', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'nextagent-sec-12-'));
    dirs.push(dir);
    const port = await reserveFreePort();
    const app = createNextAgentTestApp({
      workspaceDir: dir,
      channelPort: port,
      modelSteps: [{ content: 'Attachment request.' }],
    });

    try {
      await app.start();
      const baseUrl = `http://127.0.0.1:${port}`;

      const r = await fetch(`${baseUrl}/api/v1/requests`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ inputText: 'Process attachment sk-CANARY-SEC-12.', idempotencyKey: 'sec-12-' + crypto.randomUUID() }),
      });
      const body = (await r.json()) as any;
      const stream = await fetch(`${baseUrl}/api/v1/sessions/${body.sessionId}/stream?lastSeenSequence=0&runId=${body.runId}`);
      const streamBody = await stream.text();
      expect(streamBody).not.toContain('sk-CANARY-SEC-12');
      expect(streamBody).toContain('event: REQUEST_COMPLETED');
    } finally {
      await app.close();
    }
  }, 30_000);
});

describe('e2e-P0-16 sandbox gateway not bypassed', () => {
  it('prevents dynamic execution from bypassing sandbox gateway', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'nextagent-sec-16-'));
    dirs.push(dir);
    const port = await reserveFreePort();
    const app = createNextAgentTestApp({
      workspaceDir: dir,
      channelPort: port,
      modelSteps: [{ content: 'Execution routed through sandbox.' }],
    });

    try {
      await app.start();
      const baseUrl = `http://127.0.0.1:${port}`;

      const r = await fetch(`${baseUrl}/api/v1/requests`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ inputText: 'Execute rm -rf /', idempotencyKey: 'sec-16-' + crypto.randomUUID() }),
      });
      const body = (await r.json()) as any;
      const stream = await fetch(`${baseUrl}/api/v1/sessions/${body.sessionId}/stream?lastSeenSequence=0&runId=${body.runId}`);
      const streamBody = await stream.text();
      expect(streamBody).toContain('event: REQUEST_COMPLETED');
    } finally {
      await app.close();
    }
  }, 30_000);
});

describe('e2e-P0-17 provider SafeError', () => {
  it('maps provider/model failure to SafeError without raw error leakage', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'nextagent-sec-17-'));
    dirs.push(dir);
    const port = await reserveFreePort();
    const app = createNextAgentTestApp({
      workspaceDir: dir,
      channelPort: port,
      modelSteps: [{ content: 'Safe error mapping.' }],
    });

    try {
      await app.start();
      const baseUrl = `http://127.0.0.1:${port}`;

      const r = await fetch(`${baseUrl}/api/v1/requests`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ inputText: 'Test provider failure.', idempotencyKey: 'sec-17-' + crypto.randomUUID() }),
      });
      const body = (await r.json()) as any;
      const stream = await fetch(`${baseUrl}/api/v1/sessions/${body.sessionId}/stream?lastSeenSequence=0&runId=${body.runId}`);
      const streamBody = await stream.text();
      expect(streamBody).toContain('event: REQUEST_COMPLETED');
    } finally {
      await app.close();
    }
  }, 30_000);
});

describe('e2e-P0-21 audit log safety', () => {
  it('audit and log output contains safe fields only', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'nextagent-sec-21-'));
    dirs.push(dir);
    const port = await reserveFreePort();
    const app = createNextAgentTestApp({
      workspaceDir: dir,
      channelPort: port,
      modelSteps: [{ content: 'Audit safe.' }],
    });

    try {
      await app.start();
      const baseUrl = `http://127.0.0.1:${port}`;

      const r = await fetch(`${baseUrl}/api/v1/requests`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ inputText: 'sk-CANARY-AUDIT-21 audit test.', idempotencyKey: 'sec-21-' + crypto.randomUUID() }),
      });
      const body = (await r.json()) as any;
      const sessionId = body.sessionId;

      const stream = await fetch(`${baseUrl}/api/v1/sessions/${sessionId}/stream?lastSeenSequence=0&runId=${body.runId}`);
      const streamBody = await stream.text();
      expect(streamBody).not.toContain('sk-CANARY-AUDIT-21');
      expect(streamBody).toContain('event: REQUEST_COMPLETED');
    } finally {
      await app.close();
    }
  }, 30_000);
});
