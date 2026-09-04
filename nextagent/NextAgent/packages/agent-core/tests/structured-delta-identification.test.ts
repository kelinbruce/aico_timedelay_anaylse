import { identifyStructuredDelta, tryEmitStructuredDelta } from '../src/tools/structured-delta-identification.js';
import { brand, type JsonObject } from '@nextagent/agent-common';
import type { AgentRunStatePort, RequestContext, RequestRun } from '@nextagent/agent-contracts/runtime';
import { describe, expect, it } from 'vitest';

describe('identifyStructuredDelta', () => {
  it('matches direct shape', () => {
    const result = identifyStructuredDelta({ eventType: 'ANSWER', messageType: 'TEXT', content: 'result' });
    expect(result).toEqual({ eventType: 'ANSWER', messageType: 'TEXT', content: 'result' });
  });

  it('matches envelope shape', () => {
    const inner = JSON.stringify({ eventType: 'ANSWER', messageType: 'TEXT', content: 'result' });
    const result = identifyStructuredDelta({ status: 'ok', data: { raw: inner } });
    expect(result).toEqual({ eventType: 'ANSWER', messageType: 'TEXT', content: 'result' });
  });

  it('matches code-msg-data envelope shape', () => {
    const inner = JSON.stringify({ eventType: 'ANSWER', messageType: 'TEXT', content: 'result' });
    const result = identifyStructuredDelta({ code: 200, msg: 'success', data: inner });
    expect(result).toEqual({ eventType: 'ANSWER', messageType: 'TEXT', content: 'result' });
  });

  it('returns undefined for non-structured object', () => {
    expect(identifyStructuredDelta({ foo: 'bar' })).toBeUndefined();
  });

  it('returns undefined for envelope with status not ok', () => {
    const inner = JSON.stringify({ eventType: 'ANSWER', messageType: 'TEXT', content: 'x' });
    expect(identifyStructuredDelta({ status: 'error', data: { raw: inner } })).toBeUndefined();
  });
  it('returns undefined for code-msg-data envelope with non-200 code', () => {
    const inner = JSON.stringify({ eventType: 'ANSWER', messageType: 'TEXT', content: 'x' });
    expect(identifyStructuredDelta({ code: 500, msg: 'error', data: inner })).toBeUndefined();
  });

  it('returns undefined for envelope with malformed raw', () => {
    expect(identifyStructuredDelta({ status: 'ok', data: { raw: 'not json' } })).toBeUndefined();
  });
  it('returns undefined for code-msg-data envelope with malformed data string', () => {
    expect(identifyStructuredDelta({ code: 200, msg: 'success', data: 'not json' })).toBeUndefined();
  });

  it('returns undefined for null', () => {
    expect(identifyStructuredDelta(null)).toBeUndefined();
  });
});

describe('tryEmitStructuredDelta', () => {
  function makeRunState() {
    const events: Array<{ type: string; inlinePayload: Record<string, unknown> }> = [];
    const runState: AgentRunStatePort = {
      async setCapabilityTerminalAnswer(): Promise<void> {},
      async emitEvent(_run, _context, event) {
        events.push(event as { type: string; inlinePayload: Record<string, unknown> });
      },
      async appendMessage() {
        return brand<string, 'MessageId'>('msg');
      },
      async saveCheckpoint() {},
      async requestPendingInput() {
        throw new Error('not expected');
      },
    };
    return { events, runState };
  }

  it('emits TOOL_STRUCTURED_DELTA for direct shape candidate', async () => {
    const { events, runState } = makeRunState();
    await tryEmitStructuredDelta(runState, run(), context(), 'ApiCall', 'call-1', {
      eventType: 'TITLE',
      messageType: 'PIU',
      content: { label: 'alarm' },
    });
    expect(events).toHaveLength(1);
    expect(events[0]!.type).toBe('TOOL_STRUCTURED_DELTA');
    expect(events[0]!.inlinePayload.toolEventType).toBe('TITLE');
    expect(events[0]!.inlinePayload.capabilityId).toBe('ApiCall');
  });

  it('emits TOOL_STRUCTURED_DELTA for envelope shape candidate', async () => {
    const { events, runState } = makeRunState();
    const inner = JSON.stringify({ eventType: 'DETAIL', messageType: 'DSL', content: 'diag' });
    await tryEmitStructuredDelta(runState, run(), context(), 'ApiCall', 'call-1', { status: 'ok', data: { raw: inner } });
    expect(events).toHaveLength(1);
    expect(events[0]!.inlinePayload.toolEventType).toBe('DETAIL');
  });
  it('emits TOOL_STRUCTURED_DELTA for code-msg-data envelope candidate', async () => {
    const { events, runState } = makeRunState();
    const inner = JSON.stringify({ eventType: 'DETAIL', messageType: 'DSL', content: 'diag' });
    await tryEmitStructuredDelta(runState, run(), context(), 'Bash', 'call-1', { code: 200, msg: 'success', data: inner });
    expect(events).toHaveLength(1);
    expect(events[0]!.inlinePayload.toolEventType).toBe('DETAIL');
  });

  it('does NOT emit for non-structured candidate', async () => {
    const { events, runState } = makeRunState();
    await tryEmitStructuredDelta(runState, run(), context(), 'ApiCall', 'call-1', { foo: 'bar' });
    expect(events).toHaveLength(0);
  });

  it.each(['api_key', 'credential', 'password', 'secret', 'token'])('does NOT emit for %s indicator', async (keyword) => {
    const { events, runState } = makeRunState();
    await tryEmitStructuredDelta(runState, run(), context(), 'ApiCall', 'call-1', {
      eventType: 'ANSWER',
      messageType: 'TEXT',
      content: `the ${keyword} is leaked`,
    });
    expect(events).toHaveLength(0);
  });

  it('emits when authorization is the only credential indicator keyword', async () => {
    const { events, runState } = makeRunState();
    await tryEmitStructuredDelta(runState, run(), context(), 'ApiCall', 'call-1', {
      eventType: 'ANSWER',
      messageType: 'TEXT',
      content: 'authorizationUrl is available',
    });
    expect(events).toHaveLength(1);
    expect(events[0]!.inlinePayload.content).toBe('authorizationUrl is available');
  });

  it('includes streaming: true marker when streaming flag is passed', async () => {
    const { events, runState } = makeRunState();
    await tryEmitStructuredDelta(
      runState,
      run(),
      context(),
      'ApiCall',
      'call-1',
      {
        eventType: 'ANSWER',
        messageType: 'TEXT',
        content: 'stream chunk',
      },
      true,
    );
    expect(events).toHaveLength(1);
    expect(events[0]!.inlinePayload.streaming).toBe(true);
  });

  it('does NOT include streaming marker when streaming flag is not passed', async () => {
    const { events, runState } = makeRunState();
    await tryEmitStructuredDelta(runState, run(), context(), 'ApiCall', 'call-1', {
      eventType: 'ANSWER',
      messageType: 'TEXT',
      content: 'non-stream result',
    });
    expect(events).toHaveLength(1);
    expect(events[0]!.inlinePayload.streaming).toBeUndefined();
  });
});

function run(): RequestRun {
  return {
    runId: brand<string, 'RequestRunId'>('run-1'),
    sessionId: brand<string, 'SessionId'>('session-1'),
    requestId: brand<string, 'MessageId'>('request-1'),
    agentId: brand<string, 'AgentId'>('default-agent'),
    agentVersion: brand<string, 'AgentVersion'>('v1'),
    agentAssemblyRef: 'default-agent:v1',
    attempt: 1,
    status: 'EXECUTING',
    version: 1,
    terminalCommitState: 'NOT_STARTED',
    createdAt: brand<number, 'EpochMillis'>(1),
    updatedAt: brand<number, 'EpochMillis'>(1),
  };
}

function context(): RequestContext {
  return {
    requestContextId: brand<string, 'RequestContextId'>('context-1'),
    sessionId: brand<string, 'SessionId'>('session-1'),
    requestId: brand<string, 'MessageId'>('request-1'),
    runId: brand<string, 'RequestRunId'>('run-1'),
    agentTurnIndex: 0,
    identityContext: {
      tenantId: brand<string, 'TenantId'>('tenant-1'),
      subjectId: brand<string, 'SubjectId'>('subject-1'),
      displayName: 'tester',
    },
    locale: brand<string, 'RequestLocale'>('zh-CN'),
    agentId: brand<string, 'AgentId'>('default-agent'),
    agentVersion: brand<string, 'AgentVersion'>('v1'),
    agentAssemblyRef: 'default-agent:v1',
    nextLifecycleStage: 'BEFORE_MODEL_INVOKE',
    toolCallStates: [],
    flowVariables: {},
  };
}
