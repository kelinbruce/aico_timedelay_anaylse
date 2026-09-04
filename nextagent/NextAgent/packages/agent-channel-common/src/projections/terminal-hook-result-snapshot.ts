import type { JsonObject, JsonValue } from '@nextagent/agent-common';

const maxTerminalHookResultsBytes = 49_000;

export function readTerminalHookResultSnapshot(payload: JsonObject): JsonObject | undefined {
  const rawResults = payload.hookResults;
  const rawErrorCode = payload.hookResultsErrorCode;
  if ((rawResults === undefined) === (rawErrorCode === undefined)) {
    return undefined;
  }
  if (rawErrorCode !== undefined) {
    return isHookResultsErrorCode(rawErrorCode) ? { hookResultsErrorCode: rawErrorCode } : undefined;
  }
  if (!Array.isArray(rawResults)) {
    return undefined;
  }
  const hookResults: JsonObject[] = [];
  for (const rawEntry of rawResults) {
    const entry = readTerminalHookResultEntry(rawEntry);
    if (entry === undefined) {
      return undefined;
    }
    hookResults.push(entry);
  }
  if (new TextEncoder().encode(JSON.stringify(hookResults)).byteLength > maxTerminalHookResultsBytes) {
    return undefined;
  }
  return { hookResults };
}

function readTerminalHookResultEntry(value: unknown): JsonObject | undefined {
  const entry = readRecord(value);
  if (entry === undefined || Object.keys(entry).some((key) => !(terminalHookResultAllowedKeys as readonly string[]).includes(key))) {
    return undefined;
  }
  const hookInvocationId = readNonBlankString(entry.hookInvocationId);
  const hookId = readNonBlankString(entry.hookId);
  const stage = readString(entry.stage);
  const status = readString(entry.status);
  const failureMode = readString(entry.failureMode);
  if (
    hookInvocationId === undefined ||
    hookId === undefined ||
    stage === undefined ||
    !(terminalHookStages as readonly string[]).includes(stage) ||
    status === undefined ||
    !(terminalHookInvocationStatuses as readonly string[]).includes(status) ||
    failureMode === undefined ||
    !(terminalHookFailureModes as readonly string[]).includes(failureMode)
  ) {
    return undefined;
  }
  if (status !== 'SUCCESS') {
    return entry.outcome === undefined && entry.resultSummary === undefined ? { hookInvocationId, hookId, stage, status, failureMode } : undefined;
  }
  const outcome = readString(entry.outcome);
  if (outcome === undefined || !(terminalHookOutcomes as readonly string[]).includes(outcome)) {
    return undefined;
  }
  const resultSummary = entry.resultSummary;
  if (resultSummary !== undefined && readRecord(resultSummary) === undefined) {
    return undefined;
  }
  return {
    hookInvocationId,
    hookId,
    stage,
    status,
    failureMode,
    outcome,
    ...(resultSummary === undefined ? {} : { resultSummary }),
  };
}

function readRecord(value: unknown): JsonObject | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value) && isJsonValue(value) ? (value as JsonObject) : undefined;
}

function isJsonValue(value: unknown, seen = new WeakSet<object>()): value is JsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return Number.isFinite(value as number) || typeof value !== 'number';
  }
  if (Array.isArray(value)) {
    return value.every((item) => isJsonValue(item, seen));
  }
  if (typeof value !== 'object' || seen.has(value)) {
    return false;
  }
  seen.add(value);
  return Object.values(value).every((item) => isJsonValue(item, seen));
}

function readString(value?: JsonValue): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function readNonBlankString(value?: JsonValue): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function isHookResultsErrorCode(value?: JsonValue): value is 'HOOK_RESULTS_UNAVAILABLE' | 'HOOK_RESULTS_INVALID' | 'HOOK_RESULTS_LIMIT_EXCEEDED' {
  return typeof value === 'string' && (terminalHookResultErrorCodes as readonly string[]).includes(value);
}

const terminalHookStages = [
  'BEFORE_REQUEST_ACCEPT',
  'BEFORE_PLANNING',
  'BEFORE_MODEL_INVOKE',
  'AFTER_MODEL_RESULT',
  'BEFORE_CAPABILITY_INVOKE',
  'AFTER_CAPABILITY_RESULT',
  'BEFORE_CONTEXT_COMPACT',
  'AFTER_CONTEXT_COMPACT',
  'BEFORE_AGENT_TERMINAL',
] as const;
const terminalHookInvocationStatuses = ['SUCCESS', 'TIMEOUT', 'FAILED', 'INVALID_RESULT', 'IGNORED'] as const;
const terminalHookFailureModes = ['CONTINUE', 'FAIL'] as const;
const terminalHookOutcomes = ['PASS', 'SKIP', 'DENY', 'BLOCK', 'PEND'] as const;
const terminalHookResultErrorCodes = ['HOOK_RESULTS_UNAVAILABLE', 'HOOK_RESULTS_INVALID', 'HOOK_RESULTS_LIMIT_EXCEEDED'] as const;
const terminalHookResultAllowedKeys = ['hookInvocationId', 'hookId', 'stage', 'status', 'failureMode', 'outcome', 'resultSummary'] as const;
