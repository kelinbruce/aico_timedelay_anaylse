export interface CompositionFailureScope {
  register: (stage: string, cleanup: () => void | Promise<void>) => void;
  commit: () => void;
  rollbackSync: () => void;
  rollbackAsync: () => Promise<void>;
}

interface CleanupHandle {
  readonly stage: string;
  readonly cleanup: () => void | Promise<void>;
}

export function createCompositionFailureScope(): CompositionFailureScope {
  const handles: CleanupHandle[] = [];
  let state: 'OPEN' | 'COMMITTED' | 'ROLLED_BACK' = 'OPEN';

  const takeForRollback = (): readonly CleanupHandle[] => {
    if (state !== 'OPEN') {
      return [];
    }
    state = 'ROLLED_BACK';
    return [...handles].reverse();
  };

  return {
    register(stage, cleanup) {
      if (state !== 'OPEN') {
        throw new Error('Composition cleanup can only be registered while the failure scope is open.');
      }
      handles.push({ stage, cleanup });
    },
    commit() {
      if (state !== 'OPEN') {
        throw new Error('Composition failure scope can only be committed once while open.');
      }
      state = 'COMMITTED';
      handles.length = 0;
    },
    rollbackSync() {
      for (const handle of takeForRollback()) {
        try {
          const result = handle.cleanup();
          if (isThenable(result)) {
            void Promise.resolve(result).catch(() => undefined);
          }
        } catch {
          // Cleanup is best effort and must not replace the original composition failure.
        }
      }
    },
    async rollbackAsync() {
      for (const handle of takeForRollback()) {
        try {
          await handle.cleanup();
        } catch {
          // Cleanup is best effort and must not replace the original composition failure.
        }
      }
    },
  };
}

function isThenable(value: void | Promise<void>): value is Promise<void> {
  return value !== undefined && typeof value === 'object' && typeof value.then === 'function';
}
