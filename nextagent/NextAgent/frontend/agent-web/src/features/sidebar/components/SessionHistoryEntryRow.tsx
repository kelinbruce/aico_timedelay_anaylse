import { MoreOutlined } from '@ant-design/icons';
import { Dropdown, Tooltip, Typography, type MenuProps } from 'antd';
import { useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import type { SessionHistoryEntry, WireTimestamp } from '../../../state/contracts.ts';
import { useSessionActivityStore } from '../../../state/sessionActivityStore.ts';
import { toTimestampMillis } from '../../../utils/time.ts';
import { SessionActivityTrailingSlot, type SessionActivityTrailingLayout } from '../../session-activity/SessionActivityTrailingSlot.tsx';

function formatSessionListTime(value: WireTimestamp, locale: string, yesterdayLabel: string): string {
  const timestamp = toTimestampMillis(value);
  if (Number.isNaN(timestamp)) {
    return '';
  }
  const date = new Date(timestamp);
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startOfYesterday = startOfToday - 86_400_000;
  const time = date.getTime();
  if (time >= startOfToday) {
    return new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit', hour12: false }).format(date);
  }
  if (time >= startOfYesterday) {
    return yesterdayLabel;
  }
  if (date.getFullYear() === now.getFullYear()) {
    return new Intl.DateTimeFormat(locale, { month: 'numeric', day: 'numeric' }).format(date);
  }
  return new Intl.DateTimeFormat(locale, { year: 'numeric', month: 'numeric', day: 'numeric' }).format(date);
}

function activateOnKeyboard(event: ReactKeyboardEvent<HTMLElement>, action: () => void): void {
  if (event.target !== event.currentTarget || (event.key !== 'Enter' && event.key !== ' ')) {
    return;
  }
  event.preventDefault();
  action();
}

export interface SessionHistoryEntryRowProps {
  readonly entry: SessionHistoryEntry;
  readonly active: boolean;
  readonly isConversationSurfaceVisible: boolean;
  readonly locale: string;
  readonly yesterdayLabel: string;
  readonly hasWritePermission: boolean;
  readonly moreActionsLabel: string;
  readonly renameLabel: string;
  readonly deleteLabel: string;
  readonly onOpen: (sessionId: string) => void;
  readonly onRename: (entry: SessionHistoryEntry) => void;
  readonly onDelete: (entry: SessionHistoryEntry) => void;
  readonly dataTestId: string;
  readonly elementId?: string | undefined;
  readonly showActionsOnHover?: boolean | undefined;
  readonly trailingLayout?: SessionActivityTrailingLayout | undefined;
}

export function SessionHistoryEntryRow({
  entry,
  active,
  isConversationSurfaceVisible,
  locale,
  yesterdayLabel,
  hasWritePermission,
  moreActionsLabel,
  renameLabel,
  deleteLabel,
  onOpen,
  onRename,
  onDelete,
  dataTestId,
  elementId,
  showActionsOnHover = true,
  trailingLayout = 'RESERVED',
}: SessionHistoryEntryRowProps) {
  const [hovered, setHovered] = useState(false);
  const [focusedWithin, setFocusedWithin] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const activity = useSessionActivityStore((state) => state.entriesBySessionId[entry.sessionId]);
  const menuItems: MenuProps['items'] = [
    {
      key: 'rename',
      label: renameLabel,
      disabled: !hasWritePermission,
    },
    {
      key: 'delete',
      label: deleteLabel,
      danger: true,
      disabled: !hasWritePermission,
    },
  ];
  const isActionVisible = showActionsOnHover && (hovered || focusedWithin || menuOpen);
  const isActive = active;
  const isHovered = !active && (hovered || focusedWithin || menuOpen);
  const isTrailingIntrinsic = trailingLayout === 'INTRINSIC';
  const moreAction = (
    <Dropdown
      trigger={['click']}
      open={menuOpen}
      onOpenChange={setMenuOpen}
      menu={{
        items: menuItems,
        onClick: ({ domEvent, key }) => {
          domEvent.stopPropagation();
          if (key === 'rename') {
            onRename(entry);
          }
          if (key === 'delete') {
            onDelete(entry);
          }
        },
      }}
    >
      <Tooltip title={moreActionsLabel}>
        <button
          type="button"
          aria-label={`${moreActionsLabel}: ${entry.displayTitle}`}
          onClick={(event) => event.stopPropagation()}
          onKeyDown={(event) => event.stopPropagation()}
          style={{
            width: 26,
            height: 26,
            border: 0,
            borderRadius: 0,
            background: 'transparent',
            color: 'var(--color-text-tertiary)',
            cursor: 'pointer',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 0,
          }}
        >
          <MoreOutlined />
        </button>
      </Tooltip>
    </Dropdown>
  );
  const fallbackTime = (
    <Typography.Text
      type="secondary"
      style={{
        fontSize: 12,
        whiteSpace: 'nowrap',
        fontVariantNumeric: 'tabular-nums',
      }}
    >
      {formatSessionListTime(entry.lastActivityAt, locale, yesterdayLabel)}
    </Typography.Text>
  );
  const trailingSlot = (
    <SessionActivityTrailingSlot
      sessionId={entry.sessionId}
      activity={activity}
      isActivitySuppressed={active && isConversationSurfaceVisible}
      supportsActions={showActionsOnHover}
      isActionVisible={isActionVisible}
      layout={trailingLayout}
      fallback={fallbackTime}
      action={moreAction}
    />
  );
  return (
    <div
      id={elementId}
      role="button"
      tabIndex={0}
      data-testid={dataTestId}
      aria-current={active ? 'page' : undefined}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setFocusedWithin(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) {
          setFocusedWithin(false);
        }
      }}
      onClick={() => onOpen(entry.sessionId)}
      onKeyDown={(event) => activateOnKeyboard(event, () => onOpen(entry.sessionId))}
      style={{
        height: 36,
        borderRadius: 0,
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        flexShrink: 0,
        padding: '0 14px',
        cursor: 'pointer',
        background: isActive ? 'var(--color-nav-button-highlight)' : isHovered ? 'var(--color-nav-button-hover)' : 'transparent',
        outline: 'none',
      }}
    >
      <Typography.Text
        data-testid={`session-history-entry-title-${entry.sessionId}`}
        ellipsis={isTrailingIntrinsic ? false : { tooltip: { title: entry.displayTitle, placement: 'right' } }}
        style={{
          flex: 1,
          display: isTrailingIntrinsic ? 'block' : undefined,
          minWidth: 0,
          overflow: isTrailingIntrinsic ? 'hidden' : undefined,
          textOverflow: isTrailingIntrinsic ? 'clip' : undefined,
          whiteSpace: isTrailingIntrinsic ? 'nowrap' : undefined,
          fontSize: 14,
          color: active ? 'var(--color-primary)' : undefined,
          fontWeight: active ? 600 : 400,
        }}
      >
        {entry.displayTitle}
      </Typography.Text>
      {trailingSlot}
    </div>
  );
}
