import { createNextAgentTestApp } from '@nextagent/agent-platform-gateway-local/testing';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, afterAll } from 'vitest';
import { recordCaseResult, clearCaseResults, writeReleaseCheckResult } from './case-inventory.js';

const workspaceDirs: string[] = [];

afterAll(async () => {
  for (const dir of workspaceDirs) {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
});

async function reserveFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (typeof address !== 'object' || address === null) {
        server.close(() => reject(new Error('Unable to reserve a TCP port.')));
        return;
      }
      const port = address.port;
      server.close((error) => (error === undefined ? resolve(port) : reject(error)));
    });
  });
}

function sseEventTypes(body: string): string[] {
  return body
    .split('\n')
    .filter((line) => line.startsWith('event: '))
    .map((line) => line.slice('event: '.length));
}

describe('e2e-P0-02: login session create and conversation read', () => {
  it('creates a session, submits a question, and reads the conversation', async () => {
    const workspaceDir = await mkdtemp(join(tmpdir(), 'nextagent-pj-02-'));
    workspaceDirs.push(workspaceDir);
    const port = await reserveFreePort();
    const app = createNextAgentTestApp({
      workspaceDir,
      channelPort: port,
      modelSteps: [{ contentChunks: ['LTE KPIs', ' are within healthy range.'] }],
    });
    const startedAt = new Date().toISOString();

    try {
      await app.start();
      const baseUrl = `http://127.0.0.1:${port}`;

      const accepted = await fetch(`${baseUrl}/api/v1/requests`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          inputText: 'Check LTE KPI health.',
          idempotencyKey: `e2e-02-${crypto.randomUUID()}`,
        }),
      });
      expect(accepted.status).toBe(200);
      const body = (await accepted.json()) as { sessionId: string; requestId: string; runId: string; attempt: number };
      expect(body.sessionId).toBeTruthy();
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

      recordCaseResult('e2e-P0-02', 'PASSED', {
        startedAt,
        endedAt: new Date().toISOString(),
      });
    } catch (error) {
      recordCaseResult('e2e-P0-02', 'FAILED', {
        safeReason: error instanceof Error ? error.message : String(error),
        startedAt,
        endedAt: new Date().toISOString(),
      });
    } finally {
      await app.close();
    }
  }, 30_000);
});

describe('e2e-P0-03: SSE canonical sequence and terminal state', () => {
  it('produces canonical SSE event sequence and reaches terminal state', async () => {
    const workspaceDir = await mkdtemp(join(tmpdir(), 'nextagent-pj-03-'));
    workspaceDirs.push(workspaceDir);
    const port = await reserveFreePort();
    const app = createNextAgentTestApp({
      workspaceDir,
      channelPort: port,
      modelSteps: [{ reasoningChunks: ['thinking'], contentChunks: ['Health'] }],
    });
    const startedAt = new Date().toISOString();

    try {
      await app.start();
      const baseUrl = `http://127.0.0.1:${port}`;

      const accepted = await fetch(`${baseUrl}/api/v1/requests`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          inputText: 'Check health.',
          idempotencyKey: `e2e-03-${crypto.randomUUID()}`,
        }),
      });
      expect(accepted.status).toBe(200);
      const body = (await accepted.json()) as { sessionId: string; runId: string };

      const stream = await fetch(`${baseUrl}/api/v1/sessions/${body.sessionId}/stream?lastSeenSequence=0&runId=${body.runId}`);
      expect(stream.status).toBe(200);
      const streamBody = await stream.text();

      const events = streamBody.split('\n').filter((line) => line.startsWith('event:'));
      expect(events).toContain('event: REQUEST_ACCEPTED');
      expect(events).toContain('event: REQUEST_COMPLETED');
      if (events.includes('event: LLM_REASONING_DELTA')) {
        expect(events).toContain('event: LLM_REASONING_COMPLETED');
      }
      if (events.includes('event: LLM_CONTENT_DELTA')) {
        expect(events.at(-1)).toBe('event: REQUEST_COMPLETED');
      }

      const replayed = await fetch(`${baseUrl}/api/v1/sessions/${body.sessionId}/stream?lastSeenSequence=0&runId=${body.runId}`);
      expect(replayed.status).toBe(200);
      const replayedBody = await replayed.text();
      expect(replayedBody).toContain('event: REQUEST_ACCEPTED');
      expect(replayedBody).toContain('event: REQUEST_COMPLETED');
      expect(replayedBody).toContain('Health');
      const replayedEvents = sseEventTypes(replayedBody);
      expect(replayedEvents.indexOf('REQUEST_ACCEPTED')).toBeGreaterThanOrEqual(0);
      expect(replayedEvents.indexOf('REQUEST_COMPLETED')).toBeGreaterThan(replayedEvents.indexOf('REQUEST_ACCEPTED'));
      expect(replayedEvents.at(-1)).toBe('REQUEST_COMPLETED');

      recordCaseResult('e2e-P0-03', 'PASSED', {
        startedAt,
        endedAt: new Date().toISOString(),
      });
    } catch (error) {
      recordCaseResult('e2e-P0-03', 'FAILED', {
        safeReason: error instanceof Error ? error.message : String(error),
        startedAt,
        endedAt: new Date().toISOString(),
      });
    } finally {
      await app.close();
    }
  }, 30_000);
});
