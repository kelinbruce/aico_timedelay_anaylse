import { createNextAgentTestApp } from '@nextagent/agent-platform-gateway-local/testing';
import type { RuntimeLogger, RuntimeLogLevel } from '@nextagent/agent-common';
import { createServer } from 'node:http';
import { describe, it } from 'vitest';

const APP_PORT = 3100;
const PROXY_PORT = 3200;

const structuredLogs: Array<Record<string, unknown>> = [];
const auditLogs: string[] = [];

const capture =
  (level: RuntimeLogLevel) =>
  (fields: object): void => {
    structuredLogs.push({ ...fields, level });
  };
const capturingObservationLogger: RuntimeLogger = {
  debug: capture('debug'),
  info: capture('info'),
  warn: capture('warn'),
  error: capture('error'),
};

describe('Task channel test harness', () => {
  it('starts interactive test proxy', async () => {
    const app = createNextAgentTestApp({
      workspaceDir: process.cwd(),
      modelSteps: [{ contentChunks: ['Diagnostic check complete. All systems nominal.'] }],
      channelPort: APP_PORT,
      observationLogger: capturingObservationLogger,
    });

    await app.server.listen({ host: '127.0.0.1', port: APP_PORT });

    const proxy = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (chunk: Buffer) => chunks.push(chunk));
      req.on('end', async () => {
        try {
          const request = JSON.parse(Buffer.concat(chunks).toString('utf8')) as {
            method?: string;
            url: string;
            headers?: Record<string, string>;
            body?: unknown;
          };

          structuredLogs.length = 0;
          auditLogs.length = 0;

          const originalWrite = process.stdout.write.bind(process.stdout);
          (process.stdout as { write: (...args: unknown[]) => boolean }).write = (chunk: unknown): boolean => {
            const text = typeof chunk === 'string' ? chunk : Buffer.from(String(chunk)).toString('utf8');
            if (text.trim().startsWith('{')) {
              auditLogs.push(text.trim());
            }
            return true;
          };

          try {
            const controller = new AbortController();
            const isStream = request.url.includes('/stream') || request.url.includes('/ws');
            const timeoutMs = isStream ? 8_000 : 30_000;
            const timer = setTimeout(() => controller.abort(), timeoutMs);

            const response = await fetch(`http://127.0.0.1:${APP_PORT}${request.url}`, {
              method: request.method ?? 'POST',
              headers: { ...(request.headers ?? {}) },
              ...(request.body !== undefined ? { body: JSON.stringify(request.body) } : {}),
              signal: controller.signal,
            });

            if (!isStream) {
              clearTimeout(timer);
            }

            await new Promise((resolve) => setTimeout(resolve, isStream ? 5_000 : 300));

            let responseText: string;
            if (isStream) {
              const reader = response.body!.getReader();
              const decoder = new TextDecoder();
              let collected = '';
              try {
                while (true) {
                  const { done, value } = await reader.read();
                  if (done) {
                    break;
                  }
                  collected += decoder.decode(value, { stream: true });
                  if (collected.includes('TASK_COMPLETED') || collected.includes('TASK_FAILED') || collected.includes('TASK_CANCELED')) {
                    break;
                  }
                }
              } catch {
                // Abort timeout reached, return what we have
              }
              responseText = collected;
              clearTimeout(timer);
            } else {
              responseText = await response.text();
              clearTimeout(timer);
            }

            let responseBody: unknown = responseText;
            try {
              responseBody = JSON.parse(responseText);
            } catch {
              // Keep as text for SSE streams
            }

            const result = {
              statusCode: response.status,
              body: responseBody,
              logs: {
                audit: auditLogs.slice(),
                structured: structuredLogs.slice(),
              },
            };

            res.writeHead(200, { 'content-type': 'application/json' });
            res.end(JSON.stringify(result, null, 2));
          } finally {
            (process.stdout as { write: (...args: unknown[]) => boolean }).write = originalWrite as unknown as (...args: unknown[]) => boolean;
          }
        } catch (error) {
          res.writeHead(500, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ error: String(error) }));
        }
      });
    });

    await new Promise<void>((resolve) => proxy.listen(PROXY_PORT, '127.0.0.1', resolve));

    const examples = [
      {
        title: '1. Create task (SSE)',
        request: {
          method: 'POST',
          url: '/api/v1/task',
          headers: { 'x-tenant-id': 'e2e-task-tenant', 'x-subject-id': 'e2e-task-user', 'content-type': 'application/json' },
          body: { inputText: 'Run diagnostic.', mode: 'sse', idempotencyKey: 'test-create-1' },
        },
      },
      {
        title: '2. SSE stream (replace TASK_ID)',
        request: {
          method: 'GET',
          url: '/api/v1/task/TASK_ID/stream?lastSeenSequence=0',
          headers: { 'x-tenant-id': 'e2e-task-tenant', 'x-subject-id': 'e2e-task-user' },
        },
      },
      {
        title: '3. Edit (replace TASK_ID, REQUEST_ID)',
        request: {
          method: 'POST',
          url: '/api/v1/task/TASK_ID/edit',
          headers: { 'x-tenant-id': 'e2e-task-tenant', 'x-subject-id': 'e2e-task-user', 'content-type': 'application/json' },
          body: { expectedLatestRequestId: 'REQUEST_ID', editedInputText: 'Edited prompt.', idempotencyKey: 'test-edit-1' },
        },
      },
      {
        title: '4. Retry (replace TASK_ID, REQUEST_ID)',
        request: {
          method: 'POST',
          url: '/api/v1/task/TASK_ID/retry',
          headers: { 'x-tenant-id': 'e2e-task-tenant', 'x-subject-id': 'e2e-task-user', 'content-type': 'application/json' },
          body: { expectedLatestRequestId: 'REQUEST_ID', idempotencyKey: 'test-retry-1' },
        },
      },
      {
        title: '5. Cancel (replace TASK_ID, REQUEST_ID)',
        request: {
          method: 'POST',
          url: '/api/v1/task/TASK_ID/cancel',
          headers: { 'x-tenant-id': 'e2e-task-tenant', 'x-subject-id': 'e2e-task-user', 'content-type': 'application/json' },
          body: { expectedLatestRequestId: 'REQUEST_ID', idempotencyKey: 'test-cancel-1' },
        },
      },
      {
        title: '6. Missing identity (expect 401)',
        request: {
          method: 'POST',
          url: '/api/v1/task',
          headers: { 'content-type': 'application/json' },
          body: { inputText: 'no identity', mode: 'sse', idempotencyKey: 'test-noauth-1' },
        },
      },
    ];

    console.log('\n' + '='.repeat(70));
    console.log('  Task Channel Test Harness');
    console.log('='.repeat(70));
    console.log(`\n  NextAgent:  http://127.0.0.1:${APP_PORT}`);
    console.log(`  Test Proxy: http://127.0.0.1:${PROXY_PORT}`);
    console.log('\n  POST to proxy with: {"method", "url", "headers", "body"}');
    console.log('  Response includes: statusCode, body, logs (audit + structured)\n');

    for (const ex of examples) {
      console.log(`  --- ${ex.title} ---`);
      console.log(`  curl -X POST http://127.0.0.1:${PROXY_PORT} -H "Content-Type: application/json" -d '${JSON.stringify(ex.request)}'\n`);
    }

    console.log('  Press Ctrl+C to stop.\n');
    console.log('='.repeat(70) + '\n');

    await new Promise<void>(() => {});
  }, 86_400_000);
});
