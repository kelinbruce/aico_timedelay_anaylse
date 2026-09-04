import { brand, type JsonObject, type MessageId, type SafeError } from '@nextagent/agent-common';
import type { AgentRunStatePort, RequestContext, RequestRun } from '@nextagent/agent-contracts/runtime';

export interface CapabilityResultProjectionInput {
  readonly structuredPayload: JsonObject;
  readonly resultRef?: string;
  readonly artifactRefs?: readonly string[];
  readonly fallbackTriggered?: boolean;
  readonly metadata?: JsonObject;
}

export interface FailedCapabilityResultProjectionInput extends CapabilityResultProjectionInput {
  readonly status: 'FAILED' | 'DEGRADED' | 'TIMED_OUT';
  readonly safeError?: SafeError;
}

export function buildModelVisibleCapabilityPayload(input: CapabilityResultProjectionInput): JsonObject {
  const visibleResultMetadata = modelVisibleCapabilityMetadata(input.metadata);
  const metadata: JsonObject = {
    ...(input.resultRef === undefined ? {} : { resultRef: input.resultRef }),
    ...((input.artifactRefs ?? []).length === 0 ? {} : { artifactRefs: input.artifactRefs }),
    ...(input.fallbackTriggered === undefined ? {} : { fallbackTriggered: input.fallbackTriggered }),
    ...(visibleResultMetadata === undefined ? {} : { metadata: visibleResultMetadata }),
  };
  return Object.keys(metadata).length === 0 ? input.structuredPayload : { ...input.structuredPayload, capabilityResult: metadata };
}

export function buildFailedCapabilityPayload(input: FailedCapabilityResultProjectionInput): JsonObject {
  return {
    status: input.status,
    result: input.structuredPayload,
    safeError: {
      code: input.safeError?.code ?? 'CAPABILITY_FAILED',
      category: input.safeError?.category ?? 'UNAVAILABLE',
      retryable: input.safeError?.retryable ?? false,
      ...(input.safeError?.message === undefined ? {} : { errorMessage: input.safeError.message }),
      ...(input.safeError?.safeDetails === undefined ? {} : { safeDetails: input.safeError.safeDetails }),
    },
    ...(input.resultRef === undefined ? {} : { resultRef: input.resultRef }),
    ...((input.artifactRefs ?? []).length === 0 ? {} : { artifactRefs: input.artifactRefs }),
  };
}

export async function appendCapabilityResultMessage(
  runState: AgentRunStatePort,
  run: RequestRun,
  context: RequestContext,
  toolCallId: string,
  toolName: string,
  payload: JsonObject,
): Promise<MessageId> {
  return await runState.appendMessage(run, context, {
    role: 'CAPABILITY_RESULT',
    content: JSON.stringify({ toolCallId, toolName, payload }),
    contentType: 'PLAIN_TEXT',
    visible: true,
    metadata: { kind: 'CAPABILITY_RESULT', toolCallId, toolName },
    idempotencyKey: brand<string, 'IdempotencyKey'>(`${run.runId}:capability-result:${toolCallId}`),
  });
}

function modelVisibleCapabilityMetadata(metadata?: JsonObject): JsonObject | undefined {
  if (metadata === undefined) {
    return undefined;
  }
  const visible = { ...metadata };
  delete visible['toolDiagnostics'];
  delete visible['sourceTrace'];
  return Object.keys(visible).length === 0 ? undefined : visible;
}
