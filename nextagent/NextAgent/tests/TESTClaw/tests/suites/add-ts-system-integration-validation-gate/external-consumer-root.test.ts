import { mkdtemp, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createExternalConsumerRoot, hashDirectoryTree } from './helpers/external-consumer-root.js';

const cleanupRoots: string[] = [];

afterEach(async () => {
  const { rm } = await import('node:fs/promises');
  await Promise.all(cleanupRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('external consumer root', () => {
  it('links a temporary consumer to the external packages without modifying the input tree', async () => {
    const externalRoot = await mkdtemp(path.join(tmpdir(), 'testclaw-external-input-'));
    cleanupRoots.push(externalRoot);
    const packageRoot = path.join(externalRoot, 'node_modules', '@nextagent', 'example');
    await mkdir(packageRoot, { recursive: true });
    await writeFile(
      path.join(packageRoot, 'package.json'),
      JSON.stringify({ name: '@nextagent/example', type: 'module', exports: './index.js' }),
      'utf8',
    );
    await writeFile(path.join(packageRoot, 'index.js'), 'export const value = 1;\n', 'utf8');
    const beforeHash = await hashDirectoryTree(externalRoot);

    const consumer = await createExternalConsumerRoot({ externalPackagesRoot: externalRoot });
    expect(await readFile(path.join(consumer.nodeModulesPath, '@nextagent', 'example', 'index.js'), 'utf8')).toContain('value = 1');
    expect((await stat(consumer.root)).isDirectory()).toBe(true);

    await consumer.cleanup();
    await consumer.cleanup();

    await expect(stat(consumer.root)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await hashDirectoryTree(externalRoot)).toBe(beforeHash);
  });

  it('rejects an input root without node_modules before creating a consumer', async () => {
    const externalRoot = await mkdtemp(path.join(tmpdir(), 'testclaw-external-empty-'));
    cleanupRoots.push(externalRoot);

    await expect(createExternalConsumerRoot({ externalPackagesRoot: externalRoot })).rejects.toThrow('external packages node_modules is unavailable');
  });

  it('does not install, download, or spawn package-manager processes', async () => {
    const source = await readFile(new URL('./helpers/external-consumer-root.ts', import.meta.url), 'utf8');

    expect(source).not.toMatch(/node:(?:child_process|http|https)|\bfetch\s*\(|\bnpm\s+(?:ci|install)\b/);
  });
});
