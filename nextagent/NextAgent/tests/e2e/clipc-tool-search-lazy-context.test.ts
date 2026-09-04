import { clipServerProviderType, type ClipCommandRunner } from '@nextagent/agent-capability';
import { loadBuiltInDefaultAgentDefinition } from '@nextagent/agent-platform-gateway-local/testing';
import { brand, type JsonObject } from '@nextagent/agent-common';
import type { ModelInvocationRequest } from '@nextagent/agent-contracts/model';
import { cleanupE2ETestContext, createE2ETestContext } from './e2e-helpers.js';
import { describe, expect, it, vi } from 'vitest';

const providerId = 'clip-backed';
const clipCount = 3;
const selectedCapabilityId = 'clipc-api-002';

describe('CLIP ToolSearch lazy context', () => {
  it('keeps CLIP APIs deferred until ToolSearch activates one ordinary tool', async () => {
    const requests: ModelInvocationRequest[] = [];
    const executeTool = vi.fn<ClipCommandRunner['executeTool']>(async () => ({ status: 'ok', api: selectedCapabilityId }));
    const describeTool = vi.fn<ClipCommandRunner['describeTool']>(async (_provider, _options, listedTool) =>
      toolFact(listedCapabilityId(listedTool), `clip-private-${listedCapabilityId(listedTool).slice('clipc-api-'.length)}`),
    );
    const defaultAgent = loadBuiltInDefaultAgentDefinition();
    const ctx = await createE2ETestContext({
      tempPrefix: 'nextagent-clipc-lazy-context-e2e-',
      modelRequestSink: requests,
      toolDisclosureMode: 'tool-search',
      clipcDisclosureMode: 'tool-search',
      capabilityProviders: [
        {
          id: providerId,
          type: 'custom',
          adapter: clipServerProviderType,
          config: { enabled: true, clipPathRef: 'clipc', endpointRef: 'clip-daemon', timeoutMs: 5000, retry: { maxAttempts: 1 } },
        },
      ],
      clipCommandRunner: fakeClipRunner(executeTool, describeTool),
      agentDefinition: {
        ...defaultAgent,
        capabilityBindings: [
          ...defaultAgent.capabilityBindings,
          ...clipCapabilityIds().map((capabilityId) => ({
            capabilityId: brand<string, 'CapabilityId'>(capabilityId),
            capabilityType: 'TOOL' as const,
            providerId,
            enabled: true,
          })),
        ],
      },
      modelSteps: [
        {
          toolCalls: [
            {
              toolCallId: 'clipc-search-002',
              toolName: 'ToolSearch',
              arguments: { query: selectedCapabilityId, limit: 5 },
            },
          ],
        },
        {
          toolCalls: [
            {
              toolCallId: 'clipc-call-002',
              toolName: selectedCapabilityId,
              arguments: { neId: 'NE-002', apiQuery: 'radio access kpi' },
            },
          ],
        },
        { content: 'CLIP ToolSearch lazy context verified.' },
      ],
    });

    try {
      const assembly = await ctx.app.assemblyRegistry.require(brand<string, 'AgentId'>('default-agent'), brand<string, 'AgentVersion'>('v1'));
      expect(assembly.capabilityBindings.filter((binding) => binding.providerId === providerId).map((binding) => binding.capabilityId)).toContain(
        selectedCapabilityId,
      );
      const accepted = await fetch(`${ctx.baseUrl}/api/v1/requests`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          inputText: 'Find the CLIP API 002 and call it for NE-002.',
          idempotencyKey: `clipc-lazy-context-e2e-${crypto.randomUUID()}`,
        }),
      });

      expect(accepted.status).toBe(200);
      const body = (await accepted.json()) as { sessionId: string; runId: string };
      const stream = await fetch(`${ctx.baseUrl}/api/v1/sessions/${body.sessionId}/stream?lastSeenSequence=0&runId=${body.runId}`);
      expect(stream.status).toBe(200);
      const streamBody = await stream.text();

      expect(streamBody).toContain('event: CAPABILITY_COMPLETED');
      expect(streamBody).toContain('"toolCallId":"clipc-search-002"');
      expect(streamBody).toContain('"toolCallId":"clipc-call-002"');
      expect(streamBody).toContain(`"capabilityId":"${selectedCapabilityId}"`);
      expect(requests).toHaveLength(3);

      const initialText = requestText(requests[0]!);
      expect(initialText).not.toContain('<available-deferred-clipc>');
      expect(initialText).not.toContain('clipc-api-001');
      expect(initialText).not.toContain(selectedCapabilityId);
      expect(initialText).not.toContain('clipc-api-003');
      expect(initialText).not.toContain('Full CLIP schema description for clipc-api-002');
      expect(initialText).not.toContain('clip-private-002');
      expect(requests[0]!.tools.map((tool) => tool.name).filter((name) => name.startsWith('clipc-api-'))).toEqual([]);

      const afterSearchText = requestText(requests[1]!);
      expect(afterSearchText).toContain('<available-clipc>');
      expect(afterSearchText).toContain(`- capability_id=${selectedCapabilityId} | name=${selectedCapabilityId} | kind=TOOL`);
      expect(afterSearchText).toContain('These entries came from deferred CLIP Tool discovery and have defer_loading=true');
      expect(afterSearchText).not.toContain('clip-private-002');
      const activatedClipTools = requests[1]!.tools.filter((tool) => tool.name.startsWith('clipc-api-'));
      expect(activatedClipTools.map((tool) => tool.name)).toEqual([selectedCapabilityId]);
      expect(describeTool).toHaveBeenCalledTimes(1);
      expect(activatedClipTools[0]?.inputSchema).toEqual(inputSchema());

      expect(executeTool).toHaveBeenCalledWith(
        expect.objectContaining({
          providerId,
          clipCapabilityId: selectedCapabilityId,
          primitive: 'query',
          arguments: { neId: 'NE-002', apiQuery: 'radio access kpi' },
        }),
        expect.any(AbortSignal),
        expect.objectContaining({ emitResultDelta: expect.any(Function) }),
      );

      const afterClipCallText = requestText(requests[2]!);
      expect(afterClipCallText).toContain(selectedCapabilityId);

      const conversation = await fetch(`${ctx.baseUrl}/api/v1/sessions/${body.sessionId}/conversation?limit=20&includeCapabilityResults=true`);
      expect(conversation.status).toBe(200);
      const history = (await conversation.json()) as { items: Array<{ role: string; content: string; metadata?: Record<string, unknown> }> };
      const toolSearchResult = history.items.find((item) => item.role === 'CAPABILITY_RESULT' && item.metadata?.['toolName'] === 'ToolSearch');
      expect(toolSearchResult?.content).toBe('');
      expect(history.items.at(-1)).toMatchObject({ role: 'ASSISTANT', content: 'CLIP ToolSearch lazy context verified.' });
    } finally {
      await cleanupE2ETestContext(ctx);
    }
  }, 120_000);
});

function fakeClipRunner(executeTool: ClipCommandRunner['executeTool'], describeTool: ClipCommandRunner['describeTool']): ClipCommandRunner {
  return {
    async listTools() {
      return clipCapabilityIds().map((capabilityId) => ({
        target_id: capabilityId,
        target: capabilityId,
        ref: `/${capabilityId}`,
        operation: 'query',
        params: inputParams(),
        displayName: capabilityId,
        description: `Deferred CLIP catalog entry for ${capabilityId}.`,
      }));
    },
    describeTool,
    executeTool,
  };
}

function listedCapabilityId(listedTool: unknown): string {
  if (typeof listedTool === 'string') {
    return listedTool;
  }
  if (typeof listedTool !== 'object' || listedTool === null) {
    return String(listedTool);
  }
  const record = listedTool as Record<string, unknown>;
  const targetId = record['target_id'] ?? record['capabilityId'] ?? record['target'];
  if (typeof targetId === 'string' && targetId.length > 0) {
    return targetId;
  }
  const ref = record['ref'];
  if (typeof ref === 'string' && ref.length > 1) {
    return ref.startsWith('/') ? ref.slice(1) : ref;
  }
  return String(listedTool);
}

function toolFact(capabilityId: string, clipCapabilityId: string) {
  return {
    data: {
      structured: {
        callable_capabilities: [
          {
            target_id: capabilityId,
            target: capabilityId,
            ref: `/${capabilityId}`,
            operation: 'query',
            params: inputParams(),
            responses: [
              {
                code: '200',
                description: `Full CLIP schema description for ${capabilityId}. Telecom validation API for ToolSearch lazy loading.`,
                content: {
                  'application/json': {
                    schema: outputSchema(),
                  },
                },
              },
            ],
            metadata: { clipCapabilityId },
          },
        ],
      },
    },
  };
}

function clipCapabilityIds(): readonly string[] {
  return Array.from({ length: clipCount }, (_value, index) => `clipc-api-${String(index + 1).padStart(3, '0')}`);
}

function inputSchema(): JsonObject {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['neId', 'apiQuery'],
    properties: {
      neId: { type: 'string' },
      apiQuery: { type: 'string' },
    },
  };
}

function inputParams(): readonly JsonObject[] {
  return [
    { name: 'neId', location: 'query', required: true },
    { name: 'apiQuery', location: 'query', required: true },
  ];
}

function outputSchema(): JsonObject {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['status', 'api'],
    properties: {
      status: { type: 'string' },
      api: { type: 'string' },
    },
  };
}

function requestText(request: ModelInvocationRequest): string {
  return request.messages.map((message) => message.content.flatMap((part) => (part.type === 'text' ? [part.text] : [])).join('\n')).join('\n');
}
