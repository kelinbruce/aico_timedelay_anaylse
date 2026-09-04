import { brand } from '@nextagent/agent-common';
import { createDenyByDefaultSandboxGateway, type DenyByDefaultSandboxReason } from '@nextagent/agent-platform-gateway-local';
import { describe, expect, it } from 'vitest';

describe('deny-by-default sandbox gateway', () => {
  it.each([
    ['disabled', 'SANDBOX_DISABLED'],
    ['unconfigured', 'SANDBOX_UNCONFIGURED'],
    ['unsupported-platform', 'SANDBOX_UNSUPPORTED_PLATFORM'],
    ['remote-unavailable', 'SANDBOX_REMOTE_UNAVAILABLE'],
    ['prerequisite-missing', 'SANDBOX_PREREQUISITE_MISSING'],
  ] satisfies ReadonlyArray<[DenyByDefaultSandboxReason, string]>)('returns a stable safe result for %s', async (reason, code) => {
    const gateway = createDenyByDefaultSandboxGateway({ reason });

    const result = await gateway.execute(
      request({
        command: 'python',
        args: ['secret.py'],
        environment: { SECRET_TOKEN: 'must-not-leak' },
      }),
    );

    expect(result).toMatchObject({
      executionId: 'sandbox-deny-test',
      stdout: '',
      stderr: '',
      stdoutTruncated: false,
      stderrTruncated: false,
      timedOut: false,
      safeError: {
        code,
        category: 'UNAVAILABLE',
        safeDetails: { reason },
      },
    });
    expect(result).not.toHaveProperty('exitCode');
    expect(JSON.stringify(result)).not.toContain('must-not-leak');
    expect(JSON.stringify(result)).not.toContain('secret.py');
  });

  it('fails closed for already canceled requests without host fallback', async () => {
    const gateway = createDenyByDefaultSandboxGateway({ reason: 'unconfigured' });
    const controller = new AbortController();
    controller.abort();

    await expect(gateway.execute(request(), controller.signal)).resolves.toMatchObject({
      stdout: '',
      stderr: '',
      timedOut: false,
      safeError: {
        code: 'SANDBOX_EXECUTION_CANCELED',
        category: 'CANCELED',
      },
    });
  });

  it.each(['disabled', 'remote-unavailable'] satisfies readonly DenyByDefaultSandboxReason[])(
    'rejects background start with a safe error for %s',
    async (reason) => {
      const gateway = createDenyByDefaultSandboxGateway({ reason });
      const onComplete = () => {};

      const result = await gateway.startBackground!(request({ command: 'npm', args: ['run', 'build'] }));

      expect(result).toMatchObject({
        code: 'SANDBOX_BACKGROUND_UNAVAILABLE',
        message: 'Background sandbox execution is unavailable in this deployment.',
        category: 'UNAVAILABLE',
        retryable: false,
        safeDetails: { reason },
      });
    },
  );
});

function request(overrides: Partial<Parameters<ReturnType<typeof createDenyByDefaultSandboxGateway>['execute']>[0]> = {}) {
  return {
    executionId: 'sandbox-deny-test',
    requestRunId: brand<string, 'RequestRunId'>('run-sandbox-deny'),
    tenantId: brand<string, 'TenantId'>('tenant-sandbox-deny'),
    subjectId: brand<string, 'SubjectId'>('subject-sandbox-deny'),
    executable: 'python' as const,
    command: 'python',
    args: [],
    filesystem: { defaultCwd: process.cwd(), roots: [] },
    environment: {},
    timeoutMs: 1000,
    stdoutLimitBytes: 1024,
    stderrLimitBytes: 1024,
    ...overrides,
  };
}
