import { createHash } from 'node:crypto';
import { lstat, mkdir, mkdtemp, readFile, readlink, readdir, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

export interface ExternalConsumerRoot {
  readonly root: string;
  readonly nodeModulesPath: string;
  readonly cleanup: () => Promise<void>;
}

export async function createExternalConsumerRoot(input: {
  readonly externalPackagesRoot: string;
  readonly tempBase?: string;
}): Promise<ExternalConsumerRoot> {
  const externalRoot = path.resolve(input.externalPackagesRoot);
  const externalNodeModules = path.join(externalRoot, 'node_modules');
  if (!(await isDirectory(externalNodeModules))) {
    throw new Error('external packages node_modules is unavailable');
  }

  const tempBase = path.resolve(input.tempBase ?? tmpdir());
  await mkdir(tempBase, { recursive: true });
  const root = await mkdtemp(path.join(tempBase, 'testclaw-external-consumer-'));
  const nodeModulesPath = path.join(root, 'node_modules');
  let removed = false;
  const cleanup = async (): Promise<void> => {
    if (removed) {
      return;
    }
    removed = true;
    await rm(root, { recursive: true, force: true });
  };

  try {
    await symlink(externalNodeModules, nodeModulesPath, process.platform === 'win32' ? 'junction' : 'dir');
    return Object.freeze({ root, nodeModulesPath, cleanup });
  } catch (error) {
    await cleanup();
    throw error;
  }
}

export async function hashDirectoryTree(root: string): Promise<string> {
  const resolvedRoot = path.resolve(root);
  const digest = createHash('sha256');
  await hashEntry(resolvedRoot, '', digest);
  return digest.digest('hex');
}

export function externalNextAgentArtifactsRoot(externalPackagesRoot: string): string {
  return path.join(path.resolve(externalPackagesRoot), 'node_modules', '@nextagent');
}

async function hashEntry(absolutePath: string, relativePath: string, digest: ReturnType<typeof createHash>): Promise<void> {
  const metadata = await lstat(absolutePath);
  const normalizedPath = relativePath.split(path.sep).join('/');
  if (metadata.isSymbolicLink()) {
    digest.update(`link\0${normalizedPath}\0${await readlink(absolutePath)}\0`);
    return;
  }
  if (metadata.isDirectory()) {
    digest.update(`dir\0${normalizedPath}\0`);
    const entries = (await readdir(absolutePath)).sort((left, right) => left.localeCompare(right));
    for (const entry of entries) {
      await hashEntry(path.join(absolutePath, entry), relativePath.length === 0 ? entry : path.join(relativePath, entry), digest);
    }
    return;
  }
  if (metadata.isFile()) {
    digest.update(`file\0${normalizedPath}\0${metadata.size}\0`);
    digest.update(await readFile(absolutePath));
    digest.update('\0');
    return;
  }
  digest.update(`other\0${normalizedPath}\0${metadata.mode}\0`);
}

async function isDirectory(target: string): Promise<boolean> {
  try {
    return (await lstat(target)).isDirectory();
  } catch (error) {
    if (isMissing(error)) {
      return false;
    }
    throw error;
  }
}

function isMissing(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}
