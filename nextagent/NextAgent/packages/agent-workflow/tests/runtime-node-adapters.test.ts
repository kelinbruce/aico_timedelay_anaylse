import { brand } from '@nextagent/agent-common';
import { describe, expect, it, vi } from 'vitest';
import { createWorkflowGuardrailLifecycleHookAdapter, createWorkflowRagKnowledgeRetrieverAdapter } from '../src/index.js';
import { baseRequest } from './test-helpers.js';

describe('workflow runtime node adapters', () => {
  it('maps lifecycle hook guardrail outcomes to workflow guardrail decisions', async () => {
    const signal = new AbortController().signal;
    const invoke = vi.fn(async () => ({
      outcome: 'BLOCK' as const,
      safeReason: 'TERM_BLOCKED',
      error: {
        code: 'TERM_BLOCKED',
        message: 'The workflow guardrail rejected the content.',
        category: 'POLICY_DENIED' as const,
        retryable: false,
      },
    }));
    const evaluateGuardrail = createWorkflowGuardrailLifecycleHookAdapter({ lifecycleHook: { invoke } });

    const result = await evaluateGuardrail(
      {
        policyId: 'telecom-content-policy',
        sessionId: brand<string, 'SessionId'>('session-workflow'),
        requestId: brand<string, 'MessageId'>('request-workflow'),
        runId: brand<string, 'RequestRunId'>('run-workflow'),
        agentId: brand<string, 'AgentId'>('agent-workflow'),
        agentVersion: brand<string, 'AgentVersion'>('v1'),
        workflowNodeId: 'verify',
        workflowNodeType: 'GUARDRAIL',
        content: 'show subscriber secret',
        safeContentSummary: 'guardrail input',
      },
      signal,
    );

    expect(result).toMatchObject({
      decision: 'REJECT',
      safeReason: 'TERM_BLOCKED',
      safeError: { code: 'TERM_BLOCKED', category: 'POLICY_DENIED' },
    });
    expect(invoke).toHaveBeenCalledWith(
      expect.objectContaining({
        hookId: 'telecom-content-policy',
        stage: 'BEFORE_MODEL_INVOKE',
        boundary: expect.objectContaining({
          stepId: 'workflow:verify:guardrail',
          modelId: 'telecom-content-policy',
          safeModelRequestSummary: 'guardrail input',
        }),
      }),
      signal,
    );
  });

  it('maps RAG retrieval results to bounded workflow knowledge documents', async () => {
    const content = 'x'.repeat(500);
    const retrieve = vi.fn(async () => ({
      status: 'OK' as const,
      diagnostics: { reason: 'INDEX_NOT_READY' as const },
      recommends: [
        { id: 'docs\\ran\\rrc.md', title: 'rrc.md', knowledge: content, vsScore: 0.91, provenance: 'kb' },
        { id: 'docs/ignored.md', title: 'ignored.md', knowledge: 'ignored' },
      ],
    }));
    const ensureBuilt = vi.fn(async () => undefined);
    const retrieveKnowledge = createWorkflowRagKnowledgeRetrieverAdapter({
      gateway: { retrieve },
      ensureBuilt,
    });

    const result = await retrieveKnowledge(
      {
        query: 'RRC failure',
        indexes: [{ indexName: 'ran-kb' }],
        rankTopN: 1,
        vsTopN: 4,
        esTopN: 3,
        topK: 4,
        defaultIndexType: 'KNOWLEDGE',
        request: baseRequest(),
      },
      new AbortController().signal,
    );

    expect(ensureBuilt).toHaveBeenCalledOnce();
    expect(retrieve).toHaveBeenCalledWith(
      expect.objectContaining({
        query: 'RRC failure',
        indexes: [{ indexName: 'ran-kb', indexType: 'KNOWLEDGE', vsTopN: 4, esTopN: 3 }],
        options: { topK: 4 },
      }),
      expect.any(AbortSignal),
    );
    expect(result).toMatchObject({
      status: 'OK',
      diagnosticReason: 'INDEX_NOT_READY',
      recommends: [
        {
          id: 'docs\\ran\\rrc.md',
          title: 'rrc.md',
          vsScore: 0.91,
          provenance: 'kb',
        },
      ],
    });
    expect(result.recommends[0]?.knowledge).toHaveLength(500);
  });
});
