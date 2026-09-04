import { bindRuntimeLoggerProvider, brand, type JsonObject } from '@nextagent/agent-common';
import type {
  CapabilityDescriptor,
  CapabilityExecutor,
  CapabilityInvocationRequest,
  CapabilityInvocationResult,
  CapabilityInvocationRuntimeContext,
  CapabilityProviderIdentity,
} from '@nextagent/agent-contracts/capability';
import { describe, expect, it, vi } from 'vitest';

import {
  GovernedCapabilityInvocationPort,
  createStaticCapabilityExecutorFactory,
  type CapabilityExecutorFactory,
} from '../src/execution/executor.js';
import { failedSafeError } from '../src/execution/result-builders.js';

const provider: CapabilityProviderIdentity = { providerId: 'builtin-tools', providerKind: 'BUNDLED' };

describe('GovernedCapabilityInvocationPort execution boundary mapping', () => {
  it('normalizes resolver throw and rejection into a stable INTERNAL failure without invoking an executor', async () => {
    const resolver = {
      async resolveForInvocation() {
        throw new Error('RAW_RESOLVER_SECRET');
      },
    };
    const execute = vi.fn();
    const port = portWith(resolver, [executor(execute)]);

    const result = await port.invoke(request('tool'), new AbortController().signal);

    expect(result).toMatchObject({
      status: 'FAILED',
      safeError: { code: 'CAPABILITY_EXECUTION_FAILED', category: 'INTERNAL', retryable: false },
    });
    expect(execute).not.toHaveBeenCalled();
  });

  it('returns a cancel result when the parent signal is aborted before invocation and keeps executor count at 0', async () => {
    const execute = vi.fn(async () => succeeded());
    const port = portWith(descriptorResolver('tool'), [executor(execute)]);
    const controller = new AbortController();
    controller.abort();

    const result = await port.invoke(request('tool'), controller.signal);

    expect(result).toMatchObject({ status: 'FAILED', safeError: { category: 'CANCELED', retryable: false } });
    expect(execute).not.toHaveBeenCalled();
  });

  it('returns a cancel result when the parent signal is aborted during descriptor resolution and keeps executor count at 0', async () => {
    const controller = new AbortController();
    const resolver = {
      async resolveForInvocation() {
        controller.abort();
        return descriptor('tool');
      },
    };
    const execute = vi.fn(async () => succeeded());
    const port = portWith(resolver, [executor(execute)]);

    const result = await port.invoke(request('tool'), controller.signal);

    expect(result).toMatchObject({ status: 'FAILED', safeError: { category: 'CANCELED', retryable: false } });
    expect(execute).not.toHaveBeenCalled();
  });

  it('returns unavailable only for an unresolved descriptor and internal for descriptor mismatch', async () => {
    const resolver = {
      async resolveForInvocation() {
        return undefined;
      },
    };
    const port = portWith(resolver, []);
    const mismatchedPort = portWith(descriptorResolver('other'), []);

    await expect(port.invoke(request('tool'), new AbortController().signal)).resolves.toMatchObject({
      status: 'FAILED',
      safeError: { code: 'CAPABILITY_UNAVAILABLE', category: 'UNAVAILABLE' },
    });
    await expect(mismatchedPort.invoke(request('tool'), new AbortController().signal)).resolves.toMatchObject({
      status: 'FAILED',
      safeError: {
        code: 'CAPABILITY_EXECUTION_FAILED',
        category: 'INTERNAL',
        retryable: false,
        message: expect.stringMatching(/executor.*not started.*stop.*report/iu),
      },
    });
  });

  it('maps input validation violations to CAPABILITY_INPUT_INVALID with all violations and keeps executor count at 0', async () => {
    const execute = vi.fn(async () => succeeded());
    const port = portWith(
      descriptorResolver('tool', {
        type: 'object',
        additionalProperties: false,
        required: ['query'],
        properties: { query: { type: 'string' }, limit: { type: 'integer', maximum: 5 } },
      }),
      [executor(execute)],
    );

    const result = await port.invoke(request('tool', { limit: 10 }), new AbortController().signal);

    expect(result).toMatchObject({
      status: 'FAILED',
      safeError: {
        code: 'CAPABILITY_INPUT_INVALID',
        category: 'VALIDATION',
        retryable: false,
        message: 'Input validation failed for 2 constraints. Correct every listed field before calling the capability again.',
        safeDetails: {
          violations: [
            { path: '/limit', constraint: 'maximum', expected: 'a number no greater than 5' },
            { path: '/query', constraint: 'required', expected: 'the required field "query" must be present' },
          ],
        },
      },
    });
    expect(execute).not.toHaveBeenCalled();
  });

  it('maps an uncompileable descriptor input schema to a pre-execution internal failure', async () => {
    const execute = vi.fn(async () => succeeded());
    const invalidSchema = { type: 'unsupported-schema-type' };
    const port = portWith(descriptorResolver('tool', invalidSchema), [executor(execute)]);

    await expect(port.invoke(request('tool'), new AbortController().signal)).resolves.toMatchObject({
      status: 'FAILED',
      structuredPayload: {},
      safeError: {
        code: 'CAPABILITY_EXECUTION_FAILED',
        category: 'INTERNAL',
        retryable: false,
        message: expect.stringMatching(/descriptor.*not started.*stop.*report/iu),
      },
    });
    expect(execute).not.toHaveBeenCalled();
  });

  it('rejects an asynchronous descriptor input schema before executor dispatch', async () => {
    const execute = vi.fn(async () => succeeded());
    const asynchronousSchema = { $async: true, type: 'object' };
    const port = portWith(descriptorResolver('tool', asynchronousSchema), [executor(execute)]);

    await expect(port.invoke(request('tool'), new AbortController().signal)).resolves.toMatchObject({
      status: 'FAILED',
      structuredPayload: {},
      safeError: {
        code: 'CAPABILITY_EXECUTION_FAILED',
        category: 'INTERNAL',
        retryable: false,
        message: expect.stringMatching(/descriptor.*not started.*stop.*report/iu),
      },
    });
    expect(execute).not.toHaveBeenCalled();
  });

  it('maps arbitrary executor factory errors to the standard selection-stage internal failure', async () => {
    const port = portWith(descriptorResolver('tool'), {
      create() {
        throw new Error('multiple executors');
      },
    });

    await expect(port.invoke(request('tool'), new AbortController().signal)).resolves.toMatchObject({
      status: 'FAILED',
      safeError: {
        code: 'CAPABILITY_EXECUTION_FAILED',
        category: 'INTERNAL',
        retryable: false,
        message: expect.stringMatching(/executor.*not started.*stop.*report/iu),
      },
    });
  });

  it('maps a missing executor to the standard selection-stage internal failure', async () => {
    const port = portWith(descriptorResolver('tool'), createStaticCapabilityExecutorFactory([]));

    await expect(port.invoke(request('tool'), new AbortController().signal)).resolves.toMatchObject({
      status: 'FAILED',
      safeError: {
        code: 'CAPABILITY_EXECUTION_FAILED',
        category: 'INTERNAL',
        retryable: false,
        message: expect.stringMatching(/executor.*not started.*stop.*report/iu),
      },
    });
  });

  it('preserves a legal business safeError verbatim', async () => {
    const businessError = {
      code: 'ORDER_CONFLICT',
      message: 'Order state changed; refresh before retrying.',
      category: 'CONFLICT' as const,
      retryable: false,
    };
    const port = portWith(descriptorResolver('tool'), [
      executor(async () => ({ status: 'FAILED' as const, structuredPayload: {}, generatedMessages: [], artifactRefs: [], safeError: businessError })),
    ]);

    const result = await port.invoke(request('tool'), new AbortController().signal);

    expect(result).toMatchObject({ status: 'FAILED', structuredPayload: {}, safeError: businessError });
  });

  it('maps an unknown executor rejection into CAPABILITY_EXECUTION_FAILED + INTERNAL without leaking raw values', async () => {
    const port = portWith(descriptorResolver('tool'), [
      executor(async () => {
        throw new Error('RAW_PATH_C:\\secret AND token sk-abc123');
      }),
    ]);

    const result = await port.invoke(request('tool'), new AbortController().signal);

    expect(result).toMatchObject({ status: 'FAILED', safeError: { code: 'CAPABILITY_EXECUTION_FAILED', category: 'INTERNAL', retryable: false } });
    expect(JSON.stringify(result)).not.toContain('RAW_PATH');
    expect(JSON.stringify(result)).not.toContain('sk-abc123');
  });

  it('rejects an invalid result envelope with undeclared fields as INTERNAL', async () => {
    const port = portWith(descriptorResolver('tool'), [
      executor(async () => ({ status: 'SUCCEEDED', structuredPayload: {}, generatedMessages: [], artifactRefs: [], errorDiagnostics: {} })),
    ]);

    const result = await port.invoke(request('tool'), new AbortController().signal);

    expect(result).toMatchObject({ status: 'FAILED', safeError: { code: 'CAPABILITY_EXECUTION_FAILED', category: 'INTERNAL', retryable: false } });
  });

  it('maps invalid output to CAPABILITY_OUTPUT_INVALID + VALIDATION + retryable=false', async () => {
    const outputSchema = { type: 'object', additionalProperties: false, required: ['value'], properties: { value: { type: 'string' } } };
    const port = portWith(descriptorResolver('tool', { type: 'object' }, outputSchema), [
      executor(async () => ({ status: 'SUCCEEDED', structuredPayload: { value: 1 }, generatedMessages: [], artifactRefs: [] })),
    ]);

    const result = await port.invoke(request('tool'), new AbortController().signal);

    expect(result).toMatchObject({
      status: 'FAILED',
      safeError: { code: 'CAPABILITY_OUTPUT_INVALID', category: 'VALIDATION', retryable: false },
    });
    expect(JSON.stringify(result)).not.toContain('1');
  });

  it.each([
    { durationMs: 1 },
    { secret: 'not-delivered' },
    { executionId: '' },
    { nodeResultCount: -1 },
    { nodeResultCount: 1.5 },
    { nodeResultCount: Number.MAX_SAFE_INTEGER + 1 },
  ])('rejects undeclared or invalid Workflow metadata before delivery', async (metadata) => {
    const port = portWith(descriptorResolver('Workflow'), [executor(async () => ({ ...succeeded(), metadata }) as CapabilityInvocationResult)]);

    const result = await port.invoke(request('Workflow'), new AbortController().signal);

    expect(result).toMatchObject({
      status: 'FAILED',
      safeError: { code: 'CAPABILITY_OUTPUT_INVALID', category: 'VALIDATION', retryable: false },
    });
    expect(result.metadata).toBeUndefined();
    expect(JSON.stringify(result)).not.toContain('not-delivered');
  });

  it.each([undefined, {}, { executionId: 'exec-1' }, { nodeResultCount: 0 }, { executionId: 'exec-1', nodeResultCount: 2 }])(
    'accepts the closed Workflow metadata shape %#',
    async (metadata) => {
      const port = portWith(descriptorResolver('Workflow'), [
        executor(async () => ({ ...succeeded(), ...(metadata === undefined ? {} : { metadata }) }) as CapabilityInvocationResult),
      ]);

      await expect(port.invoke(request('Workflow'), new AbortController().signal)).resolves.toMatchObject({ status: 'SUCCEEDED' });
    },
  );

  it('logs only a bounded schema summary when output validation fails', async () => {
    const outputSchema = {
      type: 'object',
      additionalProperties: false,
      required: ['credentialRef'],
      properties: { credentialRef: { type: 'string' } },
    };
    const port = portWith(descriptorResolver('tool', { type: 'object' }, outputSchema), [
      executor(async () => ({
        status: 'SUCCEEDED',
        structuredPayload: { credentialRef: 42, rawSecret: 'OUTPUT_SECRET' },
        generatedMessages: [],
        artifactRefs: [],
      })),
    ]);
    const errors: Array<Record<string, unknown>> = [];
    const binding = bindRuntimeLoggerProvider({
      getLogger: () => ({
        debug() {},
        info() {},
        warn() {},
        error(fields) {
          errors.push(fields as Record<string, unknown>);
        },
      }),
    });

    try {
      await expect(port.invoke(request('tool'), new AbortController().signal)).resolves.toMatchObject({
        status: 'FAILED',
        safeError: { code: 'CAPABILITY_OUTPUT_INVALID' },
      });
      expect(errors).toEqual([
        expect.objectContaining({
          event: 'capability.output.validation_failed',
          failureStage: 'RESULT_VALIDATION',
          capabilityId: 'tool',
          safeErrorCode: 'CAPABILITY_OUTPUT_INVALID',
          safeErrorCategory: 'VALIDATION',
          retryable: false,
          outputValidationKeyword: expect.any(String),
          outputValidationSchemaPath: expect.any(String),
          outputValidationFailureCountBucket: '2-10',
        }),
      ]);
      expect(JSON.stringify(errors)).not.toContain('OUTPUT_SECRET');
      expect(JSON.stringify(errors)).not.toContain('rawSecret');
    } finally {
      binding.unbind();
    }
  });

  it.each(['FAILED', 'TIMED_OUT'] as const)('validates a non-empty %s payload against the declared output schema', async (status) => {
    const outputSchema = { type: 'object', additionalProperties: false, required: ['value'], properties: { value: { type: 'string' } } };
    const port = portWith(descriptorResolver('tool', { type: 'object' }, outputSchema), [
      executor(async () => ({
        status,
        structuredPayload: { value: 1 },
        generatedMessages: [],
        artifactRefs: [],
        safeError: {
          code: status === 'TIMED_OUT' ? 'TOOL_TIMEOUT' : 'TOOL_FAILED',
          message: 'Safe failure.',
          category: status === 'TIMED_OUT' ? 'TIMEOUT' : 'INTERNAL',
          retryable: false,
        },
      })),
    ]);

    const result = await port.invoke(request('tool'), new AbortController().signal);

    expect(result).toMatchObject({
      status: 'FAILED',
      structuredPayload: {},
      safeError: { code: 'CAPABILITY_OUTPUT_INVALID', category: 'VALIDATION', retryable: false },
    });
    expect(result.safeError?.safeDetails).toBeUndefined();
  });

  it('preserves an empty failed payload and its original SafeError without applying the business output schema', async () => {
    const outputSchema = { type: 'object', additionalProperties: false, required: ['value'], properties: { value: { type: 'string' } } };
    const safeError = { code: 'ORDER_CONFLICT', message: 'Refresh the order before continuing.', category: 'CONFLICT' as const, retryable: false };
    const port = portWith(descriptorResolver('tool', { type: 'object' }, outputSchema), [
      executor(async () => ({ status: 'FAILED', structuredPayload: {}, generatedMessages: [], artifactRefs: [], safeError })),
    ]);

    await expect(port.invoke(request('tool'), new AbortController().signal)).resolves.toMatchObject({
      status: 'FAILED',
      structuredPayload: {},
      safeError,
    });
  });

  it('rejects DEGRADED without a usable partial business payload', async () => {
    const port = portWith(descriptorResolver('tool', { type: 'object' }, { type: 'object' }), [
      executor(async () => ({
        status: 'DEGRADED',
        structuredPayload: {},
        generatedMessages: [],
        artifactRefs: [],
        safeError: { code: 'PARTIAL_RESULT', message: 'No partial result was available.', category: 'UNAVAILABLE', retryable: false },
      })),
    ]);

    await expect(port.invoke(request('tool'), new AbortController().signal)).resolves.toMatchObject({
      status: 'FAILED',
      structuredPayload: {},
      safeError: { code: 'CAPABILITY_OUTPUT_INVALID', category: 'VALIDATION', retryable: false },
    });
  });

  it('rejects an invalid structured delta and does not emit it downstream', async () => {
    const port = portWith(descriptorResolver('tool'), [
      executor(async (_d, _r, _s, runtimeContext) => {
        await runtimeContext?.emitResultDelta?.({ structuredPayload: 'unsafe' as unknown as JsonObject });
        return succeeded();
      }),
    ]);
    const downstream = vi.fn(async () => {});

    const result = await port.invoke(request('tool'), new AbortController().signal, { emitResultDelta: downstream });

    expect(result).toMatchObject({ status: 'FAILED', safeError: { category: 'INTERNAL' } });
    expect(downstream).not.toHaveBeenCalled();
  });

  it('forwards legal structured deltas through the attempt-local wrapper', async () => {
    const port = portWith(descriptorResolver('tool'), [
      executor(async (_d, _r, _s, runtimeContext) => {
        await runtimeContext?.emitResultDelta?.({ structuredPayload: { step: 1 } });
        return succeeded();
      }),
    ]);
    const downstream = vi.fn(async () => {});
    const result = await port.invoke(request('tool'), new AbortController().signal, { emitResultDelta: downstream });

    expect(result).toMatchObject({ status: 'SUCCEEDED' });
    expect(downstream).toHaveBeenCalledWith({ structuredPayload: { step: 1 } });
  });

  it('returns the executor result when the parent signal aborts during execution but the executor completes', async () => {
    const controller = new AbortController();
    const execute = vi.fn(async () => {
      controller.abort();
      return succeeded();
    });
    const port = portWith(descriptorResolver('tool'), [executor(execute)]);

    const result = await port.invoke(request('tool'), controller.signal);

    expect(result).toMatchObject({ status: 'SUCCEEDED' });
  });

  it('rejects a result whose byte length exceeds the capacity budget as CAPABILITY_RESULT_LIMIT_EXCEEDED', async () => {
    const big = 'x'.repeat(2_560_200);
    const port = portWith(descriptorResolver('tool'), [
      executor(async () => ({ status: 'SUCCEEDED', structuredPayload: { blob: big }, generatedMessages: [], artifactRefs: [] })),
    ]);

    const result = await port.invoke(request('tool'), new AbortController().signal);

    expect(result).toMatchObject({
      status: 'FAILED',
      safeError: { code: 'CAPABILITY_RESULT_LIMIT_EXCEEDED', category: 'VALIDATION', retryable: false },
    });
    expect(JSON.stringify(result)).not.toContain(big);
  });

  it('returns CAPABILITY_RESULT_LIMIT_EXCEEDED when input violations alone exceed the public capacity', async () => {
    const inputSchema = {
      type: 'object',
      additionalProperties: false,
      required: ['items'],
      properties: {
        items: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['name'],
            properties: { name: { type: 'string', minLength: 1, maxLength: 4 } },
          },
        },
      },
    };
    const items = Array.from({ length: 30_000 }, (_, index) => ({ name: 'x'.repeat(60) }));
    const port = portWith(descriptorResolver('tool', inputSchema), [executor(async () => succeeded())]);

    const result = await port.invoke(request('tool', { items }), new AbortController().signal);

    expect(result).toMatchObject({
      status: 'FAILED',
      safeError: { code: 'CAPABILITY_RESULT_LIMIT_EXCEEDED', category: 'VALIDATION', retryable: false },
    });
    expect(result.safeError).not.toHaveProperty('safeDetails');
    expect(JSON.stringify(result)).not.toContain('x'.repeat(60));
  });

  it('returns CANCELED when descriptor resolution rejects after the parent signal is aborted', async () => {
    const controller = new AbortController();
    const resolver = {
      async resolveForInvocation() {
        controller.abort();
        throw new Error('resolver aborted');
      },
    };
    const execute = vi.fn(async () => succeeded());
    const port = portWith(resolver, [executor(execute)]);

    const result = await port.invoke(request('tool'), controller.signal);

    expect(result).toMatchObject({ status: 'FAILED', safeError: { category: 'CANCELED', retryable: false } });
    expect(result.safeError?.code).not.toBe('CAPABILITY_EXECUTION_FAILED');
    expect(execute).not.toHaveBeenCalled();
  });

  it('round-trips a legal TIMEOUT SafeError as a TIMED_OUT result without degrading', async () => {
    const port = portWith(descriptorResolver('tool'), [
      executor(async () => ({
        status: 'TIMED_OUT' as const,
        structuredPayload: {},
        generatedMessages: [],
        artifactRefs: [],
        safeError: { code: 'SANDBOX_TIMEOUT', message: 'Capability execution timed out.', category: 'TIMEOUT' as const, retryable: true },
      })),
    ]);

    const result = await port.invoke(request('tool'), new AbortController().signal);

    expect(result).toMatchObject({
      status: 'TIMED_OUT',
      safeError: { code: 'SANDBOX_TIMEOUT', category: 'TIMEOUT', retryable: true, message: 'Capability execution timed out.' },
    });
    expect(result.safeError?.code).not.toBe('CAPABILITY_EXECUTION_FAILED');
  });

  it('normalizes a circular structuredPayload into CAPABILITY_EXECUTION_FAILED instead of throwing', async () => {
    const circular: Record<string, unknown> = {};
    circular['self'] = circular;
    const port = portWith(descriptorResolver('tool'), [
      executor(async () => ({
        status: 'SUCCEEDED',
        structuredPayload: circular as import('@nextagent/agent-common').JsonObject,
        generatedMessages: [],
        artifactRefs: [],
      })),
    ]);

    const result = await port.invoke(request('tool'), new AbortController().signal);

    expect(result).toMatchObject({ status: 'FAILED', safeError: { code: 'CAPABILITY_EXECUTION_FAILED', category: 'INTERNAL', retryable: false } });
  });

  it('returns a safe failure instead of rejecting when a producer result getter throws', async () => {
    const malicious: Record<string, unknown> = {};
    Object.defineProperty(malicious, 'boom', {
      enumerable: true,
      get() {
        throw new Error('THREW getter boom');
      },
    });
    const port = portWith(descriptorResolver('tool'), [
      executor(async () => ({
        status: 'SUCCEEDED',
        structuredPayload: malicious as unknown as import('@nextagent/agent-common').JsonObject,
        generatedMessages: [],
        artifactRefs: [],
      })),
    ]);

    const result = await port.invoke(request('tool'), new AbortController().signal);

    expect(result).toMatchObject({ status: 'FAILED', safeError: { code: 'CAPABILITY_EXECUTION_FAILED', category: 'INTERNAL', retryable: false } });
    expect(JSON.stringify(result)).not.toContain('THREW');
  });

  it('returns a safe failure instead of rejecting when a producer result is a sparse array payload', async () => {
    const sparse: unknown[] = [];
    sparse.length = 2;
    const port = portWith(descriptorResolver('tool'), [
      executor(async () => ({
        status: 'SUCCEEDED',
        structuredPayload: { items: sparse } as unknown as import('@nextagent/agent-common').JsonObject,
        generatedMessages: [],
        artifactRefs: [],
      })),
    ]);

    const result = await port.invoke(request('tool'), new AbortController().signal);

    expect(result).toMatchObject({ status: 'FAILED', safeError: { code: 'CAPABILITY_EXECUTION_FAILED', category: 'INTERNAL', retryable: false } });
  });
});

describe('failedSafeError preserves the TIMEOUT status', () => {
  it('maps a TIMEOUT SafeError to TIMED_OUT instead of FAILED', () => {
    const result = failedSafeError({ code: 'SANDBOX_TIMEOUT', message: 'Capability execution timed out.', category: 'TIMEOUT', retryable: true });
    expect(result.status).toBe('TIMED_OUT');
    expect(result.safeError).toMatchObject({ code: 'SANDBOX_TIMEOUT', category: 'TIMEOUT', retryable: true });
  });

  it('keeps non-timeout SafeError categories on FAILED', () => {
    const result = failedSafeError({ code: 'CONFLICT', message: 'conflict', category: 'CONFLICT', retryable: false });
    expect(result.status).toBe('FAILED');
  });
});

describe('GovernedCapabilityInvocationPort retry truth table', () => {
  it('does not retry when the descriptor is NON_IDEMPOTENT', async () => {
    const execute = vi.fn(async () => transientFailure());
    const port = portWith(descriptorResolver('tool', undefined, undefined, 'NON_IDEMPOTENT'), [executor(execute)]);

    const result = await port.invoke(request('tool'), new AbortController().signal);

    expect(result).toMatchObject({ status: 'FAILED', safeError: { category: 'UNAVAILABLE', retryable: true } });
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('does not retry when retryable is false', async () => {
    const execute = vi.fn(async () => ({
      ...transientFailure(),
      safeError: { code: 'U', message: 'm', category: 'UNAVAILABLE' as const, retryable: false },
    }));
    const port = portWith(descriptorResolver('tool', undefined, undefined, 'IDEMPOTENT'), [executor(execute)]);

    await port.invoke(request('tool'), new AbortController().signal);

    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('does not retry when the category is not transient', async () => {
    const execute = vi.fn(async () => ({
      status: 'FAILED' as const,
      structuredPayload: {},
      generatedMessages: [],
      artifactRefs: [],
      safeError: { code: 'C', message: 'm', category: 'CONFLICT' as const, retryable: true },
    }));
    const port = portWith(descriptorResolver('tool', undefined, undefined, 'IDEMPOTENT'), [executor(execute)]);

    await port.invoke(request('tool'), new AbortController().signal);

    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('does not retry CAPABILITY_RESULT_UNKNOWN even when transient and retryable', async () => {
    const execute = vi.fn(async () => ({
      status: 'TIMED_OUT' as const,
      structuredPayload: {},
      generatedMessages: [],
      artifactRefs: [],
      safeError: { code: 'CAPABILITY_RESULT_UNKNOWN', message: 'm', category: 'TIMEOUT' as const, retryable: true },
    }));
    const port = portWith(descriptorResolver('tool', undefined, undefined, 'IDEMPOTENT'), [executor(execute)]);

    await port.invoke(request('tool'), new AbortController().signal);

    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('retries once on IDEMPOTENT transient failure and returns the second success', async () => {
    const execute = vi.fn().mockResolvedValueOnce(transientFailure()).mockResolvedValueOnce(succeeded());
    const port = portWith(descriptorResolver('tool', undefined, undefined, 'IDEMPOTENT'), [executor(execute)]);

    const result = await port.invoke(request('tool'), new AbortController().signal);

    expect(result).toMatchObject({ status: 'SUCCEEDED' });
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it('uses one retry by default and lets maxRetries=0 disable automatic retry', async () => {
    const defaultExecute = vi.fn(async () => transientFailure());
    const disabledExecute = vi.fn(async () => transientFailure());
    const defaultPort = portWith(descriptorResolver('tool', undefined, undefined, 'IDEMPOTENT'), [executor(defaultExecute)]);
    const disabledPort = portWith(descriptorResolver('tool', undefined, undefined, 'IDEMPOTENT'), [executor(disabledExecute)]);

    await defaultPort.invoke(request('tool'), new AbortController().signal);
    await disabledPort.invoke({ ...request('tool'), maxRetries: 0 }, new AbortController().signal);

    expect(defaultExecute).toHaveBeenCalledTimes(2);
    expect(disabledExecute).toHaveBeenCalledTimes(1);
  });

  it('uses maxRetries as the number of additional attempts after the initial attempt', async () => {
    const execute = vi.fn(async () => transientFailure());
    const port = portWith(descriptorResolver('tool', undefined, undefined, 'IDEMPOTENT'), [executor(execute)]);

    await port.invoke({ ...request('tool'), maxRetries: 2 }, new AbortController().signal);

    expect(execute).toHaveBeenCalledTimes(3);
  });

  it.each([-1, 1.5, 6, Number.MAX_SAFE_INTEGER + 1])('falls back to maxRetries=0 for invalid maxRetries=%s and executes once', async (maxRetries) => {
    const execute = vi.fn(async () => transientFailure());
    const resolveForInvocation = vi.fn(async () => descriptor('tool'));
    const port = portWith({ resolveForInvocation }, [executor(execute)]);

    const result = await port.invoke({ ...request('tool'), maxRetries }, new AbortController().signal);

    expect(result).toMatchObject({ status: 'FAILED' });
    expect(resolveForInvocation).toHaveBeenCalledTimes(1);
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('returns the second failure after two transient attempts and never starts a third', async () => {
    const execute = vi.fn(async () => transientFailure());
    const port = portWith(descriptorResolver('tool', undefined, undefined, 'IDEMPOTENT'), [executor(execute)]);

    const result = await port.invoke(request('tool'), new AbortController().signal);

    expect(result).toMatchObject({ status: 'FAILED', safeError: { category: 'UNAVAILABLE' } });
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it('does not retry after the attempt called emitResultDelta', async () => {
    const execute = vi.fn(async (_d, _r, _s, runtimeContext) => {
      await (runtimeContext?.emitResultDelta as (p: { structuredPayload: JsonObject }) => Promise<void>)({ structuredPayload: { step: 1 } });
      return transientFailure();
    });
    const port = portWith(descriptorResolver('tool', undefined, undefined, 'IDEMPOTENT'), [executor(execute)]);

    const result = await port.invoke(request('tool'), new AbortController().signal, { emitResultDelta: vi.fn(async () => {}) });

    expect(result).toMatchObject({ status: 'FAILED', safeError: { category: 'UNAVAILABLE' } });
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('does not retry when the parent signal is aborted after the first attempt settles', async () => {
    const controller = new AbortController();
    const execute = vi.fn(async () => {
      controller.abort();
      return transientFailure();
    });
    const port = portWith(descriptorResolver('tool', undefined, undefined, 'IDEMPOTENT'), [executor(execute)]);

    const result = await port.invoke(request('tool'), controller.signal);

    expect(result).toMatchObject({ status: 'FAILED' });
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('stops the second attempt and does not start a third when the parent signal aborts during it', async () => {
    const controller = new AbortController();
    let first = true;
    const execute = vi.fn(async () => {
      if (first) {
        first = false;
        return transientFailure();
      }
      controller.abort();
      return transientFailure();
    });
    const port = portWith(descriptorResolver('tool', undefined, undefined, 'IDEMPOTENT'), [executor(execute)]);

    const result = await port.invoke(request('tool'), controller.signal);

    expect(result).toMatchObject({ status: 'FAILED' });
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it('passes the same original timeoutMs to both attempts', async () => {
    const received: number[] = [];
    const execute = vi.fn(async (_d, requestValue) => {
      received.push(requestValue.timeoutMs);
      if (received.length === 1) {
        return transientFailure();
      }
      return succeeded();
    });
    const port = portWith(descriptorResolver('tool', undefined, undefined, 'IDEMPOTENT'), [executor(execute)]);

    const result = await port.invoke({ ...request('tool'), timeoutMs: 30_000 }, new AbortController().signal);

    expect(result).toMatchObject({ status: 'SUCCEEDED' });
    expect(received).toEqual([30_000, 30_000]);
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it('does not retry when the downstream delta emitter rejects', async () => {
    const execute = vi.fn(async (_d, _r, _s, runtimeContext) => {
      await (runtimeContext?.emitResultDelta as (p: { structuredPayload: JsonObject }) => Promise<void>)({ structuredPayload: { step: 1 } });
      return transientFailure();
    });
    const port = portWith(descriptorResolver('tool', undefined, undefined, 'IDEMPOTENT'), [executor(execute)]);

    const result = await port.invoke(request('tool'), new AbortController().signal, {
      emitResultDelta: async () => {
        throw new Error('downstream emitter rejected');
      },
    });

    expect(result).toMatchObject({ status: 'FAILED', safeError: { category: 'INTERNAL', retryable: false } });
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('rejects a delta emitted after the attempt settles and does not project it downstream', async () => {
    const downstream = vi.fn(async () => {});
    const execute = vi.fn(async (_d, _r, _s, runtimeContext) => {
      const emit = (runtimeContext?.emitResultDelta as (p: { structuredPayload: JsonObject }) => Promise<void>) ?? (async () => {});
      // Fire a late delta that resolves only after the executor settles and
      // the attempt delta channel has been closed.
      const late = (async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        await emit({ structuredPayload: { late: true } });
      })();
      void late.catch(() => {});
      return succeeded();
    });
    const port = portWith(descriptorResolver('tool', undefined, undefined, 'IDEMPOTENT'), [executor(execute)]);

    const result = await port.invoke(request('tool'), new AbortController().signal, { emitResultDelta: downstream });
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(result).toMatchObject({ status: 'SUCCEEDED' });
    expect(downstream).not.toHaveBeenCalled();
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('proves with a fake timer that the second attempt receives the original timeoutMs', async () => {
    vi.useFakeTimers();
    try {
      const received: number[] = [];
      const execute = vi.fn(async (_d, requestValue) => {
        received.push(requestValue.timeoutMs);
        if (received.length === 1) {
          return transientFailure();
        }
        return succeeded();
      });
      const port = portWith(descriptorResolver('tool', undefined, undefined, 'IDEMPOTENT'), [executor(execute)]);

      const pending = port.invoke({ ...request('tool'), timeoutMs: 30_000 }, new AbortController().signal);
      await vi.advanceTimersByTimeAsync(0);

      expect(await pending).toMatchObject({ status: 'SUCCEEDED' });
      expect(received).toEqual([30_000, 30_000]);
      expect(execute).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('proves with a fake timer that the parent signal aborting the second attempt prevents a third attempt', async () => {
    vi.useFakeTimers();
    try {
      const controller = new AbortController();
      let first = true;
      const execute = vi.fn(async (_d, _r, _s) => {
        if (first) {
          first = false;
          return transientFailure();
        }
        controller.abort();
        return transientFailure();
      });
      const port = portWith(descriptorResolver('tool', undefined, undefined, 'IDEMPOTENT'), [executor(execute)]);

      const pending = port.invoke(request('tool'), controller.signal);
      await vi.advanceTimersByTimeAsync(0);

      expect(await pending).toMatchObject({ status: 'FAILED' });
      expect(execute).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });
});

function descriptorResolver(
  capabilityId: string,
  inputSchema: JsonObject = { type: 'object' },
  outputSchema: JsonObject = { type: 'object' },
  replayPolicy: 'IDEMPOTENT' | 'NON_IDEMPOTENT' = 'IDEMPOTENT',
): CapabilityDescriptorResolver {
  return {
    async resolveForInvocation() {
      return descriptor(capabilityId, inputSchema, outputSchema, replayPolicy);
    },
  };
}

function descriptor(
  capabilityId: string,
  inputSchema: JsonObject = { type: 'object' },
  outputSchema: JsonObject = { type: 'object' },
  replayPolicy: 'IDEMPOTENT' | 'NON_IDEMPOTENT' = 'IDEMPOTENT',
): CapabilityDescriptor {
  return {
    capabilityId: brand<string, 'CapabilityId'>(capabilityId),
    kind: 'TOOL',
    provider,
    displayName: capabilityId,
    description: `${capabilityId} test capability.`,
    availabilityStatus: 'AVAILABLE',
    modelInvocable: true,
    inputSchema,
    outputSchema,
    replayPolicy,
  };
}

function executor(
  invoke: (
    descriptor: CapabilityDescriptor,
    request: CapabilityInvocationRequest,
    signal: AbortSignal,
    runtimeContext?: CapabilityInvocationRuntimeContext,
  ) => Promise<CapabilityInvocationResult>,
): { readonly provider: CapabilityProviderIdentity; readonly executor: CapabilityExecutor } {
  return {
    provider,
    executor: { capabilityKinds: ['TOOL'], invoke },
  };
}

function portWith(
  resolver: CapabilityDescriptorResolver,
  factory: CapabilityExecutorFactory | ReadonlyArray<{ readonly provider: CapabilityProviderIdentity; readonly executor: CapabilityExecutor }>,
): GovernedCapabilityInvocationPort {
  const executorFactory: CapabilityExecutorFactory = Array.isArray(factory)
    ? createStaticCapabilityExecutorFactory(factory)
    : (factory as CapabilityExecutorFactory);
  return new GovernedCapabilityInvocationPort(resolver, executorFactory);
}

function succeeded(): CapabilityInvocationResult {
  return { status: 'SUCCEEDED', structuredPayload: {}, generatedMessages: [], artifactRefs: [] };
}

function transientFailure(): CapabilityInvocationResult {
  return {
    status: 'FAILED',
    structuredPayload: {},
    generatedMessages: [],
    artifactRefs: [],
    safeError: { code: 'U', message: 'm', category: 'UNAVAILABLE', retryable: true },
  };
}

function request(capabilityId: string, args: JsonObject = {}): CapabilityInvocationRequest {
  return {
    invocationId: 'invoke-test',
    capabilityId: brand<string, 'CapabilityId'>(capabilityId),
    arguments: args,
    sessionId: brand<string, 'SessionId'>('session-test'),
    requestId: brand<string, 'MessageId'>('request-test'),
    runId: brand<string, 'RequestRunId'>('run-test'),
    requestContextId: brand<string, 'RequestContextId'>('context-test'),
    stepId: 'turn-1',
    identityContext: {
      tenantId: brand<string, 'TenantId'>('tenant-test'),
      subjectId: brand<string, 'SubjectId'>('subject-test'),
      displayName: 'tester',
    },
    agentId: brand<string, 'AgentId'>('agent-test'),
    agentVersion: brand<string, 'AgentVersion'>('v1'),
    timeoutMs: 30_000,
    idempotencyKey: brand<string, 'IdempotencyKey'>('idem-test'),
  };
}

interface CapabilityDescriptorResolver {
  resolveForInvocation: (capabilityId: string, signal: AbortSignal) => CapabilityDescriptor | undefined | Promise<CapabilityDescriptor | undefined>;
}
