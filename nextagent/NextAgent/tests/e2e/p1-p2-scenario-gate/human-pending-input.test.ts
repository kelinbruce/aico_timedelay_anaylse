import { brand } from '@nextagent/agent-common';
import type { LifecycleHookDefinition, HookInput, HookResult, RiskPolicyEvaluator } from '@nextagent/agent-contracts/runtime';
import type { RuntimeLifecycleHookExecutor } from '@nextagent/agent-runtime';
import { afterEach, describe, expect, it } from 'vitest';
import {
  answerPendingInput,
  cleanupP1P2GateContext,
  createP1P2GateContext,
  readConversation,
  submitRequest,
  waitForActivePendingInput,
  waitForTerminalCommit,
  type P1P2GateContext,
} from './helpers.js';
import { recordCaseResult } from './case-inventory.js';

describe('p1-p2 scenario gate: human pending input', () => {
  const contexts: P1P2GateContext[] = [];

  afterEach(async () => {
    while (contexts.length > 0) {
      await cleanupP1P2GateContext(contexts.pop()!);
    }
  });

  it('covers question, confirmation, and authorization pending-input product paths', async () => {
    try {
      await verifyAskUserQuestionFlow(contexts);
      await verifyConfirmationHookFlow(contexts);
      await verifyAuthorizationFlow(contexts);
      await verifyNaturalTimeoutFlow(contexts);

      recordCaseResult('e2e-P1P2-04', 'PASSED', {
        evidenceRefs: [
          'evidence://p1-p2/human-pending-input/question',
          'evidence://p1-p2/human-pending-input/confirmation',
          'evidence://p1-p2/human-pending-input/authorization',
          'evidence://p1-p2/human-pending-input/natural-timeout',
        ],
      });
    } catch (error) {
      recordCaseResult('e2e-P1P2-04', 'FAILED', {
        safeReason: 'human pending input gate case failed',
        evidenceRefs: ['evidence://p1-p2/human-pending-input/failure'],
      });
      throw error;
    }
  }, 30_000);
});

async function verifyAskUserQuestionFlow(contexts: P1P2GateContext[]): Promise<void> {
  const ctx = await createP1P2GateContext({
    modelSteps: [
      {
        toolCalls: [
          {
            toolCallId: 'ask-region-1',
            toolName: 'AskUserQuestion',
            arguments: {
              questions: [
                {
                  prompt: 'Which region should I inspect?',
                  options: [
                    { value: 'north', label: 'North' },
                    { value: 'south', label: 'South' },
                  ],
                },
              ],
            },
          },
        ],
      },
      { content: 'region accepted' },
    ],
  });
  contexts.push(ctx);

  const accepted = await submitRequest(ctx, {
    inputText: 'Need your region choice before I continue.',
    idempotencyKey: `p1p2-question-${crypto.randomUUID()}`,
  });
  const pending = await waitForActivePendingInput(ctx, accepted.sessionId);
  expect(pending.kind).toBe('QUESTION');

  const answered = await answerPendingInput(ctx, accepted.sessionId, String(pending.pendingInputId), [['north']]);
  expect(answered).toMatchObject({ pendingInputId: pending.pendingInputId, status: 'RECEIVED' });

  await waitForTerminalCommit(ctx, accepted.runId);
  const conversation = await readConversation(ctx, accepted.sessionId);
  expect(conversation.items.at(-1)?.content).toBe('region accepted');
  expect(conversation.items.some((item) => item.role === 'CAPABILITY_RESULT' && item.metadata?.['toolName'] === 'AskUserQuestion')).toBe(true);
}

async function verifyConfirmationHookFlow(contexts: P1P2GateContext[]): Promise<void> {
  let terminalHookPendingIssued = false;
  const lifecycleHook: RuntimeLifecycleHookExecutor = {
    async invoke(input: HookInput): Promise<HookResult> {
      if (input.stage !== 'BEFORE_AGENT_TERMINAL') {
        return { outcome: 'PASS' };
      }
      if (terminalHookPendingIssued) {
        return { outcome: 'PASS' };
      }
      terminalHookPendingIssued = true;
      return {
        outcome: 'PEND',
        pendingInputIntent: {
          kind: 'CONFIRMATION',
          questions: [
            {
              prompt: 'Publish the terminal output?',
              options: [
                { label: 'Continue', value: 'approve' },
                { label: 'Cancel', value: 'reject' },
              ],
            },
          ],
        },
      };
    },
  };
  const lifecycleHookDefinitions: readonly LifecycleHookDefinition[] = [
    {
      hookId: 'terminal-confirm',
      kind: 'CUSTOM',
      supportedStages: ['BEFORE_AGENT_TERMINAL'],
      effects: ['TRANSFORM', 'CONTROL'],
      executionStrategy: 'SERIAL_IMPACT',
      failureMode: 'FAIL',
    },
  ];
  const hooks = [{ hookId: 'terminal-confirm', enabled: true }] as const;

  const ctx = await createP1P2GateContext({
    modelSteps: [{ content: 'terminal pending resume ok' }],
    lifecycleHook,
    lifecycleHookDefinitions,
    hooks,
  });
  contexts.push(ctx);

  const accepted = await submitRequest(ctx, {
    inputText: 'Run a terminal confirmation path.',
    idempotencyKey: `p1p2-confirmation-${crypto.randomUUID()}`,
  });
  const pending = await waitForActivePendingInput(ctx, accepted.sessionId);
  expect(pending.kind).toBe('CONFIRMATION');

  const answered = await answerPendingInput(ctx, accepted.sessionId, String(pending.pendingInputId), [['approve']]);
  expect(answered).toMatchObject({ pendingInputId: pending.pendingInputId, status: 'RECEIVED' });
  await waitForTerminalCommit(ctx, accepted.runId);

  const conversation = await readConversation(ctx, accepted.sessionId);
  expect(conversation.items.at(-1)?.content).toBe('terminal pending resume ok');
  const run = await ctx.app.gateway.requestRuns.loadRun({
    tenantId: brand<string, 'TenantId'>('tenant-p1p2-gate'),
    subjectId: brand<string, 'SubjectId'>('subject-p1p2-gate'),
    agentId: brand<string, 'AgentId'>('default-agent'),
    runId: brand<string, 'RequestRunId'>(accepted.runId),
  });
  expect(run?.status).toBe('COMPLETED');
}

async function verifyAuthorizationFlow(contexts: P1P2GateContext[]): Promise<void> {
  const riskPolicyEvaluator: RiskPolicyEvaluator = {
    async evaluate(input) {
      if (input.operation.currentRunAuthorizationMatched === true || input.operation.operationKind === 'SANDBOX_EXECUTION') {
        return { outcome: 'ALLOW', reasonCode: 'ALLOWED' };
      }
      return {
        outcome: 'REQUIRE_AUTHORIZATION',
        reasonCode: 'RISK_POLICY_AUTHORIZATION_REQUIRED',
        authorizationIntent: {
          operationId: input.operation.operationId,
          operationKind: input.operation.operationKind,
          riskLevel: input.operation.riskLevel,
          prompt: 'Approve the requested operation?',
          approveLabel: 'Approve',
          denyLabel: 'Deny',
          ...(input.operation.capabilityId === undefined ? {} : { capabilityId: input.operation.capabilityId }),
          ...(input.operation.toolCallId === undefined ? {} : { toolCallId: input.operation.toolCallId }),
        },
      };
    },
  };

  const executed: string[] = [];
  const ctx = await createP1P2GateContext({
    modelSteps: [
      {
        toolCalls: [
          {
            toolCallId: 'tool-python-1',
            toolName: 'Python',
            arguments: { code: "print('network-check')", timeout_ms: 30_000, args: [] },
          },
        ],
      },
      { content: 'authorized python complete' },
    ],
    riskPolicyEvaluator,
    sandboxGateway: {
      isExecutionReady: () => true,
      execute: async (request) => {
        executed.push(request.executionId);
        return {
          executionId: request.executionId,
          stdout: 'network-check\n',
          stderr: '',
          stdoutTruncated: false,
          stderrTruncated: false,
          timedOut: false,
          durationMs: 1,
        };
      },
    },
  });
  contexts.push(ctx);

  const accepted = await submitRequest(ctx, {
    inputText: 'Run a protected python action.',
    idempotencyKey: `p1p2-authorization-${crypto.randomUUID()}`,
  });
  const pending = await waitForActivePendingInput(ctx, accepted.sessionId);
  expect(pending.kind).toBe('AUTHORIZATION');

  await answerPendingInput(ctx, accepted.sessionId, String(pending.pendingInputId), [['approve']]);
  await waitForTerminalCommit(ctx, accepted.runId);

  expect(executed).toHaveLength(1);
  const conversation = await readConversation(ctx, accepted.sessionId);
  expect(conversation.items.at(-1)?.content).toBe('authorized python complete');

  const events = await ctx.app.gateway.timeline.listEvents({
    tenantId: brand<string, 'TenantId'>('tenant-p1p2-gate'),
    subjectId: brand<string, 'SubjectId'>('subject-p1p2-gate'),
    agentId: brand<string, 'AgentId'>('default-agent'),
    sessionId: brand<string, 'SessionId'>(accepted.sessionId),
    runId: brand<string, 'RequestRunId'>(accepted.runId),
    afterSequence: brand<number, 'TimelineSequence'>(0),
    limit: 100,
  });
  expect(events.find((event) => event.type === 'USER_INPUT_REQUIRED')?.inlinePayload['kind']).toBe('AUTHORIZATION');
}

async function verifyNaturalTimeoutFlow(contexts: P1P2GateContext[]): Promise<void> {
  let pendingIssued = false;
  const lifecycleHook: RuntimeLifecycleHookExecutor = {
    async invoke(input: HookInput): Promise<HookResult> {
      if (input.stage !== 'BEFORE_AGENT_TERMINAL' || pendingIssued) {
        return { outcome: 'PASS' };
      }
      pendingIssued = true;
      return {
        outcome: 'PEND',
        pendingInputIntent: {
          kind: 'CONFIRMATION',
          questions: [
            {
              prompt: 'Allow this response to time out?',
              options: [
                { label: 'Continue', value: 'approve' },
                { label: 'Cancel', value: 'reject' },
              ],
            },
          ],
          timeoutAt: brand<number, 'EpochMillis'>(Date.now() + 100),
        },
      };
    },
  };
  const lifecycleHookDefinitions: readonly LifecycleHookDefinition[] = [
    {
      hookId: 'terminal-timeout',
      kind: 'CUSTOM',
      supportedStages: ['BEFORE_AGENT_TERMINAL'],
      effects: ['TRANSFORM', 'CONTROL'],
      executionStrategy: 'SERIAL_IMPACT',
      failureMode: 'FAIL',
    },
  ];
  const ctx = await createP1P2GateContext({
    modelSteps: [{ content: 'this response should not be committed' }],
    lifecycleHook,
    lifecycleHookDefinitions,
    hooks: [{ hookId: 'terminal-timeout', enabled: true }],
  });
  contexts.push(ctx);

  const accepted = await submitRequest(ctx, {
    inputText: 'Create pending input and then stop sending traffic.',
    idempotencyKey: `p1p2-natural-timeout-${crypto.randomUUID()}`,
  });
  const pending = await waitForActivePendingInput(ctx, accepted.sessionId);
  await waitForTerminalCommit(ctx, accepted.runId);

  const resolved = await ctx.app.gateway.pendingInputs.loadPendingInput({
    tenantId: brand<string, 'TenantId'>('tenant-p1p2-gate'),
    subjectId: brand<string, 'SubjectId'>('subject-p1p2-gate'),
    agentId: brand<string, 'AgentId'>('default-agent'),
    pendingInputId: pending.pendingInputId,
  });
  const run = await ctx.app.gateway.requestRuns.loadRun({
    tenantId: brand<string, 'TenantId'>('tenant-p1p2-gate'),
    subjectId: brand<string, 'SubjectId'>('subject-p1p2-gate'),
    agentId: brand<string, 'AgentId'>('default-agent'),
    runId: brand<string, 'RequestRunId'>(accepted.runId),
  });
  const events = await ctx.app.gateway.timeline.listEvents({
    tenantId: brand<string, 'TenantId'>('tenant-p1p2-gate'),
    subjectId: brand<string, 'SubjectId'>('subject-p1p2-gate'),
    agentId: brand<string, 'AgentId'>('default-agent'),
    sessionId: brand<string, 'SessionId'>(accepted.sessionId),
    runId: brand<string, 'RequestRunId'>(accepted.runId),
    afterSequence: brand<number, 'TimelineSequence'>(0),
    limit: 100,
  });
  expect(resolved?.status).toBe('TIMED_OUT');
  expect(run).toMatchObject({ status: 'FAILED', terminalCommitState: 'COMMITTED' });
  expect(events.map((event) => event.type)).toEqual(expect.arrayContaining(['USER_INPUT_TIMEOUT', 'REQUEST_FAILED']));
  expect(events.find((event) => event.type === 'REQUEST_FAILED')?.inlinePayload['code']).toBe('PENDING_INPUT_TIMEOUT');

  const lateAnswer = await fetch(`${ctx.baseUrl}/api/v1/sessions/${accepted.sessionId}/pending-inputs/${pending.pendingInputId}/answer`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ answers: [['approve']] }),
  });
  expect(lateAnswer.status).toBeGreaterThanOrEqual(400);
  expect(
    (
      await ctx.app.gateway.pendingInputs.loadPendingInput({
        tenantId: brand<string, 'TenantId'>('tenant-p1p2-gate'),
        subjectId: brand<string, 'SubjectId'>('subject-p1p2-gate'),
        agentId: brand<string, 'AgentId'>('default-agent'),
        pendingInputId: pending.pendingInputId,
      })
    )?.status,
  ).toBe('TIMED_OUT');
}
