import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { extractReasoningMiddleware, generateText, NoOutputGeneratedError, streamText, wrapLanguageModel } from 'ai';
import type { AssistantContent, FinishReason, LanguageModelUsage, ModelMessage as AiModelMessage, ToolContent } from 'ai';
import type { JsonObject, SafeError } from '@nextagent/agent-common';
import type {
  ModelFinalResult,
  ModelFinishReason,
  ModelInvocationRequest,
  ModelInvocationService,
  ModelProviderProfile,
  ModelStreamDelta,
  ModelToolCall,
  ModelUsage,
} from '@nextagent/agent-contracts/model';
import type { ExecutionCorrelationPort } from '@nextagent/agent-contracts/observability';

import type { CredentialResolver } from '../../credentials/credential-resolver.js';
import { isJsonObject } from '../../internal/json.js';
import { defaultModelMaxRetries, defaultModelTimeoutMs } from '../../internal/model-defaults.js';
import { ModelErrorNormalizer } from '../../invocation/error-normalizer.js';
import { validateModelInvocationPreconditions } from '../../invocation/preconditions.js';
import { composeInvocationCorrelationHeaders } from '../../transport/invocation-headers.js';
import { createSafeModelError } from '../shared/error-mapper.js';
import { toToolSet } from '../shared/tool-use-normalizer.js';

// AI SDK synthesizes this prefix when the provider response omits an id; it is
// not a provider correlation id and must not cross the adapter boundary.
const aiSdkSyntheticResponseIdPrefix = 'aitxt-';

export interface OpenAICompatibleRegistrationOptions {
  readonly credentialResolver: CredentialResolver;
  readonly executionCorrelation?: ExecutionCorrelationPort;
  readonly fetch?: typeof globalThis.fetch;
}

export function createOpenAICompatibleModelInvocationService(
  providerProfile: ModelProviderProfile,
  options: OpenAICompatibleRegistrationOptions,
): ModelInvocationService {
  return new OpenAICompatibleModelInvocationService(providerProfile, options);
}

export class OpenAICompatibleModelInvocationService implements ModelInvocationService {
  private readonly errorNormalizer = new ModelErrorNormalizer();

  constructor(
    private readonly providerProfile: ModelProviderProfile,
    private readonly options: OpenAICompatibleRegistrationOptions,
  ) {}

  async complete(request: ModelInvocationRequest, signal: AbortSignal): Promise<ModelFinalResult> {
    const preconditionFailure = validateModelInvocationPreconditions(request, signal);
    if (preconditionFailure !== undefined) {
      return preconditionFailure;
    }
    let prepared: Awaited<ReturnType<OpenAICompatibleModelInvocationService['prepareInvocation']>>;
    try {
      prepared = await this.prepareInvocation(request, signal);
    } catch (error) {
      return { content: '', safeError: normalizeInvocationError(error, signal, this.errorNormalizer) };
    }
    if ('safeError' in prepared) {
      return { content: '', safeError: prepared.safeError };
    }
    try {
      const result = await generateText({
        ...prepared.options,
        maxRetries: request.maxRetries ?? defaultModelMaxRetries,
      });
      return normalizeSdkTerminalResult({
        content: result.text,
        reasoning: result.reasoningText,
        toolCalls: result.toolCalls,
        finishReason: result.finishReason,
        usage: result.usage,
        responseId: result.response.id,
        maxOutputTokens: request.maxOutputTokens,
      });
    } catch (error) {
      return { content: '', safeError: normalizeInvocationError(error, signal, this.errorNormalizer) };
    }
  }

  async stream(request: ModelInvocationRequest, signal: AbortSignal, onDelta: (delta: ModelStreamDelta) => Promise<void>): Promise<ModelFinalResult> {
    const preconditionFailure = validateModelInvocationPreconditions(request, signal);
    if (preconditionFailure !== undefined) {
      return preconditionFailure;
    }
    try {
      const prepared = await this.prepareInvocation(request, signal);
      if ('safeError' in prepared) {
        return { content: '', safeError: prepared.safeError };
      }
      const result = streamText({
        ...prepared.options,
        maxRetries: request.maxRetries ?? defaultModelMaxRetries,
        onChunk: async ({ chunk }) => {
          if (chunk.type === 'text-delta' && chunk.text.length > 0) {
            await emitDelta(onDelta, { content: chunk.text });
          } else if (chunk.type === 'reasoning-delta' && chunk.text.length > 0) {
            await emitDelta(onDelta, { reasoning: chunk.text });
          } else if (chunk.type === 'tool-call' && isJsonObject(chunk.input)) {
            await emitDelta(onDelta, {
              toolCall: {
                toolCallId: chunk.toolCallId,
                toolName: chunk.toolName,
                arguments: chunk.input,
              },
            });
          }
        },
        onError: ({ error }) => {
          throw error;
        },
      });
      const [content, reasoning, toolCalls, finishReason, totalUsage, response] = await Promise.all([
        result.text,
        result.reasoningText,
        result.toolCalls,
        result.finishReason,
        result.totalUsage,
        result.response,
      ]);
      return normalizeSdkTerminalResult({
        content,
        reasoning,
        toolCalls,
        finishReason,
        usage: totalUsage,
        responseId: response.id,
        maxOutputTokens: request.maxOutputTokens,
      });
    } catch (error) {
      if (error instanceof DeltaHandlerError) {
        throw error.cause;
      }
      if (NoOutputGeneratedError.isInstance(error)) {
        return { content: '', safeError: streamAborted() };
      }
      return { content: '', safeError: normalizeInvocationError(error, signal, this.errorNormalizer) };
    }
  }

  private async prepareInvocation(
    request: ModelInvocationRequest,
    signal: AbortSignal,
  ): Promise<{ readonly options: PreparedSdkInvocation } | { readonly safeError: SafeError }> {
    if (hasReservedProviderOption(request.providerOptions)) {
      return {
        safeError: createSafeModelError('MODEL_PROVIDER_OPTIONS_INVALID', 'Model provider options are invalid.', 'VALIDATION'),
      };
    }
    const thinkingDepth = request.thinking?.depth;
    const credential =
      this.providerProfile.credentialRef === undefined ? undefined : await this.options.credentialResolver(this.providerProfile.credentialRef);
    const correlationHeaders = composeInvocationCorrelationHeaders(request.invocationScope);
    const headers = this.options.executionCorrelation?.outboundHeaders(correlationHeaders) ?? correlationHeaders;
    const fetch = this.options.fetch;
    const provider = createOpenAICompatible({
      name: 'openai-compatible',
      baseURL: requireBaseUrl(this.providerProfile),
      ...(credential === undefined ? {} : { apiKey: credential }),
      ...(fetch === undefined ? {} : { fetch }),
      includeUsage: true,
      transformRequestBody: (body) => ({
        ...body,
        ...(request.topK === undefined ? {} : { top_k: request.topK }),
        ...toProviderNativeThinking(thinkingDepth),
        ...(thinkingDepth === 'OFF' ? { chat_template_kwargs: { enable_thinking: false } } : {}),
        ...(request.modelParams === undefined ? {} : request.modelParams),
      }),
    });
    const tools = toToolSet(request.tools);
    const isImplicitReasoningStart =
      this.providerProfile.models.find((modelProfile) => modelProfile.modelId === request.modelId)?.reasoningTextMode === 'IMPLICIT_OPEN_THINK_TAG';
    return {
      options: {
        model: wrapLanguageModel({
          model: provider.chatModel(request.modelId),
          middleware: extractReasoningMiddleware({ tagName: 'think', startWithReasoning: isImplicitReasoningStart }),
        }),
        ...toSdkPrompt(request),
        abortSignal: signal,
        timeout: { totalMs: request.timeoutMs ?? defaultModelTimeoutMs },
        headers,
        ...(request.providerOptions === undefined ? {} : { providerOptions: toSdkProviderOptions(request.providerOptions) }),
        ...(request.temperature === undefined ? {} : { temperature: request.temperature }),
        ...(request.maxOutputTokens === undefined ? {} : { maxOutputTokens: request.maxOutputTokens }),
        ...(request.topP === undefined ? {} : { topP: request.topP }),
        ...(request.presencePenalty === undefined ? {} : { presencePenalty: request.presencePenalty }),
        ...(request.frequencyPenalty === undefined ? {} : { frequencyPenalty: request.frequencyPenalty }),
        ...(tools === undefined ? {} : { tools }),
        ...(request.toolChoice === undefined ? {} : { toolChoice: request.toolChoice.toLowerCase() as 'auto' | 'none' | 'required' }),
      },
    };
  }
}

type PreparedSdkInvocation = Pick<
  Parameters<typeof generateText>[0],
  | 'model'
  | 'system'
  | 'messages'
  | 'allowSystemInMessages'
  | 'abortSignal'
  | 'timeout'
  | 'headers'
  | 'providerOptions'
  | 'temperature'
  | 'maxOutputTokens'
  | 'topP'
  | 'presencePenalty'
  | 'frequencyPenalty'
  | 'tools'
  | 'toolChoice'
>;

const reservedProviderOptionNames = new Set([
  'model',
  'modelid',
  'providerid',
  'messages',
  'tools',
  'toolchoice',
  'stream',
  'streamoptions',
  'temperature',
  'maxoutputtokens',
  'maxtokens',
  'maxcompletiontokens',
  'topp',
  'topk',
  'presencepenalty',
  'frequencypenalty',
  'thinking',
  'reasoning',
  'reasoningeffort',
  'timeoutms',
  'maxretries',
  'baseurl',
  'endpoint',
  'credential',
  'credentialref',
  'apikey',
  'authorization',
  'headers',
  'fetch',
  'transport',
  'abortsignal',
  'signal',
  'invocationscope',
  'tenantid',
  'subjectid',
  'agentid',
  'agentversion',
  'agentassemblyref',
  'operationid',
  'sessionid',
  'requestid',
  'runid',
]);

function hasReservedProviderOption(value?: JsonObject): boolean {
  return value !== undefined && Object.keys(value).some((key) => reservedProviderOptionNames.has(normalizeProviderOptionName(key)));
}

function normalizeProviderOptionName(value: string): string {
  return value.replace(/[_-]/gu, '').toLowerCase();
}

function toSdkProviderOptions(value: JsonObject): NonNullable<PreparedSdkInvocation['providerOptions']> {
  if (!isSdkJsonObject(value)) {
    throw new Error('Model provider options must contain JSON-compatible values.');
  }
  return { openaiCompatible: value };
}

type SdkProviderJsonValue = string | number | boolean | null | SdkProviderJsonObject | SdkProviderJsonValue[];
interface SdkProviderJsonObject {
  readonly [key: string]: SdkProviderJsonValue | undefined;
}

function isSdkJsonObject(value: unknown): value is SdkProviderJsonObject {
  return isJsonObject(value) && Object.values(value).every(isSdkJsonValue);
}

function isSdkJsonValue(value: unknown): value is SdkProviderJsonValue {
  return (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean' ||
    (Array.isArray(value) && value.every(isSdkJsonValue)) ||
    isSdkJsonObject(value)
  );
}

function toProviderNativeThinking(depth?: 'OFF' | 'LOW' | 'MEDIUM' | 'HIGH'): Record<string, unknown> {
  if (depth === undefined) {
    return {};
  }
  if (depth === 'OFF') {
    return { enable_thinking: false };
  }
  return {
    reasoning_effort: depth.toLowerCase(),
  };
}

function requireBaseUrl(profile: ModelProviderProfile): string {
  if (profile.baseUrl === undefined) {
    throw new Error('OpenAI-compatible base URL is unavailable.');
  }
  return profile.baseUrl;
}

function invalidToolArguments(): ModelFinalResult {
  return {
    content: '',
    safeError: createSafeModelError('MODEL_TOOL_ARGUMENTS_INVALID', 'Model provider returned invalid tool arguments.', 'VALIDATION'),
  };
}

function normalizeInvocationError(error: unknown, callerSignal: AbortSignal, normalizer: ModelErrorNormalizer): SafeError {
  if (callerSignal.aborted) {
    return aborted();
  }
  if (isTimeoutError(error)) {
    return timedOut();
  }
  return normalizer.normalize(error);
}

function aborted(): SafeError {
  return createSafeModelError('MODEL_ABORTED', 'Model invocation was canceled.', 'CANCELED');
}

function timedOut(): SafeError {
  return createSafeModelError('MODEL_TIMEOUT', 'Model invocation timed out.', 'TIMEOUT');
}

function streamAborted(): SafeError {
  return createSafeModelError('MODEL_STREAM_ABORTED', 'Model stream ended unexpectedly.', 'UNAVAILABLE');
}

function isTimeoutError(error: unknown): boolean {
  return (error instanceof DOMException && error.name === 'TimeoutError') || (error instanceof Error && error.name === 'TimeoutError');
}

class DeltaHandlerError extends Error {
  constructor(readonly cause: unknown) {
    super('Model stream delta handler failed.');
  }
}

async function emitDelta(onDelta: (delta: ModelStreamDelta) => Promise<void>, delta: ModelStreamDelta): Promise<void> {
  try {
    await onDelta(delta);
  } catch (error) {
    throw new DeltaHandlerError(error);
  }
}

function normalizeFinishReason(finishReason: FinishReason): ModelFinishReason {
  switch (finishReason) {
    case 'tool-calls':
    case 'length':
    case 'content-filter':
    case 'error':
    case 'stop':
      return finishReason;
    default:
      return 'unknown';
  }
}

function normalizeSdkToolCalls(toolCalls: readonly unknown[]): ModelToolCall[] | undefined {
  const normalized: ModelToolCall[] = [];
  for (const toolCall of toolCalls) {
    if (
      !isJsonObject(toolCall) ||
      toolCall.invalid === true ||
      typeof toolCall.toolCallId !== 'string' ||
      typeof toolCall.toolName !== 'string' ||
      !isJsonObject(toolCall.input)
    ) {
      return undefined;
    }
    normalized.push({
      toolCallId: toolCall.toolCallId,
      toolName: toolCall.toolName,
      arguments: toolCall.input,
    });
  }
  return normalized;
}

interface SdkTerminalResult {
  readonly content: string;
  readonly reasoning?: string | undefined;
  readonly toolCalls: readonly unknown[];
  readonly finishReason: FinishReason;
  readonly usage?: LanguageModelUsage | undefined;
  readonly responseId?: string | undefined;
  readonly maxOutputTokens?: number | undefined;
}

function normalizeSdkTerminalResult(result: SdkTerminalResult): ModelFinalResult {
  const finishReason = normalizeFinishReason(result.finishReason);
  const usage = normalizeUsage(result.usage);
  const providerResponseId = normalizeProviderResponseId(result.responseId);
  const toolCalls = normalizeSdkToolCalls(result.toolCalls);
  if (toolCalls === undefined) {
    const truncated =
      finishReason === 'length' ||
      ((finishReason === 'tool-calls' || finishReason === 'stop' || finishReason === 'unknown') &&
        usage?.outputTokens !== undefined &&
        result.maxOutputTokens !== undefined &&
        usage.outputTokens >= result.maxOutputTokens);
    if (!truncated) {
      return invalidToolArguments();
    }
    return {
      content: result.content,
      ...(result.reasoning === undefined || result.reasoning.length === 0 ? {} : { reasoning: result.reasoning }),
      finishReason,
      incompleteOutputReason: 'truncated-tool-call',
      ...(usage === undefined ? {} : { usage }),
      ...(providerResponseId === undefined ? {} : { providerResponseId }),
    };
  }
  return {
    content: result.content,
    ...(result.reasoning === undefined || result.reasoning.length === 0 ? {} : { reasoning: result.reasoning }),
    finishReason,
    toolCalls,
    ...(usage === undefined ? {} : { usage }),
    ...(providerResponseId === undefined ? {} : { providerResponseId }),
  };
}

function normalizeUsage(usage?: LanguageModelUsage): ModelUsage | undefined {
  if (usage === undefined) {
    return undefined;
  }
  const normalized: ModelUsage = {
    ...(validUsage(usage.inputTokens) ? { inputTokens: usage.inputTokens } : {}),
    ...(validUsage(usage.outputTokens) ? { outputTokens: usage.outputTokens } : {}),
    ...(validUsage(usage.totalTokens) ? { totalTokens: usage.totalTokens } : {}),
  };
  return Object.keys(normalized).length === 0 ? undefined : normalized;
}

function validUsage(value?: number): value is number {
  return value !== undefined && Number.isSafeInteger(value) && value >= 0;
}

function normalizeProviderResponseId(responseId?: string): string | undefined {
  return responseId === undefined || responseId.startsWith(aiSdkSyntheticResponseIdPrefix) ? undefined : responseId;
}

type AiSystemMessage = Extract<AiModelMessage, { readonly role: 'system' }>;

function toSdkPrompt(request: ModelInvocationRequest): Pick<PreparedSdkInvocation, 'system' | 'messages' | 'allowSystemInMessages'> {
  const systemMessages: AiSystemMessage[] = [];
  const messages: AiModelMessage[] = [];
  for (const message of request.messages) {
    const text = message.content
      .filter((part) => part.type === 'text')
      .map((part) => part.text)
      .join('');
    if (message.role === 'SYSTEM') {
      systemMessages.push({ role: 'system', content: text });
      continue;
    }
    if (message.role === 'USER') {
      messages.push({ role: 'user', content: text });
      continue;
    }
    if (message.role === 'ASSISTANT') {
      const content: Exclude<AssistantContent, string> = [];
      for (const part of message.content) {
        if (part.type === 'text') {
          content.push({ type: 'text', text: part.text });
        }
        if (part.type === 'tool-call') {
          content.push({
            type: 'tool-call',
            toolCallId: part.toolCall.toolCallId,
            toolName: part.toolCall.toolName,
            input: toSdkJsonValue(part.toolCall.arguments),
          });
        }
      }
      messages.push(content.every((part) => part.type === 'text') ? { role: 'assistant', content: text } : { role: 'assistant', content });
      continue;
    }
    const content: ToolContent = [];
    for (const part of message.content) {
      if (part.type === 'tool-result') {
        content.push({
          type: 'tool-result',
          toolCallId: part.toolCallId,
          toolName: part.toolName,
          output: { type: 'json', value: toSdkJsonValue(part.output) },
        });
      }
    }
    messages.push({
      role: 'tool',
      content,
    });
  }
  if (messages.length === 0) {
    return {
      messages: systemMessages,
      allowSystemInMessages: true,
    };
  }
  return {
    ...(systemMessages.length === 0 ? {} : { system: systemMessages }),
    messages,
    allowSystemInMessages: false,
  };
}

type SdkJsonValue = null | string | number | boolean | SdkJsonValue[] | { readonly [key: string]: SdkJsonValue };

function toSdkJsonValue(value: JsonObject | JsonObject[string]): SdkJsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(toSdkJsonValue);
  }
  const result: Record<string, SdkJsonValue> = {};
  for (const [key, item] of Object.entries(value)) {
    result[key] = toSdkJsonValue(item);
  }
  return result;
}
