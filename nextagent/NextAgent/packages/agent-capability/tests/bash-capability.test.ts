import {
  bashCapabilityId,
  bashInputSchema,
  bashToolDefinition,
  createCapabilitySubsystem,
  parseBashCommand,
  type ToolDependencies,
} from '@nextagent/agent-capability';
import { brand, type JsonObject } from '@nextagent/agent-common';
import type { AgentAssembly } from '@nextagent/agent-contracts/agent-assembly';
import type { CapabilityInvocationRequest } from '@nextagent/agent-contracts/capability';
import { describe, expect, it, vi } from 'vitest';

const builtinExecutableIt = process.platform === 'win32' || process.platform === 'linux' ? it : it.skip;

describe('bash capability boundary', () => {
  builtinExecutableIt('uses TonyClaw-compatible foreground input and returns wrapped business output', async () => {
    const runShell = vi.fn<NonNullable<ToolDependencies['sandbox']>['runShell']>(async () => ({
      stdout: 'alarm-ok\n',
      stderr: '',
      exitCode: 0,
      stdoutTruncated: false,
      stderrTruncated: false,
      timedOut: false,
    }));
    const subsystem = createCapabilitySubsystem({
      read: { workspaceDir: process.cwd() },
      toolDependencies: sandboxDeps(runShell),
    });
    const descriptors = await subsystem.catalog.listAvailable({
      tenantId: tenantId(),
      subjectId: subjectId(),
      agentAssembly: assembly(),
      includeUnavailable: true,
    });
    const descriptor = descriptors.find((candidate) => candidate.capabilityId === bashCapabilityId);

    expect(descriptor).toMatchObject({
      capabilityId: 'Bash',
      availabilityStatus: 'AVAILABLE',
      inputSchema: bashInputSchema,
    });
    expect(descriptor?.description).toContain('executable authority is owned by the composed sandbox policy');
    expect(descriptor?.description).toContain('Bash supports two invocation modes');
    expect(descriptor?.description).toContain('Command-string mode');
    expect(descriptor?.description).toContain('Argv mode');
    expect(descriptor?.description).toContain('env` supports only `PYTHONPATH`');
    expect(descriptor?.description).toContain('header.X-Subject-Id`/`X-Display-Name');
    expect(descriptor?.description).toContain('Never split one command between `command` and `args`');
    expect(descriptor?.description).toContain('current verified Skill projections');
    expect(descriptor?.description).toContain('multiple matches fail with root-qualified candidates');
    expect(descriptor?.description).toContain('Explicit root-qualified paths are never rewritten');
    expect(JSON.stringify(descriptor?.inputSchema)).toContain('structured argv entries');
    expect(JSON.stringify(descriptor?.inputSchema)).toContain('Only PYTHONPATH is accepted');
    expect(JSON.stringify(descriptor?.inputSchema)).toContain('NEXTAGENT');
    expect(JSON.stringify(descriptor?.inputSchema)).toContain('sandbox gateway');
    expect(JSON.stringify(descriptor?.inputSchema)).not.toContain('run_in_background');

    const result = await subsystem.invocationPort.invoke(
      request({ command: 'cat logs/alarm.txt', description: 'Read alarm log', timeout: 1000 }),
      new AbortController().signal,
    );

    expect(result).toMatchObject({
      status: 'SUCCEEDED',
      structuredPayload: {
        stdout: 'alarm-ok\n',
        stderr: '',
        exitCode: 0,
        stdoutTruncated: false,
        stderrTruncated: false,
      },
    });
    expect(runShell).toHaveBeenCalledWith(
      expect.objectContaining({
        command: 'cat',
        args: ['logs/alarm.txt'],
        timeoutMs: 1000,
      }),
      expect.objectContaining({
        runId: 'run-bash',
        identityContext: expect.objectContaining({ tenantId: 'tenant-bash', subjectId: 'subject-bash' }),
      }),
      expect.any(AbortSignal),
    );
    expect(JSON.stringify(runShell.mock.calls[0]?.[0])).not.toContain('tenant-bash');
    expect(runShell.mock.calls[0]?.[0]).toMatchObject({
      environment: expect.objectContaining({
        NEXTAGENT_USER_ID: 'subject-bash',
        NEXTAGENT_USER_NAME: 'Bash tester',
        NEXTAGENT_CHAT_ID: 'request-bash',
        NEXTAGENT_CONVERSATION_ID: 'session-bash',
      }),
    });
  });

  builtinExecutableIt('resolves a unique Skill-relative script before sandbox execution', async () => {
    const runPython = vi.fn<NonNullable<ToolDependencies['sandbox']>['runPython']>(async () => ({
      stdout: 'skill-ok\n',
      stderr: '',
      exitCode: 0,
      stdoutTruncated: false,
      stderrTruncated: false,
      timedOut: false,
    }));
    const resolveSkillResourcePath = vi.fn(async () => ({
      status: 'resolved' as const,
      logicalPath: '.nextagent/skills/0123456789abcdef/demo-skill/scripts/query.py',
    }));
    const workspaceFiles = { resolveSkillResourcePath } as unknown as NonNullable<ToolDependencies['workspaceFiles']>;
    const subsystem = createCapabilitySubsystem({
      toolDependencies: { ...sandboxDeps(runPython), workspaceFiles },
    });
    const input = { command: 'python', args: ['demo-skill/scripts/query.py', '--limit', '10'] };

    const result = await subsystem.invocationPort.invoke(request(input), new AbortController().signal);

    expect(result.status).toBe('SUCCEEDED');
    expect(resolveSkillResourcePath).toHaveBeenCalledWith('demo-skill/scripts/query.py', expect.objectContaining({ runId: 'run-bash' }));
    expect(runPython).toHaveBeenCalledWith(
      expect.objectContaining({
        command: 'python',
        args: ['.nextagent/skills/0123456789abcdef/demo-skill/scripts/query.py', '--limit', '10'],
      }),
      expect.anything(),
      expect.any(AbortSignal),
    );
    expect(input).toEqual({ command: 'python', args: ['demo-skill/scripts/query.py', '--limit', '10'] });
  });

  builtinExecutableIt('rejects ambiguous Skill-relative scripts before sandbox execution', async () => {
    const runPython = vi.fn<NonNullable<ToolDependencies['sandbox']>['runPython']>();
    const candidates = ['.nextagent/skills/0123456789abcdef/alpha/scripts/run.py', '.nextagent/skills/fedcba9876543210/beta/scripts/run.py'];
    const workspaceFiles = {
      async resolveSkillResourcePath() {
        return { status: 'ambiguous' as const, candidates };
      },
    } as unknown as NonNullable<ToolDependencies['workspaceFiles']>;
    const subsystem = createCapabilitySubsystem({
      toolDependencies: { ...sandboxDeps(runPython), workspaceFiles },
    });

    const result = await subsystem.invocationPort.invoke(request({ command: 'python scripts/run.py' }), new AbortController().signal);

    expect(result).toMatchObject({
      status: 'FAILED',
      safeError: {
        code: 'SKILL_RESOURCE_PATH_AMBIGUOUS',
        category: 'VALIDATION',
        retryable: false,
        safeDetails: { candidates },
      },
    });
    expect(runPython).not.toHaveBeenCalled();
  });

  builtinExecutableIt('does not correct unsafe, non-script, root-qualified, or composed Bash arguments', async () => {
    const runShell = vi.fn<NonNullable<ToolDependencies['sandbox']>['runShell']>(async () => ({
      stdout: '',
      stderr: '',
      exitCode: 0,
      stdoutTruncated: false,
      stderrTruncated: false,
      timedOut: false,
    }));
    const resolveSkillResourcePath = vi.fn();
    const workspaceFiles = { resolveSkillResourcePath } as unknown as NonNullable<ToolDependencies['workspaceFiles']>;
    const subsystem = createCapabilitySubsystem({
      toolDependencies: { ...sandboxDeps(runShell), workspaceFiles },
    });
    const unchangedInputs = [
      { command: 'python', args: ['../scripts/run.py'] },
      { command: 'python', args: ['/scripts/run.py'] },
      { command: 'python', args: ['workspace/scripts/run.py'] },
      { command: 'python', args: ['.nextagent/skills/0123456789abcdef/demo/scripts/run.py'] },
      { command: 'python', args: ['demo/references/input.py'] },
      { command: 'python', args: ['demo/scripts/run.sh'] },
      { command: 'sh', args: ['demo/scripts/run.py'] },
      { command: 'python', args: ['demo/scripts/run.py', '|', 'cat'] },
      { command: 'python', args: ['demo/scripts/run.py', '>', 'workspace/out.txt'] },
      { command: 'python', args: ['demo/scripts/run.py', '$(echo)'] },
      { command: 'env', args: ['python', 'demo/scripts/run.py'] },
    ];

    for (const input of unchangedInputs) {
      const result = await subsystem.invocationPort.invoke(request(input), new AbortController().signal);
      expect(result.status, JSON.stringify(input)).toBe('SUCCEEDED');
    }

    expect(resolveSkillResourcePath).not.toHaveBeenCalled();
    expect(runShell.mock.calls.map(([input]) => input.args)).toEqual(unchangedInputs.map((input) => input.args));
  });

  builtinExecutableIt('normalizes clipc subscribe stdout before returning Bash results', async () => {
    const firstDataRaw = JSON.stringify({ char: 'H', timestamp: '2026-07-07T11:17:54.860025100+01:00', index: 0 });
    const secondDataRaw = JSON.stringify({ char: 'e', timestamp: '2026-07-07T11:17:55.876547100+01:00', index: 1 });
    const runShell = vi.fn<NonNullable<ToolDependencies['sandbox']>['runShell']>(async () => ({
      stdout: [
        JSON.stringify({
          type: 'clip.subscribe.event',
          operation: 'subscribe',
          target: 'getHelloStream',
          ref: '/api/hello/stream',
          trace_id: 'trace-should-stay-private',
          index: 1,
          event: 'char',
          data_raw: firstDataRaw,
          data_json: { char: 'H', timestamp: '2026-07-07T11:17:54.860025100+01:00', index: 0 },
          received_at: 1783418680058,
        }),
        JSON.stringify({
          type: 'clip.subscribe.event',
          operation: 'subscribe',
          target: 'getHelloStream',
          ref: '/api/hello/stream',
          trace_id: 'trace-should-stay-private',
          index: 2,
          event: 'char',
          data_raw: secondDataRaw,
          data_json: { char: 'e', timestamp: '2026-07-07T11:17:55.876547100+01:00', index: 1 },
          received_at: 1783418681062,
        }),
        JSON.stringify({
          type: 'clip.subscribe.completed',
          operation: 'subscribe',
          target: 'getHelloStream',
          ref: '/api/hello/stream',
          trace_id: 'trace-should-stay-private',
          reason: 'max_events',
          event_count: 2,
          received_at: 1783418681063,
        }),
      ].join('\n'),
      stderr: '',
      exitCode: 0,
      stdoutTruncated: false,
      stderrTruncated: false,
      timedOut: false,
    }));
    const subsystem = createCapabilitySubsystem({
      read: { workspaceDir: process.cwd() },
      toolDependencies: sandboxDeps(runShell),
    });

    const result = await subsystem.invocationPort.invoke(
      request({ command: 'clipc subscribe getHelloStream /api/hello/stream --timeout-ms 20000 --max-events 2 --format jsonl' }),
      new AbortController().signal,
    );

    expect(result).toMatchObject({
      status: 'SUCCEEDED',
      structuredPayload: {
        stdout: `${firstDataRaw}\n${secondDataRaw}`,
        stderr: '',
        exitCode: 0,
        stdoutTruncated: false,
        stderrTruncated: false,
      },
    });
    const serialized = JSON.stringify(result.structuredPayload);
    expect(serialized).not.toContain('clip.subscribe.event');
    expect(serialized).not.toContain('trace-should-stay-private');
    expect(serialized).not.toContain('/api/hello/stream');
    expect(runShell).toHaveBeenCalledWith(
      expect.objectContaining({
        command: 'clipc',
        args: ['subscribe', 'getHelloStream', '/api/hello/stream', '--timeout-ms', '20000', '--max-events', '2', '--format', 'jsonl'],
      }),
      expect.objectContaining({ runId: 'run-bash' }),
      expect.any(AbortSignal),
    );
  });

  it('injects trusted user headers into clipc params', async () => {
    const platformSpy = vi.spyOn(process, 'platform', 'get').mockReturnValue('linux');
    const runShell = vi.fn<NonNullable<ToolDependencies['sandbox']>['runShell']>(async () => ({
      stdout: 'clipc-ok',
      stderr: '',
      exitCode: 0,
      stdoutTruncated: false,
      stderrTruncated: false,
      timedOut: false,
    }));
    const subsystem = createCapabilitySubsystem({
      read: { workspaceDir: process.cwd() },
      toolDependencies: sandboxDeps(runShell),
    });

    const runtimeContext = {
      flowVariables: {
        activeSkillContext: {
          apiHeaderParams: 'X-Subject-Id,X-Display-Name',
        },
      },
    };

    const result = await subsystem.invocationPort.invoke(
      request({
        command:
          'clipc query IR-ShowChatProcessDetail /rest/naie/aiagentcore/v1/chat/detail/test --params \'{"header":{"X-Subject-Id":"forged-user","X-Display-Name":"Forged User","tenantId":"forged-tenant","traceId":"keep"}}\'',
      }),
      new AbortController().signal,
      runtimeContext,
    );

    platformSpy.mockRestore();
    expect(result.status).toBe('SUCCEEDED');
    expect(runShell).toHaveBeenCalledTimes(1);
    const call = runShell.mock.calls[0];
    expect(call?.[0]).toMatchObject({ command: 'clipc' });
    const args = call?.[0].args ?? [];
    const params = JSON.parse(args[args.indexOf('--params') + 1]!) as {
      header: { 'X-Subject-Id': string; 'X-Display-Name': string; tenantId: string; traceId: string };
    };
    expect(params.header).toEqual({
      'X-Subject-Id': 'subject-bash',
      'X-Display-Name': 'Bash tester',
      tenantId: 'forged-tenant',
      traceId: 'keep',
    });
  });

  it('does not inject clipc user headers when the active Skill does not opt in', async () => {
    const platformSpy = vi.spyOn(process, 'platform', 'get').mockReturnValue('linux');
    const runShell = vi.fn<NonNullable<ToolDependencies['sandbox']>['runShell']>(async () => ({
      stdout: 'clipc-ok',
      stderr: '',
      exitCode: 0,
      stdoutTruncated: false,
      stderrTruncated: false,
      timedOut: false,
    }));
    const subsystem = createCapabilitySubsystem({
      read: { workspaceDir: process.cwd() },
      toolDependencies: sandboxDeps(runShell),
    });

    await subsystem.invocationPort.invoke(
      request({
        command: 'clipc',
        args: ['query', 'target', '/ref', '--params', '{"header":{"X-Subject-Id":"forged-user","X-Display-Name":"Forged User"}}'],
      }),
      new AbortController().signal,
    );

    platformSpy.mockRestore();
    expect(runShell).toHaveBeenCalledWith(
      expect.objectContaining({
        command: 'clipc',
        args: ['query', 'target', '/ref', '--params', '{"header":{"X-Subject-Id":"forged-user","X-Display-Name":"Forged User"}}'],
      }),
      expect.anything(),
      expect.anything(),
    );
  });

  it('does not inject clipc user headers for unsupported command shapes', async () => {
    const platformSpy = vi.spyOn(process, 'platform', 'get').mockReturnValue('linux');
    const runShell = vi.fn<NonNullable<ToolDependencies['sandbox']>['runShell']>(async () => ({
      stdout: 'sandbox-ok',
      stderr: '',
      exitCode: 0,
      stdoutTruncated: false,
      stderrTruncated: false,
      timedOut: false,
    }));
    const subsystem = createCapabilitySubsystem({
      read: { workspaceDir: process.cwd() },
      toolDependencies: sandboxDeps(runShell),
    });

    const unchangedInputs = [
      { command: 'echo', args: ['hello', '--params', '{"header":{}}'] },
      { command: 'clipc', args: ['query', 'target', '/ref'] },
      { command: 'clipc', args: ['query', 'target', '/ref', '--params', 'not-json'] },
    ];
    for (const input of unchangedInputs) {
      await subsystem.invocationPort.invoke(request(input as JsonObject), new AbortController().signal);
    }

    platformSpy.mockRestore();
    expect(runShell.mock.calls.map(([input]) => input.args)).toEqual(unchangedInputs.map((input) => input.args));
  });

  builtinExecutableIt('delegates command authority decisions to the sandbox dependency', async () => {
    const runShell = vi.fn<NonNullable<ToolDependencies['sandbox']>['runShell']>(async () => ({
      stdout: 'sandbox-ok',
      stderr: '',
      exitCode: 0,
      stdoutTruncated: false,
      stderrTruncated: false,
      timedOut: false,
    }));
    const runPython = vi.fn<NonNullable<ToolDependencies['sandbox']>['runPython']>(async () => ({
      stdout: 'python-ok',
      stderr: '',
      exitCode: 0,
      stdoutTruncated: false,
      stderrTruncated: false,
      timedOut: false,
    }));
    const subsystem = createCapabilitySubsystem({
      read: { workspaceDir: process.cwd() },
      toolDependencies: {
        sandbox: {
          runShell,
          runPython,
          startBackgroundShell: async () => {
            throw new Error('startBackgroundShell is not configured for this test.');
          },
          runShellBackgroundable: async () => {
            throw new Error('runShellBackgroundable is not configured for this test.');
          },
        },
      },
      toolCatalogConfig: { tools: { Bash: { config: { allowedCommands: ['curl'], allowedPythonScripts: ['scripts/ignored.py'] } } } },
    });

    const schemaValidationError = await subsystem.invocationPort.invoke(
      request({ command: 'cat logs/alarm.txt', run_in_background: true }),
      new AbortController().signal,
    );
    expect(schemaValidationError.status).toBe('FAILED');
    expect(schemaValidationError.safeError?.code).toBe('CAPABILITY_INPUT_INVALID');

    for (const command of [
      'cat logs/a | grep ERROR',
      'cat logs/a && cat logs/b',
      'curl https://example.com',
      'git status',
      'npm test',
      'node diagnostics/check.js',
    ]) {
      const result = await subsystem.invocationPort.invoke(request({ command }), new AbortController().signal);
      expect(result.status, command).toBe('SUCCEEDED');
    }
    expect(runShell).toHaveBeenCalledWith(
      expect.objectContaining({ command: 'curl', args: ['--max-time', '600', 'https://example.com'] }),
      expect.objectContaining({ runId: 'run-bash' }),
      expect.any(AbortSignal),
    );

    const pythonResult = await subsystem.invocationPort.invoke(request({ command: 'python -c print(1)' }), new AbortController().signal);
    expect(pythonResult).toMatchObject({
      status: 'FAILED',
      safeError: {
        code: 'CAPABILITY_INPUT_INVALID',
        category: 'VALIDATION',
        retryable: true,
        safeDetails: {
          reasonCode: 'BASH_PYTHON_INLINE_MODE_UNSUPPORTED',
          hint: expect.stringContaining('Python tool'),
        },
      },
    });
    expect(runPython).not.toHaveBeenCalled();
  });

  builtinExecutableIt('rejects unsupported Python CLI modes before sandbox submission', async () => {
    const runPython = vi.fn<NonNullable<ToolDependencies['sandbox']>['runPython']>();
    const subsystem = createCapabilitySubsystem({
      read: { workspaceDir: process.cwd() },
      toolDependencies: {
        sandbox: {
          runShell: async () => {
            throw new Error('runShell must not receive unsupported Python invocation.');
          },
          runPython,
          startBackgroundShell: async () => {
            throw new Error('startBackgroundShell is not configured for this test.');
          },
          runShellBackgroundable: async () => {
            throw new Error('runShellBackgroundable is not configured for this test.');
          },
        },
      },
    });

    for (const input of [
      { command: 'python -c print(1)' },
      { command: 'python', args: ['-c', 'print(1)'] },
      { command: 'python -' },
      { command: 'python --version extra' },
      { command: 'python -m not_a_dotted_module' },
      { command: 'python' },
      { command: 'python', args: [] },
    ]) {
      const result = await subsystem.invocationPort.invoke(request(input), new AbortController().signal);
      expect(result.status, JSON.stringify(input)).toBe('FAILED');
      expect(result.safeError).toMatchObject({
        code: 'CAPABILITY_INPUT_INVALID',
        category: 'VALIDATION',
        retryable: true,
      });
      expect(result.safeError?.safeDetails?.['hint']).toEqual(expect.stringContaining('Python tool'));
    }
    expect(runPython).not.toHaveBeenCalled();
  });

  builtinExecutableIt('rejects zero-argument Python REPL invocation with a dedicated reason code', async () => {
    const runPython = vi.fn<NonNullable<ToolDependencies['sandbox']>['runPython']>();
    const subsystem = createCapabilitySubsystem({
      read: { workspaceDir: process.cwd() },
      toolDependencies: {
        sandbox: {
          runShell: async () => {
            throw new Error('runShell must not receive a zero-argument Python invocation.');
          },
          runPython,
          startBackgroundShell: async () => {
            throw new Error('startBackgroundShell is not configured for this test.');
          },
          runShellBackgroundable: async () => {
            throw new Error('runShellBackgroundable is not configured for this test.');
          },
        },
      },
    });

    for (const command of ['python', 'python3']) {
      const result = await subsystem.invocationPort.invoke(request({ command }), new AbortController().signal);
      expect(result).toMatchObject({
        status: 'FAILED',
        safeError: {
          code: 'CAPABILITY_INPUT_INVALID',
          category: 'VALIDATION',
          retryable: true,
          safeDetails: {
            reasonCode: 'BASH_PYTHON_REPL_UNSUPPORTED',
            hint: expect.stringContaining('Python tool'),
          },
        },
      });
    }
    expect(runPython).not.toHaveBeenCalled();
  });

  builtinExecutableIt('allows exact Python version inspection through the Python sandbox dependency', async () => {
    const runPython = vi.fn<NonNullable<ToolDependencies['sandbox']>['runPython']>(async () => ({
      stdout: 'Python 3.11.0\n',
      stderr: '',
      exitCode: 0,
      stdoutTruncated: false,
      stderrTruncated: false,
      timedOut: false,
    }));
    const subsystem = createCapabilitySubsystem({
      read: { workspaceDir: process.cwd() },
      toolDependencies: {
        sandbox: {
          runShell: async () => {
            throw new Error('runShell must not receive Python version invocation.');
          },
          runPython,
          startBackgroundShell: async () => {
            throw new Error('startBackgroundShell is not configured for this test.');
          },
          runShellBackgroundable: async () => {
            throw new Error('runShellBackgroundable is not configured for this test.');
          },
        },
      },
    });

    const result = await subsystem.invocationPort.invoke(request({ command: 'python --version' }), new AbortController().signal);

    expect(result).toMatchObject({ status: 'SUCCEEDED', structuredPayload: { stdout: 'Python 3.11.0\n' } });
    expect(runPython).toHaveBeenCalledWith(
      expect.objectContaining({ command: 'python', args: ['--version'] }),
      expect.objectContaining({ runId: 'run-bash' }),
      expect.any(AbortSignal),
    );
  });

  it('tokenizes commands without owning command authorization', () => {
    expect(parseBashCommand("grep -n -F 'ALARM ACTIVE' logs/alarm.txt")).toEqual({
      executable: 'grep',
      args: ['-n', '-F', 'ALARM ACTIVE', 'logs/alarm.txt'],
    });
    expect(parseBashCommand('cd logs && python emit.py')).toEqual({
      executable: 'cd',
      args: ['logs', '&&', 'python', 'emit.py'],
    });
    expect(parseBashCommand('python .nextagent/skills/proj/rag-skill/scripts/rag_query.py --query "what is 5G"')).toEqual({
      executable: 'python',
      args: ['.nextagent/skills/proj/rag-skill/scripts/rag_query.py', '--query', 'what is 5G'],
    });
    expect(() => parseBashCommand("cat 'logs/alarm.txt")).toThrow();
    // Shell-escaped double-quoted payloads keep `\"`/`\\` escapes intact as one token.
    expect(parseBashCommand('curl -d "{\\"k\\":\\"v\\"}" http://x')).toEqual({
      executable: 'curl',
      args: ['-d', '{"k":"v"}', 'http://x'],
    });
    // Single quotes inside a double-quoted JSON value are preserved verbatim.
    expect(parseBashCommand('curl -d "{\\"q\\":\\"x\'y\\"}" http://x')).toEqual({
      executable: 'curl',
      args: ['-d', '{"q":"x\'y"}', 'http://x'],
    });
    // JSON escape sequences (e.g. `\n`) survive intact for downstream JSON.parse.
    expect(parseBashCommand('curl -d "{\\"k\\":\\"a\\\\nb\\"}" http://x')).toEqual({
      executable: 'curl',
      args: ['-d', '{"k":"a\\nb"}', 'http://x'],
    });
    // Single quote embedded inside a single-quoted JSON payload (e.g. "11'o clock")
    // is treated as a literal character, not a string-closing quote.
    expect(parseBashCommand('curl -d \'{"query":"11\'o clock"}\' http://x')).toEqual({
      executable: 'curl',
      args: ['-d', '{"query":"11\'o clock"}', 'http://x'],
    });
    expect(() => parseBashCommand('   ')).toThrow();
  });

  builtinExecutableIt('uses the default timeout and bounds requested timeout by trusted invocation context', async () => {
    const runShell = vi.fn<NonNullable<ToolDependencies['sandbox']>['runShell']>(async () => ({
      stdout: '',
      stderr: '',
      exitCode: 0,
      stdoutTruncated: false,
      stderrTruncated: false,
      timedOut: false,
    }));
    const subsystem = createCapabilitySubsystem({
      read: { workspaceDir: process.cwd() },
      toolDependencies: sandboxDeps(runShell),
    });

    await subsystem.invocationPort.invoke(request({ command: 'ls' }, 300_000), new AbortController().signal);
    await subsystem.invocationPort.invoke(request({ command: 'ls', timeout: 600_000 }, 300_000), new AbortController().signal);
    await subsystem.invocationPort.invoke(request({ command: 'ls', timeout_ms: 60_000 }, 120_000), new AbortController().signal);
    await subsystem.invocationPort.invoke(request({ command: 'ls', timeout: 40_000, timeout_ms: 60_000 }, 120_000), new AbortController().signal);

    expect(runShell.mock.calls[0]?.[0]).toMatchObject({ timeoutMs: 300_000 });
    expect(runShell.mock.calls[1]?.[0]).toMatchObject({ timeoutMs: 300_000 });
    expect(runShell.mock.calls[2]?.[0]).toMatchObject({ timeoutMs: 60_000 });
    expect(runShell.mock.calls[3]?.[0]).toMatchObject({ timeoutMs: 40_000 });
  });

  builtinExecutableIt('rejects string timeout_ms compatibility input for bash calls', async () => {
    const runShell = vi.fn<NonNullable<ToolDependencies['sandbox']>['runShell']>(async () => ({
      stdout: '',
      stderr: '',
      exitCode: 0,
      stdoutTruncated: false,
      stderrTruncated: false,
      timedOut: false,
    }));
    const subsystem = createCapabilitySubsystem({
      read: { workspaceDir: process.cwd() },
      toolDependencies: sandboxDeps(runShell),
    });

    const result = await subsystem.invocationPort.invoke(
      request({ command: 'ls', timeout_ms: '70000' as never }, 120_000),
      new AbortController().signal,
    );

    expect(result).toMatchObject({
      status: 'FAILED',
      safeError: { code: 'CAPABILITY_INPUT_INVALID', category: 'VALIDATION' },
    });
    expect(runShell).not.toHaveBeenCalled();
  });

  builtinExecutableIt('routes Python commands through the Python sandbox dependency', async () => {
    const runShell = vi.fn<NonNullable<ToolDependencies['sandbox']>['runShell']>(async () => ({
      stdout: '',
      stderr: '',
      exitCode: 0,
      stdoutTruncated: false,
      stderrTruncated: false,
      timedOut: false,
    }));
    const runPython = vi.fn<NonNullable<ToolDependencies['sandbox']>['runPython']>(async () => ({
      stdout: 'python-ok',
      stderr: '',
      exitCode: 0,
      stdoutTruncated: false,
      stderrTruncated: false,
      timedOut: false,
    }));
    const subsystem = createCapabilitySubsystem({
      read: { workspaceDir: process.cwd() },
      toolDependencies: {
        sandbox: {
          runShell,
          runPython,
          startBackgroundShell: async () => {
            throw new Error('startBackgroundShell is not configured for this test.');
          },
          runShellBackgroundable: async () => {
            throw new Error('runShellBackgroundable is not configured for this test.');
          },
        },
      },
    });

    const result = await subsystem.invocationPort.invoke(
      request({ command: 'python .nextagent/skills/projection-test/rag-skill/scripts/rag_query.py --query=hello' }),
      new AbortController().signal,
    );

    expect(result).toMatchObject({ status: 'SUCCEEDED', structuredPayload: { stdout: 'python-ok' } });
    expect(runShell).not.toHaveBeenCalled();
    expect(runPython).toHaveBeenCalledWith(
      expect.objectContaining({
        command: 'python',
        args: ['.nextagent/skills/projection-test/rag-skill/scripts/rag_query.py', '--query=hello'],
      }),
      expect.objectContaining({ runId: 'run-bash' }),
      expect.any(AbortSignal),
    );
  });

  builtinExecutableIt('preserves quote-heavy JSON arguments through structured args', async () => {
    const runShell = vi.fn<NonNullable<ToolDependencies['sandbox']>['runShell']>(async () => ({
      stdout: '',
      stderr: '',
      exitCode: 0,
      stdoutTruncated: false,
      stderrTruncated: false,
      timedOut: false,
    }));
    const runPython = vi.fn<NonNullable<ToolDependencies['sandbox']>['runPython']>(async () => ({
      stdout: 'json-ok',
      stderr: '',
      exitCode: 0,
      stdoutTruncated: false,
      stderrTruncated: false,
      timedOut: false,
    }));
    const subsystem = createCapabilitySubsystem({
      read: { workspaceDir: process.cwd() },
      toolDependencies: {
        sandbox: {
          runShell,
          runPython,
          startBackgroundShell: async () => {
            throw new Error('startBackgroundShell is not configured for this test.');
          },
          runShellBackgroundable: async () => {
            throw new Error('runShellBackgroundable is not configured for this test.');
          },
        },
      },
    });
    const payload = JSON.stringify({
      gremlin: 'g.V().hasLabel("LTP").has("name", "Ethernet3/0/2").in_("LinkPort")',
      contentSelector: ['resId', 'name', 'bandwidth', 'layerRate', 'adminState'],
      limit: 200,
    });

    const result = await subsystem.invocationPort.invoke(
      request({
        command: 'python',
        args: ['scripts/http_request.py', payload],
      }),
      new AbortController().signal,
    );

    expect(result).toMatchObject({ status: 'SUCCEEDED', structuredPayload: { stdout: 'json-ok' } });
    expect(runShell).not.toHaveBeenCalled();
    expect(runPython).toHaveBeenCalledWith(
      expect.objectContaining({
        command: 'python',
        args: ['scripts/http_request.py', payload],
      }),
      expect.objectContaining({ runId: 'run-bash' }),
      expect.any(AbortSignal),
    );
    expect(runPython.mock.calls[0]?.[0]['args']?.[1]).toBe(payload);
    expect(runPython.mock.calls[0]?.[0]['args']?.[1]).toContain('\\"LTP\\"');
  });

  builtinExecutableIt('passes structured PYTHONPATH env to the Python sandbox dependency', async () => {
    const runPython = vi.fn<NonNullable<ToolDependencies['sandbox']>['runPython']>(async () => ({
      stdout: 'env-ok',
      stderr: '',
      exitCode: 0,
      stdoutTruncated: false,
      stderrTruncated: false,
      timedOut: false,
    }));
    const subsystem = createCapabilitySubsystem({
      read: { workspaceDir: process.cwd() },
      toolDependencies: {
        sandbox: {
          runShell: async () => {
            throw new Error('runShell must not receive Python env invocation.');
          },
          runPython,
          startBackgroundShell: async () => {
            throw new Error('startBackgroundShell is not configured for this test.');
          },
          runShellBackgroundable: async () => {
            throw new Error('runShellBackgroundable is not configured for this test.');
          },
        },
      },
    });

    const result = await subsystem.invocationPort.invoke(
      request({
        command: 'python',
        args: ['.nextagent/skills/proj/spn-copilot/scripts/nl2sql/sql_recall_main.py', 'query'],
        env: { PYTHONPATH: '.nextagent/skills/proj/spn-copilot/scripts' },
      }),
      new AbortController().signal,
    );

    expect(result).toMatchObject({ status: 'SUCCEEDED', structuredPayload: { stdout: 'env-ok' } });
    expect(runPython).toHaveBeenCalledWith(
      expect.objectContaining({
        command: 'python',
        args: ['.nextagent/skills/proj/spn-copilot/scripts/nl2sql/sql_recall_main.py', 'query'],
        environment: expect.objectContaining({ PYTHONPATH: '.nextagent/skills/proj/spn-copilot/scripts' }),
      }),
      expect.objectContaining({ runId: 'run-bash' }),
      expect.any(AbortSignal),
    );
  });

  builtinExecutableIt('normalizes a leading PYTHONPATH assignment before Python sandbox routing', async () => {
    const runShell = vi.fn();
    const runPython = vi.fn<NonNullable<ToolDependencies['sandbox']>['runPython']>(async () => ({
      stdout: 'prefix-ok',
      stderr: '',
      exitCode: 0,
      stdoutTruncated: false,
      stderrTruncated: false,
      timedOut: false,
    }));
    const subsystem = createCapabilitySubsystem({
      read: { workspaceDir: process.cwd() },
      toolDependencies: {
        sandbox: {
          runShell,
          runPython,
          startBackgroundShell: async () => {
            throw new Error('startBackgroundShell is not configured for this test.');
          },
          runShellBackgroundable: async () => {
            throw new Error('runShellBackgroundable is not configured for this test.');
          },
        },
      },
    });

    const result = await subsystem.invocationPort.invoke(
      request({
        command:
          'PYTHONPATH=.nextagent/skills/proj/spn-copilot/scripts python .nextagent/skills/proj/spn-copilot/scripts/nl2sql/sql_recall_main.py query',
      }),
      new AbortController().signal,
    );

    expect(result).toMatchObject({ status: 'SUCCEEDED', structuredPayload: { stdout: 'prefix-ok' } });
    expect(runShell).not.toHaveBeenCalled();
    expect(runPython).toHaveBeenCalledWith(
      expect.objectContaining({
        command: 'python',
        args: ['.nextagent/skills/proj/spn-copilot/scripts/nl2sql/sql_recall_main.py', 'query'],
        environment: expect.objectContaining({ PYTHONPATH: '.nextagent/skills/proj/spn-copilot/scripts' }),
      }),
      expect.objectContaining({ runId: 'run-bash' }),
      expect.any(AbortSignal),
    );
  });

  builtinExecutableIt('keeps command-string mode compatible with structured PYTHONPATH when args are omitted', async () => {
    const runShell = vi.fn();
    const runPython = vi.fn<NonNullable<ToolDependencies['sandbox']>['runPython']>(async () => ({
      stdout: 'command-string-env-ok',
      stderr: '',
      exitCode: 0,
      stdoutTruncated: false,
      stderrTruncated: false,
      timedOut: false,
    }));
    const subsystem = createCapabilitySubsystem({
      read: { workspaceDir: process.cwd() },
      toolDependencies: {
        sandbox: {
          runShell,
          runPython,
          startBackgroundShell: async () => {
            throw new Error('startBackgroundShell is not configured for this test.');
          },
          runShellBackgroundable: async () => {
            throw new Error('runShellBackgroundable is not configured for this test.');
          },
        },
      },
    });

    const result = await subsystem.invocationPort.invoke(
      request({
        command: 'python -m scripts.nl2api.api_executor --url-path /rest/netmasterservice/v1/api/port/nceip_query_ports_on_ne_by_port_type',
        env: { PYTHONPATH: '.nextagent/skills/proj/spn-copilot' },
      }),
      new AbortController().signal,
    );

    expect(result).toMatchObject({ status: 'SUCCEEDED', structuredPayload: { stdout: 'command-string-env-ok' } });
    expect(runShell).not.toHaveBeenCalled();
    expect(runPython).toHaveBeenCalledWith(
      expect.objectContaining({
        command: 'python',
        args: ['-m', 'scripts.nl2api.api_executor', '--url-path', '/rest/netmasterservice/v1/api/port/nceip_query_ports_on_ne_by_port_type'],
        environment: expect.objectContaining({ PYTHONPATH: '.nextagent/skills/proj/spn-copilot' }),
      }),
      expect.objectContaining({ runId: 'run-bash' }),
      expect.any(AbortSignal),
    );
  });

  builtinExecutableIt('rejects mixed command strings when structured args are provided', async () => {
    const runShell = vi.fn();
    const subsystem = createCapabilitySubsystem({
      read: { workspaceDir: process.cwd() },
      toolDependencies: sandboxDeps(runShell),
    });

    const result = await subsystem.invocationPort.invoke(
      request({
        command: 'python scripts/http_request.py',
        args: ['{"limit":200}'],
      }),
      new AbortController().signal,
    );

    expect(result).toMatchObject({
      status: 'FAILED',
      safeError: {
        code: 'CAPABILITY_INPUT_INVALID',
        category: 'VALIDATION',
        retryable: true,
        safeDetails: {
          reasonCode: 'BASH_STRUCTURED_ARGS_COMMAND_NOT_EXECUTABLE_ONLY',
          hint: expect.stringContaining('Choose one mode'),
        },
      },
    });
    expect(result.safeError?.safeDetails?.hint).toContain('Command-string mode');
    expect(result.safeError?.safeDetails?.hint).toContain('Argv mode');
    expect(result.safeError?.safeDetails?.hint).toContain('Never split one command between `command` and `args`');
    expect(result.safeError?.safeDetails?.hint).toContain('env` currently supports only `PYTHONPATH`');
    expect(runShell).not.toHaveBeenCalled();
  });

  builtinExecutableIt('forwards Python module invocation arguments unchanged to the Python sandbox dependency', async () => {
    const runPython = vi.fn<NonNullable<ToolDependencies['sandbox']>['runPython']>(async () => ({
      stdout: 'python-ok',
      stderr: '',
      exitCode: 0,
      stdoutTruncated: false,
      stderrTruncated: false,
      timedOut: false,
    }));
    const subsystem = createCapabilitySubsystem({
      read: { workspaceDir: process.cwd() },
      toolDependencies: {
        sandbox: {
          runShell: async () => {
            throw new Error('runShell must not receive Python module invocation.');
          },
          runPython,
          startBackgroundShell: async () => {
            throw new Error('startBackgroundShell is not configured for this test.');
          },
          runShellBackgroundable: async () => {
            throw new Error('runShellBackgroundable is not configured for this test.');
          },
        },
      },
    });

    await subsystem.invocationPort.invoke(request({ command: 'python -m scripts.nl2sql.sql_recall_main 查询问题' }), new AbortController().signal);
    await subsystem.invocationPort.invoke(request({ command: 'python3 -m scripts.nl2sql.sql_recall_main 查询问题' }), new AbortController().signal);

    expect(runPython).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ command: 'python', args: ['-m', 'scripts.nl2sql.sql_recall_main', '查询问题'] }),
      expect.anything(),
      expect.any(AbortSignal),
    );
    expect(runPython).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ command: 'python3', args: ['-m', 'scripts.nl2sql.sql_recall_main', '查询问题'] }),
      expect.anything(),
      expect.any(AbortSignal),
    );
  });

  builtinExecutableIt('routes explicit shared-data Python scripts through the Python sandbox dependency', async () => {
    const runShell = vi.fn<NonNullable<ToolDependencies['sandbox']>['runShell']>(async () => ({
      stdout: '',
      stderr: '',
      exitCode: 0,
      stdoutTruncated: false,
      stderrTruncated: false,
      timedOut: false,
    }));
    const runPython = vi.fn<NonNullable<ToolDependencies['sandbox']>['runPython']>(async () => ({
      stdout: 'shared-ok',
      stderr: '',
      exitCode: 0,
      stdoutTruncated: false,
      stderrTruncated: false,
      timedOut: false,
    }));
    const subsystem = createCapabilitySubsystem({
      read: { workspaceDir: process.cwd() },
      toolDependencies: {
        sandbox: {
          runShell,
          runPython,
          startBackgroundShell: async () => {
            throw new Error('startBackgroundShell not used');
          },
          runShellBackgroundable: async () => {
            throw new Error('runShellBackgroundable not used');
          },
        },
      },
    });

    const result = await subsystem.invocationPort.invoke(
      request({ command: 'python shared-data/scripts/diagnose.py --case shared-data/cases/alarm.json' }),
      new AbortController().signal,
    );

    expect(result).toMatchObject({ status: 'SUCCEEDED', structuredPayload: { stdout: 'shared-ok' } });
    expect(runShell).not.toHaveBeenCalled();
    expect(runPython).toHaveBeenCalledWith(
      expect.objectContaining({
        command: 'python',
        args: ['shared-data/scripts/diagnose.py', '--case', 'shared-data/cases/alarm.json'],
      }),
      expect.objectContaining({ runId: 'run-bash' }),
      expect.any(AbortSignal),
    );
  });

  builtinExecutableIt('returns corrective validation feedback without leaking command policy details', async () => {
    const runShell = vi.fn();
    const subsystem = createCapabilitySubsystem({
      read: { workspaceDir: process.cwd() },
      toolDependencies: sandboxDeps(runShell),
    });

    const result = await subsystem.invocationPort.invoke(request({ command: "cat 'logs/alarm.txt" }), new AbortController().signal);

    expect(result).toMatchObject({
      status: 'FAILED',
      safeError: {
        code: 'COMMAND_NOT_ALLOWED',
        category: 'VALIDATION',
        retryable: false,
        safeDetails: {
          reasonCode: 'BASH_COMMAND_UNCLOSED_QUOTE',
          violations: [
            {
              path: '/command',
              constraint: 'balancedQuotes',
              expected: 'a single command with every quoted argument closed',
            },
          ],
        },
      },
      structuredPayload: {},
    });
    expect(JSON.stringify(result.safeError)).not.toContain('allowedCommands');
    expect(JSON.stringify(result.safeError)).not.toContain('logs/alarm.txt');
    expect(runShell).not.toHaveBeenCalled();
  });

  it('returns a corrective validation hint for unclosed quoted Python query arguments', async () => {
    const runShell = vi.fn();
    const subsystem = createCapabilitySubsystem({
      read: { workspaceDir: process.cwd() },
      toolDependencies: sandboxDeps(runShell),
    });

    const result = await subsystem.invocationPort.invoke(
      request({
        command: 'python .nextagent/skills/projection-test/rag-skill/scripts/rag_query.py --query "SET BYPASSRM 旁路恢复 命令 告警恢复',
      }),
      new AbortController().signal,
    );

    expect(result).toMatchObject({
      status: 'FAILED',
      safeError: {
        code: 'COMMAND_NOT_ALLOWED',
        category: 'VALIDATION',
        retryable: false,
        safeDetails: {
          reasonCode: 'BASH_COMMAND_UNCLOSED_QUOTE',
          violations: [
            {
              path: '/command',
              constraint: 'balancedQuotes',
              expected: 'a single command with every quoted argument closed',
            },
          ],
        },
      },
      structuredPayload: {},
    });
    expect(JSON.stringify(result.safeError)).not.toContain('allowedCommands');
    expect(JSON.stringify(result.safeError)).not.toContain('rag_query.py');
    expect(runShell).not.toHaveBeenCalled();
  });

  it('returns all independent command format violations in one failure without dispatching to sandbox', async () => {
    const runShell = vi.fn();
    const subsystem = createCapabilitySubsystem({
      read: { workspaceDir: process.cwd() },
      toolDependencies: sandboxDeps(runShell),
    });

    const result = await subsystem.invocationPort.invoke(request({ command: "cat 'logs\u0007alarm.txt" }), new AbortController().signal);

    expect(result).toMatchObject({
      status: 'FAILED',
      safeError: {
        code: 'COMMAND_NOT_ALLOWED',
        category: 'VALIDATION',
        retryable: false,
        safeDetails: {
          reasonCode: 'BASH_COMMAND_UNCLOSED_QUOTE',
          violations: [
            { path: '/command', constraint: 'balancedQuotes', expected: 'a single command with every quoted argument closed' },
            { path: '/command', constraint: 'noControlCharacters', expected: 'a command without control characters' },
          ],
        },
      },
    });
    expect(result.safeError?.message).toContain('2 constraints');
    expect(JSON.stringify(result.safeError)).not.toContain('logs');
    expect(runShell).not.toHaveBeenCalled();
  });

  it('keeps Bash unavailable when the sandbox dependency is absent', async () => {
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
    ).find((candidate) => candidate.capabilityId === bashCapabilityId);

    expect(descriptor).toMatchObject({
      availabilityStatus: 'UNAVAILABLE',
      availabilityReason: 'TOOL_DEPENDENCY_MISSING',
    });
  });

  it('classifies a missing sandbox composition as an internal execution failure', async () => {
    await expect(
      bashToolDefinition.tool.execute(
        { command: 'ls' },
        {
          context: {
            identityContext: { tenantId: tenantId(), subjectId: subjectId(), displayName: 'Bash tester' },
            agentId: brand<string, 'AgentId'>('default-agent'),
            agentVersion: brand<string, 'AgentVersion'>('v1'),
            sessionId: brand<string, 'SessionId'>('session-bash'),
            requestId: brand<string, 'MessageId'>('request-bash'),
            runId: brand<string, 'RequestRunId'>('run-bash'),
            requestContextId: brand<string, 'RequestContextId'>('context-bash'),
            stepId: 'turn-1',
            toolCallId: 'tool-bash',
            timeoutMs: 30_000,
          },
        },
      ),
    ).rejects.toMatchObject({
      code: 'CAPABILITY_EXECUTION_FAILED',
      category: 'INTERNAL',
      retryable: false,
      message:
        'Bash execution could not start because the required sandbox boundary is unavailable. The command was not executed. Stop this action and report the error.',
      safeDetails: undefined,
    });
  });

  builtinExecutableIt(
    'maps non-zero exit to SUCCEEDED with structured process payload and timeout to terminal failure without leaking command text',
    async () => {
      const failedSubsystem = createCapabilitySubsystem({
        read: { workspaceDir: process.cwd() },
        toolDependencies: sandboxDeps(async () => ({
          stdout: 'partial',
          stderr: 'failed',
          exitCode: 2,
          stdoutTruncated: false,
          stderrTruncated: false,
          timedOut: false,
        })),
      });
      const failed = await failedSubsystem.invocationPort.invoke(request({ command: 'cat logs/alarm.txt' }), new AbortController().signal);
      expect(failed).toMatchObject({
        status: 'SUCCEEDED',
        structuredPayload: { exitCode: 2, stdout: 'partial', stderr: 'failed' },
      });
      expect(failed.safeError).toBeUndefined();

      const timedOutSubsystem = createCapabilitySubsystem({
        read: { workspaceDir: process.cwd() },
        toolDependencies: sandboxDeps(async () => ({
          stdout: '',
          stderr: '',
          exitCode: -1,
          stdoutTruncated: false,
          stderrTruncated: false,
          timedOut: true,
        })),
      });
      const timedOut = await timedOutSubsystem.invocationPort.invoke(request({ command: 'ls' }), new AbortController().signal);
      expect(timedOut).toMatchObject({
        status: 'TIMED_OUT',
        safeError: { code: 'SANDBOX_TIMEOUT', category: 'TIMEOUT', retryable: false },
        structuredPayload: {},
      });
    },
  );

  builtinExecutableIt('returns SUCCEEDED for non-zero exit without output, preserving exitCode', async () => {
    const subsystem = createCapabilitySubsystem({
      read: { workspaceDir: process.cwd() },
      toolDependencies: sandboxDeps(async () => ({
        stdout: '',
        stderr: '',
        exitCode: 2,
        stdoutTruncated: false,
        stderrTruncated: false,
        timedOut: false,
      })),
    });

    const result = await subsystem.invocationPort.invoke(request({ command: 'false' }), new AbortController().signal);

    expect(result).toMatchObject({
      status: 'SUCCEEDED',
      structuredPayload: { exitCode: 2, stdout: '', stderr: '' },
    });
    expect(result.safeError).toBeUndefined();
  });

  builtinExecutableIt('silently truncates sandbox output when it exceeds the cap', async () => {
    const subsystem = createCapabilitySubsystem({
      read: { workspaceDir: process.cwd() },
      toolDependencies: sandboxDeps(async () => ({
        stdout: 'partial-output',
        stderr: '',
        exitCode: 0,
        stdoutTruncated: true,
        stderrTruncated: false,
        timedOut: false,
      })),
    });

    const result = await subsystem.invocationPort.invoke(request({ command: 'cat logs/alarm.txt' }), new AbortController().signal);

    expect(result).toMatchObject({
      status: 'SUCCEEDED',
      structuredPayload: { stdout: 'partial-output', stderr: '', exitCode: 0, stdoutTruncated: true, stderrTruncated: false },
    });
  });

  builtinExecutableIt('normalizes invalid foreground and background sandbox responses as internal execution failures', async () => {
    const foregroundSubsystem = createCapabilitySubsystem({
      read: { workspaceDir: process.cwd() },
      toolDependencies: sandboxDeps(async () => ({ stdout: 123 })),
    });
    const backgroundSubsystem = createCapabilitySubsystem({
      read: { workspaceDir: process.cwd() },
      toolDependencies: backgroundSandboxDeps(
        async () => ({ taskId: 'unused', status: 'RUNNING', stdoutRef: 'unused', stderrRef: 'unused' }),
        undefined,
        async () => ({ stdout: 123 }),
      ),
      backgroundExecutionEnabled: true,
    });

    const foregroundResult = await foregroundSubsystem.invocationPort.invoke(request({ command: 'ls' }), new AbortController().signal);
    const backgroundResult = await backgroundSubsystem.invocationPort.invoke(
      request({ command: 'npm run build', run_in_background: true }),
      new AbortController().signal,
    );

    expect(foregroundResult).toMatchObject({
      status: 'FAILED',
      safeError: { code: 'CAPABILITY_EXECUTION_FAILED', category: 'INTERNAL', retryable: false },
    });
    expect(backgroundResult).toMatchObject({
      status: 'FAILED',
      safeError: { code: 'CAPABILITY_EXECUTION_FAILED', category: 'INTERNAL', retryable: false },
    });
    expect(foregroundResult.safeError?.safeDetails).toBeUndefined();
    expect(backgroundResult.safeError?.safeDetails).toBeUndefined();
  });

  builtinExecutableIt.each([
    {
      name: 'explicit backgroundable',
      argumentsValue: { command: 'npm run build', run_in_background: true },
      dependencies: backgroundSandboxDeps(
        async () => ({ taskId: 'unused', status: 'RUNNING', stdoutRef: 'unused', stderrRef: 'unused' }),
        undefined,
        async () => ({ taskId: 'RAW_BACKGROUND_HANDLE', status: 7 }),
      ),
    },
    {
      name: 'fallback background',
      argumentsValue: { command: 'npm run build', run_in_background: true },
      dependencies: sandboxWithoutBackgroundable(async () => ({ taskId: 'RAW_BACKGROUND_HANDLE', status: 7 })),
    },
    {
      name: 'foreground auto-background',
      argumentsValue: { command: 'npm run build' },
      dependencies: backgroundSandboxDeps(
        async () => ({ taskId: 'unused', status: 'RUNNING', stdoutRef: 'unused', stderrRef: 'unused' }),
        undefined,
        async () => ({ taskId: 'RAW_BACKGROUND_HANDLE', status: 7 }),
      ),
    },
  ])('maps an invalid $name handle to an empty standard internal failure', async ({ argumentsValue, dependencies }) => {
    const subsystem = createCapabilitySubsystem({
      read: { workspaceDir: process.cwd() },
      toolDependencies: dependencies,
      backgroundExecutionEnabled: true,
    });

    const result = await subsystem.invocationPort.invoke(request(argumentsValue), new AbortController().signal);

    expect(result).toMatchObject({
      status: 'FAILED',
      structuredPayload: {},
      safeError: {
        code: 'CAPABILITY_EXECUTION_FAILED',
        category: 'INTERNAL',
        retryable: false,
      },
    });
    expect(result.safeError?.safeDetails).toBeUndefined();
    expect(result.safeError?.code).not.toBe('CAPABILITY_OUTPUT_INVALID');
    expect(JSON.stringify(result)).not.toContain('RAW_BACKGROUND_HANDLE');
  });

  builtinExecutableIt('exposes run_in_background and returns a task handle in local deployments', async () => {
    const startBackgroundShell = vi.fn<NonNullable<ToolDependencies['sandbox']>['startBackgroundShell']>(async () => ({
      taskId: 'task-bg-1',
      status: 'RUNNING',
      stdoutRef: 'tool-results/task-bg-1.stdout.txt',
      stderrRef: 'tool-results/task-bg-1.stderr.txt',
    }));
    const runShell = vi.fn<NonNullable<ToolDependencies['sandbox']>['runShell']>(async () => ({
      stdout: '',
      stderr: '',
      exitCode: 0,
      stdoutTruncated: false,
      stderrTruncated: false,
      timedOut: false,
    }));
    const subsystem = createCapabilitySubsystem({
      read: { workspaceDir: process.cwd() },
      toolDependencies: backgroundSandboxDeps(startBackgroundShell, runShell),
      backgroundExecutionEnabled: true,
    });
    const descriptors = await subsystem.catalog.listAvailable({
      tenantId: tenantId(),
      subjectId: subjectId(),
      agentAssembly: assembly(),
      includeUnavailable: true,
    });
    const descriptor = descriptors.find((candidate) => candidate.capabilityId === bashCapabilityId);
    expect(JSON.stringify(descriptor?.inputSchema)).toContain('run_in_background');

    const result = await subsystem.invocationPort.invoke(
      request({ command: 'npm run build', run_in_background: true }),
      new AbortController().signal,
    );

    expect(result).toMatchObject({
      status: 'SUCCEEDED',
      structuredPayload: {
        taskId: 'task-bg-1',
        status: 'RUNNING',
        stdoutRef: 'tool-results/task-bg-1.stdout.txt',
        stderrRef: 'tool-results/task-bg-1.stderr.txt',
      },
    });
    expect(startBackgroundShell).toHaveBeenCalledTimes(1);
    expect(startBackgroundShell).toHaveBeenCalledWith(expect.objectContaining({ command: 'npm' }), expect.objectContaining({ runId: 'run-bash' }));
    expect(runShell).not.toHaveBeenCalled();
  });

  builtinExecutableIt('rejects run_in_background when background execution is not enabled', async () => {
    const startBackgroundShell = vi.fn<NonNullable<ToolDependencies['sandbox']>['startBackgroundShell']>(async () => ({
      taskId: 'task-bg-2',
      status: 'RUNNING',
      stdoutRef: 'tool-results/task-bg-2.stdout.txt',
      stderrRef: 'tool-results/task-bg-2.stderr.txt',
    }));
    const subsystem = createCapabilitySubsystem({
      read: { workspaceDir: process.cwd() },
      toolDependencies: backgroundSandboxDeps(startBackgroundShell),
      backgroundExecutionEnabled: false,
    });
    const descriptors = await subsystem.catalog.listAvailable({
      tenantId: tenantId(),
      subjectId: subjectId(),
      agentAssembly: assembly(),
      includeUnavailable: true,
    });
    const descriptor = descriptors.find((candidate) => candidate.capabilityId === bashCapabilityId);
    expect(JSON.stringify(descriptor?.inputSchema)).not.toContain('run_in_background');

    const result = await subsystem.invocationPort.invoke(
      request({ command: 'npm run build', run_in_background: true }),
      new AbortController().signal,
    );
    expect(result.status).toBe('FAILED');
    expect(result.safeError?.code).toBe('CAPABILITY_INPUT_INVALID');
    expect(startBackgroundShell).not.toHaveBeenCalled();
  });

  builtinExecutableIt('auto-injects NEXTAGENT_* identity env vars into bash sandbox environment', async () => {
    const runShell = vi.fn<NonNullable<ToolDependencies['sandbox']>['runShell']>(async () => ({
      stdout: '',
      stderr: '',
      exitCode: 0,
      stdoutTruncated: false,
      stderrTruncated: false,
      timedOut: false,
    }));
    const subsystem = createCapabilitySubsystem({
      read: { workspaceDir: process.cwd() },
      toolDependencies: sandboxDeps(runShell),
    });

    await subsystem.invocationPort.invoke(request({ command: 'curl https://example.com' }), new AbortController().signal);

    expect(runShell).toHaveBeenCalledWith(
      expect.objectContaining({
        environment: expect.objectContaining({
          NEXTAGENT_USER_ID: 'subject-bash',
          NEXTAGENT_USER_NAME: 'Bash tester',
          NEXTAGENT_CHAT_ID: 'request-bash',
          NEXTAGENT_CONVERSATION_ID: 'session-bash',
        }),
      }),
      expect.objectContaining({ runId: 'run-bash' }),
      expect.any(AbortSignal),
    );
  });

  builtinExecutableIt('rejects NEXTAGENT_USER_ID set manually in env', async () => {
    const runShell = vi.fn<NonNullable<ToolDependencies['sandbox']>['runShell']>();
    const subsystem = createCapabilitySubsystem({
      read: { workspaceDir: process.cwd() },
      toolDependencies: sandboxDeps(runShell),
    });

    const result = await subsystem.invocationPort.invoke(
      request({ command: 'curl https://example.com', env: { NEXTAGENT_USER_ID: 'attacker' } }),
      new AbortController().signal,
    );

    expect(result.status).toBe('FAILED');
    expect(result.safeError?.code).toBe('CAPABILITY_INPUT_INVALID');
    expect(runShell).not.toHaveBeenCalled();
  });

  builtinExecutableIt('rejects NEXTAGENT_USER_ID in command prefix assignment', async () => {
    const runShell = vi.fn<NonNullable<ToolDependencies['sandbox']>['runShell']>();
    const subsystem = createCapabilitySubsystem({
      read: { workspaceDir: process.cwd() },
      toolDependencies: sandboxDeps(runShell),
    });

    const result = await subsystem.invocationPort.invoke(
      request({ command: 'NEXTAGENT_USER_ID=attacker curl https://example.com' }),
      new AbortController().signal,
    );

    expect(result.status).toBe('FAILED');
    expect(result.safeError?.code).toBe('CAPABILITY_INPUT_INVALID');
    expect(result.safeError?.safeDetails?.['reasonCode']).toBe('BASH_ENV_AUTO_INJECTED_KEY');
    expect(runShell).not.toHaveBeenCalled();
  });

  builtinExecutableIt('injects default --max-time 600 for curl without timeout flag', async () => {
    const runShell = vi.fn<NonNullable<ToolDependencies['sandbox']>['runShell']>().mockResolvedValue({
      stdout: '',
      stderr: '',
      exitCode: 0,
      stdoutTruncated: false,
      stderrTruncated: false,
      timedOut: false,
    });
    const subsystem = createCapabilitySubsystem({
      read: { workspaceDir: process.cwd() },
      toolDependencies: sandboxDeps(runShell),
      toolCatalogConfig: { tools: { Bash: { config: { allowedCommands: ['curl'] } } } },
    });

    const result = await subsystem.invocationPort.invoke(request({ command: 'curl https://example.com' }), new AbortController().signal);

    expect(result.status).toBe('SUCCEEDED');
    expect(runShell).toHaveBeenCalledWith(
      expect.objectContaining({
        command: 'curl',
        args: ['--max-time', '600', 'https://example.com'],
      }),
      expect.objectContaining({ runId: 'run-bash' }),
      expect.any(AbortSignal),
    );
  });

  builtinExecutableIt('does not inject --max-time when curl already has --max-time flag', async () => {
    const runShell = vi.fn<NonNullable<ToolDependencies['sandbox']>['runShell']>().mockResolvedValue({
      stdout: '',
      stderr: '',
      exitCode: 0,
      stdoutTruncated: false,
      stderrTruncated: false,
      timedOut: false,
    });
    const subsystem = createCapabilitySubsystem({
      read: { workspaceDir: process.cwd() },
      toolDependencies: sandboxDeps(runShell),
      toolCatalogConfig: { tools: { Bash: { config: { allowedCommands: ['curl'] } } } },
    });

    const result = await subsystem.invocationPort.invoke(
      request({ command: 'curl --max-time 120 https://example.com' }),
      new AbortController().signal,
    );

    expect(result.status).toBe('SUCCEEDED');
    expect(runShell).toHaveBeenCalledWith(
      expect.objectContaining({
        command: 'curl',
        args: ['--max-time', '120', 'https://example.com'],
      }),
      expect.anything(),
      expect.anything(),
    );
    const firstCall = runShell.mock.calls[0];
    expect(firstCall).toBeDefined();
    const callArgs = firstCall![0] as unknown as { args: readonly string[] };
    const maxTimeCount = callArgs.args.filter((a) => a === '--max-time').length;
    expect(maxTimeCount).toBe(1);
  });

  builtinExecutableIt('does not inject --max-time when curl already has -m short flag', async () => {
    const runShell = vi.fn<NonNullable<ToolDependencies['sandbox']>['runShell']>().mockResolvedValue({
      stdout: '',
      stderr: '',
      exitCode: 0,
      stdoutTruncated: false,
      stderrTruncated: false,
      timedOut: false,
    });
    const subsystem = createCapabilitySubsystem({
      read: { workspaceDir: process.cwd() },
      toolDependencies: sandboxDeps(runShell),
      toolCatalogConfig: { tools: { Bash: { config: { allowedCommands: ['curl'] } } } },
    });

    const result = await subsystem.invocationPort.invoke(request({ command: 'curl -m 30 https://example.com' }), new AbortController().signal);

    expect(result.status).toBe('SUCCEEDED');
    expect(runShell).toHaveBeenCalledWith(
      expect.objectContaining({
        command: 'curl',
        args: ['-m', '30', 'https://example.com'],
      }),
      expect.anything(),
      expect.anything(),
    );
    const firstCall = runShell.mock.calls[0];
    expect(firstCall).toBeDefined();
    const callArgs = firstCall![0] as unknown as { args: readonly string[] };
    expect(callArgs.args).not.toContain('--max-time');
  });
  builtinExecutableIt('keeps a valid shell-escaped curl -d JSON payload intact as one argv entry', async () => {
    const runShell = vi.fn<NonNullable<ToolDependencies['sandbox']>['runShell']>().mockResolvedValue({
      stdout: '',
      stderr: '',
      exitCode: 0,
      stdoutTruncated: false,
      stderrTruncated: false,
      timedOut: false,
    });
    const subsystem = createCapabilitySubsystem({
      read: { workspaceDir: process.cwd() },
      toolDependencies: sandboxDeps(runShell),
      toolCatalogConfig: { tools: { Bash: { config: { allowedCommands: ['curl'] } } } },
    });

    const result = await subsystem.invocationPort.invoke(
      request({ command: 'curl -d "{\\"k\\":\\"v\\"}" https://example.com' }),
      new AbortController().signal,
    );

    expect(result.status).toBe('SUCCEEDED');
    expect(runShell).toHaveBeenCalledWith(
      expect.objectContaining({
        command: 'curl',
        args: ['--max-time', '600', '-d', '{"k":"v"}', 'https://example.com'],
      }),
      expect.anything(),
      expect.anything(),
    );
  });

  builtinExecutableIt('preserves single quotes inside a valid curl -d JSON payload', async () => {
    const runShell = vi.fn<NonNullable<ToolDependencies['sandbox']>['runShell']>().mockResolvedValue({
      stdout: '',
      stderr: '',
      exitCode: 0,
      stdoutTruncated: false,
      stderrTruncated: false,
      timedOut: false,
    });
    const subsystem = createCapabilitySubsystem({
      read: { workspaceDir: process.cwd() },
      toolDependencies: sandboxDeps(runShell),
      toolCatalogConfig: { tools: { Bash: { config: { allowedCommands: ['curl'] } } } },
    });

    await subsystem.invocationPort.invoke(request({ command: 'curl -d "{\\"q\\":\\"x\'y\\"}" https://example.com' }), new AbortController().signal);

    expect(runShell).toHaveBeenCalledWith(
      expect.objectContaining({
        command: 'curl',
        args: ['--max-time', '600', '-d', '{"q":"x\'y"}', 'https://example.com'],
      }),
      expect.anything(),
      expect.anything(),
    );
  });

  builtinExecutableIt('repairs single-quote-delimited curl -d JSON in command-string mode', async () => {
    const runShell = vi.fn<NonNullable<ToolDependencies['sandbox']>['runShell']>().mockResolvedValue({
      stdout: '',
      stderr: '',
      exitCode: 0,
      stdoutTruncated: false,
      stderrTruncated: false,
      timedOut: false,
    });
    const subsystem = createCapabilitySubsystem({
      read: { workspaceDir: process.cwd() },
      toolDependencies: sandboxDeps(runShell),
      toolCatalogConfig: { tools: { Bash: { config: { allowedCommands: ['curl'] } } } },
    });

    await subsystem.invocationPort.invoke(request({ command: "curl -d \"{'k':'v'}\" https://example.com" }), new AbortController().signal);

    expect(runShell).toHaveBeenCalledWith(
      expect.objectContaining({
        command: 'curl',
        args: ['--max-time', '600', '-d', '{"k":"v"}', 'https://example.com'],
      }),
      expect.anything(),
      expect.anything(),
    );
  });

  builtinExecutableIt('repairs single-quote-delimited curl -d JSON in argv mode', async () => {
    const runShell = vi.fn<NonNullable<ToolDependencies['sandbox']>['runShell']>().mockResolvedValue({
      stdout: '',
      stderr: '',
      exitCode: 0,
      stdoutTruncated: false,
      stderrTruncated: false,
      timedOut: false,
    });
    const subsystem = createCapabilitySubsystem({
      read: { workspaceDir: process.cwd() },
      toolDependencies: sandboxDeps(runShell),
      toolCatalogConfig: { tools: { Bash: { config: { allowedCommands: ['curl'] } } } },
    });

    await subsystem.invocationPort.invoke(
      request({ command: 'curl', args: ['-d', "{'k':'v'}", 'https://example.com'] }),
      new AbortController().signal,
    );

    expect(runShell).toHaveBeenCalledWith(
      expect.objectContaining({
        command: 'curl',
        args: ['--max-time', '600', '-d', '{"k":"v"}', 'https://example.com'],
      }),
      expect.anything(),
      expect.anything(),
    );
  });
});

function sandboxDeps(runShell: NonNullable<ToolDependencies['sandbox']>['runShell']): ToolDependencies {
  return {
    sandbox: {
      runShell,
      runPython: runShell,
      startBackgroundShell: async () => {
        throw new Error('startBackgroundShell is not configured for this test.');
      },
      runShellBackgroundable: async () => {
        throw new Error('runShellBackgroundable is not configured for this test.');
      },
    },
  };
}

function backgroundSandboxDeps(
  startBackgroundShell: NonNullable<ToolDependencies['sandbox']>['startBackgroundShell'],
  runShell?: NonNullable<ToolDependencies['sandbox']>['runShell'],
  runShellBackgroundable?: NonNullable<ToolDependencies['sandbox']>['runShellBackgroundable'],
): ToolDependencies {
  const fallback =
    runShell ??
    (async () => ({
      stdout: '',
      stderr: '',
      exitCode: 0,
      stdoutTruncated: false,
      stderrTruncated: false,
      timedOut: false,
    }));
  return {
    sandbox: {
      runShell: fallback,
      runPython: fallback,
      startBackgroundShell,
      runShellBackgroundable:
        runShellBackgroundable ??
        (async (input, context) => {
          return startBackgroundShell(input, context);
        }),
    },
  };
}

function sandboxWithoutBackgroundable(startBackgroundShell: NonNullable<ToolDependencies['sandbox']>['startBackgroundShell']): ToolDependencies {
  const runShell: NonNullable<ToolDependencies['sandbox']>['runShell'] = async () => ({
    stdout: '',
    stderr: '',
    exitCode: 0,
    stdoutTruncated: false,
    stderrTruncated: false,
    timedOut: false,
  });
  return {
    sandbox: {
      runShell,
      runPython: runShell,
      startBackgroundShell,
    } as unknown as NonNullable<ToolDependencies['sandbox']>,
  };
}

function request(argumentsValue: JsonObject, timeoutMs = 30_000): CapabilityInvocationRequest {
  return {
    invocationId: 'invoke-bash',
    capabilityId: bashCapabilityId,
    arguments: argumentsValue,
    sessionId: brand<string, 'SessionId'>('session-bash'),
    requestId: brand<string, 'MessageId'>('request-bash'),
    runId: brand<string, 'RequestRunId'>('run-bash'),
    requestContextId: brand<string, 'RequestContextId'>('context-bash'),
    stepId: 'turn-1',
    identityContext: { tenantId: tenantId(), subjectId: subjectId(), displayName: 'Bash tester' },
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
  return brand<string, 'TenantId'>('tenant-bash');
}

function subjectId() {
  return brand<string, 'SubjectId'>('subject-bash');
}
