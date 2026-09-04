export type ConfigReadinessState = 'READY' | 'DEGRADED_READY' | 'BLOCKED';
export type DeploymentMode = 'LOCAL' | 'REMOTE';
export type ConfigIssueSeverity = 'INFO' | 'WARNING' | 'ERROR';
export type ConfigDiagnosticConfigurationStatus = 'VALID' | 'INVALID' | 'DISABLED';

export interface ConfigDiagnostic {
  readonly issueCode: string;
  readonly severity: ConfigIssueSeverity;
  readonly scope:
    'framework' | 'app' | 'agent' | 'modelProfiles' | 'capabilityProviders' | 'gateway' | 'paths' | 'channel' | 'auth' | 'hostedAgent' | 'memory';
  readonly fieldRef: string;
  readonly safeMessage: string;
  readonly affectsReadiness: boolean;
  readonly configurationStatus?: ConfigDiagnosticConfigurationStatus;
}

export interface AppConfigEvaluation {
  readonly readinessState: ConfigReadinessState;
  readonly diagnostics: readonly ConfigDiagnostic[];
  readonly evaluatedAt: string;
}

export interface ConfigValidationEvidence {
  readonly candidateId: string;
  readonly readinessState: ConfigReadinessState;
  readonly safeIssues: readonly string[];
  readonly declaredDegradations: readonly string[];
  readonly evaluatedAt: string;
  readonly evidenceRefs: readonly string[];
}

export function createConfigValidationEvidence(
  candidateId: string,
  validation: AppConfigEvaluation,
  evidenceRefs: readonly string[],
): ConfigValidationEvidence {
  return {
    candidateId,
    readinessState: validation.readinessState,
    safeIssues: validation.diagnostics.map((issue) => issue.safeMessage),
    declaredDegradations: validation.diagnostics.filter((issue) => !issue.affectsReadiness).map((issue) => issue.safeMessage),
    evaluatedAt: validation.evaluatedAt,
    evidenceRefs,
  };
}
