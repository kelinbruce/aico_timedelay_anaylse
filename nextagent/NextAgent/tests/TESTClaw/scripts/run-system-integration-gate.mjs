import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SYSTEM_INTEGRATION_CASES } from '../tests/suites/add-ts-system-integration-validation-gate/case-manifest.ts';
import {
  preflightSystemIntegrationInputs,
  unavailableResultsForPreflight,
} from '../tests/suites/add-ts-system-integration-validation-gate/helpers/preflight.ts';
import { buildSystemIntegrationReport } from '../tests/suites/add-ts-system-integration-validation-gate/helpers/report.ts';
import { adaptPlaywrightJson, adaptVitestJson } from '../tests/suites/add-ts-system-integration-validation-gate/helpers/reporter.ts';
import { applyEvidenceScan, scanExportedEvidence } from '../tests/suites/add-ts-system-integration-validation-gate/helpers/evidence-safety.ts';
import { runFrameworkProcess } from '../tests/suites/add-ts-system-integration-validation-gate/helpers/framework-process.ts';
import { linkPassingCaseEvidence } from '../tests/suites/add-ts-system-integration-validation-gate/helpers/runner-evidence.ts';
import { withRunScope } from '../tests/suites/add-ts-system-integration-validation-gate/helpers/run-scope.ts';

const VITEST_PROCESS_TIMEOUT_MS = 30 * 60_000;
const PLAYWRIGHT_PROCESS_TIMEOUT_MS = 65 * 60_000;
const testclawRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outputBase = path.resolve(process.env.TESTCLAW_SYSTEM_INTEGRATION_OUTPUT_ROOT ?? path.join(testclawRoot, 'test-output', 'system-integration'));
const candidateRoot = path.resolve(process.env.NEXTAGENT_PACKAGE_ROOT ?? path.join(testclawRoot, 'target'));
const externalPackagesRoot = path.resolve(
  process.env.NEXTAGENT_EXTERNAL_PACKAGES_ROOT ?? path.join(testclawRoot, '__unconfigured_external_packages__'),
);

try {
  const summary = await withRunScope({ outputBase }, async (scope) => {
    const preflight = preflightSystemIntegrationInputs({
      candidateRoot,
      externalPackagesRoot,
    });
    const executionResults = [...unavailableResultsForPreflight(SYSTEM_INTEGRATION_CASES, preflight)];
    const unavailableRefs = new Set(executionResults.map((result) => result.executionRef));
    if (preflight.unavailableRoots.length === 0) {
      executionResults.push(
        ...(await runImplementedVitestCases(scope, unavailableRefs)),
        ...(await runImplementedPlaywrightCases(scope, unavailableRefs)),
      );
    }
    const linked = await linkPassingCaseEvidence({
      evidenceRoot: scope.evidenceRoot,
      definitions: SYSTEM_INTEGRATION_CASES,
      executionResults,
    });
    const scannedResults = applyEvidenceScan(
      SYSTEM_INTEGRATION_CASES,
      linked.executionResults,
      scanExportedEvidence({ canaries: [], artifacts: linked.artifacts }),
    );
    let report = buildSystemIntegrationReport({
      runId: scope.runId,
      definitions: SYSTEM_INTEGRATION_CASES,
      executionResults: scannedResults,
    });
    const reportContent = `${JSON.stringify(report, null, 2)}\n`;
    const reportScan = scanExportedEvidence({
      canaries: [],
      artifacts: SYSTEM_INTEGRATION_CASES.map((definition) => ({
        caseId: definition.caseId,
        surface: 'report',
        content: reportContent,
      })),
    });
    if (!reportScan.safe) {
      report = buildSystemIntegrationReport({
        runId: scope.runId,
        definitions: SYSTEM_INTEGRATION_CASES,
        executionResults: applyEvidenceScan(SYSTEM_INTEGRATION_CASES, scannedResults, reportScan),
      });
    }
    await writeReportAtomically(scope.evidenceRoot, report);
    return {
      checkId: 'system-integration',
      runId: scope.runId,
      status: report.status,
      reportRef: `system-integration/${scope.runId}/report.json`,
    };
  });

  const summaryContent = JSON.stringify(summary);
  const summaryScan = scanExportedEvidence({
    canaries: [],
    artifacts: [{ caseId: 'TC-SI-001', surface: 'stdout', content: summaryContent }],
  });
  if (!summaryScan.safe) {
    throw new Error('runner-summary-unsafe');
  }
  process.stdout.write(`${summaryContent}\n`);
  process.exitCode = summary.status === 'PASSED' ? 0 : 1;
} catch {
  process.stdout.write(
    `${JSON.stringify({
      checkId: 'system-integration',
      status: 'FAILED',
      failurePhase: 'setup',
      reason: 'runner-setup-failed',
    })}\n`,
  );
  process.exitCode = 1;
}

async function writeReportAtomically(evidenceRoot, report) {
  const target = path.join(evidenceRoot, 'report.json');
  const temporary = path.join(evidenceRoot, `.report-${randomUUID()}.tmp`);
  await writeFile(temporary, `${JSON.stringify(report, null, 2)}\n`, {
    encoding: 'utf8',
    flag: 'wx',
  });
  await rename(temporary, target);
}

async function runImplementedVitestCases(scope, unavailableRefs) {
  const definitions = SYSTEM_INTEGRATION_CASES.filter((definition) => {
    const executionFile = definition.executionRef.split('#', 1)[0];
    return !unavailableRefs.has(definition.executionRef) && executionFile.endsWith('.test.ts') && existsSync(path.join(testclawRoot, executionFile));
  });
  if (definitions.length === 0) {
    return [];
  }

  const reportPath = path.join(scope.restrictedDiagnosticRoot, 'vitest-results.json');
  const vitestEntrypoint = path.join(testclawRoot, 'node_modules', 'vitest', 'vitest.mjs');
  const executionFiles = [...new Set(definitions.map((definition) => definition.executionRef.split('#', 1)[0]))];
  const processResult = await runFrameworkProcess({
    command: process.execPath,
    args: [
      vitestEntrypoint,
      'run',
      '--config',
      'tests/vitest.config.ts',
      '--reporter=json',
      `--outputFile=${reportPath}`,
      '--fileParallelism',
      '--maxWorkers=2',
      ...executionFiles,
    ],
    cwd: testclawRoot,
    environment: {
      ...process.env,
      NEXTAGENT_PACKAGE_ROOT: candidateRoot,
      NEXTAGENT_EXTERNAL_PACKAGES_ROOT: externalPackagesRoot,
      TESTCLAW_SYSTEM_INTEGRATION_OUTPUT_ROOT: scope.evidenceRoot,
    },
    timeoutMs: VITEST_PROCESS_TIMEOUT_MS,
    registerChild: scope.registerChild,
  });

  if (processResult.timedOut) {
    return definitions.map((definition) => frameworkFailure(definition.executionRef, 'TIMEOUT'));
  }
  if (processResult.outputOverflow) {
    return definitions.map((definition) => frameworkFailure(definition.executionRef, 'FAILED'));
  }

  try {
    const executionResults = adaptVitestJson(definitions, JSON.parse(await readFile(reportPath, 'utf8')));
    return failClosedOnUnexpectedExit(executionResults, definitions, processResult.exitCode);
  } catch {
    return definitions.map((definition) => frameworkFailure(definition.executionRef, 'FAILED'));
  }
}

async function runImplementedPlaywrightCases(scope, unavailableRefs) {
  const definitions = SYSTEM_INTEGRATION_CASES.filter((definition) => {
    const executionFile = definition.executionRef.split('#', 1)[0];
    return !unavailableRefs.has(definition.executionRef) && executionFile.endsWith('.spec.ts') && existsSync(path.join(testclawRoot, executionFile));
  });
  if (definitions.length === 0) return [];

  const reportPath = path.join(scope.restrictedDiagnosticRoot, 'playwright-results.json');
  const playwrightEntrypoint = path.join(testclawRoot, 'node_modules', '@playwright', 'test', 'cli.js');
  const executionFiles = definitions.map((definition) => definition.executionRef.split('#', 1)[0]);
  const processResult = await runFrameworkProcess({
    command: process.execPath,
    args: [playwrightEntrypoint, 'test', '--config', 'tests/playwright.config.ts', '--reporter=json', ...executionFiles],
    cwd: testclawRoot,
    environment: {
      ...process.env,
      NEXTAGENT_PACKAGE_ROOT: candidateRoot,
      NEXTAGENT_EXTERNAL_PACKAGES_ROOT: externalPackagesRoot,
      TESTCLAW_SYSTEM_INTEGRATION_OUTPUT_ROOT: scope.evidenceRoot,
      PLAYWRIGHT_JSON_OUTPUT_FILE: reportPath,
    },
    timeoutMs: PLAYWRIGHT_PROCESS_TIMEOUT_MS,
    registerChild: scope.registerChild,
  });
  if (processResult.timedOut) {
    return definitions.map((definition) => frameworkFailure(definition.executionRef, 'TIMEOUT'));
  }
  if (processResult.outputOverflow) {
    return definitions.map((definition) => frameworkFailure(definition.executionRef, 'FAILED'));
  }
  try {
    const executionResults = adaptPlaywrightJson(definitions, JSON.parse(await readFile(reportPath, 'utf8')));
    return failClosedOnUnexpectedExit(executionResults, definitions, processResult.exitCode);
  } catch {
    return definitions.map((definition) => frameworkFailure(definition.executionRef, 'FAILED'));
  }
}

function frameworkFailure(executionRef, result) {
  return {
    executionRef,
    result,
    failurePhase: 'execute',
    evidenceRefs: [`runner:framework:${result.toLowerCase()}`],
  };
}

function failClosedOnUnexpectedExit(executionResults, definitions, exitCode) {
  if (exitCode === 0 || executionResults.some((result) => result.result !== 'PASSED')) {
    return executionResults;
  }
  return definitions.map((definition) => frameworkFailure(definition.executionRef, 'FAILED'));
}
