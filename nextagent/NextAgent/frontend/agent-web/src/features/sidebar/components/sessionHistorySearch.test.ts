import { describe, expect, it } from 'vitest';
import dayjs from 'dayjs';
import { MAX_CREATED_RANGE_MS, isFutureDate, keywordState, resolveDateRange, toSecondPrecision } from './sessionHistorySearch.ts';

const NOW = dayjs('2026-07-20 12:30:45').valueOf();

describe('resolveDateRange', () => {
  it('clears when the value is null or incomplete', () => {
    expect(resolveDateRange(null, NOW)).toEqual({ kind: 'clear' });
    expect(resolveDateRange([null, null], NOW)).toEqual({ kind: 'clear' });
    expect(resolveDateRange([dayjs('2026-07-01 00:00:00'), null], NOW)).toEqual({ kind: 'clear' });
    expect(resolveDateRange([null, dayjs('2026-07-01 00:00:00')], NOW)).toEqual({ kind: 'clear' });
  });

  it('applies a normal range with second precision', () => {
    const from = dayjs('2026-07-01 08:00:30.999');
    const to = dayjs('2026-07-10 18:00:15.123');
    const result = resolveDateRange([from, to], NOW);
    expect(result).toEqual({
      kind: 'apply',
      createdFrom: toSecondPrecision(from),
      createdTo: toSecondPrecision(to),
    });
    expect(result.kind === 'apply' && result.createdFrom < result.createdTo).toBe(true);
  });

  it('swaps out-of-order picks so start never exceeds end', () => {
    const early = dayjs('2026-07-01 08:00:00');
    const late = dayjs('2026-07-10 18:00:00');
    const swapped = resolveDateRange([late, early], NOW);
    const ordered = resolveDateRange([early, late], NOW);
    expect(swapped).toEqual(ordered);
    expect(swapped.kind === 'apply' && swapped.createdFrom < swapped.createdTo).toBe(true);
  });

  it('clamps a future end time down to now', () => {
    const from = dayjs('2026-07-01 08:00:00');
    const futureEnd = dayjs('2026-07-21 00:00:00');
    const result = resolveDateRange([from, futureEnd], NOW);
    expect(result.kind).toBe('apply');
    if (result.kind === 'apply') {
      expect(result.createdTo).toBe(Math.floor(NOW / 1000) * 1000);
      expect(result.createdTo).toBeLessThanOrEqual(NOW);
    }
  });

  it('rejects when the start is in the future even after clamping', () => {
    const futureStart = dayjs('2026-07-21 00:00:00');
    const futureEnd = dayjs('2026-07-22 00:00:00');
    expect(resolveDateRange([futureStart, futureEnd], NOW)).toEqual({ kind: 'reject' });
  });

  it('rejects a range larger than the 90 day cap', () => {
    const from = dayjs('2026-04-01 00:00:00');
    const to = dayjs('2026-07-10 00:00:00');
    expect(toSecondPrecision(to) - toSecondPrecision(from)).toBeGreaterThan(MAX_CREATED_RANGE_MS);
    expect(resolveDateRange([from, to], NOW)).toEqual({ kind: 'reject' });
  });

  it('accepts a range exactly at the 90 day boundary plus a second', () => {
    const now = dayjs('2026-07-20 12:00:00');
    const from = now.subtract(90, 'day').add(1, 'second');
    const result = resolveDateRange([from, now], now.valueOf());
    expect(result.kind).toBe('apply');
  });

  it('rejects negative epoch timestamps (before 1970-01-01)', () => {
    const beforeEpoch = dayjs('1969-12-31 23:59:59');
    const normal = dayjs('2026-07-01 08:00:00');
    expect(resolveDateRange([beforeEpoch, normal], NOW)).toEqual({ kind: 'reject' });
    expect(resolveDateRange([normal, beforeEpoch], NOW)).toEqual({ kind: 'reject' });
  });

  it('accepts epoch zero (1970-01-01 00:00:00) as the lower bound', () => {
    const epochZero = dayjs(0);
    const normal = dayjs('2026-07-01 08:00:00');
    const result = resolveDateRange([epochZero, normal], NOW);
    expect(result.kind).toBe('reject');
  });
});

describe('isFutureDate', () => {
  it('flags dates after today as future', () => {
    expect(isFutureDate(dayjs('2026-07-21 00:00:00'), NOW)).toBe(true);
  });

  it('keeps today selectable', () => {
    expect(isFutureDate(dayjs('2026-07-20 23:59:59'), NOW)).toBe(false);
  });

  it('keeps past dates selectable', () => {
    expect(isFutureDate(dayjs('2026-07-19 23:59:59'), NOW)).toBe(false);
  });
});

describe('keywordState', () => {
  it('accepts a keyword with exactly 200 Unicode code points', () => {
    expect(keywordState('a'.repeat(200))).toEqual({ trimmed: 'a'.repeat(200), invalid: false });
  });

  it('rejects a keyword with 201 Unicode code points', () => {
    expect(keywordState('a'.repeat(201))).toEqual({ trimmed: 'a'.repeat(201), invalid: true });
  });
});
