import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { renderHook, cleanup } from '@testing-library/react';
import type { StreamEnvelope } from '../../state/contracts.ts';
import { expandPanelStore } from './ExpandPanelStore.ts';
import { useExpandPanelStreamWatcher } from './useExpandPanelStreamWatcher.ts';

function makeExpandPanelEnvelope(
  sequence: number,
  eventId: string,
  toolMessageType: string,
  content: unknown,
  transportHints: readonly string[] = [],
): StreamEnvelope {
  return {
    eventId,
    sessionId: 'test-session',
    requestId: 'test-request',
    runId: 'test-run',
    rootMessageId: 'test-root',
    requestContextId: 'test-context',
    sequence,
    eventType: 'TOOL_STRUCTURED_DELTA',
    timelineEventRef: null,
    transportHints,
    payload: {
      contentType: 'PLAIN_TEXT',
      content: content as never,
      text: '',
      role: 'CAPABILITY_RESULT',
      messageId: `msg-${sequence}`,
      runId: 'test-run',
      rootMessageId: 'test-root',
      requestContextId: 'test-context',
      visible: true,
      toolEventType: 'EXPAND_PANEL' as never,
      toolMessageType: toolMessageType as never,
      toolCallId: 'test-call',
      capabilityId: 'test-cap',
    },
    createdAt: 1783346000000,
  } as StreamEnvelope;
}

describe('useExpandPanelStreamWatcher', () => {
  beforeEach(() => {
    expandPanelStore.getState().close();
  });
  afterEach(() => {
    cleanup();
  });

  it('opens expand panel for live-stream EXPAND_PANEL events', () => {
    const events: StreamEnvelope[] = [makeExpandPanelEnvelope(1, 'evt-1', 'TEXT', 'Report content')];
    renderHook(() => useExpandPanelStreamWatcher(events));
    expect(expandPanelStore.getState().isOpen).toBe(true);
    expect(expandPanelStore.getState().content).toEqual({
      toolMessageType: 'TEXT',
      content: 'Report content',
    });
    expect(expandPanelStore.getState().sourceKey).toBe('live-stream');
  });

  it('does not open for history-load events', () => {
    const events: StreamEnvelope[] = [makeExpandPanelEnvelope(1, 'evt-1', 'TEXT', 'Report', ['history-load'])];
    renderHook(() => useExpandPanelStreamWatcher(events));
    expect(expandPanelStore.getState().isOpen).toBe(false);
    expect(expandPanelStore.getState().content).toBeNull();
  });

  it('skips already processed events via sequence dedup', () => {
    const { rerender } = renderHook(() => useExpandPanelStreamWatcher([makeExpandPanelEnvelope(1, 'evt-1', 'TEXT', 'First')]));
    expect(expandPanelStore.getState().content?.content).toBe('First');

    rerender();
    expect(expandPanelStore.getState().content?.content).toBe('First');
  });

  it('ignores non-EXPAND_PANEL TOOL_STRUCTURED_DELTA events', () => {
    const events: StreamEnvelope[] = [
      {
        ...makeExpandPanelEnvelope(1, 'evt-1', 'TEXT', 'Title text'),
        payload: {
          ...makeExpandPanelEnvelope(1, 'evt-1', 'TEXT', 'Title text').payload,
          toolEventType: 'TITLE' as never,
        },
      } as StreamEnvelope,
    ];
    renderHook(() => useExpandPanelStreamWatcher(events));
    expect(expandPanelStore.getState().isOpen).toBe(false);
  });

  it('resets sequence dedup when sessionId changes', () => {
    const { rerender } = renderHook(
      ({ sid }: { sid: string }) => useExpandPanelStreamWatcher([makeExpandPanelEnvelope(1, 'evt-1', 'TEXT', 'First')], sid),
      { initialProps: { sid: 'session-a' } },
    );
    expect(expandPanelStore.getState().content?.content).toBe('First');

    // Same sequence number but different session should be processed
    rerender({ sid: 'session-b' });
    expect(expandPanelStore.getState().content?.content).toBe('First');
  });

  it('accumulates streaming TEXT EXPAND_PANEL fragments', () => {
    const events: StreamEnvelope[] = [
      makeExpandPanelEnvelope(1, 'evt-1', 'TEXT', 'Part 1. '),
      makeExpandPanelEnvelope(2, 'evt-2', 'TEXT', 'Part 2.'),
    ];
    renderHook(() => useExpandPanelStreamWatcher(events));
    expect(expandPanelStore.getState().isOpen).toBe(true);
    expect(expandPanelStore.getState().content).toEqual({
      toolMessageType: 'TEXT',
      content: 'Part 1. Part 2.',
    });
  });

  it('replaces content when EXPAND_PANEL message type changes from TEXT to PIU', () => {
    const events: StreamEnvelope[] = [
      makeExpandPanelEnvelope(1, 'evt-1', 'TEXT', 'Text content'),
      makeExpandPanelEnvelope(2, 'evt-2', 'PIU', { piuName: 'report' }),
    ];
    renderHook(() => useExpandPanelStreamWatcher(events));
    expect(expandPanelStore.getState().content?.toolMessageType).toBe('PIU');
    expect(expandPanelStore.getState().content?.content).toEqual({ piuName: 'report' });
  });
});
