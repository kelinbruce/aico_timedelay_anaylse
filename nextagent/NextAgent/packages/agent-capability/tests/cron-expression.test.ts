import { cronToHuman, nextCronRunMs, parseCronExpression } from '@nextagent/agent-capability';
import { describe, expect, it } from 'vitest';

describe('cron expression public contract', () => {
  it('expands supported field forms into sorted unique values', () => {
    expect(parseCronExpression('5,1,5 0-6/3 1,15 1-3 0,7')).toEqual({
      minute: [1, 5],
      hour: [0, 3, 6],
      dayOfMonth: [1, 15],
      month: [1, 2, 3],
      dayOfWeek: [0],
    });
  });

  it.each([
    '',
    '* * * *',
    '* * * * * *',
    '60 * * * *',
    '* 24 * * *',
    '* * 0 * *',
    '* * * 13 *',
    '* * * * 8',
    '5/2 * * * *',
    '10-5 * * * *',
    '*/0 * * * *',
    '0 9 ? * MON',
  ])('rejects unsupported or out-of-range input: %s', (expression) => {
    expect(parseCronExpression(expression)).toBeNull();
  });

  it('uses day-of-month OR day-of-week matching and starts after the supplied minute', () => {
    const fridayBeforeFirstOfMonth = new Date(2026, 4, 29, 8, 59, 20).getTime();
    expect(nextCronRunMs('0 9 1 * 5', fridayBeforeFirstOfMonth)).toBe(new Date(2026, 4, 29, 9, 0, 0).getTime());

    const exactMinute = new Date(2026, 4, 29, 9, 0, 0).getTime();
    expect(nextCronRunMs('0 9 * * *', exactMinute)).toBe(new Date(2026, 4, 30, 9, 0, 0).getTime());
  });

  it('returns null when no valid calendar occurrence exists in the search horizon', () => {
    expect(nextCronRunMs('0 0 31 2 *', new Date(2026, 0, 1).getTime())).toBeNull();
  });

  it('preserves accelerated search across multiple years', () => {
    const from = new Date(2025, 2, 1, 0, 0, 0, 0);
    expect(nextCronRunMs('0 0 29 2 *', from.getTime())).toBe(new Date(2028, 1, 29, 0, 0, 0, 0).getTime());
  });

  it('does not return a past occurrence from the second daylight-saving overlap hour', () => {
    const previousTimezone = process.env.TZ;
    process.env.TZ = 'America/New_York';
    try {
      const origin = Date.parse('2026-11-01T06:15:30.000Z');
      expect(nextCronRunMs('30 1 * * *', origin)).toBe(Date.parse('2026-11-02T06:30:00.000Z'));
    } finally {
      if (previousTimezone === undefined) {
        delete process.env.TZ;
      } else {
        process.env.TZ = previousTimezone;
      }
    }
  });

  it('preserves ordinary ordering and deterministic daylight-saving boundaries', () => {
    const previousTimezone = process.env.TZ;
    try {
      process.env.TZ = 'UTC';
      expect(nextCronRunMs('1 0 * * *', Date.parse('2026-08-10T00:00:30.000Z'))).toBe(Date.parse('2026-08-10T00:01:00.000Z'));

      process.env.TZ = 'America/New_York';
      expect(nextCronRunMs('0 2 * * *', Date.parse('2026-03-08T06:59:00.000Z'))).toBe(Date.parse('2026-03-09T06:00:00.000Z'));

      const firstOverlapOccurrence = nextCronRunMs('30 1 * * *', Date.parse('2026-10-31T05:30:00.000Z'));
      expect(firstOverlapOccurrence).toBe(Date.parse('2026-11-01T05:30:00.000Z'));
      if (firstOverlapOccurrence === null) {
        throw new Error('Expected the first overlap occurrence');
      }
      expect(nextCronRunMs('30 1 * * *', firstOverlapOccurrence)).toBe(Date.parse('2026-11-02T06:30:00.000Z'));
    } finally {
      if (previousTimezone === undefined) {
        delete process.env.TZ;
      } else {
        process.env.TZ = previousTimezone;
      }
    }
  });

  it.each([
    ['*/1 * * * *', 'Every minute'],
    ['*/15 * * * *', 'Every 15 minutes'],
    ['0 * * * *', 'Every hour'],
    ['5 * * * *', 'Every hour at :05'],
    ['0 */1 * * *', 'Every hour'],
    ['30 */2 * * *', 'Every 2 hours at :30'],
    ['0 9 * * *', 'Every day at 9:00 AM'],
    ['0 9 * * 1', 'Every Monday at 9:00 AM'],
    ['0 9 * * 1-5', 'Weekdays at 9:00 AM'],
    ['0 9 1 * *', '0 9 1 * *'],
  ])('renders %s as %s', (expression, expected) => {
    expect(cronToHuman(expression)).toBe(expected);
  });
});
