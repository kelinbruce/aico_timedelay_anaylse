import { brand, type EpochMillis } from '@nextagent/agent-common';
import type { AuditEventRecord } from '@nextagent/agent-contracts/gateway';
import type { LocalFileRollHandle, LocalFileRollPolicy } from '@nextagent/agent-local-file-roll';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createFileAuditEventStoreGateway } from '../src/index.js';
import { auditFilePolicy, createFileAuditEventStoreGatewayForTesting } from '../src/testing.js';

const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('file audit event store', () => {
  it('appends one complete versioned record per NDJSON line and tolerates duplicate retry', async () => {
    const directory = tempDirectory();
    const gateway = createFileAuditEventStoreGateway({ logDirectory: directory });
    const record = auditRecord();

    await gateway.appendAuditEvent(record);
    await gateway.appendAuditEvent(record);
    await gateway.flush(2_000);

    const active = readdirSync(directory).find((name) => /^nextagent-audit\.\d{4}-\d{2}-\d{2}\.\d+\.ndjson$/u.test(name));
    expect(active).toBeDefined();
    const lines = readFileSync(join(directory, active!), 'utf8')
      .trimEnd()
      .split('\n')
      .map((line) => JSON.parse(line));
    expect(lines).toEqual([
      { schemaVersion: 1, record },
      { schemaVersion: 1, record },
    ]);
    await gateway.close();
  });

  it('owns a fixed independent audit file policy', () => {
    const directory = tempDirectory();
    expect(auditFilePolicy(directory)).toEqual({
      directory,
      fileName: 'nextagent-audit.ndjson',
      naming: 'date-sequence',
      maxFileSizeMiB: 30,
      retentionDays: 7,
      maxArchiveFiles: 10,
      bufferCapacityBytes: 4 * 1024 * 1024,
    });
  });

  it('maps mechanism rejection to append failure without partial fallback', async () => {
    const appendLine = vi.fn(() => ({ status: 'dropped', reason: 'buffer_full' }) as const);
    const handle = testHandle({ appendLine });
    const gateway = createFileAuditEventStoreGatewayForTesting({ logDirectory: tempDirectory() }, async () => handle);

    await expect(gateway.appendAuditEvent(auditRecord())).rejects.toThrow('audit append buffer_full');
    expect(appendLine).toHaveBeenCalledOnce();
  });

  it('passes the fixed policy to a distinct handle and closes idempotently', async () => {
    const directory = tempDirectory();
    const close = vi.fn(async () => undefined);
    const policies: LocalFileRollPolicy[] = [];
    const gateway = createFileAuditEventStoreGatewayForTesting({ logDirectory: directory }, async (policy) => {
      policies.push(policy);
      return testHandle({ close });
    });

    await gateway.appendAuditEvent(auditRecord());
    await Promise.all([gateway.close(25), gateway.close(25)]);

    expect(policies).toEqual([auditFilePolicy(directory)]);
    expect(close).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledWith(25);
  });

  it('rejects records without trusted agent scope before enqueue', async () => {
    const appendLine = vi.fn(() => ({ status: 'accepted' }) as const);
    const gateway = createFileAuditEventStoreGatewayForTesting({ logDirectory: tempDirectory() }, async () => testHandle({ appendLine }));
    const { agentId: _agentId, ...unscoped } = auditRecord();

    await expect(gateway.appendAuditEvent(unscoped as AuditEventRecord)).rejects.toThrow('requires agentId');
    expect(appendLine).not.toHaveBeenCalled();
  });

  it('reports asynchronous maintenance degradation without rejecting active audit appends', async () => {
    let maintenanceListener: Parameters<LocalFileRollHandle['setMaintenanceEventListener']>[0] | undefined;
    const maintenanceEvents: Parameters<LocalFileRollHandle['setMaintenanceEventListener']>[0] extends (event: infer T) => void ? T[] : never = [];
    const gateway = createFileAuditEventStoreGatewayForTesting(
      { logDirectory: tempDirectory(), onMaintenanceEvent: (event) => maintenanceEvents.push(event) },
      async () =>
        testHandle({
          setMaintenanceEventListener: (listener) => {
            maintenanceListener = listener;
          },
        }),
    );
    await gateway.appendAuditEvent(auditRecord());

    maintenanceListener?.({ operation: 'retention', outcome: 'failed', affectedCount: 1 });
    await expect(gateway.appendAuditEvent(auditRecord())).resolves.toBeUndefined();
    maintenanceListener?.({ operation: 'retention', outcome: 'completed', affectedCount: 1 });
    await expect(gateway.appendAuditEvent(auditRecord())).resolves.toBeUndefined();
    expect(maintenanceEvents).toEqual([
      { operation: 'retention', outcome: 'failed', affectedCount: 1 },
      { operation: 'retention', outcome: 'completed', affectedCount: 1 },
    ]);
    await gateway.close();
  });

  it('isolates maintenance listener failure from audit evidence appends', async () => {
    let maintenanceListener: Parameters<LocalFileRollHandle['setMaintenanceEventListener']>[0] | undefined;
    const gateway = createFileAuditEventStoreGatewayForTesting(
      {
        logDirectory: tempDirectory(),
        onMaintenanceEvent: () => {
          throw new Error('listener failure');
        },
      },
      async () =>
        testHandle({
          setMaintenanceEventListener: (listener) => {
            maintenanceListener = listener;
          },
        }),
    );
    await gateway.appendAuditEvent(auditRecord());

    expect(() => maintenanceListener?.({ operation: 'archive', outcome: 'failed', affectedCount: 1 })).not.toThrow();
    await expect(gateway.appendAuditEvent(auditRecord())).resolves.toBeUndefined();
    await gateway.close();
  });

  it('contains file initialization failure until the projector-visible append boundary', async () => {
    const gateway = createFileAuditEventStoreGatewayForTesting({ logDirectory: tempDirectory() }, async () => {
      throw new Error('forbidden-init-error-canary');
    });
    await new Promise((resolve) => setImmediate(resolve));

    await expect(gateway.appendAuditEvent(auditRecord())).rejects.toThrow('audit file unavailable');
    await expect(gateway.close()).resolves.toBeUndefined();
  });
});

function tempDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), 'nextagent-audit-file-'));
  directories.push(directory);
  return directory;
}

function auditRecord(): AuditEventRecord {
  return {
    auditId: 'audit-1',
    eventName: 'capability.denied',
    tenantId: brand<string, 'TenantId'>('tenant-1'),
    subjectId: brand<string, 'SubjectId'>('subject-1'),
    agentId: brand<string, 'AgentId'>('agent-1'),
    requestRunId: brand<string, 'RequestRunId'>('run-1'),
    safeSummary: 'Capability denied by policy.',
    attributes: { outcome: 'denied', retryable: false },
    occurredAt: brand<number, 'EpochMillis'>(1_700_000_000_000) as EpochMillis,
  };
}

function testHandle(overrides: Partial<LocalFileRollHandle>): LocalFileRollHandle {
  return {
    appendLine: () => ({ status: 'accepted' }),
    activeIdentity: () => undefined,
    setMaintenanceEventListener: () => undefined,
    flush: async () => undefined,
    close: async () => undefined,
    ...overrides,
  };
}
