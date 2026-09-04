import type { JsonObject } from '@nextagent/agent-common';

export const globInputSchema: JsonObject = {
  type: 'object',
  additionalProperties: false,
  required: ['pattern'],
  properties: {
    pattern: {
      type: 'string',
      minLength: 1,
      maxLength: 4096,
      description:
        'Required glob pattern to match execution files. Usually this is the only field to pass, e.g. `**/*.ts`, `src/**/*.json`, or `**/*.{yaml,yml}` for one file category with multiple extensions. Brace alternatives and character classes are supported.',
    },
    path: {
      type: 'string',
      minLength: 1,
      maxLength: 4096,
      description:
        'Optional root-qualified directory to search within; a bare relative path aliases workspace/.... Omit it to search only authorized workspace directories. Do not pass null, undefined, a file path, or another glob pattern.',
    },
  },
};

export const globOutputSchema: JsonObject = {
  type: 'object',
  additionalProperties: false,
  required: ['filenames', 'truncated'],
  properties: {
    filenames: {
      type: 'array',
      maxItems: 500,
      items: { type: 'string', minLength: 1 },
    },
    truncated: { type: 'boolean' },
  },
};
