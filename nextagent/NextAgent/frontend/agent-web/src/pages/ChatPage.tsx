import {
  Suspense,
  lazy,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useContext,
  type KeyboardEvent as ReactKeyboardEvent,
  type MutableRefObject,
  type ReactNode,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
} from 'react';
import { ArrowDownOutlined } from '@ant-design/icons';
import { Drawer, message as antdMessage } from 'antd';
import { useTranslation } from 'react-i18next';
import { RightPaneLayout } from '../components/RightPaneLayout.tsx';
import { MessageInput } from '../features/composer/components/MessageInput.tsx';
import { QuickOperatorArea, QuickOperatorAreaSelectedChip } from '../features/composer/components/QuickOperatorArea.tsx';
import { RespondInput } from '../features/composer/components/RespondInput.tsx';
import { ComposerPanel } from '../features/composer/components/ComposerPanel.tsx';
import { WelcomeState } from '../features/welcome/components/WelcomeState.tsx';
import { MessageList } from '../features/chat/components/MessageList.tsx';
import { BackgroundTaskHeaderMonitor } from '../features/background-tasks/components/BackgroundTaskMonitorPanel.tsx';
import { ShareSettingsModal } from '../features/share/components/ShareSettingsModal.tsx';
import { ShareModeBar } from '../features/share/components/ShareModeBar.tsx';
import { useUserOps } from '../features/auth/useUserOps.ts';
import { forkTriggerAnchorKey, type AnnotationState, type ForkTriggerAnchor } from '../features/chat/components/TurnBlock.tsx';
import { annotationService } from '../services/annotationService.ts';
import {
  buildSessionHistoryProjection,
  buildSessionSettledProjection,
  overlaySessionActiveProjection,
} from '../features/chat/view-model/buildSessionProjection.ts';
import { useChatSessionStream } from '../features/chat/hooks/useChatSessionStream.ts';
import { useChatViewportController } from '../features/chat/hooks/useChatViewportController.ts';
import { useChatComposerController } from '../features/chat/hooks/useChatComposerController.ts';
import { getPreferredSessionListInitialLimit } from '../state/sessionListPreference.ts';
import {
  GRAPH_CHAT_MIN_WIDTH,
  GRAPH_DETAIL_DEFAULT_WIDTH,
  GRAPH_DETAIL_MAX_WIDTH,
  GRAPH_DETAIL_MIN_WIDTH,
  GRAPH_RESIZE_HANDLE_WIDTH,
  GRAPH_RESIZE_KEYBOARD_STEP,
  clampGraphDetailWidth,
  readContainerWidth,
  readGraphDetailMaxWidth,
  useGraphDrawerMode,
} from '../features/run-graph/graphDetailLayout.ts';
import { ErrorBoundary } from '../components/ErrorBoundary.tsx';
import { AppHostContext } from '../app/AppProviders.tsx';
import { useSessionStore } from '../state/sessionStore.ts';
import { defaultSessionRuntimeState, flattenLiveBuckets, useConversationStore, type ConversationPreviewState } from '../state/conversationStore.ts';
import { useRequestStore } from '../state/requestStore.ts';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import type {
  BackgroundTaskView,
  ConversationPreviewMarker,
  QuestionAnswerKind,
  RunProcessHistoryState,
  RunStatus,
  RuntimeActiveRunSummary,
  SessionConversationMessage,
  StreamEnvelope,
  TurnBlock,
} from '../state/contracts.ts';
import { resolveShareableRunId, toggleShareSelection, selectAllShareable } from '../features/chat/presentation/shareSelection.ts';
import { SHARE_RUN_IDS_MAX_ITEMS } from '../constants/inputLimits.ts';
import { resolveReportableRequestId } from '../features/chat/presentation/reportSelection.ts';
import { biReportService } from '../services/biReportService.ts';
import type { ReportTrigger } from '../features/chat/components/TurnBlock.tsx';
import { shortcutRegistry } from '../shortcuts/shortcutRegistry.ts';
import { useAICOConfig } from '../aico-config/useAICOConfig.ts';
import { DOCKED_DEFAULT_WIDTH } from '../piu/layout.ts';
import { ExpandPanel } from '../features/expand-panel/ExpandPanel.tsx';
import { expandPanelStore } from '../features/expand-panel/ExpandPanelStore.ts';
import { useExpandPanelStreamWatcher } from '../features/expand-panel/useExpandPanelStreamWatcher.ts';
import { useUserInputStore } from '../state/userInputStore.ts';
import { useBackgroundTaskStore } from '../state/backgroundTaskStore.ts';
import { useSessionActivityStore } from '../state/sessionActivityStore.ts';
import { requestService } from '../services/requestService.ts';
import { sessionService } from '../services/sessionService.ts';
import { sessionActivityService } from '../services/sessionActivityService.ts';
import { isApiError } from '../services/apiClient.ts';
import type { ChatNavigationAdapter } from '../features/chat/chatNavigation.ts';
import type { ProcessHistoryTargetUpdate } from '../features/chat/history/processHistoryScheduler.ts';
import { composeTurnBlockProcessHistory } from '../features/chat/history/processHistory.ts';
import { activateCapabilityPresentationResources, deactivateCapabilityPresentationResources } from '../state/capabilityPresentationCoordinator.ts';

const TurnRunGraphPanel = lazy(() => import('../features/run-graph/TurnRunGraphPanel.tsx').then((module) => ({ default: module.TurnRunGraphPanel })));

const EMPTY_BACKGROUND_TASKS: readonly BackgroundTaskView[] = [];
const ANCHORED_NEWER_LOAD_THRESHOLD_PX = 128;
const ANCHORED_LATEST_BOTTOM_THRESHOLD_PX = 4;
const ANCHORED_NEWER_LOCK_RELEASE_MIN_DISTANCE_PX = 360;
const ANCHORED_NEWER_WHEEL_GESTURE_GAP_MS = 240;
const CONVERSATION_PREVIEW_MIN_PANE_WIDTH_PX = 960;
const CONVERSATION_PREVIEW_RAIL_LEFT_PX = 18;
const CONVERSATION_PREVIEW_RAIL_WIDTH_PX = 348;
const CONVERSATION_PREVIEW_HIT_WIDTH_PX = 44;
const CONVERSATION_PREVIEW_CARD_LEFT_PX = 36;
const CONVERSATION_PREVIEW_CARD_WIDTH_PX = 312;
const CONVERSATION_PREVIEW_CARD_MAX_HEIGHT_PX = 96;
const CONVERSATION_PREVIEW_RAIL_Z_INDEX = 12;
const CONVERSATION_PREVIEW_CARD_Z_INDEX = 13;
const CONVERSATION_PREVIEW_RAIL_PADDING_Y_PX = 4;
const CONVERSATION_PREVIEW_MAX_HEIGHT = '50%';
const CONVERSATION_PREVIEW_ROW_HEIGHT_PX = 12;
const CONVERSATION_PREVIEW_WINDOW_SIZE = 100;
const CONVERSATION_PREVIEW_PRELOAD_THRESHOLD = 80;
const CONVERSATION_PREVIEW_MAX_IN_FLIGHT = 2;
const CONVERSATION_PREVIEW_FAILURE_COOLDOWN_MS = 3000;
const STREAM_RECONNECTING_STATUS_DELAY_MS = 800;
const PREVIEW_ANCHOR_SCROLL_MAX_ATTEMPTS = 60;
const PREVIEW_ANCHOR_SCROLL_SETTLE_ATTEMPTS = 30;
const EMPTY_STREAM_ENVELOPES: readonly StreamEnvelope[] = [];
const EMPTY_HISTORY_MESSAGES: readonly SessionConversationMessage[] = [];
const EMPTY_SELECTION_IDS: ReadonlySet<string> = new Set<string>();
const EMPTY_PROCESS_HISTORY_BY_RUN: Readonly<Record<string, RunProcessHistoryState | undefined>> = {};
const EMPTY_DISPLAY_PROCESS_RUN_BY_ROOT: Readonly<Record<string, string | undefined>> = {};
const EMPTY_CONVERSATION_PREVIEW_STATE: ConversationPreviewState = {
  totalMarkers: 0,
  markersByIndex: {},
};
const DEFAULT_CONVERSATION_VIEW_STATE = {
  mode: 'recent' as const,
  activeAnchorMessageId: null,
  newMessagesWhileAnchored: false,
};
const DEFAULT_RUNTIME_STATE = defaultSessionRuntimeState();
const CONSUMABLE_TERMINAL_RUN_STATUSES = new Set<TurnBlock['status']>(['COMPLETED', 'FAILED']);

interface ConversationPreviewVisibleRange {
  readonly firstIndex: number;
  readonly lastIndex: number;
  readonly totalMarkers: number;
}

type ConversationPreviewWindowTarget = number | 'latest';

export interface ChatPageProps {
  readonly onOpenHelp: () => void;
  readonly composerBridgeRef?: MutableRefObject<ChatComposerBridge | null> | undefined;
  readonly isConversationSurfaceVisible?: boolean;
}

export interface ChatComposerBridge {
  readonly sendQuestion: (payload: { readonly question: string; readonly isSend?: boolean }) => Promise<boolean>;
}

function useIsDocumentVisible(): boolean {
  const [isVisible, setIsVisible] = useState(() => typeof document === 'undefined' || document.visibilityState === 'visible');

  useEffect(() => {
    if (typeof document === 'undefined') {
      return undefined;
    }
    const handleVisibilityChange = () => {
      setIsVisible(document.visibilityState === 'visible');
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, []);

  return isVisible;
}

export function SessionActivityTerminalObserver({
  sessionId,
  activeSessionId,
  conversationLoadState,
  isConversationSurfaceVisible,
  turnBlocks,
}: {
  readonly sessionId: string | null;
  readonly activeSessionId: string | null;
  readonly conversationLoadState: 'idle' | 'loading' | 'ready' | 'failed';
  readonly isConversationSurfaceVisible: boolean;
  readonly turnBlocks: readonly TurnBlock[];
}) {
  const activity = useSessionActivityStore((state) => (sessionId ? state.entriesBySessionId[sessionId] : undefined));
  const isDocumentVisible = useIsDocumentVisible();
  const terminalConsumeAttemptRef = useRef<{ readonly key: string } | null>(null);
  const presentedTerminalRunId = useMemo(() => {
    const latestTurnBlock = turnBlocks.at(-1);
    if (!latestTurnBlock || !latestTurnBlock.isLatest || !CONSUMABLE_TERMINAL_RUN_STATUSES.has(latestTurnBlock.status)) {
      return null;
    }
    if (latestTurnBlock.displayRunId) {
      return latestTurnBlock.displayRunId;
    }
    return latestTurnBlock.aiEvents.find((event) => typeof event.runId === 'string' && event.runId.trim().length > 0)?.runId ?? null;
  }, [turnBlocks]);

  useEffect(() => {
    const activityId = activity?.status === 'UNREAD_FAILURE' || activity?.status === 'UNREAD_RESULT' ? activity.activityId : null;
    if (
      !sessionId ||
      activeSessionId !== sessionId ||
      conversationLoadState !== 'ready' ||
      !isConversationSurfaceVisible ||
      !isDocumentVisible ||
      !activityId ||
      !presentedTerminalRunId
    ) {
      return undefined;
    }

    const consumeKey = `${sessionId}:${activityId}:${presentedTerminalRunId}`;
    if (terminalConsumeAttemptRef.current?.key === consumeKey) {
      return undefined;
    }
    const attempt = { key: consumeKey };
    terminalConsumeAttemptRef.current = attempt;
    const abortController = new AbortController();
    void sessionActivityService
      .consume({
        sessionId,
        activityId,
        observedRunId: presentedTerminalRunId,
        signal: abortController.signal,
      })
      .catch(() => {
        if (terminalConsumeAttemptRef.current === attempt) {
          terminalConsumeAttemptRef.current = null;
        }
      });
    return () => {
      if (terminalConsumeAttemptRef.current === attempt) {
        terminalConsumeAttemptRef.current = null;
      }
      abortController.abort();
    };
  }, [activity, activeSessionId, conversationLoadState, isConversationSurfaceVisible, isDocumentVisible, presentedTerminalRunId, sessionId]);

  return null;
}

function compactPreviewText(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}

function previewCardText(marker: ConversationPreviewMarker): { readonly title: string; readonly body: string | null } {
  const title = compactPreviewText(marker.previewText);
  const body = marker.answerPreviewText === undefined ? '' : compactPreviewText(marker.answerPreviewText);
  return {
    title,
    body: body.length > 0 ? body : null,
  };
}

function conversationMessageMatchesAnchor(message: SessionConversationMessage, anchorId: string): boolean {
  return (
    message.messageId === anchorId || message.requestId === anchorId || message.requestContextId === anchorId || message.rootMessageId === anchorId
  );
}

function conversationMessageRootId(message: SessionConversationMessage): string {
  return message.rootMessageId ?? message.requestId ?? message.messageId;
}

function isUserStreamEnvelope(envelope: StreamEnvelope): boolean {
  return (envelope.payload as Record<string, unknown>).role === 'USER';
}

function previewWindowKey(sessionId: string, windowIndex: ConversationPreviewWindowTarget): string {
  return `${sessionId}:${windowIndex}`;
}

function previewWindowIndexForMarker(markerIndex: number): number {
  return Math.max(0, Math.floor(markerIndex / CONVERSATION_PREVIEW_WINDOW_SIZE));
}

function collectPreviewWindowIndexes(range: ConversationPreviewVisibleRange): readonly number[] {
  const currentMarkerIndex = Math.floor((range.firstIndex + range.lastIndex) / 2);
  const currentWindowIndex = previewWindowIndexForMarker(currentMarkerIndex);
  const windowStart = currentWindowIndex * CONVERSATION_PREVIEW_WINDOW_SIZE;
  const windowEnd = Math.min(range.totalMarkers - 1, windowStart + CONVERSATION_PREVIEW_WINDOW_SIZE - 1);
  const windowIndexes = [currentWindowIndex];
  if (range.firstIndex - windowStart <= CONVERSATION_PREVIEW_PRELOAD_THRESHOLD && currentWindowIndex > 0) {
    windowIndexes.push(currentWindowIndex - 1);
  }
  if (windowEnd - range.lastIndex <= CONVERSATION_PREVIEW_PRELOAD_THRESHOLD && windowEnd < range.totalMarkers - 1) {
    windowIndexes.push(currentWindowIndex + 1);
  }
  return Array.from(new Set(windowIndexes));
}

function isPreviewWindowLoaded(preview: ConversationPreviewState | undefined, windowIndex: number): boolean {
  if (preview === undefined || windowIndex < 0 || preview.totalMarkers <= 0) {
    return false;
  }
  const windowStart = windowIndex * CONVERSATION_PREVIEW_WINDOW_SIZE;
  if (windowStart >= preview.totalMarkers) {
    return false;
  }
  const windowEnd = Math.min(preview.totalMarkers - 1, windowStart + CONVERSATION_PREVIEW_WINDOW_SIZE - 1);
  for (let markerIndex = windowStart; markerIndex <= windowEnd; markerIndex += 1) {
    if (preview.markersByIndex[markerIndex] === undefined) {
      return false;
    }
  }
  return true;
}

function conversationPreviewMarkerViewportCenter(
  markerIndex: number,
  viewport: { readonly scrollTop: number; readonly clientHeight: number },
): number {
  const markerViewportTop = CONVERSATION_PREVIEW_RAIL_PADDING_Y_PX + markerIndex * CONVERSATION_PREVIEW_ROW_HEIGHT_PX - viewport.scrollTop;
  return markerViewportTop + CONVERSATION_PREVIEW_ROW_HEIGHT_PX / 2;
}

function conversationPreviewCardTopStyle(viewport: { readonly clientHeight: number }, viewportCenter: number): string {
  const offset = viewportCenter - viewport.clientHeight / 2;
  if (offset === 0) {
    return '50%';
  }
  return `calc(50% ${offset > 0 ? '+' : '-'} ${Math.abs(offset)}px)`;
}

function ConversationPreviewRail({
  initialAlignToLatestKey,
  preview,
  onSelect,
  onSelectIndex,
  onVisibleRangeChange,
}: {
  readonly initialAlignToLatestKey: string | null;
  readonly preview: ConversationPreviewState;
  readonly onSelect: (marker: ConversationPreviewMarker) => void;
  readonly onSelectIndex: (markerIndex: number) => void;
  readonly onVisibleRangeChange: (range: ConversationPreviewVisibleRange) => void;
}) {
  const railRef = useRef<HTMLDivElement | null>(null);
  const latestAlignedKeyRef = useRef<string | null>(null);
  const viewportFrameRef = useRef<number | null>(null);
  const hoverClearTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastVisibleRangeRef = useRef<(ConversationPreviewVisibleRange & { readonly previewKey: string | null }) | null>(null);
  const [hoveredMarkerIndex, setHoveredMarkerIndex] = useState<number | null>(null);
  const [viewport, setViewport] = useState({ scrollTop: 0, clientHeight: CONVERSATION_PREVIEW_ROW_HEIGHT_PX });
  const totalMarkers = preview.totalMarkers;

  const cancelHoverClear = useCallback(() => {
    if (hoverClearTimerRef.current !== null) {
      clearTimeout(hoverClearTimerRef.current);
      hoverClearTimerRef.current = null;
    }
  }, []);

  const activateMarkerHover = useCallback(
    (markerIndex: number) => {
      cancelHoverClear();
      setHoveredMarkerIndex(markerIndex);
    },
    [cancelHoverClear],
  );

  const scheduleMarkerHoverClear = useCallback(
    (markerIndex: number) => {
      cancelHoverClear();
      hoverClearTimerRef.current = setTimeout(() => {
        hoverClearTimerRef.current = null;
        setHoveredMarkerIndex((current) => (current === markerIndex ? null : current));
      }, 80);
    },
    [cancelHoverClear],
  );

  const readViewport = useCallback(() => {
    const rail = railRef.current;
    if (!rail) {
      return;
    }
    const scrollTop = Math.max(0, rail.scrollTop);
    const clientHeight = Math.max(CONVERSATION_PREVIEW_ROW_HEIGHT_PX, rail.clientHeight);
    setViewport((current) => (current.scrollTop === scrollTop && current.clientHeight === clientHeight ? current : { scrollTop, clientHeight }));
    if (totalMarkers <= 0) {
      lastVisibleRangeRef.current = null;
      return;
    }
    const firstIndex = Math.min(totalMarkers - 1, Math.max(0, Math.floor(scrollTop / CONVERSATION_PREVIEW_ROW_HEIGHT_PX)));
    const lastIndex = Math.min(
      totalMarkers - 1,
      Math.max(firstIndex, Math.ceil((scrollTop + clientHeight) / CONVERSATION_PREVIEW_ROW_HEIGHT_PX) - 1),
    );
    const previousRange = lastVisibleRangeRef.current;
    if (
      previousRange?.previewKey === initialAlignToLatestKey &&
      previousRange?.firstIndex === firstIndex &&
      previousRange.lastIndex === lastIndex &&
      previousRange.totalMarkers === totalMarkers
    ) {
      return;
    }
    const nextRange = { firstIndex, lastIndex, totalMarkers, previewKey: initialAlignToLatestKey };
    lastVisibleRangeRef.current = nextRange;
    onVisibleRangeChange({ firstIndex, lastIndex, totalMarkers });
  }, [initialAlignToLatestKey, onVisibleRangeChange, totalMarkers]);

  const scheduleViewportUpdate = useCallback(() => {
    if (viewportFrameRef.current !== null) {
      return;
    }
    viewportFrameRef.current = window.requestAnimationFrame(() => {
      viewportFrameRef.current = null;
      readViewport();
    });
  }, [readViewport]);

  const alignInitialViewportToLatest = useCallback(() => {
    if (initialAlignToLatestKey === null || latestAlignedKeyRef.current === initialAlignToLatestKey || totalMarkers <= 0) {
      return;
    }
    const rail = railRef.current;
    if (!rail) {
      return;
    }
    const contentHeight = Math.max(rail.scrollHeight, totalMarkers * CONVERSATION_PREVIEW_ROW_HEIGHT_PX);
    rail.scrollTop = Math.max(0, contentHeight - rail.clientHeight);
    latestAlignedKeyRef.current = initialAlignToLatestKey;
  }, [initialAlignToLatestKey, totalMarkers]);

  useLayoutEffect(() => {
    alignInitialViewportToLatest();
    readViewport();
    const rail = railRef.current;
    if (!rail) {
      return undefined;
    }
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(scheduleViewportUpdate);
    observer?.observe(rail);
    return () => observer?.disconnect();
  }, [alignInitialViewportToLatest, readViewport, scheduleViewportUpdate]);

  useEffect(() => {
    return () => {
      if (viewportFrameRef.current !== null) {
        window.cancelAnimationFrame(viewportFrameRef.current);
        viewportFrameRef.current = null;
      }
      cancelHoverClear();
    };
  }, [cancelHoverClear]);

  useEffect(() => {
    setHoveredMarkerIndex((current) => {
      if (current === null) {
        return current;
      }
      return current >= 0 && current < totalMarkers && preview.markersByIndex[current] !== undefined ? current : null;
    });
    readViewport();
  }, [preview.markersByIndex, totalMarkers, readViewport]);

  if (totalMarkers <= 0) {
    return null;
  }

  const visibleStartIndex = Math.min(totalMarkers - 1, Math.max(0, Math.floor(viewport.scrollTop / CONVERSATION_PREVIEW_ROW_HEIGHT_PX)));
  const visibleEndIndex = Math.min(
    totalMarkers - 1,
    Math.max(visibleStartIndex, Math.ceil((viewport.scrollTop + viewport.clientHeight) / CONVERSATION_PREVIEW_ROW_HEIGHT_PX) - 1),
  );
  const renderStartIndex = Math.max(0, visibleStartIndex - CONVERSATION_PREVIEW_PRELOAD_THRESHOLD);
  const renderEndIndex = Math.min(totalMarkers - 1, visibleEndIndex + CONVERSATION_PREVIEW_PRELOAD_THRESHOLD);
  const renderedMarkerIndexes = Array.from({ length: renderEndIndex - renderStartIndex + 1 }, (_, index) => renderStartIndex + index);
  const isPreviewHovered = hoveredMarkerIndex !== null;
  const hoveredMarker = hoveredMarkerIndex === null ? null : (preview.markersByIndex[hoveredMarkerIndex] ?? null);
  const hoveredCardText = hoveredMarker === null ? null : previewCardText(hoveredMarker);
  const hoveredCard =
    hoveredMarkerIndex === null || hoveredMarker === null || hoveredCardText === null
      ? null
      : { markerIndex: hoveredMarkerIndex, marker: hoveredMarker, text: hoveredCardText };
  const hoveredCardViewportCenter = hoveredMarkerIndex === null ? 0 : conversationPreviewMarkerViewportCenter(hoveredMarkerIndex, viewport);
  const hoveredCardTop = conversationPreviewCardTopStyle(viewport, hoveredCardViewportCenter);

  return (
    <>
      <div
        ref={railRef}
        className="conversation-preview-scrollbar-hidden"
        data-testid="conversation-preview-rail"
        onScroll={scheduleViewportUpdate}
        style={{
          position: 'absolute',
          top: '50%',
          transform: 'translateY(-50%)',
          left: CONVERSATION_PREVIEW_RAIL_LEFT_PX,
          width: CONVERSATION_PREVIEW_RAIL_WIDTH_PX,
          maxHeight: CONVERSATION_PREVIEW_MAX_HEIGHT,
          pointerEvents: 'none',
          overflowX: 'hidden',
          overflowY: 'auto',
          overscrollBehavior: 'contain',
          padding: `${CONVERSATION_PREVIEW_RAIL_PADDING_Y_PX}px 0`,
          zIndex: CONVERSATION_PREVIEW_RAIL_Z_INDEX,
        }}
      >
        <div
          style={{
            position: 'relative',
            width: CONVERSATION_PREVIEW_RAIL_WIDTH_PX,
            height: totalMarkers * CONVERSATION_PREVIEW_ROW_HEIGHT_PX,
          }}
        >
          {renderedMarkerIndexes.map((markerIndex) => {
            const marker = preview.markersByIndex[markerIndex];
            const isLoaded = marker !== undefined;
            const isHovered = isLoaded && hoveredMarkerIndex === markerIndex;
            const isEmphasizedMarker = isHovered;
            const activeMarkerDistance = hoveredMarkerIndex === null ? null : Math.abs(markerIndex - hoveredMarkerIndex);
            const markerWidth = !isPreviewHovered
              ? 8
              : activeMarkerDistance === 0
                ? 30
                : activeMarkerDistance === 1
                  ? 25
                  : activeMarkerDistance === 2
                    ? 20
                    : activeMarkerDistance === 3
                      ? 15
                      : 8;
            const markerOpacity = !isLoaded ? 0.28 : isEmphasizedMarker ? 0.88 : 0.42;
            return (
              <div
                key={marker?.messageId ?? `conversation-preview-placeholder-${markerIndex}`}
                onMouseEnter={() => {
                  if (isLoaded) {
                    activateMarkerHover(markerIndex);
                  }
                }}
                onMouseLeave={() => {
                  if (isLoaded) {
                    scheduleMarkerHoverClear(markerIndex);
                  }
                }}
                onClick={() => {
                  if (marker === undefined) {
                    onSelectIndex(markerIndex);
                    return;
                  }
                  onSelect(marker);
                }}
                style={{
                  position: 'absolute',
                  top: markerIndex * CONVERSATION_PREVIEW_ROW_HEIGHT_PX,
                  left: 0,
                  zIndex: isHovered ? 2 : 1,
                  width: isHovered ? CONVERSATION_PREVIEW_RAIL_WIDTH_PX : CONVERSATION_PREVIEW_HIT_WIDTH_PX,
                  height: CONVERSATION_PREVIEW_ROW_HEIGHT_PX,
                  display: 'flex',
                  alignItems: 'center',
                  pointerEvents: 'auto',
                  cursor: 'pointer',
                }}
              >
                <button
                  type="button"
                  aria-label={marker?.previewText ?? `Conversation preview marker ${markerIndex + 1}`}
                  onClick={(event) => {
                    event.stopPropagation();
                    if (marker === undefined) {
                      onSelectIndex(markerIndex);
                      return;
                    }
                    onSelect(marker);
                  }}
                  onFocus={() => {
                    if (isLoaded) {
                      activateMarkerHover(markerIndex);
                    }
                  }}
                  onBlur={() => {
                    if (isLoaded) {
                      scheduleMarkerHoverClear(markerIndex);
                    }
                  }}
                  style={{
                    width: markerWidth,
                    height: 2,
                    borderRadius: 2,
                    border: 0,
                    background: isEmphasizedMarker ? 'var(--color-primary)' : 'rgba(107, 114, 128, 0.62)',
                    cursor: 'pointer',
                    padding: 0,
                    opacity: markerOpacity,
                    transition: 'width 120ms ease',
                  }}
                />
              </div>
            );
          })}
        </div>
      </div>
      {hoveredCard ? (
        <button
          type="button"
          data-testid="conversation-preview-hover-card"
          onMouseEnter={() => activateMarkerHover(hoveredCard.markerIndex)}
          onMouseLeave={() => scheduleMarkerHoverClear(hoveredCard.markerIndex)}
          onFocus={() => activateMarkerHover(hoveredCard.markerIndex)}
          onBlur={() => scheduleMarkerHoverClear(hoveredCard.markerIndex)}
          onClick={(event) => {
            event.stopPropagation();
            onSelect(hoveredCard.marker);
          }}
          style={{
            position: 'absolute',
            left: CONVERSATION_PREVIEW_RAIL_LEFT_PX + CONVERSATION_PREVIEW_CARD_LEFT_PX,
            top: hoveredCardTop,
            transform: 'translateY(-50%)',
            width: CONVERSATION_PREVIEW_CARD_WIDTH_PX,
            maxHeight: CONVERSATION_PREVIEW_CARD_MAX_HEIGHT_PX,
            overflow: 'hidden',
            textAlign: 'left',
            border: '1px solid var(--color-border)',
            background: 'var(--color-bg-primary)',
            color: 'var(--color-text-primary)',
            boxShadow: 'var(--shadow-sm)',
            borderRadius: 8,
            padding: '7px 9px 8px',
            boxSizing: 'border-box',
            cursor: 'pointer',
            pointerEvents: 'auto',
            zIndex: CONVERSATION_PREVIEW_CARD_Z_INDEX,
          }}
        >
          <span
            style={{
              display: 'block',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              fontSize: 14,
              lineHeight: '20px',
              fontWeight: 600,
              letterSpacing: 0,
            }}
          >
            {hoveredCard.text.title}
          </span>
          {hoveredCard.text.body ? (
            <span
              style={{
                display: '-webkit-box',
                WebkitBoxOrient: 'vertical',
                WebkitLineClamp: 3,
                marginTop: 1,
                overflow: 'hidden',
                color: 'var(--color-text-secondary)',
                fontSize: 13,
                lineHeight: '18px',
                fontWeight: 400,
                letterSpacing: 0,
              }}
            >
              {hoveredCard.text.body}
            </span>
          ) : null}
        </button>
      ) : null}
    </>
  );
}

export function ChatPage({ onOpenHelp, composerBridgeRef, isConversationSurfaceVisible = true }: ChatPageProps) {
  const navigate = useNavigate();
  const { sessionId: urlSessionId } = useParams<{ sessionId: string }>();
  const [searchParams] = useSearchParams();
  const urlMessageId = searchParams.get('messageId');
  const navigation = useMemo<ChatNavigationAdapter>(
    () => ({
      sessionId: urlSessionId ?? null,
      messageId: urlMessageId,
      openSession: (sessionId, options) => {
        navigate(`/session/${encodeURIComponent(sessionId)}`, { replace: options?.replace ?? false });
      },
      openNewSession: (options) => {
        navigate('/', { replace: options?.replace ?? false });
      },
    }),
    [navigate, urlSessionId, urlMessageId],
  );

  return (
    <ChatPageCore
      onOpenHelp={onOpenHelp}
      composerBridgeRef={composerBridgeRef}
      navigation={navigation}
      isConversationSurfaceVisible={isConversationSurfaceVisible}
    />
  );
}

export interface ChatPageCoreProps extends ChatPageProps {
  readonly navigation: ChatNavigationAdapter;
  readonly headerSlot?: ReactNode;
  readonly aboveMessagesSlot?: ReactNode;
}

export function ChatPageCore({
  onOpenHelp,
  composerBridgeRef,
  navigation,
  headerSlot,
  aboveMessagesSlot,
  isConversationSurfaceVisible = true,
}: ChatPageCoreProps) {
  const { t } = useTranslation();
  const host = useContext(AppHostContext);
  const isRemoteMode = host?.mode === 'immersive' || host?.mode === 'piu';
  const userOps = useUserOps();
  const routeSessionId = navigation.sessionId;
  useEffect(() => {
    if (routeSessionId) {
      activateCapabilityPresentationResources(routeSessionId);
    } else {
      deactivateCapabilityPresentationResources();
    }
  }, [routeSessionId]);
  const [annotationsByRunId, setAnnotationsByRunId] = useState<ReadonlyMap<string, AnnotationState>>(new Map());
  const [shareSelectionMode, setShareSelectionMode] = useState(false);
  const [selectedRunIds, setSelectedRunIds] = useState<Set<string>>(new Set());
  const [shareDialogOpen, setShareDialogOpen] = useState(false);
  const [reportSelectionMode, setReportSelectionMode] = useState(false);
  const [selectedReportRequestIds, setSelectedReportRequestIds] = useState<Set<string>>(new Set());
  const [reportTurnBlocks, setReportTurnBlocks] = useState<TurnBlock[]>([]);
  const [forkingAnchorKey, setForkingAnchorKey] = useState<string | null>(null);

  useEffect(() => {
    if (!routeSessionId) {
      setAnnotationsByRunId(new Map());
      return undefined;
    }
    let cancelled = false;
    annotationService
      .listSessionAnnotations(routeSessionId)
      .then((views) => {
        if (cancelled) {
          return;
        }
        const map = new Map<string, AnnotationState>();
        for (const view of views) {
          map.set(view.requestRunId, { sentiment: view.sentiment, isFavorited: view.isFavorited, isQuestionFavorited: view.isQuestionFavorited });
        }
        setAnnotationsByRunId(map);
      })
      .catch(() => {
        if (!cancelled) {
          setAnnotationsByRunId(new Map());
        }
      });
    return () => {
      cancelled = true;
    };
  }, [routeSessionId]);

  const handleAnnotationChange = useCallback((runId: string, state: AnnotationState | null) => {
    setAnnotationsByRunId((prev) => {
      const next = new Map(prev);
      if (state === null) {
        next.delete(runId);
      } else {
        next.set(runId, state);
      }
      return next;
    });
  }, []);

  const sessions = useSessionStore((s) => s.sessions);
  const activeSessionId = useSessionStore((s) => s.activeSessionId);
  const isLoadingHistory = useSessionStore((s) => s.isLoadingHistory);
  const loadSessions = useSessionStore((s) => s.loadSessions);
  const setActiveSessionId = useSessionStore((s) => s.setActiveSessionId);
  const setHistoryWindowLimit = useSessionStore((s) => s.setHistoryWindowLimit);
  const activeSessionHistoryLayer = useConversationStore((s) =>
    routeSessionId ? (s.historyEnvelopesBySession[routeSessionId] ?? EMPTY_STREAM_ENVELOPES) : EMPTY_STREAM_ENVELOPES,
  );
  const activeSessionActiveBuckets = useConversationStore((s) => (routeSessionId ? s.activeLiveBySession[routeSessionId] : undefined));
  const activeSessionSettledBuckets = useConversationStore((s) => (routeSessionId ? s.settledLiveBySession[routeSessionId] : undefined));
  const activeSessionHistoryMessages = useConversationStore((s) =>
    routeSessionId ? (s.historyMessagesBySession[routeSessionId] ?? EMPTY_HISTORY_MESSAGES) : EMPTY_HISTORY_MESSAGES,
  );
  const cachedForkNotice = useConversationStore((s) => (routeSessionId ? (s.forkNoticeBySession[routeSessionId] ?? null) : null));
  const activeConversationLoadState = useConversationStore((s) =>
    routeSessionId ? (s.conversationLoadStateBySession[routeSessionId] ?? 'idle') : 'idle',
  );
  const activeConversationPageInfo = useConversationStore((s) => (routeSessionId ? s.conversationPageInfoBySession[routeSessionId] : undefined));
  const activeConversationPreview = useConversationStore((s) =>
    routeSessionId ? (s.conversationPreviewBySession[routeSessionId] ?? EMPTY_CONVERSATION_PREVIEW_STATE) : EMPTY_CONVERSATION_PREVIEW_STATE,
  );
  const activeConversationView = useConversationStore((s) =>
    routeSessionId ? (s.conversationViewBySession[routeSessionId] ?? DEFAULT_CONVERSATION_VIEW_STATE) : DEFAULT_CONVERSATION_VIEW_STATE,
  );
  const storedActiveRuntimeState = useConversationStore((s) => (routeSessionId ? s.runtimeBySession[routeSessionId] : undefined));
  const activeProcessHistoryByRun = useConversationStore((s) =>
    routeSessionId ? (s.processHistoryBySession[routeSessionId] ?? EMPTY_PROCESS_HISTORY_BY_RUN) : EMPTY_PROCESS_HISTORY_BY_RUN,
  );
  const activeDisplayProcessRunByRoot = useConversationStore((s) =>
    routeSessionId ? (s.displayProcessRunByRootBySession[routeSessionId] ?? EMPTY_DISPLAY_PROCESS_RUN_BY_ROOT) : EMPTY_DISPLAY_PROCESS_RUN_BY_ROOT,
  );
  const loadConversation = useConversationStore((s) => s.loadConversation);
  const conversationError = useConversationStore((s) => s.conversationError);
  const conversationErrorCode = useConversationStore((s) => s.conversationErrorCode);
  const loadConversationPreview = useConversationStore((s) => s.loadConversationPreview);
  const loadAnchoredConversation = useConversationStore((s) => s.loadAnchoredConversation);
  const loadOlderConversation = useConversationStore((s) => s.loadOlderConversation);
  const loadNewerConversation = useConversationStore((s) => s.loadNewerConversation);
  const completeAnchoredConversation = useConversationStore((s) => s.completeAnchoredConversation);
  const updateAutomaticProcessHistoryTargets = useConversationStore((s) => s.updateAutomaticProcessHistoryTargets);
  const setExplicitProcessHistoryTarget = useConversationStore((s) => s.setExplicitProcessHistoryTarget);
  const retryRunProcessHistory = useConversationStore((s) => s.retryRunProcessHistory);
  const appendEnvelope = useConversationStore((s) => s.appendEnvelope);
  const appendEnvelopes = useConversationStore((s) => s.appendEnvelopes);
  const setStreamConnectionState = useConversationStore((s) => s.setStreamConnectionState);
  const setRuntimeState = useConversationStore((s) => s.setRuntimeState);
  const setStreaming = useConversationStore((s) => s.setStreaming);
  const clearForkNotice = useConversationStore((s) => s.clearForkNotice);

  const submitRequest = useRequestStore((s) => s.submitRequest);
  const requestStatus = useRequestStore((s) => s.requestStatus);
  const pendingRequest = useRequestStore((s) => s.pendingRequest);
  const activeRequestRootMessageId = useRequestStore((s) => s.activeRequestRootMessageId);
  const activeRequestSessionId = useRequestStore((s) => s.activeRequestSessionId);
  const cancelError = useRequestStore((s) => s.cancelError);
  const retryError = useRequestStore((s) => s.retryError);
  const editError = useRequestStore((s) => s.editError);
  const retryLimitReachedFor = useRequestStore((s) => s.retryLimitReachedFor);
  const retryLimitNotice = useRequestStore((s) => s.retryLimitNotice);
  const clearRetryLimitNotice = useRequestStore((s) => s.clearRetryLimitNotice);
  const clearRequestNotices = useRequestStore((s) => s.clearRequestNotices);
  const settleRequestFromTerminal = useRequestStore((s) => s.settleRequestFromTerminal);
  const acceptRequestFromStream = useRequestStore((s) => s.acceptRequestFromStream);
  const reconcilePendingRequestFromLiveEnvelope = useRequestStore((s) => s.reconcilePendingRequestFromLiveEnvelope);
  const hydrateFromActiveRun = useRequestStore((s) => s.hydrateFromActiveRun);
  const settleStaleSessionRequest = useRequestStore((s) => s.settleStaleSessionRequest);
  const uploadError = useRequestStore((s) => s.uploadError);
  const submitError = useRequestStore((s) => s.submitError);
  const activeInput = useUserInputStore((s) => s.activeInput);
  const setSubmitStatus = useUserInputStore((s) => s.setSubmitStatus);
  const clearUserInput = useUserInputStore((s) => s.clear);
  const hasDisplayedConversationRef = useRef(false);
  const graphLayoutRef = useRef<HTMLDivElement | null>(null);
  const chatConversationPaneRef = useRef<HTMLDivElement | null>(null);
  const graphOpenerRef = useRef<HTMLElement | null>(null);
  const graphCloseButtonRef = useRef<HTMLButtonElement | null>(null);
  const graphResizeCleanupRef = useRef<(() => void) | null>(null);
  const [selectedDetailRootMessageId, setSelectedDetailRootMessageId] = useState<string | null>(null);
  const [graphDetailWidth, setGraphDetailWidth] = useState(GRAPH_DETAIL_DEFAULT_WIDTH);
  const [conversationPaneWidth, setConversationPaneWidth] = useState<number | null>(null);
  const previewLoadedWindowsRef = useRef<Set<string>>(new Set());
  const previewLoadingWindowsRef = useRef<Set<string>>(new Set());
  const previewFailedWindowsRef = useRef<Map<string, number>>(new Map());
  const pendingPreviewScrollMessageIdRef = useRef<string | null>(null);
  const previewNavigationGenerationRef = useRef(0);
  const routeSessionIdRef = useRef(routeSessionId);
  routeSessionIdRef.current = routeSessionId;
  const navigationMessageIdRef = useRef(navigation.messageId);
  navigationMessageIdRef.current = navigation.messageId;
  const previewScrollRetryingMessageIdRef = useRef<string | null>(null);
  const processedFavoriteMessageIdRef = useRef<string | null>(null);
  const pendingFavoriteNavigationRef = useRef<{
    readonly sessionId: string;
    readonly messageId: string;
  } | null>(null);
  const favoriteAnchorLoadRef = useRef<{
    readonly key: string;
    readonly promise: Promise<boolean>;
  } | null>(null);
  const previewVisibleRangeRef = useRef<(ConversationPreviewVisibleRange & { readonly sessionId: string }) | null>(null);
  const previewAnchoredNewerSuppressionTopRef = useRef<number | null>(null);
  const anchoredNewerUserScrollIntentRef = useRef(false);
  const anchoredNewerUserScrollIntentSourceRef = useRef<'wheel' | 'pointer' | 'keyboard' | null>(null);
  const anchoredNewerBoundaryRef = useRef<HTMLDivElement | null>(null);
  const anchoredNewerAutoLoadLockedRef = useRef(false);
  const anchoredNewerAutoLoadLockedTopRef = useRef<number | null>(null);
  const anchoredNewerAutoLoadLockedGestureRef = useRef<number | null>(null);
  const anchoredNewerInputGestureRef = useRef({ id: 0, lastTimestamp: 0 });
  const conversationScrollTopRef = useRef(0);

  useEffect(() => {
    previewNavigationGenerationRef.current += 1;
    return () => {
      previewNavigationGenerationRef.current += 1;
      if (routeSessionId) {
        setExplicitProcessHistoryTarget(routeSessionId, 'preview', null);
      }
    };
  }, [routeSessionId, setExplicitProcessHistoryTarget]);

  const setAnchoredNewerAutoLoadLockedState = useCallback((locked: boolean, scrollTop?: number | null, gestureId?: number | null) => {
    anchoredNewerAutoLoadLockedRef.current = locked;
    anchoredNewerAutoLoadLockedTopRef.current = locked ? (scrollTop ?? conversationScrollTopRef.current) : null;
    anchoredNewerAutoLoadLockedGestureRef.current = locked ? (gestureId ?? anchoredNewerInputGestureRef.current.id) : null;
  }, []);

  const isTrackedSessionRequest = !activeRequestSessionId || activeRequestSessionId === routeSessionId;
  const isExecuting = isTrackedSessionRequest && (requestStatus === 'accepted' || requestStatus === 'submitting' || requestStatus === 'canceling');
  const isRequestControlPending = isTrackedSessionRequest && (requestStatus === 'retrying' || requestStatus === 'editing');
  const pendingRetryRootMessageId =
    isTrackedSessionRequest && pendingRequest?.kind === 'retry' && pendingRequest.httpIdentityConfirmed === false
      ? (pendingRequest.retrySourceRootMessageId ?? null)
      : null;
  const isConversationTransitioning = isExecuting || isRequestControlPending;
  const canStopRequest =
    isTrackedSessionRequest && requestStatus === 'accepted' && activeRequestRootMessageId !== null && pendingRequest?.httpIdentityConfirmed !== false;
  // Map requestStore status to RunStatus for TurnBlock status fallback.
  // When cancel/failed terminal events are rejected by the conversation store
  // (identity mismatch), the TurnBlock would stay stuck in EXECUTING because
  // aiEvents has no terminal event. This fallback lets applyLatestBlockStatus
  // resolve the correct terminal status from the request store.
  const latestPersistedRunStatus: RunStatus | null =
    isTrackedSessionRequest && requestStatus === 'canceled' ? 'CANCELED' : isTrackedSessionRequest && requestStatus === 'failed' ? 'FAILED' : null;

  useEffect(() => {
    if (routeSessionId !== activeSessionId) {
      setActiveSessionId(routeSessionId);
    }
  }, [routeSessionId, activeSessionId, setActiveSessionId]);

  useLayoutEffect(() => {
    const element = chatConversationPaneRef.current;
    if (!element) {
      setConversationPaneWidth(null);
      return undefined;
    }

    const updateWidth = () => {
      const measuredWidth = element.getBoundingClientRect().width;
      const nextWidth = measuredWidth > 0 ? measuredWidth : window.innerWidth;
      setConversationPaneWidth((currentWidth) => (currentWidth === nextWidth ? currentWidth : nextWidth));
    };

    updateWidth();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(updateWidth);
    observer?.observe(element);
    window.addEventListener('resize', updateWidth);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', updateWidth);
    };
  }, []);

  useEffect(() => {
    clearUserInput();
  }, [routeSessionId, clearUserInput]);

  const handleRespondSubmit = useCallback(
    async (answers: ReadonlyArray<readonly string[]>, answerKinds?: readonly QuestionAnswerKind[]) => {
      if (!routeSessionId || !activeInput) {
        return;
      }
      setSubmitStatus('submitting');
      try {
        await requestService.submitUserInputResponse(routeSessionId, activeInput.inputRequestId, {
          answers,
          ...(answerKinds === undefined ? {} : { answerKinds }),
        });
        useUserInputStore.getState().resolveInputRequest('USER_INPUT_RECEIVED');
      } catch {
        setSubmitStatus('error', t('requestNotices.userInputSubmitFailed'));
      }
    },
    [routeSessionId, activeInput, setSubmitStatus, t],
  );

  const activeSessionActiveLayer = useMemo(() => flattenLiveBuckets(activeSessionActiveBuckets), [activeSessionActiveBuckets]);
  const activeSessionSettledLayer = useMemo(() => flattenLiveBuckets(activeSessionSettledBuckets), [activeSessionSettledBuckets]);
  const activeForkNotice =
    cachedForkNotice && !activeSessionSettledLayer.some(isUserStreamEnvelope) && !activeSessionActiveLayer.some(isUserStreamEnvelope)
      ? cachedForkNotice
      : null;
  const activeConversationWindowRef = useRef({
    sessionId: routeSessionId,
    mode: activeConversationView.mode,
    activeAnchorMessageId: activeConversationView.activeAnchorMessageId,
  });
  activeConversationWindowRef.current = {
    sessionId: routeSessionId,
    mode: activeConversationView.mode,
    activeAnchorMessageId: activeConversationView.activeAnchorMessageId,
  };
  const isAnchoredConversation = activeConversationView.mode === 'anchored';
  const activeSessionHistoryEntry = useMemo(
    () => sessions.find((session) => session.sessionId === routeSessionId) ?? null,
    [routeSessionId, sessions],
  );
  const latestEnvelopeCursor = useMemo(() => {
    const latestEnvelope = activeSessionActiveLayer.at(-1) ?? activeSessionSettledLayer.at(-1);
    if (!latestEnvelope) {
      return 'empty';
    }
    return `${latestEnvelope.eventId}:${latestEnvelope.sequence}`;
  }, [activeSessionActiveLayer, activeSessionSettledLayer]);
  const activeRuntimeState = storedActiveRuntimeState ?? DEFAULT_RUNTIME_STATE;

  // After a page refresh or a session switch the in-memory requestStore may be
  // "idle" (or tracking another session) even though the backend is still
  // processing this session's request. Hydrate from the server-provided
  // activeRun so the stop button follows the viewed session's actual state.
  useEffect(() => {
    if (routeSessionId && activeRuntimeState.activeRun) {
      hydrateFromActiveRun(routeSessionId, activeRuntimeState.activeRun.requestId);
    }
  }, [routeSessionId, activeRuntimeState.activeRun, hydrateFromActiveRun]);

  // After the entry conversation snapshot resolves, the backend activeRun is
  // authoritative: if the tracked request for this session no longer has an
  // activeRun (it ended while another session was viewed), settle the stale
  // "accepted" state so the composer returns to the normal send button.
  const handleSessionEntrySnapshot = useCallback(
    (entrySessionId: string) => {
      const runtime = useConversationStore.getState().runtimeBySession[entrySessionId];
      if (runtime?.activeRun) {
        return;
      }
      settleStaleSessionRequest(entrySessionId);
    },
    [settleStaleSessionRequest],
  );

  const sessionHistoryProjection = useMemo(
    () =>
      buildSessionHistoryProjection({
        historyMessages: activeSessionHistoryMessages,
        historyEnvelopes: activeSessionHistoryLayer,
        displayRunByRoot: activeDisplayProcessRunByRoot,
      }),
    [activeDisplayProcessRunByRoot, activeSessionHistoryLayer, activeSessionHistoryMessages],
  );
  const sessionSettledProjection = useMemo(
    () =>
      buildSessionSettledProjection({
        historyProjection: sessionHistoryProjection,
        settledEnvelopes: activeSessionSettledLayer,
        includeLiveOnlyRoots: !isAnchoredConversation,
        activeRun: activeRuntimeState.activeRun,
        latestPersistedRunStatus,
      }),
    [activeRuntimeState.activeRun, activeSessionSettledLayer, isAnchoredConversation, latestPersistedRunStatus, sessionHistoryProjection],
  );
  const sessionProjection = useMemo(
    () =>
      overlaySessionActiveProjection({
        historyProjection: sessionHistoryProjection,
        settledProjection: sessionSettledProjection,
        activeEnvelopes: activeSessionActiveLayer,
        includeLiveOnlyRoots: !isAnchoredConversation,
        activeRun: activeRuntimeState.activeRun,
        latestPersistedRunStatus,
        pendingRetryRootMessageId,
      }),
    [
      activeRuntimeState.activeRun,
      activeSessionActiveLayer,
      isAnchoredConversation,
      latestPersistedRunStatus,
      pendingRetryRootMessageId,
      sessionHistoryProjection,
      sessionSettledProjection,
    ],
  );
  const turnBlocks: TurnBlock[] = sessionProjection.turnBlocks as TurnBlock[];
  const latestRootMessageId = turnBlocks.at(-1)?.rootMessageId ?? null;
  const allTurnBlocks: TurnBlock[] = useMemo(() => [...turnBlocks, ...reportTurnBlocks], [turnBlocks, reportTurnBlocks]);
  const selectableReportRequestIds = useMemo<ReadonlySet<string>>(
    () => (reportSelectionMode ? new Set(turnBlocks.map(resolveReportableRequestId).filter((id): id is string => Boolean(id))) : EMPTY_SELECTION_IDS),
    [reportSelectionMode, turnBlocks],
  );
  const selectableRunIds = useMemo<ReadonlySet<string>>(
    () => (shareSelectionMode ? new Set(turnBlocks.map(resolveShareableRunId).filter((id): id is string => Boolean(id))) : EMPTY_SELECTION_IDS),
    [shareSelectionMode, turnBlocks],
  );
  const selectedDetailBlock = useMemo(() => {
    if (selectedDetailRootMessageId === null) {
      return null;
    }
    const block = turnBlocks.find((candidate) => candidate.rootMessageId === selectedDetailRootMessageId);
    if (block === undefined) {
      return null;
    }
    const processHistoryState = block.displayRunId === undefined ? undefined : activeProcessHistoryByRun[block.displayRunId];
    return composeTurnBlockProcessHistory(block, processHistoryState, routeSessionId ?? undefined);
  }, [activeProcessHistoryByRun, routeSessionId, selectedDetailRootMessageId, turnBlocks]);
  const isGraphDetailOpen = selectedDetailBlock !== null;
  const isGraphDrawerMode = useGraphDrawerMode(graphLayoutRef, isGraphDetailOpen);
  const isExpandPanelOpen = expandPanelStore((s) => s.isOpen);
  const aicoConfig = useAICOConfig();
  const isLocalMode = host?.mode === 'local';
  const isImmersiveMode = host?.mode === 'immersive';
  const isInternalExpandPanelHost = isLocalMode || isImmersiveMode;
  const shouldConstrainConversationPane = isExpandPanelOpen && isInternalExpandPanelHost;
  const expandPanelPosition = aicoConfig?.layoutConfig?.expandPanelPosition ?? 'RIGHT';

  // Expand panel stream watcher
  useExpandPanelStreamWatcher(activeSessionActiveLayer, routeSessionId ?? undefined);

  // Mutex: opening expand panel closes graph panel
  useEffect(() => {
    if (isExpandPanelOpen && selectedDetailRootMessageId !== null) {
      setSelectedDetailRootMessageId(null);
    }
  }, [isExpandPanelOpen, selectedDetailRootMessageId]);

  // Turn/session switch closes expand panel
  const prevSessionIdRef = useRef<string | null>(null);
  const prevTurnRootIdRef = useRef<string | null>(null);
  useEffect(() => {
    const currentTurnRootId = turnBlocks.length > 0 ? (turnBlocks[turnBlocks.length - 1]?.rootMessageId ?? null) : null;

    if (prevSessionIdRef.current !== null && prevSessionIdRef.current !== routeSessionId) {
      expandPanelStore.getState().close();
    }
    if (prevSessionIdRef.current !== null && prevSessionIdRef.current !== routeSessionId) {
      setShareSelectionMode(false);
      setSelectedRunIds(new Set());
      setReportSelectionMode(false);
      setSelectedReportRequestIds(new Set());
      setReportTurnBlocks([]);
    }
    if (prevTurnRootIdRef.current !== null && prevTurnRootIdRef.current !== currentTurnRootId) {
      expandPanelStore.getState().close();
    }

    prevSessionIdRef.current = routeSessionId ?? null;
    prevTurnRootIdRef.current = currentTurnRootId;
  }, [routeSessionId, turnBlocks]);

  const stopGraphResize = useCallback(() => {
    const cleanup = graphResizeCleanupRef.current;
    if (!cleanup) {
      return;
    }
    graphResizeCleanupRef.current = null;
    cleanup();
  }, []);

  useEffect(() => {
    stopGraphResize();
    setSelectedDetailRootMessageId(null);
    graphOpenerRef.current = null;
  }, [routeSessionId, stopGraphResize]);

  useEffect(() => {
    if (!selectedDetailRootMessageId || selectedDetailBlock) {
      return;
    }
    setSelectedDetailRootMessageId(null);
  }, [selectedDetailBlock, selectedDetailRootMessageId]);

  useEffect(() => {
    if (!isGraphDetailOpen || isGraphDrawerMode) {
      return undefined;
    }

    const clampWidth = () => {
      setGraphDetailWidth((width) => clampGraphDetailWidth(width, readContainerWidth(graphLayoutRef)));
    };

    clampWidth();

    if (typeof ResizeObserver === 'undefined' || !graphLayoutRef.current) {
      return undefined;
    }

    const observer = new ResizeObserver(clampWidth);
    observer.observe(graphLayoutRef.current);
    return () => observer.disconnect();
  }, [isGraphDetailOpen, isGraphDrawerMode]);

  useEffect(() => {
    if (!isGraphDetailOpen || isGraphDrawerMode) {
      stopGraphResize();
    }
  }, [isGraphDetailOpen, isGraphDrawerMode, stopGraphResize]);

  useEffect(() => stopGraphResize, [stopGraphResize]);

  const turnBlockCursor = useMemo(
    () => turnBlocks.map((block) => `${block.rootMessageId}:${block.status}:${block.aiEvents.length}`).join('|'),
    [turnBlocks],
  );
  useEffect(() => {
    if (!isAnchoredConversation || !activeConversationPageInfo?.newerCursor) {
      setAnchoredNewerAutoLoadLockedState(false);
    }
  }, [activeConversationPageInfo?.newerCursor, isAnchoredConversation, setAnchoredNewerAutoLoadLockedState]);

  const hasInFlightRequest = Boolean(activeRuntimeState.activeRun);
  const isConversationLoading = activeConversationLoadState === 'loading';
  const hasLocalEnvelopes = activeSessionActiveLayer.length > 0 || activeSessionSettledLayer.length > 0;
  const shouldDeferSnapshotLoad = Boolean(routeSessionId && isConversationTransitioning && hasLocalEnvelopes);
  const acceptedRun: RuntimeActiveRunSummary | null =
    pendingRequest?.sessionId === routeSessionId &&
    pendingRequest.httpIdentityConfirmed !== false &&
    pendingRequest.acceptedRootMessageId &&
    pendingRequest.acceptedRunId
      ? {
          requestId: pendingRequest.acceptedRootMessageId,
          runId: pendingRequest.acceptedRunId,
          status: 'EXECUTING',
        }
      : null;
  const sessionBackgroundTasks = useBackgroundTaskStore((state) => state.tasksBySession[routeSessionId ?? ''] ?? EMPTY_BACKGROUND_TASKS);
  const hasRunningBackgroundTask = sessionBackgroundTasks.some((task) => task.status === 'RUNNING');
  const hasActiveRun = hasInFlightRequest || acceptedRun !== null;
  const [streamLinger, setStreamLinger] = useState(false);
  const lingerTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const triggerStreamLinger = useCallback(() => {
    setStreamLinger(true);
    if (lingerTimerRef.current !== null) {
      clearTimeout(lingerTimerRef.current);
    }
    lingerTimerRef.current = setTimeout(() => setStreamLinger(false), 30000);
  }, []);
  const prevHasActiveRunRef = useRef(hasActiveRun);
  useEffect(() => {
    if (prevHasActiveRunRef.current && !hasActiveRun) {
      triggerStreamLinger();
    }
    prevHasActiveRunRef.current = hasActiveRun;
  }, [hasActiveRun, triggerStreamLinger]);
  const prevBgTasksRef = useRef<readonly BackgroundTaskView[]>(sessionBackgroundTasks);
  useEffect(() => {
    const prev = prevBgTasksRef.current;
    const prevById = new Map(prev.map((task) => [task.taskId, task]));
    const now = Date.now();
    let completionObserved = false;
    for (const task of sessionBackgroundTasks) {
      const previous = prevById.get(task.taskId);
      if (previous === undefined) {
        // A task observed for the first time already in a terminal state is a
        // fast command that completed within one poll cycle. Only treat it as a
        // fresh completion when it started recently — pre-existing COMPLETED
        // tasks loaded from session history have an old startedAt and must NOT
        // trigger a spurious stream linger.
        if (task.status !== 'RUNNING' && now - task.startedAt < 60_000) {
          completionObserved = true;
        }
      } else if (previous.status === 'RUNNING' && task.status !== 'RUNNING') {
        completionObserved = true;
      }
    }
    prevBgTasksRef.current = sessionBackgroundTasks;
    if (!completionObserved) {
      return;
    }
    triggerStreamLinger();
  }, [sessionBackgroundTasks, triggerStreamLinger]);
  const shouldOpenAnchoredBackgroundStream =
    isAnchoredConversation && (hasInFlightRequest || acceptedRun !== null || hasRunningBackgroundTask || streamLinger);
  const canOpenStream = Boolean(
    routeSessionId &&
    (!isAnchoredConversation || shouldOpenAnchoredBackgroundStream) &&
    (activeConversationLoadState === 'ready' || shouldDeferSnapshotLoad),
  );
  const composerInlineNotice = uploadError ?? submitError ?? editError ?? retryError ?? cancelError;
  const shouldShowStreamStatus =
    activeRuntimeState.continuityPhase === 'reconnecting' ||
    activeRuntimeState.continuityPhase === 'resyncing' ||
    activeRuntimeState.continuityPhase === 'disconnected';
  const [showDelayedReconnectingStatus, setShowDelayedReconnectingStatus] = useState(false);
  useEffect(() => {
    if (activeRuntimeState.continuityPhase !== 'reconnecting') {
      setShowDelayedReconnectingStatus(false);
      return undefined;
    }

    const timeout = setTimeout(() => {
      setShowDelayedReconnectingStatus(true);
    }, STREAM_RECONNECTING_STATUS_DELAY_MS);
    return () => clearTimeout(timeout);
  }, [activeRuntimeState.continuityPhase, activeRuntimeState.continuityMessage]);
  const shouldRenderStreamStatus =
    activeRuntimeState.continuityPhase === 'reconnecting'
      ? showDelayedReconnectingStatus && Boolean(activeRuntimeState.continuityMessage)
      : shouldShowStreamStatus && Boolean(activeRuntimeState.continuityMessage);

  useEffect(() => {
    if (!routeSessionId || activeConversationLoadState !== 'failed') {
      return;
    }
    navigation.onSessionLoadFailure?.(routeSessionId);
    if (conversationError) {
      antdMessage.error(conversationError);
    }
    if (conversationErrorCode === 'SESSION_NOT_FOUND') {
      navigation.openNewSession({ replace: true });
    }
  }, [routeSessionId, activeConversationLoadState, conversationError, conversationErrorCode, navigation]);

  useEffect(() => {
    if (!routeSessionId) {
      return;
    }
    setRuntimeState(routeSessionId, { activeRootMessageId: latestRootMessageId });
  }, [latestRootMessageId, routeSessionId, setRuntimeState]);

  useEffect(() => {
    const preferredLimit = getPreferredSessionListInitialLimit();
    setHistoryWindowLimit(preferredLimit);
    if (useSessionStore.getState().isLoadingHistory) {
      return;
    }
    void loadSessions({ limit: preferredLimit, query: {} });
  }, [loadSessions, setHistoryWindowLimit]);

  useEffect(() => {
    if (!routeSessionId) {
      hasDisplayedConversationRef.current = false;
      return;
    }
    if (turnBlocks.length > 0 || isConversationTransitioning) {
      hasDisplayedConversationRef.current = true;
    }
  }, [routeSessionId, turnBlocks.length, isConversationTransitioning]);

  const {
    composerHydratedInput,
    composerInputVersion,
    submittedMessageHistory,
    editMode,
    showEditSubmitNotice,
    canRetryLatest,
    showRetryLatestButton,
    canEditLatest,
    attachmentItems,
    attachmentNotice,
    uploadExpireNotice,
    setComposerDraft,
    hydrateComposerInput,
    injectQuestion,
    handleSend,
    handleAddAttachments,
    handleRemoveAttachment,
    handleRetryAttachment,
    handleEditRequest,
    handleEditLatest,
    handleCancelEdit,
    handleRetryRequest,
    handleRetryLatest,
    handleCancelRequest,
  } = useChatComposerController({
    navigation,
    turnBlocks,
  });

  useEffect(() => {
    if (!composerBridgeRef) {
      return undefined;
    }
    const bridge: ChatComposerBridge = {
      sendQuestion: injectQuestion,
    };
    composerBridgeRef.current = bridge;
    return () => {
      if (composerBridgeRef.current === bridge) {
        composerBridgeRef.current = null;
      }
    };
  }, [composerBridgeRef, injectQuestion]);

  const requestConversationPreviewWindow = useCallback(
    async (sessionId: string, windowIndex: ConversationPreviewWindowTarget, options?: { force?: boolean }) => {
      if (typeof windowIndex === 'number' && windowIndex < 0) {
        return false;
      }
      const key = previewWindowKey(sessionId, windowIndex);
      if (!options?.force && previewLoadedWindowsRef.current.has(key)) {
        return true;
      }
      if (
        !options?.force &&
        typeof windowIndex === 'number' &&
        isPreviewWindowLoaded(useConversationStore.getState().conversationPreviewBySession[sessionId], windowIndex)
      ) {
        previewLoadedWindowsRef.current.add(key);
        return true;
      }
      if (previewLoadingWindowsRef.current.has(key)) {
        return false;
      }
      const failedAt = previewFailedWindowsRef.current.get(key);
      if (!options?.force && failedAt !== undefined && Date.now() - failedAt < CONVERSATION_PREVIEW_FAILURE_COOLDOWN_MS) {
        return false;
      }
      const sessionInFlightCount = Array.from(previewLoadingWindowsRef.current).filter((loadingKey) => loadingKey.startsWith(`${sessionId}:`)).length;
      if (sessionInFlightCount >= CONVERSATION_PREVIEW_MAX_IN_FLIGHT) {
        return false;
      }
      previewLoadingWindowsRef.current.add(key);
      const loaded = await loadConversationPreview(sessionId, {
        ...(windowIndex === 'latest' ? {} : { offset: windowIndex * CONVERSATION_PREVIEW_WINDOW_SIZE }),
        limit: CONVERSATION_PREVIEW_WINDOW_SIZE,
      });
      previewLoadingWindowsRef.current.delete(key);
      if (loaded) {
        previewLoadedWindowsRef.current.add(key);
        previewFailedWindowsRef.current.delete(key);
      } else {
        previewFailedWindowsRef.current.set(key, Date.now());
      }
      const desiredRange = previewVisibleRangeRef.current;
      if (desiredRange?.sessionId === sessionId) {
        for (const nextWindowIndex of collectPreviewWindowIndexes(desiredRange)) {
          if (nextWindowIndex !== windowIndex) {
            void requestConversationPreviewWindow(sessionId, nextWindowIndex);
          }
        }
      }
      return loaded;
    },
    [loadConversationPreview],
  );

  const handlePreviewVisibleRangeChange = useCallback(
    (range: ConversationPreviewVisibleRange) => {
      if (!routeSessionId) {
        return;
      }
      previewVisibleRangeRef.current = { ...range, sessionId: routeSessionId };
      for (const windowIndex of collectPreviewWindowIndexes(range)) {
        void requestConversationPreviewWindow(routeSessionId, windowIndex);
      }
    },
    [requestConversationPreviewWindow, routeSessionId],
  );

  useEffect(() => {
    previewVisibleRangeRef.current = null;
    previewLoadedWindowsRef.current.clear();
    previewLoadingWindowsRef.current.clear();
    previewFailedWindowsRef.current.clear();
    previewAnchoredNewerSuppressionTopRef.current = null;
    anchoredNewerUserScrollIntentRef.current = false;
    anchoredNewerUserScrollIntentSourceRef.current = null;
    setAnchoredNewerAutoLoadLockedState(false);
    conversationScrollTopRef.current = 0;
    if (!routeSessionId) {
      return;
    }
    void requestConversationPreviewWindow(routeSessionId, 'latest', { force: true });
  }, [requestConversationPreviewWindow, routeSessionId, setAnchoredNewerAutoLoadLockedState]);

  const refreshConversationPreviewTail = useCallback(
    async (sessionId: string) => {
      const previewState = useConversationStore.getState().conversationPreviewBySession[sessionId];
      const totalMarkers = previewState?.totalMarkers ?? 0;
      const tailWindowIndex = previewWindowIndexForMarker(Math.max(0, totalMarkers - 1));
      await requestConversationPreviewWindow(sessionId, tailWindowIndex, { force: true });
      if (totalMarkers > 0 && totalMarkers % CONVERSATION_PREVIEW_WINDOW_SIZE === 0) {
        await requestConversationPreviewWindow(sessionId, tailWindowIndex + 1, { force: true });
      }
    },
    [requestConversationPreviewWindow],
  );

  const loadFavoriteAnchor = useCallback(
    (sessionId: string, messageId: string) => {
      const key = `${sessionId}:${messageId}`;
      if (favoriteAnchorLoadRef.current?.key === key) {
        return favoriteAnchorLoadRef.current.promise;
      }
      const promise = loadAnchoredConversation(sessionId, messageId).finally(() => {
        if (favoriteAnchorLoadRef.current?.key === key) {
          favoriteAnchorLoadRef.current = null;
        }
      });
      favoriteAnchorLoadRef.current = { key, promise };
      return promise;
    },
    [loadAnchoredConversation],
  );

  const clearFavoriteRoute = useCallback(
    (sessionId: string, messageId: string) => {
      if (routeSessionIdRef.current !== sessionId || navigationMessageIdRef.current !== messageId) {
        return;
      }
      navigation.openSession(sessionId, { replace: true });
    },
    [navigation],
  );

  const loadConversationWithPreviewRefresh = useCallback(
    async (
      sessionId: string,
      options?: {
        background?: boolean;
        merge?: boolean;
        requiredRootMessageId?: string;
        preserveRequestId?: string;
      },
    ) => {
      const loaded = await loadConversation(sessionId, options);
      if (options?.requiredRootMessageId) {
        void refreshConversationPreviewTail(sessionId);
      }
      return loaded;
    },
    [loadConversation, refreshConversationPreviewTail],
  );

  useEffect(() => {
    if (!routeSessionId || !navigation.messageId) {
      return undefined;
    }
    const sessionId = routeSessionId;
    const messageId = navigation.messageId;
    let active = true;
    void loadFavoriteAnchor(sessionId, messageId).then((loaded) => {
      if (active && !loaded) {
        clearFavoriteRoute(sessionId, messageId);
      }
    });
    return () => {
      active = false;
    };
  }, [clearFavoriteRoute, loadFavoriteAnchor, navigation.messageId, routeSessionId]);

  const { handleReloadConversation } = useChatSessionStream({
    sessionId: routeSessionId,
    canOpenStream,
    isExecuting,
    hasInFlightRequest,
    activeRun: activeRuntimeState.activeRun,
    acceptedRun,
    hasLocalEnvelopes,
    shouldDeferSnapshotLoad,
    activeRequestRootMessageId,
    ...(activeSessionActiveBuckets ? { activeLiveByRoot: activeSessionActiveBuckets } : {}),
    ...(activeSessionSettledBuckets ? { settledLiveByRoot: activeSessionSettledBuckets } : {}),
    turnBlocks,
    suppressAutomaticSnapshotRefresh: isAnchoredConversation || Boolean(navigation.messageId),
    appendEnvelope,
    appendEnvelopes,
    setStreaming,
    setStreamConnectionState,
    loadConversation: loadConversationWithPreviewRefresh,
    loadSessions,
    settleRequestFromTerminal,
    acceptRequestFromStream,
    reconcilePendingRequestFromLiveEnvelope,
    onSessionEntrySnapshot: handleSessionEntrySnapshot,
  });

  const shouldShowWelcome =
    !routeSessionId ||
    (!hasDisplayedConversationRef.current && turnBlocks.length === 0 && !isConversationTransitioning && activeConversationLoadState !== 'loading');
  const hasReplayContent = Boolean(aboveMessagesSlot);
  const effectiveShouldShowWelcome = hasReplayContent ? false : shouldShowWelcome;
  const shouldShowConversationPreview =
    !shouldShowWelcome && (conversationPaneWidth === null || conversationPaneWidth >= CONVERSATION_PREVIEW_MIN_PANE_WIDTH_PX);

  const {
    scrollViewportRef,
    isAtBottom,
    isFollowingBottom,
    readIsFollowingBottom,
    hasNewMessages,
    handleScroll,
    handleViewportWheel,
    handleAnchorCompensation,
    handleAsyncContentLayoutChange,
    stopFollowingBottom,
    scrollToBottom,
    requestScrollToBottomIfFollowing,
    requestLoadOlderIfNearTop,
  } = useChatViewportController({
    sessionId: routeSessionId,
    latestEnvelopeCursor,
    turnBlockCursor,
    isConversationLoading,
    shouldShowWelcome: effectiveShouldShowWelcome,
    isAnchoredConversation: isAnchoredConversation || Boolean(navigation.messageId),
    activeSessionEventCount: activeSessionActiveLayer.length + activeSessionSettledLayer.length,
    hasOlderMessages: Boolean(activeConversationPageInfo?.nextCursor),
    isLoadingOlder: Boolean(activeConversationPageInfo?.isLoadingOlder),
    loadOlderConversation,
  });

  useLayoutEffect(() => {
    if (!hasReplayContent) {
      return;
    }
    requestAnimationFrame(() => scrollToBottom());
  }, [hasReplayContent, scrollToBottom]);

  const loadAnchoredNewerPage = useCallback(
    async (sessionId: string) => {
      const pageInfo = useConversationStore.getState().conversationPageInfoBySession[sessionId];
      if (!pageInfo?.newerCursor || pageInfo.isLoadingNewer) {
        return false;
      }

      const startingWindow = activeConversationWindowRef.current;
      const startingScrollTop = scrollViewportRef.current?.scrollTop ?? conversationScrollTopRef.current;
      const loadingGestureId = anchoredNewerInputGestureRef.current.id;
      setAnchoredNewerAutoLoadLockedState(true, startingScrollTop, loadingGestureId);
      const loaded = await loadNewerConversation(sessionId);
      const currentWindow = activeConversationWindowRef.current;
      if (
        currentWindow.sessionId !== startingWindow.sessionId ||
        currentWindow.mode !== startingWindow.mode ||
        currentWindow.activeAnchorMessageId !== startingWindow.activeAnchorMessageId
      ) {
        return loaded;
      }
      const nextPageInfo = useConversationStore.getState().conversationPageInfoBySession[sessionId];
      if (!nextPageInfo?.newerCursor || anchoredNewerUserScrollIntentSourceRef.current !== 'pointer') {
        anchoredNewerUserScrollIntentRef.current = false;
        anchoredNewerUserScrollIntentSourceRef.current = null;
      }
      const settledScrollTop = scrollViewportRef.current?.scrollTop ?? startingScrollTop;
      setAnchoredNewerAutoLoadLockedState(Boolean(nextPageInfo?.newerCursor), settledScrollTop, loadingGestureId);
      return loaded;
    },
    [loadNewerConversation, scrollViewportRef, setAnchoredNewerAutoLoadLockedState],
  );

  const maybeLoadNewerAnchoredConversation = useCallback(
    (options?: { readonly allowStationaryUserScroll?: boolean }) => {
      if (!routeSessionId || activeConversationView.mode !== 'anchored' || activeConversationPageInfo?.isLoadingNewer || isConversationLoading) {
        return;
      }

      const viewport = scrollViewportRef.current;
      if (!viewport) {
        return;
      }

      const currentScrollTop = viewport.scrollTop;
      const previousScrollTop = conversationScrollTopRef.current;
      conversationScrollTopRef.current = currentScrollTop;
      if (currentScrollTop < previousScrollTop - 1) {
        anchoredNewerUserScrollIntentRef.current = false;
        anchoredNewerUserScrollIntentSourceRef.current = null;
        return;
      }
      const movedDown = currentScrollTop > previousScrollTop + 1;
      if (!anchoredNewerUserScrollIntentRef.current || (!movedDown && !options?.allowStationaryUserScroll)) {
        return;
      }

      const suppressedAtTop = previewAnchoredNewerSuppressionTopRef.current;
      if (suppressedAtTop !== null) {
        if (currentScrollTop <= suppressedAtTop + 1) {
          return;
        }
        previewAnchoredNewerSuppressionTopRef.current = null;
      }

      const boundary = anchoredNewerBoundaryRef.current;
      const boundaryDistanceFromViewportBottom = boundary
        ? boundary.getBoundingClientRect().top - viewport.getBoundingClientRect().bottom
        : Number.POSITIVE_INFINITY;
      const distanceFromBottom = viewport.scrollHeight - currentScrollTop - viewport.clientHeight;
      if (!activeConversationPageInfo?.newerCursor) {
        const activeAnchorMessageId = activeConversationView.activeAnchorMessageId;
        if (
          activeAnchorMessageId &&
          distanceFromBottom <= ANCHORED_LATEST_BOTTOM_THRESHOLD_PX &&
          completeAnchoredConversation(routeSessionId, activeAnchorMessageId)
        ) {
          previewAnchoredNewerSuppressionTopRef.current = null;
          anchoredNewerUserScrollIntentRef.current = false;
          anchoredNewerUserScrollIntentSourceRef.current = null;
          setAnchoredNewerAutoLoadLockedState(false);
          scrollToBottom();
        }
        return;
      }
      const isNearNewerBoundary =
        boundaryDistanceFromViewportBottom <= ANCHORED_NEWER_LOAD_THRESHOLD_PX || distanceFromBottom <= ANCHORED_NEWER_LOAD_THRESHOLD_PX;
      if (anchoredNewerAutoLoadLockedRef.current) {
        const lockedTop = anchoredNewerAutoLoadLockedTopRef.current ?? previousScrollTop;
        const lockedGestureId = anchoredNewerAutoLoadLockedGestureRef.current;
        const releaseDistance = Math.max(ANCHORED_NEWER_LOCK_RELEASE_MIN_DISTANCE_PX, viewport.clientHeight * 0.5);
        const isNextInputGesture =
          Boolean(options?.allowStationaryUserScroll) && lockedGestureId !== null && anchoredNewerInputGestureRef.current.id > lockedGestureId;
        if (!isNextInputGesture && currentScrollTop <= lockedTop + releaseDistance) {
          return;
        }
        setAnchoredNewerAutoLoadLockedState(false);
      }

      if (isNearNewerBoundary) {
        void loadAnchoredNewerPage(routeSessionId);
      }
    },
    [
      activeConversationPageInfo?.isLoadingNewer,
      activeConversationPageInfo?.newerCursor,
      activeConversationView.activeAnchorMessageId,
      activeConversationView.mode,
      completeAnchoredConversation,
      isConversationLoading,
      loadAnchoredNewerPage,
      routeSessionId,
      scrollToBottom,
      scrollViewportRef,
      setAnchoredNewerAutoLoadLockedState,
    ],
  );

  const handleConversationScroll = useCallback(() => {
    handleScroll();
    maybeLoadNewerAnchoredConversation();
  }, [handleScroll, maybeLoadNewerAnchoredConversation]);

  const markAnchoredNewerUserScrollIntent = useCallback(
    (source: 'wheel' | 'pointer' | 'keyboard') => {
      if (activeConversationView.mode === 'anchored') {
        anchoredNewerUserScrollIntentRef.current = true;
        anchoredNewerUserScrollIntentSourceRef.current = source;
      }
    },
    [activeConversationView.mode],
  );

  const markAnchoredNewerWheelGesture = useCallback(
    (event: ReactWheelEvent<HTMLDivElement>) => {
      if (activeConversationView.mode !== 'anchored') {
        return;
      }
      const nextTimestamp = event.timeStamp;
      const gesture = anchoredNewerInputGestureRef.current;
      if (gesture.lastTimestamp === 0 || nextTimestamp - gesture.lastTimestamp > ANCHORED_NEWER_WHEEL_GESTURE_GAP_MS) {
        gesture.id += 1;
      }
      gesture.lastTimestamp = nextTimestamp;
    },
    [activeConversationView.mode],
  );

  const handleConversationWheel = useCallback(
    (event: ReactWheelEvent<HTMLDivElement>) => {
      handleViewportWheel(event);
      if (event.deltaY > 0) {
        markAnchoredNewerWheelGesture(event);
        markAnchoredNewerUserScrollIntent('wheel');
        maybeLoadNewerAnchoredConversation({ allowStationaryUserScroll: true });
      }
    },
    [handleViewportWheel, markAnchoredNewerUserScrollIntent, markAnchoredNewerWheelGesture, maybeLoadNewerAnchoredConversation],
  );

  const handleConversationPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const targetsViewport = event.target === event.currentTarget;
      const isTouchLikePointer = event.pointerType === 'touch' || event.pointerType === 'pen';
      if (targetsViewport || isTouchLikePointer) {
        markAnchoredNewerUserScrollIntent('pointer');
      }
    },
    [markAnchoredNewerUserScrollIntent],
  );

  const handleConversationKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>) => {
      if (event.target !== event.currentTarget) {
        return;
      }
      const isSpace = event.key === ' ' || event.key === 'Spacebar';
      const isUpwardNavigationKey = event.key === 'ArrowUp' || event.key === 'PageUp' || event.key === 'Home' || (isSpace && event.shiftKey);
      if (isUpwardNavigationKey && !event.altKey && !event.ctrlKey && !event.metaKey) {
        requestLoadOlderIfNearTop();
        return;
      }
      if (activeConversationView.mode !== 'anchored') {
        return;
      }
      const isDownwardNavigationKey = event.key === 'ArrowDown' || event.key === 'PageDown' || event.key === 'End' || isSpace;
      if (!isDownwardNavigationKey || event.altKey || event.ctrlKey || event.metaKey || (isSpace && event.shiftKey)) {
        return;
      }
      const gesture = anchoredNewerInputGestureRef.current;
      gesture.id += 1;
      gesture.lastTimestamp = event.timeStamp;
      markAnchoredNewerUserScrollIntent('keyboard');
      maybeLoadNewerAnchoredConversation({ allowStationaryUserScroll: true });
    },
    [activeConversationView.mode, markAnchoredNewerUserScrollIntent, maybeLoadNewerAnchoredConversation, requestLoadOlderIfNearTop],
  );

  const resolveConversationAnchorRootMessageId = useCallback(
    (anchorId: string): string => {
      const matchingMessage = activeSessionHistoryMessages.find((message) => conversationMessageMatchesAnchor(message, anchorId));
      if (matchingMessage) {
        return conversationMessageRootId(matchingMessage);
      }

      const latestSessionMessages = routeSessionId ? (useConversationStore.getState().historyMessagesBySession[routeSessionId] ?? []) : [];
      const matchingStoreMessage = latestSessionMessages.find((message) => conversationMessageMatchesAnchor(message, anchorId));
      if (matchingStoreMessage) {
        return conversationMessageRootId(matchingStoreMessage);
      }

      const matchingBlock = turnBlocks.find(
        (block) =>
          block.rootMessageId === anchorId ||
          block.userMessage.messageId === anchorId ||
          block.aiEvents.some((event) => {
            const payload = event.payload as { readonly messageId?: unknown };
            return (
              event.eventId === anchorId ||
              event.requestId === anchorId ||
              event.requestContextId === anchorId ||
              event.rootMessageId === anchorId ||
              payload.messageId === anchorId
            );
          }),
      );
      return matchingBlock?.rootMessageId ?? anchorId;
    },
    [activeSessionHistoryMessages, routeSessionId, turnBlocks],
  );

  const scrollToRootMessage = useCallback(
    (messageId: string, behavior: ScrollBehavior = 'smooth') => {
      const rootMessageId = resolveConversationAnchorRootMessageId(messageId);
      const targetIds = Array.from(new Set([messageId, rootMessageId]));
      const target = [...document.querySelectorAll<HTMLElement>('[data-root-message-id]')].find((element) =>
        targetIds.includes(element.dataset.rootMessageId ?? ''),
      );
      const viewport = scrollViewportRef.current;
      if (!target || !viewport) {
        return false;
      }
      const targetRect = target.getBoundingClientRect();
      const viewportRect = viewport.getBoundingClientRect();
      const targetTop = viewport.scrollTop + targetRect.top - viewportRect.top - 24;
      const maxScrollTop = Math.max(0, viewport.scrollHeight - viewport.clientHeight);
      const nextScrollTop = Math.min(maxScrollTop, Math.max(0, targetTop));
      if (typeof viewport.scrollTo === 'function') {
        viewport.scrollTo({ top: nextScrollTop, behavior });
      } else {
        viewport.scrollTop = nextScrollTop;
      }
      return true;
    },
    [resolveConversationAnchorRootMessageId, scrollViewportRef],
  );
  const scrollToRootMessageRef = useRef(scrollToRootMessage);
  scrollToRootMessageRef.current = scrollToRootMessage;

  const completePendingFavoriteNavigation = useCallback(
    (messageId: string) => {
      const pendingNavigation = pendingFavoriteNavigationRef.current;
      if (!pendingNavigation || pendingNavigation.messageId !== messageId || routeSessionIdRef.current !== pendingNavigation.sessionId) {
        return;
      }
      pendingFavoriteNavigationRef.current = null;
      clearFavoriteRoute(pendingNavigation.sessionId, pendingNavigation.messageId);
    },
    [clearFavoriteRoute],
  );

  const suppressAnchoredNewerAutoLoadAtCurrentScroll = useCallback(() => {
    const viewport = scrollViewportRef.current;
    const scrollTop = viewport?.scrollTop ?? 0;
    previewAnchoredNewerSuppressionTopRef.current = scrollTop;
    anchoredNewerUserScrollIntentRef.current = false;
    anchoredNewerUserScrollIntentSourceRef.current = null;
    setAnchoredNewerAutoLoadLockedState(false);
    conversationScrollTopRef.current = scrollTop;
  }, [scrollViewportRef, setAnchoredNewerAutoLoadLockedState]);

  const scrollToRootMessageAfterRender = useCallback(
    (messageId: string) => {
      if (previewScrollRetryingMessageIdRef.current === messageId) {
        return;
      }
      previewScrollRetryingMessageIdRef.current = messageId;
      let remainingAttempts = PREVIEW_ANCHOR_SCROLL_MAX_ATTEMPTS;
      let remainingSettleAttempts = PREVIEW_ANCHOR_SCROLL_SETTLE_ATTEMPTS;
      const attemptScroll = () => {
        if (pendingPreviewScrollMessageIdRef.current !== messageId) {
          previewScrollRetryingMessageIdRef.current = null;
          return;
        }
        if (scrollToRootMessageRef.current(messageId, 'auto')) {
          suppressAnchoredNewerAutoLoadAtCurrentScroll();
          if (remainingSettleAttempts <= 0) {
            if (pendingPreviewScrollMessageIdRef.current === messageId) {
              pendingPreviewScrollMessageIdRef.current = null;
            }
            previewScrollRetryingMessageIdRef.current = null;
            completePendingFavoriteNavigation(messageId);
            return;
          }
          remainingSettleAttempts -= 1;
          window.requestAnimationFrame(attemptScroll);
          return;
        }
        if (remainingAttempts <= 0) {
          previewScrollRetryingMessageIdRef.current = null;
          completePendingFavoriteNavigation(messageId);
          return;
        }
        remainingAttempts -= 1;
        window.requestAnimationFrame(attemptScroll);
      };
      window.requestAnimationFrame(attemptScroll);
    },
    [completePendingFavoriteNavigation, suppressAnchoredNewerAutoLoadAtCurrentScroll],
  );

  const selectPreviewProcessHistoryTarget = useCallback(
    (messageId: string, navigationGeneration: number) => {
      if (!routeSessionId || previewNavigationGenerationRef.current !== navigationGeneration) {
        return;
      }
      const rootMessageId = resolveConversationAnchorRootMessageId(messageId);
      const store = useConversationStore.getState();
      const runId = store.displayProcessRunByRootBySession[routeSessionId]?.[rootMessageId];
      if (!runId) {
        return;
      }
      setExplicitProcessHistoryTarget(routeSessionId, 'preview', {
        sessionId: routeSessionId,
        rootMessageId,
        runId,
        priority: 'EXPLICIT',
        distanceFromViewportCenter: 0,
        retention: 'WHILE_TARGETED',
      });
    },
    [resolveConversationAnchorRootMessageId, routeSessionId, setExplicitProcessHistoryTarget],
  );

  useLayoutEffect(() => {
    const messageId = pendingPreviewScrollMessageIdRef.current;
    if (!messageId || activeConversationLoadState === 'loading') {
      return;
    }
    scrollToRootMessageAfterRender(messageId);
  }, [activeConversationLoadState, scrollToRootMessageAfterRender, turnBlockCursor]);

  useLayoutEffect(() => {
    if (navigation.messageId) {
      stopFollowingBottom();
    }
  }, [navigation.messageId, stopFollowingBottom]);

  // When navigating from the favorites list, scroll to the target turn after
  // the conversation finishes loading. If the turn is not in the current page,
  // load the anchored conversation around that message first.
  useEffect(() => {
    const targetMessageId = navigation.messageId;
    if (!targetMessageId) {
      processedFavoriteMessageIdRef.current = null;
      pendingFavoriteNavigationRef.current = null;
      return;
    }
    if (
      !routeSessionId ||
      activeConversationLoadState !== 'ready' ||
      activeConversationView.mode !== 'anchored' ||
      activeConversationView.activeAnchorMessageId !== targetMessageId
    ) {
      return;
    }
    const favoriteTargetKey = `${routeSessionId}:${targetMessageId}`;
    if (processedFavoriteMessageIdRef.current === favoriteTargetKey) {
      return;
    }
    const finishFavoriteNavigation = () => {
      processedFavoriteMessageIdRef.current = favoriteTargetKey;
      pendingFavoriteNavigationRef.current = {
        sessionId: routeSessionId,
        messageId: targetMessageId,
      };
      pendingPreviewScrollMessageIdRef.current = targetMessageId;
      suppressAnchoredNewerAutoLoadAtCurrentScroll();
      scrollToRootMessageAfterRender(targetMessageId);
    };
    stopFollowingBottom();
    if (scrollToRootMessage(targetMessageId)) {
      finishFavoriteNavigation();
      return;
    }
    finishFavoriteNavigation();
  }, [
    activeConversationLoadState,
    activeConversationView.activeAnchorMessageId,
    activeConversationView.mode,
    navigation,
    routeSessionId,
    scrollToRootMessage,
    scrollToRootMessageAfterRender,
    stopFollowingBottom,
    suppressAnchoredNewerAutoLoadAtCurrentScroll,
  ]);

  const handlePreviewMarkerNavigate = useCallback(
    async (marker: ConversationPreviewMarker) => {
      if (!routeSessionId) {
        return;
      }
      const navigationGeneration = previewNavigationGenerationRef.current + 1;
      previewNavigationGenerationRef.current = navigationGeneration;
      setExplicitProcessHistoryTarget(routeSessionId, 'preview', null);
      stopFollowingBottom();
      pendingPreviewScrollMessageIdRef.current = marker.messageId;
      if (scrollToRootMessage(marker.messageId)) {
        suppressAnchoredNewerAutoLoadAtCurrentScroll();
        scrollToRootMessageAfterRender(marker.messageId);
        selectPreviewProcessHistoryTarget(marker.messageId, navigationGeneration);
        return;
      }
      const loaded = await loadAnchoredConversation(routeSessionId, marker.messageId);
      if (previewNavigationGenerationRef.current !== navigationGeneration) {
        return;
      }
      if (loaded) {
        scrollToRootMessageAfterRender(marker.messageId);
        selectPreviewProcessHistoryTarget(marker.messageId, navigationGeneration);
      } else if (pendingPreviewScrollMessageIdRef.current === marker.messageId) {
        pendingPreviewScrollMessageIdRef.current = null;
      }
    },
    [
      loadAnchoredConversation,
      routeSessionId,
      scrollToRootMessage,
      scrollToRootMessageAfterRender,
      selectPreviewProcessHistoryTarget,
      setExplicitProcessHistoryTarget,
      stopFollowingBottom,
      suppressAnchoredNewerAutoLoadAtCurrentScroll,
    ],
  );

  const handlePreviewIndexNavigate = useCallback(
    async (markerIndex: number) => {
      if (!routeSessionId) {
        return;
      }
      const navigationGeneration = previewNavigationGenerationRef.current + 1;
      previewNavigationGenerationRef.current = navigationGeneration;
      setExplicitProcessHistoryTarget(routeSessionId, 'preview', null);
      const navigationSessionId = routeSessionId;
      const windowIndex = previewWindowIndexForMarker(markerIndex);
      const loaded = await requestConversationPreviewWindow(navigationSessionId, windowIndex, { force: true });
      if (!loaded || routeSessionIdRef.current !== navigationSessionId || previewNavigationGenerationRef.current !== navigationGeneration) {
        return;
      }
      const marker = useConversationStore.getState().conversationPreviewBySession[navigationSessionId]?.markersByIndex[markerIndex];
      if (marker !== undefined) {
        await handlePreviewMarkerNavigate(marker);
      }
    },
    [handlePreviewMarkerNavigate, requestConversationPreviewWindow, routeSessionId, setExplicitProcessHistoryTarget],
  );

  const handleReturnToLatest = useCallback(async () => {
    if (!routeSessionId) {
      return;
    }
    const loaded = await loadConversation(routeSessionId);
    if (loaded) {
      previewAnchoredNewerSuppressionTopRef.current = null;
      anchoredNewerUserScrollIntentRef.current = false;
      anchoredNewerUserScrollIntentSourceRef.current = null;
      setAnchoredNewerAutoLoadLockedState(false);
      window.requestAnimationFrame(() => scrollToBottom());
    }
  }, [loadConversation, routeSessionId, scrollToBottom, setAnchoredNewerAutoLoadLockedState]);

  const handleAutomaticProcessHistoryTargetsChange = useCallback(
    (targets: ProcessHistoryTargetUpdate) => {
      if (routeSessionId) {
        updateAutomaticProcessHistoryTargets(routeSessionId, targets.automatic);
      }
    },
    [routeSessionId, updateAutomaticProcessHistoryTargets],
  );

  const handleProcessPanelExpansionChange = useCallback(
    (rootMessageId: string, runId: string, expanded: boolean) => {
      if (!routeSessionId) {
        return;
      }
      const sourceKey = `panel:${rootMessageId}`;
      if (!expanded) {
        setExplicitProcessHistoryTarget(routeSessionId, sourceKey, null);
        return;
      }
      setExplicitProcessHistoryTarget(routeSessionId, sourceKey, {
        sessionId: routeSessionId,
        rootMessageId,
        runId,
        priority: 'EXPLICIT',
        distanceFromViewportCenter: 0,
      });
    },
    [routeSessionId, setExplicitProcessHistoryTarget],
  );
  const handleRetryRunProcessHistory = useCallback(
    (runId: string) => {
      if (routeSessionId) {
        retryRunProcessHistory(routeSessionId, runId);
      }
    },
    [retryRunProcessHistory, routeSessionId],
  );

  const handleSendWithPreviewTail = useCallback(
    async (message: string) => {
      await handleSend(message);
      requestScrollToBottomIfFollowing();
      const previewSessionId = routeSessionId ?? useSessionStore.getState().activeSessionId;
      if (previewSessionId) {
        void refreshConversationPreviewTail(previewSessionId);
      }
    },
    [handleSend, refreshConversationPreviewTail, requestScrollToBottomIfFollowing, routeSessionId],
  );

  useEffect(() => {
    clearRequestNotices();
    setForkingAnchorKey(null);
  }, [routeSessionId, clearRequestNotices]);

  useEffect(() => {
    if (retryLimitNotice === null) {
      return;
    }
    antdMessage.warning(retryLimitNotice.message);
    clearRetryLimitNotice();
  }, [retryLimitNotice, clearRetryLimitNotice]);

  const handleFork = useCallback(
    async (anchor: ForkTriggerAnchor) => {
      if (!routeSessionId) {
        return;
      }
      const anchorKey = forkTriggerAnchorKey(anchor);
      setForkingAnchorKey(anchorKey);
      try {
        const idempotencyKey = crypto.randomUUID();
        const childSession =
          anchor.kind === 'message'
            ? await sessionService.forkSessionFromMessage({
                sessionId: routeSessionId,
                messageId: anchor.messageId,
                idempotencyKey,
              })
            : await sessionService.forkSessionFromRequest({
                sessionId: routeSessionId,
                requestId: anchor.requestId,
                idempotencyKey,
              });
        setActiveSessionId(childSession.sessionId);
        navigation.openSession(childSession.sessionId);
        const preferredLimit = getPreferredSessionListInitialLimit();
        setHistoryWindowLimit(preferredLimit);
        void loadSessions({ limit: preferredLimit, query: {} });
      } catch {
        void antdMessage.error(t('requestNotices.forkFailed'));
      } finally {
        setForkingAnchorKey((current) => (current === anchorKey ? null : current));
      }
    },
    [loadSessions, navigation, routeSessionId, setActiveSessionId, setHistoryWindowLimit, t],
  );

  const handleOpenFullProcess = useCallback(
    (block: TurnBlock, opener: HTMLButtonElement) => {
      expandPanelStore.getState().close();
      stopGraphResize();
      graphOpenerRef.current = opener;
      setSelectedDetailRootMessageId(block.rootMessageId);
    },
    [stopGraphResize],
  );

  const handleCloseFullProcess = useCallback(() => {
    stopGraphResize();
    setSelectedDetailRootMessageId(null);
    const opener = graphOpenerRef.current;
    graphOpenerRef.current = null;
    window.setTimeout(() => {
      if (opener && document.contains(opener)) {
        opener.focus();
      }
    }, 0);
  }, [stopGraphResize]);

  const handleGraphResizePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      event.preventDefault();
      stopGraphResize();
      const startX = event.clientX;
      const startWidth = graphDetailWidth;

      const handlePointerMove = (moveEvent: PointerEvent) => {
        const nextWidth = startWidth - (moveEvent.clientX - startX);
        setGraphDetailWidth(clampGraphDetailWidth(nextWidth, readContainerWidth(graphLayoutRef)));
      };
      const handlePointerUp = () => {
        stopGraphResize();
      };
      const cleanup = () => {
        window.removeEventListener('pointermove', handlePointerMove);
        window.removeEventListener('pointerup', handlePointerUp);
        window.removeEventListener('pointercancel', handlePointerUp);
        window.removeEventListener('blur', handlePointerUp);
      };

      window.addEventListener('pointermove', handlePointerMove);
      window.addEventListener('pointerup', handlePointerUp);
      window.addEventListener('pointercancel', handlePointerUp);
      window.addEventListener('blur', handlePointerUp);
      graphResizeCleanupRef.current = cleanup;
    },
    [graphDetailWidth, stopGraphResize],
  );

  const handleGraphResizeKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>) => {
      let nextWidth: number | null = null;
      const containerWidth = readContainerWidth(graphLayoutRef);
      const maxWidth = readGraphDetailMaxWidth(containerWidth);

      switch (event.key) {
        case 'ArrowLeft':
          nextWidth = graphDetailWidth + GRAPH_RESIZE_KEYBOARD_STEP;
          break;
        case 'ArrowRight':
          nextWidth = graphDetailWidth - GRAPH_RESIZE_KEYBOARD_STEP;
          break;
        case 'Home':
          nextWidth = GRAPH_DETAIL_MIN_WIDTH;
          break;
        case 'End':
          nextWidth = maxWidth;
          break;
        default:
          return;
      }

      event.preventDefault();
      stopGraphResize();
      setGraphDetailWidth(clampGraphDetailWidth(nextWidth, containerWidth));
    },
    [graphDetailWidth, stopGraphResize],
  );

  useEffect(() => {
    const handleGlobalKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) {
        return;
      }
      if (event.key === 'Escape' && shareSelectionMode) {
        event.preventDefault();
        setShareSelectionMode(false);
        setSelectedRunIds(new Set());
        return;
      }
      if (event.key === 'Escape' && reportSelectionMode) {
        event.preventDefault();
        setReportSelectionMode(false);
        setSelectedReportRequestIds(new Set());
        return;
      }
      const shortcut = shortcutRegistry.resolve(event, { scope: 'global' });
      if (!shortcut || shortcut.actionId !== 'open-help') {
        return;
      }
      event.preventDefault();
      onOpenHelp();
    };

    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => {
      window.removeEventListener('keydown', handleGlobalKeyDown);
    };
  }, [onOpenHelp, shareSelectionMode, reportSelectionMode]);

  const handleShareTrigger = useCallback(
    (_rootMessageId: string, runId?: string) => {
      if (runId) {
        setSelectedRunIds(new Set([runId]));
      }
      setShareSelectionMode(true);
      setReportSelectionMode(false);
      setSelectedReportRequestIds(new Set());

      // Ensure enough conversation history is loaded so that share select-all can
      // reach up to SHARE_RUN_IDS_MAX_ITEMS turns. The default conversation limit
      // loads ~60 turns; loading one older page (another 120 messages ≈ 60 turns)
      // gives ~120 turns — enough for the 100-item share cap. Loop until either
      // there are no more older pages or a safety limit is reached.
      const sessionId = routeSessionId;
      if (sessionId) {
        void (async () => {
          const MAX_OLDER_PAGES = 5;
          for (let i = 0; i < MAX_OLDER_PAGES; i++) {
            const pageInfo = useConversationStore.getState().conversationPageInfoBySession[sessionId];
            if (!pageInfo?.nextCursor) {
              break;
            }
            await useConversationStore.getState().loadOlderConversation(sessionId);
          }
        })();
      }
    },
    [routeSessionId],
  );

  const handleToggleShareSelection = useCallback(
    (runId: string) => {
      const { next, rejected } = toggleShareSelection(selectedRunIds, runId);
      setSelectedRunIds(next);
      if (rejected) {
        antdMessage.warning(t('share.limitReached', { max: SHARE_RUN_IDS_MAX_ITEMS }));
      }
    },
    [selectedRunIds, t],
  );

  const handleExitShareMode = useCallback(() => {
    setShareSelectionMode(false);
    setSelectedRunIds(new Set());
  }, []);

  const handleToggleSelectAll = useCallback(() => {
    const allSelected = selectedRunIds.size === selectableRunIds.size && [...selectableRunIds].every((id) => selectedRunIds.has(id));
    if (allSelected) {
      setSelectedRunIds(new Set());
      return;
    }
    const { next, truncated } = selectAllShareable(selectableRunIds);
    setSelectedRunIds(next);
    if (truncated) {
      antdMessage.warning(t('share.selectAllTruncated', { max: SHARE_RUN_IDS_MAX_ITEMS }));
    }
  }, [selectableRunIds, selectedRunIds, t]);

  const handleOpenShareDialog = useCallback(() => {
    setShareDialogOpen(true);
  }, []);

  const handleCloseShareDialog = useCallback(() => {
    setShareDialogOpen(false);
    setShareSelectionMode(false);
    setSelectedRunIds(new Set());
  }, []);

  const handleGenerateReportTrigger = useCallback((_rootMessageId: string, requestId: string) => {
    setShareSelectionMode(false);
    setSelectedReportRequestIds(new Set([requestId]));
    setReportSelectionMode(true);
  }, []);

  const handleToggleReportSelection = useCallback((requestId: string) => {
    setSelectedReportRequestIds((prev) => {
      const next = new Set(prev);
      if (next.has(requestId)) {
        next.delete(requestId);
      } else if (next.size < 10) {
        next.add(requestId);
      }
      return next;
    });
  }, []);

  const handleToggleReportSelectAll = useCallback(() => {
    setSelectedReportRequestIds((prev) => {
      const limitedIds = [...selectableReportRequestIds].slice(0, 10);
      if (prev.size === limitedIds.length && limitedIds.every((id) => prev.has(id))) {
        return new Set();
      }
      return new Set(limitedIds);
    });
  }, [selectableReportRequestIds]);

  const handleExitReportMode = useCallback(() => {
    setReportSelectionMode(false);
    setSelectedReportRequestIds(new Set());
  }, []);

  const handleGenerateReport = useCallback(async () => {
    if (selectedReportRequestIds.size === 0) {
      antdMessage.warning(t('report.selectAtLeastOne'));
      return;
    }
    if (!routeSessionId) {
      return;
    }
    try {
      const content = await biReportService.generateReport({
        sessionId: routeSessionId,
        requestIds: [...selectedReportRequestIds],
      });
      if (content) {
        const reportId = crypto.randomUUID();
        const syntheticBlock: TurnBlock = {
          rootMessageId: `bi-report:${reportId}`,
          userMessage: { content: '' } as SessionConversationMessage,
          aiEvents: [
            {
              eventId: `bi-report-event-${reportId}`,
              sessionId: routeSessionId,
              requestId: `bi-report:${reportId}`,
              sequence: 0,
              eventType: 'TOOL_STRUCTURED_DELTA',
              timelineEventRef: null,
              transportHints: ['history-load'],
              payload: {
                toolEventType: 'ANSWER',
                toolMessageType: 'DSL',
                content: content as Record<string, unknown>,
              },
              createdAt: Date.now(),
            } as StreamEnvelope,
          ],
          status: 'COMPLETED',
          isLatest: false,
        };
        setReportTurnBlocks((prev) => [...prev, syntheticBlock]);
      }
      setReportSelectionMode(false);
      setSelectedReportRequestIds(new Set());
    } catch {
      antdMessage.error(t('report.generateFailed'));
    }
  }, [selectedReportRequestIds, routeSessionId, t]);

  const handleOpenForkSource = useCallback(
    async (sourceSessionId: string) => {
      try {
        await sessionService.loadConversationPreview(sourceSessionId);
      } catch (error) {
        if (isApiError(error) && error.status === 404) {
          antdMessage.warning(t('forkNotice.sourceDeleted'));
          if (routeSessionId) {
            clearForkNotice(routeSessionId);
          }
          return;
        }
        // Non-404 errors (e.g. transient network issues) fall through to navigation.
      }
      navigation.openSession(sourceSessionId);
    },
    [clearForkNotice, navigation, routeSessionId, t],
  );

  const forkNoticeNode = activeForkNotice ? (
    <div
      data-testid="fork-notice"
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '2px 0 14px',
        color: 'var(--color-text-tertiary)',
        fontSize: 12,
        lineHeight: '18px',
      }}
    >
      <span>{t('forkNotice.derivedFromPrefix')}</span>
      <button
        type="button"
        data-testid="fork-notice-source"
        aria-label={t('forkNotice.openSource', { title: activeForkNotice.sourceSessionTitle })}
        onClick={() => void handleOpenForkSource(activeForkNotice.sourceSessionId)}
        style={{
          border: 'none',
          background: 'transparent',
          color: 'var(--color-text-tertiary)',
          cursor: 'pointer',
          font: 'inherit',
          padding: '0 2px',
          textDecoration: 'underline',
          textUnderlineOffset: 3,
        }}
      >
        {activeForkNotice.sourceSessionTitle}
      </button>
      <span>{t('forkNotice.derivedFromSuffix')}</span>
    </div>
  ) : null;

  const shouldRenderAnchoredNewerBoundary = isAnchoredConversation && Boolean(activeConversationPageInfo?.newerCursor);
  const shouldShowAnchoredNewerLoadMore = Boolean(
    shouldRenderAnchoredNewerBoundary && (activeConversationPageInfo?.isLoadingNewer || activeConversationPageInfo?.newerLoadError),
  );
  const anchoredNewerLoadMoreLabel = activeConversationPageInfo?.isLoadingNewer
    ? t('messageList.loadingNewerMessages')
    : activeConversationPageInfo?.newerLoadError
      ? t('messageList.loadNewerFailed')
      : t('messageList.loadNewerMessages');
  const handleSuggestedQuestionClick = useCallback(
    (question: string) => {
      void injectQuestion({ question, isSend: true });
    },
    [injectQuestion],
  );
  const handleQuickOperatorQuestionSelect = useCallback(
    (question: string) => {
      void injectQuestion({ question, isSend: false });
    },
    [injectQuestion],
  );
  const handleRespondCancel = useCallback(() => {
    if (activeInput) {
      return handleCancelRequest(activeInput.requestId);
    }
    return undefined;
  }, [activeInput, handleCancelRequest]);
  const composerNotice = useMemo(
    () =>
      composerInlineNotice
        ? {
            type: composerInlineNotice.level,
            message: composerInlineNotice.message,
          }
        : null,
    [composerInlineNotice],
  );
  const skillSelectorSlot = useMemo(
    () => <QuickOperatorArea onQuestionSelect={handleQuickOperatorQuestionSelect} />,
    [handleQuickOperatorQuestionSelect],
  );
  const selectedSkillChip = useMemo(() => <QuickOperatorAreaSelectedChip />, []);

  const retryDisabledRequestId =
    retryLimitReachedFor !== null && retryLimitReachedFor.sessionId === routeSessionId ? retryLimitReachedFor.requestId : null;

  const mainContent = aboveMessagesSlot ? (
    <div
      style={{
        flex: 1,
        minHeight: 0,
        position: 'relative',
        boxSizing: 'border-box',
      }}
    >
      {aboveMessagesSlot}
    </div>
  ) : shouldShowWelcome ? (
    <WelcomeState onSuggestionClick={hydrateComposerInput} />
  ) : (
    <div
      style={{
        flex: 1,
        minHeight: 0,
        position: 'relative',
        boxSizing: 'border-box',
      }}
    >
      <MessageList
        blocks={allTurnBlocks}
        onRetry={handleRetryRequest}
        onEdit={handleEditRequest}
        onCancel={handleCancelRequest}
        retryDisabledRequestId={retryDisabledRequestId}
        isAtBottom={isAtBottom}
        isFollowingBottom={isFollowingBottom}
        readIsFollowingBottom={readIsFollowingBottom}
        hasNewMessages={hasNewMessages}
        onScrollToBottom={requestScrollToBottomIfFollowing}
        onRequestAnchorCompensation={handleAnchorCompensation}
        onRequestPreserveReadingAnchor={handleAsyncContentLayoutChange}
        isLoading={isConversationLoading}
        sessionId={routeSessionId ?? ''}
        showInlineScrollToBottomButton={false}
        editNoticeVisible={showEditSubmitNotice}
        onOpenFullProcess={handleOpenFullProcess}
        turnActionsDisabled={isConversationTransitioning}
        annotationsByRunId={annotationsByRunId}
        onAnnotationChange={handleAnnotationChange}
        onSuggestedQuestionClick={handleSuggestedQuestionClick}
        {...(!shareSelectionMode ? { onFork: handleFork, forkingAnchorKey } : {})}
        {...(!shareSelectionMode ? { onShare: handleShareTrigger } : {})}
        {...(shareSelectionMode
          ? {
              shareSelection: true,
              selectedRunIds,
              onToggleShareSelection: handleToggleShareSelection,
            }
          : {})}
        {...(reportSelectionMode
          ? {
              reportSelection: true,
              selectedReportRequestIds,
              onToggleReportSelection: handleToggleReportSelection,
            }
          : {})}
        {...(!shareSelectionMode && !reportSelectionMode ? { onGenerateReport: handleGenerateReportTrigger } : {})}
        processHistoryByRunId={activeProcessHistoryByRun}
        scrollViewportRef={scrollViewportRef}
        onProcessHistoryTargetsChange={handleAutomaticProcessHistoryTargetsChange}
        onProcessPanelExpansionChange={handleProcessPanelExpansionChange}
        onRetryRunProcessHistory={handleRetryRunProcessHistory}
        {...(activeConversationPageInfo?.nextCursor
          ? {
              historyBoundary: {
                hasMore: true,
                isLoading: activeConversationPageInfo.isLoadingOlder,
                error: activeConversationPageInfo.olderLoadError,
              },
            }
          : {})}
      />
      {shouldRenderAnchoredNewerBoundary && (
        <div
          ref={anchoredNewerBoundaryRef}
          data-testid="anchored-newer-boundary"
          aria-live="polite"
          style={{
            display: 'flex',
            justifyContent: 'center',
            padding: shouldShowAnchoredNewerLoadMore ? '8px 0 18px' : 0,
            minHeight: shouldShowAnchoredNewerLoadMore ? 44 : 1,
            boxSizing: 'border-box',
          }}
        >
          {shouldShowAnchoredNewerLoadMore && (
            <div
              data-testid="anchored-newer-boundary-status"
              style={{
                background: 'transparent',
                color: activeConversationPageInfo?.newerLoadError ? '#b42318' : 'var(--color-text-secondary)',
                borderRadius: 999,
                padding: '6px 12px',
                fontSize: 12,
                lineHeight: '18px',
                fontWeight: 500,
                cursor: 'default',
              }}
            >
              {anchoredNewerLoadMoreLabel}
            </div>
          )}
        </div>
      )}
      {forkNoticeNode}
    </div>
  );

  const viewportInteractionProps = effectiveShouldShowWelcome
    ? {}
    : {
        onScrollViewport: handleConversationScroll,
        onWheelViewport: handleConversationWheel,
        onPointerDownViewport: handleConversationPointerDown,
        onKeyDownViewport: handleConversationKeyDown,
      };
  const navigationSessionTitle = navigation.sessionTitle?.trim();
  const rightPaneTitle = navigationSessionTitle || activeSessionHistoryEntry?.displayTitle.trim() || '';

  const chatPane = (
    <RightPaneLayout
      title={rightPaneTitle}
      headerExtra={<BackgroundTaskHeaderMonitor sessionId={routeSessionId ?? ''} />}
      headerSlot={headerSlot}
      footer={
        shareSelectionMode || reportSelectionMode ? null : (
          <div
            data-testid="chat-composer-dock"
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 0,
              background: 'transparent',
              boxSizing: 'border-box',
            }}
          >
            {shouldRenderStreamStatus && activeRuntimeState.continuityMessage && (
              <div
                data-testid="chat-stream-status-strip"
                style={{
                  marginBottom: 8,
                  borderRadius: 12,
                  border:
                    activeRuntimeState.continuityPhase === 'disconnected'
                      ? '1px solid var(--color-status-warning-dot)'
                      : '1px solid rgba(22, 119, 255, 0.16)',
                  background:
                    activeRuntimeState.continuityPhase === 'disconnected' ? 'var(--color-status-warning-bg)' : 'var(--color-status-info-bg)',
                  color: activeRuntimeState.continuityPhase === 'disconnected' ? 'var(--color-status-warning-text)' : 'var(--color-status-info-text)',
                  padding: '6px 12px',
                  fontSize: 12,
                  lineHeight: '18px',
                }}
              >
                {activeRuntimeState.continuityMessage}
              </div>
            )}
            {activeInput ? (
              <RespondInput activeInput={activeInput} onSubmit={handleRespondSubmit} onCancel={handleRespondCancel} disabled={false} />
            ) : (
              <MessageInput
                key={composerInputVersion}
                onSend={handleSendWithPreviewTail}
                {...(!isAnchoredConversation ? { onReloadConversation: handleReloadConversation } : {})}
                onOpenHelp={onOpenHelp}
                onRetryLatest={handleRetryLatest}
                onEditLatest={handleEditLatest}
                canRetryLatest={canRetryLatest}
                retryLatestDisabled={retryDisabledRequestId !== null}
                showRetryLatestButton={showRetryLatestButton}
                canEditLatest={canEditLatest}
                attachments={attachmentItems}
                attachmentNotice={attachmentNotice}
                uploadExpireNotice={uploadExpireNotice}
                onAddAttachments={handleAddAttachments}
                onRemoveAttachment={handleRemoveAttachment}
                onRetryAttachment={handleRetryAttachment}
                isReloading={isLoadingHistory}
                disabled={false}
                initialInput={editMode?.content ?? composerHydratedInput}
                inputVersion={composerInputVersion}
                submittedMessageHistory={submittedMessageHistory}
                onDraftChange={setComposerDraft}
                mode={editMode ? 'edit' : 'normal'}
                onCancelEdit={handleCancelEdit}
                isExecuting={isConversationTransitioning}
                {...(canStopRequest ? { onStop: handleCancelRequest } : {})}
                inlineNotice={composerNotice}
                skillSelectorSlot={skillSelectorSlot}
                selectedSkillChip={selectedSkillChip}
              />
            )}
          </div>
        )
      }
      scrollViewportRef={scrollViewportRef}
      centerContent={effectiveShouldShowWelcome}
      floatingOverlay={
        !effectiveShouldShowWelcome && (isAnchoredConversation || (!isFollowingBottom && !isAtBottom)) ? (
          <button
            data-testid="chat-scroll-to-bottom-floating"
            onClick={isAnchoredConversation ? handleReturnToLatest : scrollToBottom}
            aria-label={isAnchoredConversation ? t('messageList.returnToLatest') : t('messageList.scrollToBottom')}
            style={{
              width: 44,
              height: 44,
              borderRadius: '50%',
              border: '1px solid rgba(22,119,255,0.18)',
              background: hasNewMessages ? 'var(--color-bg-active)' : 'rgba(255,255,255,0.92)',
              boxShadow: '0 8px 18px rgba(15, 23, 42, 0.16)',
              color: 'var(--color-primary)',
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 18,
            }}
          >
            <ArrowDownOutlined />
          </button>
        ) : null
      }
      {...viewportInteractionProps}
    >
      <ComposerPanel middleContent={mainContent} />
      <ShareSettingsModal
        open={shareDialogOpen}
        sessionId={routeSessionId ?? ''}
        runIds={[...selectedRunIds]}
        isRemoteMode={isRemoteMode}
        userOps={userOps}
        onCancel={handleCloseShareDialog}
      />
    </RightPaneLayout>
  );

  return (
    <ErrorBoundary>
      <SessionActivityTerminalObserver
        sessionId={routeSessionId ?? null}
        activeSessionId={activeSessionId}
        conversationLoadState={activeConversationLoadState}
        isConversationSurfaceVisible={isConversationSurfaceVisible}
        turnBlocks={turnBlocks}
      />
      <div
        ref={graphLayoutRef}
        data-testid="chat-turn-run-graph-layout"
        style={{
          display: 'flex',
          height: '100%',
          minHeight: 0,
          minWidth: 0,
          overflow: 'hidden',
          background: 'var(--color-bg-primary)',
        }}
      >
        {isExpandPanelOpen && isImmersiveMode && expandPanelPosition === 'LEFT' ? (
          <aside data-testid="expand-panel-region" style={{ flex: '1 1 auto', height: '100%', minHeight: 0, overflow: 'hidden' }}>
            <ExpandPanel />
          </aside>
        ) : null}
        <div
          data-testid="chat-conversation-pane"
          ref={chatConversationPaneRef}
          style={{
            position: 'relative',
            flex: shouldConstrainConversationPane ? `0 0 ${DOCKED_DEFAULT_WIDTH}px` : '1 1 auto',
            minWidth: shouldConstrainConversationPane ? DOCKED_DEFAULT_WIDTH : isGraphDetailOpen && !isGraphDrawerMode ? GRAPH_CHAT_MIN_WIDTH : 0,
            minHeight: 0,
            height: '100%',
            overflow: 'hidden',
            background: 'var(--color-chat-pane-bg)',
          }}
        >
          {shouldShowConversationPreview ? (
            <ConversationPreviewRail
              initialAlignToLatestKey={routeSessionId}
              preview={activeConversationPreview}
              onSelect={handlePreviewMarkerNavigate}
              onSelectIndex={handlePreviewIndexNavigate}
              onVisibleRangeChange={handlePreviewVisibleRangeChange}
            />
          ) : null}
          {chatPane}
          {shareSelectionMode ? (
            <ShareModeBar
              maxItems={SHARE_RUN_IDS_MAX_ITEMS}
              selectedCount={selectedRunIds.size}
              allSelectableCount={selectableRunIds.size}
              selectedRunIds={selectedRunIds}
              selectableRunIds={selectableRunIds}
              onToggleSelectAll={handleToggleSelectAll}
              onShare={handleOpenShareDialog}
              onCancel={handleExitShareMode}
            />
          ) : null}
          {reportSelectionMode ? (
            <ShareModeBar
              selectedCount={selectedReportRequestIds.size}
              allSelectableCount={selectableReportRequestIds.size}
              selectedRunIds={selectedReportRequestIds}
              selectableRunIds={selectableReportRequestIds}
              onToggleSelectAll={handleToggleReportSelectAll}
              onShare={handleGenerateReport}
              onCancel={handleExitReportMode}
              labels={{
                selectAll: t('report.selectAll'),
                selectedCount: t('report.selectedCount', { count: selectedReportRequestIds.size }),
                cancel: t('report.cancel'),
                confirm: t('report.generateReport'),
              }}
            />
          ) : null}
        </div>
        {isExpandPanelOpen && (isLocalMode || (isImmersiveMode && expandPanelPosition !== 'LEFT')) ? (
          <aside data-testid="expand-panel-region" style={{ flex: '1 1 auto', height: '100%', minHeight: 0, overflow: 'hidden' }}>
            <ExpandPanel />
          </aside>
        ) : null}
        {selectedDetailBlock && !isGraphDrawerMode && !isExpandPanelOpen ? (
          <>
            <div
              role="separator"
              aria-orientation="vertical"
              aria-label={t('turnRunGraph.resizeHandle')}
              aria-valuemin={GRAPH_DETAIL_MIN_WIDTH}
              aria-valuemax={readGraphDetailMaxWidth(readContainerWidth(graphLayoutRef))}
              aria-valuenow={graphDetailWidth}
              tabIndex={0}
              data-testid="turn-run-graph-resize-handle"
              onPointerDown={handleGraphResizePointerDown}
              onKeyDown={handleGraphResizeKeyDown}
              style={{
                width: GRAPH_RESIZE_HANDLE_WIDTH,
                flex: `0 0 ${GRAPH_RESIZE_HANDLE_WIDTH}px`,
                cursor: 'col-resize',
                background: 'var(--color-bg-secondary)',
                color: 'var(--color-text-tertiary)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                outline: 'none',
              }}
            >
              <span
                aria-hidden="true"
                style={{
                  width: 3,
                  height: 34,
                  borderRadius: 999,
                  background: 'var(--color-border-strong)',
                }}
              />
            </div>
            <aside
              data-testid="turn-run-graph-side-region"
              style={{
                flex: `0 0 ${graphDetailWidth}px`,
                width: graphDetailWidth,
                minWidth: GRAPH_DETAIL_MIN_WIDTH,
                maxWidth: GRAPH_DETAIL_MAX_WIDTH,
                height: '100%',
                minHeight: 0,
                borderLeft: '1px solid var(--color-border)',
                boxShadow: '-8px 0 18px rgba(15, 23, 42, 0.04)',
              }}
            >
              <Suspense fallback={<GraphDetailLoadingFallback label={t('turnRunGraph.loading')} />}>
                <TurnRunGraphPanel block={selectedDetailBlock} onClose={handleCloseFullProcess} closeButtonRef={graphCloseButtonRef} />
              </Suspense>
            </aside>
          </>
        ) : null}
      </div>
      <Drawer
        aria-label={t('turnRunGraph.ariaLabel')}
        open={Boolean(selectedDetailBlock && isGraphDrawerMode)}
        placement="right"
        width="min(100vw, 520px)"
        closable={false}
        destroyOnHidden
        onClose={handleCloseFullProcess}
        styles={{ body: { padding: 0, height: '100%' } }}
      >
        {selectedDetailBlock ? (
          <Suspense fallback={<GraphDetailLoadingFallback label={t('turnRunGraph.loading')} />}>
            <TurnRunGraphPanel block={selectedDetailBlock} onClose={handleCloseFullProcess} closeButtonRef={graphCloseButtonRef} />
          </Suspense>
        ) : null}
      </Drawer>
    </ErrorBoundary>
  );
}

function GraphDetailLoadingFallback({ label }: { readonly label: string }) {
  return (
    <div
      data-testid="turn-run-graph-panel-loading"
      style={{
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: 'var(--color-text-tertiary)',
        fontSize: 13,
      }}
    >
      {label}
    </div>
  );
}
