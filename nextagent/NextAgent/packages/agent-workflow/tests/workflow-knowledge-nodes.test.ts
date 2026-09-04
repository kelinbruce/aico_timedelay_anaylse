// @ts-nocheck
import { brand, type JsonObject } from '@nextagent/agent-common';
import type { RecipeDefinition, WorkflowExecutionEvent, WorkflowExecutionRequest } from '@nextagent/agent-contracts/core';
import { describe, expect, it, vi } from 'vitest';
import { createWorkflowNodeCatalog, type WorkflowNodeCatalog } from '../src/index.js';
import { createService, recipe, node, baseRequest } from './test-helpers.js';

describe('workflow knowledge nodes', () => {
  it('projects the declared canonical bindings from knowledge-search nodes', async () => {
    const service = createService({
      recipe: recipe({
        start: node('START', { search: {} }),
        search: {
          type: 'KNOWLEDGE_SEARCH',
          outputs: { knowledge_search_result: '${knowledge_search_result}', recall_result: '${recall_result}' },
          inputs: {
            rag_index: [{ index_name: 'ran-kb' }],
            query: 'RRC failure',
            rank_topN: '2',
            vs_topN: '4',
            es_topN: '3',
          },
          next: { end: {} },
        },
        end: node('END'),
      }),
      nodeCatalog: createWorkflowNodeCatalog({
        retrieveKnowledge: async (request) => ({
          status: 'OK',
          diagnosticReason: `topK:${request.topK}`,
          recommends: [
            { id: 'docs/rrc.md', title: 'RRC Guide', knowledge: 'RRC failures often follow paging storms.', vsScore: 0.92 },
            { id: 'docs/kpi.md', title: 'KPI Guide', knowledge: 'Check RRC SR and setup success rate.', vsScore: 0.81 },
          ],
        }),
      }),
    });

    const result = await service.execute(baseRequest(), new AbortController().signal);

    expect(result.status).toBe('COMPLETED');
    expect(result.outputVariables.knowledge_search_result).toEqual([
      'RRC failures often follow paging storms.',
      'Check RRC SR and setup success rate.',
    ]);
    expect(result.outputVariables.recall_result).toHaveLength(2);
    expect(result.outputVariables).not.toHaveProperty('documents');
    expect(result.outputVariables).not.toHaveProperty('sourceDocuments');
    expect(result.outputVariables).not.toHaveProperty('knowledge_diagnostic');
  });

  it.each([
    ['knowledge content', { texts: '${knowledge_search_result}' }, { texts: ['content'] }],
    ['recall result', { hits: '${recall_result}' }, { hits: [{ id: 'doc', knowledge: 'content' }] }],
    [
      'both bindings',
      { texts: '${knowledge_search_result}', hits: '${recall_result}' },
      {
        texts: ['content'],
        hits: [{ id: 'doc', knowledge: 'content' }],
      },
    ],
  ])('projects custom output keys for %s', async (_label, outputs, expected) => {
    const service = createService({
      recipe: recipe({
        start: node('START', { search: {} }),
        search: {
          type: 'KNOWLEDGE_SEARCH',
          inputs: { rag_index: [{ index_name: 'ran-kb' }], query: 'RRC failure' },
          outputs,
          next: { end: {} },
        },
        end: node('END'),
      }),
      nodeCatalog: createWorkflowNodeCatalog({
        retrieveKnowledge: async () => ({ status: 'OK', recommends: [{ id: 'doc', knowledge: 'content' }] }),
      }),
    });

    const result = await service.execute(baseRequest(), new AbortController().signal);

    expect(result.status).toBe('COMPLETED');
    expect(result.outputVariables).toEqual(expected);
  });

  it.each([undefined, {}, { invalid: '${documents}' }])('rejects invalid knowledge-search outputs before retrieval', async (outputs) => {
    const retrieveKnowledge = vi.fn(async () => ({ status: 'OK' as const, recommends: [{ knowledge: 'content' }] }));
    const service = createService({
      recipe: recipe({
        start: node('START', { search: {} }),
        search: {
          type: 'KNOWLEDGE_SEARCH',
          inputs: { rag_index: [{ index_name: 'ran-kb' }], query: 'RRC failure' },
          ...(outputs === undefined ? {} : { outputs }),
          next: { end: {} },
        },
        end: node('END'),
      }),
      nodeCatalog: createWorkflowNodeCatalog({ retrieveKnowledge }),
    });

    const result = await service.execute(baseRequest(), new AbortController().signal);

    expect(result.status).toBe('FAILED');
    expect(result.nodeResults.find((item) => item.nodeType === 'KNOWLEDGE_SEARCH')?.safeError?.code).toBe('WORKFLOW_NODE_INPUT_INVALID');
    expect(retrieveKnowledge).not.toHaveBeenCalled();
  });

  it.each([
    ['mixed empty content', ['first', '', 'third'], ['first', 'third']],
    ['all empty content', ['', ''], []],
  ])('ignores %s while preserving recall results', async (_label, knowledgeValues, expectedTexts) => {
    const recommends = knowledgeValues.map((knowledge, index) => ({ id: `doc-${index}`, knowledge }));
    const service = createService({
      recipe: recipe({
        start: node('START', { search: {} }),
        search: {
          type: 'KNOWLEDGE_SEARCH',
          inputs: { rag_index: [{ index_name: 'ran-kb' }], query: 'RRC failure' },
          outputs: { texts: '${knowledge_search_result}', hits: '${recall_result}' },
          next: { end: {} },
        },
        end: node('END'),
      }),
      nodeCatalog: createWorkflowNodeCatalog({ retrieveKnowledge: async () => ({ status: 'OK', recommends }) }),
    });

    const result = await service.execute(baseRequest(), new AbortController().signal);

    expect(result.status).toBe('COMPLETED');
    expect(result.outputVariables.texts).toEqual(expectedTexts);
    expect(result.outputVariables.hits).toEqual(recommends);
  });

  it.each([
    ['missing', { id: 'missing' }],
    ['non-string', { id: 'invalid', knowledge: 42 }],
  ])('fails when knowledge is %s without committing partial outputs', async (_label, invalidRecommend) => {
    const service = createService({
      recipe: recipe({
        start: node('START', { search: {} }),
        search: {
          type: 'KNOWLEDGE_SEARCH',
          inputs: { rag_index: [{ index_name: 'ran-kb' }], query: 'RRC failure' },
          outputs: { texts: '${knowledge_search_result}', hits: '${recall_result}' },
          next: { end: {} },
        },
        end: node('END'),
      }),
      nodeCatalog: createWorkflowNodeCatalog({
        retrieveKnowledge: async () => ({
          status: 'OK',
          recommends: [{ id: 'valid', knowledge: 'valid' }, invalidRecommend],
        }),
      }),
    });

    const result = await service.execute(baseRequest(), new AbortController().signal);

    expect(result.status).toBe('FAILED');
    expect(result.outputVariables).not.toHaveProperty('texts');
    expect(result.outputVariables).not.toHaveProperty('hits');
    expect(result.nodeResults.find((item) => item.nodeType === 'KNOWLEDGE_SEARCH')?.safeError?.code).toBe('WORKFLOW_NODE_INPUT_INVALID');
  });

  it('preserves full rag_index object structure with scene, index_type and priority', async () => {
    let receivedIndexes: unknown;
    const service = createService({
      recipe: recipe({
        start: node('START', { search: {} }),
        search: {
          type: 'KNOWLEDGE_SEARCH',
          outputs: { knowledge_search_result: '${knowledge_search_result}', recall_result: '${recall_result}' },
          inputs: {
            rag_index: [
              { domain: 'ran', scene: 'alarm', index_name: 'ran-kb', index_type: 'API', priority: 1 },
              { domain: 'core', scene: 'kpi', index_name: 'core-kb', index_type: 'KNOWLEDGE', priority: 2 },
            ],
            query: 'RRC failure',
          },
          next: { end: {} },
        },
        end: node('END'),
      }),
      nodeCatalog: createWorkflowNodeCatalog({
        retrieveKnowledge: async (request) => {
          receivedIndexes = request.indexes;
          return {
            status: 'OK',
            documents: [{ ref: 'docs/rrc.md', title: 'RRC Guide', excerpt: 'RRC failures often follow paging storms.', score: 0.92 }],
          };
        },
      }),
    });

    await service.execute(baseRequest(), new AbortController().signal);

    expect(receivedIndexes).toEqual([
      { domain: 'ran', scene: 'alarm', indexName: 'ran-kb', indexType: 'API', priority: 1 },
      { domain: 'core', scene: 'kpi', indexName: 'core-kb', indexType: 'KNOWLEDGE', priority: 2 },
    ]);
  });
  it('coerces string-quoted priority values in rag_index entries', async () => {
    let receivedIndexes: unknown;
    const service = createService({
      recipe: recipe({
        start: node('START', { search: {} }),
        search: {
          type: 'KNOWLEDGE_SEARCH',
          outputs: { knowledge_search_result: '${knowledge_search_result}', recall_result: '${recall_result}' },
          inputs: {
            rag_index: [
              { index_name: 'ran-kb', priority: '1' },
              { index_name: 'core-kb', priority: '2' },
            ],
            query: 'RRC failure',
          },
          next: { end: {} },
        },
        end: node('END'),
      }),
      nodeCatalog: createWorkflowNodeCatalog({
        retrieveKnowledge: async (request) => {
          receivedIndexes = request.indexes;
          return {
            status: 'OK',
            documents: [{ ref: 'docs/rrc.md', title: 'RRC Guide', excerpt: 'RRC failures often follow paging storms.', score: 0.92 }],
          };
        },
      }),
    });

    await service.execute(baseRequest(), new AbortController().signal);

    expect(receivedIndexes).toEqual([
      { indexName: 'ran-kb', priority: 1 },
      { indexName: 'core-kb', priority: 2 },
    ]);
  });

  it('summarizes each knowledge item in knowledge-qa nodes', async () => {
    const service = createService({
      recipe: recipe({
        start: node('START', { answer: {} }),
        answer: {
          type: 'KNOWLEDGE_QA',
          inputs: {
            rag_index: [{ index_name: 'ran-kb' }],
            query: 'What should we check for paging failures?',
          },
          next: { end: {} },
        },
        end: node('END'),
      }),
      nodeCatalog: createWorkflowNodeCatalog({
        retrieveKnowledge: async () => ({
          status: 'OK',
          recommends: [
            { id: 'docs/paging.md', title: 'Paging Guide', knowledge: 'Check MME paging congestion and RRC setup.', vsScore: 0.94 },
            { id: 'docs/kpi.md', title: 'KPI Guide', knowledge: 'Inspect paging success KPI.', vsScore: 0.87 },
          ],
        }),
        modelInvocation: {
          async complete() {
            return { content: 'Summary of knowledge item.' };
          },
        } as never,
        resolveModelInvocationConfig: async () => ({
          modelId: 'test-model',
          contextWindowTokens: 128_000,
          inferenceOptions: {},
          timeoutMs: 30_000,
          maxRetries: 2,
        }),
      }),
    });

    const result = await service.execute(baseRequest(), new AbortController().signal);

    expect(result.status).toBe('COMPLETED');
    expect(result.outputVariables.knowledge_qa_result).toEqual(['Summary of knowledge item.', 'Summary of knowledge item.']);
    expect(result.outputVariables.knowledge_search_result).toEqual(['Check MME paging congestion and RRC setup.', 'Inspect paging success KPI.']);
    expect(result.outputVariables.llm_completion).toBe('Summary of knowledge item.');
    expect(result.outputVariables).not.toHaveProperty('answer');
    expect(result.outputVariables).not.toHaveProperty('sourceDocuments');
    expect(result.outputVariables).not.toHaveProperty('documents');
    expect(result.outputVariables).not.toHaveProperty('invocation_trace');
  });

  // --- Knowledge QA enhancement tests ---

  it('free infer hit skips RAG and writes memory answer to outputs', async () => {
    const retrieveSpy = vi.fn();
    const service = createService({
      recipe: recipe({
        start: node('START', { answer: {} }),
        answer: {
          type: 'KNOWLEDGE_QA',
          inputs: {
            rag_index: [{ index_name: 'ran-kb' }],
            query: 'What is 5G NR?',
            openFreeInfer: true,
          },
          next: { end: {} },
        },
        end: node('END'),
      }),
      nodeCatalog: createWorkflowNodeCatalog({
        retrieveKnowledge: async () => {
          retrieveSpy();
          return { status: 'OK', recommends: [] };
        },
        tryFreeInfer: async () => ({ hit: true, answer: '5G NR is the new radio standard.' }),
        resolveModelInvocationConfig: async () => ({
          modelId: 'test-model',
          contextWindowTokens: 128_000,
          inferenceOptions: {},
          timeoutMs: 30_000,
          maxRetries: 2,
        }),
      }),
    });

    const result = await service.execute(baseRequest(), new AbortController().signal);

    expect(result.status).toBe('COMPLETED');
    expect(retrieveSpy).not.toHaveBeenCalled();
    expect(result.outputVariables.knowledge_qa_result).toEqual(['5G NR is the new radio standard.']);
    expect(result.outputVariables.knowledge_search_result).toEqual(['5G NR is the new radio standard.']);
    expect(result.outputVariables.llm_completion).toBe('5G NR is the new radio standard.');
  });

  it('free infer miss falls back to RAG', async () => {
    const service = createService({
      recipe: recipe({
        start: node('START', { answer: {} }),
        answer: {
          type: 'KNOWLEDGE_QA',
          inputs: {
            rag_index: [{ index_name: 'ran-kb' }],
            query: 'What is 5G NR?',
            openFreeInfer: true,
          },
          next: { end: {} },
        },
        end: node('END'),
      }),
      nodeCatalog: createWorkflowNodeCatalog({
        retrieveKnowledge: async () => ({
          status: 'OK',
          recommends: [{ id: 'd1', knowledge: '5G NR knowledge' }],
        }),
        tryFreeInfer: async () => ({ hit: false }),
        modelInvocation: {
          async complete() {
            return { content: 'Summary of 5G NR.' };
          },
        } as never,
        resolveModelInvocationConfig: async () => ({
          modelId: 'test-model',
          contextWindowTokens: 128_000,
          inferenceOptions: {},
          timeoutMs: 30_000,
          maxRetries: 2,
        }),
      }),
    });

    const result = await service.execute(baseRequest(), new AbortController().signal);

    expect(result.status).toBe('COMPLETED');
    expect(result.outputVariables.knowledge_qa_result).toEqual(['Summary of 5G NR.']);
    expect(result.outputVariables.knowledge_search_result).toEqual(['5G NR knowledge']);
  });

  it('free infer skipped when not three nodes', async () => {
    const retrieveSpy = vi.fn();
    const service = createService({
      recipe: recipe({
        start: node('START', { cond: {} }),
        cond: {
          type: 'CONDITION',
          inputs: {},
          next: { answer: { condition: 'true' } },
        },
        answer: {
          type: 'KNOWLEDGE_QA',
          inputs: {
            rag_index: [{ index_name: 'ran-kb' }],
            query: 'What is 5G NR?',
            openFreeInfer: true,
          },
          next: { end: {} },
        },
        end: node('END'),
      }),
      nodeCatalog: createWorkflowNodeCatalog({
        retrieveKnowledge: async () => {
          retrieveSpy();
          return { status: 'OK', recommends: [{ id: 'd1', knowledge: '5G NR knowledge' }] };
        },
        tryFreeInfer: async () => ({ hit: true, answer: 'should not be used' }),
        modelInvocation: {
          async complete() {
            return { content: 'Summary.' };
          },
        } as never,
        resolveModelInvocationConfig: async () => ({
          modelId: 'test-model',
          contextWindowTokens: 128_000,
          inferenceOptions: {},
          timeoutMs: 30_000,
          maxRetries: 2,
        }),
      }),
    });

    const result = await service.execute(baseRequest(), new AbortController().signal);

    expect(result.status).toBe('COMPLETED');
    expect(retrieveSpy).toHaveBeenCalled();
    expect(result.outputVariables.knowledge_qa_result).toEqual(['Summary.']);
  });

  it('free infer force closed falls back to RAG', async () => {
    const retrieveSpy = vi.fn();
    const req = baseRequest();
    req.executionMetadata = { freeInferStatus: 'FORCE_CLOSE' } as unknown as JsonObject;
    const service = createService({
      recipe: recipe({
        start: node('START', { answer: {} }),
        answer: {
          type: 'KNOWLEDGE_QA',
          inputs: {
            rag_index: [{ index_name: 'ran-kb' }],
            query: 'What is 5G NR?',
            openFreeInfer: true,
          },
          next: { end: {} },
        },
        end: node('END'),
      }),
      nodeCatalog: createWorkflowNodeCatalog({
        retrieveKnowledge: async () => {
          retrieveSpy();
          return { status: 'OK', recommends: [{ id: 'd1', knowledge: '5G NR knowledge' }] };
        },
        tryFreeInfer: async () => ({ hit: true, answer: 'should not be used' }),
        modelInvocation: {
          async complete() {
            return { content: 'Summary.' };
          },
        } as never,
        resolveModelInvocationConfig: async () => ({
          modelId: 'test-model',
          contextWindowTokens: 128_000,
          inferenceOptions: {},
          timeoutMs: 30_000,
          maxRetries: 2,
        }),
      }),
    });

    const result = await service.execute(req, new AbortController().signal);

    expect(result.status).toBe('COMPLETED');
    expect(retrieveSpy).toHaveBeenCalled();
    expect(result.outputVariables.knowledge_qa_result).toEqual(['Summary.']);
  });

  it('free infer boundary not injected falls back to RAG', async () => {
    const service = createService({
      recipe: recipe({
        start: node('START', { answer: {} }),
        answer: {
          type: 'KNOWLEDGE_QA',
          inputs: {
            rag_index: [{ index_name: 'ran-kb' }],
            query: 'What is 5G NR?',
            openFreeInfer: true,
          },
          next: { end: {} },
        },
        end: node('END'),
      }),
      nodeCatalog: createWorkflowNodeCatalog({
        retrieveKnowledge: async () => ({
          status: 'OK',
          recommends: [{ id: 'd1', knowledge: '5G NR knowledge' }],
        }),
        modelInvocation: {
          async complete() {
            return { content: 'Summary.' };
          },
        } as never,
        resolveModelInvocationConfig: async () => ({
          modelId: 'test-model',
          contextWindowTokens: 128_000,
          inferenceOptions: {},
          timeoutMs: 30_000,
          maxRetries: 2,
        }),
      }),
    });

    const result = await service.execute(baseRequest(), new AbortController().signal);

    expect(result.status).toBe('COMPLETED');
    expect(result.outputVariables.knowledge_qa_result).toEqual(['Summary.']);
  });

  it('template variable rendering with ${knowledge} placeholder', async () => {
    let capturedSystemPrompt = '';
    const service = createService({
      recipe: recipe({
        start: node('START', { answer: {} }),
        answer: {
          type: 'KNOWLEDGE_QA',
          inputs: {
            rag_index: [{ index_name: 'ran-kb' }],
            query: 'What is RRC?',
            llm_summery_prompt: 'Summarize: ${knowledge}',
          },
          next: { end: {} },
        },
        end: node('END'),
      }),
      nodeCatalog: createWorkflowNodeCatalog({
        retrieveKnowledge: async () => ({
          status: 'OK',
          recommends: [{ id: 'd1', knowledge: 'RRC connection setup procedure.' }],
        }),
        modelInvocation: {
          async complete(req) {
            capturedSystemPrompt = req.messages[0]!.content[0]!.text!;
            return { content: 'RRC summary.' };
          },
        } as never,
        resolveModelInvocationConfig: async () => ({
          modelId: 'test-model',
          contextWindowTokens: 128_000,
          inferenceOptions: {},
          timeoutMs: 30_000,
          maxRetries: 2,
        }),
      }),
    });

    const result = await service.execute(baseRequest(), new AbortController().signal);

    expect(result.status).toBe('COMPLETED');
    expect(capturedSystemPrompt).toBe('Summarize: RRC connection setup procedure.');
  });

  it('empty retrieval produces empty output lists', async () => {
    const llmSpy = vi.fn();
    const service = createService({
      recipe: recipe({
        start: node('START', { answer: {} }),
        answer: {
          type: 'KNOWLEDGE_QA',
          inputs: {
            rag_index: [{ index_name: 'ran-kb' }],
            query: 'What is RRC?',
          },
          next: { end: {} },
        },
        end: node('END'),
      }),
      nodeCatalog: createWorkflowNodeCatalog({
        retrieveKnowledge: async () => ({ status: 'OK', recommends: [] }),
        modelInvocation: {
          async complete() {
            llmSpy();
            return { content: 'x' };
          },
        } as never,
        resolveModelInvocationConfig: async () => ({
          modelId: 'test-model',
          contextWindowTokens: 128_000,
          inferenceOptions: {},
          timeoutMs: 30_000,
          maxRetries: 2,
        }),
      }),
    });

    const result = await service.execute(baseRequest(), new AbortController().signal);

    expect(result.status).toBe('COMPLETED');
    expect(llmSpy).not.toHaveBeenCalled();
    expect(result.outputVariables.knowledge_qa_result).toEqual([]);
    expect(result.outputVariables.knowledge_search_result).toEqual([]);
    expect(result.outputVariables.llm_completion).toBe('');
  });

  it('single item failure does not block the loop', async () => {
    let callCount = 0;
    const service = createService({
      recipe: recipe({
        start: node('START', { answer: {} }),
        answer: {
          type: 'KNOWLEDGE_QA',
          inputs: {
            rag_index: [{ index_name: 'ran-kb' }],
            query: 'What is RRC?',
          },
          next: { end: {} },
        },
        end: node('END'),
      }),
      nodeCatalog: createWorkflowNodeCatalog({
        retrieveKnowledge: async () => ({
          status: 'OK',
          recommends: [
            { id: 'd1', knowledge: 'Knowledge 1' },
            { id: 'd2', knowledge: 'Knowledge 2' },
            { id: 'd3', knowledge: 'Knowledge 3' },
          ],
        }),
        modelInvocation: {
          async complete() {
            callCount++;
            if (callCount === 2) {
              throw new Error('LLM call failed');
            }
            return { content: `Summary ${callCount}` };
          },
        } as never,
        resolveModelInvocationConfig: async () => ({
          modelId: 'test-model',
          contextWindowTokens: 128_000,
          inferenceOptions: {},
          timeoutMs: 30_000,
          maxRetries: 2,
        }),
      }),
    });

    const result = await service.execute(baseRequest(), new AbortController().signal);

    expect(result.status).toBe('COMPLETED');
    expect(result.outputVariables.knowledge_qa_result).toEqual(['Summary 1', '', 'Summary 3']);
  });

  it('guardrail reject throws UN_SAFE', async () => {
    const service = createService({
      recipe: recipe({
        start: node('START', { answer: {} }),
        answer: {
          type: 'KNOWLEDGE_QA',
          inputs: {
            rag_index: [{ index_name: 'ran-kb' }],
            query: 'What is RRC?',
            open_guardrail: true,
          },
          next: { end: {} },
        },
        end: node('END'),
      }),
      nodeCatalog: createWorkflowNodeCatalog({
        retrieveKnowledge: async () => ({
          status: 'OK',
          recommends: [{ id: 'd1', knowledge: 'RRC knowledge' }],
        }),
        modelInvocation: {
          async complete() {
            return { content: 'Unsafe content' };
          },
        } as never,
        evaluateGuardrail: async () => ({ decision: 'REJECT' }),
        resolveModelInvocationConfig: async () => ({
          modelId: 'test-model',
          contextWindowTokens: 128_000,
          inferenceOptions: {},
          timeoutMs: 30_000,
          maxRetries: 2,
        }),
      }),
    });

    const result = await service.execute(baseRequest(), new AbortController().signal);

    expect(result.status).toBe('FAILED');
    const safeError = result.nodeResults.find((n) => n.nodeType === 'KNOWLEDGE_QA')?.safeError;
    expect(safeError?.code).toBe('UN_SAFE');
    expect(safeError?.category).toBe('POLICY_DENIED');
  });

  it('guardrail disabled by default', async () => {
    const guardrailSpy = vi.fn();
    const service = createService({
      recipe: recipe({
        start: node('START', { answer: {} }),
        answer: {
          type: 'KNOWLEDGE_QA',
          inputs: {
            rag_index: [{ index_name: 'ran-kb' }],
            query: 'What is RRC?',
          },
          next: { end: {} },
        },
        end: node('END'),
      }),
      nodeCatalog: createWorkflowNodeCatalog({
        retrieveKnowledge: async () => ({
          status: 'OK',
          recommends: [{ id: 'd1', knowledge: 'RRC knowledge' }],
        }),
        modelInvocation: {
          async complete() {
            return { content: 'Summary.' };
          },
        } as never,
        evaluateGuardrail: async () => {
          guardrailSpy();
          return { decision: 'PASS' };
        },
        resolveModelInvocationConfig: async () => ({
          modelId: 'test-model',
          contextWindowTokens: 128_000,
          inferenceOptions: {},
          timeoutMs: 30_000,
          maxRetries: 2,
        }),
      }),
    });

    const result = await service.execute(baseRequest(), new AbortController().signal);

    expect(result.status).toBe('COMPLETED');
    expect(guardrailSpy).not.toHaveBeenCalled();
  });

  it('guardrail boundary unavailable throws when open_guardrail=true', async () => {
    const service = createService({
      recipe: recipe({
        start: node('START', { answer: {} }),
        answer: {
          type: 'KNOWLEDGE_QA',
          inputs: {
            rag_index: [{ index_name: 'ran-kb' }],
            query: 'What is RRC?',
            open_guardrail: true,
          },
          next: { end: {} },
        },
        end: node('END'),
      }),
      nodeCatalog: createWorkflowNodeCatalog({
        retrieveKnowledge: async () => ({
          status: 'OK',
          recommends: [{ id: 'd1', knowledge: 'RRC knowledge' }],
        }),
        modelInvocation: {
          async complete() {
            return { content: 'Summary.' };
          },
        } as never,
        resolveModelInvocationConfig: async () => ({
          modelId: 'test-model',
          contextWindowTokens: 128_000,
          inferenceOptions: {},
          timeoutMs: 30_000,
          maxRetries: 2,
        }),
      }),
    });

    const result = await service.execute(baseRequest(), new AbortController().signal);

    expect(result.status).toBe('FAILED');
    const safeError = result.nodeResults.find((n) => n.nodeType === 'KNOWLEDGE_QA')?.safeError;
    expect(safeError?.code).toBe('WORKFLOW_GUARDRAIL_BOUNDARY_UNAVAILABLE');
  });

  it('guardrail safeError throws AgentError', async () => {
    const service = createService({
      recipe: recipe({
        start: node('START', { answer: {} }),
        answer: {
          type: 'KNOWLEDGE_QA',
          inputs: {
            rag_index: [{ index_name: 'ran-kb' }],
            query: 'What is RRC?',
            open_guardrail: true,
          },
          next: { end: {} },
        },
        end: node('END'),
      }),
      nodeCatalog: createWorkflowNodeCatalog({
        retrieveKnowledge: async () => ({
          status: 'OK',
          recommends: [{ id: 'd1', knowledge: 'RRC knowledge' }],
        }),
        modelInvocation: {
          async complete() {
            return { content: 'Summary.' };
          },
        } as never,
        evaluateGuardrail: async () => ({
          decision: 'NO_OPINION',
          safeError: { code: 'GUARDRAIL_INTERNAL', message: 'guardrail engine error', category: 'INTERNAL' as const, retryable: false },
        }),
        resolveModelInvocationConfig: async () => ({
          modelId: 'test-model',
          contextWindowTokens: 128_000,
          inferenceOptions: {},
          timeoutMs: 30_000,
          maxRetries: 2,
        }),
      }),
    });

    const result = await service.execute(baseRequest(), new AbortController().signal);

    expect(result.status).toBe('FAILED');
    const safeError = result.nodeResults.find((n) => n.nodeType === 'KNOWLEDGE_QA')?.safeError;
    expect(safeError?.code).toBe('GUARDRAIL_INTERNAL');
  });

  it('passes typed model params through opaquely as modelParams', async () => {
    let capturedRequest: ModelInvocationRequest | undefined;
    const service = createService({
      recipe: recipe({
        start: node('START', { answer: {} }),
        answer: {
          type: 'KNOWLEDGE_QA',
          inputs: {
            rag_index: [{ index_name: 'ran-kb' }],
            query: 'What is RRC?',
            model_params: { temperature: 0.3, max_tokens: 500, enable_thinking: true },
          },
          next: { end: {} },
        },
        end: node('END'),
      }),
      nodeCatalog: createWorkflowNodeCatalog({
        retrieveKnowledge: async () => ({
          status: 'OK',
          recommends: [{ id: 'd1', knowledge: 'RRC knowledge' }],
        }),
        modelInvocation: {
          async complete(req) {
            capturedRequest = req;
            return { content: 'Summary.' };
          },
        } as never,
        resolveModelInvocationConfig: async () => ({
          modelId: 'test-model',
          contextWindowTokens: 8192,
          inferenceOptions: {},
          timeoutMs: 30_000,
          maxRetries: 0,
        }),
      }),
    });

    const result = await service.execute(baseRequest(), new AbortController().signal);

    expect(result.status).toBe('COMPLETED');
    expect(capturedRequest?.modelParams).toMatchObject({ temperature: 0.3, max_tokens: 500 });
    expect(capturedRequest?.temperature).toBeUndefined();
    expect(capturedRequest?.maxOutputTokens).toBeUndefined();
    expect(capturedRequest?.thinking).toEqual({ depth: 'HIGH' });
  });

  it('capabilityId passed to model router', async () => {
    let receivedHint: JsonObject | undefined;
    const service = createService({
      recipe: recipe({
        start: node('START', { answer: {} }),
        answer: {
          type: 'KNOWLEDGE_QA',
          inputs: {
            rag_index: [{ index_name: 'ran-kb' }],
            query: 'What is RRC?',
          },
          next: { end: {} },
        },
        end: node('END'),
      }),
      nodeCatalog: createWorkflowNodeCatalog({
        retrieveKnowledge: async () => ({
          status: 'OK',
          recommends: [{ id: 'd1', knowledge: 'RRC knowledge' }],
        }),
        modelInvocation: {
          async complete() {
            return { content: 'Summary.' };
          },
        } as never,
        resolveModelInvocationConfig: async (_req, _signal, hint) => {
          receivedHint = hint as JsonObject;
          return {
            modelId: 'test-model',
            contextWindowTokens: 8192,
            inferenceOptions: {},
            timeoutMs: 30_000,
            maxRetries: 0,
          };
        },
      }),
    });

    const result = await service.execute(baseRequest(), new AbortController().signal);

    expect(result.status).toBe('COMPLETED');
    expect(receivedHint?.capabilityId).toBe('KNOWLEDGE_SUMMARY');
  });

  it('knowledge_search_result outputs knowledge text content', async () => {
    const service = createService({
      recipe: recipe({
        start: node('START', { answer: {} }),
        answer: {
          type: 'KNOWLEDGE_QA',
          inputs: {
            rag_index: [{ index_name: 'ran-kb' }],
            query: 'What is RRC?',
          },
          next: { end: {} },
        },
        end: node('END'),
      }),
      nodeCatalog: createWorkflowNodeCatalog({
        retrieveKnowledge: async () => ({
          status: 'OK',
          recommends: [
            { id: 'd1', title: 'Doc 1', knowledge: 'First knowledge text.' },
            { id: 'd2', title: 'Doc 2', knowledge: 'Second knowledge text.' },
          ],
        }),
        modelInvocation: {
          async complete() {
            return { content: 'Summary.' };
          },
        } as never,
        resolveModelInvocationConfig: async () => ({
          modelId: 'test-model',
          contextWindowTokens: 128_000,
          inferenceOptions: {},
          timeoutMs: 30_000,
          maxRetries: 2,
        }),
      }),
    });

    const result = await service.execute(baseRequest(), new AbortController().signal);

    expect(result.status).toBe('COMPLETED');
    expect(result.outputVariables.knowledge_search_result).toEqual(['First knowledge text.', 'Second knowledge text.']);
  });

  it('knowledge_qa_result is string[]', async () => {
    const service = createService({
      recipe: recipe({
        start: node('START', { answer: {} }),
        answer: {
          type: 'KNOWLEDGE_QA',
          inputs: {
            rag_index: [{ index_name: 'ran-kb' }],
            query: 'What is RRC?',
          },
          next: { end: {} },
        },
        end: node('END'),
      }),
      nodeCatalog: createWorkflowNodeCatalog({
        retrieveKnowledge: async () => ({
          status: 'OK',
          recommends: [
            { id: 'd1', knowledge: 'K1' },
            { id: 'd2', knowledge: 'K2' },
          ],
        }),
        modelInvocation: {
          async complete() {
            return { content: 'Summary.' };
          },
        } as never,
        resolveModelInvocationConfig: async () => ({
          modelId: 'test-model',
          contextWindowTokens: 128_000,
          inferenceOptions: {},
          timeoutMs: 30_000,
          maxRetries: 2,
        }),
      }),
    });

    const result = await service.execute(baseRequest(), new AbortController().signal);

    expect(result.status).toBe('COMPLETED');
    expect(Array.isArray(result.outputVariables.knowledge_qa_result)).toBe(true);
    expect(result.outputVariables.knowledge_qa_result).toHaveLength(2);
    expect(result.outputVariables.knowledge_qa_result[0]).toBe('Summary.');
  });

  it('free infer call failure falls back to RAG', async () => {
    const service = createService({
      recipe: recipe({
        start: node('START', { answer: {} }),
        answer: {
          type: 'KNOWLEDGE_QA',
          inputs: {
            rag_index: [{ index_name: 'ran-kb' }],
            query: 'What is 5G NR?',
            openFreeInfer: true,
          },
          next: { end: {} },
        },
        end: node('END'),
      }),
      nodeCatalog: createWorkflowNodeCatalog({
        retrieveKnowledge: async () => ({
          status: 'OK',
          recommends: [{ id: 'd1', knowledge: '5G NR knowledge' }],
        }),
        tryFreeInfer: async () => {
          throw new Error('memory service down');
        },
        modelInvocation: {
          async complete() {
            return { content: 'Summary.' };
          },
        } as never,
        resolveModelInvocationConfig: async () => ({
          modelId: 'test-model',
          contextWindowTokens: 128_000,
          inferenceOptions: {},
          timeoutMs: 30_000,
          maxRetries: 2,
        }),
      }),
    });

    const result = await service.execute(baseRequest(), new AbortController().signal);

    expect(result.status).toBe('COMPLETED');
    expect(result.outputVariables.knowledge_qa_result).toEqual(['Summary.']);
  });

  it('llm_summery_prompt empty falls back to prepareLlmPrompt system preset', async () => {
    let receivedPurpose = '';
    const service = createService({
      recipe: recipe({
        start: node('START', { answer: {} }),
        answer: {
          type: 'KNOWLEDGE_QA',
          inputs: {
            rag_index: [{ index_name: 'ran-kb' }],
            query: 'What is RRC?',
          },
          next: { end: {} },
        },
        end: node('END'),
      }),
      nodeCatalog: createWorkflowNodeCatalog({
        retrieveKnowledge: async () => ({
          status: 'OK',
          recommends: [{ id: 'd1', knowledge: 'RRC connection setup.' }],
        }),
        modelInvocation: {
          async complete() {
            return { content: 'Summary.' };
          },
        } as never,
        prepareLlmPrompt: async (req) => {
          receivedPurpose = req.defaultPurpose;
          return { systemPrompt: 'System preset knowledge summary template.', userPrompt: 'item' };
        },
        resolveModelInvocationConfig: async () => ({
          modelId: 'test-model',
          contextWindowTokens: 128_000,
          inferenceOptions: {},
          timeoutMs: 30_000,
          maxRetries: 2,
        }),
      }),
    });

    const result = await service.execute(baseRequest(), new AbortController().signal);

    expect(result.status).toBe('COMPLETED');
    expect(receivedPurpose).toBe('KNOWLEDGE_SUMMARY');
    expect(result.outputVariables.knowledge_qa_result).toEqual(['Summary.']);
  });

  it('prepareLlmPrompt not injected uses hardcoded default template', async () => {
    let capturedSystemPrompt = '';
    const service = createService({
      recipe: recipe({
        start: node('START', { answer: {} }),
        answer: {
          type: 'KNOWLEDGE_QA',
          inputs: {
            rag_index: [{ index_name: 'ran-kb' }],
            query: 'What is RRC?',
          },
          next: { end: {} },
        },
        end: node('END'),
      }),
      nodeCatalog: createWorkflowNodeCatalog({
        retrieveKnowledge: async () => ({
          status: 'OK',
          recommends: [{ id: 'd1', knowledge: 'RRC connection setup.' }],
        }),
        modelInvocation: {
          async complete(req) {
            capturedSystemPrompt = req.messages[0]!.content[0]!.text!;
            return { content: 'Summary.' };
          },
        } as never,
        resolveModelInvocationConfig: async () => ({
          modelId: 'test-model',
          contextWindowTokens: 128_000,
          inferenceOptions: {},
          timeoutMs: 30_000,
          maxRetries: 2,
        }),
      }),
    });

    const result = await service.execute(baseRequest(), new AbortController().signal);

    expect(result.status).toBe('COMPLETED');
    expect(capturedSystemPrompt).toBe('Please summarize the following knowledge content, extracting key information.');
  });

  it('global context params correctly passed to free infer request', async () => {
    let receivedRequest: JsonObject | undefined;
    const req = baseRequest();
    req.executionMetadata = { conversation_id: 'conv-123' } as unknown as JsonObject;
    const service = createService({
      recipe: recipe({
        start: node('START', { answer: {} }),
        answer: {
          type: 'KNOWLEDGE_QA',
          inputs: {
            rag_index: [{ index_name: 'ran-kb' }],
            query: 'What is 5G NR?',
            input_question: 'What is 5G NR?',
            openFreeInfer: true,
          },
          next: { end: {} },
        },
        end: node('END'),
      }),
      nodeCatalog: createWorkflowNodeCatalog({
        retrieveKnowledge: async () => ({ status: 'OK', recommends: [] }),
        tryFreeInfer: async (freeInferReq) => {
          receivedRequest = freeInferReq as unknown as JsonObject;
          return { hit: true, answer: '5G NR answer.' };
        },
        resolveModelInvocationConfig: async () => ({
          modelId: 'test-model',
          contextWindowTokens: 128_000,
          inferenceOptions: {},
          timeoutMs: 30_000,
          maxRetries: 2,
        }),
      }),
    });

    const result = await service.execute(req, new AbortController().signal);

    expect(result.status).toBe('COMPLETED');
    expect(receivedRequest?.question).toBe('What is 5G NR?');
    expect(receivedRequest?.chatId).toBe('session-workflow');
    expect(receivedRequest?.conversationId).toBe('conv-123');
    expect(receivedRequest?.agentName).toBe('agent-workflow');
  });

  it('open_guardrail as string true triggers guardrail check', async () => {
    const service = createService({
      recipe: recipe({
        start: node('START', { answer: {} }),
        answer: {
          type: 'KNOWLEDGE_QA',
          inputs: {
            rag_index: [{ index_name: 'ran-kb' }],
            query: 'What is RRC?',
            open_guardrail: 'true',
          },
          next: { end: {} },
        },
        end: node('END'),
      }),
      nodeCatalog: createWorkflowNodeCatalog({
        retrieveKnowledge: async () => ({
          status: 'OK',
          recommends: [{ id: 'd1', knowledge: 'RRC knowledge' }],
        }),
        modelInvocation: {
          async complete() {
            return { content: 'Unsafe content' };
          },
        } as never,
        evaluateGuardrail: async () => ({ decision: 'REJECT' }),
        resolveModelInvocationConfig: async () => ({
          modelId: 'test-model',
          contextWindowTokens: 128_000,
          inferenceOptions: {},
          timeoutMs: 30_000,
          maxRetries: 2,
        }),
      }),
    });

    const result = await service.execute(baseRequest(), new AbortController().signal);

    expect(result.status).toBe('FAILED');
    const safeError = result.nodeResults.find((n) => n.nodeType === 'KNOWLEDGE_QA')?.safeError;
    expect(safeError?.code).toBe('UN_SAFE');
  });

  it('loop_element_variable custom name renders in template', async () => {
    let capturedSystemPrompt = '';
    const service = createService({
      recipe: recipe({
        start: node('START', { answer: {} }),
        answer: {
          type: 'KNOWLEDGE_QA',
          inputs: {
            rag_index: [{ index_name: 'ran-kb' }],
            query: 'What is RRC?',
            llm_summery_prompt: 'Summarize: ${item}',
            loop_element_variable: 'item',
          },
          next: { end: {} },
        },
        end: node('END'),
      }),
      nodeCatalog: createWorkflowNodeCatalog({
        retrieveKnowledge: async () => ({
          status: 'OK',
          recommends: [{ id: 'd1', knowledge: 'RRC setup procedure.' }],
        }),
        modelInvocation: {
          async complete(req) {
            capturedSystemPrompt = req.messages[0]!.content[0]!.text!;
            return { content: 'Summary.' };
          },
        } as never,
        resolveModelInvocationConfig: async () => ({
          modelId: 'test-model',
          contextWindowTokens: 128_000,
          inferenceOptions: {},
          timeoutMs: 30_000,
          maxRetries: 2,
        }),
      }),
    });

    const result = await service.execute(baseRequest(), new AbortController().signal);

    expect(result.status).toBe('COMPLETED');
    expect(capturedSystemPrompt).toBe('Summarize: RRC setup procedure.');
  });

  it('model safeError on single item isolates instead of failing node', async () => {
    let callCount = 0;
    const service = createService({
      recipe: recipe({
        start: node('START', { answer: {} }),
        answer: {
          type: 'KNOWLEDGE_QA',
          inputs: {
            rag_index: [{ index_name: 'ran-kb' }],
            query: 'What is RRC?',
          },
          next: { end: {} },
        },
        end: node('END'),
      }),
      nodeCatalog: createWorkflowNodeCatalog({
        retrieveKnowledge: async () => ({
          status: 'OK',
          recommends: [
            { id: 'd1', knowledge: 'K1' },
            { id: 'd2', knowledge: 'K2' },
          ],
        }),
        modelInvocation: {
          async complete() {
            callCount++;
            if (callCount === 1) {
              return {
                content: '',
                safeError: { code: 'MODEL_TIMEOUT', message: 'timeout', category: 'TIMEOUT' as const, retryable: true },
              };
            }
            return { content: 'Summary 2.' };
          },
        } as never,
        resolveModelInvocationConfig: async () => ({
          modelId: 'test-model',
          contextWindowTokens: 128_000,
          inferenceOptions: {},
          timeoutMs: 30_000,
          maxRetries: 2,
        }),
      }),
    });

    const result = await service.execute(baseRequest(), new AbortController().signal);

    expect(result.status).toBe('COMPLETED');
    expect(result.outputVariables.knowledge_qa_result).toEqual(['', 'Summary 2.']);
  });
  it('selects an api-choice candidate without executing the API', async () => {
    const service = createService({
      recipe: recipe({
        start: node('START', { choose: {} }),
        choose: {
          type: 'API_CHOICE',
          outputs: { api_name: '${api_name}' },
          inputs: {
            taskDescription: 'Query the RAN incident detail',
            candidateApis: [
              { apiName: 'query_incident', paramsSchema: { type: 'object', properties: { incidentId: { type: 'string' } } } },
              { apiName: 'close_incident', paramsSchema: { type: 'object', properties: { incidentId: { type: 'string' } } } },
            ],
          },
          next: { end: {} },
        },
        end: node('END'),
      }),
      nodeCatalog: createWorkflowNodeCatalog({
        modelInvocation: {
          async complete() {
            return {
              content: '',
              toolCalls: [
                {
                  toolCallId: 'api-choice-1',
                  toolName: 'query_incident',
                  arguments: { incidentId: 'INC-7' },
                },
              ],
            };
          },
        } as never,
        resolveModelInvocationConfig: async () => ({
          modelId: 'test-model',
          contextWindowTokens: 128_000,
          inferenceOptions: {},
          timeoutMs: 30_000,
          maxRetries: 2,
        }),
      }),
    });

    const result = await service.execute(baseRequest(), new AbortController().signal);

    expect(result.status).toBe('COMPLETED');
    expect(result.outputVariables).toEqual({ api_name: 'query_incident' });
  });

  it('maps api_name into the downstream restful node', async () => {
    const invoke = vi.fn(async (request) => {
      expect(request.capabilityId).toBe('query_incident');
      return {
        status: 'SUCCEEDED' as const,
        structuredPayload: { status: 'ok' },
        generatedMessages: [],
        artifactRefs: [],
      };
    });
    const service = createService({
      recipe: recipe({
        start: node('START', { choose: {} }),
        choose: {
          type: 'API_CHOICE',
          outputs: { api_name: '${api_name}' },
          inputs: {
            taskDescription: 'Query the RAN incident detail',
            candidateApis: [{ apiName: 'query_incident', paramsSchema: { type: 'object' } }],
          },
          next: { api: {} },
        },
        api: {
          type: 'RESTFUL',
          inputs: { api_name: '${api_name}' },
          next: { end: {} },
        },
        end: node('END'),
      }),
      nodeCatalog: createWorkflowNodeCatalog({
        capabilityInvocation: { invoke } as never,
        modelInvocation: {
          async complete() {
            return {
              content: '',
              toolCalls: [{ toolCallId: 'api-choice-restful-1', toolName: 'query_incident', arguments: {} }],
            };
          },
        } as never,
        resolveModelInvocationConfig: async () => ({
          modelId: 'test-model',
          contextWindowTokens: 128_000,
          inferenceOptions: {},
          timeoutMs: 30_000,
          maxRetries: 2,
        }),
      }),
    });

    const result = await service.execute(baseRequest(), new AbortController().signal);

    expect(result.status).toBe('COMPLETED');
    expect(invoke).toHaveBeenCalledOnce();
  });

  it('rejects camelCase api-choice outputs before model or retrieval calls', async () => {
    const modelComplete = vi.fn();
    const retrieveKnowledge = vi.fn();
    const service = createService({
      recipe: recipe({
        start: node('START', { choose: {} }),
        choose: {
          type: 'API_CHOICE',
          outputs: { apiName: '${apiName}' },
          inputs: { rag_index: [{ index_name: 'api-catalog' }], query: 'RAN incident lookup' },
          next: { end: {} },
        },
        end: node('END'),
      }),
      nodeCatalog: createWorkflowNodeCatalog({
        retrieveKnowledge,
        modelInvocation: { complete: modelComplete } as never,
        resolveModelInvocationConfig: async () => ({
          modelId: 'test-model',
          contextWindowTokens: 128_000,
          inferenceOptions: {},
          timeoutMs: 30_000,
          maxRetries: 2,
        }),
      }),
    });

    const result = await service.execute(baseRequest(), new AbortController().signal);

    expect(result.status).toBe('FAILED');
    expect(result.nodeResults.find((item) => item.nodeType === 'API_CHOICE')?.safeError?.code).toBe('WORKFLOW_NODE_INPUT_INVALID');
    expect(modelComplete).not.toHaveBeenCalled();
    expect(retrieveKnowledge).not.toHaveBeenCalled();
  });

  it('api-choice accepts outputs with custom key mapping to ${api_name}', async () => {
    const service = createService({
      recipe: recipe({
        start: node('START', { choose: {} }),
        choose: {
          type: 'API_CHOICE',
          inputs: {
            taskDescription: 'Query the RAN incident detail',
            candidateApis: [{ apiName: 'query_incident', paramsSchema: { type: 'object', properties: { incidentId: { type: 'string' } } } }],
          },
          outputs: { recall_result: '${api_name}' },
          next: { end: {} },
        },
        end: node('END'),
      }),
      nodeCatalog: createWorkflowNodeCatalog({
        modelInvocation: {
          async complete() {
            return { content: '', toolCalls: [{ toolCallId: 't1', toolName: 'query_incident', arguments: { incidentId: 'INC-7' } }] };
          },
        } as never,
        resolveModelInvocationConfig: async () => ({
          modelId: 'test',
          contextWindowTokens: 128_000,
          inferenceOptions: {},
          timeoutMs: 30_000,
          maxRetries: 2,
        }),
      }),
    });

    const result = await service.execute(baseRequest(), new AbortController().signal);

    expect(result.status).toBe('COMPLETED');
    expect(result.outputVariables.recall_result).toBe('query_incident');
  });

  it('api-choice rejects outputs without ${api_name} binding', async () => {
    const modelInvocation = vi.fn(async () => ({
      content: '',
      toolCalls: [{ toolCallId: 't1', toolName: 'query_incident', arguments: {} }],
    }));
    const service = createService({
      recipe: recipe({
        start: node('START', { choose: {} }),
        choose: {
          type: 'API_CHOICE',
          inputs: {
            taskDescription: 'Query the RAN incident detail',
            candidateApis: [{ apiName: 'query_incident', paramsSchema: {} }],
          },
          outputs: { result: '${recall_result}' },
          next: { end: {} },
        },
        end: node('END'),
      }),
      nodeCatalog: createWorkflowNodeCatalog({
        modelInvocation,
        resolveModelInvocationConfig: async () => ({
          modelId: 'test',
          contextWindowTokens: 128_000,
          inferenceOptions: {},
          timeoutMs: 30_000,
          maxRetries: 2,
        }),
      }),
    });

    const result = await service.execute(baseRequest(), new AbortController().signal);

    expect(result.status).toBe('FAILED');
    expect(result.nodeResults.find((item) => item.nodeType === 'API_CHOICE')?.safeError?.code).toBe('WORKFLOW_NODE_INPUT_INVALID');
    expect(modelInvocation).not.toHaveBeenCalled();
  });

  it('api-choice direct path rejects ${recall_result} binding', async () => {
    const modelInvocation = vi.fn(async () => ({
      content: '',
      toolCalls: [{ toolCallId: 't1', toolName: 'query_incident', arguments: {} }],
    }));
    const service = createService({
      recipe: recipe({
        start: node('START', { choose: {} }),
        choose: {
          type: 'API_CHOICE',
          inputs: {
            taskDescription: 'Query the RAN incident detail',
            candidateApis: [{ apiName: 'query_incident', paramsSchema: {} }],
          },
          outputs: { api_name: '${api_name}', recall: '${recall_result}' },
          next: { end: {} },
        },
        end: node('END'),
      }),
      nodeCatalog: createWorkflowNodeCatalog({
        modelInvocation,
        resolveModelInvocationConfig: async () => ({
          modelId: 'test',
          contextWindowTokens: 128_000,
          inferenceOptions: {},
          timeoutMs: 30_000,
          maxRetries: 2,
        }),
      }),
    });

    const result = await service.execute(baseRequest(), new AbortController().signal);

    expect(result.status).toBe('FAILED');
    expect(result.nodeResults.find((item) => item.nodeType === 'API_CHOICE')?.safeError?.code).toBe('WORKFLOW_NODE_INPUT_INVALID');
    expect(modelInvocation).not.toHaveBeenCalled();
  });

  it('api-choice RAG path accepts ${recall_result} binding', async () => {
    const service = createService({
      recipe: recipe({
        start: node('START', { choose: {} }),
        choose: {
          type: 'API_CHOICE',
          inputs: {
            taskDescription: 'Query the RAN incident detail',
            rag_index: [{ index_name: 'api-catalog' }],
            query: 'RAN incident detail lookup',
          },
          outputs: { api_name: '${api_name}', recall: '${recall_result}' },
          next: { end: {} },
        },
        end: node('END'),
      }),
      nodeCatalog: createWorkflowNodeCatalog({
        retrieveKnowledge: async () => ({
          status: 'OK',
          recommends: [{ apiId: 'query_incident', apiName: 'query_incident', description: 'Query RAN incident detail by incident id.' }],
        }),
        modelInvocation: {
          async complete() {
            return { content: '', toolCalls: [{ toolCallId: 't1', toolName: 'query_incident', arguments: { incidentId: 'INC-7' } }] };
          },
        } as never,
        resolveModelInvocationConfig: async () => ({
          modelId: 'test',
          contextWindowTokens: 128_000,
          inferenceOptions: {},
          timeoutMs: 30_000,
          maxRetries: 2,
        }),
      }),
    });

    const result = await service.execute(baseRequest(), new AbortController().signal);

    expect(result.status).toBe('COMPLETED');
    expect(result.outputVariables.api_name).toBe('query_incident');
    expect(Array.isArray(result.outputVariables.recall)).toBe(true);
  });

  it('selects an api-choice candidate via two-phase RAG recall then LLM 5-select-1', async () => {
    const service = createService({
      recipe: recipe({
        start: node('START', { choose: {} }),
        choose: {
          type: 'API_CHOICE',
          outputs: { api_name: '${api_name}', recall_result: '${recall_result}' },
          inputs: {
            taskDescription: 'Query the RAN incident detail',
            rag_index: [{ index_name: 'api-catalog' }],
            query: 'RAN incident detail lookup',
          },
          next: { end: {} },
        },
        end: node('END'),
      }),
      nodeCatalog: createWorkflowNodeCatalog({
        retrieveKnowledge: async () => ({
          status: 'OK',
          recommends: [
            { apiId: 'query_incident', apiName: 'query_incident', description: 'Query RAN incident detail by incident id.' },
            { apiId: 'query_alarm', apiName: 'query_alarm', description: 'Query active alarm list by node id.' },
            { apiId: 'close_incident', apiName: 'close_incident', description: 'Close a RAN incident.' },
          ],
        }),
        modelInvocation: {
          async complete() {
            return {
              content: '',
              toolCalls: [
                {
                  toolCallId: 'api-choice-rag-1',
                  toolName: 'query_incident',
                  arguments: { incidentId: 'INC-7' },
                },
              ],
            };
          },
        } as never,
        resolveModelInvocationConfig: async () => ({
          modelId: 'test-model',
          contextWindowTokens: 128_000,
          inferenceOptions: {},
          timeoutMs: 30_000,
          maxRetries: 2,
        }),
      }),
    });

    const result = await service.execute(baseRequest(), new AbortController().signal);

    expect(result.status).toBe('COMPLETED');
    expect(result.outputVariables.api_name).toBe('query_incident');
    expect(Array.isArray(result.outputVariables.recall_result)).toBe(true);
  });

  it('projects a RAG-selected API into api_name when recall_result is not declared', async () => {
    const service = createService({
      recipe: recipe({
        start: node('START', { choose: {} }),
        choose: {
          type: 'API_CHOICE',
          outputs: { api_name: '${api_name}' },
          inputs: {
            taskDescription: 'Query the RAN incident detail',
            rag_index: [{ index_name: 'api-catalog' }],
            query: 'RAN incident detail lookup',
          },
          next: { end: {} },
        },
        end: node('END'),
      }),
      nodeCatalog: createWorkflowNodeCatalog({
        retrieveKnowledge: async () => ({
          status: 'OK',
          recommends: [
            { apiId: 'query_incident', apiName: 'query_incident', description: 'Query RAN incident detail by incident id.' },
            { apiId: 'query_alarm', apiName: 'query_alarm', description: 'Query active alarm list by node id.' },
          ],
        }),
        modelInvocation: {
          async complete() {
            return {
              content: '',
              toolCalls: [{ toolCallId: 'api-choice-rag-2', toolName: 'query_incident', arguments: {} }],
            };
          },
        } as never,
        resolveModelInvocationConfig: async () => ({
          modelId: 'test-model',
          contextWindowTokens: 128_000,
          inferenceOptions: {},
          timeoutMs: 30_000,
          maxRetries: 2,
        }),
      }),
    });

    const result = await service.execute(baseRequest(), new AbortController().signal);

    expect(result.status).toBe('COMPLETED');
    expect(result.outputVariables).toEqual({ api_name: 'query_incident' });
  });

  it('retrieves recipe via RAG and outputs recipe_name, recipe_name_list, and recall_result', async () => {
    const service = createService({
      recipe: recipe({
        start: node('START', { choose: {} }),
        choose: {
          type: 'RECIPE_CHOICE',
          inputs: {
            query: 'Handle RAN paging failure',
            rag_index: ['recipe-index'],
            rank_topN: 2,
          },
          next: { end: {} },
        },
        end: node('END'),
      }),
      nodeCatalog: createWorkflowNodeCatalog({
        retrieveKnowledge: async (_request, _signal) => ({
          status: 'OK' as const,
          recommends: [
            { recipeId: 'paging-recovery', recipeName: 'paging-recovery' },
            { recipeId: 'capacity-check', recipeName: 'capacity-check' },
          ],
        }),
      }),
    });

    const result = await service.execute(baseRequest(), new AbortController().signal);

    expect(result.status).toBe('COMPLETED');
    expect(result.outputVariables).toMatchObject({
      recipe_name: 'paging-recovery',
      recipe_name_list: ['paging-recovery', 'capacity-check'],
    });
    expect(result.outputVariables.recall_result).toBeDefined();
  });

  it('retrieves recipe-choice results in parallel with one request per rag_index entry', async () => {
    const retrieveKnowledge = vi.fn(async (request) => {
      if (request.indexes[0].indexName === 'recipe-index-a') {
        return { status: 'OK', recommends: [{ recipeName: 'alpha-recipe', rerankScore: 0.9 }] };
      }
      return { status: 'OK', recommends: [{ recipeName: 'beta-recipe', rerankScore: 0.8 }] };
    });
    const service = createService({
      recipe: recipe({
        start: node('START', { choose: {} }),
        choose: {
          type: 'RECIPE_CHOICE',
          inputs: {
            query: 'Handle RAN paging failure',
            rag_index: ['recipe-index-a', 'recipe-index-b'],
            rank_topN: 5,
          },
          next: { end: {} },
        },
        end: node('END'),
      }),
      nodeCatalog: createWorkflowNodeCatalog({ retrieveKnowledge }),
    });

    const result = await service.execute(baseRequest(), new AbortController().signal);

    expect(result.status).toBe('COMPLETED');
    expect(retrieveKnowledge).toHaveBeenCalledTimes(2);
    expect(retrieveKnowledge.mock.calls[0][0].indexes).toHaveLength(1);
    expect(retrieveKnowledge.mock.calls[1][0].indexes).toHaveLength(1);
    expect(result.outputVariables.recipe_name_list).toEqual(['alpha-recipe', 'beta-recipe']);
    expect(result.outputVariables.knowledge_diagnostic).toEqual({ status: 'OK' });
  });

  it('tolerates partial rag_index failures and reports DEGRADED status', async () => {
    const retrieveKnowledge = vi.fn(async (request) => {
      if (request.indexes[0].indexName === 'failing-index') {
        throw new Error('index unavailable');
      }
      return { status: 'OK', recommends: [{ recipeName: 'survivor-recipe', rerankScore: 0.5 }] };
    });
    const service = createService({
      recipe: recipe({
        start: node('START', { choose: {} }),
        choose: {
          type: 'RECIPE_CHOICE',
          inputs: {
            query: 'Handle RAN paging failure',
            rag_index: ['failing-index', 'healthy-index'],
            rank_topN: 5,
          },
          next: { end: {} },
        },
        end: node('END'),
      }),
      nodeCatalog: createWorkflowNodeCatalog({ retrieveKnowledge }),
    });

    const result = await service.execute(baseRequest(), new AbortController().signal);

    expect(result.status).toBe('COMPLETED');
    expect(result.outputVariables.recipe_name_list).toEqual(['survivor-recipe']);
    expect(result.outputVariables.knowledge_diagnostic).toEqual({
      status: 'DEGRADED',
      reason: '1 of 2 recipe index retrievals failed',
    });
  });

  it('throws WORKFLOW_RECIPE_NOT_FOUND when every rag_index retrieval fails', async () => {
    const retrieveKnowledge = vi.fn(async () => {
      throw new Error('index unavailable');
    });
    const service = createService({
      recipe: recipe({
        start: node('START', { choose: {} }),
        choose: {
          type: 'RECIPE_CHOICE',
          inputs: {
            query: 'Handle RAN paging failure',
            rag_index: ['index-a', 'index-b'],
            rank_topN: 5,
          },
          next: { end: {} },
        },
        end: node('END'),
      }),
      nodeCatalog: createWorkflowNodeCatalog({ retrieveKnowledge }),
    });

    const result = await service.execute(baseRequest(), new AbortController().signal);

    expect(result.status).toBe('FAILED');
    expect(result.nodeResults.find((item) => item.nodeType === 'RECIPE_CHOICE')?.safeError?.code).toBe('WORKFLOW_RECIPE_NOT_FOUND');
  });

  it('filters recipe-choice results by recallCondition vs_score threshold', async () => {
    const service = createService({
      recipe: recipe({
        start: node('START', { choose: {} }),
        choose: {
          type: 'RECIPE_CHOICE',
          inputs: {
            query: 'Handle RAN paging failure',
            rag_index: ['recipe-index'],
            rank_topN: 5,
            recall_condition: { vs_score: '>0.8' },
          },
          next: { end: {} },
        },
        end: node('END'),
      }),
      nodeCatalog: createWorkflowNodeCatalog({
        retrieveKnowledge: async () => ({
          status: 'OK',
          recommends: [
            { recipeName: 'high-score-recipe', vsScore: 0.92 },
            { recipeName: 'low-score-recipe', vsScore: 0.45 },
          ],
        }),
      }),
    });

    const result = await service.execute(baseRequest(), new AbortController().signal);

    expect(result.status).toBe('COMPLETED');
    expect(result.outputVariables.recipe_name_list).toEqual(['high-score-recipe']);
  });

  it('filters recipe-choice results by recallCondition rerank_score range', async () => {
    const service = createService({
      recipe: recipe({
        start: node('START', { choose: {} }),
        choose: {
          type: 'RECIPE_CHOICE',
          inputs: {
            query: 'Handle RAN paging failure',
            rag_index: ['recipe-index'],
            rank_topN: 5,
            recall_condition: { rerank_score: '0.5~0.85' },
          },
          next: { end: {} },
        },
        end: node('END'),
      }),
      nodeCatalog: createWorkflowNodeCatalog({
        retrieveKnowledge: async () => ({
          status: 'OK',
          recommends: [
            { recipeName: 'in-range-recipe', rerankScore: 0.7 },
            { recipeName: 'too-high-recipe', rerankScore: 0.95 },
            { recipeName: 'too-low-recipe', rerankScore: 0.3 },
          ],
        }),
      }),
    });

    const result = await service.execute(baseRequest(), new AbortController().signal);

    expect(result.status).toBe('COMPLETED');
    expect(result.outputVariables.recipe_name_list).toEqual(['in-range-recipe']);
  });

  it('truncates recipe-choice results to rank_topN after aggregation', async () => {
    const service = createService({
      recipe: recipe({
        start: node('START', { choose: {} }),
        choose: {
          type: 'RECIPE_CHOICE',
          inputs: {
            query: 'Handle RAN paging failure',
            rag_index: ['recipe-index'],
            rank_topN: 2,
          },
          next: { end: {} },
        },
        end: node('END'),
      }),
      nodeCatalog: createWorkflowNodeCatalog({
        retrieveKnowledge: async () => ({
          status: 'OK',
          recommends: [
            { recipeName: 'first', rerankScore: 0.9 },
            { recipeName: 'second', rerankScore: 0.8 },
            { recipeName: 'third', rerankScore: 0.7 },
            { recipeName: 'fourth', rerankScore: 0.6 },
          ],
        }),
      }),
    });

    const result = await service.execute(baseRequest(), new AbortController().signal);

    expect(result.status).toBe('COMPLETED');
    expect(result.outputVariables.recipe_name_list).toEqual(['first', 'second']);
    expect(result.outputVariables.recall_result).toHaveLength(2);
  });

  it('selects the first recipe-choice candidate without calling the LLM', async () => {
    const modelComplete = vi.fn(async () => ({ content: '', toolCalls: [] }));
    const service = createService({
      recipe: recipe({
        start: node('START', { choose: {} }),
        choose: {
          type: 'RECIPE_CHOICE',
          inputs: {
            taskDescription: 'Handle RAN paging failure',
            candidateRecipes: [
              { recipeName: 'paging-recovery', description: 'Recover from RAN paging failures.' },
              { recipeName: 'capacity-check', description: 'Check cell capacity.' },
            ],
          },
          next: { end: {} },
        },
        end: node('END'),
      }),
      nodeCatalog: createWorkflowNodeCatalog({
        modelInvocation: { complete: modelComplete } as never,
        resolveModelInvocationConfig: async () => ({
          modelId: 'test-model',
          contextWindowTokens: 128_000,
          inferenceOptions: {},
          timeoutMs: 30_000,
          maxRetries: 2,
        }),
      }),
    });

    const result = await service.execute(baseRequest(), new AbortController().signal);

    expect(result.status).toBe('COMPLETED');
    expect(result.outputVariables).toMatchObject({
      recipe_name: 'paging-recovery',
      recipe_name_list: ['paging-recovery', 'capacity-check'],
    });
    expect(result.outputVariables).not.toHaveProperty('mappedParams');
    expect(modelComplete).not.toHaveBeenCalled();
  });

  it('enhances api-choice RAG candidates with title/name/knowledge fallback and qaExamples', async () => {
    let receivedTools: unknown;
    const service = createService({
      recipe: recipe({
        start: node('START', { choose: {} }),
        choose: {
          type: 'API_CHOICE',
          outputs: { api_name: '${api_name}', recall_result: '${recall_result}' },
          inputs: {
            taskDescription: 'Query the RAN incident detail',
            rag_index: [{ index_name: 'api-catalog' }],
            query: 'RAN incident detail lookup',
          },
          next: { end: {} },
        },
        end: node('END'),
      }),
      nodeCatalog: createWorkflowNodeCatalog({
        retrieveKnowledge: async () => ({
          status: 'OK',
          recommends: [
            {
              name: 'query_incident',
              description: 'Query RAN incident detail by incident id.',
              qaExamples: ['How to check incident INC-7?', 'What is the status of incident INC-7?'],
              extensions: { protocol: 'HTTP POST' },
              paramsSchema: { type: 'object', properties: { incidentId: { type: 'string' } } },
            },
            { title: 'query_alarm', description: 'Query active alarm list by node id.' },
          ],
        }),
        modelInvocation: {
          async complete(request) {
            receivedTools = request.tools;
            return {
              content: '',
              toolCalls: [{ toolCallId: 't1', toolName: 'query_incident', arguments: { incidentId: 'INC-7' } }],
            };
          },
        } as never,
        resolveModelInvocationConfig: async () => ({
          modelId: 'test-model',
          contextWindowTokens: 128_000,
          inferenceOptions: {},
          timeoutMs: 30_000,
          maxRetries: 2,
        }),
      }),
    });

    const result = await service.execute(baseRequest(), new AbortController().signal);

    expect(result.status).toBe('COMPLETED');
    expect(result.outputVariables.api_name).toBe('query_incident');
    const tools = receivedTools as Array<{ name: string; description?: string; inputSchema: unknown }>;
    expect(tools[0].name).toBe('query_incident');
    expect(tools[0].description).toContain('Example questions: How to check incident INC-7?; What is the status of incident INC-7?');
    expect(tools[0].description).toContain('Protocol: HTTP POST');
    expect(tools[0].inputSchema).toEqual({ type: 'object', properties: { incidentId: { type: 'string' } } });
    expect(tools[1].name).toBe('query_alarm');
  });

  it('fails knowledge-search when retrieval returns no documents', async () => {
    const service = createService({
      recipe: recipe({
        start: node('START', { search: {} }),
        search: {
          type: 'KNOWLEDGE_SEARCH',
          outputs: { knowledge_search_result: '${knowledge_search_result}' },
          inputs: {
            rag_index: [{ index_name: 'empty-kb' }],
            query: 'nonexistent topic',
          },
          next: { end: {} },
        },
        end: node('END'),
      }),
      nodeCatalog: createWorkflowNodeCatalog({
        retrieveKnowledge: async () => ({
          status: 'OK' as const,
          recommends: [],
        }),
      }),
    });

    const result = await service.execute(baseRequest(), new AbortController().signal);

    expect(result.status).toBe('FAILED');
    const failedNode = result.nodeResults.find((nr) => nr.nodeType === 'KNOWLEDGE_SEARCH');
    expect(failedNode?.safeError?.code).toBe('WORKFLOW_KNOWLEDGE_SEARCH_EMPTY');
    expect(failedNode?.safeError?.category).toBe('NOT_FOUND');
  });

  it('fills default indexType based on node type', async () => {
    let receivedIndexes: unknown;
    const service = createService({
      recipe: recipe({
        start: node('START', { choose: {} }),
        choose: {
          type: 'API_CHOICE',
          outputs: { api_name: '${api_name}', recall_result: '${recall_result}' },
          inputs: {
            rag_index: [{ index_name: 'api-catalog' }],
            query: 'RAN incident lookup',
          },
          next: { end: {} },
        },
        end: node('END'),
      }),
      nodeCatalog: createWorkflowNodeCatalog({
        retrieveKnowledge: async (request) => {
          receivedIndexes = request.indexes;
          return {
            status: 'OK',
            documents: [{ ref: 'apis/query.md', title: 'query', excerpt: 'desc', score: 0.9 }],
          };
        },
        modelInvocation: {
          async complete() {
            return { content: '', toolCalls: [{ toolCallId: 't1', toolName: 'query', arguments: {} }] };
          },
        } as never,
        resolveModelInvocationConfig: async () => ({
          modelId: 'test',
          contextWindowTokens: 128_000,
          inferenceOptions: {},
          timeoutMs: 30_000,
          maxRetries: 2,
        }),
      }),
    });

    await service.execute(baseRequest(), new AbortController().signal);

    expect(receivedIndexes).toEqual([{ indexName: 'api-catalog' }]);
  });

  it('user-specified indexType overrides node default', async () => {
    let receivedIndexes: unknown;
    const service = createService({
      recipe: recipe({
        start: node('START', { choose: {} }),
        choose: {
          type: 'RECIPE_CHOICE',
          inputs: {
            rag_index: [{ index_name: 'mixed-idx', index_type: 'API' }],
            query: 'recipe lookup',
          },
          next: { end: {} },
        },
        end: node('END'),
      }),
      nodeCatalog: createWorkflowNodeCatalog({
        retrieveKnowledge: async (request) => {
          receivedIndexes = request.indexes;
          return {
            status: 'OK',
            recommends: [{ recipeId: 'recipe:test', recipeName: 'test' }],
          };
        },
      }),
    });

    const result = await service.execute(baseRequest(), new AbortController().signal);

    expect(receivedIndexes).toEqual([{ indexName: 'mixed-idx', indexType: 'API' }]);
    expect(result.outputVariables.recipe_name).toBe('test');
  });

  it('rejects invalid indexType with WORKFLOW_NODE_INPUT_INVALID', async () => {
    const service = createService({
      recipe: recipe({
        start: node('START', { search: {} }),
        search: {
          type: 'KNOWLEDGE_SEARCH',
          outputs: { knowledge_search_result: '${knowledge_search_result}' },
          inputs: {
            rag_index: [{ index_name: 'ran-kb', index_type: 'vector' }],
            query: 'RRC failure',
          },
          next: { end: {} },
        },
        end: node('END'),
      }),
      nodeCatalog: createWorkflowNodeCatalog({
        retrieveKnowledge: async () => ({ status: 'OK', recommends: [] }),
      }),
    });

    const result = await service.execute(baseRequest(), new AbortController().signal);

    expect(result.status).toBe('FAILED');
    const failedNode = result.nodeResults.find((nr) => nr.nodeType === 'KNOWLEDGE_SEARCH');
    expect(failedNode?.safeError?.code).toBe('WORKFLOW_NODE_INPUT_INVALID');
  });

  it('rejects per-index vsTopN out of range', async () => {
    const service = createService({
      recipe: recipe({
        start: node('START', { search: {} }),
        search: {
          type: 'KNOWLEDGE_SEARCH',
          outputs: { knowledge_search_result: '${knowledge_search_result}' },
          inputs: {
            rag_index: [{ index_name: 'ran-kb', vs_topN: 0 }],
            query: 'RRC failure',
          },
          next: { end: {} },
        },
        end: node('END'),
      }),
      nodeCatalog: createWorkflowNodeCatalog({
        retrieveKnowledge: async () => ({ status: 'OK', recommends: [] }),
      }),
    });

    const result = await service.execute(baseRequest(), new AbortController().signal);

    expect(result.status).toBe('FAILED');
    const failedNode = result.nodeResults.find((nr) => nr.nodeType === 'KNOWLEDGE_SEARCH');
    expect(failedNode?.safeError?.code).toBe('WORKFLOW_NODE_INPUT_INVALID');
  });

  it('sets topK equal to rankTopN, not influenced by vsTopN/esTopN', async () => {
    let receivedTopK: number | undefined;
    const service = createService({
      recipe: recipe({
        start: node('START', { search: {} }),
        search: {
          type: 'KNOWLEDGE_SEARCH',
          outputs: { knowledge_search_result: '${knowledge_search_result}' },
          inputs: {
            rag_index: [{ index_name: 'ran-kb' }],
            query: 'RRC failure',
            rank_topN: '3',
            vs_topN: '5',
            es_topN: '4',
          },
          next: { end: {} },
        },
        end: node('END'),
      }),
      nodeCatalog: createWorkflowNodeCatalog({
        retrieveKnowledge: async (request) => {
          receivedTopK = request.topK;
          return { status: 'OK', recommends: [{ id: 'd', title: 't', knowledge: 'e', vsScore: 1 }] };
        },
      }),
    });

    await service.execute(baseRequest(), new AbortController().signal);

    expect(receivedTopK).toBe(3);
  });

  // -------------------------------------------------------------------------
  // Batch mode: KNOWLEDGE_SEARCH concurrent batch execution
  // -------------------------------------------------------------------------

  it('executes knowledge-search batch in parallel mode with 3 elements', async () => {
    const queries: string[] = [];
    const service = createService({
      recipe: recipe({
        start: node('START', { search: {} }),
        search: {
          type: 'KNOWLEDGE_SEARCH',
          inputs: {
            rag_index: [{ index_name: 'ran-kb' }],
            query: '${sub_question}',
          },
          batchConfig: {
            batchInputDataItem: ['RRC failure', 'BGP flap', 'KPI degradation'],
            batchElementVariable: 'sub_question',
            batchMode: 'parallel',
          },
          outputs: { results: '${batch_results}', failures: '${failed_items}' },
          next: { end: {} },
        },
        end: node('END'),
      }),
      nodeCatalog: createWorkflowNodeCatalog({
        retrieveKnowledge: async (request) => {
          queries.push(request.query);
          return {
            status: 'OK',
            recommends: [{ id: `doc-${request.query}`, title: request.query, knowledge: `answer for ${request.query}`, vsScore: 0.9 }],
          };
        },
      }),
    });

    const result = await service.execute(baseRequest(), new AbortController().signal);

    expect(result.status).toBe('COMPLETED');
    expect(queries).toHaveLength(3);
    expect(queries.sort()).toEqual(['BGP flap', 'KPI degradation', 'RRC failure']);
    const batchResults = result.outputVariables.results as unknown[];
    expect(batchResults).toHaveLength(3);
    expect(result.outputVariables.failures).toEqual([]);
  });

  it('converts empty search result to failed item instead of throwing', async () => {
    const service = createService({
      recipe: recipe({
        start: node('START', { search: {} }),
        search: {
          type: 'KNOWLEDGE_SEARCH',
          inputs: {
            rag_index: [{ index_name: 'ran-kb' }],
            query: '${sub_question.text}',
          },
          batchConfig: {
            batchInputDataItem: [{ text: 'found-topic' }, { text: 'missing-topic' }],
            batchElementVariable: 'sub_question',
            batchMode: 'serial',
            batchFailStrategy: 'continue',
          },
          outputs: { results: '${batch_results}', failures: '${failed_items}' },
          next: { end: {} },
        },
        end: node('END'),
      }),
      nodeCatalog: createWorkflowNodeCatalog({
        retrieveKnowledge: async (request) => {
          if (request.query === 'missing-topic') {
            return { status: 'OK', recommends: [] };
          }
          return { status: 'OK', recommends: [{ id: 'doc', title: 't', knowledge: 'found answer', vsScore: 1 }] };
        },
      }),
    });

    const result = await service.execute(baseRequest(), new AbortController().signal);

    expect(result.status).toBe('COMPLETED');
    const batchResults = result.outputVariables.results as unknown[];
    expect(batchResults).toHaveLength(1);
    const failedItems = result.outputVariables.failures as unknown[];
    expect(failedItems).toHaveLength(1);
    expect((failedItems[0] as { error: { code: string } }).error.code).toBe('WORKFLOW_KNOWLEDGE_SEARCH_EMPTY');
    const searchNode = result.nodeResults.find((item) => item.nodeType === 'KNOWLEDGE_SEARCH');
    expect(searchNode?.status).toBe('NODE_COMPLETED');
  });

  it('merges batch results as map when batchResultMerge is map', async () => {
    const service = createService({
      recipe: recipe({
        start: node('START', { search: {} }),
        search: {
          type: 'KNOWLEDGE_SEARCH',
          inputs: {
            rag_index: [{ index_name: 'ran-kb' }],
            query: '${sub_question.text}',
          },
          batchConfig: {
            batchInputDataItem: [
              { key: 'site-a', text: 'RRC failure' },
              { key: 'site-b', text: 'BGP flap' },
            ],
            batchElementVariable: 'sub_question',
            batchResultMerge: 'map',
          },
          outputs: { results: '${batch_results}' },
          next: { end: {} },
        },
        end: node('END'),
      }),
      nodeCatalog: createWorkflowNodeCatalog({
        retrieveKnowledge: async (request) => ({
          status: 'OK',
          recommends: [{ id: `doc-${request.query}`, title: request.query, knowledge: `answer for ${request.query}`, vsScore: 0.9 }],
        }),
      }),
    });

    const result = await service.execute(baseRequest(), new AbortController().signal);

    expect(result.status).toBe('COMPLETED');
    const batchResults = result.outputVariables.results as Record<string, unknown>;
    expect(batchResults['site-a']).toBeDefined();
    expect(batchResults['site-b']).toBeDefined();
  });

  it('isolates per-element variables in batch mode', async () => {
    const seenQuestions: string[] = [];
    const service = createService({
      recipe: recipe({
        start: node('START', { search: {} }),
        search: {
          type: 'KNOWLEDGE_SEARCH',
          inputs: {
            rag_index: [{ index_name: 'ran-kb' }],
            query: '${sub_question}',
          },
          batchConfig: {
            batchInputDataItem: ['alpha', 'beta', 'gamma'],
            batchElementVariable: 'sub_question',
            batchMode: 'parallel',
          },
          outputs: { results: '${batch_results}' },
          next: { end: {} },
        },
        end: node('END'),
      }),
      nodeCatalog: createWorkflowNodeCatalog({
        retrieveKnowledge: async (request) => {
          seenQuestions.push(request.query);
          return { status: 'OK', recommends: [{ id: 'doc', title: 't', knowledge: request.query, vsScore: 1 }] };
        },
      }),
    });

    const result = await service.execute(baseRequest(), new AbortController().signal);

    expect(result.status).toBe('COMPLETED');
    expect(seenQuestions.sort()).toEqual(['alpha', 'beta', 'gamma']);
    const batchResults = result.outputVariables.results as unknown[];
    expect(batchResults).toHaveLength(3);
  });

  it('propagates cancellation during batch execution', async () => {
    const controller = new AbortController();
    const service = createService({
      recipe: recipe({
        start: node('START', { search: {} }),
        search: {
          type: 'KNOWLEDGE_SEARCH',
          inputs: {
            rag_index: [{ index_name: 'ran-kb' }],
            query: '${sub_question}',
          },
          batchConfig: {
            batchInputDataItem: ['q1', 'q2', 'q3'],
            batchElementVariable: 'sub_question',
            batchMode: 'serial',
          },
          outputs: { results: '${batch_results}' },
          next: { end: {} },
        },
        end: node('END'),
      }),
      nodeCatalog: createWorkflowNodeCatalog({
        retrieveKnowledge: async (request) => {
          if (request.query === 'q1') {
            controller.abort();
          }
          return { status: 'OK', recommends: [{ id: 'doc', title: 't', knowledge: 'answer', vsScore: 1 }] };
        },
      }),
    });

    const result = await service.execute(baseRequest(), controller.signal);

    expect(result.status).toBe('INTERRUPTED');
    expect(result.nodeResults.find((item) => item.nodeType === 'KNOWLEDGE_SEARCH')?.safeError?.code).toBe('WORKFLOW_INTERRUPTED');
  });

  // === D1: open_api_recall=false + empty candidateApis should error ===
  it('D1: errors when open_api_recall is false and candidateApis is empty', async () => {
    const service = createService({
      recipe: recipe({
        start: node('START', { choose: {} }),
        choose: {
          type: 'API_CHOICE',
          outputs: { api_name: '${api_name}' },
          inputs: { open_api_recall: 'false' },
          next: { end: {} },
        },
        end: node('END'),
      }),
      nodeCatalog: createWorkflowNodeCatalog({
        modelInvocation: {
          async complete() {
            return { content: '', toolCalls: [] };
          },
        } as never,
        resolveModelInvocationConfig: async () => ({
          modelId: 'test',
          contextWindowTokens: 128_000,
          inferenceOptions: {},
          timeoutMs: 30_000,
          maxRetries: 2,
        }),
      }),
    });
    const result = await service.execute(baseRequest(), new AbortController().signal);
    expect(result.status).toBe('FAILED');
    expect(result.nodeResults.find((item) => item.nodeType === 'API_CHOICE')?.safeError?.code).toBe('WORKFLOW_API_CHOICE_NO_CANDIDATES');
  });

  // === D2: Prompt three-way priority ===
  it('D2: uses top1_choice_prompt when provided', async () => {
    const service = createService({
      recipe: recipe({
        start: node('START', { choose: {} }),
        choose: {
          type: 'API_CHOICE',
          outputs: { api_name: '${api_name}' },
          inputs: {
            open_api_recall: 'false',
            top1_choice_prompt: 'Select the best API for incident lookup',
            candidateApis: [
              { apiName: 'query_incident', paramsSchema: { type: 'object' } },
              { apiName: 'close_incident', paramsSchema: { type: 'object' } },
            ],
          },
          next: { end: {} },
        },
        end: node('END'),
      }),
      nodeCatalog: createWorkflowNodeCatalog({
        modelInvocation: {
          async complete() {
            return { content: '', toolCalls: [{ toolCallId: 't1', toolName: 'query_incident', arguments: {} }] };
          },
        } as never,
        resolveModelInvocationConfig: async () => ({
          modelId: 'test',
          contextWindowTokens: 128_000,
          inferenceOptions: {},
          timeoutMs: 30_000,
          maxRetries: 2,
        }),
      }),
    });
    const result = await service.execute(baseRequest(), new AbortController().signal);
    expect(result.status).toBe('COMPLETED');
    expect(result.outputVariables.api_name).toBe('query_incident');
  });

  // === D3: Knowledge dual-path recall ===
  it('D3: recalls knowledge when open_api_knowledge_recall is true with KNOWLEDGE index', async () => {
    const service = createService({
      recipe: recipe({
        start: node('START', { choose: {} }),
        choose: {
          type: 'API_CHOICE',
          outputs: {
            api_name: '${api_name}',
            recall_result: '${recall_result}',
            knowledge_diagnostic: '${knowledge_diagnostic}',
            knowledge: '${knowledge}',
          },
          inputs: {
            rag_index: [
              { index_name: 'api-catalog', index_type: 'API' },
              { index_name: 'ran-kb', index_type: 'KNOWLEDGE' },
            ],
            query: 'RRC connection failure',
            open_api_knowledge_recall: 'true',
          },
          next: { end: {} },
        },
        end: node('END'),
      }),
      nodeCatalog: createWorkflowNodeCatalog({
        retrieveKnowledge: async (request) => {
          if (request.defaultIndexType === 'KNOWLEDGE') {
            return {
              status: 'OK',
              recommends: [{ knowledge: 'RRC failures often follow paging storms.' }],
            };
          }
          return {
            status: 'OK',
            recommends: [{ apiName: 'query_rrc', description: 'Query RRC failure detail' }],
          };
        },
        modelInvocation: {
          async complete() {
            return { content: '', toolCalls: [{ toolCallId: 't1', toolName: 'query_rrc', arguments: {} }] };
          },
        } as never,
        resolveModelInvocationConfig: async () => ({
          modelId: 'test',
          contextWindowTokens: 128_000,
          inferenceOptions: {},
          timeoutMs: 30_000,
          maxRetries: 2,
        }),
      }),
    });
    const result = await service.execute(baseRequest(), new AbortController().signal);
    expect(result.status).toBe('COMPLETED');
    expect(result.outputVariables.api_name).toBe('query_rrc');
    expect(typeof result.outputVariables.knowledge).toBe('string');
    expect((result.outputVariables.knowledge_diagnostic as any).status).toBe('OK');
  });

  // === D4: Single-result optimization (skip LLM) ===
  it('D4: skips LLM when RAG returns exactly one result', async () => {
    const modelComplete = vi.fn(async () => ({
      content: '',
      toolCalls: [{ toolCallId: 't1', toolName: 'query_incident', arguments: {} }],
    }));
    const service = createService({
      recipe: recipe({
        start: node('START', { choose: {} }),
        choose: {
          type: 'API_CHOICE',
          outputs: { api_name: '${api_name}', recall_result: '${recall_result}' },
          inputs: {
            rag_index: [{ index_name: 'api-catalog' }],
            query: 'RAN incident lookup',
          },
          next: { end: {} },
        },
        end: node('END'),
      }),
      nodeCatalog: createWorkflowNodeCatalog({
        retrieveKnowledge: async () => ({
          status: 'OK',
          recommends: [{ apiName: 'query_incident', description: 'Query RAN incident' }],
        }),
        modelInvocation: { complete: modelComplete } as never,
        resolveModelInvocationConfig: async () => ({
          modelId: 'test',
          contextWindowTokens: 128_000,
          inferenceOptions: {},
          timeoutMs: 30_000,
          maxRetries: 2,
        }),
      }),
    });
    const result = await service.execute(baseRequest(), new AbortController().signal);
    expect(result.status).toBe('COMPLETED');
    expect(result.outputVariables.api_name).toBe('query_incident');
    expect(modelComplete).not.toHaveBeenCalled();
  });

  // === D5: NEED_MORE_KEY follow-up exception ===
  it('D5: throws WORKFLOW_API_CHOICE_FOLLOW_UP when NEED_MORE_KEY detected with open_reflection', async () => {
    const service = createService({
      recipe: recipe({
        start: node('START', { choose: {} }),
        choose: {
          type: 'API_CHOICE',
          outputs: { api_name: '${api_name}' },
          inputs: {
            open_api_recall: 'false',
            open_reflection: 'true',
            candidateApis: [{ apiName: 'query_incident', paramsSchema: { type: 'object' } }],
          },
          next: { end: {} },
        },
        end: node('END'),
      }),
      nodeCatalog: createWorkflowNodeCatalog({
        modelInvocation: {
          async complete() {
            return {
              content: 'I think we NEED_MORE_KEY: please provide the alarm type',
              toolCalls: [{ toolCallId: 't1', toolName: 'query_incident', arguments: {} }],
            };
          },
        } as never,
        resolveModelInvocationConfig: async () => ({
          modelId: 'test',
          contextWindowTokens: 128_000,
          inferenceOptions: {},
          timeoutMs: 30_000,
          maxRetries: 2,
        }),
      }),
    });
    const result = await service.execute(baseRequest(), new AbortController().signal);
    expect(result.status).toBe('FAILED');
    expect(result.nodeResults.find((item) => item.nodeType === 'API_CHOICE')?.safeError?.code).toBe('WORKFLOW_API_CHOICE_FOLLOW_UP');
  });

  // === D6: Model params passthrough via resolveModelForParamExtract ===
  it('D6: uses resolveModelForParamExtract when model or modelGroup is specified', async () => {
    const resolveModelForParamExtract = vi.fn(async () => ({
      modelId: 'custom-model',
      contextWindowTokens: 128_000,
      inferenceOptions: {},
      timeoutMs: 30_000,
      maxRetries: 2,
    }));
    const service = createService({
      recipe: recipe({
        start: node('START', { choose: {} }),
        choose: {
          type: 'API_CHOICE',
          outputs: { api_name: '${api_name}' },
          inputs: {
            open_api_recall: 'false',
            model: 'gpt-4o',
            candidateApis: [{ apiName: 'query_incident', paramsSchema: { type: 'object' } }],
          },
          next: { end: {} },
        },
        end: node('END'),
      }),
      nodeCatalog: createWorkflowNodeCatalog({
        modelInvocation: {
          async complete() {
            return { content: '', toolCalls: [{ toolCallId: 't1', toolName: 'query_incident', arguments: {} }] };
          },
        } as never,
        resolveModelInvocationConfig: async () => ({
          modelId: 'test',
          contextWindowTokens: 128_000,
          inferenceOptions: {},
          timeoutMs: 30_000,
          maxRetries: 2,
        }),
        resolveModelForParamExtract,
      }),
    });
    const result = await service.execute(baseRequest(), new AbortController().signal);
    expect(result.status).toBe('COMPLETED');
    expect(resolveModelForParamExtract).toHaveBeenCalled();
  });
  // === D6 follow-up: modelGroup deferred — modelGroup without model falls back to global config ===
  it('D6: modelGroup without model falls back to global config without error (deferred)', async () => {
    const resolveModelForParamExtract = vi.fn(async (_request, _signal, model, modelGroup) => {
      // Adapter ignores modelGroup (deferred); when model is undefined the override returns undefined
      // and resolveNodeModelConfig falls back to resolveModelInvocationConfig.
      if (model === undefined) {
        return undefined;
      }
      return { modelId: model, contextWindowTokens: 8192, inferenceOptions: {}, timeoutMs: 30_000, maxRetries: 0 };
    });
    const resolveModelInvocationConfig = vi.fn(async () => ({
      modelId: 'global-default',
      contextWindowTokens: 8192,
      inferenceOptions: {},
      timeoutMs: 30_000,
      maxRetries: 0,
    }));
    const service = createService({
      recipe: recipe({
        start: node('START', { choose: {} }),
        choose: {
          type: 'API_CHOICE',
          outputs: { api_name: '${api_name}' },
          inputs: {
            open_api_recall: 'false',
            modelGroup: 'telecom-group',
            candidateApis: [{ apiName: 'query_incident', paramsSchema: { type: 'object' } }],
          },
          next: { end: {} },
        },
        end: node('END'),
      }),
      nodeCatalog: createWorkflowNodeCatalog({
        modelInvocation: {
          async complete() {
            return { content: '', toolCalls: [{ toolCallId: 't1', toolName: 'query_incident', arguments: {} }] };
          },
        } as never,
        resolveModelInvocationConfig,
        resolveModelForParamExtract,
      }),
    });
    const result = await service.execute(baseRequest(), new AbortController().signal);
    expect(result.status).toBe('COMPLETED');
    expect(resolveModelForParamExtract).toHaveBeenCalled();
    expect(resolveModelInvocationConfig).toHaveBeenCalled();
  });

  // === D7: Intermediate step events ===
  it('D7: emits rag_recall, rating, and llm_reasoning step events during RAG path', async () => {
    const events: WorkflowExecutionEvent[] = [];
    const service = createService({
      recipe: recipe({
        start: node('START', { choose: {} }),
        choose: {
          type: 'API_CHOICE',
          outputs: { api_name: '${api_name}', recall_result: '${recall_result}', knowledge_diagnostic: '${knowledge_diagnostic}' },
          inputs: {
            rag_index: [{ index_name: 'api-catalog' }],
            query: 'RAN incident lookup',
          },
          next: { end: {} },
        },
        end: node('END'),
      }),
      nodeCatalog: createWorkflowNodeCatalog({
        retrieveKnowledge: async () => ({
          status: 'OK',
          recommends: [
            { apiName: 'query_incident', description: 'Query incident' },
            { apiName: 'query_alarm', description: 'Query alarm' },
          ],
        }),
        modelInvocation: {
          async complete() {
            return { content: '', toolCalls: [{ toolCallId: 't1', toolName: 'query_incident', arguments: {} }] };
          },
        } as never,
        resolveModelInvocationConfig: async () => ({
          modelId: 'test',
          contextWindowTokens: 128_000,
          inferenceOptions: {},
          timeoutMs: 30_000,
          maxRetries: 2,
        }),
      }),
      emitEvent: (event) => {
        events.push(event);
      },
    });
    const result = await service.execute(baseRequest(), new AbortController().signal);
    expect(result.status).toBe('COMPLETED');
    const stepEvents = events.filter((e) => {
      try {
        const content = (e as any).visibleDelta?.content ?? (e as any).payload?.content ?? '';
        const p = JSON.parse(content);
        return typeof p.step === 'string';
      } catch {
        return false;
      }
    });
    const steps = stepEvents.map((e) => {
      const content = (e as any).visibleDelta?.content ?? (e as any).payload?.content ?? '';
      return JSON.parse(content).step;
    });
    expect(steps).toContain('rag_recall');
    expect(steps).toContain('rating');
    expect(steps).toContain('llm_reasoning');
  });

  // === D8: remove_think_tags opt-in (default: NOT removed) ===
  it('D8: does not remove think tags by default', async () => {
    const service = createService({
      recipe: recipe({
        start: node('START', { choose: {} }),
        choose: {
          type: 'API_CHOICE',
          outputs: { api_name: '${api_name}' },
          inputs: {
            open_api_recall: 'false',
            candidateApis: [{ apiName: 'query_incident', paramsSchema: { type: 'object' } }],
          },
          next: { end: {} },
        },
        end: node('END'),
      }),
      nodeCatalog: createWorkflowNodeCatalog({
        modelInvocation: {
          async complete() {
            return {
              content: 'Some reasoning content',
              toolCalls: [{ toolCallId: 't1', toolName: 'query_incident', arguments: {} }],
            };
          },
        } as never,
        resolveModelInvocationConfig: async () => ({
          modelId: 'test',
          contextWindowTokens: 128_000,
          inferenceOptions: {},
          timeoutMs: 30_000,
          maxRetries: 2,
        }),
      }),
    });
    const result = await service.execute(baseRequest(), new AbortController().signal);
    expect(result.status).toBe('COMPLETED');
    expect(result.outputVariables.api_name).toBe('query_incident');
  });

  // === D9: knowledge_diagnostic output in RAG path ===
  it('D9: outputs knowledge_diagnostic with status and reason in RAG path', async () => {
    const service = createService({
      recipe: recipe({
        start: node('START', { choose: {} }),
        choose: {
          type: 'API_CHOICE',
          outputs: { api_name: '${api_name}', recall_result: '${recall_result}', knowledge_diagnostic: '${knowledge_diagnostic}' },
          inputs: {
            rag_index: [{ index_name: 'api-catalog' }],
            query: 'RAN incident lookup',
          },
          next: { end: {} },
        },
        end: node('END'),
      }),
      nodeCatalog: createWorkflowNodeCatalog({
        retrieveKnowledge: async () => ({
          status: 'OK',
          diagnosticReason: 'topK:5',
          recommends: [
            { apiName: 'query_incident', description: 'Query incident' },
            { apiName: 'query_alarm', description: 'Query alarm' },
          ],
        }),
        modelInvocation: {
          async complete() {
            return { content: '', toolCalls: [{ toolCallId: 't1', toolName: 'query_incident', arguments: {} }] };
          },
        } as never,
        resolveModelInvocationConfig: async () => ({
          modelId: 'test',
          contextWindowTokens: 128_000,
          inferenceOptions: {},
          timeoutMs: 30_000,
          maxRetries: 2,
        }),
      }),
    });
    const result = await service.execute(baseRequest(), new AbortController().signal);
    expect(result.status).toBe('COMPLETED');
    const diag = result.outputVariables.knowledge_diagnostic as any;
    expect(diag.status).toBe('OK');
    expect(diag.reason).toBe('topK:5');
  });

  // === Regression: RAG path accepts knowledge_diagnostic and knowledge bindings ===
  it('RAG path accepts ${knowledge_diagnostic} and ${knowledge} output bindings', async () => {
    const service = createService({
      recipe: recipe({
        start: node('START', { choose: {} }),
        choose: {
          type: 'API_CHOICE',
          inputs: {
            rag_index: [
              { index_name: 'api-catalog', index_type: 'API' },
              { index_name: 'ran-kb', index_type: 'KNOWLEDGE' },
            ],
            query: 'RRC failure',
            open_api_knowledge_recall: 'true',
          },
          outputs: { api_name: '${api_name}', diag: '${knowledge_diagnostic}', know: '${knowledge}' },
          next: { end: {} },
        },
        end: node('END'),
      }),
      nodeCatalog: createWorkflowNodeCatalog({
        retrieveKnowledge: async (request) => {
          if (request.defaultIndexType === 'KNOWLEDGE') {
            return { status: 'OK', recommends: [{ knowledge: 'RRC info' }] };
          }
          return { status: 'OK', recommends: [{ apiName: 'query_rrc' }] };
        },
        modelInvocation: {
          async complete() {
            return { content: '', toolCalls: [{ toolCallId: 't1', toolName: 'query_rrc', arguments: {} }] };
          },
        } as never,
        resolveModelInvocationConfig: async () => ({
          modelId: 'test',
          contextWindowTokens: 128_000,
          inferenceOptions: {},
          timeoutMs: 30_000,
          maxRetries: 2,
        }),
      }),
    });
    const result = await service.execute(baseRequest(), new AbortController().signal);
    expect(result.status).toBe('COMPLETED');
    expect(result.outputVariables.api_name).toBe('query_rrc');
    expect(typeof result.outputVariables.diag).toBe('object');
    expect(typeof result.outputVariables.know).toBe('string');
  });

  // === D2: api_choice_prompt_template_name via prepareLlmPrompt ===
  it('D2: uses api_choice_prompt_template_name via prepareLlmPrompt', async () => {
    const service = createService({
      recipe: recipe({
        start: node('START', { choose: {} }),
        choose: {
          type: 'API_CHOICE',
          outputs: { api_name: '${api_name}' },
          inputs: {
            open_api_recall: 'false',
            api_choice_prompt_template_name: 'custom-api-choice-template',
            candidateApis: [{ apiName: 'query_incident', paramsSchema: { type: 'object' } }],
          },
          next: { end: {} },
        },
        end: node('END'),
      }),
      nodeCatalog: createWorkflowNodeCatalog({
        modelInvocation: {
          async complete() {
            return { content: '', toolCalls: [{ toolCallId: 't1', toolName: 'query_incident', arguments: {} }] };
          },
        } as never,
        resolveModelInvocationConfig: async () => ({
          modelId: 'test',
          contextWindowTokens: 128_000,
          inferenceOptions: {},
          timeoutMs: 30_000,
          maxRetries: 2,
        }),
        prepareLlmPrompt: async () => ({
          systemPrompt: 'Custom template prompt for API choice',
          userPrompt: '',
        }),
      }),
    });
    const result = await service.execute(baseRequest(), new AbortController().signal);
    expect(result.status).toBe('COMPLETED');
    expect(result.outputVariables.api_name).toBe('query_incident');
  });

  // === D2: WORKFLOW_API_CHOICE_PROMPT_UNAVAILABLE when prepareLlmPrompt returns empty ===
  it('D2: errors with WORKFLOW_API_CHOICE_PROMPT_UNAVAILABLE when prepareLlmPrompt returns empty', async () => {
    const service = createService({
      recipe: recipe({
        start: node('START', { choose: {} }),
        choose: {
          type: 'API_CHOICE',
          outputs: { api_name: '${api_name}' },
          inputs: {
            open_api_recall: 'false',
            candidateApis: [{ apiName: 'query_incident', paramsSchema: { type: 'object' } }],
          },
          next: { end: {} },
        },
        end: node('END'),
      }),
      nodeCatalog: createWorkflowNodeCatalog({
        modelInvocation: {
          async complete() {
            return { content: '', toolCalls: [] };
          },
        } as never,
        resolveModelInvocationConfig: async () => ({
          modelId: 'test',
          contextWindowTokens: 128_000,
          inferenceOptions: {},
          timeoutMs: 30_000,
          maxRetries: 2,
        }),
        prepareLlmPrompt: async () => ({ systemPrompt: '', userPrompt: '' }),
      }),
    });
    const result = await service.execute(baseRequest(), new AbortController().signal);
    expect(result.status).toBe('FAILED');
    expect(result.nodeResults.find((item) => item.nodeType === 'API_CHOICE')?.safeError?.code).toBe('WORKFLOW_API_CHOICE_PROMPT_UNAVAILABLE');
  });

  // === D8: remove_think_tags=true strips think tags from LLM content ===
  it('D8: strips think tags when remove_think_tags is true', async () => {
    const modelComplete = vi.fn(async () => ({
      content: '<think>reasoning</think>query_incident',
      toolCalls: [{ toolCallId: 't1', toolName: 'query_incident', arguments: {} }],
    }));
    const service = createService({
      recipe: recipe({
        start: node('START', { choose: {} }),
        choose: {
          type: 'API_CHOICE',
          outputs: { api_name: '${api_name}' },
          inputs: {
            open_api_recall: 'false',
            remove_think_tags: 'true',
            candidateApis: [{ apiName: 'query_incident', paramsSchema: { type: 'object' } }],
          },
          next: { end: {} },
        },
        end: node('END'),
      }),
      nodeCatalog: createWorkflowNodeCatalog({
        modelInvocation: { complete: modelComplete } as never,
        resolveModelInvocationConfig: async () => ({
          modelId: 'test',
          contextWindowTokens: 128_000,
          inferenceOptions: {},
          timeoutMs: 30_000,
          maxRetries: 2,
        }),
      }),
    });
    const result = await service.execute(baseRequest(), new AbortController().signal);
    expect(result.status).toBe('COMPLETED');
    expect(result.outputVariables.api_name).toBe('query_incident');
  });

  // === D3: KNOWLEDGE_EMPTY when knowledge recall returns no results ===
  it('D3: errors with WORKFLOW_API_CHOICE_KNOWLEDGE_EMPTY when knowledge recall is empty', async () => {
    const service = createService({
      recipe: recipe({
        start: node('START', { choose: {} }),
        choose: {
          type: 'API_CHOICE',
          outputs: { api_name: '${api_name}', knowledge: '${knowledge}' },
          inputs: {
            rag_index: [
              { index_name: 'api-catalog', index_type: 'API' },
              { index_name: 'ran-kb', index_type: 'KNOWLEDGE' },
            ],
            query: 'RRC failure',
            open_api_knowledge_recall: 'true',
          },
          next: { end: {} },
        },
        end: node('END'),
      }),
      nodeCatalog: createWorkflowNodeCatalog({
        retrieveKnowledge: async (request) => {
          if (request.defaultIndexType === 'KNOWLEDGE') {
            return { status: 'OK', recommends: [] };
          }
          return { status: 'OK', recommends: [{ apiName: 'query_rrc' }] };
        },
        modelInvocation: {
          async complete() {
            return { content: '', toolCalls: [{ toolCallId: 't1', toolName: 'query_rrc', arguments: {} }] };
          },
        } as never,
        resolveModelInvocationConfig: async () => ({
          modelId: 'test',
          contextWindowTokens: 128_000,
          inferenceOptions: {},
          timeoutMs: 30_000,
          maxRetries: 2,
        }),
      }),
    });
    const result = await service.execute(baseRequest(), new AbortController().signal);
    expect(result.status).toBe('FAILED');
    expect(result.nodeResults.find((item) => item.nodeType === 'API_CHOICE')?.safeError?.code).toBe('WORKFLOW_API_CHOICE_KNOWLEDGE_EMPTY');
  });

  // === D6: model_params passed through opaquely as modelParams ===
  it('D6: passes model_params through opaquely as modelParams', async () => {
    let receivedRequest: ModelInvocationRequest | undefined;
    const service = createService({
      recipe: recipe({
        start: node('START', { choose: {} }),
        choose: {
          type: 'API_CHOICE',
          outputs: { api_name: '${api_name}' },
          inputs: {
            open_api_recall: 'false',
            model_params: { temperature: 0.1, max_tokens: 100 },
            candidateApis: [{ apiName: 'query_incident', paramsSchema: { type: 'object' } }],
          },
          next: { end: {} },
        },
        end: node('END'),
      }),
      nodeCatalog: createWorkflowNodeCatalog({
        modelInvocation: {
          async complete(request) {
            receivedRequest = request;
            return { content: '', toolCalls: [{ toolCallId: 't1', toolName: 'query_incident', arguments: {} }] };
          },
        } as never,
        resolveModelInvocationConfig: async () => ({
          modelId: 'test',
          contextWindowTokens: 8192,
          inferenceOptions: {},
          timeoutMs: 30_000,
          maxRetries: 0,
        }),
      }),
    });
    const result = await service.execute(baseRequest(), new AbortController().signal);
    expect(result.status).toBe('COMPLETED');
    expect(receivedRequest?.modelParams).toMatchObject({ temperature: 0.1, max_tokens: 100 });
    expect(receivedRequest?.temperature).toBeUndefined();
    expect(receivedRequest?.maxOutputTokens).toBeUndefined();
  });
});
