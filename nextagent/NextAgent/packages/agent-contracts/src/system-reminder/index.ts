/**
 * System reminder public contract.
 *
 * A system reminder is runtime context the system injects into the model input
 * for the model to consult, but which MUST NOT be attributed to the user
 * message or tool result it travels with. The `<system-reminder>` text tag is
 * the single discriminating marker: every system reminder MUST be wrapped in
 * that tag before entering `messages`, and every consumer identifies system
 * reminders by that prefix.
 *
 * System reminders are turn-scoped transient data: they do not participate in
 * persistence, checkpoint, or recovery, and do not enter the chat UI. They are
 * only visible to the model via the rendered model input.
 */

/**
 * Closed union of system reminder types. Adding a type requires:
 *   1. adding the literal here,
 *   2. registering its role in `SYSTEM_REMINDER_ROLE_REGISTRY` (agent-context-engine),
 *   3. implementing a Producer for the type.
 * The pipeline (wrap / inject / smoosh) MUST NOT change when a type is added.
 *
 * v1 ships `relevant_memories` (memory recall injection) and reserves
 * `nested_memory` (no Producer yet).
 */
export type SystemReminderType = 'relevant_memories' | 'nested_memory';

/**
 * The role a system reminder plays in model guidance. Exactly four values.
 *   - INJECT:      provides reference context the model may consult.
 *   - CONSTRAIN:   restricts what the model may do.
 *   - NUDGE:       soft steering toward a behavior.
 *   - TERMINATE:   instructs the model to stop.
 */
export type SystemReminderRole = 'INJECT' | 'CONSTRAIN' | 'NUDGE' | 'TERMINATE';

/**
 * A single system reminder entry. `content` MUST be presentation-safe:
 * no raw prompt text, no model output, no credentials, no local file paths,
 * no `sourceTrace`, no high-cardinality identifiers. The Producer is
 * responsible for safety; the contract does not enforce a content schema.
 */
export interface SystemReminder {
  readonly type: SystemReminderType;
  readonly role: SystemReminderRole;
  readonly content: string;
}

/**
 * The literal tag prefix that identifies a system reminder text block.
 * Every system reminder MUST be wrapped in this tag before entering
 * `messages`; every consumer identifies system reminders by this prefix.
 */
export const SYSTEM_REMINDER_OPEN_TAG = '<system-reminder>';
export const SYSTEM_REMINDER_CLOSE_TAG = '</system-reminder>';
