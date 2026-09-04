import { Type } from '@sinclair/typebox';
import { WEB_ID_MAX_LENGTH } from './validation-limits.js';

export const capabilityPresentationResourcesQuery = Type.Object({}, { additionalProperties: false });

const capabilityPresentationLocales = Type.Object(
  {
    language: Type.Record(
      Type.String({ minLength: 2, maxLength: 35, pattern: '^[a-zA-Z]{2,8}(?:-[a-zA-Z0-9]{1,8})*$' }),
      Type.Object(
        {
          displayName: Type.String({ minLength: 1, maxLength: 256 }),
        },
        { additionalProperties: false },
      ),
      { minProperties: 1 },
    ),
  },
  { additionalProperties: false },
);

const capabilityPresentationResource = Type.Object(
  {
    capabilityKind: Type.Union([Type.Literal('TOOL'), Type.Literal('SKILL'), Type.Literal('AGENT'), Type.Literal('WORKFLOW')]),
    capabilityId: Type.String({ minLength: 1, maxLength: WEB_ID_MAX_LENGTH }),
    displayName: Type.String({ minLength: 1, maxLength: 256 }),
    locales: Type.Optional(capabilityPresentationLocales),
  },
  { additionalProperties: false },
);

export const capabilityPresentationResourcesResponse = Type.Object(
  { resources: Type.Array(capabilityPresentationResource) },
  { additionalProperties: false },
);
