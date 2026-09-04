import { executeToolCallsInOrder } from '@nextagent/agent-core';
import { AgentError, brand } from '@nextagent/agent-common';
import type { AgentAssembly } from '@nextagent/agent-contracts/agent-assembly';
import type { CapabilityCatalog, CapabilityInvocationPort } from '@nextagent/agent-contracts/capability';
import type { AgentRunStatePort, RequestContext, RequestRun } from '@nextagent/agent-contracts/runtime';
import { describe, expect, it, vi } from 'vitest';

describe('tool loop risk policy enforcement', () => {
  it('propagates REQUIRE_AUTHORIZATION to the runtime pending-input owner without synthesizing a failure result', async () => {
    const appended: Array<{ role: string; content: string }> = [];
    const invoke = vi.fn<CapabilityInvocationPort['invoke']>();

    await expect(
      executeToolCallsInOrder(
        {
          capabilityCatalog: catalog(),
          capabilityInvocation: { invoke },
          riskPolicyEvaluator: {
            async evaluate() {
              return {
                outcome: 'REQUIRE_AUTHORIZATION',
                reasonCode: 'CUSTOM_AUTHORIZATION_REQUIRED',
                authorizationIntent: {
                  operationId: 'read:tool-risk-auth',
                  operationKind: 'CAPABILITY_INVOCATION',
                  riskLevel: 'HIGH',
                  prompt: 'Approve the requested operation?',
                  approveLabel: 'Approve',
                  denyLabel: 'Deny',
                },
              };
            },
          },
          assemblyRegistry: {
            async active() {
              return assembly();
            },
            async require() {
              return assembly();
            },
          },
        },
        {
          run: run(),
          context: context(),
          runState: {
            async setCapabilityTerminalAnswer(): Promise<void> {},
            async emitEvent() {},
            async appendMessage(_run, _context, draft) {
              appended.push({ role: draft.role, content: String(draft.content) });
              return brand<string, 'MessageId'>('message-1');
            },
            async saveCheckpoint() {},
            async requestPendingInput() {
              throw new Error('requestPendingInput should not be called by risk policy tests.');
            },
          },
          signal: new AbortController().signal,
          round: 0,
          toolCalls: [{ toolCallId: 'tool-risk-auth', toolName: 'read', arguments: {} }],
          requestLocalState: { generatedMessages: [] },
        },
      ),
    ).rejects.toMatchObject({ code: 'CUSTOM_AUTHORIZATION_REQUIRED', category: 'AUTHORIZATION' });

    expect(invoke).not.toHaveBeenCalled();
    expect(appended.filter((item) => item.role === 'CAPABILITY_RESULT')).toHaveLength(0);
  });

  it('feeds a risk policy DENY to the model as a synthetic failure result without invoking the capability', async () => {
    const events: unknown[] = [];
    const appended: Array<{ role: string; content: string }> = [];
    const invoke = vi.fn<CapabilityInvocationPort['invoke']>(async () => ({
      status: 'SUCCEEDED' as const,
      structuredPayload: { ok: true },
      generatedMessages: [],
      artifactRefs: [],
    }));

    await executeToolCallsInOrder(
      {
        capabilityCatalog: catalog(),
        capabilityInvocation: { invoke },
        riskPolicyEvaluator: {
          async evaluate() {
            return { outcome: 'DENY', reasonCode: 'OWNER_SCOPE_MISMATCH' };
          },
        },
        assemblyRegistry: {
          async active() {
            return assembly();
          },
          async require() {
            return assembly();
          },
        },
      },
      {
        run: run(),
        context: context(),
        runState: {
          async setCapabilityTerminalAnswer(): Promise<void> {},
          async emitEvent(_run, _context, event) {
            events.push(event);
          },
          async appendMessage(_run, _context, draft) {
            appended.push({ role: draft.role, content: String(draft.content) });
            return brand<string, 'MessageId'>('message-1');
          },
          async saveCheckpoint() {},
          async requestPendingInput() {
            throw new Error('requestPendingInput should not be called by risk policy tests.');
          },
        },
        signal: new AbortController().signal,
        round: 0,
        toolCalls: [{ toolCallId: 'tool-risk-1', toolName: 'read', arguments: {} }],
        requestLocalState: { generatedMessages: [] },
      },
    );

    expect(invoke).not.toHaveBeenCalled();
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'POLICY_APPLIED',
          inlinePayload: expect.objectContaining({
            operationKind: 'CAPABILITY_INVOCATION',
            outcome: 'DENY',
            reasonCode: 'OWNER_SCOPE_MISMATCH',
            toolCallId: 'tool-risk-1',
          }),
        }),
        expect.objectContaining({
          type: 'CAPABILITY_COMPLETED',
          inlinePayload: expect.objectContaining({
            status: 'FAILED',
            safeErrorCode: 'OWNER_SCOPE_MISMATCH',
            safeErrorCategory: 'POLICY_DENIED',
          }),
        }),
      ]),
    );
    const resultPayload = appended.find((item) => item.role === 'CAPABILITY_RESULT');
    expect(resultPayload).toBeDefined();
    expect(JSON.parse(resultPayload!.content)).toMatchObject({
      payload: {
        status: 'FAILED',
        safeError: { code: 'OWNER_SCOPE_MISMATCH', category: 'POLICY_DENIED' },
      },
    });
  });

  it('feeds an ordinary authorization preparation error to the model even when it carries an authorization pending hint', async () => {
    const appended: Array<{ role: string; content: string }> = [];
    const invoke = vi.fn<CapabilityInvocationPort['invoke']>();
    const authorizationError = new AgentError({
      code: 'COMMAND_NOT_ALLOWED',
      message:
        'The command is outside the current sandbox authorization policy. Choose an allowed command, use another capability, or report that the requested operation cannot be performed.',
      category: 'AUTHORIZATION',
      retryable: false,
      safeDetails: { pendingInputKind: 'AUTHORIZATION' },
    });

    await executeToolCallsInOrder(
      {
        capabilityCatalog: {
          async listAvailable() {
            return [];
          },
          async resolve() {
            throw authorizationError;
          },
        },
        capabilityInvocation: { invoke },
        assemblyRegistry: {
          async active() {
            return assembly();
          },
          async require() {
            return assembly();
          },
        },
      },
      {
        run: run(),
        context: context(),
        runState: {
          async setCapabilityTerminalAnswer(): Promise<void> {},
          async emitEvent() {},
          async appendMessage(_run, _context, draft) {
            appended.push({ role: draft.role, content: String(draft.content) });
            return brand<string, 'MessageId'>('message-authorization-error');
          },
          async saveCheckpoint() {},
          async requestPendingInput() {
            throw new Error('requestPendingInput should not be called for an ordinary authorization error.');
          },
        },
        signal: new AbortController().signal,
        round: 0,
        toolCalls: [{ toolCallId: 'tool-authorization-error', toolName: 'read', arguments: {} }],
        requestLocalState: { generatedMessages: [] },
      },
    );

    expect(invoke).not.toHaveBeenCalled();
    expect(appended.filter((item) => item.role === 'CAPABILITY_RESULT')).toHaveLength(1);
    expect(JSON.parse(appended.find((item) => item.role === 'CAPABILITY_RESULT')!.content)).toMatchObject({
      payload: {
        status: 'FAILED',
        safeError: {
          code: 'COMMAND_NOT_ALLOWED',
          category: 'AUTHORIZATION',
          retryable: false,
          safeDetails: { pendingInputKind: 'AUTHORIZATION' },
        },
      },
    });
  });

  it('fails closed when risk policy returns an illegal outcome and does not invoke the capability', async () => {
    const events: unknown[] = [];
    const invoke = vi.fn<CapabilityInvocationPort['invoke']>(async () => ({
      status: 'SUCCEEDED',
      structuredPayload: { ok: true },
      generatedMessages: [],
      artifactRefs: [],
    }));

    await executeToolCallsInOrder(
      {
        capabilityCatalog: catalog(),
        capabilityInvocation: { invoke },
        riskPolicyEvaluator: {
          async evaluate() {
            return { outcome: 'BROKEN', reasonCode: 'BROKEN_OUTCOME' } as unknown as Awaited<ReturnType<NonNullable<typeof this>['evaluate']>>;
          },
        },
        assemblyRegistry: {
          async active() {
            return assembly();
          },
          async require() {
            return assembly();
          },
        },
      },
      {
        run: run(),
        context: context(),
        runState: {
          async setCapabilityTerminalAnswer(): Promise<void> {},
          async emitEvent(_run, _context, event) {
            events.push(event);
          },
          async appendMessage() {
            return brand<string, 'MessageId'>('message-1');
          },
          async saveCheckpoint() {},
          async requestPendingInput() {
            throw new Error('requestPendingInput should not be called by risk policy tests.');
          },
        },
        signal: new AbortController().signal,
        round: 0,
        toolCalls: [{ toolCallId: 'tool-risk-invalid', toolName: 'read', arguments: {} }],
        requestLocalState: { generatedMessages: [] },
      },
    );

    expect(invoke).not.toHaveBeenCalled();
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'POLICY_APPLIED',
          inlinePayload: expect.objectContaining({
            operationKind: 'CAPABILITY_INVOCATION',
            outcome: 'POLICY_FAILED',
            reasonCode: 'RISK_POLICY_OUTPUT_INVALID',
            toolCallId: 'tool-risk-invalid',
          }),
        }),
        expect.objectContaining({
          type: 'CAPABILITY_COMPLETED',
          inlinePayload: expect.objectContaining({
            status: 'FAILED',
            safeErrorCode: 'RISK_POLICY_OUTPUT_INVALID',
            safeErrorCategory: 'INTERNAL',
          }),
        }),
      ]),
    );
  });

  it('passes real sandbox readiness into capability risk evaluation for sandboxed tools', async () => {
    const evaluations: unknown[] = [];
    const invoke = vi.fn<CapabilityInvocationPort['invoke']>(async () => ({
      status: 'SUCCEEDED',
      structuredPayload: { ok: true },
      generatedMessages: [],
      artifactRefs: [],
    }));

    await executeToolCallsInOrder(
      {
        capabilityCatalog: bashCatalog(),
        capabilityInvocation: { invoke },
        isSandboxExecutionReady: () => false,
        riskPolicyEvaluator: {
          async evaluate(input) {
            evaluations.push(input.operation);
            return { outcome: 'ALLOW', reasonCode: 'ALLOWED' };
          },
        },
        assemblyRegistry: {
          async active() {
            return bashAssembly();
          },
          async require() {
            return bashAssembly();
          },
        },
      },
      {
        run: run(),
        context: context(),
        runState: {
          async setCapabilityTerminalAnswer(): Promise<void> {},
          async emitEvent() {},
          async appendMessage() {
            return brand<string, 'MessageId'>('message-1');
          },
          async requestPendingInput() {
            throw new Error('requestPendingInput should not be called by risk policy tests.');
          },
          async saveCheckpoint() {},
        },
        signal: new AbortController().signal,
        round: 0,
        toolCalls: [{ toolCallId: 'tool-bash-ready', toolName: 'Bash', arguments: { command: 'ls -l' } }],
        requestLocalState: { generatedMessages: [] },
      },
    );

    expect(invoke).toHaveBeenCalledTimes(1);
    expect(evaluations).toContainEqual(
      expect.objectContaining({
        operationKind: 'CAPABILITY_INVOCATION',
        capabilityId: 'Bash',
        riskLevel: 'MEDIUM',
        sandboxReady: false,
      }),
    );
  });
});

function catalog(): CapabilityCatalog {
  return {
    async listAvailable() {
      return [];
    },
    async resolve() {
      return {
        capabilityId: brand<string, 'CapabilityId'>('read'),
        kind: 'TOOL',
        provider: { providerId: 'builtin-tools', providerKind: 'BUNDLED' },
        displayName: 'read',
        description: 'read',
        availabilityStatus: 'AVAILABLE',
        replayPolicy: 'IDEMPOTENT',
      };
    },
  };
}

function assembly(): AgentAssembly {
  return {
    agentId: brand<string, 'AgentId'>('default-agent'),
    agentType: brand<string, 'AgentType'>('default'),
    agentVersion: brand<string, 'AgentVersion'>('v1'),
    agentAssemblyRef: 'default-agent:v1',
    displayName: 'Default Agent',
    description: 'Test agent',
    workspacePolicy: {
      schemaVersion: 'nextagent.agent-workspace-policy.v1',
      isolationMode: 'subject',
      roots: [
        { kind: 'workspace', logicalPath: 'workspace', access: 'readWrite' },
        { kind: 'systemResources', logicalPath: '.nextagent', access: 'read' },
        { kind: 'temp', logicalPath: 'temp', access: 'readWrite' },
      ],
    },
    modelIds: ['test-model'],
    capabilityBindings: [{ capabilityId: 'read', capabilityType: 'TOOL', providerId: 'builtin-tools', enabled: true }],
    userInvocable: true,
    agentInvocation: 'NONE',
    runtimeSettings: { requestTimeoutMs: 30_000 },
  };
}

function run(): RequestRun {
  return {
    runId: brand<string, 'RequestRunId'>('run-1'),
    sessionId: brand<string, 'SessionId'>('session-1'),
    requestId: brand<string, 'MessageId'>('request-1'),
    agentId: brand<string, 'AgentId'>('default-agent'),
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

function context(): RequestContext {
  return {
    requestContextId: brand<string, 'RequestContextId'>('context-1'),
    sessionId: brand<string, 'SessionId'>('session-1'),
    requestId: brand<string, 'MessageId'>('request-1'),
    runId: brand<string, 'RequestRunId'>('run-1'),
    agentTurnIndex: 0,
    identityContext: {
      tenantId: brand<string, 'TenantId'>('tenant-1'),
      subjectId: brand<string, 'SubjectId'>('subject-1'),
      displayName: 'tester',
    },
    locale: brand<string, 'RequestLocale'>('zh-CN'),
    agentId: brand<string, 'AgentId'>('default-agent'),
    agentVersion: brand<string, 'AgentVersion'>('v1'),
    agentAssemblyRef: 'default-agent:v1',
    nextLifecycleStage: 'BEFORE_MODEL_INVOKE',
    toolCallStates: [],
    flowVariables: {},
  };
}

function bashCatalog(): CapabilityCatalog {
  return {
    async listAvailable() {
      return [];
    },
    async resolve() {
      return {
        capabilityId: brand<string, 'CapabilityId'>('Bash'),
        kind: 'TOOL',
        provider: { providerId: 'builtin-tools', providerKind: 'BUNDLED' },
        displayName: 'Bash',
        description: 'Bash',
        availabilityStatus: 'AVAILABLE',
        replayPolicy: 'NON_IDEMPOTENT',
      };
    },
  };
}

function bashAssembly(): AgentAssembly {
  return {
    ...assembly(),
    capabilityBindings: [{ capabilityId: 'Bash', capabilityType: 'TOOL', providerId: 'builtin-tools', enabled: true }],
  };
}
