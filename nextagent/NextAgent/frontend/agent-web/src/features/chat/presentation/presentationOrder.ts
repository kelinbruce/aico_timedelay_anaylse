import type { StreamEnvelope } from '../../../state/contracts.ts';
import { toTimestampMillis } from '../../../utils/time.ts';

export function buildComposedActivityOrderByEnvelope(envelopes: readonly StreamEnvelope[]): ReadonlyMap<StreamEnvelope, number> {
  const candidates = envelopes.map((envelope, arrayOrder) => ({
    envelope,
    arrayOrder,
    timestamp: toTimestampMillis(envelope.createdAt),
  }));
  const canOrderByActivityTime = candidates.every((candidate) => !Number.isNaN(candidate.timestamp));
  const ordered = canOrderByActivityTime
    ? [...candidates].sort((left, right) => left.timestamp - right.timestamp || left.arrayOrder - right.arrayOrder)
    : candidates;

  return new Map(ordered.map((candidate, activityOrder) => [candidate.envelope, activityOrder]));
}
