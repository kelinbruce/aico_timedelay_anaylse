/**
 * E2E Case: feature-tree smoke - 模型管理.
 * Entry: app composition model profile -> model invocation service -> stream projection.
 */
import { createNextAgentTestApp } from '@nextagent/agent-platform-gateway-local/testing';
import type { ModelInvocationRequest } from '@nextagent/agent-contracts/model';
import { expect, it } from 'vitest';
import { describeRealModelSmoke, submitAndWaitForSession } from './system-smoke-helpers.js';

describeRealModelSmoke('feature-tree smoke: 模型管理', () => {
  it('uses the configured deterministic model profile in the real request path', async () => {
    const modelRequests: ModelInvocationRequest[] = [];
    const app = createNextAgentTestApp({
      workspaceDir: process.cwd(),
      modelSteps: [{ content: 'Model management smoke completed.' }],
      modelRequestSink: modelRequests,
    });

    await submitAndWaitForSession(app, 'Run model management smoke.', 'Model management smoke completed.', 'model-management');
    expect(modelRequests.length).toBeGreaterThan(0);
    expect(JSON.stringify(modelRequests[0])).toContain('deterministic-test-model');
  });
});
