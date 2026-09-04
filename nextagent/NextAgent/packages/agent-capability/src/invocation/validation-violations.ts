import type { ErrorObject } from 'ajv';
import type { JsonObject } from '@nextagent/agent-common';
import { validateJsonSchema } from './schema-validation.js';

export interface CapabilityInputViolation {
  readonly path: string;
  readonly constraint: string;
  readonly expected: string;
}

/**
 * Collects every independently determinable schema violation for the input.
 * Violations are deduplicated by `path + constraint` and stably sorted by
 * `path`, then `constraint`. No rejected original value, additional property
 * name, regex text, file content, command, prompt, provider payload or host
 * path is written into any safe field.
 */
export function collectInputViolations(schema: JsonObject, value: unknown): readonly CapabilityInputViolation[] {
  const validation = validateJsonSchema(schema, value);
  if (validation.ok) {
    return [];
  }
  const violations: CapabilityInputViolation[] = [];
  for (const error of validation.errors) {
    const violation = formatViolation(error, schema, value);
    if (violation !== undefined) {
      violations.push(violation);
    }
  }
  return deduplicateAndSort(violations);
}

export function violationsToResultMessage(violations: readonly CapabilityInputViolation[]): string {
  const count = violations.length;
  if (count === 0) {
    return 'Input validation failed. Correct the listed constraints and call the capability again.';
  }
  return `Input validation failed for ${count} constraint${count === 1 ? '' : 's'}. Correct every listed field before calling the capability again.`;
}

function formatViolation(error: ErrorObject, schema: JsonObject, input: unknown): CapabilityInputViolation | undefined {
  if (belongsToUnselectedBranch(error, schema, input)) {
    return undefined;
  }
  const path = error.instancePath;
  switch (error.keyword) {
    case 'required': {
      const missingProperty = safePropertyName(error.params['missingProperty']);
      const targetPath = joinJsonPointer(path, missingProperty);
      return { path: targetPath, constraint: 'required', expected: `the required field "${missingProperty}" must be present` };
    }
    case 'type': {
      const expectedType = safeSchemaWord(error.params['type'], 'the declared type');
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
    case 'minProperties':
      return { path, constraint: 'minProperties', expected: `an object with at least ${safeLimit(error.params['limit'])} properties` };
    case 'maxProperties':
      return { path, constraint: 'maxProperties', expected: `an object with at most ${safeLimit(error.params['limit'])} properties` };
    case 'enum':
      return { path, constraint: 'enum', expected: 'one of the declared allowed values' };
    case 'const':
      return { path, constraint: 'const', expected: 'the declared required value' };
    case 'pattern':
    case 'format':
      return { path, constraint: error.keyword, expected: 'a value matching the declared format' };
    case 'additionalProperties': {
      const parentSchemaPath = error.schemaPath.slice(0, -'/additionalProperties'.length);
      const parentNode = schemaNodeAtSchema(schema, parentSchemaPath);
      const inputNode = valueAtPointer(input, error.instancePath);
      const allowedFields = collectAllowedFieldsForViolation(schema, parentSchemaPath, parentNode, inputNode);
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
    case 'dependentRequired':
    case 'dependentSchemas':
      return { path, constraint: error.keyword, expected: 'the object must satisfy the declared cross-field constraints' };
    default:
      return path.length === 0
        ? { path, constraint: error.keyword, expected: 'the input must satisfy the declared constraint' }
        : { path, constraint: error.keyword, expected: 'the field must satisfy the declared constraint' };
  }
}

function collectAllowedFields(node: unknown): readonly string[] {
  if (!isRecord(node) || !isRecord(node['properties'])) {
    return [];
  }
  return Object.keys(node['properties']).sort();
}

function collectAllowedFieldsForViolation(schema: JsonObject, parentSchemaPath: string, parentNode: unknown, inputNode: unknown): readonly string[] {
  const segments = branchSegments(`${parentSchemaPath}/additionalProperties`);
  if (segments.length === 0) {
    return collectAllowedFields(parentNode);
  }
  const { containerPath } = segments[segments.length - 1]!;
  const selected = selectedBranchAt(schema, containerPath, inputNode);
  if (selected !== undefined) {
    return collectAllowedFields(selected.branch);
  }
  const container = schemaNodeAtSchema(schema, containerPath);
  if (!isRecord(container)) {
    return collectAllowedFields(parentNode);
  }
  const branches =
    (Array.isArray(container['anyOf']) ? container['anyOf'] : undefined) ?? (Array.isArray(container['oneOf']) ? container['oneOf'] : undefined);
  if (!Array.isArray(branches)) {
    return collectAllowedFields(parentNode);
  }
  return [...new Set(branches.flatMap((branch) => collectAllowedFields(branch)))].sort();
}

/**
 * Determines whether an Ajv error belongs to an `anyOf`/`oneOf` branch that is
 * NOT the branch selected by the input value. Violations reported against a
 * non-selected branch are dropped so the model only sees diagnostics for the
 * schema branch whose preconditions are satisfied by the submitted input.
 *
 * The input node for branch comparison is the nearest enclosing object of the
 * error instance path (for a `/action` const error the object is the root),
 * so field-level errors inside an unselected branch are recognized.
 */
function belongsToUnselectedBranch(error: ErrorObject, schema: JsonObject, input: unknown): boolean {
  const instanceNode = enclosingObjectAt(input, error.instancePath);
  // Aggregate anyOf/oneOf errors carry no branch index; if a branch is
  // determinable from the input, the aggregate error is redundant noise.
  const aggregateContainerPath = branchContainerPath(error.schemaPath);
  if (aggregateContainerPath !== undefined) {
    return selectedBranchAt(schema, aggregateContainerPath, instanceNode) !== undefined;
  }
  for (const segment of branchSegments(error.schemaPath)) {
    const selected = selectedBranchAt(schema, segment.containerPath, instanceNode);
    if (selected !== undefined && selected.index !== segment.index) {
      return true;
    }
    if (selected === undefined && error.keyword !== 'additionalProperties') {
      return true;
    }
  }
  return false;
}

/**
 * Resolves the nearest enclosing object of an instance path. For `/action`,
 * the enclosing object is the root input; for `/filters/0/operator`, it is the
 * object at `/filters/0`. This lets field-level errors be attributed to the
 * branch whose constraints they violate.
 */
function enclosingObjectAt(input: unknown, instancePath: string): unknown {
  const segments = instancePath.split('/').slice(1);
  let current = input;
  const objectStack: unknown[] = [input];
  for (const rawSegment of segments) {
    if (typeof current !== 'object' || current === null) {
      break;
    }
    if (Array.isArray(current)) {
      const index = Number(rawSegment);
      if (!Number.isInteger(index)) {
        break;
      }
      current = current[index];
    } else {
      current = (current as Record<string, unknown>)[decodePointerSegment(rawSegment)];
    }
    objectStack.push(current);
  }
  for (let index = objectStack.length - 1; index >= 0; index -= 1) {
    if (isRecord(objectStack[index])) {
      return objectStack[index];
    }
  }
  return undefined;
}

interface SelectedBranch {
  readonly index: number;
  readonly branch: Record<string, unknown>;
}

function selectedBranchAt(schema: JsonObject, containerPath: string, inputNode: unknown): SelectedBranch | undefined {
  const container = schemaNodeAtSchema(schema, containerPath);
  if (!isRecord(container)) {
    return undefined;
  }
  const branches =
    (Array.isArray(container['anyOf']) ? container['anyOf'] : undefined) ?? (Array.isArray(container['oneOf']) ? container['oneOf'] : undefined);
  if (!Array.isArray(branches)) {
    return undefined;
  }
  const records = branches.flatMap((branch, index) => (isRecord(branch) ? [{ index, branch }] : []));
  if (!isRecord(inputNode)) {
    return undefined;
  }
  const discriminatorKeys = sharedDiscriminatorKeys(records);

  // A presented discriminator constrains the candidate set before required
  // fields or property overlap can break ties. Ambiguous evidence preserves
  // every alternative so diagnostics never invent a current branch.
  const recordsWithDiscriminatorEvidence = records.map((entry) => ({
    entry,
    evidence: discriminatorEvidence(entry.branch, inputNode, discriminatorKeys),
  }));
  const discriminatorMatches = recordsWithDiscriminatorEvidence
    .filter(({ evidence }) => evidence.hasMatch && !evidence.hasMismatch)
    .map(({ entry }) => entry);
  return discriminatorMatches.length === 1 ? discriminatorMatches[0] : undefined;
}

interface DiscriminatorEvidence {
  readonly hasPresented: boolean;
  readonly hasMatch: boolean;
  readonly hasMismatch: boolean;
}

function discriminatorEvidence(
  branch: Record<string, unknown>,
  inputNode: Record<string, unknown>,
  discriminatorKeys: ReadonlySet<string>,
): DiscriminatorEvidence {
  if (!isRecord(branch['properties'])) {
    return { hasPresented: false, hasMatch: false, hasMismatch: false };
  }
  let hasPresented = false;
  let hasMatch = false;
  let hasMismatch = false;
  for (const [key, property] of Object.entries(branch['properties'])) {
    if (!discriminatorKeys.has(key) || !isRecord(property) || !Object.prototype.hasOwnProperty.call(inputNode, key)) {
      continue;
    }
    const hasConst = Object.prototype.hasOwnProperty.call(property, 'const');
    const allowedValues = property['enum'];
    if (!hasConst && !Array.isArray(allowedValues)) {
      continue;
    }
    hasPresented = true;
    const matchesConst = !hasConst || inputNode[key] === property['const'];
    const matchesEnum = !Array.isArray(allowedValues) || allowedValues.includes(inputNode[key]);
    const matches = matchesConst && matchesEnum;
    hasMatch ||= matches;
    hasMismatch ||= !matches;
  }
  return { hasPresented, hasMatch, hasMismatch };
}

function sharedDiscriminatorKeys(branches: readonly SelectedBranch[]): ReadonlySet<string> {
  const signaturesByKey = new Map<string, Set<string>>();
  const constrainedBranchCount = new Map<string, number>();
  for (const { branch } of branches) {
    if (!isRecord(branch['properties'])) {
      continue;
    }
    for (const [key, property] of Object.entries(branch['properties'])) {
      if (!isRecord(property)) {
        continue;
      }
      const values = discriminatorValues(property);
      if (values === undefined) {
        continue;
      }
      constrainedBranchCount.set(key, (constrainedBranchCount.get(key) ?? 0) + 1);
      const signatures = signaturesByKey.get(key) ?? new Set<string>();
      signatures.add(
        values
          .map((value) => stableDiscriminatorValue(value))
          .sort()
          .join('|'),
      );
      signaturesByKey.set(key, signatures);
    }
  }
  return new Set(
    [...signaturesByKey.entries()]
      .filter(([key, signatures]) => (constrainedBranchCount.get(key) ?? 0) >= 2 && signatures.size >= 2)
      .map(([key]) => key),
  );
}

function discriminatorValues(property: Record<string, unknown>): readonly unknown[] | undefined {
  if (Object.prototype.hasOwnProperty.call(property, 'const')) {
    return [property['const']];
  }
  return Array.isArray(property['enum']) ? property['enum'] : undefined;
}

function stableDiscriminatorValue(value: unknown): string {
  return `${typeof value}:${JSON.stringify(value)}`;
}

function branchContainerPath(schemaPath: string): string | undefined {
  const segments = schemaPath.split('/').slice(1);
  const keyword = segments[segments.length - 1];
  if (keyword !== 'anyOf' && keyword !== 'oneOf') {
    return undefined;
  }
  const containerPath = segments.slice(0, -1).join('/');
  return containerPath === '' ? '#' : `#/${containerPath}`;
}

function branchSegments(schemaPath: string): ReadonlyArray<{ readonly containerPath: string; readonly index: number }> {
  const segments = schemaPath.split('/').slice(1);
  const result: Array<{ containerPath: string; index: number }> = [];
  for (let index = 0; index < segments.length - 1; index += 1) {
    const current = segments[index];
    if (current !== 'anyOf' && current !== 'oneOf') {
      continue;
    }
    const branchIndex = Number(segments[index + 1]);
    if (!Number.isInteger(branchIndex)) {
      continue;
    }
    const containerPath = segments.slice(0, index).join('/');
    result.push({ containerPath: containerPath === '' ? '#' : `#/${containerPath}`, index: branchIndex });
  }
  return result;
}

function schemaNodeAtSchema(schema: JsonObject, schemaPath: string): unknown {
  const segments = schemaPath.split('/').slice(1);
  let current: unknown = schema;
  for (const segment of segments) {
    if (typeof current !== 'object' || current === null) {
      return undefined;
    }
    if (Array.isArray(current)) {
      const index = Number(segment);
      if (!Number.isInteger(index)) {
        return undefined;
      }
      current = current[index];
      continue;
    }
    const record = current as Record<string, unknown>;
    current = record[decodePointerSegment(segment)];
  }
  return current;
}

function deduplicateAndSort(violations: readonly CapabilityInputViolation[]): readonly CapabilityInputViolation[] {
  const unique: CapabilityInputViolation[] = [];
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

function valueAtPointer(input: unknown, pointer: string): unknown {
  let current = input;
  for (const rawSegment of pointer.split('/').slice(1)) {
    if (typeof current !== 'object' || current === null) {
      return undefined;
    }
    const segment = decodePointerSegment(rawSegment);
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

function joinJsonPointer(path: string, property: string): string {
  return `${path}/${encodePointerSegment(property)}`;
}

function encodePointerSegment(value: string): string {
  return value.replaceAll('~', '~0').replaceAll('/', '~1');
}

function decodePointerSegment(value: string): string {
  return value.replaceAll('~1', '/').replaceAll('~0', '~');
}

function safePropertyName(value: unknown): string {
  return typeof value === 'string' ? value : 'field';
}

function safeSchemaWord(value: unknown, fallback: string): string {
  return typeof value === 'string' && /^[a-z]{1,24}$/u.test(value) ? value : fallback;
}

function safeLimit(value: unknown): string {
  return typeof value === 'number' && Number.isFinite(value) ? String(value) : 'the declared limit';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
