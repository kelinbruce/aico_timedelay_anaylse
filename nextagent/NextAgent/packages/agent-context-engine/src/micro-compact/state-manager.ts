/**
 * Micro-compact state management.
 *
 * State is persisted in `ActiveContextViewRecord.metadata.microCompactState`
 * so it survives process restarts and is automatically scoped per
 * owner + agent + session. The state records which messageIds have already
 * been compacted so the same result is never processed twice (idempotency).
 *
 * After summary compression replaces the active context, the compactedIds
 * are no longer valid (the prior history has been replaced by a summary)
 * and the state MUST be cleared.
 */

/**
 * Persisted micro-compact state. Carried inside
 * `ActiveContextViewRecord.metadata.microCompactState`.
 */
export interface MicroCompactState {
  /** MessageIds that have been marked as compacted. */
  readonly compactedIds: readonly string[];
}

/** Empty-state constant (backward-compatible default). */
export const EMPTY_MICRO_COMPACT_STATE: MicroCompactState = {
  compactedIds: [],
};

/**
 * Safely read micro-compact state from an ActiveContextView metadata bag.
 * Returns `EMPTY_MICRO_COMPACT_STATE` when the field is absent, malformed,
 * or the metadata itself is undefined (backward-compatible).
 */
export function readMicroCompactState(metadata?: Record<string, unknown>): MicroCompactState {
  if (metadata === undefined) {
    return EMPTY_MICRO_COMPACT_STATE;
  }
  const raw = metadata['microCompactState'];
  if (!isPlainObject(raw)) {
    return EMPTY_MICRO_COMPACT_STATE;
  }
  const ids = raw['compactedIds'];
  if (!Array.isArray(ids)) {
    return EMPTY_MICRO_COMPACT_STATE;
  }
  const validIds = ids.filter((id): id is string => typeof id === 'string' && id.length > 0);
  return { compactedIds: validIds };
}

/**
 * Project the micro-compact state into a metadata bag.
 * Returns a new object (does not mutate the input).
 */
export function writeMicroCompactState(metadata: Record<string, unknown>, state: MicroCompactState): Record<string, unknown> {
  return {
    ...metadata,
    microCompactState: {
      compactedIds: [...state.compactedIds],
    },
  };
}

/**
 * Remove micro-compact state from a metadata bag.
 * Called after summary compression replaces the active context.
 * Returns a new object (does not mutate the input).
 */
export function clearMicroCompactState(metadata: Record<string, unknown>): Record<string, unknown> {
  const { microCompactState: _, ...rest } = metadata;
  return rest;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
