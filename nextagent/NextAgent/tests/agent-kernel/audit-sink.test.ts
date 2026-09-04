import {
  createAuditProjector,
  createObservationEvent,
  timelineObservationFromRecord,
  type AuditEvent,
  type ObservabilityObservationEvent,
} from '@nextagent/agent-observability';
import { brand } from '@nextagent/agent-common';
import type { RuntimeRunTimelineEventRecord } from '@nextagent/agent-contracts/gateway';
import { createUnsupportedRemoteAuditSinkAdapter, type RemoteAuditSinkAdapter } from '@nextagent/agent-platform-gateway-remote';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ownerScope = {
  tenantId: brand<string, 'TenantId'>('tenant-audit'),
  subjectId: brand<string, 'SubjectId'>('subject-audit'),
  agentId: brand<string, 'AgentId'>('default-agent'),
  agentVersion: brand<string, 'AgentVersion'>('v1'),
};

describe('audit sink projector', () => {
  it('writes covered request lifecycle observations through the audit writer', async () => {
    const written: AuditEvent[] = [];
    const projector = createAuditProjector({
      async write(event) {
        written.push(event);
      },
    });

    await expect(
      projector.project(
        createObservationEvent({
          boundary: 'request_lifecycle',
          operation: 'REQUEST_ACCEPTED',
          outcome: 'success',
          ownerScope,
          occurredAt: brand<number, 'EpochMillis'>(1),
          safeSummary: 'Request accepted and queued.',
          stableRefs: {
            auditEventId: 'audit-request-accepted',
            sessionId: 'session-audit',
            requestRunId: 'run-audit',
            requestId: 'request-audit',
          },
          diagnosticSnapshot: {
            tenantId: ownerScope.tenantId,
            subjectId: ownerScope.subjectId,
            agentId: ownerScope.agentId,
            agentVersion: ownerScope.agentVersion,
            diagnosticCandidates: [{ key: 'status', value: 'QUEUED', classification: 'LOW_CARDINALITY', cardinality: 'LOW' }],
          },
        }),
      ),
    ).resolves.toEqual({ surface: 'AUDIT', outcome: 'emitted' });

    expect(written).toEqual([
      expect.objectContaining({
        auditId: 'audit-request-accepted',
        eventName: 'request.accepted',
        tenantId: 'tenant-audit',
        subjectId: 'subject-audit',
        agentId: 'default-agent',
        requestRunId: 'run-audit',
        safeSummary: 'Request accepted and queued.',
        attributes: expect.objectContaining({ boundary: 'request_lifecycle', operation: 'REQUEST_ACCEPTED', outcome: 'success' }),
      }),
    ]);
  });

  it('writes pre-run request rejection audit without a requestRunId', async () => {
    const written: AuditEvent[] = [];
    const projector = createAuditProjector({
      async write(event) {
        written.push(event);
      },
    });

    await expect(
      projector.project(
        createObservationEvent({
          boundary: 'request_lifecycle',
          operation: 'REQUEST_REJECTED',
          outcome: 'failure',
          ownerScope,
          occurredAt: brand<number, 'EpochMillis'>(2),
          safeSummary: 'Runtime command rejected safely.',
          safeReasonCode: 'SUBMIT_IDEMPOTENCY_REQUIRED',
          stableRefs: {
            auditEventId: 'audit-request-rejected',
            sessionId: 'session-audit',
          },
        }),
      ),
    ).resolves.toEqual({ surface: 'AUDIT', outcome: 'emitted' });

    expect(written).toEqual([
      expect.objectContaining({
        auditId: 'audit-request-rejected',
        eventName: 'request.rejected',
        attributes: expect.objectContaining({ operation: 'REQUEST_REJECTED', safeReasonCode: 'SUBMIT_IDEMPOTENCY_REQUIRED' }),
      }),
    ]);
    expect(written[0]).not.toHaveProperty('requestRunId');
  });

  it('maps runtime timeline observations only from persisted timeline records', () => {
    const accepted = timelineRecord({
      eventId: 'event-request-accepted',
      type: 'REQUEST_ACCEPTED',
      inlinePayload: { status: 'QUEUED', content: 'must-not-read' },
    });
    const terminal = timelineRecord({
      eventId: 'event-terminal',
      type: 'REQUEST_COMPLETED',
      inlinePayload: { content: 'terminal content must not enter audit observation' },
    });
    const capabilityFailure = timelineRecord({
      eventId: 'event-capability-failed',
      type: 'CAPABILITY_COMPLETED',
      inlinePayload: {
        status: 'FAILED',
        toolCallId: 'tool-read',
        capabilityId: 'Read',
        safeErrorCategory: 'AUTHORIZATION',
        safeErrorCode: 'CAPABILITY_DENIED',
        toolArgs: { secret: 'must-not-read' },
      },
    });
    const capabilityCompleted = timelineRecord({
      eventId: 'event-capability-completed',
      type: 'CAPABILITY_COMPLETED',
      inlinePayload: {
        status: 'SUCCEEDED',
        toolCallId: 'tool-read-ok',
        capabilityId: 'Read',
        result: { secret: 'must-not-read' },
      },
    });
    const policyDenied = timelineRecord({
      eventId: 'event-policy-denied',
      type: 'POLICY_APPLIED',
      inlinePayload: {
        operationKind: 'CAPABILITY_INVOCATION',
        operationId: 'Read:tool-denied',
        outcome: 'DENY',
        reasonCode: 'OWNER_SCOPE_MISMATCH',
        riskLevel: 'LOW',
        capabilityId: 'Read',
        toolCallId: 'tool-denied',
        toolArgs: { secret: 'must-not-read' },
      },
    });
    const diagnosticOnly = timelineRecord({
      eventId: 'event-diagnostic-only',
      type: 'DEGRADATION_NOTICE',
      inlinePayload: { code: 'REQUEST_RETRY_VISIBILITY_UNAVAILABLE' },
    });

    expect(timelineObservationFromRecord(accepted)).toMatchObject({
      operation: 'REQUEST_ACCEPTED',
      ownerScope,
      stableRefs: { auditEventId: 'audit:event-request-accepted', timelineEventId: 'event-request-accepted' },
    });
    expect(timelineObservationFromRecord(terminal)).toMatchObject({
      operation: 'TERMINAL_COMMITTED',
      safeReasonCode: 'TERMINAL_COMPLETED',
      stableRefs: { auditEventId: 'audit:event-terminal', timelineEventId: 'event-terminal' },
    });
    expect(timelineObservationFromRecord(capabilityFailure)).toMatchObject({
      operation: 'CAPABILITY_DENIED',
      safeReasonCode: 'CAPABILITY_DENIED',
      stableRefs: { auditEventId: 'audit:event-capability-failed', capabilityInvocationId: 'tool-read' },
    });
    expect(timelineObservationFromRecord(capabilityCompleted)).toMatchObject({
      boundary: 'capability_invocation',
      operation: 'CAPABILITY_COMPLETED',
      outcome: 'success',
      stableRefs: { auditEventId: 'audit:event-capability-completed', capabilityInvocationId: 'tool-read-ok' },
    });
    expect(timelineObservationFromRecord(policyDenied)).toMatchObject({
      boundary: 'system',
      operation: 'POLICY_DENIED',
      outcome: 'denied',
      safeReasonCode: 'OWNER_SCOPE_MISMATCH',
      stableRefs: { auditEventId: 'audit:event-policy-denied', timelineEventId: 'event-policy-denied' },
    });
    const modelCompleted = timelineObservationFromRecord(
      timelineRecord({
        eventId: 'event-model-completed',
        type: 'MODEL_INVOCATION_COMPLETED',
        inlinePayload: {
          status: 'SUCCEEDED',
          stepId: 'turn-1',
          modelId: 'model-a',
          ['provider' + 'Kind']: 'OPENAI',
          content: 'must-not-read',
        },
      }),
    );
    expect(modelCompleted).toMatchObject({
      boundary: 'model_invocation',
      operation: 'MODEL_INVOCATION_COMPLETED',
      outcome: 'success',
      stableRefs: { auditEventId: 'audit:event-model-completed', timelineEventId: 'event-model-completed' },
    });
    expect(
      JSON.stringify([
        timelineObservationFromRecord(accepted),
        timelineObservationFromRecord(capabilityFailure),
        timelineObservationFromRecord(capabilityCompleted),
        timelineObservationFromRecord(policyDenied),
        modelCompleted,
      ]),
    ).not.toMatch(/must-not-read|toolArgs|secret|result|model-a|providerKind/i);
    expect(timelineObservationFromRecord(diagnosticOnly)).toMatchObject({
      boundary: 'system',
      operation: 'DEGRADATION_NOTICE',
      outcome: 'degraded',
      safeReasonCode: 'REQUEST_RETRY_VISIBILITY_UNAVAILABLE',
      stableRefs: { auditEventId: 'audit:event-diagnostic-only', timelineEventId: 'event-diagnostic-only' },
    });
  });

  it('maps tool diagnostics generically without RAG-specific timeline mapper fields', () => {
    const observation = timelineObservationFromRecord(
      timelineRecord({
        eventId: 'event-rag-completed',
        type: 'CAPABILITY_COMPLETED',
        inlinePayload: {
          status: 'SUCCEEDED',
          toolCallId: 'tool-rag',
          capabilityId: 'Rag',
          ragStatus: 'SHOULD_NOT_BE_READ',
          ragResultCountBucket: 'SHOULD_NOT_BE_READ',
          toolDiagnostics: [
            { key: 'toolResultStatus', value: 'OK' },
            { key: 'toolResultCountBucket', value: '2-10' },
            { key: 'reasonCode', value: 'NO_INDEX' },
            { key: 'hostPath', value: 'C:\\secret\\kb.md' },
            { key: 'toolResultStatus', value: '/Users/secret/kb.md' },
          ],
        },
      }),
    );

    expect(observation?.diagnosticSnapshot?.diagnosticCandidates).toEqual(
      expect.arrayContaining([
        { key: 'capabilityId', value: 'Rag', classification: 'LOW_CARDINALITY', cardinality: 'LOW' },
        { key: 'toolCallId', value: 'tool-rag', classification: 'LOW_CARDINALITY', cardinality: 'LOW' },
        { key: 'status', value: 'SUCCEEDED', classification: 'LOW_CARDINALITY', cardinality: 'LOW' },
        { key: 'toolResultStatus', value: 'OK', classification: 'LOW_CARDINALITY', cardinality: 'LOW' },
        { key: 'toolResultCountBucket', value: '2-10', classification: 'LOW_CARDINALITY', cardinality: 'LOW' },
        { key: 'reasonCode', value: 'NO_INDEX', classification: 'LOW_CARDINALITY', cardinality: 'LOW' },
      ]),
    );
    expect(JSON.stringify(observation)).not.toContain('SHOULD_NOT_BE_READ');
    expect(JSON.stringify(observation)).not.toContain('C:\\secret');
    expect(JSON.stringify(observation)).not.toContain('/Users/secret');
  });

  it('does not write terminal content to audit attributes', async () => {
    const written: AuditEvent[] = [];
    const projector = createAuditProjector({
      async write(event) {
        written.push(event);
      },
    });
    const terminal = timelineObservationFromRecord(
      timelineRecord({
        eventId: 'event-terminal-content-audit',
        type: 'REQUEST_FAILED',
        inlinePayload: { content: 'Capability policy denied command execution.' },
      }),
    );

    expect(terminal).toBeDefined();
    await expect(projector.project(terminal!)).resolves.toEqual({ surface: 'AUDIT', outcome: 'emitted' });
    expect(JSON.stringify(written)).not.toContain('Capability policy denied command execution.');
  });

  it('does not audit ordinary capability completion diagnostics', async () => {
    const written: AuditEvent[] = [];
    const projector = createAuditProjector({
      async write(event) {
        written.push(event);
      },
    });
    const event = createObservationEvent({
      boundary: 'capability_invocation',
      operation: 'CAPABILITY_COMPLETED',
      outcome: 'success',
      ownerScope,
      occurredAt: brand<number, 'EpochMillis'>(2),
      stableRefs: { auditEventId: 'audit-capability-completed', requestRunId: 'run-audit' },
    });

    expect(projector.covers(event)).toBe(false);
    expect(written).toEqual([]);
  });

  it('does not audit live-only timeline observations', async () => {
    const written: AuditEvent[] = [];
    const projector = createAuditProjector({
      async write(event) {
        written.push(event);
      },
    });
    const liveOnly = timelineObservationFromRecord({
      ...timelineRecord({
        eventId: 'event-live-only',
        type: 'REQUEST_ACCEPTED',
        inlinePayload: { status: 'QUEUED' },
      }),
      persistence: 'LIVE_ONLY',
    });

    expect(liveOnly).toBeDefined();
    expect(projector.covers(liveOnly!)).toBe(false);
    await expect(projector.project(liveOnly!)).resolves.toEqual({ surface: 'AUDIT', outcome: 'skipped_not_covered' });
    expect(written).toEqual([]);
  });

  it('covers mandatory governance and security audit observations', async () => {
    const written: AuditEvent[] = [];
    const projector = createAuditProjector({
      async write(event) {
        written.push(event);
      },
    });
    const covered = [
      ['capability_invocation', 'CAPABILITY_DENIED', 'capability.denied'],
      ['capability_invocation', 'CAPABILITY_SECURITY_FAILED', 'capability.security_failed'],
      ['capability_invocation', 'CAPABILITY_POLICY_BLOCKED', 'capability.policy_blocked'],
      ['model_invocation', 'MODEL_SECURITY_FAILED', 'model.security_failed'],
      ['model_invocation', 'MODEL_CREDENTIAL_FAILED', 'model.credential_failed'],
      ['model_invocation', 'MODEL_QUOTA_FAILED', 'model.quota_failed'],
      ['gateway_call', 'GATEWAY_OWNER_BOUNDARY_FAILED', 'gateway.owner_boundary_failed'],
      ['gateway_call', 'GATEWAY_CREDENTIAL_FAILED', 'gateway.credential_failed'],
      ['system', 'HOOK_INVOKED', 'hook.invoked'],
      ['system', 'HOOK_COMPLETED', 'hook.completed'],
      ['system', 'HOOK_FAILED', 'hook.failed'],
      ['system', 'POLICY_EVALUATED', 'policy.evaluated'],
      ['system', 'POLICY_ALLOWED', 'policy.allowed'],
      ['system', 'POLICY_DENIED', 'policy.denied'],
      ['system', 'POLICY_FAILED', 'policy.failed'],
      ['system', 'ATTACHMENT_ACCEPTED', 'attachment.accepted'],
      ['system', 'ATTACHMENT_REJECTED', 'attachment.rejected'],
      ['system', 'ROUTING_DECISION', 'routing.decision'],
      ['system', 'SAFE_ERROR_EMITTED', 'safe_error.emitted'],
    ] as const;

    for (const [boundary, operation] of covered) {
      const event: ObservabilityObservationEvent = {
        boundary,
        operation,
        outcome: operation.includes('FAILED') || operation.includes('DENIED') || operation.includes('REJECTED') ? 'failure' : 'success',
        ownerScope,
        occurredAt: brand<number, 'EpochMillis'>(2),
        safeSummary: operation,
        stableRefs: { auditEventId: `audit-${operation.toLowerCase().replaceAll('_', '-')}`, requestRunId: 'run-audit' },
      };
      await expect(projector.project(event)).resolves.toEqual({ surface: 'AUDIT', outcome: 'emitted' });
    }

    expect(written.map((event) => event.eventName)).toEqual(covered.map((item) => item[2]));
  });

  it('fails closed when required authoritative refs are missing', async () => {
    const projector = createAuditProjector({
      async write() {
        throw new Error('must not write');
      },
    });

    const event = createObservationEvent({
      boundary: 'request_lifecycle',
      operation: 'REQUEST_ACCEPTED',
      outcome: 'success',
      ownerScope,
      occurredAt: brand<number, 'EpochMillis'>(3),
      stableRefs: { requestRunId: 'run-audit' },
    });

    await expect(projector.project(event)).resolves.toEqual({
      surface: 'AUDIT',
      outcome: 'failed_closed',
      safeReasonCode: 'MISSING_REQUIRED_FIELDS',
    });
  });

  it('degrades on sink write failure without blocking the caller', async () => {
    const projector = createAuditProjector({
      async write() {
        throw new Error('down');
      },
    });

    await expect(
      projector.project(
        createObservationEvent({
          boundary: 'request_lifecycle',
          operation: 'REQUEST_ACCEPTED',
          outcome: 'success',
          ownerScope,
          occurredAt: brand<number, 'EpochMillis'>(4),
          safeSummary: 'Request accepted.',
          stableRefs: { auditEventId: 'audit-sink-down', requestRunId: 'run-audit' },
        }),
      ),
    ).resolves.toEqual({ surface: 'AUDIT', outcome: 'degraded', safeReasonCode: 'SINK_WRITE_FAILED' });
  });

  it('keeps AuditEventWriter imports out of runtime business owner paths', async () => {
    const runtimeSubmit = await readFile(join(process.cwd(), 'packages', 'agent-runtime', 'src', 'lifecycle', 'submit.ts'), 'utf8');
    const runtimeIndex = await readFile(join(process.cwd(), 'packages', 'agent-runtime', 'src', 'index.ts'), 'utf8');
    const timelineMapper = await readFile(
      join(process.cwd(), 'packages', 'agent-observability', 'src', 'trajectory', 'timeline-observation-mapper.ts'),
      'utf8',
    );

    expect(runtimeSubmit).not.toContain('AuditEventWriter');
    expect(runtimeSubmit).not.toMatch(/RuntimeAuditFact|auditObserver|publishRuntimeAuditFact/);
    expect(runtimeIndex).not.toContain('audit-calls');
    expect(timelineMapper).not.toContain('AuditEventWriter');
    expect(timelineMapper).not.toMatch(/ragStatus|ragResultCountBucket/);
  });

  it('keeps remote audit sink interface-only and non-authoritative', async () => {
    const adapter: RemoteAuditSinkAdapter<AuditEvent> = createUnsupportedRemoteAuditSinkAdapter();
    const event: AuditEvent = {
      auditId: 'audit-remote-interface',
      eventName: 'request.accepted',
      tenantId: ownerScope.tenantId,
      subjectId: ownerScope.subjectId,
      agentId: brand<string, 'AgentId'>('agent-audit'),
      requestRunId: brand<string, 'RequestRunId'>('run-audit'),
      safeSummary: 'Remote audit adapter boundary only.',
      attributes: { operation: 'REQUEST_ACCEPTED' },
      occurredAt: brand<number, 'EpochMillis'>(5),
    };
    const remoteSource = await readFile(join(process.cwd(), 'packages', 'agent-platform-gateway-remote', 'src', 'audit-sink.ts'), 'utf8');

    await expect(adapter.writeAuditEvent(event)).resolves.toEqual({ outcome: 'degraded', safeReasonCode: 'REMOTE_AUDIT_SINK_UNIMPLEMENTED' });
    expect(remoteSource).not.toMatch(/CREATE TABLE|INSERT INTO|SELECT .*audit|retry|replay|queue|platform SDK|reporting/i);
  });
});

function timelineRecord(
  overrides: Partial<RuntimeRunTimelineEventRecord> & Pick<RuntimeRunTimelineEventRecord, 'eventId' | 'type' | 'inlinePayload'>,
): RuntimeRunTimelineEventRecord {
  return {
    tenantId: ownerScope.tenantId,
    subjectId: ownerScope.subjectId,
    agentId: brand<string, 'AgentId'>('default-agent'),
    agentVersion: ownerScope.agentVersion,
    sessionId: brand<string, 'SessionId'>('session-audit'),
    runId: brand<string, 'RequestRunId'>('run-audit'),
    requestId: brand<string, 'MessageId'>('request-audit'),
    requestContextId: brand<string, 'RequestContextId'>('context-audit'),
    sequence: brand<number, 'TimelineSequence'>(1),
    createdAt: brand<number, 'EpochMillis'>(10),
    ...overrides,
  };
}
