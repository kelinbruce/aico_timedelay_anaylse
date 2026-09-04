import { createCapabilitySubsystem, editCapabilityId, readCapabilityId, type ToolExecutionContext } from '@nextagent/agent-capability';
import { brand, type JsonObject } from '@nextagent/agent-common';
import type { AgentAssembly } from '@nextagent/agent-contracts/agent-assembly';
import type { CapabilityInvocationRequest } from '@nextagent/agent-contracts/capability';
import { mkdtemp, mkdir, readFile, readdir, rm, stat, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const tempDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe('edit capability', () => {
  it('discloses canonical Edit schema from Tool metadata', async () => {
    const workspaceDir = await createWorkspace();
    const subsystem = createCapabilitySubsystem({
      read: { workspaceDir, writeDirectories: ['.'] },
    });
    const descriptors = await subsystem.catalog.listAvailable({
      tenantId: tenantId(),
      subjectId: subjectId(),
      agentAssembly: assembly(),
      includeUnavailable: true,
    });

    const editDescriptor = descriptors.find((d) => d.capabilityId === 'Edit');
    expect(editDescriptor).toBeDefined();
    expect(editDescriptor!.inputSchema).toMatchObject({
      type: 'object',
      required: ['file_path', 'old_string', 'new_string'],
      properties: {
        file_path: { type: 'string' },
        old_string: { type: 'string' },
        new_string: { type: 'string' },
        replace_all: { type: 'boolean' },
      },
      additionalProperties: false,
    });
    expect(editDescriptor!.replayPolicy).toBe('NON_IDEMPOTENT');
    expect(editDescriptor!.description).toContain('relative paths resolve under `workspace/`');
    expect(editDescriptor!.description).toContain('Use `workspace/...` for files that should persist across runs');
    expect(editDescriptor!.description).toContain('Use `temp/...` for files needed only by the current run');
    expect(editDescriptor!.inputSchema).toMatchObject({
      properties: { file_path: { description: expect.stringContaining('bare relative path aliases workspace/...') } },
    });
    expect(editDescriptor!.description).toContain('Loaded Skill resources under `.nextagent/skills/...` are read-only projections');
    expect(editDescriptor!.description).toContain('output a patch/diff');
    expect(editDescriptor!.description).toContain('copy the script and required dependency files into `workspace/`');
    expect(editDescriptor!.description).toContain('preserving their relative layout');
  });

  it('returns FAILED when file does not exist', async () => {
    const workspaceDir = await createWorkspace();
    const subsystem = executableSubsystem(workspaceDir, { writeDirectories: ['.'] });

    const result = await subsystem.invocationPort.invoke(
      editRequest({ file_path: 'missing.txt', old_string: 'a', new_string: 'b' }, newContext()),
      new AbortController().signal,
    );

    expect(result).toMatchObject({
      status: 'FAILED',
      safeError: {
        code: 'EDIT_TARGET_MISSING',
        category: 'NOT_FOUND',
        retryable: false,
        message: expect.stringMatching(/does not exist.*locate.*Write/iu),
      },
    });
  });

  it('enforces required input fields', async () => {
    const workspaceDir = await createWorkspace();
    const subsystem = executableSubsystem(workspaceDir, { writeDirectories: ['.'] });

    const invalidInputs: JsonObject[] = [
      {},
      { file_path: 'x.txt' },
      { old_string: 'a', new_string: 'b' },
      { file_path: 'x.txt', old_string: '' },
      { file_path: 'x.txt', new_string: 'b' },
      { file_path: 'x.txt', old_string: 'same', new_string: 'same' },
      { file_path: 7, old_string: 'a', new_string: 'b' },
    ];

    for (const input of invalidInputs) {
      await expect(subsystem.invocationPort.invoke(editRequest(input, newContext()), new AbortController().signal)).resolves.toMatchObject({
        status: 'FAILED',
        safeError: { code: 'CAPABILITY_INPUT_INVALID', category: 'VALIDATION' },
      });
    }
    const unchanged = await subsystem.invocationPort.invoke(
      editRequest({ file_path: 'x.txt', old_string: 'same', new_string: 'same' }, newContext()),
      new AbortController().signal,
    );
    expect(unchanged.safeError?.message).toBe(
      'Edit new_string must differ from old_string. Correct the stated file-operation input and call the capability again.',
    );
  });

  it('replaces a unique old_string in an existing file', async () => {
    const workspaceDir = await createWorkspace();
    const subsystem = executableSubsystem(workspaceDir, { writeDirectories: ['.'] });
    const context = newContext();
    const filePath = 'target.txt';
    const originalContent = 'line 1\nline 2\nline 3\n';

    await createFile(workspaceDir, filePath, originalContent);
    await readFileToSnapshot(subsystem, filePath, context);

    const result = await subsystem.invocationPort.invoke(
      editRequest({ file_path: filePath, old_string: 'line 2', new_string: 'LINE TWO' }, context),
      new AbortController().signal,
    );

    expect(result).toMatchObject({
      status: 'SUCCEEDED',
      structuredPayload: {
        file_path: `workspace/${filePath}`,
        type: 'update',
        old_string: 'line 2',
        new_string: 'LINE TWO',
        replaced_count: 1,
      },
    });
    expect(await readFile(join(workspaceDir, filePath), 'utf8')).toBe('line 1\nLINE TWO\nline 3\n');
  });

  it('replaces all occurrences when replace_all is true', async () => {
    const workspaceDir = await createWorkspace();
    const subsystem = executableSubsystem(workspaceDir, { writeDirectories: ['.'] });
    const context = newContext();
    const filePath = 'target.txt';
    const originalContent = 'foo bar baz foo qux foo\n';

    await createFile(workspaceDir, filePath, originalContent);
    await readFileToSnapshot(subsystem, filePath, context);

    const result = await subsystem.invocationPort.invoke(
      editRequest({ file_path: filePath, old_string: 'foo', new_string: 'FOO', replace_all: true }, context),
      new AbortController().signal,
    );

    expect(result).toMatchObject({
      status: 'SUCCEEDED',
      structuredPayload: {
        file_path: `workspace/${filePath}`,
        replaced_count: 3,
        replace_all: true,
      },
    });
    expect(await readFile(join(workspaceDir, filePath), 'utf8')).toBe('FOO bar baz FOO qux FOO\n');
  });

  it('fails when old_string is not unique and replace_all is false', async () => {
    const workspaceDir = await createWorkspace();
    const subsystem = executableSubsystem(workspaceDir, { writeDirectories: ['.'] });
    const context = newContext();
    const filePath = 'dup.txt';
    const originalContent = 'dup\nmiddle\ndup\n';

    await createFile(workspaceDir, filePath, originalContent);
    await readFileToSnapshot(subsystem, filePath, context);

    const result = await subsystem.invocationPort.invoke(
      editRequest({ file_path: filePath, old_string: 'dup', new_string: 'DUP' }, context),
      new AbortController().signal,
    );

    expect(result).toMatchObject({
      status: 'FAILED',
      safeError: { code: 'EDIT_STRING_NOT_UNIQUE', category: 'VALIDATION' },
    });
    // File must be unchanged.
    expect(await readFile(join(workspaceDir, filePath), 'utf8')).toBe(originalContent);
  });

  it('fails when old_string is not found', async () => {
    const workspaceDir = await createWorkspace();
    const subsystem = executableSubsystem(workspaceDir, { writeDirectories: ['.'] });
    const context = newContext();
    const filePath = 'existing.txt';
    const originalContent = 'hello world\n';

    await createFile(workspaceDir, filePath, originalContent);
    await readFileToSnapshot(subsystem, filePath, context);

    const result = await subsystem.invocationPort.invoke(
      editRequest({ file_path: filePath, old_string: 'nonexistent', new_string: 'replacement' }, context),
      new AbortController().signal,
    );

    expect(result).toMatchObject({
      status: 'FAILED',
      safeError: { code: 'EDIT_STRING_NOT_FOUND', category: 'VALIDATION' },
    });
    expect(await readFile(join(workspaceDir, filePath), 'utf8')).toBe(originalContent);
  });

  it('does not echo edit strings in failed results', async () => {
    const workspaceDir = await createWorkspace();
    const subsystem = executableSubsystem(workspaceDir, { writeDirectories: ['.'] });
    const context = newContext();
    const filePath = 'no-leak.txt';

    await createFile(workspaceDir, filePath, 'visible\n');
    await readFileToSnapshot(subsystem, filePath, context);

    const result = await subsystem.invocationPort.invoke(
      editRequest({ file_path: filePath, old_string: 'secret-old-fragment', new_string: 'secret-new-fragment' }, context),
      new AbortController().signal,
    );

    expect(result).toMatchObject({
      status: 'FAILED',
      safeError: { code: 'EDIT_STRING_NOT_FOUND', category: 'VALIDATION' },
    });
    expect(JSON.stringify(result)).not.toContain('secret-old-fragment');
    expect(JSON.stringify(result)).not.toContain('secret-new-fragment');
  });

  it('requires a prior full Read before editing', async () => {
    const workspaceDir = await createWorkspace();
    const subsystem = executableSubsystem(workspaceDir, { writeDirectories: ['.'] });
    const context = newContext();
    const filePath = 'no-read.txt';

    await createFile(workspaceDir, filePath, 'content here\n');

    const result = await subsystem.invocationPort.invoke(
      editRequest({ file_path: filePath, old_string: 'content', new_string: 'CONTENT' }, context),
      new AbortController().signal,
    );

    expect(result).toMatchObject({
      status: 'FAILED',
      safeError: { code: 'EDIT_REQUIRES_FULL_READ', category: 'CONFLICT' },
    });
  });

  it('detects stale snapshot when file changes after Read', async () => {
    const workspaceDir = await createWorkspace();
    const subsystem = executableSubsystem(workspaceDir, { writeDirectories: ['.'] });
    const context = newContext();
    const filePath = 'stale.txt';

    await createFile(workspaceDir, filePath, 'original\n');
    await readFileToSnapshot(subsystem, filePath, context);

    // Modify file outside the tool.
    await writeFile(join(workspaceDir, filePath), 'modified\n', 'utf8');

    const result = await subsystem.invocationPort.invoke(
      editRequest({ file_path: filePath, old_string: 'original', new_string: 'replaced' }, context),
      new AbortController().signal,
    );

    expect(result).toMatchObject({
      status: 'FAILED',
      safeError: { code: 'EDIT_TARGET_CHANGED', category: 'CONFLICT' },
    });
  });

  it('shares one snapshot and canonical result across bare and workspace-qualified aliases', async () => {
    const workspaceDir = await createWorkspace();
    const subsystem = executableSubsystem(workspaceDir, { writeDirectories: ['.'] });
    const context = newContext();
    await createFile(workspaceDir, 'alias.txt', 'before\n');

    await readFileToSnapshot(subsystem, './alias.txt', context);
    const result = await subsystem.invocationPort.invoke(
      editRequest({ file_path: 'workspace/alias.txt', old_string: 'before', new_string: 'after' }, context),
      new AbortController().signal,
    );

    expect(result).toMatchObject({
      status: 'SUCCEEDED',
      structuredPayload: { file_path: 'workspace/alias.txt', replaced_count: 1 },
    });
    expect(await readFile(join(workspaceDir, 'alias.txt'), 'utf8')).toBe('after\n');
  });

  it('allows only one concurrent edit from the same full Read snapshot', async () => {
    const workspaceDir = await createWorkspace();
    const subsystem = executableSubsystem(workspaceDir, { writeDirectories: ['.'] });
    const context = newContext();
    const filePath = 'concurrent.txt';

    await createFile(workspaceDir, filePath, 'before\n');
    await readFileToSnapshot(subsystem, filePath, context);

    const results = await Promise.all([
      subsystem.invocationPort.invoke(
        editRequest({ file_path: filePath, old_string: 'before', new_string: 'first' }, context),
        new AbortController().signal,
      ),
      subsystem.invocationPort.invoke(
        editRequest({ file_path: filePath, old_string: 'before', new_string: 'second' }, context),
        new AbortController().signal,
      ),
    ]);

    expect(results.filter((result) => result.status === 'SUCCEEDED')).toHaveLength(1);
    expect(results.filter((result) => result.safeError?.code === 'EDIT_TARGET_CHANGED')).toHaveLength(1);
    expect(['first\n', 'second\n']).toContain(await readFile(join(workspaceDir, filePath), 'utf8'));
  });

  it('reports an atomic replacement failure before commit as known not committed', async () => {
    const workspaceDir = await createWorkspace();
    const filePath = 'atomic-edit-failure.txt';
    const targetPath = join(workspaceDir, filePath);
    const originalContent = `before-${'x'.repeat(200_000)}`;
    const subsystem = executableSubsystem(workspaceDir, { writeDirectories: ['.'] });
    const context = newContext();
    await createFile(workspaceDir, filePath, originalContent);
    await readFileToSnapshot(subsystem, filePath, context);

    const invocation = subsystem.invocationPort.invoke(
      editRequest({ file_path: filePath, old_string: 'before', new_string: 'after' }, context),
      new AbortController().signal,
    );
    await replaceTargetWithDirectoryAfterTemporaryFileAppears(workspaceDir, targetPath, filePath);
    const result = await invocation;

    expect(result).toMatchObject({
      status: 'FAILED',
      structuredPayload: {},
      safeError: {
        code: 'EDIT_ATOMIC_REPLACE_FAILED',
        category: 'INTERNAL',
        retryable: false,
        message: expect.stringContaining('did not commit'),
      },
    });
    expect(result.safeError?.message).not.toMatch(/unknown|verify/iu);
    expect((await stat(targetPath)).isDirectory()).toBe(true);
    expect((await readdir(workspaceDir)).some((entry) => entry.includes('.nextagent-'))).toBe(false);
  });

  it('rejects edits outside configured write directories', async () => {
    const workspaceDir = await createWorkspace();
    const subsystem = executableSubsystem(workspaceDir, { writeDirectories: ['allowed'] });
    const context = newContext();
    const filePath = 'allowed/target.txt';

    await mkdir(join(workspaceDir, 'allowed'), { recursive: true });
    await createFile(workspaceDir, filePath, 'line one\nline two\n');
    await readFileToSnapshot(subsystem, filePath, context);

    const denied = await subsystem.invocationPort.invoke(
      editRequest({ file_path: 'other/target.txt', old_string: 'a', new_string: 'b' }, context),
      new AbortController().signal,
    );

    expect(denied).toMatchObject({
      status: 'FAILED',
      safeError: { code: 'CAPABILITY_PATH_REJECTED', category: 'AUTHORIZATION' },
    });
  });

  it('preserves file encoding when editing a UTF-8 file', async () => {
    const workspaceDir = await createWorkspace();
    const subsystem = executableSubsystem(workspaceDir, { writeDirectories: ['.'] });
    const context = newContext();
    const filePath = 'utf8.txt';
    const originalContent = 'hello world\n';

    await createFile(workspaceDir, filePath, originalContent);
    await readFileToSnapshot(subsystem, filePath, context);

    await subsystem.invocationPort.invoke(
      editRequest({ file_path: filePath, old_string: 'world', new_string: 'WORLD' }, context),
      new AbortController().signal,
    );

    expect(await readFile(join(workspaceDir, filePath), 'utf8')).toBe('hello WORLD\n');
  });

  it('rejects edited content that exceeds maxTextBytes', async () => {
    const workspaceDir = await createWorkspace();
    const subsystem = executableSubsystem(workspaceDir, { writeDirectories: ['.'], maxTextBytes: 4 });
    const context = newContext();
    const filePath = 'too-large.txt';

    await createFile(workspaceDir, filePath, 'a\n');
    await readFileToSnapshot(subsystem, filePath, context);

    const result = await subsystem.invocationPort.invoke(
      editRequest({ file_path: filePath, old_string: 'a', new_string: 'abcde' }, context),
      new AbortController().signal,
    );

    expect(result).toMatchObject({
      status: 'FAILED',
      safeError: { code: 'CAPABILITY_INPUT_INVALID', category: 'VALIDATION' },
    });
    expect(await readFile(join(workspaceDir, filePath), 'utf8')).toBe('a\n');
  });

  it('snapshot is cleared by clearRun', async () => {
    const workspaceDir = await createWorkspace();
    const subsystem = executableSubsystem(workspaceDir, { writeDirectories: ['.'] });
    const context = newContext();
    const filePath = 'cleared.txt';

    await createFile(workspaceDir, filePath, 'before\n');
    await readFileToSnapshot(subsystem, filePath, context);

    const result = await subsystem.invocationPort.invoke(
      editRequest({ file_path: filePath, old_string: 'before', new_string: 'after' }, context),
      new AbortController().signal,
    );

    expect(result.status).toBe('SUCCEEDED');
    expect(await readFile(join(workspaceDir, filePath), 'utf8')).toBe('after\n');

    // After clearRun, a fresh Read is required.
    subsystem.runLifecycle.onTerminalRun({
      agentId: context.agentId!,
      runId: context.runId!,
    });

    const afterClear = await subsystem.invocationPort.invoke(
      editRequest({ file_path: filePath, old_string: 'after', new_string: 'AFTER' }, context),
      new AbortController().signal,
    );

    expect(afterClear).toMatchObject({
      status: 'FAILED',
      safeError: { code: 'EDIT_REQUIRES_FULL_READ', category: 'CONFLICT' },
    });
  });
});

async function createWorkspace(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'nextagent-edit-'));
  tempDirectories.push(directory);
  return directory;
}

async function createFile(workspaceDir: string, filePath: string, content: string): Promise<void> {
  const fullPath = join(workspaceDir, filePath);
  await mkdir(join(fullPath, '..'), { recursive: true });
  await writeFile(fullPath, content, 'utf8');
}

async function replaceTargetWithDirectoryAfterTemporaryFileAppears(workspaceDir: string, targetPath: string, filePath: string): Promise<void> {
  for (let attempt = 0; attempt < 10_000; attempt += 1) {
    const temporaryFileExists = (await readdir(workspaceDir)).some((entry) => entry.startsWith(`${filePath}.nextagent-`) && entry.endsWith('.tmp'));
    if (temporaryFileExists) {
      await unlink(targetPath);
      await mkdir(targetPath);
      return;
    }
    await new Promise<void>((resolveImmediate) => setImmediate(resolveImmediate));
  }
  throw new Error('Atomic replacement temporary file was not observed.');
}

async function readFileToSnapshot(
  subsystem: ReturnType<typeof createCapabilitySubsystem>,
  filePath: string,
  context: CapabilityInvocationRequest,
): Promise<void> {
  const result = await subsystem.invocationPort.invoke(
    readRequest({ file_path: filePath, offset: 0, limit: 2000 }, context),
    new AbortController().signal,
  );
  if (result.status !== 'SUCCEEDED') {
    throw new Error(`Read failed: ${JSON.stringify(result)}`);
  }
}

function executableSubsystem(workspaceDir: string, read: { readonly writeDirectories: readonly string[]; readonly maxTextBytes?: number }) {
  return createCapabilitySubsystem({
    read: { workspaceDir, ...read },
  });
}

function newContext(): CapabilityInvocationRequest & { identityContext: CapabilityInvocationRequest['identityContext'] } {
  return {
    invocationId: 'invoke-edit',
    capabilityId: editCapabilityId,
    arguments: {},
    sessionId: brand<string, 'SessionId'>('session-edit'),
    requestId: brand<string, 'MessageId'>('request-edit'),
    runId: brand<string, 'RequestRunId'>('run-edit'),
    requestContextId: brand<string, 'RequestContextId'>('context-edit'),
    stepId: 'turn-1',
    identityContext: {
      tenantId: tenantId(),
      subjectId: subjectId(),
      displayName: 'Edit tester',
    },
    agentId: brand<string, 'AgentId'>('default-agent'),
    agentVersion: brand<string, 'AgentVersion'>('v1'),
    timeoutMs: 30_000,
    idempotencyKey: brand<string, 'IdempotencyKey'>('idem-edit'),
  };
}

function editRequest(argumentsValue: JsonObject, overrides: Partial<CapabilityInvocationRequest> = {}): CapabilityInvocationRequest {
  return {
    ...newContext(),
    ...overrides,
    arguments: argumentsValue,
    capabilityId: editCapabilityId,
  };
}

function readRequest(argumentsValue: JsonObject, overrides: Partial<CapabilityInvocationRequest> = {}): CapabilityInvocationRequest {
  return {
    ...newContext(),
    ...overrides,
    arguments: argumentsValue,
    capabilityId: readCapabilityId,
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
    capabilityBindings: [
      { capabilityId: 'Read', capabilityType: 'TOOL', providerId: 'builtin-tools' },
      { capabilityId: 'Edit', capabilityType: 'TOOL', providerId: 'builtin-tools' },
    ],
    userInvocable: true,
    agentInvocation: 'BOUND',
    runtimeSettings: { requestTimeoutMs: 1000 },
  };
}

function tenantId() {
  return brand<string, 'TenantId'>('tenant-edit');
}

function subjectId() {
  return brand<string, 'SubjectId'>('subject-edit');
}
