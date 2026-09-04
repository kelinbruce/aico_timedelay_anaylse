import { Modal, Typography } from 'antd';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { getCurrentLocale } from '../../../i18n/index.ts';
import { sessionService } from '../../../services/sessionService.ts';
import type { SessionHistoryEntry } from '../../../state/contracts.ts';
import {
  RECENT_SESSION_LIMIT,
  SESSION_HISTORY_PAGE_LIMIT,
  hasSessionHistorySearchQuery,
  type SessionHistorySearchQuery,
  useSessionStore,
} from '../../../state/sessionStore.ts';
import { isApiError } from '../../../services/apiClient.ts';
import { resolveSessionRenameError } from './session-rename-error.ts';
import { SessionHistoryEntryRow } from './SessionHistoryEntryRow.tsx';
import { SessionHistorySearchControls } from './SessionHistorySearchControls.tsx';
import { SessionRenameModal } from './SessionRenameModal.tsx';
import { SessionDeleteConfirmModal } from './SessionDeleteConfirmModal.tsx';

interface SessionHistorySearchDialogProps {
  readonly open: boolean;
  readonly activeSessionId: string | null;
  readonly isConversationSurfaceVisible?: boolean | undefined;
  readonly hasWritePermission: boolean;
  readonly onClose: () => void;
  readonly onOpenSession: (sessionId: string) => void;
  readonly onDeletedSession?: (sessionId: string) => void;
}

export function SessionHistorySearchDialog({
  open,
  activeSessionId,
  isConversationSurfaceVisible = true,
  hasWritePermission,
  onClose,
  onOpenSession,
  onDeletedSession,
}: SessionHistorySearchDialogProps) {
  const { t } = useTranslation();
  const activeLocale = getCurrentLocale();
  const updateSessionTitle = useSessionStore((state) => state.updateSessionTitle);
  const [query, setQuery] = useState<SessionHistorySearchQuery>({});
  const [entries, setEntries] = useState<readonly SessionHistoryEntry[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [offset, setOffset] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [renameTarget, setRenameTarget] = useState<SessionHistoryEntry | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const [renameError, setRenameError] = useState<string | null>(null);
  const [isRenamePending, setIsRenamePending] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<SessionHistoryEntry | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [isDeletePending, setIsDeletePending] = useState(false);
  const requestVersionRef = useRef(0);
  const offsetRef = useRef(0);
  const isSearchActive = hasSessionHistorySearchQuery(query);

  const loadDialogSessions = useCallback(
    async (nextQuery: SessionHistorySearchQuery, options: { readonly append?: boolean; readonly limit?: number } = {}) => {
      const append = options.append ?? false;
      const nextOffset = append ? offsetRef.current : 0;
      const nextLimit = options.limit ?? (append || hasSessionHistorySearchQuery(nextQuery) ? SESSION_HISTORY_PAGE_LIMIT : RECENT_SESSION_LIMIT);
      const requestVersion = ++requestVersionRef.current;

      if (!append) {
        setQuery(nextQuery);
      }
      setIsLoading(true);
      setError(null);
      try {
        const page = await sessionService.listSessions({
          offset: nextOffset,
          limit: nextLimit,
          ...(nextQuery.q === undefined ? {} : { q: nextQuery.q }),
          ...(nextQuery.createdFrom === undefined || nextQuery.createdTo === undefined
            ? {}
            : { createdFrom: nextQuery.createdFrom, createdTo: nextQuery.createdTo }),
        });
        if (requestVersion !== requestVersionRef.current) {
          return;
        }
        const nextEntries = Array.isArray(page.entries) ? page.entries : [];
        setEntries((previous) => (append ? [...previous, ...nextEntries] : nextEntries));
        setHasMore(Boolean(page.hasMore));
        const nextLoadedOffset = page.offset + nextEntries.length;
        offsetRef.current = nextLoadedOffset;
        setOffset(nextLoadedOffset);
      } catch (nextError) {
        if (requestVersion !== requestVersionRef.current) {
          return;
        }
        setError(nextError instanceof Error ? nextError.message : 'Failed to load sessions.');
      } finally {
        if (requestVersion === requestVersionRef.current) {
          setIsLoading(false);
        }
      }
    },
    [],
  );

  useEffect(() => {
    if (!open) {
      requestVersionRef.current += 1;
      return;
    }
    setQuery({});
    setEntries([]);
    setHasMore(false);
    setOffset(0);
    offsetRef.current = 0;
    setError(null);
    void loadDialogSessions({}, { limit: RECENT_SESSION_LIMIT });
  }, [loadDialogSessions, open]);

  const handleQueryChange = useCallback(
    (nextQuery: SessionHistorySearchQuery, options: { readonly limit?: number | undefined }) => {
      void loadDialogSessions(nextQuery, options.limit === undefined ? {} : { limit: options.limit });
    },
    [loadDialogSessions],
  );

  const handleLoadMore = useCallback(() => {
    if (isLoading || !hasMore) {
      return;
    }
    void loadDialogSessions(query, { append: true });
  }, [hasMore, isLoading, loadDialogSessions, query]);

  const openRenameModal = useCallback((entry: SessionHistoryEntry) => {
    setRenameTarget(entry);
    setRenameDraft(entry.displayTitle);
    setRenameError(null);
  }, []);

  const closeRenameModal = useCallback(() => {
    if (isRenamePending) {
      return;
    }
    setRenameTarget(null);
    setRenameDraft('');
    setRenameError(null);
  }, [isRenamePending]);

  const submitRename = useCallback(async () => {
    if (!renameTarget) {
      return;
    }
    const nextTitle = renameDraft.trim();
    if (!nextTitle) {
      return;
    }
    setIsRenamePending(true);
    setRenameError(null);
    try {
      await sessionService.renameSession(renameTarget.sessionId, nextTitle);
      updateSessionTitle(renameTarget.sessionId, nextTitle);
      setEntries((previous) => previous.map((entry) => (entry.sessionId === renameTarget.sessionId ? { ...entry, displayTitle: nextTitle } : entry)));
      setRenameTarget(null);
      setRenameDraft('');
      await loadDialogSessions(query, {
        limit: Math.max(offset, isSearchActive ? SESSION_HISTORY_PAGE_LIMIT : RECENT_SESSION_LIMIT),
      });
    } catch (nextError) {
      setRenameError(resolveSessionRenameError(nextError, t));
    } finally {
      setIsRenamePending(false);
    }
  }, [isSearchActive, loadDialogSessions, offset, query, renameDraft, renameTarget, updateSessionTitle]);

  const openDeleteModal = useCallback((entry: SessionHistoryEntry) => {
    setDeleteTarget(entry);
    setDeleteError(null);
  }, []);

  const closeDeleteModal = useCallback(() => {
    if (isDeletePending) {
      return;
    }
    setDeleteTarget(null);
    setDeleteError(null);
  }, [isDeletePending]);

  const submitDelete = useCallback(async () => {
    if (!deleteTarget) {
      return;
    }
    const sessionId = deleteTarget.sessionId;
    setIsDeletePending(true);
    setDeleteError(null);
    try {
      await useSessionStore.getState().deleteSession(sessionId);
      setEntries((previous) => previous.filter((entry) => entry.sessionId !== sessionId));
      if (activeSessionId === sessionId) {
        onDeletedSession?.(sessionId);
      }
      setDeleteTarget(null);
      await loadDialogSessions(query, {
        limit: Math.max(offset, isSearchActive ? SESSION_HISTORY_PAGE_LIMIT : RECENT_SESSION_LIMIT),
      });
    } catch (nextError) {
      if (isApiError(nextError) && nextError.code === 'SESSION_DELETE_CONFLICT') {
        setDeleteError(t('sidebar.deleteSessionActiveRun'));
      } else {
        setDeleteError(nextError instanceof Error ? nextError.message : t('sidebar.deleteSessionFailed'));
      }
    } finally {
      setIsDeletePending(false);
    }
  }, [activeSessionId, deleteTarget, isSearchActive, loadDialogSessions, offset, onDeletedSession, query, t]);

  const openSession = useCallback(
    (sessionId: string) => {
      onOpenSession(sessionId);
      onClose();
    },
    [onClose, onOpenSession],
  );

  return (
    <>
      <Modal title={t('sessionHistory.searchHistory')} open={open} onCancel={onClose} footer={null} width={540} destroyOnHidden>
        <div style={{ display: 'flex', flexDirection: 'column', minHeight: 360, maxHeight: '64vh', gap: 8 }}>
          <SessionHistorySearchControls query={query} onQueryChange={handleQueryChange} />
          <div
            data-testid="session-history-search-dialog-list"
            className="sidebar-session-list-scroll nextagent-themed-scrollbar"
            style={{
              minHeight: 0,
              flex: '1 1 0',
              overflowY: 'auto',
              display: 'flex',
              flexDirection: 'column',
              gap: 2,
              paddingRight: 2,
              scrollbarColor: 'var(--color-scrollbar) var(--color-bg-primary)',
              scrollbarGutter: 'stable',
            }}
          >
            {isLoading && entries.length === 0 ? (
              <Typography.Text type="secondary" style={{ display: 'block', fontSize: 12, padding: '8px' }}>
                {t('sidebar.loadingSessions')}
              </Typography.Text>
            ) : null}
            {error && entries.length === 0 ? (
              <Typography.Text type="danger" style={{ display: 'block', fontSize: 12, padding: '8px' }}>
                {error}{' '}
                <Typography.Link
                  onClick={() => void loadDialogSessions(query, { limit: isSearchActive ? SESSION_HISTORY_PAGE_LIMIT : RECENT_SESSION_LIMIT })}
                >
                  {t('common.retry')}
                </Typography.Link>
              </Typography.Text>
            ) : null}
            {!isLoading && !error && entries.length === 0 ? (
              <div style={{ padding: '8px', lineHeight: 1.5 }}>
                <Typography.Text style={{ display: 'block', fontSize: 12, fontWeight: 500, color: 'var(--color-text-secondary)' }}>
                  {isSearchActive ? t('sessionHistory.noMatchesTitle') : t('sidebar.emptySessionsTitle')}
                </Typography.Text>
                {!isSearchActive ? (
                  <Typography.Text style={{ display: 'block', marginTop: 2, fontSize: 12, color: 'var(--color-text-tertiary)' }}>
                    {t('sidebar.emptySessionsDescription')}
                  </Typography.Text>
                ) : null}
              </div>
            ) : null}
            {entries.map((entry) => (
              <SessionHistoryEntryRow
                key={entry.sessionId}
                entry={entry}
                active={activeSessionId === entry.sessionId}
                isConversationSurfaceVisible={isConversationSurfaceVisible}
                locale={activeLocale}
                yesterdayLabel={t('sidebar.yesterday')}
                hasWritePermission={hasWritePermission}
                moreActionsLabel={t('sessionActivity.moreActions')}
                renameLabel={t('sidebar.renameSession')}
                deleteLabel={t('sidebar.deleteSession')}
                showActionsOnHover={false}
                onOpen={openSession}
                onRename={openRenameModal}
                onDelete={openDeleteModal}
                dataTestId={`session-history-dialog-session-item-${entry.sessionId}`}
              />
            ))}
          </div>
          {hasMore ? (
            <button
              type="button"
              className="sidebar-session-list-load-more"
              onClick={handleLoadMore}
              disabled={isLoading}
              aria-busy={isLoading ? 'true' : undefined}
            >
              {isLoading ? t('sidebar.loadingSessions') : t('sidebar.loadMoreSessions')}
            </button>
          ) : null}
        </div>
      </Modal>
      <SessionRenameModal
        open={renameTarget !== null}
        draft={renameDraft}
        error={renameError}
        pending={isRenamePending}
        onDraftChange={setRenameDraft}
        onCancel={closeRenameModal}
        onSubmit={() => void submitRename()}
      />
      <SessionDeleteConfirmModal
        open={deleteTarget !== null}
        displayTitle={deleteTarget?.displayTitle}
        error={deleteError}
        pending={isDeletePending}
        onCancel={closeDeleteModal}
        onSubmit={() => void submitDelete()}
      />
    </>
  );
}
