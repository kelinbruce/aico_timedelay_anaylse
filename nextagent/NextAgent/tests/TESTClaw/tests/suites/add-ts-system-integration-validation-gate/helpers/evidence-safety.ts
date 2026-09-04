import { createHash } from 'node:crypto';
import type { SystemIntegrationCaseDefinition } from '../case-manifest.js';
import type { NormalizedExecutionResult } from './reporter.js';

export type EvidenceViolationCategory =
  | 'credential'
  | 'prompt'
  | 'model-output'
  | 'attachment-body'
  | 'skill-body'
  | 'absolute-path'
  | 'provider-secret'
  | 'remote-exception'
  | 'adapter-private-dto'
  | 'sensitive-canary';
export type ExportSurface = 'stdout' | 'stderr' | 'evidence' | 'report';

export interface EvidenceCanary {
  readonly category: EvidenceViolationCategory;
  readonly value: string;
}

export interface ExportedArtifact {
  readonly caseId: string;
  readonly surface: ExportSurface;
  readonly content: string;
}

export interface EvidenceViolation {
  readonly caseId: string;
  readonly surface: ExportSurface;
  readonly reasonCode: `exported-evidence:${EvidenceViolationCategory}`;
  readonly contentHash: string;
  readonly evidenceRef: string;
}

export interface EvidenceScanResult {
  readonly safe: boolean;
  readonly violations: readonly EvidenceViolation[];
}

export interface RestrictedDiagnosticSummary {
  readonly result: 'PASSED';
  readonly reasonCode: 'restricted-diagnostic-inspected';
  readonly contentHash: string;
  readonly evidenceRef: string;
}

const builtInPatterns: readonly {
  readonly category: EvidenceViolationCategory;
  readonly pattern: RegExp;
}[] = [
  {
    category: 'credential',
    pattern: /(?:authorization\s*:\s*bearer\s+|api[_-]?key\s*[=:]\s*|token\s*[=:]\s*)[^\s,;]+/i,
  },
  {
    category: 'absolute-path',
    pattern: /(?:\b[A-Za-z]:[\\/](?:[^\\/\r\n]+[\\/])*[^\\/\r\n]*|\/(?:home|Users|private|tmp|var)\/[^\s"']+)/i,
  },
];

export function scanExportedEvidence(input: {
  readonly canaries: readonly EvidenceCanary[];
  readonly artifacts: readonly ExportedArtifact[];
}): EvidenceScanResult {
  validateCanaries(input.canaries);
  const violations: EvidenceViolation[] = [];

  for (const artifact of input.artifacts) {
    validateArtifact(artifact);
    const matchedCategories: EvidenceViolationCategory[] = [];
    for (const canary of input.canaries) {
      if (artifact.content.includes(canary.value)) {
        addCategory(matchedCategories, canary.category);
      }
    }
    for (const builtIn of builtInPatterns) {
      if (builtIn.pattern.test(artifact.content)) {
        addCategory(matchedCategories, builtIn.category);
      }
    }

    const contentHash = hashContent(artifact.content);
    for (const category of matchedCategories) {
      violations.push(
        Object.freeze({
          caseId: artifact.caseId,
          surface: artifact.surface,
          reasonCode: `exported-evidence:${category}`,
          contentHash,
          evidenceRef: `evidence-scan:${contentHash}`,
        }),
      );
    }
  }

  return Object.freeze({
    safe: violations.length === 0,
    violations: Object.freeze(violations),
  });
}

export function summarizeRestrictedDiagnostic(content: string): RestrictedDiagnosticSummary {
  const contentHash = hashContent(content);
  return Object.freeze({
    result: 'PASSED',
    reasonCode: 'restricted-diagnostic-inspected',
    contentHash,
    evidenceRef: `restricted-diagnostic:${contentHash}`,
  });
}

export function applyEvidenceScan(
  definitions: readonly SystemIntegrationCaseDefinition[],
  executionResults: readonly NormalizedExecutionResult[],
  scan: EvidenceScanResult,
): readonly NormalizedExecutionResult[] {
  const definitionsById = new Map(definitions.map((entry) => [entry.caseId, entry]));
  const resultsByRef = new Map(executionResults.map((entry) => [entry.executionRef, entry]));
  const violationsById = new Map<string, EvidenceViolation[]>();
  for (const violation of scan.violations) {
    if (!definitionsById.has(violation.caseId as SystemIntegrationCaseDefinition['caseId'])) {
      throw new Error(`evidence violation references unknown case: ${violation.caseId}`);
    }
    const entries = violationsById.get(violation.caseId) ?? [];
    entries.push(violation);
    violationsById.set(violation.caseId, entries);
  }

  return definitions.map((definition) => {
    const violations = violationsById.get(definition.caseId);
    if (violations !== undefined) {
      return Object.freeze({
        executionRef: definition.executionRef,
        result: 'FAILED',
        failurePhase: 'evidence',
        evidenceRefs: Object.freeze([...new Set(violations.flatMap((violation) => [violation.evidenceRef, `reason:${violation.reasonCode}`]))]),
      } satisfies NormalizedExecutionResult);
    }
    return (
      resultsByRef.get(definition.executionRef) ??
      Object.freeze({
        executionRef: definition.executionRef,
        result: 'MISSING',
        failurePhase: 'execute',
        evidenceRefs: ['runner:missing'],
      } satisfies NormalizedExecutionResult)
    );
  });
}

function validateCanaries(canaries: readonly EvidenceCanary[]): void {
  const identities = new Set<string>();
  for (const canary of canaries) {
    if (!isViolationCategory(canary.category) || typeof canary.value !== 'string' || canary.value.length === 0) {
      throw new Error('invalid evidence canary');
    }
    const identity = `${canary.category}\0${canary.value}`;
    if (identities.has(identity)) {
      throw new Error('duplicate evidence canary');
    }
    identities.add(identity);
  }
}

function validateArtifact(artifact: ExportedArtifact): void {
  if (
    !/^TC-SI-\d{3}$/.test(artifact.caseId) ||
    !['stdout', 'stderr', 'evidence', 'report'].includes(artifact.surface) ||
    typeof artifact.content !== 'string'
  ) {
    throw new Error('invalid exported artifact');
  }
}

function addCategory(categories: EvidenceViolationCategory[], category: EvidenceViolationCategory): void {
  if (!categories.includes(category)) {
    categories.push(category);
  }
}

function hashContent(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}

function isViolationCategory(value: unknown): value is EvidenceViolationCategory {
  return (
    value === 'credential' ||
    value === 'prompt' ||
    value === 'model-output' ||
    value === 'attachment-body' ||
    value === 'skill-body' ||
    value === 'absolute-path' ||
    value === 'provider-secret' ||
    value === 'remote-exception' ||
    value === 'adapter-private-dto' ||
    value === 'sensitive-canary'
  );
}
