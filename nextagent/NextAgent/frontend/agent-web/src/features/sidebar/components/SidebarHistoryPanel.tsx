import { SearchOutlined } from '@ant-design/icons';
import { Input, Typography } from 'antd';
import { useEffect, useRef, useState, type CSSProperties, type RefObject, type WheelEvent as ReactWheelEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { SESSION_HISTORY_PAGE_LIMIT, useSessionStore } from '../../../state/sessionStore.ts';
import type { SessionHistoryEntry } from '../../../state/contracts.ts';
import './SidebarHistoryPanel.css';

export interface SidebarHistoryPanelProps {
  readonly panelRef: RefObject<HTMLDivElement | null>;
  readonly position: { readonly left: number; readonly top: number };
  readonly onOpenSession: (sessionId: string) => void;
  readonly onDeleteSession: (entry: SessionHistoryEntry) => void;
}

export function SidebarHistoryPanel({ panelRef, position, onOpenSession, onDeleteSession }: SidebarHistoryPanelProps) {
  const { t } = useTranslation();
  const sessions = useSessionStore((state) => state.sessions);
  const hasMore = useSessionStore((state) => state.hasMore);
  const isLoading = useSessionStore((state) => state.isLoadingHistory);
  const historyError = useSessionStore((state) => state.historyError);
  const loadSessions = useSessionStore((state) => state.loadSessions);
  const loadMoreSessions = useSessionStore((state) => state.loadMoreSessions);
  const [keyword, setKeyword] = useState('');
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const loadedInitialRef = useRef(false);

  useEffect(() => {
    if (!loadedInitialRef.current) {
      loadedInitialRef.current = true;
      void loadSessions({ limit: SESSION_HISTORY_PAGE_LIMIT });
      return;
    }
    const timer = window.setTimeout(() => {
      void loadSessions({
        limit: SESSION_HISTORY_PAGE_LIMIT,
        query: keyword.trim() ? { q: keyword.trim() } : {},
      });
    }, 300);
    return () => window.clearTimeout(timer);
  }, [keyword, loadSessions]);

  const handleWheel = (event: ReactWheelEvent<HTMLDivElement>) => {
    if (event.deltaY <= 0 || !hasMore || isLoading || !scrollRef.current) {
      return;
    }
    const el = scrollRef.current;
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 32 || el.scrollHeight <= el.clientHeight) {
      void loadMoreSessions();
    }
  };

  return (
    <div
      ref={panelRef}
      className="sidebar-history-panel"
      data-testid="sidebar-history-panel"
      role="region"
      aria-label={t('sidebar.recentSessions')}
      style={
        {
          '--sidebar-history-panel-left': `${position.left}px`,
          '--sidebar-history-panel-top': `${position.top}px`,
        } as CSSProperties
      }
    >
      <div
        className="sidebar-history-panel-title"
        data-testid="sidebar-history-panel-title"
      >
        {t('sidebar.recentSessions')}
      </div>
      <Input
        className="sidebar-history-panel-search"
        classNames={{ input: 'sidebar-history-panel-search-input' }}
        data-testid="sidebar-history-panel-search"
        style={{ height: 32, width: '100%' }}
        styles={{ input: { height: 32 } }}
        value={keyword}
        onChange={(event) => setKeyword(event.target.value)}
        placeholder={t('sessionHistory.searchPlaceholder')}
        aria-label={t('sessionHistory.searchHistory')}
        suffix={<SearchOutlined className="sidebar-history-panel-search-icon" />}
      />
      <div
        ref={scrollRef}
        className="sidebar-history-panel-list nextagent-themed-scrollbar"
        data-testid="sidebar-session-list-scroll"
        onWheel={handleWheel}
      >
        {historyError && sessions.length === 0 ? (
          <Typography.Text type="danger" className="sidebar-history-panel-status">
            {historyError}
          </Typography.Text>
        ) : null}
        {!isLoading && !historyError && sessions.length === 0 ? (
          <Typography.Text type="secondary" className="sidebar-history-panel-status">
            {t('sidebar.emptySessionsTitle')}
          </Typography.Text>
        ) : null}
        {sessions.map((entry) => (
          <HistoryPanelRow key={entry.sessionId} entry={entry} onOpen={onOpenSession} onDelete={onDeleteSession} />
        ))}
        {isLoading ? (
          <Typography.Text type="secondary" className="sidebar-history-panel-status">
            {t('sidebar.loadingSessions')}
          </Typography.Text>
        ) : null}
      </div>
    </div>
  );
}

function HistoryPanelRow({
  entry,
  onOpen,
  onDelete,
}: {
  readonly entry: SessionHistoryEntry;
  readonly onOpen: (sessionId: string) => void;
  readonly onDelete: (entry: SessionHistoryEntry) => void;
}) {
  const { t } = useTranslation();
  const [hovered, setHovered] = useState(false);

  return (
    <div
      role="button"
      tabIndex={0}
      className={`sidebar-history-panel-row${hovered ? ' sidebar-history-panel-row--hovered' : ''}`}
      data-testid={`sidebar-history-row-${entry.sessionId}`}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={() => onOpen(entry.sessionId)}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onOpen(entry.sessionId);
        }
      }}
    >
      <Typography.Text ellipsis className="sidebar-history-panel-row-title">
        {entry.displayTitle}
      </Typography.Text>
      <button
        type="button"
        className="sidebar-history-panel-delete"
        aria-label={t('sidebar.deleteSession')}
        onClick={(event) => {
          event.stopPropagation();
          onDelete(entry);
        }}
      >
        <TrashBinIcon />
      </button>
    </div>
  );
}

function TrashBinIcon() {
  return (
    <svg
      className="sidebar-history-panel-delete-icon"
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path className="sidebar-history-panel-delete-icon-lid" d="M2 6h20" />
      <path className="sidebar-history-panel-delete-icon-handle" d="M8.5 6V4a2 2 0 0 1 2-2h3a2 2 0 0 1 2 2v2" />
      <path className="sidebar-history-panel-delete-icon-can" d="M20 6l-1 14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2L4 6" />
      <path className="sidebar-history-panel-delete-icon-line" d="M9.5 11v6" />
      <path className="sidebar-history-panel-delete-icon-line" d="M14.5 11v6" />
    </svg>
  );
}
