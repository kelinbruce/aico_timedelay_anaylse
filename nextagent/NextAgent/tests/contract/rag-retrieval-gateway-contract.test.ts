import {
  ragRetrievalRequestSchema,
  ragRetrievalResultSchema,
  type RagRetrievalReason,
  type RagRetrievalStatus,
} from '@nextagent/agent-contracts/gateway';
import { Ajv } from 'ajv/dist/ajv.js';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('RAG retrieval gateway contract', () => {
  const ajv = new Ajv({ allErrors: true });

  it('accepts only provider-neutral request fields and bounded result options', () => {
    const validate = ajv.compile(ragRetrievalRequestSchema);

    expect(
      validate({
        tenantId: 'tenant-rag',
        subjectId: 'subject-rag',
        agentId: 'default-agent',
        agentVersion: 'v1',
        knowledgeScope: { scopeKind: 'AGENT_WORKSPACE', logicalRoot: 'workspace' },
        query: 'UPF timeout handling',
        indexes: ['local'],
        options: { topK: 5 },
      }),
    ).toBe(true);

    for (const forbidden of [
      { providerKind: 'local-fts5' },
      { deploymentMode: 'LOCAL' },
      { workspaceRoot: 'C:\\secret\\workspace' },
      { sqlitePath: 'C:\\secret\\nextagent.sqlite' },
      { fts5Expression: 'raw OR expression' },
      { connection: { endpoint: 'http://private' } },
      { credential: 'token-secret' },
      { providerIndexBinding: 'netkb-private' },
    ]) {
      expect(
        validate({
          tenantId: 'tenant-rag',
          subjectId: 'subject-rag',
          agentId: 'default-agent',
          agentVersion: 'v1',
          knowledgeScope: { scopeKind: 'AGENT_WORKSPACE', logicalRoot: 'workspace' },
          query: 'UPF timeout handling',
          indexes: ['local'],
          options: { topK: 5 },
          ...forbidden,
        }),
        JSON.stringify(forbidden),
      ).toBe(false);
    }

    expect(
      validate({
        tenantId: 'tenant-rag',
        subjectId: 'subject-rag',
        agentId: 'default-agent',
        agentVersion: 'v1',
        knowledgeScope: { scopeKind: 'AGENT_WORKSPACE', logicalRoot: 'workspace' },
        query: 'UPF timeout handling',
        indexes: [],
        options: { topK: 5 },
      }),
    ).toBe(false);
    expect(
      validate({
        tenantId: 'tenant-rag',
        subjectId: 'subject-rag',
        agentId: 'default-agent',
        agentVersion: 'v1',
        knowledgeScope: { scopeKind: 'AGENT_WORKSPACE', logicalRoot: 'workspace' },
        query: 'UPF timeout handling',
        indexes: ['a', 'b', 'c', 'd', 'e', 'f'],
        options: { topK: 5 },
      }),
    ).toBe(false);
    expect(
      validate({
        tenantId: 'tenant-rag',
        subjectId: 'subject-rag',
        agentId: 'default-agent',
        agentVersion: 'v1',
        knowledgeScope: { scopeKind: 'AGENT_WORKSPACE', logicalRoot: 'workspace' },
        query: 'x'.repeat(257),
        indexes: ['local'],
        options: { topK: 5 },
      }),
    ).toBe(false);
    expect(
      validate({
        tenantId: 'tenant-rag',
        subjectId: 'subject-rag',
        agentId: 'default-agent',
        agentVersion: 'v1',
        knowledgeScope: { scopeKind: 'AGENT_WORKSPACE', logicalRoot: 'workspace' },
        query: 'UPF timeout handling',
        indexes: ['local'],
        options: { topK: 11 },
      }),
    ).toBe(false);
  });

  it('keeps result and diagnostics safe', () => {
    const validate = ajv.compile(ragRetrievalResultSchema);
    const statuses: readonly RagRetrievalStatus[] = ['OK', 'NO_INDEX', 'UNAVAILABLE', 'DEGRADED', 'FAILED', 'TIMEOUT', 'CANCELED'];
    const reasons: readonly RagRetrievalReason[] = [
      'INVALID_INPUT',
      'PROVIDER_UNAVAILABLE',
      'FTS5_UNAVAILABLE',
      'INDEX_NOT_READY',
      'NO_INDEX',
      'SCOPE_MISMATCH',
      'WORKSPACE_READ_FAILED',
      'DECODE_FAILED',
      'CAPACITY_EXCEEDED',
      'BUILD_FAILED',
      'CLEANUP_FAILED',
      'TIMEOUT',
      'CANCELED',
      'INVALID_PROVIDER_RESULT',
      'EXECUTION_FAILED',
    ];

    for (const status of statuses) {
      expect(validate({ status, results: [], diagnostics: { reason: reasons[0] } }), status).toBe(true);
    }
    for (const reason of reasons) {
      expect(validate({ status: 'DEGRADED', results: [], diagnostics: { reason } }), reason).toBe(true);
    }
    expect(
      validate({
        status: 'OK',
        results: [{ content: 'knowledge', source: 'docs/upf.md', score: 0.8, rankHint: '1' }],
      }),
    ).toBe(true);
    expect(
      validate({
        status: 'OK',
        results: [{ content: 'knowledge', source: 'docs/upf.md', hostPath: 'C:\\secret\\upf.md' }],
      }),
    ).toBe(false);
    expect(
      validate({
        status: 'OK',
        results: [{ content: 'knowledge', source: 'C:\\secret\\upf.md' }],
      }),
    ).toBe(false);
    expect(
      validate({
        status: 'OK',
        results: [{ content: 'knowledge', source: 'C:secret/upf.md' }],
      }),
    ).toBe(false);
    expect(
      validate({
        status: 'FAILED',
        results: [],
        diagnostics: { reason: 'EXECUTION_FAILED', rawError: 'private stack' },
      }),
    ).toBe(false);
  });

  it('does not define provider-private RAG fields in the public contract', () => {
    const source = readFileSync(join(process.cwd(), 'packages', 'agent-contracts', 'src', 'gateway', 'index.ts'), 'utf8');
    const ragContractStart = source.indexOf('export type RagRetrievalStatus');
    const nextContractStart = source.indexOf('export type ScheduledMaintenanceOverlapPolicy');
    expect(ragContractStart).toBeGreaterThanOrEqual(0);
    expect(nextContractStart).toBeGreaterThan(ragContractStart);
    const ragContractSource = source.slice(ragContractStart, nextContractStart);

    expect(ragContractSource).not.toMatch(/\b(?:workspaceRoot|hostPath|sqlitePath|fts5Expression|providerIndexBinding|credential|connection)\b/u);
  });
});
