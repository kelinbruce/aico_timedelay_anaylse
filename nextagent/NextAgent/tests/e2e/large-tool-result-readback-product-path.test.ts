import { createNextAgentTestApp } from '@nextagent/agent-platform-gateway-local/testing';
import { createWorkspaceFilePort } from '@nextagent/agent-capability';
import { brand } from '@nextagent/agent-common';
import { createExecutionWorkspaceResolver } from '@nextagent/agent-runtime';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('Large tool result readback product path', () => {
  it('starts the HTTP service and pages back an externalized oversized tool result', async () => {
    const workspaceDir = await mkdtemp(join(tmpdir(), 'nextagent-large-result-e2e-'));
    const port = await reserveFreePort();
    const baseUrl = `http://127.0.0.1:${port}`;
    const identity = {
      tenantId: brand<string, 'TenantId'>('tenant-1'),
      subjectId: brand<string, 'SubjectId'>('subject-1'),
      displayName: 'Large result readback tester',
    };
    const marker = 'TAIL_MARKER_LARGE_RESULT_READBACK_OK';
    const app = createNextAgentTestApp({
      workspaceDir,
      channelPort: port,
      identity,
      modelSteps: [
        {
          toolCalls: [
            {
              toolCallId: 'tool-large-python-result',
              toolName: 'Python',
              arguments: {
                code: ['for i in range(520):', "    print(f'large-result-line-{i:03d}:' + 'x' * 96)", `print('${marker}')`].join('\n'),
                timeout_ms: 10_000,
              },
            },
          ],
        },
        { content: 'Large result externalized; readback verified.' },
      ],
    });

    try {
      await app.start();
      // This line is intentionally visible in the test output when run directly.
      console.log(`large-result-readback service=${baseUrl}`);

      const accepted = await fetch(`${baseUrl}/api/v1/requests`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          inputText: 'Run the diagnostic generator and make the large result available for paged readback.',
          idempotencyKey: `large-result-readback-${crypto.randomUUID()}`,
        }),
      });
      expect(accepted.status).toBe(200);
      const acceptedBody = (await accepted.json()) as { readonly sessionId: string; readonly runId: string };
      await waitForRunCompleted(app, acceptedBody.runId, identity);

      const messages = await app.gateway.messages.listMessages({
        tenantId: identity.tenantId,
        subjectId: identity.subjectId,
        agentId: brand<string, 'AgentId'>('default-agent'),
        sessionId: brand<string, 'SessionId'>(acceptedBody.sessionId),
        includeHidden: true,
        includeCapabilityResults: true,
        limit: 20,
      });
      const capabilityResult = messages.items.find((message) => message.role === 'CAPABILITY_RESULT');
      expect(capabilityResult).toBeDefined();
      expect(capabilityResult!.content).toContain('<persisted-content>');
      expect(capabilityResult!.content).toContain('Read tool');
      expect(capabilityResult!.content).not.toContain(marker);

      const replacement = capabilityResult!.metadata['replacement'] as {
        readonly contentRef?: { readonly refId?: string; readonly refType?: string };
      };
      const filePath = replacement.contentRef?.refId;
      expect(replacement.contentRef?.refType).toBe('CAPABILITY_RESULT');
      expect(filePath).toMatch(/^tool-results\/[a-f0-9]+\.txt$/u);
      if (filePath === undefined) {
        throw new Error('Expected externalized file_path.');
      }
      console.log(`large-result-readback file_path=${filePath}`);

      const assembly = await app.assemblyRegistry.require(brand<string, 'AgentId'>('default-agent'), brand<string, 'AgentVersion'>('v1'));
      const readPort = createWorkspaceFilePort({
        runtimeWorkspaceRoot: app.systemConfig.paths.runtimeWorkspaceRoot,
        sharedDataRoot: app.systemConfig.paths.sharedDataRoot,
        executionWorkspaceResolver: createExecutionWorkspaceResolver(),
        deploymentMode: 'LOCAL',
        workspacePolicyProvider: {
          async require() {
            return { ...assembly.workspacePolicy, files: { maxTextBytes: 512, writeDirectories: ['.'] } };
          },
        },
      });
      const toolContext = {
        identityContext: identity,
        agentId: brand<string, 'AgentId'>('default-agent'),
        agentVersion: brand<string, 'AgentVersion'>('v1'),
        sessionId: brand<string, 'SessionId'>(acceptedBody.sessionId),
        requestId: capabilityResult!.requestId,
        runId: brand<string, 'RequestRunId'>(acceptedBody.runId),
        requestContextId: brand<string, 'RequestContextId'>('context-readback-check'),
        stepId: 'readback-check',
        toolCallId: 'tool-readback-check',
        timeoutMs: 30_000,
      };

      const workspaceFilePath = `workspace/${filePath}`;
      await expect(readPort.readText({ file_path: workspaceFilePath }, toolContext)).rejects.toMatchObject({
        reasonCode: 'PAGING_REQUIRED',
        structuredPayload: {
          file_path: workspaceFilePath,
          content: '',
          error: 'PAGING_REQUIRED',
          nextOffset: 0,
        },
      });
      const tailPage = await readPort.readText({ file_path: workspaceFilePath, offset: 0, limit: 1 }, toolContext);
      expect(tailPage).toMatchObject({
        file_path: workspaceFilePath,
        offset: 0,
        limit: 1,
        truncated: true,
      });
      expect(String(tailPage['content'])).toContain('toolCallId: tool-large-python-result');
      console.log(`large-result-readback tail=${tailPage['content']}`);
    } finally {
      await app.close();
      await rm(workspaceDir, { recursive: true, force: true });
    }
  });
});

async function waitForRunCompleted(
  app: ReturnType<typeof createNextAgentTestApp>,
  runId: string,
  identity: { readonly tenantId: ReturnType<typeof brand<string, 'TenantId'>>; readonly subjectId: ReturnType<typeof brand<string, 'SubjectId'>> },
  timeoutMs = 10_000,
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
