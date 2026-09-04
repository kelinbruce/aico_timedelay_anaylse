import { brand, type SafeError } from '@nextagent/agent-common';
import type { LongTermMemoryManagementPort, LongTermMemoryManagementScope } from '@nextagent/agent-contracts/channel';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const safeError: SafeError = {
  code: 'LTM_STORAGE_UNAVAILABLE',
  message: 'Long-term memory is temporarily unavailable.',
  category: 'UNAVAILABLE',
  retryable: true,
};

const managementPort = {
  async saveLongTermMemory() {
    return safeError;
  },
  async listLongTermMemory() {
    return safeError;
  },
  async batchCreateLongTermMemory() {
    return safeError;
  },
  async manualSaveLongTermMemory() {
    return safeError;
  },
  async getLongTermMemory() {
    return safeError;
  },
  async deleteLongTermMemory() {
    return safeError;
  },
  async mutateLongTermMemory() {
    return safeError;
  },
  async searchLongTermMemory() {
    return safeError;
  },
  async getLongTermMemoryDetail() {
    return safeError;
  },
  async publishLongTermMemory() {
    return safeError;
  },
  async unpublishLongTermMemory() {
    return safeError;
  },
  async listPublishedLongTermMemory() {
    return safeError;
  },
  async copyPublishedMemory() {
    return safeError;
  },
} satisfies LongTermMemoryManagementPort;

describe('long-term memory management contract', () => {
  it('freezes the single 13-operation Channel port', () => {
    expect(Object.keys(managementPort).sort()).toEqual([
      'batchCreateLongTermMemory',
      'copyPublishedMemory',
      'deleteLongTermMemory',
      'getLongTermMemory',
      'getLongTermMemoryDetail',
      'listLongTermMemory',
      'listPublishedLongTermMemory',
      'manualSaveLongTermMemory',
      'mutateLongTermMemory',
      'publishLongTermMemory',
      'saveLongTermMemory',
      'searchLongTermMemory',
      'unpublishLongTermMemory',
    ]);
    expect(Object.keys(managementPort)).not.toEqual(
      expect.arrayContaining([
        'countLongTermMemory',
        'batchLongTermMemory',
        'transitionLongTermMemoryState',
        'adjustLongTermMemoryConfidence',
        'markLongTermMemoryAccessed',
      ]),
    );
  });

  it('keeps trusted scope limited to owner and Agent coordinates', () => {
    const scope: LongTermMemoryManagementScope = {
      identityContext: {
        tenantId: brand<string, 'TenantId'>('tenant-1'),
        subjectId: brand<string, 'SubjectId'>('subject-1'),
        displayName: 'Trusted User',
      },
      agentId: brand<string, 'AgentId'>('agent-1'),
    };

    expect(Object.keys(scope).sort()).toEqual(['agentId', 'identityContext']);
    expect(scope.identityContext).toEqual({
      tenantId: 'tenant-1',
      subjectId: 'subject-1',
      displayName: 'Trusted User',
    });
    expect(scope).not.toHaveProperty('userId');
  });

  it('owns management DTOs without Gateway contract leakage', async () => {
    const source = await readFile(join(process.cwd(), 'packages/agent-contracts/src/channel/index.ts'), 'utf8');
    const packageJson = JSON.parse(await readFile(join(process.cwd(), 'packages/agent-contracts/package.json'), 'utf8')) as {
      readonly exports: Readonly<Record<string, unknown>>;
    };

    expect(packageJson.exports).toHaveProperty('./channel');
    expect(source).toContain('export interface LongTermMemoryManagementPort');
    expect(source).not.toContain('@nextagent/agent-contracts/gateway');
    for (const forbidden of [
      'LongTermMemoryGatewayBindings',
      'LongTermMemoryStoreGateway',
      'LongTermMemoryRetrieverGateway',
      'LongTermMemorySharingGateway',
      'LongTermMemoryRecord',
      'VersionedWriteOptions',
    ]) {
      expect(source).not.toContain(forbidden);
    }
  });
});
