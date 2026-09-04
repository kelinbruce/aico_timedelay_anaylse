import {
  cleanupNextAgentTestApps,
  createAppCredentialResolver,
  createComposedApp,
  createNextAgentApp,
  createNextAgentTestApp,
  validateDefaultSystemConfig,
  type AgentDefinition,
  type DefaultSystemConfig,
} from '@nextagent/agent-platform-gateway-local/testing';
import { brand, type JsonObject } from '@nextagent/agent-common';
import { createDeterministicModelInvocationService } from '@nextagent/agent-model/testing';
import { createExecutionWorkspaceResolver } from '@nextagent/agent-runtime';
import type { WorkflowExecutionRequest, WorkflowExecutionService } from '@nextagent/agent-contracts/core';
import type { PendingInputRecord } from '@nextagent/agent-contracts/gateway';
import type { ModelInvocationRequest, ModelInvocationService } from '@nextagent/agent-contracts/model';
import { afterEach, beforeAll, describe, expect } from 'vitest';
import { cp, mkdir, open, readFile, rm, stat, unlink } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const agentId = brand<string, 'AgentId'>('default-agent');
export const smokeIdentity = {
  tenantId: brand<string, 'TenantId'>('tenant-system-smoke'),
  subjectId: brand<string, 'SubjectId'>('subject-system-smoke'),
  displayName: 'System smoke tester',
};
export const taskHeaders = {
  'x-tenant-id': 'system-smoke-task-tenant',
  'x-subject-id': 'system-smoke-task-user',
};
export const hasRealModelConfig =
  typeof process.env.OPENAI_API_KEY === 'string' &&
  process.env.OPENAI_API_KEY.length > 0 &&
  typeof process.env.OPENAI_MODEL_NAME === 'string' &&
  process.env.OPENAI_MODEL_NAME.length > 0 &&
  typeof process.env.OPENAI_BASE_URL === 'string' &&
  process.env.OPENAI_BASE_URL.length > 0;

const cleanupPaths: string[] = [];
const REAL_MODEL_SMOKE_LOCK_STALE_MS = 15 * 60 * 1_000;

afterEach(async () => {
  await cleanupNextAgentTestApps();
  while (cleanupPaths.length > 0) {
    await rm(cleanupPaths.pop()!, { recursive: true, force: true });
  }
}, 60_000);

export function trackCleanupPath(path: string): string {
  cleanupPaths.push(path);
  return path;
}

export function describeRealModelSmoke(name: string, tests: () => void): void {
  describe.skipIf(!hasRealModelConfig)(name, () => {
    beforeAll(async () => {
      await withRealModelSmokeLock(() => expectRealModelRoundTrip(name));
    }, 600_000);
    tests();
  });
}

export async function withRealModelSmokeLock<T>(run: () => Promise<T>): Promise<T> {
  const lockPath = join(tmpdir(), 'nextagent-real-model-smoke.lock');
  let lock: Awaited<ReturnType<typeof open>> | undefined;
  while (lock === undefined) {
    try {
      lock = await open(lockPath, 'wx');
    } catch (error) {
      const code = typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : undefined;
      if (code !== 'EEXIST') {
        throw error;
      }
      if (await removeStaleRealModelSmokeLock(lockPath)) {
        continue;
      }
      await sleep(500);
    }
  }
  try {
    return await run();
  } finally {
    await lock.close();
    await unlink(lockPath).catch(() => undefined);
  }
}

async function removeStaleRealModelSmokeLock(lockPath: string): Promise<boolean> {
  const lockStat = await stat(lockPath).catch(() => undefined);
  if (lockStat === undefined || Date.now() - lockStat.mtimeMs < REAL_MODEL_SMOKE_LOCK_STALE_MS) {
    return false;
  }
  await unlink(lockPath).catch(() => undefined);
  return true;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function expectRealModelRoundTrip(label: string): Promise<void> {
  const port = await reserveFreePort();
  const app = createNextAgentApp({
    channelPort: port,
    credentialResolver: createAppCredentialResolver(process.env),
  });
  await app.start();
  const baseUrl = `http://127.0.0.1:${port}`;
  const accepted = await fetch(`${baseUrl}/api/v1/requests`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      inputText: `Smoke model round trip for ${label}. Reply with one short telecom sentence.`,
      routingConstraints: { executionMode: 'model-only' },
      idempotencyKey: idem(`real-model-${label.replace(/[^a-z0-9]+/giu, '-').toLowerCase()}`),
    }),
  });
  expect(accepted.status).toBe(200);
  const body = (await accepted.json()) as { sessionId: string; runId: string };
  const stream = await fetch(`${baseUrl}/api/v1/sessions/${body.sessionId}/stream?lastSeenSequence=0&runId=${body.runId}`);
  expect(stream.status).toBe(200);
  const streamBody = await stream.text();
  expect(streamBody).toContain('event: REQUEST_ACCEPTED');
  expect(streamBody).toContain('event: LLM_CONTENT_DELTA');
  expect(streamBody).toContain('event: REQUEST_COMPLETED');

  const conversation = await fetch(`${baseUrl}/api/v1/sessions/${body.sessionId}/conversation?limit=10`);
  expect(conversation.status).toBe(200);
  const history = (await conversation.json()) as { items: Array<{ role: string; content: string }> };
  expect(history.items.map((item) => item.role)).toEqual(['USER', 'ASSISTANT']);
  expect(history.items.at(-1)?.content.length).toBeGreaterThan(0);
}

export async function submitAndWaitForSession(
  app: ReturnType<typeof createNextAgentTestApp>,
  inputText: string,
  expectedContent: string,
  prefix: string,
): Promise<{ sessionId: string; runId: string; streamBody: string }> {
  const accepted = await app.server.inject({
    method: 'POST',
    url: '/api/v1/requests',
    payload: { inputText, idempotencyKey: idem(prefix) },
  });
  expect(accepted.statusCode).toBe(200);
  const body = accepted.json<{ sessionId: string; runId: string }>();
  return {
    ...body,
    streamBody: await waitForSessionStream(app, body.sessionId, body.runId, expectedContent),
  };
}

export async function waitForSessionStream(
  app: ReturnType<typeof createNextAgentTestApp>,
  sessionId: string,
  runId: string,
  expectedContent: string,
  timeoutMs = 5_000,
): Promise<string> {
  return waitForStreamBody(
    async () => {
      const stream = await app.server.inject({
        method: 'GET',
        url: `/api/v1/sessions/${sessionId}/stream?lastSeenSequence=0&runId=${runId}`,
      });
      expect(stream.statusCode).toBe(200);
      return stream.body;
    },
    expectedContent,
    'REQUEST_COMPLETED',
    timeoutMs,
  );
}

export async function waitForTaskStream(
  app: ReturnType<typeof createNextAgentTestApp>,
  taskId: string,
  runId: string,
  expectedContent: string,
  timeoutMs = 10_000,
): Promise<string> {
  return waitForStreamBody(
    async () => {
      const stream = await app.server.inject({
        method: 'GET',
        url: `/api/v1/task/${taskId}/stream?lastSeenSequence=0&runId=${runId}`,
        headers: taskHeaders,
      });
      expect(stream.statusCode).toBe(200);
      return stream.body;
    },
    expectedContent,
    'TASK_COMPLETED',
    timeoutMs,
  );
}

export async function waitForActivePendingInput(
  app: ReturnType<typeof createNextAgentTestApp>,
  sessionId: string,
  timeoutMs = 5_000,
): Promise<PendingInputRecord> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const pending = await app.gateway.pendingInputs.loadActivePendingInput({
      tenantId: smokeIdentity.tenantId,
      subjectId: smokeIdentity.subjectId,
      agentId,
      sessionId: brand<string, 'SessionId'>(sessionId),
    });
    if (pending !== undefined) {
      return pending;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`Timed out waiting for active pending input in session ${sessionId}.`);
}

export async function waitForStreamBody(
  readBody: () => Promise<string>,
  expectedContent: string,
  terminalEvent: string,
  timeoutMs: number,
): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  let lastBody = '';
  while (Date.now() < deadline) {
    lastBody = await readBody();
    if (lastBody.includes(`event: ${terminalEvent}`) && lastBody.includes(expectedContent)) {
      return lastBody;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`Timed out waiting for ${terminalEvent}. Last body: ${lastBody.slice(0, 500)}`);
}

export async function copySkillFixturesToWorkspace(workspaceDir: string, skillFixtures: readonly string[]): Promise<void> {
  if (skillFixtures.length === 0) {
    return;
  }
  const skillsRoot = join(workspaceDir, 'skills');
  const fixtureRoot = join(dirname(fileURLToPath(import.meta.url)), '..', 'e2e', 'fixtures', 'skills');
  await mkdir(skillsRoot, { recursive: true });
  for (const skillName of skillFixtures) {
    await cp(join(fixtureRoot, skillName), join(skillsRoot, skillName), { recursive: true });
  }
}

export async function readExecutionWorkspaceFile(
  app: ReturnType<typeof createNextAgentTestApp>,
  sessionId: string,
  runId: string,
  relativePath: string,
): Promise<string> {
  const assembly = await app.assemblyRegistry.require(agentId, brand<string, 'AgentVersion'>('v1'));
  const executionWorkspace = createExecutionWorkspaceResolver().resolve({
    runtimeWorkspaceRoot: app.systemConfig.paths.runtimeWorkspaceRoot,
    sharedDataRoot: app.systemConfig.paths.sharedDataRoot,
    workspacePolicy: assembly.workspacePolicy,
    agentId,
    tenantId: smokeIdentity.tenantId,
    subjectId: smokeIdentity.subjectId,
    sessionId: brand<string, 'SessionId'>(sessionId),
    runId: brand<string, 'RequestRunId'>(runId),
    deploymentMode: 'LOCAL',
  });
  const workspaceRoot = executionWorkspace.roots.find((root) => root.kind === 'workspace')?.physicalPath;
  if (workspaceRoot === undefined) {
    throw new Error('Workspace root was not resolved.');
  }
  const workspaceRelativePath = relativePath.startsWith('workspace/') ? relativePath.slice('workspace/'.length) : relativePath;
  return await readFile(join(workspaceRoot, ...workspaceRelativePath.split('/')), 'utf8');
}

export async function waitForFileContent(path: string, needle: string, timeoutMs = 5_000): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  let content = '';
  while (Date.now() < deadline) {
    try {
      content = await readFile(path, 'utf8');
      if (content.includes(needle)) {
        return content;
      }
    } catch {
      // Retry until timeout.
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`Timed out waiting for content: ${needle}`);
}

export async function waitForWorkflowRunTerminal(app: ReturnType<typeof createComposedApp>, runId: string, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const run = await app.gateway.requestRuns.loadRun({
      tenantId: smokeIdentity.tenantId,
      subjectId: smokeIdentity.subjectId,
      agentId,
      runId: brand<string, 'RequestRunId'>(runId),
    });
    if (run?.terminalCommitState === 'COMMITTED') {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error('Timed out waiting for workflow smoke request terminal commit.');
}

export async function reserveFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (typeof address !== 'object' || address === null) {
        server.close(() => reject(new Error('Unable to reserve a TCP port.')));
        return;
      }
      server.close((error) => {
        if (error !== undefined) {
          reject(error);
          return;
        }
        resolve(address.port);
      });
    });
  });
}

export function createSystemConfig(root: string, port: number): DefaultSystemConfig {
  return validateDefaultSystemConfig(
    {
      deployment: { mode: 'LOCAL' },
      paths: { workspaceRoot: 'workspaces', logDirectory: 'logs', agentRoot: 'agents', skillRoot: 'skills' },
      observability: { logging: { diagnosticDetail: 'normal' } },
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
          { gatewayId: 'local-cron', gatewayKind: 'cron-tasks', deploymentMode: 'LOCAL', sqliteFileRef: 'paths.sqliteFile' },
          { gatewayId: 'local-rag', gatewayKind: 'rag-knowledge', deploymentMode: 'LOCAL' },
          { gatewayId: 'local-workflow', gatewayKind: 'workflow-execution', deploymentMode: 'LOCAL' },
        ],
      },
      noopBoundaries: { lifecycleHook: 'noop', checkpoint: 'noop', audit: 'noop' },
    },
    root,
    { credentialResolver: createAppCredentialResolver({ NEXTAGENT_TEST_ONLY: 'test-only' }) },
  );
}

export function createAgentDefinition(): AgentDefinition {
  return {
    agentId,
    agentType: brand<string, 'AgentType'>('default'),
    agentVersion: brand<string, 'AgentVersion'>('v1'),
    displayName: 'System smoke agent',
    description: 'System smoke workflow agent.',
    modelIds: ['deterministic-test-model'],
    capabilityBindings: [],
    runtimeSettings: {
      defaultLanguage: 'zh-CN',

      requestTimeoutMs: 30_000,
    },
    resources: [],
  };
}

export function workflowService(captured: WorkflowExecutionRequest[]): WorkflowExecutionService {
  return {
    async execute(request) {
      captured.push(request);
      return {
        executionId: 'system-smoke-workflow-execution',
        status: 'COMPLETED',
        outputVariables: { message: 'workflow smoke completed' } as unknown as JsonObject,
        nodeResults: [],
        startedAt: new Date('2026-07-16T00:00:00.000Z'),
        completedAt: new Date('2026-07-16T00:00:01.000Z'),
      };
    },
  };
}

export function captureModel(captured: ModelInvocationRequest[], model: ModelInvocationService): ModelInvocationService {
  return {
    async complete(request, signal) {
      captured.push(request);
      return await model.complete(request, signal);
    },
    async stream(request, signal, onDelta) {
      captured.push(request);
      return await model.stream(request, signal, onDelta);
    },
  };
}

export function deterministicModel(steps: Parameters<typeof createDeterministicModelInvocationService>[0]): ModelInvocationService {
  return createDeterministicModelInvocationService(steps);
}

export function recipe(recipeName: string, version: string) {
  return {
    name: recipeName,
    version,
    description: recipeName,
    nodes: {
      start: {
        type: 'start-event',
        next: {
          end: { condition: '' },
        },
      },
      end: { type: 'end-event' },
    },
  };
}

export function idem(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}
