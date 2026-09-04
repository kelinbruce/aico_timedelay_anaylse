import { ModelFinalResultSchema, ModelStreamDeltaSchema, type ModelFinalResult, type ModelStreamDelta } from '@nextagent/agent-contracts/model';
import { Ajv } from 'ajv/dist/ajv.js';

const ajv = new Ajv({ allErrors: true, strict: false });
const validateModelFinalResult = ajv.compile(ModelFinalResultSchema);
const validateModelStreamDelta = ajv.compile(ModelStreamDeltaSchema);

export function isModelFinalResult(value: unknown): value is ModelFinalResult {
  return validateModelFinalResult(value);
}

export function normalizeModelTerminalResult(result: ModelFinalResult): ModelFinalResult {
  if (result.finishReason === 'content-filter') {
    return terminalFailure(result, 'MODEL_CONTENT_FILTERED', 'Model output was blocked by the provider content policy.', 'POLICY_DENIED');
  }
  if (result.safeError !== undefined) {
    return result;
  }
  if (result.finishReason === 'length' && result.incompleteOutputReason === undefined) {
    return { ...result, incompleteOutputReason: 'output-limit' };
  }
  if (result.finishReason === 'error') {
    return terminalFailure(result, 'MODEL_TERMINAL_ERROR', 'Model invocation ended with an error result.', 'INTERNAL');
  }
  if (result.finishReason === 'unknown' && (result.toolCalls?.length ?? 0) === 0) {
    return terminalFailure(result, 'MODEL_FINISH_REASON_UNKNOWN', 'Model invocation ended without a recognized completion reason.', 'INTERNAL');
  }
  if (result.finishReason === 'tool-calls' && (result.toolCalls?.length ?? 0) === 0 && result.incompleteOutputReason !== 'truncated-tool-call') {
    return terminalFailure(
      result,
      'MODEL_TOOL_CALLS_MISSING',
      'Model invocation reported tool calls without returning a complete tool call.',
      'INTERNAL',
    );
  }
  return result;
}

export function isModelStreamDelta(value: unknown): value is ModelStreamDelta {
  return validateModelStreamDelta(value);
}

function terminalFailure(result: ModelFinalResult, code: string, message: string, category: 'INTERNAL' | 'POLICY_DENIED'): ModelFinalResult {
  return {
    content: '',
    ...(result.finishReason === undefined ? {} : { finishReason: result.finishReason }),
    ...(result.usage === undefined ? {} : { usage: result.usage }),
    ...(result.providerResponseId === undefined ? {} : { providerResponseId: result.providerResponseId }),
    safeError: { code, message, category, retryable: false },
  };
}
