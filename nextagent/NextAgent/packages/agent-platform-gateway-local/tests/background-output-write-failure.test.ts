import { brand } from '@nextagent/agent-common';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const simulatedWriteFailure = vi.hoisted(() => ({ enabled: false }));

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    writeFileSync: (...args: Parameters<typeof actual.writeFileSync>) => {
      if (simulatedWriteFailure.enabled && typeof args[0] === 'number') {
        throw new Error('simulated background output write failure');
      }
      return actual.writeFileSync(...args);
    },
  };
});

describe('background sandbox output write failure', () => {
  afterEach(() => {
    simulatedWriteFailure.enabled = false;
  });

  it('fails the task without escaping the asynchronous output callback', async () => {
    vi.resetModules();
    const { createRestrictedLocalSandboxGateway } = await import('../src/sandbox/restricted-local-sandbox.js');
    const root = mkdtempSync(join(tmpdir(), 'nextagent-sandbox-write-failure-'));
    writeFileSync(join(root, 'writer.js'), "process.stdout.write('output');");
    const gateway = createRestrictedLocalSandboxGateway({
      workspaceDir: root,
      executableOverrides: { python: process.execPath },
    });

    simulatedWriteFailure.enabled = true;
    const started = await gateway.startBackground({
      executionId: 'sandbox-write-failure-test',
      requestRunId: brand<string, 'RequestRunId'>('run-sandbox-write-failure'),
      tenantId: brand<string, 'TenantId'>('tenant-sandbox'),
      subjectId: brand<string, 'SubjectId'>('subject-sandbox'),
      executable: 'python',
      command: 'python',
      args: ['writer.js'],
      filesystem: {
        defaultCwd: root,
        roots: [{ kind: 'workspace', logicalPath: 'workspace', physicalPath: root, access: 'readWrite' }],
      },
      environment: {},
      timeoutMs: 5000,
      stdoutLimitBytes: 1024,
      stderrLimitBytes: 1024,
    });

    expect('handle' in started).toBe(true);
    if (!('handle' in started)) {
      return;
    }
    await expect(started.completion).resolves.toMatchObject({ status: 'FAILED', exitCode: -1 });
  });
});
