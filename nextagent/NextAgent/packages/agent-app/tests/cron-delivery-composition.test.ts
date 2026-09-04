import { brand } from '@nextagent/agent-common';
import type { CronTaskGatewayPort } from '@nextagent/agent-contracts/gateway';
import type { SubmitRequestCommand } from '@nextagent/agent-contracts/runtime';
import { describe, expect, it } from 'vitest';
import { createRuntimeCronTriggerDelivery } from '../src/composition/cron-delivery-composition.js';

describe('Cron delivery composition', () => {
  it('submits a standard runtime command from durable task facts and binds the accepted run', async () => {
    const submitted: SubmitRequestCommand[] = [];
    const bound: unknown[] = [];
    const observations: unknown[] = [];
    const delivery = createRuntimeCronTriggerDelivery({
      locale: brand<string, 'RequestLocale'>('zh-CN'),
      now: () => 1_700_000_000_333,
      runtime: {
        async createSession() {
          return {
            tenantId: brand<string, 'TenantId'>('tenant-1'),
            subjectId: brand<string, 'SubjectId'>('subject-1'),
            agentId: brand<string, 'AgentId'>('agent-1'),
            sessionId: brand<string, 'SessionId'>('session-1'),
            title: 'Cron execution',
            createdAt: brand<number, 'EpochMillis'>(1_700_000_000_300),
            updatedAt: brand<number, 'EpochMillis'>(1_700_000_000_300),
            hasInFlightRequest: false,
          };
        },
        async submit(command) {
          submitted.push(command);
          return {
            sessionId: brand<string, 'SessionId'>('session-1'),
            requestId: brand<string, 'MessageId'>('message-1'),
            runId: brand<string, 'RequestRunId'>('run-1'),
            attempt: 1,
          };
        },
      },
      requestRuns: {
        async loadRun() {
          return {
            tenantId: brand<string, 'TenantId'>('tenant-1'),
            subjectId: brand<string, 'SubjectId'>('subject-1'),
            agentId: brand<string, 'AgentId'>('agent-1'),
            agentVersion: brand<string, 'AgentVersion'>('v7'),
            agentAssemblyRef: 'agent-1:v7',
            sessionId: brand<string, 'SessionId'>('session-1'),
            requestId: brand<string, 'MessageId'>('message-1'),
            runId: brand<string, 'RequestRunId'>('run-1'),
            attempt: 1,
            status: 'QUEUED' as const,
            version: 1,
            terminalCommitState: 'PENDING' as const,
            createdAt: brand<number, 'EpochMillis'>(1_700_000_000_222),
            updatedAt: brand<number, 'EpochMillis'>(1_700_000_000_222),
          };
        },
      },
      projectorHost: {
        acceptObservation(observation) {
          observations.push(observation);
        },
      },
      cronTasks: {
        async bindCronTriggerRun(request) {
          bound.push(request);
          return { status: 'BOUND' };
        },
      } as CronTaskGatewayPort,
    });

    const result = await delivery.deliver({
      signal: new AbortController().signal,
      task: {
        tenantId: brand<string, 'TenantId'>('tenant-1'),
        subjectId: brand<string, 'SubjectId'>('subject-1'),
        agentId: brand<string, 'AgentId'>('agent-1'),
        taskId: 'task-1',
        cron: '* * * * *',
        prompt: '检查基站告警',
        recurring: true,
        status: 'ACTIVE',
        nextRunAt: brand<number, 'EpochMillis'>(1_700_000_000_000),
        version: 1,
        createdAt: brand<number, 'EpochMillis'>(1_699_999_999_000),
        updatedAt: brand<number, 'EpochMillis'>(1_699_999_999_000),
      },
      trigger: {
        tenantId: brand<string, 'TenantId'>('tenant-1'),
        subjectId: brand<string, 'SubjectId'>('subject-1'),
        agentId: brand<string, 'AgentId'>('agent-1'),
        taskId: 'task-1',
        triggerId: 'trigger-1',
        scheduledAt: brand<number, 'EpochMillis'>(1_700_000_000_000),
        status: 'CLAIMED',
        createdAt: brand<number, 'EpochMillis'>(1_700_000_000_111),
        updatedAt: brand<number, 'EpochMillis'>(1_700_000_000_111),
      },
    });

    expect(submitted).toEqual([
      {
        sessionId: brand<string, 'SessionId'>('session-1'),
        agentId: brand<string, 'AgentId'>('agent-1'),
        identityContext: {
          tenantId: brand<string, 'TenantId'>('tenant-1'),
          subjectId: brand<string, 'SubjectId'>('subject-1'),
          displayName: 'Cron trigger',
        },
        inputText: '检查基站告警',
        attachmentIds: [],
        locale: brand<string, 'RequestLocale'>('zh-CN'),
        priority: 'LOW',
        idempotencyKey: brand<string, 'IdempotencyKey'>('cron-trigger:trigger-1'),
      },
    ]);
    expect(bound).toEqual([
      {
        tenantId: brand<string, 'TenantId'>('tenant-1'),
        subjectId: brand<string, 'SubjectId'>('subject-1'),
        agentId: brand<string, 'AgentId'>('agent-1'),
        sessionId: brand<string, 'SessionId'>('session-1'),
        taskId: 'task-1',
        triggerId: 'trigger-1',
        requestRunId: brand<string, 'RequestRunId'>('run-1'),
        acceptedAt: brand<number, 'EpochMillis'>(1_700_000_000_333),
      },
    ]);
    expect(result).toEqual({ requestRunId: brand<string, 'RequestRunId'>('run-1') });
    expect(observations).toEqual([
      expect.objectContaining({
        operation: 'CRON_TRIGGER_ACCEPTED',
        ownerScope: expect.objectContaining({ agentVersion: 'v7' }),
        stableRefs: expect.objectContaining({
          sessionId: 'session-1',
          requestRunId: 'run-1',
          cronTaskId: 'task-1',
          cronTriggerId: 'trigger-1',
        }),
      }),
    ]);
    expect(JSON.stringify(observations)).not.toMatch(/prompt|callback|credential|vendor|path/i);
  });

  it('maps explicit Cron targets to runtime routing constraints', async () => {
    const submitted: SubmitRequestCommand[] = [];
    const delivery = createRuntimeCronTriggerDelivery({
      locale: brand<string, 'RequestLocale'>('zh-CN'),
      runtime: {
        async createSession() {
          return {
            tenantId: brand<string, 'TenantId'>('tenant-1'),
            subjectId: brand<string, 'SubjectId'>('subject-1'),
            agentId: brand<string, 'AgentId'>('agent-1'),
            sessionId: brand<string, 'SessionId'>('session-1'),
            title: 'Cron execution',
            createdAt: brand<number, 'EpochMillis'>(1_700_000_000_300),
            updatedAt: brand<number, 'EpochMillis'>(1_700_000_000_300),
            hasInFlightRequest: false,
          };
        },
        async submit(command) {
          submitted.push(command);
          return {
            sessionId: brand<string, 'SessionId'>('session-1'),
            requestId: brand<string, 'MessageId'>('message-1'),
            runId: brand<string, 'RequestRunId'>('run-1'),
            attempt: 1,
          };
        },
      },
      requestRuns: {
        async loadRun() {
          return undefined;
        },
      },
      projectorHost: { acceptObservation() {} },
      cronTasks: {
        async bindCronTriggerRun() {
          return { status: 'BOUND' };
        },
      } as unknown as CronTaskGatewayPort,
    });

    await delivery.deliver({
      signal: new AbortController().signal,
      task: taskRecord({ targetKind: 'SKILL', targetName: 'ran-diagnosis' }),
      trigger: triggerRecord('trigger-skill'),
    });
    await delivery.deliver({
      signal: new AbortController().signal,
      task: taskRecord({ targetKind: 'WORKFLOW', targetName: 'daily-report' }),
      trigger: triggerRecord('trigger-workflow'),
    });

    expect(submitted.map((command) => command.routingConstraints)).toEqual([{ targetSkill: 'ran-diagnosis' }, { targetRecipe: 'daily-report' }]);
  });
});

function taskRecord(overrides: Partial<Parameters<ReturnType<typeof createRuntimeCronTriggerDelivery>['deliver']>[0]['task']> = {}) {
  return {
    tenantId: brand<string, 'TenantId'>('tenant-1'),
    subjectId: brand<string, 'SubjectId'>('subject-1'),
    agentId: brand<string, 'AgentId'>('agent-1'),
    taskId: 'task-1',
    cron: '* * * * *',
    prompt: '检查基站告警',
    recurring: true,
    status: 'ACTIVE' as const,
    nextRunAt: brand<number, 'EpochMillis'>(1_700_000_000_000),
    version: 1,
    createdAt: brand<number, 'EpochMillis'>(1_699_999_999_000),
    updatedAt: brand<number, 'EpochMillis'>(1_699_999_999_000),
    ...overrides,
  };
}

function triggerRecord(triggerId: string) {
  return {
    tenantId: brand<string, 'TenantId'>('tenant-1'),
    subjectId: brand<string, 'SubjectId'>('subject-1'),
    agentId: brand<string, 'AgentId'>('agent-1'),
    taskId: 'task-1',
    triggerId,
    scheduledAt: brand<number, 'EpochMillis'>(1_700_000_000_000),
    status: 'CLAIMED' as const,
    createdAt: brand<number, 'EpochMillis'>(1_700_000_000_111),
    updatedAt: brand<number, 'EpochMillis'>(1_700_000_000_111),
  };
}
