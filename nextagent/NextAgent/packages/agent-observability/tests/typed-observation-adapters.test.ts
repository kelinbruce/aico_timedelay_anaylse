import { AgentError, bindRuntimeLoggerProvider, brand, type RuntimeLogger, type RuntimeLoggerProviderBinding } from '@nextagent/agent-common';
import type { ContextAssemblyRequest, ContextEnginePort } from '@nextagent/agent-contracts/context';
import { afterEach, describe, expect, it } from 'vitest';
import { createObservedContextEngine, emitAppLifecycleObservation } from '../src/index.js';

let loggerBinding: RuntimeLoggerProviderBinding | undefined;
afterEach(() => loggerBinding?.unbind());

describe('typed observation adapters', () => {
  it('keeps app lifecycle results independent from observation sink failures', () => {
    expect(() =>
      emitAppLifecycleObservation({
        projectorHost: {
          acceptObservation() {
            throw new Error('observation sink unavailable');
          },
        },
        ownerScope: {
          tenantId: brand<string, 'TenantId'>('tenant-app-lifecycle'),
          subjectId: brand<string, 'SubjectId'>('subject-app-lifecycle'),
          agentId: brand<string, 'AgentId'>('agent-app-lifecycle'),
          agentVersion: brand<string, 'AgentVersion'>('v1'),
        },
        operation: 'APP_START',
        safeReasonCode: 'APP_STARTED',
      }),
    ).not.toThrow();
  });

  it('preserves the canonical context failure and leaves exception logging to the request termination owner', async () => {
    const failure = new TypeError('provider-body-canary');
    const observations: unknown[] = [];
    const diagnostics: Array<{ readonly caught?: unknown; readonly fields: object }> = [];
    bindCaptureLogger(diagnostics);
    const observed = createObservedContextEngine(failingContextEngine(failure), {
      acceptObservation: (event) => observations.push(event),
    });

    await expect(observed.assemble(contextRequest(), undefined, new AbortController().signal)).rejects.toBe(failure);

    expect(observations).toEqual([
      expect.objectContaining({
        operation: 'CONTEXT_ASSEMBLY_FAILED',
        outcome: 'failure',
        safeReasonCode: 'UNEXPECTED_ERROR',
        stableRefs: expect.objectContaining({ requestRunId: 'run-context', requestContextId: 'context-1' }),
      }),
    ]);
    expect(diagnostics).toEqual([]);
  });

  it('does not log an expected safe failure while propagating it', async () => {
    const failure = new AgentError({
      code: 'CONTEXT_INPUT_INVALID',
      message: 'Context input is invalid.',
      category: 'VALIDATION',
      retryable: false,
    });
    const observations: unknown[] = [];
    const diagnostics: Array<{ readonly caught?: unknown; readonly fields: object }> = [];
    bindCaptureLogger(diagnostics);
    const observed = createObservedContextEngine(failingContextEngine(failure), {
      acceptObservation: (event) => observations.push(event),
    });

    await expect(observed.assemble(contextRequest(), undefined, new AbortController().signal)).rejects.toBe(failure);

    expect(observations).toEqual([expect.objectContaining({ operation: 'CONTEXT_ASSEMBLY_FAILED', safeReasonCode: 'CONTEXT_INPUT_INVALID' })]);
    expect(diagnostics).toEqual([]);
  });
});

function failingContextEngine(failure: Error): ContextEnginePort {
  return {
    async assemble() {
      throw failure;
    },
    async render() {
      throw new Error('render is not used by this test');
    },
  };
}

function contextRequest(): ContextAssemblyRequest {
  return {
    sessionId: brand<string, 'SessionId'>('session-context'),
    requestId: brand<string, 'MessageId'>('request-context'),
    requestContextId: brand<string, 'RequestContextId'>('context-1'),
    identityContext: {
      tenantId: brand<string, 'TenantId'>('tenant-context'),
      subjectId: brand<string, 'SubjectId'>('subject-context'),
      displayName: 'Context operator',
    },
    agentId: brand<string, 'AgentId'>('agent-context'),
    agentVersion: brand<string, 'AgentVersion'>('v1'),
    runId: brand<string, 'RequestRunId'>('run-context'),
    stepId: 'step-context',
    locale: brand<string, 'RequestLocale'>('zh-CN'),
    purpose: 'test',
  };
}

function captureLogger(entries: Array<{ readonly caught?: unknown; readonly fields: object }>): RuntimeLogger {
  const captureFailure = (fields: object): void => {
    const record = fields as Record<string, unknown>;
    const { err, ...safeFields } = record;
    entries.push({ ...(err === undefined ? {} : { caught: err }), fields: safeFields });
  };
  return {
    error: captureFailure,
    warn: captureFailure,
    info: (fields) => entries.push({ fields }),
    debug: (fields) => entries.push({ fields }),
  };
}

function bindCaptureLogger(entries: Array<{ readonly caught?: unknown; readonly fields: object }>): void {
  loggerBinding = bindRuntimeLoggerProvider({ getLogger: () => captureLogger(entries) });
}
