import { Type, type Static } from '@sinclair/typebox';
import { WEB_ID_MAX_LENGTH } from './validation-limits.js';

const sessionId = Type.String({ minLength: 1, maxLength: WEB_ID_MAX_LENGTH });
const activityId = Type.String({ minLength: 1, maxLength: WEB_ID_MAX_LENGTH });
const observedRunId = Type.String({ minLength: 1, maxLength: WEB_ID_MAX_LENGTH });
const pendingInputKind = Type.Union([
  Type.Literal('QUESTION'),
  Type.Literal('CONFIRMATION'),
  Type.Literal('AUTHORIZATION'),
  Type.Literal('HUMAN_HANDOFF'),
]);

export const emptySessionActivityStreamQuery = Type.Object({}, { additionalProperties: false });

const noActivityEntry = Type.Object(
  {
    sessionId,
    status: Type.Literal('NONE'),
  },
  { additionalProperties: false },
);

const waitingForInputActivityEntry = Type.Object(
  {
    sessionId,
    status: Type.Literal('WAITING_FOR_INPUT'),
    pendingInputKind,
  },
  { additionalProperties: false },
);

const runningActivityEntry = Type.Object(
  {
    sessionId,
    status: Type.Literal('RUNNING'),
  },
  { additionalProperties: false },
);

const unreadFailureActivityEntry = Type.Object(
  {
    sessionId,
    status: Type.Literal('UNREAD_FAILURE'),
    activityId,
  },
  { additionalProperties: false },
);

const unreadResultActivityEntry = Type.Object(
  {
    sessionId,
    status: Type.Literal('UNREAD_RESULT'),
    activityId,
  },
  { additionalProperties: false },
);

export const publishedSessionActivityEntrySchema = Type.Union([
  waitingForInputActivityEntry,
  runningActivityEntry,
  unreadFailureActivityEntry,
  unreadResultActivityEntry,
]);

export const sessionActivityEntrySchema = Type.Union([
  noActivityEntry,
  waitingForInputActivityEntry,
  runningActivityEntry,
  unreadFailureActivityEntry,
  unreadResultActivityEntry,
]);

export const sessionActivitySnapshotMessageSchema = Type.Object(
  {
    type: Type.Literal('SNAPSHOT'),
    entries: Type.Array(publishedSessionActivityEntrySchema),
  },
  { additionalProperties: false },
);

export const sessionActivityDeltaMessageSchema = Type.Object(
  {
    type: Type.Literal('DELTA'),
    entry: sessionActivityEntrySchema,
  },
  { additionalProperties: false },
);

export const sessionActivityMessageSchema = Type.Union([sessionActivitySnapshotMessageSchema, sessionActivityDeltaMessageSchema]);

export const sessionActivityConsumeBody = Type.Object(
  {
    activityId,
    observedRunId,
  },
  { additionalProperties: false },
);

export type SessionActivityWireMessage = Static<typeof sessionActivityMessageSchema>;
export type SessionActivityConsumeBody = Static<typeof sessionActivityConsumeBody>;
