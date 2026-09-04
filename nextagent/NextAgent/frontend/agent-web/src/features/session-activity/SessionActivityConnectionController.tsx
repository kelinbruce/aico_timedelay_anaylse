import { useEffect } from 'react';

import { buildApiUrl, runtimeConfig } from '../../config/runtimeConfig.ts';
import { parseSessionActivityMessage, SessionActivityProtocolError, type SessionActivityMessage } from '../../services/sessionActivityService.ts';
import { useSessionActivityStore } from '../../state/sessionActivityStore.ts';
import { connectStream, type StreamConnection } from '../chat/transport/streamTransport.ts';

const ACTIVITY_STREAM_PATH = '/api/v1/session-activities/stream';
const ACTIVITY_WEBSOCKET_PATH = '/api/v1/session-activities/ws';
const INITIAL_RECONNECT_DELAY_MS = 500;
const MAX_RECONNECT_DELAY_MS = 5_000;

function createActivityMessageDecoder(): (raw: string) => SessionActivityMessage {
  let hasAcceptedSnapshot = false;
  return (raw) => {
    const message = parseSessionActivityMessage(raw);
    if (message.type === 'SNAPSHOT') {
      if (hasAcceptedSnapshot) {
        throw new SessionActivityProtocolError();
      }
      hasAcceptedSnapshot = true;
      return message;
    }
    if (!hasAcceptedSnapshot) {
      throw new SessionActivityProtocolError();
    }
    return message;
  };
}

export function SessionActivityConnectionController() {
  useEffect(() => {
    let isDisposed = false;
    let connection: StreamConnection | null = null;
    let reconnectTimer: number | null = null;
    let reconnectAttempt = 0;

    const startConnection = () => {
      if (isDisposed) {
        return;
      }
      reconnectTimer = null;
      const generation = useSessionActivityStore.getState().beginConnectionGeneration();
      let isReconnectScheduled = false;
      connection = null;

      const scheduleReconnect = () => {
        if (isDisposed || isReconnectScheduled || useSessionActivityStore.getState().connectionGeneration !== generation) {
          return;
        }
        isReconnectScheduled = true;
        const delay = Math.min(INITIAL_RECONNECT_DELAY_MS * 2 ** reconnectAttempt, MAX_RECONNECT_DELAY_MS);
        reconnectAttempt += 1;
        reconnectTimer = window.setTimeout(startConnection, delay);
      };

      const handleConnectionFailure = () => {
        if (isDisposed || useSessionActivityStore.getState().connectionGeneration !== generation) {
          return;
        }
        connection?.close();
        scheduleReconnect();
      };

      try {
        connection = connectStream<SessionActivityMessage>({
          kind: runtimeConfig.transportKind,
          streamPath: buildApiUrl(ACTIVITY_STREAM_PATH),
          websocketPath: buildApiUrl(ACTIVITY_WEBSOCKET_PATH),
          decodeFrame: createActivityMessageDecoder(),
          headers: { 'x-non-renewal-session': 'true' },
          onOpen: () => undefined,
          onEnvelope: (message) => {
            const store = useSessionActivityStore.getState();
            if (store.connectionGeneration !== generation) {
              return;
            }
            if (message.type === 'SNAPSHOT') {
              if (store.replaceSnapshot(generation, message.entries)) {
                reconnectAttempt = 0;
              }
              return;
            }
            store.mergeDelta(generation, message.entry);
          },
          onError: handleConnectionFailure,
          onProtocolError: handleConnectionFailure,
          onClose: scheduleReconnect,
        });
      } catch {
        scheduleReconnect();
      }
    };

    startConnection();
    return () => {
      isDisposed = true;
      if (reconnectTimer !== null) {
        window.clearTimeout(reconnectTimer);
      }
      connection?.close();
    };
  }, []);

  return null;
}
