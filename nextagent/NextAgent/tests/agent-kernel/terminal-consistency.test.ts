import { createDefaultAgentTestAssemblyRegistry } from '@nextagent/agent-platform-gateway-local/testing';
import { createStaticCapabilityCatalog } from '@nextagent/agent-capability';
import { AgentError, brand } from '@nextagent/agent-common';
import { createTestGatewayStores } from '../fixtures/local-gateway.js';
import { createTestAgentConstructor } from '../fixtures/test-agent.js';
import { createRequestLifecycleCoordinator } from '@nextagent/agent-runtime';
import { createUserSessionService } from '@nextagent/agent-session';
import { describe, expect, it } from 'vitest';

const identityContext = {
  tenantId: brand<string, 'TenantId'>('tenant-terminal'),
  subjectId: brand<string, 'SubjectId'>('subject-terminal'),
  displayName: 'Terminal tester',
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

describe('terminal commit consistency', () => {
  it('does not publish terminal stream or visible assistant message when durable terminal commit fails', async () => {
    const gateway = createTestGatewayStores();
    const liveTerminalTypes: string[] = [];
    const sessionId = brand<string, 'SessionId'>('session-terminal-conflict');
    await gateway.sessions.saveSession({
      tenantId: identityContext.tenantId,
      subjectId: identityContext.subjectId,
      agentId,
      sessionId,
      createdAt: brand<number, 'EpochMillis'>(1),
      updatedAt: brand<number, 'EpochMillis'>(1),
    });
    const runtime = createRequestLifecycleCoordinator({
      agentConstructors: [
        createTestAgentConstructor(async ({ runState }, run, context) => {
          await runState.emitEvent(run, context, {
            type: 'LLM_CONTENT_DELTA',
            inlinePayload: { final: true, content: 'must not be visible as terminal history' },
          });
        }),
      ],
      agentRuntimeDependencies: {},
      assemblyRegistry: createDefaultAgentTestAssemblyRegistry('deterministic-test-model'),
      capabilityCatalog: createStaticCapabilityCatalog(),
      defaultRouteAgentId: brand<string, 'AgentId'>('default-agent'),
      userSessions: createUserSessionService({
        sessionStore: gateway.sessions,
        messageStore: gateway.messages,
        activeContextStore: gateway.activeContext,
      }),
      messageStore: gateway.messages,
      activeContextStore: gateway.activeContext,
      requestRunStore: {
        saveRun: gateway.requestRuns.saveRun.bind(gateway),
        loadRun: gateway.requestRuns.loadRun.bind(gateway),
        listRuns: gateway.requestRuns.listRuns.bind(gateway),
        loadSessionLaneSnapshot: gateway.requestRuns.loadSessionLaneSnapshot.bind(gateway),
        loadRunByIdempotencyKey: gateway.requestRuns.loadRunByIdempotencyKey.bind(gateway),
        claimRun: gateway.requestRuns.claimRun.bind(gateway),
        listRecoverableRuns: gateway.requestRuns.listRecoverableRuns.bind(gateway),
        async commitTerminal() {
          return { status: 'VERSION_CONFLICT' };
        },
      },
      timelineStore: gateway.timeline,
      checkpointStore: gateway.checkpoints,
      runTimelineEventListeners: [
        (event) => {
          if (
            event.type === 'REQUEST_COMPLETED' ||
            event.type === 'REQUEST_FAILED' ||
            event.type === 'REQUEST_CANCELED' ||
            event.type === 'REQUEST_SUPERSEDED'
          ) {
            liveTerminalTypes.push(event.type);
          }
        },
      ],
    });

    const accepted = await runtime.submit({
      sessionId,
      identityContext,
      inputText: 'terminal conflict',
      attachmentIds: [],
      locale: brand<string, 'RequestLocale'>('zh-CN'),
      idempotencyKey: brand<string, 'IdempotencyKey'>('idem-terminal-conflict'),
    });

    await waitFor(async () => {
      const run = await gateway.requestRuns.loadRun({
        tenantId: identityContext.tenantId,
        subjectId: identityContext.subjectId,
        agentId,
        runId: accepted.runId,
      });
      return run?.terminalCommitState === 'FAILED';
    });
    const messages = await gateway.messages.listCurrentRequestMessages({
      tenantId: identityContext.tenantId,
      subjectId: identityContext.subjectId,
      agentId,
      sessionId,
      requestId: accepted.requestId,
      runId: accepted.runId,
      includeHidden: false,
      offset: 0,
      limit: 10,
    });
    expect(messages.items.map((item) => item.role)).toEqual(['USER']);
    expect(JSON.stringify(messages.items)).not.toContain('must not be visible');

    const events = await gateway.timeline.listEvents({
      tenantId: identityContext.tenantId,
      subjectId: identityContext.subjectId,
      agentId,
      sessionId,
      afterSequence: brand<number, 'TimelineSequence'>(0),
      limit: 1000,
    });
    expect(events.map((event) => event.type)).not.toContain('REQUEST_COMPLETED');
    expect(events.map((event) => event.type)).not.toContain('REQUEST_FAILED');
    expect(liveTerminalTypes).toEqual([]);
  });

  it('persists a safe assistant failure message only after failed terminal commit succeeds', async () => {
    const gateway = createTestGatewayStores();
    const sessionId = brand<string, 'SessionId'>('session-terminal-failed');
    await gateway.sessions.saveSession({
      tenantId: identityContext.tenantId,
      subjectId: identityContext.subjectId,
      agentId,
      sessionId,
      createdAt: brand<number, 'EpochMillis'>(1),
      updatedAt: brand<number, 'EpochMillis'>(1),
    });
    const runtime = createRequestLifecycleCoordinator({
      agentConstructors: [
        createTestAgentConstructor(async () => {
          throw new Error('Operation failed at D:\\code\\NextAgent\\data\\file.txt: permission denied');
        }),
      ],
      agentRuntimeDependencies: {},
      assemblyRegistry: createDefaultAgentTestAssemblyRegistry('deterministic-test-model'),
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
      identityContext,
      inputText: 'terminal failed',
      attachmentIds: [],
      locale: brand<string, 'RequestLocale'>('zh-CN'),
      idempotencyKey: brand<string, 'IdempotencyKey'>('idem-terminal-failed'),
    });

    await waitFor(async () => {
      const run = await gateway.requestRuns.loadRun({
        tenantId: identityContext.tenantId,
        subjectId: identityContext.subjectId,
        agentId,
        runId: accepted.runId,
      });
      return run?.status === 'FAILED' && run.terminalCommitState === 'COMMITTED';
    });
    const messages = await gateway.messages.listCurrentRequestMessages({
      tenantId: identityContext.tenantId,
      subjectId: identityContext.subjectId,
      agentId,
      sessionId,
      requestId: accepted.requestId,
      runId: accepted.runId,
      includeHidden: false,
      offset: 0,
      limit: 10,
    });
    expect(messages.items.map((item) => item.role)).toEqual(['USER', 'ASSISTANT']);
    expect(messages.items.at(-1)?.content).toBe('Request failed: Operation failed at <redacted>: permission denied');
    expect(JSON.stringify(messages.items)).not.toContain('D:\\code\\NextAgent\\data\\file.txt');

    const events = await gateway.timeline.listEvents({
      tenantId: identityContext.tenantId,
      subjectId: identityContext.subjectId,
      agentId,
      sessionId,
      afterSequence: brand<number, 'TimelineSequence'>(0),
      limit: 1000,
    });
    expect(events.map((event) => event.type)).toContain('REQUEST_FAILED');
  });

  it('carries persisted safe failure reason onto failed terminal history', async () => {
    const gateway = createTestGatewayStores();
    const sessionId = brand<string, 'SessionId'>('session-terminal-failed-reason');
    await gateway.sessions.saveSession({
      tenantId: identityContext.tenantId,
      subjectId: identityContext.subjectId,
      agentId,
      sessionId,
      createdAt: brand<number, 'EpochMillis'>(1),
      updatedAt: brand<number, 'EpochMillis'>(1),
    });
    const runtime = createRequestLifecycleCoordinator({
      agentConstructors: [
        createTestAgentConstructor(async ({ runState }, run, context) => {
          await runState.emitEvent(run, context, {
            type: 'DEGRADATION_NOTICE',
            inlinePayload: { code: 'MODEL_PROVIDER_ERROR', category: 'UNAVAILABLE' },
          });
          throw new Error('Model provider unavailable.');
        }),
      ],
      agentRuntimeDependencies: {},
      assemblyRegistry: createDefaultAgentTestAssemblyRegistry('deterministic-test-model'),
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
      identityContext,
      inputText: 'terminal failed with safe reason',
      attachmentIds: [],
      locale: brand<string, 'RequestLocale'>('zh-CN'),
      idempotencyKey: brand<string, 'IdempotencyKey'>('idem-terminal-failed-reason'),
    });

    await waitFor(async () => {
      const run = await gateway.requestRuns.loadRun({
        tenantId: identityContext.tenantId,
        subjectId: identityContext.subjectId,
        agentId,
        runId: accepted.runId,
      });
      return run?.status === 'FAILED' && run.terminalCommitState === 'COMMITTED';
    });
    const messages = await gateway.messages.listCurrentRequestMessages({
      tenantId: identityContext.tenantId,
      subjectId: identityContext.subjectId,
      agentId,
      sessionId,
      requestId: accepted.requestId,
      runId: accepted.runId,
      includeHidden: false,
      offset: 0,
      limit: 10,
    });
    expect(messages.items.at(-1)?.metadata).toMatchObject({
      eventType: 'REQUEST_FAILED',
      status: 'FAILED',
      code: 'MODEL_PROVIDER_ERROR',
      category: 'UNAVAILABLE',
    });

    const events = await gateway.timeline.listEvents({
      tenantId: identityContext.tenantId,
      subjectId: identityContext.subjectId,
      agentId,
      sessionId,
      afterSequence: brand<number, 'TimelineSequence'>(0),
      limit: 1000,
    });
    expect(events.find((event) => event.type === 'REQUEST_FAILED')?.inlinePayload).toMatchObject({
      code: 'MODEL_PROVIDER_ERROR',
      category: 'UNAVAILABLE',
    });
  });

  it('falls back to safe failure text when failed output only contains whitespace', async () => {
    const gateway = createTestGatewayStores();
    const sessionId = brand<string, 'SessionId'>('session-terminal-failed-whitespace');
    await gateway.sessions.saveSession({
      tenantId: identityContext.tenantId,
      subjectId: identityContext.subjectId,
      agentId,
      sessionId,
      createdAt: brand<number, 'EpochMillis'>(1),
      updatedAt: brand<number, 'EpochMillis'>(1),
    });
    const runtime = createRequestLifecycleCoordinator({
      agentConstructors: [
        createTestAgentConstructor(async ({ runState }, run, context) => {
          await runState.emitEvent(run, context, {
            type: 'LLM_CONTENT_DELTA',
            inlinePayload: { content: '\n\n\n' },
          });
          await runState.emitEvent(run, context, {
            type: 'DEGRADATION_NOTICE',
            inlinePayload: { code: 'MODEL_TIMEOUT', category: 'TIMEOUT' },
          });
          throw new AgentError({
            code: 'MODEL_TIMEOUT',
            message: 'Model invocation timed out.',
            category: 'TIMEOUT',
            retryable: true,
          });
        }),
      ],
      agentRuntimeDependencies: {},
      assemblyRegistry: createDefaultAgentTestAssemblyRegistry('deterministic-test-model'),
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
      identityContext,
      inputText: 'terminal failed with whitespace',
      attachmentIds: [],
      locale: brand<string, 'RequestLocale'>('zh-CN'),
      idempotencyKey: brand<string, 'IdempotencyKey'>('idem-terminal-failed-whitespace'),
    });

    await waitFor(async () => {
      const run = await gateway.requestRuns.loadRun({
        tenantId: identityContext.tenantId,
        subjectId: identityContext.subjectId,
        agentId,
        runId: accepted.runId,
      });
      return run?.status === 'FAILED' && run.terminalCommitState === 'COMMITTED';
    });
    const messages = await gateway.messages.listCurrentRequestMessages({
      tenantId: identityContext.tenantId,
      subjectId: identityContext.subjectId,
      agentId,
      sessionId,
      requestId: accepted.requestId,
      runId: accepted.runId,
      includeHidden: false,
      offset: 0,
      limit: 10,
    });
    expect(messages.items.at(-1)?.content).toBe('Request failed: Model invocation timed out.');
    expect(messages.items.at(-1)?.metadata).toMatchObject({
      eventType: 'REQUEST_FAILED',
      status: 'FAILED',
      code: 'MODEL_TIMEOUT',
      category: 'TIMEOUT',
    });

    const events = await gateway.timeline.listEvents({
      tenantId: identityContext.tenantId,
      subjectId: identityContext.subjectId,
      agentId,
      sessionId,
      afterSequence: brand<number, 'TimelineSequence'>(0),
      limit: 1000,
    });
    const failedEventPayload = events.find((event) => event.type === 'REQUEST_FAILED')?.inlinePayload;
    expect(failedEventPayload).toMatchObject({
      terminalMessageId: messages.items.at(-1)?.messageId,
      code: 'MODEL_TIMEOUT',
      category: 'TIMEOUT',
    });
    expect(failedEventPayload).not.toHaveProperty('content');
  });

  it('does not carry live-only failure diagnostics onto failed terminal history', async () => {
    const gateway = createTestGatewayStores();
    const sessionId = brand<string, 'SessionId'>('session-terminal-live-only-reason');
    await gateway.sessions.saveSession({
      tenantId: identityContext.tenantId,
      subjectId: identityContext.subjectId,
      agentId,
      sessionId,
      createdAt: brand<number, 'EpochMillis'>(1),
      updatedAt: brand<number, 'EpochMillis'>(1),
    });
    const runtime = createRequestLifecycleCoordinator({
      agentConstructors: [
        createTestAgentConstructor(async ({ runState }, run, context) => {
          await runState.emitEvent(run, context, {
            type: 'DEGRADATION_NOTICE',
            inlinePayload: { code: 'LIVE_ONLY_DIAGNOSTIC', category: 'UNAVAILABLE' },
          });
          throw new Error('Live-only diagnostic should not become history metadata.');
        }),
      ],
      agentRuntimeDependencies: {},
      assemblyRegistry: createDefaultAgentTestAssemblyRegistry('deterministic-test-model'),
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
      runTimelineEventPersistencePolicy: (event) => (event.type === 'DEGRADATION_NOTICE' ? 'LIVE_ONLY' : 'PERSISTED'),
    });

    const accepted = await runtime.submit({
      sessionId,
      identityContext,
      inputText: 'terminal failed with live-only reason',
      attachmentIds: [],
      locale: brand<string, 'RequestLocale'>('zh-CN'),
      idempotencyKey: brand<string, 'IdempotencyKey'>('idem-terminal-live-only-reason'),
    });

    await waitFor(async () => {
      const run = await gateway.requestRuns.loadRun({
        tenantId: identityContext.tenantId,
        subjectId: identityContext.subjectId,
        agentId,
        runId: accepted.runId,
      });
      return run?.status === 'FAILED' && run.terminalCommitState === 'COMMITTED';
    });
    const messages = await gateway.messages.listCurrentRequestMessages({
      tenantId: identityContext.tenantId,
      subjectId: identityContext.subjectId,
      agentId,
      sessionId,
      requestId: accepted.requestId,
      runId: accepted.runId,
      includeHidden: false,
      offset: 0,
      limit: 10,
    });
    expect(messages.items.at(-1)?.metadata).toMatchObject({
      eventType: 'REQUEST_FAILED',
      status: 'FAILED',
    });
    expect(messages.items.at(-1)?.metadata).not.toMatchObject({
      code: 'LIVE_ONLY_DIAGNOSTIC',
    });

    const events = await gateway.timeline.listEvents({
      tenantId: identityContext.tenantId,
      subjectId: identityContext.subjectId,
      agentId,
      sessionId,
      afterSequence: brand<number, 'TimelineSequence'>(0),
      limit: 1000,
    });
    expect(events.map((event) => event.type)).not.toContain('DEGRADATION_NOTICE');
    expect(events.find((event) => event.type === 'REQUEST_FAILED')?.inlinePayload).not.toMatchObject({
      code: 'LIVE_ONLY_DIAGNOSTIC',
    });
  });

  it('persists completed terminal status metadata on the assistant history message', async () => {
    const gateway = createTestGatewayStores();
    const sessionId = brand<string, 'SessionId'>('session-terminal-completed');
    await gateway.sessions.saveSession({
      tenantId: identityContext.tenantId,
      subjectId: identityContext.subjectId,
      agentId,
      sessionId,
      createdAt: brand<number, 'EpochMillis'>(1),
      updatedAt: brand<number, 'EpochMillis'>(1),
    });
    const runtime = createRequestLifecycleCoordinator({
      agentConstructors: [
        createTestAgentConstructor(async ({ runState }, run, context) => {
          await runState.emitEvent(run, context, { type: 'LLM_CONTENT_DELTA', inlinePayload: { final: true, content: 'completed answer' } });
        }),
      ],
      agentRuntimeDependencies: {},
      assemblyRegistry: createDefaultAgentTestAssemblyRegistry('deterministic-test-model'),
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
      identityContext,
      inputText: 'terminal completed',
      attachmentIds: [],
      locale: brand<string, 'RequestLocale'>('zh-CN'),
      idempotencyKey: brand<string, 'IdempotencyKey'>('idem-terminal-completed'),
    });

    await waitFor(async () => {
      const run = await gateway.requestRuns.loadRun({
        tenantId: identityContext.tenantId,
        subjectId: identityContext.subjectId,
        agentId,
        runId: accepted.runId,
      });
      return run?.status === 'COMPLETED' && run.terminalCommitState === 'COMMITTED';
    });
    const messages = await gateway.messages.listCurrentRequestMessages({
      tenantId: identityContext.tenantId,
      subjectId: identityContext.subjectId,
      agentId,
      sessionId,
      requestId: accepted.requestId,
      runId: accepted.runId,
      includeHidden: false,
      offset: 0,
      limit: 10,
    });
    expect(messages.items.map((item) => item.role)).toEqual(['USER', 'ASSISTANT']);
    expect(messages.items.at(-1)?.content).toBe('completed answer');
    expect(messages.items.at(-1)?.metadata).toMatchObject({
      eventType: 'REQUEST_COMPLETED',
      status: 'COMPLETED',
    });
  });
});
