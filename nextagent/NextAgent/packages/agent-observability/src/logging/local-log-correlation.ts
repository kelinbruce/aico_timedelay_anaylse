import type { ObservabilityObservationEvent } from '../linking/observation.js';

export interface LocalLogCorrelation {
  readonly traceId: string;
  readonly spanId: string;
}

const correlationByObservation = new WeakMap<ObservabilityObservationEvent, LocalLogCorrelation>();

export function bindTimelineLogCorrelation(
  observation: ObservabilityObservationEvent,
  inlinePayload: Readonly<Record<string, unknown>>,
): ObservabilityObservationEvent {
  const correlation = parseTimelineLogCorrelation(inlinePayload['trace']);
  if (correlation !== undefined) {
    correlationByObservation.set(observation, correlation);
  }
  return observation;
}

export function transferLocalLogCorrelation(source: ObservabilityObservationEvent, target: ObservabilityObservationEvent): void {
  const correlation = correlationByObservation.get(source);
  if (correlation !== undefined) {
    correlationByObservation.set(target, correlation);
  }
}

export function localLogCorrelationFor(observation: ObservabilityObservationEvent): LocalLogCorrelation | undefined {
  return correlationByObservation.get(observation);
}

function parseTimelineLogCorrelation(value: unknown): LocalLogCorrelation | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }
  const trace = value as Readonly<Record<string, unknown>>;
  const traceId = trace['traceId'];
  const spanId = trace['spanId'];
  if (typeof traceId !== 'string' || !/^[0-9a-f]{32}$/u.test(traceId) || /^0{32}$/u.test(traceId)) {
    return undefined;
  }
  if (typeof spanId !== 'string' || !/^[0-9a-f]{16}$/u.test(spanId) || /^0{16}$/u.test(spanId)) {
    return undefined;
  }
  return Object.freeze({ traceId, spanId });
}
