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
  WorkflowExecutionRequest,
  WorkflowExecutionResult,
  WorkflowExecutionService,
  WorkflowRemoteExecutionGateway,
  WorkflowRemoteExecutionStreamItem,
} from '@nextagent/agent-contracts/core';
import type { ModelInvocationService } from '@nextagent/agent-contracts/model';
import {
  createLocalGatewayProvider,
  createSqliteLongTermMemoryGatewayProvider,
  createSqliteWorkingMemoryGatewayProvider,
} from '@nextagent/agent-platform-gateway-local';
import { createRemoteGatewayProvider } from '@nextagent/agent-platform-gateway-remote';
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

describe('workflow remote composition', () => {
  it('factory overrides mode selection when both are provided', async () => {
    const root = await mkdtemp(join(tmpdir(), 'nextagent-wf-priority-'));
    let app: ReturnType<typeof createComposedApp> | undefined;
    try {
      await mkdir(join(root, 'agents', 'default-agent', 'recipes'), { recursive: true });
      await writeFile(join(root, 'agents', 'default-agent', 'recipes', 'workflow-test.yaml'), JSON.stringify(simpleRecipe()), 'utf8');

      let factoryCalled = false;
      const factoryService: WorkflowExecutionService = {
        async execute(): Promise<WorkflowExecutionResult> {
          factoryCalled = true;
          return {
            executionId: 'factory-exec',
            status: 'COMPLETED',
            outputVariables: { source: 'factory' },
            nodeResults: [],
            startedAt: new Date(),
            completedAt: new Date(),
          };
        },
      };

      app = createComposedApp(
        {
          identity,
          systemConfig: createSystemConfig(root),
          agentDefinition: createAgentDefinition(),
          credentialResolver: testCredentialResolver(),
          workflowExecutionMode: 'remote',
          workflowExecutionServiceFactory: () => factoryService,
        },
        captureModel(),
      );

      expect(factoryCalled).toBe(false);

      const response = await app.server.inject({
        method: 'POST',
        url: '/api/v1/requests',
        payload: {
          inputText: '$workflow:workflow-test run workflow',
          idempotencyKey: 'idem-wf-priority',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json<{ runId: string }>();
      await waitForRunTerminal(app, body.runId);
      expect(factoryCalled).toBe(true);
    } finally {
      await app?.close().catch(() => undefined);
      await rm(root, { recursive: true, force: true });
    }
  });

  it('throws when remote mode is selected without gateway', async () => {
    const root = await mkdtemp(join(tmpdir(), 'nextagent-wf-no-gateway-'));
    try {
      await mkdir(join(root, 'agents', 'default-agent', 'recipes'), { recursive: true });

      expect(() =>
        createComposedApp(
          {
            identity,
            systemConfig: createSystemConfig(root),
            agentDefinition: createAgentDefinition(),
            credentialResolver: testCredentialResolver(),
            workflowExecutionMode: 'remote',
          },
          captureModel(),
        ),
      ).toThrow(/remote.*gateway/iu);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('default mode is local when neither factory nor mode is provided', async () => {
    const root = await mkdtemp(join(tmpdir(), 'nextagent-wf-default-local-'));
    let app: ReturnType<typeof createComposedApp> | undefined;
    try {
      await mkdir(join(root, 'agents', 'default-agent', 'recipes'), { recursive: true });
      await writeFile(join(root, 'agents', 'default-agent', 'recipes', 'workflow-test.yaml'), JSON.stringify(simpleRecipe()), 'utf8');

      app = createComposedApp(
        {
          identity,
          systemConfig: createSystemConfig(root),
          agentDefinition: createAgentDefinition(),
          credentialResolver: testCredentialResolver(),
        },
        captureModel(),
      );

      const response = await app.server.inject({
        method: 'POST',
        url: '/api/v1/requests',
        payload: {
          inputText: '$workflow:workflow-test run workflow',
          idempotencyKey: 'idem-wf-default-local',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json<{ runId: string }>();
      await waitForRunTerminal(app, body.runId);
    } finally {
      await app?.close().catch(() => undefined);
      await rm(root, { recursive: true, force: true });
    }
  });

  it('mode source is trusted composition config, not request body', () => {
    const request: WorkflowExecutionRequest = {
      recipeName: 'test',
      recipeVersion: 'v1',
      inputVariables: {},
      identityContext: {
        tenantId: brand<string, 'TenantId'>('t1'),
        subjectId: brand<string, 'SubjectId'>('s1'),
        displayName: 'test',
      },
      agentId: brand<string, 'AgentId'>('a1'),
      agentVersion: brand<string, 'AgentVersion'>('v1'),
      sessionId: brand<string, 'SessionId'>('sess1'),
      requestId: brand<string, 'MessageId'>('req1'),
      runId: brand<string, 'RequestRunId'>('run1'),
      requestContextId: brand<string, 'RequestContextId'>('ctx1'),
    };

    expect('workflowExecutionMode' in request).toBe(false);
  });

  it('uses injected gateway for remote workflow-execution without endpoint (UDS mode)', async () => {
    const root = await mkdtemp(join(tmpdir(), 'nextagent-wf-uds-gateway-'));
    let app: ReturnType<typeof createComposedApp> | undefined;
    try {
      await mkdir(join(root, 'agents', 'default-agent', 'recipes'), { recursive: true });
      await writeFile(join(root, 'agents', 'default-agent', 'recipes', 'workflow-test.yaml'), JSON.stringify(simpleRecipe()), 'utf8');

      let gatewayCalled = false;
      const udsGateway: WorkflowRemoteExecutionGateway = {
        async *execute(_request, _signal): AsyncIterable<WorkflowRemoteExecutionStreamItem> {
          gatewayCalled = true;
          yield {
            kind: 'result',
            result: {
              executionId: 'uds-exec',
              status: 'COMPLETED',
              outputVariables: { source: 'uds' },
              nodeResults: [],
              startedAt: new Date(),
              completedAt: new Date(),
            },
          };
        },
      };

      app = createComposedApp(
        {
          identity,
          systemConfig: createUdsSystemConfig(root),
          agentDefinition: createAgentDefinition(),
          credentialResolver: testCredentialResolver(),
          gatewayProviders: [
            createSqliteWorkingMemoryGatewayProvider(),
            createSqliteLongTermMemoryGatewayProvider(),
            createLocalGatewayProvider(),
            createRemoteGatewayProvider(),
          ],
          workflowRemoteExecutionGateway: udsGateway,
        },
        captureModel(),
      );

      const response = await app.server.inject({
        method: 'POST',
        url: '/api/v1/requests',
        payload: {
          inputText: '$workflow:workflow-test run workflow',
          idempotencyKey: 'idem-wf-uds-gateway',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json<{ runId: string }>();
      await waitForRunTerminal(app, body.runId);
      expect(gatewayCalled).toBe(true);
    } finally {
      await app?.close().catch(() => undefined);
      await rm(root, { recursive: true, force: true });
    }
  });

  it('throws when remote workflow-execution has no endpoint and no injected gateway (UDS without gateway)', async () => {
    const root = await mkdtemp(join(tmpdir(), 'nextagent-wf-uds-no-gateway-'));
    try {
      await mkdir(join(root, 'agents', 'default-agent', 'recipes'), { recursive: true });

      expect(() =>
        createComposedApp(
          {
            identity,
            systemConfig: createUdsSystemConfig(root),
            agentDefinition: createAgentDefinition(),
            credentialResolver: testCredentialResolver(),
          },
          captureModel(),
        ),
      ).toThrow(/remote.*gateway/iu);
    } finally {
      await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    }
  });
});

async function waitForRunTerminal(app: ReturnType<typeof createComposedApp>, runId: string, timeoutMs = 5_000): Promise<void> {
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
    await new Promise((resolve) => setTimeout(resolve, 20));
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
    displayName: 'Workflow remote composition test agent',
    description: 'Workflow remote composition test agent.',
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

function createUdsSystemConfig(root: string): DefaultSystemConfig {
  return validateDefaultSystemConfig(
    {
      ...rawSystemConfig(),
      gateway: {
        gateways: [
          { gatewayId: 'local-working-memory', gatewayKind: 'working-memory', deploymentMode: 'LOCAL' },
          { gatewayId: 'local-long-term-memory', gatewayKind: 'long-term-memory', deploymentMode: 'LOCAL' },
          { gatewayId: 'local-sqlite', gatewayKind: 'sqlite', deploymentMode: 'LOCAL', sqliteFileRef: 'paths.sqliteFile' },
          { gatewayId: 'local-rag', gatewayKind: 'rag-knowledge', deploymentMode: 'LOCAL' },
          { gatewayId: 'remote-workflow-uds', gatewayKind: 'workflow-execution', deploymentMode: 'REMOTE' },
        ],
      },
    },
    root,
    { credentialResolver: testCredentialResolver() },
  );
}
