import type { ModelInvocationRequest, ModelMessage } from '@nextagent/agent-contracts/model';

export const maxOutputTokenRecoveryContinuations = 3;

const outputTokenEscalationMultiplier = 8;
const maxEscalatedOutputTokens = 32_000;
const unknownInputOutputWindowRatio = 0.25;
const outputContinuationInstruction = [
  'Continue directly from the preceding assistant output.',
  'Do not apologize, repeat, or summarize content already produced.',
  'If the remaining answer is long, divide it into smaller complete sections.',
].join(' ');
const reasoningOnlyCorrectionInstruction = [
  'The previous response ended after internal reasoning without user-visible content or a tool call.',
  'Return either a concise user-visible answer or one necessary tool call now.',
  'Do not repeat internal reasoning or describe what you plan to do.',
].join(' ');

export interface OutputTokenEscalationInput {
  readonly currentMaxOutputTokens?: number;
  readonly contextWindowTokens: number;
  readonly providerInputTokens?: number;
  readonly estimatedInputTokens?: number;
}

export function calculateEscalatedMaxOutputTokens(input: OutputTokenEscalationInput): number | undefined {
  const currentLimit = positiveInteger(input.currentMaxOutputTokens);
  const contextWindow = positiveInteger(input.contextWindowTokens);
  if (contextWindow === undefined) {
    return undefined;
  }

  const knownInputTokens = [positiveInteger(input.providerInputTokens), positiveInteger(input.estimatedInputTokens)].filter(
    (value): value is number => value !== undefined,
  );
  const contextCapacity =
    knownInputTokens.length > 0 ? contextWindow - Math.max(...knownInputTokens) : Math.floor(contextWindow * unknownInputOutputWindowRatio);
  const requestedLimit = currentLimit === undefined ? maxEscalatedOutputTokens : currentLimit * outputTokenEscalationMultiplier;
  const escalatedLimit = Math.floor(Math.min(requestedLimit, maxEscalatedOutputTokens, contextCapacity));

  if (escalatedLimit <= 0 || (currentLimit !== undefined && escalatedLimit <= currentLimit)) {
    return undefined;
  }
  return escalatedLimit;
}

export function withEscalatedOutputLimit(request: ModelInvocationRequest, maxOutputTokens: number): ModelInvocationRequest {
  return {
    ...request,
    maxOutputTokens,
  };
}

export function withOutputContinuation(request: ModelInvocationRequest, assistantContent: string): ModelInvocationRequest {
  const continuationMessages: readonly ModelMessage[] = [
    ...request.messages,
    { role: 'ASSISTANT', content: [{ type: 'text', text: assistantContent }] },
    { role: 'USER', content: [{ type: 'text', text: outputContinuationInstruction }] },
  ];
  return { ...request, messages: continuationMessages };
}

export function withReasoningOnlyCorrection(request: ModelInvocationRequest): ModelInvocationRequest {
  return {
    ...request,
    messages: [...request.messages, { role: 'USER', content: [{ type: 'text', text: reasoningOnlyCorrectionInstruction }] }],
  };
}

function positiveInteger(value?: number): number | undefined {
  return value !== undefined && Number.isFinite(value) && value > 0 ? Math.floor(value) : undefined;
}
