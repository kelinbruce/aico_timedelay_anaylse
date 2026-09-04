import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();

describe('memory aging architecture boundary', () => {
  it('keeps runtime, channel, context, model, and capability packages out of aging lifecycle logic', () => {
    for (const packageName of ['agent-runtime', 'agent-channel-web', 'agent-context-engine', 'agent-model', 'agent-capability']) {
      for (const file of sourceFiles(join(root, 'packages', packageName, 'src'))) {
        const source = readFileSync(file, 'utf8');
        expect(source).not.toMatch(/@nextagent\/agent-memory|memory-aging|MemoryAging|MEMORY_AGING_/u);
      }
    }
  });

  it('keeps aging implementation on public memory gateway ports and away from model-facing tools', () => {
    const source = readFileSync(join(root, 'packages', 'agent-memory', 'src', 'memory-aging.ts'), 'utf8');
    expect(source).not.toMatch(
      /@nextagent\/agent-capability|CapabilityInvocation|ToolDefinition|LongTermMemoryToolPort|memory-tools|createMemoryToolDefinitions/u,
    );
    expect(source).not.toMatch(/agent-platform-gateway-local|SqliteGatewayStores|node:sqlite|FTS5|LongTermMemoryRow/u);
    expect(source).toContain('listLongTermMemory');
    expect(source).toContain('mutateLongTermMemory');
    expect(source).not.toMatch(/transitionLongTermMemoryState|adjustLongTermMemoryConfidence|markLongTermMemoryAccessed/u);
    expect(source).toContain('deleteLongTermMemory');
    expect(source).toContain('getLongTermMemoryDetail');
  });

  it('keeps local aging disabled for remote complete-service memory backend', () => {
    const appSource = readFileSync(join(root, 'packages', 'agent-app', 'src', 'composition', 'create-app.ts'), 'utf8');
    const gatewayCompositionSource = readFileSync(join(root, 'packages', 'agent-app', 'src', 'composition', 'gateway-composition.ts'), 'utf8');
    const memoryMaintenanceSource = readFileSync(
      join(root, 'packages', 'agent-app', 'src', 'composition', 'memory-maintenance-composition.ts'),
      'utf8',
    );
    expect(gatewayCompositionSource).toContain("input.systemConfig.gateway.deploymentMode === 'LOCAL'");
    expect(gatewayCompositionSource).toContain("isGatewayAdapterSelectedForDeployment(input.systemConfig, 'sqlite', 'LOCAL')");
    expect(appSource).toContain('localPersistenceSelected');
    expect(appSource).toContain('composeMemoryMaintenanceLayer');
    expect(memoryMaintenanceSource).toContain('if (!input.localPersistenceSelected)');
    expect(memoryMaintenanceSource).toContain('createMemoryAgingScheduler');
    expect(`${gatewayCompositionSource}\n${memoryMaintenanceSource}`).not.toMatch(
      /isGatewayAdapterSelectedForDeployment\(input\.systemConfig, 'sqlite', 'REMOTE'\)[\s\S]*createMemoryAgingScheduler/u,
    );
    expect(`${gatewayCompositionSource}\n${memoryMaintenanceSource}`).toMatch(
      /const localPersistenceSelected\s*=\s*input\.systemConfig\.gateway\.deploymentMode === 'LOCAL'[\s\S]*isGatewayAdapterSelectedForDeployment\(input\.systemConfig, 'sqlite', 'LOCAL'\)[\s\S]*getLongTermMemoryDetailWithAging/u,
    );
  });
});

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? sourceFiles(path) : entry.name.endsWith('.ts') ? [path] : [];
  });
}
