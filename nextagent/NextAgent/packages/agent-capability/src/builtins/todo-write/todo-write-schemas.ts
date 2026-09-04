import type { JsonObject } from '@nextagent/agent-common';

export const todoWriteStatusValues = ['pending', 'in_progress', 'completed'] as const;

export const todoWriteItemSchema: JsonObject = {
  type: 'object',
  additionalProperties: false,
  required: ['content', 'activeForm', 'status'],
  properties: {
    content: { type: 'string', minLength: 1, maxLength: 500 },
    activeForm: { type: 'string', minLength: 1, maxLength: 500 },
    status: { enum: [...todoWriteStatusValues] },
  },
};

export const todoWriteInputSchema: JsonObject = {
  type: 'object',
  additionalProperties: false,
  required: ['todos'],
  properties: {
    todos: {
      type: 'array',
      minItems: 0,
      maxItems: 100,
      items: todoWriteItemSchema,
    },
  },
};

export const todoWriteOutputSchema: JsonObject = {
  type: 'object',
  additionalProperties: false,
  required: ['oldTodos', 'newTodos'],
  properties: {
    oldTodos: {
      type: 'array',
      maxItems: 100,
      items: todoWriteItemSchema,
    },
    newTodos: {
      type: 'array',
      maxItems: 100,
      items: todoWriteItemSchema,
    },
  },
};
