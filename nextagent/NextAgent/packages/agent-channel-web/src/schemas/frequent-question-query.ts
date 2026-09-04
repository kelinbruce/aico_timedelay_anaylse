import { Type } from '@sinclair/typebox';

export const frequentQuestionQuery = Type.Object(
  {
    locale: Type.Optional(Type.Union([Type.Literal('zh-CN'), Type.Literal('en-US')])),
  },
  { additionalProperties: false },
);
const frequentQuestionEntry = Type.Object(
  {
    text: Type.String({ minLength: 1 }),
  },
  { additionalProperties: false },
);

export const frequentQuestionResponse = Type.Object(
  {
    locale: Type.String({ minLength: 1 }),
    questions: Type.Array(frequentQuestionEntry),
  },
  { additionalProperties: false },
);
