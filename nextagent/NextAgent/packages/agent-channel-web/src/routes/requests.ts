import {
  AgentError,
  brand,
  getLogger,
  runtimeRawExceptionData,
  type AgentId,
  type AttachmentIntakeReservationId,
  type EpochMillis,
  type IdentityContext,
  type IdempotencyKey,
  type JsonObject,
  type RequestContextId,
  type RunStatus,
  type SessionId,
  type TimelineSequence,
} from '@nextagent/agent-common';
import fastifyMultipart from '@fastify/multipart';
import { createReadStream } from 'node:fs';
import type { MessageId, RequestRunId, SafeError } from '@nextagent/agent-common';
import { guardrailServiceUnavailableMessage } from '@nextagent/agent-common';
import type {
  ConversationAnnotationView,
  ConversationFavoriteTurnPage,
  RuntimeActiveRunSummary,
  RuntimeCommandPort,
  CapabilityPresentationResourceQueryPort,
  RuntimeConversationAnnotationPort,
  RuntimeSessionActivityPort,
  RuntimeSessionPort,
  RunTimelineEvent,
} from '@nextagent/agent-contracts/runtime';
import type {
  BackgroundTaskView,
  BackgroundTaskViewPort,
  CronTaskExecutionView,
  CronTaskManagementPort,
  CronTaskManagementView,
  CronTaskTargetView,
  LongTermMemoryManagementPort,
  StreamEnvelope,
} from '@nextagent/agent-contracts/channel';
import type { ExecutionCorrelationPort, W3CTraceCarrier } from '@nextagent/agent-contracts/observability';
import type { RuntimeConversationSharePort, SharedConversationPage } from '@nextagent/agent-contracts/runtime';
import type { SkillCatalogQueryPort } from '@nextagent/agent-contracts/runtime';
import type { SuggestedQuestionPort } from '@nextagent/agent-contracts/runtime';
import type { CategoryQuestionPort } from '@nextagent/agent-contracts/runtime';
import type { FrequentQuestionPort } from '@nextagent/agent-contracts/runtime';
import type { TSchema } from '@sinclair/typebox';
import { type ValueError, ValueErrorType } from '@sinclair/typebox/value';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { Value } from '@sinclair/typebox/value';
import {
  cleanupOrphanSession,
  resolveAgentIdFromHeader,
  extractHeaderAgentId,
  isFastifyBodyParseError,
  bodyParseErrorMessage,
  type CapabilityResultPresentationPolicy,
} from '@nextagent/agent-channel-common';

import type { IdentityResolver } from '../auth/identity-context.js';
import {
  projectAskUserQuestionAnswerResult,
  projectRunStatus,
  projectTimelineEventToStreamEnvelope,
  requiresProcessMessageAssociation,
  resolveLegacyProcessMessageAssociation,
  sendSseStream,
} from '../projections/stream-envelope.js';
import { favoritesListQuery, upsertAnnotationBody } from '../schemas/annotation-dto.js';
import { capabilityPresentationResourcesQuery, capabilityPresentationResourcesResponse } from '../schemas/capability-presentation-resource-dto.js';
import {
  annotationListResponse,
  annotationResponse,
  backgroundTaskKillResponse,
  backgroundTaskListResponse,
  backgroundTaskOutputQuery,
  backgroundTaskOutputResponse,
  backgroundTaskParams,
  cancelResponse,
  conversationPreviewResponse,
  conversationResponse,
  favoritePageResponse,
  noContentResponse,
  pendingInputAnswerResponse,
  pendingInputParams,
  requestAcceptedResponse,
  runAnnotationParams,
  safeErrorResponse,
  sessionListResponse,
  sessionEventHistoryQuery,
  sessionEventHistoryResponse,
  sessionMessageParams,
  sessionParams,
  sessionRequestParams,
  sessionRunParams,
  sessionSummaryResponse,
  shareCreateResponse,
  sharedConversationResponse,
  shareParams,
  suggestedQuestionsResponse,
  deleteTempFileQuery,
  tempFileParams,
} from '../schemas/api-contract.js';
import { uploadFileResponse } from '../schemas/api-contract.js';
import { createShareBody } from '../schemas/share-dto.js';
import { conversationPreviewQuery, conversationQuery } from '../schemas/conversation-query.js';
import {
  WEB_CONVERSATION_CURSOR_MAX_LENGTH,
  WEB_FAVORITES_OFFSET_MAX_LENGTH,
  WEB_CONVERSATION_PREVIEW_OFFSET_MAX_LENGTH,
  WEB_SESSION_SEARCH_MAX_CODE_POINTS,
} from '../schemas/validation-limits.js';
import {
  cronTaskManagementCreateBody,
  cronTaskExecutionQuery,
  cronTaskExecutionResponse,
  cronTaskExecutionListResponse,
  cronTaskManagementListQuery,
  cronTaskManagementListResponse,
  cronTaskManagementParams,
  cronTaskManagementQuery,
  cronTaskManagementResponse,
  cronTaskManagementUpdateBody,
} from '../schemas/cron-task-management.js';
import { healthResponse } from '../schemas/health-dto.js';
import {
  cancelBody,
  convenienceSubmitBody,
  editLatestBody,
  forkFromMessageBody,
  pendingInputAnswerBody,
  retryBody,
  submitBody,
} from '../schemas/request-dto.js';
import { skillCatalogQuery, skillCatalogResponse } from '../schemas/skill-catalog-query.js';
import { registerMemoryRoutes } from './memory.js';
import { categoryQuestionQuery, categoryQuestionResponse } from '../schemas/category-question-query.js';
import { frequentQuestionQuery, frequentQuestionResponse } from '../schemas/frequent-question-query.js';
import { questionAssociationQuery, questionAssociationResponse } from '../schemas/question-association-query.js';
import {
  isWebTransportKind,
  runtimeBootstrapResponse,
  type WebRuntimeBootstrapConfig,
  type ChatUploadConfigProviderPort,
  type PortalAbilityBootstrapConfig,
  type PortalAbilityConfigProviderPort,
} from '../schemas/runtime-bootstrap.js';
import {
  emptySessionActivityStreamQuery,
  sessionActivityConsumeBody,
  sessionActivityMessageSchema,
  type SessionActivityWireMessage,
} from '../schemas/session-activity-dto.js';
import { createSessionBody, sessionListQuery, updateTitleBody } from '../schemas/session-dto.js';
import { streamQuery } from '../schemas/stream-query.js';
import {
  deliverWebStream,
  parseLastSeenSequence,
  type WebStreamDiagnostic,
  type WebGuardrailPort,
  type WebWatermarkPort,
} from '../transports/web-stream-delivery.js';
import { registerWebSocketStream } from '../transports/websocket.js';

export interface WebChannelDependencies {
  readonly capabilityResultPresentationPolicy?: CapabilityResultPresentationPolicy;
  readonly runtime: RuntimeCommandPort;
  readonly stagedUploadRuntime?: StagedUploadPort;
  readonly fileDownloadRuntime?: FileDownloadPort;
  readonly chatUploadFileConfig?: ChatUploadFileConfig;
  readonly chatUploadConfigProvider?: ChatUploadConfigProviderPort;
  readonly portalAbilityConfigProvider?: PortalAbilityConfigProviderPort;
  readonly attachmentSummaryResolver?: AttachmentSummaryResolver;
  readonly sessions: RuntimeSessionPort;
  readonly sessionActivities?: RuntimeSessionActivityPort;
  readonly identityResolver: IdentityResolver;
  readonly idempotencyKeyFactory?: () => IdempotencyKey;
  readonly runtimeBootstrap: WebRuntimeBootstrapConfig;
  readonly health?: WebHealthEvaluator;
  readonly skillCatalog?: SkillCatalogQueryPort;
  readonly capabilityPresentationResources?: CapabilityPresentationResourceQueryPort;
  readonly longTermMemoryManagement?: LongTermMemoryManagementPort;
  readonly suggestedQuestions?: SuggestedQuestionPort;
  readonly categoryQuestions?: CategoryQuestionPort;
  readonly frequentQuestions?: FrequentQuestionPort;
  readonly annotations?: RuntimeConversationAnnotationPort;
  readonly shares?: RuntimeConversationSharePort;
  readonly backgroundTasks?: BackgroundTaskViewPort;
  readonly cronTaskManagement?: CronTaskManagementPort;
  readonly defaultAgentId: AgentId;
  readonly guardrail?: WebGuardrailPort;
  readonly guardrailEnabled?: boolean;
  readonly watermark?: WebWatermarkPort;
  readonly getWatermarkEnabled?: () => boolean;
  readonly guardLocale?: string;
  // Public path prefix P prepended in front of the fixed API segment `/api/v1`.
  // `/` (default) means no prefix → routes mount at /api/v1/...; /svcA mounts
  // at /svcA/api/v1/... The `/api/v1` segment is always preserved.
  readonly routePrefix?: string;
  // Optional namespace inserted between `/api/v1` and the route path, e.g.
  // `ir` mounts the IR channel at /api/v1/ir/... (or /svcA/api/v1/ir/...).
  readonly apiSubNamespace?: string;
  readonly routeWhitelist?: ReadonlySet<string>;
  readonly executionCorrelation?: ExecutionCorrelationPort;
}

export const IR_ROUTE_WHITELIST: ReadonlySet<string> = new Set([
  'sessions',
  'sessions/:sessionId/requests',
  'sessions/:sessionId/stream',
  'sessions/:sessionId/cancel',
  'sessions/:sessionId/retry',
  'sessions/:sessionId/pending-inputs/:pendingInputId/answer',
]);

const logger = getLogger({ component: 'agent-channel-web', source: 'request-routes' });

export interface WebHealthResponse {
  readonly status: 'UP' | 'DOWN' | 'DEGRADED';
  readonly components: ReadonlyArray<{
    readonly name: string;
    readonly status: 'UP' | 'DOWN' | 'DEGRADED';
    readonly summary?: string;
    readonly reasonCode?: string;
    readonly latencyMs?: number;
  }>;
  readonly timestamp: number;
}

export interface WebHealthEvaluator {
  primary: (signal?: AbortSignal) => Promise<WebHealthResponse>;
  deep: (signal?: AbortSignal) => Promise<WebHealthResponse>;
}

function writeStreamDiagnostic(fields: Record<string, unknown>, diagnostic: WebStreamDiagnostic): void {
  if (diagnostic.kind === 'STREAM_OPEN') {
    logger.debug({ event: 'stream.opened', ...fields });
    return;
  }
  if (diagnostic.kind === 'STREAM_CLOSE') {
    logger.debug({ event: 'stream.closed', ...fields });
    return;
  }
  logger.error({ event: 'stream.delivery.failed', ...fields, failureStage: 'STREAM_DELIVERY', safeReasonCode: diagnostic.code });
}

export async function registerWebChannel(instance: FastifyInstance, dependencies: WebChannelDependencies): Promise<void> {
  // Public path prefix P (default `/` = no prefix). The API segment `/api/v1`
  // is fixed; P is only prepended in front of it so routes mount at
  // /api/v1/... (P=/) or /svcA/api/v1/... (P=/svcA). An optional namespace
  // (e.g. `ir`) is inserted right after /api/v1 for sub-channels.
  const routePrefix = dependencies.routePrefix ?? '/';
  const routeWhitelist = dependencies.routeWhitelist;
  const apiSubNamespace = dependencies.apiSubNamespace;
  const API_SEGMENT = '/api/v1';
  const namespaceSegment = apiSubNamespace && apiSubNamespace.length > 0 ? `/${apiSubNamespace}` : '';
  function shouldRegister(routePath: string): boolean {
    return routeWhitelist === undefined || routeWhitelist.has(routePath);
  }
  function route(path: string): string {
    const prefix = routePrefix === '/' ? '' : routePrefix;
    return `${prefix}${API_SEGMENT}${namespaceSegment}/${path}`;
  }
  if (shouldRegister('sessions/:sessionId/files/upload')) {
    instance.register(fastifyMultipart);
  }

  if (dependencies.longTermMemoryManagement !== undefined) {
    registerMemoryRoutes(instance, {
      management: dependencies.longTermMemoryManagement,
      identityResolver: dependencies.identityResolver,
      defaultAgentId: dependencies.defaultAgentId,
      ...(dependencies.routePrefix === undefined ? {} : { routePrefix: dependencies.routePrefix }),
    });
  }

  instance.setErrorHandler(async (error, request, reply) => {
    if (isLocalAuthRequiredError(error)) {
      await reply.status(401).send({
        error: {
          code: 'LOCAL_AUTH_REQUIRED',
          message: 'Authentication required.',
        },
      });
      return;
    }
    // Fastify body-parse errors (empty/malformed body, wrong media type, NUL byte)
    // carry their own statusCode (400 / 415) but no `validation` array, so they
    // must be detected by code — otherwise they fall through to INTERNAL/500.
    const isBodyParseError = isFastifyBodyParseError(error);
    const isExpected = error instanceof AgentError ? error.category !== 'INTERNAL' : isFastifyValidationError(error) || isBodyParseError;
    const status = error instanceof AgentError ? statusFor(error) : isBodyParseError ? error.statusCode : isExpected ? 400 : 500;
    if (!isExpected) {
      logger.error({
        err: error,
        event: 'server.framework.failed',
        failureStage: 'FASTIFY_INTERNAL',
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
              : isFastifyValidationError(error)
                ? formatFastifyValidationError(error as FastifyValidationError)
                : isExpected
                  ? 'Request validation failed.'
                  : 'Request failed safely.',
      },
    });
  });

  const commonErrorResponses = {
    400: safeErrorResponse,
    401: safeErrorResponse,
    403: safeErrorResponse,
    404: safeErrorResponse,
    409: safeErrorResponse,
    410: safeErrorResponse,
    503: safeErrorResponse,
  };

  if (shouldRegister('sessions/:sessionId/capability-presentation-resources')) {
    instance.get(
      route('sessions/:sessionId/capability-presentation-resources'),
      {
        preValidation: assertCapabilityPresentationResourcesQueryOnly,
        schema: {
          params: sessionParams,
          querystring: capabilityPresentationResourcesQuery,
          response: { 200: capabilityPresentationResourcesResponse, ...commonErrorResponses },
        },
      },
      async (request, reply) => {
        const identity = dependencies.identityResolver(request);
        const params = request.params as { sessionId: string };
        const sessionId = brand<string, 'SessionId'>(params.sessionId);
        const session = await dependencies.sessions.requireSession({ identityContext: identity, sessionId });
        if (dependencies.capabilityPresentationResources === undefined) {
          return reply.status(503).send({
            error: {
              code: 'CAPABILITY_PRESENTATION_RESOURCES_UNAVAILABLE',
              message: 'Capability presentation resources are temporarily unavailable.',
            },
          });
        }
        try {
          return await withAbortableRequest(request, reply, (signal) =>
            dependencies.capabilityPresentationResources!.listResources({ identityContext: identity, sessionId, agentId: session.agentId }, signal),
          );
        } catch (error) {
          const rawExceptionData = runtimeRawExceptionData(error);
          logger.warn({
            err: error,
            ...(rawExceptionData === undefined ? {} : { rawExceptionData }),
            event: 'capability.presentation_resources.unavailable',
            safeErrorCode: 'CAPABILITY_PRESENTATION_RESOURCES_UNAVAILABLE',
          });
          return reply.status(503).send({
            error: {
              code: 'CAPABILITY_PRESENTATION_RESOURCES_UNAVAILABLE',
              message: 'Capability presentation resources are temporarily unavailable.',
            },
          });
        }
      },
    );
  }

  if (shouldRegister('cron-tasks')) {
    instance.get(
      route('cron-tasks'),
      {
        preValidation: assertCronTaskPageQueryOnly,
        schema: { querystring: cronTaskManagementListQuery, response: { 200: cronTaskManagementListResponse, ...commonErrorResponses } },
      },
      async (request, reply) => {
        const management = requireCronTaskManagement(dependencies);
        const identity = dependencies.identityResolver(request);
        const pageQuery = parseCronTaskPageQuery(request.query as CronTaskPageRawQuery);
        return withAbortableRequest(request, reply, async (signal) => {
          const page = await management.listCronTasks(
            {
              identityContext: identity,
              agentId: resolveAgentIdFromHeader(request, dependencies.defaultAgentId),
              offset: pageQuery.offset,
              limit: pageQuery.limit,
            },
            signal,
          );
          return {
            tasks: page.tasks.map(projectCronTaskManagement),
            total: page.total,
          };
        });
      },
    );

    instance.post(
      route('cron-tasks'),
      {
        preValidation: assertCronTaskManagementCreateRequest,
        config: { opLog: { prefix: 'CronTaskController.createTask', level: 'MINOR' as const } },
        schema: {
          querystring: cronTaskManagementQuery,
          body: cronTaskManagementCreateBody,
          response: { 200: cronTaskManagementResponse, ...commonErrorResponses },
        },
      },
      async (request, reply) => {
        assertAllowedCronTaskManagementBody(request.body, ['cron', 'prompt', 'target', 'recurring']);
        const management = requireCronTaskManagement(dependencies);
        const identity = dependencies.identityResolver(request);
        (request as any).opLogIdentity = identity;
        const body = request.body as { cron: string; prompt: string; target?: CronTaskTargetView; recurring?: boolean };
        return withAbortableRequest(request, reply, async (signal) =>
          projectCronTaskManagement(
            await management.createCronTask(
              {
                identityContext: identity,
                agentId: resolveAgentIdFromHeader(request, dependencies.defaultAgentId),
                cron: body.cron,
                prompt: body.prompt,
                ...(body.target === undefined ? {} : { target: body.target }),
                ...(body.recurring === undefined ? {} : { recurring: body.recurring }),
              },
              signal,
            ),
          ),
        );
      },
    );
  }

  if (shouldRegister('cron-tasks/:taskId')) {
    instance.put(
      route('cron-tasks/:taskId'),
      {
        preValidation: assertCronTaskManagementUpdateRequest,
        config: { opLog: { prefix: 'CronTaskController.updateTask', level: 'MINOR' as const, detailParams: ['params.taskId'] } },
        schema: {
          params: cronTaskManagementParams,
          querystring: cronTaskManagementQuery,
          body: cronTaskManagementUpdateBody,
          response: { 200: cronTaskManagementResponse, ...commonErrorResponses },
        },
      },
      async (request, reply) => {
        assertAllowedCronTaskManagementBody(request.body, ['cron', 'prompt', 'target', 'recurring']);
        const management = requireCronTaskManagement(dependencies);
        const identity = dependencies.identityResolver(request);
        (request as any).opLogIdentity = identity;
        const params = request.params as { taskId: string };
        const body = request.body as { cron?: string; prompt?: string; target?: CronTaskTargetView | null; recurring?: boolean };
        return withAbortableRequest(request, reply, async (signal) =>
          projectCronTaskManagement(
            await management.updateCronTask(
              {
                identityContext: identity,
                agentId: resolveAgentIdFromHeader(request, dependencies.defaultAgentId),
                taskId: params.taskId,
                ...(body.cron === undefined ? {} : { cron: body.cron }),
                ...(body.prompt === undefined ? {} : { prompt: body.prompt }),
                ...(body.target === undefined ? {} : { target: body.target }),
                ...(body.recurring === undefined ? {} : { recurring: body.recurring }),
              },
              signal,
            ),
          ),
        );
      },
    );

    instance.delete(
      route('cron-tasks/:taskId'),
      {
        preValidation: assertCronTaskManagementQueryOnly,
        config: { opLog: { prefix: 'CronTaskController.deleteTask', level: 'RISK' as const, detailParams: ['params.taskId'] } },
        schema: {
          params: cronTaskManagementParams,
          querystring: cronTaskManagementQuery,
          response: { 204: noContentResponse, ...commonErrorResponses },
        },
      },
      async (request, reply) => {
        const management = requireCronTaskManagement(dependencies);
        const identity = dependencies.identityResolver(request);
        (request as any).opLogIdentity = identity;
        const params = request.params as { taskId: string };
        await withAbortableRequest(request, reply, async (signal) =>
          management.deleteCronTask(
            {
              identityContext: identity,
              agentId: resolveAgentIdFromHeader(request, dependencies.defaultAgentId),
              taskId: params.taskId,
            },
            signal,
          ),
        );
        return reply.status(204).send();
      },
    );
  }

  if (shouldRegister('cron-tasks/:taskId/runs')) {
    instance.get(
      route('cron-tasks/:taskId/runs'),
      {
        preValidation: assertCronTaskPageQueryOnly,
        schema: {
          params: cronTaskManagementParams,
          querystring: cronTaskExecutionQuery,
          response: { 200: cronTaskExecutionListResponse, ...commonErrorResponses },
        },
      },
      async (request, reply) => {
        const management = requireCronTaskManagement(dependencies);
        const identity = dependencies.identityResolver(request);
        const params = request.params as { taskId: string };
        const pageQuery = parseCronTaskExecutionQuery(request.query as CronTaskExecutionRawQuery);
        return withAbortableRequest(request, reply, async (signal) => {
          const page = await management.listCronTaskExecutions(
            {
              identityContext: identity,
              agentId: resolveAgentIdFromHeader(request, dependencies.defaultAgentId),
              taskId: params.taskId,
              offset: pageQuery.offset,
              limit: pageQuery.limit,
            },
            signal,
          );
          return {
            executions: page.executions.map(projectCronTaskExecution),
            total: page.total,
          };
        });
      },
    );

    instance.post(
      route('cron-tasks/:taskId/runs'),
      {
        preValidation: assertCronTaskExecutionRequest,
        config: { opLog: { prefix: 'CronTaskController.executeTask', level: 'MINOR' as const, detailParams: ['params.taskId'] } },
        schema: {
          params: cronTaskManagementParams,
          querystring: cronTaskManagementQuery,
          response: { 200: cronTaskExecutionResponse, ...commonErrorResponses },
        },
      },
      async (request, reply) => {
        const management = requireCronTaskManagement(dependencies);
        const identity = dependencies.identityResolver(request);
        (request as any).opLogIdentity = identity;
        const params = request.params as { taskId: string };
        return withAbortableRequest(request, reply, async (signal) =>
          projectCronTaskExecution(
            await management.executeCronTask(
              {
                identityContext: identity,
                agentId: resolveAgentIdFromHeader(request, dependencies.defaultAgentId),
                taskId: params.taskId,
              },
              signal,
            ),
          ),
        );
      },
    );
  }

  if (shouldRegister('sessions')) {
    instance.get(
      route('sessions'),
      { schema: { querystring: sessionListQuery, response: { 200: sessionListResponse, ...commonErrorResponses } } },
      async (request) => {
        const identity = dependencies.identityResolver(request);
        const query = parseSessionListQuery(request.query as SessionListRawQuery);
        return projectSessionPage(await dependencies.sessions.listSessions({ identityContext: identity, ...query }));
      },
    );
  }

  if (shouldRegister('sessions/:sessionId/title')) {
    instance.put(
      route('sessions/:sessionId/title'),
      {
        config: { opLog: { prefix: 'SessionController.updateTitle', level: 'MINOR' as const, detailParams: ['params.sessionId'] } },
        schema: { params: sessionParams, body: updateTitleBody, response: { 200: sessionSummaryResponse, ...commonErrorResponses } },
      },
      async (request) => {
        const identity = dependencies.identityResolver(request);
        (request as any).opLogIdentity = identity;
        const params = request.params as { sessionId: string };
        const body = request.body as { title: string };
        return projectSession(
          await dependencies.sessions.updateTitle({
            identityContext: identity,
            sessionId: brand<string, 'SessionId'>(params.sessionId),
            title: body.title,
            idempotencyKey: createIdempotencyKey(dependencies),
          }),
        );
      },
    );
  }

  if (shouldRegister('sessions/:sessionId')) {
    instance.delete(
      route('sessions/:sessionId'),
      {
        config: { opLog: { prefix: 'SessionController.deleteSession', level: 'RISK' as const, detailParams: ['params.sessionId'] } },
        schema: { params: sessionParams, response: { 204: noContentResponse, ...commonErrorResponses } },
      },
      async (request, reply) => {
        const identity = dependencies.identityResolver(request);
        (request as any).opLogIdentity = identity;
        const params = request.params as { sessionId: string };
        await dependencies.sessions.deleteSession({
          identityContext: identity,
          sessionId: brand<string, 'SessionId'>(params.sessionId),
        });
        return reply.status(204).send();
      },
    );
  }

  if (shouldRegister('sessions/:sessionId/runs/:runId/events')) {
    instance.get(
      route('sessions/:sessionId/runs/:runId/events'),
      {
        schema: {
          params: sessionRunParams,
          querystring: sessionEventHistoryQuery,
          response: { 200: sessionEventHistoryResponse, ...commonErrorResponses },
        },
      },
      async (request) => {
        const identity = dependencies.identityResolver(request);
        const params = request.params as { sessionId: string; runId: string };
        const query = request.query as { afterSequence?: number; limit?: number };
        const page = await dependencies.sessions.listEvents({
          identityContext: identity,
          sessionId: brand<string, 'SessionId'>(params.sessionId),
          runId: brand<string, 'RequestRunId'>(params.runId),
          afterSequence: brand<number, 'TimelineSequence'>(query.afterSequence ?? 0),
          limit: query.limit ?? 100,
        });
        if (page.availability === 'LEGACY_FORK_PROCESS_HISTORY_UNAVAILABLE') {
          return page;
        }
        const referencedMessageIds = [
          ...new Set(
            page.events.flatMap((event) => {
              if (!requiresProcessMessageAssociation(event)) {
                return [];
              }
              const messageId = referencedProcessMessageId(event);
              return typeof messageId === 'string' && messageId.trim().length > 0 ? [brand<string, 'MessageId'>(messageId.trim())] : [];
            }),
          ),
        ];
        const eventRequestIds = [...new Set(page.events.flatMap((event) => (event.requestId === undefined ? [] : [event.requestId])))];
        const hasLegacyProcessEvents = page.events.some(
          (event) => !isTerminalTimelineEvent(event) && event.inlinePayload.messageId === undefined && requiresProcessMessageAssociation(event),
        );
        const processMessages =
          (referencedMessageIds.length > 0 || hasLegacyProcessEvents) &&
          eventRequestIds.length === 1 &&
          dependencies.sessions.resolveProcessMessages !== undefined
            ? await dependencies.sessions
                .resolveProcessMessages({
                  identityContext: identity,
                  sessionId: brand<string, 'SessionId'>(params.sessionId),
                  requestId: eventRequestIds[0]!,
                  runId: brand<string, 'RequestRunId'>(params.runId),
                  messageIds: referencedMessageIds,
                  ...(hasLegacyProcessEvents ? { includeLegacyCandidates: true } : {}),
                })
                .catch(() => [])
            : [];
        const processMessageById = new Map(processMessages.map((message) => [message.messageId, message] as const));
        const events = page.events.flatMap((event) => {
          const messageId = referencedProcessMessageId(event);
          const directProcessMessage = typeof messageId === 'string' ? processMessageById.get(brand<string, 'MessageId'>(messageId)) : undefined;
          const requiresProcessMessage = requiresProcessMessageAssociation(event);
          const isLegacyProcessEvent = !isTerminalTimelineEvent(event) && event.inlinePayload.messageId === undefined && requiresProcessMessage;
          const legacyAssociation = isLegacyProcessEvent ? resolveLegacyProcessMessageAssociation(event, processMessages) : undefined;
          const processMessageAssociation = directProcessMessage === undefined ? legacyAssociation : { message: directProcessMessage };
          const projectionEvent = isLegacyProcessEvent
            ? {
                ...event,
                inlinePayload: {
                  ...event.inlinePayload,
                  messageId: processMessageAssociation?.message.messageId ?? `unavailable:${event.eventId ?? event.sequence ?? 'event'}`,
                },
              }
            : event;
          const outcome = projectTimelineEventToStreamEnvelope(projectionEvent, {
            ...(dependencies.capabilityResultPresentationPolicy === undefined
              ? {}
              : {
                  capabilityResultPresentationPolicy: dependencies.capabilityResultPresentationPolicy,
                }),
            ...(processMessageAssociation === undefined
              ? {}
              : {
                  processMessageAssociation,
                }),
          });
          if (outcome.kind === 'TIMELINE_ONLY') {
            return [];
          }
          if (outcome.kind === 'PROJECTION_FAILURE') {
            throw new AgentError({ ...outcome.safeError });
          }
          return [outcome.envelope];
        });
        let eventsResult = events;
        if (dependencies.watermark !== undefined && dependencies.getWatermarkEnabled?.() === true) {
          const watermarkAbort = new AbortController();
          const abortWatermark = () => watermarkAbort.abort();
          request.raw.on('aborted', abortWatermark);
          try {
            eventsResult = await transformEventsWatermark(events, dependencies.watermark, logger, watermarkAbort.signal);
          } finally {
            request.raw.off('aborted', abortWatermark);
          }
        }
        return {
          availability: 'AVAILABLE' as const,
          events: eventsResult,
          ...(page.nextAfterSequence === undefined ? {} : { nextAfterSequence: page.nextAfterSequence }),
        };
      },
    );
  }

  if (shouldRegister('runtime/bootstrap')) {
    instance.get(route('runtime/bootstrap'), { schema: { response: { 200: runtimeBootstrapResponse, ...commonErrorResponses } } }, async () => {
      const uploadConfig = dependencies.chatUploadConfigProvider
        ? await dependencies.chatUploadConfigProvider.get()
        : (dependencies.runtimeBootstrap.chatUploadFileConfig ?? dependencies.chatUploadFileConfig);
      const portalAbilityConfig = dependencies.portalAbilityConfigProvider
        ? await dependencies.portalAbilityConfigProvider.get()
        : defaultPortalAbilityBootstrapConfig();
      return projectRuntimeBootstrap({
        transportKind: dependencies.runtimeBootstrap.transportKind,
        ...(uploadConfig === undefined ? {} : { chatUploadFileConfig: uploadConfig }),
        portalAbilityConfig,
        ...(dependencies.runtimeBootstrap.guardrail === undefined ? {} : { guardrail: dependencies.runtimeBootstrap.guardrail }),
      });
    });
  }

  const healthRouteSchema = { response: { 200: healthResponse, 503: healthResponse } };

  if (shouldRegister('health')) {
    instance.get(route('health'), { schema: healthRouteSchema }, async (request, reply) => {
      const response = await evaluateHealth(request, (signal) => dependencies.health?.primary(signal), 'primary');
      return reply.status(statusForHealth(response)).send(response);
    });

    instance.get(route('health/deep'), { schema: healthRouteSchema }, async (request, reply) => {
      const response = await evaluateHealth(request, (signal) => dependencies.health?.deep(signal), 'deep');
      return reply.status(statusForHealth(response)).send(response);
    });
  }

  // Phase 1: Upload file to gateway-managed temporary storage.
  if (shouldRegister('sessions/:sessionId/files/upload')) {
    instance.post(
      route('sessions/:sessionId/files/upload'),
      {
        config: { opLog: { prefix: 'FileController.uploadFile', level: 'MINOR' as const, detailParams: ['params.sessionId'] } },
        schema: { params: sessionParams, response: { 200: uploadFileResponse, ...commonErrorResponses } },
      },
      async (request, reply) => {
        const uploadConfig = dependencies.chatUploadConfigProvider
          ? await dependencies.chatUploadConfigProvider.get()
          : dependencies.chatUploadFileConfig;
        if (dependencies.stagedUploadRuntime === undefined || uploadConfig === undefined) {
          throw new AgentError({
            code: 'UPLOAD_NOT_AVAILABLE',
            message: 'File upload service is unavailable.',
            category: 'UNAVAILABLE',
            retryable: true,
          });
        }
        const identity = dependencies.identityResolver(request);
        (request as any).opLogIdentity = identity;
        const params = request.params as { sessionId: string };
        const sessionId = brand<string, 'SessionId'>(params.sessionId);
        if (!isMultipartRequest(request)) {
          throw new AgentError({
            code: 'REQUEST_VALIDATION_FAILED',
            message: 'File upload requires multipart/form-data.',
            category: 'VALIDATION',
            retryable: false,
          });
        }
        const multipart = await parseMultipartFileUpload(request);
        const session = await dependencies.sessions.requireSession({ identityContext: identity, sessionId });
        try {
          const result = await dependencies.stagedUploadRuntime.uploadToTemp({
            identityContext: identity,
            agentId: session.agentId,
            sessionId,
            tempRunId: multipart.tempRunId,
            fileName: multipart.fileName,
            config: uploadConfig,
            fileStream: multipart.fileStream,
          });
          return reply.status(200).send(result);
        } catch (uploadError) {
          if (uploadError instanceof Error && uploadError.message === 'UPLOAD_CONCURRENCY_TIMEOUT') {
            return reply
              .status(503)
              .send({ error: { code: 'UPLOAD_CONCURRENCY_TIMEOUT', message: 'Upload service is busy, please try again later.' } });
          }
          throw uploadError;
        }
      },
    );
  }

  // Delete a gateway-managed temporary file.
  if (shouldRegister('sessions/:sessionId/files/tmp/:tempRunId')) {
    instance.delete(
      route('sessions/:sessionId/files/tmp/:tempRunId'),
      {
        config: { opLog: { prefix: 'FileController.deleteTempFile', level: 'MINOR' as const, detailParams: ['params.sessionId'] } },
        schema: { params: tempFileParams, querystring: deleteTempFileQuery, response: { 204: noContentResponse, ...commonErrorResponses } },
      },
      async (request, reply) => {
        if (dependencies.stagedUploadRuntime === undefined) {
          return reply.status(204).send();
        }
        const identity = dependencies.identityResolver(request);
        (request as any).opLogIdentity = identity;
        const params = request.params as { sessionId: string; tempRunId: string };
        const query = request.query as { fileName?: string };
        if (typeof query.fileName !== 'string' || query.fileName.length === 0) {
          throw new AgentError({
            code: 'REQUEST_VALIDATION_FAILED',
            message: 'fileName query parameter is required.',
            category: 'VALIDATION',
            retryable: false,
          });
        }
        await dependencies.stagedUploadRuntime.deleteTemp({
          identityContext: identity,
          sessionId: brand<string, 'SessionId'>(params.sessionId),
          tempRunId: params.tempRunId,
          fileName: query.fileName,
        });
        return reply.status(204).send();
      },
    );
  }

  // Download a HOFS file by complete object name (proxy download via BlobStoreGateway.materializeBlob).
  if (shouldRegister('sessions/:sessionId/files/download')) {
    instance.get(
      route('sessions/:sessionId/files/download'),
      {
        config: { opLog: { prefix: 'FileController.downloadFile', level: 'MINOR' as const, detailParams: ['params.sessionId'] } },
        schema: { params: sessionParams, response: { ...commonErrorResponses } },
      },
      async (request, reply) => {
        if (dependencies.fileDownloadRuntime === undefined) {
          throw new AgentError({
            code: 'DOWNLOAD_NOT_AVAILABLE',
            message: 'File download service is unavailable.',
            category: 'UNAVAILABLE',
            retryable: true,
          });
        }
        const identity = dependencies.identityResolver(request);
        (request as any).opLogIdentity = identity;
        const params = request.params as { sessionId: string };
        const sessionId = brand<string, 'SessionId'>(params.sessionId);
        const query = request.query as { path?: string };
        if (typeof query.path !== 'string' || query.path.length === 0) {
          throw new AgentError({
            code: 'REQUEST_VALIDATION_FAILED',
            message: 'path query parameter is required.',
            category: 'VALIDATION',
            retryable: false,
          });
        }
        validateDownloadObjectName(query.path);
        const session = await dependencies.sessions.requireSession({ identityContext: identity, sessionId });
        const downloadId = crypto.randomUUID();
        const fileDownloadRuntime = dependencies.fileDownloadRuntime;
        let materialized: { readonly localFilePath: string; readonly safeFileName: string; readonly sizeBytes: number };
        try {
          materialized = await fileDownloadRuntime.materialize({
            identityContext: identity,
            agentId: session.agentId,
            sessionId,
            objectName: query.path,
            downloadId,
          });
        } catch (downloadError) {
          if (downloadError instanceof Error && downloadError.message === 'DOWNLOAD_CONCURRENCY_TIMEOUT') {
            return reply
              .status(503)
              .send({ error: { code: 'DOWNLOAD_CONCURRENCY_TIMEOUT', message: 'Download service is busy, please try again later.' } });
          }
          throw downloadError;
        }
        let cleaned = false;
        const cleanup = (): void => {
          if (cleaned) {
            return;
          }
          cleaned = true;
          void fileDownloadRuntime.cleanup({ downloadId }).catch(() => {});
        };
        reply.raw.on('close', cleanup);
        reply.raw.on('error', cleanup);
        reply.header('Content-Disposition', contentDispositionAttachment(materialized.safeFileName));
        reply.header('Content-Length', String(materialized.sizeBytes));
        reply.type(mimeTypeFromExtension(materialized.safeFileName));
        return reply.send(createReadStream(materialized.localFilePath));
      },
    );
  }

  if (shouldRegister('skills')) {
    instance.get(
      route('skills'),
      { schema: { querystring: skillCatalogQuery, response: { 200: skillCatalogResponse, ...commonErrorResponses } } },
      async (request, reply) => {
        const query = request.query as { pageNum?: string; pageSize?: string; keyword?: string };
        const pageNum = parsePositiveInteger(query.pageNum, 1, 'pageNum');
        const pageSize = parsePositiveInteger(query.pageSize, 50, 'pageSize');
        if (pageSize > 100) {
          throw new AgentError({
            code: 'REQUEST_VALIDATION_FAILED',
            message: 'pageSize must not exceed 100.',
            category: 'VALIDATION',
            retryable: false,
          });
        }
        const keyword = query.keyword?.trim();
        return withAbortableRequest(request, reply, async (signal) => {
          const identity = dependencies.identityResolver(request);
          if (dependencies.skillCatalog === undefined) {
            return reply.status(503).send(safeError('SKILL_CATALOG_UNAVAILABLE', 'Skill catalog service is unavailable.'));
          }
          return dependencies.skillCatalog.listSkills(
            {
              identityContext: identity,
              pageNum,
              pageSize,
              ...(keyword === undefined || keyword.length === 0 ? {} : { keyword }),
            },
            signal,
          );
        });
      },
    );
  }

  if (shouldRegister('category-questions')) {
    instance.get(
      route('category-questions'),
      { schema: { querystring: categoryQuestionQuery, response: { 200: categoryQuestionResponse, ...commonErrorResponses } } },
      async (request, reply) => {
        const query = request.query as { locale?: string };
        if (dependencies.categoryQuestions === undefined) {
          return { locale: 'zh', categories: [] };
        }
        return withUnavailableFallback(
          request,
          reply,
          { code: 'CATEGORY_QUESTION_UNAVAILABLE', message: 'Category question service is temporarily unavailable.' },
          (signal) =>
            dependencies.categoryQuestions!.listCategoryQuestions(
              {
                agentId: resolveAgentIdFromHeader(request, dependencies.defaultAgentId),
                ...(query.locale === undefined ? {} : { locale: query.locale }),
              },
              signal,
            ),
        );
      },
    );
  }

  if (shouldRegister('frequent-questions')) {
    instance.get(
      route('frequent-questions'),
      { schema: { querystring: frequentQuestionQuery, response: { 200: frequentQuestionResponse, ...commonErrorResponses } } },
      async (request, reply) => {
        const identity = dependencies.identityResolver(request);
        const query = request.query as { locale?: string };
        if (dependencies.frequentQuestions === undefined) {
          return { locale: query.locale ?? 'zh-CN', questions: [] };
        }
        return withUnavailableFallback(
          request,
          reply,
          { code: 'FREQUENT_QUESTION_UNAVAILABLE', message: 'Frequent question service is temporarily unavailable.' },
          (signal) =>
            dependencies.frequentQuestions!.listFrequentQuestions(
              {
                tenantId: identity.tenantId,
                subjectId: identity.subjectId,
                agentId: resolveAgentIdFromHeader(request, dependencies.defaultAgentId),
                ...(query.locale === undefined ? {} : { locale: query.locale }),
              },
              signal,
            ),
        );
      },
    );
  }

  if (shouldRegister('question-association')) {
    instance.get(
      route('question-association'),
      { schema: { querystring: questionAssociationQuery, response: { 200: questionAssociationResponse, ...commonErrorResponses } } },
      async (request, reply) => {
        const identity = dependencies.identityResolver(request);
        const query = request.query as { keyword: string; locale?: string };
        const trimmedKeyword = query.keyword.trim();
        if (trimmedKeyword.length === 0) {
          return reply.status(400).send({ error: { code: 'INVALID_KEYWORD', message: 'Keyword must not be empty.' } });
        }
        if (dependencies.frequentQuestions === undefined) {
          return { locale: query.locale ?? 'zh-CN', questions: [] };
        }
        return withUnavailableFallback(
          request,
          reply,
          { code: 'QUESTION_ASSOCIATION_UNAVAILABLE', message: 'Question association service is temporarily unavailable.' },
          (signal) =>
            dependencies.frequentQuestions!.listQuestionAssociations(
              {
                tenantId: identity.tenantId,
                subjectId: identity.subjectId,
                agentId: resolveAgentIdFromHeader(request, dependencies.defaultAgentId),
                keyword: trimmedKeyword,
                ...(query.locale === undefined ? {} : { locale: query.locale }),
              },
              signal,
            ),
        );
      },
    );
  }

  if (shouldRegister('sessions/:sessionId/requests/:requestId/suggested-questions')) {
    instance.post(
      route('sessions/:sessionId/requests/:requestId/suggested-questions'),
      {
        config: { opLog: { prefix: 'SuggestedQuestionController.generateQuestions', level: 'MINOR' as const, detailParams: ['params.sessionId'] } },
        schema: { params: sessionRequestParams, response: { 200: suggestedQuestionsResponse, ...commonErrorResponses } },
      },
      async (request, reply) => {
        const identity = dependencies.identityResolver(request);
        (request as any).opLogIdentity = identity;
        const params = request.params as { sessionId: string; requestId: string };
        const sessionId = brand<string, 'SessionId'>(params.sessionId);
        const requestId = brand<string, 'MessageId'>(params.requestId);
        const session = await dependencies.sessions.requireSession({ identityContext: identity, sessionId });
        const messagePage = await dependencies.sessions.listMessages({
          identityContext: identity,
          sessionId,
          requestId,
          includeCapabilityResults: false,
          limit: 50,
        });
        let runId: RequestRunId | undefined;
        for (let index = messagePage.items.length - 1; index >= 0; index -= 1) {
          const candidateRunId = messagePage.items[index]?.runId;
          if (candidateRunId !== undefined && candidateRunId !== null) {
            runId = candidateRunId;
            break;
          }
        }
        if (runId === undefined) {
          return reply.status(404).send(safeError('NOT_FOUND', 'Not Found.'));
        }
        if (dependencies.suggestedQuestions === undefined) {
          return { questions: [] };
        }
        const controller = new AbortController();
        const abortQuery = () => controller.abort();
        request.raw.on('aborted', abortQuery);
        reply.raw.on('close', abortQuery);
        try {
          const result = await dependencies.suggestedQuestions!.generate(
            {
              tenantId: identity.tenantId,
              subjectId: identity.subjectId,
              agentId: session.agentId,
              sessionId,
              requestId,
              runId,
            },
            controller.signal,
          );
          return { questions: result.questions };
        } finally {
          request.raw.off('aborted', abortQuery);
          reply.raw.off('close', abortQuery);
        }
      },
    );
  }

  if (shouldRegister('sessions')) {
    instance.post(
      route('sessions'),
      {
        config: { opLog: { prefix: 'SessionController.createSession', level: 'MINOR' as const } },
        schema: { body: createSessionBody, response: { 200: sessionSummaryResponse, ...commonErrorResponses } },
      },
      async (request) => {
        const body = request.body as { locale?: string };
        const identity = dependencies.identityResolver(request);
        (request as any).opLogIdentity = identity;
        const headerAgentId = extractHeaderAgentId(request);
        return projectSession(
          await dependencies.sessions.createSession({
            identityContext: identity,
            idempotencyKey: createIdempotencyKey(dependencies),
            ...(body.locale === undefined ? {} : { locale: brand<string, 'RequestLocale'>(body.locale) }),
            ...(headerAgentId === undefined ? {} : { agentId: headerAgentId }),
          }),
        );
      },
    );
  }

  if (shouldRegister('sessions/:sessionId/conversation/preview')) {
    instance.get(
      route('sessions/:sessionId/conversation/preview'),
      {
        preValidation: assertConversationPreviewQueryParameters,
        schema: {
          params: sessionParams,
          querystring: conversationPreviewQuery,
          response: { 200: conversationPreviewResponse, ...commonErrorResponses },
        },
      },
      async (request) => {
        const identity = dependencies.identityResolver(request);
        const params = request.params as { sessionId: string };
        const query = parseConversationPreviewQuery(request.query as ConversationPreviewRawQuery);
        const sessionId = brand<string, 'SessionId'>(params.sessionId);
        return projectConversationPreview(await dependencies.sessions.listConversationPreview({ identityContext: identity, sessionId, ...query }));
      },
    );
  }

  if (shouldRegister('sessions/:sessionId/conversation')) {
    instance.get(
      route('sessions/:sessionId/conversation'),
      { schema: { params: sessionParams, querystring: conversationQuery, response: { 200: conversationResponse, ...commonErrorResponses } } },
      async (request) => {
        const identity = dependencies.identityResolver(request);
        const params = request.params as { sessionId: string };
        const query = parseConversationQuery(request.query as ConversationRawQuery);
        const sessionId = brand<string, 'SessionId'>(params.sessionId);
        const session = await dependencies.sessions.requireSession({ identityContext: identity, sessionId });
        const [page, activeRun] = await Promise.all([
          dependencies.sessions.listMessages({
            identityContext: identity,
            sessionId,
            includeCapabilityResults: query.includeCapabilityResults,
            limit: query.limit,
            ...(query.beforeCursor === undefined ? {} : { beforeCursor: query.beforeCursor }),
            ...(query.afterCursor === undefined ? {} : { afterCursor: query.afterCursor }),
            ...(query.anchorMessageId === undefined ? {} : { anchorMessageId: query.anchorMessageId }),
          }),
          dependencies.sessions.getActiveRun({ identityContext: identity, sessionId }),
        ]);
        let conversationResult = projectConversation(page, activeRun);
        // Watermark: transform ASSISTANT messages with content > 500 chars
        if (dependencies.watermark !== undefined && dependencies.getWatermarkEnabled?.() === true) {
          const watermarkAbort = new AbortController();
          const abortWatermark = () => watermarkAbort.abort();
          request.raw.on('aborted', abortWatermark);
          try {
            const watermarkedItems = await transformMessageContentWatermark(
              conversationResult.items,
              dependencies.watermark,
              logger,
              'conversation',
              watermarkAbort.signal,
            );
            conversationResult = { ...conversationResult, items: watermarkedItems };
          } finally {
            request.raw.off('aborted', abortWatermark);
          }
        }
        // Resolve attachment safe summaries for messages that have attachmentIds
        if (dependencies.attachmentSummaryResolver !== undefined) {
          const enrichedItems = await Promise.all(
            conversationResult.items.map(async (item) => {
              const attachmentIds = extractAttachmentIdsFromMetadata(item.metadata);
              if (attachmentIds.length === 0) {
                return item;
              }
              const summaries = await resolveAttachmentSummaries(dependencies.attachmentSummaryResolver!, identity, session.agentId, attachmentIds);
              return { ...item, ...(summaries.length === 0 ? {} : { attachments: summaries }) };
            }),
          );
          return { ...conversationResult, items: enrichedItems };
        }
        return conversationResult;
      },
    );
  }

  if (shouldRegister('sessions/:sessionId/messages/:messageId/fork')) {
    instance.post(
      route('sessions/:sessionId/messages/:messageId/fork'),
      {
        config: { opLog: { prefix: 'SessionController.forkFromMessage', level: 'MINOR' as const, detailParams: ['params.sessionId'] } },
        schema: { params: sessionMessageParams, response: { 200: sessionSummaryResponse, ...commonErrorResponses } },
      },
      async (request, reply) => {
        const identity = dependencies.identityResolver(request);
        (request as any).opLogIdentity = identity;
        const params = request.params as { sessionId: string; messageId: string };
        const body = requireJsonBody(request.body, forkFromMessageBody) as { idempotencyKey: string };
        const idempotencyKey = normalizeForkIdempotencyKey(body.idempotencyKey);
        try {
          const result = await withAbortableRequest(request, reply, (signal) =>
            dependencies.sessions.forkFromMessage(
              {
                identityContext: identity,
                sourceSessionId: brand<string, 'SessionId'>(params.sessionId),
                sourceAnchorMessageId: brand<string, 'MessageId'>(params.messageId),
                idempotencyKey,
              },
              signal,
            ),
          );
          return projectSession(result.childSession);
        } catch (error) {
          throw normalizeSessionForkRouteError(error);
        }
      },
    );
  }

  if (shouldRegister('sessions/:sessionId/requests/:requestId/fork')) {
    instance.post(
      route('sessions/:sessionId/requests/:requestId/fork'),
      {
        config: { opLog: { prefix: 'SessionController.forkFromRequest', level: 'MINOR' as const, detailParams: ['params.sessionId'] } },
        schema: { params: sessionRequestParams, response: { 200: sessionSummaryResponse, ...commonErrorResponses } },
      },
      async (request, reply) => {
        const identity = dependencies.identityResolver(request);
        (request as any).opLogIdentity = identity;
        const params = request.params as { sessionId: string; requestId: string };
        const body = requireJsonBody(request.body, forkFromMessageBody) as { idempotencyKey: string };
        const idempotencyKey = normalizeForkIdempotencyKey(body.idempotencyKey);
        try {
          const result = await withAbortableRequest(request, reply, (signal) =>
            dependencies.sessions.forkFromRequest(
              {
                identityContext: identity,
                sourceSessionId: brand<string, 'SessionId'>(params.sessionId),
                sourceRequestId: brand<string, 'MessageId'>(params.requestId),
                idempotencyKey,
              },
              signal,
            ),
          );
          return projectSession(result.childSession);
        } catch (error) {
          throw normalizeSessionForkRouteError(error);
        }
      },
    );
  }

  if (shouldRegister('sessions/:sessionId/requests')) {
    instance.post(
      route('sessions/:sessionId/requests'),
      {
        config: { opLog: { prefix: 'RequestController.submitRequest', level: 'MINOR' as const, detailParams: ['params.sessionId'] } },
        schema: { params: sessionParams, response: { 200: requestAcceptedResponse, ...commonErrorResponses } },
      },
      async (request, reply) => {
        const identity = dependencies.identityResolver(request);
        (request as any).opLogIdentity = identity;
        const params = request.params as { sessionId: string };
        const sessionId = brand<string, 'SessionId'>(params.sessionId);
        const session = await dependencies.sessions.requireSession({ identityContext: identity, sessionId });
        if (isMultipartRequest(request)) {
          throw new AgentError({
            code: 'REQUEST_VALIDATION_FAILED',
            message: 'Request submit accepts JSON with staged attachment references.',
            category: 'VALIDATION',
            retryable: false,
          });
        }
        const body = requireJsonBody(request.body, submitBody) as {
          inputText: string;
          idempotencyKey: string;
          locale?: string;
          routingConstraints?: import('@nextagent/agent-contracts/runtime').RoutingConstraints;
          modelOptions?: import('@nextagent/agent-contracts/runtime').RequestModelOptions;
          attachments?: ReadonlyArray<{ readonly tempRunId: string; readonly fileName: string }>;
        };
        const result = await withIncomingTrace(dependencies, request, () =>
          submitStagedRequest(dependencies, {
            identity,
            session,
            inputText: body.inputText,
            attachments: body.attachments ?? [],
            ...(body.locale === undefined ? {} : { locale: body.locale }),
            ...(body.routingConstraints === undefined ? {} : { routingConstraints: body.routingConstraints }),
            ...(body.modelOptions === undefined ? {} : { modelOptions: body.modelOptions }),
            idempotencyKey: body.idempotencyKey,
            requestHeaders: extractRequestHeaders(request),
          }),
        );
        return result;
      },
    );
  }

  if (shouldRegister('requests')) {
    instance.post(
      route('requests'),
      {
        config: { opLog: { prefix: 'RequestController.submitConvenienceRequest', level: 'MINOR' as const } },
        schema: { response: { 200: requestAcceptedResponse, ...commonErrorResponses } },
      },
      async (request) => {
        const identity = dependencies.identityResolver(request);
        (request as any).opLogIdentity = identity;
        if (isMultipartRequest(request)) {
          throw new AgentError({
            code: 'REQUEST_VALIDATION_FAILED',
            message: 'Request submit accepts JSON with staged attachment references.',
            category: 'VALIDATION',
            retryable: false,
          });
        }
        const headerAgentId = extractHeaderAgentId(request);
        const body = requireJsonBody(request.body, convenienceSubmitBody) as {
          inputText: string;
          idempotencyKey: string;
          locale?: string;
          sessionId?: string;
          routingConstraints?: import('@nextagent/agent-contracts/runtime').RoutingConstraints;
          modelOptions?: import('@nextagent/agent-contracts/runtime').RequestModelOptions;
          attachments?: ReadonlyArray<{ readonly tempRunId: string; readonly fileName: string }>;
        };
        const session =
          body.sessionId === undefined
            ? await dependencies.sessions.createSession({
                identityContext: identity,
                locale: brand<string, 'RequestLocale'>(body.locale ?? 'zh-CN'),
                idempotencyKey: brand<string, 'IdempotencyKey'>(`${body.idempotencyKey}:session`),
                ...(headerAgentId === undefined ? {} : { agentId: headerAgentId }),
              })
            : { sessionId: brand<string, 'SessionId'>(body.sessionId) };
        try {
          const persistedSession = await dependencies.sessions.requireSession({ identityContext: identity, sessionId: session.sessionId });
          return await withIncomingTrace(dependencies, request, () =>
            submitStagedRequest(dependencies, {
              identity,
              session: persistedSession,
              inputText: body.inputText,
              attachments: body.attachments ?? [],
              ...(body.locale === undefined ? {} : { locale: body.locale }),
              ...(body.routingConstraints === undefined ? {} : { routingConstraints: body.routingConstraints }),
              ...(body.modelOptions === undefined ? {} : { modelOptions: body.modelOptions }),
              idempotencyKey: body.idempotencyKey,
              requestHeaders: extractRequestHeaders(request),
            }),
          );
        } catch (error) {
          if (body.sessionId === undefined) {
            await cleanupOrphanSession(dependencies.sessions, identity, session.sessionId);
          }
          throw error;
        }
      },
    );
  }

  if (shouldRegister('sessions/:sessionId/cancel')) {
    instance.post(
      route('sessions/:sessionId/cancel'),
      {
        config: { opLog: { prefix: 'RequestController.cancelRequest', level: 'MINOR' as const, detailParams: ['params.sessionId'] } },
        schema: { params: sessionParams, body: cancelBody, response: { 200: cancelResponse, ...commonErrorResponses } },
      },
      async (request) => {
        const identity = dependencies.identityResolver(request);
        (request as any).opLogIdentity = identity;
        const params = request.params as { sessionId: string };
        const body = request.body as { expectedLatestRequestId: string; action?: 'CANCEL' | 'CANCEL_LATEST'; idempotencyKey: string };
        const sessionId = brand<string, 'SessionId'>(params.sessionId);
        const session = await dependencies.sessions.requireSession({ identityContext: identity, sessionId });
        return dependencies.runtime.cancel({
          sessionId,
          identityContext: identity,
          expectedLatestRequestId: brand<string, 'MessageId'>(body.expectedLatestRequestId),
          action: 'CANCEL',
          idempotencyKey: brand<string, 'IdempotencyKey'>(body.idempotencyKey),
        });
      },
    );
  }

  if (shouldRegister('sessions/:sessionId/retry')) {
    instance.post(
      route('sessions/:sessionId/retry'),
      {
        config: { opLog: { prefix: 'RequestController.retryRequest', level: 'MINOR' as const, detailParams: ['params.sessionId'] } },
        schema: { params: sessionParams, body: retryBody, response: { 200: requestAcceptedResponse, ...commonErrorResponses } },
      },
      async (request) => {
        const identity = dependencies.identityResolver(request);
        (request as any).opLogIdentity = identity;
        const params = request.params as { sessionId: string };
        const body = request.body as { expectedLatestRequestId: string; idempotencyKey: string };
        const sessionId = brand<string, 'SessionId'>(params.sessionId);
        const session = await dependencies.sessions.requireSession({ identityContext: identity, sessionId });
        return dependencies.runtime.retryLatest({
          sessionId,
          identityContext: identity,
          expectedLatestRequestId: brand<string, 'MessageId'>(body.expectedLatestRequestId),
          action: 'RETRY_LATEST',
          idempotencyKey: brand<string, 'IdempotencyKey'>(body.idempotencyKey),
          inputVariables: { requestHeaders: extractRequestHeaders(request) },
        });
      },
    );
  }

  if (shouldRegister('sessions/:sessionId/requests/latest/edit')) {
    instance.post(
      route('sessions/:sessionId/requests/latest/edit'),
      {
        config: { opLog: { prefix: 'RequestController.editLatestRequest', level: 'MINOR' as const, detailParams: ['params.sessionId'] } },
        schema: { params: sessionParams, response: { 200: requestAcceptedResponse, ...commonErrorResponses } },
      },
      async (request) => {
        const identity = dependencies.identityResolver(request);
        (request as any).opLogIdentity = identity;
        const params = request.params as { sessionId: string };
        const sessionId = brand<string, 'SessionId'>(params.sessionId);
        const session = await dependencies.sessions.requireSession({ identityContext: identity, sessionId });
        if (isMultipartRequest(request)) {
          throw new AgentError({
            code: 'REQUEST_VALIDATION_FAILED',
            message: 'Edit latest accepts a JSON text body only.',
            category: 'VALIDATION',
            retryable: false,
          });
        }
        const body = requireJsonBody(request.body, editLatestBody) as {
          expectedLatestRequestId: string;
          editedInputText: string;
          idempotencyKey: string;
          locale?: string;
        };
        const editLocale = brand<string, 'RequestLocale'>(body.locale ?? 'zh-CN');
        if (dependencies.guardrail !== undefined && dependencies.guardrailEnabled) {
          const guardResult = await dependencies.guardrail.checkQuestion({
            questions: [body.editedInputText],
            ignoreItems: ['topic_limit'],
            locale: editLocale,
          });
          if (!guardResult.isLegal) {
            return dependencies.runtime.editLatest({
              sessionId,
              identityContext: identity,
              expectedLatestRequestId: brand<string, 'MessageId'>(body.expectedLatestRequestId),
              editedInputText: body.editedInputText,
              attachmentIds: [],
              idempotencyKey: brand<string, 'IdempotencyKey'>(body.idempotencyKey),
              locale: editLocale,
              inputVariables: { requestHeaders: extractRequestHeaders(request) },
              guardBlockRefusal:
                guardResult.refusalMessage.trim().length > 0 ? guardResult.refusalMessage : guardrailServiceUnavailableMessage(editLocale),
            });
          }
        }
        return dependencies.runtime.editLatest({
          sessionId,
          identityContext: identity,
          expectedLatestRequestId: brand<string, 'MessageId'>(body.expectedLatestRequestId),
          editedInputText: body.editedInputText,
          attachmentIds: [],
          idempotencyKey: brand<string, 'IdempotencyKey'>(body.idempotencyKey),
          ...(body.locale === undefined ? {} : { locale: brand<string, 'RequestLocale'>(body.locale) }),
          inputVariables: { requestHeaders: extractRequestHeaders(request) },
        });
      },
    );
  }

  if (shouldRegister('sessions/:sessionId/pending-inputs/:pendingInputId/answer')) {
    instance.post(
      route('sessions/:sessionId/pending-inputs/:pendingInputId/answer'),
      {
        config: { opLog: { prefix: 'RequestController.answerPendingInput', level: 'MINOR' as const, detailParams: ['params.sessionId'] } },
        schema: { params: pendingInputParams, body: pendingInputAnswerBody, response: { 200: pendingInputAnswerResponse, ...commonErrorResponses } },
      },
      async (request) => {
        const identity = dependencies.identityResolver(request);
        (request as any).opLogIdentity = identity;
        const params = request.params as { sessionId: string; pendingInputId: string };
        const answers = parsePendingInputAnswers(request.body);
        return dependencies.runtime.answerPendingInput({
          identityContext: identity,
          idempotencyKey: createIdempotencyKey(dependencies),
          answer: {
            sessionId: brand<string, 'SessionId'>(params.sessionId),
            pendingInputId: brand<string, 'PendingInputId'>(params.pendingInputId),
            answers,
          },
        });
      },
    );
  }

  if (shouldRegister('sessions/:sessionId/stream')) {
    instance.get(
      route('sessions/:sessionId/stream'),
      { schema: { params: sessionParams, querystring: streamQuery, response: { ...commonErrorResponses } } },
      async (request, reply) => {
        const identity = dependencies.identityResolver(request);
        const params = request.params as { sessionId: string };
        const query = request.query as { lastSeenSequence?: string; requestId?: string; runId?: string };
        const sessionId = brand<string, 'SessionId'>(params.sessionId);
        const session = await dependencies.sessions.requireSession({ identityContext: identity, sessionId });
        const abortController = new AbortController();
        const abortStream = () => abortController.abort();
        request.raw.on('aborted', abortStream);
        reply.raw.on('close', abortStream);
        try {
          const lastSeenSequence = parseLastSeenSequence(query.lastSeenSequence);
          const streamFields = { transport: 'SSE', requestId: request.id, agentId: session.agentId, sessionId };
          if (lastSeenSequence !== undefined) {
            logger.debug({ event: 'stream.replay.started', ...streamFields });
          }
          await sendSseStream(
            reply,
            deliverWebStream({
              ...(dependencies.capabilityResultPresentationPolicy === undefined
                ? {}
                : {
                    capabilityResultPresentationPolicy: dependencies.capabilityResultPresentationPolicy,
                  }),
              sessions: dependencies.sessions,
              identityContext: identity,
              sessionId,
              ...(lastSeenSequence === undefined ? {} : { lastSeenSequence }),
              ...(query.requestId === undefined ? {} : { requestId: brand<string, 'MessageId'>(query.requestId) }),
              ...(query.runId === undefined ? {} : { runId: brand<string, 'RequestRunId'>(query.runId) }),
              signal: abortController.signal,
              ...(dependencies.guardrail === undefined
                ? {}
                : {
                    guardrail: dependencies.guardrail,
                    guardrailEnabled: dependencies.guardrailEnabled === true,
                    guardLocale: dependencies.guardLocale,
                  }),
              ...(dependencies.watermark === undefined
                ? {}
                : { watermark: dependencies.watermark, getWatermarkEnabled: dependencies.getWatermarkEnabled }),
              onOutputGuardBlocked: (envelope) => {
                const runId = envelope.runId;
                if (runId === undefined) {
                  return;
                }
                void dependencies.runtime.hideRunMessages?.({
                  identityContext: identity,
                  agentId: session.agentId,
                  sessionId,
                  requestId: envelope.requestId,
                  runId,
                  reason: 'GUARD_BLOCKED',
                });
              },
              onDiagnostic: (diagnostic) => {
                writeStreamDiagnostic(streamFields, diagnostic);
                if (
                  diagnostic.kind === 'TIMELINE_READ_FAILURE' ||
                  diagnostic.kind === 'PROJECTION_FAILURE' ||
                  diagnostic.kind === 'SERIALIZATION_FAILURE'
                ) {
                  abortController.abort();
                }
              },
            }),
            {
              onDiagnostic: (diagnostic) => {
                logger.warn({ event: 'stream.backpressure', ...streamFields, safeReasonCode: diagnostic.code });
                abortController.abort();
              },
            },
          );
        } finally {
          request.raw.off('aborted', abortStream);
          reply.raw.off('close', abortStream);
        }
      },
    );
  }

  if (dependencies.sessionActivities !== undefined && shouldRegister('session-activities/stream')) {
    instance.get(
      route('session-activities/stream'),
      {
        schema: {
          querystring: emptySessionActivityStreamQuery,
          response: { ...commonErrorResponses },
        },
      },
      async (request, reply) => {
        const identityContext = dependencies.identityResolver(request);
        const abortController = new AbortController();
        const abortStream = () => abortController.abort();
        request.raw.on('aborted', abortStream);
        reply.raw.on('close', abortStream);
        try {
          await sendSseStream(
            reply,
            validateSessionActivityMessages(
              dependencies.sessionActivities!.streamSessionActivities({
                identityContext,
                signal: abortController.signal,
              }),
            ),
            {
              eventName: (message: SessionActivityWireMessage) => message.type,
              onDiagnostic: () => abortController.abort(),
            },
          );
        } finally {
          request.raw.off('aborted', abortStream);
          reply.raw.off('close', abortStream);
        }
      },
    );
  }

  if (dependencies.sessionActivities !== undefined && shouldRegister('sessions/:sessionId/activity/consume')) {
    instance.post(
      route('sessions/:sessionId/activity/consume'),
      {
        config: { opLog: { prefix: 'ActivityController.consumeActivity', level: 'MINOR' as const, detailParams: ['params.sessionId'] } },
        schema: {
          params: sessionParams,
          body: sessionActivityConsumeBody,
          response: { 204: noContentResponse, ...commonErrorResponses },
        },
      },
      async (request, reply) => {
        const identityContext = dependencies.identityResolver(request);
        (request as any).opLogIdentity = identityContext;
        const params = request.params as { sessionId: string };
        const body = request.body as { activityId: string; observedRunId: string };
        await dependencies.sessionActivities!.consumeSessionActivity({
          identityContext,
          sessionId: brand<string, 'SessionId'>(params.sessionId),
          activityId: body.activityId,
          observedRunId: brand<string, 'RequestRunId'>(body.observedRunId),
        });
        return reply.status(204).send();
      },
    );
  }

  const registerSessionWebSocket = shouldRegister('sessions/:sessionId/ws');
  const registerSessionActivityWebSocket = dependencies.sessionActivities !== undefined && shouldRegister('session-activities/ws');
  if (registerSessionWebSocket || registerSessionActivityWebSocket) {
    registerWebSocketStream(instance, {
      ...(dependencies.capabilityResultPresentationPolicy === undefined
        ? {}
        : {
            capabilityResultPresentationPolicy: dependencies.capabilityResultPresentationPolicy,
          }),
      sessions: dependencies.sessions,
      runtime: dependencies.runtime,
      identityResolver: dependencies.identityResolver,
      sessionStreamEnabled: registerSessionWebSocket,
      ...(dependencies.sessionActivities === undefined
        ? {}
        : {
            sessionActivities: dependencies.sessionActivities,
            activityStreamEnabled: registerSessionActivityWebSocket,
          }),
      ...(dependencies.guardrail === undefined
        ? {}
        : { guardrail: dependencies.guardrail, guardrailEnabled: dependencies.guardrailEnabled === true, guardLocale: dependencies.guardLocale }),
      ...(dependencies.watermark === undefined ? {} : { watermark: dependencies.watermark, getWatermarkEnabled: dependencies.getWatermarkEnabled }),
    });
  }

  if (shouldRegister('sessions/:sessionId/runs/:runId/annotations')) {
    instance.post(
      route('sessions/:sessionId/runs/:runId/annotations'),
      {
        config: { opLog: { prefix: 'AnnotationController.upsertAnnotation', level: 'MINOR' as const, detailParams: ['params.sessionId'] } },
        schema: { params: runAnnotationParams, body: upsertAnnotationBody, response: { 200: annotationResponse, ...commonErrorResponses } },
      },
      async (request, reply) => {
        if (dependencies.annotations === undefined) {
          return reply.status(503).send(safeError('ANNOTATIONS_UNAVAILABLE', 'Annotations service is unavailable.'));
        }
        const identity = dependencies.identityResolver(request);
        (request as any).opLogIdentity = identity;
        const params = request.params as { sessionId: string; runId: string };
        const sessionId = brand<string, 'SessionId'>(params.sessionId);
        const runId = brand<string, 'RequestRunId'>(params.runId);
        const session = await dependencies.sessions.requireSession({ identityContext: identity, sessionId });
        const body = request.body as {
          sentiment?: 'UP' | 'DOWN' | null;
          isFavorited?: boolean;
          isQuestionFavorited?: boolean;
        };
        if (body.sentiment === undefined && body.isFavorited === undefined && body.isQuestionFavorited === undefined) {
          throw new AgentError({
            code: 'REQUEST_VALIDATION_FAILED',
            message: 'At least one of sentiment, isFavorited, or isQuestionFavorited must be provided.',
            category: 'VALIDATION',
            retryable: false,
          });
        }
        const view = await dependencies.annotations.upsertAnnotation({
          identityContext: identity,
          agentId: session.agentId,
          sessionId,
          requestRunId: runId,
          ...(body.sentiment === undefined ? {} : { sentiment: body.sentiment }),
          ...(body.isFavorited === undefined ? {} : { isFavorited: body.isFavorited }),
          ...(body.isQuestionFavorited === undefined ? {} : { isQuestionFavorited: body.isQuestionFavorited }),
          idempotencyKey: createIdempotencyKey(dependencies),
        });
        return view === undefined ? { sentiment: null, isFavorited: false, isQuestionFavorited: false } : projectAnnotation(view);
      },
    );
  }

  if (shouldRegister('favorites')) {
    instance.get(
      route('favorites'),
      { schema: { querystring: favoritesListQuery, response: { 200: favoritePageResponse, ...commonErrorResponses } } },
      async (request, reply) => {
        if (dependencies.annotations === undefined) {
          return reply.status(503).send(safeError('ANNOTATIONS_UNAVAILABLE', 'Annotations service is unavailable.'));
        }
        const identity = dependencies.identityResolver(request);
        const query = request.query as {
          offset?: string;
          limit?: string;
          favoriteType?: 'ANSWER' | 'QUESTION';
          keyword?: string;
          favoritedFrom?: string;
          favoritedTo?: string;
        };
        // Offset is capped at MAX_FAVORITES_OFFSET (10000, 5 digits). Reject longer digit strings up
        // front so an oversized value (e.g. 9999999) gets this field-level range message instead of
        // leaking past the web boundary into the backing memory service (which returns an opaque
        // WM_HTTP_ERROR) or surfacing parseStrictInteger's "finite safe integer" message. The numeric
        // 0–10000 bound is enforced after parsing.
        if (query.offset !== undefined && query.offset.length > WEB_FAVORITES_OFFSET_MAX_LENGTH) {
          throwValidation(`offset must not exceed ${MAX_FAVORITES_OFFSET}.`);
        }
        const offset = parseStrictInteger(query.offset, 0, 'offset');
        if (offset < 0) {
          throwValidation('offset must be a non-negative integer.');
        }
        if (offset > MAX_FAVORITES_OFFSET) {
          throwValidation(`offset must not exceed ${MAX_FAVORITES_OFFSET}.`);
        }
        const limit = parsePositiveInteger(query.limit, 50, 'limit');
        if (limit > MAX_FAVORITES_LIMIT) {
          throwValidation(`limit must not exceed ${MAX_FAVORITES_LIMIT}.`);
        }
        const keyword = query.keyword?.trim();
        if (keyword !== undefined && Array.from(keyword).length > 50) {
          throwValidation('Favorite keyword must not exceed 50 characters.');
        }
        const favoritedFrom = parseOptionalFavoriteTimestamp(query.favoritedFrom);
        const favoritedTo = parseOptionalFavoriteTimestamp(query.favoritedTo);
        if (favoritedFrom !== undefined && favoritedTo !== undefined && favoritedFrom > favoritedTo) {
          throwValidation('Favorite start time must not be later than end time.');
        }
        const listFavoriteTurns =
          query.favoriteType === 'QUESTION'
            ? dependencies.annotations.listQuestionFavoriteTurns.bind(dependencies.annotations)
            : dependencies.annotations.listFavoriteTurns.bind(dependencies.annotations);
        const filterActive = Boolean(keyword) || favoritedFrom !== undefined || favoritedTo !== undefined;
        const page = filterActive
          ? filterFavoriteTurnPage(
              await listFavoriteTurns({
                identityContext: identity,
                agentId: resolveAgentIdFromHeader(request, dependencies.defaultAgentId),
                offset: 0,
                limit: 100,
              }),
              {
                offset,
                limit,
                ...(keyword === undefined ? {} : { keyword }),
                ...(favoritedFrom === undefined ? {} : { favoritedFrom }),
                ...(favoritedTo === undefined ? {} : { favoritedTo }),
              },
            )
          : await listFavoriteTurns({
              identityContext: identity,
              agentId: resolveAgentIdFromHeader(request, dependencies.defaultAgentId),
              offset,
              limit,
            });
        return projectFavoriteTurnPage(page);
      },
    );
  }

  if (shouldRegister('sessions/:sessionId/annotations')) {
    instance.get(
      route('sessions/:sessionId/annotations'),
      { schema: { params: sessionParams, response: { 200: annotationListResponse, ...commonErrorResponses } } },
      async (request, reply) => {
        if (dependencies.annotations === undefined) {
          return reply.status(503).send(safeError('ANNOTATIONS_UNAVAILABLE', 'Annotations service is unavailable.'));
        }
        const identity = dependencies.identityResolver(request);
        const params = request.params as { sessionId: string };
        const sessionId = brand<string, 'SessionId'>(params.sessionId);
        const session = await dependencies.sessions.requireSession({ identityContext: identity, sessionId });
        const annotations = await dependencies.annotations.listSessionAnnotations({
          identityContext: identity,
          agentId: session.agentId,
          sessionId,
        });
        return { annotations: annotations.map(projectAnnotationListItem) };
      },
    );
  }

  if (shouldRegister('sessions/:sessionId/background-tasks')) {
    instance.get(
      route('sessions/:sessionId/background-tasks'),
      { schema: { params: sessionParams, response: { 200: backgroundTaskListResponse, ...commonErrorResponses } } },
      async (request, reply) => {
        if (dependencies.backgroundTasks === undefined) {
          // Background task support is opt-in (requires a background-capable
          // sandbox). In deployments without it 鈥?most local and remote setups 鈥?
          // degrade to an empty list rather than 503 so the UI can poll without
          // surfacing an error. "No background task service" => "no tasks".
          return { tasks: [] };
        }
        const identity = dependencies.identityResolver(request);
        const params = request.params as { sessionId: string };
        const sessionId = brand<string, 'SessionId'>(params.sessionId);
        // A session that does not exist (or has not been created yet) has no
        // background tasks; treat the scoped lookup miss as an empty list rather
        // than 404 so the UI can poll before a conversation is started.
        try {
          await dependencies.sessions.requireSession({ identityContext: identity, sessionId });
        } catch (error) {
          if (error instanceof AgentError && error.code === 'SESSION_NOT_FOUND') {
            return { tasks: [] };
          }
          throw error;
        }
        const tasks = await dependencies.backgroundTasks.list(sessionId);
        return { tasks: tasks.map(projectBackgroundTaskListItem) };
      },
    );
  }

  if (shouldRegister('sessions/:sessionId/background-tasks/:taskId/output')) {
    instance.get(
      route('sessions/:sessionId/background-tasks/:taskId/output'),
      {
        schema: {
          params: backgroundTaskParams,
          querystring: backgroundTaskOutputQuery,
          response: { 200: backgroundTaskOutputResponse, ...commonErrorResponses },
        },
      },
      async (request, reply) => {
        if (dependencies.backgroundTasks === undefined) {
          // No background task service => the task cannot exist. Degrade to 404
          // (not 503) so callers treat it as "not found" instead of a service
          // outage. Unreachable in practice when the list endpoint already
          // returns empty, but kept defensive.
          return reply.status(404).send(safeError('BACKGROUND_TASK_OUTPUT_UNAVAILABLE', 'Background task output is unavailable.'));
        }
        const identity = dependencies.identityResolver(request);
        const params = request.params as { sessionId: string; taskId: string };
        const sessionId = brand<string, 'SessionId'>(params.sessionId);
        await dependencies.sessions.requireSession({ identityContext: identity, sessionId });
        const query = request.query as { stream?: string; limitBytes?: string };
        const stream: 'stdout' | 'stderr' = query.stream === 'stderr' ? 'stderr' : 'stdout';
        const limitBytes = clampLimitBytes(query.limitBytes);
        const result = await dependencies.backgroundTasks.readOutput(sessionId, params.taskId, stream, limitBytes);
        if ('unavailable' in result) {
          return reply.status(404).send(safeError('BACKGROUND_TASK_OUTPUT_UNAVAILABLE', 'Background task output is unavailable.'));
        }
        return { content: result.content, truncated: result.truncated, stream };
      },
    );
  }

  if (shouldRegister('sessions/:sessionId/background-tasks/:taskId/kill')) {
    instance.post(
      route('sessions/:sessionId/background-tasks/:taskId/kill'),
      {
        config: { opLog: { prefix: 'BackgroundTaskController.killTask', level: 'MINOR' as const, detailParams: ['params.taskId'] } },
        schema: { params: backgroundTaskParams, response: { 200: backgroundTaskKillResponse, ...commonErrorResponses } },
      },
      async (request, reply) => {
        if (dependencies.backgroundTasks === undefined) {
          // No background task service => the task cannot exist. Degrade to 404
          // (not 503) rather than surfacing a service-outage error.
          return reply.status(404).send(safeError('BACKGROUND_TASK_NOT_FOUND', 'Background task is unavailable.'));
        }
        const identity = dependencies.identityResolver(request);
        (request as any).opLogIdentity = identity;
        const params = request.params as { sessionId: string; taskId: string };
        const sessionId = brand<string, 'SessionId'>(params.sessionId);
        await dependencies.sessions.requireSession({ identityContext: identity, sessionId });
        const result = await dependencies.backgroundTasks.kill(sessionId, params.taskId);
        return { status: result.status };
      },
    );
  }

  if (shouldRegister('sessions/:sessionId/shares')) {
    instance.post(
      route('sessions/:sessionId/shares'),
      {
        config: { opLog: { prefix: 'ShareController.createShare', level: 'MINOR' as const, detailParams: ['params.sessionId'] } },
        schema: { params: sessionParams, body: createShareBody, response: { 200: shareCreateResponse, ...commonErrorResponses } },
      },
      async (request, reply) => {
        if (dependencies.shares === undefined) {
          return reply.status(503).send({ error: { code: 'SHARES_UNAVAILABLE', message: 'Shares service is unavailable.' } });
        }
        const identity = dependencies.identityResolver(request);
        (request as any).opLogIdentity = identity;
        const params = request.params as { sessionId: string };
        const sessionId = brand<string, 'SessionId'>(params.sessionId);
        const session = await dependencies.sessions.requireSession({ identityContext: identity, sessionId });
        const body = request.body as {
          runIds: string[];
          originUrl: string;
          expiresIn: '24h' | '7d' | '30d' | 'permanent';
          allowedOps: string[] | null;
        };
        const sanitizedAllowedOps = body.allowedOps === null ? null : body.allowedOps.filter((op) => op.length > 0);
        const result = await dependencies.shares.createShare({
          identityContext: identity,
          agentId: session.agentId,
          sessionId,
          runIds: body.runIds.map((id) => brand<string, 'RequestRunId'>(id)),
          originUrl: body.originUrl,
          expiresIn: body.expiresIn,
          allowedOps: sanitizedAllowedOps,
          idempotencyKey: createIdempotencyKey(dependencies),
        });
        return { shareId: result.shareId, shareUrl: result.shareUrl };
      },
    );
  }

  if (shouldRegister('shares/:shareId/conversation')) {
    instance.get(
      route('shares/:shareId/conversation'),
      { schema: { params: shareParams, response: { 200: sharedConversationResponse, ...commonErrorResponses } } },
      async (request, reply) => {
        if (dependencies.shares === undefined) {
          return reply.status(503).send({ error: { code: 'SHARES_UNAVAILABLE', message: 'Shares service is unavailable.' } });
        }
        const params = request.params as { shareId: string };
        const viewerOpsHeader = request.headers['x-viewer-ops'];
        let viewerOps: readonly string[] | null = null;
        if (typeof viewerOpsHeader === 'string') {
          try {
            const parsed = JSON.parse(viewerOpsHeader);
            if (Array.isArray(parsed) && parsed.every((v) => typeof v === 'string')) {
              viewerOps = parsed as string[];
            }
          } catch {
            // Invalid JSON header, treat as no ops
          }
        }
        const result = await dependencies.shares.loadSharedConversation({ shareId: params.shareId, viewerOps });
        if (isShareSafeError(result)) {
          const status = shareErrorStatus(result.code);
          return reply.status(status).send({ error: { code: result.code, message: result.message } });
        }
        const sharedResult = projectSharedConversation(result);
        // Watermark: transform ASSISTANT messages with content > 500 chars
        if (dependencies.watermark !== undefined && dependencies.getWatermarkEnabled?.() === true) {
          const watermarkAbort = new AbortController();
          const abortWatermark = () => watermarkAbort.abort();
          request.raw.on('aborted', abortWatermark);
          reply.raw.on('close', abortWatermark);
          try {
            const watermarkedMessages = await transformMessageContentWatermark(
              sharedResult.messages ?? [],
              dependencies.watermark,
              logger,
              'shared-conversation',
              watermarkAbort.signal,
            );
            return { ...sharedResult, messages: watermarkedMessages };
          } finally {
            request.raw.off('aborted', abortWatermark);
            reply.raw.off('close', abortWatermark);
          }
        }
        return sharedResult;
      },
    );
  }
}

function referencedProcessMessageId(event: RunTimelineEvent): unknown {
  return isTerminalTimelineEvent(event) ? event.inlinePayload.terminalMessageId : event.inlinePayload.messageId;
}

function isTerminalTimelineEvent(event: RunTimelineEvent): boolean {
  return (
    event.type === 'REQUEST_COMPLETED' || event.type === 'REQUEST_FAILED' || event.type === 'REQUEST_CANCELED' || event.type === 'REQUEST_SUPERSEDED'
  );
}

async function* validateSessionActivityMessages(
  messages: ReturnType<RuntimeSessionActivityPort['streamSessionActivities']>,
): AsyncIterable<SessionActivityWireMessage> {
  for await (const message of messages) {
    if (!Value.Check(sessionActivityMessageSchema, message)) {
      throw new AgentError({
        code: 'SESSION_ACTIVITY_PROJECTION_INVALID',
        message: 'Session activity projection is unavailable.',
        category: 'VALIDATION',
        retryable: true,
      });
    }
    yield message;
  }
}

function withIncomingTrace<T>(dependencies: WebChannelDependencies, request: FastifyRequest, operation: () => Promise<T>): Promise<T> {
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

function extractRequestHeaders(request: FastifyRequest): JsonObject {
  // x-user-id: prefer x-user-id, fall back to x-subject-id (channel identity header)
  const xUserId = singleHeader(request.headers['x-user-id']) ?? singleHeader(request.headers['x-subject-id']) ?? '';
  // x-user-name: prefer x-user-name, fall back to x-display-name (channel identity header)
  const xUserName = singleHeader(request.headers['x-user-name']) ?? singleHeader(request.headers['x-display-name']) ?? '';
  // sessionId: prefer bspsession cookie (overridable via APP_SESSION_ID_NAME env),
  // then accessSession (case-insensitive, matching Java equalsIgnoreCase).
  // Filter out the sentinel value 'deleted' (matching Java logic).
  const cookies = parseCookies(singleHeader(request.headers.cookie));
  const sessionIdKey = process.env.APP_SESSION_ID_NAME ?? 'bspsession';
  let sessionId = cookies[sessionIdKey];
  if (sessionId === undefined) {
    sessionId = findCookieCaseInsensitive(cookies, 'accessSession');
  }
  if (sessionId === 'deleted') {
    sessionId = undefined;
  }
  const terminalIP =
    singleHeader(request.headers['x-real-client-addr']) ?? singleHeader(request.headers['x-forwarded-for'])?.split(',')[0]?.trim() ?? request.ip;
  return {
    'x-user-id': xUserId,
    'x-user-name': xUserName,
    ...(sessionId !== undefined ? { sessionId } : {}),
    conversationId: singleHeader(request.headers['conversationid']) ?? '',
    chatId: singleHeader(request.headers['chatid']) ?? '',
    'x-real-client-addr': terminalIP,
  };
}

function parseCookies(cookieHeader?: string): Record<string, string> {
  const result: Record<string, string> = {};
  if (cookieHeader === undefined) {
    return result;
  }
  for (const part of cookieHeader.split(';')) {
    const eqIndex = part.indexOf('=');
    if (eqIndex <= 0) {
      continue;
    }
    const name = part.slice(0, eqIndex).trim();
    const value = part.slice(eqIndex + 1).trim();
    if (name.length > 0) {
      result[name] = value;
    }
  }
  return result;
}

function findCookieCaseInsensitive(cookies: Record<string, string>, name: string): string | undefined {
  const target = name.toLowerCase();
  for (const [key, value] of Object.entries(cookies)) {
    if (key.toLowerCase() === target) {
      return value;
    }
  }
  return undefined;
}

function isFastifyValidationError(error: unknown): boolean {
  return error !== null && typeof error === 'object' && Array.isArray((error as { readonly validation?: unknown }).validation);
}

type FastifyValidationError = Error & {
  readonly validation: ReadonlyArray<{ readonly instancePath?: string; readonly keyword?: string; readonly params?: Record<string, unknown> }>;
};

function formatFastifyValidationError(error: FastifyValidationError): string {
  const first = error.validation[0];
  if (!first) {
    return 'Request validation failed.';
  }
  // Use only the first path segment as the field name so array-item errors
  // surface as the owning field (e.g. instancePath "/runIds/0" -> "runIds")
  // rather than leaking the array index ("runIds.0"). A missing top-level body
  // property yields instancePath "" -> "body", but the `required` branch below
  // prefers params.missingProperty when present.
  const field = first.instancePath?.split('/')[1] || 'body';
  switch (first.keyword) {
    case 'required':
      // AJV reports a missing top-level body property with instancePath "" and
      // params.missingProperty = "<name>". Prefer the missing property name so
      // the message is "<field> is required." rather than the "body" fallback.
      return `${first.params?.missingProperty ?? field} is required.`;
    case 'minLength':
      return `${field} must not be empty.`;
    case 'maxLength':
      return `${field} must not exceed ${first.params?.limit} characters.`;
    case 'pattern':
      return `${field} format is invalid.`;
    case 'enum':
    case 'const':
    case 'anyOf':
    case 'oneOf':
      return `${field} value is not allowed.`;
    case 'type':
      return `${field} format is invalid.`;
    case 'minimum':
      return `${field} must be at least ${first.params?.minimum}.`;
    case 'maximum':
      return `${field} must not exceed ${first.params?.maximum}.`;
    case 'additionalProperties':
      return `Field '${first.params?.additionalProperty}' is not allowed.`;
    case 'minItems':
      return `${field} must contain at least ${first.params?.limit} item(s).`;
    case 'maxItems':
      return `${field} must not exceed ${first.params?.limit} items.`;
    default:
      return `${field} validation failed.`;
  }
}

type RuntimeReservedSubmit = Awaited<ReturnType<NonNullable<RuntimeCommandPort['reserveSubmit']>>>;

function isMultipartRequest(request: FastifyRequest): boolean {
  const contentType = request.headers['content-type'];
  return typeof contentType === 'string' && contentType.toLowerCase().startsWith('multipart/form-data');
}

function requireJsonBody(body: unknown, schema: TSchema): unknown {
  if (!Value.Check(schema, body)) {
    throw new AgentError({
      code: 'REQUEST_VALIDATION_FAILED',
      message: formatTypeBoxErrors([...Value.Errors(schema, body)]),
      category: 'VALIDATION',
      retryable: false,
    });
  }
  return body;
}

function formatTypeBoxErrors(errors: readonly ValueError[]): string {
  const first = errors[0];
  if (!first) {
    return 'Request validation failed.';
  }
  const field = first.path?.replace(/^\//, '').replace(/\//g, '.') || 'body';
  switch (first.type) {
    case ValueErrorType.ObjectRequiredProperty:
      return `${field} is required.`;
    case ValueErrorType.StringMinLength:
      return `${field} must not be empty.`;
    case ValueErrorType.StringMaxLength:
      return `${field} must not exceed ${first.schema?.maxLength} characters.`;
    case ValueErrorType.StringPattern:
      return `${field} format is invalid.`;
    case ValueErrorType.Union:
      return `${field} value is not allowed.`;
    case ValueErrorType.NumberMinimum:
      return `${field} must be at least ${first.schema?.minimum}.`;
    case ValueErrorType.NumberMaximum:
      return `${field} must not exceed ${first.schema?.maximum}.`;
    case ValueErrorType.ObjectAdditionalProperties:
      if (field === 'routingConstraints.targetSkill' || field === 'routingConstraints.targetRecipe') {
        return 'Field is not allowed.';
      }
      return `Field '${first.path?.split('/').pop()}' is not allowed.`;
    case ValueErrorType.ArrayMinItems:
      return `${field} must contain at least ${first.schema?.minItems} item(s).`;
    case ValueErrorType.ArrayMaxItems:
      return `${field} must not exceed ${first.schema?.maxItems} items.`;
    default:
      return `${field} validation failed.`;
  }
}

async function submitStagedRequest(
  dependencies: WebChannelDependencies,
  request: {
    readonly identity: IdentityContext;
    readonly session: { readonly sessionId: SessionId; readonly agentId: AgentId };
    readonly inputText: string;
    readonly attachments: ReadonlyArray<{ readonly tempRunId: string; readonly fileName: string }>;
    readonly locale?: string;
    readonly routingConstraints?: import('@nextagent/agent-contracts/runtime').RoutingConstraints;
    readonly modelOptions?: import('@nextagent/agent-contracts/runtime').RequestModelOptions;
    readonly idempotencyKey: string;
    readonly requestHeaders?: JsonObject;
  },
): Promise<unknown> {
  const locale = brand<string, 'RequestLocale'>(request.locale ?? 'zh-CN');
  const idempotencyKey = brand<string, 'IdempotencyKey'>(request.idempotencyKey);
  if (dependencies.guardrail !== undefined && dependencies.guardrailEnabled) {
    const guardResult = await dependencies.guardrail.checkQuestion({
      questions: [request.inputText],
      ignoreItems: ['topic_limit'],
      locale,
    });
    if (!guardResult.isLegal) {
      // Input guard refused the input. Route through `runtime.submit` with
      // `guardBlockRefusal`: the runtime creates a normal run + persists the
      // user input, then immediately commits a COMPLETED terminal whose
      // assistant content is the refusal message (visible=true so the page
      // renders it, metadata.modelVisibility.excluded=true so context assembly
      // keeps it out of the next round's model context), WITHOUT invoking the
      // model. The run enters requestRunStore, so retry/edit/title all go
      // through the normal run lifecycle. No HTTP 400 — the frontend receives
      // a normal RequestAccepted and streams REQUEST_ACCEPTED → REQUEST_COMPLETED.
      return dependencies.runtime.submit({
        sessionId: request.session.sessionId,
        identityContext: request.identity,
        inputText: request.inputText,
        attachmentIds: [],
        locale,
        ...(request.routingConstraints === undefined ? {} : { routingConstraints: request.routingConstraints }),
        ...(request.modelOptions === undefined ? {} : { requestModelOptions: request.modelOptions }),
        idempotencyKey,
        ...(request.requestHeaders === undefined ? {} : { inputVariables: { requestHeaders: request.requestHeaders } }),
        // Guarantee a non-empty refusal: an empty refusalMessage (guard service
        // returned isLegal=false with no response text) would make commitTerminal
        // trigger the MODEL_FINAL_CONTENT_EMPTY degradation → FAILED, surfacing
        // as a failure to the frontend. Fall back to the localized unavailable
        // message so the round stays COMPLETED.
        guardBlockRefusal: guardResult.refusalMessage.trim().length > 0 ? guardResult.refusalMessage : guardrailServiceUnavailableMessage(locale),
      });
    }
  }
  if (request.attachments.length === 0) {
    return dependencies.runtime.submit({
      sessionId: request.session.sessionId,
      identityContext: request.identity,
      inputText: request.inputText,
      attachmentIds: [],
      locale,
      ...(request.routingConstraints === undefined ? {} : { routingConstraints: request.routingConstraints }),
      ...(request.modelOptions === undefined ? {} : { requestModelOptions: request.modelOptions }),
      idempotencyKey,
      ...(request.requestHeaders === undefined ? {} : { inputVariables: { requestHeaders: request.requestHeaders } }),
    });
  }
  const stagedUploadRuntime = dependencies.stagedUploadRuntime;
  const config = dependencies.chatUploadConfigProvider ? await dependencies.chatUploadConfigProvider.get() : dependencies.chatUploadFileConfig;
  const reserveSubmit = dependencies.runtime.reserveSubmit;
  if (stagedUploadRuntime === undefined || config === undefined || reserveSubmit === undefined) {
    throw new AgentError({
      code: 'ATTACHMENT_STAGING_UNAVAILABLE',
      message: 'Attachment staging is unavailable.',
      category: 'UNAVAILABLE',
      retryable: false,
    });
  }
  const reserved = await reserveSubmit({
    sessionId: request.session.sessionId,
    identityContext: request.identity,
    action: 'SUBMIT_REQUEST',
    inputText: request.inputText,
    locale,
    idempotencyKey,
    attachmentIntakePresent: true,
  });
  const moved = await stagedUploadRuntime.moveToFormal({
    identityContext: request.identity,
    agentId: request.session.agentId,
    sessionId: request.session.sessionId,
    requestId: reserved.requestId,
    runId: reserved.runId,
    attachments: request.attachments,
    config,
  });
  return dependencies.runtime.submit({
    sessionId: request.session.sessionId,
    identityContext: request.identity,
    inputText: request.inputText,
    attachmentIds: moved.attachmentIds,
    locale,
    ...(request.routingConstraints === undefined ? {} : { routingConstraints: request.routingConstraints }),
    ...(request.modelOptions === undefined ? {} : { requestModelOptions: request.modelOptions }),
    idempotencyKey,
    reservedRequest: toReservedRequest(reserved),
    ...(request.requestHeaders === undefined ? {} : { inputVariables: { requestHeaders: request.requestHeaders } }),
  });
}

function toReservedRequest(reserved: RuntimeReservedSubmit): {
  readonly reservationId: AttachmentIntakeReservationId;
  readonly requestId: MessageId;
  readonly runId: RequestRunId;
  readonly requestContextId: RequestContextId;
} {
  return {
    reservationId: reserved.reservationId,
    requestId: reserved.requestId,
    runId: reserved.runId,
    requestContextId: reserved.requestContextId,
  };
}

interface MultipartFileUploadInput {
  readonly tempRunId: string;
  readonly fileName: string;
  readonly fileStream: NodeJS.ReadableStream;
}

async function parseMultipartFileUpload(request: FastifyRequest): Promise<MultipartFileUploadInput> {
  const file = await request.file({
    limits: { fields: 1, files: 1, parts: 2, fieldSize: 128, fileSize: 500 * 1024 * 1024 },
  });
  if (file === undefined || file.fieldname !== 'file' || file.filename.length === 0) {
    throw new AgentError({
      code: 'REQUEST_VALIDATION_FAILED',
      message: 'Multipart file upload requires one file field.',
      category: 'VALIDATION',
      retryable: false,
    });
  }
  const tempRunId = Array.isArray(file.fields.tempRunId) ? undefined : file.fields.tempRunId;
  if (tempRunId?.type !== 'field' || typeof tempRunId.value !== 'string' || tempRunId.value.length === 0) {
    file.file.resume();
    throw new AgentError({
      code: 'REQUEST_VALIDATION_FAILED',
      message: 'Multipart file upload requires one tempRunId field.',
      category: 'VALIDATION',
      retryable: false,
    });
  }
  return { tempRunId: tempRunId.value, fileName: file.filename, fileStream: file.file };
}

async function evaluateHealth(
  request: FastifyRequest,
  evaluate: (signal: AbortSignal) => Promise<WebHealthResponse> | undefined,
  endpoint: 'primary' | 'deep',
): Promise<WebHealthResponse> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  request.raw.on('aborted', abort);
  try {
    return await (evaluate(controller.signal) ?? unavailableHealth(endpoint));
  } finally {
    request.raw.off('aborted', abort);
  }
}

function statusForHealth(response: WebHealthResponse): 200 | 503 {
  return response.status === 'UP' ? 200 : 503;
}

function unavailableHealth(endpoint: 'primary' | 'deep'): WebHealthResponse {
  return {
    status: 'DOWN',
    components: [
      {
        name: 'runtime_authority',
        status: 'DOWN',
        reasonCode: 'HEALTH_EVALUATOR_UNAVAILABLE',
        summary: `${endpoint} health evaluator is unavailable.`,
      },
    ],
    timestamp: Date.now(),
  };
}

function defaultPortalAbilityBootstrapConfig(): PortalAbilityBootstrapConfig {
  return {
    suggestedQuestionsEnabled: true,
    cronTasksEnabled: true,
    longTermMemoryManagementEnabled: true,
    knowledgeImportEnabled: true,
    fullProcessEnabled: true,
  };
}

function projectPortalAbilityBootstrapConfig(config: PortalAbilityBootstrapConfig | undefined): PortalAbilityBootstrapConfig {
  const defaults = defaultPortalAbilityBootstrapConfig();
  return {
    suggestedQuestionsEnabled: config?.suggestedQuestionsEnabled === false ? false : defaults.suggestedQuestionsEnabled,
    cronTasksEnabled: config?.cronTasksEnabled === false ? false : defaults.cronTasksEnabled,
    longTermMemoryManagementEnabled: config?.longTermMemoryManagementEnabled === false ? false : defaults.longTermMemoryManagementEnabled,
    knowledgeImportEnabled: config?.knowledgeImportEnabled === false ? false : defaults.knowledgeImportEnabled,
    fullProcessEnabled: config?.fullProcessEnabled === false ? false : defaults.fullProcessEnabled,
  };
}

function createIdempotencyKey(dependencies: WebChannelDependencies): IdempotencyKey {
  return dependencies.idempotencyKeyFactory?.() ?? brand<string, 'IdempotencyKey'>(`idem-${crypto.randomUUID()}`);
}

function projectRuntimeBootstrap(config: WebRuntimeBootstrapConfig): WebRuntimeBootstrapConfig {
  const transportKind = config.transportKind;
  if (!isWebTransportKind(transportKind)) {
    throw new AgentError({
      code: 'WEB_RUNTIME_BOOTSTRAP_TRANSPORT_INVALID',
      message: 'Web runtime bootstrap transport is invalid.',
      category: 'VALIDATION',
      retryable: false,
    });
  }
  return {
    transportKind,
    ...(config.chatUploadFileConfig === undefined ? {} : { chatUploadFileConfig: config.chatUploadFileConfig }),
    portalAbilityConfig: projectPortalAbilityBootstrapConfig(config.portalAbilityConfig),
    ...(config.guardrail === undefined ? {} : { guardrail: config.guardrail }),
  };
}

type RuntimeSession = Awaited<ReturnType<RuntimeSessionPort['createSession']>>;
type RuntimeSessionPage = Awaited<ReturnType<RuntimeSessionPort['listSessions']>>;
type RuntimeMessagePage = Awaited<ReturnType<RuntimeSessionPort['listMessages']>>;
type RuntimeConversationPreviewPage = Awaited<ReturnType<RuntimeSessionPort['listConversationPreview']>>;

interface SessionListRawQuery {
  readonly q?: string;
  readonly createdFrom?: string;
  readonly createdTo?: string;
  readonly offset?: string;
  readonly limit?: string;
}

interface ConversationRawQuery {
  readonly cursor?: string;
  readonly newerCursor?: string;
  readonly anchorMessageId?: string;
  readonly includeCapabilityResults?: string;
  readonly limit?: string;
}

interface ConversationPreviewRawQuery {
  readonly offset?: string;
  readonly limit?: string;
}

interface CronTaskExecutionRawQuery {
  readonly offset?: string;
  readonly limit?: string;
}

interface CronTaskPageRawQuery {
  readonly offset?: string;
  readonly limit?: string;
}

const SESSION_LIST_DEFAULT_LIMIT = 50;
const SESSION_SEARCH_DEFAULT_LIMIT = 20;
const SESSION_SEARCH_MAX_LIMIT = 50;
const CRON_TASK_EXECUTION_DEFAULT_LIMIT = 50;
const CRON_TASK_EXECUTION_MAX_LIMIT = 50;
const CRON_TASK_LIST_DEFAULT_LIMIT = 50;
const CRON_TASK_LIST_MAX_LIMIT = 50;
const SESSION_LIST_MAX_LIMIT = 200;
const MAX_FAVORITES_LIMIT = 100;
const MAX_FAVORITES_OFFSET = 10000;
const MAX_CONVERSATION_LIMIT = 200;
const MAX_SESSION_CREATED_RANGE_MS = 90 * 24 * 60 * 60 * 1000 - 1;
const MAX_CONVERSATION_PREVIEW_LIMIT = 100;
const MAX_CONVERSATION_PREVIEW_OFFSET = 10000;

function projectSession(session: RuntimeSession): { sessionId: SessionId; displayTitle: string; lastActivityAt: number } {
  return { sessionId: session.sessionId, displayTitle: safeTitle(session.title), lastActivityAt: session.updatedAt };
}

function projectSessionListEntry(session: RuntimeSession): {
  sessionId: SessionId;
  displayTitle: string;
  lastActivityAt: number;
  lastRunStatus?: RunStatus;
  hasInFlightRequest: boolean;
} {
  return {
    ...projectSession(session),
    ...(session.latestRunStatus === undefined ? {} : { lastRunStatus: projectRunStatus(session.latestRunStatus) }),
    hasInFlightRequest: session.hasInFlightRequest,
  };
}

function projectSessionPage(page: RuntimeSessionPage): {
  entries: Array<ReturnType<typeof projectSessionListEntry>>;
  offset: number;
  limit: number;
  hasMore: boolean;
} {
  return {
    entries: page.entries.map(projectSessionListEntry),
    offset: page.offset,
    limit: page.limit,
    hasMore: page.hasMore,
  };
}

function extractAttachmentIdsFromMetadata(metadata?: Record<string, unknown> | null): readonly string[] {
  if (metadata === null || metadata === undefined) {
    return [];
  }
  const value = metadata['attachmentIds'];
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is string => typeof item === 'string' && item.length > 0);
}

async function resolveAttachmentSummaries(
  resolver: AttachmentSummaryResolver,
  identity: IdentityContext,
  agentId: string,
  attachmentIds: readonly string[],
): Promise<ReadonlyArray<{ readonly fileName: string; readonly mediaType: string; readonly sizeBytes: number }>> {
  const results = await Promise.all(
    attachmentIds.map(async (attachmentId) => {
      try {
        const record = await resolver.loadAttachment({
          tenantId: identity.tenantId,
          subjectId: identity.subjectId,
          agentId: brand(agentId),
          attachmentId: brand(attachmentId),
        });
        if (record === undefined) {
          return undefined;
        }
        return { fileName: record.fileName, mediaType: record.mediaType, sizeBytes: record.sizeBytes };
      } catch {
        return undefined;
      }
    }),
  );
  return results.filter((r): r is { readonly fileName: string; readonly mediaType: string; readonly sizeBytes: number } => r !== undefined);
}

type ProjectedConversationItem = RuntimeMessagePage['items'][number] & {
  readonly pendingInputAnswer?: JsonObject;
};

function projectConversation(
  page: RuntimeMessagePage,
  activeRun?: RuntimeActiveRunSummary,
): {
  items: readonly ProjectedConversationItem[];
  nextCursor?: string;
  newerCursor?: string;
  activeRun?: RuntimeActiveRunSummary;
  forkNotice?: RuntimeMessagePage['forkNotice'];
} {
  return {
    items: page.items.map(projectConversationItem),
    ...(activeRun === undefined ? {} : { activeRun }),
    ...(page.nextBeforeCursor === undefined ? {} : { nextCursor: page.nextBeforeCursor }),
    ...(page.newerCursor === undefined ? {} : { newerCursor: page.newerCursor }),
    ...(page.forkNotice === undefined ? {} : { forkNotice: page.forkNotice }),
  };
}

function projectConversationItem(item: RuntimeMessagePage['items'][number]): ProjectedConversationItem {
  const publicItem = {
    ...item,
    ...(item.role === 'CAPABILITY_RESULT' ? { content: '' } : {}),
    rootMessageId: item.requestId,
    metadata: projectPublicMessageMetadata(item),
  };
  if (item.role !== 'CAPABILITY_RESULT') {
    return publicItem;
  }
  const metadataKind = readNonEmptyString(item.metadata?.['kind']);
  const metadataToolCallId = readNonEmptyString(item.metadata?.['toolCallId']);
  const metadataToolName = readNonEmptyString(item.metadata?.['toolName']);
  if (metadataKind !== 'CAPABILITY_RESULT' || metadataToolName !== 'AskUserQuestion' || metadataToolCallId === undefined) {
    return publicItem;
  }
  const parsed = parseJsonObject(item.content);
  const payload = readJsonObject(parsed?.['payload']);
  const toolCallId = readNonEmptyString(parsed?.['toolCallId']);
  const toolName = readNonEmptyString(parsed?.['toolName']);
  if (payload === undefined || toolCallId !== metadataToolCallId || toolName !== metadataToolName) {
    return publicItem;
  }
  const pendingInputAnswer = projectAskUserQuestionAnswerResult({
    ...payload,
    capabilityId: metadataToolName,
    toolCallId: metadataToolCallId,
  });
  return pendingInputAnswer === undefined ? publicItem : { ...publicItem, pendingInputAnswer };
}

function projectPublicMessageMetadata(item: {
  readonly role: string;
  readonly metadata: RuntimeMessagePage['items'][number]['metadata'];
}): RuntimeMessagePage['items'][number]['metadata'] {
  if (item.role === 'CAPABILITY_RESULT') {
    const kind = readNonEmptyString(item.metadata?.['kind']);
    const toolCallId = readNonEmptyString(item.metadata?.['toolCallId']);
    const toolName = readNonEmptyString(item.metadata?.['toolName']);
    return {
      ...(kind === 'CAPABILITY_RESULT' ? { kind } : {}),
      ...(toolCallId === undefined ? {} : { toolCallId }),
      ...(toolName === undefined ? {} : { toolName }),
    };
  }
  const projected = { ...item.metadata };
  delete projected['routingConstraints'];
  return projected;
}

function parseJsonObject(value: string): JsonObject | undefined {
  try {
    return readJsonObject(JSON.parse(value) as unknown);
  } catch {
    return undefined;
  }
}

function readJsonObject(value: unknown): JsonObject | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as JsonObject) : undefined;
}

function readNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function projectConversationPreview(page: RuntimeConversationPreviewPage): RuntimeConversationPreviewPage {
  return {
    sessionId: page.sessionId,
    totalMarkers: page.totalMarkers,
    offset: page.offset,
    limit: page.limit,
    markers: page.markers,
  };
}

function safeTitle(title?: string): string {
  const trimmed = title?.trim();
  return trimmed === undefined || trimmed.length === 0 ? 'Untitled session' : trimmed;
}

function projectAnnotation(view: ConversationAnnotationView) {
  return {
    annotationId: view.annotationId,
    sessionId: view.sessionId,
    requestRunId: view.requestRunId,
    sentiment: view.sentiment,
    isFavorited: view.isFavorited,
    isQuestionFavorited: view.isQuestionFavorited,
    createdAt: view.createdAt,
  };
}

function projectAnnotationListItem(view: ConversationAnnotationView) {
  return {
    annotationId: view.annotationId,
    requestRunId: view.requestRunId,
    sentiment: view.sentiment,
    isFavorited: view.isFavorited,
    isQuestionFavorited: view.isQuestionFavorited,
    createdAt: view.createdAt,
  };
}

function projectBackgroundTaskListItem(record: BackgroundTaskView) {
  return {
    taskId: record.taskId,
    commandName: record.commandName,
    ...(record.commandLine === undefined ? {} : { commandLine: record.commandLine }),
    status: record.status,
    startedAt: record.startedAt,
    ...(record.finishedAt === undefined ? {} : { finishedAt: record.finishedAt }),
    ...(record.exitCode === undefined ? {} : { exitCode: record.exitCode }),
    stdoutRef: record.stdoutRef,
    stderrRef: record.stderrRef,
  };
}

function projectCronTaskManagement(record: CronTaskManagementView) {
  return {
    taskId: record.taskId,
    cron: record.cron,
    humanSchedule: record.humanSchedule,
    prompt: record.prompt,
    ...(record.target === undefined ? {} : { target: record.target }),
    recurring: record.recurring,
    status: record.status,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    nextRunAt: record.nextRunAt,
    createdByName: record.createdByName ?? null,
  };
}

function projectCronTaskExecution(record: CronTaskExecutionView) {
  return {
    triggerId: record.triggerId,
    taskId: record.taskId,
    scheduledAt: record.scheduledAt,
    triggerStatus: record.triggerStatus,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    ...(record.sessionId === undefined ? {} : { sessionId: record.sessionId }),
    ...(record.requestRunId === undefined ? {} : { requestRunId: record.requestRunId }),
    ...(record.runStatus === undefined ? {} : { runStatus: record.runStatus }),
    ...(record.terminalCommitState === undefined ? {} : { terminalCommitState: record.terminalCommitState }),
    ...(record.resultEventType === undefined ? {} : { resultEventType: record.resultEventType }),
    ...(record.resultContent === undefined ? {} : { resultContent: record.resultContent }),
    ...(record.resultAt === undefined ? {} : { resultAt: record.resultAt }),
  };
}

function requireCronTaskManagement(dependencies: WebChannelDependencies): CronTaskManagementPort {
  if (dependencies.cronTaskManagement === undefined) {
    throw new AgentError({
      code: 'CRON_TASKS_UNAVAILABLE',
      message: 'Cron task management service is unavailable.',
      category: 'UNAVAILABLE',
      retryable: true,
    });
  }
  return dependencies.cronTaskManagement;
}

function assertNoCronTaskManagementQuery(rawUrl: string): void {
  if (rawUrl.includes('?')) {
    throwValidation('Cron task management routes do not accept query parameters.');
  }
}

async function assertCapabilityPresentationResourcesQueryOnly(request: FastifyRequest): Promise<void> {
  const contentLength = Number(request.headers['content-length'] ?? 0);
  const hasBody =
    (Number.isFinite(contentLength) && contentLength > 0) ||
    request.headers['transfer-encoding'] !== undefined ||
    (request.body !== undefined && request.body !== null);
  if ((request.raw.url ?? '').includes('?') || hasBody) {
    throwValidation('Capability presentation resources do not accept query parameters or a request body.');
  }
}

async function assertCronTaskManagementQueryOnly(request: FastifyRequest): Promise<void> {
  assertNoCronTaskManagementQuery(request.raw.url ?? '');
}

async function assertCronTaskPageQueryOnly(request: FastifyRequest): Promise<void> {
  const rawUrl = request.raw.url ?? '';
  const queryStart = rawUrl.indexOf('?');
  if (queryStart < 0) {
    return;
  }
  const search = new URLSearchParams(rawUrl.slice(queryStart + 1));
  for (const key of search.keys()) {
    if (key !== 'offset' && key !== 'limit') {
      throwValidation('Cron task management query contains unsupported fields.');
    }
  }
}

async function assertCronTaskManagementCreateRequest(request: FastifyRequest): Promise<void> {
  assertNoCronTaskManagementQuery(request.raw.url ?? '');
  assertAllowedCronTaskManagementBody(request.body, ['cron', 'prompt', 'target', 'recurring']);
}

async function assertCronTaskManagementUpdateRequest(request: FastifyRequest): Promise<void> {
  assertNoCronTaskManagementQuery(request.raw.url ?? '');
  assertAllowedCronTaskManagementBody(request.body, ['cron', 'prompt', 'target', 'recurring']);
}

async function assertCronTaskExecutionRequest(request: FastifyRequest): Promise<void> {
  assertNoCronTaskManagementQuery(request.raw.url ?? '');
  if (request.body !== undefined && request.body !== null) {
    throwValidation('Cron task execution request must not include a body.');
  }
}

function assertAllowedCronTaskManagementBody(body: unknown, allowed: readonly string[]): void {
  if (!isPlainObject(body)) {
    throwValidation('Cron task management body must be an object.');
  }
  for (const key of Object.keys(body)) {
    if (!allowed.includes(key)) {
      throwValidation('Cron task management body contains unsupported fields.');
    }
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function projectFavoriteTurnPage(page: ConversationFavoriteTurnPage) {
  return {
    entries: page.entries.map((entry) => ({
      sessionId: entry.sessionId,
      requestRunId: entry.requestRunId,
      rootMessageId: entry.rootMessageId,
      questionPreview: entry.questionPreview,
      questionTruncated: entry.questionTruncated,
      ...(entry.sessionTitle === undefined ? {} : { sessionTitle: entry.sessionTitle }),
      sessionUpdatedAt: entry.sessionUpdatedAt,
      favoritedAt: entry.favoritedAt,
    })),
    offset: page.offset,
    limit: page.limit,
    hasMore: page.hasMore,
  };
}

function parseOptionalFavoriteTimestamp(value?: string): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throwValidation('Favorite time must be a non-negative safe integer.');
  }
  return parsed;
}

function filterFavoriteTurnPage(
  page: ConversationFavoriteTurnPage,
  filter: {
    readonly offset: number;
    readonly limit: number;
    readonly keyword?: string;
    readonly favoritedFrom?: number;
    readonly favoritedTo?: number;
  },
): ConversationFavoriteTurnPage {
  const normalizedKeyword = filter.keyword?.toLowerCase();
  const entries = page.entries.filter((entry) => {
    if (normalizedKeyword && !`${entry.sessionTitle ?? ''}\n${entry.questionPreview}`.toLowerCase().includes(normalizedKeyword)) {
      return false;
    }
    if (filter.favoritedFrom !== undefined && entry.favoritedAt < filter.favoritedFrom) {
      return false;
    }
    if (filter.favoritedTo !== undefined && entry.favoritedAt > filter.favoritedTo) {
      return false;
    }
    return true;
  });
  return {
    entries: entries.slice(filter.offset, filter.offset + filter.limit),
    offset: filter.offset,
    limit: filter.limit,
    hasMore: filter.offset + filter.limit < entries.length,
  };
}

const BACKGROUND_TASK_OUTPUT_DEFAULT_LIMIT_BYTES = 65_536;
const BACKGROUND_TASK_OUTPUT_MAX_LIMIT_BYTES = 262_144;

/**
 * Clamp the requested output byte limit to the allowed range. Undefined or
 * non-finite values fall back to the default; values above the hard cap are
 * clamped down. The lower bound is 1 byte.
 */
function clampLimitBytes(value?: string): number {
  const parsed = value === undefined ? BACKGROUND_TASK_OUTPUT_DEFAULT_LIMIT_BYTES : Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) {
    return BACKGROUND_TASK_OUTPUT_DEFAULT_LIMIT_BYTES;
  }
  return Math.max(1, Math.min(parsed, BACKGROUND_TASK_OUTPUT_MAX_LIMIT_BYTES));
}

async function withAbortableRequest<TResult>(
  request: FastifyRequest,
  reply: FastifyReply,
  work: (signal: AbortSignal) => Promise<TResult>,
): Promise<TResult> {
  const controller = new AbortController();
  const abortRequest = () => controller.abort();
  request.raw.on('aborted', abortRequest);
  reply.raw.on('close', abortRequest);
  try {
    return await work(controller.signal);
  } finally {
    request.raw.off('aborted', abortRequest);
    reply.raw.off('close', abortRequest);
  }
}

function normalizeSessionForkRouteError(error: unknown): unknown {
  if (!(error instanceof AgentError)) {
    return error;
  }
  return new AgentError({
    code: error.code,
    message: 'Session fork failed.',
    category: error.category,
    retryable: error.retryable,
  });
}

async function withUnavailableFallback<TResult>(
  request: FastifyRequest,
  reply: FastifyReply,
  error: { readonly code: string; readonly message: string },
  work: (signal: AbortSignal) => Promise<TResult>,
): Promise<TResult | FastifyReply> {
  try {
    return await withAbortableRequest(request, reply, work);
  } catch {
    return reply.status(503).send({ error });
  }
}

function isShareSafeError(value: unknown): value is SafeError {
  return typeof value === 'object' && value !== null && 'code' in value && 'category' in value && 'retryable' in value;
}

function shareErrorStatus(code: string): number {
  switch (code) {
    case 'SHARE_NOT_FOUND':
    case 'SHARE_CONTENT_DELETED':
      return 404;
    case 'SHARE_EXPIRED':
      return 410;
    case 'SHARE_FORBIDDEN':
      return 403;
    default:
      return 500;
  }
}

function projectSharedConversation(page: SharedConversationPage) {
  return {
    sessionId: page.sessionId,
    messages: page.messages.filter(isPublicSharedConversationMessage).map((msg) => ({
      messageId: msg.messageId,
      sessionId: msg.sessionId,
      requestId: msg.requestId,
      ...(msg.runId === undefined ? {} : { runId: msg.runId }),
      role: msg.role,
      content: msg.content,
      contentType: msg.contentType,
      metadata: projectPublicMessageMetadata(msg),
      ...(msg.attachments === undefined || msg.attachments.length === 0 ? {} : { attachments: msg.attachments }),
      visible: msg.visible,
      createdAt: msg.createdAt,
    })),
    createdAt: page.createdAt,
  };
}

function isPublicSharedConversationMessage(message: SharedConversationPage['messages'][number]): boolean {
  return message.role === 'USER' || (message.role === 'ASSISTANT' && message.metadata['kind'] !== 'ASSISTANT_TOOL_USE');
}

function safeError(code: string, message: string): { readonly error: { readonly code: string; readonly message: string } } {
  return { error: { code, message } };
}

function watermarkFailureReason(reason: unknown): string {
  return reason instanceof Error ? reason.message : 'unknown';
}

/**
 * Watermark transform for ASSISTANT messages with content > 500 chars.
 * Used by conversation and shared-conversation endpoints. Uses Promise.allSettled
 * for parallel fail-open calls. Accepts an AbortSignal for caller-initiated cancellation.
 */
async function transformMessageContentWatermark<T extends { readonly role: string; readonly content: unknown }>(
  messages: readonly T[],
  port: WebWatermarkPort,
  logger: ReturnType<typeof getLogger>,
  endpoint: string,
  signal?: AbortSignal,
): Promise<T[]> {
  const candidates = messages
    .map((msg, idx) => ({ msg, idx }))
    .filter(({ msg }) => msg.role === 'ASSISTANT' && typeof msg.content === 'string' && msg.content.length > 500);
  if (candidates.length === 0) {
    return [...messages];
  }
  const results = await Promise.allSettled(candidates.map(({ msg }) => port.applyWatermark(msg.content as string, signal)));
  const newMessages = [...messages];
  candidates.forEach(({ msg, idx }, i) => {
    const result = results[i];
    if (result !== undefined && result.status === 'fulfilled') {
      newMessages[idx] = { ...msg, content: result.value } as T;
    } else if (result !== undefined && result.status === 'rejected') {
      logger.warn({ event: 'watermark.call.failed', endpoint, reason: watermarkFailureReason(result.reason) });
    }
  });
  return newMessages;
}

/**
 * Watermark transform for history-replay events (events endpoint).
 * Targets REQUEST_COMPLETED and workflow TOOL_STRUCTURED_DELTA (DETAIL/ANSWER+TEXT)
 * with content > 500 chars. Uses Promise.allSettled for parallel fail-open calls.
 */
async function transformEventsWatermark(
  envelopes: readonly StreamEnvelope[],
  port: WebWatermarkPort,
  logger: ReturnType<typeof getLogger>,
  signal?: AbortSignal,
): Promise<StreamEnvelope[]> {
  const candidates = envelopes
    .map((envelope, idx) => ({ envelope, idx }))
    .filter(({ envelope }) => {
      if (envelope.eventType === 'REQUEST_COMPLETED') {
        const payload = envelope.payload as Record<string, unknown>;
        return typeof payload.content === 'string' && payload.content.length > 500;
      }
      if (envelope.eventType === 'TOOL_STRUCTURED_DELTA') {
        const payload = envelope.payload as Record<string, unknown>;
        return (
          typeof payload.content === 'string' &&
          payload.content.length > 500 &&
          (payload.toolEventType === 'DETAIL' || payload.toolEventType === 'ANSWER') &&
          payload.toolMessageType === 'TEXT' &&
          payload.workflowEventType !== undefined
        );
      }
      return false;
    });
  if (candidates.length === 0) {
    return [...envelopes];
  }
  const results = await Promise.allSettled(
    candidates.map(({ envelope }) => {
      const payload = envelope.payload as Record<string, unknown>;
      return port.applyWatermark(payload.content as string, signal);
    }),
  );
  const watermarkedByEventId = new Map<string, string>();
  candidates.forEach(({ envelope }, i) => {
    const result = results[i];
    if (result !== undefined && result.status === 'fulfilled') {
      watermarkedByEventId.set(envelope.eventId, result.value);
    } else if (result !== undefined && result.status === 'rejected') {
      logger.warn({
        event: 'watermark.call.failed',
        endpoint: 'events',
        eventType: envelope.eventType,
        reason: watermarkFailureReason(result.reason),
      });
    }
  });
  return envelopes.map((envelope) => {
    const watermarked = watermarkedByEventId.get(envelope.eventId);
    if (watermarked === undefined) {
      return envelope;
    }
    return { ...envelope, payload: { ...(envelope.payload as Record<string, unknown>), content: watermarked } };
  });
}

function parseSessionListQuery(query: SessionListRawQuery): {
  readonly offset: number;
  readonly limit: number;
  readonly questionSearchText?: string;
  readonly createdAtFrom?: EpochMillis;
  readonly createdAtTo?: EpochMillis;
} {
  const offset = parseStrictInteger(query.offset, 0, 'offset');
  if (offset < 0) {
    throwValidation('offset must be a non-negative integer.');
  }

  const questionSearchText = parseQuestionSearchText(query.q);
  // Treat empty string the same as undefined so that createdTo= (or createdFrom=) does not
  // produce a misleading "must be an integer" error; instead it falls through to the
  // "must be provided together" message when only one side is present.
  const hasCreatedFrom = query.createdFrom !== undefined && query.createdFrom !== '';
  const hasCreatedTo = query.createdTo !== undefined && query.createdTo !== '';
  if (hasCreatedFrom !== hasCreatedTo) {
    throwValidation('createdFrom and createdTo must be provided together.');
  }

  const createdRange = hasCreatedFrom && hasCreatedTo ? parseCreatedRange(query.createdFrom, query.createdTo) : undefined;
  const isSearchQuery = questionSearchText !== undefined || createdRange !== undefined;
  const limit = parsePositiveInteger(query.limit, isSearchQuery ? SESSION_SEARCH_DEFAULT_LIMIT : SESSION_LIST_DEFAULT_LIMIT, 'limit');
  if (isSearchQuery && limit > SESSION_SEARCH_MAX_LIMIT) {
    throwValidation('search limit must not exceed 50.');
  }
  if (!isSearchQuery && limit > SESSION_LIST_MAX_LIMIT) {
    throwValidation(`limit must not exceed ${SESSION_LIST_MAX_LIMIT}.`);
  }

  return {
    offset,
    limit,
    ...(questionSearchText === undefined ? {} : { questionSearchText }),
    ...(createdRange === undefined ? {} : { createdAtFrom: createdRange.from, createdAtTo: createdRange.to }),
  };
}

function parseCronTaskExecutionQuery(query: CronTaskExecutionRawQuery): {
  readonly offset: number;
  readonly limit: number;
} {
  const offset = parseStrictInteger(query.offset, 0, 'offset');
  if (offset < 0) {
    throwValidation('offset must be a non-negative integer.');
  }
  const limit = parsePositiveInteger(query.limit, CRON_TASK_EXECUTION_DEFAULT_LIMIT, 'limit');
  if (limit > CRON_TASK_EXECUTION_MAX_LIMIT) {
    throwValidation(`limit must not exceed ${CRON_TASK_EXECUTION_MAX_LIMIT}.`);
  }
  return { offset, limit };
}

function parseCronTaskPageQuery(query: CronTaskPageRawQuery): {
  readonly offset: number;
  readonly limit: number;
} {
  const offset = parseStrictInteger(query.offset, 0, 'offset');
  if (offset < 0) {
    throwValidation('offset must be a non-negative integer.');
  }
  const limit = parsePositiveInteger(query.limit, CRON_TASK_LIST_DEFAULT_LIMIT, 'limit');
  if (limit > CRON_TASK_LIST_MAX_LIMIT) {
    throwValidation(`limit must not exceed ${CRON_TASK_LIST_MAX_LIMIT}.`);
  }
  return { offset, limit };
}

function parseConversationQuery(query: ConversationRawQuery): {
  readonly includeCapabilityResults: boolean;
  readonly limit: number;
  readonly beforeCursor?: string;
  readonly afterCursor?: string;
  readonly anchorMessageId?: MessageId;
} {
  const modeCount = [query.cursor, query.newerCursor, query.anchorMessageId].filter((value) => value !== undefined).length;
  if (modeCount > 1) {
    throwValidation('conversation cursor, newerCursor and anchorMessageId cannot be combined.');
  }
  const limit = parsePositiveInteger(query.limit, 50, 'limit');
  if (limit > MAX_CONVERSATION_LIMIT) {
    throwValidation(`limit must not exceed ${MAX_CONVERSATION_LIMIT}.`);
  }
  return {
    includeCapabilityResults: query.includeCapabilityResults === 'true',
    limit,
    ...(query.cursor === undefined ? {} : { beforeCursor: query.cursor }),
    ...(query.newerCursor === undefined ? {} : { afterCursor: query.newerCursor }),
    ...(query.anchorMessageId === undefined ? {} : { anchorMessageId: brand<string, 'MessageId'>(query.anchorMessageId) }),
  };
}

function parseConversationPreviewQuery(query: ConversationPreviewRawQuery): {
  readonly offset?: number;
  readonly limit: number;
} {
  // Offset is capped at MAX_CONVERSATION_PREVIEW_OFFSET (10000, 5 digits). Reject longer digit
  // strings up front so an oversized value (e.g. 1e27) gets this field-level range message instead
  // of parseStrictInteger's opaque "finite safe integer" message (Number() overflows MAX_SAFE_INTEGER
  // before the numeric range check below can run). The numeric 0–10000 bound is enforced after parsing.
  if (query.offset !== undefined && query.offset.length > WEB_CONVERSATION_PREVIEW_OFFSET_MAX_LENGTH) {
    throwValidation(`offset must not exceed ${MAX_CONVERSATION_PREVIEW_OFFSET}.`);
  }
  const offset = query.offset === undefined ? undefined : parseStrictInteger(query.offset, undefined, 'offset');
  if (offset !== undefined && offset < 0) {
    throwValidation('offset must be a non-negative integer.');
  }
  if (offset !== undefined && offset > MAX_CONVERSATION_PREVIEW_OFFSET) {
    throwValidation(`offset must not exceed ${MAX_CONVERSATION_PREVIEW_OFFSET}.`);
  }
  const limit = parsePositiveInteger(query.limit, undefined, 'limit');
  if (limit > MAX_CONVERSATION_PREVIEW_LIMIT) {
    throwValidation(`limit must not exceed ${MAX_CONVERSATION_PREVIEW_LIMIT}.`);
  }
  return {
    ...(offset === undefined ? {} : { offset }),
    limit,
  };
}

async function assertConversationPreviewQueryParameters(request: FastifyRequest): Promise<void> {
  const rawUrl = request.raw.url ?? '';
  const queryStart = rawUrl.indexOf('?');
  if (queryStart < 0) {
    return;
  }
  const params = new URLSearchParams(rawUrl.slice(queryStart + 1));
  for (const key of params.keys()) {
    if (key !== 'offset' && key !== 'limit') {
      throwValidation('Conversation preview only supports offset and limit query parameters.');
    }
  }
}

function parseQuestionSearchText(value?: string): string | undefined {
  const trimmed = value?.trim();
  if (trimmed === undefined || trimmed.length === 0) {
    return undefined;
  }
  if (Array.from(trimmed).length > WEB_SESSION_SEARCH_MAX_CODE_POINTS) {
    throwValidation(`session list q must not exceed ${WEB_SESSION_SEARCH_MAX_CODE_POINTS} Unicode code points.`);
  }
  return trimmed;
}

function parseCreatedRange(createdFrom?: string, createdTo?: string): { readonly from: EpochMillis; readonly to: EpochMillis } {
  const from = parseStrictInteger(createdFrom, undefined, 'createdFrom');
  const to = parseStrictInteger(createdTo, undefined, 'createdTo');
  if (from < 0) {
    throwValidation('createdFrom must be a non-negative epoch millisecond.');
  }
  if (to < 0) {
    throwValidation('createdTo must be a non-negative epoch millisecond.');
  }
  if (from > to) {
    throwValidation('createdFrom must be less than or equal to createdTo.');
  }
  if (to - from > MAX_SESSION_CREATED_RANGE_MS) {
    throwValidation('created time range must not exceed 90 days.');
  }
  // Reject timestamps beyond the end of the current day to prevent future/overflow
  // values from reaching the backend memory service (which returns an opaque 400).
  const endOfToday = getEndOfTodayEpochMillis();
  if (to > endOfToday) {
    throwValidation('createdTo must not be later than the end of today.');
  }
  return { from: brand<number, 'EpochMillis'>(from), to: brand<number, 'EpochMillis'>(to) };
}

function parseStrictInteger(value: string | undefined, fallback: number, name: string): number;
function parseStrictInteger(value: string | undefined, fallback: undefined, name: string): number;
function parseStrictInteger(value: string | undefined, fallback: number | undefined, name: string): number {
  if (value === undefined) {
    if (fallback === undefined) {
      throwValidation(`${name} is required.`);
    }
    return fallback;
  }
  if (!/^-?\d+$/u.test(value)) {
    throwValidation(`${name} must be an integer.`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throwValidation(`${name} must be a finite safe integer.`);
  }
  return parsed;
}

function parsePositiveInteger(value: string | undefined, fallback: number, name: string): number;
function parsePositiveInteger(value: string | undefined, fallback: undefined, name: string): number;
function parsePositiveInteger(value: string | undefined, fallback: number | undefined, name: string): number {
  if (value === undefined) {
    if (fallback === undefined) {
      throwValidation(`${name} is required.`);
    }
    return fallback;
  }
  if (!/^\d+$/u.test(value)) {
    throwValidation(`${name} must be a positive integer.`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throwValidation(`${name} must be a positive integer.`);
  }
  return parsed;
}

function throwValidation(message: string): never {
  throw new AgentError({ code: 'REQUEST_VALIDATION_FAILED', message, category: 'VALIDATION', retryable: false });
}

/**
 * Returns the epoch millisecond for the end of the current local day (23:59:59.999).
 * Used as an upper bound for createdTo, consistent with the frontend date picker.
 */
function getEndOfTodayEpochMillis(): number {
  const now = new Date();
  const endOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
  return endOfDay.getTime();
}

function normalizeForkIdempotencyKey(raw: string): IdempotencyKey {
  const trimmed = raw.trim();
  if (trimmed.length === 0 || Array.from(trimmed).length > 128) {
    throwValidation('fork idempotencyKey must be 1-128 characters.');
  }
  return brand<string, 'IdempotencyKey'>(trimmed);
}

function parsePendingInputAnswers(body: unknown): ReadonlyArray<readonly string[]> {
  const answers = typeof body === 'object' && body !== null ? (body as { readonly answers?: unknown }).answers : undefined;
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

function statusFor(error: AgentError): number {
  if (error.code === 'LOCAL_AUTH_REQUIRED') {
    return 401;
  }
  const category = error.category;
  if (category === 'UNAVAILABLE') {
    return 503;
  }
  if (category === 'NOT_FOUND') {
    return 404;
  }
  if (category === 'CONFLICT') {
    return 409;
  }
  if (category === 'AUTHORIZATION') {
    return 403;
  }
  return 400;
}

function isLocalAuthRequiredError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'LOCAL_AUTH_REQUIRED';
}

// Local port interfaces for staged upload and attachment summary.
// These match the structural shapes of AttachmentStagedUploadRuntime and AttachmentStoreGateway
// without importing from agent-attachment-runtime or agent-contracts/gateway (architecture boundary).
export interface StagedUploadPort {
  uploadToTemp: (request: {
    readonly identityContext: IdentityContext;
    readonly agentId: import('@nextagent/agent-common').AgentId;
    readonly sessionId: SessionId;
    readonly tempRunId: string;
    readonly fileName: string;
    readonly config: import('../schemas/runtime-bootstrap.js').ChatUploadFileConfig;
    readonly fileStream: NodeJS.ReadableStream;
    readonly declaredSizeBytes?: number;
  }) => Promise<{ readonly tempRunId: string; readonly fileName: string; readonly sizeBytes: number }>;
  moveToFormal: (request: {
    readonly identityContext: IdentityContext;
    readonly agentId: import('@nextagent/agent-common').AgentId;
    readonly sessionId: SessionId;
    readonly requestId: import('@nextagent/agent-common').MessageId;
    readonly runId: import('@nextagent/agent-common').RequestRunId;
    readonly attachments: ReadonlyArray<{ readonly tempRunId: string; readonly fileName: string }>;
    readonly config: import('../schemas/runtime-bootstrap.js').ChatUploadFileConfig;
  }) => Promise<{
    readonly attachmentIds: ReadonlyArray<import('@nextagent/agent-common').AttachmentId>;
    readonly attachmentRecords: readonly unknown[];
  }>;
  deleteTemp: (request: {
    readonly identityContext: IdentityContext;
    readonly sessionId: SessionId;
    readonly tempRunId: string;
    readonly fileName: string;
  }) => Promise<void>;
}

export interface AttachmentSummaryResolver {
  readonly loadAttachment: (request: {
    readonly tenantId: import('@nextagent/agent-common').TenantId;
    readonly subjectId: import('@nextagent/agent-common').SubjectId;
    readonly agentId: import('@nextagent/agent-common').AgentId;
    readonly attachmentId: import('@nextagent/agent-common').AttachmentId;
  }) => Promise<{ readonly fileName: string; readonly mediaType: string; readonly sizeBytes: number } | undefined>;
}
import type { ChatUploadFileConfig } from '../schemas/runtime-bootstrap.js';

// Local port interface for file download (mirrors StagedUploadPort pattern).
// Structural 鈥?does not import from agent-attachment-runtime or agent-contracts/gateway (architecture boundary).
export interface FileDownloadPort {
  materialize: (request: {
    readonly identityContext: IdentityContext;
    readonly agentId: import('@nextagent/agent-common').AgentId;
    readonly sessionId: string;
    readonly objectName: string;
    readonly downloadId: string;
  }) => Promise<{ readonly localFilePath: string; readonly safeFileName: string; readonly sizeBytes: number }>;
  cleanup: (request: { readonly downloadId: string }) => Promise<void>;
}

const DOWNLOAD_MIME_TYPES: Record<string, string> = {
  csv: 'text/csv',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  pdf: 'application/pdf',
  txt: 'text/plain',
  md: 'text/markdown',
  json: 'application/json',
  xml: 'application/xml',
  zip: 'application/zip',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  html: 'text/html',
};

export function mimeTypeFromExtension(fileName: string): string {
  const dotIndex = fileName.lastIndexOf('.');
  if (dotIndex < 0) {
    return 'application/octet-stream';
  }
  const extension = fileName.slice(dotIndex + 1).toLowerCase();
  return DOWNLOAD_MIME_TYPES[extension] ?? 'application/octet-stream';
}

/**
 * Build a Content-Disposition header value for attachment downloads.
 * Uses RFC 5987 `filename*` for non-ASCII filenames, with ASCII `filename` fallback.
 */
export function contentDispositionAttachment(fileName: string): string {
  const isAscii = /^[\x20-\x7E]*$/.test(fileName);
  if (isAscii) {
    return `attachment; filename="${fileName}"`;
  }
  // RFC 5987: percent-encode the UTF-8 filename for filename*
  const encoded = encodeURIComponent(fileName);
  // ASCII fallback: replace non-ASCII with _
  const asciiFallback = fileName.replace(/[^\x20-\x7E]/g, '_');
  return `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encoded}`;
}

export function validateDownloadObjectName(objectName: string): void {
  if (objectName.includes('\0')) {
    throw new AgentError({ code: 'REQUEST_VALIDATION_FAILED', message: 'Invalid file path.', category: 'VALIDATION', retryable: false });
  }
  if (objectName.startsWith('/') || objectName.startsWith('\\') || objectName.length === 0) {
    throw new AgentError({ code: 'REQUEST_VALIDATION_FAILED', message: 'Invalid file path.', category: 'VALIDATION', retryable: false });
  }
  if (/^[a-zA-Z]:/.test(objectName)) {
    throw new AgentError({ code: 'REQUEST_VALIDATION_FAILED', message: 'Invalid file path.', category: 'VALIDATION', retryable: false });
  }
  const segments = objectName.replaceAll('\\', '/').split('/');
  if (segments.some((segment) => segment === '..')) {
    throw new AgentError({ code: 'REQUEST_VALIDATION_FAILED', message: 'Invalid file path.', category: 'VALIDATION', retryable: false });
  }
  return;
}
