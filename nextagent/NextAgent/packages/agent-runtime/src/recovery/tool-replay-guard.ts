import {
  type CapabilityId,
  type CapabilityReplayPolicy,
  type IdempotencyKey,
  type JsonObject,
  type MessageId,
  type SafeError,
} from '@nextagent/agent-common';
import type { CheckpointRecord, SessionMessageRecord } from '@nextagent/agent-contracts/gateway';
import type { RequestContext, RequestRun, ToolCallState } from '@nextagent/agent-contracts/runtime';

export type RecoveryGuardFailureCode =
  'RECOVERY_IDEMPOTENCY_KEY_UNAVAILABLE' | 'RECOVERY_CAPABILITY_DESCRIPTOR_UNAVAILABLE' | 'RECOVERY_CAPABILITY_RESULT_INCONSISTENT';

export interface RecoveredToolReplayDescriptor {
  readonly replayPolicy?: CapabilityReplayPolicy;
}

export interface RecoveredToolReplayDescriptorResolver {
  (toolCall: ToolCallState): Promise<RecoveredToolReplayDescriptor | undefined> | RecoveredToolReplayDescriptor | undefined;
}

export interface RecoveredToolIdempotencyKeyResolver {
  (toolCall: ToolCallState): IdempotencyKey | undefined;
}

export interface RecoveryToolReplayGuardInput {
  readonly run: RequestRun;
  readonly context: RequestContext;
  readonly checkpoint?: CheckpointRecord;
  readonly assistantToolUseMessage?: SessionMessageRecord;
  readonly currentRequestMessages: readonly SessionMessageRecord[];
  readonly resolveDescriptor: RecoveredToolReplayDescriptorResolver;
  readonly resolveStableIdempotencyKey: RecoveredToolIdempotencyKeyResolver;
}

export interface RecoveredToolResultReuse {
  readonly kind: 'REUSE_RESULT';
  readonly toolCallId: string;
  readonly capabilityId: CapabilityId;
  readonly resultMessageId: MessageId;
  readonly resultPayload: JsonObject;
}

export interface RecoveredToolReplayAllowed {
  readonly kind: 'REPLAY_ALLOWED';
  readonly toolCallId: string;
  readonly capabilityId: CapabilityId;
  readonly arguments: JsonObject;
  readonly idempotencyKey: IdempotencyKey;
}

export type RecoveredToolReplayDecision = RecoveredToolResultReuse | RecoveredToolReplayAllowed;

export interface RecoveryToolReplayReady {
  readonly status: 'READY';
  readonly decisions: readonly RecoveredToolReplayDecision[];
}

export interface RecoveryToolReplayFailed {
  readonly status: 'RECOVERY_FAILED';
  readonly safeError: SafeError;
  readonly decisions: readonly RecoveredToolReplayDecision[];
}

export type RecoveryToolReplayGuardOutcome = RecoveryToolReplayReady | RecoveryToolReplayFailed;

export async function evaluateRecoveryToolReplayGuard(input: RecoveryToolReplayGuardInput): Promise<RecoveryToolReplayGuardOutcome> {
  const base = validateRecoveryFacts(input);
  if (base.status === 'RECOVERY_FAILED') {
    return base;
  }

  const decisions: RecoveredToolReplayDecision[] = [];
  const resultByToolCallId = collectCapabilityResults(input);

  for (const toolCall of base.toolCalls) {
    const result = resultByToolCallId.get(toolCall.toolCallId);
    if (result !== undefined) {
      decisions.push({
        kind: 'REUSE_RESULT',
        toolCallId: toolCall.toolCallId,
        capabilityId: toolCall.capabilityId,
        resultMessageId: result.message.messageId,
        resultPayload: result.payload,
      });
      continue;
    }

    if (input.checkpoint?.triggerReason === 'CAPABILITY_AFTER_RETURN') {
      return failed(input, 'RECOVERY_CAPABILITY_RESULT_INCONSISTENT', toolCall, decisions);
    }

    const descriptor = await input.resolveDescriptor(toolCall);
    if (descriptor === undefined) {
      return failed(input, 'RECOVERY_CAPABILITY_DESCRIPTOR_UNAVAILABLE', toolCall, decisions);
    }
    const idempotencyKey = input.resolveStableIdempotencyKey(toolCall);
    if (idempotencyKey === undefined) {
      return failed(input, 'RECOVERY_IDEMPOTENCY_KEY_UNAVAILABLE', toolCall, decisions);
    }

    decisions.push({
      kind: 'REPLAY_ALLOWED',
      toolCallId: toolCall.toolCallId,
      capabilityId: toolCall.capabilityId,
      arguments: toolCall.arguments,
      idempotencyKey,
    });
  }

  return { status: 'READY', decisions };
}

function validateRecoveryFacts(
  input: RecoveryToolReplayGuardInput,
): RecoveryToolReplayFailed | { readonly status: 'FACTS_OK'; readonly toolCalls: readonly ToolCallState[] } {
  const { run, context, checkpoint, assistantToolUseMessage } = input;
  if (
    context.nextLifecycleStage !== 'BEFORE_CAPABILITY_INVOKE' ||
    checkpoint === undefined ||
    assistantToolUseMessage === undefined ||
    checkpoint.sessionId !== run.sessionId ||
    checkpoint.requestId !== run.requestId ||
    checkpoint.runId !== run.runId ||
    checkpoint.requestContextId !== context.requestContextId ||
    context.sessionId !== run.sessionId ||
    context.requestId !== run.requestId ||
    context.runId !== run.runId ||
    assistantToolUseMessage.sessionId !== run.sessionId ||
    assistantToolUseMessage.requestId !== run.requestId ||
    assistantToolUseMessage.runId !== run.runId ||
    assistantToolUseMessage.agentId !== run.agentId ||
    assistantToolUseMessage.role !== 'ASSISTANT' ||
    input.currentRequestMessages.some(
      (message) =>
        message.role === 'CAPABILITY_RESULT' &&
        (message.sessionId !== run.sessionId ||
          message.requestId !== run.requestId ||
          message.runId !== run.runId ||
          message.agentId !== run.agentId ||
          parseCapabilityResult(message) === undefined),
    ) ||
    (context.currentToolBatchMessageId !== undefined && context.currentToolBatchMessageId !== assistantToolUseMessage.messageId) ||
    (checkpoint.triggerReason !== 'CAPABILITY_BEFORE_CALL' && checkpoint.triggerReason !== 'CAPABILITY_AFTER_RETURN')
  ) {
    return failed(input, 'RECOVERY_CAPABILITY_RESULT_INCONSISTENT');
  }

  const toolCalls = context.toolCallStates.length === 0 ? parseAssistantToolCalls(assistantToolUseMessage) : context.toolCallStates;
  if (toolCalls.length === 0) {
    return failed(input, 'RECOVERY_CAPABILITY_RESULT_INCONSISTENT');
  }
  return { status: 'FACTS_OK', toolCalls };
}

function collectCapabilityResults(
  input: RecoveryToolReplayGuardInput,
): Map<string, { readonly message: SessionMessageRecord; readonly payload: JsonObject }> {
  const resultByToolCallId = new Map<string, { readonly message: SessionMessageRecord; readonly payload: JsonObject }>();
  for (const message of input.currentRequestMessages) {
    if (message.role !== 'CAPABILITY_RESULT') {
      continue;
    }
    const result = parseCapabilityResult(message);
    if (result !== undefined) {
      resultByToolCallId.set(result.toolCallId, { message, payload: result.payload });
    }
  }
  return resultByToolCallId;
}

function parseAssistantToolCalls(message: SessionMessageRecord): readonly ToolCallState[] {
  const parsed = parseJsonObject(message.content);
  const toolCalls = parsed?.['toolCalls'];
  if (!Array.isArray(toolCalls)) {
    return [];
  }
  return toolCalls.flatMap((toolCall) => {
    if (typeof toolCall !== 'object' || toolCall === null) {
      return [];
    }
    const candidate = toolCall as Record<string, unknown>;
    if (typeof candidate['toolCallId'] !== 'string' || typeof candidate['toolName'] !== 'string' || !isJsonObject(candidate['arguments'])) {
      return [];
    }
    return [
      {
        toolCallId: candidate['toolCallId'],
        capabilityId: candidate['toolName'] as CapabilityId,
        arguments: candidate['arguments'],
        status: 'PENDING' as const,
      },
    ];
  });
}

function parseCapabilityResult(message: SessionMessageRecord): { readonly toolCallId: string; readonly payload: JsonObject } | undefined {
  const parsed = parseJsonObject(message.content);
  if (parsed === undefined || typeof parsed['toolCallId'] !== 'string' || !isJsonObject(parsed['payload'])) {
    return undefined;
  }
  return { toolCallId: parsed['toolCallId'], payload: parsed['payload'] };
}

function parseJsonObject(content: string): JsonObject | undefined {
  try {
    const parsed = JSON.parse(content) as unknown;
    return isJsonObject(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function failed(
  input: Pick<RecoveryToolReplayGuardInput, 'run' | 'context'>,
  code: RecoveryGuardFailureCode,
  toolCall?: Pick<ToolCallState, 'toolCallId' | 'capabilityId'>,
  decisions: readonly RecoveredToolReplayDecision[] = [],
): RecoveryToolReplayFailed {
  return {
    status: 'RECOVERY_FAILED',
    safeError: {
      code,
      message: 'Runtime recovery cannot safely replay the pending capability call.',
      category: 'INTERNAL',
      retryable: false,
      safeDetails: {
        code,
        runId: input.run.runId,
        stage: input.context.nextLifecycleStage,
        ...(toolCall === undefined ? {} : { toolCallId: toolCall.toolCallId, capabilityId: toolCall.capabilityId }),
      },
    },
    decisions,
  };
}
