import { Type } from '@sinclair/typebox';
import { WEB_QUERY_TEXT_MAX_LENGTH } from './validation-limits.js';

export const questionAssociationQuery = Type.Object(
  {
    keyword: Type.String({ minLength: 1, maxLength: WEB_QUERY_TEXT_MAX_LENGTH }),
    locale: Type.Optional(Type.Union([Type.Literal('zh-CN'), Type.Literal('en-US')])),
  },
  { additionalProperties: false },
);

const questionAssociationSource = Type.Union([
  Type.Literal('pinned'),
  Type.Literal('high-frequency'),
  Type.Literal('recommended'),
  Type.Literal('static'),
]);

const questionAssociationEntry = Type.Object(
  {
    text: Type.String({ minLength: 1, maxLength: WEB_QUERY_TEXT_MAX_LENGTH }),
    source: questionAssociationSource,
  },
  { additionalProperties: false },
);

export const questionAssociationResponse = Type.Object(
  {
    locale: Type.Union([Type.Literal('zh-CN'), Type.Literal('en-US')]),
    questions: Type.Array(questionAssociationEntry),
  },
  { additionalProperties: false },
);
