import type { TFunction } from 'i18next';
import type { StreamContentType, StreamEnvelope, StreamEventType, TurnBlock, WireTimestamp } from '../../../state/contracts.ts';
import { toTimestampMillis } from '../../../utils/time.ts';
import { readSafeCapabilityResult, type SafeCapabilityResult } from '../utils/safeCapabilityResult.ts';
import { redactSensitiveDisplayText } from '../../../utils/redactSensitiveDisplayText.ts';
import { resolveSafeFailurePresentation, resolveSafeSummaryPresentation } from '../utils/safeSummaryPresentation.ts';
import { readFailureErrorCategoryFromPayload, readFailureErrorCodeFromPayload } from '../utils/failureDetails.ts';
import {
  isCompletedProcessContentEvent,
  isResultStreamEvent,
  mergeStreamText,
  readCompletedProcessContentStepId,
  readPendingProcessContentStepId,
  readPayloadBooleanFlag,
  readStreamText,
  readWorkflowOccurrenceCorrelationId,
  reconcileWorkflowProductFragments,
  isWorkflowProcessEvent,
} from '../utils/streamTextSemantics.ts';
import { buildInputSegmentByEnvelope, getEnvelopeAttemptId, getEnvelopeRootMessageId, getEnvelopeRunId } from '../utils/streamingHelpers.ts';
import { type ToolMessageType, type AnswerSegment, validToolMessageTypes } from '../presentation/answerContent.ts';
import { buildComposedActivityOrderByEnvelope } from '../presentation/presentationOrder.ts';
import {
  EMPTY_CAPABILITY_PRESENTATION_RESOURCES,
  resolveCapabilityProcessTitle,
  type CapabilityPresentationResourceMap,
} from './capabilityProcessTitle.ts';
import { resolveSystemEventPresentation, type GovernedSystemEventType, type SystemEventPresentation } from './systemEventPresentation.ts';

function structuredDetailPayload(payload: unknown): Record<string, unknown> {
  const record = (typeof payload === 'object' && payload !== null ? payload : {}) as Record<string, unknown>;
  const hasFlag = readPayloadBooleanFlag(record, 'accumulated') !== null;
  return hasFlag ? record : { ...record, metadata: { accumulated: false } };
}

const LONG_PROCESS_DETAIL_MIN_LENGTH = 280;
const LONG_PROCESS_DETAIL_MIN_LINES = 6;
const ragDetailTextMaxChars = 512;
const TERMINAL_EVENTS = new Set<StreamEventType>([
  'REQUEST_COMPLETED',
  'REQUEST_FAILED',
  'REQUEST_CANCELED',
  'REQUEST_SUPERSEDED',
  'OUTPUT_GUARD_BLOCKED',
]);

export interface ProcessEntry {
  readonly key: string;
  readonly title: string;
  readonly summary?: string | undefined;
  readonly detail: string;
  readonly rawDetail?: string | undefined;
  readonly contentType?: StreamContentType | null | undefined;
  readonly toolName: string | null;
  readonly kind?: 'thinking' | 'tool' | 'system' | 'process-explanation' | undefined;
  readonly isFinal?: boolean | undefined;
  readonly isExpandable?: boolean | undefined;
  readonly isFailure?: boolean | undefined;
  readonly severity?: SystemEventPresentation['severity'] | undefined;
  readonly sequence?: number | undefined;
  readonly lastSequence?: number | undefined;
  readonly lastPresentationOrder?: number | undefined;
  readonly createdAt?: WireTimestamp | null | undefined;
  readonly toolEventType?: string | null | undefined;
  readonly expandPanelData?: { readonly toolMessageType: ToolMessageType; readonly content: unknown } | undefined;
  readonly hasExpandPanel?: boolean | undefined;
  readonly structuredSegments?: readonly AnswerSegment[] | undefined;
  readonly structuredSections?: readonly ProcessStructuredSection[] | undefined;
  readonly ragRetrievalItems?: readonly RagRetrievalDisplayItem[] | undefined;
  readonly toolCallId?: string | undefined;
  readonly parentToolCallId?: string | undefined;
  readonly presentation?: 'governed-system-event' | undefined;
}

export interface ProcessStructuredSection {
  readonly key: string;
  readonly title: string;
  readonly detail: string;
  readonly rawDetail?: string | undefined;
  readonly contentType?: StreamContentType | null | undefined;
  readonly sequence: number;
  readonly lastSequence: number;
  readonly lastPresentationOrder: number;
  readonly toolEventType?: string | null | undefined;
  readonly structuredSegments?: readonly AnswerSegment[] | undefined;
  readonly expandPanelData?: { readonly toolMessageType: ToolMessageType; readonly content: unknown } | undefined;
  readonly hasExpandPanel?: boolean | undefined;
}

export interface RagRetrievalDisplayItem {
  readonly displaySource: string;
  readonly content: string;
}

interface ToolProcessEntry {
  readonly key: string;
  readonly toolName: string;
  readonly processTitle?: string | undefined;
  readonly statusLabel?: string | undefined;
  readonly statusFromSafeResult?: boolean | undefined;
  readonly summary?: string | undefined;
  readonly detail: string;
  readonly rawDetail?: string | undefined;
  readonly contentType?: StreamContentType | null | undefined;
  readonly isFinal: boolean;
  readonly isExpandable?: boolean | undefined;
  readonly isFailure?: boolean | undefined;
  readonly detailFromSafeResult?: boolean | undefined;
  readonly ragRetrievalItems?: readonly RagRetrievalDisplayItem[] | undefined;
  readonly resultFromCapabilityDelta?: boolean | undefined;
  readonly stateRank: number;
  readonly firstSequence: number;
  readonly firstCreatedAt: WireTimestamp | null;
  readonly lastSequence: number;
  readonly lastPresentationOrder: number;
  readonly parentToolCallId?: string | undefined;
}

export interface ProcessDisplayEntry {
  readonly key: string;
  readonly title: string;
  readonly toolName?: string | null | undefined;
  readonly summary: string;
  readonly detail: string;
  readonly contentType?: StreamContentType | null | undefined;
  readonly kind?: ProcessEntry['kind'] | undefined;
  readonly isFinal?: boolean | undefined;
  readonly lastSequence?: number | undefined;
  readonly lastPresentationOrder?: number | undefined;
  readonly isExpandable: boolean;
  readonly isFailure?: boolean | undefined;
  readonly severity?: SystemEventPresentation['severity'] | undefined;
  readonly toolEventType?: string | null | undefined;
  readonly expandPanelData?: { readonly toolMessageType: ToolMessageType; readonly content: unknown } | undefined;
  readonly hasExpandPanel?: boolean | undefined;
  readonly structuredSegments?: readonly AnswerSegment[] | undefined;
  readonly structuredSections?: readonly ProcessStructuredSection[] | undefined;
  readonly ragRetrievalItems?: readonly RagRetrievalDisplayItem[] | undefined;
  readonly toolCallId?: string | undefined;
  readonly parentToolCallId?: string | undefined;
  readonly presentation?: 'governed-system-event' | undefined;
}

export interface ProcessTimelineEntry {
  readonly key: string;
  readonly title: string;
  readonly detail: string;
  readonly kind: 'thinking' | 'tool' | 'system' | 'terminal';
  readonly sequence: number;
  readonly createdAt: WireTimestamp | null;
  readonly sourceEventType?: StreamEventType | undefined;
  readonly correlationId?: string | null | undefined;
  readonly statusLabel?: string | null | undefined;
  readonly content?: string | null | undefined;
  readonly contentType?: StreamContentType | null | undefined;
  readonly toolEventType?: string | null | undefined;
}

interface ActiveCapabilityTimelineEntry extends ProcessTimelineEntry {
  readonly correlationId: string;
  readonly content: string;
  readonly contentType: StreamContentType;
}

export type ExecutionDetailsPhase = 'running' | 'settling' | 'settled';

function readPayloadContentType(payload: Record<string, unknown>): StreamContentType | null {
  const contentType = payload.contentType;
  if (typeof contentType !== 'string' || contentType.trim().length === 0) {
    return null;
  }
  return contentType as StreamContentType;
}

function readProcessText(event: StreamEnvelope): string {
  const text = readStreamText(event, undefined, {
    allowWhitespaceOnly: isResultStreamEvent(event),
  });
  if (
    (event.eventType === 'CAPABILITY_STARTED' || event.eventType === 'CAPABILITY_RESULT_DELTA' || event.eventType === 'CAPABILITY_COMPLETED') &&
    isInternalCapabilityProcessText(text)
  ) {
    return '';
  }
  return text;
}

function isInternalCapabilityProcessText(text: string): boolean {
  const normalized = text.trim();
  return (
    normalized === 'CAPABILITY_STARTED' ||
    normalized === 'CAPABILITY_RESULT_DELTA' ||
    normalized === 'CAPABILITY_COMPLETED' ||
    normalized === 'Capability started' ||
    normalized === 'Capability completed' ||
    normalized === 'RUNNING' ||
    normalized === 'SUCCEEDED' ||
    normalized === 'FAILED' ||
    normalized === 'ERROR' ||
    normalized === 'TIMED_OUT' ||
    normalized === 'CANCELED' ||
    /^CAPABILITY_RESULT_[A-Z0-9_]+$/u.test(normalized)
  );
}

function buildThinkingEntryKey(event: StreamEnvelope, segmentIndex: number): string {
  return `thinking:${getEnvelopeRootMessageId(event)}:${getEnvelopeAttemptId(event)}:segment:${segmentIndex}`;
}

function readToolName(event: StreamEnvelope): string | null {
  const payload = event.payload as Record<string, unknown>;
  const metadata =
    payload.metadata && typeof payload.metadata === 'object' && !Array.isArray(payload.metadata)
      ? (payload.metadata as Record<string, unknown>)
      : null;
  const toolName = payload.toolName ?? payload.capabilityName ?? metadata?.toolName ?? metadata?.capabilityName ?? payload.capabilityId;
  return typeof toolName === 'string' && toolName.trim().length > 0 ? toolName : null;
}

function readCapabilityTitleIdentity(event: StreamEnvelope): Record<string, unknown> {
  const payload = event.payload as Record<string, unknown>;
  if (typeof payload.capabilityId === 'string' && payload.capabilityId.trim().length > 0) {
    return payload;
  }
  const legacyToolName = readToolName(event);
  return legacyToolName === null ? payload : { ...payload, capabilityId: legacyToolName };
}

function displayToolName(toolName: string): string {
  return toolName === 'Skill' ? 'SKILL' : toolName;
}

const capabilityTargetNamePattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;

function readCapabilityTargetName(event: StreamEnvelope): string | null {
  const toolName = readToolName(event);
  if (toolName !== 'Skill' && toolName !== 'Agent' && toolName !== 'ApiCall') {
    return null;
  }
  const value = (event.payload as Record<string, unknown>).capabilityTargetName;
  const targetName = typeof value === 'string' ? value.trim() : '';
  return capabilityTargetNamePattern.test(targetName) ? targetName : null;
}

function displayCapabilityName(event: StreamEnvelope, fallbackToolName: string): string {
  const toolName = displayToolName(readToolName(event) ?? fallbackToolName);
  const targetName = readCapabilityTargetName(event);
  return targetName === null ? toolName : `${toolName} · ${targetName}`;
}

function isSkillToolName(toolName: string | null): boolean {
  return toolName === 'Skill' || toolName === 'SKILL';
}

function readSkillName(event: StreamEnvelope, toolName: string | null): string | null {
  if (!isSkillToolName(toolName)) {
    return null;
  }
  const payload = event.payload as Record<string, unknown>;
  const skillName = readPayloadString(payload, 'skillName');
  return skillName && /^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(skillName) && skillName.length <= 64 ? skillName : null;
}

function readNamedPayloadText(event: StreamEnvelope, fields: readonly string[]): string {
  const payload = event.payload as Record<string, unknown>;
  for (const field of fields) {
    const value = payload[field];
    if (typeof value === 'string' && value.trim().length > 0) {
      return value;
    }
  }
  return '';
}

function readExplicitToolCorrelationId(event: StreamEnvelope): string | null {
  const workflowOccurrenceId = readWorkflowOccurrenceCorrelationId(event);
  if (workflowOccurrenceId !== null) {
    return workflowOccurrenceId;
  }
  const payload = event.payload as Record<string, unknown>;
  const metadata =
    payload.metadata && typeof payload.metadata === 'object' && !Array.isArray(payload.metadata)
      ? (payload.metadata as Record<string, unknown>)
      : null;
  const candidates = [payload.toolCallId, payload.invocationId, metadata?.invocationId, payload.capabilityId];
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim().length > 0) {
      return candidate.trim();
    }
  }
  return null;
}

function readToolCorrelationId(event: StreamEnvelope): string {
  return readExplicitToolCorrelationId(event) ?? event.eventId;
}

function readPayloadString(payload: Record<string, unknown>, key: string): string | null {
  const value = payload[key];
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function isAskUserQuestionCapabilityEvent(event: StreamEnvelope): boolean {
  if (readPayloadString(event.payload as Record<string, unknown>, 'capabilityId') === 'AskUserQuestion') {
    return true;
  }
  return readToolName(event) === 'AskUserQuestion';
}

type WorkflowLifecyclePresentation = 'hidden' | 'titled-terminal' | null;

function resolveWorkflowLifecyclePresentation(event: StreamEnvelope): WorkflowLifecyclePresentation {
  if ((event.eventType !== 'CAPABILITY_STARTED' && event.eventType !== 'CAPABILITY_COMPLETED') || !isWorkflowProcessEvent(event)) {
    return null;
  }
  const payload = event.payload as Record<string, unknown>;
  const capabilityKind = readPayloadString(payload, 'capabilityKind');
  if (capabilityKind === 'TOOL' || capabilityKind === 'SKILL' || capabilityKind === 'AGENT' || capabilityKind === 'WORKFLOW') {
    return null;
  }
  const status = readPayloadString(payload, 'status')?.toUpperCase();
  return event.eventType === 'CAPABILITY_COMPLETED' && (status === 'SUCCEEDED' || status === 'FAILED' || status === 'TIMED_OUT')
    ? 'titled-terminal'
    : 'hidden';
}

function readParentToolCallId(event: StreamEnvelope): string | undefined {
  return readPayloadString(event.payload as Record<string, unknown>, 'parentToolCallId') ?? undefined;
}

function readEventString(event: StreamEnvelope, payload: Record<string, unknown>, key: 'requestContextId' | 'runId' | 'requestId'): string | null {
  const eventValue = event[key];
  if (typeof eventValue === 'string' && eventValue.trim().length > 0) {
    return eventValue.trim();
  }
  return readPayloadString(payload, key);
}

function readToolCallIndex(payload: Record<string, unknown>): string | null {
  const value = payload.toolCallIndex;
  if (typeof value === 'number' && Number.isInteger(value) && value >= 0) {
    return String(value);
  }
  if (typeof value === 'string' && /^\d+$/.test(value.trim())) {
    return value.trim();
  }
  return null;
}

function hasCapabilityExecutionIdentity(payload: Record<string, unknown>): boolean {
  return Boolean(
    readPayloadString(payload, 'capabilityId') ?? readPayloadString(payload, 'invocationId') ?? readPayloadString(payload, 'contentRef'),
  );
}

function isModelToolArgumentDelta(event: StreamEnvelope): boolean {
  if (event.eventType !== 'CAPABILITY_RESULT_DELTA') {
    return false;
  }
  const payload = event.payload as Record<string, unknown>;
  return readToolCallIndex(payload) !== null && !hasCapabilityExecutionIdentity(payload);
}

function readToolArgumentBaseScope(event: StreamEnvelope, payload: Record<string, unknown>): string {
  const requestContextId = readEventString(event, payload, 'requestContextId');
  const runId = readEventString(event, payload, 'runId');
  const requestId = readEventString(event, payload, 'requestId') ?? event.requestId;
  return `${requestContextId ?? requestId}:${runId ?? 'run'}`;
}

function readToolArgumentScope(event: StreamEnvelope): string | null {
  const payload = event.payload as Record<string, unknown>;
  const toolCallIndex = readToolCallIndex(payload);
  if (toolCallIndex === null) {
    return null;
  }
  return `${readToolArgumentBaseScope(event, payload)}:tool-index:${toolCallIndex}`;
}

function resolveToolArgumentCorrelationId(event: StreamEnvelope, pendingToolArgumentKeys: Map<string, string>): string {
  const payload = event.payload as Record<string, unknown>;
  const scope = readToolArgumentScope(event);
  const declaredToolCallId = readPayloadString(payload, 'toolCallId');
  if (scope && declaredToolCallId) {
    const key = `tool-args:${declaredToolCallId}`;
    pendingToolArgumentKeys.set(scope, key);
    return key;
  }
  if (scope) {
    return pendingToolArgumentKeys.get(scope) ?? `tool-args:${scope}`;
  }
  return `tool-args:${event.eventId}`;
}

function isToolCallStreamCompletion(event: StreamEnvelope): boolean {
  if (event.eventType !== 'LLM_CONTENT_DELTA') {
    return false;
  }
  const payload = event.payload as Record<string, unknown>;
  return payload.complete === true && readPayloadString(payload, 'finishReason') === 'tool_calls';
}

function clearPendingToolArgumentKeys(event: StreamEnvelope, pendingToolArgumentKeys: Map<string, string>): void {
  const payload = event.payload as Record<string, unknown>;
  const scopePrefix = `${readToolArgumentBaseScope(event, payload)}:tool-index:`;
  for (const scope of pendingToolArgumentKeys.keys()) {
    if (scope.startsWith(scopePrefix)) {
      pendingToolArgumentKeys.delete(scope);
    }
  }
}

function isHistoricalCapabilityResult(event: StreamEnvelope): boolean {
  return event.transportHints.includes('history-load') && (event.payload as Record<string, unknown>).role === 'CAPABILITY_RESULT';
}

interface GenericToolResultDetail {
  readonly summary: string;
  readonly detail: string;
  readonly statusLabel?: string | undefined;
  readonly isExpandable?: boolean | undefined;
  readonly isFailure?: boolean | undefined;
  readonly detailFromSafeResult?: boolean | undefined;
  readonly ragRetrievalItems?: readonly RagRetrievalDisplayItem[] | undefined;
}

interface SafeErrorLine {
  readonly code: string;
  readonly message: string;
}

function labelInvocationStatus(status: string | null, t: TFunction): string | null {
  if (!status) {
    return null;
  }
  const normalized = status.trim().toUpperCase();
  if (normalized === 'SUCCEEDED' || normalized === 'COMPLETED' || normalized === 'SUCCESS') {
    return t('turn.process.invocationSucceeded');
  }
  if (normalized === 'FAILED' || normalized === 'ERROR') {
    return t('turn.process.failed');
  }
  if (normalized === 'TIMED_OUT' || normalized === 'TIMEOUT') {
    return t('turn.process.timeout');
  }
  if (normalized === 'CANCELED' || normalized === 'CANCELLED') {
    return t('turn.process.canceled');
  }
  return status.trim();
}

function labelResultSummaryStatus(invocationStatus: string | null, t: TFunction): string | null {
  const normalizedInvocationStatus = invocationStatus?.trim().toUpperCase() ?? '';
  if (normalizedInvocationStatus === 'SUCCEEDED' || normalizedInvocationStatus === 'COMPLETED' || normalizedInvocationStatus === 'SUCCESS') {
    return t('turn.process.completed');
  }
  if (normalizedInvocationStatus === 'FAILED' || normalizedInvocationStatus === 'ERROR') {
    return t('turn.process.failed');
  }
  if (normalizedInvocationStatus === 'TIMED_OUT' || normalizedInvocationStatus === 'TIMEOUT') {
    return t('turn.process.timeout');
  }
  if (normalizedInvocationStatus === 'CANCELED' || normalizedInvocationStatus === 'CANCELLED') {
    return t('turn.process.canceled');
  }
  return null;
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function isGenericCapabilityResultText(text: string): boolean {
  const normalized = normalizeStatusText(text);
  return normalized.length === 0 || normalized === 'capability result is available.' || normalized === 'tool output is ready';
}

function resolveResultInvocationStatus(event: StreamEnvelope, t: TFunction): string | null {
  const payload = event.payload as Record<string, unknown>;
  const invocationStatus = labelInvocationStatus(readPayloadString(payload, 'status'), t);
  if (invocationStatus) {
    return invocationStatus;
  }
  return isHistoricalCapabilityResult(event) ? t('turn.process.invocationSucceeded') : null;
}

function resolveToolLifecycleStatus(event: StreamEnvelope, t: TFunction): string | null {
  if (event.eventType === 'CAPABILITY_STARTED') {
    return t('turn.process.running');
  }
  if (event.eventType === 'CAPABILITY_RESULT_DELTA' && !isHistoricalCapabilityResult(event)) {
    return t('turn.process.resultReturned');
  }
  const payload = event.payload as Record<string, unknown>;
  return (
    labelResultSummaryStatus(readPayloadString(payload, 'status'), t) ??
    (isHistoricalCapabilityResult(event) || event.eventType === 'CAPABILITY_COMPLETED' ? t('turn.process.completed') : null)
  );
}

function formatToolProcessTitle(toolName: string, statusLabel?: string | null): string {
  return statusLabel ? `${toolName} · ${statusLabel}` : toolName;
}

function parseSafeErrorLine(text: string): SafeErrorLine | null {
  const trimmed = text.trim();
  if (!trimmed) {
    return null;
  }
  const [firstLine = '', ...restLines] = trimmed.split(/\r?\n/u);
  const match = /^([A-Z][A-Z0-9_]{1,63}):\s+(.+)$/u.exec(firstLine.trim());
  if (!match) {
    return null;
  }
  return {
    code: match[1]!,
    message: [match[2]!, ...restLines].join('\n').trim(),
  };
}

function formatStderrDetail(message: string, t: TFunction): string {
  const trimmed = message.trim();
  return /\r?\n/u.test(trimmed)
    ? t('turn.process.stderrDetailBlock', { message: trimmed })
    : t('turn.process.stderrDetailInline', { message: trimmed });
}

function describeSafeCapabilityResult(event: StreamEnvelope, t: TFunction, omitCommandStdout = false): GenericToolResultDetail | null {
  const payload = event.payload as Record<string, unknown>;
  const safeResult = readSafeCapabilityResult(payload.safeResult);
  if (!safeResult) {
    return null;
  }

  switch (safeResult.kind) {
    case 'todoList':
      return describeTodoListSafeResult(safeResult, t);
    case 'commandOutput':
      return describeCommandOutputSafeResult(safeResult, payload.capabilityId === 'Python', t, omitCommandStdout);
    case 'fileRead':
      return describeFileReadSafeResult(safeResult, t);
    case 'fileList':
      return describeFileListSafeResult(safeResult, t);
    case 'grepResult':
      return describeGrepSafeResult(safeResult, t);
    case 'fileWrite':
      return {
        summary: t(safeResult.operation === 'create' ? 'turn.process.fileCreatedSummary' : 'turn.process.fileUpdatedSummary', {
          filePath: safeResult.filePath,
        }),
        detail: t('turn.process.fileWithPath', { filePath: safeResult.filePath }),
        isExpandable: false,
        detailFromSafeResult: true,
      };
    case 'skillLoaded':
      return {
        summary: t('turn.process.skillLoadedSummary', { skillName: safeResult.name }),
        detail: t('turn.process.skillLoadedSummary', { skillName: safeResult.name }),
        isExpandable: false,
        detailFromSafeResult: true,
      };
    case 'workflowResult':
      return describeWorkflowResultSafeResult(safeResult, t);
    case 'ragRetrieval':
      return describeRagRetrievalSafeResult(safeResult, t);
    case 'toolSearch':
      return describeToolSearchSafeResult(safeResult, t);
    case 'cron':
      return describeCronSafeResult(safeResult, t);
    default:
      return null;
  }
}

function describeTodoListSafeResult(safeResult: Extract<SafeCapabilityResult, { kind: 'todoList' }>, t: TFunction): GenericToolResultDetail {
  if (safeResult.todos.length === 0) {
    return {
      summary: t('turn.process.todoListClearSummary'),
      detail: t('turn.process.todoListClearSummary'),
      isExpandable: false,
      detailFromSafeResult: true,
    };
  }

  const detail = safeResult.todos
    .map((todo, index) => `${index + 1}. [${formatTodoStatus(todo.status, t)}] ${todo.content}\n   ${todo.activeForm}`)
    .join('\n');
  return {
    summary: t('turn.process.todoListSummary', { count: safeResult.todos.length }),
    detail,
    isExpandable: true,
    detailFromSafeResult: true,
  };
}

function formatTodoStatus(status: Extract<SafeCapabilityResult, { kind: 'todoList' }>['todos'][number]['status'], t: TFunction): string {
  switch (status) {
    case 'pending':
      return t('turn.process.todoStatusPending');
    case 'in_progress':
      return t('turn.process.todoStatusInProgress');
    case 'completed':
      return t('turn.process.todoStatusCompleted');
    default:
      return status;
  }
}

function describeCommandOutputSafeResult(
  safeResult: Extract<SafeCapabilityResult, { kind: 'commandOutput' }>,
  isPython: boolean,
  t: TFunction,
  omitStdoutPreview = false,
): GenericToolResultDetail {
  const stdoutPreview = redactSensitiveDisplayText(safeResult.stdoutPreview);
  const stderrPreview = redactSensitiveDisplayText(safeResult.stderrPreview);
  const hasStdout = !omitStdoutPreview && stdoutPreview.trim().length > 0;
  const hasStderr = stderrPreview.trim().length > 0;
  const parsedStderr = hasStderr ? parseSafeErrorLine(stderrPreview) : null;
  const stderrDetail = parsedStderr?.message ?? stderrPreview;
  const statusLabel = safeResult.timedOut
    ? t('turn.process.timeout')
    : parsedStderr?.code === 'COMMAND_NOT_ALLOWED'
      ? t('turn.process.blocked')
      : safeResult.exitCode === 0
        ? t('turn.process.completed')
        : t('turn.process.failed');
  const summary = safeResult.timedOut
    ? t(isPython ? 'turn.process.programTimedOutSummary' : 'turn.process.commandTimedOutSummary')
    : parsedStderr?.code === 'COMMAND_NOT_ALLOWED'
      ? t('turn.process.commandBlockedSummary')
      : safeResult.exitCode === 0
        ? ''
        : hasStderr
          ? t(isPython ? 'turn.process.programFailedWithErrorOutputSummary' : 'turn.process.commandFailedWithErrorOutputSummary')
          : t(isPython ? 'turn.process.programFailedSummary' : 'turn.process.commandFailedSummary');
  const detail = [
    t('turn.process.exitCodeWithCode', { code: safeResult.exitCode }),
    hasStdout ? `${t('turn.process.stdoutLabel')}:\n${stdoutPreview}` : null,
    safeResult.stdoutTruncated ? t('turn.process.stdoutTruncated') : null,
    parsedStderr ? t('turn.process.errorCodeWithCode', { code: parsedStderr.code }) : null,
    hasStderr ? formatStderrDetail(stderrDetail, t) : null,
    safeResult.stderrTruncated ? t('turn.process.stderrTruncated') : null,
  ]
    .filter((line): line is string => Boolean(line))
    .join('\n');
  return {
    summary,
    detail,
    statusLabel,
    isFailure: safeResult.timedOut || parsedStderr?.code === 'COMMAND_NOT_ALLOWED' || safeResult.exitCode !== 0,
    isExpandable: Boolean(detail.trim()) && (hasStdout || hasStderr || safeResult.exitCode !== 0 || safeResult.timedOut),
    detailFromSafeResult: true,
  };
}

function describeFileReadSafeResult(safeResult: Extract<SafeCapabilityResult, { kind: 'fileRead' }>, t: TFunction): GenericToolResultDetail {
  const readRange =
    safeResult.offset === undefined || safeResult.limit === undefined
      ? null
      : t('turn.process.fileReadRangeWithRange', { startLine: safeResult.offset + 1, limit: safeResult.limit });
  const truncationDetail = safeResult.truncated
    ? safeResult.nextOffset === undefined
      ? t('turn.process.fileReadPreviewTruncated')
      : t('turn.process.fileReadContinuationNoticeWithLine', { nextLine: safeResult.nextOffset + 1 })
    : null;
  const detail = [
    t('turn.process.fileWithPath', { filePath: safeResult.filePath }),
    readRange,
    `${t('turn.process.contentLabel')}:\n${safeResult.contentPreview}`,
    truncationDetail,
  ]
    .filter((line): line is string => Boolean(line))
    .join('\n\n');
  return {
    summary: t('turn.process.fileReadSummary', { filePath: safeResult.filePath }),
    detail,
    isExpandable: true,
    detailFromSafeResult: true,
  };
}

function describeFileListSafeResult(safeResult: Extract<SafeCapabilityResult, { kind: 'fileList' }>, t: TFunction): GenericToolResultDetail {
  const detail = [safeResult.filenames.join('\n'), safeResult.truncated ? t('turn.process.resultTruncated') : null]
    .filter((line): line is string => Boolean(line && line.trim().length > 0))
    .join('\n\n');
  return {
    summary: t('turn.process.fileListSummary', { count: safeResult.totalCount }),
    detail: detail || t('turn.process.fileListEmptyDetail'),
    isExpandable: safeResult.filenames.length > 0 || safeResult.truncated,
    detailFromSafeResult: true,
  };
}

function describeGrepSafeResult(safeResult: Extract<SafeCapabilityResult, { kind: 'grepResult' }>, t: TFunction): GenericToolResultDetail {
  const summary =
    safeResult.outputMode === 'files_with_matches'
      ? t('turn.process.grepFilesWithMatchesSummary', { totalFilesWithMatches: safeResult.totalFilesWithMatches })
      : t('turn.process.grepContentMatchesSummary', {
          totalMatches: safeResult.totalMatches,
          totalFilesWithMatches: safeResult.totalFilesWithMatches,
        });
  const entries =
    safeResult.outputMode === 'files_with_matches'
      ? safeResult.filenames
      : safeResult.locations.map((location) => `${location.filePath}:${location.lineNumber}`);
  const detail = [entries.join('\n'), safeResult.truncated ? t('turn.process.resultTruncated') : null]
    .filter((line): line is string => Boolean(line && line.length > 0))
    .join('\n\n');
  return {
    summary: safeResult.truncated ? `${summary} ${t('turn.process.resultTruncated')}` : summary,
    detail: detail || t('turn.process.grepEmptyDetail'),
    isExpandable: entries.length > 0 || safeResult.truncated,
    detailFromSafeResult: true,
  };
}

function describeRagRetrievalSafeResult(safeResult: Extract<SafeCapabilityResult, { kind: 'ragRetrieval' }>, t: TFunction): GenericToolResultDetail {
  const ragRetrievalItems = safeResult.items.map((item) => ({
    displaySource: item.source.split('|')[0]?.trim() || t('turn.process.ragRetrievalSourceUnavailable'),
    content: item.content,
  }));
  const detail = ragRetrievalItems
    .map((item, index) => {
      const normalized = normalizeRagContentPreview(item.content);
      const truncated = normalized.length > ragDetailTextMaxChars;
      const preview = normalized.length > 0 ? `\n   ${truncated ? `${normalized.slice(0, ragDetailTextMaxChars)}...` : normalized}` : '';
      return `${index + 1}. ${item.displaySource}${preview}`;
    })
    .join('\n');
  return {
    summary: t('turn.process.ragRetrievalSummary', { count: safeResult.totalCount }),
    detail,
    isExpandable: safeResult.items.length > 0,
    detailFromSafeResult: true,
    ragRetrievalItems,
  };
}

function normalizeRagContentPreview(contentPreview: string): string {
  return contentPreview.replace(/\s+/gu, ' ').trim();
}

function describeWorkflowResultSafeResult(
  safeResult: Extract<SafeCapabilityResult, { kind: 'workflowResult' }>,
  t: TFunction,
): GenericToolResultDetail {
  const answerPreviews = safeResult.answerPreviews ?? [];
  const detail = answerPreviews.join('\n\n---\n\n');
  return {
    summary: '',
    detail,
    isExpandable: answerPreviews.length > 0,
    detailFromSafeResult: true,
  };
}

function describeToolSearchSafeResult(safeResult: Extract<SafeCapabilityResult, { kind: 'toolSearch' }>, t: TFunction): GenericToolResultDetail {
  const detail = safeResult.tools
    .map((tool, index) =>
      [
        `${index + 1}. ${tool.name}`,
        `   ${t('turn.process.capabilityKindWithValue', { value: tool.kind })}`,
        `   ${t('turn.process.capabilityIdWithValue', { value: tool.capability_id })}`,
        tool.description === undefined ? null : `   ${t('turn.process.descriptionWithValue', { value: tool.description })}`,
      ]
        .filter((line): line is string => line !== null)
        .join('\n'),
    )
    .join('\n\n');
  return {
    summary: t('turn.process.toolSearchSummary', { count: safeResult.totalCount }),
    detail: [detail, safeResult.truncated ? t('turn.process.resultTruncated') : null].filter((line): line is string => Boolean(line)).join('\n\n'),
    isExpandable: safeResult.tools.length > 0 || safeResult.truncated,
    detailFromSafeResult: true,
  };
}

function describeCronSafeResult(safeResult: Extract<SafeCapabilityResult, { kind: 'cron' }>, t: TFunction): GenericToolResultDetail {
  if (safeResult.action === 'create') {
    return {
      summary: t('turn.process.cronCreatedSummary'),
      detail: [
        t('turn.process.cronTaskIdWithId', { id: safeResult.id }),
        t('turn.process.cronScheduleWithSchedule', { schedule: safeResult.humanSchedule }),
        t('turn.process.cronRecurringWithValue', { value: t(safeResult.recurring ? 'turn.process.yes' : 'turn.process.no') }),
      ].join('\n'),
      isExpandable: true,
      detailFromSafeResult: true,
    };
  }
  if (safeResult.action === 'delete') {
    return {
      summary: t('turn.process.cronDeletedSummary'),
      detail: t('turn.process.cronTaskIdWithId', { id: safeResult.id }),
      isExpandable: true,
      detailFromSafeResult: true,
    };
  }
  const detail = safeResult.jobs
    .map((job, index) =>
      [
        `${index + 1}. ${job.id}`,
        `   ${t('turn.process.cronScheduleWithSchedule', { schedule: job.humanSchedule })}`,
        `   ${t('turn.process.cronExpressionWithValue', { value: job.cron })}`,
        `   ${t('turn.process.cronRecurringWithValue', { value: t(job.recurring ? 'turn.process.yes' : 'turn.process.no') })}`,
      ].join('\n'),
    )
    .join('\n\n');
  return {
    summary: t('turn.process.cronListSummary', { count: safeResult.totalCount }),
    detail: [detail, safeResult.truncated ? t('turn.process.resultTruncated') : null].filter((line): line is string => Boolean(line)).join('\n\n'),
    isExpandable: safeResult.jobs.length > 0 || safeResult.truncated,
    detailFromSafeResult: true,
  };
}

function buildCapabilityFailureDetail(event: StreamEnvelope, t: TFunction): GenericToolResultDetail | null {
  const payload = event.payload as Record<string, unknown>;
  const code = readFailureErrorCodeFromPayload(payload);
  const category = readFailureErrorCategoryFromPayload(payload);
  const safeSummaryCode = readPayloadString(payload, 'safeSummaryCode');
  const hasFailureFact =
    code !== null ||
    category !== null ||
    safeSummaryCode === 'CAPABILITY_RESULT_FAILURE' ||
    safeSummaryCode?.startsWith('CAPABILITY_RESULT_FAILURE_') === true;
  if (!hasFailureFact) {
    return null;
  }
  const invocationStatus = resolveResultInvocationStatus(event, t);
  const failure =
    resolveSafeFailurePresentation(payload, t) ??
    resolveSafeFailurePresentation(
      {
        safeSummaryCode: 'CAPABILITY_RESULT_FAILURE',
        safeSummaryArgs: {},
      },
      t,
    );
  if (failure === null) {
    return null;
  }
  const detail = [
    code ? t('turn.process.errorCodeWithCode', { code }) : null,
    category ? t('turn.process.errorCategoryWithCategory', { category }) : null,
    invocationStatus ? t('turn.process.invocationStatusWithStatus', { status: invocationStatus }) : null,
  ]
    .filter((line): line is string => Boolean(line))
    .join('\n');
  return {
    summary: failure.reason,
    detail,
    statusLabel: failure.statusLabel,
    isExpandable: detail.length > 0,
    isFailure: true,
    detailFromSafeResult: true,
  };
}

function describeGenericToolResult(event: StreamEnvelope, text: string, t: TFunction, omitCommandStdout = false): GenericToolResultDetail | null {
  const safeResultDetail = describeSafeCapabilityResult(event, t, omitCommandStdout);
  if (safeResultDetail) {
    return safeResultDetail;
  }

  const failureDetail = buildCapabilityFailureDetail(event, t);
  if (failureDetail) {
    return failureDetail;
  }
  const payload = event.payload as Record<string, unknown>;
  const descriptorSummary = resolveSafeSummaryPresentation(payload, t);
  if (descriptorSummary && !isGenericCapabilityResultText(descriptorSummary)) {
    return {
      summary: descriptorSummary,
      detail: text.trim().length > 0 && !isGenericCapabilityResultText(text) ? text : descriptorSummary,
      isExpandable: text.trim().length > 0 && text !== descriptorSummary && !isGenericCapabilityResultText(text),
    };
  }
  if (descriptorSummary === '' && text.trim().length > 0 && !isGenericCapabilityResultText(text)) {
    return {
      summary: '',
      detail: text,
      isExpandable: true,
    };
  }
  return null;
}

function appendInvocationStatusDetail(detail: string, invocationStatus: string | null, t: TFunction): string {
  if (!invocationStatus) {
    return detail;
  }
  const statusLine = t('turn.process.invocationStatusWithStatus', { status: invocationStatus });
  return detail.includes(statusLine) ? detail : [detail, statusLine].filter(Boolean).join('\n');
}

function describeSystemEventResult(event: StreamEnvelope, t: TFunction): GenericToolResultDetail {
  const presentation = resolveSystemEventPresentation(event.eventType as GovernedSystemEventType, event.payload as Record<string, unknown>, t);
  if (!presentation.technicalCode) {
    return { summary: presentation.summary, detail: presentation.summary, isExpandable: false };
  }
  return {
    summary: presentation.summary,
    detail: t('turn.process.errorCodeWithCode', { code: presentation.technicalCode }),
    isExpandable: true,
  };
}

function buildTerminalFailureDegradationEntry(event: StreamEnvelope, t: TFunction): ProcessEntry | null {
  const presentation = resolveSystemEventPresentation('DEGRADATION_NOTICE', event.payload as Record<string, unknown>, t);
  if (!presentation.technicalCode) {
    return null;
  }
  const detail = t('turn.process.errorCodeWithCode', { code: presentation.technicalCode });
  return {
    key: `${event.eventId}:terminal-failure-degradation`,
    title: presentation.title,
    summary: presentation.summary,
    detail,
    rawDetail: detail,
    contentType: 'PLAIN_TEXT',
    toolName: null,
    kind: 'system',
    isFinal: true,
    isExpandable: true,
    severity: presentation.severity,
    sequence: event.sequence,
    lastSequence: event.sequence,
    createdAt: event.createdAt,
  };
}

function mergeThinkingDetail(currentDetail: string | null, nextDetail: string, payload: Record<string, unknown>): string {
  return mergeStreamText(currentDetail ?? '', nextDetail, payload);
}

function isFinalThinkingPayload(payload: Record<string, unknown>): boolean {
  const metadata = payload.metadata;
  return typeof metadata === 'object' && metadata !== null && !Array.isArray(metadata) && (metadata as Record<string, unknown>).completed === true;
}

function resolveToolStateRank(eventType: StreamEventType): number {
  switch (eventType) {
    case 'CAPABILITY_STARTED':
      return 0;
    case 'CAPABILITY_RESULT_DELTA':
      return 1;
    case 'CAPABILITY_COMPLETED':
      return 2;
    default:
      return -1;
  }
}

function describeToolDetail(event: StreamEnvelope, text: string, t: TFunction): string {
  switch (event.eventType) {
    case 'CAPABILITY_STARTED':
      return '';
    case 'CAPABILITY_RESULT_DELTA':
      if (isHistoricalCapabilityResult(event)) {
        return text ? t('turn.process.completedWithText', { text }) : t('turn.process.completed');
      }
      return text ? t('turn.process.toolOutputWithText', { text }) : t('turn.process.toolOutputUpdated');
    case 'CAPABILITY_COMPLETED':
      return text ? t('turn.process.completedWithText', { text }) : t('turn.process.completed');
    default:
      return text;
  }
}

function describeToolArgumentDetail(text: string, t: TFunction): string {
  return text ? t('turn.process.toolArgumentsWithText', { text }) : t('turn.process.toolArgumentsUpdated');
}

function normalizeStatusText(text: string): string {
  return text.trim().replace(/\s+/g, ' ').toLowerCase();
}

function isGenericCapabilityCompletionText(text: string, toolName: string | null): boolean {
  const normalizedText = normalizeStatusText(text);
  if (!normalizedText) {
    return false;
  }
  if (
    normalizedText === 'completed' ||
    normalizedText === 'succeeded' ||
    normalizedText === 'success' ||
    normalizedText === 'failed' ||
    normalizedText === 'error' ||
    normalizedText === 'canceled' ||
    normalizedText === 'cancelled' ||
    normalizedText === 'superseded' ||
    normalizedText === 'tool completed' ||
    normalizedText === 'capability completed'
  ) {
    return true;
  }
  const normalizedToolName = toolName ? normalizeStatusText(toolName) : '';
  return normalizedToolName.length > 0 && normalizedText === `${normalizedToolName} completed`;
}

function mergeCapabilityTimelineContent(current: string, next: string, payload: Record<string, unknown>): string {
  return mergeStreamText(current, next, payload);
}

function describeProcessTimelineEvent(
  event: StreamEnvelope,
  detail: string,
  t: TFunction,
): Omit<ProcessTimelineEntry, 'key' | 'sequence' | 'createdAt'> | null {
  const payload = event.payload as Record<string, unknown>;
  const contentType = readPayloadContentType(payload);
  switch (event.eventType) {
    case 'REQUEST_ACCEPTED':
      return {
        title: t('turn.process.requestStartedTitle'),
        detail: detail || t('turn.process.requestStartedDetail'),
        kind: 'system',
        sourceEventType: event.eventType,
        content: detail || t('turn.process.requestStartedDetail'),
        contentType,
      };
    case 'CAPABILITY_STARTED':
      return {
        title: displayCapabilityName(event, t('turn.process.unknownTool')),
        detail: describeToolDetail(event, detail, t),
        kind: 'tool',
        sourceEventType: event.eventType,
        correlationId: readToolCorrelationId(event),
        statusLabel: t('turn.process.requestStartedTitle'),
        content: null,
        contentType: null,
      };
    case 'CAPABILITY_COMPLETED': {
      const toolName = readToolName(event);
      const genericToolResult = describeGenericToolResult(event, detail, t);
      if (genericToolResult) {
        return {
          title: displayCapabilityName(event, t('turn.process.unknownTool')),
          detail: genericToolResult.summary,
          kind: 'tool',
          sourceEventType: event.eventType,
          correlationId: readToolCorrelationId(event),
          statusLabel: t('turn.process.completedAction'),
          content: genericToolResult.detail,
          contentType: 'PLAIN_TEXT',
        };
      }
      const completionContent = detail && !isGenericCapabilityCompletionText(detail, toolName) ? detail : null;
      return {
        title: displayCapabilityName(event, t('turn.process.unknownTool')),
        detail: completionContent ? t('turn.process.completedActionWithText', { text: completionContent }) : t('turn.process.completedAction'),
        kind: 'tool',
        sourceEventType: event.eventType,
        correlationId: readToolCorrelationId(event),
        statusLabel: t('turn.process.completedAction'),
        content: completionContent,
        contentType: completionContent ? (contentType ?? 'PLAIN_TEXT') : null,
      };
    }
    case 'DEGRADATION_NOTICE': {
      const presentation = resolveSystemEventPresentation(event.eventType, payload, t);
      const technicalDetail = presentation.technicalCode ? t('turn.process.errorCodeWithCode', { code: presentation.technicalCode }) : null;
      return {
        title: presentation.title,
        detail: presentation.summary,
        kind: 'system',
        sourceEventType: event.eventType,
        content: technicalDetail,
        contentType: technicalDetail ? 'PLAIN_TEXT' : null,
      };
    }
    case 'HOOK_DEGRADED':
    case 'CONTEXT_COMPACTED': {
      const presentation = resolveSystemEventPresentation(event.eventType, payload, t);
      return {
        title: presentation.title,
        detail: presentation.summary,
        kind: 'system',
        sourceEventType: event.eventType,
        content: null,
        contentType: null,
      };
    }
    case 'ATTACHMENT_ACCEPTED':
      return {
        title: t('turn.process.attachmentAcceptedTitle'),
        detail: detail || t('turn.process.attachmentAcceptedDetail'),
        kind: 'system',
        sourceEventType: event.eventType,
        content: detail || t('turn.process.attachmentAcceptedDetail'),
        contentType,
      };
    case 'ATTACHMENT_REJECTED':
      return {
        title: t('turn.process.attachmentRejectedTitle'),
        detail: detail || t('turn.process.attachmentRejectedDetail'),
        kind: 'system',
        sourceEventType: event.eventType,
        content: detail || t('turn.process.attachmentRejectedDetail'),
        contentType,
      };
    case 'REQUEST_COMPLETED':
      return {
        title: t('turn.process.executionEndedTitle'),
        detail: detail || t('turn.process.completed'),
        kind: 'terminal',
        sourceEventType: event.eventType,
        statusLabel: t('turn.process.completed'),
        content: detail || null,
        contentType,
      };
    case 'REQUEST_FAILED': {
      const failureCode = readFailureErrorCodeFromPayload(event.payload as Record<string, unknown>);
      const failedDetail = failureCode ? t('turn.process.failedWithCode', { code: failureCode }) : detail || t('turn.process.failed');
      return {
        title: t('turn.process.executionEndedTitle'),
        detail: failedDetail,
        kind: 'terminal',
        sourceEventType: event.eventType,
        statusLabel: t('turn.process.failed'),
        content: failedDetail,
        contentType,
      };
    }
    case 'REQUEST_CANCELED':
      return {
        title: t('turn.process.executionEndedTitle'),
        detail: detail || t('turn.process.canceledByUser'),
        kind: 'terminal',
        sourceEventType: event.eventType,
        statusLabel: t('turn.process.canceled'),
        content: detail || null,
        contentType,
      };
    case 'REQUEST_SUPERSEDED':
      return {
        title: t('turn.process.executionEndedTitle'),
        detail: detail || t('turn.process.supersededByNewerRequest'),
        kind: 'terminal',
        sourceEventType: event.eventType,
        statusLabel: t('turn.process.superseded'),
        content: detail || null,
        contentType,
      };
    case 'USER_INPUT_REQUIRED': {
      const prompt = readNamedPayloadText(event, ['prompt', 'content', 'message']) || detail;
      return {
        title: t('turn.process.waitingInputTitle'),
        detail: prompt || t('turn.process.waitingInputDetail'),
        kind: 'system',
        sourceEventType: event.eventType,
        statusLabel: t('turn.process.waitingResponse'),
        content: prompt || t('turn.process.waitingInputDetail'),
        contentType,
      };
    }
    case 'USER_INPUT_RECEIVED': {
      const responseText = readNamedPayloadText(event, ['value', 'response', 'content']) || detail;
      return {
        title: t('turn.process.userResponseTitle'),
        detail: responseText || t('turn.process.userResponseDetail'),
        kind: 'system',
        sourceEventType: event.eventType,
        statusLabel: t('turn.process.responded'),
        content: responseText || t('turn.process.userResponseDetail'),
        contentType,
      };
    }
    case 'USER_INPUT_TIMEOUT':
      return {
        title: t('turn.process.inputTimeoutTitle'),
        detail: detail || t('turn.process.inputTimeoutDetail'),
        kind: 'system',
        sourceEventType: event.eventType,
        statusLabel: t('turn.process.timeout'),
        content: detail || t('turn.process.inputTimeoutDetail'),
        contentType,
      };
    case 'USER_INPUT_CANCELED':
      return {
        title: t('turn.process.inputCanceledTitle'),
        detail: detail || t('turn.process.inputCanceledDetail'),
        kind: 'system',
        sourceEventType: event.eventType,
        statusLabel: t('turn.process.canceled'),
        content: detail || t('turn.process.inputCanceledDetail'),
        contentType,
      };
    default:
      if (!detail.trim()) {
        return null;
      }
      return {
        title: t('turn.process.runEventTitle'),
        detail,
        kind: 'system',
        content: detail,
        contentType,
      };
  }
}

function sortProcessTimelineEvents(aiEvents: readonly StreamEnvelope[]): StreamEnvelope[] {
  const earliestCorrelatedDetailIndexes = new Map<string, number>();
  aiEvents.forEach((event, index) => {
    if (event.eventType !== 'TOOL_STRUCTURED_DELTA') {
      return;
    }
    const correlationId = readExplicitToolCorrelationId(event);
    const toolEventType = readPayloadString(event.payload as Record<string, unknown>, 'toolEventType');
    if (correlationId === null || toolEventType === 'TITLE' || toolEventType === 'SUB_TITLE') {
      return;
    }
    const key = `${event.sequence}:${correlationId}`;
    if (!earliestCorrelatedDetailIndexes.has(key)) {
      earliestCorrelatedDetailIndexes.set(key, index);
    }
  });

  return aiEvents
    .map((event, index) => {
      if (event.eventType !== 'TOOL_STRUCTURED_DELTA') {
        return { event, index, sortPosition: index };
      }
      const correlationId = readExplicitToolCorrelationId(event);
      const toolEventType = readPayloadString(event.payload as Record<string, unknown>, 'toolEventType');
      const earliestDetailIndex = correlationId === null ? undefined : earliestCorrelatedDetailIndexes.get(`${event.sequence}:${correlationId}`);
      const sortPosition =
        (toolEventType === 'TITLE' || toolEventType === 'SUB_TITLE') && earliestDetailIndex !== undefined && earliestDetailIndex < index
          ? earliestDetailIndex - 0.5
          : index;
      return { event, index, sortPosition };
    })
    .sort((left, right) => {
      return left.sortPosition - right.sortPosition || left.index - right.index;
    })
    .map(({ event }) => event);
}

interface StructuredDeltaEventData {
  readonly toolEventType: string;
  readonly toolMessageType: string;
  readonly contentText: string;
  readonly rawContent: unknown;
}

function parseStructuredDeltaEvent(event: StreamEnvelope): StructuredDeltaEventData | null {
  const payload = event.payload as Record<string, unknown>;
  const toolEventType = readPayloadString(payload, 'toolEventType') ?? '';
  const toolMessageType = readPayloadString(payload, 'toolMessageType') ?? '';
  const rawContent = payload.content;
  const contentText = typeof rawContent === 'string' ? rawContent : JSON.stringify(rawContent ?? '');
  return contentText.trim().length > 0 ? { toolEventType, toolMessageType, contentText, rawContent } : null;
}

function resolveStructuredDetailEntryIndex<T>(
  correlationId: string | null,
  indexesByCorrelationId: ReadonlyMap<string, number>,
  entries: readonly T[],
  lastSubTitleEntry: T | null,
): number | undefined {
  if (correlationId !== null) {
    return indexesByCorrelationId.get(correlationId);
  }
  if (lastSubTitleEntry === null) {
    return undefined;
  }
  const index = entries.indexOf(lastSubTitleEntry);
  return index < 0 ? undefined : index;
}

// Accumulates a structured delta event into a DETAIL/SUB_DETAIL/SUB_CONCLUSION segment array.
// Mirrors ANSWER buildAnswerSegments semantics: adjacent TEXT segments merge into the last
// TEXT segment; non-TEXT segments become independent structured segments stacked in order;
// a messageType change breaks the TEXT merge chain. Non-TEXT content uses rawContent (the
// original structured value), TEXT content uses the string form.
function appendProcessDetailSegment(
  segments: readonly AnswerSegment[],
  parsed: StructuredDeltaEventData,
  sequence: number,
  payload: Record<string, unknown>,
): AnswerSegment[] {
  const toolMessageType =
    typeof parsed.toolMessageType === 'string' && (validToolMessageTypes as readonly string[]).includes(parsed.toolMessageType)
      ? (parsed.toolMessageType as ToolMessageType)
      : 'TEXT';
  const next = [...segments];
  if (toolMessageType === 'TEXT') {
    const last = next[next.length - 1];
    if (last?.kind === 'structured' && last.toolMessageType === 'TEXT' && typeof last.content === 'string') {
      next[next.length - 1] = {
        ...last,
        content: mergeStreamText(last.content, parsed.contentText, payload),
        sequence,
      };
    } else {
      next.push({ kind: 'structured', toolMessageType: 'TEXT', content: parsed.contentText, sequence });
    }
  } else {
    next.push({ kind: 'structured', toolMessageType, content: parsed.rawContent, sequence });
  }
  return next;
}

function buildStandaloneStructuredProcessEntry(event: StreamEnvelope, parsed: StructuredDeltaEventData, presentationOrder: number): ProcessEntry {
  const isWorkflowProduct = readWorkflowOccurrenceCorrelationId(event) !== null;
  const structuredSegments = isWorkflowProduct
    ? appendProcessDetailSegment([], parsed, event.sequence, structuredDetailPayload(event.payload))
    : undefined;
  const detail = !isWorkflowProduct || parsed.toolMessageType === 'TEXT' ? parsed.contentText : '';
  return {
    key: event.eventId,
    title: '',
    detail,
    rawDetail: detail,
    contentType: 'PLAIN_TEXT',
    toolName: null,
    kind: 'tool',
    isFinal: false,
    sequence: event.sequence,
    lastSequence: event.sequence,
    lastPresentationOrder: presentationOrder,
    createdAt: event.createdAt,
    toolEventType: parsed.toolEventType,
    toolCallId: readExplicitToolCorrelationId(event) ?? undefined,
    parentToolCallId: readParentToolCallId(event),
    ...(structuredSegments === undefined ? {} : { structuredSegments }),
  };
}

function collectStructuredWorkflowTitles(aiEvents: readonly StreamEnvelope[]): Map<string, string> {
  const titles = new Map<string, string>();
  for (const event of sortProcessTimelineEvents(aiEvents)) {
    if (event.eventType !== 'TOOL_STRUCTURED_DELTA') {
      continue;
    }
    const occurrenceId = readWorkflowOccurrenceCorrelationId(event);
    const parsed = parseStructuredDeltaEvent(event);
    if (occurrenceId === null || parsed === null || (parsed.toolEventType !== 'TITLE' && parsed.toolEventType !== 'SUB_TITLE')) {
      continue;
    }
    if (parsed.contentText.trim().length > 0) {
      titles.set(occurrenceId, parsed.contentText);
    }
  }
  return titles;
}

function collectFailedWorkflowOccurrences(aiEvents: readonly StreamEnvelope[]): Set<string> {
  const failedOccurrences = new Set<string>();
  for (const event of aiEvents) {
    const status = readPayloadString(event.payload as Record<string, unknown>, 'status')?.toUpperCase();
    if (resolveWorkflowLifecyclePresentation(event) !== 'titled-terminal' || (status !== 'FAILED' && status !== 'TIMED_OUT')) {
      continue;
    }
    const occurrenceId = readWorkflowOccurrenceCorrelationId(event);
    if (occurrenceId !== null) {
      failedOccurrences.add(occurrenceId);
    }
  }
  return failedOccurrences;
}

export function buildProcessTimelineEntries(
  aiEvents: readonly StreamEnvelope[],
  t: TFunction,
  presentationResources: CapabilityPresentationResourceMap = EMPTY_CAPABILITY_PRESENTATION_RESOURCES,
  locale = 'en-US',
): ProcessTimelineEntry[] {
  return buildReconciledProcessTimelineEntries(reconcileWorkflowProductFragments(aiEvents), t, presentationResources, locale);
}

function buildReconciledProcessTimelineEntries(
  aiEvents: readonly StreamEnvelope[],
  t: TFunction,
  presentationResources: CapabilityPresentationResourceMap,
  locale: string,
): ProcessTimelineEntry[] {
  const entries: ProcessTimelineEntry[] = [];
  let activeThinking: ProcessTimelineEntry | null = null;
  const activeCapabilityResult: { entry: ActiveCapabilityTimelineEntry | null } = { entry: null };
  const capabilityNames = new Map<string, string>();
  const pendingToolArgumentKeys = new Map<string, string>();
  const structuredWorkflowTitles = collectStructuredWorkflowTitles(aiEvents);
  const failedWorkflowOccurrences = collectFailedWorkflowOccurrences(aiEvents);

  const structuredToolCallIds = new Set<string>();
  const askUserQuestionToolCallIds = new Set<string>();
  for (const event of aiEvents) {
    if (event.eventType === 'TOOL_STRUCTURED_DELTA') {
      structuredToolCallIds.add(readToolCorrelationId(event));
    }
    if (event.eventType === 'CAPABILITY_STARTED' && isAskUserQuestionCapabilityEvent(event)) {
      askUserQuestionToolCallIds.add(readToolCorrelationId(event));
    }
  }

  let lastStructuredTitleEntry: ProcessTimelineEntry | null = null;
  let lastStructuredSubTitleEntry: ProcessTimelineEntry | null = null;
  const structuredTitleEntryIndexes = new Map<string, number>();
  const structuredSubTitleEntryIndexes = new Map<string, number>();

  const flushThinking = () => {
    if (activeThinking && activeThinking.detail.trim()) {
      entries.push(activeThinking);
    }
    activeThinking = null;
  };

  const flushCapabilityResult = () => {
    const entry = activeCapabilityResult.entry;
    if (entry && entry.detail.trim()) {
      entries.push(entry);
    }
    activeCapabilityResult.entry = null;
  };

  for (const event of sortProcessTimelineEvents(aiEvents)) {
    if (isToolCallStreamCompletion(event)) {
      flushCapabilityResult();
      clearPendingToolArgumentKeys(event, pendingToolArgumentKeys);
      continue;
    }

    if (event.eventType === 'TOOL_STRUCTURED_DELTA') {
      const parsed = parseStructuredDeltaEvent(event);
      if (!parsed) {
        continue;
      }
      const { toolEventType, toolMessageType, contentText } = parsed;
      const workflowOccurrenceId = readWorkflowOccurrenceCorrelationId(event);
      if (
        workflowOccurrenceId !== null &&
        failedWorkflowOccurrences.has(workflowOccurrenceId) &&
        !structuredWorkflowTitles.has(workflowOccurrenceId) &&
        toolEventType !== 'TITLE' &&
        toolEventType !== 'SUB_TITLE'
      ) {
        continue;
      }
      if (toolEventType === 'TITLE') {
        flushThinking();
        const entry: ProcessTimelineEntry = {
          key: event.eventId,
          title: contentText,
          detail: '',
          kind: 'tool',
          sequence: event.sequence,
          createdAt: event.createdAt,
          sourceEventType: event.eventType,
          correlationId: readToolCorrelationId(event),
          toolEventType: 'TITLE',
        };
        entries.push(entry);
        if (workflowOccurrenceId !== null) {
          structuredTitleEntryIndexes.set(workflowOccurrenceId, entries.length - 1);
        }
        lastStructuredTitleEntry = entry;
        lastStructuredSubTitleEntry = null;
      } else if (toolEventType === 'SUB_TITLE') {
        flushThinking();
        const entry: ProcessTimelineEntry = {
          key: event.eventId,
          title: contentText,
          detail: '',
          kind: 'tool',
          sequence: event.sequence,
          createdAt: event.createdAt,
          sourceEventType: event.eventType,
          correlationId: readToolCorrelationId(event),
          toolEventType: 'SUB_TITLE',
        };
        entries.push(entry);
        if (workflowOccurrenceId !== null) {
          structuredSubTitleEntryIndexes.set(workflowOccurrenceId, entries.length - 1);
        }
        lastStructuredSubTitleEntry = entry;
      } else if (toolEventType === 'DETAIL') {
        const correlationId = readWorkflowOccurrenceCorrelationId(event);
        const idx: number | undefined = resolveStructuredDetailEntryIndex<ProcessTimelineEntry>(
          correlationId,
          structuredTitleEntryIndexes,
          entries,
          lastStructuredTitleEntry,
        );
        const currentEntry: ProcessTimelineEntry | undefined = idx === undefined ? undefined : entries[idx];
        if (idx === undefined || currentEntry === undefined) {
          flushThinking();
          const entry: ProcessTimelineEntry = {
            key: event.eventId,
            title: '',
            detail: contentText,
            kind: 'tool',
            sequence: event.sequence,
            createdAt: event.createdAt,
            sourceEventType: event.eventType,
            correlationId: readToolCorrelationId(event),
            toolEventType: 'DETAIL',
          };
          entries.push(entry);
          structuredTitleEntryIndexes.set(readToolCorrelationId(event), entries.length - 1);
          lastStructuredTitleEntry = entry;
          lastStructuredSubTitleEntry = null;
          continue;
        }
        const tDetail: string = currentEntry.detail;
        const tNextDetail: string =
          toolMessageType === 'TEXT'
            ? mergeStreamText(tDetail, contentText, structuredDetailPayload(event.payload))
            : tDetail
              ? tDetail + '\n' + contentText
              : contentText;
        lastStructuredTitleEntry = { ...currentEntry, detail: tNextDetail, sequence: event.sequence };
        entries[idx] = lastStructuredTitleEntry;
      } else if (toolEventType === 'SUB_DETAIL' || toolEventType === 'SUB_CONCLUSION') {
        const correlationId = readWorkflowOccurrenceCorrelationId(event);
        const idx: number | undefined = resolveStructuredDetailEntryIndex<ProcessTimelineEntry>(
          correlationId,
          structuredSubTitleEntryIndexes,
          entries,
          lastStructuredSubTitleEntry ?? lastStructuredTitleEntry,
        );
        const currentEntry: ProcessTimelineEntry | undefined = idx === undefined ? undefined : entries[idx];
        if (idx === undefined || currentEntry === undefined) {
          if (correlationId !== null) {
            const entry: ProcessTimelineEntry = {
              key: event.eventId,
              title: '',
              detail: contentText,
              kind: 'tool',
              sequence: event.sequence,
              createdAt: event.createdAt,
              sourceEventType: event.eventType,
              correlationId: readToolCorrelationId(event),
              toolEventType,
            };
            entries.push(entry);
            structuredSubTitleEntryIndexes.set(correlationId, entries.length - 1);
            lastStructuredSubTitleEntry = entry;
          }
          continue;
        }
        const tDetail = currentEntry.detail;
        const tNextDetail =
          toolMessageType === 'TEXT'
            ? mergeStreamText(tDetail, contentText, structuredDetailPayload(event.payload))
            : tDetail
              ? tDetail + '\n' + contentText
              : contentText;
        const updatedEntry: ProcessTimelineEntry = { ...currentEntry, detail: tNextDetail, sequence: event.sequence };
        if (lastStructuredSubTitleEntry?.key === currentEntry.key) {
          lastStructuredSubTitleEntry = updatedEntry;
        } else if (lastStructuredTitleEntry?.key === currentEntry.key) {
          lastStructuredTitleEntry = updatedEntry;
        }
        entries[idx] = updatedEntry;
      }
      // ANSWER does not create a process panel entry.
      continue;
    }

    if (event.eventType === 'LLM_CONTENT_DELTA') {
      continue;
    }

    if (event.eventType === 'LLM_THINKING_DELTA') {
      flushCapabilityResult();
      const detail = readProcessText(event);
      if (detail.length === 0) {
        continue;
      }
      if (activeThinking) {
        const nextDetail = mergeThinkingDetail(activeThinking.content ?? activeThinking.detail, detail, event.payload as Record<string, unknown>);
        activeThinking = {
          key: activeThinking.key,
          title: activeThinking.title,
          detail: nextDetail,
          kind: activeThinking.kind,
          sequence: event.sequence,
          createdAt: event.createdAt,
          content: nextDetail,
          contentType: 'PLAIN_TEXT',
        };
      } else {
        flushThinking();
        activeThinking = {
          key: event.eventId,
          title: t('turn.process.thinking'),
          detail,
          kind: 'thinking',
          sequence: event.sequence,
          createdAt: event.createdAt,
          content: detail,
          contentType: 'PLAIN_TEXT',
        };
      }
      continue;
    }

    flushThinking();

    if (isModelToolArgumentDelta(event)) {
      flushCapabilityResult();
      const detail = readProcessText(event);
      if (!detail.trim()) {
        resolveToolArgumentCorrelationId(event, pendingToolArgumentKeys);
        continue;
      }
      const correlationId = resolveToolArgumentCorrelationId(event, pendingToolArgumentKeys);
      const contentType = readPayloadContentType(event.payload as Record<string, unknown>);
      const previousCapabilityResult = activeCapabilityResult.entry;
      if (previousCapabilityResult && previousCapabilityResult.correlationId === correlationId) {
        const nextContent = mergeCapabilityTimelineContent(
          previousCapabilityResult.content ?? previousCapabilityResult.detail,
          detail,
          event.payload as Record<string, unknown>,
        );
        activeCapabilityResult.entry = {
          ...previousCapabilityResult,
          detail: describeToolArgumentDetail(nextContent, t),
          sequence: event.sequence,
          createdAt: event.createdAt,
          content: nextContent,
          contentType: contentType ?? previousCapabilityResult.contentType ?? 'PLAIN_TEXT',
        };
      } else {
        flushCapabilityResult();
        activeCapabilityResult.entry = {
          key: correlationId,
          title: t('turn.process.toolCallPreparing'),
          detail: describeToolArgumentDetail(detail, t),
          kind: 'tool',
          sequence: event.sequence,
          createdAt: event.createdAt,
          sourceEventType: event.eventType,
          correlationId,
          statusLabel: t('turn.process.toolArguments'),
          content: detail,
          contentType: contentType ?? 'PLAIN_TEXT',
        };
      }
      continue;
    }

    if (event.eventType === 'CAPABILITY_RESULT_DELTA') {
      const correlationId = readToolCorrelationId(event);
      if (structuredToolCallIds.has(correlationId)) {
        continue;
      }
      if (askUserQuestionToolCallIds.has(correlationId) || isAskUserQuestionCapabilityEvent(event)) {
        continue;
      }
      const toolName = readToolName(event);
      const targetName = readCapabilityTargetName(event);
      const resolvedProcessTitle = resolveCapabilityProcessTitle(
        readCapabilityTitleIdentity(event),
        (key, options) => String(t(key, options as never)),
        locale,
        presentationResources,
      );
      if (toolName && (targetName !== null || !capabilityNames.has(correlationId))) {
        capabilityNames.set(correlationId, resolvedProcessTitle);
      }
      const detail = readProcessText(event);
      const genericToolResult = describeGenericToolResult(event, detail, t);
      const contentType = readPayloadContentType(event.payload as Record<string, unknown>);
      if (!detail.trim() && !genericToolResult) {
        continue;
      }
      const resultDetail = genericToolResult?.detail ?? detail;
      const resultSummary = genericToolResult?.summary;
      const sanitizedResultContentType: StreamContentType | null = genericToolResult ? 'PLAIN_TEXT' : null;

      const previousCapabilityResult = activeCapabilityResult.entry;
      if (previousCapabilityResult && previousCapabilityResult.correlationId === correlationId) {
        const nextContent = mergeCapabilityTimelineContent(
          previousCapabilityResult.content ?? previousCapabilityResult.detail,
          resultDetail,
          event.payload as Record<string, unknown>,
        );
        activeCapabilityResult.entry = {
          ...previousCapabilityResult,
          detail: resultSummary ?? describeToolDetail(event, nextContent, t),
          sequence: event.sequence,
          createdAt: event.createdAt,
          content: nextContent,
          contentType: sanitizedResultContentType ?? contentType ?? previousCapabilityResult.contentType ?? 'PLAIN_TEXT',
        };
      } else {
        flushCapabilityResult();
        const title: string = capabilityNames.get(correlationId) ?? resolvedProcessTitle;
        activeCapabilityResult.entry = {
          key: event.eventId,
          title,
          detail: resultSummary ?? describeToolDetail(event, resultDetail, t),
          kind: 'tool',
          sequence: event.sequence,
          createdAt: event.createdAt,
          sourceEventType: event.eventType,
          correlationId,
          statusLabel: isHistoricalCapabilityResult(event) ? t('turn.process.completed') : t('turn.process.toolOutput'),
          content: resultDetail,
          contentType: sanitizedResultContentType ?? contentType ?? 'PLAIN_TEXT',
        };
      }
      continue;
    }

    flushCapabilityResult();

    if (event.eventType === 'CAPABILITY_STARTED' || event.eventType === 'CAPABILITY_COMPLETED') {
      const workflowLifecyclePresentation = resolveWorkflowLifecyclePresentation(event);
      if (workflowLifecyclePresentation === 'hidden') {
        continue;
      }
      const correlationId = readToolCorrelationId(event);
      const structuredWorkflowTitle = structuredWorkflowTitles.get(correlationId);
      if (askUserQuestionToolCallIds.has(correlationId) || isAskUserQuestionCapabilityEvent(event)) {
        continue;
      }
      if (workflowLifecyclePresentation === 'titled-terminal') {
        if (structuredWorkflowTitle === undefined) {
          continue;
        }
        const structuredEntryIndex = structuredSubTitleEntryIndexes.get(correlationId) ?? structuredTitleEntryIndexes.get(correlationId);
        const structuredEntry = structuredEntryIndex === undefined ? undefined : entries[structuredEntryIndex];
        if (structuredEntryIndex !== undefined && structuredEntry !== undefined) {
          const updatedEntry = {
            ...structuredEntry,
            title: structuredWorkflowTitle,
            sequence: event.sequence,
            statusLabel: resolveToolLifecycleStatus(event, t) ?? structuredEntry.statusLabel,
          };
          entries[structuredEntryIndex] = updatedEntry;
          if (lastStructuredSubTitleEntry?.key === structuredEntry.key) {
            lastStructuredSubTitleEntry = updatedEntry;
          }
          if (lastStructuredTitleEntry?.key === structuredEntry.key) {
            lastStructuredTitleEntry = updatedEntry;
          }
        }
        continue;
      }
      const lifecycleTitle = resolveCapabilityProcessTitle(
        readCapabilityTitleIdentity(event),
        (key, options) => String(t(key, options as never)),
        locale,
        presentationResources,
      );
      capabilityNames.set(correlationId, lifecycleTitle);
      const detail = readProcessText(event);
      const describedEntry = describeProcessTimelineEvent(event, detail, t);
      if (!describedEntry) {
        continue;
      }
      entries.push({
        key: event.eventId,
        sequence: event.sequence,
        createdAt: event.createdAt,
        ...describedEntry,
        title: lifecycleTitle,
        correlationId,
        statusLabel: describedEntry.statusLabel,
      });
      continue;
    }

    const detail = readProcessText(event).trim();
    const describedEntry = describeProcessTimelineEvent(event, detail, t);
    if (!describedEntry) {
      continue;
    }
    entries.push({
      key: event.eventId,
      sequence: event.sequence,
      createdAt: event.createdAt,
      ...describedEntry,
    });
  }

  flushThinking();
  flushCapabilityResult();
  return entries;
}

function compareProcessEntries(left: ProcessEntry, right: ProcessEntry): number {
  const leftCreatedAt = toTimestampMillis(left.createdAt);
  const rightCreatedAt = toTimestampMillis(right.createdAt);
  const leftHasCreatedAt = !Number.isNaN(leftCreatedAt);
  const rightHasCreatedAt = !Number.isNaN(rightCreatedAt);

  if (leftHasCreatedAt && rightHasCreatedAt && leftCreatedAt !== rightCreatedAt) {
    return leftCreatedAt - rightCreatedAt;
  }
  if (leftHasCreatedAt !== rightHasCreatedAt) {
    return leftHasCreatedAt ? -1 : 1;
  }
  if (typeof left.sequence === 'number' && typeof right.sequence === 'number' && left.sequence !== right.sequence) {
    return left.sequence - right.sequence;
  }
  return left.key.localeCompare(right.key);
}

function decorateRepeatedToolEntries(entries: readonly ProcessEntry[], t: TFunction): ProcessEntry[] {
  const toolNameCounts = new Map<string, number>();
  for (const entry of entries) {
    if (entry.kind === 'tool' && entry.toolName) {
      toolNameCounts.set(entry.toolName, (toolNameCounts.get(entry.toolName) ?? 0) + 1);
    }
  }

  const toolNameIndexes = new Map<string, number>();
  return entries.map((entry) => {
    if (entry.kind !== 'tool' || !entry.toolName || (toolNameCounts.get(entry.toolName) ?? 0) <= 1) {
      return entry;
    }
    const nextIndex = (toolNameIndexes.get(entry.toolName) ?? 0) + 1;
    toolNameIndexes.set(entry.toolName, nextIndex);
    return {
      ...entry,
      detail: t('turn.process.repeatedToolCall', { index: nextIndex, detail: entry.detail }),
    };
  });
}

interface SupplementalInputQuestion {
  readonly prompt: string;
  readonly options: ReadonlyMap<string, string>;
  readonly multiple: boolean;
  readonly custom: boolean;
}

interface SupplementalInputState {
  readonly key: string;
  readonly pendingInputId: string;
  questions?: readonly SupplementalInputQuestion[];
  answers?: ReadonlyArray<readonly string[]>;
  truncated?: boolean;
  required: boolean;
  resolved: boolean;
  received: boolean;
  firstSequence: number;
  lastSequence: number;
  lastPresentationOrder: number;
  firstCreatedAt: WireTimestamp | null;
}

function readSupplementalInputId(event: StreamEnvelope): string | null {
  return readPayloadString(event.payload as Record<string, unknown>, 'pendingInputId');
}

function isSupplementalInputStatusEvent(event: StreamEnvelope): boolean {
  if (event.eventType !== 'USER_INPUT_REQUIRED' && event.eventType !== 'USER_INPUT_RECEIVED') {
    return false;
  }
  const payload = event.payload as Record<string, unknown>;
  return payload.kind === 'QUESTION' && readSupplementalInputId(event) !== null;
}

function isSupplementalInputTerminalEvent(event: StreamEnvelope): boolean {
  if (event.eventType !== 'USER_INPUT_TIMEOUT' && event.eventType !== 'USER_INPUT_CANCELED') {
    return false;
  }
  const payload = event.payload as Record<string, unknown>;
  return payload.kind === 'QUESTION' && readSupplementalInputId(event) !== null;
}

function readSupplementalInputAnswer(event: StreamEnvelope): Extract<SafeCapabilityResult, { kind: 'pendingInputAnswer' }> | null {
  if (event.eventType !== 'CAPABILITY_RESULT_DELTA' && event.eventType !== 'CAPABILITY_COMPLETED') {
    return null;
  }
  const payload = event.payload as Record<string, unknown>;
  const hasAnswerStatus = event.eventType === 'CAPABILITY_RESULT_DELTA' ? payload.status === 'RECEIVED' : payload.status === 'SUCCEEDED';
  if (payload.capabilityId !== 'AskUserQuestion' || payload.kind !== 'QUESTION' || !hasAnswerStatus || readSupplementalInputId(event) === null) {
    return null;
  }
  const safeResult = readSafeCapabilityResult(payload.safeResult);
  return safeResult?.kind === 'pendingInputAnswer' ? safeResult : null;
}

function readSupplementalInputQuestions(value: unknown): readonly SupplementalInputQuestion[] | undefined {
  if (!Array.isArray(value) || value.length === 0) {
    return undefined;
  }
  const questions: SupplementalInputQuestion[] = [];
  for (const item of value) {
    if (item === null || typeof item !== 'object' || Array.isArray(item)) {
      return undefined;
    }
    const record = item as Record<string, unknown>;
    const prompt = readPayloadString(record, 'prompt');
    if (prompt === null) {
      return undefined;
    }
    if (
      (record.multiple !== undefined && typeof record.multiple !== 'boolean') ||
      (record.custom !== undefined && typeof record.custom !== 'boolean')
    ) {
      return undefined;
    }
    const options = new Map<string, string>();
    if (record.options !== undefined) {
      if (!Array.isArray(record.options)) {
        return undefined;
      }
      for (const option of record.options) {
        if (option === null || typeof option !== 'object' || Array.isArray(option)) {
          return undefined;
        }
        const optionRecord = option as Record<string, unknown>;
        const value = readPayloadString(optionRecord, 'value');
        const label = readPayloadString(optionRecord, 'label');
        if (value === null || label === null) {
          return undefined;
        }
        options.set(value, label);
      }
    }
    questions.push({
      prompt,
      options,
      multiple: record.multiple === true,
      custom: record.custom === true,
    });
  }
  return questions;
}

function supplementalInputKey(event: StreamEnvelope, pendingInputId: string): string {
  return `pending-input:${getEnvelopeRootMessageId(event)}:${getEnvelopeRunId(event)}:${pendingInputId}`;
}

function buildSupplementalInputDetail(state: SupplementalInputState, t: TFunction): string {
  const questions = state.questions;
  const answers = state.answers;
  if (questions === undefined || questions.length === 0) {
    const answerLines =
      answers?.map((group, index) => {
        const prefix = answers.length > 1 ? `${index + 1}. ` : '';
        return `${prefix}${t('turn.process.supplementalInputAnswerLabel')}: ${group.join(' / ')}`;
      }) ?? [];
    return [
      t('turn.process.supplementalInputQuestionUnavailable'),
      ...answerLines,
      state.truncated ? t('turn.process.supplementalInputTruncated') : null,
    ]
      .filter((line): line is string => line !== null)
      .join('\n');
  }

  const includeNumbers = questions.length > 1;
  const paired = questions.flatMap((question, index) => {
    const answerGroup = answers?.[index];
    const displayedAnswers = answerGroup?.map((answer) => question.options.get(answer) ?? answer);
    const prefix = includeNumbers ? `${index + 1}. ` : '';
    const inputModes = [
      question.options.size > 0
        ? t(question.multiple ? 'turn.process.supplementalInputMultipleSelect' : 'turn.process.supplementalInputSingleSelect')
        : null,
      question.options.size > 0 ? t('turn.process.supplementalInputCustomAllowed') : null,
    ].filter((mode): mode is string => mode !== null);
    return [
      `${prefix}${t('turn.process.supplementalInputQuestionLabel')}: ${question.prompt}`,
      question.options.size > 0 ? `${t('turn.process.supplementalInputOptionsLabel')}: ${[...question.options.values()].join(' / ')}` : null,
      inputModes.length > 0 ? `${t('turn.process.supplementalInputModeLabel')}: ${inputModes.join(' / ')}` : null,
      state.received || answers !== undefined
        ? `${t('turn.process.supplementalInputAnswerLabel')}: ${
            displayedAnswers && displayedAnswers.length > 0 ? displayedAnswers.join(' / ') : t('turn.process.supplementalInputAnswerUnavailable')
          }`
        : null,
    ].filter((line): line is string => line !== null);
  });
  return [...paired, state.truncated ? t('turn.process.supplementalInputTruncated') : null]
    .filter((line): line is string => line !== null)
    .join('\n');
}

function buildSupplementalInputStates(aiEvents: readonly StreamEnvelope[]): SupplementalInputState[] {
  const interactions = new Map<string, SupplementalInputState>();
  const presentationOrderByEvent = buildComposedActivityOrderByEnvelope(aiEvents);
  const supplementalEvents = sortProcessTimelineEvents(aiEvents).filter(
    (event) => isSupplementalInputStatusEvent(event) || isSupplementalInputTerminalEvent(event) || readSupplementalInputAnswer(event) !== null,
  );
  for (const event of supplementalEvents) {
    const answer = readSupplementalInputAnswer(event);
    const isTerminal = isSupplementalInputTerminalEvent(event);
    if (!isSupplementalInputStatusEvent(event) && !isTerminal && answer === null) {
      continue;
    }
    const pendingInputId = readSupplementalInputId(event);
    if (pendingInputId === null) {
      continue;
    }
    const key = supplementalInputKey(event, pendingInputId);
    const previous = interactions.get(key);
    if (isTerminal && previous === undefined) {
      continue;
    }
    const state: SupplementalInputState = previous ?? {
      key,
      pendingInputId,
      required: false,
      resolved: false,
      received: false,
      firstSequence: event.sequence,
      lastSequence: event.sequence,
      lastPresentationOrder: presentationOrderByEvent.get(event) ?? -1,
      firstCreatedAt: event.createdAt,
    };
    if (event.eventType === 'USER_INPUT_REQUIRED') {
      state.required = true;
      state.resolved = false;
      state.received = false;
      const questions = readSupplementalInputQuestions((event.payload as Record<string, unknown>).questions);
      if (questions !== undefined) {
        state.questions = questions;
      }
    }
    if (event.eventType === 'USER_INPUT_RECEIVED') {
      state.resolved = true;
      state.received = true;
    }
    if (answer !== null) {
      state.answers = answer.answers;
      state.truncated = answer.truncated;
      state.resolved = true;
      state.received = true;
    }
    if (isTerminal) {
      state.resolved = true;
    }
    state.lastSequence = Math.max(state.lastSequence, event.sequence);
    state.lastPresentationOrder = Math.max(state.lastPresentationOrder, presentationOrderByEvent.get(event) ?? -1);
    interactions.set(key, state);
  }

  return [...interactions.values()];
}

export function resolvePendingSupplementalInputKeys(aiEvents: readonly StreamEnvelope[]): readonly string[] {
  return buildSupplementalInputStates(aiEvents)
    .filter((state) => state.required && !state.resolved)
    .map((state) => state.key);
}

export function hasPendingSupplementalInput(aiEvents: readonly StreamEnvelope[]): boolean {
  return resolvePendingSupplementalInputKeys(aiEvents).length > 0;
}

function buildSupplementalInputEntries(aiEvents: readonly StreamEnvelope[], t: TFunction): ProcessEntry[] {
  return buildSupplementalInputStates(aiEvents).map((state) => {
    const detail = buildSupplementalInputDetail(state, t);
    return {
      key: state.key,
      title: state.resolved ? t('turn.process.supplementalInputTitle') : t('turn.process.supplementalInputWaitingTitle'),
      detail,
      rawDetail: detail,
      contentType: 'PLAIN_TEXT',
      toolName: null,
      kind: 'system',
      isFinal: state.resolved,
      sequence: state.firstSequence,
      lastSequence: state.lastSequence,
      lastPresentationOrder: state.lastPresentationOrder,
      createdAt: state.firstCreatedAt,
    };
  });
}

export function buildProcessEntries(
  aiEvents: readonly StreamEnvelope[],
  t: TFunction,
  presentationResources: CapabilityPresentationResourceMap = EMPTY_CAPABILITY_PRESENTATION_RESOURCES,
  locale = 'en-US',
): ProcessEntry[] {
  return buildReconciledProcessEntries(reconcileWorkflowProductFragments(aiEvents), t, presentationResources, locale);
}

function buildReconciledProcessEntries(
  aiEvents: readonly StreamEnvelope[],
  t: TFunction,
  presentationResources: CapabilityPresentationResourceMap,
  locale: string,
): ProcessEntry[] {
  const presentationOrderByEvent = buildComposedActivityOrderByEnvelope(aiEvents);
  const readPresentationOrder = (event: StreamEnvelope): number => presentationOrderByEvent.get(event) ?? -1;
  const systemEntries: ProcessEntry[] = [];
  const toolArgumentEntries = new Map<string, ToolProcessEntry>();
  const toolArgumentBuffers = new Map<string, string>();
  const toolEntries = new Map<string, ToolProcessEntry>();
  const capabilityBuffers = new Map<string, string>();
  const pendingToolArgumentKeys = new Map<string, string>();
  const structuredWorkflowTitles = collectStructuredWorkflowTitles(aiEvents);
  const failedWorkflowOccurrences = collectFailedWorkflowOccurrences(aiEvents);
  const thinkingEntries: ProcessEntry[] = [];
  const processContentEntries = new Map<string, ProcessEntry>();
  const hasFinalAssistantOutput = aiEvents.some((event) => {
    if (event.eventType !== 'LLM_CONTENT_DELTA') {
      return false;
    }
    const payload = event.payload as Record<string, unknown>;
    return payload.final === true && payload.role !== 'CAPABILITY_RESULT';
  });

  const structuredToolCallIds = new Set<string>();
  const structuredSubTitleToolCallIds = new Set<string>();
  const capabilityLifecycleToolCallIds = new Set<string>();
  const canonicallyCompletedToolCallIds = new Set<string>();
  const askUserQuestionToolCallIds = new Set<string>();
  for (const event of aiEvents) {
    const correlationId = readToolCorrelationId(event);
    if (event.eventType === 'TOOL_STRUCTURED_DELTA') {
      structuredToolCallIds.add(correlationId);
      const payload = event.payload as Record<string, unknown>;
      if (payload.toolEventType === 'SUB_TITLE' && typeof payload.workflowEventType !== 'string') {
        const explicitCorrelationId = readExplicitToolCorrelationId(event);
        if (explicitCorrelationId !== null) {
          structuredSubTitleToolCallIds.add(explicitCorrelationId);
        }
      }
    }
    if (
      (event.eventType === 'CAPABILITY_STARTED' || event.eventType === 'CAPABILITY_RESULT_DELTA' || event.eventType === 'CAPABILITY_COMPLETED') &&
      resolveWorkflowLifecyclePresentation(event) === null &&
      !isAskUserQuestionCapabilityEvent(event)
    ) {
      const explicitCorrelationId = readExplicitToolCorrelationId(event);
      if (explicitCorrelationId !== null) {
        capabilityLifecycleToolCallIds.add(explicitCorrelationId);
      }
    }
    if (event.eventType === 'CAPABILITY_STARTED' && isAskUserQuestionCapabilityEvent(event)) {
      askUserQuestionToolCallIds.add(correlationId);
    }
    if (
      event.eventType === 'CAPABILITY_COMPLETED' &&
      hasCanonicalCapabilityCompletionProjection(event) &&
      resolveWorkflowLifecyclePresentation(event) === null
    ) {
      canonicallyCompletedToolCallIds.add(correlationId);
    }
  }
  const runtimeCapabilityToolCallIds = new Set(
    [...structuredSubTitleToolCallIds].filter((toolCallId) => capabilityLifecycleToolCallIds.has(toolCallId)),
  );

  const structuredToolEntries: ProcessEntry[] = [];
  const structuredTitleEntryIndexes = new Map<string, number>();
  const structuredSubTitleEntryIndexes = new Map<string, number>();
  let lastStructuredTitleEntry: ProcessEntry | null = null;
  let lastStructuredSubTitleEntry: ProcessEntry | null = null;
  let activeThinking: ProcessEntry | null = null;

  const flushThinking = () => {
    if (activeThinking && activeThinking.detail.trim()) {
      thinkingEntries.push(activeThinking);
    }
    activeThinking = null;
  };

  const hasExplicitDegradationNotice = aiEvents.some((event) => {
    if (event.eventType !== 'DEGRADATION_NOTICE') {
      return false;
    }
    return readFailureErrorCodeFromPayload(event.payload as Record<string, unknown>) !== null || readProcessText(event).trim().length > 0;
  });
  // Dedup synthetic terminal-failure degradation entries by error code so that
  // a refresh merge (same REQUEST_FAILED with different eventIds) does not
  // produce duplicate degradation messages in the process panel.
  const seenTerminalFailureCodes = new Set<string>();

  const sortedProcessEvents = sortProcessTimelineEvents(aiEvents);
  const inputSegmentByEnvelope = buildInputSegmentByEnvelope(sortedProcessEvents);
  for (const event of sortedProcessEvents) {
    if (isToolCallStreamCompletion(event)) {
      clearPendingToolArgumentKeys(event, pendingToolArgumentKeys);
    }

    if (event.eventType === 'LLM_CONTENT_DELTA') {
      const completedStepId = readCompletedProcessContentStepId(event);
      const pendingStepId = hasFinalAssistantOutput ? null : readPendingProcessContentStepId(event);
      const stepId = completedStepId ?? pendingStepId;
      if (stepId !== null) {
        flushThinking();
        const detail = readProcessText(event);
        if (detail.trim().length > 0) {
          const inputSegment = inputSegmentByEnvelope.get(event) ?? 0;
          const baseKey = `process-content:${getEnvelopeRootMessageId(event)}:${getEnvelopeAttemptId(event)}:${stepId}`;
          const key = inputSegment === 0 ? baseKey : `${baseKey}:input:${inputSegment}`;
          const previous = processContentEntries.get(key);
          processContentEntries.set(key, {
            key,
            title: t('turn.process.executionNote'),
            detail,
            rawDetail: detail,
            contentType: readPayloadContentType(event.payload as Record<string, unknown>) ?? 'MARKDOWN',
            toolName: null,
            kind: 'process-explanation',
            isFinal: completedStepId !== null && isCompletedProcessContentEvent(event),
            isExpandable: false,
            sequence: previous?.sequence ?? event.sequence,
            lastSequence: event.sequence,
            lastPresentationOrder: Math.max(previous?.lastPresentationOrder ?? -1, readPresentationOrder(event)),
            createdAt: previous?.createdAt ?? event.createdAt,
          });
        }
      }
      continue;
    }
    if (TERMINAL_EVENTS.has(event.eventType)) {
      flushThinking();
      if (event.eventType === 'REQUEST_FAILED' && !hasExplicitDegradationNotice) {
        const terminalFailureEntry = buildTerminalFailureDegradationEntry(event, t);
        const terminalFailureCode = readFailureErrorCodeFromPayload(event.payload as Record<string, unknown>);
        if (terminalFailureEntry && terminalFailureCode !== null && !seenTerminalFailureCodes.has(terminalFailureCode)) {
          seenTerminalFailureCodes.add(terminalFailureCode);
          systemEntries.push({
            ...terminalFailureEntry,
            lastPresentationOrder: readPresentationOrder(event),
          });
        }
      }
      continue;
    }

    let detail = readProcessText(event);
    const toolName = readToolName(event);
    const payloadContentType = readPayloadContentType(event.payload as Record<string, unknown>);

    switch (event.eventType) {
      case 'LLM_THINKING_DELTA': {
        if (detail.length === 0) {
          break;
        }
        let previousThinkingDetail: string | null = null;
        let thinkingKey: string = buildThinkingEntryKey(event, thinkingEntries.length + 1);
        let thinkingSequence: number = event.sequence;
        let thinkingCreatedAt: WireTimestamp | null = event.createdAt;
        let thinkingContentType: StreamContentType | null = payloadContentType ?? 'PLAIN_TEXT';
        let thinkingPresentationOrder = readPresentationOrder(event);
        if (activeThinking) {
          previousThinkingDetail = activeThinking.detail;
          thinkingKey = activeThinking.key;
          thinkingSequence = activeThinking.sequence ?? event.sequence;
          thinkingCreatedAt = activeThinking.createdAt ?? event.createdAt;
          thinkingContentType = payloadContentType ?? activeThinking.contentType ?? 'PLAIN_TEXT';
          thinkingPresentationOrder = Math.max(activeThinking.lastPresentationOrder ?? -1, thinkingPresentationOrder);
        }
        const mergedThinkingDetail = mergeThinkingDetail(previousThinkingDetail, detail, event.payload as Record<string, unknown>);
        const isFinal = isFinalThinkingPayload(event.payload as Record<string, unknown>);
        activeThinking = {
          key: thinkingKey,
          title: t('turn.process.thinking'),
          detail: mergedThinkingDetail,
          rawDetail: mergedThinkingDetail,
          contentType: thinkingContentType,
          toolName: null,
          kind: 'thinking',
          isFinal,
          sequence: thinkingSequence,
          lastSequence: event.sequence,
          lastPresentationOrder: thinkingPresentationOrder,
          createdAt: thinkingCreatedAt,
        };
        if (isFinal) {
          flushThinking();
        }
        break;
      }
      case 'CAPABILITY_STARTED':
      case 'CAPABILITY_RESULT_DELTA':
      case 'CAPABILITY_COMPLETED': {
        flushThinking();
        if (event.eventType === 'CAPABILITY_STARTED') {
          detail = '';
        }
        if (readSupplementalInputAnswer(event) !== null) {
          break;
        }
        // AskUserQuestion lifecycle (CAPABILITY_STARTED through answer result)
        // is owned by the supplemental-input projection; skip generic tool rows
        // so the process list does not show a stale "AskUserQuestion · 执行中/已完成" entry.
        if (askUserQuestionToolCallIds.has(readToolCorrelationId(event)) || isAskUserQuestionCapabilityEvent(event)) {
          break;
        }
        if (isModelToolArgumentDelta(event)) {
          const correlationId = resolveToolArgumentCorrelationId(event, pendingToolArgumentKeys);
          if (!detail.trim()) {
            break;
          }
          const previousEntry = toolArgumentEntries.get(correlationId);
          const current = toolArgumentBuffers.get(correlationId) ?? '';
          detail = !current || !previousEntry ? detail : mergeStreamText(current, detail, event.payload as Record<string, unknown>);
          toolArgumentBuffers.set(correlationId, detail);
          toolArgumentEntries.set(correlationId, {
            key: correlationId,
            toolName: t('turn.process.toolCallPreparing'),
            detail: describeToolArgumentDetail(detail, t),
            rawDetail: detail,
            contentType: payloadContentType ?? previousEntry?.contentType ?? 'PLAIN_TEXT',
            isFinal: false,
            stateRank: resolveToolStateRank('CAPABILITY_RESULT_DELTA'),
            firstSequence: previousEntry?.firstSequence ?? event.sequence,
            firstCreatedAt: previousEntry?.firstCreatedAt ?? event.createdAt,
            lastSequence: event.sequence,
            lastPresentationOrder: Math.max(previousEntry?.lastPresentationOrder ?? -1, readPresentationOrder(event)),
          });
          break;
        }

        const correlationId = readToolCorrelationId(event);
        const workflowLifecyclePresentation = resolveWorkflowLifecyclePresentation(event);
        if (workflowLifecyclePresentation === 'hidden') {
          break;
        }
        const structuredWorkflowTitle = structuredWorkflowTitles.get(correlationId);
        if (workflowLifecyclePresentation === 'titled-terminal') {
          if (structuredWorkflowTitle === undefined) {
            break;
          }
          const structuredEntryIndex = structuredSubTitleEntryIndexes.get(correlationId) ?? structuredTitleEntryIndexes.get(correlationId);
          const structuredEntry = structuredEntryIndex === undefined ? undefined : structuredToolEntries[structuredEntryIndex];
          if (structuredEntryIndex !== undefined && structuredEntry !== undefined) {
            const updatedEntry: ProcessEntry = {
              ...structuredEntry,
              title: formatToolProcessTitle(structuredWorkflowTitle, resolveToolLifecycleStatus(event, t)),
              isFinal: true,
              lastSequence: event.sequence,
              lastPresentationOrder: Math.max(structuredEntry.lastPresentationOrder ?? -1, readPresentationOrder(event)),
            };
            structuredToolEntries[structuredEntryIndex] = updatedEntry;
            if (lastStructuredSubTitleEntry?.key === structuredEntry.key) {
              lastStructuredSubTitleEntry = updatedEntry;
            }
            if (lastStructuredTitleEntry?.key === structuredEntry.key) {
              lastStructuredTitleEntry = updatedEntry;
            }
          }
          break;
        }
        const previousEntry = toolEntries.get(correlationId);
        if (
          (event.eventType === 'CAPABILITY_STARTED' ||
            (event.eventType === 'CAPABILITY_COMPLETED' && !canonicallyCompletedToolCallIds.has(correlationId))) &&
          structuredToolCallIds.has(correlationId) &&
          !runtimeCapabilityToolCallIds.has(correlationId) &&
          workflowLifecyclePresentation !== 'titled-terminal'
        ) {
          break;
        }
        const nextStateRank = resolveToolStateRank(event.eventType);
        const targetName = readCapabilityTargetName(event);
        let normalizedToolName: string;
        if (targetName !== null) {
          normalizedToolName = displayCapabilityName(event, toolName ?? t('turn.process.unknownTool'));
        } else {
          normalizedToolName = previousEntry?.toolName ?? displayToolName(toolName ?? t('turn.process.unknownTool'));
        }
        const resolvedProcessTitle = resolveCapabilityProcessTitle(
          readCapabilityTitleIdentity(event),
          (key, options) => String(t(key, options as never)),
          locale,
          presentationResources,
        );
        const nextProcessTitle =
          event.eventType === 'CAPABILITY_RESULT_DELTA' && previousEntry !== undefined ? previousEntry.processTitle : resolvedProcessTitle;
        let nextContentType = payloadContentType ?? previousEntry?.contentType ?? 'PLAIN_TEXT';
        let nextSummary = previousEntry?.summary;
        let nextIsExpandable = previousEntry?.isExpandable;
        let nextIsFailure = previousEntry?.isFailure;
        let nextDetailFromSafeResult = previousEntry?.detailFromSafeResult;
        let nextRagRetrievalItems = previousEntry?.ragRetrievalItems;
        let nextStatusFromSafeResult = previousEntry?.statusFromSafeResult;
        let nextStatusLabel = previousEntry?.statusFromSafeResult
          ? previousEntry.statusLabel
          : (resolveToolLifecycleStatus(event, t) ?? previousEntry?.statusLabel);
        const payloadSafeResult = readSafeCapabilityResult((event.payload as Record<string, unknown>).safeResult);
        const completionRepeatsCommandOutput =
          event.eventType === 'CAPABILITY_COMPLETED' &&
          payloadSafeResult?.kind === 'commandOutput' &&
          runtimeCapabilityToolCallIds.has(correlationId);
        let genericToolResult = describeGenericToolResult(event, detail, t, completionRepeatsCommandOutput);
        if (completionRepeatsCommandOutput && previousEntry?.resultFromCapabilityDelta === true) {
          genericToolResult = null;
        }

        if (
          event.eventType === 'CAPABILITY_COMPLETED' &&
          readPayloadBooleanFlag(event.payload as Record<string, unknown>, 'contentUnavailable') === true
        ) {
          detail = '';
          nextSummary = undefined;
          nextIsExpandable = false;
          nextDetailFromSafeResult = true;
          nextContentType = 'PLAIN_TEXT';
          capabilityBuffers.delete(correlationId);
        } else if (genericToolResult) {
          detail = genericToolResult.detail;
          nextSummary = genericToolResult.summary;
          nextIsExpandable = genericToolResult.isExpandable ?? true;
          nextIsFailure = genericToolResult.isFailure;
          nextDetailFromSafeResult = genericToolResult.detailFromSafeResult;
          nextRagRetrievalItems = genericToolResult.ragRetrievalItems;
          if (genericToolResult.statusLabel) {
            nextStatusLabel = genericToolResult.statusLabel;
            nextStatusFromSafeResult = true;
          }
          nextContentType = 'PLAIN_TEXT';
          capabilityBuffers.set(correlationId, detail);
        } else if (event.eventType === 'CAPABILITY_RESULT_DELTA') {
          detail = '';
          nextIsExpandable = false;
          nextDetailFromSafeResult = true;
          nextContentType = 'PLAIN_TEXT';
          capabilityBuffers.delete(correlationId);
        } else if (event.eventType === 'CAPABILITY_COMPLETED') {
          const bufferedDetail = capabilityBuffers.get(correlationId) ?? '';
          const completionHasNoResult = !bufferedDetail.trim() && (!detail.trim() || isGenericCapabilityCompletionText(detail, normalizedToolName));
          if (completionHasNoResult) {
            detail = '';
            nextSummary = undefined;
            nextIsExpandable = false;
            nextDetailFromSafeResult = true;
            nextContentType = 'PLAIN_TEXT';
          } else if (!detail.trim() || (bufferedDetail.trim() && isGenericCapabilityCompletionText(detail, normalizedToolName))) {
            detail = bufferedDetail || detail;
            nextContentType = previousEntry?.contentType ?? nextContentType;
          }
        }
        if (event.eventType === 'CAPABILITY_COMPLETED' && previousEntry?.summary && previousEntry.isExpandable) {
          detail = previousEntry.detailFromSafeResult ? detail : appendInvocationStatusDetail(detail, resolveResultInvocationStatus(event, t), t);
          capabilityBuffers.set(correlationId, detail);
        }

        const isHistoricalResult = event.eventType === 'CAPABILITY_RESULT_DELTA' && isHistoricalCapabilityResult(event);
        const isFinal = event.eventType === 'CAPABILITY_COMPLETED' || isHistoricalResult;
        const effectiveStateRank = isFinal ? resolveToolStateRank('CAPABILITY_COMPLETED') : nextStateRank;
        if (previousEntry && previousEntry.isFinal && !isFinal) {
          break;
        }
        if (previousEntry && effectiveStateRank < previousEntry.stateRank) {
          break;
        }
        toolEntries.set(correlationId, {
          key: correlationId,
          parentToolCallId: readParentToolCallId(event) ?? previousEntry?.parentToolCallId,
          toolName: normalizedToolName,
          processTitle: nextProcessTitle,
          statusLabel: nextStatusLabel,
          statusFromSafeResult: nextStatusFromSafeResult,
          summary: nextSummary,
          detail: nextDetailFromSafeResult ? detail : describeToolDetail(event, detail, t),
          rawDetail: detail,
          contentType: nextContentType,
          isFinal,
          isExpandable: nextIsExpandable,
          isFailure: nextIsFailure,
          detailFromSafeResult: nextDetailFromSafeResult,
          ragRetrievalItems: nextRagRetrievalItems,
          resultFromCapabilityDelta:
            previousEntry?.resultFromCapabilityDelta === true || (event.eventType === 'CAPABILITY_RESULT_DELTA' && genericToolResult !== null),
          stateRank: effectiveStateRank,
          firstSequence: previousEntry?.firstSequence ?? event.sequence,
          firstCreatedAt: previousEntry?.firstCreatedAt ?? event.createdAt,
          lastSequence: event.sequence,
          lastPresentationOrder: Math.max(previousEntry?.lastPresentationOrder ?? -1, readPresentationOrder(event)),
        });
        break;
      }
      case 'DEGRADATION_NOTICE':
        flushThinking();
        {
          const presentation = resolveSystemEventPresentation(event.eventType, event.payload as Record<string, unknown>, t);
          const degradationResult = describeSystemEventResult(event, t);
          const degradationDetail = degradationResult.detail;
          if (!degradationDetail.trim()) {
            break;
          }
          systemEntries.push({
            key: event.eventId,
            title: presentation.title,
            summary: degradationResult.summary,
            detail: degradationDetail,
            rawDetail: degradationDetail,
            contentType: payloadContentType ?? 'PLAIN_TEXT',
            toolName: null,
            kind: 'system',
            presentation: 'governed-system-event',
            severity: presentation.severity,
            isFinal: true,
            isExpandable: degradationResult.isExpandable,
            sequence: event.sequence,
            lastSequence: event.sequence,
            lastPresentationOrder: readPresentationOrder(event),
            createdAt: event.createdAt,
          });
        }
        break;
      case 'HOOK_DEGRADED': {
        flushThinking();
        const presentation = resolveSystemEventPresentation(event.eventType, event.payload as Record<string, unknown>, t);
        systemEntries.push({
          key: event.eventId,
          title: presentation.title,
          summary: presentation.summary,
          detail: presentation.summary,
          rawDetail: presentation.summary,
          contentType: 'PLAIN_TEXT',
          toolName: null,
          kind: 'system',
          presentation: 'governed-system-event',
          severity: presentation.severity,
          isFinal: true,
          isExpandable: false,
          sequence: event.sequence,
          lastSequence: event.sequence,
          lastPresentationOrder: readPresentationOrder(event),
          createdAt: event.createdAt,
        });
        break;
      }
      case 'CONTEXT_COMPACTED': {
        flushThinking();
        const presentation = resolveSystemEventPresentation(event.eventType, event.payload as Record<string, unknown>, t);
        systemEntries.push({
          key: event.eventId,
          title: presentation.title,
          summary: presentation.summary,
          detail: presentation.summary,
          rawDetail: presentation.summary,
          contentType: 'PLAIN_TEXT',
          toolName: null,
          kind: 'system',
          presentation: 'governed-system-event',
          severity: presentation.severity,
          isFinal: true,
          isExpandable: false,
          sequence: event.sequence,
          lastSequence: event.sequence,
          lastPresentationOrder: readPresentationOrder(event),
          createdAt: event.createdAt,
        });
        break;
      }
      case 'USER_INPUT_REQUIRED': {
        flushThinking();
        if (isSupplementalInputStatusEvent(event)) {
          break;
        }
        const prompt = readNamedPayloadText(event, ['prompt', 'content', 'message']) || detail;
        systemEntries.push({
          key: event.eventId,
          title: t('turn.process.waitingInputTitle'),
          detail: prompt || t('turn.process.waitingInputDetail'),
          rawDetail: prompt || t('turn.process.waitingInputDetail'),
          contentType: payloadContentType ?? 'PLAIN_TEXT',
          toolName: null,
          kind: 'system',
          isFinal: true,
          sequence: event.sequence,
          lastSequence: event.sequence,
          lastPresentationOrder: readPresentationOrder(event),
          createdAt: event.createdAt,
        });
        break;
      }
      case 'USER_INPUT_RECEIVED': {
        flushThinking();
        if (isSupplementalInputStatusEvent(event)) {
          break;
        }
        const responseText = readNamedPayloadText(event, ['value', 'response', 'content']) || detail;
        systemEntries.push({
          key: event.eventId,
          title: t('turn.process.userResponseTitle'),
          detail: responseText || t('turn.process.userResponseDetail'),
          rawDetail: responseText || t('turn.process.userResponseDetail'),
          contentType: payloadContentType ?? 'PLAIN_TEXT',
          toolName: null,
          kind: 'system',
          isFinal: true,
          sequence: event.sequence,
          lastSequence: event.sequence,
          lastPresentationOrder: readPresentationOrder(event),
          createdAt: event.createdAt,
        });
        break;
      }
      case 'USER_INPUT_TIMEOUT':
        flushThinking();
        systemEntries.push({
          key: event.eventId,
          title: t('turn.process.inputTimeoutTitle'),
          detail: detail || t('turn.process.inputTimeoutDetail'),
          rawDetail: detail || t('turn.process.inputTimeoutDetail'),
          contentType: payloadContentType ?? 'PLAIN_TEXT',
          toolName: null,
          kind: 'system',
          isFinal: true,
          sequence: event.sequence,
          lastSequence: event.sequence,
          lastPresentationOrder: readPresentationOrder(event),
          createdAt: event.createdAt,
        });
        break;
      case 'USER_INPUT_CANCELED':
        flushThinking();
        systemEntries.push({
          key: event.eventId,
          title: t('turn.process.inputCanceledTitle'),
          detail: detail || t('turn.process.inputCanceledDetail'),
          rawDetail: detail || t('turn.process.inputCanceledDetail'),
          contentType: payloadContentType ?? 'PLAIN_TEXT',
          toolName: null,
          kind: 'system',
          isFinal: true,
          sequence: event.sequence,
          lastSequence: event.sequence,
          lastPresentationOrder: readPresentationOrder(event),
          createdAt: event.createdAt,
        });
        break;
      case 'REQUEST_ACCEPTED':
      case 'ATTACHMENT_ACCEPTED':
      case 'ATTACHMENT_REJECTED':
        break;
      case 'TOOL_STRUCTURED_DELTA': {
        flushThinking();
        if (canonicallyCompletedToolCallIds.has(readToolCorrelationId(event)) && !runtimeCapabilityToolCallIds.has(readToolCorrelationId(event))) {
          break;
        }
        const parsed = parseStructuredDeltaEvent(event);
        if (!parsed) {
          break;
        }
        const { toolEventType, toolMessageType, contentText } = parsed;
        const workflowOccurrenceId = readWorkflowOccurrenceCorrelationId(event);
        if (
          workflowOccurrenceId !== null &&
          failedWorkflowOccurrences.has(workflowOccurrenceId) &&
          !structuredWorkflowTitles.has(workflowOccurrenceId) &&
          toolEventType !== 'TITLE' &&
          toolEventType !== 'SUB_TITLE'
        ) {
          break;
        }
        if (toolEventType === 'TITLE') {
          const entry: ProcessEntry = {
            key: event.eventId,
            title: contentText,
            detail: '',
            rawDetail: '',
            contentType: 'PLAIN_TEXT',
            toolName: null,
            kind: 'tool',
            isFinal: false,
            sequence: event.sequence,
            lastSequence: event.sequence,
            lastPresentationOrder: readPresentationOrder(event),
            createdAt: event.createdAt,
            toolEventType: 'TITLE',
            toolCallId: readExplicitToolCorrelationId(event) ?? undefined,
            parentToolCallId: readParentToolCallId(event),
          };
          structuredToolEntries.push(entry);
          structuredTitleEntryIndexes.set(readToolCorrelationId(event), structuredToolEntries.length - 1);
          lastStructuredTitleEntry = entry;
          lastStructuredSubTitleEntry = null;
        } else if (toolEventType === 'SUB_TITLE') {
          const entry: ProcessEntry = {
            key: event.eventId,
            title: contentText,
            detail: '',
            rawDetail: '',
            contentType: 'PLAIN_TEXT',
            toolName: null,
            kind: 'tool',
            isFinal: false,
            sequence: event.sequence,
            lastSequence: event.sequence,
            lastPresentationOrder: readPresentationOrder(event),
            createdAt: event.createdAt,
            toolEventType: 'SUB_TITLE',
            toolCallId: readExplicitToolCorrelationId(event) ?? undefined,
            parentToolCallId: readParentToolCallId(event),
          };
          structuredToolEntries.push(entry);
          structuredSubTitleEntryIndexes.set(readToolCorrelationId(event), structuredToolEntries.length - 1);
          lastStructuredSubTitleEntry = entry;
        } else if (toolEventType === 'DETAIL') {
          const correlationId = readExplicitToolCorrelationId(event);
          const idx: number | undefined = resolveStructuredDetailEntryIndex<ProcessEntry>(
            correlationId,
            structuredTitleEntryIndexes,
            structuredToolEntries,
            lastStructuredTitleEntry,
          );
          if (idx !== undefined) {
            const ce: ProcessEntry | undefined = structuredToolEntries[idx];
            if (ce === undefined) {
              break;
            }
            const nextSegments = appendProcessDetailSegment(
              ce.structuredSegments ?? [],
              parsed,
              event.sequence,
              structuredDetailPayload(event.payload),
            );
            const nd = toolMessageType === 'TEXT' ? mergeStreamText(ce.detail, contentText, structuredDetailPayload(event.payload)) : ce.detail;
            const updatedEntry: ProcessEntry = {
              ...ce,
              detail: nd,
              rawDetail: nd,
              structuredSegments: nextSegments,
              lastSequence: event.sequence,
              lastPresentationOrder: Math.max(ce.lastPresentationOrder ?? -1, readPresentationOrder(event)),
            };
            structuredToolEntries[idx] = updatedEntry;
            if (lastStructuredTitleEntry?.key === ce.key) {
              lastStructuredTitleEntry = updatedEntry;
            }
          } else {
            const entry = buildStandaloneStructuredProcessEntry(event, parsed, readPresentationOrder(event));
            structuredToolEntries.push(entry);
            lastStructuredTitleEntry = entry;
            lastStructuredSubTitleEntry = null;
            structuredTitleEntryIndexes.set(readToolCorrelationId(event), structuredToolEntries.length - 1);
          }
        } else if (toolEventType === 'SUB_DETAIL' || toolEventType === 'SUB_CONCLUSION') {
          const correlationId = readExplicitToolCorrelationId(event);
          const idx: number | undefined = resolveStructuredDetailEntryIndex<ProcessEntry>(
            correlationId,
            structuredSubTitleEntryIndexes,
            structuredToolEntries,
            lastStructuredSubTitleEntry,
          );
          if (idx !== undefined) {
            const ce: ProcessEntry | undefined = structuredToolEntries[idx];
            if (ce === undefined) {
              break;
            }
            const nextSegments = appendProcessDetailSegment(
              ce.structuredSegments ?? [],
              parsed,
              event.sequence,
              structuredDetailPayload(event.payload),
            );
            const nd = toolMessageType === 'TEXT' ? mergeStreamText(ce.detail, contentText, structuredDetailPayload(event.payload)) : ce.detail;
            const updatedEntry: ProcessEntry = {
              ...ce,
              detail: nd,
              rawDetail: nd,
              structuredSegments: nextSegments,
              lastSequence: event.sequence,
              lastPresentationOrder: Math.max(ce.lastPresentationOrder ?? -1, readPresentationOrder(event)),
            };
            structuredToolEntries[idx] = updatedEntry;
            if (lastStructuredSubTitleEntry?.key === ce.key) {
              lastStructuredSubTitleEntry = updatedEntry;
            }
          } else if (readWorkflowOccurrenceCorrelationId(event) !== null) {
            const entry = buildStandaloneStructuredProcessEntry(event, parsed, readPresentationOrder(event));
            structuredToolEntries.push(entry);
            structuredSubTitleEntryIndexes.set(readToolCorrelationId(event), structuredToolEntries.length - 1);
            lastStructuredSubTitleEntry = entry;
          } else if (lastStructuredTitleEntry !== null) {
            const ce: ProcessEntry = lastStructuredTitleEntry;
            const titleIndex = structuredToolEntries.indexOf(ce);
            if (titleIndex >= 0) {
              const nextSegments = appendProcessDetailSegment(
                ce.structuredSegments ?? [],
                parsed,
                event.sequence,
                structuredDetailPayload(event.payload),
              );
              const nextDetail =
                toolMessageType === 'TEXT' ? mergeStreamText(ce.detail, contentText, structuredDetailPayload(event.payload)) : ce.detail;
              const updatedEntry: ProcessEntry = {
                ...ce,
                detail: nextDetail,
                rawDetail: nextDetail,
                structuredSegments: nextSegments,
                lastSequence: event.sequence,
                lastPresentationOrder: Math.max(ce.lastPresentationOrder ?? -1, readPresentationOrder(event)),
              };
              structuredToolEntries[titleIndex] = updatedEntry;
              lastStructuredTitleEntry = updatedEntry;
            }
          }
        } else if (toolEventType === 'EXPAND_PANEL') {
          const correlationId = readExplicitToolCorrelationId(event);
          const idx: number | undefined =
            correlationId !== null
              ? structuredTitleEntryIndexes.get(correlationId)
              : lastStructuredTitleEntry === null
                ? undefined
                : structuredToolEntries.indexOf(lastStructuredTitleEntry);
          if (idx !== undefined) {
            const ce: ProcessEntry | undefined = structuredToolEntries[idx];
            if (ce === undefined) {
              break;
            }
            const prevExpandData = ce.expandPanelData;
            const isAccumulatingText =
              toolMessageType === 'TEXT' && prevExpandData?.toolMessageType === 'TEXT' && typeof prevExpandData?.content === 'string';
            const expandContent =
              isAccumulatingText && typeof prevExpandData?.content === 'string' ? prevExpandData.content + contentText : parsed.rawContent;
            const updatedEntry: ProcessEntry = {
              ...ce,
              expandPanelData: {
                toolMessageType: parsed.toolMessageType as ToolMessageType,
                content: expandContent,
              },
              hasExpandPanel: true,
              lastSequence: event.sequence,
              lastPresentationOrder: Math.max(ce.lastPresentationOrder ?? -1, readPresentationOrder(event)),
            };
            structuredToolEntries[idx] = updatedEntry;
            if (lastStructuredTitleEntry?.key === ce.key) {
              lastStructuredTitleEntry = updatedEntry;
            }
          }
        }
        // ANSWER does not create a process panel entry.
        break;
      }
      default:
        flushThinking();
        if (detail.trim()) {
          systemEntries.push({
            key: event.eventId,
            title: t('turn.process.runEventTitle'),
            detail,
            rawDetail: detail,
            contentType: payloadContentType ?? 'PLAIN_TEXT',
            toolName,
            kind: 'system',
            isFinal: true,
            sequence: event.sequence,
            lastSequence: event.sequence,
            lastPresentationOrder: readPresentationOrder(event),
            createdAt: event.createdAt,
          });
        }
        break;
    }
  }

  const aggregatedEntries: ProcessEntry[] = [];
  const structuredSectionsByToolCallId = new Map<string, ProcessStructuredSection[]>();
  const standaloneStructuredEntries: ProcessEntry[] = [];
  for (const entry of structuredToolEntries) {
    if (entry.toolCallId === undefined || !runtimeCapabilityToolCallIds.has(entry.toolCallId)) {
      standaloneStructuredEntries.push(entry);
      continue;
    }
    const sections = structuredSectionsByToolCallId.get(entry.toolCallId) ?? [];
    sections.push({
      key: entry.key,
      title: entry.title,
      detail: entry.detail,
      rawDetail: entry.rawDetail,
      contentType: entry.contentType,
      sequence: entry.sequence ?? 0,
      lastSequence: entry.lastSequence ?? entry.sequence ?? 0,
      lastPresentationOrder: entry.lastPresentationOrder ?? -1,
      toolEventType: entry.toolEventType,
      structuredSegments: entry.structuredSegments,
      expandPanelData: entry.expandPanelData,
      hasExpandPanel: entry.hasExpandPanel,
    });
    structuredSectionsByToolCallId.set(entry.toolCallId, sections);
  }
  flushThinking();
  systemEntries.push(...buildSupplementalInputEntries(aiEvents, t));
  aggregatedEntries.push(...thinkingEntries);
  aggregatedEntries.push(...processContentEntries.values());
  for (const toolArgumentEntry of toolArgumentEntries.values()) {
    if (!toolArgumentEntry.detail.trim()) {
      continue;
    }
    aggregatedEntries.push({
      key: toolArgumentEntry.key,
      title: toolArgumentEntry.toolName,
      summary: toolArgumentEntry.summary,
      detail: toolArgumentEntry.detail,
      rawDetail: toolArgumentEntry.rawDetail,
      contentType: toolArgumentEntry.contentType,
      toolName: toolArgumentEntry.toolName,
      kind: 'tool',
      isFinal: toolArgumentEntry.isFinal,
      isExpandable: toolArgumentEntry.isExpandable,
      sequence: toolArgumentEntry.firstSequence,
      lastSequence: toolArgumentEntry.lastSequence,
      lastPresentationOrder: toolArgumentEntry.lastPresentationOrder,
      createdAt: toolArgumentEntry.firstCreatedAt,
    });
  }
  for (const toolEntry of toolEntries.values()) {
    const structuredSections = structuredSectionsByToolCallId.get(toolEntry.key) ?? [];
    const lastStructuredSequence = structuredSections.at(-1)?.lastSequence ?? -1;
    const lastStructuredPresentationOrder = structuredSections.at(-1)?.lastPresentationOrder ?? -1;
    aggregatedEntries.push({
      key: toolEntry.key,
      title: formatToolProcessTitle(toolEntry.processTitle ?? toolEntry.toolName, toolEntry.statusLabel),
      summary: toolEntry.summary,
      detail: toolEntry.detail,
      rawDetail: toolEntry.rawDetail,
      contentType: toolEntry.contentType,
      toolName: toolEntry.toolName,
      kind: 'tool',
      isFinal: toolEntry.isFinal,
      isExpandable: structuredSections.length > 0 ? true : toolEntry.isExpandable,
      isFailure: toolEntry.isFailure,
      ragRetrievalItems: toolEntry.ragRetrievalItems,
      sequence: toolEntry.firstSequence,
      lastSequence: Math.max(toolEntry.lastSequence, lastStructuredSequence),
      lastPresentationOrder: Math.max(toolEntry.lastPresentationOrder, lastStructuredPresentationOrder),
      createdAt: toolEntry.firstCreatedAt,
      toolCallId: toolEntry.key,
      parentToolCallId: toolEntry.parentToolCallId,
      ...(structuredSections.length === 0 ? {} : { structuredSections }),
    });
  }
  aggregatedEntries.push(...systemEntries);
  aggregatedEntries.push(...standaloneStructuredEntries);
  return decorateRepeatedToolEntries(
    aggregatedEntries
      .filter(
        (entry) =>
          entry.detail.trim().length > 0 ||
          (entry.structuredSegments?.length ?? 0) > 0 ||
          (entry.kind === 'tool' && entry.toolName !== null) ||
          (entry.toolEventType !== undefined && entry.title.trim().length > 0),
      )
      .sort(compareProcessEntries),
    t,
  );
}

function hasCanonicalCapabilityCompletionProjection(event: StreamEnvelope): boolean {
  const payload = event.payload as Record<string, unknown>;
  if (
    readPayloadBooleanFlag(payload, 'contentUnavailable') === true ||
    (typeof payload.safeResult === 'object' && payload.safeResult !== null) ||
    (typeof payload.safeSummaryCode === 'string' && payload.safeSummaryCode.trim().length > 0) ||
    (typeof payload.safeSummary === 'string' && payload.safeSummary.trim().length > 0)
  ) {
    return true;
  }
  const toolName = displayToolName(readToolName(event) ?? '');
  const completionTexts = [payload.content, payload.text].filter((value): value is string => typeof value === 'string' && value.trim().length > 0);
  return completionTexts.some((text) => !isGenericCapabilityCompletionText(text, toolName));
}

export function resolveExecutionDetailsPhase(status: TurnBlock['status'], _processEntries: readonly ProcessEntry[]): ExecutionDetailsPhase {
  if (status === 'ACCEPTED' || status === 'QUEUED' || status === 'PLANNING' || status === 'EXECUTING') {
    return 'running';
  }
  return 'settled';
}

function labelRunStatus(status: TurnBlock['status'], phase: ExecutionDetailsPhase, t: TFunction): string {
  if (phase !== 'settled') {
    if (status === 'ACCEPTED') {
      return t('runTimeline.accepted');
    }
    if (status === 'QUEUED') {
      return t('runTimeline.queued');
    }
    if (status === 'PLANNING') {
      return t('runTimeline.planning');
    }
    if (status === 'EXECUTING') {
      return t('runTimeline.executing');
    }
    return t('turn.process.running');
  }
  if (status === 'FAILED') {
    return t('turn.process.failed');
  }
  if (status === 'CANCELED') {
    return t('turn.process.canceledByUser');
  }
  if (status === 'SUPERSEDED') {
    return t('turn.process.superseded');
  }
  return t('turn.process.completed');
}

export function buildProcessSummary(status: TurnBlock['status'], phase: ExecutionDetailsPhase, t: TFunction): string {
  return t('turn.process.summary', { status: labelRunStatus(status, phase, t) });
}

function isEnglishProcessLocale(t: TFunction): boolean {
  return t('turn.process.completed') === 'Completed';
}

function trimPreviewText(text: string, maxLength: number): string {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, maxLength - 3).trimEnd()}...`;
}

function extractProcessDetailPrefix(detail: string, rawDetail: string): string {
  const raw = rawDetail.trim();
  if (!raw) {
    return '';
  }
  const rawStart = detail.indexOf(raw);
  if (rawStart <= 0) {
    return '';
  }
  return detail
    .slice(0, rawStart)
    .replace(/[\s·路]+$/u, '')
    .trim();
}

function extractPlainProcessPreview(content: string): string {
  const text = content
    .split(/\r\n|\r|\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .filter((line) => !line.startsWith('|'))
    .filter((line) => !/^:?-{2,}:?$/.test(line))
    .filter((line) => !line.startsWith('```'))
    .map((line) =>
      line
        .replace(/^#{1,6}\s+/, '')
        .replace(/^[*-]\s+/, '')
        .replace(/^\d+[.)]\s+/, '')
        .trim(),
    )
    .filter((line) => line.length > 0)
    .join(' ');

  const sentenceEnd = text.search(/[。！？.!?]/);
  return sentenceEnd >= 20 ? text.slice(0, sentenceEnd + 1) : text;
}

function summarizeToolRawDetail(rawDetail: string, toolName: string | null, t: TFunction): string {
  const normalized = rawDetail.replace(/\s+/g, ' ').trim();
  if (!normalized) {
    return '';
  }

  const lowerDetail = normalized.toLowerCase();
  const lowerToolName = (toolName ?? '').toLowerCase();
  if (
    lowerToolName.includes('network') ||
    lowerDetail.includes('device health summary') ||
    lowerDetail.includes('alarm aggregation') ||
    lowerDetail.includes('kpi trend')
  ) {
    return isEnglishProcessLocale(t)
      ? 'Device health, alarm aggregation, and KPI trend diagnostics are ready.'
      : '设备健康、告警聚合和 KPI 趋势诊断已生成。';
  }

  const preview = extractPlainProcessPreview(rawDetail);
  if (preview) {
    return trimPreviewText(preview, 160);
  }
  return isEnglishProcessLocale(t) ? 'Tool output is available.' : '工具输出已生成。';
}

function isLongProcessDetail(entry: ProcessEntry): boolean {
  if (entry.kind !== 'tool') {
    return false;
  }

  const rawDetail = entry.rawDetail?.trim() ?? '';
  if (!rawDetail) {
    return false;
  }

  return (
    rawDetail.length >= LONG_PROCESS_DETAIL_MIN_LENGTH ||
    rawDetail.split(/\r\n|\r|\n/).length >= LONG_PROCESS_DETAIL_MIN_LINES ||
    entry.contentType === 'MARKDOWN'
  );
}

export function shouldRenderProcessDetailAsMarkdown(entry: ProcessDisplayEntry): boolean {
  return (
    entry.contentType === 'MARKDOWN' ||
    /^#{1,6}\s+/m.test(entry.detail) ||
    /(^|\n)\s*\|.+\|\s*(\n|$)/.test(entry.detail) ||
    /(^|\n)\s*```/.test(entry.detail)
  );
}

export function buildProcessDisplayEntries(entries: readonly ProcessEntry[], t: TFunction): ProcessDisplayEntry[] {
  return entries.map((entry) => {
    const rawDetail = entry.rawDetail?.trim() ?? '';
    const detail = rawDetail || entry.detail;
    const isExpandable = entry.isExpandable ?? isLongProcessDetail(entry);
    const prefix = isExpandable ? extractProcessDetailPrefix(entry.detail, rawDetail) : '';
    const canDeriveSummary = entry.kind !== 'tool' || entry.toolEventType !== undefined;
    const summary =
      entry.summary ??
      (canDeriveSummary
        ? isExpandable
          ? [prefix, summarizeToolRawDetail(rawDetail, entry.toolName, t)].filter((part) => part.length > 0).join(' · ')
          : entry.detail
        : '');

    return {
      key: entry.key,
      title: entry.title,
      toolName: entry.toolName,
      summary,
      detail,
      contentType: entry.contentType,
      kind: entry.kind,
      isFinal: entry.isFinal,
      lastSequence: entry.lastSequence ?? entry.sequence,
      lastPresentationOrder: entry.lastPresentationOrder,
      isExpandable,
      isFailure: entry.isFailure,
      severity: entry.severity,
      toolEventType: entry.toolEventType,
      expandPanelData: entry.expandPanelData,
      hasExpandPanel: entry.hasExpandPanel,
      structuredSegments: entry.structuredSegments,
      structuredSections: entry.structuredSections,
      ragRetrievalItems: entry.ragRetrievalItems,
      toolCallId: entry.toolCallId,
      parentToolCallId: entry.parentToolCallId,
      presentation: entry.presentation,
    };
  });
}

export function isProcessEntryVisuallySuperseded(entry: ProcessDisplayEntry, latestAssistantAnswerPresentationOrder: number | null): boolean {
  return latestAssistantAnswerPresentationOrder !== null && (entry.lastPresentationOrder ?? -1) < latestAssistantAnswerPresentationOrder;
}

export function resolveActiveProcessEntryKey(entries: readonly ProcessDisplayEntry[]): string | null {
  let latestEntry: ProcessDisplayEntry | null = null;
  for (const entry of entries) {
    if (!latestEntry) {
      latestEntry = entry;
      continue;
    }
    const entrySequence = entry.lastSequence ?? -1;
    const latestSequence = latestEntry.lastSequence ?? -1;
    if (entrySequence >= latestSequence) {
      latestEntry = entry;
    }
  }

  return latestEntry && latestEntry.isFinal !== true ? latestEntry.key : null;
}
