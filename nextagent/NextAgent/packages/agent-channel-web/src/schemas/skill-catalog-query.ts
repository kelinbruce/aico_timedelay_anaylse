import { Type } from '@sinclair/typebox';
import { WEB_QUERY_PAGE_NUM_MAX_LENGTH, WEB_QUERY_TEXT_MAX_LENGTH } from './validation-limits.js';

export const skillCatalogQuery = Type.Object(
  {
    // No pattern constraint: route parser produces field-level messages for 0/negative/non-numeric.
    pageNum: Type.Optional(Type.String({ minLength: 1, maxLength: WEB_QUERY_PAGE_NUM_MAX_LENGTH })),
    pageSize: Type.Optional(Type.String({ minLength: 1, maxLength: WEB_QUERY_PAGE_NUM_MAX_LENGTH })),
    keyword: Type.Optional(Type.String({ maxLength: WEB_QUERY_TEXT_MAX_LENGTH })),
  },
  { additionalProperties: false },
);
export const skillCatalogResponse = Type.Object(
  {
    total: Type.Integer({ minimum: 0 }),
    pageNum: Type.Integer({ minimum: 1 }),
    pageSize: Type.Integer({ minimum: 1, maximum: 100 }),
    skills: Type.Array(
      Type.Object(
        {
          capabilityId: Type.String({ minLength: 1 }),
          displayName: Type.String({ minLength: 1 }),
          description: Type.String(),
          providerKind: Type.Union([Type.Literal('BUNDLED'), Type.Literal('LOCAL_DIRECTORY'), Type.Literal('SKILL_HUB')]),
          version: Type.Optional(Type.String()),
          sourceMetadata: Type.Optional(
            Type.Record(
              Type.String({ minLength: 1, maxLength: 128 }),
              Type.Union([Type.String({ maxLength: 512 }), Type.Array(Type.String({ minLength: 1, maxLength: 512 }), { minItems: 1 })]),
            ),
          ),
        },
        { additionalProperties: false },
      ),
    ),
  },
  { additionalProperties: false },
);
