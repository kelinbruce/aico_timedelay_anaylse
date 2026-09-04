/**
 * E2E Case: feature-tree smoke - 安全.
 * Entry: auth boundary and safe validation error projection.
 */
import { createNextAgentTestApp } from '@nextagent/agent-platform-gateway-local/testing';
import { expect, it } from 'vitest';
import { describeRealModelSmoke, idem } from './system-smoke-helpers.js';

describeRealModelSmoke('feature-tree smoke: 安全', () => {
  it('rejects untrusted task identity and keeps validation errors sanitized', async () => {
    const app = createNextAgentTestApp({ workspaceDir: process.cwd(), modelSteps: [{ content: 'unused' }] });

    const unauthorized = await app.server.inject({
      method: 'POST',
      url: '/api/v1/stream-task',
      payload: {
        taskMessages: [{ text: 'missing identity' }],
        idempotencyKey: idem('security-task'),
      },
    });
    expect(unauthorized.statusCode).toBe(401);
    expect(unauthorized.body).toContain('IDENTITY_RESOLUTION_FAILED');

    const invalid = await app.server.inject({
      method: 'POST',
      url: '/api/v1/requests',
      payload: { inputText: '', idempotencyKey: idem('security-invalid') },
    });
    expect(invalid.statusCode).toBe(400);
    expect(invalid.body).not.toContain(process.cwd());
    expect(invalid.body).not.toContain('NEXTAGENT_TEST_ONLY');
  });
});
