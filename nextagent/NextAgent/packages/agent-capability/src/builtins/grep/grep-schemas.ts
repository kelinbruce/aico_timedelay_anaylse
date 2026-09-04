import type { JsonObject } from '@nextagent/agent-common';

export const grepInputSchema: JsonObject = {
  type: 'object',
  additionalProperties: false,
  required: ['pattern'],
  properties: {
    pattern: { type: 'string', minLength: 1, maxLength: 4096, description: 'ECMAScript regular expression to search for.' },
    path: {
      type: 'string',
      minLength: 1,
      maxLength: 4096,
      description:
        'Optional root-qualified directory to search within; a bare relative path aliases workspace/.... Omit it to search only authorized workspace directories.',
    },
    glob_filter: { type: 'string', minLength: 1, maxLength: 4096, description: 'Optional glob filter limiting which files are searched.' },
    output_mode: {
      type: 'string',
      enum: ['files_with_matches', 'content'],
      default: 'files_with_matches',
      description: 'Return only matching filenames or include matching line content.',
    },
    case_insensitive: { type: 'boolean', description: 'Run a case-insensitive search when true.' },
    max_results: { type: 'integer', minimum: 1, maximum: 500, description: 'Maximum number of filenames or content matches to return.' },
  },
};

export const grepOutputSchema: JsonObject = {
  type: 'object',
  additionalProperties: false,
  required: ['output_mode', 'filenames', 'matches', 'total_files_with_matches', 'total_matches', 'truncated'],
  properties: {
    output_mode: {
      type: 'string',
      enum: ['files_with_matches', 'content'],
    },
    filenames: {
      type: 'array',
      maxItems: 500,
      items: { type: 'string', minLength: 1 },
    },
    matches: {
      type: 'array',
      maxItems: 500,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['file_path', 'line_number', 'line'],
        properties: {
          file_path: { type: 'string', minLength: 1 },
          line_number: { type: 'integer', minimum: 1 },
          line: { type: 'string', maxLength: 4096 },
        },
      },
    },
    total_files_with_matches: { type: 'integer', minimum: 0 },
    total_matches: { type: 'integer', minimum: 0 },
    truncated: { type: 'boolean' },
  },
  oneOf: [
    {
      properties: {
        output_mode: { const: 'files_with_matches' },
        matches: { maxItems: 0 },
      },
    },
    {
      properties: {
        output_mode: { const: 'content' },
        filenames: { maxItems: 0 },
      },
    },
  ],
};
