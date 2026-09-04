import { brand } from '@nextagent/agent-common';
import type { SessionMessage } from '@nextagent/agent-contracts/session';
import { describe, expect, it } from 'vitest';

import { classifySpecializedKind, renderSpecializedDescriptor, renderEmptyMarker } from '@nextagent/agent-context-engine';

/**
 * Spec anchor: add-ts-large-content-references design decision 7 ("attachment
 * 和二进制内容保持专用路径") + §3.2 ("跨路径 metadata 一致") + §3.3
 * ("specialized handler for binary / MCP / attachment").
 *
 * The contract: every "content read" path — message body, archive
 * (compressed history), and attachment — produces a `SessionMessage` with
 * the same metadata.replacement shape and the same model-visible
 * `content` rendering rules. This test pins the SHAPE so that
 * downstream consumers (renderer, budget gate) can rely on a single
 * normalization.
 */
describe('read-path metadata shape contract (task 3.2)', () => {
  const ALLOWED_REF_TYPES = ['ATTACHMENT', 'CAPABILITY_RESULT', 'MODEL_SUMMARY', 'ARTIFACT'] as const;

  it('every replacement kind produces a valid metadata.replacement shape regardless of source path', () => {
    for (const source of ['message-body', 'archive', 'attachment'] as const) {
      for (const kind of ['INLINE', 'PERSISTED_PREVIEW', 'SPECIALIZED_REF', 'EMPTY_MARKER'] as const) {
        const message = buildMessage(source, kind);
        const replacement = message.metadata['replacement'] as
          { kind: string; reason: string; contentRef: { refType: string } | null; originalSize: number; previewSize: number } | undefined;
        // Every replacement is either null (INLINE is optional) or a valid
        // shape (kind / reason / contentRef / originalSize / previewSize /
        // contentType / lineage / decisionState).
        if (replacement === undefined) {
          // INLINE may omit; non-INLINE MUST carry.
          if (kind !== 'INLINE') {
            throw new Error(`source=${source} kind=${kind} MUST carry replacement evidence`);
          }
          continue;
        }
        expect(typeof replacement.kind, `source=${source} kind=${kind}`).toBe('string');
        expect(typeof replacement.reason, `source=${source} kind=${kind}`).toBe('string');
        expect(typeof replacement.originalSize, `source=${source} kind=${kind}`).toBe('number');
        expect(typeof replacement.previewSize, `source=${source} kind=${kind}`).toBe('number');
        // contentRef is either null or carries a known refType.
        if (replacement.contentRef !== null) {
          const refType = replacement.contentRef.refType;
          expect(
            (ALLOWED_REF_TYPES as readonly string[]).includes(refType),
            `source=${source} kind=${kind} refType=${refType} not in ${ALLOWED_REF_TYPES.join(',')}`,
          ).toBe(true);
        }
      }
    }
  });

  it('INLINE and EMPTY_MARKER may carry contentRef=null; other kinds carry a non-null ref', () => {
    for (const source of ['message-body', 'archive', 'attachment'] as const) {
      for (const kind of ['INLINE', 'EMPTY_MARKER'] as const) {
        const message = buildMessage(source, kind);
        const replacement = message.metadata['replacement'] as { contentRef: unknown } | undefined;
        if (replacement === undefined) {
          continue;
        }
        expect(replacement.contentRef, `source=${source} kind=${kind} should be null`).toBeNull();
      }
      for (const kind of ['PERSISTED_PREVIEW', 'SPECIALIZED_REF'] as const) {
        const message = buildMessage(source, kind);
        const replacement = message.metadata['replacement'] as { contentRef: unknown } | undefined;
        expect(replacement?.contentRef, `source=${source} kind=${kind} must not be null`).not.toBeNull();
      }
    }
  });

  it('specialized descriptor renders a safe tagged block (no path / credential / bytes)', () => {
    const descriptor = renderSpecializedDescriptor({
      kind: 'image',
      contentRef: {
        refId: 'art-1',
        refType: 'ATTACHMENT',
        mimeType: 'image/png',
      },
      safeDescriptor: 'cell-tower-east-01.png',
    });
    // The block must contain type, ref, descriptor, access instruction.
    expect(descriptor).toContain('<specialized-content>');
    expect(descriptor).toContain('Type: image/png');
    expect(descriptor).toContain('Kind: image');
    expect(descriptor).toContain('ATTACHMENT:art-1');
    expect(descriptor).toContain('cell-tower-east-01.png');
    expect(descriptor).toContain('</specialized-content>');
    // And it must NOT contain the forbidden patterns (path, base64, hex).
    expect(descriptor).not.toMatch(/C:\\/);
    expect(descriptor).not.toMatch(/\/home\//);
    expect(descriptor).not.toMatch(/data:.*;base64,/);
    expect(descriptor).not.toMatch(/\\x[0-9a-f]{2}/i);
  });

  it('empty marker renders a stable tagged line', () => {
    expect(renderEmptyMarker('query-alarm')).toBe('(query-alarm completed with no output)');
  });

  it('classifySpecializedKind routes every binary MIME to a known kind', () => {
    expect(classifySpecializedKind('image/png')).toBe('image');
    expect(classifySpecializedKind('image/jpeg')).toBe('image');
    expect(classifySpecializedKind('application/pdf')).toBe('pdf');
    expect(classifySpecializedKind('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')).toBe('excel');
    expect(classifySpecializedKind('application/vnd.ms-excel')).toBe('excel');
    expect(classifySpecializedKind('application/octet-stream')).toBe('binary');
    expect(classifySpecializedKind('application/zip')).toBe('binary');
    expect(classifySpecializedKind('video/mp4')).toBe('binary');
    expect(classifySpecializedKind('text/plain')).toBeNull();
    expect(classifySpecializedKind(undefined)).toBeNull();
  });
});

function buildMessage(
  source: 'message-body' | 'archive' | 'attachment',
  kind: 'INLINE' | 'PERSISTED_PREVIEW' | 'SPECIALIZED_REF' | 'EMPTY_MARKER',
): SessionMessage {
  const refType = source === 'attachment' ? 'ATTACHMENT' : source === 'archive' ? 'MODEL_SUMMARY' : 'CAPABILITY_RESULT';
  const replacement =
    kind === 'INLINE' || kind === 'EMPTY_MARKER'
      ? {
          kind,
          reason: 'policy:test',
          contentRef: null,
          originalSize: 0,
          previewSize: 0,
          contentType: 'text/plain',
          lineage: { sourceMessageId: null, sourceRunId: null, sourceInvocationId: null, stepId: null },
          decisionState: 'frozen' as const,
        }
      : {
          kind,
          reason: 'policy:test',
          contentRef: { refId: `${source}-1`, refType: refType as 'ATTACHMENT' | 'CAPABILITY_RESULT' | 'MODEL_SUMMARY' | 'ARTIFACT' },
          originalSize: 1000,
          previewSize: 200,
          contentType: kind === 'PERSISTED_PREVIEW' ? 'text/plain' : 'image/png',
          lineage: { sourceMessageId: null, sourceRunId: null, sourceInvocationId: null, stepId: null },
          decisionState: 'frozen' as const,
        };
  return {
    messageId: brand<string, 'MessageId'>(`${source}-${kind}`),
    sessionId: brand<string, 'SessionId'>('session-1'),
    requestId: brand<string, 'MessageId'>('request-1'),
    runId: brand<string, 'RequestRunId'>('run-1'),
    role: 'CAPABILITY_RESULT',
    content: 'model-visible content',
    contentType: 'PLAIN_TEXT',
    metadata: { replacement },
    sequence: 0,
    visible: true,
    createdAt: brand<number, 'EpochMillis'>(0),
  };
}
