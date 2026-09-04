export type LocalFileNaming = 'sequence' | 'date-sequence';

export interface LocalFileRollPolicy {
  readonly directory: string;
  readonly fileName: string;
  readonly naming: LocalFileNaming;
  readonly maxFileSizeMiB: number;
  readonly retentionDays: number;
  readonly maxArchiveFiles?: number;
  readonly bufferCapacityBytes: number;
}

export type LocalFileAppendResult =
  { readonly status: 'accepted' } | { readonly status: 'dropped'; readonly reason: 'closed' | 'buffer_full' | 'invalid_line' };

export interface LocalFileActiveIdentity {
  readonly file: string;
}

export interface LocalFileMaintenanceEvent {
  readonly operation: 'archive' | 'retention';
  readonly outcome: 'completed' | 'failed';
  readonly affectedCount: number;
}

export interface LocalFileRollMaintenanceHandle {
  setMaintenanceEventListener: (listener: (event: LocalFileMaintenanceEvent) => void) => void;
  close: (timeoutMs: number) => Promise<void>;
}

export interface LocalFileRollHandle {
  appendLine: (line: string) => LocalFileAppendResult;
  activeIdentity: () => LocalFileActiveIdentity | undefined;
  setMaintenanceEventListener: (listener: (event: LocalFileMaintenanceEvent) => void) => void;
  flush: (timeoutMs: number) => Promise<void>;
  close: (timeoutMs: number) => Promise<void>;
}

export { createLocalFileRoll, createLocalFileRollMaintenance } from './local-file-roll.js';
