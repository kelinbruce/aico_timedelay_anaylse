import { Type, type Static } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';

export const PackageCandidateEvidenceSchema = Type.Object(
  {
    candidateId: Type.String({ minLength: 1 }),
    packageProfile: Type.Union([Type.Literal('backend-only'), Type.Literal('with-frontend')]),
    manifestRef: Type.String({ minLength: 1 }),
    layoutCheckRef: Type.String({ minLength: 1 }),
    configValidationEvidenceRef: Type.String({ minLength: 1 }),
    startupProofRef: Type.String({ minLength: 1 }),
    healthReadinessProofRef: Type.String({ minLength: 1 }),
    evidenceRefs: Type.Array(Type.String({ minLength: 1 })),
  },
  { additionalProperties: false },
);

export type PackageCandidateEvidence = Static<typeof PackageCandidateEvidenceSchema>;

export interface BasePackageCandidateEvidenceOptions {
  readonly candidateId: string;
  readonly packageProfile: 'backend-only' | 'with-frontend';
  readonly manifestRef: string;
  readonly layoutCheckRef: string;
  readonly configValidationEvidenceRef: string;
  readonly startupProofRef?: string;
  readonly healthReadinessProofRef?: string;
}

export interface PackageExecutionEvidenceRefs {
  readonly startupProofRef: string;
  readonly healthReadinessProofRef: string;
}

export function createBasePackageCandidateEvidence(options: BasePackageCandidateEvidenceOptions): PackageCandidateEvidence {
  const evidence: PackageCandidateEvidence = {
    candidateId: options.candidateId,
    packageProfile: options.packageProfile,
    manifestRef: options.manifestRef,
    layoutCheckRef: options.layoutCheckRef,
    configValidationEvidenceRef: options.configValidationEvidenceRef,
    startupProofRef: options.startupProofRef ?? '',
    healthReadinessProofRef: options.healthReadinessProofRef ?? '',
    evidenceRefs: [options.manifestRef, options.layoutCheckRef, options.configValidationEvidenceRef],
  };
  return evidence;
}

export function mergePackageExecutionEvidence(base: PackageCandidateEvidence, execution: PackageExecutionEvidenceRefs): PackageCandidateEvidence {
  return {
    ...base,
    startupProofRef: execution.startupProofRef,
    healthReadinessProofRef: execution.healthReadinessProofRef,
    evidenceRefs: uniqueRefs([...base.evidenceRefs, execution.startupProofRef, execution.healthReadinessProofRef]),
  };
}

export function validatePackageCandidateEvidence(value: unknown, expectedCandidateId?: string): PackageCandidateEvidence {
  if (!Value.Check(PackageCandidateEvidenceSchema, value)) {
    throw new Error('PackageCandidateEvidence must match the public package evidence schema.');
  }
  const evidence = value as PackageCandidateEvidence;
  if (expectedCandidateId !== undefined && evidence.candidateId !== expectedCandidateId) {
    throw new Error('PackageCandidateEvidence candidate identity does not match the release candidate.');
  }
  for (const [label, ref] of [
    ['manifestRef', evidence.manifestRef],
    ['layoutCheckRef', evidence.layoutCheckRef],
    ['configValidationEvidenceRef', evidence.configValidationEvidenceRef],
    ['startupProofRef', evidence.startupProofRef],
    ['healthReadinessProofRef', evidence.healthReadinessProofRef],
  ] as const) {
    if (ref.trim().length === 0) {
      throw new Error(`${label} is required for package evidence handoff.`);
    }
    if (!evidence.evidenceRefs.includes(ref)) {
      throw new Error(`${label} must be present in evidenceRefs.`);
    }
  }
  return evidence;
}

function uniqueRefs(refs: readonly string[]): string[] {
  return [...new Set(refs.filter((ref) => ref.trim().length > 0))];
}
