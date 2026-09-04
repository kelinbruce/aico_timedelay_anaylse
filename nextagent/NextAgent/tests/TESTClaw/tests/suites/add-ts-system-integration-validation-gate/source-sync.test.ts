import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { BACKEND_E2E_SOURCE_MANIFEST, BROWSER_E2E_SOURCE_MANIFEST, FIXED_GATE_SOURCE_MANIFEST } from './source-manifests.js';
import { verifySystemIntegrationSourceSync } from './helpers/source-sync.js';

const repositoryRoot = path.resolve(import.meta.dirname, '../../../../..');

describe('system integration source sync', () => {
  it('matches all 41 fixed, 49 backend, and 24 browser source cases', async () => {
    expect(FIXED_GATE_SOURCE_MANIFEST).toHaveLength(41);
    expect(BACKEND_E2E_SOURCE_MANIFEST).toHaveLength(49);
    expect(BROWSER_E2E_SOURCE_MANIFEST).toHaveLength(24);

    await expect(verifySystemIntegrationSourceSync(repositoryRoot)).resolves.toEqual({
      fixed: '41/41',
      backend: '49/49',
      backendFiles: 20,
      browser: '24/24',
      browserFiles: 7,
    });
  });

  it('fails when a source file loses an executable case', async () => {
    const driftFile = BACKEND_E2E_SOURCE_MANIFEST[0].sourceFile;
    await expect(
      verifySystemIntegrationSourceSync(repositoryRoot, {
        readSource: async (relativeFile) => (relativeFile === driftFile ? '' : readFile(path.join(repositoryRoot, relativeFile), 'utf8')),
      }),
    ).rejects.toThrow('backend source drift');
  });
});
