import { createNextAgentTestApp } from '@nextagent/agent-platform-gateway-local/testing';
import { brand } from '@nextagent/agent-common';
import { createExecutionWorkspaceResolver } from '@nextagent/agent-runtime';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('Write product path', () => {
  it('executes a model Write tool call over HTTP and creates the file in the default Agent workspace', async () => {
    const workspaceDir = await mkdtemp(join(tmpdir(), 'nextagent-write-e2e-'));
    const port = await reserveFreePort();
    const toolCallId = 'tool-write-diagnostic';
    const relativePath = 'diagnostics/generated/alarm-summary.txt';
    const content = 'NE=LTE-eNodeB-001\nAlarm=RRU链路异常\n';
    const identity = {
      tenantId: brand<string, 'TenantId'>('tenant-1'),
      subjectId: brand<string, 'SubjectId'>('subject-1'),
      displayName: 'Write product path tester',
    };
    const app = createNextAgentTestApp({
      workspaceDir,
      channelPort: port,
      modelSteps: [
        {
          toolCalls: [
            {
              toolCallId,
              toolName: 'Write',
              arguments: { file_path: `workspace/${relativePath}`, content },
            },
          ],
        },
        { content: '诊断文件已生成。' },
      ],
    });

    try {
      await app.start();
      const baseUrl = `http://127.0.0.1:${port}`;
      const accepted = await fetch(`${baseUrl}/api/v1/requests`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          inputText: '生成 RRU链路异常 诊断摘要。',
          idempotencyKey: `write-e2e-${crypto.randomUUID()}`,
        }),
      });

      expect(accepted.status).toBe(200);
      const body = (await accepted.json()) as { sessionId: string; runId: string };
      await waitForRunCompleted(app, body.runId, identity);
      const stream = await fetch(`${baseUrl}/api/v1/sessions/${body.sessionId}/stream?lastSeenSequence=0&runId=${body.runId}`);
      expect(stream.status).toBe(200);
      const streamBody = await stream.text();

      expect(streamBody).toContain('event: CAPABILITY_STARTED');
      expect(streamBody).toContain('event: CAPABILITY_COMPLETED');
      expect(streamBody).toContain('event: REQUEST_COMPLETED');
      expect(streamBody).toContain(toolCallId);
      expect(streamBody).toContain('"status":"SUCCEEDED"');
      expect(streamBody).toContain('CAPABILITY_RESULT_FILE_CREATED');
      expect(streamBody).not.toContain(content);
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
      expect(await readFile(join(workspaceRoot!, ...relativePath.split('/')), 'utf8')).toBe(content);

      const conversation = await fetch(`${baseUrl}/api/v1/sessions/${body.sessionId}/conversation?limit=10`);
      expect(conversation.status).toBe(200);
      const history = (await conversation.json()) as { items: Array<{ role: string; content: string }> };
      expect(history.items.map((item) => item.role)).toEqual(['USER', 'ASSISTANT']);
      expect(history.items.at(-1)?.content).toBe('诊断文件已生成。');
    } finally {
      await app.close();
      await rm(workspaceDir, { recursive: true, force: true });
    }
  });
});

async function waitForRunCompleted(
  app: ReturnType<typeof createNextAgentTestApp>,
  runId: string,
  identity: { tenantId: ReturnType<typeof brand<string, 'TenantId'>>; subjectId: ReturnType<typeof brand<string, 'SubjectId'>> },
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
