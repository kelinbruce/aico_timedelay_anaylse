import type { SystemIntegrationCaseDefinition, SystemIntegrationCaseId, SystemIntegrationLayer, SystemIntegrationOrigin } from '../case-manifest.js';
import type { ExecutionResult, FailurePhase, NormalizedExecutionResult } from './reporter.js';

export interface SystemIntegrationCaseResult {
  readonly caseId: SystemIntegrationCaseId;
  readonly layer: SystemIntegrationLayer;
  readonly originKind: SystemIntegrationOrigin;
  readonly sourceCaseRef: string;
  readonly ownerGate: 'testclaw-system-integration';
  readonly result: ExecutionResult;
  readonly failurePhase: FailurePhase | null;
  readonly evidenceRefs: readonly string[];
}

export interface SystemIntegrationReport {
  readonly schemaVersion: 1;
  readonly checkId: 'system-integration';
  readonly runId: string;
  readonly status: ExecutionResult;
  readonly layers: {
    readonly INTEGRATION: ExecutionResult;
    readonly E2E: ExecutionResult;
  };
  readonly cases: readonly SystemIntegrationCaseResult[];
}

const statusPriority: readonly ExecutionResult[] = ['FAILED', 'TIMEOUT', 'UNAVAILABLE', 'MISSING', 'PASSED'];
const reportKeys = ['schemaVersion', 'checkId', 'runId', 'status', 'layers', 'cases'] as const;
const layerKeys = ['INTEGRATION', 'E2E'] as const;
const caseResultKeys = ['caseId', 'layer', 'originKind', 'sourceCaseRef', 'ownerGate', 'result', 'failurePhase', 'evidenceRefs'] as const;
const failurePhases: readonly FailurePhase[] = ['manifest', 'preflight', 'setup', 'execute', 'assert', 'evidence', 'cleanup'];

export function buildSystemIntegrationReport(input: {
  readonly runId: string;
  readonly definitions: readonly SystemIntegrationCaseDefinition[];
  readonly executionResults: readonly NormalizedExecutionResult[];
}): SystemIntegrationReport {
  validateRunId(input.runId);
  const definitionRefs = new Set(input.definitions.map((entry) => entry.executionRef));
  const resultByRef = new Map<string, NormalizedExecutionResult>();

  for (const result of input.executionResults) {
    if (!definitionRefs.has(result.executionRef)) {
      throw new Error(`unknown executionRef: ${result.executionRef}`);
    }
    if (resultByRef.has(result.executionRef)) {
      throw new Error(`duplicate executionRef: ${result.executionRef}`);
    }
    validateNormalizedResult(result);
    resultByRef.set(result.executionRef, result);
  }

  const cases = input.definitions.map((definition): SystemIntegrationCaseResult => {
    const execution =
      resultByRef.get(definition.executionRef) ??
      ({
        executionRef: definition.executionRef,
        result: 'MISSING',
        failurePhase: 'execute',
        evidenceRefs: ['runner:missing'],
      } satisfies NormalizedExecutionResult);
    return Object.freeze({
      caseId: definition.caseId,
      layer: definition.layer,
      originKind: definition.originKind,
      sourceCaseRef: definition.sourceCaseRef,
      ownerGate: definition.ownerGate,
      result: execution.result,
      failurePhase: execution.failurePhase,
      evidenceRefs: Object.freeze([...execution.evidenceRefs]),
    });
  });

  const report: SystemIntegrationReport = Object.freeze({
    schemaVersion: 1,
    checkId: 'system-integration',
    runId: input.runId,
    status: selectStatus(cases.map((entry) => entry.result)),
    layers: Object.freeze({
      INTEGRATION: selectStatus(cases.filter((entry) => entry.layer === 'INTEGRATION').map((entry) => entry.result)),
      E2E: selectStatus(cases.filter((entry) => entry.layer === 'E2E').map((entry) => entry.result)),
    }),
    cases: Object.freeze(cases),
  });
  return validateSystemIntegrationReport(report);
}

export function validateSystemIntegrationReport(input: unknown): SystemIntegrationReport {
  if (!isObject(input) || !hasExactKeys(input, reportKeys)) {
    throw new Error('invalid system integration report shape');
  }
  if (input.schemaVersion !== 1 || input.checkId !== 'system-integration') {
    throw new Error('invalid system integration report identity');
  }
  validateRunId(input.runId);
  if (!isResult(input.status)) {
    throw new Error('invalid system integration status');
  }
  if (!isObject(input.layers) || !hasExactKeys(input.layers, layerKeys) || !isResult(input.layers.INTEGRATION) || !isResult(input.layers.E2E)) {
    throw new Error('invalid system integration layers');
  }
  if (!Array.isArray(input.cases) || input.cases.length !== 122) {
    throw new Error('system integration report must contain exactly 122 cases');
  }

  const cases = input.cases.map((entry, index) => validateCaseResult(entry, index));
  if (cases.filter((entry) => entry.layer === 'INTEGRATION').length !== 3 || cases.filter((entry) => entry.layer === 'E2E').length !== 119) {
    throw new Error('invalid system integration layer counts');
  }
  const integrationStatus = selectStatus(cases.filter((entry) => entry.layer === 'INTEGRATION').map((entry) => entry.result));
  const e2eStatus = selectStatus(cases.filter((entry) => entry.layer === 'E2E').map((entry) => entry.result));
  const totalStatus = selectStatus(cases.map((entry) => entry.result));
  if (input.layers.INTEGRATION !== integrationStatus || input.layers.E2E !== e2eStatus || input.status !== totalStatus) {
    throw new Error('system integration verdict does not match case results');
  }
  return input as unknown as SystemIntegrationReport;
}

function validateCaseResult(input: unknown, index: number): SystemIntegrationCaseResult {
  if (!isObject(input) || !hasExactKeys(input, caseResultKeys)) {
    throw new Error(`invalid case result shape at index ${index}`);
  }
  const expectedId = `TC-SI-${String(index + 1).padStart(3, '0')}`;
  if (input.caseId !== expectedId) {
    throw new Error(`expected ${expectedId} in report`);
  }
  const expectedLayer = index >= 111 && index <= 113 ? 'INTEGRATION' : 'E2E';
  if (input.layer !== expectedLayer) {
    throw new Error(`invalid layer for ${expectedId}`);
  }
  if (
    !isOrigin(input.originKind) ||
    typeof input.sourceCaseRef !== 'string' ||
    input.sourceCaseRef.length === 0 ||
    input.ownerGate !== 'testclaw-system-integration' ||
    !isResult(input.result)
  ) {
    throw new Error(`invalid result metadata for ${expectedId}`);
  }
  validateResultSemantics(input.result, input.failurePhase, input.evidenceRefs, expectedId);
  return input as unknown as SystemIntegrationCaseResult;
}

function validateNormalizedResult(input: NormalizedExecutionResult): void {
  if (!isResult(input.result)) {
    throw new Error('invalid normalized result');
  }
  validateResultSemantics(input.result, input.failurePhase, input.evidenceRefs, input.executionRef);
}

function validateResultSemantics(result: ExecutionResult, failurePhase: unknown, evidenceRefs: unknown, identity: string): void {
  if (result === 'PASSED' && failurePhase !== null) {
    throw new Error('PASSED result must not have a failure phase');
  }
  if (result !== 'PASSED' && (typeof failurePhase !== 'string' || !failurePhases.includes(failurePhase as FailurePhase))) {
    throw new Error(`non-passing result must have a safe failure phase: ${identity}`);
  }
  if (!Array.isArray(evidenceRefs) || evidenceRefs.length === 0) {
    throw new Error(`result must have evidence refs: ${identity}`);
  }
  for (const evidenceRef of evidenceRefs) {
    if (!isSafeEvidenceRef(evidenceRef)) {
      throw new Error(`unsafe evidence ref: ${identity}`);
    }
  }
}

function isSafeEvidenceRef(value: unknown): value is string {
  if (
    typeof value !== 'string' ||
    !/^[A-Za-z0-9][A-Za-z0-9._:/-]*$/.test(value) ||
    /^[A-Za-z]:[\\/]/.test(value) ||
    value.startsWith('/') ||
    /^[a-z][a-z0-9+.-]*:\/\//i.test(value)
  ) {
    return false;
  }
  return !value.split(/[\\/]/).includes('..');
}

function validateRunId(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(value)) {
    throw new Error('invalid system integration runId');
  }
}

function selectStatus(results: readonly ExecutionResult[]): ExecutionResult {
  return statusPriority.find((status) => results.includes(status)) ?? 'MISSING';
}

function isResult(value: unknown): value is ExecutionResult {
  return statusPriority.includes(value as ExecutionResult);
}

function isOrigin(value: unknown): value is SystemIntegrationOrigin {
  return value === 'FIXED_GATE' || value === 'BACKEND_E2E' || value === 'BROWSER_E2E' || value === 'NEW_INTEGRATION' || value === 'NEW_E2E';
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasExactKeys<T extends readonly string[]>(value: Record<string, unknown>, expected: T): boolean {
  const actualKeys = Object.keys(value).sort();
  const expectedKeys = [...expected].sort();
  return actualKeys.length === expectedKeys.length && actualKeys.every((key, index) => key === expectedKeys[index]);
}
