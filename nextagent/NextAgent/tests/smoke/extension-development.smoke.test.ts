/**
 * E2E Case: feature-tree smoke - 二次开发.
 * Entry: custom lifecycle hook registration and agent-bound activation.
 */
import { createNextAgentTestApp } from '@nextagent/agent-platform-gateway-local/testing';
import { defineLifecycleHook } from '@nextagent/agent-runtime';
import { expect, it } from 'vitest';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  describeRealModelSmoke,
  readExecutionWorkspaceFile,
  smokeIdentity,
  submitAndWaitForSession,
  trackCleanupPath,
} from './system-smoke-helpers.js';

describeRealModelSmoke('feature-tree smoke: 二次开发', () => {
  it('loads and executes an agent-activated custom terminal lifecycle hook', async () => {
    const terminalHook = defineLifecycleHook({
      hookId: 'custom.system-smoke-terminal-prefix',
      kind: 'CUSTOM',
      supportedStages: ['BEFORE_AGENT_TERMINAL'] as const,
      effects: ['TRANSFORM'] as const,
      failureMode: 'FAIL',
      execute(input) {
        return { outcome: 'PASS', mutation: { finalContent: `hooked: ${input.boundary.finalContent}` } };
      },
    });
    const app = createNextAgentTestApp({
      workspaceDir: process.cwd(),
      modelSteps: [{ content: 'extension smoke completed.' }],
      lifecycleHooks: [terminalHook],
      hooks: [{ hookId: 'custom.system-smoke-terminal-prefix', enabled: true, stages: ['BEFORE_AGENT_TERMINAL'] }],
    });

    const result = await submitAndWaitForSession(app, 'Run extension smoke.', 'hooked: extension smoke completed.', 'extension-development');
    expect(result.streamBody).toContain('hooked: extension smoke completed.');
  });

  it('executes a governed Write capability and records safe runtime evidence', async () => {
    const relativePath = 'workspace/diagnostics/system-smoke-governance.txt';
    const content = 'governed write smoke completed\n';
    const workspaceDir = trackCleanupPath(await mkdtemp(join(tmpdir(), 'nextagent-extension-governance-smoke-')));
    const operationalEntries: Array<Record<string, unknown>> = [];
    const capture = (entry: object): void => {
      operationalEntries.push(entry as Record<string, unknown>);
    };
    const app = createNextAgentTestApp({
      workspaceDir,
      identity: smokeIdentity,
      observationLogger: {
        debug: capture,
        info: capture,
        warn: capture,
        error: capture,
      },
      modelSteps: [
        {
          toolCalls: [
            {
              toolCallId: 'write-governance-smoke',
              toolName: 'Write',
              arguments: { file_path: relativePath, content },
            },
          ],
        },
        { content: 'governance smoke completed.' },
      ],
    });

    const result = await submitAndWaitForSession(app, 'Write a governed diagnostics file.', 'governance smoke completed.', 'extension-governance');
    expect(result.streamBody).toContain('event: CAPABILITY_STARTED');
    expect(result.streamBody).toContain('event: CAPABILITY_COMPLETED');
    expect(result.streamBody).toContain('write-governance-smoke');
    expect(await readExecutionWorkspaceFile(app, result.sessionId, result.runId, relativePath)).toBe(content);

    expect(operationalEntries).toContainEqual(
      expect.objectContaining({
        event: 'policy.allowed',
        details: expect.objectContaining({ operationId: 'Write:write-governance-smoke' }),
      }),
    );
  });
});
