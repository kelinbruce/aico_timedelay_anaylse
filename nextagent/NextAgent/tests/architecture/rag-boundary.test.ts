import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();

describe('RAG architecture boundaries', () => {
  it('keeps the builtin RAG Tool behind the gateway contract', () => {
    const ragToolSources = readSources(join(root, 'packages', 'agent-capability', 'src', 'builtins', 'rag'));

    expect(ragToolSources).toContain('@nextagent/agent-contracts/gateway');
    expect(ragToolSources).not.toContain('@nextagent/agent-platform-gateway-local');
    expect(ragToolSources).not.toMatch(/node:sqlite|fts5|workspaceRoot|hostPath|sqlitePath/u);
  });

  it('keeps local RAG governance out of runtime, core, context, channel and capability packages', () => {
    for (const packageName of ['agent-runtime', 'agent-core', 'agent-context-engine', 'agent-channel-web', 'agent-capability']) {
      const source = readSources(join(root, 'packages', packageName, 'src'));
      expect(source).not.toContain('local-rag-knowledge-governance');
      expect(source).not.toContain('createLocalRagKnowledgeGovernance');
    }
  });

  it('models local governance data as one temporary FTS5 table without durable manifest tables', () => {
    const source = readFileSync(join(root, 'packages', 'agent-platform-gateway-local', 'src', 'rag', 'local-rag-knowledge-governance.ts'), 'utf8');

    expect(source).toContain('CREATE VIRTUAL TABLE');
    expect(source).toContain('USING fts5');
    expect(source).toContain('rag_temp_chunks');
    expect(source).not.toMatch(/CREATE\s+TABLE\s+(?:rag_snapshot|rag_manifest|rag_document|rag_file|rag_current|records)\b/iu);
    expect(source).not.toMatch(/\b(?:hostPath|workspaceRootPath|sqlitePath|fts5Expression|credential|connection)\b/u);
  });
});

function readSources(directory: string): string {
  if (!existsSync(directory)) {
    return '';
  }
  const stats = statSync(directory);
  if (stats.isFile()) {
    return directory.endsWith('.ts') ? readFileSync(directory, 'utf8') : '';
  }
  return readdirSync(directory)
    .map((entry) => readSources(join(directory, entry)))
    .join('\n');
}
