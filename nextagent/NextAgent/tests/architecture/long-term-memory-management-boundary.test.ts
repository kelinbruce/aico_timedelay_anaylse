import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();

describe('long-term memory management boundary', () => {
  it('keeps the Channel contract independent from Gateway DTOs and implementations', () => {
    const source = readFileSync(join(root, 'packages/agent-contracts/src/channel/index.ts'), 'utf8');

    expect(source).toContain('export interface LongTermMemoryManagementPort');
    expect(source).not.toMatch(/@nextagent\/agent-contracts\/gateway|\.\.\/gateway|LongTermMemoryGatewayBindings/u);
    expect(source).not.toMatch(/LongTermMemory(?:Record|StoreGateway|RetrieverGateway|SharingGateway)|VersionedWriteOptions/u);
    expect(source).not.toMatch(/@nextagent\/agent-(?:memory|app|channel-web|platform-gateway)/u);
  });

  it('keeps Web Channel on the management port and out of Gateway contracts', () => {
    const source = readAllSource(join(root, 'packages/agent-channel-web/src'));

    expect(source).toContain('LongTermMemoryManagementPort');
    expect(source).not.toMatch(/@nextagent\/agent-contracts\/gateway/u);
    expect(source).not.toMatch(/LongTermMemoryGatewayBindings|LongTermMemory(?:Store|Retriever|Sharing)Gateway|LongTermMemoryRecord/u);
    expect(source).not.toMatch(/@nextagent\/agent-memory/u);
  });

  it('keeps mapping in agent-memory and app limited to factory wiring', () => {
    const service = readFileSync(join(root, 'packages/agent-memory/src/long-term-memory-management.ts'), 'utf8');
    const app = readFileSync(join(root, 'packages/agent-app/src/composition/create-app.ts'), 'utf8');
    const channelComposition = readFileSync(join(root, 'packages/agent-app/src/composition/channel-composition.ts'), 'utf8');

    expect(service).toContain('@nextagent/agent-contracts/channel');
    expect(service).toContain('@nextagent/agent-contracts/gateway');
    expect(channelComposition).toContain('createLongTermMemoryManagementService');
    expect(app).not.toMatch(/function projectLongTermMemory|function mapLongTermMemory|LongTermMemoryManagementView/u);
    expect(channelComposition).toContain('longTermMemoryManagement');
    expect(`${app}\n${channelComposition}`).not.toContain('longTermMemoryStores');
  });
});

function readAllSource(directory: string): string {
  return readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) => {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        return readAllSource(path);
      }
      return entry.name.endsWith('.ts') ? readFileSync(path, 'utf8') : '';
    })
    .join('\n');
}
