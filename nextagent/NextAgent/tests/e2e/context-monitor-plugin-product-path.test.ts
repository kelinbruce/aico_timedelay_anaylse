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
import { contextMonitorHookId, createContextMonitorPluginArtifact } from '@nextagent/agent-plugin-sdk/context-monitor';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { reserveFreePort } from './e2e-helpers.js';

const pluginId = 'context-monitor';
const agentId = brand<string, 'AgentId'>('default-agent');
const identity = {
  tenantId: brand<string, 'TenantId'>('tenant-context-monitor-e2e'),
  subjectId: brand<string, 'SubjectId'>('subject-context-monitor-e2e'),
  displayName: 'Context monitor e2e tester',
};

describe('context monitor plugin product path', () => {
  const cleanupPaths: string[] = [];

  afterEach(async () => {
    await cleanupNextAgentTestApps();
    while (cleanupPaths.length > 0) {
      await rm(cleanupPaths.pop()!, { recursive: true, force: true });
    }
  });

  it('loads the generated plugin artifact through system config and writes the last context file when Agent hooks activate it', async () => {
    const root = await mkdtemp(join(tmpdir(), 'nextagent-context-monitor-e2e-'));
    cleanupPaths.push(root);
    const port = await reserveFreePort();
    createContextMonitorPluginArtifact({
      targetDirectory: join(root, 'plugins', pluginId),
    });

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
        inputText: 'collect context monitor last snapshot',
        idempotencyKey: `context-monitor-e2e-${crypto.randomUUID()}`,
      }),
    });
    expect(accepted.status).toBe(200);
    const body = (await accepted.json()) as { readonly sessionId: string; readonly runId: string };

    await waitForRunTerminal(app, body.runId);

    expect(modelCalls.length).toBeGreaterThanOrEqual(1);
    const events = await listTimelineEvents(app, body.sessionId, body.runId);
    expect(events.map((event) => event.type)).toContain('REQUEST_COMPLETED');
    await app.close();

    const artifactDirectory = join(root, 'logs');
    const active = (await readdir(artifactDirectory)).find((name) => /^nextagent-plugin-diagnostic\..+\.ndjson$/u.test(name));
    expect(active).toBeDefined();
    const lines = (await readFile(join(artifactDirectory, active!), 'utf8'))
      .trim()
      .split(/\r?\n/u)
      .map(
        (line) =>
          JSON.parse(line) as {
            readonly pluginId: string;
            readonly artifactType: string;
            readonly payload: {
              readonly event: string;
              readonly hookId: string;
              readonly sessionId?: string;
              readonly agentId: string;
              readonly messages: readonly unknown[];
              readonly answer?: { readonly content?: string };
            };
          },
      );
    const lastRecord = lines.find((line) => line.artifactType === 'context-evolution.terminal')?.payload;
    expect(lastRecord).toBeDefined();
    expect(lastRecord).toMatchObject({
      event: 'CONTEXT_LAST',
      hookId: contextMonitorHookId,
      agentId: 'default-agent',
      sessionId: body.sessionId,
    });
    expect(lastRecord!.messages.length).toBeGreaterThanOrEqual(1);
    expect(lastRecord!.answer?.content).toBe('context monitor complete');
  }, 20_000);
});

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
    displayName: 'Context monitor test agent',
    description: 'Context monitor test agent.',
    modelIds: ['MiniMax-M2.7'],
    capabilityBindings: [],
    hooks: [
      {
        hookId: contextMonitorHookId,
        enabled: true,
        stages: ['BEFORE_MODEL_INVOKE', 'AFTER_MODEL_RESULT', 'AFTER_CONTEXT_COMPACT', 'BEFORE_CONTEXT_COMPACT', 'BEFORE_AGENT_TERMINAL'],
        config: {},
      },
    ],
    runtimeSettings: {
      defaultLanguage: 'zh-CN',

      requestTimeoutMs: 30_000,
    },
    resources: [],
  };
}

function captureModel(captured: ModelInvocationRequest[]): ModelInvocationService {
  return {
    async complete(request) {
      captured.push(request);
      return { content: 'context monitor complete', finishReason: 'stop' };
    },
    stream: modelEventStreamFixture(async function* (request) {
      captured.push(request);
      yield { content: 'context monitor complete' };
      yield { content: 'context monitor complete', finishReason: 'stop' };
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
  throw new Error('Timed out waiting for context monitor e2e request terminal commit.');
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
