import { brand } from '@nextagent/agent-common';
import type { RagRetrievalRequest, RagRetrievalResult } from '@nextagent/agent-contracts/gateway';
import { createLocalWorkflowRagGateway } from '@nextagent/agent-platform-gateway-local';
import { describe, expect, it, vi } from 'vitest';

describe('local workflow RAG gateway', () => {
  it('ignores unsupported per-index params and delegates index names and topK', async () => {
    const retrieve = vi.fn(async (_request: RagRetrievalRequest): Promise<RagRetrievalResult> => ({
      status: 'OK',
      results: [{ source: 'docs/a.md', content: 'content', score: 0.9 }],
    }));
    const gateway = createLocalWorkflowRagGateway({ retrieve });

    const result = await gateway.retrieve({
      tenantId: brand<string, 'TenantId'>('t'),
      subjectId: brand<string, 'SubjectId'>('s'),
      agentId: brand<string, 'AgentId'>('a'),
      agentVersion: brand<string, 'AgentVersion'>('v1'),
      knowledgeScope: { scopeKind: 'AGENT_WORKSPACE', logicalRoot: 'workspace' },
      query: 'test',
      indexes: [{ indexName: 'idx-a', indexType: 'KNOWLEDGE', vsTopN: 5, esTopN: 3, filters: { region: 'east' } }],
      options: { topK: 3 },
    });

    expect(retrieve).toHaveBeenCalledWith(
      expect.objectContaining({
        indexes: ['idx-a'],
        options: { topK: 3 },
      }),
      undefined,
    );
    expect(result.recommends).toEqual([
      expect.objectContaining({
        id: 'docs/a.md',
        title: 'a.md',
        knowledge: 'content',
      }),
    ]);
  });
});
