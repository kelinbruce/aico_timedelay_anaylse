import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();

describe('memory extraction architecture boundary', () => {
  it('keeps runtime out of memory extraction semantics', () => {
    for (const file of sourceFiles(join(root, 'packages', 'agent-runtime', 'src'))) {
      const source = readFileSync(file, 'utf8');
      expect(source).not.toMatch(/@nextagent\/agent-memory|memory-extraction|MemoryExtraction/iu);
    }
  });

  it('keeps context assembly from automatic long-term memory retrieval or injection', () => {
    for (const file of sourceFiles(join(root, 'packages', 'agent-context-engine', 'src'))) {
      const source = readFileSync(file, 'utf8');
      expect(source).not.toMatch(/@nextagent\/agent-memory|LongTermMemory|search_memory|get_memory_detail|add_memory/iu);
    }
  });

  it('keeps background extraction away from memory tools and gateway-local internals', () => {
    const source = readFileSync(join(root, 'packages', 'agent-memory', 'src', 'memory-extraction.ts'), 'utf8');
    expect(source).not.toMatch(
      /@nextagent\/agent-capability|CapabilityInvocation|ToolMetadata|LongTermMemoryToolPort|memory-tools|createMemoryToolDefinitions/iu,
    );
    expect(source).not.toMatch(/agent-platform-gateway-local|SqliteGatewayStores|node:sqlite|FTS5|SessionMessageRow/iu);
    expect(source).toContain('saveLongTermMemory');
    expect(source).toContain('mutateLongTermMemory');
    expect(source).not.toMatch(/transitionLongTermMemoryState|adjustLongTermMemoryConfidence|markLongTermMemoryAccessed/u);
    expect(source).not.toContain('searchLongTermMemory');
    expect(source).not.toContain('getLongTermMemoryDetail');
  });

  it('keeps local extraction disabled for remote complete-service memory backend', () => {
    const appSource = readFileSync(join(root, 'packages', 'agent-app', 'src', 'composition', 'create-app.ts'), 'utf8');
    const gatewayCompositionSource = readFileSync(join(root, 'packages', 'agent-app', 'src', 'composition', 'gateway-composition.ts'), 'utf8');
    const memoryMaintenanceSource = readFileSync(
      join(root, 'packages', 'agent-app', 'src', 'composition', 'memory-maintenance-composition.ts'),
      'utf8',
    );
    expect(gatewayCompositionSource).toContain("input.systemConfig.gateway.deploymentMode === 'LOCAL'");
    expect(gatewayCompositionSource).toContain("isGatewayAdapterSelectedForDeployment(input.systemConfig, 'sqlite', 'LOCAL')");
    expect(appSource).toContain('composeMemoryMaintenanceLayer');
    expect(memoryMaintenanceSource).toContain('if (!input.localPersistenceSelected)');
    expect(memoryMaintenanceSource).toContain('createMemoryExtractionScheduler');
    expect(`${gatewayCompositionSource}\n${memoryMaintenanceSource}`).not.toMatch(
      /isGatewayAdapterSelectedForDeployment\(input\.systemConfig, 'sqlite', 'REMOTE'\)[\s\S]*createMemoryExtractionScheduler/u,
    );
  });

  it('does not re-export core gateway ports from agent-memory', () => {
    const source = readFileSync(join(root, 'packages', 'agent-memory', 'src', 'index.ts'), 'utf8');
    expect(source).not.toMatch(/LongTermMemoryStoreGateway|LongTermMemoryRetrieverGateway|agent-contracts\/gateway/u);
  });
});

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? sourceFiles(path) : entry.name.endsWith('.ts') ? [path] : [];
  });
}
