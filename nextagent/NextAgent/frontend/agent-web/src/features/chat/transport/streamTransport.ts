import { type TransportKind } from '../../../state/contracts.ts';
import type { StreamResumeFailureDetails } from '../../../state/contracts.ts';
import { parseStreamResumeFailureDetails } from '../streaming/streamResumeRecovery.ts';

export interface StreamConnection {
  close: () => void;
}

interface ConnectStreamParams<TEnvelope> {
  readonly kind: TransportKind;
  readonly sessionId?: string;
  readonly streamPath: string;
  readonly websocketPath: string;
  readonly lastSeenSequence?: number | undefined;
  readonly requestId?: string | null;
  readonly runId?: string | null;
  readonly decodeFrame?: (raw: string) => TEnvelope;
  readonly onOpen: () => void;
  readonly onEnvelope: (envelope: TEnvelope) => void;
  readonly onError: (error: Error) => void;
  readonly onProtocolError?: (error: Error) => void;
  readonly onClose?: () => void;
  readonly headers?: Record<string, string>;
}

export class StreamResumeFailureError extends Error {
  readonly details: StreamResumeFailureDetails;

  constructor(details: StreamResumeFailureDetails) {
    super(`Stream resume failed: ${details.reason}`);
    this.name = 'StreamResumeFailureError';
    this.details = details;
  }
}

export function getStreamResumeFailureDetails(error: unknown): StreamResumeFailureDetails | null {
  return error instanceof StreamResumeFailureError ? error.details : null;
}

function appendStreamQuery(
  path: string,
  query: {
    readonly lastSeenSequence?: number | undefined;
    readonly requestId?: string | null | undefined;
    readonly runId?: string | null | undefined;
  },
): string {
  const hasQuery = path.includes('?');
  const separator = hasQuery ? '&' : '?';
  const params = new URLSearchParams();
  if (query.lastSeenSequence !== undefined) {
    params.set('lastSeenSequence', String(query.lastSeenSequence));
  }
  if (query.requestId) {
    params.set('requestId', query.requestId);
  }
  if (query.runId) {
    params.set('runId', query.runId);
  }
  const serialized = params.toString();
  return serialized.length === 0 ? path : `${path}${separator}${serialized}`;
}

function toWebSocketUrl(path: string): string {
  if (path.startsWith('ws://') || path.startsWith('wss://')) {
    return path;
  }
  if (path.startsWith('http://')) {
    return `ws://${path.slice('http://'.length)}`;
  }
  if (path.startsWith('https://')) {
    return `wss://${path.slice('https://'.length)}`;
  }
  const base = window.location.origin;
  const resolved = new URL(path, base);
  const protocol = resolved.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${resolved.host}${resolved.pathname}${resolved.search}`;
}

function toError(value: unknown): Error {
  if (value instanceof Error) {
    return value;
  }
  return new Error('Stream transport error');
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function readSafeErrorDetails(value: unknown): StreamResumeFailureDetails | null {
  const root = readRecord(value);
  if (!root) {
    return null;
  }
  const candidates = [root.safeDetails, readRecord(root.error)?.safeDetails, readRecord(root.safeError)?.safeDetails];
  for (const candidate of candidates) {
    const details = parseStreamResumeFailureDetails(candidate);
    if (details) {
      return details;
    }
  }
  return null;
}

async function readFailureDetails(response: Response): Promise<StreamResumeFailureDetails | null> {
  try {
    const body = await response.json();
    return readSafeErrorDetails(body);
  } catch {
    return null;
  }
}

function readSseFrameData(frame: string): string | null {
  const dataLines: string[] = [];
  for (const line of frame.split(/\r?\n/)) {
    if (line.startsWith('data:')) {
      dataLines.push(line.slice('data:'.length).trimStart());
    }
  }
  if (dataLines.length === 0) {
    return null;
  }
  return dataLines.join('\n');
}

function dispatchSseFrame<TEnvelope>(
  frame: string,
  onEnvelope: (envelope: TEnvelope) => void,
  decodeFrame?: (raw: string) => TEnvelope,
): Error | null {
  const raw = readSseFrameData(frame);
  if (!raw) {
    return null;
  }
  if (decodeFrame) {
    let envelope: TEnvelope;
    try {
      envelope = decodeFrame(raw);
    } catch (error) {
      return toError(error);
    }
    onEnvelope(envelope);
    return null;
  }
  try {
    const envelope = JSON.parse(raw) as TEnvelope;
    onEnvelope(envelope);
  } catch {
    // Detail streams preserve their existing malformed-frame behavior.
  }
  return null;
}

function createSseConnection<TEnvelope>({
  streamPath,
  lastSeenSequence,
  requestId,
  runId,
  headers,
  onOpen,
  onEnvelope,
  onError,
  decodeFrame,
  onProtocolError,
  onClose,
}: Omit<ConnectStreamParams<TEnvelope>, 'kind' | 'websocketPath'>): StreamConnection {
  const url = appendStreamQuery(streamPath, { lastSeenSequence, requestId, runId });
  const abortController = new AbortController();
  let closed = false;
  let closeEmitted = false;

  const emitClose = () => {
    if (closeEmitted) {
      return;
    }
    closeEmitted = true;
    onClose?.();
  };

  const run = async () => {
    try {
      const response = await fetch(url, {
        credentials: 'include',
        headers: { Accept: 'text/event-stream', ...(headers ?? {}) },
        signal: abortController.signal,
      });
      if (closed) {
        return;
      }
      if (!response.ok) {
        const details = await readFailureDetails(response);
        closed = true;
        onError(details ? new StreamResumeFailureError(details) : new Error(`SSE stream error (status=${response.status})`));
        emitClose();
        return;
      }
      if (!response.body) {
        closed = true;
        onError(new Error('SSE stream response did not include a readable body'));
        emitClose();
        return;
      }

      onOpen();
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      while (!closed) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }
        buffer += decoder.decode(value, { stream: true });
        const frames = buffer.split(/\r?\n\r?\n/);
        buffer = frames.pop() ?? '';
        for (const frame of frames) {
          const protocolError = dispatchSseFrame(frame, onEnvelope, decodeFrame);
          if (protocolError) {
            closed = true;
            abortController.abort();
            onProtocolError?.(protocolError);
            emitClose();
            return;
          }
        }
      }
      if (buffer.trim().length > 0) {
        const protocolError = dispatchSseFrame(buffer, onEnvelope, decodeFrame);
        if (protocolError) {
          closed = true;
          abortController.abort();
          onProtocolError?.(protocolError);
          emitClose();
          return;
        }
      }
      if (!closed) {
        closed = true;
        emitClose();
      }
    } catch (error) {
      if (closed && error instanceof Error && error.name === 'AbortError') {
        return;
      }
      if (!closed) {
        closed = true;
        onError(toError(error));
        emitClose();
      }
    }
  };

  void run();

  return {
    close: () => {
      if (closed) {
        return;
      }
      closed = true;
      abortController.abort();
      emitClose();
    },
  };
}

function createWebSocketConnection<TEnvelope>({
  websocketPath,
  lastSeenSequence,
  requestId,
  runId,
  onOpen,
  onEnvelope,
  onError,
  decodeFrame,
  onProtocolError,
  onClose,
}: Omit<ConnectStreamParams<TEnvelope>, 'kind' | 'streamPath'>): StreamConnection {
  const url = toWebSocketUrl(appendStreamQuery(websocketPath, { lastSeenSequence, requestId, runId }));
  const socket = new WebSocket(url);
  let isTerminated = false;
  let isCloseRequested = false;
  let closeEmitted = false;

  const emitClose = () => {
    if (closeEmitted) {
      return;
    }
    closeEmitted = true;
    onClose?.();
  };

  socket.onopen = () => {
    if (!isTerminated) {
      onOpen();
    }
  };
  socket.onmessage = (event) => {
    if (isTerminated || typeof event.data !== 'string') {
      return;
    }
    const raw = event.data;
    if (decodeFrame) {
      let envelope: TEnvelope;
      try {
        envelope = decodeFrame(raw);
      } catch (error) {
        isTerminated = true;
        isCloseRequested = true;
        socket.close();
        onProtocolError?.(toError(error));
        return;
      }
      onEnvelope(envelope);
      return;
    }
    try {
      const parsed = JSON.parse(raw) as TEnvelope;
      onEnvelope(parsed);
    } catch {
      // Detail streams preserve their existing malformed-frame behavior.
    }
  };
  socket.onerror = (event) => {
    if (!isTerminated) {
      onError(toError(event));
    }
  };
  socket.onclose = () => {
    isTerminated = true;
    emitClose();
  };

  return {
    close: () => {
      if (isCloseRequested) {
        return;
      }
      isTerminated = true;
      isCloseRequested = true;
      socket.close();
    },
  };
}

export function connectStream<TEnvelope>(params: ConnectStreamParams<TEnvelope>): StreamConnection {
  if (params.kind === 'WEBSOCKET') {
    return createWebSocketConnection(params);
  }
  return createSseConnection(params);
}
