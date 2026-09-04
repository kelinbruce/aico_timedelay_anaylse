import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { brand } from '@nextagent/agent-common';
import { registerWebChannel, type WebChannelDependencies } from '@nextagent/agent-channel-web';
import { RuntimeOwnedAgentRunStatePort } from '@nextagent/agent-runtime';
import { createPrecomputedSuggestedQuestionPort } from '@nextagent/agent-session';
import type {
  ActiveContextStoreGateway,
  CheckpointStoreGateway,
  PendingInputRecord,
  PendingInputStoreGateway,
  RunTimelineEventRecord,
  RunTimelineEventStoreGateway,
  SessionMessageStoreGateway,
} from '@nextagent/agent-contracts/gateway';
import type { PendingInputIntent, RequestContext, RequestRun } from '@nextagent/agent-contracts/runtime';
import type { DefaultSystemConfig } from '../src/config/component-config.js';
import { createPortalAbilitySuggestedQuestionGate } from '../src/composition/portal-ability-suggested-question-gate.js';
import { preloadPortalAbilityComposition, type PreparedPortalAbilityComposition } from '../src/composition/portal-ability-composition.js';
import Fastify from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';

const AGENT_ID = brand<string, 'AgentId'>('default-agent');
const TENANT_ID = brand<string, 'TenantId'>('T1');
const SUBJECT_ID = brand<string, 'SubjectId'>('U1');
const CREATED_AT = 1_000_000;
const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe('portal ability composition', () => {
  it('feeds bootstrap, suggested questions, and AskUserQuestion timeout from one provider', async () => {
    const { provider } = makeComposition('REMOTE', {
      'suggested-questions-enabled': false,
      'ask-user-question-time-minutes': 15,
    });
    const gate = makeSuggestedQuestionGate(provider);
    const runtime = makeRuntimePort(provider);

    const bootstrap = await readBootstrap(provider);
    expect(bootstrap.portalAbilityConfig).toEqual({
      suggestedQuestionsEnabled: false,
      cronTasksEnabled: true,
      longTermMemoryManagementEnabled: true,
      knowledgeImportEnabled: true,
      fullProcessEnabled: true,
    });
    expect(JSON.stringify(bootstrap)).not.toContain('askUserQuestionTimeMinutes');
    expect(JSON.stringify(bootstrap)).not.toContain(String(15 * 60 * 1000));

    await expect(gate.port.generate(makeSuggestedQuestionRequest('session-1'))).resolves.toEqual({ questions: [] });
    expect(gate.generate).not.toHaveBeenCalled();

    const pending = await requestAskUserQuestion(runtime.port, 'session-1');
    expect(pending.timeoutAt).toBe(CREATED_AT + 15 * 60 * 1000);
  });

  it('keeps LOCAL values static across all consumers after the file changes', async () => {
    const { provider, configPath } = makeComposition('LOCAL', {
      'suggested-questions-enabled': false,
      'ask-user-question-time-minutes': 15,
    });
    const gate = makeSuggestedQuestionGate(provider);
    const runtime = makeRuntimePort(provider);
    await readBootstrap(provider);
    await requestAskUserQuestion(runtime.port, 'session-1');

    writeConfig(configPath, { 'suggested-questions-enabled': true, 'ask-user-question-time-minutes': 60 });
    touch(configPath, 20_000);

    const bootstrap = await readBootstrap(provider);
    expect(bootstrap.portalAbilityConfig).toEqual({
      suggestedQuestionsEnabled: false,
      cronTasksEnabled: true,
      longTermMemoryManagementEnabled: true,
      knowledgeImportEnabled: true,
      fullProcessEnabled: true,
    });
    await expect(gate.port.generate(makeSuggestedQuestionRequest('session-2'))).resolves.toEqual({ questions: [] });
    expect(gate.generate).not.toHaveBeenCalled();
    const pending = await requestAskUserQuestion(runtime.port, 'session-2');
    expect(pending.timeoutAt).toBe(CREATED_AT + 15 * 60 * 1000);
  });

  it('applies REMOTE changes to future consumers without changing accepted deadlines', async () => {
    const { provider, configPath } = makeComposition('REMOTE', {
      'suggested-questions-enabled': false,
      'ask-user-question-time-minutes': 15,
    });
    const gate = makeSuggestedQuestionGate(provider);
    const runtime = makeRuntimePort(provider);
    const first = await requestAskUserQuestion(runtime.port, 'session-1');
    expect(first.timeoutAt).toBe(CREATED_AT + 15 * 60 * 1000);

    writeConfig(configPath, { 'suggested-questions-enabled': true, 'ask-user-question-time-minutes': 60 });
    touch(configPath, 20_000);

    const bootstrap = await readBootstrap(provider);
    expect(bootstrap.portalAbilityConfig).toEqual({
      suggestedQuestionsEnabled: true,
      cronTasksEnabled: true,
      longTermMemoryManagementEnabled: true,
      knowledgeImportEnabled: true,
      fullProcessEnabled: true,
    });
    await expect(gate.port.generate(makeSuggestedQuestionRequest('session-2'))).resolves.toEqual({ questions: ['model-question'] });
    expect(gate.generate).toHaveBeenCalledTimes(1);

    const second = await requestAskUserQuestion(runtime.port, 'session-2');
    expect(second.timeoutAt).toBe(CREATED_AT + 60 * 60 * 1000);
    expect(first.timeoutAt).toBe(CREATED_AT + 15 * 60 * 1000);
    expect(runtime.pendingInputs[0]?.request.timeoutAt).toBe(CREATED_AT + 15 * 60 * 1000);
  });
});

function makeComposition(
  mode: 'LOCAL' | 'REMOTE',
  config: Record<string, unknown>,
): { readonly provider: PreparedPortalAbilityComposition['provider']; readonly configPath: string } {
  const root = mkdtempSync(join(tmpdir(), 'nextagent-portal-composition-'));
  roots.push(root);
  const agentsRoot = join(root, 'agents');
  const agentRoot = join(agentsRoot, 'default-agent');
  mkdirSync(join(agentRoot, 'config'), { recursive: true });
  const configPath = join(agentRoot, 'config', 'config.json');
  writeConfig(configPath, config);
  const systemConfig = {
    deployment: { mode },
    activeAgentId: AGENT_ID,
    paths: { agentsRoot },
  } as unknown as DefaultSystemConfig;
  return { provider: preloadPortalAbilityComposition({ systemConfig }).provider, configPath };
}

function writeConfig(configPath: string, config: Record<string, unknown>): void {
  writeFileSync(configPath, `${JSON.stringify({ 'portal-ability-config': config }, null, 2)}\n`);
}

function touch(path: string, offsetMs: number): void {
  const time = new Date(Date.now() + offsetMs);
  utimesSync(path, time, time);
}

async function readBootstrap(provider: PreparedPortalAbilityComposition['provider']): Promise<Record<string, unknown>> {
  const app = Fastify();
  const dependencies = {
    runtime: {},
    sessions: {},
    identityResolver: () => ({ tenantId: TENANT_ID, subjectId: SUBJECT_ID, displayName: 'Test User' }),
    runtimeBootstrap: {
      transportKind: 'SSE' as const,
      portalAbilityConfig: {
        suggestedQuestionsEnabled: true,
        cronTasksEnabled: true,
        longTermMemoryManagementEnabled: true,
        knowledgeImportEnabled: true,
        fullProcessEnabled: true,
      },
    },
    defaultAgentId: AGENT_ID,
    portalAbilityConfigProvider: provider,
  } as unknown as WebChannelDependencies;
  await registerWebChannel(app, dependencies);
  const response = await app.inject({ method: 'GET', url: '/api/v1/runtime/bootstrap' });
  await app.close();
  expect(response.statusCode).toBe(200);
  return JSON.parse(response.body) as Record<string, unknown>;
}

function makeSuggestedQuestionGate(provider: PreparedPortalAbilityComposition['provider']) {
  const generate = vi.fn(async () => ({ questions: ['model-question'] }));
  return {
    generate,
    port: createPortalAbilitySuggestedQuestionGate(createPrecomputedSuggestedQuestionPort({ generate }), provider),
  };
}

function makeSuggestedQuestionRequest(sessionId: string) {
  return {
    tenantId: TENANT_ID,
    subjectId: SUBJECT_ID,
    agentId: AGENT_ID,
    sessionId: brand<string, 'SessionId'>(sessionId),
    requestId: brand<string, 'MessageId'>(`request-${sessionId}`),
    runId: brand<string, 'RequestRunId'>(`run-${sessionId}`),
  };
}

function makeRuntimePort(provider: PreparedPortalAbilityComposition['provider']) {
  const pendingInputs: PendingInputRecord[] = [];
  const timelineStore: RunTimelineEventStoreGateway = {
    appendEvent: vi.fn(async (record: RunTimelineEventRecord) => ({ ...record, sequence: brand<number, 'TimelineSequence'>(1) })),
    listEvents: vi.fn(async () => []),
  } as unknown as RunTimelineEventStoreGateway;
  const pendingInputStore: PendingInputStoreGateway = {
    loadActivePendingInput: vi.fn(async () => undefined),
    createPendingInput: vi.fn(async (request: { readonly record: PendingInputRecord }) => {
      pendingInputs.push(request.record);
      return request.record;
    }),
  } as unknown as PendingInputStoreGateway;
  const port = new RuntimeOwnedAgentRunStatePort({
    messageStore: {} as SessionMessageStoreGateway,
    timelineStore,
    checkpointStore: {
      saveCheckpoint: vi.fn(async (record: Parameters<CheckpointStoreGateway['saveCheckpoint']>[0]) => record),
    } as unknown as CheckpointStoreGateway,
    activeContextStore: { loadActiveContext: vi.fn(async () => undefined) } as unknown as ActiveContextStoreGateway,
    pendingInputStore,
    clock: () => brand<number, 'EpochMillis'>(CREATED_AT),
    idFactory: (prefix: string) => `${prefix}-${pendingInputs.length + 1}`,
    askUserQuestionDefaultTimeoutMs: async () => (await provider.get()).askUserQuestionTimeoutMs,
  });
  return { port, pendingInputs };
}

async function requestAskUserQuestion(
  port: RuntimeOwnedAgentRunStatePort,
  sessionId: string,
): Promise<ReturnType<RuntimeOwnedAgentRunStatePort['requestPendingInput']>> {
  const run = makeRun(sessionId);
  return port.requestPendingInput(run, makeContext(run), makeIntent(), {
    producerRef: {
      kind: 'CAPABILITY_INVOCATION',
      capabilityId: brand<string, 'CapabilityId'>('AskUserQuestion'),
      toolCallId: brand<string, 'ToolCallId'>(`tool-${sessionId}`),
    },
  });
}

function makeIntent(): PendingInputIntent {
  return {
    kind: 'QUESTION',
    questions: [{ prompt: '请选择网络区域', options: [{ label: '核心网', value: 'core' }] }],
  };
}

function makeRun(sessionId: string): RequestRun {
  return {
    runId: brand<string, 'RequestRunId'>(`run-${sessionId}`),
    sessionId: brand<string, 'SessionId'>(sessionId),
    requestId: brand<string, 'MessageId'>(`request-${sessionId}`),
    agentId: AGENT_ID,
    agentVersion: brand<string, 'AgentVersion'>('v1'),
    agentAssemblyRef: 'default-agent:v1',
    attempt: 1,
    status: 'EXECUTING',
    version: 1,
    terminalCommitState: 'NOT_STARTED',
    createdAt: brand<number, 'EpochMillis'>(1),
    updatedAt: brand<number, 'EpochMillis'>(1),
  };
}

function makeContext(run: RequestRun): RequestContext {
  return {
    requestContextId: brand<string, 'RequestContextId'>(`context-${run.sessionId}`),
    sessionId: run.sessionId,
    requestId: run.requestId,
    runId: run.runId,
    agentTurnIndex: 0,
    identityContext: {
      tenantId: TENANT_ID,
      subjectId: SUBJECT_ID,
      displayName: 'portal-ability-composition-test',
    },
    locale: brand<string, 'RequestLocale'>('zh-CN'),
    agentId: run.agentId,
    agentVersion: run.agentVersion,
    agentAssemblyRef: run.agentAssemblyRef,
    nextLifecycleStage: 'BEFORE_MODEL_INVOKE',
    toolCallStates: [],
    flowVariables: {},
  };
}
