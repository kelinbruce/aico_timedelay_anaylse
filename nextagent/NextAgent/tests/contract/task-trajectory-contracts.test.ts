import { brand, type EpochMillis } from '@nextagent/agent-common';
import type { RequestRunRecord, RunTimelineEventRecord, SessionMessageRecord, TaskTrajectoryRecord } from '@nextagent/agent-contracts/gateway';
import { createTestGatewayStores } from '../fixtures/local-gateway.js';
import { describe, expect, it } from 'vitest';

const now = (value: number): EpochMillis => brand<number, 'EpochMillis'>(value);

describe('task trajectory gateway contracts', () => {
  it('saves task trajectories idempotently and queries only matching owner and agent scope', async () => {
    const gateway = createTestGatewayStores();
    const scope = scoped('tenant-task-trajectory', 'subject-task-trajectory', 'agent-task-trajectory');
    const otherScope = scoped('tenant-task-trajectory', 'subject-other', 'agent-task-trajectory');
    const first = trajectoryRecord(scope, 'run-trajectory-1', 1_000);
    const duplicate = await gateway.taskTrajectoryStore.saveTaskTrajectory(first, {
      idempotencyKey: brand<string, 'IdempotencyKey'>('idem-trajectory-1'),
    });
    const replay = await gateway.taskTrajectoryStore.saveTaskTrajectory(
      { ...first, taskTrajectoryId: brand<string, 'TaskTrajectoryId'>('trajectory-duplicate') },
      { idempotencyKey: brand<string, 'IdempotencyKey'>('idem-trajectory-1') },
    );
    await gateway.taskTrajectoryStore.saveTaskTrajectory(trajectoryRecord(otherScope, 'run-trajectory-other', 2_000));

    expect(duplicate).toMatchObject({ taskTrajectoryId: first.taskTrajectoryId });
    expect(replay).toMatchObject({ taskTrajectoryId: first.taskTrajectoryId });

    const page = await gateway.taskTrajectoryQuery.listTaskTrajectories({
      ...scope,
      sessionId: first.sessionId,
      taskOutcomeStatus: 'UNKNOWN',
      outcomeEvidenceLevel: 'MODEL_CLAIM',
      limit: 10,
    });
    expect('code' in page).toBe(false);
    expect((page as Exclude<typeof page, { code: string }>).items.map((item) => item.requestRunId)).toEqual([first.requestRunId]);

    const crossScope = await gateway.taskTrajectoryQuery.listTaskTrajectories({ ...otherScope, limit: 10 });
    expect('code' in crossScope).toBe(false);
    expect((crossScope as Exclude<typeof crossScope, { code: string }>).items).toHaveLength(1);
    await expect(gateway.taskTrajectoryQuery.listTaskTrajectories({ ...scope, limit: 101 })).resolves.toMatchObject({
      code: 'TASK_TRAJECTORY_QUERY_INVALID',
    });
  });

  it('returns build candidates from committed terminal facts without raw content', async () => {
    const gateway = createTestGatewayStores();
    const scope = scoped('tenant-task-trajectory', 'subject-build-candidate', 'agent-task-trajectory');
    const run = runRecord(scope, 'session-build-candidate', 'request-build-candidate', 'run-build-candidate');
    await gateway.requestRuns.saveRun(run, { idempotencyKey: brand<string, 'IdempotencyKey'>('idem-run-build-candidate') });
    const nonTerminal = await gateway.timeline.appendEvent(nonTerminalEvent(scope, run), {
      idempotencyKey: brand<string, 'IdempotencyKey'>('idem-non-terminal-build-candidate'),
    });
    const commit = await gateway.requestRuns.commitTerminal({
      ...scope,
      runId: run.runId,
      expectedVersion: run.version,
      terminalStatus: 'COMPLETED',
      terminalMessage: terminalMessage(scope, run, 'raw secret prompt must stay out'),
      terminalEvent: terminalEvent(scope, run, 'raw terminal output must stay out'),
      idempotencyKey: brand<string, 'IdempotencyKey'>('idem-terminal-build-candidate'),
    });
    expect(commit.status).toBe('COMMITTED');

    const candidates = await gateway.taskTrajectoryQuery.listBuildCandidates({ ...scope, limit: 10 });
    expect('code' in candidates).toBe(false);
    const candidateItems = (candidates as Exclude<typeof candidates, { code: string }>).items;
    expect(candidateItems).toEqual([
      expect.objectContaining({
        tenantId: scope.tenantId,
        subjectId: scope.subjectId,
        agentId: scope.agentId,
        sessionId: run.sessionId,
        requestId: run.requestId,
        requestRunId: run.runId,
        terminalTimelineEventId: commit.terminalEvent?.eventId,
      }),
    ]);
    expect(candidateItems[0]?.terminalTimelineEventId).not.toBe(nonTerminal.eventId);
    expect(JSON.stringify(candidateItems)).not.toContain('raw terminal output');
    expect(JSON.stringify(candidateItems)).not.toContain('secret');

    await gateway.taskTrajectoryStore.saveTaskTrajectory({
      ...trajectoryRecord(scope, 'run-build-candidate', 3_000),
      sessionId: run.sessionId,
      requestId: run.requestId,
    });
    const afterSave = await gateway.taskTrajectoryQuery.listBuildCandidates({ ...scope, limit: 10 });
    expect('code' in afterSave).toBe(false);
    expect((afterSave as Exclude<typeof afterSave, { code: string }>).items).toHaveLength(0);
  });

  it('rejects malformed task trajectory payloads before persistence', async () => {
    const gateway = createTestGatewayStores();
    const scope = scoped('tenant-task-trajectory', 'subject-validation', 'agent-task-trajectory');
    const valid = trajectoryRecord(scope, 'run-validation', 1_000);

    await expect(
      gateway.taskTrajectoryStore.saveTaskTrajectory({
        ...valid,
        rawContent: 'raw secret must not persist',
      } as unknown as TaskTrajectoryRecord),
    ).resolves.toMatchObject({
      code: 'TASK_TRAJECTORY_WRITE_INVALID',
    });

    await expect(
      gateway.taskTrajectoryStore.saveTaskTrajectory({
        ...valid,
        observations: [
          {
            ...valid.observations[0]!,
            sourceRefs: [
              {
                refKind: 'REQUEST_RUN',
                requestRunId: valid.requestRunId,
                rawContent: 'raw nested secret must not persist',
              },
            ],
          },
        ],
      } as unknown as TaskTrajectoryRecord),
    ).resolves.toMatchObject({
      code: 'TASK_TRAJECTORY_WRITE_INVALID',
    });

    const persisted = await gateway.taskTrajectoryStore.saveTaskTrajectory(valid);
    expect(persisted).toMatchObject({ taskTrajectoryId: valid.taskTrajectoryId });
  });

  it('keeps earlier unknown trajectories immutable when later verified runs are saved', async () => {
    const gateway = createTestGatewayStores();
    const scope = scoped('tenant-task-trajectory', 'subject-immutability', 'agent-task-trajectory');
    const unknown = trajectoryRecord(scope, 'run-unknown', 1_000);
    const verified: TaskTrajectoryRecord = {
      ...trajectoryRecord(scope, 'run-verified', 2_000),
      taskOutcomeStatus: 'SUCCEEDED',
      outcomeEvidenceLevel: 'VERIFICATION',
      outcomeEvidenceRefs: [{ refKind: 'TIMELINE_EVENT', timelineEventId: 'event-verify' }],
      outcomeSummary: 'Verification evidence completed.',
    };

    await gateway.taskTrajectoryStore.saveTaskTrajectory(unknown);
    await gateway.taskTrajectoryStore.saveTaskTrajectory(verified);

    const first = await gateway.taskTrajectoryQuery.listTaskTrajectories({
      ...scope,
      requestRunId: unknown.requestRunId,
      limit: 10,
    });
    expect('code' in first).toBe(false);
    expect((first as Exclude<typeof first, { code: string }>).items).toEqual([
      expect.objectContaining({
        requestRunId: unknown.requestRunId,
        taskOutcomeStatus: 'UNKNOWN',
        outcomeEvidenceLevel: 'MODEL_CLAIM',
      }),
    ]);
  });
});

function scoped(tenantId: string, subjectId: string, agentId: string) {
  return {
    tenantId: brand<string, 'TenantId'>(tenantId),
    subjectId: brand<string, 'SubjectId'>(subjectId),
    agentId: brand<string, 'AgentId'>(agentId),
  };
}

function trajectoryRecord(scope: ReturnType<typeof scoped>, runId: string, time: number): TaskTrajectoryRecord {
  return {
    ...scope,
    taskTrajectoryId: brand<string, 'TaskTrajectoryId'>(`trajectory-${runId}`),
    sessionId: brand<string, 'SessionId'>(`session-${runId}`),
    requestId: brand<string, 'MessageId'>(`request-${runId}`),
    requestRunId: brand<string, 'RequestRunId'>(runId),
    taskKind: 'GENERAL_TASK',
    trajectoryBuildStatus: 'COMPLETED',
    taskOutcomeStatus: 'UNKNOWN',
    outcomeEvidenceLevel: 'MODEL_CLAIM',
    goalSummary: 'Committed request run.',
    constraintSummaries: ['messages:1'],
    observations: [
      {
        kind: 'TERMINAL_STATUS',
        summary: 'Terminal status COMPLETED.',
        sourceRefs: [{ refKind: 'REQUEST_RUN', requestRunId: brand<string, 'RequestRunId'>(runId) }],
        observedAt: now(time),
      },
    ],
    actions: [
      {
        kind: 'MODEL_RESPONSE',
        summary: 'Request terminal status COMPLETED.',
        status: 'UNKNOWN',
        sourceRefs: [{ refKind: 'REQUEST_RUN', requestRunId: brand<string, 'RequestRunId'>(runId) }],
        startedAt: now(time),
        completedAt: now(time + 1),
      },
    ],
    outcomeSummary: 'No verification evidence is available.',
    outcomeEvidenceRefs: [],
    sourceRefs: [{ refKind: 'REQUEST_RUN', requestRunId: brand<string, 'RequestRunId'>(runId) }],
    startedAt: now(time),
    completedAt: now(time + 1),
    createdAt: now(time + 2),
    updatedAt: now(time + 2),
  };
}

function runRecord(scope: ReturnType<typeof scoped>, sessionId: string, requestId: string, runId: string): RequestRunRecord {
  return {
    ...scope,
    runId: brand<string, 'RequestRunId'>(runId),
    sessionId: brand<string, 'SessionId'>(sessionId),
    requestId: brand<string, 'MessageId'>(requestId),
    agentVersion: brand<string, 'AgentVersion'>('v1'),
    agentAssemblyRef: 'assembly:v1',
    attempt: 1,
    status: 'EXECUTING',
    version: 1,
    terminalCommitState: 'NOT_STARTED',
    createdAt: now(1_000),
    updatedAt: now(1_000),
  };
}

function terminalMessage(scope: ReturnType<typeof scoped>, run: RequestRunRecord, content: string): SessionMessageRecord {
  return {
    ...scope,
    messageId: brand<string, 'MessageId'>(`message-${run.runId}`),
    sessionId: run.sessionId,
    requestId: run.requestId,
    runId: run.runId,
    role: 'ASSISTANT',
    content,
    contentType: 'PLAIN_TEXT',
    metadata: { eventType: 'REQUEST_COMPLETED', status: 'COMPLETED' },
    sequence: 0,
    visible: true,
    createdAt: now(2_000),
  } as SessionMessageRecord;
}

function terminalEvent(scope: ReturnType<typeof scoped>, run: RequestRunRecord, content: string): RunTimelineEventRecord {
  return {
    ...scope,
    agentVersion: run.agentVersion,
    eventId: `event-${run.runId}`,
    sessionId: run.sessionId,
    runId: run.runId,
    requestId: run.requestId,
    requestContextId: brand<string, 'RequestContextId'>(`context-${run.runId}`),
    sequence: brand<number, 'TimelineSequence'>(0),
    type: 'REQUEST_COMPLETED',
    inlinePayload: { content, terminalMessageId: `message-${run.runId}` },
    createdAt: now(2_000),
  };
}

function nonTerminalEvent(scope: ReturnType<typeof scoped>, run: RequestRunRecord): RunTimelineEventRecord {
  return {
    ...scope,
    agentVersion: run.agentVersion,
    eventId: `event-non-terminal-${run.runId}`,
    sessionId: run.sessionId,
    runId: run.runId,
    requestId: run.requestId,
    requestContextId: brand<string, 'RequestContextId'>(`context-${run.runId}`),
    sequence: brand<number, 'TimelineSequence'>(0),
    type: 'CAPABILITY_COMPLETED',
    inlinePayload: { note: 'not terminal but contains "type":"REQUEST_COMPLETED"' },
    createdAt: now(1_500),
  };
}
