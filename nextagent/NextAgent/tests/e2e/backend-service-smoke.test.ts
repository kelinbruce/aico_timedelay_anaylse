import { createNextAgentTestApp } from '@nextagent/agent-platform-gateway-local/testing';
import { createServer } from 'node:net';
import { describe, expect, it } from 'vitest';

describe('backend service startup smoke', () => {
  it('starts an HTTP service and accepts a QA request', async () => {
    const port = await reserveFreePort();
    const app = createNextAgentTestApp({
      workspaceDir: process.cwd(),
      channelPort: port,
      modelSteps: [{ contentChunks: ['LTE KPI', ' RRC setup success rate is healthy.'] }],
    });

    await app.start();
    const baseUrl = `http://127.0.0.1:${port}`;
    const accepted = await fetch(`${baseUrl}/api/v1/requests`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        inputText: 'Check LTE KPI health.',
        idempotencyKey: `smoke-${crypto.randomUUID()}`,
        locale: 'en-US',
      }),
    });

    expect(accepted.status).toBe(200);
    const acceptedBody = (await accepted.json()) as { sessionId: string; requestId: string; runId: string; attempt: number };
    expect(acceptedBody).toMatchObject({ attempt: 1 });

    const stream = await fetch(`${baseUrl}/api/v1/sessions/${acceptedBody.sessionId}/stream?lastSeenSequence=0&runId=${acceptedBody.runId}`);
    expect(stream.status).toBe(200);
    const streamBody = await stream.text();
    expect(streamBody).toContain('event: REQUEST_COMPLETED');
    expect(streamBody).toContain('LTE KPI');
    expect(streamBody).toContain('"content":"LTE KPI"');
    expect(streamBody).toContain('"content":"LTE KPI RRC setup success rate is healthy."');

    const conversation = await fetch(`${baseUrl}/api/v1/sessions/${acceptedBody.sessionId}/conversation?limit=10`);
    expect(conversation.status).toBe(200);
    const history = (await conversation.json()) as { items: Array<{ role: string; content: string }> };
    expect(history.items.map((item) => item.role)).toEqual(['USER', 'ASSISTANT']);
    expect(history.items.at(-1)?.content).toContain('RRC setup success rate');
  }, 20_000);

  it('streams content and thinking deltas as cumulative snapshots', async () => {
    const port = await reserveFreePort();
    const app = createNextAgentTestApp({
      workspaceDir: process.cwd(),
      channelPort: port,
      modelSteps: [
        {
          reasoningChunks: ['plan', ' next'],
          contentChunks: ['LTE KPI', ' is healthy.'],
        },
      ],
    });

    await app.start();
    const baseUrl = `http://127.0.0.1:${port}`;
    const accepted = await fetch(`${baseUrl}/api/v1/requests`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        inputText: 'Check LTE KPI health.',
        idempotencyKey: `snapshot-${crypto.randomUUID()}`,
        locale: 'en-US',
      }),
    });
    const acceptedBody = (await accepted.json()) as { sessionId: string; runId: string };
    const stream = await fetch(`${baseUrl}/api/v1/sessions/${acceptedBody.sessionId}/stream?lastSeenSequence=0&runId=${acceptedBody.runId}`);
    const events = parseSseEvents(await stream.text());

    const thinkingEvents = events.filter((event) => event.eventType === 'LLM_THINKING_DELTA');
    expect(thinkingEvents.map((event) => event.payload.reasoning)).toEqual(['plan', 'plan next', 'plan next']);
    expect(events.filter((event) => event.eventType === 'LLM_CONTENT_DELTA').map((event) => event.payload.content)).toEqual([
      'LTE KPI',
      'LTE KPI is healthy.',
      'LTE KPI is healthy.',
    ]);
  }, 20_000);
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

function parseSseEvents(text: string): Array<{ eventType: string; payload: { content?: string; reasoning?: string } }> {
  return text
    .split(/\n/u)
    .filter((line) => line.startsWith('data: '))
    .map((line) => JSON.parse(line.slice(6)) as { eventType: string; payload: { content?: string; reasoning?: string } });
}
