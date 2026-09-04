import { RequestModelOptionsSchema, RoutingConstraintsSchema } from '@nextagent/agent-contracts/runtime';
import { Type } from '@sinclair/typebox';
import {
  WEB_ID_MAX_LENGTH,
  WEB_IDEMPOTENCY_KEY_MAX_LENGTH,
  WEB_FORK_IDEMPOTENCY_KEY_MAX_LENGTH,
  WEB_INPUT_TEXT_MAX_LENGTH,
  WEB_ATTACHMENTS_MAX_ITEMS,
  WEB_PENDING_INPUT_ANSWER_MAX_LENGTH,
  WEB_PENDING_INPUT_ANSWERS_MAX_ITEMS,
} from './validation-limits.js';

export const webSubmitRoutingConstraintsSchema = Type.Omit(RoutingConstraintsSchema, ['targetSkill', 'targetRecipe']);

const tempFileRefSchema = Type.Object({
  tempRunId: Type.String({ minLength: 1, maxLength: WEB_ID_MAX_LENGTH }),
  fileName: Type.String({ minLength: 1, maxLength: 255 }),
});

export const submitBody = Type.Object(
  {
    inputText: Type.String({ minLength: 1, maxLength: WEB_INPUT_TEXT_MAX_LENGTH }),
    idempotencyKey: Type.String({ minLength: 1, maxLength: WEB_IDEMPOTENCY_KEY_MAX_LENGTH }),
    locale: Type.Optional(Type.Union([Type.Literal('zh-CN'), Type.Literal('en-US')])),
    routingConstraints: Type.Optional(webSubmitRoutingConstraintsSchema),
    modelOptions: Type.Optional(RequestModelOptionsSchema),
    attachments: Type.Optional(Type.Array(tempFileRefSchema, { maxItems: WEB_ATTACHMENTS_MAX_ITEMS })),
  },
  { additionalProperties: false },
);
export const convenienceSubmitBody = Type.Object(
  {
    inputText: Type.String({ minLength: 1, maxLength: WEB_INPUT_TEXT_MAX_LENGTH }),
    idempotencyKey: Type.String({ minLength: 1, maxLength: WEB_IDEMPOTENCY_KEY_MAX_LENGTH }),
    locale: Type.Optional(Type.Union([Type.Literal('zh-CN'), Type.Literal('en-US')])),
    sessionId: Type.Optional(Type.String({ minLength: 1, maxLength: WEB_ID_MAX_LENGTH })),
    routingConstraints: Type.Optional(webSubmitRoutingConstraintsSchema),
    modelOptions: Type.Optional(RequestModelOptionsSchema),
    attachments: Type.Optional(Type.Array(tempFileRefSchema, { maxItems: WEB_ATTACHMENTS_MAX_ITEMS })),
  },
  { additionalProperties: false },
);

export const cancelBody = Type.Object(
  {
    expectedLatestRequestId: Type.String({ minLength: 1, maxLength: WEB_ID_MAX_LENGTH }),
    action: Type.Optional(Type.Union([Type.Literal('CANCEL'), Type.Literal('CANCEL_LATEST')])),
    idempotencyKey: Type.String({ minLength: 1, maxLength: WEB_IDEMPOTENCY_KEY_MAX_LENGTH }),
  },
  { additionalProperties: false },
);

export const retryBody = Type.Object(
  {
    expectedLatestRequestId: Type.String({ minLength: 1, maxLength: WEB_ID_MAX_LENGTH }),
    idempotencyKey: Type.String({ minLength: 1, maxLength: WEB_IDEMPOTENCY_KEY_MAX_LENGTH }),
  },
  { additionalProperties: false },
);

export const editLatestBody = Type.Object(
  {
    expectedLatestRequestId: Type.String({ minLength: 1, maxLength: WEB_ID_MAX_LENGTH }),
    editedInputText: Type.String({ minLength: 1, maxLength: WEB_INPUT_TEXT_MAX_LENGTH }),
    idempotencyKey: Type.String({ minLength: 1, maxLength: WEB_IDEMPOTENCY_KEY_MAX_LENGTH }),
    locale: Type.Optional(Type.Union([Type.Literal('zh-CN'), Type.Literal('en-US')])),
    attachments: Type.Optional(Type.Array(Type.Never(), { maxItems: 0 })),
  },
  { additionalProperties: false },
);

export const forkFromMessageBody = Type.Object(
  {
    idempotencyKey: Type.String({ minLength: 1, maxLength: WEB_FORK_IDEMPOTENCY_KEY_MAX_LENGTH }),
  },
  { additionalProperties: false },
);

export const pendingInputAnswerBody = Type.Object(
  {
    answers: Type.Array(
      Type.Array(Type.String({ minLength: 1, maxLength: WEB_PENDING_INPUT_ANSWER_MAX_LENGTH }), {
        minItems: 1,
        maxItems: WEB_PENDING_INPUT_ANSWERS_MAX_ITEMS,
      }),
      { minItems: 1, maxItems: WEB_PENDING_INPUT_ANSWERS_MAX_ITEMS },
    ),
    answerKinds: Type.Optional(
      Type.Array(
        Type.Union([
          Type.Literal('TEXT'),
          Type.Literal('OPTION_SELECTION'),
          Type.Literal('OPTION_ATTACHED_TEXT'),
          Type.Literal('CUSTOM_TEXT'),
          Type.Literal('OPTION_SELECTIONS_WITH_CUSTOM_TEXT'),
        ]),
        { minItems: 1, maxItems: WEB_PENDING_INPUT_ANSWERS_MAX_ITEMS },
      ),
    ),
  },
  { additionalProperties: false },
);
