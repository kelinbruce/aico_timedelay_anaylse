import { type JsonObject } from '@nextagent/agent-common';

export interface BashInputSchemaOptions {
  readonly backgroundExecutionEnabled?: boolean;
}

export function createBashInputSchema(options: BashInputSchemaOptions = {}): JsonObject {
  const { backgroundExecutionEnabled = false } = options;
  const properties: Record<string, JsonObject> = {
    command: {
      type: 'string',
      minLength: 1,
      maxLength: 4096,
      description:
        'Command text to tokenize and submit through the sandbox gateway. Use either command-string mode with the full shell-like command and no `args`, or argv mode with exactly one executable token here and every other token in `args`.',
    },
    args: {
      type: 'array',
      maxItems: 100,
      items: { type: 'string', maxLength: 16_384 },
      description:
        'Optional structured argv entries. Use this for JSON, Gremlin, SQL, regex, natural-language, paths, or other quote-heavy arguments so each value is passed unchanged as one sandbox argv entry.',
    },
    env: {
      type: 'object',
      additionalProperties: false,
      properties: {
        PYTHONPATH: {
          type: 'string',
          minLength: 1,
          maxLength: 4096,
          description:
            'Optional logical sandbox path for Python imports. Only use authorized workspace/temp/Skill resource paths; do not put this in the command string as PYTHONPATH=...',
        },
      },
      description:
        'Narrow structured environment override. Only PYTHONPATH is accepted; NEXTAGENT_* keys are auto-injected by the runtime and cannot be set manually. Any other key is rejected.',
    },
    description: { type: 'string', minLength: 1, maxLength: 512, description: 'Short reason for running the command.' },
    timeout: {
      type: 'integer',
      minimum: 1,
      maximum: 600_000,
      description: 'Requested timeout in milliseconds, capped by the trusted invocation context.',
    },
    timeout_ms: {
      type: 'integer',
      minimum: 1,
      maximum: 600_000,
      description: 'Requested timeout alias in milliseconds, capped by the trusted invocation context.',
    },
    stream_format: {
      type: 'string',
      enum: ['sse', 'ndjson'],
      description:
        'Set when the command is expected to produce streaming structured output (SSE or NDJSON). Enables per-frame TOOL_STRUCTURED_DELTA emission during execution.',
    },
  };
  if (backgroundExecutionEnabled) {
    properties['run_in_background'] = {
      type: 'boolean',
      default: false,
      description:
        'Set to true only for a persistent process or genuinely long-running command. Foreground is preferred when the command can return within the bounded timeout. A background result provides stdoutRef/stderrRef. You will not be notified when it completes, so do not promise automatic follow-up.',
    };
  }
  return {
    type: 'object',
    additionalProperties: false,
    required: ['command'],
    properties,
  };
}

export const bashInputSchema: JsonObject = createBashInputSchema();

export const bashOutputSchema: JsonObject = {
  type: 'object',
  additionalProperties: false,
  required: ['stdout', 'stderr', 'exitCode', 'stdoutTruncated', 'stderrTruncated'],
  properties: {
    stdout: { type: 'string' },
    stderr: { type: 'string' },
    exitCode: { type: 'integer' },
    stdoutTruncated: { type: 'boolean' },
    stderrTruncated: { type: 'boolean' },
  },
};

export const bashBackgroundOutputSchema: JsonObject = {
  type: 'object',
  additionalProperties: false,
  required: ['taskId', 'status', 'stdoutRef', 'stderrRef'],
  properties: {
    taskId: { type: 'string', minLength: 1 },
    status: { type: 'string', enum: ['RUNNING'] },
    stdoutRef: { type: 'string', minLength: 1 },
    stderrRef: { type: 'string', minLength: 1 },
    backgroundReason: { type: 'string', enum: ['EXPLICIT', 'TIMEOUT_AUTO_BACKGROUND', 'ABORT_AUTO_BACKGROUND'] },
    message: { type: 'string' },
  },
};

export interface BashOutputSchemaOptions {
  readonly backgroundExecutionEnabled?: boolean;
}

export function createBashOutputSchema(options: BashOutputSchemaOptions = {}): JsonObject {
  return options.backgroundExecutionEnabled ? { oneOf: [bashOutputSchema, bashBackgroundOutputSchema] } : bashOutputSchema;
}

export const bashExecutionOutputSchema: JsonObject = {
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

export const bashConfigSchema: JsonObject = {
  type: 'object',
  additionalProperties: false,
  properties: {
    allowedExecutables: {
      type: 'array',
      uniqueItems: true,
      items: { type: 'string', minLength: 1, maxLength: 64, pattern: '^[a-zA-Z0-9][a-zA-Z0-9_.-]*$' },
    },
    deniedExecutables: {
      type: 'array',
      uniqueItems: true,
      items: { type: 'string', minLength: 1, maxLength: 64, pattern: '^[a-zA-Z0-9][a-zA-Z0-9_.-]*$' },
    },
    enabled: { type: 'boolean' },
    allowedCommands: {
      type: 'array',
      uniqueItems: true,
      items: { type: 'string', minLength: 1, maxLength: 64, pattern: '^[a-zA-Z0-9][a-zA-Z0-9_.-]*$' },
      description: 'Deprecated compatibility field. Bash command authority is owned by the sandbox gateway policy.',
    },
    allowedPythonScripts: {
      type: 'array',
      uniqueItems: true,
      items: { type: 'string', minLength: 1, maxLength: 512 },
      description: 'Deprecated compatibility field. Python script authority is owned by the sandbox gateway policy.',
    },
  },
};
