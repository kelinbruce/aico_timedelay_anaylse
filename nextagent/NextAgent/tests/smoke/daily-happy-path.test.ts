import { createNextAgentTestApp } from '@nextagent/agent-platform-gateway-local/testing';
import { expect, it } from 'vitest';
import { describeRealModelSmoke } from './system-smoke-helpers.js';

describeRealModelSmoke('daily happy path smoke', () => {
  it('covers readiness, fail-closed validation, capability execution, model streaming, and conversation history', async () => {
    const app = createNextAgentTestApp({
      workspaceDir: process.cwd(),
      modelSteps: [
        {
          toolCalls: [
            { toolCallId: 'tool-read-smoke', toolName: 'Read', arguments: { file_path: 'package.json', offset: 0, limit: 1 } },
            { toolCallId: 'tool-skill-smoke', toolName: 'Skill', arguments: { name: 'skill-creator', args: { alarm: 'LOS' } } },
          ],
        },
        { contentChunks: ['LTE KPI', ' RRC setup success rate is healthy.'] },
      ],
    });

    const health = await app.server.inject({ method: 'GET', url: '/health' });
    expect(health.statusCode).toBe(200);
    expect(health.json<{ status: string }>().status).toBe('UP');

    const bootstrap = await app.server.inject({ method: 'GET', url: '/api/v1/runtime/bootstrap' });
    expect(bootstrap.statusCode).toBe(200);
    expect(bootstrap.json<{ transportKind: string; chatUploadFileConfig?: unknown }>()).toEqual(
      expect.objectContaining({
        transportKind: 'SSE',
        chatUploadFileConfig: expect.objectContaining({
          chatUploadFileType: ['*.md', '*.markdown'],
          chatUploadMaxFileNumber: 10,
          chatUploadMaxFileSize: 10,
          uploadFileIdleExpireTime: 5,
          uploadFileMaxExpireTime: 30,
        }),
      }),
    );

    const sessions = await app.server.inject({ method: 'GET', url: '/api/v1/sessions?limit=10' });
    expect(sessions.statusCode).toBe(200);
    expect(sessions.json<{ entries: unknown[]; hasMore: boolean }>()).toMatchObject({ entries: [], hasMore: false });

    const rejected = await app.server.inject({
      method: 'POST',
      url: '/api/v1/requests',
      payload: { inputText: '', idempotencyKey: idempotencyKey('invalid-input') },
    });

    expect(rejected.statusCode).toBe(400);
    expect(rejected.body).toContain('REQUEST_VALIDATION_FAILED');
    expect(rejected.body).not.toContain(process.cwd());
    expect(rejected.body).not.toContain('NEXTAGENT_TEST_ONLY');

    const accepted = await app.server.inject({
      method: 'POST',
      url: '/api/v1/requests',
      payload: { inputText: 'Read package metadata, then check LTE KPI health.', idempotencyKey: idempotencyKey('single-turn'), locale: 'en-US' },
    });

    expect(accepted.statusCode).toBe(200);
    const body = accepted.json<{ sessionId: string; runId: string }>();
    const streamBody = await expectCompletedStream(app, body.sessionId, body.runId, 'LTE KPI RRC setup success rate is healthy.');
    expect(streamBody).toContain('tool-read-smoke');
    expect(streamBody).toContain('tool-skill-smoke');
    expect(streamBody).toContain('event: LLM_CONTENT_DELTA');
    expect(streamBody).toContain('event: REQUEST_COMPLETED');

    const conversation = await app.server.inject({
      method: 'GET',
      url: `/api/v1/sessions/${body.sessionId}/conversation?limit=10&includeCapabilityResults=true`,
    });
    expect(conversation.statusCode).toBe(200);
    const history = conversation.json<{ items: Array<{ role: string; content: string; metadata?: Record<string, unknown> }> }>();
    expect(history.items.map((item) => item.role)).toEqual(['USER', 'CAPABILITY_RESULT', 'CAPABILITY_RESULT', 'ASSISTANT']);
    expect(history.items.some((item) => item.role === 'CAPABILITY_RESULT' && item.metadata?.['toolName'] === 'Read')).toBe(true);
    expect(history.items.some((item) => item.role === 'CAPABILITY_RESULT' && item.metadata?.['toolName'] === 'Skill')).toBe(true);
    expect(history.items.at(-1)?.content).toContain('RRC setup success rate');
  });
});

async function expectCompletedStream(
  app: ReturnType<typeof createNextAgentTestApp>,
  sessionId: string,
  runId: string,
  content: string,
  timeoutMs = 5_000,
): Promise<string> {
  let streamBody = '';
  await waitFor(async () => {
    const stream = await app.server.inject({ method: 'GET', url: `/api/v1/sessions/${sessionId}/stream?lastSeenSequence=0&runId=${runId}` });
    expect(stream.statusCode).toBe(200);
    streamBody = stream.body;
    return streamBody.includes('event: REQUEST_COMPLETED') && streamBody.includes(content);
  }, timeoutMs);
  return streamBody;
}

async function waitFor(assertion: () => boolean | Promise<boolean>, timeoutMs = 5_000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await assertion()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('Timed out waiting for smoke condition.');
}

function idempotencyKey(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}
