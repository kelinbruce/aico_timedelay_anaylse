import { assertBudgetPolicyOutcomeInvariants } from '@nextagent/agent-context-engine';
import { AgentError } from '@nextagent/agent-common';
import type {
  ContextBudgetPolicyInput,
  ContextBudgetPolicyOutcome,
  ContextBudgetEvidence,
  ContextCompactionPlan,
  ContextRoleEvidence,
  ContextSourceCandidate,
} from '@nextagent/agent-contracts/context';
import { describe, expect, it } from 'vitest';

// =============================================================================
// Fixture helpers
// =============================================================================

function requiredCandidate(safeIdentifier: string, category: ContextSourceCandidate['category'] = 'current_request'): ContextSourceCandidate {
  return {
    category,
    estimatedInputUnits: 100,
    priority: 'required',
    safeIdentifier,
    owningBoundary: 'agent-context-engine.test',
  };
}

function optionalCandidate(safeIdentifier: string): ContextSourceCandidate {
  return {
    category: 'prior_active_history',
    estimatedInputUnits: 50,
    priority: 'optional',
    safeIdentifier,
    owningBoundary: 'agent-context-engine.test',
  };
}

function input(overrides: Partial<ContextBudgetPolicyInput>): ContextBudgetPolicyInput {
  return {
    window: 1_000,
    reservedOutput: 100,
    availableInputUnits: 900,
    minimumSafeContextUnits: 0,
    sourceCandidates: [],
    ...overrides,
  };
}

function plan(overrides: Partial<ContextCompactionPlan>): ContextCompactionPlan {
  return {
    decision: 'continue',
    reasonCode: 'WITHIN_BUDGET',
    compressionMode: 'none',
    degradationMode: [],
    pipelineStageStoppedAt: 'agent-context-engine.budget-decision-gate',
    estimatedFinalInputUnits: 0,
    omittedContextTypes: [],
    ...overrides,
  };
}

function outcome(overrides: {
  plan?: ContextCompactionPlan;
  evidence?: readonly ContextBudgetEvidence[];
  roleEvidence?: readonly ContextRoleEvidence[];
}): ContextBudgetPolicyOutcome {
  return {
    plan: overrides.plan ?? plan({}),
    evidence: overrides.evidence ?? [],
    roleEvidence: overrides.roleEvidence ?? [
      { role: 'system', status: 'protected', reasonCode: 'WITHIN_BUDGET' },
      { role: 'user', status: 'selected', reasonCode: 'WITHIN_BUDGET' },
      { role: 'assistant', status: 'selected', reasonCode: 'WITHIN_BUDGET' },
      { role: 'tool', status: 'selected', reasonCode: 'WITHIN_BUDGET' },
    ],
  };
}

function evidenceFor(
  c: ContextSourceCandidate,
  status: ContextBudgetEvidence['status'],
  reasonCode: ContextBudgetEvidence['reasonCode'],
): ContextBudgetEvidence {
  return {
    category: c.category,
    estimatedInputUnits: c.estimatedInputUnits,
    status,
    reasonCode,
    owningBoundary: c.owningBoundary,
    safeIdentifier: c.safeIdentifier,
  };
}

describe('assertBudgetPolicyOutcomeInvariants', () => {
  // ---------------------------------------------------------------------------
  // Invariant 1 — baseline > available yields explicit_failure
  // ---------------------------------------------------------------------------
  describe('invariant 1: baseline > available must yield explicit_failure', () => {
    it('accepts a policy that returns explicit_failure when baseline exceeds budget', () => {
      const policyInput = input({
        availableInputUnits: 100,
        minimumSafeContextUnits: 200,
        sourceCandidates: [requiredCandidate('current_request:user:root')],
      });
      const policyOutcome = outcome({
        plan: plan({
          decision: 'explicit_failure',
          reasonCode: 'MINIMUM_SAFE_CONTEXT_EXCEEDS_BUDGET',
          estimatedFinalInputUnits: 200,
        }),
        evidence: [evidenceFor(policyInput.sourceCandidates[0]!, 'omitted', 'INSUFFICIENT_CONTEXT')],
      });
      expect(() => assertBudgetPolicyOutcomeInvariants(policyInput, policyOutcome)).not.toThrow();
    });

    it("rejects a buggy policy that returns 'continue' when baseline exceeds budget", () => {
      const policyInput = input({
        availableInputUnits: 100,
        minimumSafeContextUnits: 200,
        sourceCandidates: [requiredCandidate('current_request:user:root')],
      });
      const policyOutcome = outcome({
        plan: plan({ decision: 'continue', reasonCode: 'WITHIN_BUDGET' }),
        evidence: [evidenceFor(policyInput.sourceCandidates[0]!, 'selected', 'WITHIN_BUDGET')],
      });
      expect(() => assertBudgetPolicyOutcomeInvariants(policyInput, policyOutcome)).toThrowError(AgentError);
      try {
        assertBudgetPolicyOutcomeInvariants(policyInput, policyOutcome);
      } catch (error) {
        const e = error as AgentError;
        expect(e.code).toBe('CONTEXT_BUDGET_POLICY_INVARIANT_VIOLATION');
        expect(e.safeDetails?.invariant).toBe('baseline-exceeds-budget-must-yield-explicit-failure');
        expect(e.safeDetails?.observedDecision).toBe('continue');
      }
    });

    it('accepts any decision when baseline <= available (normal path)', () => {
      const policyInput = input({
        availableInputUnits: 1_000,
        minimumSafeContextUnits: 200,
        sourceCandidates: [requiredCandidate('current_request:user:root'), optionalCandidate('history:msg-1')],
      });
      const policyOutcome = outcome({
        plan: plan({ decision: 'continue' }),
        evidence: [
          evidenceFor(policyInput.sourceCandidates[0]!, 'selected', 'WITHIN_BUDGET'),
          evidenceFor(policyInput.sourceCandidates[1]!, 'selected', 'WITHIN_BUDGET'),
        ],
      });
      expect(() => assertBudgetPolicyOutcomeInvariants(policyInput, policyOutcome)).not.toThrow();
    });
  });

  // ---------------------------------------------------------------------------
  // Invariant 2 — decision is one of the four stable values
  // ---------------------------------------------------------------------------
  describe('invariant 2: decision must be one of the four stable values', () => {
    it.each(['continue', 'compact_degrade', 'pre_send_check_required', 'explicit_failure'] as const)('accepts stable decision %s', (decision) => {
      const policyInput = input({ sourceCandidates: [requiredCandidate('current_request:user:root')] });
      const policyOutcome = outcome({
        plan: plan({
          decision,
          reasonCode:
            decision === 'explicit_failure'
              ? 'INSUFFICIENT_CONTEXT'
              : decision === 'continue'
                ? 'WITHIN_BUDGET'
                : decision === 'compact_degrade'
                  ? 'HISTORY_OMITTED_TO_BUDGET'
                  : 'PRE_SEND_CHECK_REQUIRED',
          estimatedFinalInputUnits: decision === 'explicit_failure' ? 200 : 100,
        }),
        evidence: [
          evidenceFor(
            policyInput.sourceCandidates[0]!,
            decision === 'explicit_failure' ? 'omitted' : 'selected',
            decision === 'explicit_failure' ? 'INSUFFICIENT_CONTEXT' : 'WITHIN_BUDGET',
          ),
        ],
      });
      expect(() => assertBudgetPolicyOutcomeInvariants(policyInput, policyOutcome)).not.toThrow();
    });

    it('rejects a free-form decision string', () => {
      const policyInput = input({ sourceCandidates: [requiredCandidate('current_request:user:root')] });
      const policyOutcome = outcome({
        plan: plan({ decision: 'recovered' as ContextCompactionPlan['decision'] }),
        evidence: [evidenceFor(policyInput.sourceCandidates[0]!, 'selected', 'WITHIN_BUDGET')],
      });
      try {
        assertBudgetPolicyOutcomeInvariants(policyInput, policyOutcome);
        expect.fail('expected invariant violation');
      } catch (error) {
        const e = error as AgentError;
        expect(e.code).toBe('CONTEXT_BUDGET_POLICY_INVARIANT_VIOLATION');
        expect(e.safeDetails?.invariant).toBe('decision-must-be-stable');
      }
    });
  });

  // ---------------------------------------------------------------------------
  // Invariant 3 — required-priority candidates are NEVER omitted
  // ---------------------------------------------------------------------------
  describe('invariant 3: required-priority candidates are never omitted', () => {
    it('rejects a policy that omits a required candidate', () => {
      const policyInput = input({
        sourceCandidates: [
          requiredCandidate('current_request:user:root'),
          requiredCandidate('capability_disclosure:tool:Skill', 'capability_disclosure'),
        ],
      });
      // Buggy policy omits the capability disclosure entry from evidence
      const policyOutcome = outcome({
        plan: plan({ decision: 'compact_degrade' }),
        evidence: [evidenceFor(policyInput.sourceCandidates[0]!, 'selected', 'WITHIN_BUDGET')],
      });
      try {
        assertBudgetPolicyOutcomeInvariants(policyInput, policyOutcome);
        expect.fail('expected invariant violation');
      } catch (error) {
        const e = error as AgentError;
        expect(e.code).toBe('CONTEXT_BUDGET_POLICY_INVARIANT_VIOLATION');
        expect(e.safeDetails?.invariant).toBe('required-candidate-must-have-evidence');
        expect(e.safeDetails?.safeIdentifier).toBe('capability_disclosure:tool:Skill');
      }
    });

    it('rejects a policy that omits a required candidate via evidence status', () => {
      const policyInput = input({
        sourceCandidates: [requiredCandidate('current_request:user:root')],
      });
      const policyOutcome = outcome({
        plan: plan({ decision: 'compact_degrade' }),
        evidence: [evidenceFor(policyInput.sourceCandidates[0]!, 'omitted', 'HISTORY_OMITTED_TO_BUDGET')],
      });
      try {
        assertBudgetPolicyOutcomeInvariants(policyInput, policyOutcome);
        expect.fail('expected invariant violation');
      } catch (error) {
        const e = error as AgentError;
        expect(e.code).toBe('CONTEXT_BUDGET_POLICY_INVARIANT_VIOLATION');
        expect(e.safeDetails?.invariant).toBe('required-candidate-cannot-be-omitted');
      }
    });

    it('accepts a policy that selects a required candidate', () => {
      const policyInput = input({
        sourceCandidates: [requiredCandidate('current_request:user:root'), optionalCandidate('history:msg-1')],
      });
      const policyOutcome = outcome({
        plan: plan({ decision: 'compact_degrade' }),
        evidence: [
          evidenceFor(policyInput.sourceCandidates[0]!, 'selected', 'WITHIN_BUDGET'),
          evidenceFor(policyInput.sourceCandidates[1]!, 'omitted', 'HISTORY_OMITTED_TO_BUDGET'),
        ],
      });
      expect(() => assertBudgetPolicyOutcomeInvariants(policyInput, policyOutcome)).not.toThrow();
    });
  });

  // ---------------------------------------------------------------------------
  // Invariant 4 — explicit_failure evidence all carries INSUFFICIENT_CONTEXT
  // ---------------------------------------------------------------------------
  describe('invariant 4: explicit_failure evidence must all carry INSUFFICIENT_CONTEXT', () => {
    it('accepts an explicit_failure with all evidence reasonCode = INSUFFICIENT_CONTEXT', () => {
      const policyInput = input({
        availableInputUnits: 100,
        minimumSafeContextUnits: 500,
        sourceCandidates: [requiredCandidate('current_request:user:root'), optionalCandidate('history:msg-1')],
      });
      const policyOutcome = outcome({
        plan: plan({
          decision: 'explicit_failure',
          reasonCode: 'MINIMUM_SAFE_CONTEXT_EXCEEDS_BUDGET',
          estimatedFinalInputUnits: 500,
        }),
        evidence: [
          evidenceFor(policyInput.sourceCandidates[0]!, 'omitted', 'INSUFFICIENT_CONTEXT'),
          evidenceFor(policyInput.sourceCandidates[1]!, 'omitted', 'INSUFFICIENT_CONTEXT'),
        ],
      });
      expect(() => assertBudgetPolicyOutcomeInvariants(policyInput, policyOutcome)).not.toThrow();
    });

    it('rejects an explicit_failure with mixed reason codes', () => {
      const policyInput = input({
        availableInputUnits: 100,
        minimumSafeContextUnits: 500,
        sourceCandidates: [requiredCandidate('current_request:user:root'), optionalCandidate('history:msg-1')],
      });
      const policyOutcome = outcome({
        plan: plan({
          decision: 'explicit_failure',
          reasonCode: 'MINIMUM_SAFE_CONTEXT_EXCEEDS_BUDGET',
        }),
        evidence: [
          evidenceFor(policyInput.sourceCandidates[0]!, 'omitted', 'INSUFFICIENT_CONTEXT'),
          evidenceFor(policyInput.sourceCandidates[1]!, 'omitted', 'HISTORY_OMITTED_TO_BUDGET'),
        ],
      });
      try {
        assertBudgetPolicyOutcomeInvariants(policyInput, policyOutcome);
        expect.fail('expected invariant violation');
      } catch (error) {
        const e = error as AgentError;
        expect(e.code).toBe('CONTEXT_BUDGET_POLICY_INVARIANT_VIOLATION');
        expect(e.safeDetails?.invariant).toBe('explicit-failure-evidence-must-be-insufficient-context');
      }
    });
  });
});
