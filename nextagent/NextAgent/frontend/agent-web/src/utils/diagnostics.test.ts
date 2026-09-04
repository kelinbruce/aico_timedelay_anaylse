import { readdirSync, readFileSync, type Dirent } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
});

describe('frontend diagnostics reporter', () => {
  it.each([
    { report: 'reportDebug', level: 'debug' },
    { report: 'reportWarning', level: 'warn' },
    { report: 'reportError', level: 'error' },
  ] as const)('preserves message and details for $level', async ({ report, level }) => {
    const consoleSpy = vi.spyOn(console, level).mockImplementation(() => undefined);
    const diagnostics = await import('./diagnostics.ts');

    diagnostics[report]('diagnostic message', { reason: 'invalid-envelope' }, new Error('render failed'));

    expect(consoleSpy).toHaveBeenCalledTimes(1);
    expect(consoleSpy).toHaveBeenCalledWith('diagnostic message', { reason: 'invalid-envelope' }, expect.any(Error));
  });

  it('keeps browser production source from calling console directly outside the diagnostics owner', () => {
    const sourceRoot = path.resolve(process.cwd(), 'src');
    const diagnosticsOwner = path.join(sourceRoot, 'utils', 'diagnostics.ts');
    const consoleCallPattern = /\bconsole\.(?:log|debug|info|warn|error)\s*\(/;
    const offenders: string[] = [];

    const collectFiles = (directory: string): void => {
      for (const entry of readdirSync(directory, { withFileTypes: true }) as Dirent[]) {
        const entryPath = path.join(directory, entry.name);
        if (entry.isDirectory()) {
          collectFiles(entryPath);
          continue;
        }
        if (!/\.(?:ts|tsx)$/.test(entry.name) || entry.name.includes('.test.')) {
          continue;
        }
        if (entryPath === diagnosticsOwner) {
          continue;
        }
        if (consoleCallPattern.test(readFileSync(entryPath, 'utf8'))) {
          offenders.push(path.relative(sourceRoot, entryPath));
        }
      }
    };

    collectFiles(sourceRoot);

    expect(offenders).toEqual([]);
  });
});
