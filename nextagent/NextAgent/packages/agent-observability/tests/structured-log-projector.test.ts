import { brand, type AgentId, type AgentVersion, type EpochMillis, type SubjectId, type TenantId } from '@nextagent/agent-common';
import { describe, expect, it, vi } from 'vitest';
import {
  createObservationEvent,
  createObservabilityProjectorHost,
  createStructuredLogProjector,
  createTimelineObservationMapper,
  type TimelineObservationRecord,
} from '../src/index.js';

const ownerScope = {
  tenantId: brand<string, 'TenantId'>('tenant-log') as TenantId,
  subjectId: brand<string, 'SubjectId'>('subject-log') as SubjectId,
  agentId: brand<string, 'AgentId'>('agent-log') as AgentId,
  agentVersion: brand<string, 'AgentVersion'>('v1') as AgentVersion,
};

describe('structured log projector', () => {
  it('projects Model terminal usage and both latency fields on one entry', () => {
    const methods = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const projector = createStructuredLogProjector(methods);
    projector.project(
      createObservationEvent({
        boundary: 'model_invocation',
        operation: 'MODEL_INVOCATION_COMPLETED',
        outcome: 'success',
        ownerScope,
        occurredAt: brand<number, 'EpochMillis'>(1) as EpochMillis,
        durationMs: 40,
        firstContentLatencyMs: 12,
        usage: { inputTokens: 2, outputTokens: 3, totalTokens: 5 },
      }),
    );

    expect(methods.info).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'model.invocation.completed',
        durationMs: 40,
        firstContentLatencyMs: 12,
        usage: { inputTokens: 2, outputTokens: 3, totalTokens: 5 },
      }),
    );
  });

  it('aggregates complete request terminal usage and unique tool invocation count', () => {
    const methods = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const projector = createStructuredLogProjector(methods);
    const observations = [
      logObservation('REQUEST_ACCEPTED', 'request_lifecycle', 'success', 'run-summary', 'event-1'),
      logObservation('MODEL_INVOCATION_STARTED', 'model_invocation', 'success', 'run-summary', 'event-2', 'turn-1'),
      logObservation('MODEL_INVOCATION_COMPLETED', 'model_invocation', 'success', 'run-summary', 'event-3', 'turn-1', {
        inputTokens: 2,
        outputTokens: 3,
        totalTokens: 5,
      }),
      logObservation('MODEL_INVOCATION_STARTED', 'model_invocation', 'success', 'run-summary', 'event-4', 'turn-2'),
      logObservation('MODEL_INVOCATION_COMPLETED', 'model_invocation', 'success', 'run-summary', 'event-5', 'turn-2', {
        inputTokens: 7,
        outputTokens: 11,
        totalTokens: 18,
      }),
      capabilityStarted('run-summary', 'event-6', 'call-1'),
      capabilityStarted('run-summary', 'event-7', 'call-2'),
      capabilityStarted('run-summary', 'event-8', 'call-3'),
      capabilityStarted('run-summary', 'event-9', 'call-3'),
      logObservation('TERMINAL_COMMITTED', 'request_lifecycle', 'success', 'run-summary', 'event-10'),
    ];

    for (const observation of observations) {
      projector.project(observation);
    }

    expect(methods.info.mock.calls.at(-1)?.[0]).toMatchObject({
      event: 'request.completed',
      status: 'SUCCEEDED',
      usage: { inputTokens: 9, outputTokens: 14, totalTokens: 23 },
      toolCallCount: 3,
    });
    expect(methods.info.mock.calls.at(-1)?.[0]).not.toHaveProperty('summaryStatus');
  });

  it('marks terminal summary partial without fabricating unknown counts or missing usage', () => {
    const methods = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const projector = createStructuredLogProjector(methods);
    projector.project(logObservation('MODEL_INVOCATION_STARTED', 'model_invocation', 'success', 'run-partial', 'event-1', 'turn-1'));
    projector.project(
      logObservation('MODEL_INVOCATION_COMPLETED', 'model_invocation', 'success', 'run-partial', 'event-2', 'turn-1', { inputTokens: 2 }),
    );
    projector.project(logObservation('TERMINAL_COMMITTED', 'request_lifecycle', 'failure', 'run-partial', 'event-3'));

    const terminal = methods.error.mock.calls.at(-1)?.[0] as Record<string, unknown>;
    expect(terminal).toMatchObject({ event: 'request.failed', status: 'FAILED', summaryStatus: 'PARTIAL' });
    expect(terminal).not.toHaveProperty('toolCallCount');
    expect(terminal.usage).toEqual({ inputTokens: 2 });
    expect(JSON.stringify(terminal)).not.toMatch(/stack|cause|rawExceptionData/u);
  });

  it('preserves usage observed on a failed model terminal', () => {
    const methods = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const projector = createStructuredLogProjector(methods);
    projector.project(logObservation('REQUEST_ACCEPTED', 'request_lifecycle', 'success', 'run-failed-usage', 'event-1'));
    projector.project(logObservation('MODEL_INVOCATION_STARTED', 'model_invocation', 'success', 'run-failed-usage', 'event-2', 'turn-1'));
    projector.project(
      logObservation('MODEL_INVOCATION_FAILED', 'model_invocation', 'failure', 'run-failed-usage', 'event-3', 'turn-1', { inputTokens: 2 }),
    );
    projector.project(logObservation('TERMINAL_COMMITTED', 'request_lifecycle', 'failure', 'run-failed-usage', 'event-4'));

    expect(methods.error.mock.calls.at(-1)?.[0]).toMatchObject({
      event: 'request.failed',
      status: 'FAILED',
      usage: { inputTokens: 2 },
      toolCallCount: 0,
    });
    expect(methods.error.mock.calls.at(-1)?.[0]).not.toHaveProperty('summaryStatus');
  });

  it('deduplicates repeated model terminal timeline events', () => {
    const methods = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const projector = createStructuredLogProjector(methods);
    const completed = logObservation('MODEL_INVOCATION_COMPLETED', 'model_invocation', 'success', 'run-replay', 'event-model-terminal', 'turn-1', {
      inputTokens: 2,
      outputTokens: 3,
      totalTokens: 5,
    });
    projector.project(logObservation('REQUEST_ACCEPTED', 'request_lifecycle', 'success', 'run-replay', 'event-accepted'));
    projector.project(logObservation('MODEL_INVOCATION_STARTED', 'model_invocation', 'success', 'run-replay', 'event-model-start', 'turn-1'));
    projector.project(completed);
    projector.project(completed);
    projector.project(logObservation('TERMINAL_COMMITTED', 'request_lifecycle', 'canceled', 'run-replay', 'event-terminal'));

    expect(methods.info.mock.calls.at(-1)?.[0]).toMatchObject({
      event: 'request.canceled',
      status: 'CANCELED',
      usage: { inputTokens: 2, outputTokens: 3, totalTokens: 5 },
      toolCallCount: 0,
    });
    expect(methods.info.mock.calls.at(-1)?.[0]).not.toHaveProperty('summaryStatus');
  });

  it('marks a run partial after the projector host drops one of its observations', async () => {
    const methods = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const projector = createStructuredLogProjector(methods);
    const host = createObservabilityProjectorHost([projector], { queueCapacity: 1 });
    host.acceptObservation(logObservation('REQUEST_ACCEPTED', 'request_lifecycle', 'success', 'run-drop', 'event-1'));
    host.acceptObservation(capabilityStarted('run-drop', 'event-dropped', 'call-dropped'));
    await host.drain?.();
    host.acceptObservation(logObservation('TERMINAL_COMMITTED', 'request_lifecycle', 'success', 'run-drop', 'event-terminal'));
    await host.drain?.();

    expect(methods.info.mock.calls.at(-1)?.[0]).toMatchObject({
      event: 'request.completed',
      status: 'SUCCEEDED',
      summaryStatus: 'PARTIAL',
    });
  });

  it('projects trusted timeline trace correlation only to physical structured log entries', async () => {
    const methods = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const projector = createStructuredLogProjector(methods);
    const host = createObservabilityProjectorHost([projector]);
    const mapper = createTimelineObservationMapper();
    const traceId = '11111111111111111111111111111111';
    const requestSpanId = '2222222222222222';
    const modelSpanId = '3333333333333333';
    const capabilitySpanId = '4444444444444444';
    const records = [
      timelineRecord('REQUEST_ACCEPTED', {}, 1, traceId, requestSpanId),
      timelineRecord('MODEL_INVOCATION_STARTED', { stepId: 'turn-1', modelId: 'model-1' }, 2, traceId, modelSpanId),
      timelineRecord(
        'MODEL_INVOCATION_COMPLETED',
        { stepId: 'turn-1', modelId: 'model-1', usage: { inputTokens: 2, outputTokens: 3, totalTokens: 5 } },
        3,
        traceId,
        modelSpanId,
      ),
      timelineRecord('CAPABILITY_STARTED', { capabilityId: 'Read', toolCallId: 'call-1' }, 4, traceId, capabilitySpanId),
      timelineRecord('CAPABILITY_COMPLETED', { capabilityId: 'Read', toolCallId: 'call-1', status: 'SUCCEEDED' }, 5, traceId, capabilitySpanId),
      timelineRecord('REQUEST_COMPLETED', {}, 6, traceId, requestSpanId),
    ];

    for (const record of records) {
      for (const observation of mapper(record)) {
        host.acceptObservation(observation);
      }
    }
    await host.drain?.();

    const entries = methods.info.mock.calls.map(([entry]) => entry as Record<string, unknown>);
    expect(entries).toHaveLength(6);
    expect(new Set(entries.map((entry) => entry.traceId))).toEqual(new Set([traceId]));
    expect(entries.find((entry) => entry.event === 'request.accepted')?.spanId).toBe(requestSpanId);
    expect(entries.find((entry) => entry.event === 'request.completed')?.spanId).toBe(requestSpanId);
    expect(entries.filter((entry) => String(entry.event).startsWith('model.invocation.')).map((entry) => entry.spanId)).toEqual([
      modelSpanId,
      modelSpanId,
    ]);
    expect(entries.filter((entry) => String(entry.event).startsWith('capability.')).map((entry) => entry.spanId)).toEqual([
      capabilitySpanId,
      capabilitySpanId,
    ]);
    for (const observation of mapper(timelineRecord('REQUEST_ACCEPTED', {}, 7))) {
      expect(observation).not.toHaveProperty('traceId');
      expect(observation).not.toHaveProperty('spanId');
      host.acceptObservation(observation);
    }
    await host.drain?.();
    expect(methods.info.mock.calls.at(-1)?.[0]).not.toHaveProperty('traceId');
    expect(methods.info.mock.calls.at(-1)?.[0]).not.toHaveProperty('spanId');
  });

  it('does not trust trace-like fields submitted on an observation object', () => {
    const methods = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const projector = createStructuredLogProjector(methods);
    const observation = {
      ...createObservationEvent({
        boundary: 'request_lifecycle',
        operation: 'REQUEST_ACCEPTED',
        outcome: 'success',
        ownerScope,
        occurredAt: brand<number, 'EpochMillis'>(1) as EpochMillis,
        stableRefs: { requestRunId: 'run-spoof' },
      }),
      traceId: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      spanId: 'bbbbbbbbbbbbbbbb',
    };

    projector.project(observation);

    expect(methods.info.mock.calls[0]?.[0]).not.toHaveProperty('traceId');
    expect(methods.info.mock.calls[0]?.[0]).not.toHaveProperty('spanId');
  });

  it.each([
    ['POLICY_APPLIED', 'success', 'info', 'policy.allowed'],
    ['CAPABILITY_DENIED', 'denied', 'warn', 'capability.denied'],
    ['CAPABILITY_FAILED', 'failure', 'error', 'capability.failed'],
    ['CAPABILITY_COMPLETED', 'success', 'info', 'capability.completed'],
  ] as const)('routes %s/%s through logical %s', (operation, outcome, level, expectedEvent) => {
    const methods = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const projector = createStructuredLogProjector(methods);

    expect(
      projector.project(
        createObservationEvent({
          boundary: operation.startsWith('POLICY') ? 'system' : 'capability_invocation',
          operation,
          outcome,
          ownerScope,
          occurredAt: brand<number, 'EpochMillis'>(1) as EpochMillis,
          stableRefs: { requestRunId: 'run-1', capabilityInvocationId: 'call-1' },
          safeReasonCode: 'SAFE_REASON',
        }),
      ).outcome,
    ).toBe('emitted');

    expect(methods[level]).toHaveBeenCalledOnce();
    const entry = methods[level].mock.calls[0]![0];
    expect(entry).toMatchObject({
      event: expectedEvent,
      agentId: ownerScope.agentId,
      agentVersion: ownerScope.agentVersion,
      runId: 'run-1',
      capabilityInvocationId: 'call-1',
      safeReasonCode: 'SAFE_REASON',
    });
    expect(entry).not.toHaveProperty('level');
    expect(entry).not.toHaveProperty('details');
    expect(entry).not.toHaveProperty('ownerScope');
    expect(entry).not.toHaveProperty('correlation');
    expect(entry).not.toHaveProperty('operation');
    expect(entry).not.toHaveProperty('outcome');
    expect(entry).not.toHaveProperty('tenantId');
    expect(entry).not.toHaveProperty('subjectId');
  });

  it('promotes stepId and writes only approved bounded arrays to the runtime logger', () => {
    const methods = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const projector = createStructuredLogProjector(methods);
    projector.project(
      createObservationEvent({
        boundary: 'model_invocation',
        operation: 'MODEL_INVOCATION_STARTED',
        outcome: 'success',
        ownerScope,
        occurredAt: brand<number, 'EpochMillis'>(1) as EpochMillis,
        stableRefs: { requestRunId: 'run-array' },
        diagnosticSnapshot: {
          diagnosticCandidates: [
            { key: 'stepId', value: 'turn-1', classification: 'LOW_CARDINALITY', cardinality: 'LOW' },
            { key: 'disclosedCapabilityNames', value: ['Read', 'Grep'], classification: 'SAFE', cardinality: 'LOW' },
            { key: 'arbitraryNames', value: ['secret'], classification: 'SAFE', cardinality: 'LOW' },
          ],
        },
      }),
    );

    expect(methods.info).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'model.invocation.started',
        stepId: 'turn-1',
        details: { disclosedCapabilityNames: ['Read', 'Grep'] },
      }),
    );
    expect(methods.info.mock.calls[0]![0].details).not.toHaveProperty('stepId');
    expect(methods.info.mock.calls[0]![0].details).not.toHaveProperty('arbitraryNames');
  });

  it('writes safe memory recall counts and disposition to the hook log', () => {
    const methods = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const projector = createStructuredLogProjector(methods);

    projector.project(
      createObservationEvent({
        boundary: 'system',
        operation: 'HOOK_INVOKED',
        outcome: 'success',
        ownerScope,
        occurredAt: brand<number, 'EpochMillis'>(1) as EpochMillis,
        stableRefs: { sessionId: 'session-1', requestId: 'request-1', requestRunId: 'run-1' },
        safeReasonCode: 'MEMORY_RECALL_L1_CONTEXT_ADMITTED',
        diagnosticSnapshot: {
          diagnosticCandidates: [
            { key: 'hookId', value: 'user-query-memory-recall', classification: 'LOW_CARDINALITY', cardinality: 'LOW' },
            { key: 'candidateCount', value: 2, classification: 'LOW_CARDINALITY', cardinality: 'LOW' },
            { key: 'detailCount', value: 2, classification: 'LOW_CARDINALITY', cardinality: 'LOW' },
            { key: 'contextDisposition', value: 'L1_CONTEXT', classification: 'LOW_CARDINALITY', cardinality: 'LOW' },
          ],
        },
      }),
    );

    expect(methods.info).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'hook.completed',
        sessionId: 'session-1',
        requestId: 'request-1',
        runId: 'run-1',
        safeReasonCode: 'MEMORY_RECALL_L1_CONTEXT_ADMITTED',
        details: {
          hookId: 'user-query-memory-recall',
          candidateCount: 2,
          detailCount: 2,
          contextDisposition: 'L1_CONTEXT',
        },
      }),
    );
  });

  it('routes successful observe-parallel hooks to debug while keeping serial-impact hooks at info', () => {
    const methods = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const projector = createStructuredLogProjector(methods);
    const hookObservation = (executionStrategy: 'OBSERVE_PARALLEL' | 'SERIAL_IMPACT') =>
      createObservationEvent({
        boundary: 'system',
        operation: 'HOOK_INVOKED',
        outcome: 'success',
        ownerScope,
        occurredAt: brand<number, 'EpochMillis'>(1) as EpochMillis,
        stableRefs: { requestRunId: 'run-hook-level' },
        diagnosticSnapshot: {
          diagnosticCandidates: [
            { key: 'status', value: 'SUCCESS', classification: 'LOW_CARDINALITY', cardinality: 'LOW' },
            { key: 'executionStrategy', value: executionStrategy, classification: 'LOW_CARDINALITY', cardinality: 'LOW' },
          ],
        },
      });

    projector.project(hookObservation('OBSERVE_PARALLEL'));
    projector.project(hookObservation('SERIAL_IMPACT'));

    expect(methods.debug).toHaveBeenCalledWith(expect.objectContaining({ event: 'hook.completed' }));
    expect(methods.info).toHaveBeenCalledWith(expect.objectContaining({ event: 'hook.completed' }));
  });

  it('omits success-only terminal aliases while preserving the complete terminal summary', () => {
    const methods = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const projector = createStructuredLogProjector(methods);
    projector.project(logObservation('REQUEST_ACCEPTED', 'request_lifecycle', 'success', 'run-compact-terminal', 'event-1'));
    projector.project(
      createObservationEvent({
        boundary: 'request_lifecycle',
        operation: 'TERMINAL_COMMITTED',
        outcome: 'success',
        ownerScope,
        occurredAt: brand<number, 'EpochMillis'>(2) as EpochMillis,
        stableRefs: { requestRunId: 'run-compact-terminal', timelineEventId: 'event-2' },
        safeReasonCode: 'TERMINAL_COMPLETED',
        diagnosticSnapshot: {
          diagnosticCandidates: [
            { key: 'persistence', value: 'PERSISTED', classification: 'LOW_CARDINALITY', cardinality: 'LOW' },
            { key: 'terminalStatus', value: 'COMPLETED', classification: 'LOW_CARDINALITY', cardinality: 'LOW' },
          ],
        },
      }),
    );

    const terminal = methods.info.mock.calls.at(-1)?.[0] as Record<string, unknown>;
    expect(terminal).toMatchObject({ event: 'request.completed', status: 'SUCCEEDED', toolCallCount: 0 });
    expect(terminal).not.toHaveProperty('safeReasonCode');
    expect(terminal).not.toHaveProperty('details');
    expect(terminal).not.toHaveProperty('summaryStatus');
  });

  it.each(['normal', 'debug'] as const)('keeps request timeout classification metrics-only in %s logs', (diagnosticDetail) => {
    const methods = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const projector = createStructuredLogProjector(methods, { diagnosticDetail });

    projector.project(
      createObservationEvent({
        boundary: 'request_lifecycle',
        operation: 'TERMINAL_COMMITTED',
        outcome: 'failure',
        ownerScope,
        occurredAt: brand<number, 'EpochMillis'>(2) as EpochMillis,
        stableRefs: { requestRunId: 'run-timeout', timelineEventId: 'event-timeout' },
        diagnosticSnapshot: {
          diagnosticCandidates: [
            {
              key: 'safeErrorCode',
              value: 'PENDING_INPUT_TIMEOUT',
              classification: 'LOW_CARDINALITY',
              cardinality: 'LOW',
            },
            {
              key: 'safeErrorCategory',
              value: 'TIMEOUT',
              classification: 'LOW_CARDINALITY',
              cardinality: 'LOW',
            },
          ],
        },
      }),
    );

    const terminal = methods.error.mock.calls.at(-1)?.[0];
    expect(JSON.stringify(terminal)).not.toMatch(/safeErrorCode|safeErrorCategory|PENDING_INPUT_TIMEOUT|TIMEOUT/u);
  });

  it('degrades without throwing when the runtime logger rejects an entry', () => {
    const projector = createStructuredLogProjector({
      debug() {
        throw new Error('sink failed');
      },
      info() {
        throw new Error('sink failed');
      },
      warn() {
        throw new Error('sink failed');
      },
      error() {
        throw new Error('sink failed');
      },
    });
    expect(
      projector.project(
        createObservationEvent({
          boundary: 'model_invocation',
          operation: 'MODEL_INVOCATION_STARTED',
          outcome: 'success',
          ownerScope,
          occurredAt: brand<number, 'EpochMillis'>(1) as EpochMillis,
          stableRefs: { requestRunId: 'run-sink-failure' },
        }),
      ),
    ).toEqual({
      surface: 'LOG',
      outcome: 'degraded',
      safeReasonCode: 'SERIALIZATION_FAILURE',
    });
  });

  it.each([
    ['ENQUEUED', 'success', 'debug', 'task.trajectory.build.enqueued'],
    ['BUILT', 'success', 'debug', 'task.trajectory.build.completed'],
    ['SKIPPED', 'degraded', 'debug', 'task.trajectory.build.skipped'],
    ['DROPPED', 'degraded', 'warn', 'task.trajectory.build.dropped'],
    ['FAILED', 'failure', 'error', 'task.trajectory.build.failed'],
  ] as const)('projects task trajectory %s as %s', (status, outcome, level, expectedEvent) => {
    const methods = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const projector = createStructuredLogProjector(methods);

    projector.project(
      createObservationEvent({
        boundary: 'system',
        operation: 'TASK_TRAJECTORY_BUILD',
        outcome,
        ownerScope,
        occurredAt: brand<number, 'EpochMillis'>(1) as EpochMillis,
        stableRefs: { requestRunId: 'run-1' },
        safeReasonCode: `TASK_TRAJECTORY_${status}`,
        diagnosticSnapshot: {
          tenantId: ownerScope.tenantId,
          subjectId: ownerScope.subjectId,
          agentId: ownerScope.agentId,
          agentVersion: ownerScope.agentVersion,
          diagnosticCandidates: [
            { key: 'status', value: status, classification: 'LOW_CARDINALITY', cardinality: 'LOW' },
            { key: 'reasonCode', value: `TASK_TRAJECTORY_${status}`, classification: 'LOW_CARDINALITY', cardinality: 'LOW' },
          ],
        },
      }),
    );

    const entry = methods[level].mock.calls[0]![0];
    expect(entry).toMatchObject({
      event: expectedEvent,
      safeReasonCode: `TASK_TRAJECTORY_${status}`,
      details: { status },
    });
    expect(entry).not.toHaveProperty('level');
    expect(entry.details).not.toHaveProperty('reasonCode');
  });

  it.each([
    ['CONTEXT_ASSEMBLY_COMPLETED', 'context.assembly.completed'],
    ['SANDBOX_EXECUTION_COMPLETED', 'sandbox.execution.completed'],
    ['MODEL_STREAM_FIRST_VISIBLE_CONTENT', 'model.stream.first_visible_content'],
    ['HOOK_INVOKED', 'hook.completed'],
  ] as const)('projects normal execution trajectory %s at info level', (operation, expectedEvent) => {
    const methods = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const projector = createStructuredLogProjector(methods);

    expect(
      projector.project(
        createObservationEvent({
          boundary: 'system',
          operation,
          outcome: 'success',
          ownerScope,
          occurredAt: brand<number, 'EpochMillis'>(1) as EpochMillis,
          stableRefs: { requestRunId: 'run-1' },
        }),
      ).outcome,
    ).toBe('emitted');

    expect(methods.info).toHaveBeenCalledOnce();
    expect(methods.info.mock.calls[0]![0]).toMatchObject({
      event: expectedEvent,
      runId: 'run-1',
    });
    expect(methods.debug).not.toHaveBeenCalled();
  });

  it('projects REQUEST_FIRST_CONTENT_DELIVERED as request.first_content_delivered at info level', () => {
    const methods = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const projector = createStructuredLogProjector(methods);

    expect(
      projector.project(
        createObservationEvent({
          boundary: 'request_lifecycle',
          operation: 'REQUEST_FIRST_CONTENT_DELIVERED',
          outcome: 'success',
          ownerScope,
          occurredAt: brand<number, 'EpochMillis'>(1) as EpochMillis,
          durationMs: 150,
          stableRefs: { requestRunId: 'run-first-content' },
        }),
      ).outcome,
    ).toBe('emitted');

    expect(methods.info).toHaveBeenCalledOnce();
    expect(methods.info.mock.calls[0]![0]).toMatchObject({
      event: 'request.first_content_delivered',
      runId: 'run-first-content',
      durationMs: 150,
    });
    expect(methods.debug).not.toHaveBeenCalled();
  });
});

function timelineRecord(
  type: string,
  inlinePayload: TimelineObservationRecord['inlinePayload'],
  ordinal: number,
  traceId?: string,
  spanId?: string,
): TimelineObservationRecord {
  return {
    tenantId: ownerScope.tenantId,
    subjectId: ownerScope.subjectId,
    agentId: ownerScope.agentId,
    agentVersion: ownerScope.agentVersion,
    eventId: `event-${ordinal}`,
    sessionId: brand<string, 'SessionId'>('session-log'),
    runId: brand<string, 'RequestRunId'>('run-log'),
    requestId: brand<string, 'MessageId'>('request-log'),
    requestContextId: brand<string, 'RequestContextId'>('context-log'),
    type,
    inlinePayload: {
      ...inlinePayload,
      ...(traceId === undefined || spanId === undefined ? {} : { trace: { traceId, spanId } }),
    },
    createdAt: brand<number, 'EpochMillis'>(ordinal) as EpochMillis,
  };
}

function logObservation(
  operation: string,
  boundary: 'request_lifecycle' | 'model_invocation',
  outcome: 'success' | 'failure' | 'canceled',
  runId: string,
  timelineEventId: string,
  stepId?: string,
  usage?: { readonly inputTokens?: number; readonly outputTokens?: number; readonly totalTokens?: number },
) {
  return createObservationEvent({
    boundary,
    operation,
    outcome,
    ownerScope,
    occurredAt: brand<number, 'EpochMillis'>(1) as EpochMillis,
    stableRefs: { requestRunId: runId, timelineEventId },
    ...(usage === undefined ? {} : { usage }),
    ...(stepId === undefined
      ? {}
      : {
          diagnosticSnapshot: {
            diagnosticCandidates: [{ key: 'stepId', value: stepId, classification: 'LOW_CARDINALITY', cardinality: 'LOW' }],
          },
        }),
  });
}

function capabilityStarted(runId: string, timelineEventId: string, capabilityInvocationId: string) {
  return createObservationEvent({
    boundary: 'capability_invocation',
    operation: 'CAPABILITY_STARTED',
    outcome: 'success',
    ownerScope,
    occurredAt: brand<number, 'EpochMillis'>(1) as EpochMillis,
    stableRefs: { requestRunId: runId, timelineEventId, capabilityInvocationId },
  });
}
