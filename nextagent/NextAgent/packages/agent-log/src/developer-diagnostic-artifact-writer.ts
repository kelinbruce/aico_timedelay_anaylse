import {
  createLocalFileRoll,
  createLocalFileRollMaintenance,
  type LocalFileAppendResult,
  type LocalFileRollHandle,
  type LocalFileRollMaintenanceHandle,
  type LocalFileRollPolicy,
} from '@nextagent/agent-local-file-roll';
const FILE_NAME = 'nextagent-plugin-diagnostic.ndjson';
const MAX_FILE_SIZE_MIB = 30;
const RETENTION_DAYS = 3;
const MAX_ARCHIVE_FILES = 10;
const BUFFER_CAPACITY_BYTES = 8 * 1024 * 1024;
const MAX_RECORD_BYTES = 4 * 1024 * 1024;
const MAX_DROPPED_COUNT = 2_147_483_647;
const SAFE_IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const MAX_COORDINATE_LENGTH = 512;

export type DeveloperDiagnosticArtifactFailureCode = 'INVALID_RECORD' | 'RECORD_TOO_LARGE' | 'QUEUE_OVERLOADED' | 'OUTPUT_UNAVAILABLE';

export interface BoundDeveloperDiagnosticArtifactInput {
  readonly pluginId: string;
  readonly artifactType: string;
  readonly sessionId?: string;
  readonly requestId?: string;
  readonly runId?: string;
  readonly agentId?: string;
  readonly agentVersion?: string;
  readonly agentAssemblyRef?: string;
  readonly hookInvocationId?: string;
  readonly payload: unknown;
}

export type DeveloperDiagnosticArtifactWriteResult =
  { readonly status: 'ACCEPTED' } | { readonly status: 'DROPPED'; readonly reasonCode: DeveloperDiagnosticArtifactFailureCode };

export interface DeveloperDiagnosticArtifactStatus {
  readonly availability: 'AVAILABLE' | 'DEGRADED';
  readonly droppedCount: number;
  readonly lastFailureCode?: DeveloperDiagnosticArtifactFailureCode;
}

export interface DeveloperDiagnosticArtifactWriterOptions {
  readonly logDirectory: string;
  readonly now?: () => Date;
}

interface DeveloperDiagnosticArtifactWriterDependencies {
  readonly createHandle: (policy: LocalFileRollPolicy) => Promise<LocalFileRollHandle>;
  readonly createMaintenance: (policy: LocalFileRollPolicy) => Promise<LocalFileRollMaintenanceHandle>;
}

export class DeveloperDiagnosticArtifactWriter {
  private readonly now: () => Date;
  private readonly logDirectory: string;
  private readonly createHandle: DeveloperDiagnosticArtifactWriterDependencies['createHandle'];
  private readonly createMaintenance: DeveloperDiagnosticArtifactWriterDependencies['createMaintenance'];
  private maintenanceHandlePromise?: Promise<LocalFileRollMaintenanceHandle | undefined>;
  private handlePromise?: Promise<LocalFileRollHandle | undefined>;
  private availability: DeveloperDiagnosticArtifactStatus['availability'];
  private droppedCount = 0;
  private lastFailureCode?: DeveloperDiagnosticArtifactFailureCode;
  private isClosed = false;
  private closePromise?: Promise<void>;

  constructor(
    options: DeveloperDiagnosticArtifactWriterOptions,
    dependencies: DeveloperDiagnosticArtifactWriterDependencies = {
      createHandle: createLocalFileRoll,
      createMaintenance: createLocalFileRollMaintenance,
    },
  ) {
    this.now = options.now ?? (() => new Date());
    this.createHandle = dependencies.createHandle;
    this.createMaintenance = dependencies.createMaintenance;
    this.availability = 'AVAILABLE';
    this.logDirectory = options.logDirectory;
  }

  start(): Promise<void> {
    if (this.isClosed || this.handlePromise !== undefined) {
      return Promise.resolve();
    }
    this.maintenanceHandlePromise ??= Promise.resolve()
      .then(() => this.createMaintenance(developerDiagnosticArtifactFilePolicy(this.logDirectory)))
      .then((handle) => {
        handle.setMaintenanceEventListener((event) => {
          if (event.outcome === 'failed') {
            this.recordFailure('OUTPUT_UNAVAILABLE', false);
          }
        });
        return handle;
      })
      .catch(() => {
        this.recordFailure('OUTPUT_UNAVAILABLE', false);
        return undefined;
      });
    return this.maintenanceHandlePromise.then(() => undefined);
  }

  async emit(input: BoundDeveloperDiagnosticArtifactInput): Promise<DeveloperDiagnosticArtifactWriteResult> {
    if (this.isClosed) {
      return this.drop('OUTPUT_UNAVAILABLE');
    }
    const serialized = serializeRecord(input, this.now);
    if (serialized.status === 'DROPPED') {
      return this.drop(serialized.reasonCode);
    }

    const handle = await this.ensureHandle();
    if (handle === undefined || this.isClosed) {
      return this.drop('OUTPUT_UNAVAILABLE');
    }

    let appendResult: LocalFileAppendResult;
    try {
      appendResult = handle.appendLine(serialized.line);
    } catch {
      return this.drop('OUTPUT_UNAVAILABLE');
    }
    if (appendResult.status === 'dropped') {
      return this.drop(mapAppendFailure(appendResult));
    }

    this.availability = 'AVAILABLE';
    return { status: 'ACCEPTED' };
  }

  status(): DeveloperDiagnosticArtifactStatus {
    return {
      availability: this.availability,
      droppedCount: this.droppedCount,
      ...(this.lastFailureCode === undefined ? {} : { lastFailureCode: this.lastFailureCode }),
    };
  }

  async flush(timeoutMs: number): Promise<void> {
    const handlePromise = this.handlePromise;
    if (handlePromise === undefined) {
      return;
    }
    const handle = await handlePromise;
    await handle?.flush(timeoutMs);
  }

  close(timeoutMs = 5_000): Promise<void> {
    this.isClosed = true;
    this.closePromise ??= this.closeHandle(timeoutMs);
    return this.closePromise;
  }

  private ensureHandle(): Promise<LocalFileRollHandle | undefined> {
    this.handlePromise ??= Promise.resolve()
      .then(async () => {
        await this.stopMaintenanceHandle();
        return this.isClosed ? undefined : this.createHandle(developerDiagnosticArtifactFilePolicy(this.logDirectory));
      })
      .then((handle) => {
        handle?.setMaintenanceEventListener((event) => {
          if (event.outcome === 'failed') {
            this.recordFailure('OUTPUT_UNAVAILABLE', false);
          }
        });
        return handle;
      })
      .catch(() => {
        this.recordFailure('OUTPUT_UNAVAILABLE', false);
        return undefined;
      });
    return this.handlePromise;
  }

  private async closeHandle(timeoutMs: number): Promise<void> {
    const closeResults = await Promise.allSettled([
      this.stopMaintenanceHandle(timeoutMs),
      this.handlePromise?.then((handle) => handle?.close(timeoutMs)) ?? Promise.resolve(),
    ]);
    if (closeResults.some((result) => result.status === 'rejected')) {
      this.recordFailure('OUTPUT_UNAVAILABLE', false);
      return;
    }
    this.recordFailure('OUTPUT_UNAVAILABLE', false);
  }

  private async stopMaintenanceHandle(timeoutMs = 5_000): Promise<void> {
    const maintenanceHandle = await this.maintenanceHandlePromise;
    await maintenanceHandle?.close(timeoutMs);
  }

  private drop(reasonCode: DeveloperDiagnosticArtifactFailureCode): DeveloperDiagnosticArtifactWriteResult {
    this.recordFailure(reasonCode);
    return { status: 'DROPPED', reasonCode };
  }

  private recordFailure(reasonCode: DeveloperDiagnosticArtifactFailureCode, incrementDroppedCount = true): void {
    this.availability = 'DEGRADED';
    if (incrementDroppedCount) {
      this.droppedCount = Math.min(MAX_DROPPED_COUNT, this.droppedCount + 1);
    }
    this.lastFailureCode = reasonCode;
  }
}

export function createDeveloperDiagnosticArtifactWriter(options: DeveloperDiagnosticArtifactWriterOptions): DeveloperDiagnosticArtifactWriter {
  return new DeveloperDiagnosticArtifactWriter(options);
}

export function createDeveloperDiagnosticArtifactWriterForTesting(
  options: DeveloperDiagnosticArtifactWriterOptions,
  createHandle: DeveloperDiagnosticArtifactWriterDependencies['createHandle'],
  createMaintenance: DeveloperDiagnosticArtifactWriterDependencies['createMaintenance'] = createLocalFileRollMaintenance,
): DeveloperDiagnosticArtifactWriter {
  return new DeveloperDiagnosticArtifactWriter(options, { createHandle, createMaintenance });
}

export function developerDiagnosticArtifactFilePolicy(logDirectory: string): LocalFileRollPolicy {
  return {
    directory: logDirectory,
    fileName: FILE_NAME,
    naming: 'date-sequence',
    maxFileSizeMiB: MAX_FILE_SIZE_MIB,
    retentionDays: RETENTION_DAYS,
    maxArchiveFiles: MAX_ARCHIVE_FILES,
    bufferCapacityBytes: BUFFER_CAPACITY_BYTES,
  };
}

function serializeRecord(
  input: BoundDeveloperDiagnosticArtifactInput,
  now: () => Date,
):
  | { readonly status: 'ACCEPTED'; readonly line: string }
  | {
      readonly status: 'DROPPED';
      readonly reasonCode: 'INVALID_RECORD' | 'RECORD_TOO_LARGE';
    } {
  try {
    if (!SAFE_IDENTIFIER.test(input.pluginId) || !SAFE_IDENTIFIER.test(input.artifactType)) {
      return { status: 'DROPPED', reasonCode: 'INVALID_RECORD' };
    }
    for (const coordinate of [
      input.sessionId,
      input.requestId,
      input.runId,
      input.agentId,
      input.agentVersion,
      input.agentAssemblyRef,
      input.hookInvocationId,
    ]) {
      if (coordinate !== undefined && (typeof coordinate !== 'string' || coordinate.length === 0 || coordinate.length > MAX_COORDINATE_LENGTH)) {
        return { status: 'DROPPED', reasonCode: 'INVALID_RECORD' };
      }
    }
    if (!isJsonValue(input.payload)) {
      return { status: 'DROPPED', reasonCode: 'INVALID_RECORD' };
    }
  } catch {
    return { status: 'DROPPED', reasonCode: 'INVALID_RECORD' };
  }

  let line: string;
  try {
    line = `${JSON.stringify({
      schemaVersion: 1,
      recordedAt: now().toISOString(),
      pluginId: input.pluginId,
      artifactType: input.artifactType,
      ...optionalCoordinates(input),
      payload: input.payload,
    })}\n`;
  } catch {
    return { status: 'DROPPED', reasonCode: 'INVALID_RECORD' };
  }
  return Buffer.byteLength(line, 'utf8') > MAX_RECORD_BYTES ? { status: 'DROPPED', reasonCode: 'RECORD_TOO_LARGE' } : { status: 'ACCEPTED', line };
}

function optionalCoordinates(input: BoundDeveloperDiagnosticArtifactInput): Record<string, string> {
  return Object.fromEntries(
    Object.entries({
      sessionId: input.sessionId,
      requestId: input.requestId,
      runId: input.runId,
      agentId: input.agentId,
      agentVersion: input.agentVersion,
      agentAssemblyRef: input.agentAssemblyRef,
      hookInvocationId: input.hookInvocationId,
    }).filter((entry): entry is [string, string] => entry[1] !== undefined),
  );
}

function isJsonValue(value: unknown, seen = new WeakSet<object>()): boolean {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return true;
  }
  if (typeof value === 'number') {
    return Number.isFinite(value);
  }
  if (typeof value !== 'object') {
    return false;
  }
  if (seen.has(value)) {
    return false;
  }
  seen.add(value);
  const valid = Array.isArray(value)
    ? value.every((item) => isJsonValue(item, seen))
    : Object.getPrototypeOf(value) === Object.prototype && Object.values(value).every((item) => isJsonValue(item, seen));
  seen.delete(value);
  return valid;
}

function mapAppendFailure(result: Extract<LocalFileAppendResult, { status: 'dropped' }>): DeveloperDiagnosticArtifactFailureCode {
  return result.reason === 'buffer_full' ? 'QUEUE_OVERLOADED' : 'OUTPUT_UNAVAILABLE';
}
