import { cleanupNextAgentTestApps, createNextAgentTestApp } from '@nextagent/agent-app/testing';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, describe, expect, it } from 'vitest';

// End-to-end verification on a real fastify server (createNextAgentTestApp).
// Reproduces the reported production scenario: a single model round returning
// 9 Read tool calls for 9 DIFFERENT files, which under the old unified cap of 5
// threw TOOL_CALL_LIMIT_EXCEEDED and failed the run. Verifies the graded fix.

const workspace = mkdtempSync(join(tmpdir(), 'na-readonly-fanout-'));
afterEach(async () => {
  await cleanupNextAgentTestApps();
});
afterAll(() => {
  rmSync(workspace, { recursive: true, force: true });
});
for (let index = 0; index < 9; index += 1) {
  writeFileSync(join(workspace, `file-${index}.txt`), `content line ${index}\n`);
}

describe('read-only fan-out e2e verification', () => {
  it('executes 9 parallel Read calls (distinct files) in one round without hitting the limit', async () => {
    const app = createNextAgentTestApp({
      workspaceDir: workspace,
      modelSteps: [
        {
          toolCalls: Array.from({ length: 9 }, (_value, index) => ({
            toolCallId: `tool-read-${index}`,
            toolName: 'Read',
            arguments: { file_path: `file-${index}.txt`, offset: 0, limit: 1 },
          })),
        },
        { content: '已读取 9 个文件。' },
      ],
    });

    const accepted = await app.server.inject({
      method: 'POST',
      url: '/api/v1/requests',
      payload: { inputText: '并行读取 9 个文件', idempotencyKey: 'idem-e2e-9reads' },
    });
    const body = accepted.json<{ sessionId: string; runId: string }>();
    const stream = await app.server.inject({
      method: 'GET',
      url: `/api/v1/sessions/${body.sessionId}/stream?lastSeenSequence=0&runId=${body.runId}`,
    });

    // The fix: 9 read-only calls (<= maxReadOnlyToolCallsPerRound=20) execute.
    expect(stream.body).not.toContain('TOOL_CALL_LIMIT_EXCEEDED');
    expect(stream.body).not.toContain('event: REQUEST_FAILED');
    expect(stream.body).toContain('event: REQUEST_COMPLETED');
    // All 9 tool calls were actually started.
    const startedCount = (stream.body as string).match(/event: CAPABILITY_STARTED/g)?.length ?? 0;
    expect(startedCount).toBe(9);
  });

  it('executes 9 Bash calls under the unified per-turn limit', async () => {
    const app = createNextAgentTestApp({
      workspaceDir: workspace,
      modelSteps: [
        {
          toolCalls: Array.from({ length: 9 }, (_item, index) => ({
            toolCallId: `tool-bash-${index}`,
            toolName: 'Bash',
            arguments: { command: `echo ${index}` },
          })),
        },
        { content: '已执行 9 个 Bash 调用。' },
      ],
    });

    const accepted = await app.server.inject({
      method: 'POST',
      url: '/api/v1/requests',
      payload: { inputText: '并行执行 9 个 bash', idempotencyKey: 'idem-e2e-9bash' },
    });
    const body = accepted.json<{ sessionId: string; runId: string }>();
    const stream = await app.server.inject({
      method: 'GET',
      url: `/api/v1/sessions/${body.sessionId}/stream?lastSeenSequence=0&runId=${body.runId}`,
    });

    expect(stream.body).not.toContain('TOOL_CALL_LIMIT_EXCEEDED');
    expect(stream.body).not.toContain('event: REQUEST_FAILED');
    expect(stream.body).toContain('event: REQUEST_COMPLETED');
    expect((stream.body as string).match(/event: CAPABILITY_STARTED/g)?.length ?? 0).toBe(9);
  }, 15_000);
});
