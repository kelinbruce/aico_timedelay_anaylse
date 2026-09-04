// @vitest-environment jsdom

import { act, cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const testMocks = vi.hoisted(() => ({
  connectStream: vi.fn(),
  runtimeConfig: {
    backendBaseUrl: '',
    transportKind: 'SSE' as 'SSE' | 'WEBSOCKET',
  },
}));

vi.mock('../src/features/chat/transport/streamTransport.ts', () => ({
  connectStream: testMocks.connectStream,
}));

vi.mock('../src/config/runtimeConfig.ts', () => ({
  runtimeConfig: testMocks.runtimeConfig,
  buildApiUrl: (path: string) => path,
}));

import { SessionActivityConnectionController } from '../src/features/session-activity/SessionActivityConnectionController.tsx';
import { useSessionActivityStore, type SessionActivityMessage } from '../src/state/sessionActivityStore.ts';

interface TestConnectionParams {
  readonly kind: 'SSE' | 'WEBSOCKET';
  readonly streamPath: string;
  readonly websocketPath: string;
  readonly decodeFrame: (raw: string) => SessionActivityMessage;
  readonly onEnvelope: (message: SessionActivityMessage) => void;
  readonly onError: (error: Error) => void;
  readonly onProtocolError: (error: Error) => void;
  readonly onClose: () => void;
}

function connectionParams(index = 0): TestConnectionParams {
  const params = testMocks.connectStream.mock.calls[index]?.[0] as TestConnectionParams | undefined;
  if (!params) {
    throw new Error(`Activity connection ${index} was not created.`);
  }
  return params;
}

function acceptRaw(params: TestConnectionParams, raw: string): void {
  params.onEnvelope(params.decodeFrame(raw));
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.clearAllMocks();
  testMocks.runtimeConfig.transportKind = 'SSE';
  useSessionActivityStore.setState({
    entriesBySessionId: {},
    connectionGeneration: 0,
  });
});

describe('SessionActivityConnectionController', () => {
  it.each(['SSE', 'WEBSOCKET'] as const)('opens exactly one selected %s activity connection across rerenders', (kind) => {
    testMocks.runtimeConfig.transportKind = kind;
    testMocks.connectStream.mockReturnValue({ close: vi.fn() });

    const { rerender } = render(<SessionActivityConnectionController />);
    rerender(<SessionActivityConnectionController />);

    expect(testMocks.connectStream).toHaveBeenCalledTimes(1);
    expect(connectionParams()).toMatchObject({
      kind,
      streamPath: '/api/v1/session-activities/stream',
      websocketPath: '/api/v1/session-activities/ws',
    });
    expect(testMocks.connectStream.mock.calls[0]?.[0]).not.toHaveProperty('lastSeenSequence');
    expect(testMocks.connectStream.mock.calls[0]?.[0]).not.toHaveProperty('requestId');
    expect(testMocks.connectStream.mock.calls[0]?.[0]).not.toHaveProperty('runId');
  });

  it('accepts one snapshot followed by deltas and replaces prior generation state', () => {
    testMocks.connectStream.mockReturnValue({ close: vi.fn() });
    useSessionActivityStore.setState({
      entriesBySessionId: {
        stale: { sessionId: 'stale', status: 'RUNNING' },
      },
    });
    render(<SessionActivityConnectionController />);
    const params = connectionParams();

    act(() => {
      acceptRaw(
        params,
        JSON.stringify({
          type: 'SNAPSHOT',
          entries: [{ sessionId: 's1', status: 'RUNNING' }],
        }),
      );
      acceptRaw(
        params,
        JSON.stringify({
          type: 'DELTA',
          entry: { sessionId: 's1', status: 'NONE' },
        }),
      );
      acceptRaw(
        params,
        JSON.stringify({
          type: 'DELTA',
          entry: { sessionId: 's2', status: 'WAITING_FOR_INPUT', pendingInputKind: 'QUESTION' },
        }),
      );
    });

    expect(useSessionActivityStore.getState().entriesBySessionId).toEqual({
      s2: { sessionId: 's2', status: 'WAITING_FOR_INPUT', pendingInputKind: 'QUESTION' },
    });
  });

  it.each([
    ['malformed JSON', '{'],
    [
      'delta before snapshot',
      JSON.stringify({
        type: 'DELTA',
        entry: { sessionId: 's1', status: 'RUNNING' },
      }),
    ],
  ])('closes and reconnects after a non-zero delay for %s without mutating the store', (_caseName, raw) => {
    vi.useFakeTimers();
    const close = vi.fn();
    testMocks.connectStream.mockReturnValue({ close });
    render(<SessionActivityConnectionController />);
    const params = connectionParams();

    expect(() => params.decodeFrame(raw)).toThrow();
    act(() => {
      params.onProtocolError(new Error('protocol error'));
      params.onClose();
    });

    expect(useSessionActivityStore.getState().entriesBySessionId).toEqual({});
    expect(testMocks.connectStream).toHaveBeenCalledTimes(1);
    act(() => {
      vi.advanceTimersByTime(499);
    });
    expect(testMocks.connectStream).toHaveBeenCalledTimes(1);
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(testMocks.connectStream).toHaveBeenCalledTimes(2);
  });

  it('rejects a duplicate snapshot before store mutation and reconnects without clearing the accepted state', () => {
    vi.useFakeTimers();
    testMocks.connectStream.mockReturnValue({ close: vi.fn() });
    render(<SessionActivityConnectionController />);
    const params = connectionParams();

    act(() => {
      acceptRaw(
        params,
        JSON.stringify({
          type: 'SNAPSHOT',
          entries: [{ sessionId: 's1', status: 'RUNNING' }],
        }),
      );
    });
    expect(() =>
      params.decodeFrame(
        JSON.stringify({
          type: 'SNAPSHOT',
          entries: [{ sessionId: 's2', status: 'RUNNING' }],
        }),
      ),
    ).toThrow();
    act(() => {
      params.onProtocolError(new Error('duplicate snapshot'));
      params.onClose();
      vi.advanceTimersByTime(500);
    });

    expect(useSessionActivityStore.getState().entriesBySessionId).toEqual({
      s1: { sessionId: 's1', status: 'RUNNING' },
    });
    expect(testMocks.connectStream).toHaveBeenCalledTimes(2);
  });

  it('ignores callbacks from an older generation after reconnect', () => {
    vi.useFakeTimers();
    testMocks.connectStream.mockReturnValue({ close: vi.fn() });
    render(<SessionActivityConnectionController />);
    const staleParams = connectionParams();

    act(() => {
      staleParams.onError(new Error('connection failed'));
      staleParams.onClose();
      vi.advanceTimersByTime(500);
    });
    const currentParams = connectionParams(1);
    act(() => {
      acceptRaw(
        currentParams,
        JSON.stringify({
          type: 'SNAPSHOT',
          entries: [{ sessionId: 'current', status: 'RUNNING' }],
        }),
      );
      acceptRaw(
        staleParams,
        JSON.stringify({
          type: 'SNAPSHOT',
          entries: [{ sessionId: 'stale', status: 'RUNNING' }],
        }),
      );
    });

    expect(useSessionActivityStore.getState().entriesBySessionId).toEqual({
      current: { sessionId: 'current', status: 'RUNNING' },
    });
  });

  it.each(['SSE stream error (status=404)', 'SSE stream error (status=503)', 'Failed to fetch'])(
    'preserves activity state across %s and rebuilds it from the next snapshot',
    (message) => {
      vi.useFakeTimers();
      testMocks.connectStream.mockReturnValue({ close: vi.fn() });
      useSessionActivityStore.setState({
        entriesBySessionId: {
          retained: { sessionId: 'retained', status: 'UNREAD_RESULT', activityId: 'activity-1' },
        },
      });
      render(<SessionActivityConnectionController />);
      const failedParams = connectionParams();

      act(() => {
        failedParams.onError(new Error(message));
        failedParams.onClose();
        vi.advanceTimersByTime(500);
      });
      expect(useSessionActivityStore.getState().entriesBySessionId).toEqual({
        retained: { sessionId: 'retained', status: 'UNREAD_RESULT', activityId: 'activity-1' },
      });

      act(() => {
        acceptRaw(
          connectionParams(1),
          JSON.stringify({
            type: 'SNAPSHOT',
            entries: [{ sessionId: 'fresh', status: 'RUNNING' }],
          }),
        );
      });
      expect(useSessionActivityStore.getState().entriesBySessionId).toEqual({
        fresh: { sessionId: 'fresh', status: 'RUNNING' },
      });
    },
  );

  it('caps repeated reconnect delays and never retries in the same microtask turn', () => {
    vi.useFakeTimers();
    testMocks.connectStream.mockReturnValue({ close: vi.fn() });
    render(<SessionActivityConnectionController />);

    const delays = [500, 1_000, 2_000, 4_000, 5_000, 5_000];
    delays.forEach((delay, index) => {
      const params = connectionParams(index);
      act(() => {
        params.onError(new Error('endpoint unavailable'));
        params.onClose();
      });
      expect(testMocks.connectStream).toHaveBeenCalledTimes(index + 1);
      act(() => {
        vi.advanceTimersByTime(delay - 1);
      });
      expect(testMocks.connectStream).toHaveBeenCalledTimes(index + 1);
      act(() => {
        vi.advanceTimersByTime(1);
      });
      expect(testMocks.connectStream).toHaveBeenCalledTimes(index + 2);
    });
  });
});
