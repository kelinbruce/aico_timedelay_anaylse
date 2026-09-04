import type { StreamEnvelope } from '../../../state/contracts.ts';

export function isTimelineBackedCursorEnvelope(envelope: StreamEnvelope): boolean {
  return envelope.eventType !== 'DEGRADATION_NOTICE' && typeof envelope.timelineEventRef === 'string' && envelope.timelineEventRef.trim().length > 0;
}
