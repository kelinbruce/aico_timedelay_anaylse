import { modelEventStreamFixture } from '../helpers/model-stream-fixture.js';
import { brand } from '@nextagent/agent-common';
import type { ModelInvocationRequest, ModelInvocationService } from '@nextagent/agent-contracts/model';
import {
  cleanupNextAgentTestApps,
  createAppCredentialResolver,
  createComposedAppAsync,
  validateDefaultSystemConfig,
  type AgentDefinition,
  type CreateComposedAppOptions,
  type DefaultSystemConfig,
} from '@nextagent/agent-platform-gateway-local/testing';
import {
  createLocalGatewayProvider,
  createSqliteLongTermMemoryGatewayProvider,
  createSqliteWorkingMemoryGatewayProvider,
} from '@nextagent/agent-platform-gateway-local';
import type { AgentRoutingPolicy } from '@nextagent/agent-plugin-sdk';
import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { reserveFreePort } from '../e2e/e2e-helpers.js';

const pluginId = 'telecom-routing';
const agentId = brand<string, 'AgentId'>('default-agent');
const identity = {
  tenantId: brand<string, 'TenantId'>('tenant-plugin-routing'),
  subjectId: brand<string, 'SubjectId'>('subject-plugin-routing'),
  displayName: 'Plugin routing tester',
};

type PluginRegistrySnapshot = NonNullable<CreateComposedAppOptions['pluginRegistrySnapshot']>;

describe('plugin routing policy', () => {
  afterEach(async () => {
    await cleanupNextAgentTestApps();
  });

  it('uses the Agent-scoped plugin routing policy when the accepted assembly activates it', async () => {
    const modelCalls: ModelInvocationRequest[] = [];
    const app = await createRoutingApp({
      modelCalls,
      agentDefinition: createAgentDefinition({ enabled: true }),
      pluginRegistrySnapshot: registrySnapshot(rejectingPolicy()),
    });
    await app.start();

    const run = await submitAndLoadRun(app.port, app, 'trigger plugin reject');

    expect(run).toMatchObject({ status: 'FAILED', terminalCommitState: 'COMMITTED' });
    expect(modelCalls).toHaveLength(0);
  });

  it('delegates to the built-in routing policy when no enabled Agent policy binding exists', async () => {
    for (const agentDefinition of [createAgentDefinition({ policies: [] }), createAgentDefinition({ enabled: false })]) {
      const modelCalls: ModelInvocationRequest[] = [];
      const app = await createRoutingApp({
        modelCalls,
        agentDefinition,
        pluginRegistrySnapshot: registrySnapshot(rejectingPolicy()),
      });
      await app.start();

      const run = await submitAndLoadRun(app.port, app, 'normal request');

      expect(run).toMatchObject({ status: 'COMPLETED', terminalCommitState: 'COMMITTED' });
      expect(modelCalls).toHaveLength(1);
      await cleanupNextAgentTestApps();
    }
  });

  it('fails closed when a plugin routing policy throws or returns an invalid result', async () => {
    for (const policy of [throwingPolicy(), invalidPolicy()]) {
      const modelCalls: ModelInvocationRequest[] = [];
      const app = await createRoutingApp({
        modelCalls,
        agentDefinition: createAgentDefinition({ enabled: true }),
        pluginRegistrySnapshot: registrySnapshot(policy),
      });
      await app.start();

      const run = await submitAndLoadRun(app.port, app, 'unsafe plugin behavior');

      expect(run).toMatchObject({ status: 'FAILED', terminalCommitState: 'COMMITTED' });
      expect(modelCalls).toHaveLength(0);
      await cleanupNextAgentTestApps();
    }
  });
});

async function createRoutingApp(input: {
  readonly modelCalls: ModelInvocationRequest[];
  readonly agentDefinition: AgentDefinition;
  readonly pluginRegistrySnapshot: PluginRegistrySnapshot;
}) {
  const root = await mkdtemp(join(tmpdir(), 'nextagent-plugin-routing-'));
  const port = await reserveFreePort();
  const app = await createComposedAppAsync(
    {
      identity,
      systemConfig: createSystemConfig(root, port),
      agentDefinition: input.agentDefinition,
      credentialResolver: createAppCredentialResolver({ NEXTAGENT_TEST_ONLY: 'test-only' }),
      gatewayProviders: [createSqliteWorkingMemoryGatewayProvider(), createSqliteLongTermMemoryGatewayProvider(), createLocalGatewayProvider()],
      pluginRegistrySnapshot: input.pluginRegistrySnapshot,
    },
    captureModel(input.modelCalls),
  );
  return Object.assign(app, { port });
}

async function submitAndLoadRun(port: number, app: Awaited<ReturnType<typeof createComposedAppAsync>>, inputText: string) {
  const accepted = await fetch(`http://127.0.0.1:${port}/api/v1/requests`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      inputText,
      idempotencyKey: `plugin-routing-${crypto.randomUUID()}`,
    }),
  });
  expect(accepted.status).toBe(200);
  const body = (await accepted.json()) as { readonly runId: string };
  await waitForRunTerminal(app, body.runId);
  return app.gateway.requestRuns.loadRun({
    tenantId: identity.tenantId,
    subjectId: identity.subjectId,
    agentId,
    runId: brand<string, 'RequestRunId'>(body.runId),
  });
}

async function waitForRunTerminal(app: Awaited<ReturnType<typeof createComposedAppAsync>>, runId: string, timeoutMs = 5_000): Promise<void> {
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
  throw new Error('Timed out waiting for plugin routing request terminal commit.');
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

function createAgentDefinition(input: { readonly enabled?: boolean; readonly policies?: AgentDefinition['policies'] }): AgentDefinition {
  return {
    agentId,
    agentType: brand<string, 'AgentType'>('default'),
    agentVersion: brand<string, 'AgentVersion'>('v1'),
    displayName: 'Plugin routing test agent',
    description: 'Plugin routing test agent.',
    modelIds: ['MiniMax-M2.7'],
    capabilityBindings: [],
    policies: input.policies ?? [
      {
        policyPointId: 'agentRoutingPolicy',
        pluginId,
        policyId: 'reject-trigger',
        ...(input.enabled === undefined ? {} : { enabled: input.enabled }),
      },
    ],
    runtimeSettings: {
      defaultLanguage: 'zh-CN',

      requestTimeoutMs: 30_000,
    },
    resources: [],
  };
}

function registrySnapshot(policy: AgentRoutingPolicy): PluginRegistrySnapshot {
  return Object.freeze({
    plugins: Object.freeze([{ pluginId, version: '1.0.0' }]),
    providers: Object.freeze([]),
    policies: Object.freeze([{ pluginId, policy }]),
    hooks: Object.freeze([]),
    diagnostics: Object.freeze([]),
  });
}

function rejectingPolicy(): AgentRoutingPolicy {
  return {
    policyPointId: 'agentRoutingPolicy',
    policyId: 'reject-trigger',
    decide(run, context) {
      if (run.agentId !== 'default-agent' || context.acceptedInputText !== 'trigger plugin reject') {
        return { kind: 'MODEL_DRIVEN_LOOP', safeReason: 'PLUGIN_ROUTING_INPUT_NOT_FORWARDED' };
      }
      return { kind: 'REJECT', safeReason: 'PLUGIN_ROUTING_REJECTED' };
    },
  };
}

function throwingPolicy(): AgentRoutingPolicy {
  return {
    policyPointId: 'agentRoutingPolicy',
    policyId: 'reject-trigger',
    decide() {
      throw new Error('unsafe plugin failure');
    },
  };
}

function invalidPolicy(): AgentRoutingPolicy {
  return {
    policyPointId: 'agentRoutingPolicy',
    policyId: 'reject-trigger',
    decide() {
      return { kind: 'NOT_A_ROUTING_DECISION', safeReason: 'invalid' } as never;
    },
  };
}

function captureModel(captured: ModelInvocationRequest[]): ModelInvocationService {
  return {
    async complete() {
      return { content: 'model response' };
    },
    stream: modelEventStreamFixture(async function* (request) {
      captured.push(request);
      yield { content: 'model response', finishReason: 'stop' };
    }),
  };
}
