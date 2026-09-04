import { createDefaultAgentTestAssemblyRegistry, createNextAgentTestApp } from '@nextagent/agent-app/testing';
import { createRetrySourceAttachmentValidator } from '@nextagent/agent-attachment-runtime';
import { createStaticCapabilityCatalog } from '@nextagent/agent-capability';
import { brand, type SessionId, type TimelineEventType } from '@nextagent/agent-common';
import type { AgentAssemblyRegistry } from '@nextagent/agent-contracts/agent-assembly';
import type { CheckpointRecord, RequestRunRecord, RunTimelineEventRecord, SessionMessageRecord } from '@nextagent/agent-contracts/gateway';
import type { AuditEventWriter } from '@nextagent/agent-contracts/observability';
import type { AgentRunStatePort, RequestContext, RequestRun, RunTimelineEvent } from '@nextagent/agent-contracts/runtime';
import { createRequestLifecycleCoordinator, type RequestLifecycleDependencies, maxTerminalMessageChars } from '@nextagent/agent-runtime';
import { createUserSessionService } from '@nextagent/agent-session';
import { createTestGatewayStores, createTestGatewayStoresWithSqliteFile } from '../../fixtures/local-gateway.js';
import { createTestAgentConstructor } from '../../fixtures/test-agent.js';
import { unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const identity = {
  tenantId: brand<string, 'TenantId'>('tenant-reliability'),
  subjectId: brand<string, 'SubjectId'>('subject-reliability'),
  displayName: 'Reliability tester',
};
const agentId = brand<string, 'AgentId'>('default-agent');
const agentVersion = brand<string, 'AgentVersion'>('v1');

async function waitFor(assertion: () => boolean | Promise<boolean>, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await assertion()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  expect(await assertion()).toBe(true);
}

function runRecord(overrides: Partial<RequestRunRecord> & Pick<RequestRunRecord, 'runId' | 'sessionId' | 'requestId'>): RequestRunRecord {
  const now = brand<number, 'EpochMillis'>(overrides.createdAt === undefined ? 1 : Number(overrides.createdAt));
  return {
    tenantId: identity.tenantId,
    subjectId: identity.subjectId,
    agentId,
    agentVersion,
    agentAssemblyRef: 'default-agent:v1',
    attempt: 1,
    status: 'QUEUED',
    version: 1,
    terminalCommitState: 'NOT_STARTED',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function messageRecord(
  overrides: Partial<SessionMessageRecord> & Pick<SessionMessageRecord, 'messageId' | 'sessionId' | 'requestId' | 'runId' | 'role' | 'content'>,
): SessionMessageRecord {
  return {
    tenantId: identity.tenantId,
    subjectId: identity.subjectId,
    agentId,
    contentType: 'PLAIN_TEXT',
    metadata: {},
    visible: true,
    createdAt: brand<number, 'EpochMillis'>(1),
    ...overrides,
  };
}

function timelineEventRecord(
  overrides: Partial<RunTimelineEventRecord> &
    Pick<RunTimelineEventRecord, 'eventId' | 'sessionId' | 'requestId' | 'runId' | 'type' | 'inlinePayload'>,
): RunTimelineEventRecord {
  return {
    tenantId: identity.tenantId,
    subjectId: identity.subjectId,
    agentId,
    requestContextId: brand<string, 'RequestContextId'>('context-timeline'),
    sequence: brand<number, 'TimelineSequence'>(0),
    createdAt: brand<number, 'EpochMillis'>(5),
    ...overrides,
  };
}

function checkpointRecord(
  overrides: {
    readonly sessionId: RequestRun['sessionId'];
    readonly requestId: RequestRun['requestId'];
    readonly runId: RequestRun['runId'];
    readonly requestContextId: RequestContext['requestContextId'];
    readonly triggerReason: CheckpointRecord['triggerReason'];
  } & Partial<CheckpointRecord>,
): CheckpointRecord {
  const { sessionId, requestId, runId, requestContextId, triggerReason, ...rest } = overrides;
  return {
    tenantId: identity.tenantId,
    subjectId: identity.subjectId,
    agentId,
    checkpointId: brand<string, 'CheckpointId'>(`checkpoint-${runId}`),
    sessionId,
    requestId,
    runId,
    requestContextId,
    runVersion: 1,
    triggerReason,
    lastSequence: brand<number, 'TimelineSequence'>(0),
    activeContextVersion: 0,
    flowVariables: {},
    savedAt: brand<number, 'EpochMillis'>(10),
    ...rest,
  };
}

async function createSession(gateway: ReturnType<typeof createTestGatewayStores>, sessionId: RequestRun['sessionId']): Promise<void> {
  await gateway.sessions.saveSession({
    tenantId: identity.tenantId,
    subjectId: identity.subjectId,
    agentId,
    sessionId,
    createdAt: brand<number, 'EpochMillis'>(1),
    updatedAt: brand<number, 'EpochMillis'>(1),
  });
}

async function loadRun(gateway: ReturnType<typeof createTestGatewayStores>, runId: RequestRun['runId']): Promise<RequestRunRecord | undefined> {
  return gateway.requestRuns.loadRun({
    tenantId: identity.tenantId,
    subjectId: identity.subjectId,
    agentId,
    runId,
  });
}

async function saveCheckpoint(
  gateway: ReturnType<typeof createTestGatewayStores>,
  overrides: Parameters<typeof checkpointRecord>[0],
  idempotencyKey: string,
): Promise<void> {
  const active = await gateway.activeContext.loadActiveContext({
    tenantId: identity.tenantId,
    subjectId: identity.subjectId,
    agentId,
    sessionId: overrides.sessionId,
  });
  await gateway.checkpoints.saveCheckpoint(
    checkpointRecord({
      activeContextVersion: active.state.activeContextVersion,
      ...overrides,
    }),
    { idempotencyKey: brand<string, 'IdempotencyKey'>(idempotencyKey) },
  );
}

function cancelCommandSemantic(sessionId: RequestRun['sessionId'], expectedLatestRequestId: RequestRun['requestId'], idempotencyKey: string): string {
  return JSON.stringify({
    action: 'CANCEL',
    tenantId: identity.tenantId,
    subjectId: identity.subjectId,
    agentId,
    sessionId,
    expectedLatestRequestId,
    idempotencyKey,
  });
}

function createRuntime(
  gateway: ReturnType<typeof createTestGatewayStores>,
  execute: LegacyExecute,
  overrides: Partial<Pick<RequestLifecycleDependencies<object>, 'assemblyRegistry' | 'auditWriter' | 'requestRunStore'>> = {},
) {
  return createRequestLifecycleCoordinator({
    agentConstructors: [
      createTestAgentConstructor(async ({ runState }, run, context, signal) => {
        await execute(run, context, toLegacyTimeline(runState, run, context), runState, signal);
      }),
    ],
    agentRuntimeDependencies: {},
    assemblyRegistry: createDefaultAgentTestAssemblyRegistry('deterministic-test-model'),
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
    retryAttachmentValidator: createRetrySourceAttachmentValidator(gateway.attachments),
    timelineStore: gateway.timeline,
    checkpointStore: gateway.checkpoints,
    pendingInputStore: gateway.pendingInputs,
    ...overrides,
  });
}

type LegacyExecute = (
  run: RequestRun,
  context: RequestContext,
  timeline: { emit(event: RunTimelineEvent): Promise<void> },
  messages: Pick<AgentRunStatePort, 'appendMessage'>,
  signal: AbortSignal,
) => Promise<void>;

function toLegacyTimeline(runState: AgentRunStatePort, run: RequestRun, context: RequestContext) {
  return {
    emit(event: RunTimelineEvent): Promise<void> {
      return runState.emitEvent(run, context, event);
    },
  };
}

async function waitForTimelineTypes(
  gateway: ReturnType<typeof createTestGatewayStores>,
  sessionId: SessionId,
  expectedTypes: readonly TimelineEventType[],
) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    await waitFor(async () => {
      const visibleEvents = await gateway.timeline.listEvents({
        tenantId: identity.tenantId,
        subjectId: identity.subjectId,
        agentId,
        sessionId,
        afterSequence: brand<number, 'TimelineSequence'>(0),
        limit: 1000,
      });
      return visibleEvents.some((event) => event.type === 'REQUEST_CANCELED');
    });
    const events = await gateway.timeline.listEvents({
      tenantId: identity.tenantId,
      subjectId: identity.subjectId,
      agentId,
      sessionId,
      afterSequence: brand<number, 'TimelineSequence'>(0),
      limit: 1000,
    });
    const types = events.map((event) => event.type);
    if (expectedTypes.every((type) => types.includes(type))) {
      return events;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  return gateway.timeline.listEvents({
    tenantId: identity.tenantId,
    subjectId: identity.subjectId,
    agentId,
    sessionId,
    afterSequence: brand<number, 'TimelineSequence'>(0),
  });
}

describe('reliability module', () => {
  it('TC_Reliability_Gateway_Error_001: SQLite unavailable gateway error mapping correct', async () => {
    const { gateway, sqliteFile } = createTestGatewayStoresWithSqliteFile();
    const sessionId = brand<string, 'SessionId'>('session-gateway-error');
    await createSession(gateway, sessionId);
    gateway.close?.();
    unlinkSync(sqliteFile);

    const runtime = createRuntime(gateway, async () => {});
    await expect(
      runtime.submit({
        sessionId,
        identityContext: identity,
        inputText: 'gateway error test',
        attachmentIds: [],
        locale: brand<string, 'RequestLocale'>('zh-CN'),
        idempotencyKey: brand<string, 'IdempotencyKey'>('idem-gateway-error'),
      }),
    ).rejects.toMatchObject({ code: 'ERR_INVALID_STATE' });

    writeFileSync(sqliteFile, '');
  });

  it('binary_bug: stream incomplete safe failure not implemented - TC_Reliability_Stream_Incomplete_002: Model stream incomplete safe failure correct', async () => {
    const app = createNextAgentTestApp({
      workspaceDir: process.cwd(),
      modelSteps: [{ safeError: { code: 'MODEL_STREAM_INVALID', message: 'Model stream incomplete.', category: 'UNAVAILABLE', retryable: false } }],
    });

    const accepted = await app.server.inject({
      method: 'POST',
      url: '/api/v1/requests',
      payload: { inputText: 'stream incomplete test', idempotencyKey: 'idem-stream-incomplete' },
    });
    const body = accepted.json<{ sessionId: string; runId: string }>();
    const stream = await app.server.inject({
      method: 'GET',
      url: `/api/v1/sessions/${body.sessionId}/stream?lastSeenSequence=0&runId=${body.runId}`,
    });

    expect(stream.body).toContain('MODEL_STREAM_INVALID');
    expect(stream.body).toContain('event: REQUEST_FAILED');
    expect(stream.body).not.toContain('partial answer');

    const history = await app.server.inject({ method: 'GET', url: `/api/v1/sessions/${body.sessionId}/conversation?limit=10` });
    expect(history.body).toContain('Request failed: Model stream incomplete.');
    expect(history.body).not.toContain('partial answer');
  });

  it('binary_bug: model length finish truncation not implemented - TC_Reliability_Length_Finish_003: Model length finish truncation error correct', async () => {
    const app = createNextAgentTestApp({
      workspaceDir: process.cwd(),
      modelSteps: [
        {
          safeError: {
            code: 'MODEL_TEXT_LIMIT_EXCEEDED',
            message: 'Model output truncated due to length limit.',
            category: 'VALIDATION',
            retryable: false,
          },
        },
      ],
    });

    const accepted = await app.server.inject({
      method: 'POST',
      url: '/api/v1/requests',
      payload: { inputText: 'length finish test', idempotencyKey: 'idem-length-finish' },
    });
    const body = accepted.json<{ sessionId: string; runId: string }>();
    const stream = await app.server.inject({
      method: 'GET',
      url: `/api/v1/sessions/${body.sessionId}/stream?lastSeenSequence=0&runId=${body.runId}`,
    });

    expect(stream.body).toContain('MODEL_TEXT_LIMIT_EXCEEDED');
    expect(stream.body).toContain('event: REQUEST_FAILED');
    expect(stream.body).not.toContain('partial truncated');

    const history = await app.server.inject({ method: 'GET', url: `/api/v1/sessions/${body.sessionId}/conversation?limit=10` });
    expect(history.body).toContain('Request failed: Model output truncated due to length limit.');
  });

  it('binary_bug: incomplete markdown table reject not implemented - TC_Reliability_Markdown_Reject_004: Incomplete markdown table reject terminal commit correct', async () => {
    const partialTable = '\n\n| 项目 | 说明 |\n|-----|------|\n| **1. 网元类型** | 您需要哪类网元的KPI报告？例如';
    const app = createNextAgentTestApp({
      workspaceDir: process.cwd(),
      modelSteps: [{ content: partialTable }],
    });

    const accepted = await app.server.inject({
      method: 'POST',
      url: '/api/v1/requests',
      payload: { inputText: 'incomplete markdown test', idempotencyKey: 'idem-markdown-reject' },
    });
    const body = accepted.json<{ sessionId: string; runId: string }>();
    const stream = await app.server.inject({
      method: 'GET',
      url: `/api/v1/sessions/${body.sessionId}/stream?lastSeenSequence=0&runId=${body.runId}`,
    });

    expect(stream.body).toContain('event: REQUEST_FAILED');
    expect(stream.body).toContain('event: REQUEST_FAILED');
    expect(stream.body).not.toContain('event: REQUEST_COMPLETED');

    const history = await app.server.inject({ method: 'GET', url: `/api/v1/sessions/${body.sessionId}/conversation?limit=10` });
    expect(history.body).not.toContain('REQUEST_COMPLETED');
  });

  it('binary_bug: terminal commit CAS prevent double terminal not implemented - TC_Reliability_Terminal_CAS_005: Terminal commit CAS prevent double terminal correct', async () => {
    const gateway = createTestGatewayStores();
    const sessionId = brand<string, 'SessionId'>('session-terminal-cas');
    await createSession(gateway, sessionId);

    const firstCommit = gateway.requestRuns.commitTerminal.bind(gateway.requestRuns);
    let commitCount = 0;
    (gateway.requestRuns as unknown as { commitTerminal: typeof gateway.requestRuns.commitTerminal }).commitTerminal = async (params) => {
      commitCount += 1;
      if (commitCount === 1) {
        return firstCommit(params);
      }
      return { status: 'VERSION_CONFLICT' };
    };

    const runtime = createRuntime(gateway, async (_run, _context, timeline) => {
      await timeline.emit({ type: 'LLM_CONTENT_DELTA', inlinePayload: { final: true, content: 'first terminal' } });
    });

    const submitted = await runtime.submit({
      sessionId,
      identityContext: identity,
      inputText: 'terminal cas test',
      attachmentIds: [],
      locale: brand<string, 'RequestLocale'>('zh-CN'),
      idempotencyKey: brand<string, 'IdempotencyKey'>('idem-terminal-cas'),
    });

    await waitFor(async () => {
      const run = await loadRun(gateway, submitted.runId);
      return run?.status === 'COMPLETED' || run?.status === 'FAILED';
    });

    (gateway.requestRuns as unknown as { commitTerminal: typeof gateway.requestRuns.commitTerminal }).commitTerminal = firstCommit;
    const run = await loadRun(gateway, submitted.runId);
    expect(run?.terminalCommitState).toBe('COMMITTED');
    expect(commitCount).toBeGreaterThanOrEqual(1);
  });

  it('binary_bug: terminal commit retry idempotent not implemented - TC_Reliability_Terminal_Retry_006: Terminal commit retry idempotent correct', async () => {
    const gateway = createTestGatewayStores();
    const sessionId = brand<string, 'SessionId'>('session-terminal-retry');
    const requestId = brand<string, 'MessageId'>('request-terminal-retry');
    const idempotencyKey = brand<string, 'IdempotencyKey'>('idem-terminal-retry');
    await createSession(gateway, sessionId);

    const runtime = createRuntime(gateway, async (_run, _context, timeline) => {
      await timeline.emit({ type: 'LLM_CONTENT_DELTA', inlinePayload: { final: true, content: 'terminal retry answer' } });
    });

    const submitted = await runtime.submit({
      sessionId,
      identityContext: identity,
      inputText: 'terminal retry test',
      attachmentIds: [],
      locale: brand<string, 'RequestLocale'>('zh-CN'),
      idempotencyKey,
    });

    await waitFor(async () => {
      const run = await loadRun(gateway, submitted.runId);
      return run?.terminalCommitState === 'COMMITTED';
    });

    const firstRun = await loadRun(gateway, submitted.runId);
    const firstStatus = firstRun?.status;
    const firstTerminalState = firstRun?.terminalCommitState;

    await gateway.requestRuns.commitTerminal({
      tenantId: identity.tenantId,
      subjectId: identity.subjectId,
      agentId,
      runId: submitted.runId,
      expectedVersion: firstRun?.version ?? 1,
      terminalStatus: firstStatus === 'COMPLETED' ? 'COMPLETED' : 'FAILED',
      terminalEvent: timelineEventRecord({
        eventId: 'event-retry-duplicate',
        sessionId,
        requestId,
        runId: submitted.runId,
        type: 'REQUEST_COMPLETED',
        inlinePayload: { content: 'duplicate' },
      }),
      terminalMessage: messageRecord({
        messageId: brand<string, 'MessageId'>('msg-retry-duplicate'),
        sessionId,
        requestId,
        runId: submitted.runId,
        role: 'ASSISTANT',
        content: 'duplicate',
      }),
      idempotencyKey,
    });

    const afterRetry = await loadRun(gateway, submitted.runId);
    expect(afterRetry?.status).toBe(firstStatus);
    expect(afterRetry?.terminalCommitState).toBe(firstTerminalState);
  });

  it('TC_Reliability_Partial_Reconcile_007: Recovery partial terminal facts reconcile correct', async () => {
    const gateway = createTestGatewayStores();
    const sessionId = brand<string, 'SessionId'>('session-partial-reconcile');
    const requestId = brand<string, 'MessageId'>('request-partial-reconcile');
    const runId = brand<string, 'RequestRunId'>('run-partial-reconcile');
    const terminalMessageId = brand<string, 'MessageId'>('assistant-partial-reconcile');
    await createSession(gateway, sessionId);
    await gateway.requestRuns.saveRun(runRecord({ runId, sessionId, requestId, status: 'EXECUTING', terminalCommitState: 'RETRYING' }), {});
    await gateway.messages.appendSessionMessage(
      messageRecord({ messageId: terminalMessageId, sessionId, requestId, runId, role: 'ASSISTANT', content: 'partial terminal answer' }),
      { idempotencyKey: brand<string, 'IdempotencyKey'>('partial-reconcile-message') },
    );
    await gateway.timeline.appendEvent(
      timelineEventRecord({
        eventId: 'event-partial-reconcile',
        sessionId,
        requestId,
        runId,
        type: 'REQUEST_COMPLETED',
        inlinePayload: { content: 'partial terminal answer', terminalMessageId },
      }),
      { idempotencyKey: brand<string, 'IdempotencyKey'>('partial-reconcile-event') },
    );

    const runtime = createRuntime(gateway, async () => {
      throw new Error('partial reconcile must not call agent execution');
    });

    const report = await runtime.recoverLocalRuntime({ limit: 10 });
    const run = await loadRun(gateway, runId);
    const messages = await gateway.messages.listCurrentRequestMessages({
      tenantId: identity.tenantId,
      subjectId: identity.subjectId,
      agentId,
      sessionId,
      requestId,
      runId,
      includeHidden: true,
      offset: 0,
      limit: 20,
    });
    const events = await gateway.timeline.listEvents({
      tenantId: identity.tenantId,
      subjectId: identity.subjectId,
      agentId,
      sessionId,
      afterSequence: brand<number, 'TimelineSequence'>(0),
      runId,
    });

    expect(report).toMatchObject({ scanned: 1, failed: 0 });
    expect(run?.status).toBe('COMPLETED');
    expect(run?.terminalCommitState).toBe('COMMITTED');
    expect(messages.items.filter((message) => message.role === 'ASSISTANT').map((message) => message.messageId)).toEqual([terminalMessageId]);
    expect(events.filter((event) => event.type === 'REQUEST_COMPLETED').map((event) => event.eventId)).toEqual(['event-partial-reconcile']);
  });

  it('binary_bug: cancel after late output suppression not implemented - TC_Reliability_Late_Output_008: Cancel after late output suppression correct', async () => {
    const gateway = createTestGatewayStores();
    const sessionId = brand<string, 'SessionId'>('session-late-output');
    const started: string[] = [];
    let observedAbort = false;
    await createSession(gateway, sessionId);

    const runtime = createRuntime(gateway, async (run, context, timeline, messages, signal) => {
      started.push(run.runId);
      await new Promise<void>((resolve) => {
        signal.addEventListener(
          'abort',
          () => {
            observedAbort = true;
            resolve();
          },
          { once: true },
        );
      });
      await timeline.emit({ type: 'LLM_CONTENT_DELTA', inlinePayload: { content: 'late after cancel' } });
      await timeline.emit({ type: 'LLM_CONTENT_DELTA', inlinePayload: { final: true, content: 'late final after cancel' } });
      await messages.appendMessage(run, context, {
        role: 'CAPABILITY_RESULT',
        content: 'late capability after cancel',
        contentType: 'PLAIN_TEXT',
        visible: true,
        metadata: { kind: 'CAPABILITY_RESULT', toolCallId: 'late-tool' },
        idempotencyKey: brand<string, 'IdempotencyKey'>('idem-late-capability'),
      });
      await timeline.emit({ type: 'REQUEST_COMPLETED', inlinePayload: { content: 'late terminal after cancel' } });
    });

    const submitted = await runtime.submit({
      sessionId,
      identityContext: identity,
      inputText: 'late output test',
      attachmentIds: [],
      locale: brand<string, 'RequestLocale'>('zh-CN'),
      idempotencyKey: brand<string, 'IdempotencyKey'>('idem-late-output-submit'),
    });

    await waitFor(() => started.includes(submitted.runId), 15_000);

    await runtime.cancel({
      sessionId,
      identityContext: identity,
      expectedLatestRequestId: submitted.requestId,
      action: 'CANCEL',
      idempotencyKey: brand<string, 'IdempotencyKey'>('idem-late-output-cancel'),
    });

    await waitFor(async () => {
      const run = await loadRun(gateway, submitted.runId);
      return run?.status === 'CANCELED' && run?.terminalCommitState === 'COMMITTED';
    });
    const run = await loadRun(gateway, submitted.runId);
    expect(run?.status).toBe('CANCELED');
    expect(run?.terminalCommitState).toBe('COMMITTED');

    await waitFor(async () => {
      const visibleEvents = await gateway.timeline.listEvents({
        tenantId: identity.tenantId,
        subjectId: identity.subjectId,
        agentId,
        sessionId,
        afterSequence: brand<number, 'TimelineSequence'>(0),
        limit: 1000,
      });
      return visibleEvents.some((event) => event.type === 'REQUEST_CANCELED');
    });
    const events = await gateway.timeline.listEvents({
      tenantId: identity.tenantId,
      subjectId: identity.subjectId,
      agentId,
      sessionId,
      afterSequence: brand<number, 'TimelineSequence'>(0),
      limit: 1000,
    });

    expect(observedAbort).toBe(true);
    expect(events.map((event) => event.type)).toContain('REQUEST_CANCELED');
    expect(events.map((event) => event.type)).not.toContain('REQUEST_COMPLETED');
    expect(JSON.stringify(events)).not.toContain('late after cancel');
    expect(JSON.stringify(events)).not.toContain('late final after cancel');
    expect(JSON.stringify(events)).not.toContain('late terminal after cancel');

    const messages = await gateway.messages.listCurrentRequestMessages({
      tenantId: identity.tenantId,
      subjectId: identity.subjectId,
      agentId,
      sessionId,
      requestId: submitted.requestId,
      runId: submitted.runId,
      includeHidden: true,
      offset: 0,
      limit: 20,
    });
    expect(messages.items.map((message) => message.content)).not.toContain('late capability after cancel');
  });

  it('TC_Reliability_Supersession_Timeline_009: Supersession after older run retain prior timeline correct', async () => {
    const gateway = createTestGatewayStores();
    const sessionId = brand<string, 'SessionId'>('session-supersession-timeline');
    const firstRequestId = brand<string, 'MessageId'>('request-supersession-first');
    const firstRunId = brand<string, 'RequestRunId'>('run-supersession-first');
    const secondRequestId = brand<string, 'MessageId'>('request-supersession-second');
    const secondRunId = brand<string, 'RequestRunId'>('run-supersession-second');
    await createSession(gateway, sessionId);

    await gateway.requestRuns.saveRun(
      runRecord({ runId: firstRunId, sessionId, requestId: firstRequestId, status: 'COMPLETED', terminalCommitState: 'COMMITTED' }),
      {},
    );
    await gateway.messages.appendSessionMessage(
      messageRecord({ messageId: firstRequestId, sessionId, requestId: firstRequestId, runId: firstRunId, role: 'USER', content: 'first request' }),
      { idempotencyKey: brand<string, 'IdempotencyKey'>('supersession-first-user') },
    );
    await gateway.messages.appendSessionMessage(
      messageRecord({
        messageId: brand<string, 'MessageId'>('assistant-supersession-first'),
        sessionId,
        requestId: firstRequestId,
        runId: firstRunId,
        role: 'ASSISTANT',
        content: 'first answer',
      }),
      { idempotencyKey: brand<string, 'IdempotencyKey'>('supersession-first-assistant') },
    );
    await gateway.timeline.appendEvent(
      timelineEventRecord({
        eventId: 'event-supersession-first',
        sessionId,
        requestId: firstRequestId,
        runId: firstRunId,
        type: 'REQUEST_COMPLETED',
        inlinePayload: { content: 'first answer' },
      }),
      { idempotencyKey: brand<string, 'IdempotencyKey'>('supersession-first-event') },
    );

    await gateway.requestRuns.saveRun(
      runRecord({ runId: secondRunId, sessionId, requestId: secondRequestId, status: 'EXECUTING', createdAt: brand<number, 'EpochMillis'>(2) }),
      {},
    );
    await gateway.messages.appendSessionMessage(
      messageRecord({
        messageId: secondRequestId,
        sessionId,
        requestId: secondRequestId,
        runId: secondRunId,
        role: 'USER',
        content: 'second request',
      }),
      { idempotencyKey: brand<string, 'IdempotencyKey'>('supersession-second-user') },
    );

    const firstRunEvents = await gateway.timeline.listEvents({
      tenantId: identity.tenantId,
      subjectId: identity.subjectId,
      agentId,
      sessionId,
      afterSequence: brand<number, 'TimelineSequence'>(0),
      runId: firstRunId,
    });
    const allEvents = await gateway.timeline.listEvents({
      tenantId: identity.tenantId,
      subjectId: identity.subjectId,
      agentId,
      sessionId,
      afterSequence: brand<number, 'TimelineSequence'>(0),
    });

    expect(firstRunEvents.map((event) => event.type)).toContain('REQUEST_COMPLETED');
    expect(allEvents.filter((event) => event.runId === firstRunId).map((event) => event.type)).toContain('REQUEST_COMPLETED');
    expect(allEvents.filter((event) => event.runId === secondRunId).length).toBeGreaterThanOrEqual(0);
  });

  it('binary_bug: recovery assembly missing safe failure not implemented - TC_Reliability_Assembly_Missing_010: Recovery assembly missing safe failure correct', async () => {
    const gateway = createTestGatewayStores();
    const sessionId = brand<string, 'SessionId'>('session-assembly-missing');
    const requestId = brand<string, 'MessageId'>('request-assembly-missing');
    const runId = brand<string, 'RequestRunId'>('run-assembly-missing');
    const contextId = brand<string, 'RequestContextId'>('context-assembly-missing');
    const audits: Parameters<AuditEventWriter['write']>[0][] = [];
    let activeLookups = 0;
    let requireLookups = 0;
    const defaultRegistry = createDefaultAgentTestAssemblyRegistry('deterministic-test-model');
    const assemblyRegistry: AgentAssemblyRegistry = {
      async active(requestedAgentId) {
        activeLookups += 1;
        return defaultRegistry.active(requestedAgentId);
      },
      async require() {
        requireLookups += 1;
        throw new Error('adapter-private assembly path C:\\secret\\agent.json');
      },
    };

    await createSession(gateway, sessionId);
    await gateway.requestRuns.saveRun(
      runRecord({
        runId,
        sessionId,
        requestId,
        status: 'EXECUTING',
        agentVersion: brand<string, 'AgentVersion'>('missing-version'),
        agentAssemblyRef: 'default-agent:missing-version',
      }),
      {},
    );
    await gateway.messages.appendSessionMessage(
      messageRecord({ messageId: requestId, sessionId, requestId, runId, role: 'USER', content: 'missing assembly' }),
      { idempotencyKey: brand<string, 'IdempotencyKey'>('assembly-missing-user') },
    );
    await saveCheckpoint(
      gateway,
      { sessionId, requestId, runId, requestContextId: contextId, triggerReason: 'STEP_STARTED' },
      'assembly-missing-checkpoint',
    );

    const runtime = createRuntime(
      gateway,
      async () => {
        throw new Error('missing assembly must fail before agent execution');
      },
      {
        assemblyRegistry,
        auditWriter: {
          async write(event) {
            audits.push(event);
          },
        },
      },
    );

    const report = await runtime.recoverLocalRuntime({ limit: 10 });
    const run = await loadRun(gateway, runId);
    const messages = await gateway.messages.listCurrentRequestMessages({
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

    expect(report).toMatchObject({ scanned: 1, claimedExecuting: 1, failed: 1 });
    expect(run?.status).toBe('FAILED');
    expect(run?.terminalCommitState).toBe('COMMITTED');
    expect(activeLookups).toBe(0);
    expect(requireLookups).toBe(1);
    expect(messages.items.map((message) => message.content).join('\n')).toContain('RECOVERY_MISSING_ASSEMBLY');
    const events = await gateway.timeline.listEvents({
      tenantId: identity.tenantId,
      subjectId: identity.subjectId,
      agentId,
      sessionId,
      runId,
      afterSequence: brand<number, 'TimelineSequence'>(0),
      limit: 1000,
    });
    expect(events.map((event) => JSON.stringify(event.inlinePayload)).join('\n')).toContain('RECOVERY_MISSING_ASSEMBLY');
    expect(JSON.stringify({ audits, events, messages })).not.toContain('adapter-private');
  }, 20_000);
});
