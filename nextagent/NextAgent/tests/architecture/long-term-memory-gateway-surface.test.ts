import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const removedMutationMethods = /transitionLongTermMemoryState|adjustLongTermMemoryConfidence|markLongTermMemoryAccessed/u;
const removedStoreMethods = /countLongTermMemory|batchLongTermMemory/u;

describe('long-term memory gateway public surface', () => {
  it('exposes only the YAML Store operations with a flat mutation request', () => {
    const source = readFileSync(join(root, 'packages', 'agent-contracts', 'src', 'gateway', 'index.ts'), 'utf8');
    const storeSurface = source.slice(
      source.indexOf('export interface LongTermMemoryStoreGateway'),
      source.indexOf('export interface LongTermMemoryRetrieverGateway'),
    );
    const mutationSignature = storeSurface.match(/mutateLongTermMemory:\s*\([^;]+;/u)?.[0] ?? '';

    expect(storeSurface).toContain('mutateLongTermMemory');
    expect(storeSurface).toContain('manualSaveLongTermMemory');
    expect(storeSurface).not.toMatch(removedMutationMethods);
    expect(storeSurface).not.toMatch(removedStoreMethods);
    expect(source).toMatch(/export interface MutateLongTermMemoryRequest extends OwnerScoped/u);
    expect(source).toMatch(/readonly targetState\?: LongTermMemoryState/u);
    expect(source).toMatch(/readonly delta\?: number/u);
    expect(source).toMatch(/readonly lastAccessTime\?: EpochMillis/u);
    expect(source).toMatch(/readonly isPinned\?: boolean/u);
    expect(source).not.toMatch(/readonly mutation:|kind: "TRANSITION_STATE"|kind: "ADJUST_CONFIDENCE"/u);
    expect(mutationSignature).toContain("Pick<VersionedWriteOptions, 'expectedVersion'>");
    expect(mutationSignature).not.toContain('idempotencyKey');
  });

  it('keeps category-specific memory data out of the package public barrel', () => {
    const source = readFileSync(join(root, 'packages', 'agent-memory', 'src', 'index.ts'), 'utf8');
    expect(source).not.toContain('memory-data');
  });

  it('keeps removed mutation methods out of product adapters and algorithm callers', () => {
    const productSources = [
      ...sourceFiles(join(root, 'packages', 'agent-memory', 'src')),
      join(root, 'packages', 'agent-platform-gateway-local', 'src', 'db', 'sqlite-long-term-memory-store.ts'),
    ];
    for (const file of productSources) {
      expect(readFileSync(file, 'utf8'), file).not.toMatch(removedMutationMethods);
      expect(readFileSync(file, 'utf8'), file).not.toMatch(removedStoreMethods);
    }
  });

  it('keeps flat mutation on the scoped single-record path without logging or scans', () => {
    const source = readFileSync(join(root, 'packages', 'agent-platform-gateway-local', 'src', 'db', 'sqlite-gateway-core.ts'), 'utf8');
    const mutationImplementation = source.slice(
      source.indexOf('private mutateLongTermMemorySync'),
      source.indexOf('private buildLongTermMemoryListWhere'),
    );

    expect(mutationImplementation).toContain('getLongTermMemoryRow');
    expect(mutationImplementation).toContain('request.targetState');
    expect(mutationImplementation).toContain('request.delta');
    expect(mutationImplementation).toContain('request.lastAccessTime');
    expect(mutationImplementation).toContain('request.isPinned!');
    expect(mutationImplementation).toContain('putLongTermMemory');
    expect(mutationImplementation).not.toMatch(removedMutationMethods);
    expect(mutationImplementation).not.toMatch(/listLongTermMemory|searchLongTermMemory|SELECT|diagnosticLogger|\.warn\(|\.info\(|\.error\(/u);
  });
});

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? sourceFiles(path) : entry.name.endsWith('.ts') ? [path] : [];
  });
}
