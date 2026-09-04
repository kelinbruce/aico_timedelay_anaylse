import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from 'react';
import { CloseOutlined, CompressOutlined, ExpandOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import type { TurnBlock } from '../../state/contracts.ts';
import { buildRunGraphViewState } from './buildRunGraphViewState.ts';
import type { RunGraphActivityItem, RunGraphNodeState, RunGraphStatus, RunGraphTranslate } from './types.ts';
import { X6FlowDiagram } from './X6FlowDiagram.tsx';
import './runGraph.css';

export interface TurnRunGraphPanelProps {
  readonly block: TurnBlock;
  readonly onClose: () => void;
  readonly closeButtonRef?: RefObject<HTMLButtonElement | null>;
}

const STATUS_CLASS_COLORS: Record<RunGraphStatus, { background: string; color: string; dot: string }> = {
  pending: { background: 'var(--color-status-pending-bg)', color: 'var(--color-status-pending-text)', dot: 'var(--color-status-pending-dot)' },
  running: { background: 'var(--color-status-running-bg)', color: 'var(--color-status-running-text)', dot: 'var(--color-status-running-dot)' },
  success: { background: 'var(--color-status-success-bg)', color: 'var(--color-status-success-text)', dot: 'var(--color-status-success-dot)' },
  failed: { background: 'var(--color-status-failed-bg)', color: 'var(--color-status-failed-text)', dot: 'var(--color-status-failed-dot)' },
  canceled: { background: 'var(--color-status-canceled-bg)', color: 'var(--color-status-canceled-text)', dot: 'var(--color-status-canceled-dot)' },
  superseded: { background: 'var(--color-status-canceled-bg)', color: 'var(--color-status-canceled-text)', dot: 'var(--color-status-canceled-dot)' },
  waiting: { background: 'var(--color-status-waiting-bg)', color: 'var(--color-status-waiting-text)', dot: 'var(--color-status-waiting-dot)' },
  warning: { background: 'var(--color-status-warning-bg)', color: 'var(--color-status-warning-text)', dot: 'var(--color-status-warning-dot)' },
  info: { background: 'var(--color-status-info-bg)', color: 'var(--color-status-info-text)', dot: 'var(--color-status-info-dot)' },
};

const SUMMARY_MIN_HEIGHT = 128;
const SUMMARY_DEFAULT_HEIGHT = 220;
const SUMMARY_MAX_HEIGHT = 420;
const SUMMARY_RESIZE_HANDLE_HEIGHT = 18;
const SUMMARY_RESIZE_KEYBOARD_STEP = 24;
const CANVAS_MIN_HEIGHT = 260;
const PANEL_BODY_VERTICAL_PADDING = 26;

export function TurnRunGraphPanel({ block, onClose, closeButtonRef }: TurnRunGraphPanelProps) {
  const { t } = useTranslation();
  const internalCloseButtonRef = useRef<HTMLButtonElement | null>(null);
  const resolvedCloseButtonRef = closeButtonRef ?? internalCloseButtonRef;
  const panelBodyRef = useRef<HTMLDivElement | null>(null);
  const summaryResizeCleanupRef = useRef<(() => void) | null>(null);
  const [fitSignal, setFitSignal] = useState(0);
  const [resetSignal, setResetSignal] = useState(0);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [summaryHeight, setSummaryHeight] = useState(SUMMARY_DEFAULT_HEIGHT);
  const [summaryMaxHeight, setSummaryMaxHeight] = useState(SUMMARY_MAX_HEIGHT);
  const translate = useCallback<RunGraphTranslate>((key, options) => (options ? String(t(key, options)) : String(t(key))), [t]);
  const viewState = useMemo(() => buildRunGraphViewState(block, translate), [block, translate]);
  const selectedNode = useMemo(() => viewState.nodes.find((node) => node.id === selectedNodeId) ?? null, [selectedNodeId, viewState.nodes]);

  const stopSummaryResize = useCallback(() => {
    const cleanup = summaryResizeCleanupRef.current;
    if (!cleanup) {
      return;
    }
    cleanup();
    summaryResizeCleanupRef.current = null;
  }, []);

  useEffect(() => {
    resolvedCloseButtonRef.current?.focus();
  }, [resolvedCloseButtonRef, viewState.rootMessageId]);

  useEffect(() => {
    setSelectedNodeId(null);
  }, [viewState.rootMessageId]);

  useEffect(() => {
    if (selectedNodeId && !selectedNode) {
      setSelectedNodeId(null);
    }
  }, [selectedNode, selectedNodeId]);

  useEffect(() => {
    setSummaryHeight((height) => clampSummaryHeight(height, readPanelBodyHeight(panelBodyRef)));
  }, [viewState.runKey]);

  useEffect(() => stopSummaryResize, [stopSummaryResize]);

  useEffect(() => {
    const body = panelBodyRef.current;
    if (!body) {
      return undefined;
    }

    const syncSummaryBounds = () => {
      const nextMaxHeight = readSummaryMaxHeight(readPanelBodyHeight(panelBodyRef));
      setSummaryMaxHeight(nextMaxHeight);
      setSummaryHeight((height) => Math.min(Math.max(height, SUMMARY_MIN_HEIGHT), nextMaxHeight));
    };

    syncSummaryBounds();
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', syncSummaryBounds);
      return () => window.removeEventListener('resize', syncSummaryBounds);
    }

    const observer = new ResizeObserver(syncSummaryBounds);
    observer.observe(body);
    return () => observer.disconnect();
  }, []);

  const handleSummaryResizePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (event.button !== 0) {
        return;
      }
      event.preventDefault();
      stopSummaryResize();
      const startY = event.clientY;
      const startHeight = summaryHeight;

      const handlePointerMove = (moveEvent: PointerEvent) => {
        const nextHeight = startHeight - (moveEvent.clientY - startY);
        setSummaryHeight(clampSummaryHeight(nextHeight, readPanelBodyHeight(panelBodyRef)));
      };
      const handlePointerUp = () => {
        stopSummaryResize();
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
      summaryResizeCleanupRef.current = cleanup;
    },
    [stopSummaryResize, summaryHeight],
  );

  const handleSummaryResizeKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>) => {
      const maxHeight = readSummaryMaxHeight(readPanelBodyHeight(panelBodyRef));
      let nextHeight: number | null = null;
      switch (event.key) {
        case 'ArrowUp':
          nextHeight = summaryHeight + SUMMARY_RESIZE_KEYBOARD_STEP;
          break;
        case 'ArrowDown':
          nextHeight = summaryHeight - SUMMARY_RESIZE_KEYBOARD_STEP;
          break;
        case 'Home':
          nextHeight = SUMMARY_MIN_HEIGHT;
          break;
        case 'End':
          nextHeight = maxHeight;
          break;
        default:
          return;
      }
      event.preventDefault();
      stopSummaryResize();
      setSummaryHeight(clampSummaryHeight(nextHeight, readPanelBodyHeight(panelBodyRef)));
    },
    [stopSummaryResize, summaryHeight],
  );

  return (
    <section className="turn-run-graph-panel" data-testid="turn-run-graph-panel" aria-label={t('turnRunGraph.ariaLabel')}>
      <div className="turn-run-graph-panel__header">
        <div>
          <h2 className="turn-run-graph-panel__title">{t('turnRunGraph.title')}</h2>
          <div className="turn-run-graph-panel__meta" data-testid="turn-run-graph-meta">
            {t('turnRunGraph.meta', {
              status: viewState.statusLabel,
              events: viewState.summary.eventCount,
              nodes: viewState.summary.nodeCount,
            })}
          </div>
        </div>
        <div className="turn-run-graph-panel__controls">
          <button
            type="button"
            className="turn-run-graph-panel__icon-button"
            data-testid="turn-run-graph-fit"
            aria-label={t('turnRunGraph.fit')}
            title={t('turnRunGraph.fit')}
            onClick={() => setFitSignal((value) => value + 1)}
          >
            <ExpandOutlined />
          </button>
          <button
            type="button"
            className="turn-run-graph-panel__icon-button"
            data-testid="turn-run-graph-reset"
            aria-label={t('turnRunGraph.reset')}
            title={t('turnRunGraph.reset')}
            onClick={() => setResetSignal((value) => value + 1)}
          >
            <CompressOutlined />
          </button>
          <button
            ref={resolvedCloseButtonRef}
            type="button"
            className="turn-run-graph-panel__icon-button"
            data-testid="turn-run-graph-close"
            aria-label={t('turnRunGraph.close')}
            title={t('turnRunGraph.close')}
            onClick={onClose}
          >
            <CloseOutlined />
          </button>
        </div>
      </div>

      <div ref={panelBodyRef} className="turn-run-graph-panel__body">
        <div className="turn-run-graph-panel__canvas-shell" data-testid="turn-run-graph-canvas-shell" style={{ minHeight: CANVAS_MIN_HEIGHT }}>
          <X6FlowDiagram
            viewState={viewState}
            fitSignal={fitSignal}
            resetSignal={resetSignal}
            loadingLabel={t('turnRunGraph.loading')}
            errorLabel={t('turnRunGraph.error')}
            selectedNodeId={selectedNodeId}
            onNodeSelect={setSelectedNodeId}
          />
        </div>
        <div
          role="separator"
          aria-orientation="horizontal"
          aria-label={t('turnRunGraph.summaryResizeHandle')}
          aria-valuemin={SUMMARY_MIN_HEIGHT}
          aria-valuemax={summaryMaxHeight}
          aria-valuenow={summaryHeight}
          tabIndex={0}
          className="turn-run-graph-panel__summary-resize-handle"
          data-testid="turn-run-graph-summary-resize-handle"
          onPointerDown={handleSummaryResizePointerDown}
          onKeyDown={handleSummaryResizeKeyDown}
        >
          <span aria-hidden="true" className="turn-run-graph-panel__summary-resize-grip" />
        </div>
        <ProcessSummaryList
          activities={viewState.activities}
          title={t('turnRunGraph.summaryTitle')}
          selectedNode={selectedNode}
          style={{
            flexBasis: summaryHeight,
            height: summaryHeight,
            minHeight: SUMMARY_MIN_HEIGHT,
            maxHeight: summaryMaxHeight,
          }}
        />
      </div>
    </section>
  );
}

function ProcessSummaryList({
  activities,
  title,
  selectedNode,
  style,
}: {
  readonly activities: readonly RunGraphActivityItem[];
  readonly title: string;
  readonly selectedNode: RunGraphNodeState | null;
  readonly style: CSSProperties;
}) {
  return (
    <section
      className="turn-run-graph-panel__summary"
      data-testid="turn-run-graph-summary"
      tabIndex={0}
      aria-labelledby="turn-run-graph-summary-title"
      style={style}
    >
      {selectedNode ? <SelectedNodeDetail node={selectedNode} /> : null}
      <h3 id="turn-run-graph-summary-title" className="turn-run-graph-panel__summary-title">
        {title}
      </h3>
      <ol className="turn-run-graph-panel__summary-list" data-testid="turn-run-graph-summary-list">
        {activities.map((activity) => {
          const colors = STATUS_CLASS_COLORS[activity.status];
          return (
            <li key={activity.id} className="turn-run-graph-panel__summary-item">
              <span className="turn-run-graph-panel__summary-dot" aria-hidden="true" style={{ background: colors.dot }} />
              <div className="turn-run-graph-panel__summary-row">
                <div className="turn-run-graph-panel__summary-heading">
                  <span>{activity.title}</span>
                  <span className="turn-run-graph-panel__summary-status" style={{ background: colors.background, color: colors.color }}>
                    {activity.statusLabel}
                  </span>
                </div>
                <div className="turn-run-graph-panel__summary-description">{activity.description}</div>
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function SelectedNodeDetail({ node }: { readonly node: RunGraphNodeState }) {
  const { t } = useTranslation();
  const colors = STATUS_CLASS_COLORS[node.status];
  const toolCallIds = node.relatedToolCallIds.length > 0 ? node.relatedToolCallIds.join(', ') : t('turnRunGraph.nodeDetail.none');
  const eventCount = t('turnRunGraph.nodeDetail.eventCount', { count: node.relatedEventIds.length });

  return (
    <section className="turn-run-graph-panel__node-detail" data-testid="turn-run-graph-node-detail">
      <div className="turn-run-graph-panel__node-detail-heading">
        <div className="turn-run-graph-panel__node-detail-kicker">{t('turnRunGraph.nodeDetail.title')}</div>
        <div className="turn-run-graph-panel__node-detail-title-row">
          <h3 className="turn-run-graph-panel__node-detail-title">{node.title}</h3>
          <span className="turn-run-graph-panel__summary-status" style={{ background: colors.background, color: colors.color }}>
            {node.statusLabel}
          </span>
        </div>
      </div>
      <dl className="turn-run-graph-panel__node-detail-grid">
        <div>
          <dt>{t('turnRunGraph.nodeDetail.phase')}</dt>
          <dd>{node.phaseLabel}</dd>
        </div>
        <div>
          <dt>{t('turnRunGraph.nodeDetail.events')}</dt>
          <dd>{eventCount}</dd>
        </div>
        <div>
          <dt>{t('turnRunGraph.nodeDetail.metric')}</dt>
          <dd>{node.metricLabel}</dd>
        </div>
        <div>
          <dt>{t('turnRunGraph.nodeDetail.toolCalls')}</dt>
          <dd>{toolCallIds}</dd>
        </div>
      </dl>
      <ul className="turn-run-graph-panel__node-detail-lines">
        {node.detailLines.map((line, index) => (
          <li key={`${node.id}:detail:${index}`}>{line}</li>
        ))}
      </ul>
      <div className="turn-run-graph-panel__node-detail-references">
        <span>{t('turnRunGraph.nodeDetail.references')}</span>
        <span>{node.eventLabel}</span>
        {node.references.length > 0 ? (
          <ol>
            {node.references.map((reference) => (
              <li key={reference.eventId}>
                {reference.eventType} · seq {reference.sequence}
                {reference.createdAt ? ` · ${reference.createdAt}` : ''}
              </li>
            ))}
          </ol>
        ) : null}
      </div>
    </section>
  );
}

function readPanelBodyHeight(ref: RefObject<HTMLDivElement | null>): number {
  const measuredHeight = ref.current?.getBoundingClientRect().height ?? 0;
  return measuredHeight > 0 ? measuredHeight : 0;
}

function readSummaryMaxHeight(panelBodyHeight: number): number {
  if (panelBodyHeight <= 0) {
    return SUMMARY_MAX_HEIGHT;
  }
  const availableHeight = Math.max(0, panelBodyHeight - PANEL_BODY_VERTICAL_PADDING);
  return Math.min(SUMMARY_MAX_HEIGHT, Math.max(SUMMARY_MIN_HEIGHT, availableHeight - CANVAS_MIN_HEIGHT - SUMMARY_RESIZE_HANDLE_HEIGHT));
}

function clampSummaryHeight(height: number, panelBodyHeight: number): number {
  return Math.min(Math.max(height, SUMMARY_MIN_HEIGHT), readSummaryMaxHeight(panelBodyHeight));
}
