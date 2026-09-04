import { AgentError } from '@nextagent/agent-common';
import type { ContextBudgetPolicyInput, ContextBudgetPolicyOutcome, ContextCompactionDecision } from '@nextagent/agent-contracts/context';

/**
 * Decision-gate invariants (add-ts-context-budget-explainability design
 * D0 + 黑盒 1). These invariants belong to the gate, NOT to any single
 * policy implementation. Any `ContextBudgetPolicyPort` may vary ratios,
 * priorities, and thresholds; what it MUST NOT do is violate these
 * four invariants. The guard validates the policy's outcome against
 * the input that produced it; violations throw with the
 * `CONTEXT_BUDGET_POLICY_INVARIANT_VIOLATION` code so the caller can
 * surface a safe failure rather than silently accept a malformed plan.
 *
 * Invariant 1 — baseline > available yields explicit_failure:
 *   if `minimumSafeContextUnits > availableInputUnits`, the policy
 *   MUST return `decision: "explicit_failure"`. The default policy
 *   already does this; a buggy custom policy that returns `continue`
 *   here would silently accept an over-budget request and is rejected.
 *
 * Invariant 2 — decision is one of the four stable values:
 *   `continue | compact_degrade | pre_send_check_required | explicit_failure`.
 *   A custom policy that returns a typo or a free-form decision string
 *   is rejected so downstream consumers (compression, prompt shaping,
 *   runtime degradation projection) can rely on the closed set.
 *
 * Invariant 3 — required-priority candidates are NEVER omitted:
 *   any `priority: "required"` source candidate (e.g. the root user
 *   message, current-request protocol-required messages,
 *   latest-request-required attachment, capability disclosure for
 *   selected tools, system prompt slot) MUST land in the evidence
 *   array with `status: "selected"`. Omitting a required candidate
 *   would let a buggy policy silently drop request-critical context.
 *
 * Invariant 4 — explicit_failure evidence all carries
 *   `INSUFFICIENT_CONTEXT` reason code so audit can reliably replay
 *   the failure mode without inspecting the policy implementation.
 */
const STABLE_DECISIONS = new Set<ContextCompactionDecision>(['continue', 'compact_degrade', 'pre_send_check_required', 'explicit_failure']);

export function assertBudgetPolicyOutcomeInvariants(input: ContextBudgetPolicyInput, outcome: ContextBudgetPolicyOutcome): void {
  // Invariant 1
  if (input.minimumSafeContextUnits > input.availableInputUnits && outcome.plan.decision !== 'explicit_failure') {
    throw new AgentError({
      code: 'CONTEXT_BUDGET_POLICY_INVARIANT_VIOLATION',
      message: `Budget policy violated invariant 1: minimumSafeContextUnits (${input.minimumSafeContextUnits}) exceeds availableInputUnits (${input.availableInputUnits}) but plan.decision is "${outcome.plan.decision}" instead of "explicit_failure".`,
      category: 'VALIDATION',
      retryable: false,
      safeDetails: {
        invariant: 'baseline-exceeds-budget-must-yield-explicit-failure',
        observedDecision: outcome.plan.decision,
        minimumSafeContextUnits: input.minimumSafeContextUnits,
        availableInputUnits: input.availableInputUnits,
        reasonCode: outcome.plan.reasonCode,
      },
    });
  }

  // Invariant 2
  if (!STABLE_DECISIONS.has(outcome.plan.decision)) {
    throw new AgentError({
      code: 'CONTEXT_BUDGET_POLICY_INVARIANT_VIOLATION',
      message: `Budget policy violated invariant 2: plan.decision "${outcome.plan.decision}" is not one of the four stable values.`,
      category: 'VALIDATION',
      retryable: false,
      safeDetails: {
        invariant: 'decision-must-be-stable',
        observedDecision: outcome.plan.decision,
      },
    });
  }

  // Invariant 3
  // Required-priority candidates are NEVER omitted in the normal flow
  // (continue / compact_degrade / pre_send_check_required). They MAY be
  // omitted when the gate emits explicit_failure: the baseline itself
  // cannot fit, so the entire input set is dropped together with
  // reasonCode = INSUFFICIENT_CONTEXT. The `explicit_failure` path is
  // governed by invariant 4 (every omitted entry must carry
  // INSUFFICIENT_CONTEXT), not by invariant 3.
  if (outcome.plan.decision !== 'explicit_failure') {
    for (const candidate of input.sourceCandidates) {
      if (candidate.priority !== 'required') {
        continue;
      }
      const evidence = outcome.evidence.find((entry) => entry.safeIdentifier === candidate.safeIdentifier);
      if (evidence === undefined) {
        throw new AgentError({
          code: 'CONTEXT_BUDGET_POLICY_INVARIANT_VIOLATION',
          message: `Budget policy violated invariant 3: required-priority source candidate "${candidate.safeIdentifier}" has no matching evidence entry.`,
          category: 'VALIDATION',
          retryable: false,
          safeDetails: {
            invariant: 'required-candidate-must-have-evidence',
            safeIdentifier: candidate.safeIdentifier,
            category: candidate.category,
          },
        });
      }
      if (evidence.status === 'omitted') {
        throw new AgentError({
          code: 'CONTEXT_BUDGET_POLICY_INVARIANT_VIOLATION',
          message: `Budget policy violated invariant 3: required-priority source candidate "${candidate.safeIdentifier}" was omitted under decision "${outcome.plan.decision}" (required candidates are only allowed to be omitted under "explicit_failure").`,
          category: 'VALIDATION',
          retryable: false,
          safeDetails: {
            invariant: 'required-candidate-cannot-be-omitted',
            safeIdentifier: candidate.safeIdentifier,
            category: candidate.category,
            evidenceStatus: evidence.status,
            evidenceReasonCode: evidence.reasonCode,
          },
        });
      }
    }
  }

  // Invariant 4
  if (outcome.plan.decision === 'explicit_failure') {
    const allInsufficient = outcome.evidence.every((entry) => entry.reasonCode === 'INSUFFICIENT_CONTEXT');
    if (!allInsufficient) {
      throw new AgentError({
        code: 'CONTEXT_BUDGET_POLICY_INVARIANT_VIOLATION',
        message: `Budget policy violated invariant 4: plan.decision is "explicit_failure" but at least one evidence entry does not carry reasonCode "INSUFFICIENT_CONTEXT".`,
        category: 'VALIDATION',
        retryable: false,
        safeDetails: {
          invariant: 'explicit-failure-evidence-must-be-insufficient-context',
          reasonCode: outcome.plan.reasonCode,
        },
      });
    }
  }
}
