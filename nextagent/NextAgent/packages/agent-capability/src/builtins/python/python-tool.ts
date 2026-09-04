import { AgentError, brand, type JsonObject } from '@nextagent/agent-common';

import { defineTool, ToolTimedOutResultError, type ToolDefinition, type ToolExecuteOptions } from '../../tools/tool-spi.js';
import { builtinToolPresentation } from '../presentation-names.js';
import { validateJson } from '../../tools/tool-catalog.js';
import { pythonExecutionOutputSchema, pythonInputSchema, pythonOutputSchema } from './python-schemas.js';

export const pythonCapabilityId = brand<string, 'CapabilityId'>('Python');

const defaultTimeoutMs = 120_000;
const maxTimeoutMs = 120_000;
const maxArgsBytes = 8_192;
const maxOutputBytes = 1_000_000;
const maxArgsCount = 100;

export const pythonToolDefinition: ToolDefinition = defineTool({
  name: pythonCapabilityId,
  ...builtinToolPresentation('Python'),
  description:
    'Execute one isolated Python source snippet supplied directly in the `code` field through the sandbox boundary. Use it for bounded computation, data transformation, or diagnostics that benefit from Python syntax or libraries. Python does not accept a `.py` file path or shell command as its code field; run an existing script or module with Bash and its exact path. Use Read for workspace file inspection.\n\nOptional `args` are string arguments for the snippet runner. A filename-like value in `args` is data; it does not discover or authorize that file. A non-zero `exit_code` is returned in a normal structured result, so inspect it and stderr before claiming success. Timeout is reported as a timed-out tool outcome with partial output when available.',
  inputSchema: pythonInputSchema,
  outputSchema: pythonOutputSchema,
  requiredDependencies: ['sandbox'],
  replayPolicy: 'NON_IDEMPOTENT',
  disclosurePolicy: { mode: 'EAGER' },
  async execute(input, options): Promise<JsonObject> {
    return executePython(input, options);
  },
});

async function executePython(input: JsonObject, options?: ToolExecuteOptions): Promise<JsonObject> {
  if (options?.deps?.sandbox === undefined || options.context === undefined) {
    throw new AgentError({
      code: 'CAPABILITY_EXECUTION_FAILED',
      message: 'Required Python execution boundary is unavailable. Stop this action and report the error.',
      category: 'INTERNAL',
      retryable: false,
    });
  }

  // 输入校验 - 直接 throw，让 executor 返回 FAILED
  const code = String(input['code']);
  if (code.trim().length === 0) {
    throw new AgentError({
      code: 'PYTHON_INPUT_INVALID',
      message: 'Python code must be a non-empty string. Validation stopped before execution; supply a bounded Python snippet and call Python again.',
      category: 'VALIDATION',
      retryable: false,
    });
  }

  const args = readArgs(input['args']);
  const timeoutMs = resolveTimeoutMs(input['timeout_ms'], options.context.timeoutMs);

  const preamble = typeof input['preamble'] === 'string' && input['preamble'].trim().length > 0 ? input['preamble'] : undefined;

  const guardrail = options.deps.guardrail;
  if (guardrail !== undefined) {
    const nl2py = await guardrail.checkNl2Python({ content: code }, options.signal);
    if (!nl2py.status) {
      throw new AgentError({
        code: 'NL2PY_GUARD_BLOCKED',
        message: 'Python code did not satisfy the code safety policy. Revise the listed code constraint before calling Python again.',
        category: 'VALIDATION',
        retryable: false,
        safeDetails: {
          violations: [
            {
              path: '/code',
              constraint: 'codeSafetyPolicy',
              expected: 'Python code that satisfies the declared code safety policy',
            },
          ],
        },
      });
    }
  }

  const output = await options.deps.sandbox.runPython(
    {
      command: preamble !== undefined ? `${preamble}\n${code}` : code,
      args,
      timeoutMs,
      stdoutLimitBytes: maxOutputBytes,
      stderrLimitBytes: maxOutputBytes,
    },
    options.context,
    options.signal,
  );

  if (!validateJson(pythonExecutionOutputSchema, output)) {
    throw new Error('Sandbox returned an invalid Python execution response.');
  }

  if (output['timedOut'] === true) {
    const stdout = output['stdout'] as string;
    const stderr = output['stderr'] as string;
    const hasSafePartialOutput = stdout.length > 0 || stderr.length > 0;
    throw new ToolTimedOutResultError(
      hasSafePartialOutput ? { exit_code: output['exitCode'] as number, stdout, stderr, timed_out: true } : {},
      'SANDBOX_TIMEOUT',
      {
        safeMessage: hasSafePartialOutput
          ? 'Python execution timed out after producing safe partial output. Inspect the existing stdout and stderr, then reduce the code or input before deciding whether to call Python again.'
          : 'Python execution timed out without safe output. Reduce the code or input before deciding whether to call Python again.',
      },
    );
  }

  return {
    exit_code: output['exitCode'] as number,
    stdout: output['stdout'] as string,
    stderr: output['stderr'] as string,
    timed_out: output['timedOut'] as boolean,
  };
}

function readArgs(value: unknown): readonly string[] {
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string')) {
    throw new AgentError({
      code: 'PYTHON_INPUT_INVALID',
      message: 'Python validation failed before execution: args must be an array of strings. Correct or omit args and call Python again.',
      category: 'VALIDATION',
      retryable: false,
    });
  }
  if (value.length > maxArgsCount) {
    throw new AgentError({
      code: 'PYTHON_ARGS_BUDGET_EXCEEDED',
      message: `Python validation failed before execution: args must contain at most ${maxArgsCount} items. Reduce the argument count and call Python again.`,
      category: 'VALIDATION',
      retryable: false,
    });
  }
  const argsBytes = value.reduce((total, entry) => total + Buffer.byteLength(entry, 'utf8'), 0);
  if (argsBytes > maxArgsBytes) {
    throw new AgentError({
      code: 'PYTHON_ARGS_BUDGET_EXCEEDED',
      message: `Python args must not exceed ${maxArgsBytes} UTF-8 bytes in total. Validation stopped before execution; reduce the arguments and call Python again.`,
      category: 'VALIDATION',
      retryable: false,
    });
  }
  return value;
}

function resolveTimeoutMs(value: unknown, trustedTimeoutMs: number): number {
  const requested = typeof value === 'number' ? value : defaultTimeoutMs;
  if (!Number.isInteger(requested) || requested <= 0) {
    throw new AgentError({
      code: 'PYTHON_INPUT_INVALID',
      message: 'Python validation failed before execution: timeout_ms must be a positive integer. Correct or omit timeout_ms and call Python again.',
      category: 'VALIDATION',
      retryable: false,
    });
  }
  return Math.min(requested, maxTimeoutMs, trustedTimeoutMs);
}
