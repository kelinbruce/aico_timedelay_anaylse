import { modelEventStreamFixture } from '../../../tests/helpers/model-stream-fixture.js';
import { brand, type JsonObject } from '@nextagent/agent-common';
import type { RecipeDefinition, WorkflowExecutionEvent, WorkflowExecutionRequest } from '@nextagent/agent-contracts/core';
import type { ModelInferenceOptions, ModelInvocationRequest, ModelInvocationService } from '@nextagent/agent-contracts/model';
import { describe, expect, it, vi } from 'vitest';
import { createWorkflowExecutionService, createWorkflowNodeCatalog } from '../src/index.js';

// ---------------------------------------------------------------------------
// Input handling
// ---------------------------------------------------------------------------
describe('LLM_ROUTER - input handling', () => {
  it('accepts a plain prompt field as the user message and returns free text output', async () => {
    const requests: ModelInvocationRequest[] = [];
    const service = createService({
      recipe: recipe({
        start: node('START', { ask: {} }),
        ask: node(
          'LLM_ROUTER',
          { end: {} },
          {
            inputs: { prompt: 'Summarize the alarm data.' },
            outputs: { raw: '${llm_completion}' },
          },
        ),
        end: node('END'),
      }),
      modelInvocation: captureModel(requests, { content: 'The network is stable.' }),
    });

    const result = await service.execute(baseRequest(), new AbortController().signal);

    expect(result.status).toBe('COMPLETED');
    expect(requests).toHaveLength(1);
    expect(result.outputVariables).toMatchObject({ raw: 'The network is stable.' });
  });

  it('uses prompt_template as the system prompt when provided', async () => {
    const requests: ModelInvocationRequest[] = [];
    const service = createService({
      recipe: recipe({
        start: node('START', { ask: {} }),
        ask: node(
          'LLM_ROUTER',
          { end: {} },
          {
            inputs: {
              prompt_template: 'You are a network assistant.',
              user_prompt: 'Check NE-1 status.',
            },
            outputs: { raw: '${llm_completion}' },
          },
        ),
        end: node('END'),
      }),
      modelInvocation: captureModel(requests, { content: 'NE-1 is online.' }),
    });

    const result = await service.execute(baseRequest(), new AbortController().signal);

    expect(result.status).toBe('COMPLETED');
    expect(requests[0]?.messages[0]?.role).toBe('SYSTEM');
    expect(requests[0]?.messages[0]?.content[0]).toMatchObject({ text: 'You are a network assistant.' });
    expect(requests[0]?.messages[1]?.role).toBe('USER');
    expect(requests[0]?.messages[1]?.content[0]).toMatchObject({ text: 'Check NE-1 status.' });
  });

  it('resolves variable interpolations in inputs from upstream node variables', async () => {
    const requests: ModelInvocationRequest[] = [];
    const service = createService({
      recipe: recipe({
        start: node('START', { set: {} }),
        set: node('TOOL', { ask: {} }),
        ask: node(
          'LLM_ROUTER',
          { end: {} },
          {
            inputs: {
              prompt_template: 'Template: ${topic}',
              prompt: 'Question: ${subject}',
            },
            outputs: { raw: '${llm_completion}' },
          },
        ),
        end: node('END'),
      }),
      nodeCatalog: {
        handlers: {
          TOOL: async () => ({ outputVariables: { topic: 'alarm', subject: 'NE-1' } }),
        },
      },
      modelInvocation: captureModel(requests, { content: 'OK' }),
    });

    const result = await service.execute(baseRequest(), new AbortController().signal);

    expect(result.status).toBe('COMPLETED');
    expect(requests[0]?.messages[0]?.content[0]).toMatchObject({ text: 'Template: alarm' });
    expect(requests[0]?.messages[1]?.content[0]).toMatchObject({ text: 'Question: NE-1' });
  });

  it('falls back to taskDescription when no prompt or text inputs are given', async () => {
    const requests: ModelInvocationRequest[] = [];
    const service = createService({
      recipe: recipe({
        start: node('START', { ask: {} }),
        ask: node(
          'LLM_ROUTER',
          { end: {} },
          {
            inputs: { taskDescription: 'Default fallback.' },
            outputs: { raw: '${llm_completion}' },
          },
        ),
        end: node('END'),
      }),
      modelInvocation: captureModel(requests, { content: 'used' }),
    });

    const result = await service.execute(baseRequest(), new AbortController().signal);

    expect(result.status).toBe('COMPLETED');
    expect(requests[0]?.messages[0]?.content[0]).toMatchObject({ text: 'Default fallback.' });
  });
});

// ---------------------------------------------------------------------------
// Output handling
// ---------------------------------------------------------------------------
describe('LLM_ROUTER - output handling', () => {
  it('returns free text when no output_schema is configured', async () => {
    const service = createService({
      recipe: recipe({
        start: node('START', { ask: {} }),
        ask: node(
          'LLM_ROUTER',
          { end: {} },
          {
            inputs: { prompt: 'Say OK.' },
            outputs: { raw: '${llm_completion}' },
          },
        ),
        end: node('END'),
      }),
      modelInvocation: captureModel([], { content: '  All good.  ' }),
    });

    const result = await service.execute(baseRequest(), new AbortController().signal);

    expect(result.status).toBe('COMPLETED');
    expect(result.outputVariables).toMatchObject({ raw: 'All good.' });
  });

  it('parses structured JSON output that matches the declared output_schema', async () => {
    const service = createService({
      recipe: recipe({
        start: node('START', { ask: {} }),
        ask: node(
          'LLM_ROUTER',
          { end: {} },
          {
            inputs: {
              prompt: 'Classify alarm severity.',
              output_schema: {
                type: 'object',
                properties: { severity: { type: 'string' } },
                required: ['severity'],
                additionalProperties: false,
              },
            },
            outputs: { level: '${llm_completion.severity}' },
          },
        ),
        end: node('END'),
      }),
      modelInvocation: captureModel([], { content: JSON.stringify({ severity: 'CRITICAL' }) }),
    });

    const result = await service.execute(baseRequest(), new AbortController().signal);

    expect(result.status).toBe('COMPLETED');
    expect(result.outputVariables).toMatchObject({ level: 'CRITICAL' });
  });

  it('handles JSON output wrapped in a fenced code block', async () => {
    const service = createService({
      recipe: recipe({
        start: node('START', { ask: {} }),
        ask: node(
          'LLM_ROUTER',
          { end: {} },
          {
            inputs: {
              prompt: 'Yield severity.',
              output_schema: {
                type: 'object',
                properties: { severity: { type: 'string' } },
                required: ['severity'],
                additionalProperties: false,
              },
            },
            outputs: { level: '${llm_completion.severity}' },
          },
        ),
        end: node('END'),
      }),
      modelInvocation: captureModel([], { content: '```json\n{"severity":"WARNING"}\n```' }),
    });

    const result = await service.execute(baseRequest(), new AbortController().signal);

    expect(result.status).toBe('COMPLETED');
    expect(result.outputVariables).toMatchObject({ level: 'WARNING' });
  });

  it('fails when JSON does not match the output_schema', async () => {
    const service = createService({
      recipe: recipe({
        start: node('START', { ask: {} }),
        ask: node(
          'LLM_ROUTER',
          { end: {} },
          {
            inputs: {
              prompt: 'Classify.',
              output_schema: {
                type: 'object',
                properties: { severity: { type: 'string' } },
                required: ['severity'],
                additionalProperties: false,
              },
            },
            outputs: { level: '${llm_completion.severity}' },
          },
        ),
        end: node('END'),
      }),
      modelInvocation: captureModel([], { content: JSON.stringify({ category: 'net' }) }),
    });

    const result = await service.execute(baseRequest(), new AbortController().signal);

    expect(result.status).toBe('FAILED');
    const failedNode = result.nodeResults.find((nr) => nr.nodeType === 'LLM_ROUTER');
    expect(failedNode?.safeError?.code).toBe('WORKFLOW_LLM_OUTPUT_INVALID');
  });

  it('fails when model returns non-JSON but output_schema is required', async () => {
    const service = createService({
      recipe: recipe({
        start: node('START', { ask: {} }),
        ask: node(
          'LLM_ROUTER',
          { end: {} },
          {
            inputs: {
              prompt: 'Say hello.',
              output_schema: {
                type: 'object',
                properties: { greeting: { type: 'string' } },
                required: ['greeting'],
              },
            },
            outputs: { raw: '${llm_completion}' },
          },
        ),
        end: node('END'),
      }),
      modelInvocation: captureModel([], { content: 'Hello world' }),
    });

    const result = await service.execute(baseRequest(), new AbortController().signal);

    expect(result.status).toBe('FAILED');
    expect(result.nodeResults.find((nr) => nr.nodeType === 'LLM_ROUTER')?.safeError?.code).toBe('WORKFLOW_LLM_OUTPUT_INVALID');
  });

  it('strips rawPrompt and rawModelOutput keys from sanitized structured output', async () => {
    const service = createService({
      recipe: recipe({
        start: node('START', { ask: {} }),
        ask: node(
          'LLM_ROUTER',
          { end: {} },
          {
            inputs: {
              prompt: 'Give structured data.',
              output_schema: {
                type: 'object',
                properties: { value: { type: 'number' } },
                required: ['value'],
                additionalProperties: true,
              },
            },
            outputs: { result: '${llm_completion}' },
          },
        ),
        end: node('END'),
      }),
      modelInvocation: captureModel([], {
        content: JSON.stringify({ value: 42, rawPrompt: 'secret', rawModelOutput: 'raw' }),
      }),
    });

    const result = await service.execute(baseRequest(), new AbortController().signal);

    expect(result.status).toBe('COMPLETED');
    expect(result.outputVariables.result).toMatchObject({ value: 42 });
    expect(JSON.stringify(result.outputVariables)).not.toContain('rawPrompt');
    expect(JSON.stringify(result.outputVariables)).not.toContain('rawModelOutput');
  });
});

// ---------------------------------------------------------------------------
// Error handling
// ---------------------------------------------------------------------------
describe('LLM_ROUTER - error handling', () => {
  it('fails when the model returns a safeError', async () => {
    const service = createService({
      recipe: recipe({
        start: node('START', { ask: {} }),
        ask: node(
          'LLM_ROUTER',
          { end: {} },
          {
            inputs: { prompt: 'Do something.' },
            outputs: { raw: '${llm_completion}' },
          },
        ),
        end: node('END'),
      }),
      modelInvocation: {
        async complete() {
          return {
            content: '',
            safeError: {
              code: 'MODEL_RATE_LIMITED',
              message: 'Model rate limited safely.',
              category: 'UNAVAILABLE' as const,
              retryable: true,
            },
          };
        },
        stream: modelEventStreamFixture(async function* () {
          yield {
            content: '',
            safeError: {
              code: 'MODEL_RATE_LIMITED',
              message: 'Model rate limited.',
              category: 'UNAVAILABLE',
              retryable: true,
            },
          };
        }),
      },
    });

    const result = await service.execute(baseRequest(), new AbortController().signal);

    expect(result.status).toBe('FAILED');
    const failedNode = result.nodeResults.find((nr) => nr.nodeType === 'LLM_ROUTER');
    expect(failedNode?.safeError?.code).toBe('MODEL_RATE_LIMITED');
  });

  it('fails when modelInvocation boundary is not configured', async () => {
    const service = createWorkflowExecutionService({
      resolveRecipeDefinition: () =>
        recipe({
          start: node('START', { ask: {} }),
          ask: node(
            'LLM_ROUTER',
            { end: {} },
            {
              inputs: { prompt: 'Hi' },
              outputs: {},
            },
          ),
          end: node('END'),
        }),
      nodeCatalog: createWorkflowNodeCatalog({}),
    });

    const result = await service.execute(baseRequest(), new AbortController().signal);

    expect(result.status).toBe('FAILED');
    const failedNode = result.nodeResults.find((nr) => nr.nodeType === 'LLM_ROUTER');
    expect(failedNode?.safeError?.code).toBe('WORKFLOW_MODEL_BOUNDARY_UNAVAILABLE');
  });

  it('fails when resolveModelInvocationConfig is not configured', async () => {
    const service = createWorkflowExecutionService({
      resolveRecipeDefinition: () =>
        recipe({
          start: node('START', { ask: {} }),
          ask: node(
            'LLM_ROUTER',
            { end: {} },
            {
              inputs: { prompt: 'Hi' },
              outputs: {},
            },
          ),
          end: node('END'),
        }),
      nodeCatalog: createWorkflowNodeCatalog({
        modelInvocation: captureModel([], { content: 'ok' }),
      }),
    });

    const result = await service.execute(baseRequest(), new AbortController().signal);

    expect(result.status).toBe('FAILED');
    const failedNode = result.nodeResults.find((nr) => nr.nodeType === 'LLM_ROUTER');
    expect(failedNode?.safeError?.code).toBe('WORKFLOW_MODEL_BOUNDARY_UNAVAILABLE');
  });
});

// ---------------------------------------------------------------------------
// Business process
// ---------------------------------------------------------------------------
describe('LLM_ROUTER - business process', () => {
  it('emits NODE_STARTED and NODE_COMPLETED events with correct metadata', async () => {
    const events: WorkflowExecutionEvent[] = [];
    const service = createService({
      recipe: recipe({
        start: node('START', { ask: {} }),
        ask: node(
          'LLM_ROUTER',
          { end: {} },
          {
            inputs: { prompt: 'Say hi.' },
            outputs: { raw: '${llm_completion}' },
          },
        ),
        end: node('END'),
      }),
      modelInvocation: captureModel([], { content: 'hi' }),
      emitEvent: async (event) => {
        events.push(event);
      },
    });

    await service.execute(baseRequest(), new AbortController().signal);

    const askEvents = events.filter((e) => e.nodeId === 'ask');
    const started = askEvents.find((e) => e.eventType === 'NODE_STARTED');
    const completed = askEvents.find((e) => e.eventType === 'NODE_COMPLETED');
    expect(started).toMatchObject({ eventType: 'NODE_STARTED', nodeType: 'LLM_ROUTER', retryCount: 0 });
    expect(completed).toMatchObject({ eventType: 'NODE_COMPLETED', nodeType: 'LLM_ROUTER', retryCount: 0 });
  });

  it('passes upstream variables into the LLM_ROUTER prompt via interpolation', async () => {
    const requests: ModelInvocationRequest[] = [];
    const service = createService({
      recipe: recipe({
        start: node('START', { enrich: {} }),
        enrich: node('TOOL', { ask: {} }),
        ask: node(
          'LLM_ROUTER',
          { end: {} },
          {
            inputs: { prompt: 'Prev: ${prev}' },
            outputs: { raw: '${llm_completion}' },
          },
        ),
        end: node('END'),
      }),
      nodeCatalog: {
        handlers: {
          TOOL: async () => ({ outputVariables: { prev: 'enriched-data' } }),
        },
      },
      modelInvocation: captureModel(requests, { content: 'ack' }),
    });

    await service.execute(baseRequest(), new AbortController().signal);

    expect(requests[0]?.messages[0]?.content[0]).toMatchObject({ text: 'Prev: enriched-data' });
  });

  it('supports custom prompt preparation via options.prepareLlmPrompt', async () => {
    const requests: ModelInvocationRequest[] = [];
    const service = createService({
      recipe: recipe({
        start: node('START', { ask: {} }),
        ask: node(
          'LLM_ROUTER',
          { end: {} },
          {
            inputs: { prompt: 'original' },
            outputs: { raw: '${llm_completion}' },
          },
        ),
        end: node('END'),
      }),
      modelInvocation: captureModel(requests, { content: 'customized' }),
      prepareLlmPrompt: async () => ({ userPrompt: 'custom-prompt' }),
    });

    const result = await service.execute(baseRequest(), new AbortController().signal);

    expect(result.status).toBe('COMPLETED');
    expect(requests[0]?.messages[0]?.content[0]).toMatchObject({ text: 'custom-prompt' });
  });

  it('sets invocationScope and stepId correctly on the model request', async () => {
    const requests: ModelInvocationRequest[] = [];
    const service = createService({
      recipe: recipe({
        start: node('START', { ask: {} }),
        ask: node(
          'LLM_ROUTER',
          { end: {} },
          {
            inputs: { prompt: 'scope test' },
            outputs: { raw: '${llm_completion}' },
          },
        ),
        end: node('END'),
      }),
      modelInvocation: captureModel(requests, { content: 'done' }),
    });

    await service.execute(baseRequest(), new AbortController().signal);

    expect(requests[0]).toMatchObject({
      invocationScope: {
        agentId: 'agent-workflow',
        operationId: 'workflow:ask',
        sessionId: 'session-workflow',
        requestId: 'request-workflow',
        runId: 'run-workflow',
      },
    });
  });

  it('maps model_params into canonical inference options', async () => {
    const requests: ModelInvocationRequest[] = [];
    const service = createService({
      recipe: recipe({
        start: node('START', { ask: {} }),
        ask: node(
          'LLM_ROUTER',
          { end: {} },
          {
            inputs: {
              prompt: 'Use thinking.',
              model_params: { enable_thinking: true },
            },
            outputs: { raw: '${llm_completion}' },
          },
        ),
        end: node('END'),
      }),
      modelInvocation: captureModel(requests, { content: 'thinking done' }),
    });

    await service.execute(baseRequest(), new AbortController().signal);

    expect(requests[0]).toMatchObject({ thinking: { depth: 'HIGH' } });
  });

  it('leaves canonical inference options unset when no model_params are provided', async () => {
    const requests: ModelInvocationRequest[] = [];
    const service = createService({
      recipe: recipe({
        start: node('START', { ask: {} }),
        ask: node(
          'LLM_ROUTER',
          { end: {} },
          {
            inputs: { prompt: 'No params.' },
            outputs: { raw: '${llm_completion}' },
          },
        ),
        end: node('END'),
      }),
      modelInvocation: captureModel(requests, { content: 'ok' }),
    });

    await service.execute(baseRequest(), new AbortController().signal);

    expect(requests[0]?.thinking).toBeUndefined();
  });

  it('allows model_params to override configured canonical inference options', async () => {
    const requests: ModelInvocationRequest[] = [];
    const service = createService({
      recipe: recipe({
        start: node('START', { ask: {} }),
        ask: node(
          'LLM_ROUTER',
          { end: {} },
          {
            inputs: {
              prompt: 'Override.',
              model_params: { temperature: 0.8, max_tokens: 2048 },
            },
            outputs: { raw: '${llm_completion}' },
          },
        ),
        end: node('END'),
      }),
      modelInvocation: captureModel(requests, { content: 'overridden' }),
      modelConfig: {
        modelId: 'test-model',
        contextWindowTokens: 128_000,
        inferenceOptions: { temperature: 0.2, maxOutputTokens: 512 },
        timeoutMs: 30_000,
        maxRetries: 2,
      },
    });

    await service.execute(baseRequest(), new AbortController().signal);

    expect(requests[0]).toMatchObject({ temperature: 0.2, maxOutputTokens: 512 });
    expect(requests[0]?.modelParams).toMatchObject({ temperature: 0.8, max_tokens: 2048 });
  });

  it('does not coerce model_params string values into canonical numeric inference options', async () => {
    const requests: ModelInvocationRequest[] = [];
    const service = createService({
      recipe: recipe({
        start: node('START', { ask: {} }),
        ask: node(
          'LLM_ROUTER',
          { end: {} },
          {
            inputs: {
              prompt: 'Passthrough.',
              model_params: { temperature: '0.9', max_tokens: '1024' },
            },
            outputs: { raw: '${llm_completion}' },
          },
        ),
        end: node('END'),
      }),
      modelInvocation: captureModel(requests, { content: 'passthrough' }),
    });

    await service.execute(baseRequest(), new AbortController().signal);

    expect(requests[0]).not.toHaveProperty('temperature');
    expect(requests[0]).not.toHaveProperty('maxOutputTokens');
  });

  it('passes all model_params fields through opaquely as modelParams', async () => {
    const requests: ModelInvocationRequest[] = [];
    const service = createService({
      recipe: recipe({
        start: node('START', { ask: {} }),
        ask: node(
          'LLM_ROUTER',
          { end: {} },
          {
            inputs: {
              prompt: 'All params.',
              model_params: {
                temperature: 0.7,
                max_tokens: 4096,
                top_p: 0.9,
                top_k: 40,
                presence_penalty: 0.5,
                frequency_penalty: 0.5,
              },
            },
            outputs: { raw: '${llm_completion}' },
          },
        ),
        end: node('END'),
      }),
      modelInvocation: captureModel(requests, { content: 'all params' }),
    });

    await service.execute(baseRequest(), new AbortController().signal);

    expect(requests[0]?.modelParams).toMatchObject({
      temperature: 0.7,
      max_tokens: 4096,
      top_p: 0.9,
      top_k: 40,
      presence_penalty: 0.5,
      frequency_penalty: 0.5,
    });
    expect(requests[0]?.temperature).toBeUndefined();
    expect(requests[0]?.maxOutputTokens).toBeUndefined();
  });

  it('converts enable_thinking false to thinking depth OFF', async () => {
    const requests: ModelInvocationRequest[] = [];
    const service = createService({
      recipe: recipe({
        start: node('START', { ask: {} }),
        ask: node(
          'LLM_ROUTER',
          { end: {} },
          {
            inputs: {
              prompt: 'Disable thinking.',
              model_params: { enable_thinking: false },
            },
            outputs: { raw: '${llm_completion}' },
          },
        ),
        end: node('END'),
      }),
      modelInvocation: captureModel(requests, { content: 'no thinking' }),
    });

    await service.execute(baseRequest(), new AbortController().signal);

    expect(requests[0]).toMatchObject({ thinking: { depth: 'OFF' } });
  });

  it('passes unknown model_params fields through to modelParams', async () => {
    const requests: ModelInvocationRequest[] = [];
    const service = createService({
      recipe: recipe({
        start: node('START', { ask: {} }),
        ask: node(
          'LLM_ROUTER',
          { end: {} },
          {
            inputs: {
              prompt: 'Custom params.',
              model_params: {
                temperature: 0.7,
                custom_param: 'value',
                seed: 42,
              },
            },
            outputs: { raw: '${llm_completion}' },
          },
        ),
        end: node('END'),
      }),
      modelInvocation: captureModel(requests, { content: 'custom' }),
    });

    await service.execute(baseRequest(), new AbortController().signal);

    expect(requests[0]?.modelParams).toMatchObject({
      custom_param: 'value',
      seed: 42,
      temperature: 0.7,
    });
    expect(requests[0]?.providerOptions).toBeUndefined();
  });

  it('passes model_params through to modelParams alongside config providerOptions', async () => {
    const requests: ModelInvocationRequest[] = [];
    const service = createService({
      recipe: recipe({
        start: node('START', { ask: {} }),
        ask: node(
          'LLM_ROUTER',
          { end: {} },
          {
            inputs: {
              prompt: 'Merge.',
              model_params: { custom_param: 'from_model_params' },
            },
            outputs: { raw: '${llm_completion}' },
          },
        ),
        end: node('END'),
      }),
      modelInvocation: captureModel(requests, { content: 'merged' }),
      modelConfig: {
        modelId: 'test-model',
        contextWindowTokens: 128_000,
        inferenceOptions: { providerOptions: { base_param: 'from_config' } },
        timeoutMs: 30_000,
        maxRetries: 2,
      },
    });

    await service.execute(baseRequest(), new AbortController().signal);

    expect(requests[0]?.providerOptions).toMatchObject({
      base_param: 'from_config',
    });
    expect(requests[0]?.modelParams).toMatchObject({
      custom_param: 'from_model_params',
    });
  });
});

// ---------------------------------------------------------------------------
// Spec constraints
// ---------------------------------------------------------------------------
describe('LLM_ROUTER - spec constraints', () => {
  it('records nodeType LLM_ROUTER and nodeId in node results', async () => {
    const service = createService({
      recipe: recipe({
        start: node('START', { ask: {} }),
        ask: node(
          'LLM_ROUTER',
          { end: {} },
          {
            inputs: { prompt: 'test' },
            outputs: {},
          },
        ),
        end: node('END'),
      }),
      modelInvocation: captureModel([], { content: 'result' }),
    });

    const result = await service.execute(baseRequest(), new AbortController().signal);

    const llmNode = result.nodeResults.find((nr) => nr.nodeType === 'LLM_ROUTER');
    expect(llmNode).toBeDefined();
    expect(llmNode?.nodeId).toBe('ask');
    expect(llmNode?.status).toBe('NODE_COMPLETED');
  });

  it('is NOT treated as a gateway node and supports retry on timeout', async () => {
    let callCount = 0;
    const modelFn = vi.fn(async (_request: any, signal: AbortSignal) => {
      callCount += 1;
      if (callCount === 1) {
        await new Promise<void>((_, reject) => {
          if (signal.aborted) {
            reject(new DOMException('Aborted', 'AbortError'));
            return;
          }
          signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
        });
        return { content: 'should not reach' };
      }
      return { content: 'recovered' };
    });
    const service = createService({
      recipe: recipe({
        start: node('START', { ask: {} }),
        ask: node(
          'LLM_ROUTER',
          { end: {} },
          {
            inputs: { prompt: 'retry test' },
            outputs: {},
          },
          { timeout: 1, retryPolicy: { maxRetries: 1 } },
        ),
        end: node('END'),
      }),
      modelInvocation: {
        async complete(request, signal) {
          return modelFn(request, signal);
        },
        stream: modelEventStreamFixture(async function* (request, signal) {
          yield { ...(await modelFn(request, signal)), finishReason: 'stop' };
        }),
      },
    });

    const result = await service.execute(baseRequest(), new AbortController().signal);

    expect(result.status).toBe('COMPLETED');
    expect(callCount).toBe(2);
    expect(result.nodeResults.find((nr) => nr.nodeType === 'LLM_ROUTER')?.retryCount).toBe(1);
  });

  it('uses node-level timeoutMs over the model config default', async () => {
    const requests: ModelInvocationRequest[] = [];
    const service = createService({
      recipe: recipe({
        start: node('START', { ask: {} }),
        ask: node(
          'LLM_ROUTER',
          { end: {} },
          {
            inputs: { prompt: 'timeout test' },
            outputs: {},
          },
          { timeout: 5 },
        ),
        end: node('END'),
      }),
      modelInvocation: captureModel(requests, { content: 'timely' }),
      modelConfig: { modelId: 'test-model', contextWindowTokens: 128_000, inferenceOptions: {}, timeoutMs: 30_000, maxRetries: 2 },
    });

    const result = await service.execute(baseRequest(), new AbortController().signal);

    expect(result.status).toBe('COMPLETED');
    expect(requests[0]?.timeoutMs).toBe(5000);
  });

  it('emits NODE_FAILED event with safeError on LLM failure', async () => {
    const events: WorkflowExecutionEvent[] = [];
    const service = createService({
      recipe: recipe({
        start: node('START', { ask: {} }),
        ask: node(
          'LLM_ROUTER',
          { end: {} },
          {
            inputs: { prompt: 'fail me' },
            outputs: {},
          },
        ),
        end: node('END'),
      }),
      modelInvocation: {
        async complete() {
          return {
            content: '',
            safeError: {
              code: 'MODEL_FAILED',
              message: 'Model failed safely.',
              category: 'INTERNAL' as const,
              retryable: false,
            },
          };
        },
        stream: modelEventStreamFixture(async function* () {
          yield {
            content: '',
            safeError: {
              code: 'MODEL_FAILED',
              message: 'Model failed safely.',
              category: 'INTERNAL' as const,
              retryable: false,
            },
          };
        }),
      },
      emitEvent: async (event) => {
        events.push(event);
      },
    });

    const result = await service.execute(baseRequest(), new AbortController().signal);

    expect(result.status).toBe('FAILED');
    const failedEvent = events.find((e) => e.eventType === 'NODE_FAILED' && e.nodeId === 'ask');
    expect(failedEvent).toBeDefined();
    expect(failedEvent).toMatchObject({ nodeType: 'LLM_ROUTER', retryCount: 0 });
    expect(failedEvent?.safeError?.code).toBe('MODEL_FAILED');
  });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function createService(input: {
  readonly recipe: RecipeDefinition;
  readonly modelInvocation: ModelInvocationService;
  readonly modelConfig?: {
    readonly modelId: string;
    readonly contextWindowTokens: number;
    readonly inferenceOptions: ModelInferenceOptions;
    readonly timeoutMs: number;
    readonly maxRetries: number;
  };
  readonly nodeCatalog?: { readonly handlers: Record<string, (context: any) => Promise<any>> };
  readonly emitEvent?: (event: WorkflowExecutionEvent) => void | Promise<void>;
  readonly prepareLlmPrompt?: (request: any) => Promise<{ readonly userPrompt: string; readonly systemPrompt?: string }>;
}) {
  const modelCatalog = createWorkflowNodeCatalog({
    modelInvocation: input.modelInvocation,
    resolveModelInvocationConfig: async () =>
      input.modelConfig ?? {
        modelId: 'deterministic-test-model',
        contextWindowTokens: 8192,
        inferenceOptions: {} as any,
        timeoutMs: 30_000,
        maxRetries: 2,
      },
    ...(input.prepareLlmPrompt === undefined
      ? {}
      : {
          prepareLlmPrompt: async (request: any) => input.prepareLlmPrompt!(request),
        }),
  });

  const extraHandlers = input.nodeCatalog?.handlers ?? {};

  return createWorkflowExecutionService({
    resolveRecipeDefinition: () => input.recipe,
    nodeCatalog: {
      handlers: Object.freeze({
        ...modelCatalog.handlers,
        ...extraHandlers,
      }),
    },
    ...(input.emitEvent === undefined ? {} : { emitEvent: input.emitEvent }),
  });
}

function captureModel(captured: ModelInvocationRequest[], response: { readonly content: string }): ModelInvocationService {
  return {
    async complete(request, _signal) {
      captured.push(request);
      return { content: response.content };
    },
    stream: modelEventStreamFixture(async function* (_request, _signal) {
      captured.push(_request);
      yield { content: response.content, finishReason: 'stop' };
    }),
  };
}

function recipe(nodes: RecipeDefinition['flowGraph']['nodes']): RecipeDefinition {
  return {
    recipeName: 'workflow-llm-router-test',
    version: 'v1',
    displayName: 'Workflow LLM Router test',
    flowGraph: { nodes },
  };
}

function node(
  type: RecipeDefinition['flowGraph']['nodes'][string]['type'],
  next: Record<string, { readonly condition?: string }> = {},
  rest?: Partial<RecipeDefinition['flowGraph']['nodes'][string]>,
  extras?: Partial<{ readonly timeout: number; readonly retryPolicy: JsonObject }>,
): RecipeDefinition['flowGraph']['nodes'][string] {
  return {
    type,
    next,
    ...(rest === undefined ? {} : rest),
    ...(extras?.timeout === undefined ? {} : { timeout: extras.timeout }),
    ...(extras?.retryPolicy === undefined ? {} : { retryPolicy: extras.retryPolicy }),
  };
}

function baseRequest(): WorkflowExecutionRequest {
  return {
    recipeName: 'workflow-llm-router-test',
    recipeVersion: 'v1',
    inputVariables: {} as JsonObject,
    identityContext: {
      tenantId: brand<string, 'TenantId'>('tenant-workflow'),
      subjectId: brand<string, 'SubjectId'>('subject-workflow'),
      displayName: 'Workflow Tester',
    },
    agentId: brand<string, 'AgentId'>('agent-workflow'),
    agentVersion: brand<string, 'AgentVersion'>('v1'),
    sessionId: brand<string, 'SessionId'>('session-workflow'),
    requestId: brand<string, 'MessageId'>('request-workflow'),
    runId: brand<string, 'RequestRunId'>('run-workflow'),
    requestContextId: brand<string, 'RequestContextId'>('context-workflow'),
  };
}
