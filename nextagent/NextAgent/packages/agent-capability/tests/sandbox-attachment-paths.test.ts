import { brand } from '@nextagent/agent-common';
import { createWorkspaceBackedSandboxExecutionPort, createWorkspaceFilePort, type ToolExecutionContext } from '@nextagent/agent-capability';
import type { AgentWorkspacePolicy } from '@nextagent/agent-contracts/agent-assembly';
import type { SandboxGatewayPort } from '@nextagent/agent-contracts/gateway';
import { createExecutionWorkspaceResolver } from '@nextagent/agent-runtime';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

describe('sandbox attachment paths', () => {
  it('passes only materialized paths through FILE_PATHS', async () => {
    const execute = vi.fn(async (..._args: Parameters<SandboxGatewayPort['execute']>) => ({
      stdout: '',
      stderr: '',
      exitCode: 0,
      stdoutTruncated: false,
      stderrTruncated: false,
      timedOut: false,
    }));
    const sandbox = createWorkspaceBackedSandboxExecutionPort({
      gateway: { execute } as unknown as SandboxGatewayPort,
      workspaceFiles: createWorkspaceFilePort({ workspaceDir: process.cwd() }),
      riskPolicyEvaluator: { evaluate: async () => ({ outcome: 'ALLOW', reasonCode: 'ALLOW' }) },
    });
    const attachmentPath = 'C:/runtime/workspaces/run-1/temp/attachments/attachment-1/report.md';

    await sandbox.runShell(
      { command: 'cat', args: ['report.md'], timeoutMs: 1_000, stdoutLimitBytes: 1_024, stderrLimitBytes: 1_024 },
      toolContext(attachmentPath),
      undefined,
    );

    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({
        environment: expect.objectContaining({ FILE_PATHS: JSON.stringify([attachmentPath]) }),
      }),
      undefined,
    );
    expect(JSON.stringify(execute.mock.calls[0]?.[0])).not.toContain('storageRef');
  });

  it('passes a committed Skill projection to a later run explicit Python script path', async () => {
    const runtimeWorkspaceRoot = await mkdtemp(join(tmpdir(), 'nextagent-sandbox-scope-authority-'));
    try {
      const workspaceFiles = createWorkspaceFilePort({
        runtimeWorkspaceRoot,
        executionWorkspaceResolver: createExecutionWorkspaceResolver(),
        deploymentMode: 'LOCAL',
        workspacePolicyProvider: {
          async require() {
            return defaultPolicy();
          },
        },
        writeDirectories: ['.'],
      });
      const firstRun = scopeAuthorityContext();
      const laterRun = {
        ...firstRun,
        sessionId: brand<string, 'SessionId'>('session-sandbox-authority-later'),
        runId: brand<string, 'RequestRunId'>('run-sandbox-authority-later'),
      };
      const script = new TextEncoder().encode("print('scope-ok')\n");
      const projection = await workspaceFiles.projectSkillResources(
        {
          providerId: 'builtin-skills',
          skillName: 'diagnosis',
          skillVersion: '1.0.0',
          async listResources() {
            return [{ relativePath: 'scripts/check.py', kind: 'script', sizeBytes: script.byteLength }];
          },
          async readResource(resource) {
            return { ...resource, contentStream: streamBytes(script) };
          },
        },
        firstRun,
      );
      const execute = vi.fn<SandboxGatewayPort['execute']>(async (request) => ({
        executionId: request.executionId,
        exitCode: 0,
        stdout: 'scope-ok',
        stderr: '',
        stdoutTruncated: false,
        stderrTruncated: false,
        timedOut: false,
        durationMs: 1,
      }));
      const sandbox = createWorkspaceBackedSandboxExecutionPort({
        gateway: { execute },
        workspaceFiles,
        riskPolicyEvaluator: {
          evaluate: async () => ({ outcome: 'ALLOW', reasonCode: 'ALLOW' }),
        },
      });

      await expect(
        sandbox.runPython(
          {
            command: 'python',
            args: [`${projection.rootRelativePath}scripts/check.py`],
            timeoutMs: 1_000,
            stdoutLimitBytes: 1_024,
            stderrLimitBytes: 1_024,
          },
          laterRun,
        ),
      ).resolves.toMatchObject({ exitCode: 0, stdout: 'scope-ok' });
      expect(execute).toHaveBeenCalledWith(
        expect.objectContaining({
          filesystem: expect.objectContaining({
            roots: expect.arrayContaining([
              expect.objectContaining({
                kind: 'systemResources',
                logicalPath: projection.rootRelativePath.slice(0, -1),
                access: 'read',
              }),
            ]),
          }),
        }),
        undefined,
      );
    } finally {
      await rm(runtimeWorkspaceRoot, { recursive: true, force: true });
    }
  });
});

function toolContext(attachmentPath: string): ToolExecutionContext {
  return {
    identityContext: {
      tenantId: brand<string, 'TenantId'>('tenant-sandbox-attachments'),
      subjectId: brand<string, 'SubjectId'>('subject-sandbox-attachments'),
      displayName: 'Sandbox attachment test',
    },
    agentId: brand<string, 'AgentId'>('agent-sandbox-attachments'),
    agentVersion: brand<string, 'AgentVersion'>('v1'),
    sessionId: brand<string, 'SessionId'>('session-sandbox-attachments'),
    requestId: brand<string, 'MessageId'>('request-sandbox-attachments'),
    runId: brand<string, 'RequestRunId'>('run-sandbox-attachments'),
    requestContextId: brand<string, 'RequestContextId'>('context-sandbox-attachments'),
    stepId: 'turn-1',
    toolCallId: 'tool-1',
    timeoutMs: 1_000,
    attachmentPaths: [attachmentPath],
  };
}

function scopeAuthorityContext(): ToolExecutionContext {
  return {
    identityContext: {
      tenantId: brand<string, 'TenantId'>('tenant-sandbox-authority'),
      subjectId: brand<string, 'SubjectId'>('subject-sandbox-authority'),
      displayName: 'Sandbox authority test',
    },
    agentId: brand<string, 'AgentId'>('agent-sandbox-authority'),
    agentVersion: brand<string, 'AgentVersion'>('v1'),
    sessionId: brand<string, 'SessionId'>('session-sandbox-authority'),
    requestId: brand<string, 'MessageId'>('request-sandbox-authority'),
    runId: brand<string, 'RequestRunId'>('run-sandbox-authority'),
    requestContextId: brand<string, 'RequestContextId'>('context-sandbox-authority'),
    stepId: 'turn-1',
    toolCallId: 'tool-python-1',
    timeoutMs: 1_000,
  };
}

function defaultPolicy(): AgentWorkspacePolicy {
  return {
    schemaVersion: 'nextagent.agent-workspace-policy.v1',
    isolationMode: 'subject',
    roots: [
      { kind: 'workspace', logicalPath: 'workspace', access: 'readWrite' },
      { kind: 'systemResources', logicalPath: '.nextagent', access: 'read' },
      { kind: 'temp', logicalPath: 'temp', access: 'readWrite' },
    ],
  };
}

async function* streamBytes(bytes: Uint8Array): AsyncIterable<Uint8Array> {
  yield bytes;
}
