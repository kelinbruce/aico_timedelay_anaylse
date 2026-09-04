import { describe, expect, it } from 'vitest';
import { SYSTEM_REMINDER_OPEN_TAG, SYSTEM_REMINDER_CLOSE_TAG } from '@nextagent/agent-contracts/system-reminder';
import { wrapInSystemReminder, isSystemReminderText } from '../../src/system-reminder/wrap.js';

describe('wrapInSystemReminder', () => {
  it('wraps free-form content in the tag', () => {
    const wrapped = wrapInSystemReminder('background fact');
    expect(wrapped).toBe(`${SYSTEM_REMINDER_OPEN_TAG}\nbackground fact\n${SYSTEM_REMINDER_CLOSE_TAG}`);
  });

  it('is idempotent: already-wrapped content is returned unchanged', () => {
    const once = wrapInSystemReminder('content');
    const twice = wrapInSystemReminder(once);
    expect(twice).toBe(once);
  });

  it('is idempotent even with leading whitespace before the open tag', () => {
    const once = `   ${SYSTEM_REMINDER_OPEN_TAG}\nx\n${SYSTEM_REMINDER_CLOSE_TAG}`;
    expect(wrapInSystemReminder(once)).toBe(once);
  });

  it('never produces nested tags', () => {
    const wrapped = wrapInSystemReminder(wrapInSystemReminder('x'));
    const opens = wrapped.split(SYSTEM_REMINDER_OPEN_TAG).length - 1;
    expect(opens).toBe(1);
  });
});

describe('isSystemReminderText', () => {
  it('identifies wrapped text', () => {
    expect(isSystemReminderText(`${SYSTEM_REMINDER_OPEN_TAG}\nx\n${SYSTEM_REMINDER_CLOSE_TAG}`)).toBe(true);
  });

  it('identifies wrapped text with leading whitespace', () => {
    expect(isSystemReminderText(`  \n${SYSTEM_REMINDER_OPEN_TAG}\nx`)).toBe(true);
  });

  it('rejects plain user text', () => {
    expect(isSystemReminderText('what is the alarm?')).toBe(false);
  });

  it('rejects text that only mentions the close tag', () => {
    expect(isSystemReminderText('see </system-reminder> above')).toBe(false);
  });
});
