import { createLocalFileRollForTesting, runLocalFileRollMaintenanceForTesting } from './local-file-roll.js';
import type { LocalFileRollHandle, LocalFileRollPolicy } from './index.js';

export interface LocalFileRollTestHarness {
  readonly handle: LocalFileRollHandle;
  runMaintenance: (includeRetention?: boolean, signal?: AbortSignal) => Promise<void>;
}

export interface LocalFileRollTestHarnessOptions {
  readonly removeOwnedFile?: (file: string) => Promise<'completed' | 'failed' | 'skipped'>;
}

export async function createLocalFileRollTestHarness(
  policy: LocalFileRollPolicy,
  options: LocalFileRollTestHarnessOptions = {},
): Promise<LocalFileRollTestHarness> {
  const handle = await createLocalFileRollForTesting(
    policy,
    false,
    options.removeOwnedFile === undefined ? undefined : { removeOwnedFile: options.removeOwnedFile },
  );
  return {
    handle,
    runMaintenance: (includeRetention = true, signal?: AbortSignal) => runLocalFileRollMaintenanceForTesting(handle, includeRetention, signal),
  };
}
