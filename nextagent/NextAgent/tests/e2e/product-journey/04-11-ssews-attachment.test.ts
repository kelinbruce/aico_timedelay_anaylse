import { createNextAgentTestApp } from '@nextagent/agent-platform-gateway-local/testing';
import { brand } from '@nextagent/agent-common';
import type { ModelInvocationRequest } from '@nextagent/agent-contracts/model';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, afterAll } from 'vitest';
import { recordCaseResult } from './case-inventory.js';

const identity = {
  tenantId: brand<string, 'TenantId'>('tenant-1'),
  subjectId: brand<string, 'SubjectId'>('subject-1'),
};
const agentId = brand<string, 'AgentId'>('default-agent');
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

describe('e2e-P0-04 SSE vs WebSocket lifecycle consistency', () => {
  it('produces consistent terminal state via SSE and WebSocket', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'nextagent-pj-04-'));
    dirs.push(dir);
    const port = await reserveFreePort();
    const app = createNextAgentTestApp({
      workspaceDir: dir,
      channelPort: port,
      modelSteps: [{ contentChunks: ['SSE & WS', ' consistent.'] }],
    });
    const startedAt = new Date().toISOString();

    try {
      await app.start();
      const baseUrl = `http://127.0.0.1:${port}`;

      const r = await fetch(`${baseUrl}/api/v1/requests`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ inputText: 'Run consistency check.', idempotencyKey: `e2e-04-${crypto.randomUUID()}` }),
      });
      const b = (await r.json()) as any;

      const sseStream = await fetch(`${baseUrl}/api/v1/sessions/${b.sessionId}/stream?lastSeenSequence=0&runId=${b.runId}`);
      const sseBody = await sseStream.text();
      expect(sseBody).toContain('event: REQUEST_COMPLETED');

      const wsUrl = `ws://127.0.0.1:${port}/api/v1/sessions/${b.sessionId}/ws?lastSeenSequence=0&runId=${b.runId}`;
      const ws = new WebSocket(wsUrl);
      const wsMessages: string[] = [];
      ws.onmessage = (event) => {
        wsMessages.push(event.data as string);
      };
      await new Promise<void>((resolve, reject) => {
        ws.onopen = () => {};
        ws.onclose = () => resolve();
        ws.onerror = (e) => reject(new Error(`WebSocket error: ${JSON.stringify(e)}`));
        setTimeout(() => {
          ws.close();
          resolve();
        }, 10_000);
      });
      expect(wsMessages.length).toBeGreaterThan(0);

      recordCaseResult('e2e-P0-04', 'PASSED', { startedAt, endedAt: new Date().toISOString() });
    } catch (e: any) {
      recordCaseResult('e2e-P0-04', 'FAILED', { safeReason: e?.message ?? String(e), startedAt, endedAt: new Date().toISOString() });
      throw e;
    }
  }, 30_000);
});

describe('e2e-P0-11 staged attachment lifecycle', () => {
  it('uploads, finalizes, and exposes local attachment metadata without model-visible bytes', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'nextagent-pj-11-'));
    dirs.push(dir);
    const port = await reserveFreePort();
    const requests: ModelInvocationRequest[] = [];
    const app = createNextAgentTestApp({
      workspaceDir: dir,
      channelPort: port,
      modelSteps: [{ contentChunks: ['Attachment processed.'] }],
      modelRequestSink: requests,
    });
    const startedAt = new Date().toISOString();

    try {
      await app.start();
      const baseUrl = `http://127.0.0.1:${port}`;
      const attachmentText = '# attachment\ncontent\n';
      const sessionResponse = await fetch(`${baseUrl}/api/v1/sessions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      });
      expect(sessionResponse.status).toBe(200);
      const session = (await sessionResponse.json()) as { readonly sessionId: string };
      const tempRunId = crypto.randomUUID();
      const formData = new FormData();
      formData.append('tempRunId', tempRunId);
      formData.append('file', new Blob([attachmentText], { type: 'text/markdown' }), 'field-notes.md');

      const upload = await fetch(`${baseUrl}/api/v1/sessions/${session.sessionId}/files/upload`, {
        method: 'POST',
        body: formData,
      });
      expect(upload.status).toBe(200);
      expect(await upload.json()).toMatchObject({ tempRunId, fileName: 'field-notes.md' });

      const r = await fetch(`${baseUrl}/api/v1/sessions/${session.sessionId}/requests`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          inputText: 'Process my attachment.',
          idempotencyKey: `e2e-11-${crypto.randomUUID()}`,
          attachments: [{ tempRunId, fileName: 'field-notes.md' }],
        }),
      });
      expect(r.status).toBe(200);
      const b = (await r.json()) as any;
      const s = await fetch(`${baseUrl}/api/v1/sessions/${b.sessionId}/stream?lastSeenSequence=0&runId=${b.runId}`);
      const body = await s.text();
      expect(body).toContain('event: REQUEST_COMPLETED');
      expect(body).toContain('Attachment processed.');
      const attachments = await app.gateway.attachments.listAttachmentsByRequestId({
        tenantId: identity.tenantId,
        subjectId: identity.subjectId,
        agentId,
        requestId: brand<string, 'MessageId'>(b.requestId),
      });
      expect(attachments).toHaveLength(1);
      expect(attachments[0]).toMatchObject({
        fileName: 'field-notes.md',
        mediaType: 'MARKDOWN',
        sizeBytes: Buffer.byteLength(attachmentText),
        validationStatus: 'ACCEPTED',
        availabilityStatus: 'AVAILABLE',
      });
      expect(attachments[0]!.storageRef).toMatch(/^blob-/u);
      expect(attachments[0]!.storageRef).not.toContain(dir);
      await expect(
        app.gateway.blobs.loadBlob({
          tenantId: identity.tenantId,
          subjectId: identity.subjectId,
          blobRef: attachments[0]!.storageRef,
        }),
      ).resolves.toEqual(new Uint8Array(Buffer.from(attachmentText)));
      const messages = await app.gateway.messages.listCurrentRequestMessages({
        tenantId: identity.tenantId,
        subjectId: identity.subjectId,
        agentId,
        sessionId: brand<string, 'SessionId'>(b.sessionId),
        requestId: brand<string, 'MessageId'>(b.requestId),
        runId: brand<string, 'RequestRunId'>(b.runId),
        includeHidden: false,
        offset: 0,
        limit: 10,
      });
      expect(messages.items.find((message) => message.role === 'USER')?.metadata).toEqual({
        attachmentIds: [attachments[0]!.attachmentId],
      });
      expect(requests.length).toBeGreaterThan(0);
      const renderedRequests = requests.map(requestText);
      expect(renderedRequests.some((text) => text.includes('field-notes.md'))).toBe(true);
      expect(renderedRequests.some((text) => text.includes('# attachment'))).toBe(false);
      expect(renderedRequests.some((text) => text.includes(attachments[0]!.storageRef))).toBe(false);
      await expectMaterializedAttachmentsCleaned(app.systemConfig.paths.runtimeWorkspaceRoot);
      recordCaseResult('e2e-P0-11', 'PASSED', { startedAt, endedAt: new Date().toISOString() });
    } catch (e: any) {
      recordCaseResult('e2e-P0-11', 'FAILED', { safeReason: e?.message ?? String(e), startedAt, endedAt: new Date().toISOString() });
      throw e;
    }
  }, 30_000);

  it('lets a sandbox tool read an uploaded attachment before answering', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'nextagent-pj-11-tool-'));
    dirs.push(dir);
    const port = await reserveFreePort();
    const marker = 'SITE=LZ-EDGE-17';
    const modelRequests: ModelInvocationRequest[] = [];
    const app = createNextAgentTestApp({
      workspaceDir: dir,
      channelPort: port,
      modelRequestSink: modelRequests,
      modelSteps: [
        {
          toolCalls: [
            {
              toolCallId: 'tool-e2e-attachment-read',
              toolName: 'Python',
              arguments: {
                code: [
                  'import json, os',
                  "attachment_path = json.loads(os.environ['FILE_PATHS'])[0]",
                  "with open(attachment_path, encoding='utf-8') as attachment_file:",
                  '    print(attachment_file.read().strip())',
                ].join('\n'),
                timeout_ms: 10_000,
              },
            },
          ],
        },
        { content: 'The uploaded site is LZ-EDGE-17 and its RRC setup rate is healthy.' },
      ],
    });

    try {
      await app.start();
      const baseUrl = `http://127.0.0.1:${port}`;
      const sessionResponse = await fetch(`${baseUrl}/api/v1/sessions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      });
      const session = (await sessionResponse.json()) as { readonly sessionId: string };
      const tempRunId = crypto.randomUUID();
      const formData = new FormData();
      formData.append('tempRunId', tempRunId);
      formData.append('file', new Blob([`${marker}\nRRC_SETUP_SUCCESS_RATE=99.8%\n`], { type: 'text/markdown' }), 'site-health.md');
      expect((await fetch(`${baseUrl}/api/v1/sessions/${session.sessionId}/files/upload`, { method: 'POST', body: formData })).status).toBe(200);

      const submit = await fetch(`${baseUrl}/api/v1/sessions/${session.sessionId}/requests`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          inputText: 'Read the uploaded site health report and answer the site and RRC health.',
          idempotencyKey: `e2e-11-tool-${crypto.randomUUID()}`,
          attachments: [{ tempRunId, fileName: 'site-health.md' }],
        }),
      });
      expect(submit.status).toBe(200);
      const accepted = (await submit.json()) as { readonly sessionId: string; readonly requestId: string; readonly runId: string };
      const streamBody = await (
        await fetch(`${baseUrl}/api/v1/sessions/${accepted.sessionId}/stream?lastSeenSequence=0&runId=${accepted.runId}`)
      ).text();
      expect(streamBody).toContain('tool-e2e-attachment-read');
      expect(streamBody).toContain('event: CAPABILITY_COMPLETED');
      expect(streamBody).toContain('The uploaded site is LZ-EDGE-17');

      const messages = await app.gateway.messages.listCurrentRequestMessages({
        tenantId: identity.tenantId,
        subjectId: identity.subjectId,
        agentId,
        sessionId: brand<string, 'SessionId'>(accepted.sessionId),
        requestId: brand<string, 'MessageId'>(accepted.requestId),
        runId: brand<string, 'RequestRunId'>(accepted.runId),
        includeHidden: false,
        offset: 0,
        limit: 20,
      });
      expect(messages.items.find((message) => message.role === 'CAPABILITY_RESULT')?.content).toContain(marker);
      expect(modelRequests).toHaveLength(2);
      expect(requestText(modelRequests[0]!)).not.toContain(marker);
      expect(requestText(modelRequests[1]!)).toContain(marker);
      await expectMaterializedAttachmentsCleaned(app.systemConfig.paths.runtimeWorkspaceRoot);
    } finally {
      // Global test lifecycle closes registered apps after each case.
    }
  }, 30_000);

  it('cleans materialized attachments when an attached request is canceled', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'nextagent-pj-11-cancel-'));
    dirs.push(dir);
    const port = await reserveFreePort();
    const app = createNextAgentTestApp({
      workspaceDir: dir,
      channelPort: port,
      modelSteps: [{ contentChunks: ['partial'], delayBeforeFinalMs: 750 }],
    });

    try {
      await app.start();
      const baseUrl = `http://127.0.0.1:${port}`;
      const sessionResponse = await fetch(`${baseUrl}/api/v1/sessions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      });
      const session = (await sessionResponse.json()) as { readonly sessionId: string };
      const tempRunId = crypto.randomUUID();
      const formData = new FormData();
      formData.append('tempRunId', tempRunId);
      formData.append('file', new Blob(['# attachment\ncontent\n'], { type: 'text/markdown' }), 'cancel-notes.md');
      expect((await fetch(`${baseUrl}/api/v1/sessions/${session.sessionId}/files/upload`, { method: 'POST', body: formData })).status).toBe(200);

      const submit = await fetch(`${baseUrl}/api/v1/sessions/${session.sessionId}/requests`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          inputText: 'Cancel attached request.',
          idempotencyKey: `e2e-11-cancel-${crypto.randomUUID()}`,
          attachments: [{ tempRunId, fileName: 'cancel-notes.md' }],
        }),
      });
      const accepted = (await submit.json()) as { readonly sessionId: string; readonly requestId: string; readonly runId: string };
      expect(submit.status).toBe(200);
      expect(
        (
          await fetch(`${baseUrl}/api/v1/sessions/${accepted.sessionId}/cancel`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ expectedLatestRequestId: accepted.requestId, idempotencyKey: `e2e-11-cancel-action-${crypto.randomUUID()}` }),
          })
        ).status,
      ).toBe(200);

      for (let attempt = 0; attempt < 10; attempt += 1) {
        const stream = await fetch(`${baseUrl}/api/v1/sessions/${accepted.sessionId}/stream?lastSeenSequence=0&runId=${accepted.runId}`);
        if ((await stream.text()).includes('event: REQUEST_CANCELED')) {
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 75));
      }
      await expectMaterializedAttachmentsCleaned(app.systemConfig.paths.runtimeWorkspaceRoot);
    } finally {
      // Global test lifecycle closes registered apps after each case.
    }
  }, 30_000);
});

function requestText(request: ModelInvocationRequest): string {
  return request.messages
    .flatMap((message) =>
      message.content.flatMap((part) => {
        if (part.type === 'text') {
          return [part.text];
        }
        if (part.type === 'tool-result') {
          return [JSON.stringify(part.output)];
        }
        return [];
      }),
    )
    .join('\n');
}

async function expectMaterializedAttachmentsCleaned(runtimeWorkspaceRoot: string): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const entries = await readdir(runtimeWorkspaceRoot, { recursive: true }).catch(() => [] as string[]);
    if (!entries.some((entry) => entry.replaceAll('\\', '/').includes('/attachments/'))) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error('Materialized attachment view was not cleaned after terminal commit.');
}
