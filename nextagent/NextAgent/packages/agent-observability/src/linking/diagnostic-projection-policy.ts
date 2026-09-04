import type { ObservationBoundary } from './observation.js';

const MODEL_DIAGNOSTIC_KEYS = new Set([
  'stepId',
  'finishReason',
  'safeErrorCategory',
  'persistenceMode',
  'timeoutMs',
  'maxOutputTokens',
  'messageCount',
  'toolCount',
  'status',
  'messageCountBucket',
  'timeoutMsBucket',
  'maxOutputTokensBucket',
  'disclosedCapabilityNames',
  'disclosedCapabilityNamesTruncated',
  'resolvedToolNames',
  'resolvedToolNamesTruncated',
]);

const MODEL_IDENTITY_KEYS = new Set(['providerKind', 'modelProfileId', 'modelName', 'modelId']);
const REQUEST_TERMINAL_METRICS_ONLY_KEYS = new Set(['safeErrorCode', 'safeErrorCategory']);

export function isDiagnosticCandidateProjectable(boundary: ObservationBoundary, operation: string, key: string): boolean {
  if (boundary === 'request_lifecycle' && operation === 'TERMINAL_COMMITTED' && REQUEST_TERMINAL_METRICS_ONLY_KEYS.has(key)) {
    return false;
  }
  return !MODEL_IDENTITY_KEYS.has(key) && (boundary !== 'model_invocation' || MODEL_DIAGNOSTIC_KEYS.has(key));
}
