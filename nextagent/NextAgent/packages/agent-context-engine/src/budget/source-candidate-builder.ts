import type { CapabilityDescriptor } from '@nextagent/agent-contracts/capability';
import type { AttachmentContextEvidence, ContextSourceCandidate, SystemPrompt, TokenEstimator } from '@nextagent/agent-contracts/context';
import type { HistorySelectionOutcome } from '../assembly/active-context-selector.js';

/**
 * Budget source-candidate builder (extracted from assemble-context.ts).
 *
 * Constructs the `ContextSourceCandidate[]` array and
 * `minimumSafeContextUnits` that the budget policy consumes.
 * Pure function of its inputs — no gateway calls, no side effects.
 */

export interface SourceCandidateBuildResult {
  readonly sourceCandidates: readonly ContextSourceCandidate[];
  readonly minimumSafeContextUnits: number;
}

/**
 * Build the full set of source candidates from the history-selection
 * outcome, visible capabilities, system prompt, and token estimator.
 *
 * Categories emitted:
 *   - `current_request` (required) — root user message + protocol-required
 *   - `prior_active_history` (optional) — each prior turn message
 *   - `large_capability_result` (optional) — frozen PERSISTED_PREVIEW /
 *     SPECIALIZED_REF / EMPTY_MARKER replacements on prior CAPABILITY_RESULT
 *   - `capability_disclosure` (required) — system prompt text + tool schemas
 */
export function buildSourceCandidates(
  attachmentEvidence: readonly AttachmentContextEvidence[],
  selectionOutcome: HistorySelectionOutcome,
  visibleCapabilities: readonly CapabilityDescriptor[],
  systemPrompt: SystemPrompt,
  estimator: TokenEstimator,
  mapRole: (role: string) => 'system' | 'user' | 'assistant' | 'tool',
): SourceCandidateBuildResult {
  const sourceCandidates: ContextSourceCandidate[] = [];
  let minimumSafeContextUnits = 0;

  // current_request (required priority)
  for (const record of selectionOutcome.currentRequestRecords) {
    const role = mapRole(record.role);
    const units = estimator.estimateMessageTokens(role, record.content);
    sourceCandidates.push({
      category: 'current_request',
      estimatedInputUnits: units,
      priority: 'required',
      safeIdentifier: `current_request:${record.role.toLowerCase()}:${record.messageId}`,
      owningBoundary: 'agent-context-engine.history-selection.current-request',
    });
    minimumSafeContextUnits += units;
  }

  for (const evidence of attachmentEvidence) {
    if (evidence.decision !== 'latest-request-critical') {
      continue;
    }
    sourceCandidates.push({
      category: 'attachment_projection',
      estimatedInputUnits: evidence.projectedInputUnits,
      priority: 'required',
      safeIdentifier: `attachment_projection:${evidence.attachmentId}:${evidence.decision}`,
      owningBoundary: evidence.owningBoundary,
    });
    minimumSafeContextUnits += evidence.projectedInputUnits;
  }

  // prior_active_history (optional priority) + large_capability_result
  for (const messageId of selectionOutcome.priorTurnCandidates) {
    const record = selectionOutcome.recordsByMessageId.get(messageId);
    if (record === undefined) {
      continue;
    }
    const role = mapRole(record.role);
    const units = estimator.estimateMessageTokens(role, record.content);
    sourceCandidates.push({
      category: 'prior_active_history',
      estimatedInputUnits: units,
      priority: 'optional',
      safeIdentifier: `prior_active_history:${record.role.toLowerCase()}:${record.messageId}`,
      owningBoundary: 'agent-context-engine.history-selection.prior-turn',
    });

    // large_capability_result — frozen replacement decisions on prior
    // CAPABILITY_RESULT records. The budget gate uses the already-persisted
    // preview size (not the original size).
    if (record.role === 'CAPABILITY_RESULT' && record.metadata['replacement'] !== undefined) {
      const persisted = record.metadata['replacement'];
      if (persisted !== null && typeof persisted === 'object' && !Array.isArray(persisted)) {
        const previewBytes =
          typeof (persisted as Record<string, unknown>)['previewSize'] === 'number'
            ? ((persisted as Record<string, unknown>)['previewSize'] as number)
            : units;
        sourceCandidates.push({
          category: 'large_capability_result',
          estimatedInputUnits: previewBytes,
          priority: 'optional',
          safeIdentifier: `large_capability_result:${record.messageId}`,
          owningBoundary: 'agent-context-engine.large-content.frozen-decision',
        });
      }
    }
  }

  for (const evidence of attachmentEvidence) {
    if (evidence.decision === 'latest-request-critical' || evidence.decision === 'excluded') {
      continue;
    }
    sourceCandidates.push({
      category: 'attachment_projection',
      estimatedInputUnits: evidence.projectedInputUnits,
      priority: 'optional',
      safeIdentifier: `attachment_projection:${evidence.attachmentId}:${evidence.decision}`,
      owningBoundary: evidence.owningBoundary,
    });
  }

  // capability_disclosure (required priority) — system prompt + tool schemas
  const systemPromptText = systemPrompt.sections.map((s) => s.content).join('\n');
  const systemPromptUnits = estimator.estimateMessageTokens('system', systemPromptText);
  sourceCandidates.push({
    category: 'capability_disclosure',
    estimatedInputUnits: systemPromptUnits,
    priority: 'required',
    safeIdentifier: 'capability_disclosure:system_prompt',
    owningBoundary: 'agent-context-engine.system-prompt',
  });
  minimumSafeContextUnits += systemPromptUnits;

  for (const capability of visibleCapabilities) {
    if (capability.kind !== 'TOOL' || capability.inputSchema === undefined) {
      continue;
    }
    const toolBlob = `${capability.capabilityId} ${capability.description}`;
    const toolUnits = estimator.estimateTokens(toolBlob);
    sourceCandidates.push({
      category: 'capability_disclosure',
      estimatedInputUnits: toolUnits,
      priority: 'required',
      safeIdentifier: `capability_disclosure:tool:${capability.capabilityId}`,
      owningBoundary: 'agent-context-engine.capability-disclosure',
    });
    minimumSafeContextUnits += toolUnits;
  }

  return { sourceCandidates, minimumSafeContextUnits };
}
