import { useCallback, useContext, useEffect, useRef, useState } from 'react';
import { HashRouter, Routes, Route, useLocation, useNavigate } from 'react-router-dom';
import { AppProviders, useAppHostContext } from './AppProviders.tsx';
import { runtimeConfig } from '../config/runtimeConfig.ts';
import { ChatWorkspace } from './ChatWorkspace.tsx';
import { SharedConversationPage } from '../pages/SharedConversationPage.tsx';
import { MemoryManagePage } from '../pages/MemoryManagePage.tsx';
import { ComplaintHistoryPage } from '../features/complaint/components/ComplaintHistoryView.tsx';
import { KnowledgeImportPage } from '../features/knowledge/components/KnowledgeImportView.tsx';
import { FavoriteTurnsPanel } from '../features/favorites/components/FavoriteTurnsPanel.tsx';
import { useComplaintFeatureStore } from '../state/complaintFeatureStore.ts';
import { useNonLocalAuthRedirect } from './NonLocalAuth.tsx';
import { Sidebar } from '../features/sidebar/components/Sidebar.tsx';
import { useUserOps } from '../features/auth/useUserOps.ts';
import { PermissionUnavailable } from '../features/auth/PermissionUnavailable.tsx';
import { SessionActivityConnectionController } from '../features/session-activity/SessionActivityConnectionController.tsx';
import { CommandHelpModal } from '../features/composer/components/CommandHelpModal.tsx';
import { useAICOConfigSnapshot } from '../aico-config/useAICOConfig.ts';
import { OperatorsArea } from '../aico-config/OperatorsArea.tsx';
import { CustomPanelRenderer, useIsCustomPanelActive } from '../aico-config/CustomPanelRenderer.tsx';
import { useIconWithFallback } from '../aico-config/iconUtils.ts';
import logoSvg from '../assets/logo.svg';
import favoritesLightSvg from '../assets/icons/favorites-light.svg';
import favoritesDarkSvg from '../assets/icons/favorites-dark.svg';
import memoryLightSvg from '../assets/icons/memory-light.svg';
import memoryDarkSvg from '../assets/icons/memory-dark.svg';
import knowledgeLightSvg from '../assets/icons/knowledge-light.svg';
import knowledgeDarkSvg from '../assets/icons/knowledge-dark.svg';
import complaintLightSvg from '../assets/icons/complaint-light.svg';
import complaintDarkSvg from '../assets/icons/complaint-dark.svg';
import newSessionLightSvg from '../assets/icons/new-session-light.svg';
import newSessionDarkSvg from '../assets/icons/new-session-dark.svg';
import { App as AntdApp, Button, Tooltip, Typography } from 'antd';
import { useTranslation } from 'react-i18next';
import { SearchOutlined, HistoryOutlined } from '@ant-design/icons';
import { SessionHistorySearchDialog } from '../features/sidebar/components/SessionHistorySearchDialog.tsx';
import { useSessionStore } from '../state/sessionStore.ts';
import { useConversationStore } from '../state/conversationStore.ts';
import { useSessionActivityStore } from '../state/sessionActivityStore.ts';
import { SessionActivityTrailingSlot } from '../features/session-activity/SessionActivityTrailingSlot.tsx';
import { SESSION_HISTORY_PAGE_LIMIT } from '../state/sessionStore.ts';
import type { SessionHistoryEntry } from '../state/contracts.ts';
import type { HostSiteContext } from './hostTypes.ts';
import { useShellFeedbackTop } from './useShellFeedbackTop.ts';
import { PiuContext } from '../features/chat/context/PiuContext.tsx';
import { expandPanelStore } from '../features/expand-panel/ExpandPanelStore.ts';
import {
  FAVORITES_MAIN_CONTENT_PATH,
  MEMORY_MAIN_CONTENT_PATH,
  COMPLAINT_MAIN_CONTENT_PATH,
  KNOWLEDGE_MAIN_CONTENT_PATH,
  buildHashRouteTarget,
  createTransientMainContentState,
  resolveRoutedMainContentView,
  resolveTransientMainContentView,
  type TransientMainContentView,
} from './mainContentRoutes.ts';

export function ImmersiveApp({ site }: { readonly site: HostSiteContext }) {
  useNonLocalAuthRedirect();
  const [isCommandHelpOpen, setIsCommandHelpOpen] = useState(false);
  const openCommandHelp = useCallback(() => setIsCommandHelpOpen(true), []);
  const closeCommandHelp = useCallback(() => setIsCommandHelpOpen(false), []);

  return (
    <AppProviders mode="immersive" site={site}>
      <>
        <ImmersiveContent onOpenHelp={openCommandHelp} />
        <CommandHelpModal open={isCommandHelpOpen} onClose={closeCommandHelp} />
      </>
    </AppProviders>
  );
}

function ImmersiveContent({ onOpenHelp }: { readonly onOpenHelp: () => void }) {
  const userOps = useUserOps();
  const { hostTheme } = useAppHostContext();
  const aicoSnapshot = useAICOConfigSnapshot();
  const isCustomPanel = useIsCustomPanelActive();
  const isDark = hostTheme === 'evening';

  const { piu } = useContext(PiuContext);
  useEffect(() => {
    if (!piu) {
      return undefined;
    }
    expandPanelStore.getState().registerDslClearHandler(() => {
      piu.emit('smart-canvas:clearExpandPanel');
    });
    return () => {
      expandPanelStore.getState().registerDslClearHandler(null);
    };
  }, [piu]);

  if (userOps !== null && userOps.length === 0) {
    return <PermissionUnavailable />;
  }

  const operatorPosition = aicoSnapshot.config?.layoutConfig?.operatorPosition ?? 'LEFT';
  const useRightLayout = operatorPosition === 'RIGHT';
  const displayName = aicoSnapshot.config?.name ?? 'NextAgent';
  const iconSrc = aicoSnapshot.config?.icon ?? undefined;

  const renderConversationArea = (isConversationSurfaceVisible: boolean) =>
    isCustomPanel ? (
      <CustomPanelRenderer isDark={isDark} />
    ) : (
      <ChatWorkspace onOpenHelp={onOpenHelp} isConversationSurfaceVisible={isConversationSurfaceVisible} />
    );

  if (useRightLayout) {
    return (
      <HashRouter>
        <Routes>
          <Route path="/shared/:shareId" element={<SharedConversationPage />} />
          <Route
            path="*"
            element={
              <ImmersiveMainSurface>
                <ImmersiveRightLayout
                  name={displayName}
                  {...(iconSrc !== undefined ? { iconSrc } : {})}
                  isDark={isDark}
                  isCustomPanel={isCustomPanel}
                  renderConversationArea={renderConversationArea}
                />
              </ImmersiveMainSurface>
            }
          />
        </Routes>
      </HashRouter>
    );
  }

  return (
    <HashRouter>
      <Routes>
        <Route path="/shared/:shareId" element={<SharedConversationPage />} />
        <Route
          path="*"
          element={
            <ImmersiveMainSurface>
              <ImmersiveLeftLayout isCustomPanel={isCustomPanel} renderConversationArea={renderConversationArea} onOpenHelp={onOpenHelp} />
            </ImmersiveMainSurface>
          }
        />
      </Routes>
    </HashRouter>
  );
}

function ImmersiveMainSurface({ children }: { readonly children: React.ReactNode }) {
  return (
    <>
      <SessionActivityConnectionController />
      {children}
    </>
  );
}

type ShellContentView = 'conversation' | 'favorites' | 'memory' | 'knowledge' | 'complaint';
type RightPanelView = ShellContentView | 'history';

function ImmersiveLeftLayout({
  isCustomPanel,
  renderConversationArea,
  onOpenHelp,
}: {
  readonly isCustomPanel: boolean;
  readonly renderConversationArea: (isConversationSurfaceVisible: boolean) => React.ReactNode;
  readonly onOpenHelp: () => void;
}) {
  const navigate = useNavigate();
  const location = useLocation();
  const routedContentView = resolveRoutedMainContentView(location.pathname);
  const contentView: ShellContentView = routedContentView ?? 'conversation';
  const contentRef = useRef<HTMLElement | null>(null);
  const feedbackTop = useShellFeedbackTop(contentRef);

  const openFavorite = useCallback(
    (sessionId: string, rootMessageId: string) => {
      navigate(`/session/${encodeURIComponent(sessionId)}?messageId=${encodeURIComponent(rootMessageId)}`);
    },
    [navigate],
  );

  const selectRoutedContent = useCallback(
    (pathname: string) => {
      navigate(pathname, { replace: location.pathname === pathname });
    },
    [location.pathname, navigate],
  );

  const isConversationRoute = location.pathname === '/' || /^\/session\/[^/]+$/.test(location.pathname);
  const isConversationSurfaceVisible = contentView === 'conversation' && isConversationRoute && !isCustomPanel;

  return (
    <AntdApp component={false} message={{ top: feedbackTop }}>
      <div
        data-testid="immersive-shell"
        style={{
          boxSizing: 'border-box',
          display: 'flex',
          height: '100%',
          minHeight: 0,
          overflow: 'hidden',
          width: '100%',
        }}
      >
        <Sidebar
          onOpenHelp={onOpenHelp}
          showLocalControls={false}
          onSelectFavorites={() => selectRoutedContent(FAVORITES_MAIN_CONTENT_PATH)}
          favoritesActive={contentView === 'favorites'}
          onSelectMemoryManagement={() => selectRoutedContent(MEMORY_MAIN_CONTENT_PATH)}
          memoryManagementActive={contentView === 'memory'}
          onSelectKnowledgeImport={() => selectRoutedContent(KNOWLEDGE_MAIN_CONTENT_PATH)}
          knowledgeImportActive={contentView === 'knowledge'}
          onSelectComplaintHistory={() => selectRoutedContent(COMPLAINT_MAIN_CONTENT_PATH)}
          complaintHistoryActive={contentView === 'complaint'}
          isConversationSurfaceVisible={isConversationSurfaceVisible}
        />
        <main ref={contentRef} data-testid="immersive-main-content" style={{ flex: 1, minWidth: 0, minHeight: 0, overflow: 'hidden' }}>
          {contentView === 'favorites' ? (
            <FavoriteTurnsPanel onOpenFavorite={openFavorite} />
          ) : contentView === 'memory' ? (
            <MemoryManagePage />
          ) : contentView === 'knowledge' ? (
            <KnowledgeImportPage />
          ) : contentView === 'complaint' ? (
            <ComplaintHistoryPage />
          ) : (
            renderConversationArea(isConversationSurfaceVisible)
          )}
        </main>
      </div>
    </AntdApp>
  );
}

function ImmersiveRightLayout({
  name,
  iconSrc,
  isDark,
  isCustomPanel,
  renderConversationArea,
}: {
  readonly name: string;
  readonly iconSrc?: string;
  readonly isDark: boolean;
  readonly isCustomPanel: boolean;
  readonly renderConversationArea: (isConversationSurfaceVisible: boolean) => React.ReactNode;
}) {
  const navigate = useNavigate();
  const location = useLocation();
  const { t } = useTranslation();
  const { src: imgSrc, onError } = useIconWithFallback(iconSrc, logoSvg, 'immersive-top-bar-icon');
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const previousConversationRouteRef = useRef('/');
  const routedPanelView = resolveRoutedMainContentView(location.pathname);
  const transientPanelView = resolveTransientMainContentView(location.state);
  const panelView: RightPanelView = routedPanelView ?? transientPanelView ?? 'conversation';
  const sessions = useSessionStore((state) => state.sessions);
  const loadSessions = useSessionStore((state) => state.loadSessions);
  const clearConversation = useConversationStore((state) => state.clearConversation);
  const activeSessionId = useSessionStore((state) => state.activeSessionId);
  const contentRef = useRef<HTMLElement | null>(null);
  const feedbackTop = useShellFeedbackTop(contentRef);
  const complaintEnabled = useComplaintFeatureStore((s) => s.enabled);
  const isConversationSurfaceVisible = panelView === 'conversation' && !isCustomPanel;
  const memoryManagementVisible = runtimeConfig.portalAbilityConfig?.longTermMemoryManagementEnabled ?? true;
  const knowledgeImportVisible = runtimeConfig.portalAbilityConfig?.knowledgeImportEnabled ?? true;

  const navigateToSession = useCallback(
    (sessionId: string) => {
      navigate(`/session/${encodeURIComponent(sessionId)}`);
    },
    [navigate],
  );

  const navigateToFavoriteTurn = useCallback(
    (sessionId: string, rootMessageId: string) => {
      navigate(`/session/${encodeURIComponent(sessionId)}?messageId=${encodeURIComponent(rootMessageId)}`);
    },
    [navigate],
  );

  useEffect(() => {
    if (panelView === 'history') {
      void loadSessions({ limit: SESSION_HISTORY_PAGE_LIMIT });
    }
  }, [panelView, loadSessions]);

  useEffect(() => {
    if (routedPanelView === null) {
      previousConversationRouteRef.current = buildHashRouteTarget(location.pathname, location.search);
    }
  }, [location.pathname, location.search, routedPanelView]);

  const selectRoutedPanel = useCallback(
    (pathname: string) => {
      navigate(pathname, { replace: location.pathname === pathname });
    },
    [location.pathname, navigate],
  );

  const selectTransientPanel = useCallback(
    (view: TransientMainContentView) => {
      navigate(previousConversationRouteRef.current, {
        state: createTransientMainContentState(view),
        replace: transientPanelView === view,
      });
    },
    [navigate, transientPanelView],
  );

  const handleNewSession = () => {
    navigate('/');
  };

  return (
    <AntdApp component={false} message={{ top: feedbackTop }}>
      <div
        data-testid="immersive-shell"
        style={{ boxSizing: 'border-box', display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, overflow: 'hidden', width: '100%' }}
      >
        {!isCustomPanel ? (
          <header
            data-testid="immersive-top-bar"
            style={{
              height: 54,
              padding: '0 16px',
              flexShrink: 0,
              boxSizing: 'border-box',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              borderBottom: '1px solid var(--color-border)',
            }}
          >
            <img src={imgSrc} alt="" aria-hidden="true" onError={onError} style={{ width: 28, height: 28, display: 'block', flexShrink: 0 }} />
            <span
              className="notranslate"
              translate="no"
              style={{ fontWeight: 800, fontSize: 16, whiteSpace: 'nowrap', color: 'var(--color-text-primary)' }}
            >
              {name}
            </span>
            <div style={{ flex: 1 }} />
            <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
              <Tooltip title={t('sidebar.newSession')}>
                <Button
                  type="text"
                  size="small"
                  aria-label={t('sidebar.newSession')}
                  icon={
                    <img
                      src={isDark ? newSessionDarkSvg : newSessionLightSvg}
                      alt=""
                      aria-hidden="true"
                      style={{ width: 20, height: 20, display: 'block', pointerEvents: 'none' }}
                    />
                  }
                  onClick={handleNewSession}
                />
              </Tooltip>
              <Tooltip title={t('sidebar.recentSessions')}>
                <Button
                  type={panelView === 'history' ? 'primary' : 'text'}
                  size="small"
                  aria-label={t('sidebar.recentSessions')}
                  aria-pressed={panelView === 'history'}
                  icon={<HistoryOutlined />}
                  onClick={() => selectTransientPanel('history')}
                />
              </Tooltip>
              <Tooltip title={t('favorites.title')}>
                <Button
                  type={panelView === 'favorites' ? 'primary' : 'text'}
                  size="small"
                  aria-label={t('favorites.title')}
                  aria-pressed={panelView === 'favorites'}
                  icon={
                    <img
                      src={isDark ? favoritesDarkSvg : favoritesLightSvg}
                      alt=""
                      aria-hidden="true"
                      style={{ width: 16, height: 16, display: 'block' }}
                    />
                  }
                  onClick={() => selectRoutedPanel(FAVORITES_MAIN_CONTENT_PATH)}
                />
              </Tooltip>
              <Tooltip title={t('sidebar.search')}>
                <Button type="text" size="small" aria-label={t('sidebar.search')} icon={<SearchOutlined />} onClick={() => setIsSearchOpen(true)} />
              </Tooltip>
              {memoryManagementVisible ? (
                <Tooltip title={t('memoryManagement.title')}>
                  <Button
                    type={panelView === 'memory' ? 'primary' : 'text'}
                    size="small"
                    aria-label={t('memoryManagement.title')}
                    aria-pressed={panelView === 'memory'}
                    icon={
                      <img
                        src={isDark ? memoryDarkSvg : memoryLightSvg}
                        alt=""
                        aria-hidden="true"
                        style={{ width: 16, height: 16, display: 'block' }}
                      />
                    }
                    onClick={() => selectRoutedPanel(MEMORY_MAIN_CONTENT_PATH)}
                  />
                </Tooltip>
              ) : null}
              {knowledgeImportVisible ? (
                <Tooltip title={t('knowledge.importTitle')}>
                  <Button
                    type={panelView === 'knowledge' ? 'primary' : 'text'}
                    size="small"
                    aria-label={t('knowledge.importTitle')}
                    aria-pressed={panelView === 'knowledge'}
                    icon={
                      <img
                        src={isDark ? knowledgeDarkSvg : knowledgeLightSvg}
                        alt=""
                        aria-hidden="true"
                        style={{ width: 16, height: 16, display: 'block' }}
                      />
                    }
                    onClick={() => selectRoutedPanel(KNOWLEDGE_MAIN_CONTENT_PATH)}
                  />
                </Tooltip>
              ) : null}
              {complaintEnabled ? (
                <Tooltip title={t('complaint.historyTitle')}>
                  <Button
                    type={panelView === 'complaint' ? 'primary' : 'text'}
                    size="small"
                    aria-label={t('complaint.historyTitle')}
                    aria-pressed={panelView === 'complaint'}
                    icon={
                      <img
                        src={isDark ? complaintDarkSvg : complaintLightSvg}
                        alt=""
                        aria-hidden="true"
                        style={{ width: 16, height: 16, display: 'block' }}
                      />
                    }
                    onClick={() => selectRoutedPanel(COMPLAINT_MAIN_CONTENT_PATH)}
                  />
                </Tooltip>
              ) : null}
              <OperatorsArea isDark={isDark} variant="header" />
            </div>
          </header>
        ) : null}
        <main
          ref={contentRef}
          data-testid="immersive-main-content"
          style={{ flex: 1, minWidth: 0, minHeight: 0, overflow: 'hidden', position: 'relative' }}
        >
          {panelView === 'memory' ? (
            <MemoryManagePage />
          ) : panelView === 'knowledge' ? (
            <KnowledgeImportPage />
          ) : panelView === 'complaint' ? (
            <ComplaintHistoryPage />
          ) : panelView === 'favorites' && !isCustomPanel ? (
            <FavoriteTurnsPanel onOpenFavorite={navigateToFavoriteTurn} />
          ) : panelView !== 'history' ? (
            <div style={{ width: '100%', height: '100%' }}>{renderConversationArea(isConversationSurfaceVisible)}</div>
          ) : null}
          {panelView === 'history' && !isCustomPanel ? (
            <CardList
              items={sessions.map((s) => ({ id: s.sessionId, title: s.displayTitle, activitySessionId: s.sessionId }))}
              onSelect={navigateToSession}
              emptyText={t('sidebar.emptySessionsTitle')}
              activeSessionId={activeSessionId}
              isConversationSurfaceVisible={false}
            />
          ) : null}
        </main>
        <SessionHistorySearchDialog
          open={isSearchOpen}
          activeSessionId={activeSessionId ?? null}
          hasWritePermission
          onClose={() => setIsSearchOpen(false)}
          onOpenSession={navigateToSession}
          onDeletedSession={(sessionId) => {
            clearConversation(sessionId);
            if (activeSessionId === sessionId) {
              navigate('/', { replace: true });
            }
          }}
        />
      </div>
    </AntdApp>
  );
}

interface CardItem {
  readonly id: string;
  readonly title: string;
  readonly sessionId?: string;
  readonly rootMessageId?: string;
  readonly activitySessionId?: string;
}

function CardList({
  items,
  onSelect,
  emptyText,
  activeSessionId,
  isConversationSurfaceVisible,
}: {
  readonly items: readonly CardItem[];
  readonly onSelect: (id: string) => void;
  readonly emptyText: string;
  readonly activeSessionId?: string | null;
  readonly isConversationSurfaceVisible?: boolean;
}) {
  if (items.length === 0) {
    return (
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100%',
          color: 'var(--color-text-secondary, #667085)',
          fontSize: 14,
        }}
      >
        {emptyText}
      </div>
    );
  }
  return (
    <div style={{ position: 'absolute', inset: 0, overflowY: 'auto', padding: '16px', background: 'var(--color-bg-primary, #fff)' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, maxWidth: 880, margin: '0 auto' }}>
        {items.map((item) => (
          <CardListRow
            key={item.id}
            item={item}
            activeSessionId={activeSessionId}
            isConversationSurfaceVisible={isConversationSurfaceVisible ?? false}
            onSelect={onSelect}
          />
        ))}
      </div>
    </div>
  );
}

function CardListRow({
  item,
  activeSessionId,
  isConversationSurfaceVisible,
  onSelect,
}: {
  readonly item: CardItem;
  readonly activeSessionId: string | null | undefined;
  readonly isConversationSurfaceVisible: boolean;
  readonly onSelect: (id: string) => void;
}) {
  const activity = useSessionActivityStore((state) => (item.activitySessionId ? state.entriesBySessionId[item.activitySessionId] : undefined));
  return (
    <div
      role="button"
      tabIndex={0}
      data-testid={`card-item-${item.id}`}
      onClick={() => onSelect(item.id)}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onSelect(item.id);
        }
      }}
      style={{
        height: 48,
        borderRadius: 8,
        border: '1px solid var(--color-border, #e5e7eb)',
        padding: '0 16px',
        cursor: 'pointer',
        background: 'var(--color-bg-secondary, #f9fafb)',
        display: 'flex',
        alignItems: 'center',
        gap: 8,
      }}
    >
      <Typography.Text ellipsis style={{ flex: 1, minWidth: 0, fontSize: 14, lineHeight: 1.5 }}>
        {item.title}
      </Typography.Text>
      {item.activitySessionId ? (
        <SessionActivityTrailingSlot
          sessionId={item.activitySessionId}
          activity={activity}
          isActivitySuppressed={item.activitySessionId === activeSessionId && isConversationSurfaceVisible}
          supportsActions={false}
          isActionVisible={false}
        />
      ) : null}
    </div>
  );
}
