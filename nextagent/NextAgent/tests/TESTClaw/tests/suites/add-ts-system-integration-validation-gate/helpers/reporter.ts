import type { SystemIntegrationCaseDefinition, SystemIntegrationCaseId } from '../case-manifest.js';

export type ExecutionResult = 'PASSED' | 'FAILED' | 'TIMEOUT' | 'UNAVAILABLE' | 'MISSING';
export type FailurePhase = 'manifest' | 'preflight' | 'setup' | 'execute' | 'assert' | 'evidence' | 'cleanup';

export interface NormalizedExecutionResult {
  readonly executionRef: string;
  readonly result: ExecutionResult;
  readonly failurePhase: FailurePhase | null;
  readonly evidenceRefs: readonly string[];
}

interface RawReporterResult {
  readonly file: string;
  readonly title: string;
  readonly status: string;
}

export function adaptVitestJson(expectedCases: readonly SystemIntegrationCaseDefinition[], report: unknown): readonly NormalizedExecutionResult[] {
  const rawResults: RawReporterResult[] = [];
  if (!isObject(report) || !Array.isArray(report.testResults)) {
    throw new Error('invalid Vitest JSON report');
  }
  for (const suite of report.testResults) {
    if (!isObject(suite) || typeof suite.name !== 'string' || !Array.isArray(suite.assertionResults)) {
      throw new Error('invalid Vitest suite result');
    }
    for (const assertion of suite.assertionResults) {
      if (!isObject(assertion) || typeof assertion.fullName !== 'string' || typeof assertion.status !== 'string') {
        throw new Error('invalid Vitest assertion result');
      }
      rawResults.push({
        file: suite.name,
        title: assertion.fullName,
        status: assertion.status,
      });
    }
  }
  return normalizeReporterResults('vitest', expectedCases, rawResults);
}

export function adaptPlaywrightJson(
  expectedCases: readonly SystemIntegrationCaseDefinition[],
  report: unknown,
): readonly NormalizedExecutionResult[] {
  if (!isObject(report) || !Array.isArray(report.suites)) {
    throw new Error('invalid Playwright JSON report');
  }
  const rawResults: RawReporterResult[] = [];
  collectPlaywrightSuites(report.suites, rawResults);
  return normalizeReporterResults('playwright', expectedCases, rawResults);
}

function collectPlaywrightSuites(suites: readonly unknown[], output: RawReporterResult[]): void {
  for (const suite of suites) {
    if (!isObject(suite)) {
      throw new Error('invalid Playwright suite result');
    }
    if (Array.isArray(suite.suites)) {
      collectPlaywrightSuites(suite.suites, output);
    }
    if (suite.specs === undefined) {
      continue;
    }
    if (typeof suite.file !== 'string' || !Array.isArray(suite.specs)) {
      throw new Error('invalid Playwright spec result');
    }
    for (const spec of suite.specs) {
      if (!isObject(spec) || typeof spec.title !== 'string' || !Array.isArray(spec.tests)) {
        throw new Error('invalid Playwright test result');
      }
      for (const test of spec.tests) {
        if (!isObject(test) || !Array.isArray(test.results) || test.results.length === 0) {
          throw new Error('invalid Playwright test attempt');
        }
        const lastAttempt = test.results.at(-1);
        if (!isObject(lastAttempt) || typeof lastAttempt.status !== 'string') {
          throw new Error('invalid Playwright test status');
        }
        output.push({
          file: suite.file,
          title: spec.title,
          status: lastAttempt.status,
        });
      }
    }
  }
}

function normalizeReporterResults(
  framework: 'vitest' | 'playwright',
  expectedCases: readonly SystemIntegrationCaseDefinition[],
  rawResults: readonly RawReporterResult[],
): readonly NormalizedExecutionResult[] {
  const expectedById = new Map(expectedCases.map((entry) => [entry.caseId, entry]));
  const normalizedByRef = new Map<string, NormalizedExecutionResult>();

  for (const raw of rawResults) {
    const caseId = raw.title.match(/\bTC-SI-\d{3}\b/)?.[0];
    const definition = caseId === undefined ? undefined : expectedById.get(caseId as SystemIntegrationCaseId);
    if (definition === undefined || !matchesExecutionFile(definition.executionRef, raw.file)) {
      throw new Error(`unknown reporter result: ${safeReporterIdentity(caseId)}`);
    }
    if (normalizedByRef.has(definition.executionRef)) {
      throw new Error(`duplicate executionRef: ${definition.executionRef}`);
    }
    normalizedByRef.set(definition.executionRef, normalizeStatus(framework, definition.executionRef, raw.status));
  }

  return expectedCases.map(
    (definition) =>
      normalizedByRef.get(definition.executionRef) ?? {
        executionRef: definition.executionRef,
        result: 'MISSING',
        failurePhase: 'execute',
        evidenceRefs: [`runner:${framework}:missing`],
      },
  );
}

function matchesExecutionFile(executionRef: string, actualFile: string): boolean {
  const expectedFile = normalizePath(executionRef.split('#', 1)[0]);
  const normalizedActual = normalizePath(actualFile);
  return normalizedActual === expectedFile || normalizedActual.endsWith(`/${expectedFile}`) || expectedFile.endsWith(`/${normalizedActual}`);
}

function normalizeStatus(framework: 'vitest' | 'playwright', executionRef: string, status: string): NormalizedExecutionResult {
  if (status === 'passed') {
    return {
      executionRef,
      result: 'PASSED',
      failurePhase: null,
      evidenceRefs: [`runner:${framework}:passed`],
    };
  }
  if (status === 'timedOut') {
    return {
      executionRef,
      result: 'TIMEOUT',
      failurePhase: 'execute',
      evidenceRefs: [`runner:${framework}:timeout`],
    };
  }
  if (status === 'pending' || status === 'todo' || status === 'skipped') {
    return {
      executionRef,
      result: 'FAILED',
      failurePhase: 'execute',
      evidenceRefs: [`runner:${framework}:${status}-forbidden`],
    };
  }
  if (status === 'failed' || status === 'interrupted') {
    return {
      executionRef,
      result: 'FAILED',
      failurePhase: status === 'failed' ? 'assert' : 'execute',
      evidenceRefs: [`runner:${framework}:${status}`],
    };
  }
  throw new Error(`unknown ${framework} status`);
}

function normalizePath(value: string): string {
  return value.replaceAll('\\', '/').replace(/^file:\/+/, '/');
}

function safeReporterIdentity(caseId: string | undefined): string {
  return caseId ?? 'missing-case-id';
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
