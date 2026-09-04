import type { AuditEventRecord, AuditEventStoreGateway } from '@nextagent/agent-contracts/gateway';
import {
  createLocalFileRoll,
  type LocalFileAppendResult,
  type LocalFileMaintenanceEvent,
  type LocalFileRollHandle,
  type LocalFileRollPolicy,
} from '@nextagent/agent-local-file-roll';

const AUDIT_FILE_NAME = 'nextagent-audit.ndjson';
const AUDIT_MAX_FILE_SIZE_MIB = 30;
const AUDIT_RETENTION_DAYS = 7;
const AUDIT_MAX_ARCHIVE_FILES = 10;
const AUDIT_BUFFER_CAPACITY_BYTES = 4 * 1024 * 1024;

export interface FileAuditEventStoreGatewayOptions {
  readonly logDirectory: string;
  readonly onMaintenanceEvent?: (event: LocalFileMaintenanceEvent) => void;
}

interface FileAuditEventStoreGatewayDependencies {
  readonly createHandle: (policy: LocalFileRollPolicy) => Promise<LocalFileRollHandle>;
}

export class FileAuditEventStoreGateway implements AuditEventStoreGateway {
  private readonly handle: Promise<LocalFileRollHandle | undefined>;
  private closePromise?: Promise<void>;

  constructor(
    options: FileAuditEventStoreGatewayOptions,
    dependencies: FileAuditEventStoreGatewayDependencies = { createHandle: createLocalFileRoll },
  ) {
    this.handle = dependencies.createHandle(auditFilePolicy(options.logDirectory)).then(
      (handle) => {
        const listener = options.onMaintenanceEvent;
        if (listener !== undefined) {
          handle.setMaintenanceEventListener((event) => {
            try {
              listener(event);
            } catch {
              // Diagnostics cannot affect audit evidence writes.
            }
          });
        }
        return handle;
      },
      () => undefined,
    );
  }

  async appendAuditEvent(record: AuditEventRecord): Promise<void> {
    const line = serializeAuditRecord(record);
    const handle = await this.handle;
    if (handle === undefined) {
      throw new Error('audit file unavailable');
    }
    const result = handle.appendLine(line);
    assertAccepted(result);
  }

  async flush(timeoutMs: number): Promise<void> {
    const handle = await this.handle;
    if (handle === undefined) {
      throw new Error('audit file unavailable');
    }
    await handle.flush(timeoutMs);
  }

  close(timeoutMs = 5_000): Promise<void> {
    this.closePromise ??= this.handle.then((handle) => handle?.close(timeoutMs));
    return this.closePromise;
  }
}

export function createFileAuditEventStoreGateway(options: FileAuditEventStoreGatewayOptions): FileAuditEventStoreGateway {
  return new FileAuditEventStoreGateway(options);
}

export function createFileAuditEventStoreGatewayForTesting(
  options: FileAuditEventStoreGatewayOptions,
  createHandle: FileAuditEventStoreGatewayDependencies['createHandle'],
): FileAuditEventStoreGateway {
  return new FileAuditEventStoreGateway(options, { createHandle });
}

export function auditFilePolicy(logDirectory: string): LocalFileRollPolicy {
  return {
    directory: logDirectory,
    fileName: AUDIT_FILE_NAME,
    naming: 'date-sequence',
    maxFileSizeMiB: AUDIT_MAX_FILE_SIZE_MIB,
    retentionDays: AUDIT_RETENTION_DAYS,
    maxArchiveFiles: AUDIT_MAX_ARCHIVE_FILES,
    bufferCapacityBytes: AUDIT_BUFFER_CAPACITY_BYTES,
  };
}

function serializeAuditRecord(record: AuditEventRecord): string {
  if (record.agentId === undefined) {
    throw new TypeError('audit record requires agentId');
  }
  return `${JSON.stringify({
    schemaVersion: 1,
    record: {
      auditId: record.auditId,
      eventName: record.eventName,
      tenantId: record.tenantId,
      subjectId: record.subjectId,
      agentId: record.agentId,
      ...(record.requestRunId === undefined ? {} : { requestRunId: record.requestRunId }),
      ...(record.capabilityInvocationId === undefined ? {} : { capabilityInvocationId: record.capabilityInvocationId }),
      safeSummary: record.safeSummary,
      attributes: record.attributes,
      occurredAt: record.occurredAt,
    },
  })}\n`;
}

function assertAccepted(result: LocalFileAppendResult): void {
  if (result.status !== 'accepted') {
    throw new Error(`audit append ${result.reason}`);
  }
}
