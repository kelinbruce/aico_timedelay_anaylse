import { modelEventStreamFixture } from '../helpers/model-stream-fixture.js';
import {
  createAppCredentialResolver,
  createComposedApp,
  createTestSystemConfig,
  loadBuiltInDefaultAgentDefinition,
  readCapturedAuditRecords,
} from '@nextagent/agent-platform-gateway-local/testing';
import { brand } from '@nextagent/agent-common';
import type { ModelInvocationRequest, ModelInvocationService } from '@nextagent/agent-contracts/model';
import type { RiskPolicyEvaluator } from '@nextagent/agent-contracts/runtime';
import type { RestrictedLocalSandboxGatewayPort } from '@nextagent/agent-platform-gateway-local';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

const agentId = brand<string, 'AgentId'>('default-agent');
const identity = {
  tenantId: brand<string, 'TenantId'>('tenant-1'),
  subjectId: brand<string, 'SubjectId'>('subject-1'),
  displayName: 'Sandbox risk tester',
};

describe('risk policy sandbox enforcement', () => {
  it('fails closed before gateway execution when sandbox execution is not ready', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'nextagent-risk-policy-sandbox-'));
    try {
      const captured: ModelInvocationRequest[] = [];
      const execute = vi.fn<RestrictedLocalSandboxGatewayPort['execute']>(async (request) => ({
        executionId: request.executionId,
        stdout: 'should not run',
        stderr: '',
        stdoutTruncated: false,
        stderrTruncated: false,
        timedOut: false,
        durationMs: 1,
      }));
      const app = createComposedApp(
        {
          systemConfig: createTestSystemConfig(tempDir),
          agentDefinition: { ...loadBuiltInDefaultAgentDefinition(), workspaceDir: '.' },
          credentialResolver: createAppCredentialResolver({ NEXTAGENT_TEST_ONLY: 'test-only' }),
          identity,
          sandboxGateway: {
            execute,
            isExecutionReady: () => false,
          },
        },
        scriptedPythonModel(captured),
      );
      try {
        const accepted = await app.server.inject({
          method: 'POST',
          url: '/api/v1/requests',
          payload: { inputText: 'check alarms', idempotencyKey: 'idem-risk-policy-sandbox-disabled' },
        });
        expect(accepted.statusCode).toBe(200);
        const body = accepted.json<{ sessionId: string; requestId: string; runId: string }>();
        await waitForRunTerminal(app.gateway, body.runId);

        expect(execute).not.toHaveBeenCalled();

        const events = await app.gateway.timeline.listEvents({
          tenantId: identity.tenantId,
          subjectId: identity.subjectId,
          agentId,
          sessionId: brand<string, 'SessionId'>(body.sessionId),
          runId: brand<string, 'RequestRunId'>(body.runId),
          afterSequence: brand<number, 'TimelineSequence'>(0),
          limit: 100,
        });
        // Sandbox-not-ready is now enforced at the sandbox execution boundary (SANDBOX_EXECUTION),
        // not the tool-loop capability invocation boundary (CAPABILITY_INVOCATION).
        expect(
          events.find((event) => event.type === 'POLICY_APPLIED' && event.inlinePayload['operationKind'] === 'SANDBOX_EXECUTION')?.inlinePayload,
        ).toMatchObject({
          operationKind: 'SANDBOX_EXECUTION',
          outcome: 'DEGRADED',
          reasonCode: 'SANDBOX_UNAVAILABLE',
        });
        expect(events.map((event) => event.type)).not.toContain('USER_INPUT_REQUIRED');

        const messages = await app.gateway.messages.listCurrentRequestMessages({
          tenantId: identity.tenantId,
          subjectId: identity.subjectId,
          agentId,
          sessionId: brand<string, 'SessionId'>(body.sessionId),
          requestId: brand<string, 'MessageId'>(body.requestId),
          runId: brand<string, 'RequestRunId'>(body.runId),
          includeHidden: true,
          offset: 0,
          limit: 20,
        });
        const result = messages.items.find((message) => message.role === 'CAPABILITY_RESULT');
        // The sandbox-not-ready rejection now surfaces as a failed capability result (exit_code 126)
        // rather than suppressing the result message entirely.
        expect(result).toMatchObject({
          role: 'CAPABILITY_RESULT',
          content: expect.stringContaining('SANDBOX_UNAVAILABLE'),
        });
        expect(messages.items.map((message) => message.content).join('\n')).not.toContain('should not run');
        const audit = readCapturedAuditRecords(app);
        expect(audit).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              eventName: 'policy.failed',
              attributes: expect.objectContaining({
                operation: 'POLICY_FAILED',
                safeReasonCode: 'SANDBOX_UNAVAILABLE',
              }),
            }),
          ]),
        );
      } finally {
        await app.close();
      }
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it('returns POLICY_FAILED and does not execute the gateway when sandbox policy evaluation throws', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'nextagent-risk-policy-sandbox-failed-'));
    try {
      const execute = vi.fn<RestrictedLocalSandboxGatewayPort['execute']>(async (request) => ({
        executionId: request.executionId,
        stdout: 'should not run',
        stderr: '',
        stdoutTruncated: false,
        stderrTruncated: false,
        timedOut: false,
        durationMs: 1,
      }));
      const riskPolicyEvaluator: RiskPolicyEvaluator = {
        async evaluate(input) {
          if (input.operation.operationKind === 'SANDBOX_EXECUTION') {
            throw new Error('sandbox policy down');
          }
          if (input.operation.currentRunAuthorizationMatched === true) {
            return { outcome: 'ALLOW', reasonCode: 'ALLOWED' };
          }
          return {
            outcome: 'REQUIRE_AUTHORIZATION',
            reasonCode: 'RISK_POLICY_AUTHORIZATION_REQUIRED',
            authorizationIntent: {
              operationId: input.operation.operationId,
              operationKind: input.operation.operationKind,
              ...(input.operation.capabilityId === undefined ? {} : { capabilityId: input.operation.capabilityId }),
              ...(input.operation.toolCallId === undefined ? {} : { toolCallId: input.operation.toolCallId }),
              riskLevel: input.operation.riskLevel,
              prompt: 'Approve the requested operation?',
              approveLabel: 'Approve',
              denyLabel: 'Deny',
            },
          };
        },
      };
      const app = createComposedApp(
        {
          systemConfig: createTestSystemConfig(tempDir),
          agentDefinition: { ...loadBuiltInDefaultAgentDefinition(), workspaceDir: '.' },
          credentialResolver: createAppCredentialResolver({ NEXTAGENT_TEST_ONLY: 'test-only' }),
          identity,
          riskPolicyEvaluator,
          sandboxGateway: {
            execute,
            isExecutionReady: () => true,
          },
        },
        scriptedPythonModel([]),
      );
      try {
        const accepted = await app.server.inject({
          method: 'POST',
          url: '/api/v1/requests',
          payload: { inputText: 'check alarms', idempotencyKey: 'idem-risk-policy-sandbox-failed' },
        });
        expect(accepted.statusCode).toBe(200);
        const body = accepted.json<{ sessionId: string; requestId: string; runId: string }>();
        const pendingInputId = await waitForPendingInput(app, body.sessionId, body.runId);
        await app.runtime.answerPendingInput({
          identityContext: identity,
          idempotencyKey: brand<string, 'IdempotencyKey'>('idem-risk-policy-sandbox-failed-approve'),
          answer: {
            sessionId: brand<string, 'SessionId'>(body.sessionId),
            pendingInputId,
            answers: [['approve']],
          },
        });
        await waitForRunTerminal(app.gateway, body.runId);

        expect(execute).not.toHaveBeenCalled();

        const events = await app.gateway.timeline.listEvents({
          tenantId: identity.tenantId,
          subjectId: identity.subjectId,
          agentId,
          sessionId: brand<string, 'SessionId'>(body.sessionId),
          runId: brand<string, 'RequestRunId'>(body.runId),
          afterSequence: brand<number, 'TimelineSequence'>(0),
          limit: 100,
        });
        expect(
          events.find((event) => event.type === 'POLICY_APPLIED' && event.inlinePayload['operationKind'] === 'SANDBOX_EXECUTION')?.inlinePayload,
        ).toMatchObject({
          operationKind: 'SANDBOX_EXECUTION',
          outcome: 'POLICY_FAILED',
          reasonCode: 'RISK_POLICY_EVALUATION_FAILED',
        });

        const messages = await app.gateway.messages.listCurrentRequestMessages({
          tenantId: identity.tenantId,
          subjectId: identity.subjectId,
          agentId,
          sessionId: brand<string, 'SessionId'>(body.sessionId),
          requestId: brand<string, 'MessageId'>(body.requestId),
          runId: brand<string, 'RequestRunId'>(body.runId),
          includeHidden: true,
          offset: 0,
          limit: 20,
        });
        const result = messages.items.find((message) => message.role === 'CAPABILITY_RESULT');
        expect(result?.content).toContain('RISK_POLICY_EVALUATION_FAILED');
        expect(result?.content).not.toContain('should not run');
        const audit = readCapturedAuditRecords(app);
        expect(audit).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              eventName: 'policy.failed',
              attributes: expect.objectContaining({
                operation: 'POLICY_FAILED',
                safeReasonCode: 'RISK_POLICY_EVALUATION_FAILED',
              }),
            }),
          ]),
        );
      } finally {
        await app.close();
      }
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});

async function waitFor(assertion: () => boolean | Promise<boolean>, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await assertion()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  expect(await assertion()).toBe(true);
}

async function waitForRunTerminal(gateway: ReturnType<typeof createComposedApp>['gateway'], runId: string, timeoutMs = 10_000): Promise<void> {
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

async function waitForPendingInput(app: ReturnType<typeof createComposedApp>, sessionId: string, runId: string, timeoutMs = 10_000) {
  let pendingInputId: string | undefined;
  await waitFor(async () => {
    const events = await app.gateway.timeline.listEvents({
      tenantId: identity.tenantId,
      subjectId: identity.subjectId,
      agentId,
      sessionId: brand<string, 'SessionId'>(sessionId),
      runId: brand<string, 'RequestRunId'>(runId),
      afterSequence: brand<number, 'TimelineSequence'>(0),
      limit: 100,
    });
    const event = events.find((record) => record.type === 'USER_INPUT_REQUIRED');
    const candidate = event?.inlinePayload['pendingInputId'];
    pendingInputId = typeof candidate === 'string' ? candidate : undefined;
    return pendingInputId !== undefined;
  }, timeoutMs);
  return brand<string, 'PendingInputId'>(pendingInputId!);
}

function scriptedPythonModel(captured: ModelInvocationRequest[]): ModelInvocationService {
  return {
    async complete() {
      return { content: 'alarm diagnosis complete' };
    },
    stream: modelEventStreamFixture(async function* (request) {
      captured.push(request);
      if (captured.length === 1) {
        yield {
          content: '',
          finishReason: 'tool-calls',
          toolCalls: [
            {
              toolCallId: 'tool-python-1',
              toolName: 'Python',
              arguments: { code: "print('hi')", timeout_ms: 30_000, args: [] },
            },
          ],
        };
        return;
      }
      yield { content: 'alarm diagnosis complete', finishReason: 'stop' };
    }),
  };
}
