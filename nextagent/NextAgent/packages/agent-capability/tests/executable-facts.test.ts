import { describe, expect, it } from 'vitest';
import { prepareBuiltinExecutableFacts } from '../src/builtins/executable-facts.js';

describe('builtin executable facts preparation', () => {
  it('prepares Linux bash facts without executing or mapping sandbox results', () => {
    expect(
      prepareBuiltinExecutableFacts({
        platform: 'LINUX',
        executable: 'bash',
        command: 'cat',
        args: ['logs/alarm.txt'],
        workingDirectoryRef: 'sandbox/session-1',
        allowedWorkingDirectoryRefs: ['sandbox'],
        environment: { LANG: 'C.UTF-8', SECRET_TOKEN: 'hidden' },
        environmentAllowlist: ['LANG', 'SECRET_TOKEN'],
      }),
    ).toEqual({
      executable: 'bash',
      command: 'cat',
      args: ['logs/alarm.txt'],
      workingDirectoryRef: 'sandbox/session-1',
      environment: { LANG: 'C.UTF-8' },
    });
  });

  it('does not silently switch Windows bash to PowerShell', () => {
    expect(() =>
      prepareBuiltinExecutableFacts({
        platform: 'WINDOWS',
        executable: 'bash',
        command: 'bash',
        args: ['script.sh'],
      }),
    ).toThrow(/Bash interpreter is not configured/u);
  });

  it('requires a controlled Python interpreter', () => {
    expect(() =>
      prepareBuiltinExecutableFacts({
        platform: 'LINUX',
        executable: 'python',
        command: 'python',
        args: ['diagnostics/check.py'],
      }),
    ).toThrow(/Python interpreter is not configured/u);
  });

  it('rejects unsupported platforms and working directory escape before sandbox submission', () => {
    expect(() =>
      prepareBuiltinExecutableFacts({
        platform: 'ALL',
        executable: 'bash',
        command: 'cat',
        args: ['logs/alarm.txt'],
      }),
    ).toThrow(/unsupported/u);

    expect(() =>
      prepareBuiltinExecutableFacts({
        platform: 'LINUX',
        executable: 'bash',
        command: 'cat',
        args: ['logs/alarm.txt'],
        workingDirectoryRef: '../outside',
        allowedWorkingDirectoryRefs: ['sandbox'],
      }),
    ).toThrow(/outside allowed roots/u);
  });
});
