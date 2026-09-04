import { useEffect, useRef } from 'react';
import type { StreamEnvelope } from '../../state/contracts.ts';
import { expandPanelStore } from './ExpandPanelStore.ts';
import type { ToolMessageType } from '../chat/presentation/answerContent.ts';

const VALID_TOOL_MESSAGE_TYPES: readonly string[] = ['PIU', 'DSL', 'ACTION', 'OPERATOR', 'FILE', 'TEXT'];

export function useExpandPanelStreamWatcher(activeSessionEventLayer: readonly StreamEnvelope[], sessionId?: string): void {
  const lastSequenceRef = useRef<number>(-1);
  const prevSessionIdRef = useRef<string | undefined>(undefined);

  useEffect(() => {
    if (prevSessionIdRef.current !== sessionId) {
      lastSequenceRef.current = -1;
      prevSessionIdRef.current = sessionId;
      expandPanelStore.getState().close();
    }

    for (const event of activeSessionEventLayer) {
      if (event.sequence <= lastSequenceRef.current) {
        continue;
      }

      if (event.eventType !== 'TOOL_STRUCTURED_DELTA') {
        continue;
      }
      const payload = event.payload as Record<string, unknown>;
      if (payload.toolEventType !== 'EXPAND_PANEL') {
        continue;
      }

      lastSequenceRef.current = event.sequence;

      if (event.transportHints.includes('history-load')) {
        continue;
      }

      const messageType = typeof payload.toolMessageType === 'string' ? payload.toolMessageType : '';
      if (!VALID_TOOL_MESSAGE_TYPES.includes(messageType)) {
        continue;
      }

      const prevContent = expandPanelStore.getState().content;
      const prevTextContent =
        messageType === 'TEXT' && prevContent?.toolMessageType === 'TEXT' && typeof prevContent?.content === 'string' ? prevContent.content : null;
      const newContent =
        prevTextContent !== null
          ? prevTextContent + (typeof payload.content === 'string' ? payload.content : String(payload.content ?? ''))
          : payload.content;
      expandPanelStore.getState().setContent(
        {
          toolMessageType: messageType as ToolMessageType,
          content: newContent,
        },
        'live-stream',
      );
      expandPanelStore.getState().open();
    }
  }, [activeSessionEventLayer, sessionId]);
}
