import type { ModelInvocationRequest } from '@nextagent/agent-contracts/model';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanupP1P2GateContext, createP1P2GateContext, readConversation, readRunStream, submitRequest, type P1P2GateContext } from './helpers.js';
import { recordCaseResult } from './case-inventory.js';

describe('p1-p2 scenario gate: routing and child-agent path', () => {
  let ctx: P1P2GateContext | undefined;

  afterEach(async () => {
    if (ctx !== undefined) {
      await cleanupP1P2GateContext(ctx);
      ctx = undefined;
    }
  });

  it('loads the targeted Skill over the real request path before the model response', async () => {
    const modelRequests: ModelInvocationRequest[] = [];
    try {
      ctx = await createP1P2GateContext({
        skillFixtures: ['hello-clip-test'],
        modelRequestSink: modelRequests,
        modelSteps: [{ content: '目标技能已加载。' }],
      });

      const accepted = await submitRequest(ctx, {
        inputText: '验证 hello clip skill 的目标路由。',
        idempotencyKey: `p1p2-routing-skill-${crypto.randomUUID()}`,
        routingConstraints: { targetSkill: 'hello-clip-test' },
      });
      const streamBody = await readRunStream(ctx, accepted.sessionId, accepted.runId);

      expect(streamBody).toContain('event: REQUEST_COMPLETED');
      expect(modelRequests).toHaveLength(1);
      const promptJson = JSON.stringify(modelRequests[0]?.messages);
      expect(promptJson).toContain('hello-clip-test');
      expect(promptJson).toContain('Available skills');
      expect(promptJson).toContain('<skill_content name=\\"hello-clip-test\\">');
      expect(promptJson).not.toContain(ctx.workspaceDir);

      const conversation = await readConversation(ctx, accepted.sessionId, false);
      expect(conversation.items.at(-1)?.content).toBe('目标技能已加载。');

      recordCaseResult('e2e-P1P2-03', 'PASSED', {
        evidenceRefs: ['evidence://p1-p2/routing-child-agent/model-request', 'evidence://p1-p2/routing-child-agent/stream'],
      });
    } catch (error) {
      recordCaseResult('e2e-P1P2-03', 'FAILED', {
        safeReason: 'routing child-agent gate case failed',
        evidenceRefs: ['evidence://p1-p2/routing-child-agent/failure'],
      });
      throw error;
    }
  }, 20_000);
});
