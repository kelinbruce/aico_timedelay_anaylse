import { brand, type AgentVersion, type EpochMillis, type IdempotencyKey, type JsonObject, type SafeError } from '@nextagent/agent-common';
import type {
  IdempotentWriteOptions,
  RequestRunRecord,
  RequestRunStoreGateway,
  RunTimelineEventRecord,
  RunTimelineEventStoreGateway,
  SessionMessageRecord,
  SessionMessageStoreGateway,
  TaskTrajectoryAction,
  TaskTrajectoryBuildCandidate,
  TaskTrajectoryObservation,
  TaskTrajectoryRecord,
  TaskTrajectorySourceRef,
} from '@nextagent/agent-contracts/gateway';

export interface TaskTrajectoryBuildRef {
  readonly tenantId: TaskTrajectoryBuildCandidate['tenantId'];
  readonly subjectId: TaskTrajectoryBuildCandidate['subjectId'];
  readonly agentId: TaskTrajectoryBuildCandidate['agentId'];
  readonly agentVersion?: AgentVersion;
  readonly sessionId: TaskTrajectoryBuildCandidate['sessionId'];
  readonly requestId: TaskTrajectoryBuildCandidate['requestId'];
  readonly requestRunId: TaskTrajectoryBuildCandidate['requestRunId'];
  readonly terminalTimelineEventId?: string;
  readonly terminalTimelineSequence?: TaskTrajectoryBuildCandidate['terminalTimelineSequence'];
  readonly terminalCommittedAt?: EpochMillis;
}

export type TaskTrajectoryBuildResult =
  | { readonly status: 'BUILT'; readonly record: TaskTrajectoryRecord }
  | {
      readonly status: 'SKIPPED';
      readonly reasonCode: 'TASK_TRAJECTORY_NOT_APPLICABLE' | 'TASK_TRAJECTORY_SOURCE_NOT_FOUND' | 'TASK_TRAJECTORY_NOT_TERMINAL';
    }
  | { readonly status: 'FAILED'; readonly safeError: SafeError };

export interface TaskTrajectoryBuilder {
  build: (input: TaskTrajectoryBuildRef, signal?: AbortSignal) => Promise<TaskTrajectoryBuildResult>;
}

export interface TaskTrajectoryBuilderDependencies {
  readonly requestRuns: Pick<RequestRunStoreGateway, 'loadRun'>;
  readonly messages: Pick<SessionMessageStoreGateway, 'listCurrentRequestMessages'>;
  readonly timeline: Pick<RunTimelineEventStoreGateway, 'listEvents'>;
  readonly now?: () => EpochMillis;
  readonly idempotencyKeyForRun?: (runId: TaskTrajectoryBuildRef['requestRunId']) => IdempotencyKey;
}

const maxMessages = 50;
const maxEvents = 100;
const maxProjectedRequestFacts = 10;
const maxLlmNoteChars = 160;
const safeCapabilityName = /^[A-Za-z0-9._-]{1,128}$/u;
const safeDefinedTerm = /^(?:[A-Z][A-Z0-9._-]{1,63}|[A-Z]+-[0-9][A-Z0-9._-]{0,63})$/u;
const safeTermInTextPattern = /\b([A-Z][A-Z0-9._-]{1,63}|[A-Z]+-[0-9][A-Z0-9._-]{0,63})\b/u;
const explicitDefinitionPattern =
  /\b([A-Z][A-Z0-9._-]{1,63}|[A-Z]+-[0-9][A-Z0-9._-]{0,63})\b\s*(?:是|为|表示|代表|等于|=|means|is)\s*([^。；;,.，\r\n]{2,80})/iu;
const llmNoteRelationPattern = /(?:是|为|指|表示|代表|等于|归到|归类|归入|属于|对应|映射|分类|定义|=|means|is|belongs to|maps to)/iu;
const llmNoteDomainPattern =
  /(?:alarm|告警|kpi|sla|bgp|ospf|isis|interface|neighbor|peer|route|topology|fault|disk|故障|磁盘|邻居|路由|接口|网元|[A-Z]{2,}[-_][A-Z0-9._-]*\d)/iu;
const sentenceSeparatorPattern = /[。；;!?\r\n]+/u;
const unsafeProjectionPattern = /\b(secret|credential|token|password|api[_-]?key|bearer|private key)\b|[A-Za-z]:\\|\/(?:home|users|etc|var|tmp)\//iu;

export function createTaskTrajectoryBuilder(deps: TaskTrajectoryBuilderDependencies): TaskTrajectoryBuilder {
  return {
    async build(input, signal) {
      if (signal?.aborted === true) {
        return { status: 'FAILED', safeError: trajectorySafeError('TASK_TRAJECTORY_BUILD_CANCELED', 'CANCELED', false) };
      }
      try {
        const run = await deps.requestRuns.loadRun({
          tenantId: input.tenantId,
          subjectId: input.subjectId,
          agentId: input.agentId,
          runId: input.requestRunId,
        });
        if (run === undefined) {
          return { status: 'SKIPPED', reasonCode: 'TASK_TRAJECTORY_SOURCE_NOT_FOUND' };
        }
        if (run.terminalCommitState !== 'COMMITTED') {
          return { status: 'SKIPPED', reasonCode: 'TASK_TRAJECTORY_NOT_TERMINAL' };
        }
        const [messages, events] = await Promise.all([
          deps.messages.listCurrentRequestMessages({
            tenantId: input.tenantId,
            subjectId: input.subjectId,
            agentId: input.agentId,
            sessionId: input.sessionId,
            requestId: input.requestId,
            runId: input.requestRunId,
            includeHidden: false,
            offset: 0,
            limit: maxMessages,
          }),
          deps.timeline.listEvents({
            tenantId: input.tenantId,
            subjectId: input.subjectId,
            agentId: input.agentId,
            sessionId: input.sessionId,
            runId: input.requestRunId,
            afterSequence: brand<number, 'TimelineSequence'>(0),
            limit: maxEvents,
          }),
        ]);
        const visibleMessages = messages.items.filter((message) => message.visible);
        const terminalEvent = findTerminalEvent(events, input);
        const hasUserMessage = visibleMessages.some((message) => message.role === 'USER');
        const hasCapabilityEvent = events.some((event) => event.type === 'CAPABILITY_STARTED' || event.type === 'CAPABILITY_COMPLETED');
        if (!hasUserMessage && !hasCapabilityEvent) {
          return { status: 'SKIPPED', reasonCode: 'TASK_TRAJECTORY_NOT_APPLICABLE' };
        }
        const actions = projectActions(events, run);
        const observations = projectObservations(run, visibleMessages, events, terminalEvent);
        const outcome = classifyOutcome(run, events);
        const now = deps.now?.() ?? brand<number, 'EpochMillis'>(Date.now());
        const sourceRefs = sourceRefsFor(run, terminalEvent).slice(0, 50);
        const record: TaskTrajectoryRecord = {
          tenantId: input.tenantId,
          subjectId: input.subjectId,
          agentId: input.agentId,
          taskTrajectoryId: brand<string, 'TaskTrajectoryId'>(`task-trajectory-${input.requestRunId}`),
          sessionId: input.sessionId,
          requestId: input.requestId,
          requestRunId: input.requestRunId,
          taskKind: inferTaskKind(events),
          trajectoryBuildStatus: 'COMPLETED',
          taskOutcomeStatus: outcome.status,
          outcomeEvidenceLevel: outcome.evidenceLevel,
          goalSummary: `Committed ${run.status.toLowerCase()} request run.`,
          constraintSummaries: [],
          observations,
          actions,
          ...(outcome.summary === undefined ? {} : { outcomeSummary: outcome.summary }),
          outcomeEvidenceRefs: outcome.evidenceRefs,
          ...(outcome.failureSummary === undefined ? {} : { failureSummary: outcome.failureSummary }),
          sourceRefs,
          startedAt: run.createdAt,
          completedAt: terminalEvent?.createdAt ?? run.updatedAt,
          createdAt: now,
          updatedAt: now,
        };
        return { status: 'BUILT', record };
      } catch {
        return { status: 'FAILED', safeError: trajectorySafeError('TASK_TRAJECTORY_BUILD_FAILED', 'UNAVAILABLE', true) };
      }
    },
  };
}

export function taskTrajectoryIdempotencyKey(runId: TaskTrajectoryBuildRef['requestRunId']): IdempotencyKey {
  return brand<string, 'IdempotencyKey'>(`task-trajectory:${runId}`);
}

export function taskTrajectoryWriteOptions(runId: TaskTrajectoryBuildRef['requestRunId']): IdempotentWriteOptions {
  return { idempotencyKey: taskTrajectoryIdempotencyKey(runId) };
}

function findTerminalEvent(events: readonly RunTimelineEventRecord[], input: TaskTrajectoryBuildRef): RunTimelineEventRecord | undefined {
  if (input.terminalTimelineEventId !== undefined) {
    const byId = events.find((event) => event.eventId === input.terminalTimelineEventId);
    if (byId !== undefined && isTerminalEventType(byId.type)) {
      return byId;
    }
  }
  return events.find((event) => isTerminalEventType(event.type));
}

function isTerminalEventType(type: RunTimelineEventRecord['type']): boolean {
  return type === 'REQUEST_COMPLETED' || type === 'REQUEST_FAILED' || type === 'REQUEST_CANCELED' || type === 'REQUEST_SUPERSEDED';
}

function sourceRefsFor(run: RequestRunRecord, terminalEvent?: RunTimelineEventRecord): readonly TaskTrajectorySourceRef[] {
  return [
    { refKind: 'SESSION', sessionId: run.sessionId },
    { refKind: 'REQUEST_RUN', sessionId: run.sessionId, requestId: run.requestId, requestRunId: run.runId },
    ...(terminalEvent === undefined
      ? []
      : [
          {
            refKind: 'TIMELINE_EVENT' as const,
            sessionId: terminalEvent.sessionId,
            requestId: terminalEvent.requestId,
            requestRunId: terminalEvent.runId,
            timelineEventId: terminalEvent.eventId,
            timelineSequence: terminalEvent.sequence,
          },
        ]),
  ];
}

function projectActions(events: readonly RunTimelineEventRecord[], run: RequestRunRecord): readonly TaskTrajectoryAction[] {
  const capabilityEvents = events.filter((event) => event.type === 'CAPABILITY_STARTED' || event.type === 'CAPABILITY_COMPLETED');
  const actions = capabilityEvents.map((event): TaskTrajectoryAction => ({
    kind: actionKindFromEvent(event),
    summary: safeEventSummary(event),
    status: actionStatusFromEvent(event),
    sourceRefs: [timelineSourceRef(event)],
    startedAt: event.createdAt,
    ...(event.type === 'CAPABILITY_COMPLETED' ? { completedAt: event.createdAt } : {}),
  }));
  if (actions.length > 0) {
    return actions;
  }
  return [
    {
      kind: 'MODEL_RESPONSE',
      summary: `Request terminal status ${run.status}.`,
      status: run.status === 'COMPLETED' ? 'UNKNOWN' : actionStatusFromRun(run),
      sourceRefs: [{ refKind: 'REQUEST_RUN', sessionId: run.sessionId, requestId: run.requestId, requestRunId: run.runId }],
      startedAt: run.createdAt,
      completedAt: run.updatedAt,
    },
  ];
}

function projectObservations(
  run: RequestRunRecord,
  messages: readonly SessionMessageRecord[],
  events: readonly RunTimelineEventRecord[],
  terminalEvent?: RunTimelineEventRecord,
): readonly TaskTrajectoryObservation[] {
  const observations: TaskTrajectoryObservation[] = [
    {
      kind: 'TERMINAL_STATUS',
      summary: `Terminal status ${run.status}.`,
      sourceRefs:
        terminalEvent === undefined
          ? [{ refKind: 'REQUEST_RUN', sessionId: run.sessionId, requestId: run.requestId, requestRunId: run.runId }]
          : [timelineSourceRef(terminalEvent)],
      observedAt: terminalEvent?.createdAt ?? run.updatedAt,
    },
  ];
  const capabilityCompleted = events.filter((event) => event.type === 'CAPABILITY_COMPLETED');
  if (capabilityCompleted.length > 0) {
    observations.push(
      ...capabilityCompleted.slice(0, 20).map((event) => ({
        kind: 'TOOL_RESULT' as const,
        summary: safeEventSummary(event),
        sourceRefs: [timelineSourceRef(event)],
        observedAt: event.createdAt,
      })),
    );
  }
  return [...observations, ...projectRequestFacts(messages, run)];
}

function projectRequestFacts(messages: readonly SessionMessageRecord[], run: RequestRunRecord): readonly TaskTrajectoryObservation[] {
  return messages
    .filter((message) => message.role === 'USER')
    .flatMap((message): readonly TaskTrajectoryObservation[] => {
      const explicitDefinition = safeDefinitionSummary(message.content);
      if (explicitDefinition !== undefined) {
        return [requestFactObservation(message, run, explicitDefinition)];
      }
      const llmNote = safeLlmNoteSummary(message.content);
      if (llmNote === undefined) {
        return [];
      }
      return [requestFactObservation(message, run, llmNote)];
    })
    .slice(0, maxProjectedRequestFacts);
}

function requestFactObservation(message: SessionMessageRecord, run: RequestRunRecord, summary: string): TaskTrajectoryObservation {
  return {
    kind: 'REQUEST_FACT',
    summary,
    sourceRefs: [
      {
        refKind: 'MESSAGE',
        sessionId: message.sessionId,
        requestId: message.requestId,
        messageId: message.messageId,
        ...(message.runId === undefined ? {} : { requestRunId: message.runId }),
      },
    ],
    observedAt: message.createdAt ?? run.createdAt,
  };
}

function safeDefinitionSummary(content: string): string | undefined {
  const match = explicitDefinitionPattern.exec(content);
  if (match === null) {
    return undefined;
  }
  const concept = safeDefinitionPart(match[1] ?? '');
  const definition = safeDefinitionPart(match[2] ?? '');
  if (concept === undefined || definition === undefined || !safeDefinedTerm.test(concept)) {
    return undefined;
  }
  return `definition: ${concept} is ${definition}`;
}

function safeLlmNoteSummary(content: string): string | undefined {
  if (unsafeProjectionPattern.test(content)) {
    return undefined;
  }
  for (const rawPart of content.split(sentenceSeparatorPattern)) {
    const projected = safeLlmNotePart(rawPart);
    if (projected !== undefined) {
      return `llm-note: ${projected}`;
    }
  }
  return undefined;
}

function safeLlmNotePart(value: string): string | undefined {
  const clean = safeDefinitionPart(value);
  if (clean === undefined || !llmNoteRelationPattern.test(clean) || !llmNoteDomainPattern.test(clean)) {
    return undefined;
  }
  const termMatch = safeTermInTextPattern.exec(clean);
  const anchored = termMatch === null ? clean : clean.slice(termMatch.index);
  const projected = anchored
    .replace(/^[，,\s]+/u, '')
    .slice(0, maxLlmNoteChars)
    .trim();
  if (projected.length < 4 || unsafeProjectionPattern.test(projected)) {
    return undefined;
  }
  return projected;
}

function safeDefinitionPart(value: string): string | undefined {
  const clean = value.replace(/\s+/gu, ' ').trim();
  if (clean.length === 0 || unsafeProjectionPattern.test(clean)) {
    return undefined;
  }
  return clean;
}

function classifyOutcome(
  run: RequestRunRecord,
  events: readonly RunTimelineEventRecord[],
): {
  readonly status: TaskTrajectoryRecord['taskOutcomeStatus'];
  readonly evidenceLevel: TaskTrajectoryRecord['outcomeEvidenceLevel'];
  readonly evidenceRefs: readonly TaskTrajectorySourceRef[];
  readonly summary?: string;
  readonly failureSummary?: string;
} {
  if (run.status === 'CANCELED' || run.status === 'SUPERSEDED') {
    return { status: 'CANCELLED', evidenceLevel: 'NONE', evidenceRefs: [], failureSummary: `Terminal status ${run.status}.` };
  }
  if (run.status === 'FAILED') {
    return {
      status: 'FAILED',
      evidenceLevel: 'NONE',
      evidenceRefs: diagnosticRefs(events),
      failureSummary: 'Request failed with safe terminal status.',
    };
  }
  const verificationEvents = events.filter((event) => event.type === 'CAPABILITY_COMPLETED' && isVerificationEvent(event));
  if (verificationEvents.length > 0) {
    return {
      status: 'SUCCEEDED',
      evidenceLevel: 'VERIFICATION',
      evidenceRefs: verificationEvents.map(timelineSourceRef),
      summary: 'Verification evidence completed.',
    };
  }
  const userConfirmed = events.find((event) => event.type === 'USER_INPUT_RECEIVED');
  if (userConfirmed !== undefined) {
    return {
      status: 'SUCCEEDED',
      evidenceLevel: 'USER_CONFIRMATION',
      evidenceRefs: [timelineSourceRef(userConfirmed)],
      summary: 'User confirmation received.',
    };
  }
  const toolStatusEvents = events.filter((event) => event.type === 'CAPABILITY_COMPLETED');
  if (toolStatusEvents.length > 0) {
    return {
      status: 'UNKNOWN',
      evidenceLevel: 'TOOL_STATUS',
      evidenceRefs: toolStatusEvents.map(timelineSourceRef).slice(0, 10),
      summary: 'Tool status is available without verification evidence.',
    };
  }
  return { status: 'UNKNOWN', evidenceLevel: 'MODEL_CLAIM', evidenceRefs: [], summary: 'No verification evidence is available.' };
}

function inferTaskKind(events: readonly RunTimelineEventRecord[]): TaskTrajectoryRecord['taskKind'] {
  const names = events.map((event) => safeCapabilityNameFromPayload(event.inlinePayload).toLowerCase());
  if (names.some((name) => name.includes('write') || name.includes('edit') || name.includes('apply'))) {
    return 'CONFIG_CHANGE';
  }
  if (names.some((name) => name.includes('verify') || name.includes('check') || name.includes('grep') || name.includes('read'))) {
    return 'TROUBLESHOOTING';
  }
  return 'GENERAL_TASK';
}

function isVerificationEvent(event: RunTimelineEventRecord): boolean {
  const status = stringField(event.inlinePayload, 'status').toUpperCase();
  if (status !== 'SUCCEEDED' && status !== 'SUCCESS') {
    return false;
  }
  const name = safeCapabilityNameFromPayload(event.inlinePayload).toLowerCase();
  return name.includes('verify') || name.includes('check') || name.includes('query') || booleanField(event.inlinePayload, 'verification');
}

function diagnosticRefs(events: readonly RunTimelineEventRecord[]): readonly TaskTrajectorySourceRef[] {
  return events
    .map((event) => stringField(event.inlinePayload, 'code') || stringField(event.inlinePayload, 'safeErrorCode'))
    .filter((code) => code.length > 0)
    .slice(0, 5)
    .map((safeReasonCode) => ({ refKind: 'DIAGNOSTIC', safeReasonCode }));
}

function actionKindFromEvent(event: RunTimelineEventRecord): TaskTrajectoryAction['kind'] {
  if (event.type === 'USER_INPUT_RECEIVED') {
    return 'USER_INPUT';
  }
  const name = safeCapabilityNameFromPayload(event.inlinePayload).toLowerCase();
  if (name.includes('verify') || name.includes('check')) {
    return 'VERIFICATION';
  }
  if (name.includes('write') || name.includes('edit') || name.includes('apply')) {
    return 'CONFIG_APPLY';
  }
  return 'TOOL_INVOCATION';
}

function actionStatusFromEvent(event: RunTimelineEventRecord): TaskTrajectoryAction['status'] {
  if (event.type === 'CAPABILITY_STARTED') {
    return 'UNKNOWN';
  }
  const status = stringField(event.inlinePayload, 'status').toUpperCase();
  if (status === 'SUCCEEDED' || status === 'SUCCESS') {
    return 'SUCCEEDED';
  }
  if (status === 'FAILED' || status === 'ERROR') {
    return 'FAILED';
  }
  if (status === 'DEGRADED') {
    return 'DEGRADED';
  }
  if (status === 'TIMED_OUT' || status === 'TIMEOUT') {
    return 'TIMED_OUT';
  }
  return 'UNKNOWN';
}

function actionStatusFromRun(run: RequestRunRecord): TaskTrajectoryAction['status'] {
  if (run.status === 'FAILED') {
    return 'FAILED';
  }
  if (run.status === 'CANCELED' || run.status === 'SUPERSEDED') {
    return 'CANCELLED';
  }
  return 'UNKNOWN';
}

function safeEventSummary(event: RunTimelineEventRecord): string {
  const name = safeCapabilityNameFromPayload(event.inlinePayload);
  const status = stringField(event.inlinePayload, 'status');
  const code = stringField(event.inlinePayload, 'code') || stringField(event.inlinePayload, 'safeErrorCode');
  const parts: string[] = [event.type];
  if (name !== 'unknown') {
    parts.push(`capability:${name}`);
  }
  if (status.length > 0) {
    parts.push(`status:${safeToken(status)}`);
  }
  if (code.length > 0) {
    parts.push(`code:${safeToken(code)}`);
  }
  return parts.join(' ');
}

function timelineSourceRef(event: RunTimelineEventRecord): TaskTrajectorySourceRef {
  return {
    refKind: 'TIMELINE_EVENT',
    sessionId: event.sessionId,
    requestId: event.requestId,
    requestRunId: event.runId,
    timelineEventId: event.eventId,
    timelineSequence: event.sequence,
  };
}

function safeCapabilityNameFromPayload(payload: JsonObject): string {
  const candidate = stringField(payload, 'toolName') || stringField(payload, 'capabilityId') || stringField(payload, 'name');
  return safeCapabilityName.test(candidate) ? candidate : 'unknown';
}

function stringField(payload: JsonObject, key: string): string {
  const value = payload[key];
  return typeof value === 'string' ? value : '';
}

function booleanField(payload: JsonObject, key: string): boolean {
  return payload[key] === true;
}

function safeToken(value: string): string {
  return /^[A-Z0-9_.:-]{1,128}$/iu.test(value) ? value : 'REDACTED';
}

function trajectorySafeError(code: string, category: SafeError['category'], retryable: boolean): SafeError {
  return {
    code,
    message: 'Task trajectory build failed safely.',
    category,
    retryable,
  };
}
