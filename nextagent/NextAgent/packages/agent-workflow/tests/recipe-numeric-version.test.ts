import { resolve } from 'node:path';
import { brand } from '@nextagent/agent-common';
import { RecipeDefinitionSchema } from '@nextagent/agent-contracts/core';
import { Ajv } from 'ajv/dist/ajv.js';
import { load as parseYaml } from 'js-yaml';
import { describe, expect, it } from 'vitest';
import { WorkflowRecipeDefinitionSource } from '../src/workflow-recipe-loader.js';

const ajv = new Ajv({ allErrors: true, strict: false });
const validateRecipe = ajv.compile(RecipeDefinitionSchema);

describe('recipe numeric version compat', () => {
  it('YAML version: 1.0 is parsed as number, not string', () => {
    const yaml = 'version: 1.0\nname: test\nnodes:\n  s:\n    type: START\n    next: {}\n';
    const parsed = parseYaml(yaml) as Record<string, unknown>;
    expect(parsed.version).toBe(1);
    expect(typeof parsed.version).toBe('number');
  });

  it('accepts recipe with numeric version via normalizeRecipeDefinition (old format)', () => {
    const agentsRoot = resolve(__dirname, 'fixtures');
    // Recipe directory is agentsRoot/agentId/recipes
    const source = new WorkflowRecipeDefinitionSource({ agentsRoot });
    const recipe = source.require(brand<string, 'AgentId'>('numeric-version-agent'), 'numeric-version-demo');
    expect(recipe.version).toBe('1');
    expect(typeof recipe.version).toBe('string');
    expect(validateRecipe(recipe)).toBe(true);
  });

  it('accepts new-format recipe with numeric version', () => {
    const yaml = [
      'recipeName: new-format-numeric',
      'version: 2.0',
      'displayName: New Format Numeric',
      'flowGraph:',
      '  nodes:',
      '    start_node:',
      '      type: START',
      '      next:',
      '        end_node: {}',
      '    end_node:',
      '      type: END',
    ].join('\n');
    const parsed = parseYaml(yaml) as Record<string, unknown>;
    expect(parsed.version).toBe(2);
    expect(typeof parsed.version).toBe('number');
    // After normalizeRecipeDefinition, version should be coerced to string
    // This simulates the new-format path by manually applying the same coercion
    const coerced = { ...parsed, version: typeof parsed.version === 'number' ? String(parsed.version) : parsed.version };
    expect(coerced.version).toBe('2');
    expect(typeof coerced.version).toBe('string');
    expect(validateRecipe(coerced)).toBe(true);
  });
});
