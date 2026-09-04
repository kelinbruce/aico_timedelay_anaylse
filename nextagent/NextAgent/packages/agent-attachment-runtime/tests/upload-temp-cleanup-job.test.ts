import { access, mkdtemp, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanupUploadTempAtStartup } from '../src/upload-temp-cleanup-job.js';

let tempDir: string | undefined;

afterEach(async () => {
  if (tempDir !== undefined) {
    await rm(tempDir, { recursive: true, force: true });
  }
});

describe('upload temp startup cleanup', () => {
  it('removes stale upload entries before the application accepts requests', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'upload-temp-cleanup-'));
    const staleEntry = join(tempDir, 'stale-upload');
    await writeFile(staleEntry, 'stale');
    await utimes(staleEntry, new Date(0), new Date(Date.now() - 1_000));

    await expect(cleanupUploadTempAtStartup(tempDir)).resolves.toBe(1);
    await expect(access(staleEntry)).rejects.toThrow();
  });
});
