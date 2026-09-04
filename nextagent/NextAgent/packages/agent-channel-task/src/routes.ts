import {
  AgentError,
  brand,
  getLogger,
  type AgentId,
  type AttachmentId,
  type AttachmentIntakeReservationId,
  type IdempotencyKey,
  type IdentityContext,
  type JsonObject,
  type MessageId,
  type RequestContextId,
  type RequestRunId,
  type SafeError,
  type SessionId,
  type TaskEventId,
  isTaskEventId,
} from '@nextagent/agent-common';
import { randomUUID } from 'node:crypto';
import type { RuntimeCommandPort, RuntimeSessionPort } from '@nextagent/agent-contracts/runtime';
import type { ExecutionCorrelationPort, W3CTraceCarrier } from '@nextagent/agent-contracts/observability';
import { Type } from '@sinclair/typebox';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import type { IdentityResolver } from '@nextagent/agent-channel-common';
import {
  cleanupOrphanSession,
  deliverWebStream,
  extractHeaderAgentId,
  isFastifyBodyParseError,
  bodyParseErrorMessage,
  parseLastSeenSequence,
  sendSseStream,
} from '@nextagent/agent-channel-common';

const logger = getLogger({ component: 'agent-channel-task', source: 'routes' });

import {
  mapTaskStreamEnvelopes,
  projectRunStatusToTaskStatus,
  statusFor,
  isTerminalTaskEventType,
  type TaskStatus,
  type TaskEvent,
} from './task-status.js';
import { deliverTaskCallbacks, type TaskCallbackDeliveryPort, type TaskCallbackTarget, type ReportEvents } from './task-callback.js';
import { SingleTaskMessagesSchema, BatchSingleTaskMessagesSchema, parseSingleTaskMessage, projectTaskMessageInput } from './task-message.js';

const TASK_BATCH_MAX_ITEMS = 20;
const TASK_ID_MAX_LENGTH = 256;
const TASK_LOCALE_MAX_LENGTH = 35;
const TASK_CALLBACK_URL_MAX_LENGTH = 2048;
const TASK_LOCALE_PATTERN = '^[a-zA-Z][a-zA-Z-]*[a-zA-Z]$|^[a-zA-Z]$';
const TASK_LOCALE_PATTERN_REGEX = new RegExp(TASK_LOCALE_PATTERN);
const TASK_PENDING_INPUT_ANSWER_MAX_LENGTH = 4096;
const TASK_PENDING_INPUT_ANSWERS_MAX_ITEMS = 100;

export interface TaskAttachmentIntakeRuntime {
  intake: (request: TaskAttachmentIntakeRequest) => Promise<TaskAttachmentIntakeResult>;
}

export interface TaskAttachmentIntakeRequest {
  readonly identityContext: IdentityContext;
  readonly agentId: AgentId;
  readonly reservationId: AttachmentIntakeReservationId;
  readonly sessionId: SessionId;
  readonly requestId: MessageId;
  readonly runId: RequestRunId;
  readonly requestContextId: RequestContextId;
  readonly action: 'SUBMIT_REQUEST' | 'EDIT_LATEST_REQUEST';
  readonly files: ReadonlyArray<{
    readonly fileName: string;
    readonly declaredMimeType: string;
    readonly sizeBytes: number;
    readonly bytes: Uint8Array;
  }>;
  readonly idempotencyKey: IdempotencyKey;
}

export interface TaskAttachmentIntakeResult {
  readonly status: 'ACCEPTED' | 'REJECTED';
  readonly attachmentIds: readonly AttachmentId[];
  readonly rejected: ReadonlyArray<{ readonly reasonCode: string }>;
  readonly safeError?: SafeError;
}

export interface TaskChannelDependencies {
  readonly runtime: RuntimeCommandPort;
  readonly sessions: RuntimeSessionPort;
  readonly attachmentRuntime: TaskAttachmentIntakeRuntime;
  readonly identityResolver: IdentityResolver;
  readonly callbackDeliveryPort?: TaskCallbackDeliveryPort;
  readonly callbackDeliveryOptions?: {
    readonly timeoutMs: number;
    readonly maxRetries: number;
  };
  readonly traceEnabled?: boolean;
  readonly executionCorrelation?: ExecutionCorrelationPort;
  // Public path prefix P (default `/` = no prefix). The API segment `/api/v1`
  // is fixed; P is only prepended in front of it so routes mount at
  // /api/v1/... (P=/) or /svcA/api/v1/... (P=/svcA). Mirrors the Web channel.
  readonly routePrefix?: string;
}

export interface TaskControlResponse {
  readonly sessionId: string;
  readonly taskId: string;
  readonly taskStatus: TaskStatus;
}

export type TaskBatchItemResult =
  TaskControlResponse | { readonly error: { readonly code: string; readonly message: string; readonly retryable: boolean } };

export interface TaskBatchResponse {
  readonly results: readonly TaskBatchItemResult[];
}

const reportEventsSchema = Type.Union([Type.Literal('ALL'), Type.Literal('TERMINAL'), Type.Array(Type.String({ minLength: 1 }))]);

const streamCreateTaskBody = Type.Object(
  {
    taskMessages: SingleTaskMessagesSchema,
    locale: Type.Optional(Type.String({ minLength: 2, maxLength: TASK_LOCALE_MAX_LENGTH, pattern: TASK_LOCALE_PATTERN })),
    idempotencyKey: Type.Optional(Type.String({ minLength: 1, maxLength: TASK_ID_MAX_LENGTH })),
    reportEvents: Type.Optional(reportEventsSchema),
  },
  { additionalProperties: false },
);

const streamEditTaskBody = Type.Object(
  {
    sessionId: Type.String({ minLength: 1, maxLength: TASK_ID_MAX_LENGTH }),
    taskMessages: SingleTaskMessagesSchema,
    idempotencyKey: Type.String({ minLength: 1, maxLength: TASK_ID_MAX_LENGTH }),
    locale: Type.Optional(Type.String({ minLength: 2, maxLength: TASK_LOCALE_MAX_LENGTH, pattern: TASK_LOCALE_PATTERN })),
    reportEvents: Type.Optional(reportEventsSchema),
  },
  { additionalProperties: false },
);

const streamRetryTaskBody = Type.Object(
  {
    sessionId: Type.String({ minLength: 1, maxLength: TASK_ID_MAX_LENGTH }),
  },
  { additionalProperties: false },
);

const asyncCreateTaskItemSchema = Type.Object(
  {
    taskMessages: BatchSingleTaskMessagesSchema,
    callbackTarget: Type.Object(
      {
        url: Type.String({ minLength: 1, maxLength: TASK_CALLBACK_URL_MAX_LENGTH }),
      },
      { additionalProperties: false },
    ),
    locale: Type.Optional(Type.String({ minLength: 2, maxLength: TASK_LOCALE_MAX_LENGTH, pattern: TASK_LOCALE_PATTERN })),
    reportEvents: Type.Optional(reportEventsSchema),
  },
  { additionalProperties: false },
);

const asyncCreateTaskBody = Type.Object(
  { tasks: Type.Array(asyncCreateTaskItemSchema, { minItems: 1, maxItems: TASK_BATCH_MAX_ITEMS }) },
  { additionalProperties: false },
);

const asyncEditTaskItemSchema = Type.Object(
  {
    taskId: Type.String({ minLength: 1, maxLength: TASK_ID_MAX_LENGTH }),
    sessionId: Type.String({ minLength: 1, maxLength: TASK_ID_MAX_LENGTH }),
    taskMessages: SingleTaskMessagesSchema,
    idempotencyKey: Type.String({ minLength: 1, maxLength: TASK_ID_MAX_LENGTH }),
    locale: Type.Optional(Type.String({ minLength: 2, maxLength: TASK_LOCALE_MAX_LENGTH, pattern: TASK_LOCALE_PATTERN })),
  },
  { additionalProperties: false },
);

const asyncEditTaskBody = Type.Object(
  { tasks: Type.Array(asyncEditTaskItemSchema, { minItems: 1, maxItems: TASK_BATCH_MAX_ITEMS }) },
  { additionalProperties: false },
);

const asyncRetryTaskItemSchema = Type.Object(
  {
    taskId: Type.String({ minLength: 1, maxLength: TASK_ID_MAX_LENGTH }),
    sessionId: Type.String({ minLength: 1, maxLength: TASK_ID_MAX_LENGTH }),
  },
  { additionalProperties: false },
);

const asyncRetryTaskBody = Type.Object(
  { tasks: Type.Array(asyncRetryTaskItemSchema, { minItems: 1, maxItems: TASK_BATCH_MAX_ITEMS }) },
  { additionalProperties: false },
);

const taskControlItemSchema = Type.Object(
  {
    taskId: Type.String({ minLength: 1, maxLength: TASK_ID_MAX_LENGTH }),
    sessionId: Type.String({ minLength: 1, maxLength: TASK_ID_MAX_LENGTH }),
  },
  { additionalProperties: false },
);

const cancelTaskBody = Type.Object(
  { tasks: Type.Array(taskControlItemSchema, { minItems: 1, maxItems: TASK_BATCH_MAX_ITEMS }) },
  { additionalProperties: false },
);

const pendingInputAnswerItemSchema = Type.Object(
  {
    taskId: Type.String({ minLength: 1, maxLength: TASK_ID_MAX_LENGTH }),
    pendingInputId: Type.String({ minLength: 1, maxLength: TASK_ID_MAX_LENGTH }),
    sessionId: Type.String({ minLength: 1, maxLength: TASK_ID_MAX_LENGTH }),
    answers: Type.Array(
      Type.Array(Type.String({ minLength: 1, maxLength: TASK_PENDING_INPUT_ANSWER_MAX_LENGTH }), {
        minItems: 1,
        maxItems: TASK_PENDING_INPUT_ANSWERS_MAX_ITEMS,
      }),
      { minItems: 1, maxItems: TASK_PENDING_INPUT_ANSWERS_MAX_ITEMS },
    ),
  },
  { additionalProperties: false },
);

const pendingInputAnswerBody = Type.Object(
  { tasks: Type.Array(pendingInputAnswerItemSchema, { minItems: 1, maxItems: TASK_BATCH_MAX_ITEMS }) },
  { additionalProperties: false },
);

const taskQueryItemSchema = Type.Object(
  {
    sessionId: Type.String({ minLength: 1, maxLength: TASK_ID_MAX_LENGTH }),
    taskId: Type.String({ minLength: 1, maxLength: TASK_ID_MAX_LENGTH }),
  },
  { additionalProperties: false },
);

const taskQueryBody = Type.Object(
  { tasks: Type.Array(taskQueryItemSchema, { minItems: 1, maxItems: TASK_BATCH_MAX_ITEMS }) },
  { additionalProperties: false },
);

export async function registerTaskChannel(instance: FastifyInstance, dependencies: TaskChannelDependencies): Promise<void> {
  instance.register(async (taskChannel) => {
    await registerTaskChannelRoutes(taskChannel, dependencies);
  });
}

async function registerTaskChannelRoutes(instance: FastifyInstance, dependencies: TaskChannelDependencies): Promise<void> {
  // Public path prefix P (default `/` = no prefix). The API segment `/api/v1`
  // is fixed; P is only prepended in front of it so routes mount at
  // /api/v1/... (P=/) or /svcA/api/v1/... (P=/svcA). Mirrors the Web channel.
  const routePrefix = dependencies.routePrefix ?? '/';
  const API_SEGMENT = '/api/v1';
  function route(path: string): string {
    const prefix = routePrefix === '/' ? '' : routePrefix;
    return `${prefix}${API_SEGMENT}/${path}`;
  }

  if (!instance.hasContentTypeParser(/^multipart\/form-data/i)) {
    instance.addContentTypeParser(/^multipart\/form-data/i, { parseAs: 'buffer' }, (_request, body, done) => {
      done(null, body);
    });
  }

  instance.setErrorHandler(async (error, request, reply) => {
    // Fastify body-parse errors (empty/malformed body, wrong media type, NUL byte)
    // carry their own statusCode (400 / 415) but no `validation` array, so they
    // must be detected by code — otherwise they fall through to INTERNAL/500.
    const isBodyParseError = isFastifyBodyParseError(error);
    const isExpected = error instanceof AgentError ? error.category !== 'INTERNAL' : isFastifyValidationError(error) || isBodyParseError;
    const status = error instanceof AgentError ? statusFor(error) : isBodyParseError ? error.statusCode : isExpected ? 400 : 500;
    if (!isExpected) {
      logger.error({
        err: error,
        event: 'channel.task.request.failed',
        failureStage: 'TASK_CHANNEL_REQUEST',
        serverRequestId: request.id,
      });
    }
    await reply.status(status).send({
      error: {
        code: error instanceof AgentError ? error.code : isExpected ? 'REQUEST_VALIDATION_FAILED' : 'INTERNAL_SERVER_ERROR',
        message:
          error instanceof AgentError
            ? error.message
            : isBodyParseError
              ? bodyParseErrorMessage(error.code)
              : isExpected
                ? 'Request validation failed.'
                : 'An internal error occurred. Retry the request.',
        retryable: error instanceof AgentError ? error.retryable : false,
      },
    });
  });

  // stream-task: POST directly returns SSE
  instance.post(
    route('stream-task'),
    { config: { opLog: { prefix: 'TaskController.streamCreateTask', level: 'MINOR' as const } }, schema: { body: streamCreateTaskBody } },
    async (request, reply) => {
      const identity = resolveIdentityOrThrow(dependencies.identityResolver, request, reply);
      if (identity === undefined) {
        return;
      }
      (request as any).opLogIdentity = identity;
      const parsed = isMultipartRequest(request)
        ? parseMultipartStreamCreateTask(request)
        : parseStreamCreateTaskItem(request.body as StreamCreateTaskItem);
      const accepted = await withIncomingTrace(dependencies, request, () =>
        submitCreateTask(dependencies, identity, parsed, extractHeaderAgentId(request)),
      );
      await streamTaskSseResponse(dependencies, identity, request, reply, accepted.sessionId, accepted.requestId);
    },
  );

  instance.post(
    route('stream-task/:taskId/edit'),
    { config: { opLog: { prefix: 'TaskController.streamEditTask', level: 'MINOR' as const } }, schema: { body: streamEditTaskBody } },
    async (request, reply) => {
      const identity = resolveIdentityOrThrow(dependencies.identityResolver, request, reply);
      if (identity === undefined) {
        return;
      }
      (request as any).opLogIdentity = identity;
      const params = request.params as { taskId: string };
      const body = request.body as { sessionId: string; taskMessages: unknown; idempotencyKey: string; locale?: string };
      const parsed = isMultipartRequest(request) ? parseMultipartStreamEditTask(request) : parseStreamEditTaskItem(body);
      const accepted = await submitEditTask(dependencies, identity, params.taskId, parsed);
      await streamTaskSseResponse(
        dependencies,
        identity,
        request,
        reply,
        brand<string, 'SessionId'>(body.sessionId),
        accepted.requestId,
        accepted.runId,
      );
    },
  );

  instance.post(
    route('stream-task/:taskId/retry'),
    { config: { opLog: { prefix: 'TaskController.streamRetryTask', level: 'MINOR' as const } }, schema: { body: streamRetryTaskBody } },
    async (request, reply) => {
      const identity = resolveIdentityOrThrow(dependencies.identityResolver, request, reply);
      if (identity === undefined) {
        return;
      }
      (request as any).opLogIdentity = identity;
      const params = request.params as { taskId: string };
      const body = request.body as { sessionId: string };
      const accepted = await submitRetryTask(dependencies, identity, params.taskId, body);
      await streamTaskSseResponse(
        dependencies,
        identity,
        request,
        reply,
        brand<string, 'SessionId'>(body.sessionId),
        accepted.requestId,
        accepted.runId,
      );
    },
  );

  // async-tasks: JSON + callback
  instance.post(
    route('async-tasks'),
    { config: { opLog: { prefix: 'TaskController.createAsyncTask', level: 'MINOR' as const } }, schema: { body: asyncCreateTaskBody } },
    async (request, reply) => {
      const identity = resolveIdentityOrThrow(dependencies.identityResolver, request, reply);
      if (identity === undefined) {
        return undefined;
      }
      (request as any).opLogIdentity = identity;
      if (dependencies.callbackDeliveryPort === undefined) {
        throw new AgentError({
          code: 'ASYNC_CALLBACK_UNAVAILABLE',
          message: 'Async callback is not configured. Use the stream-task endpoint or contact the administrator.',
          category: 'UNAVAILABLE',
          retryable: false,
        });
      }
      const body = request.body as { tasks: readonly AsyncCreateTaskItem[] };
      const results: TaskBatchItemResult[] = [];
      for (const item of body.tasks) {
        results.push(
          await withIncomingTrace(dependencies, request, () =>
            processAsyncCreateTaskItem(dependencies, identity, item, extractHeaderAgentId(request)),
          ),
        );
      }
      applyAllFailedBatchStatus(reply, results);
      return { results };
    },
  );

  instance.post(
    route('async-tasks/edit'),
    { config: { opLog: { prefix: 'TaskController.editTask', level: 'MINOR' as const } }, schema: { body: asyncEditTaskBody } },
    async (request, reply) => {
      const identity = resolveIdentityOrThrow(dependencies.identityResolver, request, reply);
      if (identity === undefined) {
        return undefined;
      }
      (request as any).opLogIdentity = identity;
      const body = request.body as { tasks: readonly AsyncEditTaskItem[] };
      const results: TaskBatchItemResult[] = [];
      for (const item of body.tasks) {
        results.push(await processAsyncEditTaskItem(dependencies, identity, item));
      }
      applyAllFailedBatchStatus(reply, results);
      return { results };
    },
  );

  instance.post(
    route('async-tasks/retry'),
    { config: { opLog: { prefix: 'TaskController.retryTask', level: 'MINOR' as const } }, schema: { body: asyncRetryTaskBody } },
    async (request, reply) => {
      const identity = resolveIdentityOrThrow(dependencies.identityResolver, request, reply);
      if (identity === undefined) {
        return undefined;
      }
      (request as any).opLogIdentity = identity;
      const body = request.body as { tasks: readonly AsyncRetryTaskItem[] };
      const results: TaskBatchItemResult[] = [];
      for (const item of body.tasks) {
        results.push(await processAsyncRetryTaskItem(dependencies, identity, item));
      }
      applyAllFailedBatchStatus(reply, results);
      return { results };
    },
  );

  // tasks: shared JSON endpoints
  instance.post(
    route('tasks/cancel'),
    { config: { opLog: { prefix: 'TaskController.cancelTask', level: 'MINOR' as const } }, schema: { body: cancelTaskBody } },
    async (request, reply) => {
      const identity = resolveIdentityOrThrow(dependencies.identityResolver, request, reply);
      if (identity === undefined) {
        return undefined;
      }
      (request as any).opLogIdentity = identity;
      const body = request.body as { tasks: readonly TaskControlItem[] };
      const results: TaskBatchItemResult[] = [];
      for (const item of body.tasks) {
        results.push(await processCancelTaskItem(dependencies, identity, item));
      }
      applyAllFailedBatchStatus(reply, results);
      return { results };
    },
  );

  instance.post(
    route('tasks/pending-inputs/answer'),
    { config: { opLog: { prefix: 'TaskController.answerPendingInput', level: 'MINOR' as const } }, schema: { body: pendingInputAnswerBody } },
    async (request, reply) => {
      const identity = resolveIdentityOrThrow(dependencies.identityResolver, request, reply);
      if (identity === undefined) {
        return undefined;
      }
      (request as any).opLogIdentity = identity;
      const body = request.body as { tasks: readonly PendingInputAnswerItem[] };
      const results: TaskBatchItemResult[] = [];
      for (const item of body.tasks) {
        results.push(await processPendingInputAnswerItem(dependencies, identity, item));
      }
      applyAllFailedBatchStatus(reply, results);
      return { results };
    },
  );

  instance.post(route('tasks/query'), { schema: { body: taskQueryBody } }, async (request, reply) => {
    const identity = resolveIdentityOrThrow(dependencies.identityResolver, request, reply);
    if (identity === undefined) {
      return undefined;
    }
    const body = request.body as { tasks: ReadonlyArray<{ taskId: string; sessionId: string }> };
    const results: TaskQueryItemResult[] = [];
    for (const item of body.tasks) {
      results.push(await processTaskQueryItem(dependencies, identity, item));
    }
    return { results };
  });
}

function taskControlResponse(sessionId: string, taskId: string, taskStatus: TaskStatus): TaskControlResponse {
  return {
    sessionId: String(sessionId),
    taskId: String(taskId),
    taskStatus,
  };
}

function batchItemError(error: unknown): { readonly error: { readonly code: string; readonly message: string; readonly retryable: boolean } } {
  if (error instanceof AgentError) {
    return { error: { code: error.code, message: error.message, retryable: error.retryable } };
  }
  logger.error({
    err: error,
    event: 'channel.task.batch.item.failed',
    failureStage: 'TASK_CHANNEL_BATCH_ITEM',
  });
  return { error: { code: 'INTERNAL_SERVER_ERROR', message: 'An internal error occurred. Retry the request.', retryable: false } };
}

function applyAllFailedBatchStatus(reply: FastifyReply, results: readonly TaskBatchItemResult[]): void {
  if (results.length > 0 && results.every((r) => 'error' in r)) {
    reply.status(400);
  }
}

function validateMultipartScalarFieldsWithSession(fields: Record<string, string>): void {
  validateMultipartString(fields.sessionId, 'sessionId', true, TASK_ID_MAX_LENGTH);
  validateMultipartString(fields.idempotencyKey, 'idempotencyKey', true, TASK_ID_MAX_LENGTH);
  validateMultipartString(fields.locale, 'locale', false, TASK_LOCALE_MAX_LENGTH, 2);
  if (fields.locale !== undefined && !TASK_LOCALE_PATTERN_REGEX.test(fields.locale)) {
    throw new AgentError({ code: 'REQUEST_VALIDATION_FAILED', message: 'Multipart locale is invalid.', category: 'VALIDATION', retryable: false });
  }
}

function retryControlResponse(sessionId: string, taskId: string, taskStatus: TaskStatus, attempt: number): TaskControlResponse & { attempt: number } {
  return { ...taskControlResponse(sessionId, taskId, taskStatus), attempt };
}

function registerTaskCallbackDelivery(
  dependencies: TaskChannelDependencies,
  identity: IdentityContext,
  sessionId: SessionId,
  requestId: MessageId,
  target: TaskCallbackTarget,
  reportEvents: ReportEvents,
): void {
  if (dependencies.callbackDeliveryPort === undefined || dependencies.callbackDeliveryOptions === undefined) {
    return;
  }
  deliverTaskCallbacks({
    sessions: dependencies.sessions,
    identityContext: identity,
    sessionId,
    requestId,
    reportEvents,
    options: {
      deliveryPort: dependencies.callbackDeliveryPort,
      target,
      ...(dependencies.callbackDeliveryOptions.timeoutMs === undefined ? {} : { timeoutMs: dependencies.callbackDeliveryOptions.timeoutMs }),
      ...(dependencies.callbackDeliveryOptions.maxRetries === undefined ? {} : { maxRetries: dependencies.callbackDeliveryOptions.maxRetries }),
    },
  }).catch(() => {
    /* callback failure does not change runtime truth */
  });
}

function generateIdempotencyKey(): string {
  return randomUUID();
}

function withIncomingTrace<T>(dependencies: TaskChannelDependencies, request: FastifyRequest, operation: () => Promise<T>): Promise<T> {
  return dependencies.executionCorrelation?.withIncomingCarrier(traceCarrierFromRequest(request), operation) ?? operation();
}

function traceCarrierFromRequest(request: FastifyRequest): W3CTraceCarrier | undefined {
  const traceparent = singleHeader(request.headers.traceparent);
  const tracestate = singleHeader(request.headers.tracestate);
  return traceparent === undefined && tracestate === undefined
    ? undefined
    : {
        ...(traceparent === undefined ? {} : { traceparent }),
        ...(tracestate === undefined ? {} : { tracestate }),
      };
}

function singleHeader(value?: string | readonly string[]): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

async function submitCreateTask(
  dependencies: TaskChannelDependencies,
  identity: IdentityContext,
  parsed: ParsedCreateTask,
  headerAgentId?: string,
): Promise<{ readonly sessionId: SessionId; readonly requestId: MessageId }> {
  rejectUnavailableRemoteFile(parsed.remoteFile);
  const idempotencyKey = parsed.idempotencyKey ?? generateIdempotencyKey();
  const session = await dependencies.sessions.createSession({
    identityContext: identity,
    idempotencyKey: brand<string, 'IdempotencyKey'>(`${idempotencyKey}:session`),
    ...(parsed.locale === undefined ? {} : { locale: brand<string, 'RequestLocale'>(parsed.locale) }),
    ...(headerAgentId === undefined ? {} : { agentId: headerAgentId }),
  });
  try {
    const attachmentResolution = await resolveTaskAttachments(
      dependencies,
      identity,
      session.agentId,
      session.sessionId,
      parsed.files,
      idempotencyKey,
      'SUBMIT_REQUEST',
      parsed.inputText,
      parsed.locale,
    );
    const accepted = await dependencies.runtime.submit({
      sessionId: session.sessionId,
      identityContext: identity,
      inputText: parsed.inputText,
      attachmentIds: attachmentResolution.attachmentIds,
      locale: brand<string, 'RequestLocale'>(parsed.locale ?? 'zh-CN'),
      idempotencyKey: brand<string, 'IdempotencyKey'>(idempotencyKey),
      ...(parsed.inputVariables === undefined ? {} : { inputVariables: parsed.inputVariables }),
      ...(attachmentResolution.reservedRequest === undefined ? {} : { reservedRequest: attachmentResolution.reservedRequest }),
      ...(dependencies.traceEnabled === true && parsed.taskEventId !== undefined
        ? { propagationAttributes: { taskEventId: parsed.taskEventId } }
        : {}),
    });
    return { sessionId: accepted.sessionId, requestId: accepted.requestId };
  } catch (error) {
    await cleanupOrphanSession(dependencies.sessions, identity, session.sessionId);
    throw error;
  }
}

async function streamTaskSseResponse(
  dependencies: TaskChannelDependencies,
  identity: IdentityContext,
  request: FastifyRequest,
  reply: FastifyReply,
  sessionId: SessionId,
  requestId: MessageId,
  runId?: RequestRunId,
): Promise<void> {
  const abortController = new AbortController();
  const abortStream = () => abortController.abort();
  request.raw.on('aborted', abortStream);
  reply.raw.on('close', abortStream);
  try {
    await sendSseStream(
      reply,
      filterTaskEvents(
        mapTaskStreamEnvelopes(
          deliverWebStream({
            sessions: dependencies.sessions,
            identityContext: identity,
            sessionId,
            requestId,
            ...(runId === undefined ? {} : { runId }),
            lastSeenSequence: brand<number, 'TimelineSequence'>(0),
            signal: abortController.signal,
          }),
        ),
        true,
      ),
      {
        onDiagnostic: () => abortController.abort(),
      },
    );
  } finally {
    request.raw.off('aborted', abortStream);
    reply.raw.off('close', abortStream);
  }
}

async function submitEditTask(
  dependencies: TaskChannelDependencies,
  identity: IdentityContext,
  taskId: string,
  parsed: ParsedEditTask,
): Promise<{ readonly requestId: MessageId; readonly runId: RequestRunId }> {
  rejectUnavailableRemoteFile(parsed.remoteFile);
  const sessionId = brand<string, 'SessionId'>(parsed.sessionId);
  const session = await dependencies.sessions.requireSession({ identityContext: identity, sessionId });
  const attachmentResolution = await resolveTaskAttachments(
    dependencies,
    identity,
    session.agentId,
    sessionId,
    parsed.files,
    parsed.idempotencyKey,
    'EDIT_LATEST_REQUEST',
    parsed.inputText,
    parsed.locale,
  );
  const accepted = await dependencies.runtime.editLatest({
    sessionId,
    identityContext: identity,
    expectedLatestRequestId: brand<string, 'MessageId'>(taskId),
    editedInputText: parsed.inputText,
    attachmentIds: attachmentResolution.attachmentIds,
    idempotencyKey: brand<string, 'IdempotencyKey'>(parsed.idempotencyKey),
    ...(parsed.locale === undefined ? {} : { locale: brand<string, 'RequestLocale'>(parsed.locale) }),
    ...(parsed.inputVariables === undefined ? {} : { inputVariables: parsed.inputVariables }),
    ...(attachmentResolution.reservedRequest === undefined ? {} : { reservedRequest: attachmentResolution.reservedRequest }),
  });
  return { requestId: accepted.requestId, runId: accepted.runId };
}

async function submitRetryTask(
  dependencies: TaskChannelDependencies,
  identity: IdentityContext,
  taskId: string,
  body: { sessionId: string },
): Promise<{ readonly requestId: MessageId; readonly runId: RequestRunId; readonly attempt: number }> {
  const sessionId = brand<string, 'SessionId'>(body.sessionId);
  await dependencies.sessions.requireSession({ identityContext: identity, sessionId });
  const accepted = await dependencies.runtime.retryLatest({
    sessionId,
    identityContext: identity,
    expectedLatestRequestId: brand<string, 'MessageId'>(taskId),
    action: 'RETRY_LATEST',
    idempotencyKey: brand<string, 'IdempotencyKey'>(generateIdempotencyKey()),
  });
  return { requestId: accepted.requestId, runId: accepted.runId, attempt: accepted.attempt };
}

async function* filterTaskEvents(events: AsyncIterable<TaskEvent>, stream: boolean): AsyncIterable<TaskEvent> {
  for await (const event of events) {
    if (stream || isStreamAlwaysEvent(event.eventType)) {
      yield event;
    }
    if (isTerminalTaskEventType(event.eventType)) {
      return;
    }
  }
}

function isStreamAlwaysEvent(eventType: TaskEvent['eventType']): boolean {
  return (
    eventType === 'TASK_ACCEPTED' ||
    eventType === 'TASK_COMPLETED' ||
    eventType === 'TASK_FAILED' ||
    eventType === 'TASK_CANCELED' ||
    eventType === 'TASK_SUPERSEDED' ||
    eventType === 'USER_INPUT_REQUIRED'
  );
}

async function processAsyncCreateTaskItem(
  dependencies: TaskChannelDependencies,
  identity: IdentityContext,
  item: AsyncCreateTaskItem,
  headerAgentId?: string,
): Promise<TaskBatchItemResult> {
  let createdSessionId: SessionId | undefined;
  try {
    const parsed = parseAsyncCreateTaskItem(item);
    rejectUnavailableRemoteFile(parsed.remoteFile);
    dependencies.callbackDeliveryPort?.validateTarget(parsed.callbackTarget);
    const idempotencyKey = generateIdempotencyKey();
    const session = await dependencies.sessions.createSession({
      identityContext: identity,
      idempotencyKey: brand<string, 'IdempotencyKey'>(`${idempotencyKey}:session`),
      ...(parsed.locale === undefined ? {} : { locale: brand<string, 'RequestLocale'>(parsed.locale) }),
      ...(headerAgentId === undefined ? {} : { agentId: headerAgentId }),
    });
    createdSessionId = session.sessionId;
    const attachmentResolution = await resolveTaskAttachments(
      dependencies,
      identity,
      session.agentId,
      session.sessionId,
      parsed.files,
      idempotencyKey,
      'SUBMIT_REQUEST',
      parsed.inputText,
      parsed.locale,
    );
    const accepted = await dependencies.runtime.submit({
      sessionId: session.sessionId,
      identityContext: identity,
      inputText: parsed.inputText,
      attachmentIds: attachmentResolution.attachmentIds,
      locale: brand<string, 'RequestLocale'>(parsed.locale ?? 'zh-CN'),
      idempotencyKey: brand<string, 'IdempotencyKey'>(idempotencyKey),
      ...(parsed.inputVariables === undefined ? {} : { inputVariables: parsed.inputVariables }),
      ...(attachmentResolution.reservedRequest === undefined ? {} : { reservedRequest: attachmentResolution.reservedRequest }),
      ...(dependencies.traceEnabled === true && parsed.taskEventId !== undefined
        ? { propagationAttributes: { taskEventId: parsed.taskEventId } }
        : {}),
    });
    registerTaskCallbackDelivery(
      dependencies,
      identity,
      session.sessionId,
      accepted.requestId,
      parsed.callbackTarget,
      parsed.reportEvents ?? 'TERMINAL',
    );
    return taskControlResponse(accepted.sessionId, accepted.requestId, projectRunStatusToTaskStatus('ACCEPTED'));
  } catch (error) {
    if (createdSessionId !== undefined) {
      await cleanupOrphanSession(dependencies.sessions, identity, createdSessionId);
    }
    return batchItemError(error);
  }
}
async function processAsyncEditTaskItem(
  dependencies: TaskChannelDependencies,
  identity: IdentityContext,
  item: AsyncEditTaskItem,
): Promise<TaskBatchItemResult> {
  try {
    const projected = projectTaskMessageInput(parseSingleTaskMessage(item.taskMessages));
    rejectUnavailableRemoteFile(projected.remoteFile);
    const sessionId = brand<string, 'SessionId'>(item.sessionId);
    const session = await dependencies.sessions.requireSession({ identityContext: identity, sessionId });
    const attachmentResolution = await resolveTaskAttachments(
      dependencies,
      identity,
      session.agentId,
      sessionId,
      projected.inlineFile === undefined ? [] : [projected.inlineFile],
      item.idempotencyKey,
      'EDIT_LATEST_REQUEST',
      projected.inputText,
      item.locale,
    );
    const accepted = await dependencies.runtime.editLatest({
      sessionId,
      identityContext: identity,
      expectedLatestRequestId: brand<string, 'MessageId'>(item.taskId),
      editedInputText: projected.inputText,
      attachmentIds: attachmentResolution.attachmentIds,
      idempotencyKey: brand<string, 'IdempotencyKey'>(item.idempotencyKey),
      ...(item.locale === undefined ? {} : { locale: brand<string, 'RequestLocale'>(item.locale) }),
      ...(projected.inputVariables === undefined ? {} : { inputVariables: projected.inputVariables }),
      ...(attachmentResolution.reservedRequest === undefined ? {} : { reservedRequest: attachmentResolution.reservedRequest }),
    });
    return taskControlResponse(accepted.sessionId, accepted.requestId, projectRunStatusToTaskStatus('ACCEPTED'));
  } catch (error) {
    return batchItemError(error);
  }
}
async function processCancelTaskItem(
  dependencies: TaskChannelDependencies,
  identity: IdentityContext,
  item: TaskControlItem,
): Promise<TaskBatchItemResult> {
  try {
    const sessionId = brand<string, 'SessionId'>(item.sessionId);
    await dependencies.sessions.requireSession({ identityContext: identity, sessionId });
    const idempotencyKey = generateIdempotencyKey();
    const accepted = await dependencies.runtime.cancel({
      sessionId,
      identityContext: identity,
      expectedLatestRequestId: brand<string, 'MessageId'>(item.taskId),
      action: 'CANCEL',
      idempotencyKey: brand<string, 'IdempotencyKey'>(idempotencyKey),
    });
    return taskControlResponse(accepted.sessionId, accepted.targetRequestId, 'TASK_CANCELED');
  } catch (error) {
    return batchItemError(error);
  }
}

async function processAsyncRetryTaskItem(
  dependencies: TaskChannelDependencies,
  identity: IdentityContext,
  item: AsyncRetryTaskItem,
): Promise<TaskBatchItemResult> {
  try {
    const sessionId = brand<string, 'SessionId'>(item.sessionId);
    await dependencies.sessions.requireSession({ identityContext: identity, sessionId });
    const accepted = await dependencies.runtime.retryLatest({
      sessionId,
      identityContext: identity,
      expectedLatestRequestId: brand<string, 'MessageId'>(item.taskId),
      action: 'RETRY_LATEST',
      idempotencyKey: brand<string, 'IdempotencyKey'>(generateIdempotencyKey()),
    });
    return retryControlResponse(accepted.sessionId, accepted.requestId, projectRunStatusToTaskStatus('ACCEPTED'), accepted.attempt);
  } catch (error) {
    return batchItemError(error);
  }
}

async function processPendingInputAnswerItem(
  dependencies: TaskChannelDependencies,
  identity: IdentityContext,
  item: PendingInputAnswerItem,
): Promise<TaskBatchItemResult> {
  try {
    const answers = parsePendingInputAnswers(item.answers);
    const sessionId = brand<string, 'SessionId'>(item.sessionId);
    await dependencies.sessions.requireSession({ identityContext: identity, sessionId });
    const activeRun = await dependencies.sessions.getActiveRun({ identityContext: identity, sessionId });
    if (activeRun === undefined || activeRun.requestId !== brand<string, 'MessageId'>(item.taskId)) {
      throw new AgentError({
        code: 'TASK_NOT_FOUND',
        message: 'Task was not found. Verify sessionId and taskId are correct.',
        category: 'NOT_FOUND',
        retryable: false,
      });
    }
    await dependencies.runtime.answerPendingInput({
      identityContext: identity,
      idempotencyKey: brand<string, 'IdempotencyKey'>(generateIdempotencyKey()),
      answer: {
        sessionId,
        pendingInputId: brand<string, 'PendingInputId'>(item.pendingInputId),
        answers,
      },
    });
    return taskControlResponse(item.sessionId, item.taskId, projectRunStatusToTaskStatus('EXECUTING'));
  } catch (error) {
    return batchItemError(error);
  }
}

interface TaskQueryItem {
  readonly taskId: string;
  readonly sessionId: string;
}

type TaskQueryItemResult = TaskQueryResult | { readonly error: { readonly code: string; readonly message: string } };

interface TaskQueryResult {
  readonly sessionId: string;
  readonly taskId: string;
  readonly taskStatus: TaskStatus;
  readonly data?: JsonObject;
}

async function processTaskQueryItem(
  dependencies: TaskChannelDependencies,
  identity: IdentityContext,
  item: TaskQueryItem,
): Promise<TaskQueryItemResult> {
  try {
    const sessionId = brand<string, 'SessionId'>(item.sessionId);
    const requestId = brand<string, 'MessageId'>(item.taskId);
    const summary = await dependencies.sessions.getRequestSummary({
      identityContext: identity,
      sessionId,
      requestId,
    });
    if (summary === undefined) {
      throw new AgentError({
        code: 'TASK_NOT_FOUND',
        message: 'Task was not found. Verify sessionId and taskId are correct.',
        category: 'NOT_FOUND',
        retryable: false,
      });
    }
    const hasActivePendingInput = summary.activePendingInput !== undefined;
    const taskStatus = projectRunStatusToTaskStatus(summary.status, hasActivePendingInput);
    const result: TaskQueryResult = {
      sessionId: String(summary.sessionId),
      taskId: String(summary.requestId),
      taskStatus,
    };
    if (summary.activePendingInput !== undefined) {
      const pending = summary.activePendingInput;
      return {
        ...result,
        data: {
          pendingInputId: String(pending.id),
          kind: pending.kind,
          questions: pending.questions as unknown as JsonObject[],
          ...(pending.timeoutAt === undefined ? {} : { overtime: Number(pending.timeoutAt) }),
        },
      };
    }
    if (summary.terminalResult !== undefined) {
      const terminal = summary.terminalResult;
      const data: JsonObject =
        terminal.safeError === undefined
          ? { content: terminal.content, contentType: terminal.contentType }
          : { content: terminal.content, contentType: terminal.contentType, ...terminal.safeError };
      return { ...result, data };
    }
    return result;
  } catch (error) {
    return batchItemError(error);
  }
}

interface StreamCreateTaskItem {
  readonly taskMessages: unknown;
  readonly idempotencyKey?: string;
  readonly locale?: string;
  readonly reportEvents?: ReportEvents;
}

interface AsyncCreateTaskItem {
  readonly taskMessages: unknown;
  readonly callbackTarget: TaskCallbackTarget;
  readonly locale?: string;
  readonly reportEvents?: ReportEvents;
}

interface AsyncEditTaskItem {
  readonly taskId: string;
  readonly sessionId: string;
  readonly taskMessages: unknown;
  readonly idempotencyKey: string;
  readonly locale?: string;
}

interface AsyncRetryTaskItem {
  readonly taskId: string;
  readonly sessionId: string;
}

interface TaskControlItem {
  readonly taskId: string;
  readonly sessionId: string;
}

interface PendingInputAnswerItem {
  readonly taskId: string;
  readonly pendingInputId: string;
  readonly sessionId: string;
  readonly answers: ReadonlyArray<readonly string[]>;
}
function parseStreamCreateTaskItem(item: StreamCreateTaskItem): ParsedCreateTask {
  const projected = projectTaskMessageInput(parseSingleTaskMessage(item.taskMessages));
  return {
    inputText: projected.inputText,
    ...(projected.taskEventId === undefined ? {} : { taskEventId: projected.taskEventId }),
    ...(projected.inputVariables === undefined ? {} : { inputVariables: projected.inputVariables }),
    ...(projected.remoteFile === undefined ? {} : { remoteFile: projected.remoteFile }),
    ...(item.idempotencyKey === undefined ? {} : { idempotencyKey: item.idempotencyKey }),
    ...(item.locale === undefined ? {} : { locale: item.locale }),
    files: projected.inlineFile === undefined ? [] : [projected.inlineFile],
  };
}

function parseStreamEditTaskItem(item: { sessionId: string; taskMessages: unknown; idempotencyKey: string; locale?: string }): ParsedEditTask {
  const projected = projectTaskMessageInput(parseSingleTaskMessage(item.taskMessages));
  return {
    sessionId: item.sessionId,
    inputText: projected.inputText,
    ...(projected.inputVariables === undefined ? {} : { inputVariables: projected.inputVariables }),
    ...(projected.remoteFile === undefined ? {} : { remoteFile: projected.remoteFile }),
    idempotencyKey: item.idempotencyKey,
    ...(item.locale === undefined ? {} : { locale: item.locale }),
    files: projected.inlineFile === undefined ? [] : [projected.inlineFile],
  };
}

function parseAsyncCreateTaskItem(item: AsyncCreateTaskItem): ParsedAsyncCreateTask {
  const projected = projectTaskMessageInput(parseSingleTaskMessage(item.taskMessages));
  return {
    inputText: projected.inputText,
    ...(projected.taskEventId === undefined ? {} : { taskEventId: projected.taskEventId }),
    ...(projected.inputVariables === undefined ? {} : { inputVariables: projected.inputVariables }),
    ...(projected.remoteFile === undefined ? {} : { remoteFile: projected.remoteFile }),
    ...(item.locale === undefined ? {} : { locale: item.locale }),
    ...(item.reportEvents === undefined ? {} : { reportEvents: item.reportEvents }),
    files: projected.inlineFile === undefined ? [] : [projected.inlineFile],
    callbackTarget: item.callbackTarget,
  };
}
function rejectUnavailableRemoteFile(remoteFile: ParsedCreateTask['remoteFile']): void {
  if (remoteFile !== undefined) {
    throw new AgentError({
      code: 'ATTACHMENT_REMOTE_URL_UNAVAILABLE',
      message: 'Remote file URL intake is not available.',
      category: 'UNAVAILABLE',
      retryable: false,
    });
  }
}

function isFastifyValidationError(error: unknown): boolean {
  return error !== null && typeof error === 'object' && Array.isArray((error as { readonly validation?: unknown }).validation);
}

function resolveIdentityOrThrow(identityResolver: IdentityResolver, request: FastifyRequest, reply: FastifyReply): IdentityContext | undefined {
  try {
    const identity = identityResolver(request);
    if (identity === undefined || identity === null) {
      reply.status(401).send({ error: { code: 'IDENTITY_REQUIRED', message: 'Identity headers are required.', retryable: false } });
      return undefined;
    }
    return identity;
  } catch {
    reply.status(401).send({ error: { code: 'IDENTITY_RESOLUTION_FAILED', message: 'Identity resolution failed.', retryable: false } });
    return undefined;
  }
}

function parsePendingInputAnswers(answers: unknown): ReadonlyArray<readonly string[]> {
  if (!Array.isArray(answers) || answers.length === 0) {
    throw new AgentError({
      code: 'REQUEST_VALIDATION_FAILED',
      message: 'Pending input answers must be a non-empty ordered array.',
      category: 'VALIDATION',
      retryable: false,
    });
  }
  for (const entry of answers) {
    if (!Array.isArray(entry) || entry.length === 0 || entry.some((value) => typeof value !== 'string' || value.length === 0)) {
      throw new AgentError({
        code: 'REQUEST_VALIDATION_FAILED',
        message: 'Pending input answers must be ordered non-empty string arrays.',
        category: 'VALIDATION',
        retryable: false,
      });
    }
  }
  return answers;
}

interface ParsedCreateTask {
  readonly inputText: string;
  readonly taskEventId?: TaskEventId;
  readonly inputVariables?: JsonObject;
  readonly remoteFile?: { readonly url: string; readonly fileName: string; readonly declaredMimeType: string };
  readonly idempotencyKey?: string;
  readonly locale?: string;
  readonly files: readonly MultipartFile[];
}

interface ParsedAsyncCreateTask {
  readonly inputText: string;
  readonly taskEventId?: TaskEventId;
  readonly inputVariables?: JsonObject;
  readonly remoteFile?: { readonly url: string; readonly fileName: string; readonly declaredMimeType: string };
  readonly locale?: string;
  readonly reportEvents?: ReportEvents;
  readonly files: readonly MultipartFile[];
  readonly callbackTarget: TaskCallbackTarget;
}

interface ParsedEditTask {
  readonly sessionId: string;
  readonly inputText: string;
  readonly inputVariables?: JsonObject;
  readonly remoteFile?: { readonly url: string; readonly fileName: string; readonly declaredMimeType: string };
  readonly idempotencyKey: string;
  readonly locale?: string;
  readonly files: readonly MultipartFile[];
}

function isMultipartRequest(request: FastifyRequest): boolean {
  const contentType = request.headers['content-type'];
  return typeof contentType === 'string' && contentType.toLowerCase().startsWith('multipart/form-data');
}

interface MultipartFile {
  readonly fileName: string;
  readonly declaredMimeType: string;
  readonly sizeBytes: number;
  readonly bytes: Uint8Array;
}

const allowedMultipartFields = new Set(['taskMessages', 'locale', 'idempotencyKey', 'reportEvents']);

function parseMultipartStreamCreateTask(request: FastifyRequest): ParsedCreateTask {
  const parsed = parseMultipart(request);
  const fields = parsed.fields;
  rejectUnknownMultipartFields(fields, 'taskMessages');
  validateMultipartScalarFields(fields);
  const message = parseSingleTaskMessage(parseJsonValue(fields.taskMessages, 'taskMessages'));
  const projected = projectTaskMessageInput(message);
  if (projected.inlineFile !== undefined || projected.remoteFile !== undefined) {
    throw new AgentError({
      code: 'REQUEST_VALIDATION_FAILED',
      message: 'Multipart taskMessages must use text or data when file parts are present.',
      category: 'VALIDATION',
      retryable: false,
    });
  }
  return {
    inputText: projected.inputText,
    ...(projected.inputVariables === undefined ? {} : { inputVariables: projected.inputVariables }),
    ...(fields.idempotencyKey === undefined ? {} : { idempotencyKey: fields.idempotencyKey }),
    ...(fields.locale === undefined ? {} : { locale: fields.locale }),
    files: parsed.files,
  };
}

function parseMultipartStreamEditTask(request: FastifyRequest): ParsedEditTask {
  const parsed = parseMultipart(request);
  const fields = parsed.fields;
  rejectUnknownMultipartFields(fields, 'taskMessages');
  validateMultipartScalarFieldsWithSession(fields);
  const message = parseSingleTaskMessage(parseJsonValue(fields.taskMessages, 'taskMessages'));
  const projected = projectTaskMessageInput(message);
  if (projected.inlineFile !== undefined || projected.remoteFile !== undefined) {
    throw new AgentError({
      code: 'REQUEST_VALIDATION_FAILED',
      message: 'Multipart taskMessages must use text or data when file parts are present.',
      category: 'VALIDATION',
      retryable: false,
    });
  }
  return {
    sessionId: fields.sessionId!,
    inputText: projected.inputText,
    ...(projected.inputVariables === undefined ? {} : { inputVariables: projected.inputVariables }),
    idempotencyKey: fields.idempotencyKey!,
    ...(fields.locale === undefined ? {} : { locale: fields.locale }),
    files: parsed.files,
  };
}

function parseMultipart(request: FastifyRequest): { readonly fields: Record<string, string>; readonly files: readonly MultipartFile[] } {
  if (!(request.body instanceof Buffer)) {
    throw new AgentError({ code: 'REQUEST_VALIDATION_FAILED', message: 'Multipart body is missing.', category: 'VALIDATION', retryable: false });
  }
  const boundary = multipartBoundary(request);
  const parts = multipartParts(request.body, boundary);
  const fields: Record<string, string> = {};
  const files: MultipartFile[] = [];
  for (const part of parts) {
    const rawHeaders = part.headers.toString('latin1');
    const rawContent = part.content;
    const disposition = rawHeaders.split('\r\n').find((line) => line.toLowerCase().startsWith('content-disposition:'));
    const name = dispositionParameter(disposition, 'name');
    if (name === undefined) {
      throw new AgentError({
        code: 'REQUEST_VALIDATION_FAILED',
        message: 'Multipart field name is missing.',
        category: 'VALIDATION',
        retryable: false,
      });
    }
    const fileName = dispositionParameter(disposition, 'filename');
    if (fileName === undefined) {
      fields[name] = rawContent.toString('utf8');
      continue;
    }
    const declaredMimeType =
      rawHeaders
        .split('\r\n')
        .find((line) => line.toLowerCase().startsWith('content-type:'))
        ?.slice('content-type:'.length)
        .trim() ?? '';
    const bytes = Buffer.from(rawContent);
    files.push({ fileName, declaredMimeType, sizeBytes: bytes.byteLength, bytes: new Uint8Array(bytes) });
  }
  return { fields, files };
}

function rejectUnknownMultipartFields(fields: Record<string, string>, requiredTextField: string): void {
  for (const key of Object.keys(fields)) {
    if (!allowedMultipartFields.has(key)) {
      throw new AgentError({
        code: 'REQUEST_VALIDATION_FAILED',
        message: `Multipart request contains unsupported field: ${key}.`,
        category: 'VALIDATION',
        retryable: false,
      });
    }
  }
  if (typeof fields[requiredTextField] !== 'string') {
    throw new AgentError({
      code: 'REQUEST_VALIDATION_FAILED',
      message: `Multipart request requires ${requiredTextField}.`,
      category: 'VALIDATION',
      retryable: false,
    });
  }
}

function validateMultipartScalarFields(fields: Record<string, string>): void {
  validateMultipartString(fields.locale, 'locale', false, TASK_LOCALE_MAX_LENGTH, 2);
  if (fields.locale !== undefined && !TASK_LOCALE_PATTERN_REGEX.test(fields.locale)) {
    throw new AgentError({ code: 'REQUEST_VALIDATION_FAILED', message: 'Multipart locale is invalid.', category: 'VALIDATION', retryable: false });
  }
}

function validateMultipartString(value: string | undefined, fieldName: string, required: boolean, maxLength: number, minLength = 1): void {
  if ((required && value === undefined) || (value !== undefined && (value.length < minLength || value.length > maxLength))) {
    throw new AgentError({
      code: 'REQUEST_VALIDATION_FAILED',
      message: `Multipart ${fieldName} is invalid.`,
      category: 'VALIDATION',
      retryable: false,
    });
  }
}

function parseJsonValue(value: string | undefined, fieldName: string): unknown {
  if (value === undefined) {
    throw new AgentError({ code: 'REQUEST_VALIDATION_FAILED', message: `${fieldName} is required.`, category: 'VALIDATION', retryable: false });
  }
  try {
    return JSON.parse(value);
  } catch {
    throw new AgentError({
      code: 'REQUEST_VALIDATION_FAILED',
      message: `${fieldName} must be valid JSON.`,
      category: 'VALIDATION',
      retryable: false,
    });
  }
}

function multipartBoundary(request: FastifyRequest): string {
  const contentType = request.headers['content-type'];
  const boundary =
    typeof contentType === 'string'
      ? contentType
          .split(';')
          .map((part) => part.trim())
          .find((part) => part.startsWith('boundary='))
          ?.slice('boundary='.length)
      : undefined;
  if (boundary === undefined || boundary.length === 0) {
    throw new AgentError({ code: 'REQUEST_VALIDATION_FAILED', message: 'Multipart boundary is missing.', category: 'VALIDATION', retryable: false });
  }
  return boundary.startsWith('"') && boundary.endsWith('"') ? boundary.slice(1, -1) : boundary;
}

function dispositionParameter(disposition: string | undefined, name: string): string | undefined {
  if (disposition === undefined) {
    return undefined;
  }
  if (!/^[A-Za-z][A-Za-z0-9_-]*$/u.test(name)) {
    throw new AgentError({
      code: 'REQUEST_VALIDATION_FAILED',
      message: 'Multipart disposition parameter is invalid.',
      category: 'VALIDATION',
      retryable: false,
    });
  }
  const match = new RegExp(`${name}="([^"]*)"`, 'u').exec(disposition);
  return match?.[1];
}

function multipartParts(body: Buffer, boundary: string): Array<{ readonly headers: Buffer; readonly content: Buffer }> {
  const delimiter = Buffer.from(`--${boundary}`, 'utf8');
  const lineDelimiter = Buffer.from(`\r\n--${boundary}`, 'utf8');
  const headerSeparator = Buffer.from('\r\n\r\n', 'utf8');
  const parts: Array<{ readonly headers: Buffer; readonly content: Buffer }> = [];
  let boundaryStart = body.indexOf(delimiter);
  if (boundaryStart < 0) {
    throw new AgentError({ code: 'REQUEST_VALIDATION_FAILED', message: 'Multipart boundary is invalid.', category: 'VALIDATION', retryable: false });
  }
  while (boundaryStart >= 0) {
    let cursor = boundaryStart + delimiter.byteLength;
    if (body.subarray(cursor, cursor + 2).equals(Buffer.from('--'))) {
      break;
    }
    if (!body.subarray(cursor, cursor + 2).equals(Buffer.from('\r\n'))) {
      throw new AgentError({ code: 'REQUEST_VALIDATION_FAILED', message: 'Multipart part is invalid.', category: 'VALIDATION', retryable: false });
    }
    cursor += 2;
    const headerEnd = body.indexOf(headerSeparator, cursor);
    if (headerEnd < 0) {
      throw new AgentError({ code: 'REQUEST_VALIDATION_FAILED', message: 'Multipart part is invalid.', category: 'VALIDATION', retryable: false });
    }
    const contentStart = headerEnd + headerSeparator.byteLength;
    const nextBoundary = body.indexOf(lineDelimiter, contentStart);
    if (nextBoundary < 0) {
      throw new AgentError({
        code: 'REQUEST_VALIDATION_FAILED',
        message: 'Multipart boundary is invalid.',
        category: 'VALIDATION',
        retryable: false,
      });
    }
    parts.push({
      headers: body.subarray(cursor, headerEnd),
      content: body.subarray(contentStart, nextBoundary),
    });
    boundaryStart = nextBoundary + 2;
  }
  return parts;
}

interface TaskAttachmentResolution {
  readonly attachmentIds: readonly AttachmentId[];
  readonly reservedRequest?: {
    readonly reservationId: AttachmentIntakeReservationId;
    readonly requestId: MessageId;
    readonly runId: RequestRunId;
    readonly requestContextId: RequestContextId;
  };
}

async function resolveTaskAttachments(
  dependencies: TaskChannelDependencies,
  identity: IdentityContext,
  agentId: AgentId,
  sessionId: SessionId,
  files: readonly MultipartFile[],
  idempotencyKey: string,
  action: 'SUBMIT_REQUEST' | 'EDIT_LATEST_REQUEST',
  inputText: string,
  locale?: string,
): Promise<TaskAttachmentResolution> {
  if (files.length === 0) {
    return { attachmentIds: [] };
  }
  const reserveSubmit = dependencies.runtime.reserveSubmit;
  if (reserveSubmit === undefined) {
    throw new AgentError({
      code: 'ATTACHMENT_DEPENDENCY_UNAVAILABLE',
      message: 'Attachment intake dependencies are unavailable.',
      category: 'UNAVAILABLE',
      retryable: true,
    });
  }
  const reserved = await reserveSubmit({
    sessionId,
    identityContext: identity,
    action,
    inputText,
    ...(locale === undefined ? {} : { locale: brand<string, 'RequestLocale'>(locale) }),
    idempotencyKey: brand<string, 'IdempotencyKey'>(idempotencyKey),
    attachmentIntakePresent: files.length > 0,
  });
  const reservedRequest = {
    reservationId: reserved.reservationId,
    requestId: reserved.requestId,
    runId: reserved.runId,
    requestContextId: reserved.requestContextId,
  };
  if (reserved.intakeOutcome?.status === 'INTAKE_REJECTED') {
    throw new AgentError({
      code: reserved.intakeOutcome.safeError?.code ?? reserved.intakeOutcome.rejectionReasonCode ?? 'ATTACHMENT_REJECTED',
      message: reserved.intakeOutcome.safeError?.message ?? 'Attachment intake rejected the request.',
      category: reserved.intakeOutcome.safeError?.category ?? 'VALIDATION',
      retryable: reserved.intakeOutcome.safeError?.retryable ?? false,
    });
  }
  if (reserved.intakeOutcome?.status === 'INTAKE_ACCEPTED') {
    return { attachmentIds: reserved.intakeOutcome.attachmentIds, reservedRequest };
  }
  const intake = await dependencies.attachmentRuntime.intake({
    identityContext: identity,
    agentId,
    reservationId: reserved.reservationId,
    sessionId,
    requestId: reserved.requestId,
    runId: reserved.runId,
    requestContextId: reserved.requestContextId,
    action,
    files,
    idempotencyKey: brand<string, 'IdempotencyKey'>(idempotencyKey),
  });
  if (intake.status === 'REJECTED') {
    throw new AgentError({
      code: intake.safeError?.code ?? intake.rejected[0]?.reasonCode ?? 'ATTACHMENT_REJECTED',
      message: intake.safeError?.message ?? 'Attachment intake rejected the request.',
      category: intake.safeError?.category ?? 'VALIDATION',
      retryable: intake.safeError?.retryable ?? false,
    });
  }
  return { attachmentIds: intake.attachmentIds, reservedRequest };
}
