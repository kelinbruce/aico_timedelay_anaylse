import type { JsonObject } from '@nextagent/agent-common';

export const readInputSchema: JsonObject = {
  type: 'object',
  additionalProperties: false,
  required: ['file_path'],
  properties: {
    file_path: {
      type: 'string',
      minLength: 1,
      description: 'Root-qualified path to read; a bare relative path aliases workspace/... and results return the canonical root-qualified path.',
    },
    offset: { type: 'integer', minimum: 0, default: 0, description: 'Zero-based line offset to start reading from.' },
    limit: { type: 'integer', minimum: 1, maximum: 2000, default: 2000, description: 'Maximum number of lines to return.' },
  },
};

export const readOutputSchema: JsonObject = {
  type: 'object',
  additionalProperties: false,
  required: ['file_path', 'offset', 'limit', 'content', 'truncated'],
  properties: {
    file_path: { type: 'string', minLength: 1 },
    offset: { type: 'integer', minimum: 0 },
    limit: { type: 'integer', minimum: 1, maximum: 2000 },
    content: { type: 'string' },
    truncated: { type: 'boolean' },
    nextOffset: { type: 'integer', minimum: 0 },
    error: { enum: ['FILE_UNAVAILABLE', 'PAGING_REQUIRED'] },
    message: { type: 'string' },
  },
};
