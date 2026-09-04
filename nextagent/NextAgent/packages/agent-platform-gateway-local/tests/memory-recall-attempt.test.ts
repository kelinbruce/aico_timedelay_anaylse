import { brand, type AgentId, type EpochMillis, type RequestRunId, type SubjectId, type TenantId } from '@nextagent/agent-common';
import type { RequestRunMemoryRecallAttemptLookupRequest, RequestRunMemoryRecallAttemptRecord } from '@nextagent/agent-contracts/gateway';
import { createSqliteGatewayStores } from '@nextagent/agent-platform-gateway-local';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

describe('request-run memory recall attempt gateway', () => {
  let dir: string;
  let sqliteFile: string;
  let stores: ReturnType<typeof createSqliteGatewayStores>;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'memory-recall-attempt-'));
    sqliteFile = join(dir, 'test.db');
    stores = createSqliteGatewayStores({ sqliteFile });
  });

  afterEach(() => {
    stores.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('atomically claims one scoped anchor and returns the original claim on repetition', async () => {
    const first = attemptRecord();
    const otherStores = createSqliteGatewayStores({ sqliteFile });

    try {
      const [left, right] = await Promise.all([
        stores.memoryRecallAttempts.claimAttempt(first),
        otherStores.memoryRecallAttempts.claimAttempt({
          ...first,
          createdAt: brand<number, 'EpochMillis'>(99),
          updatedAt: brand<number, 'EpochMillis'>(99),
        }),
      ]);
      expect([left.status, right.status].sort()).toEqual(['ALREADY_CLAIMED', 'CLAIMED']);
      expect(left.record).toEqual(first);
      expect(right.record).toEqual(first);
    } finally {
      otherStores.close();
    }

    await expect(stores.memoryRecallAttempts.claimAttempt(attemptRecord({ subjectId: 'U2' }))).resolves.toMatchObject({ status: 'CLAIMED' });
    await expect(stores.memoryRecallAttempts.claimAttempt(attemptRecord({ agentId: 'A2' }))).resolves.toMatchObject({ status: 'CLAIMED' });
  });

  it('completes STARTED with expected-version CAS and cannot overwrite a terminal state', async () => {
    const started = attemptRecord();
    await stores.memoryRecallAttempts.claimAttempt(started);
    const completed = attemptRecord({
      state: 'COMPLETED_L1_CONTEXT',
      version: 2,
      updatedAt: 2,
    });

    await expect(stores.memoryRecallAttempts.completeAttempt(completed, { expectedVersion: 1 })).resolves.toEqual({
      status: 'UPDATED',
      record: completed,
    });
    await expect(
      stores.memoryRecallAttempts.completeAttempt(
        {
          ...completed,
          state: 'COMPLETED_CONTEXT',
          version: 3,
        },
        { expectedVersion: 1 },
      ),
    ).resolves.toEqual({ status: 'VERSION_CONFLICT' });
    await expect(stores.memoryRecallAttempts.loadAttempt(scope())).resolves.toEqual(completed);
  });

  it('uses a dedicated table whose persisted fact contains no protected recall content', async () => {
    await stores.memoryRecallAttempts.claimAttempt(attemptRecord());

    const db = new DatabaseSync(sqliteFile, { readOnly: true });
    try {
      const row = db.prepare('SELECT json FROM request_run_memory_recall_attempts').get() as { readonly json: string };
      const persisted = JSON.parse(row.json) as Record<string, unknown>;

      expect(Object.keys(persisted).sort()).toEqual([
        'agentId',
        'createdAt',
        'hookId',
        'requestRunId',
        'state',
        'subjectId',
        'tenantId',
        'updatedAt',
        'version',
      ]);
      expect(row.json).not.toContain('queryText');
      expect(row.json).not.toContain('memoryId');
      expect(row.json).not.toContain('content');
    } finally {
      db.close();
    }
  });
});

function attemptRecord(
  overrides: {
    readonly subjectId?: string;
    readonly agentId?: string;
    readonly state?: RequestRunMemoryRecallAttemptRecord['state'];
    readonly version?: number;
    readonly updatedAt?: number;
  } = {},
): RequestRunMemoryRecallAttemptRecord {
  return {
    tenantId: 'T1' as TenantId,
    subjectId: (overrides.subjectId ?? 'U1') as SubjectId,
    agentId: (overrides.agentId ?? 'A1') as AgentId,
    requestRunId: 'R1' as RequestRunId,
    hookId: 'user-query-memory-recall',
    state: overrides.state ?? 'STARTED',
    version: overrides.version ?? 1,
    createdAt: brand<number, 'EpochMillis'>(1),
    updatedAt: brand<number, 'EpochMillis'>(overrides.updatedAt ?? 1),
  };
}

function scope(): RequestRunMemoryRecallAttemptLookupRequest {
  return {
    tenantId: 'T1' as TenantId,
    subjectId: 'U1' as SubjectId,
    agentId: 'A1' as AgentId,
    requestRunId: 'R1' as RequestRunId,
    hookId: 'user-query-memory-recall',
  };
}
