import { modelEventStreamFixture } from '../../../tests/helpers/model-stream-fixture.js';
import { AgentError, brand, type IdentityContext } from '@nextagent/agent-common';
import type { TaskTrajectoryRecord } from '@nextagent/agent-contracts/gateway';
import type { ModelInvocationRequest, ModelInvocationService } from '@nextagent/agent-contracts/model';
import {
  createMemoryExtractionLlmStrategy,
  parseMemoryExtractionLlmCandidates,
  type MemoryExtractionAssemblyView,
} from '../src/memory-extraction-llm-strategy.js';
import { describe, expect, it, vi } from 'vitest';

const identity: IdentityContext = {
  tenantId: brand<string, 'TenantId'>('tenant-memory'),
  subjectId: brand<string, 'SubjectId'>('subject-memory'),
  displayName: 'memory tester',
};

const assembly: MemoryExtractionAssemblyView = {
  agentId: brand<string, 'AgentId'>('agent-memory'),
  agentVersion: brand<string, 'AgentVersion'>('v1'),
  agentAssemblyRef: 'agent-memory@v1',
  runtimeSettings: { defaultLanguage: 'zh-CN' },
};

describe('MemoryExtractionLlmStrategy', () => {
  it('parses valid candidates and attaches source trace from the selected trajectory', () => {
    const source = trajectory();
    const candidates = parseMemoryExtractionLlmCandidates(
      JSON.stringify({
        candidates: [
          {
            category: 'FACTUAL',
            content: {
              category: 'FACTUAL',
              subject: 'S1 latency alarm',
              claim: 'threshold is 120ms',
              evidence: ['verified'],
            },
            trajectoryIndex: 0,
            briefIndex: 'S1 latency alarm threshold',
            confidence: 0.72,
            tags: ['telecom', 1],
          },
        ],
      }),
      [source],
      'cycle-a',
    );

    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({
      category: 'FACTUAL',
      briefIndex: 'S1 latency alarm threshold',
      confidence: 0.72,
      tags: ['telecom'],
      strategyProvenance: 'LLM',
      sourceTrace: {
        sessionId: source.sessionId,
        requestId: source.requestId,
        runId: source.requestRunId,
        extractionCycleId: 'cycle-a',
      },
    });
  });

  it('drops invalid JSON, category mismatch and out-of-range trajectory references', () => {
    expect(parseMemoryExtractionLlmCandidates('{', [trajectory()], 'cycle-a')).toEqual([]);
    expect(
      parseMemoryExtractionLlmCandidates(
        JSON.stringify([
          {
            category: 'FACTUAL',
            content: { category: 'CONCEPTUAL', concept: 'x', definition: 'y' },
          },
        ]),
        [trajectory()],
        'cycle-a',
      ),
    ).toEqual([]);
    expect(
      parseMemoryExtractionLlmCandidates(
        JSON.stringify([
          {
            category: 'FACTUAL',
            content: { category: 'FACTUAL', subject: 'x', claim: 'y' },
            trajectoryIndex: 2,
          },
        ]),
        [trajectory()],
        'cycle-a',
      ),
    ).toEqual([]);
  });

  it('resolves assembly and prompt through structural callbacks before invoking the model', async () => {
    let captured: ModelInvocationRequest | undefined;
    const model: ModelInvocationService = {
      complete: vi.fn(async (request) => {
        captured = request;
        return {
          content: JSON.stringify([{ category: 'FACTUAL', content: { category: 'FACTUAL', subject: 'cell', claim: 'is degraded' } }]),
          finishReason: 'stop' as const,
        };
      }),
      stream: modelEventStreamFixture(async function* () {
        yield { content: '', finishReason: 'stop' };
      }),
    };
    const strategy = createMemoryExtractionLlmStrategy({
      resolveAssembly: vi.fn(() => assembly),
      modelSelectionService: selectionService({
        modelId: 'memory-model',
        temperature: 0.1,
        defaultTimeoutMs: 9_000,
      }),
      model,
      identity,
      assemblePrompt: vi.fn(() => ({
        renderedContent: 'memory extraction prompt',
        modelOptions: { maxOutputTokens: 256 },
      })),
    });

    const result = await strategy({
      scope: { tenantId: identity.tenantId, subjectId: identity.subjectId, agentId: assembly.agentId, agentVersion: assembly.agentVersion },
      trajectories: [trajectory()],
      maxCandidates: 1,
      cycleId: 'cycle-model',
    });

    expect('candidates' in result ? result.candidates : []).toHaveLength(1);
    expect(captured).toMatchObject({
      modelId: 'memory-model',
      temperature: 0.1,
      maxOutputTokens: 256,
      timeoutMs: 9_000,
      invocationScope: { operationId: 'memory-extraction:cycle-model' },
    });
  });

  it('returns safe errors for abort, prompt failure and model safeError', async () => {
    const aborted = new AbortController();
    aborted.abort();
    const strategy = createMemoryExtractionLlmStrategy({
      resolveAssembly: () => assembly,
      modelSelectionService: selectionService({ modelId: 'memory-model', defaultTimeoutMs: 1_000 }),
      model: safeErrorModel(),
      identity,
      assemblePrompt: () => ({ renderedContent: 'prompt' }),
    });

    await expect(
      strategy(
        {
          scope: { tenantId: identity.tenantId, subjectId: identity.subjectId, agentId: assembly.agentId },
          trajectories: [],
          maxCandidates: 1,
          cycleId: 'cycle-abort',
        },
        aborted.signal,
      ),
    ).resolves.toMatchObject({ code: 'MEMORY_EXTRACTION_CANCELED', category: 'CANCELED' });
    await expect(
      strategy({
        scope: { tenantId: identity.tenantId, subjectId: identity.subjectId, agentId: assembly.agentId },
        trajectories: [],
        maxCandidates: 1,
        cycleId: 'cycle-safe',
      }),
    ).resolves.toMatchObject({ code: 'MODEL_TIMEOUT', category: 'TIMEOUT' });

    const promptFailure = createMemoryExtractionLlmStrategy({
      resolveAssembly: () => assembly,
      modelSelectionService: selectionService({ modelId: 'memory-model', defaultTimeoutMs: 1_000 }),
      model: safeErrorModel(),
      identity,
      assemblePrompt: () => {
        throw new AgentError({ code: 'PROMPT_TEMPLATE_UNAVAILABLE', message: 'prompt failed', category: 'VALIDATION', retryable: false });
      },
    });
    await expect(
      promptFailure({
        scope: { tenantId: identity.tenantId, subjectId: identity.subjectId, agentId: assembly.agentId },
        trajectories: [],
        maxCandidates: 1,
        cycleId: 'cycle-prompt',
      }),
    ).resolves.toMatchObject({ code: 'PROMPT_TEMPLATE_RESOLUTION_FAILED', category: 'UNAVAILABLE' });
  });
});

function selectionService(
  overrides: {
    readonly modelId?: string;
    readonly temperature?: number;
    readonly defaultTimeoutMs?: number;
  } = {},
) {
  return {
    async select() {
      return {
        status: 'SELECTED' as const,
        reason: 'AGENT_DEFAULT' as const,
        configuration: {
          modelId: overrides.modelId ?? 'memory-model',
          contextWindowTokens: 128_000,
          temperature: overrides.temperature ?? 0.55,
          maxOutputTokens: 32_000,
          topP: 1,
          toolChoice: 'AUTO' as const,
          defaultTimeoutMs: overrides.defaultTimeoutMs ?? 30_000,
          defaultMaxRetries: 2,
        },
      };
    },
  };
}

function safeErrorModel(): ModelInvocationService {
  return {
    complete: async () => ({
      content: '',
      finishReason: 'error',
      safeError: { code: 'MODEL_TIMEOUT', message: 'timeout', category: 'TIMEOUT', retryable: true },
    }),
    stream: modelEventStreamFixture(async function* () {
      yield { content: '', finishReason: 'stop' };
    }),
  };
}

function trajectory(): TaskTrajectoryRecord {
  const sessionId = brand<string, 'SessionId'>('session-memory');
  const requestId = brand<string, 'MessageId'>('request-memory');
  const requestRunId = brand<string, 'RequestRunId'>('run-memory');
  return {
    tenantId: identity.tenantId,
    subjectId: identity.subjectId,
    agentId: assembly.agentId,
    taskTrajectoryId: brand<string, 'TaskTrajectoryId'>('trajectory-memory'),
    sessionId,
    requestId,
    requestRunId,
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
            sessionId,
            requestId,
            requestRunId,
            timelineEventId: 'event-a',
            timelineSequence: brand<number, 'TimelineSequence'>(1),
          },
        ],
        observedAt: brand<number, 'EpochMillis'>(100),
      },
    ],
    actions: [
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
        sessionId,
        requestId,
        requestRunId,
        timelineEventId: 'event-b',
        timelineSequence: brand<number, 'TimelineSequence'>(2),
      },
    ],
    sourceRefs: [{ refKind: 'REQUEST_RUN', sessionId, requestId, requestRunId }],
    startedAt: brand<number, 'EpochMillis'>(100),
    completedAt: brand<number, 'EpochMillis'>(200),
    createdAt: brand<number, 'EpochMillis'>(201),
    updatedAt: brand<number, 'EpochMillis'>(201),
  };
}
