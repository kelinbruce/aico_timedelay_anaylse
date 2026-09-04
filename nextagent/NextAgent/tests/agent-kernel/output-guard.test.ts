import { createDefaultAgentTestAssemblyRegistry, createNextAgentTestApp } from '@nextagent/agent-platform-gateway-local/testing';
import {
  createLocalGatewayProvider,
  createSqliteLongTermMemoryGatewayProvider,
  createSqliteWorkingMemoryGatewayProvider,
} from '@nextagent/agent-platform-gateway-local';
import { createStaticCapabilityCatalog, readCapabilityId } from '@nextagent/agent-capability';
import { brand, type SessionId, type TimelineEventType } from '@nextagent/agent-common';
import type { GatewayProvider, RequestRunStoreGateway } from '@nextagent/agent-contracts/gateway';
import { createDefaultContextEngine } from '@nextagent/agent-context-engine';
import { DefaultAgent } from '@nextagent/agent-core';
import { createDeterministicModelInvocationService } from '@nextagent/agent-model/testing';
import { createTestGatewayStores } from '../fixtures/local-gateway.js';
import { createTestAgentConstructor } from '../fixtures/test-agent.js';
import { readDescriptor } from '../fixtures/capability.js';
import { createRequestLifecycleCoordinator, maxTerminalMessageChars } from '@nextagent/agent-runtime';
import { createUserSessionService } from '@nextagent/agent-session';
import { describe, expect, it } from 'vitest';
import { createTestModelSelectionService } from '../../packages/agent-context-engine/tests/test-model-selection-helpers.js';

const identityContext = {
  tenantId: brand<string, 'TenantId'>('tenant-output'),
  subjectId: brand<string, 'SubjectId'>('subject-output'),
  displayName: 'Output tester',
};
const agentId = brand<string, 'AgentId'>('default-agent');

describe('output guard behavior', () => {
  it('fails safely when the model stops with empty final assistant content', async () => {
    const app = createNextAgentTestApp({
      workspaceDir: process.cwd(),
      modelSteps: [{ content: '' }],
    });

    const accepted = await app.server.inject({
      method: 'POST',
      url: '/api/v1/requests',
      payload: { inputText: 'produce empty output', idempotencyKey: 'idem-output-empty-model' },
    });
    const body = accepted.json<{ sessionId: string; runId: string }>();
    const stream = await app.server.inject({
      method: 'GET',
      url: `/api/v1/sessions/${body.sessionId}/stream?lastSeenSequence=0&runId=${body.runId}`,
    });
    // Either guard (pre-break fallback or terminal commit) may catch empty output.
    expect(stream.body).toMatch(/MODEL_EMPTY_OUTPUT|MODEL_FINAL_CONTENT_EMPTY/);
    expect(stream.body).toContain('event: REQUEST_FAILED');
    expect(stream.body).not.toContain('event: REQUEST_COMPLETED');

    const history = await app.server.inject({ method: 'GET', url: `/api/v1/sessions/${body.sessionId}/conversation?limit=10` });
    expect(history.body).toContain('Request failed: Model');
  });

  it('commits a bounded marked prefix when model output exceeds the visible stream/history limit', async () => {
    const oversized = `RETAINED_MODEL_PREFIX-${'x'.repeat(50_000)}-DISCARDED_MODEL_TAIL`;
    const app = createNextAgentTestApp({
      workspaceDir: process.cwd(),
      modelSteps: [{ content: oversized }],
      gatewayProviders: createMessageLimitedGatewayProviders(),
    });

    const accepted = await app.server.inject({
      method: 'POST',
      url: '/api/v1/requests',
      payload: { inputText: 'produce oversized output', idempotencyKey: 'idem-output-model' },
    });
    const body = accepted.json<{ sessionId: string; runId: string }>();
    const stream = await app.server.inject({
      method: 'GET',
      url: `/api/v1/sessions/${body.sessionId}/stream?lastSeenSequence=0&runId=${body.runId}`,
    });
    expect(stream.body).toContain('MODEL_TEXT_LIMIT_EXCEEDED');
    expect(stream.body).toContain('event: REQUEST_COMPLETED');
    expect(stream.body).not.toContain('event: REQUEST_FAILED');
    expect(stream.body).toContain('RETAINED_MODEL_PREFIX');
    expect(stream.body).toContain('[Model output truncated at the 50000-character safety limit.]');
    expect(stream.body).not.toContain('DISCARDED_MODEL_TAIL');

    const history = await app.server.inject({ method: 'GET', url: `/api/v1/sessions/${body.sessionId}/conversation?limit=10` });
    expect(history.body).toContain('RETAINED_MODEL_PREFIX');
    expect(history.body).toContain('[Model output truncated at the 50000-character safety limit.]');
    expect(history.body).not.toContain('DISCARDED_MODEL_TAIL');
  });

  it('fails safely when final model output ends inside an incomplete markdown table', async () => {
    const partialTable = '\n\n| 项目 | 说明 |\n|-----|------|\n| **1. 网元类型** | 您需要哪类网元的KPI报告？例如';
    const app = createNextAgentTestApp({
      workspaceDir: process.cwd(),
      modelSteps: [{ content: partialTable }],
    });

    const accepted = await app.server.inject({
      method: 'POST',
      url: '/api/v1/requests',
      payload: { inputText: 'produce incomplete markdown', idempotencyKey: 'idem-output-incomplete-markdown' },
    });
    const body = accepted.json<{ sessionId: string; runId: string }>();
    const stream = await app.server.inject({
      method: 'GET',
      url: `/api/v1/sessions/${body.sessionId}/stream?lastSeenSequence=0&runId=${body.runId}`,
    });
    expect(stream.body).toContain('event: REQUEST_FAILED');
    expect(stream.body).not.toContain('event: REQUEST_COMPLETED');

    const history = await app.server.inject({ method: 'GET', url: `/api/v1/sessions/${body.sessionId}/conversation?limit=10` });
    expect(history.body).toContain('Request failed: Model output ended in an incomplete final structure.');
  });

  it('fails safely when unguarded terminal assistant content bypasses the model producer limit', async () => {
    const gateway = createTestGatewayStores();
    const sessionId = brand<string, 'SessionId'>('session-output-terminal');
    const oversized = 'RAW_TERMINAL_OUTPUT_SHOULD_NOT_LEAK'.repeat(5000);
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
          await runState.emitEvent(run, context, { type: 'LLM_CONTENT_DELTA', inlinePayload: { final: true, content: oversized } });
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
      inputText: 'terminal oversized',
      attachmentIds: [],
      locale: brand<string, 'RequestLocale'>('zh-CN'),
      idempotencyKey: brand<string, 'IdempotencyKey'>('idem-output-terminal'),
    });
    const events = await waitForTimelineTypes(gateway, sessionId, ['DEGRADATION_NOTICE', 'REQUEST_FAILED']);
    expect(JSON.stringify(events)).not.toContain('RAW_TERMINAL_OUTPUT_SHOULD_NOT_LEAK');

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
    expect(messages.items.at(-1)?.content).toBe('Request failed safely: TERMINAL_MESSAGE_LIMIT_EXCEEDED');
    expect(messages.items.at(-1)?.metadata).toMatchObject({
      eventType: 'REQUEST_FAILED',
      status: 'FAILED',
      code: 'TERMINAL_MESSAGE_LIMIT_EXCEEDED',
    });
  });

  it('treats LLM content deltas as accumulated snapshots for terminal output guard', async () => {
    const gateway = createTestGatewayStores();
    const sessionId = brand<string, 'SessionId'>('session-output-accumulated-snapshots');
    const finalSnapshot = 'network diagnosis '.repeat(2500);
    const snapshots = Array.from({ length: 6 }, (_, index) => finalSnapshot.slice(0, Math.ceil((finalSnapshot.length * (index + 1)) / 6)));
    expect(finalSnapshot.length).toBeLessThan(maxTerminalMessageChars);
    expect(snapshots.reduce((total, snapshot) => total + snapshot.length, 0)).toBeGreaterThan(maxTerminalMessageChars);

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
          for (const snapshot of snapshots) {
            await runState.emitEvent(run, context, { type: 'LLM_CONTENT_DELTA', inlinePayload: { content: snapshot } });
          }
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
      inputText: 'terminal accumulated snapshots',
      attachmentIds: [],
      locale: brand<string, 'RequestLocale'>('zh-CN'),
      idempotencyKey: brand<string, 'IdempotencyKey'>('idem-output-accumulated-snapshots'),
    });
    const events = await waitForTimelineTypes(gateway, sessionId, ['REQUEST_COMPLETED']);
    expect(
      events.filter((event) => event.type === 'DEGRADATION_NOTICE' && event.inlinePayload.code === 'TERMINAL_MESSAGE_LIMIT_EXCEEDED'),
    ).toHaveLength(0);
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
    expect(messages.items.at(-1)?.content).toBe(finalSnapshot);
    expect(events.find((event) => event.type === 'REQUEST_COMPLETED')?.inlinePayload).toMatchObject({
      terminalMessageId: messages.items.at(-1)?.messageId,
    });
    expect(events.find((event) => event.type === 'REQUEST_COMPLETED')?.inlinePayload).not.toHaveProperty('content');
  });

  it('emits terminal message limit degradation only once after oversized accumulated content', async () => {
    const gateway = createTestGatewayStores();
    const sessionId = brand<string, 'SessionId'>('session-output-terminal-single-notice');
    const oversized = 'RAW_TERMINAL_OUTPUT_SHOULD_NOT_LEAK'.repeat(5000);
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
          await runState.emitEvent(run, context, { type: 'LLM_CONTENT_DELTA', inlinePayload: { content: oversized } });
          await runState.emitEvent(run, context, { type: 'LLM_CONTENT_DELTA', inlinePayload: { content: 'normal content after limit' } });
          await runState.emitEvent(run, context, { type: 'LLM_CONTENT_DELTA', inlinePayload: { final: true, content: 'final content after limit' } });
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
      inputText: 'terminal oversized repeated',
      attachmentIds: [],
      locale: brand<string, 'RequestLocale'>('zh-CN'),
      idempotencyKey: brand<string, 'IdempotencyKey'>('idem-output-terminal-single-notice'),
    });
    const events = await waitForTimelineTypes(gateway, sessionId, ['DEGRADATION_NOTICE', 'REQUEST_FAILED']);
    const terminalLimitNotices = events.filter(
      (event) => event.type === 'DEGRADATION_NOTICE' && event.inlinePayload.code === 'TERMINAL_MESSAGE_LIMIT_EXCEEDED',
    );
    expect(terminalLimitNotices).toHaveLength(1);
    expect(JSON.stringify(events)).not.toContain('RAW_TERMINAL_OUTPUT_SHOULD_NOT_LEAK');
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
    expect(messages.items.at(-1)?.content).toBe('Request failed safely: TERMINAL_MESSAGE_LIMIT_EXCEEDED');
    expect(events.find((event) => event.type === 'REQUEST_FAILED')?.inlinePayload).toMatchObject({
      terminalMessageId: messages.items.at(-1)?.messageId,
    });
    expect(events.find((event) => event.type === 'REQUEST_FAILED')?.inlinePayload).not.toHaveProperty('content');
    expect(JSON.stringify(messages.items)).not.toContain('RAW_TERMINAL_OUTPUT_SHOULD_NOT_LEAK');
  });

  it('runtime converts empty completed terminal content to a safe failure', async () => {
    const gateway = createTestGatewayStores();
    const sessionId = brand<string, 'SessionId'>('session-output-runtime-empty');
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
          await runState.emitEvent(run, context, { type: 'LLM_CONTENT_DELTA', inlinePayload: { final: true, content: '   ' } });
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
      inputText: 'terminal empty backstop',
      attachmentIds: [],
      locale: brand<string, 'RequestLocale'>('zh-CN'),
      idempotencyKey: brand<string, 'IdempotencyKey'>('idem-output-runtime-empty'),
    });
    const events = await waitForTimelineTypes(gateway, sessionId, ['DEGRADATION_NOTICE', 'REQUEST_FAILED']);
    expect(events.find((event) => event.type === 'DEGRADATION_NOTICE')?.inlinePayload.code).toBe('MODEL_FINAL_CONTENT_EMPTY');
    expect(events.map((event) => event.type)).not.toContain('REQUEST_COMPLETED');

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
    expect(messages.items.at(-1)?.content).toBe('Request failed safely: MODEL_FINAL_CONTENT_EMPTY');
    expect(events.find((event) => event.type === 'REQUEST_FAILED')?.inlinePayload).toMatchObject({
      terminalMessageId: messages.items.at(-1)?.messageId,
    });
    expect(events.find((event) => event.type === 'REQUEST_FAILED')?.inlinePayload).not.toHaveProperty('content');
    expect(messages.items.at(-1)?.metadata).toMatchObject({
      eventType: 'REQUEST_FAILED',
      status: 'FAILED',
      code: 'MODEL_FINAL_CONTENT_EMPTY',
    });
  });

  it('consumes a boundary-rejected capacity-limit failure safely without leaking the oversized result', async () => {
    const gateway = createTestGatewayStores();
    const sessionId = brand<string, 'SessionId'>('session-output-capability');
    const requestId = brand<string, 'MessageId'>('request-output-capability');
    const runId = brand<string, 'RequestRunId'>('run-output-capability');
    const requestContextId = brand<string, 'RequestContextId'>('context-output-capability');
    const oversized = 'RAW_CAPABILITY_RESULT_SHOULD_NOT_LEAK'.repeat(8000);
    await gateway.messages.appendSessionMessage({
      tenantId: identityContext.tenantId,
      subjectId: identityContext.subjectId,
      agentId,
      messageId: requestId,
      sessionId,
      requestId,
      runId,
      role: 'USER',
      content: 'oversized capability',
      contentType: 'PLAIN_TEXT',
      metadata: {},
      visible: true,
      createdAt: brand<number, 'EpochMillis'>(1),
    });
    const assemblyRegistry = createDefaultAgentTestAssemblyRegistry('deterministic-test-model');
    const catalog = createStaticCapabilityCatalog([readDescriptor()]);
    const events: unknown[] = [];
    const appended: unknown[] = [];
    const agent = new DefaultAgent({
      contextEngine: createDefaultContextEngine({
        activeContextStore: gateway.activeContext,
        messageStore: gateway.messages,
        assemblyRegistry,
        capabilityCatalog: catalog,
        modelSelectionService: createTestModelSelectionService({ modelId: 'deterministic' }),
      }),
      model: createDeterministicModelInvocationService([
        { toolCalls: [{ toolCallId: 'tool-huge', toolName: 'Read', arguments: { file_path: 'package.json' } }] },
        { content: 'The capability result could not be delivered safely, so the operation was stopped.' },
      ]),
      capabilityCatalog: catalog,
      capabilityInvocation: {
        async invoke() {
          return {
            status: 'FAILED',
            structuredPayload: {},
            generatedMessages: [],
            artifactRefs: [],
            safeError: {
              code: 'CAPABILITY_RESULT_LIMIT_EXCEEDED',
              message: 'Capability result exceeded the safe capacity. Reduce the request or result size and call again.',
              category: 'VALIDATION',
              retryable: false,
            },
          };
        },
      },
      assemblyRegistry,
      runState: {
        async setCapabilityTerminalAnswer(): Promise<void> {},
        async emitEvent(_run, _context, event) {
          events.push(event);
        },
        async appendMessage(_run, _context, draft) {
          appended.push(draft);
          return brand<string, 'MessageId'>('message-output-guard');
        },
        async saveCheckpoint() {},
        async requestPendingInput() {
          throw new Error('not used');
        },
      },
    });

    await expect(
      agent.execute(
        {
          runId,
          sessionId,
          requestId,
          agentId: brand<string, 'AgentId'>('default-agent'),
          agentVersion: brand<string, 'AgentVersion'>('v1'),
          agentAssemblyRef: 'default-agent:v1',
          attempt: 1,
          status: 'EXECUTING',
          version: 1,
          terminalCommitState: 'NOT_STARTED',
          createdAt: brand<number, 'EpochMillis'>(1),
          updatedAt: brand<number, 'EpochMillis'>(1),
        },
        {
          requestContextId,
          sessionId,
          requestId,
          runId,
          agentTurnIndex: 0,
          identityContext,
          locale: brand<string, 'RequestLocale'>('zh-CN'),
          agentId: brand<string, 'AgentId'>('default-agent'),
          agentVersion: brand<string, 'AgentVersion'>('v1'),
          agentAssemblyRef: 'default-agent:v1',
          nextLifecycleStage: 'BEFORE_MODEL_INVOKE',
          toolCallStates: [{ toolCallId: 'tool-huge', capabilityId: readCapabilityId, arguments: {}, status: 'PENDING' }],
          flowVariables: {},
        },
        new AbortController().signal,
      ),
    ).resolves.toMatchObject({ status: 'COMPLETED' });

    expect(JSON.stringify(events)).toContain('CAPABILITY_RESULT_LIMIT_EXCEEDED');
    expect(JSON.stringify(events)).not.toContain('CAPABILITY_REPEATED_FAILURE');
    expect(JSON.stringify(appended)).toContain('CAPABILITY_RESULT_LIMIT_EXCEEDED');
    expect(JSON.stringify(appended)).not.toContain(oversized);
    expect(JSON.stringify(events)).not.toContain(oversized);
  });
});

function createMessageLimitedGatewayProviders(): readonly GatewayProvider[] {
  const workingMemoryProvider = createSqliteWorkingMemoryGatewayProvider();
  const rejectingProvider: GatewayProvider = {
    ...workingMemoryProvider,
    create(input) {
      const bindings = workingMemoryProvider.create(input);
      const workingMemory = bindings.workingMemory;
      if (workingMemory === undefined) {
        return bindings;
      }
      return {
        ...bindings,
        workingMemory: {
          ...workingMemory,
          requestRuns: rejectOversizedTerminalMessages(workingMemory.requestRuns),
        },
      };
    },
  };
  return [rejectingProvider, createSqliteLongTermMemoryGatewayProvider(), createLocalGatewayProvider()];
}

function rejectOversizedTerminalMessages(delegate: RequestRunStoreGateway): RequestRunStoreGateway {
  return {
    saveRun: delegate.saveRun.bind(delegate),
    loadRun: delegate.loadRun.bind(delegate),
    listRuns: delegate.listRuns.bind(delegate),
    loadSessionLaneSnapshot: delegate.loadSessionLaneSnapshot.bind(delegate),
    loadRunByIdempotencyKey: delegate.loadRunByIdempotencyKey.bind(delegate),
    claimRun: delegate.claimRun.bind(delegate),
    listRecoverableRuns: delegate.listRecoverableRuns.bind(delegate),
    commitTerminal: async (request) => {
      if (request.terminalMessage.content.length > maxTerminalMessageChars) {
        throw new Error('Message-limited provider rejected oversized terminal content.');
      }
      return delegate.commitTerminal(request);
    },
  };
}

async function waitForTimelineTypes(
  gateway: ReturnType<typeof createTestGatewayStores>,
  sessionId: SessionId,
  expectedTypes: readonly TimelineEventType[],
) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const events = await gateway.timeline.listEvents({
      tenantId: identityContext.tenantId,
      subjectId: identityContext.subjectId,
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
    tenantId: identityContext.tenantId,
    subjectId: identityContext.subjectId,
    agentId,
    sessionId,
    afterSequence: brand<number, 'TimelineSequence'>(0),
    limit: 1000,
  });
}
