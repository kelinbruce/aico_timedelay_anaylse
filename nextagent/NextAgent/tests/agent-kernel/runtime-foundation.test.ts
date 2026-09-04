import { createNextAgentTestApp } from '@nextagent/agent-platform-gateway-local/testing';
import { createStaticCapabilityCatalog } from '@nextagent/agent-capability';
import { bindRuntimeLoggerProvider, brand, type RuntimeLoggerProviderBinding } from '@nextagent/agent-common';
import type { AgentAssembly } from '@nextagent/agent-contracts/agent-assembly';
import type { RequestRunStoreGateway } from '@nextagent/agent-contracts/gateway';
import type { AgentRunStatePort, RunTimelineEvent } from '@nextagent/agent-contracts/runtime';
import { createTestGatewayStores, createTestGatewayStoresWithSqliteFile } from '../fixtures/local-gateway.js';
import { createTestAgentConstructor } from '../fixtures/test-agent.js';
import { AgentInstanceManager, createRequestLifecycleCoordinator, createRuntimeOwnedRunMessagePort } from '@nextagent/agent-runtime';
import { createUserSessionService } from '@nextagent/agent-session';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it, vi } from 'vitest';

let loggerBinding: RuntimeLoggerProviderBinding | undefined;
afterEach(() => loggerBinding?.unbind());

const identity = {
  tenantId: brand<string, 'TenantId'>('tenant-1'),
  subjectId: brand<string, 'SubjectId'>('subject-1'),
  displayName: 'Local operator',
};
const agentId = brand<string, 'AgentId'>('default-agent');

async function waitFor(assertion: () => boolean | Promise<boolean>, timeoutMs = 1_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await assertion()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  expect(await assertion()).toBe(true);
}

async function collectWithTimeout<T>(items: AsyncIterable<T>, onTimeout: () => void, timeoutMs = 1_000): Promise<T[]> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(() => {
      onTimeout();
      reject(new Error('Timed out collecting runtime stream events.'));
    }, timeoutMs);
  });
  try {
    return await Promise.race([collect(items), timeoutPromise]);
  } finally {
    if (timeout !== undefined) {
      clearTimeout(timeout);
    }
  }
}

async function collect<T>(items: AsyncIterable<T>): Promise<T[]> {
  const collected: T[] = [];
  for await (const item of items) {
    collected.push(item);
  }
  return collected;
}

async function nextWithTimeout<T>(iterator: AsyncIterator<T>, timeoutMs = 1_000): Promise<IteratorResult<T>> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(() => {
      reject(new Error('Timed out waiting for runtime stream event.'));
    }, timeoutMs);
  });
  try {
    return await Promise.race([iterator.next(), timeoutPromise]);
  } finally {
    if (timeout !== undefined) {
      clearTimeout(timeout);
    }
  }
}

async function waitForRunTerminal(gateway: { readonly requestRuns: RequestRunStoreGateway }, runId: string): Promise<void> {
  await waitFor(async () => {
    const run = await gateway.requestRuns.loadRun({
      tenantId: identity.tenantId,
      subjectId: identity.subjectId,
      agentId,
      runId: brand<string, 'RequestRunId'>(runId),
    });
    return run?.terminalCommitState === 'COMMITTED';
  });
}

describe('minimal runtime foundation facts', () => {
  it('creates owner-scoped sessions with empty active context and prepares convenience submit sessions', async () => {
    const app = createNextAgentTestApp({
      workspaceDir: process.cwd(),
      modelSteps: [{ content: 'foundation answer' }],
      identity,
    });

    const created = await app.server.inject({ method: 'POST', url: '/api/v1/sessions', payload: { locale: 'zh-CN' } });
    expect(created.statusCode).toBe(200);
    const createdBody = created.json<{ sessionId: string }>();
    const createdContext = await app.gateway.activeContext.loadActiveContext({
      tenantId: identity.tenantId,
      subjectId: identity.subjectId,
      agentId,
      sessionId: brand<string, 'SessionId'>(createdBody.sessionId),
    });
    expect(createdContext.items).toEqual([]);
    expect(createdContext.state.activeContextVersion).toBe(0);

    const conveniencePayload = { inputText: 'create session and answer', idempotencyKey: 'idem-foundation-create' };
    const accepted = await app.server.inject({
      method: 'POST',
      url: '/api/v1/requests',
      payload: conveniencePayload,
    });
    expect(accepted.statusCode).toBe(200);
    const body = accepted.json<{ sessionId: string; requestId: string; runId: string; attempt: number }>();
    expect(body.sessionId).not.toBe(createdBody.sessionId);

    const repeated = await app.server.inject({ method: 'POST', url: '/api/v1/requests', payload: conveniencePayload });
    expect(repeated.statusCode).toBe(200);
    expect(repeated.json()).toEqual(body);
    await waitForRunTerminal(app.gateway, body.runId);

    const preparedSession = await app.gateway.sessions.loadSession({
      tenantId: identity.tenantId,
      subjectId: identity.subjectId,
      agentId,
      sessionId: brand<string, 'SessionId'>(body.sessionId),
    });
    expect(preparedSession).toBeDefined();
    const sessions = await app.gateway.sessions.listSessions({
      tenantId: identity.tenantId,
      subjectId: identity.subjectId,
      agentId,
      offset: 0,
      limit: 10,
    });
    expect(sessions.entries.map((session) => session.sessionId).sort()).toEqual([body.sessionId, createdBody.sessionId].sort());
    expect(sessions.entries.find((session) => session.sessionId === body.sessionId)).toMatchObject({
      sessionId: body.sessionId,
      latestRunStatus: 'COMPLETED',
      hasInFlightRequest: false,
    });
    expect(sessions.entries.find((session) => session.sessionId === createdBody.sessionId)).toMatchObject({
      hasInFlightRequest: false,
    });

    const publicSessions = await app.server.inject({ method: 'GET', url: '/api/v1/sessions?offset=0&limit=10' });
    expect(publicSessions.statusCode).toBe(200);
    const publicEntry = publicSessions
      .json<{ entries: Array<{ sessionId: string; lastRunStatus?: string; hasInFlightRequest: boolean }> }>()
      .entries.find((session) => session.sessionId === body.sessionId);
    expect(publicEntry).toMatchObject({
      sessionId: body.sessionId,
      lastRunStatus: 'COMPLETED',
      hasInFlightRequest: false,
    });
  });

  it('projects current active run from the conversation bootstrap response', async () => {
    const app = createNextAgentTestApp({
      workspaceDir: process.cwd(),
      modelSteps: [{ content: 'unused' }],
      identity,
    });
    const sessionId = brand<string, 'SessionId'>('session-summary-queued');
    const now = brand<number, 'EpochMillis'>(10);
    await app.gateway.sessions.saveSession({
      tenantId: identity.tenantId,
      subjectId: identity.subjectId,
      agentId,
      sessionId,
      createdAt: now,
      updatedAt: now,
    });
    await app.gateway.requestRuns.saveRun(
      {
        tenantId: identity.tenantId,
        subjectId: identity.subjectId,
        agentId,
        sessionId,
        requestId: brand<string, 'MessageId'>('request-summary-queued'),
        runId: brand<string, 'RequestRunId'>('run-summary-queued'),
        agentVersion: brand<string, 'AgentVersion'>('v1'),
        agentAssemblyRef: 'assembly-default',
        attempt: 1,
        status: 'QUEUED',
        version: 1,
        terminalCommitState: 'NOT_STARTED',
        createdAt: now,
        updatedAt: now,
      },
      { idempotencyKey: brand<string, 'IdempotencyKey'>('idem-summary-queued') },
    );

    const sessions = await app.server.inject({ method: 'GET', url: '/api/v1/sessions?offset=0&limit=10' });
    expect(sessions.statusCode).toBe(200);
    const entry = sessions
      .json<{ entries: Array<{ sessionId: string; lastRunStatus?: string; hasInFlightRequest: boolean }> }>()
      .entries.find((session) => session.sessionId === sessionId);
    expect(entry).toMatchObject({
      sessionId,
      lastRunStatus: 'QUEUED',
      hasInFlightRequest: true,
    });

    const conversation = await app.server.inject({ method: 'GET', url: `/api/v1/sessions/${sessionId}/conversation` });
    expect(conversation.statusCode).toBe(200);
    expect(conversation.json()).toMatchObject({
      items: [],
      activeRun: {
        requestId: 'request-summary-queued',
        runId: 'run-summary-queued',
        status: 'QUEUED',
      },
    });
    expect(Object.keys(conversation.json().activeRun)).toEqual(['requestId', 'runId', 'status']);
  });

  it('deduplicates runtime session create by server-side scoped idempotency key', async () => {
    const app = createNextAgentTestApp({
      workspaceDir: process.cwd(),
      modelSteps: [{ content: 'unused' }],
      identity,
    });
    const command = {
      identityContext: identity,
      locale: brand<string, 'RequestLocale'>('zh-CN'),
      idempotencyKey: brand<string, 'IdempotencyKey'>('idem-session-create-repeat'),
    };

    const first = await app.runtime.createSession(command);
    const second = await app.runtime.createSession(command);

    expect(second).toEqual(first);
    const sessions = await app.gateway.sessions.listSessions({
      tenantId: identity.tenantId,
      subjectId: identity.subjectId,
      agentId,
      offset: 0,
      limit: 10,
    });
    expect(sessions.entries.map((session) => session.sessionId)).toEqual([first.sessionId]);
  });

  it('uses existing owner-scoped sessions and rejects missing or cross-owner session access safely', async () => {
    const app = createNextAgentTestApp({
      workspaceDir: process.cwd(),
      modelSteps: [{ content: 'existing session answer' }],
      identity,
    });
    const created = await app.server.inject({ method: 'POST', url: '/api/v1/sessions', payload: {} });
    const sessionId = created.json<{ sessionId: string }>().sessionId;

    const accepted = await app.server.inject({
      method: 'POST',
      url: '/api/v1/requests',
      payload: { sessionId, inputText: 'reuse session', idempotencyKey: 'idem-foundation-existing' },
    });
    expect(accepted.statusCode).toBe(200);
    const acceptedBody = accepted.json<{ sessionId: string; runId: string }>();
    expect(acceptedBody.sessionId).toBe(sessionId);
    await waitForRunTerminal(app.gateway, acceptedBody.runId);

    const missing = await app.server.inject({
      method: 'POST',
      url: '/api/v1/requests',
      payload: { sessionId: 'session-missing', inputText: 'reuse missing', idempotencyKey: 'idem-foundation-missing' },
    });
    expect(missing.statusCode).toBe(404);
    expect(missing.json<{ error: { code: string; message: string } }>().error).toEqual({
      code: 'SESSION_NOT_FOUND',
      message: 'Session was not found.',
    });

    await expect(
      app.sessions.requireSession({
        identityContext: {
          tenantId: brand<string, 'TenantId'>('tenant-other'),
          subjectId: brand<string, 'SubjectId'>('subject-other'),
          displayName: 'Other operator',
        },
        agentId,
        sessionId: brand<string, 'SessionId'>(sessionId),
      }),
    ).rejects.toMatchObject({ code: 'SESSION_NOT_FOUND' });
  });

  it('persists accepted run, root message, active context and session-scoped timeline facts', async () => {
    const app = createNextAgentTestApp({
      workspaceDir: process.cwd(),
      modelSteps: [{ content: '小区 LTE KPI 当前无新增告警。' }],
      identity,
    });
    const accepted = await app.server.inject({
      method: 'POST',
      url: '/api/v1/requests',
      payload: { inputText: '诊断 LTE KPI 告警', idempotencyKey: 'idem-foundation-facts' },
    });
    const body = accepted.json<{ sessionId: string; requestId: string; runId: string; attempt: number }>();
    expect(Object.keys(body).sort()).toEqual(['attempt', 'requestId', 'runId', 'sessionId']);
    await waitForRunTerminal(app.gateway, body.runId);

    const run = await app.gateway.requestRuns.loadRun({
      tenantId: identity.tenantId,
      subjectId: identity.subjectId,
      agentId,
      runId: brand<string, 'RequestRunId'>(body.runId),
    });
    expect(run).toMatchObject({
      sessionId: body.sessionId,
      requestId: body.requestId,
      agentId: 'default-agent',
      agentVersion: 'v1',
      agentAssemblyRef: 'default-agent:v1',
      attempt: 1,
      status: 'COMPLETED',
      terminalCommitState: 'COMMITTED',
    });

    const userMessage = await app.gateway.messages.loadMessage({
      tenantId: identity.tenantId,
      subjectId: identity.subjectId,
      agentId,
      messageId: brand<string, 'MessageId'>(body.requestId),
    });
    expect(userMessage).toMatchObject({
      sessionId: body.sessionId,
      requestId: body.requestId,
      runId: body.runId,
      role: 'USER',
      visible: true,
    });

    const active = await app.gateway.activeContext.loadActiveContext({
      tenantId: identity.tenantId,
      subjectId: identity.subjectId,
      agentId,
      sessionId: brand<string, 'SessionId'>(body.sessionId),
    });
    expect(active.items.map((item) => item.messageId)).toContain(body.requestId);

    const timeline = await app.gateway.timeline.listEvents({
      tenantId: identity.tenantId,
      subjectId: identity.subjectId,
      agentId,
      sessionId: brand<string, 'SessionId'>(body.sessionId),
      afterSequence: brand<number, 'TimelineSequence'>(0),
      limit: 1000,
    });
    expect(timeline.map((event) => Number(event.sequence))).toEqual(timeline.map((_event, index) => index + 1));
    expect(timeline.map((event) => event.type)).toEqual(expect.arrayContaining(['REQUEST_ACCEPTED', 'REQUEST_COMPLETED']));
    expect(timeline.map((event) => event.type)).not.toContain('LLM_CONTENT_DELTA');
    expect(timeline.filter((event) => event.type.startsWith('MODEL_INVOCATION_')).map((event) => event.type)).toEqual([
      'MODEL_INVOCATION_STARTED',
      'MODEL_INVOCATION_COMPLETED',
    ]);
    expect(timeline.every((event) => event.sessionId === body.sessionId && event.requestId === body.requestId && event.runId === body.runId)).toBe(
      true,
    );

    const firstHistoryPage = await app.runtime.listEvents({
      identityContext: identity,
      sessionId: brand<string, 'SessionId'>(body.sessionId),
      runId: brand<string, 'RequestRunId'>(body.runId),
      afterSequence: brand<number, 'TimelineSequence'>(0),
      limit: 2,
    });
    expect(firstHistoryPage).toMatchObject({ availability: 'AVAILABLE', events: expect.any(Array) });
    if (firstHistoryPage.availability === 'AVAILABLE') {
      expect(firstHistoryPage.events).toHaveLength(2);
      expect(firstHistoryPage.nextAfterSequence).toBeDefined();
      expect(
        firstHistoryPage.events.every(
          (event) =>
            !Object.hasOwn(event, 'tenantId') &&
            !Object.hasOwn(event, 'subjectId') &&
            !Object.hasOwn(event, 'agentId') &&
            !Object.hasOwn(event, 'contentRef'),
        ),
      ).toBe(true);
      const secondHistoryPage = await app.runtime.listEvents({
        identityContext: identity,
        sessionId: brand<string, 'SessionId'>(body.sessionId),
        runId: brand<string, 'RequestRunId'>(body.runId),
        afterSequence: firstHistoryPage.nextAfterSequence!,
        limit: 100,
      });
      expect(secondHistoryPage.availability).toBe('AVAILABLE');
      if (secondHistoryPage.availability === 'AVAILABLE') {
        expect(secondHistoryPage.events[0]?.sequence).toBeGreaterThan(firstHistoryPage.events.at(-1)!.sequence!);
      }
    }
    await expect(
      app.runtime.listEvents({
        identityContext: identity,
        sessionId: brand<string, 'SessionId'>(body.sessionId),
        runId: brand<string, 'RequestRunId'>('arbitrary-run'),
        afterSequence: brand<number, 'TimelineSequence'>(0),
        limit: 100,
      }),
    ).rejects.toMatchObject({ code: 'SESSION_EVENT_HISTORY_NOT_FOUND' });
    await expect(
      app.runtime.listEvents({
        identityContext: identity,
        sessionId: brand<string, 'SessionId'>(body.sessionId),
        runId: brand<string, 'RequestRunId'>(body.runId),
        afterSequence: brand<number, 'TimelineSequence'>(-1),
        limit: 100,
      }),
    ).rejects.toMatchObject({ code: 'SESSION_EVENT_HISTORY_PAGINATION_INVALID' });

    const listEvents = app.gateway.timeline.listEvents.bind(app.gateway.timeline);
    app.gateway.timeline.listEvents = async (query) => {
      const records = await listEvents(query);
      return records.map((record) => ({
        ...record,
        sessionId: brand<string, 'SessionId'>('corrupted-session'),
      }));
    };
    await expect(
      app.runtime.listEvents({
        identityContext: identity,
        sessionId: brand<string, 'SessionId'>(body.sessionId),
        runId: brand<string, 'RequestRunId'>(body.runId),
        afterSequence: brand<number, 'TimelineSequence'>(0),
        limit: 100,
      }),
    ).rejects.toMatchObject({ code: 'SESSION_EVENT_HISTORY_RECORD_INVALID' });
  });

  it('returns the existing acceptance and does not append duplicate root messages for repeated submit idempotency', async () => {
    const app = createNextAgentTestApp({
      workspaceDir: process.cwd(),
      modelSteps: [{ content: 'first idempotent answer' }, { content: 'unexpected duplicate answer' }],
      identity,
    });
    const created = await app.server.inject({ method: 'POST', url: '/api/v1/sessions', payload: {} });
    const sessionId = created.json<{ sessionId: string }>().sessionId;
    const payload = { sessionId, inputText: 'same user request', idempotencyKey: 'idem-foundation-submit-repeat' };

    const first = await app.server.inject({ method: 'POST', url: '/api/v1/requests', payload });
    const second = await app.server.inject({ method: 'POST', url: '/api/v1/requests', payload });

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(second.json()).toEqual(first.json());
    const accepted = first.json<{ requestId: string; runId: string }>();
    await waitForRunTerminal(app.gateway, accepted.runId);
    const messages = await app.gateway.messages.listMessages({
      tenantId: identity.tenantId,
      subjectId: identity.subjectId,
      agentId,
      sessionId: brand<string, 'SessionId'>(sessionId),
      includeHidden: true,
      includeCapabilityResults: true,
      limit: 10,
    });
    expect(messages.items.filter((message) => message.role === 'USER').map((message) => message.messageId)).toEqual([accepted.requestId]);
    expect(messages.items.filter((message) => message.role === 'ASSISTANT').map((message) => message.runId)).toEqual([accepted.runId]);
  });

  it('persists runtime-owned append metadata and deduplicates idempotent execution messages', async () => {
    const { gateway, sqliteFile } = createTestGatewayStoresWithSqliteFile();
    const sessionId = brand<string, 'SessionId'>('session-message-append');
    const requestId = brand<string, 'MessageId'>('request-message-append');
    const runId = brand<string, 'RequestRunId'>('run-message-append');
    await gateway.sessions.saveSession({
      tenantId: identity.tenantId,
      subjectId: identity.subjectId,
      agentId,
      sessionId,
      createdAt: brand<number, 'EpochMillis'>(1),
      updatedAt: brand<number, 'EpochMillis'>(1),
    });
    let id = 0;
    const messages = createRuntimeOwnedRunMessagePort({
      messageStore: gateway.messages,
      clock: () => brand<number, 'EpochMillis'>(10),
      idFactory: (prefix) => `${prefix}-${++id}`,
    });
    const run = {
      runId,
      sessionId,
      requestId,
      agentId,
      agentVersion: brand<string, 'AgentVersion'>('v1'),
      agentAssemblyRef: 'default-agent:v1',
      attempt: 1,
      status: 'EXECUTING' as const,
      version: 2,
      terminalCommitState: 'NOT_STARTED' as const,
      createdAt: brand<number, 'EpochMillis'>(1),
      updatedAt: brand<number, 'EpochMillis'>(2),
    };
    const context = {
      requestContextId: brand<string, 'RequestContextId'>('context-message-append'),
      sessionId,
      requestId,
      runId,
      agentTurnIndex: 0,
      identityContext: identity,
      locale: brand<string, 'RequestLocale'>('zh-CN'),
      agentId,
      agentVersion: run.agentVersion,
      agentAssemblyRef: run.agentAssemblyRef,
      nextLifecycleStage: 'BEFORE_MODEL_INVOKE' as const,
      toolCallStates: [],
      flowVariables: {},
    };
    const idempotencyKey = brand<string, 'IdempotencyKey'>('idem-message-append');

    const first = await messages.appendMessage(run, context, {
      role: 'ASSISTANT',
      content: 'assistant tool use',
      contentType: 'PLAIN_TEXT',
      visible: true,
      metadata: { kind: 'ASSISTANT_TOOL_USE', toolCallIds: ['tool-1'] },
      idempotencyKey,
    });
    const second = await messages.appendMessage(run, context, {
      role: 'ASSISTANT',
      content: 'duplicate attempt',
      contentType: 'PLAIN_TEXT',
      visible: true,
      metadata: { kind: 'SHOULD_NOT_REPLACE' },
      idempotencyKey,
    });

    expect(second).toBe(first);
    const current = await gateway.messages.listCurrentRequestMessages({
      tenantId: identity.tenantId,
      subjectId: identity.subjectId,
      agentId,
      sessionId,
      requestId,
      runId,
      includeHidden: true,
      offset: 0,
      limit: 10,
    });
    expect(current.items).toHaveLength(1);
    expect(current.items[0]).toMatchObject({
      messageId: first,
      content: 'assistant tool use',
      metadata: { kind: 'ASSISTANT_TOOL_USE', toolCallIds: ['tool-1'] },
    });
    const active = await gateway.activeContext.loadActiveContext({ tenantId: identity.tenantId, subjectId: identity.subjectId, agentId, sessionId });
    expect(active.items.map((item) => item.messageId)).toEqual([first]);
  });

  it('repairs a missing active context item when an idempotent message append already has its anchor message', async () => {
    const { gateway, sqliteFile } = createTestGatewayStoresWithSqliteFile();
    const sessionId = brand<string, 'SessionId'>('session-message-repair');
    const requestId = brand<string, 'MessageId'>('request-message-repair');
    const runId = brand<string, 'RequestRunId'>('run-message-repair');
    const messageId = brand<string, 'MessageId'>('assistant-tool-existing');
    const idempotencyKey = brand<string, 'IdempotencyKey'>('idem-message-repair');
    await gateway.sessions.saveSession({
      tenantId: identity.tenantId,
      subjectId: identity.subjectId,
      agentId,
      sessionId,
      createdAt: brand<number, 'EpochMillis'>(1),
      updatedAt: brand<number, 'EpochMillis'>(1),
    });
    await gateway.messages.appendSessionMessage(
      {
        tenantId: identity.tenantId,
        subjectId: identity.subjectId,
        agentId,
        messageId,
        sessionId,
        requestId,
        runId,
        role: 'ASSISTANT',
        content: 'existing assistant tool use',
        contentType: 'PLAIN_TEXT',
        metadata: { kind: 'ASSISTANT_TOOL_USE', toolCallIds: ['tool-existing'] },
        visible: true,
        createdAt: brand<number, 'EpochMillis'>(10),
      },
      { idempotencyKey },
    );
    const db = new DatabaseSync(sqliteFile);
    try {
      db.prepare(
        `DELETE FROM active_context_items
         WHERE tenant_id = ? AND subject_id = ? AND agent_id = ? AND session_id = ? AND message_id = ?`,
      ).run(identity.tenantId, identity.subjectId, agentId, sessionId, messageId);
    } finally {
      db.close();
    }
    const messages = createRuntimeOwnedRunMessagePort({
      messageStore: gateway.messages,
      clock: () => brand<number, 'EpochMillis'>(11),
      idFactory: (prefix) => `${prefix}-new`,
    });
    const run = {
      runId,
      sessionId,
      requestId,
      agentId,
      agentVersion: brand<string, 'AgentVersion'>('v1'),
      agentAssemblyRef: 'default-agent:v1',
      attempt: 1,
      status: 'EXECUTING' as const,
      version: 2,
      terminalCommitState: 'NOT_STARTED' as const,
      createdAt: brand<number, 'EpochMillis'>(1),
      updatedAt: brand<number, 'EpochMillis'>(2),
    };
    const context = {
      requestContextId: brand<string, 'RequestContextId'>('context-message-repair'),
      sessionId,
      requestId,
      runId,
      agentTurnIndex: 0,
      identityContext: identity,
      locale: brand<string, 'RequestLocale'>('zh-CN'),
      agentId,
      agentVersion: run.agentVersion,
      agentAssemblyRef: run.agentAssemblyRef,
      nextLifecycleStage: 'BEFORE_MODEL_INVOKE' as const,
      toolCallStates: [],
      flowVariables: {},
    };

    await expect(
      messages.appendMessage(run, context, {
        role: 'ASSISTANT',
        content: 'retry assistant tool use',
        contentType: 'PLAIN_TEXT',
        visible: true,
        metadata: { kind: 'ASSISTANT_TOOL_USE', toolCallIds: ['tool-existing'] },
        idempotencyKey,
      }),
    ).resolves.toBe(messageId);
    const active = await gateway.activeContext.loadActiveContext({ tenantId: identity.tenantId, subjectId: identity.subjectId, agentId, sessionId });
    expect(active.items.map((item) => item.messageId)).toEqual([messageId]);
  });

  it('anchors timeline, checkpoint and terminal idempotency on dedicated facts', async () => {
    const gateway = createTestGatewayStores();
    const sessionId = brand<string, 'SessionId'>('session-anchor-idempotency');
    const requestId = brand<string, 'MessageId'>('request-anchor-idempotency');
    const runId = brand<string, 'RequestRunId'>('run-anchor-idempotency');
    const requestContextId = brand<string, 'RequestContextId'>('context-anchor-idempotency');
    const firstSession = await gateway.sessions.saveSession(
      {
        tenantId: identity.tenantId,
        subjectId: identity.subjectId,
        agentId,
        sessionId,
        createdAt: brand<number, 'EpochMillis'>(1),
        updatedAt: brand<number, 'EpochMillis'>(1),
      },
      { idempotencyKey: brand<string, 'IdempotencyKey'>('idem-anchor-session') },
    );
    const secondSession = await gateway.sessions.saveSession(
      { ...firstSession, sessionId: brand<string, 'SessionId'>('session-anchor-idempotency-duplicate'), updatedAt: brand<number, 'EpochMillis'>(2) },
      { idempotencyKey: brand<string, 'IdempotencyKey'>('idem-anchor-session') },
    );
    expect(secondSession.sessionId).toBe(firstSession.sessionId);
    await gateway.requestRuns.saveRun(
      {
        tenantId: identity.tenantId,
        subjectId: identity.subjectId,
        runId,
        sessionId,
        requestId,
        agentId,
        agentVersion: brand<string, 'AgentVersion'>('v1'),
        agentAssemblyRef: 'default-agent:v1',
        attempt: 1,
        status: 'EXECUTING',
        version: 3,
        terminalCommitState: 'PENDING',
        createdAt: brand<number, 'EpochMillis'>(1),
        updatedAt: brand<number, 'EpochMillis'>(3),
      },
      { idempotencyKey: brand<string, 'IdempotencyKey'>('idem-anchor-run') },
    );

    const firstEvent = await gateway.timeline.appendEvent(
      {
        tenantId: identity.tenantId,
        subjectId: identity.subjectId,
        agentId,
        agentVersion: brand<string, 'AgentVersion'>('v1'),
        eventId: 'event-first',
        sessionId,
        runId,
        requestId,
        requestContextId,
        sequence: brand<number, 'TimelineSequence'>(0),
        type: 'LLM_CONTENT_DELTA',
        inlinePayload: { content: 'first' },
        createdAt: brand<number, 'EpochMillis'>(4),
      },
      { idempotencyKey: brand<string, 'IdempotencyKey'>('idem-anchor-event') },
    );
    const secondEvent = await gateway.timeline.appendEvent(
      {
        tenantId: identity.tenantId,
        subjectId: identity.subjectId,
        agentId,
        agentVersion: brand<string, 'AgentVersion'>('v1'),
        eventId: 'event-second',
        sessionId,
        runId,
        requestId,
        requestContextId,
        sequence: brand<number, 'TimelineSequence'>(0),
        type: 'LLM_CONTENT_DELTA',
        inlinePayload: { content: 'second' },
        createdAt: brand<number, 'EpochMillis'>(5),
      },
      { idempotencyKey: brand<string, 'IdempotencyKey'>('idem-anchor-event') },
    );
    expect(secondEvent).toEqual(firstEvent);
    const events = await gateway.timeline.listEvents({
      tenantId: identity.tenantId,
      subjectId: identity.subjectId,
      agentId,
      sessionId,
      afterSequence: brand<number, 'TimelineSequence'>(0),
      limit: 1000,
    });
    expect(events).toHaveLength(1);

    const firstCheckpoint = await gateway.checkpoints.saveCheckpoint(
      {
        tenantId: identity.tenantId,
        subjectId: identity.subjectId,
        agentId,
        checkpointId: brand<string, 'CheckpointId'>('checkpoint-first'),
        sessionId,
        requestId,
        runId,
        requestContextId,
        runVersion: 3,
        agentTurnIndex: 0,
        triggerReason: 'RUN_ACCEPTED',
        lastSequence: brand<number, 'TimelineSequence'>(1),
        activeContextVersion: 0,
        flowVariables: {},
        savedAt: brand<number, 'EpochMillis'>(6),
      },
      { idempotencyKey: brand<string, 'IdempotencyKey'>('idem-anchor-checkpoint') },
    );
    const secondCheckpoint = await gateway.checkpoints.saveCheckpoint(
      { ...firstCheckpoint, checkpointId: brand<string, 'CheckpointId'>('checkpoint-second'), savedAt: brand<number, 'EpochMillis'>(7) },
      { idempotencyKey: brand<string, 'IdempotencyKey'>('idem-anchor-checkpoint') },
    );
    expect(secondCheckpoint.checkpointId).toBe(firstCheckpoint.checkpointId);

    const terminalMessage = {
      tenantId: identity.tenantId,
      subjectId: identity.subjectId,
      agentId,
      messageId: brand<string, 'MessageId'>('message-anchor-terminal'),
      sessionId,
      requestId,
      runId,
      role: 'ASSISTANT' as const,
      content: 'terminal answer',
      contentType: 'PLAIN_TEXT' as const,
      metadata: {},
      visible: true,
      createdAt: brand<number, 'EpochMillis'>(8),
    };
    const terminalEvent = {
      tenantId: identity.tenantId,
      subjectId: identity.subjectId,
      agentId,
      agentVersion: brand<string, 'AgentVersion'>('v1'),
      eventId: 'event-anchor-terminal',
      sessionId,
      runId,
      requestId,
      requestContextId,
      sequence: brand<number, 'TimelineSequence'>(0),
      type: 'REQUEST_COMPLETED' as const,
      inlinePayload: { content: 'terminal answer', terminalMessageId: terminalMessage.messageId },
      createdAt: brand<number, 'EpochMillis'>(8),
    };
    await expect(
      gateway.requestRuns.commitTerminal({
        tenantId: identity.tenantId,
        subjectId: identity.subjectId,
        agentId,
        runId,
        expectedVersion: 3,
        terminalStatus: 'COMPLETED',
        terminalMessage,
        terminalEvent,
        idempotencyKey: brand<string, 'IdempotencyKey'>('idem-anchor-terminal'),
      }),
    ).resolves.toMatchObject({ status: 'COMMITTED', terminalEvent: { eventId: 'event-anchor-terminal' } });
    await expect(
      gateway.requestRuns.commitTerminal({
        tenantId: identity.tenantId,
        subjectId: identity.subjectId,
        agentId,
        runId,
        expectedVersion: 3,
        terminalStatus: 'COMPLETED',
        terminalMessage: {
          ...terminalMessage,
          messageId: brand<string, 'MessageId'>('message-anchor-terminal-duplicate'),
          content: 'duplicate terminal answer',
        },
        terminalEvent: { ...terminalEvent, eventId: 'event-anchor-terminal-duplicate', inlinePayload: { content: 'duplicate terminal answer' } },
        idempotencyKey: brand<string, 'IdempotencyKey'>('idem-anchor-terminal'),
      }),
    ).resolves.toEqual({ status: 'ALREADY_COMMITTED' });
    const terminalMessages = await gateway.messages.listCurrentRequestMessages({
      tenantId: identity.tenantId,
      subjectId: identity.subjectId,
      agentId,
      sessionId,
      requestId,
      runId,
      includeHidden: true,
      offset: 0,
      limit: 10,
    });
    expect(terminalMessages.items.map((message) => message.messageId)).toEqual([terminalMessage.messageId]);
    const activeAfterTerminal = await gateway.activeContext.loadActiveContext({
      tenantId: identity.tenantId,
      subjectId: identity.subjectId,
      agentId,
      sessionId,
    });
    expect(activeAfterTerminal.items.map((item) => item.messageId)).toEqual([terminalMessage.messageId]);
    const eventsAfterTerminal = await gateway.timeline.listEvents({
      tenantId: identity.tenantId,
      subjectId: identity.subjectId,
      agentId,
      sessionId,
      afterSequence: brand<number, 'TimelineSequence'>(0),
      limit: 1000,
    });
    expect(eventsAfterTerminal.map((event) => event.eventId)).toEqual(['event-first', 'event-anchor-terminal']);
  });

  it('replays runtime timeline backlog beyond one batch through the session stream facade', async () => {
    const app = createNextAgentTestApp({
      workspaceDir: process.cwd(),
      modelSteps: [{ content: 'unused' }],
      identity,
    });
    const session = await app.runtime.createSession({
      identityContext: identity,
      idempotencyKey: brand<string, 'IdempotencyKey'>('idem-replay-backlog-session'),
    });
    const requestId = brand<string, 'MessageId'>('request-replay-backlog');
    const runId = brand<string, 'RequestRunId'>('run-replay-backlog');
    const requestContextId = brand<string, 'RequestContextId'>('context-replay-backlog');
    await app.gateway.requestRuns.saveRun(
      {
        tenantId: identity.tenantId,
        subjectId: identity.subjectId,
        agentId,
        sessionId: session.sessionId,
        requestId,
        runId,
        agentVersion: brand<string, 'AgentVersion'>('v1'),
        agentAssemblyRef: 'assembly-default',
        attempt: 1,
        status: 'EXECUTING',
        version: 1,
        terminalCommitState: 'PENDING',
        createdAt: brand<number, 'EpochMillis'>(1),
        updatedAt: brand<number, 'EpochMillis'>(1),
      },
      { idempotencyKey: brand<string, 'IdempotencyKey'>('idem-replay-backlog-run') },
    );
    for (let index = 1; index <= 1005; index += 1) {
      await app.gateway.timeline.appendEvent(
        {
          tenantId: identity.tenantId,
          subjectId: identity.subjectId,
          agentId,
          agentVersion: brand<string, 'AgentVersion'>('v1'),
          eventId: `event-replay-backlog-${index}`,
          sessionId: session.sessionId,
          requestId,
          runId,
          requestContextId,
          sequence: brand<number, 'TimelineSequence'>(0),
          type: index === 1005 ? 'REQUEST_COMPLETED' : 'LLM_CONTENT_DELTA',
          inlinePayload: { content: `chunk-${index}` },
          createdAt: brand<number, 'EpochMillis'>(index),
        },
        { idempotencyKey: brand<string, 'IdempotencyKey'>(`idem-replay-backlog-event-${index}`) },
      );
    }

    const abortController = new AbortController();
    const replayed = await collectWithTimeout(
      app.runtime.streamEvents({
        identityContext: identity,
        sessionId: session.sessionId,
        lastSeenSequence: brand<number, 'TimelineSequence'>(0),
        runId,
        signal: abortController.signal,
      }),
      () => abortController.abort(),
    );

    expect(replayed).toHaveLength(1005);
    expect(replayed.at(0)?.sequence).toBe(brand<number, 'TimelineSequence'>(1));
    expect(replayed.at(-1)).toMatchObject({ sequence: brand<number, 'TimelineSequence'>(1005), type: 'REQUEST_COMPLETED' });
  }, 90_000);

  it('rejects stream resume anchors that are not visible in the session timeline', async () => {
    const app = createNextAgentTestApp({
      workspaceDir: process.cwd(),
      modelSteps: [{ content: 'unused' }],
      identity,
    });
    const session = await app.runtime.createSession({
      identityContext: identity,
      idempotencyKey: brand<string, 'IdempotencyKey'>('idem-invalid-anchor-session'),
    });

    await app.gateway.timeline.appendEvent(
      {
        tenantId: identity.tenantId,
        subjectId: identity.subjectId,
        agentId,
        agentVersion: brand<string, 'AgentVersion'>('v1'),
        eventId: 'event-invalid-anchor-visible',
        sessionId: session.sessionId,
        requestId: brand<string, 'MessageId'>('request-invalid-anchor'),
        runId: brand<string, 'RequestRunId'>('run-invalid-anchor'),
        requestContextId: brand<string, 'RequestContextId'>('context-invalid-anchor'),
        sequence: brand<number, 'TimelineSequence'>(0),
        type: 'LLM_CONTENT_DELTA',
        inlinePayload: { content: 'visible chunk' },
        createdAt: brand<number, 'EpochMillis'>(1),
      },
      { idempotencyKey: brand<string, 'IdempotencyKey'>('idem-invalid-anchor-event') },
    );

    const abortController = new AbortController();
    await expect(
      collectWithTimeout(
        app.runtime.streamEvents({
          identityContext: identity,
          sessionId: session.sessionId,
          lastSeenSequence: brand<number, 'TimelineSequence'>(99),
          signal: abortController.signal,
        }),
        () => abortController.abort(),
        100,
      ),
    ).rejects.toMatchObject({ code: 'STREAM_REPLAY_ANCHOR_INVALID' });
  });

  it('opens omitted-cursor session streams as live-tail without replaying committed history', async () => {
    const app = createNextAgentTestApp({
      workspaceDir: process.cwd(),
      modelSteps: [{ content: 'live tail answer' }],
      identity,
    });
    const session = await app.runtime.createSession({
      identityContext: identity,
      idempotencyKey: brand<string, 'IdempotencyKey'>('idem-live-tail-session'),
    });
    await app.gateway.timeline.appendEvent(
      {
        tenantId: identity.tenantId,
        subjectId: identity.subjectId,
        agentId,
        agentVersion: brand<string, 'AgentVersion'>('v1'),
        eventId: 'event-live-tail-history',
        sessionId: session.sessionId,
        requestId: brand<string, 'MessageId'>('request-live-tail-history'),
        runId: brand<string, 'RequestRunId'>('run-live-tail-history'),
        requestContextId: brand<string, 'RequestContextId'>('context-live-tail-history'),
        sequence: brand<number, 'TimelineSequence'>(0),
        type: 'LLM_CONTENT_DELTA',
        inlinePayload: { content: 'old history' },
        createdAt: brand<number, 'EpochMillis'>(1),
      },
      { idempotencyKey: brand<string, 'IdempotencyKey'>('idem-live-tail-history-event') },
    );
    const listEvents = app.gateway.timeline.listEvents.bind(app.gateway.timeline);
    let listEventCalls = 0;
    app.gateway.timeline.listEvents = async (request) => {
      listEventCalls += 1;
      return listEvents(request);
    };

    const abortController = new AbortController();
    const iterator = app.runtime
      .streamEvents({
        identityContext: identity,
        sessionId: session.sessionId,
        signal: abortController.signal,
      })
      [Symbol.asyncIterator]();
    const replayed = await Promise.race([
      iterator.next().then(() => 'replayed'),
      new Promise<'idle'>((resolve) => setTimeout(() => resolve('idle'), 50)),
    ]);
    expect(replayed).toBe('idle');
    expect(listEventCalls).toBe(0);
    app.gateway.timeline.listEvents = listEvents;

    await app.runtime.submit({
      identityContext: identity,
      sessionId: session.sessionId,
      inputText: 'start live tail run',
      attachmentIds: [],
      locale: brand<string, 'RequestLocale'>('zh-CN'),
      idempotencyKey: brand<string, 'IdempotencyKey'>('idem-live-tail-submit'),
    });
    const next = await nextWithTimeout(iterator);
    abortController.abort();
    await iterator.return?.();

    expect(next.done).toBe(false);
    expect(next.value?.eventId).not.toBe('event-live-tail-history');
    expect(next.value?.sequence).toBeGreaterThan(brand<number, 'TimelineSequence'>(1));
  });

  it('rejects omitted replay anchors when request or run filters are supplied', async () => {
    const app = createNextAgentTestApp({
      workspaceDir: process.cwd(),
      modelSteps: [{ content: 'unused' }],
      identity,
    });
    const session = await app.runtime.createSession({
      identityContext: identity,
      idempotencyKey: brand<string, 'IdempotencyKey'>('idem-filter-anchor-required-session'),
    });
    const abortController = new AbortController();

    await expect(
      collectWithTimeout(
        app.runtime.streamEvents({
          identityContext: identity,
          sessionId: session.sessionId,
          runId: brand<string, 'RequestRunId'>('run-filter-anchor-required'),
          signal: abortController.signal,
        }),
        () => abortController.abort(),
        100,
      ),
    ).rejects.toMatchObject({ code: 'STREAM_REPLAY_ANCHOR_REQUIRED' });
  });

  it('rejects request and run stream filters that are not visible for the session', async () => {
    const app = createNextAgentTestApp({
      workspaceDir: process.cwd(),
      modelSteps: [{ content: 'unused' }],
      identity,
    });
    const currentSession = await app.runtime.createSession({
      identityContext: identity,
      idempotencyKey: brand<string, 'IdempotencyKey'>('idem-filter-current-session'),
    });
    const otherSession = await app.runtime.createSession({
      identityContext: identity,
      idempotencyKey: brand<string, 'IdempotencyKey'>('idem-filter-other-session'),
    });
    const otherRequestId = brand<string, 'MessageId'>('request-filter-other-session');
    const otherRunId = brand<string, 'RequestRunId'>('run-filter-other-session');
    const now = brand<number, 'EpochMillis'>(1);
    await app.gateway.requestRuns.saveRun(
      {
        tenantId: identity.tenantId,
        subjectId: identity.subjectId,
        agentId,
        sessionId: otherSession.sessionId,
        requestId: otherRequestId,
        runId: otherRunId,
        agentVersion: brand<string, 'AgentVersion'>('v1'),
        agentAssemblyRef: 'assembly-default',
        attempt: 1,
        status: 'EXECUTING',
        version: 1,
        terminalCommitState: 'PENDING',
        createdAt: now,
        updatedAt: now,
      },
      { idempotencyKey: brand<string, 'IdempotencyKey'>('idem-filter-other-run') },
    );

    let abortController = new AbortController();
    await expect(
      collectWithTimeout(
        app.runtime.streamEvents({
          identityContext: identity,
          sessionId: currentSession.sessionId,
          lastSeenSequence: brand<number, 'TimelineSequence'>(0),
          runId: otherRunId,
          signal: abortController.signal,
        }),
        () => abortController.abort(),
        100,
      ),
    ).rejects.toMatchObject({ code: 'STREAM_FILTER_NOT_FOUND' });

    abortController = new AbortController();
    await expect(
      collectWithTimeout(
        app.runtime.streamEvents({
          identityContext: identity,
          sessionId: otherSession.sessionId,
          lastSeenSequence: brand<number, 'TimelineSequence'>(0),
          requestId: brand<string, 'MessageId'>('request-filter-mismatch'),
          runId: otherRunId,
          signal: abortController.signal,
        }),
        () => abortController.abort(),
        100,
      ),
    ).rejects.toMatchObject({ code: 'STREAM_FILTER_NOT_FOUND' });

    abortController = new AbortController();
    await expect(
      collectWithTimeout(
        app.runtime.streamEvents({
          identityContext: identity,
          sessionId: currentSession.sessionId,
          lastSeenSequence: brand<number, 'TimelineSequence'>(0),
          requestId: brand<string, 'MessageId'>('request-filter-missing'),
          signal: abortController.signal,
        }),
        () => abortController.abort(),
        100,
      ),
    ).rejects.toMatchObject({ code: 'STREAM_FILTER_NOT_FOUND' });
  });

  it('fails session-scoped replay when committed timeline sequence continuity is lost', async () => {
    const app = createNextAgentTestApp({
      workspaceDir: process.cwd(),
      modelSteps: [{ content: 'unused' }],
      identity,
    });
    const session = await app.runtime.createSession({
      identityContext: identity,
      idempotencyKey: brand<string, 'IdempotencyKey'>('idem-gap-session'),
    });
    const requestId = brand<string, 'MessageId'>('request-gap-session');
    const runId = brand<string, 'RequestRunId'>('run-gap-session');
    const requestContextId = brand<string, 'RequestContextId'>('context-gap-session');
    await app.gateway.timeline.appendEvent(
      {
        tenantId: identity.tenantId,
        subjectId: identity.subjectId,
        agentId,
        agentVersion: brand<string, 'AgentVersion'>('v1'),
        eventId: 'event-gap-session-1',
        sessionId: session.sessionId,
        requestId,
        runId,
        requestContextId,
        sequence: brand<number, 'TimelineSequence'>(0),
        type: 'LLM_CONTENT_DELTA',
        inlinePayload: { content: 'first' },
        createdAt: brand<number, 'EpochMillis'>(1),
      },
      { idempotencyKey: brand<string, 'IdempotencyKey'>('idem-gap-session-event-1') },
    );
    await app.gateway.timeline.appendEvent(
      {
        tenantId: identity.tenantId,
        subjectId: identity.subjectId,
        agentId,
        agentVersion: brand<string, 'AgentVersion'>('v1'),
        eventId: 'event-gap-session-3',
        sessionId: session.sessionId,
        requestId,
        runId,
        requestContextId,
        sequence: brand<number, 'TimelineSequence'>(0),
        type: 'LLM_CONTENT_DELTA',
        inlinePayload: { content: 'third' },
        createdAt: brand<number, 'EpochMillis'>(3),
      },
      { idempotencyKey: brand<string, 'IdempotencyKey'>('idem-gap-session-event-3') },
    );
    const originalListEvents = app.gateway.timeline.listEvents.bind(app.gateway.timeline);
    app.gateway.timeline.listEvents = (async (query) => {
      const records = await originalListEvents(query);
      if (query.sessionId === session.sessionId && query.requestId === undefined && query.runId === undefined) {
        return records.map((record) =>
          record.eventId === 'event-gap-session-3' ? { ...record, sequence: brand<number, 'TimelineSequence'>(3) } : record,
        );
      }
      return records;
    }) as typeof app.gateway.timeline.listEvents;

    const abortController = new AbortController();
    await expect(
      collectWithTimeout(
        app.runtime.streamEvents({
          identityContext: identity,
          sessionId: session.sessionId,
          lastSeenSequence: brand<number, 'TimelineSequence'>(0),
          signal: abortController.signal,
        }),
        () => abortController.abort(),
        100,
      ),
    ).rejects.toMatchObject({
      code: 'STREAM_RESUME_GAP',
      safeDetails: {
        kind: 'STREAM_RESUME_GAP',
        reason: 'SEQUENCE_GAP',
        refreshConversation: true,
        resumeAfterSequence: 3,
      },
    });
  });

  it('does not treat filtered run replay as a session timeline gap', async () => {
    const app = createNextAgentTestApp({
      workspaceDir: process.cwd(),
      modelSteps: [{ content: 'unused' }],
      identity,
    });
    const session = await app.runtime.createSession({
      identityContext: identity,
      idempotencyKey: brand<string, 'IdempotencyKey'>('idem-filtered-gap-session'),
    });
    const runA = {
      requestId: brand<string, 'MessageId'>('request-filtered-gap-a'),
      runId: brand<string, 'RequestRunId'>('run-filtered-gap-a'),
      requestContextId: brand<string, 'RequestContextId'>('context-filtered-gap-a'),
    };
    const runB = {
      requestId: brand<string, 'MessageId'>('request-filtered-gap-b'),
      runId: brand<string, 'RequestRunId'>('run-filtered-gap-b'),
      requestContextId: brand<string, 'RequestContextId'>('context-filtered-gap-b'),
    };
    await app.gateway.requestRuns.saveRun(
      {
        tenantId: identity.tenantId,
        subjectId: identity.subjectId,
        agentId,
        sessionId: session.sessionId,
        requestId: runB.requestId,
        runId: runB.runId,
        agentVersion: brand<string, 'AgentVersion'>('v1'),
        agentAssemblyRef: 'assembly-default',
        attempt: 1,
        status: 'COMPLETED',
        version: 1,
        terminalCommitState: 'COMMITTED',
        createdAt: brand<number, 'EpochMillis'>(1),
        updatedAt: brand<number, 'EpochMillis'>(2),
      },
      { idempotencyKey: brand<string, 'IdempotencyKey'>('idem-filtered-gap-run-b') },
    );
    await app.gateway.timeline.appendEvent(
      {
        tenantId: identity.tenantId,
        subjectId: identity.subjectId,
        agentId,
        agentVersion: brand<string, 'AgentVersion'>('v1'),
        eventId: 'event-filtered-gap-a',
        sessionId: session.sessionId,
        requestId: runA.requestId,
        runId: runA.runId,
        requestContextId: runA.requestContextId,
        sequence: brand<number, 'TimelineSequence'>(0),
        type: 'LLM_CONTENT_DELTA',
        inlinePayload: { content: 'other run' },
        createdAt: brand<number, 'EpochMillis'>(1),
      },
      { idempotencyKey: brand<string, 'IdempotencyKey'>('idem-filtered-gap-event-a') },
    );
    await app.gateway.timeline.appendEvent(
      {
        tenantId: identity.tenantId,
        subjectId: identity.subjectId,
        agentId,
        agentVersion: brand<string, 'AgentVersion'>('v1'),
        eventId: 'event-filtered-gap-b',
        sessionId: session.sessionId,
        requestId: runB.requestId,
        runId: runB.runId,
        requestContextId: runB.requestContextId,
        sequence: brand<number, 'TimelineSequence'>(0),
        type: 'REQUEST_COMPLETED',
        inlinePayload: { content: 'done' },
        createdAt: brand<number, 'EpochMillis'>(2),
      },
      { idempotencyKey: brand<string, 'IdempotencyKey'>('idem-filtered-gap-event-b') },
    );

    const replayed = await collectWithTimeout(
      app.runtime.streamEvents({
        identityContext: identity,
        sessionId: session.sessionId,
        lastSeenSequence: brand<number, 'TimelineSequence'>(0),
        runId: runB.runId,
      }),
      () => undefined,
      100,
    );

    expect(replayed.map((event) => event.eventId)).toEqual(['event-filtered-gap-b']);
  });

  it('binds active assembly at acceptance and dispatches with the accepted version', async () => {
    const gateway = createTestGatewayStores();
    const sessionId = brand<string, 'SessionId'>('session-assembly');
    await gateway.sessions.saveSession({
      tenantId: identity.tenantId,
      subjectId: identity.subjectId,
      agentId,
      sessionId,
      createdAt: brand<number, 'EpochMillis'>(1),
      updatedAt: brand<number, 'EpochMillis'>(1),
    });
    const assemblyV1: AgentAssembly = {
      agentId: brand<string, 'AgentId'>('default-agent'),
      agentType: brand<string, 'AgentType'>('default'),
      agentVersion: brand<string, 'AgentVersion'>('v1'),
      agentAssemblyRef: 'default-agent:v1',
      displayName: 'Agent v1',
      description: 'Version one',
      workspacePolicy: {
        schemaVersion: 'nextagent.agent-workspace-policy.v1',
        isolationMode: 'subject',
        roots: [
          { kind: 'workspace', logicalPath: 'workspace', access: 'readWrite' },
          { kind: 'systemResources', logicalPath: '.nextagent', access: 'read' },
          { kind: 'temp', logicalPath: 'temp', access: 'readWrite' },
        ],
      },
      modelIds: ['test-model'],
      capabilityBindings: [],
      userInvocable: true,
      agentInvocation: 'BOUND',
      runtimeSettings: { requestTimeoutMs: 30_000 },
    };
    const agentRunVersions: string[] = [];
    const runtime = createRequestLifecycleCoordinator({
      agentConstructors: [
        createTestAgentConstructor(async ({ runState }, run, context) => {
          agentRunVersions.push(run.agentVersion);
          await runState.emitEvent(run, context, { type: 'LLM_CONTENT_DELTA', inlinePayload: { final: true, content: 'assembly fixed' } });
        }),
      ],
      agentRuntimeDependencies: {},
      assemblyRegistry: {
        async active() {
          return assemblyV1;
        },
        async require(agentId, agentVersion) {
          return { ...assemblyV1, agentId, agentVersion, agentAssemblyRef: `${agentId}:${agentVersion}` };
        },
      },
      capabilityCatalog: createStaticCapabilityCatalog(),
      defaultRouteAgentId: brand<string, 'AgentId'>('default-agent'),
      userSessions: createUserSessionService({
        sessionStore: gateway.sessions,
        messageStore: gateway.messages,
        activeContextStore: gateway.activeContext,
      }),
      messageStore: gateway.messages,
      activeContextStore: gateway.activeContext,
      requestRunStore: gateway.requestRuns,
      timelineStore: gateway.timeline,
      checkpointStore: gateway.checkpoints,
    });

    const accepted = await runtime.submit({
      sessionId,
      identityContext: identity,
      inputText: 'assembly bind',
      attachmentIds: [],
      locale: brand<string, 'RequestLocale'>('zh-CN'),
      idempotencyKey: brand<string, 'IdempotencyKey'>('idem-assembly'),
    });
    await waitFor(() => agentRunVersions.length === 1);
    const run = await gateway.requestRuns.loadRun({
      tenantId: identity.tenantId,
      subjectId: identity.subjectId,
      agentId,
      runId: accepted.runId,
    });

    expect(run?.agentVersion).toBe('v1');
    expect(run?.agentAssemblyRef).toBe('default-agent:v1');
    expect(agentRunVersions).toEqual(['v1']);
  });

  it('uses the default runtime timeout backstop when the accepted assembly omits requestTimeoutMs', async () => {
    const gateway = createTestGatewayStores();
    const sessionId = brand<string, 'SessionId'>('session-timeout-fallback');
    await gateway.sessions.saveSession({
      tenantId: identity.tenantId,
      subjectId: identity.subjectId,
      agentId,
      sessionId,
      createdAt: brand<number, 'EpochMillis'>(1),
      updatedAt: brand<number, 'EpochMillis'>(1),
    });
    const assembly: AgentAssembly = {
      agentId,
      agentType: brand<string, 'AgentType'>('default'),
      agentVersion: brand<string, 'AgentVersion'>('v1'),
      agentAssemblyRef: 'default-agent:v1',
      displayName: 'Default',
      description: 'Telecom test agent.',
      workspacePolicy: {
        schemaVersion: 'nextagent.agent-workspace-policy.v1',
        isolationMode: 'subject',
        roots: [
          { kind: 'workspace', logicalPath: 'workspace', access: 'readWrite' },
          { kind: 'systemResources', logicalPath: '.nextagent', access: 'read' },
          { kind: 'temp', logicalPath: 'temp', access: 'readWrite' },
        ],
      },
      modelIds: ['test-model'],
      capabilityBindings: [],
      userInvocable: true,
      agentInvocation: 'BOUND',
      runtimeSettings: {},
    };
    const timeoutSpy = vi.spyOn(globalThis, 'setTimeout');
    const runtime = createRequestLifecycleCoordinator({
      agentConstructors: [
        createTestAgentConstructor(async ({ runState }, run, context) => {
          await runState.emitEvent(run, context, { type: 'LLM_CONTENT_DELTA', inlinePayload: { final: true, content: 'fallback timeout' } });
        }),
      ],
      agentRuntimeDependencies: {},
      assemblyRegistry: {
        async active() {
          return assembly;
        },
        async require() {
          return assembly;
        },
      },
      capabilityCatalog: createStaticCapabilityCatalog(),
      defaultRouteAgentId: agentId,
      userSessions: createUserSessionService({
        sessionStore: gateway.sessions,
        messageStore: gateway.messages,
        activeContextStore: gateway.activeContext,
      }),
      messageStore: gateway.messages,
      activeContextStore: gateway.activeContext,
      requestRunStore: gateway.requestRuns,
      timelineStore: gateway.timeline,
      checkpointStore: gateway.checkpoints,
    });

    try {
      const accepted = await runtime.submit({
        sessionId,
        identityContext: identity,
        inputText: 'timeout fallback',
        attachmentIds: [],
        locale: brand<string, 'RequestLocale'>('zh-CN'),
        idempotencyKey: brand<string, 'IdempotencyKey'>('idem-timeout-fallback'),
      });
      await waitForRunTerminal(gateway, accepted.runId);
      expect(timeoutSpy.mock.calls.some((call) => call[1] === 1_800_000)).toBe(true);
    } finally {
      timeoutSpy.mockRestore();
    }
  });

  it('emits runtime logs for queueing, dispatch, execution, and terminal commit', async () => {
    const gateway = createTestGatewayStores();
    const sessionId = brand<string, 'SessionId'>('session-runtime-log');
    const entries: Array<{ readonly event?: string }> = [];
    loggerBinding = bindRuntimeLoggerProvider({
      getLogger: () => ({
        info(obj) {
          entries.push(obj as { readonly event?: string });
        },
        warn(obj) {
          entries.push(obj as { readonly event?: string });
        },
        error(obj) {
          entries.push(obj as { readonly event?: string });
        },
        debug(obj) {
          entries.push(obj as { readonly event?: string });
        },
      }),
    });
    await gateway.sessions.saveSession({
      tenantId: identity.tenantId,
      subjectId: identity.subjectId,
      agentId,
      sessionId,
      createdAt: brand<number, 'EpochMillis'>(1),
      updatedAt: brand<number, 'EpochMillis'>(1),
    });
    const assembly: AgentAssembly = {
      agentId,
      agentType: brand<string, 'AgentType'>('default'),
      agentVersion: brand<string, 'AgentVersion'>('v1'),
      agentAssemblyRef: 'default-agent:v1',
      displayName: 'Default',
      description: 'Telecom test agent.',
      workspacePolicy: {
        schemaVersion: 'nextagent.agent-workspace-policy.v1',
        isolationMode: 'subject',
        roots: [
          { kind: 'workspace', logicalPath: 'workspace', access: 'readWrite' },
          { kind: 'systemResources', logicalPath: '.nextagent', access: 'read' },
          { kind: 'temp', logicalPath: 'temp', access: 'readWrite' },
        ],
      },
      modelIds: ['test-model'],
      capabilityBindings: [],
      userInvocable: true,
      agentInvocation: 'BOUND',
      runtimeSettings: { requestTimeoutMs: 30_000 },
    };
    const runtime = createRequestLifecycleCoordinator({
      agentConstructors: [
        createTestAgentConstructor(async ({ runState }, run, context) => {
          await runState.emitEvent(run, context, { type: 'LLM_CONTENT_DELTA', inlinePayload: { final: true, content: 'runtime log complete' } });
        }),
      ],
      agentRuntimeDependencies: {},
      assemblyRegistry: {
        async active() {
          return assembly;
        },
        async require() {
          return assembly;
        },
      },
      capabilityCatalog: createStaticCapabilityCatalog(),
      defaultRouteAgentId: agentId,
      userSessions: createUserSessionService({
        sessionStore: gateway.sessions,
        messageStore: gateway.messages,
        activeContextStore: gateway.activeContext,
      }),
      messageStore: gateway.messages,
      activeContextStore: gateway.activeContext,
      requestRunStore: gateway.requestRuns,
      timelineStore: gateway.timeline,
      checkpointStore: gateway.checkpoints,
    });

    const accepted = await runtime.submit({
      sessionId,
      identityContext: identity,
      inputText: 'runtime log path',
      attachmentIds: [],
      locale: brand<string, 'RequestLocale'>('zh-CN'),
      idempotencyKey: brand<string, 'IdempotencyKey'>('idem-runtime-log'),
    });
    await waitForRunTerminal(gateway, accepted.runId);

    expect(entries.map((entry) => entry.event)).toEqual(
      expect.arrayContaining([
        'runtime.queue.enqueued',
        'runtime.run.dispatched',
        'runtime.run.terminal_commit_start',
        'runtime.run.terminal_commit_complete',
        'runtime.run.execution_finished',
      ]),
    );
    expect(entries.find((entry) => entry.event === 'runtime.run.execution_finished')).toMatchObject({
      terminalStatus: 'COMPLETED',
      safeReasonCode: 'TERMINAL_COMPLETED',
    });
    expect(JSON.stringify(entries)).not.toContain('runtime log path');
    expect(JSON.stringify(entries)).not.toContain('runtime log complete');
  });

  it('includes failure status on runtime execution finished logs', async () => {
    const gateway = createTestGatewayStores();
    const sessionId = brand<string, 'SessionId'>('session-runtime-failed-log');
    const entries: Array<{ readonly event?: string }> = [];
    await gateway.sessions.saveSession({
      tenantId: identity.tenantId,
      subjectId: identity.subjectId,
      agentId,
      sessionId,
      createdAt: brand<number, 'EpochMillis'>(1),
      updatedAt: brand<number, 'EpochMillis'>(1),
    });
    const assembly: AgentAssembly = {
      agentId,
      agentType: brand<string, 'AgentType'>('default'),
      agentVersion: brand<string, 'AgentVersion'>('v1'),
      agentAssemblyRef: 'default-agent:v1',
      displayName: 'Default',
      description: 'Telecom test agent.',
      workspacePolicy: {
        schemaVersion: 'nextagent.agent-workspace-policy.v1',
        isolationMode: 'subject',
        roots: [
          { kind: 'workspace', logicalPath: 'workspace', access: 'readWrite' },
          { kind: 'systemResources', logicalPath: '.nextagent', access: 'read' },
          { kind: 'temp', logicalPath: 'temp', access: 'readWrite' },
        ],
      },
      modelIds: ['test-model'],
      capabilityBindings: [],
      userInvocable: true,
      agentInvocation: 'BOUND',
      runtimeSettings: { requestTimeoutMs: 30_000 },
    };
    loggerBinding = bindRuntimeLoggerProvider({
      getLogger: () => ({
        info(obj) {
          entries.push(obj as { readonly event?: string });
        },
        warn(obj) {
          entries.push(obj as { readonly event?: string });
        },
        error(obj) {
          entries.push(obj as { readonly event?: string });
        },
        debug(obj) {
          entries.push(obj as { readonly event?: string });
        },
      }),
    });
    const runtime = createRequestLifecycleCoordinator({
      agentConstructors: [
        createTestAgentConstructor(async () => {
          throw new Error('runtime failed log path');
        }),
      ],
      agentRuntimeDependencies: {},
      assemblyRegistry: {
        async active() {
          return assembly;
        },
        async require() {
          return assembly;
        },
      },
      capabilityCatalog: createStaticCapabilityCatalog(),
      defaultRouteAgentId: agentId,
      userSessions: createUserSessionService({
        sessionStore: gateway.sessions,
        messageStore: gateway.messages,
        activeContextStore: gateway.activeContext,
      }),
      messageStore: gateway.messages,
      activeContextStore: gateway.activeContext,
      requestRunStore: gateway.requestRuns,
      timelineStore: gateway.timeline,
      checkpointStore: gateway.checkpoints,
    });

    const accepted = await runtime.submit({
      sessionId,
      identityContext: identity,
      inputText: 'runtime failed log request',
      attachmentIds: [],
      locale: brand<string, 'RequestLocale'>('zh-CN'),
      idempotencyKey: brand<string, 'IdempotencyKey'>('idem-runtime-failed-log'),
    });
    await waitForRunTerminal(gateway, accepted.runId);

    expect(entries.find((entry) => entry.event === 'runtime.run.execution_finished')).toMatchObject({
      terminalStatus: 'FAILED',
      safeReasonCode: 'TERMINAL_FAILED',
    });
    expect(entries.filter((entry) => entry.event === 'request.execution.exception_captured')).toEqual([
      expect.objectContaining({
        failureStage: 'REQUEST_EXECUTION',
        agentId,
        sessionId,
        requestId: accepted.requestId,
        runId: accepted.runId,
        err: expect.objectContaining({ message: 'runtime failed log path' }),
      }),
    ]);
    expect(entries).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ event: 'runtime.scheduler.dispatch_failed', runId: accepted.runId })]),
    );
    expect(JSON.stringify(entries)).not.toContain('runtime failed log request');
  });

  it('publishes runtime-owned live-only timeline events to listeners and online streams without persisting them', async () => {
    const gateway = createTestGatewayStores();
    const sessionId = brand<string, 'SessionId'>('session-live-only-listener');
    await gateway.sessions.saveSession({
      tenantId: identity.tenantId,
      subjectId: identity.subjectId,
      agentId,
      sessionId,
      createdAt: brand<number, 'EpochMillis'>(1),
      updatedAt: brand<number, 'EpochMillis'>(1),
    });
    const assembly: AgentAssembly = {
      agentId,
      agentType: brand<string, 'AgentType'>('default'),
      agentVersion: brand<string, 'AgentVersion'>('v1'),
      agentAssemblyRef: 'default-agent:v1',
      displayName: 'Default',
      description: 'Telecom test agent.',
      workspacePolicy: {
        schemaVersion: 'nextagent.agent-workspace-policy.v1',
        isolationMode: 'subject',
        roots: [
          { kind: 'workspace', logicalPath: 'workspace', access: 'readWrite' },
          { kind: 'systemResources', logicalPath: '.nextagent', access: 'read' },
          { kind: 'temp', logicalPath: 'temp', access: 'readWrite' },
        ],
      },
      modelIds: ['test-model'],
      capabilityBindings: [],
      userInvocable: true,
      agentInvocation: 'BOUND',
      runtimeSettings: { requestTimeoutMs: 30_000 },
    };
    const observed: RunTimelineEvent[] = [];
    const runtime = createRequestLifecycleCoordinator({
      agentConstructors: [
        createTestAgentConstructor(async ({ runState }, run, context) => {
          await runState.emitEvent(run, context, { type: 'DEGRADATION_NOTICE', inlinePayload: { code: 'LIVE_ONLY_DIAGNOSTIC' } });
          await runState.emitEvent(run, context, { type: 'LLM_CONTENT_DELTA', inlinePayload: { final: true, content: 'live-only complete' } });
        }),
      ],
      agentRuntimeDependencies: {},
      assemblyRegistry: {
        async active() {
          return assembly;
        },
        async require() {
          return assembly;
        },
      },
      capabilityCatalog: createStaticCapabilityCatalog(),
      defaultRouteAgentId: agentId,
      userSessions: createUserSessionService({
        sessionStore: gateway.sessions,
        messageStore: gateway.messages,
        activeContextStore: gateway.activeContext,
      }),
      messageStore: gateway.messages,
      activeContextStore: gateway.activeContext,
      requestRunStore: gateway.requestRuns,
      timelineStore: gateway.timeline,
      checkpointStore: gateway.checkpoints,
      runTimelineEventListeners: [
        () => {
          throw new Error('activity sidecar invalidation failed');
        },
        (event) => observed.push(event),
      ],
      runTimelineEventPersistencePolicy: (event) => (event.type === 'DEGRADATION_NOTICE' ? 'LIVE_ONLY' : 'PERSISTED'),
    });

    const controller = new AbortController();
    const stream = runtime
      .streamEvents({
        identityContext: identity,
        sessionId,
        signal: controller.signal,
      })
      [Symbol.asyncIterator]();
    const firstStreamEvent = nextWithTimeout(stream);

    const accepted = await runtime.submit({
      sessionId,
      identityContext: identity,
      inputText: 'live only listener',
      attachmentIds: [],
      locale: brand<string, 'RequestLocale'>('zh-CN'),
      idempotencyKey: brand<string, 'IdempotencyKey'>('idem-live-only-listener'),
    });
    await waitForRunTerminal(gateway, accepted.runId);
    const streamed = [await firstStreamEvent, await nextWithTimeout(stream), await nextWithTimeout(stream), await nextWithTimeout(stream)].map(
      (result) => result.value,
    );
    controller.abort();

    const liveOnly = observed.find((event) => event.type === 'DEGRADATION_NOTICE');
    expect(liveOnly).toMatchObject({
      persistence: 'LIVE_ONLY',
      agentId: 'default-agent',
      agentVersion: 'v1',
      sessionId,
      runId: accepted.runId,
      inlinePayload: { code: 'LIVE_ONLY_DIAGNOSTIC' },
    });
    expect(liveOnly?.eventId).toBeDefined();
    expect(liveOnly?.sequence).toBeUndefined();
    expect(liveOnly?.createdAt).toBeInstanceOf(Date);

    const streamedContentDelta = streamed.find((event) => event?.type === 'LLM_CONTENT_DELTA');
    expect(streamedContentDelta).toMatchObject({
      persistence: 'LIVE_ONLY',
      sessionId,
      runId: accepted.runId,
      inlinePayload: { final: true, content: 'live-only complete' },
    });
    expect(streamedContentDelta?.sequence).toBeUndefined();
    expect(streamed.map((event) => event?.type)).toEqual(expect.arrayContaining(['REQUEST_ACCEPTED', 'LLM_CONTENT_DELTA', 'REQUEST_COMPLETED']));

    const persisted = await gateway.timeline.listEvents({
      tenantId: identity.tenantId,
      subjectId: identity.subjectId,
      agentId,
      sessionId,
      afterSequence: brand<number, 'TimelineSequence'>(0),
      limit: 1000,
    });
    expect(persisted.map((event) => event.type)).not.toContain('DEGRADATION_NOTICE');
    expect(persisted.map((event) => event.type)).not.toContain('LLM_CONTENT_DELTA');
    expect(persisted.map((event) => event.type)).toEqual(expect.arrayContaining(['REQUEST_ACCEPTED', 'REQUEST_COMPLETED']));
  });

  it('constructs Agent once while keeping terminal output isolated per run', async () => {
    const gateway = createTestGatewayStores();
    const sessionId = brand<string, 'SessionId'>('session-singleton-run-state');
    await gateway.sessions.saveSession({
      tenantId: identity.tenantId,
      subjectId: identity.subjectId,
      agentId,
      sessionId,
      createdAt: brand<number, 'EpochMillis'>(1),
      updatedAt: brand<number, 'EpochMillis'>(1),
    });
    const assembly: AgentAssembly = {
      agentId,
      agentType: brand<string, 'AgentType'>('default'),
      agentVersion: brand<string, 'AgentVersion'>('v1'),
      agentAssemblyRef: 'default-agent:v1',
      displayName: 'Default',
      description: 'Telecom test agent.',
      workspacePolicy: {
        schemaVersion: 'nextagent.agent-workspace-policy.v1',
        isolationMode: 'subject',
        roots: [
          { kind: 'workspace', logicalPath: 'workspace', access: 'readWrite' },
          { kind: 'systemResources', logicalPath: '.nextagent', access: 'read' },
          { kind: 'temp', logicalPath: 'temp', access: 'readWrite' },
        ],
      },
      modelIds: ['test-model'],
      capabilityBindings: [],
      userInvocable: true,
      agentInvocation: 'BOUND',
      runtimeSettings: { requestTimeoutMs: 30_000 },
    };
    let createAgentCalls = 0;
    let executeCalls = 0;
    const runtime = createRequestLifecycleCoordinator({
      agentConstructors: [
        createTestAgentConstructor(
          async ({ runState }, run, context) => {
            executeCalls++;
            await runState.emitEvent(run, context, { type: 'LLM_CONTENT_DELTA', inlinePayload: { final: true, content: `answer-${executeCalls}` } });
          },
          { onConstruct: () => createAgentCalls++ },
        ),
      ],
      agentRuntimeDependencies: {},
      assemblyRegistry: {
        async active() {
          return assembly;
        },
        async require() {
          return assembly;
        },
      },
      capabilityCatalog: createStaticCapabilityCatalog(),
      defaultRouteAgentId: agentId,
      userSessions: createUserSessionService({
        sessionStore: gateway.sessions,
        messageStore: gateway.messages,
        activeContextStore: gateway.activeContext,
      }),
      messageStore: gateway.messages,
      activeContextStore: gateway.activeContext,
      requestRunStore: gateway.requestRuns,
      timelineStore: gateway.timeline,
      checkpointStore: gateway.checkpoints,
    });

    const first = await runtime.submit({
      sessionId,
      identityContext: identity,
      inputText: 'first singleton run',
      attachmentIds: [],
      locale: brand<string, 'RequestLocale'>('zh-CN'),
      idempotencyKey: brand<string, 'IdempotencyKey'>('idem-singleton-run-state-1'),
    });
    const second = await runtime.submit({
      sessionId,
      identityContext: identity,
      inputText: 'second singleton run',
      attachmentIds: [],
      locale: brand<string, 'RequestLocale'>('zh-CN'),
      idempotencyKey: brand<string, 'IdempotencyKey'>('idem-singleton-run-state-2'),
    });

    await waitForRunTerminal(gateway, first.runId);
    await waitForRunTerminal(gateway, second.runId);
    expect(createAgentCalls).toBe(1);
    await expect(
      gateway.messages.listCurrentRequestMessages({
        tenantId: identity.tenantId,
        subjectId: identity.subjectId,
        agentId,
        sessionId,
        requestId: first.requestId,
        runId: first.runId,
        includeHidden: false,
        offset: 0,
        limit: 10,
      }),
    ).resolves.toMatchObject({ items: [{ role: 'USER' }, { role: 'ASSISTANT', content: 'answer-1' }] });
    await expect(
      gateway.messages.listCurrentRequestMessages({
        tenantId: identity.tenantId,
        subjectId: identity.subjectId,
        agentId,
        sessionId,
        requestId: second.requestId,
        runId: second.runId,
        includeHidden: false,
        offset: 0,
        limit: 10,
      }),
    ).resolves.toMatchObject({ items: [{ role: 'USER' }, { role: 'ASSISTANT', content: 'answer-2' }] });
  });

  it('routes Agent construction by accepted assembly type', async () => {
    const runState: AgentRunStatePort = {
      async setCapabilityTerminalAnswer(): Promise<void> {},
      async emitEvent() {},
      async appendMessage() {
        return brand<string, 'MessageId'>('message-agent-instance');
      },
      async saveCheckpoint() {},
      async requestPendingInput() {
        throw new Error('not used');
      },
    };
    const executedTypes: string[] = [];
    const defaultConstructor = createTestAgentConstructor(async () => {
      executedTypes.push('default');
    });
    const directedConstructor = createTestAgentConstructor(
      async () => {
        executedTypes.push('directed');
      },
      { agentType: brand<string, 'AgentType'>('directed') },
    );

    const manager = new AgentInstanceManager({
      agentConstructors: [defaultConstructor, directedConstructor],
      agentRuntimeDependencies: {},
      runState,
    });
    const assembly: AgentAssembly = {
      agentId,
      agentType: brand<string, 'AgentType'>('directed'),
      agentVersion: brand<string, 'AgentVersion'>('v1'),
      agentAssemblyRef: 'default-agent:v1',
      displayName: 'Default',
      description: 'Default test agent.',
      workspacePolicy: {
        schemaVersion: 'nextagent.agent-workspace-policy.v1',
        isolationMode: 'subject',
        roots: [
          { kind: 'workspace', logicalPath: 'workspace', access: 'readWrite' },
          { kind: 'systemResources', logicalPath: '.nextagent', access: 'read' },
          { kind: 'temp', logicalPath: 'temp', access: 'readWrite' },
        ],
      },
      modelIds: ['test-model'],
      capabilityBindings: [],
      userInvocable: true,
      agentInvocation: 'BOUND',
      runtimeSettings: { requestTimeoutMs: 30_000 },
    };

    await manager.getOrCreate(assembly).execute(
      {
        runId: brand<string, 'RequestRunId'>('run-agent-instance'),
        sessionId: brand<string, 'SessionId'>('session-agent-instance'),
        requestId: brand<string, 'MessageId'>('request-agent-instance'),
        agentId,
        agentVersion: assembly.agentVersion,
        agentAssemblyRef: assembly.agentAssemblyRef,
        attempt: 1,
        status: 'EXECUTING',
        version: 1,
        terminalCommitState: 'NOT_STARTED',
        createdAt: brand<number, 'EpochMillis'>(1),
        updatedAt: brand<number, 'EpochMillis'>(1),
      },
      {
        requestContextId: brand<string, 'RequestContextId'>('context-agent-instance'),
        sessionId: brand<string, 'SessionId'>('session-agent-instance'),
        requestId: brand<string, 'MessageId'>('request-agent-instance'),
        runId: brand<string, 'RequestRunId'>('run-agent-instance'),
        agentTurnIndex: 0,
        identityContext: identity,
        locale: brand<string, 'RequestLocale'>('zh-CN'),
        agentId,
        agentVersion: assembly.agentVersion,
        agentAssemblyRef: assembly.agentAssemblyRef,
        activeStepId: 'turn-1',
        nextLifecycleStage: 'BEFORE_MODEL_INVOKE',
        toolCallStates: [],
        flowVariables: {},
      },
      new AbortController().signal,
    );

    expect(executedTypes).toEqual(['directed']);
    expect(manager.getOrCreate(assembly)).toBe(manager.getOrCreate(assembly));
    expect(() =>
      manager.getOrCreate({
        ...assembly,
        agentType: brand<string, 'AgentType'>('missing'),
        agentAssemblyRef: 'missing-agent:v1',
      }),
    ).toThrow('Agent type is not registered.');
  });

  it('returns version conflicts for stale active context and run start writes', async () => {
    const gateway = createTestGatewayStores();
    const sessionId = brand<string, 'SessionId'>('session-conflict');
    await gateway.sessions.saveSession({
      tenantId: identity.tenantId,
      subjectId: identity.subjectId,
      agentId,
      sessionId,
      createdAt: brand<number, 'EpochMillis'>(1),
      updatedAt: brand<number, 'EpochMillis'>(1),
    });
    await gateway.activeContext.appendItem({
      tenantId: identity.tenantId,
      subjectId: identity.subjectId,
      agentId,
      sessionId,
      messageId: brand<string, 'MessageId'>('message-1'),
      expectedActiveContextVersion: 0,
    });

    await expect(
      gateway.activeContext.appendItem({
        tenantId: identity.tenantId,
        subjectId: identity.subjectId,
        agentId,
        sessionId,
        messageId: brand<string, 'MessageId'>('message-2'),
        expectedActiveContextVersion: 0,
      }),
    ).resolves.toMatchObject({ status: 'VERSION_CONFLICT' });

    const runId = brand<string, 'RequestRunId'>('run-conflict');
    await gateway.requestRuns.saveRun(
      {
        tenantId: identity.tenantId,
        subjectId: identity.subjectId,
        runId,
        sessionId,
        requestId: brand<string, 'MessageId'>('request-conflict'),
        agentId: brand<string, 'AgentId'>('default-agent'),
        agentVersion: brand<string, 'AgentVersion'>('v1'),
        agentAssemblyRef: 'default-agent:v1',
        attempt: 1,
        status: 'ACCEPTED',
        version: 1,
        terminalCommitState: 'NOT_STARTED',
        createdAt: brand<number, 'EpochMillis'>(1),
        updatedAt: brand<number, 'EpochMillis'>(1),
      },
      { idempotencyKey: brand<string, 'IdempotencyKey'>('idem-run-conflict-save') },
    );
    await expect(
      gateway.requestRuns.saveRun(
        {
          tenantId: identity.tenantId,
          subjectId: identity.subjectId,
          runId,
          sessionId,
          requestId: brand<string, 'MessageId'>('request-conflict'),
          agentId: brand<string, 'AgentId'>('default-agent'),
          agentVersion: brand<string, 'AgentVersion'>('v1'),
          agentAssemblyRef: 'default-agent:v1',
          attempt: 1,
          status: 'EXECUTING',
          version: 2,
          terminalCommitState: 'NOT_STARTED',
          createdAt: brand<number, 'EpochMillis'>(1),
          updatedAt: brand<number, 'EpochMillis'>(2),
        },
        {
          expectedVersion: 0,
          idempotencyKey: brand<string, 'IdempotencyKey'>('idem-run-conflict-stale'),
        },
      ),
    ).resolves.toMatchObject({ status: 'VERSION_CONFLICT' });
  });
});
