import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { validateSystemIntegrationReport } from './helpers/report.js';

const cleanupRoots: string[] = [];
const testclawRoot = path.resolve(import.meta.dirname, '../../..');

afterEach(async () => {
  await Promise.all(cleanupRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('system integration gate runner preflight', () => {
  it.each([
    { missing: 'candidate', unavailableCount: 119 },
    { missing: 'external-packages', unavailableCount: 10 },
  ] as const)('reports affected cases UNAVAILABLE and exits nonzero when $missing is absent', async ({ missing, unavailableCount }) => {
    const fixtureRoot = await mkdtemp(path.join(tmpdir(), 'testclaw-runner-'));
    cleanupRoots.push(fixtureRoot);
    const outputRoot = path.join(fixtureRoot, 'output');
    const candidateRoot =
      missing === 'candidate' ? path.join(fixtureRoot, 'missing-candidate') : await createCandidate(path.join(fixtureRoot, 'candidate'));
    const externalPackagesRoot =
      missing === 'external-packages' ? path.join(fixtureRoot, 'missing-external') : await createExternalPackages(path.join(fixtureRoot, 'external'));

    const execution = await runGate({
      NEXTAGENT_PACKAGE_ROOT: candidateRoot,
      NEXTAGENT_EXTERNAL_PACKAGES_ROOT: externalPackagesRoot,
      TESTCLAW_SYSTEM_INTEGRATION_OUTPUT_ROOT: outputRoot,
    });

    expect(execution.code).toBe(1);
    expect(execution.stderr).toBe('');
    const summary = JSON.parse(execution.stdout) as {
      runId: string;
      status: string;
      reportRef: string;
    };
    expect(summary.status).toBe('UNAVAILABLE');
    expect(summary.reportRef).toBe(`system-integration/${summary.runId}/report.json`);
    const report = validateSystemIntegrationReport(JSON.parse(await readFile(path.join(outputRoot, summary.runId, 'report.json'), 'utf8')));
    expect(report.cases.filter((entry) => entry.result === 'UNAVAILABLE')).toHaveLength(unavailableCount);
    expect(report.cases).toHaveLength(122);
  });
});

async function createCandidate(root: string): Promise<string> {
  await Promise.all(['bin', 'config', 'backend', 'node_modules'].map((directory) => mkdir(path.join(root, directory), { recursive: true })));
  await writeFile(path.join(root, 'package.json'), '{"name":"candidate"}', 'utf8');
  return root;
}

async function createExternalPackages(root: string): Promise<string> {
  for (const packageName of ['agent-remote-deployment', 'agent-platform-gateway-remote']) {
    const packageRoot = path.join(root, 'node_modules', '@nextagent', packageName);
    await mkdir(packageRoot, { recursive: true });
    await writeFile(path.join(packageRoot, 'package.json'), JSON.stringify({ name: `@nextagent/${packageName}` }), 'utf8');
  }
  const testHostRoot = path.join(root, 'dist', 'dev', 'agent-web-test-hosts');
  await mkdir(path.join(testHostRoot, 'dist', 'local'), { recursive: true });
  await writeFile(path.join(testHostRoot, 'package.json'), '{"name":"@nextagent/agent-web-test-hosts"}', 'utf8');
  await writeFile(path.join(testHostRoot, 'hosting.js'), 'export {};', 'utf8');
  await writeFile(path.join(testHostRoot, 'dist', 'local', 'index.html'), '<!doctype html>', 'utf8');
  return root;
}

async function runGate(environment: Record<string, string>): Promise<{
  readonly code: number | null;
  readonly stdout: string;
  readonly stderr: string;
}> {
  const child = spawn(process.execPath, ['scripts/run-system-integration-gate.mjs'], {
    cwd: testclawRoot,
    env: { ...process.env, ...environment },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  const stdout: Buffer[] = [];
  const stderr: Buffer[] = [];
  child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk));
  child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk));
  const code = await new Promise<number | null>((resolve) => child.once('exit', resolve));
  return {
    code,
    stdout: Buffer.concat(stdout).toString('utf8').trim(),
    stderr: Buffer.concat(stderr).toString('utf8').trim(),
  };
}
