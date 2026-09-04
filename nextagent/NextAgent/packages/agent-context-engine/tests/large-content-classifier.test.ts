import {
  applyReplacement,
  classifyReplacement,
  createInMemoryContentRef,
  LARGE_CONTENT_THRESHOLDS,
  readReplacementDecision,
} from '@nextagent/agent-context-engine';
import { brand, type MessageId } from '@nextagent/agent-common';
import type { ReplacementEvidence, SessionMessage } from '@nextagent/agent-contracts/session';
import { describe, expect, it } from 'vitest';

const SESSION = brand<string, 'SessionId'>('session-large');
const TENANT = brand<string, 'TenantId'>('tenant-large');
const SUBJECT = brand<string, 'SubjectId'>('subject-large');

function makeMessage(opts: { messageId: string; role: SessionMessage['role']; content: string; replacement?: ReplacementEvidence }): SessionMessage {
  return {
    messageId: brand<string, 'MessageId'>(opts.messageId),
    sessionId: SESSION,
    requestId: brand<string, 'MessageId'>(opts.messageId),
    role: opts.role,
    content: opts.content,
    contentType: 'PLAIN_TEXT',
    metadata: opts.replacement === undefined ? {} : { replacement: opts.replacement as never },
    sequence: 0,
    visible: true,
    createdAt: brand<number, 'EpochMillis'>(1),
  };
}

function makeLineage(): ReplacementEvidence['lineage'] {
  return {
    sourceMessageId: brand<string, 'MessageId'>('src'),
    sourceRunId: brand<string, 'RequestRunId'>('run'),
    sourceInvocationId: brand<string, 'CapabilityInvocationId'>('inv'),
    stepId: 'step',
  };
}

describe('classifyReplacement (λ.1)', () => {
  it('returns EMPTY_MARKER for empty / whitespace-only content', () => {
    expect(classifyReplacement({ content: '', originalSize: 0 })).toEqual({
      kind: 'EMPTY_MARKER',
      reason: 'empty-output',
      shouldPersist: false,
    });
    expect(classifyReplacement({ content: '   \n\t  ', originalSize: 5 })).toEqual({
      kind: 'EMPTY_MARKER',
      reason: 'empty-output',
      shouldPersist: false,
    });
  });

  it('returns SPECIALIZED_REF for image / pdf / binary content type', () => {
    const dec = classifyReplacement({ content: 'irrelevant text', contentType: 'image/png', originalSize: 5000 });
    expect(dec.kind).toBe('SPECIALIZED_REF');
    expect(dec.reason).toBe('content-type-binary');
    expect(dec.shouldPersist).toBe(true);
  });

  it('returns INLINE when size is within the inline threshold', () => {
    const dec = classifyReplacement({ content: 'small content', originalSize: 100 });
    expect(dec.kind).toBe('INLINE');
    expect(dec.shouldPersist).toBe(false);
  });

  it('returns PERSISTED_PREVIEW when size is above the inline threshold', () => {
    const dec = classifyReplacement({
      content: 'x'.repeat(LARGE_CONTENT_THRESHOLDS.inlineMaxBytes + 1),
      originalSize: LARGE_CONTENT_THRESHOLDS.inlineMaxBytes + 1,
    });
    expect(dec.kind).toBe('PERSISTED_PREVIEW');
    expect(dec.reason).toBe('size-above-inline-threshold');
    expect(dec.shouldPersist).toBe(true);
  });

  it('returns INLINE for Infinity tools even when oversized', () => {
    const dec = classifyReplacement({
      content: 'x'.repeat(LARGE_CONTENT_THRESHOLDS.inlineMaxBytes + 1),
      originalSize: LARGE_CONTENT_THRESHOLDS.inlineMaxBytes + 1,
      policy: {
        inlineMaxBytes: LARGE_CONTENT_THRESHOLDS.inlineMaxBytes,
        previewMaxChars: LARGE_CONTENT_THRESHOLDS.previewMaxChars,
        infinity: true,
      },
    });
    expect(dec.kind).toBe('INLINE');
    expect(dec.shouldPersist).toBe(false);
  });
});

describe('applyReplacement (λ.1)', () => {
  const lineage = makeLineage();
  const persistOk = (): { contentRef: ReplacementEvidence['contentRef'] } => ({
    contentRef: createInMemoryContentRef({ refType: 'CAPABILITY_RESULT', refId: 'blob-1' }),
  });

  it('INLINE: returns the original content with a frozen INLINE evidence (no persist)', () => {
    const result = applyReplacement({
      kind: 'INLINE',
      reason: 'size-above-inline-threshold',
      originalContent: 'small content',
      originalSize: 13,
      lineage,
      persistContent: persistOk,
      now: () => 0,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.modelVisibleContent).toBe('small content');
      expect(result.didPersist).toBe(false);
      expect(result.replacement.kind).toBe('INLINE');
      expect(result.replacement.contentRef).toBeNull();
    }
  });

  it('EMPTY_MARKER: returns the empty marker text with a frozen evidence (no persist)', () => {
    const result = applyReplacement({
      kind: 'EMPTY_MARKER',
      reason: 'empty-output',
      originalContent: '   ',
      originalSize: 3,
      lineage,
      persistContent: persistOk,
      now: () => 0,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.modelVisibleContent).toBe('<empty tool result>');
      expect(result.didPersist).toBe(false);
      expect(result.replacement.kind).toBe('EMPTY_MARKER');
    }
  });

  it('PERSISTED_PREVIEW: emits a bounded preview + full content persisted as ContentRef', () => {
    const long = 'x'.repeat(LARGE_CONTENT_THRESHOLDS.previewMaxChars * 5);
    const result = applyReplacement({
      kind: 'PERSISTED_PREVIEW',
      reason: 'size-above-inline-threshold',
      originalContent: long,
      originalSize: long.length,
      lineage,
      persistContent: persistOk,
      now: () => 0,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.didPersist).toBe(true);
      expect(result.replacement.kind).toBe('PERSISTED_PREVIEW');
      expect(result.replacement.contentRef).not.toBeNull();
      expect(result.replacement.previewSize).toBeLessThanOrEqual(LARGE_CONTENT_THRESHOLDS.previewMaxChars);
      expect(result.modelVisibleContent).toContain('full content available via contentRef');
    }
  });

  it('offload failure with no inline fallback: returns explicit failure with degradation:offload-failed-into-overflow', () => {
    const result = applyReplacement({
      kind: 'PERSISTED_PREVIEW',
      reason: 'size-above-inline-threshold',
      originalContent: 'x'.repeat(LARGE_CONTENT_THRESHOLDS.inlineMaxBytes + 100),
      originalSize: LARGE_CONTENT_THRESHOLDS.inlineMaxBytes + 100,
      lineage,
      persistContent: persistOk,
      offloadFailure: { reason: 'blob store unavailable', canInlineFallback: false },
      now: () => 0,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('degradation:offload-failed-into-overflow');
      expect(result.replacement.degradation?.code).toBe('degradation:offload-failed-into-overflow');
    }
  });

  it('offload failure WITH inline fallback allowed: still persists, marks degradation', () => {
    const result = applyReplacement({
      kind: 'PERSISTED_PREVIEW',
      reason: 'size-above-inline-threshold',
      originalContent: 'x'.repeat(LARGE_CONTENT_THRESHOLDS.inlineMaxBytes + 100),
      originalSize: LARGE_CONTENT_THRESHOLDS.inlineMaxBytes + 100,
      lineage,
      persistContent: persistOk,
      offloadFailure: { reason: 'blob store unavailable', canInlineFallback: true },
      now: () => 0,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      // Inline-fallback path (design decision 5 step 1): the
      // original block is small enough to fit inline; the applier
      // does NOT call persistContent (that is the failing call).
      // didPersist must be false to make this boundary explicit.
      expect(result.didPersist).toBe(false);
      expect(result.replacement.degradation?.code).toBe('degradation:offload-failed-into-inline-fallback');
      expect(result.replacement.kind).toBe('INLINE');
    }
  });
});

describe('readReplacementDecision (λ.1 frozen reuse)', () => {
  it('returns the persisted evidence when present', () => {
    const evidence: ReplacementEvidence = {
      kind: 'PERSISTED_PREVIEW',
      reason: 'size-above-inline-threshold',
      contentRef: createInMemoryContentRef({ refType: 'CAPABILITY_RESULT', refId: 'blob-1' }),
      originalSize: 50_000,
      previewSize: 1_024,
      lineage: makeLineage(),
    };
    const message = makeMessage({
      messageId: 'm1',
      role: 'CAPABILITY_RESULT',
      content: '<preview>...</preview>',
      replacement: evidence,
    });
    expect(readReplacementDecision(message)).toEqual(evidence);
  });

  it('returns undefined when metadata has no replacement block', () => {
    const message = makeMessage({
      messageId: 'm1',
      role: 'ASSISTANT',
      content: 'regular text',
    });
    expect(readReplacementDecision(message)).toBeUndefined();
  });
});
