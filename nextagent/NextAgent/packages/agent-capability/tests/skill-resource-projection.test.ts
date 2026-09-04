import {
  createExecutionFilesystemCleanupJobs,
  createWorkspaceFilePort,
  type SkillResourceProjectionInput,
  type ToolExecutionContext,
} from '@nextagent/agent-capability';
import { brand } from '@nextagent/agent-common';
import type { AgentWorkspacePolicy } from '@nextagent/agent-contracts/agent-assembly';
import { createRestrictedLocalSandboxGateway } from '@nextagent/agent-platform-gateway-local';
import { createExecutionWorkspaceResolver } from '@nextagent/agent-runtime';
import { chmod, mkdir, mkdtemp, readFile, rename, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const tempDirectories: string[] = [];
const posixIt = process.platform === 'win32' ? it.skip : it;

afterEach(async () => {
  await Promise.all(tempDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe('Skill resource projection workspace boundary', () => {
  it('projects internal resources while applying the Agent extension policy to model readback', async () => {
    const runtimeWorkspaceRoot = await createTempDirectory();
    const port = createWorkspaceFilePort({
      runtimeWorkspaceRoot,
      executionWorkspaceResolver: createExecutionWorkspaceResolver(),
      deploymentMode: 'LOCAL',
      workspacePolicyProvider: {
        async require() {
          return defaultPolicy();
        },
      },
      workspaceFileExtensionPolicyProvider: {
        async require() {
          return { readAllowedExtensions: ['.md'] };
        },
      },
      readDirectories: [],
      writeDirectories: [],
    });
    const context = toolContext();

    const projection = await port.projectSkillResources(
      projectionInput([
        { relativePath: 'scripts/diagnose.py', content: "print('diagnose')", kind: 'script' },
        { relativePath: 'references/guide.md', content: 'diagnostic guide', kind: 'reference' },
      ]),
      context,
    );

    await expect(port.readText({ file_path: `${projection.rootRelativePath}references/guide.md` }, context)).resolves.toMatchObject({
      content: 'diagnostic guide',
    });
    await expect(port.readText({ file_path: `${projection.rootRelativePath}scripts/diagnose.py` }, context)).rejects.toMatchObject({
      code: 'CAPABILITY_PATH_REJECTED',
      category: 'AUTHORIZATION',
      retryable: false,
    });
  });

  it('exposes every committed Skill projection to later runs in the same execution scope', async () => {
    const runtimeWorkspaceRoot = await createTempDirectory();
    const port = createWorkspaceFilePort({
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
    const context = toolContext();
    const first = await port.projectSkillResources(
      projectionInput([{ relativePath: 'scripts/first.py', content: "print('first')", kind: 'script' }]),
      context,
    );
    const secondInput = {
      ...projectionInput([{ relativePath: 'scripts/second.py', content: "print('second')", kind: 'script' }]),
      providerId: 'other-skills',
      skillName: 'second-skill',
    };
    const second = await port.projectSkillResources(secondInput, context);

    const sameRun = await port.sandboxFilesystem(context);
    const skillRoots = sameRun.roots.filter((root) => root.kind === 'systemResources');
    expect(skillRoots.map((root) => root.logicalPath).sort()).toEqual(
      [first.rootRelativePath.slice(0, -1), second.rootRelativePath.slice(0, -1)].sort(),
    );

    const laterRun = await port.sandboxFilesystem({
      ...context,
      sessionId: brand<string, 'SessionId'>('session-other'),
      runId: brand<string, 'RequestRunId'>('run-other'),
    });
    expect(
      laterRun.roots
        .filter((root) => root.kind === 'systemResources')
        .map((root) => root.logicalPath)
        .sort(),
    ).toEqual([first.rootRelativePath.slice(0, -1), second.rootRelativePath.slice(0, -1)].sort());
  });

  it('recovers committed Skill projection authority across run cleanup and service restart', async () => {
    const runtimeWorkspaceRoot = await createTempDirectory();
    const createPort = () =>
      createWorkspaceFilePort({
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
    const port = createPort();
    const firstRun = toolContext();
    const secondRun = {
      ...firstRun,
      agentVersion: brand<string, 'AgentVersion'>('v2'),
      sessionId: brand<string, 'SessionId'>('session-projection-2'),
      requestId: brand<string, 'MessageId'>('request-projection-2'),
      runId: brand<string, 'RequestRunId'>('run-projection-2'),
      requestContextId: brand<string, 'RequestContextId'>('context-projection-2'),
    };
    const projection = await port.projectSkillResources(
      projectionInput([{ relativePath: 'scripts/rag_query.py', content: "print('rag-ok')\n", kind: 'script' }]),
      firstRun,
    );
    port.clearRun(firstRun);

    await expect(port.readText({ file_path: `${projection.rootRelativePath}scripts/rag_query.py` }, secondRun)).resolves.toMatchObject({
      content: "print('rag-ok')\n",
    });
    await expect(port.globFiles({ pattern: '**/*', path: '.nextagent/skills' }, secondRun)).resolves.toMatchObject({
      filenames: [`${projection.rootRelativePath}scripts/rag_query.py`],
    });
    await expect(port.grepFiles({ pattern: 'rag-ok', path: '.nextagent/skills' }, secondRun)).resolves.toMatchObject({
      filenames: [`${projection.rootRelativePath}scripts/rag_query.py`],
      total_matches: 1,
    });

    const sandboxFilesystem = await port.sandboxFilesystem(secondRun);
    expect(sandboxFilesystem.roots).toContainEqual(
      expect.objectContaining({
        kind: 'systemResources',
        logicalPath: projection.rootRelativePath.slice(0, -1),
        access: 'read',
      }),
    );
    const restartedPort = createPort();
    await expect(restartedPort.readText({ file_path: `${projection.rootRelativePath}scripts/rag_query.py` }, secondRun)).resolves.toMatchObject({
      content: "print('rag-ok')\n",
    });
    await expect(restartedPort.sandboxFilesystem(secondRun)).resolves.toMatchObject({
      roots: expect.arrayContaining([
        expect.objectContaining({
          kind: 'systemResources',
          logicalPath: projection.rootRelativePath.slice(0, -1),
          access: 'read',
        }),
      ]),
    });
    await expect(
      port.writeText({ file_path: `${projection.rootRelativePath}scripts/logs/diagnosis_context.log`, content: 'denied' }, secondRun),
    ).rejects.toMatchObject({ code: 'CAPABILITY_PATH_REJECTED', category: 'AUTHORIZATION' });
  });

  it('does not expose a projection across trusted execution scope boundaries', async () => {
    const runtimeWorkspaceRoot = await createTempDirectory();
    const port = createWorkspaceFilePort({
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
    const source = toolContext();
    const projection = await port.projectSkillResources(projectionInput([{ relativePath: 'references/guide.md', content: 'scope-private' }]), source);
    const otherScopes: ToolExecutionContext[] = [
      {
        ...source,
        identityContext: {
          ...source.identityContext,
          subjectId: brand<string, 'SubjectId'>('subject-other'),
        },
      },
      {
        ...source,
        identityContext: {
          ...source.identityContext,
          tenantId: brand<string, 'TenantId'>('tenant-other'),
        },
      },
      {
        ...source,
        agentId: brand<string, 'AgentId'>('agent-other'),
      },
    ];

    for (const otherScope of otherScopes) {
      await expect(port.readText({ file_path: `${projection.rootRelativePath}references/guide.md` }, otherScope)).rejects.toMatchObject({
        code: 'SKILL_RESOURCE_UNAVAILABLE',
        category: 'AUTHORIZATION',
        retryable: false,
      });
      await expect(port.sandboxFilesystem(otherScope)).resolves.toMatchObject({
        roots: expect.not.arrayContaining([expect.objectContaining({ kind: 'systemResources' })]),
      });
    }
  });

  it('keeps projections isolated across sessions in session isolation mode', async () => {
    const runtimeWorkspaceRoot = await createTempDirectory();
    const port = createWorkspaceFilePort({
      runtimeWorkspaceRoot,
      executionWorkspaceResolver: createExecutionWorkspaceResolver(),
      deploymentMode: 'LOCAL',
      workspacePolicyProvider: {
        async require() {
          return defaultPolicy('session');
        },
      },
      writeDirectories: ['.'],
    });
    const source = toolContext();
    const projection = await port.projectSkillResources(
      projectionInput([{ relativePath: 'references/guide.md', content: 'session-private' }]),
      source,
    );
    const otherSession = {
      ...source,
      sessionId: brand<string, 'SessionId'>('session-other'),
    };

    await expect(port.readText({ file_path: `${projection.rootRelativePath}references/guide.md` }, otherSession)).rejects.toMatchObject({
      code: 'SKILL_RESOURCE_UNAVAILABLE',
      category: 'AUTHORIZATION',
      retryable: false,
    });
    await expect(port.sandboxFilesystem(otherSession)).resolves.toMatchObject({
      roots: expect.not.arrayContaining([expect.objectContaining({ kind: 'systemResources' })]),
    });
  });

  it('invalidates cached scope authority when the committed marker disappears', async () => {
    const runtimeWorkspaceRoot = await createTempDirectory();
    const port = createWorkspaceFilePort({
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
    const context = toolContext();
    const projection = await port.projectSkillResources(projectionInput([{ relativePath: 'references/guide.md', content: 'committed' }]), context);
    const view = await port.resolveView(context);
    const systemRoot = view.roots.find((root) => root.kind === 'systemResources')!;
    await rm(resolve(systemRoot.physicalPath, 'skills', projection.skillProjectionKey, '.projection.json'));

    await expect(port.readText({ file_path: `${projection.rootRelativePath}references/guide.md` }, context)).rejects.toMatchObject({
      code: 'SKILL_RESOURCE_UNAVAILABLE',
      category: 'AUTHORIZATION',
      retryable: false,
    });
    await expect(port.sandboxFilesystem(context)).resolves.toMatchObject({
      roots: expect.not.arrayContaining([expect.objectContaining({ kind: 'systemResources' })]),
    });
  });

  it('projects Skill resources into an authorized read-only .nextagent subtree', async () => {
    const runtimeWorkspaceRoot = await createTempDirectory();
    const port = createWorkspaceFilePort({
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
    const context = toolContext();

    await expect(port.readText({ file_path: '.nextagent/skills/missing/rag-skill/scripts/rag_query.py' }, context)).rejects.toMatchObject({
      code: 'SKILL_RESOURCE_UNAVAILABLE',
      category: 'AUTHORIZATION',
      retryable: false,
    });
    await expect(port.globFiles({ pattern: '**/*', path: '.nextagent/skills' }, context)).resolves.toMatchObject({
      filenames: [],
      truncated: false,
    });
    await expect(port.grepFiles({ pattern: 'rag-ok', path: '.nextagent/skills' }, context)).resolves.toMatchObject({
      filenames: [],
      matches: [],
      total_files_with_matches: 0,
      total_matches: 0,
      truncated: false,
    });

    const projection = await port.projectSkillResources(
      projectionInput([
        { relativePath: 'scripts/rag_query.py', content: "print('rag-ok')\n", kind: 'script' },
        { relativePath: 'assets/.schemas/chatbi.yaml', content: 'openapi: 3.1.0\n', kind: 'asset' },
        { relativePath: 'references/root.md', content: 'root guide\n', kind: 'reference' },
        { relativePath: 'references/ne/guide.md', content: 'ne guide\n', kind: 'reference' },
        { relativePath: '.hidden/skip.py', content: "print('skip')\n", kind: 'script' },
        { relativePath: 'node_modules/pkg/skip.js', content: 'module.exports = 1;\n', kind: 'asset' },
        { relativePath: '.pnpm-store/pkg/skip.js', content: 'module.exports = 2;\n', kind: 'asset' },
        { relativePath: '.yarn/cache/pkg.zip', content: 'cache\n', kind: 'asset' },
      ]),
      context,
    );

    expect(projection.rootRelativePath).toMatch(/^\.nextagent\/skills\/[a-f0-9]{16}\/rag-skill\/$/u);
    expect(projection.projectedCount).toBe(5);
    if (process.platform !== 'win32') {
      const view = await port.resolveView(context);
      const systemRoot = view.roots.find((root) => root.kind === 'systemResources')!;
      const targetRoot = resolve(systemRoot.physicalPath, projection.rootRelativePath.slice('.nextagent/'.length));
      expect((await stat(resolve(targetRoot, 'scripts/rag_query.py'))).mode & 0o777).toBe(0o750);
      expect((await stat(resolve(targetRoot, 'references/root.md'))).mode & 0o777).toBe(0o640);
      expect((await stat(resolve(targetRoot, 'assets/.schemas/chatbi.yaml'))).mode & 0o777).toBe(0o640);
    }
    const expectedProjectedFiles = [
      `${projection.rootRelativePath}.hidden/skip.py`,
      `${projection.rootRelativePath}assets/.schemas/chatbi.yaml`,
      `${projection.rootRelativePath}references/ne/guide.md`,
      `${projection.rootRelativePath}references/root.md`,
      `${projection.rootRelativePath}scripts/rag_query.py`,
    ];
    const expectedReferenceFiles = [`${projection.rootRelativePath}references/ne/guide.md`, `${projection.rootRelativePath}references/root.md`];
    await expect(port.globFiles({ pattern: '**/*', path: projection.rootRelativePath.slice(0, -1) }, context)).resolves.toEqual({
      filenames: expectedProjectedFiles,
      truncated: false,
    });
    await expect(port.globFiles({ pattern: '**/*', path: '.nextagent/skills' }, context)).resolves.toEqual({
      filenames: expectedProjectedFiles,
      truncated: false,
    });
    await expect(port.globFiles({ pattern: '**/*', path: `.nextagent/skills/${projection.skillProjectionKey}` }, context)).resolves.toEqual({
      filenames: expectedProjectedFiles,
      truncated: false,
    });
    await expect(port.globFiles({ pattern: `${projection.rootRelativePath}scripts/*` }, context)).resolves.toEqual({
      filenames: [`${projection.rootRelativePath}scripts/rag_query.py`],
      truncated: false,
    });
    await expect(port.globFiles({ pattern: `${projection.rootRelativePath}scripts/` }, context)).resolves.toEqual({
      filenames: [`${projection.rootRelativePath}scripts/rag_query.py`],
      truncated: false,
    });
    await expect(port.globFiles({ pattern: `${projection.rootRelativePath}assets/**/*.yaml` }, context)).resolves.toEqual({
      filenames: [`${projection.rootRelativePath}assets/.schemas/chatbi.yaml`],
      truncated: false,
    });
    await expect(port.globFiles({ pattern: `${projection.rootRelativePath}references/**/*.md` }, context)).resolves.toEqual({
      filenames: expectedReferenceFiles,
      truncated: false,
    });
    await expect(port.globFiles({ pattern: `${projection.rootRelativePath}references/ne/*.md` }, context)).resolves.toEqual({
      filenames: [`${projection.rootRelativePath}references/ne/guide.md`],
      truncated: false,
    });
    await expect(port.globFiles({ pattern: '**/*', path: '.nextagent/skills/.locks' }, context)).rejects.toMatchObject({
      code: 'CAPABILITY_PATH_REJECTED',
      category: 'AUTHORIZATION',
    });
    const expectedGrep = {
      output_mode: 'files_with_matches',
      filenames: [`${projection.rootRelativePath}scripts/rag_query.py`],
      matches: [],
      total_files_with_matches: 1,
      total_matches: 1,
      truncated: false,
    };
    await expect(port.grepFiles({ pattern: 'rag-ok', path: projection.rootRelativePath.slice(0, -1) }, context)).resolves.toEqual(expectedGrep);
    await expect(port.grepFiles({ pattern: 'rag-ok', path: '.nextagent/skills' }, context)).resolves.toEqual(expectedGrep);
    await expect(port.grepFiles({ pattern: 'rag-ok', path: `.nextagent/skills/${projection.skillProjectionKey}` }, context)).resolves.toEqual(
      expectedGrep,
    );
    await expect(port.grepFiles({ pattern: 'rag-ok', path: '.nextagent/skills/.locks' }, context)).rejects.toMatchObject({
      code: 'CAPABILITY_PATH_REJECTED',
      category: 'AUTHORIZATION',
    });

    const read = await port.readText({ file_path: `${projection.rootRelativePath}scripts/rag_query.py` }, context);
    expect(read).toMatchObject({
      file_path: `${projection.rootRelativePath}scripts/rag_query.py`,
      content: "print('rag-ok')\n",
      truncated: false,
    });
    await expect(port.readText({ file_path: `${projection.rootRelativePath}assets/.schemas/chatbi.yaml` }, context)).resolves.toMatchObject({
      file_path: `${projection.rootRelativePath}assets/.schemas/chatbi.yaml`,
      content: 'openapi: 3.1.0\n',
      truncated: false,
    });
    await expect(port.readText({ file_path: `${projection.rootRelativePath}.hidden/skip.py` }, context)).resolves.toMatchObject({
      file_path: `${projection.rootRelativePath}.hidden/skip.py`,
      content: "print('skip')\n",
      truncated: false,
    });
    await expect(port.readText({ file_path: `${projection.rootRelativePath}node_modules/pkg/skip.js` }, context)).rejects.toMatchObject({
      code: 'FILE_UNAVAILABLE',
      category: 'NOT_FOUND',
      retryable: false,
    });
    await expect(port.readText({ file_path: `${projection.rootRelativePath}.pnpm-store/pkg/skip.js` }, context)).rejects.toMatchObject({
      code: 'FILE_UNAVAILABLE',
      category: 'NOT_FOUND',
      retryable: false,
    });
    await expect(port.readText({ file_path: `${projection.rootRelativePath}.yarn/cache/pkg.zip` }, context)).rejects.toMatchObject({
      code: 'FILE_UNAVAILABLE',
      category: 'NOT_FOUND',
      retryable: false,
    });
    await expect(port.writeText({ file_path: `${projection.rootRelativePath}scripts/out.py`, content: 'denied' }, context)).rejects.toMatchObject({
      code: 'CAPABILITY_PATH_REJECTED',
      category: 'AUTHORIZATION',
    });
    await expect(port.readText({ file_path: `.nextagent/skills/${projection.skillProjectionKey}/.projection.json` }, context)).rejects.toMatchObject({
      code: 'CAPABILITY_PATH_REJECTED',
      category: 'AUTHORIZATION',
    });

    const sandboxFilesystem = await port.sandboxFilesystem(context);
    expect(sandboxFilesystem.roots).toContainEqual(
      expect.objectContaining({
        kind: 'systemResources',
        logicalPath: projection.rootRelativePath.slice(0, -1),
        access: 'read',
      }),
    );
    expect(sandboxFilesystem.roots).not.toContainEqual(expect.objectContaining({ logicalPath: '.nextagent' }));
  });

  it('reads authorized Skill resources when the .nextagent system root is a directory link', async () => {
    const runtimeWorkspaceRoot = await createTempDirectory();
    const port = createWorkspaceFilePort({
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
    const context = toolContext();
    const projection = await port.projectSkillResources(
      projectionInput([{ relativePath: 'assets/api/chatbi.yaml', content: 'openapi: 3.1.0\n', kind: 'asset' }]),
      context,
    );
    const view = await port.resolveView(context);
    const systemRoot = view.roots.find((root) => root.kind === 'systemResources')!;
    const linkedSystemRoot = resolve(await createTempDirectory(), 'linked-nextagent');
    await rename(systemRoot.physicalPath, linkedSystemRoot);
    await symlink(linkedSystemRoot, systemRoot.physicalPath, symlinkType());

    const read = await port.readText({ file_path: `${projection.rootRelativePath}assets/api/chatbi.yaml` }, context);

    expect(read).toMatchObject({
      file_path: `${projection.rootRelativePath}assets/api/chatbi.yaml`,
      content: 'openapi: 3.1.0\n',
      truncated: false,
    });
    await expect(port.grepFiles({ pattern: 'openapi', path: '.nextagent/skills' }, context)).resolves.toMatchObject({
      filenames: [`${projection.rootRelativePath}assets/api/chatbi.yaml`],
      total_files_with_matches: 1,
      total_matches: 1,
      truncated: false,
    });
  });

  posixIt('executes projected Skill scripts through the local sandbox', async () => {
    const runtimeWorkspaceRoot = await createTempDirectory();
    const port = createWorkspaceFilePort({
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
    const context = toolContext();
    const projection = await port.projectSkillResources(
      projectionInput([
        { relativePath: 'scripts/rag_query.sh', content: '#!/usr/bin/env sh\necho rag-ok\n', kind: 'script' },
        { relativePath: 'references/guide.md', content: 'guide\n', kind: 'reference' },
        { relativePath: 'assets/schema.yaml', content: 'openapi: 3.1.0\n', kind: 'asset' },
      ]),
      context,
    );
    const sandboxFilesystem = await port.sandboxFilesystem(context);
    const gateway = createRestrictedLocalSandboxGateway({ workspaceDir: sandboxFilesystem.defaultCwd });

    const result = await gateway.execute({
      executionId: 'projected-script-test',
      requestRunId: context.runId,
      tenantId: context.identityContext.tenantId,
      subjectId: context.identityContext.subjectId,
      executable: 'bash',
      command: `${projection.rootRelativePath}scripts/rag_query.sh`,
      args: [],
      filesystem: sandboxFilesystem,
      environment: {},
      timeoutMs: 5000,
      stdoutLimitBytes: 1024,
      stderrLimitBytes: 1024,
    });

    expect(result.safeError).toBeUndefined();
    expect(result).toMatchObject({ exitCode: 0, stdout: 'rag-ok\n' });
  });

  it('resolves Skill-relative resources only when a committed projection uniquely matches', async () => {
    const runtimeWorkspaceRoot = await createTempDirectory();
    const port = createWorkspaceFilePort({
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
    const context = toolContext();
    const resolveSkillResourcePath = port.resolveSkillResourcePath;
    if (resolveSkillResourcePath === undefined) {
      throw new Error('The production workspace file port must provide Skill resource path resolution.');
    }
    const alpha = await port.projectSkillResources(
      {
        ...projectionInput([{ relativePath: 'scripts/run.py', content: 'print("alpha")\n', kind: 'script' }]),
        skillName: 'alpha',
        skillVersion: '1.0.0',
      },
      context,
    );

    await expect(resolveSkillResourcePath('scripts/run.py', context)).resolves.toEqual({
      status: 'resolved',
      logicalPath: `${alpha.rootRelativePath}scripts/run.py`,
    });
    await expect(resolveSkillResourcePath('alpha/scripts/run.py', context)).resolves.toEqual({
      status: 'resolved',
      logicalPath: `${alpha.rootRelativePath}scripts/run.py`,
    });
    await expect(resolveSkillResourcePath('missing/scripts/run.py', context)).resolves.toEqual({ status: 'not-found' });

    const beta = await port.projectSkillResources(
      {
        ...projectionInput([{ relativePath: 'scripts/run.py', content: 'print("beta")\n', kind: 'script' }]),
        skillName: 'beta',
        skillVersion: '1.0.0',
      },
      context,
    );

    await expect(resolveSkillResourcePath('scripts/run.py', context)).resolves.toEqual({
      status: 'ambiguous',
      candidates: [`${alpha.rootRelativePath}scripts/run.py`, `${beta.rootRelativePath}scripts/run.py`].sort(),
    });
    await expect(resolveSkillResourcePath('alpha/scripts/run.py', context)).resolves.toEqual({
      status: 'resolved',
      logicalPath: `${alpha.rootRelativePath}scripts/run.py`,
    });
  });

  it('disambiguates bare script paths using the active Skill context', async () => {
    const runtimeWorkspaceRoot = await createTempDirectory();
    const port = createWorkspaceFilePort({
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
    const context: ToolExecutionContext = {
      ...toolContext(),
      flowVariables: { activeSkillContext: { skillName: 'alpha', skillVersion: '1.0.0', providerId: 'test' } },
    };
    const resolveSkillResourcePath = port.resolveSkillResourcePath;
    if (resolveSkillResourcePath === undefined) {
      throw new Error('The production workspace file port must provide Skill resource path resolution.');
    }
    const alpha = await port.projectSkillResources(
      {
        ...projectionInput([{ relativePath: 'scripts/run.py', content: 'print("alpha")\n', kind: 'script' }]),
        skillName: 'alpha',
        skillVersion: '1.0.0',
      },
      context,
    );
    const beta = await port.projectSkillResources(
      {
        ...projectionInput([{ relativePath: 'scripts/run.py', content: 'print("beta")\n', kind: 'script' }]),
        skillName: 'beta',
        skillVersion: '1.0.0',
      },
      context,
    );

    // Bare path resolves to the active Skill (alpha) instead of ambiguous
    await expect(resolveSkillResourcePath('scripts/run.py', context)).resolves.toEqual({
      status: 'resolved',
      logicalPath: `${alpha.rootRelativePath}scripts/run.py`,
    });
    // Explicit skill name still works
    await expect(resolveSkillResourcePath('beta/scripts/run.py', context)).resolves.toEqual({
      status: 'resolved',
      logicalPath: `${beta.rootRelativePath}scripts/run.py`,
    });
  });

  it('falls back to ambiguous when no active Skill context is set', async () => {
    const runtimeWorkspaceRoot = await createTempDirectory();
    const port = createWorkspaceFilePort({
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
    const context = toolContext();
    const resolveSkillResourcePath = port.resolveSkillResourcePath;
    if (resolveSkillResourcePath === undefined) {
      throw new Error('The production workspace file port must provide Skill resource path resolution.');
    }
    await port.projectSkillResources(
      {
        ...projectionInput([{ relativePath: 'scripts/run.py', content: 'print("alpha")\n', kind: 'script' }]),
        skillName: 'alpha',
        skillVersion: '1.0.0',
      },
      context,
    );
    await port.projectSkillResources(
      {
        ...projectionInput([{ relativePath: 'scripts/run.py', content: 'print("beta")\n', kind: 'script' }]),
        skillName: 'beta',
        skillVersion: '1.0.0',
      },
      context,
    );

    // No activeSkillContext -> behaves as before (ambiguous)
    await expect(resolveSkillResourcePath('scripts/run.py', context)).resolves.toEqual({
      status: 'ambiguous',
      candidates: expect.any(Array),
    });
  });

  it('excludes cross-scope and linked Skill script candidates from relative resolution', async () => {
    const runtimeWorkspaceRoot = await createTempDirectory();
    const port = createWorkspaceFilePort({
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
    const ownerContext = toolContext('owner-subject');
    const otherContext = toolContext('other-subject');
    const resolveSkillResourcePath = port.resolveSkillResourcePath;
    if (resolveSkillResourcePath === undefined) {
      throw new Error('The production workspace file port must provide Skill resource path resolution.');
    }
    const projection = await port.projectSkillResources(
      projectionInput([{ relativePath: 'scripts/run.py', content: 'print("safe")\n', kind: 'script' }]),
      ownerContext,
    );

    await expect(resolveSkillResourcePath('scripts/run.py', otherContext)).resolves.toEqual({ status: 'not-found' });

    if (process.platform === 'win32') {
      return;
    }

    const ownerView = await port.resolveView(ownerContext);
    const systemRoot = ownerView.roots.find((root) => root.kind === 'systemResources')!;
    const scriptPath = resolve(systemRoot.physicalPath, projection.rootRelativePath.slice('.nextagent/'.length), 'scripts/run.py');
    const outsidePath = resolve(runtimeWorkspaceRoot, 'outside.py');
    await writeFile(outsidePath, 'print("outside")\n');
    await rm(scriptPath);
    await symlink(outsidePath, scriptPath, 'file');

    const resolution = await resolveSkillResourcePath('scripts/run.py', ownerContext);
    expect(resolution).toEqual({ status: 'not-found' });
    expect(JSON.stringify(resolution)).not.toContain(runtimeWorkspaceRoot);
  });

  posixIt('shares the execution view root between Bash and governed file tools', async () => {
    const runtimeWorkspaceRoot = await createTempDirectory();
    const port = createWorkspaceFilePort({
      runtimeWorkspaceRoot,
      executionWorkspaceResolver: createExecutionWorkspaceResolver(),
      deploymentMode: 'LOCAL',
      workspacePolicyProvider: {
        async require() {
          return {
            ...defaultPolicy(),
            files: { writeDirectories: ['.'], maxTextBytes: 256_000 },
          };
        },
      },
    });
    const context = toolContext();
    const sandboxFilesystem = await port.sandboxFilesystem(context);
    const gateway = createRestrictedLocalSandboxGateway({ workspaceDir: sandboxFilesystem.defaultCwd });

    const bashWrite = await gateway.execute({
      executionId: 'bash-file-root-write',
      requestRunId: context.runId,
      tenantId: context.identityContext.tenantId,
      subjectId: context.identityContext.subjectId,
      executable: 'bash',
      command: 'sh',
      args: ['-c', "printf 'from-bash' > root.txt"],
      filesystem: sandboxFilesystem,
      environment: {},
      timeoutMs: 5000,
      stdoutLimitBytes: 1024,
      stderrLimitBytes: 1024,
    });

    expect(bashWrite.safeError).toBeUndefined();
    await expect(port.readText({ file_path: 'root.txt' }, context)).resolves.toMatchObject({
      file_path: 'root.txt',
      content: 'from-bash',
    });
    await expect(port.globFiles({ pattern: 'root.txt' }, context)).resolves.toMatchObject({
      filenames: ['root.txt'],
    });
    await expect(port.grepFiles({ pattern: 'from-bash' }, context)).resolves.toMatchObject({
      filenames: ['root.txt'],
    });

    await port.writeText({ file_path: 'from-write.txt', content: 'from-write' }, context);
    const bashRead = await gateway.execute({
      executionId: 'bash-file-root-read',
      requestRunId: context.runId,
      tenantId: context.identityContext.tenantId,
      subjectId: context.identityContext.subjectId,
      executable: 'bash',
      command: 'cat',
      args: ['from-write.txt'],
      filesystem: sandboxFilesystem,
      environment: {},
      timeoutMs: 5000,
      stdoutLimitBytes: 1024,
      stderrLimitBytes: 1024,
    });

    expect(bashRead).toMatchObject({ exitCode: 0, stdout: 'from-write' });
  });

  posixIt('repairs executable mode when reusing a committed Skill script projection', async () => {
    const runtimeWorkspaceRoot = await createTempDirectory();
    const port = createWorkspaceFilePort({
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
    const context = toolContext();
    const input = projectionInput([
      { relativePath: 'scripts/rag_query.sh', content: '#!/usr/bin/env sh\necho rag-ok\n', kind: 'script' },
      { relativePath: 'references/guide.md', content: 'guide\n', kind: 'reference' },
    ]);
    const projection = await port.projectSkillResources(input, context);
    const view = await port.resolveView(context);
    const systemRoot = view.roots.find((root) => root.kind === 'systemResources')!;
    const targetRoot = resolve(systemRoot.physicalPath, projection.rootRelativePath.slice('.nextagent/'.length));
    const scriptPath = resolve(targetRoot, 'scripts/rag_query.sh');

    await chmod(scriptPath, 0o640);
    await port.projectSkillResources(input, context);

    expect((await stat(scriptPath)).mode & 0o777).toBe(0o750);
  });

  it('reuses committed immutable projection targets without refreshing source changes', async () => {
    const runtimeWorkspaceRoot = await createTempDirectory();
    const port = createWorkspaceFilePort({
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
    const context = toolContext();
    const first = await port.projectSkillResources(
      projectionInput([
        { relativePath: 'references/old.md', content: 'old' },
        { relativePath: 'references/current.md', content: 'v1' },
      ]),
      context,
    );
    const view = await port.resolveView(context);
    const systemRoot = view.roots.find((root) => root.kind === 'systemResources')!;
    const targetRoot = resolve(systemRoot.physicalPath, first.rootRelativePath.slice('.nextagent/'.length));
    const firstManifest = await readFile(resolve(systemRoot.physicalPath, 'skills', first.skillProjectionKey, '.projection.json'), 'utf8');

    const reusedStats = { listCalls: 0, readCalls: 0 };
    const reused = await port.projectSkillResources(
      projectionInput(
        [
          { relativePath: 'references/current.md', content: 'v1' },
          { relativePath: 'references/old.md', content: 'old' },
        ],
        reusedStats,
      ),
      context,
    );
    const reusedManifest = await readFile(resolve(systemRoot.physicalPath, 'skills', first.skillProjectionKey, '.projection.json'), 'utf8');

    expect(reused.rootRelativePath).toBe(first.rootRelativePath);
    expect(reused.projectedCount).toBe(first.projectedCount);
    expect(reusedStats).toEqual({ listCalls: 0, readCalls: 0 });
    expect(reusedManifest).toBe(firstManifest);

    const changedStats = { listCalls: 0, readCalls: 0 };
    const refreshed = await port.projectSkillResources(
      projectionInput([{ relativePath: 'references/current.md', content: 'v2' }], changedStats),
      context,
    );

    expect(refreshed.rootRelativePath).toBe(first.rootRelativePath);
    expect(changedStats).toEqual({ listCalls: 0, readCalls: 0 });
    await expect(readFile(resolve(targetRoot, 'references', 'old.md'), 'utf8')).resolves.toBe('old');
    await expect(readFile(resolve(targetRoot, 'references', 'current.md'), 'utf8')).resolves.toBe('v1');
    await expect(port.readText({ file_path: '.nextagent/skills/.staging/operation/foo/references/current.md' }, context)).rejects.toMatchObject({
      code: 'CAPABILITY_PATH_REJECTED',
      category: 'AUTHORIZATION',
    });
    await expect(port.readText({ file_path: '.nextagent/skills/.locks/key' }, context)).rejects.toMatchObject({
      code: 'CAPABILITY_PATH_REJECTED',
      category: 'AUTHORIZATION',
    });
  });

  it('refreshes an edited Skill projection on first activation after service restart', async () => {
    const runtimeWorkspaceRoot = await createTempDirectory();
    const createPort = () =>
      createWorkspaceFilePort({
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
    const context = toolContext();
    const first = await createPort().projectSkillResources(
      projectionInput([
        { relativePath: 'SKILL.md', content: 'Run scripts/query.py\n' },
        { relativePath: 'scripts/query.py', content: "print('old')\n", kind: 'script' },
      ]),
      context,
    );

    const restartedPort = createPort();
    const refreshedStats = { listCalls: 0, readCalls: 0 };
    const refreshed = await restartedPort.projectSkillResources(
      projectionInput(
        [
          { relativePath: 'SKILL.md', content: 'Run scripts/query1.py\n' },
          { relativePath: 'scripts/query1.py', content: "print('new')\n", kind: 'script' },
        ],
        refreshedStats,
      ),
      context,
    );
    const view = await restartedPort.resolveView(context);
    const systemRoot = view.roots.find((root) => root.kind === 'systemResources')!;
    const targetRoot = resolve(systemRoot.physicalPath, refreshed.rootRelativePath.slice('.nextagent/'.length));

    expect(refreshed).toEqual(first);
    expect(refreshedStats).toEqual({ listCalls: 1, readCalls: 2 });
    await expect(readFile(resolve(targetRoot, 'scripts', 'query1.py'), 'utf8')).resolves.toBe("print('new')\n");
    await expect(readFile(resolve(targetRoot, 'scripts', 'query.py'), 'utf8')).rejects.toBeDefined();

    const reusedStats = { listCalls: 0, readCalls: 0 };
    await expect(
      restartedPort.projectSkillResources(
        projectionInput(
          [
            { relativePath: 'SKILL.md', content: 'Run scripts/query1.py\n' },
            { relativePath: 'scripts/query1.py', content: "print('new')\n", kind: 'script' },
          ],
          reusedStats,
        ),
        context,
      ),
    ).resolves.toEqual(refreshed);
    expect(reusedStats).toEqual({ listCalls: 0, readCalls: 0 });
  });

  it('shares one first projection publication across concurrent activations', async () => {
    const runtimeWorkspaceRoot = await createTempDirectory();
    const port = createWorkspaceFilePort({
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
    const stats = { listCalls: 0, readCalls: 0 };
    const input = projectionInput([{ relativePath: 'scripts/query.py', content: "print('ok')\n", kind: 'script' }], stats);

    const [first, second] = await Promise.all([port.projectSkillResources(input, toolContext()), port.projectSkillResources(input, toolContext())]);

    expect(first).toEqual(second);
    expect(stats).toEqual({ listCalls: 1, readCalls: 1 });
  });

  it('reuses a concurrently committed projection across independent workspace ports', async () => {
    const runtimeWorkspaceRoot = await createTempDirectory();
    const createPort = () =>
      createWorkspaceFilePort({
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
    const stats = { listCalls: 0, readCalls: 0 };
    const bytes = new TextEncoder().encode("print('ok')\n");
    let releaseFirstRead!: () => void;
    let markFirstReadStarted!: () => void;
    const firstReadStarted = new Promise<void>((resolveStarted) => {
      markFirstReadStarted = resolveStarted;
    });
    const firstReadCanFinish = new Promise<void>((resolveRelease) => {
      releaseFirstRead = resolveRelease;
    });
    const input: SkillResourceProjectionInput = {
      providerId: 'builtin-skills',
      skillName: 'rag-skill',
      skillVersion: '0.1.0',
      async listResources() {
        stats.listCalls += 1;
        return [{ relativePath: 'scripts/query.py', kind: 'script' as const, sizeBytes: bytes.byteLength }];
      },
      async readResource(resource) {
        stats.readCalls += 1;
        markFirstReadStarted();
        await firstReadCanFinish;
        return { ...resource, contentStream: streamBytes(bytes) };
      },
    };

    const first = createPort().projectSkillResources(input, toolContext());
    await firstReadStarted;
    const second = createPort().projectSkillResources(input, toolContext());
    await new Promise((resolveWait) => setTimeout(resolveWait, 50));
    releaseFirstRead();

    await expect(Promise.all([first, second])).resolves.toEqual([
      { skillProjectionKey: expect.any(String), rootRelativePath: expect.any(String), projectedCount: 1 },
      { skillProjectionKey: expect.any(String), rootRelativePath: expect.any(String), projectedCount: 1 },
    ]);
    expect(stats).toEqual({ listCalls: 1, readCalls: 1 });
  });

  it('refreshes each execution scope after service restart', async () => {
    const runtimeWorkspaceRoot = await createTempDirectory();
    const createPort = () =>
      createWorkspaceFilePort({
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
    const firstScope = toolContext();
    const secondScope = toolContext('subject-projection-second');
    const priorPort = createPort();
    const oldSkill = () => projectionInput([{ relativePath: 'scripts/query.py', content: "print('old')\n", kind: 'script' }]);
    await priorPort.projectSkillResources(oldSkill(), firstScope);
    await priorPort.projectSkillResources(oldSkill(), secondScope);

    const restartedPort = createPort();
    const newSkill = () => projectionInput([{ relativePath: 'scripts/query1.py', content: "print('new')\n", kind: 'script' }]);
    const first = await restartedPort.projectSkillResources(newSkill(), firstScope);
    const second = await restartedPort.projectSkillResources(newSkill(), secondScope);
    const firstView = await restartedPort.resolveView(firstScope);
    const secondView = await restartedPort.resolveView(secondScope);
    const firstSystemRoot = firstView.roots.find((root) => root.kind === 'systemResources')!;
    const secondSystemRoot = secondView.roots.find((root) => root.kind === 'systemResources')!;

    await expect(
      readFile(resolve(firstSystemRoot.physicalPath, 'skills', first.skillProjectionKey, 'rag-skill', 'scripts', 'query1.py'), 'utf8'),
    ).resolves.toBe("print('new')\n");
    await expect(
      readFile(resolve(secondSystemRoot.physicalPath, 'skills', second.skillProjectionKey, 'rag-skill', 'scripts', 'query1.py'), 'utf8'),
    ).resolves.toBe("print('new')\n");
  });

  it('rebuilds an uncommitted leftover target through staging before authorization', async () => {
    const runtimeWorkspaceRoot = await createTempDirectory();
    const port = createWorkspaceFilePort({
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
    const context = toolContext();
    const preview = await port.projectSkillResources(projectionInput([{ relativePath: 'references/old.md', content: 'old' }]), context);
    const view = await port.resolveView(context);
    const systemRoot = view.roots.find((root) => root.kind === 'systemResources')!;
    await rm(resolve(systemRoot.physicalPath, 'skills', preview.skillProjectionKey, '.projection.json'), { force: true });

    const rebuilt = await port.projectSkillResources(projectionInput([{ relativePath: 'references/current.md', content: 'v2' }]), context);
    const targetRoot = resolve(systemRoot.physicalPath, rebuilt.rootRelativePath.slice('.nextagent/'.length));

    await expect(readFile(resolve(targetRoot, 'references', 'old.md'), 'utf8')).rejects.toBeDefined();
    await expect(readFile(resolve(targetRoot, 'references', 'current.md'), 'utf8')).resolves.toBe('v2');
  });

  it('safe-fails when streamed resource content no longer matches listed metadata', async () => {
    const runtimeWorkspaceRoot = await createTempDirectory();
    const port = createWorkspaceFilePort({
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
    const context = toolContext();

    await expect(
      port.projectSkillResources(
        {
          providerId: 'builtin-skills',
          skillName: 'rag-skill',
          skillVersion: '0.1.1',
          async listResources() {
            return [{ relativePath: 'references/guide.md', kind: 'reference', sizeBytes: 4 }];
          },
          async readResource(resource) {
            return { ...resource, contentStream: streamBytes(new TextEncoder().encode('longer-than-listed')) };
          },
        },
        context,
      ),
    ).rejects.toMatchObject({
      code: 'CAPABILITY_PATH_REJECTED',
      category: 'CONFLICT',
    });
  });

  it('maps provider stream failures to safe projection failures', async () => {
    const runtimeWorkspaceRoot = await createTempDirectory();
    const port = createWorkspaceFilePort({
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
    const context = toolContext();

    await expect(
      port.projectSkillResources(
        {
          providerId: 'builtin-skills',
          skillName: 'rag-skill',
          skillVersion: '0.1.2',
          async listResources() {
            return [{ relativePath: 'references/guide.md', kind: 'reference', sizeBytes: 4 }];
          },
          async readResource(resource) {
            return { ...resource, contentStream: failingStream() };
          },
        },
        context,
      ),
    ).rejects.toMatchObject({
      code: 'CAPABILITY_PATH_REJECTED',
      category: 'CONFLICT',
    });

    const retryStats = { listCalls: 0, readCalls: 0 };
    await expect(
      port.projectSkillResources(
        {
          providerId: 'builtin-skills',
          skillName: 'rag-skill',
          skillVersion: '0.1.2',
          async listResources() {
            retryStats.listCalls += 1;
            return [{ relativePath: 'references/guide.md', kind: 'reference' as const, sizeBytes: 4 }];
          },
          async readResource(resource) {
            retryStats.readCalls += 1;
            return { ...resource, contentStream: streamBytes(new TextEncoder().encode('good')) };
          },
        },
        context,
      ),
    ).resolves.toMatchObject({ projectedCount: 1 });
    expect(retryStats).toEqual({ listCalls: 1, readCalls: 1 });
  });

  it('exposes capability-owned cleanup jobs for stale projection internals and local temp', async () => {
    const runtimeWorkspaceRoot = await createTempDirectory();
    const scopeRoot = resolve(runtimeWorkspaceRoot, 'scope-cleanup');
    const staleProjection = resolve(scopeRoot, '.nextagent', 'skills', 'projection-key');
    const staleStaging = resolve(scopeRoot, '.nextagent', 'skills', '.staging', 'operation-key');
    const staleLock = resolve(scopeRoot, '.nextagent', 'skills', '.locks', 'projection-key');
    const staleTemp = resolve(scopeRoot, 'temp', 'run-key');
    await mkdir(staleProjection, { recursive: true });
    await mkdir(staleStaging, { recursive: true });
    await mkdir(staleLock, { recursive: true });
    await mkdir(staleTemp, { recursive: true });
    await writeFile(resolve(staleProjection, '.projection.json'), '{}');

    const [projectionCleanup, tempCleanup] = createExecutionFilesystemCleanupJobs({
      runtimeWorkspaceRoot,
      projectionRetentionMs: 0,
      tempRetentionMs: 0,
      cadenceMs: 1000,
    });
    const now = new Date(Date.now() + 1000);

    await expect(projectionCleanup!.run(new AbortController().signal, now)).resolves.toMatchObject({ status: 'COMPLETED' });
    await expect(tempCleanup!.run(new AbortController().signal, now)).resolves.toMatchObject({ status: 'COMPLETED' });

    await expect(stat(staleProjection)).rejects.toBeDefined();
    await expect(stat(staleStaging)).rejects.toBeDefined();
    await expect(stat(staleLock)).rejects.toBeDefined();
    await expect(stat(staleTemp)).rejects.toBeDefined();
  });
});

async function createTempDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'nextagent-skill-projection-'));
  tempDirectories.push(directory);
  return directory;
}

function toolContext(subject = 'subject-projection'): ToolExecutionContext {
  return {
    identityContext: {
      tenantId: brand<string, 'TenantId'>('tenant-projection'),
      subjectId: brand<string, 'SubjectId'>(subject),
      displayName: 'Projection tester',
    },
    agentId: brand<string, 'AgentId'>('agent-projection'),
    agentVersion: brand<string, 'AgentVersion'>('v1'),
    sessionId: brand<string, 'SessionId'>('session-projection'),
    requestId: brand<string, 'MessageId'>('request-projection'),
    runId: brand<string, 'RequestRunId'>('run-projection'),
    requestContextId: brand<string, 'RequestContextId'>('context-projection'),
    stepId: 'turn-1',
    toolCallId: 'tool-projection',
    timeoutMs: 30_000,
  };
}

function projectionInput(
  resources: ReadonlyArray<{ readonly relativePath: string; readonly content: string; readonly kind?: 'script' | 'reference' | 'asset' }>,
  stats?: { listCalls: number; readCalls: number },
) {
  const entries = resources.map((resource) => {
    const bytes = new TextEncoder().encode(resource.content);
    return {
      relativePath: resource.relativePath,
      kind: resource.kind ?? 'reference',
      contentStream: streamBytes(bytes),
      sizeBytes: bytes.byteLength,
    };
  });
  return {
    providerId: 'builtin-skills',
    skillName: 'rag-skill',
    skillVersion: '0.1.0',
    async listResources() {
      if (stats !== undefined) {
        stats.listCalls += 1;
      }
      return entries.map(({ contentStream: _contentStream, ...metadata }) => metadata);
    },
    async readResource(resource: { readonly relativePath: string }) {
      if (stats !== undefined) {
        stats.readCalls += 1;
      }
      return entries.find((entry) => entry.relativePath === resource.relativePath);
    },
  };
}

async function* streamBytes(bytes: Uint8Array): AsyncIterable<Uint8Array> {
  yield bytes;
}

async function* failingStream(): AsyncIterable<Uint8Array> {
  throw new Error('raw provider path must not escape');
}

function defaultPolicy(isolationMode: AgentWorkspacePolicy['isolationMode'] = 'subject'): AgentWorkspacePolicy {
  return {
    schemaVersion: 'nextagent.agent-workspace-policy.v1',
    isolationMode,
    roots: [
      { kind: 'workspace', logicalPath: 'workspace', access: 'readWrite' },
      { kind: 'systemResources', logicalPath: '.nextagent', access: 'read' },
      { kind: 'temp', logicalPath: 'temp', access: 'readWrite' },
    ],
  };
}

function symlinkType(): 'dir' | 'junction' {
  return process.platform === 'win32' ? 'junction' : 'dir';
}
