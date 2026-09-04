import { brand } from '@nextagent/agent-common';
import { assertSanitizedObservation, createObservationEvent, sanitizeObservation } from '@nextagent/agent-observability';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ownerScope = {
  tenantId: brand<string, 'TenantId'>('tenant-redaction'),
  subjectId: brand<string, 'SubjectId'>('subject-redaction'),
  agentId: brand<string, 'AgentId'>('agent-redaction'),
  agentVersion: brand<string, 'AgentVersion'>('v1'),
};

describe('unified redaction policy', () => {
  it('sanitizes observation fields before any projector consumes them', () => {
    const sanitized = sanitizeObservation({
      boundary: 'model_invocation',
      operation: 'MODEL_INVOCATION_COMPLETED',
      outcome: 'success',
      ownerScope,
      occurredAt: brand<number, 'EpochMillis'>(1),
      durationMs: 12,
      usage: { inputTokens: 3, outputTokens: 4, totalTokens: 7 },
      safeSummary: 'Model completed.',
      stableRefs: {
        sessionId: 'session-redaction',
        requestRunId: 'run-redaction',
        requestContextId: 'context-redaction',
        timelineEventId: 'event-redaction',
      },
      diagnosticSnapshot: {
        tenantId: ownerScope.tenantId,
        subjectId: ownerScope.subjectId,
        agentId: ownerScope.agentId,
        agentVersion: ownerScope.agentVersion,
        diagnosticCandidates: [
          { key: 'providerKind', value: 'OPENAI', classification: 'LOW_CARDINALITY', cardinality: 'LOW' },
          { key: 'rawProviderError', value: 'Bearer secret', classification: 'SENSITIVE', cardinality: 'HIGH' },
          { key: 'requestRunId', value: 'run-redaction', classification: 'HIGH_CARDINALITY', cardinality: 'HIGH' },
        ],
      },
    });

    expect(sanitized.ownerScope).toEqual(ownerScope);
    expect(sanitized.usage).toEqual({ inputTokens: 3, outputTokens: 4, totalTokens: 7 });
    expect(sanitized.diagnosticSnapshot?.diagnosticCandidates).toEqual([
      { key: 'providerKind', value: 'OPENAI', classification: 'LOW_CARDINALITY', cardinality: 'LOW' },
      { key: 'requestRunId', value: 'run-redaction', classification: 'HIGH_CARDINALITY', cardinality: 'HIGH' },
    ]);
    expect(JSON.stringify(sanitized)).not.toMatch(/Bearer|secret|rawProviderError/i);
    expect(() => assertSanitizedObservation(sanitized)).not.toThrow();
  });

  it('omits unsafe candidate fields and rejects invalid usage', () => {
    const sanitized = sanitizeObservation(
      createObservationEvent({
        boundary: 'gateway_call',
        operation: 'HTTP_RESPONSE',
        outcome: 'failure',
        ownerScope,
        occurredAt: brand<number, 'EpochMillis'>(2),
        diagnosticSnapshot: {
          diagnosticCandidates: [{ key: 'localPath', value: 'C:\\secret\\db.sqlite', classification: 'LOW_CARDINALITY', cardinality: 'LOW' }],
        },
      }),
    );
    expect(sanitized.diagnosticSnapshot?.diagnosticCandidates).toEqual([]);
    expect(JSON.stringify(sanitized)).not.toContain('C:\\secret');

    expect(() =>
      createObservationEvent({
        boundary: 'model_invocation',
        operation: 'MODEL_INVOCATION_COMPLETED',
        outcome: 'success',
        ownerScope,
        occurredAt: brand<number, 'EpochMillis'>(3),
        usage: { inputTokens: -1 },
      }),
    ).toThrow(/usage/i);

    expect(() =>
      createObservationEvent({
        boundary: 'model_invocation',
        operation: 'MODEL_INVOCATION_COMPLETED',
        outcome: 'success',
        ownerScope,
        occurredAt: brand<number, 'EpochMillis'>(4),
        usage: { inputTokens: 1, modelInputTokens: 1 } as never,
      }),
    ).toThrow(/usage/i);
  });

  it('keeps safe reason code enums while omitting raw path diagnostics', () => {
    const sanitized = sanitizeObservation(
      createObservationEvent({
        boundary: 'capability_invocation',
        operation: 'CAPABILITY_DENIED',
        outcome: 'denied',
        ownerScope,
        occurredAt: brand<number, 'EpochMillis'>(5),
        safeReasonCode: 'CAPABILITY_PATH_REJECTED',
        safeSummary: 'CAPABILITY_PATH_REJECTED',
        diagnosticSnapshot: {
          diagnosticCandidates: [
            { key: 'safeErrorCategory', value: 'AUTHORIZATION', classification: 'LOW_CARDINALITY', cardinality: 'LOW' },
            { key: 'filePath', value: 'C:\\secret\\db.sqlite', classification: 'SENSITIVE', cardinality: 'HIGH' },
          ],
        },
      }),
    );

    expect(sanitized.safeReasonCode).toBe('CAPABILITY_PATH_REJECTED');
    expect(sanitized.safeSummary).toBe('CAPABILITY_PATH_REJECTED');
    expect(sanitized.diagnosticSnapshot?.diagnosticCandidates).toEqual([
      { key: 'safeErrorCategory', value: 'AUTHORIZATION', classification: 'LOW_CARDINALITY', cardinality: 'LOW' },
    ]);
    expect(JSON.stringify(sanitized)).not.toContain('C:\\secret');
    expect(() => assertSanitizedObservation(sanitized)).not.toThrow();
  });

  it('keeps redaction internals out of contracts and removes legacy per-surface API', async () => {
    const contractsSource = await readFile(join(process.cwd(), 'packages', 'agent-contracts', 'src', 'index.ts'), 'utf8');
    const observabilityIndex = await readFile(join(process.cwd(), 'packages', 'agent-observability', 'src', 'index.ts'), 'utf8');
    const redactionSource = await readFile(join(process.cwd(), 'packages', 'agent-observability', 'src', 'logging', 'redaction.ts'), 'utf8');

    expect(contractsSource).not.toContain('RedactionSurface');
    expect(contractsSource).not.toContain('RedactionInput');
    expect(observabilityIndex).not.toContain('RedactionSurface');
    expect(observabilityIndex).not.toContain('RedactionInput');
    expect(redactionSource).not.toContain('defaultRedactionPaths');
    expect(redactionSource).not.toContain('export function redact');
  });
});
