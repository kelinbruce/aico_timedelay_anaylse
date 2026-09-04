export interface CronFields {
  minute: number[];
  hour: number[];
  dayOfMonth: number[];
  month: number[];
  dayOfWeek: number[];
}

interface FieldDefinition {
  first: number;
  last: number;
  sundayAlias?: boolean;
}

const FIELD_DEFINITIONS = [
  { first: 0, last: 59 },
  { first: 0, last: 23 },
  { first: 1, last: 31 },
  { first: 1, last: 12 },
  { first: 0, last: 6, sundayAlias: true },
] as const satisfies readonly FieldDefinition[];

const WEEKDAY_LABELS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const DECIMAL_PATTERN = /^\d+$/;
const SEARCH_TRANSITION_LIMIT = 366 * 24 * 60;

function readDecimal(value: string): number | null {
  return DECIMAL_PATTERN.test(value) ? Number.parseInt(value, 10) : null;
}

function normalizeValue(value: number, definition: FieldDefinition): number {
  return definition.sundayAlias && value === 7 ? 0 : value;
}

function appendSequence(output: Set<number>, first: number, last: number, interval: number, definition: FieldDefinition): boolean {
  const permittedLast = definition.sundayAlias ? 7 : definition.last;
  if (first < definition.first || last > permittedLast || first > last || interval < 1) {
    return false;
  }

  for (let value = first; value <= last; value += interval) {
    output.add(normalizeValue(value, definition));
  }
  return true;
}

function decodeSegment(segment: string, definition: FieldDefinition, output: Set<number>): boolean {
  const pieces = segment.split('/');
  if (pieces.length > 2) {
    return false;
  }

  const [base, intervalText] = pieces;
  const interval = intervalText === undefined ? 1 : readDecimal(intervalText);
  if (!base || interval === null || interval < 1) {
    return false;
  }

  if (base === '*') {
    return appendSequence(output, definition.first, definition.last, interval, definition);
  }

  const bounds = base.split('-');
  if (bounds.length === 2) {
    const first = readDecimal(bounds[0]!);
    const last = readDecimal(bounds[1]!);
    return first !== null && last !== null && appendSequence(output, first, last, interval, definition);
  }

  if (intervalText !== undefined) {
    return false;
  }
  const value = readDecimal(base);
  if (value === null) {
    return false;
  }
  return appendSequence(output, value, value, 1, definition);
}

function decodeField(source: string, definition: FieldDefinition): number[] | null {
  const values = new Set<number>();
  for (const segment of source.split(',')) {
    if (!decodeSegment(segment, definition, values)) {
      return null;
    }
  }
  return values.size === 0 ? null : [...values].sort((left, right) => left - right);
}

export function parseCronExpression(expression: string): CronFields | null {
  const sourceFields = expression.trim().split(/\s+/);
  if (sourceFields.length !== FIELD_DEFINITIONS.length) {
    return null;
  }

  const decoded = sourceFields.map((source, index) => decodeField(source, FIELD_DEFINITIONS[index]!));
  if (decoded.some((field) => field === null)) {
    return null;
  }

  return {
    minute: decoded[0]!,
    hour: decoded[1]!,
    dayOfMonth: decoded[2]!,
    month: decoded[3]!,
    dayOfWeek: decoded[4]!,
  };
}

function dayMatches(schedule: CronFields, cursor: Date): boolean {
  const allMonthDays = schedule.dayOfMonth.length === 31;
  const allWeekDays = schedule.dayOfWeek.length === 7;
  const monthDayMatches = schedule.dayOfMonth.includes(cursor.getDate());
  const weekDayMatches = schedule.dayOfWeek.includes(cursor.getDay());

  if (allMonthDays) {
    return allWeekDays || weekDayMatches;
  }
  if (allWeekDays) {
    return monthDayMatches;
  }
  return monthDayMatches || weekDayMatches;
}

function findNextOccurrence(schedule: CronFields, origin: Date): Date | null {
  const originEpochMs = origin.getTime();
  const cursor = new Date(origin.getTime());
  cursor.setSeconds(0, 0);
  cursor.setMinutes(cursor.getMinutes() + 1);

  for (let transitions = 0; transitions < SEARCH_TRANSITION_LIMIT; transitions += 1) {
    if (!schedule.month.includes(cursor.getMonth() + 1)) {
      cursor.setMonth(cursor.getMonth() + 1, 1);
      cursor.setHours(0, 0, 0, 0);
    } else if (!dayMatches(schedule, cursor)) {
      cursor.setDate(cursor.getDate() + 1);
      cursor.setHours(0, 0, 0, 0);
    } else if (!schedule.hour.includes(cursor.getHours())) {
      cursor.setHours(cursor.getHours() + 1, 0, 0, 0);
    } else if (!schedule.minute.includes(cursor.getMinutes())) {
      cursor.setMinutes(cursor.getMinutes() + 1);
    } else if (cursor.getTime() <= originEpochMs) {
      cursor.setMinutes(cursor.getMinutes() + 1);
    } else {
      return cursor;
    }
  }
  return null;
}

export function computeNextCronRun(schedule: CronFields, origin: Date): Date | null {
  return findNextOccurrence(schedule, origin);
}

export function nextCronRunMs(expression: string, originEpochMs: number): number | null {
  const schedule = parseCronExpression(expression);
  if (schedule === null) {
    return null;
  }
  return computeNextCronRun(schedule, new Date(originEpochMs))?.getTime() ?? null;
}

function renderLocalTime(minuteValue: number, hourValue: number): string {
  return new Date(2000, 0, 1, hourValue, minuteValue).toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
  });
}

function readInterval(value: string): number | null {
  if (!value.startsWith('*/')) {
    return null;
  }
  return readDecimal(value.slice(2));
}

export function cronToHuman(expression: string): string {
  const sourceFields = expression.trim().split(/\s+/);
  if (sourceFields.length !== 5) {
    return expression;
  }

  const [minuteSource, hourSource, monthDaySource, monthSource, weekDaySource] = sourceFields as [string, string, string, string, string];
  const unrestrictedDate = monthDaySource === '*' && monthSource === '*' && weekDaySource === '*';
  const minuteInterval = readInterval(minuteSource);

  if (minuteInterval !== null && hourSource === '*' && unrestrictedDate) {
    return minuteInterval === 1 ? 'Every minute' : `Every ${minuteInterval} minutes`;
  }

  const fixedMinute = readDecimal(minuteSource);
  if (fixedMinute !== null && hourSource === '*' && unrestrictedDate) {
    return fixedMinute === 0 ? 'Every hour' : `Every hour at :${fixedMinute.toString().padStart(2, '0')}`;
  }

  const hourInterval = readInterval(hourSource);
  if (fixedMinute !== null && hourInterval !== null && unrestrictedDate) {
    const suffix = fixedMinute === 0 ? '' : ` at :${fixedMinute.toString().padStart(2, '0')}`;
    return hourInterval === 1 ? `Every hour${suffix}` : `Every ${hourInterval} hours${suffix}`;
  }

  const fixedHour = readDecimal(hourSource);
  if (fixedMinute === null || fixedHour === null) {
    return expression;
  }
  const time = renderLocalTime(fixedMinute, fixedHour);

  if (unrestrictedDate) {
    return `Every day at ${time}`;
  }
  if (monthDaySource === '*' && monthSource === '*' && /^\d$/.test(weekDaySource)) {
    const dayName = WEEKDAY_LABELS[Number.parseInt(weekDaySource, 10) % 7];
    if (dayName) {
      return `Every ${dayName} at ${time}`;
    }
  }
  if (monthDaySource === '*' && monthSource === '*' && weekDaySource === '1-5') {
    return `Weekdays at ${time}`;
  }
  return expression;
}
