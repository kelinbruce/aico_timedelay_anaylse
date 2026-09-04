import {
  brand,
  currentRuntimeLogCorrelation,
  type EpochMillis,
  type JsonObject,
  type TimelineEventType,
  type TimelineSequence,
} from '@nextagent/agent-common';
import type { RequestRunStoreGateway, RunTimelineEventRecord, RunTimelineEventStoreGateway } from '@nextagent/agent-contracts/gateway';
import { InMemorySpanExporter, SimpleSpanProcessor } from '@opentelemetry/sdk-trace-base';
import { BasicTracerProvider } from '@opentelemetry/sdk-trace-base';
import { describe, expect, it } from 'vitest';

import {
  createTimelineTraceRuntime,
  createTraceAwareRequestRunStore,
  createTraceAwareTimelineStore,
  type TimelineSpanLifecyclePort,
} from '../src/linking/timeline-span-lifecycle.js';

describe('timeline span lifecycle', () => {
  it('enriches before persistence and closes the same request span after terminal commit', async () => {
    const harness = traceHarness();
    const persisted: RunTimelineEventRecord[] = [];
    const timeline = createTraceAwareTimelineStore(
      {
        async appendEvent(record) {
          persisted.push(record);
          return record;
        },
        async listEvents() {
          return persisted;
        },
      },
      harness.runtime.lifecycle,
    );
    const requestRuns = createTraceAwareRequestRunStore(
      requestRunStore(async (request) => ({
        status: 'COMMITTED',
        terminalEvent: request.terminalEvent,
      })),
      harness.runtime.lifecycle,
    );

    await harness.runtime.correlation.withIncomingCarrier(
      {
        traceparent: '00-11111111111111111111111111111111-2222222222222222-01',
      },
      async () => {
        const accepted = await timeline.appendEvent(
          record('REQUEST_ACCEPTED', {
            trace: { traceId: 'untrusted' },
            attributes: { eventId: 'task-01' },
          }),
        );
        const acceptedTrace = tracePayload(accepted);
        expect(acceptedTrace.traceId).toBe('11111111111111111111111111111111');
        expect(acceptedTrace.parentSpanId).toBe('2222222222222222');

        await harness.runtime.correlation.withExecutionRef(
          {
            requestRunId: 'run-1',
            kind: 'REQUEST',
            executionId: 'run-1',
          },
          async () => {
            expect(currentRuntimeLogCorrelation()).toEqual({ traceId: acceptedTrace.traceId, spanId: acceptedTrace.spanId });
            expect(
              harness.runtime.correlation.outboundHeaders({
                TraceParent: 'untrusted',
                'X-Task-Event-ID': 'untrusted',
              }),
            ).toMatchObject({
              traceparent: acceptedTrace.traceparent,
              'x-task-event-id': 'task-01',
            });
          },
        );

        const terminal = record(
          'REQUEST_COMPLETED',
          {
            attributes: { eventId: 'task-01' },
            durationMs: 5,
          },
          2,
        );
        const result = await requestRuns.commitTerminal(terminalRequest(terminal));
        expect(tracePayload(result.terminalEvent!).spanId).toBe(acceptedTrace.spanId);
      },
    );

    expect(harness.exporter.getFinishedSpans()).toHaveLength(1);
    expect(harness.exporter.getFinishedSpans()[0]?.attributes).toMatchObject({
      eventId: 'task-01',
      'nextagent.observation_type': 'request',
      'nextagent.outcome': 'success',
    });
  });

  it('keeps child spans as request children and resolves workflow predecessors deterministically', async () => {
    const harness = traceHarness();
    const timeline = createTraceAwareTimelineStore(memoryTimeline(), harness.runtime.lifecycle);
    const accepted = await timeline.appendEvent(record('REQUEST_ACCEPTED', {}));
    const requestSpanId = tracePayload(accepted).spanId;
    const first = await timeline.appendEvent(
      record(
        'CAPABILITY_STARTED',
        {
          nodeId: 'first',
          nodeType: 'TOOL',
          nodeExecutionId: 'node-1',
          predecessorNodeExecutionIds: [],
        },
        2,
      ),
    );
    await timeline.appendEvent(
      record(
        'CAPABILITY_COMPLETED',
        {
          nodeId: 'first',
          nodeType: 'TOOL',
          nodeExecutionId: 'node-1',
          predecessorNodeExecutionIds: [],
          status: 'SUCCEEDED',
        },
        3,
      ),
    );
    const second = await timeline.appendEvent(
      record(
        'CAPABILITY_STARTED',
        {
          nodeId: 'second',
          nodeType: 'RESTFUL',
          nodeExecutionId: 'node-2',
          predecessorNodeExecutionIds: ['node-1', 'node-1'],
        },
        4,
      ),
    );
    const secondTerminal = await timeline.appendEvent(
      record(
        'CAPABILITY_COMPLETED',
        {
          nodeId: 'second',
          nodeType: 'RESTFUL',
          nodeExecutionId: 'node-2',
          predecessorNodeExecutionIds: ['node-1', 'node-1'],
          status: 'SUCCEEDED',
        },
        5,
      ),
    );
    const unresolved = await timeline.appendEvent(
      record(
        'CAPABILITY_STARTED',
        {
          nodeId: 'unresolved',
          nodeType: 'RESTFUL',
          nodeExecutionId: 'node-3',
          predecessorNodeExecutionIds: ['node-1', 'missing-node'],
        },
        6,
      ),
    );

    expect(tracePayload(first)).toMatchObject({
      parentSpanId: requestSpanId,
      previewSpanIds: [],
    });
    expect(tracePayload(second)).toMatchObject({
      parentSpanId: requestSpanId,
      previewSpanIds: [tracePayload(first).spanId],
    });
    expect(tracePayload(secondTerminal).previewSpanIds).toEqual([tracePayload(first).spanId]);
    expect(tracePayload(unresolved)).not.toHaveProperty('previewSpanIds');
  });

  it('cleans a newly-created span when the START write fails', async () => {
    const harness = traceHarness();
    const failure = new Error('write failed');
    const timeline = createTraceAwareTimelineStore(
      {
        async appendEvent() {
          throw failure;
        },
        async listEvents() {
          return [];
        },
      },
      harness.runtime.lifecycle,
    );

    await expect(timeline.appendEvent(record('REQUEST_ACCEPTED', {}))).rejects.toBe(failure);
    expect(harness.exporter.getFinishedSpans()).toHaveLength(1);
  });

  it('keeps existing model and capability lifecycle request-scoped even inside a node scope', async () => {
    const harness = traceHarness();
    const timeline = createTraceAwareTimelineStore(memoryTimeline(), harness.runtime.lifecycle);
    const request = await timeline.appendEvent(record('REQUEST_ACCEPTED', {}));
    await timeline.appendEvent(
      record(
        'CAPABILITY_STARTED',
        {
          nodeId: 'diagnose',
          nodeType: 'TOOL',
          nodeExecutionId: 'node-exec-1',
          predecessorNodeExecutionIds: [],
        },
        2,
      ),
    );
    const nodeRef = {
      requestRunId: 'run-1',
      kind: 'WORKFLOW_NODE' as const,
      executionId: 'node-exec-1',
    };

    await harness.runtime.correlation.withExecutionRef(nodeRef, async () => {
      const model = await timeline.appendEvent(
        record(
          'MODEL_INVOCATION_STARTED',
          {
            stepId: 'model-1',
            providerKind: 'OPENAI',
          },
          3,
        ),
      );
      expect(tracePayload(model).parentSpanId).toBe(tracePayload(request).spanId);

      await harness.runtime.correlation.withExecutionRef(
        {
          requestRunId: 'run-1',
          kind: 'MODEL',
          executionId: 'model-1',
        },
        async () => {
          const capability = await timeline.appendEvent(
            record(
              'CAPABILITY_STARTED',
              {
                capabilityId: 'Read',
                toolCallId: 'tool-1',
              },
              4,
            ),
          );
          expect(tracePayload(capability).parentSpanId).toBe(tracePayload(request).spanId);
        },
      );
    });
  });

  it('keeps unfinished child spans failed when the request terminates', async () => {
    const harness = traceHarness();
    const timeline = createTraceAwareTimelineStore(memoryTimeline(), harness.runtime.lifecycle);
    const requestRuns = createTraceAwareRequestRunStore(
      requestRunStore(async (request) => ({
        status: 'COMMITTED',
        terminalEvent: request.terminalEvent,
      })),
      harness.runtime.lifecycle,
    );
    await timeline.appendEvent(record('REQUEST_ACCEPTED', {}));
    await timeline.appendEvent(
      record(
        'MODEL_INVOCATION_STARTED',
        {
          stepId: 'unfinished-model',
          providerKind: 'OPENAI',
        },
        2,
      ),
    );

    await requestRuns.commitTerminal(
      terminalRequest(
        record(
          'REQUEST_COMPLETED',
          {
            durationMs: 5,
          },
          3,
        ),
      ),
    );

    const modelSpan = harness.exporter.getFinishedSpans().find((span) => span.attributes['nextagent.observation_type'] === 'model');
    expect(modelSpan?.status).toMatchObject({
      code: 2,
      message: 'REQUEST_TERMINATED',
    });
    expect(modelSpan?.attributes).toMatchObject({
      'nextagent.force_close_reason': 'REQUEST_TERMINATED',
    });
  });

  it('accepts sampled and unsampled W3C parents while isolating concurrent carriers', async () => {
    const harness = traceHarness();
    const timeline = createTraceAwareTimelineStore(memoryTimeline(), harness.runtime.lifecycle);
    const [sampled, unsampled] = await Promise.all([
      harness.runtime.correlation.withIncomingCarrier(
        {
          traceparent: '00-11111111111111111111111111111111-2222222222222222-01',
          tracestate: 'vendor=value',
        },
        () => timeline.appendEvent(record('REQUEST_ACCEPTED', {}, 1, 'run-sampled')),
      ),
      harness.runtime.correlation.withIncomingCarrier(
        {
          traceparent: '00-33333333333333333333333333333333-4444444444444444-00',
          tracestate: 'duplicate=one,duplicate=two',
        },
        () => timeline.appendEvent(record('REQUEST_ACCEPTED', {}, 1, 'run-unsampled')),
      ),
    ]);

    expect(tracePayload(sampled)).toMatchObject({
      traceId: '11111111111111111111111111111111',
      parentSpanId: '2222222222222222',
      tracestate: 'vendor=value',
    });
    expect(tracePayload(unsampled)).toMatchObject({
      traceId: '33333333333333333333333333333333',
      parentSpanId: '4444444444444444',
    });
    expect(tracePayload(unsampled)).not.toHaveProperty('tracestate');
    expect(tracePayload(unsampled).traceparent.endsWith('-00')).toBe(true);
  });

  it('creates a root request span when the incoming traceparent is invalid', async () => {
    const harness = traceHarness();
    const timeline = createTraceAwareTimelineStore(memoryTimeline(), harness.runtime.lifecycle);

    const accepted = await harness.runtime.correlation.withIncomingCarrier(
      {
        traceparent: '00-00000000000000000000000000000000-2222222222222222-01',
      },
      () => timeline.appendEvent(record('REQUEST_ACCEPTED', {})),
    );

    expect(tracePayload(accepted).traceId).not.toBe('00000000000000000000000000000000');
    expect(tracePayload(accepted)).not.toHaveProperty('parentSpanId');
  });

  it('keeps persistence results authoritative when lifecycle callbacks fail', async () => {
    const faultyLifecycle: TimelineSpanLifecyclePort = {
      prepareSafely() {
        throw new Error('prepare failed');
      },
      committedSafely() {
        throw new Error('commit callback failed');
      },
      failedSafely() {
        throw new Error('failure callback failed');
      },
      notCommittedSafely() {
        throw new Error('not committed callback failed');
      },
      alreadyCommittedSafely() {
        throw new Error('already committed callback failed');
      },
    };
    const timeline = createTraceAwareTimelineStore(memoryTimeline(), faultyLifecycle);
    const accepted = await timeline.appendEvent(
      record('REQUEST_ACCEPTED', {
        trace: { traceId: 'untrusted' },
      }),
    );
    expect(accepted.inlinePayload).not.toHaveProperty('trace');

    const requestRuns = createTraceAwareRequestRunStore(
      requestRunStore(async (request) => ({
        status: 'COMMITTED',
        terminalEvent: request.terminalEvent,
      })),
      faultyLifecycle,
    );
    await expect(requestRuns.commitTerminal(terminalRequest(record('REQUEST_COMPLETED', {}, 2)))).resolves.toMatchObject({ status: 'COMMITTED' });
  });
});

function traceHarness() {
  const exporter = new InMemorySpanExporter();
  const provider = new BasicTracerProvider({
    spanProcessors: [new SimpleSpanProcessor(exporter)],
  });
  const runtime = createTimelineTraceRuntime({
    enabled: true,
    tracer: provider.getTracer('test'),
    scheduleCleanup: () => undefined,
  });
  return { exporter, runtime };
}

function memoryTimeline(): RunTimelineEventStoreGateway {
  const records: RunTimelineEventRecord[] = [];
  return {
    async appendEvent(record) {
      records.push(record);
      return record;
    },
    async listEvents() {
      return records;
    },
  };
}

function requestRunStore(commitTerminal: RequestRunStoreGateway['commitTerminal']): RequestRunStoreGateway {
  return {
    async saveRun() {
      return { status: 'NOT_FOUND' };
    },
    async loadRun() {
      return undefined;
    },
    async listRuns(request) {
      return { items: [], offset: request.offset, limit: request.limit, hasMore: false };
    },
    async loadSessionLaneSnapshot(request) {
      return { ...request, queuedRuns: [] };
    },
    async loadRunByIdempotencyKey() {
      return { status: 'NOT_FOUND' };
    },
    async claimRun() {
      return { status: 'NOT_FOUND' };
    },
    async listRecoverableRuns() {
      return [];
    },
    commitTerminal,
  };
}

function terminalRequest(terminalEvent: RunTimelineEventRecord) {
  return {
    tenantId: terminalEvent.tenantId,
    subjectId: terminalEvent.subjectId,
    agentId: terminalEvent.agentId,
    runId: terminalEvent.runId,
    expectedVersion: 1,
    terminalStatus: 'COMPLETED' as const,
    terminalMessage: {
      tenantId: terminalEvent.tenantId,
      subjectId: terminalEvent.subjectId,
      agentId: terminalEvent.agentId,
      messageId: brand<string, 'MessageId'>('terminal-message'),
      sessionId: terminalEvent.sessionId,
      requestId: terminalEvent.requestId,
      runId: terminalEvent.runId,
      requestContextId: terminalEvent.requestContextId,
      role: 'ASSISTANT' as const,
      contentType: 'PLAIN_TEXT' as const,
      content: 'done',
      metadata: {},
      visible: true,
      createdAt: terminalEvent.createdAt,
    },
    terminalEvent,
    idempotencyKey: brand<string, 'IdempotencyKey'>('terminal-idempotency'),
  };
}

function record(type: TimelineEventType, inlinePayload: JsonObject, sequence = 1, runId = 'run-1'): RunTimelineEventRecord {
  return {
    tenantId: brand<string, 'TenantId'>('tenant-1'),
    subjectId: brand<string, 'SubjectId'>('subject-1'),
    agentId: brand<string, 'AgentId'>('agent-1'),
    agentVersion: brand<string, 'AgentVersion'>('v1'),
    eventId: `timeline-${sequence}`,
    sessionId: brand<string, 'SessionId'>('session-1'),
    runId: brand<string, 'RequestRunId'>(runId),
    requestId: brand<string, 'MessageId'>('request-1'),
    requestContextId: brand<string, 'RequestContextId'>('context-1'),
    sequence: brand<number, 'TimelineSequence'>(sequence) as TimelineSequence,
    type,
    inlinePayload,
    createdAt: brand<number, 'EpochMillis'>(sequence) as EpochMillis,
  };
}

function tracePayload(record: RunTimelineEventRecord): {
  readonly traceId: string;
  readonly spanId: string;
  readonly parentSpanId?: string;
  readonly previewSpanIds?: readonly string[];
  readonly traceparent: string;
  readonly tracestate?: string;
} {
  return record.inlinePayload.trace as unknown as ReturnType<typeof tracePayload>;
}
