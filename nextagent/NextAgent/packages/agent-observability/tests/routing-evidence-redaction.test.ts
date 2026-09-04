import { brand, type JsonObject } from '@nextagent/agent-common';
import { sanitizeObservation, timelineObservationFromRecord } from '@nextagent/agent-observability';
import { describe, expect, it } from 'vitest';

describe('routing evidence redaction', () => {
  it('sanitizes POLICY_APPLIED observations down to safe low-cardinality evidence', () => {
    const observation = timelineObservationFromRecord({
      tenantId: brand<string, 'TenantId'>('tenant-routing-redaction'),
      subjectId: brand<string, 'SubjectId'>('subject-routing-redaction'),
      agentId: brand<string, 'AgentId'>('agent-routing-redaction'),
      agentVersion: brand<string, 'AgentVersion'>('v1'),
      eventId: 'event-routing-redaction',
      sessionId: brand<string, 'SessionId'>('session-routing-redaction'),
      runId: brand<string, 'RequestRunId'>('run-routing-redaction'),
      requestId: brand<string, 'MessageId'>('request-routing-redaction'),
      requestContextId: brand<string, 'RequestContextId'>('context-routing-redaction'),
      type: 'POLICY_APPLIED',
      inlinePayload: {
        policyDomain: 'MODEL_FALLBACK',
        outcome: 'fallback-applied',
        reasonCode: 'MODEL_PRIMARY_FAILED',
        selectedProfileId: 'fallback-profile',
      } satisfies JsonObject,
      createdAt: brand<number, 'EpochMillis'>(1),
    });

    expect(observation).toBeDefined();
    const sanitized = sanitizeObservation(observation!);
    const serialized = JSON.stringify(sanitized);

    expect(serialized).toContain('MODEL_FALLBACK');
    expect(serialized).toContain('fallback-applied');
    expect(serialized).toContain('MODEL_PRIMARY_FAILED');
    expect(serialized).not.toContain('rawPrompt');
    expect(serialized).not.toContain('capabilityResult');
    expect(serialized).not.toContain('fallback-profile');
    expect(serialized).not.toContain('C:\\');
  });

  it('maps rejected routing evidence to denied observations', () => {
    const observation = timelineObservationFromRecord({
      tenantId: brand<string, 'TenantId'>('tenant-routing-redaction'),
      subjectId: brand<string, 'SubjectId'>('subject-routing-redaction'),
      agentId: brand<string, 'AgentId'>('agent-routing-redaction'),
      agentVersion: brand<string, 'AgentVersion'>('v1'),
      eventId: 'event-routing-rejected',
      sessionId: brand<string, 'SessionId'>('session-routing-redaction'),
      runId: brand<string, 'RequestRunId'>('run-routing-redaction'),
      requestId: brand<string, 'MessageId'>('request-routing-redaction'),
      requestContextId: brand<string, 'RequestContextId'>('context-routing-redaction'),
      type: 'POLICY_APPLIED',
      inlinePayload: {
        policyDomain: 'ROUTING',
        outcome: 'rejected',
        reasonCode: 'POLICY_REJECTED',
      } satisfies JsonObject,
      createdAt: brand<number, 'EpochMillis'>(1),
    });

    expect(observation?.outcome).toBe('denied');
  });
});
