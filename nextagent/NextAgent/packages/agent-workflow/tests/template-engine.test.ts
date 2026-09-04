import type { JsonObject } from '@nextagent/agent-common';
import { describe, expect, it } from 'vitest';
import { renderTemplate as renderJsonTemplate } from '../src/template-engine/index.js';

function renderTemplate(template: string, scope: Record<string, unknown>): string {
  return renderJsonTemplate(template, scope as JsonObject);
}

describe('template engine', () => {
  // --- Variable resolution ---

  it('resolves ${var} references', () => {
    const result = renderTemplate('Hello ${name}!', { name: 'World' } as JsonObject);
    expect(result).toBe('Hello World!');
  });

  it('resolves ${var.path} nested references', () => {
    const result = renderTemplate('${user.name} is ${user.age}', { user: { name: 'Alice', age: 30 } } as JsonObject);
    expect(result).toBe('Alice is 30');
  });

  it('resolves {{ var.path }} mustache references', () => {
    const result = renderTemplate('{{ user.name }} says hello', { user: { name: 'Bob' } } as JsonObject);
    expect(result).toBe('Bob says hello');
  });

  it('resolves undefined variables to empty string', () => {
    const result = renderTemplate('${missing} value', {} as JsonObject);
    expect(result).toBe(' value');
  });

  it('stringifies non-string values', () => {
    const result = renderTemplate('${num} ${flag} ${arr}', { num: 42, flag: true, arr: [1, 2] } as JsonObject);
    expect(result).toBe('42 true [1,2]');
  });

  // --- for loop ---

  it('expands {% for item in list %} loop', () => {
    const result = renderTemplate('{% for item in items %}${item}, {% endfor %}', { items: ['a', 'b', 'c'] } as JsonObject);
    expect(result).toBe('a, b, c, ');
  });

  it('skips loop body when variable is not an array', () => {
    const result = renderTemplate('{% for item in items %}should not appear{% endfor %}', { items: 'not-array' } as JsonObject);
    expect(result).toBe('');
  });

  it('skips loop body when variable is undefined', () => {
    const result = renderTemplate('{% for item in items %}should not appear{% endfor %}', {} as JsonObject);
    expect(result).toBe('');
  });

  it('accesses loop variable fields inside body', () => {
    const result = renderTemplate('{% for alarm in alarms %}${alarm.name}: ${alarm.severity}\n{% endfor %}', {
      alarms: [
        { name: 'BGP_FLAP', severity: 'HIGH' },
        { name: 'LINK_DOWN', severity: 'CRITICAL' },
      ],
    } as JsonObject);
    expect(result).toBe('BGP_FLAP: HIGH\nLINK_DOWN: CRITICAL\n');
  });

  it('can access outer variables inside loop body', () => {
    const result = renderTemplate('{% for item in items %}${prefix}_${item} {% endfor %}', { prefix: 'NE', items: ['1', '2'] } as JsonObject);
    expect(result).toBe('NE_1 NE_2 ');
  });

  // --- if conditional ---

  it('renders {% if var %} block when variable is truthy', () => {
    const result = renderTemplate('{% if alarms %}Has alarms{% endif %}', { alarms: [{ name: 'A' }] } as JsonObject);
    expect(result).toBe('Has alarms');
  });

  it('skips {% if var %} block when variable is falsy (empty array)', () => {
    const result = renderTemplate('{% if alarms %}Has alarms{% endif %}', { alarms: [] } as JsonObject);
    expect(result).toBe('');
  });

  it('skips {% if var %} block when variable is falsy (empty object)', () => {
    const result = renderTemplate('{% if data %}Has data{% endif %}', { data: {} } as JsonObject);
    expect(result).toBe('');
  });

  it('skips {% if var %} block when variable is falsy (empty string)', () => {
    const result = renderTemplate('{% if name %}Has name{% endif %}', { name: '' } as JsonObject);
    expect(result).toBe('');
  });

  it('skips {% if var %} block when variable is falsy (0)', () => {
    const result = renderTemplate('{% if count %}Has count{% endif %}', { count: 0 } as JsonObject);
    expect(result).toBe('');
  });

  it('skips {% if var %} block when variable is undefined', () => {
    const result = renderTemplate('{% if missing %}Should not appear{% endif %}', {} as JsonObject);
    expect(result).toBe('');
  });

  it('skips {% if var %} block when variable is null', () => {
    const result = renderTemplate('{% if value %}Should not appear{% endif %}', { value: null } as JsonObject);
    expect(result).toBe('');
  });

  // --- Nested for/if ---

  it('supports if nested inside for', () => {
    const tpl = '{% for alarm in alarms %}{% if alarm.critical %}CRITICAL: ${alarm.name}\n{% endif %}{% endfor %}';
    const result = renderTemplate(tpl, {
      alarms: [
        { name: 'A', critical: true },
        { name: 'B', critical: false },
        { name: 'C', critical: true },
      ],
    } as JsonObject);
    expect(result).toBe('CRITICAL: A\nCRITICAL: C\n');
  });

  it('supports for nested inside if', () => {
    const tpl = '{% if has_alarms %}{% for alarm in alarms %}${alarm} {% endfor %}{% endif %}';
    const result = renderTemplate(tpl, { has_alarms: true, alarms: ['A', 'B'] } as JsonObject);
    expect(result).toBe('A B ');
  });

  it('supports deeply nested for-if-for', () => {
    const tpl = '{% for group in groups %}{% if group.active %}{% for item in group.items %}${item} {% endfor %}{% endif %}{% endfor %}';
    const result = renderTemplate(tpl, {
      groups: [
        { active: true, items: ['a', 'b'] },
        { active: false, items: ['c'] },
        { active: true, items: ['d'] },
      ],
    } as JsonObject);
    expect(result).toBe('a b d ');
  });

  // --- Safety limits ---

  it('throws TEMPLATE_LOOP_LIMIT_EXCEEDED when iterations exceed 10', () => {
    const items = Array.from({ length: 11 }, (_, i) => i);
    expect(() => renderTemplate('{% for item in items %}x{% endfor %}', { items } as JsonObject)).toThrow();
    try {
      renderTemplate('{% for item in items %}x{% endfor %}', { items } as JsonObject);
    } catch (error) {
      expect((error as Error).name).toBe('TEMPLATE_LOOP_LIMIT_EXCEEDED');
    }
  });

  it('throws TEMPLATE_UNCLOSED_BLOCK for unclosed {% for %}', () => {
    expect(() => renderTemplate('{% for item in items %}x', {} as JsonObject)).toThrow();
    try {
      renderTemplate('{% for item in items %}x', {} as JsonObject);
    } catch (error) {
      expect((error as Error).name).toBe('TEMPLATE_UNCLOSED_BLOCK');
    }
  });

  it('throws TEMPLATE_UNCLOSED_BLOCK for unclosed {% if %}', () => {
    expect(() => renderTemplate('{% if value %}x', {} as JsonObject)).toThrow();
    try {
      renderTemplate('{% if value %}x', {} as JsonObject);
    } catch (error) {
      expect((error as Error).name).toBe('TEMPLATE_UNCLOSED_BLOCK');
    }
  });

  it('throws TEMPLATE_SYNTAX_ERROR for unsupported tags', () => {
    expect(() => renderTemplate('{% unknown_tag %}', {} as JsonObject)).toThrow();
    try {
      renderTemplate('{% unknown_tag %}', {} as JsonObject);
    } catch (error) {
      expect((error as Error).name).toBe('TEMPLATE_SYNTAX_ERROR');
    }
  });

  // --- Plain text passthrough ---

  it('passes through plain text without modification', () => {
    const result = renderTemplate('Hello world, no variables here!', {} as JsonObject);
    expect(result).toBe('Hello world, no variables here!');
  });

  it('handles empty template', () => {
    const result = renderTemplate('', {} as JsonObject);
    expect(result).toBe('');
  });
});
