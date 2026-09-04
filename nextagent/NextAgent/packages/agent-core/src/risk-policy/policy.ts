import { AgentError, brand, type CapabilityKind, type JsonObject, type RiskPolicyOutcome } from '@nextagent/agent-common';
import type { CapabilityDescriptor } from '@nextagent/agent-contracts/capability';
import type { RiskPolicyEvaluation } from '@nextagent/agent-contracts/observability';
import type {
  RestrictedOperationSummary,
  RiskPolicyDecision,
  RiskPolicyEvaluationInput,
  RiskPolicyEvaluator,
} from '@nextagent/agent-contracts/runtime';

export interface BuiltinRiskPolicyOptions {
  readonly authorizationSupported: boolean;
}

type CapabilitySummaryInput =
  | {
      readonly descriptor: CapabilityDescriptor;
      readonly toolCallId?: string;
      readonly arguments: JsonObject;
      readonly sandboxReady: boolean;
      readonly observabilityReady?: boolean;
      readonly replayAttempt?: boolean;
      readonly currentRunAuthorizationOperationId?: string;
    }
  | {
      readonly capabilityId: string;
      readonly capabilityKind?: CapabilityKind;
      readonly providerId?: string;
      readonly replayPolicy?: 'NON_IDEMPOTENT' | 'IDEMPOTENT';
      readonly toolCallId?: string;
      readonly arguments: JsonObject;
      readonly sandboxReady: boolean;
      readonly observabilityReady?: boolean;
      readonly replayAttempt?: boolean;
      readonly currentRunAuthorizationOperationId?: string;
    };

const allowedRiskPolicyOutcomes = new Set<RiskPolicyOutcome>(['ALLOW', 'DENY', 'REQUIRE_AUTHORIZATION', 'DEGRADED', 'POLICY_FAILED']);

export function createBuiltInRiskPolicyEvaluator(options: BuiltinRiskPolicyOptions): RiskPolicyEvaluator {
  return {
    async evaluate(input) {
      return evaluateBuiltInRiskPolicy(input, options);
    },
  };
}

export function evaluateBuiltInRiskPolicy(input: RiskPolicyEvaluationInput, options: BuiltinRiskPolicyOptions): RiskPolicyDecision {
  const operation = input.operation;
  if (!input.capabilityAvailable) {
    return denied('CAPABILITY_UNAVAILABLE');
  }
  if (!input.capabilityEnabled) {
    return denied('CAPABILITY_DISABLED');
  }
  if (!operation.targetOwnerScopeMatched) {
    return denied('OWNER_SCOPE_MISMATCH');
  }
  if (!operation.parametersSchemaValid) {
    return denied('OPERATION_INPUT_INVALID');
  }
  if (operation.operationKind === 'SANDBOX_EXECUTION' && operation.requiresSandbox && !operation.sandboxReady) {
    return degraded('SANDBOX_UNAVAILABLE');
  }
  if (!operation.observabilityReady) {
    return degraded('RISK_POLICY_OBSERVABILITY_UNAVAILABLE');
  }
  if (operation.currentRunAuthorizationMatched === false && operation.replayPolicy !== 'IDEMPOTENT') {
    return denied('RECOVERY_UNSAFE_CAPABILITY_REPLAY');
  }
  if (operation.riskLevel === 'CRITICAL') {
    return denied('RISK_POLICY_CRITICAL_OPERATION_DENIED');
  }
  if (
    options.authorizationSupported &&
    operation.operationKind !== 'SANDBOX_EXECUTION' &&
    operation.currentRunAuthorizationMatched !== true &&
    operation.riskLevel === 'HIGH'
  ) {
    return {
      outcome: 'REQUIRE_AUTHORIZATION',
      reasonCode: 'RISK_POLICY_AUTHORIZATION_REQUIRED',
      authorizationIntent: {
        operationId: operation.operationId,
        operationKind: operation.operationKind,
        riskLevel: operation.riskLevel,
        prompt: 'Approve the requested operation?',
        approveLabel: 'Approve',
        denyLabel: 'Deny',
        ...(operation.capabilityId === undefined ? {} : { capabilityId: operation.capabilityId }),
        ...(operation.toolCallId === undefined ? {} : { toolCallId: operation.toolCallId }),
      },
    };
  }
  return { outcome: 'ALLOW', reasonCode: 'ALLOWED' };
}

export function summarizeCapabilityOperation(input: CapabilitySummaryInput): RestrictedOperationSummary {
  const capabilityId = 'descriptor' in input ? input.descriptor.capabilityId : input.capabilityId;
  const capabilityKind = 'descriptor' in input ? input.descriptor.kind : input.capabilityKind;
  const providerId = 'descriptor' in input ? input.descriptor.provider.providerId : input.providerId;
  const replayPolicy = 'descriptor' in input ? input.descriptor.replayPolicy : input.replayPolicy;
  const normalized = String(capabilityId).toLowerCase();
  const requiresSandbox = normalized === 'bash' || normalized === 'python';
  const riskLevel = capabilityKind === 'TOOL' ? 'MEDIUM' : 'LOW';
  const operationId = capabilityOperationId(capabilityId, input.toolCallId);
  const currentRunAuthorizationMatched =
    input.currentRunAuthorizationOperationId === undefined
      ? input.replayAttempt === true
        ? false
        : undefined
      : input.currentRunAuthorizationOperationId === operationId
        ? true
        : input.replayAttempt === true
          ? false
          : undefined;
  return {
    operationId,
    operationKind: 'CAPABILITY_INVOCATION',
    capabilityId: brand<string, 'CapabilityId'>(String(capabilityId)),
    ...(capabilityKind === undefined ? {} : { capabilityKind }),
    ...(providerId === undefined ? {} : { providerId }),
    ...(input.toolCallId === undefined ? {} : { toolCallId: input.toolCallId }),
    riskLevel,
    targetOwnerScopeMatched: !containsForgedScopeOverrides(input.arguments),
    parametersSchemaValid: true,
    requiresSandbox,
    sandboxReady: requiresSandbox ? input.sandboxReady : true,
    observabilityReady: input.observabilityReady ?? true,
    ...(replayPolicy === undefined ? {} : { replayPolicy }),
    ...(currentRunAuthorizationMatched === undefined ? {} : { currentRunAuthorizationMatched }),
  };
}

export function summarizeSandboxOperation(input: {
  readonly executable: 'bash' | 'python';
  readonly command: string;
  readonly args: readonly string[];
  readonly sandboxReady: boolean;
  readonly observabilityReady?: boolean;
}): RestrictedOperationSummary {
  return {
    operationId: `${input.executable}:${input.command}`,
    operationKind: 'SANDBOX_EXECUTION',
    executable: input.executable,
    riskLevel: 'MEDIUM',
    targetOwnerScopeMatched: true,
    parametersSchemaValid: typeof input.command === 'string' && input.command.length > 0 && input.args.every((arg) => typeof arg === 'string'),
    requiresSandbox: true,
    sandboxReady: input.sandboxReady,
    observabilityReady: input.observabilityReady ?? true,
  };
}

export async function evaluateRiskPolicySafely(
  evaluator: RiskPolicyEvaluator,
  input: RiskPolicyEvaluationInput,
  signal?: AbortSignal,
): Promise<RiskPolicyDecision> {
  try {
    const decision = await evaluator.evaluate(input, signal);
    return normalizeRiskPolicyDecision(decision);
  } catch {
    return {
      outcome: 'POLICY_FAILED',
      reasonCode: 'RISK_POLICY_EVALUATION_FAILED',
    };
  }
}

export function toRiskPolicyEvaluation(input: RiskPolicyEvaluationInput, decision: RiskPolicyDecision): RiskPolicyEvaluation {
  return {
    occurredAt: nowEpoch(),
    agentId: input.agentId,
    agentVersion: input.agentVersion,
    sessionId: input.sessionId,
    requestId: input.requestId,
    requestRunId: input.requestRunId,
    requestContextId: input.requestContextId,
    operationKind: input.operation.operationKind,
    operationId: input.operation.operationId,
    outcome: decision.outcome,
    riskLevel: input.operation.riskLevel,
    reasonCode: decision.reasonCode,
    ...(input.operation.capabilityId === undefined ? {} : { capabilityId: String(input.operation.capabilityId) }),
    ...(input.operation.providerId === undefined ? {} : { providerId: input.operation.providerId }),
    ...(input.operation.toolCallId === undefined ? {} : { toolCallId: input.operation.toolCallId }),
    ...(input.operation.currentRunAuthorizationMatched === undefined
      ? {}
      : { authorizationScopeMatched: input.operation.currentRunAuthorizationMatched }),
    sandboxRequired: input.operation.requiresSandbox,
    sandboxReady: input.operation.sandboxReady,
    ...(input.policyId === undefined ? {} : { policyId: input.policyId }),
    ...(input.policyVersion === undefined ? {} : { policyVersion: input.policyVersion }),
  };
}

export function toRiskPolicyError(decision: RiskPolicyDecision, evaluation?: RiskPolicyEvaluation): AgentError {
  switch (decision.outcome) {
    case 'DENY':
      return new AgentError({
        code: decision.reasonCode,
        message:
          'Risk policy denied the requested operation. The operation is not permitted under current policy. Choose a different approach or capability.',
        category: 'POLICY_DENIED',
        retryable: false,
      });
    case 'DEGRADED':
      return new AgentError({
        code: decision.reasonCode,
        message: 'Risk policy dependency is unavailable. The operation cannot be evaluated. Try a different approach or retry later.',
        category: 'UNAVAILABLE',
        retryable: false,
      });
    case 'POLICY_FAILED':
      return new AgentError({
        code: decision.reasonCode,
        message:
          'Risk policy evaluation failed safely, so the requested operation was not started. Choose another permitted capability, provide a safe response without this operation, or end and report the failure.',
        category: 'INTERNAL',
        retryable: false,
      });
    case 'REQUIRE_AUTHORIZATION':
      return new AgentError({
        code: decision.reasonCode,
        message: 'Risk policy requires explicit authorization for the requested operation. The operation needs approval before it can proceed.',
        category: 'AUTHORIZATION',
        retryable: false,
        ...(evaluation === undefined
          ? {}
          : {
              safeDetails: {
                pendingInputKind: 'AUTHORIZATION',
                operationKind: evaluation.operationKind,
                operationId: evaluation.operationId,
                riskLevel: evaluation.riskLevel,
                reasonCode: evaluation.reasonCode,
                ...(evaluation.capabilityId === undefined ? {} : { capabilityId: evaluation.capabilityId }),
                ...(evaluation.toolCallId === undefined ? {} : { toolCallId: evaluation.toolCallId }),
                prompt: decision.authorizationIntent?.prompt ?? 'Approve the requested operation?',
                approveLabel: decision.authorizationIntent?.approveLabel ?? 'Approve',
                denyLabel: decision.authorizationIntent?.denyLabel ?? 'Deny',
              },
            }),
      });
    case 'ALLOW':
      throw new AgentError({
        code: 'RISK_POLICY_ERROR_INVALID',
        message: 'ALLOW cannot be converted into a terminal risk policy error.',
        category: 'INTERNAL',
        retryable: false,
      });
    default: {
      const exhaustive: never = decision.outcome;
      throw new Error(`Unhandled case: ${String(exhaustive)}`);
    }
  }
}

function capabilityOperationId(capabilityId: string, toolCallId?: string): string {
  return toolCallId === undefined ? capabilityId : `${capabilityId}:${toolCallId}`;
}

function containsForgedScopeOverrides(argumentsValue: JsonObject): boolean {
  for (const key of ['tenantId', 'subjectId', 'runId', 'sessionId', 'requestId']) {
    if (key in argumentsValue) {
      return true;
    }
  }
  return false;
}

function denied(reasonCode: string): RiskPolicyDecision {
  return { outcome: 'DENY', reasonCode };
}

function degraded(reasonCode: string): RiskPolicyDecision {
  return { outcome: 'DEGRADED', reasonCode };
}

function normalizeRiskPolicyDecision(decision: RiskPolicyDecision): RiskPolicyDecision {
  if (typeof decision !== 'object' || decision === null) {
    return { outcome: 'POLICY_FAILED', reasonCode: 'RISK_POLICY_OUTPUT_INVALID' };
  }
  const outcome = decision.outcome;
  const reasonCode = decision.reasonCode;
  if (!allowedRiskPolicyOutcomes.has(outcome) || typeof reasonCode !== 'string' || reasonCode.length === 0) {
    return { outcome: 'POLICY_FAILED', reasonCode: 'RISK_POLICY_OUTPUT_INVALID' };
  }
  if (outcome === 'REQUIRE_AUTHORIZATION' && !isAuthorizationIntentValid(decision.authorizationIntent)) {
    return { outcome: 'POLICY_FAILED', reasonCode: 'RISK_POLICY_OUTPUT_INVALID' };
  }
  return decision;
}

function isAuthorizationIntentValid(intent: RiskPolicyDecision['authorizationIntent']): boolean {
  if (intent === undefined) {
    return false;
  }
  return (
    typeof intent.operationId === 'string' &&
    intent.operationId.length > 0 &&
    typeof intent.operationKind === 'string' &&
    typeof intent.riskLevel === 'string' &&
    typeof intent.prompt === 'string' &&
    intent.prompt.length > 0 &&
    typeof intent.approveLabel === 'string' &&
    intent.approveLabel.length > 0 &&
    typeof intent.denyLabel === 'string' &&
    intent.denyLabel.length > 0
  );
}

function nowEpoch() {
  return brand<number, 'EpochMillis'>(Date.now());
}
