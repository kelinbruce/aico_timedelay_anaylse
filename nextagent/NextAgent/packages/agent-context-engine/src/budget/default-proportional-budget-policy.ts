import type {
  BudgetReasonCode,
  ContextBudgetEvidence,
  ContextBudgetPolicyInput,
  ContextBudgetPolicyOutcome,
  ContextBudgetPolicyPort,
  ContextCompactionDecision,
  ContextCompactionPlan,
  ContextRoleEvidence,
  ContextRoleStatus,
  ContextSourceCandidate,
  ContextSourceCategory,
  ContextSourceStatus,
  DegradationFlag,
} from '@nextagent/agent-contracts/context';

/**
 * Default `ContextBudgetPolicyPort` implementation.
 *
 * The earlier 60% proportional history-budget cap has been REMOVED.
 * Previously the policy fit optional-priority candidates into
 * `floor(availableInputUnits * 0.60)` and omitted (or degraded) whatever
 * did not fit, producing `compact_degrade` / `HISTORY_OMITTED_TO_BUDGET`.
 * That cap fired long before the conversation actually approached the
 * context window, so it omitted usable history prematurely — and the
 * per-message omission was the trigger for the orphan-tool-result crash
 * fixed in `removeToolPairOrphans`.
 *
 * Context overflow is now governed SOLELY by the context engine's
 * proactive auto-compact / summary-compression strategy
 * (`DEFAULT_AUTO_COMPACT_HEADROOM_UNITS`, ≈ 92% of the effective window),
 * which summarizes prior turns instead of dropping individual messages.
 * The budget gate's remaining responsibilities:
 *
 *   - Required-priority candidates are ALWAYS selected and counted in the
 *     minimum-safe baseline (root user message, current-request
 *     protocol-required messages, latest-request-required attachment
 *     context, capability disclosure / system prompt).
 *   - Optional-priority candidates are ALL selected — no omission, no
 *     degradation. Oversized tool results are already bounded by the
 *     large-content guard (`truncateLargeToolResults`) before the gate
 *     runs, so the gate does not need to degrade them again.
 *   - When `minimumSafeContextUnits > availableInputUnits`, the policy
 *     MUST emit `decision: "explicit_failure"` with
 *     `reasonCode: "MINIMUM_SAFE_CONTEXT_EXCEEDS_BUDGET"` — never fake a
 *     successful assembly.
 *   - After sizing, if `estimatedFinalInputUnits / availableInputUnits >=
 *     preSendCheckRatio` (default 0.885), the plan carries
 *     `PRE_SEND_CHECK_REQUIRED` in `degradationMode` and decision is
 *     `pre_send_check_required` so the runtime can run a pre-send token
 *     check (and the compression threshold, which fires around the same
 *     point, can summarize prior turns).
 *   - Evidence is emitted per source category and projected per role
 *     (system / user / assistant / tool). System role's non-compressible
 *     sections are marked `protected` when fully selected.
 *
 * Replacement policies MAY redefine `preSendCheckRatio` via constructor
 * options but MUST keep the four decision-gate invariants from the
 * contract JSDoc.
 */
const DEFAULT_PRE_SEND_CHECK_RATIO = 0.885;

const POLICY_STAGE_GATE = 'agent-context-engine.budget-decision-gate';
const POLICY_STAGE_PRE_SEND = 'agent-context-engine.budget-decision-gate.pre-send-check';
const POLICY_STAGE_BASELINE = 'agent-context-engine.budget-decision-gate.minimum-safe-context-protection';

export interface DefaultProportionalBudgetPolicyOptions {
  readonly preSendCheckRatio?: number;
}

export class DefaultProportionalBudgetPolicy implements ContextBudgetPolicyPort {
  readonly preSendCheckRatio: number;

  constructor(options: DefaultProportionalBudgetPolicyOptions = {}) {
    this.preSendCheckRatio = options.preSendCheckRatio ?? DEFAULT_PRE_SEND_CHECK_RATIO;
  }

  evaluate(input: ContextBudgetPolicyInput, _signal: AbortSignal): ContextBudgetPolicyOutcome {
    // Invariant: baseline > available → explicit_failure / INSUFFICIENT_CONTEXT.
    if (input.minimumSafeContextUnits > input.availableInputUnits) {
      return buildExplicitFailureOutcome(input);
    }

    const required = input.sourceCandidates.filter((c) => c.priority === 'required');
    const optional = input.sourceCandidates.filter((c) => c.priority === 'optional');

    // The 60% history-budget cap has been removed. Optional candidates are
    // no longer omitted to fit a proportional history budget — context
    // overflow is governed solely by the context engine's proactive
    // auto-compact / summary-compression strategy. The gate's job here is
    // to size the request and flag a pre-send check when the rendered
    // input approaches the window.
    const requiredTotal = sumUnits(required);
    const optionalTotal = sumUnits(optional);
    const estimatedFinalInputUnits = requiredTotal + optionalTotal;

    const ratio = input.availableInputUnits === 0 ? 0 : estimatedFinalInputUnits / input.availableInputUnits;
    const needsPreSendCheck = ratio >= this.preSendCheckRatio && estimatedFinalInputUnits > 0;

    const degradationMode: DegradationFlag[] = [];
    if (needsPreSendCheck) {
      degradationMode.push('PRE_SEND_CHECK_REQUIRED');
    }

    const decision: ContextCompactionDecision = needsPreSendCheck ? 'pre_send_check_required' : 'continue';
    const reasonCode: BudgetReasonCode = needsPreSendCheck ? 'PRE_SEND_CHECK_REQUIRED' : 'WITHIN_BUDGET';

    const plan: ContextCompactionPlan = {
      decision,
      reasonCode,
      compressionMode: 'none',
      degradationMode,
      pipelineStageStoppedAt: needsPreSendCheck ? POLICY_STAGE_PRE_SEND : POLICY_STAGE_GATE,
      estimatedFinalInputUnits,
      omittedContextTypes: [],
    };

    const evidence: ContextBudgetEvidence[] = [
      ...required.map((c) => evidenceFor(c, 'selected', 'WITHIN_BUDGET')),
      ...optional.map((c) => evidenceFor(c, 'selected', 'WITHIN_BUDGET')),
    ];

    const roleEvidence = buildRoleEvidence(evidence);

    return { plan, evidence, roleEvidence };
  }
}

export function createDefaultProportionalBudgetPolicy(options?: DefaultProportionalBudgetPolicyOptions): ContextBudgetPolicyPort {
  return new DefaultProportionalBudgetPolicy(options);
}

// =============================================================================
// Helpers
// =============================================================================

function sumUnits(candidates: readonly ContextSourceCandidate[]): number {
  let sum = 0;
  for (const c of candidates) {
    sum += c.estimatedInputUnits;
  }
  return sum;
}

function uniqueCategoriesFrom(candidates: readonly ContextSourceCandidate[]): readonly ContextSourceCategory[] {
  const set = new Set<ContextSourceCategory>();
  for (const c of candidates) {
    set.add(c.category);
  }
  return [...set];
}

function evidenceFor(candidate: ContextSourceCandidate, status: ContextSourceStatus, reason: BudgetReasonCode): ContextBudgetEvidence {
  return {
    category: candidate.category,
    estimatedInputUnits: candidate.estimatedInputUnits,
    status,
    reasonCode: reason,
    owningBoundary: candidate.owningBoundary,
    safeIdentifier: candidate.safeIdentifier,
  };
}

function buildExplicitFailureOutcome(input: ContextBudgetPolicyInput): ContextBudgetPolicyOutcome {
  const evidence: ContextBudgetEvidence[] = input.sourceCandidates.map((c) => ({
    category: c.category,
    estimatedInputUnits: c.estimatedInputUnits,
    status: 'omitted' as ContextSourceStatus,
    reasonCode: 'INSUFFICIENT_CONTEXT' as BudgetReasonCode,
    owningBoundary: c.owningBoundary,
    safeIdentifier: c.safeIdentifier,
  }));
  const roleEvidence: ContextRoleEvidence[] = ['system', 'user', 'assistant', 'tool'].map((role) => ({
    role: role as 'system' | 'user' | 'assistant' | 'tool',
    status: 'rejected' as ContextRoleStatus,
    reasonCode: 'INSUFFICIENT_CONTEXT' as BudgetReasonCode,
  }));
  return {
    plan: {
      decision: 'explicit_failure',
      reasonCode: 'MINIMUM_SAFE_CONTEXT_EXCEEDS_BUDGET',
      compressionMode: 'none',
      degradationMode: [],
      pipelineStageStoppedAt: POLICY_STAGE_BASELINE,
      estimatedFinalInputUnits: input.minimumSafeContextUnits,
      omittedContextTypes: uniqueCategoriesFrom(input.sourceCandidates),
    },
    evidence,
    roleEvidence,
  };
}

const ROLE_TO_CATEGORIES: Record<'system' | 'user' | 'assistant' | 'tool', readonly ContextSourceCategory[]> = {
  system: ['capability_disclosure', 'runtime_context', 'project_instruction', 'memory_disclosure'],
  user: ['current_request', 'attachment_projection'],
  // prior_active_history actually spans user+assistant+tool turns, but for the
  // chunk-α role projection we attribute it to assistant as the dominant
  // carrier within a turn. Finer projection is left to future chunks once
  // turn-level role metadata is produced alongside the candidate.
  assistant: ['summary_replacement', 'prior_active_history'],
  tool: ['large_capability_result'],
};

function buildRoleEvidence(evidence: readonly ContextBudgetEvidence[]): readonly ContextRoleEvidence[] {
  const result: ContextRoleEvidence[] = [];
  for (const role of ['system', 'user', 'assistant', 'tool'] as const) {
    const categories = ROLE_TO_CATEGORIES[role];
    const relevant = evidence.filter((e) => categories.includes(e.category));
    if (relevant.length === 0) {
      result.push({ role, status: 'selected', reasonCode: 'WITHIN_BUDGET' });
      continue;
    }
    const allSelected = relevant.every((e) => e.status === 'selected');
    const allOmitted = relevant.every((e) => e.status === 'omitted');
    const anyDegraded = relevant.some((e) => e.status === 'degraded');
    let status: ContextRoleStatus;
    let reasonCode: BudgetReasonCode;
    if (allSelected) {
      // Per spec R5 S3: system role with non-compressible sections is marked
      // protected when fully selected. We use role === "system" as the proxy
      // for non-compressibility here (system prompt sections are governed
      // and non-compressible).
      status = role === 'system' ? 'protected' : 'selected';
      reasonCode = 'WITHIN_BUDGET';
    } else if (allOmitted) {
      status = 'omitted';
      reasonCode = 'HISTORY_OMITTED_TO_BUDGET';
    } else if (anyDegraded) {
      status = 'compressed';
      reasonCode = 'LARGE_CAPABILITY_RESULT_DEGRADED';
    } else {
      status = 'selected';
      reasonCode = 'WITHIN_BUDGET';
    }
    result.push({ role, status, reasonCode });
  }
  return result;
}
