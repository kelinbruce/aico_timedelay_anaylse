import { CalendarOutlined, CloseCircleFilled, SearchOutlined, WarningOutlined } from '@ant-design/icons';
import { Button, DatePicker, Input, Popover, Tooltip, Typography, message as messageApi } from 'antd';
import dayjs, { type Dayjs } from 'dayjs';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  SESSION_HISTORY_PAGE_LIMIT,
  hasSessionHistorySearchQuery,
  type SessionHistorySearchQuery,
  useSessionStore,
} from '../../../state/sessionStore.ts';
import {
  DATE_TIME_PICKER_FORMAT,
  SEARCH_DEBOUNCE_MS,
  TIME_PICKER_FORMAT,
  areQueriesEqual,
  keywordState,
  loadOptionsForQuery,
  normalizeQuery,
  resolveDateRange,
  isFutureDate,
  isBeforeEpoch,
  isOutsideRangeFromStart,
  withKeyword,
  withoutDateRange,
} from './sessionHistorySearch.ts';
import './SessionHistorySearchControls.css';

function formatDateTime(value: number, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(new Date(value));
}

export interface SessionHistorySearchControlsProps {
  readonly compact?: boolean;
  readonly query?: SessionHistorySearchQuery | undefined;
  readonly onQueryChange?: (query: SessionHistorySearchQuery, options: { readonly limit?: number | undefined }) => void;
}

export function SessionHistorySearchControls({ compact = false, query, onQueryChange }: SessionHistorySearchControlsProps) {
  const { i18n, t } = useTranslation();
  const storeQuery = useSessionStore((state) => state.historySearchQuery);
  const loadSessions = useSessionStore((state) => state.loadSessions);
  const committedQuery = query ?? storeQuery;
  const [keyword, setKeyword] = useState(committedQuery.q ?? '');
  const [isComposing, setIsComposing] = useState(false);
  const [dateOpen, setDateOpen] = useState(false);
  const [datePickerOpen, setDatePickerOpen] = useState(false);
  const [pickedStartDate, setPickedStartDate] = useState<Dayjs | null>(null);
  const [isDatePanel, setIsDatePanel] = useState(true);
  const debounceRef = useRef<number | null>(null);
  const normalizedCommittedQuery = useMemo(
    () => normalizeQuery(committedQuery),
    [committedQuery.createdFrom, committedQuery.createdTo, committedQuery.q],
  );
  const isSearchActive = hasSessionHistorySearchQuery(normalizedCommittedQuery);
  const currentKeywordState = keywordState(keyword);
  const hasDateRange = committedQuery.createdFrom !== undefined && committedQuery.createdTo !== undefined;
  const dateValue = useMemo(() => {
    if (!hasDateRange) {
      return null;
    }
    return [dayjs(committedQuery.createdFrom), dayjs(committedQuery.createdTo)] as [Dayjs, Dayjs];
  }, [committedQuery.createdFrom, committedQuery.createdTo, hasDateRange]);
  const defaultOpenDateTimeValue = useMemo(() => [dayjs().startOf('day'), dayjs().endOf('day').millisecond(0)] as [Dayjs, Dayjs], []);
  const dateSummary = useMemo(() => {
    if (!hasDateRange) {
      return null;
    }
    const from = formatDateTime(committedQuery.createdFrom!, i18n.language);
    const to = formatDateTime(committedQuery.createdTo!, i18n.language);
    return { from, to, full: `${from} - ${to}` };
  }, [committedQuery.createdFrom, committedQuery.createdTo, hasDateRange, i18n.language]);

  useEffect(() => {
    setKeyword(committedQuery.q ?? '');
  }, [committedQuery.q]);

  useEffect(() => {
    if (isComposing || currentKeywordState.invalid) {
      return undefined;
    }
    if (debounceRef.current !== null) {
      window.clearTimeout(debounceRef.current);
    }
    debounceRef.current = window.setTimeout(() => {
      const nextQuery = withKeyword(committedQuery, currentKeywordState.trimmed);
      if (areQueriesEqual(nextQuery, normalizedCommittedQuery)) {
        return;
      }
      const options = loadOptionsForQuery(nextQuery);
      if (onQueryChange) {
        onQueryChange(options.query, { limit: options.limit });
      } else {
        void loadSessions(options);
      }
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      if (debounceRef.current !== null) {
        window.clearTimeout(debounceRef.current);
      }
    };
  }, [committedQuery, currentKeywordState.invalid, currentKeywordState.trimmed, isComposing, loadSessions, normalizedCommittedQuery, onQueryChange]);

  const clearKeyword = () => {
    setKeyword('');
    const nextQuery = withKeyword(committedQuery, undefined);
    const options = loadOptionsForQuery(nextQuery);
    if (onQueryChange) {
      onQueryChange(options.query, { limit: options.limit });
    } else {
      void loadSessions(options);
    }
  };

  const clearDateRange = () => {
    const nextQuery = withoutDateRange(committedQuery);
    const options = loadOptionsForQuery(nextQuery);
    if (onQueryChange) {
      onQueryChange(options.query, { limit: options.limit });
    } else {
      void loadSessions(options);
    }
  };

  const applyDateRange = (value: null | [Dayjs | null, Dayjs | null]) => {
    const resolved = resolveDateRange(value);
    if (resolved.kind === 'clear') {
      clearDateRange();
      return;
    }
    if (resolved.kind === 'reject') {
      void messageApi.warning({ key: 'session-history-date-range-limit', content: t('sessionHistory.dateRangeExceedsLimit') });
      return;
    }
    const nextQuery = normalizeQuery({ ...committedQuery, createdFrom: resolved.createdFrom, createdTo: resolved.createdTo });
    setDatePickerOpen(false);
    setDateOpen(false);
    setPickedStartDate(null);
    setIsDatePanel(true);
    if (onQueryChange) {
      onQueryChange(nextQuery, { limit: SESSION_HISTORY_PAGE_LIMIT });
    } else {
      void loadSessions({ limit: SESSION_HISTORY_PAGE_LIMIT, query: nextQuery });
    }
  };

  const suffix = currentKeywordState.invalid ? (
    <Tooltip title={t('sessionHistory.keywordTooLongHint')}>
      <WarningOutlined aria-label={t('sessionHistory.keywordTooLongHint')} style={{ color: 'var(--color-status-warning-text)' }} />
    </Tooltip>
  ) : keyword.trim() ? (
    <Tooltip title={t('sessionHistory.clearKeyword')}>
      <button
        type="button"
        aria-label={t('sessionHistory.clearKeyword')}
        onClick={clearKeyword}
        style={{ border: 0, background: 'transparent', padding: 0, color: 'var(--color-text-tertiary)', cursor: 'pointer' }}
      >
        <CloseCircleFilled />
      </button>
    </Tooltip>
  ) : (
    <SearchOutlined aria-hidden="true" style={{ color: 'var(--color-text-tertiary)' }} />
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: compact ? '0 0 8px' : '2px 8px 8px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <Input
          size="small"
          classNames={{ input: 'session-history-search-controls-input' }}
          value={keyword}
          placeholder={t('sessionHistory.searchPlaceholder')}
          aria-label={t('sessionHistory.searchHistory')}
          suffix={suffix}
          onChange={(event) => setKeyword(event.target.value)}
          onCompositionStart={() => setIsComposing(true)}
          onCompositionEnd={(event) => {
            setIsComposing(false);
            setKeyword(event.currentTarget.value);
          }}
        />
        <Popover
            trigger="click"
            open={dateOpen}
            destroyOnHidden
            onOpenChange={(open) => {
              setDateOpen(open);
              if (!open) {
                setDatePickerOpen(false);
                setPickedStartDate(null);
                setIsDatePanel(true);
              }
            }}
            content={
              <DatePicker.RangePicker
                format={DATE_TIME_PICKER_FORMAT}
                open={datePickerOpen}
                showTime={{ format: TIME_PICKER_FORMAT, defaultOpenValue: defaultOpenDateTimeValue }}
                value={dateValue}
                disabledDate={(current) => {
                  if (isFutureDate(current) || isBeforeEpoch(current)) {
                    return true;
                  }
                  // Only apply the 90-day range constraint in the date panel.
                  // In year/month panels the cell represents a coarse-grained
                  // date (Jan 1 / 1st of month), which the 90-day window would
                  // incorrectly disable.
                  return isDatePanel && isOutsideRangeFromStart(current, pickedStartDate);
                }}
                onCalendarChange={(dates) => {
                  // rc-picker fires onCalendarChange for year/month panel
                  // selections too (via onPanelSelect). Only capture the start
                  // date when the user is in the date panel so that navigating
                  // to a different year/month doesn't corrupt pickedStartDate.
                  if (dates?.[0] && isDatePanel) {
                    setPickedStartDate(dates[0]);
                  } else if (!dates?.[0] && !dates?.[1]) {
                    setPickedStartDate(null);
                  }
                }}
                onPanelChange={(_, modes) => setIsDatePanel(modes[0] === 'date')}
                onOpenChange={(open) => {
                  setDatePickerOpen(open);
                  if (!open) {
                    setIsDatePanel(true);
                  }
                }}
                onChange={(value) => applyDateRange(value as null | [Dayjs | null, Dayjs | null])}
                onOk={(value) => applyDateRange(value as [Dayjs | null, Dayjs | null])}
              />
            }
          >
            <Button
              size="small"
              type="text"
              icon={<CalendarOutlined />}
              aria-label={t('sessionHistory.openDateRange')}
              style={{
                width: 24,
                height: 24,
                padding: 0,
                color: hasDateRange ? 'var(--color-primary)' : 'var(--color-text-tertiary)',
                boxShadow: 'none',
              }}
            />
          </Popover>
      </div>
      {dateSummary ? (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            minWidth: 0,
            color: 'var(--color-text-tertiary)',
            fontSize: 11,
          }}
        >
          <Tooltip title={dateSummary.full}>
            <div style={{ display: 'flex', flex: 1, minWidth: 0, flexDirection: 'column', gap: 2, lineHeight: 1.25 }}>
              <Typography.Text
                data-testid="session-history-created-from"
                ellipsis
                style={{ minWidth: 0, fontSize: 11, color: 'var(--color-text-tertiary)' }}
              >
                {t('sessionHistory.createdFrom')}: {dateSummary.from}
              </Typography.Text>
              <Typography.Text
                data-testid="session-history-created-to"
                ellipsis
                style={{ minWidth: 0, fontSize: 11, color: 'var(--color-text-tertiary)' }}
              >
                {t('sessionHistory.createdTo')}: {dateSummary.to}
              </Typography.Text>
            </div>
          </Tooltip>
          <Tooltip title={t('sessionHistory.clearCreatedTimeRange')} placement="right">
            <button
              type="button"
              aria-label={t('sessionHistory.clearCreatedTimeRange')}
              onClick={clearDateRange}
              style={{
                border: 0,
                background: 'transparent',
                padding: 0,
                color: 'var(--color-text-tertiary)',
                cursor: 'pointer',
                flexShrink: 0,
                lineHeight: 1,
              }}
            >
              <CloseCircleFilled />
            </button>
          </Tooltip>
        </div>
      ) : isSearchActive ? null : null}
    </div>
  );
}
