import {
  CommentOutlined,
  DownOutlined,
  DesktopOutlined,
  LogoutOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  MoonOutlined,
  QuestionCircleOutlined,
  SettingOutlined,
  SunOutlined,
  UpOutlined,
} from '@ant-design/icons';
import { Button, message, Modal, Segmented, Select, Tooltip, Typography } from 'antd';
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { shortcutRegistry } from '../../../shortcuts/shortcutRegistry.ts';
import { RECENT_SESSION_LIMIT, SESSION_HISTORY_PAGE_LIMIT, hasSessionHistorySearchQuery, useSessionStore } from '../../../state/sessionStore.ts';
import { useConversationStore } from '../../../state/conversationStore.ts';
import {
  getPreferredSessionListInitialLimit,
  readSessionListExpandedPreference,
  writeSessionListExpandedPreference,
} from '../../../state/sessionListPreference.ts';
import { getCurrentLocale, getLocalePreference, setLocalePreference, type LocalePreference } from '../../../i18n/index.ts';
import type { ThemePreference } from '../../../config/themePreference.ts';
import type { SessionHistoryEntry } from '../../../state/contracts.ts';
import { SessionHistoryEntryRow } from './SessionHistoryEntryRow.tsx';
import { SessionHistorySearchControls } from './SessionHistorySearchControls.tsx';
import { SidebarHistoryPanel } from './SidebarHistoryPanel.tsx';
import { SessionRenameModal } from './SessionRenameModal.tsx';
import { SessionDeleteConfirmModal } from './SessionDeleteConfirmModal.tsx';
import { useUserOps } from '../../../features/auth/useUserOps.ts';
import { AICOServiceOperation } from '../../../features/auth/authEnums.ts';
import { useAppHostContext } from '../../../app/AppProviders.tsx';
import { runtimeConfig } from '../../../config/runtimeConfig.ts';
import { useComplaintFeatureStore } from '../../../state/complaintFeatureStore.ts';
import { useAICOConfig } from '../../../aico-config/useAICOConfig.ts';
import { useIconWithFallback } from '../../../aico-config/iconUtils.ts';
import { OperatorsArea } from '../../../aico-config/OperatorsArea.tsx';
import { aicoConfigStore } from '../../../aico-config/AICOConfigStore.ts';
import { isApiError } from '../../../services/apiClient.ts';
import { resolveSessionRenameError } from './session-rename-error.ts';
import { AuthGate } from '../../auth/AuthGate.tsx';
import logoSvg from '../../../assets/logo.svg';
import newSessionLightSvg from '../../../assets/icons/new-session-light.svg';
import newSessionDarkSvg from '../../../assets/icons/new-session-dark.svg';
import favoritesLightSvg from '../../../assets/icons/favorites-light.svg';
import favoritesDarkSvg from '../../../assets/icons/favorites-dark.svg';
import historyLightSvg from '../../../assets/icons/history-light.svg';
import historyDarkSvg from '../../../assets/icons/history-dark.svg';
import memoryLightSvg from '../../../assets/icons/memory-light.svg';
import memoryDarkSvg from '../../../assets/icons/memory-dark.svg';
import knowledgeLightSvg from '../../../assets/icons/knowledge-light.svg';
import knowledgeDarkSvg from '../../../assets/icons/knowledge-dark.svg';
import cronLightSvg from '../../../assets/icons/cron-light.svg';
import cronDarkSvg from '../../../assets/icons/cron-dark.svg';
import complaintLightSvg from '../../../assets/icons/complaint-light.svg';
import complaintDarkSvg from '../../../assets/icons/complaint-dark.svg';

function BrandIcon() {
  const aicoConfig = useAICOConfig();
  const { src: resolvedSrc, onError } = useIconWithFallback(aicoConfig?.icon, logoSvg, 'sidebar-brand-icon');
  return (
    <img
      data-testid="sidebar-brand-icon"
      src={resolvedSrc}
      alt=""
      aria-hidden="true"
      onError={onError}
      style={{ width: 32, height: 32, display: 'block', flexShrink: 0 }}
    />
  );
}

function isMacLikePlatform(): boolean {
  if (typeof navigator === 'undefined') {
    return false;
  }
  return /mac|iphone|ipad|ipod/i.test(`${navigator.platform} ${navigator.userAgent}`);
}

function focusComposerTextarea(): void {
  if (typeof document === 'undefined') {
    return;
  }
  document.querySelector<HTMLTextAreaElement>('[data-testid="message-textarea"]')?.focus();
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  const tagName = target.tagName;
  return tagName === 'INPUT' || tagName === 'TEXTAREA' || tagName === 'SELECT' || target.isContentEditable;
}

export interface SidebarProps {
  readonly onOpenHelp: () => void;
  readonly onLogout?: (() => void | Promise<void>) | undefined;
  readonly themePreference?: ThemePreference;
  readonly onThemePreferenceChange?: ((preference: ThemePreference) => void) | undefined;
  readonly showLocalControls?: boolean | undefined;
  readonly onSelectMemoryManagement?: (() => void) | undefined;
  readonly onSelectConversation?: (() => void) | undefined;
  readonly onSelectFavorites?: (() => void) | undefined;
  readonly favoritesActive?: boolean | undefined;
  readonly memoryManagementActive?: boolean | undefined;
  readonly isConversationSurfaceVisible?: boolean | undefined;
  readonly onSelectKnowledgeImport?: (() => void) | undefined;
  readonly knowledgeImportActive?: boolean | undefined;
  readonly onSelectComplaintHistory?: (() => void) | undefined;
  readonly complaintHistoryActive?: boolean | undefined;
}

const noopContentSelection = () => {};
const NARROW_VIEWPORT_QUERY = '(max-width: 720px)';

function isNarrowViewport(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(NARROW_VIEWPORT_QUERY).matches;
}

export function Sidebar({
  onOpenHelp,
  onLogout,
  themePreference = 'system',
  onThemePreferenceChange,
  showLocalControls = true,
  onSelectMemoryManagement = noopContentSelection,
  onSelectConversation = noopContentSelection,
  onSelectFavorites = noopContentSelection,
  favoritesActive = false,
  memoryManagementActive = false,
  isConversationSurfaceVisible = true,
  onSelectKnowledgeImport = noopContentSelection,
  knowledgeImportActive = false,
  onSelectComplaintHistory = noopContentSelection,
  complaintHistoryActive = false,
}: SidebarProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const { themeMode, mode } = useAppHostContext();
  const isCronTaskDashboardVisible = runtimeConfig.portalAbilityConfig?.cronTasksEnabled ?? true;
  const isMemoryManagementVisible = mode !== 'local' && (runtimeConfig.portalAbilityConfig?.longTermMemoryManagementEnabled ?? true);
  const isKnowledgeImportVisible = mode !== 'local' && (runtimeConfig.portalAbilityConfig?.knowledgeImportEnabled ?? true);
  const complaintEnabled = useComplaintFeatureStore((s) => s.enabled);
  const isComplaintHistoryVisible = mode !== 'local' && complaintEnabled;
  const aicoConfig = useAICOConfig();
  const userOps = useUserOps();
  const hasWritePermission = userOps === null || userOps.includes(AICOServiceOperation.Write);
  const [collapsed, setCollapsed] = useState(isNarrowViewport);
  const [isToggleHovered, setIsToggleHovered] = useState(false);
  const [sessionListExpanded, setSessionListExpanded] = useState(readSessionListExpandedPreference);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [localePreference, setLocalePreferenceState] = useState<LocalePreference>(() => getLocalePreference());
  const [renameTarget, setRenameTarget] = useState<SessionHistoryEntry | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const [renameError, setRenameError] = useState<string | null>(null);
  const [isRenamePending, setIsRenamePending] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<SessionHistoryEntry | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [isDeletePending, setIsDeletePending] = useState(false);
  const [pendingScrollSessionId, setPendingScrollSessionId] = useState<string | null>(null);
  const pendingFocusNewSessionRef = useRef(false);
  const sessionListRef = useRef<HTMLDivElement | null>(null);
  const navRef = useRef<HTMLElement | null>(null);
  const historyPanelRef = useRef<HTMLDivElement | null>(null);
  const [isHistoryPanelOpen, setIsHistoryPanelOpen] = useState(false);
  const [historyPanelPosition, setHistoryPanelPosition] = useState<{ left: number; top: number } | null>(null);
  const isMacPlatform = useMemo(() => isMacLikePlatform(), []);
  const newSessionShortcutLabel = isMacPlatform ? '\u2318K' : 'Ctrl+K';
  const sessions = useSessionStore((state) => state.sessions);
  const activeSessionId = useSessionStore((state) => state.activeSessionId);
  const hasMoreSessions = useSessionStore((state) => state.hasMore);
  const isLoadingHistory = useSessionStore((state) => state.isLoadingHistory);
  const historyError = useSessionStore((state) => state.historyError);
  const loadSessions = useSessionStore((state) => state.loadSessions);

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') {
      return undefined;
    }
    const mediaQuery = window.matchMedia(NARROW_VIEWPORT_QUERY);
    const collapseOnNarrowViewport = (event: MediaQueryListEvent | MediaQueryList) => {
      if (event.matches) {
        setCollapsed(true);
      }
    };
    collapseOnNarrowViewport(mediaQuery);
    mediaQuery.addEventListener('change', collapseOnNarrowViewport);
    return () => mediaQuery.removeEventListener('change', collapseOnNarrowViewport);
  }, []);
  const loadMoreSessions = useSessionStore((state) => state.loadMoreSessions);
  const renameSession = useSessionStore((state) => state.renameSession);
  const deleteSession = useSessionStore((state) => state.deleteSession);
  const clearConversation = useConversationStore((state) => state.clearConversation);
  const setHistoryWindowLimit = useSessionStore((state) => state.setHistoryWindowLimit);
  const historySearchQuery = useSessionStore((state) => state.historySearchQuery);
  const isSearchActive = hasSessionHistorySearchQuery(historySearchQuery);
  const shouldUseScrollableSessionList = sessionListExpanded || isSearchActive;
  const visibleSessions = shouldUseScrollableSessionList ? sessions : sessions.slice(0, RECENT_SESSION_LIMIT);
  const canExpandSessions = !sessionListExpanded && (hasMoreSessions || sessions.length > RECENT_SESSION_LIMIT);
  const activeLocale = getCurrentLocale();
  const isCronTaskDashboardActive = location.pathname === '/cron-tasks';

  const handleToggle = useCallback(() => {
    setCollapsed((prev) => !prev);
  }, []);

  const handleSelectHistory = useCallback(() => {
    setIsHistoryPanelOpen((open) => !open);
  }, []);

  const renderSessionListItems = () => (
    <>
      {isLoadingHistory && sessions.length === 0 ? (
        <Typography.Text type="secondary" style={{ display: 'block', fontSize: 12, padding: '8px' }}>
          {t('sidebar.loadingSessions')}
        </Typography.Text>
      ) : null}
      {userOps?.length === 0 ? (
        <Typography.Text type="secondary" style={{ display: 'block', fontSize: 12, padding: '8px' }}>
          {t('auth.noPermissionSidebar')}
        </Typography.Text>
      ) : null}
      {historyError && sessions.length === 0 ? (
        <Typography.Text type="danger" style={{ display: 'block', fontSize: 12, padding: '8px' }}>
          {historyError}{' '}
          <Typography.Link
            onClick={() =>
              loadSessions({
                limit: sessionListExpanded ? SESSION_HISTORY_PAGE_LIMIT : RECENT_SESSION_LIMIT,
                query: {},
              })
            }
          >
            {t('common.retry')}
          </Typography.Link>
        </Typography.Text>
      ) : null}
      {!isLoadingHistory && !historyError && visibleSessions.length === 0 ? (
        <div style={{ padding: '8px', lineHeight: 1.5 }}>
          <Typography.Text style={{ display: 'block', fontSize: 12, fontWeight: 500, color: 'var(--color-text-secondary)' }}>
            {isSearchActive ? t('sessionHistory.noMatchesTitle') : t('sidebar.emptySessionsTitle')}
          </Typography.Text>
          {isSearchActive ? null : (
            <Typography.Text style={{ display: 'block', marginTop: 2, fontSize: 12, color: 'var(--color-text-tertiary)' }}>
              {t('sidebar.emptySessionsDescription')}
            </Typography.Text>
          )}
        </div>
      ) : null}
      {visibleSessions.map((entry) => (
        <SessionHistoryEntryRow
          key={entry.sessionId}
          elementId={`sidebar-session-${entry.sessionId}`}
          entry={entry}
          active={activeSessionId === entry.sessionId}
          isConversationSurfaceVisible={isConversationSurfaceVisible}
          locale={activeLocale}
          yesterdayLabel={t('sidebar.yesterday')}
          hasWritePermission={hasWritePermission}
          moreActionsLabel={t('sessionActivity.moreActions')}
          renameLabel={t('sidebar.renameSession')}
          deleteLabel={t('sidebar.deleteSession')}
          trailingLayout="INTRINSIC"
          onOpen={navigateToSession}
          onRename={beginRename}
          onDelete={beginDelete}
          dataTestId={`sidebar-session-item-${entry.sessionId}`}
        />
      ))}
    </>
  );

  useEffect(() => {
    if (!collapsed) {
      setIsHistoryPanelOpen(false);
    }
  }, [collapsed]);

  useEffect(() => {
    setIsHistoryPanelOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    if (!isHistoryPanelOpen) {
      return;
    }
    const updatePosition = () => {
      const rect = navRef.current?.getBoundingClientRect();
      if (rect) {
        setHistoryPanelPosition({ left: rect.right + 8, top: rect.top + 8 });
      }
    };
    updatePosition();
    window.addEventListener('resize', updatePosition);
    return () => window.removeEventListener('resize', updatePosition);
  }, [isHistoryPanelOpen]);

  useEffect(() => {
    if (!isHistoryPanelOpen) {
      return;
    }
    const handleMouseDown = (event: MouseEvent) => {
      const target = event.target instanceof Node ? event.target : null;
      if (!target) {
        return;
      }
      if (historyPanelRef.current?.contains(target)) {
        return;
      }
      if (target instanceof Element && target.closest('[data-testid="sidebar-history-toggle"]')) {
        return;
      }
      setIsHistoryPanelOpen(false);
    };
    document.addEventListener('mousedown', handleMouseDown);
    return () => document.removeEventListener('mousedown', handleMouseDown);
  }, [isHistoryPanelOpen]);

  const updateSessionListExpanded = useCallback(
    (expanded: boolean) => {
      setSessionListExpanded(expanded);
      const currentWindowLimit = useSessionStore.getState().historyWindowLimit;
      const nextWindowLimit = expanded ? Math.max(currentWindowLimit, SESSION_HISTORY_PAGE_LIMIT) : RECENT_SESSION_LIMIT;
      setHistoryWindowLimit(nextWindowLimit);
      writeSessionListExpandedPreference(expanded);
    },
    [setHistoryWindowLimit],
  );

  const openSettings = useCallback(() => {
    setLocalePreferenceState(getLocalePreference());
    setIsSettingsOpen(true);
  }, []);

  const openHelp = useCallback(() => {
    onOpenHelp();
  }, [onOpenHelp]);

  const closeSettings = useCallback(() => {
    setIsSettingsOpen(false);
  }, []);

  const handleLocalePreferenceChange = useCallback((nextPreference: LocalePreference) => {
    setLocalePreferenceState(nextPreference);
    void setLocalePreference(nextPreference);
  }, []);

  useEffect(() => {
    const preferredLimit = getPreferredSessionListInitialLimit();
    setHistoryWindowLimit(preferredLimit);
    if (useSessionStore.getState().isLoadingHistory) {
      return;
    }
    void loadSessions({
      limit: preferredLimit,
      query: {},
    });
  }, [loadSessions, setHistoryWindowLimit]);

  useEffect(() => {
    if (!pendingScrollSessionId) {
      return undefined;
    }
    const frameId = window.requestAnimationFrame(() => {
      document.getElementById(`sidebar-session-${pendingScrollSessionId}`)?.scrollIntoView({ block: 'nearest' });
      setPendingScrollSessionId(null);
    });
    return () => {
      window.cancelAnimationFrame(frameId);
    };
  }, [pendingScrollSessionId, sessionListExpanded, sessions]);

  const navigateToSession = useCallback(
    (sessionId: string) => {
      onSelectConversation();
      navigate(`/session/${encodeURIComponent(sessionId)}`);
    },
    [navigate, onSelectConversation],
  );

  const handleSelectFavorites = useCallback(() => {
    onSelectFavorites();
  }, [onSelectFavorites]);

  const openCronTaskDashboard = useCallback(() => {
    navigate('/cron-tasks');
  }, [navigate]);

  const handleExpandSessions = useCallback(() => {
    updateSessionListExpanded(true);
    if (hasMoreSessions && sessions.length <= RECENT_SESSION_LIMIT) {
      void loadMoreSessions();
    }
  }, [hasMoreSessions, loadMoreSessions, sessions.length, updateSessionListExpanded]);

  const handleCollapseSessions = useCallback(() => {
    updateSessionListExpanded(false);
  }, [updateSessionListExpanded]);

  const handleLoadMoreSessions = useCallback(() => {
    updateSessionListExpanded(true);
    void loadMoreSessions();
  }, [loadMoreSessions, updateSessionListExpanded]);

  const beginRename = useCallback((entry: SessionHistoryEntry) => {
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
      await renameSession(renameTarget.sessionId, nextTitle);
      setRenameTarget(null);
      setRenameDraft('');
    } catch (error) {
      setRenameError(resolveSessionRenameError(error, t));
    } finally {
      setIsRenamePending(false);
    }
  }, [renameDraft, renameSession, renameTarget]);

  const beginDelete = useCallback((entry: SessionHistoryEntry) => {
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
    const wasActive = activeSessionId === sessionId;
    setIsDeletePending(true);
    setDeleteError(null);
    try {
      await deleteSession(sessionId);
      clearConversation(sessionId);
      if (wasActive) {
        onSelectConversation();
        navigate('/', { replace: true });
      }
      setDeleteTarget(null);
    } catch (error) {
      if (isApiError(error) && error.status === 404) {
        message.warning(t('sidebar.deleteSessionAlreadyDeleted'));
        clearConversation(sessionId);
        if (wasActive) {
          onSelectConversation();
          navigate('/', { replace: true });
        }
        setDeleteTarget(null);
        void loadSessions({
          limit: Math.max(useSessionStore.getState().historyWindowLimit, useSessionStore.getState().historyOffset, RECENT_SESSION_LIMIT),
          query: useSessionStore.getState().historySearchQuery,
        });
      } else if (isApiError(error) && error.code === 'SESSION_DELETE_CONFLICT') {
        setDeleteError(t('sidebar.deleteSessionActiveRun'));
      } else {
        setDeleteError(error instanceof Error ? error.message : t('sidebar.deleteSessionFailed'));
      }
    } finally {
      setIsDeletePending(false);
    }
  }, [activeSessionId, clearConversation, deleteSession, deleteTarget, loadSessions, navigate, onSelectConversation, t]);

  const navigateBySessionOffset = useCallback(
    async (direction: 1 | -1) => {
      if (isLoadingHistory) {
        return;
      }
      const state = useSessionStore.getState();
      let loadedSessions = state.sessions;
      if (loadedSessions.length === 0) {
        return;
      }
      const currentIndex = state.activeSessionId ? loadedSessions.findIndex((entry) => entry.sessionId === state.activeSessionId) : -1;
      let targetIndex = currentIndex >= 0 ? currentIndex + direction : direction > 0 ? 0 : -1;
      if (targetIndex < 0) {
        return;
      }

      if (targetIndex >= loadedSessions.length && direction > 0 && state.hasMore) {
        setCollapsed(false);
        updateSessionListExpanded(true);
        await state.loadMoreSessions();
        loadedSessions = useSessionStore.getState().sessions;
      }

      if (targetIndex >= loadedSessions.length) {
        return;
      }

      const target = loadedSessions[targetIndex];
      if (!target) {
        return;
      }
      if (targetIndex >= RECENT_SESSION_LIMIT) {
        setCollapsed(false);
        updateSessionListExpanded(true);
      }
      navigateToSession(target.sessionId);
      setPendingScrollSessionId(target.sessionId);
    },
    [isLoadingHistory, navigateToSession, updateSessionListExpanded],
  );

  useEffect(() => {
    if (!pendingFocusNewSessionRef.current || location.pathname !== '/') {
      return undefined;
    }
    pendingFocusNewSessionRef.current = false;
    const timer = window.setTimeout(() => {
      focusComposerTextarea();
    }, 0);
    return () => {
      window.clearTimeout(timer);
    };
  }, [location.pathname]);
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) {
        return;
      }
      const shortcut = shortcutRegistry.resolve(event, { scope: 'global' });
      if (!shortcut) {
        return;
      }
      if (shortcut.actionId === 'session-prev' || shortcut.actionId === 'session-next') {
        if (isEditableTarget(event.target)) {
          return;
        }
        event.preventDefault();
        void navigateBySessionOffset(shortcut.actionId === 'session-prev' ? -1 : 1);
        return;
      }
      if (shortcut.actionId !== 'focus-composer') {
        return;
      }
      event.preventDefault();
      if (location.pathname === '/') {
        focusComposerTextarea();
        return;
      }
      pendingFocusNewSessionRef.current = true;
      onSelectConversation();
      navigate('/');
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [location.pathname, navigate, navigateBySessionOffset, onSelectConversation]);

  return (
    <>
      <nav
        ref={navRef}
        aria-label={t('sidebar.mainNavigation')}
        style={{
          width: collapsed ? 48 : 250,
          minWidth: collapsed ? 48 : 250,
          height: '100%',
          background: 'var(--color-sidebar-bg)',
          borderRight: '1px solid var(--color-sidebar-border)',
          display: 'flex',
          flexDirection: 'column',
          transition: 'width 200ms ease, min-width 200ms ease',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            height: 48,
            marginTop: 12,
            width: '100%',
            boxSizing: 'border-box',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'flex-start',
            padding: 8,
            gap: 8,
            flexShrink: 0,
            position: 'relative',
          }}
        >
          <BrandIcon />
          {!collapsed && (
            <span
              className="notranslate"
              data-testid="sidebar-brand-text"
              translate="no"
              style={{
                fontFamily: '"HarmonyOS Sans SC"',
                fontStyle: 'normal',
                fontSize: 18,
                fontWeight: 700,
                lineHeight: '26px',
                letterSpacing: 0,
                textAlign: 'left',
                whiteSpace: 'nowrap',
                display: 'inline-block',
                color: 'var(--color-text-primary)',
              }}
            >
              {aicoConfig?.name ?? 'NextAgent'}
            </span>
          )}
        </div>

        <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
          <AuthGate requiredOps={[AICOServiceOperation.Write]}>
            <NavButton
              icon={
                <img src={themeMode === 'dark' ? newSessionDarkSvg : newSessionLightSvg} alt="" style={{ width: 20, height: 20, display: 'block' }} />
              }
              label={t('sidebar.newSession')}
              shortcut={newSessionShortcutLabel}
              shortcutTestId="sidebar-new-session-shortcut"
              collapsed={collapsed}
              active={false}
              onClick={() => {
                aicoConfigStore.setActivePanelOperator(null);
                onSelectConversation();
                navigate('/');
              }}
            />
          </AuthGate>
          {isCronTaskDashboardVisible ? (
            <NavButton
              icon={
                <img
                  src={themeMode === 'dark' ? cronDarkSvg : cronLightSvg}
                  alt=""
                  aria-hidden="true"
                  style={{ width: 20, height: 20, display: 'block' }}
                />
              }
              label={t('cronTasks.title')}
              collapsed={collapsed}
              active={!isHistoryPanelOpen && isCronTaskDashboardActive}
              onClick={openCronTaskDashboard}
              aria-current={!isHistoryPanelOpen && isCronTaskDashboardActive ? 'page' : undefined}
            />
          ) : null}
          <NavButton
            icon={
              <img
                src={themeMode === 'dark' ? favoritesDarkSvg : favoritesLightSvg}
                alt=""
                aria-hidden="true"
                style={{ width: 20, height: 20, display: 'block' }}
              />
            }
            label={t('favorites.title')}
            collapsed={collapsed}
            active={!isHistoryPanelOpen && favoritesActive}
            aria-current={!isHistoryPanelOpen && favoritesActive ? 'page' : undefined}
            onClick={handleSelectFavorites}
          />
          {isMemoryManagementVisible ? (
            <NavButton
              icon={
                <img
                  src={themeMode === 'dark' ? memoryDarkSvg : memoryLightSvg}
                  alt=""
                  aria-hidden="true"
                  style={{ width: 20, height: 20, display: 'block' }}
                />
              }
              label={t('memoryManagement.title')}
              collapsed={collapsed}
              active={!isHistoryPanelOpen && memoryManagementActive}
              aria-current={!isHistoryPanelOpen && memoryManagementActive ? 'page' : undefined}
              onClick={onSelectMemoryManagement}
            />
          ) : null}
          {isKnowledgeImportVisible ? (
            <NavButton
              icon={
                <img
                  src={themeMode === 'dark' ? knowledgeDarkSvg : knowledgeLightSvg}
                  alt=""
                  aria-hidden="true"
                  style={{ width: 20, height: 20, display: 'block' }}
                />
              }
              label={t('knowledge.importTitle')}
              collapsed={collapsed}
              active={knowledgeImportActive}
              aria-current={knowledgeImportActive ? 'page' : undefined}
              onClick={onSelectKnowledgeImport}
            />
          ) : null}
          {isComplaintHistoryVisible ? (
            <NavButton
              icon={
                <img
                  src={themeMode === 'dark' ? complaintDarkSvg : complaintLightSvg}
                  alt=""
                  aria-hidden="true"
                  style={{ width: 20, height: 20, display: 'block' }}
                />
              }
              label={t('complaint.historyTitle')}
              collapsed={collapsed}
              active={!isHistoryPanelOpen && complaintHistoryActive}
              aria-current={!isHistoryPanelOpen && complaintHistoryActive ? 'page' : undefined}
              onClick={onSelectComplaintHistory}
            />
          ) : null}
          <OperatorsArea isDark={themeMode === 'dark'} collapsed={collapsed} variant="sidebar" />
          {collapsed ? (
            <div style={{ position: 'relative', width: '100%', flexShrink: 0 }}>
              <div
                aria-hidden="true"
                data-testid="sidebar-history-divider"
                style={{
                  position: 'absolute',
                  top: 1,
                  left: '50%',
                  transform: 'translateX(-50%)',
                  width: 20,
                  height: 1,
                  border: `1px solid ${themeMode === 'dark' ? 'rgba(243, 243, 243, 0.15)' : 'rgba(233, 233, 233, 1)'}`,
                  pointerEvents: 'none',
                }}
              />
              <NavButton
                icon={
                  <img
                    src={themeMode === 'dark' ? historyDarkSvg : historyLightSvg}
                    alt=""
                    aria-hidden="true"
                    style={{ width: 20, height: 20, display: 'block' }}
                  />
                }
                label={t('sidebar.recentSessions')}
                collapsed
                active={isHistoryPanelOpen}
                onClick={handleSelectHistory}
                aria-current={isHistoryPanelOpen ? 'page' : undefined}
                data-testid="sidebar-history-toggle"
              />
            </div>
          ) : null}
          {!collapsed ? (
            <div
              aria-hidden="true"
              style={{
                margin: '0 14px',
                borderTop: '1px solid var(--color-sidebar-divider)',
                flexShrink: 0,
              }}
            />
          ) : null}
          {!collapsed ? (
            <section
              aria-label={t('sidebar.recentSessions')}
              data-testid="sidebar-session-list"
              style={{
                marginTop: 0,
                minHeight: 0,
                flex: shouldUseScrollableSessionList ? '1 1 0' : '0 0 auto',
                display: 'flex',
                flexDirection: 'column',
              }}
            >
              <div
                style={{
                  height: 48,
                  padding: '6px 14px',
                  boxSizing: 'border-box',
                  flexShrink: 0,
                  fontFamily: '"HarmonyOS Sans SC"',
                  fontSize: 14,
                  fontWeight: 400,
                  lineHeight: '32px',
                  color: 'var(--color-text-secondary)',
                }}
              >
                {t('sidebar.recentSessions')}
              </div>
              <div style={{ padding: '0 14px' }}>
                <SessionHistorySearchControls compact />
              </div>
              <div
                ref={sessionListRef}
                data-testid="sidebar-session-list-scroll"
                className="sidebar-session-list-scroll nextagent-themed-scrollbar"
                style={{
                  minHeight: 0,
                  flex: shouldUseScrollableSessionList ? '0 1 auto' : undefined,
                  background: 'var(--color-bg-primary)',
                  overflowY: shouldUseScrollableSessionList ? 'auto' : 'visible',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 2,
                }}
              >
                {renderSessionListItems()}
              </div>
              <div
                data-testid="sidebar-session-list-controls"
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 4,
                  alignItems: 'stretch',
                  paddingTop: visibleSessions.length > 0 ? 6 : 0,
                  flexShrink: 0,
                  fontSize: 12,
                }}
              >
                {sessionListExpanded && hasMoreSessions ? (
                  <button
                    type="button"
                    className="sidebar-session-list-load-more"
                    onClick={handleLoadMoreSessions}
                    disabled={isLoadingHistory}
                    aria-busy={isLoadingHistory ? 'true' : undefined}
                  >
                    {isLoadingHistory ? t('sidebar.loadingSessions') : t('sidebar.loadMoreSessions')}
                  </button>
                ) : null}
                {canExpandSessions ? (
                  <button type="button" className="sidebar-session-list-toggle" onClick={handleExpandSessions}>
                    <span className="sidebar-session-list-toggle-icon">
                      <DownOutlined />
                    </span>
                    <span className="sidebar-session-list-toggle-text">{t('sidebar.expandSessions')}</span>
                  </button>
                ) : null}
                {sessionListExpanded && (sessions.length > RECENT_SESSION_LIMIT || hasMoreSessions) ? (
                  <button type="button" className="sidebar-session-list-toggle" onClick={handleCollapseSessions}>
                    <span className="sidebar-session-list-toggle-icon">
                      <UpOutlined />
                    </span>
                    <span className="sidebar-session-list-toggle-text">{t('sidebar.collapseSessions')}</span>
                  </button>
                ) : null}
              </div>
            </section>
          ) : null}
          <div style={{ flex: !collapsed && shouldUseScrollableSessionList ? 0 : 1 }} />
          {showLocalControls ? (
            <>
              <NavButton icon={<SettingOutlined />} label={t('sidebar.settings')} collapsed={collapsed} active={false} onClick={openSettings} />
              <NavButton icon={<QuestionCircleOutlined />} label={t('sidebar.help')} collapsed={collapsed} active={false} onClick={openHelp} />
            </>
          ) : null}
          {showLocalControls && onLogout ? (
            <NavButton icon={<LogoutOutlined />} label={t('sidebar.signOut')} collapsed={collapsed} active={false} onClick={() => void onLogout()} />
          ) : null}
        </div>

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

        {showLocalControls ? (
          <Modal title={t('settings.title')} open={isSettingsOpen} onCancel={closeSettings} footer={null} destroyOnHidden>
            <label htmlFor="settings-language-select" style={{ display: 'block', fontSize: 13, fontWeight: 500, marginBottom: 8 }}>
              {t('settings.language')}
            </label>
            <Select<LocalePreference>
              id="settings-language-select"
              value={localePreference}
              onChange={handleLocalePreferenceChange}
              style={{ width: '100%' }}
              options={[
                { value: 'system', label: t('settings.followBrowser') },
                { value: 'zh-CN', label: t('settings.simplifiedChinese') },
                { value: 'en-US', label: t('settings.english') },
              ]}
            />
            <div style={{ marginTop: 20 }}>
              <div style={{ display: 'block', fontSize: 13, fontWeight: 500, marginBottom: 4 }}>{t('settings.theme')}</div>
              <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 10, fontSize: 13, lineHeight: 1.5 }}>
                {t('settings.themeDescription')}
              </Typography.Text>
              <Segmented<ThemePreference>
                block
                value={themePreference}
                onChange={(nextPreference) => onThemePreferenceChange?.(nextPreference)}
                options={[
                  {
                    value: 'light',
                    label: (
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                        <SunOutlined />
                        {t('settings.themeLight')}
                      </span>
                    ),
                  },
                  {
                    value: 'dark',
                    label: (
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                        <MoonOutlined />
                        {t('settings.themeDark')}
                      </span>
                    ),
                  },
                  {
                    value: 'system',
                    label: (
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                        <DesktopOutlined />
                        {t('settings.themeSystem')}
                      </span>
                    ),
                  },
                ]}
              />
            </div>
          </Modal>
        ) : null}

        <Tooltip rootClassName="app-common-tooltip" title={collapsed ? t('sidebar.expand') : t('sidebar.collapse')} placement="right">
          <Button
            type="text"
            className={collapsed ? 'sidebar-nav-button sidebar-nav-button-collapsed' : 'sidebar-nav-button'}
            icon={
              <span
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: 20,
                  height: 20,
                  flexShrink: 0,
                  fontSize: 20,
                  lineHeight: 0,
                }}
              >
                {collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
              </span>
            }
            onClick={handleToggle}
            onMouseEnter={() => setIsToggleHovered(true)}
            onMouseLeave={() => setIsToggleHovered(false)}
            onFocus={() => setIsToggleHovered(true)}
            onBlur={() => setIsToggleHovered(false)}
            aria-label={collapsed ? t('sidebar.expandSidebar') : t('sidebar.collapseSidebar')}
            style={{
              width: '100%',
              height: 48,
              justifyContent: collapsed ? 'center' : 'flex-start',
              padding: collapsed ? undefined : '12px 16px 12px 14px',
              backgroundColor: isToggleHovered ? 'var(--color-nav-button-hover)' : 'transparent',
              border: 'none',
              borderRadius: 0,
              color: undefined,
              fontWeight: 400,
              opacity: 1,
            }}
          />
        </Tooltip>
      </nav>
      {isHistoryPanelOpen && historyPanelPosition
        ? createPortal(
            <SidebarHistoryPanel
              panelRef={historyPanelRef}
              position={historyPanelPosition}
              onOpenSession={navigateToSession}
              onDeleteSession={beginDelete}
            />,
            document.body,
          )
        : null}
    </>
  );
}

interface NavButtonProps {
  icon: ReactNode;
  label: string;
  shortcut?: string;
  shortcutTestId?: string;
  collapsed: boolean;
  active: boolean;
  onClick: () => void;
  disabled?: boolean | undefined;
  'aria-current'?: 'page' | undefined;
  'data-testid'?: string | undefined;
}

function NavButton({
  icon,
  label,
  shortcut,
  shortcutTestId,
  collapsed,
  active,
  onClick,
  disabled,
  'aria-current': ariaCurrent,
  'data-testid': dataTestId,
}: NavButtonProps) {
  const [hovered, setHovered] = useState(false);
  const isActive = !disabled && active;
  const isHovered = !disabled && !active && hovered;
  return (
    <Tooltip rootClassName="app-common-tooltip" title={collapsed ? (shortcut ? `${label} \u00b7 ${shortcut}` : label) : undefined} placement="right">
      <Button
        type="text"
        className={collapsed ? 'sidebar-nav-button sidebar-nav-button-collapsed' : 'sidebar-nav-button'}
        icon={
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 20,
              height: 20,
              flexShrink: 0,
              fontSize: 20,
              lineHeight: 0,
            }}
          >
            {icon}
          </span>
        }
        onClick={onClick}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        onFocus={() => setHovered(true)}
        onBlur={() => setHovered(false)}
        disabled={disabled ?? false}
        aria-current={ariaCurrent}
        aria-label={label}
        data-testid={dataTestId}
        style={{
          width: '100%',
          height: 48,
          justifyContent: collapsed ? 'center' : 'flex-start',
          padding: collapsed ? undefined : '12px 16px 12px 14px',
          backgroundColor: isActive ? 'var(--color-nav-button-highlight)' : isHovered ? 'var(--color-nav-button-hover)' : 'transparent',
          border: 'none',
          borderRadius: 0,
          color: active ? 'var(--color-text-tooltip)' : undefined,
          fontWeight: active ? 600 : 400,
          opacity: disabled ? 0.5 : 1,
        }}
      >
        {!collapsed && (
          <span
            style={{
              width: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}
          >
            <span
              style={{
                fontFamily: '"HarmonyOS Sans SC"',
                fontStyle: 'normal',
                fontSize: 14,
                fontWeight: 400,
                lineHeight: '22px',
                letterSpacing: 0,
                textAlign: 'left',
              }}
            >
              {label}
            </span>
            {shortcut && (
              <Typography.Text data-testid={shortcutTestId} type="secondary" style={{ fontSize: 12, fontWeight: 400, flexShrink: 0 }}>
                {shortcut}
              </Typography.Text>
            )}
          </span>
        )}
      </Button>
    </Tooltip>
  );
}
