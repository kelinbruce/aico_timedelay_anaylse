import { createLocalRagKnowledgeGovernance, createRestrictedLocalSandboxGateway } from '@nextagent/agent-platform-gateway-local';
import { createMetricsRegistry, createTraceProjector } from '@nextagent/agent-observability';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createNextAgentTestApp } from '../src/composition/create-test-composition.js';

describe('otel observability adapter composition', () => {
  it('allows composition to wire a trace projector and remote metrics sink through existing observation handoff', async () => {
    const workspaceDir = mkdtempSync(join(tmpdir(), 'nextagent-otel-observability-'));
    const counterAdds: Array<{ name: string; value: number; labels: Record<string, string> }> = [];
    const histogramRecords: Array<{ name: string; value: number; labels: Record<string, string> }> = [];
    const traceStarts: string[] = [];
    const app = createNextAgentTestApp({
      workspaceDir,
      modelSteps: [{ content: 'ok' }],
      ragRetrievalFactory: createLocalRagKnowledgeGovernance,
      sandboxGatewayFactory: createRestrictedLocalSandboxGateway,
      metricsRegistry: createMetricsRegistry({
        meter: {
          createCounter(name: string) {
            return {
              add(value: number, labels?: Record<string, string>) {
                counterAdds.push({ name, value, labels: labels ?? {} });
              },
            };
          },
          createHistogram(name: string) {
            return {
              record(value: number, labels?: Record<string, string>) {
                histogramRecords.push({ name, value, labels: labels ?? {} });
              },
            };
          },
        } as never,
      }),
      traceProjector: createTraceProjector({
        tracer: {
          startSpan(name: string) {
            traceStarts.push(name);
            return {
              setStatus() {},
              addEvent() {},
              end() {},
            };
          },
        } as never,
      }),
    });
    try {
      const session = await app.server.inject({ method: 'POST', url: '/api/v1/sessions', payload: {} });
      const accepted = await app.server.inject({
        method: 'POST',
        url: '/api/v1/requests',
        payload: {
          inputText: 'hello',
          idempotencyKey: 'otel-observability-1',
          sessionId: session.json<{ sessionId: string }>().sessionId,
        },
      });

      expect(accepted.statusCode).toBe(200);
      const acceptedBody = accepted.json<{ runId: string; sessionId: string }>();
      const stream = await app.server.inject({
        method: 'GET',
        url: `/api/v1/sessions/${acceptedBody.sessionId}/stream?lastSeenSequence=0&runId=${acceptedBody.runId}`,
      });
      expect(stream.statusCode).toBe(200);
      expect(traceStarts.length).toBeGreaterThan(0);
      expect(counterAdds.some((entry) => entry.name === 'projector_projection_total' && entry.labels.surface === 'TRACE')).toBe(true);
      expect(counterAdds.some((entry) => entry.name === 'request_outcome_total')).toBe(true);
      expect(histogramRecords.some((entry) => entry.name === 'request_phase_duration_seconds')).toBe(true);
    } finally {
      await app.close();
      rmSync(workspaceDir, { recursive: true, force: true });
    }
  });
});
