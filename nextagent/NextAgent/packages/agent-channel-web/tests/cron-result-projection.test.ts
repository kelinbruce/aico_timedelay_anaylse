import { brand, type JsonObject } from '@nextagent/agent-common';
import type { RunTimelineEvent } from '@nextagent/agent-contracts/runtime';
import { projectTimelineEventToStreamEnvelope as projectWithoutPolicy } from '@nextagent/agent-channel-web';
import { describe, expect, it } from 'vitest';

const projectTimelineEventToStreamEnvelope = (event: RunTimelineEvent) =>
  projectWithoutPolicy(event, {
    capabilityResultPresentationPolicy: { defaultLevel: 'DETAIL', levelByCapabilityId: new Map() },
  });

describe('Cron CAPABILITY_RESULT_DELTA stream projection', () => {
  it('projects create and delete results with action-aware safe fields', () => {
    const created = projectCronResult({
      action: 'create',
      id: 'cron-task-1',
      humanSchedule: 'Every day at 3:17 AM',
      recurring: true,
      prompt: 'must-not-be-projected',
    });
    const deleted = projectCronResult({ action: 'delete', id: 'cron-task-1', unknown: 'hidden' });

    expect(created.payload.safeSummary).toBe('Cron task was created.');
    expect(created.payload.safeResult).toEqual({
      kind: 'cron',
      action: 'create',
      id: 'cron-task-1',
      humanSchedule: 'Every day at 3:17 AM',
      recurring: true,
    });
    expect(JSON.stringify(created.payload)).not.toContain('must-not-be-projected');
    const delayed = projectCronResult({
      action: 'create',
      id: 'delay-1',
      humanSchedule: 'Once after 10 minutes',
      recurring: false,
      delay: { minutes: 10 },
      prompt: 'hidden',
    });
    expect(delayed.payload.safeResult).toEqual({
      kind: 'cron',
      action: 'create',
      id: 'delay-1',
      humanSchedule: 'Once after 10 minutes',
      recurring: false,
      delay: { minutes: 10 },
    });
    expect(JSON.stringify(delayed.payload)).not.toContain('hidden');
    expect(
      projectCronResult({ action: 'create', id: 'bad-delay', humanSchedule: 'hidden', recurring: false, delay: { minutes: 'bad' } }).payload
        .safeResult,
    ).toBeUndefined();
    expect(deleted.payload.safeResult).toEqual({ kind: 'cron', action: 'delete', id: 'cron-task-1' });
    expect(JSON.stringify(deleted.payload)).not.toContain('hidden');
  });

  it('bounds list results and omits every task prompt', () => {
    const jobs = Array.from({ length: 51 }, (_, index) => ({
      id: `cron-task-${index + 1}`,
      cron: '17 3 * * *',
      humanSchedule: 'Every day at 3:17 AM',
      prompt: `private-prompt-${index + 1}`,
      recurring: index % 2 === 0,
    }));
    const outcome = projectCronResult({ action: 'list', jobs });
    const safeResult = outcome.payload.safeResult as JsonObject;

    expect(outcome.payload.safeSummary).toBe('Found 51 Cron tasks.');
    expect(safeResult.kind).toBe('cron');
    expect(safeResult.action).toBe('list');
    expect(safeResult.totalCount).toBe(51);
    expect(safeResult.truncated).toBe(true);
    expect(safeResult.jobs).toHaveLength(50);
    expect(JSON.stringify(outcome.payload)).not.toContain('private-prompt');
  });

  it('fails closed for malformed or unknown Cron results', () => {
    const malformed = projectCronResult({ action: 'create', prompt: 'hidden' });
    const unknown = projectCronResult({
      action: 'pause',
      prompt: 'hidden',
      raw: 'secret',
      exitCode: 0,
      stdout: 'must-not-cross-project',
    });

    for (const outcome of [malformed, unknown]) {
      expect(outcome.payload.safeResult).toBeUndefined();
      expect(outcome.payload.safeSummary).toBeUndefined();
      expect(outcome.payload.text).toBe('');
      expect(JSON.stringify(outcome.payload)).not.toContain('hidden');
      expect(JSON.stringify(outcome.payload)).not.toContain('secret');
      expect(JSON.stringify(outcome.payload)).not.toContain('must-not-cross-project');
    }
  });
});

function projectCronResult(result: JsonObject) {
  const outcome = projectTimelineEventToStreamEnvelope(cronResultEvent(result));
  expect(outcome.kind).toBe('ENVELOPE');
  if (outcome.kind !== 'ENVELOPE') {
    throw new Error('Expected Cron result to produce a stream envelope.');
  }
  return outcome.envelope;
}

function cronResultEvent(result: JsonObject): RunTimelineEvent {
  return {
    type: 'CAPABILITY_RESULT_DELTA',
    eventId: 'timeline-cron-result',
    sessionId: brand<string, 'SessionId'>('session-cron-result'),
    requestId: brand<string, 'MessageId'>('request-cron-result'),
    runId: brand<string, 'RequestRunId'>('run-cron-result'),
    requestContextId: brand<string, 'RequestContextId'>('context-cron-result'),
    sequence: brand<number, 'TimelineSequence'>(20),
    createdAt: new Date(1_000),
    inlinePayload: {
      capabilityId: 'Cron',
      toolCallId: 'call-cron-result',
      result,
    },
  };
}
