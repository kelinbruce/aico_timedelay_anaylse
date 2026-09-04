import { brand, type JsonObject } from '@nextagent/agent-common';
import type { RunTimelineEventRecord, RunTimelineEventStoreGateway, RuntimeRunTimelineEventRecord } from '@nextagent/agent-contracts/gateway';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { buildTerminalHookResultSnapshot } from '../src/terminal/hook-result-snapshot.js';

const crossScopeCases: ReadonlyArray<[string, Partial<RuntimeRunTimelineEventRecord>]> = [
  ['tenant', { tenantId: brand<string, 'TenantId'>('tenant-foreign') }],
  ['subject', { subjectId: brand<string, 'SubjectId'>('subject-foreign') }],
  ['agent', { agentId: brand<string, 'AgentId'>('agent-foreign') }],
  ['session', { sessionId: brand<string, 'SessionId'>('session-foreign') }],
  ['request', { requestId: brand<string, 'MessageId'>('request-foreign') }],
  ['run', { runId: brand<string, 'RequestRunId'>('run-foreign') }],
];

describe('terminal Hook result snapshot', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('copies successful Hook results in timeline sequence order without processing content', async () => {
    const gateway = makeGateway(async () => [
      makeEvent(1, 'HOOK_INVOKED', successfulHookPayload('hook-1', { a: 1, b: 2 })),
      makeEvent(2, 'DEGRADATION_NOTICE', { code: 'IGNORED' }),
      makeEvent(3, 'HOOK_INVOKED', successfulHookPayload('hook-2', { nested: { '原样-key': [null, true, 'value'] } })),
    ]);

    await expect(buildTerminalHookResultSnapshot(gateway, snapshotScope)).resolves.toEqual({
      hookResults: [
        successfulHookPayload('hook-1', { a: 1, b: 2 }),
        successfulHookPayload('hook-2', { nested: { '原样-key': [null, true, 'value'] } }),
      ],
    });
  });

  it('returns an empty array when the run has no Hook facts', async () => {
    const gateway = makeGateway(async () => [makeEvent(1, 'DEGRADATION_NOTICE', { code: 'NO_HOOK' })]);

    await expect(buildTerminalHookResultSnapshot(gateway, snapshotScope)).resolves.toEqual({ hookResults: [] });
  });

  it('keeps non-success Hook facts without synthesizing outcome or resultSummary', async () => {
    const payload: JsonObject = {
      hookInvocationId: 'hook-timeout',
      hookId: 'bash-result-hook',
      stage: 'AFTER_CAPABILITY_RESULT',
      status: 'TIMEOUT',
      failureMode: 'CONTINUE',
    };
    const gateway = makeGateway(async () => [makeEvent(1, 'HOOK_INVOKED', payload)]);

    await expect(buildTerminalHookResultSnapshot(gateway, snapshotScope)).resolves.toEqual({ hookResults: [payload] });
  });

  it('reads every page without losing or duplicating Hook facts', async () => {
    const firstPage = Array.from({ length: 1_000 }, (_, index) => makeEvent(index + 1, 'DEGRADATION_NOTICE', { code: 'PAGE_ONE' }));
    const finalHook = makeEvent(1_001, 'HOOK_INVOKED', successfulHookPayload('hook-page-two', { page: 2 }));
    const listEvents = vi.fn(async (query: Parameters<RunTimelineEventStoreGateway['listEvents']>[0]) =>
      Number(query.afterSequence) === 0 ? firstPage : [finalHook],
    );

    await expect(buildTerminalHookResultSnapshot(makeGateway(listEvents), snapshotScope)).resolves.toEqual({
      hookResults: [successfulHookPayload('hook-page-two', { page: 2 })],
    });
    expect(listEvents).toHaveBeenCalledTimes(2);
    expect(listEvents.mock.calls[1]?.[0].afterSequence).toBe(1_000);
  });

  it.each(crossScopeCases)('rejects an out-of-scope %s fact instead of exposing it', async (_coordinate, override) => {
    const gateway = makeGateway(async () => [
      {
        ...makeEvent(1, 'HOOK_INVOKED', successfulHookPayload('foreign-hook', { secret: true })),
        ...override,
      },
    ]);

    await expect(buildTerminalHookResultSnapshot(gateway, snapshotScope)).resolves.toEqual({
      hookResultsErrorCode: 'HOOK_RESULTS_UNAVAILABLE',
    });
  });

  it('rejects an invalid Hook fact without returning a partial array', async () => {
    const gateway = makeGateway(async () => [
      makeEvent(1, 'HOOK_INVOKED', successfulHookPayload('valid-hook', { visible: true })),
      makeEvent(2, 'HOOK_INVOKED', {
        hookInvocationId: 'invalid-hook',
        hookId: 'bash-result-hook',
        stage: 'AFTER_CAPABILITY_RESULT',
        status: 'FAILED',
        failureMode: 'CONTINUE',
        outcome: 'PASS',
      }),
    ]);

    await expect(buildTerminalHookResultSnapshot(gateway, snapshotScope)).resolves.toEqual({
      hookResultsErrorCode: 'HOOK_RESULTS_INVALID',
    });
  });

  it('returns unavailable when timeline reading fails', async () => {
    const gateway = makeGateway(async () => {
      throw new Error('timeline unavailable');
    });

    await expect(buildTerminalHookResultSnapshot(gateway, snapshotScope)).resolves.toEqual({
      hookResultsErrorCode: 'HOOK_RESULTS_UNAVAILABLE',
    });
  });

  it('returns unavailable when pagination does not advance', async () => {
    const page = Array.from({ length: 1_000 }, (_, index) => makeEvent(index + 1, 'DEGRADATION_NOTICE', { code: 'STALLED' }));
    const gateway = makeGateway(async () => page);

    await expect(buildTerminalHookResultSnapshot(gateway, snapshotScope)).resolves.toEqual({
      hookResultsErrorCode: 'HOOK_RESULTS_UNAVAILABLE',
    });
  });

  it('returns unavailable when a timeline page times out', async () => {
    vi.useFakeTimers();
    const gateway = makeGateway(() => new Promise<readonly RunTimelineEventRecord[]>(() => undefined));

    const snapshotPromise = buildTerminalHookResultSnapshot(gateway, snapshotScope);
    await vi.advanceTimersByTimeAsync(5_000);

    await expect(snapshotPromise).resolves.toEqual({ hookResultsErrorCode: 'HOOK_RESULTS_UNAVAILABLE' });
  });

  it('returns the fixed limit error instead of truncating an oversized aggregate', async () => {
    const gateway = makeGateway(async () => [
      makeEvent(1, 'HOOK_INVOKED', successfulHookPayload('hook-large-1', { output: 'a'.repeat(25_000) })),
      makeEvent(2, 'HOOK_INVOKED', successfulHookPayload('hook-large-2', { output: 'b'.repeat(25_000) })),
    ]);

    await expect(buildTerminalHookResultSnapshot(gateway, snapshotScope)).resolves.toEqual({
      hookResultsErrorCode: 'HOOK_RESULTS_LIMIT_EXCEEDED',
    });
  });

  it('continues validating later pages after the aggregate exceeds the limit', async () => {
    const firstPage = [
      makeEvent(1, 'HOOK_INVOKED', successfulHookPayload('hook-large-1', { output: 'a'.repeat(25_000) })),
      makeEvent(2, 'HOOK_INVOKED', successfulHookPayload('hook-large-2', { output: 'b'.repeat(25_000) })),
      ...Array.from({ length: 998 }, (_, index) => makeEvent(index + 3, 'DEGRADATION_NOTICE', { code: 'PAGE_ONE' })),
    ];
    const invalidHook = makeEvent(1_001, 'HOOK_INVOKED', {
      hookInvocationId: 'invalid-after-limit',
      hookId: 'bash-result-hook',
      stage: 'AFTER_CAPABILITY_RESULT',
      status: 'FAILED',
      failureMode: 'CONTINUE',
      resultSummary: { mustNotBePresent: true },
    });
    const gateway = makeGateway(async (query) => (Number(query.afterSequence) === 0 ? firstPage : [invalidHook]));

    await expect(buildTerminalHookResultSnapshot(gateway, snapshotScope)).resolves.toEqual({
      hookResultsErrorCode: 'HOOK_RESULTS_INVALID',
    });
  });
});

const snapshotScope = {
  tenantId: brand<string, 'TenantId'>('tenant-hook-snapshot'),
  subjectId: brand<string, 'SubjectId'>('subject-hook-snapshot'),
  agentId: brand<string, 'AgentId'>('agent-hook-snapshot'),
  sessionId: brand<string, 'SessionId'>('session-hook-snapshot'),
  requestId: brand<string, 'MessageId'>('request-hook-snapshot'),
  runId: brand<string, 'RequestRunId'>('run-hook-snapshot'),
};

function makeGateway(listEvents: RunTimelineEventStoreGateway['listEvents']): RunTimelineEventStoreGateway {
  return {
    appendEvent: async (record) => record,
    listEvents,
  };
}

function makeEvent(sequence: number, type: RuntimeRunTimelineEventRecord['type'], inlinePayload: JsonObject): RuntimeRunTimelineEventRecord {
  return {
    ...snapshotScope,
    agentVersion: brand<string, 'AgentVersion'>('v1'),
    eventId: `event-${sequence}`,
    requestContextId: brand<string, 'RequestContextId'>('context-hook-snapshot'),
    sequence: brand<number, 'TimelineSequence'>(sequence),
    type,
    inlinePayload,
    createdAt: brand<number, 'EpochMillis'>(sequence),
  };
}

function successfulHookPayload(hookInvocationId: string, resultSummary: JsonObject): JsonObject {
  return {
    hookInvocationId,
    hookId: 'bash-result-hook',
    stage: 'AFTER_CAPABILITY_RESULT',
    status: 'SUCCESS',
    failureMode: 'CONTINUE',
    outcome: 'PASS',
    resultSummary,
  };
}
