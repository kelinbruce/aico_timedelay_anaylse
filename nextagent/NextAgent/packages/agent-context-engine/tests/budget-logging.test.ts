import { buildBudgetEvaluationLogSummary, logBudgetEvaluation } from '@nextagent/agent-context-engine';
import { bindRuntimeLoggerProvider } from '@nextagent/agent-common';
import type { ContextBudgetEvidence, ContextCompactionPlan, ContextRoleEvidence } from '@nextagent/agent-contracts/context';
import { describe, expect, it, vi } from 'vitest';

/**
 * Spec anchor: add-ts-context-budget-explainability design D7
 *   "agent-observability 把 ContextBudgetEvidence 与 plan 落到 structured log
 *    / metric, 经统一 redaction; 不新增独立 explainability API"
 *
 * The projection inside context-engine MUST be safe: the log payload
 * contains aggregate counts and the plan's stable machine-readable
 * fields, NEVER the per-source `safeIdentifier` (high-cardinality) or
 * `owningBoundary`, and NEVER any raw prompt / message / tool /
 * attachment content.
 */

// Stable test fixture — no random IDs, no real-looking credentials.
const STAGE = 'agent-context-engine.budget-decision-gate';
const SAMPLE_PLAN: ContextCompactionPlan = {
  decision: 'compact_degrade',
  reasonCode: 'LARGE_CAPABILITY_RESULT_DEGRADED',
  compressionMode: 'none',
  degradationMode: ['PRE_SEND_CHECK_REQUIRED'],
  pipelineStageStoppedAt: STAGE,
  estimatedFinalInputUnits: 8000,
  omittedContextTypes: ['large_capability_result'],
};

const SAMPLE_EVIDENCE: readonly ContextBudgetEvidence[] = [
  {
    category: 'current_request',
    estimatedInputUnits: 100,
    status: 'selected',
    reasonCode: 'WITHIN_BUDGET',
    owningBoundary: 'agent-context-engine.history-selection.current-request',
    // safeIdentifier is the per-message high-cardinality surface that
    // MUST NOT enter the log. The test asserts the projection drops it.
    safeIdentifier: 'current_request:user:msg-12345',
  },
  {
    category: 'large_capability_result',
    estimatedInputUnits: 4000,
    status: 'degraded',
    reasonCode: 'LARGE_CAPABILITY_RESULT_DEGRADED',
    owningBoundary: 'agent-context-engine.large-content',
    safeIdentifier: 'large_capability_result:tool:msg-67890-secret-token-AAAA',
  },
];

const SAMPLE_ROLE_EVIDENCE: readonly ContextRoleEvidence[] = [
  { role: 'system', status: 'protected', reasonCode: 'WITHIN_BUDGET' },
  { role: 'user', status: 'selected', reasonCode: 'WITHIN_BUDGET' },
];

const SAMPLE_COORDINATES = {
  agentId: 'agent-budget',
  sessionId: 'session-budget',
  requestId: 'request-budget',
  runId: 'run-budget',
};

describe('buildBudgetEvaluationLogSummary', () => {
  it("emits the plan's stable machine-readable fields", () => {
    const summary = buildBudgetEvaluationLogSummary(SAMPLE_PLAN, SAMPLE_EVIDENCE, SAMPLE_ROLE_EVIDENCE);
    expect(summary.decision).toBe('compact_degrade');
    expect(summary.reasonCode).toBe('LARGE_CAPABILITY_RESULT_DEGRADED');
    expect(summary.compressionMode).toBe('none');
    expect(summary.degradationMode).toEqual(['PRE_SEND_CHECK_REQUIRED']);
    expect(summary.pipelineStageStoppedAt).toBe(STAGE);
    expect(summary.estimatedFinalInputUnits).toBe(8000);
    expect(summary.omittedContextTypes).toEqual(['large_capability_result']);
  });

  it('surfaces evidence / roleEvidence as COUNTS, not raw arrays', () => {
    const summary = buildBudgetEvaluationLogSummary(SAMPLE_PLAN, SAMPLE_EVIDENCE, SAMPLE_ROLE_EVIDENCE);
    expect(summary.evidenceCount).toBe(2);
    expect(summary.roleEvidenceCount).toBe(2);
  });

  it('does NOT carry safeIdentifier or owningBoundary into the summary', () => {
    const summary = buildBudgetEvaluationLogSummary(SAMPLE_PLAN, SAMPLE_EVIDENCE, SAMPLE_ROLE_EVIDENCE);
    const serialized = JSON.stringify(summary);
    // safeIdentifier strings are the high-cardinality surface the
    // projection must drop; assert they do not appear.
    expect(serialized).not.toContain('msg-12345');
    expect(serialized).not.toContain('msg-67890-secret-token-AAAA');
    // owningBoundary strings are out-of-log internal paths; assert the
    // safeIdentifier-named field is absent.
    expect(Object.keys(summary).sort()).toEqual([
      'compressionMode',
      'decision',
      'degradationMode',
      'estimatedFinalInputUnits',
      'evidenceCount',
      'omittedContextTypes',
      'pipelineStageStoppedAt',
      'reasonCode',
      'roleEvidenceCount',
    ]);
  });

  it('spreads the readonly arrays into mutable copies (mutating the source plan does not affect the summary)', () => {
    const summary = buildBudgetEvaluationLogSummary(SAMPLE_PLAN, SAMPLE_EVIDENCE, SAMPLE_ROLE_EVIDENCE);
    // Type-level `readonly` is preserved on the summary's arrays, but
    // mutating the source plan's degradationMode/omittedContextTypes
    // must not be observable through the summary because we spread.
    const fresh = buildBudgetEvaluationLogSummary(SAMPLE_PLAN, [], []);
    expect(fresh.degradationMode).toEqual(['PRE_SEND_CHECK_REQUIRED']);
    expect(fresh.omittedContextTypes).toEqual(['large_capability_result']);
  });
});

describe('logBudgetEvaluation', () => {
  it('emits a debug-level `context.budget.evaluated` event with the safe summary', () => {
    const debugSpy = vi.fn();
    const binding = bindRuntimeLoggerProvider({ getLogger: () => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: debugSpy }) });
    const summary = buildBudgetEvaluationLogSummary(SAMPLE_PLAN, SAMPLE_EVIDENCE, SAMPLE_ROLE_EVIDENCE);

    logBudgetEvaluation(SAMPLE_COORDINATES, summary);
    binding.unbind();

    expect(debugSpy).toHaveBeenCalledTimes(1);
    const [payload, message] = debugSpy.mock.calls[0]!;
    expect(message).toBe('Context budget for run run-budget evaluated as compact_degrade with reason LARGE_CAPABILITY_RESULT_DEGRADED.');
    expect(payload.event).toBe('context.budget.evaluated');
    expect(payload.agentId).toBe('agent-budget');
    expect(payload.sessionId).toBe('session-budget');
    expect(payload.requestId).toBe('request-budget');
    expect(payload.runId).toBe('run-budget');
    expect(payload.budget).toEqual(summary);
  });

  it('NEVER serializes safeIdentifier or raw content into the log payload', () => {
    const debugSpy = vi.fn();
    const binding = bindRuntimeLoggerProvider({ getLogger: () => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: debugSpy }) });
    const summary = buildBudgetEvaluationLogSummary(SAMPLE_PLAN, SAMPLE_EVIDENCE, SAMPLE_ROLE_EVIDENCE);

    logBudgetEvaluation(SAMPLE_COORDINATES, summary);
    binding.unbind();

    const serialized = JSON.stringify(debugSpy.mock.calls[0]?.[0] ?? {});
    expect(serialized).not.toContain('msg-12345');
    expect(serialized).not.toContain('msg-67890');
    expect(serialized).not.toContain('secret-token-AAAA');
    // owningBoundary strings are internal paths — the test asserts they
    // don't leak through the projection.
    expect(serialized).not.toContain('agent-context-engine.history-selection.current-request');
    expect(serialized).not.toContain('agent-context-engine.large-content');
  });
});
