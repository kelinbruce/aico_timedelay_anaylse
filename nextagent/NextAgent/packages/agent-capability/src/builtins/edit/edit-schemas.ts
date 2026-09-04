import type { JsonObject } from '@nextagent/agent-common';

export const editInputSchema: JsonObject = {
  type: 'object',
  additionalProperties: false,
  required: ['file_path', 'old_string', 'new_string'],
  properties: {
    file_path: {
      type: 'string',
      minLength: 1,
      description: 'Root-qualified path to the existing text file; a bare relative path aliases workspace/... and results return the canonical path.',
    },
    old_string: { type: 'string', minLength: 1, description: 'Exact text to replace. It must be unique unless replace_all is true.' },
    new_string: { type: 'string', description: 'Replacement text.' },
    replace_all: { type: 'boolean', default: false, description: 'Replace every occurrence of old_string when true.' },
  },
};

export const editOutputSchema: JsonObject = {
  type: 'object',
  additionalProperties: false,
  required: ['file_path', 'type', 'old_string', 'new_string', 'replaced_count'],
  properties: {
    file_path: { type: 'string', minLength: 1 },
    type: { enum: ['update'] },
    old_string: { type: 'string' },
    new_string: { type: 'string' },
    replaced_count: { type: 'integer', minimum: 1 },
    replace_all: { type: 'boolean' },
  },
};
