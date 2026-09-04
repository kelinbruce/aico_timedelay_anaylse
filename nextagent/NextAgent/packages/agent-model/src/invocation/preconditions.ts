import {
  ModelInvocationRequestSchema,
  type ModelFinalResult,
  type ModelInvocationRequest,
  type ModelMessage,
  type ModelToolDescriptor,
} from '@nextagent/agent-contracts/model';
import { Ajv } from 'ajv/dist/ajv.js';
import type { JsonObject } from '@nextagent/agent-common';
import { isJsonObject } from '../internal/json.js';
import { createSafeModelError } from '../providers/shared/error-mapper.js';

const validateModelInvocationRequest = new Ajv({
  allErrors: true,
  strict: false,
}).compile(ModelInvocationRequestSchema);

const messageRoles = new Set(['SYSTEM', 'USER', 'ASSISTANT', 'TOOL']);
const requestFields = new Set([
  'invocationScope',
  'modelId',
  'contextWindowTokens',
  'messages',
  'tools',
  'temperature',
  'maxOutputTokens',
  'topP',
  'topK',
  'presencePenalty',
  'frequencyPenalty',
  'thinking',
  'toolChoice',
  'providerOptions',
  'modelParams',
  'timeoutMs',
  'maxRetries',
]);
const scopeFields = new Set([
  'tenantId',
  'subjectId',
  'agentId',
  'agentVersion',
  'agentAssemblyRef',
  'operationId',
  'sessionId',
  'requestId',
  'runId',
]);

export function validateModelInvocationPreconditions(request: ModelInvocationRequest, signal: AbortSignal): ModelFinalResult | undefined {
  if (signal.aborted) {
    return failed('MODEL_ABORTED', 'Model invocation was canceled before provider execution.', 'CANCELED');
  }
  if (!isJsonObject(request)) {
    return failed('MODEL_REQUEST_INVALID', 'Model invocation request is invalid.', 'VALIDATION');
  }
  if (Object.keys(request).some((key) => !requestFields.has(key))) {
    return failed('MODEL_REQUEST_INVALID', 'Model invocation request is invalid.', 'VALIDATION');
  }
  if (!isScopeValid(request.invocationScope)) {
    return failed('MODEL_INVOCATION_SCOPE_INVALID', 'Model invocation scope is unavailable.', 'VALIDATION');
  }
  if (!isSafeScalar(request.modelId)) {
    return failed('MODEL_ID_INVALID', 'Selected model identity is invalid.', 'VALIDATION');
  }
  if (!Array.isArray(request.messages)) {
    return failed('MODEL_MESSAGES_INVALID', 'Model invocation messages are invalid.', 'VALIDATION');
  }
  if (request.messages.length === 0) {
    return failed('MODEL_MESSAGES_EMPTY', 'Model invocation requires at least one message.', 'VALIDATION');
  }
  if (!request.messages.every(isModelMessage) || !hasPairedToolResults(request.messages)) {
    return failed('MODEL_MESSAGES_INVALID', 'Model invocation messages are invalid.', 'VALIDATION');
  }
  if (!Array.isArray(request.tools) || !request.tools.every(isToolDescriptor) || !optionsValid(request)) {
    return failed('MODEL_OPTIONS_INVALID', 'Model invocation options are invalid.', 'VALIDATION');
  }
  if (hasToolChoiceCollision(request.providerOptions) || hasToolChoiceCollision(request.modelParams)) {
    return failed('MODEL_PROVIDER_OPTIONS_INVALID', 'Model provider options are invalid.', 'VALIDATION');
  }
  if (request.toolChoice === 'REQUIRED' && request.tools.length === 0) {
    return failed('MODEL_TOOL_CHOICE_REQUIRED_WITHOUT_TOOLS', 'Required tool choice needs at least one available tool.', 'VALIDATION');
  }
  if (!validateModelInvocationRequest(request)) {
    return failed('MODEL_REQUEST_INVALID', 'Model invocation request is invalid.', 'VALIDATION');
  }
  return undefined;
}

function failed(code: string, message: string, category: 'CANCELED' | 'VALIDATION'): ModelFinalResult {
  return { content: '', safeError: createSafeModelError(code, message, category) };
}

function isScopeValid(scope: ModelInvocationRequest['invocationScope']): boolean {
  if (!isJsonObject(scope)) {
    return false;
  }
  const required = [scope.tenantId, scope.subjectId, scope.agentId, scope.agentVersion, scope.agentAssemblyRef, scope.operationId];
  const runCoordinateCount = [scope.sessionId, scope.requestId, scope.runId].filter((value) => value !== undefined).length;
  return (
    Object.keys(scope).every((key) => scopeFields.has(key)) &&
    required.every(isSafeScalar) &&
    (runCoordinateCount === 0 || runCoordinateCount === 3) &&
    (scope.sessionId === undefined || isSafeScalar(scope.sessionId)) &&
    (scope.requestId === undefined || isSafeScalar(scope.requestId)) &&
    (scope.runId === undefined || isSafeScalar(scope.runId))
  );
}

function optionsValid(request: ModelInvocationRequest): boolean {
  return (
    positiveSafeInteger(request.contextWindowTokens) &&
    boundedNumber(request.temperature, 0, 2) &&
    positiveSafeInteger(request.maxOutputTokens) &&
    boundedNumber(request.topP, 0, 1) &&
    positiveSafeInteger(request.topK) &&
    boundedNumber(request.presencePenalty, -2, 2) &&
    boundedNumber(request.frequencyPenalty, -2, 2) &&
    (request.thinking === undefined ||
      (isJsonObject(request.thinking) &&
        (request.thinking.depth === 'OFF' ||
          request.thinking.depth === 'LOW' ||
          request.thinking.depth === 'MEDIUM' ||
          request.thinking.depth === 'HIGH'))) &&
    (request.toolChoice === undefined || request.toolChoice === 'AUTO' || request.toolChoice === 'NONE' || request.toolChoice === 'REQUIRED') &&
    (request.providerOptions === undefined || isJsonObject(request.providerOptions)) &&
    (request.modelParams === undefined || isJsonObject(request.modelParams)) &&
    positiveSafeInteger(request.timeoutMs) &&
    nonNegativeSafeInteger(request.maxRetries)
  );
}

function boundedNumber(value: number | undefined, minimum: number, maximum: number): boolean {
  return value === undefined || (Number.isFinite(value) && value >= minimum && value <= maximum);
}

function positiveSafeInteger(value?: number): boolean {
  return value === undefined || (Number.isSafeInteger(value) && value > 0);
}

function nonNegativeSafeInteger(value?: number): boolean {
  return value === undefined || (Number.isSafeInteger(value) && value >= 0);
}

function hasToolChoiceCollision(value?: JsonObject): boolean {
  return value !== undefined && Object.keys(value).some((key) => key.replace(/[_-]/gu, '').toLowerCase() === 'toolchoice');
}

function isModelMessage(value: unknown): value is ModelMessage {
  if (
    !isJsonObject(value) ||
    typeof value.role !== 'string' ||
    !messageRoles.has(value.role) ||
    !Array.isArray(value.content) ||
    value.content.length === 0
  ) {
    return false;
  }
  return value.content.every((part) => {
    if (!isJsonObject(part) || typeof part.type !== 'string') {
      return false;
    }
    if (part.type === 'text') {
      return value.role !== 'TOOL' && typeof part.text === 'string';
    }
    if (part.type === 'tool-call') {
      return (
        value.role === 'ASSISTANT' &&
        isJsonObject(part.toolCall) &&
        isSafeScalar(part.toolCall.toolCallId) &&
        isSafeScalar(part.toolCall.toolName) &&
        isJsonObject(part.toolCall.arguments)
      );
    }
    return (
      value.role === 'TOOL' &&
      part.type === 'tool-result' &&
      isSafeScalar(part.toolCallId) &&
      isSafeScalar(part.toolName) &&
      isJsonObject(part.output)
    );
  });
}

function hasPairedToolResults(messages: readonly ModelMessage[]): boolean {
  const toolCalls = new Map<string, string>();
  for (const message of messages) {
    for (const part of message.content) {
      if (message.role === 'ASSISTANT' && part.type === 'tool-call') {
        toolCalls.set(part.toolCall.toolCallId, part.toolCall.toolName);
      } else if (message.role === 'TOOL' && part.type === 'tool-result' && toolCalls.get(part.toolCallId) !== part.toolName) {
        return false;
      }
    }
  }
  return true;
}

function isToolDescriptor(value: unknown): value is ModelToolDescriptor {
  return (
    isJsonObject(value) &&
    isSafeScalar(value.capabilityId) &&
    isSafeScalar(value.name) &&
    (value.description === undefined || typeof value.description === 'string') &&
    isJsonObject(value.inputSchema)
  );
}

function isSafeScalar(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 256 && !/[\u0000-\u001F\u007F-\u009F]/u.test(value);
}
