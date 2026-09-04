import type { SessionMessage } from '@nextagent/agent-contracts/session';

/**
 * The eight continuation-critical categories the generator
 * pre-classifies the covered range against. Each entry is "present"
 * in the covered range if and only if its deterministic rule
 * (below) returns true. The order is significant: it matches the
 * canonical order in the `<checklist>` block of the
 * `compact-summary/v1` prompt template.
 */
export const CONTINUATION_CRITICAL_CATEGORIES = [
  'user_intent',
  'confirmed_facts',
  'constraints',
  'tool_outcomes',
  'artifact_outcomes',
  'unresolved_errors',
  'pending_tasks',
  'next_step',
] as const;

export type ContinuationCriticalCategory = (typeof CONTINUATION_CRITICAL_CATEGORIES)[number];

export type CoveredRangeClassification = Readonly<Record<ContinuationCriticalCategory, boolean>>;

const CONSTRAINT_MARKERS = /\b(?:MUST(?:[ \t]+NOT)?|SHALL(?:[ \t]+NOT)?|CONSTRAINT:)\b/;
const PENDING_TASK_MARKERS = /\b(?:TODO|FIXME)\b/;

/**
 * Pre-classify the covered range against the eight
 * continuation-critical categories. The classification is a
 * pure function of the message array — the model output never
 * influences which categories are present, only whether the
 * model emitted a matching `<fact>` for them.
 */
export function classifyCoveredRange(messages: readonly SessionMessage[]): CoveredRangeClassification {
  let hasUser = false;
  let hasAssistant = false;
  let hasConstraint = false;
  let hasToolOutcome = false;
  let hasArtifact = false;
  let hasUnresolvedError = false;
  let hasPendingTask = false;

  for (const message of messages) {
    const content = message.content;
    switch (message.role) {
      case 'USER':
        if (!hasUser && content.trim().length > 0) {
          hasUser = true;
        }
        break;
      case 'ASSISTANT':
        if (!hasAssistant && content.trim().length > 0) {
          hasAssistant = true;
        }
        break;
      case 'CAPABILITY_RESULT':
        if (!hasToolOutcome) {
          hasToolOutcome = true;
        }
        const metadata = message.metadata;
        const result = metadata['capabilityResult'];
        if (isPlainObject(result)) {
          const artifactRefs = result['artifactRefs'];
          if (Array.isArray(artifactRefs) && artifactRefs.length > 0) {
            hasArtifact = true;
          }
        }
        if (metadata['kind'] === 'CAPABILITY_FAILED' || metadata['kind'] === 'CAPABILITY_DEGRADED' || metadata['kind'] === 'CAPABILITY_UNAVAILABLE') {
          hasUnresolvedError = true;
        } else {
          const safeError = metadata['safeError'];
          if (isPlainObject(safeError)) {
            const category = safeError['category'];
            if (category === 'INTERNAL' || category === 'VALIDATION' || category === 'AUTHORIZATION') {
              hasUnresolvedError = true;
            }
          }
        }
        break;
      default:
        break;
    }
    if (!hasConstraint && CONSTRAINT_MARKERS.test(content)) {
      hasConstraint = true;
    }
    if (!hasPendingTask && PENDING_TASK_MARKERS.test(content)) {
      hasPendingTask = true;
    }
  }

  // `next_step` is "present" only when the last message is a USER
  // message with non-empty content. The generator uses this to
  // surface the next-step clue the user most recently stated.
  const last = messages[messages.length - 1];
  const nextStepPresent = last !== undefined && last.role === 'USER' && last.content.trim().length > 0;

  return {
    user_intent: hasUser,
    confirmed_facts: hasAssistant,
    constraints: hasConstraint,
    tool_outcomes: hasToolOutcome,
    artifact_outcomes: hasArtifact,
    unresolved_errors: hasUnresolvedError,
    pending_tasks: hasPendingTask,
    next_step: nextStepPresent,
  };
}

export function listPresentCategories(classification: CoveredRangeClassification): readonly ContinuationCriticalCategory[] {
  return CONTINUATION_CRITICAL_CATEGORIES.filter((category) => classification[category]);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
