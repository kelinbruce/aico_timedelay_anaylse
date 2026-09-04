import { AgentError, brand, type EpochMillis, type IdempotencyKey, type JsonObject, type ToolCallId } from '@nextagent/agent-common';
import type {
  ActiveContextStoreGateway,
  CheckpointRecord,
  CheckpointStoreGateway,
  PendingInputProducerRef,
  PendingInputStoreGateway,
  RunTimelineEventRecord,
  RunTimelineEventStoreGateway,
  SessionMessageStoreGateway,
} from '@nextagent/agent-contracts/gateway';
import type {
  AgentRunStatePort,
  LargeContentExternalizerPort,
  PendingInputIntent,
  PendingInputRequest,
  RequestPendingInputOptions,
  RequestContext,
  RequestRun,
  RunTimelineEvent,
} from '@nextagent/agent-contracts/runtime';
import type { GeneratedUserMessageDraft, SessionMessageDraft } from '@nextagent/agent-contracts/session';

import { saveRuntimeCheckpoint } from '../checkpoints/checkpoint-calls.js';
import { maxTerminalMessageChars } from '../terminal/failure-normalizer.js';
import {
  createTimelineEventPersistencePolicy,
  isQualifiedWorkflowProductPayload,
  type SelectiveTimelineEventPersistencePolicy,
  type TimelineEventPersistencePolicy,
} from '../timeline/event-persistence-policy.js';
import { maxTimelineInlinePayloadBytes, runtimeTimelinePayload, truncateTimelineInlinePayload } from '../timeline/runtime-payload.js';
import { StructuredDeltaPersistenceAccumulator } from '../timeline/structured-delta-persistence-accumulator.js';
import { RuntimeOwnedRunMessagePort } from './run-message-port.js';

export interface RuntimeOwnedAgentRunStatePortDependencies {
  readonly messageStore: SessionMessageStoreGateway;
  readonly timelineStore: RunTimelineEventStoreGateway;
  readonly checkpointStore: CheckpointStoreGateway;
  readonly activeContextStore: ActiveContextStoreGateway;
  readonly pendingInputStore?: PendingInputStoreGateway;
  readonly onPendingInputCreated?: (timeoutAt: EpochMillis) => void;
  readonly clock: () => EpochMillis;
  readonly idFactory: (prefix: string) => string;
  readonly onTimelineAppend?: (record: RunTimelineEventRecord) => void;
  readonly onLiveTimelineEvent?: (event: RunTimelineEvent) => void;
  readonly timelinePersistencePolicy?: SelectiveTimelineEventPersistencePolicy;
  readonly shouldSuppress?: (run: RequestRun, context: RequestContext) => boolean;
  readonly largeContentExternalizer?: LargeContentExternalizerPort;
  readonly pendingInputMaxTimeoutMs?: number;
  readonly askUserQuestionDefaultTimeoutMs?: () => Promise<number>;
}

export interface RuntimeRunOutput {
  readonly finalContent: string;
  readonly outputExceeded: boolean;
  readonly capabilityTerminalAnswer?: { readonly content: string };
}

const pendingInputDefaultTimeoutMs = 30 * 60 * 1000;
const pendingInputDefaultMaxTimeoutMs = 24 * 60 * 60 * 1000;
const MAX_ASK_USER_QUESTION_TIMEOUT_MS = 24 * 60 * 60 * 1000;

interface MutableRunOutput {
  content: string;
  exceeded: boolean;
  limitNoticeEmitted: boolean;
  capabilityTerminalAnswer?: { readonly content: string };
  hasFinalLlmSource: boolean;
}

export class RuntimeOwnedAgentRunStatePort implements AgentRunStatePort {
  private readonly messages: RuntimeOwnedRunMessagePort;
  private readonly timelinePersistencePolicy: TimelineEventPersistencePolicy;
  private readonly outputs = new Map<string, MutableRunOutput>();
  private readonly structuredDeltaAccumulator = new StructuredDeltaPersistenceAccumulator();

  constructor(private readonly deps: RuntimeOwnedAgentRunStatePortDependencies) {
    this.messages = new RuntimeOwnedRunMessagePort({
      messageStore: deps.messageStore,
      clock: deps.clock,
      idFactory: deps.idFactory,
      ...(deps.largeContentExternalizer === undefined ? {} : { largeContentExternalizer: deps.largeContentExternalizer }),
    });
    this.timelinePersistencePolicy = createTimelineEventPersistencePolicy(deps.timelinePersistencePolicy);
  }

  beginRun(run: RequestRun): void {
    this.structuredDeltaAccumulator.clearRun(run.runId);
    this.outputs.set(run.runId, { content: '', exceeded: false, limitNoticeEmitted: false, hasFinalLlmSource: false });
  }

  async finishRun(run: RequestRun): Promise<RuntimeRunOutput> {
    await this.flushPendingStructuredDeltas(run);
    const output = this.outputs.get(run.runId);
    this.outputs.delete(run.runId);
    return {
      finalContent: output?.content ?? '',
      outputExceeded: output?.exceeded ?? false,
      ...(output?.capabilityTerminalAnswer === undefined ? {} : { capabilityTerminalAnswer: output.capabilityTerminalAnswer }),
    };
  }

  discardRun(run: RequestRun): void {
    this.outputs.delete(run.runId);
  }

  async setCapabilityTerminalAnswer(run: RequestRun, context: RequestContext, answer: { readonly content: string }): Promise<void> {
    this.assertRunContext(run, context);
    const output = this.outputs.get(run.runId);
    if (output === undefined) {
      throw new AgentError({
        code: 'CAPABILITY_TERMINAL_ANSWER_RUN_NOT_ACTIVE',
        message: 'Capability terminal answer requires active runtime-owned run state.',
        category: 'CONFLICT',
        retryable: false,
      });
    }
    if (output.capabilityTerminalAnswer !== undefined) {
      throw new AgentError({
        code: 'CAPABILITY_TERMINAL_ANSWER_ALREADY_SET',
        message: 'Capability terminal answer was already set for this run.',
        category: 'CONFLICT',
        retryable: false,
      });
    }
    if (output.hasFinalLlmSource) {
      throw terminalSourceConflict();
    }
    output.capabilityTerminalAnswer = { content: answer.content };
  }

  async emitEvent(run: RequestRun, context: RequestContext, event: RunTimelineEvent): Promise<void> {
    this.assertRunContext(run, context);
    const persistence = this.timelinePersistencePolicy.resolve(event);
    if (
      event.type === 'REQUEST_COMPLETED' ||
      event.type === 'REQUEST_FAILED' ||
      event.type === 'REQUEST_CANCELED' ||
      event.type === 'REQUEST_SUPERSEDED'
    ) {
      return;
    }
    if (this.deps.shouldSuppress?.(run, context) === true) {
      // Exempt final terminal content from suppression during cancel.
      // LLM_CONTENT_DELTA with final:true carries complete workflow rollback
      // projection content that must reach output.content and stream subscribers.
      // Intermediate streaming deltas (final not true) remain suppressed.
      const isFinalContentDelta =
        event.type === 'LLM_CONTENT_DELTA' && event.inlinePayload.final === true && event.inlinePayload.workflowEventType === undefined;
      if (!isFinalContentDelta) {
        return;
      }
    }
    const output = this.outputs.get(run.runId);
    const content = event.inlinePayload.content;
    if (
      event.type === 'LLM_CONTENT_DELTA' &&
      event.inlinePayload.workflowEventType === undefined &&
      output !== undefined &&
      typeof content === 'string'
    ) {
      if (event.inlinePayload.final === true) {
        if (output.capabilityTerminalAnswer !== undefined) {
          throw terminalSourceConflict();
        }
        output.hasFinalLlmSource = true;
      }
      if (output.exceeded) {
        return;
      }
      if (content.length > maxTerminalMessageChars) {
        output.exceeded = true;
        output.content = 'Request failed safely: TERMINAL_MESSAGE_LIMIT_EXCEEDED';
        if (!output.limitNoticeEmitted) {
          output.limitNoticeEmitted = true;
          await this.appendEvent(
            run,
            context,
            {
              type: 'DEGRADATION_NOTICE',
              inlinePayload: { code: 'TERMINAL_MESSAGE_LIMIT_EXCEEDED' },
            },
            brand<string, 'IdempotencyKey'>(`${run.runId}:DEGRADATION_NOTICE:TERMINAL_MESSAGE_LIMIT_EXCEEDED`),
          );
        }
        return;
      }
      output.content = content;
    }
    // Intercept TOOL_STRUCTURED_DELTA (non-Workflow) for aggregation before persistence.
    if (event.type === 'TOOL_STRUCTURED_DELTA' && !isQualifiedWorkflowProductPayload(event.inlinePayload)) {
      // Reuse one event identity for live delivery and persistence so history
      // replay can replace the already-delivered live fact instead of duplicating it.
      const liveEvent = this.liveOnlyEvent(run, context, event);
      this.deps.onLiveTimelineEvent?.(liveEvent);
      const toolCallId = event.inlinePayload['toolCallId'];
      if (typeof toolCallId === 'string') {
        // Events with accumulated=true are already complete (e.g. workflow NODE_OUTPUT_DELTA).
        // Write directly to timeline store with trace attributes instead of going through
        // the accumulator, since their toolCallId may differ from the outer tool call.
        if (event.inlinePayload['accumulated'] === true) {
          await this.writeTimelineEventDirect(run, context, liveEvent, toolCallId);
        } else {
          const readyEvents = this.structuredDeltaAccumulator.accept(run.runId, liveEvent);
          for (const readyEvent of readyEvents) {
            const readyToolCallId = readyEvent.inlinePayload['toolCallId'];
            if (typeof readyToolCallId === 'string') {
              await this.writeTimelineEventDirect(run, context, readyEvent, readyToolCallId);
            }
          }
        }
      }
      return;
    }
    if (
      persistence === 'PERSISTED' &&
      event.type === 'TOOL_STRUCTURED_DELTA' &&
      event.inlinePayload.workflowEventType === 'NODE_COMPLETED' &&
      isQualifiedWorkflowProductPayload(event.inlinePayload)
    ) {
      await this.appendEvent(run, context, event, brand<string, 'IdempotencyKey'>(`${run.runId}:${event.type}:${this.deps.idFactory('timeline')}`), {
        boundStructuredPayload: true,
      });
      return;
    }
    if (persistence === 'PERSISTED' && Buffer.byteLength(JSON.stringify(event.inlinePayload)) > maxTimelineInlinePayloadBytes) {
      this.deps.onLiveTimelineEvent?.(this.liveOnlyEvent(run, context, event));
      return;
    }
    if (persistence === 'LIVE_ONLY') {
      this.deps.onLiveTimelineEvent?.(this.liveOnlyEvent(run, context, event));
      return;
    }
    await this.appendEvent(run, context, event, brand<string, 'IdempotencyKey'>(`${run.runId}:${event.type}:${this.deps.idFactory('timeline')}`));
  }

  private async flushStructuredDeltaPersistence(run: RequestRun, context: RequestContext, toolCallId: string): Promise<void> {
    this.assertRunContext(run, context);
    const events = this.structuredDeltaAccumulator.flush(run.runId, toolCallId);
    for (const event of events) {
      await this.writeTimelineEventDirect(run, context, event, toolCallId);
    }
  }

  private async flushPendingStructuredDeltas(run: RequestRun): Promise<void> {
    const events = this.structuredDeltaAccumulator.flushAll(run.runId);
    for (const event of events) {
      // Events stored in the accumulator were created via liveOnlyEvent which captures
      // tenantId, subjectId, and requestContextId from the original context.
      await this.deps.timelineStore.appendEvent(
        {
          tenantId: event.tenantId!,
          subjectId: event.subjectId!,
          agentId: run.agentId,
          agentVersion: run.agentVersion,
          eventId: event.eventId ?? this.deps.idFactory('event'),
          sessionId: run.sessionId,
          runId: run.runId,
          requestId: run.requestId,
          requestContextId: event.requestContextId!,
          sequence: brand<number, 'TimelineSequence'>(0),
          type: event.type,
          inlinePayload: truncateTimelineInlinePayload(
            runtimeTimelinePayload(event.inlinePayload, {} as Pick<RequestContext, 'propagationAttributes'>),
          ),
          createdAt: brand<number, 'EpochMillis'>(event.createdAt instanceof Date ? event.createdAt.getTime() : this.deps.clock()),
          ...(event.contentRef === undefined ? {} : { contentRef: event.contentRef }),
        },
        { idempotencyKey: brand<string, 'IdempotencyKey'>(`${run.runId}:TOOL_STRUCTURED_DELTA:fallback:${this.deps.idFactory('timeline')}`) },
      );
    }
  }

  private async writeTimelineEventDirect(run: RequestRun, context: RequestContext, event: RunTimelineEvent, toolCallId: string): Promise<void> {
    const record: RunTimelineEventRecord = {
      tenantId: context.identityContext.tenantId,
      subjectId: context.identityContext.subjectId,
      agentId: run.agentId,
      agentVersion: run.agentVersion,
      eventId: event.eventId ?? this.deps.idFactory('event'),
      sessionId: run.sessionId,
      runId: run.runId,
      requestId: run.requestId,
      requestContextId: context.requestContextId,
      sequence: brand<number, 'TimelineSequence'>(0),
      type: event.type,
      inlinePayload: truncateTimelineInlinePayload(runtimeTimelinePayload(event.inlinePayload, context)),
      createdAt: brand<number, 'EpochMillis'>(event.createdAt instanceof Date ? event.createdAt.getTime() : this.deps.clock()),
      ...(event.contentRef === undefined ? {} : { contentRef: event.contentRef }),
    };
    await this.deps.timelineStore.appendEvent(record, {
      idempotencyKey: brand<string, 'IdempotencyKey'>(`${run.runId}:TOOL_STRUCTURED_DELTA:${toolCallId}:${this.deps.idFactory('timeline')}`),
    });
  }

  async appendMessage(run: RequestRun, context: RequestContext, draft: SessionMessageDraft) {
    this.assertRunContext(run, context);
    if (this.deps.shouldSuppress?.(run, context) === true) {
      return brand<string, 'MessageId'>(this.deps.idFactory('suppressed-message'));
    }
    const messageId = await this.messages.appendMessage(run, context, draft);
    const toolCallId = draft.role === 'CAPABILITY_RESULT' ? draft.metadata?.['toolCallId'] : undefined;
    if (typeof toolCallId === 'string' && toolCallId.length > 0) {
      await this.flushStructuredDeltaPersistence(run, context, toolCallId);
    }
    return messageId;
  }

  async appendGeneratedUserMessage(run: RequestRun, context: RequestContext, draft: GeneratedUserMessageDraft) {
    this.assertRunContext(run, context);
    if (this.deps.shouldSuppress?.(run, context) === true) {
      return brand<string, 'MessageId'>(this.deps.idFactory('suppressed-message'));
    }
    return this.messages.appendGeneratedUserMessage(run, context, draft);
  }

  async saveCheckpoint(run: RequestRun, context: RequestContext, triggerReason: CheckpointRecord['triggerReason']): Promise<void> {
    this.assertRunContext(run, context);
    await saveRuntimeCheckpoint(
      { checkpointStore: this.deps.checkpointStore, activeContextStore: this.deps.activeContextStore },
      run,
      context,
      triggerReason,
      { now: this.deps.clock, id: this.deps.idFactory },
    );
  }

  async requestPendingInput(
    run: RequestRun,
    context: RequestContext,
    intent: PendingInputIntent,
    options: RequestPendingInputOptions = {},
  ): Promise<PendingInputRequest> {
    this.assertRunContext(run, context);
    return this.acceptPendingInput(
      run,
      context,
      intent,
      options.producerRef ?? this.capabilityProducerRef(context),
      options.checkpointTrigger ?? 'CAPABILITY_BEFORE_CALL',
    );
  }

  private async acceptPendingInput(
    run: RequestRun,
    context: RequestContext,
    intent: PendingInputIntent,
    producerRef: PendingInputProducerRef,
    checkpointTrigger: CheckpointRecord['triggerReason'],
  ): Promise<PendingInputRequest> {
    if (this.deps.pendingInputStore === undefined) {
      throw new AgentError({
        code: 'PENDING_INPUT_LIFECYCLE_UNAVAILABLE',
        message: 'Pending input lifecycle is not available for this runtime-owned handoff.',
        category: 'UNAVAILABLE',
        retryable: true,
      });
    }
    const active = await this.deps.pendingInputStore.loadActivePendingInput({
      tenantId: context.identityContext.tenantId,
      subjectId: context.identityContext.subjectId,
      agentId: run.agentId,
      sessionId: run.sessionId,
    });
    if (active !== undefined) {
      throw new AgentError({
        code: 'PENDING_INPUT_ACTIVE_CONFLICT',
        message: 'A pending input is already active for this session.',
        category: 'CONFLICT',
        retryable: false,
        safeDetails: {
          reasonCode: 'PENDING_INPUT_ACTIVE_CONFLICT',
          pendingInputId: active.pendingInputId,
          kind: active.kind,
        },
      });
    }
    const createdAt = this.deps.clock();
    this.assertValidPendingInputIntent(intent, createdAt, producerRef);
    const timeoutAt = await this.acceptedPendingInputTimeoutAt(intent.timeoutAt, createdAt, producerRef);
    const pendingInputId = brand<string, 'PendingInputId'>(this.deps.idFactory('pending-input'));
    const checkpoint = await saveRuntimeCheckpoint(
      { checkpointStore: this.deps.checkpointStore, activeContextStore: this.deps.activeContextStore },
      run,
      context,
      checkpointTrigger,
      {
        now: this.deps.clock,
        id: this.deps.idFactory,
        idempotencyKey: brand<string, 'IdempotencyKey'>(`${run.runId}:pending-input-checkpoint:${pendingInputId}`),
      },
    ).catch((error) => {
      throw new AgentError({
        code: 'PENDING_INPUT_CHECKPOINT_UNAVAILABLE',
        message: 'Pending input checkpoint could not be saved.',
        category: 'UNAVAILABLE',
        retryable: true,
        cause: error,
      });
    });
    const safeQuestions: readonly JsonObject[] = intent.questions.map((question) => ({
      prompt: question.prompt,
      options: question.options.map((option) => ({
        label: option.label,
        value: option.value,
        ...(option.requiresTextInput === undefined ? {} : { requiresTextInput: option.requiresTextInput }),
        ...(option.inputPlaceholder === undefined ? {} : { inputPlaceholder: option.inputPlaceholder }),
      })),
      ...(question.multiple === undefined ? {} : { multiple: question.multiple }),
      ...(question.custom === undefined ? {} : { custom: question.custom }),
    }));
    const request: PendingInputRequest = {
      id: pendingInputId,
      sessionId: run.sessionId,
      kind: intent.kind,
      questions: intent.questions,
      timeoutAt,
    };
    await this.deps.pendingInputStore.createPendingInput({
      tenantId: context.identityContext.tenantId,
      subjectId: context.identityContext.subjectId,
      record: {
        tenantId: context.identityContext.tenantId,
        subjectId: context.identityContext.subjectId,
        agentId: run.agentId,
        pendingInputId,
        requestRunId: run.runId,
        sessionId: run.sessionId,
        requestId: run.requestId,
        requestContextId: context.requestContextId,
        checkpointId: checkpoint.checkpointId,
        kind: intent.kind,
        request,
        producerRef,
        status: 'PENDING',
        createdAt,
        updatedAt: createdAt,
      },
    });
    try {
      await this.appendEvent(
        run,
        context,
        {
          type: 'USER_INPUT_REQUIRED',
          inlinePayload: {
            pendingInputId,
            id: pendingInputId,
            kind: intent.kind,
            questions: safeQuestions,
            status: 'PENDING',
            timeoutAt,
          },
        },
        brand<string, 'IdempotencyKey'>(`${run.runId}:pending-input-required:${pendingInputId}`),
      );
    } finally {
      this.deps.onPendingInputCreated?.(timeoutAt);
    }
    return request;
  }

  private async appendEvent(
    run: RequestRun,
    context: RequestContext,
    event: RunTimelineEvent,
    idempotencyKey: IdempotencyKey,
    options: { readonly boundStructuredPayload?: boolean } = {},
  ): Promise<RunTimelineEventRecord> {
    this.assertRunContext(run, context);
    const runtimePayload = runtimeTimelinePayload(event.inlinePayload, context);
    const record: RunTimelineEventRecord = {
      tenantId: context.identityContext.tenantId,
      subjectId: context.identityContext.subjectId,
      agentId: run.agentId,
      agentVersion: run.agentVersion,
      eventId: event.eventId ?? this.deps.idFactory('event'),
      sessionId: run.sessionId,
      runId: run.runId,
      requestId: run.requestId,
      requestContextId: context.requestContextId,
      sequence: brand<number, 'TimelineSequence'>(0),
      type: event.type,
      inlinePayload: options.boundStructuredPayload === true ? truncateTimelineInlinePayload(runtimePayload) : runtimePayload,
      createdAt: brand<number, 'EpochMillis'>(event.createdAt instanceof Date ? event.createdAt.getTime() : this.deps.clock()),
      ...(event.contentRef === undefined ? {} : { contentRef: event.contentRef }),
    };
    const persisted = await this.deps.timelineStore.appendEvent(record, { idempotencyKey });
    this.deps.onTimelineAppend?.(persisted);
    return persisted;
  }

  private liveOnlyEvent(run: RequestRun, context: RequestContext, event: RunTimelineEvent): RunTimelineEvent {
    this.assertRunContext(run, context);
    return {
      eventId: event.eventId ?? this.deps.idFactory('event'),
      tenantId: context.identityContext.tenantId,
      subjectId: context.identityContext.subjectId,
      sessionId: run.sessionId,
      runId: run.runId,
      requestId: run.requestId,
      requestContextId: context.requestContextId,
      agentId: run.agentId,
      agentVersion: run.agentVersion,
      persistence: 'LIVE_ONLY',
      type: event.type,
      inlinePayload: event.inlinePayload,
      createdAt: event.createdAt ?? new Date(this.deps.clock()),
      ...(event.contentRef === undefined ? {} : { contentRef: event.contentRef }),
    };
  }

  private capabilityProducerRef(context: RequestContext): PendingInputProducerRef {
    const pendingToolCalls = context.toolCallStates.filter((toolCall) => toolCall.status === 'PENDING');
    if (pendingToolCalls.length !== 1) {
      throw new AgentError({
        code: 'PENDING_INPUT_PRODUCER_REF_UNAVAILABLE',
        message: 'Pending input capability producer reference is unavailable.',
        category: 'VALIDATION',
        retryable: false,
        safeDetails: { reasonCode: 'PENDING_INPUT_PRODUCER_REF_UNAVAILABLE' },
      });
    }
    const [toolCall] = pendingToolCalls;
    return {
      kind: 'CAPABILITY_INVOCATION',
      capabilityId: toolCall!.capabilityId,
      toolCallId: brand<string, 'ToolCallId'>(toolCall!.toolCallId) as ToolCallId,
    };
  }

  private async acceptedPendingInputTimeoutAt(
    timeoutAt: PendingInputIntent['timeoutAt'],
    createdAt: EpochMillis,
    producerRef: PendingInputProducerRef,
  ): Promise<EpochMillis> {
    if (timeoutAt !== undefined) {
      return timeoutAt;
    }

    if (
      producerRef.kind === 'CAPABILITY_INVOCATION' &&
      producerRef.capabilityId === 'AskUserQuestion' &&
      this.deps.askUserQuestionDefaultTimeoutMs !== undefined
    ) {
      try {
        const configuredTimeoutMs = Number(await this.deps.askUserQuestionDefaultTimeoutMs());
        if (Number.isSafeInteger(configuredTimeoutMs) && configuredTimeoutMs > 0 && configuredTimeoutMs <= MAX_ASK_USER_QUESTION_TIMEOUT_MS) {
          return brand<number, 'EpochMillis'>(Number(createdAt) + configuredTimeoutMs);
        }
      } catch {
        // Keep the runtime-owned safe default when the trusted provider fails.
      }
    }

    return brand<number, 'EpochMillis'>(Number(createdAt) + pendingInputDefaultTimeoutMs);
  }

  private assertValidPendingInputIntent(intent: PendingInputIntent, createdAt: EpochMillis, producerRef: PendingInputProducerRef): void {
    const workflowInterrupt = producerRef.kind === 'WORKFLOW_NODE' && producerRef.nodeType === 'INTERRUPT';
    if (!['QUESTION', 'CONFIRMATION', 'AUTHORIZATION', 'HUMAN_HANDOFF'].includes(intent.kind)) {
      throw new AgentError({
        code: 'PENDING_INPUT_INTENT_INVALID',
        message: 'Pending input kind is invalid.',
        category: 'VALIDATION',
        retryable: false,
      });
    }
    if (!Array.isArray(intent.questions) || intent.questions.length > 20 || (!workflowInterrupt && intent.questions.length === 0)) {
      throw new AgentError({
        code: 'PENDING_INPUT_INTENT_INVALID',
        message: 'Pending input questions are invalid.',
        category: 'VALIDATION',
        retryable: false,
      });
    }
    if (workflowInterrupt) {
      if (intent.kind !== 'QUESTION' || intent.questions.length !== 0) {
        throw new AgentError({
          code: 'PENDING_INPUT_INTENT_INVALID',
          message: 'Workflow interrupt pending input shape is invalid.',
          category: 'VALIDATION',
          retryable: false,
        });
      }
      return;
    }
    if (intent.timeoutAt !== undefined) {
      const now = Number(createdAt);
      const timeoutAt = Number(intent.timeoutAt);
      const maxTimeoutAt = now + (this.deps.pendingInputMaxTimeoutMs ?? pendingInputDefaultMaxTimeoutMs);
      if (!Number.isSafeInteger(timeoutAt) || timeoutAt <= now || timeoutAt > maxTimeoutAt) {
        throw new AgentError({
          code: 'PENDING_INPUT_INTENT_INVALID',
          message: 'Pending input timeout is invalid.',
          category: 'VALIDATION',
          retryable: false,
        });
      }
    }
    for (const question of intent.questions) {
      if (
        (question.multiple !== undefined && typeof question.multiple !== 'boolean') ||
        (question.custom !== undefined && typeof question.custom !== 'boolean')
      ) {
        throw new AgentError({
          code: 'PENDING_INPUT_INTENT_INVALID',
          message: 'Pending input question modifiers are invalid.',
          category: 'VALIDATION',
          retryable: false,
        });
      }
      if (
        typeof question.prompt !== 'string' ||
        question.prompt.trim().length === 0 ||
        question.prompt.length > 1000 ||
        !Array.isArray(question.options) ||
        question.options.length > 50
      ) {
        throw new AgentError({
          code: 'PENDING_INPUT_INTENT_INVALID',
          message: 'Pending input question shape is invalid.',
          category: 'VALIDATION',
          retryable: false,
        });
      }
      const optionValues = new Set<string>();
      let hasAttachedTextInput = false;
      for (const option of question.options) {
        if (
          typeof option.label !== 'string' ||
          option.label.trim().length === 0 ||
          option.label.length > 200 ||
          typeof option.value !== 'string' ||
          option.value.trim().length === 0 ||
          option.value.length > 200
        ) {
          throw new AgentError({
            code: 'PENDING_INPUT_INTENT_INVALID',
            message: 'Pending input option shape is invalid.',
            category: 'VALIDATION',
            retryable: false,
          });
        }
        if (
          (option.requiresTextInput !== undefined && typeof option.requiresTextInput !== 'boolean') ||
          (option.inputPlaceholder !== undefined &&
            (typeof option.inputPlaceholder !== 'string' ||
              option.inputPlaceholder.trim().length === 0 ||
              option.inputPlaceholder.length > 200 ||
              option.requiresTextInput !== true))
        ) {
          throw new AgentError({
            code: 'PENDING_INPUT_INTENT_INVALID',
            message: 'Pending input option text input shape is invalid.',
            category: 'VALIDATION',
            retryable: false,
          });
        }
        hasAttachedTextInput ||= option.requiresTextInput === true;
        if (optionValues.has(option.value)) {
          throw new AgentError({
            code: 'PENDING_INPUT_INTENT_INVALID',
            message: 'Pending input option values must be unique.',
            category: 'VALIDATION',
            retryable: false,
          });
        }
        optionValues.add(option.value);
      }
      if (hasAttachedTextInput && (intent.kind !== 'QUESTION' || question.multiple === true)) {
        throw new AgentError({
          code: 'PENDING_INPUT_INTENT_INVALID',
          message: 'Pending input option-attached text input shape is invalid.',
          category: 'VALIDATION',
          retryable: false,
        });
      }
    }
    if (intent.kind === 'CONFIRMATION' || intent.kind === 'AUTHORIZATION') {
      const question = intent.questions[0];
      const negativeValue = intent.kind === 'CONFIRMATION' ? 'reject' : 'deny';
      const optionValues = new Set<string>();
      if (question !== undefined) {
        for (const option of question.options) {
          optionValues.add(option.value);
        }
      }
      if (
        intent.questions.length !== 1 ||
        question === undefined ||
        question.multiple === true ||
        question.custom === true ||
        optionValues.size !== 2 ||
        !optionValues.has('approve') ||
        !optionValues.has(negativeValue)
      ) {
        throw new AgentError({
          code: 'PENDING_INPUT_INTENT_INVALID',
          message: `Pending input ${intent.kind.toLowerCase()} shape is invalid.`,
          category: 'VALIDATION',
          retryable: false,
        });
      }
    }
    if (intent.kind === 'HUMAN_HANDOFF') {
      const modeQuestion = intent.questions[0];
      const contentQuestion = intent.questions[1];
      const modeValues = new Set<string>();
      if (modeQuestion !== undefined) {
        for (const option of modeQuestion.options) {
          modeValues.add(option.value);
        }
      }
      if (
        intent.questions.length !== 2 ||
        modeQuestion === undefined ||
        contentQuestion === undefined ||
        modeQuestion.multiple === true ||
        modeQuestion.custom === true ||
        contentQuestion.multiple === true ||
        contentQuestion.custom === true ||
        modeValues.size !== 2 ||
        !modeValues.has('final_answer') ||
        !modeValues.has('resume_instruction') ||
        contentQuestion.options.length !== 0
      ) {
        throw new AgentError({
          code: 'PENDING_INPUT_INTENT_INVALID',
          message: 'Pending input handoff shape is invalid.',
          category: 'VALIDATION',
          retryable: false,
        });
      }
    }
  }

  private assertRunContext(run: RequestRun, context: RequestContext): void {
    if (
      run.runId !== context.runId ||
      run.sessionId !== context.sessionId ||
      run.requestId !== context.requestId ||
      run.agentId !== context.agentId
    ) {
      throw new AgentError({
        code: 'RUN_CONTEXT_MISMATCH',
        message: 'Run state write context does not match the accepted run.',
        category: 'VALIDATION',
        retryable: false,
      });
    }
  }
}

function terminalSourceConflict(): AgentError {
  return new AgentError({
    code: 'TERMINAL_ANSWER_SOURCE_CONFLICT',
    message: 'A run cannot combine final LLM and Capability terminal answer sources.',
    category: 'CONFLICT',
    retryable: false,
  });
}
