import { SYSTEM_REMINDER_CLOSE_TAG, SYSTEM_REMINDER_OPEN_TAG } from '@nextagent/agent-contracts/system-reminder';

/**
 * Spec anchor: add-ts-system-reminder-memory-v1 / specs/system-reminder/spec.md
 * Requirement: "系统提醒必须用统一标签包裹并隔离归因".
 *
 * The `<system-reminder>` tag prefix is the single discriminating marker for
 * the whole pipeline. Every system reminder MUST be wrapped in this tag before
 * entering `messages`; every consumer (smoosh, strip, UI filter) identifies
 * system reminders by this prefix.
 */

/**
 * Wrap free-form content in a `<system-reminder>` tag. Idempotent: if the
 * content already starts with the open tag (after optional leading whitespace),
 * it is returned unchanged, so wrapping never produces nested tags.
 */
export function wrapInSystemReminder(content: string): string {
  if (content.trimStart().startsWith(SYSTEM_REMINDER_OPEN_TAG)) {
    return content;
  }
  return `${SYSTEM_REMINDER_OPEN_TAG}\n${content}\n${SYSTEM_REMINDER_CLOSE_TAG}`;
}

/**
 * Whether a text block is a system reminder: it starts with the open tag
 * after optional leading whitespace. Used by smoosh / strip to identify SR
 * text blocks without parsing the close tag.
 */
export function isSystemReminderText(text: string): boolean {
  return text.trimStart().startsWith(SYSTEM_REMINDER_OPEN_TAG);
}
