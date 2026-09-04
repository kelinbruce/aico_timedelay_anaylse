import { modelEventStreamFixture } from '../../helpers/model-stream-fixture.js';
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
import { reserveFreePort } from '../e2e-helpers.js';
import { recordCaseResult } from './case-inventory.js';

const agentId = brand<string, 'AgentId'>('default-agent');
const identity = {
  tenantId: brand<string, 'TenantId'>('tenant-p1p2-gate'),
  subjectId: brand<string, 'SubjectId'>('subject-p1p2-gate'),
  displayName: 'P1/P2 workflow gate tester',
};

describe('p1-p2 scenario gate: workflow routing', () => {
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

  it('routes targetRecipe through the real request path into workflow execution', async () => {
    const root = await mkdtemp(join(tmpdir(), 'nextagent-p1p2-workflow-'));
    cleanupPaths.push(root);

    try {
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
          identity,
          systemConfig: createSystemConfig(root, port),
          agentDefinition: createAgentDefinition(),
          credentialResolver: createAppCredentialResolver({ NEXTAGENT_TEST_ONLY: 'test-only' }),
          workflowExecutionServiceFactory: () => workflowService(executed),
        },
        captureModel(modelCalls),
      );
      apps.push(app);
      await app.start();
      const baseUrl = `http://127.0.0.1:${port}`;

      const accepted = await fetch(`${baseUrl}/api/v1/requests`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          inputText: 'run workflow',
          idempotencyKey: `p1p2-workflow-${crypto.randomUUID()}`,
          routingConstraints: { targetRecipe: 'ran-alarm-diagnosis' },
        }),
      });
      expect(accepted.status).toBe(200);
      const body = (await accepted.json()) as { readonly sessionId: string; readonly requestId: string; readonly runId: string };

      await waitForRunTerminal(app, body.runId);

      const conversation = await fetch(`${baseUrl}/api/v1/sessions/${body.sessionId}/conversation?limit=50&includeCapabilityResults=true`);
      expect(conversation.status).toBe(200);
      const payload = (await conversation.json()) as { readonly items: Array<{ readonly role: string; readonly content: string }> };

      expect(executed).toHaveLength(1);
      expect(executed[0]).toMatchObject({ recipeName: 'ran-alarm-diagnosis', recipeVersion: 'v1', agentId: 'default-agent' });
      expect(modelCalls).toHaveLength(0);
      expect(payload.items.some((item) => item.role === 'ASSISTANT' && item.content === 'workflow completed')).toBe(true);

      recordCaseResult('e2e-P1P2-05', 'PASSED', {
        evidenceRefs: ['evidence://p1-p2/workflow-routing/request', 'evidence://p1-p2/workflow-routing/conversation'],
      });
    } catch (error) {
      recordCaseResult('e2e-P1P2-05', 'FAILED', {
        safeReason: 'workflow routing gate case failed',
        evidenceRefs: ['evidence://p1-p2/workflow-routing/failure'],
      });
      throw error;
    }
  }, 20_000);
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
  throw new Error('Timed out waiting for workflow request terminal commit.');
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
    displayName: 'Workflow composition test agent',
    description: 'Workflow composition test agent.',
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
        executionId: 'workflow-execution-1',
        status: 'COMPLETED',
        outputVariables: { message: 'workflow completed' },
        nodeResults: [],
        startedAt: new Date('2026-06-23T00:00:00.000Z'),
        completedAt: new Date('2026-06-23T00:00:00.000Z'),
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
