import { createAppCredentialResolver, createNextAgentApp } from '@nextagent/agent-platform-gateway-local/testing';
import { createServer } from 'node:net';
import { describe, expect, it } from 'vitest';
import { withRealModelSmokeLock } from './system-smoke-helpers.js';

const hasRealModelConfig =
  typeof process.env.OPENAI_API_KEY === 'string' &&
  process.env.OPENAI_API_KEY.length > 0 &&
  typeof process.env.OPENAI_MODEL_NAME === 'string' &&
  process.env.OPENAI_MODEL_NAME.length > 0 &&
  typeof process.env.OPENAI_BASE_URL === 'string' &&
  process.env.OPENAI_BASE_URL.length > 0;

describe.skipIf(!hasRealModelConfig)('real model product path smoke', () => {
  it('starts the service, uses the OpenAI adapter, and completes a QA request over HTTP', async () => {
    await withRealModelSmokeLock(async () => {
      const port = await reserveFreePort();
      const app = createNextAgentApp({
        channelPort: port,
        credentialResolver: createAppCredentialResolver(process.env),
      });

      await app.start();
      const baseUrl = `http://127.0.0.1:${port}`;
      let lastStreamBody = '';
      for (let attempt = 1; attempt <= 3; attempt += 1) {
        const accepted = await fetch(`${baseUrl}/api/v1/requests`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            inputText: 'Reply with one short sentence about LTE KPI.',
            routingConstraints: { executionMode: 'model-only' },
            idempotencyKey: `idem-openai-smoke-${attempt}-${crypto.randomUUID()}`,
          }),
        });
        expect(accepted.status).toBe(200);
        const body = (await accepted.json()) as { sessionId: string; requestId: string; runId: string; attempt: number };
        expect(body).toMatchObject({ attempt: 1 });

        const stream = await fetch(`${baseUrl}/api/v1/sessions/${body.sessionId}/stream?lastSeenSequence=0&runId=${body.runId}`);
        expect(stream.status).toBe(200);
        const streamBody = await stream.text();
        lastStreamBody = streamBody;
        expect(streamBody).toContain('event: REQUEST_ACCEPTED');

        if (!streamBody.includes('event: LLM_CONTENT_DELTA') || !streamBody.includes('event: REQUEST_COMPLETED')) {
          continue;
        }

        const conversation = await fetch(`${baseUrl}/api/v1/sessions/${body.sessionId}/conversation?limit=10`);
        expect(conversation.status).toBe(200);
        const history = (await conversation.json()) as { items: Array<{ role: string; content: string }> };
        expect(history.items.map((item) => item.role)).toEqual(['USER', 'ASSISTANT']);
        expect(history.items.at(-1)?.content.length).toBeGreaterThan(0);
        return;
      }

      expect(lastStreamBody).toContain('event: LLM_CONTENT_DELTA');
      expect(lastStreamBody).toContain('event: REQUEST_COMPLETED');
    });
  }, 180_000);
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
      server.close((error) => {
        if (error !== undefined) {
          reject(error);
          return;
        }
        resolve(port);
      });
    });
  });
}
