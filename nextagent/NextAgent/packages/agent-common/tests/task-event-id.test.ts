import { TASK_EVENT_ID_MAX_LENGTH, TASK_EVENT_ID_PATTERN, isTaskEventId } from '../src/index.js';
import { describe, expect, it } from 'vitest';

describe('TaskEventId', () => {
  it('accepts the complete allowed character set and length boundaries', () => {
    expect(isTaskEventId('A')).toBe(true);
    expect(isTaskEventId('Az09_- .:')).toBe(true);
    expect(isTaskEventId('a'.repeat(TASK_EVENT_ID_MAX_LENGTH))).toBe(true);
    expect(TASK_EVENT_ID_PATTERN).toBe('^[A-Za-z0-9_.: -]{1,32}$');
  });

  it('rejects missing, empty, overlong and unsupported values', () => {
    expect(isTaskEventId(undefined)).toBe(false);
    expect(isTaskEventId('')).toBe(false);
    expect(isTaskEventId('a'.repeat(TASK_EVENT_ID_MAX_LENGTH + 1))).toBe(false);
    expect(isTaskEventId('事件')).toBe(false);
    expect(isTaskEventId('line\nbreak')).toBe(false);
  });
});
