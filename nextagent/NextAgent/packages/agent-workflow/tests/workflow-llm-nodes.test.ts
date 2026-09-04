// @ts-nocheck
import { modelEventStreamFixture } from '../../../tests/helpers/model-stream-fixture.js';
import { brand, type JsonObject } from '@nextagent/agent-common';
import type { RecipeDefinition, WorkflowExecutionRequest } from '@nextagent/agent-contracts/core';
import type { ModelInvocationRequest, ModelInvocationService } from '@nextagent/agent-contracts/model';
import type { CapabilityInvocationPort, CapabilityInvocationResult } from '@nextagent/agent-contracts/capability';
import type { ExecutionCorrelationPort } from '@nextagent/agent-contracts/observability';
import { describe, expect, it } from 'vitest';
import { createWorkflowExecutionService, createWorkflowNodeCatalog } from '../src/index.js';

describe('workflow llm nodes', () => {
  it('keeps model calls in the workflow node scope without synthesizing model timeline events', async () => {
    const timelineEventTypes: string[] = [];
    const activeKinds: string[] = [];
    const executionCorrelation: ExecutionCorrelationPort = {
      async withIncomingCarrier(_carrier, operation) {
        return operation();
      },
      async withExecutionRef(ref, operation) {
        activeKinds.push(ref.kind);
        try {
          return await operation();
        } finally {
          activeKinds.pop();
        }
      },
      outboundHeaders(input = {}) {
        return input;
      },
    };
    const requests: ModelInvocationRequest[] = [];
    const modelInvocation: ModelInvocationService = {
      async complete(request) {
        expect(activeKinds).toEqual(['WORKFLOW_NODE']);
        requests.push(request);
        return { content: '{"summary":"RAN alarm storm"}' };
      },
      stream: modelEventStreamFixture(async function* (request) {
        expect(activeKinds).toEqual(['WORKFLOW_NODE']);
        requests.push(request);
        yield {
          content: '{"summary":"RAN alarm storm"}',
          finishReason: 'stop',
        };
      }),
    };
    const service = createService({
      recipe: recipe({
        start: node('START', { askModel: {} }),
        askModel: node(
          'LLM_ROUTER',
          { end: {} },
          {
            inputs: {
              prompt: 'Summarize the alarm storm.',
              output_schema: {
                type: 'object',
                properties: { summary: { type: 'string' } },
                required: ['summary'],
                additionalProperties: false,
              },
            },
          },
        ),
        end: node('END'),
      }),
      modelInvocation,
      executionCorrelation,
    });
    const observer = {
      emitEvent(event) {
        timelineEventTypes.push(event.type);
      },
    };

    await service.execute(baseRequest(), new AbortController().signal, observer);

    expect(requests[0]?.invocationScope.operationId).toBe('workflow:askModel');
    expect(timelineEventTypes).not.toContain('MODEL_INVOCATION_STARTED');
    expect(timelineEventTypes).not.toContain('MODEL_INVOCATION_COMPLETED');
    expect(timelineEventTypes).not.toContain('MODEL_INVOCATION_FAILED');
  });

  it('maps llm-router structured output through the declared output binding', async () => {
    const requests: ModelInvocationRequest[] = [];
    const service = createService({
      recipe: recipe({
        start: node('START', { askModel: {} }),
        askModel: node(
          'LLM_ROUTER',
          { end: {} },
          {
            inputs: {
              prompt: 'Summarize the alarm storm.',
              output_schema: {
                type: 'object',
                properties: { summary: { type: 'string' } },
                required: ['summary'],
                additionalProperties: false,
              },
            },
            outputs: { result: '${llm_completion.summary}' },
          },
        ),
        end: node('END'),
      }),
      modelInvocation: captureModel(requests, { content: '{"summary":"RAN alarm storm"}' }),
    });

    const result = await service.execute(baseRequest(), new AbortController().signal);

    expect(result.status).toBe('COMPLETED');
    expect(requests).toHaveLength(1);
    expect(result.outputVariables).toMatchObject({ result: 'RAN alarm storm' });
  });

  it('returns validated intent recognition output', async () => {
    const service = createService({
      recipe: recipe({
        start: node('START', { classify: {} }),
        classify: node(
          'INTENT_RECOGNITION',
          { end: {} },
          {
            inputs: {
              query_text: 'Please analyze BGP flap alarms on NE-1',
              candidate_intents: ['alarm-analysis', 'capacity-triage'],
            },
            outputs: { intent: '${intent}', confidence: '${confidence}' },
          },
        ),
        end: node('END'),
      }),
      modelInvocation: captureModel([], { content: '{"intent":"alarm-analysis","confidence":0.91}' }),
    });

    const result = await service.execute(baseRequest(), new AbortController().signal);

    expect(result.status).toBe('COMPLETED');
    expect(result.outputVariables).toMatchObject({
      intent: 'alarm-analysis',
      confidence: 0.91,
    });
  });

  it('compresses oversized question rewriting prompts while preserving telecom terms', async () => {
    const requests: ModelInvocationRequest[] = [];
    const longQuestion = `${'Long history '.repeat(700)}Check NE-1 BGP-ALM-9001 immediately`;
    const service = createService({
      recipe: recipe({
        start: node('START', { rewrite: {} }),
        rewrite: node(
          'QUESTION_REWRITING',
          { end: {} },
          {
            inputs: {
              input_question: longQuestion,
            },
            outputs: { rewritten: '${rewritten_input_question}' },
          },
        ),
        end: node('END'),
      }),
      modelInvocation: captureModel(requests, { content: '{"rewrittenQuery":"Check NE-1 BGP-ALM-9001 immediately"}' }),
      modelConfig: { modelId: 'tiny-window', contextWindowTokens: 128, inferenceOptions: {}, timeoutMs: 30_000, maxRetries: 2 },
    });

    const result = await service.execute(baseRequest(), new AbortController().signal);

    expect(result.status).toBe('COMPLETED');
    expect(result.outputVariables).toMatchObject({
      rewritten: 'Check NE-1 BGP-ALM-9001 immediately',
    });
    const userText = requests[0]?.messages.find((message) => message.role === 'USER')?.content[0];
    expect(userText && 'text' in userText ? userText.text : '').toContain('NE-1');
    expect(userText && 'text' in userText ? userText.text : '').toContain('BGP-ALM-9001');
    expect(userText && 'text' in userText ? userText.text.length : 0).toBeLessThan(longQuestion.length);
  });

  it('returns safe translation, analysis, and param extraction outputs', async () => {
    const service = createService({
      recipe: recipe({
        start: node('START', { translate: {} }),
        translate: node(
          'TRANSLATION',
          { analyze: {} },
          {
            inputs: {
              text: 'Alarm storm on NE-1',
              sourceLang: 'EN',
              targetLang: 'ZH',
            },
            outputs: { translated: '${translated_text}' },
          },
        ),
        analyze: node(
          'DATA_ANALYSIS',
          { extract: {} },
          {
            inputs: {
              data: { affectedCells: 12, severity: 'HIGH' },
              analysisPrompt: 'Summarize impact',
            },
            outputs: { analysis: '${analysis_result}' },
          },
        ),
        extract: node(
          'PARAM_EXTRACT',
          { end: {} },
          {
            inputs: {
              text: 'Please open a ticket for NE-1 in region CN-SH',
              paramSchema: {
                type: 'object',
                properties: {
                  neId: { type: 'string' },
                  region: { type: 'string' },
                },
                required: ['neId', 'region'],
                additionalProperties: false,
              },
            },
            outputs: { params: '${extracted_params}' },
          },
        ),
        end: node('END'),
      }),
      modelInvocation: sequenceModel([
        { content: '{"translatedText":"NE-1 鍛婅椋庢毚"}' },
        { content: '{"analysisResult":"12 cells affected with high severity"}' },
        { content: '{"extractedParams":{"neId":"NE-1","region":"CN-SH"}}' },
      ]),
    });

    const result = await service.execute(baseRequest(), new AbortController().signal);

    expect(result.status).toBe('COMPLETED');
    expect(result.outputVariables).toMatchObject({
      translated: 'NE-1 鍛婅椋庢毚',
      analysis: '12 cells affected with high severity',
      params: { neId: 'NE-1', region: 'CN-SH' },
    });
  });

  it('fails data-analysis when data input is missing', async () => {
    const service = createService({
      recipe: recipe({
        start: node('START', { analyze: {} }),
        analyze: node('DATA_ANALYSIS', { end: {} }, { inputs: { analysisPrompt: 'analyze' } }),
        end: node('END'),
      }),
      modelInvocation: {
        async complete() {
          throw new Error('model should not be called');
        },
      } as unknown as ModelInvocationService,
    });

    const result = await service.execute(baseRequest(), new AbortController().signal);

    expect(result.status).toBe('FAILED');
    expect(result.nodeResults.find((item) => item.nodeId === 'analyze')?.safeError?.code).toBe('WORKFLOW_DATA_ANALYSIS_INVALID_INPUT');
  });

  it('executes data-analysis LLM output in sandbox and returns sandbox result', async () => {
    const requests = [];
    const service = createService({
      recipe: recipe({
        start: node('START', { analyze: {} }),
        analyze: node(
          'DATA_ANALYSIS',
          { end: {} },
          {
            inputs: {
              data: { affectedCells: 12, severity: 'HIGH' },
              analysisPrompt: 'Summarize impact',
            },
            outputs: { analysis: '${analysis_result}' },
          },
        ),
        end: node('END'),
      }),
      modelInvocation: captureModel(requests, {
        content: JSON.stringify({ analysisResult: "print('12 cells with high severity')" }),
      }),
      capabilityInvocation: sandboxCapability({ stdout: '12 cells with high severity', exitCode: 0 }),
    });

    const result = await service.execute(baseRequest(), new AbortController().signal);

    expect(result.status).toBe('COMPLETED');
    expect(requests).toHaveLength(1);
    expect(result.outputVariables).toMatchObject({
      analysis: { stdout: '12 cells with high severity', exitCode: 0 },
    });
  });

  it('rises a DATA_ANALYSIS Python Capability final failure without re-running the node', async () => {
    let pythonInvocations = 0;
    const service = createService({
      recipe: recipe({
        start: node('START', { analyze: {} }),
        analyze: node(
          'DATA_ANALYSIS',
          { end: {} },
          {
            inputs: {
              data: { affectedCells: 12, severity: 'HIGH' },
              analysisPrompt: 'Summarize impact',
            },
            outputs: { analysis: '${analysis_result}' },
          },
        ),
        end: node('END'),
      }),
      modelInvocation: captureModel([], {
        content: JSON.stringify({ analysisResult: "print('code')" }),
      }),
      capabilityInvocation: {
        async invoke() {
          pythonInvocations += 1;
          return {
            status: 'FAILED',
            structuredPayload: {},
            generatedMessages: [],
            artifactRefs: [],
            safeError: { code: 'SANDBOX_DENIED', message: 'sandbox denied', category: 'AUTHORIZATION', retryable: false },
          };
        },
      },
    });

    const result = await service.execute(baseRequest(), new AbortController().signal);

    expect(result.status).toBe('FAILED');
    expect(pythonInvocations).toBe(1);
    expect(result.nodeResults.find((item) => item.nodeId === 'analyze')?.safeError?.code).toBe('SANDBOX_DENIED');
  });

  it('intent-recognition skips LLM when rule-based intent matches', async () => {
    const requests = [];
    const service = createService({
      recipe: recipe({
        start: node('START', { classify: {} }),
        classify: node(
          'INTENT_RECOGNITION',
          { end: {} },
          {
            inputs: { query_text: 'Analyze BGP flap on NE-1' },
            outputs: { intent: '${intent}', confidence: '${confidence}' },
          },
        ),
        end: node('END'),
      }),
      modelInvocation: captureModel(requests, { content: '{}' }),
      resolveIntentRules: [
        { intentName: 'bgp-flap-analysis', patterns: ['BGP flap', 'BGP alarm'], matchMode: 'ANY' },
        { intentName: 'capacity-triage', patterns: ['capacity', 'overload'], matchMode: 'ANY' },
      ],
    });

    const result = await service.execute(baseRequest(), new AbortController().signal);

    expect(result.status).toBe('COMPLETED');
    expect(requests).toHaveLength(0);
    expect(result.outputVariables).toMatchObject({
      intent: 'bgp-flap-analysis',
      confidence: 0.95,
    });
  });

  it('fails question-rewriting when LLM responds with askQuestion', async () => {
    const requests = [];
    const service = createService({
      recipe: recipe({
        start: node('START', { rewrite: {} }),
        rewrite: node(
          'QUESTION_REWRITING',
          { end: {} },
          {
            inputs: { input_question: 'Check NE-1' },
            outputs: { rewritten: '${rewritten_input_question}' },
          },
        ),
        end: node('END'),
      }),
      modelInvocation: captureModel(requests, {
        content: JSON.stringify({ rewrittenQuery: 'check', askQuestion: 'Which NE do you mean?' }),
      }),
    });

    const result = await service.execute(baseRequest(), new AbortController().signal);

    expect(result.status).toBe('FAILED');
    const failedNode = result.nodeResults.find((nr) => nr.nodeType === 'QUESTION_REWRITING');
    expect(failedNode?.safeError?.code).toBe('WORKFLOW_QUESTION_REWRITING_ASK_QUESTION');
    expect(failedNode?.safeError?.safeDetails).toMatchObject({ askQuestion: 'Which NE do you mean?' });
  });

  it('intent-recognition falls back to LLM when no rule matches', async () => {
    const requests = [];
    const service = createService({
      recipe: recipe({
        start: node('START', { classify: {} }),
        classify: node(
          'INTENT_RECOGNITION',
          { end: {} },
          {
            inputs: { query_text: 'Unknown topic query' },
            outputs: { intent: '${intent}', confidence: '${confidence}' },
          },
        ),
        end: node('END'),
      }),
      modelInvocation: captureModel(requests, { content: JSON.stringify({ intent: 'general-query', confidence: 0.7 }) }),
      resolveIntentRules: [{ intentName: 'bgp-flap-analysis', patterns: ['BGP flap', 'BGP alarm'], matchMode: 'ANY' }],
    });

    const result = await service.execute(baseRequest(), new AbortController().signal);

    expect(result.status).toBe('COMPLETED');
    expect(requests).toHaveLength(1);
    expect(result.outputVariables).toMatchObject({ intent: 'general-query' });
  });

  it('falls back to LLM output for data-analysis when sandbox capability is unavailable', async () => {
    const requests = [];
    const service = createService({
      recipe: recipe({
        start: node('START', { analyze: {} }),
        analyze: node(
          'DATA_ANALYSIS',
          { end: {} },
          {
            inputs: {
              data: { affectedCells: 12, severity: 'HIGH' },
              analysisPrompt: 'Summarize impact',
            },
            outputs: { analysis: '${analysis_result}' },
          },
        ),
        end: node('END'),
      }),
      modelInvocation: captureModel(requests, {
        content: JSON.stringify({ analysisResult: '12 cells affected with high severity' }),
      }),
    });

    const result = await service.execute(baseRequest(), new AbortController().signal);

    expect(result.status).toBe('COMPLETED');
    expect(requests).toHaveLength(1);
    expect(result.outputVariables).toMatchObject({
      analysis: '12 cells affected with high severity',
    });
  });

  it('fails param-extract when LLM output does not match the parameter schema', async () => {
    const service = createService({
      recipe: recipe({
        start: node('START', { extract: {} }),
        extract: node(
          'PARAM_EXTRACT',
          { end: {} },
          {
            inputs: {
              text: 'Open ticket for NE-1',
              paramSchema: {
                type: 'object',
                properties: { neId: { type: 'string' }, region: { type: 'string' } },
                required: ['neId', 'region'],
                additionalProperties: false,
              },
            },
            outputs: { params: '${extracted_params}' },
          },
        ),
        end: node('END'),
      }),
      modelInvocation: captureModel([], {
        content: JSON.stringify({ extractedParams: { neId: 'NE-1' } }),
      }),
    });

    const result = await service.execute(baseRequest(), new AbortController().signal);

    expect(result.status).toBe('FAILED');
    const failedNode = result.nodeResults.find((nr) => nr.nodeType === 'PARAM_EXTRACT');
    expect(failedNode?.safeError?.code).toBe('WORKFLOW_LLM_OUTPUT_INVALID');
  });

  it('rejects intent-recognition output with invalid confidence range', async () => {
    const service = createService({
      recipe: recipe({
        start: node('START', { classify: {} }),
        classify: node(
          'INTENT_RECOGNITION',
          { end: {} },
          {
            inputs: { query_text: 'Some query' },
            outputs: { intent: '${intent}', confidence: '${confidence}' },
          },
        ),
        end: node('END'),
      }),
      modelInvocation: captureModel([], {
        content: JSON.stringify({ intent: 'alarm-analysis', confidence: 1.5 }),
      }),
    });

    const result = await service.execute(baseRequest(), new AbortController().signal);

    expect(result.status).toBe('FAILED');
    const failedNode = result.nodeResults.find((nr) => nr.nodeType === 'INTENT_RECOGNITION');
    expect(failedNode?.safeError?.code).toBe('WORKFLOW_LLM_OUTPUT_INVALID');
  });

  // -------------------------------------------------------------------------
  // Batch mode: LLM_ROUTER concurrent batch execution
  // -------------------------------------------------------------------------

  it('executes llm-router batch in parallel mode with 3 elements', async () => {
    const requests: ModelInvocationRequest[] = [];
    const service = createService({
      recipe: recipe({
        start: node('START', { askModel: {} }),
        askModel: node(
          'LLM_ROUTER',
          { end: {} },
          {
            inputs: { prompt: '${sub_question}' },
            batchConfig: {
              batchInputDataItem: ['query-a', 'query-b', 'query-c'],
              batchElementVariable: 'sub_question',
              batchMode: 'parallel',
            },
            outputs: {
              results: '${batch_results}',
              failures: '${failed_items}',
              lastResult: '${llm_result.content}',
              lastCompletion: '${llm_completion}',
            },
          },
        ),
        end: node('END'),
      }),
      modelInvocation: captureModel(requests, {
        content: JSON.stringify({ summary: 'answered' }),
      }),
    });

    const result = await service.execute(baseRequest(), new AbortController().signal);

    expect(result.status).toBe('COMPLETED');
    expect(requests).toHaveLength(3);
    const batchResults = result.outputVariables.results as unknown[];
    expect(batchResults).toHaveLength(3);
    expect(result.outputVariables.failures).toEqual([]);
    expect(result.outputVariables.lastResult).toBe('{"summary":"answered"}');
    expect(result.outputVariables.lastCompletion).toBeDefined();
  });

  it('forces non-stream mode in batch (uses complete, not stream)', async () => {
    let completeCalls = 0;
    let streamCalls = 0;
    const model: ModelInvocationService = {
      async complete() {
        completeCalls++;
        return { content: JSON.stringify({ ok: true }) };
      },
      async *stream() {
        streamCalls++;
        yield { content: JSON.stringify({ ok: true }) };
      },
    };
    const service = createService({
      recipe: recipe({
        start: node('START', { askModel: {} }),
        askModel: node(
          'LLM_ROUTER',
          { end: {} },
          {
            inputs: { prompt: '${sub_question}' },
            batchConfig: {
              batchInputDataItem: ['q1', 'q2'],
              batchElementVariable: 'sub_question',
              batchMode: 'parallel',
            },
            outputs: { results: '${batch_results}' },
          },
        ),
        end: node('END'),
      }),
      modelInvocation: model,
    });

    const result = await service.execute(baseRequest(), new AbortController().signal);

    expect(result.status).toBe('COMPLETED');
    expect(completeCalls).toBe(2);
    expect(streamCalls).toBe(0);
  });

  it('continues batch on element failure when failStrategy is continue', async () => {
    let callIndex = 0;
    const model: ModelInvocationService = {
      async complete() {
        callIndex++;
        if (callIndex === 2) {
          return {
            content: '',
            safeError: {
              code: 'MODEL_TIMEOUT',
              message: 'timeout',
              category: 'INTERNAL',
              retryable: false,
              safeDetails: { reasonCode: 'MODEL_TIMEOUT' },
            },
          };
        }
        return { content: JSON.stringify({ r: 'ok' }) };
      },
      async *stream() {
        yield { content: '' };
      },
    };
    const service = createService({
      recipe: recipe({
        start: node('START', { askModel: {} }),
        askModel: node(
          'LLM_ROUTER',
          { end: {} },
          {
            inputs: { prompt: '${sub_question}' },
            batchConfig: {
              batchInputDataItem: ['q1', 'q2-bad', 'q3'],
              batchElementVariable: 'sub_question',
              batchMode: 'serial',
              batchFailStrategy: 'continue',
            },
            outputs: { results: '${batch_results}', failures: '${failed_items}' },
          },
        ),
        end: node('END'),
      }),
      modelInvocation: model,
    });

    const result = await service.execute(baseRequest(), new AbortController().signal);

    expect(result.status).toBe('COMPLETED');
    const batchResults = result.outputVariables.results as unknown[];
    expect(batchResults).toHaveLength(2);
    const failedItems = result.outputVariables.failures as unknown[];
    expect(failedItems).toHaveLength(1);
    const askNode = result.nodeResults.find((item) => item.nodeType === 'LLM_ROUTER');
    expect(askNode?.status).toBe('NODE_COMPLETED');
  });

  it('aborts batch on element failure when failStrategy is abort', async () => {
    let callIndex = 0;
    const model: ModelInvocationService = {
      async complete() {
        callIndex++;
        if (callIndex === 2) {
          return {
            content: '',
            safeError: {
              code: 'MODEL_TIMEOUT',
              message: 'timeout',
              category: 'INTERNAL',
              retryable: false,
              safeDetails: { reasonCode: 'MODEL_TIMEOUT' },
            },
          };
        }
        return { content: JSON.stringify({ r: 'ok' }) };
      },
      async *stream() {
        yield { content: '' };
      },
    };
    const service = createService({
      recipe: recipe({
        start: node('START', { askModel: {} }),
        askModel: node(
          'LLM_ROUTER',
          { end: {} },
          {
            inputs: { prompt: '${sub_question}' },
            batchConfig: {
              batchInputDataItem: ['q1', 'q2-bad', 'q3-should-not-run'],
              batchElementVariable: 'sub_question',
              batchMode: 'serial',
              batchFailStrategy: 'abort',
            },
            outputs: { results: '${batch_results}', failures: '${failed_items}', last: '${llm_completion}' },
          },
        ),
        end: node('END'),
      }),
      modelInvocation: model,
    });

    const result = await service.execute(baseRequest(), new AbortController().signal);

    expect(result.status).toBe('FAILED');
    expect(callIndex).toBe(2);
    const batchResults = result.outputVariables.results as unknown[];
    expect(batchResults).toHaveLength(1);
    const failedItems = result.outputVariables.failures as unknown[];
    expect(failedItems).toHaveLength(1);
    const askNode = result.nodeResults.find((item) => item.nodeType === 'LLM_ROUTER');
    expect(askNode?.status).toBe('NODE_FAILED');
    expect(result.outputVariables.last).toBeUndefined();
  });

  it('merges batch results as map when batchResultMerge is map', async () => {
    const service = createService({
      recipe: recipe({
        start: node('START', { askModel: {} }),
        askModel: node(
          'LLM_ROUTER',
          { end: {} },
          {
            inputs: { prompt: '${sub_question}' },
            batchConfig: {
              batchInputDataItem: [
                { key: 'a', q: 'query-a' },
                { key: 'b', q: 'query-b' },
              ],
              batchElementVariable: 'sub_question',
              batchResultMerge: 'map',
            },
            outputs: { results: '${batch_results}' },
          },
        ),
        end: node('END'),
      }),
      modelInvocation: captureModel([], { content: JSON.stringify({ ok: true }) }),
    });

    const result = await service.execute(baseRequest(), new AbortController().signal);

    expect(result.status).toBe('COMPLETED');
    const batchResults = result.outputVariables.results as Record<string, unknown>;
    expect(batchResults['a']).toBeDefined();
    expect(batchResults['b']).toBeDefined();
  });

  it('isolates per-element variables in batch mode', async () => {
    const seenPrompts: string[] = [];
    const model: ModelInvocationService = {
      async complete(request) {
        const userMsg = request.messages.find((m) => m.role === 'USER');
        const text = userMsg && 'content' in userMsg ? userMsg.content[0] : null;
        if (text && 'text' in text) {
          seenPrompts.push(text.text);
        }
        return { content: JSON.stringify({ echo: text && 'text' in text ? text.text : '' }) };
      },
      async *stream() {
        yield { content: '' };
      },
    };
    const service = createService({
      recipe: recipe({
        start: node('START', { askModel: {} }),
        askModel: node(
          'LLM_ROUTER',
          { end: {} },
          {
            inputs: { prompt: '${sub_question}' },
            batchConfig: {
              batchInputDataItem: ['alpha', 'beta', 'gamma'],
              batchElementVariable: 'sub_question',
              batchMode: 'parallel',
            },
            outputs: { results: '${batch_results}' },
          },
        ),
        end: node('END'),
      }),
      modelInvocation: model,
    });

    const result = await service.execute(baseRequest(), new AbortController().signal);

    expect(result.status).toBe('COMPLETED');
    expect(seenPrompts.sort()).toEqual(['alpha', 'beta', 'gamma']);
  });

  it('does not produce diagnostic in batch mode', async () => {
    const service = createService({
      recipe: recipe({
        start: node('START', { askModel: {} }),
        askModel: node(
          'LLM_ROUTER',
          { end: {} },
          {
            inputs: { prompt: '${sub_question}' },
            batchConfig: {
              batchInputDataItem: ['q1', 'q2'],
              batchElementVariable: 'sub_question',
              batchMode: 'parallel',
            },
            outputs: { results: '${batch_results}' },
          },
        ),
        end: node('END'),
      }),
      modelInvocation: captureModel([], { content: JSON.stringify({ ok: true }) }),
    });

    const result = await service.execute(baseRequest(), new AbortController().signal);

    expect(result.status).toBe('COMPLETED');
    const askNode = result.nodeResults.find((item) => item.nodeType === 'LLM_ROUTER');
    expect(askNode?.diagnostic).toBeUndefined();
  });

  it('propagates cancellation during batch execution', async () => {
    const controller = new AbortController();
    let callIndex = 0;
    const model: ModelInvocationService = {
      async complete() {
        callIndex++;
        if (callIndex === 1) {
          controller.abort();
        }
        return { content: JSON.stringify({ ok: true }) };
      },
      async *stream() {
        yield { content: '' };
      },
    };
    const service = createService({
      recipe: recipe({
        start: node('START', { askModel: {} }),
        askModel: node(
          'LLM_ROUTER',
          { end: {} },
          {
            inputs: { prompt: '${sub_question}' },
            batchConfig: {
              batchInputDataItem: ['q1', 'q2', 'q3'],
              batchElementVariable: 'sub_question',
              batchMode: 'serial',
            },
            outputs: { results: '${batch_results}' },
          },
        ),
        end: node('END'),
      }),
      modelInvocation: model,
    });

    const result = await service.execute(baseRequest(), controller.signal);

    expect(result.status).toBe('INTERRUPTED');
    expect(result.nodeResults.find((item) => item.nodeType === 'LLM_ROUTER')?.safeError?.code).toBe('WORKFLOW_INTERRUPTED');
  });

  it('rejects batch on non-LLM_ROUTER LLM family node with WORKFLOW_BATCH_UNSUPPORTED_NODE_TYPE', async () => {
    const service = createService({
      recipe: recipe({
        start: node('START', { classify: {} }),
        classify: node(
          'INTENT_RECOGNITION',
          { end: {} },
          {
            inputs: {
              query_text: '${sub_question}',
              candidate_intents: ['alarm-analysis'],
            },
            batchConfig: {
              batchInputDataItem: ['q1', 'q2'],
              batchElementVariable: 'sub_question',
              batchMode: 'parallel',
            },
            outputs: { results: '${batch_results}' },
          },
        ),
        end: node('END'),
      }),
      modelInvocation: captureModel([], { content: '{"intent":"alarm-analysis","confidence":0.9}' }),
    });

    const result = await service.execute(baseRequest(), new AbortController().signal);

    expect(result.status).toBe('FAILED');
    const failedNode = result.nodeResults.find((nr) => nr.nodeType === 'INTENT_RECOGNITION');
    expect(failedNode?.safeError?.code).toBe('WORKFLOW_BATCH_UNSUPPORTED_NODE_TYPE');
  });

  it('passes inputs.model as modelId hint to resolveModelInvocationConfig', async () => {
    const hints: Array<{ readonly modelId?: string; readonly modelGroup?: string; readonly capabilityId?: string } | undefined> = [];
    const requests: ModelInvocationRequest[] = [];
    const service = createService({
      recipe: recipe({
        start: node('START', { askModel: {} }),
        askModel: node(
          'LLM_ROUTER',
          { end: {} },
          {
            inputs: {
              prompt: 'Summarize the alarm storm.',
              model: 'qwen2.5-72b-instruct',
            },
          },
        ),
        end: node('END'),
      }),
      modelInvocation: captureModel(requests, { content: '{"summary":"RAN alarm storm"}' }),
      resolveModelInvocationConfig: async (_request, _signal, hint) => {
        hints.push(hint);
        return { modelId: 'qwen2.5-72b-instruct', contextWindowTokens: 8192, inferenceOptions: {}, timeoutMs: 30_000, maxRetries: 2 };
      },
    });

    await service.execute(baseRequest(), new AbortController().signal);

    expect(hints).toHaveLength(1);
    expect(hints[0]?.modelId).toBe('qwen2.5-72b-instruct');
    expect(requests[0]?.modelId).toBe('qwen2.5-72b-instruct');
  });

  it('passes inputs.modelGroup and inputs.capability as hint fields', async () => {
    const hints: Array<{ readonly modelId?: string; readonly modelGroup?: string; readonly capabilityId?: string } | undefined> = [];
    const service = createService({
      recipe: recipe({
        start: node('START', { askModel: {} }),
        askModel: node(
          'LLM_ROUTER',
          { end: {} },
          {
            inputs: {
              prompt: 'Summarize.',
              modelGroup: 'large',
              capability: 'KNOWLEDGE_SUMMARY',
            },
          },
        ),
        end: node('END'),
      }),
      modelInvocation: captureModel([], { content: '{"summary":"ok"}' }),
      resolveModelInvocationConfig: async (_request, _signal, hint) => {
        hints.push(hint);
        return { modelId: 'deterministic-test-model', contextWindowTokens: 8192, inferenceOptions: {}, timeoutMs: 30_000, maxRetries: 2 };
      },
    });

    await service.execute(baseRequest(), new AbortController().signal);

    expect(hints).toHaveLength(1);
    expect(hints[0]?.modelGroup).toBe('large');
    expect(hints[0]?.capabilityId).toBe('KNOWLEDGE_SUMMARY');
    expect(hints[0]?.modelId).toBeUndefined();
  });

  it('omits hint when inputs has no model/modelGroup/capability', async () => {
    const hints: Array<{ readonly modelId?: string; readonly modelGroup?: string; readonly capabilityId?: string } | undefined> = [];
    const service = createService({
      recipe: recipe({
        start: node('START', { askModel: {} }),
        askModel: node(
          'LLM_ROUTER',
          { end: {} },
          {
            inputs: {
              prompt: 'Summarize.',
            },
          },
        ),
        end: node('END'),
      }),
      modelInvocation: captureModel([], { content: '{"summary":"ok"}' }),
      resolveModelInvocationConfig: async (_request, _signal, hint) => {
        hints.push(hint);
        return { modelId: 'deterministic-test-model', contextWindowTokens: 8192, inferenceOptions: {}, timeoutMs: 30_000, maxRetries: 2 };
      },
    });

    await service.execute(baseRequest(), new AbortController().signal);

    expect(hints).toHaveLength(1);
    expect(hints[0]).toBeUndefined();
  });

  it('passes model hint in batch mode', async () => {
    const hints: Array<{ readonly modelId?: string; readonly modelGroup?: string; readonly capabilityId?: string } | undefined> = [];
    const requests: ModelInvocationRequest[] = [];
    const service = createService({
      recipe: recipe({
        start: node('START', { askModel: {} }),
        askModel: node(
          'LLM_ROUTER',
          { end: {} },
          {
            inputs: {
              prompt: 'Summarize ${sub_question}.',
              model: 'qwen2.5-72b-instruct',
            },
            batchConfig: {
              batchInputDataItem: ['q1', 'q2'],
              batchElementVariable: 'sub_question',
              batchMode: 'parallel',
            },
            outputs: { results: '${batch_results}' },
          },
        ),
        end: node('END'),
      }),
      modelInvocation: captureModel(requests, { content: '{"summary":"ok"}' }),
      resolveModelInvocationConfig: async (_request, _signal, hint) => {
        hints.push(hint);
        return { modelId: 'qwen2.5-72b-instruct', contextWindowTokens: 8192, inferenceOptions: {}, timeoutMs: 30_000, maxRetries: 2 };
      },
    });

    const result = await service.execute(baseRequest(), new AbortController().signal);

    expect(result.status).toBe('COMPLETED');
    expect(hints).toHaveLength(1);
    expect(hints[0]?.modelId).toBe('qwen2.5-72b-instruct');
    expect(requests.every((r) => r.modelId === 'qwen2.5-72b-instruct')).toBe(true);
  });
});

function createService(input: {
  readonly recipe: RecipeDefinition;
  readonly modelInvocation: ModelInvocationService;
  readonly executionCorrelation?: ExecutionCorrelationPort;
  readonly modelConfig?: {
    readonly modelId: string;
    readonly contextWindowTokens: number;
    readonly inferenceOptions: {};
    readonly timeoutMs: number;
    readonly maxRetries: number;
  };
  readonly resolveModelInvocationConfig?: (
    request: WorkflowExecutionRequest,
    signal: AbortSignal,
    hint?: { readonly modelId?: string; readonly modelGroup?: string; readonly capabilityId?: string },
  ) => {
    readonly modelId: string;
    readonly contextWindowTokens: number;
    readonly inferenceOptions: {};
    readonly timeoutMs: number;
    readonly maxRetries: number;
  };
}) {
  return createWorkflowExecutionService({
    resolveRecipeDefinition: () => input.recipe,
    nodeCatalog: createWorkflowNodeCatalog({
      modelInvocation: input.modelInvocation,
      ...(input.capabilityInvocation === undefined ? {} : { capabilityInvocation: input.capabilityInvocation }),
      ...(input.resolveIntentRules !== undefined ? { resolveIntentRules: async () => input.resolveIntentRules! } : {}),
      resolveModelInvocationConfig:
        input.resolveModelInvocationConfig ??
        (async () =>
          input.modelConfig ?? {
            modelId: 'deterministic-test-model',
            contextWindowTokens: 8192,
            inferenceOptions: {},
            timeoutMs: 30_000,
            maxRetries: 2,
          }),
    }),
    ...(input.executionCorrelation === undefined ? {} : { executionCorrelation: input.executionCorrelation }),
  });
}

function captureModel(captured: ModelInvocationRequest[], response: { readonly content: string }): ModelInvocationService {
  return {
    async complete(request, _signal) {
      captured.push(request);
      return { content: response.content };
    },
    stream: modelEventStreamFixture(async function* (request, _signal) {
      captured.push(request);
      yield { content: response.content, finishReason: 'stop' };
    }),
  };
}

function sequenceModel(responses: ReadonlyArray<{ readonly content: string }>): ModelInvocationService {
  let index = 0;
  return {
    async complete(_request, _signal) {
      const selected = responses[Math.min(index, responses.length - 1)] ?? { content: '' };
      index += 1;
      return { content: selected.content };
    },
    stream: modelEventStreamFixture(async function* (request, _signal) {
      const selected = responses[Math.min(index, responses.length - 1)] ?? { content: '' };
      index += 1;
      yield { content: selected.content, finishReason: 'stop' };
    }),
  };
}

function recipe(nodes: RecipeDefinition['flowGraph']['nodes']): RecipeDefinition {
  return {
    recipeName: 'workflow-llm-test',
    version: 'v1',
    displayName: 'workflow-llm-test',
    flowGraph: { nodes },
  };
}

function node(
  type: RecipeDefinition['flowGraph']['nodes'][string]['type'],
  next: Record<string, { readonly condition?: string }> = {},
  rest: Partial<RecipeDefinition['flowGraph']['nodes'][string]> = {},
): RecipeDefinition['flowGraph']['nodes'][string] {
  return {
    type,
    next,
    ...rest,
  };
}

function sandboxCapability(structuredPayload) {
  return {
    async invoke(request) {
      return {
        invocationId: request.invocationId ?? 'sandbox-test',
        capabilityId: 'Python',
        status: 'COMPLETED',
        structuredPayload: structuredPayload ?? {},
      };
    },
  };
}

function baseRequest(): WorkflowExecutionRequest {
  return {
    recipeName: 'workflow-llm-test',
    recipeVersion: 'v1',
    inputVariables: {} as JsonObject,
    identityContext: {
      tenantId: brand<string, 'TenantId'>('tenant-workflow'),
      subjectId: brand<string, 'SubjectId'>('subject-workflow'),
      displayName: 'Workflow Operator',
    },
    agentId: brand<string, 'AgentId'>('workflow-agent'),
    agentVersion: brand<string, 'AgentVersion'>('v1'),
    sessionId: brand<string, 'SessionId'>('session-workflow'),
    requestId: brand<string, 'MessageId'>('request-workflow'),
    runId: brand<string, 'RequestRunId'>('run-workflow'),
    requestContextId: brand<string, 'RequestContextId'>('context-workflow'),
  };
}
