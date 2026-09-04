import type { SystemReminderRole, SystemReminderType } from '@nextagent/agent-contracts/system-reminder';

/**
 * Spec anchor: add-ts-system-reminder-memory-v1 / specs/system-reminder/spec.md
 * Requirement: "系统提醒类型可扩展".
 *
 * The single extension point: adding a `SystemReminderType` literal requires
 * only adding a row here. The pipeline (wrap / inject / smoosh) is type-generic
 * and MUST NOT change when a type is added.
 */
export const SYSTEM_REMINDER_ROLE_REGISTRY: Readonly<Record<SystemReminderType, SystemReminderRole>> = {
  relevant_memories: 'INJECT',
  nested_memory: 'INJECT',
};

/**
 * Resolve the role for a type. Throws if the type is not registered — this is
 * a fail-closed guard against an unregistered type slipping through, which
 * would otherwise silently produce role-less reminders.
 */
export function resolveSystemReminderRole(type: SystemReminderType): SystemReminderRole {
  const role = SYSTEM_REMINDER_ROLE_REGISTRY[type];
  if (role === undefined) {
    throw new Error(`SYSTEM_REMINDER_ROLE_REGISTRY is missing role for type "${type}". Register the type before producing reminders of this type.`);
  }
  return role;
}
