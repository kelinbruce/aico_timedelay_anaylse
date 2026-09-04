import { readFile } from 'node:fs/promises';
import path from 'node:path';
import {
  BACKEND_E2E_SOURCE_MANIFEST,
  BROWSER_E2E_SOURCE_MANIFEST,
  FIXED_GATE_SOURCE_MANIFEST,
  type SourceManifestEntry,
} from '../source-manifests.ts';

export interface SourceSyncResult {
  readonly fixed: '41/41';
  readonly backend: '49/49';
  readonly backendFiles: 20;
  readonly browser: '24/24';
  readonly browserFiles: 7;
}

export async function verifySystemIntegrationSourceSync(
  repositoryRoot: string,
  options: {
    readonly readSource?: (relativeFile: string) => Promise<string>;
  } = {},
): Promise<SourceSyncResult> {
  const readSource = options.readSource ?? ((relativeFile: string) => readFile(path.join(repositoryRoot, relativeFile), 'utf8'));
  assertManifestCount(FIXED_GATE_SOURCE_MANIFEST, 41, 'fixed');
  assertManifestCount(BACKEND_E2E_SOURCE_MANIFEST, 49, 'backend');
  assertManifestCount(BROWSER_E2E_SOURCE_MANIFEST, 24, 'browser');

  const sourceCache = new Map<string, string>();
  const load = async (relativeFile: string): Promise<string> => {
    let source = sourceCache.get(relativeFile);
    if (source === undefined) {
      source = await readSource(relativeFile);
      sourceCache.set(relativeFile, source);
    }
    return source;
  };

  for (const entry of FIXED_GATE_SOURCE_MANIFEST) {
    if (!(await load(entry.sourceFile)).includes(entry.sourceToken)) {
      throw new Error(`fixed source drift: ${entry.sourceCaseRef}`);
    }
  }
  await verifyExecutableFileCounts(BACKEND_E2E_SOURCE_MANIFEST, load, 'backend');
  await verifyExecutableFileCounts(BROWSER_E2E_SOURCE_MANIFEST, load, 'browser');

  const backendFiles = uniqueFiles(BACKEND_E2E_SOURCE_MANIFEST).length;
  const browserFiles = uniqueFiles(BROWSER_E2E_SOURCE_MANIFEST).length;
  if (backendFiles !== 20 || browserFiles !== 7) {
    throw new Error('source file ownership drift');
  }
  return Object.freeze({
    fixed: '41/41',
    backend: '49/49',
    backendFiles: 20,
    browser: '24/24',
    browserFiles: 7,
  });
}

async function verifyExecutableFileCounts(
  manifest: readonly SourceManifestEntry[],
  load: (relativeFile: string) => Promise<string>,
  kind: 'backend' | 'browser',
): Promise<void> {
  const expectedByFile = new Map<string, number>();
  for (const entry of manifest) {
    expectedByFile.set(entry.sourceFile, (expectedByFile.get(entry.sourceFile) ?? 0) + 1);
  }
  const pattern = kind === 'backend' ? /^\s*(?:it|test)(?:\.each)?\s*\(/gm : /^\s*test\s*\(/gm;
  for (const [sourceFile, expected] of expectedByFile) {
    const source = await load(sourceFile);
    const actual = source.match(pattern)?.length ?? 0;
    if (actual !== expected) {
      throw new Error(`${kind} source drift: ${sourceFile}`);
    }
  }
}

function assertManifestCount(manifest: readonly SourceManifestEntry[], expected: number, kind: string): void {
  if (manifest.length !== expected || new Set(manifest.map((entry) => entry.sourceCaseRef)).size !== expected) {
    throw new Error(`${kind} source manifest drift`);
  }
}

function uniqueFiles(manifest: readonly SourceManifestEntry[]): readonly string[] {
  return [...new Set(manifest.map((entry) => entry.sourceFile))];
}
