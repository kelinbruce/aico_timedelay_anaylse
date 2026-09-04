/**
 * E2E Case: feature-tree smoke - 内置工具.
 * Entry: model-issued built-in Read tool call through capability runtime.
 */
import { createNextAgentTestApp } from '@nextagent/agent-platform-gateway-local/testing';
import { expect, it } from 'vitest';
import { describeRealModelSmoke, submitAndWaitForSession } from './system-smoke-helpers.js';

describeRealModelSmoke('feature-tree smoke: 内置工具', () => {
  it('executes the built-in Read tool and exposes a safe capability result', async () => {
    const app = createNextAgentTestApp({
      workspaceDir: process.cwd(),
      modelSteps: [
        {
          toolCalls: [{ toolCallId: 'builtin-read-smoke', toolName: 'Read', arguments: { file_path: 'package.json', offset: 0, limit: 1 } }],
        },
        { content: 'Builtin tool smoke completed.' },
      ],
    });

    const result = await submitAndWaitForSession(app, 'Run built-in tool smoke.', 'Builtin tool smoke completed.', 'builtin-tool');
    expect(result.streamBody).toContain('builtin-read-smoke');

    const conversation = await app.server.inject({
      method: 'GET',
      url: `/api/v1/sessions/${result.sessionId}/conversation?limit=10&includeCapabilityResults=true`,
    });
    expect(conversation.statusCode).toBe(200);
    expect(conversation.body).toContain('"toolName":"Read"');
  });
});
