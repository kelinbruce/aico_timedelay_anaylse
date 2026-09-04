import { modelEventStreamFixture } from '../helpers/model-stream-fixture.js';
import {
  createAppCredentialResolver,
  createComposedApp,
  validateDefaultSystemConfig,
  type AgentDefinition,
  type DefaultSystemConfig,
} from '@nextagent/agent-platform-gateway-local/testing';
import { brand } from '@nextagent/agent-common';
import type {
  WorkflowExecutionEvent,
  WorkflowExecutionRequest,
  WorkflowExecutionResult,
  WorkflowRemoteExecutionGateway,
  WorkflowRemoteExecutionStreamItem,
} from '@nextagent/agent-contracts/core';
import type { ModelInvocationService } from '@nextagent/agent-contracts/model';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const agentId = brand<string, 'AgentId'>('default-agent');
const identity = {
  tenantId: brand<string, 'TenantId'>('local-tenant'),
  subjectId: brand<string, 'SubjectId'>('local-subject'),
  displayName: 'Local developer',
};

interface MockGatewayState {
  executeCallCount: number;
  receivedRequest?: WorkflowExecutionRequest | undefined;
  yieldedItems: WorkflowRemoteExecutionStreamItem[];
}

function createMockGateway(items: readonly WorkflowRemoteExecutionStreamItem[], state: MockGatewayState): WorkflowRemoteExecutionGateway {
  return {
    async *execute(request, _signal): AsyncIterable<WorkflowRemoteExecutionStreamItem> {
      state.executeCallCount += 1;
      state.receivedRequest = request;
      for (const item of items) {
        state.yieldedItems.push(item);
        yield item;
      }
    },
  };
}

function makeEvent(nodeId: string, eventType: WorkflowExecutionEvent['eventType'], executionId: string): WorkflowExecutionEvent {
  return {
    executionId,
    nodeId,
    nodeType: 'START',
    eventType,
    retryCount: 0,
    startedAt: new Date(),
  };
}

function makeCompletedResult(executionId: string): WorkflowExecutionResult {
  return {
    executionId,
    status: 'COMPLETED',
    outputVariables: { answer: '42' },
    nodeResults: [
      {
        nodeId: 'start',
        nodeType: 'START',
        status: 'NODE_COMPLETED',
        retryCount: 0,
        startedAt: new Date(),
        completedAt: new Date(),
      },
      {
        nodeId: 'end',
        nodeType: 'END',
        status: 'NODE_COMPLETED',
        retryCount: 0,
        startedAt: new Date(),
        completedAt: new Date(),
      },
    ],
    startedAt: new Date(),
    completedAt: new Date(),
  };
}

describe('workflow remote e2e mock', () => {
  it('routes to remote gateway when mode is remote, not local', async () => {
    const root = await mkdtemp(join(tmpdir(), 'nextagent-wf-e2e-remote-'));
    let app: ReturnType<typeof createComposedApp> | undefined;
    try {
      await mkdir(join(root, 'agents', 'default-agent', 'recipes'), { recursive: true });
      await writeFile(join(root, 'agents', 'default-agent', 'recipes', 'workflow-test.yaml'), JSON.stringify(simpleRecipe()), 'utf8');

      const state: MockGatewayState = {
        executeCallCount: 0,
        receivedRequest: undefined,
        yieldedItems: [],
      };
      const mockGateway = createMockGateway(
        [
          { kind: 'event', event: makeEvent('start', 'NODE_STARTED', 'remote-exec-1') },
          { kind: 'event', event: makeEvent('start', 'NODE_COMPLETED', 'remote-exec-1') },
          { kind: 'result', result: makeCompletedResult('remote-exec-1') },
        ],
        state,
      );

      app = createComposedApp(
        {
          identity,
          systemConfig: createSystemConfig(root),
          agentDefinition: createAgentDefinition(),
          credentialResolver: testCredentialResolver(),
          workflowExecutionMode: 'remote',
          workflowRemoteExecutionGateway: mockGateway,
        },
        captureModel(),
      );

      const response = await app.server.inject({
        method: 'POST',
        url: '/api/v1/requests',
        payload: {
          inputText: '$workflow:workflow-test run workflow',
          idempotencyKey: 'idem-wf-e2e-remote',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json<{ runId: string }>();
      await waitForRunTerminal(app, body.runId);

      expect(state.executeCallCount).toBe(1);
      expect(state.receivedRequest).toBeDefined();
      expect(state.receivedRequest?.recipeName).toBe('workflow-test');
      expect(state.receivedRequest?.recipeVersion).toBe('v1');
      expect(state.receivedRequest?.agentId).toBe(agentId);
      expect(state.receivedRequest?.identityContext.tenantId).toBe(identity.tenantId);
      expect(state.receivedRequest?.identityContext.subjectId).toBe(identity.subjectId);
      expect(state.receivedRequest?.inputText).toBe('run workflow');
      expect(state.receivedRequest?.inputVariables).toEqual({
        requestHeaders: {
          chatId: '',
          conversationId: '',
          'x-real-client-addr': '127.0.0.1',
          'x-user-id': '',
          'x-user-name': '',
        },
      });
    } finally {
      await app?.close().catch(() => undefined);
      await rm(root, { recursive: true, force: true });
    }
  });

  it('does not call remote gateway when mode is local (default)', async () => {
    const root = await mkdtemp(join(tmpdir(), 'nextagent-wf-e2e-local-'));
    let app: ReturnType<typeof createComposedApp> | undefined;
    try {
      await mkdir(join(root, 'agents', 'default-agent', 'recipes'), { recursive: true });
      await writeFile(join(root, 'agents', 'default-agent', 'recipes', 'workflow-test.yaml'), JSON.stringify(simpleRecipe()), 'utf8');

      const state: MockGatewayState = {
        executeCallCount: 0,
        receivedRequest: undefined,
        yieldedItems: [],
      };
      const mockGateway = createMockGateway([], state);

      app = createComposedApp(
        {
          identity,
          systemConfig: createSystemConfig(root),
          agentDefinition: createAgentDefinition(),
          credentialResolver: testCredentialResolver(),
          workflowExecutionMode: 'local',
          workflowRemoteExecutionGateway: mockGateway,
        },
        captureModel(),
      );

      const response = await app.server.inject({
        method: 'POST',
        url: '/api/v1/requests',
        payload: {
          inputText: '$workflow:workflow-test run workflow',
          idempotencyKey: 'idem-wf-e2e-local',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json<{ runId: string }>();
      await waitForRunTerminal(app, body.runId);

      expect(state.executeCallCount).toBe(0);
    } finally {
      await app?.close().catch(() => undefined);
      await rm(root, { recursive: true, force: true });
    }
  });

  it('remote gateway response data protocol is correct', async () => {
    const root = await mkdtemp(join(tmpdir(), 'nextagent-wf-e2e-protocol-'));
    let app: ReturnType<typeof createComposedApp> | undefined;
    try {
      await mkdir(join(root, 'agents', 'default-agent', 'recipes'), { recursive: true });
      await writeFile(join(root, 'agents', 'default-agent', 'recipes', 'workflow-test.yaml'), JSON.stringify(simpleRecipe()), 'utf8');

      const executionId = 'protocol-exec-1';
      const state: MockGatewayState = {
        executeCallCount: 0,
        receivedRequest: undefined,
        yieldedItems: [],
      };
      const mockGateway = createMockGateway(
        [
          { kind: 'event', event: makeEvent('start', 'NODE_STARTED', executionId) },
          { kind: 'event', event: makeEvent('start', 'NODE_COMPLETED', executionId) },
          { kind: 'event', event: makeEvent('end', 'NODE_STARTED', executionId) },
          { kind: 'event', event: makeEvent('end', 'NODE_COMPLETED', executionId) },
          { kind: 'result', result: makeCompletedResult(executionId) },
        ],
        state,
      );

      app = createComposedApp(
        {
          identity,
          systemConfig: createSystemConfig(root),
          agentDefinition: createAgentDefinition(),
          credentialResolver: testCredentialResolver(),
          workflowExecutionMode: 'remote',
          workflowRemoteExecutionGateway: mockGateway,
        },
        captureModel(),
      );

      const response = await app.server.inject({
        method: 'POST',
        url: '/api/v1/requests',
        payload: {
          inputText: '$workflow:workflow-test run workflow',
          idempotencyKey: 'idem-wf-e2e-protocol',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json<{ runId: string }>();
      await waitForRunTerminal(app, body.runId);

      expect(state.executeCallCount).toBe(1);
      expect(state.yieldedItems).toHaveLength(5);

      const eventItems = state.yieldedItems.filter((item) => item.kind === 'event');
      const resultItems = state.yieldedItems.filter((item) => item.kind === 'result');
      expect(eventItems).toHaveLength(4);
      expect(resultItems).toHaveLength(1);

      const events = eventItems.map((item) => (item.kind === 'event' ? item.event : undefined));
      expect(events[0]?.nodeId).toBe('start');
      expect(events[0]?.eventType).toBe('NODE_STARTED');
      expect(events[1]?.nodeId).toBe('start');
      expect(events[1]?.eventType).toBe('NODE_COMPLETED');
      expect(events[2]?.nodeId).toBe('end');
      expect(events[2]?.eventType).toBe('NODE_STARTED');
      expect(events[3]?.nodeId).toBe('end');
      expect(events[3]?.eventType).toBe('NODE_COMPLETED');

      const resultItem = resultItems[0];
      expect(resultItem).toBeDefined();
      if (resultItem !== undefined && resultItem.kind === 'result') {
        expect(resultItem.result.executionId).toBe(executionId);
        expect(resultItem.result.status).toBe('COMPLETED');
        expect(resultItem.result.outputVariables.answer).toBe('42');
        expect(resultItem.result.nodeResults).toHaveLength(2);
      }

      const run = await app.gateway.requestRuns.loadRun({
        tenantId: identity.tenantId,
        subjectId: identity.subjectId,
        agentId,
        runId: brand<string, 'RequestRunId'>(body.runId),
      });
      expect(run?.terminalCommitState).toBe('COMMITTED');
      expect(run?.status).toBe('COMPLETED');
    } finally {
      await app?.close().catch(() => undefined);
      await rm(root, { recursive: true, force: true });
    }
  });

  it('remote gateway failure maps to FAILED run', async () => {
    const root = await mkdtemp(join(tmpdir(), 'nextagent-wf-e2e-fail-'));
    let app: ReturnType<typeof createComposedApp> | undefined;
    try {
      await mkdir(join(root, 'agents', 'default-agent', 'recipes'), { recursive: true });
      await writeFile(join(root, 'agents', 'default-agent', 'recipes', 'workflow-test.yaml'), JSON.stringify(simpleRecipe()), 'utf8');

      const state: MockGatewayState = {
        executeCallCount: 0,
        receivedRequest: undefined,
        yieldedItems: [],
      };
      const mockGateway = createMockGateway(
        [{ kind: 'failure', reasonCode: 'WORKFLOW_REMOTE_UNAVAILABLE', message: 'Remote workflow execution failed safely.' }],
        state,
      );

      app = createComposedApp(
        {
          identity,
          systemConfig: createSystemConfig(root),
          agentDefinition: createAgentDefinition(),
          credentialResolver: testCredentialResolver(),
          workflowExecutionMode: 'remote',
          workflowRemoteExecutionGateway: mockGateway,
        },
        captureModel(),
      );

      const response = await app.server.inject({
        method: 'POST',
        url: '/api/v1/requests',
        payload: {
          inputText: '$workflow:workflow-test run workflow',
          idempotencyKey: 'idem-wf-e2e-fail',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json<{ runId: string }>();
      await waitForRunTerminal(app, body.runId);

      expect(state.executeCallCount).toBe(1);

      const run = await app.gateway.requestRuns.loadRun({
        tenantId: identity.tenantId,
        subjectId: identity.subjectId,
        agentId,
        runId: brand<string, 'RequestRunId'>(body.runId),
      });
      expect(run?.terminalCommitState).toBe('COMMITTED');
      expect(run?.status).toBe('FAILED');
    } finally {
      await app?.close().catch(() => undefined);
      await rm(root, { recursive: true, force: true });
    }
  });
});

async function waitForRunTerminal(app: ReturnType<typeof createComposedApp>, runId: string, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
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
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error('Timed out waiting for run terminal.');
}

function createSystemConfig(root: string): DefaultSystemConfig {
  return validateDefaultSystemConfig(rawSystemConfig(), root, { credentialResolver: testCredentialResolver() });
}

function createAgentDefinition(): AgentDefinition {
  return {
    agentId,
    agentType: brand<string, 'AgentType'>('default'),
    agentVersion: brand<string, 'AgentVersion'>('v1'),
    displayName: 'Workflow remote e2e mock test agent',
    description: 'Workflow remote e2e mock test agent.',
    modelIds: ['MiniMax-M2.7'],
    capabilityBindings: [],
    runtimeSettings: {
      defaultLanguage: 'zh-CN',

      requestTimeoutMs: 30_000,
    },
    resources: [],
  };
}

function captureModel(): ModelInvocationService {
  return {
    async complete() {
      return { content: 'ok' };
    },
    stream: modelEventStreamFixture(async function* () {
      yield { content: 'ok', finishReason: 'stop' };
    }),
  };
}

function simpleRecipe() {
  return {
    name: 'workflow-test',
    version: 'v1',
    description: 'simple test recipe',
    nodes: {
      start: { type: 'start-event', next: { end: { condition: '' } } },
      end: { type: 'end-event' },
    },
  };
}

function rawSystemConfig() {
  return {
    deployment: { mode: 'LOCAL' },
    paths: { workspaceRoot: 'workspaces', logDirectory: 'logs' },
    auth: {
      mode: 'local',
      localIdentity: { tenantId: 'local-tenant', subjectId: 'local-subject', displayName: 'Local developer' },
    },
    channel: { transport: 'fastify', host: '127.0.0.1', port: 3000 },
    hostedAgent: { activeAgentId: 'default-agent' },
    modelProfiles: [
      {
        providerId: 'openai-compatible',
        baseUrl: 'https://api.minimaxi.com/v1',
        credentialRef: 'env:OPENAI_API_KEY',
        models: [
          {
            modelId: 'MiniMax-M2.7',
            timeoutMs: 30_000,
            contextWindowTokens: 128_000,
            fallbackEligible: false,
          },
        ],
      },
    ],
    gateway: {
      gateways: [
        { gatewayId: 'local-working-memory', gatewayKind: 'working-memory', deploymentMode: 'LOCAL' },
        { gatewayId: 'local-long-term-memory', gatewayKind: 'long-term-memory', deploymentMode: 'LOCAL' },
        { gatewayId: 'local-sqlite', gatewayKind: 'sqlite', deploymentMode: 'LOCAL', sqliteFileRef: 'paths.sqliteFile' },
        { gatewayId: 'local-rag', gatewayKind: 'rag-knowledge', deploymentMode: 'LOCAL' },
      ],
    },
    noopBoundaries: { lifecycleHook: 'noop', checkpoint: 'noop', audit: 'noop' },
  };
}

function testCredentialResolver() {
  return createAppCredentialResolver({
    OPENAI_API_KEY: 'test-only',
    OPENAI_MODEL_NAME: 'MiniMax-M2.7',
    OPENAI_BASE_URL: 'https://api.minimaxi.com/v1',
  });
}
