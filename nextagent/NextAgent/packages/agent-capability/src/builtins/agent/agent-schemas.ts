import type { JsonObject } from '@nextagent/agent-common';

export const agentToolPromptMaxBytes = 8192;
export const agentToolResultTextMaxBytes = 100_000;

export const agentToolInputSchema: JsonObject = {
  type: 'object',
  additionalProperties: false,
  required: ['agentId', 'prompt'],
  properties: {
    agentId: { type: 'string', minLength: 1, maxLength: 128, description: 'Available governed Agent capability id, not a display name.' },
    prompt: {
      type: 'string',
      minLength: 1,
      description: 'Complete, self-contained task description for the sub-agent; it does not inherit parent conversation context.',
    },
  },
};

export const agentToolOutputSchema: JsonObject = {
  anyOf: [
    {
      type: 'object',
      additionalProperties: false,
      required: ['agentId', 'status', 'result'],
      properties: {
        agentId: { type: 'string', minLength: 1, maxLength: 128 },
        status: { const: 'completed' },
        result: {
          type: 'object',
          additionalProperties: false,
          required: ['text'],
          properties: {
            text: { type: 'string' },
          },
        },
      },
    },
    {
      type: 'object',
      additionalProperties: false,
    },
  ],
};
