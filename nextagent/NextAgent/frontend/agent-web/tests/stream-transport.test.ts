import { waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { connectStream, getStreamResumeFailureDetails } from '../src/features/chat/transport/streamTransport.ts';
import { type StreamEnvelope } from '../src/state/contracts.ts';

class MockWebSocket {
  static instances: MockWebSocket[] = [];

  readonly url: string;
  onopen: (() => void) | null = null;
  onmessage: ((event: MessageEvent<string>) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  onclose: (() => void) | null = null;

  constructor(url: string) {
    this.url = url;
    MockWebSocket.instances.push(this);
  }

  close = vi.fn(() => {
    this.onclose?.();
  });
}

afterEach(() => {
  MockWebSocket.instances = [];
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function envelope(): StreamEnvelope {
  return {
    eventId: 'evt-1',
    sessionId: 'sess-1',
    requestId: 'req-1',
    sequence: 1,
    eventType: 'LLM_CONTENT_DELTA',
    timelineEventRef: 'timeline-evt-1',
    transportHints: [],
    payload: { delta: 'hello', contentType: 'PLAIN_TEXT' },
    createdAt: '2026-04-13T09:00:00Z',
  };
}

function streamResponse(text: string): Response {
  return new Response(
    new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(text));
        controller.close();
      },
    }),
    {
      status: 200,
      headers: { 'content-type': 'text/event-stream' },
    },
  );
}

function sseFrame(payload: unknown, eventName = 'message'): string {
  return `event: ${eventName}\ndata: ${JSON.stringify(payload)}\n\n`;
}

describe('streamTransport', () => {
  it('connects with fetch SSE and forwards envelopes through a unified callback', async () => {
    vi.stubGlobal('WebSocket', MockWebSocket);
    const fetchMock = vi.fn().mockResolvedValue(streamResponse(sseFrame(envelope())));
    vi.stubGlobal('fetch', fetchMock);
    const onOpen = vi.fn();
    const onEnvelope = vi.fn();
    const onError = vi.fn();
    const onClose = vi.fn();

    connectStream<StreamEnvelope>({
      kind: 'SSE',
      sessionId: 'sess-1',
      streamPath: '/api/v1/sessions/sess-1/stream',
      websocketPath: '/api/v1/sessions/sess-1/ws',
      lastSeenSequence: 42,
      onOpen,
      onEnvelope,
      onError,
      onClose,
    });

    await waitFor(() => {
      expect(onEnvelope).toHaveBeenCalledWith(envelope());
    });

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/sessions/sess-1/stream?lastSeenSequence=42',
      expect.objectContaining({
        credentials: 'include',
        headers: { Accept: 'text/event-stream' },
      }),
    );
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(onError).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('omits lastSeenSequence from SSE URLs when no in-memory cursor exists', async () => {
    vi.stubGlobal('WebSocket', MockWebSocket);
    const fetchMock = vi.fn().mockResolvedValue(streamResponse(sseFrame(envelope())));
    vi.stubGlobal('fetch', fetchMock);

    connectStream<StreamEnvelope>({
      kind: 'SSE',
      sessionId: 'sess-1',
      streamPath: '/api/v1/sessions/sess-1/stream',
      websocketPath: '/api/v1/sessions/sess-1/ws',
      onOpen: vi.fn(),
      onEnvelope: vi.fn(),
      onError: vi.fn(),
    });

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/v1/sessions/sess-1/stream', expect.any(Object));
    });
  });

  it('omits lastSeenSequence from WebSocket URLs when no in-memory cursor exists', () => {
    vi.stubGlobal('WebSocket', MockWebSocket);

    connectStream<StreamEnvelope>({
      kind: 'WEBSOCKET',
      sessionId: 'sess-1',
      streamPath: '/api/v1/sessions/sess-1/stream',
      websocketPath: '/api/v1/sessions/sess-1/ws',
      onOpen: vi.fn(),
      onEnvelope: vi.fn(),
      onError: vi.fn(),
    });

    const socket = MockWebSocket.instances[0];
    expect(socket?.url).toContain('/api/v1/sessions/sess-1/ws');
    expect(socket?.url).not.toContain('lastSeenSequence');
  });

  it('adds request and run filters without resetting the session sequence cursor', async () => {
    vi.stubGlobal('WebSocket', MockWebSocket);
    const fetchMock = vi.fn().mockResolvedValue(streamResponse(''));
    vi.stubGlobal('fetch', fetchMock);

    connectStream<StreamEnvelope>({
      kind: 'SSE',
      sessionId: 'sess-1',
      streamPath: '/api/v1/sessions/sess-1/stream?transport=sse',
      websocketPath: '/api/v1/sessions/sess-1/ws',
      lastSeenSequence: 42,
      requestId: 'req-1',
      runId: 'run-1',
      onOpen: vi.fn(),
      onEnvelope: vi.fn(),
      onError: vi.fn(),
    });

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/v1/sessions/sess-1/stream?transport=sse&lastSeenSequence=42&requestId=req-1&runId=run-1',
        expect.any(Object),
      );
    });
  });

  it('forwards named SSE events emitted with an event field', async () => {
    vi.stubGlobal('WebSocket', MockWebSocket);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(streamResponse(sseFrame(envelope(), 'LLM_CONTENT_DELTA'))));
    const onEnvelope = vi.fn();

    connectStream<StreamEnvelope>({
      kind: 'SSE',
      sessionId: 'sess-1',
      streamPath: '/api/v1/sessions/sess-1/stream',
      websocketPath: '/api/v1/sessions/sess-1/ws',
      lastSeenSequence: 0,
      onOpen: vi.fn(),
      onEnvelope,
      onError: vi.fn(),
    });

    await waitFor(() => {
      expect(onEnvelope).toHaveBeenCalledWith(envelope());
    });
  });

  it('surfaces handshake STREAM_RESUME_FAILURE safe details without a generic reconnect error', async () => {
    vi.stubGlobal('WebSocket', MockWebSocket);
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            safeDetails: {
              kind: 'STREAM_RESUME_FAILURE',
              reason: 'VALIDATION_FAILED',
              retryable: false,
              refreshConversation: false,
              resumeAfterSequence: null,
            },
          }),
          { status: 400, headers: { 'content-type': 'application/json' } },
        ),
      ),
    );
    const onError = vi.fn();

    connectStream<StreamEnvelope>({
      kind: 'SSE',
      sessionId: 'sess-1',
      streamPath: '/api/v1/sessions/sess-1/stream',
      websocketPath: '/api/v1/sessions/sess-1/ws',
      lastSeenSequence: 99,
      onOpen: vi.fn(),
      onEnvelope: vi.fn(),
      onError,
    });

    await waitFor(() => {
      expect(onError).toHaveBeenCalledTimes(1);
    });
    expect(getStreamResumeFailureDetails(onError.mock.calls[0]?.[0])).toEqual({
      kind: 'STREAM_RESUME_FAILURE',
      reason: 'VALIDATION_FAILED',
      retryable: false,
      refreshConversation: false,
      resumeAfterSequence: null,
    });
  });

  it('connects with WebSocket and forwards envelopes through a unified callback', () => {
    vi.stubGlobal('WebSocket', MockWebSocket);
    const onOpen = vi.fn();
    const onEnvelope = vi.fn();
    const onError = vi.fn();
    const onClose = vi.fn();

    const connection = connectStream<StreamEnvelope>({
      kind: 'WEBSOCKET',
      sessionId: 'sess-1',
      streamPath: '/api/v1/sessions/sess-1/stream',
      websocketPath: '/api/v1/sessions/sess-1/ws',
      lastSeenSequence: 7,
      onOpen,
      onEnvelope,
      onError,
      onClose,
    });

    const socket = MockWebSocket.instances[0];
    expect(socket).toBeTruthy();
    expect(socket?.url).toContain('/api/v1/sessions/sess-1/ws?lastSeenSequence=7');
    expect(socket?.url.startsWith('ws://') || socket?.url.startsWith('wss://')).toBe(true);

    socket?.onopen?.();
    socket?.onmessage?.({
      data: JSON.stringify(envelope()),
    } as MessageEvent<string>);
    socket?.onerror?.(new Error('ws error'));
    socket?.onclose?.();

    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(onEnvelope).toHaveBeenCalledWith(envelope());
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);

    connection.close();
    expect(socket?.close).toHaveBeenCalledTimes(1);
  });

  it('ignores malformed raw frames without forwarding them', async () => {
    vi.stubGlobal('WebSocket', MockWebSocket);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(streamResponse('data: {bad json\n\n')));
    const onEnvelope = vi.fn();
    const onClose = vi.fn();

    connectStream<StreamEnvelope>({
      kind: 'SSE',
      sessionId: 'sess-1',
      streamPath: '/api/v1/sessions/sess-1/stream',
      websocketPath: '/api/v1/sessions/sess-1/ws',
      lastSeenSequence: 0,
      onOpen: vi.fn(),
      onEnvelope,
      onError: vi.fn(),
      onClose,
    });

    await waitFor(() => {
      expect(onClose).toHaveBeenCalledTimes(1);
    });
    expect(onEnvelope).not.toHaveBeenCalled();
  });

  it('closes SSE on a strict decoder protocol error while preserving the default detail behavior', async () => {
    vi.stubGlobal('WebSocket', MockWebSocket);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(streamResponse('data: {bad json\n\n')));
    const onEnvelope = vi.fn();
    const onProtocolError = vi.fn();
    const onClose = vi.fn();

    connectStream<StreamEnvelope>({
      kind: 'SSE',
      streamPath: '/api/v1/session-activities/stream',
      websocketPath: '/api/v1/session-activities/ws',
      decodeFrame: (raw) => JSON.parse(raw) as StreamEnvelope,
      onOpen: vi.fn(),
      onEnvelope,
      onError: vi.fn(),
      onProtocolError,
      onClose,
    });

    await waitFor(() => {
      expect(onProtocolError).toHaveBeenCalledTimes(1);
    });
    expect(onEnvelope).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes WebSocket on a strict decoder protocol error', () => {
    vi.stubGlobal('WebSocket', MockWebSocket);
    const onEnvelope = vi.fn();
    const onProtocolError = vi.fn();
    const onClose = vi.fn();

    connectStream<StreamEnvelope>({
      kind: 'WEBSOCKET',
      streamPath: '/api/v1/session-activities/stream',
      websocketPath: '/api/v1/session-activities/ws',
      decodeFrame: (raw) => JSON.parse(raw) as StreamEnvelope,
      onOpen: vi.fn(),
      onEnvelope,
      onError: vi.fn(),
      onProtocolError,
      onClose,
    });

    const socket = MockWebSocket.instances[0];
    socket?.onmessage?.({ data: '{bad json' } as MessageEvent<string>);

    expect(onProtocolError).toHaveBeenCalledTimes(1);
    expect(onEnvelope).not.toHaveBeenCalled();
    expect(socket?.close).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('merges custom headers into SSE fetch headers', async () => {
    vi.stubGlobal('WebSocket', MockWebSocket);
    const fetchMock = vi.fn().mockResolvedValue(streamResponse(''));
    vi.stubGlobal('fetch', fetchMock);

    connectStream<StreamEnvelope>({
      kind: 'SSE',
      sessionId: 'sess-1',
      streamPath: '/api/v1/sessions/sess-1/stream',
      websocketPath: '/api/v1/sessions/sess-1/ws',
      headers: { 'x-non-renewal-session': 'true' },
      onOpen: vi.fn(),
      onEnvelope: vi.fn(),
      onError: vi.fn(),
    });

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalled();
    });

    const callInit = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(callInit.headers).toEqual({
      Accept: 'text/event-stream',
      'x-non-renewal-session': 'true',
    });
  });

  it('omits custom headers from SSE fetch when none are provided', async () => {
    vi.stubGlobal('WebSocket', MockWebSocket);
    const fetchMock = vi.fn().mockResolvedValue(streamResponse(''));
    vi.stubGlobal('fetch', fetchMock);

    connectStream<StreamEnvelope>({
      kind: 'SSE',
      sessionId: 'sess-1',
      streamPath: '/api/v1/sessions/sess-1/stream',
      websocketPath: '/api/v1/sessions/sess-1/ws',
      onOpen: vi.fn(),
      onEnvelope: vi.fn(),
      onError: vi.fn(),
    });

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalled();
    });

    const callInit = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(callInit.headers).toEqual({ Accept: 'text/event-stream' });
  });
});
