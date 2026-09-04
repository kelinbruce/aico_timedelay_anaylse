import { brand } from '@nextagent/agent-common';
import type { SessionLaneSnapshot } from '@nextagent/agent-contracts/gateway';
import { createSessionActivityService } from '@nextagent/agent-session';
import { describe, expect, it, vi } from 'vitest';
import { createSessionActivityTimelineListener } from '../src/composition/request-runtime-composition.js';
import { createRuntimeSessionActivityPort } from '../src/composition/session-services-composition.js';

describe('session activity composition', () => {
  it('closes trusted Agent Scope over the runtime-facing adapter', async () => {
    const streamActivities = vi.fn(async function* () {
      yield { type: 'SNAPSHOT', entries: [] } as const;
    });
    const consumeTerminalActivity = vi.fn(async () => undefined);
    const trustedAgentId = brand<string, 'AgentId'>('trusted-agent');
    const identityContext = {
      tenantId: brand<string, 'TenantId'>('tenant-1'),
      subjectId: brand<string, 'SubjectId'>('subject-1'),
      displayName: 'Tester',
    };
    const port = createRuntimeSessionActivityPort(
      {
        streamActivities,
        consumeTerminalActivity,
      },
      trustedAgentId,
    );

    const iterator = port.streamSessionActivities({ identityContext })[Symbol.asyncIterator]();
    expect(await iterator.next()).toEqual({ done: false, value: { type: 'SNAPSHOT', entries: [] } });
    await port.consumeSessionActivity({
      identityContext,
      sessionId: brand('session-1'),
      activityId: 'activity-1',
      observedRunId: brand('run-1'),
    });

    expect(streamActivities).toHaveBeenCalledWith({ identityContext, agentId: trustedAgentId });
    expect(consumeTerminalActivity).toHaveBeenCalledWith({
      identityContext,
      agentId: trustedAgentId,
      sessionId: 'session-1',
      activityId: 'activity-1',
      observedRunId: 'run-1',
    });
  });

  it('projects a committed request invalidation through the composed activity owner', async () => {
    const tenantId = brand<string, 'TenantId'>('tenant-activity-composition');
    const subjectId = brand<string, 'SubjectId'>('subject-activity-composition');
    const trustedAgentId = brand<string, 'AgentId'>('agent-activity-composition');
    const sessionId = brand<string, 'SessionId'>('session-activity-composition');
    const runId = brand<string, 'RequestRunId'>('run-activity-composition');
    const requestId = brand<string, 'MessageId'>('request-activity-composition');
    const service = createSessionActivityService({
      sessions: {
        loadSession: vi.fn(async () => undefined),
        listSessions: vi.fn(async (query) => ({
          entries: [],
          offset: query.offset,
          limit: query.limit,
          hasMore: false,
        })),
      },
      requestRuns: {
        loadSessionLaneSnapshot: vi.fn(
          async () =>
            ({
              tenantId,
              subjectId,
              agentId: trustedAgentId,
              sessionId,
              queuedRuns: [],
              latestRun: {
                tenantId,
                subjectId,
                agentId: trustedAgentId,
                sessionId,
                requestId,
                runId,
                agentVersion: brand<string, 'AgentVersion'>('1.0.0'),
                agentAssemblyRef: 'assembly-ref',
                attempt: 1,
                status: 'EXECUTING',
                version: 1,
                terminalCommitState: 'NOT_STARTED',
                createdAt: brand<number, 'EpochMillis'>(1),
                updatedAt: brand<number, 'EpochMillis'>(1),
              },
            }) satisfies SessionLaneSnapshot,
        ),
      },
      pendingInputs: {
        loadActivePendingInput: vi.fn(async () => undefined),
      },
    });
    const abortController = new AbortController();
    const iterator = service
      .streamActivities({
        identityContext: { tenantId, subjectId, displayName: 'Activity Composition Tester' },
        agentId: trustedAgentId,
        signal: abortController.signal,
      })
      [Symbol.asyncIterator]();
    await expect(iterator.next()).resolves.toEqual({
      done: false,
      value: { type: 'SNAPSHOT', entries: [] },
    });

    createSessionActivityTimelineListener(service)({
      tenantId,
      subjectId,
      agentId: trustedAgentId,
      sessionId,
      runId,
      requestId,
      persistence: 'PERSISTED',
      type: 'REQUEST_ACCEPTED',
      inlinePayload: {},
    });

    await expect(
      Promise.race([
        iterator.next(),
        new Promise<never>((_, reject) => {
          setTimeout(() => reject(new Error('Timed out waiting for composed activity delta.')), 2_000);
        }),
      ]),
    ).resolves.toEqual({
      done: false,
      value: {
        type: 'DELTA',
        entry: { sessionId, status: 'RUNNING' },
      },
    });
    abortController.abort();
    await iterator.return?.();
  });
});
