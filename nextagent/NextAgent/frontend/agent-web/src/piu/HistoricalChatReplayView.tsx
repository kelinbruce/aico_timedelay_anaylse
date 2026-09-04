import { memo } from 'react';
import { PiuRenderer } from '../aico-config/PiuRenderer.tsx';
import type { PIUInfoItem } from '../aico-config/types.ts';
import { historicalChatReplayStore, type ReplayEntry } from './historicalChatReplayStore.ts';

function toPiuData(data: unknown): PIUInfoItem['data'] | undefined {
  if (data === null || data === undefined) {
    return undefined;
  }
  if (Array.isArray(data)) {
    return { data: data as readonly unknown[] };
  }
  if (typeof data === 'object') {
    return data as Readonly<Record<string, unknown>>;
  }
  return undefined;
}

const REPLAY_CONTAINER_STYLE = { width: '100%' } as const;

const REPLAY_BUBBLE_STYLE = {
  background: 'var(--color-ai-bubble-bg)',
  borderRadius: '0px 8px 8px 8px',
  padding: '20px 16px',
} as const;

const REPLAY_VIEW_STYLE = {
  display: 'flex',
  flexDirection: 'column',
  gap: '20px',
} as const;

const ReplayPiuRenderer = memo(function ReplayPiuRenderer({ entry }: { readonly entry: ReplayEntry }) {
  const piuData = entry.data !== undefined ? toPiuData(entry.data) : undefined;
  const piuInfo: PIUInfoItem = {
    piuName: entry.piuName,
    piuVersion: entry.piuVersion,
    renderFunc: entry.method,
    ...(piuData !== undefined ? { data: piuData } : {}),
  };
  return <PiuRenderer piuInfo={piuInfo} extraPayload={entry.extraPayload} containerStyle={REPLAY_CONTAINER_STYLE} />;
});

export function HistoricalChatReplayView() {
  const entries = historicalChatReplayStore((state) => state.entries);
  const entryOrder = historicalChatReplayStore((state) => state.entryOrder);

  return (
    <div data-testid="historical-chat-replay-view" style={REPLAY_VIEW_STYLE}>
      {entryOrder.map((chatId) => {
        const entry = entries.get(chatId);
        if (!entry) {
          return null;
        }
        return (
          <div key={chatId} data-testid="replay-bubble" style={REPLAY_BUBBLE_STYLE}>
            <ReplayPiuRenderer entry={entry} />
          </div>
        );
      })}
    </div>
  );
}
