import type { ErrorObject } from 'ajv';
import type { JsonObject } from '@nextagent/agent-common';

export interface AskUserQuestionViolation {
  readonly path: string;
  readonly constraint: string;
  readonly expected: string;
}

/**
 * Collects every independently determinable AskUserQuestion input violation in
 * the unified `{path,constraint,expected}` shape. The shape matches the
 * capability violations formatter so the pre-invocation producer reuses the
 * same safe diagnostic contract without its own parallel error structure.
 * No rejected original value, prompt, option label/value, placeholder or
 * forbidden purpose text is written into any safe field.
 */
export function collectAskUserQuestionViolations(errors: readonly ErrorObject[], schema: JsonObject): readonly AskUserQuestionViolation[] {
  const violations: AskUserQuestionViolation[] = [];
  for (const error of errors) {
    const violation = formatValidationViolation(error, schema);
    if (violation !== undefined) {
      violations.push(violation);
    }
  }
  return deduplicateAndSort(violations);
}

export function violationsToAskUserQuestionMessage(violations: readonly AskUserQuestionViolation[]): string {
  const count = violations.length;
  return `AskUserQuestion input validation failed for ${count} constraint${count === 1 ? '' : 's'}.`;
}

function formatValidationViolation(error: ErrorObject, schema: JsonObject): AskUserQuestionViolation | undefined {
  const path = error.instancePath;
  switch (error.keyword) {
    case 'required': {
      const missingProperty = safePropertyName(error.params['missingProperty']);
      return {
        path: joinPointer(path, missingProperty),
        constraint: 'required',
        expected: `the required field "${missingProperty}" must be present`,
      };
    }
    case 'type': {
      const expectedType = safeSchemaWord(error.params['type'], 'the declared type');
      if (path === '/questions' && expectedType === 'array') {
        return { path, constraint: 'type', expected: 'a native JSON array, not a JSON-encoded string' };
      }
      return { path, constraint: 'type', expected: `a ${expectedType}` };
    }
    case 'minimum':
    case 'exclusiveMinimum':
      return { path, constraint: error.keyword, expected: `a number no less than ${safeLimit(error.params['limit'])}` };
    case 'maximum':
    case 'exclusiveMaximum':
      return { path, constraint: error.keyword, expected: `a number no greater than ${safeLimit(error.params['limit'])}` };
    case 'minLength':
      return { path, constraint: 'minLength', expected: `a string of at least ${safeLimit(error.params['limit'])} characters` };
    case 'maxLength':
      return { path, constraint: 'maxLength', expected: `a string of at most ${safeLimit(error.params['limit'])} characters` };
    case 'minItems':
      return { path, constraint: 'minItems', expected: `an array of at least ${safeLimit(error.params['limit'])} items` };
    case 'maxItems':
      return { path, constraint: 'maxItems', expected: `an array of at most ${safeLimit(error.params['limit'])} items` };
    case 'enum':
      return { path, constraint: 'enum', expected: 'one of the declared allowed values' };
    case 'const':
      return { path, constraint: 'const', expected: 'the declared required value' };
    case 'pattern':
    case 'format':
      return { path, constraint: error.keyword, expected: 'a value matching the declared format' };
    case 'additionalProperties': {
      const allowedFields = collectAllowedFields(error, schema);
      const expected =
        allowedFields.length === 0
          ? 'this object allows no additional properties'
          : `only ${allowedFields.map((field) => `"${field}"`).join(', ')} are allowed`;
      return { path, constraint: 'additionalProperties', expected };
    }
    case 'if':
    case 'then':
    case 'else':
    case 'oneOf':
    case 'anyOf':
    case 'not':
      return { path, constraint: error.keyword, expected: 'the object must satisfy the declared cross-field constraints' };
    default:
      return path.length === 0
        ? { path, constraint: error.keyword, expected: 'the input must satisfy the declared constraint' }
        : { path, constraint: error.keyword, expected: 'the field must satisfy the declared constraint' };
  }
}

function collectAllowedFields(error: ErrorObject, schema: JsonObject): readonly string[] {
  const parentSchemaPath = error.schemaPath.slice(0, -'/additionalProperties'.length);
  const parent = schemaNodeAtPath(schema, parentSchemaPath);
  if (parent === null || typeof parent !== 'object' || Array.isArray(parent)) {
    return [];
  }
  const properties = (parent as Record<string, unknown>)['properties'];
  return properties === null || typeof properties !== 'object' || Array.isArray(properties) ? [] : Object.keys(properties);
}

function deduplicateAndSort(violations: readonly AskUserQuestionViolation[]): readonly AskUserQuestionViolation[] {
  const unique: AskUserQuestionViolation[] = [];
  const seen = new Set<string>();
  for (const violation of violations) {
    const key = `${violation.path}\u0000${violation.constraint}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    unique.push(violation);
  }
  return unique.sort((left, right) => {
    if (left.path !== right.path) {
      return left.path < right.path ? -1 : 1;
    }
    return left.constraint < right.constraint ? -1 : left.constraint > right.constraint ? 1 : 0;
  });
}

function joinPointer(path: string, property: string): string {
  return `${path}/${encodePointerSegment(property)}`;
}

function encodePointerSegment(value: string): string {
  return value.replaceAll('~', '~0').replaceAll('/', '~1');
}

function safePropertyName(value: unknown): string {
  return typeof value === 'string' && /^[A-Za-z0-9_.-]{1,128}$/u.test(value) && !/(?:authorization|credential|password|secret|token)/iu.test(value)
    ? value
    : 'field';
}

function safeSchemaWord(value: unknown, fallback: string): string {
  return typeof value === 'string' && /^[a-z]{1,24}$/u.test(value) ? value : fallback;
}

function safeLimit(value: unknown): string {
  return typeof value === 'number' && Number.isFinite(value) ? String(value) : 'the declared limit';
}

function schemaNodeAtPath(schema: JsonObject, pointer: string): unknown {
  let current: unknown = schema;
  for (const rawSegment of pointer
    .replace(/^#\/?/u, '')
    .split('/')
    .filter((segment) => segment.length > 0)) {
    if (typeof current !== 'object' || current === null) {
      return undefined;
    }
    const segment = rawSegment.replaceAll('~1', '/').replaceAll('~0', '~');
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}
