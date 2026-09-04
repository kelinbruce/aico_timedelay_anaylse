import { agentToolCapabilityId, agentToolDefinition, createCapabilitySubsystem, type ToolExecuteOptions } from '@nextagent/agent-capability';
import { brand, type JsonObject, type SafeError } from '@nextagent/agent-common';
import type { CapabilityDescriptor, CapabilityInvocationRequest, CapabilityInvocationResult } from '@nextagent/agent-contracts/capability';
import type { SubagentExecutionPort, SubagentExecutionRequest, SubagentExecutionResult } from '@nextagent/agent-contracts/capability';
import { describe, expect, it, vi } from 'vitest';

describe('Agent builtin Tool', () => {
  it('describes Agent delegation as distinct from Task lifecycle management', () => {
    expect(agentToolDefinition.metadata.description).toContain('wait for its safe terminal result text');
    expect(agentToolDefinition.metadata.description).toContain('starts fresh and does not inherit parent conversation context');
    expect(agentToolDefinition.metadata.description).toContain('Do not use Agent to create a persistent work item');
    expect(agentToolDefinition.metadata.description).toContain('use the Task tools for managed Task lifecycle');
    expect(agentToolDefinition.metadata.description).toContain('cannot invoke itself');
  });

  it('validates input before resolving Agent capabilities', async () => {
    const options = executionOptions();

    await expect(execute({ agentId: 'child-agent', prompt: '', extra: 'no' }, options)).resolves.toMatchObject({
      status: 'FAILED',
      safeError: {
        code: 'INVALID_INPUT',
        category: 'VALIDATION',
        message:
          'Agent validation failed before delegation: prompt must be a non-empty string. Supply a self-contained subtask prompt and call again.',
      },
    });
    await expect(execute({ agentId: 'child-agent', prompt: 'a'.repeat(8193) }, options)).resolves.toMatchObject({
      status: 'FAILED',
      safeError: {
        code: 'INVALID_INPUT',
        category: 'VALIDATION',
        message: 'Agent validation failed before delegation: prompt must not exceed 8192 UTF-8 bytes. Shorten the prompt and call again.',
      },
    });

    expect(options.context?.capabilityResolver?.resolveCapability).not.toHaveBeenCalled();
    expect(options.deps?.subagentExecution?.executeSubagent).not.toHaveBeenCalled();
  });

  it('rejects self invocation without discovery or runtime side effects', async () => {
    const options = executionOptions();

    const result = await execute({ agentId: 'parent-agent', prompt: 'diagnose alarm' }, options);

    expect(result).toMatchObject({ status: 'FAILED', safeError: { code: 'SELF_INVOCATION_REJECTED', category: 'VALIDATION' } });
    expect(options.context?.capabilityResolver?.resolveCapability).not.toHaveBeenCalled();
    expect(options.deps?.subagentExecution?.executeSubagent).not.toHaveBeenCalled();
  });

  it('resolves only Agent descriptors before delegating to the subagent execution port', async () => {
    const subagentRequest: SubagentExecutionRequest[] = [];
    const options = executionOptions({
      descriptor: agentDescriptor(),
      subagentResult: { status: 'COMPLETED', terminalText: 'child answer' },
      onSubagentRequest: (request) => subagentRequest.push(request),
    });

    const result = await execute({ agentId: 'child-agent', prompt: 'diagnose alarm' }, options);

    expect(options.context?.capabilityResolver?.resolveCapability).toHaveBeenCalledWith(
      { kind: 'AGENT', capabilityId: 'child-agent' },
      expect.any(AbortSignal),
    );
    expect(subagentRequest).toEqual([
      expect.objectContaining({
        targetAgentId: 'child-agent',
        targetAgentVersion: 'v2',
        targetProviderKind: 'BUNDLED',
        prompt: 'diagnose alarm',
        parentSessionId: 'session-agent-tool',
        parentRunId: 'run-agent-tool',
        parentRequestId: 'request-agent-tool',
        parentToolCallId: 'tool-call-agent',
        locale: 'zh-CN',
        idempotencyKey: 'run-agent-tool:tool-call-agent',
      }),
    ]);
    expect(result).toMatchObject({
      status: 'SUCCEEDED',
      structuredPayload: {
        agentId: 'child-agent',
        status: 'completed',
        result: { text: 'child answer' },
      },
    });
  });

  it('maps unavailable targets and terminal subagent outcomes to the public Tool codes', async () => {
    await expect(execute({ agentId: 'child-agent', prompt: 'diagnose' }, executionOptions({ descriptor: undefined }))).resolves.toMatchObject({
      status: 'FAILED',
      safeError: { code: 'AGENT_NOT_AVAILABLE', category: 'UNAVAILABLE' },
    });
    await expect(
      execute({ agentId: 'child-agent', prompt: 'diagnose' }, executionOptions({ descriptor: agentDescriptor({ kind: 'TOOL' }) })),
    ).resolves.toMatchObject({
      status: 'FAILED',
      safeError: { code: 'AGENT_NOT_AVAILABLE', category: 'UNAVAILABLE' },
    });
    await expect(
      execute({ agentId: 'child-agent', prompt: 'diagnose' }, executionOptions({ subagentResult: { status: 'TIMED_OUT', terminalText: '' } })),
    ).resolves.toMatchObject({
      status: 'TIMED_OUT',
      safeError: { code: 'TIMEOUT', category: 'TIMEOUT' },
    });
    await expect(
      execute({ agentId: 'child-agent', prompt: 'diagnose' }, executionOptions({ subagentResult: { status: 'CANCELED', terminalText: '' } })),
    ).resolves.toMatchObject({
      status: 'FAILED',
      safeError: { code: 'ABORTED', category: 'CANCELED' },
    });
    const failed = await execute(
      { agentId: 'child-agent', prompt: 'diagnose' },
      executionOptions({
        subagentResult: {
          status: 'FAILED',
          terminalText: '',
          childSessionId: brand<string, 'SessionId'>('session-child-agent'),
          childRunId: brand<string, 'RequestRunId'>('run-child-agent'),
          safeError: {
            ...safeError('UNKNOWN_AGENT_TYPE', 'Agent type is not registered.'),
            retryable: true,
            safeDetails: { targetType: 'missing-type' },
          },
        },
      }),
    );
    expect(failed).toMatchObject({
      status: 'FAILED',
      safeError: {
        code: 'UNKNOWN_AGENT_TYPE',
        message: 'Agent type is not registered.',
        category: 'INTERNAL',
        retryable: true,
        safeDetails: { targetType: 'missing-type' },
      },
    });
    expect(JSON.stringify(failed)).not.toContain('session-child-agent');
    expect(JSON.stringify(failed)).not.toContain('run-child-agent');
  });

  it('rejects incompatible child status and safeError combinations without leaking child ids', async () => {
    const privateIds = {
      childSessionId: brand<string, 'SessionId'>('private-child-session'),
      childRunId: brand<string, 'RequestRunId'>('private-child-run'),
    };
    const internalError = safeError('CHILD_INTERNAL', 'Child failed internally.');

    const completed = await execute(
      { agentId: 'child-agent', prompt: 'diagnose' },
      executionOptions({ subagentResult: { status: 'COMPLETED', terminalText: 'unsafe success', safeError: internalError, ...privateIds } }),
    );
    const timedOut = await execute(
      { agentId: 'child-agent', prompt: 'diagnose' },
      executionOptions({ subagentResult: { status: 'TIMED_OUT', terminalText: '', safeError: internalError, ...privateIds } }),
    );
    const canceled = await execute(
      { agentId: 'child-agent', prompt: 'diagnose' },
      executionOptions({ subagentResult: { status: 'CANCELED', terminalText: '', safeError: internalError, ...privateIds } }),
    );

    expect(completed).toMatchObject({
      status: 'FAILED',
      safeError: { code: 'AGENT_CHILD_RESULT_INVALID', category: 'INTERNAL', retryable: false },
    });
    expect(timedOut).toMatchObject({
      status: 'FAILED',
      safeError: { code: 'AGENT_CHILD_RESULT_INVALID', category: 'INTERNAL', retryable: false },
    });
    expect(canceled).toMatchObject({
      status: 'FAILED',
      safeError: { code: 'ABORTED', category: 'CANCELED', retryable: false },
    });
    expect(JSON.stringify([completed, timedOut, canceled])).not.toContain('private-child-');
  });

  it('maps a FAILED child TIMEOUT SafeError to TIMED_OUT without leaking child ids', async () => {
    const childTimeout: SafeError = {
      code: 'CHILD_TIMEOUT',
      message: 'The delegated operation timed out.',
      category: 'TIMEOUT',
      retryable: false,
      safeDetails: { stage: 'child-execution' },
    };
    const result = await execute(
      { agentId: 'child-agent', prompt: 'diagnose' },
      executionOptions({
        subagentResult: {
          status: 'FAILED',
          terminalText: '',
          childSessionId: brand<string, 'SessionId'>('private-timeout-session'),
          childRunId: brand<string, 'RequestRunId'>('private-timeout-run'),
          safeError: childTimeout,
        },
      }),
    );

    expect(result).toMatchObject({ status: 'TIMED_OUT', structuredPayload: {}, safeError: childTimeout });
    expect(JSON.stringify(result)).not.toContain('private-timeout-');
  });

  it('preserves a FAILED child TIMEOUT SafeError through the governed invocation boundary', async () => {
    const childTimeout: SafeError = {
      code: 'CHILD_TIMEOUT',
      message: 'The delegated operation timed out.',
      category: 'TIMEOUT',
      retryable: false,
      safeDetails: { stage: 'child-execution' },
    };
    const subagentExecution: SubagentExecutionPort = {
      async executeSubagent() {
        return { status: 'FAILED', terminalText: '', safeError: childTimeout };
      },
    };
    const subsystem = createCapabilitySubsystem({ toolDependencies: { subagentExecution } });

    const result = await subsystem.invocationPort.invoke(agentInvocationRequest(), new AbortController().signal, {
      capabilityResolver: {
        async resolveCapability() {
          return agentDescriptor();
        },
      },
    });

    expect(result).toMatchObject({ status: 'TIMED_OUT', structuredPayload: {}, safeError: childTimeout });
    expect(result.safeError?.code).not.toBe('CAPABILITY_EXECUTION_FAILED');
  });
});

function execute(input: JsonObject, options: ToolExecuteOptions): Promise<CapabilityInvocationResult> {
  return agentToolDefinition.tool.execute(input, options) as Promise<CapabilityInvocationResult>;
}

function executionOptions(
  overrides: {
    readonly descriptor?: CapabilityDescriptor | undefined;
    readonly subagentResult?: SubagentExecutionResult;
    readonly onSubagentRequest?: (request: SubagentExecutionRequest) => void;
  } = {},
): ToolExecuteOptions {
  const descriptor = Object.hasOwn(overrides, 'descriptor') ? overrides.descriptor : agentDescriptor();
  const subagentExecution: SubagentExecutionPort = {
    executeSubagent: vi.fn<SubagentExecutionPort['executeSubagent']>(async (request) => {
      overrides.onSubagentRequest?.(request);
      return overrides.subagentResult ?? { status: 'COMPLETED' as const, terminalText: 'ok' };
    }),
  };
  return {
    context: {
      identityContext: {
        tenantId: brand<string, 'TenantId'>('tenant-agent-tool'),
        subjectId: brand<string, 'SubjectId'>('subject-agent-tool'),
        displayName: 'Agent tool tester',
      },
      agentId: brand<string, 'AgentId'>('parent-agent'),
      agentVersion: brand<string, 'AgentVersion'>('v1'),
      sessionId: brand<string, 'SessionId'>('session-agent-tool'),
      requestId: brand<string, 'MessageId'>('request-agent-tool'),
      runId: brand<string, 'RequestRunId'>('run-agent-tool'),
      requestContextId: brand<string, 'RequestContextId'>('context-agent-tool'),
      stepId: 'turn-1',
      toolCallId: 'tool-call-agent',
      locale: brand<string, 'RequestLocale'>('zh-CN'),
      timeoutMs: 30_000,
      capabilityResolver: {
        resolveCapability: vi.fn(async () => descriptor),
      },
    },
    deps: { subagentExecution },
    signal: new AbortController().signal,
  };
}

function agentDescriptor(overrides: Partial<CapabilityDescriptor> = {}): CapabilityDescriptor {
  return {
    capabilityId: brand<string, 'CapabilityId'>('child-agent'),
    kind: 'AGENT',
    provider: { providerId: 'child-agent-provider', providerKind: 'BUNDLED' },
    version: 'v2',
    displayName: 'Child Agent',
    description: 'Child telecom diagnostics agent.',
    modelInvocable: true,
    availabilityStatus: 'AVAILABLE',
    ...overrides,
  };
}

function safeError(code: string, message = 'safe'): SafeError {
  return { code, message, category: 'INTERNAL', retryable: false };
}

function agentInvocationRequest(): CapabilityInvocationRequest {
  return {
    invocationId: 'invoke-agent-timeout',
    capabilityId: agentToolCapabilityId,
    arguments: { agentId: 'child-agent', prompt: 'diagnose' },
    sessionId: brand<string, 'SessionId'>('session-agent-tool'),
    requestId: brand<string, 'MessageId'>('request-agent-tool'),
    runId: brand<string, 'RequestRunId'>('run-agent-tool'),
    requestContextId: brand<string, 'RequestContextId'>('context-agent-tool'),
    stepId: 'turn-1',
    toolCallId: 'tool-call-agent',
    identityContext: {
      tenantId: brand<string, 'TenantId'>('tenant-agent-tool'),
      subjectId: brand<string, 'SubjectId'>('subject-agent-tool'),
      displayName: 'Agent tool tester',
    },
    agentId: brand<string, 'AgentId'>('parent-agent'),
    agentVersion: brand<string, 'AgentVersion'>('v1'),
    timeoutMs: 30_000,
    idempotencyKey: brand<string, 'IdempotencyKey'>('idem-agent-timeout'),
    maxRetries: 0,
  };
}
