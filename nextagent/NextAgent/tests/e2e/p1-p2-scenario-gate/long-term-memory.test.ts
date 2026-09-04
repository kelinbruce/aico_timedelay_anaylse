import type { ModelInvocationRequest } from '@nextagent/agent-contracts/model';
import { afterEach, describe, expect, it } from 'vitest';
import { brand } from '@nextagent/agent-common';
import {
  cleanupP1P2GateContext,
  createP1P2GateContext,
  gateIdentity,
  readConversation,
  readRunStream,
  submitRequest,
  type P1P2GateContext,
} from './helpers.js';
import { recordCaseResult } from './case-inventory.js';

describe('p1-p2 scenario gate: long-term memory', () => {
  let ctx: P1P2GateContext | undefined;

  afterEach(async () => {
    if (ctx !== undefined) {
      await cleanupP1P2GateContext(ctx);
      ctx = undefined;
    }
  });

  it('persists memory through add_memory and recalls it over a later real request', async () => {
    const modelRequests: ModelInvocationRequest[] = [];
    try {
      ctx = await createP1P2GateContext({
        modelRequestSink: modelRequests,
        modelSteps: [
          {
            toolCalls: [
              {
                toolCallId: 'tool-p1p2-memory-add',
                toolName: 'add_memory',
                arguments: {
                  category: 'FACTUAL',
                  content: { category: 'FACTUAL', subject: 'BGP peer', claim: '10.0.0.1' },
                  briefIndex: 'BGP peer: 10.0.0.1',
                  confidence: 0.7,
                },
              },
            ],
          },
          { content: '记忆已保存。' },
          {
            toolCalls: [
              {
                toolCallId: 'tool-p1p2-memory-search',
                toolName: 'search_memory',
                arguments: { queryText: 'BGP peer', limit: 5 },
              },
            ],
          },
          { content: '记忆已检索。' },
        ],
      });

      const firstAccepted = await submitRequest(ctx, {
        inputText: '请记住 BGP peer 是 10.0.0.1。',
        idempotencyKey: `p1p2-memory-add-${crypto.randomUUID()}`,
      });
      const firstStream = await readRunStream(ctx, firstAccepted.sessionId, firstAccepted.runId);
      expect(firstStream).toContain('"capabilityId":"add_memory"');
      expect(firstStream).toContain('event: REQUEST_COMPLETED');

      const secondAccepted = await submitRequest(ctx, {
        sessionId: firstAccepted.sessionId,
        inputText: '回忆一下 BGP peer。',
        idempotencyKey: `p1p2-memory-search-${crypto.randomUUID()}`,
      });
      const secondStream = await readRunStream(ctx, secondAccepted.sessionId, secondAccepted.runId);
      expect(secondStream).toContain('event: REQUEST_COMPLETED');

      const conversation = await readConversation(ctx, firstAccepted.sessionId);
      expect(conversation.items.some((item) => item.role === 'CAPABILITY_RESULT' && item.metadata?.['toolName'] === 'add_memory')).toBe(true);
      expect(conversation.items.at(-1)?.content).toBe('记忆已检索。');
      expect(modelRequests.some((request) => request.tools.some((tool) => tool.name === 'search_memory'))).toBe(true);
      expect(modelRequests.some((request) => request.tools.some((tool) => tool.name === 'add_memory'))).toBe(true);

      const stored = await ctx.app.gateway.longTermMemoryStore.listLongTermMemory({
        tenantId: gateIdentity.tenantId,
        subjectId: gateIdentity.subjectId,
        agentId: brand<string, 'AgentId'>('default-agent'),
        limit: 10,
      });
      expect('code' in stored).toBe(false);
      if ('code' in stored) {
        throw new Error(`Unexpected long-term memory list error: ${stored.code}`);
      }
      expect(stored.items.some((item) => item.briefIndex === 'BGP peer: 10.0.0.1')).toBe(true);

      recordCaseResult('e2e-P1P2-02', 'PASSED', {
        evidenceRefs: ['evidence://p1-p2/long-term-memory/store', 'evidence://p1-p2/long-term-memory/stream'],
      });
    } catch (error) {
      recordCaseResult('e2e-P1P2-02', 'FAILED', {
        safeReason: 'long-term memory gate case failed',
        evidenceRefs: ['evidence://p1-p2/long-term-memory/failure'],
      });
      throw error;
    }
  }, 20_000);
});
