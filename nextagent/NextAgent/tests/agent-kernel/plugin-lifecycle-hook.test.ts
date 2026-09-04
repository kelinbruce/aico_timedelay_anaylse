import { createNextAgentTestApp } from '@nextagent/agent-platform-gateway-local/testing';
import { brand } from '@nextagent/agent-common';
import { defineLifecycleHook } from '@nextagent/agent-plugin-sdk';
import { buildStartupLifecycleHookRegistry } from '@nextagent/agent-runtime';
import { afterEach, describe, expect, it } from 'vitest';
import { agentId, apps, closeLifecycleHookApps, identity, waitForTimelineEvent } from './lifecycle-hook-test-helpers.js';

afterEach(async () => {
  await closeLifecycleHookApps();
});

describe('plugin lifecycle hook', () => {
  it('executes a plugin LifecycleHook object only when the current Agent activates it', async () => {
    const terminalHook = defineLifecycleHook({
      hookId: 'telecom.terminal-safety',
      kind: 'CUSTOM',
      supportedStages: ['BEFORE_AGENT_TERMINAL'] as const,
      effects: ['TRANSFORM'] as const,
      failureMode: 'FAIL',
      execute(input) {
        return { outcome: 'PASS', mutation: { finalContent: `plugin checked: ${input.boundary.finalContent}` } };
      },
    });
    const disabledApp = createNextAgentTestApp({
      workspaceDir: process.cwd(),
      modelSteps: [{ content: 'terminal content' }],
      identity,
      lifecycleHooks: [terminalHook],
      hooks: [],
    });
    const enabledApp = createNextAgentTestApp({
      workspaceDir: process.cwd(),
      modelSteps: [{ content: 'terminal content' }],
      identity,
      lifecycleHooks: [terminalHook],
      hooks: [{ hookId: 'telecom.terminal-safety', enabled: true, stages: ['BEFORE_AGENT_TERMINAL'] }],
    });
    apps.push(disabledApp, enabledApp);

    await expect(runAndReadTerminal(disabledApp, 'disabled')).resolves.toBe('terminal content');
    await expect(runAndReadTerminal(enabledApp, 'enabled')).resolves.toBe('plugin checked: terminal content');
  });

  it('rejects unsupported plugin hook stage and unsupported terminal outcome during startup/execution validation', async () => {
    expect(() =>
      buildStartupLifecycleHookRegistry([
        defineLifecycleHook({
          hookId: 'telecom.bad-stage',
          kind: 'CUSTOM',
          supportedStages: ['NOT_A_STAGE' as never],
          effects: ['OBSERVE'] as const,
          failureMode: 'CONTINUE',
          execute() {
            return { outcome: 'PASS' };
          },
        }),
      ]),
    ).toThrow('Lifecycle hook stage is unsupported.');

    const badOutcome = defineLifecycleHook({
      hookId: 'telecom.bad-outcome',
      kind: 'CUSTOM',
      supportedStages: ['BEFORE_AGENT_TERMINAL'] as const,
      effects: ['TRANSFORM'] as const,
      failureMode: 'FAIL',
      execute() {
        return { outcome: 'PEND', pending: { reason: 'invalid terminal hook outcome' } } as never;
      },
    });
    const app = createNextAgentTestApp({
      workspaceDir: process.cwd(),
      modelSteps: [{ content: 'terminal content' }],
      identity,
      lifecycleHooks: [badOutcome],
      hooks: [{ hookId: 'telecom.bad-outcome', enabled: true }],
    });
    apps.push(app);
    const session = await app.runtime.createSession({
      identityContext: identity,
      locale: brand<string, 'RequestLocale'>('zh-CN'),
      idempotencyKey: brand<string, 'IdempotencyKey'>('idem-plugin-hook-bad-outcome-session'),
    });
    const accepted = await app.runtime.submit({
      sessionId: session.sessionId,
      identityContext: identity,
      inputText: 'run bad outcome',
      attachmentIds: [],
      locale: brand<string, 'RequestLocale'>('zh-CN'),
      idempotencyKey: brand<string, 'IdempotencyKey'>('idem-plugin-hook-bad-outcome-submit'),
    });

    await expect(waitForTimelineEvent(app, session.sessionId, accepted.runId, 'REQUEST_FAILED')).resolves.toBeDefined();
  });
});

async function runAndReadTerminal(app: ReturnType<typeof createNextAgentTestApp>, suffix: string): Promise<unknown> {
  const session = await app.runtime.createSession({
    identityContext: identity,
    locale: brand<string, 'RequestLocale'>('zh-CN'),
    idempotencyKey: brand<string, 'IdempotencyKey'>(`idem-plugin-hook-${suffix}-session`),
  });
  const accepted = await app.runtime.submit({
    sessionId: session.sessionId,
    identityContext: identity,
    inputText: `run ${suffix} plugin hook`,
    attachmentIds: [],
    locale: brand<string, 'RequestLocale'>('zh-CN'),
    idempotencyKey: brand<string, 'IdempotencyKey'>(`idem-plugin-hook-${suffix}-submit`),
  });
  const completed = await waitForTimelineEvent(app, session.sessionId, accepted.runId, 'REQUEST_COMPLETED');
  return completed.inlinePayload['content'];
}
