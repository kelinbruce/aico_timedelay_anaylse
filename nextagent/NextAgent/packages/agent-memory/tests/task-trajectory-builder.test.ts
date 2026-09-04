import { brand, type EpochMillis } from '@nextagent/agent-common';
import type { RequestRunRecord, RunTimelineEventRecord, SessionMessageRecord } from '@nextagent/agent-contracts/gateway';
import { createTaskTrajectoryBuilder } from '../src/task-trajectory-builder.js';
import { describe, expect, it } from 'vitest';

const scope = {
  tenantId: brand<string, 'TenantId'>('tenant-task-builder'),
  subjectId: brand<string, 'SubjectId'>('subject-task-builder'),
  agentId: brand<string, 'AgentId'>('agent-task-builder'),
};
const now = (value: number): EpochMillis => brand<number, 'EpochMillis'>(value);

describe('TaskTrajectoryBuilder', () => {
  it('builds safe trajectory projection without raw conversation, tool output, paths, credentials, or tokens', async () => {
    const run = runRecord('run-builder-redaction', 'COMPLETED');
    const builder = createTaskTrajectoryBuilder({
      requestRuns: { loadRun: async () => run },
      messages: {
        listCurrentRequestMessages: async () => ({
          items: [
            messageRecord(run, 'USER', 'raw user prompt secret-token /tmp/private.txt'),
            messageRecord(run, 'ASSISTANT', 'raw assistant model output'),
          ],
          limit: 50,
          hasMore: false,
        }),
      },
      timeline: {
        listEvents: async () => [
          timelineEvent(
            run,
            'CAPABILITY_COMPLETED',
            { toolName: 'Read', status: 'SUCCEEDED', content: 'raw tool output token=secret', path: 'C:/secret.txt' },
            2,
          ),
          timelineEvent(run, 'REQUEST_COMPLETED', { content: 'raw terminal answer secret-token' }, 3),
        ],
      },
      now: () => now(4_000),
    });

    const result = await builder.build(buildRef(run));
    expect(result.status).toBe('BUILT');
    const recordJson = JSON.stringify(result.status === 'BUILT' ? result.record : {});
    expect(recordJson).not.toContain('raw user prompt');
    expect(recordJson).not.toContain('raw assistant');
    expect(recordJson).not.toContain('raw tool output');
    expect(recordJson).not.toContain('secret-token');
    expect(recordJson).not.toContain('C:/secret.txt');
    expect(recordJson).not.toContain('/tmp/private.txt');
    expect(result.status === 'BUILT' ? result.record.taskOutcomeStatus : undefined).toBe('UNKNOWN');
    expect(result.status === 'BUILT' ? result.record.outcomeEvidenceLevel : undefined).toBe('TOOL_STATUS');
  });

  it('projects telecom troubleshooting tool events into safe trajectory facts', async () => {
    const run = runRecord('run-builder-telecom-flow', 'COMPLETED');
    const builder = createTaskTrajectoryBuilder({
      requestRuns: { loadRun: async () => run },
      messages: {
        listCurrentRequestMessages: async () => ({
          items: [messageRecord(run, 'USER', '请检查北区 BGP peer，token=raw-secret')],
          limit: 50,
          hasMore: false,
        }),
      },
      timeline: {
        listEvents: async () => [
          timelineEvent(
            run,
            'CAPABILITY_STARTED',
            { toolName: 'CheckBgpPeer', status: 'STARTED', command: 'display bgp peer', credential: 'raw-secret' },
            2,
          ),
          timelineEvent(
            run,
            'CAPABILITY_COMPLETED',
            { toolName: 'CheckBgpPeer', status: 'SUCCEEDED', result: 'raw peer table token=raw-secret', verification: true },
            3,
          ),
          timelineEvent(run, 'REQUEST_COMPLETED', { content: 'raw assistant diagnosis' }, 4),
        ],
      },
      now: () => now(5_000),
    });

    const result = await builder.build(buildRef(run));

    expect(result).toMatchObject({
      status: 'BUILT',
      record: {
        taskKind: 'TROUBLESHOOTING',
        taskOutcomeStatus: 'SUCCEEDED',
        outcomeEvidenceLevel: 'VERIFICATION',
        goalSummary: 'Committed completed request run.',
        constraintSummaries: [],
        actions: [
          expect.objectContaining({
            kind: 'VERIFICATION',
            summary: 'CAPABILITY_STARTED capability:CheckBgpPeer status:STARTED',
            status: 'UNKNOWN',
          }),
          expect.objectContaining({
            kind: 'VERIFICATION',
            summary: 'CAPABILITY_COMPLETED capability:CheckBgpPeer status:SUCCEEDED',
            status: 'SUCCEEDED',
          }),
        ],
        observations: expect.arrayContaining([
          expect.objectContaining({ kind: 'TERMINAL_STATUS', summary: 'Terminal status COMPLETED.' }),
          expect.objectContaining({ kind: 'TOOL_RESULT', summary: 'CAPABILITY_COMPLETED capability:CheckBgpPeer status:SUCCEEDED' }),
        ]),
      },
    });
    const recordJson = JSON.stringify(result.status === 'BUILT' ? result.record : {});
    expect(recordJson).not.toContain('北区 BGP peer');
    expect(recordJson).not.toContain('display bgp peer');
    expect(recordJson).not.toContain('raw peer table');
    expect(recordJson).not.toContain('raw assistant diagnosis');
    expect(recordJson).not.toContain('raw-secret');
  });

  it('projects explicit telecom definitions without copying raw user message text', async () => {
    const run = runRecord('run-builder-telecom-definition', 'COMPLETED');
    const builder = createTaskTrajectoryBuilder({
      requestRuns: { loadRun: async () => run },
      messages: {
        listCurrentRequestMessages: async () => ({
          items: [messageRecord(run, 'USER', '刚才我查了下资料，ALARM-12233是磁盘故障告警，需要记录一下。')],
          limit: 50,
          hasMore: false,
        }),
      },
      timeline: { listEvents: async () => [timelineEvent(run, 'REQUEST_COMPLETED', { content: 'ack' }, 2)] },
      now: () => now(5_000),
    });

    const result = await builder.build(buildRef(run));

    expect(result).toMatchObject({
      status: 'BUILT',
      record: {
        observations: expect.arrayContaining([
          expect.objectContaining({
            kind: 'REQUEST_FACT',
            summary: 'definition: ALARM-12233 is 磁盘故障告警',
          }),
        ]),
      },
    });
    const recordJson = JSON.stringify(result.status === 'BUILT' ? result.record : {});
    expect(recordJson).toContain('ALARM-12233');
    expect(recordJson).not.toContain('刚才我查了下资料');
    expect(recordJson).not.toContain('需要记录一下');
  });

  it('projects weak telecom relationship notes for LLM extraction without copying leading raw text', async () => {
    const run = runRecord('run-builder-telecom-llm-note', 'COMPLETED');
    const builder = createTaskTrajectoryBuilder({
      requestRuns: { loadRun: async () => run },
      messages: {
        listCurrentRequestMessages: async () => ({
          items: [messageRecord(run, 'USER', '故障字典里，BGP-PEER-DOWN 归到 BGP 邻居中断类告警。')],
          limit: 50,
          hasMore: false,
        }),
      },
      timeline: { listEvents: async () => [timelineEvent(run, 'REQUEST_COMPLETED', { content: 'ack' }, 2)] },
      now: () => now(5_000),
    });

    const result = await builder.build(buildRef(run));

    expect(result).toMatchObject({
      status: 'BUILT',
      record: {
        observations: expect.arrayContaining([
          expect.objectContaining({
            kind: 'REQUEST_FACT',
            summary: 'llm-note: BGP-PEER-DOWN 归到 BGP 邻居中断类告警',
          }),
        ]),
      },
    });
    const recordJson = JSON.stringify(result.status === 'BUILT' ? result.record : {});
    expect(recordJson).toContain('BGP-PEER-DOWN');
    expect(recordJson).not.toContain('故障字典里');
  });

  it('does not treat terminal commit completion as business success without evidence', async () => {
    const run = runRecord('run-builder-unknown', 'COMPLETED');
    const builder = createTaskTrajectoryBuilder({
      requestRuns: { loadRun: async () => run },
      messages: { listCurrentRequestMessages: async () => ({ items: [messageRecord(run, 'USER', 'diagnose alarm')], limit: 50, hasMore: false }) },
      timeline: { listEvents: async () => [timelineEvent(run, 'REQUEST_COMPLETED', { content: 'done' }, 2)] },
      now: () => now(4_000),
    });

    const result = await builder.build(buildRef(run));
    expect(result).toMatchObject({
      status: 'BUILT',
      record: {
        taskOutcomeStatus: 'UNKNOWN',
        outcomeEvidenceLevel: 'MODEL_CLAIM',
      },
    });
  });

  it('uses verification evidence to mark completed tasks as succeeded', async () => {
    const run = runRecord('run-builder-verification', 'COMPLETED');
    const builder = createTaskTrajectoryBuilder({
      requestRuns: { loadRun: async () => run },
      messages: {
        listCurrentRequestMessages: async () => ({ items: [messageRecord(run, 'USER', 'apply and verify config')], limit: 50, hasMore: false }),
      },
      timeline: {
        listEvents: async () => [
          timelineEvent(run, 'CAPABILITY_COMPLETED', { toolName: 'ApplyConfig', status: 'SUCCEEDED' }, 2),
          timelineEvent(run, 'CAPABILITY_COMPLETED', { toolName: 'VerifyConfig', status: 'SUCCEEDED', verification: true }, 3),
          timelineEvent(run, 'REQUEST_COMPLETED', { content: 'verified' }, 4),
        ],
      },
      now: () => now(5_000),
    });

    const result = await builder.build(buildRef(run));
    expect(result).toMatchObject({
      status: 'BUILT',
      record: {
        taskOutcomeStatus: 'SUCCEEDED',
        outcomeEvidenceLevel: 'VERIFICATION',
        taskKind: 'CONFIG_CHANGE',
      },
    });
  });

  it('ignores non-terminal event ids when selecting terminal source refs', async () => {
    const run = runRecord('run-builder-terminal-ref', 'COMPLETED');
    const builder = createTaskTrajectoryBuilder({
      requestRuns: { loadRun: async () => run },
      messages: { listCurrentRequestMessages: async () => ({ items: [messageRecord(run, 'USER', 'diagnose alarm')], limit: 50, hasMore: false }) },
      timeline: {
        listEvents: async () => [
          timelineEvent(run, 'CAPABILITY_COMPLETED', { toolName: 'CheckPeer', status: 'SUCCEEDED' }, 2),
          timelineEvent(run, 'REQUEST_COMPLETED', { content: 'done' }, 3),
        ],
      },
      now: () => now(5_000),
    });

    const result = await builder.build({
      ...buildRef(run),
      terminalTimelineEventId: `event-${run.runId}-2`,
    });

    expect(result).toMatchObject({
      status: 'BUILT',
      record: {
        completedAt: now(1_003),
      },
    });
    expect(JSON.stringify(result.status === 'BUILT' ? result.record.sourceRefs : [])).toContain(`event-${run.runId}-terminal`);
  });

  it('skips terminal facts that cannot form a task trajectory', async () => {
    const run = runRecord('run-builder-skip', 'COMPLETED');
    const builder = createTaskTrajectoryBuilder({
      requestRuns: { loadRun: async () => run },
      messages: { listCurrentRequestMessages: async () => ({ items: [], limit: 50, hasMore: false }) },
      timeline: { listEvents: async () => [timelineEvent(run, 'REQUEST_COMPLETED', {}, 2)] },
      now: () => now(5_000),
    });

    await expect(builder.build(buildRef(run))).resolves.toMatchObject({
      status: 'SKIPPED',
      reasonCode: 'TASK_TRAJECTORY_NOT_APPLICABLE',
    });
  });
});

function buildRef(run: RequestRunRecord) {
  return {
    tenantId: run.tenantId,
    subjectId: run.subjectId,
    agentId: run.agentId,
    sessionId: run.sessionId,
    requestId: run.requestId,
    requestRunId: run.runId,
    terminalTimelineEventId: `event-${run.runId}-terminal`,
    terminalTimelineSequence: brand<number, 'TimelineSequence'>(3),
    terminalCommittedAt: now(3_000),
  };
}

function runRecord(runId: string, status: RequestRunRecord['status']): RequestRunRecord {
  return {
    ...scope,
    runId: brand<string, 'RequestRunId'>(runId),
    sessionId: brand<string, 'SessionId'>(`session-${runId}`),
    requestId: brand<string, 'MessageId'>(`request-${runId}`),
    agentVersion: brand<string, 'AgentVersion'>('v1'),
    agentAssemblyRef: 'assembly:v1',
    attempt: 1,
    status,
    version: 2,
    terminalCommitState: 'COMMITTED',
    createdAt: now(1_000),
    updatedAt: now(3_000),
  };
}

function messageRecord(run: RequestRunRecord, role: SessionMessageRecord['role'], content: string): SessionMessageRecord {
  return {
    ...scope,
    messageId: brand<string, 'MessageId'>(`message-${run.runId}-${role}`),
    sessionId: run.sessionId,
    requestId: run.requestId,
    runId: run.runId,
    role,
    content,
    contentType: 'PLAIN_TEXT',
    metadata: {},
    visible: true,
    createdAt: now(1_500),
  };
}

function timelineEvent(
  run: RequestRunRecord,
  type: RunTimelineEventRecord['type'],
  inlinePayload: RunTimelineEventRecord['inlinePayload'],
  sequence: number,
): RunTimelineEventRecord {
  return {
    ...scope,
    agentVersion: run.agentVersion,
    eventId: type === 'REQUEST_COMPLETED' ? `event-${run.runId}-terminal` : `event-${run.runId}-${sequence}`,
    sessionId: run.sessionId,
    runId: run.runId,
    requestId: run.requestId,
    requestContextId: brand<string, 'RequestContextId'>(`context-${run.runId}`),
    sequence: brand<number, 'TimelineSequence'>(sequence),
    type,
    inlinePayload,
    createdAt: now(1_000 + sequence),
  };
}
