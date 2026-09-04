import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { SYSTEM_INTEGRATION_CASES } from './case-manifest.js';
import { hashDirectoryTree } from './helpers/external-consumer-root.js';
import { preflightSystemIntegrationInputs, unavailableResultsForPreflight } from './helpers/preflight.js';

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

function createCandidateRoot(): string {
  const root = mkdtempSync(resolve(tmpdir(), 'testclaw-candidate-'));
  roots.push(root);
  for (const directory of ['bin', 'config', 'backend', 'node_modules']) {
    mkdirSync(resolve(root, directory), { recursive: true });
  }
  writeFileSync(resolve(root, 'package.json'), '{"name":"candidate"}', 'utf8');
  return root;
}

function createExternalRoot(): string {
  const root = mkdtempSync(resolve(tmpdir(), 'testclaw-external-'));
  roots.push(root);
  for (const packageName of ['agent-remote-deployment', 'agent-platform-gateway-remote']) {
    const packageRoot = resolve(root, 'node_modules', '@nextagent', packageName);
    mkdirSync(packageRoot, { recursive: true });
    writeFileSync(resolve(packageRoot, 'package.json'), JSON.stringify({ name: `@nextagent/${packageName}` }), 'utf8');
  }
  const testHostRoot = resolve(root, 'dist', 'dev', 'agent-web-test-hosts');
  mkdirSync(resolve(testHostRoot, 'dist', 'local'), { recursive: true });
  writeFileSync(resolve(testHostRoot, 'package.json'), '{"name":"@nextagent/agent-web-test-hosts"}', 'utf8');
  writeFileSync(resolve(testHostRoot, 'hosting.js'), 'export {};', 'utf8');
  writeFileSync(resolve(testHostRoot, 'dist', 'local', 'index.html'), '<!doctype html>', 'utf8');
  return root;
}

describe('system integration input preflight', () => {
  it('reports candidate-dependent cases unavailable when candidate root is missing', () => {
    const result = preflightSystemIntegrationInputs({
      candidateRoot: resolve(tmpdir(), 'missing-testclaw-candidate'),
      externalPackagesRoot: createExternalRoot(),
    });

    expect(result.availableRoots).toEqual(['external-packages']);
    expect(result.unavailableRoots).toEqual(['candidate']);
    const unavailable = unavailableResultsForPreflight(SYSTEM_INTEGRATION_CASES, result);
    expect(unavailable).toHaveLength(118);
    expect(unavailable.every((entry) => entry.result === 'UNAVAILABLE')).toBe(true);
  });

  it('reports external integration cases unavailable when external packages root is missing', () => {
    const result = preflightSystemIntegrationInputs({
      candidateRoot: createCandidateRoot(),
      externalPackagesRoot: resolve(tmpdir(), 'missing-testclaw-external'),
    });

    expect(result.availableRoots).toEqual(['candidate']);
    expect(result.unavailableRoots).toEqual(['external-packages']);
    const unavailable = unavailableResultsForPreflight(SYSTEM_INTEGRATION_CASES, result);
    expect(unavailable).toHaveLength(9);
    expect(unavailable.every((entry) => entry.failurePhase === 'preflight')).toBe(true);
  });

  it('accepts complete candidate and external package roots', () => {
    const result = preflightSystemIntegrationInputs({
      candidateRoot: createCandidateRoot(),
      externalPackagesRoot: createExternalRoot(),
    });

    expect(result.availableRoots).toEqual(['candidate', 'external-packages']);
    expect(result.unavailableRoots).toEqual([]);
  });

  it('does not modify either input tree', async () => {
    const candidateRoot = createCandidateRoot();
    const externalPackagesRoot = createExternalRoot();
    const before = await Promise.all([hashDirectoryTree(candidateRoot), hashDirectoryTree(externalPackagesRoot)]);

    preflightSystemIntegrationInputs({ candidateRoot, externalPackagesRoot });

    expect(await Promise.all([hashDirectoryTree(candidateRoot), hashDirectoryTree(externalPackagesRoot)])).toEqual(before);
  });
});
