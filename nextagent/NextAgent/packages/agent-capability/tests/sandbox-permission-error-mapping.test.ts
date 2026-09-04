import { brand } from '@nextagent/agent-common';
import { createWorkspaceBackedSandboxExecutionPort, createWorkspaceFilePort, type ToolExecutionContext } from '@nextagent/agent-capability';
import type { SandboxGatewayPort } from '@nextagent/agent-contracts/gateway';
import { describe, expect, it, vi } from 'vitest';

describe('sandbox permission error mapping', () => {
  it('maps permission-denied to a non-retryable path authorization rejection', async () => {
    const execute = vi.fn<SandboxGatewayPort['execute']>(async (request) => ({
      executionId: request.executionId,
      stdout: '',
      stderr: '',
      stdoutTruncated: false,
      stderrTruncated: false,
      timedOut: false,
      durationMs: 1,
      safeError: {
        code: 'PYTHON_EXECUTION_UNAVAILABLE',
        message: 'Python execution request was rejected.',
        category: 'UNAVAILABLE',
        retryable: true,
        safeDetails: { reason: 'permission-denied' },
      },
    }));
    const sandbox = createWorkspaceBackedSandboxExecutionPort({
      gateway: { execute },
      workspaceFiles: createWorkspaceFilePort({ workspaceDir: process.cwd() }),
      riskPolicyEvaluator: {
        evaluate: async () => ({ outcome: 'ALLOW', reasonCode: 'ALLOW' }),
      },
    });

    const error = await sandbox
      .runPython(
        {
          command: 'python',
          args: ['workspace/blocked.py'],
          timeoutMs: 1_000,
          stdoutLimitBytes: 1_024,
          stderrLimitBytes: 1_024,
        },
        toolContext(),
      )
      .catch((cause: unknown) => cause);

    expect(error).toMatchObject({
      code: 'CAPABILITY_PATH_REJECTED',
      category: 'AUTHORIZATION',
      retryable: false,
      safeDetails: {
        reason: 'permission-denied',
        sandboxReasonCode: 'PYTHON_EXECUTION_UNAVAILABLE',
      },
    });
  });
});

function toolContext(): ToolExecutionContext {
  return {
    identityContext: {
      tenantId: brand<string, 'TenantId'>('tenant-sandbox-permission'),
      subjectId: brand<string, 'SubjectId'>('subject-sandbox-permission'),
      displayName: 'Sandbox permission tester',
    },
    agentId: brand<string, 'AgentId'>('agent-sandbox-permission'),
    agentVersion: brand<string, 'AgentVersion'>('v1'),
    sessionId: brand<string, 'SessionId'>('session-sandbox-permission'),
    requestId: brand<string, 'MessageId'>('request-sandbox-permission'),
    runId: brand<string, 'RequestRunId'>('run-sandbox-permission'),
    requestContextId: brand<string, 'RequestContextId'>('context-sandbox-permission'),
    stepId: 'turn-1',
    toolCallId: 'tool-python-permission',
    timeoutMs: 1_000,
  };
}
