import { cloneElement, isValidElement, type ReactElement, type ReactNode } from 'react';
import { Tooltip } from 'antd';
import { useTranslation } from 'react-i18next';
import { useUserOps } from './useUserOps.ts';
import { AICOServiceOperation } from './authEnums.ts';

export interface AuthGateProps {
  readonly requiredOps: AICOServiceOperation[];
  readonly tooltipKey?: string;
  readonly children: ReactNode;
}

/**
 * Wraps visible UI entries and disables them (with a Tooltip) when the user
 * lacks the required operations. In local mode or when the user has all
 * required ops, children are rendered without modification.
 *
 * The disabled state uses a two-layer wrapper: an outer span that receives
 * mouse events for the Tooltip, and an inner span with pointerEvents none
 * and reduced opacity to prevent interaction and dim the visual.
 */
export function AuthGate({ requiredOps, tooltipKey = 'auth.noWritePermission', children }: AuthGateProps): ReactNode {
  const ops = useUserOps();
  const { t } = useTranslation();

  if (ops === null) {
    return children;
  }

  const hasAllOps = requiredOps.every((op) => ops.includes(op));
  if (hasAllOps) {
    return children;
  }

  // Antd Button: inject disabled via cloneElement so native disabled styling applies.
  if (isValidElement(children) && isAntdButton(children)) {
    return <Tooltip title={t(tooltipKey)}>{cloneElement(children as ReactElement<{ disabled?: boolean }>, { disabled: true })}</Tooltip>;
  }

  // Non-Button elements: wrap with pointerEvents none + visual dim.
  return (
    <Tooltip title={t(tooltipKey)}>
      <span style={{ display: 'inline-flex', cursor: 'not-allowed', gap: 8 }}>
        <span
          style={{
            pointerEvents: 'none',
            opacity: 0.45,
            display: 'inline-flex',
            gap: 8,
          }}
        >
          {children}
        </span>
      </span>
    </Tooltip>
  );
}

function isAntdButton(element: ReactElement): boolean {
  const type = element.type;
  return typeof type === 'object' && type !== null && '$$typeof' in type && (type as { displayName?: string }).displayName === 'Button';
}
