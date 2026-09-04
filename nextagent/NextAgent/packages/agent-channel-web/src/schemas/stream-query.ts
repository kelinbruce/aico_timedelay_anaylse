import { Type } from '@sinclair/typebox';
import { WEB_ID_MAX_LENGTH, WEB_QUERY_SEQUENCE_MAX_LENGTH } from './validation-limits.js';

export const streamQuery = Type.Object(
  {
    lastSeenSequence: Type.Optional(Type.String({ minLength: 1, maxLength: WEB_QUERY_SEQUENCE_MAX_LENGTH, pattern: '^\\d+$' })),
    requestId: Type.Optional(Type.String({ minLength: 1, maxLength: WEB_ID_MAX_LENGTH })),
    runId: Type.Optional(Type.String({ minLength: 1, maxLength: WEB_ID_MAX_LENGTH })),
  },
  { additionalProperties: false },
);
