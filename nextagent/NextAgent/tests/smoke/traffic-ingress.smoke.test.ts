/**
 * E2E Case: feature-tree smoke - 流量接入.
 * Entry: Web HTTP submit + SSE stream replay over the real Fastify route stack.
 */
import { createNextAgentTestApp } from '@nextagent/agent-platform-gateway-local/testing';
import { expect, it } from 'vitest';
import { describeRealModelSmoke, idem, submitAndWaitForSession, taskHeaders } from './system-smoke-helpers.js';

describeRealModelSmoke('feature-tree smoke: 流量接入', () => {
  it('accepts Web API traffic and delivers request lifecycle events over SSE', async () => {
    const app = createNextAgentTestApp({
      workspaceDir: process.cwd(),
      modelSteps: [{ contentChunks: ['Traffic ingress', ' smoke completed.'] }],
    });

    const result = await submitAndWaitForSession(app, 'Run traffic ingress smoke.', 'Traffic ingress smoke completed.', 'traffic-ingress');
    expect(result.streamBody).toContain('event: REQUEST_ACCEPTED');
    expect(result.streamBody).toContain('event: LLM_CONTENT_DELTA');
    expect(result.streamBody).toContain('event: REQUEST_COMPLETED');
  });

  it('accepts task-channel traffic and completes scoped SSE delivery', async () => {
    const app = createNextAgentTestApp({
      workspaceDir: process.cwd(),
      modelSteps: [{ contentChunks: ['Task channel', ' smoke completed.'] }],
    });

    const stream = await app.server.inject({
      method: 'POST',
      url: '/api/v1/stream-task',
      headers: { ...taskHeaders, 'content-type': 'application/json' },
      payload: {
        taskMessages: [
          {
            text: 'Run task channel smoke.',
            metadata: { source: 'system-smoke' },
          },
        ],
        idempotencyKey: idem('task-channel'),
      },
    });
    expect(stream.statusCode).toBe(200);
    expect(stream.body).toContain('event: TASK_ACCEPTED');
    expect(stream.body).toContain('event: CONTENT_DELTA');
    expect(stream.body).toContain('Task channel smoke completed.');
    expect(stream.body).toContain('event: TASK_COMPLETED');
  });
});
