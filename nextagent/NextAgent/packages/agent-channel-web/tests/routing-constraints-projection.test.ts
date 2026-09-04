import { brand, type JsonObject } from '@nextagent/agent-common';
import type { RunTimelineEvent } from '@nextagent/agent-contracts/runtime';
import { projectTimelineEventToStreamEnvelope } from '@nextagent/agent-channel-web';
import { describe, expect, it } from 'vitest';

describe('routing constraints projection', () => {
  it('keeps POLICY_APPLIED routing diagnostics timeline-only and out of the public stream', () => {
    const outcome = projectTimelineEventToStreamEnvelope(policyAppliedEvent());

    expect(outcome).toEqual({ kind: 'TIMELINE_ONLY', eventType: 'POLICY_APPLIED' });
  });

  it('projects only safe degradation details for constraint failures', () => {
    const outcome = projectTimelineEventToStreamEnvelope({
      ...policyAppliedEvent(),
      type: 'DEGRADATION_NOTICE',
      inlinePayload: {
        code: 'ROUTING_PREFERRED_SKILL_FORBIDDEN',
        message: 'Preferred Skill is forbidden by routing constraints.',
        routingConstraints: { targetSkill: 'alarm-diagnosis' },
        rawPrompt: 'hidden',
      } satisfies JsonObject,
    });

    expect(outcome.kind).toBe('ENVELOPE');
    if (outcome.kind === 'ENVELOPE') {
      expect(outcome.envelope.eventType).toBe('DEGRADATION_NOTICE');
      expect(outcome.envelope.payload.code).toBe('ROUTING_PREFERRED_SKILL_FORBIDDEN');
      expect(Object.keys(outcome.envelope.payload)).not.toContain('routingConstraints');
      expect(Object.keys(outcome.envelope.payload)).not.toContain('rawPrompt');
    }
  });
});

function policyAppliedEvent(): RunTimelineEvent {
  return {
    type: 'POLICY_APPLIED',
    eventId: 'timeline-routing-constraints-projection',
    sessionId: brand<string, 'SessionId'>('session-routing-constraints-projection'),
    requestId: brand<string, 'MessageId'>('request-routing-constraints-projection'),
    runId: brand<string, 'RequestRunId'>('run-routing-constraints-projection'),
    requestContextId: brand<string, 'RequestContextId'>('context-routing-constraints-projection'),
    sequence: brand<number, 'TimelineSequence'>(1),
    createdAt: new Date(1_000),
    inlinePayload: {
      policyDomain: 'CONSTRAINT',
      outcome: 'constraint-rejected',
      reasonCode: 'PREFERRED_SKILL_FORBIDDEN',
      selectedCapabilityId: 'alarm-diagnosis',
    } satisfies JsonObject,
  };
}
