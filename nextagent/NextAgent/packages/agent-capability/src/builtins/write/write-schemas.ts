import type { JsonObject } from '@nextagent/agent-common';

export const writeInputSchema: JsonObject = {
  type: 'object',
  additionalProperties: false,
  required: ['file_path', 'content'],
  properties: {
    file_path: {
      type: 'string',
      minLength: 1,
      description: 'Root-qualified path to create or rewrite; a bare relative path aliases workspace/... and results return the canonical path.',
    },
    content: { type: 'string', minLength: 1, description: 'Complete UTF-8 text content to write.' },
  },
};

export const writeOutputSchema: JsonObject = {
  type: 'object',
  additionalProperties: false,
  required: ['type', 'file_path'],
  properties: {
    type: { enum: ['create', 'update'] },
    file_path: { type: 'string', minLength: 1 },
    generated_skill: {
      type: 'object',
      additionalProperties: false,
      required: ['capability_id', 'ready', 'next_skill_call'],
      properties: {
        capability_id: { type: 'string', minLength: 1 },
        ready: { type: 'boolean' },
        next_skill_call: { type: 'string', minLength: 1 },
      },
    },
  },
};
