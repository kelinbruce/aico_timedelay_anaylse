import { afterEach, describe, expect, it } from 'vitest';
import { brand } from '@nextagent/agent-common';
import {
  cleanupP1P2GateContext,
  createP1P2GateContext,
  gateIdentity,
  readExecutionWorkspaceFile,
  readRunStream,
  submitRequest,
  type P1P2GateContext,
} from './helpers.js';
import { recordCaseResult } from './case-inventory.js';

describe('p1-p2 scenario gate: extension governance', () => {
  let ctx: P1P2GateContext | undefined;

  afterEach(async () => {
    if (ctx !== undefined) {
      await cleanupP1P2GateContext(ctx);
      ctx = undefined;
    }
  });

  it('executes a governed write over the real product path and records safe runtime evidence', async () => {
    const toolCallId = 'tool-p1p2-governance-write';
    const relativePath = 'workspace/diagnostics/p1-p2-governance.txt';
    const content = 'governed write completed\n';
    try {
      ctx = await createP1P2GateContext({
        modelSteps: [
          {
            toolCalls: [
              {
                toolCallId,
                toolName: 'Write',
                arguments: { file_path: relativePath, content },
              },
            ],
          },
          { content: '治理链路验证完成。' },
        ],
      });

      const accepted = await submitRequest(ctx, {
        inputText: '写入一个治理验证文件。',
        idempotencyKey: `p1p2-extension-governance-${crypto.randomUUID()}`,
      });
      const streamBody = await readRunStream(ctx, accepted.sessionId, accepted.runId);

      expect(streamBody).toContain('event: CAPABILITY_STARTED');
      expect(streamBody).toContain('event: CAPABILITY_COMPLETED');
      expect(streamBody).toContain('event: REQUEST_COMPLETED');
      expect(streamBody).toContain(toolCallId);
      expect(streamBody).toContain('"status":"SUCCEEDED"');

      expect(await readExecutionWorkspaceFile(ctx, accepted.sessionId, accepted.runId, relativePath)).toBe(content);

      const events = await ctx.app.gateway.timeline.listEvents({
        tenantId: gateIdentity.tenantId,
        subjectId: gateIdentity.subjectId,
        agentId: brand<string, 'AgentId'>('default-agent'),
        sessionId: brand<string, 'SessionId'>(accepted.sessionId),
        runId: brand<string, 'RequestRunId'>(accepted.runId),
        afterSequence: brand<number, 'TimelineSequence'>(0),
        limit: 100,
      });
      expect(
        events.find((event) => event.type === 'POLICY_APPLIED' && event.inlinePayload['operationId'] === 'Write:tool-p1p2-governance-write')
          ?.inlinePayload,
      ).toMatchObject({
        outcome: 'ALLOW',
        riskLevel: 'MEDIUM',
      });

      recordCaseResult('e2e-P1P2-01', 'PASSED', {
        evidenceRefs: ['evidence://p1-p2/extension-governance/stream', 'evidence://p1-p2/extension-governance/timeline'],
      });
    } catch (error) {
      recordCaseResult('e2e-P1P2-01', 'FAILED', {
        safeReason: 'extension governance gate case failed',
        evidenceRefs: ['evidence://p1-p2/extension-governance/failure'],
      });
      throw error;
    }
  }, 20_000);
});
