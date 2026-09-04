/**
 * E2E Case: feature-tree smoke - 兼容性.
 * Entry: real env-backed default system config and public bootstrap contract.
 */
import { createAppCredentialResolver, createNextAgentTestApp, resolveDefaultSystemConfig } from '@nextagent/agent-platform-gateway-local/testing';
import { expect, it } from 'vitest';
import { describeRealModelSmoke } from './system-smoke-helpers.js';

describeRealModelSmoke('feature-tree smoke: 兼容性', () => {
  it('resolves the env-backed default config while preserving Web bootstrap compatibility', async () => {
    const config = resolveDefaultSystemConfig({
      cwd: process.cwd(),
      credentialResolver: createAppCredentialResolver(process.env),
    });
    expect(config.modelProfiles[0]).toMatchObject({
      providerId: 'openai-compatible',
      models: [
        expect.objectContaining({
          modelId: process.env.OPENAI_MODEL_NAME,
          fallbackEligible: false,
        }),
      ],
    });
    expect(config.gatewaySelection.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ adapterKind: 'sqlite', deploymentMode: 'LOCAL', selectionState: 'enabled' }),
        expect.objectContaining({ adapterKind: 'workflow-execution', deploymentMode: 'LOCAL', selectionState: 'enabled' }),
        expect.objectContaining({ adapterKind: 'cron-tasks', deploymentMode: 'LOCAL', selectionState: 'enabled' }),
        expect.objectContaining({ adapterKind: 'rag-knowledge', deploymentMode: 'LOCAL', selectionState: 'enabled' }),
      ]),
    );

    const app = createNextAgentTestApp({ workspaceDir: process.cwd(), modelSteps: [{ content: 'unused' }] });
    const bootstrap = await app.server.inject({ method: 'GET', url: '/api/v1/runtime/bootstrap' });
    expect(bootstrap.statusCode).toBe(200);
    expect(bootstrap.json<{ transportKind: string }>()).toMatchObject({ transportKind: 'SSE' });
  });
});
