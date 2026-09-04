import type { WorkflowSandboxExecutionPort } from '@nextagent/agent-contracts/capability';
import type { SandboxExecutionPort } from './tools/tool-spi.js';

export type { WorkflowSandboxExecutionInput, WorkflowSandboxExecutionPort } from '@nextagent/agent-contracts/capability';

export function createWorkflowSandboxExecutionPort(sandbox: SandboxExecutionPort): WorkflowSandboxExecutionPort {
  return {
    async runPython(input, context, signal) {
      return sandbox.runPython(
        {
          command: input.code,
          args: input.args,
          ...(input.environment === undefined ? {} : { environment: input.environment }),
          timeoutMs: input.timeoutMs,
          stdoutLimitBytes: input.stdoutLimitBytes,
          stderrLimitBytes: input.stderrLimitBytes,
        },
        context,
        signal,
      );
    },
  };
}
