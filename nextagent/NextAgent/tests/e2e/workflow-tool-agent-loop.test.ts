import {
  createAppCredentialResolver,
  createComposedApp,
  validateDefaultSystemConfig,
  type AgentDefinition,
  type DefaultSystemConfig,
} from '@nextagent/agent-platform-gateway-local/testing';
import { brand, type JsonObject } from '@nextagent/agent-common';
import { createDeterministicModelInvocationService, type DeterministicModelStep } from '@nextagent/agent-model/testing';
import type {
  WorkflowExecutionRequest,
  WorkflowExecutionResult,
  WorkflowExecutionService,
  WorkflowRemoteExecutionGateway,
  WorkflowRemoteExecutionStreamItem,
} from '@nextagent/agent-contracts/core';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { reserveFreePort } from './e2e-helpers.js';

const agentId = brand<string, 'AgentId'>('default-agent');
const identity = {
  tenantId: brand<string, 'TenantId'>('tenant-wf-tool'),
  subjectId: brand<string, 'SubjectId'>('subject-wf-tool'),
  displayName: 'Workflow tool agent loop tester',
};

describe('workflow tool agent loop', () => {
  const cleanupPaths: string[] = [];
  const apps: Array<ReturnType<typeof createComposedApp>> = [];

  afterEach(async () => {
    while (apps.length > 0) {
      await apps.pop()!.close();
    }
    while (cleanupPaths.length > 0) {
      await rm(cleanupPaths.pop()!, { recursive: true, force: true });
    }
  });

  it('routes through agent loop: Skill -> Workflow -> final answer (local mode)', async () => {
    const root = await mkdtemp(join(tmpdir(), 'nextagent-wf-tool-local-'));
    cleanupPaths.push(root);

    await mkdir(join(root, 'agents', 'default-agent', 'recipes'), { recursive: true });
    await writeFile(join(root, 'agents', 'default-agent', 'recipes', 'alarm-localization.yaml'), recipeYaml('alarm-localization', 'v1'), 'utf8');

    const executed: WorkflowExecutionRequest[] = [];
    const port = await reserveFreePort();
    const app = createComposedApp(
      {
        identity,
        systemConfig: createSystemConfig(root, port),
        agentDefinition: createAgentDefinition(),
        credentialResolver: createAppCredentialResolver({ NEXTAGENT_TEST_ONLY: 'test-only' }),
        workflowExecutionServiceFactory: () => mockWorkflowService(executed),
      },
      createDeterministicModelInvocationService(modelSteps()),
    );
    apps.push(app);
    await app.start();
    const baseUrl = `http://127.0.0.1:${port}`;

    const accepted = await fetch(`${baseUrl}/api/v1/requests`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        inputText: '基站告警频繁，请定位问题',
        idempotencyKey: `wf-tool-local-${crypto.randomUUID()}`,
      }),
    });
    expect(accepted.status).toBe(200);
    const body = (await accepted.json()) as { readonly sessionId: string; readonly requestId: string; readonly runId: string };

    await waitForRunTerminal(app, body.runId);

    expect(executed).toHaveLength(1);
    expect(executed[0]).toMatchObject({
      recipeName: 'alarm-localization',
      recipeVersion: 'v1',
      agentId: 'default-agent',
    });
    expect(executed[0]?.inputText).toBe('基站告警频繁，请定位问题');

    const conversation = await fetch(`${baseUrl}/api/v1/sessions/${body.sessionId}/conversation?limit=50&includeCapabilityResults=true`);
    expect(conversation.status).toBe(200);
    const payload = (await conversation.json()) as {
      readonly items: Array<{ readonly role: string; readonly content: string; readonly metadata: JsonObject }>;
    };

    const capabilityResults = payload.items.filter((item) => item.role === 'CAPABILITY_RESULT');
    expect(capabilityResults.some((item) => item.metadata['toolName'] === 'Skill')).toBe(true);
    expect(capabilityResults.some((item) => item.metadata['toolName'] === 'Workflow')).toBe(true);
    expect(capabilityResults.every((item) => item.content === '')).toBe(true);

    const persistedMessages = await loadPersistedMessages(app, body.sessionId);
    const workflowResult = persistedMessages.find((item) => item.role === 'CAPABILITY_RESULT' && item.metadata['toolCallId'] === 'workflow-call-1');
    expect(workflowResult?.content).toContain('"toolName":"Workflow"');
    expect(workflowResult?.content).toContain('"status":"succeeded"');
    expect(workflowResult?.content).toContain('workflow completed');
    expect(
      persistedMessages.some(
        (item) =>
          item.role === 'ASSISTANT' && item.metadata['kind'] === 'ASSISTANT_TOOL_USE' && item.content.includes('"toolCallId":"workflow-call-1"'),
      ),
    ).toBe(true);

    expect(payload.items.some((item) => item.role === 'ASSISTANT' && item.content.includes('workflow completed'))).toBe(true);
  }, 30_000);

  it('routes through agent loop: Skill -> Workflow -> final answer (remote mode)', async () => {
    const root = await mkdtemp(join(tmpdir(), 'nextagent-wf-tool-remote-'));
    cleanupPaths.push(root);

    await mkdir(join(root, 'agents', 'default-agent', 'recipes'), { recursive: true });
    await writeFile(join(root, 'agents', 'default-agent', 'recipes', 'alarm-localization.yaml'), recipeYaml('alarm-localization', 'v1'), 'utf8');

    const executed: WorkflowExecutionRequest[] = [];
    const port = await reserveFreePort();
    const app = createComposedApp(
      {
        identity,
        systemConfig: createSystemConfig(root, port),
        agentDefinition: createAgentDefinition(),
        credentialResolver: createAppCredentialResolver({ NEXTAGENT_TEST_ONLY: 'test-only' }),
        workflowExecutionMode: 'remote',
        workflowRemoteExecutionGateway: mockRemoteGateway(executed),
      },
      createDeterministicModelInvocationService(modelSteps()),
    );
    apps.push(app);
    await app.start();
    const baseUrl = `http://127.0.0.1:${port}`;

    const accepted = await fetch(`${baseUrl}/api/v1/requests`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        inputText: '基站告警频繁，请定位问题',
        idempotencyKey: `wf-tool-remote-${crypto.randomUUID()}`,
      }),
    });
    expect(accepted.status).toBe(200);
    const body = (await accepted.json()) as { readonly sessionId: string; readonly requestId: string; readonly runId: string };

    await waitForRunTerminal(app, body.runId);

    expect(executed).toHaveLength(1);
    expect(executed[0]).toMatchObject({
      recipeName: 'alarm-localization',
      recipeVersion: 'v1',
      agentId: 'default-agent',
    });

    const conversation = await fetch(`${baseUrl}/api/v1/sessions/${body.sessionId}/conversation?limit=50&includeCapabilityResults=true`);
    expect(conversation.status).toBe(200);
    const payload = (await conversation.json()) as {
      readonly items: Array<{ readonly role: string; readonly content: string; readonly metadata: JsonObject }>;
    };

    const capabilityResults = payload.items.filter((item) => item.role === 'CAPABILITY_RESULT');
    expect(capabilityResults.some((item) => item.metadata['toolName'] === 'Workflow')).toBe(true);
    expect(capabilityResults.every((item) => item.content === '')).toBe(true);

    const persistedMessages = await loadPersistedMessages(app, body.sessionId);
    const workflowResult = persistedMessages.find((item) => item.role === 'CAPABILITY_RESULT' && item.metadata['toolCallId'] === 'workflow-call-1');
    expect(workflowResult?.content).toContain('"toolName":"Workflow"');
    expect(workflowResult?.content).toContain('"status":"succeeded"');
    expect(
      persistedMessages.some(
        (item) =>
          item.role === 'ASSISTANT' && item.metadata['kind'] === 'ASSISTANT_TOOL_USE' && item.content.includes('"toolCallId":"workflow-call-1"'),
      ),
    ).toBe(true);

    expect(payload.items.some((item) => item.role === 'ASSISTANT' && item.content.includes('workflow completed'))).toBe(true);
  }, 30_000);
});

function modelSteps(): readonly DeterministicModelStep[] {
  return [
    {
      toolCalls: [
        {
          toolCallId: 'skill-call-1',
          toolName: 'Skill',
          arguments: { name: 'skill-creator', args: { question: '基站告警频繁' } } as unknown as JsonObject,
        },
      ],
    },
    {
      toolCalls: [
        {
          toolCallId: 'workflow-call-1',
          toolName: 'Workflow',
          arguments: {
            recipeName: 'alarm-localization',
            inputText: '基站告警频繁，请定位问题',
            inputVariables: {},
          } as unknown as JsonObject,
        },
      ],
    },
    { content: 'workflow completed' },
  ];
}

async function waitForRunTerminal(app: ReturnType<typeof createComposedApp>, runId: string, timeoutMs = 15_000): Promise<void> {
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
  throw new Error('Timed out waiting for workflow tool request terminal commit.');
}

async function loadPersistedMessages(app: ReturnType<typeof createComposedApp>, sessionId: string) {
  const page = await app.gateway.messages.listMessages({
    tenantId: identity.tenantId,
    subjectId: identity.subjectId,
    agentId,
    sessionId: brand<string, 'SessionId'>(sessionId),
    includeHidden: true,
    includeCapabilityResults: true,
    limit: 50,
  });
  return page.items;
}

function createSystemConfig(root: string, port: number): DefaultSystemConfig {
  return validateDefaultSystemConfig(
    {
      deployment: { mode: 'LOCAL' },
      paths: { workspaceRoot: 'workspaces', logDirectory: 'logs' },
      auth: {
        mode: 'local',
        localIdentity: { tenantId: 'local-tenant', subjectId: 'local-subject', displayName: 'Local developer' },
      },
      channel: { transport: 'fastify', host: '127.0.0.1', port },
      hostedAgent: { activeAgentId: 'default-agent' },
      modelProfiles: [
        {
          providerId: 'openai-compatible',
          baseUrl: 'https://api.minimaxi.com/v1',
          credentialRef: 'env:NEXTAGENT_TEST_ONLY',
          models: [
            {
              modelId: 'deterministic-test-model',
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
    },
    root,
    { credentialResolver: createAppCredentialResolver({ NEXTAGENT_TEST_ONLY: 'test-only' }) },
  );
}

function createAgentDefinition(): AgentDefinition {
  return {
    agentId,
    agentType: brand<string, 'AgentType'>('default'),
    agentVersion: brand<string, 'AgentVersion'>('v1'),
    displayName: 'Workflow tool test agent',
    description: 'Workflow tool test agent.',
    modelIds: ['deterministic-test-model'],
    capabilityBindings: [],
    runtimeSettings: {
      defaultLanguage: 'zh-CN',

      requestTimeoutMs: 30_000,
    },
    resources: [],
  };
}

function mockWorkflowService(captured: WorkflowExecutionRequest[]): WorkflowExecutionService {
  return {
    async execute(request) {
      captured.push(request);
      return {
        executionId: 'workflow-execution-1',
        status: 'COMPLETED',
        outputVariables: { message: 'workflow completed' },
        nodeResults: [
          {
            nodeId: 'answer',
            nodeType: 'LLM',
            status: 'NODE_COMPLETED',
            output: { message: 'workflow completed' },
            retryCount: 0,
            startedAt: new Date('2026-01-01T00:00:00.000Z'),
            completedAt: new Date('2026-01-01T00:00:01.000Z'),
          },
        ],
        startedAt: new Date('2026-01-01T00:00:00.000Z'),
        completedAt: new Date('2026-01-01T00:00:01.000Z'),
      };
    },
  };
}

function mockRemoteGateway(captured: WorkflowExecutionRequest[]): WorkflowRemoteExecutionGateway {
  return {
    async *execute(request): AsyncIterable<WorkflowRemoteExecutionStreamItem> {
      captured.push(request);
      const result: WorkflowExecutionResult = {
        executionId: 'workflow-execution-remote-1',
        status: 'COMPLETED',
        outputVariables: { message: 'workflow completed' },
        nodeResults: [
          {
            nodeId: 'answer',
            nodeType: 'LLM',
            status: 'NODE_COMPLETED',
            output: { message: 'workflow completed' },
            retryCount: 0,
            startedAt: new Date('2026-01-01T00:00:00.000Z'),
            completedAt: new Date('2026-01-01T00:00:01.000Z'),
          },
        ],
        startedAt: new Date('2026-01-01T00:00:00.000Z'),
        completedAt: new Date('2026-01-01T00:00:01.000Z'),
      };
      yield { kind: 'result', result };
    },
  };
}

function recipeYaml(recipeName: string, version: string): string {
  return [
    `name: ${recipeName}`,
    `version: "${version}"`,
    `description: ${recipeName} workflow`,
    'nodes:',
    '  start:',
    '    type: start-event',
    '    next:',
    '      answer:',
    '        condition: ""',
    '  answer:',
    '    type: LLM',
    '    next:',
    '      end:',
    '        condition: ""',
    '  end:',
    '    type: end-event',
    '',
  ].join('\n');
}
