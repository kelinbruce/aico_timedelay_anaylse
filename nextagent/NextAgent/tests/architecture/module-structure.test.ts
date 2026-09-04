import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const packagesRoot = join(root, 'packages');

const productizedPackages = [
  'agent-app',
  'agent-runtime',
  'agent-core',
  'agent-channel-web',
  'agent-model',
  'agent-capability',
  'agent-context-engine',
  'agent-session',
  'agent-platform-gateway-local',
  'agent-observability',
] as const;

const forbiddenIndexBodies = [
  'class ',
  'Fastify(',
  'setErrorHandler',
  'readFile(',
  'stat(',
  'fetchImpl',
  'async submit(',
  'async execute(',
  'async invoke(',
] as const;

function walkFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const fullPath = join(dir, entry);
    if (entry === 'dist') {
      return [];
    }
    return statSync(fullPath).isDirectory() ? walkFiles(fullPath) : [fullPath];
  });
}

function resolveInternalImport(fromFile: string, specifier: string): string | undefined {
  if (specifier.startsWith('.')) {
    const basePath = join(dirname(fromFile), specifier).replace(/\.js$/, '.ts');
    return statSyncSafe(basePath)?.isFile() === true ? basePath : undefined;
  }
  if (specifier === '@nextagent/agent-model/testing') {
    return join(packagesRoot, 'agent-model', 'src', 'testing', 'index.ts');
  }
  if (specifier === '@nextagent/agent-app/testing') {
    return join(packagesRoot, 'agent-app', 'src', 'testing.ts');
  }
  const packageMatch = /^@nextagent\/([^/]+)$/.exec(specifier);
  if (packageMatch?.[1] !== undefined) {
    return join(packagesRoot, packageMatch[1], 'src', 'index.ts');
  }
  return undefined;
}

function statSyncSafe(path: string) {
  try {
    return statSync(path);
  } catch {
    return undefined;
  }
}

function internalSpecifiers(sourceText: string): string[] {
  return [...sourceText.matchAll(/(?:import|export)\s+(?:[^"']*?\s+from\s+)?["']([^"']+)["']/g)]
    .map((match) => match[1])
    .filter((specifier): specifier is string => specifier !== undefined);
}

function reachableInternalFiles(entryFile: string): Set<string> {
  const visited = new Set<string>();
  const pending = [entryFile];
  while (pending.length > 0) {
    const file = pending.pop();
    if (file === undefined || visited.has(file)) {
      continue;
    }
    visited.add(file);
    const sourceText = readFileSync(file, 'utf8');
    for (const specifier of internalSpecifiers(sourceText)) {
      const resolved = resolveInternalImport(file, specifier);
      if (resolved !== undefined && !visited.has(resolved)) {
        pending.push(resolved);
      }
    }
  }
  return visited;
}

describe('productized package module structure', () => {
  it('keeps core implementation packages out of single-file src/index.ts delivery', () => {
    for (const packageName of productizedPackages) {
      const srcDir = join(packagesRoot, packageName, 'src');
      const sourceFiles = walkFiles(srcDir).filter((file) => file.endsWith('.ts'));
      const nonIndexFiles = sourceFiles.filter((file) => relative(srcDir, file) !== 'index.ts');
      const indexText = readFileSync(join(srcDir, 'index.ts'), 'utf8');

      expect(nonIndexFiles.length, packageName).toBeGreaterThan(0);
      expect(indexText.split(/\r?\n/).length, packageName).toBeLessThanOrEqual(80);
      for (const forbidden of forbiddenIndexBodies) {
        expect(indexText, `${packageName} index.ts contains ${forbidden}`).not.toContain(forbidden);
      }
    }
  });

  it('keeps product source from importing testing entries', () => {
    const productFiles = walkFiles(packagesRoot)
      .filter((file) => file.endsWith('.ts'))
      .filter((file) => !relative(root, file).split(sep).includes('testing'))
      .filter((file) => !file.endsWith(`${sep}testing.ts`))
      .filter((file) => !file.endsWith(`${sep}create-test-composition.ts`));

    for (const file of productFiles) {
      const text = readFileSync(file, 'utf8');
      expect(text, relative(root, file)).not.toMatch(/from\s+["'][^"']+\/testing["']/);
    }
  });

  it('keeps product package entries from reaching testing implementation files', () => {
    for (const packageName of productizedPackages) {
      const entryFile = join(packagesRoot, packageName, 'src', 'index.ts');
      const reachable = [...reachableInternalFiles(entryFile)].map((file) => relative(root, file).split(sep).join('/'));

      expect(
        reachable.filter((file) => file.includes('/testing/') || file.endsWith('/testing.ts')),
        packageName,
      ).toEqual([]);
    }
  });
});
