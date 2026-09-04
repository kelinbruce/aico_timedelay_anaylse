import { AgentError, brand, type EpochMillis, type IdempotencyKey, type JsonObject, type MessageId } from '@nextagent/agent-common';
import type { RequestRunStoreGateway, RunTimelineEventRecord } from '@nextagent/agent-contracts/gateway';
import type {
  LargeContentExternalizerPort,
  RequestContext,
  RequestRun,
  RunTimelineEvent,
  SubmitRequestCommand,
} from '@nextagent/agent-contracts/runtime';
import type { SessionMessageDraft } from '@nextagent/agent-contracts/session';
import { toRunRecord } from '../assembly/assembly-binding.js';
import { maxTimelineInlinePayloadBytes, runtimeTimelinePayload } from '../timeline/runtime-payload.js';
import { maxTerminalMessageChars } from './failure-normalizer.js';
import type { TerminalHookResultSnapshot } from './hook-result-snapshot.js';

export interface TerminalCommitDependencies {
  readonly requestRunStore: RequestRunStoreGateway;
  readonly largeContentExternalizer?: LargeContentExternalizerPort;
}

export interface TerminalCommitHooks {
  now: () => EpochMillis;
  id: (prefix: string) => string;
  emitCanonical: (command: SubmitRequestCommand, context: RequestContext, event: RunTimelineEvent, idempotencyKey: IdempotencyKey) => Promise<void>;
  saveCheckpoint: (
    command: SubmitRequestCommand,
    run: RequestRun,
    context: RequestContext,
    triggerReason: 'TERMINAL_COMMIT_PENDING',
  ) => Promise<void>;
}

export interface TerminalCommitOptions {
  readonly idempotencyKey?: IdempotencyKey;
  readonly idempotencySemantic?: string;
  readonly failureReason?: TerminalFailureReason;
  /**
   * When true, the terminal assistant message is persisted with visible=false
   * (guard-blocked) so it does not enter the next round's model context.
   * Set by the runtime when an output guard block was observed for this run.
   */
  readonly guardBlocked?: boolean;
  /**
   * When set, the terminal assistant message is persisted visible=true (page
   * renders it) but carries metadata.modelVisibility.excluded=true so context
   * assembly keeps it out of model context. Used for input-guard-blocked
   * rounds that need a normal run lifecycle (retry/edit/title) but must not
   * feed the model. Mutually exclusive with guardBlocked.
   */
  readonly guardBlockedVisible?: { readonly refusalMessage: string };
}

interface TerminalCommitOutcomeOptions extends TerminalCommitOptions {
  readonly hookResultSnapshot: TerminalHookResultSnapshot;
  readonly capabilityTerminalAnswer?: true;
}

export interface TerminalFailureReason {
  readonly code?: string;
  readonly category?: string;
}

export async function commitTerminalOutcome(
  deps: TerminalCommitDependencies,
  hooks: TerminalCommitHooks,
  command: SubmitRequestCommand,
  run: RequestRun,
  context: RequestContext,
  content: string,
  status: 'COMPLETED' | 'FAILED' | 'CANCELED' | 'SUPERSEDED',
  options: TerminalCommitOptions = {},
): Promise<RunTimelineEventRecord | undefined> {
  return commitTerminalOutcomeWithHookResultSnapshot(deps, hooks, command, run, context, content, status, {
    ...options,
    hookResultSnapshot: { hookResultsErrorCode: 'HOOK_RESULTS_UNAVAILABLE' },
  });
}

export async function commitTerminalOutcomeWithHookResultSnapshot(
  deps: TerminalCommitDependencies,
  hooks: TerminalCommitHooks,
  command: SubmitRequestCommand,
  run: RequestRun,
  context: RequestContext,
  content: string,
  status: 'COMPLETED' | 'FAILED' | 'CANCELED' | 'SUPERSEDED',
  options: TerminalCommitOutcomeOptions,
): Promise<RunTimelineEventRecord | undefined> {
  const terminalOptions = options;
  if (terminalOptions.guardBlocked === true && terminalOptions.guardBlockedVisible !== undefined) {
    throw new Error('TerminalCommitOptions.guardBlocked and guardBlockedVisible are mutually exclusive.');
  }
  let terminalContent = terminalOptions.guardBlockedVisible !== undefined ? terminalOptions.guardBlockedVisible.refusalMessage : content;
  let terminalStatus = status;
  let terminalFailureReason = terminalOptions.failureReason;
  if (status === 'COMPLETED' && terminalContent.trim().length === 0) {
    await hooks.emitCanonical(
      command,
      context,
      { type: 'DEGRADATION_NOTICE', inlinePayload: { code: 'MODEL_FINAL_CONTENT_EMPTY' } },
      brand<string, 'IdempotencyKey'>(`${command.idempotencyKey}:terminal-output-empty`),
    );
    terminalContent = 'Request failed safely: MODEL_FINAL_CONTENT_EMPTY';
    terminalStatus = 'FAILED';
    terminalFailureReason = terminalFailureReason ?? { code: 'MODEL_FINAL_CONTENT_EMPTY' };
  }
  const terminalMessageId = brand<string, 'MessageId'>(hooks.id(terminalStatus === 'COMPLETED' ? 'assistant' : 'assistant-terminal'));
  const materializedTerminal =
    terminalStatus === 'COMPLETED' && terminalOptions.capabilityTerminalAnswer === true
      ? await materializeCapabilityTerminalAnswer(deps, run, context, terminalMessageId, terminalContent)
      : { content: terminalContent };
  terminalContent = materializedTerminal.content;
  if (terminalStatus === 'COMPLETED' && terminalContent.length > maxTerminalMessageChars) {
    await hooks.emitCanonical(
      command,
      context,
      { type: 'DEGRADATION_NOTICE', inlinePayload: { code: 'TERMINAL_MESSAGE_LIMIT_EXCEEDED' } },
      brand<string, 'IdempotencyKey'>(`${command.idempotencyKey}:terminal-output-limit`),
    );
    terminalContent = 'Request failed safely: TERMINAL_MESSAGE_LIMIT_EXCEEDED';
    terminalStatus = 'FAILED';
    terminalFailureReason = terminalFailureReason ?? { code: 'TERMINAL_MESSAGE_LIMIT_EXCEEDED' };
  }
  await hooks.saveCheckpoint(command, run, context, 'TERMINAL_COMMIT_PENDING');
  const pending: RequestRun = { ...run, terminalCommitState: 'PENDING', version: run.version + 1, updatedAt: hooks.now() };
  const terminalIdempotencyKey = terminalOptions.idempotencyKey ?? brand<string, 'IdempotencyKey'>(`${run.runId}:terminal-commit`);
  const pendingRecord = toRunRecord(pending, command);
  await deps.requestRunStore.saveRun(
    {
      ...pendingRecord,
      ...(terminalOptions.idempotencyKey === undefined ? {} : { terminalCommitIdempotencyKey: terminalIdempotencyKey }),
      ...(terminalOptions.idempotencySemantic === undefined ? {} : { terminalCommitIdempotencySemantic: terminalOptions.idempotencySemantic }),
    },
    {
      expectedVersion: run.version,
    },
  );
  const terminalCreatedAt = hooks.now();
  const terminalType = terminalEventType(terminalStatus);
  const terminalFailureReasonFields = terminalStatus === 'FAILED' ? safeFailureReasonFields(terminalFailureReason) : {};
  const persistedTerminalInlinePayload = buildPersistedTerminalInlinePayload(
    terminalMessageId,
    terminalFailureReasonFields,
    terminalOptions.hookResultSnapshot,
    context,
  );
  const commit = await deps.requestRunStore.commitTerminal({
    tenantId: command.identityContext.tenantId,
    subjectId: command.identityContext.subjectId,
    agentId: run.agentId,
    runId: run.runId,
    expectedVersion: pending.version,
    terminalStatus,
    terminalMessage: {
      tenantId: command.identityContext.tenantId,
      subjectId: command.identityContext.subjectId,
      agentId: run.agentId,
      messageId: terminalMessageId,
      sessionId: run.sessionId,
      requestId: run.requestId,
      runId: run.runId,
      role: 'ASSISTANT',
      content: terminalContent,
      contentType: 'PLAIN_TEXT',
      metadata: {
        ...(materializedTerminal.metadata ?? {}),
        eventType: terminalType,
        status: terminalStatus,
        ...(terminalOptions.guardBlocked === true ? { guardBlocked: true } : {}),
        ...(terminalOptions.guardBlockedVisible !== undefined
          ? {
              guardReason: 'INPUT_VIOLATION',
              modelVisibility: { excluded: true, reason: 'GUARD_BLOCKED' },
            }
          : {}),
        ...terminalFailureReasonFields,
      },
      visible: terminalOptions.guardBlocked !== true,
      createdAt: terminalCreatedAt,
    },
    terminalEvent: {
      tenantId: command.identityContext.tenantId,
      subjectId: command.identityContext.subjectId,
      agentId: context.agentId,
      agentVersion: context.agentVersion,
      eventId: hooks.id('event'),
      sessionId: context.sessionId,
      runId: context.runId,
      requestId: context.requestId,
      requestContextId: context.requestContextId,
      sequence: brand<number, 'TimelineSequence'>(0),
      type: terminalType,
      inlinePayload: persistedTerminalInlinePayload,
      createdAt: terminalCreatedAt,
    },
    idempotencyKey: terminalIdempotencyKey,
    ...(terminalOptions.idempotencySemantic === undefined ? {} : { idempotencySemantic: terminalOptions.idempotencySemantic }),
  });
  if (commit.status === 'ALREADY_COMMITTED') {
    return undefined;
  }
  if (commit.status !== 'COMMITTED') {
    await deps.requestRunStore.saveRun(
      {
        ...toRunRecord(
          { ...pending, terminalCommitState: 'FAILED', status: 'FAILED', version: pending.version + 1, updatedAt: hooks.now() },
          command,
        ),
        ...(terminalOptions.idempotencyKey === undefined ? {} : { terminalCommitIdempotencyKey: terminalIdempotencyKey }),
        ...(terminalOptions.idempotencySemantic === undefined ? {} : { terminalCommitIdempotencySemantic: terminalOptions.idempotencySemantic }),
      },
      {
        expectedVersion: pending.version,
      },
    );
    throw new AgentError({
      code: `TERMINAL_COMMIT_${commit.status}`,
      message: 'Terminal composite commit did not complete.',
      category: commit.status === 'NOT_FOUND' ? 'NOT_FOUND' : 'CONFLICT',
      retryable: commit.status === 'VERSION_CONFLICT',
    });
  }
  if (commit.terminalEvent === undefined) {
    throw new AgentError({
      code: 'TERMINAL_COMMIT_EVENT_MISSING',
      message: 'Terminal commit succeeded without a terminal Event.',
      category: 'INTERNAL',
      retryable: false,
    });
  }
  return {
    ...commit.terminalEvent,
    inlinePayload: {
      ...commit.terminalEvent.inlinePayload,
      content: terminalContent,
    },
  };
}

async function materializeCapabilityTerminalAnswer(
  deps: TerminalCommitDependencies,
  run: RequestRun,
  context: RequestContext,
  terminalMessageId: MessageId,
  content: string,
): Promise<{ readonly content: string; readonly metadata?: JsonObject }> {
  const draft: SessionMessageDraft = {
    role: 'CAPABILITY_RESULT',
    content,
    contentType: 'PLAIN_TEXT',
    visible: true,
    idempotencyKey: brand<string, 'IdempotencyKey'>(terminalMessageId),
  };
  const materialized =
    (await deps.largeContentExternalizer?.externalize(draft, {
      identityContext: context.identityContext,
      agentId: run.agentId,
      agentVersion: run.agentVersion,
      agentAssemblyRef: run.agentAssemblyRef,
      sessionId: run.sessionId,
      requestId: run.requestId,
      runId: run.runId,
      requestContextId: context.requestContextId,
      messageId: terminalMessageId,
    })) ?? draft;
  return {
    content: materialized.content,
    ...(materialized.metadata === undefined ? {} : { metadata: materialized.metadata }),
  };
}

function buildPersistedTerminalInlinePayload(
  terminalMessageId: MessageId,
  terminalFailureReasonFields: Readonly<Record<string, string>>,
  hookResultSnapshot: TerminalHookResultSnapshot,
  context: RequestContext,
): JsonObject {
  const payload = runtimeTimelinePayload(
    {
      terminalMessageId,
      ...terminalFailureReasonFields,
      ...hookResultSnapshot,
    },
    context,
  );
  if (serializedBytes(payload) <= maxTimelineInlinePayloadBytes) {
    return payload;
  }
  if ('hookResults' in hookResultSnapshot) {
    const withoutHookResults = runtimeTimelinePayload(
      {
        terminalMessageId,
        ...terminalFailureReasonFields,
        hookResultsErrorCode: 'HOOK_RESULTS_LIMIT_EXCEEDED',
      },
      context,
    );
    if (serializedBytes(withoutHookResults) <= maxTimelineInlinePayloadBytes) {
      return withoutHookResults;
    }
  }
  throw new AgentError({
    code: 'TERMINAL_EVENT_PAYLOAD_LIMIT_EXCEEDED',
    message: 'Terminal Event payload exceeds the persistence capacity limit.',
    category: 'VALIDATION',
    retryable: false,
  });
}

function serializedBytes(payload: JsonObject): number {
  return Buffer.byteLength(JSON.stringify(payload), 'utf8');
}

function safeFailureReasonFields(failureReason?: TerminalFailureReason): Record<string, string> {
  const fields: Record<string, string> = {};
  const code = failureReason?.code;
  const category = failureReason?.category;
  if (isNonEmptyString(code)) {
    fields.code = code;
  }
  if (isNonEmptyString(category)) {
    fields.category = category;
  }
  return fields;
}

function isNonEmptyString(value?: string): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function terminalEventType(status: 'COMPLETED' | 'FAILED' | 'CANCELED' | 'SUPERSEDED'): RunTimelineEvent['type'] {
  if (status === 'COMPLETED') {
    return 'REQUEST_COMPLETED';
  }
  if (status === 'CANCELED') {
    return 'REQUEST_CANCELED';
  }
  if (status === 'SUPERSEDED') {
    return 'REQUEST_SUPERSEDED';
  }
  return 'REQUEST_FAILED';
}
