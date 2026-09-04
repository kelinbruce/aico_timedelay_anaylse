import { DefaultProportionalBudgetPolicy, createDefaultProportionalBudgetPolicy } from '@nextagent/agent-context-engine';
import type { ContextBudgetPolicyInput, ContextBudgetPolicyPort, ContextSourceCandidate } from '@nextagent/agent-contracts/context';
import { describe, expect, expectTypeOf, it } from 'vitest';

// =============================================================================
// Fixture helpers
// =============================================================================

function candidate(
  category: ContextSourceCandidate['category'],
  estimatedInputUnits: number,
  priority: 'required' | 'optional',
  safeIdentifier = `${category}:fixture`,
): ContextSourceCandidate {
  return {
    category,
    estimatedInputUnits,
    priority,
    safeIdentifier,
    owningBoundary: 'agent-context-engine.test-fixture',
  };
}

function input(
  overrides: Partial<ContextBudgetPolicyInput> & { readonly sourceCandidates: readonly ContextSourceCandidate[] },
): ContextBudgetPolicyInput {
  const window = overrides.window ?? 10_000;
  const reservedOutput = overrides.reservedOutput ?? 1_000;
  return {
    window,
    reservedOutput,
    availableInputUnits: overrides.availableInputUnits ?? window - reservedOutput,
    minimumSafeContextUnits: overrides.minimumSafeContextUnits ?? 0,
    sourceCandidates: overrides.sourceCandidates,
  };
}

const NEVER_SIGNAL = new AbortController().signal;

describe('DefaultProportionalBudgetPolicy', () => {
  // -------------------------------------------------------------------------
  // Default parameters
  // -------------------------------------------------------------------------
  describe('default parameters', () => {
    it('uses 0.885 preSendCheckRatio by default (60% history cap removed)', () => {
      const policy = new DefaultProportionalBudgetPolicy();
      expect(policy.preSendCheckRatio).toBe(0.885);
    });

    it('accepts a custom preSendCheckRatio via constructor options', () => {
      const policy = new DefaultProportionalBudgetPolicy({ preSendCheckRatio: 0.95 });
      expect(policy.preSendCheckRatio).toBe(0.95);
    });

    it('createDefaultProportionalBudgetPolicy factory returns the port type', () => {
      const policy = createDefaultProportionalBudgetPolicy();
      expectTypeOf(policy).toMatchTypeOf<ContextBudgetPolicyPort>();
    });
  });

  // -------------------------------------------------------------------------
  // Invariant 2: baseline > available → explicit failure
  // -------------------------------------------------------------------------
  describe('invariant: minimum-safe baseline protection', () => {
    it('returns explicit_failure / MINIMUM_SAFE_CONTEXT_EXCEEDS_BUDGET when baseline > available', () => {
      const policy = new DefaultProportionalBudgetPolicy();
      const result = policy.evaluate(
        input({
          availableInputUnits: 1_000,
          minimumSafeContextUnits: 5_000,
          sourceCandidates: [candidate('current_request', 5_000, 'required')],
        }),
        NEVER_SIGNAL,
      );
      expect(result.plan.decision).toBe('explicit_failure');
      expect(result.plan.reasonCode).toBe('MINIMUM_SAFE_CONTEXT_EXCEEDS_BUDGET');
      expect(result.plan.pipelineStageStoppedAt).toContain('minimum-safe-context-protection');
      expect(result.plan.estimatedFinalInputUnits).toBe(5_000);
      // Per-source evidence reflects insufficient context
      expect(result.evidence.every((e) => e.reasonCode === 'INSUFFICIENT_CONTEXT')).toBe(true);
      expect(result.evidence.every((e) => e.status === 'omitted')).toBe(true);
      // All four role groups marked rejected
      expect(result.roleEvidence.every((e) => e.status === 'rejected')).toBe(true);
      expect(result.roleEvidence.every((e) => e.reasonCode === 'INSUFFICIENT_CONTEXT')).toBe(true);
    });

    it('when baseline === available, accepts (boundary case)', () => {
      const policy = new DefaultProportionalBudgetPolicy();
      const result = policy.evaluate(
        input({
          availableInputUnits: 1_000,
          minimumSafeContextUnits: 1_000,
          sourceCandidates: [candidate('current_request', 1_000, 'required')],
        }),
        NEVER_SIGNAL,
      );
      expect(result.plan.decision).not.toBe('explicit_failure');
    });
  });

  // -------------------------------------------------------------------------
  // Required candidates always selected
  // -------------------------------------------------------------------------
  describe('required candidates', () => {
    it('required candidates are always selected; optional candidates are no longer capped', () => {
      const policy = new DefaultProportionalBudgetPolicy();
      const result = policy.evaluate(
        input({
          availableInputUnits: 10_000,
          minimumSafeContextUnits: 8_000,
          sourceCandidates: [candidate('current_request', 8_000, 'required'), candidate('prior_active_history', 4_000, 'optional')],
        }),
        NEVER_SIGNAL,
      );
      // The 60% history cap has been removed — optional candidates are all
      // selected regardless of the available budget; overflow is governed by
      // the context engine's compression strategy, not by the budget gate.
      const selected = result.evidence.filter((e) => e.status === 'selected');
      expect(selected.map((e) => e.category).sort()).toEqual(['current_request', 'prior_active_history']);
      expect(result.plan.estimatedFinalInputUnits).toBe(12_000); // 8000 + 4000
    });
  });

  // -------------------------------------------------------------------------
  // No history cap: optional candidates are never omitted / degraded
  // -------------------------------------------------------------------------
  describe('no history cap (60% mechanism removed)', () => {
    it('selects ALL optional candidates even when they exceed the available budget', () => {
      const policy = new DefaultProportionalBudgetPolicy();
      const result = policy.evaluate(
        input({
          availableInputUnits: 1_000,
          sourceCandidates: [
            candidate('prior_active_history', 500, 'optional'),
            candidate('prior_active_history', 500, 'optional', 'history:fixture-2'), // total 1000 == available
          ],
        }),
        NEVER_SIGNAL,
      );
      // No 60% cap → both selected. ratio = 1000/1000 = 1.0 ≥ 0.885 → pre-send.
      const selectedHistory = result.evidence.filter((e) => e.category === 'prior_active_history' && e.status === 'selected');
      const omittedHistory = result.evidence.filter((e) => e.category === 'prior_active_history' && e.status === 'omitted');
      expect(selectedHistory).toHaveLength(2);
      expect(omittedHistory).toHaveLength(0);
      expect(result.plan.omittedContextTypes).toEqual([]);
      expect(result.plan.decision).toBe('pre_send_check_required');
      expect(result.plan.reasonCode).toBe('PRE_SEND_CHECK_REQUIRED');
    });

    it('large_capability_result candidates are selected (not degraded) — large-content truncation runs before the gate', () => {
      const policy = new DefaultProportionalBudgetPolicy();
      const result = policy.evaluate(
        input({
          availableInputUnits: 1_000,
          sourceCandidates: [
            candidate('prior_active_history', 100, 'optional', 'history:small'),
            candidate('large_capability_result', 500, 'optional', 'tool-result:medium'),
            candidate('large_capability_result', 400, 'optional', 'tool-result:large'),
          ],
        }),
        NEVER_SIGNAL,
      );
      // No cap → everything selected. Oversized tool results are bounded by
      // truncateLargeToolResults before the gate, so the gate does not degrade.
      const evidenceByName = new Map(result.evidence.map((e) => [e.safeIdentifier, e]));
      expect(evidenceByName.get('tool-result:medium')?.status).toBe('selected');
      expect(evidenceByName.get('tool-result:large')?.status).toBe('selected');
      expect(evidenceByName.get('history:small')?.status).toBe('selected');
      expect(result.plan.omittedContextTypes).toEqual([]);
    });

    it('plain optional categories are selected (not omitted) even when they exceed the available budget', () => {
      const policy = new DefaultProportionalBudgetPolicy();
      const result = policy.evaluate(
        input({
          availableInputUnits: 1_000,
          sourceCandidates: [
            candidate('prior_active_history', 700, 'optional', 'history:huge'), // 700 > available-derived threshold but no longer omitted
          ],
        }),
        NEVER_SIGNAL,
      );
      const history = result.evidence.find((e) => e.safeIdentifier === 'history:huge');
      expect(history?.status).toBe('selected');
      expect(result.plan.omittedContextTypes).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------
  // Pre-send check (spec Q11)
  // -------------------------------------------------------------------------
  describe('pre-send check', () => {
    it('flags PRE_SEND_CHECK_REQUIRED when ratio >= 0.885', () => {
      const policy = new DefaultProportionalBudgetPolicy();
      // available = 10000. required = 8000 (ratio = 0.80, below threshold).
      // Add optional candidates that fit: 900 prior_active_history.
      // Final = 8900 / 10000 = 0.89 ≥ 0.885 → pre-send check fires.
      const result = policy.evaluate(
        input({
          availableInputUnits: 10_000,
          minimumSafeContextUnits: 8_000,
          sourceCandidates: [candidate('current_request', 8_000, 'required'), candidate('prior_active_history', 900, 'optional')],
        }),
        NEVER_SIGNAL,
      );
      expect(result.plan.decision).toBe('pre_send_check_required');
      expect(result.plan.degradationMode).toContain('PRE_SEND_CHECK_REQUIRED');
      expect(result.plan.reasonCode).toBe('PRE_SEND_CHECK_REQUIRED');
      expect(result.plan.pipelineStageStoppedAt).toContain('pre-send-check');
    });

    it('does NOT flag PRE_SEND_CHECK_REQUIRED when ratio < 0.885 (below threshold)', () => {
      const policy = new DefaultProportionalBudgetPolicy();
      // Final = 4000 / 10000 = 0.40 below 0.885 → no pre-send.
      const result = policy.evaluate(
        input({
          availableInputUnits: 10_000,
          sourceCandidates: [candidate('prior_active_history', 4_000, 'optional')],
        }),
        NEVER_SIGNAL,
      );
      expect(result.plan.decision).toBe('continue');
      expect(result.plan.degradationMode).toHaveLength(0);
      expect(result.plan.reasonCode).toBe('WITHIN_BUDGET');
    });

    it('pre-send check uses availableInputUnits for the ratio (boundary behavior)', () => {
      // availableInputUnits = 1001; candidate 601 → ratio 601/1001 ≈ 0.60 < 0.885 → continue.
      const policy = new DefaultProportionalBudgetPolicy();
      const result = policy.evaluate(
        input({
          availableInputUnits: 1_001,
          sourceCandidates: [candidate('prior_active_history', 601, 'optional')],
        }),
        NEVER_SIGNAL,
      );
      // No cap → selected; ratio below 0.885 → continue.
      expect(result.evidence[0]?.status).toBe('selected');
      expect(result.plan.decision).toBe('continue');
    });
  });

  // -------------------------------------------------------------------------
  // Evidence shape and safety (spec R5)
  // -------------------------------------------------------------------------
  describe('evidence shape and safety', () => {
    it('emits one source-category evidence entry per candidate', () => {
      const policy = new DefaultProportionalBudgetPolicy();
      const candidates: ContextSourceCandidate[] = [
        candidate('current_request', 100, 'required'),
        candidate('prior_active_history', 200, 'optional'),
        candidate('capability_disclosure', 50, 'required'),
        candidate('runtime_context', 30, 'required'),
      ];
      const result = policy.evaluate(input({ availableInputUnits: 10_000, sourceCandidates: candidates }), NEVER_SIGNAL);
      expect(result.evidence).toHaveLength(candidates.length);
      const categories = new Set(result.evidence.map((e) => e.category));
      expect(categories.has('current_request')).toBe(true);
      expect(categories.has('prior_active_history')).toBe(true);
      expect(categories.has('capability_disclosure')).toBe(true);
      expect(categories.has('runtime_context')).toBe(true);
    });

    it('emits role-level evidence covering all four role groups (system / user / assistant / tool)', () => {
      const policy = new DefaultProportionalBudgetPolicy();
      const result = policy.evaluate(
        input({
          availableInputUnits: 10_000,
          sourceCandidates: [candidate('current_request', 100, 'required'), candidate('capability_disclosure', 50, 'required')],
        }),
        NEVER_SIGNAL,
      );
      const roles = new Set(result.roleEvidence.map((e) => e.role));
      expect(roles).toEqual(new Set(['system', 'user', 'assistant', 'tool']));
    });

    it("marks system role as 'protected' when all system-categorized sources are selected (spec R5 S3)", () => {
      const policy = new DefaultProportionalBudgetPolicy();
      const result = policy.evaluate(
        input({
          availableInputUnits: 10_000,
          sourceCandidates: [candidate('capability_disclosure', 50, 'required')],
        }),
        NEVER_SIGNAL,
      );
      const systemEvidence = result.roleEvidence.find((e) => e.role === 'system');
      expect(systemEvidence?.status).toBe('protected');
    });

    it('evidence carries only safe fields (no raw content fields exist in the type)', () => {
      const policy = new DefaultProportionalBudgetPolicy();
      const result = policy.evaluate(
        input({
          availableInputUnits: 10_000,
          sourceCandidates: [candidate('current_request', 100, 'required', 'safe-id-only')],
        }),
        NEVER_SIGNAL,
      );
      const ev = result.evidence[0]!;
      // The TypeScript type already prevents raw fields from being included; this
      // runtime check just asserts the expected key set so a future maintainer
      // who extends the interface gets a failing test.
      expect(Object.keys(ev).sort()).toEqual(['category', 'estimatedInputUnits', 'owningBoundary', 'reasonCode', 'safeIdentifier', 'status']);
    });
  });

  // -------------------------------------------------------------------------
  // Replacement policy invariants (spec Q2)
  // -------------------------------------------------------------------------
  describe('replacement policy invariants', () => {
    it('a stub policy with a custom preSendCheckRatio still emits a stable ContextCompactionPlan decision', () => {
      // Construct a policy with a custom ratio; assert the four invariants hold.
      const policy = createDefaultProportionalBudgetPolicy({ preSendCheckRatio: 0.95 });
      const result = policy.evaluate(
        input({
          availableInputUnits: 10_000,
          minimumSafeContextUnits: 1_000,
          sourceCandidates: [
            candidate('current_request', 1_000, 'required'),
            candidate('prior_active_history', 5_000, 'optional'), // selected (no cap); 6000/10000 = 0.6 < 0.95 → continue
          ],
        }),
        NEVER_SIGNAL,
      );
      // Invariant 4: decision is one of the four documented values
      const documented = new Set(['continue', 'compact_degrade', 'pre_send_check_required', 'explicit_failure']);
      expect(documented.has(result.plan.decision)).toBe(true);
      // Invariant 1: required candidate (current_request) is still selected
      const currentRequestEvidence = result.evidence.find((e) => e.category === 'current_request');
      expect(currentRequestEvidence?.status).toBe('selected');
      // Invariant 3: evidence is shaped and bounded
      expect(result.evidence.length).toBeGreaterThan(0);
    });
  });

  // -------------------------------------------------------------------------
  // Sanity / numeric edge cases
  // -------------------------------------------------------------------------
  describe('numeric edge cases', () => {
    it('handles zero available budget (optional candidates selected; ratio guard avoids NaN)', () => {
      const policy = new DefaultProportionalBudgetPolicy();
      const result = policy.evaluate(
        input({
          availableInputUnits: 0,
          sourceCandidates: [candidate('prior_active_history', 100, 'optional')],
        }),
        NEVER_SIGNAL,
      );
      // No cap → selected. final = 100; ratio guard (avail===0) returns 0 → no pre-send.
      expect(result.evidence[0]?.status).toBe('selected');
      expect(result.plan.estimatedFinalInputUnits).toBe(100);
      expect(result.plan.degradationMode).not.toContain('PRE_SEND_CHECK_REQUIRED');
    });

    it('handles empty source candidates list', () => {
      const policy = new DefaultProportionalBudgetPolicy();
      const result = policy.evaluate(input({ availableInputUnits: 10_000, sourceCandidates: [] }), NEVER_SIGNAL);
      expect(result.evidence).toHaveLength(0);
      expect(result.plan.decision).toBe('continue');
      expect(result.plan.reasonCode).toBe('WITHIN_BUDGET');
      expect(result.plan.estimatedFinalInputUnits).toBe(0);
      // Role evidence still emitted for all four roles (with "selected" / "WITHIN_BUDGET" default)
      expect(result.roleEvidence).toHaveLength(4);
    });
  });
});
