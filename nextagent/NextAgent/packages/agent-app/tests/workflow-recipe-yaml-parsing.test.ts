import { parseBuiltInConfig } from '../src/config/system-config.js';
import { describe, expect, it } from 'vitest';

describe('parseBuiltInConfig yaml parsing', () => {
  it('parses standard yaml with nested maps, block sequences and mixed scalars', () => {
    const yaml = [
      'name: demo_recipe',
      'version: 1.1.0',
      'expandFields:',
      '  recipe_ne_version: 1.0',
      '  recipe_ne_type: xxx',
      'nodes:',
      '  start_node:',
      '    type: start-event',
      '    description: begin',
      '    next:',
      '      ext_api:',
      '        condition: ""',
      '  ext_api:',
      '    type: restful',
      '    inputs:',
      '      api_name: weather_query',
      '    outputs:',
      '      elementVariables: ${api_response}',
      '    next:',
      '      last_llm:',
      '        condition: ${elementVariables[0] == "晴"}',
      '      end_node:',
      '        condition: ${elementVariables[0] != "晴"}',
    ].join('\n');

    const parsed = parseBuiltInConfig(yaml) as Record<string, unknown>;

    expect(parsed.name).toBe('demo_recipe');
    expect(parsed.version).toBe('1.1.0');
    expect(parsed.nodes).toBeTypeOf('object');
    const nodes = parsed.nodes as Record<string, unknown>;
    expect(nodes.start_node).toBeTypeOf('object');
    const extApi = nodes.ext_api as Record<string, unknown> | undefined;
    if (extApi === undefined) {
      throw new Error('Expected ext_api node.');
    }
    expect(extApi.type).toBe('restful');
    const next = extApi.next as Record<string, Record<string, unknown>>;
    const lastLlm = next.last_llm as Record<string, unknown> | undefined;
    if (lastLlm === undefined) {
      throw new Error('Expected last_llm transition.');
    }
    expect(lastLlm.condition).toBe('${elementVariables[0] == "晴"}');
  });

  it('parses block sequences into arrays', () => {
    const yaml = ['items:', '  - one', '  - two', '  - three'].join('\n');

    const parsed = parseBuiltInConfig(yaml) as Record<string, unknown>;
    expect(parsed.items).toEqual(['one', 'two', 'three']);
  });

  it('infers number, boolean and null scalar types', () => {
    const yaml = ['count: 5000', 'ratio: 1.5', 'enabled: true', 'disabled: false', 'missing: null', 'label: demo_recipe'].join('\n');

    const parsed = parseBuiltInConfig(yaml) as Record<string, unknown>;
    expect(parsed.count).toBe(5000);
    expect(parsed.ratio).toBe(1.5);
    expect(parsed.enabled).toBe(true);
    expect(parsed.disabled).toBe(false);
    expect(parsed.missing).toBeNull();
    expect(parsed.label).toBe('demo_recipe');
  });

  it('keeps non-numeric version-like strings as string', () => {
    const yaml = 'version: 1.1.0';
    const parsed = parseBuiltInConfig(yaml) as Record<string, unknown>;
    expect(parsed.version).toBe('1.1.0');
  });

  it('prioritizes JSON.parse for json content', () => {
    const json = JSON.stringify({ name: 'demo', nested: { key: 'value' }, list: [1, 2, 3] });
    const parsed = parseBuiltInConfig(json) as Record<string, unknown>;
    expect(parsed).toEqual({ name: 'demo', nested: { key: 'value' }, list: [1, 2, 3] });
  });

  it('parses nested indentation without throwing unsupported syntax error', () => {
    const yaml = ['outer:', '  inner:', '    deep:', '      value: end'].join('\n');

    const parsed = parseBuiltInConfig(yaml) as Record<string, unknown>;
    const outer = parsed.outer as Record<string, unknown>;
    const inner = outer.inner as Record<string, unknown>;
    const deep = inner.deep as Record<string, unknown>;
    expect(deep.value).toBe('end');
  });

  it('throws for invalid yaml and does not silently return null', () => {
    const invalid = 'name: : : invalid';
    expect(() => parseBuiltInConfig(invalid)).toThrow();
  });

  it('is a pure function without side effects (returns equal value for equal input)', () => {
    const yaml = 'name: demo\nversion: "1.0"';
    const first = parseBuiltInConfig(yaml);
    const second = parseBuiltInConfig(yaml);
    expect(second).toEqual(first);
  });
});
