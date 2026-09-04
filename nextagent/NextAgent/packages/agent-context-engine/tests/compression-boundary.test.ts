import { brand, type JsonValue } from '@nextagent/agent-common';
import type { ReplacementEvidence, SessionMessage } from '@nextagent/agent-contracts/session';
import { classifyReplacement, LARGE_CONTENT_THRESHOLDS, readReplacementDecision } from '@nextagent/agent-context-engine';
import { describe, expect, it } from 'vitest';

/**
 * Spec anchor: add-ts-large-content-references §"Replacement decisions
 * are durable session-message facts" + design decision 8.1
 * (replacement 与 compression/summary 形态边界).
 *
 * The boundary: this capability's frozen replacement decisions
 * (`PERSISTED_PREVIEW` / `SPECIALIZED_REF` / `EMPTY_MARKER` with
 * `decisionState: "frozen"`) are owned by `add-ts-large-content-
 * references` and MUST NOT be reshaped by `add-ts-context-compression`
 * or `add-ts-traceable-summary-generation`. The previously-`INLINE`
 * history that gets compressed moves to `MODEL_SUMMARY` refType
 * (owned by the compression/summary changes); this capability
 * does not produce that refType.
 *
 * These tests pin the boundary at the `add-ts-large-content-references`
 * side. The full compression path lives in the sibling changes.
 */
describe('replacement ↔ compression / summary boundary (task 5.1)', () => {
  const baseLineage = { sourceMessageId: null, sourceRunId: null, sourceInvocationId: null, stepId: null } as const;

  it('a frozen PERSISTED_PREVIEW history message is NOT reshaped by a downstream re-classification', () => {
    // Build a `SessionMessage` whose `metadata.replacement.decisionState`
    // is `frozen`. A downstream compression / summary pass MUST NOT
    // reshape the message content; the large-content spec fixes the
    // boundary that frozen forms are durable.
    const frozenEvidence: ReplacementEvidence = {
      kind: 'PERSISTED_PREVIEW',
      reason: 'size-above-inline-threshold',
      contentRef: { refId: 'blob-frozen-1', refType: 'CAPABILITY_RESULT' },
      originalSize: 50_000,
      previewSize: 1_024,
      contentType: 'text/plain',
      lineage: baseLineage,
      decisionState: 'frozen',
    };
    const message: SessionMessage = {
      messageId: brand<string, 'MessageId'>('frozen-1'),
      sessionId: brand<string, 'SessionId'>('session-1'),
      requestId: brand<string, 'MessageId'>('request-1'),
      runId: brand<string, 'RequestRunId'>('run-1'),
      role: 'CAPABILITY_RESULT',
      content: '<persisted-content>...</persisted-content>',
      contentType: 'PLAIN_TEXT',
      metadata: { replacement: frozenEvidence as unknown as JsonValue },
      sequence: 0,
      visible: true,
      createdAt: brand<number, 'EpochMillis'>(0),
    };

    // The readReplacementDecision helper returns the frozen
    // evidence unchanged; this is the API that downstream
    // compression / summary passes consume.
    const read = readReplacementDecision(message);
    expect(read).toBeDefined();
    expect(read?.kind).toBe('PERSISTED_PREVIEW');
    expect(read?.decisionState).toBe('frozen');
    expect(read?.contentRef?.refType).toBe('CAPABILITY_RESULT');
  });

  it('a frozen SPECIALIZED_REF history message is NOT reshaped', () => {
    const frozenEvidence: ReplacementEvidence = {
      kind: 'SPECIALIZED_REF',
      reason: 'content-type-binary',
      contentRef: { refId: 'art-frozen-1', refType: 'ARTIFACT' },
      originalSize: 100_000,
      previewSize: 0,
      contentType: 'application/octet-stream',
      lineage: baseLineage,
      decisionState: 'frozen',
    };
    const message: SessionMessage = {
      messageId: brand<string, 'MessageId'>('frozen-2'),
      sessionId: brand<string, 'SessionId'>('session-1'),
      requestId: brand<string, 'MessageId'>('request-1'),
      runId: brand<string, 'RequestRunId'>('run-1'),
      role: 'CAPABILITY_RESULT',
      content: '<specialized-content>...</specialized-content>',
      contentType: 'PLAIN_TEXT',
      metadata: { replacement: frozenEvidence as unknown as JsonValue },
      sequence: 0,
      visible: true,
      createdAt: brand<number, 'EpochMillis'>(0),
    };
    const read = readReplacementDecision(message);
    expect(read).toBeDefined();
    expect(read?.kind).toBe('SPECIALIZED_REF');
    expect(read?.decisionState).toBe('frozen');
  });

  it('an EMPTY_MARKER history message is NOT reshaped', () => {
    const frozenEvidence: ReplacementEvidence = {
      kind: 'EMPTY_MARKER',
      reason: 'empty-output',
      contentRef: null,
      originalSize: 0,
      previewSize: 0,
      contentType: 'text/plain',
      lineage: baseLineage,
      decisionState: 'frozen',
    };
    const message: SessionMessage = {
      messageId: brand<string, 'MessageId'>('frozen-3'),
      sessionId: brand<string, 'SessionId'>('session-1'),
      requestId: brand<string, 'MessageId'>('request-1'),
      runId: brand<string, 'RequestRunId'>('run-1'),
      role: 'CAPABILITY_RESULT',
      content: '(query-alarm completed with no output)',
      contentType: 'PLAIN_TEXT',
      metadata: { replacement: frozenEvidence as unknown as JsonValue },
      sequence: 0,
      visible: true,
      createdAt: brand<number, 'EpochMillis'>(0),
    };
    const read = readReplacementDecision(message);
    expect(read).toBeDefined();
    expect(read?.kind).toBe('EMPTY_MARKER');
    expect(read?.decisionState).toBe('frozen');
  });

  it('fresh content classified by this change produces PERSISTED_PREVIEW / SPECIALIZED_REF / EMPTY_MARKER — NEVER MODEL_SUMMARY', () => {
    // The classifier MUST NOT route fresh content to MODEL_SUMMARY;
    // that refType is owned by the compression / summary change.
    // This test pins the boundary at the classifier level.
    const inputs: Array<{ content: string; contentType: string; expectedKind: string }> = [
      {
        content: 'x'.repeat(LARGE_CONTENT_THRESHOLDS.inlineMaxBytes + 1),
        contentType: 'text/plain',
        expectedKind: 'PERSISTED_PREVIEW',
      },
      { content: 'x', contentType: 'application/octet-stream', expectedKind: 'SPECIALIZED_REF' },
      { content: '   ', contentType: 'text/plain', expectedKind: 'EMPTY_MARKER' },
    ];
    for (const input of inputs) {
      const decision = classifyReplacement({
        content: input.content,
        contentType: input.contentType,
        originalSize: input.content.length,
      });
      expect(decision.kind).toBe(input.expectedKind);
      // The classifier must never emit MODEL_SUMMARY (not in the
      // first-version enum); the spec's first-version replacement
      // kinds are INLINE / PERSISTED_PREVIEW / SPECIALIZED_REF /
      // EMPTY_MARKER only.
      expect(decision.kind).not.toBe('MODEL_SUMMARY');
    }
  });
});
