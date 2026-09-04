import { Type } from '@sinclair/typebox';

export const cronTaskManagementQuery = Type.Object({}, { additionalProperties: false });

export const cronTaskManagementListQuery = Type.Object(
  {
    offset: Type.Optional(Type.String({ minLength: 1 })),
    limit: Type.Optional(Type.String({ minLength: 1 })),
  },
  { additionalProperties: false },
);

export const cronTaskExecutionQuery = Type.Object(
  {
    offset: Type.Optional(Type.String({ minLength: 1 })),
    limit: Type.Optional(Type.String({ minLength: 1 })),
  },
  { additionalProperties: false },
);

export const cronTaskManagementParams = Type.Object({ taskId: Type.String({ minLength: 1 }) }, { additionalProperties: false });

const cronTaskTarget = Type.Object(
  {
    kind: Type.Union([Type.Literal('SKILL'), Type.Literal('WORKFLOW')]),
    name: Type.String({ minLength: 1, maxLength: 128, pattern: '^[A-Za-z0-9._:-]+$' }),
  },
  { additionalProperties: false },
);

export const cronTaskManagementCreateBody = Type.Object(
  {
    cron: Type.String({ minLength: 1, maxLength: 256 }),
    prompt: Type.String({ minLength: 1, maxLength: 10_000 }),
    target: Type.Optional(cronTaskTarget),
    recurring: Type.Optional(Type.Boolean()),
  },
  { additionalProperties: false },
);

export const cronTaskManagementUpdateBody = Type.Object(
  {
    cron: Type.Optional(Type.String({ minLength: 1, maxLength: 256 })),
    prompt: Type.Optional(Type.String({ minLength: 1, maxLength: 10_000 })),
    target: Type.Optional(Type.Union([cronTaskTarget, Type.Null()])),
    recurring: Type.Optional(Type.Boolean()),
  },
  { additionalProperties: false, minProperties: 1 },
);

export const cronTaskManagementResponse = Type.Object(
  {
    taskId: Type.String({ minLength: 1 }),
    cron: Type.String({ minLength: 1 }),
    humanSchedule: Type.String({ minLength: 1 }),
    prompt: Type.String({ minLength: 1 }),
    target: Type.Optional(cronTaskTarget),
    recurring: Type.Boolean(),
    status: Type.Union([Type.Literal('ACTIVE'), Type.Literal('COMPLETED')]),
    createdAt: Type.Number({ minimum: 0 }),
    updatedAt: Type.Number({ minimum: 0 }),
    nextRunAt: Type.Number({ minimum: 0 }),
    createdByName: Type.Union([Type.String(), Type.Null()]),
  },
  { additionalProperties: false },
);

export const cronTaskManagementListResponse = Type.Object(
  {
    tasks: Type.Array(cronTaskManagementResponse),
    total: Type.Number({ minimum: 0 }),
  },
  { additionalProperties: false },
);

export const cronTaskExecutionResponse = Type.Object(
  {
    triggerId: Type.String({ minLength: 1 }),
    taskId: Type.String({ minLength: 1 }),
    scheduledAt: Type.Number({ minimum: 0 }),
    triggerStatus: Type.Union([Type.Literal('CLAIMED'), Type.Literal('ACCEPTED')]),
    createdAt: Type.Number({ minimum: 0 }),
    updatedAt: Type.Number({ minimum: 0 }),
    sessionId: Type.Optional(Type.String({ minLength: 1 })),
    requestRunId: Type.Optional(Type.String({ minLength: 1 })),
    runStatus: Type.Optional(
      Type.Union([
        Type.Literal('ACCEPTED'),
        Type.Literal('QUEUED'),
        Type.Literal('PLANNING'),
        Type.Literal('EXECUTING'),
        Type.Literal('COMPLETED'),
        Type.Literal('FAILED'),
        Type.Literal('CANCELED'),
        Type.Literal('SUPERSEDED'),
      ]),
    ),
    terminalCommitState: Type.Optional(
      Type.Union([Type.Literal('NOT_STARTED'), Type.Literal('PENDING'), Type.Literal('RETRYING'), Type.Literal('COMMITTED'), Type.Literal('FAILED')]),
    ),
    resultEventType: Type.Optional(
      Type.Union([
        Type.Literal('REQUEST_COMPLETED'),
        Type.Literal('REQUEST_FAILED'),
        Type.Literal('REQUEST_CANCELED'),
        Type.Literal('REQUEST_SUPERSEDED'),
      ]),
    ),
    resultContent: Type.Optional(Type.String()),
    resultAt: Type.Optional(Type.Number({ minimum: 0 })),
  },
  { additionalProperties: false },
);

export const cronTaskExecutionListResponse = Type.Object(
  {
    executions: Type.Array(cronTaskExecutionResponse),
    total: Type.Number({ minimum: 0 }),
  },
  { additionalProperties: false },
);
