import {
  builtinToolsProvider,
  createCapabilitySubsystem,
  createToolCatalog,
  globCapabilityId,
  globToolDefinition,
} from '@nextagent/agent-capability';
import { brand, type JsonObject } from '@nextagent/agent-common';
import type { AgentAssembly } from '@nextagent/agent-contracts/agent-assembly';
import type { CapabilityInvocationRequest } from '@nextagent/agent-contracts/capability';
import { chmod, mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const tempDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
}, 60_000);

describe('glob capability', () => {
  it('is unavailable without the shared workspaceFiles dependency', async () => {
    const catalog = createToolCatalog({ provider: builtinToolsProvider, tools: [globToolDefinition] });

    await expect(catalog.listAll(new AbortController().signal)).resolves.toEqual([
      expect.objectContaining({
        capabilityId: 'Glob',
        availabilityStatus: 'UNAVAILABLE',
        availabilityReason: 'TOOL_DEPENDENCY_MISSING',
      }),
    ]);
    expect(catalog.resolveExecutable(globCapabilityId)).toBeUndefined();
  });

  it('registers strict IDEMPOTENT PascalCase metadata and follows Agent visibility', async () => {
    const workspaceDir = await createWorkspace();
    const subsystem = createCapabilitySubsystem({ read: { workspaceDir } });
    const visible = await subsystem.catalog.listAvailable({
      tenantId: tenantId(),
      subjectId: subjectId(),
      agentAssembly: assembly([{ capabilityId: globCapabilityId, capabilityType: 'TOOL', providerId: 'builtin-tools' }]),
      includeUnavailable: true,
    });
    const hidden = await subsystem.catalog.listAvailable({
      tenantId: tenantId(),
      subjectId: subjectId(),
      agentAssembly: assembly([{ capabilityId: globCapabilityId, capabilityType: 'TOOL', providerId: 'builtin-tools', enabled: false }]),
      includeUnavailable: true,
    });

    expect(visible).toContainEqual(
      expect.objectContaining({
        capabilityId: 'Glob',
        description: expect.not.stringContaining('Skill'),
        replayPolicy: 'IDEMPOTENT',
        availabilityStatus: 'AVAILABLE',
        inputSchema: expect.objectContaining({
          additionalProperties: false,
          required: ['pattern'],
          properties: expect.objectContaining({
            pattern: expect.objectContaining({
              type: 'string',
              minLength: 1,
              maxLength: 4096,
              description: expect.stringContaining('Usually this is the only field to pass'),
            }),
            path: expect.objectContaining({
              type: 'string',
              minLength: 1,
              maxLength: 4096,
              description: expect.not.stringContaining('Skill'),
            }),
          }),
        }),
        outputSchema: expect.objectContaining({
          required: ['filenames', 'truncated'],
        }),
      }),
    );
    const descriptor = visible.find((item) => item.capabilityId === globCapabilityId);
    expect(descriptor?.description).toContain('workspace');
    expect(descriptor?.description).toContain('Do not use Glob to confirm or read a known path');
    expect(descriptor?.description).toContain('does not sort by modification time');
    expect(descriptor?.inputSchema).toMatchObject({
      properties: { path: { description: expect.stringContaining('bare relative path aliases workspace/...') } },
    });
    expect(visible.some((descriptor) => descriptor.capabilityId === 'glob')).toBe(false);
    expect(hidden.some((descriptor) => descriptor.capabilityId === 'Glob')).toBe(false);
  });

  it('searches the normalized Read and Write root union when path is omitted', async () => {
    const workspaceDir = await createWorkspace();
    await writeWorkspaceFile(workspaceDir, 'read/alarms/current.log');
    await writeWorkspaceFile(workspaceDir, 'write/exports/result.log');
    await writeWorkspaceFile(workspaceDir, 'outside/secret.log');
    const subsystem = createCapabilitySubsystem({
      read: { workspaceDir, readDirectories: ['read'], writeDirectories: ['write'] },
    });

    const result = await invoke(subsystem, { pattern: '**/*.log' });

    expect(result).toMatchObject({
      status: 'SUCCEEDED',
      structuredPayload: {
        filenames: ['workspace/read/alarms/current.log', 'workspace/write/exports/result.log'],
        truncated: false,
      },
    });
  });

  it('searches shared-data only when an authorized root-qualified path is explicit', async () => {
    const runtimeWorkspaceRoot = await createWorkspace();
    const sharedDataRoot = await createWorkspace();
    await mkdir(join(runtimeWorkspaceRoot, 'workspace'), { recursive: true });
    await mkdir(join(sharedDataRoot, 'cases'), { recursive: true });
    await writeFile(join(sharedDataRoot, 'cases', 'alarm.json'), '{"alarm":true}', 'utf8');
    const subsystem = createCapabilitySubsystem({
      read: {
        runtimeWorkspaceRoot,
        sharedDataRoot,
        deploymentMode: 'LOCAL',
        executionWorkspaceResolver: {
          resolve(input: { readonly runtimeWorkspaceRoot: string; readonly sharedDataRoot?: string }) {
            return {
              workspaceDir: 'workspace/',
              defaultCwd: input.runtimeWorkspaceRoot,
              roots: [
                { kind: 'workspace', logicalPath: 'workspace', physicalPath: join(input.runtimeWorkspaceRoot, 'workspace'), access: 'readWrite' },
                { kind: 'systemResources', logicalPath: '.nextagent', physicalPath: join(input.runtimeWorkspaceRoot, '.nextagent'), access: 'read' },
                { kind: 'temp', logicalPath: 'temp', physicalPath: join(input.runtimeWorkspaceRoot, 'temp'), access: 'readWrite' },
                { kind: 'sharedData', logicalPath: 'shared-data', physicalPath: input.sharedDataRoot!, access: 'read' },
              ],
            };
          },
        },
        workspacePolicyProvider: {
          async require() {
            return sharedDataAssembly().workspacePolicy;
          },
        },
      },
    });

    await expect(invoke(subsystem, { pattern: '**/*.json' })).resolves.toMatchObject({
      status: 'SUCCEEDED',
      structuredPayload: { filenames: [], truncated: false },
    });
    await expect(invoke(subsystem, { pattern: '*.json', path: 'shared-data/cases' })).resolves.toMatchObject({
      status: 'SUCCEEDED',
      structuredPayload: { filenames: ['shared-data/cases/alarm.json'], truncated: false },
    });
  });

  it('deduplicates overlapping roots and denies discovery when effective Read authority is empty', async () => {
    const workspaceDir = await createWorkspace();
    await writeWorkspaceFile(workspaceDir, 'diagnostics/nested/alarm.log');
    const overlapping = createCapabilitySubsystem({
      read: {
        workspaceDir,
        readDirectories: ['diagnostics', 'diagnostics/nested'],
        writeDirectories: ['diagnostics'],
      },
    });

    await expect(invoke(overlapping, { pattern: '**/*.log' })).resolves.toMatchObject({
      status: 'SUCCEEDED',
      structuredPayload: { filenames: ['workspace/diagnostics/nested/alarm.log'], truncated: false },
    });

    const denied = createCapabilitySubsystem({
      read: { workspaceDir, readDirectories: [], writeDirectories: [] },
    });
    await expect(invoke(denied, { pattern: '**/*.log' })).resolves.toMatchObject({
      status: 'SUCCEEDED',
      structuredPayload: { filenames: [], truncated: false },
    });
    await expect(invoke(denied, { pattern: '**/*.log', path: '.' })).resolves.toMatchObject({
      status: 'FAILED',
      safeError: { code: 'CAPABILITY_PATH_REJECTED', category: 'AUTHORIZATION' },
    });
  });

  it('supports TonyClaw-style patterns, hidden files, braces, classes, and separator normalization', async () => {
    const workspaceDir = await createWorkspace();
    for (const path of [
      'diagnostics/.hidden.log',
      'diagnostics/a.log',
      'diagnostics/b.txt',
      'diagnostics/c.log',
      'diagnostics/nested/node-1.log',
      'diagnostics/nested/node-2.log',
    ]) {
      await writeWorkspaceFile(workspaceDir, path);
    }
    await writeWorkspaceFile(workspaceDir, '.gitignore', '*.log');
    const subsystem = createCapabilitySubsystem({ read: { workspaceDir } });

    await expect(invoke(subsystem, { pattern: 'diagnostics\\{a,c}.log' })).resolves.toMatchObject({
      status: 'SUCCEEDED',
      structuredPayload: { filenames: ['workspace/diagnostics/a.log', 'workspace/diagnostics/c.log'], truncated: false },
    });
    await expect(invoke(subsystem, { pattern: 'diagnostics/nested/node-[!2].log' })).resolves.toMatchObject({
      status: 'SUCCEEDED',
      structuredPayload: { filenames: ['workspace/diagnostics/nested/node-1.log'], truncated: false },
    });
    await expect(invoke(subsystem, { pattern: 'diagnostics/**/*.log' })).resolves.toMatchObject({
      status: 'SUCCEEDED',
      structuredPayload: {
        filenames: [
          'workspace/diagnostics/.hidden.log',
          'workspace/diagnostics/a.log',
          'workspace/diagnostics/c.log',
          'workspace/diagnostics/nested/node-1.log',
          'workspace/diagnostics/nested/node-2.log',
        ],
        truncated: false,
      },
    });
  });

  it('applies host case semantics', async () => {
    const workspaceDir = await createWorkspace();
    await writeWorkspaceFile(workspaceDir, 'Diagnostics/ALARM.LOG');
    const subsystem = createCapabilitySubsystem({ read: { workspaceDir } });

    const result = await invoke(subsystem, { pattern: 'diagnostics/*.log' });

    expect(result.status).toBe('SUCCEEDED');
    expect(result.structuredPayload.filenames).toEqual(process.platform === 'win32' ? ['workspace/Diagnostics/ALARM.LOG'] : []);
  });

  it('restricts explicit path to effective Read authority', async () => {
    const workspaceDir = await createWorkspace();
    await writeWorkspaceFile(workspaceDir, 'read/nested/one.log');
    await writeWorkspaceFile(workspaceDir, 'outside/two.log');
    const subsystem = createCapabilitySubsystem({
      read: { workspaceDir, readDirectories: ['read'] },
    });

    await expect(invoke(subsystem, { pattern: '*.log', path: 'read/nested' })).resolves.toMatchObject({
      status: 'SUCCEEDED',
      structuredPayload: { filenames: ['workspace/read/nested/one.log'], truncated: false },
    });
    for (const path of ['.', 'outside', '../outside', workspaceDir, '\\\\server\\share', 'C:\\Windows']) {
      await expect(invoke(subsystem, { pattern: '*.log', path })).resolves.toMatchObject({
        status: 'FAILED',
        safeError: { code: 'CAPABILITY_PATH_REJECTED', category: 'AUTHORIZATION' },
      });
    }
  });

  it('rejects malformed, unsupported, and expansion-heavy patterns before traversal', async () => {
    const workspaceDir = await createWorkspace();
    const subsystem = createCapabilitySubsystem({ read: { workspaceDir } });
    const tooManyAlternatives = `{${Array.from({ length: 33 }, (_, index) => `v${index}`).join(',')}}.log`;
    const tooManyCombinations = '{a,b,c,d,e,f,g,h,i,j,k,l,m,n,o,p,q}/{a,b,c,d,e,f,g,h,i,j,k,l,m,n,o,p,q}/*.log';
    const invalid: JsonObject[] = [
      {},
      { pattern: '' },
      { pattern: '   ' },
      { pattern: 7 },
      { pattern: 'x'.repeat(4097) },
      { pattern: '*.log', path: 7 },
      { pattern: '*.log', path: 'x'.repeat(4097) },
      { pattern: '../*.log' },
      { pattern: 'safe/../*.log' },
      { pattern: '/var/*.log' },
      { pattern: 'C:/*.log' },
      { pattern: '\\\\server\\share\\*.log' },
      { pattern: '\\\\?\\C:\\*.log' },
      { pattern: '!**/*.log' },
      { pattern: '@(a|b).log' },
      { pattern: '?(a|b).log' },
      { pattern: 'alarm\u0007.log' },
      { pattern: '[abc.log' },
      { pattern: 'abc].log' },
      { pattern: '[].log' },
      { pattern: '{a,b.log' },
      { pattern: 'a,b}.log' },
      { pattern: '{a,{b,c}}.log' },
      { pattern: '{a,}.log' },
      { pattern: '{1..10}.log' },
      { pattern: tooManyAlternatives },
      { pattern: tooManyCombinations },
      { pattern: '*.log', extra: true },
    ];

    for (const input of invalid) {
      await expect(invoke(subsystem, input)).resolves.toMatchObject({
        status: 'FAILED',
        safeError: { code: 'CAPABILITY_INPUT_INVALID', category: 'VALIDATION' },
      });
    }
    const traversal = await invoke(subsystem, { pattern: '../SECRET_GLOB_PATTERN.log' });
    expect(traversal.safeError?.message).toBe(
      'Glob pattern must be relative, must not traverse parent directories, and must not use extglob syntax. Correct the stated file-operation input and call the capability again.',
    );
    expect(JSON.stringify(traversal.safeError)).not.toContain('SECRET_GLOB_PATTERN');
  });

  it('skips symlinked files and directories without escaping the workspace', async () => {
    const workspaceDir = await createWorkspace();
    const outsideDir = await createWorkspace();
    await writeWorkspaceFile(workspaceDir, 'safe/inside.log');
    await writeWorkspaceFile(outsideDir, 'outside.log');
    await symlink(outsideDir, join(workspaceDir, 'safe', 'linked-dir'), process.platform === 'win32' ? 'junction' : 'dir');
    if (process.platform !== 'win32') {
      await symlink(join(outsideDir, 'outside.log'), join(workspaceDir, 'safe', 'linked-file.log'), 'file');
    }
    const subsystem = createCapabilitySubsystem({ read: { workspaceDir } });

    await expect(invoke(subsystem, { pattern: '**/*.log' })).resolves.toMatchObject({
      status: 'SUCCEEDED',
      structuredPayload: { filenames: ['workspace/safe/inside.log'], truncated: false },
    });
  });

  it('enforces the result limit with stable lexical output', async () => {
    const workspaceDir = await createWorkspace();
    await mkdir(join(workspaceDir, 'many'), { recursive: true });
    await Promise.all(Array.from({ length: 500 }, (_, index) => writeFile(join(workspaceDir, 'many', `${String(index).padStart(4, '0')}.log`), 'x')));
    const subsystem = createCapabilitySubsystem({ read: { workspaceDir } });

    const exact = await invoke(subsystem, { pattern: 'many/*.log' });
    expect(exact).toMatchObject({
      status: 'SUCCEEDED',
      structuredPayload: { truncated: false },
    });
    expect(exact.structuredPayload.filenames).toHaveLength(500);

    await writeFile(join(workspaceDir, 'many', '0500.log'), 'x');
    const result = await invoke(subsystem, { pattern: 'many/*.log' });
    expect(result.status).toBe('SUCCEEDED');
    expect(result.structuredPayload.truncated).toBe(true);
    const filenames = result.structuredPayload.filenames;
    expect(Array.isArray(filenames)).toBe(true);
    if (!Array.isArray(filenames)) {
      throw new Error('Expected Glob filenames array.');
    }
    expect(filenames).toHaveLength(500);
    expect(filenames[0]).toBe('workspace/many/0000.log');
    expect(filenames[499]).toBe('workspace/many/0499.log');
  });

  it('stops at the inspected-entry budget and reports omitted search space', async () => {
    const workspaceDir = await createWorkspace();
    const directory = join(workspaceDir, 'budget');
    await mkdir(directory, { recursive: true });
    const inspectedEntryBudget = 32;
    const fileCountAtExactBudget = inspectedEntryBudget - 1;
    await Promise.all(
      Array.from({ length: fileCountAtExactBudget }, (_, index) => writeFile(join(directory, `${String(index).padStart(5, '0')}.tmp`), 'x')),
    );
    const subsystem = createCapabilitySubsystem({ read: { workspaceDir, maxGlobInspectedEntries: inspectedEntryBudget } });

    await expect(invoke(subsystem, { pattern: 'budget/*.log' })).resolves.toMatchObject({
      status: 'SUCCEEDED',
      structuredPayload: { filenames: [], truncated: false },
    });

    await writeFile(join(directory, 'zzzz.log'), 'x');
    await expect(invoke(subsystem, { pattern: 'budget/*.log' })).resolves.toMatchObject({
      status: 'SUCCEEDED',
      structuredPayload: { truncated: true },
    });
  }, 120_000);

  it('marks depth truncation only when a deeper subtree exists', async () => {
    const workspaceDir = await createWorkspace();
    const depthTen = Array.from({ length: 10 }, (_, index) => `d${index}`).join('/');
    await writeWorkspaceFile(workspaceDir, `${depthTen}/included.log`);
    const subsystem = createCapabilitySubsystem({ read: { workspaceDir } });

    await expect(invoke(subsystem, { pattern: '**/*.log' })).resolves.toMatchObject({
      status: 'SUCCEEDED',
      structuredPayload: { filenames: [`workspace/${depthTen}/included.log`], truncated: false },
    });

    await writeWorkspaceFile(workspaceDir, `${depthTen}/d10/excluded.log`);
    await expect(invoke(subsystem, { pattern: '**/*.log' })).resolves.toMatchObject({
      status: 'SUCCEEDED',
      structuredPayload: { filenames: [`workspace/${depthTen}/included.log`], truncated: true },
    });
  });

  it.skipIf(process.platform === 'win32')('does not return Unix socket special files', async () => {
    const workspaceDir = await createWorkspace();
    await writeWorkspaceFile(workspaceDir, 'ordinary.log');
    const socketPath = join(workspaceDir, 'service.log');
    const server = createServer();
    await new Promise<void>((resolveListen, rejectListen) => {
      server.once('error', rejectListen);
      server.listen(socketPath, resolveListen);
    });
    try {
      const subsystem = createCapabilitySubsystem({ read: { workspaceDir } });
      await expect(invoke(subsystem, { pattern: '*.log' })).resolves.toMatchObject({
        status: 'SUCCEEDED',
        structuredPayload: { filenames: ['workspace/ordinary.log'], truncated: false },
      });
    } finally {
      await new Promise<void>((resolveClose, rejectClose) => {
        server.close((error) => (error === undefined ? resolveClose() : rejectClose(error)));
      });
    }
  });

  it('honors cancellation and fails safely for an unavailable root', async () => {
    const workspaceDir = await createWorkspace();
    const subsystem = createCapabilitySubsystem({
      read: { workspaceDir, readDirectories: ['missing'] },
    });
    const unavailable = await invoke(subsystem, { pattern: '**/*.log' });
    expect(unavailable).toMatchObject({
      status: 'FAILED',
      structuredPayload: {},
      safeError: { code: 'FILE_UNAVAILABLE', category: 'NOT_FOUND' },
    });
    expect(JSON.stringify(unavailable)).not.toContain(workspaceDir);

    const controller = new AbortController();
    controller.abort();
    await expect(subsystem.invocationPort.invoke(request({ pattern: '**/*.log' }), controller.signal)).resolves.toMatchObject({
      status: 'FAILED',
      safeError: { code: 'CAPABILITY_ABORTED', category: 'CANCELED' },
    });
  });

  it.skipIf(process.platform === 'win32' || process.getuid?.() === 0)(
    'fails safely instead of returning partial results for an unreadable descendant',
    async () => {
      const workspaceDir = await createWorkspace();
      await writeWorkspaceFile(workspaceDir, 'readable.log');
      await writeWorkspaceFile(workspaceDir, 'locked/hidden.log');
      await chmod(join(workspaceDir, 'locked'), 0);
      const subsystem = createCapabilitySubsystem({ read: { workspaceDir } });
      try {
        await expect(invoke(subsystem, { pattern: '**/*.log' })).resolves.toMatchObject({
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
  const directory = await mkdtemp(join(tmpdir(), 'nextagent-glob-'));
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
    invocationId: 'invoke-glob',
    capabilityId: globCapabilityId,
    arguments: argumentsValue,
    sessionId: brand<string, 'SessionId'>('session-glob'),
    requestId: brand<string, 'MessageId'>('request-glob'),
    runId: brand<string, 'RequestRunId'>('run-glob'),
    requestContextId: brand<string, 'RequestContextId'>('context-glob'),
    stepId: 'turn-1',
    identityContext: { tenantId: tenantId(), subjectId: subjectId(), displayName: 'Glob tester' },
    agentId: brand<string, 'AgentId'>('default-agent'),
    agentVersion: brand<string, 'AgentVersion'>('v1'),
    timeoutMs: 30_000,
    idempotencyKey: brand<string, 'IdempotencyKey'>('idem-glob'),
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

function sharedDataAssembly(): AgentAssembly {
  const base = assembly([]);
  return {
    ...base,
    workspacePolicy: {
      ...base.workspacePolicy,
      roots: [...base.workspacePolicy.roots, { kind: 'sharedData', logicalPath: 'shared-data', access: 'read' }],
      files: { readDirectories: ['workspace', 'shared-data'], writeDirectories: [], maxTextBytes: 256_000 },
    },
  };
}

function tenantId() {
  return brand<string, 'TenantId'>('tenant-glob');
}

function subjectId() {
  return brand<string, 'SubjectId'>('subject-glob');
}
