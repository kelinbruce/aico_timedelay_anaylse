import { createSqliteGatewayStores, type LocalGatewayStores } from '@nextagent/agent-platform-gateway-local';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

export type TestGatewayStoresWithSqliteFile = {
  gateway: LocalGatewayStores;
  sqliteFile: string;
};

export function createTestGatewayStores(): LocalGatewayStores {
  const sqliteFile = join(tmpdir(), `test-gateway-${randomUUID()}.sqlite`);
  const stores = createSqliteGatewayStores({ sqliteFile });
  const originalClose = stores.close?.bind(stores);
  const gateway: LocalGatewayStores = {
    requestRuns: stores.requestRuns,
    sessions: stores.sessions,
    messages: stores.messages,
    attachments: stores.attachments,
    activeContext: stores.activeContext,
    timeline: stores.timeline,
    checkpoints: stores.checkpoints,
    pendingInputs: stores.pendingInputs,
    gatewayKind: 'sqlite',
    close: originalClose,
  };
  return gateway;
}

export function createTestGatewayStoresWithSqliteFile(): TestGatewayStoresWithSqliteFile {
  const sqliteFile = join(tmpdir(), `test-gateway-${randomUUID()}.sqlite`);
  const stores = createSqliteGatewayStores({ sqliteFile });
  const originalClose = stores.close?.bind(stores);
  const gateway: LocalGatewayStores = {
    requestRuns: stores.requestRuns,
    sessions: stores.sessions,
    messages: stores.messages,
    attachments: stores.attachments,
    activeContext: stores.activeContext,
    timeline: stores.timeline,
    checkpoints: stores.checkpoints,
    pendingInputs: stores.pendingInputs,
    gatewayKind: 'sqlite',
    close: originalClose,
  };
  return { gateway, sqliteFile };
}
