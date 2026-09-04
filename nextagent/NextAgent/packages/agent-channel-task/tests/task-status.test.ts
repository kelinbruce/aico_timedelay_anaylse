import { brand, type RunStatus } from '@nextagent/agent-common';
import type { StreamEnvelope, StreamEventType } from '@nextagent/agent-contracts/channel';
import { describe, expect, it } from 'vitest';

import { mapTaskStreamEnvelopes, projectRunStatusToTaskStatus, projectStreamEventTypeToTaskEventType } from '../src/task-status.js';

describe('projectRunStatusToTaskStatus', () => {
  const cases: ReadonlyArray<{ readonly status: RunStatus; readonly expected: string }> = [
    { status: 'ACCEPTED', expected: 'TASK_ACCEPTED' },
    { status: 'QUEUED', expected: 'TASK_QUEUED' },
    { status: 'PLANNING', expected: 'TASK_PLANNING' },
    { status: 'EXECUTING', expected: 'TASK_EXECUTING' },
    { status: 'COMPLETED', expected: 'TASK_COMPLETED' },
    { status: 'FAILED', expected: 'TASK_FAILED' },
    { status: 'CANCELED', expected: 'TASK_CANCELED' },
    { status: 'SUPERSEDED', expected: 'TASK_SUPERSEDED' },
  ];

  for (const { status, expected } of cases) {
    it(`maps ${status} to ${expected}`, () => {
      expect(projectRunStatusToTaskStatus(status)).toBe(expected);
    });
  }

  it('covers all 8 RunStatus values', () => {
    expect(cases.length).toBe(8);
  });

  it('projects an active pending input before the run status', () => {
    expect(projectRunStatusToTaskStatus('EXECUTING', true)).toBe('TASK_PENDING');
  });
});

describe('projectStreamEventTypeToTaskEventType', () => {
  const cases: ReadonlyArray<{ readonly eventType: StreamEventType; readonly expected: string }> = [
    { eventType: 'REQUEST_ACCEPTED', expected: 'TASK_ACCEPTED' },
    { eventType: 'LLM_THINKING_DELTA', expected: 'THINKING_DELTA' },
    { eventType: 'LLM_CONTENT_DELTA', expected: 'CONTENT_DELTA' },
    { eventType: 'CAPABILITY_STARTED', expected: 'CAPABILITY_STARTED' },
    { eventType: 'CAPABILITY_RESULT_DELTA', expected: 'CAPABILITY_RESULT_DELTA' },
    { eventType: 'CAPABILITY_COMPLETED', expected: 'CAPABILITY_COMPLETED' },
    { eventType: 'TOOL_STRUCTURED_DELTA', expected: 'TOOL_STRUCTURED_DELTA' },
    { eventType: 'DEGRADATION_NOTICE', expected: 'DEGRADATION_NOTICE' },
    { eventType: 'REQUEST_COMPLETED', expected: 'TASK_COMPLETED' },
    { eventType: 'REQUEST_FAILED', expected: 'TASK_FAILED' },
    { eventType: 'REQUEST_CANCELED', expected: 'TASK_CANCELED' },
    { eventType: 'REQUEST_SUPERSEDED', expected: 'TASK_SUPERSEDED' },
    { eventType: 'USER_INPUT_REQUIRED', expected: 'USER_INPUT_REQUIRED' },
    { eventType: 'USER_INPUT_RECEIVED', expected: 'USER_INPUT_RECEIVED' },
    { eventType: 'USER_INPUT_TIMEOUT', expected: 'USER_INPUT_TIMEOUT' },
    { eventType: 'USER_INPUT_CANCELED', expected: 'USER_INPUT_CANCELED' },
    { eventType: 'ATTACHMENT_ACCEPTED', expected: 'ATTACHMENT_ACCEPTED' },
    { eventType: 'ATTACHMENT_REJECTED', expected: 'ATTACHMENT_REJECTED' },
    { eventType: 'CONTEXT_COMPACTED', expected: 'CONTEXT_COMPACTED' },
    { eventType: 'BACKGROUND_TASK_STARTED', expected: 'BACKGROUND_TASK_STARTED' },
    { eventType: 'BACKGROUND_TASK_COMPLETED', expected: 'BACKGROUND_TASK_COMPLETED' },
    { eventType: 'BACKGROUND_TASK_FAILED', expected: 'BACKGROUND_TASK_FAILED' },
    { eventType: 'OUTPUT_GUARD_BLOCKED', expected: 'OUTPUT_GUARD_BLOCKED' },
  ];

  for (const { eventType, expected } of cases) {
    it(`maps ${eventType} to ${expected}`, () => {
      expect(projectStreamEventTypeToTaskEventType(eventType)).toBe(expected);
    });
  }

  it('covers all 23 StreamEventType values', () => {
    expect(cases.length).toBe(23);
  });
});

describe('mapTaskStreamEnvelopes', () => {
  it('projects envelope to TaskEvent without internal aliases', async () => {
    const source: StreamEnvelope = {
      eventId: 'event-1',
      sessionId: brand<string, 'SessionId'>('session-1'),
      requestId: brand<string, 'MessageId'>('request-1'),
      runId: brand<string, 'RequestRunId'>('run-1'),
      requestContextId: brand<string, 'RequestContextId'>('context-1'),
      sequence: brand<number, 'TimelineSequence'>(1),
      eventType: 'REQUEST_COMPLETED',
      transportHints: [],
      payload: {},
      createdAt: brand<number, 'EpochMillis'>(10),
    };

    const projected = [];
    for await (const event of mapTaskStreamEnvelopes(
      (async function* () {
        yield source;
      })(),
    )) {
      projected.push(event);
    }

    expect(projected).toEqual([
      expect.objectContaining({
        eventId: 'event-1',
        eventType: 'TASK_COMPLETED',
        sessionId: 'session-1',
        taskId: 'request-1',
        sequence: 1,
        createdAt: 10,
        payload: {},
      }),
    ]);
    expect(projected[0]).not.toHaveProperty('requestId');
    expect(projected[0]).not.toHaveProperty('requestContextId');
    expect(projected[0]).not.toHaveProperty('runId');
    expect(projected[0]).not.toHaveProperty('contextId');
  });
});
