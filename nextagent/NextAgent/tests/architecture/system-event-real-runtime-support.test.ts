import { describe, expect, it } from 'vitest';
import {
  isTerminalEventType,
  parseSseFrames,
  requireEvent,
  safeEvidence,
  selectRunEvents,
} from '../manual/system-event-real-runtime/verify-support.mjs';

describe('system event real Runtime verification support', () => {
  it('parses complete SSE event frames', () => {
    expect(
      parseSseFrames(
        'event: DEGRADATION_NOTICE\ndata: {"eventType":"DEGRADATION_NOTICE","runId":"run-1"}\n\n' +
          'event: REQUEST_FAILED\ndata: {"eventType":"REQUEST_FAILED","runId":"run-1"}\n\n',
      ),
    ).toEqual([
      { event: 'DEGRADATION_NOTICE', data: { eventType: 'DEGRADATION_NOTICE', runId: 'run-1' } },
      { event: 'REQUEST_FAILED', data: { eventType: 'REQUEST_FAILED', runId: 'run-1' } },
    ]);
  });

  it('selects only the requested run and requires a target event', () => {
    const events = [
      { eventType: 'REQUEST_ACCEPTED', runId: 'run-1', payload: {} },
      { eventType: 'DEGRADATION_NOTICE', runId: 'run-1', payload: { code: 'SYSTEM_EVENT_SCENARIO_FAILED' } },
      { eventType: 'REQUEST_COMPLETED', runId: 'run-2', payload: {} },
    ];

    expect(selectRunEvents(events, 'run-1')).toEqual(events.slice(0, 2));
    expect(requireEvent(events, 'run-1', 'DEGRADATION_NOTICE')).toEqual(events[1]);
    expect(() => requireEvent(events, 'run-1', 'CONTEXT_COMPACTED')).toThrow('CONTEXT_COMPACTED was not observed for run run-1.');
  });

  it('recognizes only canonical request terminal events', () => {
    expect(isTerminalEventType('REQUEST_COMPLETED')).toBe(true);
    expect(isTerminalEventType('REQUEST_FAILED')).toBe(true);
    expect(isTerminalEventType('REQUEST_CANCELED')).toBe(true);
    expect(isTerminalEventType('REQUEST_SUPERSEDED')).toBe(true);
    expect(isTerminalEventType('DEGRADATION_NOTICE')).toBe(false);
  });

  it('emits only allowlisted safe evidence fields', () => {
    expect(
      safeEvidence({
        scenario: 'degradation',
        sessionId: 'session-1',
        requestId: 'request-1',
        runId: 'run-1',
        eventType: 'DEGRADATION_NOTICE',
        code: 'SYSTEM_EVENT_SCENARIO_FAILED',
        terminalStatus: 'FAILED',
        rounds: [{ requestId: 'request-seed', runId: 'run-seed', terminalStatus: 'COMPLETED', prompt: 'private input' }],
        historyEventTypes: ['REQUEST_ACCEPTED', 'DEGRADATION_NOTICE', 'REQUEST_FAILED'],
        credential: 'secret',
        token: 'secret',
        prompt: 'private input',
      }),
    ).toEqual({
      scenario: 'degradation',
      sessionId: 'session-1',
      requestId: 'request-1',
      runId: 'run-1',
      eventType: 'DEGRADATION_NOTICE',
      code: 'SYSTEM_EVENT_SCENARIO_FAILED',
      terminalStatus: 'FAILED',
      rounds: [{ requestId: 'request-seed', runId: 'run-seed', terminalStatus: 'COMPLETED' }],
      historyEventTypes: ['REQUEST_ACCEPTED', 'DEGRADATION_NOTICE', 'REQUEST_FAILED'],
    });
  });
});
