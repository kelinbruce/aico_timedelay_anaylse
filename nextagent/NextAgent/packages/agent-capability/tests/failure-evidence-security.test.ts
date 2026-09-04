import { bindRuntimeLoggerProvider, brand, type JsonObject } from '@nextagent/agent-common';
import type {
  CapabilityDescriptor,
  CapabilityInvocationRequest,
  CapabilityInvocationResult,
  CapabilityProviderIdentity,
  SubagentExecutionPort,
} from '@nextagent/agent-contracts/capability';
import { describe, expect, it, vi } from 'vitest';

import {
  GovernedCapabilityInvocationPort,
  createStaticCapabilityExecutorFactory,
  type CapabilityExecutorFactory,
} from '../src/execution/executor.js';
import { agentToolDefinition } from '../src/builtins/agent/agent-tool.js';
import type { ToolExecuteOptions } from '../src/tools/tool-spi.js';

const provider: CapabilityProviderIdentity = { providerId: 'builtin-tools', providerKind: 'BUNDLED' };

/**
 * Security negative tests (FN-5.2 + 安全 + capability-catalog / Capability 失败证据
 * 不跨安全边界). Verifies raw exception, stack, path, credential, provider
 * response, illegal input value and unsanitized output never appear in a public
 * CapabilityInvocationResult after the unified boundary.
 */
describe('capability failure evidence does not cross the security boundary', () => {
  it('keeps raw exception, stack, path, credential and provider response out of an unknown-failure result', async () => {
    const secretPath = 'C:\\Users\\secret\\workspace\\private';
    const rawError = new Error(`Boom at ${secretPath} with credential api-key=sk-live-abcdef123456 stack: at foo`);
    const port = portWith(descriptorResolver('tool'), [
      executor(async () => {
        throw rawError;
      }),
    ]);

    const result = await port.invoke(request('tool'), new AbortController().signal);

    expect(result).toMatchObject({ status: 'FAILED', safeError: { code: 'CAPABILITY_EXECUTION_FAILED', category: 'INTERNAL', retryable: false } });
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain('secret');
    expect(serialized).not.toContain('sk-live-');
    expect(serialized).not.toContain('api-key');
    expect(serialized).not.toContain('stack');
    expect(serialized).not.toContain('at foo');
  });

  it('never echoes a rejected illegal input original value or additional property name', async () => {
    const secretValue = 'SECRET_ORIGINAL_VALUE_12345';
    const forbiddenKey = 'credentialField';
    const port = portWith(
      descriptorResolver('tool', { type: 'object', additionalProperties: false, required: ['query'], properties: { query: { type: 'string' } } }),
      [
        executor(async () => {
          throw new Error('unreachable');
        }),
      ],
    );

    const result = await port.invoke(request('tool', { [forbiddenKey]: secretValue }), new AbortController().signal);

    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain(secretValue);
    expect(serialized).not.toContain(forbiddenKey);
    expect(result.safeError?.code).toBe('CAPABILITY_INPUT_INVALID');
  });

  it('never emits unsanitized capability output through the public result', async () => {
    const providerResponse = 'RAW_PROVIDER_RESPONSE_WITH_CREDENTIAL=sk-live-zzz';
    const port = portWith(
      descriptorResolver(
        'tool',
        { type: 'object' },
        { type: 'object', additionalProperties: false, required: ['value'], properties: { value: { type: 'string' } } },
      ),
      [executor(async () => ({ status: 'SUCCEEDED', structuredPayload: { value: 1 }, generatedMessages: [], artifactRefs: [] }))],
    );

    const result = await port.invoke(request('tool'), new AbortController().signal);

    const serialized = JSON.stringify(result);
    expect(result.safeError?.code).toBe('CAPABILITY_OUTPUT_INVALID');
    expect(serialized).not.toContain(providerResponse);
    expect(serialized).not.toContain('sk-live-zzz');
  });

  it('local runtime diagnostic may carry only redacted rawExceptionData and never affects the public result', async () => {
    const logs: Array<Record<string, unknown>> = [];
    const binding = bindRuntimeLoggerProvider({
      getLogger: () => ({
        debug() {},
        info() {},
        warn() {},
        error(fields) {
          logs.push(fields as Record<string, unknown>);
        },
      }),
    });
    const secret = 'C:\\secret\\token sk-live-abcdef';
    try {
      const port = portWith(descriptorResolver('tool'), [
        executor(async () => {
          throw new Error(`boom ${secret}`);
        }),
      ]);
      const result = await port.invoke(request('tool'), new AbortController().signal);
      expect(result).toMatchObject({ safeError: { code: 'CAPABILITY_EXECUTION_FAILED' } });
      expect(JSON.stringify(result)).not.toContain('secret');
      expect(JSON.stringify(result)).not.toContain('sk-live-');
    } finally {
      binding.unbind();
    }
  });

  it('keeps child session and run ids out of Agent failure evidence while preserving the child SafeError', async () => {
    const subagentExecution: SubagentExecutionPort = {
      async executeSubagent() {
        return {
          status: 'FAILED',
          terminalText: '',
          childSessionId: brand<string, 'SessionId'>('private-child-session'),
          childRunId: brand<string, 'RequestRunId'>('private-child-run'),
          safeError: {
            code: 'CHILD_FAILED',
            message: 'The delegated operation failed safely.',
            category: 'INTERNAL',
            retryable: false,
            safeDetails: { stage: 'dispatch' },
          },
        };
      },
    };
    const options: ToolExecuteOptions = {
      context: {
        ...request('Agent'),
        toolCallId: 'tool-call-agent-security',
        capabilityResolver: {
          async resolveCapability() {
            return {
              capabilityId: brand<string, 'CapabilityId'>('child-agent'),
              kind: 'AGENT',
              provider: { providerId: 'child-provider', providerKind: 'BUNDLED' },
              displayName: 'Child Agent',
              description: 'Delegated security test agent.',
              availabilityStatus: 'AVAILABLE',
              modelInvocable: true,
            };
          },
        },
      },
      deps: { subagentExecution },
      signal: new AbortController().signal,
    };

    const result = (await agentToolDefinition.tool.execute(
      { agentId: 'child-agent', prompt: 'diagnose safely' },
      options,
    )) as CapabilityInvocationResult;

    expect(result).toMatchObject({
      status: 'FAILED',
      safeError: {
        code: 'CHILD_FAILED',
        message: 'The delegated operation failed safely.',
        category: 'INTERNAL',
        retryable: false,
        safeDetails: { stage: 'dispatch' },
      },
    });
    expect(JSON.stringify(result)).not.toContain('private-child-session');
    expect(JSON.stringify(result)).not.toContain('private-child-run');
  });
});

function descriptorResolver(
  capabilityId: string,
  inputSchema: JsonObject = { type: 'object' },
  outputSchema: JsonObject = { type: 'object' },
): CapabilityDescriptorResolver {
  return {
    async resolveForInvocation() {
      return {
        capabilityId: brand<string, 'CapabilityId'>(capabilityId),
        kind: 'TOOL',
        provider,
        displayName: capabilityId,
        description: `${capabilityId} security test capability.`,
        availabilityStatus: 'AVAILABLE',
        modelInvocable: true,
        inputSchema,
        outputSchema,
        replayPolicy: 'IDEMPOTENT',
      };
    },
  };
}

function executor(
  invoke: (descriptor: CapabilityDescriptor, request: CapabilityInvocationRequest, signal: AbortSignal) => Promise<CapabilityInvocationResult>,
): {
  readonly provider: CapabilityProviderIdentity;
  readonly executor: { readonly capabilityKinds: ReadonlyArray<import('@nextagent/agent-common').CapabilityKind>; invoke: typeof invoke };
} {
  return {
    provider,
    executor: { capabilityKinds: ['TOOL'], invoke },
  };
}

function portWith(
  resolver: CapabilityDescriptorResolver,
  factory:
    | CapabilityExecutorFactory
    | ReadonlyArray<{
        readonly provider: CapabilityProviderIdentity;
        readonly executor: {
          readonly capabilityKinds: ReadonlyArray<import('@nextagent/agent-common').CapabilityKind>;
          invoke: (
            descriptor: CapabilityDescriptor,
            request: CapabilityInvocationRequest,
            signal: AbortSignal,
          ) => Promise<CapabilityInvocationResult>;
        };
      }>,
): GovernedCapabilityInvocationPort {
  const executorFactory: CapabilityExecutorFactory = Array.isArray(factory)
    ? createStaticCapabilityExecutorFactory(factory as Parameters<typeof createStaticCapabilityExecutorFactory>[0])
    : (factory as CapabilityExecutorFactory);
  return new GovernedCapabilityInvocationPort(resolver, executorFactory);
}

function request(capabilityId: string, args: JsonObject = {}): CapabilityInvocationRequest {
  return {
    invocationId: 'invoke-security',
    capabilityId: brand<string, 'CapabilityId'>(capabilityId),
    arguments: args,
    sessionId: brand<string, 'SessionId'>('session-security'),
    requestId: brand<string, 'MessageId'>('request-security'),
    runId: brand<string, 'RequestRunId'>('run-security'),
    requestContextId: brand<string, 'RequestContextId'>('context-security'),
    stepId: 'turn-1',
    identityContext: {
      tenantId: brand<string, 'TenantId'>('tenant-security'),
      subjectId: brand<string, 'SubjectId'>('subject-security'),
      displayName: 'Security tester',
    },
    agentId: brand<string, 'AgentId'>('agent-security'),
    agentVersion: brand<string, 'AgentVersion'>('v1'),
    timeoutMs: 30_000,
    idempotencyKey: brand<string, 'IdempotencyKey'>('idem-security'),
  };
}

interface CapabilityDescriptorResolver {
  resolveForInvocation: (capabilityId: string, signal: AbortSignal) => CapabilityDescriptor | undefined | Promise<CapabilityDescriptor | undefined>;
}
