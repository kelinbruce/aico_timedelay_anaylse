import { brand, type JsonObject } from '@nextagent/agent-common';
import type { SandboxExecutionRequest } from '@nextagent/agent-contracts/gateway';
import type { ModelInvocationRequest, ModelInvocationService } from '@nextagent/agent-contracts/model';
import type { RiskPolicyEvaluator, RunTimelineEvent } from '@nextagent/agent-contracts/runtime';
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
import {
  createNorthboundOutputNormalizationPluginArtifact,
  northboundOutputNormalizationHookId,
} from '@nextagent/agent-plugin-sdk/northbound-output-normalization-hook';
import { modelEventStreamFixture } from '../helpers/model-stream-fixture.js';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { reserveFreePort } from './e2e-helpers.js';

const pluginId = northboundOutputNormalizationHookId;
const matchText = 'northbound-entry.py';
const agentId = brand<string, 'AgentId'>('default-agent');
const identity = {
  tenantId: brand<string, 'TenantId'>('tenant-northbound-hook-e2e'),
  subjectId: brand<string, 'SubjectId'>('subject-northbound-hook-e2e'),
  displayName: 'Northbound hook e2e tester',
};
const allowAllRiskPolicy: RiskPolicyEvaluator = {
  async evaluate() {
    return { outcome: 'ALLOW', reasonCode: 'E2E_ALLOW' };
  },
};

describe('northbound output normalization plugin product path', () => {
  const cleanupPaths: string[] = [];

  afterEach(async () => {
    await cleanupNextAgentTestApps();
    while (cleanupPaths.length > 0) {
      await rm(cleanupPaths.pop()!, { recursive: true, force: true });
    }
  });

  it('loads the generated plugin artifact and returns only matching Bash results in the terminal Hook snapshot', async () => {
    const root = await mkdtemp(join(tmpdir(), 'nextagent-northbound-hook-e2e-'));
    cleanupPaths.push(root);
    const port = await reserveFreePort();
    createNorthboundOutputNormalizationPluginArtifact({
      targetDirectory: join(root, 'plugins', pluginId),
    });

    const execute = vi.fn(async (request: SandboxExecutionRequest) => ({
      executionId: request.executionId,
      exitCode: 0,
      stdout: `result:${request.command}:${request.args.join(',')}`,
      stderr: '',
      stdoutTruncated: false,
      stderrTruncated: false,
      timedOut: false,
      durationMs: 5,
    }));
    const modelCalls: ModelInvocationRequest[] = [];
    const app = await createComposedAppAsync(
      {
        identity,
        systemConfig: createSystemConfig(root, port),
        agentDefinition: createAgentDefinition(),
        credentialResolver: createAppCredentialResolver({ NEXTAGENT_TEST_ONLY: 'test-only' }),
        gatewayProviders: [createSqliteWorkingMemoryGatewayProvider(), createSqliteLongTermMemoryGatewayProvider(), createLocalGatewayProvider()],
        riskPolicyEvaluator: allowAllRiskPolicy,
        sandboxGateway: { execute, isExecutionReady: () => true },
      },
      scriptedModel(modelCalls),
    );
    await app.start();

    const accepted = await fetch(`http://127.0.0.1:${port}/api/v1/requests`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        inputText: 'run command-match, args-match, and non-matching Bash actions',
        idempotencyKey: `northbound-hook-e2e-${crypto.randomUUID()}`,
      }),
    });
    expect(accepted.status).toBe(200);
    const body = (await accepted.json()) as { readonly sessionId: string; readonly runId: string };

    await waitForRunTerminal(app, body.runId);

    expect(modelCalls).toHaveLength(2);
    expect(execute).toHaveBeenCalledTimes(3);
    const events = await listTimelineEvents(app, body.sessionId, body.runId);
    const completed = events.find((event) => event.type === 'REQUEST_COMPLETED');
    expect(completed).toBeDefined();
    const hookResults = completed?.inlinePayload['hookResults'];
    expect(Array.isArray(hookResults)).toBe(true);
    if (!Array.isArray(hookResults)) {
      throw new Error('Expected terminal hookResults.');
    }
    const northboundResults = hookResults.filter(isNorthboundHookResult);
    expect(northboundResults).toHaveLength(3);
    expect(northboundResults.filter((entry) => entry.outcome === 'PASS')).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          stage: 'AFTER_CAPABILITY_RESULT',
          resultSummary: bashResult('result:northbound-entry.py:'),
        }),
        expect.objectContaining({
          stage: 'AFTER_CAPABILITY_RESULT',
          resultSummary: bashResult('result:python:northbound-entry.py'),
        }),
      ]),
    );
    expect(northboundResults.filter((entry) => entry.outcome === 'SKIP')).toEqual([
      expect.not.objectContaining({ resultSummary: expect.anything() }),
    ]);

    const hookInvocations = events.filter(
      (event) => event.type === 'HOOK_INVOKED' && event.inlinePayload['hookId'] === northboundOutputNormalizationHookId,
    );
    expect(hookInvocations).toHaveLength(3);
    for (const invocation of hookInvocations) {
      expect(invocation.inlinePayload).not.toHaveProperty('arguments');
      expect(invocation.inlinePayload).not.toHaveProperty('boundary');
    }
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
    displayName: 'Northbound hook test agent',
    description: 'Northbound hook test agent.',
    modelIds: ['MiniMax-M2.7'],
    capabilityBindings: [],
    hooks: [
      {
        hookId: northboundOutputNormalizationHookId,
        enabled: true,
        stages: ['AFTER_CAPABILITY_RESULT'],
        config: { matchText },
      },
    ],
    runtimeSettings: {
      defaultLanguage: 'zh-CN',
      requestTimeoutMs: 30_000,
    },
    resources: [],
  };
}

function scriptedModel(captured: ModelInvocationRequest[]): ModelInvocationService {
  return {
    async complete(request) {
      captured.push(request);
      return { content: 'northbound hook e2e complete', finishReason: 'stop' };
    },
    stream: modelEventStreamFixture(async function* (request) {
      captured.push(request);
      if (captured.length === 1) {
        yield {
          content: '',
          finishReason: 'tool-calls',
          toolCalls: [
            {
              toolCallId: 'tool-bash-command-match',
              toolName: 'Bash',
              arguments: { command: matchText },
            },
            {
              toolCallId: 'tool-bash-args-match',
              toolName: 'Bash',
              arguments: { command: 'python', args: [matchText] },
            },
            {
              toolCallId: 'tool-bash-skip',
              toolName: 'Bash',
              arguments: { command: 'worker.py' },
            },
          ],
        };
        return;
      }
      yield { content: 'northbound hook e2e complete', finishReason: 'stop' };
    }),
  };
}

function bashResult(stdout: string): JsonObject {
  return {
    stdout,
    stderr: '',
    exitCode: 0,
    stdoutTruncated: false,
    stderrTruncated: false,
  };
}

function isNorthboundHookResult(value: unknown): value is JsonObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value) && (value as JsonObject).hookId === northboundOutputNormalizationHookId;
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
  throw new Error('Timed out waiting for northbound output normalization e2e request terminal commit.');
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
