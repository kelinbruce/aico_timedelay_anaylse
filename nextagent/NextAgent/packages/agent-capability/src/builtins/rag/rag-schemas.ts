import type { JsonObject } from '@nextagent/agent-common';

const ragReasonValues = [
  'INVALID_INPUT',
  'PROVIDER_UNAVAILABLE',
  'FTS5_UNAVAILABLE',
  'INDEX_NOT_READY',
  'INDEX_NOT_FOUND',
  'NO_RESULTS_FOUND',
  'NO_INDEX',
  'SCOPE_MISMATCH',
  'WORKSPACE_READ_FAILED',
  'DECODE_FAILED',
  'CAPACITY_EXCEEDED',
  'BUILD_FAILED',
  'CLEANUP_FAILED',
  'TIMEOUT',
  'CANCELED',
  'INVALID_PROVIDER_RESULT',
  'EXECUTION_FAILED',
] as const;

const safeProviderReferencePattern = '^(?!/)(?!.*\\\\)(?![A-Za-z]:)(?!.*://)(?!.*(?:^|/)\\.\\.?(?:/|$)).+$';

export const ragInputSchema: JsonObject = {
  type: 'object',
  additionalProperties: false,
  required: ['query'],
  properties: {
    query: { type: 'string', minLength: 1, maxLength: 2048, pattern: '\\S', description: 'Natural-language or keyword retrieval query.' },
    indexes: {
      type: 'array',
      minItems: 1,
      maxItems: 5,
      description: 'Optional knowledge index names to search; omit to search the Agent default indexes.',
      items: { type: 'string', minLength: 1, maxLength: 128, pattern: '^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$' },
    },
    topK: { type: 'integer', minimum: 1, maximum: 10, default: 5, description: 'Maximum number of chunks to return.' },
  },
};

export const ragOutputSchema: JsonObject = {
  type: 'object',
  additionalProperties: false,
  required: ['status', 'results'],
  properties: {
    status: { enum: ['OK', 'NO_INDEX', 'UNAVAILABLE', 'DEGRADED', 'FAILED', 'TIMEOUT', 'CANCELED'] },
    results: {
      type: 'array',
      maxItems: 10,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['content', 'source'],
        properties: {
          content: { type: 'string', minLength: 1, maxLength: 12000 },
          source: { type: 'string', minLength: 1, maxLength: 512, pattern: safeProviderReferencePattern },
          title: { type: 'string', minLength: 1, maxLength: 512 },
          score: { type: 'number', minimum: 0, maximum: 1 },
          rankHint: { type: 'string', minLength: 1, maxLength: 128 },
        },
      },
    },
    diagnostics: {
      type: 'object',
      additionalProperties: false,
      required: ['reason'],
      properties: {
        reason: { enum: ragReasonValues },
      },
    },
  },
};
