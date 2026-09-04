import { ExclamationCircleFilled, LoadingOutlined } from '@ant-design/icons';
import { Tag, Tooltip } from 'antd';
import type { CSSProperties, ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { PublishedSessionActivityEntry } from '../../state/sessionActivityStore.ts';

export const SESSION_ACTIVITY_TRAILING_SLOT_WIDTH = 140;
export type SessionActivityTrailingLayout = 'RESERVED' | 'INTRINSIC';

export interface SessionActivityTrailingSlotProps {
  readonly sessionId: string;
  readonly activity: PublishedSessionActivityEntry | undefined;
  readonly isActivitySuppressed: boolean;
  readonly supportsActions: boolean;
  readonly isActionVisible: boolean;
  readonly layout?: SessionActivityTrailingLayout;
  readonly fallback?: ReactNode;
  readonly action?: ReactNode;
}

const markerStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'flex-end',
  pointerEvents: 'none',
};

function ActivityIcon({ label, testId, children }: { readonly label: string; readonly testId: string; readonly children: ReactNode }) {
  return (
    <Tooltip title={label}>
      <span role="status" aria-label={label} data-testid={testId} style={markerStyle}>
        {children}
      </span>
    </Tooltip>
  );
}

export function SessionActivityTrailingSlot({
  sessionId,
  activity,
  isActivitySuppressed,
  supportsActions,
  isActionVisible,
  layout = 'RESERVED',
  fallback,
  action,
}: SessionActivityTrailingSlotProps) {
  const { t } = useTranslation();
  let content = fallback;

  if (supportsActions && isActionVisible) {
    content = action;
  } else if (!isActivitySuppressed && activity) {
    switch (activity.status) {
      case 'WAITING_FOR_INPUT': {
        const label = t(`sessionActivity.waiting.${activity.pendingInputKind}`);
        content = (
          <Tooltip title={label}>
            <Tag
              color="gold"
              role="status"
              aria-label={label}
              data-testid="session-activity-waiting"
              style={{
                maxWidth: '100%',
                marginInlineEnd: 0,
                overflow: 'hidden',
                paddingInline: 6,
                fontSize: 11,
                lineHeight: '20px',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                pointerEvents: 'none',
              }}
            >
              {label}
            </Tag>
          </Tooltip>
        );
        break;
      }
      case 'RUNNING': {
        const label = t('sessionActivity.running');
        content = (
          <ActivityIcon label={label} testId="session-activity-running">
            <LoadingOutlined spin aria-hidden="true" />
          </ActivityIcon>
        );
        break;
      }
      case 'UNREAD_FAILURE': {
        const label = t('sessionActivity.unreadFailure');
        content = (
          <ActivityIcon label={label} testId="session-activity-unread-failure">
            <ExclamationCircleFilled aria-hidden="true" style={{ color: 'var(--color-error, #cf1322)', fontSize: 13 }} />
          </ActivityIcon>
        );
        break;
      }
      case 'UNREAD_RESULT': {
        const label = t('sessionActivity.unreadResult');
        content = (
          <ActivityIcon label={label} testId="session-activity-unread-result">
            <span
              aria-hidden="true"
              style={{
                width: 8,
                height: 8,
                borderRadius: '50%',
                background: 'var(--color-primary, #1677ff)',
              }}
            />
          </ActivityIcon>
        );
        break;
      }
    }
  }

  return (
    <span
      data-testid={`session-activity-trailing-slot-${sessionId}`}
      style={{
        width: layout === 'INTRINSIC' ? 'auto' : SESSION_ACTIVITY_TRAILING_SLOT_WIDTH,
        minWidth: layout === 'INTRINSIC' ? 0 : SESSION_ACTIVITY_TRAILING_SLOT_WIDTH,
        maxWidth: layout === 'INTRINSIC' ? SESSION_ACTIVITY_TRAILING_SLOT_WIDTH : undefined,
        flexShrink: 0,
        display: 'inline-flex',
        justifyContent: 'flex-end',
        alignItems: 'center',
      }}
    >
      {content}
    </span>
  );
}
