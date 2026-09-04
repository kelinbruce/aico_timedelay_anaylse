export const openTelemetryTraceMapping = {
  synchronousBoundary: 'Span',
  asyncEnvelopeSubscriber: 'SpanLink',
  authoritativeFact: 'SpanEvent',
  traceApprovedCandidate: 'SpanAttribute',
  propagation: 'W3C_TRACE_CONTEXT',
  exporter: 'OTLP_TRACES',
} as const;
