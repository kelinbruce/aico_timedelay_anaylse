import { clipServerProviderType, type ClipCommandRunner } from '@nextagent/agent-capability';
import { loadBuiltInDefaultAgentDefinition } from '@nextagent/agent-platform-gateway-local/testing';
import { brand, type JsonObject } from '@nextagent/agent-common';
import { cleanupE2ETestContext, createE2ETestContext } from '../e2e-helpers.js';
import { recordCaseResult } from './case-inventory.js';
import { describe, expect, it, vi } from 'vitest';

const providerId = 'parallel-clip';
const firstCapabilityId = 'clipc-parallel-a';
const secondCapabilityId = 'clipc-parallel-b';

describe('alpha-07: same-round parallel tool calls', () => {
  it('executes multiple model-returned tool calls in the same round concurrently', async () => {
    const startedAt = new Date().toISOString();
    const secondStarted = deferred<void>();
    const starts: string[] = [];
    const completions: string[] = [];
    const executeTool = vi.fn<ClipCommandRunner['executeTool']>(async (request) => {
      const capabilityId = request.clipCapabilityId;
      starts.push(capabilityId);
      if (capabilityId === firstCapabilityId) {
        await withTimeout(secondStarted.promise, 1500, 'second parallel tool did not start before the first completed');
      } else if (capabilityId === secondCapabilityId) {
        secondStarted.resolve();
      }
      completions.push(capabilityId);
      return { status: 'ok', capabilityId };
    });
    const defaultAgent = loadBuiltInDefaultAgentDefinition();
    const ctx = await createE2ETestContext({
      tempPrefix: 'nextagent-akg-07-',
      capabilityProviders: [
        {
          id: providerId,
          type: 'custom',
          adapter: clipServerProviderType,
          config: { enabled: true, clipPathRef: 'clipc', endpointRef: 'clip-daemon', timeoutMs: 5000, retry: { maxAttempts: 1 } },
        },
      ],
      clipCommandRunner: fakeClipRunner(executeTool),
      agentDefinition: {
        ...defaultAgent,
        capabilityBindings: [
          ...defaultAgent.capabilityBindings,
          ...[firstCapabilityId, secondCapabilityId].map((capabilityId) => ({
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
              toolCallId: 'parallel-call-a',
              toolName: firstCapabilityId,
              arguments: { neId: 'NE-A', apiQuery: 'rru status' },
            },
            {
              toolCallId: 'parallel-call-b',
              toolName: secondCapabilityId,
              arguments: { neId: 'NE-B', apiQuery: 'cell kpi' },
            },
          ],
        },
        { content: 'Parallel tool calls verified.' },
      ],
    });

    try {
      const accepted = await fetch(`${ctx.baseUrl}/api/v1/requests`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          inputText: 'Run both telecom validation APIs for NE-A and NE-B.',
          idempotencyKey: `alpha-07-${crypto.randomUUID()}`,
        }),
      });
      expect(accepted.status).toBe(200);
      const body = (await accepted.json()) as { sessionId: string; runId: string };

      const stream = await fetch(`${ctx.baseUrl}/api/v1/sessions/${body.sessionId}/stream?lastSeenSequence=0&runId=${body.runId}`);
      expect(stream.status).toBe(200);
      const streamBody = await stream.text();

      expect(streamBody).toContain('event: REQUEST_COMPLETED');
      expect(streamBody).toContain('"toolCallId":"parallel-call-a"');
      expect(streamBody).toContain('"toolCallId":"parallel-call-b"');
      expect(streamBody).toContain('Parallel tool calls verified.');
      expect(new Set(starts)).toEqual(new Set([firstCapabilityId, secondCapabilityId]));
      expect(completions).toEqual([secondCapabilityId, firstCapabilityId]);
      expect(executeTool).toHaveBeenCalledTimes(2);

      const conversation = await fetch(`${ctx.baseUrl}/api/v1/sessions/${body.sessionId}/conversation?limit=20&includeCapabilityResults=true`);
      expect(conversation.status).toBe(200);
      const history = (await conversation.json()) as { items: Array<{ role: string; content: string; metadata?: Record<string, unknown> }> };
      const toolResults = history.items.filter((item) => item.role === 'CAPABILITY_RESULT');
      expect(toolResults.map((item) => item.metadata?.['toolCallId'])).toEqual(['parallel-call-a', 'parallel-call-b']);
      expect(history.items.at(-1)).toMatchObject({ role: 'ASSISTANT', content: 'Parallel tool calls verified.' });

      recordCaseResult('alpha-07', 'PASSED', { startedAt, endedAt: new Date().toISOString() });
    } catch (error) {
      recordCaseResult('alpha-07', 'FAILED', {
        safeReason: error instanceof Error ? error.message : String(error),
        startedAt,
        endedAt: new Date().toISOString(),
      });
      throw error;
    } finally {
      await cleanupE2ETestContext(ctx);
    }
  }, 30_000);
});

function fakeClipRunner(executeTool: ClipCommandRunner['executeTool']): ClipCommandRunner {
  const facts = new Map<string, unknown>([
    [firstCapabilityId, toolFact(firstCapabilityId)],
    [secondCapabilityId, toolFact(secondCapabilityId)],
  ]);
  return {
    async listTools() {
      return [...facts.keys()].map((capabilityId) => ({
        capabilityId,
        displayName: capabilityId,
        description: `Parallel CLIP catalog entry for ${capabilityId}.`,
      }));
    },
    async describeTool(_provider, _options, listedTool) {
      const capabilityId =
        typeof listedTool === 'object' && listedTool !== null && 'capabilityId' in listedTool ? String(listedTool.capabilityId) : String(listedTool);
      return facts.get(capabilityId);
    },
    executeTool,
  };
}

function toolFact(capabilityId: string) {
  return {
    capabilityId,
    clipCapabilityId: capabilityId,
    primitive: 'query',
    displayName: capabilityId,
    description: `Telecom validation API for same-round parallel tool-call e2e coverage: ${capabilityId}.`,
    inputSchema: inputSchema(),
    outputSchema: outputSchema(),
    replayPolicy: 'IDEMPOTENT',
  };
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

function outputSchema(): JsonObject {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['status', 'capabilityId'],
    properties: {
      status: { type: 'string' },
      capabilityId: { type: 'string' },
    },
  };
}

function deferred<T>(): { readonly promise: Promise<T>; readonly resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve;
  });
  return { promise, resolve };
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_resolve, reject) => {
        timeout = setTimeout(() => reject(new Error(message)), timeoutMs);
      }),
    ]);
  } finally {
    if (timeout !== undefined) {
      clearTimeout(timeout);
    }
  }
}
