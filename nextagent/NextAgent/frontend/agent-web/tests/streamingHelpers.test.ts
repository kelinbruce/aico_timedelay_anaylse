import { describe, it, expect } from 'vitest';
import {
  appendEnvelope,
  buildEnvelopeIdentity,
  buildInputSegmentByEnvelope,
  detectSequenceGap,
  hasSignificantSequenceGap,
} from '../src/features/chat/utils/streamingHelpers.ts';
import type { StreamEnvelope } from '../src/state/contracts.ts';

function makeEnvelope(overrides: Partial<StreamEnvelope> = {}): StreamEnvelope {
  return {
    eventId: `evt-${overrides.sequence ?? 0}`,
    sessionId: 'sess-1',
    requestId: 'req-1',
    sequence: 0,
    timelineEventRef: null,
    transportHints: [],
    createdAt: '2024-01-01T00:00:00Z',
    eventType: 'LLM_CONTENT_DELTA',
    payload: { text: 'test', role: 'ASSISTANT', metadata: { accumulated: true } },
    ...overrides,
  } as StreamEnvelope;
}

describe('streamingHelpers', () => {
  describe('buildInputSegmentByEnvelope', () => {
    it('increments only the matching execution scope after accepted user input', () => {
      const before = makeEnvelope({ eventId: 'before', sequence: 1, runId: 'run-1', rootMessageId: 'root-1', requestContextId: 'ctx-1' });
      const boundary = makeEnvelope({
        eventId: 'boundary',
        sequence: 2,
        eventType: 'USER_INPUT_RECEIVED',
        runId: 'run-1',
        rootMessageId: 'root-1',
        requestContextId: 'ctx-1',
      });
      const otherRun = makeEnvelope({ eventId: 'other-run', sequence: 3, runId: 'run-2', rootMessageId: 'root-1', requestContextId: 'ctx-1' });
      const after = makeEnvelope({ eventId: 'after', sequence: 4, runId: 'run-1', rootMessageId: 'root-1', requestContextId: 'ctx-1' });

      const segments = buildInputSegmentByEnvelope([before, boundary, otherRun, after]);

      expect([segments.get(before), segments.get(boundary), segments.get(otherRun), segments.get(after)]).toEqual([0, 0, 0, 1]);
    });

    it('counts a replayed boundary only once', () => {
      const boundary = makeEnvelope({ eventId: 'boundary', sequence: 1, eventType: 'USER_INPUT_RECEIVED', runId: 'run-1' });
      const replay = { ...boundary } as StreamEnvelope;
      const after = makeEnvelope({ eventId: 'after', sequence: 2, runId: 'run-1' });

      expect(buildInputSegmentByEnvelope([boundary, replay, after]).get(after)).toBe(1);
    });
  });

  describe('buildEnvelopeIdentity', () => {
    it('should use eventId when available', () => {
      const envelope = makeEnvelope({ eventId: 'my-event', requestId: 'req-1' });
      expect(buildEnvelopeIdentity(envelope)).toBe('req-1:my-event');
    });

    it('should fallback to sequence+eventType when eventId is empty', () => {
      const envelope = makeEnvelope({ eventId: '', requestId: 'req-1', sequence: 5, eventType: 'REQUEST_ACCEPTED' });
      expect(buildEnvelopeIdentity(envelope)).toBe('req-1:5:REQUEST_ACCEPTED');
    });

    it('should scope identities by requestContextId when attempts share one root', () => {
      const firstAttempt = makeEnvelope({
        eventId: 'same-event',
        requestId: 'root-1',
        requestContextId: 'ctx-1',
        payload: { rootMessageId: 'root-1', requestContextId: 'ctx-1' },
      });
      const secondAttempt = makeEnvelope({
        eventId: 'same-event',
        requestId: 'root-1',
        requestContextId: 'ctx-2',
        payload: { rootMessageId: 'root-1', requestContextId: 'ctx-2' },
      });

      expect(buildEnvelopeIdentity(firstAttempt)).toBe('ctx-1:same-event');
      expect(buildEnvelopeIdentity(secondAttempt)).toBe('ctx-2:same-event');
    });
  });

  describe('detectSequenceGap', () => {
    it('should return 0 when no prior envelopes exist', () => {
      const incoming = makeEnvelope({ sequence: 5 });
      expect(detectSequenceGap([], incoming)).toBe(0);
    });

    it('should return 0 when sequences are contiguous', () => {
      const existing = [makeEnvelope({ sequence: 0 }), makeEnvelope({ sequence: 1 })];
      const incoming = makeEnvelope({ sequence: 2 });
      expect(detectSequenceGap(existing, incoming)).toBe(0);
    });

    it('should return gap size when sequences have a gap', () => {
      const existing = [makeEnvelope({ sequence: 0 }), makeEnvelope({ sequence: 1 })];
      const incoming = makeEnvelope({ sequence: 5 });
      expect(detectSequenceGap(existing, incoming)).toBe(3);
    });

    it('should return 0 when incoming sequence is lower (out-of-order)', () => {
      const existing = [makeEnvelope({ sequence: 5 })];
      const incoming = makeEnvelope({ sequence: 2 });
      expect(detectSequenceGap(existing, incoming)).toBe(0);
    });

    it('should only compare within the same requestId', () => {
      const existing = [makeEnvelope({ requestId: 'req-1', sequence: 10 }), makeEnvelope({ requestId: 'req-2', sequence: 5 })];
      const incoming = makeEnvelope({ requestId: 'req-2', sequence: 20 });
      expect(detectSequenceGap(existing, incoming)).toBe(14);
    });

    it('should not compare sequence continuity across attempts under the same root', () => {
      const existing = [
        makeEnvelope({
          requestId: 'root-1',
          requestContextId: 'ctx-1',
          sequence: 20,
          payload: { rootMessageId: 'root-1', requestContextId: 'ctx-1' },
        }),
      ];
      const incoming = makeEnvelope({
        requestId: 'root-1',
        requestContextId: 'ctx-2',
        sequence: 1,
        payload: { rootMessageId: 'root-1', requestContextId: 'ctx-2' },
      });

      expect(detectSequenceGap(existing, incoming)).toBe(0);
    });

    it('should ignore local optimistic envelopes when calculating sequence gaps', () => {
      const existing = [makeEnvelope({ requestId: 'req-1', sequence: 0, transportHints: ['local-optimistic'] })];
      const incoming = makeEnvelope({ requestId: 'req-1', sequence: 120 });
      expect(detectSequenceGap(existing, incoming)).toBe(0);
    });

    it('should ignore history-loaded envelopes when calculating sequence gaps', () => {
      const existing = [makeEnvelope({ requestId: 'req-1', sequence: 120, transportHints: ['history-load'] })];
      const incoming = makeEnvelope({ requestId: 'req-1', sequence: 5 });
      expect(detectSequenceGap(existing, incoming)).toBe(0);
    });
  });

  describe('hasSignificantSequenceGap', () => {
    it('should return false for small gaps', () => {
      const existing = [makeEnvelope({ sequence: 0 })];
      const incoming = makeEnvelope({ sequence: 10 });
      expect(hasSignificantSequenceGap(existing, incoming)).toBe(false);
    });

    it('should return true for gaps >= 50', () => {
      const existing = [makeEnvelope({ sequence: 0 })];
      const incoming = makeEnvelope({ sequence: 51 });
      expect(hasSignificantSequenceGap(existing, incoming)).toBe(true);
    });

    it('should return false when no prior envelopes', () => {
      const incoming = makeEnvelope({ sequence: 100 });
      expect(hasSignificantSequenceGap([], incoming)).toBe(false);
    });
  });

  describe('appendEnvelope', () => {
    it('should allow a live envelope even when history-loaded envelopes have higher sequence values', () => {
      const previous = {
        'sess-1': [makeEnvelope({ requestId: 'req-1', sequence: 120, transportHints: ['history-load'] })],
      };

      const next = appendEnvelope(previous, 'sess-1', makeEnvelope({ requestId: 'req-1', sequence: 5 }));

      expect(next['sess-1']).toHaveLength(2);
      expect(next['sess-1']?.at(-1)?.sequence).toBe(5);
    });

    it('should keep lower-sequence live envelopes in receive order', () => {
      const previous = {
        'sess-1': [
          makeEnvelope({ requestId: 'req-1', sequence: 120, transportHints: ['history-load'] }),
          makeEnvelope({ requestId: 'req-1', sequence: 7 }),
        ],
      };

      const next = appendEnvelope(previous, 'sess-1', makeEnvelope({ requestId: 'req-1', sequence: 5 }));

      expect(next['sess-1']).toHaveLength(3);
      expect(next['sess-1']?.map((envelope) => envelope.sequence)).toEqual([120, 7, 5]);
    });

    it('should allow a new attempt to restart sequence under the same root', () => {
      const previous = {
        'sess-1': [
          makeEnvelope({
            requestId: 'root-1',
            requestContextId: 'ctx-1',
            sequence: 10,
            payload: { rootMessageId: 'root-1', requestContextId: 'ctx-1' },
          }),
        ],
      };

      const next = appendEnvelope(
        previous,
        'sess-1',
        makeEnvelope({
          requestId: 'root-1',
          requestContextId: 'ctx-2',
          sequence: 1,
          payload: { rootMessageId: 'root-1', requestContextId: 'ctx-2' },
        }),
      );

      expect(next['sess-1']).toHaveLength(2);
      expect(next['sess-1']?.at(-1)?.requestContextId).toBe('ctx-2');
    });
  });
});
