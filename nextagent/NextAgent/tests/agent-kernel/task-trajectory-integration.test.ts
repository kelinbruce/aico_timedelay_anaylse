import { modelEventStreamFixture } from '../helpers/model-stream-fixture.js';
import {
  createAppCredentialResolver,
  createComposedApp,
  createTestSystemConfig,
  type AgentDefinition,
  type DefaultSystemConfig,
} from '@nextagent/agent-platform-gateway-local/testing';
import { brand } from '@nextagent/agent-common';
import type { ModelInvocationRequest, ModelInvocationService } from '@nextagent/agent-contracts/model';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const agentId = brand<string, 'AgentId'>('default-agent');
const agentVersion = brand<string, 'AgentVersion'>('v1');
const identity = {
  tenantId: brand<string, 'TenantId'>('tenant-task-trajectory'),
  subjectId: brand<string, 'SubjectId'>('subject-task-trajectory'),
  displayName: 'Task trajectory tester',
};

describe('task trajectory runtime integration', () => {
  it('builds task trajectory asynchronously after terminal commit without blocking request result', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'nextagent-task-trajectory-'));
    const captured: ModelInvocationRequest[] = [];
    const app = createComposedApp(
      {
        systemConfig: withMemoryEnabled(createTestSystemConfig(tempDir, credentialResolver())),
        agentDefinition: agentDefinition(),
        credentialResolver: credentialResolver(),
        identity,
      },
      captureModel(captured),
    );
    try {
      const accepted = await app.server.inject({
        method: 'POST',
        url: '/api/v1/requests',
        payload: { inputText: 'Diagnose BGP peer state', idempotencyKey: 'idem-task-trajectory-runtime' },
      });
      expect(accepted.statusCode).toBe(200);
      const runId = accepted.json<{ runId: string }>().runId;
      await waitForRunTerminal(app.gateway, runId);

      const trajectories = await waitFor(async () => {
        const result = await app.gateway.taskTrajectoryQuery.listTaskTrajectories({
          tenantId: identity.tenantId,
          subjectId: identity.subjectId,
          agentId,
          requestRunId: brand<string, 'RequestRunId'>(runId),
          limit: 10,
        });
        if ('code' in result) {
          return undefined;
        }
        return result.items[0];
      });

      expect(trajectories).toMatchObject({
        tenantId: identity.tenantId,
        subjectId: identity.subjectId,
        agentId,
        requestRunId: brand<string, 'RequestRunId'>(runId),
        trajectoryBuildStatus: 'COMPLETED',
        taskOutcomeStatus: 'UNKNOWN',
      });
      expect(JSON.stringify(trajectories)).not.toContain('Diagnose BGP peer state');
      expect(captured).toHaveLength(1);
    } finally {
      await app.close();
      await rm(tempDir, { recursive: true, force: true });
    }
  }, 15_000);

  it('builds local task trajectories even when long-term memory configuration is disabled', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'nextagent-task-trajectory-disabled-'));
    const app = createComposedApp(
      {
        systemConfig: withMemoryDisabled(createTestSystemConfig(tempDir, credentialResolver())),
        agentDefinition: agentDefinition(),
        credentialResolver: credentialResolver(),
        identity,
      },
      captureModel([]),
    );
    try {
      const accepted = await app.server.inject({
        method: 'POST',
        url: '/api/v1/requests',
        payload: { inputText: 'Diagnose BGP peer state', idempotencyKey: 'idem-task-trajectory-disabled' },
      });
      expect(accepted.statusCode).toBe(200);
      const runId = accepted.json<{ runId: string }>().runId;
      await waitForRunTerminal(app.gateway, runId);
      const trajectory = await waitFor(async () => {
        const result = await app.gateway.taskTrajectoryQuery.listTaskTrajectories({
          tenantId: identity.tenantId,
          subjectId: identity.subjectId,
          agentId,
          requestRunId: brand<string, 'RequestRunId'>(runId),
          limit: 10,
        });
        if ('code' in result) {
          return undefined;
        }
        return result.items[0];
      });
      expect(trajectory).toMatchObject({
        agentId,
        requestRunId: brand<string, 'RequestRunId'>(runId),
        trajectoryBuildStatus: 'COMPLETED',
      });
    } finally {
      await app.close();
      await rm(tempDir, { recursive: true, force: true });
    }
  }, 15_000);

  it('does not start local trajectory builder for remote memory backend', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'nextagent-task-trajectory-remote-'));
    const app = createComposedApp(
      {
        systemConfig: withRemoteMemoryBackend(withMemoryEnabled(createTestSystemConfig(tempDir, credentialResolver()))),
        agentDefinition: agentDefinition(),
        credentialResolver: credentialResolver(),
        identity,
      },
      captureModel([]),
    );
    try {
      const accepted = await app.server.inject({
        method: 'POST',
        url: '/api/v1/requests',
        payload: { inputText: 'Diagnose BGP peer state', idempotencyKey: 'idem-task-trajectory-remote' },
      });
      expect(accepted.statusCode).toBe(200);
      const runId = accepted.json<{ runId: string }>().runId;
      await waitForRunTerminal(app.gateway, runId);
      const trajectories = await app.gateway.taskTrajectoryQuery.listTaskTrajectories({
        tenantId: identity.tenantId,
        subjectId: identity.subjectId,
        agentId,
        requestRunId: brand<string, 'RequestRunId'>(runId),
        limit: 10,
      });
      expect('code' in trajectories ? trajectories : trajectories.items).toEqual([]);
    } finally {
      await app.close();
      await rm(tempDir, { recursive: true, force: true });
    }
  }, 15_000);
});

function withMemoryEnabled(systemConfig: DefaultSystemConfig): DefaultSystemConfig {
  return {
    ...systemConfig,
    memory: {
      enabled: true,
      status: 'VALID',
      search: { defaultLimit: 20, minConfidence: 0.3 },
      extraction: {
        enabled: true,
        strategy: 'RULE_FIRST',
        crossSessionSchedule: '0 0 0 * * ?',
        maxCycleTrajectories: 20,
        maxCandidates: 50,
        timeoutMs: 60_000,
        lookbackDays: 7,
      },
      aging: {
        enabled: true,
        schedule: '0 0 0 * * ?',
        decayStaleDays: 30,
        archiveRetentionDays: 90,
        decayFactor: 0.05,
        batchLimit: 1_000,
        timeoutMs: 30_000,
        reviveConfidenceBoost: 0.1,
      },
      diagnostics: [
        {
          issueCode: 'MEMORY_CONFIG_VALID',
          status: 'VALID',
          fieldRef: 'nextAgent.memory.enabled',
          safeMessage: 'Long-term memory configuration is enabled.',
          source: 'explicit',
        },
      ],
    },
  };
}

function withMemoryDisabled(systemConfig: DefaultSystemConfig): DefaultSystemConfig {
  const enabled = withMemoryEnabled(systemConfig);
  return {
    ...enabled,
    memory: {
      ...enabled.memory,
      enabled: false,
      status: 'DISABLED',
      extraction: {
        ...enabled.memory.extraction,
        enabled: false,
      },
      aging: {
        ...enabled.memory.aging,
        enabled: false,
      },
      diagnostics: [
        {
          issueCode: 'MEMORY_CONFIG_DISABLED_EXPLICIT',
          status: 'DISABLED',
          fieldRef: 'nextAgent.memory.enabled',
          safeMessage: 'Long-term memory is disabled by explicit configuration.',
          source: 'explicit',
        },
      ],
    },
  };
}

function withRemoteMemoryBackend(systemConfig: DefaultSystemConfig): DefaultSystemConfig {
  return {
    ...systemConfig,
    gateway: {
      ...systemConfig.gateway,
      deploymentMode: 'REMOTE',
    },
  };
}

function agentDefinition(): AgentDefinition {
  return {
    agentId,
    agentType: brand<string, 'AgentType'>('default'),
    agentVersion,
    displayName: 'Task trajectory test agent',
    description: 'Telecom task trajectory test agent.',
    workspaceDir: 'default-agent',
    capabilityBindings: [],
    runtimeSettings: {
      defaultLanguage: 'zh-CN',

      requestTimeoutMs: 1_800_000,
    },
    resources: [],
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

function credentialResolver() {
  return createAppCredentialResolver({
    OPENAI_API_KEY: 'test-only',
    OPENAI_MODEL_NAME: 'MiniMax-M2.7-highspeed',
    OPENAI_BASE_URL: 'https://api.minimaxi.com/v1',
  });
}

async function waitForRunTerminal(gateway: ReturnType<typeof createComposedApp>['gateway'], runId: string, timeoutMs = 5_000): Promise<void> {
  await waitFor(async () => {
    const run = await gateway.requestRuns.loadRun({
      tenantId: identity.tenantId,
      subjectId: identity.subjectId,
      agentId,
      runId: brand<string, 'RequestRunId'>(runId),
    });
    return run?.terminalCommitState === 'COMMITTED';
  }, timeoutMs);
}

async function waitFor<T>(assertion: () => T | undefined | false | Promise<T | undefined | false>, timeoutMs = 5_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await assertion();
    if (result !== undefined && result !== false) {
      return result;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  const result = await assertion();
  expect(result).toBeTruthy();
  return result as T;
}
