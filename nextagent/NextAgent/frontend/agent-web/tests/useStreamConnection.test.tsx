// @vitest-environment jsdom
import { act, render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const connectStreamMock = vi.hoisted(() => vi.fn());
const runtimeConfigMock = vi.hoisted(() => ({ transportKind: 'SSE' as 'SSE' | 'WEBSOCKET' }));
const probeAuthChallengeMock = vi.hoisted(() => vi.fn());

vi.mock('../src/features/chat/transport/streamTransport.ts', () => ({
  connectStream: connectStreamMock,
  getStreamResumeFailureDetails: (error: unknown) =>
    error && typeof error === 'object' && 'details' in error ? (error as { details: unknown }).details : null,
}));

vi.mock('../src/config/runtimeConfig.ts', () => ({
  runtimeConfig: runtimeConfigMock,
  buildApiUrl: (path: string) => `https://backend.test${path}`,
}));

vi.mock('../src/services/authProbe.ts', () => ({
  probeAuthChallenge: probeAuthChallengeMock,
}));

import { useStreamConnection } from '../src/features/chat/hooks/useStreamConnection.ts';
import type { RuntimeActiveRunSummary, StreamEnvelope } from '../src/state/contracts.ts';

interface HarnessProps {
  readonly sessionId?: string;
  readonly canOpenStream: boolean;
  readonly isExecuting?: boolean;
  readonly appendEnvelope?: (sessionId: string, envelope: StreamEnvelope) => void;
  readonly appendEnvelopes?: (sessionId: string, envelopes: readonly StreamEnvelope[]) => void;
  readonly onLiveEnvelope?: (envelope: StreamEnvelope) => void;
  readonly onTerminal?: (envelope: StreamEnvelope) => void;
  readonly onRequestAccepted?: (envelope: StreamEnvelope) => void;
  readonly onRefreshRequired?: (details?: unknown) => Promise<boolean> | boolean | void;
  readonly onUserInputRequired?: (envelope: StreamEnvelope) => void;
  readonly onUserInputResolved?: (envelope: StreamEnvelope) => void;
  readonly activeRun?: RuntimeActiveRunSummary | null;
  readonly acceptedRun?: RuntimeActiveRunSummary | null;
  readonly onSessionLiveTailOpen?: () => void;
  readonly setConnectionState?: (sessionId: string, state: { phase: string; message: string | null }) => void;
}

function Harness({
  sessionId,
  canOpenStream,
  isExecuting = false,
  appendEnvelope,
  appendEnvelopes,
  onLiveEnvelope,
  onTerminal,
  onRequestAccepted,
  onRefreshRequired,
  onUserInputRequired,
  onUserInputResolved,
  activeRun,
  acceptedRun,
  onSessionLiveTailOpen,
  setConnectionState,
}: HarnessProps) {
  const params = {
    sessionId,
    canOpenStream,
    appendEnvelope: appendEnvelope ?? (() => {}),
    ...(appendEnvelopes ? { appendEnvelopes } : {}),
    setStreaming: () => {},
    isExecuting,
    ...(activeRun !== undefined ? { activeRun } : {}),
    ...(acceptedRun !== undefined ? { acceptedRun } : {}),
    ...(onSessionLiveTailOpen ? { onSessionLiveTailOpen } : {}),
    ...(setConnectionState ? { setConnectionState } : {}),
    ...(onLiveEnvelope ? { onLiveEnvelope } : {}),
    ...(onTerminal ? { onTerminal } : {}),
    ...(onRequestAccepted ? { onRequestAccepted } : {}),
    ...(onRefreshRequired ? { onRefreshRequired } : {}),
    ...(onUserInputRequired ? { onUserInputRequired } : {}),
    ...(onUserInputResolved ? { onUserInputResolved } : {}),
  };

  useStreamConnection(params);
  return null;
}

function makeLiveEnvelope(sequence: number, overrides: Partial<StreamEnvelope> = {}): StreamEnvelope {
  return {
    eventId: `evt-live-${sequence}`,
    sessionId: 'session-1',
    requestId: 'run-1',
    sequence,
    eventType: 'LLM_CONTENT_DELTA',
    timelineEventRef: `timeline-${sequence}`,
    transportHints: ['SSE'],
    payload: {
      delta: `token-${sequence}`,
      contentType: 'PLAIN_TEXT',
      role: 'ASSISTANT',
    },
    createdAt: `2026-04-18T08:00:${String(sequence).padStart(2, '0')}.000Z`,
    ...overrides,
  } as StreamEnvelope;
}

describe('useStreamConnection', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    runtimeConfigMock.transportKind = 'SSE';
    sessionStorage.clear();
  });

  it('keeps the session stream open when the session becomes idle', () => {
    const close = vi.fn();
    connectStreamMock.mockReturnValue({ close });

    const { rerender, unmount } = render(
      <Harness sessionId="session-1" canOpenStream isExecuting onTerminal={() => {}} onRefreshRequired={() => {}} />,
    );

    expect(connectStreamMock).toHaveBeenCalledTimes(1);

    rerender(<Harness sessionId="session-1" canOpenStream isExecuting={false} onTerminal={() => {}} onRefreshRequired={() => {}} />);

    expect(connectStreamMock).toHaveBeenCalledTimes(1);
    expect(close).not.toHaveBeenCalled();

    unmount();
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('builds stream endpoints from the runtime backend base URL', () => {
    connectStreamMock.mockReturnValue({ close: vi.fn() });

    render(<Harness sessionId="session-1" canOpenStream isExecuting />);

    expect(connectStreamMock).toHaveBeenCalledWith(
      expect.objectContaining({
        streamPath: 'https://backend.test/api/v1/sessions/session-1/stream',
        websocketPath: 'https://backend.test/api/v1/sessions/session-1/ws',
      }),
    );
  });

  it('opens a persistent session live-tail stream when the session is idle', () => {
    connectStreamMock.mockReturnValue({ close: vi.fn() });

    render(<Harness sessionId="session-1" canOpenStream />);

    expect(connectStreamMock).toHaveBeenCalledWith(
      expect.objectContaining({
        lastSeenSequence: undefined,
        requestId: null,
        runId: null,
      }),
    );
  });

  it('uses activeRun filters with a zero cursor for new-device bootstrap', () => {
    connectStreamMock.mockReturnValue({ close: vi.fn() });

    render(<Harness sessionId="session-1" canOpenStream activeRun={{ requestId: 'req-active', runId: 'run-active', status: 'EXECUTING' }} />);

    expect(connectStreamMock).toHaveBeenCalledWith(
      expect.objectContaining({
        lastSeenSequence: 0,
        requestId: 'req-active',
        runId: 'run-active',
      }),
    );
  });

  it('uses accepted run filters with a zero cursor when no live-tail boundary exists', () => {
    connectStreamMock.mockReturnValue({ close: vi.fn() });

    render(<Harness sessionId="session-1" canOpenStream acceptedRun={{ requestId: 'req-accepted', runId: 'run-accepted', status: 'EXECUTING' }} />);

    expect(connectStreamMock).toHaveBeenCalledWith(
      expect.objectContaining({
        lastSeenSequence: 0,
        requestId: 'req-accepted',
        runId: 'run-accepted',
      }),
    );
  });

  it('returns from accepted-run replay to a session stream after terminal without showing reconnecting', async () => {
    const setConnectionState = vi.fn();
    const close = vi.fn();
    const connectionParams: Array<{
      onEnvelope: (payload: unknown) => void;
    }> = [];
    connectStreamMock.mockImplementation((incoming) => {
      connectionParams.push(incoming as { onEnvelope: (payload: unknown) => void });
      return { close };
    });

    render(
      <Harness
        sessionId="session-1"
        canOpenStream
        acceptedRun={{ requestId: 'req-accepted', runId: 'run-accepted', status: 'EXECUTING' }}
        setConnectionState={setConnectionState}
      />,
    );

    expect(connectStreamMock).toHaveBeenCalledWith(
      expect.objectContaining({
        lastSeenSequence: 0,
        requestId: 'req-accepted',
        runId: 'run-accepted',
      }),
    );

    await act(async () => {
      connectionParams[0]?.onEnvelope(
        makeLiveEnvelope(7, {
          eventId: 'evt-terminal-accepted',
          requestId: 'req-accepted',
          runId: 'run-accepted',
          sequence: 7,
          eventType: 'REQUEST_COMPLETED',
          payload: {},
        }),
      );
      await Promise.resolve();
    });

    expect(close).toHaveBeenCalledTimes(1);
    expect(probeAuthChallengeMock).not.toHaveBeenCalled();
    expect(setConnectionState).not.toHaveBeenCalledWith('session-1', expect.objectContaining({ phase: 'reconnecting' }));
    expect(connectStreamMock).toHaveBeenCalledTimes(2);
    expect(connectStreamMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        lastSeenSequence: 7,
        requestId: null,
        runId: null,
      }),
    );
  });

  it('starts accepted-run recovery when the live-tail transport opened before the run was accepted', async () => {
    let params: { onOpen: () => void } | undefined;
    connectStreamMock.mockImplementation((incoming) => {
      params = incoming as { onOpen: () => void };
      return { close: vi.fn() };
    });

    const { rerender } = render(<Harness sessionId="session-1" canOpenStream />);

    act(() => {
      params?.onOpen();
    });

    rerender(<Harness sessionId="session-1" canOpenStream acceptedRun={{ requestId: 'req-accepted', runId: 'run-accepted', status: 'EXECUTING' }} />);

    await waitFor(() => {
      expect(connectStreamMock).toHaveBeenCalledTimes(2);
    });
    expect(connectStreamMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        lastSeenSequence: 0,
        requestId: 'req-accepted',
        runId: 'run-accepted',
      }),
    );
  });

  it('uses one accepted-run replay when active and accepted identities match after live-tail opens', async () => {
    let params: { onOpen: () => void } | undefined;
    connectStreamMock.mockImplementation((incoming) => {
      params = incoming as { onOpen: () => void };
      return { close: vi.fn() };
    });

    const acceptedRun = { requestId: 'req-accepted', runId: 'run-accepted', status: 'EXECUTING' as const };
    const { rerender } = render(<Harness sessionId="session-1" canOpenStream />);

    act(() => {
      params?.onOpen();
    });

    rerender(<Harness sessionId="session-1" canOpenStream activeRun={acceptedRun} acceptedRun={acceptedRun} />);

    await waitFor(() => {
      expect(connectStreamMock).toHaveBeenCalledTimes(2);
    });
    expect(connectStreamMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        lastSeenSequence: 0,
        requestId: 'req-accepted',
        runId: 'run-accepted',
      }),
    );
  });

  it('starts accepted-run recovery immediately when the session stream is reconnecting without a cursor', async () => {
    vi.useFakeTimers();
    const close = vi.fn();
    const connectionParams: Array<{ onError: (error: Error) => void }> = [];
    connectStreamMock.mockImplementation((incoming) => {
      connectionParams.push(incoming as { onError: (error: Error) => void });
      return { close };
    });

    const { rerender } = render(<Harness sessionId="session-1" canOpenStream />);

    act(() => {
      connectionParams[0]?.onError(new Error('network dropped'));
    });

    await act(async () => {
      rerender(
        <Harness sessionId="session-1" canOpenStream acceptedRun={{ requestId: 'req-accepted', runId: 'run-accepted', status: 'EXECUTING' }} />,
      );
      await Promise.resolve();
    });

    expect(connectStreamMock).toHaveBeenCalledTimes(2);
    expect(close).toHaveBeenCalledTimes(1);
    expect(connectStreamMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        lastSeenSequence: 0,
        requestId: 'req-accepted',
        runId: 'run-accepted',
      }),
    );
  });

  it('ignores a legacy persisted stream cursor when activeRun bootstrap is available', () => {
    sessionStorage.setItem('chat-stream-cursor:session-1', '18');
    connectStreamMock.mockReturnValue({ close: vi.fn() });

    render(<Harness sessionId="session-1" canOpenStream activeRun={{ requestId: 'req-active', runId: 'run-active', status: 'EXECUTING' }} />);

    expect(connectStreamMock).toHaveBeenCalledWith(
      expect.objectContaining({
        lastSeenSequence: 0,
        requestId: 'req-active',
        runId: 'run-active',
      }),
    );
  });

  it('keeps activeRun as bootstrap only until a timeline cursor is observed in memory', async () => {
    vi.useFakeTimers();
    const connectionParams: Array<{
      onEnvelope: (payload: unknown) => void;
      onError: (error: Error) => void;
    }> = [];
    connectStreamMock.mockImplementation((incoming) => {
      connectionParams.push(incoming as { onEnvelope: (payload: unknown) => void; onError: (error: Error) => void });
      return { close: vi.fn() };
    });

    render(<Harness sessionId="session-1" canOpenStream activeRun={{ requestId: 'req-active', runId: 'run-active', status: 'EXECUTING' }} />);

    expect(connectStreamMock).toHaveBeenCalledWith(
      expect.objectContaining({
        lastSeenSequence: 0,
        requestId: 'req-active',
        runId: 'run-active',
      }),
    );

    act(() => {
      connectionParams[0]?.onEnvelope(
        makeLiveEnvelope(18, {
          requestId: 'req-active',
          runId: 'run-active',
        }),
      );
      connectionParams[0]?.onError(new Error('network dropped'));
    });

    await act(async () => {
      vi.advanceTimersByTime(500);
    });

    expect(connectStreamMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        lastSeenSequence: 18,
        requestId: null,
        runId: null,
      }),
    );
  });

  it('does not let an unrelated accepted cursor suppress exact activeRun bootstrap', async () => {
    const connectionParams: Array<{ onEnvelope: (payload: unknown) => void }> = [];
    connectStreamMock.mockImplementation((incoming) => {
      connectionParams.push(incoming as { onEnvelope: (payload: unknown) => void });
      return { close: vi.fn() };
    });

    const { rerender } = render(<Harness sessionId="session-1" canOpenStream appendEnvelope={() => {}} />);

    act(() => {
      connectionParams[0]?.onEnvelope(
        makeLiveEnvelope(18, {
          requestId: 'request-unrelated',
          runId: 'run-unrelated',
        }),
      );
    });

    rerender(
      <Harness
        sessionId="session-1"
        canOpenStream
        activeRun={{ requestId: 'request-target', runId: 'run-target', status: 'EXECUTING' }}
        appendEnvelope={() => {}}
      />,
    );

    await waitFor(() => {
      expect(connectStreamMock).toHaveBeenCalledTimes(2);
    });
    expect(connectStreamMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        lastSeenSequence: 0,
        requestId: 'request-target',
        runId: 'run-target',
      }),
    );
  });

  it('does not advance the resume cursor when the owning store rejects an envelope', async () => {
    vi.useFakeTimers();
    const connectionParams: Array<{
      onEnvelope: (payload: unknown) => void;
      onError: (error: Error) => void;
    }> = [];
    connectStreamMock.mockImplementation((incoming) => {
      connectionParams.push(
        incoming as {
          onEnvelope: (payload: unknown) => void;
          onError: (error: Error) => void;
        },
      );
      return { close: vi.fn() };
    });

    render(
      <Harness
        sessionId="session-1"
        canOpenStream
        appendEnvelope={(_, envelope) => ({
          acceptedEnvelopes: [],
          rejectedEnvelopes: [envelope],
          highestAcceptedSequence: null,
          acceptedRunKeys: [],
        })}
      />,
    );

    act(() => {
      connectionParams[0]?.onEnvelope(
        makeLiveEnvelope(18, {
          requestId: 'request-rejected',
          runId: 'run-rejected',
        }),
      );
      connectionParams[0]?.onError(new Error('network dropped'));
    });
    await act(async () => {
      vi.advanceTimersByTime(500);
    });

    expect(connectStreamMock).toHaveBeenCalledTimes(2);
    expect(connectStreamMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        lastSeenSequence: undefined,
        requestId: null,
        runId: null,
      }),
    );
  });

  it('uses the backend-projected WebSocket transport without a cursor when no in-memory cursor exists', () => {
    runtimeConfigMock.transportKind = 'WEBSOCKET';
    sessionStorage.setItem('chat-stream-cursor:session-1', '17');
    connectStreamMock.mockReturnValue({ close: vi.fn() });

    render(<Harness sessionId="session-1" canOpenStream />);

    expect(connectStreamMock).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'WEBSOCKET',
        lastSeenSequence: undefined,
        requestId: null,
        runId: null,
      }),
    );
  });

  it('opens a session stream from the beginning and does not reconnect when the session starts executing', () => {
    const close = vi.fn();
    connectStreamMock.mockReturnValue({ close });

    const { rerender } = render(<Harness sessionId="session-1" canOpenStream />);

    expect(connectStreamMock).toHaveBeenCalledTimes(1);

    rerender(<Harness sessionId="session-1" canOpenStream isExecuting />);

    expect(connectStreamMock).toHaveBeenCalledTimes(1);
    expect(close).not.toHaveBeenCalled();
  });

  it('closes the session stream when the session can no longer open streams', () => {
    const close = vi.fn();
    connectStreamMock.mockReturnValue({ close });

    const { rerender } = render(<Harness sessionId="session-1" canOpenStream />);

    expect(connectStreamMock).toHaveBeenCalledTimes(1);

    rerender(<Harness sessionId="session-1" canOpenStream={false} />);

    expect(close).toHaveBeenCalledTimes(1);
  });

  it('ignores a persisted session-scoped cursor after refresh without activeRun', () => {
    sessionStorage.setItem('chat-stream-cursor:session-1', '8');
    connectStreamMock.mockReturnValue({ close: vi.fn() });

    render(<Harness sessionId="session-1" canOpenStream />);

    expect(connectStreamMock).toHaveBeenCalledWith(
      expect.objectContaining({
        lastSeenSequence: undefined,
        requestId: null,
        runId: null,
      }),
    );
  });

  it('ignores a legacy sessionStorage live cursor when opening a new active stream', () => {
    sessionStorage.setItem('chat-last-live-sequence:session-1', '23');
    connectStreamMock.mockReturnValue({ close: vi.fn() });

    render(<Harness sessionId="session-1" canOpenStream isExecuting />);

    expect(connectStreamMock).toHaveBeenCalledWith(
      expect.objectContaining({
        lastSeenSequence: undefined,
      }),
    );
  });

  it('opens live-tail when a request is executing but its backend identity is not known yet', () => {
    connectStreamMock.mockReturnValue({ close: vi.fn() });

    render(<Harness sessionId="session-1" canOpenStream isExecuting />);

    expect(connectStreamMock).toHaveBeenCalledWith(
      expect.objectContaining({
        lastSeenSequence: undefined,
      }),
    );
  });

  it('does not recreate the session stream on an ordinary rerender', () => {
    const close = vi.fn();
    connectStreamMock.mockReturnValue({ close });

    const { rerender } = render(<Harness sessionId="session-1" canOpenStream />);

    rerender(<Harness sessionId="session-1" canOpenStream />);

    expect(connectStreamMock).toHaveBeenCalledTimes(1);
    expect(close).not.toHaveBeenCalled();
  });

  it('does not close the session connection when a terminal event is received', () => {
    let params:
      | {
          onEnvelope: (payload: unknown) => void;
        }
      | undefined;
    const close = vi.fn();
    const onTerminal = vi.fn();
    connectStreamMock.mockImplementation((incoming) => {
      params = incoming as { onEnvelope: (payload: unknown) => void };
      return { close };
    });

    render(<Harness sessionId="session-1" canOpenStream isExecuting onTerminal={onTerminal} />);

    params?.onEnvelope({
      eventId: 'evt-terminal',
      sessionId: 'session-1',
      requestId: 'run-1',
      sequence: 3,
      eventType: 'REQUEST_COMPLETED',
      timelineEventRef: null,
      transportHints: [],
      payload: {},
      createdAt: '2026-04-16T07:56:49.300Z',
    } satisfies StreamEnvelope);

    expect(onTerminal).toHaveBeenCalledTimes(1);
    expect(close).not.toHaveBeenCalled();
  });

  it('routes accepted events to the canonical identity callback', () => {
    let params:
      | {
          onEnvelope: (payload: unknown) => void;
        }
      | undefined;
    const appendEnvelope = vi.fn();
    const onRequestAccepted = vi.fn();
    connectStreamMock.mockImplementation((incoming) => {
      params = incoming as { onEnvelope: (payload: unknown) => void };
      return { close: vi.fn() };
    });

    render(<Harness sessionId="session-1" canOpenStream isExecuting appendEnvelope={appendEnvelope} onRequestAccepted={onRequestAccepted} />);

    params?.onEnvelope({
      eventId: 'evt-accepted',
      sessionId: 'session-1',
      requestId: 'run-1',
      sequence: 1,
      eventType: 'REQUEST_ACCEPTED',
      timelineEventRef: null,
      transportHints: [],
      payload: {},
      createdAt: new Date().toISOString(),
    } satisfies StreamEnvelope);

    expect(appendEnvelope).toHaveBeenCalledTimes(1);
    expect(onRequestAccepted).toHaveBeenCalledTimes(1);
    expect(onRequestAccepted.mock.calls[0]?.[0].requestId).toBe('run-1');
  });

  it('allows live envelopes to be reconciled before appending them', () => {
    let params:
      | {
          onEnvelope: (payload: unknown) => void;
        }
      | undefined;
    const calls: string[] = [];
    connectStreamMock.mockImplementation((incoming) => {
      params = incoming as { onEnvelope: (payload: unknown) => void };
      return { close: vi.fn() };
    });

    render(
      <Harness
        sessionId="session-1"
        canOpenStream
        isExecuting
        onLiveEnvelope={() => calls.push('reconcile')}
        appendEnvelope={() => calls.push('append')}
      />,
    );

    act(() => {
      params?.onEnvelope({
        eventId: 'evt-thinking',
        sessionId: 'session-1',
        requestId: 'run-1',
        sequence: 2,
        eventType: 'LLM_THINKING_DELTA',
        timelineEventRef: null,
        transportHints: ['SSE'],
        payload: { delta: 'working', contentType: 'PLAIN_TEXT' },
        createdAt: '2026-04-18T08:00:01.000Z',
      } satisfies StreamEnvelope);
    });

    expect(calls).toEqual(['reconcile', 'append']);
  });

  it('shows the first live token immediately and coalesces later tokens until the next frame', () => {
    let params:
      | {
          onEnvelope: (payload: unknown) => void;
        }
      | undefined;
    const frameCallbacks: FrameRequestCallback[] = [];
    vi.stubGlobal(
      'requestAnimationFrame',
      vi.fn((callback: FrameRequestCallback) => {
        frameCallbacks.push(callback);
        return frameCallbacks.length;
      }),
    );
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    const appendEnvelope = vi.fn();
    const appendEnvelopes = vi.fn();
    connectStreamMock.mockImplementation((incoming) => {
      params = incoming as { onEnvelope: (payload: unknown) => void };
      return { close: vi.fn() };
    });

    render(<Harness sessionId="session-1" canOpenStream isExecuting appendEnvelope={appendEnvelope} appendEnvelopes={appendEnvelopes} />);

    act(() => {
      params?.onEnvelope(makeLiveEnvelope(1));
    });
    expect(appendEnvelope).not.toHaveBeenCalled();
    expect(appendEnvelopes).toHaveBeenCalledTimes(1);
    expect(appendEnvelopes.mock.calls[0]?.[1].map((envelope: StreamEnvelope) => envelope.sequence)).toEqual([1]);

    act(() => {
      params?.onEnvelope(makeLiveEnvelope(2));
      params?.onEnvelope(makeLiveEnvelope(3));
    });
    expect(appendEnvelopes).toHaveBeenCalledTimes(1);

    act(() => {
      frameCallbacks.shift()?.(16);
    });

    expect(appendEnvelopes).toHaveBeenCalledTimes(2);
    expect(appendEnvelopes.mock.calls[1]?.[1].map((envelope: StreamEnvelope) => envelope.sequence)).toEqual([2, 3]);
  });

  it('flushes pending token batches before terminal events and callbacks', () => {
    let params:
      | {
          onEnvelope: (payload: unknown) => void;
        }
      | undefined;
    const frameCallbacks: FrameRequestCallback[] = [];
    vi.stubGlobal(
      'requestAnimationFrame',
      vi.fn((callback: FrameRequestCallback) => {
        frameCallbacks.push(callback);
        return frameCallbacks.length;
      }),
    );
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    const calls: string[] = [];
    connectStreamMock.mockImplementation((incoming) => {
      params = incoming as { onEnvelope: (payload: unknown) => void };
      return { close: vi.fn() };
    });

    render(
      <Harness
        sessionId="session-1"
        canOpenStream
        isExecuting
        appendEnvelopes={(_, envelopes) => {
          calls.push(`append:${envelopes.map((envelope) => envelope.eventType).join(',')}`);
        }}
        onTerminal={() => calls.push('terminal')}
      />,
    );

    act(() => {
      params?.onEnvelope(makeLiveEnvelope(1));
      params?.onEnvelope(makeLiveEnvelope(2));
      params?.onEnvelope(
        makeLiveEnvelope(3, {
          eventId: 'evt-completed',
          sequence: 3,
          eventType: 'REQUEST_COMPLETED',
          payload: {},
        }),
      );
    });

    expect(calls).toEqual(['append:LLM_CONTENT_DELTA', 'append:LLM_CONTENT_DELTA', 'append:REQUEST_COMPLETED', 'terminal']);

    act(() => {
      frameCallbacks.shift()?.(16);
    });
    expect(calls).toEqual(['append:LLM_CONTENT_DELTA', 'append:LLM_CONTENT_DELTA', 'append:REQUEST_COMPLETED', 'terminal']);
  });

  it('ignores stream envelopes that belong to a different session', () => {
    let params:
      | {
          onEnvelope: (payload: unknown) => void;
        }
      | undefined;
    const appendEnvelope = vi.fn();
    const onLiveEnvelope = vi.fn();
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    connectStreamMock.mockImplementation((incoming) => {
      params = incoming as { onEnvelope: (payload: unknown) => void };
      return { close: vi.fn() };
    });

    render(<Harness sessionId="session-1" canOpenStream isExecuting appendEnvelope={appendEnvelope} onLiveEnvelope={onLiveEnvelope} />);

    act(() => {
      params?.onEnvelope({
        eventId: 'evt-other-session',
        sessionId: 'session-2',
        requestId: 'run-1',
        sequence: 2,
        eventType: 'LLM_THINKING_DELTA',
        timelineEventRef: null,
        transportHints: ['SSE'],
        payload: { delta: 'working', contentType: 'PLAIN_TEXT' },
        createdAt: '2026-04-18T08:00:01.000Z',
      } satisfies StreamEnvelope);
    });

    expect(onLiveEnvelope).not.toHaveBeenCalled();
    expect(appendEnvelope).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith(
      '[Stream] Ignored envelope for a different session',
      expect.objectContaining({
        currentSessionId: 'session-1',
        envelopeSessionId: 'session-2',
        eventId: 'evt-other-session',
      }),
    );
    warnSpy.mockRestore();
  });

  it('does not recreate the session connection when the live cursor advances', async () => {
    let params:
      | {
          onEnvelope: (payload: unknown) => void;
        }
      | undefined;
    const close = vi.fn();
    connectStreamMock.mockImplementation((incoming) => {
      params = incoming as { onEnvelope: (payload: unknown) => void };
      return { close };
    });

    render(<Harness sessionId="session-1" canOpenStream isExecuting />);

    expect(connectStreamMock).toHaveBeenCalledTimes(1);

    act(() => {
      params?.onEnvelope({
        eventId: 'live-11',
        sessionId: 'session-1',
        requestId: 'req-1',
        sequence: 11,
        eventType: 'LLM_CONTENT_DELTA',
        timelineEventRef: null,
        transportHints: ['SSE'],
        payload: { text: 'live answer', contentType: 'PLAIN_TEXT', metadata: { accumulated: true }, role: 'ASSISTANT' },
        createdAt: '2026-04-18T08:00:01.000Z',
      } satisfies StreamEnvelope);
    });

    await waitFor(() => {
      expect(connectStreamMock).toHaveBeenCalledTimes(1);
    });
    expect(close).not.toHaveBeenCalled();
  });

  it('reconnects with the latest received sequence after an SSE disconnect', async () => {
    vi.useFakeTimers();
    const connectionParams: Array<{
      onEnvelope: (payload: unknown) => void;
      onError: (error: Error) => void;
    }> = [];
    connectStreamMock.mockImplementation((incoming) => {
      connectionParams.push(incoming as { onEnvelope: (payload: unknown) => void; onError: (error: Error) => void });
      return { close: vi.fn() };
    });

    render(<Harness sessionId="session-1" canOpenStream isExecuting />);

    act(() => {
      connectionParams[0]?.onEnvelope(makeLiveEnvelope(12, { requestId: 'req-1' }));
      connectionParams[0]?.onError(new Error('network dropped'));
    });

    await act(async () => {
      vi.advanceTimersByTime(500);
    });

    expect(connectStreamMock).toHaveBeenCalledTimes(2);
    expect(connectStreamMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        lastSeenSequence: 12,
      }),
    );
    expect(probeAuthChallengeMock).toHaveBeenCalledTimes(1);
  });

  it('keeps the reconnecting notice until the internal reconnect opens', async () => {
    vi.useFakeTimers();
    const setConnectionState = vi.fn();
    const connectionParams: Array<{
      onError: (error: Error) => void;
      onOpen: () => void;
    }> = [];
    connectStreamMock.mockImplementation((incoming) => {
      connectionParams.push(incoming as { onError: (error: Error) => void; onOpen: () => void });
      return { close: vi.fn() };
    });

    render(<Harness sessionId="session-1" canOpenStream isExecuting setConnectionState={setConnectionState} />);

    act(() => {
      connectionParams[0]?.onError(new Error('network dropped'));
    });

    expect(setConnectionState).toHaveBeenLastCalledWith('session-1', expect.objectContaining({ phase: 'reconnecting' }));

    await act(async () => {
      vi.advanceTimersByTime(500);
    });

    expect(connectStreamMock).toHaveBeenCalledTimes(2);
    expect(setConnectionState).not.toHaveBeenCalledWith('session-1', { phase: 'idle', message: null });
    expect(setConnectionState).toHaveBeenLastCalledWith('session-1', expect.objectContaining({ phase: 'reconnecting' }));

    act(() => {
      connectionParams[1]?.onOpen();
    });

    expect(setConnectionState).toHaveBeenLastCalledWith('session-1', { phase: 'connected', message: null });
  });

  it('continues background reconnects after the fast retry budget is exhausted', async () => {
    vi.useFakeTimers();
    const setConnectionState = vi.fn();
    const connectionParams: Array<{
      onError: (error: Error) => void;
      onOpen: () => void;
    }> = [];
    connectStreamMock.mockImplementation((incoming) => {
      connectionParams.push(incoming as { onError: (error: Error) => void; onOpen: () => void });
      return { close: vi.fn() };
    });

    render(<Harness sessionId="session-1" canOpenStream isExecuting setConnectionState={setConnectionState} />);

    act(() => {
      connectionParams[0]?.onError(new Error('network dropped 1'));
    });
    await act(async () => {
      vi.advanceTimersByTime(500);
    });
    act(() => {
      connectionParams[1]?.onError(new Error('network dropped 2'));
    });
    await act(async () => {
      vi.advanceTimersByTime(1_000);
    });
    act(() => {
      connectionParams[2]?.onError(new Error('network dropped 3'));
    });
    await act(async () => {
      vi.advanceTimersByTime(2_000);
    });
    act(() => {
      connectionParams[3]?.onError(new Error('network dropped 4'));
    });

    expect(setConnectionState).toHaveBeenLastCalledWith('session-1', expect.objectContaining({ phase: 'disconnected' }));

    await act(async () => {
      vi.advanceTimersByTime(4_999);
    });
    expect(connectStreamMock).toHaveBeenCalledTimes(4);

    await act(async () => {
      vi.advanceTimersByTime(1);
    });
    expect(connectStreamMock).toHaveBeenCalledTimes(5);
    expect(setConnectionState).toHaveBeenLastCalledWith('session-1', expect.objectContaining({ phase: 'disconnected' }));

    act(() => {
      connectionParams[4]?.onOpen();
    });

    expect(setConnectionState).toHaveBeenLastCalledWith('session-1', { phase: 'connected', message: null });
  });

  it('probes auth only once for repeated callbacks from the same broken stream', async () => {
    vi.useFakeTimers();
    const connectionParams: Array<{
      onError: (error: Error) => void;
      onClose: () => void;
    }> = [];
    connectStreamMock.mockImplementation((incoming) => {
      connectionParams.push(incoming as { onError: (error: Error) => void; onClose: () => void });
      return { close: vi.fn() };
    });

    render(<Harness sessionId="session-1" canOpenStream isExecuting />);

    act(() => {
      connectionParams[0]?.onError(new Error('network dropped'));
      connectionParams[0]?.onClose();
      connectionParams[0]?.onError(new Error('still dropped'));
    });

    expect(probeAuthChallengeMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      vi.advanceTimersByTime(500);
    });
  });

  it('does not turn a non-refresh resume failure into a generic reconnect', async () => {
    vi.useFakeTimers();
    const setConnectionState = vi.fn();
    const close = vi.fn();
    let params:
      | {
          onError: (error: Error) => void;
          onClose: () => void;
        }
      | undefined;
    connectStreamMock.mockImplementation((incoming) => {
      params = incoming as { onError: (error: Error) => void; onClose: () => void };
      return { close };
    });

    render(<Harness sessionId="session-1" canOpenStream isExecuting setConnectionState={setConnectionState} />);

    const error = Object.assign(new Error('resume failed'), {
      details: {
        kind: 'STREAM_RESUME_FAILURE',
        reason: 'VALIDATION_FAILED',
        retryable: false,
        refreshConversation: false,
        resumeAfterSequence: null,
      },
    });

    act(() => {
      params?.onError(error);
      params?.onClose();
    });

    expect(close).toHaveBeenCalledTimes(1);
    expect(setConnectionState).toHaveBeenLastCalledWith('session-1', expect.objectContaining({ phase: 'disconnected' }));
    expect(probeAuthChallengeMock).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(500);
    });

    expect(connectStreamMock).toHaveBeenCalledTimes(1);
  });

  it('reconnects a persistent session stream even when the server closes after a terminal event', async () => {
    vi.useFakeTimers();
    const connectionParams: Array<{
      onEnvelope: (payload: unknown) => void;
      onClose: () => void;
    }> = [];
    connectStreamMock.mockImplementation((incoming) => {
      connectionParams.push(incoming as { onEnvelope: (payload: unknown) => void; onClose: () => void });
      return { close: vi.fn() };
    });

    render(<Harness sessionId="session-1" canOpenStream isExecuting />);

    act(() => {
      connectionParams[0]?.onEnvelope(makeLiveEnvelope(12, { requestId: 'req-1' }));
      connectionParams[0]?.onEnvelope(
        makeLiveEnvelope(13, {
          eventId: 'evt-terminal',
          requestId: 'req-1',
          sequence: 13,
          eventType: 'REQUEST_COMPLETED',
          payload: {},
        }),
      );
      connectionParams[0]?.onClose();
    });

    await act(async () => {
      vi.advanceTimersByTime(500);
    });

    expect(connectStreamMock).toHaveBeenCalledTimes(2);
    expect(connectStreamMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        lastSeenSequence: 13,
        requestId: null,
        runId: null,
      }),
    );
  });

  it('reconnects with the latest sequence after a named SSE event is handled', async () => {
    vi.useFakeTimers();
    const connectionParams: Array<{
      onEnvelope: (payload: unknown) => void;
      onError: (error: Error) => void;
    }> = [];
    connectStreamMock.mockImplementation((incoming) => {
      connectionParams.push(incoming as { onEnvelope: (payload: unknown) => void; onError: (error: Error) => void });
      return { close: vi.fn() };
    });

    render(<Harness sessionId="session-1" canOpenStream isExecuting />);

    act(() => {
      connectionParams[0]?.onEnvelope(makeLiveEnvelope(21, { requestId: 'req-1' }));
      connectionParams[0]?.onError(new Error('network dropped'));
    });

    await act(async () => {
      vi.advanceTimersByTime(500);
    });

    expect(connectStreamMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        lastSeenSequence: 21,
      }),
    );
  });

  it('marks the session as resyncing when a degradation notice requests refresh', () => {
    let params:
      | {
          onEnvelope: (payload: unknown) => void;
        }
      | undefined;
    const setConnectionState = vi.fn();
    const onRefreshRequired = vi.fn();
    connectStreamMock.mockImplementation((incoming) => {
      params = incoming as { onEnvelope: (payload: unknown) => void };
      return { close: vi.fn() };
    });

    render(<Harness sessionId="session-1" canOpenStream isExecuting setConnectionState={setConnectionState} onRefreshRequired={onRefreshRequired} />);

    params?.onEnvelope({
      eventId: 'evt-degrade',
      sessionId: 'session-1',
      requestId: 'run-1',
      sequence: 3,
      eventType: 'DEGRADATION_NOTICE',
      timelineEventRef: null,
      transportHints: [],
      payload: { refreshConversation: true },
      createdAt: '2026-04-18T08:00:00.000Z',
    } satisfies StreamEnvelope);

    expect(setConnectionState).toHaveBeenCalledWith('session-1', {
      phase: 'resyncing',
      message: '连接已恢复，正在同步最新内容…',
    });
    expect(onRefreshRequired).toHaveBeenCalledTimes(1);
  });

  it('does not advance the in-memory cursor for a non-timeline degradation notice', async () => {
    vi.useFakeTimers();
    const connectionParams: Array<{
      onEnvelope: (payload: unknown) => void;
      onError: (error: Error) => void;
    }> = [];
    connectStreamMock.mockImplementation((incoming) => {
      connectionParams.push(incoming as { onEnvelope: (payload: unknown) => void; onError: (error: Error) => void });
      return { close: vi.fn() };
    });

    render(<Harness sessionId="session-1" canOpenStream isExecuting />);

    act(() => {
      connectionParams[0]?.onEnvelope(makeLiveEnvelope(7, { requestId: 'run-1' }));
      connectionParams[0]?.onEnvelope({
        eventId: 'evt-degrade',
        sessionId: 'session-1',
        requestId: 'run-1',
        sequence: 99,
        eventType: 'DEGRADATION_NOTICE',
        timelineEventRef: 'timeline-live-11',
        transportHints: [],
        payload: { refreshConversation: true },
        createdAt: '2026-04-18T08:00:00.000Z',
      } satisfies StreamEnvelope);
      connectionParams[0]?.onError(new Error('network dropped'));
    });

    await act(async () => {
      vi.advanceTimersByTime(500);
    });

    expect(connectStreamMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        lastSeenSequence: 7,
      }),
    );
  });

  it('uses resumeAfterSequence only after the same-session conversation refresh succeeds', async () => {
    let params:
      | {
          onEnvelope: (payload: unknown) => void;
        }
      | undefined;
    const close = vi.fn();
    const onRefreshRequired = vi.fn().mockResolvedValue(true);
    connectStreamMock.mockImplementation((incoming) => {
      params = incoming as { onEnvelope: (payload: unknown) => void };
      return { close };
    });

    render(<Harness sessionId="session-1" canOpenStream isExecuting onRefreshRequired={onRefreshRequired} />);

    act(() => {
      params?.onEnvelope({
        eventId: 'evt-gap',
        sessionId: 'session-1',
        requestId: 'run-1',
        sequence: 99,
        eventType: 'DEGRADATION_NOTICE',
        timelineEventRef: null,
        transportHints: [],
        payload: {
          kind: 'STREAM_RESUME_GAP',
          reason: 'TIMELINE_CONTINUITY_LOST',
          retryable: true,
          refreshConversation: true,
          resumeAfterSequence: 42,
        },
        createdAt: '2026-04-18T08:00:00.000Z',
      } satisfies StreamEnvelope);
    });

    expect(onRefreshRequired).toHaveBeenCalledWith({
      kind: 'STREAM_RESUME_GAP',
      reason: 'TIMELINE_CONTINUITY_LOST',
      retryable: true,
      refreshConversation: true,
      resumeAfterSequence: 42,
    });

    await waitFor(() => {
      expect(connectStreamMock).toHaveBeenCalledTimes(2);
    });
    expect(connectStreamMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        lastSeenSequence: 42,
      }),
    );
  });

  it('keeps the resyncing notice until the post-refresh reconnect opens', async () => {
    const setConnectionState = vi.fn();
    const connectionParams: Array<{
      onEnvelope: (payload: unknown) => void;
      onOpen: () => void;
    }> = [];
    const onRefreshRequired = vi.fn().mockResolvedValue(true);
    connectStreamMock.mockImplementation((incoming) => {
      connectionParams.push(incoming as { onEnvelope: (payload: unknown) => void; onOpen: () => void });
      return { close: vi.fn() };
    });

    render(<Harness sessionId="session-1" canOpenStream isExecuting onRefreshRequired={onRefreshRequired} setConnectionState={setConnectionState} />);

    act(() => {
      connectionParams[0]?.onEnvelope({
        eventId: 'evt-gap',
        sessionId: 'session-1',
        requestId: 'run-1',
        sequence: 99,
        eventType: 'DEGRADATION_NOTICE',
        timelineEventRef: null,
        transportHints: [],
        payload: {
          kind: 'STREAM_RESUME_GAP',
          reason: 'TIMELINE_CONTINUITY_LOST',
          retryable: true,
          refreshConversation: true,
          resumeAfterSequence: 42,
        },
        createdAt: '2026-04-18T08:00:00.000Z',
      } satisfies StreamEnvelope);
    });

    expect(setConnectionState).toHaveBeenLastCalledWith('session-1', expect.objectContaining({ phase: 'resyncing' }));

    await waitFor(() => {
      expect(connectStreamMock).toHaveBeenCalledTimes(2);
    });

    expect(setConnectionState).not.toHaveBeenCalledWith('session-1', { phase: 'idle', message: null });
    expect(setConnectionState).toHaveBeenLastCalledWith('session-1', expect.objectContaining({ phase: 'resyncing' }));

    act(() => {
      connectionParams[1]?.onOpen();
    });

    expect(setConnectionState).toHaveBeenLastCalledWith('session-1', { phase: 'connected', message: null });
  });

  it('keeps the previous cursor when gap refresh fails', async () => {
    let params:
      | {
          onEnvelope: (payload: unknown) => void;
        }
      | undefined;
    const onRefreshRequired = vi.fn().mockResolvedValue(false);
    connectStreamMock.mockImplementation((incoming) => {
      params = incoming as { onEnvelope: (payload: unknown) => void };
      return { close: vi.fn() };
    });

    render(<Harness sessionId="session-1" canOpenStream isExecuting onRefreshRequired={onRefreshRequired} />);

    act(() => {
      params?.onEnvelope({
        eventId: 'evt-gap',
        sessionId: 'session-1',
        requestId: 'run-1',
        sequence: 99,
        eventType: 'DEGRADATION_NOTICE',
        timelineEventRef: null,
        transportHints: [],
        payload: {
          kind: 'STREAM_RESUME_GAP',
          reason: 'TIMELINE_CONTINUITY_LOST',
          retryable: true,
          refreshConversation: true,
          resumeAfterSequence: 42,
        },
        createdAt: '2026-04-18T08:00:00.000Z',
      } satisfies StreamEnvelope);
    });

    await waitFor(() => {
      expect(onRefreshRequired).toHaveBeenCalledTimes(1);
    });
    expect(connectStreamMock).toHaveBeenCalledTimes(1);
  });

  it('recovers from a SEQUENCE_GAP notice emitted by the backend streamResumeGapError', async () => {
    let params:
      | {
          onEnvelope: (payload: unknown) => void;
        }
      | undefined;
    const close = vi.fn();
    const onRefreshRequired = vi.fn().mockResolvedValue(true);
    connectStreamMock.mockImplementation((incoming) => {
      params = incoming as { onEnvelope: (payload: unknown) => void };
      return { close };
    });

    render(<Harness sessionId="session-1" canOpenStream isExecuting onRefreshRequired={onRefreshRequired} />);

    act(() => {
      params?.onEnvelope({
        eventId: 'evt-gap',
        sessionId: 'session-1',
        requestId: 'run-1',
        sequence: 99,
        eventType: 'DEGRADATION_NOTICE',
        timelineEventRef: null,
        transportHints: [],
        payload: {
          kind: 'STREAM_RESUME_GAP',
          reason: 'SEQUENCE_GAP',
          retryable: true,
          refreshConversation: true,
          resumeAfterSequence: 42,
        },
        createdAt: '2026-04-18T08:00:00.000Z',
      } satisfies StreamEnvelope);
    });

    expect(onRefreshRequired).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'STREAM_RESUME_GAP',
        reason: 'SEQUENCE_GAP',
        resumeAfterSequence: 42,
      }),
    );

    await waitFor(() => {
      expect(connectStreamMock).toHaveBeenCalledTimes(2);
    });
    expect(connectStreamMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        lastSeenSequence: 42,
      }),
    );
    // Gap recovery suppresses the disconnect handler, so probeAuthChallenge
    // must NOT be called (no spurious sessions?offset=0&limit=1 request).
    expect(probeAuthChallengeMock).not.toHaveBeenCalled();
  });

  it('routes user-input stream events to blocking-response callbacks', () => {
    let params:
      | {
          onEnvelope: (payload: unknown) => void;
        }
      | undefined;
    const appendEnvelope = vi.fn();
    const onUserInputRequired = vi.fn();
    const onUserInputResolved = vi.fn();
    connectStreamMock.mockImplementation((incoming) => {
      params = incoming as { onEnvelope: (payload: unknown) => void };
      return { close: vi.fn() };
    });

    render(
      <Harness
        sessionId="session-1"
        canOpenStream
        isExecuting
        appendEnvelope={appendEnvelope}
        onUserInputRequired={onUserInputRequired}
        onUserInputResolved={onUserInputResolved}
      />,
    );

    const requiredEnvelope = {
      eventId: 'evt-input-required',
      sessionId: 'session-1',
      requestId: 'req-1',
      sequence: 4,
      eventType: 'USER_INPUT_REQUIRED',
      timelineEventRef: 'timeline-live-11',
      transportHints: ['SSE'],
      payload: {
        inputRequestId: 'input-1',
        inputKind: 'APPROVAL',
        prompt: '是否批准删除生产环境防火墙规则？',
      },
      createdAt: '2026-04-18T08:00:00.000Z',
    } satisfies StreamEnvelope;
    const receivedEnvelope = {
      ...requiredEnvelope,
      eventId: 'evt-input-received',
      sequence: 5,
      eventType: 'USER_INPUT_RECEIVED',
      payload: {
        inputRequestId: 'input-1',
        value: 'approve',
      },
    } satisfies StreamEnvelope;

    act(() => {
      params?.onEnvelope(requiredEnvelope);
      params?.onEnvelope(receivedEnvelope);
    });

    expect(appendEnvelope).toHaveBeenCalledTimes(2);
    expect(onUserInputRequired).toHaveBeenCalledWith(expect.objectContaining({ eventType: 'USER_INPUT_REQUIRED' }));
    expect(onUserInputResolved).toHaveBeenCalledWith(expect.objectContaining({ eventType: 'USER_INPUT_RECEIVED' }));
  });

  it('opens a session live-tail stream when no session cursor is stored', () => {
    connectStreamMock.mockReturnValue({ close: vi.fn() });

    render(<Harness sessionId="session-1" canOpenStream isExecuting />);

    expect(connectStreamMock).toHaveBeenCalledWith(
      expect.objectContaining({
        lastSeenSequence: undefined,
        requestId: null,
        runId: null,
      }),
    );
  });

  it('opens the session stream without request filters for historical in-flight sessions', () => {
    connectStreamMock.mockReturnValue({ close: vi.fn() });

    render(<Harness sessionId="session-1" canOpenStream isExecuting={false} />);

    expect(connectStreamMock).toHaveBeenCalledWith(
      expect.objectContaining({
        lastSeenSequence: undefined,
        requestId: null,
        runId: null,
      }),
    );
  });

  it('reuses the stored session cursor when reconnecting after history replaces live envelopes', () => {
    let params:
      | {
          onEnvelope: (payload: unknown) => void;
        }
      | undefined;
    connectStreamMock.mockImplementation((incoming) => {
      params = incoming as { onEnvelope: (payload: unknown) => void };
      return { close: vi.fn() };
    });

    const { rerender } = render(<Harness sessionId="session-1" canOpenStream isExecuting />);

    params?.onEnvelope({
      eventId: 'live-11',
      sessionId: 'session-1',
      requestId: 'req-1',
      sequence: 11,
      eventType: 'LLM_CONTENT_DELTA',
      timelineEventRef: 'timeline-live-11',
      transportHints: ['SSE'],
      payload: { text: 'live answer', contentType: 'PLAIN_TEXT', metadata: { accumulated: true }, role: 'ASSISTANT' },
      createdAt: '2026-04-18T08:00:01.000Z',
    } satisfies StreamEnvelope);

    rerender(<Harness sessionId="session-1" canOpenStream={false} isExecuting={false} />);
    rerender(<Harness sessionId="session-1" canOpenStream isExecuting />);

    expect(connectStreamMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        lastSeenSequence: 11,
        requestId: null,
        runId: null,
      }),
    );
  });

  it('ignores invalid result-stream envelopes', () => {
    let params:
      | {
          onEnvelope: (payload: unknown) => void;
        }
      | undefined;
    const appendEnvelope = vi.fn();
    connectStreamMock.mockImplementation((incoming) => {
      params = incoming as { onEnvelope: (payload: unknown) => void };
      return { close: vi.fn() };
    });

    render(<Harness sessionId="session-1" canOpenStream isExecuting appendEnvelope={appendEnvelope} />);

    act(() => {
      params?.onEnvelope({
        eventId: 'invalid-live-5',
        sessionId: 'session-1',
        requestId: 'req-1',
        sequence: 5,
        eventType: 'LLM_CONTENT_DELTA',
        timelineEventRef: null,
        transportHints: ['SSE'],
        payload: { role: 'ASSISTANT' },
        createdAt: '2026-04-18T08:00:01.000Z',
      });
    });

    expect(appendEnvelope).not.toHaveBeenCalled();
  });
});
