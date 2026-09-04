import { createNextAgentTestApp } from '@nextagent/agent-platform-gateway-local/testing';
import { AgentError, brand } from '@nextagent/agent-common';
import type { HookInput, HookResult, LifecycleHookDefinition } from '@nextagent/agent-contracts/runtime';
import { RegisteredLifecycleHookExecutor, type RuntimeLifecycleHookExecutor } from '@nextagent/agent-runtime';
import { afterEach, describe, expect, it } from 'vitest';
import type { AgentHookActivation } from '@nextagent/agent-contracts/agent-assembly';
import {
  agentId,
  apps,
  closeLifecycleHookApps,
  identity,
  listTimelineEvents,
  waitFor,
  waitForAuditEvent,
  waitForTimelineEvent,
} from './lifecycle-hook-test-helpers.js';

afterEach(async () => {
  await closeLifecycleHookApps();
});

describe('lifecycle hook execution failures', () => {
  it('continues when an unavailable hook uses CONTINUE failure mode and leaves failed hook evidence', async () => {
    const lifecycleHook: RuntimeLifecycleHookExecutor = {
      async invoke(input: HookInput): Promise<HookResult> {
        if (input.hookId === 'missing-implementation') {
          throw new AgentError({
            code: 'LIFECYCLE_HOOK_UNAVAILABLE',
            message: 'Lifecycle hook executor is unavailable.',
            category: 'VALIDATION',
            retryable: false,
          });
        }
        return { outcome: 'PASS' };
      },
    };
    const definitions: readonly LifecycleHookDefinition[] = [
      {
        hookId: 'missing-implementation',
        kind: 'CUSTOM',
        supportedStages: ['BEFORE_AGENT_TERMINAL'],
        effects: ['TRANSFORM', 'CONTROL'],
        executionStrategy: 'SERIAL_IMPACT',
        failureMode: 'CONTINUE',
      },
    ];
    const bindings: readonly AgentHookActivation[] = [
      {
        hookId: 'missing-implementation',
        enabled: true,
      },
    ];
    const app = createNextAgentTestApp({
      workspaceDir: process.cwd(),
      modelSteps: [{ content: 'continue after unavailable hook' }],
      identity,
      lifecycleHook,
      lifecycleHookDefinitions: definitions,
      hooks: bindings,
    });
    apps.push(app);
    const session = await app.runtime.createSession({
      identityContext: identity,
      locale: brand<string, 'RequestLocale'>('zh-CN'),
      idempotencyKey: brand<string, 'IdempotencyKey'>('idem-lifecycle-unavailable-session'),
    });

    const accepted = await app.runtime.submit({
      sessionId: session.sessionId,
      identityContext: identity,
      inputText: 'run continue path',
      attachmentIds: [],
      locale: brand<string, 'RequestLocale'>('zh-CN'),
      idempotencyKey: brand<string, 'IdempotencyKey'>('idem-lifecycle-unavailable-submit'),
    });

    await waitForTimelineEvent(app, session.sessionId, accepted.runId, 'REQUEST_COMPLETED');
    await expect(
      waitForAuditEvent(
        app,
        'hook.invoked',
        5_000,
        (event) =>
          event.requestRunId === accepted.runId &&
          event.attributes['outcome'] === 'failure' &&
          event.attributes['safeReasonCode'] === 'LIFECYCLE_HOOK_UNAVAILABLE',
      ),
    ).resolves.toMatchObject({
      requestRunId: accepted.runId,
      attributes: expect.objectContaining({
        operation: 'HOOK_INVOKED',
        outcome: 'failure',
        safeReasonCode: 'LIFECYCLE_HOOK_UNAVAILABLE',
      }),
    });
  });

  it('continues when a hook times out under CONTINUE failure mode', async () => {
    let observedAbort = false;
    const lifecycleHook: RuntimeLifecycleHookExecutor = {
      async invoke(_input: HookInput, signal?: AbortSignal): Promise<HookResult> {
        signal?.addEventListener(
          'abort',
          () => {
            observedAbort = true;
          },
          { once: true },
        );
        return await new Promise<HookResult>(() => {});
      },
    };
    const definitions: readonly LifecycleHookDefinition[] = [
      {
        hookId: 'timeout-continue',
        kind: 'CUSTOM',
        supportedStages: ['BEFORE_REQUEST_ACCEPT'],
        effects: ['TRANSFORM', 'CONTROL'],
        executionStrategy: 'SERIAL_IMPACT',
        failureMode: 'CONTINUE',
        timeoutMs: 10,
      },
    ];
    const bindings: readonly AgentHookActivation[] = [
      {
        hookId: 'timeout-continue',
        enabled: true,
      },
    ];
    const app = createNextAgentTestApp({
      workspaceDir: process.cwd(),
      modelSteps: [{ content: 'continue after timeout' }],
      identity,
      lifecycleHook,
      lifecycleHookDefinitions: definitions,
      hooks: bindings,
    });
    apps.push(app);
    const session = await app.runtime.createSession({
      identityContext: identity,
      locale: brand<string, 'RequestLocale'>('zh-CN'),
      idempotencyKey: brand<string, 'IdempotencyKey'>('idem-lifecycle-timeout-continue-session'),
    });

    const accepted = await app.runtime.submit({
      sessionId: session.sessionId,
      identityContext: identity,
      inputText: 'run timeout continue path',
      attachmentIds: [],
      locale: brand<string, 'RequestLocale'>('zh-CN'),
      idempotencyKey: brand<string, 'IdempotencyKey'>('idem-lifecycle-timeout-continue-submit'),
    });

    const completed = await waitForTimelineEvent(app, session.sessionId, accepted.runId, 'REQUEST_COMPLETED');
    expect(completed.inlinePayload['content']).toBe('continue after timeout');
    await expect(
      waitForAuditEvent(
        app,
        'hook.invoked',
        5_000,
        (event) =>
          event.requestRunId === accepted.runId &&
          event.attributes['outcome'] === 'timeout' &&
          event.attributes['safeReasonCode'] === 'LIFECYCLE_HOOK_TIMEOUT',
      ),
    ).resolves.toMatchObject({
      requestRunId: accepted.runId,
      attributes: expect.objectContaining({
        operation: 'HOOK_INVOKED',
        outcome: 'timeout',
        safeReasonCode: 'LIFECYCLE_HOOK_TIMEOUT',
      }),
    });
    expect(observedAbort).toBe(true);
  });

  it('propagates stage owner abort signal to runtime hook executables', async () => {
    let observedSignal: AbortSignal | undefined;
    let observedAbort = false;
    const lifecycleHook: RuntimeLifecycleHookExecutor = {
      async invoke(_input: HookInput, signal?: AbortSignal): Promise<HookResult> {
        observedSignal = signal;
        signal?.addEventListener(
          'abort',
          () => {
            observedAbort = true;
          },
          { once: true },
        );
        return await new Promise<HookResult>(() => {});
      },
    };
    const definitions: readonly LifecycleHookDefinition[] = [
      {
        hookId: 'owner-abort',
        kind: 'CUSTOM',
        supportedStages: ['BEFORE_REQUEST_ACCEPT'],
        effects: ['TRANSFORM', 'CONTROL'],
        executionStrategy: 'SERIAL_IMPACT',
        failureMode: 'CONTINUE',
        timeoutMs: 30_000,
      },
    ];
    const app = createNextAgentTestApp({
      workspaceDir: process.cwd(),
      modelSteps: [{ content: 'not used' }],
      identity,
      lifecycleHook,
      lifecycleHookDefinitions: definitions,
      hooks: [{ hookId: 'owner-abort', enabled: true }],
    });
    apps.push(app);
    const controller = new AbortController();
    const invocation = app.runtime.lifecycleHookInvocationPort().invoke(
      {
        stage: 'BEFORE_REQUEST_ACCEPT',
        coordinates: {
          agentId,
          agentVersion: brand<string, 'AgentVersion'>('v1'),
          agentAssemblyRef: 'default-agent:v1',
          stageOccurrenceKey: 'accept:owner-abort',
        },
        ownerScope: {
          tenantId: identity.tenantId,
          subjectId: identity.subjectId,
        },
        boundary: {
          locale: brand<string, 'RequestLocale'>('zh-CN'),
          attachmentCount: 0,
          idempotencyKeyPresent: true,
          safeRequestClass: 'TEXT_ONLY',
        },
      },
      controller.signal,
    );

    await waitFor(() => observedSignal !== undefined);
    controller.abort();

    await expect(invocation).rejects.toMatchObject({ code: 'LIFECYCLE_HOOK_ABORTED' } satisfies Partial<AgentError>);
    expect(observedSignal?.aborted).toBe(true);
    expect(observedAbort).toBe(true);
  });

  it('fails when a hook times out under FAIL failure mode', async () => {
    let observedAbort = false;
    const lifecycleHook: RuntimeLifecycleHookExecutor = {
      async invoke(_input: HookInput, signal?: AbortSignal): Promise<HookResult> {
        signal?.addEventListener(
          'abort',
          () => {
            observedAbort = true;
          },
          { once: true },
        );
        return await new Promise<HookResult>(() => {});
      },
    };
    const definitions: readonly LifecycleHookDefinition[] = [
      {
        hookId: 'timeout-fail',
        kind: 'CUSTOM',
        supportedStages: ['BEFORE_REQUEST_ACCEPT'],
        effects: ['TRANSFORM', 'CONTROL'],
        executionStrategy: 'SERIAL_IMPACT',
        failureMode: 'FAIL',
        timeoutMs: 10,
      },
    ];
    const bindings: readonly AgentHookActivation[] = [
      {
        hookId: 'timeout-fail',
        enabled: true,
      },
    ];
    const app = createNextAgentTestApp({
      workspaceDir: process.cwd(),
      modelSteps: [{ content: 'should not complete' }],
      identity,
      lifecycleHook,
      lifecycleHookDefinitions: definitions,
      hooks: bindings,
    });
    apps.push(app);
    const session = await app.runtime.createSession({
      identityContext: identity,
      locale: brand<string, 'RequestLocale'>('zh-CN'),
      idempotencyKey: brand<string, 'IdempotencyKey'>('idem-lifecycle-timeout-fail-session'),
    });

    await expect(
      app.runtime.submit({
        sessionId: session.sessionId,
        identityContext: identity,
        inputText: 'run timeout fail path',
        attachmentIds: [],
        locale: brand<string, 'RequestLocale'>('zh-CN'),
        idempotencyKey: brand<string, 'IdempotencyKey'>('idem-lifecycle-timeout-fail-submit'),
      }),
    ).rejects.toMatchObject({ code: 'LIFECYCLE_HOOK_TIMEOUT' });
    expect(observedAbort).toBe(true);
  });

  it('fails when a hook throws under FAIL failure mode and leaves failed hook evidence', async () => {
    const lifecycleHook: RuntimeLifecycleHookExecutor = {
      async invoke(input: HookInput): Promise<HookResult> {
        if (input.stage === 'BEFORE_AGENT_TERMINAL') {
          throw new Error('hook boom');
        }
        return { outcome: 'PASS' };
      },
    };
    const definitions: readonly LifecycleHookDefinition[] = [
      {
        hookId: 'throw-fail',
        kind: 'CUSTOM',
        supportedStages: ['BEFORE_AGENT_TERMINAL'],
        effects: ['TRANSFORM', 'CONTROL'],
        executionStrategy: 'SERIAL_IMPACT',
        failureMode: 'FAIL',
      },
    ];
    const bindings: readonly AgentHookActivation[] = [
      {
        hookId: 'throw-fail',
        enabled: true,
      },
    ];
    const app = createNextAgentTestApp({
      workspaceDir: process.cwd(),
      modelSteps: [{ content: 'throw fail path' }],
      identity,
      lifecycleHook,
      lifecycleHookDefinitions: definitions,
      hooks: bindings,
    });
    apps.push(app);
    const session = await app.runtime.createSession({
      identityContext: identity,
      locale: brand<string, 'RequestLocale'>('zh-CN'),
      idempotencyKey: brand<string, 'IdempotencyKey'>('idem-lifecycle-throw-fail-session'),
    });

    const accepted = await app.runtime.submit({
      sessionId: session.sessionId,
      identityContext: identity,
      inputText: 'run throw fail path',
      attachmentIds: [],
      locale: brand<string, 'RequestLocale'>('zh-CN'),
      idempotencyKey: brand<string, 'IdempotencyKey'>('idem-lifecycle-throw-fail-submit'),
    });

    await waitForTimelineEvent(app, session.sessionId, accepted.runId, 'REQUEST_FAILED');
    await expect(
      waitForAuditEvent(
        app,
        'hook.invoked',
        5_000,
        (event) =>
          event.requestRunId === accepted.runId &&
          event.attributes['outcome'] === 'failure' &&
          event.attributes['safeReasonCode'] === 'LIFECYCLE_HOOK_FAILED',
      ),
    ).resolves.toMatchObject({
      requestRunId: accepted.runId,
      attributes: expect.objectContaining({
        operation: 'HOOK_INVOKED',
        outcome: 'failure',
        safeReasonCode: 'LIFECYCLE_HOOK_FAILED',
      }),
    });
  });

  it('continues when an invalid hook result uses CONTINUE failure mode', async () => {
    const lifecycleHook: RuntimeLifecycleHookExecutor = {
      async invoke(input: HookInput): Promise<HookResult> {
        if (input.stage === 'BEFORE_REQUEST_ACCEPT') {
          const mutation = {
            kind: 'TERMINAL_EVENT',
            replaceSafeTerminalSummary: 'should-not-apply',
          };
          return {
            outcome: 'PASS',
            mutation: mutation as never,
          };
        }
        return { outcome: 'PASS' };
      },
    };
    const definitions: readonly LifecycleHookDefinition[] = [
      {
        hookId: 'invalid-mutation-continue',
        kind: 'CUSTOM',
        supportedStages: ['BEFORE_REQUEST_ACCEPT'],
        effects: ['TRANSFORM', 'CONTROL'],
        executionStrategy: 'SERIAL_IMPACT',
        failureMode: 'CONTINUE',
      },
    ];
    const bindings: readonly AgentHookActivation[] = [
      {
        hookId: 'invalid-mutation-continue',
        enabled: true,
      },
    ];
    const app = createNextAgentTestApp({
      workspaceDir: process.cwd(),
      modelSteps: [{ content: 'continue after invalid mutation' }],
      identity,
      lifecycleHook,
      lifecycleHookDefinitions: definitions,
      hooks: bindings,
    });
    apps.push(app);
    const session = await app.runtime.createSession({
      identityContext: identity,
      locale: brand<string, 'RequestLocale'>('zh-CN'),
      idempotencyKey: brand<string, 'IdempotencyKey'>('idem-lifecycle-invalid-mutation-continue-session'),
    });

    const accepted = await app.runtime.submit({
      sessionId: session.sessionId,
      identityContext: identity,
      inputText: 'run invalid mutation continue path',
      attachmentIds: [],
      locale: brand<string, 'RequestLocale'>('zh-CN'),
      idempotencyKey: brand<string, 'IdempotencyKey'>('idem-lifecycle-invalid-mutation-continue-submit'),
    });

    const completed = await waitForTimelineEvent(app, session.sessionId, accepted.runId, 'REQUEST_COMPLETED');
    expect(completed.inlinePayload['content']).toBe('continue after invalid mutation');
    await expect(
      waitForAuditEvent(
        app,
        'hook.invoked',
        5_000,
        (event) =>
          event.requestRunId === accepted.runId &&
          event.attributes['outcome'] === 'failure' &&
          event.attributes['safeReasonCode'] === 'LIFECYCLE_HOOK_RESULT_INVALID',
      ),
    ).resolves.toMatchObject({
      requestRunId: accepted.runId,
      attributes: expect.objectContaining({
        operation: 'HOOK_INVOKED',
        outcome: 'failure',
        safeReasonCode: 'LIFECYCLE_HOOK_RESULT_INVALID',
      }),
    });

    const events = await listTimelineEvents(app, session.sessionId, accepted.runId);
    const hookEvent = events.find((event) => event.type === 'HOOK_INVOKED' && event.inlinePayload['hookId'] === 'invalid-mutation-continue');
    expect(hookEvent?.inlinePayload).toMatchObject({
      status: 'INVALID_RESULT',
      failureMode: 'CONTINUE',
    });
    expect(hookEvent?.inlinePayload).not.toHaveProperty('outcome');
    expect(hookEvent?.inlinePayload).not.toHaveProperty('resultSummary');
  });

  it.each([
    ['null', null],
    ['array', [1, 2]],
    ['undefined member', { a: undefined }],
    ['NaN member', { a: Number.NaN }],
    ['Infinity member', { a: Number.POSITIVE_INFINITY }],
    ['bigint member', { a: BigInt(1) }],
    ['function member', { a: () => 'value' }],
    ['symbol member', { a: Symbol('value') }],
    ['date member', { a: new Date(0) }],
    ['sparse array member', { a: Array(1) }],
  ])('rejects %s resultSummary before applying the Hook result', async (caseName, resultSummary) => {
    await expectInvalidResultSummary(resultSummary, caseName.replaceAll(' ', '-'));
  });

  it('rejects a cyclic resultSummary before applying the Hook result', async () => {
    const cyclic: Record<string, unknown> = {};
    cyclic['self'] = cyclic;
    await expectInvalidResultSummary(cyclic, 'cyclic');
  });

  it('rejects resultSummary when the complete HOOK_INVOKED payload exceeds the existing limit', async () => {
    await expectInvalidResultSummary({ output: 'x'.repeat(49_000) }, 'oversized');
  });

  it('fails when a hook result omits canonical outcome under FAIL failure mode', async () => {
    const lifecycleHook: RuntimeLifecycleHookExecutor = {
      async invoke(input: HookInput): Promise<HookResult> {
        if (input.stage === 'BEFORE_REQUEST_ACCEPT') {
          return {} as HookResult;
        }
        return { outcome: 'PASS' };
      },
    };
    const definitions: readonly LifecycleHookDefinition[] = [
      {
        hookId: 'missing-outcome-fail',
        kind: 'CUSTOM',
        supportedStages: ['BEFORE_REQUEST_ACCEPT'],
        effects: ['TRANSFORM', 'CONTROL'],
        executionStrategy: 'SERIAL_IMPACT',
        failureMode: 'FAIL',
      },
    ];
    const bindings: readonly AgentHookActivation[] = [
      {
        hookId: 'missing-outcome-fail',
        enabled: true,
      },
    ];
    const app = createNextAgentTestApp({
      workspaceDir: process.cwd(),
      modelSteps: [{ content: 'should not reach model' }],
      identity,
      lifecycleHook,
      lifecycleHookDefinitions: definitions,
      hooks: bindings,
    });
    apps.push(app);
    const session = await app.runtime.createSession({
      identityContext: identity,
      locale: brand<string, 'RequestLocale'>('zh-CN'),
      idempotencyKey: brand<string, 'IdempotencyKey'>('idem-lifecycle-missing-outcome-fail-session'),
    });

    await expect(
      app.runtime.submit({
        sessionId: session.sessionId,
        identityContext: identity,
        inputText: 'run missing outcome fail path',
        attachmentIds: [],
        locale: brand<string, 'RequestLocale'>('zh-CN'),
        idempotencyKey: brand<string, 'IdempotencyKey'>('idem-lifecycle-missing-outcome-fail-submit'),
      }),
    ).rejects.toMatchObject({ code: 'LIFECYCLE_HOOK_RESULT_INVALID' });
  });

  it('fails when a binding references missing hook code registration under FAIL failure mode', async () => {
    const definitions: readonly LifecycleHookDefinition[] = [
      {
        hookId: 'missing-registration-fail',
        kind: 'CUSTOM',
        supportedStages: ['BEFORE_REQUEST_ACCEPT'],
        effects: ['TRANSFORM', 'CONTROL'],
        executionStrategy: 'SERIAL_IMPACT',
        failureMode: 'FAIL',
      },
    ];
    const bindings: readonly AgentHookActivation[] = [
      {
        hookId: 'missing-registration-fail',
        enabled: true,
      },
    ];
    const app = createNextAgentTestApp({
      workspaceDir: process.cwd(),
      modelSteps: [{ content: 'should not reach model' }],
      identity,
      lifecycleHook: new RegisteredLifecycleHookExecutor({}),
      lifecycleHookDefinitions: definitions,
      hooks: bindings,
    });
    apps.push(app);
    const session = await app.runtime.createSession({
      identityContext: identity,
      locale: brand<string, 'RequestLocale'>('zh-CN'),
      idempotencyKey: brand<string, 'IdempotencyKey'>('idem-lifecycle-missing-registration-fail-session'),
    });

    await expect(
      app.runtime.submit({
        sessionId: session.sessionId,
        identityContext: identity,
        inputText: 'run missing registration fail path',
        attachmentIds: [],
        locale: brand<string, 'RequestLocale'>('zh-CN'),
        idempotencyKey: brand<string, 'IdempotencyKey'>('idem-lifecycle-missing-registration-fail-submit'),
      }),
    ).rejects.toMatchObject({ code: 'LIFECYCLE_HOOK_UNAVAILABLE' });
  });

  it('continues when a binding references missing hook code registration under CONTINUE failure mode', async () => {
    const definitions: readonly LifecycleHookDefinition[] = [
      {
        hookId: 'missing-registration-continue',
        kind: 'CUSTOM',
        supportedStages: ['BEFORE_REQUEST_ACCEPT'],
        effects: ['TRANSFORM', 'CONTROL'],
        executionStrategy: 'SERIAL_IMPACT',
        failureMode: 'CONTINUE',
      },
    ];
    const bindings: readonly AgentHookActivation[] = [
      {
        hookId: 'missing-registration-continue',
        enabled: true,
      },
    ];
    const app = createNextAgentTestApp({
      workspaceDir: process.cwd(),
      modelSteps: [{ content: 'continue after missing registration' }],
      identity,
      lifecycleHook: new RegisteredLifecycleHookExecutor({}),
      lifecycleHookDefinitions: definitions,
      hooks: bindings,
    });
    apps.push(app);
    const session = await app.runtime.createSession({
      identityContext: identity,
      locale: brand<string, 'RequestLocale'>('zh-CN'),
      idempotencyKey: brand<string, 'IdempotencyKey'>('idem-lifecycle-missing-registration-continue-session'),
    });

    const accepted = await app.runtime.submit({
      sessionId: session.sessionId,
      identityContext: identity,
      inputText: 'run missing registration continue path',
      attachmentIds: [],
      locale: brand<string, 'RequestLocale'>('zh-CN'),
      idempotencyKey: brand<string, 'IdempotencyKey'>('idem-lifecycle-missing-registration-continue-submit'),
    });

    const completed = await waitForTimelineEvent(app, session.sessionId, accepted.runId, 'REQUEST_COMPLETED');
    expect(completed.inlinePayload['content']).toBe('continue after missing registration');
    await expect(
      waitForAuditEvent(
        app,
        'hook.invoked',
        5_000,
        (event) =>
          event.requestRunId === accepted.runId &&
          event.attributes['outcome'] === 'failure' &&
          event.attributes['safeReasonCode'] === 'LIFECYCLE_HOOK_UNAVAILABLE',
      ),
    ).resolves.toMatchObject({
      requestRunId: accepted.runId,
      attributes: expect.objectContaining({
        operation: 'HOOK_INVOKED',
        outcome: 'failure',
        safeReasonCode: 'LIFECYCLE_HOOK_UNAVAILABLE',
      }),
    });
  });

  it('treats unsupported mutation as an invalid hook result', async () => {
    const lifecycleHook: RuntimeLifecycleHookExecutor = {
      async invoke(input: HookInput): Promise<HookResult> {
        if (input.stage === 'BEFORE_REQUEST_ACCEPT') {
          const mutation = {
            kind: 'TERMINAL_EVENT',
            replaceSafeTerminalSummary: 'should-not-apply',
          };
          return {
            outcome: 'PASS',
            mutation: mutation as never,
          };
        }
        return { outcome: 'PASS' };
      },
    };
    const definitions: readonly LifecycleHookDefinition[] = [
      {
        hookId: 'invalid-mutation',
        kind: 'CUSTOM',
        supportedStages: ['BEFORE_REQUEST_ACCEPT'],
        effects: ['TRANSFORM', 'CONTROL'],
        executionStrategy: 'SERIAL_IMPACT',
        failureMode: 'FAIL',
      },
    ];
    const bindings: readonly AgentHookActivation[] = [
      {
        hookId: 'invalid-mutation',
        enabled: true,
      },
    ];
    const app = createNextAgentTestApp({
      workspaceDir: process.cwd(),
      modelSteps: [{ content: 'ok' }],
      identity,
      lifecycleHook,
      lifecycleHookDefinitions: definitions,
      hooks: bindings,
    });
    apps.push(app);
    const session = await app.runtime.createSession({
      identityContext: identity,
      locale: brand<string, 'RequestLocale'>('zh-CN'),
      idempotencyKey: brand<string, 'IdempotencyKey'>('idem-lifecycle-invalid-mutation-session'),
    });

    await expect(
      app.runtime.submit({
        sessionId: session.sessionId,
        identityContext: identity,
        inputText: 'run invalid mutation path',
        attachmentIds: [],
        locale: brand<string, 'RequestLocale'>('zh-CN'),
        idempotencyKey: brand<string, 'IdempotencyKey'>('idem-lifecycle-invalid-mutation-submit'),
      }),
    ).rejects.toMatchObject({ code: 'LIFECYCLE_HOOK_RESULT_INVALID' });
  });

  it('fails closed when an observe-only hook declares order targeting an impact hook', () => {
    const definitions: readonly LifecycleHookDefinition[] = [
      {
        hookId: 'observe-audit',
        kind: 'CUSTOM',
        supportedStages: ['BEFORE_REQUEST_ACCEPT'],
        effects: ['OBSERVE'],
        executionStrategy: 'OBSERVE_PARALLEL',
        failureMode: 'CONTINUE',
      },
      {
        hookId: 'impact-guard',
        kind: 'CUSTOM',
        supportedStages: ['BEFORE_REQUEST_ACCEPT'],
        effects: ['TRANSFORM', 'CONTROL'],
        executionStrategy: 'SERIAL_IMPACT',
        failureMode: 'FAIL',
      },
    ];
    const bindings: readonly AgentHookActivation[] = [
      { hookId: 'observe-audit', enabled: true, order: { before: 'impact-guard' } },
      { hookId: 'impact-guard', enabled: true },
    ];

    expect(() =>
      createNextAgentTestApp({
        workspaceDir: process.cwd(),
        modelSteps: [{ content: 'should not start' }],
        identity,
        lifecycleHook: {
          async invoke(): Promise<HookResult> {
            return { outcome: 'PASS' };
          },
        },
        lifecycleHookDefinitions: definitions,
        hooks: bindings,
      }),
    ).toThrow(expect.objectContaining({ code: 'LIFECYCLE_HOOK_ORDER_CROSS_EFFECT_GROUP' }));
  });

  it('fails closed when an impact hook declares order targeting an observe-only hook', () => {
    const definitions: readonly LifecycleHookDefinition[] = [
      {
        hookId: 'observe-audit',
        kind: 'CUSTOM',
        supportedStages: ['BEFORE_REQUEST_ACCEPT'],
        effects: ['OBSERVE'],
        executionStrategy: 'OBSERVE_PARALLEL',
        failureMode: 'CONTINUE',
      },
      {
        hookId: 'impact-guard',
        kind: 'CUSTOM',
        supportedStages: ['BEFORE_REQUEST_ACCEPT'],
        effects: ['TRANSFORM', 'CONTROL'],
        executionStrategy: 'SERIAL_IMPACT',
        failureMode: 'FAIL',
      },
    ];
    const bindings: readonly AgentHookActivation[] = [
      { hookId: 'observe-audit', enabled: true },
      { hookId: 'impact-guard', enabled: true, order: { after: 'observe-audit' } },
    ];

    expect(() =>
      createNextAgentTestApp({
        workspaceDir: process.cwd(),
        modelSteps: [{ content: 'should not start' }],
        identity,
        lifecycleHook: {
          async invoke(): Promise<HookResult> {
            return { outcome: 'PASS' };
          },
        },
        lifecycleHookDefinitions: definitions,
        hooks: bindings,
      }),
    ).toThrow(expect.objectContaining({ code: 'LIFECYCLE_HOOK_ORDER_CROSS_EFFECT_GROUP' }));
  });

  it('fails closed when an impact hook order target is unknown', () => {
    const definitions: readonly LifecycleHookDefinition[] = [
      {
        hookId: 'impact-guard',
        kind: 'CUSTOM',
        supportedStages: ['BEFORE_REQUEST_ACCEPT'],
        effects: ['TRANSFORM', 'CONTROL'],
        executionStrategy: 'SERIAL_IMPACT',
        failureMode: 'FAIL',
      },
    ];
    const bindings: readonly AgentHookActivation[] = [{ hookId: 'impact-guard', enabled: true, order: { before: 'nonexistent-hook' } }];

    expect(() =>
      createNextAgentTestApp({
        workspaceDir: process.cwd(),
        modelSteps: [{ content: 'should not start' }],
        identity,
        lifecycleHook: {
          async invoke(): Promise<HookResult> {
            return { outcome: 'PASS' };
          },
        },
        lifecycleHookDefinitions: definitions,
        hooks: bindings,
      }),
    ).toThrow(expect.objectContaining({ code: 'LIFECYCLE_HOOK_ORDER_TARGET_UNKNOWN' }));
  });

  it('fails closed when an order target is disabled', () => {
    const definitions: readonly LifecycleHookDefinition[] = [
      {
        hookId: 'impact-a',
        kind: 'CUSTOM',
        supportedStages: ['BEFORE_REQUEST_ACCEPT'],
        effects: ['TRANSFORM', 'CONTROL'],
        executionStrategy: 'SERIAL_IMPACT',
        failureMode: 'FAIL',
      },
      {
        hookId: 'impact-b',
        kind: 'CUSTOM',
        supportedStages: ['BEFORE_REQUEST_ACCEPT'],
        effects: ['TRANSFORM', 'CONTROL'],
        executionStrategy: 'SERIAL_IMPACT',
        failureMode: 'FAIL',
      },
    ];
    const bindings: readonly AgentHookActivation[] = [
      { hookId: 'impact-a', enabled: true, order: { before: 'impact-b' } },
      { hookId: 'impact-b', enabled: false },
    ];

    expect(() =>
      createNextAgentTestApp({
        workspaceDir: process.cwd(),
        modelSteps: [{ content: 'should not start' }],
        identity,
        lifecycleHook: {
          async invoke(): Promise<HookResult> {
            return { outcome: 'PASS' };
          },
        },
        lifecycleHookDefinitions: definitions,
        hooks: bindings,
      }),
    ).toThrow(expect.objectContaining({ code: 'LIFECYCLE_HOOK_ORDER_TARGET_DISABLED' }));
  });

  it('fails closed when a custom hook declares order targeting a system hook', () => {
    const definitions: readonly LifecycleHookDefinition[] = [
      {
        hookId: 'system-guard',
        kind: 'SYSTEM',
        supportedStages: ['BEFORE_REQUEST_ACCEPT'],
        effects: ['TRANSFORM', 'CONTROL'],
        executionStrategy: 'SERIAL_IMPACT',
        failureMode: 'FAIL',
        order: 10,
      },
      {
        hookId: 'custom-guard',
        kind: 'CUSTOM',
        supportedStages: ['BEFORE_REQUEST_ACCEPT'],
        effects: ['TRANSFORM', 'CONTROL'],
        executionStrategy: 'SERIAL_IMPACT',
        failureMode: 'FAIL',
      },
    ];
    const bindings: readonly AgentHookActivation[] = [
      { hookId: 'custom-guard', enabled: true, order: { after: 'system-guard' } },
      { hookId: 'system-guard' },
    ];

    expect(() =>
      createNextAgentTestApp({
        workspaceDir: process.cwd(),
        modelSteps: [{ content: 'should not start' }],
        identity,
        lifecycleHook: {
          async invoke(): Promise<HookResult> {
            return { outcome: 'PASS' };
          },
        },
        lifecycleHookDefinitions: definitions,
        hooks: bindings,
      }),
    ).toThrow(expect.objectContaining({ code: 'LIFECYCLE_HOOK_ORDER_CROSS_KIND' }));
  });

  it('fails closed when custom hook order contains a cycle', () => {
    const definitions: readonly LifecycleHookDefinition[] = [
      {
        hookId: 'impact-a',
        kind: 'CUSTOM',
        supportedStages: ['BEFORE_REQUEST_ACCEPT'],
        effects: ['TRANSFORM', 'CONTROL'],
        executionStrategy: 'SERIAL_IMPACT',
        failureMode: 'FAIL',
      },
      {
        hookId: 'impact-b',
        kind: 'CUSTOM',
        supportedStages: ['BEFORE_REQUEST_ACCEPT'],
        effects: ['TRANSFORM', 'CONTROL'],
        executionStrategy: 'SERIAL_IMPACT',
        failureMode: 'FAIL',
      },
    ];
    const bindings: readonly AgentHookActivation[] = [
      { hookId: 'impact-a', enabled: true, order: { before: 'impact-b' } },
      { hookId: 'impact-b', enabled: true, order: { before: 'impact-a' } },
    ];

    expect(() =>
      createNextAgentTestApp({
        workspaceDir: process.cwd(),
        modelSteps: [{ content: 'should not start' }],
        identity,
        lifecycleHook: {
          async invoke(): Promise<HookResult> {
            return { outcome: 'PASS' };
          },
        },
        lifecycleHookDefinitions: definitions,
        hooks: bindings,
      }),
    ).toThrow(expect.objectContaining({ code: 'LIFECYCLE_HOOK_ORDER_CYCLE' }));
  });
});

async function expectInvalidResultSummary(resultSummary: unknown, caseName: string): Promise<void> {
  const lifecycleHook: RuntimeLifecycleHookExecutor = {
    async invoke(input: HookInput): Promise<HookResult> {
      if (input.stage === 'BEFORE_REQUEST_ACCEPT') {
        return { outcome: 'DENY', safeReason: 'must-not-apply', resultSummary } as unknown as HookResult;
      }
      return { outcome: 'PASS' };
    },
  };
  const app = createNextAgentTestApp({
    workspaceDir: process.cwd(),
    modelSteps: [{ content: 'invalid result summary continued' }],
    identity,
    lifecycleHook,
    lifecycleHookDefinitions: [
      {
        hookId: `invalid-result-summary-${caseName}`,
        kind: 'CUSTOM',
        supportedStages: ['BEFORE_REQUEST_ACCEPT'],
        effects: ['CONTROL'],
        executionStrategy: 'SERIAL_IMPACT',
        failureMode: 'CONTINUE',
      },
    ],
    hooks: [{ hookId: `invalid-result-summary-${caseName}`, enabled: true }],
  });
  apps.push(app);
  const session = await app.runtime.createSession({
    identityContext: identity,
    locale: brand<string, 'RequestLocale'>('zh-CN'),
    idempotencyKey: brand<string, 'IdempotencyKey'>(`idem-invalid-result-summary-${caseName}-session`),
  });

  const accepted = await app.runtime.submit({
    sessionId: session.sessionId,
    identityContext: identity,
    inputText: 'run invalid result summary path',
    attachmentIds: [],
    locale: brand<string, 'RequestLocale'>('zh-CN'),
    idempotencyKey: brand<string, 'IdempotencyKey'>(`idem-invalid-result-summary-${caseName}-submit`),
  });

  await waitForTimelineEvent(app, session.sessionId, accepted.runId, 'REQUEST_COMPLETED');
  const events = await listTimelineEvents(app, session.sessionId, accepted.runId);
  const hookEvent = events.find((event) => event.type === 'HOOK_INVOKED' && event.inlinePayload['hookId'] === `invalid-result-summary-${caseName}`);
  expect(hookEvent?.inlinePayload).toMatchObject({ status: 'INVALID_RESULT', failureMode: 'CONTINUE' });
  expect(hookEvent?.inlinePayload).not.toHaveProperty('outcome');
  expect(hookEvent?.inlinePayload).not.toHaveProperty('resultSummary');
}
