import { Type, type TSchema } from '@sinclair/typebox';
import {
  WEB_ID_MAX_LENGTH,
  WEB_QUERY_MEMORY_LIMIT_MAX_LENGTH,
  WEB_QUERY_MEMORY_NUM_MAX_LENGTH,
  WEB_QUERY_MEMORY_TEXT_MAX_CODE_UNITS,
  WEB_QUERY_OFFSET_MAX_LENGTH,
} from './validation-limits.js';

const memoryType = Type.Union([
  Type.Literal('FACTUAL'),
  Type.Literal('CONCEPTUAL'),
  Type.Literal('PROCEDURAL'),
  Type.Literal('USER_CHARACTERISTICS'),
]);
const knowledgeSourceType = Type.Union([Type.Literal('LEARNED'), Type.Literal('CONFIGURED'), Type.Literal('SYSTEM_DEFAULT')]);
const memoryState = Type.Union([Type.Literal('ACTIVE'), Type.Literal('ARCHIVED')]);
const queryNumber = Type.Union([
  Type.Number({ minimum: 0 }),
  Type.String({ minLength: 1, maxLength: WEB_QUERY_MEMORY_NUM_MAX_LENGTH, pattern: '^-?(?:0|[1-9][0-9]*)(?:\\.[0-9]+)?$' }),
]);
const queryBoolean = Type.Union([Type.Boolean(), Type.Literal('true'), Type.Literal('false')]);
const label = Type.String({ minLength: 1, maxLength: 256 });
const labels = Type.Array(label, { maxItems: 10 });

function strictObject(properties: Readonly<Record<string, TSchema>>) {
  return Type.Object(properties, { additionalProperties: false });
}

export const listLongTermMemoryQuery = strictObject({
  memoryInstance: Type.Optional(Type.String({ minLength: 1, maxLength: WEB_ID_MAX_LENGTH })),
  queryText: Type.Optional(Type.String({ minLength: 1, maxLength: WEB_QUERY_MEMORY_TEXT_MAX_CODE_UNITS })),
  memoryType: Type.Optional(memoryType),
  knowledgeSourceType: Type.Optional(knowledgeSourceType),
  state: Type.Optional(memoryState),
  isPinned: Type.Optional(queryBoolean),
  minConfidence: Type.Optional(
    Type.Union([
      Type.Number({ minimum: 0, maximum: 1 }),
      Type.String({ minLength: 1, maxLength: WEB_QUERY_MEMORY_NUM_MAX_LENGTH, pattern: '^-?(?:0|[1-9][0-9]*)(?:\\.[0-9]+)?$' }),
    ]),
  ),
  sinceTime: Type.Optional(queryNumber),
  untilTime: Type.Optional(queryNumber),
  maxLastAccessedAt: Type.Optional(queryNumber),
  labels: Type.Optional(Type.String({ maxLength: 256 })),
  limit: Type.Optional(
    Type.Union([Type.Number({ minimum: 1, maximum: 10000 }), Type.String({ minLength: 1, maxLength: WEB_QUERY_MEMORY_LIMIT_MAX_LENGTH })]),
  ),
  offset: Type.Optional(
    Type.Union([Type.Number({ minimum: 0 }), Type.String({ minLength: 1, maxLength: WEB_QUERY_OFFSET_MAX_LENGTH, pattern: '^\\d+$' })]),
  ),
});

export const saveLongTermMemoryBody = strictObject({
  memoryId: Type.Optional(Type.String({ minLength: 1, maxLength: WEB_ID_MAX_LENGTH })),
  memoryInstance: Type.Optional(Type.String({ minLength: 1, maxLength: WEB_ID_MAX_LENGTH })),
  memoryType: Type.Optional(memoryType),
  knowledgeSourceType: Type.Optional(knowledgeSourceType),
  briefIndex: Type.Optional(Type.String({ minLength: 1, maxLength: 2048 })),
  content: Type.Optional(Type.String({ minLength: 1, maxLength: 4000 })),
  labels: Type.Optional(labels),
  confidence: Type.Optional(Type.Number({ minimum: 0, maximum: 1 })),
  source: Type.Optional(Type.String({ maxLength: 256 })),
});

const batchCreateLongTermMemoryItem = strictObject({
  memoryId: Type.Optional(Type.String({ minLength: 1, maxLength: WEB_ID_MAX_LENGTH })),
  memoryType,
  knowledgeSourceType,
  briefIndex: Type.String({ minLength: 1, maxLength: 2048 }),
  content: Type.String({ minLength: 1, maxLength: 4000 }),
  labels: Type.Optional(labels),
  confidence: Type.Optional(Type.Number({ minimum: 0, maximum: 1 })),
  source: Type.Optional(Type.String({ maxLength: 4096 })),
  idempotencyKey: Type.Optional(Type.String({ minLength: 1, maxLength: 128 })),
  state: Type.Optional(memoryState),
  archiveReason: Type.Optional(Type.String({ maxLength: 128 })),
});

export const batchCreateLongTermMemoryBody = strictObject({
  memoryInstance: Type.Optional(Type.String({ minLength: 1, maxLength: WEB_ID_MAX_LENGTH })),
  items: Type.Array(batchCreateLongTermMemoryItem, { minItems: 1, maxItems: 100 }),
});

export const manualSaveLongTermMemoryBody = strictObject({
  memoryId: Type.Optional(Type.String({ minLength: 1, maxLength: WEB_ID_MAX_LENGTH })),
  memoryInstance: Type.Optional(Type.String({ minLength: 1, maxLength: WEB_ID_MAX_LENGTH })),
  memoryType,
  knowledgeSourceType,
  briefIndex: Type.String({ minLength: 1, maxLength: 2048 }),
  content: Type.String({ minLength: 1, maxLength: 4000 }),
  labels: Type.Optional(labels),
  confidence: Type.Number({ minimum: 0, maximum: 1 }),
});

export const searchLongTermMemoryBody = strictObject({
  memoryInstance: Type.Optional(Type.String({ minLength: 1, maxLength: WEB_ID_MAX_LENGTH })),
  queryText: Type.Optional(Type.String({ minLength: 1, maxLength: WEB_QUERY_MEMORY_TEXT_MAX_CODE_UNITS })),
  memoryType: Type.Optional(memoryType),
  knowledgeSourceType: Type.Optional(knowledgeSourceType),
  minConfidence: Type.Optional(Type.Number({ minimum: 0, maximum: 1 })),
  sinceTime: Type.Optional(Type.Number({ minimum: 0 })),
  untilTime: Type.Optional(Type.Number({ minimum: 0 })),
  labels: Type.Optional(labels),
  limit: Type.Optional(Type.Number({ minimum: 1, maximum: 10000 })),
  offset: Type.Optional(Type.Number({ minimum: 0 })),
});

export const listPublishedLongTermMemoryQuery = strictObject({
  memoryInstance: Type.Optional(Type.String({ minLength: 1, maxLength: WEB_ID_MAX_LENGTH })),
  queryText: Type.Optional(Type.String({ minLength: 1, maxLength: WEB_QUERY_MEMORY_TEXT_MAX_CODE_UNITS })),
  memoryType: Type.Optional(memoryType),
  knowledgeSourceType: Type.Optional(knowledgeSourceType),
  labels: Type.Optional(Type.String({ maxLength: 256 })),
  limit: Type.Optional(
    Type.Union([Type.Number({ minimum: 1, maximum: 10000 }), Type.String({ minLength: 1, maxLength: WEB_QUERY_MEMORY_LIMIT_MAX_LENGTH })]),
  ),
  offset: Type.Optional(
    Type.Union([Type.Number({ minimum: 0 }), Type.String({ minLength: 1, maxLength: WEB_QUERY_OFFSET_MAX_LENGTH, pattern: '^\\d+$' })]),
  ),
});

export const copyPublishedMemoryBody = strictObject({
  memoryIds: Type.Array(Type.String({ minLength: 1, maxLength: 64 }), { minItems: 1, maxItems: 100 }),
  memoryInstance: Type.Optional(Type.String({ minLength: 1, maxLength: WEB_ID_MAX_LENGTH })),
  reasonCode: Type.Optional(Type.String({ minLength: 1, maxLength: WEB_ID_MAX_LENGTH })),
});

export const memoryInstanceQuery = strictObject({
  memoryInstance: Type.Optional(Type.String({ minLength: 1, maxLength: WEB_ID_MAX_LENGTH })),
});

export const deleteLongTermMemoryQuery = strictObject({
  memoryInstance: Type.Optional(Type.String({ minLength: 1, maxLength: WEB_ID_MAX_LENGTH })),
  reasonCode: Type.Optional(Type.String({ minLength: 1, maxLength: WEB_ID_MAX_LENGTH })),
});

export const mutateLongTermMemoryBody = strictObject({
  memoryInstance: Type.Optional(Type.String({ minLength: 1, maxLength: WEB_ID_MAX_LENGTH })),
  targetState: Type.Optional(memoryState),
  archiveReason: Type.Optional(Type.String({ maxLength: WEB_ID_MAX_LENGTH })),
  delta: Type.Optional(Type.Number({ minimum: 0 })),
  lastAccessTime: Type.Optional(Type.Number({ minimum: 0 })),
  isPinned: Type.Optional(Type.Boolean()),
  expectedVersion: Type.Optional(Type.Number({ minimum: 1 })),
});

export const sharingLongTermMemoryBody = strictObject({
  memoryInstance: Type.Optional(Type.String({ minLength: 1, maxLength: WEB_ID_MAX_LENGTH })),
  reasonCode: Type.Optional(Type.String({ minLength: 1, maxLength: WEB_ID_MAX_LENGTH })),
});
