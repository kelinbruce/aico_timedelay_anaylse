import { brand } from '@nextagent/agent-common';
import {
  createMemoryLifecycleDiagnostics,
  type MemoryDiagnosticObservationInput,
  type MemoryDiagnosticOwnerScope,
} from '../src/memory-lifecycle-diagnostics.js';
import { describe, expect, it } from 'vitest';

const ownerScope: MemoryDiagnosticOwnerScope = {
  tenantId: brand<string, 'TenantId'>('tenant-memory'),
  subjectId: brand<string, 'SubjectId'>('subject-memory'),
  agentId: brand<string, 'AgentId'>('agent-memory'),
  agentVersion: brand<string, 'AgentVersion'>('v1'),
};

describe('MemoryLifecycleDiagnostics', () => {
  it('projects aging and extraction diagnostics without raw memory or provider payloads', () => {
    const diagnostics = createMemoryLifecycleDiagnostics({
      now: () => brand<number, 'EpochMillis'>(500),
      createObservationEvent: (input: MemoryDiagnosticObservationInput) => input,
    });

    const aging = diagnostics.createAgingDiagnosticObservation(
      {
        status: 'PARTIAL',
        reasonCode: 'MEMORY_AGING_PARTIAL',
        cycleId: 'aging-cycle',
        triggerReason: 'scheduled',
        startedAt: brand<number, 'EpochMillis'>(390),
        processedCount: 4,
        decayedCount: 1,
        archivedCount: 0,
        deletedCount: 0,
        revivedCount: 0,
        skippedCount: 0,
        failureCount: 1,
        reasonCodes: ['MEMORY_AGING_PARTIAL'],
        durationMs: 25,
        completedAt: brand<number, 'EpochMillis'>(400),
      },
      ownerScope,
      ownerScope,
    );
    const extraction = diagnostics.createExtractionDiagnosticObservation(
      {
        status: 'FAILED',
        reasonCode: 'MODEL_UNAVAILABLE',
        strategy: 'LLM_ONLY',
        trajectoryCount: 2,
        acceptedCount: 0,
        rejectedCount: 0,
        writtenCount: 0,
        fusedCount: 0,
        newCount: 0,
        skippedCount: 0,
        failureCount: 1,
        reasonCodes: ['MODEL_UNAVAILABLE'],
        durationMs: 30,
      },
      ownerScope,
      ownerScope,
    );

    expect(aging).toMatchObject({
      boundary: 'system',
      operation: 'MEMORY_AGING_CYCLE',
      outcome: 'degraded',
      safeReasonCode: 'MEMORY_AGING_PARTIAL',
    });
    expect(extraction).toMatchObject({
      boundary: 'system',
      operation: 'MEMORY_EXTRACTION_CYCLE',
      outcome: 'failure',
      safeReasonCode: 'MODEL_UNAVAILABLE',
      occurredAt: 500,
    });
    expect(JSON.stringify([aging, extraction])).not.toMatch(/prompt|memory content|raw|credential|token|provider error|path/iu);
  });
});
