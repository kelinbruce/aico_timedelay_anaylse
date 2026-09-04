import {
  createCapabilitySubsystem,
  bashCapabilityId,
  pythonCapabilityId,
  pythonInputSchema,
  pythonToolDefinition,
  type ToolDependencies,
} from '@nextagent/agent-capability';
import { AgentError, brand, type JsonObject } from '@nextagent/agent-common';
import type { AgentAssembly } from '@nextagent/agent-contracts/agent-assembly';
import type { CapabilityInvocationRequest } from '@nextagent/agent-contracts/capability';
import { describe, expect, it, vi } from 'vitest';

describe('Python capability boundary', () => {
  it('registers Python as an independent builtin tool descriptor', async () => {
    const subsystem = createCapabilitySubsystem({
      read: { workspaceDir: process.cwd() },
      toolDependencies: sandboxDeps(),
    });

    const descriptors = await subsystem.catalog.listAvailable({
      tenantId: tenantId(),
      subjectId: subjectId(),
      agentAssembly: assembly(),
      includeUnavailable: true,
    });
    const python = descriptors.find((candidate) => candidate.capabilityId === pythonCapabilityId);
    const bash = descriptors.find((candidate) => candidate.capabilityId === bashCapabilityId);

    expect(python).toMatchObject({
      capabilityId: 'Python',
      availabilityStatus: 'AVAILABLE',
      inputSchema: pythonInputSchema,
    });
    expect(bash).toBeDefined();
  });

  it('accepts valid code input and returns structured execution output', async () => {
    const runPython = vi.fn<NonNullable<ToolDependencies['sandbox']>['runPython']>(async () => ({
      stdout: 'sum=3\n',
      stderr: '',
      exitCode: 0,
      stdoutTruncated: false,
      stderrTruncated: false,
      timedOut: false,
    }));
    const subsystem = createCapabilitySubsystem({
      read: { workspaceDir: process.cwd() },
      toolDependencies: { sandbox: { runShell: vi.fn(), runPython, startBackgroundShell: vi.fn(), runShellBackgroundable: vi.fn() } },
    });

    const result = await subsystem.invocationPort.invoke(request({ code: 'print(1 + 2)', args: ['alpha'] }, 30_000), new AbortController().signal);

    expect(result).toMatchObject({
      status: 'SUCCEEDED',
      structuredPayload: {
        exit_code: 0,
        stdout: 'sum=3\n',
        stderr: '',
        timed_out: false,
      },
    });
    expect(runPython).toHaveBeenCalledWith(
      expect.objectContaining({
        command: 'print(1 + 2)',
        args: ['alpha'],
        timeoutMs: 30_000,
        stdoutLimitBytes: 1_000_000,
        stderrLimitBytes: 1_000_000,
      }),
      expect.objectContaining({
        runId: 'run-python',
        identityContext: expect.objectContaining({ tenantId: 'tenant-python', subjectId: 'subject-python' }),
      }),
      expect.any(AbortSignal),
    );
    expect(JSON.stringify(runPython.mock.calls[0]?.[0])).not.toContain('tenant-python');
    expect(JSON.stringify(runPython.mock.calls[0]?.[0])).not.toContain('subject-python');
  });

  it('keeps non-zero exit as structured output instead of a capability failure', async () => {
    const subsystem = createCapabilitySubsystem({
      read: { workspaceDir: process.cwd() },
      toolDependencies: {
        sandbox: {
          runShell: vi.fn(),
          startBackgroundShell: vi.fn(),

          runShellBackgroundable: vi.fn(),
          runPython: vi.fn(async () => ({
            stdout: '',
            stderr: 'boom\n',
            exitCode: 3,
            stdoutTruncated: false,
            stderrTruncated: false,
            timedOut: false,
          })),
        },
      },
    });

    const result = await subsystem.invocationPort.invoke(request({ code: 'raise SystemExit(3)' }), new AbortController().signal);

    expect(result).toMatchObject({
      status: 'SUCCEEDED',
      structuredPayload: {
        exit_code: 3,
        stdout: '',
        stderr: 'boom\n',
        timed_out: false,
      },
    });
  });

  it('enforces empty code, args budget, and timeout validation', async () => {
    const runPython = vi.fn<NonNullable<ToolDependencies['sandbox']>['runPython']>(async () => ({
      stdout: '',
      stderr: '',
      exitCode: 0,
      stdoutTruncated: false,
      stderrTruncated: false,
      timedOut: false,
    }));
    const subsystem = createCapabilitySubsystem({
      read: { workspaceDir: process.cwd() },
      toolDependencies: { sandbox: { runShell: vi.fn(), runPython, startBackgroundShell: vi.fn(), runShellBackgroundable: vi.fn() } },
    });

    const invalidInputs: ReadonlyArray<[JsonObject, string, { readonly constraint?: string; readonly path?: string } | undefined]> = [
      [{ code: '   ' }, 'Python code must be a non-empty string.', undefined],
      [
        { code: 'print(1)', args: Array.from({ length: 101 }, (_, index) => String(index)) },
        'Input validation failed for 1 constraint.',
        { path: '/args', constraint: 'maxItems' },
      ],
      [{ code: 'print(1)', args: ['a'.repeat(8_193)] }, 'Python args must not exceed 8192 UTF-8 bytes in total.', undefined],
      [{ code: 'print(1)', timeout_ms: 0 }, 'Input validation failed for 1 constraint.', { path: '/timeout_ms', constraint: 'minimum' }],
    ];

    for (const [input, message, violation] of invalidInputs) {
      const result = await subsystem.invocationPort.invoke(request(input), new AbortController().signal);
      expect(result.status, JSON.stringify(input)).toBe('FAILED');
      expect(result.safeError?.message).toContain(message);
      if (violation !== undefined) {
        expect(result.safeError?.safeDetails).toMatchObject({
          violations: [{ path: violation.path, constraint: violation.constraint }],
        });
      }
    }
    expect(runPython).not.toHaveBeenCalled();
  });

  it('caps timeout by tool policy and trusted invocation timeout', async () => {
    const runPython = vi.fn<NonNullable<ToolDependencies['sandbox']>['runPython']>(async () => ({
      stdout: '',
      stderr: '',
      exitCode: 0,
      stdoutTruncated: false,
      stderrTruncated: false,
      timedOut: false,
    }));
    const subsystem = createCapabilitySubsystem({
      read: { workspaceDir: process.cwd() },
      toolDependencies: { sandbox: { runShell: vi.fn(), runPython, startBackgroundShell: vi.fn(), runShellBackgroundable: vi.fn() } },
    });

    await subsystem.invocationPort.invoke(request({ code: "print('default')" }, 8_000), new AbortController().signal);
    await subsystem.invocationPort.invoke(request({ code: "print('max')", timeout_ms: 200_000 }, 150_000), new AbortController().signal);

    expect(runPython.mock.calls[0]?.[0]).toMatchObject({ timeoutMs: 8_000 });
    expect(runPython.mock.calls[1]?.[0]).toMatchObject({ timeoutMs: 120_000 });
  });

  it('maps timeout and sandbox failure into unified capability failure truth', async () => {
    const timedOutSubsystem = createCapabilitySubsystem({
      read: { workspaceDir: process.cwd() },
      toolDependencies: {
        sandbox: {
          runShell: vi.fn(),
          startBackgroundShell: vi.fn(),

          runShellBackgroundable: vi.fn(),
          runPython: vi.fn(async () => ({
            stdout: 'partial',
            stderr: '',
            exitCode: -1,
            stdoutTruncated: false,
            stderrTruncated: false,
            timedOut: true,
          })),
        },
      },
    });

    const timedOut = await timedOutSubsystem.invocationPort.invoke(request({ code: 'while True:\n  pass' }), new AbortController().signal);
    expect(timedOut).toMatchObject({
      status: 'TIMED_OUT',
      structuredPayload: {
        exit_code: -1,
        stdout: 'partial',
        timed_out: true,
      },
      safeError: {
        code: 'SANDBOX_TIMEOUT',
        category: 'TIMEOUT',
        retryable: false,
        message: expect.stringMatching(/existing.*stdout.*stderr.*reduce.*code.*input/iu),
      },
    });

    const unavailableSubsystem = createCapabilitySubsystem({
      read: { workspaceDir: process.cwd() },
      toolDependencies: {
        sandbox: {
          runShell: vi.fn(),
          startBackgroundShell: vi.fn(),

          runShellBackgroundable: vi.fn(),
          runPython: vi.fn(async () => {
            throw new AgentError({
              code: 'PYTHON_EXECUTION_UNAVAILABLE',
              message: 'Python execution is unavailable.',
              category: 'UNAVAILABLE',
              retryable: false,
            });
          }),
        },
      },
    });

    const unavailable = await unavailableSubsystem.invocationPort.invoke(request({ code: 'print(1)' }), new AbortController().signal);
    expect(unavailable).toMatchObject({
      status: 'FAILED',
      structuredPayload: {},
      safeError: {
        code: 'PYTHON_EXECUTION_UNAVAILABLE',
        category: 'UNAVAILABLE',
        retryable: false,
      },
    });
  });

  it('returns an empty timeout payload when the sandbox produced no safe output', async () => {
    const subsystem = createCapabilitySubsystem({
      read: { workspaceDir: process.cwd() },
      toolDependencies: {
        sandbox: {
          runShell: vi.fn(),
          startBackgroundShell: vi.fn(),
          runShellBackgroundable: vi.fn(),
          runPython: vi.fn(async () => ({
            stdout: '',
            stderr: '',
            exitCode: -1,
            stdoutTruncated: false,
            stderrTruncated: false,
            timedOut: true,
          })),
        },
      },
    });

    const result = await subsystem.invocationPort.invoke(request({ code: 'while True:\n  pass' }), new AbortController().signal);

    expect(result).toMatchObject({
      status: 'TIMED_OUT',
      structuredPayload: {},
      safeError: {
        code: 'SANDBOX_TIMEOUT',
        category: 'TIMEOUT',
        retryable: false,
        message: expect.stringMatching(/without.*output.*reduce.*code.*input/iu),
      },
    });
  });

  it('keeps Python unavailable when the sandbox dependency is absent', async () => {
    const subsystem = createCapabilitySubsystem({
      read: { workspaceDir: process.cwd() },
    });

    const descriptor = (
      await subsystem.catalog.listAvailable({
        tenantId: tenantId(),
        subjectId: subjectId(),
        agentAssembly: assembly(),
        includeUnavailable: true,
      })
    ).find((candidate) => candidate.capabilityId === pythonCapabilityId);

    expect(descriptor).toMatchObject({
      availabilityStatus: 'UNAVAILABLE',
      availabilityReason: 'TOOL_DEPENDENCY_MISSING',
    });
  });

  it('does not reuse bash command parsing or python script allowlist semantics', async () => {
    const runPython = vi.fn<NonNullable<ToolDependencies['sandbox']>['runPython']>(async () => ({
      stdout: 'ok\n',
      stderr: '',
      exitCode: 0,
      stdoutTruncated: false,
      stderrTruncated: false,
      timedOut: false,
    }));
    const subsystem = createCapabilitySubsystem({
      read: { workspaceDir: process.cwd() },
      toolDependencies: { sandbox: { runShell: vi.fn(), runPython, startBackgroundShell: vi.fn(), runShellBackgroundable: vi.fn() } },
      toolCatalogConfig: {
        tools: {
          Bash: {
            config: {
              allowedPythonScripts: ['diagnostics/check_alarm.py'],
            },
          },
        },
      },
    });

    const result = await subsystem.invocationPort.invoke(request({ code: "print('line1')\nprint('line2');" }), new AbortController().signal);

    expect(result).toMatchObject({
      status: 'SUCCEEDED',
      structuredPayload: { stdout: 'ok\n' },
    });
    expect(runPython).toHaveBeenCalledWith(
      expect.objectContaining({ command: "print('line1')\nprint('line2');" }),
      expect.anything(),
      expect.any(AbortSignal),
    );
  });

  it('blocks python execution and returns a model-visible failure when nl2py guard rejects the code', async () => {
    const runPython = vi.fn<NonNullable<ToolDependencies['sandbox']>['runPython']>(async () => ({
      stdout: '',
      stderr: '',
      exitCode: 0,
      stdoutTruncated: false,
      stderrTruncated: false,
      timedOut: false,
    }));
    const checkNl2Python = vi.fn(async () => ({
      status: false,
      errorMsg: ['代码行号1，导入包：禁止导入email。'],
    }));
    const subsystem = createCapabilitySubsystem({
      read: { workspaceDir: process.cwd() },
      toolDependencies: {
        sandbox: { runShell: vi.fn(), runPython, startBackgroundShell: vi.fn(), runShellBackgroundable: vi.fn() },
        guardrail: {
          checkNl2Python,
          checkQuestion: vi.fn(),
          checkAnswer: vi.fn(async () => ({ isLegal: true, refusalMessage: '' })),
          checkKnowledge: vi.fn(async () => ({ isLegal: true })),
        },
      },
    });

    const result = await subsystem.invocationPort.invoke(request({ code: 'import email' }), new AbortController().signal);

    expect(result.status).toBe('FAILED');
    expect(result).toMatchObject({
      safeError: {
        code: 'NL2PY_GUARD_BLOCKED',
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
      },
    });
    expect(result.safeError?.safeDetails).not.toHaveProperty('reasonCode');
    expect(JSON.stringify(result)).not.toContain('禁止导入email');
    expect(runPython).not.toHaveBeenCalled();
    expect(checkNl2Python).toHaveBeenCalledWith(expect.objectContaining({ content: 'import email' }), expect.any(AbortSignal));
  });

  it('runs python when the nl2py guard passes', async () => {
    const runPython = vi.fn<NonNullable<ToolDependencies['sandbox']>['runPython']>(async () => ({
      stdout: 'ok\n',
      stderr: '',
      exitCode: 0,
      stdoutTruncated: false,
      stderrTruncated: false,
      timedOut: false,
    }));
    const subsystem = createCapabilitySubsystem({
      read: { workspaceDir: process.cwd() },
      toolDependencies: {
        sandbox: { runShell: vi.fn(), runPython, startBackgroundShell: vi.fn(), runShellBackgroundable: vi.fn() },
        guardrail: {
          checkNl2Python: vi.fn(async () => ({ status: true, errorMsg: [] })),
          checkQuestion: vi.fn(),
          checkAnswer: vi.fn(async () => ({ isLegal: true, refusalMessage: '' })),
          checkKnowledge: vi.fn(async () => ({ isLegal: true })),
        },
      },
    });

    const result = await subsystem.invocationPort.invoke(request({ code: 'print(1)' }), new AbortController().signal);

    expect(result.status).toBe('SUCCEEDED');
    expect(runPython).toHaveBeenCalledTimes(1);
  });

  it('classifies missing sandbox composition as an internal execution failure', async () => {
    await expect(pythonToolDefinition.tool.execute({ code: 'print(1)' })).rejects.toMatchObject({
      code: 'CAPABILITY_EXECUTION_FAILED',
      category: 'INTERNAL',
      retryable: false,
    });
  });

  it('normalizes an invalid sandbox response as an internal execution failure', async () => {
    const subsystem = createCapabilitySubsystem({
      read: { workspaceDir: process.cwd() },
      toolDependencies: {
        sandbox: {
          runShell: vi.fn(),
          startBackgroundShell: vi.fn(),
          runShellBackgroundable: vi.fn(),
          runPython: vi.fn(async () => ({ stdout: 123 }) as never),
        },
      },
    });

    const result = await subsystem.invocationPort.invoke(request({ code: 'print(1)' }), new AbortController().signal);

    expect(result).toMatchObject({
      status: 'FAILED',
      structuredPayload: {},
      safeError: { code: 'CAPABILITY_EXECUTION_FAILED', category: 'INTERNAL', retryable: false },
    });
    expect(result.safeError?.safeDetails).toBeUndefined();
  });

  it('excludes preamble from nl2py guard check and prepends it at sandbox execution', async () => {
    const runPython = vi.fn<NonNullable<ToolDependencies['sandbox']>['runPython']>(async () => ({
      stdout: 'ok\n',
      stderr: '',
      exitCode: 0,
      stdoutTruncated: false,
      stderrTruncated: false,
      timedOut: false,
    }));
    const checkNl2Python = vi.fn(async (_input: { content: string }, _signal?: AbortSignal) => ({ status: true, errorMsg: [] as string[] }));
    const subsystem = createCapabilitySubsystem({
      read: { workspaceDir: process.cwd() },
      toolDependencies: {
        sandbox: { runShell: vi.fn(), runPython, startBackgroundShell: vi.fn(), runShellBackgroundable: vi.fn() },
        guardrail: {
          checkNl2Python,
          checkQuestion: vi.fn(),
          checkAnswer: vi.fn(async () => ({ isLegal: true, refusalMessage: '' })),
          checkKnowledge: vi.fn(async () => ({ isLegal: true })),
        },
      },
    });

    const preamble = 'data={"k":"v"}\nx=42';
    const code = 'print(x)';
    const result = await subsystem.invocationPort.invoke(request({ code, preamble }), new AbortController().signal);

    expect(result.status).toBe('SUCCEEDED');
    expect(checkNl2Python).toHaveBeenCalledWith(expect.objectContaining({ content: code }), expect.any(AbortSignal));
    const guardCallArg = checkNl2Python.mock.calls[0]![0] as JsonObject;
    expect(JSON.stringify(guardCallArg)).not.toContain('preamble');
    expect(JSON.stringify(guardCallArg)).not.toContain('data=');
    expect(runPython).toHaveBeenCalledTimes(1);
    const command = runPython.mock.calls[0]![0].command as string;
    expect(command).toBe(`${preamble}\n${code}`);
  });

  it('skips the nl2py guard when no guardrail dependency is present', async () => {
    const runPython = vi.fn<NonNullable<ToolDependencies['sandbox']>['runPython']>(async () => ({
      stdout: 'ok\n',
      stderr: '',
      exitCode: 0,
      stdoutTruncated: false,
      stderrTruncated: false,
      timedOut: false,
    }));
    const subsystem = createCapabilitySubsystem({
      read: { workspaceDir: process.cwd() },
      toolDependencies: { sandbox: { runShell: vi.fn(), runPython, startBackgroundShell: vi.fn(), runShellBackgroundable: vi.fn() } },
    });

    const result = await subsystem.invocationPort.invoke(request({ code: 'print(1)' }), new AbortController().signal);

    expect(result.status).toBe('SUCCEEDED');
    expect(runPython).toHaveBeenCalledTimes(1);
  });
});

function sandboxDeps(): ToolDependencies {
  return {
    sandbox: {
      runShell: vi.fn(),
      startBackgroundShell: vi.fn(),

      runShellBackgroundable: vi.fn(),
      runPython: vi.fn(async () => ({
        stdout: '',
        stderr: '',
        exitCode: 0,
        stdoutTruncated: false,
        stderrTruncated: false,
        timedOut: false,
      })),
    },
  };
}

function request(argumentsValue: JsonObject, timeoutMs = 30_000): CapabilityInvocationRequest {
  return {
    invocationId: 'invoke-python',
    capabilityId: pythonCapabilityId,
    arguments: argumentsValue,
    sessionId: brand<string, 'SessionId'>('session-python'),
    requestId: brand<string, 'MessageId'>('request-python'),
    runId: brand<string, 'RequestRunId'>('run-python'),
    requestContextId: brand<string, 'RequestContextId'>('context-python'),
    stepId: 'turn-1',
    identityContext: { tenantId: tenantId(), subjectId: subjectId(), displayName: 'Python tester' },
    agentId: brand<string, 'AgentId'>('default-agent'),
    agentVersion: brand<string, 'AgentVersion'>('v1'),
    timeoutMs,
  };
}

function assembly(): AgentAssembly {
  return {
    agentId: brand<string, 'AgentId'>('default-agent'),
    agentType: brand<string, 'AgentType'>('default'),
    agentVersion: brand<string, 'AgentVersion'>('v1'),
    agentAssemblyRef: 'default-agent:v1',
    displayName: 'Default Agent',
    description: 'Telecom test agent.',
    workspacePolicy: {
      schemaVersion: 'nextagent.agent-workspace-policy.v1',
      isolationMode: 'subject',
      roots: [
        { kind: 'workspace', logicalPath: 'workspace', access: 'readWrite' },
        { kind: 'systemResources', logicalPath: '.nextagent', access: 'read' },
        { kind: 'temp', logicalPath: 'temp', access: 'readWrite' },
      ],
    },
    modelIds: ['test-model'],
    capabilityBindings: [],
    userInvocable: true,
    agentInvocation: 'BOUND',
    runtimeSettings: { requestTimeoutMs: 1000 },
  };
}

function tenantId() {
  return brand<string, 'TenantId'>('tenant-python');
}

function subjectId() {
  return brand<string, 'SubjectId'>('subject-python');
}
