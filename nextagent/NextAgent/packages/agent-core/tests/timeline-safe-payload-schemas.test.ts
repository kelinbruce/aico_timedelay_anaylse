import { describe, expect, it } from 'vitest';
import { isCapabilityStartedTimelinePayload } from '../src/projection/capability-timeline-payload-schemas.js';
import { isCapabilityStructureSafePayload, isModelInvocationSafePayload } from '../src/projection/timeline-safe-payload-schemas.js';

describe('model timeline safe payload schemas', () => {
  it('accepts bounded disclosed capability and resolved tool names', () => {
    expect(isModelInvocationSafePayload('started', startedPayload(['Read', 'Grep'], 'false'))).toBe(true);
    expect(isModelInvocationSafePayload('completed', completedPayload(['Read'], 'false'))).toBe(true);
    expect(
      isModelInvocationSafePayload('failed', {
        stepId: 'turn-1',
        modelId: 'model',
        safeErrorCode: 'MODEL_UNAVAILABLE',
        safeErrorCategory: 'UNAVAILABLE',
        durationMs: 12,
        firstContentLatencyMs: 4,
        usage: { inputTokens: 2, outputTokens: 0, totalTokens: 2 },
      }),
    ).toBe(true);
  });

  it('validates capability structure arrays, markers, and combined byte budgets', () => {
    expect(
      isCapabilityStructureSafePayload({
        argumentProjectionStatus: 'PROJECTED',
        resultProjectionStatus: 'PROJECTED',
        validatedArgumentNames: ['query'],
        validatedArgumentNamesTruncated: 'false',
        validatedResultFieldNames: ['records'],
        validatedResultFieldNamesTruncated: 'false',
        generatedMessageKinds: ['USER', 'USER_META'],
        contextPatchFields: ['allowedTools', 'modelId'],
      }),
    ).toBe(true);
    expect(
      isCapabilityStructureSafePayload({
        argumentProjectionStatus: 'PROJECTED',
        resultProjectionStatus: 'NOT_PRODUCED',
        validatedArgumentNames: ['unsafe name'],
        validatedArgumentNamesTruncated: 'false',
      }),
    ).toBe(false);
    expect(
      isCapabilityStructureSafePayload({
        argumentProjectionStatus: 'PROJECTED',
        resultProjectionStatus: 'PROJECTED',
        validatedArgumentNames: Array.from({ length: 18 }, (_, index) => `arg-${index}-${'x'.repeat(230)}`),
        validatedArgumentNamesTruncated: 'true',
        validatedResultFieldNames: Array.from({ length: 17 }, (_, index) => `result-${index}-${'x'.repeat(227)}`),
        validatedResultFieldNamesTruncated: 'true',
      }),
    ).toBe(false);
  });

  it('rejects unsafe names, item overflow, byte overflow, and invalid markers', () => {
    expect(isModelInvocationSafePayload('started', startedPayload(['unsafe name'], 'false'))).toBe(false);
    expect(
      isModelInvocationSafePayload(
        'started',
        startedPayload(
          Array.from({ length: 101 }, (_, index) => `tool-${index}`),
          'true',
        ),
      ),
    ).toBe(false);
    expect(
      isModelInvocationSafePayload(
        'completed',
        completedPayload(
          Array.from({ length: 20 }, (_, index) => `tool-${index}-${'x'.repeat(240)}`),
          'true',
        ),
      ),
    ).toBe(false);
    expect(isModelInvocationSafePayload('completed', completedPayload(['Read'], 'yes'))).toBe(false);
    expect(isModelInvocationSafePayload('completed', { ...completedPayload(['Read'], 'false'), durationMs: -1 })).toBe(false);
    expect(
      isModelInvocationSafePayload('completed', { ...completedPayload(['Read'], 'false'), firstContentLatencyMs: Number.POSITIVE_INFINITY }),
    ).toBe(false);
  });
});

describe('capability public identity timeline schema', () => {
  const started = (identity: Record<string, unknown>) => ({
    capabilityId: 'Skill',
    toolCallId: 'call-1',
    stepId: 'turn-1',
    ...identity,
  });

  it('accepts optional legacy identity and a legal wrapper target', () => {
    expect(isCapabilityStartedTimelinePayload(started({}))).toBe(true);
    expect(isCapabilityStartedTimelinePayload(started({ capabilityKind: 'TOOL', targetCapabilityId: 'network-diagnosis' }))).toBe(true);
    expect(isCapabilityStartedTimelinePayload(started({ capabilityKind: 'TOOL', targetCapabilityId: '📡'.repeat(128) }))).toBe(true);
  });

  it.each([
    { capabilityKind: 'RECIPE' },
    { capabilityKind: '' },
    { capabilityKind: 'TOOL', targetCapabilityId: '' },
    { capabilityKind: 'TOOL', targetCapabilityId: '   ' },
    { capabilityKind: 'TOOL', targetCapabilityId: 'x'.repeat(129) },
    { capabilityKind: 'TOOL', targetCapabilityId: 'network\u0000diagnosis' },
    { capabilityId: 'Read', capabilityKind: 'TOOL', targetCapabilityId: 'unexpected' },
  ])('rejects an invalid public identity: %o', (identity) => {
    expect(isCapabilityStartedTimelinePayload(started(identity))).toBe(false);
  });
});

function startedPayload(names: readonly string[], marker: string) {
  return {
    stepId: 'turn-1',
    modelId: 'model',
    messageCountBucket: '1',
    timeoutMsBucket: '5001-30000',
    maxOutputTokensBucket: '1-1024',
    disclosedCapabilityNames: names,
    disclosedCapabilityNamesTruncated: marker,
    modelOptionSummary: { timeoutMs: 10_000, toolCount: names.length },
    providerOptionKeys: [],
    selectedMessageRefs: [],
    disclosedCapabilityIds: [],
    modelMessageCount: 1,
  };
}

function completedPayload(names: readonly string[], marker: string) {
  return {
    stepId: 'turn-1',
    modelId: 'model',
    resolvedToolNames: names,
    resolvedToolNamesTruncated: marker,
    toolCallCount: names.length,
  };
}
