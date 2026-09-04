import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, memo } from 'react';
import { RedoOutlined } from '@ant-design/icons';
import { ProcessPanel } from './ProcessPanel.tsx';
import {
  CopyIcon,
  CheckIcon,
  LikeIcon,
  LikeActiveIcon,
  DislikeIcon,
  DislikeActiveIcon,
  FavoriteIcon,
  ComplaintIcon,
  EditIcon,
  ForkIcon,
  FavoriteActiveIcon,
  RetryIcon,
  ShareIcon,
  ReportIcon,
  MoreIcon,
  useIsDarkTheme,
} from './TurnIcons.tsx';
import { AuthGate } from '../../auth/AuthGate.tsx';
import { AICOServiceOperation } from '../../auth/authEnums.ts';
import { Skeleton, Tooltip, message, Dropdown } from 'antd';
import type { MenuProps } from 'antd';
import { useTranslation } from 'react-i18next';
import { runtimeConfig } from '../../../config/runtimeConfig.ts';
import type { TFunction } from 'i18next';
import { ErrorBoundary } from '../../../components/ErrorBoundary.tsx';
import { resolveTurnDetailAffordances } from '../utils/detailAffordances.ts';
import { readFailureReasonPresentation, type FailureReasonPresentation } from '../utils/failureDetails.ts';
import { useUserOps } from '../../auth/useUserOps.ts';
import {
  buildAnswerContent,
  buildAnswerSegments,
  isFinalAnswerHandoffFromPendingProcessContent,
  readLatestAssistantAnswerPresentationOrder,
  readLatestLiveStreamActivitySignature,
  readPersistedPreviewAnswer,
  splitProgressiveMarkdownContent,
} from '../presentation/answerContent.ts';
import { resolveShareableRunId } from '../presentation/shareSelection.ts';
import { AnswerSegments } from './structured/AnswerSegments.tsx';
import { resolveReportableRequestId } from '../presentation/reportSelection.ts';
import { AttachmentFileCard } from '../../shared/components/AttachmentFileCard.tsx';
import { ReportAnswerCard } from './structured/ReportAnswerCard.tsx';
import {
  buildProcessDisplayEntries,
  buildProcessEntries,
  buildProcessSummary,
  buildProcessTimelineEntries,
  resolvePendingSupplementalInputKeys,
  resolveActiveProcessEntryKey,
  resolveExecutionDetailsPhase,
  type ExecutionDetailsPhase,
  type ProcessDisplayEntry,
  type ProcessTimelineEntry,
} from '../process/processDetails.ts';
import { resolveSystemEventPresentation } from '../process/systemEventPresentation.ts';
import { MarkdownContent, STREAMING_TEXT_SWEEP_CSS, __resetMarkdownContentTestState, resolveTextSweepDuration } from './MarkdownContent.tsx';
import { annotationService, FAVORITE_LIMIT } from '../../../services/annotationService.ts';
import { SuggestedQuestions } from '../../suggested-questions/components/SuggestedQuestions.tsx';
import type { RunProcessHistoryState, StreamEnvelope, StreamEventType, TurnBlock, WireTimestamp } from '../../../state/contracts';
import { toTimestampMillis, toWireDate } from '../../../utils/time.ts';
import { useAICOConfig } from '../../../aico-config/useAICOConfig.ts';
import { PiuRenderer } from '../../../aico-config/PiuRenderer.tsx';
import { extractAnswerText } from '../../../aico-config/extractAnswerText.ts';
import { useAppHostContext } from '../../../app/AppProviders.tsx';
import { StreamDSLContext } from '@cloudsop/dsl-engine-web/genui-components';
import { getCurrentLocale } from '../../../i18n/index.ts';
import { supportedLocaleToHostLocale } from '../../../app/hostTypes.ts';
import { usePrefersReducedMotion } from '../hooks/usePrefersReducedMotion.ts';
import { composeTurnBlockProcessHistory, isProcessHistoryEligibleRunStatus } from '../history/processHistory.ts';
import { ComplaintDialog } from '../../complaint/components/ComplaintDialog.tsx';
import { buildComplaintAlogCard } from '../presentation/complaintAnswerText.ts';
import { useComplaintFeatureStore } from '../../../state/complaintFeatureStore.ts';
import { observeCapabilityPresentationEvents } from '../../../state/capabilityPresentationCoordinator.ts';
import { useCapabilityPresentationResources } from '../../../state/useCapabilityPresentationResources.ts';

export interface TurnBlockComponentProps {
  readonly block: TurnBlock;
  readonly onRetry: (rootMessageId: string) => void;
  readonly onEdit: (rootMessageId: string) => void;
  readonly onCancel: (rootMessageId: string) => void;
  readonly isLoading?: boolean;
  readonly isViewportAtBottom?: boolean;
  readonly isViewportFollowingBottom?: boolean;
  readonly readIsViewportFollowingBottom?: () => boolean;
  readonly onRequestScrollToBottom?: () => void;
  readonly onRequestAnchorCompensation?: (deltaY: number) => void;
  readonly onRequestPreserveReadingAnchor?: () => void;
  readonly onOpenFullProcess?: (block: TurnBlock, opener: HTMLButtonElement) => void;
  readonly processHistoryState?: RunProcessHistoryState;
  readonly onRetryRunProcessHistory?: (runId: string) => void;
  readonly onProcessPanelExpansionChange?: (rootMessageId: string, runId: string, expanded: boolean) => void;
  readonly turnActionsDisabled?: boolean;
  readonly retryDisabled?: boolean;
  readonly showAnnotations?: boolean;
  readonly sessionId?: string;
  readonly annotation?: AnnotationState | null;
  readonly onAnnotationChange?: (runId: string, state: AnnotationState | null) => void;
  readonly onSuggestedQuestionClick?: (question: string) => void;
  readonly onFork?: ForkTrigger;
  readonly forkingAnchorKey?: string | null;
  readonly onShare?: ShareTrigger;
  readonly shareSelection?: boolean;
  readonly shareSelected?: boolean;
  readonly onToggleShareSelection?: (runId: string) => void;
  readonly reportSelectionDisabled?: boolean;
  readonly onGenerateReport?: ReportTrigger;
  readonly reportSelection?: boolean;
  readonly reportSelected?: boolean;
  readonly onToggleReportSelection?: (requestId: string) => void;
}

export interface AnnotationState {
  readonly sentiment: 'UP' | 'DOWN' | null;
  readonly isFavorited: boolean;
  readonly isQuestionFavorited: boolean;
}

export type ShareTrigger = (rootMessageId: string, runId?: string) => void;
export type ReportTrigger = (rootMessageId: string, requestId: string) => void;
export type ForkTriggerAnchor = { readonly kind: 'message'; readonly messageId: string } | { readonly kind: 'request'; readonly requestId: string };
export type ForkTrigger = (anchor: ForkTriggerAnchor) => void;

export function forkTriggerAnchorKey(anchor: ForkTriggerAnchor): string {
  return anchor.kind === 'message' ? `message:${anchor.messageId}` : `request:${anchor.requestId}`;
}

type CopyTarget = 'user' | 'assistant';

const COMPACTION_NOTICE_DURATION_MS = 3000;
const ANSWER_IDLE_SWEEP_DELAY_MS = 2500;
const PROCESS_HISTORY_LOADING_DELAY_MS = 300;
const TERMINAL_EVENTS = new Set<StreamEventType>([
  'REQUEST_COMPLETED',
  'REQUEST_FAILED',
  'REQUEST_CANCELED',
  'REQUEST_SUPERSEDED',
  'OUTPUT_GUARD_BLOCKED',
]);

const BI_REPORT_ROOT_PREFIX = 'bi-report:';

async function copyTextToClipboard(content: string): Promise<boolean> {
  if (!content) {
    return false;
  }

  try {
    if (typeof navigator.clipboard?.writeText === 'function') {
      await navigator.clipboard.writeText(content);
      return true;
    }
  } catch {
    // Fall through to the DOM fallback when clipboard permission is denied.
  }

  if (typeof document.execCommand !== 'function' || !document.body) {
    return false;
  }

  const textArea = document.createElement('textarea');
  textArea.value = content;
  textArea.setAttribute('readonly', '');
  textArea.style.position = 'fixed';
  textArea.style.top = '-9999px';
  textArea.style.left = '-9999px';
  textArea.style.opacity = '0';
  document.body.appendChild(textArea);
  textArea.select();

  try {
    return document.execCommand('copy');
  } catch {
    return false;
  } finally {
    document.body.removeChild(textArea);
  }
}

export function __resetTurnBlockTestState(): void {
  __resetMarkdownContentTestState();
}

/**
 * Extract the directive-derived target skill from a user message so a
 * placeholder bubble can be rendered when the effective question was stripped
 * to empty. Synthetic (optimistic) messages carry it directly; persisted
 * SessionConversationMessage messages may carry it under metadata.
 */
function readDirectiveTargetSkill(userMessage: TurnBlock['userMessage']): string | undefined {
  const direct = (userMessage as { targetSkill?: unknown }).targetSkill;
  if (typeof direct === 'string' && direct.length > 0) {
    return direct;
  }
  const metadata = (userMessage as { metadata?: { targetSkill?: unknown; routingConstraints?: { targetSkill?: unknown } } }).metadata;
  const fromMetadata = metadata?.targetSkill ?? metadata?.routingConstraints?.targetSkill;
  return typeof fromMetadata === 'string' && fromMetadata.length > 0 ? fromMetadata : undefined;
}

function useDelayedIdleState(enabled: boolean, activityKey: string, delayMs: number): boolean {
  const [isIdle, setIsIdle] = useState(false);

  useEffect(() => {
    if (!enabled) {
      setIsIdle(false);
      return undefined;
    }

    setIsIdle(false);
    const timer = window.setTimeout(() => {
      setIsIdle(true);
    }, delayMs);
    return () => {
      window.clearTimeout(timer);
    };
  }, [activityKey, delayMs, enabled]);

  return enabled && isIdle;
}

function actionButtonStyle(): React.CSSProperties {
  return {
    border: 'none',
    background: 'transparent',
    cursor: 'pointer',
    color: 'var(--color-text-tertiary)',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 0,
    borderRadius: 0,
    fontSize: 16,
    boxShadow: 'none',
    transition: 'color 160ms ease',
  };
}

function padTimestampPart(value: number): string {
  return String(value).padStart(2, '0');
}

function formatLocalDateTime(date: Date, withSeconds: boolean): string {
  const year = date.getFullYear();
  const month = padTimestampPart(date.getMonth() + 1);
  const day = padTimestampPart(date.getDate());
  const hours = padTimestampPart(date.getHours());
  const minutes = padTimestampPart(date.getMinutes());
  const seconds = padTimestampPart(date.getSeconds());
  return withSeconds ? `${year}-${month}-${day} ${hours}:${minutes}:${seconds}` : `${year}-${month}-${day} ${hours}:${minutes}`;
}

function formatActionTimestamp(createdAt: WireTimestamp | null | undefined): { text: string; tooltip: string } | null {
  const date = toWireDate(createdAt);
  if (!date) {
    return null;
  }
  const hours = padTimestampPart(date.getHours());
  const minutes = padTimestampPart(date.getMinutes());
  const tooltip = formatLocalDateTime(date, true);

  const month = padTimestampPart(date.getMonth() + 1);
  const day = padTimestampPart(date.getDate());
  const seconds = padTimestampPart(date.getSeconds());
  return { text: `${month}-${day} ${hours}:${minutes}:${seconds}`, tooltip };
}

function formatProcessTimelineTimestamp(createdAt: WireTimestamp | null | undefined): { text: string; tooltip: string } | null {
  const date = toWireDate(createdAt);
  if (!date) {
    return null;
  }

  const now = new Date();
  const sameYear = date.getFullYear() === now.getFullYear();
  const sameDay = sameYear && date.getMonth() === now.getMonth() && date.getDate() === now.getDate();

  const hours = padTimestampPart(date.getHours());
  const minutes = padTimestampPart(date.getMinutes());
  const seconds = padTimestampPart(date.getSeconds());
  const tooltip = formatLocalDateTime(date, true);

  if (sameDay) {
    return { text: `${hours}:${minutes}:${seconds}`, tooltip };
  }

  if (sameYear) {
    const month = padTimestampPart(date.getMonth() + 1);
    const day = padTimestampPart(date.getDate());
    return { text: `${month}-${day} ${hours}:${minutes}:${seconds}`, tooltip };
  }

  return { text: tooltip, tooltip };
}

function resolveAssistantActionTimestamp(aiEvents: readonly StreamEnvelope[], isTerminal: boolean): WireTimestamp | null {
  for (let i = aiEvents.length - 1; i >= 0; i--) {
    const evt = aiEvents[i];
    if (evt && TERMINAL_EVENTS.has(evt.eventType)) {
      return evt.createdAt;
    }
  }
  if (!isTerminal) {
    return null;
  }
  return aiEvents[aiEvents.length - 1]?.createdAt ?? null;
}

const BubbleActions = memo(function BubbleActions({
  bubble,
  visible,
  align,
  showRetry,
  retryDisabled = false,
  forkInherited = false,
  copied,
  copyFailed,
  copyDisabled = false,
  editDisabled = false,
  timestamp,
  onCopy,
  onPin,
  onEdit,
  onRetry,
  onFork,
  forkBusy,
  showAnnotations,
  annotationState,
  onLike,
  onDislike,
  onFavorite,
  onShare,
  shareDisabled,
  favoriteDisabled,
  onOpenComplaint,
  questionPinned = false,
  onGenerateReport,
}: {
  readonly bubble: 'user' | 'assistant';
  readonly visible: boolean;
  readonly align: 'left' | 'right';
  readonly showRetry: boolean;
  readonly retryDisabled?: boolean;
  readonly forkInherited?: boolean;
  readonly copied: boolean;
  readonly copyFailed: boolean;
  readonly copyDisabled?: boolean;
  readonly editDisabled?: boolean;
  readonly timestamp?:
    | {
        readonly text: string;
        readonly tooltip: string;
      }
    | null
    | undefined;
  readonly onCopy: () => void;
  readonly onEdit?: () => void;
  readonly onPin?: () => void;
  readonly questionPinned?: boolean;
  readonly onRetry?: () => void;
  readonly onFork?: () => void;
  readonly forkBusy?: boolean;
  readonly showAnnotations?: boolean;
  readonly annotationState?: AnnotationState | null;
  readonly onLike?: () => void;
  readonly onDislike?: () => void;
  readonly onFavorite?: () => void;
  readonly onShare?: () => void;
  readonly shareDisabled?: boolean;
  readonly favoriteDisabled?: boolean;
  readonly onOpenComplaint?: () => void;
  readonly onGenerateReport?: () => void;
}) {
  const { t } = useTranslation();
  const isDark = useIsDarkTheme();
  const ops = useUserOps();
  const complaintEnabled = useComplaintFeatureStore((s) => s.enabled);
  if (!visible || (!showRetry && !showAnnotations && !onFork && !onShare && !onPin && !onGenerateReport)) {
    return null;
  }

  const copyLabel = copyDisabled ? t('turn.copyDisabled') : copyFailed ? t('turn.copyFailed') : copied ? t('turn.copied') : t('turn.copy');
  const editLabel = t('turn.edit');
  const retryLabel = t('turn.retry');
  const retryLimitLabel = t('turn.retryLimitReached');
  const retryBlocked = retryDisabled || forkInherited;
  const retryHint = forkInherited ? t('turn.retryForkInherited') : retryDisabled ? retryLimitLabel : retryLabel;
  const editHint = forkInherited ? t('turn.editForkInherited') : editLabel;
  const forkLabel = forkBusy ? t('turn.forking') : t('turn.fork');
  const hasWritePermission = ops === null || ops.includes(AICOServiceOperation.Write);
  const editUnavailable = editDisabled || forkInherited || !onEdit || !hasWritePermission;
  const isAssistant = bubble === 'assistant';
  const annotationVisible = Boolean(showAnnotations && annotationState);
  // Assistant actions: copy/like/dislike/favorite are primary; complaint/fork/share/report live in more actions.
  // User bubbles keep copy/pin/edit inline and do not use the more menu.
  const visibleOrder: string[] = [];
  if (isAssistant) {
    visibleOrder.push('copy');
    if (annotationVisible) {
      visibleOrder.push('like');
      visibleOrder.push('dislike');
    }
    if (annotationVisible) {
      visibleOrder.push('favorite');
    }
    if (onOpenComplaint && complaintEnabled) {
      visibleOrder.push('complaint');
    }
    if (onFork) {
      visibleOrder.push('fork');
    }
    if (onShare) {
      visibleOrder.push('share');
    }
    if (onGenerateReport) {
      visibleOrder.push('report');
    }
  }
  const primaryActionKeys = new Set(['copy', 'like', 'dislike', 'favorite']);
  const primarySet = new Set(visibleOrder.filter((key) => primaryActionKeys.has(key)));
  const moreMenuKeys = visibleOrder.filter((key) => !primaryActionKeys.has(key) && !(key === 'share' && shareDisabled));
  const moreActionsDisabled = moreMenuKeys.length === 0;
  const timestampNode = timestamp ? (
    <Tooltip rootClassName="app-common-tooltip" title={timestamp.tooltip}>
      <span
        data-testid={`${bubble}-action-timestamp`}
        style={{
          fontSize: 14,
          color: isDark ? 'rgba(201, 201, 201, 1)' : 'rgba(119, 119, 119, 1)',
          fontFamily: '"HarmonyOS Sans SC"',
          fontWeight: 400,
          lineHeight: '20px',
          letterSpacing: '0px',
          whiteSpace: 'nowrap',
          ...(isAssistant ? { marginRight: 'auto' } : {}),
        }}
      >
        {timestamp.text}
      </span>
    </Tooltip>
  ) : null;

  return (
    <div
      data-testid={`${bubble}-action-row`}
      style={{
        position: bubble === 'assistant' ? 'relative' : 'absolute',
        top: bubble === 'assistant' ? undefined : 'calc(100% - 14px)',
        left: bubble === 'assistant' ? undefined : align === 'left' ? 0 : 'auto',
        right: bubble === 'assistant' ? undefined : align === 'right' ? 0 : 'auto',
        display: 'flex',
        gap: 16,
        alignItems: 'center',
        justifyContent: bubble === 'assistant' ? 'flex-end' : undefined,
        marginTop: bubble === 'assistant' ? 16 : undefined,
        zIndex: 2,
      }}
    >
      {align === 'right' ? timestampNode : null}
      {align === 'left' ? timestampNode : null}
      {isAssistant && showRetry && onRetry ? (
        <AuthGate requiredOps={[AICOServiceOperation.Write]}>
          <Tooltip rootClassName="app-common-tooltip" title={retryHint}>
            <button
              type="button"
              data-testid="btn-retry-ai"
              aria-label={retryHint}
              aria-disabled={retryBlocked}
              onClick={retryBlocked ? undefined : onRetry}
              style={{
                ...actionButtonStyle(),
                cursor: retryBlocked ? 'not-allowed' : 'pointer',
                opacity: retryBlocked ? 0.45 : 1,
              }}
            >
              <RetryIcon isDark={isDark} />
            </button>
          </Tooltip>
        </AuthGate>
      ) : null}
      <Tooltip rootClassName="app-common-tooltip" title={copyLabel}>
        <button
          type="button"
          data-testid={`btn-copy-${bubble}`}
          aria-label={copyLabel}
          disabled={copyDisabled}
          onClick={copyDisabled ? undefined : onCopy}
          style={{
            ...actionButtonStyle(),
            cursor: copyDisabled ? 'not-allowed' : 'pointer',
            opacity: copyDisabled ? 0.45 : 1,
          }}
        >
          {copied ? <CheckIcon isDark={isDark} /> : <CopyIcon isDark={isDark} />}
        </button>
      </Tooltip>
      {primarySet.has('like') && annotationVisible ? (
        <AuthGate requiredOps={[AICOServiceOperation.Write]}>
          <Tooltip rootClassName="app-common-tooltip" title={t('turn.like')}>
            <button type="button" data-testid="annotation-like" aria-label={t('turn.like')} onClick={onLike} style={actionButtonStyle()}>
              {annotationState!.sentiment === 'UP' ? <LikeActiveIcon isDark={isDark} /> : <LikeIcon isDark={isDark} />}
            </button>
          </Tooltip>
        </AuthGate>
      ) : null}
      {primarySet.has('dislike') && annotationVisible ? (
        <AuthGate requiredOps={[AICOServiceOperation.Write]}>
          <Tooltip rootClassName="app-common-tooltip" title={t('turn.dislike')}>
            <button type="button" data-testid="annotation-dislike" aria-label={t('turn.dislike')} onClick={onDislike} style={actionButtonStyle()}>
              {annotationState!.sentiment === 'DOWN' ? <DislikeActiveIcon isDark={isDark} /> : <DislikeIcon isDark={isDark} />}
            </button>
          </Tooltip>
        </AuthGate>
      ) : null}
      {primarySet.has('favorite') && annotationVisible ? (
        <AuthGate requiredOps={[AICOServiceOperation.Write]}>
          <Tooltip rootClassName="app-common-tooltip" title={favoriteDisabled ? t('turn.favoriteDisabled') : t('turn.favorite')}>
            <button
              type="button"
              data-testid="annotation-favorite"
              aria-label={t('turn.favorite')}
              disabled={favoriteDisabled}
              onClick={favoriteDisabled ? undefined : onFavorite}
              style={{
                ...actionButtonStyle(),
                cursor: favoriteDisabled ? 'not-allowed' : 'pointer',
                opacity: favoriteDisabled ? 0.45 : 1,
              }}
            >
              {annotationState!.isFavorited ? <FavoriteActiveIcon isDark={isDark} /> : <FavoriteIcon isDark={isDark} />}
            </button>
          </Tooltip>
        </AuthGate>
      ) : null}
      {!isAssistant && onPin ? (
        <AuthGate requiredOps={[AICOServiceOperation.Write]}>
          <Tooltip rootClassName="app-common-tooltip" title={questionPinned ? t('turn.unpinQuestion') : t('turn.pinQuestion')}>
            <button
              type="button"
              data-testid="btn-pin-user"
              aria-label={questionPinned ? t('turn.unpinQuestion') : t('turn.pinQuestion')}
              onClick={onPin}
              style={actionButtonStyle()}
            >
              {questionPinned ? <FavoriteActiveIcon isDark={isDark} /> : <FavoriteIcon isDark={isDark} />}
            </button>
          </Tooltip>
        </AuthGate>
      ) : null}
      {bubble === 'user' ? (
        <Tooltip rootClassName="app-common-tooltip" title={editHint}>
          <button
            type="button"
            data-testid="btn-edit-user"
            aria-label={editHint}
            disabled={editUnavailable}
            onClick={editUnavailable ? undefined : onEdit}
            style={{
              ...actionButtonStyle(),
              cursor: editUnavailable ? 'not-allowed' : 'pointer',
              opacity: editUnavailable ? 0.45 : 1,
            }}
          >
            <EditIcon isDark={isDark} />
          </button>
        </Tooltip>
      ) : null}
      {bubble === 'assistant' ? (
        <Dropdown
          trigger={['click']}
          disabled={moreActionsDisabled}
          menu={{
            items: moreMenuKeys.map((key): NonNullable<MenuProps['items']>[number] => {
              switch (key) {
                case 'complaint':
                  return {
                    key,
                    'data-testid': 'btn-complaint-feedback',
                    icon: <ComplaintIcon isDark={isDark} style={{ marginInlineEnd: 8 }} />,
                    label: t('complaint.feedback'),
                    onClick: () => onOpenComplaint?.(),
                  };
                case 'fork':
                  return {
                    key,
                    'data-testid': 'btn-fork-ai',
                    icon: <ForkIcon isDark={isDark} style={{ marginInlineEnd: 8 }} />,
                    label: forkLabel,
                    disabled: forkBusy || !hasWritePermission,
                    onClick: () => onFork?.(),
                  };
                case 'share':
                  return {
                    key,
                    'data-testid': 'btn-share',
                    icon: <ShareIcon isDark={isDark} style={{ marginInlineEnd: 8 }} />,
                    label: shareDisabled ? t('share.shareDisabled') : t('share.share'),
                    disabled: shareDisabled || !hasWritePermission,
                    onClick: () => onShare?.(),
                  };
                case 'report':
                  return {
                    key,
                    'data-testid': 'btn-generate-report',
                    icon: <ReportIcon isDark={isDark} style={{ marginInlineEnd: 8 }} />,
                    label: t('report.generate'),
                    onClick: () => onGenerateReport?.(),
                  };
                default:
                  return { key, label: key };
              }
            }),
          }}
        >
          <Tooltip rootClassName="app-common-tooltip" title={moreActionsDisabled ? t('turn.moreActionsDisabled') : t('turn.moreActions')}>
            <button
              type="button"
              data-testid="btn-more-actions"
              aria-label={t('turn.moreActions')}
              disabled={moreActionsDisabled}
              style={{
                ...actionButtonStyle(),
                cursor: moreActionsDisabled ? 'not-allowed' : 'pointer',
                opacity: moreActionsDisabled ? 0.45 : 1,
              }}
            >
              <MoreIcon isDark={isDark} />
            </button>
          </Tooltip>
        </Dropdown>
      ) : null}
    </div>
  );
});

const PlainTextLiveContent = memo(
  function PlainTextLiveContent({
    content,
    isStreamingAnswer = false,
    sweepDuration,
  }: {
    readonly content: string;
    readonly isStreamingAnswer?: boolean;
    readonly sweepDuration?: ReturnType<typeof resolveTextSweepDuration>;
  }) {
    return (
      <div
        className={`markdown-content${isStreamingAnswer ? ' markdown-content--streaming-answer' : ''}`}
        data-testid="assistant-live-plain-tail"
        style={
          {
            fontSize: 16,
            lineHeight: 1.5,
            width: '100%',
            maxWidth: '100%',
            minWidth: 0,
            boxSizing: 'border-box',
            overflowWrap: 'anywhere',
            wordBreak: 'break-word',
            color: 'var(--color-text-primary)',
            whiteSpace: 'pre-wrap',
            ...(isStreamingAnswer && sweepDuration ? { '--nextagent-text-sweep-duration': sweepDuration } : {}),
          } as React.CSSProperties
        }
      >
        {isStreamingAnswer ? <style>{STREAMING_TEXT_SWEEP_CSS}</style> : null}
        <p style={{ margin: 0 }}>{content}</p>
      </div>
    );
  },
  (prev, next) => prev.content === next.content && prev.isStreamingAnswer === next.isStreamingAnswer && prev.sweepDuration === next.sweepDuration,
);

function buildTransientCompactionNotice(aiEvents: readonly StreamEnvelope[], t: TFunction): { eventId: string; text: string } | null {
  let latestCompactionEvent: StreamEnvelope | null = null;
  for (const event of aiEvents) {
    if (event.eventType !== 'CONTEXT_COMPACTED') {
      continue;
    }
    if (!latestCompactionEvent || event.sequence >= latestCompactionEvent.sequence) {
      latestCompactionEvent = event;
    }
  }

  if (!latestCompactionEvent) {
    return null;
  }

  return {
    eventId: latestCompactionEvent.eventId,
    text: resolveSystemEventPresentation('CONTEXT_COMPACTED', latestCompactionEvent.payload as Record<string, unknown>, t).summary,
  };
}

function ProcessTimelineContent({ entry }: { readonly entry: ProcessTimelineEntry }) {
  const content = entry.content?.trim() ?? '';
  if (!content) {
    return null;
  }

  if (entry.kind === 'tool' && entry.sourceEventType === 'CAPABILITY_RESULT_DELTA') {
    return (
      <div
        style={{
          marginTop: entry.statusLabel ? 8 : 4,
          fontSize: 13,
          lineHeight: 1.6,
          color: 'var(--color-text-secondary)',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
        }}
      >
        {content}
      </div>
    );
  }

  if (entry.contentType === 'MARKDOWN') {
    return (
      <div style={{ marginTop: entry.statusLabel ? 8 : 4 }}>
        <MarkdownContent content={content} />
      </div>
    );
  }

  return (
    <div
      style={{
        marginTop: entry.statusLabel ? 8 : 4,
        fontSize: 13,
        lineHeight: 1.6,
        color: 'var(--color-text-secondary)',
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
      }}
    >
      {content}
    </div>
  );
}

function CanceledNotice({ hasAnswerContent }: { readonly hasAnswerContent: boolean }) {
  const { t } = useTranslation();

  return (
    <div
      data-testid="turn-canceled-notice"
      data-canceled-partial={hasAnswerContent ? 'true' : 'false'}
      style={{
        marginBottom: 10,
        color: 'var(--color-text-tertiary)',
        fontSize: 12,
        lineHeight: 1.5,
      }}
    >
      {hasAnswerContent ? t('turn.canceledWithPartialContent') : t('turn.canceledWithoutAnswer')}
    </div>
  );
}

function GuardBlockedNotice() {
  const { t } = useTranslation();
  return (
    <div
      data-testid="turn-guard-blocked-notice"
      style={{
        marginBottom: 10,
        color: 'var(--color-text-tertiary)',
        fontSize: 12,
        lineHeight: 1.5,
      }}
    >
      {t('turn.guardBlocked')}
    </div>
  );
}

function FailedNotice({ hasAnswerContent, presentation }: { readonly hasAnswerContent: boolean; readonly presentation: FailureReasonPresentation }) {
  const { t } = useTranslation();

  return (
    <div
      data-testid="turn-failed-notice"
      data-failed-partial={hasAnswerContent ? 'true' : 'false'}
      style={{
        marginBottom: 10,
        color: 'var(--color-text-tertiary)',
        fontSize: 12,
        lineHeight: 1.5,
      }}
    >
      <div>{hasAnswerContent ? t('turn.failedWithPartialContent') : t('turn.failedWithoutAnswer')}</div>
      <div style={{ marginTop: 2 }}>
        <span>{t('turn.failureReasonPrefix')}</span>
        <span style={{ marginLeft: 4 }}>{t(presentation.translationKey, { skill: presentation.skillName ?? '' })}</span>
      </div>
      <div>{t('turn.failureStage', { stage: presentation.stage })}</div>
      <div>{t(presentation.retryRecommended ? 'turn.failureRetryRecommended' : 'turn.failureRetryNotRecommended')}</div>
      <div>{t(presentation.remediationTranslationKey)}</div>
    </div>
  );
}

const ActionButtons = memo(function ActionButtons({
  isLatest,
  isTerminal,
  isFlushing,
  onCopy,
  onRetry,
  copied,
}: {
  readonly isLatest: boolean;
  readonly isTerminal: boolean;
  readonly isFlushing: boolean;
  readonly onCopy: () => void;
  readonly onRetry: () => void;
  readonly copied: boolean;
}) {
  const { t } = useTranslation();
  const isDark = useIsDarkTheme();
  const showActions = isLatest && isTerminal && !isFlushing;

  return (
    <div style={{ marginTop: 8, display: 'flex', gap: 8 }}>
      <button
        data-testid="btn-copy"
        onClick={onCopy}
        style={{ border: 'none', background: 'transparent', cursor: 'pointer', fontSize: 12, color: 'var(--color-text-secondary)' }}
      >
        {copied ? <CheckIcon isDark={isDark} /> : <CopyIcon isDark={isDark} />} {t('turn.copy')}
      </button>
      {showActions && (
        <button
          data-testid="btn-retry"
          onClick={onRetry}
          style={{ border: 'none', background: 'transparent', cursor: 'pointer', fontSize: 12, color: 'var(--color-text-secondary)' }}
        >
          <RedoOutlined /> {t('turn.retry')}
        </button>
      )}
    </div>
  );
});

function TurnBlockContent({
  block,
  onRetry,
  onEdit,
  isLoading = false,
  isViewportFollowingBottom = true,
  readIsViewportFollowingBottom,
  onRequestScrollToBottom,
  onRequestAnchorCompensation,
  onRequestPreserveReadingAnchor,
  onOpenFullProcess,
  processHistoryState,
  onRetryRunProcessHistory,
  onProcessPanelExpansionChange,
  turnActionsDisabled = false,
  retryDisabled = false,
  showAnnotations = true,
  sessionId,
  annotation,
  onAnnotationChange,
  onSuggestedQuestionClick,
  onFork,
  forkingAnchorKey,
  onShare,
  shareSelection = false,
  shareSelected = false,
  onToggleShareSelection,
  reportSelectionDisabled = false,
  onGenerateReport,
  reportSelection = false,
  reportSelected = false,
  onToggleReportSelection,
}: TurnBlockComponentProps) {
  const { t } = useTranslation();
  const { userMessage, aiEvents: baseAiEvents, status, isLatest, rootMessageId } = block;
  const processSessionId = sessionId ?? baseAiEvents[0]?.sessionId;
  const processBlock = useMemo(
    () => composeTurnBlockProcessHistory(block, processHistoryState, processSessionId),
    [block, processHistoryState, processSessionId],
  );
  const aiEvents = processBlock.aiEvents;
  const aicoConfig = useAICOConfig();
  const { hostTheme, mode: hostMode } = useAppHostContext();
  const currentLocale = getCurrentLocale();
  const dslLocale = supportedLocaleToHostLocale(currentLocale);
  const capabilityPresentation = useCapabilityPresentationResources(processSessionId);
  useEffect(() => {
    if (processSessionId) {
      observeCapabilityPresentationEvents(processSessionId, aiEvents);
    }
  }, [aiEvents, processSessionId]);
  const answerOperator = aicoConfig?.answerOperator;
  const [copiedTarget, setCopiedTarget] = useState<CopyTarget | null>(null);
  const [copyFailedTarget, setCopyFailedTarget] = useState<CopyTarget | null>(null);
  const [isUserRegionHovered, setIsUserRegionHovered] = useState(false);
  const [isAssistantRegionHovered, setIsAssistantRegionHovered] = useState(false);
  const isTerminal = ['COMPLETED', 'FAILED', 'CANCELED', 'SUPERSEDED'].includes(status);
  const runId = block.displayRunId ?? aiEvents.find((e) => e.runId)?.runId ?? undefined;
  const copyResetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const attachmentListRef = useRef<HTMLDivElement | null>(null);
  const handleAttachmentWheel = useCallback((e: React.WheelEvent) => {
    const el = attachmentListRef.current;
    if (el === null) {
      return;
    }
    if (e.deltaY !== 0) {
      e.preventDefault();
      el.scrollLeft += e.deltaY;
    }
  }, []);
  const showLatestTurnActions = isLatest && !turnActionsDisabled;
  const forkInherited = block.forkInherited === true;
  const userActionTimestamp = useMemo(() => formatActionTimestamp(userMessage.createdAt), [userMessage.createdAt]);
  const assistantActionTimestamp = useMemo(
    () => formatActionTimestamp(resolveAssistantActionTimestamp(aiEvents, isTerminal)),
    [aiEvents, isTerminal],
  );

  const prefersReducedMotion = usePrefersReducedMotion();
  const rawAnswerContent = useMemo(() => buildAnswerContent(aiEvents), [aiEvents]);
  const persistedPreviewAnswer = useMemo(() => readPersistedPreviewAnswer(rawAnswerContent), [rawAnswerContent]);
  const answerContent = useMemo(() => {
    if (persistedPreviewAnswer === null) {
      return rawAnswerContent;
    }
    const originalSize = new Intl.NumberFormat(getCurrentLocale()).format(persistedPreviewAnswer.originalSize);
    return [t('turn.persistedPreviewIntro', { formattedCount: originalSize }), persistedPreviewAnswer.preview, t('turn.persistedPreviewSaved')].join(
      '\n\n',
    );
  }, [persistedPreviewAnswer, rawAnswerContent, t]);
  const isAnswerHandoffFromPendingProcessContent = useMemo(
    () => isFinalAnswerHandoffFromPendingProcessContent(aiEvents, rawAnswerContent),
    [aiEvents, rawAnswerContent],
  );
  const latestAssistantAnswerPresentationOrder = useMemo(() => readLatestAssistantAnswerPresentationOrder(aiEvents), [aiEvents]);
  const pendingSupplementalInputEntryKeys = useMemo(() => new Set(resolvePendingSupplementalInputKeys(aiEvents)), [aiEvents]);
  const hasStructuredAnswer = useMemo(
    () =>
      aiEvents.some((event) => event.eventType === 'TOOL_STRUCTURED_DELTA' && (event.payload as Record<string, unknown>).toolEventType === 'ANSWER'),
    [aiEvents],
  );
  const hasAnswerContent = answerContent.trim().length > 0 || hasStructuredAnswer;
  const isShareable = resolveShareableRunId(block) !== undefined;
  const reportableRequestId = resolveReportableRequestId(block);
  const rawRequestId = aiEvents.find((e) => e.requestId)?.requestId;
  const isBiReportTurn = rootMessageId.startsWith(BI_REPORT_ROOT_PREFIX);
  const anySelectionMode = shareSelection || reportSelection;
  const biReportContent = useMemo(() => {
    if (!isBiReportTurn) {
      return undefined;
    }
    const dslEvent = aiEvents.find(
      (e) => e.eventType === 'TOOL_STRUCTURED_DELTA' && (e.payload as Record<string, unknown>).toolEventType === 'ANSWER',
    );
    return (dslEvent?.payload as Record<string, unknown> | undefined)?.content;
  }, [aiEvents, isBiReportTurn]);
  const isGuardBlocked = useMemo(() => aiEvents.some((event) => event.eventType === 'OUTPUT_GUARD_BLOCKED'), [aiEvents]);
  const answerSegments = useMemo(() => {
    const segments = hasStructuredAnswer ? buildAnswerSegments(aiEvents) : [];
    if (persistedPreviewAnswer === null) {
      return segments;
    }
    return segments.map((segment) =>
      segment.kind === 'text' && segment.content === rawAnswerContent ? { ...segment, content: answerContent } : segment,
    );
  }, [aiEvents, answerContent, hasStructuredAnswer, persistedPreviewAnswer, rawAnswerContent]);
  const answerText = useMemo(() => extractAnswerText(answerSegments), [answerSegments]);
  const complaintAlogCard = useMemo(
    () => buildComplaintAlogCard(userMessage.content, answerSegments, answerContent),
    [userMessage.content, answerSegments, answerContent],
  );
  const [complaintOpen, setComplaintOpen] = useState(false);
  const assistantAnchorMessageId = block.assistantAnchorMessageId;
  const isLiveStreamed = useMemo(() => aiEvents.some((event) => !event.transportHints.includes('history-load')), [aiEvents]);
  const forkAnchor: ForkTriggerAnchor | undefined = assistantAnchorMessageId
    ? { kind: 'message', messageId: assistantAnchorMessageId }
    : isLiveStreamed && status === 'COMPLETED' && rootMessageId
      ? { kind: 'request', requestId: rootMessageId }
      : undefined;
  const canForkAssistant = Boolean(onFork && sessionId && forkAnchor && hasAnswerContent);
  const canForkAssistantVisible = canForkAssistant && !anySelectionMode;
  const isForkingAssistant = Boolean(forkAnchor && forkingAnchorKey === forkTriggerAnchorKey(forkAnchor));
  const canShowAnnotations = showAnnotations && Boolean(sessionId && runId && isTerminal);
  const [optimisticAnnotation, setOptimisticAnnotation] = useState<AnnotationState | null | undefined>(undefined);
  const currentAnnotation = optimisticAnnotation ?? annotation ?? null;

  const callAnnotationApi = useCallback(
    async (next: AnnotationState, successMessage?: string): Promise<boolean> => {
      if (!sessionId || !runId) {
        return false;
      }
      const previous = currentAnnotation;
      setOptimisticAnnotation(next);
      try {
        const result = await annotationService.upsertAnnotation({
          sessionId,
          runId,
          sentiment: next.sentiment,
          isFavorited: next.isFavorited,
          isQuestionFavorited: next.isQuestionFavorited,
        });
        if (result && 'annotationId' in result) {
          const newState: AnnotationState = {
            sentiment: result.sentiment,
            isFavorited: result.isFavorited,
            isQuestionFavorited: result.isQuestionFavorited,
          };
          setOptimisticAnnotation(newState);
          onAnnotationChange?.(runId, newState);
        } else {
          setOptimisticAnnotation({ sentiment: null, isFavorited: false, isQuestionFavorited: false });
          onAnnotationChange?.(runId, null);
        }
        if (successMessage !== undefined) {
          message.success(successMessage);
        }
        return true;
      } catch (error) {
        setOptimisticAnnotation(previous);
        onAnnotationChange?.(runId, previous ?? null);
        const isFavoriteLimit =
          typeof error === 'object' && error !== null && 'code' in error && (error as { code?: string | null }).code === 'FAVORITE_LIMIT_EXCEEDED';
        message.error(t(isFavoriteLimit ? 'turn.favoriteLimitError' : 'turn.annotationError'));
        return false;
      }
    },
    [sessionId, runId, currentAnnotation, onAnnotationChange, t],
  );

  const handleLike = useCallback(() => {
    const base = currentAnnotation ?? { sentiment: null, isFavorited: false, isQuestionFavorited: false };
    void callAnnotationApi(
      {
        sentiment: base.sentiment === 'UP' ? null : 'UP',
        isFavorited: base.isFavorited,
        isQuestionFavorited: base.isQuestionFavorited,
      },
      t(base.sentiment === 'UP' ? 'turn.likeRemoved' : 'turn.likeSuccess'),
    );
  }, [currentAnnotation, callAnnotationApi, t]);

  const handleDislike = useCallback(() => {
    const base = currentAnnotation ?? { sentiment: null, isFavorited: false, isQuestionFavorited: false };
    void callAnnotationApi(
      {
        sentiment: base.sentiment === 'DOWN' ? null : 'DOWN',
        isFavorited: base.isFavorited,
        isQuestionFavorited: base.isQuestionFavorited,
      },
      t(base.sentiment === 'DOWN' ? 'turn.dislikeRemoved' : 'turn.dislikeSuccess'),
    );
  }, [currentAnnotation, callAnnotationApi, t]);

  const isRemoteMode = hostMode === 'immersive' || hostMode === 'piu';
  const handleFavorite = useCallback(async () => {
    const base = currentAnnotation ?? { sentiment: null, isFavorited: false, isQuestionFavorited: false };
    const willFavorite = !base.isFavorited;
    if (willFavorite && isRemoteMode) {
      try {
        const page = await annotationService.listFavoriteTurns(0, FAVORITE_LIMIT);
        if (page.entries.length >= FAVORITE_LIMIT) {
          message.error(t('turn.favoriteLimitError'));
          return;
        }
      } catch {
        // If the pre-check request fails, proceed to the normal upsert path.
      }
    }
    void callAnnotationApi(
      { sentiment: base.sentiment, isFavorited: willFavorite, isQuestionFavorited: base.isQuestionFavorited },
      t(base.isFavorited ? 'turn.favoriteRemoved' : 'turn.favoriteSuccess'),
    );
  }, [currentAnnotation, callAnnotationApi, isRemoteMode, t]);

  const directiveTargetSkill = readDirectiveTargetSkill(userMessage);
  const failureReason = useMemo(() => {
    const presentation = readFailureReasonPresentation(aiEvents);
    if (presentation.skillName === undefined && directiveTargetSkill !== undefined) {
      return { ...presentation, skillName: directiveTargetSkill };
    }
    return presentation;
  }, [aiEvents, directiveTargetSkill]);
  const transientCompactionNotice = useMemo(
    () => (hasAnswerContent && isLiveStreamed ? buildTransientCompactionNotice(aiEvents, t) : null),
    [aiEvents, hasAnswerContent, isLiveStreamed, t],
  );
  const rawProcessEntries = useMemo(
    () => buildProcessEntries(aiEvents, t, capabilityPresentation.resources, currentLocale),
    [aiEvents, capabilityPresentation.resources, currentLocale, t],
  );
  const processTimelineEntries = useMemo(
    () => buildProcessTimelineEntries(aiEvents, t, capabilityPresentation.resources, currentLocale),
    [aiEvents, capabilityPresentation.resources, currentLocale, t],
  );
  const executionDetailsPhase = useMemo(() => resolveExecutionDetailsPhase(status, rawProcessEntries), [rawProcessEntries, status]);
  const processEntries = useMemo(
    () =>
      rawProcessEntries.filter((entry) => {
        return entry.kind !== 'thinking' || executionDetailsPhase !== 'settled' || entry.detail.trim().length > 0;
      }),
    [executionDetailsPhase, rawProcessEntries],
  );
  const processDisplayEntries = useMemo(() => buildProcessDisplayEntries(processEntries, t), [processEntries, t]);
  const latestSupersedingOutputPresentationOrder = useMemo(
    () =>
      processDisplayEntries.reduce<number | null>((latestOrder, entry) => {
        if (entry.kind !== 'process-explanation' || entry.lastPresentationOrder === undefined) {
          return latestOrder;
        }
        return latestOrder === null ? entry.lastPresentationOrder : Math.max(latestOrder, entry.lastPresentationOrder);
      }, latestAssistantAnswerPresentationOrder),
    [latestAssistantAnswerPresentationOrder, processDisplayEntries],
  );
  const activeProcessEntryKey = useMemo(() => resolveActiveProcessEntryKey(processDisplayEntries), [processDisplayEntries]);
  const detailAffordances = useMemo(
    () =>
      resolveTurnDetailAffordances({
        aiEvents,
        processEntryCount: rawProcessEntries.length,
        processTimelineEntryCount: processTimelineEntries.length,
        isStreaming: executionDetailsPhase !== 'settled',
      }),
    [aiEvents, executionDetailsPhase, processTimelineEntries.length, rawProcessEntries.length],
  );
  const processSummary = useMemo(() => buildProcessSummary(status, executionDetailsPhase, t), [executionDetailsPhase, status, t]);
  const isStreaming = executionDetailsPhase !== 'settled';
  const progressiveAnswerParts = useMemo(
    () => splitProgressiveMarkdownContent(answerContent, isStreaming && !isTerminal),
    [answerContent, isStreaming, isTerminal],
  );
  const hasUserContent = userMessage.content.trim().length > 0;
  const liveStreamActivitySignature = useMemo(() => readLatestLiveStreamActivitySignature(aiEvents), [aiEvents]);
  const shouldMonitorLiveStreamIdle = isLatest && isStreaming && !isTerminal && !prefersReducedMotion;
  const isLiveStreamIdle = useDelayedIdleState(shouldMonitorLiveStreamIdle, liveStreamActivitySignature, ANSWER_IDLE_SWEEP_DELAY_MS);
  const activeProcessActivitySignature = activeProcessEntryKey
    ? `${activeProcessEntryKey}:${processDisplayEntries.find((entry) => entry.key === activeProcessEntryKey)?.lastSequence ?? 'unknown'}`
    : 'no-active-process';
  const isProcessStreamIdle = useDelayedIdleState(
    shouldMonitorLiveStreamIdle && activeProcessEntryKey !== null,
    activeProcessActivitySignature,
    ANSWER_IDLE_SWEEP_DELAY_MS,
  );
  const shouldShowStreamingTextEffect = hasAnswerContent && isLiveStreamIdle;
  const showDelayedProcessHistoryLoading = useDelayedIdleState(
    processHistoryState?.status === 'LOADING',
    `${block.displayRunId ?? 'no-run'}:${processHistoryState?.status === 'LOADING' ? (processHistoryState.startedAt ?? 0) : 0}`,
    PROCESS_HISTORY_LOADING_DELAY_MS,
  );
  const showProcessHistoryState = processHistoryState?.status === 'LOADING' || processHistoryState?.status === 'LEGACY_UNAVAILABLE';
  const showProcessSummary = detailAffordances.showExecutionSummary || showProcessHistoryState || processEntries.length > 0;
  const showProcessTimelineAction = detailAffordances.showFullProcessTimeline;
  const effectiveShowProcessTimelineAction =
    showProcessTimelineAction && aicoConfig?.showThinkingChain !== false && runtimeConfig.portalAbilityConfig.fullProcessEnabled;
  const handleProcessPanelExpansionChange = useCallback(
    (expanded: boolean) => {
      if (block.displayRunId && isProcessHistoryEligibleRunStatus(block.status)) {
        onProcessPanelExpansionChange?.(rootMessageId, block.displayRunId, expanded);
      }
    },
    [block.displayRunId, block.status, onProcessPanelExpansionChange, rootMessageId],
  );

  const [processPanelHeight, setProcessPanelHeight] = useState(0);
  const compactionNoticeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const assistantContentRegionRef = useRef<HTMLDivElement | null>(null);
  const requestScrollToBottomRef = useRef(onRequestScrollToBottom);
  const requestPreserveReadingAnchorRef = useRef(onRequestPreserveReadingAnchor);
  const [visibleCompactionNoticeEventId, setVisibleCompactionNoticeEventId] = useState<string | null>(null);
  const transientCompactionNoticeEventId = transientCompactionNotice?.eventId ?? null;
  const shouldShowTransientCompactionNotice =
    transientCompactionNotice !== null && visibleCompactionNoticeEventId === transientCompactionNoticeEventId;

  const readViewportFollowingBottom = useCallback(
    () => readIsViewportFollowingBottom?.() ?? isViewportFollowingBottom,
    [isViewportFollowingBottom, readIsViewportFollowingBottom],
  );

  useEffect(() => {
    requestScrollToBottomRef.current = onRequestScrollToBottom;
  }, [onRequestScrollToBottom]);

  useEffect(() => {
    requestPreserveReadingAnchorRef.current = onRequestPreserveReadingAnchor;
  }, [onRequestPreserveReadingAnchor]);

  useEffect(() => {
    if (compactionNoticeTimerRef.current !== null) {
      clearTimeout(compactionNoticeTimerRef.current);
      compactionNoticeTimerRef.current = null;
    }

    if (transientCompactionNoticeEventId === null) {
      setVisibleCompactionNoticeEventId(null);
      return undefined;
    }

    setVisibleCompactionNoticeEventId(transientCompactionNoticeEventId);
    compactionNoticeTimerRef.current = setTimeout(() => {
      setVisibleCompactionNoticeEventId((currentEventId) => (currentEventId === transientCompactionNoticeEventId ? null : currentEventId));
      compactionNoticeTimerRef.current = null;
    }, COMPACTION_NOTICE_DURATION_MS);

    return () => {
      if (compactionNoticeTimerRef.current !== null) {
        clearTimeout(compactionNoticeTimerRef.current);
        compactionNoticeTimerRef.current = null;
      }
    };
  }, [transientCompactionNoticeEventId]);

  useEffect(() => {
    return () => {
      if (copyResetTimerRef.current !== null) {
        clearTimeout(copyResetTimerRef.current);
      }
      if (compactionNoticeTimerRef.current !== null) {
        clearTimeout(compactionNoticeTimerRef.current);
      }
    };
  }, []);

  const scheduleCopyReset = useCallback((target: CopyTarget) => {
    if (copyResetTimerRef.current !== null) {
      clearTimeout(copyResetTimerRef.current);
    }
    setCopyFailedTarget(null);
    setCopiedTarget(target);
    copyResetTimerRef.current = setTimeout(() => {
      setCopiedTarget(null);
      setCopyFailedTarget(null);
      copyResetTimerRef.current = null;
    }, 1500);
  }, []);

  const scheduleCopyFailureReset = useCallback((target: CopyTarget) => {
    if (copyResetTimerRef.current !== null) {
      clearTimeout(copyResetTimerRef.current);
    }
    setCopiedTarget(null);
    setCopyFailedTarget(target);
    copyResetTimerRef.current = setTimeout(() => {
      setCopiedTarget(null);
      setCopyFailedTarget(null);
      copyResetTimerRef.current = null;
    }, 1500);
  }, []);

  const handleCopy = useCallback(
    async (target: CopyTarget, content: string) => {
      if (await copyTextToClipboard(content)) {
        scheduleCopyReset(target);
        return;
      }
      scheduleCopyFailureReset(target);
    },
    [scheduleCopyFailureReset, scheduleCopyReset],
  );

  const handlePinQuestion = useCallback(async () => {
    if (!sessionId || !runId) {
      return;
    }
    const base = currentAnnotation ?? { sentiment: null, isFavorited: false, isQuestionFavorited: false };
    const willPin = !base.isQuestionFavorited;
    const ok = await callAnnotationApi({ sentiment: base.sentiment, isFavorited: base.isFavorited, isQuestionFavorited: willPin });
    if (ok) {
      message.success(t(willPin ? 'turn.pinQuestionSuccess' : 'turn.unpinQuestionSuccess'));
    }
  }, [sessionId, runId, currentAnnotation, callAnnotationApi, t]);

  const handleGenerateReport = useCallback(() => {
    if (onGenerateReport && reportableRequestId) {
      onGenerateReport(rootMessageId, reportableRequestId);
    }
  }, [onGenerateReport, reportableRequestId, rootMessageId]);

  const handleAssistantAsyncLayoutSettled = useCallback(() => {
    if (readViewportFollowingBottom()) {
      requestScrollToBottomRef.current?.();
      return;
    }
    requestPreserveReadingAnchorRef.current?.();
  }, [readViewportFollowingBottom]);
  useLayoutEffect(() => {
    if ((!hasAnswerContent && processPanelHeight === 0) || !readViewportFollowingBottom()) {
      return;
    }

    onRequestScrollToBottom?.();
  }, [activeProcessActivitySignature, hasAnswerContent, onRequestScrollToBottom, processPanelHeight, readViewportFollowingBottom, answerContent]);

  if (isLoading) {
    return (
      <div data-testid="turn-block-skeleton" style={{ display: 'flex', flexDirection: 'column', gap: 16, marginBottom: 24 }}>
        <div style={{ alignSelf: 'flex-end', maxWidth: '60%' }}>
          <Skeleton.Input active size="small" style={{ width: 180, height: 36, borderRadius: '12px 12px 0 12px' }} />
        </div>
        <div style={{ alignSelf: 'flex-start', maxWidth: '85%' }}>
          <Skeleton active paragraph={{ rows: 2, width: ['100%', '80%'] }} title={{ width: '40%' }} avatar={{ size: 'small', shape: 'square' }} />
        </div>
      </div>
    );
  }

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'row',
        gap: 8,
        ...(anySelectionMode
          ? {
              background: 'var(--color-share-selection-turn-bg)',
              padding: '6px 16px',
              borderRadius: 8,
              marginBottom: 20,
            }
          : {}),
      }}
    >
      {shareSelection && runId ? (
        <div style={{ display: 'flex', alignItems: 'center', flexShrink: 0 }}>
          <input
            type="checkbox"
            data-testid={`share-checkbox-${runId}`}
            checked={shareSelected}
            disabled={!isShareable}
            onChange={() => onToggleShareSelection?.(runId)}
            style={{ cursor: isShareable ? 'pointer' : 'not-allowed', width: 18, height: 18, opacity: isShareable ? 1 : 0.45 }}
          />
        </div>
      ) : null}
      {reportSelection && rawRequestId && !isBiReportTurn ? (
        <div style={{ display: 'flex', alignItems: 'center', flexShrink: 0 }}>
          <input
            type="checkbox"
            data-testid={`report-checkbox-${rawRequestId}`}
            checked={reportSelected}
            disabled={!reportableRequestId || reportSelectionDisabled}
            onChange={() => onToggleReportSelection?.(rawRequestId)}
            style={{
              cursor: !reportableRequestId || reportSelectionDisabled ? 'not-allowed' : 'pointer',
              width: 18,
              height: 18,
              opacity: !reportableRequestId || reportSelectionDisabled ? 0.45 : 1,
            }}
          />
        </div>
      ) : null}
      <div
        data-testid="turn-block"
        data-root-message-id={rootMessageId}
        {...(block.displayRunId && isProcessHistoryEligibleRunStatus(block.status) ? { 'data-process-run-id': block.displayRunId } : {})}
        style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: anySelectionMode ? 0 : 20, flex: 1, minWidth: 0 }}
      >
        {'attachments' in userMessage && userMessage.attachments && userMessage.attachments.length > 0 && (
          <div data-testid="conversation-attachment-list" style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <div
              ref={attachmentListRef}
              onWheel={handleAttachmentWheel}
              style={{
                display: 'flex',
                gap: 4,
                maxWidth: '70%',
                overflowX: 'auto',
                scrollbarWidth: 'thin',
              }}
            >
              {userMessage.attachments.map((att, idx) => (
                <AttachmentFileCard
                  key={idx}
                  testId={`conversation-attachment-${idx}`}
                  fileName={att.fileName}
                  sizeBytes={att.sizeBytes}
                  isDark={hostTheme === 'evening'}
                  surface="conversation"
                />
              ))}
            </div>
          </div>
        )}
        {!hasUserContent && directiveTargetSkill && (
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <div
              data-testid="user-skill-placeholder"
              style={{
                width: 'fit-content',
                maxWidth: '80%',
                padding: '10px 14px',
                background: 'var(--color-user-bubble-bg)',
                color: 'var(--color-user-bubble-text)',
                borderRadius: '12px 12px 0 12px',
                wordBreak: 'break-word',
                opacity: 0.85,
                fontStyle: 'italic',
              }}
            >
              {t('composer.skillSelectedPlaceholder', { skill: directiveTargetSkill })}
            </div>
          </div>
        )}
        {hasUserContent && (
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <div
              data-testid="user-content-region"
              onMouseEnter={() => setIsUserRegionHovered(true)}
              onMouseLeave={() => setIsUserRegionHovered(false)}
              style={{ width: 'fit-content', maxWidth: '80%', position: 'relative', paddingBottom: 18, marginBottom: -2 }}
            >
              <div
                data-testid="user-bubble"
                style={{
                  padding: '10px 14px',
                  background: 'var(--color-user-bubble-bg)',
                  color: 'var(--color-user-bubble-text)',
                  borderRadius: '12px 12px 0 12px',
                  position: 'relative',
                  wordBreak: 'break-word',
                }}
              >
                <div style={{ whiteSpace: 'pre-wrap', lineHeight: 1.5, fontSize: 16 }}>{userMessage.content}</div>
              </div>
              <BubbleActions
                bubble="user"
                visible={isUserRegionHovered}
                align="right"
                editDisabled={!showLatestTurnActions}
                showRetry={false}
                forkInherited={forkInherited}
                copied={copiedTarget === 'user'}
                copyFailed={copyFailedTarget === 'user'}
                timestamp={aicoConfig?.showAskTime === false ? undefined : userActionTimestamp}
                onCopy={() => void handleCopy('user', userMessage.content)}
                onEdit={() => onEdit(rootMessageId)}
                {...(!turnActionsDisabled ? { onPin: () => void handlePinQuestion() } : {})}
                questionPinned={currentAnnotation?.isQuestionFavorited ?? false}
              />
            </div>
          </div>
        )}

        <div data-testid="ai-bubble" style={{ padding: '20px 16px', position: 'relative', wordBreak: 'break-word' }}>
          {showProcessSummary && (
            <ProcessPanel
              block={processBlock}
              rootMessageId={rootMessageId}
              status={status}
              isLatest={isLatest}
              isTerminal={isTerminal}
              isViewportFollowingBottom={isViewportFollowingBottom}
              readIsViewportFollowingBottom={readViewportFollowingBottom}
              executionDetailsPhase={executionDetailsPhase}
              processEntries={processEntries}
              processDisplayEntries={processDisplayEntries}
              processSummary={processSummary}
              activeProcessEntryKey={activeProcessEntryKey}
              shouldShowProcessIdleSweep={isProcessStreamIdle && activeProcessEntryKey !== null}
              showProcessSummary={showProcessSummary}
              showProcessTimelineAction={effectiveShowProcessTimelineAction}
              hasAnswerContent={hasAnswerContent}
              brandName={aicoConfig?.name}
              latestAssistantAnswerPresentationOrder={latestSupersedingOutputPresentationOrder}
              pendingSupplementalInputEntryKeys={pendingSupplementalInputEntryKeys}
              onOpenFullProcess={onOpenFullProcess}
              onRequestScrollToBottom={onRequestScrollToBottom}
              onRequestAnchorCompensation={onRequestAnchorCompensation}
              onPanelHeightChange={setProcessPanelHeight}
              processHistoryState={processHistoryState}
              displayRunId={runId}
              showProcessHistoryLoadingIndicator={showDelayedProcessHistoryLoading}
              onExpansionChange={handleProcessPanelExpansionChange}
            />
          )}
          {status === 'FAILED' ? <FailedNotice hasAnswerContent={hasAnswerContent} presentation={failureReason} /> : null}
          {status === 'CANCELED' && isGuardBlocked ? <GuardBlockedNotice /> : null}
          {status === 'CANCELED' && !isGuardBlocked ? <CanceledNotice hasAnswerContent={hasAnswerContent} /> : null}
          <StreamDSLContext local={dslLocale} theme={hostTheme} conversationId={sessionId}>
            {isBiReportTurn && biReportContent !== undefined && sessionId ? (
              <div
                data-testid="bi-report-content-region"
                style={{ borderTop: '1px solid var(--color-answer-separator)', marginTop: 16, paddingTop: 16 }}
              >
                <ReportAnswerCard content={biReportContent} />
              </div>
            ) : hasAnswerContent ? (
              <div
                ref={assistantContentRegionRef}
                data-testid="assistant-content-region"
                data-process-output-handoff={isAnswerHandoffFromPendingProcessContent ? 'true' : undefined}
                onMouseEnter={() => setIsAssistantRegionHovered(true)}
                onMouseLeave={() => setIsAssistantRegionHovered(false)}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'stretch',
                  position: 'relative',
                  paddingBottom: 18,
                  marginBottom: -18,
                  borderTop: '1px solid var(--color-answer-separator)',
                  marginTop: 16,
                  paddingTop: 16,
                }}
              >
                {hasStructuredAnswer ? (
                  <AnswerSegments segments={answerSegments} {...(sessionId === undefined ? {} : { sessionId })} />
                ) : (
                  <>
                    {progressiveAnswerParts.markdownPrefix.length > 0 ? (
                      <MarkdownContent
                        content={progressiveAnswerParts.markdownPrefix}
                        isStreamingAnswer={shouldShowStreamingTextEffect && progressiveAnswerParts.liveTail.length === 0}
                        sweepDuration={resolveTextSweepDuration(answerContent)}
                        cachePolicy={isStreaming && !isTerminal ? 'streaming' : 'stable'}
                        onMermaidRendered={handleAssistantAsyncLayoutSettled}
                      />
                    ) : null}
                    {progressiveAnswerParts.liveTail.length > 0 ? (
                      <PlainTextLiveContent
                        content={progressiveAnswerParts.liveTail}
                        isStreamingAnswer={shouldShowStreamingTextEffect}
                        sweepDuration={resolveTextSweepDuration(answerContent)}
                      />
                    ) : null}
                  </>
                )}
                {shouldShowTransientCompactionNotice ? (
                  <div
                    data-testid="assistant-compaction-notice"
                    style={{
                      alignSelf: 'stretch',
                      marginTop: 8,
                      fontSize: 12,
                      color: 'var(--color-text-tertiary)',
                      lineHeight: 1.5,
                      textAlign: 'center',
                    }}
                  >
                    {transientCompactionNotice.text}
                  </div>
                ) : null}
                {answerOperator ? (
                  <PiuRenderer
                    piuInfo={answerOperator}
                    theme={hostTheme}
                    extraPayload={{ sessionId, runId, answer: answerText }}
                    containerStyle={{ marginTop: 16 }}
                  />
                ) : (
                  <BubbleActions
                    bubble="assistant"
                    visible
                    align="left"
                    showRetry={showLatestTurnActions}
                    retryDisabled={retryDisabled}
                    forkInherited={forkInherited}
                    copied={copiedTarget === 'assistant'}
                    copyFailed={copyFailedTarget === 'assistant'}
                    timestamp={assistantActionTimestamp}
                    onCopy={() => void handleCopy('assistant', answerContent)}
                    onRetry={() => onRetry(rootMessageId)}
                    {...(canForkAssistantVisible && forkAnchor
                      ? {
                          onFork: () => onFork?.(forkAnchor),
                          forkBusy: isForkingAssistant,
                        }
                      : {})}
                    {...(canShowAnnotations
                      ? {
                          showAnnotations: true,
                          annotationState: currentAnnotation ?? { sentiment: null, isFavorited: false, isQuestionFavorited: false },
                          onLike: handleLike,
                          onDislike: handleDislike,
                          onFavorite: handleFavorite,
                          onOpenComplaint: () => setComplaintOpen(true),
                        }
                      : {})}
                    {...(onShare && !anySelectionMode
                      ? {
                          onShare: () => {
                            const shareRunId = aiEvents.length > 0 ? (aiEvents[0] as { readonly runId?: string }).runId : undefined;
                            onShare(rootMessageId, shareRunId);
                          },
                          shareDisabled: status === 'FAILED',
                        }
                      : {})}
                    {...(onGenerateReport && !anySelectionMode && reportableRequestId && !isBiReportTurn
                      ? {
                          onGenerateReport: handleGenerateReport,
                        }
                      : {})}
                  />
                )}
              </div>
            ) : isTerminal ? (
              <div
                data-testid="assistant-action-region-failed"
                style={{ marginTop: 16, paddingTop: 16, borderTop: '1px solid var(--color-answer-separator)' }}
              >
                {status === 'CANCELED' && !isGuardBlocked ? (
                  <div
                    data-testid="assistant-canceled-placeholder"
                    style={{ textAlign: 'center', color: 'var(--color-text-tertiary)', fontSize: 12, lineHeight: 1.5, marginBottom: 12 }}
                  >
                    {t('turn.canceledWithoutAnswer')}
                  </div>
                ) : null}
                <BubbleActions
                  bubble="assistant"
                  visible
                  align="left"
                  copyDisabled
                  showRetry={showLatestTurnActions}
                  retryDisabled={retryDisabled}
                  forkInherited={forkInherited}
                  copied={false}
                  copyFailed={false}
                  onCopy={() => {}}
                  timestamp={assistantActionTimestamp}
                  onRetry={() => onRetry(rootMessageId)}
                  {...(onShare && !anySelectionMode
                    ? {
                        onShare: () => {
                          const shareRunId = aiEvents.length > 0 ? (aiEvents[0] as { readonly runId?: string }).runId : undefined;
                          onShare(rootMessageId, shareRunId);
                        },
                        shareDisabled: true,
                      }
                    : {})}
                  {...(canShowAnnotations
                    ? {
                        showAnnotations: true,
                        annotationState: currentAnnotation ?? { sentiment: null, isFavorited: false, isQuestionFavorited: false },
                        onLike: handleLike,
                        onDislike: handleDislike,
                        onFavorite: handleFavorite,
                        favoriteDisabled: true,
                        onOpenComplaint: () => setComplaintOpen(true),
                      }
                    : {})}
                />
              </div>
            ) : null}
          </StreamDSLContext>
        </div>
        {status === 'COMPLETED' && isLatest && isLiveStreamed && sessionId && rootMessageId && onSuggestedQuestionClick ? (
          <div style={{ marginTop: 8 }}>
            <SuggestedQuestions sessionId={sessionId} requestId={rootMessageId} onQuestionClick={onSuggestedQuestionClick} />
          </div>
        ) : null}
        <ComplaintDialog open={complaintOpen} alogCard={complaintAlogCard} onClose={() => setComplaintOpen(false)} />
      </div>
    </div>
  );
}

export const TurnBlockComponent = memo(function TurnBlockComponent(props: TurnBlockComponentProps) {
  return (
    <ErrorBoundary fallback={<div style={{ padding: 12, color: 'var(--color-error)' }}>{'\u5185\u5bb9\u6e32\u67d3\u5931\u8d25'}</div>}>
      <TurnBlockContent {...props} />
    </ErrorBoundary>
  );
});
