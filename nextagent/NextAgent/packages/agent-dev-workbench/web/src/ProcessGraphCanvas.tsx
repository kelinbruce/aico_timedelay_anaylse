import G6 from '@antv/g6';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  FLOW_ANCHOR_POINTS,
  type GraphEdge,
  type GraphNode,
  NODE_H,
  NODE_W,
  type ParallelBatch,
  projectVisualEdges,
  visualEdgeAnchors,
  visualEdgeType,
  wrapLayout,
} from './process-graph-layout.js';

interface GraphView {
  readonly nodes: readonly GraphNode[];
  readonly edges: readonly GraphEdge[];
}

interface ProcessGraphCanvasProps {
  readonly graph: GraphView;
  readonly selectedActionId?: string;
  readonly fitSignal: number;
  readonly onSelect: (actionId: string) => void;
  readonly onOpenChildRun: (agentId: string, sessionId: string, runId: string) => void;
}

const nodeType = 'wb-graph-node';
let nodeRegistered = false;

const typeColor: Record<string, string> = {
  request: '#2563eb',
  scheduler: '#6366f1',
  context: '#0891b2',
  context_compaction: '#0d9488',
  model: '#7c3aed',
  capability: '#059669',
  subagent: '#0284c7',
  hook: '#d97706',
  policy: '#dc2626',
  gateway: '#ea580c',
  stream: '#64748b',
  terminal: '#059669',
};

const eventLabels: Record<string, string> = {
  'Request accepted': '请求已接受',
  PLANNING_STARTED: '调度开始',
  CONTEXT_ASSEMBLED: '上下文已组装',
  CONTEXT_COMPACTED: '上下文已压缩',
  MODEL_INVOCATION_STARTED: '模型调用开始',
  MODEL_INVOCATION_COMPLETED: '模型调用完成',
  MODEL_INVOCATION_FAILED: '模型调用失败',
  CAPABILITY_STARTED: '能力调用开始',
  CAPABILITY_COMPLETED: '能力调用完成',
  CAPABILITY_FAILED: '能力调用失败',
  TOOL_STRUCTURED_DELTA: '工具结构化增量',
  POLICY_APPLIED: '策略已应用',
  HOOK_INVOKED: '钩子已执行',
  BEFORE_REQUEST_ACCEPT: '请求接收前',
  BEFORE_PLANNING: '规划前',
  BEFORE_MODEL_INVOKE: '模型调用前',
  AFTER_MODEL_RESULT: '模型结果后',
  BEFORE_CAPABILITY_INVOKE: '能力调用前',
  AFTER_CAPABILITY_RESULT: '能力结果后',
  BEFORE_CONTEXT_COMPACT: '上下文压缩前',
  AFTER_CONTEXT_COMPACT: '上下文压缩后',
  BEFORE_AGENT_TERMINAL: 'Agent 终态前',
  REQUEST_ACCEPTED: '请求已接受',
  REQUEST_COMPLETED: '请求已完成',
  REQUEST_FAILED: '请求已失败',
  REQUEST_CANCELED: '请求已取消',
  REQUEST_SUPERSEDED: '请求已替代',
  USER_INPUT_REQUIRED: '等待用户输入',
  USER_INPUT_RECEIVED: '用户输入已接收',
  USER_INPUT_TIMEOUT: '用户输入超时',
  USER_INPUT_CANCELED: '用户输入已取消',
  LLM_THINKING_DELTA: '思考增量',
  LLM_CONTENT_DELTA: '内容增量',
};

export function ProcessGraphCanvas({ graph, selectedActionId, fitSignal, onSelect, onOpenChildRun }: ProcessGraphCanvasProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const graphRef = useRef<G6.Graph | null>(null);
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  const onOpenChildRunRef = useRef(onOpenChildRun);
  onOpenChildRunRef.current = onOpenChildRun;
  const [hostWidth, setHostWidth] = useState(900);

  const graphData = useMemo(() => {
    const positions = wrapLayout(graph.nodes, graph.edges, hostWidth);
    const parallelBatches = collectParallelBatches(graph.nodes);
    const comboIdByNodeId = new Map(parallelBatches.flatMap((batch) => batch.nodeIds.map((nodeId) => [nodeId, batch.id] as const)));
    const visualEdges = projectVisualEdges(graph.edges, parallelBatches);
    return {
      nodes: graph.nodes.map((node) => {
        const pos = positions.get(node.actionId) ?? { x: 0, y: 0 };
        const tc = typeColor[node.type] ?? '#64748b';
        const sm = statusMeta(node.status);
        const toolName = extractStr(node, 'toolName');
        const isToolNode = node.type === 'capability' && toolName.length > 0;
        const isSubagentNode = node.type === 'subagent';
        const el = isSubagentNode ? `Subagent · ${node.label}` : isToolNode ? toolName : eventLabelZh(node.label);
        const ki = keyInfo(node);
        const parallelInfo =
          node.refs.toolBatchExecutionMode === 'PARALLEL' ? `并行 ${String(node.refs.toolBatchOrdinal)}/${String(node.refs.toolBatchSize)}` : '';
        return {
          id: node.actionId,
          type: nodeType,
          x: pos.x,
          y: pos.y,
          typeColor: tc,
          eventLabel: el,
          statusLabel: sm.label,
          statusColor: sm.color,
          infoLine: [parallelInfo, ki !== el ? ki : '', fmtDur(node.durationMs)].filter(Boolean).join(' · '),
          ...(comboIdByNodeId.has(node.actionId) ? { comboId: comboIdByNodeId.get(node.actionId) } : {}),
          selected: false,
          childAgentId: node.refs.childAgentId,
          childSessionId: node.refs.childSessionId,
          childRunId: node.refs.childRunId,
          anchorPoints: FLOW_ANCHOR_POINTS,
        };
      }),
      edges: visualEdges.map((edge, i) => ({
        id: `${edge.from}:${edge.to}:${i}`,
        source: edge.from,
        target: edge.to,
        type: visualEdgeType(edge),
        ...visualEdgeAnchors(edge, positions),
        style: {
          stroke: edge.kind === 'child' ? '#f59e0b' : edge.kind === 'parallel' ? '#2563eb' : '#94a3b8',
          lineWidth: 1.5,
          lineDash: edge.kind === 'child' ? [5, 4] : undefined,
          radius: edge.kind === 'parallel' ? 8 : undefined,
          offset: edge.kind === 'parallel' ? 20 : undefined,
          endArrow: { path: G6.Arrow.triangle(7, 5, 0), fill: edge.kind === 'child' ? '#f59e0b' : edge.kind === 'parallel' ? '#2563eb' : '#94a3b8' },
        },
      })),
      combos: parallelBatches.map((batch) => ({
        id: batch.id,
        type: 'rect',
        anchorPoints: FLOW_ANCHOR_POINTS,
        label: `并行执行 · ${batch.size}`,
        padding: [34, 20, 20, 20],
        style: {
          fill: 'rgba(37, 99, 235, 0.035)',
          stroke: '#60a5fa',
          lineWidth: 1.5,
          lineDash: [6, 4],
          radius: 10,
        },
        labelCfg: {
          position: 'top',
          style: { fill: '#2563eb', fontSize: 12, fontWeight: 600 },
        },
      })),
    };
  }, [graph.edges, graph.nodes, hostWidth]);

  useEffect(() => {
    registerNode();
    const host = hostRef.current;
    if (!host) {
      return undefined;
    }
    setHostWidth(host.clientWidth || 900);
    const instance = new G6.Graph({
      container: host,
      width: host.clientWidth || 900,
      height: host.clientHeight || 560,
      fitView: true,
      fitViewPadding: 40,
      animate: false,
      modes: { default: ['drag-canvas', 'zoom-canvas'] },
      nodeStateStyles: {
        hover: { shadowBlur: 14, shadowColor: 'rgba(59,130,246,0.18)' },
        selected: { stroke: '#2563eb', lineWidth: 2, shadowBlur: 12, shadowColor: 'rgba(37,99,235,0.16)' },
      },
    });
    graphRef.current = instance;
    instance.on('node:click', (e: unknown) => {
      const m = (e as { readonly item?: { getModel?: () => { readonly id?: string } } }).item?.getModel?.();
      if (m?.id) {
        onSelectRef.current(m.id);
      }
    });
    instance.on('node:dblclick', (e: unknown) => {
      const model = (e as { readonly item?: { getModel?: () => Record<string, unknown> } }).item?.getModel?.();
      if (typeof model?.childAgentId === 'string' && typeof model.childSessionId === 'string' && typeof model.childRunId === 'string') {
        onOpenChildRunRef.current(model.childAgentId, model.childSessionId, model.childRunId);
      }
    });
    instance.on('node:mouseenter', (e: unknown) => {
      const item = (e as { readonly item?: object }).item;
      if (item) {
        instance.setItemState(item as never, 'hover', true);
      }
    });
    instance.on('node:mouseleave', (e: unknown) => {
      const item = (e as { readonly item?: object }).item;
      if (item) {
        instance.setItemState(item as never, 'hover', false);
      }
    });
    const ro = new ResizeObserver(() => {
      const w = host.clientWidth || 900;
      const h = host.clientHeight || 560;
      setHostWidth(w);
      instance.changeSize(w, h);
      instance.fitView(40);
    });
    ro.observe(host);
    return () => {
      ro.disconnect();
      instance.destroy();
      graphRef.current = null;
    };
  }, []);

  useEffect(() => {
    const inst = graphRef.current;
    if (!inst) {
      return;
    }
    inst.changeData(graphData);
    inst.fitView(40);
  }, [graphData]);

  useEffect(() => {
    const inst = graphRef.current;
    if (!inst) {
      return;
    }
    for (const node of inst.getNodes()) {
      inst.setItemState(node, 'selected', node.getID() === selectedActionId);
    }
  }, [selectedActionId]);

  useEffect(() => {
    graphRef.current?.fitView(40);
  }, [fitSignal]);

  return <div ref={hostRef} className="process-graph-canvas" data-testid="agent-dev-workbench-process-graph" />;
}

function collectParallelBatches(nodes: readonly GraphNode[]): readonly ParallelBatch[] {
  const groups = new Map<string, GraphNode[]>();
  for (const node of nodes) {
    if (node.refs.toolBatchExecutionMode !== 'PARALLEL') {
      continue;
    }
    const key = `${String(node.refs.stepId)}:${String(node.refs.toolBatchSize)}`;
    const group = groups.get(key) ?? [];
    group.push(node);
    groups.set(key, group);
  }
  return [...groups.values()].map((group, index) => ({
    id: `parallel-batch-${index + 1}`,
    size: group.length,
    nodeIds: group.map((node) => node.actionId),
  }));
}

function registerNode(): void {
  if (nodeRegistered) {
    return;
  }
  G6.registerNode(nodeType, {
    draw(cfg, group) {
      const d = cfg as {
        readonly typeColor?: string;
        readonly eventLabel?: string;
        readonly statusLabel?: string;
        readonly statusColor?: string;
        readonly infoLine?: string;
        readonly selected?: boolean;
      };
      const tc = d.typeColor ?? '#64748b';
      const sc = d.statusColor ?? '#64748b';
      const sel = d.selected === true;
      const hw = NODE_W / 2;
      const hh = NODE_H / 2;

      const key = group.addShape('rect', {
        attrs: {
          x: -hw,
          y: -hh,
          width: NODE_W,
          height: NODE_H,
          radius: 8,
          fill: '#ffffff',
          stroke: sel ? '#2563eb' : '#e2e8f0',
          lineWidth: sel ? 2 : 1,
          shadowColor: sel ? 'rgba(37,99,235,0.16)' : 'rgba(15,23,42,0.05)',
          shadowBlur: sel ? 12 : 6,
          cursor: 'pointer',
        },
        name: 'node-body',
      });
      group.addShape('rect', {
        attrs: { x: -hw, y: -hh, width: 4, height: NODE_H, radius: [8, 0, 0, 8], fill: tc },
      });
      group.addShape('circle', { attrs: { r: 3.5, x: -hw + 15, y: -hh + 14, fill: tc } });
      txt(group, d.eventLabel ?? '', -hw + 24, -hh + 14, 12.5, '#1e293b', 700);
      txt(group, d.statusLabel ?? '', hw - 10, -hh + 14, 10.5, sc, 600, 'right');
      if (d.infoLine && d.infoLine.length > 0) {
        txt(group, trunc(d.infoLine, 28), -hw + 12, hh - 13, 11, '#64748b', 400);
      }
      return key;
    },
  });
  nodeRegistered = true;
}

function txt(group: never, t: string, x: number, y: number, fs: number, fill: string, fw: number, align: 'left' | 'right' = 'left'): void {
  group.addShape('text', {
    attrs: {
      x,
      y,
      text: t,
      fill,
      fontSize: fs,
      fontWeight: fw,
      textAlign: align,
      textBaseline: 'middle',
      fontFamily: 'Inter, system-ui, sans-serif',
    },
  });
}

function eventLabelZh(label: string): string {
  if (label.includes(':')) {
    return label;
  }
  return eventLabels[label] ?? label;
}

function statusMeta(s: string): { label: string; color: string } {
  const n = s.toLowerCase();
  if (n.includes('fail')) {
    return { label: '失败', color: '#dc2626' };
  }
  if (n.includes('cancel')) {
    return { label: '取消', color: '#64748b' };
  }
  if (n.includes('running') || n.includes('partial') || n.includes('queued')) {
    return { label: '执行中', color: '#d97706' };
  }
  if (n.includes('completed') || n.includes('available')) {
    return { label: '完成', color: '#059669' };
  }
  return { label: s, color: '#2563eb' };
}

function fmtDur(ms: number | undefined): string {
  if (typeof ms !== 'number' || !Number.isFinite(ms)) {
    return '';
  }
  if (ms < 1000) {
    return `${ms}ms`;
  }
  return `${(ms / 1000).toFixed(1)}秒`;
}

function extractStr(node: GraphNode, key: string): string {
  const p = node.refs?.payload;
  if (typeof p === 'object' && p !== null && !Array.isArray(p)) {
    const v = (p as Record<string, unknown>)[key];
    if (typeof v === 'string' && v.length > 0) {
      return v;
    }
  }
  return '';
}

function keyInfo(node: GraphNode): string {
  if (node.type === 'subagent') {
    const childRunId = node.refs?.childRunId;
    return typeof childRunId === 'string' ? childRunId : '子运行不可用';
  }
  if (node.type === 'capability' && typeof node.refs?.commandPreview === 'string') {
    return node.refs.commandPreview;
  }
  const p = node.refs?.payload;
  if (typeof p === 'object' && p !== null && !Array.isArray(p)) {
    const o = p as Record<string, unknown>;
    for (const k of ['stage', 'modelId', 'toolName', 'capabilityKind', 'policyId', 'promptTemplateRef', 'laneKind', 'strategyCode']) {
      const v = o[k];
      if (typeof v === 'string' && v.length > 0) {
        return v;
      }
    }
    for (const sk of ['contentSummary', 'reasoningSummary']) {
      const s = o[sk];
      if (typeof s === 'object' && s !== null && typeof (s as Record<string, unknown>)['charCount'] === 'number') {
        return `${(s as Record<string, unknown>)['charCount']} 字符`;
      }
    }
  }
  const gk = node.refs?.gatewayKind;
  const op = node.refs?.operation;
  if (typeof gk === 'string' && typeof op === 'string') {
    return `${gk}:${op}`;
  }
  return '';
}

function trunc(v: string, n: number): string {
  return v.length > n ? `${v.slice(0, n - 1)}…` : v;
}
