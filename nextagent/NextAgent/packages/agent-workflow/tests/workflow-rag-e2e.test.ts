import { modelEventStreamFixture } from '../../../tests/helpers/model-stream-fixture.js';
import type { WorkflowKnowledgeRetrievalRequest } from '../src/nodes/types.js';
import { describe, expect, it, vi } from 'vitest';
import { createWorkflowNodeCatalog } from '../src/index.js';
import { createService, recipe, node, baseRequest } from './test-helpers.js';

describe('workflow RAG E2E node processing flow', () => {
  describe('multi-node variable resolution', () => {
    it('passes knowledge-search output to recipe-choice via interpolation', async () => {
      const calls: WorkflowKnowledgeRetrievalRequest[] = [];
      const service = createService({
        recipe: recipe({
          start: node('START', { search: {} }),
          search: node(
            'KNOWLEDGE_SEARCH',
            { choose: {} },
            {
              outputs: { search_texts: '${knowledge_search_result}' },
              inputs: {
                rag_index: [{ index_name: 'ran-kb' }],
                query: 'RRC failure diagnosis',
              },
            },
          ),
          choose: node(
            'RECIPE_CHOICE',
            { end: {} },
            {
              inputs: {
                rag_index: [{ index_name: 'recipe-index' }],
                query: 'Find recipe based on ${search_texts}',
              },
            },
          ),
          end: node('END'),
        }),
        nodeCatalog: createWorkflowNodeCatalog({
          retrieveKnowledge: async (request) => {
            calls.push(request);
            if (request.defaultIndexType === 'KNOWLEDGE') {
              return {
                status: 'OK',
                recommends: [
                  { id: 'docs/rrc.md', title: 'RRC Guide', knowledge: 'RRC failures follow paging storms.', vsScore: 0.92 },
                  { id: 'docs/kpi.md', title: 'KPI Guide', knowledge: 'Check RRC SR.', vsScore: 0.81 },
                ],
              };
            }
            return {
              status: 'OK',
              recommends: [{ recipeId: 'paging-recovery', recipeName: 'paging-recovery' }],
            };
          },
        }),
      });

      const result = await service.execute(baseRequest(), new AbortController().signal);

      expect(result.status).toBe('COMPLETED');
      expect(calls[0]!.defaultIndexType).toBe('KNOWLEDGE');
      expect(calls[1]!.defaultIndexType).toBe('RECIPE');
      expect(calls[1]!.query).toContain('RRC failures follow paging storms.');
      expect(calls[1]!.query).toContain('Check RRC SR.');
      expect(result.outputVariables.recipe_name).toBe('paging-recovery');
    });

    it('exposes only declared knowledge-search bindings to downstream outputVariables', async () => {
      const service = createService({
        recipe: recipe({
          start: node('START', { search: {} }),
          search: node(
            'KNOWLEDGE_SEARCH',
            { end: {} },
            {
              outputs: { texts: '${knowledge_search_result}' },
              inputs: {
                rag_index: [{ index_name: 'ran-kb' }],
                query: 'RRC failure',
              },
            },
          ),
          end: node('END'),
        }),
        nodeCatalog: createWorkflowNodeCatalog({
          retrieveKnowledge: async () => ({
            status: 'OK',
            recommends: [{ id: 'docs/rrc.md', title: 'RRC Guide', knowledge: 'content', vsScore: 0.9 }],
          }),
        }),
      });

      const result = await service.execute(baseRequest(), new AbortController().signal);

      expect(result.status).toBe('COMPLETED');
      expect(result.outputVariables).toEqual({ texts: ['content'] });
    });
  });

  describe('indexType-specific result parsing', () => {
    it('preserves full KNOWLEDGE recommends fields in a recall binding', async () => {
      const service = createService({
        recipe: recipe({
          start: node('START', { search: {} }),
          search: node(
            'KNOWLEDGE_SEARCH',
            { end: {} },
            {
              outputs: { hits: '${recall_result}' },
              inputs: {
                rag_index: [{ index_name: 'ran-kb' }],
                query: 'RRC failure',
              },
            },
          ),
          end: node('END'),
        }),
        nodeCatalog: createWorkflowNodeCatalog({
          retrieveKnowledge: async () => ({
            status: 'OK',
            recommends: [
              {
                id: '60454154373f62',
                title: 'RRC Guide',
                summary: [],
                metadata: {},
                fileName: '',
                vsScore: 1.0000001,
                hyQuestions: [],
                label: ['sadsa'],
                source: '',
                labels: [],
                productVersion: ['V'],
                extensions: ['ssss'],
                rerankScore: 0,
                field: '',
                esScore: 4.9408684,
                productNames: [],
                properties: {},
                knowledge: 'RRC failure content',
              },
            ],
          }),
        }),
      });

      const result = await service.execute(baseRequest(), new AbortController().signal);

      expect(result.status).toBe('COMPLETED');
      const docs = result.outputVariables.hits as readonly unknown[];
      const doc = docs[0] as Record<string, unknown>;
      expect(doc.id).toBe('60454154373f62');
      expect(doc.title).toBe('RRC Guide');
      expect(doc.vsScore).toBe(1.0000001);
      expect(doc.esScore).toBe(4.9408684);
      expect(doc.knowledge).toBe('RRC failure content');
      expect(doc.label).toEqual(['sadsa']);
      expect(doc.productVersion).toEqual(['V']);
      expect(doc.extensions).toEqual(['ssss']);
    });

    it('extracts recipeName from RECIPE recommends into recipe_name and recall_result', async () => {
      const service = createService({
        recipe: recipe({
          start: node('START', { choose: {} }),
          choose: node(
            'RECIPE_CHOICE',
            { end: {} },
            {
              inputs: {
                rag_index: [{ index_name: 'recipe-index' }],
                query: 'Find recipe',
                rank_topN: 2,
              },
            },
          ),
          end: node('END'),
        }),
        nodeCatalog: createWorkflowNodeCatalog({
          retrieveKnowledge: async () => ({
            status: 'OK',
            recommends: [
              { recipeId: 'paging-recovery', recipeName: 'paging-recovery' },
              { recipeId: 'capacity-check', recipeName: 'capacity-check' },
            ],
          }),
        }),
      });

      const result = await service.execute(baseRequest(), new AbortController().signal);

      expect(result.status).toBe('COMPLETED');
      expect(result.outputVariables.recipe_name).toBe('paging-recovery');
      expect(result.outputVariables.recipe_name_list).toEqual(['paging-recovery', 'capacity-check']);
      const recall = result.outputVariables.recall_result as readonly unknown[];
      const first = recall[0] as Record<string, unknown>;
      expect(first.recipeId).toBe('paging-recovery');
      expect(first.recipeName).toBe('paging-recovery');
    });

    it('extracts apiName from API recommends into recall_result', async () => {
      const service = createService({
        recipe: recipe({
          start: node('START', { choose: {} }),
          choose: node(
            'API_CHOICE',
            { end: {} },
            {
              outputs: { api_name: '${api_name}', recall_result: '${recall_result}' },
              inputs: {
                rag_index: [{ index_name: 'api-catalog' }],
                query: 'Query RAN incident detail',
              },
            },
          ),
          end: node('END'),
        }),
        nodeCatalog: createWorkflowNodeCatalog({
          retrieveKnowledge: async () => ({
            status: 'OK',
            recommends: [
              {
                apiId: 'query_incident',
                apiName: 'query_incident',
                description: 'Query RAN incident detail by incident id.',
                category: 'incident',
                qaExample: 'How to query incident?',
                extensions: {},
                hyQuestions: ['query'],
              },
              {
                apiId: 'query_alarm',
                apiName: 'query_alarm',
                description: 'Query active alarm list by node id.',
                category: 'alarm',
                qaExample: 'How to query alarm?',
                extensions: {},
                hyQuestions: ['alarm'],
              },
              {
                apiId: 'close_incident',
                apiName: 'close_incident',
                description: 'Close a RAN incident.',
                category: 'incident',
                qaExample: 'How to close incident?',
                extensions: {},
                hyQuestions: ['close'],
              },
            ],
          }),
          resolveModelInvocationConfig: () => ({
            modelId: 'test-model',
            contextWindowTokens: 128_000,
            inferenceOptions: {},
            timeoutMs: 5000,
            maxRetries: 2,
          }),
          modelInvocation: {
            async complete() {
              return {
                content: '{}',
                toolCalls: [{ toolCallId: 'tc1', toolName: 'query_incident', arguments: {} }],
              };
            },
            stream: modelEventStreamFixture(async function* () {
              yield { type: 'final' as const, content: '{}', toolCalls: [{ toolCallId: 'tc1', toolName: 'query_incident', arguments: {} }] };
            }),
          },
        }),
      });

      const result = await service.execute(baseRequest(), new AbortController().signal);

      expect(result.status).toBe('COMPLETED');
      expect(result.outputVariables.api_name).toBe('query_incident');
      const recall = result.outputVariables.recall_result as readonly unknown[];
      const first = recall[0] as Record<string, unknown>;
      expect(first.apiId).toBe('query_incident');
      expect(first.apiName).toBe('query_incident');
      expect(first.description).toBe('Query RAN incident detail by incident id.');
    });
  });

  describe('recommends passthrough without truncation', () => {
    it('does not truncate long content in recommends', async () => {
      const longContent = 'A'.repeat(1000);
      const service = createService({
        recipe: recipe({
          start: node('START', { search: {} }),
          search: node(
            'KNOWLEDGE_SEARCH',
            { end: {} },
            {
              outputs: { hits: '${recall_result}' },
              inputs: {
                rag_index: [{ index_name: 'ran-kb' }],
                query: 'RRC failure',
              },
            },
          ),
          end: node('END'),
        }),
        nodeCatalog: createWorkflowNodeCatalog({
          retrieveKnowledge: async () => ({
            status: 'OK',
            recommends: [{ id: 'doc1', title: 'Long Doc', knowledge: longContent, vsScore: 0.9 }],
          }),
        }),
      });

      const result = await service.execute(baseRequest(), new AbortController().signal);

      expect(result.status).toBe('COMPLETED');
      const docs = result.outputVariables.hits as readonly unknown[];
      const doc = docs[0] as Record<string, unknown>;
      expect(doc.knowledge).toBe(longContent);
      expect((doc.knowledge as string).length).toBe(1000);
    });
  });

  describe('per-index params and indexType default in E2E', () => {
    it('fills default indexType by node type and passes per-index vsTopN', async () => {
      const calls: WorkflowKnowledgeRetrievalRequest[] = [];
      const service = createService({
        recipe: recipe({
          start: node('START', { search: {} }),
          search: node(
            'KNOWLEDGE_SEARCH',
            { end: {} },
            {
              outputs: { texts: '${knowledge_search_result}' },
              inputs: {
                rag_index: [{ index_name: 'idx-a', vs_topN: 5 }, { index_name: 'idx-b' }],
                query: 'RRC failure',
                vs_topN: 10,
              },
            },
          ),
          end: node('END'),
        }),
        nodeCatalog: createWorkflowNodeCatalog({
          retrieveKnowledge: async (request) => {
            calls.push(request);
            return {
              status: 'OK',
              recommends: [{ id: 'd', title: 't', knowledge: 'e', vsScore: 1 }],
            };
          },
        }),
      });

      const result = await service.execute(baseRequest(), new AbortController().signal);

      expect(result.status).toBe('COMPLETED');
      const call = calls[0]!;
      expect(call.defaultIndexType).toBe('KNOWLEDGE');
      expect(call.indexes[0]!.indexName).toBe('idx-a');
      expect(call.indexes[0]!.vsTopN).toBe(5);
      expect(call.indexes[1]!.indexName).toBe('idx-b');
      expect(call.vsTopN).toBe(10);
    });

    it('user-specified indexType overrides node default in E2E', async () => {
      const calls: WorkflowKnowledgeRetrievalRequest[] = [];
      const service = createService({
        recipe: recipe({
          start: node('START', { search: {} }),
          search: node(
            'KNOWLEDGE_SEARCH',
            { end: {} },
            {
              outputs: { texts: '${knowledge_search_result}' },
              inputs: {
                rag_index: [{ index_name: 'mixed-idx', index_type: 'API' }],
                query: 'RRC failure',
              },
            },
          ),
          end: node('END'),
        }),
        nodeCatalog: createWorkflowNodeCatalog({
          retrieveKnowledge: async (request) => {
            calls.push(request);
            return {
              status: 'OK',
              recommends: [{ id: 'd', title: 't', knowledge: 'e', vsScore: 1 }],
            };
          },
        }),
      });

      const result = await service.execute(baseRequest(), new AbortController().signal);

      expect(result.status).toBe('COMPLETED');
      expect(calls[0]!.indexes[0]!.indexType).toBe('API');
      expect(calls[0]!.defaultIndexType).toBe('KNOWLEDGE');
    });
  });
});
