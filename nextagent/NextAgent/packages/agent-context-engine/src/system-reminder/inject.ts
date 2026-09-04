import type { SystemReminder } from '@nextagent/agent-contracts/system-reminder';
import type { ModelMessage, ModelMessageContentPart, ModelTextContentPart } from '@nextagent/agent-contracts/model';
import { wrapInSystemReminder } from './wrap.js';

/**
 * Spec anchor: add-ts-system-reminder-memory-v1 / specs/system-reminder/spec.md
 * Requirement: "系统提醒管道零影响回归".
 *
 * Injects `ContextAssemblyRequest.systemReminders` into the rendered `messages`
 * as a single USER message carrying one `<system-reminder>` text block per
 * reminder. The injected message is placed immediately BEFORE the last USER
 * message, so the real user input stays last and the model never mistakes
 * system context for the user's turn.
 *
 * When `reminders` is undefined or empty, this is a no-op: the input array is
 * returned unchanged (same reference).
 *
 * Producers that run AFTER render (e.g. the BEFORE_MODEL_INVOKE memory-recall
 * trusted terminal hook) cannot go through this field — they call
 * `wrapInSystemReminder` directly on the message content they mutate. Both
 * paths share the same wrapping primitive, so the tag shape is identical.
 */
export function injectSystemReminders(messages: readonly ModelMessage[], reminders?: readonly SystemReminder[]): ModelMessage[] {
  if (reminders === undefined || reminders.length === 0) {
    return [...messages];
  }
  const textBlocks: ModelTextContentPart[] = reminders.map((reminder) => ({
    type: 'text',
    text: wrapInSystemReminder(reminder.content),
  }));
  const reminderMessage: ModelMessage = { role: 'USER', content: textBlocks };

  const lastUserIndex = findLastUserIndex(messages);
  if (lastUserIndex === -1) {
    // No USER message to anchor before: prepend so the reminder leads.
    return [reminderMessage, ...messages];
  }
  return [...messages.slice(0, lastUserIndex), reminderMessage, ...messages.slice(lastUserIndex)];
}

/**
 * Whether a rendered message is the system-reminder injection produced by
 * `injectSystemReminders`: a USER message whose every text block is an SR.
 * Used by smoosh to identify candidate siblings without parsing free-form
 * user input.
 */
export function isSystemReminderMessage(message: ModelMessage): boolean {
  if (message.role !== 'USER' || message.content.length === 0) {
    return false;
  }
  const textBlocks = message.content.filter((part): part is ModelTextContentPart => part.type === 'text');
  if (textBlocks.length === 0) {
    return false;
  }
  return textBlocks.every((block) => block.text.trimStart().startsWith('<system-reminder>'));
}

function findLastUserIndex(messages: readonly ModelMessage[]): number {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === 'USER') {
      return index;
    }
  }
  return -1;
}

// Re-export the content-part type for pipeline consumers.
export type { ModelMessageContentPart };
