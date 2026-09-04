/**
 * E2E Case: feature-tree smoke - 可靠可用性.
 * Entry: deep health and terminal SSE replay from persisted timeline.
 */
import { createNextAgentTestApp } from '@nextagent/agent-platform-gateway-local/testing';
import { expect, it } from 'vitest';
import { describeRealModelSmoke, submitAndWaitForSession, waitForSessionStream } from './system-smoke-helpers.js';

describeRealModelSmoke('feature-tree smoke: 可靠可用性', () => {
  it('reports deep health and replays terminal stream events after completion', async () => {
    const app = createNextAgentTestApp({
      workspaceDir: process.cwd(),
      modelSteps: [{ content: 'Reliability smoke completed.' }],
    });

    const deepHealth = await app.server.inject({ method: 'GET', url: '/health/deep' });
    expect(deepHealth.statusCode).toBe(200);
    expect(deepHealth.json<{ status: string }>().status).toBe('UP');

    const result = await submitAndWaitForSession(app, 'Run reliability smoke.', 'Reliability smoke completed.', 'reliability');
    const replay = await waitForSessionStream(app, result.sessionId, result.runId, 'Reliability smoke completed.');
    expect(replay).toContain('event: REQUEST_COMPLETED');
  });
});
