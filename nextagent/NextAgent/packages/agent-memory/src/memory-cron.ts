import { type EpochMillis } from '@nextagent/agent-common';

const fieldRanges = [
  [0, 59],
  [0, 59],
  [0, 23],
  [1, 31],
  [1, 12],
  [0, 7],
] as const;

export function isSupportedMemoryCronSchedule(schedule: string): boolean {
  const parts = schedule.trim().split(/\s+/u);
  return (
    parts.length === fieldRanges.length && parts[0] === '0' && parts.every((part, index) => matchesSupportedCronField(part, fieldRanges[index]!))
  );
}

export function isMemoryCronDue(schedule: string, now: EpochMillis, lastRunAt?: EpochMillis): boolean {
  if (!isSupportedMemoryCronSchedule(schedule)) {
    return false;
  }
  if (lastRunAt !== undefined && minuteWindow(lastRunAt) === minuteWindow(now)) {
    return false;
  }
  const parts = schedule.trim().split(/\s+/u);
  const date = new Date(Number(now));
  return (
    matchesCronPart(parts[1]!, date.getMinutes(), fieldRanges[1]) &&
    matchesCronPart(parts[2]!, date.getHours(), fieldRanges[2]) &&
    matchesCronPart(parts[3]!, date.getDate(), fieldRanges[3]) &&
    matchesCronPart(parts[4]!, date.getMonth() + 1, fieldRanges[4]) &&
    matchesCronPart(parts[5]!, date.getDay(), fieldRanges[5])
  );
}

function matchesSupportedCronField(value: string, range: readonly [number, number]): boolean {
  if (value === '*' || value === '?') {
    return true;
  }
  if (!/^\d+$/u.test(value)) {
    return false;
  }
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= range[0] && parsed <= range[1];
}

function matchesCronPart(value: string, actual: number, range: readonly [number, number]): boolean {
  if (value === '*' || value === '?') {
    return true;
  }
  const parsed = Number(value);
  return range[1] === 7 && parsed === 7 ? actual === 0 : parsed === actual;
}

function minuteWindow(value: EpochMillis): number {
  return Math.floor(Number(value) / 60_000);
}
