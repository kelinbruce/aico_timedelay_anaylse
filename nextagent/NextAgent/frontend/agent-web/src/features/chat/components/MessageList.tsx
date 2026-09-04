import { ArrowDownOutlined } from '@ant-design/icons';
import { useMemo, useRef, type RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import { TurnBlockComponent } from './TurnBlock';
import type { AnnotationState, ForkTrigger, ShareTrigger } from './TurnBlock.tsx';
import type { ReportTrigger } from './TurnBlock.tsx';
import type { RunProcessHistoryState, TurnBlock } from '../../../state/contracts';
import type { ProcessHistoryTargetUpdate } from '../history/processHistoryScheduler.ts';
import { useConversationTurnVisibility } from '../history/useConversationTurnVisibility.ts';
import { isProcessHistoryEligibleRunStatus } from '../history/processHistory.ts';

const EMPTY_VIEWPORT_REF: RefObject<HTMLDivElement | null> = { current: null };
const IGNORE_PROCESS_TARGETS = (): void => undefined;

export interface HistoryBoundaryProps {
  readonly hasMore: boolean;
  readonly isLoading: boolean;
  readonly error: string | null;
}

export interface MessageListProps {
  readonly blocks: readonly TurnBlock[];
  readonly onRetry: (rootMessageId: string) => void;
  readonly onEdit: (rootMessageId: string) => void;
  readonly onCancel: (rootMessageId: string) => void;
  readonly onScrollToBottom?: () => void;
  readonly onRequestAnchorCompensation?: (deltaY: number) => void;
  readonly onRequestPreserveReadingAnchor?: () => void;
  readonly isAtBottom?: boolean;
  readonly isFollowingBottom?: boolean;
  readonly readIsFollowingBottom?: () => boolean;
  readonly hasNewMessages?: boolean;
  readonly isLoading?: boolean;
  readonly sessionId?: string;
  readonly showInlineScrollToBottomButton?: boolean;
  readonly editNoticeVisible?: boolean;
  readonly historyBoundary?: HistoryBoundaryProps;
  readonly onOpenFullProcess?: (block: TurnBlock, opener: HTMLButtonElement) => void;
  readonly turnActionsDisabled?: boolean;
  readonly retryDisabledRequestId?: string | null;
  readonly showAnnotations?: boolean;
  readonly annotationsByRunId?: ReadonlyMap<string, AnnotationState>;
  readonly onAnnotationChange?: (runId: string, state: AnnotationState | null) => void;
  readonly onSuggestedQuestionClick?: (question: string) => void;
  readonly onFork?: ForkTrigger;
  readonly forkingAnchorKey?: string | null;
  readonly onShare?: ShareTrigger;
  readonly shareSelection?: boolean;
  readonly selectedRunIds?: ReadonlySet<string>;
  readonly onToggleShareSelection?: (runId: string) => void;
  readonly reportSelectionDisabled?: boolean;
  readonly onGenerateReport?: ReportTrigger;
  readonly reportSelection?: boolean;
  readonly selectedReportRequestIds?: ReadonlySet<string>;
  readonly onToggleReportSelection?: (requestId: string) => void;
  readonly processHistoryByRunId?: Readonly<Record<string, RunProcessHistoryState | undefined>>;
  readonly onRetryRunProcessHistory?: (runId: string) => void;
  readonly scrollViewportRef?: RefObject<HTMLDivElement | null>;
  readonly onProcessHistoryTargetsChange?: (targets: ProcessHistoryTargetUpdate) => void;
  readonly onProcessPanelExpansionChange?: (rootMessageId: string, runId: string, expanded: boolean) => void;
}

export function MessageList({
  blocks,
  onRetry,
  onEdit,
  onCancel,
  onScrollToBottom,
  onRequestAnchorCompensation,
  onRequestPreserveReadingAnchor,
  isAtBottom = true,
  isFollowingBottom = true,
  readIsFollowingBottom,
  hasNewMessages = false,
  isLoading = false,
  showInlineScrollToBottomButton = true,
  editNoticeVisible = false,
  historyBoundary,
  onOpenFullProcess,
  turnActionsDisabled = false,
  retryDisabledRequestId = null,
  showAnnotations = true,
  sessionId,
  annotationsByRunId,
  onAnnotationChange,
  onSuggestedQuestionClick,
  onFork,
  forkingAnchorKey,
  onShare,
  shareSelection = false,
  selectedRunIds,
  onToggleShareSelection,
  reportSelectionDisabled = false,
  onGenerateReport,
  reportSelection = false,
  selectedReportRequestIds,
  onToggleReportSelection,
  processHistoryByRunId,
  onRetryRunProcessHistory,
  scrollViewportRef,
  onProcessHistoryTargetsChange,
  onProcessPanelExpansionChange,
}: MessageListProps) {
  const { t } = useTranslation();
  const listRef = useRef<HTMLDivElement>(null);
  const turnIdentityKey = useMemo(
    () =>
      blocks
        .map((block) =>
          [block.rootMessageId, block.displayRunId ?? '', isProcessHistoryEligibleRunStatus(block.status) ? 'history-eligible' : 'active'].join(':'),
        )
        .join('|'),
    [blocks],
  );
  useConversationTurnVisibility({
    sessionId: sessionId ?? '',
    containerRef: listRef,
    viewportRef: scrollViewportRef ?? EMPTY_VIEWPORT_REF,
    turnIdentityKey,
    onTargetsChange: onProcessHistoryTargetsChange ?? IGNORE_PROCESS_TARGETS,
  });
  const historyBoundaryLabel = historyBoundary?.isLoading ? t('messageList.loadingOlderMessages') : t('messageList.loadOlderFailed');
  const historyBoundaryColor = historyBoundary?.error ? '#b42318' : '#667085';
  const historyBoundaryLineColor = historyBoundary?.error ? '#fecdca' : '#eaecf0';
  const shouldShowHistoryBoundary = Boolean(historyBoundary?.hasMore && (historyBoundary.isLoading || historyBoundary.error));

  return (
    <div ref={listRef} style={{ flex: 1, minHeight: 0, overflow: 'visible', position: 'relative', fontSize: '16px' }}>
      {shouldShowHistoryBoundary && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '12px 0 16px',
          }}
        >
          <div style={{ flex: 1, height: 1, background: historyBoundaryLineColor }} />
          <div
            data-testid="history-boundary-status"
            aria-live="polite"
            style={{
              fontSize: 12,
              lineHeight: 1.4,
              color: historyBoundaryColor,
              cursor: 'default',
              userSelect: 'none',
              whiteSpace: 'nowrap',
              fontWeight: 500,
              letterSpacing: '0.01em',
              padding: '2px 4px',
              borderRadius: 999,
              background: 'transparent',
            }}
          >
            {historyBoundaryLabel}
          </div>
          <div style={{ flex: 1, height: 1, background: historyBoundaryLineColor }} />
        </div>
      )}

      {blocks.map((block) => {
        const runId = block.displayRunId ?? block.aiEvents.find((e) => e.runId)?.runId;
        const processHistoryState = runId ? processHistoryByRunId?.[runId] : undefined;
        return (
          <TurnBlockComponent
            key={block.rootMessageId}
            block={block}
            onRetry={onRetry}
            onEdit={onEdit}
            onCancel={onCancel}
            retryDisabled={retryDisabledRequestId !== null && retryDisabledRequestId === block.rootMessageId}
            isLoading={isLoading}
            isViewportFollowingBottom={block.isLatest ? isFollowingBottom : false}
            {...(readIsFollowingBottom ? { readIsViewportFollowingBottom: readIsFollowingBottom } : {})}
            {...(onScrollToBottom ? { onRequestScrollToBottom: onScrollToBottom } : {})}
            {...(onRequestAnchorCompensation ? { onRequestAnchorCompensation } : {})}
            {...(onRequestPreserveReadingAnchor ? { onRequestPreserveReadingAnchor } : {})}
            {...(onOpenFullProcess ? { onOpenFullProcess } : {})}
            turnActionsDisabled={block.isLatest ? turnActionsDisabled : false}
            showAnnotations={showAnnotations}
            {...(sessionId ? { sessionId } : {})}
            annotation={annotationsByRunId && runId ? (annotationsByRunId.get(runId) ?? null) : null}
            {...(onAnnotationChange ? { onAnnotationChange } : {})}
            {...(block.isLatest && onSuggestedQuestionClick ? { onSuggestedQuestionClick } : {})}
            {...(onFork ? { onFork } : {})}
            {...(forkingAnchorKey ? { forkingAnchorKey } : {})}
            {...(onShare ? { onShare } : {})}
            {...(shareSelection
              ? {
                  shareSelection,
                  shareSelected: selectedRunIds && runId ? selectedRunIds.has(runId) : false,
                  onToggleShareSelection,
                }
              : {})}
            {...(onGenerateReport ? { onGenerateReport } : {})}
            {...(reportSelection
              ? {
                  reportSelection,
                  reportSelected:
                    selectedReportRequestIds && block.aiEvents.find((e) => e.requestId)?.requestId
                      ? selectedReportRequestIds.has(block.aiEvents.find((e) => e.requestId)!.requestId!)
                      : false,
                  reportSelectionDisabled:
                    (selectedReportRequestIds?.size ?? 0) >= 10 &&
                    !selectedReportRequestIds?.has(block.aiEvents.find((e) => e.requestId)?.requestId ?? ''),
                  onToggleReportSelection,
                }
              : {})}
            {...(processHistoryState ? { processHistoryState } : {})}
            {...(onRetryRunProcessHistory ? { onRetryRunProcessHistory } : {})}
            {...(onProcessPanelExpansionChange ? { onProcessPanelExpansionChange } : {})}
          />
        );
      })}

      {editNoticeVisible && (
        <div
          data-testid="edit-submit-notice"
          style={{
            display: 'flex',
            justifyContent: 'center',
            margin: '4px 0 12px',
          }}
        >
          <div
            style={{
              fontSize: 12,
              color: 'var(--color-text-secondary)',
              background: 'var(--color-bg-hover)',
              border: '1px solid var(--color-border)',
              borderRadius: 999,
              padding: '4px 12px',
              lineHeight: 1.4,
            }}
          >
            {t('messageList.editSubmitNotice')}
          </div>
        </div>
      )}

      {showInlineScrollToBottomButton && !isAtBottom && hasNewMessages && onScrollToBottom && (
        <button
          data-testid="btn-scroll-to-bottom"
          onClick={onScrollToBottom}
          style={{
            position: 'absolute',
            bottom: 20,
            right: 20,
            width: 40,
            height: 40,
            borderRadius: '50%',
            border: 'none',
            background: 'var(--color-bg-primary)',
            boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 16,
            zIndex: 10,
          }}
        >
          <ArrowDownOutlined />
        </button>
      )}
    </div>
  );
}
