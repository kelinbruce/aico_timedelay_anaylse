import { createNextAgentTestApp } from '@nextagent/agent-platform-gateway-local/testing';
import { AgentError, brand } from '@nextagent/agent-common';
import type { ModelInvocationRequest } from '@nextagent/agent-contracts/model';
import type { HookBoundaryByStage, HookInput, HookResult, LifecycleHookDefinition, LifecycleStage } from '@nextagent/agent-contracts/runtime';
import type { RuntimeLifecycleHookExecutor } from '@nextagent/agent-runtime';
import { afterEach, describe, expect, it } from 'vitest';
import type { AgentHookActivation } from '@nextagent/agent-contracts/agent-assembly';
import { agentId, apps, closeLifecycleHookApps, identity, listTimelineEvents, waitFor, waitForTimelineEvent } from './lifecycle-hook-test-helpers.js';

afterEach(async () => {
  await closeLifecycleHookApps();
});

describe('lifecycle hook execution core', () => {
  it('uses the frozen startup hook snapshot and keeps SYSTEM hooks ahead of CUSTOM hooks', async () => {
    const callOrder: string[] = [];
    const lifecycleHook: RuntimeLifecycleHookExecutor = {
      async invoke(input: HookInput): Promise<HookResult> {
        if (input.stage === 'BEFORE_REQUEST_ACCEPT') {
          callOrder.push(input.hookId);
        }
        return { outcome: 'PASS' };
      },
    };
    const definitions: LifecycleHookDefinition[] = [
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
        order: 0,
      },
    ];
    const bindings: AgentHookActivation[] = [
      {
        hookId: 'custom-guard',
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

    definitions.length = 0;
    bindings[0] = {
      hookId: 'custom-guard',
      enabled: false,
    };

    const session = await app.runtime.createSession({
      identityContext: identity,
      locale: brand<string, 'RequestLocale'>('zh-CN'),
      idempotencyKey: brand<string, 'IdempotencyKey'>('idem-lifecycle-frozen-session'),
    });
    await app.runtime.submit({
      sessionId: session.sessionId,
      identityContext: identity,
      inputText: 'hello',
      attachmentIds: [],
      locale: brand<string, 'RequestLocale'>('zh-CN'),
      idempotencyKey: brand<string, 'IdempotencyKey'>('idem-lifecycle-frozen-submit'),
    });

    expect(callOrder).toEqual(['system-guard', 'custom-guard']);
  });

  it('rejects submit when BEFORE_REQUEST_ACCEPT hook returns REJECT', async () => {
    const lifecycleHook: RuntimeLifecycleHookExecutor = {
      async invoke(input: HookInput): Promise<HookResult> {
        if (input.hookId === 'accept-guard') {
          return { outcome: 'DENY', safeReason: 'blocked-by-hook' };
        }
        return { outcome: 'PASS' };
      },
    };
    const definitions: readonly LifecycleHookDefinition[] = [
      {
        hookId: 'accept-guard',
        kind: 'CUSTOM',
        supportedStages: ['BEFORE_REQUEST_ACCEPT'],
        effects: ['TRANSFORM', 'CONTROL'],
        executionStrategy: 'SERIAL_IMPACT',
        failureMode: 'FAIL',
      },
    ];
    const bindings: readonly AgentHookActivation[] = [
      {
        hookId: 'accept-guard',
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
      idempotencyKey: brand<string, 'IdempotencyKey'>('idem-lifecycle-hook-session'),
    });

    await expect(
      app.runtime.submit({
        sessionId: session.sessionId,
        identityContext: identity,
        inputText: 'hello',
        attachmentIds: [],
        locale: brand<string, 'RequestLocale'>('zh-CN'),
        idempotencyKey: brand<string, 'IdempotencyKey'>('idem-lifecycle-hook-submit'),
      }),
    ).rejects.toMatchObject({ code: 'LIFECYCLE_HOOK_DENIED' } satisfies Partial<AgentError>);
  });

  it('invokes core-adjacent model lifecycle stages through runtime-owned runState', async () => {
    const calledStages: LifecycleStage[] = [];
    const lifecycleHook: RuntimeLifecycleHookExecutor = {
      async invoke(input: HookInput): Promise<HookResult> {
        calledStages.push(input.stage);
        return { outcome: 'PASS' };
      },
    };
    const definitions: readonly LifecycleHookDefinition[] = [
      {
        hookId: 'model-audit',
        kind: 'CUSTOM',
        supportedStages: ['BEFORE_MODEL_INVOKE', 'AFTER_MODEL_RESULT'],
        effects: ['TRANSFORM', 'CONTROL'],
        executionStrategy: 'SERIAL_IMPACT',
        failureMode: 'FAIL',
      },
    ];
    const bindings: readonly AgentHookActivation[] = [
      {
        hookId: 'model-audit',
        enabled: true,
      },
    ];
    const app = createNextAgentTestApp({
      workspaceDir: process.cwd(),
      modelSteps: [{ content: 'hook integration ok' }],
      identity,
      lifecycleHook,
      lifecycleHookDefinitions: definitions,
      hooks: bindings,
    });
    apps.push(app);
    const session = await app.runtime.createSession({
      identityContext: identity,
      locale: brand<string, 'RequestLocale'>('zh-CN'),
      idempotencyKey: brand<string, 'IdempotencyKey'>('idem-lifecycle-hook-model-session'),
    });

    await app.runtime.submit({
      sessionId: session.sessionId,
      identityContext: identity,
      inputText: 'run model path',
      attachmentIds: [],
      locale: brand<string, 'RequestLocale'>('zh-CN'),
      idempotencyKey: brand<string, 'IdempotencyKey'>('idem-lifecycle-hook-model-submit'),
    });

    await waitFor(() => calledStages.includes('BEFORE_MODEL_INVOKE') && calledStages.includes('AFTER_MODEL_RESULT'));
    expect(calledStages).toContain('BEFORE_MODEL_INVOKE');
    expect(calledStages).toContain('AFTER_MODEL_RESULT');
  });

  it('applies the same model hooks to post-terminal recommendation without adding run timeline facts', async () => {
    const modelRequests: ModelInvocationRequest[] = [];
    const calledStages: LifecycleStage[] = [];
    let beforeInvocationCount = 0;
    const lifecycleHook: RuntimeLifecycleHookExecutor = {
      async invoke(input: HookInput): Promise<HookResult> {
        calledStages.push(input.stage);
        if (input.stage === 'BEFORE_MODEL_INVOKE') {
          beforeInvocationCount += 1;
          if (beforeInvocationCount === 2) {
            return {
              outcome: 'PASS',
              mutation: { temperature: 0.11 },
            };
          }
        }
        return { outcome: 'PASS' };
      },
    };
    const definitions: readonly LifecycleHookDefinition[] = [
      {
        hookId: 'all-model-invocations',
        kind: 'CUSTOM',
        supportedStages: ['BEFORE_MODEL_INVOKE', 'AFTER_MODEL_RESULT'],
        effects: ['TRANSFORM'],
        executionStrategy: 'SERIAL_IMPACT',
        failureMode: 'FAIL',
      },
    ];
    const app = createNextAgentTestApp({
      workspaceDir: process.cwd(),
      modelSteps: [{ content: 'main response' }, { content: '["follow up"]' }],
      modelRequestSink: modelRequests,
      identity,
      lifecycleHook,
      lifecycleHookDefinitions: definitions,
      hooks: [{ hookId: 'all-model-invocations', enabled: true }],
    });
    apps.push(app);
    const session = await app.runtime.createSession({
      identityContext: identity,
      locale: brand<string, 'RequestLocale'>('zh-CN'),
      idempotencyKey: brand<string, 'IdempotencyKey'>('idem-background-hook-session'),
    });
    const accepted = await app.runtime.submit({
      sessionId: session.sessionId,
      identityContext: identity,
      inputText: 'run model and recommendation',
      attachmentIds: [],
      locale: brand<string, 'RequestLocale'>('zh-CN'),
      idempotencyKey: brand<string, 'IdempotencyKey'>('idem-background-hook-submit'),
    });

    await waitForTimelineEvent(app, session.sessionId, accepted.runId, 'REQUEST_COMPLETED');
    await waitFor(() => modelRequests.length === 2 && calledStages.filter((stage) => stage === 'AFTER_MODEL_RESULT').length === 2);

    expect(modelRequests[1]?.temperature).toBe(0.11);
    const timeline = await listTimelineEvents(app, session.sessionId, accepted.runId);
    expect(timeline.filter((event) => event.type === 'MODEL_INVOCATION_STARTED')).toHaveLength(1);
    expect(timeline.filter((event) => event.type === 'HOOK_INVOKED' && event.inlinePayload['hookId'] === 'all-model-invocations')).toHaveLength(2);
  });

  it('fails background model PEND before provider execution without creating pending or timeline truth', async () => {
    const modelRequests: ModelInvocationRequest[] = [];
    let beforeInvocationCount = 0;
    const lifecycleHook: RuntimeLifecycleHookExecutor = {
      async invoke(input: HookInput): Promise<HookResult> {
        if (input.stage !== 'BEFORE_MODEL_INVOKE') {
          return { outcome: 'PASS' };
        }
        beforeInvocationCount += 1;
        if (beforeInvocationCount === 1) {
          return { outcome: 'PASS' };
        }
        return {
          outcome: 'PEND',
          pendingInputIntent: {
            kind: 'CONFIRMATION',
            questions: [
              {
                prompt: 'background model should not pend',
                options: [{ label: 'Continue', value: 'continue' }],
              },
            ],
          },
        };
      },
    };
    const app = createNextAgentTestApp({
      workspaceDir: process.cwd(),
      modelSteps: [{ content: 'main response' }, { content: 'must not reach provider' }],
      modelRequestSink: modelRequests,
      identity,
      lifecycleHook,
      lifecycleHookDefinitions: [
        {
          hookId: 'background-pend',
          kind: 'CUSTOM',
          supportedStages: ['BEFORE_MODEL_INVOKE'],
          effects: ['CONTROL'],
          executionStrategy: 'SERIAL_IMPACT',
          failureMode: 'FAIL',
        },
      ],
      hooks: [{ hookId: 'background-pend', enabled: true }],
    });
    apps.push(app);
    const session = await app.runtime.createSession({
      identityContext: identity,
      locale: brand<string, 'RequestLocale'>('zh-CN'),
      idempotencyKey: brand<string, 'IdempotencyKey'>('idem-background-pend-session'),
    });
    const accepted = await app.runtime.submit({
      sessionId: session.sessionId,
      identityContext: identity,
      inputText: 'run model and reject recommendation pending',
      attachmentIds: [],
      locale: brand<string, 'RequestLocale'>('zh-CN'),
      idempotencyKey: brand<string, 'IdempotencyKey'>('idem-background-pend-submit'),
    });

    await waitForTimelineEvent(app, session.sessionId, accepted.runId, 'REQUEST_COMPLETED');
    await waitFor(() => beforeInvocationCount === 2);

    expect(modelRequests).toHaveLength(1);
    const timeline = await listTimelineEvents(app, session.sessionId, accepted.runId);
    expect(timeline.some((event) => event.type === 'USER_INPUT_REQUIRED')).toBe(false);
    expect(timeline.filter((event) => event.type === 'HOOK_INVOKED' && event.inlinePayload['hookId'] === 'background-pend')).toHaveLength(1);
  });

  it('invokes core-adjacent capability lifecycle stages through runtime-owned runState', async () => {
    const calledStages: LifecycleStage[] = [];
    let afterCapabilityArguments: HookBoundaryByStage['AFTER_CAPABILITY_RESULT']['arguments'] | undefined;
    const lifecycleHook: RuntimeLifecycleHookExecutor = {
      async invoke(input: HookInput): Promise<HookResult> {
        calledStages.push(input.stage);
        if (input.stage === 'BEFORE_CAPABILITY_INVOKE') {
          return { outcome: 'PASS', mutation: { arguments: { pattern: 'workspace/action.py' } } };
        }
        if (input.stage === 'AFTER_CAPABILITY_RESULT') {
          afterCapabilityArguments = (input.boundary as HookBoundaryByStage['AFTER_CAPABILITY_RESULT']).arguments;
        }
        return { outcome: 'PASS' };
      },
    };
    const definitions: readonly LifecycleHookDefinition[] = [
      {
        hookId: 'capability-audit',
        kind: 'CUSTOM',
        supportedStages: ['BEFORE_CAPABILITY_INVOKE', 'AFTER_CAPABILITY_RESULT'],
        effects: ['TRANSFORM', 'CONTROL'],
        executionStrategy: 'SERIAL_IMPACT',
        failureMode: 'FAIL',
      },
    ];
    const bindings: readonly AgentHookActivation[] = [
      {
        hookId: 'capability-audit',
        enabled: true,
      },
    ];
    const app = createNextAgentTestApp({
      workspaceDir: process.cwd(),
      modelSteps: [
        {
          toolCalls: [
            {
              toolCallId: 'tool-glob-capability',
              toolName: 'Glob',
              arguments: { pattern: 'workspace/**/*' },
            },
          ],
        },
        { content: 'hook capability integration ok' },
      ],
      identity,
      lifecycleHook,
      lifecycleHookDefinitions: definitions,
      hooks: bindings,
    });
    apps.push(app);
    const session = await app.runtime.createSession({
      identityContext: identity,
      locale: brand<string, 'RequestLocale'>('zh-CN'),
      idempotencyKey: brand<string, 'IdempotencyKey'>('idem-lifecycle-hook-capability-session'),
    });

    await app.runtime.submit({
      sessionId: session.sessionId,
      identityContext: identity,
      inputText: 'run capability path',
      attachmentIds: [],
      locale: brand<string, 'RequestLocale'>('zh-CN'),
      idempotencyKey: brand<string, 'IdempotencyKey'>('idem-lifecycle-hook-capability-submit'),
    });

    await waitFor(() => calledStages.includes('BEFORE_CAPABILITY_INVOKE') && calledStages.includes('AFTER_CAPABILITY_RESULT'));
    expect(calledStages).toContain('BEFORE_CAPABILITY_INVOKE');
    expect(calledStages).toContain('AFTER_CAPABILITY_RESULT');
    expect(afterCapabilityArguments).toEqual({ pattern: 'workspace/action.py' });
  });

  it('detaches effective capability arguments for every result hook invocation', async () => {
    const observedArguments: unknown[] = [];
    const lifecycleHook: RuntimeLifecycleHookExecutor = {
      async invoke(input: HookInput): Promise<HookResult> {
        if (input.stage !== 'AFTER_CAPABILITY_RESULT') {
          return { outcome: 'PASS' };
        }
        if (input.hookId === 'mutate-result-arguments') {
          const nested = (input.boundary as HookBoundaryByStage['AFTER_CAPABILITY_RESULT']).arguments['nested'];
          if (nested !== null && typeof nested === 'object' && !Array.isArray(nested)) {
            (nested as Record<string, unknown>)['value'] = 'mutated';
          }
        } else {
          observedArguments.push((input.boundary as HookBoundaryByStage['AFTER_CAPABILITY_RESULT']).arguments);
        }
        return { outcome: 'PASS' };
      },
    };
    const definitions: readonly LifecycleHookDefinition[] = [
      {
        hookId: 'mutate-result-arguments',
        kind: 'CUSTOM',
        supportedStages: ['AFTER_CAPABILITY_RESULT'],
        effects: ['TRANSFORM'],
        executionStrategy: 'SERIAL_IMPACT',
        failureMode: 'FAIL',
        order: 0,
      },
      {
        hookId: 'observe-result-arguments',
        kind: 'CUSTOM',
        supportedStages: ['AFTER_CAPABILITY_RESULT'],
        effects: ['TRANSFORM'],
        executionStrategy: 'SERIAL_IMPACT',
        failureMode: 'FAIL',
        order: 1,
      },
    ];
    const app = createNextAgentTestApp({
      workspaceDir: process.cwd(),
      modelSteps: [{ content: 'not used' }],
      identity,
      lifecycleHook,
      lifecycleHookDefinitions: definitions,
      hooks: definitions.map(({ hookId }) => ({ hookId, enabled: true })),
    });
    apps.push(app);
    const result = await app.runtime.lifecycleHookInvocationPort().invoke({
      stage: 'AFTER_CAPABILITY_RESULT',
      coordinates: {
        agentId,
        agentVersion: brand<string, 'AgentVersion'>('v1'),
        agentAssemblyRef: 'default-agent:v1',
        stageOccurrenceKey: 'capability:arguments-detach',
      },
      ownerScope: {
        tenantId: identity.tenantId,
        subjectId: identity.subjectId,
      },
      boundary: {
        capabilityId: brand<string, 'CapabilityId'>('Bash'),
        capabilityInvocationId: 'run-detach:tool-detach',
        arguments: { nested: { value: 'original' } },
        status: 'SUCCEEDED',
        safeResultSummary: 'result fields=1',
        generatedMessageCount: 0,
        artifactCount: 0,
      },
    });

    expect(observedArguments).toEqual([{ nested: { value: 'original' } }]);
    expect(result).toMatchObject({
      status: 'CONTINUE',
      boundary: { arguments: { nested: { value: 'original' } } },
    });
  });

  it('records the Hook-provided capability result object without extra processing', async () => {
    const hookResult = {
      a: 1,
      b: 2,
      原始字段: {
        values: [1, 'two', true, null],
      },
    } as const;
    const lifecycleHook: RuntimeLifecycleHookExecutor = {
      async invoke(input: HookInput): Promise<HookResult> {
        if (input.stage === 'AFTER_CAPABILITY_RESULT') {
          return { outcome: 'PASS', resultSummary: hookResult };
        }
        return { outcome: 'PASS' };
      },
    };
    const definitions: readonly LifecycleHookDefinition[] = [
      {
        hookId: 'capability-result-output',
        kind: 'CUSTOM',
        supportedStages: ['AFTER_CAPABILITY_RESULT'],
        effects: ['OBSERVE'],
        executionStrategy: 'OBSERVE_PARALLEL',
        failureMode: 'CONTINUE',
      },
    ];
    const app = createNextAgentTestApp({
      workspaceDir: process.cwd(),
      modelSteps: [
        {
          toolCalls: [
            {
              toolCallId: 'tool-bash-result-output',
              toolName: 'Bash',
              arguments: { command: "printf 'a:1, b:2'" },
            },
          ],
        },
        { content: 'hook result recorded' },
      ],
      identity,
      lifecycleHook,
      lifecycleHookDefinitions: definitions,
      hooks: [{ hookId: 'capability-result-output', enabled: true }],
    });
    apps.push(app);
    const session = await app.runtime.createSession({
      identityContext: identity,
      locale: brand<string, 'RequestLocale'>('zh-CN'),
      idempotencyKey: brand<string, 'IdempotencyKey'>('idem-lifecycle-result-output-session'),
    });

    const accepted = await app.runtime.submit({
      sessionId: session.sessionId,
      identityContext: identity,
      inputText: 'run bash result output path',
      attachmentIds: [],
      locale: brand<string, 'RequestLocale'>('zh-CN'),
      idempotencyKey: brand<string, 'IdempotencyKey'>('idem-lifecycle-result-output-submit'),
    });

    await waitForTimelineEvent(app, session.sessionId, accepted.runId, 'REQUEST_COMPLETED');
    const events = await listTimelineEvents(app, session.sessionId, accepted.runId);
    const hookEvents = events.filter((event) => event.type === 'HOOK_INVOKED' && event.inlinePayload['hookId'] === 'capability-result-output');

    expect(hookEvents).toHaveLength(1);
    expect(hookEvents[0]?.inlinePayload).toMatchObject({
      status: 'SUCCESS',
      outcome: 'PASS',
      failureMode: 'CONTINUE',
      resultSummary: hookResult,
    });
    expect(hookEvents[0]?.inlinePayload['resultSummary']).toEqual(hookResult);
    expect(hookEvents[0]?.inlinePayload).not.toHaveProperty('mutationSummary');
  });

  it('exposes model result content to AFTER_MODEL_RESULT hook while keeping capability summaries safe', async () => {
    const boundaries: Array<{ readonly stage: LifecycleStage } & Record<string, unknown>> = [];
    const lifecycleHook: RuntimeLifecycleHookExecutor = {
      async invoke(input: HookInput): Promise<HookResult> {
        if (input.stage === 'AFTER_MODEL_RESULT' || input.stage === 'BEFORE_CAPABILITY_INVOKE' || input.stage === 'AFTER_CAPABILITY_RESULT') {
          boundaries.push({ stage: input.stage, ...(input.boundary as unknown as Record<string, unknown>) });
        }
        return { outcome: 'PASS' };
      },
    };
    const definitions: readonly LifecycleHookDefinition[] = [
      {
        hookId: 'safe-summary-audit',
        kind: 'CUSTOM',
        supportedStages: ['BEFORE_CAPABILITY_INVOKE', 'AFTER_CAPABILITY_RESULT', 'AFTER_MODEL_RESULT'],
        effects: ['TRANSFORM', 'CONTROL'],
        executionStrategy: 'SERIAL_IMPACT',
        failureMode: 'FAIL',
      },
    ];
    const bindings: readonly AgentHookActivation[] = [
      {
        hookId: 'safe-summary-audit',
        enabled: true,
      },
    ];
    const app = createNextAgentTestApp({
      workspaceDir: process.cwd(),
      modelSteps: [
        {
          toolCalls: [
            {
              toolCallId: 'tool-glob-summary',
              toolName: 'Glob',
              arguments: { pattern: 'workspace/**/*' },
            },
          ],
        },
        { content: 'operator password is secret' },
      ],
      identity,
      lifecycleHook,
      lifecycleHookDefinitions: definitions,
      hooks: bindings,
    });
    apps.push(app);
    const session = await app.runtime.createSession({
      identityContext: identity,
      locale: brand<string, 'RequestLocale'>('zh-CN'),
      idempotencyKey: brand<string, 'IdempotencyKey'>('idem-lifecycle-safe-summary-session'),
    });

    await app.runtime.submit({
      sessionId: session.sessionId,
      identityContext: identity,
      inputText: 'trace lifecycle summary',
      attachmentIds: [],
      locale: brand<string, 'RequestLocale'>('zh-CN'),
      idempotencyKey: brand<string, 'IdempotencyKey'>('idem-lifecycle-safe-summary-submit'),
    });

    // Wait for both model steps to emit AFTER_MODEL_RESULT (tool-call step + text-content step).
    await waitFor(() => boundaries.filter((boundary) => boundary.stage === 'AFTER_MODEL_RESULT').length >= 2);
    const capabilityStart = boundaries.find((boundary) => boundary.stage === 'BEFORE_CAPABILITY_INVOKE');
    const capabilityComplete = boundaries.find((boundary) => boundary.stage === 'AFTER_CAPABILITY_RESULT');
    // The text-content model step is the last AFTER_MODEL_RESULT boundary; the first is the tool-call step.
    const modelComplete = boundaries.filter((boundary) => boundary.stage === 'AFTER_MODEL_RESULT').at(-1);

    expect(capabilityStart).toMatchObject({
      stage: 'BEFORE_CAPABILITY_INVOKE',
      safeInputSummary: 'pattern=workspace/**/*',
    });
    expect(capabilityComplete).toMatchObject({
      stage: 'AFTER_CAPABILITY_RESULT',
      safeResultSummary: expect.stringMatching(/^result fields=\d+$/u),
    });
    expect(modelComplete).toMatchObject({
      stage: 'AFTER_MODEL_RESULT',
      safeAssistantOutputSummary: 'visible-text chars=27 toolCalls=0',
      content: 'operator password is secret',
    });
    expect(JSON.stringify([capabilityStart, capabilityComplete])).not.toContain('operator password is secret');
  });

  it('does not pass assembly config through runtime HookInput', async () => {
    const seenRuntimeConfigFields: boolean[] = [];
    const lifecycleHook: RuntimeLifecycleHookExecutor = {
      async invoke(input: HookInput): Promise<HookResult> {
        if (input.stage === 'BEFORE_REQUEST_ACCEPT') {
          seenRuntimeConfigFields.push('config' in input);
        }
        return { outcome: 'PASS' };
      },
    };
    const definitions: readonly LifecycleHookDefinition[] = [
      {
        hookId: 'config-pass-through',
        kind: 'CUSTOM',
        supportedStages: ['BEFORE_REQUEST_ACCEPT'],
        effects: ['TRANSFORM', 'CONTROL'],
        executionStrategy: 'SERIAL_IMPACT',
        failureMode: 'FAIL',
      },
    ];
    const bindings: readonly AgentHookActivation[] = [
      {
        hookId: 'config-pass-through',
        enabled: true,
        config: { gate: { allow: true }, source: 'binding', nested: ['A', 'B'] },
      },
    ];
    const app = createNextAgentTestApp({
      workspaceDir: process.cwd(),
      modelSteps: [{ content: 'config pass through ok' }],
      identity,
      lifecycleHook,
      lifecycleHookDefinitions: definitions,
      hooks: bindings,
    });
    apps.push(app);
    const session = await app.runtime.createSession({
      identityContext: identity,
      locale: brand<string, 'RequestLocale'>('zh-CN'),
      idempotencyKey: brand<string, 'IdempotencyKey'>('idem-lifecycle-config-pass-through-session'),
    });

    const accepted = await app.runtime.submit({
      sessionId: session.sessionId,
      identityContext: identity,
      inputText: 'run config pass through path',
      attachmentIds: [],
      locale: brand<string, 'RequestLocale'>('zh-CN'),
      idempotencyKey: brand<string, 'IdempotencyKey'>('idem-lifecycle-config-pass-through-submit'),
    });

    expect(accepted.runId).toBeDefined();
    expect(seenRuntimeConfigFields).toEqual([false]);
  });

  it('accepts order between observe-only hooks and executes both in parallel', async () => {
    const invoked: string[] = [];
    const lifecycleHook: RuntimeLifecycleHookExecutor = {
      async invoke(input: HookInput): Promise<HookResult> {
        invoked.push(input.hookId);
        return { outcome: 'PASS' };
      },
    };
    const definitions: readonly LifecycleHookDefinition[] = [
      {
        hookId: 'observe-first',
        kind: 'CUSTOM',
        supportedStages: ['BEFORE_REQUEST_ACCEPT'],
        effects: ['OBSERVE'],
        executionStrategy: 'OBSERVE_PARALLEL',
        failureMode: 'CONTINUE',
      },
      {
        hookId: 'observe-second',
        kind: 'CUSTOM',
        supportedStages: ['BEFORE_REQUEST_ACCEPT'],
        effects: ['OBSERVE'],
        executionStrategy: 'OBSERVE_PARALLEL',
        failureMode: 'CONTINUE',
      },
    ];
    const bindings: readonly AgentHookActivation[] = [
      { hookId: 'observe-first', enabled: true },
      { hookId: 'observe-second', enabled: true, order: { after: 'observe-first' } },
    ];
    const app = createNextAgentTestApp({
      workspaceDir: process.cwd(),
      modelSteps: [{ content: 'observe order ok' }],
      identity,
      lifecycleHook,
      lifecycleHookDefinitions: definitions,
      hooks: bindings,
    });
    apps.push(app);
    const session = await app.runtime.createSession({
      identityContext: identity,
      locale: brand<string, 'RequestLocale'>('zh-CN'),
      idempotencyKey: brand<string, 'IdempotencyKey'>('idem-lifecycle-observe-order-session'),
    });

    await app.runtime.submit({
      sessionId: session.sessionId,
      identityContext: identity,
      inputText: 'run observe order path',
      attachmentIds: [],
      locale: brand<string, 'RequestLocale'>('zh-CN'),
      idempotencyKey: brand<string, 'IdempotencyKey'>('idem-lifecycle-observe-order-submit'),
    });

    expect(invoked.sort()).toEqual(['observe-first', 'observe-second']);
  });

  it('does not record mutationSummary for ignored observe-only mutation', async () => {
    const lifecycleHook: RuntimeLifecycleHookExecutor = {
      async invoke(input: HookInput): Promise<HookResult> {
        if (input.stage === 'BEFORE_AGENT_TERMINAL') {
          return {
            outcome: 'PASS',
            mutation: { kind: 'agent.terminal', finalContent: 'should-be-ignored' } as never,
          };
        }
        return { outcome: 'PASS' };
      },
    };
    const definitions: readonly LifecycleHookDefinition[] = [
      {
        hookId: 'observe-with-mutation',
        kind: 'CUSTOM',
        supportedStages: ['BEFORE_AGENT_TERMINAL'],
        effects: ['OBSERVE'],
        executionStrategy: 'OBSERVE_PARALLEL',
        failureMode: 'CONTINUE',
      },
    ];
    const bindings: readonly AgentHookActivation[] = [
      {
        hookId: 'observe-with-mutation',
        enabled: true,
      },
    ];
    const app = createNextAgentTestApp({
      workspaceDir: process.cwd(),
      modelSteps: [{ content: 'observe mutation ignored ok' }],
      identity,
      lifecycleHook,
      lifecycleHookDefinitions: definitions,
      hooks: bindings,
    });
    apps.push(app);
    const session = await app.runtime.createSession({
      identityContext: identity,
      locale: brand<string, 'RequestLocale'>('zh-CN'),
      idempotencyKey: brand<string, 'IdempotencyKey'>('idem-lifecycle-observe-mutation-session'),
    });

    const accepted = await app.runtime.submit({
      sessionId: session.sessionId,
      identityContext: identity,
      inputText: 'run observe mutation path',
      attachmentIds: [],
      locale: brand<string, 'RequestLocale'>('zh-CN'),
      idempotencyKey: brand<string, 'IdempotencyKey'>('idem-lifecycle-observe-mutation-submit'),
    });

    await waitForTimelineEvent(app, session.sessionId, accepted.runId, 'REQUEST_COMPLETED');
    const events = await listTimelineEvents(app, session.sessionId, accepted.runId);
    const hookEvent = events.find(
      (event) => event.type === 'HOOK_INVOKED' && (event.inlinePayload as Record<string, unknown>)?.hookId === 'observe-with-mutation',
    );
    expect(hookEvent).toBeDefined();
    const payload = hookEvent!.inlinePayload as Record<string, unknown>;
    expect(payload['diagnosticCode']).toBe('OBSERVE_CONTROL_IGNORED');
    expect(payload['mutationSummary']).toBeUndefined();
  });
});
