import type { OperationalLogSurface, RuntimeLogger, RuntimeLoggerBindings, RuntimeLoggerProvider, RuntimeLogLevel } from '@nextagent/agent-common';
import type { LocalFileActiveIdentity } from '@nextagent/agent-local-file-roll';
import type { Logger } from 'pino';

export interface OperationalRuntimeLoggingPolicy {
  readonly level: RuntimeLogLevel;
  readonly console: {
    readonly enabled: boolean;
  };
  readonly file: {
    readonly enabled: boolean;
    readonly directory: string;
    readonly name: string;
    readonly maxFileSizeMiB: number;
    readonly retentionDays: number;
    readonly maxArchiveFiles: number;
  };
}

export interface OperationalEmergencyEvidence {
  readonly event:
    | 'logging.transport.init_failed'
    | 'logging.transport.overloaded'
    | 'logging.transport.recovered'
    | 'logging.flush.failed'
    | 'logging.close.failed';
  readonly sink: 'console' | 'file';
  readonly droppedCountBucket?: string;
}

export type OperationalEmergencyReporter = (evidence: OperationalEmergencyEvidence) => void | Promise<void>;

export interface OperationalLogWriter extends RuntimeLoggerProvider {
  getLogger: (bindings: RuntimeLoggerBindings) => ReturnType<RuntimeLoggerProvider['getLogger']>;
  getServerAccessLogger?: (bindings: RuntimeLoggerBindings) => Logger;
  getObservationLogger: (bindings: RuntimeLoggerBindings) => RuntimeLogger;
  activeIdentity: () => LocalFileActiveIdentity | undefined;
  flush: (timeoutMs: number) => Promise<void>;
  close: (timeoutMs: number) => Promise<void>;
}

export interface CreateOperationalLogWriterOptions {
  readonly emergencyReporter?: OperationalEmergencyReporter;
  readonly serviceVersion: string;
}

export type { OperationalLogSurface, RuntimeLogLevel };
export {
  DeveloperDiagnosticArtifactWriter,
  createDeveloperDiagnosticArtifactWriter,
  developerDiagnosticArtifactFilePolicy,
} from './developer-diagnostic-artifact-writer.js';
export type {
  BoundDeveloperDiagnosticArtifactInput,
  DeveloperDiagnosticArtifactFailureCode,
  DeveloperDiagnosticArtifactStatus,
  DeveloperDiagnosticArtifactWriterOptions,
  DeveloperDiagnosticArtifactWriteResult,
} from './developer-diagnostic-artifact-writer.js';
export { createOperationalLogWriter } from './operational-writer.js';
