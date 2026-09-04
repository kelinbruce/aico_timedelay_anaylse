import { Type } from '@sinclair/typebox';
import { WEB_ID_MAX_LENGTH, WEB_ORIGIN_URL_MAX_LENGTH, WEB_SHARE_ALLOWED_OPS_MAX_ITEMS, WEB_SHARE_RUN_IDS_MAX_ITEMS } from './validation-limits.js';

export const createShareBody = Type.Object(
  {
    runIds: Type.Array(Type.String({ minLength: 1, maxLength: WEB_ID_MAX_LENGTH }), { minItems: 1, maxItems: WEB_SHARE_RUN_IDS_MAX_ITEMS }),
    originUrl: Type.String({ minLength: 1, maxLength: WEB_ORIGIN_URL_MAX_LENGTH }),
    expiresIn: Type.Union([Type.Literal('24h'), Type.Literal('7d'), Type.Literal('30d'), Type.Literal('permanent')]),
    allowedOps: Type.Union([
      Type.Null(),
      Type.Array(Type.String({ minLength: 1, maxLength: WEB_ID_MAX_LENGTH }), { maxItems: WEB_SHARE_ALLOWED_OPS_MAX_ITEMS }),
    ]),
  },
  { additionalProperties: false },
);
