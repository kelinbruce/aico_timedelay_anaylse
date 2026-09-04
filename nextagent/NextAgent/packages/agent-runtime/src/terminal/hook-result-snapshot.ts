import { brand, type JsonObject, type JsonValue } from '@nextagent/agent-common';
import type { RunTimelineEventRecord, RunTimelineEventRecordQuery, RunTimelineEventStoreGateway } from '@nextagent/agent-contracts/gateway';
import {
  runtimeLifecycleStages,
  type HookFailureMode,
  type HookInvocationStatus,
  type HookOutcome,
  type LifecycleStage,
} from '@nextagent/agent-contracts/runtime';
import { maxTimelineInlinePayloadBytes } from '../timeline/runtime-payload.js';

const hookResultSnapshotPageSize = 1_000;
const hookResultSnapshotReadTimeoutMs = 5_000;

const hookInvocationStatuses = ['SUCCESS', 'TIMEOUT', 'FAILED', 'INVALID_RESULT', 'IGNORED'] as const satisfies readonly HookInvocationStatus[];
const hookFailureModes = ['CONTINUE', 'FAIL'] as const satisfies readonly HookFailureMode[];
const hookOutcomes = ['PASS', 'SKIP', 'DENY', 'BLOCK', 'PEND'] as const satisfies readonly HookOutcome[];

export type HookResultsErrorCode = 'HOOK_RESULTS_UNAVAILABLE' | 'HOOK_RESULTS_INVALID' | 'HOOK_RESULTS_LIMIT_EXCEEDED';

export type TerminalHookResultSnapshot =
  | { readonly hookResults: readonly JsonObject[]; readonly hookResultsErrorCode?: never }
  | { readonly hookResults?: never; readonly hookResultsErrorCode: HookResultsErrorCode };

type TerminalHookResultSnapshotScope = Required<
  Pick<RunTimelineEventRecordQuery, 'tenantId' | 'subjectId' | 'agentId' | 'sessionId' | 'requestId' | 'runId'>
>;

export async function buildTerminalHookResultSnapshot(
  timelineStore: RunTimelineEventStoreGateway,
  scope: TerminalHookResultSnapshotScope,
): Promise<TerminalHookResultSnapshot> {
  const hookResults: JsonObject[] = [];
  let hookResultsBytes = 2;
  let limitExceeded = false;
  let afterSequence = brand<number, 'TimelineSequence'>(0);
  try {
    while (true) {
      const page = await readTimelinePageWithTimeout(timelineStore, {
        ...scope,
        afterSequence,
        limit: hookResultSnapshotPageSize,
        recordOrigin: 'RUNTIME',
      });
      validateTimelinePage(page, scope, afterSequence);
      for (const record of page) {
        if (record.type !== 'HOOK_INVOKED') {
          continue;
        }
        const entry = projectHookResultEntry(record.inlinePayload);
        if (entry === undefined) {
          return { hookResultsErrorCode: 'HOOK_RESULTS_INVALID' };
        }
        if (!limitExceeded) {
          const entryBytes = Buffer.byteLength(JSON.stringify(entry), 'utf8');
          const nextBytes = hookResultsBytes + entryBytes + (hookResults.length === 0 ? 0 : 1);
          if (nextBytes > maxTimelineInlinePayloadBytes) {
            limitExceeded = true;
            hookResults.length = 0;
          } else {
            hookResults.push(entry);
            hookResultsBytes = nextBytes;
          }
        }
      }
      if (page.length < hookResultSnapshotPageSize) {
        break;
      }
      afterSequence = page[page.length - 1]!.sequence;
    }
  } catch {
    return { hookResultsErrorCode: 'HOOK_RESULTS_UNAVAILABLE' };
  }
  if (limitExceeded) {
    return { hookResultsErrorCode: 'HOOK_RESULTS_LIMIT_EXCEEDED' };
  }
  return { hookResults };
}

function validateTimelinePage(
  page: readonly RunTimelineEventRecord[],
  scope: TerminalHookResultSnapshotScope,
  afterSequence: RunTimelineEventRecordQuery['afterSequence'],
): void {
  if (page.length > hookResultSnapshotPageSize) {
    throw new Error('Hook result snapshot timeline page exceeded the requested limit.');
  }
  let previousSequence = Number(afterSequence);
  for (const record of page) {
    const sequence = Number(record.sequence);
    if (!Number.isSafeInteger(sequence) || sequence <= previousSequence) {
      throw new Error('Hook result snapshot timeline did not advance.');
    }
    if (!matchesSnapshotScope(record, scope)) {
      throw new Error('Hook result snapshot timeline returned an out-of-scope fact.');
    }
    previousSequence = sequence;
  }
}

function matchesSnapshotScope(record: RunTimelineEventRecord, scope: TerminalHookResultSnapshotScope): boolean {
  return (
    record.recordOrigin === undefined &&
    record.tenantId === scope.tenantId &&
    record.subjectId === scope.subjectId &&
    record.agentId === scope.agentId &&
    record.sessionId === scope.sessionId &&
    record.requestId === scope.requestId &&
    record.runId === scope.runId
  );
}

async function readTimelinePageWithTimeout(
  timelineStore: RunTimelineEventStoreGateway,
  query: Parameters<RunTimelineEventStoreGateway['listEvents']>[0],
): Promise<readonly RunTimelineEventRecord[]> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeoutPromise = new Promise<never>((_resolve, reject) => {
      timeout = setTimeout(() => reject(new Error('Hook result snapshot timeline read timed out.')), hookResultSnapshotReadTimeoutMs);
    });
    return await Promise.race([timelineStore.listEvents(query), timeoutPromise]);
  } finally {
    if (timeout !== undefined) {
      clearTimeout(timeout);
    }
  }
}

function projectHookResultEntry(payload: JsonObject): JsonObject | undefined {
  const hookInvocationId = readNonEmptyString(payload.hookInvocationId);
  const hookId = readNonEmptyString(payload.hookId);
  const stage = readLifecycleStage(payload.stage);
  const status = readHookInvocationStatus(payload.status);
  const failureMode = readHookFailureMode(payload.failureMode);
  if (hookInvocationId === undefined || hookId === undefined || stage === undefined || status === undefined || failureMode === undefined) {
    return undefined;
  }

  if (status !== 'SUCCESS') {
    if (payload.outcome !== undefined || payload.resultSummary !== undefined) {
      return undefined;
    }
    return { hookInvocationId, hookId, stage, status, failureMode };
  }

  const outcome = readHookOutcome(payload.outcome);
  if (outcome === undefined) {
    return undefined;
  }
  const resultSummary = payload.resultSummary;
  if (resultSummary !== undefined && !isJsonObject(resultSummary)) {
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

function readNonEmptyString(value?: JsonValue): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function readLifecycleStage(value?: JsonValue): LifecycleStage | undefined {
  return typeof value === 'string' && runtimeLifecycleStages.includes(value as LifecycleStage) ? (value as LifecycleStage) : undefined;
}

function readHookInvocationStatus(value?: JsonValue): HookInvocationStatus | undefined {
  return typeof value === 'string' && hookInvocationStatuses.includes(value as HookInvocationStatus) ? (value as HookInvocationStatus) : undefined;
}

function readHookFailureMode(value?: JsonValue): HookFailureMode | undefined {
  return typeof value === 'string' && hookFailureModes.includes(value as HookFailureMode) ? (value as HookFailureMode) : undefined;
}

function readHookOutcome(value?: JsonValue): HookOutcome | undefined {
  return typeof value === 'string' && hookOutcomes.includes(value as HookOutcome) ? (value as HookOutcome) : undefined;
}

function isJsonObject(value: JsonValue): value is JsonObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
