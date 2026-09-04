import { createSqliteGatewayStores, type LocalGatewayStores } from '@nextagent/agent-platform-gateway-local';
import { createForkActiveContextSelector } from '@nextagent/agent-context-engine';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach } from 'vitest';

const created: { readonly gateway: LocalGatewayStores; readonly dir: string }[] = [];

afterEach(() => {
  for (const entry of created.splice(0)) {
    entry.gateway.close?.();
    rmSync(entry.dir, { recursive: true, force: true });
  }
});

export interface TestGatewayStoresWithSqliteFile {
  readonly gateway: LocalGatewayStores;
  readonly sqliteFile: string;
}

export function createTestGatewayStores(): LocalGatewayStores {
  return createTestGatewayStoresWithSqliteFile().gateway;
}

export function createTestGatewayStoresWithSqliteFile(): TestGatewayStoresWithSqliteFile {
  const dir = mkdtempSync(join(tmpdir(), 'nextagent-gateway-'));
  const sqliteFile = join(dir, 'test.sqlite');
  const gateway = createSqliteGatewayStores({ sqliteFile, forkActiveContextSelector: createForkActiveContextSelector() });
  created.push({ gateway, dir });
  return { gateway, sqliteFile };
}
