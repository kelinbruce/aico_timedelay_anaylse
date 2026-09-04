import React, { useEffect, useState } from 'react';
import { useContext } from 'react';
import { useParams } from 'react-router-dom';
import { Alert, Spin } from 'antd';
import { useTranslation } from 'react-i18next';
import { shareService } from '../services/shareService.ts';
import { conversationMessagesToHistoryEnvelopes } from '../features/chat/adapters/conversationAdapter.ts';
import { buildHistoricalTurnBlocks } from '../features/chat/utils/buildTurnBlocks.ts';
import { MessageList } from '../features/chat/components/MessageList.tsx';
import { AppHostContext } from '../app/AppProviders.tsx';
import type { SharedConversationError, SharedConversationErrorKind } from '../state/contracts.ts';

interface SharedConversationData {
  readonly sessionId: string;
  readonly messages: ReadonlyArray<{
    readonly messageId: string;
    readonly sessionId: string;
    readonly requestId: string;
    readonly runId?: string;
    readonly role: string;
    readonly content: string;
    readonly contentType: string;
    readonly metadata: Record<string, unknown>;
    readonly visible: boolean;
    readonly createdAt: number;
  }>;
  readonly createdAt: number;
}

function mapErrorKind(status: number, code?: string): SharedConversationErrorKind | null {
  if (code === 'SHARE_EXPIRED') {
    return 'EXPIRED';
  }
  if (code === 'SHARE_FORBIDDEN') {
    return 'FORBIDDEN';
  }
  if (code === 'SHARE_CONTENT_DELETED') {
    return 'CONTENT_DELETED';
  }
  if (code === 'SHARE_NOT_FOUND' || status === 404) {
    return 'NOT_FOUND';
  }
  if (status === 403) {
    return 'FORBIDDEN';
  }
  if (status === 410) {
    return 'EXPIRED';
  }
  return null;
}

export function SharedConversationPage() {
  const { shareId } = useParams<{ shareId: string }>();
  const { t } = useTranslation();
  const host = useContext(AppHostContext);
  const isRemoteMode = host?.mode === 'immersive' || host?.mode === 'piu';
  const viewerOps = isRemoteMode ? (host?.site?.user?.ops ?? null) : null;
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<SharedConversationData | null>(null);
  const [error, setError] = useState<SharedConversationError | null>(null);

  useEffect(() => {
    if (!shareId) {
      setError({ kind: 'NOT_FOUND' });
      setLoading(false);
      return undefined;
    }
    setLoading(true);
    setData(null);
    setError(null);
    let cancelled = false;
    (async () => {
      try {
        const result = await shareService.loadSharedConversation(shareId, viewerOps);
        if (!cancelled) {
          setData(result as SharedConversationData);
          setLoading(false);
        }
      } catch (err) {
        if (cancelled) {
          return;
        }
        const status = (err as { readonly status?: number }).status ?? 0;
        const code = (err as { readonly code?: string }).code;
        const kind = mapErrorKind(status, code);
        setError({ kind: kind ?? 'ERROR' });
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [shareId, viewerOps]);

  if (loading) {
    return (
      <main
        data-testid="share-loading"
        style={{
          boxSizing: 'border-box',
          width: '100%',
          minHeight: '100vh',
          display: 'grid',
          placeItems: 'center',
          background: 'var(--color-bg-primary)',
          color: 'var(--color-text-primary)',
        }}
      >
        <Spin size="large" />
      </main>
    );
  }

  if (error) {
    const messages: Record<SharedConversationErrorKind, string> = {
      EXPIRED: t('share.expired'),
      FORBIDDEN: t('share.forbidden'),
      CONTENT_DELETED: t('share.contentDeleted'),
      NOT_FOUND: t('share.notFound'),
      ERROR: t('share.error'),
    };
    return (
      <main
        data-testid={`share-error-${error.kind.toLowerCase()}`}
        style={{
          boxSizing: 'border-box',
          width: '100%',
          minHeight: '100vh',
          display: 'grid',
          placeItems: 'center',
          padding: 24,
          background: 'var(--color-bg-primary)',
          color: 'var(--color-text-primary)',
        }}
      >
        <Alert type="warning" showIcon message={messages[error.kind]} />
      </main>
    );
  }

  if (!data || data.messages.length === 0) {
    return (
      <main
        data-testid="share-empty"
        style={{
          boxSizing: 'border-box',
          width: '100%',
          minHeight: '100vh',
          display: 'grid',
          placeItems: 'center',
          padding: 24,
          background: 'var(--color-bg-primary)',
          color: 'var(--color-text-primary)',
        }}
      >
        <Alert type="info" showIcon message={t('share.empty')} />
      </main>
    );
  }

  const envelopes = conversationMessagesToHistoryEnvelopes(data.messages as never[]);
  const turnBlocks = buildHistoricalTurnBlocks(envelopes);

  return (
    <main
      data-testid="shared-conversation-page"
      style={{
        boxSizing: 'border-box',
        width: '100%',
        height: '100dvh',
        overflowY: 'auto',
        background: 'var(--color-bg-primary)',
        color: 'var(--color-text-primary)',
      }}
    >
      <div style={{ maxWidth: 880, margin: '0 auto', padding: 24 }}>
        <MessageList blocks={turnBlocks} onRetry={() => {}} onEdit={() => {}} onCancel={() => {}} turnActionsDisabled showAnnotations={false} />
      </div>
    </main>
  );
}
