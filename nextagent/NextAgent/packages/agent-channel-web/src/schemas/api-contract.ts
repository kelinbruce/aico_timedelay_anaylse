import { Type } from '@sinclair/typebox';
import { WEB_ID_MAX_LENGTH, WEB_QUERY_BYTES_MAX_LENGTH } from './validation-limits.js';

export const safeErrorResponse = Type.Object(
  {
    error: Type.Object(
      {
        code: Type.String({ minLength: 1 }),
        message: Type.String({ minLength: 1 }),
      },
      { additionalProperties: false },
    ),
  },
  { additionalProperties: false },
);

export const noContentResponse = Type.Null();

export const sessionParams = Type.Object({ sessionId: Type.String({ minLength: 1, maxLength: WEB_ID_MAX_LENGTH }) }, { additionalProperties: false });
export const sessionMessageParams = Type.Object(
  { sessionId: Type.String({ minLength: 1, maxLength: WEB_ID_MAX_LENGTH }), messageId: Type.String({ minLength: 1, maxLength: WEB_ID_MAX_LENGTH }) },
  { additionalProperties: false },
);
export const sessionRequestParams = Type.Object(
  { sessionId: Type.String({ minLength: 1, maxLength: WEB_ID_MAX_LENGTH }), requestId: Type.String({ minLength: 1, maxLength: WEB_ID_MAX_LENGTH }) },
  { additionalProperties: false },
);
export const pendingInputParams = Type.Object(
  {
    sessionId: Type.String({ minLength: 1, maxLength: WEB_ID_MAX_LENGTH }),
    pendingInputId: Type.String({ minLength: 1, maxLength: WEB_ID_MAX_LENGTH }),
  },
  { additionalProperties: false },
);
export const runAnnotationParams = Type.Object(
  { sessionId: Type.String({ minLength: 1, maxLength: WEB_ID_MAX_LENGTH }), runId: Type.String({ minLength: 1, maxLength: WEB_ID_MAX_LENGTH }) },
  { additionalProperties: false },
);
export const sessionRunParams = runAnnotationParams;
export const backgroundTaskParams = Type.Object(
  { sessionId: Type.String({ minLength: 1, maxLength: WEB_ID_MAX_LENGTH }), taskId: Type.String({ minLength: 1, maxLength: WEB_ID_MAX_LENGTH }) },
  { additionalProperties: false },
);
export const shareParams = Type.Object({ shareId: Type.String({ minLength: 1, maxLength: WEB_ID_MAX_LENGTH }) }, { additionalProperties: false });

export const tempFileParams = Type.Object(
  { sessionId: Type.String({ minLength: 1, maxLength: WEB_ID_MAX_LENGTH }), tempRunId: Type.String({ minLength: 1, maxLength: WEB_ID_MAX_LENGTH }) },
  { additionalProperties: false },
);

export const uploadFileResponse = Type.Object(
  {
    tempRunId: Type.String({ minLength: 1 }),
    fileName: Type.String({ minLength: 1 }),
    sizeBytes: Type.Integer({ minimum: 0 }),
  },
  { additionalProperties: false },
);

export const deleteTempFileQuery = Type.Object(
  {
    fileName: Type.String({ minLength: 1, maxLength: 255 }),
  },
  { additionalProperties: false },
);

export const backgroundTaskOutputQuery = Type.Object(
  {
    stream: Type.Optional(Type.Union([Type.Literal('stdout'), Type.Literal('stderr')])),
    limitBytes: Type.Optional(Type.String({ minLength: 1, maxLength: WEB_QUERY_BYTES_MAX_LENGTH, pattern: '^\\d+$' })),
  },
  { additionalProperties: false },
);

export const sessionSummaryResponse = Type.Object(
  {
    sessionId: Type.String({ minLength: 1 }),
    displayTitle: Type.String(),
    lastActivityAt: Type.Number({ minimum: 0 }),
  },
  { additionalProperties: false },
);

export const sessionListResponse = Type.Object(
  {
    entries: Type.Array(
      Type.Object(
        {
          sessionId: Type.String({ minLength: 1 }),
          displayTitle: Type.String(),
          lastActivityAt: Type.Number({ minimum: 0 }),
          lastRunStatus: Type.Optional(Type.String({ minLength: 1 })),
          hasInFlightRequest: Type.Boolean(),
        },
        { additionalProperties: false },
      ),
    ),
    offset: Type.Integer({ minimum: 0 }),
    limit: Type.Integer({ minimum: 1 }),
    hasMore: Type.Boolean(),
  },
  { additionalProperties: false },
);

const looseObject = Type.Object({}, { additionalProperties: true });

export const sessionEventHistoryQuery = Type.Object(
  {
    afterSequence: Type.Optional(Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER, default: 0 })),
    limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 1000, default: 100 })),
  },
  { additionalProperties: false },
);

const streamEnvelopeResponse = Type.Object(
  {
    eventId: Type.String({ minLength: 1 }),
    sessionId: Type.String({ minLength: 1 }),
    requestId: Type.String({ minLength: 1 }),
    runId: Type.Optional(Type.String({ minLength: 1 })),
    requestContextId: Type.Optional(Type.String({ minLength: 1 })),
    sequence: Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }),
    eventType: Type.String({ minLength: 1 }),
    timelineEventRef: Type.Optional(Type.String({ minLength: 1 })),
    transportHints: Type.Array(Type.String()),
    payload: Type.Object({}, { additionalProperties: true }),
    createdAt: Type.Number({ minimum: 0 }),
  },
  { additionalProperties: false },
);

export const sessionEventHistoryResponse = Type.Union([
  Type.Object(
    {
      availability: Type.Literal('AVAILABLE'),
      events: Type.Array(streamEnvelopeResponse),
      nextAfterSequence: Type.Optional(Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER })),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      availability: Type.Literal('LEGACY_FORK_PROCESS_HISTORY_UNAVAILABLE'),
      events: Type.Array(Type.Never(), { maxItems: 0 }),
    },
    { additionalProperties: false },
  ),
]);

export const conversationResponse = Type.Object(
  {
    items: Type.Array(looseObject),
    nextCursor: Type.Optional(Type.String({ minLength: 1 })),
    newerCursor: Type.Optional(Type.String({ minLength: 1 })),
    activeRun: Type.Optional(looseObject),
    forkNotice: Type.Optional(looseObject),
  },
  { additionalProperties: false },
);

export const conversationPreviewResponse = Type.Object(
  {
    sessionId: Type.String({ minLength: 1 }),
    totalMarkers: Type.Integer({ minimum: 0 }),
    offset: Type.Integer({ minimum: 0 }),
    limit: Type.Integer({ minimum: 1 }),
    markers: Type.Array(looseObject),
  },
  { additionalProperties: false },
);

export const requestAcceptedResponse = Type.Object(
  {
    sessionId: Type.String({ minLength: 1 }),
    requestId: Type.String({ minLength: 1 }),
    runId: Type.String({ minLength: 1 }),
    attempt: Type.Integer({ minimum: 1 }),
  },
  { additionalProperties: false },
);

export const cancelResponse = Type.Object(
  {
    sessionId: Type.String({ minLength: 1 }),
    targetRequestId: Type.String({ minLength: 1 }),
    action: Type.String({ minLength: 1 }),
    idempotencyKey: Type.String({ minLength: 1 }),
  },
  { additionalProperties: false },
);

export const pendingInputAnswerResponse = Type.Object(
  {
    sessionId: Type.String({ minLength: 1 }),
    pendingInputId: Type.String({ minLength: 1 }),
    status: Type.String({ minLength: 1 }),
  },
  { additionalProperties: true },
);

export const suggestedQuestionsResponse = Type.Object(
  {
    questions: Type.Array(Type.String()),
  },
  { additionalProperties: false },
);

export const annotationResponse = Type.Object(
  {
    annotationId: Type.Optional(Type.String({ minLength: 1 })),
    sessionId: Type.Optional(Type.String({ minLength: 1 })),
    requestRunId: Type.Optional(Type.String({ minLength: 1 })),
    sentiment: Type.Union([Type.Literal('UP'), Type.Literal('DOWN'), Type.Null()]),
    isFavorited: Type.Boolean(),
    isQuestionFavorited: Type.Boolean(),
    createdAt: Type.Optional(Type.Number({ minimum: 0 })),
  },
  { additionalProperties: false },
);

export const annotationListResponse = Type.Object(
  {
    annotations: Type.Array(
      Type.Object(
        {
          annotationId: Type.String({ minLength: 1 }),
          requestRunId: Type.String({ minLength: 1 }),
          sentiment: Type.Union([Type.Literal('UP'), Type.Literal('DOWN'), Type.Null()]),
          isFavorited: Type.Boolean(),
          isQuestionFavorited: Type.Boolean(),
          createdAt: Type.Number({ minimum: 0 }),
        },
        { additionalProperties: false },
      ),
    ),
  },
  { additionalProperties: false },
);

export const favoritePageResponse = Type.Object(
  {
    entries: Type.Array(looseObject),
    offset: Type.Integer({ minimum: 0 }),
    limit: Type.Integer({ minimum: 1 }),
    hasMore: Type.Boolean(),
  },
  { additionalProperties: false },
);

export const backgroundTaskListResponse = Type.Object(
  {
    tasks: Type.Array(looseObject),
  },
  { additionalProperties: false },
);

export const backgroundTaskOutputResponse = Type.Object(
  {
    content: Type.String(),
    truncated: Type.Boolean(),
    stream: Type.Union([Type.Literal('stdout'), Type.Literal('stderr')]),
  },
  { additionalProperties: false },
);

export const backgroundTaskKillResponse = Type.Object(
  {
    status: Type.String({ minLength: 1 }),
  },
  { additionalProperties: false },
);

export const shareCreateResponse = Type.Object(
  {
    shareId: Type.String({ minLength: 1 }),
    shareUrl: Type.String({ minLength: 1 }),
  },
  { additionalProperties: false },
);

export const sharedConversationResponse = Type.Object(
  {
    sessionId: Type.String({ minLength: 1 }),
    messages: Type.Array(looseObject),
    createdAt: Type.Number({ minimum: 0 }),
  },
  { additionalProperties: false },
);

export const categoryQuestionEntry = Type.Object(
  {
    text: Type.String({ minLength: 1 }),
    fixed: Type.Boolean(),
  },
  { additionalProperties: false },
);

export const webChannelPublicEndpoints = [
  'GET /api/v1/runtime/bootstrap',
  'POST /api/v1/auth/local/login',
  'POST /api/v1/auth/local/logout',
  'GET /api/v1/health',
  'GET /api/v1/health/deep',
  'GET /api/v1/cron-tasks',
  'POST /api/v1/cron-tasks',
  'PUT /api/v1/cron-tasks/:taskId',
  'GET /api/v1/cron-tasks/:taskId/runs',
  'POST /api/v1/cron-tasks/:taskId/runs',
  'DELETE /api/v1/cron-tasks/:taskId',
  'GET /api/v1/sessions',
  'POST /api/v1/sessions',
  'PUT /api/v1/sessions/:sessionId/title',
  'DELETE /api/v1/sessions/:sessionId',
  'GET /api/v1/sessions/:sessionId/conversation',
  'GET /api/v1/sessions/:sessionId/runs/:runId/events',
  'GET /api/v1/sessions/:sessionId/conversation/preview',
  'POST /api/v1/sessions/:sessionId/messages/:messageId/fork',
  'POST /api/v1/sessions/:sessionId/requests/:requestId/fork',
  'POST /api/v1/sessions/:sessionId/requests',
  'POST /api/v1/requests',
  'POST /api/v1/sessions/:sessionId/cancel',
  'POST /api/v1/sessions/:sessionId/retry',
  'POST /api/v1/sessions/:sessionId/requests/latest/edit',
  'POST /api/v1/sessions/:sessionId/pending-inputs/:pendingInputId/answer',
  'GET /api/v1/sessions/:sessionId/stream',
  'WS /api/v1/sessions/:sessionId/ws',
  'GET /api/v1/session-activities/stream',
  'WS /api/v1/session-activities/ws',
  'POST /api/v1/sessions/:sessionId/activity/consume',
  'POST /api/v1/sessions/:sessionId/runs/:runId/annotations',
  'GET /api/v1/favorites',
  'GET /api/v1/sessions/:sessionId/annotations',
  'GET /api/v1/sessions/:sessionId/background-tasks',
  'GET /api/v1/sessions/:sessionId/background-tasks/:taskId/output',
  'POST /api/v1/sessions/:sessionId/background-tasks/:taskId/kill',
  'POST /api/v1/sessions/:sessionId/shares',
  'GET /api/v1/shares/:shareId/conversation',
  'POST /api/v1/sessions/:sessionId/files/upload',
  'DELETE /api/v1/sessions/:sessionId/files/tmp/:tempRunId',
  'GET /api/v1/sessions/:sessionId/files/download',
  'GET /api/v1/skills',
  'GET /api/v1/category-questions',
  'GET /api/v1/frequent-questions',
  'GET /api/v1/question-association',
  'POST /api/v1/sessions/:sessionId/requests/:requestId/suggested-questions',
  'GET /api/v1/memory/long-term-mem',
  'POST /api/v1/memory/long-term-mem',
  'POST /api/v1/memory/long-term-mem/batch',
  'POST /api/v1/memory/long-term-mem/manual',
  'POST /api/v1/memory/long-term-mem/search',
  'GET /api/v1/memory/long-term-mem/shared',
  'POST /api/v1/memory/long-term-mem/shared/copy',
  'GET /api/v1/memory/long-term-mem/:memoryId/record',
  'GET /api/v1/memory/long-term-mem/:memoryId',
  'DELETE /api/v1/memory/long-term-mem/:memoryId',
  'PATCH /api/v1/memory/long-term-mem/:memoryId',
  'POST /api/v1/memory/long-term-mem/:memoryId/publish',
  'POST /api/v1/memory/long-term-mem/:memoryId/unpublish',
] as const;

export type WebChannelPublicEndpoint = (typeof webChannelPublicEndpoints)[number];
