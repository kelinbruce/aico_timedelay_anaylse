import { createNextAgentTestApp } from '@nextagent/agent-platform-gateway-local/testing';
import { brand } from '@nextagent/agent-common';
import type { HookInput, HookResult, LifecycleHookDefinition } from '@nextagent/agent-contracts/runtime';
import type { RuntimeLifecycleHookExecutor } from '@nextagent/agent-runtime';
import { describe, expect, it } from 'vitest';

const identity = {
  tenantId: brand<string, 'TenantId'>('tenant-cron-lifecycle'),
  subjectId: brand<string, 'SubjectId'>('subject-cron-lifecycle'),
  displayName: 'Cron lifecycle tester',
};
const agentId = brand<string, 'AgentId'>('default-agent');

describe('Cron trigger standard runtime lifecycle', () => {
  it('shares the session lane, freezes assembly, supports cancel, and commits one terminal fact', async () => {
    let releaseUser!: () => void;
    let userHookEntered!: () => void;
    const userGate = new Promise<void>((resolve) => {
      releaseUser = resolve;
    });
    const hookEntered = new Promise<void>((resolve) => {
      userHookEntered = resolve;
    });
    let blockFirstModelInvocation = true;
    const lifecycleHook: RuntimeLifecycleHookExecutor = {
      async invoke(input: HookInput): Promise<HookResult> {
        if (input.stage === 'BEFORE_MODEL_INVOKE' && blockFirstModelInvocation) {
          blockFirstModelInvocation = false;
          userHookEntered();
          await userGate;
        }
        return { outcome: 'PASS' };
      },
    };
    const definitions: readonly LifecycleHookDefinition[] = [
      {
        hookId: 'cron-lane-gate',
        kind: 'CUSTOM',
        supportedStages: ['BEFORE_MODEL_INVOKE'],
        effects: ['CONTROL'],
        executionStrategy: 'SERIAL_IMPACT',
        failureMode: 'FAIL',
      },
    ];
    const app = createNextAgentTestApp({
      workspaceDir: process.cwd(),
      modelSteps: [{ content: 'User request completed.' }, { content: 'Cron request completed.' }],
      identity,
      lifecycleHook,
      lifecycleHookDefinitions: definitions,
      hooks: [{ hookId: 'cron-lane-gate', enabled: true, stages: ['BEFORE_MODEL_INVOKE'] }],
    });

    try {
      const session = await app.runtime.createSession({
        identityContext: identity,
        locale: brand<string, 'RequestLocale'>('en-US'),
        idempotencyKey: brand<string, 'IdempotencyKey'>('cron-lifecycle-session'),
      });
      const user = await app.runtime.submit({
        sessionId: session.sessionId,
        identityContext: identity,
        agentId,
        inputText: 'Hold this user request in the session lane.',
        attachmentIds: [],
        locale: brand<string, 'RequestLocale'>('en-US'),
        idempotencyKey: brand<string, 'IdempotencyKey'>('cron-lifecycle-user'),
      });
      await hookEntered;

      const canceledCron = await submitCronTrigger(app, session.sessionId, 'cancel');
      const queuedRun = await loadRun(app, canceledCron.runId);
      expect(queuedRun).toMatchObject({
        status: 'QUEUED',
        agentId: 'default-agent',
        agentVersion: 'v1',
        agentAssemblyRef: 'default-agent:v1',
      });

      await app.runtime.cancel({
        sessionId: session.sessionId,
        identityContext: identity,
        expectedLatestRequestId: canceledCron.requestId,
        action: 'CANCEL',
        idempotencyKey: brand<string, 'IdempotencyKey'>('cron-lifecycle-cancel'),
      });
      await waitForTerminal(app, canceledCron.runId, 'CANCELED');

      releaseUser();
      await waitForTerminal(app, user.runId, 'SUPERSEDED');

      const completedCron = await submitCronTrigger(app, session.sessionId, 'complete');
      await waitForTerminal(app, completedCron.runId, 'COMPLETED');
      const completedRun = await loadRun(app, completedCron.runId);
      expect(completedRun).toMatchObject({
        agentId: 'default-agent',
        agentVersion: 'v1',
        agentAssemblyRef: 'default-agent:v1',
        terminalCommitState: 'COMMITTED',
      });

      const events = await app.gateway.timeline.listEvents({
        tenantId: identity.tenantId,
        subjectId: identity.subjectId,
        agentId,
        sessionId: session.sessionId,
        afterSequence: brand<number, 'TimelineSequence'>(0),
        limit: 1_000,
      });
      expect(events.filter((event) => event.runId === canceledCron.runId && event.type === 'REQUEST_CANCELED')).toHaveLength(1);
      expect(events.filter((event) => event.runId === completedCron.runId && event.type === 'REQUEST_COMPLETED')).toHaveLength(1);
      expect(events.filter((event) => event.runId === user.runId && event.type === 'REQUEST_SUPERSEDED')).toHaveLength(1);
    } finally {
      releaseUser();
      await app.close();
    }
  }, 10_000);
});

function submitCronTrigger(app: ReturnType<typeof createNextAgentTestApp>, sessionId: ReturnType<typeof brand<string, 'SessionId'>>, suffix: string) {
  return app.runtime.submit({
    sessionId,
    identityContext: identity,
    agentId,
    inputText: `Run durable Cron prompt: ${suffix}`,
    attachmentIds: [],
    locale: brand<string, 'RequestLocale'>('en-US'),
    priority: 'LOW',
    idempotencyKey: brand<string, 'IdempotencyKey'>(`cron-trigger:trigger-${suffix}`),
  });
}

function loadRun(app: ReturnType<typeof createNextAgentTestApp>, runId: string) {
  return app.gateway.requestRuns.loadRun({
    tenantId: identity.tenantId,
    subjectId: identity.subjectId,
    agentId,
    runId: brand<string, 'RequestRunId'>(runId),
  });
}

async function waitForTerminal(
  app: ReturnType<typeof createNextAgentTestApp>,
  runId: string,
  expectedStatus: 'COMPLETED' | 'CANCELED' | 'SUPERSEDED',
  timeoutMs = 5_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const run = await loadRun(app, runId);
    if (run?.status === expectedStatus && run.terminalCommitState === 'COMMITTED') {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`Timed out waiting for Cron run ${runId} to reach ${expectedStatus}.`);
}
