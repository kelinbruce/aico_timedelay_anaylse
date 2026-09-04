import { createNextAgentTestApp } from '@nextagent/agent-platform-gateway-local/testing';
import {
  brand,
  type EpochMillis,
  type IdentityContext,
  type MessageId,
  type RequestContextId,
  type RequestRunId,
  type SessionId,
} from '@nextagent/agent-common';
import { deliverWebStream } from '@nextagent/agent-channel-web';
import type { StreamEnvelope } from '@nextagent/agent-contracts/channel';
import type { RunTimelineEventRecord, SessionMessageRecord } from '@nextagent/agent-contracts/gateway';
import { describe, expect, it } from 'vitest';

const identity: IdentityContext = {
  tenantId: brand<string, 'TenantId'>('tenant-history-consistency'),
  subjectId: brand<string, 'SubjectId'>('subject-history-consistency'),
  displayName: 'History consistency tester',
};
const agentId = brand<string, 'AgentId'>('default-agent');

describe('stream and history consistency', () => {
  it('keeps final messages and durable thinking in separate cold-history projections', async () => {
    const app = createNextAgentTestApp({
      workspaceDir: process.cwd(),
      modelSteps: [{ reasoningChunks: ['checking ', 'routes'], content: 'final routing answer' }],
      identity,
    });
    const accepted = await app.server.inject({
      method: 'POST',
      url: '/api/v1/requests',
      payload: { inputText: 'check routing', idempotencyKey: 'idem-thinking-history-consistency' },
    });
    expect(accepted.statusCode).toBe(200);
    const body = accepted.json<{ readonly sessionId: string; readonly requestId: string; readonly runId: string }>();
    await waitForTerminal(app, body.runId);

    const conversation = await app.server.inject({ method: 'GET', url: `/api/v1/sessions/${body.sessionId}/conversation?limit=10` });
    const firstHistory = await app.server.inject({ method: 'GET', url: `/api/v1/sessions/${body.sessionId}/runs/${body.runId}/events` });
    const secondHistory = await app.server.inject({ method: 'GET', url: `/api/v1/sessions/${body.sessionId}/runs/${body.runId}/events` });

    expect(conversation.statusCode).toBe(200);
    expect(conversation.body).toContain('final routing answer');
    expect(conversation.body).not.toContain('checking routes');
    expect(firstHistory.statusCode).toBe(200);
    expect(secondHistory.json()).toEqual(firstHistory.json());
    const history = firstHistory.json<{ availability: string; events: StreamEnvelope[] }>();
    const thinking = history.events.filter((event) => event.eventType === 'LLM_THINKING_DELTA');
    expect(thinking).toHaveLength(1);
    expect(thinking[0]).toMatchObject({
      payload: {
        reasoning: 'checking routes',
        stepId: 'turn-1',
        metadata: { accumulated: true, completed: true },
      },
    });
    expect(history.events.findIndex((event) => event.eventType === 'LLM_THINKING_DELTA')).toBeLessThan(
      history.events.findIndex((event) => event.eventType === 'REQUEST_COMPLETED'),
    );
    expect(history.events.map((event) => event.eventType)).not.toContain('LLM_CONTENT_DELTA');
  });

  it('uses runtime timeline for stream replay and visible session messages for history', async () => {
    const app = createNextAgentTestApp({
      workspaceDir: process.cwd(),
      modelSteps: [{ content: 'unused' }],
      identity,
    });
    const session = await app.runtime.createSession({
      identityContext: identity,
      idempotencyKey: brand<string, 'IdempotencyKey'>('idem-history-source-session'),
    });
    const requestId = brand<string, 'MessageId'>('request-history-source');
    const runId = brand<string, 'RequestRunId'>('run-history-source');
    await app.gateway.requestRuns.saveRun(
      {
        tenantId: identity.tenantId,
        subjectId: identity.subjectId,
        agentId,
        sessionId: session.sessionId,
        requestId,
        runId,
        agentVersion: brand<string, 'AgentVersion'>('v1'),
        agentAssemblyRef: 'default-agent:v1',
        attempt: 1,
        status: 'COMPLETED',
        version: 1,
        terminalCommitState: 'COMMITTED',
        createdAt: brand<number, 'EpochMillis'>(1),
        updatedAt: brand<number, 'EpochMillis'>(2),
      },
      { idempotencyKey: brand<string, 'IdempotencyKey'>('idem-history-source-run') },
    );
    await app.gateway.messages.appendSessionMessage(messageRecord(session.sessionId, requestId, runId, 'USER', 'user question', 1));
    await app.gateway.messages.appendSessionMessage(messageRecord(session.sessionId, requestId, runId, 'ASSISTANT', 'committed final answer', 2));
    await app.gateway.timeline.appendEvent(
      timelineRecord(session.sessionId, requestId, runId, 'LLM_CONTENT_DELTA', 'stream-only transient delta', 1),
    );
    await app.gateway.timeline.appendEvent(timelineRecord(session.sessionId, requestId, runId, 'REQUEST_COMPLETED', 'timeline terminal payload', 2));

    const replay = await collect(
      deliverWebStream({
        sessions: app.runtime,
        identityContext: identity,
        sessionId: session.sessionId,
        requestId,
        runId,
        lastSeenSequence: brand<number, 'TimelineSequence'>(0),
        timelineReadTimeoutMs: 1_000,
      }),
    );
    const history = await app.server.inject({ method: 'GET', url: `/api/v1/sessions/${session.sessionId}/conversation?limit=10` });

    expect(replay.map((event) => event.eventType)).toEqual(['LLM_CONTENT_DELTA', 'REQUEST_COMPLETED']);
    expect(JSON.stringify(replay)).toContain('stream-only transient delta');
    expect(history.statusCode).toBe(200);
    expect(history.body).toContain('committed final answer');
    expect(history.body).not.toContain('stream-only transient delta');
    expect(history.body).not.toContain('timeline terminal payload');
  });

  it('bootstraps active run recovery without treating partial stream content as final history', async () => {
    const app = createNextAgentTestApp({
      workspaceDir: process.cwd(),
      modelSteps: [{ content: 'unused' }],
      identity,
    });
    const session = await app.runtime.createSession({
      identityContext: identity,
      idempotencyKey: brand<string, 'IdempotencyKey'>('idem-active-history-session'),
    });
    const requestId = brand<string, 'MessageId'>('request-active-history');
    const runId = brand<string, 'RequestRunId'>('run-active-history');
    await app.gateway.requestRuns.saveRun(
      {
        tenantId: identity.tenantId,
        subjectId: identity.subjectId,
        agentId,
        sessionId: session.sessionId,
        requestId,
        runId,
        agentVersion: brand<string, 'AgentVersion'>('v1'),
        agentAssemblyRef: 'default-agent:v1',
        attempt: 1,
        status: 'EXECUTING',
        version: 1,
        terminalCommitState: 'NOT_STARTED',
        createdAt: brand<number, 'EpochMillis'>(1),
        updatedAt: brand<number, 'EpochMillis'>(2),
      },
      { idempotencyKey: brand<string, 'IdempotencyKey'>('idem-active-history-run') },
    );
    await app.gateway.messages.appendSessionMessage(messageRecord(session.sessionId, requestId, runId, 'USER', 'active user question', 1));
    await app.gateway.timeline.appendEvent(
      timelineRecord(session.sessionId, requestId, runId, 'LLM_CONTENT_DELTA', 'partial content already streamed', 1),
    );

    const conversation = await app.server.inject({ method: 'GET', url: `/api/v1/sessions/${session.sessionId}/conversation?limit=10` });
    const replay = await collect(
      deliverWebStream({
        sessions: app.runtime,
        identityContext: identity,
        sessionId: session.sessionId,
        requestId,
        runId,
        lastSeenSequence: brand<number, 'TimelineSequence'>(0),
        timelineReadTimeoutMs: 5,
      }),
    );

    expect(conversation.statusCode).toBe(200);
    expect(conversation.json()).toMatchObject({
      items: [{ role: 'USER', content: 'active user question' }],
      activeRun: { requestId, runId, status: 'EXECUTING' },
    });
    expect(conversation.body).not.toContain('partial content already streamed');
    expect(replay.map((event) => event.eventType)).toEqual(['LLM_CONTENT_DELTA', 'DEGRADATION_NOTICE']);
    expect(replay[0]?.payload.content).toBe('partial content already streamed');
    expect(replay[1]?.payload.code).toBe('TIMELINE_READ_TIMEOUT');
  });

  it('returns failed terminal safe reason from new conversation history', async () => {
    const app = createNextAgentTestApp({
      workspaceDir: process.cwd(),
      modelSteps: [
        {
          safeError: {
            code: 'MODEL_PROVIDER_ERROR',
            message: 'Model provider returned an unavailable response.',
            category: 'UNAVAILABLE',
            retryable: true,
          },
        },
      ],
      identity,
    });

    const accepted = await app.server.inject({
      method: 'POST',
      url: '/api/v1/requests',
      payload: {
        inputText: 'create failed conversation history',
        idempotencyKey: 'idem-history-failed-terminal-reason',
      },
    });
    expect(accepted.statusCode).toBe(200);
    const body = accepted.json<{ readonly sessionId: string; readonly requestId: string; readonly runId: string }>();
    await waitForTerminal(app, body.runId);

    const conversation = await app.server.inject({
      method: 'GET',
      url: `/api/v1/sessions/${body.sessionId}/conversation?limit=10`,
    });
    expect(conversation.statusCode).toBe(200);
    expect(conversation.json()).toMatchObject({
      items: [
        { role: 'USER', messageId: body.requestId },
        {
          role: 'ASSISTANT',
          runId: body.runId,
          metadata: {
            eventType: 'REQUEST_FAILED',
            status: 'FAILED',
            code: 'MODEL_PROVIDER_ERROR',
            category: 'UNAVAILABLE',
          },
        },
      ],
    });
  });
});

async function waitForTerminal(app: ReturnType<typeof createNextAgentTestApp>, runId: string): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const run = await app.gateway.requestRuns.loadRun({
      tenantId: identity.tenantId,
      subjectId: identity.subjectId,
      agentId,
      runId: brand<string, 'RequestRunId'>(runId),
    });
    if (run?.terminalCommitState === 'COMMITTED') {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('Timed out waiting for failed terminal history test.');
}

function messageRecord(
  sessionId: SessionId,
  requestId: MessageId,
  runId: RequestRunId,
  role: SessionMessageRecord['role'],
  content: string,
  createdAt: number,
): SessionMessageRecord {
  return {
    tenantId: identity.tenantId,
    subjectId: identity.subjectId,
    agentId,
    messageId: brand<string, 'MessageId'>(`${requestId}:${role}:${createdAt}`),
    sessionId,
    requestId,
    runId,
    role,
    content,
    contentType: 'PLAIN_TEXT',
    metadata: role === 'ASSISTANT' ? { eventType: 'REQUEST_COMPLETED', status: 'COMPLETED' } : {},
    visible: true,
    createdAt: brand<number, 'EpochMillis'>(createdAt),
  };
}

function timelineRecord(
  sessionId: SessionId,
  requestId: MessageId,
  runId: RequestRunId,
  type: RunTimelineEventRecord['type'],
  content: string,
  createdAt: number,
): RunTimelineEventRecord {
  return {
    tenantId: identity.tenantId,
    subjectId: identity.subjectId,
    agentId,
    agentVersion: brand<string, 'AgentVersion'>('v1'),
    eventId: `event:${requestId}:${type}:${createdAt}`,
    sessionId,
    requestId,
    runId,
    requestContextId: brand<string, 'RequestContextId'>(`context:${requestId}`) as RequestContextId,
    sequence: brand<number, 'TimelineSequence'>(0),
    type,
    inlinePayload: type === 'REQUEST_COMPLETED' ? { terminalMessageId: `${requestId}:ASSISTANT:${createdAt}`, hookResults: [] } : { content },
    createdAt: brand<number, 'EpochMillis'>(createdAt) as EpochMillis,
  };
}

async function collect<T>(items: AsyncIterable<T>): Promise<T[]> {
  const collected: T[] = [];
  for await (const item of items) {
    collected.push(item);
  }
  return collected;
}
