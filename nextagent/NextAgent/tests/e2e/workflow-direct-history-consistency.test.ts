import {
  createAppCredentialResolver,
  createComposedApp,
  validateDefaultSystemConfig,
  type AgentDefinition,
  type DefaultSystemConfig,
} from '@nextagent/agent-platform-gateway-local/testing';
import { brand, type JsonObject } from '@nextagent/agent-common';
import type { StreamEnvelope } from '@nextagent/agent-contracts/channel';
import type { WorkflowExecutionEvent, WorkflowExecutionRequest, WorkflowExecutionService } from '@nextagent/agent-contracts/core';
import { createDeterministicModelInvocationService } from '@nextagent/agent-model/testing';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { reserveFreePort } from './e2e-helpers.js';

const agentId = brand<string, 'AgentId'>('default-agent');
const identity = {
  tenantId: brand<string, 'TenantId'>('tenant-workflow-history'),
  subjectId: brand<string, 'SubjectId'>('subject-workflow-history'),
  displayName: 'Workflow history tester',
};
const terminalAnswer = 'Canonical workflow terminal answer.';
const completedProductBeforeFailure = 'Completed product before the Workflow failed.';
const liveOnlyFailureFragment = 'Unfinished Workflow fragment that must remain live-only.';
const rawFailureBody = 'raw provider failure at /private/workflow-secret.json';

describe('Direct Workflow live/history consistency', () => {
  const cleanupPaths: string[] = [];
  const apps: Array<ReturnType<typeof createComposedApp>> = [];
  const executionReleases: Array<() => void> = [];

  afterEach(async () => {
    while (executionReleases.length > 0) {
      executionReleases.pop()!();
    }
    while (apps.length > 0) {
      await apps.pop()!.close();
    }
    while (cleanupPaths.length > 0) {
      await rm(cleanupPaths.pop()!, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    }
  });

  it('restores Event-owned Workflow process and the Message-owned terminal answer after reload', async () => {
    const root = await mkdtemp(join(tmpdir(), 'nextagent-workflow-direct-history-'));
    cleanupPaths.push(root);
    await mkdir(join(root, 'agents', 'default-agent', 'recipes'), { recursive: true });
    await writeFile(join(root, 'agents', 'default-agent', 'recipes', 'direct-history.yaml'), JSON.stringify(directHistoryRecipe()), 'utf8');

    const executionEntered = deferred();
    const executionRelease = deferred();
    executionReleases.push(executionRelease.resolve);
    const executed: WorkflowExecutionRequest[] = [];
    const model = createDeterministicModelInvocationService([{ content: 'model loop must not run' }]);
    const port = await reserveFreePort();
    const app = createComposedApp(
      {
        identity,
        systemConfig: createSystemConfig(root, port),
        agentDefinition: createAgentDefinition(),
        credentialResolver: createAppCredentialResolver({ NEXTAGENT_TEST_ONLY: 'test-only' }),
        workflowExecutionServiceFactory: () => workflowService(executed, executionEntered, executionRelease),
      },
      model,
    );
    apps.push(app);
    await app.start();
    const baseUrl = `http://127.0.0.1:${port}`;

    const accepted = await fetch(`${baseUrl}/api/v1/requests`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        inputText: 'Run the direct workflow.',
        idempotencyKey: `workflow-direct-history-${crypto.randomUUID()}`,
        routingConstraints: { targetRecipe: 'direct-history' },
      }),
    });
    expect(accepted.status).toBe(200);
    const acceptedBody = (await accepted.json()) as { readonly sessionId: string; readonly requestId: string; readonly runId: string };

    await executionEntered.promise;
    const liveResponse = await fetch(`${baseUrl}/api/v1/sessions/${acceptedBody.sessionId}/stream?lastSeenSequence=0&runId=${acceptedBody.runId}`);
    expect(liveResponse.status).toBe(200);
    executionRelease.resolve();
    const liveEnvelopes = parseSseEnvelopes(await liveResponse.text());
    await waitForRunTerminal(app, acceptedBody.runId);

    const [conversationResponse, historyResponse, messages] = await Promise.all([
      fetch(`${baseUrl}/api/v1/sessions/${acceptedBody.sessionId}/conversation?limit=50&includeCapabilityResults=true`),
      fetch(`${baseUrl}/api/v1/sessions/${acceptedBody.sessionId}/runs/${acceptedBody.runId}/events?limit=100`),
      app.gateway.messages.listMessages({
        tenantId: identity.tenantId,
        subjectId: identity.subjectId,
        agentId,
        sessionId: brand<string, 'SessionId'>(acceptedBody.sessionId),
        includeHidden: true,
        includeCapabilityResults: true,
        limit: 50,
      }),
    ]);
    expect(conversationResponse.status).toBe(200);
    expect(historyResponse.status).toBe(200);

    const conversation = (await conversationResponse.json()) as ConversationResponse;
    const history = (await historyResponse.json()) as EventHistoryResponse;
    expect(history.availability).toBe('AVAILABLE');
    const terminalMessage = conversation.items.find((item) => item.role === 'ASSISTANT' && item.metadata?.['eventType'] === 'REQUEST_COMPLETED');
    expect(terminalMessage).toMatchObject({ content: terminalAnswer, visible: true });

    expect(executed).toHaveLength(1);
    expect(model.requests).toHaveLength(0);
    expect(messages.items.filter((message) => message.role === 'CAPABILITY_RESULT' || message.metadata['kind'] === 'ASSISTANT_TOOL_USE')).toEqual([]);
    expect(messages.items.filter((message) => message.role === 'USER')).toHaveLength(1);
    expect(messages.items.filter((message) => message.role === 'ASSISTANT')).toHaveLength(1);
    expect(messages.items.find((message) => message.role === 'ASSISTANT')).toMatchObject({
      messageId: terminalMessage?.messageId,
      content: terminalAnswer,
      visible: true,
      metadata: { eventType: 'REQUEST_COMPLETED', status: 'COMPLETED' },
    });

    const historyProducts = history.events
      .filter((event) => event.eventType === 'TOOL_STRUCTURED_DELTA' && event.payload.workflowEventType === 'NODE_COMPLETED')
      .map((event) => ({
        nodeId: event.payload.nodeId,
        level: event.payload.toolEventType,
        type: event.payload.toolMessageType,
        content: event.payload.content,
      }));
    expect(historyProducts).toEqual([
      { nodeId: 'toolNode', level: 'DETAIL', type: 'TEXT', content: 'Tool product text.' },
      { nodeId: 'skillNode', level: 'DETAIL', type: 'DSL', content: '<workflow-dsl>skill product</workflow-dsl>' },
      {
        nodeId: 'subflowNode',
        level: 'ANSWER',
        type: 'PIU',
        content: { kind: 'workflow-card', title: 'Subflow product', state: 'healthy' },
      },
    ]);

    for (const event of history.events.filter(isWorkflowLifecycle)) {
      expect(event.payload).not.toHaveProperty('messageId');
      for (const bodyField of ['description', 'input', 'output', 'arguments', 'result', 'safeResult', 'structuredPayload']) {
        expect(event.payload).not.toHaveProperty(bodyField);
      }
    }
    expect(liveEnvelopes.some((event) => event.eventType === 'CAPABILITY_RESULT_DELTA')).toBe(false);
    expect(history.events.some((event) => event.eventType === 'CAPABILITY_RESULT_DELTA')).toBe(false);

    expect(workflowSnapshot(history.events, terminalMessage!.content)).toEqual(workflowSnapshot(liveEnvelopes, terminalAnswer));
  }, 20_000);

  it('restores only completed product and safe node status when a later Workflow node fails', async () => {
    const root = await mkdtemp(join(tmpdir(), 'nextagent-workflow-direct-failure-history-'));
    cleanupPaths.push(root);
    await mkdir(join(root, 'agents', 'default-agent', 'recipes'), { recursive: true });
    await writeFile(join(root, 'agents', 'default-agent', 'recipes', 'direct-history.yaml'), JSON.stringify(directHistoryRecipe()), 'utf8');

    const executionEntered = deferred();
    const executionRelease = deferred();
    executionReleases.push(executionRelease.resolve);
    const executed: WorkflowExecutionRequest[] = [];
    const model = createDeterministicModelInvocationService([{ content: 'model loop must not run' }]);
    const port = await reserveFreePort();
    const app = createComposedApp(
      {
        identity,
        systemConfig: createSystemConfig(root, port),
        agentDefinition: createAgentDefinition(),
        credentialResolver: createAppCredentialResolver({ NEXTAGENT_TEST_ONLY: 'test-only' }),
        workflowExecutionServiceFactory: () => failingWorkflowService(executed, executionEntered, executionRelease),
      },
      model,
    );
    apps.push(app);
    await app.start();
    const baseUrl = `http://127.0.0.1:${port}`;

    const accepted = await fetch(`${baseUrl}/api/v1/requests`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        inputText: 'Run the direct workflow that will fail safely.',
        idempotencyKey: `workflow-direct-failure-history-${crypto.randomUUID()}`,
        routingConstraints: { targetRecipe: 'direct-history' },
      }),
    });
    expect(accepted.status).toBe(200);
    const acceptedBody = (await accepted.json()) as { readonly sessionId: string; readonly runId: string };

    await executionEntered.promise;
    const liveResponse = await fetch(`${baseUrl}/api/v1/sessions/${acceptedBody.sessionId}/stream?lastSeenSequence=0&runId=${acceptedBody.runId}`);
    expect(liveResponse.status).toBe(200);
    executionRelease.resolve();
    const liveEnvelopes = parseSseEnvelopes(await liveResponse.text());
    await waitForRunTerminal(app, acceptedBody.runId);

    const [conversationResponse, historyResponse, messages] = await Promise.all([
      fetch(`${baseUrl}/api/v1/sessions/${acceptedBody.sessionId}/conversation?limit=50&includeCapabilityResults=true`),
      fetch(`${baseUrl}/api/v1/sessions/${acceptedBody.sessionId}/runs/${acceptedBody.runId}/events?limit=100`),
      app.gateway.messages.listMessages({
        tenantId: identity.tenantId,
        subjectId: identity.subjectId,
        agentId,
        sessionId: brand<string, 'SessionId'>(acceptedBody.sessionId),
        includeHidden: true,
        includeCapabilityResults: true,
        limit: 50,
      }),
    ]);
    expect(conversationResponse.status).toBe(200);
    expect(historyResponse.status).toBe(200);

    const conversation = (await conversationResponse.json()) as ConversationResponse;
    const history = (await historyResponse.json()) as EventHistoryResponse;
    expect(history.availability).toBe('AVAILABLE');
    expect(executed).toHaveLength(1);
    expect(model.requests).toHaveLength(0);

    expect(
      liveEnvelopes.some(
        (event) =>
          event.eventType === 'TOOL_STRUCTURED_DELTA' &&
          event.payload.workflowEventType === 'NODE_OUTPUT_DELTA' &&
          event.payload.content === liveOnlyFailureFragment,
      ),
    ).toBe(true);

    const completedProducts = history.events
      .filter((event) => event.eventType === 'TOOL_STRUCTURED_DELTA' && event.payload.workflowEventType === 'NODE_COMPLETED')
      .map((event) => ({ nodeId: event.payload.nodeId, type: event.payload.toolMessageType, content: event.payload.content }));
    expect(completedProducts).toEqual([{ nodeId: 'toolNode', type: 'TEXT', content: completedProductBeforeFailure }]);
    expect(history.events.some((event) => event.payload.workflowEventType === 'NODE_OUTPUT_DELTA')).toBe(false);

    const failedNode = history.events.find(
      (event) =>
        event.eventType === 'CAPABILITY_COMPLETED' && event.payload.workflowEventType === 'NODE_FAILED' && event.payload.nodeId === 'skillNode',
    );
    expect(failedNode?.payload).toMatchObject({
      nodeType: 'SKILL',
      status: 'FAILED',
      safeErrorCode: 'WORKFLOW_SKILL_FAILED',
      safeErrorCategory: 'INTERNAL',
    });
    expect(failedNode?.payload).not.toHaveProperty('messageId');
    expect(failedNode?.payload).not.toHaveProperty('contentUnavailable');

    const coldHistoryJson = JSON.stringify(history);
    expect(coldHistoryJson).not.toContain(liveOnlyFailureFragment);
    expect(coldHistoryJson).not.toContain(rawFailureBody);
    expect(messages.items.filter((message) => message.role === 'CAPABILITY_RESULT' || message.metadata['kind'] === 'ASSISTANT_TOOL_USE')).toEqual([]);
    const terminalFailureMessage = conversation.items.find((item) => item.role === 'ASSISTANT' && item.metadata?.['eventType'] === 'REQUEST_FAILED');
    expect(terminalFailureMessage).toMatchObject({ visible: true, metadata: { status: 'FAILED' } });
    expect(terminalFailureMessage?.content).not.toContain(liveOnlyFailureFragment);
    expect(terminalFailureMessage?.content).not.toContain(rawFailureBody);
  }, 20_000);
});

interface ConversationResponse {
  readonly items: ReadonlyArray<{
    readonly messageId: string;
    readonly role: string;
    readonly content: string;
    readonly visible: boolean;
    readonly metadata?: Readonly<Record<string, unknown>>;
  }>;
}

interface EventHistoryResponse {
  readonly availability: string;
  readonly events: readonly StreamEnvelope[];
}

interface Deferred {
  readonly promise: Promise<void>;
  readonly resolve: () => void;
}

function deferred(): Deferred {
  let resolvePromise!: () => void;
  const promise = new Promise<void>((resolve) => {
    resolvePromise = resolve;
  });
  return { promise, resolve: resolvePromise };
}

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
  throw new Error('Timed out waiting for Direct Workflow terminal commit.');
}

function workflowService(captured: WorkflowExecutionRequest[], entered: Deferred, release: Deferred): WorkflowExecutionService {
  return {
    async execute(request, signal, observer) {
      captured.push(request);
      entered.resolve();
      await release.promise;
      signal.throwIfAborted();

      const events = workflowEvents();
      for (const event of events) {
        await observer?.emitEvent(event);
      }
      return {
        executionId: 'workflow-execution-direct-history',
        status: 'COMPLETED',
        outputVariables: { message: terminalAnswer },
        nodeResults: [],
        startedAt: events[0]!.startedAt,
        completedAt: events.at(-1)!.completedAt!,
      };
    },
  };
}

function failingWorkflowService(captured: WorkflowExecutionRequest[], entered: Deferred, release: Deferred): WorkflowExecutionService {
  return {
    async execute(request, signal, observer) {
      captured.push(request);
      entered.resolve();
      await release.promise;
      signal.throwIfAborted();

      const events = failingWorkflowEvents();
      for (const event of events) {
        await observer?.emitEvent(event);
      }
      const safeError = {
        code: 'WORKFLOW_SKILL_FAILED',
        message: 'Workflow skill failed safely.',
        category: 'INTERNAL',
        retryable: false,
      } as const;
      return {
        executionId: 'workflow-execution-direct-failure-history',
        status: 'FAILED',
        outputVariables: {},
        nodeResults: [
          {
            nodeId: 'toolNode',
            nodeType: 'TOOL',
            status: 'NODE_COMPLETED',
            output: { level: 'detail', type: 'text', content: completedProductBeforeFailure },
            retryCount: 0,
            startedAt: events[0]!.startedAt,
            completedAt: events[1]!.completedAt!,
          },
          {
            nodeId: 'skillNode',
            nodeType: 'SKILL',
            status: 'NODE_FAILED',
            output: { rawFailureBody },
            safeError,
            retryCount: 0,
            startedAt: events[2]!.startedAt,
            completedAt: events.at(-1)!.completedAt!,
          },
        ],
        startedAt: events[0]!.startedAt,
        completedAt: events.at(-1)!.completedAt!,
      };
    },
  };
}

function workflowEvents(): readonly WorkflowExecutionEvent[] {
  const startedAt = new Date('2026-08-05T00:00:00.000Z');
  const nodeOutputs: ReadonlyArray<{
    readonly nodeId: string;
    readonly nodeType: 'TOOL' | 'SKILL' | 'SUBFLOW';
    readonly output: JsonObject;
  }> = [
    { nodeId: 'toolNode', nodeType: 'TOOL', output: { level: 'detail', type: 'text', content: 'Tool product text.' } },
    {
      nodeId: 'skillNode',
      nodeType: 'SKILL',
      output: { level: 'detail', type: 'dsl', content: '<workflow-dsl>skill product</workflow-dsl>' },
    },
    {
      nodeId: 'subflowNode',
      nodeType: 'SUBFLOW',
      output: { level: 'answer', type: 'piu', content: { kind: 'workflow-card', title: 'Subflow product', state: 'healthy' } },
    },
  ];
  return nodeOutputs.flatMap((node, index) => {
    const nodeStartedAt = new Date(startedAt.getTime() + index * 20);
    return [
      {
        executionId: 'workflow-execution-direct-history',
        nodeExecutionId: `node-execution-${index + 1}`,
        ...(index === 0 ? {} : { predecessorNodeExecutionIds: [`node-execution-${index}`] }),
        nodeId: node.nodeId,
        nodeType: node.nodeType,
        eventType: 'NODE_STARTED' as const,
        retryCount: 0,
        startedAt: nodeStartedAt,
      },
      {
        executionId: 'workflow-execution-direct-history',
        nodeExecutionId: `node-execution-${index + 1}`,
        ...(index === 0 ? {} : { predecessorNodeExecutionIds: [`node-execution-${index}`] }),
        nodeId: node.nodeId,
        nodeType: node.nodeType,
        eventType: 'NODE_COMPLETED' as const,
        output: node.output,
        retryCount: 0,
        startedAt: nodeStartedAt,
        completedAt: new Date(nodeStartedAt.getTime() + 10),
      },
    ];
  });
}

function failingWorkflowEvents(): readonly WorkflowExecutionEvent[] {
  const toolStartedAt = new Date('2026-08-05T01:00:00.000Z');
  const skillStartedAt = new Date('2026-08-05T01:00:00.020Z');
  const safeError = {
    code: 'WORKFLOW_SKILL_FAILED',
    message: 'Workflow skill failed safely.',
    category: 'INTERNAL',
    retryable: false,
  } as const;
  return [
    {
      executionId: 'workflow-execution-direct-failure-history',
      nodeExecutionId: 'node-execution-tool',
      nodeId: 'toolNode',
      nodeType: 'TOOL',
      eventType: 'NODE_STARTED',
      retryCount: 0,
      startedAt: toolStartedAt,
    },
    {
      executionId: 'workflow-execution-direct-failure-history',
      nodeExecutionId: 'node-execution-tool',
      nodeId: 'toolNode',
      nodeType: 'TOOL',
      eventType: 'NODE_COMPLETED',
      output: { level: 'detail', type: 'text', content: completedProductBeforeFailure },
      retryCount: 0,
      startedAt: toolStartedAt,
      completedAt: new Date(toolStartedAt.getTime() + 10),
    },
    {
      executionId: 'workflow-execution-direct-failure-history',
      nodeExecutionId: 'node-execution-skill',
      predecessorNodeExecutionIds: ['node-execution-tool'],
      nodeId: 'skillNode',
      nodeType: 'SKILL',
      eventType: 'NODE_STARTED',
      retryCount: 0,
      startedAt: skillStartedAt,
    },
    {
      executionId: 'workflow-execution-direct-failure-history',
      nodeExecutionId: 'node-execution-skill',
      predecessorNodeExecutionIds: ['node-execution-tool'],
      nodeId: 'skillNode',
      nodeType: 'SKILL',
      eventType: 'NODE_OUTPUT_DELTA',
      visibleDelta: { channel: 'CONTENT', content: liveOnlyFailureFragment, level: 'DETAIL' },
      retryCount: 0,
      startedAt: skillStartedAt,
    },
    {
      executionId: 'workflow-execution-direct-failure-history',
      nodeExecutionId: 'node-execution-skill',
      predecessorNodeExecutionIds: ['node-execution-tool'],
      nodeId: 'skillNode',
      nodeType: 'SKILL',
      eventType: 'NODE_FAILED',
      output: { rawFailureBody },
      safeError,
      retryCount: 0,
      startedAt: skillStartedAt,
      completedAt: new Date(skillStartedAt.getTime() + 10),
    },
  ];
}

function parseSseEnvelopes(body: string): StreamEnvelope[] {
  return body
    .split('\n')
    .filter((line) => line.startsWith('data: '))
    .map((line) => JSON.parse(line.slice('data: '.length)) as StreamEnvelope);
}

function isWorkflowLifecycle(event: StreamEnvelope): boolean {
  return (
    (event.eventType === 'CAPABILITY_STARTED' || event.eventType === 'CAPABILITY_COMPLETED') && typeof event.payload.workflowEventType === 'string'
  );
}

function workflowSnapshot(events: readonly StreamEnvelope[], canonicalAnswer: string) {
  const process: Array<Readonly<Record<string, unknown>>> = [];
  for (const event of events) {
    if (isWorkflowLifecycle(event)) {
      process.push({
        kind: 'LIFECYCLE',
        eventType: event.eventType,
        workflowEventType: event.payload.workflowEventType,
        nodeId: event.payload.nodeId,
        nodeType: event.payload.nodeType,
        status: event.payload.status,
      });
      continue;
    }
    if (event.eventType === 'TOOL_STRUCTURED_DELTA' && typeof event.payload.workflowEventType === 'string') {
      process.push({
        kind: 'PRODUCT',
        workflowEventType: event.payload.workflowEventType,
        nodeId: event.payload.nodeId,
        nodeType: event.payload.nodeType,
        level: event.payload.toolEventType,
        type: event.payload.toolMessageType,
        content: event.payload.content,
      });
    }
  }
  return {
    process,
    terminalAnswer: canonicalAnswer,
  };
}

function createSystemConfig(root: string, port: number): DefaultSystemConfig {
  const credentialResolver = createAppCredentialResolver({ NEXTAGENT_TEST_ONLY: 'test-only' });
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
    { credentialResolver },
  );
}

function createAgentDefinition(hooks: AgentDefinition['hooks'] = []): AgentDefinition {
  return {
    agentId,
    agentType: brand<string, 'AgentType'>('default'),
    agentVersion: brand<string, 'AgentVersion'>('v1'),
    displayName: 'Direct Workflow history test agent',
    description: 'Direct Workflow history test agent.',
    modelIds: ['deterministic-test-model'],
    capabilityBindings: [],
    hooks,
    runtimeSettings: { defaultLanguage: 'zh-CN', requestTimeoutMs: 30_000 },
    resources: [],
  };
}

function directHistoryRecipe() {
  return {
    name: 'direct-history',
    version: 'v1',
    description: 'Direct Workflow history fixture',
    nodes: {
      start: { type: 'start-event', next: { toolNode: { condition: '' } } },
      toolNode: {
        type: 'tool',
        description: 'Run diagnostic tool',
        inputs: { tool_name: 'DiagnosticTool' },
        next: { skillNode: { condition: '' } },
      },
      skillNode: {
        type: 'skill',
        description: 'Apply diagnostic skill',
        inputs: { skill_name: 'DiagnosticSkill' },
        next: { subflowNode: { condition: '' } },
      },
      subflowNode: {
        type: 'sub-recipe',
        description: 'Run diagnostic subflow',
        inputs: { recipe_name: 'DiagnosticSubflow' },
        next: { end: { condition: '' } },
      },
      end: { type: 'end-event' },
    },
  };
}
