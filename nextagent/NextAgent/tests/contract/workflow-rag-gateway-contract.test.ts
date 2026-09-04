import { workflowRagRetrievalRequestSchema, workflowRagRetrievalResultSchema } from '@nextagent/agent-contracts/gateway';
import { Ajv } from 'ajv/dist/ajv.js';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const baseValidRequest = {
  tenantId: 'tenant-wf',
  subjectId: 'subject-wf',
  agentId: 'agent-wf',
  agentVersion: 'v1',
  knowledgeScope: { scopeKind: 'AGENT_WORKSPACE', logicalRoot: 'workspace' },
  query: 'RRC failure diagnosis',
  indexes: [{ indexName: 'ran-kb', indexType: 'KNOWLEDGE' }],
  options: { topK: 5 },
} as const;

describe('workflow RAG retrieval gateway contract', () => {
  const ajv = new Ajv({ allErrors: true, strict: false });

  it('accepts a valid request with per-index parameters', () => {
    const validate = ajv.compile(workflowRagRetrievalRequestSchema);

    expect(
      validate({
        ...baseValidRequest,
        indexes: [
          {
            indexName: 'ran-kb',
            indexType: 'KNOWLEDGE',
            domain: 'ran',
            scene: 'alarm',
            priority: 1,
            vsTopN: 5,
            esTopN: 3,
            filters: { region: 'east' },
          },
        ],
      }),
    ).toBe(true);
  });

  it('accepts all three indexType values', () => {
    const validate = ajv.compile(workflowRagRetrievalRequestSchema);

    for (const indexType of ['API', 'RECIPE', 'KNOWLEDGE'] as const) {
      expect(
        validate({
          ...baseValidRequest,
          indexes: [{ indexName: 'test-idx', indexType }],
        }),
        indexType,
      ).toBe(true);
    }
  });

  it('rejects invalid indexType values', () => {
    const validate = ajv.compile(workflowRagRetrievalRequestSchema);

    for (const indexType of ['vector', 'es', 'unknown', '', null, 42]) {
      expect(
        validate({
          ...baseValidRequest,
          indexes: [{ indexName: 'test-idx', indexType }],
        }),
        String(indexType),
      ).toBe(false);
    }
  });

  it('rejects additional properties on request and index objects', () => {
    const validate = ajv.compile(workflowRagRetrievalRequestSchema);

    expect(validate({ ...baseValidRequest, enableQueryRewrite: true })).toBe(false);
    expect(
      validate({
        ...baseValidRequest,
        indexes: [{ indexName: 'test-idx', indexType: 'API', vector: 'embedding' }],
      }),
    ).toBe(false);
  });

  it('rejects empty indexes array and more than 5 indexes', () => {
    const validate = ajv.compile(workflowRagRetrievalRequestSchema);

    expect(validate({ ...baseValidRequest, indexes: [] })).toBe(false);
    expect(
      validate({
        ...baseValidRequest,
        indexes: Array.from({ length: 6 }, (_, i) => ({ indexName: `idx-${i}`, indexType: 'API' })),
      }),
    ).toBe(false);
  });

  it('rejects out-of-range vsTopN and esTopN', () => {
    const validate = ajv.compile(workflowRagRetrievalRequestSchema);

    expect(
      validate({
        ...baseValidRequest,
        indexes: [{ indexName: 'test-idx', indexType: 'API', vsTopN: 0 }],
      }),
    ).toBe(false);
    expect(
      validate({
        ...baseValidRequest,
        indexes: [{ indexName: 'test-idx', indexType: 'API', vsTopN: 21 }],
      }),
    ).toBe(false);
    expect(
      validate({
        ...baseValidRequest,
        indexes: [{ indexName: 'test-idx', indexType: 'API', esTopN: 0 }],
      }),
    ).toBe(false);
    expect(
      validate({
        ...baseValidRequest,
        indexes: [{ indexName: 'test-idx', indexType: 'API', esTopN: 21 }],
      }),
    ).toBe(false);
  });

  it('rejects topK out of range', () => {
    const validate = ajv.compile(workflowRagRetrievalRequestSchema);

    expect(validate({ ...baseValidRequest, options: { topK: 0 } })).toBe(false);
    expect(validate({ ...baseValidRequest, options: { topK: 11 } })).toBe(false);
  });

  it('options must not contain enableQueryRewrite', () => {
    const validate = ajv.compile(workflowRagRetrievalRequestSchema);

    expect(validate({ ...baseValidRequest, options: { topK: 5, enableQueryRewrite: true } })).toBe(false);
  });

  it('result validation uses workflowRagRetrievalResultSchema', () => {
    const validate = ajv.compile(workflowRagRetrievalResultSchema);

    expect(
      validate({
        status: 'OK',
        recommends: [{ id: 'docs/rrc.md', title: 'RRC Guide', knowledge: 'knowledge content', vsScore: 0.9 }],
      }),
    ).toBe(true);
  });

  it('contract source has no provider-private field names', () => {
    const source = readFileSync(join(process.cwd(), 'packages', 'agent-contracts', 'src', 'gateway', 'index.ts'), 'utf8');
    const start = source.indexOf('export interface WorkflowRagRetrievalIndex');
    const end = source.indexOf('export const workflowRagRetrievalRequestSchema');
    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    const contractSource = source.slice(start, end);

    expect(contractSource).not.toMatch(/\b(?:vector|elasticsearch|embedding|hostPath|sqlitePath)\b/u);
  });
});
