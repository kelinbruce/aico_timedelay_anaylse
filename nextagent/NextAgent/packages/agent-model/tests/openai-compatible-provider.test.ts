import { brand } from '@nextagent/agent-common';
import type { ModelFinalResult, ModelInvocationRequest, ModelInvocationService, ModelStreamDelta } from '@nextagent/agent-contracts/model';
import type { ExecutionCorrelationPort } from '@nextagent/agent-contracts/observability';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { describe, expect, it, vi } from 'vitest';
import { collectModelStream } from '../../../tests/helpers/model-stream-fixture.js';
import { createOpenAICompatibleModelProviderRegistration } from '../src/providers/openai-compatible/registration.js';

describe('OpenAI-compatible AI SDK adapter', () => {
  it('omits the Gateway-only lazy model information resolver', () => {
    const runtime = createOpenAICompatibleModelProviderRegistration({
      credentialResolver: async () => 'resolved-secret',
    }).createRuntime({
      providerId: 'openai-compatible',
      baseUrl: 'https://provider.example/v1',
      models: [
        {
          modelId: 'compatible-model',
          contextWindowTokens: 64_000,
          fallbackEligible: false,
        },
      ],
    });

    expect(runtime).not.toHaveProperty('resolveModel');
  });

  it('uses Chat Completions with canonical options, governed provider options and exact correlation headers', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const model = createModel(async (url, init) => {
      calls.push({ url: String(url), init: init ?? {} });
      return completionResponse('diagnosis complete');
    });

    const result = await model.complete(
      {
        ...request(),
        temperature: 0.1,
        maxOutputTokens: 1024,
        topP: 0.9,
        topK: 40,
        presencePenalty: 0.2,
        frequencyPenalty: -0.1,
        thinking: { depth: 'HIGH' },
        providerOptions: {
          user: 'safe-user',
          parallel_tool_calls: false,
          service_tier: 'priority',
          prompt_cache_key: 'cache-key',
          vendor_cache_mode: 'ephemeral',
        },
      },
      new AbortController().signal,
    );

    expect(result).toMatchObject({
      content: 'diagnosis complete',
      finishReason: 'stop',
      usage: { inputTokens: 3, outputTokens: 2, totalTokens: 5 },
      providerResponseId: 'response-1',
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe('https://provider.example/v1/chat/completions');
    const headers = headerRecord(calls[0]?.init.headers);
    expect(headers).toMatchObject({
      authorization: 'Bearer resolved-secret',
      'x-nextagent-agent-id': 'agent-model',
      'x-nextagent-session-id': 'session-model',
      'x-nextagent-request-id': 'request-model',
      'x-nextagent-run-id': 'run-model',
    });
    const body = JSON.parse(String(calls[0]?.init.body)) as Record<string, unknown>;
    expect(body).toMatchObject({
      model: 'compatible-model',
      temperature: 0.1,
      max_tokens: 1024,
      top_p: 0.9,
      top_k: 40,
      presence_penalty: 0.2,
      frequency_penalty: -0.1,
      reasoning_effort: 'high',
      parallel_tool_calls: false,
      service_tier: 'priority',
      prompt_cache_key: 'cache-key',
      user: 'safe-user',
      vendor_cache_mode: 'ephemeral',
    });
    expect(JSON.stringify(body)).not.toContain('tenant-model');
    expect(JSON.stringify(body)).not.toContain('request-model');
    expect(JSON.stringify(body)).not.toContain('run-model');
    expect(JSON.stringify(body)).not.toContain('turn-1');
  });

  it('uses the AI SDK system option without warnings while preserving system-only requests', async () => {
    const bodies: Array<Record<string, unknown>> = [];
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const model = createModel(async (_url, init) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      bodies.push(body);
      if (body.stream === true) {
        return new Response(
          sse([
            {
              id: 'response-system-stream',
              model: 'compatible-model',
              choices: [{ index: 0, delta: { content: 'streamed' }, finish_reason: 'stop' }],
            },
            '[DONE]',
          ]),
          {
            status: 200,
            headers: { 'Content-Type': 'text/event-stream' },
          },
        );
      }
      return completionResponse('completed');
    });
    const invocation = request();
    const mixedMessages: ModelInvocationRequest['messages'] = [
      { role: 'SYSTEM', content: [{ type: 'text', text: 'Follow trusted telecom policy.' }] },
      ...invocation.messages,
    ];
    let warningOutput = '';

    try {
      await model.complete({ ...invocation, messages: mixedMessages }, new AbortController().signal);
      await collectModelStream(model, { ...invocation, messages: mixedMessages }, new AbortController().signal);
      await model.complete(
        {
          ...invocation,
          messages: [{ role: 'SYSTEM', content: [{ type: 'text', text: 'Produce a health summary.' }] }],
        },
        new AbortController().signal,
      );
      warningOutput = warning.mock.calls.flat().join(' ');
    } finally {
      warning.mockRestore();
    }

    expect(bodies).toHaveLength(3);
    expect(messageRoles(bodies[0])).toEqual(['system', 'user']);
    expect(messageRoles(bodies[1])).toEqual(['system', 'user']);
    expect(messageRoles(bodies[2])).toEqual(['system']);
    expect(warningOutput).not.toContain('System messages in the prompt or messages fields');
  });

  it('maps canonical NONE while retaining tool descriptors and rejects REQUIRED without tools before transport', async () => {
    const bodies: Array<Record<string, unknown>> = [];
    const fetchImpl = vi.fn(async (_url, init) => {
      bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      return completionResponse('done');
    });
    const model = createModel(fetchImpl);

    await model.complete(
      {
        ...request(),
        toolChoice: 'NONE',
        tools: [{ capabilityId: 'read', name: 'Read', inputSchema: { type: 'object' } }],
      },
      new AbortController().signal,
    );
    const required = await model.complete({ ...request(), toolChoice: 'REQUIRED' }, new AbortController().signal);

    expect(bodies[0]).toMatchObject({ tool_choice: 'none' });
    expect(bodies[0]?.['tools']).toEqual(expect.any(Array));
    expect(required).toMatchObject({
      safeError: { code: 'MODEL_TOOL_CHOICE_REQUIRED_WITHOUT_TOOLS', category: 'VALIDATION', retryable: false },
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('injects enable_thinking false and chat_template_kwargs when thinking is OFF', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const model = createModel(async (url, init) => {
      calls.push({ url: String(url), init: init ?? {} });
      return completionResponse('ok');
    });
    const result = await model.complete(
      {
        ...request(),
        thinking: { depth: 'OFF' },
      },
      new AbortController().signal,
    );

    expect(result.safeError).toBeUndefined();
    expect(result.content).toBe('ok');
    expect(calls).toHaveLength(1);
    const body = JSON.parse(String(calls[0]?.init.body)) as Record<string, unknown>;
    expect(body).toMatchObject({ enable_thinking: false, chat_template_kwargs: { enable_thinking: false } });
    expect(body).not.toHaveProperty('reasoning_effort');
  });

  it('does not inject reasoning fields when thinking is undefined', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const model = createModel(async (url, init) => {
      calls.push({ url: String(url), init: init ?? {} });
      return completionResponse('ok');
    });
    await model.complete(request(), new AbortController().signal);

    const body = JSON.parse(String(calls[0]?.init.body)) as Record<string, unknown>;
    expect(body).not.toHaveProperty('reasoning_effort');
    expect(body).not.toHaveProperty('enable_thinking');
  });

  it('omits run headers for background scope while preserving the Agent header', async () => {
    let captured: RequestInit | undefined;
    const model = createModel(async (_url, init) => {
      captured = init;
      return completionResponse('background');
    });
    const invocation = request();
    const result = await model.complete(
      {
        ...invocation,
        invocationScope: {
          tenantId: invocation.invocationScope.tenantId,
          subjectId: invocation.invocationScope.subjectId,
          agentId: invocation.invocationScope.agentId,
          agentVersion: invocation.invocationScope.agentVersion,
          agentAssemblyRef: invocation.invocationScope.agentAssemblyRef,
          operationId: 'memory-cycle-1',
        },
      },
      new AbortController().signal,
    );

    expect(result.content).toBe('background');
    const headers = headerRecord(captured?.headers);
    expect(headers['x-nextagent-agent-id']).toBe('agent-model');
    expect(headers).not.toHaveProperty('x-nextagent-session-id');
    expect(headers).not.toHaveProperty('x-nextagent-request-id');
    expect(headers).not.toHaveProperty('x-nextagent-run-id');
  });

  it('adds the active W3C trace carrier at the physical provider request boundary', async () => {
    let captured: RequestInit | undefined;
    const executionCorrelation: ExecutionCorrelationPort = {
      async withIncomingCarrier(_carrier, operation) {
        return operation();
      },
      async withExecutionRef(_ref, operation) {
        return operation();
      },
      outboundHeaders(headers) {
        return {
          ...headers,
          traceparent: '00-0123456789abcdef0123456789abcdef-0123456789abcdef-01',
          tracestate: 'nextagent=test',
        };
      },
    };
    const model = createModel(
      async (_url, init) => {
        captured = init;
        return completionResponse('traced');
      },
      undefined,
      executionCorrelation,
    );

    await model.complete(request(), new AbortController().signal);

    expect(headerRecord(captured?.headers)).toMatchObject({
      traceparent: '00-0123456789abcdef0123456789abcdef-0123456789abcdef-01',
      tracestate: 'nextagent=test',
      'x-nextagent-agent-id': 'agent-model',
      'x-nextagent-run-id': 'run-model',
    });
  });

  it('sends the trusted raw Agent id without requiring an opaque header mapping', async () => {
    let captured: RequestInit | undefined;
    const model = createModel(async (_url, init) => {
      captured = init;
      return completionResponse('raw agent id');
    });
    const invocation = request();

    await model.complete(
      {
        ...invocation,
        invocationScope: {
          ...invocation.invocationScope,
          agentId: brand<string, 'AgentId'>('telecom-agent/model-01'),
        },
      },
      new AbortController().signal,
    );

    expect(headerRecord(captured?.headers)['x-nextagent-agent-id']).toBe('telecom-agent/model-01');
  });

  it('uses the platform fetch when no FetchGateway is assembled', async () => {
    const platformFetch = vi.fn(async () => completionResponse('platform fetch'));
    vi.stubGlobal('fetch', platformFetch);
    try {
      const result = await createModel().complete(request(), new AbortController().signal);
      expect(result.content).toBe('platform fetch');
      expect(platformFetch).toHaveBeenCalledOnce();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('uses the platform fetch to reach an IPv6 literal provider endpoint over a real socket', async () => {
    let receivedRequest = false;
    const server = createServer((_request, response) => {
      receivedRequest = true;
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify(completionBody('IPv6 provider response')));
    });
    try {
      const port = await listenOnIpv6Loopback(server);
      const result = await createModel(undefined, undefined, undefined, `http://[::1]:${port}/v1`).complete(request(), new AbortController().signal);

      expect(result.content).toBe('IPv6 provider response');
      expect(receivedRequest).toBe(true);
    } finally {
      await closeServer(server);
    }
  });

  it('does not expose an AI SDK synthesized response id as a provider response id', async () => {
    const model = createModel(
      async () =>
        new Response(
          JSON.stringify({
            object: 'chat.completion',
            created: 0,
            model: 'compatible-model',
            choices: [
              {
                index: 0,
                message: { role: 'assistant', content: 'answer' },
                finish_reason: 'stop',
              },
            ],
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          },
        ),
    );

    await expect(model.complete(request(), new AbortController().signal)).resolves.not.toHaveProperty('providerResponseId');
  });

  it('normalizes streamed reasoning, visible content, usage and terminal facts', async () => {
    const model = createModel(
      async () =>
        new Response(
          sse([
            {
              id: 'response-stream',
              model: 'compatible-model',
              choices: [{ index: 0, delta: { reasoning_content: 'inspect ' } }],
            },
            {
              id: 'response-stream',
              model: 'compatible-model',
              choices: [{ index: 0, delta: { content: 'answer' }, finish_reason: 'stop' }],
            },
            {
              id: 'response-stream',
              model: 'compatible-model',
              choices: [],
              usage: { prompt_tokens: 4, completion_tokens: 2, total_tokens: 6 },
            },
            '[DONE]',
          ]),
          {
            status: 200,
            headers: { 'Content-Type': 'text/event-stream' },
          },
        ),
    );

    const events = await collectModelStream(model, request(), new AbortController().signal);

    expect(events).toContainEqual({ reasoning: 'inspect ' });
    expect(events).toContainEqual({ content: 'answer' });
    expect(events.at(-1)).toMatchObject({
      content: 'answer',
      reasoning: 'inspect ',
      finishReason: 'stop',
      usage: { inputTokens: 4, outputTokens: 2, totalTokens: 6 },
      providerResponseId: 'response-stream',
    });
    expect(events.at(-1)).not.toHaveProperty('providerModelId');
  });

  it('uses the AI SDK reasoning middleware for non-streamed think markup', async () => {
    const model = createModel(async () => completionResponse('<think>inspect</think>answer'));

    await expect(model.complete(request(), new AbortController().signal)).resolves.toMatchObject({
      content: 'answer',
      reasoning: 'inspect',
      finishReason: 'stop',
    });
  });

  it('uses the AI SDK reasoning middleware across streamed think-tag boundaries', async () => {
    const model = createModel(
      async () =>
        new Response(
          sse([
            {
              id: 'response-think-stream',
              model: 'compatible-model',
              choices: [{ index: 0, delta: { content: '<thi' } }],
            },
            {
              id: 'response-think-stream',
              model: 'compatible-model',
              choices: [{ index: 0, delta: { content: 'nk>inspect</th' } }],
            },
            {
              id: 'response-think-stream',
              model: 'compatible-model',
              choices: [{ index: 0, delta: { content: 'ink>answer' }, finish_reason: 'stop' }],
            },
            '[DONE]',
          ]),
          {
            status: 200,
            headers: { 'Content-Type': 'text/event-stream' },
          },
        ),
    );

    const events = await collectModelStream(model, request(), new AbortController().signal);
    const deltas = events.slice(0, -1) as ModelStreamDelta[];
    expect(deltas.map((delta) => delta.reasoning ?? '').join('')).toBe('inspect');
    expect(deltas.map((delta) => delta.content ?? '').join('')).toBe('answer');
    expect(events.at(-1)).toMatchObject({
      content: 'answer',
      reasoning: 'inspect',
      finishReason: 'stop',
    });
  });

  it('normalizes a non-streamed implicit reasoning start selected by the model profile', async () => {
    const model = createModel(async () => completionResponse('inspect</think>answer'), undefined, undefined, undefined, 'IMPLICIT_OPEN_THINK_TAG');

    await expect(model.complete(request(), new AbortController().signal)).resolves.toMatchObject({
      content: 'answer',
      reasoning: 'inspect',
      finishReason: 'stop',
    });
  });

  it('normalizes a streamed implicit reasoning start across closing-tag boundaries', async () => {
    const model = createModel(
      async () =>
        new Response(
          sse([
            {
              id: 'response-implicit-think-stream',
              model: 'compatible-model',
              choices: [{ index: 0, delta: { content: 'inspect' } }],
            },
            {
              id: 'response-implicit-think-stream',
              model: 'compatible-model',
              choices: [{ index: 0, delta: { content: '</thi' } }],
            },
            {
              id: 'response-implicit-think-stream',
              model: 'compatible-model',
              choices: [{ index: 0, delta: { content: 'nk>answer' }, finish_reason: 'stop' }],
            },
            '[DONE]',
          ]),
          {
            status: 200,
            headers: { 'Content-Type': 'text/event-stream' },
          },
        ),
      undefined,
      undefined,
      undefined,
      'IMPLICIT_OPEN_THINK_TAG',
    );

    const events = await collectModelStream(model, request(), new AbortController().signal);
    const deltas = events.slice(0, -1) as ModelStreamDelta[];
    expect(deltas.map((delta) => delta.reasoning ?? '').join('')).toBe('inspect');
    expect(deltas.map((delta) => delta.content ?? '').join('')).toBe('answer');
    expect(events.at(-1)).toMatchObject({
      content: 'answer',
      reasoning: 'inspect',
      finishReason: 'stop',
    });
  });

  it.each([
    ['stop', 'stop'],
    ['tool_calls', 'tool-calls'],
  ] as const)(
    'lets the AI SDK assemble fragmented streamed tool calls with provider finish reason %s',
    async (providerFinishReason, expectedFinishReason) => {
      const model = createModel(async () => streamedToolCallResponse(providerFinishReason));
      const invocation = {
        ...request(),
        tools: [
          {
            capabilityId: 'read',
            name: 'Read',
            inputSchema: { type: 'object' },
          },
        ],
      };

      const events = await collectModelStream(model, invocation, new AbortController().signal);
      const expectedToolCall = {
        toolCallId: 'tool-stream-1',
        toolName: 'Read',
        arguments: { file_path: 'package.json' },
      };

      expect(events).toContainEqual({ toolCall: expectedToolCall });
      expect(events.at(-1)).toMatchObject({
        content: '',
        finishReason: expectedFinishReason,
        toolCalls: [expectedToolCall],
      });
    },
  );

  it('propagates caller delta-handler failures without converting them to provider failures', async () => {
    const model = createModel(
      async () =>
        new Response(
          sse([
            {
              id: 'response-callback-failure',
              model: 'compatible-model',
              choices: [{ index: 0, delta: { content: 'answer' }, finish_reason: 'stop' }],
            },
            '[DONE]',
          ]),
          {
            status: 200,
            headers: { 'Content-Type': 'text/event-stream' },
          },
        ),
    );
    const failure = new Error('projection failed');

    await expect(
      model.stream(request(), new AbortController().signal, async () => {
        throw failure;
      }),
    ).rejects.toBe(failure);
  });

  it('does not retry after a public stream delta has been emitted', async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          sse([
            {
              id: 'response-stream-failure',
              model: 'compatible-model',
              choices: [{ index: 0, delta: { content: 'partial' } }],
            },
            {
              error: { message: 'temporary provider failure' },
            },
            '[DONE]',
          ]),
          {
            status: 200,
            headers: { 'Content-Type': 'text/event-stream' },
          },
        ),
    );
    const model = createModel(fetchImpl);
    const events = await collectModelStream(
      model,
      {
        ...request(),
        maxRetries: 2,
      },
      new AbortController().signal,
    );

    expect(events).toContainEqual({ content: 'partial' });
    expect(events.at(-1)).toMatchObject({
      safeError: expect.objectContaining({ category: 'INTERNAL', retryable: false }),
    });
    expect(JSON.stringify(events)).not.toContain('temporary provider failure');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('uses the AI SDK retry before a streamed response exposes any public delta', async () => {
    const fetchImpl = vi.fn(async () => {
      if (fetchImpl.mock.calls.length === 1) {
        return new Response(JSON.stringify({ error: { message: 'temporary' } }), {
          status: 503,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(
        sse([
          {
            id: 'response-stream-retry',
            model: 'compatible-model',
            choices: [{ index: 0, delta: { content: 'recovered' }, finish_reason: 'stop' }],
          },
          '[DONE]',
        ]),
        {
          status: 200,
          headers: { 'Content-Type': 'text/event-stream' },
        },
      );
    });
    const model = createModel(fetchImpl);

    const events = await collectModelStream(
      model,
      {
        ...request(),
        maxRetries: 1,
      },
      new AbortController().signal,
    );

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(events).toContainEqual({ content: 'recovered' });
    expect(events.at(-1)).toMatchObject({ content: 'recovered', finishReason: 'stop' });
  });

  it('normalizes complete tool calls and rejects invalid tool arguments safely', async () => {
    const valid = createModel(async () => toolCompletionResponse('{"file_path":"package.json"}'));
    await expect(
      valid.complete(
        {
          ...request(),
          tools: [
            {
              capabilityId: 'read',
              name: 'Read',
              inputSchema: { type: 'object' },
            },
          ],
        },
        new AbortController().signal,
      ),
    ).resolves.toMatchObject({
      finishReason: 'tool-calls',
      toolCalls: [
        {
          toolCallId: 'tool-1',
          toolName: 'Read',
          arguments: { file_path: 'package.json' },
        },
      ],
    });

    const invalid = createModel(async () => toolCompletionResponse('not-json'));
    await expect(
      invalid.complete(
        {
          ...request(),
          tools: [
            {
              capabilityId: 'read',
              name: 'Read',
              inputSchema: { type: 'object' },
            },
          ],
        },
        new AbortController().signal,
      ),
    ).resolves.toMatchObject({
      safeError: { code: 'MODEL_TOOL_ARGUMENTS_INVALID', category: 'VALIDATION' },
    });
  });

  it.each(['tool_calls', 'stop', 'provider-specific'])(
    'classifies saturated invalid tool arguments for %s without rewriting the finish reason',
    async (reason) => {
      const model = createModel(async () => toolCompletionResponse('not-json', reason, 2_048));
      await expect(
        model.complete(
          {
            ...request(),
            maxOutputTokens: 2_048,
            tools: [{ capabilityId: 'read', name: 'Read', inputSchema: { type: 'object' } }],
          },
          new AbortController().signal,
        ),
      ).resolves.toMatchObject({
        finishReason: reason === 'tool_calls' ? 'tool-calls' : reason === 'stop' ? 'stop' : 'unknown',
        incompleteOutputReason: 'truncated-tool-call',
        usage: { outputTokens: 2_048 },
      });
    },
  );

  it('does not infer truncation when invalid tool arguments are below budget', async () => {
    const model = createModel(async () => toolCompletionResponse('not-json', 'tool_calls', 2_047));
    await expect(
      model.complete(
        { ...request(), maxOutputTokens: 2_048, tools: [{ capabilityId: 'read', name: 'Read', inputSchema: { type: 'object' } }] },
        new AbortController().signal,
      ),
    ).resolves.toMatchObject({ safeError: { code: 'MODEL_TOOL_ARGUMENTS_INVALID' } });
  });

  it('preserves a provider stop finish reason when complete output also contains tool calls', async () => {
    const model = createModel(async () => toolCompletionResponse('{"file_path":"package.json"}', 'stop'));

    await expect(
      model.complete(
        {
          ...request(),
          tools: [
            {
              capabilityId: 'read',
              name: 'Read',
              inputSchema: { type: 'object' },
            },
          ],
        },
        new AbortController().signal,
      ),
    ).resolves.toMatchObject({
      finishReason: 'stop',
      toolCalls: [{ toolCallId: 'tool-1', toolName: 'Read' }],
    });
  });

  it('uses the AI SDK as the single same-model retry owner', async () => {
    let attempts = 0;
    const model = createModel(async () => {
      attempts += 1;
      return attempts === 1
        ? new Response(JSON.stringify({ error: { message: 'temporary' } }), {
            status: 503,
            headers: { 'Content-Type': 'application/json' },
          })
        : completionResponse('retried');
    });

    await expect(
      model.complete(
        {
          ...request(),
          maxRetries: 1,
        },
        new AbortController().signal,
      ),
    ).resolves.toMatchObject({ content: 'retried' });
    expect(attempts).toBe(2);
  });

  it('does not retry non-recoverable failures', async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(JSON.stringify({ error: { message: 'invalid request', type: 'invalid_request_error' } }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        }),
    );
    const result = await createModel(fetchImpl).complete(
      {
        ...request(),
        maxRetries: 2,
      },
      new AbortController().signal,
    );

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(result.safeError).toMatchObject({ retryable: false });
    expect(JSON.stringify(result)).not.toContain('invalid request');
  });

  it('uses one total timeout across transport and same-model retry', async () => {
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      await new Promise<void>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true });
      });
      return completionResponse('should not run');
    });
    const model = createModel(fetchImpl);

    const result = await model.complete(
      {
        ...request(),
        timeoutMs: 20,
        maxRetries: 2,
      },
      new AbortController().signal,
    );

    expect(result).toMatchObject({
      safeError: { code: 'MODEL_TIMEOUT', category: 'TIMEOUT', retryable: true },
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('uses the AI SDK total timeout for streaming provider execution', async () => {
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      await new Promise<void>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true });
      });
      return completionResponse('should not run');
    });
    const model = createModel(fetchImpl);

    const events = await collectModelStream(
      model,
      {
        ...request(),
        timeoutMs: 20,
        maxRetries: 2,
      },
      new AbortController().signal,
    );

    expect(events.at(-1)).toMatchObject({
      safeError: { code: 'MODEL_TIMEOUT', category: 'TIMEOUT', retryable: true },
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('allows existing modelParams passthrough and rejects only reserved authority collisions before transport', async () => {
    const fetchImpl = vi.fn(async () => completionResponse('should not run'));
    const invalidOptions = createModel(fetchImpl);
    for (const reservedOption of [
      'model',
      'maxOutputTokens',
      'max_tokens',
      'reasoningEffort',
      'reasoning_effort',
      'toolChoice',
      'tool_choice',
      'headers',
      'fetch',
      'agentId',
    ]) {
      await expect(
        invalidOptions.complete(
          {
            ...request(),
            providerOptions: { [reservedOption]: 'untrusted' },
          },
          new AbortController().signal,
        ),
      ).resolves.toMatchObject({
        safeError: { code: 'MODEL_PROVIDER_OPTIONS_INVALID', category: 'VALIDATION' },
      });
    }
    for (const reservedOption of ['toolChoice', 'tool_choice', 'TOOL-CHOICE']) {
      await expect(
        invalidOptions.complete(
          {
            ...request(),
            modelParams: { [reservedOption]: 'none' },
          },
          new AbortController().signal,
        ),
      ).resolves.toMatchObject({
        safeError: { code: 'MODEL_PROVIDER_OPTIONS_INVALID', category: 'VALIDATION' },
      });
    }
    await expect(
      invalidOptions.complete(
        {
          ...request(),
          modelParams: { temperature: 0.4, max_tokens: 1_024 },
        },
        new AbortController().signal,
      ),
    ).resolves.toMatchObject({ content: 'should not run' });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('rejects closed-schema violations safely before transport', async () => {
    const fetchImpl = vi.fn(async () => completionResponse('should not run'));
    const model = createModel(fetchImpl);
    const valid = request();
    const invalidRequests: readonly unknown[] = [
      null,
      {
        ...valid,
        messages: null,
      },
      {
        ...valid,
        tools: null,
      },
      {
        ...valid,
        tools: [
          {
            capabilityId: 'unsafe-control',
            name: 'unsafe\u0085name',
            inputSchema: { type: 'object' },
          },
        ],
      },
      {
        ...valid,
        thinking: { depth: 'LOW', unknown: true },
      },
      {
        ...valid,
        invocationScope: { ...valid.invocationScope, unknown: true },
      },
      {
        ...valid,
        messages: [
          {
            ...valid.messages[0],
            unknown: true,
          },
        ],
      },
    ];

    for (const invalidRequest of invalidRequests) {
      await expect(model.complete(invalidRequest as ModelInvocationRequest, new AbortController().signal)).resolves.toMatchObject({
        safeError: { category: 'VALIDATION' },
      });
    }
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('does not project untrusted provider error codes or raw exception values', async () => {
    const fetchImpl = vi.fn(async () => completionResponse('should not run'));
    const providerError = {
      code: 'token=secret C:/provider/model.ts',
      category: 'INTERNAL',
      retryable: false,
    };
    const model = createModel(fetchImpl, async () => Promise.reject(providerError));

    const result = await model.complete(request(), new AbortController().signal);

    expect(result).toMatchObject({
      safeError: {
        code: 'MODEL_INTERNAL_ERROR',
        message: 'Model invocation failed safely.',
        category: 'INTERNAL',
        retryable: false,
      },
    });
    expect(JSON.stringify(result)).not.toContain('secret');
    expect(JSON.stringify(result)).not.toContain('model.ts');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('honors pre-aborted cancellation without resolving credentials or starting transport', async () => {
    const fetchImpl = vi.fn(async () => completionResponse('should not run'));
    const credentialResolver = vi.fn(async () => 'resolved-secret');
    const model = createModel(fetchImpl, credentialResolver);
    const controller = new AbortController();
    controller.abort(new DOMException('canceled', 'AbortError'));

    await expect(model.complete(request(), controller.signal)).resolves.toMatchObject({
      safeError: { code: 'MODEL_ABORTED', category: 'CANCELED' },
    });
    const stream = await collectModelStream(model, request(), controller.signal);
    expect(stream).toEqual([
      expect.objectContaining({
        safeError: expect.objectContaining({ code: 'MODEL_ABORTED', category: 'CANCELED' }),
      }),
    ]);
    expect(credentialResolver).not.toHaveBeenCalled();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('returns a safe unavailable result when the optional invocation module is invalid', async () => {
    vi.resetModules();
    vi.doMock('../src/providers/openai-compatible/openai-compatible-provider.js', () => ({
      createOpenAICompatibleModelInvocationService: 'not-a-function',
    }));
    const { createOpenAICompatibleModelProviderRegistration: createRegistration } =
      await import('../src/providers/openai-compatible/registration.js');
    const model = createRegistration({ credentialResolver: async () => 'resolved-secret' }).createRuntime({
      providerId: 'openai-compatible',
      baseUrl: 'https://provider.example/v1',
      models: [{ modelId: 'compatible-model', contextWindowTokens: 64_000, fallbackEligible: false }],
    }).invocationService;

    await expect(model.complete(request(), new AbortController().signal)).resolves.toMatchObject({
      content: '',
      safeError: { code: 'MODEL_PROVIDER_IMPLEMENTATION_UNAVAILABLE', category: 'UNAVAILABLE' },
    });
    vi.doUnmock('../src/providers/openai-compatible/openai-compatible-provider.js');
  });
});

function createModel(
  fetchImpl?: typeof fetch,
  credentialResolver: (() => Promise<string>) | undefined = async () => 'resolved-secret',
  executionCorrelation?: ExecutionCorrelationPort,
  baseUrl = 'https://provider.example/v1',
  reasoningTextMode?: 'EXPLICIT_THINK_TAG' | 'IMPLICIT_OPEN_THINK_TAG',
): ModelInvocationService {
  const registration = createOpenAICompatibleModelProviderRegistration({
    credentialResolver: credentialResolver ?? (async () => 'resolved-secret'),
    ...(executionCorrelation === undefined ? {} : { executionCorrelation }),
    ...(fetchImpl === undefined ? {} : { fetch: fetchImpl }),
  });
  const modelDefinition = {
    modelId: 'compatible-model',
    contextWindowTokens: 64_000,
    fallbackEligible: false,
    ...(reasoningTextMode === undefined ? {} : { reasoningTextMode }),
  };
  return registration.createRuntime({
    providerId: 'openai-compatible',
    baseUrl,
    credentialRef: brand<`env:${string}`, 'SecretReference'>('env:MODEL_TOKEN'),
    models: [modelDefinition],
  }).invocationService;
}

function request(): ModelInvocationRequest {
  return {
    invocationScope: {
      tenantId: brand<string, 'TenantId'>('tenant-model'),
      subjectId: brand<string, 'SubjectId'>('subject-model'),
      agentId: brand<string, 'AgentId'>('agent-model'),
      agentVersion: brand<string, 'AgentVersion'>('v1'),
      agentAssemblyRef: 'agent-model:v1',
      operationId: 'turn-1',
      sessionId: brand<string, 'SessionId'>('session-model'),
      requestId: brand<string, 'MessageId'>('request-model'),
      runId: brand<string, 'RequestRunId'>('run-model'),
    },
    modelId: 'compatible-model',
    messages: [{ role: 'USER', content: [{ type: 'text', text: 'diagnose LTE KPI' }] }],
    tools: [],
    timeoutMs: 30_000,
    maxRetries: 0,
  };
}

function messageRoles(body?: Record<string, unknown>): string[] {
  if (!Array.isArray(body?.messages)) {
    return [];
  }
  return body.messages.flatMap((message) => {
    if (message === null || typeof message !== 'object' || Array.isArray(message)) {
      return [];
    }
    const role = (message as Record<string, unknown>).role;
    return typeof role === 'string' ? [role] : [];
  });
}

function completionResponse(content: string): Response {
  return new Response(JSON.stringify(completionBody(content)), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

function completionBody(content: string): Record<string, unknown> {
  return {
    id: 'response-1',
    object: 'chat.completion',
    created: 0,
    model: 'compatible-model',
    choices: [
      {
        index: 0,
        message: { role: 'assistant', content },
        finish_reason: 'stop',
      },
    ],
    usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 },
  };
}

async function listenOnIpv6Loopback(server: Server): Promise<number> {
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '::1', () => {
      server.removeListener('error', reject);
      resolve();
    });
  });
  return (server.address() as AddressInfo).port;
}

async function closeServer(server: Server): Promise<void> {
  if (!server.listening) {
    return;
  }
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error === undefined ? resolve() : reject(error)));
  });
}

function toolCompletionResponse(argumentsText: string, finishReason = 'tool_calls', completionTokens = 2): Response {
  return new Response(
    JSON.stringify({
      id: 'response-tool',
      object: 'chat.completion',
      created: 0,
      model: 'compatible-model',
      choices: [
        {
          index: 0,
          message: {
            role: 'assistant',
            content: null,
            tool_calls: [
              {
                id: 'tool-1',
                type: 'function',
                function: { name: 'Read', arguments: argumentsText },
              },
            ],
          },
          finish_reason: finishReason,
        },
      ],
      usage: { prompt_tokens: 3, completion_tokens: completionTokens, total_tokens: 3 + completionTokens },
    }),
    {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    },
  );
}

function streamedToolCallResponse(finishReason: string): Response {
  return new Response(
    sse([
      {
        id: 'response-tool-stream',
        model: 'compatible-model',
        choices: [
          {
            index: 0,
            delta: {
              tool_calls: [
                {
                  index: 0,
                  id: 'tool-stream-1',
                  type: 'function',
                  function: { name: 'Read', arguments: '{"file_' },
                },
              ],
            },
          },
        ],
      },
      {
        id: 'response-tool-stream',
        model: 'compatible-model',
        choices: [
          {
            index: 0,
            delta: {
              tool_calls: [
                {
                  index: 0,
                  function: { arguments: 'path":"package.json"}' },
                },
              ],
            },
            finish_reason: finishReason,
          },
        ],
      },
      '[DONE]',
    ]),
    {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream' },
    },
  );
}

function sse(events: ReadonlyArray<Record<string, unknown> | string>): string {
  return events.map((event) => `data: ${typeof event === 'string' ? event : JSON.stringify(event)}\n\n`).join('');
}

function headerRecord(headers?: HeadersInit): Record<string, string> {
  const result: Record<string, string> = {};
  new Headers(headers).forEach((value, key) => {
    result[key] = value;
  });
  return result;
}
