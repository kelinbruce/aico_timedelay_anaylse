import { describe, expect, it } from 'vitest';
import { runFrameworkProcess } from './helpers/framework-process.js';

describe('system integration framework process', () => {
  it('captures framework output and reports a nonzero exit', async () => {
    const result = await runFrameworkProcess({
      command: process.execPath,
      args: ['-e', "process.stdout.write('safe-out'); process.stderr.write('safe-error'); process.exitCode = 3;"],
      cwd: process.cwd(),
      environment: process.env,
      timeoutMs: 5_000,
      registerChild: () => undefined,
    });

    expect(result).toMatchObject({
      exitCode: 3,
      timedOut: false,
      outputOverflow: false,
      stdout: 'safe-out',
      stderr: 'safe-error',
    });
  });

  it('terminates a framework process when its deadline expires', async () => {
    const result = await runFrameworkProcess({
      command: process.execPath,
      args: ['-e', 'setInterval(() => undefined, 1_000);'],
      cwd: process.cwd(),
      environment: process.env,
      timeoutMs: 25,
      registerChild: () => undefined,
    });

    expect(result.timedOut).toBe(true);
    expect(result.exitCode).toBeNull();
  });
});
