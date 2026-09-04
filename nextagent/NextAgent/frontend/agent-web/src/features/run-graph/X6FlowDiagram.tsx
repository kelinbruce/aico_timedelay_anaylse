import { useEffect, useMemo, useRef, useState } from 'react';
import type { RunGraphEdgeState, RunGraphNodeState, RunGraphStatus, RunGraphViewState } from './types.ts';
import './runGraph.css';

type G6Module = typeof import('@antv/g6');
type G6Graph = InstanceType<G6Module['Graph']>;
interface G6GraphData {
  readonly nodes: Array<ReturnType<typeof toG6Node>>;
  readonly edges: Array<ReturnType<typeof toG6Edge>>;
}

export interface X6FlowDiagramProps {
  readonly viewState: RunGraphViewState;
  readonly fitSignal: number;
  readonly resetSignal: number;
  readonly loadingLabel: string;
  readonly errorLabel: string;
  readonly selectedNodeId?: string | null;
  readonly onNodeSelect?: (nodeId: string) => void;
}

const NODE_WIDTH = 292;
const NODE_HEIGHT = 132;
const NODE_GAP = 30;
const NODE_X = 28;
const NODE_Y = 24;
const RUN_GRAPH_NODE_TYPE = 'turn-run-graph-node';
const PAN_PADDING = 24;
const CONTENT_BOUNDS_PADDING = 12;
const NODE_SELECT_DRAG_THRESHOLD = 4;

let runGraphNodeRegistered = false;
const graphTranslations = new WeakMap<G6Graph, { readonly tx: number; readonly ty: number }>();
const graphContentBounds = new WeakMap<G6Graph, { readonly x: number; readonly y: number; readonly width: number; readonly height: number }>();

const STATUS_COLORS: Record<RunGraphStatus, { stroke: string; text: string; edge: string }> = {
  pending: { stroke: '#98a2b3', text: '#475467', edge: '#98a2b3' },
  running: { stroke: '#1677ff', text: '#175cd3', edge: '#1677ff' },
  success: { stroke: '#12b76a', text: '#067647', edge: '#12b76a' },
  failed: { stroke: '#f04438', text: '#b42318', edge: '#f04438' },
  canceled: { stroke: '#98a2b3', text: '#475467', edge: '#98a2b3' },
  superseded: { stroke: '#98a2b3', text: '#475467', edge: '#98a2b3' },
  waiting: { stroke: '#f79009', text: '#b54708', edge: '#f79009' },
  warning: { stroke: '#f79009', text: '#b54708', edge: '#f79009' },
  info: { stroke: '#667085', text: '#475467', edge: '#98a2b3' },
};

const PHASE_COLORS: Record<RunGraphNodeState['kind'], { lane: string }> = {
  request: { lane: '#2e90fa' },
  model: { lane: '#7a5af8' },
  capability: { lane: '#f79009' },
  userInput: { lane: '#12b76a' },
  degradation: { lane: '#fdb022' },
  answer: { lane: '#0ba5ec' },
  terminal: { lane: '#667085' },
};

export function X6FlowDiagram({
  viewState,
  fitSignal,
  resetSignal,
  loadingLabel,
  errorLabel,
  selectedNodeId = null,
  onNodeSelect,
}: X6FlowDiagramProps) {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const graphRef = useRef<G6Graph | null>(null);
  const viewStateRef = useRef(viewState);
  const selectedNodeIdRef = useRef<string | null>(selectedNodeId);
  const onNodeSelectRef = useRef<typeof onNodeSelect>(onNodeSelect);
  const reducedMotionRef = useRef(false);
  const nodeCountRef = useRef(viewState.nodes.length);
  const [isLoading, setIsLoading] = useState(true);
  const [hasError, setHasError] = useState(false);
  const prefersReducedMotion = usePrefersReducedMotion();

  useEffect(() => {
    viewStateRef.current = viewState;
    selectedNodeIdRef.current = selectedNodeId;
    onNodeSelectRef.current = onNodeSelect;
    reducedMotionRef.current = prefersReducedMotion;
    if (graphRef.current) {
      const shouldRefit = nodeCountRef.current !== viewState.nodes.length;
      applyGraphState(graphRef.current, viewState, prefersReducedMotion, selectedNodeId);
      nodeCountRef.current = viewState.nodes.length;
      if (shouldRefit) {
        fitGraph(graphRef.current);
      }
    }
  }, [onNodeSelect, prefersReducedMotion, selectedNodeId, viewState]);

  useEffect(() => {
    const viewport = viewportRef.current;
    const container = containerRef.current;
    if (!viewport || !container) {
      return undefined;
    }

    let disposed = false;
    let resizeFrame: number | null = null;
    let unbindPointerPanning: (() => void) | null = null;
    let unbindGraphResize: (() => void) | null = null;
    let hasFitVisibleViewport = false;

    const cancelScheduledResize = () => {
      if (resizeFrame === null || typeof window === 'undefined') {
        return;
      }
      window.cancelAnimationFrame(resizeFrame);
      resizeFrame = null;
    };

    const scheduleResizeFollowUp = (graph: G6Graph) => {
      cancelScheduledResize();
      const runFollowUp = () => {
        resizeFrame = null;
        if (disposed) {
          return;
        }
        if (!hasFitVisibleViewport && isUsableViewportSize(readContainerSize(viewport))) {
          hasFitVisibleViewport = true;
          fitGraph(graph);
        } else {
          clampCurrentGraphTranslation(viewport, graph);
        }
      };
      if (typeof window === 'undefined' || typeof window.requestAnimationFrame !== 'function') {
        runFollowUp();
        return;
      }
      resizeFrame = window.requestAnimationFrame(runFollowUp);
    };

    void import('@antv/g6')
      .then((G6) => {
        if (disposed) {
          return;
        }
        registerRunGraphNode(G6);
        const initialSize = readContainerSize(viewport) ?? { width: 1, height: 1 };
        const graph = new G6.Graph({
          container,
          width: initialSize.width,
          height: initialSize.height,
          fitView: false,
          modes: {
            default: [
              {
                type: 'zoom-canvas',
                minZoom: 0.6,
                maxZoom: 1.35,
              },
            ],
          },
          defaultEdge: {
            type: 'line',
          },
        });
        graphRef.current = graph;
        graphTranslations.set(graph, { tx: 0, ty: 0 });
        graph.on('node:click', (event: unknown) => {
          const nodeId = readG6NodeId(event);
          if (nodeId) {
            onNodeSelectRef.current?.(nodeId);
          }
        });
        unbindPointerPanning = bindPointerPanning(viewport, graph, (nodeId) => onNodeSelectRef.current?.(nodeId));
        unbindGraphResize = bindGraphViewportEvents(viewport, graph, () => scheduleResizeFollowUp(graph));
        renderInitialGraphState(graph, viewStateRef.current, reducedMotionRef.current, selectedNodeIdRef.current);
        nodeCountRef.current = viewStateRef.current.nodes.length;
        fitGraph(graph);
        hasFitVisibleViewport = isUsableViewportSize(readContainerSize(viewport));
        setIsLoading(false);
      })
      .catch(() => {
        if (!disposed) {
          setHasError(true);
          setIsLoading(false);
        }
      });

    return () => {
      disposed = true;
      cancelScheduledResize();
      unbindPointerPanning?.();
      unbindGraphResize?.();
      graphRef.current?.destroy();
      graphRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (fitSignal <= 0 || !graphRef.current) {
      return;
    }
    fitGraph(graphRef.current);
  }, [fitSignal]);

  useEffect(() => {
    if (resetSignal <= 0 || !graphRef.current) {
      return;
    }
    resetGraphView(graphRef.current);
  }, [resetSignal]);

  const canvasClassName = useMemo(
    () => (prefersReducedMotion ? 'turn-run-graph-canvas turn-run-graph-canvas--reduced-motion' : 'turn-run-graph-canvas'),
    [prefersReducedMotion],
  );

  return (
    <div ref={viewportRef} className="turn-run-graph-viewport" data-testid="turn-run-graph-viewport">
      <div ref={containerRef} className={canvasClassName} data-testid="turn-run-graph-x6-canvas" aria-hidden="true" />
      {isLoading ? (
        <div className="turn-run-graph-canvas__loading" data-testid="turn-run-graph-loading">
          {loadingLabel}
        </div>
      ) : null}
      {hasError ? (
        <div className="turn-run-graph-canvas__error" data-testid="turn-run-graph-error">
          {errorLabel}
        </div>
      ) : null}
    </div>
  );
}

function applyGraphState(graph: G6Graph, viewState: RunGraphViewState, reducedMotion: boolean, selectedNodeId: string | null): void {
  const data = toG6GraphData(viewState, reducedMotion, selectedNodeId);
  graphContentBounds.set(graph, calculateContentBounds(viewState));
  graph.changeData(data as any);
}

function renderInitialGraphState(graph: G6Graph, viewState: RunGraphViewState, reducedMotion: boolean, selectedNodeId: string | null): void {
  const data = toG6GraphData(viewState, reducedMotion, selectedNodeId);
  graphContentBounds.set(graph, calculateContentBounds(viewState));
  graph.data(data as any);
  graph.render();
}

function toG6GraphData(viewState: RunGraphViewState, reducedMotion: boolean, selectedNodeId: string | null): G6GraphData {
  return {
    nodes: viewState.nodes.map((node, index) => toG6Node(node, index, viewState, reducedMotion, selectedNodeId)),
    edges: viewState.edges.map((edge) => toG6Edge(edge)),
  };
}

function toG6Node(node: RunGraphNodeState, index: number, viewState: RunGraphViewState, reducedMotion: boolean, selectedNodeId: string | null) {
  const statusColors = STATUS_COLORS[node.status];
  const phaseColors = PHASE_COLORS[node.kind];
  const y = NODE_Y + index * (NODE_HEIGHT + NODE_GAP);
  const canAnimateActivity = !reducedMotion && (viewState.status === 'running' || viewState.status === 'waiting');
  const isActive = canAnimateActivity && (viewState.latestRunningNodeId === node.id || viewState.latestNodeId === node.id);
  return {
    id: node.x6NodeId,
    type: RUN_GRAPH_NODE_TYPE,
    x: NODE_X,
    y,
    size: [NODE_WIDTH, NODE_HEIGHT] as const,
    anchorPoints: [
      [0.5, 0],
      [0.5, 1],
    ],
    nodeId: node.id,
    status: node.status,
    phase: node.phaseLabel,
    phaseColor: phaseColors.lane,
    statusColor: statusColors.text,
    strokeColor: statusColors.stroke,
    statusLabel: node.statusLabel,
    title: node.title,
    eventLabel: node.eventLabel,
    summary: node.summary,
    metricLabel: node.metricLabel,
    isRunning: node.status === 'running' && !reducedMotion,
    isActive,
    isLatest: viewState.latestNodeId === node.id,
    isSelected: selectedNodeId === node.id,
    eventIds: node.relatedEventIds,
  };
}

interface RunGraphNodeRenderData {
  readonly nodeId?: string;
  readonly phase?: string;
  readonly phaseColor?: string;
  readonly status?: RunGraphStatus;
  readonly statusColor?: string;
  readonly strokeColor?: string;
  readonly statusLabel?: string;
  readonly title?: string;
  readonly eventLabel?: string;
  readonly summary?: string;
  readonly metricLabel?: string;
  readonly isRunning?: boolean;
  readonly isActive?: boolean;
  readonly isLatest?: boolean;
  readonly isSelected?: boolean;
}

function registerRunGraphNode(G6: G6Module): void {
  if (runGraphNodeRegistered) {
    return;
  }
  G6.registerNode(RUN_GRAPH_NODE_TYPE, {
    draw(cfg, group) {
      const data = (cfg ?? {}) as RunGraphNodeRenderData;
      const status = data.status ?? 'info';
      const isActive = !!data.isActive;
      const isSelected = !!data.isSelected;
      const strokeColor = data.strokeColor ?? '#98a2b3';
      const rect = group.addShape('rect', {
        name: 'run-graph-node-box',
        attrs: {
          x: -NODE_WIDTH / 2,
          y: -NODE_HEIGHT / 2,
          width: NODE_WIDTH,
          height: NODE_HEIGHT,
          radius: 8,
          fill: '#ffffff',
          stroke: isSelected ? '#1677ff' : strokeColor,
          lineWidth: isSelected ? 2.4 : isActive ? 2 : 1.4,
          shadowColor: isActive || data.isRunning ? strokeColor : 'transparent',
          shadowBlur: isActive || data.isRunning ? 8 : 0,
        },
      });
      group.addShape('rect', {
        name: 'run-graph-node-lane',
        attrs: {
          x: -NODE_WIDTH / 2,
          y: -NODE_HEIGHT / 2,
          width: 5,
          height: NODE_HEIGHT,
          radius: [8, 0, 0, 8],
          fill: data.phaseColor ?? '#667085',
        },
      });
      addG6Text(group, data.phase ?? '', -NODE_WIDTH / 2 + 18, -NODE_HEIGHT / 2 + 24, 12, data.phaseColor ?? '#667085', 600);
      addG6Text(group, data.statusLabel ?? status, NODE_WIDTH / 2 - 18, -NODE_HEIGHT / 2 + 24, 12, data.statusColor ?? '#475467', 600, 'right');
      addG6Text(group, truncateText(data.title ?? '', 42), -NODE_WIDTH / 2 + 18, -NODE_HEIGHT / 2 + 52, 14, '#101828', 600);
      addG6Text(group, truncateText(data.eventLabel ?? '', 52), -NODE_WIDTH / 2 + 18, -NODE_HEIGHT / 2 + 76, 12, '#475467', 400);
      addG6Text(group, truncateText(data.summary ?? '', 92), -NODE_WIDTH / 2 + 18, -NODE_HEIGHT / 2 + 98, 12, '#344054', 400);
      addG6Text(group, truncateText(data.metricLabel ?? '', 48), -NODE_WIDTH / 2 + 18, -NODE_HEIGHT / 2 + 118, 11, '#667085', 400);
      return rect;
    },
  });
  runGraphNodeRegistered = true;
}

function calculateContentBounds(viewState: RunGraphViewState): {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
} {
  const nodeCount = Math.max(viewState.nodes.length, 1);
  return {
    x: NODE_X - NODE_WIDTH / 2,
    y: NODE_Y - NODE_HEIGHT / 2,
    width: NODE_WIDTH,
    height: nodeCount * NODE_HEIGHT + Math.max(nodeCount - 1, 0) * NODE_GAP,
  };
}

function addG6Text(
  group: any,
  text: string,
  x: number,
  y: number,
  fontSize: number,
  fill: string,
  fontWeight: number,
  textAlign: 'left' | 'right' = 'left',
): void {
  group.addShape('text', {
    attrs: {
      x,
      y,
      text,
      fill,
      fontSize,
      fontWeight,
      textAlign,
      textBaseline: 'middle',
      fontFamily: 'inherit',
    },
  });
}

function toG6Edge(edge: RunGraphEdgeState) {
  const color = STATUS_COLORS[edge.status].edge;
  return {
    id: edge.x6EdgeId,
    source: edge.source,
    target: edge.target,
    style: {
      stroke: color,
      lineWidth: 1.6,
      endArrow: true,
    },
    data: {
      edgeId: edge.id,
      status: edge.status,
    },
  };
}

function fitGraph(graph: G6Graph): void {
  graph.fitView?.(PAN_PADDING);
  graph.fitCenter?.();
}

function bindGraphViewportEvents(viewport: HTMLDivElement, graph: G6Graph, handleViewportChange: () => void): () => void {
  const eventGraph = graph as G6Graph & {
    on?: (eventName: string, callback: () => void) => void;
    off?: (eventName: string, callback: () => void) => void;
  };
  const resizeGraphToViewport = () => {
    const size = readContainerSize(viewport);
    if (size) {
      graph.changeSize?.(size.width, size.height);
    }
    handleViewportChange();
  };
  let resizeObserver: ResizeObserver | null = null;
  eventGraph.on?.('afterrender', handleViewportChange);
  eventGraph.on?.('viewportchange', handleViewportChange);
  if (typeof ResizeObserver === 'function') {
    resizeObserver = new ResizeObserver(resizeGraphToViewport);
    resizeObserver.observe(viewport);
  } else if (typeof window !== 'undefined') {
    window.addEventListener('resize', resizeGraphToViewport);
  }
  return () => {
    eventGraph.off?.('afterrender', handleViewportChange);
    eventGraph.off?.('viewportchange', handleViewportChange);
    resizeObserver?.disconnect();
    window.removeEventListener('resize', resizeGraphToViewport);
  };
}

function bindPointerPanning(viewport: HTMLDivElement, graph: G6Graph, onNodeSelect?: (nodeId: string) => void): () => void {
  let isDragging = false;
  let activePointerId: number | null = null;
  let startClientX = 0;
  let startClientY = 0;
  let lastClientX = 0;
  let lastClientY = 0;
  let hasMoved = false;
  let pressedNodeId: string | null = null;

  const stopDragging = (shouldSelect: boolean) => {
    if (!isDragging) {
      return;
    }
    const selectedNodeId = shouldSelect && !hasMoved ? pressedNodeId : null;
    if (activePointerId !== null) {
      releasePointerCaptureSafely(viewport, activePointerId);
    }
    isDragging = false;
    activePointerId = null;
    pressedNodeId = null;
    viewport.classList.remove('turn-run-graph-viewport--dragging');
    if (selectedNodeId) {
      onNodeSelect?.(selectedNodeId);
    }
  };

  const handlePointerDown = (event: PointerEvent) => {
    if (event.button !== 0 || event.defaultPrevented) {
      return;
    }
    isDragging = true;
    activePointerId = event.pointerId;
    startClientX = event.clientX;
    startClientY = event.clientY;
    lastClientX = event.clientX;
    lastClientY = event.clientY;
    hasMoved = false;
    pressedNodeId = readRunGraphNodeId(event.target);
    viewport.classList.add('turn-run-graph-viewport--dragging');
    setPointerCaptureSafely(viewport, event.pointerId);
    event.preventDefault();
  };

  const handlePointerMove = (event: PointerEvent) => {
    if (!isDragging || event.pointerId !== activePointerId) {
      return;
    }
    const dx = event.clientX - lastClientX;
    const dy = event.clientY - lastClientY;
    const totalDx = event.clientX - startClientX;
    const totalDy = event.clientY - startClientY;
    if (!hasMoved && Math.hypot(totalDx, totalDy) > NODE_SELECT_DRAG_THRESHOLD) {
      hasMoved = true;
    }
    lastClientX = event.clientX;
    lastClientY = event.clientY;
    if (hasMoved && (dx !== 0 || dy !== 0)) {
      translateGraphWithinBounds(viewport, graph, dx, dy);
    }
    event.preventDefault();
  };

  const handlePointerUp = (event: PointerEvent) => {
    if (event.pointerId === activePointerId) {
      stopDragging(true);
    }
  };
  const handlePointerCancel = (event: PointerEvent) => {
    if (event.pointerId === activePointerId) {
      stopDragging(false);
    }
  };
  const handleWindowBlur = () => stopDragging(false);

  viewport.addEventListener('pointerdown', handlePointerDown, true);
  window.addEventListener('pointermove', handlePointerMove, true);
  window.addEventListener('pointerup', handlePointerUp, true);
  window.addEventListener('pointercancel', handlePointerCancel, true);
  window.addEventListener('blur', handleWindowBlur);

  return () => {
    stopDragging(false);
    viewport.removeEventListener('pointerdown', handlePointerDown, true);
    window.removeEventListener('pointermove', handlePointerMove, true);
    window.removeEventListener('pointerup', handlePointerUp, true);
    window.removeEventListener('pointercancel', handlePointerCancel, true);
    window.removeEventListener('blur', handleWindowBlur);
  };
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
    // The pointer may already be released by the browser or by graph internals.
  }
}

function readRunGraphNodeId(target: EventTarget | null): string | null {
  if (!(target instanceof Element)) {
    return null;
  }
  const nodeElement = target.closest('[data-run-graph-node-id]');
  const nodeId = nodeElement?.getAttribute('data-run-graph-node-id')?.trim();
  return nodeId && nodeId.length > 0 ? nodeId : null;
}

function readG6NodeId(event: unknown): string | null {
  const item = (event as { readonly item?: { getModel?: () => unknown } } | null)?.item;
  const model = item?.getModel?.();
  if (!model || typeof model !== 'object') {
    return null;
  }
  const nodeId = (model as { readonly nodeId?: unknown }).nodeId;
  return typeof nodeId === 'string' && nodeId.trim().length > 0 ? nodeId : null;
}

function translateGraphWithinBounds(viewport: HTMLDivElement, graph: G6Graph, dx: number, dy: number): void {
  const translation = readGraphTranslation(graph);
  const scale = readGraphScale(graph);
  const nextTranslation = clampGraphTranslation(viewport, graph, scale, {
    tx: translation.tx + dx,
    ty: translation.ty + dy,
  });
  translateGraphTo(graph, nextTranslation);
}

function clampCurrentGraphTranslation(viewport: HTMLDivElement, graph: G6Graph): void {
  const currentTranslation = readGraphTranslation(graph);
  const nextTranslation = clampGraphTranslation(viewport, graph, readGraphScale(graph), currentTranslation);
  if (nextTranslation.tx !== currentTranslation.tx || nextTranslation.ty !== currentTranslation.ty) {
    translateGraphTo(graph, nextTranslation);
  }
}

function clampGraphTranslation(
  viewport: HTMLDivElement,
  graph: G6Graph,
  scale: { readonly sx: number; readonly sy: number },
  translation: { readonly tx: number; readonly ty: number },
): { readonly tx: number; readonly ty: number } {
  const containerSize = readContainerSize(viewport);
  const contentBounds = readGraphContentBounds(graph);
  if (!containerSize || !contentBounds) {
    return translation;
  }

  return {
    tx: clampAxisTranslation({
      proposed: translation.tx,
      viewportSize: containerSize.width,
      contentStart: contentBounds.x,
      contentEnd: contentBounds.x + contentBounds.width,
      scale: scale.sx,
    }),
    ty: clampAxisTranslation({
      proposed: translation.ty,
      viewportSize: containerSize.height,
      contentStart: contentBounds.y,
      contentEnd: contentBounds.y + contentBounds.height,
      scale: scale.sy,
    }),
  };
}

function readGraphContentBounds(graph: G6Graph): { readonly x: number; readonly y: number; readonly width: number; readonly height: number } | null {
  return addContentBoundsPadding(graphContentBounds.get(graph) ?? null);
}

function addContentBoundsPadding(
  bounds: {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
  } | null,
): { readonly x: number; readonly y: number; readonly width: number; readonly height: number } | null {
  if (!bounds) {
    return null;
  }
  return {
    x: bounds.x - CONTENT_BOUNDS_PADDING,
    y: bounds.y - CONTENT_BOUNDS_PADDING,
    width: bounds.width + CONTENT_BOUNDS_PADDING * 2,
    height: bounds.height + CONTENT_BOUNDS_PADDING * 2,
  };
}

function normalizeGraphBounds(bounds: unknown): { readonly x: number; readonly y: number; readonly width: number; readonly height: number } | null {
  if (!bounds || typeof bounds !== 'object') {
    return null;
  }
  const candidate = bounds as Partial<Record<'x' | 'y' | 'width' | 'height', unknown>>;
  const x = typeof candidate.x === 'number' ? candidate.x : 0;
  const y = typeof candidate.y === 'number' ? candidate.y : 0;
  const width = typeof candidate.width === 'number' ? candidate.width : 0;
  const height = typeof candidate.height === 'number' ? candidate.height : 0;
  if (width <= 0 || height <= 0) {
    return null;
  }
  return { x, y, width, height };
}

function readContainerSize(container: HTMLDivElement): { readonly width: number; readonly height: number } | null {
  const rect = container.getBoundingClientRect();
  const width = Math.floor(container.clientWidth || rect.width);
  const height = Math.floor(container.clientHeight || rect.height);
  if (width <= 0 || height <= 0) {
    return null;
  }
  return { width, height };
}

function isUsableViewportSize(size: { readonly width: number; readonly height: number } | null): boolean {
  return !!size && size.width > 1 && size.height > 1;
}

function readGraphTranslation(graph: G6Graph): { readonly tx: number; readonly ty: number } {
  return graphTranslations.get(graph) ?? { tx: 0, ty: 0 };
}

function translateGraphTo(graph: G6Graph, nextTranslation: { readonly tx: number; readonly ty: number }): void {
  const currentTranslation = readGraphTranslation(graph);
  graph.translate(nextTranslation.tx - currentTranslation.tx, nextTranslation.ty - currentTranslation.ty);
  graphTranslations.set(graph, nextTranslation);
}

function readGraphScale(graph: G6Graph): { readonly sx: number; readonly sy: number } {
  const zoom = graph.getZoom?.() ?? 1;
  const safeZoom = typeof zoom === 'number' && zoom > 0 ? zoom : 1;
  return { sx: safeZoom, sy: safeZoom };
}

function clampAxisTranslation({
  proposed,
  viewportSize,
  contentStart,
  contentEnd,
  scale,
}: {
  readonly proposed: number;
  readonly viewportSize: number;
  readonly contentStart: number;
  readonly contentEnd: number;
  readonly scale: number;
}): number {
  const safeScale = scale > 0 ? scale : 1;
  const scaledStart = contentStart * safeScale;
  const scaledEnd = contentEnd * safeScale;
  const scaledSize = scaledEnd - scaledStart;
  const innerStart = PAN_PADDING;
  const innerEnd = Math.max(innerStart + 1, viewportSize - PAN_PADDING);
  if (scaledSize <= 0) {
    return proposed;
  }
  const min = innerStart - scaledEnd;
  const max = innerEnd - scaledStart;
  return clampNumber(proposed, Math.min(min, max), Math.max(min, max));
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function truncateText(value: string, maxLength: number): string {
  return value.length > maxLength ? `${value.slice(0, maxLength - 1)}...` : value;
}

function resetGraphView(graph: G6Graph): void {
  graph.zoomTo?.(1);
  graph.fitCenter?.();
  graphTranslations.set(graph, { tx: 0, ty: 0 });
}

function usePrefersReducedMotion(): boolean {
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return undefined;
    }
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    setPrefersReducedMotion(query.matches);
    const handleChange = (event: MediaQueryListEvent) => {
      setPrefersReducedMotion(event.matches);
    };
    query.addEventListener?.('change', handleChange);
    return () => {
      query.removeEventListener?.('change', handleChange);
    };
  }, []);

  return prefersReducedMotion;
}
