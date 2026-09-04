import {
  bindDiagnosticContext,
  createBoundedObservabilityDegradationEvidence,
  createObservationEvent,
  createObservedRuntimeCommandPort,
  createObservabilityProjectorHost,
  createRequestDiagnosticContext,
  openTelemetryTraceMapping,
  runWithObservabilityContext,
  snapshotDiagnosticContextForEvent,
  type ObservabilityProjector,
  type SurfaceProjectionResult,
} from '@nextagent/agent-observability';
import { brand } from '@nextagent/agent-common';
import type { SubmitRequestCommand } from '@nextagent/agent-contracts/runtime';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('trace/log linking foundation', () => {
  it('creates, binds, and snapshots request diagnostic context without overwriting trusted ids', () => {
    const identity = {
      tenantId: brand<string, 'TenantId'>('tenant-linking'),
      subjectId: brand<string, 'SubjectId'>('subject-linking'),
      displayName: 'Linking tester',
    };
    const base = createRequestDiagnosticContext(identity);

    const snapshot = runWithObservabilityContext(base, () =>
      bindDiagnosticContext(
        {
          sessionId: brand<string, 'SessionId'>('session-linking'),
          requestRunId: brand<string, 'RequestRunId'>('run-linking'),
          agentId: brand<string, 'AgentId'>('agent-linking'),
          agentVersion: brand<string, 'AgentVersion'>('v1'),
          diagnosticCandidates: [{ key: 'phase', value: 'accepted', classification: 'LOW_CARDINALITY', cardinality: 'LOW' }],
        },
        () =>
          bindDiagnosticContext(
            {
              sessionId: brand<string, 'SessionId'>('session-overwrite'),
              messageId: brand<string, 'MessageId'>('message-linking'),
              diagnosticCandidates: [{ key: 'attempt', value: 1, classification: 'LOW_CARDINALITY', cardinality: 'LOW' }],
            },
            () => snapshotDiagnosticContextForEvent(),
          ),
      ),
    );

    expect(snapshot).toMatchObject({
      tenantId: 'tenant-linking',
      subjectId: 'subject-linking',
      sessionId: 'session-linking',
      requestRunId: 'run-linking',
      messageId: 'message-linking',
      agentId: 'agent-linking',
      agentVersion: 'v1',
    });
    expect(snapshot).not.toHaveProperty('traceId');
    expect(snapshot).not.toHaveProperty('spanId');
    expect(snapshot?.diagnosticCandidates).toHaveLength(2);
  });

  it('accepts only bounded observation and degradation evidence with trusted owner/time', () => {
    const ownerScope = {
      tenantId: brand<string, 'TenantId'>('tenant-observation'),
      subjectId: brand<string, 'SubjectId'>('subject-observation'),
      agentId: brand<string, 'AgentId'>('agent-observation'),
      agentVersion: brand<string, 'AgentVersion'>('v1'),
    };
    const event = createObservationEvent({
      boundary: 'request_lifecycle',
      operation: 'REQUEST_ACCEPTED',
      outcome: 'success',
      ownerScope,
      occurredAt: brand<number, 'EpochMillis'>(1),
      stableRefs: { sessionId: 'session-1', requestRunId: 'run-1' },
    });
    const degradation = createBoundedObservabilityDegradationEvidence({
      boundary: 'request_lifecycle',
      operation: 'PROJECT_LOG',
      ownerScope,
      occurredAt: brand<number, 'EpochMillis'>(2),
      safeReasonCode: 'SINK_UNAVAILABLE',
    });

    expect(event.stableRefs?.requestRunId).toBe('run-1');
    expect(degradation).toMatchObject({ outcome: 'degraded', safeReasonCode: 'SINK_UNAVAILABLE' });
    expect(
      createBoundedObservabilityDegradationEvidence({
        boundary: 'request_lifecycle',
        operation: 'PROJECT_LOG',
        safeReasonCode: 'MISSING_CONTEXT',
      }),
    ).toBeUndefined();
    expect(() =>
      createObservationEvent({
        boundary: 'gateway_call',
        operation: 'GATEWAY_CALL',
        outcome: 'failure',
        ownerScope,
        occurredAt: brand<number, 'EpochMillis'>(3),
        diagnosticSnapshot: {
          tenantId: ownerScope.tenantId,
          subjectId: ownerScope.subjectId,
          agentId: ownerScope.agentId,
          agentVersion: ownerScope.agentVersion,
          diagnosticCandidates: [{ key: 'rawProvider', value: 'raw body', classification: 'LOW_CARDINALITY', cardinality: 'LOW' }],
        },
      }),
    ).toThrow(/low-cardinality|raw/i);
  });

  it('records explicit projector outcomes without blocking other surfaces', async () => {
    const ownerScope = {
      tenantId: brand<string, 'TenantId'>('tenant-host'),
      subjectId: brand<string, 'SubjectId'>('subject-host'),
      agentId: brand<string, 'AgentId'>('agent-host'),
      agentVersion: brand<string, 'AgentVersion'>('v1'),
    };
    const event = createObservationEvent({
      boundary: 'request_lifecycle',
      operation: 'REQUEST_COMPLETED',
      outcome: 'success',
      ownerScope,
      occurredAt: brand<number, 'EpochMillis'>(4),
    });
    const calls: string[] = [];
    const results: SurfaceProjectionResult[] = [];
    const projectors: readonly ObservabilityProjector[] = [
      {
        surface: 'LOG',
        covers: () => true,
        project: () => {
          calls.push('LOG');
          return { surface: 'LOG', outcome: 'emitted' };
        },
      },
      {
        surface: 'AUDIT',
        covers: () => true,
        project: () => {
          calls.push('AUDIT');
          throw new Error('sink down');
        },
      },
      {
        surface: 'METRIC',
        covers: () => false,
        project: () => {
          calls.push('METRIC');
          return { surface: 'METRIC', outcome: 'emitted' };
        },
      },
    ];

    createObservabilityProjectorHost(projectors, { onProjectionResult: (result) => results.push(result) }).acceptObservation(event);
    await waitFor(() => calls.includes('AUDIT'));
    expect(calls).toEqual(['LOG', 'AUDIT']);
    await waitFor(() => results.length === 3);
    expect(results).toEqual([
      { surface: 'LOG', outcome: 'emitted' },
      { surface: 'AUDIT', outcome: 'degraded', safeReasonCode: 'PROJECTOR_FAILED' },
      { surface: 'METRIC', outcome: 'skipped_not_covered' },
    ]);
  });

  it('keeps invalid or backpressured observations from blocking the caller', async () => {
    const ownerScope = {
      tenantId: brand<string, 'TenantId'>('tenant-host'),
      subjectId: brand<string, 'SubjectId'>('subject-host'),
      agentId: brand<string, 'AgentId'>('agent-host'),
      agentVersion: brand<string, 'AgentVersion'>('v1'),
    };
    const calls: string[] = [];
    const results: SurfaceProjectionResult[] = [];
    const release: Array<() => void> = [];
    const projectors: readonly ObservabilityProjector[] = [
      {
        surface: 'LOG',
        covers: () => true,
        project: () =>
          new Promise<SurfaceProjectionResult>((resolve) => {
            calls.push('LOG');
            release.push(() => resolve({ surface: 'LOG', outcome: 'emitted' }));
          }),
      },
    ];
    const host = createObservabilityProjectorHost(projectors, {
      queueCapacity: 1,
      onProjectionResult: (result) => results.push(result),
    });
    const event = createObservationEvent({
      boundary: 'request_lifecycle',
      operation: 'REQUEST_ACCEPTED',
      outcome: 'success',
      ownerScope,
      occurredAt: brand<number, 'EpochMillis'>(5),
    });

    expect(() => host.acceptObservation({ ...event, operation: 'invalid operation' })).not.toThrow();
    expect(() => host.acceptObservation(event)).not.toThrow();
    expect(() => host.acceptObservation(event)).not.toThrow();
    expect(() => host.acceptObservation(event)).not.toThrow();

    await waitFor(() => calls.length === 1);
    expect(results).toContainEqual({ surface: 'LOG', outcome: 'degraded', safeReasonCode: 'PROJECTOR_FAILED' });
    release.forEach((done) => done());
    await waitFor(() => results.some((result) => result.outcome === 'emitted'));
  });

  it('observes pre-run runtime command rejection through the command wrapper', async () => {
    const observations: unknown[] = [];
    const service = createObservedRuntimeCommandPort(
      {
        async submit(_command: SubmitRequestCommand) {
          throw { code: 'SUBMIT_IDEMPOTENCY_REQUIRED', category: 'VALIDATION' };
        },
        async cancel() {
          return {};
        },
        async retryLatest() {
          return {};
        },
        async editLatest() {
          return {};
        },
        async answerPendingInput() {
          return {};
        },
      },
      {
        defaultRouteAgentScope: {
          agentId: brand<string, 'AgentId'>('agent-command-wrapper'),
          agentVersion: brand<string, 'AgentVersion'>('v1'),
        },
        acceptObservation: (event) => observations.push(event),
        now: () => 20,
      },
    );

    await expect(
      service.submit({
        sessionId: brand<string, 'SessionId'>('session-command-wrapper'),
        identityContext: {
          tenantId: brand<string, 'TenantId'>('tenant-command-wrapper'),
          subjectId: brand<string, 'SubjectId'>('subject-command-wrapper'),
          displayName: 'Command wrapper',
        },
        inputText: 'test',
        attachmentIds: [],
        locale: brand<string, 'RequestLocale'>('zh-CN'),
        idempotencyKey: brand<string, 'IdempotencyKey'>('idem-command-wrapper'),
      }),
    ).rejects.toMatchObject({ code: 'SUBMIT_IDEMPOTENCY_REQUIRED' });

    expect(observations).toEqual([
      expect.objectContaining({
        boundary: 'request_lifecycle',
        operation: 'REQUEST_REJECTED',
        outcome: 'failure',
        safeReasonCode: 'SUBMIT_IDEMPOTENCY_REQUIRED',
        ownerScope: expect.objectContaining({
          tenantId: 'tenant-command-wrapper',
          subjectId: 'subject-command-wrapper',
          agentId: 'agent-command-wrapper',
          agentVersion: 'v1',
        }),
        stableRefs: expect.objectContaining({
          sessionId: 'session-command-wrapper',
          auditEventId: expect.stringContaining('REQUEST_REJECTED'),
        }),
      }),
    ]);
  });

  it('keeps trace SDK and trace ids out of contracts and business owners', async () => {
    const contractSource = await readFile(join(process.cwd(), 'packages', 'agent-contracts', 'src', 'index.ts'), 'utf8');
    const runtimeSource = await readFile(join(process.cwd(), 'packages', 'agent-runtime', 'src', 'lifecycle', 'submit.ts'), 'utf8');
    const gatewaySource = await readFile(join(process.cwd(), 'packages', 'agent-contracts', 'src', 'gateway', 'index.ts'), 'utf8');

    expect(contractSource).not.toContain('@opentelemetry');
    expect(contractSource).not.toContain('interface ObservabilityPort');
    expect(contractSource).not.toContain('type TraceId');
    expect(contractSource).not.toContain('type SpanId');
    expect(runtimeSource).not.toContain('traceId');
    expect(runtimeSource).not.toContain('spanId');
    expect(gatewaySource).not.toContain('traceId');
    expect(gatewaySource).not.toContain('spanId');
  });

  it('freezes the future OpenTelemetry trace projector mapping without implementing an exporter', () => {
    expect(openTelemetryTraceMapping).toEqual({
      synchronousBoundary: 'Span',
      asyncEnvelopeSubscriber: 'SpanLink',
      authoritativeFact: 'SpanEvent',
      traceApprovedCandidate: 'SpanAttribute',
      propagation: 'W3C_TRACE_CONTEXT',
      exporter: 'OTLP_TRACES',
    });
  });

  it('does not keep TraceDiagnosticRecord, local trace JSONL, or remote trace adapter in this change', async () => {
    const localGatewaySource = await readFile(
      join(process.cwd(), 'packages', 'agent-platform-gateway-local', 'src', 'db', 'sqlite-gateway-stores.ts'),
      'utf8',
    );
    const observabilityIndex = await readFile(join(process.cwd(), 'packages', 'agent-observability', 'src', 'index.ts'), 'utf8');
    const remoteIndex = await readFile(join(process.cwd(), 'packages', 'agent-platform-gateway-remote', 'src', 'index.ts'), 'utf8');
    const observabilityContracts = await readFile(join(process.cwd(), 'packages', 'agent-contracts', 'src', 'observability', 'index.ts'), 'utf8');
    const businessOwnerSources = await Promise.all(
      [
        'packages/agent-runtime/src/lifecycle/submit.ts',
        'packages/agent-core/src/index.ts',
        'packages/agent-model/src/index.ts',
        'packages/agent-capability/src/index.ts',
        'packages/agent-channel-web/src/index.ts',
      ].map((path) => readFile(join(process.cwd(), path), 'utf8')),
    );

    expect(existsSync(join(process.cwd(), 'packages', 'agent-observability', 'src', 'linking', 'trace-diagnostic-sink.ts'))).toBe(false);
    expect(existsSync(join(process.cwd(), 'packages', 'agent-observability', 'src', 'linking', 'timeline-wrapper.ts'))).toBe(false);
    expect(existsSync(join(process.cwd(), 'packages', 'agent-platform-gateway-remote', 'src', 'trace-diagnostic-sink.ts'))).toBe(false);
    expect(observabilityIndex).not.toContain('trace-diagnostic-sink');
    expect(observabilityIndex).not.toContain('timeline-wrapper');
    expect(remoteIndex).not.toContain('trace-diagnostic-sink');
    expect(observabilityContracts).not.toMatch(/TraceDiagnosticRecord|TraceDiagnosticSink|trace[-_ ]diagnostic/);
    expect(localGatewaySource).not.toContain('trace_diagnostics');
    expect(localGatewaySource).not.toContain('TraceRecordGateway');
    for (const source of businessOwnerSources) {
      expect(source).not.toMatch(
        /createLocalTraceLogProjector|TraceDiagnosticRecord|RemoteTraceDiagnosticSinkAdapter|createUnsupportedRemoteTraceDiagnosticSinkAdapter/,
      );
    }
  });
});

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error('Timed out waiting for async observation projection.');
}
