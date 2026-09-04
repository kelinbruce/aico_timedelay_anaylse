import { readFile, readdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

describe('HarnessBench architecture boundary', () => {
  it('uses only public NextAgent exports and contains no benchmark release verdict', async () => {
    const files = (await readdir(root, { recursive: true }))
      .filter((path) => /\.(?:mjs|ts)$/u.test(path))
      .filter((path) => !path.startsWith('tests'));
    const source = (await Promise.all(files.map((path) => readFile(resolve(root, path), 'utf8')))).join('\n');

    expect(source).not.toMatch(/packages[\\/][^\\/]+[\\/]src[\\/]/u);
    expect(source).not.toMatch(/@nextagent\/[a-z-]+\/testing/u);
    expect(source).not.toContain('ReleaseCheckResult');
    expect(source).toContain('delete process.env.RUBRIC_API_KEY');
    expect(source).toContain('delete process.env.RUBRIC_BASE_URL');
    expect(source).toContain('delete process.env.RUBRIC_MODEL');
    expect(source).toContain('delete process.env.HARNESSBENCH_API_KEY');
    expect(source).toContain('delete process.env.HARNESSBENCH_PROVIDER_BASE_URL');
  });
});
