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
import { createDeveloperHookTracePluginArtifact, developerHookTraceHookId } from '@nextagent/agent-plugin-sdk/developer-hook-trace';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { reserveFreePort } from './e2e-helpers.js';

const pluginId = 'developer-hook-trace';
const agentId = brand<string, 'AgentId'>('default-agent');
const identity = {
  tenantId: brand<string, 'TenantId'>('tenant-developer-hook-e2e'),
  subjectId: brand<string, 'SubjectId'>('subject-developer-hook-e2e'),
  displayName: 'Developer hook e2e tester',
};

describe('developer hook trace plugin product path', () => {
  const cleanupPaths: string[] = [];

  afterEach(async () => {
    await cleanupNextAgentTestApps();
    while (cleanupPaths.length > 0) {
      await rm(cleanupPaths.pop()!, { recursive: true, force: true });
    }
  });

  it.each(['LOCAL', 'REMOTE'] as const)(
    'loads the generated plugin artifact through %s system config and writes loop trace logs when Agent hooks activate it',
    async (deploymentMode) => {
      const root = await mkdtemp(join(tmpdir(), 'nextagent-developer-hook-e2e-'));
      cleanupPaths.push(root);
      const port = await reserveFreePort();
      createDeveloperHookTracePluginArtifact({
        targetDirectory: join(root, 'plugins', pluginId),
      });

      const modelCalls: ModelInvocationRequest[] = [];
      const app = await createComposedAppAsync(
        {
          identity,
          systemConfig: createSystemConfig(root, port, deploymentMode),
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
          inputText: 'collect developer hook trace',
          idempotencyKey: `developer-hook-e2e-${crypto.randomUUID()}`,
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
      const logLines = (await readFile(join(artifactDirectory, active!), 'utf8'))
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
                readonly stage: string;
                readonly agentId: string;
                readonly runId?: string;
                readonly boundary?: unknown;
              };
            },
        );
      expect(logLines).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            pluginId,
            artifactType: 'developer-hook-trace',
            payload: expect.objectContaining({
              event: 'DEVELOPER_HOOK_TRACE',
              hookId: developerHookTraceHookId,
              stage: 'BEFORE_MODEL_INVOKE',
              agentId: 'default-agent',
              runId: body.runId,
              boundary: expect.objectContaining({ safeModelRequestSummary: expect.any(String) }),
            }),
          }),
          expect.objectContaining({
            pluginId,
            artifactType: 'developer-hook-trace',
            payload: expect.objectContaining({
              event: 'DEVELOPER_HOOK_TRACE',
              hookId: developerHookTraceHookId,
              stage: 'AFTER_MODEL_RESULT',
              agentId: 'default-agent',
              runId: body.runId,
              boundary: expect.objectContaining({
                firstContentLatencyMs: expect.any(Number),
                modelE2ELatencyMs: expect.any(Number),
                usage: {
                  inputTokens: 11,
                  outputTokens: 6,
                  totalTokens: 17,
                },
              }),
            }),
          }),
        ]),
      );
    },
    20_000,
  );
});

function createSystemConfig(root: string, port: number, deploymentMode: 'LOCAL' | 'REMOTE'): DefaultSystemConfig {
  return validateDefaultSystemConfig(
    {
      deployment: { mode: deploymentMode },
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
    displayName: 'Developer hook trace test agent',
    description: 'Developer hook trace test agent.',
    modelIds: ['MiniMax-M2.7'],
    capabilityBindings: [],
    hooks: [
      {
        hookId: developerHookTraceHookId,
        enabled: true,
        stages: ['BEFORE_MODEL_INVOKE', 'AFTER_MODEL_RESULT'],
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
      return { content: 'developer hook trace complete' };
    },
    stream: modelEventStreamFixture(async function* (request) {
      captured.push(request);
      yield {
        content: 'developer hook trace complete',
        finishReason: 'stop',
        usage: { inputTokens: 11, outputTokens: 6, totalTokens: 17 },
      };
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
  throw new Error('Timed out waiting for developer hook trace e2e request terminal commit.');
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
