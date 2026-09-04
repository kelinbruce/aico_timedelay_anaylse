import { brand } from '@nextagent/agent-common';
import { describe, expect, it, vi } from 'vitest';
import { AgentError } from '@nextagent/agent-common';
import {
  createUnavailableWorkflowRagGateway,
  createWorkflowRagKnowledgeRetrieverAdapter,
  type WorkflowRagRetrievalRequest,
  type WorkflowRagRetrievalResult,
} from '../src/index.js';
import { baseRequest } from './test-helpers.js';

describe('workflow RAG adapter per-index parameter merge', () => {
  it('per-index vsTopN overrides node-level, missing falls back to node-level', async () => {
    const retrieve = vi.fn(async (_request: WorkflowRagRetrievalRequest): Promise<WorkflowRagRetrievalResult> => ({
      status: 'OK' as const,
      recommends: [{ id: 'docs/a.md', title: 'a.md', knowledge: 'content', vsScore: 0.9 }],
    }));
    const adapter = createWorkflowRagKnowledgeRetrieverAdapter({ gateway: { retrieve } });

    await adapter(
      {
        query: 'test',
        indexes: [{ indexName: 'idx-a', vsTopN: 5 }, { indexName: 'idx-b' }],
        rankTopN: 1,
        vsTopN: 10,
        esTopN: 8,
        topK: 1,
        defaultIndexType: 'KNOWLEDGE',
        request: baseRequest(),
      },
      new AbortController().signal,
    );

    const call = retrieve.mock.calls[0]![0];
    expect(call.indexes[0]!.vsTopN).toBe(5);
    expect(call.indexes[1]!.vsTopN).toBe(10);
  });

  it('per-index filters override node-level filters', async () => {
    const retrieve = vi.fn(async (_request: WorkflowRagRetrievalRequest): Promise<WorkflowRagRetrievalResult> => ({
      status: 'OK' as const,
      recommends: [{ id: 'docs/a.md', title: 'a.md', knowledge: 'content', vsScore: 0.9 }],
    }));
    const adapter = createWorkflowRagKnowledgeRetrieverAdapter({ gateway: { retrieve } });

    await adapter(
      {
        query: 'test',
        indexes: [{ indexName: 'idx-a', filters: { region: 'east' } }],
        rankTopN: 1,
        vsTopN: 10,
        esTopN: 8,
        topK: 1,
        defaultIndexType: 'KNOWLEDGE',
        filters: { region: 'west' },
        request: baseRequest(),
      },
      new AbortController().signal,
    );

    const call = retrieve.mock.calls[0]![0];
    expect(call.indexes[0]!.filters).toEqual({ region: 'east' });
  });

  it('options contains only topK, no enableQueryRewrite', async () => {
    const retrieve = vi.fn(async (_request: WorkflowRagRetrievalRequest): Promise<WorkflowRagRetrievalResult> => ({
      status: 'OK' as const,
      recommends: [{ id: 'docs/a.md', title: 'a.md', knowledge: 'content', vsScore: 0.9 }],
    }));
    const adapter = createWorkflowRagKnowledgeRetrieverAdapter({ gateway: { retrieve } });

    await adapter(
      {
        query: 'test',
        indexes: [{ indexName: 'idx-a' }],
        rankTopN: 1,
        vsTopN: 10,
        esTopN: 8,
        topK: 3,
        defaultIndexType: 'KNOWLEDGE',
        request: baseRequest(),
      },
      new AbortController().signal,
    );

    const call = retrieve.mock.calls[0]![0];
    expect(call.options).toEqual({ topK: 3 });
    expect(call.options).not.toHaveProperty('enableQueryRewrite');
  });

  it('resolves indexType using defaultIndexType when per-index omitted', async () => {
    const retrieve = vi.fn(async (_request: WorkflowRagRetrievalRequest): Promise<WorkflowRagRetrievalResult> => ({
      status: 'OK' as const,
      recommends: [{ id: 'docs/a.md', title: 'a.md', knowledge: 'content', vsScore: 0.9 }],
    }));
    const adapter = createWorkflowRagKnowledgeRetrieverAdapter({ gateway: { retrieve } });

    await adapter(
      {
        query: 'test',
        indexes: [{ indexName: 'idx-a' }, { indexName: 'idx-b', indexType: 'API' }],
        rankTopN: 1,
        vsTopN: 10,
        esTopN: 8,
        topK: 1,
        defaultIndexType: 'RECIPE',
        request: baseRequest(),
      },
      new AbortController().signal,
    );

    const call = retrieve.mock.calls[0]![0];
    expect(call.indexes[0]!.indexType).toBe('RECIPE');
    expect(call.indexes[1]!.indexType).toBe('API');
  });

  it('rankHint passed through to document', async () => {
    const retrieve = vi.fn(async (_request: WorkflowRagRetrievalRequest): Promise<WorkflowRagRetrievalResult> => ({
      status: 'OK' as const,
      recommends: [{ id: 'docs/a.md', title: 'a.md', knowledge: 'content', vsScore: 0.9, rankHint: '1' }],
    }));
    const adapter = createWorkflowRagKnowledgeRetrieverAdapter({ gateway: { retrieve } });

    const result = await adapter(
      {
        query: 'test',
        indexes: [{ indexName: 'idx-a' }],
        rankTopN: 1,
        vsTopN: 10,
        esTopN: 8,
        topK: 1,
        defaultIndexType: 'KNOWLEDGE',
        request: baseRequest(),
      },
      new AbortController().signal,
    );

    expect(result.recommends[0]?.rankHint).toBe('1');
  });
});

describe('unavailable workflow RAG gateway', () => {
  it('returns UNAVAILABLE status without throwing', async () => {
    const gateway = createUnavailableWorkflowRagGateway();
    const result = await gateway.retrieve({
      tenantId: brand<string, 'TenantId'>('t'),
      subjectId: brand<string, 'SubjectId'>('s'),
      agentId: brand<string, 'AgentId'>('a'),
      agentVersion: brand<string, 'AgentVersion'>('v1'),
      knowledgeScope: { scopeKind: 'AGENT_WORKSPACE', logicalRoot: 'workspace' },
      query: 'test',
      indexes: [{ indexName: 'idx-a', indexType: 'KNOWLEDGE' }],
      options: { topK: 1 },
    });
    expect(result.status).toBe('UNAVAILABLE');
    expect(result.recommends).toEqual([]);
  });
});

describe('adapter runtime fail-fast on UNAVAILABLE gateway', () => {
  it('throws WORKFLOW_RAG_GATEWAY_UNAVAILABLE when gateway returns UNAVAILABLE', async () => {
    const adapter = createWorkflowRagKnowledgeRetrieverAdapter({
      gateway: {
        async retrieve(): Promise<WorkflowRagRetrievalResult> {
          return { status: 'UNAVAILABLE', recommends: [], diagnostics: { reason: 'PROVIDER_UNAVAILABLE' } };
        },
      },
    });

    await expect(
      adapter(
        {
          query: 'test',
          indexes: [{ indexName: 'idx-a' }],
          rankTopN: 1,
          vsTopN: 10,
          esTopN: 8,
          topK: 1,
          defaultIndexType: 'KNOWLEDGE',
          request: baseRequest(),
        },
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({
      code: 'WORKFLOW_RAG_GATEWAY_UNAVAILABLE',
      category: 'UNAVAILABLE',
    });
  });

  it('does not throw when gateway returns OK with empty recommends', async () => {
    const adapter = createWorkflowRagKnowledgeRetrieverAdapter({
      gateway: {
        async retrieve(): Promise<WorkflowRagRetrievalResult> {
          return { status: 'OK', recommends: [] };
        },
      },
    });

    const result = await adapter(
      {
        query: 'test',
        indexes: [{ indexName: 'idx-a' }],
        rankTopN: 1,
        vsTopN: 10,
        esTopN: 8,
        topK: 1,
        defaultIndexType: 'KNOWLEDGE',
        request: baseRequest(),
      },
      new AbortController().signal,
    );

    expect(result.status).toBe('OK');
    expect(result.recommends).toEqual([]);
  });
});
