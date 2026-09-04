import { modelEventStreamFixture } from '../helpers/model-stream-fixture.js';
import {
  createAppCredentialResolver,
  createComposedApp,
  validateDefaultSystemConfig,
  type AgentDefinition,
  type DefaultSystemConfig,
} from '@nextagent/agent-platform-gateway-local/testing';
import { brand } from '@nextagent/agent-common';
import type { WorkflowExecutionRequest, WorkflowExecutionService } from '@nextagent/agent-contracts/core';
import type { ModelInvocationRequest, ModelInvocationService } from '@nextagent/agent-contracts/model';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanupP1P2GateContext, createP1P2GateContext, waitForTerminalCommit, type P1P2GateContext } from './p1-p2-scenario-gate/helpers.js';
import { reserveFreePort } from './e2e-helpers.js';

const agentId = brand<string, 'AgentId'>('default-agent');
const composedIdentity = {
  tenantId: brand<string, 'TenantId'>('tenant-retry-directive'),
  subjectId: brand<string, 'SubjectId'>('subject-retry-directive'),
  displayName: 'Retry directive recovery tester',
};

const cleanupPaths: string[] = [];
const composedApps: Array<ReturnType<typeof createComposedApp>> = [];
let gateCtx: P1P2GateContext | undefined;

afterEach(async () => {
  while (composedApps.length > 0) {
    await composedApps.pop()!.close();
  }
  while (cleanupPaths.length > 0) {
    await rm(cleanupPaths.pop()!, { recursive: true, force: true }).catch(() => {});
  }
  if (gateCtx !== undefined) {
    await cleanupP1P2GateContext(gateCtx);
    gateCtx = undefined;
  }
});

describe('e2e: retry directive recovery', () => {
  it('retry preserves structured workflow target and uses effective input text', async () => {
    const root = await mkdtemp(join(tmpdir(), 'nextagent-retry-wf-'));
    cleanupPaths.push(root);
    await mkdir(join(root, 'agents', 'default-agent', 'recipes'), { recursive: true });
    await writeFile(
      join(root, 'agents', 'default-agent', 'recipes', 'ran-alarm-diagnosis.yaml'),
      JSON.stringify(recipe('ran-alarm-diagnosis', 'v1')),
      'utf8',
    );

    const executed: WorkflowExecutionRequest[] = [];
    const modelCalls: ModelInvocationRequest[] = [];
    const port = await reserveFreePort();
    const app = createComposedApp(
      {
        identity: composedIdentity,
        systemConfig: createSystemConfig(root, port),
        agentDefinition: createAgentDefinition(),
        credentialResolver: createAppCredentialResolver({ NEXTAGENT_TEST_ONLY: 'test-only' }),
        workflowExecutionServiceFactory: () => workflowService(executed),
      },
      captureModel(modelCalls),
    );
    composedApps.push(app);
    await app.start();
    const baseUrl = `http://127.0.0.1:${port}`;

    const originalInputText = '$workflow:ran-alarm-diagnosis diagnose RAN alarms in sector 3';
    const accepted = await fetch(`${baseUrl}/api/v1/requests`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        inputText: originalInputText,
        idempotencyKey: `retry-wf-submit-${crypto.randomUUID()}`,
      }),
    });
    expect(accepted.status).toBe(200);
    const body = (await accepted.json()) as { readonly sessionId: string; readonly requestId: string; readonly runId: string };
    await waitForComposedRunTerminal(app, body.runId);

    expect(executed).toHaveLength(1);
    expect(executed[0]).toMatchObject({
      recipeName: 'ran-alarm-diagnosis',
      recipeVersion: 'v1',
      inputText: 'diagnose RAN alarms in sector 3',
    });
    expect(modelCalls).toHaveLength(0);
    const conversation = await fetch(`${baseUrl}/api/v1/sessions/${body.sessionId}/conversation?limit=20`);
    expect(conversation.status).toBe(200);
    const conversationBody = (await conversation.json()) as {
      readonly items: Array<{ readonly role: string; readonly content: string }>;
    };
    expect(conversationBody.items).toContainEqual(
      expect.objectContaining({
        role: 'USER',
        content: 'diagnose RAN alarms in sector 3',
      }),
    );
    expect(JSON.stringify(conversationBody.items)).not.toContain('$workflow:ran-alarm-diagnosis');
    expect(JSON.stringify(conversationBody.items)).not.toContain('"routingConstraints"');

    const retry = await fetch(`${baseUrl}/api/v1/sessions/${body.sessionId}/retry`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        expectedLatestRequestId: body.requestId,
        idempotencyKey: `retry-wf-retry-${crypto.randomUUID()}`,
      }),
    });
    expect(retry.status).toBe(200);
    const retryBody = (await retry.json()) as { readonly runId: string };
    expect(retryBody.runId).not.toBe(body.runId);
    await waitForComposedRunTerminal(app, retryBody.runId);

    expect(executed).toHaveLength(2);
    expect(executed[1]).toMatchObject({
      recipeName: 'ran-alarm-diagnosis',
      recipeVersion: 'v1',
      inputText: 'diagnose RAN alarms in sector 3',
    });
    expect(modelCalls).toHaveLength(0);
  }, 30_000);

  it('retry preserves structured skill target without polluting model requests', async () => {
    const modelRequests: ModelInvocationRequest[] = [];
    gateCtx = await createP1P2GateContext({
      skillFixtures: ['hello-clip-test'],
      modelRequestSink: modelRequests,
      modelSteps: [
        { content: 'Skill loaded successfully.' },
        { content: 'Skill reloaded on retry.' },
        { content: 'Skill reloaded on retry.' },
        { content: 'Skill reloaded on retry.' },
      ],
    });

    const originalInputText = '$skill:hello-clip-test verify health endpoint';
    const accepted = await fetch(`${gateCtx.baseUrl}/api/v1/requests`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        inputText: originalInputText,
        idempotencyKey: `retry-skill-submit-${crypto.randomUUID()}`,
      }),
    });
    expect(accepted.status).toBe(200);
    const body = (await accepted.json()) as { readonly sessionId: string; readonly requestId: string; readonly runId: string };
    await waitForTerminalCommit(gateCtx, body.runId);

    expect(modelRequests.length).toBeGreaterThanOrEqual(1);
    const promptJson1 = JSON.stringify(modelRequests[0]?.messages);
    expect(promptJson1).not.toContain('$skill:hello-clip-test');
    expect(promptJson1).toContain('verify health endpoint');
    expect(promptJson1).toContain('hello-clip-test');

    const retry = await fetch(`${gateCtx.baseUrl}/api/v1/sessions/${body.sessionId}/retry`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        expectedLatestRequestId: body.requestId,
        idempotencyKey: `retry-skill-retry-${crypto.randomUUID()}`,
      }),
    });
    expect(retry.status).toBe(200);
    const retryBody = (await retry.json()) as { readonly runId: string };
    expect(retryBody.runId).not.toBe(body.runId);
    await waitForTerminalCommit(gateCtx, retryBody.runId);

    expect(modelRequests.length).toBeGreaterThan(1);
    const retryPromptJson = JSON.stringify(modelRequests.slice(1).map((r) => r.messages));
    expect(retryPromptJson).not.toContain('$skill:hello-clip-test');
    expect(retryPromptJson).toContain('verify health endpoint');
    expect(retryPromptJson).toContain('hello-clip-test');
  }, 30_000);

  it('retry without directive creates a new run with model-driven loop (regression)', async () => {
    gateCtx = await createP1P2GateContext({
      modelSteps: [{ content: 'First attempt result.' }, { content: 'Retry attempt result.' }],
    });

    const accepted = await fetch(`${gateCtx.baseUrl}/api/v1/requests`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        inputText: 'diagnose network connectivity issue',
        idempotencyKey: `retry-reg-submit-${crypto.randomUUID()}`,
      }),
    });
    expect(accepted.status).toBe(200);
    const body = (await accepted.json()) as { readonly sessionId: string; readonly requestId: string; readonly runId: string };
    await waitForTerminalCommit(gateCtx, body.runId);

    const retry = await fetch(`${gateCtx.baseUrl}/api/v1/sessions/${body.sessionId}/retry`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        expectedLatestRequestId: body.requestId,
        idempotencyKey: `retry-reg-retry-${crypto.randomUUID()}`,
      }),
    });
    expect(retry.status).toBe(200);
    const retryBody = (await retry.json()) as { readonly runId: string };
    expect(retryBody.runId).not.toBe(body.runId);

    const s2 = await fetch(`${gateCtx.baseUrl}/api/v1/sessions/${body.sessionId}/stream?lastSeenSequence=0&runId=${retryBody.runId}`);
    const s2Body = await s2.text();
    expect(s2Body).toContain('Retry attempt result.');
    expect(s2Body).toContain('REQUEST_COMPLETED');
  }, 30_000);

  it('retry of non-directive request does not accidentally route to workflow', async () => {
    const root = await mkdtemp(join(tmpdir(), 'nextagent-retry-noop-'));
    cleanupPaths.push(root);

    const executed: WorkflowExecutionRequest[] = [];
    const modelCalls: ModelInvocationRequest[] = [];
    const port = await reserveFreePort();
    const app = createComposedApp(
      {
        identity: composedIdentity,
        systemConfig: createSystemConfig(root, port),
        agentDefinition: createAgentDefinition(),
        credentialResolver: createAppCredentialResolver({ NEXTAGENT_TEST_ONLY: 'test-only' }),
        workflowExecutionServiceFactory: () => workflowService(executed),
      },
      captureModel(modelCalls),
    );
    composedApps.push(app);
    await app.start();
    const baseUrl = `http://127.0.0.1:${port}`;

    const accepted = await fetch(`${baseUrl}/api/v1/requests`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        inputText: 'diagnose network connectivity issue',
        idempotencyKey: `retry-noop-submit-${crypto.randomUUID()}`,
      }),
    });
    expect(accepted.status).toBe(200);
    const body = (await accepted.json()) as { readonly sessionId: string; readonly requestId: string; readonly runId: string };
    await waitForComposedRunTerminal(app, body.runId);

    expect(executed).toHaveLength(0);
    expect(modelCalls).toHaveLength(1);

    const retry = await fetch(`${baseUrl}/api/v1/sessions/${body.sessionId}/retry`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        expectedLatestRequestId: body.requestId,
        idempotencyKey: `retry-noop-retry-${crypto.randomUUID()}`,
      }),
    });
    expect(retry.status).toBe(200);
    const retryBody = (await retry.json()) as { readonly runId: string };
    await waitForComposedRunTerminal(app, retryBody.runId);

    expect(executed).toHaveLength(0);
    expect(modelCalls).toHaveLength(2);
  }, 30_000);
});

async function waitForComposedRunTerminal(app: ReturnType<typeof createComposedApp>, runId: string, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const run = await app.gateway.requestRuns.loadRun({
      tenantId: composedIdentity.tenantId,
      subjectId: composedIdentity.subjectId,
      agentId,
      runId: brand<string, 'RequestRunId'>(runId),
    });
    if (run?.terminalCommitState === 'COMMITTED') {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Timed out waiting for terminal commit: ${runId}`);
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
    displayName: 'Retry directive recovery test agent',
    description: 'Retry directive recovery test agent.',
    modelIds: ['MiniMax-M2.7'],
    capabilityBindings: [],
    runtimeSettings: {
      defaultLanguage: 'zh-CN',

      requestTimeoutMs: 30_000,
    },
    resources: [],
  };
}

function workflowService(captured: WorkflowExecutionRequest[]): WorkflowExecutionService {
  return {
    async execute(request) {
      captured.push(request);
      return {
        executionId: `workflow-execution-${captured.length}`,
        status: 'COMPLETED',
        outputVariables: { message: 'workflow completed' },
        nodeResults: [],
        startedAt: new Date('2026-07-10T00:00:00.000Z'),
        completedAt: new Date('2026-07-10T00:00:00.000Z'),
      };
    },
  };
}

function captureModel(captured: ModelInvocationRequest[]): ModelInvocationService {
  return {
    async complete() {
      return { content: 'ok' };
    },
    stream: modelEventStreamFixture(async function* (request) {
      captured.push(request);
      yield { content: 'ok', finishReason: 'stop' };
    }),
  };
}

function recipe(recipeName: string, version: string) {
  return {
    name: recipeName,
    version,
    description: recipeName,
    nodes: {
      start: {
        type: 'start-event',
        next: {
          end: {
            condition: '',
          },
        },
      },
      end: {
        type: 'end-event',
      },
    },
  };
}
