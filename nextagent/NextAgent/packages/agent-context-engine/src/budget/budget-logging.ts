import { getLogger } from '@nextagent/agent-common';
import type { ContextBudgetEvidence, ContextCompactionPlan, ContextRoleEvidence } from '@nextagent/agent-contracts/context';

/**
 * Structural logger interface consumed by `logBudgetEvaluation`. Defined
 * inside the business module (no `pino` import) per the
 * `no-framework-leakage-into-business-packages` architecture rule:
 * the shared logger facade resolves the app-bound runtime logger provider for
 * `DefaultContextEngine`; the engine itself does not depend on the
 * logging implementation.
 *
 * Routine successful budget evaluation is debug-only so it does not
 * inflate the default request diagnosis skeleton.
 */
const logger = getLogger({ component: 'agent-context-engine', source: 'budget' });

/**
 * Safe, redacted projection of one `ContextCompactionPlan` outcome for
 * the `context.budget.evaluated` structured log event. The projection
 * is the SHAPE accepted by `logBudgetEvaluation` — callers MUST map
 * the plan into this shape before invoking the logger.
 *
 * Spec anchors (add-ts-context-budget-explainability design D7):
 *  - payload MUST NOT contain raw prompt / message / tool / attachment
 *    content, paths, credentials, or high-cardinality identifiers
 *  - evidence and roleEvidence arrays are surfaced as COUNTS only —
 *    each array element carries a per-source `safeIdentifier` (a
 *    high-cardinality string) and `owningBoundary` (a string that
 *    already exists outside the log), so the raw arrays are excluded
 *  - field names are the exact JSON keys written to the log; do not
 *    rename without auditing downstream observability dashboards
 */
export interface BudgetEvaluationLogSummary {
  readonly decision: string;
  readonly reasonCode: string;
  readonly compressionMode: string;
  readonly degradationMode: readonly string[];
  readonly pipelineStageStoppedAt: string;
  readonly estimatedFinalInputUnits: number;
  readonly omittedContextTypes: readonly string[];
  readonly evidenceCount: number;
  readonly roleEvidenceCount: number;
}

/**
 * Identity + execution coordinates the budget log entry is anchored to.
 * These fields mirror the timeline coordinates carried on every
 * `RunTimelineEvent`; the budget log entry MUST carry the same
 * coordinates so observability can join log and timeline.
 */
export interface BudgetEvaluationLogCoordinates {
  readonly agentId: string;
  readonly sessionId: string;
  readonly requestId: string;
  readonly runId: string;
}

/**
 * Build the safe summary from a `ContextCompactionPlan` and its
 * accompanying evidence arrays. The returned object contains the
 * stable JSON shape consumed by the structured log event; the
 * `ContextBudgetEvidence` and `ContextRoleEvidence` arrays are
 * surfaced as counts only.
 */
export function buildBudgetEvaluationLogSummary(
  plan: ContextCompactionPlan,
  evidence: readonly ContextBudgetEvidence[],
  roleEvidence: readonly ContextRoleEvidence[],
): BudgetEvaluationLogSummary {
  return {
    decision: plan.decision,
    reasonCode: plan.reasonCode,
    compressionMode: plan.compressionMode,
    degradationMode: [...plan.degradationMode],
    pipelineStageStoppedAt: plan.pipelineStageStoppedAt,
    estimatedFinalInputUnits: plan.estimatedFinalInputUnits,
    omittedContextTypes: [...plan.omittedContextTypes],
    evidenceCount: evidence.length,
    roleEvidenceCount: roleEvidence.length,
  };
}

/**
 * Emit the `context.budget.evaluated` structured log event for one
 * budget decision. The payload is the safe summary built by the caller;
 * the raw plan / evidence arrays are NOT serialized.
 *
 * Behavior contract (per design D7):
 *  - Failures to log MUST NOT propagate; observability never fails the
 *    main pipeline. Transport degradation is reported by the operational
 *    writer, not recursively through the same failed logger.
 *  - Both `continue` and `explicit_failure` decisions are logged; the
 *    observability surface is symmetric so audit can replay either path.
 *  - The event name is fixed (`context.budget.evaluated`) to keep the
 *    log/metric key stable across policy implementations.
 */
export function logBudgetEvaluation(coordinates: BudgetEvaluationLogCoordinates, summary: BudgetEvaluationLogSummary): void {
  logger.debug(
    {
      event: 'context.budget.evaluated',
      agentId: coordinates.agentId,
      sessionId: coordinates.sessionId,
      requestId: coordinates.requestId,
      runId: coordinates.runId,
      budget: summary,
    },
    `Context budget for run ${coordinates.runId} evaluated as ${summary.decision} with reason ${summary.reasonCode}.`,
  );
}
