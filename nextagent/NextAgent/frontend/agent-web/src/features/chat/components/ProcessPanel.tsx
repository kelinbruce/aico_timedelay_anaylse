import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Modal, Tooltip } from 'antd';
import { InfoCircleOutlined, WarningOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import type { RunProcessHistoryState, TurnBlock, WireTimestamp } from '../../../state/contracts.ts';
import {
  isProcessEntryVisuallySuperseded,
  shouldRenderProcessDetailAsMarkdown,
  type ExecutionDetailsPhase,
  type ProcessDisplayEntry,
  type ProcessEntry,
  type ProcessStructuredSection,
  type RagRetrievalDisplayItem,
} from '../process/processDetails.ts';
import { expandPanelStore } from '../../expand-panel/ExpandPanelStore.ts';
import { MarkdownContent } from './MarkdownContent.tsx';
import { AnswerSegments } from './structured/AnswerSegments.tsx';
import { useProcessEntryDisclosure } from '../hooks/useProcessEntryDisclosure.ts';
import { usePrefersReducedMotion } from '../hooks/usePrefersReducedMotion.ts';

import thinkDark from '../../../assets/process-icons/think-dark.svg';
import thinkLight from '../../../assets/process-icons/think-light.svg';
import thinkDarkGif from '../../../assets/process-icons/think-dark.gif';
import thinkLightGif from '../../../assets/process-icons/think-light.gif';
import skillDark from '../../../assets/process-icons/skill-dark.svg';
import skillLight from '../../../assets/process-icons/skill-light.svg';
import processCompleteDark from '../../../assets/process-icons/process-complete-dark.svg';
import processCompleteLight from '../../../assets/process-icons/process-complete-light.svg';
import finalCompleteDark from '../../../assets/process-icons/final-complete-dark.svg';
import finalCompleteLight from '../../../assets/process-icons/final-complete-light.svg';
import './ProcessPanel.css';

import circleDark from '../../../assets/process-icons/circle-dark.svg';
import circleLight from '../../../assets/process-icons/circle-light.svg';

import collapseDark from '../../../assets/process-icons/collapse-dark.svg';
import collapseLight from '../../../assets/process-icons/collapse-light.svg';

import executingGif from '../../../assets/process-icons/executing.gif';

import stepFailedIcon from '../../../assets/process-icons/step-failed.svg';
import stepRunningAnimatedIcon from '../../../assets/process-icons/step-running-animated.svg';

type ProcessIconType = 'think' | 'skill' | 'process-complete' | 'final-complete' | 'circle' | 'step-failed' | 'step-running' | 'warning' | 'info';

function resolveProcessIconType(
  title: string,
  toolEventType?: string | null,
  isFailure?: boolean,
  isRunning?: boolean,
  severity?: ProcessDisplayEntry['severity'],
): ProcessIconType {
  if (toolEventType === 'SUB_TITLE') {
    return 'circle';
  }
  const lower = title.toLowerCase();
  if (isFailure) {
    return 'step-failed';
  }
  if (isRunning) {
    return 'step-running';
  }
  if (severity) {
    return severity;
  }
  if (title === '思考' || title.includes('思考') || lower.includes('think')) {
    return 'think';
  }
  if (lower.includes('agent') || lower.includes('skill')) {
    return 'skill';
  }
  return 'process-complete';
}

function resolveProcessIconUrl(iconType: ProcessIconType, isDark: boolean): string | null {
  switch (iconType) {
    case 'think':
      return isDark ? thinkDark : thinkLight;
    case 'step-failed':
      return stepFailedIcon;
    case 'step-running':
      return stepRunningAnimatedIcon;
    case 'skill':
      return isDark ? skillDark : skillLight;
    case 'process-complete':
      return isDark ? processCompleteDark : processCompleteLight;
    case 'final-complete':
      return isDark ? finalCompleteDark : finalCompleteLight;
    case 'circle':
      return isDark ? circleDark : circleLight;
    case 'warning':
    case 'info':
      return null;
    default: {
      const exhaustive: never = iconType;
      throw new Error(`Unhandled case: ${String(exhaustive)}`);
    }
  }
}

function useIsDarkTheme(): boolean {
  const [isDark, setIsDark] = useState(() => {
    if (typeof document === 'undefined') {
      return false;
    }
    const theme = document.documentElement.getAttribute('data-theme');
    return theme === 'dark' || theme === 'evening';
  });
  useEffect(() => {
    if (typeof document === 'undefined' || typeof MutationObserver === 'undefined') {
      return undefined;
    }
    const observer = new MutationObserver(() => {
      const theme = document.documentElement.getAttribute('data-theme');
      setIsDark(theme === 'dark' || theme === 'evening');
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => observer.disconnect();
  }, []);
  return isDark;
}

const RAG_SOURCE_DISPLAY_LIMIT = 512;

function trimLeadingBlankLines(text: string): string {
  return text.replace(/^[\s\r\n]+/, '');
}

function RagRetrievalDetails({ items }: { readonly items: readonly RagRetrievalDisplayItem[] }) {
  const [activeContent, setActiveContent] = useState<string | null>(null);
  return (
    <>
      <div className="turn-process-rag-retrieval" data-testid="turn-process-rag-retrieval">
        {items.map((item, index) => {
          const sourceTruncated = item.displaySource.length > RAG_SOURCE_DISPLAY_LIMIT;
          const sourceLabel = sourceTruncated ? `${item.displaySource.slice(0, RAG_SOURCE_DISPLAY_LIMIT)}...` : item.displaySource;
          return (
            <div className="turn-process-rag-retrieval-item" key={`${index}:${item.displaySource}`}>
              <div className="turn-process-rag-retrieval-source-row">
                <span className="turn-process-rag-retrieval-index">{index + 1}.</span>
                <Tooltip title={item.displaySource} overlayStyle={{ maxWidth: '600px' }}>
                  <span
                    className="turn-process-rag-retrieval-source turn-process-rag-retrieval-source--clickable"
                    data-testid="turn-process-rag-source"
                    role="button"
                    tabIndex={0}
                    onClick={() => setActiveContent(item.content)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        setActiveContent(item.content);
                      }
                    }}
                  >
                    {sourceLabel}
                  </span>
                </Tooltip>
              </div>
            </div>
          );
        })}
      </div>
      <Modal
        open={activeContent !== null}
        onCancel={() => setActiveContent(null)}
        footer={null}
        width={800}
        destroyOnClose
        centered
        title={'\u200B'}
        styles={{ body: { maxHeight: '70vh', overflowY: 'auto' } }}
        classNames={{ body: 'nextagent-trackless-scrollbar' }}
      >
        {activeContent !== null && <MarkdownContent content={activeContent} />}
      </Modal>
    </>
  );
}

function StructuredProcessSections({ sections, isDark }: { readonly sections: readonly ProcessStructuredSection[]; readonly isDark: boolean }) {
  return (
    <div data-testid="turn-process-structured-sections" style={{ display: 'grid', gap: 8, marginBottom: 8 }}>
      {sections.map((section) => {
        const isSubTitle = section.toolEventType === 'SUB_TITLE';
        return (
          <div
            key={section.key}
            data-testid="turn-process-structured-section"
            data-structured-level={isSubTitle ? 'sub' : undefined}
            style={isSubTitle ? { display: 'flex', gap: 6, marginLeft: 14, minWidth: 0 } : undefined}
          >
            {isSubTitle ? (
              <img
                alt=""
                data-testid="turn-process-structured-section-icon"
                src={isDark ? circleDark : circleLight}
                style={{ width: 12, height: 12, flexShrink: 0, marginTop: 3 }}
              />
            ) : null}
            <div style={{ minWidth: 0 }}>
              {section.title.trim().length > 0 ? (
                <div style={{ color: 'var(--color-text-secondary)', fontWeight: 500, marginBottom: 2 }}>{section.title}</div>
              ) : null}
              {section.structuredSegments && section.structuredSegments.length > 0 ? (
                <AnswerSegments segments={section.structuredSegments} />
              ) : section.contentType === 'MARKDOWN' ? (
                <MarkdownContent content={trimLeadingBlankLines(section.detail)} fontSize={14} textColor="var(--color-text-secondary)" />
              ) : (
                <div style={{ whiteSpace: 'pre-wrap' }}>{trimLeadingBlankLines(section.detail)}</div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function isEnglishProcessLocale(t: TFunction): boolean {
  return t('turn.process.completed') === 'Completed';
}

function resolveProcessHistoryStateText(t: TFunction, processHistoryState?: RunProcessHistoryState): string | null {
  if (!processHistoryState) {
    return null;
  }
  const key =
    processHistoryState.status === 'LOADING'
      ? 'turn.process.processHistoryLoading'
      : processHistoryState.status === 'LEGACY_UNAVAILABLE'
        ? 'turn.process.processHistoryLegacyUnavailable'
        : null;
  if (key === null) {
    return null;
  }
  const translated = t(key);
  if (translated !== key) {
    return translated;
  }
  if (processHistoryState.status === 'LOADING') {
    return isEnglishProcessLocale(t) ? 'Historical process details are loading…' : '正在加载历史过程详情…';
  }
  return isEnglishProcessLocale(t)
    ? 'Historical process details are unavailable for this pre-upgrade forked session.'
    : '此升级前分叉会话没有可用的历史过程详情。';
}

const PROCESS_AUTO_COLLAPSE_DELAY_MS = 150;
const PROCESS_PANEL_TRANSITION_MS = 200;
const PROCESS_PANEL_TOP_GAP_PX = 12;
const PROCESS_ENTRY_APPEARANCE_MS = 200;

const PROCESS_IDLE_SWEEP_CSS = `
  @keyframes nextagent-text-sweep {
    0% { background-position: 180% 0; }
    100% { background-position: -180% 0; }
  }
  .turn-process-detail--idle-sweep {
    color: transparent;
    background-image: linear-gradient(
      90deg,
      var(--color-text-secondary) 0%,
      var(--color-text-secondary) 40%,
      var(--color-primary) 50%,
      var(--color-text-secondary) 60%,
      var(--color-text-secondary) 100%
    );
    background-size: 220% 100%;
    background-clip: text;
    -webkit-background-clip: text;
    animation: nextagent-text-sweep 4s linear infinite;
  }
  @media (prefers-reduced-motion: reduce) {
    .turn-process-detail--idle-sweep {
      color: var(--color-text-secondary);
      background-image: none;
      animation: none;
    }
  }
`;

type ProcessPanelMode = 'auto-expanded' | 'auto-collapsed' | 'user-expanded' | 'user-collapsed';

function hasStructuredProcessPresentation(entries: readonly ProcessEntry[]): boolean {
  return entries.some((entry) => entry.toolEventType === 'TITLE' || entry.toolEventType === 'SUB_TITLE');
}

function hasPiuStructuredDetail(entry: ProcessDisplayEntry): boolean {
  return (
    entry.structuredSegments?.some((segment) => segment.kind === 'structured' && segment.toolMessageType === 'PIU') === true ||
    entry.structuredSections?.some((section) =>
      section.structuredSegments?.some((segment) => segment.kind === 'structured' && segment.toolMessageType === 'PIU'),
    ) === true
  );
}

function resolveDefaultProcessPanelMode(phase: ExecutionDetailsPhase, entries: readonly ProcessEntry[]): ProcessPanelMode {
  return phase === 'settled' && !hasStructuredProcessPresentation(entries) ? 'auto-collapsed' : 'auto-expanded';
}

const persistedProcessPanelModes = new Map<string, ProcessPanelMode>();

export interface ProcessPanelProps {
  readonly block: TurnBlock;
  readonly rootMessageId: string;
  readonly status: TurnBlock['status'];
  readonly isLatest: boolean;
  readonly isTerminal: boolean;
  readonly isViewportFollowingBottom: boolean;
  readonly readIsViewportFollowingBottom?: () => boolean;
  readonly executionDetailsPhase: ExecutionDetailsPhase;
  readonly processEntries: readonly ProcessEntry[];
  readonly processDisplayEntries: readonly ProcessDisplayEntry[];
  readonly processSummary: string;
  readonly activeProcessEntryKey: string | null;
  readonly shouldShowProcessIdleSweep: boolean;
  readonly showProcessSummary: boolean;
  readonly showProcessTimelineAction: boolean;
  readonly hasAnswerContent: boolean;
  readonly brandName?: string | undefined;
  readonly latestAssistantAnswerPresentationOrder: number | null;
  readonly pendingSupplementalInputEntryKeys: ReadonlySet<string>;
  readonly onOpenFullProcess?: ((block: TurnBlock, opener: HTMLButtonElement) => void) | undefined;
  readonly onRequestScrollToBottom?: (() => void) | undefined;
  readonly onRequestAnchorCompensation?: ((deltaY: number) => void) | undefined;
  readonly onPanelHeightChange?: ((height: number) => void) | undefined;
  readonly processHistoryState?: RunProcessHistoryState | undefined;
  readonly displayRunId?: string | undefined;
  readonly showProcessHistoryLoadingIndicator?: boolean;
  readonly onExpansionChange?: ((expanded: boolean) => void) | undefined;
}

export function __resetProcessPanelTestState(): void {
  persistedProcessPanelModes.clear();
}

interface ProcessEntryWithExplanations extends ProcessDisplayEntry {
  readonly explanationDetails?: ReadonlyArray<{
    readonly key: string;
    readonly title: string;
    readonly detail: string;
    readonly contentType?: ProcessDisplayEntry['contentType'];
  }>;
  readonly parentEntryKey?: string | undefined;
  readonly hasNestedEntries?: boolean | undefined;
}

export function ProcessPanel({
  block,
  rootMessageId,
  status,
  isLatest,
  isTerminal,
  isViewportFollowingBottom,
  readIsViewportFollowingBottom,
  executionDetailsPhase,
  processEntries,
  processDisplayEntries,
  processSummary,
  activeProcessEntryKey,
  shouldShowProcessIdleSweep,
  showProcessSummary,
  showProcessTimelineAction,
  hasAnswerContent,
  brandName,
  latestAssistantAnswerPresentationOrder,
  pendingSupplementalInputEntryKeys,
  onOpenFullProcess,
  onRequestScrollToBottom,
  onRequestAnchorCompensation,
  onPanelHeightChange,
  processHistoryState,
  displayRunId,
  showProcessHistoryLoadingIndicator = false,
  onExpansionChange,
}: ProcessPanelProps) {
  const { t } = useTranslation();
  const isDark = useIsDarkTheme();
  const prefersReducedMotion = usePrefersReducedMotion();
  const processTransitionMs = prefersReducedMotion ? 0 : PROCESS_PANEL_TRANSITION_MS;
  const isRunningPhase = executionDetailsPhase !== 'settled';
  const executingBrandText = t('turn.process.executing', { brandName: brandName ?? 'NextAgent' });
  const summaryTextFontStyle: React.CSSProperties = {
    fontFamily: 'HarmonyOS Sans SC',
    fontStyle: 'normal',
    fontSize: 14,
    fontWeight: 500,
    lineHeight: '22px',
    letterSpacing: 0,
    textAlign: 'left',
    color: isDark ? '#ffffff' : '#191919',
  };
  const thinkGifUrl = isDark ? thinkDarkGif : thinkLightGif;
  const processHistoryStateText = processHistoryState?.status === 'LOADING' ? null : resolveProcessHistoryStateText(t, processHistoryState);
  const isProcessHistoryLoading = processHistoryState?.status === 'LOADING';

  const structuredProcessPresentation = hasStructuredProcessPresentation(processEntries);
  const hasPendingSupplementalInput = pendingSupplementalInputEntryKeys.size > 0;
  const defaultProcessPanelMode = resolveDefaultProcessPanelMode(executionDetailsPhase, processEntries);
  const processPanelScopeKey = displayRunId ? `${rootMessageId}:${displayRunId}` : rootMessageId;
  const persistedUserPanelMode = persistedProcessPanelModes.get(processPanelScopeKey);
  const initialProcessPanelMode =
    persistedUserPanelMode === 'user-expanded' || persistedUserPanelMode === 'user-collapsed' ? persistedUserPanelMode : defaultProcessPanelMode;
  const [processPanelState, setProcessPanelState] = useState<{
    readonly scopeKey: string;
    readonly mode: ProcessPanelMode;
  }>(() => ({
    scopeKey: processPanelScopeKey,
    mode: initialProcessPanelMode,
  }));
  const processPanelMode = processPanelState.scopeKey === processPanelScopeKey ? processPanelState.mode : initialProcessPanelMode;
  const updateProcessPanelMode = useCallback(
    (nextMode: ProcessPanelMode | ((currentMode: ProcessPanelMode) => ProcessPanelMode)) => {
      setProcessPanelState((currentState) => {
        const currentMode = currentState.scopeKey === processPanelScopeKey ? currentState.mode : initialProcessPanelMode;
        return {
          scopeKey: processPanelScopeKey,
          mode: typeof nextMode === 'function' ? nextMode(currentMode) : nextMode,
        };
      });
    },
    [initialProcessPanelMode, processPanelScopeKey],
  );
  const shouldForceDiagnosticPanelOpen = (status === 'FAILED' || hasPendingSupplementalInput) && processPanelMode === 'auto-collapsed';
  const processPanelModeIsOpen = processPanelMode === 'auto-expanded' || processPanelMode === 'user-expanded' || shouldForceDiagnosticPanelOpen;
  const processPanelHasContent = processEntries.length > 0 || isProcessHistoryLoading;
  const processPanelWouldBeOpen = processPanelHasContent && processPanelModeIsOpen;
  const isCurrentlyFollowingBottom = readIsViewportFollowingBottom?.() ?? isViewportFollowingBottom;
  const persistentDetailKeys = useMemo(
    () => new Set(processDisplayEntries.filter(hasPiuStructuredDetail).map((entry) => entry.key)),
    [processDisplayEntries],
  );
  const {
    expandedKeys: expandedProcessEntryKeys,
    renderedKeys: renderedProcessEntryDetailKeys,
    visibleKeys: visibleProcessEntryDetailKeys,
    hasManualExpandedEntry,
    toggleEntry: toggleProcessEntryExpansion,
  } = useProcessEntryDisclosure({
    rootMessageId,
    displayRunId,
    executionDetailsPhase,
    processDisplayEntries,
    latestAssistantAnswerPresentationOrder,
    panelIsOpen: processPanelWouldBeOpen,
    prefersReducedMotion,
    revealAutomaticDetailKeys: pendingSupplementalInputEntryKeys,
    persistentDetailKeys,
  });
  const hasPersistentRenderedDetail = [...persistentDetailKeys].some((key) => renderedProcessEntryDetailKeys.has(key));
  const isCompletedAnswerHandoffCollapsed =
    status === 'COMPLETED' &&
    hasAnswerContent &&
    !hasPendingSupplementalInput &&
    isCurrentlyFollowingBottom &&
    (processPanelMode === 'auto-expanded' || processPanelMode === 'auto-collapsed') &&
    !hasManualExpandedEntry;
  const shouldShowProcessDetails = processPanelWouldBeOpen && !isCompletedAnswerHandoffCollapsed;
  const [isProcessPanelRendered, setIsProcessPanelRendered] = useState(shouldShowProcessDetails);
  const [isProcessPanelVisible, setIsProcessPanelVisible] = useState(shouldShowProcessDetails);
  const [isProcessPanelTransitioning, setIsProcessPanelTransitioning] = useState(false);
  const [processPanelHeight, setProcessPanelHeight] = useState(0);
  const shouldRenderProcessPanel = (isProcessPanelRendered && !isCompletedAnswerHandoffCollapsed) || hasPersistentRenderedDetail;
  const shouldUseProcessPanelNaturalHeight = isProcessPanelVisible && !isProcessPanelTransitioning && renderedProcessEntryDetailKeys.size > 0;

  const autoCollapseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const panelAnimationTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const panelAnimationFrameRef = useRef<number | null>(null);
  const panelVisibilityFrameRef = useRef<number | null>(null);
  const processPanelContentRef = useRef<HTMLDivElement | null>(null);
  const processSummaryRef = useRef<HTMLDivElement | null>(null);
  const explicitExpansionReportedRef = useRef(false);
  const processEntryAppearanceRef = useRef<{
    readonly scopeKey: string;
    readonly seenKeys: Set<string>;
  } | null>(null);
  const processEntryAppearanceTimerRefs = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const [enteringProcessEntryKeys, setEnteringProcessEntryKeys] = useState<ReadonlySet<string>>(() => new Set());

  const clearProcessEntryAppearance = useCallback((entryKey: string) => {
    const timer = processEntryAppearanceTimerRefs.current.get(entryKey);
    if (timer !== undefined) {
      clearTimeout(timer);
      processEntryAppearanceTimerRefs.current.delete(entryKey);
    }
    setEnteringProcessEntryKeys((currentKeys) => {
      if (!currentKeys.has(entryKey)) {
        return currentKeys;
      }
      const nextKeys = new Set(currentKeys);
      nextKeys.delete(entryKey);
      return nextKeys;
    });
  }, []);

  const requestSummaryAnchorCompensation = useCallback(
    (beforeTop: number | null) => {
      if (beforeTop === null) {
        return;
      }
      panelAnimationFrameRef.current = requestAnimationFrame(() => {
        const afterTop = processSummaryRef.current?.getBoundingClientRect().top ?? beforeTop;
        const delta = afterTop - beforeTop;
        if (delta !== 0) {
          onRequestAnchorCompensation?.(delta);
        }
        panelAnimationFrameRef.current = null;
      });
    },
    [onRequestAnchorCompensation],
  );

  const readViewportFollowingBottom = useCallback(
    () => readIsViewportFollowingBottom?.() ?? isViewportFollowingBottom,
    [isViewportFollowingBottom, readIsViewportFollowingBottom],
  );

  useLayoutEffect(() => {
    const currentEntryKeys = processDisplayEntries.map((entry) => entry.key);
    const appearanceState = processEntryAppearanceRef.current;
    if (appearanceState?.scopeKey !== processPanelScopeKey) {
      for (const timer of processEntryAppearanceTimerRefs.current.values()) {
        clearTimeout(timer);
      }
      processEntryAppearanceTimerRefs.current.clear();
      processEntryAppearanceRef.current = {
        scopeKey: processPanelScopeKey,
        seenKeys: new Set(currentEntryKeys),
      };
      setEnteringProcessEntryKeys((currentKeys) => (currentKeys.size === 0 ? currentKeys : new Set()));
      return;
    }

    const newEntryKeys = currentEntryKeys.filter((entryKey) => !appearanceState.seenKeys.has(entryKey));
    for (const entryKey of newEntryKeys) {
      appearanceState.seenKeys.add(entryKey);
    }

    if (!isLatest || isTerminal || prefersReducedMotion) {
      for (const timer of processEntryAppearanceTimerRefs.current.values()) {
        clearTimeout(timer);
      }
      processEntryAppearanceTimerRefs.current.clear();
      setEnteringProcessEntryKeys((currentKeys) => (currentKeys.size === 0 ? currentKeys : new Set()));
      return;
    }
    if (newEntryKeys.length === 0) {
      return;
    }

    setEnteringProcessEntryKeys((currentKeys) => {
      const nextKeys = new Set(currentKeys);
      for (const entryKey of newEntryKeys) {
        nextKeys.add(entryKey);
      }
      return nextKeys;
    });
    for (const entryKey of newEntryKeys) {
      const previousTimer = processEntryAppearanceTimerRefs.current.get(entryKey);
      if (previousTimer !== undefined) {
        clearTimeout(previousTimer);
      }
      processEntryAppearanceTimerRefs.current.set(
        entryKey,
        setTimeout(() => {
          clearProcessEntryAppearance(entryKey);
        }, PROCESS_ENTRY_APPEARANCE_MS),
      );
    }
  }, [clearProcessEntryAppearance, isLatest, isTerminal, prefersReducedMotion, processDisplayEntries, processPanelScopeKey]);

  // Persist user panel mode
  useEffect(() => {
    if (processPanelMode === 'user-expanded' || processPanelMode === 'user-collapsed') {
      persistedProcessPanelModes.set(processPanelScopeKey, processPanelMode);
    } else {
      persistedProcessPanelModes.delete(processPanelScopeKey);
    }
  }, [processPanelMode, processPanelScopeKey]);

  useEffect(() => {
    const expanded = processPanelMode === 'user-expanded';
    if (expanded === explicitExpansionReportedRef.current) {
      return;
    }
    explicitExpansionReportedRef.current = expanded;
    onExpansionChange?.(expanded);
  }, [onExpansionChange, processPanelMode]);

  useEffect(
    () => () => {
      if (explicitExpansionReportedRef.current) {
        explicitExpansionReportedRef.current = false;
        onExpansionChange?.(false);
      }
    },
    [onExpansionChange],
  );

  // Auto-expand when phase transitions back from settled
  useEffect(() => {
    if (processPanelMode !== 'auto-collapsed' || executionDetailsPhase === 'settled') {
      return;
    }
    updateProcessPanelMode('auto-expanded');
  }, [executionDetailsPhase, processPanelMode, updateProcessPanelMode]);

  useEffect(() => {
    if (processPanelMode === 'auto-collapsed' && structuredProcessPresentation && !isTerminal) {
      updateProcessPanelMode('auto-expanded');
    }
  }, [isTerminal, processPanelMode, structuredProcessPresentation, updateProcessPanelMode]);

  useLayoutEffect(() => {
    if (isCompletedAnswerHandoffCollapsed && processPanelMode === 'auto-expanded') {
      updateProcessPanelMode('auto-collapsed');
    }
  }, [isCompletedAnswerHandoffCollapsed, processPanelMode, updateProcessPanelMode]);

  // Auto-collapse when settled and viewport at bottom
  useEffect(() => {
    const isFollowingBottom = readViewportFollowingBottom();
    if (
      processPanelMode !== 'auto-expanded' ||
      executionDetailsPhase !== 'settled' ||
      hasAnswerContent ||
      status === 'FAILED' ||
      hasPendingSupplementalInput ||
      structuredProcessPresentation ||
      !isFollowingBottom
    ) {
      return undefined;
    }

    autoCollapseTimerRef.current = setTimeout(() => {
      if (!readViewportFollowingBottom()) {
        autoCollapseTimerRef.current = null;
        return;
      }
      updateProcessPanelMode('auto-collapsed');
      onRequestScrollToBottom?.();
      autoCollapseTimerRef.current = null;
    }, PROCESS_AUTO_COLLAPSE_DELAY_MS);

    return () => {
      if (autoCollapseTimerRef.current !== null) {
        clearTimeout(autoCollapseTimerRef.current);
        autoCollapseTimerRef.current = null;
      }
    };
  }, [
    executionDetailsPhase,
    hasAnswerContent,
    hasPendingSupplementalInput,
    onRequestScrollToBottom,
    processPanelMode,
    readViewportFollowingBottom,
    status,
    structuredProcessPresentation,
    updateProcessPanelMode,
  ]);

  // Measure panel content height
  useLayoutEffect(() => {
    if (!isProcessPanelRendered) {
      setProcessPanelHeight(0);
      onPanelHeightChange?.(0);
      return undefined;
    }
    const element = processPanelContentRef.current;
    if (!element) {
      setProcessPanelHeight(0);
      return undefined;
    }
    const updateHeight = () => {
      const h = Math.ceil(element.getBoundingClientRect().height);
      setProcessPanelHeight(h);
      onPanelHeightChange?.(h);
    };
    updateHeight();
    if (typeof ResizeObserver === 'undefined') {
      return undefined;
    }
    const observer = new ResizeObserver(() => updateHeight());
    observer.observe(element);
    return () => observer.disconnect();
  }, [isProcessPanelRendered, onPanelHeightChange]);

  // Panel render/visibility lifecycle
  useEffect(() => {
    if (panelAnimationTimerRef.current !== null) {
      clearTimeout(panelAnimationTimerRef.current);
      panelAnimationTimerRef.current = null;
    }
    if (panelVisibilityFrameRef.current !== null) {
      cancelAnimationFrame(panelVisibilityFrameRef.current);
      panelVisibilityFrameRef.current = null;
    }

    if (shouldShowProcessDetails) {
      setIsProcessPanelRendered(true);
      return;
    }

    if (isCompletedAnswerHandoffCollapsed) {
      setIsProcessPanelRendered(false);
      setIsProcessPanelVisible(false);
      setIsProcessPanelTransitioning(false);
      setProcessPanelHeight(0);
      return;
    }

    if (!isProcessPanelRendered) {
      setIsProcessPanelVisible(false);
      setIsProcessPanelTransitioning(false);
      return;
    }

    const measuredHeight = processPanelContentRef.current?.getBoundingClientRect().height;
    if (measuredHeight !== undefined && measuredHeight > 0) {
      setProcessPanelHeight(Math.ceil(measuredHeight));
    }
    setIsProcessPanelTransitioning(true);
    panelVisibilityFrameRef.current = requestAnimationFrame(() => {
      setIsProcessPanelVisible(false);
      panelVisibilityFrameRef.current = null;
    });
    panelAnimationTimerRef.current = setTimeout(() => {
      setIsProcessPanelRendered(false);
      setIsProcessPanelTransitioning(false);
      panelAnimationTimerRef.current = null;
    }, processTransitionMs);
  }, [isCompletedAnswerHandoffCollapsed, isProcessPanelRendered, processTransitionMs, shouldShowProcessDetails]);

  // Panel show transition
  useEffect(() => {
    if (!shouldShowProcessDetails || !isProcessPanelRendered || processPanelHeight === 0 || isProcessPanelVisible) {
      return;
    }
    if (panelVisibilityFrameRef.current !== null) {
      cancelAnimationFrame(panelVisibilityFrameRef.current);
      panelVisibilityFrameRef.current = null;
    }
    if (panelAnimationTimerRef.current !== null) {
      clearTimeout(panelAnimationTimerRef.current);
      panelAnimationTimerRef.current = null;
    }
    setIsProcessPanelTransitioning(true);
    panelVisibilityFrameRef.current = requestAnimationFrame(() => {
      setIsProcessPanelVisible(true);
      panelVisibilityFrameRef.current = null;
      panelAnimationTimerRef.current = setTimeout(() => {
        setIsProcessPanelTransitioning(false);
        panelAnimationTimerRef.current = null;
      }, processTransitionMs);
    });
  }, [shouldShowProcessDetails, isProcessPanelRendered, isProcessPanelVisible, processPanelHeight, processTransitionMs]);

  // Cleanup all timers
  useEffect(() => {
    return () => {
      if (autoCollapseTimerRef.current !== null) {
        clearTimeout(autoCollapseTimerRef.current);
      }
      if (panelAnimationTimerRef.current !== null) {
        clearTimeout(panelAnimationTimerRef.current);
      }
      if (panelAnimationFrameRef.current !== null) {
        cancelAnimationFrame(panelAnimationFrameRef.current);
      }
      if (panelVisibilityFrameRef.current !== null) {
        cancelAnimationFrame(panelVisibilityFrameRef.current);
      }
      for (const timer of processEntryAppearanceTimerRefs.current.values()) {
        clearTimeout(timer);
      }
      processEntryAppearanceTimerRefs.current.clear();
    };
  }, []);

  // Merge process explanations into their preceding entry, then place trusted
  // Workflow-as-Tool children immediately after the matching outer Workflow.
  const renderDisplayEntries = useMemo((): ProcessEntryWithExplanations[] => {
    const mergedEntries: ProcessEntryWithExplanations[] = [];
    for (const entry of processDisplayEntries) {
      if (entry.kind === 'process-explanation' && mergedEntries.length > 0) {
        const last = mergedEntries[mergedEntries.length - 1]!;
        mergedEntries[mergedEntries.length - 1] = {
          ...last,
          explanationDetails: [
            ...(last.explanationDetails ?? []),
            { key: entry.key, title: entry.title, detail: entry.detail, contentType: entry.contentType },
          ],
        };
      } else {
        mergedEntries.push(entry);
      }
    }

    const workflowParents = new Map<string, ProcessEntryWithExplanations>();
    for (const entry of mergedEntries) {
      if (entry.toolName === 'Workflow' && entry.toolCallId !== undefined) {
        workflowParents.set(entry.toolCallId, entry);
      }
    }
    const childrenByParentKey = new Map<string, ProcessEntryWithExplanations[]>();
    const nestedEntryKeys = new Set<string>();
    for (const entry of mergedEntries) {
      if (entry.parentToolCallId === undefined) {
        continue;
      }
      const parent = workflowParents.get(entry.parentToolCallId);
      if (parent === undefined || parent.key === entry.key) {
        continue;
      }
      const children = childrenByParentKey.get(parent.key) ?? [];
      children.push({ ...entry, parentEntryKey: parent.key });
      childrenByParentKey.set(parent.key, children);
      nestedEntryKeys.add(entry.key);
    }

    const result: ProcessEntryWithExplanations[] = [];
    for (const entry of mergedEntries) {
      if (nestedEntryKeys.has(entry.key)) {
        continue;
      }
      const children = childrenByParentKey.get(entry.key);
      result.push(children === undefined ? entry : { ...entry, hasNestedEntries: true });
      if (children !== undefined) {
        result.push(...children);
      }
    }
    return result;
  }, [processDisplayEntries]);

  const visibleRenderDisplayEntries = useMemo(
    () => renderDisplayEntries.filter((entry) => entry.parentEntryKey === undefined || expandedProcessEntryKeys.has(entry.parentEntryKey)),
    [expandedProcessEntryKeys, renderDisplayEntries],
  );

  const STEP_RUNNING_MIN_DISPLAY_MS = 600;
  const stepRunningStartRef = useRef<Map<string, number>>(new Map());
  const [effectiveStepRunningKeys, setEffectiveStepRunningKeys] = useState<ReadonlySet<string>>(new Set());

  const currentStepRunningKeys = useMemo(() => {
    const keys = new Set<string>();
    for (const entry of visibleRenderDisplayEntries) {
      const isVisuallySuperseded = isProcessEntryVisuallySuperseded(entry, latestAssistantAnswerPresentationOrder);
      const isActiveEntry =
        isLatest &&
        !isTerminal &&
        (entry.key === activeProcessEntryKey || (entry.explanationDetails?.some((e) => e.key === activeProcessEntryKey) ?? false)) &&
        !isVisuallySuperseded;
      if (isActiveEntry && !entry.isFinal && !entry.isFailure && entry.kind !== 'thinking' && entry.toolEventType !== 'SUB_TITLE') {
        keys.add(entry.key);
      }
    }
    return keys;
  }, [visibleRenderDisplayEntries, isLatest, isTerminal, activeProcessEntryKey, latestAssistantAnswerPresentationOrder]);

  const currentStepRunningKey = useMemo(() => Array.from(currentStepRunningKeys).sort().join(','), [currentStepRunningKeys]);

  useEffect(() => {
    const now = Date.now();
    for (const key of currentStepRunningKeys) {
      if (!stepRunningStartRef.current.has(key)) {
        stepRunningStartRef.current.set(key, now);
      }
    }
    const effective = new Set(currentStepRunningKeys);
    for (const [key, startTime] of stepRunningStartRef.current) {
      if (!currentStepRunningKeys.has(key) && now - startTime < STEP_RUNNING_MIN_DISPLAY_MS) {
        effective.add(key);
      }
    }
    setEffectiveStepRunningKeys(effective);
    const timers: Array<ReturnType<typeof setTimeout>> = [];
    for (const [key, startTime] of stepRunningStartRef.current) {
      if (!currentStepRunningKeys.has(key)) {
        const remaining = STEP_RUNNING_MIN_DISPLAY_MS - (Date.now() - startTime);
        if (remaining > 0) {
          timers.push(
            setTimeout(() => {
              stepRunningStartRef.current.delete(key);
              setEffectiveStepRunningKeys((prev) => {
                const next = new Set(prev);
                next.delete(key);
                return next;
              });
            }, remaining),
          );
        } else {
          stepRunningStartRef.current.delete(key);
        }
      }
    }
    return () => {
      for (const timer of timers) {
        clearTimeout(timer);
      }
    };
  }, [currentStepRunningKey]);

  const handleExpandPanelEntryClick = useCallback((entry: ProcessDisplayEntry) => {
    if (!entry.hasExpandPanel || !entry.expandPanelData) {
      return;
    }
    expandPanelStore
      .getState()
      .setContent({ toolMessageType: entry.expandPanelData.toolMessageType, content: entry.expandPanelData.content }, entry.key);
    expandPanelStore.getState().open();
  }, []);

  const handleProcessToggle = () => {
    const beforeTop = !readViewportFollowingBottom() ? (processSummaryRef.current?.getBoundingClientRect().top ?? null) : null;
    updateProcessPanelMode(shouldShowProcessDetails ? 'user-collapsed' : 'user-expanded');
    requestSummaryAnchorCompensation(beforeTop);
  };

  const shouldDeferCollapsedLoadingSummary =
    isProcessHistoryLoading && processEntries.length === 0 && !showProcessHistoryLoadingIndicator && !shouldShowProcessDetails;

  if (!showProcessSummary || shouldDeferCollapsedLoadingSummary) {
    return null;
  }

  return (
    <div style={{ marginBottom: 12 }}>
      {shouldShowProcessIdleSweep ? <style>{PROCESS_IDLE_SWEEP_CSS}</style> : null}

      {/* Summary row */}
      <div
        ref={processSummaryRef}
        data-testid="turn-process-summary"
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
          fontSize: 12,
          color: 'var(--color-text-secondary)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 8, minWidth: 0 }}>
          {processEntries.length > 0 ||
          isRunningPhase ||
          (isProcessHistoryLoading && (showProcessHistoryLoadingIndicator || shouldShowProcessDetails)) ? (
            <button
              data-testid="turn-process-toggle"
              onClick={handleProcessToggle}
              aria-expanded={shouldShowProcessDetails}
              style={{
                border: 'none',
                background: 'transparent',
                cursor: 'pointer',
                color: isDark ? '#ffffff' : '#191919',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 5,
                padding: 0,
                fontSize: 14,
              }}
            >
              {isRunningPhase ? (
                <>
                  <img
                    src={executingGif}
                    alt=""
                    data-testid="turn-process-executing-gif"
                    style={{ width: 28, height: 28, flexShrink: 0, marginLeft: -4 }}
                  />
                  <span data-testid="turn-process-summary-text" style={summaryTextFontStyle}>
                    {executingBrandText}
                  </span>
                </>
              ) : (
                <span data-testid="turn-process-summary-text" style={summaryTextFontStyle}>
                  {processSummary}
                </span>
              )}
              <img
                src={isDark ? collapseDark : collapseLight}
                alt=""
                style={{
                  width: 12,
                  height: 12,
                  flexShrink: 0,
                  transform: shouldShowProcessDetails ? 'rotate(180deg)' : 'none',
                  transition: `transform ${processTransitionMs}ms ease`,
                }}
              />
            </button>
          ) : processHistoryStateText === null ? (
            <span data-testid="turn-process-summary-text" style={summaryTextFontStyle}>
              {processSummary}
            </span>
          ) : null}
          {processHistoryStateText ? (
            <span
              data-testid="turn-process-history-state"
              aria-live="polite"
              style={{ minWidth: 0, overflowWrap: 'anywhere', wordBreak: 'break-word', whiteSpace: 'normal' }}
            >
              {processHistoryStateText}
            </span>
          ) : null}
          {isProcessHistoryLoading && showProcessHistoryLoadingIndicator ? (
            <span
              data-testid="turn-process-history-spinner"
              role="progressbar"
              aria-label={t('turn.process.processHistoryLoading')}
              style={{
                width: 10,
                height: 10,
                borderRadius: '50%',
                border: '1px solid var(--color-border)',
                borderTopColor: 'var(--color-text-secondary)',
                display: 'inline-block',
              }}
            />
          ) : null}
        </div>
        {showProcessTimelineAction && shouldShowProcessDetails ? (
          <button
            data-testid="turn-process-timeline-button"
            onClick={(event) => onOpenFullProcess?.(block, event.currentTarget)}
            style={{
              border: 'none',
              background: 'transparent',
              cursor: 'pointer',
              color: 'var(--color-text-tertiary)',
              padding: 0,
              fontSize: 12,
              lineHeight: 1.2,
              flexShrink: 0,
            }}
          >
            {t('turn.fullProcess')}
          </button>
        ) : null}
      </div>

      {/* Expandable panel */}
      {shouldRenderProcessPanel && processPanelHasContent && (
        <div
          aria-hidden={!shouldShowProcessDetails}
          inert={!shouldShowProcessDetails}
          style={{
            height: isProcessPanelVisible
              ? shouldUseProcessPanelNaturalHeight
                ? 'auto'
                : `${processPanelHeight + PROCESS_PANEL_TOP_GAP_PX}px`
              : '0px',
            opacity: isProcessPanelVisible ? 1 : 0,
            overflow: shouldUseProcessPanelNaturalHeight ? 'visible' : 'hidden',
            transition: `height ${processTransitionMs}ms ease-out, opacity ${processTransitionMs}ms ease-out, padding-top ${processTransitionMs}ms ease-out`,
            position: 'relative',
            boxSizing: 'border-box',
            paddingTop: isProcessPanelVisible ? PROCESS_PANEL_TOP_GAP_PX : 0,
          }}
        >
          <div
            key={processPanelScopeKey}
            ref={processPanelContentRef}
            data-testid="turn-process-panel"
            style={{
              display: 'flex',
              flexDirection: 'column',
              boxSizing: 'border-box',
              scrollbarGutter: 'stable',
              overscrollBehavior: 'contain',
            }}
          >
            {isProcessHistoryLoading ? <div data-testid="turn-process-history-loading-body">{t('turn.process.processHistoryLoading')}</div> : null}
            {visibleRenderDisplayEntries.map((entry, entryIndex) => {
              const isVisuallySuperseded = isProcessEntryVisuallySuperseded(entry, latestAssistantAnswerPresentationOrder);
              const isActiveEntry =
                isLatest &&
                !isTerminal &&
                (entry.key === activeProcessEntryKey || (entry.explanationDetails?.some((e) => e.key === activeProcessEntryKey) ?? false)) &&
                !isVisuallySuperseded;
              const isEnteringEntry = enteringProcessEntryKeys.has(entry.key);
              const shouldSweepDetail = shouldShowProcessIdleSweep && isActiveEntry;
              const detailClassName = shouldSweepDetail ? 'turn-process-detail--idle-sweep' : undefined;
              const markdownCachePolicy = isActiveEntry && !isTerminal ? 'streaming' : 'stable';
              const isLastEntry = entryIndex === visibleRenderDisplayEntries.length - 1;
              const isProcessExplanation = entry.kind === 'process-explanation';
              const isContentOnlyEntry = !isProcessExplanation && entry.title.trim().length === 0;
              const isEntryExpanded = expandedProcessEntryKeys.has(entry.key);
              const isGovernedSystemEvent = entry.presentation === 'governed-system-event';
              const hasEntryDisclosureContent =
                !isProcessExplanation &&
                !isContentOnlyEntry &&
                (!isGovernedSystemEvent || entry.isExpandable) &&
                ((!entry.isFailure && entry.summary.trim().length > 0) ||
                  entry.detail.trim().length > 0 ||
                  Boolean(entry.structuredSegments?.length) ||
                  Boolean(entry.structuredSections?.length) ||
                  Boolean(entry.ragRetrievalItems?.length) ||
                  entry.hasNestedEntries === true);
              const shouldRenderEntryDetail = hasEntryDisclosureContent && renderedProcessEntryDetailKeys.has(entry.key);
              const isEntryDetailVisible = visibleProcessEntryDetailKeys.has(entry.key);
              const isStepRunning = effectiveStepRunningKeys.has(entry.key);
              const baseIconType = resolveProcessIconType(entry.title, entry.toolEventType, entry.isFailure, isStepRunning, entry.severity);
              const isFinalComplete = isLastEntry && baseIconType === 'process-complete' && hasAnswerContent;
              const iconUrl = resolveProcessIconUrl(isFinalComplete ? 'final-complete' : baseIconType, isDark);
              const isThinkingEntry = baseIconType === 'think' && isActiveEntry;
              const hasShimmerText = isThinkingEntry || isStepRunning;
              const titleLabel = (
                <span
                  className={hasShimmerText ? 'turn-process-entry-title turn-process-thinking-shimmer' : 'turn-process-entry-title'}
                  data-testid="turn-process-entry-title"
                  style={{
                    minWidth: 0,
                    overflowWrap: 'anywhere',
                    wordBreak: 'break-word',
                    ...(hasShimmerText
                      ? {}
                      : {
                          color:
                            baseIconType === 'think' || baseIconType === 'skill'
                              ? isDark
                                ? 'rgba(201,201,201,1)'
                                : '#777777'
                              : isDark
                                ? '#ffffff'
                                : 'var(--color-text-primary)',
                        }),
                    fontWeight: isActiveEntry ? 500 : undefined,
                  }}
                >
                  {isThinkingEntry ? t('turn.process.thinkingActive') : entry.title}
                </span>
              );
              const titleControl =
                entry.hasExpandPanel || hasEntryDisclosureContent ? (
                  <button
                    data-testid="turn-process-entry-toggle"
                    aria-expanded={isEntryExpanded}
                    onClick={() => {
                      if (entry.hasExpandPanel && entry.expandPanelData) {
                        handleExpandPanelEntryClick(entry);
                        return;
                      }
                      toggleProcessEntryExpansion(entry.key);
                    }}
                    style={{
                      border: 'none',
                      background: 'transparent',
                      cursor: 'pointer',
                      display: 'inline-flex',
                      alignItems: 'baseline',
                      gap: 8,
                      padding: 0,
                      maxWidth: '100%',
                      textAlign: 'left',
                      fontSize: 13,
                      lineHeight: 1.5,
                      color:
                        baseIconType === 'process-complete' ||
                        baseIconType === 'final-complete' ||
                        baseIconType === 'warning' ||
                        baseIconType === 'info'
                          ? isDark
                            ? '#ffffff'
                            : 'var(--color-text-primary)'
                          : isDark
                            ? 'rgba(201,201,201,1)'
                            : '#777777',
                    }}
                  >
                    {titleLabel}
                    {entry.hasExpandPanel ? null : (
                      <img
                        src={isDark ? collapseDark : collapseLight}
                        alt=""
                        style={{
                          width: 12,
                          height: 12,
                          flexShrink: 0,
                          marginLeft: 8,
                          marginTop: 4,
                          cursor: 'pointer',
                          transform: isEntryExpanded ? 'rotate(180deg)' : 'none',
                          transition: `transform ${processTransitionMs}ms ease`,
                        }}
                      />
                    )}
                  </button>
                ) : (
                  titleLabel
                );
              return (
                <div
                  key={entry.key}
                  data-testid={isProcessExplanation ? 'turn-process-explanation' : 'turn-process-entry'}
                  role={isProcessExplanation ? 'note' : undefined}
                  aria-label={isProcessExplanation ? entry.title : undefined}
                  data-process-active={isActiveEntry ? 'true' : undefined}
                  aria-current={isActiveEntry ? 'step' : undefined}
                  className={isEnteringEntry ? 'turn-process-entry--entering' : undefined}
                  onAnimationEnd={(event) => {
                    if (event.animationName === 'nextagent-process-entry-appear') {
                      clearProcessEntryAppearance(entry.key);
                    }
                  }}
                  style={{ display: 'flex', gap: 8, background: 'transparent', marginBottom: 4, padding: 0 }}
                >
                  {isContentOnlyEntry ? (
                    <span aria-hidden="true" data-testid="turn-process-entry-layout-gutter" style={{ width: 20, flexShrink: 0 }} />
                  ) : !isProcessExplanation ? (
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flexShrink: 0 }}>
                      <span
                        data-testid="turn-process-entry-icon-node"
                        style={{
                          width: 20,
                          height: 20,
                          display: 'grid',
                          placeItems: 'center',
                          flexShrink: 0,
                          borderRadius: '50%',
                          background: 'transparent',
                        }}
                      >
                        {isThinkingEntry ? (
                          <img src={thinkGifUrl} alt="" data-testid="turn-process-think-gif" style={{ width: 20, height: 20, display: 'block' }} />
                        ) : isStepRunning ? (
                          <img
                            src={iconUrl ?? ''}
                            alt=""
                            data-testid="turn-process-step-running"
                            style={{ width: 16, height: 16, display: 'block' }}
                          />
                        ) : baseIconType === 'warning' ? (
                          <WarningOutlined
                            aria-hidden="true"
                            data-testid="turn-process-entry-warning-icon"
                            style={{ color: 'var(--color-status-warning-dot)', fontSize: 14 }}
                          />
                        ) : baseIconType === 'info' ? (
                          <InfoCircleOutlined
                            aria-hidden="true"
                            data-testid="turn-process-entry-info-icon"
                            style={{ color: 'var(--color-status-info-dot)', fontSize: 14 }}
                          />
                        ) : (
                          <img src={iconUrl ?? ''} alt="" style={{ width: 14, height: 14, display: 'block' }} />
                        )}
                      </span>
                      {!isLastEntry ? <div style={{ width: 1, flex: 1, minHeight: 12, background: 'var(--color-border)', marginTop: 4 }} /> : null}
                    </div>
                  ) : null}
                  <div
                    style={{
                      flex: 1,
                      minWidth: 0,
                    }}
                  >
                    {!isProcessExplanation && !isContentOnlyEntry ? (
                      <div style={{ height: 22 }}>
                        {entry.hasExpandPanel ? (
                          <Tooltip key={entry.key} title={t('expandPanel.clickToOpen')}>
                            {titleControl}
                          </Tooltip>
                        ) : (
                          titleControl
                        )}
                      </div>
                    ) : null}
                    {isContentOnlyEntry ? (
                      <div
                        className="turn-process-entry-detail"
                        data-testid="turn-process-entry-detail"
                        style={{ overflowWrap: 'anywhere', wordBreak: 'break-word' }}
                      >
                        {entry.structuredSegments && entry.structuredSegments.length > 0 ? (
                          <AnswerSegments segments={entry.structuredSegments} />
                        ) : shouldRenderProcessDetailAsMarkdown(entry) ? (
                          <MarkdownContent content={trimLeadingBlankLines(entry.detail)} fontSize={14} cachePolicy={markdownCachePolicy} />
                        ) : (
                          <div style={{ whiteSpace: 'pre-wrap' }}>{trimLeadingBlankLines(entry.detail)}</div>
                        )}
                      </div>
                    ) : isProcessExplanation ? (
                      <div
                        className="turn-process-entry-detail"
                        data-testid="turn-process-entry-detail"
                        style={{ overflowWrap: 'anywhere', wordBreak: 'break-word' }}
                      >
                        {shouldRenderProcessDetailAsMarkdown(entry) ? (
                          <MarkdownContent content={trimLeadingBlankLines(entry.detail)} cachePolicy={markdownCachePolicy} />
                        ) : (
                          <div style={{ fontSize: 16, whiteSpace: 'pre-wrap' }}>{trimLeadingBlankLines(entry.detail)}</div>
                        )}
                      </div>
                    ) : null}
                    {!entry.isFailure && isGovernedSystemEvent && entry.summary.trim().length > 0 ? (
                      <div
                        data-testid="turn-process-entry-summary"
                        style={{
                          marginTop: 2,
                          color: 'var(--color-text-secondary)',
                          fontSize: 14,
                          lineHeight: 1.5,
                          overflowWrap: 'anywhere',
                          wordBreak: 'break-word',
                        }}
                      >
                        {entry.summary}
                      </div>
                    ) : null}
                    {shouldRenderEntryDetail ? (
                      <div
                        aria-hidden={!isEntryExpanded}
                        inert={!isEntryExpanded}
                        style={{
                          display: 'grid',
                          gridTemplateRows: isEntryDetailVisible ? '1fr' : '0fr',
                          opacity: isEntryDetailVisible ? 1 : 0,
                          marginTop: isEntryDetailVisible ? 2 : 0,
                          overflow: 'hidden',
                          transition: `grid-template-rows ${processTransitionMs}ms ease-out, opacity ${processTransitionMs}ms ease-out, margin-top ${processTransitionMs}ms ease-out`,
                        }}
                      >
                        <div style={{ minHeight: 0 }}>
                          <div
                            className={shouldSweepDetail ? detailClassName : 'turn-process-entry-summary'}
                            data-testid={shouldSweepDetail ? 'turn-process-idle-sweep' : 'turn-process-entry-summary'}
                            style={{ minWidth: 0, overflowWrap: 'anywhere', wordBreak: 'break-word' }}
                          >
                            {entry.isFailure || isGovernedSystemEvent || entry.summary?.trim() === entry.detail?.trim()
                              ? null
                              : trimLeadingBlankLines(entry.summary)}
                          </div>
                          <div
                            className="turn-process-entry-detail"
                            data-testid="turn-process-entry-detail"
                            style={{
                              minHeight: 0,
                              maxWidth: '100%',
                              minWidth: 0,
                              marginTop: 6,
                              overflowWrap: 'anywhere',
                              wordBreak: 'break-word',
                            }}
                          >
                            {entry.structuredSections && entry.structuredSections.length > 0 ? (
                              <StructuredProcessSections sections={entry.structuredSections} isDark={isDark} />
                            ) : null}
                            {entry.structuredSegments && entry.structuredSegments.length > 0 ? (
                              <AnswerSegments segments={entry.structuredSegments} />
                            ) : entry.ragRetrievalItems && entry.ragRetrievalItems.length > 0 ? (
                              <RagRetrievalDetails items={entry.ragRetrievalItems} />
                            ) : shouldRenderProcessDetailAsMarkdown(entry) ? (
                              <MarkdownContent
                                content={trimLeadingBlankLines(entry.detail)}
                                fontSize={14}
                                textColor="var(--color-text-secondary)"
                                cachePolicy={markdownCachePolicy}
                              />
                            ) : (
                              <div style={{ whiteSpace: 'pre-wrap' }}>{trimLeadingBlankLines(entry.detail)}</div>
                            )}
                          </div>
                        </div>
                      </div>
                    ) : null}
                    {entry.isFailure && entry.summary.trim().length > 0 ? (
                      <div
                        data-testid="turn-process-failure-reason"
                        style={{
                          marginTop: 2,
                          color: 'var(--color-text-secondary)',
                          fontSize: 14,
                          lineHeight: 1.5,
                          overflowWrap: 'anywhere',
                          wordBreak: 'break-word',
                        }}
                      >
                        {entry.summary}
                      </div>
                    ) : null}
                    {entry.explanationDetails?.map((expl) => (
                      <div
                        key={expl.key}
                        className="turn-process-entry-detail"
                        data-testid="turn-process-explanation"
                        role="note"
                        aria-label={expl.title}
                        style={{ marginTop: 6, overflowWrap: 'anywhere', wordBreak: 'break-word' }}
                      >
                        {shouldRenderProcessDetailAsMarkdown({ detail: expl.detail, contentType: expl.contentType } as ProcessDisplayEntry) ? (
                          <MarkdownContent content={trimLeadingBlankLines(expl.detail)} cachePolicy={markdownCachePolicy} />
                        ) : (
                          <div style={{ fontSize: 16, whiteSpace: 'pre-wrap' }}>{trimLeadingBlankLines(expl.detail)}</div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
