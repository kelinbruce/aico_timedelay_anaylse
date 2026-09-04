import { collectModelStream, modelEventStreamFixture } from '../../../tests/helpers/model-stream-fixture.js';
import { brand } from '@nextagent/agent-common';
import type { ModelFinalResult, ModelInvocationRequest, ModelInvocationService, ModelStreamDelta } from '@nextagent/agent-contracts/model';
import type {
  HookBoundaryByStage,
  LifecycleHookInvocationPort,
  LifecycleHookInvocationRequest,
  LifecycleHookInvocationResult,
  LifecycleStage,
} from '@nextagent/agent-contracts/runtime';
import { LifecycleHookInterruptionError } from '@nextagent/agent-contracts/runtime';
import { describe, expect, it } from 'vitest';
import { createLifecycleHookModelInvocationService } from '../src/invocation/lifecycle-hook-wrapper.js';

describe('lifecycle hook model invocation wrapper', () => {
  it('blocks nested in-place mutation and reuses unchanged owner values', async () => {
    let seenRequest: ModelInvocationRequest | undefined;
    let seenContextWindowTokens: number | undefined;
    let blockedMutations = 0;
    const hook: LifecycleHookInvocationPort = {
      async invoke<S extends LifecycleStage>(request: LifecycleHookInvocationRequest<S>): Promise<LifecycleHookInvocationResult<S>> {
        if (request.stage === 'BEFORE_MODEL_INVOKE') {
          const boundary = request.boundary as HookBoundaryByStage['BEFORE_MODEL_INVOKE'];
          seenContextWindowTokens = boundary.contextWindowTokens;
          const mutations = [
            () => {
              const text = boundary.messages?.[0]?.content[0] as unknown as { text: string };
              text.text = 'mutated message';
            },
            () => {
              const schema = boundary.tools?.[0]?.inputSchema as Record<string, unknown>;
              schema['injected'] = true;
            },
            () => {
              const nested = boundary.providerOptions?.['nested'] as Record<string, unknown>;
              nested['flag'] = false;
            },
            () => {
              (boundary.thinking as { depth: string }).depth = 'HIGH';
            },
            () => {
              const descriptor = Object.getOwnPropertyDescriptor(boundary.providerOptions, 'nested');
              const nested = descriptor?.value as Record<string, unknown>;
              nested['flag'] = false;
            },
          ];
          for (const mutate of mutations) {
            try {
              mutate();
            } catch (error) {
              expect(error).toBeInstanceOf(TypeError);
              blockedMutations += 1;
            }
          }
        }
        return { status: 'CONTINUE', boundary: request.boundary };
      },
    };
    const inner: ModelInvocationService = {
      async complete(request): Promise<ModelFinalResult> {
        seenRequest = request;
        return { content: 'ok', finishReason: 'stop' };
      },
      stream: modelEventStreamFixture(async function* () {
        yield { content: 'ok', finishReason: 'stop' };
      }),
    };
    const original: ModelInvocationRequest = {
      ...modelRequest(),
      messages: [{ role: 'USER', content: [{ type: 'text', text: 'original message' }] }],
      tools: [{ capabilityId: 'read', name: 'Read', inputSchema: { type: 'object' } }],
      contextWindowTokens: 16_384,
      thinking: { depth: 'LOW' },
      providerOptions: { nested: { flag: true } },
    };
    const service = createLifecycleHookModelInvocationService(inner, hook);

    await service.complete(original, new AbortController().signal);

    expect(blockedMutations).toBe(5);
    expect(seenContextWindowTokens).toBe(16_384);
    expect(seenRequest?.contextWindowTokens).toBe(16_384);
    expect(seenRequest?.messages).toBe(original.messages);
    expect(seenRequest?.tools).toBe(original.tools);
    expect(seenRequest?.thinking).toBe(original.thinking);
    expect(seenRequest?.providerOptions).toBe(original.providerOptions);
    expect(original).toMatchObject({
      messages: [{ content: [{ text: 'original message' }] }],
      tools: [{ inputSchema: { type: 'object' } }],
      thinking: { depth: 'LOW' },
      providerOptions: { nested: { flag: true } },
    });
  });

  it('shallow-merges hook provider options over the request layer', async () => {
    let seenRequest: ModelInvocationRequest | undefined;
    const hook: LifecycleHookInvocationPort = {
      async invoke<S extends LifecycleStage>(request: LifecycleHookInvocationRequest<S>): Promise<LifecycleHookInvocationResult<S>> {
        if (request.stage === 'BEFORE_MODEL_INVOKE') {
          return {
            status: 'CONTINUE',
            boundary: {
              ...request.boundary,
              providerOptions: {
                nested: { fromHook: true },
                hookOnly: true,
              },
            } as HookBoundaryByStage[S],
          };
        }
        return { status: 'CONTINUE', boundary: request.boundary };
      },
    };
    const inner: ModelInvocationService = {
      async complete(request): Promise<ModelFinalResult> {
        seenRequest = request;
        return { content: 'ok', finishReason: 'stop' };
      },
      stream: modelEventStreamFixture(async function* () {
        yield { content: 'ok', finishReason: 'stop' };
      }),
    };
    const request = modelRequest();
    const service = createLifecycleHookModelInvocationService(inner, hook);

    await service.complete(
      {
        ...request,
        providerOptions: {
          nested: { fromRequest: true },
          requestOnly: true,
        },
      },
      new AbortController().signal,
    );

    expect(seenRequest?.providerOptions).toEqual({
      nested: { fromHook: true },
      requestOnly: true,
      hookOnly: true,
    });
  });

  it.each([
    ['AUTO', 'REQUIRED', 'REQUIRED'],
    ['NONE', 'REQUIRED', 'NONE'],
  ] as const)('applies hook toolChoice %s -> %s with runtime NONE remaining a hard guard', async (requestChoice, hookChoice, expected) => {
    let seenRequest: ModelInvocationRequest | undefined;
    const hook: LifecycleHookInvocationPort = {
      async invoke<S extends LifecycleStage>(request: LifecycleHookInvocationRequest<S>): Promise<LifecycleHookInvocationResult<S>> {
        if (request.stage === 'BEFORE_MODEL_INVOKE') {
          return {
            status: 'CONTINUE',
            boundary: { ...request.boundary, toolChoice: hookChoice } as HookBoundaryByStage[S],
          };
        }
        return { status: 'CONTINUE', boundary: request.boundary };
      },
    };
    const service = createLifecycleHookModelInvocationService(
      {
        async complete(request): Promise<ModelFinalResult> {
          seenRequest = request;
          return { content: 'ok', finishReason: 'stop' };
        },
        stream: modelEventStreamFixture(async function* () {
          yield { content: 'ok', finishReason: 'stop' };
        }),
      },
      hook,
    );

    await service.complete({ ...modelRequest(), toolChoice: requestChoice }, new AbortController().signal);

    expect(seenRequest?.toolChoice).toBe(expected);
  });

  it.each([{ providerOptions: { tool_choice: 'none' } }, { modelParams: { 'TOOL-CHOICE': 'none' } }])(
    'rejects canonical toolChoice collisions before Hook and selected provider access',
    async (collision) => {
      let hookCalls = 0;
      let providerCalls = 0;
      const service = createLifecycleHookModelInvocationService(
        {
          async complete(): Promise<ModelFinalResult> {
            providerCalls += 1;
            return { content: 'must not run' };
          },
          stream: modelEventStreamFixture(async function* () {
            providerCalls += 1;
            yield { content: 'must not run', finishReason: 'stop' };
          }),
        },
        {
          async invoke<S extends LifecycleStage>(request: LifecycleHookInvocationRequest<S>): Promise<LifecycleHookInvocationResult<S>> {
            hookCalls += 1;
            return { status: 'CONTINUE', boundary: request.boundary };
          },
        },
      );

      const result = await service.complete({ ...modelRequest(), ...collision }, new AbortController().signal);

      expect(result.safeError).toMatchObject({ code: 'MODEL_PROVIDER_OPTIONS_INVALID', category: 'VALIDATION' });
      expect(hookCalls).toBe(0);
      expect(providerCalls).toBe(0);
    },
  );

  it('exposes content and reasoning on AFTER_MODEL_RESULT boundary before downstream projection', async () => {
    const seenAfterBoundaries: unknown[] = [];
    const hook: LifecycleHookInvocationPort = {
      async invoke<S extends LifecycleStage>(request: LifecycleHookInvocationRequest<S>): Promise<LifecycleHookInvocationResult<S>> {
        if (request.stage === 'AFTER_MODEL_RESULT') {
          const boundary = request.boundary as HookBoundaryByStage['AFTER_MODEL_RESULT'];
          seenAfterBoundaries.push(boundary);
          if (boundary.content === 'raw diagnostic answer' && boundary.reasoning === 'raw reasoning') {
            return {
              status: 'CONTINUE',
              boundary: {
                ...boundary,
                content: 'rewritten diagnostic answer',
                reasoning: 'rewritten reasoning',
              } as HookBoundaryByStage[S],
            };
          }
        }
        return { status: 'CONTINUE', boundary: request.boundary };
      },
    };
    const inner: ModelInvocationService = {
      async complete(): Promise<ModelFinalResult> {
        return {
          content: 'raw diagnostic answer',
          reasoning: 'raw reasoning',
          finishReason: 'stop',
          usage: { inputTokens: 12, totalTokens: 20 },
        };
      },
      stream: modelEventStreamFixture(async function* () {
        yield {
          content: 'raw diagnostic answer',
          reasoning: 'raw reasoning',
          finishReason: 'stop',
          usage: { inputTokens: 12, totalTokens: 20 },
        };
      }),
    };
    const service = createLifecycleHookModelInvocationService(inner, hook);

    const result = await service.complete(modelRequest(), new AbortController().signal);

    expect(seenAfterBoundaries).toEqual([
      expect.objectContaining({
        content: 'raw diagnostic answer',
        reasoning: 'raw reasoning',
        safeAssistantOutputSummary: 'visible-text chars=21 toolCalls=0',
        firstContentLatencyMs: expect.any(Number),
        modelE2ELatencyMs: expect.any(Number),
        usage: { inputTokens: 12, totalTokens: 20 },
      }),
    ]);
    expect(result).toMatchObject({
      content: 'rewritten diagnostic answer',
      reasoning: 'rewritten reasoning',
      usage: { inputTokens: 12, totalTokens: 20 },
    });
    expect(seenAfterBoundaries[0]).not.toHaveProperty('usage.outputTokens');
  });

  it('ignores replacement usage returned by an AFTER_MODEL_RESULT hook', async () => {
    const hook: LifecycleHookInvocationPort = {
      async invoke<S extends LifecycleStage>(request: LifecycleHookInvocationRequest<S>): Promise<LifecycleHookInvocationResult<S>> {
        if (request.stage === 'AFTER_MODEL_RESULT') {
          const boundary = request.boundary as HookBoundaryByStage['AFTER_MODEL_RESULT'];
          if (boundary.usage === undefined) {
            return { status: 'CONTINUE', boundary: request.boundary };
          }
          return {
            status: 'CONTINUE',
            boundary: { ...boundary, usage: { inputTokens: 999 } } as HookBoundaryByStage[S],
          };
        }
        return { status: 'CONTINUE', boundary: request.boundary };
      },
    };
    const result = await createLifecycleHookModelInvocationService(
      {
        async complete(): Promise<ModelFinalResult> {
          return { content: 'answer', finishReason: 'stop', usage: { inputTokens: 12 } };
        },
        stream: modelEventStreamFixture(async function* () {
          yield { content: 'answer', finishReason: 'stop', usage: { inputTokens: 12 } };
        }),
      },
      hook,
    ).complete(modelRequest(), new AbortController().signal);

    expect(result.usage).toEqual({ inputTokens: 12 });
  });

  it('omits first-feedback timing when a successful result contains no recognizable feedback', async () => {
    let afterBoundary: HookBoundaryByStage['AFTER_MODEL_RESULT'] | undefined;
    const hook: LifecycleHookInvocationPort = {
      async invoke<S extends LifecycleStage>(request: LifecycleHookInvocationRequest<S>): Promise<LifecycleHookInvocationResult<S>> {
        if (request.stage === 'AFTER_MODEL_RESULT') {
          afterBoundary = request.boundary as HookBoundaryByStage['AFTER_MODEL_RESULT'];
        }
        return { status: 'CONTINUE', boundary: request.boundary };
      },
    };
    const inner: ModelInvocationService = {
      async complete(): Promise<ModelFinalResult> {
        return { content: '', finishReason: 'stop' };
      },
      stream: modelEventStreamFixture(async function* () {
        yield { content: '', finishReason: 'stop' };
      }),
    };

    await createLifecycleHookModelInvocationService(inner, hook).complete(modelRequest(), new AbortController().signal);

    expect(afterBoundary).toEqual(expect.objectContaining({ modelE2ELatencyMs: expect.any(Number) }));
    expect(afterBoundary).not.toHaveProperty('firstContentLatencyMs');
    expect(afterBoundary).not.toHaveProperty('usage');
  });

  it.each([
    ['content delta', { content: 'visible chunk' }, { content: 'visible chunk', finishReason: 'stop' }],
    ['reasoning delta', { reasoning: 'reasoning chunk' }, { content: 'answer', finishReason: 'stop' }],
    [
      'tool-call delta',
      { toolCall: { toolCallId: 'call-delta', toolName: 'Read', arguments: {} } },
      {
        content: '',
        finishReason: 'tool-calls',
        toolCalls: [{ toolCallId: 'call-delta', toolName: 'Read', arguments: {} }],
      },
    ],
    [
      'terminal tool calls',
      undefined,
      {
        content: '',
        finishReason: 'tool-calls',
        toolCalls: [{ toolCallId: 'call-terminal', toolName: 'Read', arguments: {} }],
      },
    ],
  ] as const)('adds first-feedback and E2E timing for %s', async (_caseName, feedback, final) => {
    let afterBoundary: HookBoundaryByStage['AFTER_MODEL_RESULT'] | undefined;
    const hook: LifecycleHookInvocationPort = {
      async invoke<S extends LifecycleStage>(request: LifecycleHookInvocationRequest<S>): Promise<LifecycleHookInvocationResult<S>> {
        if (request.stage === 'AFTER_MODEL_RESULT') {
          afterBoundary = request.boundary as HookBoundaryByStage['AFTER_MODEL_RESULT'];
        }
        return { status: 'CONTINUE', boundary: request.boundary };
      },
    };
    const inner: ModelInvocationService = {
      async complete(): Promise<ModelFinalResult> {
        return final;
      },
      async stream(_request, _signal, onDelta): Promise<ModelFinalResult> {
        if (feedback !== undefined) {
          await onDelta(feedback);
        }
        return final;
      },
    };
    const service = createLifecycleHookModelInvocationService(inner, hook);

    await collectModelStream(service, modelRequest(), new AbortController().signal);

    expect(afterBoundary).toEqual(
      expect.objectContaining({
        firstContentLatencyMs: expect.any(Number),
        modelE2ELatencyMs: expect.any(Number),
      }),
    );
    expect(afterBoundary?.firstContentLatencyMs).toBeGreaterThanOrEqual(0);
    expect(afterBoundary?.modelE2ELatencyMs).toBeGreaterThanOrEqual(afterBoundary?.firstContentLatencyMs ?? 0);
    expect(afterBoundary).not.toHaveProperty('usage');
  });

  it('preserves ordered stream deltas and applies AFTER_MODEL_RESULT only to the terminal item', async () => {
    const hook: LifecycleHookInvocationPort = {
      async invoke<S extends LifecycleStage>(request: LifecycleHookInvocationRequest<S>): Promise<LifecycleHookInvocationResult<S>> {
        if (request.stage === 'AFTER_MODEL_RESULT') {
          return {
            status: 'CONTINUE',
            boundary: {
              ...request.boundary,
              content: 'rewritten final',
            } as HookBoundaryByStage[S],
          };
        }
        return { status: 'CONTINUE', boundary: request.boundary };
      },
    };
    const inner: ModelInvocationService = {
      async complete(): Promise<ModelFinalResult> {
        return { content: 'unused' };
      },
      stream: modelEventStreamFixture(async function* () {
        yield { content: 'visible chunk' };
        yield { reasoning: 'reasoning chunk' };
        yield {
          toolCall: {
            toolCallId: 'call-1',
            toolName: 'Read',
            arguments: { path: 'alarm.log' },
          },
        };
        yield {
          content: 'raw final',
          finishReason: 'tool-calls',
          toolCalls: [
            {
              toolCallId: 'call-1',
              toolName: 'Read',
              arguments: { path: 'alarm.log' },
            },
          ],
        };
      }),
    };
    const service = createLifecycleHookModelInvocationService(inner, hook);
    const events = await collectModelStream(service, modelRequest(), new AbortController().signal);

    expect(events).toEqual([
      { content: 'visible chunk' },
      { reasoning: 'reasoning chunk' },
      {
        toolCall: {
          toolCallId: 'call-1',
          toolName: 'Read',
          arguments: { path: 'alarm.log' },
        },
      },
      {
        content: 'rewritten final',
        finishReason: 'tool-calls',
        toolCalls: [
          {
            toolCallId: 'call-1',
            toolName: 'Read',
            arguments: { path: 'alarm.log' },
          },
        ],
      },
    ]);
  });

  it('fails safely when the inner stream returns an invalid terminal result', async () => {
    let afterModelHookCalls = 0;
    const hook: LifecycleHookInvocationPort = {
      async invoke<S extends LifecycleStage>(request: LifecycleHookInvocationRequest<S>): Promise<LifecycleHookInvocationResult<S>> {
        if (request.stage === 'AFTER_MODEL_RESULT') {
          afterModelHookCalls += 1;
        }
        return { status: 'CONTINUE', boundary: request.boundary };
      },
    };
    const inner: ModelInvocationService = {
      async complete(): Promise<ModelFinalResult> {
        return { content: 'complete-only result' };
      },
      async stream() {
        return undefined as never;
      },
    };
    const service = createLifecycleHookModelInvocationService(inner, hook);
    const events = await collectModelStream(service, modelRequest(), new AbortController().signal);

    expect(events).toEqual([
      expect.objectContaining({
        safeError: expect.objectContaining({
          code: 'MODEL_STREAM_TERMINAL_INVALID',
          category: 'INTERNAL',
        }),
      }),
    ]);
    expect(afterModelHookCalls).toBe(0);
  });

  it('maps content-filter terminals to non-retryable safe failures before AFTER_MODEL_RESULT', async () => {
    let afterModelHookCalls = 0;
    const hook = countingAfterModelHook(() => {
      afterModelHookCalls += 1;
    });
    const filtered: ModelFinalResult = {
      content: 'blocked content',
      reasoning: 'blocked reasoning',
      finishReason: 'content-filter',
      toolCalls: [{ toolCallId: 'call-filtered', toolName: 'Read', arguments: {} }],
    };
    const service = createLifecycleHookModelInvocationService(terminalModel(filtered), hook);

    const complete = await service.complete(modelRequest(), new AbortController().signal);
    const streamed = await collectStream(service);

    for (const result of [complete, streamed.at(-1)]) {
      expect(result).toEqual({
        content: '',
        finishReason: 'content-filter',
        safeError: {
          code: 'MODEL_CONTENT_FILTERED',
          message: 'Model output was blocked by the provider content policy.',
          category: 'POLICY_DENIED',
          retryable: false,
        },
      });
    }
    expect(afterModelHookCalls).toBe(0);
  });

  it('establishes output-limit evidence for length terminals before callers consume them', async () => {
    const result: ModelFinalResult = { content: 'partial', finishReason: 'length' };
    const service = createLifecycleHookModelInvocationService(
      terminalModel(result),
      countingAfterModelHook(() => undefined),
    );

    const complete = await service.complete(modelRequest(), new AbortController().signal);
    const streamed = await collectStream(service);

    expect(complete).toEqual({ ...result, incompleteOutputReason: 'output-limit' });
    expect(streamed).toEqual([{ ...result, incompleteOutputReason: 'output-limit' }]);
  });

  it.each([
    ['error', 'MODEL_TERMINAL_ERROR'],
    ['unknown', 'MODEL_FINISH_REASON_UNKNOWN'],
    ['tool-calls', 'MODEL_TOOL_CALLS_MISSING'],
  ] as const)('maps an unusable %s terminal to a non-retryable safe failure', async (finishReason, code) => {
    let afterModelHookCalls = 0;
    const service = createLifecycleHookModelInvocationService(
      terminalModel({ content: '', finishReason }),
      countingAfterModelHook(() => {
        afterModelHookCalls += 1;
      }),
    );

    const complete = await service.complete(modelRequest(), new AbortController().signal);
    const streamed = await collectStream(service);
    const streamFinal = streamed.at(-1) as ModelFinalResult | undefined;

    expect(complete.safeError).toEqual(expect.objectContaining({ code, retryable: false }));
    expect(streamFinal?.safeError).toEqual(expect.objectContaining({ code, retryable: false }));
    expect(afterModelHookCalls).toBe(0);
  });

  it('passes truncated-tool-call terminals through to the output recovery chain', async () => {
    let afterModelHookCalls = 0;
    const truncated: ModelFinalResult = {
      content: '',
      finishReason: 'tool-calls',
      incompleteOutputReason: 'truncated-tool-call',
      usage: { inputTokens: 12_897, outputTokens: 16_384, totalTokens: 29_281 },
    };
    const service = createLifecycleHookModelInvocationService(
      terminalModel(truncated),
      countingAfterModelHook(() => {
        afterModelHookCalls += 1;
      }),
    );

    const complete = await service.complete(modelRequest(), new AbortController().signal);
    const streamed = await collectStream(service);
    const streamFinal = streamed.at(-1) as ModelFinalResult | undefined;

    expect(complete).toEqual(truncated);
    expect(complete.safeError).toBeUndefined();
    expect(streamFinal).toEqual(truncated);
    expect(streamFinal?.safeError).toBeUndefined();
    expect(afterModelHookCalls).toBe(2);
  });

  it('rejects an empty tool-calls terminal with a mismatched output-limit reason', async () => {
    let afterModelHookCalls = 0;
    const malformed: ModelFinalResult = {
      content: '',
      finishReason: 'tool-calls',
      incompleteOutputReason: 'output-limit',
    };
    const service = createLifecycleHookModelInvocationService(
      terminalModel(malformed),
      countingAfterModelHook(() => {
        afterModelHookCalls += 1;
      }),
    );

    const complete = await service.complete(modelRequest(), new AbortController().signal);
    const streamed = await collectStream(service);
    const streamFinal = streamed.at(-1) as ModelFinalResult | undefined;

    expect(complete.safeError).toEqual(expect.objectContaining({ code: 'MODEL_TOOL_CALLS_MISSING', retryable: false }));
    expect(streamFinal?.safeError).toEqual(expect.objectContaining({ code: 'MODEL_TOOL_CALLS_MISSING', retryable: false }));
    expect(afterModelHookCalls).toBe(0);
  });

  it('accepts tool calls with a stop finish reason', async () => {
    let afterModelHookCalls = 0;
    const result: ModelFinalResult = {
      content: '',
      finishReason: 'stop',
      toolCalls: [{ toolCallId: 'call-1', toolName: 'Read', arguments: { path: 'alarm.log' } }],
    };
    const service = createLifecycleHookModelInvocationService(
      terminalModel(result),
      countingAfterModelHook(() => {
        afterModelHookCalls += 1;
      }),
    );

    const complete = await service.complete(modelRequest(), new AbortController().signal);
    const streamed = await collectStream(service);

    expect(complete).toEqual(result);
    expect(streamed).toEqual([result]);
    expect(afterModelHookCalls).toBe(2);
  });

  it('rejects malformed requests before lifecycle hooks and provider execution', async () => {
    let hookCalls = 0;
    let innerCalls = 0;
    const hook: LifecycleHookInvocationPort = {
      async invoke<S extends LifecycleStage>(request: LifecycleHookInvocationRequest<S>): Promise<LifecycleHookInvocationResult<S>> {
        hookCalls += 1;
        return { status: 'CONTINUE', boundary: request.boundary };
      },
    };
    const inner: ModelInvocationService = {
      async complete(): Promise<ModelFinalResult> {
        innerCalls += 1;
        return { content: 'should not run' };
      },
      stream: modelEventStreamFixture(async function* () {
        innerCalls += 1;
        yield { content: 'should not run' };
      }),
    };
    const service = createLifecycleHookModelInvocationService(inner, hook);
    const malformed = {
      ...modelRequest(),
      messages: null,
    } as unknown as ModelInvocationRequest;

    await expect(service.complete(malformed, new AbortController().signal)).resolves.toMatchObject({
      safeError: { code: 'MODEL_MESSAGES_INVALID', category: 'VALIDATION' },
    });
    const streamed = await collectModelStream(service, malformed, new AbortController().signal);

    expect(streamed).toEqual([
      expect.objectContaining({
        safeError: expect.objectContaining({
          code: 'MODEL_MESSAGES_INVALID',
          category: 'VALIDATION',
        }),
      }),
    ]);
    expect(hookCalls).toBe(0);
    expect(innerCalls).toBe(0);
  });

  it('throws lifecycle hook interruption as an Error subclass', async () => {
    const hook: LifecycleHookInvocationPort = {
      async invoke<S extends LifecycleStage>(request: LifecycleHookInvocationRequest<S>): Promise<LifecycleHookInvocationResult<S>> {
        if (request.stage === 'BEFORE_MODEL_INVOKE') {
          return {
            status: 'INTERRUPT',
            interruption: {
              stage: request.stage,
              hookInvocationId: 'hook-model-interrupt',
              outcome: 'BLOCK',
              safeReason: 'blocked-before-provider',
            },
          };
        }
        return { status: 'CONTINUE', boundary: request.boundary };
      },
    };
    const inner: ModelInvocationService = {
      async complete(): Promise<ModelFinalResult> {
        throw new Error('provider should not be called');
      },
      stream: modelEventStreamFixture(async function* () {
        throw new Error('provider should not be called');
      }),
    };
    const service = createLifecycleHookModelInvocationService(inner, hook);

    await expect(service.complete(modelRequest(), new AbortController().signal)).rejects.toBeInstanceOf(LifecycleHookInterruptionError);
    await expect(service.complete(modelRequest(), new AbortController().signal)).rejects.toMatchObject({
      interruption: expect.objectContaining({
        hookInvocationId: 'hook-model-interrupt',
        outcome: 'BLOCK',
      }),
    });
  });

  it('normalizes unexpected hook failures but preserves stream consumer failures', async () => {
    const hookFailure = new Error('private hook failure');
    const failingHook: LifecycleHookInvocationPort = {
      async invoke() {
        throw hookFailure;
      },
    };
    const inner: ModelInvocationService = {
      async complete() {
        return { content: 'ok', finishReason: 'stop' };
      },
      async stream(_request, _signal, onDelta) {
        await onDelta({ content: 'partial' });
        return { content: 'partial', finishReason: 'stop' };
      },
    };
    const failingService = createLifecycleHookModelInvocationService(inner, failingHook);

    await expect(failingService.complete(modelRequest(), new AbortController().signal)).resolves.toMatchObject({
      safeError: { code: 'MODEL_INTERNAL_ERROR', category: 'INTERNAL' },
    });

    const consumerFailure = new Error('consumer stopped projection');
    const service = createLifecycleHookModelInvocationService(inner, passthroughHook());
    await expect(
      service.stream(modelRequest(), new AbortController().signal, async () => {
        throw consumerFailure;
      }),
    ).rejects.toBe(consumerFailure);
  });
});

function terminalModel(result: ModelFinalResult): ModelInvocationService {
  return {
    async complete(): Promise<ModelFinalResult> {
      return result;
    },
    stream: modelEventStreamFixture(async function* () {
      yield result;
    }),
  };
}

function countingAfterModelHook(onAfterModelResult: () => void): LifecycleHookInvocationPort {
  return {
    async invoke<S extends LifecycleStage>(request: LifecycleHookInvocationRequest<S>): Promise<LifecycleHookInvocationResult<S>> {
      if (request.stage === 'AFTER_MODEL_RESULT') {
        onAfterModelResult();
      }
      return { status: 'CONTINUE', boundary: request.boundary };
    },
  };
}

function passthroughHook(): LifecycleHookInvocationPort {
  return {
    async invoke<S extends LifecycleStage>(request: LifecycleHookInvocationRequest<S>): Promise<LifecycleHookInvocationResult<S>> {
      return { status: 'CONTINUE', boundary: request.boundary };
    },
  };
}

async function collectStream(service: ModelInvocationService): Promise<Array<ModelStreamDelta | ModelFinalResult>> {
  return await collectModelStream(service, modelRequest(), new AbortController().signal);
}

function modelRequest(): ModelInvocationRequest {
  return {
    invocationScope: {
      tenantId: brand<string, 'TenantId'>('tenant-model-hook'),
      subjectId: brand<string, 'SubjectId'>('subject-model-hook'),
      agentId: brand<string, 'AgentId'>('agent-model-hook'),
      agentVersion: brand<string, 'AgentVersion'>('v1'),
      agentAssemblyRef: 'agent-model-hook:v1',
      operationId: 'step-model-hook',
      sessionId: brand<string, 'SessionId'>('session-model-hook'),
      requestId: brand<string, 'MessageId'>('request-model-hook'),
      runId: brand<string, 'RequestRunId'>('run-model-hook'),
    },
    modelId: 'diagnostic-model',
    messages: [{ role: 'USER', content: [{ type: 'text', text: 'diagnose' }] }],
    tools: [],
    timeoutMs: 30_000,
  };
}
