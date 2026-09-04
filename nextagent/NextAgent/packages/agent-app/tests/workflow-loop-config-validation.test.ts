import { WorkflowRecipeDefinitionSource } from '@nextagent/agent-workflow';
import { brand } from '@nextagent/agent-common';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const agentId = brand<string, 'AgentId'>('default-agent');

function writeRecipe(root: string, name: string, content: string): void {
  const agentsDir = join(root, 'agents');
  const dir = join(agentsDir, agentId, 'recipes');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, name + '.yaml'), content, 'utf8');
}

function makeRegistry(root: string): WorkflowRecipeDefinitionSource {
  return new WorkflowRecipeDefinitionSource({ agentsRoot: join(root, 'agents') });
}

function loopRecipeYaml(name: string, loopConfig: string): string {
  return [
    'name: ' + name,
    'version: v1',
    'nodes:',
    '  start:',
    '    type: start-event',
    '    next:',
    '      loopend: {}',
    '  body:',
    '    type: tool',
    '    next:',
    '      loopend: {}',
    '  loopend:',
    '    type: tool',
    loopConfig,
    '    next:',
    '      end_node: {}',
    '  end_node:',
    '    type: end-event',
  ].join('\n');
}

describe('workflow loopConfig loader validation', () => {
  it('loads recipe with valid loopConfig (snake_case normalized)', () => {
    const root = join(process.cwd(), '.tmp-loop-test-valid');
    try {
      writeRecipe(
        root,
        'loop_valid',
        loopRecipeYaml(
          'loop_valid',
          ['    loop_config:', '      loop_cardinality: 3', '      loop_start_node: body', '      loop_end_node: loopend'].join('\n'),
        ),
      );
      const registry = makeRegistry(root);
      const recipe = registry.require(agentId, 'loop_valid');
      expect(recipe.flowGraph.nodes.loopend?.loopConfig).toBeDefined();
      expect(recipe.flowGraph.nodes.loopend?.loopConfig?.loopCardinality).toBe(3);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('rejects loopCardinality over 1000', () => {
    const root = join(process.cwd(), '.tmp-loop-test-card');
    try {
      writeRecipe(
        root,
        'loop_card',
        loopRecipeYaml(
          'loop_card',
          ['    loop_config:', '      loop_cardinality: 1001', '      loop_start_node: body', '      loop_end_node: loopend'].join('\n'),
        ),
      );
      const registry = makeRegistry(root);
      expect(() => registry.require(agentId, 'loop_card')).toThrow();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
  it('rejects loopCardinality below 1', () => {
    const root = join(process.cwd(), '.tmp-loop-test-min');
    try {
      writeRecipe(
        root,
        'loop_min',
        loopRecipeYaml(
          'loop_min',
          ['    loop_config:', '      loop_cardinality: 0', '      loop_start_node: body', '      loop_end_node: loopend'].join('\n'),
        ),
      );
      const registry = makeRegistry(root);
      expect(() => registry.require(agentId, 'loop_min')).toThrow();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('rejects loopStartNode that does not exist', () => {
    const root = join(process.cwd(), '.tmp-loop-test-start');
    try {
      writeRecipe(
        root,
        'loop_start',
        loopRecipeYaml(
          'loop_start',
          ['    loop_config:', '      loop_cardinality: 2', '      loop_start_node: nonexistent', '      loop_end_node: loopend'].join('\n'),
        ),
      );
      const registry = makeRegistry(root);
      expect(() => registry.require(agentId, 'loop_start')).toThrow();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('rejects loopEndNode not equal to configuring node id', () => {
    const root = join(process.cwd(), '.tmp-loop-test-end');
    try {
      writeRecipe(
        root,
        'loop_end',
        loopRecipeYaml(
          'loop_end',
          ['    loop_config:', '      loop_cardinality: 2', '      loop_start_node: body', '      loop_end_node: body'].join('\n'),
        ),
      );
      const registry = makeRegistry(root);
      expect(() => registry.require(agentId, 'loop_end')).toThrow();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('workflow batchConfig and loopConfig mutex', () => {
  it('rejects recipe when same node declares both loopConfig and batchConfig', () => {
    const root = join(process.cwd(), '.tmp-batch-loop-conflict');
    try {
      writeRecipe(
        root,
        'conflict',
        [
          'name: conflict',
          'version: v1',
          'nodes:',
          '  start:',
          '    type: start-event',
          '    next:',
          '      api: {}',
          '  api:',
          '    type: restful',
          '    inputs:',
          '      api_name: alarm_query',
          '    batch_config:',
          '      batch_input_data_item:',
          '        - ne_id: NE-1',
          '      batch_element_variable: element',
          '    loop_config:',
          '      loop_cardinality: 2',
          '      loop_start_node: api',
          '      loop_end_node: api',
          '    next:',
          '      end_node: {}',
          '  end_node:',
          '    type: end-event',
        ].join('\n'),
      );
      const registry = makeRegistry(root);
      expect(() => registry.require(agentId, 'conflict')).toThrow(/failed validation during lazy load/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('accepts recipe when loopConfig and batchConfig are on different nodes', () => {
    const root = join(process.cwd(), '.tmp-batch-loop-separate');
    try {
      writeRecipe(
        root,
        'separate',
        [
          'name: separate',
          'version: v1',
          'nodes:',
          '  start:',
          '    type: start-event',
          '    next:',
          '      api: {}',
          '  api:',
          '    type: restful',
          '    inputs:',
          '      api_name: alarm_query',
          '    batch_config:',
          '      batch_input_data_item:',
          '        - ne_id: NE-1',
          '      batch_element_variable: element',
          '    next:',
          '      end_node: {}',
          '  end_node:',
          '    type: end-event',
        ].join('\n'),
      );
      const registry = makeRegistry(root);
      const recipe = registry.require(agentId, 'separate');
      expect(recipe.flowGraph.nodes.api?.batchConfig).toBeDefined();
      expect(recipe.flowGraph.nodes.api?.loopConfig).toBeUndefined();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
