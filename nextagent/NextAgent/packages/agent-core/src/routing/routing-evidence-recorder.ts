import type { AgentRunStatePort, RequestContext, RequestRun } from '@nextagent/agent-contracts/runtime';
import { isPolicyProjectionPayload } from '../projection/timeline-safe-payload-schemas.js';

export type RoutingPolicyDomain = 'ROUTING' | 'CONSTRAINT' | 'TARGETED_SKILL' | 'MODEL_FALLBACK';

export type RoutingPolicyOutcome =
  | 'selected'
  | 'rejected'
  | 'clarification'
  | 'handoff'
  | 'constraint-accepted'
  | 'constraint-rejected'
  | 'degraded'
  | 'fallback-applied'
  | 'fallback-denied'
  | 'fallback-exhausted';

export interface RoutingPolicyEvidence {
  readonly policyDomain: RoutingPolicyDomain;
  readonly outcome: RoutingPolicyOutcome;
  readonly reasonCode: string;
  readonly selectedCapabilityId?: string;
  readonly selectedProfileId?: string;
}

export class RoutingEvidenceRecorder {
  constructor(private readonly runState: AgentRunStatePort) {}

  async record(run: RequestRun, context: RequestContext, payload: RoutingPolicyEvidence): Promise<void> {
    const inlinePayload = {
      policyId: 'agent-routing-policy',
      policyVersion: 'v1',
      policyDomain: payload.policyDomain,
      policyPoint: payload.policyDomain,
      outcome: payload.outcome,
      reasonCode: payload.reasonCode,
      ...(payload.selectedCapabilityId === undefined ? {} : { selectedCapabilityId: payload.selectedCapabilityId }),
      ...(payload.selectedProfileId === undefined ? {} : { selectedProfileId: payload.selectedProfileId }),
    };
    await this.runState.emitEvent(run, context, {
      type: 'POLICY_APPLIED',
      inlinePayload: isPolicyProjectionPayload(inlinePayload)
        ? inlinePayload
        : { outcome: payload.outcome, reasonCode: payload.reasonCode, projectionUnavailable: 'POLICY_PROJECTION_INVALID' },
    });
  }
}
