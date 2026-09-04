import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type PointerEvent as ReactPointerEvent, type UIEvent } from 'react';
import { ColumnWidthOutlined, DeleteOutlined, PushpinOutlined } from '@ant-design/icons';
import { Button, message, Popover, Tooltip, Typography } from 'antd';
import { Modal } from 'antd';
import type { MenuProps } from 'antd';
import { Dropdown } from 'antd';
import { useTranslation } from 'react-i18next';
import { AppProviders } from '../app/AppProviders.tsx';
import { runtimeConfig } from '../config/runtimeConfig.ts';
import logoSvg from '../assets/logo.svg';
import newSessionLightSvg from '../assets/icons/new-session-light.svg';
import newSessionDarkSvg from '../assets/icons/new-session-dark.svg';
import historyLightSvg from '../assets/icons/history-light.svg';
import historyDarkSvg from '../assets/icons/history-dark.svg';
import memoryLightSvg from '../assets/icons/memory-light.svg';
import memoryDarkSvg from '../assets/icons/memory-dark.svg';
import knowledgeLightSvg from '../assets/icons/knowledge-light.svg';
import knowledgeDarkSvg from '../assets/icons/knowledge-dark.svg';
import expandLightSvg from '../assets/icons/expand-light.svg';
import expandDarkSvg from '../assets/icons/expand-dark.svg';
import exitFullscreenLightSvg from '../assets/icons/exit-fullscreen-light.svg';
import exitFullscreenDarkSvg from '../assets/icons/exit-fullscreen-dark.svg';
import closeLightSvg from '../assets/icons/close-light.svg';
import closeDarkSvg from '../assets/icons/close-dark.svg';
import complaintLightSvg from '../assets/icons/complaint-light.svg';
import complaintDarkSvg from '../assets/icons/complaint-dark.svg';
import cronLightSvg from '../assets/icons/cron-light.svg';
import cronDarkSvg from '../assets/icons/cron-dark.svg';
import favoritesLightSvg from '../assets/icons/favorites-light.svg';
import favoritesDarkSvg from '../assets/icons/favorites-dark.svg';
import moreLightSvg from '../assets/icons/more-light.svg';
import moreDarkSvg from '../assets/icons/more-dark.svg';
import { SendIcon } from '../assets/icons/SendIcon.tsx';
import { useNonLocalAuthRedirect } from '../app/NonLocalAuth.tsx';
import { AICOServiceOperation } from '../features/auth/authEnums.ts';
import { useUserOps } from '../features/auth/useUserOps.ts';
import { PermissionUnavailable } from '../features/auth/PermissionUnavailable.tsx';
import { SessionActivityConnectionController } from '../features/session-activity/SessionActivityConnectionController.tsx';
import { CommandHelpModal } from '../features/composer/components/CommandHelpModal.tsx';
import { PIU_HISTORY_INITIAL_LIMIT, SESSION_HISTORY_PAGE_LIMIT, hasSessionHistorySearchQuery, useSessionStore } from '../state/sessionStore.ts';
import { useConversationStore } from '../state/conversationStore.ts';
import { useSessionActivityStore } from '../state/sessionActivityStore.ts';
import { ChatPageCore, type ChatComposerBridge } from '../pages/ChatPage.tsx';
import type { ChatNavigationAdapter } from '../features/chat/chatNavigation.ts';
import { SessionHistorySearchControls } from '../features/sidebar/components/SessionHistorySearchControls.tsx';
import { SessionDeleteConfirmModal } from '../features/sidebar/components/SessionDeleteConfirmModal.tsx';
import { SessionActivityTrailingSlot } from '../features/session-activity/SessionActivityTrailingSlot.tsx';
import { isApiError } from '../services/apiClient.ts';
import { aiAgentPiuRuntimeStore } from './runtimeStore.ts';
import { expandPanelStore } from '../features/expand-panel/ExpandPanelStore.ts';
import { ExpandPanel } from '../features/expand-panel/ExpandPanel.tsx';
import { PiuContext, type PiuContextValue } from '../features/chat/context/PiuContext.tsx';
import { useAICOConfig } from '../aico-config/useAICOConfig.ts';
import { useIconWithFallback } from '../aico-config/iconUtils.ts';
import { OperatorsArea } from '../aico-config/OperatorsArea.tsx';
import { useAICOConfigSnapshot } from '../aico-config/useAICOConfig.ts';
import { aicoConfigStore } from '../aico-config/AICOConfigStore.ts';
import { resolveIconSrc } from '../aico-config/iconUtils.ts';
import type { Operator } from '../aico-config/types.ts';
import { ComplaintHistoryPage, ComplaintHistoryView } from '../features/complaint/components/ComplaintHistoryView.tsx';
import { KnowledgeImportPage } from '../features/knowledge/components/KnowledgeImportView.tsx';
import { FavoriteTurnsPanel } from '../features/favorites/components/FavoriteTurnsPanel.tsx';
import { useComplaintFeatureStore } from '../state/complaintFeatureStore.ts';
import { MemoryManagePage } from '../pages/MemoryManagePage.tsx';
import { CronTaskDashboardPage } from '../pages/CronTaskDashboardPage.tsx';
import { MemoryRouter } from 'react-router-dom';
import { CustomPanelRenderer, useIsCustomPanelActive } from '../aico-config/CustomPanelRenderer.tsx';
import {
  DOCKED_DEFAULT_WIDTH,
  PREL_MENU_HEIGHT,
  readViewportSize,
  resizeDockedWidth,
  type CollaborativePanelLayout,
  type DockedSide,
  type FloatingResizeDirection,
} from './layout.ts';
import './AIAgentPiuRuntime.css';
import { historicalChatReplayStore } from './historicalChatReplayStore.ts';
import { HistoricalChatReplayView } from './HistoricalChatReplayView.tsx';

const MINIMIZED_PANEL_WIDTH = 360;

export function AIAgentPiuRuntime() {
  useNonLocalAuthRedirect();
  const snapshot = useSyncExternalStore(aiAgentPiuRuntimeStore.subscribe, aiAgentPiuRuntimeStore.getSnapshot, aiAgentPiuRuntimeStore.getSnapshot);
  const aicoConfig = useAICOConfig();

  const piu = snapshot.piu;
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
  const composerBridgeRef = useRef<ChatComposerBridge | null>(null);
  const [isCommandHelpOpen, setIsCommandHelpOpen] = useState(false);
  const openCommandHelp = useCallback(() => setIsCommandHelpOpen(true), []);
  const closeCommandHelp = useCallback(() => setIsCommandHelpOpen(false), []);
  const chatNavigation = useMemo<ChatNavigationAdapter>(
    () => ({
      sessionId: snapshot.activeSessionId,
      sessionTitle: snapshot.activeSessionTitle,
      openSession: (sessionId) => {
        aiAgentPiuRuntimeStore.openSession(sessionId);
      },
      openNewSession: () => {
        aiAgentPiuRuntimeStore.openNewSession();
      },
      onSessionLoadFailure: (sessionId) => {
        aiAgentPiuRuntimeStore.clearActiveSession(sessionId);
      },
    }),
    [snapshot.activeSessionId, snapshot.activeSessionTitle],
  );

  useEffect(() => {
    const pendingQuestion = snapshot.pendingQuestion;
    if (!pendingQuestion) {
      return undefined;
    }
    let isCancelled = false;
    let isSending = false;
    const sendPendingQuestion = () => {
      if (isCancelled || isSending || !composerBridgeRef.current) {
        return false;
      }
      isSending = true;
      void composerBridgeRef.current.sendQuestion(pendingQuestion).finally(() => {
        aiAgentPiuRuntimeStore.clearPendingQuestion(pendingQuestion.id);
      });
      return true;
    };

    if (sendPendingQuestion()) {
      return undefined;
    }

    const retryHandle = window.setInterval(() => {
      if (sendPendingQuestion()) {
        window.clearInterval(retryHandle);
      }
    }, 16);
    return () => {
      isCancelled = true;
      window.clearInterval(retryHandle);
    };
  }, [snapshot.pendingQuestion]);

  const panelStyle = useMemo(() => {
    const layout = snapshot.layout;
    const pp = aicoConfig?.panelPosition;
    if (snapshot.display.minimized) {
      const minimizedDefaults = {
        position: 'fixed' as const,
        bottom: 16,
        right: 16,
        width: MINIMIZED_PANEL_WIDTH,
        borderRadius: 8,
      };
      return { ...minimizedDefaults, ...aicoConfig?.minimizedStyle };
    }
    const top = pp?.top ?? PREL_MENU_HEIGHT;
    const bottom = pp?.bottom ?? 0;
    if (layout.kind === 'docked') {
      return {
        position: 'fixed' as const,
        top,
        bottom,
        width: layout.width,
        borderRadius: 0,
        ...(pp?.left !== undefined
          ? { left: pp.left }
          : pp?.right !== undefined
            ? { right: pp.right }
            : layout.side === 'left'
              ? { left: 0 }
              : { right: 0 }),
      };
    }
    if (layout.kind === 'floating') {
      return {
        position: 'fixed' as const,
        top: layout.y,
        left: layout.x,
        width: layout.width,
        height: layout.height,
        borderRadius: 8,
      };
    }
    return {
      position: 'fixed' as const,
      top,
      right: 0,
      bottom: 0,
      left: 0,
      borderRadius: 0,
    };
  }, [snapshot.layout, snapshot.display.minimized, aicoConfig?.panelPosition, aicoConfig?.minimizedStyle]);

  const expandPanelPiuWidth =
    typeof aicoConfig?.modalSize?.minWidth === 'number'
      ? aicoConfig.modalSize.minWidth
      : typeof aicoConfig?.modalSize?.width === 'number'
        ? aicoConfig.modalSize.width
        : DOCKED_DEFAULT_WIDTH;
  const panelWidth = snapshot.layout.kind === 'docked' ? snapshot.layout.width : expandPanelPiuWidth;
  const expandPanelRegionRight = Math.min(panelWidth, expandPanelPiuWidth);
  const piuContextValue: PiuContextValue = { piu: snapshot.piu, site: snapshot.site };

  return (
    <PiuContext.Provider value={piuContextValue}>
      <AppProviders mode="piu" site={snapshot.site}>
        <>
          <SessionActivityConnectionController />
          <PiuContent
            showEntrance={snapshot.display.showEntrance}
            showPanel={snapshot.display.showPanel}
            minimized={snapshot.display.minimized}
            panelStyle={panelStyle}
            layoutKind={snapshot.layout.kind}
            layoutSide={snapshot.layout.kind === 'docked' ? snapshot.layout.side : undefined}
            expandPanelPiuWidth={expandPanelPiuWidth}
            expandPanelRegionRight={expandPanelRegionRight}
            composerBridgeRef={composerBridgeRef}
            chatNavigation={chatNavigation}
            onOpenHelp={openCommandHelp}
            isDark={snapshot.site.theme === 'evening'}
          />
          <CommandHelpModal open={isCommandHelpOpen} onClose={closeCommandHelp} />
        </>
      </AppProviders>
    </PiuContext.Provider>
  );
}

function PiuContent({
  showEntrance,
  showPanel,
  minimized,
  panelStyle,
  layoutKind,
  layoutSide,
  expandPanelPiuWidth,
  expandPanelRegionRight,
  composerBridgeRef,
  chatNavigation,
  onOpenHelp,
  isDark,
}: {
  readonly showEntrance: boolean;
  readonly showPanel: boolean;
  readonly minimized: boolean;
  readonly panelStyle: React.CSSProperties;
  readonly layoutKind: string;
  readonly layoutSide: DockedSide | undefined;
  readonly expandPanelPiuWidth: number;
  readonly expandPanelRegionRight: number;
  readonly composerBridgeRef: React.RefObject<ChatComposerBridge | null>;
  readonly chatNavigation: ChatNavigationAdapter;
  readonly onOpenHelp: () => void;
  readonly isDark: boolean;
}) {
  const userOps = useUserOps();
  const hasNoPermission = userOps !== null && userOps.length === 0;
  const isCustomPanel = useIsCustomPanelActive();
  const isExpandPanelOpen = expandPanelStore((s) => s.isOpen);
  const aicoConfig = useAICOConfig();
  const panelFullWidth = typeof aicoConfig?.modalSize?.width === 'number' ? aicoConfig.modalSize.width : DOCKED_DEFAULT_WIDTH;
  const controls = aicoConfig?.controls;
  const canDrag = controls?.drag ?? true;
  const canResize = controls?.resize ?? true;
  const { t } = useTranslation();
  const complaintHistoryVisible = useComplaintFeatureStore((state) => state.enabled);
  const [complaintHistoryOpen, setComplaintHistoryOpen] = useState(false);
  const isConversationSurfaceVisible = showPanel && !minimized && !complaintHistoryOpen;
  const replayEntries = historicalChatReplayStore((state) => state.entries);

  useEffect(() => {
    if (!isExpandPanelOpen) {
      const snapshot = aiAgentPiuRuntimeStore.getSnapshot();
      if (snapshot.layout.kind === 'docked' && snapshot.layout.width !== panelFullWidth) {
        aiAgentPiuRuntimeStore.setDocked(panelFullWidth);
      }
      return;
    }
    const snapshot = aiAgentPiuRuntimeStore.getSnapshot();
    if (snapshot.layout.kind === 'floating' || snapshot.layout.kind === 'maximized') {
      aiAgentPiuRuntimeStore.setDocked(expandPanelPiuWidth);
    } else if (snapshot.layout.kind === 'docked' && snapshot.layout.width !== expandPanelPiuWidth) {
      aiAgentPiuRuntimeStore.setDocked(expandPanelPiuWidth);
    }
  }, [isExpandPanelOpen, expandPanelPiuWidth, panelFullWidth]);

  const expandPanelStyle = useMemo(() => {
    const pp = aicoConfig?.panelPosition;
    const expandTop = pp?.top ?? PREL_MENU_HEIGHT;
    const expandBottom = pp?.bottom ?? 0;
    const panelOnLeft = pp?.left !== undefined || (pp?.right === undefined && layoutSide === 'left');
    return {
      position: 'fixed' as const,
      top: expandTop,
      bottom: expandBottom,
      ...(panelOnLeft
        ? { left: expandPanelRegionRight + (typeof pp?.left === 'number' ? pp.left : 0), right: 0 }
        : { left: 0, right: expandPanelRegionRight + (typeof pp?.right === 'number' ? pp.right : 0) }),
      overflow: 'hidden' as const,
      zIndex: 998,
    };
  }, [aicoConfig?.panelPosition, layoutSide, expandPanelRegionRight]);
  return (
    <>
      {showEntrance ? <AIAgentEntrance /> : null}
      {isExpandPanelOpen && !minimized ? (
        <div data-testid="ai-agent-expand-panel-region" style={expandPanelStyle}>
          <div style={{ width: '100%', height: '100%' }}>
            <ExpandPanel />
          </div>
        </div>
      ) : null}
      <section
        data-testid="ai-agent-piu-panel"
        className={`ai-agent-piu-panel${minimized ? ' minimized' : ''}`}
        style={{
          ...panelStyle,
          display: showPanel ? 'flex' : 'none',
        }}
      >
        {layoutKind === 'docked' && canResize ? <PiuDockedResizeHandle side={layoutSide ?? 'right'} /> : null}
        {layoutKind === 'floating' && canResize ? <PiuFloatingResizeHandles /> : null}

        <div className="ai-agent-piu-body">
          {hasNoPermission ? (
            <PermissionUnavailable />
          ) : isCustomPanel ? (
            <CustomPanelRenderer isDark={isDark} />
          ) : (
            <ChatPageCore
              onOpenHelp={onOpenHelp}
              composerBridgeRef={composerBridgeRef}
              navigation={chatNavigation}
              headerSlot={
                <PiuPanelHeader
                  isConversationSurfaceVisible={isConversationSurfaceVisible}
                  complaintHistoryVisible={complaintHistoryVisible}
                  onOpenFavorites={() => {
                    expandPanelStore.getState().setView(
                      <FavoriteTurnsPanel
                        onOpenFavorite={(sessionId) => {
                          aiAgentPiuRuntimeStore.openSession(sessionId);
                          expandPanelStore.getState().close();
                        }}
                      />,
                    );
                    expandPanelStore.getState().open();
                  }}
                  onOpenComplaintHistory={() => setComplaintHistoryOpen(true)}
                />
              }
              isConversationSurfaceVisible={isConversationSurfaceVisible}
              aboveMessagesSlot={replayEntries.size > 0 ? <HistoricalChatReplayView /> : undefined}
            />
          )}
        </div>
        {minimized ? <MinimizedInputBox /> : null}
      </section>
      <Modal
        title={t('complaint.historyTitle')}
        open={complaintHistoryOpen}
        onCancel={() => setComplaintHistoryOpen(false)}
        footer={null}
        destroyOnHidden
        width={800}
      >
        {complaintHistoryOpen ? (
          <div style={{ height: 500, overflow: 'auto' }}>
            <ComplaintHistoryView />
          </div>
        ) : null}
      </Modal>
    </>
  );
}

function MinimizedInputBox() {
  const { t } = useTranslation();
  return (
    <div className="ai-agent-piu-minimized-box">
      <textarea
        data-testid="ai-agent-piu-minimized-input"
        className="ai-agent-piu-minimized-input"
        placeholder={t('composer.placeholder')}
        onFocus={() => aiAgentPiuRuntimeStore.restoreFromMinimized()}
        rows={1}
      />
      <span className="ai-agent-piu-minimized-send" aria-hidden="true">
        <SendIcon />
      </span>
    </div>
  );
}

function AIAgentEntrance() {
  const aicoConfig = useAICOConfig();
  const { src: resolvedIcon, onError } = useIconWithFallback(aicoConfig?.entranceIcon, logoSvg, 'ai-agent-entrance');
  return (
    <Tooltip title={aicoConfig?.name ?? 'NextAgent'}>
      <button
        type="button"
        className="ai-agent-piu-entrance"
        data-testid="ai-agent-piu-entrance"
        aria-label={aicoConfig?.name ?? 'NextAgent'}
        style={aicoConfig?.entranceStyle}
        onClick={() => aiAgentPiuRuntimeStore.openPanel()}
      >
        <img className="ai-agent-piu-logo" src={resolvedIcon} alt="" aria-hidden="true" onError={onError} />
      </button>
    </Tooltip>
  );
}

function PiuDockedResizeHandle({ side }: { readonly side: DockedSide }) {
  const snapshot = useSyncExternalStore(aiAgentPiuRuntimeStore.subscribe, aiAgentPiuRuntimeStore.getSnapshot, aiAgentPiuRuntimeStore.getSnapshot);
  const aicoConfig = useAICOConfig();
  const minWidth = typeof aicoConfig?.modalSize?.minWidth === 'number' ? aicoConfig.modalSize.minWidth : undefined;
  const resizeStateRef = useRef<{
    readonly x: number;
    readonly width: number;
    readonly side: DockedSide;
    readonly pointerId: number;
    readonly captureTarget: HTMLElement;
  } | null>(null);
  const [isResizing, setIsResizing] = useState(false);

  const handleGlobalPointerMove = useCallback(
    (event: PointerEvent) => {
      const resizeState = resizeStateRef.current;
      if (!resizeState) {
        return;
      }
      aiAgentPiuRuntimeStore.resizeDocked(
        resizeDockedWidth(resizeState.side, resizeState.width, resizeState.x, event.clientX, readViewportSize(), minWidth),
        readViewportSize(),
      );
    },
    [minWidth],
  );

  const stopResize = useCallback(() => {
    const state = resizeStateRef.current;
    resizeStateRef.current = null;
    setIsResizing(false);
    if (state) {
      releasePointerCaptureSafely(state.captureTarget, state.pointerId);
    }
    window.removeEventListener('pointermove', handleGlobalPointerMove);
    window.removeEventListener('pointerup', stopResize);
    window.removeEventListener('pointercancel', stopResize);
  }, [handleGlobalPointerMove]);

  const startResize = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (event.button !== 0 || snapshot.layout.kind !== 'docked') {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      resizeStateRef.current = {
        x: event.clientX,
        width: snapshot.layout.width,
        side: snapshot.layout.side,
        pointerId: event.pointerId,
        captureTarget: event.currentTarget,
      };
      setPointerCaptureSafely(event.currentTarget, event.pointerId);
      setIsResizing(true);
      window.addEventListener('pointermove', handleGlobalPointerMove);
      window.addEventListener('pointerup', stopResize);
      window.addEventListener('pointercancel', stopResize);
    },
    [handleGlobalPointerMove, snapshot.layout, stopResize],
  );

  useEffect(() => stopResize, [stopResize]);

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={side === 'right' ? 'Resize from left edge' : 'Resize from right edge'}
      className={`ai-agent-piu-docked-resize ai-agent-piu-docked-resize-${side}${isResizing ? ' ai-agent-piu-resizing' : ''}`}
      data-testid="ai-agent-piu-docked-resize"
      data-side={side}
      onPointerDown={startResize}
    >
      <span className={`ai-agent-piu-resize-line ai-agent-piu-resize-line-${side === 'right' ? 'left' : 'right'}`} />
    </div>
  );
}

const FLOATING_RESIZE_DIRECTIONS: readonly FloatingResizeDirection[] = [
  'top',
  'right',
  'bottom',
  'left',
  'top-left',
  'top-right',
  'bottom-right',
  'bottom-left',
];

const PIU_HEADER_INTERACTIVE_TARGET_SELECTOR = [
  'button',
  'input',
  'textarea',
  'select',
  'a[href]',
  "[contenteditable='true']",
  "[role='button']",
  "[role='textbox']",
  "[role='searchbox']",
  "[role='combobox']",
  '.ant-input',
  '.ant-picker',
  '.ant-picker-dropdown',
  '.ant-popover',
  '.ant-dropdown',
  '.ant-select',
  "[data-testid='operators-area']",
  "[data-testid='operator-modal']",
].join(',');

function shouldStartPiuHeaderDrag(event: ReactPointerEvent<HTMLElement>): boolean {
  if (event.button !== 0) {
    return false;
  }
  const target = event.target;
  return !(target instanceof Element) || !target.closest(PIU_HEADER_INTERACTIVE_TARGET_SELECTOR);
}

function setPointerCaptureSafely(element: HTMLElement, pointerId: number): void {
  try {
    element.setPointerCapture?.(pointerId);
  } catch {
    // Capturing is best-effort; window-level move/up listeners still complete the gesture.
  }
}

function releasePointerCaptureSafely(element: HTMLElement, pointerId: number): void {
  try {
    element.releasePointerCapture?.(pointerId);
  } catch {
    // The pointer may already be released by the browser.
  }
}

function PiuFloatingResizeHandles() {
  const snapshot = useSyncExternalStore(aiAgentPiuRuntimeStore.subscribe, aiAgentPiuRuntimeStore.getSnapshot, aiAgentPiuRuntimeStore.getSnapshot);
  const resizeStateRef = useRef<{
    readonly x: number;
    readonly y: number;
    readonly direction: FloatingResizeDirection;
    readonly layout: Extract<CollaborativePanelLayout, { kind: 'floating' }>;
    readonly pointerId: number;
    readonly captureTarget: HTMLElement;
  } | null>(null);
  const [activeDirection, setActiveDirection] = useState<FloatingResizeDirection | null>(null);
  const [hoverDirection, setHoverDirection] = useState<FloatingResizeDirection | null>(null);

  const handleGlobalPointerMove = useCallback((event: PointerEvent) => {
    const resizeState = resizeStateRef.current;
    if (!resizeState) {
      return;
    }
    aiAgentPiuRuntimeStore.resizeFloating(
      resizeState.layout,
      resizeState.direction,
      event.clientX - resizeState.x,
      event.clientY - resizeState.y,
      readViewportSize(),
    );
  }, []);

  const stopResize = useCallback(() => {
    const state = resizeStateRef.current;
    resizeStateRef.current = null;
    setActiveDirection(null);
    if (state) {
      releasePointerCaptureSafely(state.captureTarget, state.pointerId);
    }
    window.removeEventListener('pointermove', handleGlobalPointerMove);
    window.removeEventListener('pointerup', stopResize);
    window.removeEventListener('pointercancel', stopResize);
  }, [handleGlobalPointerMove]);

  const startResize = useCallback(
    (direction: FloatingResizeDirection) => (event: ReactPointerEvent<HTMLDivElement>) => {
      if (event.button !== 0 || snapshot.layout.kind !== 'floating') {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      resizeStateRef.current = {
        x: event.clientX,
        y: event.clientY,
        direction,
        layout: snapshot.layout,
        pointerId: event.pointerId,
        captureTarget: event.currentTarget,
      };
      setPointerCaptureSafely(event.currentTarget, event.pointerId);
      setActiveDirection(direction);
      window.addEventListener('pointermove', handleGlobalPointerMove);
      window.addEventListener('pointerup', stopResize);
      window.addEventListener('pointercancel', stopResize);
    },
    [handleGlobalPointerMove, snapshot.layout, stopResize],
  );

  useEffect(() => stopResize, [stopResize]);

  return (
    <>
      {FLOATING_RESIZE_DIRECTIONS.map((direction) => (
        <div
          key={direction}
          role="separator"
          aria-label={`Resize ${direction}`}
          aria-orientation={direction === 'top' || direction === 'bottom' ? 'horizontal' : 'vertical'}
          className={`ai-agent-piu-floating-resize ai-agent-piu-floating-resize-${direction}${
            activeDirection === direction ? ' ai-agent-piu-resizing' : ''
          }`}
          data-testid={`ai-agent-piu-floating-resize-${direction}`}
          data-direction={direction}
          onPointerEnter={() => setHoverDirection(direction)}
          onPointerLeave={() => setHoverDirection((current) => (current === direction ? null : current))}
          onPointerDown={startResize(direction)}
        />
      ))}
      <PiuResizeHighlight direction={activeDirection ?? hoverDirection} />
    </>
  );
}

function PiuResizeHighlight({ direction }: { readonly direction: FloatingResizeDirection | null }) {
  if (!direction) {
    return null;
  }
  const sides = floatingResizeHighlightSides(direction);
  return (
    <div className="ai-agent-piu-resize-highlight" data-testid="ai-agent-piu-resize-highlight">
      {sides.map((side) => (
        <span key={side} className={`ai-agent-piu-resize-line ai-agent-piu-resize-line-${side}`} data-side={side} />
      ))}
    </div>
  );
}

function floatingResizeHighlightSides(direction: FloatingResizeDirection): Array<'top' | 'right' | 'bottom' | 'left'> {
  switch (direction) {
    case 'top':
    case 'right':
    case 'bottom':
    case 'left':
      return [direction];
    case 'top-left':
      return ['top', 'left'];
    case 'top-right':
      return ['top', 'right'];
    case 'bottom-right':
      return ['bottom', 'right'];
    case 'bottom-left':
      return ['bottom', 'left'];
    default: {
      const exhaustive: never = direction;
      throw new Error(`Unhandled case: ${String(exhaustive)}`);
    }
  }
}

function PiuPanelHeader({
  isConversationSurfaceVisible,
  complaintHistoryVisible,
  onOpenFavorites,
  onOpenComplaintHistory,
}: {
  readonly isConversationSurfaceVisible: boolean;
  readonly complaintHistoryVisible: boolean;
  readonly onOpenFavorites: () => void;
  readonly onOpenComplaintHistory: () => void;
}) {
  const snapshot = useSyncExternalStore(aiAgentPiuRuntimeStore.subscribe, aiAgentPiuRuntimeStore.getSnapshot, aiAgentPiuRuntimeStore.getSnapshot);
  const { t } = useTranslation();
  const aicoConfig = useAICOConfig();
  const displayName = aicoConfig?.name ?? 'NextAgent';
  const { src: resolvedIcon, onError: onIconError } = useIconWithFallback(aicoConfig?.guideIcon, logoSvg, 'piu-panel-header-icon');
  const dragStateRef = useRef<{ readonly x: number; readonly y: number; readonly pointerId: number; readonly captureTarget: HTMLElement } | null>(
    null,
  );
  const showMaximize = aicoConfig?.controls?.maximize ?? true;
  const showClose = aicoConfig?.controls?.close ?? true;
  const showDockFloat = aicoConfig?.controls?.dockFloat ?? true;
  const canDrag = aicoConfig?.controls?.drag ?? true;
  const isMaximized = snapshot.layout.kind === 'maximized';
  const isFloating = snapshot.layout.kind === 'floating';

  const handleGlobalPointerMove = useCallback((event: PointerEvent) => {
    const dragState = dragStateRef.current;
    if (dragState) {
      aiAgentPiuRuntimeStore.moveFloating(event.clientX - dragState.x, event.clientY - dragState.y, readViewportSize());
      dragStateRef.current = { ...dragState, x: event.clientX, y: event.clientY };
      return;
    }
  }, []);

  const stopDrag = useCallback(() => {
    const state = dragStateRef.current;
    dragStateRef.current = null;
    if (state) {
      releasePointerCaptureSafely(state.captureTarget, state.pointerId);
    }
    window.removeEventListener('pointermove', handleGlobalPointerMove);
    window.removeEventListener('pointerup', stopDrag);
    window.removeEventListener('pointercancel', stopDrag);
  }, [handleGlobalPointerMove]);

  const startHeaderDrag = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      if (!shouldStartPiuHeaderDrag(event)) {
        return;
      }
      event.preventDefault();
      const captureTarget = event.currentTarget;
      if (snapshot.layout.kind !== 'floating') {
        aiAgentPiuRuntimeStore.enterFloating(readViewportSize());
      }
      dragStateRef.current = { x: event.clientX, y: event.clientY, pointerId: event.pointerId, captureTarget };
      setPointerCaptureSafely(captureTarget, event.pointerId);
      window.addEventListener('pointermove', handleGlobalPointerMove);
      window.addEventListener('pointerup', stopDrag);
      window.addEventListener('pointercancel', stopDrag);
    },
    [handleGlobalPointerMove, snapshot.layout.kind, stopDrag],
  );

  useEffect(() => stopDrag, [stopDrag]);

  return (
    <header className="ai-agent-piu-panel-header" onPointerDown={canDrag ? startHeaderDrag : undefined}>
      <img src={resolvedIcon} alt="" aria-hidden="true" onError={onIconError} style={{ width: 32, height: 32, display: 'block', flexShrink: 0 }} />
      <span className="ai-agent-piu-title">{displayName}</span>
      <div className="ai-agent-piu-actions">
        <NewSessionButton />
        <HistoryButton activeSessionId={snapshot.activeSessionId} isConversationSurfaceVisible={isConversationSurfaceVisible} />
        {showMaximize ? (
          <Tooltip title={isMaximized ? t('sidebar.sidebarMode') : t('sidebar.fullscreenMode')}>
            <Button
              type="text"
              aria-label={isMaximized ? t('sidebar.sidebarMode') : t('sidebar.fullscreenMode')}
              icon={
                <img
                  src={
                    snapshot.site.theme === 'evening'
                      ? isMaximized
                        ? exitFullscreenDarkSvg
                        : expandDarkSvg
                      : isMaximized
                        ? exitFullscreenLightSvg
                        : expandLightSvg
                  }
                  alt=""
                  style={{ width: 20, height: 20, display: 'block', pointerEvents: 'none' }}
                />
              }
              style={{ width: 32, height: 32, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', padding: 0 }}
              onClick={() => (isMaximized ? aiAgentPiuRuntimeStore.restore() : aiAgentPiuRuntimeStore.maximize())}
            />
          </Tooltip>
        ) : null}
        <OperatorsArea isDark={snapshot.site.theme === 'evening'} variant="header" showInnerMenu={false} />
        <MoreMenuButton
          isDark={snapshot.site.theme === 'evening'}
          onFavoritesClick={onOpenFavorites}
          onMemoryClick={() => {
            expandPanelStore.getState().setView(<MemoryManagePage />);
            expandPanelStore.getState().open();
          }}
          onKnowledgeImportClick={() => {
            expandPanelStore.getState().setView(<KnowledgeImportPage />);
            expandPanelStore.getState().open();
          }}
          onComplaintClick={() => {
            expandPanelStore.getState().setView(<ComplaintHistoryPage />);
            expandPanelStore.getState().open();
          }}
          showDockFloat={showDockFloat}
          complaintVisible={complaintHistoryVisible}
          isFloating={isFloating}
          onToggleDockFloat={() =>
            isFloating ? aiAgentPiuRuntimeStore.setDocked(DOCKED_DEFAULT_WIDTH) : aiAgentPiuRuntimeStore.enterFloating(readViewportSize())
          }
          onCronTaskClick={() => {
            expandPanelStore.getState().setView(
              <MemoryRouter>
                <CronTaskDashboardPage
                  onCreateFromSession={() => {
                    expandPanelStore.getState().close();
                    aiAgentPiuRuntimeStore.openNewSession();
                  }}
                />
              </MemoryRouter>,
            );
            expandPanelStore.getState().open();
          }}
        />
        {showClose ? (
          <Tooltip title="Close">
            <Button
              type="text"
              aria-label="Close"
              icon={
                <img
                  src={snapshot.site.theme === 'evening' ? closeDarkSvg : closeLightSvg}
                  alt=""
                  style={{ width: 20, height: 20, display: 'block', pointerEvents: 'none' }}
                />
              }
              style={{ width: 32, height: 32, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', padding: 0 }}
              onClick={() => aiAgentPiuRuntimeStore.closePanel()}
            />
          </Tooltip>
        ) : null}
      </div>
    </header>
  );
}

function NewSessionButton() {
  const isDark = useSyncExternalStore(aiAgentPiuRuntimeStore.subscribe, aiAgentPiuRuntimeStore.getSnapshot).site.theme === 'evening';
  const { t } = useTranslation();
  return (
    <Tooltip title={t('sidebar.newSession')}>
      <Button
        type="text"
        aria-label={t('sidebar.newSession')}
        onClick={() => aiAgentPiuRuntimeStore.openNewSession()}
        style={{ width: 32, height: 32, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', padding: 0 }}
        icon={
          <img
            src={isDark ? newSessionDarkSvg : newSessionLightSvg}
            alt=""
            style={{ width: 20, height: 20, display: 'block', pointerEvents: 'none' }}
          />
        }
      />
    </Tooltip>
  );
}

interface MoreMenuButtonProps {
  readonly isDark: boolean;
  readonly onFavoritesClick: () => void;
  readonly onMemoryClick: () => void;
  readonly onKnowledgeImportClick: () => void;
  readonly onComplaintClick: () => void;
  readonly complaintVisible: boolean;
  readonly isFloating: boolean;
  readonly showDockFloat: boolean;
  readonly onToggleDockFloat: () => void;
  readonly onCronTaskClick: () => void;
}

function MoreMenuButton({
  isDark,
  onFavoritesClick,
  onMemoryClick,
  onKnowledgeImportClick,
  onComplaintClick,
  complaintVisible,
  isFloating,
  showDockFloat,
  onToggleDockFloat,
  onCronTaskClick,
}: MoreMenuButtonProps) {
  const { t, i18n } = useTranslation();
  const snapshot = useAICOConfigSnapshot();
  const operators = snapshot.config?.operators ?? [];
  const innerOperators = operators.filter((op) => op.position === 'INNER');
  const isZh = i18n.language === 'zh-CN';
  const moreRef = useRef<HTMLButtonElement | null>(null);
  const memoryVisible = runtimeConfig.portalAbilityConfig?.longTermMemoryManagementEnabled ?? true;
  const knowledgeImportVisible = runtimeConfig.portalAbilityConfig?.knowledgeImportEnabled ?? true;
  const cronTasksVisible = runtimeConfig.portalAbilityConfig?.cronTasksEnabled ?? true;

  const menuItemLabel = (text: string) => (
    <Tooltip title={text} placement="right">
      <span>{text}</span>
    </Tooltip>
  );

  const handleOperatorClick = useCallback((operator: Operator, el: HTMLElement | null) => {
    if (operator.type === 'MODAL') {
      aicoConfigStore.setActiveModalOperator(operator);
    } else if (operator.type === 'PANEL') {
      aicoConfigStore.setActivePanelOperator(operator.data);
    }
  }, []);

  const menuItems: MenuProps['items'] = [
    ...innerOperators.map((operator) => ({
      key: operator.enName,
      label: menuItemLabel(isZh ? operator.zhName : operator.enName),
      icon: (
        <img
          src={resolveIconSrc(isDark ? operator.darkIcon : operator.lightIcon, '')}
          alt=""
          aria-hidden="true"
          style={{ width: 16, height: 16, display: 'block' }}
        />
      ),
      onClick: () => handleOperatorClick(operator, moreRef.current),
    })),
    {
      key: 'favorites',
      label: menuItemLabel(t('favorites.title')),
      icon: <img src={isDark ? favoritesDarkSvg : favoritesLightSvg} alt="" aria-hidden="true" style={{ width: 16, height: 16, display: 'block' }} />,
      onClick: onFavoritesClick,
    },
    ...(memoryVisible
      ? [
          {
            key: 'memory',
            label: menuItemLabel(t('memoryManagement.title')),
            icon: <img src={isDark ? memoryDarkSvg : memoryLightSvg} alt="" aria-hidden="true" style={{ width: 16, height: 16, display: 'block' }} />,
            onClick: onMemoryClick,
          },
        ]
      : []),
    ...(knowledgeImportVisible
      ? [
          {
            key: 'knowledge-import',
            label: menuItemLabel(t('knowledge.importTitle')),
            icon: (
              <img
                src={isDark ? knowledgeDarkSvg : knowledgeLightSvg}
                alt=""
                aria-hidden="true"
                style={{ width: 16, height: 16, display: 'block' }}
              />
            ),
            onClick: onKnowledgeImportClick,
          },
        ]
      : []),
    ...(complaintVisible
      ? [
          {
            key: 'complaint',
            label: menuItemLabel(t('complaint.historyTitle')),
            icon: (
              <img
                src={isDark ? complaintDarkSvg : complaintLightSvg}
                alt=""
                aria-hidden="true"
                style={{ width: 16, height: 16, display: 'block' }}
              />
            ),
            onClick: onComplaintClick,
          },
        ]
      : []),
    ...(cronTasksVisible
      ? [
          {
            key: 'cron-tasks',
            label: menuItemLabel(t('cronTasks.title')),
            icon: <img src={isDark ? cronDarkSvg : cronLightSvg} alt="" aria-hidden="true" style={{ width: 16, height: 16, display: 'block' }} />,
            onClick: onCronTaskClick,
          },
        ]
      : []),
    ...(showDockFloat
      ? [
          {
            key: 'toggle-dock-float',
            label: menuItemLabel(isFloating ? t('sidebar.sidebarMode') : t('sidebar.windowMode')),
            icon: isFloating ? <ColumnWidthOutlined style={{ fontSize: 16 }} /> : <PushpinOutlined style={{ fontSize: 16 }} />,
            onClick: onToggleDockFloat,
          },
        ]
      : []),
  ];
  if (menuItems.length === 0) {
    return null;
  }

  return (
    <Dropdown trigger={['click']} menu={{ items: menuItems }} overlayStyle={{ width: 180 }} overlayClassName="piu-more-dropdown">
      <Tooltip title={t('sidebar.moreFunctions')} placement="bottom">
        <Button
          ref={moreRef}
          type="text"
          aria-label={t('sidebar.moreFunctions')}
          data-testid="piu-more-menu"
          icon={<img src={isDark ? moreDarkSvg : moreLightSvg} alt="" style={{ width: 20, height: 20, display: 'block', pointerEvents: 'none' }} />}
          style={{ width: 32, height: 32, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', padding: 0 }}
        />
      </Tooltip>
    </Dropdown>
  );
}

function HistoryButton({
  activeSessionId,
  isConversationSurfaceVisible,
}: {
  readonly activeSessionId: string | null;
  readonly isConversationSurfaceVisible: boolean;
}) {
  const { t } = useTranslation();
  const sessions = useSessionStore((state) => state.sessions);
  const activityEntries = useSessionActivityStore((state) => state.entriesBySessionId);
  const hasMore = useSessionStore((state) => state.hasMore);
  const isLoadingHistory = useSessionStore((state) => state.isLoadingHistory);
  const historySearchQuery = useSessionStore((state) => state.historySearchQuery);
  const loadSessions = useSessionStore((state) => state.loadSessions);
  const loadMoreSessions = useSessionStore((state) => state.loadMoreSessions);
  const deleteSession = useSessionStore((state) => state.deleteSession);
  const clearConversation = useConversationStore((state) => state.clearConversation);
  const userOps = useUserOps();
  const hasWritePermission = userOps === null || userOps.includes(AICOServiceOperation.Write);
  const isSearchActive = hasSessionHistorySearchQuery(historySearchQuery);
  const isDark =
    useSyncExternalStore(aiAgentPiuRuntimeStore.subscribe, aiAgentPiuRuntimeStore.getSnapshot, aiAgentPiuRuntimeStore.getSnapshot).site.theme ===
    'evening';
  const pageLimit = isSearchActive ? SESSION_HISTORY_PAGE_LIMIT : PIU_HISTORY_INITIAL_LIMIT;
  const [visibleLimit, setVisibleLimit] = useState(PIU_HISTORY_INITIAL_LIMIT);
  const [deleteTarget, setDeleteTarget] = useState<{ readonly sessionId: string; readonly displayTitle: string } | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [isDeletePending, setIsDeletePending] = useState(false);
  const hasBackgroundActivity = Object.keys(activityEntries).some((sessionId) => !(isConversationSurfaceVisible && sessionId === activeSessionId));
  useEffect(() => {
    setVisibleLimit(pageLimit);
  }, [historySearchQuery.createdFrom, historySearchQuery.createdTo, historySearchQuery.q, pageLimit]);
  const loadInitialHistory = useCallback(() => {
    setVisibleLimit(PIU_HISTORY_INITIAL_LIMIT);
    void loadSessions({ limit: PIU_HISTORY_INITIAL_LIMIT, query: {} });
  }, [loadSessions]);
  const handleScroll = useCallback(
    (event: UIEvent<HTMLDivElement>) => {
      const target = event.currentTarget;
      if (isLoadingHistory || target.scrollTop + target.clientHeight < target.scrollHeight - 8) {
        return;
      }
      if (sessions.length > visibleLimit) {
        setVisibleLimit((current) => Math.min(current + pageLimit, sessions.length));
        return;
      }
      if (!hasMore) {
        return;
      }
      setVisibleLimit((current) => current + pageLimit);
      void loadMoreSessions();
    },
    [hasMore, isLoadingHistory, loadMoreSessions, pageLimit, sessions.length, visibleLimit],
  );

  const submitDelete = useCallback(async () => {
    if (!deleteTarget) {
      return;
    }
    const sessionId = deleteTarget.sessionId;
    setIsDeletePending(true);
    setDeleteError(null);
    try {
      await deleteSession(sessionId);
      clearConversation(sessionId);
      aiAgentPiuRuntimeStore.clearActiveSession(sessionId);
      setDeleteTarget(null);
      void loadSessions({
        limit: Math.max(visibleLimit, isSearchActive ? SESSION_HISTORY_PAGE_LIMIT : PIU_HISTORY_INITIAL_LIMIT),
        query: historySearchQuery,
      });
    } catch (error) {
      if (isApiError(error) && error.status === 404) {
        message.warning(t('sidebar.deleteSessionAlreadyDeleted'));
        clearConversation(sessionId);
        aiAgentPiuRuntimeStore.clearActiveSession(sessionId);
        setDeleteTarget(null);
        void loadSessions({
          limit: Math.max(visibleLimit, isSearchActive ? SESSION_HISTORY_PAGE_LIMIT : PIU_HISTORY_INITIAL_LIMIT),
          query: historySearchQuery,
        });
      } else if (isApiError(error) && error.code === 'SESSION_DELETE_CONFLICT') {
        setDeleteError(t('sidebar.deleteSessionActiveRun'));
      } else {
        setDeleteError(error instanceof Error ? error.message : t('sidebar.deleteSessionFailed'));
      }
    } finally {
      setIsDeletePending(false);
    }
  }, [clearConversation, deleteSession, deleteTarget, historySearchQuery, isSearchActive, loadSessions, t, visibleLimit]);

  const content = (
    <div style={{ width: 270 }}>
      <SessionHistorySearchControls compact />
      <div className="ai-agent-piu-history-list nextagent-trackless-scrollbar" onScroll={handleScroll} data-testid="ai-agent-piu-history-list">
        {sessions.slice(0, visibleLimit).map((entry) => (
          <PiuHistoryRow
            key={entry.sessionId}
            entry={entry}
            active={entry.sessionId === activeSessionId}
            isConversationSurfaceVisible={isConversationSurfaceVisible}
            hasWritePermission={hasWritePermission}
            deleteLabel={t('sidebar.deleteSession')}
            onOpen={() => {
              aiAgentPiuRuntimeStore.openSession(entry.sessionId, entry.displayTitle);
              setHistoryOpen(false);
            }}
            onDelete={() => {
              setDeleteTarget(entry);
              setDeleteError(null);
            }}
          />
        ))}
        {!isLoadingHistory && sessions.length === 0 ? (
          <Typography.Text type="secondary" style={{ display: 'block', padding: '8px' }}>
            {isSearchActive ? t('sessionHistory.noMatchesTitle') : t('sidebar.emptySessionsTitle')}
          </Typography.Text>
        ) : null}
        {isLoadingHistory ? (
          <Typography.Text type="secondary" style={{ display: 'block', padding: '8px' }}>
            {t('sidebar.loadingSessions')}
          </Typography.Text>
        ) : null}
      </div>
    </div>
  );

  return (
    <>
      <Popover
        trigger="click"
        placement="bottomRight"
        content={content}
        open={historyOpen}
        onOpenChange={(open) => {
          setHistoryOpen(open);
          if (open) {
            loadInitialHistory();
          }
        }}
      >
        <Tooltip title={t('sidebar.recentSessions')}>
          <Button
            type="text"
            aria-label={
              hasBackgroundActivity ? `${t('sidebar.recentSessions')}: ${t('sessionActivity.historyAttention')}` : t('sidebar.recentSessions')
            }
            data-testid="ai-agent-piu-history-trigger"
            icon={
              <span style={{ position: 'relative', display: 'flex', width: 20, height: 20 }}>
                <img
                  src={isDark ? historyDarkSvg : historyLightSvg}
                  alt=""
                  style={{ width: 20, height: 20, display: 'block', pointerEvents: 'none' }}
                />
                {hasBackgroundActivity ? (
                  <span
                    role="status"
                    aria-label={t('sessionActivity.historyAttention')}
                    data-testid="ai-agent-piu-history-activity-dot"
                    style={{
                      position: 'absolute',
                      top: -2,
                      right: -3,
                      width: 7,
                      height: 7,
                      borderRadius: '50%',
                      background: 'var(--color-primary, #1677ff)',
                    }}
                  />
                ) : null}
              </span>
            }
            style={{ width: 32, height: 32, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', padding: 0 }}
          />
        </Tooltip>
      </Popover>
      <SessionDeleteConfirmModal
        open={deleteTarget !== null}
        displayTitle={deleteTarget?.displayTitle}
        error={deleteError}
        pending={isDeletePending}
        onCancel={() => {
          if (!isDeletePending) {
            setDeleteTarget(null);
            setDeleteError(null);
          }
        }}
        onSubmit={() => void submitDelete()}
      />
    </>
  );
}

function PiuHistoryRow({
  entry,
  active,
  isConversationSurfaceVisible,
  hasWritePermission,
  deleteLabel,
  onOpen,
  onDelete,
}: {
  readonly entry: { readonly sessionId: string; readonly displayTitle: string };
  readonly active: boolean;
  readonly isConversationSurfaceVisible: boolean;
  readonly hasWritePermission: boolean;
  readonly deleteLabel: string;
  readonly onOpen: () => void;
  readonly onDelete: () => void;
}) {
  const activity = useSessionActivityStore((state) => state.entriesBySessionId[entry.sessionId]);
  const [hovered, setHovered] = useState(false);
  const [focusedWithin, setFocusedWithin] = useState(false);
  const isActionVisible = hovered || focusedWithin;
  const deleteAction = (
    <Tooltip title={deleteLabel}>
      <Button
        type="text"
        size="small"
        danger
        disabled={!hasWritePermission}
        aria-label={`${deleteLabel}: ${entry.displayTitle}`}
        icon={<DeleteOutlined />}
        onClick={onDelete}
      />
    </Tooltip>
  );

  return (
    <div
      className={`ai-agent-piu-history-row${active ? ' ai-agent-piu-history-row-active' : ''}`}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setFocusedWithin(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) {
          setFocusedWithin(false);
        }
      }}
    >
      <button type="button" className="ai-agent-piu-history-item" onClick={onOpen}>
        <Typography.Text
          ellipsis={{ tooltip: { title: entry.displayTitle, placement: 'right' } }}
          style={{ color: active ? 'var(--color-primary)' : undefined, fontWeight: active ? 600 : 400 }}
        >
          {entry.displayTitle}
        </Typography.Text>
      </button>
      <SessionActivityTrailingSlot
        sessionId={entry.sessionId}
        activity={activity}
        isActivitySuppressed={active && isConversationSurfaceVisible}
        supportsActions
        isActionVisible={isActionVisible}
        layout="INTRINSIC"
        action={deleteAction}
      />
    </div>
  );
}
