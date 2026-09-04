import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  mapHealthProof,
  qualify,
  readConfigValidationEvidence,
  releaseCheckCommands,
  type HealthProof,
  type ReleaseCheckId,
  type ReleaseCheckResult,
  type ReleaseCheckStatus,
  type ReleaseQualificationResult,
} from './index.js';
import { validatePackageCandidateEvidence, type PackageCandidateEvidence } from '../packaging/index.js';

const scriptByCheckId: Readonly<Record<ReleaseCheckId, string>> = {
  contract: 'test:contract',
  architecture: 'lint:architecture',
  security: 'test:gate:security',
  resilience: 'test:gate:resilience',
  'release-package': 'test:e2e:release-package',
  'product-journey': 'test:e2e:product-journey',
  'alpha-kernel-gate': 'test:e2e:alpha-kernel',
  capacity: 'test:gate:capacity',
};

export interface RunReleaseQualificationOptions {
  readonly candidateRoot: string;
  readonly scopeFile: string;
  readonly cwd?: string;
  readonly timeoutMs?: number;
}

export function runReleaseQualification(options: RunReleaseQualificationOptions): ReleaseQualificationResult {
  const cwd = options.cwd ?? process.cwd();
  const candidateRoot = resolve(options.candidateRoot);
  const scopeFile = resolve(options.scopeFile);
  const candidateId = readCandidateId(candidateRoot);
  const releaseScopeStatement = readFileSync(scopeFile, 'utf8').trim();
  const reportDir = mkdtempSync(resolve(tmpdir(), 'nextagent-release-checks-'));

  try {
    if (!existsSync(candidateRoot)) {
      return blockedCandidate(candidateId, 'candidate root is required');
    }
    if (!existsSync(scopeFile) || releaseScopeStatement.length === 0) {
      return blockedCandidate(candidateId, 'release scope statement is required');
    }

    const checkOptions = createRunChecksOptions({ cwd, candidateRoot, scopeFile, reportDir }, options.timeoutMs);
    const hardGateResults = runChecks(['contract', 'architecture', 'security', 'resilience'], checkOptions);
    if (hardGateResults.some((result) => result.status !== 'PASSED')) {
      return blockedHardGates(candidateId, hardGateResults);
    }

    const releasePackageResult = runChecks(['release-package'], checkOptions)[0] ?? missing('release-package');
    const packageEvidence = readPackageEvidence(reportDir, candidateId);
    const healthProof = readHealthProof(reportDir);
    if (releasePackageResult.status !== 'PASSED') {
      return blockedReleasePackage(candidateId, 'blocking-defect: release-package command did not pass', hardGateResults, releasePackageResult);
    }
    if (packageEvidence === undefined) {
      return blockedReleasePackage(
        candidateId,
        'blocking-defect: release-package required package evidence is missing',
        hardGateResults,
        releasePackageResult,
      );
    }
    if (healthProof === undefined) {
      return blockedReleasePackage(
        candidateId,
        'blocking-defect: release-package required health proof is missing',
        hardGateResults,
        releasePackageResult,
      );
    }

    const configValidationEvidence = safeReadConfigValidationEvidence(candidateRoot, packageEvidence);
    const productJourneyResult = runChecks(['product-journey'], checkOptions)[0] ?? missing('product-journey');
    if (productJourneyResult.status !== 'PASSED') {
      return qualify(candidateId, {
        releaseScopeStatement,
        packageEvidence,
        configValidationEvidence,
        hardGateResults,
        healthProof,
        smokeResult: productJourneyResult,
        capacityResult: missing('capacity'),
      });
    }

    const capacityResult = runChecks(['capacity'], checkOptions)[0] ?? missing('capacity');
    return qualify(candidateId, {
      releaseScopeStatement,
      packageEvidence,
      configValidationEvidence,
      hardGateResults,
      healthProof,
      smokeResult: productJourneyResult,
      capacityResult,
    });
  } finally {
    rmSync(reportDir, { recursive: true, force: true });
  }
}

interface RunChecksOptions {
  readonly cwd: string;
  readonly candidateRoot: string;
  readonly scopeFile: string;
  readonly reportDir: string;
  readonly timeoutMs?: number;
}

function createRunChecksOptions(base: Omit<RunChecksOptions, 'timeoutMs'>, timeoutMs?: number): RunChecksOptions {
  return timeoutMs === undefined ? base : { ...base, timeoutMs };
}

function runChecks(checkIds: readonly ReleaseCheckId[], options: RunChecksOptions): ReleaseCheckResult[] {
  return checkIds.map((checkId) => {
    const command = releaseCheckCommands.find((entry) => entry.checkId === checkId);
    if (command === undefined) {
      return missing(checkId);
    }
    if (!hasPackageScript(options.cwd, scriptByCheckId[checkId])) {
      return { checkId, status: 'MISSING', safeReason: 'required npm script is missing', evidenceRefs: [] };
    }
    const args = command.needsCandidateAndScope
      ? [...command.args, '--', '--candidate', options.candidateRoot, '--scope', options.scopeFile]
      : [...command.args];
    const npmInvocation = createNpmInvocation(args);
    const output = spawnSync(npmInvocation.executable, npmInvocation.args, {
      cwd: options.cwd,
      env: { ...process.env, NEXTAGENT_RELEASE_CHECK_DIR: options.reportDir },
      encoding: 'utf8',
      timeout: options.timeoutMs ?? 120_000,
    });
    const status: ReleaseCheckStatus =
      output.error?.message.includes('ETIMEDOUT') === true
        ? 'TIMEOUT'
        : output.error !== undefined
          ? 'MISSING'
          : output.status === 0
            ? 'PASSED'
            : 'FAILED';
    const safeReason = output.error?.message ?? (status === 'FAILED' ? 'command exited non-zero' : undefined);
    const result: ReleaseCheckResult =
      safeReason === undefined ? { checkId, status, evidenceRefs: [] } : { checkId, status, safeReason, evidenceRefs: [] };
    return mergeOptionalReport(result, options.reportDir);
  });
}

function createNpmInvocation(args: readonly string[]): { readonly executable: string; readonly args: readonly string[] } {
  const npmCli = resolve(process.execPath, '..', 'node_modules', 'npm', 'bin', 'npm-cli.js');
  return existsSync(npmCli) ? { executable: process.execPath, args: [npmCli, ...args] } : { executable: 'npm', args };
}

function hasPackageScript(cwd: string, scriptName: string): boolean {
  try {
    const manifest = JSON.parse(readFileSync(resolve(cwd, 'package.json'), 'utf8')) as { scripts?: Record<string, unknown> };
    return typeof manifest.scripts?.[scriptName] === 'string';
  } catch {
    return false;
  }
}

function mergeOptionalReport(base: ReleaseCheckResult, reportDir: string): ReleaseCheckResult {
  const reportPath = resolve(reportDir, `${base.checkId}.json`);
  if (!existsSync(reportPath)) {
    return base;
  }
  try {
    const report = JSON.parse(readFileSync(reportPath, 'utf8')) as { checkId?: unknown; safeReason?: unknown; evidenceRefs?: unknown };
    if (report.checkId !== base.checkId) {
      return base;
    }
    const evidenceRefs =
      Array.isArray(report.evidenceRefs) && report.evidenceRefs.every((ref) => typeof ref === 'string') ? report.evidenceRefs : base.evidenceRefs;
    const safeReason = typeof report.safeReason === 'string' ? report.safeReason : base.safeReason;
    return safeReason === undefined
      ? { checkId: base.checkId, status: base.status, evidenceRefs }
      : { checkId: base.checkId, status: base.status, safeReason, evidenceRefs };
  } catch {
    return base;
  }
}

function readPackageEvidence(reportDir: string, candidateId: string): PackageCandidateEvidence | undefined {
  for (const filename of ['package-candidate-evidence.json', 'release-package.package-candidate-evidence.json']) {
    const path = resolve(reportDir, filename);
    if (!existsSync(path)) {
      continue;
    }
    try {
      return validatePackageCandidateEvidence(JSON.parse(readFileSync(path, 'utf8')) as unknown, candidateId);
    } catch {
      return undefined;
    }
  }
  return undefined;
}
function readHealthProof(reportDir: string): HealthProof | undefined {
  for (const filename of ['health-proof.json', 'release-package.health-proof.json']) {
    const path = resolve(reportDir, filename);
    if (!existsSync(path)) {
      continue;
    }
    try {
      return mapHealthProof(JSON.parse(readFileSync(path, 'utf8')) as unknown);
    } catch {
      return undefined;
    }
  }
  return undefined;
}
function safeReadConfigValidationEvidence(candidateRoot: string, packageEvidence: PackageCandidateEvidence) {
  try {
    return readConfigValidationEvidence(candidateRoot, packageEvidence.configValidationEvidenceRef, packageEvidence.candidateId);
  } catch {
    return {
      candidateId: packageEvidence.candidateId,
      readinessState: 'BLOCKED' as const,
      safeIssues: ['Config validation evidence is unavailable.'],
      declaredDegradations: [],
      evaluatedAt: new Date().toISOString(),
      evidenceRefs: [packageEvidence.configValidationEvidenceRef],
    };
  }
}

function blockedHardGates(candidateId: string, hardGateResults: readonly ReleaseCheckResult[]): ReleaseQualificationResult {
  const failedGates = hardGateResults.filter((result) => result.status !== 'PASSED');
  return {
    candidateId,
    qualificationStatus: 'BLOCKED',
    blockingReasons: failedGates.map((result) => `blocking-defect: ${result.checkId} gate ${statusReason(result)}`),
    declaredDegradations: [],
    evidenceRefs: uniqueRefs(hardGateResults.flatMap((result) => result.evidenceRefs)),
    evaluatedAt: new Date().toISOString(),
  };
}
function blockedReleasePackage(
  candidateId: string,
  reason: string,
  hardGateResults: readonly ReleaseCheckResult[],
  releasePackageResult: ReleaseCheckResult,
): ReleaseQualificationResult {
  return {
    candidateId,
    qualificationStatus: 'BLOCKED',
    blockingReasons: [reason],
    declaredDegradations: [],
    evidenceRefs: uniqueRefs([...hardGateResults.flatMap((result) => result.evidenceRefs), ...releasePackageResult.evidenceRefs]),
    evaluatedAt: new Date().toISOString(),
  };
}

function statusReason(result: ReleaseCheckResult): string {
  const suffix = result.safeReason === undefined ? '' : `: ${result.safeReason}`;
  return `${result.status.toLowerCase()}${suffix}`;
}
function uniqueRefs(refs: readonly string[]): string[] {
  return [...new Set(refs)];
}
function missing(checkId: ReleaseCheckId): ReleaseCheckResult {
  return { checkId, status: 'MISSING', safeReason: 'required check result is missing', evidenceRefs: [] };
}

function readCandidateId(candidateRoot: string): string {
  try {
    const manifest = JSON.parse(readFileSync(resolve(candidateRoot, 'candidate-manifest.json'), 'utf8')) as { candidateId?: unknown };
    return typeof manifest.candidateId === 'string' && manifest.candidateId.length > 0 ? manifest.candidateId : 'unknown-candidate';
  } catch {
    return 'unknown-candidate';
  }
}

function blockedCandidate(candidateId: string, reason: string): ReleaseQualificationResult {
  return {
    candidateId,
    qualificationStatus: 'BLOCKED',
    blockingReasons: [reason],
    declaredDegradations: [],
    evidenceRefs: [],
    evaluatedAt: new Date().toISOString(),
  };
}
