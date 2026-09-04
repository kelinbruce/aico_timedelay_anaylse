import { brand } from '@nextagent/agent-common';
import { createExecutionWorkspaceResolver } from '@nextagent/agent-runtime';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { cleanupE2ETestContext, createE2ETestContext } from './e2e-helpers.js';

describe('Workspace tool calling product path', () => {
  it('executes write, glob, read, Edit, and Grep tool calls over HTTP', async () => {
    const relativePath = 'diagnostics/site-a/alarm.txt';
    const originalContent = ['NE=LTE-eNodeB-001', 'Alarm=RRU_LINK_DEGRADED', 'Severity=minor', 'Action=pending', ''].join('\n');
    const editedContent = ['NE=LTE-eNodeB-001', 'Alarm=RRU_LINK_DEGRADED', 'Severity=critical', 'Action=pending', ''].join('\n');
    const identity = {
      tenantId: brand<string, 'TenantId'>('tenant-1'),
      subjectId: brand<string, 'SubjectId'>('subject-1'),
      displayName: 'Workspace tools product path tester',
    };
    const ctx = await createE2ETestContext({
      tempPrefix: 'nextagent-workspace-tools-e2e-',
      identity,
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
              toolCallId: 'tool-e2e-glob-alarm',
              toolName: 'Glob',
              arguments: { pattern: 'workspace/diagnostics/**/*.txt' },
            },
            {
              toolCallId: 'tool-e2e-read-alarm',
              toolName: 'Read',
              arguments: { file_path: `workspace/${relativePath}`, offset: 0, limit: 10 },
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
            {
              toolCallId: 'tool-e2e-grep-alarm',
              toolName: 'Grep',
              arguments: { pattern: 'Severity=critical', path: 'workspace/diagnostics', output_mode: 'content' },
            },
          ],
        },
        { content: 'Workspace tools verified.' },
      ],
    });

    try {
      const accepted = await fetch(`${ctx.baseUrl}/api/v1/requests`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          inputText: 'Create, discover, read, edit, and verify the site alarm diagnostic file.',
          idempotencyKey: `workspace-tools-e2e-${crypto.randomUUID()}`,
        }),
      });

      expect(accepted.status).toBe(200);
      const body = (await accepted.json()) as { sessionId: string; runId: string };
      await waitForRunCompleted(ctx.app, body.runId, identity);
      const stream = await fetch(`${ctx.baseUrl}/api/v1/sessions/${body.sessionId}/stream?lastSeenSequence=0&runId=${body.runId}`);
      expect(stream.status).toBe(200);
      const streamBody = await stream.text();

      for (const toolCallId of ['tool-e2e-write-alarm', 'tool-e2e-glob-alarm', 'tool-e2e-read-alarm', 'tool-e2e-edit-alarm', 'tool-e2e-grep-alarm']) {
        expect(streamBody).toContain(toolCallId);
      }
      expect(streamBody.match(/event: CAPABILITY_STARTED/g)).toHaveLength(5);
      expect(streamBody.match(/event: CAPABILITY_COMPLETED/g)).toHaveLength(5);
      expect(streamBody.match(/"status":"SUCCEEDED"/g)).toHaveLength(5);
      expect(streamBody).toContain('"capabilityId":"Write"');
      expect(streamBody).toContain('"capabilityId":"Glob"');
      expect(streamBody).toContain('"capabilityId":"Read"');
      expect(streamBody).toContain('"capabilityId":"Edit"');
      expect(streamBody).toContain('"capabilityId":"Grep"');
      expect(streamBody).toContain('Workspace tools verified.');

      const workspaceRoot = await resolveWorkspaceRoot(ctx.app, body.sessionId, body.runId);
      expect(await readFile(join(workspaceRoot, ...relativePath.split('/')), 'utf8')).toBe(editedContent);

      const conversation = await fetch(`${ctx.baseUrl}/api/v1/sessions/${body.sessionId}/conversation?limit=10`);
      expect(conversation.status).toBe(200);
      const history = (await conversation.json()) as { items: Array<{ role: string; content: string }> };
      expect(history.items.map((item) => item.role)).toEqual(['USER', 'ASSISTANT']);
      expect(history.items.at(-1)?.content).toBe('Workspace tools verified.');
    } finally {
      await cleanupE2ETestContext(ctx);
    }
  });
});

async function waitForRunCompleted(
  app: Awaited<ReturnType<typeof createE2ETestContext>>['app'],
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
async function resolveWorkspaceRoot(app: Awaited<ReturnType<typeof createE2ETestContext>>['app'], sessionId: string, runId: string): Promise<string> {
  const assembly = await app.assemblyRegistry.require(brand<string, 'AgentId'>('default-agent'), brand<string, 'AgentVersion'>('v1'));
  const executionWorkspace = createExecutionWorkspaceResolver().resolve({
    runtimeWorkspaceRoot: app.systemConfig.paths.runtimeWorkspaceRoot,
    sharedDataRoot: app.systemConfig.paths.sharedDataRoot,
    workspacePolicy: assembly.workspacePolicy,
    agentId: brand<string, 'AgentId'>('default-agent'),
    tenantId: brand<string, 'TenantId'>('tenant-1'),
    subjectId: brand<string, 'SubjectId'>('subject-1'),
    sessionId: brand<string, 'SessionId'>(sessionId),
    runId: brand<string, 'RequestRunId'>(runId),
    deploymentMode: 'LOCAL',
  });
  const workspaceRoot = executionWorkspace.roots.find((root) => root.kind === 'workspace')?.physicalPath;
  if (workspaceRoot === undefined) {
    throw new Error('Workspace root was not resolved.');
  }
  return workspaceRoot;
}
