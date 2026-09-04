import { Type } from '@sinclair/typebox';

export const categoryQuestionQuery = Type.Object(
  {
    locale: Type.Optional(Type.Union([Type.Literal('zh-CN'), Type.Literal('en-US')])),
  },
  { additionalProperties: false },
);
const categoryQuestionEntry = Type.Object(
  {
    text: Type.String({ minLength: 1 }),
    fixed: Type.Boolean(),
  },
  { additionalProperties: false },
);

const categoryL2 = Type.Object(
  {
    name: Type.String({ minLength: 1 }),
    questions: Type.Array(categoryQuestionEntry),
  },
  { additionalProperties: false },
);

const categoryL1 = Type.Object(
  {
    name: Type.String({ minLength: 1 }),
    hasSubCategories: Type.Boolean(),
    questions: Type.Optional(Type.Array(categoryQuestionEntry)),
    subCategories: Type.Optional(Type.Array(categoryL2)),
  },
  { additionalProperties: false },
);

export const categoryQuestionResponse = Type.Object(
  {
    locale: Type.String({ minLength: 1 }),
    categories: Type.Array(categoryL1),
  },
  { additionalProperties: false },
);
