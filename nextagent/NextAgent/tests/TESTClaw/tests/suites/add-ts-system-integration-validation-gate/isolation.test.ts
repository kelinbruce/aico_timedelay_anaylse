import { spawn } from 'node:child_process';
import { readFile, stat, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createRunScope, type SystemIntegrationRunScope, withRunScope } from './helpers/run-scope.js';

describe('system integration run isolation', () => {
  it('creates distinct run roots and keeps restricted diagnostics outside evidence', async () => {
    const base = path.join(tmpdir(), 'testclaw-system-integration-isolation');
    const first = await createRunScope({
      outputBase: path.join(base, 'output'),
      tempBase: path.join(base, 'temp'),
    });
    const second = await createRunScope({
      outputBase: path.join(base, 'output'),
      tempBase: path.join(base, 'temp'),
    });

    try {
      expect(first.runId).not.toBe(second.runId);
      expect(first.tempRoot).not.toBe(second.tempRoot);
      expect(first.evidenceRoot).not.toBe(second.evidenceRoot);
      expect(path.relative(first.evidenceRoot, first.restrictedDiagnosticRoot)).toMatch(/^\.\./);
      expect(first.toEvidenceRef(path.join(first.evidenceRoot, 'safe.json'))).toBe('safe.json');
      expect(() => first.toEvidenceRef(path.join(first.restrictedDiagnosticRoot, 'raw.log'))).toThrow('outside the evidence root');
    } finally {
      await first.cleanup();
      await second.cleanup();
    }
  });

  it('releases listeners and child processes and removes temporary state on cleanup', async () => {
    const scope = await createRunScope();
    const server = createServer();
    const port = await scope.listenOnRandomPort(server);
    const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
      stdio: 'ignore',
      windowsHide: true,
    });
    scope.registerChild(child);
    await writeFile(path.join(scope.restrictedDiagnosticRoot, 'raw.log'), 'restricted', 'utf8');
    await writeFile(path.join(scope.evidenceRoot, 'safe.json'), '{}', 'utf8');

    await scope.cleanup();
    await scope.cleanup();

    await expect(stat(scope.tempRoot)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(stat(scope.restrictedDiagnosticRoot)).rejects.toMatchObject({ code: 'ENOENT' });
    expect((await stat(scope.evidenceRoot)).isDirectory()).toBe(true);
    expect(child.exitCode ?? child.signalCode).not.toBeNull();

    const rebound = createServer();
    await new Promise<void>((resolve, reject) => {
      rebound.once('error', reject);
      rebound.listen(port, '127.0.0.1', () => resolve());
    });
    await new Promise<void>((resolve, reject) => {
      rebound.close((error) => (error ? reject(error) : resolve()));
    });
  });

  it('runs cleanup in finally when a validation action fails', async () => {
    let failedScope: SystemIntegrationRunScope | undefined;
    let childExit: Promise<void> | undefined;

    await expect(
      withRunScope({}, async (scope) => {
        failedScope = scope;
        const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
          stdio: 'ignore',
          windowsHide: true,
        });
        childExit = new Promise<void>((resolve) => child.once('exit', () => resolve()));
        scope.registerChild(child);
        throw new Error('expected validation failure');
      }),
    ).rejects.toThrow('expected validation failure');

    expect(failedScope).toBeDefined();
    await expect(stat(failedScope!.tempRoot)).rejects.toMatchObject({ code: 'ENOENT' });
    expect((await stat(failedScope!.evidenceRoot)).isDirectory()).toBe(true);
    await expect(childExit).resolves.toBeUndefined();
  });

  it('does not reuse prior results or restricted diagnostics across consecutive runs', async () => {
    const base = path.join(tmpdir(), 'testclaw-system-integration-consecutive');
    const first = await createRunScope({
      outputBase: path.join(base, 'output'),
      tempBase: path.join(base, 'temp'),
    });
    await writeFile(path.join(first.evidenceRoot, 'report.json'), '{"run":"first"}', 'utf8');
    await writeFile(path.join(first.restrictedDiagnosticRoot, 'raw.log'), 'first-secret', 'utf8');
    await first.cleanup();

    const second = await createRunScope({
      outputBase: path.join(base, 'output'),
      tempBase: path.join(base, 'temp'),
    });
    try {
      expect(second.runId).not.toBe(first.runId);
      await expect(readFile(path.join(second.evidenceRoot, 'report.json'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
      await expect(readFile(path.join(second.restrictedDiagnosticRoot, 'raw.log'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
      expect(await readFile(path.join(first.evidenceRoot, 'report.json'), 'utf8')).toBe('{"run":"first"}');
    } finally {
      await second.cleanup();
    }
  });
});
