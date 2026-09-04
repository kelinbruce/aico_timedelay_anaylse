// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SessionActivityTrailingSlot, SESSION_ACTIVITY_TRAILING_SLOT_WIDTH } from '../src/features/session-activity/SessionActivityTrailingSlot.tsx';
import { SessionHistoryEntryRow } from '../src/features/sidebar/components/SessionHistoryEntryRow.tsx';
import i18n from '../src/i18n/index.ts';
import { useSessionActivityStore, type PublishedSessionActivityEntry } from '../src/state/sessionActivityStore.ts';
import { renderWithAppProviders as render } from './renderWithAppProviders.tsx';

const entry = {
  sessionId: 'session-activity-row',
  displayTitle: 'Activity session',
  lastActivityAt: '2026-04-29T02:20:00.000Z',
} as const;

function renderSlot(
  activity: PublishedSessionActivityEntry | undefined,
  options: {
    readonly isActivitySuppressed?: boolean;
    readonly supportsActions?: boolean;
    readonly isActionVisible?: boolean;
  } = {},
) {
  return render(
    <SessionActivityTrailingSlot
      sessionId={entry.sessionId}
      activity={activity}
      isActivitySuppressed={options.isActivitySuppressed ?? false}
      supportsActions={options.supportsActions ?? false}
      isActionVisible={options.isActionVisible ?? false}
      fallback={<span>12:34</span>}
      action={<button type="button">More action</button>}
    />,
  );
}

function renderRow(
  options: {
    readonly active?: boolean;
    readonly isConversationSurfaceVisible?: boolean;
    readonly showActionsOnHover?: boolean;
    readonly trailingLayout?: 'RESERVED' | 'INTRINSIC';
    readonly onOpen?: (sessionId: string) => void;
  } = {},
) {
  return render(
    <SessionHistoryEntryRow
      entry={entry}
      active={options.active ?? false}
      isConversationSurfaceVisible={options.isConversationSurfaceVisible ?? true}
      locale="zh-CN"
      yesterdayLabel="昨天"
      hasWritePermission
      moreActionsLabel="更多会话操作"
      renameLabel="重命名"
      deleteLabel="删除"
      showActionsOnHover={options.showActionsOnHover}
      trailingLayout={options.trailingLayout}
      onOpen={options.onOpen ?? vi.fn()}
      onRename={vi.fn()}
      onDelete={vi.fn()}
      dataTestId="activity-session-row"
    />,
  );
}

describe('SessionActivityTrailingSlot', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('zh-CN');
    useSessionActivityStore.setState({
      entriesBySessionId: {},
      connectionGeneration: 0,
    });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it.each([
    ['QUESTION', '等待回答'],
    ['CONFIRMATION', '等待确认'],
    ['AUTHORIZATION', '等待授权'],
    ['HUMAN_HANDOFF', '等待人工处理'],
  ] as const)('renders %s as the matching localized waiting tag', (pendingInputKind, label) => {
    renderSlot({
      sessionId: entry.sessionId,
      status: 'WAITING_FOR_INPUT',
      pendingInputKind,
    });

    expect(screen.getByText(label)).toBeTruthy();
    expect(screen.queryByText('12:34')).toBeNull();
    expect(screen.getByTestId('session-activity-waiting').getAttribute('aria-label')).toBe(label);
  });

  it('renders running, unread failure, unread result, and NONE with one semantic at a time', () => {
    const { rerender } = renderSlot({
      sessionId: entry.sessionId,
      status: 'RUNNING',
    });
    expect(screen.getByTestId('session-activity-running').getAttribute('aria-label')).toBe('会话正在运行');
    expect(screen.queryByText('12:34')).toBeNull();

    rerender(
      <SessionActivityTrailingSlot
        sessionId={entry.sessionId}
        activity={{ sessionId: entry.sessionId, status: 'UNREAD_FAILURE', activityId: 'failure-1' }}
        isActivitySuppressed={false}
        supportsActions={false}
        isActionVisible={false}
        fallback={<span>12:34</span>}
      />,
    );
    expect(screen.getByTestId('session-activity-unread-failure').getAttribute('aria-label')).toBe('有未查看的失败结果');
    expect(screen.queryByTestId('session-activity-running')).toBeNull();

    rerender(
      <SessionActivityTrailingSlot
        sessionId={entry.sessionId}
        activity={{ sessionId: entry.sessionId, status: 'UNREAD_RESULT', activityId: 'result-1' }}
        isActivitySuppressed={false}
        supportsActions={false}
        isActionVisible={false}
        fallback={<span>12:34</span>}
      />,
    );
    expect(screen.getByTestId('session-activity-unread-result').getAttribute('aria-label')).toBe('有未查看的结果');
    expect(screen.queryByTestId('session-activity-unread-failure')).toBeNull();

    rerender(
      <SessionActivityTrailingSlot
        sessionId={entry.sessionId}
        activity={undefined}
        isActivitySuppressed={false}
        supportsActions={false}
        isActionVisible={false}
        fallback={<span>12:34</span>}
      />,
    );
    expect(screen.getByText('12:34')).toBeTruthy();
    expect(screen.queryByTestId('session-activity-unread-result')).toBeNull();
  });

  it('locally suppresses an active visible marker but restores it when the surface is hidden', () => {
    const activity: PublishedSessionActivityEntry = {
      sessionId: entry.sessionId,
      status: 'UNREAD_RESULT',
      activityId: 'result-1',
    };
    const { rerender } = renderSlot(activity, { isActivitySuppressed: true });

    expect(screen.getByText('12:34')).toBeTruthy();
    expect(screen.queryByTestId('session-activity-unread-result')).toBeNull();

    rerender(
      <SessionActivityTrailingSlot
        sessionId={entry.sessionId}
        activity={activity}
        isActivitySuppressed={false}
        supportsActions={false}
        isActionVisible={false}
        fallback={<span>12:34</span>}
      />,
    );
    expect(screen.getByTestId('session-activity-unread-result')).toBeTruthy();
    expect(screen.queryByText('12:34')).toBeNull();
  });

  it('keeps a fixed trailing width while switching between activity and actions', () => {
    const activity: PublishedSessionActivityEntry = {
      sessionId: entry.sessionId,
      status: 'RUNNING',
    };
    const { rerender } = renderSlot(activity);
    const slot = screen.getByTestId(`session-activity-trailing-slot-${entry.sessionId}`);

    expect(slot.style.width).toBe(`${SESSION_ACTIVITY_TRAILING_SLOT_WIDTH}px`);
    expect(screen.getByTestId('session-activity-running')).toBeTruthy();

    rerender(
      <SessionActivityTrailingSlot
        sessionId={entry.sessionId}
        activity={activity}
        isActivitySuppressed={false}
        supportsActions
        isActionVisible
        fallback={<span>12:34</span>}
        action={<button type="button">More action</button>}
      />,
    );
    expect(slot.style.width).toBe(`${SESSION_ACTIVITY_TRAILING_SLOT_WIDTH}px`);
    expect(screen.getByRole('button', { name: 'More action' })).toBeTruthy();
    expect(screen.queryByTestId('session-activity-running')).toBeNull();
  });
});

describe('SessionHistoryEntryRow activity interaction', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('zh-CN');
    useSessionActivityStore.setState({
      entriesBySessionId: {
        [entry.sessionId]: {
          sessionId: entry.sessionId,
          status: 'RUNNING',
        },
      },
      connectionGeneration: 1,
    });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('switches the same slot to More on hover, focus-within, and while the menu is open', async () => {
    renderRow();
    const row = screen.getByTestId('activity-session-row');

    expect(screen.getByTestId('session-activity-running')).toBeTruthy();
    fireEvent.mouseEnter(row);
    const more = screen.getByRole('button', { name: '更多会话操作: Activity session' });
    expect(screen.queryByTestId('session-activity-running')).toBeNull();

    fireEvent.click(more);
    await screen.findByText('重命名');
    fireEvent.mouseLeave(row);
    expect(screen.getByRole('button', { name: '更多会话操作: Activity session' })).toBeTruthy();

    fireEvent.click(screen.getByText('重命名'));
    await waitFor(() => {
      expect(screen.queryByText('重命名')).toBeNull();
    });
    fireEvent.blur(more, { relatedTarget: document.body });
    fireEvent.mouseLeave(row);
    expect(screen.getByTestId('session-activity-running')).toBeTruthy();

    fireEvent.focus(row);
    expect(screen.getByRole('button', { name: '更多会话操作: Activity session' })).toBeTruthy();
  });

  it('does not activate the row when More receives Enter or Space', () => {
    const onOpen = vi.fn();
    renderRow({ onOpen });
    const row = screen.getByTestId('activity-session-row');
    fireEvent.focus(row);
    const more = screen.getByRole('button', { name: '更多会话操作: Activity session' });

    fireEvent.keyDown(more, { key: 'Enter' });
    fireEvent.keyDown(more, { key: ' ' });

    expect(onOpen).not.toHaveBeenCalled();
  });

  it('suppresses activity only when the active conversation surface is visible', () => {
    const { rerender } = renderRow({ active: true, isConversationSurfaceVisible: true });

    expect(screen.queryByTestId('session-activity-running')).toBeNull();

    rerender(
      <SessionHistoryEntryRow
        entry={entry}
        active
        isConversationSurfaceVisible={false}
        locale="zh-CN"
        yesterdayLabel="昨天"
        hasWritePermission
        moreActionsLabel="更多会话操作"
        renameLabel="重命名"
        deleteLabel="删除"
        onOpen={vi.fn()}
        onRename={vi.fn()}
        onDelete={vi.fn()}
        dataTestId="activity-session-row"
      />,
    );
    expect(screen.getByTestId('session-activity-running')).toBeTruthy();
  });

  it('keeps activity visible on hover and focus when row actions are unsupported', () => {
    renderRow({ showActionsOnHover: false });
    const row = screen.getByTestId('activity-session-row');

    fireEvent.mouseEnter(row);
    fireEvent.focus(row);

    expect(screen.getByTestId('session-activity-running')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /更多会话操作/ })).toBeNull();
  });

  it('uses intrinsic Sidebar trailing width and hard-clips the remaining title without an ellipsis', () => {
    renderRow({ trailingLayout: 'INTRINSIC' });

    const row = screen.getByTestId('activity-session-row');
    const title = screen.getByTestId(`session-history-entry-title-${entry.sessionId}`);
    const slot = screen.getByTestId(`session-activity-trailing-slot-${entry.sessionId}`);

    expect(screen.queryByTestId(`session-history-entry-trailing-overlay-${entry.sessionId}`)).toBeNull();
    expect(row.style.position).toBe('');
    expect(row.style.gap).toBe('8px');
    expect(title.style.flex).toBe('1 1 0%');
    expect(title.style.overflow).toBe('hidden');
    expect(title.style.whiteSpace).toBe('nowrap');
    expect(title.style.textOverflow).toBe('clip');
    expect(title.className).not.toContain('ant-typography-ellipsis');
    expect(slot.style.width).toBe('auto');
    expect(slot.style.minWidth).toBe('0px');
    expect(slot.style.maxWidth).toBe(`${SESSION_ACTIVITY_TRAILING_SLOT_WIDTH}px`);
  });
});
