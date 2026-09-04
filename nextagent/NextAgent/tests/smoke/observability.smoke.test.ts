/**
 * E2E Case: feature-tree smoke - 可观测性.
 * Entry: structured diagnostics emitted from runtime/model/capability path.
 */
import { createNextAgentTestApp } from '@nextagent/agent-platform-gateway-local/testing';
import { expect, it } from 'vitest';
import { describeRealModelSmoke, submitAndWaitForSession } from './system-smoke-helpers.js';

describeRealModelSmoke('feature-tree smoke: 可观测性', () => {
  it('emits structured diagnostic logs with stable run correlation', async () => {
    const entries: unknown[] = [];
    const app = createNextAgentTestApp({
      workspaceDir: process.cwd(),
      modelSteps: [{ content: 'Observability smoke completed.' }],
      observationLogger: {
        debug(entry) {
          entries.push(entry);
        },
        info(entry) {
          entries.push(entry);
        },
        warn(entry) {
          entries.push(entry);
        },
        error(entry) {
          entries.push(entry);
        },
      },
    });

    const result = await submitAndWaitForSession(app, 'Run observability smoke.', 'Observability smoke completed.', 'observability');
    expect(JSON.stringify(entries)).toContain(result.runId);
    expect(entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ event: 'model.invocation.started', runId: result.runId }),
        expect.objectContaining({ event: 'model.invocation.completed', runId: result.runId }),
      ]),
    );
  });
});
