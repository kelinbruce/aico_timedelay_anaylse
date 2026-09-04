import { brand, type JsonObject } from '@nextagent/agent-common';
import {
  createTimelineObservationMapper,
  timelineObservationFromRecord,
  type TimelineObservationRecord,
} from '../src/trajectory/timeline-observation-mapper.js';
import { describe, expect, it } from 'vitest';

describe('TimelineObservationMapper', () => {
  it('characterizes request, policy, and hook mappings from canonical persisted facts', () => {
    const mapper = createTimelineObservationMapper();
    expect(mapper(record('REQUEST_ACCEPTED', { status: 'QUEUED' }, 100))[0]).toMatchObject({
      boundary: 'request_lifecycle',
      operation: 'REQUEST_ACCEPTED',
      outcome: 'success',
      stableRefs: { requestRunId: 'run-1', timelineEventId: 'event-REQUEST_ACCEPTED-100' },
    });
    expect(
      mapper(
        record(
          'POLICY_APPLIED',
          {
            operationKind: 'CAPABILITY_INVOCATION',
            operationId: 'Bash:tool-1',
            outcome: 'DENY',
            reasonCode: 'POLICY_BLOCKED',
            riskLevel: 'HIGH',
          },
          110,
        ),
      )[0],
    ).toMatchObject({ boundary: 'system', operation: 'POLICY_DENIED', outcome: 'denied', safeReasonCode: 'POLICY_BLOCKED' });
    expect(
      mapper(
        record(
          'HOOK_INVOKED',
          {
            hookId: 'system.guard',
            hookInvocationId: 'hook-1',
            stage: 'BEFORE_AGENT_TERMINAL',
            status: 'SUCCESS',
            outcome: 'PASS',
            durationMs: 3,
          },
          120,
        ),
      )[0],
    ).toMatchObject({ boundary: 'system', operation: 'HOOK_INVOKED', outcome: 'success', durationMs: 3 });
    expect(mapper(record('REQUEST_COMPLETED', {}, 145))[0]).toMatchObject({
      operation: 'TERMINAL_COMMITTED',
      outcome: 'success',
      durationMs: 45,
      safeReasonCode: 'TERMINAL_COMPLETED',
    });
  });

  it('projects only bounded safe hook recall diagnostics', () => {
    const observation = timelineObservationFromRecord(
      record(
        'HOOK_INVOKED',
        {
          hookId: 'user-query-memory-recall',
          hookInvocationId: 'hook-recall-1',
          stage: 'BEFORE_MODEL_INVOKE',
          status: 'SUCCESS',
          outcome: 'PASS',
          durationMs: 3,
          diagnosticCode: 'MEMORY_RECALL_L1_CONTEXT_ADMITTED',
          candidateCount: 2,
          detailCount: 2,
          contextDisposition: 'L1_CONTEXT',
          queryText: 'must-not-project',
          memoryId: 'must-not-project',
          memoryBody: 'must-not-project',
          candidateCountOverflow: 100,
        },
        130,
      ),
    );

    expect(observation?.diagnosticSnapshot?.diagnosticCandidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: 'candidateCount', value: 2 }),
        expect.objectContaining({ key: 'detailCount', value: 2 }),
        expect.objectContaining({ key: 'contextDisposition', value: 'L1_CONTEXT' }),
      ]),
    );
    expect(JSON.stringify(observation)).not.toContain('must-not-project');
  });

  it('maps model bookends and emits content-free first-visible exactly once per run and step', () => {
    const mapper = createTimelineObservationMapper();
    mapper(record('REQUEST_ACCEPTED', { status: 'QUEUED' }, 100));
    const started = mapper(
      record(
        'MODEL_INVOCATION_STARTED',
        {
          stepId: 'turn-1',
          modelId: 'primary-model',
          messageCountBucket: '2-10',
          disclosedCapabilityNames: ['Read', 'Grep'],
          disclosedCapabilityNamesTruncated: 'false',
        },
        200,
      ),
    );
    expect(started[0]).toMatchObject({
      boundary: 'model_invocation',
      operation: 'MODEL_INVOCATION_STARTED',
      outcome: 'success',
    });
    expect(started[0]?.diagnosticSnapshot?.diagnosticCandidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: 'disclosedCapabilityNames', value: ['Read', 'Grep'] }),
        expect.objectContaining({ key: 'messageCountBucket', value: '2-10' }),
      ]),
    );
    const firstDelta = mapper(record('LLM_CONTENT_DELTA', { stepId: 'turn-1', content: 'credential=secret' }, 225));
    expect(firstDelta).toHaveLength(2);
    expect(firstDelta).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ operation: 'REQUEST_FIRST_CONTENT_DELIVERED', outcome: 'success', durationMs: 125 }),
        expect.objectContaining({ operation: 'MODEL_STREAM_FIRST_VISIBLE_CONTENT', outcome: 'success', durationMs: 25 }),
      ]),
    );
    expect(JSON.stringify(firstDelta)).not.toContain('credential=secret');
    expect(mapper(record('LLM_CONTENT_DELTA', { stepId: 'turn-1', content: 'more' }, 226))).toHaveLength(0);
    expect(
      mapper(
        record(
          'MODEL_INVOCATION_COMPLETED',
          {
            stepId: 'turn-1',
            modelId: 'primary-model',
            finishReason: 'stop',
            durationMs: 40,
            firstContentLatencyMs: 25,
            usage: { inputTokens: 2, outputTokens: 3, totalTokens: 5 },
          },
          240,
        ),
      )[0],
    ).toMatchObject({
      operation: 'MODEL_INVOCATION_COMPLETED',
      durationMs: 40,
      firstContentLatencyMs: 25,
      usage: { inputTokens: 2, outputTokens: 3, totalTokens: 5 },
    });

    expect(mapper(record('MODEL_INVOCATION_STARTED', { stepId: 'turn-2', modelId: 'fallback-model' }, 250))[0]).toBeDefined();
    expect(
      mapper(
        record(
          'MODEL_INVOCATION_FAILED',
          {
            stepId: 'turn-2',
            modelId: 'fallback-model',
            safeErrorCode: 'MODEL_CREDENTIAL_UNAVAILABLE',
            safeErrorCategory: 'UNAVAILABLE',
            durationMs: 20,
            firstContentLatencyMs: 8,
            usage: { inputTokens: 1 },
          },
          270,
        ),
      )[0],
    ).toMatchObject({
      operation: 'MODEL_CREDENTIAL_FAILED',
      outcome: 'failure',
      durationMs: 20,
      firstContentLatencyMs: 8,
      usage: { inputTokens: 1 },
    });
    expect(mapper(record('REQUEST_FAILED', {}, 280))[0]).toBeDefined();
  });

  it('aggregates complete model usage once onto the terminal request observation', () => {
    const mapper = createTimelineObservationMapper();
    mapper(record('REQUEST_ACCEPTED', { status: 'QUEUED' }, 100));
    const firstTerminal = record('MODEL_INVOCATION_COMPLETED', { stepId: 'turn-1', modelId: 'm1', usage: { inputTokens: 10, outputTokens: 4 } }, 200);
    mapper(firstTerminal);
    mapper(firstTerminal);
    mapper(record('MODEL_INVOCATION_FAILED', { stepId: 'turn-2', modelId: 'm2', usage: { inputTokens: 6, outputTokens: 3 } }, 250));

    expect(mapper(record('REQUEST_COMPLETED', {}, 300))[0]).toMatchObject({
      operation: 'TERMINAL_COMMITTED',
      usage: { inputTokens: 16, outputTokens: 7 },
    });
  });

  it('omits only the incomplete request token type and does not aggregate replay without accepted state', () => {
    const mapper = createTimelineObservationMapper();
    mapper(record('REQUEST_ACCEPTED', { status: 'QUEUED' }, 100));
    mapper(record('MODEL_INVOCATION_COMPLETED', { stepId: 'turn-1', modelId: 'm1', usage: { inputTokens: 10, outputTokens: 4 } }, 200));
    mapper(record('MODEL_INVOCATION_COMPLETED', { stepId: 'turn-2', modelId: 'm2', usage: { inputTokens: 6 } }, 250));

    expect(mapper(record('REQUEST_FAILED', {}, 300))[0]).toMatchObject({ usage: { inputTokens: 16 } });
    expect(
      mapper(record('MODEL_INVOCATION_COMPLETED', { stepId: 'turn-replay', modelId: 'm3', usage: { inputTokens: 1, outputTokens: 1 } }, 400))[0],
    ).toBeDefined();
    expect(mapper(record('REQUEST_COMPLETED', {}, 450))[0]).not.toHaveProperty('usage');
  });

  it('emits REQUEST_FIRST_CONTENT_DELIVERED with durationMs from REQUEST_ACCEPTED to first LLM_CONTENT_DELTA', () => {
    const mapper = createTimelineObservationMapper();
    mapper(record('REQUEST_ACCEPTED', { status: 'QUEUED' }, 100));
    mapper(record('MODEL_INVOCATION_STARTED', { stepId: 'turn-1', modelId: 'm1' }, 200));
    const first = mapper(record('LLM_CONTENT_DELTA', { stepId: 'turn-1' }, 250));
    expect(first).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ operation: 'REQUEST_FIRST_CONTENT_DELIVERED', boundary: 'request_lifecycle', outcome: 'success', durationMs: 150 }),
      ]),
    );
  });

  it('does not emit REQUEST_FIRST_CONTENT_DELIVERED on subsequent LLM_CONTENT_DELTA in the same run', () => {
    const mapper = createTimelineObservationMapper();
    mapper(record('REQUEST_ACCEPTED', { status: 'QUEUED' }, 100));
    mapper(record('MODEL_INVOCATION_STARTED', { stepId: 'turn-1', modelId: 'm1' }, 200));
    mapper(record('LLM_CONTENT_DELTA', { stepId: 'turn-1' }, 250));
    const second = mapper(record('LLM_CONTENT_DELTA', { stepId: 'turn-1' }, 260));
    expect(second).toHaveLength(0);
  });

  it('does not emit REQUEST_FIRST_CONTENT_DELIVERED on second agent loop turn within the same run', () => {
    const mapper = createTimelineObservationMapper();
    mapper(record('REQUEST_ACCEPTED', { status: 'QUEUED' }, 100));
    mapper(record('MODEL_INVOCATION_STARTED', { stepId: 'turn-1', modelId: 'm1' }, 200));
    mapper(record('LLM_CONTENT_DELTA', { stepId: 'turn-1' }, 250));
    mapper(record('MODEL_INVOCATION_COMPLETED', { stepId: 'turn-1', modelId: 'm1', finishReason: 'tool_calls' }, 300));
    mapper(record('MODEL_INVOCATION_STARTED', { stepId: 'turn-2', modelId: 'm1' }, 310));
    const secondTurnFirstDelta = mapper(record('LLM_CONTENT_DELTA', { stepId: 'turn-2' }, 350));
    expect(secondTurnFirstDelta).toEqual(
      expect.arrayContaining([expect.objectContaining({ operation: 'MODEL_STREAM_FIRST_VISIBLE_CONTENT', durationMs: 40 })]),
    );
    expect(secondTurnFirstDelta).not.toEqual(expect.arrayContaining([expect.objectContaining({ operation: 'REQUEST_FIRST_CONTENT_DELIVERED' })]));
  });

  it('does not emit REQUEST_FIRST_CONTENT_DELIVERED when REQUEST_ACCEPTED is missing', () => {
    const mapper = createTimelineObservationMapper();
    mapper(record('MODEL_INVOCATION_STARTED', { stepId: 'turn-1', modelId: 'm1' }, 200));
    const delta = mapper(record('LLM_CONTENT_DELTA', { stepId: 'turn-1' }, 250));
    expect(delta).toEqual(expect.arrayContaining([expect.objectContaining({ operation: 'MODEL_STREAM_FIRST_VISIBLE_CONTENT' })]));
    expect(delta).not.toEqual(expect.arrayContaining([expect.objectContaining({ operation: 'REQUEST_FIRST_CONTENT_DELIVERED' })]));
  });

  it('emits REQUEST_FIRST_CONTENT_DELIVERED even when stepId is missing but REQUEST_ACCEPTED exists', () => {
    const mapper = createTimelineObservationMapper();
    mapper(record('REQUEST_ACCEPTED', { status: 'QUEUED' }, 100));
    const delta = mapper(record('LLM_CONTENT_DELTA', {}, 250));
    expect(delta).toHaveLength(1);
    expect(delta[0]).toMatchObject({ operation: 'REQUEST_FIRST_CONTENT_DELIVERED', durationMs: 150 });
    expect(JSON.stringify(delta)).not.toContain('MODEL_STREAM_FIRST_VISIBLE_CONTENT');
  });

  it('emits REQUEST_FIRST_CONTENT_DELIVERED on first LLM_THINKING_DELTA when thinking arrives before content', () => {
    const mapper = createTimelineObservationMapper();
    mapper(record('REQUEST_ACCEPTED', { status: 'QUEUED' }, 100));
    mapper(record('MODEL_INVOCATION_STARTED', { stepId: 'turn-1', modelId: 'm1' }, 200));
    const thinking = mapper(record('LLM_THINKING_DELTA', { stepId: 'turn-1', reasoning: 'Let me think' }, 230));
    expect(thinking).toHaveLength(1);
    expect(thinking[0]).toMatchObject({
      operation: 'REQUEST_FIRST_CONTENT_DELIVERED',
      boundary: 'request_lifecycle',
      outcome: 'success',
      durationMs: 130,
    });
    expect(JSON.stringify(thinking)).not.toContain('MODEL_STREAM_FIRST_VISIBLE_CONTENT');
    const content = mapper(record('LLM_CONTENT_DELTA', { stepId: 'turn-1', content: 'answer' }, 350));
    expect(content).not.toEqual(expect.arrayContaining([expect.objectContaining({ operation: 'REQUEST_FIRST_CONTENT_DELIVERED' })]));
    expect(content).toEqual(expect.arrayContaining([expect.objectContaining({ operation: 'MODEL_STREAM_FIRST_VISIBLE_CONTENT', durationMs: 150 })]));
  });

  it('does not emit REQUEST_FIRST_CONTENT_DELIVERED on LLM_THINKING_DELTA when REQUEST_ACCEPTED is missing', () => {
    const mapper = createTimelineObservationMapper();
    mapper(record('MODEL_INVOCATION_STARTED', { stepId: 'turn-1', modelId: 'm1' }, 200));
    const thinking = mapper(record('LLM_THINKING_DELTA', { stepId: 'turn-1' }, 250));
    expect(thinking).toHaveLength(0);
  });

  it('does not emit REQUEST_FIRST_CONTENT_DELIVERED on subsequent LLM_THINKING_DELTA', () => {
    const mapper = createTimelineObservationMapper();
    mapper(record('REQUEST_ACCEPTED', { status: 'QUEUED' }, 100));
    mapper(record('MODEL_INVOCATION_STARTED', { stepId: 'turn-1', modelId: 'm1' }, 200));
    mapper(record('LLM_THINKING_DELTA', { stepId: 'turn-1' }, 230));
    const second = mapper(record('LLM_THINKING_DELTA', { stepId: 'turn-1' }, 240));
    expect(second).toHaveLength(0);
  });

  it('does not emit REQUEST_FIRST_CONTENT_DELIVERED when run terminates without any LLM_CONTENT_DELTA and cleans per-run state', () => {
    const mapper = createTimelineObservationMapper();
    mapper(record('REQUEST_ACCEPTED', { status: 'QUEUED' }, 100));
    mapper(record('MODEL_INVOCATION_STARTED', { stepId: 'turn-1', modelId: 'm1' }, 200));
    const terminal = mapper(record('REQUEST_FAILED', {}, 300));
    expect(terminal).not.toEqual(expect.arrayContaining([expect.objectContaining({ operation: 'REQUEST_FIRST_CONTENT_DELIVERED' })]));
    const deltaAfterTerminal = mapper(record('LLM_CONTENT_DELTA', { stepId: 'turn-1' }, 310));
    expect(deltaAfterTerminal).not.toEqual(expect.arrayContaining([expect.objectContaining({ operation: 'REQUEST_FIRST_CONTENT_DELIVERED' })]));
  });

  it('maps capability start and all terminal safety classifications', () => {
    expect(
      timelineObservationFromRecord(
        record(
          'CAPABILITY_STARTED',
          {
            capabilityId: 'Bash',
            toolCallId: 'tool-1',
            stepId: 'turn-1',
          },
          300,
        ),
      ),
    ).toMatchObject({ operation: 'CAPABILITY_STARTED', outcome: 'success', stableRefs: { capabilityInvocationId: 'tool-1' } });

    const cases = [
      [{ status: 'SUCCEEDED' }, 'CAPABILITY_COMPLETED', 'success'],
      [{ status: 'DEGRADED' }, 'CAPABILITY_COMPLETED', 'degraded'],
      [{ status: 'TIMED_OUT', safeErrorCategory: 'TIMEOUT' }, 'CAPABILITY_TIMED_OUT', 'timeout'],
      [{ status: 'FAILED', safeErrorCategory: 'AUTHORIZATION' }, 'CAPABILITY_DENIED', 'denied'],
      [{ status: 'FAILED', safeErrorCategory: 'POLICY_DENIED' }, 'CAPABILITY_POLICY_BLOCKED', 'denied'],
      [{ status: 'FAILED', safeErrorCode: 'CAPABILITY_SECURITY_VIOLATION', safeErrorCategory: 'INTERNAL' }, 'CAPABILITY_SECURITY_FAILED', 'failure'],
      [{ status: 'FAILED', safeErrorCode: 'CAPABILITY_EXECUTION_FAILED', safeErrorCategory: 'INTERNAL' }, 'CAPABILITY_FAILED', 'failure'],
    ] as const;
    for (const [terminal, operation, outcome] of cases) {
      expect(
        timelineObservationFromRecord(
          record(
            'CAPABILITY_COMPLETED',
            {
              capabilityId: 'Bash',
              toolCallId: 'tool-1',
              durationMs: 4,
              ...terminal,
            },
            310,
          ),
        ),
      ).toMatchObject({ operation, outcome, durationMs: 4 });
    }
  });

  it('projects bounded RAG completion diagnostics without raw retrieval data', () => {
    const observation = timelineObservationFromRecord(
      record(
        'CAPABILITY_COMPLETED',
        {
          capabilityId: 'Rag',
          toolCallId: 'tool-rag-1',
          status: 'SUCCEEDED',
          toolDiagnostics: [
            { key: 'toolResultStatus', value: 'OK' },
            { key: 'toolResultCountBucket', value: '2-10' },
            { key: 'reasonCode', value: 'NO_RESULTS_FOUND' },
            { key: 'source', value: 'manual-rag-docs/private.md' },
          ],
        },
        315,
      ),
    );

    const candidates = observation?.diagnosticSnapshot?.diagnosticCandidates ?? [];
    expect(candidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: 'toolResultStatus', value: 'OK' }),
        expect.objectContaining({ key: 'toolResultCountBucket', value: '2-10' }),
        expect.objectContaining({ key: 'reasonCode', value: 'NO_RESULTS_FOUND' }),
      ]),
    );
    expect(JSON.stringify(candidates)).not.toContain('manual-rag-docs/private.md');
  });

  it('projects only the fixed bounded capability structure fields', () => {
    const observation = timelineObservationFromRecord(
      record(
        'CAPABILITY_COMPLETED',
        {
          capabilityId: 'Lookup',
          toolCallId: 'tool-structure',
          status: 'SUCCEEDED',
          argumentProjectionStatus: 'PROJECTED',
          resultProjectionStatus: 'PROJECTED',
          validatedArgumentNames: ['query'],
          validatedResultFieldNames: ['records'],
          generatedMessageKinds: ['USER', 'USER_META'],
          contextPatchFields: ['allowedTools'],
          rawArguments: { query: 'canary-secret' },
          arbitraryNames: ['must-not-project'],
        },
        320,
      ),
    );
    const candidates = observation?.diagnosticSnapshot?.diagnosticCandidates ?? [];
    expect(candidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: 'validatedArgumentNames', value: ['query'] }),
        expect.objectContaining({ key: 'validatedResultFieldNames', value: ['records'] }),
        expect.objectContaining({ key: 'generatedMessageKinds', value: ['USER', 'USER_META'] }),
        expect.objectContaining({ key: 'contextPatchFields', value: ['allowedTools'] }),
      ]),
    );
    expect(JSON.stringify(candidates)).not.toMatch(/canary-secret|arbitraryNames|must-not-project/u);
  });

  it('covers context, degradation, pending-input, attachment, and background canonical families without raw payload', () => {
    const cases = [
      ['CONTEXT_COMPACTED', { code: 'SUMMARY_REPLACED' }, 'CONTEXT_COMPACTED', 'success'],
      ['DEGRADATION_NOTICE', { code: 'ATTACHMENT_EXCLUDED', rawBody: 'ignored' }, 'DEGRADATION_NOTICE', 'degraded'],
      ['USER_INPUT_REQUIRED', { status: 'PENDING', question: 'ignored' }, 'USER_INPUT_REQUIRED', 'degraded'],
      ['USER_INPUT_RECEIVED', { status: 'RECEIVED', answer: 'ignored' }, 'USER_INPUT_RECEIVED', 'success'],
      ['USER_INPUT_TIMEOUT', { status: 'TIMED_OUT' }, 'USER_INPUT_TIMEOUT', 'timeout'],
      ['ATTACHMENT_REJECTED', { reasonCode: 'ATTACHMENT_TOO_LARGE', physicalPath: 'ignored' }, 'ATTACHMENT_REJECTED', 'denied'],
      ['BACKGROUND_TASK_STARTED', { status: 'RUNNING', commandName: 'ignored' }, 'BACKGROUND_TASK_STARTED', 'success'],
      ['BACKGROUND_TASK_FAILED', { status: 'FAILED', stderrRef: 'ignored' }, 'BACKGROUND_TASK_FAILED', 'failure'],
    ] as const;
    for (const [type, payload, operation, outcome] of cases) {
      const observation = timelineObservationFromRecord(record(type, payload as JsonObject, 400));
      expect(observation).toMatchObject({ operation, outcome });
      expect(JSON.stringify(observation)).not.toMatch(/ignored|rawBody|question|answer|physicalPath|commandName|stderrRef/u);
    }
  });
});

function record(type: string, inlinePayload: JsonObject, createdAt: number): TimelineObservationRecord {
  return {
    tenantId: brand<string, 'TenantId'>('tenant-1'),
    subjectId: brand<string, 'SubjectId'>('subject-1'),
    agentId: brand<string, 'AgentId'>('agent-1'),
    agentVersion: brand<string, 'AgentVersion'>('v1'),
    eventId: `event-${type}-${createdAt}`,
    sessionId: brand<string, 'SessionId'>('session-1'),
    runId: brand<string, 'RequestRunId'>('run-1'),
    requestId: brand<string, 'MessageId'>('request-1'),
    requestContextId: brand<string, 'RequestContextId'>('context-1'),
    type,
    persistence: type === 'LLM_CONTENT_DELTA' || type === 'LLM_THINKING_DELTA' ? 'LIVE_ONLY' : 'PERSISTED',
    inlinePayload,
    createdAt: brand<number, 'EpochMillis'>(createdAt),
  };
}
