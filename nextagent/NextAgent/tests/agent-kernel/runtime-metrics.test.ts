import { createNextAgentTestApp, readCapturedMetricSamples } from '@nextagent/agent-platform-gateway-local/testing';
import { brand } from '@nextagent/agent-common';
import {
  createInMemoryMetricsRegistry,
  createMetricsProjector,
  createObservationEvent,
  timelineObservationFromRecord,
  validateMetricLabels,
} from '@nextagent/agent-observability';
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ownerScope = {
  tenantId: brand<string, 'TenantId'>('tenant-metrics'),
  subjectId: brand<string, 'SubjectId'>('subject-metrics'),
  agentId: brand<string, 'AgentId'>('default-agent'),
  agentVersion: brand<string, 'AgentVersion'>('v1'),
};

describe('runtime metrics', () => {
  it('records the stable runtime metrics inventory with allowed labels', () => {
    const registry = createInMemoryMetricsRegistry();
    const projector = createMetricsProjector(registry);
    projector.project(
      createObservationEvent({
        boundary: 'request_lifecycle',
        operation: 'TERMINAL_COMMITTED',
        outcome: 'success',
        ownerScope,
        occurredAt: brand<number, 'EpochMillis'>(9),
        durationMs: 1250,
        safeReasonCode: 'TERMINAL_COMPLETED',
      }),
    );
    projector.project(
      createObservationEvent({
        boundary: 'gateway_call',
        operation: 'HTTP_RESPONSE',
        outcome: 'success',
        ownerScope,
        occurredAt: brand<number, 'EpochMillis'>(10),
        durationMs: 15,
        diagnosticSnapshot: {
          diagnosticCandidates: [
            { key: 'method', value: 'GET', classification: 'LOW_CARDINALITY', cardinality: 'LOW' },
            { key: 'route', value: '/health', classification: 'LOW_CARDINALITY', cardinality: 'LOW' },
            { key: 'statusFamily', value: '2xx', classification: 'LOW_CARDINALITY', cardinality: 'LOW' },
          ],
        },
      }),
    );
    projector.project(
      createObservationEvent({
        boundary: 'gateway_call',
        operation: 'HTTP_RESPONSE',
        outcome: 'success',
        ownerScope,
        occurredAt: brand<number, 'EpochMillis'>(10),
        durationMs: 5,
        diagnosticSnapshot: {
          diagnosticCandidates: [
            { key: 'method', value: 'GET', classification: 'LOW_CARDINALITY', cardinality: 'LOW' },
            { key: 'route', value: '/api/v1/admin/diagnostics', classification: 'LOW_CARDINALITY', cardinality: 'LOW' },
            { key: 'statusFamily', value: '2xx', classification: 'LOW_CARDINALITY', cardinality: 'LOW' },
          ],
        },
      }),
    );
    projector.project(
      createObservationEvent({
        boundary: 'gateway_call',
        operation: 'HTTP_RESPONSE',
        outcome: 'success',
        ownerScope,
        occurredAt: brand<number, 'EpochMillis'>(10),
        durationMs: 8,
        diagnosticSnapshot: {
          diagnosticCandidates: [
            { key: 'method', value: 'GET', classification: 'LOW_CARDINALITY', cardinality: 'LOW' },
            { key: 'route', value: '/api/v1/sessions', classification: 'LOW_CARDINALITY', cardinality: 'LOW' },
            { key: 'statusFamily', value: '2xx', classification: 'LOW_CARDINALITY', cardinality: 'LOW' },
          ],
        },
      }),
    );
    projector.project(
      createObservationEvent({
        boundary: 'gateway_call',
        operation: 'HTTP_RESPONSE',
        outcome: 'success',
        ownerScope,
        occurredAt: brand<number, 'EpochMillis'>(10),
        durationMs: 12,
        diagnosticSnapshot: {
          diagnosticCandidates: [
            { key: 'method', value: 'POST', classification: 'LOW_CARDINALITY', cardinality: 'LOW' },
            { key: 'route', value: '/api/v1/sessions', classification: 'LOW_CARDINALITY', cardinality: 'LOW' },
            { key: 'statusFamily', value: '2xx', classification: 'LOW_CARDINALITY', cardinality: 'LOW' },
          ],
        },
      }),
    );
    projector.project(
      createObservationEvent({
        boundary: 'gateway_call',
        operation: 'LOCAL_GATEWAY_CALL',
        outcome: 'success',
        ownerScope,
        occurredAt: brand<number, 'EpochMillis'>(10),
        durationMs: 20,
        stableRefs: {},
      }),
    );
    projector.project(
      createObservationEvent({
        boundary: 'model_invocation',
        operation: 'MODEL_INVOCATION_COMPLETED',
        outcome: 'success',
        ownerScope,
        occurredAt: brand<number, 'EpochMillis'>(11),
        durationMs: 25,
        usage: { inputTokens: 3, outputTokens: 2, totalTokens: 5 },
        diagnosticSnapshot: {
          diagnosticCandidates: [{ key: 'providerId', value: 'openai-compatible', classification: 'LOW_CARDINALITY', cardinality: 'LOW' }],
        },
        stableRefs: {},
      }),
    );
    projector.project(
      createObservationEvent({
        boundary: 'model_invocation',
        operation: 'MODEL_STREAM_FIRST_VISIBLE_CONTENT',
        outcome: 'success',
        ownerScope,
        occurredAt: brand<number, 'EpochMillis'>(11),
        durationMs: 40,
        diagnosticSnapshot: {
          diagnosticCandidates: [{ key: 'providerId', value: 'openai-compatible', classification: 'LOW_CARDINALITY', cardinality: 'LOW' }],
        },
      }),
    );
    projector.project(
      createObservationEvent({
        boundary: 'model_invocation',
        operation: 'MODEL_STREAM_VISIBLE_CHUNK',
        outcome: 'success',
        ownerScope,
        occurredAt: brand<number, 'EpochMillis'>(11),
        durationMs: 12,
        diagnosticSnapshot: {
          diagnosticCandidates: [{ key: 'providerId', value: 'openai-compatible', classification: 'LOW_CARDINALITY', cardinality: 'LOW' }],
        },
      }),
    );
    projector.project(
      createObservationEvent({
        boundary: 'model_invocation',
        operation: 'MODEL_STREAM_NO_FIRST_TOKEN',
        outcome: 'failure',
        ownerScope,
        occurredAt: brand<number, 'EpochMillis'>(11),
        durationMs: 80,
        diagnosticSnapshot: {
          diagnosticCandidates: [{ key: 'providerId', value: 'openai-compatible', classification: 'LOW_CARDINALITY', cardinality: 'LOW' }],
        },
      }),
    );
    projector.project(
      createObservationEvent({
        boundary: 'capability_invocation',
        operation: 'CAPABILITY_COMPLETED',
        outcome: 'success',
        ownerScope,
        occurredAt: brand<number, 'EpochMillis'>(12),
        durationMs: 30,
      }),
    );
    projector.project(
      createObservationEvent({
        boundary: 'capability_invocation',
        operation: 'CAPABILITY_DENIED',
        outcome: 'denied',
        ownerScope,
        occurredAt: brand<number, 'EpochMillis'>(13),
        durationMs: 4,
        safeReasonCode: 'CAPABILITY_PATH_REJECTED',
      }),
    );

    const samples = registry.snapshot();
    expect(new Set(samples.map((sample) => sample.name))).toEqual(
      new Set([
        'request_outcome_total',
        'request_duration_seconds',
        'request_phase_duration_seconds',
        'model_invocation_total',
        'model_invocation_duration_seconds',
        'model_token_usage_total',
        'model_token_count',
        'model_ttft_seconds',
        'model_chunk_latency_seconds',
        'model_total_latency_seconds',
        'capability_invocation_total',
        'capability_invocation_duration_seconds',
        'gateway_call_total',
        'gateway_call_duration_seconds',
      ]),
    );
    expect(samples.filter((sample) => sample.name === 'model_token_usage_total')).toHaveLength(3);
    expect(samples.filter((sample) => sample.name === 'model_token_count')).toHaveLength(2);
    expect(samples.filter((sample) => sample.name === 'request_outcome_total' && sample.labels.status === 'COMPLETED')).toHaveLength(1);
    expect(samples).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'model_ttft_seconds', labels: { outcome: 'success' } }),
        expect.objectContaining({ name: 'model_chunk_latency_seconds', labels: {} }),
        expect.objectContaining({ name: 'model_total_latency_seconds', labels: { outcome: 'no_first_token' } }),
        expect.objectContaining({ name: 'capability_invocation_total', labels: { capability_kind: 'TOOL', outcome: 'denied' } }),
      ]),
    );
  });

  it('skips duplicate metric samples for the same stable fact key', () => {
    const registry = createInMemoryMetricsRegistry();
    const projector = createMetricsProjector(registry);
    const observation = createObservationEvent({
      boundary: 'model_invocation',
      operation: 'MODEL_INVOCATION_COMPLETED',
      outcome: 'success',
      ownerScope,
      occurredAt: brand<number, 'EpochMillis'>(14),
      durationMs: 25,
      stableRefs: { timelineEventId: 'event-model-1' },
      diagnosticSnapshot: {
        diagnosticCandidates: [{ key: 'providerId', value: 'openai-compatible', classification: 'LOW_CARDINALITY', cardinality: 'LOW' }],
      },
    });

    expect(projector.project(observation)).toEqual({ surface: 'METRIC', outcome: 'emitted' });
    expect(projector.project(observation)).toEqual({
      surface: 'METRIC',
      outcome: 'skipped_policy_denied',
      safeReasonCode: 'DUPLICATE_METRIC_SAMPLE',
    });
    expect(registry.snapshot().filter((sample) => sample.name === 'model_invocation_total')).toHaveLength(1);
  });

  it('rejects unsafe labels and keeps metrics failures non-blocking', () => {
    const registry = createInMemoryMetricsRegistry();
    expect(validateMetricLabels('request_outcome_total', { status: 'COMPLETED', requestId: 'req-1' })).toEqual({
      surface: 'METRIC',
      outcome: 'degraded',
      safeReasonCode: 'INVALID_METRIC_LABEL',
    });
    expect(validateMetricLabels('gateway_call_total', { gateway_category: 'C:\\secret\\db.sqlite', outcome: 'success' })).toEqual({
      surface: 'METRIC',
      outcome: 'degraded',
      safeReasonCode: 'INVALID_METRIC_LABEL',
    });
    expect(registry.observe('request_duration_seconds', { status: 'COMPLETED' }, -1)).toEqual({
      surface: 'METRIC',
      outcome: 'degraded',
      safeReasonCode: 'INVALID_METRIC_VALUE',
    });
    expect(registry.increment('request_outcome_total', { status: 'FAILED' })).toEqual({ surface: 'METRIC', outcome: 'emitted' });
    expect(registry.snapshot()).toHaveLength(1);

    const unavailableProjector = createMetricsProjector(undefined);
    expect(
      unavailableProjector.project(
        createObservationEvent({
          boundary: 'gateway_call',
          operation: 'LOCAL_GATEWAY_CALL',
          outcome: 'success',
          ownerScope,
          occurredAt: brand<number, 'EpochMillis'>(20),
          stableRefs: {},
        }),
      ),
    ).toEqual({ surface: 'METRIC', outcome: 'degraded', safeReasonCode: 'REGISTRY_UNAVAILABLE' });
  });

  it('records model metrics from wrapper observations and capability metrics from persisted timeline observations', () => {
    const registry = createInMemoryMetricsRegistry();
    const projector = createMetricsProjector(registry);
    const base = {
      tenantId: ownerScope.tenantId,
      subjectId: ownerScope.subjectId,
      agentId: brand<string, 'AgentId'>('default-agent'),
      agentVersion: ownerScope.agentVersion,
      sessionId: brand<string, 'SessionId'>('session-metrics'),
      runId: brand<string, 'RequestRunId'>('run-metrics'),
      requestId: brand<string, 'MessageId'>('request-metrics'),
      requestContextId: brand<string, 'RequestContextId'>('context-metrics'),
      createdAt: brand<number, 'EpochMillis'>(30),
    };

    const modelCompleted = createObservationEvent({
      boundary: 'model_invocation',
      operation: 'MODEL_INVOCATION_COMPLETED',
      outcome: 'success',
      ownerScope,
      occurredAt: brand<number, 'EpochMillis'>(30),
      durationMs: 12,
      stableRefs: { requestRunId: 'run-metrics' },
      diagnosticSnapshot: {
        diagnosticCandidates: [{ key: 'providerId', value: 'openai-compatible', classification: 'LOW_CARDINALITY', cardinality: 'LOW' }],
      },
    });
    const modelFailed = createObservationEvent({
      boundary: 'model_invocation',
      operation: 'MODEL_INVOCATION_FAILED',
      outcome: 'timeout',
      ownerScope,
      occurredAt: brand<number, 'EpochMillis'>(31),
      durationMs: 10,
      safeReasonCode: 'MODEL_TIMEOUT',
      stableRefs: { requestRunId: 'run-metrics' },
      diagnosticSnapshot: {
        diagnosticCandidates: [{ key: 'providerId', value: 'openai-compatible', classification: 'LOW_CARDINALITY', cardinality: 'LOW' }],
      },
    });
    const capabilityCompleted = timelineObservationFromRecord({
      ...base,
      eventId: 'event-capability-completed',
      type: 'CAPABILITY_COMPLETED',
      inlinePayload: { status: 'SUCCEEDED', toolCallId: 'tool-1', capabilityId: 'Read' },
    });
    const policyDenied = timelineObservationFromRecord({
      ...base,
      eventId: 'event-policy-denied',
      type: 'POLICY_APPLIED',
      inlinePayload: {
        operationKind: 'CAPABILITY_INVOCATION',
        operationId: 'Read:tool-1',
        outcome: 'DENY',
        reasonCode: 'OWNER_SCOPE_MISMATCH',
        riskLevel: 'LOW',
        capabilityId: 'Read',
        toolCallId: 'tool-1',
      },
    });

    expect(capabilityCompleted).toBeDefined();
    expect(policyDenied).toBeDefined();
    expect(projector.project(modelCompleted)).toEqual({ surface: 'METRIC', outcome: 'emitted' });
    expect(projector.project(modelFailed)).toEqual({ surface: 'METRIC', outcome: 'emitted' });
    expect(projector.project(capabilityCompleted!)).toEqual({ surface: 'METRIC', outcome: 'emitted' });
    expect(projector.project(policyDenied!)).toEqual({ surface: 'METRIC', outcome: 'emitted' });

    const samples = registry.snapshot();
    expect(samples).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'model_invocation_total', labels: { outcome: 'success' } }),
        expect.objectContaining({ name: 'model_invocation_total', labels: { outcome: 'timeout' } }),
        expect.objectContaining({ name: 'capability_invocation_total', labels: { capability_kind: 'TOOL', outcome: 'success' } }),
        expect.objectContaining({ name: 'policy_decision_total', labels: { operation_kind: 'CAPABILITY_INVOCATION', outcome: 'denied' } }),
      ]),
    );
    expect(samples.some((sample) => 'capability_id' in sample.labels)).toBe(false);
  });

  it('projects attachment intake observations with bounded labels', () => {
    const registry = createInMemoryMetricsRegistry();
    const projector = createMetricsProjector(registry);
    expect(
      projector.project(
        createObservationEvent({
          boundary: 'system',
          operation: 'ATTACHMENT_ACCEPTED',
          outcome: 'success',
          ownerScope,
          occurredAt: brand<number, 'EpochMillis'>(11),
          durationMs: 20,
          diagnosticSnapshot: {
            diagnosticCandidates: [{ key: 'sizeBucket', value: 'small', classification: 'LOW_CARDINALITY', cardinality: 'LOW' }],
          },
        }),
      ),
    ).toEqual({ surface: 'METRIC', outcome: 'emitted' });
    expect(
      projector.project(
        createObservationEvent({
          boundary: 'system',
          operation: 'ATTACHMENT_REJECTED',
          outcome: 'failure',
          ownerScope,
          occurredAt: brand<number, 'EpochMillis'>(12),
          durationMs: 3,
          safeReasonCode: 'ATTACHMENT_TYPE_UNSUPPORTED',
          diagnosticSnapshot: {
            diagnosticCandidates: [{ key: 'sizeBucket', value: 'none', classification: 'LOW_CARDINALITY', cardinality: 'LOW' }],
          },
        }),
      ),
    ).toEqual({ surface: 'METRIC', outcome: 'emitted' });

    const samples = registry.snapshot();
    expect(samples).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'attachment_intake_total', labels: { outcome: 'accepted', reason_code: 'NONE', size_bucket: 'small' } }),
        expect.objectContaining({
          name: 'attachment_intake_duration_seconds',
          labels: { outcome: 'rejected', reason_code: 'ATTACHMENT_TYPE_UNSUPPORTED', size_bucket: 'none' },
        }),
      ]),
    );
  });

  it('does not leak metrics taxonomy into business packages or contracts', () => {
    const forbidden = /metrics-registry|MetricsRegistry|MetricName|health_probe_total|request_outcome_total|@opentelemetry\/api/;
    for (const packageName of ['agent-runtime', 'agent-channel-web', 'agent-core', 'agent-model', 'agent-capability']) {
      const files = rgFiles(join(process.cwd(), 'packages', packageName, 'src'));
      for (const file of files) {
        expect(readFileSync(file, 'utf8'), `${file} must not import metrics taxonomy`).not.toMatch(forbidden);
      }
    }

    for (const file of rgFiles(join(process.cwd(), 'packages', 'agent-contracts', 'src'))) {
      expect(readFileSync(file, 'utf8'), `${file} must not contain metrics types`).not.toMatch(
        /MetricsRegistry|MetricName|health_probe_total|request_outcome_total/,
      );
    }
  });

  it('wires entrypoint and terminal lifecycle metrics through app composition', async () => {
    const workspaceDir = mkdtempSync(join(tmpdir(), 'nextagent-metrics-test-'));
    const app = createNextAgentTestApp({ workspaceDir, modelSteps: [{ content: 'ok' }] });
    try {
      const session = await app.server.inject({ method: 'POST', url: '/api/v1/sessions', payload: {} });
      const accepted = await app.server.inject({
        method: 'POST',
        url: '/api/v1/requests',
        payload: { inputText: 'hello', idempotencyKey: 'metrics-1', sessionId: session.json<{ sessionId: string }>().sessionId },
      });
      expect(accepted.statusCode).toBe(200);
      const body = accepted.json<{ runId: string; sessionId: string }>();
      const stream = await app.server.inject({
        method: 'GET',
        url: `/api/v1/sessions/${body.sessionId}/stream?lastSeenSequence=0&runId=${body.runId}`,
      });
      expect(stream.statusCode).toBe(200);
      expect(stream.body).toContain('event: REQUEST_COMPLETED');
      await waitForMetric(app, 'request_outcome_total');
      await waitForMetric(app, 'model_invocation_total');
      await waitForMetric(app, 'projector_projection_total');

      const samples = readCapturedMetricSamples(app);
      expect(samples).toContainEqual(expect.objectContaining({ name: 'request_outcome_total', labels: { status: 'COMPLETED' } }));
      expect(samples).toContainEqual(expect.objectContaining({ name: 'model_invocation_total', labels: { outcome: 'success' } }));
      expect(samples).toContainEqual(
        expect.objectContaining({ name: 'request_phase_duration_seconds', labels: { phase: 'terminal_commit', status: 'success' } }),
      );
      expect(samples).toContainEqual(expect.objectContaining({ name: 'projector_projection_total', labels: { surface: 'LOG', result: 'emitted' } }));
      expect(body.runId).toBeTruthy();
    } finally {
      await app.close();
      rmSync(workspaceDir, { recursive: true, force: true });
    }
  });
});

function rgFiles(root: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(root)) {
    const path = join(root, entry);
    if (statSync(path).isDirectory()) {
      files.push(...rgFiles(path));
    } else if (path.endsWith('.ts')) {
      files.push(path);
    }
  }
  return files;
}

async function waitForMetric(app: Parameters<typeof readCapturedMetricSamples>[0], name: string): Promise<void> {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (readCapturedMetricSamples(app).some((sample) => sample.name === name)) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Metric ${name} was not recorded.`);
}
