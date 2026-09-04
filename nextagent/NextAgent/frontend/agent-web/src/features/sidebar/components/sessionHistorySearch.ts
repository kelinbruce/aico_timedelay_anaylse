import { SESSION_HISTORY_PAGE_LIMIT, hasSessionHistorySearchQuery, type SessionHistorySearchQuery } from '../../../state/sessionStore.ts';
import dayjs, { type Dayjs } from 'dayjs';

export const SEARCH_DEBOUNCE_MS = 180;
export const MAX_CREATED_RANGE_MS = 90 * 24 * 60 * 60 * 1000 - 1;
export const MAX_SEARCH_KEYWORD_CODE_POINTS = 200;
export const MAX_CREATED_RANGE_DAYS = 90;
export const DATE_TIME_PICKER_FORMAT = 'YYYY-MM-DD HH:mm:ss';
export const TIME_PICKER_FORMAT = 'HH:mm:ss';

export function keywordState(value: string): { readonly trimmed?: string; readonly invalid: boolean } {
  const trimmed = value.trim();
  if (!trimmed) {
    return { invalid: false };
  }
  return {
    trimmed,
    invalid: Array.from(trimmed).length > MAX_SEARCH_KEYWORD_CODE_POINTS,
  };
}

export function normalizeQuery(query: SessionHistorySearchQuery): SessionHistorySearchQuery {
  return {
    ...(query.q?.trim() ? { q: query.q.trim() } : {}),
    ...(query.createdFrom === undefined || query.createdTo === undefined ? {} : { createdFrom: query.createdFrom, createdTo: query.createdTo }),
  };
}

export function areQueriesEqual(left: SessionHistorySearchQuery, right: SessionHistorySearchQuery): boolean {
  return left.q === right.q && left.createdFrom === right.createdFrom && left.createdTo === right.createdTo;
}

export function withKeyword(query: SessionHistorySearchQuery, keyword?: string): SessionHistorySearchQuery {
  const { q: _q, ...rest } = query;
  return normalizeQuery({ ...rest, ...(keyword === undefined ? {} : { q: keyword }) });
}

export function withoutDateRange(query: SessionHistorySearchQuery): SessionHistorySearchQuery {
  const { createdFrom: _createdFrom, createdTo: _createdTo, ...rest } = query;
  return normalizeQuery(rest);
}

export function loadOptionsForQuery(query: SessionHistorySearchQuery): {
  readonly limit?: number;
  readonly query: SessionHistorySearchQuery;
} {
  return {
    query,
    ...(hasSessionHistorySearchQuery(query) ? { limit: SESSION_HISTORY_PAGE_LIMIT } : {}),
  };
}

/**
 * Normalizes a range picker value into a committed search range.
 *
 * Guarantees:
 * - the returned start never exceeds the end (out-of-order picks are swapped);
 * - neither bound is later than `now` (future end times are clamped to now);
 * - the span never exceeds MAX_CREATED_RANGE_MS.
 *
 * Returns `clear` when the value is empty, `reject` when the range cannot be
 * honored (start in the future after clamping, or span too large), otherwise
 * `apply` with the normalized epoch-ms bounds.
 */
export type ResolvedDateRange =
  { readonly kind: 'clear' } | { readonly kind: 'reject' } | { readonly kind: 'apply'; readonly createdFrom: number; readonly createdTo: number };

export function resolveDateRange(value: ReadonlyArray<Dayjs | null> | null, now: number = Date.now()): ResolvedDateRange {
  if (!value?.[0] || !value[1]) {
    return { kind: 'clear' };
  }
  let createdFrom = toSecondPrecision(value[0]);
  let createdTo = toSecondPrecision(value[1]);
  if (createdFrom > createdTo) {
    [createdFrom, createdTo] = [createdTo, createdFrom];
  }
  if (createdFrom < 0 || createdTo < 0) {
    return { kind: 'reject' };
  }
  const nowSecond = Math.floor(now / 1000) * 1000;
  if (createdTo > nowSecond) {
    createdTo = nowSecond;
  }
  if (createdFrom > createdTo) {
    return { kind: 'reject' };
  }
  if (createdTo - createdFrom > MAX_CREATED_RANGE_MS) {
    return { kind: 'reject' };
  }
  return { kind: 'apply', createdFrom, createdTo };
}

export function toSecondPrecision(value: Dayjs): number {
  return value.millisecond(0).valueOf();
}

export function isFutureDate(current: Dayjs, now: number = Date.now()): boolean {
  return current.endOf('day').valueOf() > dayjs(now).endOf('day').valueOf();
}

export function isBeforeEpoch(current: Dayjs): boolean {
  return current.endOf('day').valueOf() < 0;
}

export function isOutsideRangeFromStart(current: Dayjs, startDate: Dayjs | null): boolean {
  if (!startDate) {
    return false;
  }
  return (
    current.valueOf() < startDate.subtract(MAX_CREATED_RANGE_DAYS, 'day').startOf('day').valueOf() ||
    current.valueOf() > startDate.add(MAX_CREATED_RANGE_DAYS, 'day').endOf('day').valueOf()
  );
}

export type { Dayjs };
export { dayjs };
