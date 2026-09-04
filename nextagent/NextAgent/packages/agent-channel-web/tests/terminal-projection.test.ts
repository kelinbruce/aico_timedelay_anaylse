import { brand, type JsonObject } from '@nextagent/agent-common';
import type { RunTimelineEvent } from '@nextagent/agent-contracts/runtime';
import { projectTimelineEventToStreamEnvelope } from '@nextagent/agent-channel-web';
import { describe, expect, it } from 'vitest';

describe('terminal projection', () => {
  it.each([
    ['REQUEST_COMPLETED', 'COMPLETED'],
    ['REQUEST_FAILED', 'FAILED'],
    ['REQUEST_CANCELED', 'CANCELED'],
    ['REQUEST_SUPERSEDED', 'SUPERSEDED'],
  ] as const)('projects the same empty Hook snapshot contract for %s', (type, status) => {
    const outcome = projectTimelineEventToStreamEnvelope(terminalEvent(type, { content: 'terminal' }));

    expect(outcome.kind).toBe('ENVELOPE');
    if (outcome.kind === 'ENVELOPE') {
      expect(outcome.envelope.payload.status).toBe(status);
      expect(outcome.envelope.payload.hookResults).toEqual([]);
    }
  });

  it('derives COMPLETED status without trusting a legacy terminal Event body', () => {
    const outcome = projectTimelineEventToStreamEnvelope(
      terminalEvent('REQUEST_COMPLETED', {
        content: 'done',
      }),
    );

    expect(outcome.kind).toBe('ENVELOPE');
    if (outcome.kind === 'ENVELOPE') {
      expect(outcome.envelope.payload.status).toBe('COMPLETED');
      expect(outcome.envelope.payload.content).toBe('');
      expect(outcome.envelope.payload.contentUnavailable).toBe(true);
    }
  });

  it('preserves safe failure fields while deriving FAILED status', () => {
    const outcome = projectTimelineEventToStreamEnvelope(
      terminalEvent('REQUEST_FAILED', {
        content: 'Request failed safely: TOOL_ROUND_LIMIT_EXCEEDED',
        code: 'TOOL_ROUND_LIMIT_EXCEEDED',
        category: 'POLICY_DENIED',
      }),
    );

    expect(outcome.kind).toBe('ENVELOPE');
    if (outcome.kind === 'ENVELOPE') {
      expect(outcome.envelope.payload.status).toBe('FAILED');
      expect(outcome.envelope.payload.code).toBe('TOOL_ROUND_LIMIT_EXCEEDED');
      expect(outcome.envelope.payload.category).toBe('POLICY_DENIED');
    }
  });

  it('projects the persisted Hook result snapshot without exposing timeline-only fields', () => {
    const outcome = projectTimelineEventToStreamEnvelope(
      terminalEvent('REQUEST_COMPLETED', {
        content: 'done',
        hookResults: [
          {
            hookInvocationId: 'hook-invocation-1',
            hookId: 'bash-result-hook',
            stage: 'AFTER_CAPABILITY_RESULT',
            status: 'SUCCESS',
            failureMode: 'CONTINUE',
            outcome: 'PASS',
            resultSummary: { a: 1, b: 2 },
          },
        ],
      }),
    );

    expect(outcome.kind).toBe('ENVELOPE');
    if (outcome.kind === 'ENVELOPE') {
      expect(outcome.envelope.payload.hookResults).toEqual([
        {
          hookInvocationId: 'hook-invocation-1',
          hookId: 'bash-result-hook',
          stage: 'AFTER_CAPABILITY_RESULT',
          status: 'SUCCESS',
          failureMode: 'CONTINUE',
          outcome: 'PASS',
          resultSummary: { a: 1, b: 2 },
        },
      ]);
    }
  });

  it('projects the fixed Hook snapshot error code without a partial result array', () => {
    const outcome = projectTimelineEventToStreamEnvelope(
      terminalEvent('REQUEST_FAILED', {
        content: 'failed',
        hookResultsErrorCode: 'HOOK_RESULTS_UNAVAILABLE',
      }),
    );

    expect(outcome.kind).toBe('ENVELOPE');
    if (outcome.kind === 'ENVELOPE') {
      expect(outcome.envelope.payload.hookResults).toBeUndefined();
      expect(outcome.envelope.payload.hookResultsErrorCode).toBe('HOOK_RESULTS_UNAVAILABLE');
    }
  });

  it('rejects malformed persisted Hook snapshots through the existing projection-failure boundary', () => {
    const outcome = projectTimelineEventToStreamEnvelope(
      terminalEvent('REQUEST_COMPLETED', {
        content: 'done',
        hookResults: [
          {
            hookInvocationId: 'hook-invalid',
            hookId: 'bash-result-hook',
            stage: 'AFTER_CAPABILITY_RESULT',
            status: 'FAILED',
            failureMode: 'CONTINUE',
            outcome: 'PASS',
          },
        ],
      }),
    );

    expect(outcome).toEqual({
      kind: 'PROJECTION_FAILURE',
      eventType: 'REQUEST_COMPLETED',
      safeError: {
        code: 'STREAM_PROJECTION_PAYLOAD_UNSAFE',
        message: 'Timeline event cannot be projected to the public stream.',
        category: 'VALIDATION',
        retryable: false,
      },
    });
  });

  it('rejects persisted Hook snapshots above the public capacity limit', () => {
    const outcome = projectTimelineEventToStreamEnvelope(
      terminalEvent('REQUEST_COMPLETED', {
        content: 'done',
        hookResults: [
          {
            hookInvocationId: 'hook-oversized',
            hookId: 'bash-result-hook',
            stage: 'AFTER_CAPABILITY_RESULT',
            status: 'SUCCESS',
            failureMode: 'CONTINUE',
            outcome: 'PASS',
            resultSummary: { output: 'x'.repeat(49_000) },
          },
        ],
      }),
    );

    expect(outcome).toEqual({
      kind: 'PROJECTION_FAILURE',
      eventType: 'REQUEST_COMPLETED',
      safeError: {
        code: 'STREAM_PROJECTION_PAYLOAD_UNSAFE',
        message: 'Timeline event cannot be projected to the public stream.',
        category: 'VALIDATION',
        retryable: false,
      },
    });
  });

  it('projects TodoWrite results as safe todo list results', () => {
    const outcome = projectTimelineEventToStreamEnvelope(
      capabilityResultEvent({
        capabilityId: 'TodoWrite',
        toolCallId: 'tool-todo-1',
        status: 'SUCCEEDED',
        result: {
          oldTodos: [],
          newTodos: [
            {
              content: 'Inspect AMF registration alarms',
              activeForm: 'Inspecting AMF registration alarms',
              status: 'in_progress',
            },
            {
              content: 'Summarize affected cells',
              activeForm: 'Summarizing affected cells',
              status: 'pending',
            },
          ],
        },
      }),
      {
        capabilityResultPresentationPolicy: { defaultLevel: 'DETAIL', levelByCapabilityId: new Map() },
      },
    );

    expect(outcome.kind).toBe('ENVELOPE');
    if (outcome.kind === 'ENVELOPE') {
      expect(outcome.envelope.payload.safeSummary).toBe('Todo list has 2 items.');
      expect(outcome.envelope.payload.safeResult).toEqual({
        kind: 'todoList',
        totalCount: 2,
        todos: [
          {
            content: 'Inspect AMF registration alarms',
            activeForm: 'Inspecting AMF registration alarms',
            status: 'in_progress',
          },
          {
            content: 'Summarize affected cells',
            activeForm: 'Summarizing affected cells',
            status: 'pending',
          },
        ],
      });
    }
  });
});

function terminalEvent(
  type: Extract<RunTimelineEvent['type'], 'REQUEST_COMPLETED' | 'REQUEST_FAILED' | 'REQUEST_CANCELED' | 'REQUEST_SUPERSEDED'>,
  inlinePayload: JsonObject,
): RunTimelineEvent {
  return {
    type,
    eventId: `timeline-${type.toLowerCase()}`,
    sessionId: brand<string, 'SessionId'>('session-terminal-projection'),
    requestId: brand<string, 'MessageId'>('request-terminal-projection'),
    runId: brand<string, 'RequestRunId'>('run-terminal-projection'),
    requestContextId: brand<string, 'RequestContextId'>('context-terminal-projection'),
    sequence: brand<number, 'TimelineSequence'>(10),
    createdAt: new Date(1_000),
    inlinePayload:
      inlinePayload.hookResults === undefined && inlinePayload.hookResultsErrorCode === undefined
        ? { ...inlinePayload, hookResults: [] }
        : inlinePayload,
  };
}

function capabilityResultEvent(inlinePayload: JsonObject): RunTimelineEvent {
  return {
    type: 'CAPABILITY_RESULT_DELTA',
    eventId: 'timeline-capability-result',
    sessionId: brand<string, 'SessionId'>('session-terminal-projection'),
    requestId: brand<string, 'MessageId'>('request-terminal-projection'),
    runId: brand<string, 'RequestRunId'>('run-terminal-projection'),
    requestContextId: brand<string, 'RequestContextId'>('context-terminal-projection'),
    sequence: brand<number, 'TimelineSequence'>(11),
    createdAt: new Date(1_100),
    inlinePayload,
  };
}
