import { describe, expect, it } from 'vitest';

import { collectInputViolations, violationsToResultMessage } from '../src/invocation/validation-violations.js';

const searchSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['query', 'limit'],
  properties: {
    query: { type: 'string', minLength: 1 },
    limit: { type: 'integer', minimum: 1, maximum: 100 },
    filters: {
      type: 'array',
      maxItems: 3,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['field'],
        properties: {
          field: { type: 'string' },
          operator: { type: 'string', enum: ['eq', 'neq'] },
          value: { type: 'string' },
        },
      },
    },
  },
};

describe('collectInputViolations', () => {
  it('returns every independent schema violation for the same input', () => {
    const violations = collectInputViolations(searchSchema, {
      limit: 101,
      extra: true,
    });

    expect(violations).toEqual([
      { path: '', constraint: 'additionalProperties', expected: 'only "filters", "limit", "query" are allowed' },
      { path: '/limit', constraint: 'maximum', expected: 'a number no greater than 100' },
      { path: '/query', constraint: 'required', expected: 'the required field "query" must be present' },
    ]);
  });

  it('points required violations to the missing declared field', () => {
    const violations = collectInputViolations(searchSchema, { query: 'x' });

    expect(violations).toEqual([{ path: '/limit', constraint: 'required', expected: 'the required field "limit" must be present' }]);
  });

  it('preserves trusted schema field names that contain credential or token words', () => {
    const violations = collectInputViolations(
      {
        type: 'object',
        required: ['credentialRef', 'tokenCount'],
        properties: {
          credentialRef: { type: 'string' },
          tokenCount: { type: 'integer' },
        },
      },
      {},
    );

    expect(violations).toEqual([
      { path: '/credentialRef', constraint: 'required', expected: 'the required field "credentialRef" must be present' },
      { path: '/tokenCount', constraint: 'required', expected: 'the required field "tokenCount" must be present' },
    ]);
  });

  it('encodes every trusted declared field name exactly as a JSON Pointer segment', () => {
    const violations = collectInputViolations(
      {
        type: 'object',
        required: ['network/id', 'site~code'],
        properties: {
          'network/id': { type: 'string' },
          'site~code': { type: 'string' },
        },
      },
      {},
    );

    expect(violations).toEqual([
      { path: '/network~1id', constraint: 'required', expected: 'the required field "network/id" must be present' },
      { path: '/site~0code', constraint: 'required', expected: 'the required field "site~code" must be present' },
    ]);
  });

  it('preserves array indices in field paths', () => {
    const violations = collectInputViolations(searchSchema, { query: 'x', limit: 1, filters: [{ field: 'a', operator: 'unsupported' }] });

    expect(violations).toEqual([{ path: '/filters/0/operator', constraint: 'enum', expected: 'one of the declared allowed values' }]);
  });

  it('points nested additional-property violations to the nearest legal parent and lists allowed fields', () => {
    const violations = collectInputViolations(searchSchema, { query: 'x', limit: 1, filters: [{ unknownField: 1 }] });

    expect(violations).toEqual([
      { path: '/filters/0', constraint: 'additionalProperties', expected: 'only "field", "operator", "value" are allowed' },
      { path: '/filters/0/field', constraint: 'required', expected: 'the required field "field" must be present' },
    ]);
  });

  it('deduplicates by path and constraint and sorts stably', () => {
    const violations = collectInputViolations(
      {
        type: 'object',
        additionalProperties: false,
        required: ['query'],
        allOf: [{ required: ['query'] }],
        properties: { query: { type: 'string' } },
      },
      {},
    );

    expect(violations).toEqual([{ path: '/query', constraint: 'required', expected: 'the required field "query" must be present' }]);
  });

  it('does not guess an anyOf branch from property overlap and uses the sorted field union', () => {
    const schema = {
      type: 'object',
      anyOf: [
        {
          type: 'object',
          additionalProperties: false,
          properties: { alpha: { type: 'string' }, beta: { type: 'string' } },
        },
        {
          type: 'object',
          additionalProperties: false,
          properties: { gamma: { type: 'string' }, delta: { type: 'string' } },
        },
      ],
    };

    const violations = collectInputViolations(schema, { alpha: 'x', unknownField: 1 });

    const additionalPropertyViolations = violations.filter((violation) => violation.constraint === 'additionalProperties');
    expect(additionalPropertyViolations.length).toBeGreaterThan(0);
    for (const violation of additionalPropertyViolations) {
      expect(violation.expected).toBe('only "alpha", "beta", "delta", "gamma" are allowed');
    }
    expect(violations).toContainEqual({
      path: '',
      constraint: 'anyOf',
      expected: 'the object must satisfy the declared cross-field constraints',
    });
  });

  it('selects a oneOf branch by a shared discriminator const and filters unselected branch diagnostics', () => {
    const schema = {
      type: 'object',
      additionalProperties: false,
      required: ['action'],
      properties: {
        action: { enum: ['create', 'list', 'delete'] },
        cron: { type: 'string' },
        delay: { type: 'object' },
        prompt: { type: 'string' },
        id: { type: 'string' },
      },
      oneOf: [
        {
          type: 'object',
          additionalProperties: false,
          required: ['action', 'cron', 'prompt'],
          properties: { action: { const: 'create' }, cron: { type: 'string' }, prompt: { type: 'string' } },
        },
        {
          type: 'object',
          additionalProperties: false,
          required: ['action', 'delay', 'prompt'],
          properties: { action: { const: 'create' }, delay: { type: 'object' }, prompt: { type: 'string' } },
        },
        {
          type: 'object',
          additionalProperties: false,
          required: ['action', 'id'],
          properties: { action: { const: 'delete' }, id: { type: 'string' } },
        },
      ],
    };

    const violations = collectInputViolations(schema, { action: 'delete', id: 'x', unknownField: 1 });

    const additionalPropertyViolations = violations.filter((violation) => violation.constraint === 'additionalProperties');
    expect(additionalPropertyViolations.length).toBeGreaterThan(0);
    for (const violation of additionalPropertyViolations) {
      expect(violation.expected).toContain('"action"');
      expect(violation.expected).toContain('"id"');
      expect(violation.expected).not.toContain('"cron"');
      expect(violation.expected).not.toContain('"delay"');
    }
    // No required-violation for cron/prompt/delay from the unselected create branches.
    const requiredViolations = violations.filter((violation) => violation.constraint === 'required');
    expect(requiredViolations.map((violation) => violation.path)).toEqual([]);
  });

  it('selects the second discriminated branch when the input uses the second branch const', () => {
    const schema = {
      type: 'object',
      oneOf: [
        {
          type: 'object',
          additionalProperties: false,
          properties: { kind: { const: 'a' }, alpha: { type: 'string' } },
        },
        {
          type: 'object',
          additionalProperties: false,
          properties: { kind: { const: 'b' }, beta: { type: 'string' } },
        },
      ],
    };

    const violations = collectInputViolations(schema, { kind: 'b', unknownField: 1 });

    const additionalPropertyViolations = violations.filter((violation) => violation.constraint === 'additionalProperties');
    expect(additionalPropertyViolations.length).toBeGreaterThan(0);
    for (const violation of additionalPropertyViolations) {
      expect(violation.expected).toContain('"kind"');
      expect(violation.expected).toContain('"beta"');
      expect(violation.expected).not.toContain('"alpha"');
    }
  });

  it('does not treat a branch-local const as a shared discriminator or expose branch-local errors', () => {
    const schema = {
      type: 'object',
      oneOf: [
        {
          type: 'object',
          additionalProperties: false,
          required: ['action', 'cron', 'prompt'],
          properties: {
            action: { const: 'create' },
            cron: { type: 'string' },
            prompt: { type: 'string' },
            recurring: { type: 'boolean' },
          },
        },
        {
          type: 'object',
          additionalProperties: false,
          required: ['action', 'delay', 'prompt'],
          properties: {
            action: { const: 'create' },
            delay: { type: 'object' },
            prompt: { type: 'string' },
            recurring: { const: false },
          },
        },
        {
          type: 'object',
          additionalProperties: false,
          required: ['action'],
          properties: { action: { const: 'list' } },
        },
      ],
    };

    const violations = collectInputViolations(schema, {
      action: 'create',
      delay: { minutes: 5 },
      prompt: 'check alarms',
      recurring: true,
    });

    expect(violations).toEqual([
      {
        path: '',
        constraint: 'additionalProperties',
        expected: 'only "action", "cron", "delay", "prompt", "recurring" are allowed',
      },
      { path: '', constraint: 'oneOf', expected: 'the object must satisfy the declared cross-field constraints' },
    ]);
  });

  it('preserves every alternative when the input does not establish a branch', () => {
    const schema = {
      type: 'object',
      anyOf: [
        {
          type: 'object',
          additionalProperties: false,
          required: ['email'],
          properties: { email: { type: 'string' } },
        },
        {
          type: 'object',
          additionalProperties: false,
          required: ['phone'],
          properties: { phone: { type: 'string' } },
        },
      ],
    };

    const violations = collectInputViolations(schema, { unknownField: 1 });

    expect(violations).toEqual([
      { path: '', constraint: 'additionalProperties', expected: 'only "email", "phone" are allowed' },
      { path: '', constraint: 'anyOf', expected: 'the object must satisfy the declared cross-field constraints' },
    ]);
  });

  it('gives a matching discriminator precedence over required fields from another branch', () => {
    const schema = {
      type: 'object',
      oneOf: [
        {
          type: 'object',
          additionalProperties: false,
          required: ['kind', 'alpha'],
          properties: { kind: { const: 'a' }, alpha: { type: 'string' } },
        },
        {
          type: 'object',
          additionalProperties: false,
          required: ['kind', 'beta'],
          properties: { kind: { const: 'b' }, beta: { type: 'string' } },
        },
      ],
    };

    const violations = collectInputViolations(schema, { kind: 'b', alpha: 'x', unknownField: 1 });

    expect(violations).toEqual([
      { path: '', constraint: 'additionalProperties', expected: 'only "beta", "kind" are allowed' },
      { path: '/beta', constraint: 'required', expected: 'the required field "beta" must be present' },
    ]);
  });

  it('does not echo the rejected original value, additional property name, regex text, or path', () => {
    const schema = {
      type: 'object',
      additionalProperties: false,
      properties: {
        pattern: { type: 'string', pattern: '^[a-z]+$' },
        secret: { type: 'string' },
      },
    };
    const canary = 'RAW_SECRET_VALUE_987654321';
    const violations = collectInputViolations(schema, { pattern: 'ABC', unexpected: canary, secret: canary });

    const serialized = JSON.stringify(violations);
    expect(serialized).not.toContain(canary);
    expect(serialized).not.toContain('unexpected');
    expect(serialized).not.toContain('^[a-z]+$');
  });

  it('returns no violations for valid input', () => {
    expect(collectInputViolations(searchSchema, { query: 'BGP', limit: 20 })).toEqual([]);
  });
});

describe('violationsToResultMessage', () => {
  it('reports the failure stage and the number of constraints', () => {
    const message = violationsToResultMessage([{ path: '/query', constraint: 'minLength', expected: 'a non-empty string' }]);
    expect(message).toBe('Input validation failed for 1 constraint. Correct every listed field before calling the capability again.');
  });

  it('reports plural constraint counts', () => {
    const message = violationsToResultMessage([
      { path: '/query', constraint: 'minLength', expected: 'a non-empty string' },
      { path: '/limit', constraint: 'maximum', expected: 'a number no greater than 100' },
    ]);
    expect(message).toBe('Input validation failed for 2 constraints. Correct every listed field before calling the capability again.');
  });
});
