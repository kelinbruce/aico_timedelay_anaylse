import { brand, type SafeError } from '@nextagent/agent-common';
import { createWorkspaceBackedSandboxExecutionPort, createWorkspaceFilePort, type ToolExecutionContext } from '@nextagent/agent-capability';
import type { AgentWorkspacePolicy } from '@nextagent/agent-contracts/agent-assembly';
import type { SandboxExecutionRequest, SandboxGatewayPort } from '@nextagent/agent-contracts/gateway';
import { createExecutionWorkspaceResolver } from '@nextagent/agent-runtime';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

describe('sandbox execution port safe error mapping', () => {
  it.each(['unauthorized-path', 'unsafe-path', 'permission-denied'] as const)(
    'maps %s to a non-retryable path authorization rejection',
    async (reason) => {
      const sandbox = createSandbox({
        code: 'PYTHON_EXECUTION_UNAVAILABLE',
        message: 'Python execution request was rejected.',
        category: 'UNAVAILABLE',
        retryable: true,
        safeDetails: { reason },
      });

      const error = await runPython(sandbox).catch((cause: unknown) => cause);

      expect(error).toMatchObject({
        code: 'CAPABILITY_PATH_REJECTED',
        category: 'AUTHORIZATION',
        retryable: false,
        safeDetails: {
          reason,
          sandboxReasonCode: 'PYTHON_EXECUTION_UNAVAILABLE',
        },
      });
      expect(error).not.toMatchObject({ code: 'SANDBOX_UNAVAILABLE' });
    },
  );

  it('preserves genuine sandbox unavailability', async () => {
    const sandbox = createSandbox({
      code: 'PYTHON_EXECUTION_UNAVAILABLE',
      message: 'Python execution is unavailable.',
      category: 'UNAVAILABLE',
      retryable: true,
      safeDetails: { reason: 'unconfigured' },
    });

    const error = await runPython(sandbox).catch((cause: unknown) => cause);

    expect(error).toMatchObject({
      code: 'SANDBOX_UNAVAILABLE',
      category: 'UNAVAILABLE',
      retryable: true,
      safeDetails: {
        reason: 'unconfigured',
        sandboxReasonCode: 'PYTHON_EXECUTION_UNAVAILABLE',
      },
    });
  });

  it('maps unsupported Python invocation to actionable validation feedback', async () => {
    const sandbox = createSandbox({
      code: 'PYTHON_EXECUTION_REJECTED',
      message: 'Python execution request was rejected.',
      category: 'UNAVAILABLE',
      retryable: false,
      safeDetails: { reason: 'unsupported-python-invocation' },
    });

    const error = await runPython(sandbox).catch((cause: unknown) => cause);

    expect(error).toMatchObject({
      code: 'CAPABILITY_INPUT_INVALID',
      category: 'VALIDATION',
      retryable: false,
      safeDetails: {
        reason: 'unsupported-python-invocation',
        sandboxReasonCode: 'PYTHON_EXECUTION_REJECTED',
      },
    });
    expect((error as SafeError).safeDetails?.['hint']).toContain('script path');
    expect(error).not.toMatchObject({ code: 'SANDBOX_UNAVAILABLE' });
  });

  it('maps shell composition policy rejection to command not allowed', async () => {
    const sandbox = createSandbox({
      code: 'BASH_EXECUTION_REJECTED',
      message: 'Bash execution request was rejected.',
      category: 'UNAVAILABLE',
      retryable: false,
      safeDetails: { reason: 'shell-composition-not-allowed' },
    });

    const error = await runShell(sandbox).catch((cause: unknown) => cause);

    expect(error).toMatchObject({
      code: 'COMMAND_NOT_ALLOWED',
      category: 'AUTHORIZATION',
      retryable: false,
      safeDetails: {
        reason: 'shell-composition-not-allowed',
        sandboxReasonCode: 'BASH_EXECUTION_REJECTED',
      },
    });
  });

  it('maps executable policy rejection to command not allowed', async () => {
    const sandbox = createSandbox({
      code: 'BASH_EXECUTION_REJECTED',
      message: 'Bash execution request was rejected.',
      category: 'UNAVAILABLE',
      retryable: false,
      safeDetails: { reason: 'denied-executable' },
    });

    const error = await runShell(sandbox).catch((cause: unknown) => cause);

    expect(error).toMatchObject({
      code: 'COMMAND_NOT_ALLOWED',
      category: 'AUTHORIZATION',
      retryable: false,
      safeDetails: {
        reason: 'denied-executable',
        sandboxReasonCode: 'BASH_EXECUTION_REJECTED',
      },
    });
  });

  it('passes a committed Skill projection to a later run explicit Python script path', async () => {
    const runtimeWorkspaceRoot = await mkdtemp(join(tmpdir(), 'nextagent-sandbox-scope-authority-'));
    try {
      const workspaceFiles = createWorkspaceFilePort({
        runtimeWorkspaceRoot,
        executionWorkspaceResolver: createExecutionWorkspaceResolver(),
        deploymentMode: 'LOCAL',
        workspacePolicyProvider: {
          async require() {
            return defaultPolicy();
          },
        },
        writeDirectories: ['.'],
      });
      const firstRun = toolContext();
      const laterRun = {
        ...firstRun,
        sessionId: brand<string, 'SessionId'>('session-sandbox-errors-later'),
        runId: brand<string, 'RequestRunId'>('run-sandbox-errors-later'),
      };
      const script = new TextEncoder().encode("print('scope-ok')\n");
      const projection = await workspaceFiles.projectSkillResources(
        {
          providerId: 'builtin-skills',
          skillName: 'diagnosis',
          skillVersion: '1.0.0',
          async listResources() {
            return [{ relativePath: 'scripts/check.py', kind: 'script', sizeBytes: script.byteLength }];
          },
          async readResource(resource) {
            return { ...resource, contentStream: streamBytes(script) };
          },
        },
        firstRun,
      );
      const execute = vi.fn<SandboxGatewayPort['execute']>(async (request) => ({
        executionId: request.executionId,
        exitCode: 0,
        stdout: 'scope-ok',
        stderr: '',
        stdoutTruncated: false,
        stderrTruncated: false,
        timedOut: false,
        durationMs: 1,
      }));
      const sandbox = createWorkspaceBackedSandboxExecutionPort({
        gateway: { execute },
        workspaceFiles,
        riskPolicyEvaluator: {
          evaluate: async () => ({ outcome: 'ALLOW', reasonCode: 'ALLOW' }),
        },
      });

      await expect(
        sandbox.runPython(
          {
            command: 'python',
            args: [`${projection.rootRelativePath}scripts/check.py`],
            timeoutMs: 1_000,
            stdoutLimitBytes: 1_024,
            stderrLimitBytes: 1_024,
          },
          laterRun,
        ),
      ).resolves.toMatchObject({ exitCode: 0, stdout: 'scope-ok' });
      expect(execute).toHaveBeenCalledWith(
        expect.objectContaining({
          filesystem: expect.objectContaining({
            roots: expect.arrayContaining([
              expect.objectContaining({
                kind: 'systemResources',
                logicalPath: projection.rootRelativePath.slice(0, -1),
                access: 'read',
              }),
            ]),
          }),
        }),
        undefined,
      );
    } finally {
      await rm(runtimeWorkspaceRoot, { recursive: true, force: true });
    }
  });
});

describe('sandbox execution port Python inline staging', () => {
  it('wraps inline Python with a Python 3.6 subprocess.run compatibility prelude', async () => {
    const workspaceDir = await mkdtemp(join(tmpdir(), 'nextagent-python-inline-'));
    try {
      let stagedScript = '';
      const sandbox = createCapturingSandbox(workspaceDir, async (request) => {
        const tempRoot = request.filesystem.roots.find((root) => root.kind === 'temp');
        expect(tempRoot).toBeDefined();
        expect(request.command).toBe('python');
        expect(request.args[0]).toMatch(/^temp\/.+\.py$/u);
        stagedScript = await readFile(join(tempRoot!.physicalPath, request.args[0]!.replace(/^temp\//u, '')), 'utf8');
      });

      await sandbox.runPython(
        {
          command: [
            '"""diagnostic snippet"""',
            'from __future__ import print_function',
            'import subprocess',
            "result = subprocess.run(['python', '--version'], capture_output=True, text=True)",
            'print(result.stdout)',
          ].join('\n'),
          args: ['--flag'],
          timeoutMs: 1_000,
          stdoutLimitBytes: 1_024,
          stderrLimitBytes: 1_024,
        },
        toolContext(),
        undefined,
      );

      expect(stagedScript).toContain('subprocess.run lacks capture_output/text');
      expect(stagedScript).toContain('kwargs["stdout"] = _nextagent_subprocess.PIPE');
      expect(stagedScript).toContain('kwargs["universal_newlines"] = kwargs.pop("text")');
      expect(stagedScript.indexOf('from __future__ import print_function')).toBeLessThan(stagedScript.indexOf('NextAgent compatibility'));
      expect(stagedScript).toContain('capture_output=True, text=True');
    } finally {
      await rm(workspaceDir, { recursive: true, force: true });
    }
  });

  it('does not rewrite explicit Python interpreter invocations', async () => {
    const workspaceDir = await mkdtemp(join(tmpdir(), 'nextagent-python-explicit-'));
    try {
      let observedCommand = '';
      let observedArgs: readonly string[] = [];
      const sandbox = createCapturingSandbox(workspaceDir, (request) => {
        observedCommand = request.command;
        observedArgs = request.args;
      });

      await sandbox.runPython(
        {
          command: 'python3',
          args: ['.nextagent/skills/projection/diagnosis/scripts/diagnosis_context.py', 'init'],
          timeoutMs: 1_000,
          stdoutLimitBytes: 1_024,
          stderrLimitBytes: 1_024,
        },
        toolContext(),
        undefined,
      );

      expect(observedCommand).toBe('python3');
      expect(observedArgs).toEqual(['.nextagent/skills/projection/diagnosis/scripts/diagnosis_context.py', 'init']);
    } finally {
      await rm(workspaceDir, { recursive: true, force: true });
    }
  });
});

function createSandbox(safeError: SafeError) {
  const execute = vi.fn<SandboxGatewayPort['execute']>(async (request) => ({
    executionId: request.executionId,
    stdout: '',
    stderr: '',
    stdoutTruncated: false,
    stderrTruncated: false,
    timedOut: false,
    durationMs: 1,
    safeError,
  }));
  return createWorkspaceBackedSandboxExecutionPort({
    gateway: { execute },
    workspaceFiles: createWorkspaceFilePort({ workspaceDir: process.cwd() }),
    riskPolicyEvaluator: {
      evaluate: async () => ({ outcome: 'ALLOW', reasonCode: 'ALLOW' }),
    },
  });
}

function createCapturingSandbox(workspaceDir: string, onExecute: (request: SandboxExecutionRequest, signal?: AbortSignal) => Promise<void> | void) {
  const execute = vi.fn<SandboxGatewayPort['execute']>(async (request, signal) => {
    await onExecute(request, signal);
    return {
      executionId: request.executionId,
      stdout: '',
      stderr: '',
      stdoutTruncated: false,
      stderrTruncated: false,
      timedOut: false,
      durationMs: 1,
      exitCode: 0,
    };
  });
  return createWorkspaceBackedSandboxExecutionPort({
    gateway: { execute },
    workspaceFiles: createWorkspaceFilePort({ workspaceDir }),
    riskPolicyEvaluator: {
      evaluate: async () => ({ outcome: 'ALLOW', reasonCode: 'ALLOW' }),
    },
  });
}

async function runPython(sandbox: ReturnType<typeof createSandbox>): Promise<unknown> {
  return sandbox.runPython(
    {
      command: 'python',
      args: ['.nextagent/skills/projection/diagnosis/scripts/diagnosis_context.py', 'init'],
      timeoutMs: 1_000,
      stdoutLimitBytes: 1_024,
      stderrLimitBytes: 1_024,
    },
    toolContext(),
    undefined,
  );
}

async function runShell(sandbox: ReturnType<typeof createSandbox>): Promise<unknown> {
  return sandbox.runShell(
    {
      command: 'node',
      args: ['--version'],
      timeoutMs: 1_000,
      stdoutLimitBytes: 1_024,
      stderrLimitBytes: 1_024,
    },
    toolContext(),
    undefined,
  );
}

function toolContext(): ToolExecutionContext {
  return {
    identityContext: {
      tenantId: brand<string, 'TenantId'>('tenant-sandbox-errors'),
      subjectId: brand<string, 'SubjectId'>('subject-sandbox-errors'),
      displayName: 'Sandbox error mapping test',
    },
    agentId: brand<string, 'AgentId'>('agent-sandbox-errors'),
    agentVersion: brand<string, 'AgentVersion'>('v1'),
    sessionId: brand<string, 'SessionId'>('session-sandbox-errors'),
    requestId: brand<string, 'MessageId'>('request-sandbox-errors'),
    runId: brand<string, 'RequestRunId'>('run-sandbox-errors'),
    requestContextId: brand<string, 'RequestContextId'>('context-sandbox-errors'),
    stepId: 'turn-1',
    toolCallId: 'tool-python-1',
    timeoutMs: 1_000,
  };
}

function defaultPolicy(): AgentWorkspacePolicy {
  return {
    schemaVersion: 'nextagent.agent-workspace-policy.v1',
    isolationMode: 'subject',
    roots: [
      { kind: 'workspace', logicalPath: 'workspace', access: 'readWrite' },
      { kind: 'systemResources', logicalPath: '.nextagent', access: 'read' },
      { kind: 'temp', logicalPath: 'temp', access: 'readWrite' },
    ],
  };
}

async function* streamBytes(bytes: Uint8Array): AsyncIterable<Uint8Array> {
  yield bytes;
}
