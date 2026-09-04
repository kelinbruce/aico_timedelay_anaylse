import { createNextAgentTestApp } from '@nextagent/agent-platform-gateway-local/testing';
import type { NextAgentApp } from '@nextagent/agent-app';
import { brand } from '@nextagent/agent-common';
import type { PendingInputRecord } from '@nextagent/agent-contracts/gateway';
import type { ModelInvocationRequest } from '@nextagent/agent-contracts/model';
import type { DeterministicModelStep } from '@nextagent/agent-model/testing';
import { createExecutionWorkspaceResolver } from '@nextagent/agent-runtime';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { copySkillFixturesToWorkspace, reserveFreePort } from '../e2e-helpers.js';

export const gateIdentity = {
  tenantId: brand<string, 'TenantId'>('tenant-p1p2-gate'),
  subjectId: brand<string, 'SubjectId'>('subject-p1p2-gate'),
  displayName: 'P1/P2 E2E gate tester',
};

export interface P1P2GateContext {
  readonly app: NextAgentApp;
  readonly baseUrl: string;
  readonly workspaceDir: string;
}

export interface CreateP1P2GateContextOptions {
  readonly modelSteps: readonly DeterministicModelStep[];
  readonly modelRequestSink?: ModelInvocationRequest[];
  readonly skillFixtures?: readonly string[];
  readonly agentDefinition?: Parameters<typeof createNextAgentTestApp>[0]['agentDefinition'];
  readonly lifecycleHook?: Parameters<typeof createNextAgentTestApp>[0]['lifecycleHook'];
  readonly lifecycleHookDefinitions?: Parameters<typeof createNextAgentTestApp>[0]['lifecycleHookDefinitions'];
  readonly hooks?: Parameters<typeof createNextAgentTestApp>[0]['hooks'];
  readonly riskPolicyEvaluator?: Parameters<typeof createNextAgentTestApp>[0]['riskPolicyEvaluator'];
  readonly sandboxGateway?: Parameters<typeof createNextAgentTestApp>[0]['sandboxGateway'];
}

export async function createP1P2GateContext(options: CreateP1P2GateContextOptions): Promise<P1P2GateContext> {
  const workspaceDir = await mkdtemp(join(tmpdir(), 'nextagent-p1p2-gate-'));
  await copySkillFixturesToWorkspace(workspaceDir, options.skillFixtures ?? []);
  const port = await reserveFreePort();
  const appOpts: Record<string, unknown> = {
    workspaceDir,
    channelPort: port,
    identity: gateIdentity,
    modelSteps: options.modelSteps,
  };
  if (options.modelRequestSink !== undefined) {
    appOpts.modelRequestSink = options.modelRequestSink;
  }
  if (options.agentDefinition !== undefined) {
    appOpts.agentDefinition = options.agentDefinition;
  }
  if (options.lifecycleHook !== undefined) {
    appOpts.lifecycleHook = options.lifecycleHook;
  }
  if (options.lifecycleHookDefinitions !== undefined) {
    appOpts.lifecycleHookDefinitions = options.lifecycleHookDefinitions;
  }
  if (options.hooks !== undefined) {
    appOpts.hooks = options.hooks;
  }
  if (options.riskPolicyEvaluator !== undefined) {
    appOpts.riskPolicyEvaluator = options.riskPolicyEvaluator;
  }
  if (options.sandboxGateway !== undefined) {
    appOpts.sandboxGateway = options.sandboxGateway;
  }
  const app = createNextAgentTestApp(appOpts as unknown as Parameters<typeof createNextAgentTestApp>[0]);
  await app.start();
  return { app, baseUrl: `http://127.0.0.1:${port}`, workspaceDir };
}

export async function cleanupP1P2GateContext(ctx: P1P2GateContext): Promise<void> {
  await ctx.app.close();
  await rm(ctx.workspaceDir, { recursive: true, force: true });
}

export async function submitRequest(
  ctx: P1P2GateContext,
  body: {
    readonly inputText: string;
    readonly idempotencyKey: string;
    readonly sessionId?: string;
    readonly routingConstraints?: Record<string, unknown>;
  },
): Promise<{ readonly sessionId: string; readonly requestId: string; readonly runId: string }> {
  const accepted = await fetch(`${ctx.baseUrl}/api/v1/requests`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      inputText: body.inputText,
      idempotencyKey: body.idempotencyKey,
      ...(body.sessionId === undefined ? {} : { sessionId: body.sessionId }),
      ...(body.routingConstraints === undefined ? {} : { routingConstraints: body.routingConstraints }),
    }),
  });
  if (accepted.status !== 200) {
    throw new Error(`Unexpected submit status: ${accepted.status}`);
  }
  return (await accepted.json()) as { readonly sessionId: string; readonly requestId: string; readonly runId: string };
}

export async function readRunStream(ctx: P1P2GateContext, sessionId: string, runId: string): Promise<string> {
  const response = await fetch(`${ctx.baseUrl}/api/v1/sessions/${sessionId}/stream?lastSeenSequence=0&runId=${runId}`);
  if (response.status !== 200) {
    throw new Error(`Unexpected stream status: ${response.status}`);
  }
  return await response.text();
}

export async function waitForActivePendingInput(ctx: P1P2GateContext, sessionId: string, timeoutMs = 5_000): Promise<PendingInputRecord> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const pending = await ctx.app.gateway.pendingInputs.loadActivePendingInput({
      tenantId: gateIdentity.tenantId,
      subjectId: gateIdentity.subjectId,
      agentId: brand<string, 'AgentId'>('default-agent'),
      sessionId: brand<string, 'SessionId'>(sessionId),
    });
    if (pending !== undefined) {
      return pending;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Timed out waiting for active pending input in session ${sessionId}.`);
}

export async function answerPendingInput(
  ctx: P1P2GateContext,
  sessionId: string,
  pendingInputId: string,
  answers: ReadonlyArray<readonly string[]>,
): Promise<{ readonly pendingInputId: string; readonly status: string }> {
  const response = await fetch(`${ctx.baseUrl}/api/v1/sessions/${sessionId}/pending-inputs/${pendingInputId}/answer`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ answers }),
  });
  if (response.status !== 200) {
    throw new Error(`Unexpected pending input answer status: ${response.status}`);
  }
  return (await response.json()) as { readonly pendingInputId: string; readonly status: string };
}

export async function readConversation(
  ctx: P1P2GateContext,
  sessionId: string,
  includeCapabilityResults = true,
): Promise<{ readonly items: Array<{ readonly role: string; readonly content: string; readonly metadata?: Record<string, unknown> }> }> {
  const response = await fetch(
    `${ctx.baseUrl}/api/v1/sessions/${sessionId}/conversation?limit=50&includeCapabilityResults=${includeCapabilityResults ? 'true' : 'false'}`,
  );
  if (response.status !== 200) {
    throw new Error(`Unexpected conversation status: ${response.status}`);
  }
  return (await response.json()) as {
    readonly items: Array<{ readonly role: string; readonly content: string; readonly metadata?: Record<string, unknown> }>;
  };
}

export async function createShare(
  ctx: P1P2GateContext,
  sessionId: string,
  body: {
    readonly runIds: readonly string[];
    readonly originUrl: string;
    readonly expiresIn: '24h' | '7d' | '30d' | 'permanent';
    readonly allowedOps: readonly string[] | null;
  },
): Promise<{ readonly shareId: string; readonly shareUrl: string }> {
  const response = await fetch(`${ctx.baseUrl}/api/v1/sessions/${sessionId}/shares`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (response.status !== 200) {
    throw new Error(`Unexpected create share status: ${response.status}`);
  }
  return (await response.json()) as { readonly shareId: string; readonly shareUrl: string };
}

export async function readSharedConversation(ctx: P1P2GateContext, shareId: string, viewerOps?: readonly string[]): Promise<Response> {
  return await fetch(`${ctx.baseUrl}/api/v1/shares/${shareId}/conversation`, {
    headers: viewerOps === undefined ? {} : { 'x-viewer-ops': JSON.stringify(viewerOps) },
  });
}

export async function readExecutionWorkspaceFile(ctx: P1P2GateContext, sessionId: string, runId: string, relativePath: string): Promise<string> {
  const assembly = await ctx.app.assemblyRegistry.require(brand<string, 'AgentId'>('default-agent'), brand<string, 'AgentVersion'>('v1'));
  const executionWorkspace = createExecutionWorkspaceResolver().resolve({
    runtimeWorkspaceRoot: ctx.app.systemConfig.paths.runtimeWorkspaceRoot,
    sharedDataRoot: ctx.app.systemConfig.paths.sharedDataRoot,
    workspacePolicy: assembly.workspacePolicy,
    agentId: brand<string, 'AgentId'>('default-agent'),
    tenantId: gateIdentity.tenantId,
    subjectId: gateIdentity.subjectId,
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

export async function waitForContent(path: string, needle: string, timeoutMs = 5_000): Promise<string> {
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
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Timed out waiting for content: ${needle}`);
}

export async function waitForTerminalCommit(ctx: P1P2GateContext, runId: string, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const run = await ctx.app.gateway.requestRuns.loadRun({
      tenantId: gateIdentity.tenantId,
      subjectId: gateIdentity.subjectId,
      agentId: brand<string, 'AgentId'>('default-agent'),
      runId: brand<string, 'RequestRunId'>(runId),
    });
    if (run?.terminalCommitState === 'COMMITTED') {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Timed out waiting for terminal commit: ${runId}`);
}
