import { brand } from '@nextagent/agent-common';
import { createAuditProjector, emitCronObservation, type AuditEvent, type ObservabilityObservationEvent } from '@nextagent/agent-observability';
import { describe, expect, it } from 'vitest';

const ownerScope = {
  tenantId: brand<string, 'TenantId'>('tenant-cron'),
  subjectId: brand<string, 'SubjectId'>('subject-cron'),
  agentId: brand<string, 'AgentId'>('agent-cron'),
  agentVersion: brand<string, 'AgentVersion'>('v9'),
};

describe('Cron observation audit projection', () => {
  it('projects create, delete and trigger acceptance with stable refs and no execution content', async () => {
    const observations: ObservabilityObservationEvent[] = [];
    const written: AuditEvent[] = [];
    const projector = createAuditProjector({
      async write(event) {
        written.push(event);
      },
    });
    const common = {
      projectorHost: {
        acceptObservation(event: ObservabilityObservationEvent) {
          observations.push(event);
        },
      },
      ownerScope,
      taskId: 'task-cron',
      sessionId: brand<string, 'SessionId'>('session-cron'),
      requestRunId: brand<string, 'RequestRunId'>('run-cron'),
      now: () => brand<number, 'EpochMillis'>(1_700_000_000_000),
    };

    emitCronObservation({ ...common, operation: 'CRON_TASK_CREATED' });
    emitCronObservation({ ...common, operation: 'CRON_TASK_DELETED' });
    emitCronObservation({ ...common, operation: 'CRON_TRIGGER_ACCEPTED', triggerId: 'trigger-cron' });
    for (const observation of observations) {
      await expect(projector.project(observation)).resolves.toEqual({ surface: 'AUDIT', outcome: 'emitted' });
    }

    expect(written.map((event) => event.eventName)).toEqual(['cron.task_created', 'cron.task_deleted', 'cron.trigger_accepted']);
    expect(written[2]).toMatchObject({
      requestRunId: 'run-cron',
      attributes: {
        boundary: 'system',
        operation: 'CRON_TRIGGER_ACCEPTED',
        outcome: 'success',
        agentVersion: 'v9',
        safeReasonCode: 'CRON_TRIGGER_ACCEPTED',
        sessionId: 'session-cron',
        cronTaskId: 'task-cron',
        cronTriggerId: 'trigger-cron',
      },
    });
    expect(JSON.stringify({ observations, written })).not.toMatch(/prompt|modelOutput|rawCallback|credential|vendor|token|path/i);
  });
});
