import { Type } from '@sinclair/typebox';
import { WEB_QUERY_SEARCH_MAX_LENGTH, WEB_QUERY_TIMESTAMP_MAX_LENGTH } from './validation-limits.js';

export const upsertAnnotationBody = Type.Object(
  {
    sentiment: Type.Optional(Type.Union([Type.Literal('UP'), Type.Literal('DOWN'), Type.Null()])),
    isFavorited: Type.Optional(Type.Boolean()),
    isQuestionFavorited: Type.Optional(Type.Boolean()),
  },
  { additionalProperties: false },
);
export const favoritesListQuery = Type.Object(
  {
    // offset/limit are intentionally free of pattern/minLength/maxLength here: validation is enforced
    // by the route parser (parseStrictInteger/parsePositiveInteger plus range guards) so that invalid
    // values (negative, fractional, oversized) get field-level messages instead of AJV's opaque
    // "<field> format is invalid." which fires when a pattern/maxLength catches them first.
    offset: Type.Optional(Type.String()),
    limit: Type.Optional(Type.String()),
    favoriteType: Type.Optional(Type.Union([Type.Literal('ANSWER'), Type.Literal('QUESTION')])),
    keyword: Type.Optional(Type.String({ minLength: 1, maxLength: WEB_QUERY_SEARCH_MAX_LENGTH * 2 })),
    favoritedFrom: Type.Optional(Type.String({ minLength: 1, maxLength: WEB_QUERY_TIMESTAMP_MAX_LENGTH, pattern: '^\\d+$' })),
    favoritedTo: Type.Optional(Type.String({ minLength: 1, maxLength: WEB_QUERY_TIMESTAMP_MAX_LENGTH, pattern: '^\\d+$' })),
  },
  { additionalProperties: false },
);
