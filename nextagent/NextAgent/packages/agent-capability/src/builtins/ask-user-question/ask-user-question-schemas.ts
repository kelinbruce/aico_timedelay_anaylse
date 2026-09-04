import type { JsonObject } from '@nextagent/agent-common';

const promptSchema: JsonObject = {
  type: 'string',
  minLength: 1,
  maxLength: 500,
  description: 'The question text shown to the user.',
};

const optionSchema: JsonObject = {
  type: 'object',
  additionalProperties: false,
  required: ['value', 'label'],
  allOf: [
    {
      if: { required: ['inputPlaceholder'] },
      then: {
        required: ['requiresTextInput'],
        properties: { requiresTextInput: { const: true } },
      },
    },
  ],
  properties: {
    value: {
      type: 'string',
      minLength: 1,
      maxLength: 500,
      description: 'Unique identifier for this option within the question. Used in the answer.',
    },
    label: {
      type: 'string',
      minLength: 1,
      maxLength: 500,
      description: 'Display text for this option.',
    },
    requiresTextInput: {
      type: 'boolean',
      description:
        'Set true whenever selecting this option alone does not provide all information required to continue. This includes options that require a target, value, identifier, name, reason, description, correction, replacement, or other additional detail. Omitting this field asserts that the option is complete and immediately actionable as-is.',
    },
    inputPlaceholder: {
      type: 'string',
      minLength: 1,
      maxLength: 200,
      description: 'Placeholder text for the text input. Only valid when requiresTextInput=true.',
    },
  },
};

export const askUserQuestionInputSchema: JsonObject = {
  type: 'object',
  additionalProperties: false,
  required: ['questions'],
  properties: {
    questions: {
      type: 'array',
      minItems: 1,
      maxItems: 3,
      description: 'Clarification questions for the user. Omit options for free-text answers; include options for predefined choices.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['prompt'],
        allOf: [
          {
            if: {
              properties: {
                options: {
                  contains: {
                    type: 'object',
                    required: ['requiresTextInput'],
                    properties: { requiresTextInput: { const: true } },
                  },
                },
              },
              required: ['options'],
            },
            then: {
              properties: {
                multiple: { const: false },
              },
            },
          },
        ],
        properties: {
          prompt: promptSchema,
          options: {
            type: 'array',
            minItems: 2,
            maxItems: 15,
            description:
              'Provide two to fifteen concise predefined choices for the user. Omit for free-text questions. Each option needs a unique value. If selecting an option alone leaves any information required to continue missing, that option must set requiresTextInput=true.',
            items: optionSchema,
          },
          multiple: {
            type: 'boolean',
            description: 'Allow selecting multiple options. Only valid when options are present.',
          },
          custom: {
            type: 'boolean',
            description: 'Allow a free-text answer alongside predefined options.',
          },
        },
      },
    },
  },
};

export const askUserQuestionOutputSchema: JsonObject = {
  type: 'object',
  additionalProperties: false,
  required: ['status', 'pendingInputId'],
  properties: {
    status: { enum: ['PENDING_INPUT'] },
    pendingInputId: { type: 'string', minLength: 1 },
  },
};
