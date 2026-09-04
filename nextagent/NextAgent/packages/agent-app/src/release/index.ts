import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ConfigReadinessState, ConfigValidationEvidence } from '../config/config-artifacts.js';
import { validatePackageCandidateEvidence, type PackageCandidateEvidence } from '../packaging/index.js';

export type QualificationStatus = 'QUALIFIED' | 'QUALIFIED_WITH_DECLARED_DEGRADATIONS' | 'BLOCKED';
export type ReleaseCheckStatus = 'PASSED' | 'FAILED' | 'MISSING' | 'TIMEOUT' | 'UNAVAILABLE';
export type ReleaseCheckId =
  'contract' | 'architecture' | 'security' | 'resilience' | 'release-package' | 'product-journey' | 'alpha-kernel-gate' | 'capacity';

export interface ReleaseCheckResult {
  readonly checkId: ReleaseCheckId;
  readonly status: ReleaseCheckStatus;
  readonly safeReason?: string;
  readonly evidenceRefs: readonly string[];
}

export interface ReleaseCheckCommand {
  readonly checkId: ReleaseCheckId;
  readonly command: 'npm';
  readonly args: readonly string[];
  readonly needsCandidateAndScope: boolean;
}

export interface HealthProof {
  readonly primaryStatus: ReleaseCheckStatus;
  readonly deepStatus: ReleaseCheckStatus;
  readonly criticalDependencyStatuses: readonly ReleaseCheckStatus[];
  readonly evidenceRefs: readonly string[];
  readonly safeReason?: string;
}

export interface ReleaseQualificationInput {
  readonly releaseScopeStatement: string;
  readonly packageEvidence: PackageCandidateEvidence;
  readonly configValidationEvidence: ConfigValidationEvidence;
  readonly hardGateResults: readonly ReleaseCheckResult[];
  readonly healthProof: HealthProof;
  readonly smokeResult: ReleaseCheckResult;
  readonly capacityResult: ReleaseCheckResult;
  readonly declaredDegradations?: readonly string[];
  readonly evaluatedAt?: string;
}

export interface ReleaseQualificationResult {
  readonly candidateId: string;
  readonly qualificationStatus: QualificationStatus;
  readonly blockingReasons: readonly string[];
  readonly declaredDegradations: readonly string[];
  readonly evidenceRefs: readonly string[];
  readonly evaluatedAt: string;
}

export const releaseCheckCommands: readonly ReleaseCheckCommand[] = [
  { checkId: 'contract', command: 'npm', args: ['run', 'test:contract'], needsCandidateAndScope: false },
  { checkId: 'architecture', command: 'npm', args: ['run', 'lint:architecture'], needsCandidateAndScope: false },
  { checkId: 'security', command: 'npm', args: ['run', 'test:gate:security'], needsCandidateAndScope: false },
  { checkId: 'resilience', command: 'npm', args: ['run', 'test:gate:resilience'], needsCandidateAndScope: false },
  { checkId: 'release-package', command: 'npm', args: ['run', 'test:e2e:release-package'], needsCandidateAndScope: true },
  { checkId: 'product-journey', command: 'npm', args: ['run', 'test:e2e:product-journey'], needsCandidateAndScope: true },
  { checkId: 'capacity', command: 'npm', args: ['run', 'test:gate:capacity'], needsCandidateAndScope: true },
] as const;

const hardGateIds: readonly ReleaseCheckId[] = ['contract', 'architecture', 'security', 'resilience'];

export function qualify(candidateId: string, input: ReleaseQualificationInput): ReleaseQualificationResult {
  const evaluatedAt = input.evaluatedAt ?? new Date().toISOString();
  const declaredDegradations = sanitizeList(input.declaredDegradations ?? []);
  const fallbackEvidenceRefs = collectRefs(...(input.configValidationEvidence.evidenceRefs ?? []));
  let packageEvidence: PackageCandidateEvidence;
  try {
    packageEvidence = validatePackageCandidateEvidence(input.packageEvidence, candidateId);
  } catch {
    return blocked(candidateId, ['blocking-defect: package candidate evidence is invalid'], declaredDegradations, fallbackEvidenceRefs, evaluatedAt);
  }
  const baseEvidenceRefs = collectRefs(...packageEvidence.evidenceRefs, ...fallbackEvidenceRefs);

  if (candidateId.trim().length === 0) {
    return blocked(candidateId, ['candidate identity is required'], declaredDegradations, baseEvidenceRefs, evaluatedAt);
  }
  if (input.releaseScopeStatement.trim().length === 0) {
    return blocked(candidateId, ['release scope statement is required'], declaredDegradations, baseEvidenceRefs, evaluatedAt);
  }
  if (input.configValidationEvidence.candidateId !== candidateId) {
    return blocked(
      candidateId,
      ['blocking-defect: config validation evidence candidate mismatch'],
      declaredDegradations,
      baseEvidenceRefs,
      evaluatedAt,
    );
  }

  const gateResults = hardGateIds.map((checkId) => input.hardGateResults.find((result) => result.checkId === checkId) ?? missing(checkId));
  const gateEvidenceRefs = collectRefs(...gateResults.flatMap((result) => result.evidenceRefs));
  const failedGates = gateResults.filter((result) => result.status !== 'PASSED');
  if (failedGates.length > 0) {
    return blocked(
      candidateId,
      failedGates.map((result) => `blocking-defect: ${result.checkId} gate ${statusReason(result)}`),
      declaredDegradations,
      [...baseEvidenceRefs, ...gateEvidenceRefs],
      evaluatedAt,
    );
  }

  const evidenceAfterGates = [...baseEvidenceRefs, ...gateEvidenceRefs];
  if (input.configValidationEvidence.readinessState === 'BLOCKED') {
    return blocked(candidateId, ['blocking-defect: package configuration is blocked'], declaredDegradations, evidenceAfterGates, evaluatedAt);
  }
  const configDegradations = sanitizeList(input.configValidationEvidence.declaredDegradations);
  const undeclaredConfigDegradations = configDegradations.filter((degradation) => !declaredDegradations.includes(degradation));
  if (input.configValidationEvidence.readinessState === 'DEGRADED_READY' && undeclaredConfigDegradations.length > 0) {
    return blocked(
      candidateId,
      undeclaredConfigDegradations.map((degradation) => `blocking-defect: undeclared degradation: ${degradation}`),
      declaredDegradations,
      evidenceAfterGates,
      evaluatedAt,
    );
  }

  const healthEvidenceRefs = collectRefs(...input.healthProof.evidenceRefs);
  const evidenceAfterHealth = [...evidenceAfterGates, ...healthEvidenceRefs];
  if (input.healthProof.primaryStatus !== 'PASSED') {
    return blocked(
      candidateId,
      [
        `blocking-defect: primary health ${statusReason(statusResult('release-package', input.healthProof.primaryStatus, input.healthProof.safeReason))}`,
      ],
      declaredDegradations,
      evidenceAfterHealth,
      evaluatedAt,
    );
  }
  if (input.healthProof.deepStatus !== 'PASSED' || input.healthProof.criticalDependencyStatuses.some((status) => status !== 'PASSED')) {
    return blocked(
      candidateId,
      [
        `blocking-defect: critical dependency health ${statusReason(statusResult('release-package', input.healthProof.deepStatus, input.healthProof.safeReason))}`,
      ],
      declaredDegradations,
      evidenceAfterHealth,
      evaluatedAt,
    );
  }

  const smokeEvidenceRefs = collectRefs(...input.smokeResult.evidenceRefs);
  const evidenceAfterSmoke = [...evidenceAfterHealth, ...smokeEvidenceRefs];
  if (input.smokeResult.status !== 'PASSED') {
    return blocked(
      candidateId,
      [`blocking-defect: product journey ${statusReason(input.smokeResult)}`],
      declaredDegradations,
      evidenceAfterSmoke,
      evaluatedAt,
    );
  }

  const capacityEvidenceRefs = collectRefs(...input.capacityResult.evidenceRefs);
  const evidenceRefs = [...evidenceAfterSmoke, ...capacityEvidenceRefs];
  if (input.capacityResult.status !== 'PASSED') {
    return blocked(
      candidateId,
      [`blocking-defect: capacity baseline ${statusReason(input.capacityResult)}`],
      declaredDegradations,
      evidenceRefs,
      evaluatedAt,
    );
  }

  return {
    candidateId,
    qualificationStatus: declaredDegradations.length > 0 ? 'QUALIFIED_WITH_DECLARED_DEGRADATIONS' : 'QUALIFIED',
    blockingReasons: [],
    declaredDegradations,
    evidenceRefs: uniqueRefs(evidenceRefs),
    evaluatedAt,
  };
}

export function mapHealthProof(input: unknown): HealthProof {
  const record = asRecord(input, 'health proof');
  const proof: HealthProof = {
    primaryStatus: asStatus(record.primaryStatus, 'primaryStatus'),
    deepStatus: asStatus(record.deepStatus, 'deepStatus'),
    criticalDependencyStatuses: asStatusArray(record.criticalDependencyStatuses, 'criticalDependencyStatuses'),
    evidenceRefs: asStringArray(record.evidenceRefs, 'evidenceRefs'),
  };
  return typeof record.safeReason === 'string' ? { ...proof, safeReason: record.safeReason } : proof;
}

export function readConfigValidationEvidence(candidateRoot: string, ref: string, expectedCandidateId: string): ConfigValidationEvidence {
  const value = JSON.parse(readFileSync(resolve(candidateRoot, ref), 'utf8')) as unknown;
  const record = asRecord(value, 'config validation evidence');
  const evidence: ConfigValidationEvidence = {
    candidateId: asString(record.candidateId, 'candidateId'),
    readinessState: asConfigReadinessState(record.readinessState, 'readinessState'),
    safeIssues: asStringArray(record.safeIssues, 'safeIssues'),
    declaredDegradations: asStringArray(record.declaredDegradations, 'declaredDegradations'),
    evaluatedAt: asString(record.evaluatedAt, 'evaluatedAt'),
    evidenceRefs: asStringArray(record.evidenceRefs, 'evidenceRefs'),
  };
  if (evidence.candidateId !== expectedCandidateId) {
    throw new Error('Config validation evidence candidate identity does not match the release candidate.');
  }
  return evidence;
}
function blocked(
  candidateId: string,
  reasons: readonly string[],
  declaredDegradations: readonly string[],
  evidenceRefs: readonly string[],
  evaluatedAt: string,
): ReleaseQualificationResult {
  return {
    candidateId,
    qualificationStatus: 'BLOCKED',
    blockingReasons: reasons.map((reason) => safeReason(reason)),
    declaredDegradations,
    evidenceRefs: uniqueRefs(evidenceRefs),
    evaluatedAt,
  };
}

function missing(checkId: ReleaseCheckId): ReleaseCheckResult {
  return { checkId, status: 'MISSING', safeReason: 'required check result is missing', evidenceRefs: [] };
}

function statusResult(checkId: ReleaseCheckId, status: ReleaseCheckStatus, safeReasonText?: string): ReleaseCheckResult {
  return safeReasonText === undefined ? { checkId, status, evidenceRefs: [] } : { checkId, status, safeReason: safeReasonText, evidenceRefs: [] };
}

function statusReason(result: ReleaseCheckResult): string {
  const suffix = result.safeReason === undefined ? '' : `: ${safeReason(result.safeReason)}`;
  return `${result.status.toLowerCase()}${suffix}`;
}

function collectRefs(...refs: string[]): string[] {
  return refs.filter((ref) => ref.trim().length > 0);
}

function uniqueRefs(refs: readonly string[]): string[] {
  return [...new Set(refs)];
}

function sanitizeList(values: readonly string[]): string[] {
  return values.map((value) => safeReason(value)).filter((value) => value.length > 0);
}

function safeReason(reason: string): string {
  return reason
    .replace(/[A-Za-z]:[\\/][^\s,;)]*/gu, '<local-path>')
    .replace(/\/(?:[^/\s,;)]+\/){2,}[^/\s,;)]*/gu, '<local-path>')
    .replace(/(?:sk-|key-|token-)[A-Za-z0-9_-]+/gu, '<redacted>')
    .replace(/\s+at\s+.+/gu, ' at <stack>');
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function asString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${label} must be a non-empty string.`);
  }
  return value;
}

function asStringArray(value: unknown, label: string): readonly string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string' || item.trim().length === 0)) {
    throw new Error(`${label} must be a string array.`);
  }
  return value as readonly string[];
}

function asStatusArray(value: unknown, label: string): readonly ReleaseCheckStatus[] {
  if (!Array.isArray(value)) {
    throw new Error(`${label} must be a status array.`);
  }
  return value.map((item) => asStatus(item, label));
}

function asStatus(value: unknown, label: string): ReleaseCheckStatus {
  if (value === 'PASSED' || value === 'FAILED' || value === 'MISSING' || value === 'TIMEOUT' || value === 'UNAVAILABLE') {
    return value;
  }
  throw new Error(`${label} must be a release check status.`);
}

function asConfigReadinessState(value: unknown, label: string): ConfigReadinessState {
  if (value === 'READY' || value === 'DEGRADED_READY' || value === 'BLOCKED') {
    return value;
  }
  throw new Error(`${label} must be a config readiness state.`);
}
