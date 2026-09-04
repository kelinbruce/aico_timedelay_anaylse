import { Type } from '@sinclair/typebox';
import { WEB_CONVERSATION_CURSOR_MAX_LENGTH, WEB_QUERY_LIMIT_MAX_LENGTH } from './validation-limits.js';

export const conversationQuery = Type.Object(
  {
    cursor: Type.Optional(Type.String({ minLength: 1, maxLength: WEB_CONVERSATION_CURSOR_MAX_LENGTH })),
    newerCursor: Type.Optional(Type.String({ minLength: 1, maxLength: WEB_CONVERSATION_CURSOR_MAX_LENGTH })),
    anchorMessageId: Type.Optional(Type.String({ minLength: 1, maxLength: WEB_CONVERSATION_CURSOR_MAX_LENGTH })),
    includeCapabilityResults: Type.Optional(Type.String({ minLength: 1, maxLength: 32 })),
    // No pattern constraint: route parser produces field-level messages for 0/negative/non-numeric.
    limit: Type.Optional(Type.String({ minLength: 1, maxLength: WEB_QUERY_LIMIT_MAX_LENGTH })),
  },
  { additionalProperties: false },
);

export const conversationPreviewQuery = Type.Object(
  {
    // limit is required by the route parser (`limit is required.`), but declared Optional here so
    // missing/non-numeric values reach the parser and produce the field-level messages documented
    // in docs/apis/agent-web-api-list.md instead of an AJV `body is required.`/`format is invalid.`
    offset: Type.Optional(Type.String()),
    limit: Type.Optional(Type.String()),
  },
  { additionalProperties: false },
);
