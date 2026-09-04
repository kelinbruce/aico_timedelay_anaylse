import { describe, expect, it } from 'vitest';
import { expandStdoutJsonFields, formatOutputValues, resolvePythonResult, reservedPythonResultKeys } from '../src/nodes/shared.js';
import type { JsonObject } from '@nextagent/agent-common';

// --- Fix 4: expandStdoutJsonFields array + multi-line support ---

describe('expandStdoutJsonFields', () => {
  const basePayload = (stdout: string): JsonObject => ({ exit_code: 0, stdout, stderr: '', timed_out: false });

  it('expands JSON object fields (original behavior)', () => {
    const payload = expandStdoutJsonFields(basePayload('{"name":"test","count":5}'));
    expect(payload).toMatchObject({ name: 'test', count: 5 });
  });

  it('expands JSON array with numeric string keys', () => {
    const payload = expandStdoutJsonFields(basePayload('[{"a":1},{"b":2}]'));
    expect(payload['0']).toEqual({ a: 1 });
    expect(payload['1']).toEqual({ b: 2 });
  });

  it('returns payload as-is for JSON null', () => {
    const payload = expandStdoutJsonFields(basePayload('null'));
    expect(payload).not.toHaveProperty('0');
  });

  it('returns payload as-is for JSON primitive', () => {
    const payload = expandStdoutJsonFields(basePayload('42'));
    expect(payload).not.toHaveProperty('0');
  });

  it('expands multi-line mixed text with numeric keys', () => {
    const payload = expandStdoutJsonFields(basePayload('hello\n{"a":1}'));
    expect(payload['0']).toBe('hello');
    expect(payload['1']).toEqual({ a: 1 });
  });

  it('skips empty lines in multi-line stdout', () => {
    const payload = expandStdoutJsonFields(basePayload('hello\n\nworld'));
    expect(payload['0']).toBe('hello');
    expect(payload['2']).toBe('world');
    expect(payload).not.toHaveProperty('1');
  });

  it('returns payload when single-line non-JSON parse fails', () => {
    const payload = expandStdoutJsonFields(basePayload('just plain text'));
    expect(payload).not.toHaveProperty('0');
  });

  it('never overwrites reserved keys', () => {
    const payload = expandStdoutJsonFields(basePayload('{"exit_code":999,"custom":1}'));
    expect(payload.exit_code).toBe(0);
    expect(payload.custom).toBe(1);
  });
});

// --- Fix 8: reservedPythonResultKeys export (metadata stripping foundation) ---

describe('reservedPythonResultKeys', () => {
  it('contains the standard Python result metadata keys', () => {
    expect(reservedPythonResultKeys.has('exit_code')).toBe(true);
    expect(reservedPythonResultKeys.has('stdout')).toBe(true);
    expect(reservedPythonResultKeys.has('stderr')).toBe(true);
    expect(reservedPythonResultKeys.has('timed_out')).toBe(true);
    expect(reservedPythonResultKeys.has('_trace')).toBe(true);
  });

  it('does not contain numeric string keys', () => {
    expect(reservedPythonResultKeys.has('0')).toBe(false);
    expect(reservedPythonResultKeys.has('1')).toBe(false);
  });
});

// --- Fix 8: formatOutputValues ---

describe('formatOutputValues', () => {
  it('returns empty string for empty object', () => {
    expect(formatOutputValues({})).toBe('');
  });

  it('returns single string value directly', () => {
    expect(formatOutputValues({ msg: 'hello' })).toBe('hello');
  });

  it('returns single number as string', () => {
    expect(formatOutputValues({ count: 42 })).toBe('42');
  });

  it('returns single boolean as string', () => {
    expect(formatOutputValues({ active: true })).toBe('true');
  });

  it('joins multiple string values with newline', () => {
    expect(formatOutputValues({ a: 'hello', b: 'world' })).toBe('hello\nworld');
  });

  it('stringifies object values with JSON.stringify', () => {
    expect(formatOutputValues({ data: { x: 1 } })).toBe('{"x":1}');
  });

  it('mixed types: strings and numbers joined with newline', () => {
    expect(formatOutputValues({ result: 'hidden data', result2: '\u4f60\u597d', result3: '\u7ed3\u675f' })).toBe(
      'hidden data\n\u4f60\u597d\n\u7ed3\u675f',
    );
  });
});

// --- resolvePythonResult: whole-stdout JSON parse priority ---

describe('resolvePythonResult', () => {
  const basePayload = (stdout: string): JsonObject => ({ exit_code: 0, stdout, stderr: '', timed_out: false });

  it('parses entire stdout as JSON array with newline-containing string values', () => {
    const formattedText = '###Document0\n{"知识ID":"123"}\n\n';
    const content = { piuName: 'AICOPIU', data: [1, 2] };
    const stdout = JSON.stringify([formattedText, content]);
    const result = resolvePythonResult(basePayload(stdout));
    expect(result).toEqual([formattedText, content]);
    expect((result as unknown[])[0]).toBe(formattedText);
  });

  it('parses entire stdout as JSON object', () => {
    const result = resolvePythonResult(basePayload('{"name":"test","count":5}'));
    expect(result).toEqual({ name: 'test', count: 5 });
  });

  it('falls back to line-by-line parsing for multi-line non-JSON stdout', () => {
    const result = resolvePythonResult(basePayload('hello\nworld'));
    expect(result).toEqual(['hello', 'world']);
  });

  it('falls back to line-by-line parsing for mixed JSON lines', () => {
    const result = resolvePythonResult(basePayload('{"a":1}\n{"b":2}'));
    expect(result).toEqual([{ a: 1 }, { b: 2 }]);
  });

  it('returns null for empty stdout', () => {
    expect(resolvePythonResult(basePayload(''))).toBeNull();
  });

  it('returns single parsed value for one-line JSON stdout', () => {
    const result = resolvePythonResult(basePayload('"hello"'));
    expect(result).toBe('hello');
  });

  it('returns plain string for non-JSON single-line stdout', () => {
    const result = resolvePythonResult(basePayload('just plain text'));
    expect(result).toBe('just plain text');
  });
});
