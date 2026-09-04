/**
 * E2E Case: feature-tree smoke - 性能.
 * Entry: request acceptance latency and terminal stream completion on local providers.
 */
import { createNextAgentTestApp } from '@nextagent/agent-platform-gateway-local/testing';
import { expect, it } from 'vitest';
import { describeRealModelSmoke, idem, waitForSessionStream } from './system-smoke-helpers.js';

describeRealModelSmoke('feature-tree smoke: 性能', () => {
  it('accepts a local smoke request under the system latency budget and completes the stream', async () => {
    const app = createNextAgentTestApp({
      workspaceDir: process.cwd(),
      modelSteps: [{ content: 'Performance smoke completed.' }],
    });

    const startedAt = Date.now();
    const accepted = await app.server.inject({
      method: 'POST',
      url: '/api/v1/requests',
      payload: { inputText: 'Run performance smoke.', idempotencyKey: idem('performance') },
    });
    const acceptanceLatencyMs = Date.now() - startedAt;
    expect(accepted.statusCode).toBe(200);
    expect(acceptanceLatencyMs).toBeLessThan(500);

    const body = accepted.json<{ sessionId: string; runId: string }>();
    const streamBody = await waitForSessionStream(app, body.sessionId, body.runId, 'Performance smoke completed.');
    expect(streamBody).toContain('event: REQUEST_COMPLETED');
  });
});
