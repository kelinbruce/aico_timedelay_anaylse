import { describe, expect, it } from 'vitest';
import type { CapabilityInvocationResult } from '@nextagent/agent-contracts/capability';

import { validateCapabilityInvocationResult } from '../src/execution/result-schema.js';

const baseSucceeded: CapabilityInvocationResult = {
  status: 'SUCCEEDED',
  structuredPayload: {},
  generatedMessages: [],
  artifactRefs: [],
};

const baseFailed = (safeError?: unknown): unknown => ({
  status: 'FAILED',
  structuredPayload: {},
  generatedMessages: [],
  artifactRefs: [],
  ...(safeError === undefined ? {} : { safeError }),
});

describe('strict capability result runtime schema', () => {
  it('accepts a legal SUCCEEDED result without safeError', () => {
    const validation = validateCapabilityInvocationResult(baseSucceeded);
    expect(validation.ok).toBe(true);
  });

  it('rejects SUCCEEDED results carrying safeError', () => {
    const validation = validateCapabilityInvocationResult({
      ...baseSucceeded,
      safeError: { code: 'X', message: 'm', category: 'VALIDATION', retryable: false },
    });
    expect(validation).toEqual({ ok: false, issue: 'STATUS_SAFE_ERROR_CONFLICT' });
  });

  it('accepts FAILED and TIMED_OUT results with a valid safeError', () => {
    const safeError = { code: 'X', message: 'm', category: 'VALIDATION', retryable: false };
    expect(validateCapabilityInvocationResult(baseFailed(safeError))).toEqual({ ok: true, result: baseFailed(safeError) });
    expect(
      validateCapabilityInvocationResult({
        status: 'TIMED_OUT',
        structuredPayload: {},
        generatedMessages: [],
        artifactRefs: [],
        safeError: { code: 'T', message: 'm', category: 'TIMEOUT', retryable: false },
      }),
    ).toMatchObject({ ok: true });
  });

  it('requires safeError on FAILED and TIMED_OUT', () => {
    expect(validateCapabilityInvocationResult(baseFailed())).toEqual({ ok: false, issue: 'STATUS_SAFE_ERROR_CONFLICT' });
    expect(
      validateCapabilityInvocationResult({
        status: 'TIMED_OUT',
        structuredPayload: {},
        generatedMessages: [],
        artifactRefs: [],
      }),
    ).toEqual({ ok: false, issue: 'STATUS_SAFE_ERROR_CONFLICT' });
  });

  it('requires CANCELED category to use FAILED status', () => {
    expect(
      validateCapabilityInvocationResult({
        ...baseSucceeded,
        status: 'DEGRADED',
        safeError: { code: 'C', message: 'm', category: 'CANCELED', retryable: false },
      }),
    ).toEqual({ ok: false, issue: 'STATUS_SAFE_ERROR_CONFLICT' });
  });

  it('accepts DEGRADED with or without safeError', () => {
    const degraded = { ...baseSucceeded, status: 'DEGRADED' as const };
    expect(validateCapabilityInvocationResult(degraded)).toMatchObject({ ok: true });
    expect(
      validateCapabilityInvocationResult({
        ...degraded,
        safeError: { code: 'D', message: 'm', category: 'UNAVAILABLE', retryable: false },
      }),
    ).toMatchObject({ ok: true });
  });

  it('accepts fallbackTriggered with any status without altering status or safeError', () => {
    const cases: ReadonlyArray<{ readonly label: string; readonly input: CapabilityInvocationResult }> = [
      { label: 'SUCCEEDED+fallback', input: { ...baseSucceeded, fallbackTriggered: true } },
      {
        label: 'DEGRADED+fallback',
        input: {
          ...baseSucceeded,
          status: 'DEGRADED' as const,
          fallbackTriggered: true,
          safeError: { code: 'D', message: 'm', category: 'UNAVAILABLE', retryable: false },
        },
      },
      {
        label: 'FAILED+fallback',
        input: {
          status: 'FAILED',
          structuredPayload: {},
          generatedMessages: [],
          artifactRefs: [],
          fallbackTriggered: true,
          safeError: { code: 'F', message: 'm', category: 'INTERNAL', retryable: false },
        },
      },
      {
        label: 'TIMED_OUT+fallback',
        input: {
          status: 'TIMED_OUT',
          structuredPayload: {},
          generatedMessages: [],
          artifactRefs: [],
          fallbackTriggered: true,
          safeError: { code: 'T', message: 'm', category: 'TIMEOUT', retryable: true },
        },
      },
    ];
    for (const { label, input } of cases) {
      const validation = validateCapabilityInvocationResult(input);
      expect(validation.ok, label).toBe(true);
      if (validation.ok) {
        expect(validation.result.status, `${label} status`).toBe(input.status);
        expect(validation.result.fallbackTriggered, `${label} fallbackTriggered`).toBe(true);
        expect(validation.result.safeError, `${label} safeError`).toEqual(input.safeError);
      }
    }
  });

  it('rejects TIMEOUT category on a FAILED status and non-TIMEOUT category on TIMED_OUT', () => {
    expect(validateCapabilityInvocationResult(baseFailed({ code: 'T', message: 'm', category: 'TIMEOUT', retryable: false }))).toEqual({
      ok: false,
      issue: 'STATUS_SAFE_ERROR_CONFLICT',
    });
    expect(
      validateCapabilityInvocationResult({
        status: 'TIMED_OUT',
        structuredPayload: {},
        generatedMessages: [],
        artifactRefs: [],
        safeError: { code: 'X', message: 'm', category: 'UNAVAILABLE', retryable: false },
      }),
    ).toEqual({ ok: false, issue: 'STATUS_SAFE_ERROR_CONFLICT' });
  });

  it('rejects any undeclared top-level field', () => {
    expect(validateCapabilityInvocationResult({ ...baseSucceeded, errorDiagnostics: {} })).toEqual({
      ok: false,
      issue: 'UNDECLARED_FIELD',
    });
    expect(validateCapabilityInvocationResult({ ...baseSucceeded, error: { code: 'X' } })).toEqual({ ok: false, issue: 'UNDECLARED_FIELD' });
  });

  it('rejects invalid status and malformed structuredPayload', () => {
    expect(validateCapabilityInvocationResult({ ...baseSucceeded, status: 'PENDING' })).toEqual({ ok: false, issue: 'INVALID_STATUS' });
    expect(validateCapabilityInvocationResult({ ...baseSucceeded, structuredPayload: [] })).toEqual({
      ok: false,
      issue: 'INVALID_STRUCTURED_PAYLOAD',
    });
  });

  it('validates SafeError fields strictly and rejects undeclared SafeError fields', () => {
    expect(validateCapabilityInvocationResult(baseFailed({ code: 'X', message: 'm', category: 'VALIDATION' }))).toEqual({
      ok: false,
      issue: 'INVALID_SAFE_ERROR',
    });
    expect(
      validateCapabilityInvocationResult(baseFailed({ code: 'X', message: 'm', category: 'VALIDATION', retryable: false, errorMessage: 'm' })),
    ).toEqual({ ok: false, issue: 'INVALID_SAFE_ERROR' });
  });

  it('accepts a complete SafeError with optional safeDetails', () => {
    const validation = validateCapabilityInvocationResult(
      baseFailed({ code: 'X', message: 'm', category: 'VALIDATION', retryable: false, safeDetails: { violations: [] } }),
    );
    expect(validation.ok).toBe(true);
  });

  it('validates generated messages role USER and opaque refs', () => {
    expect(validateCapabilityInvocationResult({ ...baseSucceeded, generatedMessages: [{ role: 'ASSISTANT', content: 'x' }] })).toEqual({
      ok: false,
      issue: 'INVALID_GENERATED_MESSAGES',
    });
    expect(validateCapabilityInvocationResult({ ...baseSucceeded, artifactRefs: [123] })).toEqual({
      ok: false,
      issue: 'INVALID_ARTIFACT_REFS',
    });
  });

  it('rejects a contextPatch with explicit null modelId', () => {
    const validation = validateCapabilityInvocationResult({ ...baseSucceeded, contextPatch: { modelId: null } });
    expect(validation).toEqual({ ok: false, issue: 'INVALID_CONTEXT_PATCH' });
  });

  it('rejects modelOptions carrying undeclared transport/timeout/retry fields', () => {
    const validation = validateCapabilityInvocationResult({
      ...baseSucceeded,
      contextPatch: { modelOptions: { timeoutMs: 30_000 } },
    });
    expect(validation).toEqual({ ok: false, issue: 'INVALID_CONTEXT_PATCH' });
    expect(
      validateCapabilityInvocationResult({
        ...baseSucceeded,
        contextPatch: { modelOptions: { providerOptions: {} } },
      }),
    ).toMatchObject({ ok: true });
  });

  it('rejects explicit null on any model option field', () => {
    const validation = validateCapabilityInvocationResult({
      ...baseSucceeded,
      contextPatch: { modelOptions: { temperature: null } },
    });
    expect(validation).toEqual({ ok: false, issue: 'INVALID_CONTEXT_PATCH' });
  });

  it('rejects thinking depth outside the closed enum', () => {
    const validation = validateCapabilityInvocationResult({
      ...baseSucceeded,
      contextPatch: { modelOptions: { thinking: { depth: 'EXTREME' } } },
    });
    expect(validation).toEqual({ ok: false, issue: 'INVALID_CONTEXT_PATCH' });
  });

  it('rejects a result whose structuredPayload is not JSON-serializable', () => {
    const circular: Record<string, unknown> = {};
    circular['self'] = circular;
    const validation = validateCapabilityInvocationResult({ ...baseSucceeded, structuredPayload: circular });
    expect(validation).toEqual({ ok: false, issue: 'NOT_SERIALIZABLE' });
  });

  it('rejects undefined values in object properties', () => {
    const validation = validateCapabilityInvocationResult({ ...baseSucceeded, structuredPayload: { dropped: undefined } });
    expect(validation).toEqual({ ok: false, issue: 'NOT_SERIALIZABLE' });
  });

  it('rejects undefined values in arrays', () => {
    const validation = validateCapabilityInvocationResult({ ...baseSucceeded, structuredPayload: { items: [1, undefined, 3] } });
    expect(validation).toEqual({ ok: false, issue: 'NOT_SERIALIZABLE' });
  });

  it('rejects an out-of-range temperature against the canonical model options schema', () => {
    const validation = validateCapabilityInvocationResult({
      ...baseSucceeded,
      contextPatch: { modelOptions: { temperature: 99 } },
    });
    expect(validation).toEqual({ ok: false, issue: 'INVALID_CONTEXT_PATCH' });
  });

  it('rejects a negative topP against the canonical model options schema', () => {
    const validation = validateCapabilityInvocationResult({
      ...baseSucceeded,
      contextPatch: { modelOptions: { topP: -1 } },
    });
    expect(validation).toEqual({ ok: false, issue: 'INVALID_CONTEXT_PATCH' });
  });

  it('rejects an empty modelId against the canonical model id schema', () => {
    const validation = validateCapabilityInvocationResult({
      ...baseSucceeded,
      contextPatch: { modelId: '' },
    });
    expect(validation).toEqual({ ok: false, issue: 'INVALID_CONTEXT_PATCH' });
  });

  it('rejects null entries in allowedTools', () => {
    const validation = validateCapabilityInvocationResult({
      ...baseSucceeded,
      contextPatch: { allowedTools: [null] },
    });
    expect(validation).toEqual({ ok: false, issue: 'INVALID_CONTEXT_PATCH' });
  });

  it('accepts a canonical contextPatch with allowedTools and modelOptions', () => {
    const validation = validateCapabilityInvocationResult({
      ...baseSucceeded,
      contextPatch: {
        allowedTools: ['Read'],
        modelId: 'test-model',
        modelOptions: { temperature: 0.5, maxOutputTokens: 512, providerOptions: {} },
      },
    });
    expect(validation).toMatchObject({ ok: true });
  });

  it('does not throw and rejects a result whose property getter throws', () => {
    const malicious: Record<string, unknown> = {};
    Object.defineProperty(malicious, 'boom', {
      enumerable: true,
      get() {
        throw new Error('THREW getter boom');
      },
    });
    const validation = validateCapabilityInvocationResult({ ...baseSucceeded, structuredPayload: malicious });
    expect(validation).toEqual({ ok: false, issue: 'NOT_SERIALIZABLE' });
  });

  it('rejects a sparse array inside structuredPayload', () => {
    const sparse: unknown[] = [];
    sparse.length = 2;
    const validation = validateCapabilityInvocationResult({ ...baseSucceeded, structuredPayload: { items: sparse } });
    expect(validation).toEqual({ ok: false, issue: 'NOT_SERIALIZABLE' });
  });

  it('rejects a Date as a JsonObject field', () => {
    const validation = validateCapabilityInvocationResult({ ...baseSucceeded, structuredPayload: { at: new Date() } });
    expect(validation).toEqual({ ok: false, issue: 'NOT_SERIALIZABLE' });
  });

  it('rejects Map and Set special objects', () => {
    expect(validateCapabilityInvocationResult({ ...baseSucceeded, structuredPayload: { map: new Map() } })).toEqual({
      ok: false,
      issue: 'NOT_SERIALIZABLE',
    });
    expect(validateCapabilityInvocationResult({ ...baseSucceeded, structuredPayload: { set: new Set() } })).toEqual({
      ok: false,
      issue: 'NOT_SERIALIZABLE',
    });
  });

  it('rejects a Proxy that throws during enumeration without throwing', () => {
    const target: Record<string, unknown> = {};
    const proxy = new Proxy(target, {
      ownKeys() {
        throw new Error('THREW ownKeys boom');
      },
    });
    const validation = validateCapabilityInvocationResult({ ...baseSucceeded, structuredPayload: { proxy } });
    expect(validation).toEqual({ ok: false, issue: 'NOT_SERIALIZABLE' });
  });

  it('returns a plain snapshot that is immune to a mutable getter changing between validation and serialization', () => {
    let reads = 0;
    const flaky: Record<string, unknown> = {};
    Object.defineProperty(flaky, 'value', {
      enumerable: true,
      get() {
        reads += 1;
        // First read returns a valid JSON string; any later read returns a
        // non-JSON value that JSON.stringify would silently drop.
        return reads === 1 ? 'valid' : undefined;
      },
    });
    const validation = validateCapabilityInvocationResult({ ...baseSucceeded, structuredPayload: { flaky } });
    expect(validation.ok).toBe(true);
    if (validation.ok) {
      const serialized = JSON.stringify(validation.result);
      expect(serialized).toContain('"valid"');
      expect(reads).toBe(1);
    }
  });

  it('rejects a mutable getter that returns undefined on its first read', () => {
    const bad: Record<string, unknown> = {};
    Object.defineProperty(bad, 'value', {
      enumerable: true,
      get() {
        return undefined;
      },
    });
    const validation = validateCapabilityInvocationResult({ ...baseSucceeded, structuredPayload: { bad } });
    expect(validation).toEqual({ ok: false, issue: 'NOT_SERIALIZABLE' });
  });

  it('terminates early when a large scalar array exceeds the byte budget', () => {
    const largeArray = Array.from({ length: 200_000 }, (_, i) => `item-${i}`);
    const validation = validateCapabilityInvocationResult({ ...baseSucceeded, structuredPayload: { items: largeArray } });
    expect(validation).toEqual({ ok: false, issue: 'RESULT_CAPACITY_EXCEEDED' });
  });

  it('counts internal result metadata toward the shared result capacity', () => {
    const sourceTrace = Array.from({ length: 200_000 }, (_, i) => ({
      longTermMemoryId: `ltm-${i}`,
      source: { runId: `run-${i}` },
    }));
    const validation = validateCapabilityInvocationResult({
      ...baseSucceeded,
      metadata: { sourceTrace },
    });
    expect(validation).toEqual({ ok: false, issue: 'RESULT_CAPACITY_EXCEEDED' });
  });

  it('terminates early when node count exceeds the budget', () => {
    const nested: Record<string, unknown> = {};
    let current: Record<string, unknown> = nested;
    for (let i = 0; i < 11_000; i += 1) {
      const child: Record<string, unknown> = { v: i };
      current['n'] = child;
      current = child;
    }
    const validation = validateCapabilityInvocationResult({ ...baseSucceeded, structuredPayload: nested });
    expect(validation).toEqual({ ok: false, issue: 'RESULT_CAPACITY_EXCEEDED' });
  });

  it('terminates early when nesting depth exceeds the budget', () => {
    let nested: unknown = 'leaf';
    for (let i = 0; i < 70; i += 1) {
      nested = { v: nested };
    }
    const validation = validateCapabilityInvocationResult({ ...baseSucceeded, structuredPayload: { deep: nested } });
    expect(validation).toEqual({ ok: false, issue: 'RESULT_CAPACITY_EXCEEDED' });
  });
});
