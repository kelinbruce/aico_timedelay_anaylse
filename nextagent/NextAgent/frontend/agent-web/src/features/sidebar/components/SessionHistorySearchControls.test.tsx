import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import dayjs from 'dayjs';

const captured = vi.hoisted(() => ({ current: {} as Record<string, any> }));

vi.mock('antd', async (importOriginal) => {
  const actual = await importOriginal<typeof import('antd')>();
  return {
    ...actual,
    Popover: ({ content, children }: { content: React.ReactNode; children: React.ReactNode }) => (
      <>
        {children}
        {content}
      </>
    ),
    DatePicker: {
      ...actual.DatePicker,
      RangePicker: (props: Record<string, any>) => {
        captured.current = props;
        return null;
      },
    },
  };
});

vi.mock('@ant-design/icons', () => ({
  CalendarOutlined: () => null,
  CloseCircleFilled: () => null,
  SearchOutlined: () => null,
  WarningOutlined: () => null,
}));

vi.mock('../../../state/sessionStore.ts', () => ({
  SESSION_HISTORY_PAGE_LIMIT: 50,
  hasSessionHistorySearchQuery: () => false,
  useSessionStore: (selector: (state: any) => any) =>
    selector({
      historySearchQuery: {},
      loadSessions: vi.fn(async () => undefined),
    }),
}));

import { SessionHistorySearchControls } from './SessionHistorySearchControls.tsx';

describe('SessionHistorySearchControls date picker panel mode', () => {
  beforeEach(() => {
    captured.current = {};
  });

  afterEach(() => {
    cleanup();
  });

  it('applies the 90-day range constraint in date panel mode after a start date is picked', () => {
    render(<SessionHistorySearchControls />);
    expect(captured.current.disabledDate).toBeDefined();

    act(() => {
      captured.current.onCalendarChange([dayjs('2026-06-01'), null]);
    });

    const farDate = dayjs('2026-09-10');
    expect(captured.current.disabledDate(farDate)).toBe(true);
  });

  it('does not apply the 90-day range constraint in year panel mode', () => {
    render(<SessionHistorySearchControls />);

    act(() => {
      captured.current.onPanelChange(null, ['year', 'year']);
    });

    const pastDate = dayjs('2020-01-01');
    expect(captured.current.disabledDate(pastDate)).toBe(false);
  });

  it('does not capture start date from year panel selections', () => {
    render(<SessionHistorySearchControls />);

    act(() => {
      captured.current.onPanelChange(null, ['year', 'year']);
    });
    act(() => {
      captured.current.onCalendarChange([dayjs('2026-01-01'), null]);
    });
    act(() => {
      captured.current.onPanelChange(null, ['date', 'date']);
    });

    const anyPastDate = dayjs('2020-01-01');
    expect(captured.current.disabledDate(anyPastDate)).toBe(false);
  });
});
