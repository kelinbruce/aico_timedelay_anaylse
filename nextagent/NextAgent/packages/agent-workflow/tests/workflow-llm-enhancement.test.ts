// @ts-nocheck
import { modelEventStreamFixture } from '../../../tests/helpers/model-stream-fixture.js';
import type { WorkflowExecutionEvent } from '@nextagent/agent-contracts/core';
import { brand, type JsonObject } from '@nextagent/agent-common';
import type { RecipeDefinition, WorkflowExecutionRequest } from '@nextagent/agent-contracts/core';
import type { ModelInvocationRequest, ModelInvocationService } from '@nextagent/agent-contracts/model';
import { describe, expect, it } from 'vitest';
import { createWorkflowExecutionService, createWorkflowNodeCatalog } from '../src/index.js';

describe('workflow llm enhancement', () => {
  // --- Prompt template rendering ---

  it('renders prompt_template with template engine (for loop)', async () => {
    const requests: ModelInvocationRequest[] = [];
    const service = createService({
      recipe: recipe({
        start: node('START', { askModel: {} }),
        askModel: node(
          'LLM',
          { end: {} },
          {
            inputs: {
              prompt_template: 'Analyze these alarms:\n{% for alarm in alarms %}- ${alarm.name}: ${alarm.severity}\n{% endfor %}',
              is_stream: 'false',
            },
            outputs: { result: '${llm_completion}' },
          },
        ),
        end: node('END'),
      }),
      modelInvocation: captureModel(requests, { content: 'All alarms are critical' }),
      inputVariables: {
        alarms: [
          { name: 'BGP_FLAP', severity: 'HIGH' },
          { name: 'LINK_DOWN', severity: 'CRITICAL' },
        ],
      },
    });

    const result = await service.execute(
      baseRequest({
        alarms: [
          { name: 'BGP_FLAP', severity: 'HIGH' },
          { name: 'LINK_DOWN', severity: 'CRITICAL' },
        ],
      }),
      new AbortController().signal,
    );

    expect(result.status).toBe('COMPLETED');
    const systemPrompt = requests[0]?.messages.find((m) => m.role === 'SYSTEM')?.content[0];
    expect(systemPrompt && 'text' in systemPrompt ? systemPrompt.text : '').toContain('BGP_FLAP: HIGH');
    expect(systemPrompt && 'text' in systemPrompt ? systemPrompt.text : '').toContain('LINK_DOWN: CRITICAL');
  });

  it('renders prompt_template with template engine (if conditional)', async () => {
    const requests: ModelInvocationRequest[] = [];
    const service = createService({
      recipe: recipe({
        start: node('START', { askModel: {} }),
        askModel: node(
          'LLM',
          { end: {} },
          {
            inputs: {
              prompt_template: '{% if alarms %}Has ${alarm_count} alarms{% endif %}',
              is_stream: 'false',
            },
            outputs: { result: '${llm_completion}' },
          },
        ),
        end: node('END'),
      }),
      modelInvocation: captureModel(requests, { content: 'Alarm analysis' }),
      inputVariables: { alarms: [{ name: 'A' }], alarm_count: '1' },
    });

    const result = await service.execute(baseRequest({ alarms: [{ name: 'A' }], alarm_count: '1' }), new AbortController().signal);

    expect(result.status).toBe('COMPLETED');
    const systemPrompt = requests[0]?.messages.find((m) => m.role === 'SYSTEM')?.content[0];
    expect(systemPrompt && 'text' in systemPrompt ? systemPrompt.text : '').toContain('Has 1 alarms');
  });

  it('skips if block when variable is falsy in prompt_template', async () => {
    const requests: ModelInvocationRequest[] = [];
    const service = createService({
      recipe: recipe({
        start: node('START', { askModel: {} }),
        askModel: node(
          'LLM',
          { end: {} },
          {
            inputs: {
              prompt_template: '{% if alarms %}Has alarms{% endif %}No alarms section',
              is_stream: 'false',
            },
            outputs: { result: '${llm_completion}' },
          },
        ),
        end: node('END'),
      }),
      modelInvocation: captureModel(requests, { content: 'No alarm analysis' }),
      inputVariables: { alarms: [] },
    });

    const result = await service.execute(baseRequest({ alarms: [] }), new AbortController().signal);

    expect(result.status).toBe('COMPLETED');
    const systemPrompt = requests[0]?.messages.find((m) => m.role === 'SYSTEM')?.content[0];
    const text = systemPrompt && 'text' in systemPrompt ? systemPrompt.text : '';
    expect(text).not.toContain('Has alarms');
    expect(text).toContain('No alarms section');
  });

  // --- Stream / non-stream mode ---

  it('uses stream() when is_stream=true', async () => {
    let streamCalled = false;
    let completeCalled = false;
    const service = createService({
      recipe: recipe({
        start: node('START', { askModel: {} }),
        askModel: node(
          'LLM',
          { intermediate: {} },
          {
            inputs: { is_stream: 'true' },
            outputs: { result: '${llm_completion}' },
          },
        ),
        intermediate: node('END'),
      }),
      modelInvocation: {
        async complete() {
          completeCalled = true;
          return { content: 'done' };
        },
        stream: modelEventStreamFixture(async function* () {
          streamCalled = true;
          yield { content: 'hello' };
          yield { content: ' world' };
          yield { content: 'hello world', finishReason: 'stop' };
        }),
      },
    });

    const result = await service.execute(baseRequest(), new AbortController().signal);
    expect(result.status).toBe('COMPLETED');
    expect(streamCalled).toBe(true);
    expect(completeCalled).toBe(false);
  });

  it('uses complete() when is_stream=false', async () => {
    let streamCalled = false;
    let completeCalled = false;
    const service = createService({
      recipe: recipe({
        start: node('START', { askModel: {} }),
        askModel: node(
          'LLM',
          { end: {} },
          {
            inputs: { is_stream: 'false' },
            outputs: { result: '${llm_completion}' },
          },
        ),
        end: node('END'),
      }),
      modelInvocation: {
        async complete() {
          completeCalled = true;
          return { content: 'done' };
        },
        stream: modelEventStreamFixture(async function* () {
          streamCalled = true;
          yield { content: 'hello', finishReason: 'stop' };
        }),
      },
    });

    const result = await service.execute(baseRequest(), new AbortController().signal);
    expect(result.status).toBe('COMPLETED');
    expect(streamCalled).toBe(false);
    expect(completeCalled).toBe(true);
  });

  it('defaults to stream when main recipe last node points to END', async () => {
    let streamCalled = false;
    const service = createService({
      recipe: recipe({
        start: node('START', { askModel: {} }),
        askModel: node(
          'LLM',
          { end: {} },
          {
            outputs: { result: '${llm_completion}' },
          },
        ),
        end: node('END'),
      }),
      modelInvocation: {
        async complete() {
          return { content: 'done' };
        },
        stream: modelEventStreamFixture(async function* () {
          streamCalled = true;
          yield { content: 'streamed', finishReason: 'stop' };
        }),
      },
    });

    const result = await service.execute(baseRequest(), new AbortController().signal);
    expect(result.status).toBe('COMPLETED');
    expect(streamCalled).toBe(true);
  });

  it('defaults to complete when node does NOT point to END', async () => {
    let completeCalled = false;
    const service = createService({
      recipe: recipe({
        start: node('START', { askModel: {} }),
        askModel: node(
          'LLM',
          { nextNode: {} },
          {
            outputs: { result: '${llm_completion}' },
          },
        ),
        nextNode: node(
          'LLM',
          { end: {} },
          {
            outputs: { result: '${llm_completion2}' },
          },
        ),
        end: node('END'),
      }),
      modelInvocation: {
        async complete() {
          completeCalled = true;
          return { content: 'step result' };
        },
        stream: modelEventStreamFixture(async function* () {
          yield { content: 'streamed', finishReason: 'stop' };
        }),
      },
    });

    const result = await service.execute(baseRequest(), new AbortController().signal);
    expect(result.status).toBe('COMPLETED');
    expect(completeCalled).toBe(true);
  });

  it('defaults to complete in sub-recipe (subRecipeDepth > 0)', async () => {
    let completeCalled = false;
    const service = createService({
      recipe: recipe({
        start: node('START', { askModel: {} }),
        askModel: node(
          'LLM',
          { end: {} },
          {
            outputs: { result: '${llm_completion}' },
          },
        ),
        end: node('END'),
      }),
      modelInvocation: {
        async complete() {
          completeCalled = true;
          return { content: 'done' };
        },
        stream: modelEventStreamFixture(async function* () {
          yield { content: 'streamed', finishReason: 'stop' };
        }),
      },
    });

    const subRequest = baseRequest();
    subRequest.executionMetadata = { subRecipeDepth: 1 };
    const result = await service.execute(subRequest, new AbortController().signal);
    expect(result.status).toBe('COMPLETED');
    expect(completeCalled).toBe(true);
  });

  // --- Stream output with level ---

  it('emits CONTENT deltas with level=ANSWER in stream mode', async () => {
    const deltas: Array<{ channel: string; content: string; level?: string }> = [];
    const service = createService({
      recipe: recipe({
        start: node('START', { askModel: {} }),
        askModel: node(
          'LLM',
          { end: {} },
          {
            inputs: { is_stream: 'true' },
            outputs: { result: '${llm_completion}' },
          },
        ),
        end: node('END'),
      }),
      modelInvocation: {
        async complete() {
          return { content: 'done' };
        },
        stream: modelEventStreamFixture(async function* () {
          yield { content: 'hello' };
          yield { content: ' world' };
          yield { content: 'hello world', finishReason: 'stop' };
        }),
      },
      onDelta: (d) => deltas.push(d),
    });

    const result = await service.execute(baseRequest(), new AbortController().signal);
    expect(result.status).toBe('COMPLETED');
    const contentDeltas = deltas.filter((d) => d.channel === 'CONTENT');
    expect(contentDeltas.map((delta) => delta.content)).toEqual(['hello', ' world']);
    expect(contentDeltas.every((d) => d.level === 'ANSWER')).toBe(true);
  });

  it('emits THINKING deltas with level=DETAIL in stream mode', async () => {
    const deltas: Array<{ channel: string; content: string; level?: string }> = [];
    const service = createService({
      recipe: recipe({
        start: node('START', { askModel: {} }),
        askModel: node(
          'LLM',
          { end: {} },
          {
            inputs: { is_stream: 'true' },
            outputs: { result: '${llm_completion}' },
          },
        ),
        end: node('END'),
      }),
      modelInvocation: {
        async complete() {
          return { content: 'done' };
        },
        stream: modelEventStreamFixture(async function* () {
          yield { reasoning: 'thinking step 1' };
          yield { content: 'answer' };
          yield { content: 'answer', reasoning: 'thinking step 1', finishReason: 'stop' };
        }),
      },
      onDelta: (d) => deltas.push(d),
    });

    const result = await service.execute(baseRequest(), new AbortController().signal);
    expect(result.status).toBe('COMPLETED');
    const thinkingDeltas = deltas.filter((d) => d.channel === 'THINKING');
    expect(thinkingDeltas.map((delta) => delta.content)).toEqual(['thinking step 1']);
    expect(thinkingDeltas.every((d) => d.level === 'DETAIL')).toBe(true);
  });

  it('accepts a content-only terminal result returned by the stream service', async () => {
    const service = createService({
      recipe: recipe({
        start: node('START', { askModel: {} }),
        askModel: node(
          'LLM',
          { end: {} },
          {
            inputs: { is_stream: 'true' },
            outputs: { result: '${llm_completion}' },
          },
        ),
        end: node('END'),
      }),
      modelInvocation: {
        async complete() {
          return { content: 'done' };
        },
        stream: modelEventStreamFixture(async function* () {
          yield { content: 'partial answer' };
        }),
      },
    });

    const result = await service.execute(baseRequest(), new AbortController().signal);

    expect(result.status).toBe('COMPLETED');
    expect(result.outputVariables).toMatchObject({ result: 'partial answer' });
  });

  // --- llm_result and llm_completion output bindings ---

  it('llm_completion is only content by default (result_with_think not set)', async () => {
    const service = createService({
      recipe: recipe({
        start: node('START', { askModel: {} }),
        askModel: node(
          'LLM',
          { intermediate: {} },
          {
            inputs: { is_stream: 'false' },
            outputs: { result: '${llm_completion}', raw: '${llm_result}' },
          },
        ),
        intermediate: node('END'),
      }),
      modelInvocation: captureModel([], { content: '{"answer": "42"}', reasoning: 'step by step' }),
    });

    const result = await service.execute(baseRequest(), new AbortController().signal);
    expect(result.status).toBe('COMPLETED');
    const completion = result.outputVariables.result;
    expect(completion).toMatchObject({ answer: '42' });
    expect(completion).not.toHaveProperty('reasoning');
    const llmResult = result.outputVariables.raw;
    expect(llmResult).toMatchObject({ content: '{"answer": "42"}', reasoning: 'step by step' });
  });

  it('llm_completion excludes reasoning when result_with_think=false', async () => {
    const service = createService({
      recipe: recipe({
        start: node('START', { askModel: {} }),
        askModel: node(
          'LLM',
          { intermediate: {} },
          {
            inputs: { is_stream: 'false', result_with_think: 'false' },
            outputs: { result: '${llm_completion}', raw: '${llm_result}' },
          },
        ),
        intermediate: node('END'),
      }),
      modelInvocation: captureModel([], { content: '{"answer": "42"}', reasoning: 'step by step' }),
    });

    const result = await service.execute(baseRequest(), new AbortController().signal);
    expect(result.status).toBe('COMPLETED');
    const completion = result.outputVariables.result;
    expect(completion).toMatchObject({ answer: '42' });
    expect(completion).not.toHaveProperty('reasoning');
    const llmResult = result.outputVariables.raw;
    expect(llmResult).toMatchObject({ content: '{"answer": "42"}', reasoning: 'step by step' });
  });

  it('llm_completion includes reasoning when result_with_think=true', async () => {
    const service = createService({
      recipe: recipe({
        start: node('START', { askModel: {} }),
        askModel: node(
          'LLM',
          { intermediate: {} },
          {
            inputs: { is_stream: 'false', result_with_think: 'true' },
            outputs: { result: '${llm_completion}' },
          },
        ),
        intermediate: node('END'),
      }),
      modelInvocation: captureModel([], { content: '{"answer": "42"}', reasoning: 'step by step' }),
    });

    const result = await service.execute(baseRequest(), new AbortController().signal);
    expect(result.status).toBe('COMPLETED');
    const completion = result.outputVariables.result;
    expect(completion).toMatchObject({ content: { answer: '42' }, reasoning: 'step by step' });
  });

  it('llm_result contains full model output', async () => {
    const service = createService({
      recipe: recipe({
        start: node('START', { askModel: {} }),
        askModel: node(
          'LLM',
          { intermediate: {} },
          {
            inputs: { is_stream: 'false' },
            outputs: { raw: '${llm_result}' },
          },
        ),
        intermediate: node('END'),
      }),
      modelInvocation: {
        async complete() {
          return { content: '{"answer": "42"}', reasoning: 'step by step', finishReason: 'stop', usage: { inputTokens: 10, outputTokens: 20 } };
        },
        async *stream() {
          yield { content: 'done' };
        },
      },
    });

    const result = await service.execute(baseRequest(), new AbortController().signal);
    expect(result.status).toBe('COMPLETED');
    const llmResult = result.outputVariables.raw;
    expect(llmResult).toMatchObject({ content: '{"answer": "42"}', reasoning: 'step by step', finishReason: 'stop' });
    expect(llmResult.usage).toMatchObject({ inputTokens: 10, outputTokens: 20 });
  });

  it('llm_completion auto-parses JSON content', async () => {
    const service = createService({
      recipe: recipe({
        start: node('START', { askModel: {} }),
        askModel: node(
          'LLM',
          { intermediate: {} },
          {
            inputs: { is_stream: 'false' },
            outputs: { result: '${llm_completion}' },
          },
        ),
        intermediate: node('END'),
      }),
      modelInvocation: captureModel([], { content: '```json\n{"key": "value"}\n```' }),
    });

    const result = await service.execute(baseRequest(), new AbortController().signal);
    expect(result.status).toBe('COMPLETED');
    expect(result.outputVariables.result).toMatchObject({ key: 'value' });
  });

  it('llm_completion keeps raw text when JSON parse fails', async () => {
    const service = createService({
      recipe: recipe({
        start: node('START', { askModel: {} }),
        askModel: node(
          'LLM',
          { intermediate: {} },
          {
            inputs: { is_stream: 'false' },
            outputs: { result: '${llm_completion}' },
          },
        ),
        intermediate: node('END'),
      }),
      modelInvocation: captureModel([], { content: 'This is not JSON' }),
    });

    const result = await service.execute(baseRequest(), new AbortController().signal);
    expect(result.status).toBe('COMPLETED');
    expect(result.outputVariables.result).toBe('This is not JSON');
  });

  it('llm_completion without reasoning has only content', async () => {
    const service = createService({
      recipe: recipe({
        start: node('START', { askModel: {} }),
        askModel: node(
          'LLM',
          { intermediate: {} },
          {
            inputs: { is_stream: 'false' },
            outputs: { result: '${llm_completion}', raw: '${llm_result}' },
          },
        ),
        intermediate: node('END'),
      }),
      modelInvocation: captureModel([], { content: '{"answer": "42"}' }),
    });

    const result = await service.execute(baseRequest(), new AbortController().signal);
    expect(result.status).toBe('COMPLETED');
    const completion = result.outputVariables.result;
    expect(completion).toMatchObject({ answer: '42' });
    expect(completion).not.toHaveProperty('reasoning');
    const llmResult = result.outputVariables.raw;
    expect(llmResult).toMatchObject({ content: '{"answer": "42"}' });
    expect(llmResult).not.toHaveProperty('reasoning');
  });

  // --- Prompt priority 3: query/question fallback ---

  it('fails when prompt_template_name is set but no prompt assembler is configured', async () => {
    const service = createWorkflowExecutionService({
      resolveRecipeDefinition: () =>
        recipe({
          start: node('START', { askModel: {} }),
          askModel: node(
            'LLM',
            { intermediate: {} },
            {
              inputs: { prompt_template_name: 'workflow/custom', is_stream: 'false' },
              outputs: { result: '${llm_completion}' },
            },
          ),
          intermediate: node('END'),
        }),
      nodeCatalog: createWorkflowNodeCatalog({
        modelInvocation: {
          async complete() {
            return { content: 'done' };
          },
          async *stream() {
            yield { content: 'done' };
          },
        },
        resolveModelInvocationConfig: async () => ({
          providerKind: 'OPENAI',
          modelName: 'test-model',
          contextWindowTokens: 8192,
          commonOptions: {},
          providerOptions: {},
          timeoutMs: 30_000,
        }),
      }),
    });

    const result = await service.execute(baseRequest(), new AbortController().signal);
    expect(result.status).toBe('FAILED');
    const failedNode = result.nodeResults.find((nr) => nr.nodeType === 'LLM');
    expect(failedNode?.safeError?.code).toBe('WORKFLOW_LLM_PROMPT_TEMPLATE_UNAVAILABLE');
  });

  it('uses query from variables as userPrompt when no template configured', async () => {
    const requests: ModelInvocationRequest[] = [];
    const service = createService({
      recipe: recipe({
        start: node('START', { askModel: {} }),
        askModel: node(
          'LLM',
          { intermediate: {} },
          {
            inputs: { is_stream: 'false' },
            outputs: { result: '${llm_completion}' },
          },
        ),
        intermediate: node('END'),
      }),
      modelInvocation: captureModel(requests, { content: 'Response' }),
      inputVariables: { query: 'What is the alarm status?' },
    });

    const result = await service.execute(baseRequest({ query: 'What is the alarm status?' }), new AbortController().signal);
    expect(result.status).toBe('COMPLETED');
    const userMessage = requests[0]?.messages.find((m) => m.role === 'USER')?.content[0];
    expect(userMessage && 'text' in userMessage ? userMessage.text : '').toBe('What is the alarm status?');
    const systemMessage = requests[0]?.messages.find((m) => m.role === 'SYSTEM');
    expect(systemMessage).toBeUndefined();
  });

  // --- Stream mode output bindings ---

  it('stream mode stores full output in llm_completion same as non-stream', async () => {
    const service = createService({
      recipe: recipe({
        start: node('START', { askModel: {} }),
        askModel: node(
          'LLM',
          { intermediate: {} },
          {
            inputs: { is_stream: 'true' },
            outputs: { result: '${llm_completion}' },
          },
        ),
        intermediate: node('END'),
      }),
      modelInvocation: captureModel([], { content: '{"summary":"alarm storm"}' }),
    });

    const result = await service.execute(baseRequest(), new AbortController().signal);
    expect(result.status).toBe('COMPLETED');
    expect(result.outputVariables.result).toMatchObject({ summary: 'alarm storm' });
  });

  it('stream mode always sends THINKING deltas regardless of result_with_think', async () => {
    const deltas = [];
    const service = createService({
      recipe: recipe({
        start: node('START', { askModel: {} }),
        askModel: node(
          'LLM',
          { intermediate: {} },
          {
            inputs: { is_stream: 'true', result_with_think: 'false' },
            outputs: { result: '${llm_completion}', raw: '${llm_result}' },
          },
        ),
        intermediate: node('END'),
      }),
      modelInvocation: captureModel([], { content: '{"answer": "42"}', reasoning: 'step 1' }),
      onDelta: (d) => deltas.push(d),
    });

    const result = await service.execute(baseRequest(), new AbortController().signal);
    expect(result.status).toBe('COMPLETED');
    expect(result.outputVariables.result).toMatchObject({ answer: '42' });
    expect(result.outputVariables.result).not.toHaveProperty('reasoning');
    expect(result.outputVariables.raw).toMatchObject({ content: '{"answer": "42"}', reasoning: 'step 1' });
    const thinkingDeltas = deltas.filter((d) => d.channel === 'THINKING');
    expect(thinkingDeltas.length).toBeGreaterThan(0);
  });
});

function createService(input: {
  readonly recipe: RecipeDefinition;
  readonly modelInvocation: ModelInvocationService;
  readonly inputVariables?: Record<string, unknown>;
  readonly onDelta?: (delta: { channel: string; content: string; level?: string }) => void;
}) {
  return createWorkflowExecutionService({
    resolveRecipeDefinition: () => input.recipe,
    nodeCatalog: createWorkflowNodeCatalog({
      modelInvocation: input.modelInvocation,
      resolveModelInvocationConfig: async () => ({
        modelId: 'test-model',
        contextWindowTokens: 8192,
        inferenceOptions: {},
        timeoutMs: 30_000,
        maxRetries: 2,
      }),
    }),
    emitEvent: input.onDelta
      ? (event: WorkflowExecutionEvent) => {
          if (event.eventType === 'NODE_OUTPUT_DELTA' && event.visibleDelta) {
            input.onDelta!({ channel: event.visibleDelta.channel, content: event.visibleDelta.content, level: event.visibleDelta.level });
          }
        }
      : undefined,
  });
}

function captureModel(
  captured: ModelInvocationRequest[],
  response: { readonly content: string; readonly reasoning?: string },
): ModelInvocationService {
  return {
    async complete(request, _signal) {
      captured.push(request);
      return { content: response.content, ...(response.reasoning ? { reasoning: response.reasoning } : {}) };
    },
    stream: modelEventStreamFixture(async function* (request, _signal) {
      captured.push(request);
      yield { content: response.content, ...(response.reasoning ? { reasoning: response.reasoning } : {}), finishReason: 'stop' };
    }),
  };
}

function recipe(nodes: RecipeDefinition['flowGraph']['nodes']): RecipeDefinition {
  return {
    recipeName: 'llm-enhancement-test',
    version: 'v1',
    displayName: 'llm-enhancement-test',
    flowGraph: { nodes },
  };
}

function node(
  type: RecipeDefinition['flowGraph']['nodes'][string]['type'],
  next: Record<string, { readonly condition?: string }> = {},
  rest: Partial<RecipeDefinition['flowGraph']['nodes'][string]> = {},
): RecipeDefinition['flowGraph']['nodes'][string] {
  return { type, next, ...rest };
}

function baseRequest(inputVariables?: Record<string, unknown>): WorkflowExecutionRequest {
  return {
    recipeName: 'llm-enhancement-test',
    recipeVersion: 'v1',
    inputVariables: (inputVariables ?? {}) as JsonObject,
    identityContext: {
      tenantId: brand<string, 'TenantId'>('tenant-test'),
      subjectId: brand<string, 'SubjectId'>('subject-test'),
      displayName: 'Test Operator',
    },
    agentId: brand<string, 'AgentId'>('test-agent'),
    agentVersion: brand<string, 'AgentVersion'>('v1'),
    sessionId: brand<string, 'SessionId'>('session-test'),
    requestId: brand<string, 'MessageId'>('request-test'),
    runId: brand<string, 'RequestRunId'>('run-test'),
    requestContextId: brand<string, 'RequestContextId'>('context-test'),
  };
}
