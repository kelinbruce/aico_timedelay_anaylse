import { bindRuntimeLoggerProvider, brand, type RuntimeLogger, type RuntimeLoggerProviderBinding } from '@nextagent/agent-common';
import { WorkflowRecipeDefinitionSource } from '@nextagent/agent-workflow';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const agentId = brand<string, 'AgentId'>('default-agent');

let loggerBinding: RuntimeLoggerProviderBinding | undefined;
afterEach(() => loggerBinding?.unbind());

function createRecordingLogger(): RuntimeLogger & { readonly calls: ReadonlyArray<{ level: string; obj: object; msg?: string }> } {
  const calls: Array<{ level: string; obj: object; msg?: string }> = [];
  return {
    calls,
    error(obj, msg) {
      calls.push(msg !== undefined ? { level: 'error', obj, msg } : { level: 'error', obj });
    },
    warn(obj, msg) {
      calls.push(msg !== undefined ? { level: 'warn', obj, msg } : { level: 'warn', obj });
    },
    info(obj, msg) {
      calls.push(msg !== undefined ? { level: 'info', obj, msg } : { level: 'info', obj });
    },
    debug(obj, msg) {
      calls.push(msg !== undefined ? { level: 'debug', obj, msg } : { level: 'debug', obj });
    },
  };
}

const templateStringRecipeYaml = `
recipeName: batch-template-string-test
version: v1
displayName: Batch template string test
flowGraph:
  nodes:
    start:
      type: START
      next:
        search: {}
    search:
      type: KNOWLEDGE_SEARCH
      inputs:
        rag_index:
          - index_name: ran-kb
        query: '\${sub_question}'
      outputs:
        knowledge_search_result: '\${knowledge_search_result}'
      batchConfig:
        batchInputDataItem: '\${sub_queries}'
        batchElementVariable: sub_question
        batchSize: 2
        batchMode: serial
      next:
        end: {}
    end:
      type: END
`;

const inlineArrayRecipeYaml = `
recipeName: batch-inline-array-test
version: v1
displayName: Batch inline array test
flowGraph:
  nodes:
    start:
      type: START
      next:
        search: {}
    search:
      type: KNOWLEDGE_SEARCH
      inputs:
        rag_index:
          - index_name: ran-kb
        query: '\${sub_question}'
      outputs:
        knowledge_search_result: '\${knowledge_search_result}'
      batchConfig:
        batchInputDataItem:
          - ne_id: NE-1
          - ne_id: NE-2
          - ne_id: NE-3
        batchElementVariable: sub_question
        batchSize: 2
        batchMode: serial
      next:
        end: {}
    end:
      type: END
`;

const invalidTypeRecipeYaml = `
recipeName: batch-invalid-type-test
version: v1
displayName: Batch invalid type test
flowGraph:
  nodes:
    start:
      type: START
      next:
        search: {}
    search:
      type: KNOWLEDGE_SEARCH
      inputs:
        rag_index:
          - index_name: ran-kb
      batchConfig:
        batchInputDataItem: 42
        batchElementVariable: sub_question
      next:
        end: {}
    end:
      type: END
`;

describe('workflow batch batchInputDataItem template string loader', () => {
  it('accepts batchInputDataItem as a template string placeholder and loads the recipe', async () => {
    const root = await mkdtemp(join(tmpdir(), 'nextagent-batch-template-'));
    try {
      await mkdir(join(root, 'agents', 'default-agent', 'recipes'), { recursive: true });
      await writeFile(join(root, 'agents', 'default-agent', 'recipes', 'batch-template-string-test.yaml'), templateStringRecipeYaml, 'utf8');

      const source = new WorkflowRecipeDefinitionSource({ agentsRoot: join(root, 'agents') });
      const definition = source.require(agentId, 'batch-template-string-test');

      expect(definition.recipeName).toBe('batch-template-string-test');

      const searchNode = definition.flowGraph.nodes.search;
      expect(searchNode).toBeDefined();
      if (searchNode === undefined) {
        throw new Error('Expected the search node to be loaded');
      }
      expect(searchNode.batchConfig).toBeDefined();
      expect(searchNode.batchConfig!.batchInputDataItem).toBe('${sub_queries}');
      expect(searchNode.batchConfig!.batchElementVariable).toBe('sub_question');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('accepts batchInputDataItem as an inline array and loads the recipe', async () => {
    const root = await mkdtemp(join(tmpdir(), 'nextagent-batch-inline-'));
    try {
      await mkdir(join(root, 'agents', 'default-agent', 'recipes'), { recursive: true });
      await writeFile(join(root, 'agents', 'default-agent', 'recipes', 'batch-inline-array-test.yaml'), inlineArrayRecipeYaml, 'utf8');

      const source = new WorkflowRecipeDefinitionSource({ agentsRoot: join(root, 'agents') });
      const definition = source.require(agentId, 'batch-inline-array-test');

      expect(definition.recipeName).toBe('batch-inline-array-test');

      const searchNode = definition.flowGraph.nodes.search;
      expect(searchNode).toBeDefined();
      if (searchNode === undefined) {
        throw new Error('Expected the search node to be loaded');
      }
      expect(searchNode.batchConfig).toBeDefined();
      expect(Array.isArray(searchNode.batchConfig!.batchInputDataItem)).toBe(true);
      expect(searchNode.batchConfig!.batchInputDataItem).toHaveLength(3);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('rejects batchInputDataItem of invalid type and emits validationErrors diagnostic', async () => {
    const logger = createRecordingLogger();
    loggerBinding?.unbind();
    loggerBinding = bindRuntimeLoggerProvider({ getLogger: () => logger });

    const root = await mkdtemp(join(tmpdir(), 'nextagent-batch-invalid-'));
    try {
      await mkdir(join(root, 'agents', 'default-agent', 'recipes'), { recursive: true });
      await writeFile(join(root, 'agents', 'default-agent', 'recipes', 'batch-invalid-type-test.yaml'), invalidTypeRecipeYaml, 'utf8');

      const source = new WorkflowRecipeDefinitionSource({ agentsRoot: join(root, 'agents') });
      let thrownError: unknown;
      try {
        source.require(agentId, 'batch-invalid-type-test');
      } catch (error) {
        thrownError = error;
      }
      expect(thrownError).toBeDefined();
      expect((thrownError as { code?: string }).code).toBe('RECIPE_INVALID');

      const skipLog = logger.calls.find((c) => c.level === 'warn' && (c.obj as { event?: string }).event === 'workflow.recipe.skip');
      expect(skipLog).toBeDefined();
      const validationErrors = (skipLog!.obj as { validationErrors?: Array<Record<string, unknown>> }).validationErrors;
      expect(validationErrors).toBeDefined();
      expect(Array.isArray(validationErrors)).toBe(true);
      expect(validationErrors!.length).toBeGreaterThan(0);
      for (const err of validationErrors!) {
        expect(err).toHaveProperty('instancePath');
        expect(err).toHaveProperty('keyword');
        expect(err).not.toHaveProperty('data');
        expect(err).not.toHaveProperty('message');
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
