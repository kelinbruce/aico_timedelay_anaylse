import type { JsonObject, JsonValue } from '@nextagent/agent-common';

export function stringValues(payload: JsonObject, keys: readonly string[]): readonly string[] {
  return keys.flatMap((key) => (typeof payload[key] === 'string' ? [payload[key] as string] : []));
}

export function arrayStringValues(payload: JsonObject, key: string): readonly string[] {
  const value = payload[key];
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];
}

export function uniqueStrings(values: readonly string[]): readonly string[] {
  return [...new Set(values)].slice(0, 100);
}

export function payloadSummary(refs: JsonObject): JsonObject {
  return isJsonObject(refs.payload) ? { payload: refs.payload } : {};
}

export function detailPayload(payload: JsonObject): JsonObject {
  const result: Record<string, JsonValue> = {};
  for (const key of detailPayloadScalarKeys) {
    const value = payload[key];
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      result[key] = value;
    }
  }
  if ((typeof payload['capabilityId'] === 'string' || typeof payload['capabilityKind'] === 'string') && typeof payload['providerKind'] === 'string') {
    result['providerKind'] = payload['providerKind'];
  }
  for (const key of detailPayloadArrayKeys) {
    const value = payload[key];
    if (Array.isArray(value) && value.every((entry) => typeof entry === 'string')) {
      result[key] = value.slice(0, 100);
    }
  }
  for (const key of detailPayloadObjectKeys) {
    const value = boundedJsonValue(payload[key], 0);
    if (value !== undefined) {
      result[key] = value;
    }
  }
  const contentSummary = rawStringSummary(payload['content']);
  if (contentSummary !== undefined) {
    result['contentSummary'] = contentSummary;
  }
  const reasoningSummary = rawStringSummary(payload['reasoning']);
  if (reasoningSummary !== undefined) {
    result['reasoningSummary'] = reasoningSummary;
  }
  return result;
}

export function safePayloadRefs(payload: JsonObject): JsonObject {
  const refs: Record<string, JsonValue> = {};
  for (const key of [
    'modelId',
    'finishReason',
    'toolCallCount',
    'capabilityId',
    'toolCallId',
    'safeErrorCode',
    'safeErrorCategory',
    'capabilityKind',
    'providerId',
    'version',
    'toolName',
    'stepId',
    'toolBatchExecutionMode',
    'toolBatchOrdinal',
    'toolBatchSize',
    'timeoutMs',
    'argumentSizeBucket',
    'generatedMessageCount',
    'artifactCount',
    'resultRefPresent',
    'fallbackTriggered',
  ]) {
    const value = payload[key];
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      refs[key] = value;
    }
  }
  if ((typeof payload['capabilityId'] === 'string' || typeof payload['capabilityKind'] === 'string') && typeof payload['providerKind'] === 'string') {
    refs['providerKind'] = payload['providerKind'];
  }
  for (const key of ['usage', 'modelOptionSummary', 'contextPatchSummary', 'safeResultSummary', 'contextBudgetEvidence']) {
    const value = payload[key];
    if (isJsonObject(value)) {
      refs[key] = value;
    }
  }
  for (const key of [
    'providerOptionKeys',
    'argumentKeys',
    'disclosedCapabilityIds',
    'visibleCapabilityIds',
    'renderedToolNames',
    'selectedMessageRefs',
  ]) {
    const value = payload[key];
    if (Array.isArray(value) && value.every((entry) => typeof entry === 'string')) {
      refs[key] = value.slice(0, 100);
    }
  }
  return refs;
}

export function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function boundedSingleLine(value: string, maxLength: number): string {
  const singleLine = value.replace(/\s+/gu, ' ').trim();
  return singleLine.length <= maxLength ? singleLine : `${singleLine.slice(0, maxLength - 3)}...`;
}

function rawStringSummary(value: unknown): JsonObject | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  return {
    charCount: value.length,
    redacted: true,
    reasonCode: 'RAW_CONTENT_NOT_EXPOSED',
  };
}

function boundedJsonValue(value: unknown, depth: number): JsonValue | undefined {
  if (typeof value === 'string') {
    return value.length <= 2000 ? value : `${value.slice(0, 2000)}...`;
  }
  if (typeof value === 'number' || typeof value === 'boolean' || value === null) {
    return value;
  }
  if (Array.isArray(value)) {
    return value.slice(0, 100).flatMap((entry): readonly JsonValue[] => {
      const item = boundedJsonValue(entry, depth + 1);
      return item === undefined ? [] : [item];
    });
  }
  if (!isJsonObject(value) || depth >= 4) {
    return undefined;
  }
  const result: Record<string, JsonValue> = {};
  for (const [key, entry] of Object.entries(value).slice(0, 80)) {
    if (forbiddenDetailPayloadKey.test(key)) {
      continue;
    }
    const item = boundedJsonValue(entry, depth + 1);
    if (item !== undefined) {
      result[key] = item;
    }
  }
  return result;
}

const detailPayloadScalarKeys = [
  'attempt',
  'agentId',
  'agentVersion',
  'status',
  'agentAssemblyHash',
  'agentAssemblySnapshotRef',
  'laneKind',
  'queueDepthBucket',
  'schedulerDecisionCode',
  'stepId',
  'modelId',
  'modelMessageCount',
  'promptTemplateRef',
  'promptTemplateVersion',
  'finishReason',
  'toolCallCount',
  'capabilityId',
  'toolCallId',
  'safeErrorCode',
  'safeErrorCategory',
  'capabilityKind',
  'providerId',
  'version',
  'toolName',
  'timeoutMs',
  'argumentSizeBucket',
  'generatedMessageCount',
  'artifactCount',
  'resultRefPresent',
  'fallbackTriggered',
  'hookInvocationId',
  'hookId',
  'stage',
  'kind',
  'executionStrategy',
  'durationMs',
  'outcome',
  'idempotencyKey',
  'policyId',
  'policyVersion',
  'policyDomain',
  'policyPoint',
  'operation',
  'riskLevel',
  'riskDomain',
  'strategyCode',
  'beforeTokenEstimateBucket',
  'afterTokenEstimateBucket',
  'retainedMessageCount',
  'droppedMessageCount',
  'summaryMessageId',
  'terminalMessageId',
  'final',
  'reasonCode',
  'effectiveViewStatus',
] as const;

const detailPayloadArrayKeys = [
  'providerOptionKeys',
  'selectedMessageRefs',
  'disclosedCapabilityIds',
  'visibleCapabilityIds',
  'renderedToolNames',
  'argumentKeys',
  'degradationReasonCodes',
] as const;

const detailPayloadObjectKeys = [
  'modelOptionSummary',
  'usage',
  'budgetEvidence',
  'contextBudgetEvidence',
  'compressionEvidence',
  'contextPatchSummary',
  'effects',
  'safeResultSummary',
  'gatewayOperations',
] as const;

const forbiddenDetailPayloadKey = /raw|credential|secret|token|password|path|url|endpoint|host|body|content|promptText|modelOutput|providerBody/u;
