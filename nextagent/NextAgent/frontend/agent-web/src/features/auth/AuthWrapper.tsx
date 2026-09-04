import { type ReactNode } from 'react';
import { useUserOps } from './useUserOps.ts';
import { AICOServiceOperation } from './authEnums.ts';

export interface AuthWrapperProps {
  readonly requiredOps: AICOServiceOperation[];
  readonly fallback?: ReactNode;
  readonly children: ReactNode;
}

/**
 * Conditionally renders children based on required ops. Used for hidden
 * elements (e.g. file input) that should not be rendered when the user
 * lacks permission. In local mode, children are always rendered.
 */
export function AuthWrapper({ requiredOps, fallback, children }: AuthWrapperProps): ReactNode {
  const ops = useUserOps();

  if (ops === null) {
    return children;
  }

  const hasAllOps = requiredOps.every((op) => ops.includes(op));
  return hasAllOps ? children : (fallback ?? null);
}
