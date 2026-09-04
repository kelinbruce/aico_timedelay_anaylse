import { createNextAgentTestApp } from '@nextagent/agent-platform-gateway-local/testing';
import { brand } from '@nextagent/agent-common';
import { createExecutionWorkspaceResolver } from '@nextagent/agent-runtime';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('Edit and Grep PascalCase product path', () => {
  it('executes model Edit and Grep tool calls over HTTP', async () => {
    const workspaceDir = await mkdtemp(join(tmpdir(), 'nextagent-edit-grep-e2e-'));
    const port = await reserveFreePort();
    const relativePath = 'diagnostics/site-a/alarm.txt';
    const originalContent = 'NE=LTE-eNodeB-001\nAlarm=RRU链路异常\nSeverity=minor\n';
    const editedContent = 'NE=LTE-eNodeB-001\nAlarm=RRU链路异常\nSeverity=critical\n';
    const identity = {
      tenantId: brand<string, 'TenantId'>('tenant-1'),
      subjectId: brand<string, 'SubjectId'>('subject-1'),
      displayName: 'Edit Grep product path tester',
    };
    const app = createNextAgentTestApp({
      workspaceDir,
      channelPort: port,
      modelSteps: [
        {
          toolCalls: [
            {
              toolCallId: 'tool-e2e-write-alarm',
              toolName: 'Write',
              arguments: { file_path: `workspace/${relativePath}`, content: originalContent },
            },
          ],
        },
        {
          toolCalls: [
            {
              toolCallId: 'tool-e2e-edit-alarm',
              toolName: 'Edit',
              arguments: { file_path: `workspace/${relativePath}`, old_string: 'Severity=minor', new_string: 'Severity=critical' },
            },
          ],
        },
        {
          toolCalls: [
            {
              toolCallId: 'tool-e2e-grep-alarm',
              toolName: 'Grep',
              arguments: { pattern: 'Severity=critical', path: 'workspace/diagnostics', output_mode: 'content' },
            },
          ],
        },
        { content: '告警级别已更新并检索确认。' },
      ],
    });

    try {
      await app.start();
      const baseUrl = `http://127.0.0.1:${port}`;
      const accepted = await fetch(`${baseUrl}/api/v1/requests`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          inputText: 'Create, edit, and verify the RRU alarm severity.',
          idempotencyKey: `edit-grep-e2e-${crypto.randomUUID()}`,
        }),
      });

      expect(accepted.status).toBe(200);
      const body = (await accepted.json()) as { sessionId: string; runId: string };
      await waitForRunCompleted(app, body.runId, identity);
      const stream = await fetch(`${baseUrl}/api/v1/sessions/${body.sessionId}/stream?lastSeenSequence=0&runId=${body.runId}`);
      expect(stream.status).toBe(200);
      const streamBody = await stream.text();

      expect(streamBody).toContain('tool-e2e-write-alarm');
      expect(streamBody).toContain('tool-e2e-edit-alarm');
      expect(streamBody).toContain('tool-e2e-grep-alarm');
      expect(streamBody.match(/event: CAPABILITY_COMPLETED/g)).toHaveLength(3);
      expect(streamBody).toContain('告警级别已更新并检索确认。');

      const assembly = await app.assemblyRegistry.require(brand<string, 'AgentId'>('default-agent'), brand<string, 'AgentVersion'>('v1'));
      const executionWorkspace = createExecutionWorkspaceResolver().resolve({
        runtimeWorkspaceRoot: app.systemConfig.paths.runtimeWorkspaceRoot,
        sharedDataRoot: app.systemConfig.paths.sharedDataRoot,
        workspacePolicy: assembly.workspacePolicy,
        agentId: brand<string, 'AgentId'>('default-agent'),
        tenantId: brand<string, 'TenantId'>('tenant-1'),
        subjectId: brand<string, 'SubjectId'>('subject-1'),
        sessionId: brand<string, 'SessionId'>(body.sessionId),
        runId: brand<string, 'RequestRunId'>(body.runId),
        deploymentMode: 'LOCAL',
      });
      const workspaceRoot = executionWorkspace.roots.find((root) => root.kind === 'workspace')?.physicalPath;
      expect(workspaceRoot).toBeDefined();
      expect(await readFile(join(workspaceRoot!, ...relativePath.split('/')), 'utf8')).toBe(editedContent);
    } finally {
      await app.close();
      await rm(workspaceDir, { recursive: true, force: true });
    }
  });
});

async function waitForRunCompleted(
  app: ReturnType<typeof createNextAgentTestApp>,
  runId: string,
  identity: { tenantId: ReturnType<typeof brand<string, 'TenantId'>>; subjectId: ReturnType<typeof brand<string, 'SubjectId'>>; displayName: string },
  timeoutMs = 5_000,
) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const run = await app.gateway.requestRuns.loadRun({
      tenantId: identity.tenantId,
      subjectId: identity.subjectId,
      agentId: brand<string, 'AgentId'>('default-agent'),
      runId: brand<string, 'RequestRunId'>(runId),
    });
    if (run?.status === 'COMPLETED' && run.terminalCommitState === 'COMMITTED') {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error('Timed out waiting for run completion.');
}
async function reserveFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (typeof address !== 'object' || address === null) {
        server.close(() => reject(new Error('Unable to reserve a TCP port.')));
        return;
      }
      const port = address.port;
      server.close((error) => (error === undefined ? resolve(port) : reject(error)));
    });
  });
}
