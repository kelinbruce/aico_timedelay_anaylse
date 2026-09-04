import { brand, type AgentId } from '@nextagent/agent-common';
import type { CronTaskGatewayPort } from '@nextagent/agent-contracts/gateway';
import { createSqliteCronTaskGateway } from '@nextagent/agent-platform-gateway-local';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createCronTaskManagementService } from '../src/cron/cron-task-management.js';

const directories: string[] = [];
const tenantId = brand<string, 'TenantId'>('tenant-cron-management');
const subjectId = brand<string, 'SubjectId'>('subject-cron-management');
const agentId = brand<string, 'AgentId'>('default-agent');
const identity = { tenantId, subjectId, displayName: 'Cron management tester' };

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe('Cron task management service', () => {
  it('rejects a new task at ACTIVE capacity before invoking durable create', async () => {
    const createTask = vi.fn();
    const service = createCronTaskManagementService({
      cronTasks: {
        countActiveTasksForAgent: async () => 50,
        createTask,
      } as unknown as CronTaskGatewayPort,
      ...executionStores(),
      now: () => 1_000,
      taskIdFactory: () => 'capacity-blocked',
    });

    await expect(
      service.createCronTask({ identityContext: identity, agentId, cron: '*/5 * * * *', prompt: 'must not persist' }),
    ).rejects.toMatchObject({
      code: 'CRON_TASK_LIMIT_REACHED',
      category: 'CONFLICT',
      retryable: false,
    });
    expect(createTask).not.toHaveBeenCalled();
  });

  it('creates tasks through a server-owned management session and projects agent-scoped views', async () => {
    const gateway = createSqliteCronTaskGateway(await tempDatabase());
    const service = createCronTaskManagementService({
      cronTasks: gateway,
      ...executionStores(),
      now: () => 1_000,
      taskIdFactory: () => 'cron-management-1',
    });

    const created = await service.createCronTask({
      identityContext: identity,
      agentId,
      cron: '*/5 * * * *',
      prompt: 'Check LTE handover failures',
      recurring: false,
    });
    const tasks = await service.listCronTasks({ identityContext: identity, agentId });

    expect(created).toMatchObject({
      taskId: 'cron-management-1',
      cron: '*/5 * * * *',
      humanSchedule: 'Every 5 minutes',
      prompt: 'Check LTE handover failures',
      recurring: false,
      status: 'ACTIVE',
    });
    expect(tasks).toEqual({ tasks: [created], total: 1 });
    expect(JSON.stringify(created)).not.toMatch(/session|version|trigger|tenant|subject/i);
    gateway.close();
  });

  it('updates only active tasks and deletes them from management queries and due scans', async () => {
    const gateway = createSqliteCronTaskGateway(await tempDatabase());
    const service = createCronTaskManagementService({
      cronTasks: gateway,
      ...executionStores(),
      now: () => 1_000,
      taskIdFactory: () => 'cron-management-2',
    });
    await service.createCronTask({ identityContext: identity, agentId, cron: '0 9 * * *', prompt: 'Daily check' });

    const updated = await service.updateCronTask({
      identityContext: identity,
      agentId,
      taskId: 'cron-management-2',
      cron: '*/5 * * * *',
      prompt: 'Updated check',
      recurring: false,
    });
    expect(updated).toMatchObject({ cron: '*/5 * * * *', prompt: 'Updated check', recurring: false });

    await service.deleteCronTask({ identityContext: identity, agentId, taskId: 'cron-management-2' });
    await expect(service.listCronTasks({ identityContext: identity, agentId })).resolves.toEqual({ tasks: [], total: 0 });
    await expect(gateway.listDueTasks({ dueAtOrBefore: brand<number, 'EpochMillis'>(Number.MAX_SAFE_INTEGER), limit: 10 })).resolves.toEqual([]);
    await expect(service.updateCronTask({ identityContext: identity, agentId, taskId: 'cron-management-2', prompt: 'late' })).rejects.toMatchObject({
      code: 'CRON_TASK_NOT_FOUND',
    });
    gateway.close();
  });

  it('persists, updates, clears and rejects conflicting explicit targets', async () => {
    const gateway = createSqliteCronTaskGateway(await tempDatabase());
    const service = createCronTaskManagementService({
      cronTasks: gateway,
      ...executionStores(),
      now: () => 1_000,
      taskIdFactory: () => 'cron-management-target',
    });

    const created = await service.createCronTask({
      identityContext: identity,
      agentId,
      cron: '*/5 * * * *',
      prompt: 'Check LTE handover failures',
      target: { kind: 'SKILL', name: 'ran-diagnosis' },
    });
    expect(created).toMatchObject({ target: { kind: 'SKILL', name: 'ran-diagnosis' } });
    await expect(gateway.listDueTasks({ dueAtOrBefore: brand<number, 'EpochMillis'>(Number.MAX_SAFE_INTEGER), limit: 10 })).resolves.toEqual([
      expect.objectContaining({
        targetKind: 'SKILL',
        targetName: 'ran-diagnosis',
      }),
    ]);

    const updated = await service.updateCronTask({
      identityContext: identity,
      agentId,
      taskId: created.taskId,
      target: { kind: 'WORKFLOW', name: 'daily-report' },
    });
    expect(updated).toMatchObject({ target: { kind: 'WORKFLOW', name: 'daily-report' } });

    const cleared = await service.updateCronTask({
      identityContext: identity,
      agentId,
      taskId: created.taskId,
      target: null,
    });
    expect(cleared.target).toBeUndefined();

    await expect(
      service.updateCronTask({
        identityContext: identity,
        agentId,
        taskId: created.taskId,
        prompt: '$workflow:daily-report run',
        target: { kind: 'WORKFLOW', name: 'daily-report' },
      }),
    ).rejects.toMatchObject({ code: 'CRON_TASK_TARGET_PROMPT_CONFLICT' });
    gateway.close();
  });

  it('rejects inactive update and invalid management input', async () => {
    const gateway = createSqliteCronTaskGateway(await tempDatabase());
    const service = createCronTaskManagementService({
      cronTasks: gateway,
      ...executionStores(),
      now: () => 1_000,
      taskIdFactory: () => 'cron-management-3',
    });
    const created = await service.createCronTask({ identityContext: identity, agentId, cron: '0 9 * * *', prompt: 'Daily check', recurring: false });
    await gateway.claimCronTrigger({
      tenantId,
      subjectId,
      agentId,
      taskId: created.taskId,
      triggerId: 'trigger-once',
      scheduledAt: created.nextRunAt,
      claimedAt: created.nextRunAt,
    });

    await expect(service.updateCronTask({ identityContext: identity, agentId, taskId: created.taskId, prompt: 'reactivate' })).rejects.toMatchObject({
      code: 'CRON_TASK_NOT_ACTIVE',
    });
    await expect(service.createCronTask({ identityContext: identity, agentId, cron: 'bad', prompt: 'Daily check' })).rejects.toMatchObject({
      code: 'CRON_INVALID_EXPRESSION',
    });
    await expect(service.updateCronTask({ identityContext: identity, agentId, taskId: created.taskId })).rejects.toMatchObject({
      code: 'REQUEST_VALIDATION_FAILED',
    });
    gateway.close();
  });

  it('lists trigger executions with the committed terminal preview/ref projection', async () => {
    const gateway = createSqliteCronTaskGateway(await tempDatabase());
    const sessionId = brand<string, 'SessionId'>('session-exec-1');
    const runId = brand<string, 'RequestRunId'>('run-exec-1');
    const requestId = brand<string, 'MessageId'>('request-exec-1');
    const terminalMessageId = brand<string, 'MessageId'>('terminal-message-exec-1');
    const requestContextId = brand<string, 'RequestContextId'>('request-context-exec-1');
    const committedResultContent = '<persisted-content>\nFile path: tool-results/cron-result.txt\nPreview: bounded Cron result';
    const service = createCronTaskManagementService({
      cronTasks: gateway,
      requestRuns: {
        loadRun: async () => ({
          tenantId,
          subjectId,
          agentId,
          sessionId,
          runId,
          requestId,
          agentVersion: brand<string, 'AgentVersion'>('agent-version-1'),
          agentAssemblyRef: 'assembly-1',
          attempt: 1,
          status: 'COMPLETED' as const,
          version: 2,
          terminalCommitState: 'COMMITTED' as const,
          createdAt: brand<number, 'EpochMillis'>(2_002),
          updatedAt: brand<number, 'EpochMillis'>(2_050),
        }),
      },
      timeline: {
        listEvents: async () => [
          {
            tenantId,
            subjectId,
            agentId,
            agentVersion: brand<string, 'AgentVersion'>('agent-version-1'),
            eventId: 'event-terminal-1',
            sessionId,
            runId,
            requestId,
            requestContextId,
            sequence: brand<number, 'TimelineSequence'>(1),
            type: 'REQUEST_COMPLETED' as const,
            inlinePayload: { terminalMessageId, content: 'legacy-event-body-must-not-be-used' },
            createdAt: brand<number, 'EpochMillis'>(2_060),
          },
        ],
      },
      messages: {
        loadMessage: async () => ({
          tenantId,
          subjectId,
          agentId,
          sessionId,
          requestId,
          runId,
          messageId: terminalMessageId,
          role: 'ASSISTANT' as const,
          content: committedResultContent,
          contentType: 'PLAIN_TEXT' as const,
          metadata: {
            eventType: 'REQUEST_COMPLETED',
            status: 'COMPLETED',
            replacement: { contentRef: { refId: 'tool-results/cron-result.txt', refType: 'CAPABILITY_RESULT' } },
          },
          visible: true,
          createdAt: brand<number, 'EpochMillis'>(2_060),
        }),
      },
      now: () => 1_000,
      taskIdFactory: () => 'cron-management-4',
    });
    const created = await service.createCronTask({ identityContext: identity, agentId, cron: '*/5 * * * *', prompt: 'Run check' });
    await gateway.claimCronTrigger({
      tenantId,
      subjectId,
      agentId,
      taskId: created.taskId,
      triggerId: 'trigger-exec-1',
      scheduledAt: created.nextRunAt,
      nextRunAt: brand<number, 'EpochMillis'>(created.nextRunAt + 300_000),
      claimedAt: brand<number, 'EpochMillis'>(2_001),
    });
    await gateway.bindCronTriggerRun({
      tenantId,
      subjectId,
      agentId,
      sessionId,
      taskId: created.taskId,
      triggerId: 'trigger-exec-1',
      requestRunId: runId,
      acceptedAt: brand<number, 'EpochMillis'>(2_002),
    });

    await expect(service.listCronTaskExecutions({ identityContext: identity, agentId, taskId: created.taskId })).resolves.toEqual({
      executions: [
        expect.objectContaining({
          triggerId: 'trigger-exec-1',
          taskId: created.taskId,
          triggerStatus: 'ACCEPTED',
          sessionId,
          requestRunId: runId,
          runStatus: 'COMPLETED',
          terminalCommitState: 'COMMITTED',
          resultEventType: 'REQUEST_COMPLETED',
          resultContent: committedResultContent,
          resultAt: 2_060,
        }),
      ],
      total: 1,
    });
    gateway.close();
  });

  it.each(['missing', 'hidden', 'malformed-visible', 'wrong-metadata', 'inconsistent-terminal', 'gateway-error'] as const)(
    'does not recover Cron result content from the terminal Event when its Message association is %s',
    async (associationCase) => {
      const gateway = createSqliteCronTaskGateway(await tempDatabase());
      const sessionId = brand<string, 'SessionId'>('session-exec-missing-message');
      const runId = brand<string, 'RequestRunId'>('run-exec-missing-message');
      const requestId = brand<string, 'MessageId'>('request-exec-missing-message');
      const service = createCronTaskManagementService({
        cronTasks: gateway,
        requestRuns: {
          loadRun: async () => ({
            tenantId,
            subjectId,
            agentId,
            sessionId,
            runId,
            requestId,
            agentVersion: brand<string, 'AgentVersion'>('agent-version-1'),
            agentAssemblyRef: 'assembly-1',
            attempt: 1,
            status: 'COMPLETED' as const,
            version: 2,
            terminalCommitState: 'COMMITTED' as const,
            createdAt: brand<number, 'EpochMillis'>(2_002),
            updatedAt: brand<number, 'EpochMillis'>(2_050),
          }),
        },
        timeline: {
          listEvents: async () => [
            {
              tenantId,
              subjectId,
              agentId,
              agentVersion: brand<string, 'AgentVersion'>('agent-version-1'),
              eventId: 'event-terminal-missing-message',
              sessionId,
              runId,
              requestId,
              requestContextId: brand<string, 'RequestContextId'>('request-context-exec-missing-message'),
              sequence: brand<number, 'TimelineSequence'>(1),
              type: associationCase === 'inconsistent-terminal' ? ('REQUEST_FAILED' as const) : ('REQUEST_COMPLETED' as const),
              inlinePayload: {
                terminalMessageId: 'terminal-message-missing',
                content: 'legacy-event-body-must-not-be-used',
              },
              createdAt: brand<number, 'EpochMillis'>(2_060),
            },
          ],
        },
        messages: {
          loadMessage: async () => {
            if (associationCase === 'gateway-error') {
              throw new Error('message gateway unavailable');
            }
            if (associationCase === 'missing') {
              return undefined;
            }
            const visible = associationCase === 'malformed-visible' ? ('true' as unknown as boolean) : associationCase !== 'hidden';
            return {
              tenantId,
              subjectId,
              agentId,
              sessionId,
              requestId,
              runId,
              messageId: brand<string, 'MessageId'>('terminal-message-missing'),
              role: 'ASSISTANT' as const,
              content: 'message-body-must-not-be-exposed',
              contentType: 'PLAIN_TEXT' as const,
              metadata: {
                eventType:
                  associationCase === 'wrong-metadata' || associationCase === 'inconsistent-terminal' ? 'REQUEST_FAILED' : 'REQUEST_COMPLETED',
                status: 'COMPLETED',
              },
              visible,
              createdAt: brand<number, 'EpochMillis'>(2_060),
            };
          },
        },
        now: () => 1_000,
        taskIdFactory: () => 'cron-management-missing-message',
      });
      const created = await service.createCronTask({ identityContext: identity, agentId, cron: '*/5 * * * *', prompt: 'Run check' });
      await gateway.claimCronTrigger({
        tenantId,
        subjectId,
        agentId,
        taskId: created.taskId,
        triggerId: 'trigger-exec-missing-message',
        scheduledAt: created.nextRunAt,
        nextRunAt: brand<number, 'EpochMillis'>(created.nextRunAt + 300_000),
        claimedAt: brand<number, 'EpochMillis'>(2_001),
      });
      await gateway.bindCronTriggerRun({
        tenantId,
        subjectId,
        agentId,
        sessionId,
        taskId: created.taskId,
        triggerId: 'trigger-exec-missing-message',
        requestRunId: runId,
        acceptedAt: brand<number, 'EpochMillis'>(2_002),
      });

      if (associationCase === 'gateway-error') {
        await expect(service.listCronTaskExecutions({ identityContext: identity, agentId, taskId: created.taskId })).rejects.toThrow(
          'message gateway unavailable',
        );
        gateway.close();
        return;
      }

      const result = await service.listCronTaskExecutions({ identityContext: identity, agentId, taskId: created.taskId });

      expect(result.executions[0]).toMatchObject({
        resultEventType: associationCase === 'inconsistent-terminal' ? 'REQUEST_FAILED' : 'REQUEST_COMPLETED',
        resultAt: 2_060,
      });
      expect(result.executions[0]).not.toHaveProperty('resultContent');
      gateway.close();
    },
  );

  it('executes an active task immediately through the cron delivery path', async () => {
    const gateway = createSqliteCronTaskGateway(await tempDatabase());
    const delivered = vi.fn(async ({ trigger }: { readonly trigger: { readonly triggerId: string } }) => {
      await gateway.bindCronTriggerRun({
        tenantId,
        subjectId,
        agentId,
        sessionId: brand<string, 'SessionId'>('session-now'),
        taskId: 'cron-management-now',
        triggerId: trigger.triggerId,
        requestRunId: brand<string, 'RequestRunId'>('run-now'),
        acceptedAt: brand<number, 'EpochMillis'>(2_001),
      });
    });
    const service = createCronTaskManagementService({
      cronTasks: gateway,
      ...executionStores(),
      delivery: { deliver: delivered },
      now: () => 2_000,
      taskIdFactory: () => 'cron-management-now',
      triggerIdFactory: () => 'trigger-now',
    });
    await service.createCronTask({ identityContext: identity, agentId, cron: '*/5 * * * *', prompt: 'Run now check' });

    const execution = await service.executeCronTask({ identityContext: identity, agentId, taskId: 'cron-management-now' });

    expect(delivered).toHaveBeenCalledWith(
      expect.objectContaining({
        task: expect.objectContaining({ taskId: 'cron-management-now', prompt: 'Run now check' }),
        trigger: expect.objectContaining({ triggerId: 'trigger-now', scheduledAt: 2_000 }),
        signal: expect.any(AbortSignal),
      }),
    );
    expect(execution).toMatchObject({
      triggerId: 'trigger-now',
      taskId: 'cron-management-now',
      scheduledAt: 2_000,
      triggerStatus: 'ACCEPTED',
      sessionId: 'session-now',
      requestRunId: 'run-now',
    });
    expect(JSON.stringify(execution)).not.toMatch(/tenant|subject|agentId/i);
    gateway.close();
  });

  it('pages trigger executions with a maximum public page size of 50', async () => {
    const gateway = createSqliteCronTaskGateway(await tempDatabase());
    const service = createCronTaskManagementService({
      cronTasks: gateway,
      ...executionStores(),
      now: () => 1_000,
      taskIdFactory: () => 'cron-management-5',
    });
    const created = await service.createCronTask({ identityContext: identity, agentId, cron: '*/5 * * * *', prompt: 'Run paged checks' });
    for (let index = 0; index < 52; index += 1) {
      const scheduledAt = brand<number, 'EpochMillis'>(created.nextRunAt + index * 300_000);
      await gateway.claimCronTrigger({
        tenantId,
        subjectId,
        agentId,
        taskId: created.taskId,
        triggerId: `trigger-page-${index}`,
        scheduledAt,
        nextRunAt: brand<number, 'EpochMillis'>(scheduledAt + 300_000),
        claimedAt: brand<number, 'EpochMillis'>(scheduledAt + 1),
      });
    }

    const firstPage = await service.listCronTaskExecutions({ identityContext: identity, agentId, taskId: created.taskId, limit: 50 });
    const secondPage = await service.listCronTaskExecutions({ identityContext: identity, agentId, taskId: created.taskId, offset: 50, limit: 50 });

    expect(firstPage.executions).toHaveLength(50);
    expect(firstPage).toMatchObject({ total: 52 });
    expect(firstPage.executions[0]?.triggerId).toBe('trigger-page-51');
    expect(secondPage.executions.map((execution) => execution.triggerId)).toEqual(['trigger-page-1', 'trigger-page-0']);
    expect(secondPage).toMatchObject({ total: 52 });
    await expect(service.listCronTaskExecutions({ identityContext: identity, agentId, taskId: created.taskId, limit: 51 })).rejects.toMatchObject({
      code: 'REQUEST_VALIDATION_FAILED',
    });
    gateway.close();
  });

  it('pages task list with a maximum public page size of 50', async () => {
    const gateway = createSqliteCronTaskGateway(await tempDatabase());
    let now = 1_000;
    const service = createCronTaskManagementService({
      cronTasks: gateway,
      ...executionStores(),
      now: () => now++,
      taskIdFactory: (() => {
        let index = 0;
        return () => `cron-task-page-${index++}`;
      })(),
    });
    for (let index = 0; index < 50; index += 1) {
      await service.createCronTask({ identityContext: identity, agentId, cron: '*/5 * * * *', prompt: `Run task page check ${index}` });
    }

    const firstPage = await service.listCronTasks({ identityContext: identity, agentId, limit: 50 });
    const secondPage = await service.listCronTasks({ identityContext: identity, agentId, offset: 50, limit: 50 });

    expect(firstPage.tasks).toHaveLength(50);
    expect(firstPage).toMatchObject({ total: 50 });
    expect(firstPage.tasks[0]?.taskId).toBe('cron-task-page-49');
    expect(secondPage.tasks).toEqual([]);
    expect(secondPage).toMatchObject({ total: 50 });
    await expect(service.listCronTasks({ identityContext: identity, agentId, limit: 51 })).rejects.toMatchObject({
      code: 'REQUEST_VALIDATION_FAILED',
    });
    await expect(
      service.createCronTask({ identityContext: identity, agentId, cron: '*/5 * * * *', prompt: 'Run overflow task check' }),
    ).rejects.toMatchObject({
      code: 'CRON_TASK_LIMIT_REACHED',
      category: 'CONFLICT',
      retryable: false,
    });
    gateway.close();
  });
});

function executionStores() {
  return {
    requestRuns: {
      loadRun: async () => undefined,
    },
    timeline: {
      listEvents: async () => [],
    },
    messages: {
      loadMessage: async () => undefined,
    },
  };
}

async function tempDatabase(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'nextagent-cron-management-'));
  directories.push(directory);
  return join(directory, 'gateway.sqlite');
}
