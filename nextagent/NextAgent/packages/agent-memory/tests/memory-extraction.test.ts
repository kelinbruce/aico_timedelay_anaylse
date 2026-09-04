import { brand, type SafeError } from '@nextagent/agent-common';
import type {
  GuardrailGatewayPort,
  LongTermMemoryRecord,
  LongTermMemoryStoreGateway,
  LongTermMemoryVersionedUpdateResult,
  SaveLongTermMemoryRequest,
  TaskTrajectoryListResult,
  TaskTrajectoryQueryGateway,
  TaskTrajectoryRecord,
} from '@nextagent/agent-contracts/gateway';
import type { InteractionMemorySourceTrace, MemoryContentByCategory } from '../src/memory-data.js';
import {
  createMemoryExtractionScheduler,
  extractTrajectoryCandidates,
  isMemoryExtractionCronDue,
  memoryExtractionSourceTraceFromTrajectory,
  projectTaskTrajectoryForMemoryExtractionPrompt,
  runMemoryExtractionCycle,
  type MemoryExtractionCandidate,
  type MemoryExtractionConfigSnapshot,
  type MemoryExtractionLlmRequest,
} from '../src/memory-extraction.js';
import { describe, expect, it, vi } from 'vitest';

describe('memory extraction', () => {
  it('skips by default without querying task trajectories or writing memory', async () => {
    const query = fakeTrajectoryQuery([trajectory()]);
    const store = fakeMemoryStore();

    const result = await runMemoryExtractionCycle({
      config: config({ memoryEnabled: false, extractionEnabled: false }),
      scopes: [scope()],
      taskTrajectoryQuery: query,
      store,
    });

    expect(result).toMatchObject({ status: 'SKIPPED', reasonCode: 'EXTRACTION_DISABLED' });
    expect(query.listTaskTrajectories).not.toHaveBeenCalled();
    expect(store.saveLongTermMemory).not.toHaveBeenCalled();
  });

  it('writes a valid procedural candidate from owner-scoped task trajectory projection', async () => {
    const store = fakeMemoryStore();
    const result = await runMemoryExtractionCycle({
      config: config(),
      scopes: [scope()],
      taskTrajectoryQuery: fakeTrajectoryQuery([trajectory()]),
      store,
    });

    expect(result.status).toBe('COMPLETED');
    expect(result.writtenCount).toBeGreaterThanOrEqual(1);
    const proceduralCall = store.saveLongTermMemory.mock.calls.find((call) => (call[0] as SaveLongTermMemoryRequest).memoryType === 'PROCEDURAL');
    expect(proceduralCall?.[0]).toMatchObject({
      tenantId: scope().tenantId,
      subjectId: scope().subjectId,
      agentId: scope().agentId,
      memoryType: 'PROCEDURAL',
      content: expect.stringContaining('query alarm state'),
    });
    expect(proceduralCall?.[1]).toMatchObject({
      idempotencyKey: expect.stringMatching(/^memory-extraction:/u),
    });
    expect((proceduralCall?.[0] as SaveLongTermMemoryRequest).memoryId).toBeUndefined();
  });

  it('extracts explicit telecom definitions from safe request fact projections', async () => {
    const store = fakeMemoryStore();
    const source = trajectory({
      goalSummary: 'Committed completed request run.',
      constraintSummaries: [],
      observations: [
        {
          kind: 'REQUEST_FACT',
          summary: 'definition: ALARM-12233 is 磁盘故障告警',
          sourceRefs: [
            {
              refKind: 'MESSAGE',
              sessionId: brand<string, 'SessionId'>('session-a'),
              requestId: brand<string, 'MessageId'>('request-a'),
              requestRunId: brand<string, 'RequestRunId'>('run-a'),
              messageId: brand<string, 'MessageId'>('message-alarm-definition'),
            },
          ],
          observedAt: brand<number, 'EpochMillis'>(150),
        },
      ],
      actions: [],
      taskOutcomeStatus: 'UNKNOWN',
      outcomeEvidenceLevel: 'MODEL_CLAIM',
    });

    const candidates = extractTrajectoryCandidates(source, 'cycle-a');
    expect(candidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          category: 'CONCEPTUAL',
          content: expect.objectContaining({
            category: 'CONCEPTUAL',
            concept: 'ALARM-12233',
            definition: '磁盘故障告警',
          }),
        }),
      ]),
    );

    const result = await runMemoryExtractionCycle({
      config: config(),
      scopes: [scope()],
      taskTrajectoryQuery: fakeTrajectoryQuery([source]),
      store,
    });

    expect(result).toMatchObject({ status: 'COMPLETED', writtenCount: 1 });
    expect(store.saveLongTermMemory).toHaveBeenCalledWith(
      expect.objectContaining({
        memoryType: 'CONCEPTUAL',
        content: expect.stringContaining('ALARM-12233'),
      }),
      expect.anything(),
    );
  });

  it('treats Chinese telecom definition summaries as conceptual memory only', () => {
    const source = trajectory({
      goalSummary: 'Committed completed request run.',
      constraintSummaries: [],
      observations: [
        {
          kind: 'REQUEST_FACT',
          summary: '黑盒验证-ALARM-26ZK9 代表传输链路中断告警。',
          sourceRefs: [
            {
              refKind: 'MESSAGE',
              sessionId: brand<string, 'SessionId'>('session-a'),
              requestId: brand<string, 'MessageId'>('request-a'),
              requestRunId: brand<string, 'RequestRunId'>('run-a'),
              messageId: brand<string, 'MessageId'>('message-alarm-definition'),
            },
          ],
          observedAt: brand<number, 'EpochMillis'>(150),
        },
      ],
      actions: [
        {
          kind: 'VERIFICATION',
          summary: '黑盒验证轨迹已确认',
          status: 'SUCCEEDED',
          sourceRefs: [
            {
              refKind: 'TIMELINE_EVENT',
              sessionId: brand<string, 'SessionId'>('session-a'),
              requestId: brand<string, 'MessageId'>('request-a'),
              requestRunId: brand<string, 'RequestRunId'>('run-a'),
              timelineEventId: 'event-a',
              timelineSequence: brand<number, 'TimelineSequence'>(1),
            },
          ],
        },
      ],
      taskOutcomeStatus: 'SUCCEEDED',
      outcomeEvidenceLevel: 'VERIFICATION',
    });

    const candidates = extractTrajectoryCandidates(source, 'cycle-a');

    expect(candidates).toEqual([
      expect.objectContaining({
        category: 'CONCEPTUAL',
        content: {
          category: 'CONCEPTUAL',
          concept: '黑盒验证-ALARM-26ZK9',
          definition: '传输链路中断告警',
        },
      }),
    ]);
  });

  it('uses the trusted trajectory scope when multiple agent scopes are configured', async () => {
    const agentB = scope({ agentId: 'agent-b' });
    const store = fakeMemoryStore();

    const result = await runMemoryExtractionCycle({
      config: config(),
      scopes: [scope(), agentB],
      taskTrajectoryQuery: fakeTrajectoryQuery([trajectory({ agentId: agentB.agentId })]),
      store,
    });

    expect(result.writtenCount).toBeGreaterThanOrEqual(1);
    expect(store.saveLongTermMemory).toHaveBeenCalledWith(expect.objectContaining({ agentId: agentB.agentId }), expect.anything());
  });

  it('does not fall back to message history when task trajectory input is missing', async () => {
    const store = fakeMemoryStore();

    const result = await runMemoryExtractionCycle({
      config: config(),
      scopes: [scope()],
      store,
    });

    expect(result).toMatchObject({ status: 'FAILED', reasonCode: 'EXTRACTION_INPUT_UNAVAILABLE' });
    expect(store.saveLongTermMemory).not.toHaveBeenCalled();
  });

  it('rejects trajectories without safe source refs', async () => {
    const store = fakeMemoryStore();
    const result = await runMemoryExtractionCycle({
      config: config(),
      scopes: [scope()],
      taskTrajectoryQuery: fakeTrajectoryQuery([trajectory({ sourceRefs: [] })]),
      store,
    });

    expect(result.status).toBe('SKIPPED');
    expect(result.reasonCodes).toContain('CONTENT_REF_UNAVAILABLE');
    expect(store.saveLongTermMemory).not.toHaveBeenCalled();
  });

  it('writes low-sensitivity user characteristics through the same extraction switch', async () => {
    const store = fakeMemoryStore();
    const auditObserver = vi.fn();
    const candidate = candidateFor('USER_CHARACTERISTICS', {
      category: 'USER_CHARACTERISTICS',
      traits: ['prefers concise telecom troubleshooting summaries'],
      purpose: ['GENERAL'],
    });

    const result = await runMemoryExtractionCycle({
      config: config(),
      scopes: [scope()],
      taskTrajectoryQuery: fakeTrajectoryQuery([trajectory()]),
      extractTrajectoryCandidates: () => [candidate],
      store,
      auditObserver,
    });

    expect(result).toMatchObject({ status: 'COMPLETED', writtenCount: 1 });
    expect(store.saveLongTermMemory).toHaveBeenCalledWith(
      expect.objectContaining({
        memoryType: 'USER_CHARACTERISTICS',
        content: expect.stringContaining('prefers concise telecom troubleshooting summaries'),
      }),
      expect.anything(),
    );
    expect(auditObserver).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'MEMORY_EXTRACTION_WRITE',
        category: 'USER_CHARACTERISTICS',
      }),
    );
    expect(JSON.stringify(auditObserver.mock.calls)).not.toContain('prefers concise telecom troubleshooting summaries');
  });

  it('skips user characteristics writes when the audit path is unavailable', async () => {
    const store = fakeMemoryStore();
    const candidate = candidateFor('USER_CHARACTERISTICS', {
      category: 'USER_CHARACTERISTICS',
      traits: ['prefers concise telecom troubleshooting summaries'],
      purpose: ['GENERAL'],
    });

    const result = await runMemoryExtractionCycle({
      config: config(),
      scopes: [scope()],
      taskTrajectoryQuery: fakeTrajectoryQuery([trajectory()]),
      extractTrajectoryCandidates: () => [candidate],
      store,
    });

    expect(result).toMatchObject({ status: 'SKIPPED', writtenCount: 0 });
    expect(result.reasonCodes).toContain('USER_CHARACTERISTICS_AUDIT_UNAVAILABLE');
    expect(store.saveLongTermMemory).not.toHaveBeenCalled();
  });

  it('rejects unsafe user characteristics without leaking raw trait values', async () => {
    const store = fakeMemoryStore();
    const auditObserver = vi.fn();
    const diagnosticObserver = vi.fn();
    const candidate = candidateFor('USER_CHARACTERISTICS', {
      category: 'USER_CHARACTERISTICS',
      traits: ['password is hunter2'],
      purpose: ['GENERAL'],
    });

    const result = await runMemoryExtractionCycle({
      config: config(),
      scopes: [scope()],
      taskTrajectoryQuery: fakeTrajectoryQuery([trajectory()]),
      extractTrajectoryCandidates: () => [candidate],
      store,
      auditObserver,
      diagnosticObserver,
    });

    expect(result).toMatchObject({ status: 'SKIPPED', writtenCount: 0, rejectedCount: 1 });
    expect(result.reasonCodes).toContain('CANDIDATE_UNSAFE');
    expect(JSON.stringify(result)).not.toContain('hunter2');
    expect(JSON.stringify(diagnosticObserver.mock.calls)).not.toContain('hunter2');
    expect(auditObserver).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'MEMORY_EXTRACTION_USER_CHARACTERISTICS_REJECTED',
        category: 'USER_CHARACTERISTICS',
        sourceRefCount: 1,
      }),
    );
    expect(JSON.stringify(auditObserver.mock.calls)).not.toContain('hunter2');
    expect(store.saveLongTermMemory).not.toHaveBeenCalled();
  });

  it('runs local candidate validation before knowledge admission', async () => {
    const store = fakeMemoryStore();
    const checkKnowledge = vi.fn<GuardrailGatewayPort['checkKnowledge']>(async () => ({ isLegal: true }));
    const candidate = candidateFor('USER_CHARACTERISTICS', {
      category: 'USER_CHARACTERISTICS',
      traits: ['password is local-validation-canary'],
      purpose: ['GENERAL'],
    });

    const result = await runMemoryExtractionCycle({
      config: config(),
      scopes: [scope()],
      taskTrajectoryQuery: fakeTrajectoryQuery([trajectory()]),
      extractTrajectoryCandidates: () => [candidate],
      store,
      guardrail: extractionGuardrail(checkKnowledge),
      auditObserver: vi.fn(),
    });

    expect(result).toMatchObject({ status: 'SKIPPED', writtenCount: 0 });
    expect(result.reasonCodes).toContain('CANDIDATE_UNSAFE');
    expect(checkKnowledge).not.toHaveBeenCalled();
    expect(store.saveLongTermMemory).not.toHaveBeenCalled();
  });

  it('skips a guardrail-blocked candidate and continues later candidates without leaking content', async () => {
    const store = fakeMemoryStore();
    const diagnosticObserver = vi.fn();
    const blockedCanary = 'guard-blocked-content-canary';
    const checkKnowledge = vi.fn<GuardrailGatewayPort['checkKnowledge']>(async (input) =>
      input.texts.some((text) => text.includes(blockedCanary)) ? { isLegal: false } : { isLegal: true },
    );

    const result = await runMemoryExtractionCycle({
      config: config(),
      scopes: [scope()],
      taskTrajectoryQuery: fakeTrajectoryQuery([trajectory()]),
      extractTrajectoryCandidates: () => [
        candidateFor('FACTUAL', {
          category: 'FACTUAL',
          subject: 'BGP peer state',
          claim: `BGP peer uses ${blockedCanary}`,
        }),
        candidateFor('CONCEPTUAL', {
          category: 'CONCEPTUAL',
          concept: 'OSPF neighbor state',
          definition: 'OSPF neighbor state is a durable telecom concept.',
        }),
      ],
      store,
      guardrail: extractionGuardrail(checkKnowledge),
      diagnosticObserver,
    });

    expect(result).toMatchObject({
      status: 'PARTIAL',
      writtenCount: 1,
      skippedCount: 1,
      rejectedCount: 1,
      failureCount: 0,
    });
    expect(result.reasonCodes).toContain('CANDIDATE_UNSAFE');
    expect(store.saveLongTermMemory).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(result)).not.toContain(blockedCanary);
    expect(JSON.stringify(diagnosticObserver.mock.calls)).not.toContain(blockedCanary);
  });

  it.each([
    {
      name: 'PARTIAL after an earlier candidate was written',
      candidates: [
        candidateFor('FACTUAL', {
          category: 'FACTUAL',
          subject: 'BGP peer state',
          claim: 'BGP peer uses the verified ESTABLISHED state.',
        }),
        candidateFor('CONCEPTUAL', {
          category: 'CONCEPTUAL',
          concept: 'OSPF guard unavailable',
          definition: 'OSPF neighbor state includes guard-unavailable-canary.',
        }),
      ],
      expectedStatus: 'PARTIAL',
      expectedWrites: 1,
    },
    {
      name: 'FAILED when every candidate is rejected',
      candidates: [
        candidateFor('CONCEPTUAL', {
          category: 'CONCEPTUAL',
          concept: 'OSPF guard unavailable',
          definition: 'OSPF neighbor state includes guard-unavailable-canary.',
        }),
      ],
      expectedStatus: 'FAILED',
      expectedWrites: 0,
    },
  ])('reports $name when knowledge admission is unavailable', async ({ candidates, expectedStatus, expectedWrites }) => {
    const store = fakeMemoryStore();
    const checkKnowledge = vi.fn<GuardrailGatewayPort['checkKnowledge']>(async (input) =>
      input.texts.some((text) => text.includes('guard-unavailable-canary'))
        ? {
            code: 'GUARDRAIL_KNOWLEDGE_UNAVAILABLE',
            message: 'Knowledge guardrail is unavailable.',
            category: 'UNAVAILABLE',
            retryable: true,
          }
        : { isLegal: true },
    );

    const result = await runMemoryExtractionCycle({
      config: config(),
      scopes: [scope()],
      taskTrajectoryQuery: fakeTrajectoryQuery([trajectory()]),
      extractTrajectoryCandidates: () => candidates,
      store,
      guardrail: extractionGuardrail(checkKnowledge),
    });

    expect(result.status).toBe(expectedStatus);
    expect(result.writtenCount).toBe(expectedWrites);
    expect(result.reasonCodes).toContain('LTM_CONTENT_GUARD_UNAVAILABLE');
    expect(store.saveLongTermMemory).toHaveBeenCalledTimes(expectedWrites);
    expect(JSON.stringify(result)).not.toContain('guard-unavailable-canary');
  });

  it('preserves earlier extraction writes when knowledge admission is canceled', async () => {
    const store = fakeMemoryStore();
    const checkKnowledge = vi.fn<GuardrailGatewayPort['checkKnowledge']>(async (input) =>
      input.texts.some((text) => text.includes('guard-canceled-canary'))
        ? {
            code: 'GUARDRAIL_KNOWLEDGE_CANCELED',
            message: 'Knowledge guardrail was canceled.',
            category: 'CANCELED',
            retryable: false,
          }
        : { isLegal: true },
    );

    const result = await runMemoryExtractionCycle({
      config: config(),
      scopes: [scope()],
      taskTrajectoryQuery: fakeTrajectoryQuery([trajectory()]),
      extractTrajectoryCandidates: () => [
        candidateFor('FACTUAL', {
          category: 'FACTUAL',
          subject: 'BGP peer state',
          claim: 'BGP peer uses the verified ESTABLISHED state.',
        }),
        candidateFor('CONCEPTUAL', {
          category: 'CONCEPTUAL',
          concept: 'OSPF canceled admission',
          definition: 'OSPF neighbor state includes guard-canceled-canary.',
        }),
      ],
      store,
      guardrail: extractionGuardrail(checkKnowledge),
    });

    expect(result).toMatchObject({ status: 'PARTIAL', writtenCount: 1, failureCount: 1 });
    expect(result.reasonCodes).toContain('MEMORY_EXTRACTION_CANCELED');
    expect(store.saveLongTermMemory).toHaveBeenCalledTimes(1);
  });

  it('applies knowledge admission to source-evidence fusion writes', async () => {
    const corroboratingTrajectory = trajectoryWithIdentity('guarded-fusion');
    const existing = memoryRecord({
      longTermMemoryId: 'ltm-guarded-fusion',
      content: {
        category: 'FACTUAL',
        subject: 's1 latency',
        claim: 'threshold is 120ms',
      },
    });
    const store = fakeMemoryStore([existing]);
    const checkKnowledge = vi.fn<GuardrailGatewayPort['checkKnowledge']>(async () => ({ isLegal: false }));

    const result = await runMemoryExtractionCycle({
      config: config(),
      scopes: [scope()],
      taskTrajectoryQuery: fakeTrajectoryQuery([corroboratingTrajectory]),
      extractTrajectoryCandidates: () => [
        candidateForTrajectory(
          corroboratingTrajectory,
          'FACTUAL',
          {
            category: 'FACTUAL',
            subject: 's1 latency',
            claim: 'threshold is 120ms',
          },
          'cycle-guarded-fusion',
        ),
      ],
      store,
      guardrail: extractionGuardrail(checkKnowledge),
    });

    expect(result).toMatchObject({ status: 'SKIPPED', writtenCount: 0, skippedCount: 1 });
    expect(result.reasonCodes).toContain('CANDIDATE_UNSAFE');
    expect(checkKnowledge).toHaveBeenCalledTimes(1);
    expect(store.saveLongTermMemory).not.toHaveBeenCalled();
    expect(store.mutateLongTermMemory).not.toHaveBeenCalled();
  });

  it('deduplicates candidates and records candidate budget diagnostics', async () => {
    const store = fakeMemoryStore();
    const candidates = Array.from({ length: 12 }, (_, index) =>
      candidateFor('FACTUAL', {
        category: 'FACTUAL',
        subject: `cell-${index}`,
        claim: `cell-${index} uses verified neighbor relation`,
      }),
    );

    const result = await runMemoryExtractionCycle({
      config: config({ maxCandidates: 10 }),
      scopes: [scope()],
      taskTrajectoryQuery: fakeTrajectoryQuery([trajectory()]),
      extractTrajectoryCandidates: () => [candidates[0]!, candidates[0]!, ...candidates],
      store,
    });

    expect(result.writtenCount).toBe(10);
    expect(result.reasonCodes).toContain('CANDIDATE_LIMIT_REACHED');
    expect(result.reasonCodes).toContain('EXTRACTION_BUDGET_EXCEEDED');
    expect(store.saveLongTermMemory).toHaveBeenCalledTimes(10);
  });

  it('rejects invalid candidate quality before normalization', async () => {
    const store = fakeMemoryStore();
    const invalidConfidence = {
      ...candidateFor('FACTUAL', {
        category: 'FACTUAL',
        subject: 's1 latency',
        claim: 'threshold is 120ms',
      }),
      confidence: 1.5,
    };

    const result = await runMemoryExtractionCycle({
      config: config(),
      scopes: [scope()],
      taskTrajectoryQuery: fakeTrajectoryQuery([trajectory()]),
      extractTrajectoryCandidates: () => [invalidConfidence],
      store,
    });

    expect(result).toMatchObject({ status: 'SKIPPED', writtenCount: 0, rejectedCount: 1 });
    expect(result.reasonCodes).toContain('CONFIDENCE_INVALID');
    expect(store.saveLongTermMemory).not.toHaveBeenCalled();
  });

  it('fuses equivalent memory through core public store paths and bounded confidence corroboration', async () => {
    const corroboratingTrajectory = trajectoryWithIdentity('b');
    const existing = memoryRecord({
      longTermMemoryId: 'ltm-existing',
      content: {
        category: 'FACTUAL',
        subject: 's1 latency',
        claim: 'threshold is 120ms',
      },
      confidence: 0.5,
      extractionCount: 0,
    });
    const store = fakeMemoryStore([existing]);
    const candidate = candidateForTrajectory(
      corroboratingTrajectory,
      'FACTUAL',
      {
        category: 'FACTUAL',
        subject: 's1 latency',
        claim: 'threshold is 120ms',
      },
      'cycle-b',
    );

    const result = await runMemoryExtractionCycle({
      config: config(),
      scopes: [scope()],
      taskTrajectoryQuery: fakeTrajectoryQuery([corroboratingTrajectory]),
      extractTrajectoryCandidates: () => [candidate],
      store,
    });

    expect(result).toMatchObject({ status: 'COMPLETED', fusedCount: 1, newCount: 0 });
    expect(store.listLongTermMemory).toHaveBeenCalledWith(expect.objectContaining({ memoryType: 'FACTUAL', state: 'ACTIVE' }));
    expect(store.getLongTermMemory).toHaveBeenCalledWith(expect.objectContaining({ memoryId: existing.memoryId }));
    expect(store.mutateLongTermMemory).toHaveBeenCalledWith(
      expect.objectContaining({
        memoryId: existing.memoryId,
        delta: 0.1,
      }),
      expect.objectContaining({ expectedVersion: 2 }),
    );
  });

  it('skips repeated dreaming over the same source evidence', async () => {
    const existing = memoryRecord({
      longTermMemoryId: 'ltm-duplicate-evidence',
      content: {
        category: 'FACTUAL',
        subject: 's1 latency',
        claim: 'threshold is 120ms',
      },
      confidence: 0.5,
      extractionCount: 0,
    });
    const store = fakeMemoryStore([existing]);
    const candidate = candidateFor('FACTUAL', {
      category: 'FACTUAL',
      subject: 's1 latency',
      claim: 'threshold is 120ms',
    });

    const result = await runMemoryExtractionCycle({
      config: config(),
      scopes: [scope()],
      taskTrajectoryQuery: fakeTrajectoryQuery([trajectory()]),
      extractTrajectoryCandidates: () => [candidate],
      store,
    });

    expect(result).toMatchObject({ status: 'SKIPPED', skippedCount: 1, writtenCount: 0, fusedCount: 0 });
    expect(result.reasonCodes).toContain('DUPLICATE_SOURCE_EVIDENCE');
    expect(store.saveLongTermMemory).not.toHaveBeenCalled();
    expect(store.mutateLongTermMemory).not.toHaveBeenCalled();
  });

  it('merges new same-run source refs without confidence corroboration', async () => {
    const baseTrace = memoryExtractionSourceTraceFromTrajectory(trajectory(), 'cycle-existing');
    const existing = memoryRecord({
      longTermMemoryId: 'ltm-same-run-evidence',
      content: {
        category: 'FACTUAL',
        subject: 's1 latency',
        claim: 'threshold is 120ms',
      },
      confidence: 0.5,
      extractionCount: 0,
      sourceTrace: baseTrace,
    });
    const extraMessage = brand<string, 'MessageId'>('message-extra');
    const candidate = {
      ...candidateFor('FACTUAL', {
        category: 'FACTUAL',
        subject: 's1 latency',
        claim: 'threshold is 120ms',
      }),
      sourceTrace: {
        ...baseTrace,
        extractionCycleId: 'cycle-extra',
        messageRefs: [...(baseTrace.messageRefs ?? []), extraMessage],
        refs: (baseTrace.refs ?? []).map((ref) => ({
          ...ref,
          extractionCycleId: 'cycle-extra',
          messageRefs: [...(ref.messageRefs ?? []), extraMessage],
        })),
      },
    };
    const store = fakeMemoryStore([existing]);

    const result = await runMemoryExtractionCycle({
      config: config(),
      scopes: [scope()],
      taskTrajectoryQuery: fakeTrajectoryQuery([trajectory()]),
      extractTrajectoryCandidates: () => [candidate],
      store,
    });

    expect(result).toMatchObject({ status: 'COMPLETED', fusedCount: 1 });
    expect(result.reasonCodes).toContain('SOURCE_EVIDENCE_MERGED');
    expect(store.saveLongTermMemory).toHaveBeenCalledWith(expect.objectContaining({ memoryId: existing.memoryId }), expect.any(Object));
    expect(store.mutateLongTermMemory).not.toHaveBeenCalled();
  });

  it('does not increase confidence after the corroboration limit', async () => {
    const corroboratingTrajectory = trajectoryWithIdentity('b');
    const existing = memoryRecord({
      longTermMemoryId: 'ltm-corroborated',
      content: {
        category: 'FACTUAL',
        subject: 's1 latency',
        claim: 'threshold is 120ms',
      },
      extractionCount: 2,
    });
    const store = fakeMemoryStore([existing]);

    const result = await runMemoryExtractionCycle({
      config: config(),
      scopes: [scope()],
      taskTrajectoryQuery: fakeTrajectoryQuery([corroboratingTrajectory]),
      extractTrajectoryCandidates: () => [
        candidateForTrajectory(
          corroboratingTrajectory,
          'FACTUAL',
          {
            category: 'FACTUAL',
            subject: 's1 latency',
            claim: 'threshold is 120ms',
          },
          'cycle-b',
        ),
      ],
      store,
    });

    expect(result).toMatchObject({ status: 'COMPLETED', fusedCount: 1 });
    expect(result.reasonCodes).toContain('CORROBORATION_LIMIT_REACHED');
    expect(store.mutateLongTermMemory).not.toHaveBeenCalled();
  });

  it('skips conflicting existing memory instead of creating a competing active record', async () => {
    const existing = memoryRecord({
      longTermMemoryId: 'ltm-conflict',
      content: {
        category: 'FACTUAL',
        subject: 's1 latency',
        claim: 'threshold is 120ms',
      },
    });
    const store = fakeMemoryStore([existing]);
    const candidate = candidateFor('FACTUAL', {
      category: 'FACTUAL',
      subject: 's1 latency',
      claim: 'threshold is 200ms',
    });

    const result = await runMemoryExtractionCycle({
      config: config(),
      scopes: [scope()],
      taskTrajectoryQuery: fakeTrajectoryQuery([trajectory()]),
      extractTrajectoryCandidates: () => [candidate],
      store,
    });

    expect(result).toMatchObject({ status: 'SKIPPED', writtenCount: 0 });
    expect(result.reasonCodes).toContain('CROSS_SESSION_CONFLICTING_EVIDENCE');
    expect(store.saveLongTermMemory).not.toHaveBeenCalled();
  });

  it('skips ambiguous existing memory instead of creating a competing active record', async () => {
    const existing = memoryRecord({
      longTermMemoryId: 'ltm-ambiguous',
      content: {
        category: 'FACTUAL',
        subject: 's1 latency threshold',
        claim: 'threshold is 120ms',
      },
    });
    const store = fakeMemoryStore([existing]);
    const candidate = candidateFor('FACTUAL', {
      category: 'FACTUAL',
      subject: 's1 latency alarm',
      claim: 'alarm should be checked after handover changes',
    });

    const result = await runMemoryExtractionCycle({
      config: config(),
      scopes: [scope()],
      taskTrajectoryQuery: fakeTrajectoryQuery([trajectory()]),
      extractTrajectoryCandidates: () => [candidate],
      store,
    });

    expect(result).toMatchObject({ status: 'SKIPPED', writtenCount: 0 });
    expect(result.reasonCodes).toContain('CROSS_SESSION_AMBIGUOUS');
    expect(store.saveLongTermMemory).not.toHaveBeenCalled();
  });

  it('skips new writes when the bounded fusion scan is saturated', async () => {
    const existing = memoryRecord({
      longTermMemoryId: 'ltm-unrelated',
      content: {
        category: 'FACTUAL',
        subject: 'handover window',
        claim: 'maintenance starts at 02:00',
      },
    });
    const store = fakeMemoryStore([existing]);

    const result = await runMemoryExtractionCycle({
      config: config({ maxCandidates: 1 }),
      scopes: [scope()],
      taskTrajectoryQuery: fakeTrajectoryQuery([trajectory()]),
      extractTrajectoryCandidates: () => [
        candidateFor('FACTUAL', {
          category: 'FACTUAL',
          subject: 's1 latency',
          claim: 'threshold is 120ms',
        }),
      ],
      store,
    });

    expect(result).toMatchObject({ status: 'SKIPPED', writtenCount: 0 });
    expect(result.reasonCodes).toContain('FUSION_SCAN_LIMIT_REACHED');
    expect(store.saveLongTermMemory).not.toHaveBeenCalled();
  });

  it('maps storage unavailable to a safe failed diagnostic', async () => {
    const store = fakeMemoryStore();
    store.saveLongTermMemory.mockResolvedValueOnce({
      code: 'LTM_STORAGE_UNAVAILABLE',
      message: 'storage backend unavailable',
      category: 'UNAVAILABLE',
      retryable: true,
    });

    const result = await runMemoryExtractionCycle({
      config: config(),
      scopes: [scope()],
      taskTrajectoryQuery: fakeTrajectoryQuery([trajectory()]),
      extractTrajectoryCandidates: () => [
        candidateFor('FACTUAL', {
          category: 'FACTUAL',
          subject: 's1 latency',
          claim: 'threshold is 120ms',
        }),
      ],
      store,
    });

    expect(result).toMatchObject({ status: 'FAILED', writtenCount: 0, failureCount: 1 });
    expect(result.reasonCodes).toContain('LTM_STORAGE_UNAVAILABLE');
    expect(JSON.stringify(result)).not.toContain('storage backend unavailable');
  });

  it('degrades explicitly when LLM extraction is requested but no model strategy is available', async () => {
    const store = fakeMemoryStore();
    const result = await runMemoryExtractionCycle({
      config: config({ strategy: 'LLM_ONLY' }),
      scopes: [scope()],
      taskTrajectoryQuery: fakeTrajectoryQuery([trajectory()]),
      store,
    });

    expect(result).toMatchObject({ status: 'FAILED', reasonCode: 'MODEL_UNAVAILABLE' });
    expect(store.saveLongTermMemory).not.toHaveBeenCalled();
  });

  it('maps timeout before task query to a safe failed diagnostic', async () => {
    const now = vi.spyOn(Date, 'now');
    now.mockReturnValueOnce(0);
    now.mockReturnValueOnce(0);
    now.mockReturnValueOnce(100);
    try {
      const query = fakeTrajectoryQuery([trajectory()]);
      const result = await runMemoryExtractionCycle({
        config: config({ timeoutMs: 50 }),
        scopes: [scope()],
        taskTrajectoryQuery: query,
        store: fakeMemoryStore(),
        now: () => brand<number, 'EpochMillis'>(1000),
      });

      expect(result).toMatchObject({ status: 'FAILED', reasonCode: 'MEMORY_EXTRACTION_TIMEOUT' });
      expect(query.listTaskTrajectories).not.toHaveBeenCalled();
    } finally {
      now.mockRestore();
    }
  });

  it('cancels and stops waiting for a hanging LLM when the extraction cycle deadline expires', async () => {
    const store = fakeMemoryStore();
    const llmStrategy = vi.fn((_request: MemoryExtractionLlmRequest, _signal?: AbortSignal) => new Promise<SafeError>(() => undefined));

    const result = await runMemoryExtractionCycle({
      config: config({ strategy: 'LLM_ONLY', timeoutMs: 10 }),
      scopes: [scope()],
      taskTrajectoryQuery: fakeTrajectoryQuery([trajectory()]),
      llmStrategy,
      store,
    });

    expect(result).toMatchObject({ status: 'FAILED', reasonCode: 'MEMORY_EXTRACTION_TIMEOUT', writtenCount: 0 });
    expect(llmStrategy).toHaveBeenCalledTimes(1);
    expect(llmStrategy.mock.calls[0]?.[1]?.aborted).toBe(true);
    expect(store.saveLongTermMemory).not.toHaveBeenCalled();
  });

  it('reports partial timeout after a completed write and stops remaining candidates', async () => {
    const store = fakeMemoryStore();
    const save = store.saveLongTermMemory.getMockImplementation() as LongTermMemoryStoreGateway['saveLongTermMemory'] | undefined;
    if (save === undefined) {
      throw new Error('fake memory store save implementation is missing');
    }
    store.saveLongTermMemory.mockImplementationOnce(async (...args: Parameters<typeof save>) => {
      const result = await save(...args);
      await new Promise((resolve) => setTimeout(resolve, 20));
      return result;
    });

    const result = await runMemoryExtractionCycle({
      config: config({ timeoutMs: 10 }),
      scopes: [scope()],
      taskTrajectoryQuery: fakeTrajectoryQuery([trajectory()]),
      extractTrajectoryCandidates: () => [
        candidateFor('FACTUAL', { category: 'FACTUAL', subject: 'BGP ASN', claim: 'Peer ASN is 65001' }),
        candidateFor('FACTUAL', { category: 'FACTUAL', subject: 'BGP timer', claim: 'Hold timer is 90ms' }),
      ],
      store,
    });

    expect(result).toMatchObject({
      status: 'PARTIAL',
      reasonCode: 'MEMORY_EXTRACTION_TIMEOUT',
      writtenCount: 1,
      newCount: 1,
      failureCount: 1,
    });
    expect(store.saveLongTermMemory).toHaveBeenCalledTimes(1);
  });

  it('falls back to LLM only when RULE_FIRST yields no accepted candidates', async () => {
    const store = fakeMemoryStore();
    const llmStrategy = vi.fn(async () => ({
      candidates: [
        candidateFor('CONCEPTUAL', {
          category: 'CONCEPTUAL',
          concept: 'S1 latency threshold',
          definition: 'The verified latency threshold is 120ms.',
        }),
      ],
      reasonCode: 'LLM_EXTRACTION_ATTEMPTED',
    }));

    const result = await runMemoryExtractionCycle({
      config: config(),
      scopes: [scope()],
      taskTrajectoryQuery: fakeTrajectoryQuery([trajectory()]),
      extractTrajectoryCandidates: () => [],
      llmStrategy,
      store,
    });

    expect(result).toMatchObject({ status: 'COMPLETED', writtenCount: 1 });
    expect(llmStrategy).toHaveBeenCalledTimes(1);

    llmStrategy.mockClear();
    await runMemoryExtractionCycle({
      config: config(),
      scopes: [scope()],
      taskTrajectoryQuery: fakeTrajectoryQuery([trajectory()]),
      extractTrajectoryCandidates: () => [
        candidateFor('FACTUAL', {
          category: 'FACTUAL',
          subject: 's1 latency',
          claim: 'threshold is 120ms',
        }),
      ],
      llmStrategy,
      store: fakeMemoryStore(),
    });
    expect(llmStrategy).not.toHaveBeenCalled();
  });

  it('falls back to LLM when RULE_FIRST only yields rejected candidates', async () => {
    const store = fakeMemoryStore();
    const llmStrategy = vi.fn(async () => ({
      candidates: [
        candidateFor('CONCEPTUAL', {
          category: 'CONCEPTUAL',
          concept: 'S1 latency threshold',
          definition: 'The verified latency threshold is 120ms.',
        }),
      ],
      reasonCode: 'LLM_EXTRACTION_ATTEMPTED',
    }));

    const result = await runMemoryExtractionCycle({
      config: config(),
      scopes: [scope()],
      taskTrajectoryQuery: fakeTrajectoryQuery([trajectory()]),
      extractTrajectoryCandidates: () => [
        candidateFor('USER_CHARACTERISTICS', {
          category: 'USER_CHARACTERISTICS',
          traits: ['password is hunter2'],
          purpose: ['GENERAL'],
        }),
      ],
      llmStrategy,
      store,
    });

    expect(result).toMatchObject({ status: 'PARTIAL', writtenCount: 1, rejectedCount: 1 });
    expect(result.reasonCodes).toContain('CANDIDATE_UNSAFE');
    expect(result.reasonCodes).toContain('LLM_EXTRACTION_ATTEMPTED');
    expect(llmStrategy).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(result)).not.toContain('hunter2');
  });

  it('filters runtime metadata so RULE_FIRST can fall back to LLM', async () => {
    const store = fakeMemoryStore();
    const noisyTrajectory = trajectory({
      goalSummary: 'Committed completed request run.',
      constraintSummaries: ['messages:10', 'timelineEvents:11'],
      observations: [
        {
          kind: 'TERMINAL_STATUS',
          summary: 'Terminal status COMPLETED.',
          sourceRefs: trajectory().sourceRefs,
          observedAt: brand<number, 'EpochMillis'>(200),
        },
        {
          kind: 'TOOL_RESULT',
          summary: 'CAPABILITY_COMPLETED capability:add_memory status:FAILED code:CAPABILITY_INPUT_INVALID',
          sourceRefs: trajectory().sourceRefs,
          observedAt: brand<number, 'EpochMillis'>(201),
        },
      ],
      actions: [],
    });
    const llmStrategy = vi.fn(async () => ({
      candidates: [
        candidateForTrajectory(
          noisyTrajectory,
          'CONCEPTUAL',
          {
            category: 'CONCEPTUAL',
            concept: 'ALARM-12233',
            definition: '磁盘故障告警',
          },
          'cycle-a',
        ),
      ],
      reasonCode: 'LLM_EXTRACTION_ATTEMPTED',
    }));

    const result = await runMemoryExtractionCycle({
      config: config(),
      scopes: [scope()],
      taskTrajectoryQuery: fakeTrajectoryQuery([noisyTrajectory]),
      llmStrategy,
      store,
    });

    expect(result).toMatchObject({ status: 'COMPLETED', writtenCount: 1 });
    expect(llmStrategy).toHaveBeenCalledTimes(1);
    expect(store.saveLongTermMemory).toHaveBeenCalledWith(
      expect.objectContaining({
        memoryType: 'CONCEPTUAL',
        content: expect.stringContaining('ALARM-12233'),
      }),
      expect.anything(),
    );
    const writes = store.saveLongTermMemory.mock.calls.map((call) => JSON.stringify(call[0]));
    expect(writes.join('\n')).not.toContain('messages:10');
    expect(writes.join('\n')).not.toContain('Terminal status COMPLETED');
    expect(writes.join('\n')).not.toContain('CAPABILITY_INPUT_INVALID');
  });

  it('uses LLM for safe request notes that rules do not extract', async () => {
    const store = fakeMemoryStore();
    const source = trajectory({
      goalSummary: 'Committed completed request run.',
      constraintSummaries: [],
      observations: [
        {
          kind: 'REQUEST_FACT',
          summary: 'llm-note: BGP-PEER-DOWN 归到 BGP 邻居中断类告警',
          sourceRefs: trajectory().sourceRefs,
          observedAt: brand<number, 'EpochMillis'>(220),
        },
      ],
      actions: [],
    });
    const llmStrategy = vi.fn(async () => ({
      candidates: [
        candidateForTrajectory(
          source,
          'CONCEPTUAL',
          {
            category: 'CONCEPTUAL',
            concept: 'BGP-PEER-DOWN',
            definition: 'BGP 邻居中断类告警',
          },
          'cycle-a',
        ),
      ],
      reasonCode: 'LLM_EXTRACTION_ATTEMPTED',
    }));

    expect(extractTrajectoryCandidates(source)).toEqual([]);

    const result = await runMemoryExtractionCycle({
      config: config(),
      scopes: [scope()],
      taskTrajectoryQuery: fakeTrajectoryQuery([source]),
      llmStrategy,
      store,
    });

    expect(result).toMatchObject({ status: 'COMPLETED', writtenCount: 1 });
    expect(llmStrategy).toHaveBeenCalledTimes(1);
    expect(store.saveLongTermMemory).toHaveBeenCalledWith(
      expect.objectContaining({
        memoryType: 'CONCEPTUAL',
        content: expect.stringContaining('BGP-PEER-DOWN'),
      }),
      expect.anything(),
    );
  });

  it('caps LLM self-reported confidence before writing memory', async () => {
    const store = fakeMemoryStore();
    const source = trajectory({
      goalSummary: 'Committed completed request run.',
      constraintSummaries: [],
      observations: [
        {
          kind: 'REQUEST_FACT',
          summary: 'llm-note: ALARM-90077 maps to transport link quality degradation',
          sourceRefs: trajectory().sourceRefs,
          observedAt: brand<number, 'EpochMillis'>(220),
        },
      ],
      actions: [],
    });
    const llmStrategy = vi.fn(async (request: MemoryExtractionLlmRequest) => ({
      candidates: [
        {
          ...candidateForTrajectory(
            source,
            'CONCEPTUAL',
            {
              category: 'CONCEPTUAL',
              concept: 'ALARM-90077',
              definition: 'is transport link quality degradation alarm class',
            },
            request.cycleId,
          ),
          confidence: 0.95,
        },
      ],
      reasonCode: 'LLM_EXTRACTION_ATTEMPTED',
    }));

    const result = await runMemoryExtractionCycle({
      config: config(),
      scopes: [scope()],
      taskTrajectoryQuery: fakeTrajectoryQuery([source]),
      llmStrategy,
      store,
    });

    expect(result).toMatchObject({ status: 'COMPLETED', writtenCount: 1 });
    expect(store.saveLongTermMemory).toHaveBeenCalledWith(
      expect.objectContaining({
        memoryType: 'CONCEPTUAL',
        confidence: 0.75,
      }),
      expect.anything(),
    );
  });

  it('does not let accepted rule candidates starve LLM-only request notes', async () => {
    const store = fakeMemoryStore();
    const ruleSource = trajectory({
      taskTrajectoryId: brand<string, 'TaskTrajectoryId'>('trajectory-rule-definition'),
      requestId: brand<string, 'MessageId'>('request-rule-definition'),
      requestRunId: brand<string, 'RequestRunId'>('run-rule-definition'),
      goalSummary: 'Committed completed request run.',
      constraintSummaries: [],
      observations: [
        {
          kind: 'REQUEST_FACT',
          summary: 'definition: ALARM-12233 is 磁盘故障告警',
          sourceRefs: trajectory().sourceRefs,
          observedAt: brand<number, 'EpochMillis'>(210),
        },
      ],
      actions: [],
    });
    const llmSource = trajectory({
      taskTrajectoryId: brand<string, 'TaskTrajectoryId'>('trajectory-llm-note'),
      requestId: brand<string, 'MessageId'>('request-llm-note'),
      requestRunId: brand<string, 'RequestRunId'>('run-llm-note'),
      goalSummary: 'Committed completed request run.',
      constraintSummaries: [],
      observations: [
        {
          kind: 'REQUEST_FACT',
          summary: 'llm-note: BGP-PEER-DOWN 归到 BGP 邻居中断类告警',
          sourceRefs: trajectory().sourceRefs,
          observedAt: brand<number, 'EpochMillis'>(220),
        },
      ],
      actions: [],
    });
    const llmStrategy = vi.fn(async (request: MemoryExtractionLlmRequest) => ({
      candidates: [
        candidateForTrajectory(
          llmSource,
          'CONCEPTUAL',
          {
            category: 'CONCEPTUAL',
            concept: 'BGP-PEER-DOWN',
            definition: 'BGP 邻居中断类告警',
          },
          request.cycleId,
        ),
      ],
      reasonCode: 'LLM_EXTRACTION_ATTEMPTED',
    }));

    const result = await runMemoryExtractionCycle({
      config: config(),
      scopes: [scope()],
      taskTrajectoryQuery: fakeTrajectoryQuery([ruleSource, llmSource]),
      llmStrategy,
      store,
    });

    expect(result).toMatchObject({ status: 'COMPLETED', writtenCount: 2 });
    expect(result.reasonCodes).toContain('LLM_EXTRACTION_ATTEMPTED');
    expect(llmStrategy).toHaveBeenCalledTimes(1);
    expect(llmStrategy.mock.calls[0]?.[0].trajectories).toHaveLength(1);
    expect(JSON.stringify(llmStrategy.mock.calls[0]?.[0].trajectories)).toContain('llm-note: BGP-PEER-DOWN');
    expect(store.saveLongTermMemory).toHaveBeenCalledWith(
      expect.objectContaining({
        memoryType: 'CONCEPTUAL',
        content: expect.stringContaining('BGP-PEER-DOWN'),
      }),
      expect.anything(),
    );
  });

  it('keeps full LLM input for LLM_ONLY when request notes are present', async () => {
    const store = fakeMemoryStore();
    const llmSource = trajectory({
      taskTrajectoryId: brand<string, 'TaskTrajectoryId'>('trajectory-llm-only-note'),
      observations: [
        {
          kind: 'REQUEST_FACT',
          summary: 'llm-note: ALARM-90077 maps to transport link degradation',
          sourceRefs: trajectory().sourceRefs,
          observedAt: brand<number, 'EpochMillis'>(220),
        },
      ],
    });
    const ordinarySource = trajectory({
      taskTrajectoryId: brand<string, 'TaskTrajectoryId'>('trajectory-ordinary-llm-input'),
      observations: [
        {
          kind: 'USER_CONFIRMATION',
          summary: 'verified alarm dictionary mapping',
          sourceRefs: trajectory().sourceRefs,
          observedAt: brand<number, 'EpochMillis'>(221),
        },
      ],
    });
    const llmStrategy = vi.fn(async (_request: MemoryExtractionLlmRequest) => ({
      candidates: [],
      reasonCode: 'LLM_EXTRACTION_ATTEMPTED',
    }));

    await runMemoryExtractionCycle({
      config: config({ strategy: 'LLM_ONLY' }),
      scopes: [scope()],
      taskTrajectoryQuery: fakeTrajectoryQuery([llmSource, ordinarySource]),
      llmStrategy,
      store,
    });

    expect(llmStrategy).toHaveBeenCalledTimes(1);
    const submitted = llmStrategy.mock.calls[0]?.[0].trajectories ?? [];
    expect(submitted).toHaveLength(2);
    expect(submitted.map((item) => String(item.taskTrajectoryId))).toEqual(['trajectory-llm-only-note', 'trajectory-ordinary-llm-input']);
  });

  it('projects LLM prompt input without runtime capability status noise', () => {
    const source = trajectory({
      goalSummary: 'Committed completed request run.',
      constraintSummaries: ['messages:10', 'timelineEvents:11'],
      observations: [
        {
          kind: 'REQUEST_FACT',
          summary: 'llm-note: BGP-PEER-DOWN 归到 BGP 邻居中断类告警',
          sourceRefs: trajectory().sourceRefs,
          observedAt: brand<number, 'EpochMillis'>(220),
        },
        {
          kind: 'TOOL_RESULT',
          summary: 'CAPABILITY_COMPLETED capability:Rag status:FAILED code:SCOPE_MISMATCH',
          sourceRefs: trajectory().sourceRefs,
          observedAt: brand<number, 'EpochMillis'>(221),
        },
      ],
      actions: [
        {
          kind: 'TOOL_INVOCATION',
          summary: 'CAPABILITY_COMPLETED capability:Glob status:SUCCEEDED',
          status: 'SUCCEEDED',
          sourceRefs: trajectory().sourceRefs,
        },
        { kind: 'VERIFICATION', summary: 'verify BGP alarm dictionary mapping', status: 'SUCCEEDED', sourceRefs: trajectory().sourceRefs },
      ],
    });

    const projected = projectTaskTrajectoryForMemoryExtractionPrompt(source);
    const serialized = JSON.stringify(projected);

    expect(serialized).toContain('llm-note: BGP-PEER-DOWN 归到 BGP 邻居中断类告警');
    expect(serialized).toContain('verify BGP alarm dictionary mapping');
    expect(serialized).not.toContain('CAPABILITY_COMPLETED');
    expect(serialized).not.toContain('SCOPE_MISMATCH');
    expect(serialized).not.toContain('Glob');
    expect(serialized).not.toContain('messages:10');
  });

  it('rejects LLM candidates based only on tool runtime behavior', async () => {
    const store = fakeMemoryStore();
    const llmStrategy = vi.fn(async () => ({
      candidates: [
        candidateForTrajectory(
          trajectory(),
          'FACTUAL',
          {
            category: 'FACTUAL',
            subject: 'Rag capability scope limitations',
            claim: 'Rag frequently fails with SCOPE_MISMATCH during tasks.',
          },
          'cycle-a',
        ),
      ],
      reasonCode: 'LLM_EXTRACTION_ATTEMPTED',
    }));

    const result = await runMemoryExtractionCycle({
      config: config({ strategy: 'LLM_ONLY' }),
      scopes: [scope()],
      taskTrajectoryQuery: fakeTrajectoryQuery([trajectory()]),
      llmStrategy,
      store,
    });

    expect(result).toMatchObject({ status: 'SKIPPED', writtenCount: 0 });
    expect(result.reasonCodes).toContain('CANDIDATE_NOT_USEFUL');
    expect(store.saveLongTermMemory).not.toHaveBeenCalled();
  });

  it('runs LLM extraction separately for each configured agent scope', async () => {
    const agentA = scope({ agentId: 'agent-a', agentVersion: '1.0.0' });
    const agentB = scope({ agentId: 'agent-b', agentVersion: '2.0.0' });
    const store = fakeMemoryStore();
    const query: Pick<TaskTrajectoryQueryGateway, 'listTaskTrajectories'> & { readonly listTaskTrajectories: ReturnType<typeof vi.fn> } = {
      listTaskTrajectories: vi.fn(async (request: { readonly agentId: TaskTrajectoryRecord['agentId'] }): Promise<TaskTrajectoryListResult> => ({
        items: [
          trajectory({
            agentId: request.agentId,
            requestId: brand<string, 'MessageId'>(`request-${String(request.agentId)}`),
            requestRunId: brand<string, 'RequestRunId'>(`run-${String(request.agentId)}`),
          }),
        ],
      })),
    };
    const llmStrategy = vi.fn(async (request: MemoryExtractionLlmRequest) => ({
      candidates: [
        candidateForTrajectory(
          request.trajectories[0]!,
          'FACTUAL',
          {
            category: 'FACTUAL',
            subject: `latency profile ${String(request.scope.agentId)}`,
            claim: 'threshold is 120ms',
          },
          request.cycleId,
        ),
      ],
      reasonCode: 'LLM_EXTRACTION_ATTEMPTED',
    }));

    const result = await runMemoryExtractionCycle({
      config: config({ strategy: 'LLM_ONLY' }),
      scopes: [agentA, agentB],
      taskTrajectoryQuery: query,
      llmStrategy,
      store,
    });

    expect(result).toMatchObject({ status: 'COMPLETED', writtenCount: 2 });
    expect(llmStrategy).toHaveBeenCalledTimes(2);
    expect(llmStrategy.mock.calls.map((call) => String(call[0].scope.agentId))).toEqual(['agent-a', 'agent-b']);
    expect(store.saveLongTermMemory.mock.calls.map((call) => String((call[0] as SaveLongTermMemoryRequest).agentId))).toEqual(['agent-a', 'agent-b']);
  });

  it('stops before writing when cancellation happens after trajectory collection', async () => {
    const controller = new AbortController();
    const store = fakeMemoryStore();
    const query: Pick<TaskTrajectoryQueryGateway, 'listTaskTrajectories'> & { readonly listTaskTrajectories: ReturnType<typeof vi.fn> } = {
      listTaskTrajectories: vi.fn(async (): Promise<TaskTrajectoryListResult> => {
        controller.abort();
        return { items: [trajectory()] };
      }),
    };

    const result = await runMemoryExtractionCycle(
      {
        config: config(),
        scopes: [scope()],
        taskTrajectoryQuery: query,
        store,
      },
      controller.signal,
    );

    expect(result).toMatchObject({ status: 'FAILED', reasonCode: 'MEMORY_EXTRACTION_CANCELED' });
    expect(store.saveLongTermMemory).not.toHaveBeenCalled();
  });

  it('starts scheduled cycles only when cron is due and supports manual trigger', async () => {
    const now = brand<number, 'EpochMillis'>(new Date(2026, 0, 1, 2, 0, 41).getTime());
    expect(isMemoryExtractionCronDue('0 0 2 * * ?', now)).toBe(true);
    expect(isMemoryExtractionCronDue('0 0 3 * * ?', now)).toBe(false);
    expect(isMemoryExtractionCronDue('0 0 2 * * ?', now, brand<number, 'EpochMillis'>(Number(now) - 20_000))).toBe(false);

    const query = fakeTrajectoryQuery([trajectory()]);
    const scheduler = createMemoryExtractionScheduler({
      config: config(),
      scopes: [scope()],
      taskTrajectoryQuery: query,
      store: fakeMemoryStore(),
      now: () => now,
    });

    const result = await scheduler.triggerNow('manual');
    await scheduler.stop();

    expect(result.status).toBe('COMPLETED');
    expect(query.listTaskTrajectories).toHaveBeenCalled();
  });

  it('runs the scheduled cycle after crossing into the target minute', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 0, 1, 23, 59, 41));
    const query = fakeTrajectoryQuery([trajectory()]);
    const scheduler = createMemoryExtractionScheduler({
      config: config(),
      scopes: [scope()],
      taskTrajectoryQuery: query,
      store: fakeMemoryStore(),
      now: () => brand<number, 'EpochMillis'>(Date.now()),
    });

    try {
      scheduler.start();
      await vi.advanceTimersByTimeAsync(60_000);

      expect(query.listTaskTrajectories).toHaveBeenCalled();
    } finally {
      await scheduler.stop();
      vi.useRealTimers();
    }
  });

  it('does not start background reads for disabled, invalid, or unscheduled extraction', async () => {
    const query = fakeTrajectoryQuery([trajectory()]);
    const diagnosticObserver = vi.fn();
    const disabled = createMemoryExtractionScheduler({
      config: config({ memoryEnabled: false, extractionEnabled: false }),
      scopes: [scope()],
      taskTrajectoryQuery: query,
      store: fakeMemoryStore(),
    });
    const invalid = createMemoryExtractionScheduler({
      config: { ...config(), status: 'INVALID' },
      scopes: [scope()],
      taskTrajectoryQuery: query,
      store: fakeMemoryStore(),
      diagnosticObserver,
    });
    const unscheduled = createMemoryExtractionScheduler({
      config: config({ crossSessionSchedule: undefined }),
      scopes: [scope()],
      taskTrajectoryQuery: query,
      store: fakeMemoryStore(),
    });

    disabled.start();
    invalid.start();
    unscheduled.start();
    await disabled.stop();
    await invalid.stop();
    await unscheduled.stop();

    expect(query.listTaskTrajectories).not.toHaveBeenCalled();
    expect(diagnosticObserver).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'SKIPPED',
        reasonCode: 'MEMORY_CONFIG_INVALID',
      }),
    );
  });

  it('extracts explicit Chinese telecom definitions as CONCEPTUAL and not FACTUAL from constraints', () => {
    const source = trajectory({
      goalSummary: 'Committed completed request run.',
      constraintSummaries: ['黑盒验证-ALARM-26ZK9 代表传输链路中断告警'],
      observations: [],
      actions: [],
    });

    const candidates = extractTrajectoryCandidates(source);

    const conceptuals = candidates.filter((candidate) => candidate.category === 'CONCEPTUAL');
    const factuals = candidates.filter((candidate) => candidate.category === 'FACTUAL');
    expect(conceptuals.length).toBeGreaterThanOrEqual(1);
    expect(factuals.length).toBe(0);
    const match = conceptuals.find(
      (candidate) =>
        candidate.content.category === 'CONCEPTUAL' &&
        candidate.content.concept === '黑盒验证-ALARM-26ZK9' &&
        candidate.content.definition === '传输链路中断告警',
    );
    expect(match).toBeDefined();
  });

  it('does not create PROCEDURAL candidates from validation fixture or test status trajectories', () => {
    const source = trajectory({
      goalSummary: '验证 黑盒验证-ALARM-26ZK9 的中文业务定义能进入长期记忆',
      constraintSummaries: [],
      observations: [],
      actions: [
        {
          kind: 'VERIFICATION',
          summary: '黑盒验证轨迹已确认',
          status: 'SUCCEEDED',
          sourceRefs: trajectory().sourceRefs,
        },
      ],
    });

    const candidates = extractTrajectoryCandidates(source);

    expect(candidates.filter((candidate) => candidate.category === 'PROCEDURAL')).toEqual([]);
  });

  it('does not inflate FACTUAL or PROCEDUAL from a Chinese definition trajectory when existing CONCEPTUAL baseline covers the concept', async () => {
    const existing = memoryRecord({
      longTermMemoryId: 'ltm-fusion-baseline',
      content: {
        category: 'CONCEPTUAL',
        concept: '黑盒验证-ALARM-26ZK9',
        definition: '传输链路中断告警（已有基线记忆）',
      },
      confidence: 0.72,
    });
    const store = fakeMemoryStore([existing]);
    const source = trajectory({
      goalSummary: 'Committed completed request run.',
      constraintSummaries: ['黑盒验证-ALARM-26ZK9 代表传输链路中断告警'],
      observations: [],
      actions: [],
    });

    const result = await runMemoryExtractionCycle({
      config: config(),
      scopes: [scope()],
      taskTrajectoryQuery: fakeTrajectoryQuery([source]),
      store,
    });

    const writes = store.saveLongTermMemory.mock.calls;
    const factualWrites = writes.filter((call) => (call[0] as SaveLongTermMemoryRequest).memoryType === 'FACTUAL');
    const proceduralWrites = writes.filter((call) => (call[0] as SaveLongTermMemoryRequest).memoryType === 'PROCEDURAL');
    expect(factualWrites).toEqual([]);
    expect(proceduralWrites).toEqual([]);
    expect(result.newCount).toBeLessThanOrEqual(1);
  });
});

function config(
  overrides: {
    readonly memoryEnabled?: boolean;
    readonly extractionEnabled?: boolean;
    readonly maxCandidates?: number;
    readonly strategy?: 'RULE_FIRST' | 'LLM_ONLY';
    readonly timeoutMs?: number;
    readonly crossSessionSchedule?: string | undefined;
  } = {},
): MemoryExtractionConfigSnapshot {
  return {
    enabled: overrides.memoryEnabled ?? true,
    status: overrides.memoryEnabled === false ? 'DISABLED' : 'VALID',
    extraction: {
      enabled: overrides.extractionEnabled ?? true,
      strategy: overrides.strategy ?? 'RULE_FIRST',
      ...(Object.prototype.hasOwnProperty.call(overrides, 'crossSessionSchedule')
        ? overrides.crossSessionSchedule === undefined
          ? {}
          : { crossSessionSchedule: overrides.crossSessionSchedule }
        : { crossSessionSchedule: '0 0 0 * * ?' }),
      maxCycleTrajectories: 20,
      maxCandidates: overrides.maxCandidates ?? 50,
      timeoutMs: overrides.timeoutMs ?? 60_000,
      lookbackDays: 7,
    },
  };
}

function scope(
  overrides: {
    readonly tenantId?: string;
    readonly subjectId?: string;
    readonly agentId?: string;
    readonly agentVersion?: string;
  } = {},
) {
  return {
    tenantId: brand<string, 'TenantId'>(overrides.tenantId ?? 'tenant-a'),
    subjectId: brand<string, 'SubjectId'>(overrides.subjectId ?? 'subject-a'),
    agentId: brand<string, 'AgentId'>(overrides.agentId ?? 'agent-a'),
    agentVersion: brand<string, 'AgentVersion'>(overrides.agentVersion ?? '1.0.0'),
  };
}

function trajectory(overrides: Partial<TaskTrajectoryRecord> = {}): TaskTrajectoryRecord {
  const s = scope();
  const base: TaskTrajectoryRecord = {
    tenantId: s.tenantId,
    subjectId: s.subjectId,
    agentId: s.agentId,
    taskTrajectoryId: brand<string, 'TaskTrajectoryId'>('trajectory-a'),
    sessionId: brand<string, 'SessionId'>('session-a'),
    requestId: brand<string, 'MessageId'>('request-a'),
    requestRunId: brand<string, 'RequestRunId'>('run-a'),
    taskKind: 'TROUBLESHOOTING',
    trajectoryBuildStatus: 'COMPLETED',
    taskOutcomeStatus: 'SUCCEEDED',
    outcomeEvidenceLevel: 'VERIFICATION',
    goalSummary: 'Check S1 latency alarm mitigation',
    constraintSummaries: ['s1 latency: threshold is 120ms'],
    observations: [
      {
        kind: 'VERIFICATION',
        summary: 'verification: latency alarm cleared',
        sourceRefs: [
          {
            refKind: 'TIMELINE_EVENT',
            sessionId: brand<string, 'SessionId'>('session-a'),
            requestId: brand<string, 'MessageId'>('request-a'),
            requestRunId: brand<string, 'RequestRunId'>('run-a'),
            timelineEventId: 'event-a',
            timelineSequence: brand<number, 'TimelineSequence'>(1),
          },
        ],
        observedAt: brand<number, 'EpochMillis'>(100),
      },
    ],
    actions: [
      {
        kind: 'TOOL_INVOCATION',
        summary: 'query alarm state',
        status: 'SUCCEEDED',
        sourceRefs: [
          {
            refKind: 'TIMELINE_EVENT',
            sessionId: brand<string, 'SessionId'>('session-a'),
            requestId: brand<string, 'MessageId'>('request-a'),
            requestRunId: brand<string, 'RequestRunId'>('run-a'),
            timelineEventId: 'event-a',
            timelineSequence: brand<number, 'TimelineSequence'>(1),
          },
        ],
      },
      {
        kind: 'VERIFICATION',
        summary: 'verify alarm clearance',
        status: 'SUCCEEDED',
        sourceRefs: [
          {
            refKind: 'TIMELINE_EVENT',
            sessionId: brand<string, 'SessionId'>('session-a'),
            requestId: brand<string, 'MessageId'>('request-a'),
            requestRunId: brand<string, 'RequestRunId'>('run-a'),
            timelineEventId: 'event-b',
            timelineSequence: brand<number, 'TimelineSequence'>(2),
          },
        ],
      },
    ],
    outcomeSummary: 'Verification evidence completed.',
    outcomeEvidenceRefs: [
      {
        refKind: 'TIMELINE_EVENT',
        sessionId: brand<string, 'SessionId'>('session-a'),
        requestId: brand<string, 'MessageId'>('request-a'),
        requestRunId: brand<string, 'RequestRunId'>('run-a'),
        timelineEventId: 'event-b',
        timelineSequence: brand<number, 'TimelineSequence'>(2),
      },
    ],
    sourceRefs: [
      {
        refKind: 'REQUEST_RUN',
        sessionId: brand<string, 'SessionId'>('session-a'),
        requestId: brand<string, 'MessageId'>('request-a'),
        requestRunId: brand<string, 'RequestRunId'>('run-a'),
      },
    ],
    startedAt: brand<number, 'EpochMillis'>(100),
    completedAt: brand<number, 'EpochMillis'>(200),
    createdAt: brand<number, 'EpochMillis'>(201),
    updatedAt: brand<number, 'EpochMillis'>(201),
  };
  return { ...base, ...overrides };
}

function trajectoryWithIdentity(suffix: string): TaskTrajectoryRecord {
  const sessionId = brand<string, 'SessionId'>(`session-${suffix}`);
  const requestId = brand<string, 'MessageId'>(`request-${suffix}`);
  const requestRunId = brand<string, 'RequestRunId'>(`run-${suffix}`);
  const eventA = `event-${suffix}-a`;
  const eventB = `event-${suffix}-b`;
  return trajectory({
    taskTrajectoryId: brand<string, 'TaskTrajectoryId'>(`trajectory-${suffix}`),
    sessionId,
    requestId,
    requestRunId,
    observations: [
      {
        kind: 'VERIFICATION',
        summary: 'verification: latency alarm cleared',
        sourceRefs: [
          {
            refKind: 'TIMELINE_EVENT',
            sessionId,
            requestId,
            requestRunId,
            timelineEventId: eventA,
            timelineSequence: brand<number, 'TimelineSequence'>(1),
          },
        ],
        observedAt: brand<number, 'EpochMillis'>(100),
      },
    ],
    actions: [
      {
        kind: 'TOOL_INVOCATION',
        summary: 'query alarm state',
        status: 'SUCCEEDED',
        sourceRefs: [
          {
            refKind: 'TIMELINE_EVENT',
            sessionId,
            requestId,
            requestRunId,
            timelineEventId: eventA,
            timelineSequence: brand<number, 'TimelineSequence'>(1),
          },
        ],
      },
      {
        kind: 'VERIFICATION',
        summary: 'verify alarm clearance',
        status: 'SUCCEEDED',
        sourceRefs: [
          {
            refKind: 'TIMELINE_EVENT',
            sessionId,
            requestId,
            requestRunId,
            timelineEventId: eventB,
            timelineSequence: brand<number, 'TimelineSequence'>(2),
          },
        ],
      },
    ],
    outcomeEvidenceRefs: [
      {
        refKind: 'TIMELINE_EVENT',
        sessionId,
        requestId,
        requestRunId,
        timelineEventId: eventB,
        timelineSequence: brand<number, 'TimelineSequence'>(2),
      },
    ],
    sourceRefs: [{ refKind: 'REQUEST_RUN', sessionId, requestId, requestRunId }],
  });
}

function fakeTrajectoryQuery(items: readonly TaskTrajectoryRecord[]): Pick<TaskTrajectoryQueryGateway, 'listTaskTrajectories'> & {
  readonly listTaskTrajectories: ReturnType<typeof vi.fn>;
} {
  return {
    listTaskTrajectories: vi.fn(async (): Promise<TaskTrajectoryListResult> => ({ items })),
  };
}

function extractionGuardrail(checkKnowledge: GuardrailGatewayPort['checkKnowledge']): GuardrailGatewayPort {
  return {
    checkQuestion: vi.fn(async () => ({ isLegal: true, refusalMessage: '' })),
    checkAnswer: vi.fn(async () => ({ isLegal: true, refusalMessage: '' })),
    checkNl2Python: vi.fn(async () => ({ status: true, errorMsg: [] })),
    checkKnowledge,
  };
}

function fakeMemoryStore(initial: readonly LongTermMemoryRecord[] = []): Pick<
  LongTermMemoryStoreGateway,
  'saveLongTermMemory' | 'listLongTermMemory' | 'getLongTermMemory' | 'mutateLongTermMemory'
> & {
  readonly saveLongTermMemory: ReturnType<typeof vi.fn>;
  readonly listLongTermMemory: ReturnType<typeof vi.fn>;
  readonly getLongTermMemory: ReturnType<typeof vi.fn>;
  readonly mutateLongTermMemory: ReturnType<typeof vi.fn>;
} {
  const records = new Map(initial.map((record) => [String(record.memoryId), record]));
  const store = {
    listLongTermMemory: vi.fn(
      async (query: {
        readonly tenantId?: LongTermMemoryRecord['tenantId'];
        readonly subjectId?: LongTermMemoryRecord['subjectId'];
        readonly agentId?: LongTermMemoryRecord['agentId'];
        readonly memoryType?: string;
        readonly limit?: number;
      }) => ({
        items: [...records.values()]
          .filter((record) => query.tenantId === undefined || record.tenantId === query.tenantId)
          .filter((record) => query.subjectId === undefined || record.subjectId === query.subjectId)
          .filter((record) => query.agentId === undefined || record.agentId === query.agentId)
          .filter((record) => query.memoryType === undefined || record.memoryType === query.memoryType)
          .slice(0, query.limit ?? 50)
          .map((record) => ({
            memoryId: record.memoryId,
            memoryType: record.memoryType,
            knowledgeSourceType: record.knowledgeSourceType,
            state: record.state,
            confidence: record.confidence,
            labels: record.labels,
            briefIndex: record.briefIndex,
            content: record.content,
            isPinned: record.isPinned,
            accessCount: record.accessCount,
            createTime: record.createTime,
            updateTime: record.updateTime,
            version: record.version,
          })),
        total: records.size,
        limit: query.limit ?? 50,
        offset: 0,
      }),
    ),
    getLongTermMemory: vi.fn(
      async (request: { readonly memoryId: LongTermMemoryRecord['memoryId'] }) => records.get(String(request.memoryId)) ?? memoryNotFound(),
    ),
    saveLongTermMemory: vi.fn(async (request: SaveLongTermMemoryRequest) => {
      const id = request.memoryId ?? brand<string, 'LongTermMemoryId'>(`ltm-${records.size + 1}`);
      const current = records.get(String(id));
      const record = {
        ...memoryRecord({
          longTermMemoryId: String(id),
          content: JSON.parse(request.content) as MemoryContentByCategory,
          confidence: request.confidence,
          extractionCount: current === undefined ? 0 : current.extractionCount + 1,
          version: (current?.version ?? 0) + 1,
          sourceTrace: JSON.parse(request.source) as InteractionMemorySourceTrace,
        }),
        tenantId: request.tenantId,
        subjectId: request.subjectId,
        agentId: request.agentId,
        memoryInstance: request.memoryInstance ?? 'default',
        memoryType: request.memoryType,
        knowledgeSourceType: request.knowledgeSourceType,
        briefIndex: request.briefIndex,
        labels: request.labels ?? [],
      };
      records.set(String(id), record);
      return record;
    }),
    mutateLongTermMemory: vi.fn(
      async (request: Parameters<LongTermMemoryStoreGateway['mutateLongTermMemory']>[0]): Promise<LongTermMemoryVersionedUpdateResult> => {
        const current = records.get(String(request.memoryId));
        if (current === undefined) {
          return { status: 'NOT_FOUND' };
        }
        if (request.delta === undefined) {
          return { status: 'NOT_FOUND' };
        }
        const record = { ...current, confidence: current.confidence + request.delta, version: current.version + 1 };
        records.set(String(record.memoryId), record);
        return { status: 'UPDATED', record };
      },
    ),
  };
  return store;
}

function candidateFor(category: MemoryExtractionCandidate['category'], content: MemoryContentByCategory): MemoryExtractionCandidate {
  return {
    category,
    content,
    briefIndex: `${category} candidate`,
    confidence: 0.5,
    tags: ['test'],
    sourceTrace: memoryExtractionSourceTraceFromTrajectory(trajectory(), 'cycle-a'),
    strategyProvenance: 'RULE',
  };
}

function candidateForTrajectory(
  source: TaskTrajectoryRecord,
  category: MemoryExtractionCandidate['category'],
  content: MemoryContentByCategory,
  cycleId: string,
): MemoryExtractionCandidate {
  return {
    category,
    content,
    briefIndex: `${category} candidate`,
    confidence: 0.5,
    tags: ['test'],
    sourceTrace: memoryExtractionSourceTraceFromTrajectory(source, cycleId),
    strategyProvenance: 'LLM',
  };
}

function memoryRecord(input: {
  readonly longTermMemoryId: string;
  readonly content: MemoryContentByCategory;
  readonly confidence?: number;
  readonly extractionCount?: number;
  readonly version?: number;
  readonly sourceTrace?: InteractionMemorySourceTrace;
}): LongTermMemoryRecord {
  const s = scope();
  return {
    tenantId: s.tenantId,
    subjectId: s.subjectId,
    agentId: s.agentId,
    memoryId: brand<string, 'LongTermMemoryId'>(input.longTermMemoryId),
    memoryInstance: 'default',
    version: input.version ?? 1,
    memoryType: input.content.category,
    knowledgeSourceType: 'LEARNED',
    sharingState: 'PRIVATE',
    confidence: input.confidence ?? 0.5,
    state: 'ACTIVE',
    labels: ['test'],
    briefIndex: 'existing memory',
    content: JSON.stringify(input.content),
    accessCount: 0,
    recallCount: 0,
    extractionCount: input.extractionCount ?? 0,
    source: JSON.stringify(input.sourceTrace ?? memoryExtractionSourceTraceFromTrajectory(trajectory(), 'cycle-existing')),
    archivedAt: brand<number, 'EpochMillis'>(0),
    archiveReason: '',
    isPinned: false,
    createTime: brand<number, 'EpochMillis'>(1),
    updateTime: brand<number, 'EpochMillis'>(1),
  };
}

function memoryNotFound() {
  return {
    code: 'LTM_ENTRY_NOT_FOUND',
    message: 'Long-term memory entry was not found.',
    category: 'NOT_FOUND' as const,
    retryable: false,
  };
}
