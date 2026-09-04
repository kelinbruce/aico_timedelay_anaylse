import { assertPathHasNoLinks, resolveAuthorizedPath, resolveSearchRoot } from '@nextagent/agent-capability';
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const tempDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe('path security .nextagent access', () => {
  it('allows .nextagent paths outside configured workspace directories', async () => {
    const workspaceRoot = await createWorkspace();

    expect(resolveAuthorizedPath(workspaceRoot, '.nextagent/skills/projection/rag/guide.md', [])).toMatchObject({
      relativePath: '.nextagent/skills/projection/rag/guide.md',
    });
    expect(resolveSearchRoot(workspaceRoot, '.nextagent/skills/projection', [])).toMatchObject({
      relativePath: '.nextagent/skills/projection',
    });
  });

  it('allows .nextagent paths to cross links while preserving the normal workspace link guard', async () => {
    const workspaceRoot = await createWorkspace();
    const outsideRoot = await createWorkspace();
    await mkdir(join(workspaceRoot, 'workspace'), { recursive: true });
    await mkdir(join(outsideRoot, 'skills', 'projection'), { recursive: true });
    await writeFile(join(outsideRoot, 'skills', 'projection', 'guide.md'), 'guide', 'utf8');

    await symlink(outsideRoot, join(workspaceRoot, '.nextagent'), symlinkType());
    await symlink(outsideRoot, join(workspaceRoot, 'workspace', '.nextagent'), symlinkType());
    await mkdir(join(workspaceRoot, 'other'), { recursive: true });
    await symlink(outsideRoot, join(workspaceRoot, 'other', '.nextagent'), symlinkType());
    await symlink(outsideRoot, join(workspaceRoot, 'workspace', 'linked'), symlinkType());

    await expect(assertPathHasNoLinks(workspaceRoot, '.nextagent/skills/projection/guide.md', true)).resolves.toBeUndefined();
    await expect(assertPathHasNoLinks(workspaceRoot, 'workspace/.nextagent/skills/projection/guide.md', true)).resolves.toBeUndefined();
    await expect(assertPathHasNoLinks(workspaceRoot, 'other/.nextagent/skills/projection/guide.md', true)).rejects.toMatchObject({
      code: 'CAPABILITY_PATH_REJECTED',
      category: 'AUTHORIZATION',
    });
    await expect(assertPathHasNoLinks(workspaceRoot, 'workspace/linked/guide.md', true)).rejects.toMatchObject({
      code: 'CAPABILITY_PATH_REJECTED',
      category: 'AUTHORIZATION',
    });
    await expect(assertPathHasNoLinks(workspaceRoot, 'workspace/linked/.nextagent/skills/projection/guide.md', true)).rejects.toMatchObject({
      code: 'CAPABILITY_PATH_REJECTED',
      category: 'AUTHORIZATION',
    });
  });
});

async function createWorkspace(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'nextagent-path-security-'));
  tempDirectories.push(directory);
  return directory;
}

function symlinkType(): 'dir' | 'junction' {
  return process.platform === 'win32' ? 'junction' : 'dir';
}
