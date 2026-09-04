import { modelEventStreamFixture } from '../helpers/model-stream-fixture.js';
import { brand } from '@nextagent/agent-common';
import type { ModelInvocationRequest, ModelInvocationService } from '@nextagent/agent-contracts/model';
import type { RunTimelineEvent } from '@nextagent/agent-contracts/runtime';
import {
  cleanupNextAgentTestApps,
  createAppCredentialResolver,
  createComposedAppAsync,
  validateDefaultSystemConfig,
  type AgentDefinition,
  type DefaultSystemConfig,
} from '@nextagent/agent-platform-gateway-local/testing';
import {
  createLocalGatewayProvider,
  createSqliteLongTermMemoryGatewayProvider,
  createSqliteWorkingMemoryGatewayProvider,
} from '@nextagent/agent-platform-gateway-local';
import { LATEST_PLUGIN_API_VERSION } from '@nextagent/agent-plugin-sdk';
import { createPluginScaffold } from '@nextagent/agent-plugin-sdk/scaffold';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ModuleKind, ScriptTarget, transpileModule } from 'typescript';
import { afterEach, describe, expect, it } from 'vitest';
import { reserveFreePort } from './e2e-helpers.js';

const pluginId = 'telecom-routing';
const agentId = brand<string, 'AgentId'>('default-agent');
const identity = {
  tenantId: brand<string, 'TenantId'>('tenant-plugin-e2e'),
  subjectId: brand<string, 'SubjectId'>('subject-plugin-e2e'),
  displayName: 'Plugin e2e tester',
};

describe('plugin composition product path', () => {
  const cleanupPaths: string[] = [];

  afterEach(async () => {
    await cleanupNextAgentTestApps();
    while (cleanupPaths.length > 0) {
      await rm(cleanupPaths.pop()!, { recursive: true, force: true });
    }
  });

  it('builds a local plugin bundle, loads it through app composition, and applies its Agent-scoped routing policy', async () => {
    const root = await mkdtemp(join(tmpdir(), 'nextagent-plugin-product-path-'));
    cleanupPaths.push(root);
    const port = await reserveFreePort();
    const pluginProjectDir = join(root, 'plugin-projects', pluginId);
    const pluginArtifactDir = join(root, 'plugins', pluginId);
    createPluginScaffold({ targetDirectory: pluginProjectDir });
    await writeFile(join(pluginProjectDir, 'src', 'index.ts'), routingPolicyPluginSource(), 'utf8');
    await buildPluginBundle(pluginProjectDir, pluginArtifactDir);

    const modelCalls: ModelInvocationRequest[] = [];
    const app = await createComposedAppAsync(
      {
        identity,
        systemConfig: createSystemConfig(root, port),
        agentDefinition: createAgentDefinition(),
        credentialResolver: createAppCredentialResolver({ NEXTAGENT_TEST_ONLY: 'test-only' }),
        gatewayProviders: [createSqliteWorkingMemoryGatewayProvider(), createSqliteLongTermMemoryGatewayProvider(), createLocalGatewayProvider()],
      },
      captureModel(modelCalls),
    );
    await app.start();

    const accepted = await fetch(`http://127.0.0.1:${port}/api/v1/requests`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        inputText: 'trigger plugin reject',
        idempotencyKey: `plugin-e2e-${crypto.randomUUID()}`,
      }),
    });
    expect(accepted.status).toBe(200);
    const body = (await accepted.json()) as { readonly sessionId: string; readonly requestId: string; readonly runId: string };

    await waitForRunTerminal(app, body.runId);

    const run = await app.gateway.requestRuns.loadRun({
      tenantId: identity.tenantId,
      subjectId: identity.subjectId,
      agentId,
      runId: brand<string, 'RequestRunId'>(body.runId),
    });
    const events = await listTimelineEvents(app, body.sessionId, body.runId);

    expect(run).toMatchObject({ status: 'FAILED', terminalCommitState: 'COMMITTED' });
    expect(modelCalls).toHaveLength(0);
    expect(events.find((event) => event.type === 'POLICY_APPLIED')?.inlinePayload).toMatchObject({
      policyDomain: 'ROUTING',
      outcome: 'rejected',
      reasonCode: 'PLUGIN_E2E_REJECTED',
    });
    expect(events.map((event) => event.type)).toContain('REQUEST_FAILED');
  }, 20_000);
});

async function buildPluginBundle(pluginProjectDir: string, pluginArtifactDir: string): Promise<void> {
  const source = await readFile(join(pluginProjectDir, 'src', 'index.ts'), 'utf8');
  const output = transpileModule(source, {
    compilerOptions: {
      module: ModuleKind.ES2022,
      target: ScriptTarget.ES2022,
      strict: true,
    },
  });
  await mkdir(pluginArtifactDir, { recursive: true });
  await writeFile(join(pluginArtifactDir, 'index.js'), output.outputText, 'utf8');
  await writeFile(
    join(pluginArtifactDir, 'plugin.json'),
    `${JSON.stringify(
      {
        pluginId,
        version: '1.0.0',
        apiVersion: LATEST_PLUGIN_API_VERSION,
        main: './index.js',
        artifactType: 'esm-bundle',
        hostExternals: [],
      },
      null,
      2,
    )}\n`,
    'utf8',
  );
}

function routingPolicyPluginSource(): string {
  return `
function definePlugin(plugin) {
  return Object.freeze({
    pluginId: plugin.pluginId,
    apiVersion: plugin.apiVersion ?? "1.0",
    version: plugin.version,
    policies: Object.freeze([...(plugin.policies ?? [])])
  });
}

function defineAgentRoutingPolicy(policy) {
  return Object.freeze({ ...policy });
}

export default function createPlugin() {
  return definePlugin({
    pluginId: "${pluginId}",
    apiVersion: "${LATEST_PLUGIN_API_VERSION}",
    version: "1.0.0",
    policies: [
      defineAgentRoutingPolicy({
        policyPointId: "agentRoutingPolicy",
        policyId: "reject-trigger",
        decide(run, context) {
          if (run.agentId !== "default-agent" || context.acceptedInputText !== "trigger plugin reject") {
            return { kind: "MODEL_DRIVEN_LOOP", safeReason: "PLUGIN_E2E_INPUT_NOT_FORWARDED" };
          }
          return { kind: "REJECT", safeReason: "PLUGIN_E2E_REJECTED" };
        }
      })
    ]
  });
}
`;
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
      nextAgent: {
        system: {
          plugins: [{ pluginId, path: `plugins/${pluginId}`, required: true }],
        },
      },
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
    displayName: 'Plugin composition test agent',
    description: 'Plugin composition test agent.',
    modelIds: ['MiniMax-M2.7'],
    capabilityBindings: [],
    policies: [{ policyPointId: 'agentRoutingPolicy', pluginId, policyId: 'reject-trigger', enabled: true }],
    runtimeSettings: {
      defaultLanguage: 'zh-CN',

      requestTimeoutMs: 30_000,
    },
    resources: [],
  };
}

function captureModel(captured: ModelInvocationRequest[]): ModelInvocationService {
  return {
    async complete() {
      return { content: 'unexpected' };
    },
    stream: modelEventStreamFixture(async function* (request) {
      captured.push(request);
      yield { content: 'unexpected', finishReason: 'stop' };
    }),
  };
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
  throw new Error('Timed out waiting for plugin e2e request terminal commit.');
}

async function listTimelineEvents(
  app: Awaited<ReturnType<typeof createComposedAppAsync>>,
  sessionId: string,
  runId: string,
): Promise<readonly RunTimelineEvent[]> {
  const events = await app.gateway.timeline.listEvents({
    tenantId: identity.tenantId,
    subjectId: identity.subjectId,
    agentId,
    sessionId: brand<string, 'SessionId'>(sessionId),
    runId: brand<string, 'RequestRunId'>(runId),
    afterSequence: brand<number, 'TimelineSequence'>(0),
    limit: 200,
  });
  return events as unknown as readonly RunTimelineEvent[];
}
