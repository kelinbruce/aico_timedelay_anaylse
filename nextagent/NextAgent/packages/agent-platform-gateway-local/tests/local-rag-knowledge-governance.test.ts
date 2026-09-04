import { bindRuntimeLoggerProvider, brand, type RuntimeLoggerProviderBinding } from '@nextagent/agent-common';
import type { RagRetrievalRequest } from '@nextagent/agent-contracts/gateway';
import { createLocalRagKnowledgeGovernance } from '@nextagent/agent-platform-gateway-local';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

describe('local RAG knowledge governance', () => {
  const cleanupDirs: string[] = [];

  afterEach(() => {
    for (const dir of cleanupDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('indexes only governed workspace text and returns safe relative source', async () => {
    const root = tempWorkspace();
    mkdirSync(join(root, 'docs'), { recursive: true });
    mkdirSync(join(root, 'node_modules', 'pkg'), { recursive: true });
    mkdirSync(join(root, '.git'), { recursive: true });
    writeFileSync(join(root, 'docs', 'handover.md'), 'gNodeB handover failure\nCheck X2 link alarms\n');
    writeFileSync(join(root, 'node_modules', 'pkg', 'leak.md'), 'secret package implementation\n');
    writeFileSync(join(root, '.git', 'hidden.md'), 'hidden repository data\n');
    writeFileSync(join(root, 'docs', 'binary.txt'), Buffer.from([0, 1, 2, 3]));
    const governance = createGovernance(root);
    try {
      await governance.build();

      const result = await governance.gateway.retrieve({
        ...scope,
        knowledgeScope: { scopeKind: 'AGENT_WORKSPACE', logicalRoot: 'workspace' },
        query: 'handover alarms',
        indexes: ['local'],
        options: { topK: 3 },
      });

      expect(result.status).toBe('OK');
      expect(result.results).toHaveLength(1);
      expect(result.results[0]?.source).toBe('docs/handover.md');
      expect(result.results[0]?.content).toContain('X2 link alarms');
      expect(JSON.stringify(result)).not.toContain(root);
      expect(JSON.stringify(result)).not.toContain('node_modules');
      expect(JSON.stringify(result)).not.toContain('.git');
    } finally {
      governance.close();
    }
  });

  it('returns NO_INDEX before startup build and after cleanup', async () => {
    const root = tempWorkspace();
    writeFileSync(join(root, 'notes.md'), 'radio access knowledge');
    const governance = createGovernance(root);
    try {
      const before = await governance.gateway.retrieve(validRequest('radio'));
      expect(before.status).toBe('NO_INDEX');
      expect(before.diagnostics?.reason).toBe('NO_INDEX');

      await governance.build();
      await governance.cleanup();

      const after = await governance.gateway.retrieve(validRequest('radio'));
      expect(after.status).toBe('NO_INDEX');
    } finally {
      governance.close();
    }
  });

  it('records bounded index-build and retrieval diagnostics without corpus data', async () => {
    const root = tempWorkspace();
    writeFileSync(join(root, 'notes.md'), 'private handover recovery content');
    const logs: unknown[] = [];
    const loggerBinding: RuntimeLoggerProviderBinding = bindRuntimeLoggerProvider({ getLogger: () => testLogger(logs) });
    const governance = createGovernance(root);
    try {
      await governance.build();
      await governance.gateway.retrieve(validRequest('private handover'));

      expect(logs).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ event: 'local_rag_index_build_completed', status: 'READY', chunkCountBucket: '1' }),
          expect.objectContaining({ event: 'local_rag_retrieval_completed', status: 'OK', resultCountBucket: '1', indexCountBucket: '1', topK: 5 }),
        ]),
      );
      expect(JSON.stringify(logs)).not.toMatch(/private handover|notes\.md/u);
    } finally {
      governance.close();
      loggerBinding.unbind();
    }
  });

  it('allows same-owner workspace retrieval from another agent', async () => {
    const root = tempWorkspace();
    writeFileSync(join(root, 'notes.md'), 'handover troubleshooting');
    const governance = createGovernance(root);
    try {
      await governance.build();
      const result = await governance.gateway.retrieve({
        ...validRequest('handover'),
        agentId: brand<string, 'AgentId'>('other-agent'),
      });

      expect(result.status).toBe('OK');
      expect(result.diagnostics).toBeUndefined();
      expect(result.results).toHaveLength(1);
      expect(result.results[0]?.content).toContain('handover troubleshooting');
    } finally {
      governance.close();
    }
  });

  it('rejects owner scope mismatches before querying the local index', async () => {
    const root = tempWorkspace();
    writeFileSync(join(root, 'notes.md'), 'handover troubleshooting');
    const governance = createGovernance(root);
    try {
      await governance.build();
      const tenantMismatch = await governance.gateway.retrieve({
        ...validRequest('handover'),
        tenantId: brand<string, 'TenantId'>('other-tenant'),
      });
      const subjectMismatch = await governance.gateway.retrieve({
        ...validRequest('handover'),
        subjectId: brand<string, 'SubjectId'>('other-subject'),
      });

      expect(tenantMismatch.status).toBe('FAILED');
      expect(tenantMismatch.diagnostics?.reason).toBe('SCOPE_MISMATCH');
      expect(tenantMismatch.results).toEqual([]);
      expect(subjectMismatch.status).toBe('FAILED');
      expect(subjectMismatch.diagnostics?.reason).toBe('SCOPE_MISMATCH');
      expect(subjectMismatch.results).toEqual([]);
    } finally {
      governance.close();
    }
  });

  it('ignores read directories that escape the workspace or resolve through symlinks', async () => {
    const root = tempWorkspace();
    const outside = tempWorkspace();
    writeFileSync(join(outside, 'outside.md'), 'outside secret handover text');
    try {
      symlinkSync(outside, join(root, 'linked'), 'dir');
    } catch {
      // Windows test hosts may deny symlink creation; the parent traversal case still covers escape rejection.
    }
    writeFileSync(join(root, 'inside.md'), 'inside handover text');
    const governance = createGovernance(root, { readDirectories: ['linked', '..', '.'] });
    try {
      await governance.build();

      const result = await governance.gateway.retrieve(validRequest('handover'));

      expect(result.status).toBe('OK');
      expect(result.results.map((item) => item.source)).toEqual(['inside.md']);
      expect(JSON.stringify(result)).not.toContain('outside secret');
    } finally {
      governance.close();
    }
  });

  it('chunks by bounded line windows with stable workspace-relative source', async () => {
    const root = tempWorkspace();
    const lines = Array.from({ length: 61 }, (_value, index) => `unique-line-${index + 1}`);
    writeFileSync(join(root, 'long.md'), lines.join('\n'));
    const governance = createGovernance(root);
    try {
      await governance.build();
      const first = await governance.gateway.retrieve(validRequest('unique-line-61'));
      await governance.cleanup();
      await governance.build();
      const second = await governance.gateway.retrieve(validRequest('unique-line-61'));

      expect(first.status).toBe('OK');
      expect(first.results[0]?.source).toBe('long.md');
      expect(second.results[0]?.source).toBe(first.results[0]?.source);
    } finally {
      governance.close();
    }
  });

  it('retrieves multiple chunks from a long file with bounded line windows', async () => {
    const root = tempWorkspace();
    const lines = Array.from({ length: 121 }, (_value, index) => `shared-handover-token line ${index + 1}`);
    writeFileSync(join(root, 'long-handover.md'), lines.join('\n'));
    const governance = createGovernance(root);
    try {
      await governance.build();

      const result = await governance.gateway.retrieve({
        ...validRequest('shared-handover-token'),
        options: { topK: 3 },
      });

      expect(result.status).toBe('OK');
      expect(result.results).toHaveLength(3);
      expect(result.results.map((item) => item.source)).toEqual(['long-handover.md', 'long-handover.md', 'long-handover.md']);
      expect(JSON.stringify(result)).not.toContain(root);
    } finally {
      governance.close();
    }
  });

  it('applies topK at retrieval time and returns stable rank hints', async () => {
    const root = tempWorkspace();
    writeFileSync(join(root, 'one.md'), 'nr-cell-outage shared-query-token one');
    writeFileSync(join(root, 'two.md'), 'nr-cell-outage shared-query-token two');
    writeFileSync(join(root, 'three.md'), 'nr-cell-outage shared-query-token three');
    const governance = createGovernance(root);
    try {
      await governance.build();

      const result = await governance.gateway.retrieve({
        ...validRequest('shared-query-token'),
        options: { topK: 2 },
      });

      expect(result.status).toBe('OK');
      expect(result.results).toHaveLength(2);
      expect(result.results.map((item) => item.rankHint)).toEqual(['1', '2']);
      expect(result.results.every((item) => item.score === undefined || (item.score >= 0 && item.score <= 1))).toBe(true);
    } finally {
      governance.close();
    }
  });

  it('accepts configured logical indexes as local placeholder input', async () => {
    const root = tempWorkspace();
    writeFileSync(join(root, 'notes.md'), 'configured-index-placeholder handover guidance');
    const governance = createGovernance(root);
    try {
      await governance.build();

      const result = await governance.gateway.retrieve({
        ...validRequest('configured-index-placeholder'),
        indexes: ['local', 'remote-netops'],
      });

      expect(result.status).toBe('OK');
      expect(result.results.map((item) => item.source)).toEqual(['notes.md']);
    } finally {
      governance.close();
    }
  });

  it('rejects queries that do not produce a safe FTS expression', async () => {
    const root = tempWorkspace();
    writeFileSync(join(root, 'notes.md'), 'handover troubleshooting');
    const governance = createGovernance(root);
    try {
      await governance.build();

      const result = await governance.gateway.retrieve(validRequest('!!! ???'));

      expect(result.status).toBe('FAILED');
      expect(result.diagnostics?.reason).toBe('INVALID_INPUT');
      expect(result.results).toEqual([]);
    } finally {
      governance.close();
    }
  });

  it('does not rebuild when workspace files change after startup governance', async () => {
    const root = tempWorkspace();
    writeFileSync(join(root, 'boot.md'), 'startup only knowledge');
    const governance = createGovernance(root);
    try {
      await governance.build();
      writeFileSync(join(root, 'later.md'), 'runtime added knowledge');
      writeFileSync(join(root, 'boot.md'), 'modified runtime knowledge');

      const added = await governance.gateway.retrieve(validRequest('runtime added'));
      const modified = await governance.gateway.retrieve(validRequest('modified runtime'));
      const original = await governance.gateway.retrieve(validRequest('startup only'));

      expect(added.status).toBe('OK');
      expect(added.results).toEqual([]);
      expect(modified.results).toEqual([]);
      expect(original.results.map((item) => item.source)).toEqual(['boot.md']);
    } finally {
      governance.close();
    }
  });

  function tempWorkspace(): string {
    const root = mkdtempSync(join(tmpdir(), 'nextagent-rag-'));
    cleanupDirs.push(root);
    return root;
  }
});

const scope = {
  tenantId: brand<string, 'TenantId'>('tenant-rag'),
  subjectId: brand<string, 'SubjectId'>('subject-rag'),
  agentId: brand<string, 'AgentId'>('default-agent'),
  agentVersion: brand<string, 'AgentVersion'>('1.0.0'),
};

function createGovernance(
  workspaceRoot: string,
  overrides: {
    readonly readDirectories?: readonly string[];
  } = {},
) {
  const workspacePolicy = {
    ...(overrides.readDirectories === undefined ? {} : { readDirectories: overrides.readDirectories }),
    maxTextBytes: 256_000,
  };
  return createLocalRagKnowledgeGovernance({
    sqliteFile: join(workspaceRoot, 'nextagent-test.sqlite'),
    workspaceRoot,
    workspacePolicy,
    ...scope,
  });
}

function validRequest(query: string): RagRetrievalRequest {
  return {
    ...scope,
    knowledgeScope: { scopeKind: 'AGENT_WORKSPACE' as const, logicalRoot: 'workspace' },
    query,
    indexes: ['local'],
    options: { topK: 5 },
  };
}

function testLogger(logs: unknown[]) {
  return {
    debug(fields: object): void {
      logs.push(fields);
    },
    info(fields: object): void {
      logs.push(fields);
    },
    warn(fields: object): void {
      logs.push(fields);
    },
    error(fields: object): void {
      logs.push(fields);
    },
  };
}
