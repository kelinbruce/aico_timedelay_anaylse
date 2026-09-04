import type { JsonObject } from '@nextagent/agent-common';

export const pythonInputSchema: JsonObject = {
  type: 'object',
  additionalProperties: false,
  required: ['code'],
  properties: {
    code: { type: 'string', minLength: 1, description: 'Python source code snippet to execute in isolation.' },
    preamble: { type: 'string', description: 'Variable declaration lines prepended to code at execution time.' },
    args: {
      type: 'array',
      description: 'Optional string arguments made available to the snippet runner.',
      items: { type: 'string' },
      maxItems: 100,
    },
    timeout_ms: { type: 'integer', minimum: 1, description: 'Requested timeout in milliseconds, capped by tool policy and invocation context.' },
  },
};

export const pythonOutputSchema: JsonObject = {
  type: 'object',
  additionalProperties: false,
  required: ['exit_code', 'stdout', 'stderr', 'timed_out'],
  properties: {
    exit_code: { type: 'integer' },
    stdout: { type: 'string' },
    stderr: { type: 'string' },
    timed_out: { type: 'boolean' },
  },
};

export const pythonExecutionOutputSchema: JsonObject = {
  type: 'object',
  additionalProperties: true,
  required: ['stdout', 'stderr', 'exitCode', 'stdoutTruncated', 'stderrTruncated', 'timedOut'],
  properties: {
    stdout: { type: 'string' },
    stderr: { type: 'string' },
    exitCode: { type: 'integer' },
    stdoutTruncated: { type: 'boolean' },
    stderrTruncated: { type: 'boolean' },
    timedOut: { type: 'boolean' },
  },
};
