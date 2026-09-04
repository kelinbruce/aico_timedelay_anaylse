import { createWorkspaceFilePort, type ToolExecutionContext } from '@nextagent/agent-capability';
import { brand } from '@nextagent/agent-common';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const tempDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe('workspace file extension policy', () => {
  it('uses workspace as the file-tool default and omits other authorized roots from default search', async () => {
    const scopeBase = await createWorkspace();
    const physicalWorkspace = join(scopeBase, 'workspace');
    const currentTemp = join(scopeBase, 'temp', 'current-run');
    const systemResources = join(scopeBase, '.nextagent');
    const generatedSkills = join(scopeBase, 'generated-skills');
    await writeWorkspaceFile(physicalWorkspace, 'root.txt', 'needle root');
    await writeWorkspaceFile(physicalWorkspace, 'durable.txt', 'needle durable');
    await writeWorkspaceFile(currentTemp, 'current.txt', 'needle temp');
    await writeWorkspaceFile(join(scopeBase, 'temp', 'other-run'), 'secret.txt', 'needle other run');
    await writeWorkspaceFile(systemResources, 'secret.txt', 'needle system');
    const files = createWorkspaceFilePort({
      runtimeWorkspaceRoot: scopeBase,
      deploymentMode: 'REMOTE',
      executionWorkspaceResolver: {
        resolve() {
          return {
            workspaceDir: 'workspace/',
            defaultCwd: '/work',
            roots: [
              { kind: 'workspace', logicalPath: 'workspace', physicalPath: physicalWorkspace, access: 'readWrite' },
              { kind: 'systemResources', logicalPath: '.nextagent', physicalPath: systemResources, access: 'read' },
              { kind: 'temp', logicalPath: 'temp', physicalPath: currentTemp, access: 'readWrite' },
              { kind: 'generatedSkills', logicalPath: 'generated-skills', physicalPath: generatedSkills, access: 'readWrite' },
            ],
          };
        },
      },
      workspacePolicyProvider: {
        async require() {
          return {
            ...workspacePolicy(),
            files: { readDirectories: ['workspace', 'temp'], writeDirectories: ['workspace'], maxTextBytes: 256_000 },
          };
        },
      },
    });
    const toolContext = context();

    await expect(files.readText({ file_path: 'root.txt' }, toolContext)).resolves.toMatchObject({
      file_path: 'workspace/root.txt',
      content: 'needle root',
    });
    await expect(files.writeText({ file_path: 'created.txt', content: 'before' }, toolContext)).resolves.toMatchObject({
      type: 'create',
      file_path: 'workspace/created.txt',
    });
    expect(await readFile(join(physicalWorkspace, 'created.txt'), 'utf8')).toBe('before');
    await files.readText({ file_path: 'created.txt' }, toolContext);
    await expect(files.editText({ file_path: 'created.txt', old_string: 'before', new_string: 'after' }, toolContext)).resolves.toMatchObject({
      type: 'update',
      file_path: 'workspace/created.txt',
    });
    expect(await readFile(join(physicalWorkspace, 'created.txt'), 'utf8')).toBe('after');

    await expect(files.writeText({ file_path: 'workspace/result.txt', content: 'durable result' }, toolContext)).resolves.toMatchObject({
      type: 'create',
      file_path: 'workspace/result.txt',
    });
    expect(await readFile(join(physicalWorkspace, 'result.txt'), 'utf8')).toBe('durable result');

    await expect(files.globFiles({ pattern: '**/*.txt' }, toolContext)).resolves.toEqual({
      filenames: ['workspace/created.txt', 'workspace/durable.txt', 'workspace/result.txt', 'workspace/root.txt'],
      truncated: false,
    });
    await expect(files.grepFiles({ pattern: 'needle' }, toolContext)).resolves.toMatchObject({
      filenames: ['workspace/durable.txt', 'workspace/root.txt'],
      total_files_with_matches: 2,
    });
    await expect(files.readText({ file_path: 'temp/current.txt' }, toolContext)).resolves.toMatchObject({
      file_path: 'temp/current.txt',
      content: 'needle temp',
    });
    await expect(files.readText({ file_path: '.nextagent/secret.txt' }, toolContext)).rejects.toMatchObject({
      code: 'CAPABILITY_PATH_REJECTED',
      category: 'AUTHORIZATION',
    });
  });

  it('treats bare and root-qualified workspace paths as the same configured target', async () => {
    const scopeBase = await createWorkspace();
    const physicalWorkspace = join(scopeBase, 'workspace');
    const files = createWorkspaceFilePort({
      runtimeWorkspaceRoot: scopeBase,
      deploymentMode: 'LOCAL',
      executionWorkspaceResolver: {
        resolve() {
          return {
            workspaceDir: 'workspace/',
            defaultCwd: scopeBase,
            roots: [
              { kind: 'workspace', logicalPath: 'workspace', physicalPath: physicalWorkspace, access: 'readWrite' },
              { kind: 'systemResources', logicalPath: '.nextagent', physicalPath: join(scopeBase, '.nextagent'), access: 'read' },
              { kind: 'temp', logicalPath: 'temp', physicalPath: join(scopeBase, 'temp', 'current-run'), access: 'readWrite' },
            ],
          };
        },
      },
      workspacePolicyProvider: {
        async require() {
          return {
            ...workspacePolicy(),
            files: { writeDirectories: ['workspace'], maxTextBytes: 256_000 },
          };
        },
      },
    });

    await expect(files.writeText({ file_path: 'root.txt', content: 'allowed' }, context())).resolves.toMatchObject({
      type: 'create',
      file_path: 'workspace/root.txt',
    });
    await expect(files.writeText({ file_path: 'workspace/durable.txt', content: 'allowed' }, context())).resolves.toMatchObject({
      type: 'create',
      file_path: 'workspace/durable.txt',
    });
    expect(await readFile(join(physicalWorkspace, 'durable.txt'), 'utf8')).toBe('allowed');
    expect(await readFile(join(physicalWorkspace, 'root.txt'), 'utf8')).toBe('allowed');
  });

  it('allows every extension when neither list is configured', async () => {
    const workspaceDir = await createWorkspace();
    await writeWorkspaceFile(workspaceDir, 'README', 'telecom alarm');
    const files = createWorkspaceFilePort({ workspaceDir, writeDirectories: ['.'] });

    await expect(files.readText({ file_path: 'README' }, context())).resolves.toMatchObject({ content: 'telecom alarm' });
    await expect(files.writeText({ file_path: 'result.bin', content: 'ok' }, context())).resolves.toMatchObject({ type: 'create' });
  });

  it('applies deny first and filters Glob and Grep before returning or reading files', async () => {
    const workspaceDir = await createWorkspace();
    await writeWorkspaceFile(workspaceDir, 'alarm.JSON', 'needle allowed');
    await writeWorkspaceFile(workspaceDir, 'blocked.log', 'needle denied');
    await writeWorkspaceFile(workspaceDir, 'archive.tar.gz', 'needle final suffix');
    await writeWorkspaceFile(workspaceDir, '.env', 'needle hidden no suffix');
    await writeWorkspaceFile(workspaceDir, 'README', 'needle no suffix');
    await writeWorkspaceFile(workspaceDir, 'name.', 'needle trailing dot');
    const files = createWorkspaceFilePort({
      workspaceDir,
      readAllowedExtensions: ['.json', '.log', '.gz'],
      readDeniedExtensions: ['.log'],
    });

    await expect(files.readText({ file_path: 'alarm.JSON' }, context())).resolves.toMatchObject({ content: 'needle allowed' });
    await expect(files.readText({ file_path: 'blocked.log' }, context())).rejects.toMatchObject({
      code: 'CAPABILITY_PATH_REJECTED',
      category: 'AUTHORIZATION',
      retryable: false,
    });
    await expect(files.readText({ file_path: 'missing.log' }, context())).rejects.toMatchObject({
      code: 'CAPABILITY_PATH_REJECTED',
      category: 'AUTHORIZATION',
      retryable: false,
    });
    await expect(files.readText({ file_path: '.env' }, context())).rejects.toMatchObject({ code: 'CAPABILITY_PATH_REJECTED' });
    await expect(files.readText({ file_path: 'README' }, context())).rejects.toMatchObject({ code: 'CAPABILITY_PATH_REJECTED' });
    await expect(files.readText({ file_path: 'name.' }, context())).rejects.toMatchObject({
      code: 'CAPABILITY_PATH_REJECTED',
      category: 'AUTHORIZATION',
      retryable: false,
    });

    await expect(files.globFiles({ pattern: '**/*' }, context())).resolves.toEqual({
      filenames: ['workspace/alarm.JSON', 'workspace/archive.tar.gz'],
      truncated: false,
    });
    await expect(files.grepFiles({ pattern: 'needle' }, context())).resolves.toMatchObject({
      filenames: ['workspace/alarm.JSON', 'workspace/archive.tar.gz'],
    });
  });

  it.each([
    ['deny-only', undefined, ['.log'], ['README', 'alarm.json']],
    ['allow-only', ['.json'], undefined, ['alarm.json']],
  ] as const)('implements the %s truth-table branch', async (_caseName, allowed, denied, expected) => {
    const workspaceDir = await createWorkspace();
    await writeWorkspaceFile(workspaceDir, 'alarm.json', 'allowed');
    await writeWorkspaceFile(workspaceDir, 'alarm.log', 'conditional');
    await writeWorkspaceFile(workspaceDir, 'README', 'no suffix');
    const files = createWorkspaceFilePort({
      workspaceDir,
      ...(allowed === undefined ? {} : { readAllowedExtensions: allowed }),
      ...(denied === undefined ? {} : { readDeniedExtensions: denied }),
    });

    await expect(files.globFiles({ pattern: '*' }, context())).resolves.toMatchObject({
      filenames: expected.map((path) => `workspace/${path}`),
    });
  });

  it('filters unauthorized Glob entries before applying the visible result limit', async () => {
    const workspaceDir = await createWorkspace();
    await Promise.all(
      Array.from({ length: 520 }, async (_value, index) => {
        await writeWorkspaceFile(workspaceDir, `blocked-${String(index).padStart(3, '0')}.pem`, 'hidden');
      }),
    );
    await writeWorkspaceFile(workspaceDir, 'visible.txt', 'authorized');
    const files = createWorkspaceFilePort({
      workspaceDir,
      readAllowedExtensions: ['.txt'],
      readDeniedExtensions: ['.pem'],
    });

    await expect(files.globFiles({ pattern: '**/*' }, context())).resolves.toEqual({
      filenames: ['workspace/visible.txt'],
      truncated: false,
    });
  });

  it('does not charge unauthorized Grep files against the total read-byte budget', async () => {
    const workspaceDir = await createWorkspace();
    const deniedPayload = 'x'.repeat(512 * 1024);
    await Promise.all(
      Array.from({ length: 65 }, async (_value, index) => {
        await writeWorkspaceFile(workspaceDir, `blocked-${String(index).padStart(2, '0')}.pem`, deniedPayload);
      }),
    );
    await writeWorkspaceFile(workspaceDir, 'visible.txt', 'needle authorized');
    const files = createWorkspaceFilePort({
      workspaceDir,
      readAllowedExtensions: ['.txt'],
      readDeniedExtensions: ['.pem'],
    });

    await expect(files.grepFiles({ pattern: 'needle' }, context())).resolves.toMatchObject({
      filenames: ['workspace/visible.txt'],
      total_files_with_matches: 1,
      total_matches: 1,
      truncated: false,
    });
  });

  it('keeps Read and Write policies independent and returns recoverable extension errors before target checks', async () => {
    const workspaceDir = await createWorkspace();
    await writeWorkspaceFile(workspaceDir, 'existing.json', 'before');
    const files = createWorkspaceFilePort({
      workspaceDir,
      writeDirectories: ['.'],
      readAllowedExtensions: ['.json'],
      writeAllowedExtensions: ['.json', '.log'],
      writeDeniedExtensions: ['.log'],
    });
    const toolContext = context();

    await expect(files.writeText({ file_path: 'new.json', content: 'created' }, toolContext)).resolves.toMatchObject({ type: 'create' });
    await expect(files.writeText({ file_path: 'missing.log', content: 'blocked' }, toolContext)).rejects.toMatchObject({
      code: 'CAPABILITY_PATH_REJECTED',
      category: 'AUTHORIZATION',
      retryable: false,
    });
    await writeWorkspaceFile(workspaceDir, 'existing.log', 'blocked');
    await expect(files.writeText({ file_path: 'existing.log', content: 'still blocked' }, toolContext)).rejects.toMatchObject({
      code: 'CAPABILITY_PATH_REJECTED',
      category: 'AUTHORIZATION',
      retryable: false,
    });
    await expect(files.editText({ file_path: 'missing.log', old_string: 'a', new_string: 'b' }, toolContext)).rejects.toMatchObject({
      code: 'CAPABILITY_PATH_REJECTED',
      category: 'AUTHORIZATION',
      retryable: false,
    });

    await files.readText({ file_path: 'existing.json' }, toolContext);
    await expect(files.editText({ file_path: 'existing.json', old_string: 'before', new_string: 'after' }, toolContext)).resolves.toMatchObject({
      type: 'update',
      replaced_count: 1,
    });
  });

  it('still requires a successful full Read before overwriting or editing an existing write-authorized file', async () => {
    const workspaceDir = await createWorkspace();
    await writeWorkspaceFile(workspaceDir, 'existing.json', 'before');
    const files = createWorkspaceFilePort({
      workspaceDir,
      writeDirectories: ['.'],
      readAllowedExtensions: ['.log'],
      writeAllowedExtensions: ['.json'],
    });
    const toolContext = context();

    await expect(files.writeText({ file_path: 'new.json', content: 'created' }, toolContext)).resolves.toMatchObject({ type: 'create' });
    await expect(files.readText({ file_path: 'existing.json' }, toolContext)).rejects.toMatchObject({
      code: 'CAPABILITY_PATH_REJECTED',
      category: 'AUTHORIZATION',
      retryable: false,
    });
    await expect(files.writeText({ file_path: 'existing.json', content: 'changed' }, toolContext)).rejects.toMatchObject({
      code: 'WRITE_REQUIRES_FULL_READ',
    });
    await expect(files.editText({ file_path: 'existing.json', old_string: 'before', new_string: 'after' }, toolContext)).rejects.toMatchObject({
      code: 'EDIT_REQUIRES_FULL_READ',
    });
  });

  it('matches uppercase target suffixes for Write and Edit without weakening snapshot checks', async () => {
    const workspaceDir = await createWorkspace();
    await writeWorkspaceFile(workspaceDir, 'existing.JSON', 'Status=pending');
    const files = createWorkspaceFilePort({
      workspaceDir,
      writeDirectories: ['.'],
      readAllowedExtensions: ['.json'],
      writeAllowedExtensions: ['.json'],
    });
    const toolContext = context();

    await expect(files.writeText({ file_path: 'created.JSON', content: 'Status=created' }, toolContext)).resolves.toMatchObject({ type: 'create' });
    await expect(files.readText({ file_path: 'existing.JSON' }, toolContext)).resolves.toMatchObject({ content: 'Status=pending' });
    await expect(
      files.editText(
        {
          file_path: 'existing.JSON',
          old_string: 'Status=pending',
          new_string: 'Status=verified',
        },
        toolContext,
      ),
    ).resolves.toMatchObject({ type: 'update', replaced_count: 1 });
    await expect(files.readText({ file_path: 'existing.JSON' }, toolContext)).resolves.toMatchObject({ content: 'Status=verified' });
  });

  it('isolates resolved extension policies by Agent version', async () => {
    const runtimeWorkspaceRoot = await createWorkspace();
    const physicalWorkspace = join(runtimeWorkspaceRoot, 'workspace');
    await writeWorkspaceFile(physicalWorkspace, 'alarm.json', 'versioned');
    const files = createWorkspaceFilePort({
      runtimeWorkspaceRoot,
      deploymentMode: 'LOCAL',
      executionWorkspaceResolver: {
        resolve() {
          return {
            workspaceDir: 'workspace/',
            defaultCwd: runtimeWorkspaceRoot,
            roots: [
              { kind: 'workspace', logicalPath: 'workspace', physicalPath: physicalWorkspace, access: 'readWrite' },
              { kind: 'systemResources', logicalPath: '.nextagent', physicalPath: join(runtimeWorkspaceRoot, '.nextagent'), access: 'read' },
              { kind: 'temp', logicalPath: 'temp', physicalPath: join(runtimeWorkspaceRoot, 'temp'), access: 'readWrite' },
            ],
          };
        },
      },
      workspacePolicyProvider: {
        async require() {
          return workspacePolicy();
        },
      },
      workspaceFileExtensionPolicyProvider: {
        async require(_agentId, agentVersion) {
          return {
            readAllowedExtensions: agentVersion === 'v1' ? ['.json'] : ['.log'],
            writeAllowedExtensions: agentVersion === 'v1' ? ['.json'] : ['.log'],
          };
        },
      },
    });

    await expect(files.readText({ file_path: 'workspace/alarm.json' }, context('v1'))).resolves.toMatchObject({ content: 'versioned' });
    await expect(files.readText({ file_path: 'workspace/alarm.json' }, context('v2'))).rejects.toMatchObject({
      code: 'CAPABILITY_PATH_REJECTED',
      category: 'AUTHORIZATION',
      retryable: false,
    });
    await expect(files.writeText({ file_path: 'workspace/allowed-v1.json', content: 'v1' }, context('v1'))).resolves.toMatchObject({
      type: 'create',
    });
    await expect(files.writeText({ file_path: 'workspace/blocked-v2.json', content: 'v2' }, context('v2'))).rejects.toMatchObject({
      code: 'CAPABILITY_PATH_REJECTED',
      retryable: false,
    });
    await expect(files.writeText({ file_path: 'allowed-v2.log', content: 'v2' }, context('v2'))).resolves.toMatchObject({ type: 'create' });
  });

  it('treats an explicitly empty allowlist as deny-all', async () => {
    const workspaceDir = await createWorkspace();
    await writeWorkspaceFile(workspaceDir, 'alarm.json', 'blocked');
    const files = createWorkspaceFilePort({ workspaceDir, readAllowedExtensions: [], writeAllowedExtensions: [], writeDirectories: ['.'] });

    await expect(files.readText({ file_path: 'alarm.json' }, context())).rejects.toMatchObject({
      code: 'CAPABILITY_PATH_REJECTED',
      category: 'AUTHORIZATION',
      retryable: false,
    });
    await expect(files.globFiles({ pattern: '**/*' }, context())).resolves.toEqual({ filenames: [], truncated: false });
    await expect(files.grepFiles({ pattern: 'blocked' }, context())).resolves.toMatchObject({
      filenames: [],
      total_files_with_matches: 0,
      total_matches: 0,
    });
    await expect(files.writeText({ file_path: 'new.json', content: 'blocked' }, context())).rejects.toMatchObject({
      code: 'CAPABILITY_PATH_REJECTED',
      retryable: false,
    });
    await expect(files.editText({ file_path: 'alarm.json', old_string: 'blocked', new_string: 'changed' }, context())).rejects.toMatchObject({
      code: 'CAPABILITY_PATH_REJECTED',
      retryable: false,
    });
  });
});

async function createWorkspace(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'nextagent-extension-policy-'));
  tempDirectories.push(directory);
  return directory;
}

async function writeWorkspaceFile(workspaceDir: string, relativePath: string, content: string): Promise<void> {
  const absolutePath = join(workspaceDir, ...relativePath.split('/'));
  await mkdir(join(absolutePath, '..'), { recursive: true });
  await writeFile(absolutePath, content, 'utf8');
}

function context(version = 'v1'): ToolExecutionContext {
  return {
    identityContext: {
      tenantId: brand<string, 'TenantId'>('tenant-extension-policy'),
      subjectId: brand<string, 'SubjectId'>('subject-extension-policy'),
      displayName: 'Extension policy tester',
    },
    agentId: brand<string, 'AgentId'>('default-agent'),
    agentVersion: brand<string, 'AgentVersion'>(version),
    sessionId: brand<string, 'SessionId'>('session-extension-policy'),
    requestId: brand<string, 'MessageId'>('request-extension-policy'),
    runId: brand<string, 'RequestRunId'>('run-extension-policy'),
    requestContextId: brand<string, 'RequestContextId'>('context-extension-policy'),
    stepId: 'turn-1',
    toolCallId: 'tool-extension-policy',
    timeoutMs: 30_000,
  };
}

function workspacePolicy() {
  return {
    schemaVersion: 'nextagent.agent-workspace-policy.v1' as const,
    isolationMode: 'subject' as const,
    roots: [
      { kind: 'workspace' as const, logicalPath: 'workspace' as const, access: 'readWrite' as const },
      { kind: 'systemResources' as const, logicalPath: '.nextagent' as const, access: 'read' as const },
      { kind: 'temp' as const, logicalPath: 'temp' as const, access: 'readWrite' as const },
    ],
    files: {
      writeDirectories: ['.'],
      maxTextBytes: 256_000,
    },
  };
}
