import { buildCronTriggerCallbackSigningPayload, type NextAgentTestAppOptions } from '@nextagent/agent-app/testing';
import { brand } from '@nextagent/agent-common';
import type { CronTaskGatewayPort, CronTaskRecord, GatewayProvider } from '@nextagent/agent-contracts/gateway';
import {
  createLocalCronTaskScheduler,
  createLocalGatewayProvider,
  createSqliteLongTermMemoryGatewayProvider,
  createSqliteWorkingMemoryGatewayProvider,
  createSqliteCronTaskGateway,
} from '@nextagent/agent-platform-gateway-local';
import { createNextAgentTestApp } from '@nextagent/agent-platform-gateway-local/testing';
import { createRemoteGatewayProvider } from '@nextagent/agent-platform-gateway-remote';
import { createHmac } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const tenantId = brand<string, 'TenantId'>('tenant-cron-trigger');
const subjectId = brand<string, 'SubjectId'>('subject-cron-trigger');
const agentId = brand<string, 'AgentId'>('default-agent');
const identity = { tenantId, subjectId, displayName: 'Cron trigger e2e' };
const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe('Cron trigger product paths', () => {
  it('delivers a local due trigger through the standard runtime timeline exactly once', async () => {
    let cronTasks: CronTaskGatewayPort | undefined;
    let scheduler: ReturnType<typeof createLocalCronTaskScheduler> | undefined;
    const app = createNextAgentTestApp({
      identity,
      modelSteps: [{ content: 'Seed session ready.' }, { content: 'Local Cron execution completed.' }],
      cronTaskSchedulerFactory(input) {
        cronTasks = input.cronTasks;
        scheduler = createLocalCronTaskScheduler({
          ...input,
          now: () => 2_000,
          triggerIdFactory: () => 'trigger-local-e2e',
        });
        return scheduler;
      },
    });

    try {
      await cronTasks!.createTask(task('task-local-e2e', 2_000));

      await expect(scheduler!.runOnce()).resolves.toEqual({ deliveredCount: 1 });
      await expect(scheduler!.runOnce()).resolves.toEqual({ deliveredCount: 0 });
      const trigger = await cronTasks!.loadTrigger({
        tenantId,
        subjectId,
        agentId,
        taskId: 'task-local-e2e',
        triggerId: 'trigger-local-e2e',
      });
      expect(trigger?.status).toBe('ACCEPTED');
      expect(trigger?.requestRunId).toBeDefined();
      await waitForRunCompleted(app, trigger!.requestRunId!);

      const run = await loadRun(app, trigger!.requestRunId!);
      const events = await timelineFor(app, run!.sessionId, trigger!.requestRunId!);
      expect(events.filter((event) => event.type === 'REQUEST_ACCEPTED')).toHaveLength(1);
      expect(events.filter((event) => event.type === 'REQUEST_COMPLETED')).toHaveLength(1);
      expect(events.at(-1)?.type).toBe('REQUEST_COMPLETED');
      expect(run).toMatchObject({ status: 'COMPLETED', terminalCommitState: 'COMMITTED' });
    } finally {
      await app.close();
    }
  });

  it('accepts a signed remote callback and coalesces duplicate delivery into one request run', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'nextagent-remote-cron-e2e-'));
    directories.push(directory);
    const remoteCron = createSqliteCronTaskGateway(join(directory, 'remote-cron.sqlite'));
    let callbackHandler: Parameters<NonNullable<NextAgentTestAppOptions['cronTriggerCallbackRegistration']>>[0]['handler'] | undefined;
    const remoteProvider = createRemoteGatewayProvider({
      providerId: 'remote-cron-e2e',
      supportedAdapterKinds: ['cron-tasks'],
      bindings: { cronTasks: remoteCron, close: () => remoteCron.close() },
    });
    const app = createNextAgentTestApp({
      identity,
      cronDeploymentMode: 'REMOTE',
      gatewayProviders: [
        createSqliteWorkingMemoryGatewayProvider(),
        createSqliteLongTermMemoryGatewayProvider(),
        createLocalGatewayProvider(),
        remoteSkillHubReadinessProvider(),
        remoteProvider,
      ],
      cronTriggerCallbackCredentialRef: brand<`env:${string}`, 'SecretReference'>('env:NEXTAGENT_TEST_CRON_CALLBACK'),
      cronTriggerCallbackRegistration({ handler }) {
        callbackHandler = handler;
      },
      modelSteps: [{ content: 'Seed session ready.' }, { content: 'Remote Cron execution completed.' }],
    });

    try {
      await remoteCron.createTask(task('task-remote-e2e', 3_000));
      await expect(
        remoteCron.claimCronTrigger({
          tenantId,
          subjectId,
          agentId,
          taskId: 'task-remote-e2e',
          triggerId: 'trigger-remote-e2e',
          scheduledAt: epoch(3_000),
          claimedAt: epoch(3_001),
        }),
      ).resolves.toMatchObject({ status: 'CLAIMED' });

      const issuedAt = Date.now();
      const unsigned = {
        taskId: 'task-remote-e2e',
        triggerId: 'trigger-remote-e2e',
        issuedAt: epoch(issuedAt),
        nonce: 'nonce-remote-e2e',
      };
      const callback = {
        ...unsigned,
        authentication: {
          algorithm: 'HMAC-SHA256' as const,
          signature: createHmac('sha256', 'cron-callback-secret').update(buildCronTriggerCallbackSigningPayload(unsigned)).digest('base64url'),
        },
      };
      const signal = new AbortController().signal;
      const [first, concurrentDuplicate] = await Promise.all([callbackHandler!.handle(callback, signal), callbackHandler!.handle(callback, signal)]);
      const replay = await callbackHandler!.handle(callback, signal);

      expect(first.status).toBe('DELIVERED');
      expect(concurrentDuplicate).toEqual(first);
      expect(replay).toEqual({ status: 'ALREADY_DELIVERED', requestRunId: first.requestRunId });
      await waitForRunCompleted(app, first.requestRunId);
      const trigger = await remoteCron.loadTrigger({ tenantId, subjectId, agentId, taskId: unsigned.taskId, triggerId: unsigned.triggerId });
      expect(trigger).toMatchObject({ status: 'ACCEPTED', requestRunId: first.requestRunId });

      const run = await loadRun(app, first.requestRunId);
      const events = await timelineFor(app, run!.sessionId, first.requestRunId);
      expect(events.filter((event) => event.type === 'REQUEST_ACCEPTED')).toHaveLength(1);
      expect(events.filter((event) => event.type === 'REQUEST_COMPLETED')).toHaveLength(1);
      expect(run).toMatchObject({ status: 'COMPLETED', terminalCommitState: 'COMMITTED' });
    } finally {
      await app.close();
    }
  });
});

function task(taskId: string, nextRunAt: number): CronTaskRecord {
  return {
    tenantId,
    subjectId,
    agentId,
    taskId,
    cron: '* * * * *',
    prompt: 'Inspect AMF registration failures and summarize affected network elements.',
    recurring: false,
    status: 'ACTIVE',
    nextRunAt: epoch(nextRunAt),
    version: 1,
    createdAt: epoch(1_000),
    updatedAt: epoch(1_000),
  };
}

async function submitAndWait(app: ReturnType<typeof createNextAgentTestApp>, inputText: string) {
  const accepted = await app.runtime.submit({
    identityContext: identity,
    agentId,
    inputText,
    attachmentIds: [],
    locale: brand<string, 'RequestLocale'>('en-US'),
    idempotencyKey: brand<string, 'IdempotencyKey'>(`cron-seed:${crypto.randomUUID()}`),
  });
  await waitForRunCompleted(app, accepted.runId);
  return accepted;
}

async function waitForRunCompleted(app: ReturnType<typeof createNextAgentTestApp>, runId: string, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const run = await loadRun(app, runId);
    if (run?.status === 'COMPLETED' && run.terminalCommitState === 'COMMITTED') {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error('Timed out waiting for Cron request run completion.');
}

function loadRun(app: ReturnType<typeof createNextAgentTestApp>, runId: string) {
  return app.gateway.requestRuns.loadRun({ tenantId, subjectId, agentId, runId: brand<string, 'RequestRunId'>(runId) });
}

async function timelineFor(app: ReturnType<typeof createNextAgentTestApp>, sessionId: string, runId: string) {
  const events = await app.gateway.timeline.listEvents({
    tenantId,
    subjectId,
    agentId,
    sessionId: brand<string, 'SessionId'>(sessionId),
    afterSequence: brand<number, 'TimelineSequence'>(0),
    limit: 1_000,
  });
  return events.filter((event) => event.runId === runId);
}

function epoch(value: number) {
  return brand<number, 'EpochMillis'>(value);
}

function remoteSkillHubReadinessProvider(): GatewayProvider {
  return {
    providerId: 'remote-skillhub-readiness',
    deploymentMode: 'REMOTE',
    supportedAdapterKinds: ['skillhub'],
    create() {
      return {
        providerId: 'remote-skillhub-readiness',
        deploymentMode: 'REMOTE',
        readiness: {
          state: 'READY',
          evidenceRef: 'gateway-provider:remote-skillhub-readiness:ready',
          safeMessage: 'Remote SkillHub gateway selection is ready.',
        },
      };
    },
  };
}
