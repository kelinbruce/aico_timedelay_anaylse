import { createDefaultAgentTestAssemblyRegistry } from '@nextagent/agent-platform-gateway-local/testing';
import { createStaticCapabilityCatalog } from '@nextagent/agent-capability';
import { bindRuntimeLoggerProvider, brand, type JsonObject, type RuntimeLoggerProviderBinding } from '@nextagent/agent-common';
import type { RequestRunRecord } from '@nextagent/agent-contracts/gateway';
import type {
  AgentConstructor,
  AgentExecutionOutcome,
  AgentRunStatePort,
  LifecycleHookDefinition,
  PendingInputIntent,
  PendingInputRequest,
  RequestContext,
  RequestRun,
  RunTimelineEvent,
} from '@nextagent/agent-contracts/runtime';
import {
  createRequestLifecycleCoordinator,
  createRuntimeSubagentExecutionPort,
  type AgentRuntimeKit,
  type RequestLifecycleDependencies,
} from '@nextagent/agent-runtime';
import { createUserSessionService } from '@nextagent/agent-session';
import { createTestGatewayStores } from '../fixtures/local-gateway.js';
import { createTestAgentConstructor } from '../fixtures/test-agent.js';
import { afterEach, describe, expect, it, vi } from 'vitest';

let loggerBinding: RuntimeLoggerProviderBinding | undefined;
afterEach(() => {
  vi.useRealTimers();
  loggerBinding?.unbind();
});

const identity = {
  tenantId: brand<string, 'TenantId'>('tenant-lane'),
  subjectId: brand<string, 'SubjectId'>('subject-lane'),
  displayName: 'Lane tester',
};
const agentId = brand<string, 'AgentId'>('default-agent');
const agentVersion = brand<string, 'AgentVersion'>('v1');
const pendingInputDefaultTimeoutMs = 30 * 60 * 1000;
const pendingInputMaxTimeoutMs = 24 * 60 * 60 * 1000;

function runRecord(overrides: Partial<RequestRunRecord> & Pick<RequestRunRecord, 'runId' | 'sessionId' | 'requestId'>): RequestRunRecord {
  const now = brand<number, 'EpochMillis'>(overrides.createdAt === undefined ? 1 : Number(overrides.createdAt));
  return {
    tenantId: identity.tenantId,
    subjectId: identity.subjectId,
    agentId,
    agentVersion,
    agentAssemblyRef: 'default-agent:v1',
    attempt: 1,
    status: 'QUEUED',
    version: 1,
    terminalCommitState: 'NOT_STARTED',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

async function waitFor(assertion: () => boolean | Promise<boolean>, timeoutMs = 1_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await assertion()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  expect(await assertion()).toBe(true);
}

async function waitForRunStatus(
  gateway: ReturnType<typeof createTestGatewayStores>,
  runId: RequestRun['runId'],
  status: RequestRun['status'],
): Promise<void> {
  await waitFor(async () => {
    const run = await gateway.requestRuns.loadRun({
      tenantId: identity.tenantId,
      subjectId: identity.subjectId,
      agentId,
      runId,
    });
    return run?.status === status && run.terminalCommitState === 'COMMITTED';
  });
}

function createRuntime(
  gateway: ReturnType<typeof createTestGatewayStores>,
  execute: LegacyExecute,
  overrides: Partial<RequestLifecycleDependencies<object>> = {},
) {
  return createRequestLifecycleCoordinator({
    agentConstructors: [
      createTestAgentConstructor(async ({ runState }, run, context, signal) => {
        await execute(run, context, toLegacyTimeline(runState, run, context), runState, signal);
      }),
    ],
    agentRuntimeDependencies: {},
    assemblyRegistry: createDefaultAgentTestAssemblyRegistry('deterministic-test-model'),
    capabilityCatalog: createStaticCapabilityCatalog(),
    defaultRouteAgentId: agentId,
    recoveryAgentId: agentId,
    userSessions: createUserSessionService({
      sessionStore: gateway.sessions,
      messageStore: gateway.messages,
      activeContextStore: gateway.activeContext,
    }),
    messageStore: gateway.messages,
    activeContextStore: gateway.activeContext,
    requestRunStore: gateway.requestRuns,
    timelineStore: gateway.timeline,
    checkpointStore: gateway.checkpoints,
    pendingInputStore: gateway.pendingInputs,
    ...overrides,
  });
}

type LegacyExecute = (
  run: RequestRun,
  context: RequestContext,
  timeline: { emit: (event: RunTimelineEvent) => Promise<void> },
  messages: Pick<AgentRunStatePort, 'appendMessage'>,
  signal: AbortSignal,
) => Promise<void>;

function toLegacyTimeline(runState: AgentRunStatePort, run: RequestRun, context: RequestContext) {
  return {
    emit(event: RunTimelineEvent): Promise<void> {
      return runState.emitEvent(run, context, event);
    },
  };
}

function createPendingInputAgentConstructor(pendingInput: PendingInputRequest, onExecute: () => void): AgentConstructor<AgentRuntimeKit<object>> {
  return class PendingInputAgent {
    static getType() {
      return brand<string, 'AgentType'>('default');
    }

    constructor(_kit: AgentRuntimeKit<object>) {}

    async execute(): Promise<AgentExecutionOutcome> {
      onExecute();
      return { status: 'PENDING_INPUT', pendingInput };
    }
  };
}

function createRuntimePendingInputAgentConstructor(
  intent: PendingInputIntent,
  onExecute: (count: number) => void,
  capabilityId = 'ask-user-question',
): AgentConstructor<AgentRuntimeKit<object>> {
  return class RuntimePendingInputAgent {
    private executeCount = 0;

    static getType() {
      return brand<string, 'AgentType'>('default');
    }

    constructor(private readonly kit: AgentRuntimeKit<object>) {}

    async execute(run: RequestRun, context: RequestContext): Promise<AgentExecutionOutcome> {
      this.executeCount += 1;
      onExecute(this.executeCount);
      if (this.executeCount === 1) {
        const pendingInput = await this.kit.runState.requestPendingInput(
          run,
          {
            ...context,
            nextLifecycleStage: 'BEFORE_CAPABILITY_INVOKE',
            toolCallStates: [
              {
                toolCallId: 'ask-user-1',
                capabilityId: brand<string, 'CapabilityId'>(capabilityId),
                arguments: {},
                status: 'PENDING',
              },
            ],
          },
          intent,
        );
        return { status: 'PENDING_INPUT', pendingInput };
      }
      await this.kit.runState.emitEvent(run, context, {
        type: 'LLM_CONTENT_DELTA',
        inlinePayload: { final: true, content: 'resumed after pending input' },
      });
      return { status: 'COMPLETED' };
    }
  };
}

function confirmationQuestions(prompt = 'Proceed?'): PendingInputIntent['questions'] {
  return [
    {
      prompt,
      options: [
        { label: 'Approve', value: 'approve' },
        { label: 'Reject', value: 'reject' },
      ],
    },
  ];
}

function authorizationQuestions(prompt = 'Authorize operation?'): PendingInputIntent['questions'] {
  return [
    {
      prompt,
      options: [
        { label: 'Approve', value: 'approve' },
        { label: 'Deny', value: 'deny' },
      ],
    },
  ];
}

function handoffQuestions(): PendingInputIntent['questions'] {
  return [
    {
      prompt: 'How should the human handoff finish?',
      options: [
        { label: 'Final answer', value: 'final_answer' },
        { label: 'Resume with instruction', value: 'resume_instruction' },
      ],
    },
    { prompt: 'Human handoff content', options: [] },
  ];
}

describe('session lane scheduling', () => {
  it('loads agent and owner scoped session lane facts without scheduler decisions', async () => {
    const gateway = createTestGatewayStores();
    const sessionId = brand<string, 'SessionId'>('session-lane-facts');
    await gateway.requestRuns.saveRun(
      runRecord({
        runId: brand<string, 'RequestRunId'>('run-queued-1'),
        sessionId,
        requestId: brand<string, 'MessageId'>('request-queued-1'),
        createdAt: brand<number, 'EpochMillis'>(1),
      }),
      {},
    );
    await gateway.requestRuns.saveRun(
      runRecord({
        runId: brand<string, 'RequestRunId'>('run-executing'),
        sessionId,
        requestId: brand<string, 'MessageId'>('request-executing'),
        status: 'EXECUTING',
        createdAt: brand<number, 'EpochMillis'>(2),
      }),
      {},
    );
    await gateway.requestRuns.saveRun(
      runRecord({
        runId: brand<string, 'RequestRunId'>('run-terminal-pending'),
        sessionId,
        requestId: brand<string, 'MessageId'>('request-terminal-pending'),
        status: 'FAILED',
        terminalCommitState: 'PENDING',
        createdAt: brand<number, 'EpochMillis'>(3),
      }),
      {},
    );
    await gateway.requestRuns.saveRun(
      runRecord({
        tenantId: brand<string, 'TenantId'>('tenant-other'),
        subjectId: identity.subjectId,
        runId: brand<string, 'RequestRunId'>('run-other-tenant'),
        sessionId,
        requestId: brand<string, 'MessageId'>('request-other-tenant'),
        createdAt: brand<number, 'EpochMillis'>(4),
      }),
      {},
    );
    await gateway.requestRuns.saveRun(
      runRecord({
        subjectId: brand<string, 'SubjectId'>('subject-other'),
        runId: brand<string, 'RequestRunId'>('run-other-subject'),
        sessionId,
        requestId: brand<string, 'MessageId'>('request-other-subject'),
        createdAt: brand<number, 'EpochMillis'>(5),
      }),
      {},
    );
    await gateway.requestRuns.saveRun(
      runRecord({
        agentId: brand<string, 'AgentId'>('agent-other'),
        runId: brand<string, 'RequestRunId'>('run-other-agent'),
        sessionId,
        requestId: brand<string, 'MessageId'>('request-other-agent'),
        createdAt: brand<number, 'EpochMillis'>(6),
      }),
      {},
    );
    await gateway.requestRuns.saveRun(
      runRecord({
        runId: brand<string, 'RequestRunId'>('run-other-session'),
        sessionId: brand<string, 'SessionId'>('session-other'),
        requestId: brand<string, 'MessageId'>('request-other-session'),
        createdAt: brand<number, 'EpochMillis'>(7),
      }),
      {},
    );

    const snapshot = await gateway.requestRuns.loadSessionLaneSnapshot({
      tenantId: identity.tenantId,
      subjectId: identity.subjectId,
      agentId,
      sessionId,
    });

    expect(snapshot.latestRun?.runId).toBe('run-terminal-pending');
    expect(snapshot.latestRequestId).toBe('request-terminal-pending');
    expect(snapshot.queuedRuns.map((run) => run.runId)).toEqual(['run-queued-1']);
    expect(snapshot.executingRun?.runId).toBe('run-executing');
    expect(snapshot.terminalPendingRun?.runId).toBe('run-terminal-pending');
    expect(snapshot).not.toHaveProperty('shouldStartExecution');
    expect(snapshot).not.toHaveProperty('shouldSupersede');

    const otherTenant = await gateway.requestRuns.loadSessionLaneSnapshot({
      tenantId: brand<string, 'TenantId'>('tenant-other'),
      subjectId: identity.subjectId,
      agentId,
      sessionId,
    });
    expect(otherTenant.queuedRuns.map((run) => run.runId)).toEqual(['run-other-tenant']);
    expect(otherTenant.latestRun?.runId).toBe('run-other-tenant');

    const empty = await gateway.requestRuns.loadSessionLaneSnapshot({
      tenantId: brand<string, 'TenantId'>('tenant-missing'),
      subjectId: identity.subjectId,
      agentId,
      sessionId,
    });
    expect(empty.queuedRuns).toEqual([]);
    expect(empty.latestRun).toBeUndefined();

    const retryingSession = brand<string, 'SessionId'>('session-retrying');
    await gateway.requestRuns.saveRun(
      runRecord({
        runId: brand<string, 'RequestRunId'>('run-terminal-retrying'),
        sessionId: retryingSession,
        requestId: brand<string, 'MessageId'>('request-terminal-retrying'),
        status: 'FAILED',
        terminalCommitState: 'RETRYING',
        createdAt: brand<number, 'EpochMillis'>(1),
      }),
      {},
    );
    const retrying = await gateway.requestRuns.loadSessionLaneSnapshot({
      tenantId: identity.tenantId,
      subjectId: identity.subjectId,
      agentId,
      sessionId: retryingSession,
    });
    expect(retrying.terminalPendingRun?.runId).toBe('run-terminal-retrying');
  });

  it('returns a safe consistency error instead of choosing between multiple executing lane facts', async () => {
    const gateway = createTestGatewayStores();
    const sessionId = brand<string, 'SessionId'>('session-multiple-executing');
    await gateway.requestRuns.saveRun(
      runRecord({
        runId: brand<string, 'RequestRunId'>('run-executing-1'),
        sessionId,
        requestId: brand<string, 'MessageId'>('request-executing-1'),
        status: 'EXECUTING',
        createdAt: brand<number, 'EpochMillis'>(1),
      }),
      {},
    );
    await gateway.requestRuns.saveRun(
      runRecord({
        runId: brand<string, 'RequestRunId'>('run-executing-2'),
        sessionId,
        requestId: brand<string, 'MessageId'>('request-executing-2'),
        status: 'EXECUTING',
        createdAt: brand<number, 'EpochMillis'>(2),
      }),
      {},
    );

    await expect(
      gateway.requestRuns.loadSessionLaneSnapshot({
        tenantId: identity.tenantId,
        subjectId: identity.subjectId,
        agentId,
        sessionId,
      }),
    ).rejects.toMatchObject({ code: 'LANE_EXECUTION_BLOCKED', safeDetails: { reasonCode: 'LANE_EXECUTION_BLOCKED' } });
  });

  it('detects submit idempotency semantic conflicts inside the agent owner session scope', async () => {
    const gateway = createTestGatewayStores();
    const sessionId = brand<string, 'SessionId'>('session-idem-conflict');
    const record = runRecord({
      runId: brand<string, 'RequestRunId'>('run-idem-1'),
      sessionId,
      requestId: brand<string, 'MessageId'>('request-idem-1'),
    });

    await expect(
      gateway.requestRuns.saveRun(record, {
        idempotencyKey: brand<string, 'IdempotencyKey'>('idem-submit'),
        idempotencySemantic: 'submit:text:a',
      }),
    ).resolves.toMatchObject({ status: 'UPDATED', record });
    await expect(
      gateway.requestRuns.saveRun(
        { ...record, runId: brand<string, 'RequestRunId'>('run-idem-2') },
        {
          idempotencyKey: brand<string, 'IdempotencyKey'>('idem-submit'),
          idempotencySemantic: 'submit:text:a',
        },
      ),
    ).resolves.toMatchObject({ status: 'UPDATED', record });
    await expect(
      gateway.requestRuns.saveRun(
        { ...record, runId: brand<string, 'RequestRunId'>('run-idem-3') },
        {
          idempotencyKey: brand<string, 'IdempotencyKey'>('idem-submit'),
          idempotencySemantic: 'submit:text:b',
        },
      ),
    ).resolves.toMatchObject({ status: 'VERSION_CONFLICT' });
    await expect(
      gateway.requestRuns.saveRun(
        {
          ...record,
          tenantId: brand<string, 'TenantId'>('tenant-other'),
          runId: brand<string, 'RequestRunId'>('run-idem-other'),
        },
        {
          idempotencyKey: brand<string, 'IdempotencyKey'>('idem-submit'),
          idempotencySemantic: 'submit:text:b',
        },
      ),
    ).resolves.toMatchObject({ status: 'UPDATED' });
    await expect(
      gateway.requestRuns.saveRun(
        {
          ...record,
          agentId: brand<string, 'AgentId'>('agent-other'),
          runId: brand<string, 'RequestRunId'>('run-idem-other-agent'),
        },
        {
          idempotencyKey: brand<string, 'IdempotencyKey'>('idem-submit'),
          idempotencySemantic: 'submit:text:b',
        },
      ),
    ).resolves.toMatchObject({ status: 'UPDATED' });
  });

  it('scopes RequestRun lookup and terminal commit by owner and agent', async () => {
    const gateway = createTestGatewayStores();
    const sessionId = brand<string, 'SessionId'>('session-run-scope');
    const requestId = brand<string, 'MessageId'>('request-run-scope');
    const runId = brand<string, 'RequestRunId'>('run-scope');
    const otherAgentId = brand<string, 'AgentId'>('agent-other');
    const missingAgentId = brand<string, 'AgentId'>('agent-missing');
    await gateway.requestRuns.saveRun(
      runRecord({
        runId,
        sessionId,
        requestId,
        status: 'EXECUTING',
      }),
      {},
    );
    await gateway.requestRuns.saveRun(
      runRecord({
        agentId: otherAgentId,
        runId,
        sessionId,
        requestId: brand<string, 'MessageId'>('request-run-scope-other-agent'),
        status: 'QUEUED',
      }),
      {},
    );

    await expect(
      gateway.requestRuns.loadRun({
        tenantId: identity.tenantId,
        subjectId: identity.subjectId,
        agentId,
        runId,
      }),
    ).resolves.toMatchObject({ agentId, requestId, status: 'EXECUTING' });

    await expect(
      gateway.requestRuns.loadRun({
        tenantId: identity.tenantId,
        subjectId: identity.subjectId,
        agentId: otherAgentId,
        runId,
      }),
    ).resolves.toMatchObject({ agentId: otherAgentId, requestId: 'request-run-scope-other-agent', status: 'QUEUED' });
    await expect(
      gateway.requestRuns.loadRun({
        tenantId: identity.tenantId,
        subjectId: identity.subjectId,
        agentId: missingAgentId,
        runId,
      }),
    ).resolves.toBeUndefined();
    await expect(
      gateway.requestRuns.claimRun({
        tenantId: identity.tenantId,
        subjectId: identity.subjectId,
        agentId: missingAgentId,
        runId,
        expectedVersion: 1,
        lockedBy: 'other-agent',
        lockExpiresAt: brand<number, 'EpochMillis'>(10),
      }),
    ).resolves.toMatchObject({ status: 'NOT_FOUND' });
    await expect(
      gateway.requestRuns.commitTerminal({
        tenantId: identity.tenantId,
        subjectId: identity.subjectId,
        agentId: missingAgentId,
        runId,
        expectedVersion: 1,
        terminalStatus: 'COMPLETED',
        idempotencyKey: brand<string, 'IdempotencyKey'>('idem-terminal-other-agent'),
        terminalMessage: {
          tenantId: identity.tenantId,
          subjectId: identity.subjectId,
          agentId: missingAgentId,
          messageId: brand<string, 'MessageId'>('assistant-other-agent'),
          sessionId,
          requestId,
          runId,
          role: 'ASSISTANT',
          content: 'done',
          contentType: 'PLAIN_TEXT',
          metadata: {},
          visible: true,
          createdAt: brand<number, 'EpochMillis'>(2),
        },
        terminalEvent: {
          tenantId: identity.tenantId,
          subjectId: identity.subjectId,
          agentId: missingAgentId,
          agentVersion,
          eventId: 'event-other-agent',
          sessionId,
          runId,
          requestId,
          requestContextId: brand<string, 'RequestContextId'>('context-other-agent'),
          sequence: brand<number, 'TimelineSequence'>(0),
          type: 'REQUEST_COMPLETED',
          inlinePayload: { content: 'done' },
          createdAt: brand<number, 'EpochMillis'>(2),
        },
      }),
    ).resolves.toMatchObject({ status: 'NOT_FOUND' });
    await expect(
      gateway.requestRuns.commitTerminal({
        tenantId: identity.tenantId,
        subjectId: identity.subjectId,
        agentId,
        runId,
        expectedVersion: 1,
        terminalStatus: 'COMPLETED',
        idempotencyKey: brand<string, 'IdempotencyKey'>('idem-terminal-run-scope'),
        terminalMessage: {
          tenantId: identity.tenantId,
          subjectId: identity.subjectId,
          agentId,
          messageId: brand<string, 'MessageId'>('assistant-run-scope'),
          sessionId,
          requestId,
          runId,
          role: 'ASSISTANT',
          content: 'done',
          contentType: 'PLAIN_TEXT',
          metadata: {},
          visible: true,
          createdAt: brand<number, 'EpochMillis'>(2),
        },
        terminalEvent: {
          tenantId: identity.tenantId,
          subjectId: identity.subjectId,
          agentId,
          agentVersion,
          eventId: 'event-run-scope',
          sessionId,
          runId,
          requestId,
          requestContextId: brand<string, 'RequestContextId'>('context-run-scope'),
          sequence: brand<number, 'TimelineSequence'>(0),
          type: 'REQUEST_COMPLETED',
          inlinePayload: { content: 'done' },
          createdAt: brand<number, 'EpochMillis'>(2),
        },
      }),
    ).resolves.toMatchObject({ status: 'COMMITTED' });
  });

  it('enforces submit idempotency at the runtime command boundary', async () => {
    const gateway = createTestGatewayStores();
    const sessionId = brand<string, 'SessionId'>('session-runtime-idem');
    let executeCount = 0;
    await gateway.sessions.saveSession({
      tenantId: identity.tenantId,
      subjectId: identity.subjectId,
      agentId,
      sessionId,
      createdAt: brand<number, 'EpochMillis'>(1),
      updatedAt: brand<number, 'EpochMillis'>(1),
    });
    const runtime = createRuntime(gateway, async (_run, _context, timeline) => {
      executeCount += 1;
      await timeline.emit({ type: 'LLM_CONTENT_DELTA', inlinePayload: { content: 'done' } });
    });

    await expect(
      runtime.submit({
        sessionId,
        identityContext: identity,
        inputText: 'missing key',
        attachmentIds: [],
        locale: brand<string, 'RequestLocale'>('zh-CN'),
      } as unknown as Parameters<typeof runtime.submit>[0]),
    ).rejects.toMatchObject({ code: 'SUBMIT_IDEMPOTENCY_REQUIRED', safeDetails: { reasonCode: 'SUBMIT_IDEMPOTENCY_REQUIRED' } });
    await expect(
      runtime.submit({
        sessionId,
        identityContext: identity,
        inputText: 'blank key',
        attachmentIds: [],
        locale: brand<string, 'RequestLocale'>('zh-CN'),
        idempotencyKey: brand<string, 'IdempotencyKey'>(' '),
      }),
    ).rejects.toMatchObject({ code: 'SUBMIT_IDEMPOTENCY_REQUIRED', safeDetails: { reasonCode: 'SUBMIT_IDEMPOTENCY_REQUIRED' } });

    const emptySnapshot = await gateway.requestRuns.loadSessionLaneSnapshot({
      tenantId: identity.tenantId,
      subjectId: identity.subjectId,
      agentId,
      sessionId,
    });
    expect(emptySnapshot.latestRun).toBeUndefined();

    const first = await runtime.submit({
      sessionId,
      identityContext: identity,
      inputText: 'same semantic',
      attachmentIds: [],
      locale: brand<string, 'RequestLocale'>('zh-CN'),
      idempotencyKey: brand<string, 'IdempotencyKey'>('idem-runtime-submit'),
    });
    await waitForRunStatus(gateway, first.runId, 'COMPLETED');
    const replay = await runtime.submit({
      sessionId,
      identityContext: identity,
      inputText: 'same semantic',
      attachmentIds: [],
      locale: brand<string, 'RequestLocale'>('zh-CN'),
      idempotencyKey: brand<string, 'IdempotencyKey'>('idem-runtime-submit'),
    });
    await expect(
      runtime.submit({
        sessionId,
        identityContext: identity,
        inputText: 'different semantic',
        attachmentIds: [],
        locale: brand<string, 'RequestLocale'>('zh-CN'),
        idempotencyKey: brand<string, 'IdempotencyKey'>('idem-runtime-submit'),
      }),
    ).rejects.toMatchObject({ code: 'REQUEST_SUBMIT_IDEMPOTENCY_CONFLICT', safeDetails: { reasonCode: 'REQUEST_SUBMIT_IDEMPOTENCY_CONFLICT' } });

    expect(replay).toEqual(first);
    expect(executeCount).toBe(1);
  });

  it('creates a sessionless child run with agent scope, parent linkage, low priority, and no nested subagents', async () => {
    const gateway = createTestGatewayStores();
    const parentSessionId = brand<string, 'SessionId'>('session-parent-agent-tool');
    const parentRunId = brand<string, 'RequestRunId'>('run-parent-agent-tool');
    const parentRequestId = brand<string, 'MessageId'>('request-parent-agent-tool');
    let capturedContext: RequestContext | undefined;
    const runtime = createRuntime(gateway, async (_run, context, timeline) => {
      capturedContext = context;
      await timeline.emit({ type: 'LLM_CONTENT_DELTA', inlinePayload: { content: 'child done' } });
    });

    const accepted = await runtime.submit({
      agentId,
      identityContext: identity,
      inputText: 'child task',
      attachmentIds: [],
      locale: brand<string, 'RequestLocale'>('zh-CN'),
      parentSessionId,
      parentRunId,
      parentRequestId,
      priority: 'LOW',
      routingConstraints: {
        allowSubagents: true,
        forbiddenCapabilityIds: [brand<string, 'CapabilityId'>('Bash')],
      },
      idempotencyKey: brand<string, 'IdempotencyKey'>('idem-sessionless-child'),
    });
    await waitForRunStatus(gateway, accepted.runId, 'COMPLETED');

    const session = await gateway.sessions.loadSession({
      tenantId: identity.tenantId,
      subjectId: identity.subjectId,
      agentId,
      sessionId: accepted.sessionId,
    });
    const run = await gateway.requestRuns.loadRun({
      tenantId: identity.tenantId,
      subjectId: identity.subjectId,
      agentId,
      runId: accepted.runId,
    });

    expect(session).toMatchObject({
      agentId,
      sessionId: accepted.sessionId,
      parentSessionId,
      parentRunId,
      parentRequestId,
    });
    expect(run).toMatchObject({
      parentRunId,
      parentRequestId,
      priority: 'LOW',
    });
    expect(capturedContext?.routingConstraints).toMatchObject({
      allowSubagents: false,
      forbiddenCapabilityIds: expect.arrayContaining(['Agent', 'AskUserQuestion', 'Bash']),
    });
  });

  it('executes a subagent through the runtime port full flow with terminal text and framework no-nesting', async () => {
    const gateway = createTestGatewayStores();
    const assemblyRegistry = createDefaultAgentTestAssemblyRegistry('deterministic-test-model');
    const parentSessionId = brand<string, 'SessionId'>('session-port-parent');
    const parentRunId = brand<string, 'RequestRunId'>('run-port-parent');
    const parentRequestId = brand<string, 'MessageId'>('request-port-parent');
    let capturedContext: RequestContext | undefined;
    const runtime = createRuntime(
      gateway,
      async (_run, context, timeline) => {
        capturedContext = context;
        await timeline.emit({ type: 'LLM_CONTENT_DELTA', inlinePayload: { content: 'child terminal response' } });
      },
      { assemblyRegistry },
    );
    const port = createRuntimeSubagentExecutionPort({ assemblyRegistry, runtime });

    const result = await port.executeSubagent(
      {
        targetAgentId: agentId,
        targetAgentVersion: agentVersion,
        targetProviderKind: 'BUNDLED',
        prompt: 'delegate through runtime port',
        parentSessionId,
        parentRunId,
        parentRequestId,
        parentToolCallId: 'tool-call-port',
        identityContext: identity,
        locale: brand<string, 'RequestLocale'>('zh-CN'),
        idempotencyKey: brand<string, 'IdempotencyKey'>('idem-port-full-flow'),
      },
      new AbortController().signal,
    );

    expect(result).toMatchObject({
      status: 'COMPLETED',
      terminalText: 'child terminal response',
    });
    expect(result.childSessionId).toBeDefined();
    expect(result.childRunId).toBeDefined();
    await waitForRunStatus(gateway, result.childRunId!, 'COMPLETED');
    const session = await gateway.sessions.loadSession({
      tenantId: identity.tenantId,
      subjectId: identity.subjectId,
      agentId,
      sessionId: result.childSessionId!,
    });
    const run = await gateway.requestRuns.loadRun({
      tenantId: identity.tenantId,
      subjectId: identity.subjectId,
      agentId,
      runId: result.childRunId!,
    });

    expect(session).toMatchObject({
      parentSessionId,
      parentRunId,
      parentRequestId,
    });
    expect(run).toMatchObject({
      parentRunId,
      parentRequestId,
      priority: 'LOW',
    });
    expect(capturedContext?.routingConstraints).toMatchObject({
      allowSubagents: false,
      forbiddenCapabilityIds: expect.arrayContaining(['Agent', 'AskUserQuestion']),
    });
  });

  it('rejects explicit agent scope mismatches for existing sessions before accepting a run', async () => {
    const gateway = createTestGatewayStores();
    const sessionId = brand<string, 'SessionId'>('session-agent-mismatch');
    await gateway.sessions.saveSession({
      tenantId: identity.tenantId,
      subjectId: identity.subjectId,
      agentId,
      sessionId,
      createdAt: brand<number, 'EpochMillis'>(1),
      updatedAt: brand<number, 'EpochMillis'>(1),
    });
    const runtime = createRuntime(gateway, async () => undefined);

    await expect(
      runtime.submit({
        sessionId,
        agentId: brand<string, 'AgentId'>('other-agent'),
        identityContext: identity,
        inputText: 'wrong agent',
        attachmentIds: [],
        locale: brand<string, 'RequestLocale'>('zh-CN'),
        idempotencyKey: brand<string, 'IdempotencyKey'>('idem-agent-mismatch'),
      }),
    ).rejects.toMatchObject({
      code: 'SUBMIT_AGENT_SCOPE_MISMATCH',
      safeDetails: { reasonCode: 'SESSION_BOUND_AGENT_SCOPE_VIOLATION' },
    });

    const snapshot = await gateway.requestRuns.loadSessionLaneSnapshot({
      tenantId: identity.tenantId,
      subjectId: identity.subjectId,
      agentId,
      sessionId,
    });
    expect(snapshot.latestRun).toBeUndefined();
  });

  it('keeps pending input outcomes before terminal commit and blocks the same session lane', async () => {
    const gateway = createTestGatewayStores();
    const sessionId = brand<string, 'SessionId'>('session-pending-outcome-lane');
    const pendingInput: PendingInputRequest = {
      id: brand<string, 'PendingInputId'>('pending-outcome-lane'),
      sessionId,
      kind: 'QUESTION',
      questions: [{ prompt: 'Continue?', options: [{ label: 'yes', value: 'yes' }] }],
    };
    let executeCount = 0;
    await gateway.sessions.saveSession({
      tenantId: identity.tenantId,
      subjectId: identity.subjectId,
      agentId,
      sessionId,
      createdAt: brand<number, 'EpochMillis'>(1),
      updatedAt: brand<number, 'EpochMillis'>(1),
    });
    const runtime = createRuntime(gateway, async () => {}, {
      agentConstructors: [
        createPendingInputAgentConstructor(pendingInput, () => {
          executeCount += 1;
        }),
      ],
    });

    const first = await runtime.submit({
      sessionId,
      identityContext: identity,
      inputText: 'needs input',
      attachmentIds: [],
      locale: brand<string, 'RequestLocale'>('zh-CN'),
      idempotencyKey: brand<string, 'IdempotencyKey'>('idem-pending-outcome-1'),
    });
    await waitFor(() => executeCount === 1);
    const firstRun = await gateway.requestRuns.loadRun({
      tenantId: identity.tenantId,
      subjectId: identity.subjectId,
      agentId,
      runId: first.runId,
    });

    expect(firstRun).toMatchObject({ status: 'EXECUTING', terminalCommitState: 'NOT_STARTED' });
    await expect(runtime.waitForIdle({ timeoutMs: 30 })).resolves.toBeUndefined();

    const second = await runtime.submit({
      sessionId,
      identityContext: identity,
      inputText: 'same lane should wait',
      attachmentIds: [],
      locale: brand<string, 'RequestLocale'>('zh-CN'),
      idempotencyKey: brand<string, 'IdempotencyKey'>('idem-pending-outcome-2'),
    });
    await new Promise((resolve) => setTimeout(resolve, 30));
    const secondRun = await gateway.requestRuns.loadRun({
      tenantId: identity.tenantId,
      subjectId: identity.subjectId,
      agentId,
      runId: second.runId,
    });
    const events = await gateway.timeline.listEvents({
      tenantId: identity.tenantId,
      subjectId: identity.subjectId,
      agentId,
      sessionId,
      afterSequence: brand<number, 'TimelineSequence'>(0),
      limit: 100,
    });

    expect(secondRun).toMatchObject({ status: 'QUEUED', terminalCommitState: 'NOT_STARTED' });
    expect(executeCount).toBe(1);
    expect(events.map((event) => event.type)).not.toEqual(
      expect.arrayContaining(['REQUEST_COMPLETED', 'REQUEST_FAILED', 'REQUEST_CANCELED', 'REQUEST_SUPERSEDED']),
    );
  });

  it('creates runtime-owned pending input facts, rejects same-session submit and resumes after answer', async () => {
    const gateway = createTestGatewayStores();
    const sessionId = brand<string, 'SessionId'>('session-runtime-pending-input');
    let executeCount = 0;
    await gateway.sessions.saveSession({
      tenantId: identity.tenantId,
      subjectId: identity.subjectId,
      agentId,
      sessionId,
      createdAt: brand<number, 'EpochMillis'>(1),
      updatedAt: brand<number, 'EpochMillis'>(1),
    });
    const runtime = createRuntime(gateway, async () => {}, {
      agentConstructors: [
        createRuntimePendingInputAgentConstructor(
          {
            kind: 'QUESTION',
            questions: [
              {
                prompt: 'When should this run?',
                options: [
                  { label: 'Now', value: 'now' },
                  { label: 'Later', value: 'later', requiresTextInput: true, inputPlaceholder: 'Enter a delay' },
                ],
                multiple: false,
                custom: false,
              },
              {
                prompt: 'Which device should be checked?',
                options: [],
              },
              {
                prompt: 'Choose or describe a window.',
                options: [{ label: 'Tonight', value: 'tonight' }],
                custom: true,
              },
              {
                prompt: 'Which checks should run?',
                options: [
                  { label: 'Alarm', value: 'alarm' },
                  { label: 'Performance', value: 'performance' },
                ],
                multiple: true,
              },
            ],
          },
          (count) => {
            executeCount = count;
          },
        ),
      ],
    });

    const submitted = await runtime.submit({
      sessionId,
      identityContext: identity,
      inputText: 'needs runtime pending input',
      attachmentIds: [],
      locale: brand<string, 'RequestLocale'>('zh-CN'),
      idempotencyKey: brand<string, 'IdempotencyKey'>('idem-runtime-pending-input'),
    });
    await waitFor(
      async () =>
        (await gateway.pendingInputs.loadActivePendingInput({
          tenantId: identity.tenantId,
          subjectId: identity.subjectId,
          agentId,
          sessionId,
        })) !== undefined,
    );
    const pending = await gateway.pendingInputs.loadActivePendingInput({
      tenantId: identity.tenantId,
      subjectId: identity.subjectId,
      agentId,
      sessionId,
    });

    expect(pending).toMatchObject({
      requestRunId: submitted.runId,
      status: 'PENDING',
      producerRef: { kind: 'CAPABILITY_INVOCATION', capabilityId: 'ask-user-question', toolCallId: 'ask-user-1' },
    });
    const checkpoint = await gateway.checkpoints.loadCheckpoint({
      tenantId: identity.tenantId,
      subjectId: identity.subjectId,
      agentId,
      sessionId,
      requestId: submitted.requestId,
      runId: submitted.runId,
    });
    expect(checkpoint?.checkpointId).toBe(pending?.checkpointId);
    await expect(
      runtime.submit({
        sessionId,
        identityContext: identity,
        inputText: 'must answer first',
        attachmentIds: [],
        locale: brand<string, 'RequestLocale'>('zh-CN'),
        idempotencyKey: brand<string, 'IdempotencyKey'>('idem-runtime-pending-input-blocked'),
      }),
    ).rejects.toMatchObject({ code: 'PENDING_INPUT_ACTIVE_CONFLICT' });

    await expect(
      runtime.answerPendingInput({
        identityContext: identity,
        idempotencyKey: brand<string, 'IdempotencyKey'>('idem-runtime-pending-input-empty-attached-text'),
        answer: {
          sessionId,
          pendingInputId: pending!.pendingInputId,
          answers: [['later', '   '], ['NA2312038368AAW'], ['15 minutes from now'], ['alarm', 'performance']],
        },
      }),
    ).rejects.toMatchObject({ code: 'PENDING_INPUT_ANSWER_INVALID' });

    await expect(
      runtime.answerPendingInput({
        identityContext: identity,
        idempotencyKey: brand<string, 'IdempotencyKey'>('answer-question-unknown-kind'),
        answer: {
          sessionId,
          pendingInputId: pending!.pendingInputId,
          answers: [['later', '10 minutes'], ['NA2312038368AAW'], ['tonight'], ['alarm', 'performance', 'include historical alarms']],
          answerKinds: ['UNKNOWN' as never, 'TEXT', 'CUSTOM_TEXT', 'OPTION_SELECTIONS_WITH_CUSTOM_TEXT'],
        },
      }),
    ).rejects.toMatchObject({ code: 'PENDING_INPUT_ANSWER_INVALID' });

    await expect(
      runtime.answerPendingInput({
        identityContext: identity,
        idempotencyKey: brand<string, 'IdempotencyKey'>('idem-runtime-pending-input-answer'),
        answer: {
          sessionId,
          pendingInputId: pending!.pendingInputId,
          answers: [['later', '10 minutes'], ['NA2312038368AAW'], ['tonight'], ['alarm', 'performance', 'include historical alarms']],
          answerKinds: ['OPTION_ATTACHED_TEXT', 'TEXT', 'CUSTOM_TEXT', 'OPTION_SELECTIONS_WITH_CUSTOM_TEXT'],
        },
      }),
    ).resolves.toMatchObject({ status: 'RECEIVED' });
    await waitForRunStatus(gateway, submitted.runId, 'COMPLETED');
    await expect(
      gateway.pendingInputs.loadPendingInput({
        tenantId: identity.tenantId,
        subjectId: identity.subjectId,
        agentId,
        pendingInputId: pending!.pendingInputId,
      }),
    ).resolves.toMatchObject({
      responseAnswers: [['later', '10 minutes'], ['NA2312038368AAW'], ['tonight'], ['alarm', 'performance', 'include historical alarms']],
      responseAnswerKinds: ['OPTION_ATTACHED_TEXT', 'TEXT', 'CUSTOM_TEXT', 'OPTION_SELECTIONS_WITH_CUSTOM_TEXT'],
    });
    const events = await gateway.timeline.listEvents({
      tenantId: identity.tenantId,
      subjectId: identity.subjectId,
      agentId,
      sessionId,
      afterSequence: brand<number, 'TimelineSequence'>(0),
      limit: 100,
    });
    const messages = await gateway.messages.listCurrentRequestMessages({
      tenantId: identity.tenantId,
      subjectId: identity.subjectId,
      agentId,
      sessionId,
      requestId: submitted.requestId,
      runId: submitted.runId,
      includeHidden: true,
      offset: 0,
      limit: 20,
    });

    expect(executeCount).toBe(2);
    expect(events.map((event) => event.type)).toEqual(expect.arrayContaining(['USER_INPUT_REQUIRED', 'USER_INPUT_RECEIVED', 'REQUEST_COMPLETED']));
    expect(JSON.stringify(events.filter((event) => event.type === 'USER_INPUT_RECEIVED'))).not.toContain('10 minutes');
    const capabilityResults = messages.items.filter((message) => message.role === 'CAPABILITY_RESULT');
    expect(messages.items.filter((message) => message.role === 'USER')).toHaveLength(1);
    expect(capabilityResults).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ metadata: expect.objectContaining({ toolCallId: 'ask-user-1', toolName: 'ask-user-question' }) }),
      ]),
    );
    const capabilityResultPayload = JSON.parse(capabilityResults[0]!.content) as {
      payload?: {
        answers?: ReadonlyArray<readonly string[]>;
        answerKinds?: readonly string[];
        resolvedAnswers?: readonly JsonObject[];
        instruction?: string;
      };
    };
    expect(capabilityResultPayload.payload?.answers).toEqual([
      ['later', '10 minutes'],
      ['NA2312038368AAW'],
      ['tonight'],
      ['alarm', 'performance', 'include historical alarms'],
    ]);
    expect(capabilityResultPayload.payload?.answerKinds).toEqual([
      'OPTION_ATTACHED_TEXT',
      'TEXT',
      'CUSTOM_TEXT',
      'OPTION_SELECTIONS_WITH_CUSTOM_TEXT',
    ]);
    expect(capabilityResultPayload.payload?.resolvedAnswers).toEqual([
      {
        questionIndex: 0,
        selections: [{ value: 'later', label: 'Later', textInput: '10 minutes' }],
      },
      {
        questionIndex: 1,
        text: 'NA2312038368AAW',
      },
      {
        questionIndex: 2,
        selections: [],
        customText: 'tonight',
      },
      {
        questionIndex: 3,
        selections: [
          { value: 'alarm', label: 'Alarm' },
          { value: 'performance', label: 'Performance' },
        ],
        customText: 'include historical alarms',
      },
    ]);
    expect(capabilityResultPayload.payload?.instruction).toBe(
      'Use resolvedAnswers as the interpreted user response and answerKinds, when present, as its input-source classification. For CUSTOM_TEXT, customText is authoritative free text. For OPTION_SELECTIONS_WITH_CUSTOM_TEXT, selections and customText are intentional parts of one answer; use both without discarding or reinterpreting either. A customText value matching a predefined option value or label remains custom text. Do not repeat the previous AskUserQuestion merely because customText is not a predefined selection.',
    );
  });

  it('publishes the accepted AskUserQuestion answer result after the durable message', async () => {
    const gateway = createTestGatewayStores();
    const sessionId = brand<string, 'SessionId'>('session-ask-user-answer-result');
    const publicationOrder: string[] = [];
    const observedEvents: RunTimelineEvent[] = [];
    const originalAppend = gateway.messages.appendSessionMessage.bind(gateway.messages);
    const messageStore = Object.create(gateway.messages) as typeof gateway.messages;
    messageStore.appendSessionMessage = async (record, options) => {
      const appended = await originalAppend(record, options);
      if (record.role === 'CAPABILITY_RESULT' && record.metadata['toolName'] === 'AskUserQuestion') {
        publicationOrder.push('durable');
      }
      return appended;
    };
    await gateway.sessions.saveSession({
      tenantId: identity.tenantId,
      subjectId: identity.subjectId,
      agentId,
      sessionId,
      createdAt: brand<number, 'EpochMillis'>(1),
      updatedAt: brand<number, 'EpochMillis'>(1),
    });
    const runtime = createRuntime(gateway, async () => {}, {
      messageStore,
      runTimelineEventListeners: [
        (event) => {
          observedEvents.push(event);
          if (event.type === 'CAPABILITY_RESULT_DELTA' && event.inlinePayload['capabilityId'] === 'AskUserQuestion') {
            publicationOrder.push('live');
          }
        },
      ],
      agentConstructors: [
        createRuntimePendingInputAgentConstructor(
          {
            kind: 'QUESTION',
            questions: [{ prompt: 'Select a site.', options: [{ label: 'Site A', value: 'site-a' }] }],
          },
          (count) => {
            if (count === 2) {
              publicationOrder.push('resume');
            }
          },
          'AskUserQuestion',
        ),
      ],
    });

    const submitted = await runtime.submit({
      sessionId,
      identityContext: identity,
      inputText: 'ask for a site',
      attachmentIds: [],
      locale: brand<string, 'RequestLocale'>('zh-CN'),
      idempotencyKey: brand<string, 'IdempotencyKey'>('idem-ask-user-answer-result'),
    });
    await waitFor(
      async () =>
        (await gateway.pendingInputs.loadActivePendingInput({
          tenantId: identity.tenantId,
          subjectId: identity.subjectId,
          agentId,
          sessionId,
        })) !== undefined,
    );
    const pending = await gateway.pendingInputs.loadActivePendingInput({
      tenantId: identity.tenantId,
      subjectId: identity.subjectId,
      agentId,
      sessionId,
    });

    const answerCommand = {
      identityContext: identity,
      idempotencyKey: brand<string, 'IdempotencyKey'>('idem-ask-user-answer-result-submit'),
      answer: {
        sessionId,
        pendingInputId: pending!.pendingInputId,
        answers: [['site-a']],
      },
    };
    await expect(runtime.answerPendingInput(answerCommand)).resolves.toMatchObject({ status: 'RECEIVED' });
    await waitForRunStatus(gateway, submitted.runId, 'COMPLETED');
    await expect(runtime.answerPendingInput(answerCommand)).rejects.toMatchObject({ code: 'PENDING_INPUT_RESUME_UNAVAILABLE' });

    const messages = await gateway.messages.listCurrentRequestMessages({
      tenantId: identity.tenantId,
      subjectId: identity.subjectId,
      agentId,
      sessionId,
      requestId: submitted.requestId,
      runId: submitted.runId,
      includeHidden: true,
      offset: 0,
      limit: 20,
    });
    const answerEvents = observedEvents.filter(
      (event) => event.type === 'CAPABILITY_RESULT_DELTA' && event.inlinePayload['capabilityId'] === 'AskUserQuestion',
    );
    const lifecycleEvents = observedEvents.filter(
      (event) =>
        (event.type === 'CAPABILITY_STARTED' || event.type === 'CAPABILITY_COMPLETED') && event.inlinePayload['capabilityId'] === 'AskUserQuestion',
    );
    const resultMessages = messages.items.filter(
      (message) => message.role === 'CAPABILITY_RESULT' && message.metadata['toolName'] === 'AskUserQuestion',
    );

    expect(publicationOrder).toEqual(['durable', 'live', 'resume']);
    expect(answerEvents).toHaveLength(1);
    expect(answerEvents[0]).toMatchObject({
      persistence: 'LIVE_ONLY',
      inlinePayload: {
        capabilityId: 'AskUserQuestion',
        toolCallId: 'ask-user-1',
        pendingInputId: pending!.pendingInputId,
        kind: 'QUESTION',
        status: 'RECEIVED',
        safeSummary: 'Pending input answer received.',
        answers: [['site-a']],
      },
    });
    expect(resultMessages).toHaveLength(1);
    expect(lifecycleEvents).toEqual([
      expect.objectContaining({
        type: 'CAPABILITY_COMPLETED',
        persistence: 'PERSISTED',
        inlinePayload: {
          messageId: resultMessages[0]!.messageId,
          capabilityId: 'AskUserQuestion',
          toolCallId: 'ask-user-1',
          status: 'SUCCEEDED',
        },
      }),
    ]);
  });

  it('keeps the AskUserQuestion answer result durable without a live subscriber or answer logs', async () => {
    const gateway = createTestGatewayStores();
    const sessionId = brand<string, 'SessionId'>('session-ask-user-answer-result-no-subscriber');
    const answerFixture = 'UNIQUE_PENDING_INPUT_ANSWER_FIXTURE';
    const logEntries: unknown[] = [];
    loggerBinding = bindRuntimeLoggerProvider({
      getLogger: () => ({
        debug(entry) {
          logEntries.push(entry);
        },
        info(entry) {
          logEntries.push(entry);
        },
        warn(entry) {
          logEntries.push(entry);
        },
        error(entry) {
          logEntries.push(entry);
        },
      }),
    });
    await gateway.sessions.saveSession({
      tenantId: identity.tenantId,
      subjectId: identity.subjectId,
      agentId,
      sessionId,
      createdAt: brand<number, 'EpochMillis'>(1),
      updatedAt: brand<number, 'EpochMillis'>(1),
    });
    const runtime = createRuntime(gateway, async () => {}, {
      agentConstructors: [
        createRuntimePendingInputAgentConstructor(
          {
            kind: 'QUESTION',
            questions: [{ prompt: 'Provide a value.', options: [] }],
          },
          () => {},
          'AskUserQuestion',
        ),
      ],
    });

    const submitted = await runtime.submit({
      sessionId,
      identityContext: identity,
      inputText: 'ask without a subscriber',
      attachmentIds: [],
      locale: brand<string, 'RequestLocale'>('zh-CN'),
      idempotencyKey: brand<string, 'IdempotencyKey'>('idem-ask-user-answer-result-no-subscriber'),
    });
    await waitFor(
      async () =>
        (await gateway.pendingInputs.loadActivePendingInput({
          tenantId: identity.tenantId,
          subjectId: identity.subjectId,
          agentId,
          sessionId,
        })) !== undefined,
    );
    const pending = await gateway.pendingInputs.loadActivePendingInput({
      tenantId: identity.tenantId,
      subjectId: identity.subjectId,
      agentId,
      sessionId,
    });

    await expect(
      runtime.answerPendingInput({
        identityContext: identity,
        idempotencyKey: brand<string, 'IdempotencyKey'>('idem-ask-user-answer-result-no-subscriber-submit'),
        answer: {
          sessionId,
          pendingInputId: pending!.pendingInputId,
          answers: [[answerFixture]],
        },
      }),
    ).resolves.toMatchObject({ status: 'RECEIVED' });
    await waitForRunStatus(gateway, submitted.runId, 'COMPLETED');

    const messages = await gateway.messages.listCurrentRequestMessages({
      tenantId: identity.tenantId,
      subjectId: identity.subjectId,
      agentId,
      sessionId,
      requestId: submitted.requestId,
      runId: submitted.runId,
      includeHidden: true,
      offset: 0,
      limit: 20,
    });
    const timelineEvents = await gateway.timeline.listEvents({
      tenantId: identity.tenantId,
      subjectId: identity.subjectId,
      agentId,
      sessionId,
      afterSequence: brand<number, 'TimelineSequence'>(0),
      limit: 100,
    });
    expect(messages.items.some((message) => message.role === 'CAPABILITY_RESULT' && message.content.includes(answerFixture))).toBe(true);
    expect(logEntries.length).toBeGreaterThan(0);
    expect(JSON.stringify(logEntries)).not.toContain(answerFixture);
    expect(JSON.stringify(timelineEvents)).not.toContain(answerFixture);
  });

  it('does not publish an AskUserQuestion answer result when the durable message write fails', async () => {
    const gateway = createTestGatewayStores();
    const sessionId = brand<string, 'SessionId'>('session-ask-user-answer-result-write-failure');
    const observedEvents: RunTimelineEvent[] = [];
    let executeCount = 0;
    const originalAppend = gateway.messages.appendSessionMessage.bind(gateway.messages);
    const messageStore = Object.create(gateway.messages) as typeof gateway.messages;
    messageStore.appendSessionMessage = async (record, options) => {
      if (record.role === 'CAPABILITY_RESULT' && record.metadata['toolName'] === 'AskUserQuestion') {
        throw new Error('durable answer result write failed');
      }
      return originalAppend(record, options);
    };
    await gateway.sessions.saveSession({
      tenantId: identity.tenantId,
      subjectId: identity.subjectId,
      agentId,
      sessionId,
      createdAt: brand<number, 'EpochMillis'>(1),
      updatedAt: brand<number, 'EpochMillis'>(1),
    });
    const runtime = createRuntime(gateway, async () => {}, {
      messageStore,
      runTimelineEventListeners: [(event) => observedEvents.push(event)],
      agentConstructors: [
        createRuntimePendingInputAgentConstructor(
          {
            kind: 'QUESTION',
            questions: [{ prompt: 'Continue?', options: [{ label: 'Yes', value: 'yes' }] }],
          },
          (count) => {
            executeCount = count;
          },
          'AskUserQuestion',
        ),
      ],
    });

    const submitted = await runtime.submit({
      sessionId,
      identityContext: identity,
      inputText: 'ask before failing',
      attachmentIds: [],
      locale: brand<string, 'RequestLocale'>('zh-CN'),
      idempotencyKey: brand<string, 'IdempotencyKey'>('idem-ask-user-answer-result-write-failure'),
    });
    await waitFor(
      async () =>
        (await gateway.pendingInputs.loadActivePendingInput({
          tenantId: identity.tenantId,
          subjectId: identity.subjectId,
          agentId,
          sessionId,
        })) !== undefined,
    );
    const pending = await gateway.pendingInputs.loadActivePendingInput({
      tenantId: identity.tenantId,
      subjectId: identity.subjectId,
      agentId,
      sessionId,
    });

    await expect(
      runtime.answerPendingInput({
        identityContext: identity,
        idempotencyKey: brand<string, 'IdempotencyKey'>('idem-ask-user-answer-result-write-failure-submit'),
        answer: {
          sessionId,
          pendingInputId: pending!.pendingInputId,
          answers: [['yes']],
        },
      }),
    ).resolves.toMatchObject({ status: 'RECEIVED' });
    await waitForRunStatus(gateway, submitted.runId, 'FAILED');

    expect(executeCount).toBe(1);
    expect(
      observedEvents.some((event) => event.type === 'CAPABILITY_RESULT_DELTA' && event.inlinePayload['capabilityId'] === 'AskUserQuestion'),
    ).toBe(false);
  });

  it('resumes confirmation approve and terminalizes confirmation reject as non-approval', async () => {
    const cases = [
      { name: 'approve', answer: 'approve', terminalStatus: 'COMPLETED', expectedExecuteCount: 2 },
      { name: 'reject', answer: 'reject', terminalStatus: 'FAILED', expectedExecuteCount: 1 },
    ] as const;

    for (const testCase of cases) {
      const gateway = createTestGatewayStores();
      const sessionId = brand<string, 'SessionId'>(`session-confirmation-${testCase.name}`);
      let executeCount = 0;
      await gateway.sessions.saveSession({
        tenantId: identity.tenantId,
        subjectId: identity.subjectId,
        agentId,
        sessionId,
        createdAt: brand<number, 'EpochMillis'>(1),
        updatedAt: brand<number, 'EpochMillis'>(1),
      });
      const runtime = createRuntime(gateway, async () => {}, {
        agentConstructors: [
          createRuntimePendingInputAgentConstructor(
            {
              kind: 'CONFIRMATION',
              questions: confirmationQuestions('Approve guarded step?'),
            },
            (count) => {
              executeCount = count;
            },
          ),
        ],
      });

      const submitted = await runtime.submit({
        sessionId,
        identityContext: identity,
        inputText: `confirmation ${testCase.name}`,
        attachmentIds: [],
        locale: brand<string, 'RequestLocale'>('zh-CN'),
        idempotencyKey: brand<string, 'IdempotencyKey'>(`idem-confirmation-${testCase.name}`),
      });
      await waitFor(
        async () =>
          (await gateway.pendingInputs.loadActivePendingInput({
            tenantId: identity.tenantId,
            subjectId: identity.subjectId,
            agentId,
            sessionId,
          })) !== undefined,
      );
      const pending = await gateway.pendingInputs.loadActivePendingInput({
        tenantId: identity.tenantId,
        subjectId: identity.subjectId,
        agentId,
        sessionId,
      });

      await expect(
        runtime.answerPendingInput({
          identityContext: identity,
          idempotencyKey: brand<string, 'IdempotencyKey'>(`idem-confirmation-answer-${testCase.name}`),
          answer: {
            sessionId,
            pendingInputId: pending!.pendingInputId,
            answers: [[testCase.answer]],
          },
        }),
      ).resolves.toMatchObject({ status: 'RECEIVED' });
      await waitForRunStatus(gateway, submitted.runId, testCase.terminalStatus);
      const resolved = await gateway.pendingInputs.loadPendingInput({
        tenantId: identity.tenantId,
        subjectId: identity.subjectId,
        agentId,
        pendingInputId: pending!.pendingInputId,
      });
      const events = await gateway.timeline.listEvents({
        tenantId: identity.tenantId,
        subjectId: identity.subjectId,
        agentId,
        sessionId,
        afterSequence: brand<number, 'TimelineSequence'>(0),
        limit: 100,
      });
      const messages = await gateway.messages.listCurrentRequestMessages({
        tenantId: identity.tenantId,
        subjectId: identity.subjectId,
        agentId,
        sessionId,
        requestId: submitted.requestId,
        runId: submitted.runId,
        includeHidden: true,
        offset: 0,
        limit: 20,
      });

      expect(resolved?.status).toBe('RECEIVED');
      expect(executeCount).toBe(testCase.expectedExecuteCount);
      expect(events.map((event) => event.type)).toContain('USER_INPUT_RECEIVED');
      if (testCase.answer === 'reject') {
        expect(events.map((event) => event.type)).not.toContain('REQUEST_COMPLETED');
        expect(events.find((event) => event.type === 'REQUEST_FAILED')?.inlinePayload['content']).toBe(
          'Request failed safely: PENDING_INPUT_REJECTED',
        );
        expect(messages.items.some((message) => message.role === 'CAPABILITY_RESULT')).toBe(false);
      } else {
        expect(events.map((event) => event.type)).toContain('REQUEST_COMPLETED');
      }
    }
  });

  it('resumes authorization approve and terminalizes authorization deny as non-execution', async () => {
    const cases = [
      { name: 'approve', answer: 'approve', terminalStatus: 'COMPLETED', expectedExecuteCount: 2 },
      { name: 'deny', answer: 'deny', terminalStatus: 'FAILED', expectedExecuteCount: 1 },
    ] as const;

    for (const testCase of cases) {
      const gateway = createTestGatewayStores();
      const sessionId = brand<string, 'SessionId'>(`session-authorization-${testCase.name}`);
      let executeCount = 0;
      await gateway.sessions.saveSession({
        tenantId: identity.tenantId,
        subjectId: identity.subjectId,
        agentId,
        sessionId,
        createdAt: brand<number, 'EpochMillis'>(1),
        updatedAt: brand<number, 'EpochMillis'>(1),
      });
      const runtime = createRuntime(gateway, async () => {}, {
        agentConstructors: [
          createRuntimePendingInputAgentConstructor(
            {
              kind: 'AUTHORIZATION',
              questions: authorizationQuestions('Authorize protected operation?'),
            },
            (count) => {
              executeCount = count;
            },
          ),
        ],
      });

      const submitted = await runtime.submit({
        sessionId,
        identityContext: identity,
        inputText: `authorization ${testCase.name}`,
        attachmentIds: [],
        locale: brand<string, 'RequestLocale'>('zh-CN'),
        idempotencyKey: brand<string, 'IdempotencyKey'>(`idem-authorization-${testCase.name}`),
      });
      await waitFor(
        async () =>
          (await gateway.pendingInputs.loadActivePendingInput({
            tenantId: identity.tenantId,
            subjectId: identity.subjectId,
            agentId,
            sessionId,
          })) !== undefined,
      );
      const pending = await gateway.pendingInputs.loadActivePendingInput({
        tenantId: identity.tenantId,
        subjectId: identity.subjectId,
        agentId,
        sessionId,
      });

      await expect(
        runtime.answerPendingInput({
          identityContext: identity,
          idempotencyKey: brand<string, 'IdempotencyKey'>(`idem-authorization-answer-${testCase.name}`),
          answer: {
            sessionId,
            pendingInputId: pending!.pendingInputId,
            answers: [[testCase.answer]],
            operationId: 'client-supplied-operation',
            permissionScope: 'client-supplied-scope',
            policyDecision: 'client-supplied-policy',
            identity: { tenantId: 'other-tenant' },
            capabilityArgs: { command: 'unsafe' },
          } as unknown as Parameters<typeof runtime.answerPendingInput>[0]['answer'],
        }),
      ).resolves.toMatchObject({ status: 'RECEIVED' });
      await waitForRunStatus(gateway, submitted.runId, testCase.terminalStatus);
      const resolved = await gateway.pendingInputs.loadPendingInput({
        tenantId: identity.tenantId,
        subjectId: identity.subjectId,
        agentId,
        pendingInputId: pending!.pendingInputId,
      });
      const events = await gateway.timeline.listEvents({
        tenantId: identity.tenantId,
        subjectId: identity.subjectId,
        agentId,
        sessionId,
        afterSequence: brand<number, 'TimelineSequence'>(0),
        limit: 100,
      });

      expect(resolved?.status).toBe('RECEIVED');
      expect(executeCount).toBe(testCase.expectedExecuteCount);
      expect(JSON.stringify(resolved?.responseAnswers)).not.toContain('client-supplied');
      if (testCase.answer === 'deny') {
        expect(events.map((event) => event.type)).not.toContain('REQUEST_COMPLETED');
        expect(events.find((event) => event.type === 'REQUEST_FAILED')?.inlinePayload['content']).toBe('Request failed safely: PENDING_INPUT_DENIED');
      } else {
        expect(events.map((event) => event.type)).toContain('REQUEST_COMPLETED');
      }
    }
  });

  it('does not reuse one authorization approval for a second protected operation', async () => {
    class DoubleAuthorizationAgent {
      private executeCount = 0;

      static getType() {
        return brand<string, 'AgentType'>('default');
      }

      constructor(private readonly kit: AgentRuntimeKit<object>) {}

      async execute(run: RequestRun, context: RequestContext): Promise<AgentExecutionOutcome> {
        this.executeCount += 1;
        if (this.executeCount <= 2) {
          const pendingInput = await this.kit.runState.requestPendingInput(
            run,
            {
              ...context,
              nextLifecycleStage: 'BEFORE_CAPABILITY_INVOKE',
              toolCallStates: [
                {
                  toolCallId: `authorize-op-${this.executeCount}`,
                  capabilityId: brand<string, 'CapabilityId'>('protected-operation'),
                  arguments: {},
                  status: 'PENDING',
                },
              ],
            },
            {
              kind: 'AUTHORIZATION',
              questions: authorizationQuestions(`Authorize operation ${this.executeCount}?`),
            },
          );
          return { status: 'PENDING_INPUT', pendingInput };
        }
        await this.kit.runState.emitEvent(run, context, {
          type: 'LLM_CONTENT_DELTA',
          inlinePayload: { final: true, content: 'protected operations completed' },
        });
        return { status: 'COMPLETED' };
      }
    }

    const gateway = createTestGatewayStores();
    const sessionId = brand<string, 'SessionId'>('session-authorization-consumed-once');
    await gateway.sessions.saveSession({
      tenantId: identity.tenantId,
      subjectId: identity.subjectId,
      agentId,
      sessionId,
      createdAt: brand<number, 'EpochMillis'>(1),
      updatedAt: brand<number, 'EpochMillis'>(1),
    });
    const runtime = createRuntime(gateway, async () => {}, {
      agentConstructors: [DoubleAuthorizationAgent],
    });

    const submitted = await runtime.submit({
      sessionId,
      identityContext: identity,
      inputText: 'two protected operations',
      attachmentIds: [],
      locale: brand<string, 'RequestLocale'>('zh-CN'),
      idempotencyKey: brand<string, 'IdempotencyKey'>('idem-authorization-consumed-once'),
    });
    await waitFor(
      async () =>
        (await gateway.pendingInputs.loadActivePendingInput({
          tenantId: identity.tenantId,
          subjectId: identity.subjectId,
          agentId,
          sessionId,
        })) !== undefined,
    );
    const firstPending = await gateway.pendingInputs.loadActivePendingInput({
      tenantId: identity.tenantId,
      subjectId: identity.subjectId,
      agentId,
      sessionId,
    });

    await expect(
      runtime.answerPendingInput({
        identityContext: identity,
        idempotencyKey: brand<string, 'IdempotencyKey'>('idem-authorization-first-approve'),
        answer: {
          sessionId,
          pendingInputId: firstPending!.pendingInputId,
          answers: [['approve']],
        },
      }),
    ).resolves.toMatchObject({ status: 'RECEIVED' });
    await waitFor(async () => {
      const active = await gateway.pendingInputs.loadActivePendingInput({
        tenantId: identity.tenantId,
        subjectId: identity.subjectId,
        agentId,
        sessionId,
      });
      return active !== undefined && active.pendingInputId !== firstPending!.pendingInputId;
    });
    const secondPending = await gateway.pendingInputs.loadActivePendingInput({
      tenantId: identity.tenantId,
      subjectId: identity.subjectId,
      agentId,
      sessionId,
    });

    expect(secondPending?.kind).toBe('AUTHORIZATION');
    expect(secondPending?.pendingInputId).not.toBe(firstPending?.pendingInputId);
    await expect(
      runtime.answerPendingInput({
        identityContext: identity,
        idempotencyKey: brand<string, 'IdempotencyKey'>('idem-authorization-first-reuse'),
        answer: {
          sessionId,
          pendingInputId: firstPending!.pendingInputId,
          answers: [['approve']],
        },
      }),
    ).rejects.toMatchObject({ code: 'PENDING_INPUT_ALREADY_RESOLVED' });
    await expect(
      runtime.answerPendingInput({
        identityContext: identity,
        idempotencyKey: brand<string, 'IdempotencyKey'>('idem-authorization-second-deny'),
        answer: {
          sessionId,
          pendingInputId: secondPending!.pendingInputId,
          answers: [['deny']],
        },
      }),
    ).resolves.toMatchObject({ status: 'RECEIVED' });
    await waitForRunStatus(gateway, submitted.runId, 'FAILED');
    const events = await gateway.timeline.listEvents({
      tenantId: identity.tenantId,
      subjectId: identity.subjectId,
      agentId,
      sessionId,
      afterSequence: brand<number, 'TimelineSequence'>(0),
      limit: 100,
    });

    expect(events.find((event) => event.type === 'REQUEST_FAILED')?.inlinePayload['content']).toBe('Request failed safely: PENDING_INPUT_DENIED');
    expect(events.map((event) => event.type)).not.toContain('REQUEST_COMPLETED');
  });

  it('terminal-commits human handoff final answer without model regeneration', async () => {
    const gateway = createTestGatewayStores();
    const sessionId = brand<string, 'SessionId'>('session-handoff-final-answer');
    let executeCount = 0;
    await gateway.sessions.saveSession({
      tenantId: identity.tenantId,
      subjectId: identity.subjectId,
      agentId,
      sessionId,
      createdAt: brand<number, 'EpochMillis'>(1),
      updatedAt: brand<number, 'EpochMillis'>(1),
    });
    const runtime = createRuntime(gateway, async () => {}, {
      agentConstructors: [
        createRuntimePendingInputAgentConstructor(
          {
            kind: 'HUMAN_HANDOFF',
            questions: handoffQuestions(),
          },
          (count) => {
            executeCount = count;
          },
        ),
      ],
    });

    const submitted = await runtime.submit({
      sessionId,
      identityContext: identity,
      inputText: 'handoff final',
      attachmentIds: [],
      locale: brand<string, 'RequestLocale'>('zh-CN'),
      idempotencyKey: brand<string, 'IdempotencyKey'>('idem-handoff-final'),
    });
    await waitFor(
      async () =>
        (await gateway.pendingInputs.loadActivePendingInput({
          tenantId: identity.tenantId,
          subjectId: identity.subjectId,
          agentId,
          sessionId,
        })) !== undefined,
    );
    const pending = await gateway.pendingInputs.loadActivePendingInput({
      tenantId: identity.tenantId,
      subjectId: identity.subjectId,
      agentId,
      sessionId,
    });

    await expect(
      runtime.answerPendingInput({
        identityContext: identity,
        idempotencyKey: brand<string, 'IdempotencyKey'>('idem-handoff-final-answer'),
        answer: {
          sessionId,
          pendingInputId: pending!.pendingInputId,
          answers: [['final_answer'], ['Human final answer.']],
        },
      }),
    ).resolves.toMatchObject({ status: 'RECEIVED' });
    await waitForRunStatus(gateway, submitted.runId, 'COMPLETED');
    const events = await gateway.timeline.listEvents({
      tenantId: identity.tenantId,
      subjectId: identity.subjectId,
      agentId,
      sessionId,
      afterSequence: brand<number, 'TimelineSequence'>(0),
      limit: 100,
    });
    const messages = await gateway.messages.listCurrentRequestMessages({
      tenantId: identity.tenantId,
      subjectId: identity.subjectId,
      agentId,
      sessionId,
      requestId: submitted.requestId,
      runId: submitted.runId,
      includeHidden: true,
      offset: 0,
      limit: 20,
    });

    expect(executeCount).toBe(1);
    expect(events.find((event) => event.type === 'REQUEST_COMPLETED')?.inlinePayload['content']).toBe('Human final answer.');
    expect(messages.items.some((message) => message.role === 'CAPABILITY_RESULT')).toBe(false);
    expect(messages.items.filter((message) => message.role === 'USER')).toHaveLength(1);
  });

  it('resumes human handoff instruction without creating a new root request', async () => {
    const gateway = createTestGatewayStores();
    const sessionId = brand<string, 'SessionId'>('session-handoff-resume-instruction');
    let executeCount = 0;
    await gateway.sessions.saveSession({
      tenantId: identity.tenantId,
      subjectId: identity.subjectId,
      agentId,
      sessionId,
      createdAt: brand<number, 'EpochMillis'>(1),
      updatedAt: brand<number, 'EpochMillis'>(1),
    });
    const runtime = createRuntime(gateway, async () => {}, {
      agentConstructors: [
        createRuntimePendingInputAgentConstructor(
          {
            kind: 'HUMAN_HANDOFF',
            questions: handoffQuestions(),
          },
          (count) => {
            executeCount = count;
          },
        ),
      ],
    });

    const submitted = await runtime.submit({
      sessionId,
      identityContext: identity,
      inputText: 'handoff resume',
      attachmentIds: [],
      locale: brand<string, 'RequestLocale'>('zh-CN'),
      idempotencyKey: brand<string, 'IdempotencyKey'>('idem-handoff-resume'),
    });
    await waitFor(
      async () =>
        (await gateway.pendingInputs.loadActivePendingInput({
          tenantId: identity.tenantId,
          subjectId: identity.subjectId,
          agentId,
          sessionId,
        })) !== undefined,
    );
    const pending = await gateway.pendingInputs.loadActivePendingInput({
      tenantId: identity.tenantId,
      subjectId: identity.subjectId,
      agentId,
      sessionId,
    });

    await expect(
      runtime.answerPendingInput({
        identityContext: identity,
        idempotencyKey: brand<string, 'IdempotencyKey'>('idem-handoff-resume-answer'),
        answer: {
          sessionId,
          pendingInputId: pending!.pendingInputId,
          answers: [['resume_instruction'], ['Continue with the human-provided constraint.']],
        },
      }),
    ).resolves.toMatchObject({ status: 'RECEIVED' });
    await waitForRunStatus(gateway, submitted.runId, 'COMPLETED');
    const messages = await gateway.messages.listCurrentRequestMessages({
      tenantId: identity.tenantId,
      subjectId: identity.subjectId,
      agentId,
      sessionId,
      requestId: submitted.requestId,
      runId: submitted.runId,
      includeHidden: true,
      offset: 0,
      limit: 20,
    });
    const capabilityResults = messages.items.filter((message) => message.role === 'CAPABILITY_RESULT');
    const capabilityResultPayload = JSON.parse(capabilityResults[0]!.content) as { payload?: { resumeInstruction?: string } };

    expect(executeCount).toBe(2);
    expect(messages.items.filter((message) => message.role === 'USER')).toHaveLength(1);
    expect(capabilityResultPayload.payload?.resumeInstruction).toBe('Continue with the human-provided constraint.');
  });

  it('assigns default timeout and persists bounded explicit timeout requests with the runtime clock', async () => {
    const cases = [
      { name: 'default', clockNow: 1_000_000, intentTimeoutAt: undefined },
      { name: 'explicit', clockNow: 10_000_000, intentTimeoutAt: brand<number, 'EpochMillis'>(10_000_000 + 5 * 60 * 1000) },
    ] as const;

    for (const testCase of cases) {
      const gateway = createTestGatewayStores();
      const sessionId = brand<string, 'SessionId'>(`session-pending-timeout-${testCase.name}`);
      let now = testCase.clockNow;
      await gateway.sessions.saveSession({
        tenantId: identity.tenantId,
        subjectId: identity.subjectId,
        agentId,
        sessionId,
        createdAt: brand<number, 'EpochMillis'>(1),
        updatedAt: brand<number, 'EpochMillis'>(1),
      });
      const runtime = createRuntime(gateway, async () => {}, {
        clock: () => brand<number, 'EpochMillis'>(now),
        agentConstructors: [
          createRuntimePendingInputAgentConstructor(
            {
              kind: 'QUESTION',
              questions: [
                {
                  prompt: 'Need an answer?',
                  options: [
                    { label: 'Existing project', value: 'existing_project', requiresTextInput: true, inputPlaceholder: 'Enter the project path' },
                    { label: 'New project', value: 'new_project' },
                  ],
                },
              ],
              ...(testCase.intentTimeoutAt === undefined ? {} : { timeoutAt: testCase.intentTimeoutAt }),
            },
            () => {},
          ),
        ],
      });

      await runtime.submit({
        sessionId,
        identityContext: identity,
        inputText: 'needs pending input timeout',
        attachmentIds: [],
        locale: brand<string, 'RequestLocale'>('zh-CN'),
        idempotencyKey: brand<string, 'IdempotencyKey'>(`idem-pending-timeout-${testCase.name}`),
      });
      await waitFor(
        async () =>
          (await gateway.pendingInputs.loadActivePendingInput({
            tenantId: identity.tenantId,
            subjectId: identity.subjectId,
            agentId,
            sessionId,
          })) !== undefined,
      );
      const pending = await gateway.pendingInputs.loadActivePendingInput({
        tenantId: identity.tenantId,
        subjectId: identity.subjectId,
        agentId,
        sessionId,
      });
      const events = await gateway.timeline.listEvents({
        tenantId: identity.tenantId,
        subjectId: identity.subjectId,
        agentId,
        sessionId,
        afterSequence: brand<number, 'TimelineSequence'>(0),
        limit: 100,
      });
      const requiredEvent = events.find((event) => event.type === 'USER_INPUT_REQUIRED');

      expect(pending?.request.timeoutAt).toBeDefined();
      if (testCase.intentTimeoutAt === undefined) {
        expect(Number(pending!.request.timeoutAt) - Number(pending!.createdAt)).toBe(pendingInputDefaultTimeoutMs);
      } else {
        expect(pending!.request.timeoutAt).toBe(testCase.intentTimeoutAt);
      }
      expect(requiredEvent?.inlinePayload['timeoutAt']).toBe(pending?.request.timeoutAt);
      expect(pending?.request.questions[0]?.options[0]).toEqual({
        label: 'Existing project',
        value: 'existing_project',
        requiresTextInput: true,
        inputPlaceholder: 'Enter the project path',
      });
      expect((requiredEvent?.inlinePayload['questions'] as readonly JsonObject[] | undefined)?.[0]?.['options']).toEqual([
        {
          label: 'Existing project',
          value: 'existing_project',
          requiresTextInput: true,
          inputPlaceholder: 'Enter the project path',
        },
        { label: 'New project', value: 'new_project' },
      ]);
    }
  });

  it('rejects invalid explicit pending input timeouts without creating visible pending facts', async () => {
    const invalidTimeouts = [
      { name: 'past', timeoutAt: brand<number, 'EpochMillis'>(999_999) },
      { name: 'equal', timeoutAt: brand<number, 'EpochMillis'>(1_000_000) },
      { name: 'over-max', timeoutAt: brand<number, 'EpochMillis'>(1_000_000 + pendingInputMaxTimeoutMs + 10_000) },
      { name: 'unsafe', timeoutAt: brand<number, 'EpochMillis'>(Number.MAX_SAFE_INTEGER + 1) },
    ] as const;

    for (const testCase of invalidTimeouts) {
      const gateway = createTestGatewayStores();
      const sessionId = brand<string, 'SessionId'>(`session-invalid-timeout-${testCase.name}`);
      await gateway.sessions.saveSession({
        tenantId: identity.tenantId,
        subjectId: identity.subjectId,
        agentId,
        sessionId,
        createdAt: brand<number, 'EpochMillis'>(1),
        updatedAt: brand<number, 'EpochMillis'>(1),
      });
      const runtime = createRuntime(gateway, async () => {}, {
        clock: () => brand<number, 'EpochMillis'>(1_000_000),
        agentConstructors: [
          createRuntimePendingInputAgentConstructor(
            {
              kind: 'QUESTION',
              questions: [{ prompt: 'Need an answer?', options: [{ label: 'Yes', value: 'yes' }] }],
              timeoutAt: testCase.timeoutAt,
            },
            () => {},
          ),
        ],
      });

      const submitted = await runtime.submit({
        sessionId,
        identityContext: identity,
        inputText: 'invalid pending input timeout',
        attachmentIds: [],
        locale: brand<string, 'RequestLocale'>('zh-CN'),
        idempotencyKey: brand<string, 'IdempotencyKey'>(`idem-invalid-timeout-${testCase.name}`),
      });
      await waitForRunStatus(gateway, submitted.runId, 'FAILED');
      const active = await gateway.pendingInputs.loadActivePendingInput({
        tenantId: identity.tenantId,
        subjectId: identity.subjectId,
        agentId,
        sessionId,
      });
      const events = await gateway.timeline.listEvents({
        tenantId: identity.tenantId,
        subjectId: identity.subjectId,
        agentId,
        sessionId,
        afterSequence: brand<number, 'TimelineSequence'>(0),
        limit: 100,
      });

      expect(active).toBeUndefined();
      expect(events.map((event) => event.type)).not.toContain('USER_INPUT_REQUIRED');
      expect(events.find((event) => event.type === 'REQUEST_FAILED')?.inlinePayload['content']).toContain('Pending input timeout is invalid.');
    }
  });

  it('accepts option-attached text input with custom in question intents', async () => {
    const gateway = createTestGatewayStores();
    const sessionId = brand<string, 'SessionId'>('session-valid-attached-custom');
    await gateway.sessions.saveSession({
      tenantId: identity.tenantId,
      subjectId: identity.subjectId,
      agentId,
      sessionId,
      createdAt: brand<number, 'EpochMillis'>(1),
      updatedAt: brand<number, 'EpochMillis'>(1),
    });
    const intent: PendingInputIntent = {
      kind: 'QUESTION',
      questions: [
        {
          prompt: 'What should receive tests?',
          options: [
            { label: 'Existing project', value: 'existing_project', requiresTextInput: true },
            { label: 'Single file', value: 'single_file' },
          ],
          custom: true,
        },
      ],
    };
    const runtime = createRuntime(gateway, async () => {}, {
      agentConstructors: [createRuntimePendingInputAgentConstructor(intent, () => {})],
    });

    const submitted = await runtime.submit({
      sessionId,
      identityContext: identity,
      inputText: 'valid attached input with custom',
      attachmentIds: [],
      locale: brand<string, 'RequestLocale'>('zh-CN'),
      idempotencyKey: brand<string, 'IdempotencyKey'>('idem-valid-attached-custom'),
    });
    await waitFor(
      async () =>
        (await gateway.pendingInputs.loadActivePendingInput({
          tenantId: identity.tenantId,
          subjectId: identity.subjectId,
          agentId,
          sessionId,
        })) !== undefined,
    );
    await expect(
      gateway.pendingInputs.loadActivePendingInput({
        tenantId: identity.tenantId,
        subjectId: identity.subjectId,
        agentId,
        sessionId,
      }),
    ).resolves.toMatchObject({
      requestRunId: submitted.runId,
      request: {
        questions: [
          {
            custom: true,
            options: [
              { label: 'Existing project', value: 'existing_project', requiresTextInput: true },
              { label: 'Single file', value: 'single_file' },
            ],
          },
        ],
      },
    });
  });

  it('rejects ambiguous or protected option-attached text input intents', async () => {
    const attachedQuestion = {
      prompt: 'What should receive tests?',
      options: [
        { label: 'Existing project', value: 'existing_project', requiresTextInput: true },
        { label: 'Single file', value: 'single_file', requiresTextInput: true },
      ],
    } as const;
    const [handoffMode, handoffContent] = handoffQuestions();
    const invalidIntents = [
      { name: 'multiple', intent: { kind: 'QUESTION', questions: [{ ...attachedQuestion, multiple: true }] } },
      {
        name: 'placeholder-without-flag',
        intent: { kind: 'QUESTION', questions: [{ prompt: 'Pick one', options: [{ label: 'A', value: 'a', inputPlaceholder: 'Details' }] }] },
      },
      {
        name: 'confirmation',
        intent: {
          kind: 'CONFIRMATION',
          questions: [
            {
              ...confirmationQuestions()[0]!,
              options: confirmationQuestions()[0]!.options.map((option) => ({ ...option, requiresTextInput: option.value === 'approve' })),
            },
          ],
        },
      },
      {
        name: 'authorization',
        intent: {
          kind: 'AUTHORIZATION',
          questions: [
            {
              ...authorizationQuestions()[0]!,
              options: authorizationQuestions()[0]!.options.map((option) => ({ ...option, requiresTextInput: option.value === 'approve' })),
            },
          ],
        },
      },
      {
        name: 'handoff',
        intent: {
          kind: 'HUMAN_HANDOFF',
          questions: [
            {
              ...handoffMode!,
              options: handoffMode!.options.map((option) => ({ ...option, requiresTextInput: option.value === 'resume_instruction' })),
            },
            handoffContent!,
          ],
        },
      },
    ] as const satisfies ReadonlyArray<{ readonly name: string; readonly intent: PendingInputIntent }>;

    for (const testCase of invalidIntents) {
      const gateway = createTestGatewayStores();
      const sessionId = brand<string, 'SessionId'>(`session-invalid-attached-${testCase.name}`);
      await gateway.sessions.saveSession({
        tenantId: identity.tenantId,
        subjectId: identity.subjectId,
        agentId,
        sessionId,
        createdAt: brand<number, 'EpochMillis'>(1),
        updatedAt: brand<number, 'EpochMillis'>(1),
      });
      const runtime = createRuntime(gateway, async () => {}, {
        agentConstructors: [createRuntimePendingInputAgentConstructor(testCase.intent, () => {})],
      });

      const submitted = await runtime.submit({
        sessionId,
        identityContext: identity,
        inputText: `invalid attached input ${testCase.name}`,
        attachmentIds: [],
        locale: brand<string, 'RequestLocale'>('zh-CN'),
        idempotencyKey: brand<string, 'IdempotencyKey'>(`idem-invalid-attached-${testCase.name}`),
      });
      await waitForRunStatus(gateway, submitted.runId, 'FAILED');
      const active = await gateway.pendingInputs.loadActivePendingInput({
        tenantId: identity.tenantId,
        subjectId: identity.subjectId,
        agentId,
        sessionId,
      });
      const events = await gateway.timeline.listEvents({
        tenantId: identity.tenantId,
        subjectId: identity.subjectId,
        agentId,
        sessionId,
        afterSequence: brand<number, 'TimelineSequence'>(0),
        limit: 100,
      });

      expect(active).toBeUndefined();
      expect(events.map((event) => event.type)).not.toContain('USER_INPUT_REQUIRED');
      expect(events.find((event) => event.type === 'REQUEST_FAILED')?.inlinePayload['content']).toContain('Pending input option');
    }
  });

  it('rejects confirmation pending requests with custom, multi-select or non-binary shape', async () => {
    const confirmationQuestion = confirmationQuestions()[0]!;
    const invalidIntents = [
      { name: 'custom', intent: { kind: 'CONFIRMATION', questions: [{ ...confirmationQuestion, custom: true }] } },
      { name: 'multiple', intent: { kind: 'CONFIRMATION', questions: [{ ...confirmationQuestion, multiple: true }] } },
      {
        name: 'multi-question',
        intent: { kind: 'CONFIRMATION', questions: [confirmationQuestion, { ...confirmationQuestion, prompt: 'Confirm again?' }] },
      },
      {
        name: 'missing-reject',
        intent: { kind: 'CONFIRMATION', questions: [{ prompt: 'Confirm?', options: [{ label: 'Approve', value: 'approve' }] }] },
      },
    ] as const satisfies ReadonlyArray<{ readonly name: string; readonly intent: PendingInputIntent }>;

    for (const testCase of invalidIntents) {
      const gateway = createTestGatewayStores();
      const sessionId = brand<string, 'SessionId'>(`session-invalid-confirmation-${testCase.name}`);
      await gateway.sessions.saveSession({
        tenantId: identity.tenantId,
        subjectId: identity.subjectId,
        agentId,
        sessionId,
        createdAt: brand<number, 'EpochMillis'>(1),
        updatedAt: brand<number, 'EpochMillis'>(1),
      });
      const runtime = createRuntime(gateway, async () => {}, {
        agentConstructors: [createRuntimePendingInputAgentConstructor(testCase.intent, () => {})],
      });

      const submitted = await runtime.submit({
        sessionId,
        identityContext: identity,
        inputText: `invalid confirmation ${testCase.name}`,
        attachmentIds: [],
        locale: brand<string, 'RequestLocale'>('zh-CN'),
        idempotencyKey: brand<string, 'IdempotencyKey'>(`idem-invalid-confirmation-${testCase.name}`),
      });
      await waitForRunStatus(gateway, submitted.runId, 'FAILED');
      const active = await gateway.pendingInputs.loadActivePendingInput({
        tenantId: identity.tenantId,
        subjectId: identity.subjectId,
        agentId,
        sessionId,
      });
      const events = await gateway.timeline.listEvents({
        tenantId: identity.tenantId,
        subjectId: identity.subjectId,
        agentId,
        sessionId,
        afterSequence: brand<number, 'TimelineSequence'>(0),
        limit: 100,
      });

      expect(active).toBeUndefined();
      expect(events.map((event) => event.type)).not.toContain('USER_INPUT_REQUIRED');
      expect(events.find((event) => event.type === 'REQUEST_FAILED')?.inlinePayload['content']).toContain(
        'Pending input confirmation shape is invalid.',
      );
    }
  });

  it('rejects authorization pending requests with custom, multi-select or non-binary shape', async () => {
    const authorizationQuestion = authorizationQuestions()[0]!;
    const invalidIntents = [
      { name: 'custom', intent: { kind: 'AUTHORIZATION', questions: [{ ...authorizationQuestion, custom: true }] } },
      { name: 'multiple', intent: { kind: 'AUTHORIZATION', questions: [{ ...authorizationQuestion, multiple: true }] } },
      {
        name: 'multi-question',
        intent: { kind: 'AUTHORIZATION', questions: [authorizationQuestion, { ...authorizationQuestion, prompt: 'Authorize again?' }] },
      },
      {
        name: 'missing-deny',
        intent: { kind: 'AUTHORIZATION', questions: [{ prompt: 'Authorize?', options: [{ label: 'Approve', value: 'approve' }] }] },
      },
    ] as const satisfies ReadonlyArray<{ readonly name: string; readonly intent: PendingInputIntent }>;

    for (const testCase of invalidIntents) {
      const gateway = createTestGatewayStores();
      const sessionId = brand<string, 'SessionId'>(`session-invalid-authorization-${testCase.name}`);
      await gateway.sessions.saveSession({
        tenantId: identity.tenantId,
        subjectId: identity.subjectId,
        agentId,
        sessionId,
        createdAt: brand<number, 'EpochMillis'>(1),
        updatedAt: brand<number, 'EpochMillis'>(1),
      });
      const runtime = createRuntime(gateway, async () => {}, {
        agentConstructors: [createRuntimePendingInputAgentConstructor(testCase.intent, () => {})],
      });

      const submitted = await runtime.submit({
        sessionId,
        identityContext: identity,
        inputText: `invalid authorization ${testCase.name}`,
        attachmentIds: [],
        locale: brand<string, 'RequestLocale'>('zh-CN'),
        idempotencyKey: brand<string, 'IdempotencyKey'>(`idem-invalid-authorization-${testCase.name}`),
      });
      await waitForRunStatus(gateway, submitted.runId, 'FAILED');
      const active = await gateway.pendingInputs.loadActivePendingInput({
        tenantId: identity.tenantId,
        subjectId: identity.subjectId,
        agentId,
        sessionId,
      });
      const events = await gateway.timeline.listEvents({
        tenantId: identity.tenantId,
        subjectId: identity.subjectId,
        agentId,
        sessionId,
        afterSequence: brand<number, 'TimelineSequence'>(0),
        limit: 100,
      });

      expect(active).toBeUndefined();
      expect(events.map((event) => event.type)).not.toContain('USER_INPUT_REQUIRED');
      expect(events.find((event) => event.type === 'REQUEST_FAILED')?.inlinePayload['content']).toContain(
        'Pending input authorization shape is invalid.',
      );
    }
  });

  it('rejects human handoff pending requests with custom, multi-select or incomplete shape', async () => {
    const [modeQuestion, contentQuestion] = handoffQuestions();
    const invalidIntents = [
      { name: 'custom-mode', intent: { kind: 'HUMAN_HANDOFF', questions: [{ ...modeQuestion!, custom: true }, contentQuestion!] } },
      { name: 'multiple-mode', intent: { kind: 'HUMAN_HANDOFF', questions: [{ ...modeQuestion!, multiple: true }, contentQuestion!] } },
      {
        name: 'content-options',
        intent: { kind: 'HUMAN_HANDOFF', questions: [modeQuestion!, { ...contentQuestion!, options: [{ label: 'Note', value: 'note' }] }] },
      },
      {
        name: 'missing-resume',
        intent: { kind: 'HUMAN_HANDOFF', questions: [{ prompt: 'Mode?', options: [{ label: 'Final', value: 'final_answer' }] }, contentQuestion!] },
      },
      { name: 'single-question', intent: { kind: 'HUMAN_HANDOFF', questions: [modeQuestion!] } },
    ] as const satisfies ReadonlyArray<{ readonly name: string; readonly intent: PendingInputIntent }>;

    for (const testCase of invalidIntents) {
      const gateway = createTestGatewayStores();
      const sessionId = brand<string, 'SessionId'>(`session-invalid-handoff-${testCase.name}`);
      await gateway.sessions.saveSession({
        tenantId: identity.tenantId,
        subjectId: identity.subjectId,
        agentId,
        sessionId,
        createdAt: brand<number, 'EpochMillis'>(1),
        updatedAt: brand<number, 'EpochMillis'>(1),
      });
      const runtime = createRuntime(gateway, async () => {}, {
        agentConstructors: [createRuntimePendingInputAgentConstructor(testCase.intent, () => {})],
      });

      const submitted = await runtime.submit({
        sessionId,
        identityContext: identity,
        inputText: `invalid handoff ${testCase.name}`,
        attachmentIds: [],
        locale: brand<string, 'RequestLocale'>('zh-CN'),
        idempotencyKey: brand<string, 'IdempotencyKey'>(`idem-invalid-handoff-${testCase.name}`),
      });
      await waitForRunStatus(gateway, submitted.runId, 'FAILED');
      const active = await gateway.pendingInputs.loadActivePendingInput({
        tenantId: identity.tenantId,
        subjectId: identity.subjectId,
        agentId,
        sessionId,
      });
      const events = await gateway.timeline.listEvents({
        tenantId: identity.tenantId,
        subjectId: identity.subjectId,
        agentId,
        sessionId,
        afterSequence: brand<number, 'TimelineSequence'>(0),
        limit: 100,
      });

      expect(active).toBeUndefined();
      expect(events.map((event) => event.type)).not.toContain('USER_INPUT_REQUIRED');
      expect(events.find((event) => event.type === 'REQUEST_FAILED')?.inlinePayload['content']).toContain('Pending input handoff shape is invalid.');
    }
  });

  it('rejects late answers once timeoutAt has elapsed and releases the session lane', async () => {
    const gateway = createTestGatewayStores();
    const sessionId = brand<string, 'SessionId'>('session-timeout-late-answer');
    let now = 1_000_000;
    let executeCount = 0;
    await gateway.sessions.saveSession({
      tenantId: identity.tenantId,
      subjectId: identity.subjectId,
      agentId,
      sessionId,
      createdAt: brand<number, 'EpochMillis'>(1),
      updatedAt: brand<number, 'EpochMillis'>(1),
    });
    const runtime = createRuntime(gateway, async () => {}, {
      clock: () => brand<number, 'EpochMillis'>(now),
      agentConstructors: [
        createRuntimePendingInputAgentConstructor(
          {
            kind: 'QUESTION',
            questions: [{ prompt: 'Proceed?', options: [{ label: 'Yes', value: 'yes' }] }],
          },
          (count) => {
            executeCount = count;
          },
        ),
      ],
    });

    const submitted = await runtime.submit({
      sessionId,
      identityContext: identity,
      inputText: 'late answer should not resume',
      attachmentIds: [],
      locale: brand<string, 'RequestLocale'>('zh-CN'),
      idempotencyKey: brand<string, 'IdempotencyKey'>('idem-timeout-late-answer'),
    });
    await waitFor(
      async () =>
        (await gateway.pendingInputs.loadActivePendingInput({
          tenantId: identity.tenantId,
          subjectId: identity.subjectId,
          agentId,
          sessionId,
        })) !== undefined,
    );
    const pending = await gateway.pendingInputs.loadActivePendingInput({
      tenantId: identity.tenantId,
      subjectId: identity.subjectId,
      agentId,
      sessionId,
    });

    now = Number(pending!.request.timeoutAt) + 1;
    await expect(
      runtime.answerPendingInput({
        identityContext: identity,
        idempotencyKey: brand<string, 'IdempotencyKey'>('idem-timeout-late-answer-submit'),
        answer: {
          sessionId,
          pendingInputId: pending!.pendingInputId,
          answers: [['yes']],
        },
      }),
    ).rejects.toMatchObject({ code: 'PENDING_INPUT_TIMED_OUT' });
    await waitForRunStatus(gateway, submitted.runId, 'FAILED');

    const next = await runtime.submit({
      sessionId,
      identityContext: identity,
      inputText: 'new request after timeout',
      attachmentIds: [],
      locale: brand<string, 'RequestLocale'>('zh-CN'),
      idempotencyKey: brand<string, 'IdempotencyKey'>('idem-after-timeout-lane'),
    });
    await waitForRunStatus(gateway, next.runId, 'COMPLETED');
    const resolved = await gateway.pendingInputs.loadPendingInput({
      tenantId: identity.tenantId,
      subjectId: identity.subjectId,
      agentId,
      pendingInputId: pending!.pendingInputId,
    });
    const events = await gateway.timeline.listEvents({
      tenantId: identity.tenantId,
      subjectId: identity.subjectId,
      agentId,
      sessionId,
      afterSequence: brand<number, 'TimelineSequence'>(0),
      limit: 100,
    });

    expect(resolved?.status).toBe('TIMED_OUT');
    expect(executeCount).toBe(2);
    expect(events.map((event) => event.type)).toEqual(expect.arrayContaining(['USER_INPUT_TIMEOUT', 'REQUEST_FAILED', 'REQUEST_COMPLETED']));
    expect(events.map((event) => event.type)).not.toContain('USER_INPUT_RECEIVED');
  });

  it('times out due pending inputs through recovery without approving or synthesizing answers', async () => {
    const pendingKinds = ['CONFIRMATION', 'AUTHORIZATION', 'QUESTION', 'HUMAN_HANDOFF'] as const satisfies ReadonlyArray<PendingInputIntent['kind']>;

    for (const kind of pendingKinds) {
      const gateway = createTestGatewayStores();
      const sessionId = brand<string, 'SessionId'>(`session-timeout-${kind.toLowerCase()}`);
      let now = 1_000_000;
      let executeCount = 0;
      await gateway.sessions.saveSession({
        tenantId: identity.tenantId,
        subjectId: identity.subjectId,
        agentId,
        sessionId,
        createdAt: brand<number, 'EpochMillis'>(1),
        updatedAt: brand<number, 'EpochMillis'>(1),
      });
      const runtime = createRuntime(gateway, async () => {}, {
        clock: () => brand<number, 'EpochMillis'>(now),
        agentConstructors: [
          createRuntimePendingInputAgentConstructor(
            {
              kind,
              questions:
                kind === 'CONFIRMATION'
                  ? confirmationQuestions()
                  : kind === 'AUTHORIZATION'
                    ? authorizationQuestions()
                    : kind === 'HUMAN_HANDOFF'
                      ? handoffQuestions()
                      : [{ prompt: 'Proceed?', options: [{ label: 'Yes', value: 'yes' }] }],
            },
            (count) => {
              executeCount = count;
            },
            kind === 'QUESTION' ? 'AskUserQuestion' : 'ask-user-question',
          ),
        ],
      });

      const submitted = await runtime.submit({
        sessionId,
        identityContext: identity,
        inputText: 'pending input that will time out',
        attachmentIds: [],
        locale: brand<string, 'RequestLocale'>('zh-CN'),
        idempotencyKey: brand<string, 'IdempotencyKey'>(`idem-timeout-${kind}`),
      });
      await waitFor(
        async () =>
          (await gateway.pendingInputs.loadActivePendingInput({
            tenantId: identity.tenantId,
            subjectId: identity.subjectId,
            agentId,
            sessionId,
          })) !== undefined,
      );
      const pending = await gateway.pendingInputs.loadActivePendingInput({
        tenantId: identity.tenantId,
        subjectId: identity.subjectId,
        agentId,
        sessionId,
      });

      now = Number(pending!.request.timeoutAt) + 1;
      await runtime.recoverLocalRuntime({ limit: 10 });
      await waitForRunStatus(gateway, submitted.runId, 'FAILED');
      const resolved = await gateway.pendingInputs.loadPendingInput({
        tenantId: identity.tenantId,
        subjectId: identity.subjectId,
        agentId,
        pendingInputId: pending!.pendingInputId,
      });
      const events = await gateway.timeline.listEvents({
        tenantId: identity.tenantId,
        subjectId: identity.subjectId,
        agentId,
        sessionId,
        afterSequence: brand<number, 'TimelineSequence'>(0),
        limit: 100,
      });
      const messages = await gateway.messages.listCurrentRequestMessages({
        tenantId: identity.tenantId,
        subjectId: identity.subjectId,
        agentId,
        sessionId,
        requestId: submitted.requestId,
        runId: submitted.runId,
        includeHidden: true,
        offset: 0,
        limit: 20,
      });
      const timeoutEvent = events.find((event) => event.type === 'USER_INPUT_TIMEOUT');
      const failedEvent = events.find((event) => event.type === 'REQUEST_FAILED');

      expect(resolved?.status).toBe('TIMED_OUT');
      expect(executeCount).toBe(1);
      expect(timeoutEvent?.inlinePayload).toMatchObject({
        pendingInputId: pending!.pendingInputId,
        id: pending!.pendingInputId,
        kind,
        status: 'TIMED_OUT',
        safeSummary: 'Pending input timed out.',
      });
      expect(JSON.stringify(timeoutEvent?.inlinePayload)).not.toContain('yes');
      expect(failedEvent?.inlinePayload['content']).toBe('Request failed safely: PENDING_INPUT_TIMEOUT');
      expect(messages.items.some((message) => message.role === 'CAPABILITY_RESULT')).toBe(false);
      await expect(
        runtime.answerPendingInput({
          identityContext: identity,
          idempotencyKey: brand<string, 'IdempotencyKey'>(`idem-late-answer-${kind}`),
          answer: {
            sessionId,
            pendingInputId: pending!.pendingInputId,
            answers: [['yes']],
          },
        }),
      ).rejects.toMatchObject({ code: 'PENDING_INPUT_TIMED_OUT' });
    }
  });

  it('times out pending input after its deadline without external traffic', async () => {
    const gateway = createTestGatewayStores();
    const sessionId = brand<string, 'SessionId'>('session-timeout-background-worker');
    let now = 1_000_000;
    await gateway.sessions.saveSession({
      tenantId: identity.tenantId,
      subjectId: identity.subjectId,
      agentId,
      sessionId,
      createdAt: brand<number, 'EpochMillis'>(1),
      updatedAt: brand<number, 'EpochMillis'>(1),
    });
    const runtime = createRuntime(gateway, async () => {}, {
      clock: () => brand<number, 'EpochMillis'>(now),
      agentConstructors: [
        createRuntimePendingInputAgentConstructor(
          {
            kind: 'QUESTION',
            questions: [{ prompt: 'Proceed?', options: [{ label: 'Yes', value: 'yes' }] }],
            timeoutAt: brand<number, 'EpochMillis'>(now + 10_000),
          },
          () => {},
        ),
      ],
    });

    const submitted = await runtime.submit({
      sessionId,
      identityContext: identity,
      inputText: 'background timeout should not need another request',
      attachmentIds: [],
      locale: brand<string, 'RequestLocale'>('zh-CN'),
      idempotencyKey: brand<string, 'IdempotencyKey'>('idem-timeout-background-worker'),
    });
    await waitFor(
      async () =>
        (await gateway.pendingInputs.loadActivePendingInput({
          tenantId: identity.tenantId,
          subjectId: identity.subjectId,
          agentId,
          sessionId,
        })) !== undefined,
    );

    const listSpy = vi.spyOn(gateway.pendingInputs, 'listUnresolvedPendingInputTimeoutFacts');
    vi.useFakeTimers();
    runtime.startPendingInputTimeoutProcessing();
    await vi.advanceTimersByTimeAsync(0);
    expect(listSpy).toHaveBeenCalledTimes(1);

    now += 1_000;
    await vi.advanceTimersByTimeAsync(1_000);
    expect(listSpy).toHaveBeenCalledTimes(1);

    now += 9_001;
    await vi.advanceTimersByTimeAsync(9_001);

    const resolved = await gateway.pendingInputs.loadActivePendingInput({
      tenantId: identity.tenantId,
      subjectId: identity.subjectId,
      agentId,
      sessionId,
    });
    const run = await gateway.requestRuns.loadRun({
      tenantId: identity.tenantId,
      subjectId: identity.subjectId,
      agentId,
      runId: submitted.runId,
    });
    const events = await gateway.timeline.listEvents({
      tenantId: identity.tenantId,
      subjectId: identity.subjectId,
      agentId,
      sessionId,
      afterSequence: brand<number, 'TimelineSequence'>(0),
      limit: 100,
    });

    expect(resolved).toBeUndefined();
    expect(run).toMatchObject({ status: 'FAILED', terminalCommitState: 'COMMITTED' });
    expect(events.map((event) => event.type)).toEqual(expect.arrayContaining(['USER_INPUT_TIMEOUT', 'REQUEST_FAILED']));
  });

  it('keeps the earliest created deadline after timeout processing has already started', async () => {
    const gateway = createTestGatewayStores();
    const sessionIds = ['far', 'earliest', 'later'].map((suffix) => brand<string, 'SessionId'>(`session-timeout-created-${suffix}`));
    for (const sessionId of sessionIds) {
      await gateway.sessions.saveSession({
        tenantId: identity.tenantId,
        subjectId: identity.subjectId,
        agentId,
        sessionId,
        createdAt: brand<number, 'EpochMillis'>(1),
        updatedAt: brand<number, 'EpochMillis'>(1),
      });
    }
    let requestedTimeoutAt = brand<number, 'EpochMillis'>(Date.now() + 5_000);
    const intent = {
      kind: 'QUESTION',
      questions: [{ prompt: 'Proceed?', options: [] }],
      get timeoutAt() {
        return requestedTimeoutAt;
      },
    } satisfies PendingInputIntent;
    const pendingRunIds = new Set<string>();
    const runtime = createRuntime(gateway, async () => {}, {
      agentConstructors: [
        class DynamicDeadlinePendingInputAgent {
          static getType() {
            return brand<string, 'AgentType'>('default');
          }

          constructor(private readonly kit: AgentRuntimeKit<object>) {}

          async execute(run: RequestRun, context: RequestContext): Promise<AgentExecutionOutcome> {
            if (!pendingRunIds.has(run.runId)) {
              pendingRunIds.add(run.runId);
              const pendingInput = await this.kit.runState.requestPendingInput(
                run,
                {
                  ...context,
                  nextLifecycleStage: 'BEFORE_CAPABILITY_INVOKE',
                  toolCallStates: [
                    {
                      toolCallId: `ask-user-${run.runId}`,
                      capabilityId: brand<string, 'CapabilityId'>('ask-user-question'),
                      arguments: {},
                      status: 'PENDING',
                    },
                  ],
                },
                intent,
              );
              return { status: 'PENDING_INPUT', pendingInput };
            }
            return { status: 'COMPLETED' };
          }
        },
      ],
    });
    const listSpy = vi.spyOn(gateway.pendingInputs, 'listUnresolvedPendingInputTimeoutFacts');

    runtime.startPendingInputTimeoutProcessing();
    await waitFor(() => listSpy.mock.calls.length === 1);
    const submitPending = async (sessionId: (typeof sessionIds)[number], suffix: string) => {
      const submitted = await runtime.submit({
        sessionId,
        identityContext: identity,
        inputText: `created ${suffix} deadline`,
        attachmentIds: [],
        locale: brand<string, 'RequestLocale'>('zh-CN'),
        idempotencyKey: brand<string, 'IdempotencyKey'>(`idem-timeout-created-${suffix}`),
      });
      await waitFor(
        async () =>
          (await gateway.pendingInputs.loadActivePendingInput({
            tenantId: identity.tenantId,
            subjectId: identity.subjectId,
            agentId,
            sessionId,
          })) !== undefined,
      );
      return submitted;
    };

    const far = await submitPending(sessionIds[0]!, 'far');
    requestedTimeoutAt = brand<number, 'EpochMillis'>(Date.now() + 600);
    const earliest = await submitPending(sessionIds[1]!, 'earliest');
    requestedTimeoutAt = brand<number, 'EpochMillis'>(Date.now() + 3_000);
    const later = await submitPending(sessionIds[2]!, 'later');

    expect(listSpy).toHaveBeenCalledTimes(1);
    await waitFor(
      async () =>
        (
          await gateway.requestRuns.loadRun({
            tenantId: identity.tenantId,
            subjectId: identity.subjectId,
            agentId,
            runId: earliest.runId,
          })
        )?.terminalCommitState === 'COMMITTED',
    );
    expect(listSpy).toHaveBeenCalledTimes(2);
    await expect(
      gateway.requestRuns.loadRun({
        tenantId: identity.tenantId,
        subjectId: identity.subjectId,
        agentId,
        runId: far.runId,
      }),
    ).resolves.toMatchObject({ terminalCommitState: 'NOT_STARTED' });
    await expect(
      gateway.requestRuns.loadRun({
        tenantId: identity.tenantId,
        subjectId: identity.subjectId,
        agentId,
        runId: later.runId,
      }),
    ).resolves.toMatchObject({ terminalCommitState: 'NOT_STARTED' });
    await runtime.close({ timeoutMs: 0 });
  });

  it('skips the terminal lifecycle hook when a pending input times out', async () => {
    const gateway = createTestGatewayStores();
    const sessionId = brand<string, 'SessionId'>('session-timeout-skips-terminal-hook');
    let now = 1_500_000;
    let terminalHookCalls = 0;
    await gateway.sessions.saveSession({
      tenantId: identity.tenantId,
      subjectId: identity.subjectId,
      agentId,
      sessionId,
      createdAt: brand<number, 'EpochMillis'>(1),
      updatedAt: brand<number, 'EpochMillis'>(1),
    });
    const runtime = createRuntime(gateway, async () => {}, {
      clock: () => brand<number, 'EpochMillis'>(now),
      agentConstructors: [
        createRuntimePendingInputAgentConstructor(
          {
            kind: 'QUESTION',
            questions: [{ prompt: 'Proceed?', options: [] }],
            timeoutAt: brand<number, 'EpochMillis'>(now + 100),
          },
          () => {},
        ),
      ],
      lifecycleHookDefinitions: [
        {
          hookId: 'timeout-terminal-pend',
          kind: 'SYSTEM',
          supportedStages: ['BEFORE_AGENT_TERMINAL'],
          effects: ['CONTROL'],
          executionStrategy: 'SERIAL_IMPACT',
          failureMode: 'FAIL',
          order: 0,
        },
      ] satisfies readonly LifecycleHookDefinition[],
      lifecycleHook: {
        async invoke() {
          terminalHookCalls += 1;
          return {
            outcome: 'PEND',
            pendingInputIntent: {
              kind: 'CONFIRMATION',
              questions: confirmationQuestions('Request input again?'),
            },
          };
        },
      },
    });

    const submitted = await runtime.submit({
      sessionId,
      identityContext: identity,
      inputText: 'timeout should not re-enter terminal hooks',
      attachmentIds: [],
      locale: brand<string, 'RequestLocale'>('zh-CN'),
      idempotencyKey: brand<string, 'IdempotencyKey'>('idem-timeout-skips-terminal-hook'),
    });
    await waitFor(
      async () =>
        (await gateway.pendingInputs.loadActivePendingInput({
          tenantId: identity.tenantId,
          subjectId: identity.subjectId,
          agentId,
          sessionId,
        })) !== undefined,
    );

    vi.useFakeTimers();
    runtime.startPendingInputTimeoutProcessing();
    now += 101;
    await vi.advanceTimersByTimeAsync(0);

    expect(terminalHookCalls).toBe(0);
    expect(
      await gateway.pendingInputs.loadActivePendingInput({
        tenantId: identity.tenantId,
        subjectId: identity.subjectId,
        agentId,
        sessionId,
      }),
    ).toBeUndefined();
    expect(
      await gateway.requestRuns.loadRun({
        tenantId: identity.tenantId,
        subjectId: identity.subjectId,
        agentId,
        runId: submitted.runId,
      }),
    ).toMatchObject({ status: 'FAILED', terminalCommitState: 'COMMITTED' });
  });

  it('retries a durable TIMED_OUT fact when timeout event publication previously failed', async () => {
    const gateway = createTestGatewayStores();
    const sessionId = brand<string, 'SessionId'>('session-timeout-partial-event');
    let now = 2_000_000;
    await gateway.sessions.saveSession({
      tenantId: identity.tenantId,
      subjectId: identity.subjectId,
      agentId,
      sessionId,
      createdAt: brand<number, 'EpochMillis'>(1),
      updatedAt: brand<number, 'EpochMillis'>(1),
    });
    const runtime = createRuntime(gateway, async () => {}, {
      clock: () => brand<number, 'EpochMillis'>(now),
      agentConstructors: [
        createRuntimePendingInputAgentConstructor(
          {
            kind: 'QUESTION',
            questions: [{ prompt: 'Proceed?', options: [] }],
            timeoutAt: brand<number, 'EpochMillis'>(now + 100),
          },
          () => {},
        ),
      ],
    });
    const submitted = await runtime.submit({
      sessionId,
      identityContext: identity,
      inputText: 'retry partial timeout',
      attachmentIds: [],
      locale: brand<string, 'RequestLocale'>('zh-CN'),
      idempotencyKey: brand<string, 'IdempotencyKey'>('idem-timeout-partial-event'),
    });
    await waitFor(
      async () =>
        (await gateway.pendingInputs.loadActivePendingInput({
          tenantId: identity.tenantId,
          subjectId: identity.subjectId,
          agentId,
          sessionId,
        })) !== undefined,
    );
    const appendEvent = gateway.timeline.appendEvent.bind(gateway.timeline);
    let rejectTimeoutEvent = true;
    vi.spyOn(gateway.timeline, 'appendEvent').mockImplementation(async (record) => {
      if (rejectTimeoutEvent && record.type === 'USER_INPUT_TIMEOUT') {
        rejectTimeoutEvent = false;
        throw new Error('timeout event unavailable');
      }
      return appendEvent(record);
    });

    vi.useFakeTimers();
    runtime.startPendingInputTimeoutProcessing();
    now += 101;
    await vi.advanceTimersByTimeAsync(0);

    const partial = await gateway.pendingInputs.loadPendingInput({
      tenantId: identity.tenantId,
      subjectId: identity.subjectId,
      agentId,
      pendingInputId: (
        await gateway.pendingInputs.listUnresolvedPendingInputTimeoutFacts({
          agentId,
          limit: 1,
        })
      )[0]!.pendingInputId,
    });
    const partialRun = await gateway.requestRuns.loadRun({
      tenantId: identity.tenantId,
      subjectId: identity.subjectId,
      agentId,
      runId: submitted.runId,
    });
    expect(partial?.status).toBe('TIMED_OUT');
    expect(partialRun?.terminalCommitState).not.toBe('COMMITTED');

    await vi.advanceTimersByTimeAsync(1_000);
    const completedRun = await gateway.requestRuns.loadRun({
      tenantId: identity.tenantId,
      subjectId: identity.subjectId,
      agentId,
      runId: submitted.runId,
    });
    const events = await gateway.timeline.listEvents({
      tenantId: identity.tenantId,
      subjectId: identity.subjectId,
      agentId,
      sessionId,
      afterSequence: brand<number, 'TimelineSequence'>(0),
      limit: 100,
    });
    expect(completedRun).toMatchObject({ status: 'FAILED', terminalCommitState: 'COMMITTED' });
    expect(events.filter((event) => event.type === 'USER_INPUT_TIMEOUT')).toHaveLength(1);
  });

  it('retries a durable TIMED_OUT fact when terminal commit previously failed', async () => {
    const gateway = createTestGatewayStores();
    const sessionId = brand<string, 'SessionId'>('session-timeout-partial-terminal');
    let now = 2_500_000;
    await gateway.sessions.saveSession({
      tenantId: identity.tenantId,
      subjectId: identity.subjectId,
      agentId,
      sessionId,
      createdAt: brand<number, 'EpochMillis'>(1),
      updatedAt: brand<number, 'EpochMillis'>(1),
    });
    const runtime = createRuntime(gateway, async () => {}, {
      clock: () => brand<number, 'EpochMillis'>(now),
      agentConstructors: [
        createRuntimePendingInputAgentConstructor(
          {
            kind: 'QUESTION',
            questions: [{ prompt: 'Proceed?', options: [] }],
            timeoutAt: brand<number, 'EpochMillis'>(now + 100),
          },
          () => {},
        ),
      ],
    });
    const submitted = await runtime.submit({
      sessionId,
      identityContext: identity,
      inputText: 'retry timeout terminal commit',
      attachmentIds: [],
      locale: brand<string, 'RequestLocale'>('zh-CN'),
      idempotencyKey: brand<string, 'IdempotencyKey'>('idem-timeout-partial-terminal'),
    });
    await waitFor(
      async () =>
        (await gateway.pendingInputs.loadActivePendingInput({
          tenantId: identity.tenantId,
          subjectId: identity.subjectId,
          agentId,
          sessionId,
        })) !== undefined,
    );
    const commitTerminal = gateway.requestRuns.commitTerminal.bind(gateway.requestRuns);
    let rejectTerminalCommit = true;
    vi.spyOn(gateway.requestRuns, 'commitTerminal').mockImplementation(async (request) => {
      if (rejectTerminalCommit) {
        rejectTerminalCommit = false;
        throw new Error('terminal commit unavailable');
      }
      return commitTerminal(request);
    });

    vi.useFakeTimers();
    runtime.startPendingInputTimeoutProcessing();
    now += 101;
    await vi.advanceTimersByTimeAsync(0);
    expect(
      await gateway.requestRuns.loadRun({
        tenantId: identity.tenantId,
        subjectId: identity.subjectId,
        agentId,
        runId: submitted.runId,
      }),
    ).toMatchObject({ terminalCommitState: 'PENDING' });

    await vi.advanceTimersByTimeAsync(1_000);
    const completedRun = await gateway.requestRuns.loadRun({
      tenantId: identity.tenantId,
      subjectId: identity.subjectId,
      agentId,
      runId: submitted.runId,
    });
    const events = await gateway.timeline.listEvents({
      tenantId: identity.tenantId,
      subjectId: identity.subjectId,
      agentId,
      sessionId,
      afterSequence: brand<number, 'TimelineSequence'>(0),
      limit: 100,
    });
    expect(completedRun).toMatchObject({ status: 'FAILED', terminalCommitState: 'COMMITTED' });
    expect(events.filter((event) => event.type === 'USER_INPUT_TIMEOUT')).toHaveLength(1);
    expect(events.filter((event) => event.type === 'REQUEST_FAILED')).toHaveLength(1);
  });

  it('continues the same timeout pass after one candidate fails', async () => {
    const gateway = createTestGatewayStores();
    let now = 3_000_000;
    const runtimes = [] as Array<ReturnType<typeof createRuntime>>;
    const submittedByPendingId = new Map<string, RequestRun['runId']>();
    for (const suffix of ['a', 'b'] as const) {
      const sessionId = brand<string, 'SessionId'>(`session-timeout-isolation-${suffix}`);
      await gateway.sessions.saveSession({
        tenantId: identity.tenantId,
        subjectId: identity.subjectId,
        agentId,
        sessionId,
        createdAt: brand<number, 'EpochMillis'>(1),
        updatedAt: brand<number, 'EpochMillis'>(1),
      });
      const runtime = createRuntime(gateway, async () => {}, {
        clock: () => brand<number, 'EpochMillis'>(now),
        agentConstructors: [
          createRuntimePendingInputAgentConstructor(
            {
              kind: 'QUESTION',
              questions: [{ prompt: 'Proceed?', options: [] }],
              timeoutAt: brand<number, 'EpochMillis'>(now + 100),
            },
            () => {},
          ),
        ],
      });
      runtimes.push(runtime);
      const submitted = await runtime.submit({
        sessionId,
        identityContext: identity,
        inputText: `isolate timeout ${suffix}`,
        attachmentIds: [],
        locale: brand<string, 'RequestLocale'>('zh-CN'),
        idempotencyKey: brand<string, 'IdempotencyKey'>(`idem-timeout-isolation-${suffix}`),
      });
      await waitFor(
        async () =>
          (await gateway.pendingInputs.loadActivePendingInput({
            tenantId: identity.tenantId,
            subjectId: identity.subjectId,
            agentId,
            sessionId,
          })) !== undefined,
      );
      const pending = await gateway.pendingInputs.loadActivePendingInput({
        tenantId: identity.tenantId,
        subjectId: identity.subjectId,
        agentId,
        sessionId,
      });
      submittedByPendingId.set(pending!.pendingInputId, submitted.runId);
    }

    now += 101;
    const orderedCandidates = await gateway.pendingInputs.listUnresolvedPendingInputTimeoutFacts({
      agentId,
      limit: 10,
    });
    const failedPendingInputId = orderedCandidates[0]!.pendingInputId;
    const laterPendingInputId = orderedCandidates[1]!.pendingInputId;
    const resolvePendingInput = gateway.pendingInputs.resolvePendingInput.bind(gateway.pendingInputs);
    let rejectFirstCandidate = true;
    vi.spyOn(gateway.pendingInputs, 'resolvePendingInput').mockImplementation(async (request, options) => {
      if (rejectFirstCandidate && request.pendingInputId === failedPendingInputId) {
        rejectFirstCandidate = false;
        throw new Error('first candidate resolve unavailable');
      }
      return resolvePendingInput(request, options);
    });

    vi.useFakeTimers();
    runtimes[0]!.startPendingInputTimeoutProcessing();
    await vi.advanceTimersByTimeAsync(0);

    const failedRun = await gateway.requestRuns.loadRun({
      tenantId: identity.tenantId,
      subjectId: identity.subjectId,
      agentId,
      runId: submittedByPendingId.get(failedPendingInputId)!,
    });
    const laterRun = await gateway.requestRuns.loadRun({
      tenantId: identity.tenantId,
      subjectId: identity.subjectId,
      agentId,
      runId: submittedByPendingId.get(laterPendingInputId)!,
    });
    expect(failedRun?.terminalCommitState).not.toBe('COMMITTED');
    expect(laterRun).toMatchObject({ status: 'FAILED', terminalCommitState: 'COMMITTED' });

    await vi.advanceTimersByTimeAsync(1_000);
    expect(
      await gateway.requestRuns.loadRun({
        tenantId: identity.tenantId,
        subjectId: identity.subjectId,
        agentId,
        runId: submittedByPendingId.get(failedPendingInputId)!,
      }),
    ).toMatchObject({ status: 'FAILED', terminalCommitState: 'COMMITTED' });
  });

  it('shares one timeout scan between the worker and recovery trigger', async () => {
    const gateway = createTestGatewayStores();
    const runtime = createRuntime(gateway, async () => {});
    const originalList = gateway.pendingInputs.listUnresolvedPendingInputTimeoutFacts.bind(gateway.pendingInputs);
    let releaseQuery!: (records: Awaited<ReturnType<typeof originalList>>) => void;
    const blockedQuery = new Promise<Awaited<ReturnType<typeof originalList>>>((resolve) => {
      releaseQuery = resolve;
    });
    const listSpy = vi
      .spyOn(gateway.pendingInputs, 'listUnresolvedPendingInputTimeoutFacts')
      .mockImplementationOnce(async () => blockedQuery)
      .mockImplementation(originalList);

    vi.useFakeTimers();
    runtime.startPendingInputTimeoutProcessing();
    vi.advanceTimersByTime(0);
    await Promise.resolve();
    await Promise.resolve();
    expect(listSpy).toHaveBeenCalledTimes(1);

    const recovery = runtime.recoverLocalRuntime({ limit: 10 });
    await Promise.resolve();
    expect(listSpy).toHaveBeenCalledTimes(1);
    releaseQuery([]);
    await recovery;
    expect(listSpy).toHaveBeenCalledTimes(1);
    await runtime.close({ timeoutMs: 0 });
  });

  it('does not replace the recovery failure backoff with an immediate retry when processing starts', async () => {
    const gateway = createTestGatewayStores();
    const errors: object[] = [];
    loggerBinding = bindRuntimeLoggerProvider({
      getLogger: () => ({
        error(entry) {
          errors.push(entry);
        },
        warn() {},
        info() {},
        debug() {},
      }),
    });
    const runtime = createRuntime(gateway, async () => {});
    const originalList = gateway.pendingInputs.listUnresolvedPendingInputTimeoutFacts.bind(gateway.pendingInputs);
    const timeoutFailure = new Error('timeout fact query unavailable');
    const listSpy = vi
      .spyOn(gateway.pendingInputs, 'listUnresolvedPendingInputTimeoutFacts')
      .mockRejectedValueOnce(timeoutFailure)
      .mockImplementation(originalList);

    vi.useFakeTimers();
    await runtime.recoverLocalRuntime({ limit: 10 });
    expect(listSpy).toHaveBeenCalledTimes(1);

    runtime.startPendingInputTimeoutProcessing();
    await vi.advanceTimersByTimeAsync(0);
    expect(listSpy).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1_000);
    expect(listSpy).toHaveBeenCalledTimes(2);
    expect(errors).toContainEqual(
      expect.objectContaining({
        event: 'runtime.pending_input.timeout_scan_failed',
        err: timeoutFailure,
        failureStage: 'PENDING_INPUT_TIMEOUT_SCAN',
      }),
    );
    await runtime.close({ timeoutMs: 0 });
  });

  it('paginates more than 100 timeout candidates with a fixed cutoff and keyset cursor', async () => {
    const gateway = createTestGatewayStores();
    const sessionId = brand<string, 'SessionId'>('session-timeout-pagination');
    let now = 4_000_000;
    await gateway.sessions.saveSession({
      tenantId: identity.tenantId,
      subjectId: identity.subjectId,
      agentId,
      sessionId,
      createdAt: brand<number, 'EpochMillis'>(1),
      updatedAt: brand<number, 'EpochMillis'>(1),
    });
    const runtime = createRuntime(gateway, async () => {}, {
      clock: () => brand<number, 'EpochMillis'>(now),
      agentConstructors: [
        createRuntimePendingInputAgentConstructor(
          {
            kind: 'QUESTION',
            questions: [{ prompt: 'Proceed?', options: [] }],
            timeoutAt: brand<number, 'EpochMillis'>(now + 100),
          },
          () => {},
        ),
      ],
    });
    await runtime.submit({
      sessionId,
      identityContext: identity,
      inputText: 'page timeout candidates',
      attachmentIds: [],
      locale: brand<string, 'RequestLocale'>('zh-CN'),
      idempotencyKey: brand<string, 'IdempotencyKey'>('idem-timeout-pagination'),
    });
    await waitFor(
      async () =>
        (await gateway.pendingInputs.loadActivePendingInput({
          tenantId: identity.tenantId,
          subjectId: identity.subjectId,
          agentId,
          sessionId,
        })) !== undefined,
    );
    const pending = (await gateway.pendingInputs.loadActivePendingInput({
      tenantId: identity.tenantId,
      subjectId: identity.subjectId,
      agentId,
      sessionId,
    }))!;
    const candidates = Array.from({ length: 101 }, (_, index) => {
      const pendingInputId = brand<string, 'PendingInputId'>(`pending-timeout-page-${String(index).padStart(3, '0')}`);
      return {
        ...pending,
        pendingInputId,
        request: { ...pending.request, id: pendingInputId },
        status: 'TIMED_OUT' as const,
      };
    });
    const requests: Array<Parameters<typeof gateway.pendingInputs.listUnresolvedPendingInputTimeoutFacts>[0]> = [];
    vi.spyOn(gateway.pendingInputs, 'listUnresolvedPendingInputTimeoutFacts').mockImplementation(async (request) => {
      requests.push(request);
      const start =
        request.after === undefined ? 0 : candidates.findIndex((candidate) => candidate.pendingInputId === request.after!.pendingInputId) + 1;
      return candidates.slice(start, start + request.limit);
    });

    vi.useFakeTimers();
    runtime.startPendingInputTimeoutProcessing();
    now += 101;
    await vi.advanceTimersByTimeAsync(1_000);
    await vi.runOnlyPendingTimersAsync();

    expect(requests).toHaveLength(2);
    expect(requests.map((request) => request.limit)).toEqual([100, 100]);
    expect(requests[0]!.after).toBeUndefined();
    expect(requests[1]!.after).toEqual({
      timeoutAt: pending.request.timeoutAt,
      pendingInputId: candidates[99]!.pendingInputId,
    });
    expect(Object.hasOwn(requests[0]!, 'now')).toBe(false);
    expect(Object.hasOwn(requests[1]!, 'now')).toBe(false);
    await runtime.close({ timeoutMs: 0 });
  });

  it('stops an active timeout pass and does not schedule another query after close', async () => {
    const gateway = createTestGatewayStores();
    const runtime = createRuntime(gateway, async () => {});
    let releaseQuery!: () => void;
    const blockedQuery = new Promise<readonly never[]>((resolve) => {
      releaseQuery = () => resolve([]);
    });
    const listSpy = vi.spyOn(gateway.pendingInputs, 'listUnresolvedPendingInputTimeoutFacts').mockImplementationOnce(async () => blockedQuery);

    vi.useFakeTimers();
    runtime.startPendingInputTimeoutProcessing();
    vi.advanceTimersByTime(0);
    await Promise.resolve();
    await Promise.resolve();
    expect(listSpy).toHaveBeenCalledTimes(1);

    const closing = runtime.close({ timeoutMs: 100 });
    releaseQuery();
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(10);
    await closing;
    await vi.advanceTimersByTimeAsync(5_000);
    expect(listSpy).toHaveBeenCalledTimes(1);
  });

  it('resumes lifecycle hook terminal pending input without materializing a capability result', async () => {
    const gateway = createTestGatewayStores();
    const sessionId = brand<string, 'SessionId'>('session-hook-pending-input');
    let executeCount = 0;
    let hookPendCount = 0;
    await gateway.sessions.saveSession({
      tenantId: identity.tenantId,
      subjectId: identity.subjectId,
      agentId,
      sessionId,
      createdAt: brand<number, 'EpochMillis'>(1),
      updatedAt: brand<number, 'EpochMillis'>(1),
    });
    const runtime = createRuntime(
      gateway,
      async (_run, _context, timeline) => {
        executeCount += 1;
        await timeline.emit({ type: 'LLM_CONTENT_DELTA', inlinePayload: { final: true, content: 'hook resumed' } });
      },
      {
        lifecycleHookDefinitions: [
          {
            hookId: 'terminal-confirm',
            kind: 'SYSTEM',
            supportedStages: ['BEFORE_AGENT_TERMINAL'],
            effects: ['TRANSFORM', 'CONTROL'],
            executionStrategy: 'SERIAL_IMPACT',
            failureMode: 'FAIL',
            order: 0,
          },
        ] satisfies readonly LifecycleHookDefinition[],
        lifecycleHook: {
          async invoke(input) {
            if (input.stage === 'BEFORE_AGENT_TERMINAL' && hookPendCount === 0) {
              hookPendCount += 1;
              return {
                outcome: 'PEND',
                pendingInputIntent: {
                  kind: 'CONFIRMATION',
                  questions: confirmationQuestions('Approve guarded terminal output?'),
                },
              };
            }
            return { outcome: 'PASS' };
          },
        },
      },
    );

    const submitted = await runtime.submit({
      sessionId,
      identityContext: identity,
      inputText: 'hook pending',
      attachmentIds: [],
      locale: brand<string, 'RequestLocale'>('zh-CN'),
      idempotencyKey: brand<string, 'IdempotencyKey'>('idem-hook-pending-input'),
    });
    await waitFor(
      async () =>
        (await gateway.pendingInputs.loadActivePendingInput({
          tenantId: identity.tenantId,
          subjectId: identity.subjectId,
          agentId,
          sessionId,
        })) !== undefined,
    );
    const pending = await gateway.pendingInputs.loadActivePendingInput({
      tenantId: identity.tenantId,
      subjectId: identity.subjectId,
      agentId,
      sessionId,
    });

    expect(executeCount).toBe(1);
    expect(pending).toMatchObject({ producerRef: { kind: 'LIFECYCLE_HOOK' }, kind: 'CONFIRMATION', status: 'PENDING' });
    await runtime.answerPendingInput({
      identityContext: identity,
      idempotencyKey: brand<string, 'IdempotencyKey'>('idem-hook-pending-input-answer'),
      answer: {
        sessionId,
        pendingInputId: pending!.pendingInputId,
        answers: [['approve']],
      },
    });
    await waitForRunStatus(gateway, submitted.runId, 'COMPLETED');
    const messages = await gateway.messages.listCurrentRequestMessages({
      tenantId: identity.tenantId,
      subjectId: identity.subjectId,
      agentId,
      sessionId,
      requestId: submitted.requestId,
      runId: submitted.runId,
      includeHidden: true,
      offset: 0,
      limit: 20,
    });

    expect(executeCount).toBe(1);
    expect(messages.items.some((message) => message.role === 'CAPABILITY_RESULT')).toBe(false);
  });

  it('dispatches different session lanes concurrently', async () => {
    const gateway = createTestGatewayStores();
    const active = new Set<string>();
    let maxActive = 0;
    const releases = new Map<string, () => void>();
    const runtime = createRuntime(gateway, async (run, _context, timeline) => {
      active.add(run.runId);
      maxActive = Math.max(maxActive, active.size);
      await new Promise<void>((resolve) => releases.set(run.runId, resolve));
      active.delete(run.runId);
      await timeline.emit({ type: 'LLM_CONTENT_DELTA', inlinePayload: { content: `done ${run.runId}` } });
    });
    const sessionA = brand<string, 'SessionId'>('session-lane-a');
    const sessionB = brand<string, 'SessionId'>('session-lane-b');
    for (const sessionId of [sessionA, sessionB]) {
      await gateway.sessions.saveSession({
        tenantId: identity.tenantId,
        subjectId: identity.subjectId,
        agentId,
        sessionId,
        createdAt: brand<number, 'EpochMillis'>(1),
        updatedAt: brand<number, 'EpochMillis'>(1),
      });
    }

    const first = await runtime.submit({
      sessionId: sessionA,
      identityContext: identity,
      inputText: 'a',
      attachmentIds: [],
      locale: brand<string, 'RequestLocale'>('zh-CN'),
      idempotencyKey: brand<string, 'IdempotencyKey'>('idem-lane-a'),
    });
    const second = await runtime.submit({
      sessionId: sessionB,
      identityContext: identity,
      inputText: 'b',
      attachmentIds: [],
      locale: brand<string, 'RequestLocale'>('zh-CN'),
      idempotencyKey: brand<string, 'IdempotencyKey'>('idem-lane-b'),
    });

    await waitFor(() => maxActive === 2);
    releases.get(first.runId)?.();
    releases.get(second.runId)?.();
    await waitForRunStatus(gateway, first.runId, 'COMPLETED');
    await waitForRunStatus(gateway, second.runId, 'COMPLETED');
  });

  it('respects maxConcurrent while dispatching the highest priority queued lane next', async () => {
    const gateway = createTestGatewayStores();
    const started: string[] = [];
    const releases = new Map<string, () => void>();
    const runtime = createRuntime(
      gateway,
      async (run, _context, timeline) => {
        started.push(run.runId);
        await new Promise<void>((resolve) => releases.set(run.runId, resolve));
        await timeline.emit({ type: 'LLM_CONTENT_DELTA', inlinePayload: { content: run.runId } });
      },
      { scheduler: { maxConcurrent: 1 } },
    );
    const sessionA = brand<string, 'SessionId'>('session-priority-a');
    const sessionB = brand<string, 'SessionId'>('session-priority-b');
    const sessionC = brand<string, 'SessionId'>('session-priority-c');
    for (const sessionId of [sessionA, sessionB, sessionC]) {
      await gateway.sessions.saveSession({
        tenantId: identity.tenantId,
        subjectId: identity.subjectId,
        agentId,
        sessionId,
        createdAt: brand<number, 'EpochMillis'>(1),
        updatedAt: brand<number, 'EpochMillis'>(1),
      });
    }

    const first = await runtime.submit({
      sessionId: sessionA,
      identityContext: identity,
      inputText: 'first',
      attachmentIds: [],
      locale: brand<string, 'RequestLocale'>('zh-CN'),
      priority: 'NORMAL',
      idempotencyKey: brand<string, 'IdempotencyKey'>('idem-priority-first'),
    });
    await waitFor(() => started.length === 1);
    const low = await runtime.submit({
      sessionId: sessionB,
      identityContext: identity,
      inputText: 'low',
      attachmentIds: [],
      locale: brand<string, 'RequestLocale'>('zh-CN'),
      priority: 'LOW',
      idempotencyKey: brand<string, 'IdempotencyKey'>('idem-priority-low'),
    });
    const high = await runtime.submit({
      sessionId: sessionC,
      identityContext: identity,
      inputText: 'high',
      attachmentIds: [],
      locale: brand<string, 'RequestLocale'>('zh-CN'),
      priority: 'HIGH',
      idempotencyKey: brand<string, 'IdempotencyKey'>('idem-priority-high'),
    });
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(started).toEqual([first.runId]);
    releases.get(first.runId)?.();
    await waitFor(() => started.length === 2);
    expect(started[1]).toBe(high.runId);
    releases.get(high.runId)?.();
    await waitFor(() => started.length === 3);
    expect(started[2]).toBe(low.runId);
    releases.get(low.runId)?.();
    await waitForRunStatus(gateway, first.runId, 'COMPLETED');
    await waitForRunStatus(gateway, high.runId, 'COMPLETED');
    await waitForRunStatus(gateway, low.runId, 'COMPLETED');
  });

  it('keeps newer work queued while the same lane has a terminal pending run', async () => {
    const gateway = createTestGatewayStores();
    const sessionId = brand<string, 'SessionId'>('session-terminal-pending-block');
    let executeCount = 0;
    await gateway.sessions.saveSession({
      tenantId: identity.tenantId,
      subjectId: identity.subjectId,
      agentId,
      sessionId,
      createdAt: brand<number, 'EpochMillis'>(1),
      updatedAt: brand<number, 'EpochMillis'>(1),
    });
    await gateway.requestRuns.saveRun(
      runRecord({
        runId: brand<string, 'RequestRunId'>('run-terminal-pending-blocker'),
        sessionId,
        requestId: brand<string, 'MessageId'>('request-terminal-pending-blocker'),
        status: 'FAILED',
        terminalCommitState: 'PENDING',
        createdAt: brand<number, 'EpochMillis'>(1),
      }),
      {},
    );
    const runtime = createRuntime(gateway, async () => {
      executeCount += 1;
    });

    const accepted = await runtime.submit({
      sessionId,
      identityContext: identity,
      inputText: 'wait for terminal',
      attachmentIds: [],
      locale: brand<string, 'RequestLocale'>('zh-CN'),
      idempotencyKey: brand<string, 'IdempotencyKey'>('idem-terminal-pending-block'),
    });
    const snapshot = await gateway.requestRuns.loadSessionLaneSnapshot({
      tenantId: identity.tenantId,
      subjectId: identity.subjectId,
      agentId,
      sessionId,
    });

    expect(snapshot.terminalPendingRun?.runId).toBe('run-terminal-pending-blocker');
    expect(snapshot.queuedRuns.map((run) => run.runId)).toContain(accepted.runId);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(executeCount).toBe(0);
  });

  it('rejects submit safely when scheduler pending queue capacity is exhausted', async () => {
    const gateway = createTestGatewayStores();
    const sessionId = brand<string, 'SessionId'>('session-queue-capacity');
    await gateway.sessions.saveSession({
      tenantId: identity.tenantId,
      subjectId: identity.subjectId,
      agentId,
      sessionId,
      createdAt: brand<number, 'EpochMillis'>(1),
      updatedAt: brand<number, 'EpochMillis'>(1),
    });
    await gateway.requestRuns.saveRun(
      runRecord({
        runId: brand<string, 'RequestRunId'>('run-queue-capacity-blocker'),
        sessionId,
        requestId: brand<string, 'MessageId'>('request-queue-capacity-blocker'),
        status: 'FAILED',
        terminalCommitState: 'PENDING',
        createdAt: brand<number, 'EpochMillis'>(1),
      }),
      {},
    );
    const runtime = createRuntime(gateway, async () => {}, { scheduler: { maxPendingQueueDepth: 1 } });

    const accepted = await runtime.submit({
      sessionId,
      identityContext: identity,
      inputText: 'fills pending queue',
      attachmentIds: [],
      locale: brand<string, 'RequestLocale'>('zh-CN'),
      idempotencyKey: brand<string, 'IdempotencyKey'>('idem-queue-capacity-first'),
    });
    await expect(
      runtime.submit({
        sessionId,
        identityContext: identity,
        inputText: 'capacity exhausted',
        attachmentIds: [],
        locale: brand<string, 'RequestLocale'>('zh-CN'),
        idempotencyKey: brand<string, 'IdempotencyKey'>('idem-queue-capacity-second'),
      }),
    ).rejects.toMatchObject({ code: 'SCHEDULER_QUEUE_CAPACITY_EXHAUSTED', safeDetails: { reasonCode: 'SCHEDULER_QUEUE_CAPACITY_EXHAUSTED' } });

    const snapshot = await gateway.requestRuns.loadSessionLaneSnapshot({
      tenantId: identity.tenantId,
      subjectId: identity.subjectId,
      agentId,
      sessionId,
    });
    expect(snapshot.queuedRuns.map((run) => run.runId)).toEqual([accepted.runId]);
  });

  it('logs an orphan diagnostic when sessionless submit fails after internal session creation', async () => {
    const gateway = createTestGatewayStores();
    const warnings: object[] = [];
    loggerBinding = bindRuntimeLoggerProvider({
      getLogger: () => ({
        error() {},
        warn(fields) {
          warnings.push(fields);
        },
        info() {},
        debug() {},
      }),
    });
    const runtime = createRuntime(gateway, async () => {}, {
      scheduler: { maxPendingQueueDepth: 0 },
    });

    await expect(
      runtime.submit({
        agentId,
        parentRunId: brand<string, 'RequestRunId'>('parent-run-orphan-diagnostic'),
        parentRequestId: brand<string, 'MessageId'>('parent-request-orphan-diagnostic'),
        priority: 'LOW',
        identityContext: identity,
        inputText: 'capacity exhausted after internal session creation',
        attachmentIds: [],
        locale: brand<string, 'RequestLocale'>('zh-CN'),
        idempotencyKey: brand<string, 'IdempotencyKey'>('idem-orphan-session-capacity'),
      }),
    ).rejects.toMatchObject({ code: 'SCHEDULER_QUEUE_CAPACITY_EXHAUSTED' });

    expect(warnings).toContainEqual(
      expect.objectContaining({
        event: 'runtime.submit.orphan_session',
        agentId,
        parentRunId: 'parent-run-orphan-diagnostic',
        failureReason: 'SCHEDULER_QUEUE_CAPACITY_EXHAUSTED',
      }),
    );
    const orphan = warnings.find((entry) => (entry as { readonly event?: unknown }).event === 'runtime.submit.orphan_session');
    expect(orphan).not.toHaveProperty('err');
    expect(orphan).not.toHaveProperty('exceptionFingerprint');
  });

  it('rebuilds lost queued scheduler work from durable RequestRun facts during recovery', async () => {
    const gateway = createTestGatewayStores();
    const sessionId = brand<string, 'SessionId'>('session-queue-rebuild');
    const requestId = brand<string, 'MessageId'>('request-queue-rebuild');
    const runId = brand<string, 'RequestRunId'>('run-queue-rebuild');
    let executeCount = 0;
    await gateway.sessions.saveSession({
      tenantId: identity.tenantId,
      subjectId: identity.subjectId,
      agentId,
      sessionId,
      createdAt: brand<number, 'EpochMillis'>(1),
      updatedAt: brand<number, 'EpochMillis'>(1),
    });
    await gateway.requestRuns.saveRun(runRecord({ runId, sessionId, requestId }), {});
    await gateway.messages.appendSessionMessage(
      {
        tenantId: identity.tenantId,
        subjectId: identity.subjectId,
        agentId,
        messageId: requestId,
        sessionId,
        requestId,
        runId,
        role: 'USER',
        content: 'recover queued',
        contentType: 'PLAIN_TEXT',
        metadata: {},
        visible: true,
        createdAt: brand<number, 'EpochMillis'>(1),
      },
      { idempotencyKey: brand<string, 'IdempotencyKey'>('idem-queue-rebuild-user') },
    );
    const runtime = createRuntime(gateway, async (_run, _context, timeline) => {
      executeCount += 1;
      await timeline.emit({ type: 'LLM_CONTENT_DELTA', inlinePayload: { content: 'recovered' } });
    });

    await runtime.recoverLocalRuntime();
    await waitForRunStatus(gateway, runId, 'COMPLETED');

    expect(executeCount).toBe(1);
  });

  it('corrects duplicate and terminal pending queue items against durable RequestRun facts', async () => {
    const gateway = createTestGatewayStores();
    const sessionId = brand<string, 'SessionId'>('session-queue-correction');
    const blockerRunId = brand<string, 'RequestRunId'>('run-queue-correction-blocker');
    const blockerRequestId = brand<string, 'MessageId'>('request-queue-correction-blocker');
    let executeCount = 0;
    await gateway.sessions.saveSession({
      tenantId: identity.tenantId,
      subjectId: identity.subjectId,
      agentId,
      sessionId,
      createdAt: brand<number, 'EpochMillis'>(1),
      updatedAt: brand<number, 'EpochMillis'>(1),
    });
    await gateway.requestRuns.saveRun(
      runRecord({
        runId: blockerRunId,
        sessionId,
        requestId: blockerRequestId,
        status: 'FAILED',
        terminalCommitState: 'PENDING',
        createdAt: brand<number, 'EpochMillis'>(1),
      }),
      {},
    );
    const runtime = createRuntime(gateway, async (_run, _context, timeline) => {
      executeCount += 1;
      await timeline.emit({ type: 'LLM_CONTENT_DELTA', inlinePayload: { content: 'corrected' } });
    });
    (runtime as unknown as { recoveryDispatchGated: boolean }).recoveryDispatchGated = true;
    const accepted = await runtime.submit({
      sessionId,
      identityContext: identity,
      inputText: 'queued behind blocker',
      attachmentIds: [],
      locale: brand<string, 'RequestLocale'>('zh-CN'),
      idempotencyKey: brand<string, 'IdempotencyKey'>('idem-queue-correction'),
    });
    const internals = runtime as unknown as {
      readonly pendingLaneWork: Map<string, Array<{ readonly run: RequestRun; readonly laneKey: string } & Record<string, unknown>>>;
      recoveryDispatchGated: boolean;
      wakeScheduler: () => void;
    };
    await waitFor(() => internals.pendingLaneWork.size > 0);
    const laneKey = [...internals.pendingLaneWork.keys()][0];
    if (laneKey === undefined) {
      throw new Error('expected pending lane key for correction test');
    }
    const queue = internals.pendingLaneWork.get(laneKey);
    expect(queue).toBeDefined();
    const queuedWork = queue?.[0];
    if (queuedWork === undefined) {
      throw new Error('expected queued work for correction test');
    }
    queue?.push(queuedWork);
    queue?.push({
      ...queuedWork,
      run: {
        ...queuedWork.run,
        runId: blockerRunId,
        requestId: blockerRequestId,
        status: 'FAILED',
        terminalCommitState: 'COMMITTED',
      },
    });
    const blocker = await gateway.requestRuns.loadRun({ tenantId: identity.tenantId, subjectId: identity.subjectId, agentId, runId: blockerRunId });
    if (blocker === undefined) {
      throw new Error('expected blocker run');
    }
    await gateway.requestRuns.saveRun(
      {
        ...blocker,
        terminalCommitState: 'COMMITTED',
        version: blocker.version + 1,
        updatedAt: brand<number, 'EpochMillis'>(50),
      },
      { expectedVersion: blocker.version },
    );

    internals.recoveryDispatchGated = false;
    internals.wakeScheduler();
    await waitForRunStatus(gateway, accepted.runId, 'COMPLETED');

    expect(executeCount).toBe(1);
    expect(internals.pendingLaneWork.get(laneKey)).toBeUndefined();
  });

  it('supersedes older queued same-lane work without dispatching behind a terminal pending run', async () => {
    const gateway = createTestGatewayStores();
    const sessionId = brand<string, 'SessionId'>('session-queued-replacement');
    let executeCount = 0;
    await gateway.sessions.saveSession({
      tenantId: identity.tenantId,
      subjectId: identity.subjectId,
      agentId,
      sessionId,
      createdAt: brand<number, 'EpochMillis'>(1),
      updatedAt: brand<number, 'EpochMillis'>(1),
    });
    await gateway.requestRuns.saveRun(
      runRecord({
        runId: brand<string, 'RequestRunId'>('run-queued-replacement-blocker'),
        sessionId,
        requestId: brand<string, 'MessageId'>('request-queued-replacement-blocker'),
        status: 'FAILED',
        terminalCommitState: 'PENDING',
        createdAt: brand<number, 'EpochMillis'>(1),
      }),
      {},
    );
    const runtime = createRuntime(gateway, async () => {
      executeCount += 1;
    });

    const first = await runtime.submit({
      sessionId,
      identityContext: identity,
      inputText: 'first queued',
      attachmentIds: [],
      locale: brand<string, 'RequestLocale'>('zh-CN'),
      idempotencyKey: brand<string, 'IdempotencyKey'>('idem-queued-replace-1'),
    });
    const second = await runtime.submit({
      sessionId,
      identityContext: identity,
      inputText: 'second queued',
      attachmentIds: [],
      locale: brand<string, 'RequestLocale'>('zh-CN'),
      idempotencyKey: brand<string, 'IdempotencyKey'>('idem-queued-replace-2'),
    });
    const firstRun = await gateway.requestRuns.loadRun({
      tenantId: identity.tenantId,
      subjectId: identity.subjectId,
      agentId,
      runId: first.runId,
    });
    const secondRun = await gateway.requestRuns.loadRun({
      tenantId: identity.tenantId,
      subjectId: identity.subjectId,
      agentId,
      runId: second.runId,
    });

    expect(firstRun?.status).toBe('SUPERSEDED');
    expect(firstRun?.terminalCommitState).toBe('COMMITTED');
    expect(secondRun?.status).toBe('QUEUED');
    expect(executeCount).toBe(0);
  });

  it('emits scheduler dispatch component diagnostics and keeps blocked lanes undispatched', async () => {
    const gateway = createTestGatewayStores();
    const sessionId = brand<string, 'SessionId'>('session-lifecycle-observation');
    const blockerRunId = brand<string, 'RequestRunId'>('run-lifecycle-blocker');
    const blockerRequestId = brand<string, 'MessageId'>('request-lifecycle-blocker');
    const operations: string[] = [];
    await gateway.sessions.saveSession({
      tenantId: identity.tenantId,
      subjectId: identity.subjectId,
      agentId,
      sessionId,
      createdAt: brand<number, 'EpochMillis'>(1),
      updatedAt: brand<number, 'EpochMillis'>(1),
    });
    loggerBinding = bindRuntimeLoggerProvider({
      getLogger: () => ({
        debug(entry) {
          const event = (entry as { readonly event?: unknown }).event;
          if (typeof event === 'string') {
            operations.push(event);
          }
        },
        info(entry) {
          const event = (entry as { readonly event?: unknown }).event;
          if (typeof event === 'string') {
            operations.push(event);
          }
        },
        warn() {},
        error() {},
      }),
    });
    const runtime = createRuntime(gateway, async (_run, _context, timeline) => {
      await timeline.emit({ type: 'LLM_CONTENT_DELTA', inlinePayload: { final: true, content: 'scheduler dispatch completed' } });
    });

    const accepted = await runtime.submit({
      sessionId,
      identityContext: identity,
      inputText: 'first',
      attachmentIds: [],
      locale: brand<string, 'RequestLocale'>('zh-CN'),
      idempotencyKey: brand<string, 'IdempotencyKey'>('idem-lifecycle-normal'),
    });
    await waitForRunStatus(gateway, accepted.runId, 'COMPLETED');
    expect(operations).toContain('runtime.run.dispatched');

    operations.length = 0;
    await gateway.requestRuns.saveRun(
      runRecord({
        runId: blockerRunId,
        sessionId,
        requestId: blockerRequestId,
        status: 'FAILED',
        terminalCommitState: 'PENDING',
        createdAt: brand<number, 'EpochMillis'>(2),
      }),
      {},
    );
    await runtime.submit({
      sessionId,
      identityContext: identity,
      inputText: 'blocked',
      attachmentIds: [],
      locale: brand<string, 'RequestLocale'>('zh-CN'),
      idempotencyKey: brand<string, 'IdempotencyKey'>('idem-lifecycle-superseded'),
    });

    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(operations).not.toContain('runtime.run.dispatched');
  });

  it('supersedes an older executing same-lane run before dispatching the newer run', async () => {
    const gateway = createTestGatewayStores();
    const sessionId = brand<string, 'SessionId'>('session-latest-replacement');
    const started: string[] = [];
    const releases = new Map<string, () => void>();
    await gateway.sessions.saveSession({
      tenantId: identity.tenantId,
      subjectId: identity.subjectId,
      agentId,
      sessionId,
      createdAt: brand<number, 'EpochMillis'>(1),
      updatedAt: brand<number, 'EpochMillis'>(1),
    });
    const runtime = createRuntime(gateway, async (run, _context, timeline, _messages, signal) => {
      started.push(run.runId);
      await timeline.emit({ type: 'LLM_CONTENT_DELTA', inlinePayload: { content: `intermediate ${run.runId}` } });
      await new Promise<void>((resolve) => {
        releases.set(run.runId, resolve);
        signal.addEventListener('abort', () => resolve(), { once: true });
      });
      if (!signal.aborted) {
        await timeline.emit({ type: 'LLM_CONTENT_DELTA', inlinePayload: { content: `answer ${run.runId}` } });
      }
    });

    const first = await runtime.submit({
      sessionId,
      identityContext: identity,
      inputText: 'first',
      attachmentIds: [],
      locale: brand<string, 'RequestLocale'>('zh-CN'),
      idempotencyKey: brand<string, 'IdempotencyKey'>('idem-replace-1'),
    });
    await waitFor(() => started.includes(first.runId));
    const second = await runtime.submit({
      sessionId,
      identityContext: identity,
      inputText: 'second',
      attachmentIds: [],
      locale: brand<string, 'RequestLocale'>('zh-CN'),
      idempotencyKey: brand<string, 'IdempotencyKey'>('idem-replace-2'),
    });

    await waitFor(() => started.includes(second.runId));
    releases.get(second.runId)?.();
    await waitForRunStatus(gateway, first.runId, 'SUPERSEDED');
    await waitForRunStatus(gateway, second.runId, 'COMPLETED');
    expect(started).toEqual([first.runId, second.runId]);
    const events = await gateway.timeline.listEvents({
      tenantId: identity.tenantId,
      subjectId: identity.subjectId,
      agentId,
      sessionId,
      afterSequence: brand<number, 'TimelineSequence'>(0),
      limit: 1000,
    });
    const firstEventTypes = events.filter((event) => event.runId === first.runId).map((event) => event.type);
    expect(firstEventTypes).not.toContain('LLM_CONTENT_DELTA');
    expect(firstEventTypes).toContain('REQUEST_SUPERSEDED');
  });
});
