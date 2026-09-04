import type { ModelMessage } from '@nextagent/agent-contracts/model';
import type { SystemReminder } from '@nextagent/agent-contracts/system-reminder';
import { describe, expect, it } from 'vitest';
import { injectSystemReminders, isSystemReminderMessage } from '../../src/system-reminder/inject.js';
import { SYSTEM_REMINDER_OPEN_TAG } from '@nextagent/agent-contracts/system-reminder';

const user = (text: string): ModelMessage => ({ role: 'USER', content: [{ type: 'text', text }] });
const assistant = (text: string): ModelMessage => ({ role: 'ASSISTANT', content: [{ type: 'text', text }] });

describe('injectSystemReminders', () => {
  it('is a no-op when reminders is undefined', () => {
    const messages: ModelMessage[] = [user('hi'), assistant('hello')];
    const result = injectSystemReminders(messages, undefined);
    expect(result).toEqual(messages);
  });

  it('is a no-op when reminders is empty', () => {
    const messages: ModelMessage[] = [user('hi'), assistant('hello')];
    const result = injectSystemReminders(messages, []);
    expect(result).toEqual(messages);
  });

  it('injects a single USER message before the last USER message', () => {
    const messages: ModelMessage[] = [user('first'), assistant('reply'), user('second')];
    const reminders: SystemReminder[] = [{ type: 'relevant_memories', role: 'INJECT', content: 'fact' }];
    const result = injectSystemReminders(messages, reminders);
    expect(result).toHaveLength(4);
    // Injected message sits at index 2, right before the last USER ('second') at index 3.
    expect(result[2]?.role).toBe('USER');
    expect(result[3]).toEqual(user('second'));
  });

  it('wraps each reminder content in the system-reminder tag', () => {
    const reminders: SystemReminder[] = [
      { type: 'relevant_memories', role: 'INJECT', content: 'fact A' },
      { type: 'relevant_memories', role: 'INJECT', content: 'fact B' },
    ];
    const result = injectSystemReminders([user('q')], reminders);
    const injected = result[0];
    expect(injected?.role).toBe('USER');
    const texts = injected?.content.map((part) => (part.type === 'text' ? part.text : ''));
    expect(texts?.[0]?.startsWith(SYSTEM_REMINDER_OPEN_TAG)).toBe(true);
    expect(texts?.[0]).toContain('fact A');
    expect(texts?.[1]?.startsWith(SYSTEM_REMINDER_OPEN_TAG)).toBe(true);
    expect(texts?.[1]).toContain('fact B');
  });

  it('prepends when there is no USER message', () => {
    const messages: ModelMessage[] = [assistant('only')];
    const reminders: SystemReminder[] = [{ type: 'relevant_memories', role: 'INJECT', content: 'fact' }];
    const result = injectSystemReminders(messages, reminders);
    expect(result[0]?.role).toBe('USER');
    expect(result[1]).toEqual(assistant('only'));
  });

  it('does not modify the input array', () => {
    const original: ModelMessage[] = [user('q')];
    const reminders: SystemReminder[] = [{ type: 'relevant_memories', role: 'INJECT', content: 'fact' }];
    injectSystemReminders(original, reminders);
    expect(original).toEqual([user('q')]);
  });
});

describe('isSystemReminderMessage', () => {
  it('recognizes a USER message whose text blocks are all SR', () => {
    const msg: ModelMessage = {
      role: 'USER',
      content: [{ type: 'text', text: `${SYSTEM_REMINDER_OPEN_TAG}\nx\n</system-reminder>` }],
    };
    expect(isSystemReminderMessage(msg)).toBe(true);
  });

  it('rejects a USER message with mixed SR and real text', () => {
    const msg: ModelMessage = {
      role: 'USER',
      content: [
        { type: 'text', text: `${SYSTEM_REMINDER_OPEN_TAG}\nx\n</system-reminder>` },
        { type: 'text', text: 'real user question' },
      ],
    };
    expect(isSystemReminderMessage(msg)).toBe(false);
  });

  it('rejects ASSISTANT messages', () => {
    const msg: ModelMessage = { role: 'ASSISTANT', content: [{ type: 'text', text: 'reply' }] };
    expect(isSystemReminderMessage(msg)).toBe(false);
  });
});
