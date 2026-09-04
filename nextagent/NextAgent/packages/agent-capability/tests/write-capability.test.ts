import {
  createCapabilitySubsystem,
  createWorkspaceFilePort,
  readCapabilityId,
  writeCapabilityId,
  type ToolExecutionContext,
} from '@nextagent/agent-capability';
import { brand, type JsonObject } from '@nextagent/agent-common';
import type { AgentAssembly } from '@nextagent/agent-contracts/agent-assembly';
import type { CapabilityInvocationRequest } from '@nextagent/agent-contracts/capability';
import { chmod, link, mkdtemp, mkdir, readFile, readdir, rm, stat, symlink, unlink, utimes, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const tempDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe('write capability', () => {
  it('is registered as NON_IDEMPOTENT PascalCase and available without approval', async () => {
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

    expect(descriptors).toContainEqual(
      expect.objectContaining({
        capabilityId: 'Write',
        replayPolicy: 'NON_IDEMPOTENT',
        availabilityStatus: 'AVAILABLE',
      }),
    );
    const descriptor = descriptors.find((item) => item.capabilityId === writeCapabilityId);
    expect(descriptor?.description).toContain('relative paths resolve under `workspace/`');
    expect(descriptor?.description).toContain('use `workspace/...` for durable files');
    expect(descriptor?.description).toContain('`temp/...` for current-run files');
    expect(descriptor?.inputSchema).toMatchObject({
      properties: { file_path: { description: expect.stringContaining('bare relative path aliases workspace/...') } },
    });
    expect(descriptors.some((descriptor) => descriptor.capabilityId === 'write')).toBe(false);
    await expect(
      subsystem.invocationPort.invoke(request({ file_path: 'out.txt', content: 'value' }), new AbortController().signal),
    ).resolves.toMatchObject({
      status: 'SUCCEEDED',
      structuredPayload: { type: 'create', file_path: 'workspace/out.txt' },
    });
    expect(await readFile(join(workspaceDir, 'out.txt'), 'utf8')).toBe('value');
  });

  it('creates nested UTF-8 files only inside configured write directories', async () => {
    const workspaceDir = await createWorkspace();
    const subsystem = executableSubsystem(workspaceDir, { writeDirectories: ['generated'] });

    const created = await subsystem.invocationPort.invoke(
      request({ file_path: 'generated/nested/result.txt', content: 'line 1\r\nline 2' }),
      new AbortController().signal,
    );

    expect(created).toMatchObject({
      status: 'SUCCEEDED',
      structuredPayload: { type: 'create', file_path: 'workspace/generated/nested/result.txt' },
    });
    expect(await readFile(join(workspaceDir, 'generated', 'nested', 'result.txt'), 'utf8')).toBe('line 1\r\nline 2');
    const denied = await subsystem.invocationPort.invoke(request({ file_path: 'other/result.txt', content: 'denied' }), new AbortController().signal);
    expect(denied).toMatchObject({ status: 'FAILED', safeError: { code: 'CAPABILITY_PATH_REJECTED', category: 'AUTHORIZATION' } });
    await expect(
      subsystem.invocationPort.invoke(request({ file_path: 'generated-other/result.txt', content: 'denied-prefix' }), new AbortController().signal),
    ).resolves.toMatchObject({
      status: 'FAILED',
      safeError: { code: 'CAPABILITY_PATH_REJECTED', category: 'AUTHORIZATION' },
    });
  });

  it('returns direct-call activation hints for generated-skills manifests without rewriting the skill name', async () => {
    const workspaceDir = await createWorkspace();
    const subsystem = executableSubsystem(workspaceDir, { writeDirectories: ['generated-skills'] });
    await rm(join(workspaceDir, 'generated-skills', 'space-view'), { recursive: true, force: true });

    const result = await subsystem.invocationPort.invoke(
      request({
        file_path: 'generated-skills/space-view/SKILL.md',
        content: ['---', 'name: space-view', 'description: View workspace files.', '---', '', '# Space View'].join('\n'),
      }),
      new AbortController().signal,
    );

    expect(result).toMatchObject({
      status: 'SUCCEEDED',
      structuredPayload: {
        type: 'create',
        file_path: 'generated-skills/space-view/SKILL.md',
        generated_skill: {
          capability_id: 'space-view',
          ready: true,
          next_skill_call: 'Skill(name="space-view")',
        },
      },
    });
    expect(await readFile(join(workspaceDir, 'generated-skills', 'space-view', 'SKILL.md'), 'utf8')).toContain('name: space-view');
  });

  it('enforces the exact input schema before filesystem access', async () => {
    const workspaceDir = await createWorkspace();
    const subsystem = executableSubsystem(workspaceDir, { writeDirectories: ['.'] });
    const invalidInputs: JsonObject[] = [
      {},
      { file_path: 'missing-content.txt' },
      { content: 'missing path' },
      { file_path: '', content: 'value' },
      { file_path: 'empty-content.txt', content: '' },
      { file_path: 7, content: 'value' },
      { file_path: 'wrong-content.txt', content: 7 },
      { file_path: 'extra.txt', content: 'value', extra: true },
    ];

    for (const input of invalidInputs) {
      await expect(subsystem.invocationPort.invoke(request(input), new AbortController().signal)).resolves.toMatchObject({
        status: 'FAILED',
        safeError: { code: 'CAPABILITY_INPUT_INVALID', category: 'VALIDATION' },
      });
    }
    const emptyContent = await subsystem.invocationPort.invoke(
      request({ file_path: 'empty-content.txt', content: '' }),
      new AbortController().signal,
    );
    expect(emptyContent.safeError?.message).toContain('Input validation failed for 1 constraint.');
    expect(emptyContent.safeError?.safeDetails).toMatchObject({
      violations: [{ path: '/content', constraint: 'minLength', expected: 'a string of at least 1 characters' }],
    });
    expect(await readdir(workspaceDir)).toEqual([]);
  });

  it('accepts whitespace-only non-empty content and returns only the bounded business result', async () => {
    const workspaceDir = await createWorkspace();
    const subsystem = executableSubsystem(workspaceDir, { writeDirectories: ['.'] });

    const result = await subsystem.invocationPort.invoke(
      request({ file_path: './nested/space.txt', content: ' \t\r\n' }),
      new AbortController().signal,
    );

    expect(result.status).toBe('SUCCEEDED');
    expect(result.structuredPayload).toEqual({ type: 'create', file_path: 'workspace/nested/space.txt' });
    expect(Object.keys(result.structuredPayload)).toEqual(['type', 'file_path']);
    expect(await readFile(join(workspaceDir, 'nested', 'space.txt'), 'utf8')).toBe(' \t\r\n');
  });

  it('normalizes dot segments and platform-independent separators in results and storage', async () => {
    const workspaceDir = await createWorkspace();
    const subsystem = executableSubsystem(workspaceDir, { writeDirectories: ['generated'] });

    const result = await subsystem.invocationPort.invoke(
      request({ file_path: 'generated\\nested/./result.txt', content: 'value' }),
      new AbortController().signal,
    );

    expect(result).toMatchObject({
      status: 'SUCCEEDED',
      structuredPayload: { type: 'create', file_path: 'workspace/generated/nested/result.txt' },
    });
    expect(await readFile(join(workspaceDir, 'generated', 'nested', 'result.txt'), 'utf8')).toBe('value');
  });

  it('allows ordinary names that begin with two dots without treating them as traversal', async () => {
    const workspaceDir = await createWorkspace();
    const subsystem = executableSubsystem(workspaceDir, { writeDirectories: ['..diagnostics'] });

    await expect(
      subsystem.invocationPort.invoke(request({ file_path: '..diagnostics/..result.txt', content: 'value' }), new AbortController().signal),
    ).resolves.toMatchObject({
      status: 'SUCCEEDED',
      structuredPayload: { file_path: 'workspace/..diagnostics/..result.txt' },
    });
    expect(await readFile(join(workspaceDir, '..diagnostics', '..result.txt'), 'utf8')).toBe('value');
  });

  it('denies all writes when writeDirectories is omitted or empty', async () => {
    for (const read of [{}, { writeDirectories: [] as string[] }]) {
      const workspaceDir = await createWorkspace();
      const subsystem = createCapabilitySubsystem({
        read: { workspaceDir, ...read },
      });

      const result = await subsystem.invocationPort.invoke(request({ file_path: 'denied.txt', content: 'value' }), new AbortController().signal);
      expect(result).toMatchObject({
        status: 'FAILED',
        safeError: { code: 'CAPABILITY_PATH_REJECTED', category: 'AUTHORIZATION' },
      });
      expect(await readdir(workspaceDir)).toEqual([]);
    }
  });

  it('enforces encoded byte limits at the exact UTF-8 and UTF-16 boundaries', async () => {
    const utf8Workspace = await createWorkspace();
    const utf8Subsystem = executableSubsystem(utf8Workspace, { writeDirectories: ['.'], maxTextBytes: 4 });

    await expect(
      utf8Subsystem.invocationPort.invoke(request({ file_path: 'exact.txt', content: 'éé' }), new AbortController().signal),
    ).resolves.toMatchObject({ status: 'SUCCEEDED' });
    await expect(
      utf8Subsystem.invocationPort.invoke(request({ file_path: 'oversized.txt', content: 'ééx' }), new AbortController().signal),
    ).resolves.toMatchObject({ status: 'FAILED', safeError: { code: 'CAPABILITY_INPUT_INVALID' } });

    const utf16Workspace = await createWorkspace();
    const utf16Path = join(utf16Workspace, 'existing.txt');
    await writeFile(utf16Path, Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('a', 'utf16le')]));
    const utf16Subsystem = executableSubsystem(utf16Workspace, { writeDirectories: ['.'], maxTextBytes: 8 });
    await utf16Subsystem.invocationPort.invoke(readRequest({ file_path: 'existing.txt' }), new AbortController().signal);
    await expect(
      utf16Subsystem.invocationPort.invoke(request({ file_path: 'existing.txt', content: 'abc' }), new AbortController().signal),
    ).resolves.toMatchObject({ status: 'SUCCEEDED' });
    await expect(
      utf16Subsystem.invocationPort.invoke(request({ file_path: 'existing.txt', content: 'abcd' }), new AbortController().signal),
    ).resolves.toMatchObject({ status: 'FAILED', safeError: { code: 'CAPABILITY_INPUT_INVALID' } });
  });

  it('makes configured write directories readable without duplicate read configuration', async () => {
    const workspaceDir = await createWorkspace();
    await mkdir(join(workspaceDir, 'generated'));
    await writeFile(join(workspaceDir, 'generated', 'input.txt'), 'readable', 'utf8');
    await mkdir(join(workspaceDir, 'read-only'));
    await writeFile(join(workspaceDir, 'read-only', 'input.txt'), 'also-readable', 'utf8');
    const subsystem = createCapabilitySubsystem({
      read: {
        workspaceDir,
        readDirectories: ['read-only'],
        writeDirectories: ['generated'],
      },
    });

    await expect(
      subsystem.invocationPort.invoke(readRequest({ file_path: 'generated/input.txt' }), new AbortController().signal),
    ).resolves.toMatchObject({
      status: 'SUCCEEDED',
      structuredPayload: { content: 'readable' },
    });
    await expect(
      subsystem.invocationPort.invoke(readRequest({ file_path: 'read-only/input.txt' }), new AbortController().signal),
    ).resolves.toMatchObject({
      status: 'SUCCEEDED',
      structuredPayload: { content: 'also-readable' },
    });
    await expect(subsystem.invocationPort.invoke(readRequest({ file_path: 'outside.txt' }), new AbortController().signal)).resolves.toMatchObject({
      status: 'FAILED',
      safeError: { code: 'CAPABILITY_PATH_REJECTED' },
    });
  });

  it('requires one complete same-run Read and detects changes after Read', async () => {
    const workspaceDir = await createWorkspace();
    await writeFile(join(workspaceDir, 'existing.txt'), 'before', 'utf8');
    const subsystem = executableSubsystem(workspaceDir, { writeDirectories: ['.'] });

    const missingRead = await subsystem.invocationPort.invoke(request({ file_path: 'existing.txt', content: 'after' }), new AbortController().signal);
    expect(missingRead).toMatchObject({ status: 'FAILED', safeError: { code: 'WRITE_REQUIRES_FULL_READ', category: 'CONFLICT' } });

    await subsystem.invocationPort.invoke(readRequest({ file_path: 'existing.txt' }), new AbortController().signal);
    await writeFile(join(workspaceDir, 'existing.txt'), 'external', 'utf8');
    const stale = await subsystem.invocationPort.invoke(request({ file_path: 'existing.txt', content: 'after' }), new AbortController().signal);
    expect(stale).toMatchObject({ status: 'FAILED', safeError: { code: 'WRITE_TARGET_CHANGED', category: 'CONFLICT' } });
    expect(await readFile(join(workspaceDir, 'existing.txt'), 'utf8')).toBe('external');
  });

  it('treats deletion after a full Read as a target change instead of an unguarded create', async () => {
    const workspaceDir = await createWorkspace();
    const path = join(workspaceDir, 'existing.txt');
    await writeFile(path, 'before', 'utf8');
    const subsystem = executableSubsystem(workspaceDir, { writeDirectories: ['.'] });
    await subsystem.invocationPort.invoke(readRequest({ file_path: 'existing.txt' }), new AbortController().signal);
    await unlink(path);

    await expect(
      subsystem.invocationPort.invoke(request({ file_path: 'existing.txt', content: 'recreated' }), new AbortController().signal),
    ).resolves.toMatchObject({
      status: 'FAILED',
      safeError: { code: 'WRITE_TARGET_CHANGED', category: 'CONFLICT' },
    });
    await expect(readFile(path, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('allows a stale conflict to recover only after a new complete Read', async () => {
    const workspaceDir = await createWorkspace();
    const path = join(workspaceDir, 'existing.txt');
    await writeFile(path, 'before', 'utf8');
    const subsystem = executableSubsystem(workspaceDir, { writeDirectories: ['.'] });
    await subsystem.invocationPort.invoke(readRequest({ file_path: 'existing.txt' }), new AbortController().signal);
    await writeFile(path, 'external', 'utf8');

    await expect(
      subsystem.invocationPort.invoke(request({ file_path: 'existing.txt', content: 'blocked' }), new AbortController().signal),
    ).resolves.toMatchObject({ status: 'FAILED', safeError: { code: 'WRITE_TARGET_CHANGED' } });
    await subsystem.invocationPort.invoke(readRequest({ file_path: 'existing.txt' }), new AbortController().signal);
    await expect(
      subsystem.invocationPort.invoke(request({ file_path: 'existing.txt', content: 'allowed' }), new AbortController().signal),
    ).resolves.toMatchObject({ status: 'SUCCEEDED' });
    expect(await readFile(path, 'utf8')).toBe('allowed');
  });

  it('atomically allows only one concurrent creator and never overwrites the winner', async () => {
    const workspaceDir = await createWorkspace();
    const subsystem = executableSubsystem(workspaceDir, { writeDirectories: ['.'] });

    const results = await Promise.all([
      subsystem.invocationPort.invoke(request({ file_path: 'race.txt', content: 'first' }), new AbortController().signal),
      subsystem.invocationPort.invoke(request({ file_path: 'race.txt', content: 'second' }), new AbortController().signal),
    ]);

    expect(results.filter((result) => result.status === 'SUCCEEDED')).toHaveLength(1);
    expect(results.filter((result) => result.safeError?.code === 'WRITE_TARGET_CHANGED')).toHaveLength(1);
    expect(['first', 'second']).toContain(await readFile(join(workspaceDir, 'race.txt'), 'utf8'));
  });

  it('reports an atomic replacement failure before commit as known not committed', async () => {
    const workspaceDir = await createWorkspace();
    const targetPath = join(workspaceDir, 'atomic-failure.txt');
    await writeFile(targetPath, 'before', 'utf8');
    const subsystem = executableSubsystem(workspaceDir, { writeDirectories: ['.'] });
    await subsystem.invocationPort.invoke(readRequest({ file_path: 'atomic-failure.txt' }), new AbortController().signal);

    const invocation = subsystem.invocationPort.invoke(
      request({ file_path: 'atomic-failure.txt', content: 'x'.repeat(200_000) }),
      new AbortController().signal,
    );
    await replaceTargetWithDirectoryAfterTemporaryFileAppears(workspaceDir, targetPath);
    const result = await invocation;

    expect(result).toMatchObject({
      status: 'FAILED',
      structuredPayload: {},
      safeError: {
        code: 'WRITE_ATOMIC_REPLACE_FAILED',
        category: 'INTERNAL',
        retryable: false,
        message: expect.stringContaining('did not commit'),
      },
    });
    expect(result.safeError?.message).not.toMatch(/unknown|verify/iu);
    expect((await stat(targetPath)).isDirectory()).toBe(true);
    expect((await readdir(workspaceDir)).some((entry) => entry.includes('.nextagent-'))).toBe(false);
  });

  it('updates the full Read snapshot after success and clears it by run', async () => {
    const workspaceDir = await createWorkspace();
    await writeFile(join(workspaceDir, 'existing.txt'), 'before', 'utf8');
    const subsystem = executableSubsystem(workspaceDir, { writeDirectories: ['.'] });

    await subsystem.invocationPort.invoke(readRequest({ file_path: 'existing.txt' }), new AbortController().signal);
    await expect(
      subsystem.invocationPort.invoke(request({ file_path: 'existing.txt', content: 'first' }), new AbortController().signal),
    ).resolves.toMatchObject({
      status: 'SUCCEEDED',
      structuredPayload: { type: 'update', file_path: 'workspace/existing.txt' },
    });
    await expect(
      subsystem.invocationPort.invoke(request({ file_path: 'existing.txt', content: 'second' }), new AbortController().signal),
    ).resolves.toMatchObject({
      status: 'SUCCEEDED',
    });
    subsystem.runLifecycle.onTerminalRun(toolContext());
    await expect(
      subsystem.invocationPort.invoke(request({ file_path: 'existing.txt', content: 'third' }), new AbortController().signal),
    ).resolves.toMatchObject({
      status: 'FAILED',
      safeError: { code: 'WRITE_REQUIRES_FULL_READ' },
    });
  });

  it('isolates full Read snapshots by agent, agent version, run and normalized path', async () => {
    const workspaceDir = await createWorkspace();
    await writeFile(join(workspaceDir, 'existing.txt'), 'before', 'utf8');
    const subsystem = executableSubsystem(workspaceDir, { writeDirectories: ['.'] });
    const base = requestOverrides();
    await subsystem.invocationPort.invoke(readRequest({ file_path: './existing.txt' }, base), new AbortController().signal);

    for (const overrides of [
      { ...base, agentId: brand<string, 'AgentId'>('other-agent') },
      { ...base, agentVersion: brand<string, 'AgentVersion'>('v2') },
      { ...base, runId: brand<string, 'RequestRunId'>('other-run') },
    ]) {
      await expect(
        subsystem.invocationPort.invoke(request({ file_path: 'existing.txt', content: 'denied' }, overrides), new AbortController().signal),
      ).resolves.toMatchObject({
        status: 'FAILED',
        safeError: { code: 'WRITE_REQUIRES_FULL_READ', category: 'CONFLICT' },
      });
    }

    await expect(
      subsystem.invocationPort.invoke(request({ file_path: 'existing.txt', content: 'allowed' }, base), new AbortController().signal),
    ).resolves.toMatchObject({ status: 'SUCCEEDED' });
  });

  it('does not combine sequential partial Reads into write authority', async () => {
    const workspaceDir = await createWorkspace();
    await writeFile(join(workspaceDir, 'existing.txt'), 'one\ntwo\nthree', 'utf8');
    const subsystem = executableSubsystem(workspaceDir, { writeDirectories: ['.'], maxLines: 2 });

    await subsystem.invocationPort.invoke(readRequest({ file_path: 'existing.txt', offset: 0, limit: 2 }), new AbortController().signal);
    await subsystem.invocationPort.invoke(readRequest({ file_path: 'existing.txt', offset: 2, limit: 2 }), new AbortController().signal);

    await expect(
      subsystem.invocationPort.invoke(request({ file_path: 'existing.txt', content: 'replacement' }), new AbortController().signal),
    ).resolves.toMatchObject({
      status: 'FAILED',
      safeError: { code: 'WRITE_REQUIRES_FULL_READ' },
    });
  });

  it('does not grant write authority when a full-line Read requires paging', async () => {
    const workspaceDir = await createWorkspace();
    await writeFile(join(workspaceDir, 'existing.txt'), 'ééé', 'utf8');
    const subsystem = executableSubsystem(workspaceDir, { writeDirectories: ['.'], maxTextBytes: 4 });

    const readResult = await subsystem.invocationPort.invoke(readRequest({ file_path: 'existing.txt' }), new AbortController().signal);
    expect(readResult).toMatchObject({
      status: 'FAILED',
      structuredPayload: {},
      safeError: { code: 'PAGING_REQUIRED', category: 'VALIDATION' },
    });
    await expect(
      subsystem.invocationPort.invoke(request({ file_path: 'existing.txt', content: 'next' }), new AbortController().signal),
    ).resolves.toMatchObject({
      status: 'FAILED',
      safeError: { code: 'WRITE_REQUIRES_FULL_READ' },
    });
  });

  it('allows a complete Read of an empty existing file to authorize non-empty replacement', async () => {
    const workspaceDir = await createWorkspace();
    await writeFile(join(workspaceDir, 'empty.txt'), '', 'utf8');
    const subsystem = executableSubsystem(workspaceDir, { writeDirectories: ['.'] });

    await expect(subsystem.invocationPort.invoke(readRequest({ file_path: 'empty.txt' }), new AbortController().signal)).resolves.toMatchObject({
      status: 'SUCCEEDED',
      structuredPayload: { content: '', truncated: false },
    });
    await expect(
      subsystem.invocationPort.invoke(request({ file_path: 'empty.txt', content: 'now populated' }), new AbortController().signal),
    ).resolves.toMatchObject({
      status: 'SUCCEEDED',
      structuredPayload: { type: 'update' },
    });
  });

  it('requires a new full Read after the workspace dependency is recreated', async () => {
    const workspaceDir = await createWorkspace();
    await writeFile(join(workspaceDir, 'existing.txt'), 'before', 'utf8');
    const first = executableSubsystem(workspaceDir, { writeDirectories: ['.'] });
    await first.invocationPort.invoke(readRequest({ file_path: 'existing.txt' }), new AbortController().signal);

    const restarted = executableSubsystem(workspaceDir, { writeDirectories: ['.'] });
    await expect(
      restarted.invocationPort.invoke(request({ file_path: 'existing.txt', content: 'after' }), new AbortController().signal),
    ).resolves.toMatchObject({
      status: 'FAILED',
      safeError: { code: 'WRITE_REQUIRES_FULL_READ' },
    });
  });

  it('clears only snapshots owned by the terminal agent and run', async () => {
    const workspaceDir = await createWorkspace();
    await writeFile(join(workspaceDir, 'first.txt'), 'first', 'utf8');
    await writeFile(join(workspaceDir, 'second.txt'), 'second', 'utf8');
    const subsystem = executableSubsystem(workspaceDir, { writeDirectories: ['.'] });
    const firstContext = requestOverrides({ runId: brand<string, 'RequestRunId'>('run-first') });
    const secondContext = requestOverrides({ runId: brand<string, 'RequestRunId'>('run-second') });
    await subsystem.invocationPort.invoke(readRequest({ file_path: 'first.txt' }, firstContext), new AbortController().signal);
    await subsystem.invocationPort.invoke(readRequest({ file_path: 'second.txt' }, secondContext), new AbortController().signal);

    subsystem.runLifecycle.onTerminalRun({
      agentId: firstContext.agentId!,
      runId: firstContext.runId!,
    });

    await expect(
      subsystem.invocationPort.invoke(request({ file_path: 'first.txt', content: 'blocked' }, firstContext), new AbortController().signal),
    ).resolves.toMatchObject({ status: 'FAILED', safeError: { code: 'WRITE_REQUIRES_FULL_READ' } });
    await expect(
      subsystem.invocationPort.invoke(request({ file_path: 'second.txt', content: 'allowed' }, secondContext), new AbortController().signal),
    ).resolves.toMatchObject({ status: 'SUCCEEDED' });
  });

  it('allows only one concurrent update from the same full Read snapshot', async () => {
    const workspaceDir = await createWorkspace();
    await writeFile(join(workspaceDir, 'existing.txt'), 'before', 'utf8');
    const subsystem = executableSubsystem(workspaceDir, { writeDirectories: ['.'] });
    await subsystem.invocationPort.invoke(readRequest({ file_path: 'existing.txt' }), new AbortController().signal);

    const results = await Promise.all([
      subsystem.invocationPort.invoke(request({ file_path: 'existing.txt', content: 'first' }), new AbortController().signal),
      subsystem.invocationPort.invoke(request({ file_path: 'existing.txt', content: 'second' }), new AbortController().signal),
    ]);

    expect(results.filter((result) => result.status === 'SUCCEEDED')).toHaveLength(1);
    expect(results.filter((result) => result.safeError?.code === 'WRITE_TARGET_CHANGED')).toHaveLength(1);
    expect(['first', 'second']).toContain(await readFile(join(workspaceDir, 'existing.txt'), 'utf8'));
  });

  it('detects content changes even when the previous modification time is restored', async () => {
    const workspaceDir = await createWorkspace();
    const path = join(workspaceDir, 'existing.txt');
    await writeFile(path, 'before', 'utf8');
    const original = await stat(path);
    const subsystem = executableSubsystem(workspaceDir, { writeDirectories: ['.'] });
    await subsystem.invocationPort.invoke(readRequest({ file_path: 'existing.txt' }), new AbortController().signal);
    await writeFile(path, 'changed', 'utf8');
    await utimes(path, original.atime, original.mtime);

    await expect(
      subsystem.invocationPort.invoke(request({ file_path: 'existing.txt', content: 'replacement' }), new AbortController().signal),
    ).resolves.toMatchObject({
      status: 'FAILED',
      safeError: { code: 'WRITE_TARGET_CHANGED' },
    });
    expect(await readFile(path, 'utf8')).toBe('changed');
  });

  it('does not treat truncated or partial Read as write authority', async () => {
    const workspaceDir = await createWorkspace();
    await writeFile(join(workspaceDir, 'large.txt'), 'one\ntwo\nthree', 'utf8');
    const subsystem = executableSubsystem(workspaceDir, { writeDirectories: ['.'], maxLines: 1 });

    await subsystem.invocationPort.invoke(readRequest({ file_path: 'large.txt', offset: 0, limit: 1 }), new AbortController().signal);
    await expect(
      subsystem.invocationPort.invoke(request({ file_path: 'large.txt', content: 'replacement' }), new AbortController().signal),
    ).resolves.toMatchObject({
      status: 'FAILED',
      safeError: { code: 'WRITE_REQUIRES_FULL_READ' },
    });
  });

  it('enforces non-empty bounded text and preserves supported BOM encodings', async () => {
    const workspaceDir = await createWorkspace();
    const utf16Path = join(workspaceDir, 'utf16.txt');
    await writeFile(utf16Path, Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('before', 'utf16le')]));
    const subsystem = executableSubsystem(workspaceDir, { writeDirectories: ['.'], maxTextBytes: 32 });

    await subsystem.invocationPort.invoke(readRequest({ file_path: 'utf16.txt' }), new AbortController().signal);
    await subsystem.invocationPort.invoke(request({ file_path: 'utf16.txt', content: 'after' }), new AbortController().signal);
    expect(await readFile(utf16Path)).toEqual(Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('after', 'utf16le')]));

    for (const args of [
      { file_path: 'empty.txt', content: '' },
      { file_path: 'large.txt', content: 'x'.repeat(33) },
      { file_path: 'control-character.txt', content: 'bad\u0000text' },
    ]) {
      await expect(subsystem.invocationPort.invoke(request(args), new AbortController().signal)).resolves.toMatchObject({
        status: 'FAILED',
        safeError: { code: 'CAPABILITY_INPUT_INVALID' },
      });
    }
  });

  it('preserves UTF-8 BOM and UTF-16 BE while leaving supplied line endings unchanged', async () => {
    const workspaceDir = await createWorkspace();
    const utf8BomPath = join(workspaceDir, 'utf8-bom.txt');
    const utf16BePath = join(workspaceDir, 'utf16-be.txt');
    await writeFile(utf8BomPath, Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('before', 'utf8')]));
    await writeFile(utf16BePath, utf16Be('before'));
    const subsystem = executableSubsystem(workspaceDir, { writeDirectories: ['.'] });

    await subsystem.invocationPort.invoke(readRequest({ file_path: 'utf8-bom.txt' }), new AbortController().signal);
    await subsystem.invocationPort.invoke(request({ file_path: 'utf8-bom.txt', content: 'after\r\nline' }), new AbortController().signal);
    expect(await readFile(utf8BomPath)).toEqual(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('after\r\nline', 'utf8')]));

    await subsystem.invocationPort.invoke(readRequest({ file_path: 'utf16-be.txt' }), new AbortController().signal);
    await subsystem.invocationPort.invoke(request({ file_path: 'utf16-be.txt', content: 'after\nline' }), new AbortController().signal);
    expect(await readFile(utf16BePath)).toEqual(utf16Be('after\nline'));
  });

  it('rejects invalid UTF-8, malformed UTF-16 and NUL-bearing existing files without disclosure', async () => {
    const workspaceDir = await createWorkspace();
    const invalidFiles = [
      ['invalid-utf8.txt', Buffer.from([0xc3, 0x28])],
      ['odd-utf16.txt', Buffer.from([0xff, 0xfe, 0x61])],
      ['binary.txt', Buffer.from([0x61, 0x00, 0x62])],
    ] as const;
    for (const [name, bytes] of invalidFiles) {
      await writeFile(join(workspaceDir, name), bytes);
    }
    const subsystem = executableSubsystem(workspaceDir, { writeDirectories: ['.'] });

    for (const [name] of invalidFiles) {
      const result = await subsystem.invocationPort.invoke(request({ file_path: name, content: 'replacement-secret' }), new AbortController().signal);
      expect(result.status).toBe('FAILED');
      expect(JSON.stringify(result)).not.toContain('replacement-secret');
      expect(JSON.stringify(result)).not.toContain(workspaceDir);
    }
  });

  it('rejects traversal, absolute paths, glob, directories, hard links and symbolic links', async () => {
    const workspaceDir = await createWorkspace();
    await mkdir(join(workspaceDir, 'directory'));
    await writeFile(join(workspaceDir, 'linked-source.txt'), 'source', 'utf8');
    await link(join(workspaceDir, 'linked-source.txt'), join(workspaceDir, 'hard-link.txt'));
    const subsystem = executableSubsystem(workspaceDir, { writeDirectories: ['.'] });
    const unsafe: JsonObject[] = [
      { file_path: '', content: 'x' },
      { file_path: '.', content: 'x' },
      { file_path: '../escape.txt', content: 'x' },
      { file_path: 'directory/../normalized-escape.txt', content: 'x' },
      { file_path: join(workspaceDir, 'absolute.txt'), content: 'x' },
      { file_path: '/absolute.txt', content: 'x' },
      { file_path: '\\\\server\\share\\file.txt', content: 'x' },
      { file_path: '\\\\?\\C:\\file.txt', content: 'x' },
      { file_path: '*.txt', content: 'x' },
      { file_path: 'file?.txt', content: 'x' },
      { file_path: 'file[1].txt', content: 'x' },
      { file_path: 'C:drive-relative.txt', content: 'x' },
      { file_path: 'normal.txt:stream', content: 'x' },
      { file_path: 'line\nbreak.txt', content: 'x' },
      { file_path: 'nul\u0000byte.txt', content: 'x' },
      { file_path: 'CON', content: 'x' },
      { file_path: 'CON ', content: 'x' },
      { file_path: 'NUL...', content: 'x' },
      { file_path: 'nested/prn.log', content: 'x' },
      { file_path: 'nested/PRN .log', content: 'x' },
      { file_path: 'aux.txt', content: 'x' },
      { file_path: 'COM9.txt', content: 'x' },
      { file_path: 'lpt1', content: 'x' },
      { file_path: 'trailing-dot.', content: 'x' },
      { file_path: 'trailing-space ', content: 'x' },
      { file_path: 'NUL.txt', content: 'x' },
      { file_path: 'directory', content: 'x' },
      { file_path: 'hard-link.txt', content: 'x' },
    ];
    const symlinkCreated = await tryCreateSymlink(join(workspaceDir, 'linked-source.txt'), join(workspaceDir, 'symbolic.txt'));
    if (symlinkCreated) {
      unsafe.push({ file_path: 'symbolic.txt', content: 'x' });
    }

    for (const args of unsafe) {
      const result = await subsystem.invocationPort.invoke(request(args), new AbortController().signal);
      expect(result.status, JSON.stringify(args)).toBe('FAILED');
      expect(JSON.stringify(result)).not.toContain(workspaceDir);
    }
  });

  it('rejects a symbolic-link parent and leaves the external directory unchanged', async () => {
    const workspaceDir = await createWorkspace();
    const externalDir = await createWorkspace();
    const linked = await tryCreateSymlink(externalDir, join(workspaceDir, 'linked-parent'), 'dir');
    if (!linked) {
      return;
    }
    const subsystem = executableSubsystem(workspaceDir, { writeDirectories: ['.'] });

    await expect(
      subsystem.invocationPort.invoke(request({ file_path: 'linked-parent/escape.txt', content: 'secret' }), new AbortController().signal),
    ).resolves.toMatchObject({
      status: 'FAILED',
      safeError: { code: 'CAPABILITY_PATH_REJECTED' },
    });
    expect(await readdir(externalDir)).toEqual([]);
  });

  it.skipIf(process.platform === 'win32')('rejects an existing Unix socket target', async () => {
    const workspaceDir = await createWorkspace();
    const socketPath = join(workspaceDir, 'service.sock');
    const server = createServer();
    await new Promise<void>((resolveListen, rejectListen) => {
      server.once('error', rejectListen);
      server.listen(socketPath, resolveListen);
    });
    try {
      const subsystem = executableSubsystem(workspaceDir, { writeDirectories: ['.'] });
      await expect(
        subsystem.invocationPort.invoke(request({ file_path: 'service.sock', content: 'replacement' }), new AbortController().signal),
      ).resolves.toMatchObject({
        status: 'FAILED',
        safeError: { code: 'CAPABILITY_PATH_REJECTED' },
      });
    } finally {
      await new Promise<void>((resolveClose, rejectClose) => {
        server.close((error) => (error === undefined ? resolveClose() : rejectClose(error)));
      });
    }
  });

  it('does not leave invocation temporary files after successful create and update', async () => {
    const workspaceDir = await createWorkspace();
    const subsystem = executableSubsystem(workspaceDir, { writeDirectories: ['.'] });
    await subsystem.invocationPort.invoke(request({ file_path: 'target.txt', content: 'created' }), new AbortController().signal);
    await subsystem.invocationPort.invoke(readRequest({ file_path: 'target.txt' }), new AbortController().signal);
    await subsystem.invocationPort.invoke(request({ file_path: 'target.txt', content: 'updated' }), new AbortController().signal);

    expect((await readdir(workspaceDir)).filter((name) => name.includes('.nextagent-'))).toEqual([]);
  });

  it('cancels before mutation without leaving a target or temporary file', async () => {
    const workspaceDir = await createWorkspace();
    const subsystem = executableSubsystem(workspaceDir, { writeDirectories: ['.'] });
    const controller = new AbortController();
    controller.abort();

    await expect(subsystem.invocationPort.invoke(request({ file_path: 'canceled.txt', content: 'value' }), controller.signal)).resolves.toMatchObject(
      {
        status: 'FAILED',
        safeError: { code: 'CAPABILITY_ABORTED', category: 'CANCELED' },
      },
    );
    await expect(readFile(join(workspaceDir, 'canceled.txt'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it.skipIf(process.platform === 'win32')('preserves target permissions across atomic replacement', async () => {
    const workspaceDir = await createWorkspace();
    const path = join(workspaceDir, 'mode.txt');
    await writeFile(path, 'before', { encoding: 'utf8', mode: 0o640 });
    await chmod(path, 0o640);
    const subsystem = executableSubsystem(workspaceDir, { writeDirectories: ['.'] });

    await subsystem.invocationPort.invoke(readRequest({ file_path: 'mode.txt' }), new AbortController().signal);
    await subsystem.invocationPort.invoke(request({ file_path: 'mode.txt', content: 'after' }), new AbortController().signal);

    expect((await stat(path)).mode & 0o777).toBe(0o640);
  });

  it.skipIf(process.platform === 'win32')('detects target permission changes after the full Read', async () => {
    const workspaceDir = await createWorkspace();
    const path = join(workspaceDir, 'mode-changed.txt');
    await writeFile(path, 'before', { encoding: 'utf8', mode: 0o640 });
    await chmod(path, 0o640);
    const subsystem = executableSubsystem(workspaceDir, { writeDirectories: ['.'] });
    await subsystem.invocationPort.invoke(readRequest({ file_path: 'mode-changed.txt' }), new AbortController().signal);
    await chmod(path, 0o600);

    await expect(
      subsystem.invocationPort.invoke(request({ file_path: 'mode-changed.txt', content: 'after' }), new AbortController().signal),
    ).resolves.toMatchObject({
      status: 'FAILED',
      safeError: { code: 'WRITE_TARGET_CHANGED' },
    });
    expect((await stat(path)).mode & 0o777).toBe(0o600);
    expect(await readFile(path, 'utf8')).toBe('before');
  });

  it.skipIf(process.platform === 'win32' || process.getuid?.() === 0)(
    'fails the non-idempotent write safely without leaving a temp file when the target is unwritable',
    async () => {
      const workspaceDir = await createWorkspace();
      const dir = join(workspaceDir, 'locked');
      await mkdir(dir);
      const targetPath = join(dir, 'target.txt');
      await writeFile(targetPath, 'before', 'utf8');
      const subsystem = executableSubsystem(workspaceDir, { writeDirectories: ['.'] });
      await subsystem.invocationPort.invoke(readRequest({ file_path: 'locked/target.txt' }), new AbortController().signal);
      await chmod(dir, 0o500);
      try {
        await expect(
          subsystem.invocationPort.invoke(request({ file_path: 'locked/target.txt', content: 'after' }), new AbortController().signal),
        ).resolves.toMatchObject({ status: 'FAILED', safeError: { category: 'INTERNAL' } });
        expect(await readFile(targetPath, 'utf8')).toBe('before');
        expect((await readdir(dir)).some((entry) => entry.includes('.nextagent-'))).toBe(false);
      } finally {
        await chmod(dir, 0o700);
      }
    },
  );

  it.skipIf(process.platform === 'win32' || process.getuid?.() === 0)(
    'fails without direct-write fallback when the target directory is not writable',
    async () => {
      const workspaceDir = await createWorkspace();
      const directory = join(workspaceDir, 'locked');
      const path = join(directory, 'existing.txt');
      await mkdir(directory);
      await writeFile(path, 'before', 'utf8');
      const subsystem = executableSubsystem(workspaceDir, { writeDirectories: ['locked'] });
      await subsystem.invocationPort.invoke(readRequest({ file_path: 'locked/existing.txt' }), new AbortController().signal);
      await chmod(directory, 0o500);
      try {
        await expect(
          subsystem.invocationPort.invoke(request({ file_path: 'locked/existing.txt', content: 'after' }), new AbortController().signal),
        ).resolves.toMatchObject({
          status: 'FAILED',
        });
        expect(await readFile(path, 'utf8')).toBe('before');
      } finally {
        await chmod(directory, 0o700);
      }
    },
  );
});

function executableSubsystem(
  workspaceDir: string,
  read: { readonly writeDirectories: readonly string[]; readonly maxTextBytes?: number; readonly maxLines?: number },
) {
  return createCapabilitySubsystem({
    read: { workspaceDir, ...read },
  });
}

async function replaceTargetWithDirectoryAfterTemporaryFileAppears(workspaceDir: string, targetPath: string): Promise<void> {
  for (let attempt = 0; attempt < 10_000; attempt += 1) {
    const temporaryFileExists = (await readdir(workspaceDir)).some(
      (entry) => entry.startsWith('atomic-failure.txt.nextagent-') && entry.endsWith('.tmp'),
    );
    if (temporaryFileExists) {
      await unlink(targetPath);
      await mkdir(targetPath);
      return;
    }
    await new Promise<void>((resolveImmediate) => setImmediate(resolveImmediate));
  }
  throw new Error('Atomic replacement temporary file was not observed.');
}

function request(argumentsValue: JsonObject, overrides: Partial<CapabilityInvocationRequest> = {}): CapabilityInvocationRequest {
  return capabilityRequest(writeCapabilityId, argumentsValue, overrides);
}

function readRequest(argumentsValue: JsonObject, overrides: Partial<CapabilityInvocationRequest> = {}): CapabilityInvocationRequest {
  return capabilityRequest(readCapabilityId, argumentsValue, overrides);
}

function capabilityRequest(
  capabilityId: CapabilityInvocationRequest['capabilityId'],
  argumentsValue: JsonObject,
  overrides: Partial<CapabilityInvocationRequest> = {},
): CapabilityInvocationRequest {
  return {
    invocationId: `invoke-${capabilityId}`,
    capabilityId,
    arguments: argumentsValue,
    sessionId: brand<string, 'SessionId'>('session-write'),
    requestId: brand<string, 'MessageId'>('request-write'),
    runId: brand<string, 'RequestRunId'>('run-write'),
    requestContextId: brand<string, 'RequestContextId'>('context-write'),
    stepId: 'turn-1',
    identityContext: { tenantId: tenantId(), subjectId: subjectId(), displayName: 'Write tester' },
    agentId: brand<string, 'AgentId'>('default-agent'),
    agentVersion: brand<string, 'AgentVersion'>('v1'),
    timeoutMs: 30_000,
    idempotencyKey: brand<string, 'IdempotencyKey'>(`idem-${capabilityId}`),
    ...overrides,
  };
}

function requestOverrides(
  overrides: Partial<CapabilityInvocationRequest> = {},
): Partial<CapabilityInvocationRequest> & Pick<CapabilityInvocationRequest, 'agentId' | 'agentVersion' | 'runId'> {
  const value = capabilityRequest(writeCapabilityId, {});
  return {
    agentId: value.agentId,
    agentVersion: value.agentVersion,
    runId: value.runId,
    ...overrides,
  };
}

function toolContext(): ToolExecutionContext {
  const value = request({});
  return {
    identityContext: value.identityContext,
    agentId: value.agentId,
    agentVersion: value.agentVersion,
    sessionId: value.sessionId,
    requestId: value.requestId,
    runId: value.runId,
    requestContextId: value.requestContextId,
    stepId: value.stepId,
    toolCallId: value.toolCallId ?? 'tool-write',
    timeoutMs: value.timeoutMs,
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
    capabilityBindings: [{ capabilityId: writeCapabilityId, capabilityType: 'TOOL', providerId: 'builtin-tools' }],
    userInvocable: true,
    agentInvocation: 'BOUND',
    runtimeSettings: { requestTimeoutMs: 1000 },
  };
}

async function createWorkspace(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'nextagent-write-'));
  tempDirectories.push(directory);
  return directory;
}

async function tryCreateSymlink(target: string, path: string, type: 'dir' | 'file' = 'file'): Promise<boolean> {
  try {
    await symlink(target, path, type);
    return true;
  } catch {
    return false;
  }
}

function utf16Be(value: string): Buffer {
  const littleEndian = Buffer.from(value, 'utf16le');
  const bigEndian = Buffer.allocUnsafe(littleEndian.length);
  for (let index = 0; index < littleEndian.length; index += 2) {
    bigEndian[index] = littleEndian[index + 1]!;
    bigEndian[index + 1] = littleEndian[index]!;
  }
  return Buffer.concat([Buffer.from([0xfe, 0xff]), bigEndian]);
}

function tenantId() {
  return brand<string, 'TenantId'>('tenant-write');
}

function subjectId() {
  return brand<string, 'SubjectId'>('subject-write');
}
