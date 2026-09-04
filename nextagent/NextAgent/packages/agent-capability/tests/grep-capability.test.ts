import {
  builtinToolsProvider,
  createCapabilitySubsystem,
  createToolCatalog,
  grepCapabilityId,
  grepOutputSchema,
  grepToolDefinition,
  validateJson,
} from '@nextagent/agent-capability';
import { brand, type JsonObject } from '@nextagent/agent-common';
import type { AgentAssembly } from '@nextagent/agent-contracts/agent-assembly';
import type { CapabilityInvocationRequest } from '@nextagent/agent-contracts/capability';
import { chmod, mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const tempDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
}, 60_000);

describe('grep capability', () => {
  it('is unavailable without the shared workspaceFiles dependency', async () => {
    const catalog = createToolCatalog({ provider: builtinToolsProvider, tools: [grepToolDefinition] });

    await expect(catalog.listAll(new AbortController().signal)).resolves.toEqual([
      expect.objectContaining({
        capabilityId: 'Grep',
        availabilityStatus: 'UNAVAILABLE',
        availabilityReason: 'TOOL_DEPENDENCY_MISSING',
      }),
    ]);
    expect(catalog.resolveExecutable(grepCapabilityId)).toBeUndefined();
  });

  it('registers strict IDEMPOTENT PascalCase metadata and follows Agent visibility', async () => {
    const workspaceDir = await createWorkspace();
    const subsystem = createCapabilitySubsystem({ read: { workspaceDir } });
    const visible = await subsystem.catalog.listAvailable({
      tenantId: tenantId(),
      subjectId: subjectId(),
      agentAssembly: assembly([{ capabilityId: 'Grep', capabilityType: 'TOOL', providerId: 'builtin-tools' }]),
      includeUnavailable: true,
    });
    const hidden = await subsystem.catalog.listAvailable({
      tenantId: tenantId(),
      subjectId: subjectId(),
      agentAssembly: assembly([{ capabilityId: 'Grep', capabilityType: 'TOOL', providerId: 'builtin-tools', enabled: false }]),
      includeUnavailable: true,
    });

    expect(visible).toContainEqual(
      expect.objectContaining({
        capabilityId: 'Grep',
        replayPolicy: 'IDEMPOTENT',
        availabilityStatus: 'AVAILABLE',
        inputSchema: expect.objectContaining({
          additionalProperties: false,
          required: ['pattern'],
          properties: expect.objectContaining({
            pattern: expect.objectContaining({ type: 'string', minLength: 1, maxLength: 4096 }),
            path: expect.objectContaining({ type: 'string', minLength: 1, maxLength: 4096 }),
            glob_filter: expect.objectContaining({ type: 'string', minLength: 1, maxLength: 4096 }),
            output_mode: expect.objectContaining({ type: 'string', enum: ['files_with_matches', 'content'] }),
            case_insensitive: expect.objectContaining({ type: 'boolean' }),
            max_results: expect.objectContaining({ type: 'integer', minimum: 1, maximum: 500 }),
          }),
        }),
        outputSchema: expect.objectContaining({
          required: ['output_mode', 'filenames', 'matches', 'total_files_with_matches', 'total_matches', 'truncated'],
        }),
      }),
    );
    const descriptor = visible.find((item) => item.capabilityId === grepCapabilityId);
    expect(descriptor?.description).toContain('only authorized directories under `workspace/`');
    expect(descriptor?.description).toContain('use Read for a known file');
    expect(descriptor?.description).toContain('`output_mode: "content"`');
    expect(descriptor?.inputSchema).toMatchObject({
      properties: { path: { description: expect.stringContaining('bare relative path aliases workspace/...') } },
    });
    expect(visible.some((descriptor) => descriptor.capabilityId === 'grep')).toBe(false);
    expect(hidden.some((descriptor) => descriptor.capabilityId === 'Grep')).toBe(false);
  });

  it('requires a mode-discriminated output shape', () => {
    const common = {
      total_files_with_matches: 1,
      total_matches: 1,
      truncated: false,
    };

    expect(
      validateJson(grepOutputSchema, {
        ...common,
        output_mode: 'files_with_matches',
        filenames: ['diagnostics/node-1.log'],
        matches: [],
      }),
    ).toBe(true);
    expect(
      validateJson(grepOutputSchema, {
        ...common,
        output_mode: 'content',
        filenames: [],
        matches: [{ file_path: 'diagnostics/node-1.log', line_number: 1, line: 'alarmId=101' }],
      }),
    ).toBe(true);

    for (const invalid of [
      { ...common, filenames: [], matches: [] },
      { ...common, output_mode: 'unknown', filenames: [], matches: [] },
      {
        ...common,
        output_mode: 'files_with_matches',
        filenames: ['diagnostics/node-1.log'],
        matches: [{ file_path: 'diagnostics/node-1.log', line_number: 1, line: 'alarmId=101' }],
      },
      {
        ...common,
        output_mode: 'content',
        filenames: ['diagnostics/node-1.log'],
        matches: [{ file_path: 'diagnostics/node-1.log', line_number: 1, line: 'alarmId=101' }],
      },
    ]) {
      expect(validateJson(grepOutputSchema, invalid)).toBe(false);
    }
  });

  it('returns matching filenames in default files_with_matches mode', async () => {
    const workspaceDir = await createWorkspace();
    await writeWorkspaceFile(workspaceDir, 'diagnostics/node-1.log', 'alarmId=101\nstatus=ok\n');
    await writeWorkspaceFile(workspaceDir, 'diagnostics/node-2.log', 'alarmId=202\n');
    await writeWorkspaceFile(workspaceDir, 'diagnostics/notes.txt', 'no alarms here\n');
    const subsystem = createCapabilitySubsystem({ read: { workspaceDir } });

    const result = await invoke(subsystem, { pattern: 'alarmId=\\d+' });

    expect(result).toMatchObject({
      status: 'SUCCEEDED',
      structuredPayload: {
        output_mode: 'files_with_matches',
        filenames: ['workspace/diagnostics/node-1.log', 'workspace/diagnostics/node-2.log'],
        matches: [],
        total_files_with_matches: 2,
        total_matches: 2,
        truncated: false,
      },
    });
  });

  it('returns matched lines in content mode with stable keys', async () => {
    const workspaceDir = await createWorkspace();
    await writeWorkspaceFile(workspaceDir, 'diagnostics/node-1.log', 'header\nalarmId=101\nfooter\nalarmId=102\n');
    const subsystem = createCapabilitySubsystem({ read: { workspaceDir } });

    const result = await invoke(subsystem, { pattern: 'alarmId=\\d+', output_mode: 'content' });

    expect(result.status).toBe('SUCCEEDED');
    expect(result.structuredPayload.output_mode).toBe('content');
    expect(result.structuredPayload.filenames).toEqual([]);
    expect(result.structuredPayload.matches).toEqual([
      { file_path: 'workspace/diagnostics/node-1.log', line_number: 2, line: 'alarmId=101' },
      { file_path: 'workspace/diagnostics/node-1.log', line_number: 4, line: 'alarmId=102' },
    ]);
    expect(result.structuredPayload.total_matches).toBe(2);
    expect(result.structuredPayload.total_files_with_matches).toBe(1);
  });

  it('preserves content mode in a successful zero-match result', async () => {
    const workspaceDir = await createWorkspace();
    await writeWorkspaceFile(workspaceDir, 'diagnostics/node-1.log', 'status=ok\n');
    const subsystem = createCapabilitySubsystem({ read: { workspaceDir } });

    await expect(invoke(subsystem, { pattern: 'alarmId', output_mode: 'content' })).resolves.toMatchObject({
      status: 'SUCCEEDED',
      structuredPayload: {
        output_mode: 'content',
        filenames: [],
        matches: [],
        total_files_with_matches: 0,
        total_matches: 0,
        truncated: false,
      },
    });
  });

  it('counts every regex match while returning one content row per matched line', async () => {
    const workspaceDir = await createWorkspace();
    await writeWorkspaceFile(workspaceDir, 'diagnostics/node-1.log', 'alarmId=101 alarmId=102\n');
    const subsystem = createCapabilitySubsystem({ read: { workspaceDir } });

    const result = await invoke(subsystem, { pattern: 'alarmId=\\d+', output_mode: 'content' });

    expect(result).toMatchObject({
      status: 'SUCCEEDED',
      structuredPayload: {
        filenames: [],
        matches: [{ file_path: 'workspace/diagnostics/node-1.log', line_number: 1, line: 'alarmId=101 alarmId=102' }],
        total_files_with_matches: 1,
        total_matches: 2,
        truncated: false,
      },
    });
  });

  it('applies case_insensitive flag and respects host case semantics for glob_filter', async () => {
    const workspaceDir = await createWorkspace();
    await writeWorkspaceFile(workspaceDir, 'diagnostics/ALARM.log', 'AlarmId=999\n');
    await writeWorkspaceFile(workspaceDir, 'diagnostics/notes.txt', 'ignore me\n');
    const subsystem = createCapabilitySubsystem({ read: { workspaceDir } });

    const sensitive = await invoke(subsystem, { pattern: 'AlarmId' });
    expect(sensitive).toMatchObject({
      status: 'SUCCEEDED',
      structuredPayload: { filenames: ['workspace/diagnostics/ALARM.log'], total_matches: 1 },
    });

    const insensitive = await invoke(subsystem, { pattern: 'alarmid', case_insensitive: true });
    expect(insensitive).toMatchObject({
      status: 'SUCCEEDED',
      structuredPayload: { filenames: ['workspace/diagnostics/ALARM.log'], total_matches: 1 },
    });

    const filtered = await invoke(subsystem, { pattern: 'AlarmId', glob_filter: '**/*.log' });
    expect(filtered).toMatchObject({
      status: 'SUCCEEDED',
      structuredPayload: { filenames: ['workspace/diagnostics/ALARM.log'], total_matches: 1 },
    });

    const filteredOut = await invoke(subsystem, { pattern: 'AlarmId', glob_filter: '**/*.txt' });
    expect(filteredOut).toMatchObject({
      status: 'SUCCEEDED',
      structuredPayload: { filenames: [], total_matches: 0 },
    });
  });

  it('scopes search to the normalized Read and Write root union when path is omitted', async () => {
    const workspaceDir = await createWorkspace();
    await writeWorkspaceFile(workspaceDir, 'read/alarms/alarm.log', 'match');
    await writeWorkspaceFile(workspaceDir, 'write/exports/result.log', 'match');
    await writeWorkspaceFile(workspaceDir, 'outside/secret.log', 'match');
    const subsystem = createCapabilitySubsystem({
      read: { workspaceDir, readDirectories: ['read'], writeDirectories: ['write'] },
    });

    const result = await invoke(subsystem, { pattern: 'match' });

    expect(result).toMatchObject({
      status: 'SUCCEEDED',
      structuredPayload: {
        filenames: ['workspace/read/alarms/alarm.log', 'workspace/write/exports/result.log'],
        total_files_with_matches: 2,
      },
    });
  });

  it('applies max_results after merging read and write roots into one lexical order', async () => {
    const workspaceDir = await createWorkspace();
    await writeWorkspaceFile(workspaceDir, 'z-read/z.log', 'match\n');
    await writeWorkspaceFile(workspaceDir, 'a-write/a.log', 'match\n');
    const subsystem = createCapabilitySubsystem({
      read: { workspaceDir, readDirectories: ['z-read'], writeDirectories: ['a-write'] },
    });

    const result = await invoke(subsystem, { pattern: 'match', output_mode: 'content', max_results: 1 });

    expect(result).toMatchObject({
      status: 'SUCCEEDED',
      structuredPayload: {
        filenames: [],
        matches: [{ file_path: 'workspace/a-write/a.log', line_number: 1, line: 'match' }],
        total_files_with_matches: 2,
        total_matches: 2,
        truncated: true,
      },
    });
  });

  it('rejects paths and patterns outside effective Read authority or with unsafe syntax', async () => {
    const workspaceDir = await createWorkspace();
    await writeWorkspaceFile(workspaceDir, 'diagnostics/alarm.log', 'match');
    const subsystem = createCapabilitySubsystem({ read: { workspaceDir, readDirectories: ['diagnostics'] } });

    for (const path of ['.', 'outside', '../outside', workspaceDir, '\\\\server\\share', 'C:\\Windows']) {
      await expect(invoke(subsystem, { pattern: 'match', path })).resolves.toMatchObject({
        status: 'FAILED',
        safeError: { code: 'CAPABILITY_PATH_REJECTED', category: 'AUTHORIZATION' },
      });
    }

    const unsafe: JsonObject[] = [
      { pattern: '' },
      { pattern: 7 },
      { pattern: 'x'.repeat(4097) },
      { pattern: 'match', path: 7 },
      { pattern: 'match', path: 'x'.repeat(4097) },
      { pattern: '../match' },
      { pattern: 'safe/../match' },
      { pattern: '/var/match' },
      { pattern: 'C:/match' },
      { pattern: '\\\\server\\share\\match' },
      { pattern: 'match\u0007' },
      { pattern: '(unclosed' },
      { pattern: '(a+)+' },
      { pattern: 'match', output_mode: 'summary' },
      { pattern: 'match', case_insensitive: 'yes' },
      { pattern: 'match', max_results: 0 },
      { pattern: 'match', max_results: 501 },
      { pattern: 'match', max_results: 1.5 },
      { pattern: 'match', glob_filter: '../*.log' },
      { pattern: 'match', glob_filter: '@(a|b).log' },
      { pattern: 'match', extra: true },
    ];

    for (const input of unsafe) {
      await expect(invoke(subsystem, input)).resolves.toMatchObject({
        status: 'FAILED',
        safeError: { code: 'CAPABILITY_INPUT_INVALID', category: 'VALIDATION' },
      });
    }
    const nestedQuantifier = await invoke(subsystem, { pattern: '(SECRET_REGEX+)+' });
    expect(nestedQuantifier.safeError?.message).toBe(
      'Grep pattern must not contain nested quantifiers. Correct the stated file-operation input and call the capability again.',
    );
    expect(JSON.stringify(nestedQuantifier.safeError)).not.toContain('SECRET_REGEX');
  });

  it('skips symlinked files and directories without escaping the workspace', async () => {
    const workspaceDir = await createWorkspace();
    const outsideDir = await createWorkspace();
    await writeWorkspaceFile(workspaceDir, 'safe/inside.log', 'match');
    await writeWorkspaceFile(outsideDir, 'outside.log', 'match');
    await symlink(outsideDir, join(workspaceDir, 'safe', 'linked-dir'), process.platform === 'win32' ? 'junction' : 'dir');
    if (process.platform !== 'win32') {
      await symlink(join(outsideDir, 'outside.log'), join(workspaceDir, 'safe', 'linked-file.log'), 'file');
    }
    const subsystem = createCapabilitySubsystem({ read: { workspaceDir } });

    await expect(invoke(subsystem, { pattern: 'match' })).resolves.toMatchObject({
      status: 'SUCCEEDED',
      structuredPayload: { filenames: ['workspace/safe/inside.log'], total_matches: 1 },
    });
  });

  it('skips binary files whose first 8 KiB contains a NUL byte', async () => {
    const workspaceDir = await createWorkspace();
    await writeWorkspaceFile(workspaceDir, 'diagnostics/text.log', 'match');
    const binaryPath = join(workspaceDir, 'diagnostics', 'blob.bin');
    await mkdir(join(binaryPath, '..'), { recursive: true });
    const binary = Buffer.concat([Buffer.from('prefix-'), Buffer.from([0]), Buffer.from('-match-')]);
    await writeFile(binaryPath, binary);
    const subsystem = createCapabilitySubsystem({ read: { workspaceDir } });

    await expect(invoke(subsystem, { pattern: 'match' })).resolves.toMatchObject({
      status: 'SUCCEEDED',
      structuredPayload: { filenames: ['workspace/diagnostics/text.log'], total_matches: 1 },
    });
  });

  it('enforces the max_results cap with stable lexical order in content mode', async () => {
    const workspaceDir = await createWorkspace();
    await mkdir(join(workspaceDir, 'many'), { recursive: true });
    for (let index = 0; index < 5; index += 1) {
      await writeWorkspaceFile(workspaceDir, `many/${String(index).padStart(2, '0')}.log`, 'match');
    }
    const subsystem = createCapabilitySubsystem({ read: { workspaceDir } });

    const capped = await invoke(subsystem, { pattern: 'match', output_mode: 'content', max_results: 3 });
    expect(capped).toMatchObject({
      status: 'SUCCEEDED',
      structuredPayload: { truncated: true, total_matches: 5 },
    });
    const cappedMatches = capped.structuredPayload.matches as Array<{ file_path: string; line_number: number; line: string }>;
    expect(cappedMatches).toHaveLength(3);
    expect(cappedMatches.map((entry) => entry.file_path)).toEqual(['workspace/many/00.log', 'workspace/many/01.log', 'workspace/many/02.log']);
    expect(cappedMatches.every((entry) => entry.line_number === 1 && entry.line === 'match')).toBe(true);
  });

  it('marks truncation when a matched line is capped to 4096 UTF-16 code units', async () => {
    const workspaceDir = await createWorkspace();
    const longLine = `match ${'x'.repeat(5000)}`;
    await writeWorkspaceFile(workspaceDir, 'diagnostics/long.log', longLine);
    const subsystem = createCapabilitySubsystem({ read: { workspaceDir } });

    const result = await invoke(subsystem, { pattern: 'match', output_mode: 'content' });

    expect(result.status).toBe('SUCCEEDED');
    expect(result.structuredPayload).toMatchObject({
      total_files_with_matches: 1,
      total_matches: 1,
      truncated: true,
    });
    expect(result.structuredPayload.matches).toEqual([
      {
        file_path: 'workspace/diagnostics/long.log',
        line_number: 1,
        line: longLine.slice(0, 4096),
      },
    ]);
  });

  it('matches against the full raw line even when the returned line is capped', async () => {
    const workspaceDir = await createWorkspace();
    const longLine = `${'x'.repeat(4096)}match-after-cap`;
    await writeWorkspaceFile(workspaceDir, 'diagnostics/late-match.log', longLine);
    const subsystem = createCapabilitySubsystem({ read: { workspaceDir } });

    const result = await invoke(subsystem, { pattern: 'match-after-cap', output_mode: 'content' });

    expect(result.status).toBe('SUCCEEDED');
    expect(result.structuredPayload).toMatchObject({
      total_files_with_matches: 1,
      total_matches: 1,
      truncated: true,
    });
    expect(result.structuredPayload.matches).toEqual([
      {
        file_path: 'workspace/diagnostics/late-match.log',
        line_number: 1,
        line: longLine.slice(0, 4096),
      },
    ]);
  });

  it('marks truncation when the per-file read budget cuts off a larger matched file', async () => {
    const workspaceDir = await createWorkspace();
    await writeWorkspaceFile(workspaceDir, 'diagnostics/large.log', `match\n${'x'.repeat(512 * 1024)}`);
    const subsystem = createCapabilitySubsystem({ read: { workspaceDir } });

    await expect(invoke(subsystem, { pattern: 'match', output_mode: 'content' })).resolves.toMatchObject({
      status: 'SUCCEEDED',
      structuredPayload: {
        matches: [{ file_path: 'workspace/diagnostics/large.log', line_number: 1, line: 'match' }],
        total_files_with_matches: 1,
        total_matches: 1,
        truncated: true,
      },
    });
  });

  it('marks depth truncation only when a deeper subtree exists', async () => {
    const workspaceDir = await createWorkspace();
    const depthTen = Array.from({ length: 10 }, (_, index) => `d${index}`).join('/');
    await writeWorkspaceFile(workspaceDir, `${depthTen}/included.log`, 'match');
    const subsystem = createCapabilitySubsystem({ read: { workspaceDir } });

    await expect(invoke(subsystem, { pattern: 'match' })).resolves.toMatchObject({
      status: 'SUCCEEDED',
      structuredPayload: { filenames: [`workspace/${depthTen}/included.log`], truncated: false },
    });

    await writeWorkspaceFile(workspaceDir, `${depthTen}/d10/excluded.log`, 'match');
    await expect(invoke(subsystem, { pattern: 'match' })).resolves.toMatchObject({
      status: 'SUCCEEDED',
      structuredPayload: { truncated: true },
    });
  });

  it('honors cancellation and fails safely for an unavailable root', async () => {
    const workspaceDir = await createWorkspace();
    const subsystem = createCapabilitySubsystem({
      read: { workspaceDir, readDirectories: ['missing'] },
    });
    const unavailable = await invoke(subsystem, { pattern: 'match' });
    expect(unavailable).toMatchObject({
      status: 'FAILED',
      structuredPayload: {},
      safeError: { code: 'FILE_UNAVAILABLE', category: 'NOT_FOUND' },
    });
    expect(JSON.stringify(unavailable)).not.toContain(workspaceDir);

    const controller = new AbortController();
    controller.abort();
    await expect(subsystem.invocationPort.invoke(request({ pattern: 'match' }), controller.signal)).resolves.toMatchObject({
      status: 'FAILED',
      safeError: { code: 'CAPABILITY_ABORTED', category: 'CANCELED' },
    });
  });

  it.skipIf(process.platform === 'win32' || process.getuid?.() === 0)(
    'fails safely instead of returning partial results for an unreadable descendant',
    async () => {
      const workspaceDir = await createWorkspace();
      await writeWorkspaceFile(workspaceDir, 'readable.log', 'match');
      await writeWorkspaceFile(workspaceDir, 'locked/hidden.log', 'match');
      await chmod(join(workspaceDir, 'locked'), 0);
      const subsystem = createCapabilitySubsystem({ read: { workspaceDir } });
      try {
        await expect(invoke(subsystem, { pattern: 'match' })).resolves.toMatchObject({
          status: 'FAILED',
          structuredPayload: {},
          safeError: { code: 'CAPABILITY_EXECUTION_FAILED', category: 'INTERNAL' },
        });
      } finally {
        await chmod(join(workspaceDir, 'locked'), 0o700);
      }
    },
  );
});

async function createWorkspace(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'nextagent-grep-'));
  tempDirectories.push(directory);
  return directory;
}

async function writeWorkspaceFile(workspaceDir: string, relativePath: string, content = 'content'): Promise<void> {
  const absolutePath = join(workspaceDir, ...relativePath.split('/'));
  await mkdir(join(absolutePath, '..'), { recursive: true });
  await writeFile(absolutePath, content);
}

async function invoke(subsystem: ReturnType<typeof createCapabilitySubsystem>, input: JsonObject) {
  return subsystem.invocationPort.invoke(request(input), new AbortController().signal);
}

function request(argumentsValue: JsonObject): CapabilityInvocationRequest {
  return {
    invocationId: 'invoke-grep',
    capabilityId: grepCapabilityId,
    arguments: argumentsValue,
    sessionId: brand<string, 'SessionId'>('session-grep'),
    requestId: brand<string, 'MessageId'>('request-grep'),
    runId: brand<string, 'RequestRunId'>('run-grep'),
    requestContextId: brand<string, 'RequestContextId'>('context-grep'),
    stepId: 'turn-1',
    identityContext: { tenantId: tenantId(), subjectId: subjectId(), displayName: 'Grep tester' },
    agentId: brand<string, 'AgentId'>('default-agent'),
    agentVersion: brand<string, 'AgentVersion'>('v1'),
    timeoutMs: 30_000,
    idempotencyKey: brand<string, 'IdempotencyKey'>('idem-grep'),
  };
}

function assembly(capabilityBindings: AgentAssembly['capabilityBindings']): AgentAssembly {
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
    capabilityBindings,
    userInvocable: true,
    agentInvocation: 'BOUND',
    runtimeSettings: { requestTimeoutMs: 1000 },
  };
}

function tenantId() {
  return brand<string, 'TenantId'>('tenant-grep');
}

function subjectId() {
  return brand<string, 'SubjectId'>('subject-grep');
}
