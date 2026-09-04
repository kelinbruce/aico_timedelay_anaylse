import { useContext } from 'react';
import { AppHostContext } from '../../app/AppProviders.tsx';

/**
 * Returns the current user's operation permissions.
 *
 * - `null`  → local mode or standalone host, no restriction (full access).
 * - `[]`    → remote mode with no ops, safe degradation (no permission).
 * - `[...]` → remote mode with ops, check against required operations.
 *
 * When `AppHostContext` is unavailable (e.g. outside `AppProviders`),
 * returns `null` as a safe fallback to local semantics.
 */
export function useUserOps(): readonly string[] | null {
  const host = useContext(AppHostContext);
  if (!host) {
    return null;
  }
  const isRemoteMode = host.mode === 'immersive' || host.mode === 'piu';
  if (!isRemoteMode) {
    return null;
  }
  const ops = host.site?.user?.ops;
  // Explicit null means a standalone host grants full access (local semantics).
  if (ops === null) {
    return null;
  }
  return ops ?? [];
}
