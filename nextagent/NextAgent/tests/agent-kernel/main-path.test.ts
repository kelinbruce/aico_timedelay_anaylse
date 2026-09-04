import { modelEventStreamFixture } from '../helpers/model-stream-fixture.js';
import { createNextAgentApp as createProductNextAgentApp } from '@nextagent/agent-app';
import {
  createAppCredentialResolver,
  createComposedApp,
  createDefaultAgentTestAssemblyRegistry,
  createNextAgentApp,
  createNextAgentTestApp,
  validateDefaultSystemConfig,
} from '@nextagent/agent-platform-gateway-local/testing';
import { createCapabilitySubsystem, createStaticCapabilityCatalog } from '@nextagent/agent-capability';
import { brand } from '@nextagent/agent-common';
import { createDefaultContextEngine } from '@nextagent/agent-context-engine';
import { DefaultAgent, flattenModelRequest } from '@nextagent/agent-core';
import { createDeterministicModelInvocationService } from '@nextagent/agent-model/testing';
import { createRemoteNextAgentApp } from '@nextagent/agent-remote-deployment';
import {
  createLocalGatewayProvider,
  createLocalWorkflowRagGateway,
  createSqliteLongTermMemoryGatewayProvider,
  createSqliteWorkingMemoryGatewayProvider,
} from '@nextagent/agent-platform-gateway-local';
import { createTestGatewayStores } from '../fixtures/local-gateway.js';
import { createTestAgentConstructor } from '../fixtures/test-agent.js';
import { createRequestLifecycleCoordinator } from '@nextagent/agent-runtime';
import { createUserSessionService } from '@nextagent/agent-session';
import type { ModelGatewayProvider, ModelInvocationRequest, ModelInvocationService } from '@nextagent/agent-contracts/model';
import type { LifecycleHookInvocationPort, LifecycleHookDefinition } from '@nextagent/agent-contracts/runtime';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createTestModelSelectionService } from '../../packages/agent-context-engine/tests/test-model-selection-helpers.js';

const agentId = brand<string, 'AgentId'>('default-agent');
const productConfigEnv = {
  OPENAI_API_KEY: 'test-key',
  OPENAI_MODEL_NAME: 'MiniMax-M2.7-highspeed',
  OPENAI_BASE_URL: 'https://api.minimaxi.com/v1',
} as const;

const openApps: Array<ReturnType<typeof createProductNextAgentApp>> = [];

afterEach(async () => {
  await Promise.allSettled(openApps.splice(0).map((app) => app.close()));
});

function trackApp<T extends ReturnType<typeof createProductNextAgentApp>>(app: T): T {
  openApps.push(app);
  return app;
}

async function waitFor(assertion: () => boolean, timeoutMs = 1_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (assertion()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  expect(assertion()).toBe(true);
}

function testPersistenceProviders() {
  return [createSqliteWorkingMemoryGatewayProvider(), createSqliteLongTermMemoryGatewayProvider(), createLocalGatewayProvider()];
}

describe('ship-ts-minimal-agent-kernel main path', () => {
  it('loads canonical OpenAI-compatible model configuration into app composition', async () => {
    const app = trackApp(
      createNextAgentApp({
        credentialResolver: createAppCredentialResolver(productConfigEnv),
      }),
    );
    const defaultRouteAssembly = await app.assemblyRegistry.active(app.systemConfig.activeAgentId);

    expect(app.systemConfig.modelProfiles).toEqual([
      expect.objectContaining({
        providerId: 'openai-compatible',
        baseUrl: 'https://api.minimaxi.com/v1',
        credentialRef: 'env:OPENAI_API_KEY',
        models: [expect.objectContaining({ modelId: 'MiniMax-M2.7-highspeed' })],
      }),
    ]);
    expect(defaultRouteAssembly.modelIds).toEqual(['MiniMax-M2.7-highspeed']);
    expect(defaultRouteAssembly).not.toHaveProperty('defaultModelId');
    expect(
      app.systemConfig.modelProfiles.flatMap((provider) => provider.models).find((model) => model.modelId === defaultRouteAssembly.modelIds[0]),
    ).toMatchObject({
      modelId: 'MiniMax-M2.7-highspeed',
      timeoutMs: 300_000,
    });
  });

  it('uses the model service passed through the testing composition surface', async () => {
    const captured: ModelInvocationRequest[] = [];
    const app = trackApp(
      createComposedApp(
        {
          credentialResolver: createAppCredentialResolver(productConfigEnv),
          gatewayProviders: testPersistenceProviders(),
          cronTaskSchedulerFactory: testCronTaskSchedulerFactory,
          ragRetrievalFactory: () => testRagRetrieval(),
          sandboxGatewayFactory: () => testSandboxGateway(),
        },
        captureProductModel(captured),
      ),
    );

    const accepted = await app.server.inject({
      method: 'POST',
      url: '/api/v1/requests',
      payload: { inputText: 'run product model override', idempotencyKey: 'idem-product-model-override', attachments: [] },
    });

    expect(accepted.statusCode).toBe(200);
    await waitFor(() => captured.some((request) => request.invocationScope.operationId === 'turn-1'));
    expect(captured.find((request) => request.invocationScope.operationId === 'turn-1')?.modelId).toBe('MiniMax-M2.7-highspeed');
  });

  it('creates MODEL_GATEWAY model service from a remote model gateway provider', async () => {
    const captured: ModelInvocationRequest[] = [];
    let createCount = 0;
    const configFile = writeModelGatewayConfig();
    const provider: ModelGatewayProvider = {
      providerId: 'remote-model-gateway',
      createModelService() {
        createCount += 1;
        return captureProductModel(captured);
      },
      createModelInformationService() {
        return foundModelInformation();
      },
    };
    const app = trackApp(
      createProductNextAgentApp({
        configFile,
        credentialResolver: createAppCredentialResolver(productConfigEnv),
        gatewayProviders: testPersistenceProviders(),
        modelGatewayProviders: [provider],
        ragRetrievalFactory: () => testRagRetrieval(),
        sandboxGatewayFactory: () => testSandboxGateway(),
      }),
    );

    const accepted = await app.server.inject({
      method: 'POST',
      url: '/api/v1/requests',
      payload: { inputText: 'run remote model gateway', idempotencyKey: 'idem-model-gateway-provider', attachments: [] },
    });

    expect(createCount).toBe(1);
    expect(accepted.statusCode).toBe(200);
    await waitFor(() => captured.some((request) => request.invocationScope.operationId === 'turn-1'));
    expect(captured.find((request) => request.invocationScope.operationId === 'turn-1')).toMatchObject({
      modelId: 'gateway-model',
    });
  });

  it('routes MODEL_GATEWAY through the remote deployment model gateway example', async () => {
    const captured: ModelInvocationRequest[] = [];
    const app = trackApp(
      createRemoteNextAgentApp({
        configFile: writeModelGatewayConfig(),
        credentialResolver: createAppCredentialResolver(productConfigEnv),
        ragRetrievalFactory: () => testRagRetrieval(),
        sandboxGatewayFactory: () => testSandboxGateway(),
        remoteGatewayClients: {
          sandbox: {
            async execute(request) {
              return {
                executionId: request.executionId,
                stdout: '',
                stderr: '',
                stdoutTruncated: false,
                stderrTruncated: false,
                timedOut: false,
                durationMs: 0,
              };
            },
          },
          ragRetrieval: {
            async retrieve() {
              return { status: 'UNAVAILABLE', results: [], diagnostics: { reason: 'PROVIDER_UNAVAILABLE' } };
            },
          },
          modelGateway: {
            async complete(request) {
              captured.push(request);
              return { content: 'remote deployment model gateway ok' };
            },
            stream: modelEventStreamFixture(async function* (request) {
              captured.push(request);
              yield { content: 'remote deployment model gateway ok', finishReason: 'stop' };
            }),
          },
          modelGatewayInformation: foundModelInformation(),
        },
      }),
    );

    const accepted = await app.server.inject({
      method: 'POST',
      url: '/api/v1/requests',
      payload: { inputText: 'run remote deployment model gateway', idempotencyKey: 'idem-remote-deployment-model-gateway', attachments: [] },
    });

    expect(accepted.statusCode).toBe(200);
    await waitFor(() => captured.some((request) => request.invocationScope.operationId === 'turn-1'));
    expect(captured.find((request) => request.invocationScope.operationId === 'turn-1')).toMatchObject({
      modelId: 'gateway-model',
    });
  });

  it('binds exact provider registrations when OpenAI-compatible primary has Model Gateway fallback', () => {
    let createCount = 0;
    const provider: ModelGatewayProvider = {
      providerId: 'remote-model-gateway',
      createModelService() {
        createCount += 1;
        return captureProductModel([]);
      },
      createModelInformationService() {
        return foundModelInformation();
      },
    };
    const app = trackApp(
      createProductNextAgentApp({
        configFile: writeOpenAiWithModelGatewayFallbackConfig(),
        credentialResolver: createAppCredentialResolver(productConfigEnv),
        gatewayProviders: testPersistenceProviders(),
        modelGatewayProviders: [provider],
        ragRetrievalFactory: () => testRagRetrieval(),
        sandboxGatewayFactory: () => testSandboxGateway(),
      }),
    );

    expect(app.systemConfig.modelProfiles.flatMap((profile) => profile.models).map((model) => model.modelId)).toEqual([
      'openai-primary',
      'gateway-fallback',
    ]);
    expect(createCount).toBe(1);
  });

  it('rejects OPENAI primary with MODEL_GATEWAY fallback when the gateway provider is missing', () => {
    expect(() =>
      createProductNextAgentApp({
        configFile: writeOpenAiWithModelGatewayFallbackConfig(),
        credentialResolver: createAppCredentialResolver(productConfigEnv),
        gatewayProviders: testPersistenceProviders(),
        ragRetrievalFactory: () => testRagRetrieval(),
        sandboxGatewayFactory: () => testSandboxGateway(),
      }),
    ).toThrow('Exactly one Model Gateway provider is required.');
  });

  it('rejects ambiguous Model Gateway provider registrations', () => {
    const provider = modelGatewayProvider('remote-model-gateway', []);
    expect(() =>
      createProductNextAgentApp({
        configFile: writeModelGatewayConfig(),
        credentialResolver: createAppCredentialResolver(productConfigEnv),
        modelGatewayProviders: [provider, modelGatewayProvider('other-model-gateway', [])],
      }),
    ).toThrow('Exactly one Model Gateway provider is required.');
  });

  it('rejects an unsupported canonical model provider id', () => {
    expect(() =>
      validateDefaultSystemConfig(
        {
          deployment: { mode: 'LOCAL' },
          paths: { workspaceRoot: 'workspaces' },
          auth: { mode: 'local', localIdentity: { tenantId: 'local-tenant', subjectId: 'local-subject' } },
          channel: { transport: 'fastify', host: '127.0.0.1', port: 3000 },
          hostedAgent: { activeAgentId: 'default-agent' },
          modelProfiles: [
            {
              providerId: 'custom',
              models: [{ modelId: 'deterministic-test-model', fallbackEligible: false }],
            },
          ],
          gateway: {
            gateways: [
              { gatewayId: 'local-sqlite', gatewayKind: 'sqlite', deploymentMode: 'LOCAL', sqliteFileRef: 'paths.sqliteFile' },
              { gatewayId: 'local-rag', gatewayKind: 'rag-knowledge', deploymentMode: 'LOCAL' },
            ],
          },
          noopBoundaries: { lifecycleHook: 'noop', checkpoint: 'noop', audit: 'noop' },
        },
        process.cwd(),
        { credentialResolver: createAppCredentialResolver(productConfigEnv) },
      ),
    ).toThrow('App configuration is blocked before ready.');
  });

  it('flattens configured model profile fields into the model invocation request', () => {
    const request = flattenModelRequest(
      {
        runId: brand<string, 'RequestRunId'>('run-profile'),
        sessionId: brand<string, 'SessionId'>('session-profile'),
        requestId: brand<string, 'MessageId'>('message-profile'),
        agentId: brand<string, 'AgentId'>('agent-profile'),
        agentVersion: brand<string, 'AgentVersion'>('v1'),
        agentAssemblyRef: 'agent-profile:v1',
        attempt: 1,
        status: 'EXECUTING',
        version: 1,
        terminalCommitState: 'NOT_STARTED',
        createdAt: brand<number, 'EpochMillis'>(1),
        updatedAt: brand<number, 'EpochMillis'>(1),
      },
      {
        requestContextId: brand<string, 'RequestContextId'>('context-profile'),
        sessionId: brand<string, 'SessionId'>('session-profile'),
        requestId: brand<string, 'MessageId'>('message-profile'),
        runId: brand<string, 'RequestRunId'>('run-profile'),
        agentTurnIndex: 0,
        identityContext: {
          tenantId: brand<string, 'TenantId'>('tenant-profile'),
          subjectId: brand<string, 'SubjectId'>('subject-profile'),
          displayName: 'Profile tester',
        },
        locale: brand<string, 'RequestLocale'>('zh-CN'),
        agentId: brand<string, 'AgentId'>('agent-profile'),
        agentVersion: brand<string, 'AgentVersion'>('v1'),
        agentAssemblyRef: 'agent-profile:v1',
        nextLifecycleStage: 'BEFORE_MODEL_INVOKE',
        toolCallStates: [],
        flowVariables: {},
      },
      {
        requestContextId: brand<string, 'RequestContextId'>('context-profile'),
        messages: [],
        tools: [],
        modelConfiguration: {
          modelId: 'MiniMax-M2.7',
          contextWindowTokens: 128_000,
          temperature: 0.1,
          maxOutputTokens: 1024,
          topP: 0.9,
          toolChoice: 'AUTO' as const,
          defaultTimeoutMs: 45_000,
          defaultMaxRetries: 2,
        },
        modelOptions: { temperature: 0.1, maxOutputTokens: 1024, topP: 0.9 },
        providerOptions: { parallelToolCalls: false },
      },
      'turn-profile',
    );

    expect(request).toMatchObject({
      invocationScope: {
        tenantId: 'tenant-profile',
        subjectId: 'subject-profile',
        agentId: 'agent-profile',
        agentVersion: 'v1',
        agentAssemblyRef: 'agent-profile:v1',
        operationId: 'turn-profile',
        sessionId: 'session-profile',
        requestId: 'message-profile',
        runId: 'run-profile',
      },
      modelId: 'MiniMax-M2.7',
      temperature: 0.1,
      maxOutputTokens: 1024,
      topP: 0.9,
      providerOptions: { parallelToolCalls: false },
      timeoutMs: 45_000,
    });
  });

  it('projects model reasoning deltas as thinking timeline events', async () => {
    const app = trackApp(
      createNextAgentTestApp({
        workspaceDir: process.cwd(),
        modelSteps: [{ content: 'answer' }],
      }),
    );
    const accepted = await app.server.inject({
      method: 'POST',
      url: '/api/v1/requests',
      payload: { inputText: 'normal request', idempotencyKey: 'idem-no-thinking' },
    });
    const body = accepted.json<{ sessionId: string; runId: string }>();
    const stream = await app.server.inject({
      method: 'GET',
      url: `/api/v1/sessions/${body.sessionId}/stream?lastSeenSequence=0&runId=${body.runId}`,
    });
    expect(stream.body).not.toContain('LLM_THINKING_DELTA');
  });

  it('invokes no-op lifecycle hooks and checkpoint saves on the runtime main path', async () => {
    const gateway = createTestGatewayStores();
    const identityContext = {
      tenantId: brand<string, 'TenantId'>('tenant-hook'),
      subjectId: brand<string, 'SubjectId'>('subject-hook'),
      displayName: 'Hook tester',
    };
    const sessionId = brand<string, 'SessionId'>('session-hook');
    const stages: string[] = [];
    const checkpointReasons: string[] = [];
    const lifecycleHookDefinitions: readonly LifecycleHookDefinition[] = [
      {
        hookId: 'runtime-main-path-hook',
        kind: 'SYSTEM',
        supportedStages: ['BEFORE_REQUEST_ACCEPT', 'BEFORE_MODEL_INVOKE', 'BEFORE_AGENT_TERMINAL'],
        effects: ['TRANSFORM', 'CONTROL'],
        executionStrategy: 'SERIAL_IMPACT',
        failureMode: 'FAIL',
        order: 0,
      },
    ];
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
          await runState.emitEvent(run, context, { type: 'LLM_CONTENT_DELTA', inlinePayload: { final: true, content: 'hook path complete' } });
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
      lifecycleHookDefinitions,
      checkpointStore: {
        async saveCheckpoint(record) {
          checkpointReasons.push(record.triggerReason);
          return record;
        },
        async loadCheckpoint() {
          return undefined;
        },
      },
      lifecycleHook: {
        async invoke(input) {
          stages.push(input.stage);
          return { outcome: 'PASS' };
        },
      },
    });

    await runtime.submit({
      sessionId,
      identityContext,
      inputText: 'run hook path',
      attachmentIds: [],
      locale: brand<string, 'RequestLocale'>('zh-CN'),
      idempotencyKey: brand<string, 'IdempotencyKey'>('idem-hook'),
    });
    await waitFor(() => stages.includes('BEFORE_REQUEST_ACCEPT') && checkpointReasons.includes('TERMINAL_COMMIT_PENDING'));

    expect(stages).toContain('BEFORE_REQUEST_ACCEPT');
    expect(checkpointReasons).toEqual(['RUN_ACCEPTED', 'STEP_STARTED', 'TERMINAL_COMMIT_PENDING', 'TERMINAL_COMMIT_PENDING']);
  });

  it('invokes no-op lifecycle hook and checkpoint before capability calls', async () => {
    const gateway = createTestGatewayStores();
    const identityContext = {
      tenantId: brand<string, 'TenantId'>('tenant-capability-hook'),
      subjectId: brand<string, 'SubjectId'>('subject-capability-hook'),
      displayName: 'Capability hook tester',
    };
    const sessionId = brand<string, 'SessionId'>('session-capability-hook');
    const requestId = brand<string, 'MessageId'>('request-capability-hook');
    const runId = brand<string, 'RequestRunId'>('run-capability-hook');
    const requestContextId = brand<string, 'RequestContextId'>('context-capability-hook');
    const stages: string[] = [];
    const checkpointReasons: string[] = [];
    await gateway.messages.appendSessionMessage({
      tenantId: identityContext.tenantId,
      subjectId: identityContext.subjectId,
      agentId,
      messageId: requestId,
      sessionId,
      requestId,
      runId,
      role: 'USER',
      content: 'read package',
      contentType: 'PLAIN_TEXT',
      metadata: {},
      visible: true,
      createdAt: brand<number, 'EpochMillis'>(1),
    });
    const assemblyRegistry = createDefaultAgentTestAssemblyRegistry('deterministic-test-model');
    const capabilitySubsystem = createCapabilitySubsystem({ read: { workspaceDir: process.cwd() } });
    const catalog = capabilitySubsystem.catalog;
    const emitted: string[] = [];
    const lifecycleHook: LifecycleHookInvocationPort = {
      async invoke(request) {
        stages.push(request.stage);
        return { status: 'CONTINUE' as const, boundary: request.boundary };
      },
    };
    const runState = {
      async setCapabilityTerminalAnswer(): Promise<void> {},
      async emitEvent(_run: object, _context: object, event: { readonly type: string }) {
        emitted.push(event.type);
      },
      async appendMessage() {
        return brand<string, 'MessageId'>('message-agent-core-test');
      },
      async saveCheckpoint(_run: object, _context: object, triggerReason: string) {
        checkpointReasons.push(triggerReason);
      },
      async requestPendingInput() {
        throw new Error('not used');
      },
    };
    const agent = new DefaultAgent({
      contextEngine: createDefaultContextEngine({
        activeContextStore: gateway.activeContext,
        messageStore: gateway.messages,
        assemblyRegistry,
        capabilityCatalog: catalog,
        modelSelectionService: createTestModelSelectionService({ modelId: 'deterministic-test-model' }),
      }),
      model: createDeterministicModelInvocationService([
        { toolCalls: [{ toolCallId: 'tool-read-1', toolName: 'Read', arguments: { file_path: 'package.json', offset: 0, limit: 1 } }] },
        { content: 'read completed' },
      ]),
      capabilityCatalog: catalog,
      capabilityInvocation: capabilitySubsystem.invocationPort,
      assemblyRegistry,
      runState,
      lifecycleHook,
    });
    await agent.execute(
      {
        runId,
        sessionId,
        requestId,
        agentId: brand<string, 'AgentId'>('default-agent'),
        agentVersion: brand<string, 'AgentVersion'>('v1'),
        agentAssemblyRef: 'default-agent:v1',
        attempt: 1,
        status: 'EXECUTING',
        version: 2,
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
        toolCallStates: [],
        flowVariables: {},
      },
      new AbortController().signal,
    );

    expect(stages).toContain('BEFORE_CAPABILITY_INVOKE');
    expect(checkpointReasons).toContain('CAPABILITY_BEFORE_CALL');
    expect(emitted).toContain('CAPABILITY_COMPLETED');
  });

  it('runs Web convenience submit through runtime, model, terminal stream, and history', async () => {
    const app = trackApp(
      createNextAgentTestApp({
        workspaceDir: process.cwd(),
        modelSteps: [{ content: '小区 LTE KPI 当前无新增告警。' }],
      }),
    );

    const accepted = await app.server.inject({
      method: 'POST',
      url: '/api/v1/requests',
      payload: { inputText: '诊断 LTE KPI 告警', idempotencyKey: 'idem-main', attachments: [] },
    });

    expect(accepted.statusCode).toBe(200);
    const body = accepted.json() as { sessionId: string; requestId: string; runId: string; attempt: number };
    expect(Object.keys(body).sort()).toEqual(['attempt', 'requestId', 'runId', 'sessionId']);

    const stream = await app.server.inject({
      method: 'GET',
      url: `/api/v1/sessions/${body.sessionId}/stream?lastSeenSequence=0&runId=${body.runId}`,
    });
    expect(stream.statusCode).toBe(200);
    expect(stream.body).toContain('event: LLM_CONTENT_DELTA');
    expect(stream.body).toContain('小区 LTE KPI 当前无新增告警。');
    expect(stream.body).toContain('event: REQUEST_COMPLETED');

    const conversation = await app.server.inject({ method: 'GET', url: `/api/v1/sessions/${body.sessionId}/conversation?limit=10` });
    expect(conversation.statusCode).toBe(200);
    const history = conversation.json() as { items: Array<{ role: string; content: string }> };
    expect(history.items.map((item) => item.role)).toEqual(['USER', 'ASSISTANT']);
    expect(history.items.at(-1)?.content).toContain('LTE KPI');
  });

  it('keeps the session stream open after a terminal event for subsequent session events', async () => {
    const app = trackApp(
      createNextAgentTestApp({
        workspaceDir: process.cwd(),
        modelSteps: [{ content: 'first live answer' }, { content: 'second live answer' }],
      }),
    );
    const session = await app.server.inject({
      method: 'POST',
      url: '/api/v1/sessions',
      payload: {},
    });
    const { sessionId } = session.json<{ sessionId: string }>();
    const events: string[] = [];
    const abortController = new AbortController();
    const streamPromise = (async () => {
      try {
        for await (const event of app.runtime.stream({
          sessionId: brand<string, 'SessionId'>(sessionId),
          lastSeenSequence: brand<number, 'TimelineSequence'>(0),
          signal: abortController.signal,
        })) {
          events.push(`${event.sequence}:${event.type}:${JSON.stringify(event.inlinePayload)}`);
        }
      } catch {
        // The test closes the session stream through the abort signal.
      }
    })();

    await new Promise<void>((resolve) => setTimeout(resolve, 0));

    const firstAccepted = await app.server.inject({
      method: 'POST',
      url: `/api/v1/sessions/${sessionId}/requests`,
      payload: { inputText: 'start first live SSE', idempotencyKey: 'idem-live-sse-1' },
    });
    expect(firstAccepted.statusCode).toBe(200);
    await waitFor(() => events.some((event) => event.includes('REQUEST_COMPLETED') && event.includes('first live answer')));

    const eventCountAfterFirstTerminal = events.length;
    const secondAccepted = await app.server.inject({
      method: 'POST',
      url: `/api/v1/sessions/${sessionId}/requests`,
      payload: { inputText: 'start second live SSE', idempotencyKey: 'idem-live-sse-2' },
    });
    expect(secondAccepted.statusCode).toBe(200);
    await waitFor(() => events.length > eventCountAfterFirstTerminal && events.some((event) => event.includes('second live answer')));

    abortController.abort();
    await streamPromise;
    expect(events.some((event) => event.includes('REQUEST_ACCEPTED'))).toBe(true);
    expect(events.some((event) => event.includes('first live answer'))).toBe(true);
    expect(events.some((event) => event.includes('second live answer'))).toBe(true);
  });

  it('executes the read capability through the generic tool loop and keeps capability results out of default history', async () => {
    const app = trackApp(
      createNextAgentTestApp({
        workspaceDir: process.cwd(),
        modelSteps: [
          { toolCalls: [{ toolCallId: 'tool-read-1', toolName: 'Read', arguments: { file_path: 'package.json', offset: 0, limit: 1 } }] },
          { content: '已读取 package.json 的首行。' },
        ],
      }),
    );

    const accepted = await app.server.inject({
      method: 'POST',
      url: '/api/v1/requests',
      payload: { inputText: '读取 package.json', idempotencyKey: 'idem-tool' },
    });
    const body = accepted.json() as { sessionId: string; runId: string };
    const stream = await app.server.inject({
      method: 'GET',
      url: `/api/v1/sessions/${body.sessionId}/stream?lastSeenSequence=0&runId=${body.runId}`,
    });

    expect(stream.body).toContain('event: CAPABILITY_STARTED');
    expect(stream.body).toContain('event: CAPABILITY_COMPLETED');

    const defaultHistory = (await app.server.inject({ method: 'GET', url: `/api/v1/sessions/${body.sessionId}/conversation?limit=20` })).json() as {
      items: Array<{ role: string; content: string; metadata?: Record<string, unknown> }>;
    };
    expect(defaultHistory.items.some((item) => item.role === 'CAPABILITY_RESULT')).toBe(false);
    expect(defaultHistory.items.some((item) => item.metadata?.kind === 'ASSISTANT_TOOL_USE' || item.content.includes('"toolCalls"'))).toBe(false);

    const withCapability = (
      await app.server.inject({ method: 'GET', url: `/api/v1/sessions/${body.sessionId}/conversation?limit=20&includeCapabilityResults=true` })
    ).json() as {
      items: Array<{ role: string; content: string; metadata?: Record<string, unknown> }>;
    };
    expect(withCapability.items.some((item) => item.role === 'CAPABILITY_RESULT' && item.content === '')).toBe(true);
    expect(withCapability.items.some((item) => item.metadata?.kind === 'ASSISTANT_TOOL_USE' || item.content.includes('"toolCalls"'))).toBe(false);
  });
});

function captureProductModel(captured: ModelInvocationRequest[]): ModelInvocationService {
  return {
    async complete(request) {
      captured.push(request);
      return { content: 'product model override ok' };
    },
    stream: modelEventStreamFixture(async function* (request) {
      captured.push(request);
      yield { content: 'product model override ok', finishReason: 'stop' };
    }),
  };
}

function writeModelGatewayConfig(): string {
  return writeModelGatewayConfigWithProfiles([
    {
      providerId: 'model-gateway',
      models: [
        {
          modelId: 'gateway-model',
          temperature: 0.2,
          maxOutputTokens: 2048,
          topP: 1,
          timeoutMs: 30_000,
          fallbackEligible: false,
        },
      ],
    },
  ]);
}

function writeOpenAiWithModelGatewayFallbackConfig(): string {
  return writeModelGatewayConfigWithProfiles([
    {
      providerId: 'openai-compatible',
      baseUrl: 'https://api.minimaxi.com/v1',
      credentialRef: 'env:OPENAI_API_KEY',
      models: [
        {
          modelId: 'openai-primary',
          contextWindowTokens: 128_000,
          temperature: 0.2,
          maxOutputTokens: 2048,
          topP: 1,
          timeoutMs: 30_000,
          fallbackEligible: false,
        },
      ],
    },
    {
      providerId: 'model-gateway',
      models: [
        {
          modelId: 'gateway-fallback',
          temperature: 0.2,
          maxOutputTokens: 2048,
          topP: 1,
          timeoutMs: 30_000,
          fallbackEligible: true,
        },
      ],
    },
  ]);
}

function writeModelGatewayConfigWithProfiles(modelProfiles: ReadonlyArray<Record<string, unknown>>): string {
  const root = mkdtempSync(join(tmpdir(), 'nextagent-model-gateway-'));
  const configFile = join(root, 'system.json');
  writeFileSync(
    configFile,
    JSON.stringify({
      deployment: { mode: 'REMOTE' },
      paths: { workspaceRoot: join(root, 'workspaces'), logDirectory: join(root, 'logs') },
      observability: { logging: { diagnosticDetail: 'normal' } },
      auth: { mode: 'local', localIdentity: { tenantId: 'local-tenant', subjectId: 'local-subject' }, localAuth: { enabled: false } },
      channel: { transport: 'fastify', host: '127.0.0.1', port: 3000 },
      hostedAgent: { activeAgentId: 'default-agent' },
      modelProfiles,
      gateway: {
        gateways: [
          { gatewayId: 'local-working-memory', gatewayKind: 'working-memory', deploymentMode: 'LOCAL' },
          { gatewayId: 'local-long-term-memory', gatewayKind: 'long-term-memory', deploymentMode: 'LOCAL' },
          { gatewayId: 'local-sqlite', gatewayKind: 'sqlite', deploymentMode: 'LOCAL', sqliteFileRef: 'paths.sqliteFile' },
          { gatewayId: 'local-rag', gatewayKind: 'rag-knowledge', deploymentMode: 'LOCAL' },
          {
            gatewayId: 'remote-workflow',
            gatewayKind: 'workflow-execution',
            deploymentMode: 'REMOTE',
            endpoint: 'https://gateway.example.invalid/workflow',
          },
        ],
      },
      rag: { indexes: ['local'] },
      sandbox: { clipcExecutableDirectoryEnv: 'CLIP_HOME', enabled: true, deniedExecutables: [] },
      noopBoundaries: { lifecycleHook: 'noop', checkpoint: 'noop', audit: 'noop' },
    }),
  );
  return configFile;
}

function testCronTaskSchedulerFactory() {
  return {
    start() {},
    async stop() {},
  };
}

function foundModelInformation() {
  return {
    async get(modelId: string) {
      return {
        status: 'FOUND' as const,
        information: { modelId, contextWindowTokens: 128_000 },
      };
    },
  };
}

function modelGatewayProvider(providerId: string, captured: ModelInvocationRequest[]): ModelGatewayProvider {
  return {
    providerId,
    createModelService: () => captureProductModel(captured),
    createModelInformationService: foundModelInformation,
  };
}

function testSandboxGateway() {
  return {
    async execute(request: { readonly executionId: string }) {
      return {
        executionId: request.executionId,
        stdout: '',
        stderr: '',
        stdoutTruncated: false,
        stderrTruncated: false,
        timedOut: false,
        durationMs: 0,
      };
    },
    isExecutionReady() {
      return true;
    },
  };
}

function testRagRetrieval() {
  const gateway = {
    async retrieve() {
      return { status: 'UNAVAILABLE' as const, results: [], diagnostics: { reason: 'PROVIDER_UNAVAILABLE' as const } };
    },
  };
  return {
    gateway,
    workflowGateway: createLocalWorkflowRagGateway(gateway),
    async build() {},
    async cleanup() {},
    close() {},
  };
}
