import { Type } from '@sinclair/typebox';
import { WEB_SESSION_SEARCH_MAX_CODE_POINTS } from './validation-limits.js';
export const createSessionBody = Type.Object(
  {
    locale: Type.Optional(Type.Union([Type.Literal('zh-CN'), Type.Literal('en-US')])),
  },
  { additionalProperties: false },
);

export const sessionListQuery = Type.Object(
  {
    q: Type.Optional(Type.String({ maxLength: WEB_SESSION_SEARCH_MAX_CODE_POINTS })),
    // Numeric query fields are validated by the route parser (parseSessionListQuery/parseStrictInteger)
    // so non-numeric, negative or out-of-range values produce the field-level messages documented in
    // docs/apis/agent-web-api-list.md instead of an AJV `format is invalid.` / `must not exceed N characters.`
    // message. `q` keeps its maxLength because the public contract rejects oversized keywords before route parsing.
    createdFrom: Type.Optional(Type.String()),
    createdTo: Type.Optional(Type.String()),
    offset: Type.Optional(Type.String()),
    limit: Type.Optional(Type.String()),
  },
  { additionalProperties: false },
);

export const updateTitleBody = Type.Object(
  {
    title: Type.String({ minLength: 1, maxLength: 100 }),
  },
  { additionalProperties: false },
);
