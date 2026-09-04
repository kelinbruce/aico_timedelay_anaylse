import { todoWriteInputSchema, todoWriteOutputSchema, validateJson } from '@nextagent/agent-capability';
import { describe, expect, it } from 'vitest';

describe('TodoWrite schemas', () => {
  it('accepts a bounded full-list input and safe output', () => {
    const todo = { content: 'Inspect AMF alarm', activeForm: 'Inspecting AMF alarm', status: 'in_progress' };

    expect(validateJson(todoWriteInputSchema, { todos: [todo] })).toBe(true);
    expect(validateJson(todoWriteInputSchema, { todos: [] })).toBe(true);
    expect(validateJson(todoWriteOutputSchema, { oldTodos: [], newTodos: [todo] })).toBe(true);
  });

  it('rejects invalid item shape, scope override fields, and budget violations', () => {
    const valid = { content: 'Inspect AMF alarm', activeForm: 'Inspecting AMF alarm', status: 'pending' };
    const longText = 'x'.repeat(501);

    expect(validateJson(todoWriteInputSchema, { todos: [{ ...valid, status: 'running' }] })).toBe(false);
    expect(validateJson(todoWriteInputSchema, { todos: [{ ...valid, content: '' }] })).toBe(false);
    expect(validateJson(todoWriteInputSchema, { todos: [{ ...valid, activeForm: longText }] })).toBe(false);
    expect(validateJson(todoWriteInputSchema, { todos: Array.from({ length: 101 }, () => valid) })).toBe(false);
    expect(validateJson(todoWriteInputSchema, { todos: [valid], sessionId: 'attacker-session' })).toBe(false);
    expect(validateJson(todoWriteInputSchema, { todos: [{ ...valid, owner: 'attacker-owner' }] })).toBe(false);
  });
});
