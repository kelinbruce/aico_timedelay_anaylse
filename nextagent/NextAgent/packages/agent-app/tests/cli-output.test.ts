import { afterEach, describe, expect, it, vi } from 'vitest';
import { writeLocalRuntimeReadyNotice } from '../src/local-runtime-package/cli-output.js';

describe('local runtime CLI output', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each([
    ['::', 'http://localhost:3000'],
    ['::1', 'http://[::1]:3000'],
    ['0.0.0.0', 'http://localhost:3000'],
  ] as const)('prints a connectable login URL for listener host %s', (host, expectedUrl) => {
    const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    writeLocalRuntimeReadyNotice({ host, port: 3000 });

    expect(write).toHaveBeenCalledOnce();
    expect(String(write.mock.calls[0]?.[0])).toContain(expectedUrl);
  });
});
