import type { StreamEnvelope } from '../../../state/contracts.ts';
import { getEnvelopeRootMessageId } from './streamingHelpers.ts';

function readNonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

export function isCompletedThinkingEnvelope(envelope: StreamEnvelope): boolean {
  if (envelope.eventType !== 'LLM_THINKING_DELTA') {
    return false;
  }
  const metadata = (envelope.payload as Record<string, unknown>).metadata;
  return typeof metadata === 'object' && metadata !== null && !Array.isArray(metadata) && (metadata as Record<string, unknown>).completed === true;
}

export function isAccumulatedThinkingEnvelope(envelope: StreamEnvelope): boolean {
  if (envelope.eventType !== 'LLM_THINKING_DELTA') {
    return false;
  }
  const metadata = (envelope.payload as Record<string, unknown>).metadata;
  return typeof metadata === 'object' && metadata !== null && !Array.isArray(metadata) && (metadata as Record<string, unknown>).accumulated === true;
}

export function readThinkingStepIdentity(envelope: StreamEnvelope): string | null {
  if (envelope.eventType !== 'LLM_THINKING_DELTA') {
    return null;
  }
  const payload = envelope.payload as Record<string, unknown>;
  const runId = readNonEmptyString(envelope.runId) ?? readNonEmptyString(payload.runId);
  const stepId = readNonEmptyString(payload.stepId);
  if (!runId || !stepId) {
    return null;
  }
  return `${envelope.sessionId}\u0000${runId}\u0000${getEnvelopeRootMessageId(envelope)}\u0000${stepId}`;
}
