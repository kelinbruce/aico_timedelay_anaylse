import { brand } from '@nextagent/agent-common';
import type { RuntimeConsumeSessionActivityCommand, RuntimeSessionActivityPort } from '@nextagent/agent-contracts/runtime';
import {
  SESSION_ACTIVITY_ID_MAX_LENGTH,
  type SessionActivityEntry,
  type SessionActivityMessage,
  type SessionActivityPort,
} from '@nextagent/agent-contracts/session';
import { describe, expect, it } from 'vitest';

const identityContext = {
  tenantId: brand<string, 'TenantId'>('tenant-session-activity'),
  subjectId: brand<string, 'SubjectId'>('subject-session-activity'),
  displayName: 'session activity tester',
};
const agentId = brand<string, 'AgentId'>('agent-session-activity');
const sessionId = brand<string, 'SessionId'>('session-session-activity');
const runId = brand<string, 'RequestRunId'>('run-session-activity');

describe('session activity public contracts', () => {
  it('keeps activity entries as one strict conditional shape', () => {
    const waiting: SessionActivityEntry = {
      sessionId,
      status: 'WAITING_FOR_INPUT',
      pendingInputKind: 'AUTHORIZATION',
    };
    const running: SessionActivityEntry = {
      sessionId,
      status: 'RUNNING',
    };
    const unreadFailure: SessionActivityEntry = {
      sessionId,
      status: 'UNREAD_FAILURE',
      activityId: 'activity:test-failure',
    };
    const unreadResult: SessionActivityEntry = {
      sessionId,
      status: 'UNREAD_RESULT',
      activityId: 'activity:test-result',
    };
    const none: SessionActivityEntry = {
      sessionId,
      status: 'NONE',
    };

    expect(waiting).toEqual({
      sessionId,
      status: 'WAITING_FOR_INPUT',
      pendingInputKind: 'AUTHORIZATION',
    });
    expect(running).toEqual({ sessionId, status: 'RUNNING' });
    expect(unreadFailure).toEqual({
      sessionId,
      status: 'UNREAD_FAILURE',
      activityId: 'activity:test-failure',
    });
    expect(unreadResult).toEqual({
      sessionId,
      status: 'UNREAD_RESULT',
      activityId: 'activity:test-result',
    });
    expect(none).toEqual({ sessionId, status: 'NONE' });
    expect(SESSION_ACTIVITY_ID_MAX_LENGTH).toBe(256);

    // @ts-expect-error RUNNING entries cannot carry terminal activity coordinates.
    const invalidRunning: SessionActivityEntry = { sessionId, status: 'RUNNING', activityId: 'invalid' };
    // @ts-expect-error Terminal entries require an opaque activity id.
    const invalidTerminal: SessionActivityEntry = { sessionId, status: 'UNREAD_RESULT' };
    // @ts-expect-error SNAPSHOT entries cannot contain NONE.
    const invalidSnapshot: SessionActivityMessage = { type: 'SNAPSHOT', entries: [none] };
    // @ts-expect-error Unknown fields are not part of a direct activity entry literal.
    const unknownField: SessionActivityEntry = { sessionId, status: 'RUNNING', revision: 1 };
    // @ts-expect-error Activity entries never expose a source run coordinate.
    const leakedRunId: SessionActivityEntry = { sessionId, status: 'UNREAD_RESULT', activityId: 'activity:test', runId };
    // @ts-expect-error Consumed-terminal suppression is private implementation state.
    const privateState: SessionActivityEntry = { sessionId, status: 'CONSUMED_TERMINAL' };
    void invalidRunning;
    void invalidTerminal;
    void invalidSnapshot;
    void unknownField;
    void leakedRunId;
    void privateState;
  });

  it('keeps the domain port explicitly owner, agent, and session scoped', async () => {
    const observed: string[] = [];
    const port: SessionActivityPort = {
      invalidateSessionActivity(coordinates) {
        observed.push(`invalidate:${coordinates.sessionId}`);
      },
      invalidateDeletedSession(coordinates) {
        observed.push(`delete:${coordinates.sessionId}`);
      },
      async *streamActivities(query) {
        expect(query.identityContext).toBe(identityContext);
        expect(query.agentId).toBe(agentId);
        yield { type: 'SNAPSHOT', entries: [] };
      },
      async consumeTerminalActivity(command) {
        expect(command).toMatchObject({
          identityContext,
          agentId,
          sessionId,
          activityId: 'activity:test-result',
          observedRunId: runId,
        });
        observed.push(`consume:${command.sessionId}`);
      },
    };

    port.invalidateSessionActivity({
      tenantId: identityContext.tenantId,
      subjectId: identityContext.subjectId,
      agentId,
      sessionId,
    });
    port.invalidateDeletedSession({
      tenantId: identityContext.tenantId,
      subjectId: identityContext.subjectId,
      agentId,
      sessionId,
    });
    const messages: SessionActivityMessage[] = [];
    for await (const message of port.streamActivities({ identityContext, agentId })) {
      messages.push(message);
    }
    await port.consumeTerminalActivity({
      identityContext,
      agentId,
      sessionId,
      activityId: 'activity:test-result',
      observedRunId: runId,
    });

    expect(messages).toEqual([{ type: 'SNAPSHOT', entries: [] }]);
    expect(observed).toEqual([`invalidate:${sessionId}`, `delete:${sessionId}`, `consume:${sessionId}`]);
  });

  it('keeps Agent Scope out of the channel-facing runtime port', async () => {
    const observed: unknown[] = [];
    const runtimePort: RuntimeSessionActivityPort = {
      async *streamSessionActivities(query) {
        observed.push(query);
        yield { type: 'SNAPSHOT', entries: [] };
      },
      async consumeSessionActivity(command) {
        observed.push(command);
      },
    };
    const streamQuery = { identityContext };
    const consumeCommand = {
      identityContext,
      sessionId,
      activityId: 'activity:test-result',
      observedRunId: runId,
    };
    // @ts-expect-error A presented run coordinate is required for terminal consumption.
    const missingObservedRunId: RuntimeConsumeSessionActivityCommand = {
      identityContext,
      sessionId,
      activityId: 'activity:test-result',
    };
    const injectedAgentId: RuntimeConsumeSessionActivityCommand = {
      identityContext,
      // @ts-expect-error Agent Scope is closed over by composition, not accepted from channel input.
      agentId,
      sessionId,
      activityId: 'activity:test-result',
      observedRunId: runId,
    };
    void missingObservedRunId;
    void injectedAgentId;

    for await (const message of runtimePort.streamSessionActivities(streamQuery)) {
      expect(message).toEqual({ type: 'SNAPSHOT', entries: [] });
    }
    await runtimePort.consumeSessionActivity(consumeCommand);

    expect(Object.hasOwn(streamQuery, 'agentId')).toBe(false);
    expect(Object.hasOwn(consumeCommand, 'agentId')).toBe(false);
    expect(Object.hasOwn(consumeCommand, 'status')).toBe(false);
    expect(observed).toEqual([streamQuery, consumeCommand]);
  });
});
