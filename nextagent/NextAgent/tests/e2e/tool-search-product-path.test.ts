import { brand } from '@nextagent/agent-common';
import { loadBuiltInDefaultAgentDefinition } from '@nextagent/agent-platform-gateway-local/testing';
import { cleanupE2ETestContext, createE2ETestContext } from './e2e-helpers.js';
import { describe, expect, it } from 'vitest';

describe('ToolSearch product path', () => {
  it('executes a model ToolSearch call over HTTP and exposes only safe governed Tool metadata', async () => {
    const toolCallId = 'tool-search-e2e';
    const ctx = await createE2ETestContext({
      tempPrefix: 'nextagent-tool-search-e2e-',
      toolDisclosureMode: 'tool-search',
      modelSteps: [
        {
          toolCalls: [
            {
              toolCallId,
              toolName: 'ToolSearch',
              arguments: { query: 'bounded slice', limit: 5 },
            },
          ],
        },
        { content: 'ToolSearch completed.' },
      ],
    });

    try {
      const accepted = await fetch(`${ctx.baseUrl}/api/v1/requests`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          inputText: 'Find the governed read tool before answering.',
          idempotencyKey: `tool-search-e2e-${crypto.randomUUID()}`,
        }),
      });

      expect(accepted.status).toBe(200);
      const body = (await accepted.json()) as { sessionId: string; runId: string };
      const stream = await fetch(`${ctx.baseUrl}/api/v1/sessions/${body.sessionId}/stream?lastSeenSequence=0&runId=${body.runId}`);
      expect(stream.status).toBe(200);
      const streamBody = await stream.text();

      expect(streamBody).toContain('event: CAPABILITY_STARTED');
      expect(streamBody).toContain('event: CAPABILITY_COMPLETED');
      expect(streamBody).toContain('event: REQUEST_COMPLETED');
      expect(streamBody).toContain(toolCallId);
      expect(streamBody).toContain('"capabilityId":"ToolSearch"');
      expect(streamBody).not.toContain('"capability_id":"Read"');
      expect(streamBody).not.toContain('inputSchema');
      expect(streamBody).not.toContain('outputSchema');
      expect(streamBody).not.toContain('providerId');
      expect(streamBody).not.toContain(ctx.workspaceDir);

      const conversation = await fetch(`${ctx.baseUrl}/api/v1/sessions/${body.sessionId}/conversation?limit=20&includeCapabilityResults=true`);
      expect(conversation.status).toBe(200);
      const history = (await conversation.json()) as { items: Array<{ role: string; content: string; metadata?: Record<string, unknown> }> };
      const capabilityResult = history.items.find((item) => item.role === 'CAPABILITY_RESULT' && item.metadata?.['toolName'] === 'ToolSearch');
      expect(capabilityResult).toBeDefined();
      expect(capabilityResult?.content).toBe('');
      expect(history.items.at(-1)).toMatchObject({ role: 'ASSISTANT', content: 'ToolSearch completed.' });
    } finally {
      await cleanupE2ETestContext(ctx);
    }
  });

  it('does not disclose a disabled Tool over the HTTP runtime path', async () => {
    const toolCallId = 'tool-search-disabled-e2e';
    const defaultAgent = loadBuiltInDefaultAgentDefinition();
    const ctx = await createE2ETestContext({
      tempPrefix: 'nextagent-tool-search-disabled-e2e-',
      toolDisclosureMode: 'tool-search',
      agentDefinition: {
        ...defaultAgent,
        capabilityBindings: [
          ...defaultAgent.capabilityBindings,
          { capabilityId: brand<string, 'CapabilityId'>('Read'), capabilityType: 'TOOL', providerId: 'builtin-tools', enabled: false },
        ],
      },
      modelSteps: [
        {
          toolCalls: [
            {
              toolCallId,
              toolName: 'ToolSearch',
              arguments: { query: 'bounded slice', limit: 5 },
            },
          ],
        },
        { content: 'Disabled ToolSearch completed.' },
      ],
    });

    try {
      const accepted = await fetch(`${ctx.baseUrl}/api/v1/requests`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          inputText: 'Try to find the disabled read tool.',
          idempotencyKey: `tool-search-disabled-e2e-${crypto.randomUUID()}`,
        }),
      });

      expect(accepted.status).toBe(200);
      const body = (await accepted.json()) as { sessionId: string; runId: string };
      const stream = await fetch(`${ctx.baseUrl}/api/v1/sessions/${body.sessionId}/stream?lastSeenSequence=0&runId=${body.runId}`);
      expect(stream.status).toBe(200);
      const streamBody = await stream.text();

      expect(streamBody).toContain('event: CAPABILITY_COMPLETED');
      expect(streamBody).toContain('"capabilityId":"ToolSearch"');
      expect(streamBody).not.toContain('"capability_id":"Read"');

      const conversation = await fetch(`${ctx.baseUrl}/api/v1/sessions/${body.sessionId}/conversation?limit=20&includeCapabilityResults=true`);
      expect(conversation.status).toBe(200);
      const history = (await conversation.json()) as { items: Array<{ role: string; content: string; metadata?: Record<string, unknown> }> };
      const capabilityResult = history.items.find((item) => item.role === 'CAPABILITY_RESULT' && item.metadata?.['toolName'] === 'ToolSearch');
      expect(capabilityResult).toBeDefined();
      expect(capabilityResult?.content).toBe('');
      expect(history.items.at(-1)).toMatchObject({ role: 'ASSISTANT', content: 'Disabled ToolSearch completed.' });
    } finally {
      await cleanupE2ETestContext(ctx);
    }
  });
});
