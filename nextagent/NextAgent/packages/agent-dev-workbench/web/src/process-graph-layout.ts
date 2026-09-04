export interface DetailAvailability {
  readonly status: string;
  readonly reasonCode?: string;
}

export interface GraphNode {
  readonly actionId: string;
  readonly type: string;
  readonly label: string;
  readonly status: string;
  readonly startedAt?: number;
  readonly endedAt?: number;
  readonly durationMs?: number;
  readonly refs: Record<string, unknown>;
  readonly detailAvailability: DetailAvailability;
}

export interface GraphEdge {
  readonly from: string;
  readonly to: string;
  readonly kind: 'sequence' | 'parallel' | 'child';
}

export interface ParallelBatch {
  readonly id: string;
  readonly size: number;
  readonly nodeIds: readonly string[];
}

export const NODE_W = 210;
export const NODE_H = 50;
export const FLOW_ANCHOR_POINTS = [
  [0.5, 0],
  [0.5, 1],
  [1, 0.5],
  [0, 0.5],
] as const;

export function wrapLayout(
  nodes: readonly GraphNode[],
  edges: readonly GraphEdge[],
  canvasWidth: number,
): Map<string, { readonly x: number; readonly y: number }> {
  const gapX = 36;
  const gapY = 82;
  const pad = 44;
  const childGap = 10;
  const childOffset = 14;
  const seqNext = new Map<string, string>();
  const seqHasPrev = new Set<string>();
  for (const edge of edges) {
    if (edge.kind === 'sequence') {
      seqNext.set(edge.from, edge.to);
      seqHasPrev.add(edge.to);
    }
  }
  const childOf = new Map<string, string[]>();
  const parallelMembers = new Set(nodes.filter((node) => node.refs.toolBatchExecutionMode === 'PARALLEL').map((node) => node.actionId));
  for (const edge of edges) {
    if (edge.kind === 'child' || (edge.kind === 'parallel' && parallelMembers.has(edge.to))) {
      const children = childOf.get(edge.from) ?? [];
      children.push(edge.to);
      childOf.set(edge.from, children);
    }
  }
  let start = nodes[0]?.actionId ?? '';
  for (const node of nodes) {
    if (!seqHasPrev.has(node.actionId)) {
      start = node.actionId;
      break;
    }
  }
  const chain: string[] = [];
  const seen = new Set<string>();
  for (let current = start; current && !seen.has(current); current = seqNext.get(current) ?? '') {
    chain.push(current);
    seen.add(current);
  }
  for (const node of nodes) {
    if (
      !seen.has(node.actionId) &&
      !parallelMembers.has(node.actionId) &&
      !edges.some((edge) => edge.kind === 'child' && edge.to === node.actionId)
    ) {
      chain.push(node.actionId);
      seen.add(node.actionId);
    }
  }
  const stepX = NODE_W + gapX;
  const stepY = NODE_H + gapY;
  const perRow = Math.max(2, Math.floor((canvasWidth - 2 * pad + gapX) / stepX));
  const positions = new Map<string, { readonly x: number; readonly y: number }>();
  let row = 0;
  let col = 0;
  for (const nodeId of chain) {
    const y = pad + row * stepY + NODE_H / 2;
    positions.set(nodeId, { x: gridX(col, row, perRow, canvasWidth, pad, gapX), y });
    const parallelChildren = (childOf.get(nodeId) ?? []).filter((id) => parallelMembers.has(id));
    if (parallelChildren.length > 0) {
      const childPerRow = Math.max(1, Math.min(perRow, parallelChildren.length));
      const childRows = Math.ceil(parallelChildren.length / childPerRow);
      for (let index = 0; index < parallelChildren.length; index++) {
        const childRow = Math.floor(index / childPerRow);
        const rowStart = childRow * childPerRow;
        const rowCount = Math.min(childPerRow, parallelChildren.length - rowStart);
        positions.set(parallelChildren[index]!, {
          x: centeredGridX(index - rowStart, rowCount, canvasWidth, childGap),
          y: pad + (row + childRow + 1) * stepY + NODE_H / 2,
        });
      }
      row += childRows + 1;
      col = 0;
      continue;
    }
    col += 1;
    if (col >= perRow) {
      row += 1;
      col = 0;
    }
  }
  for (const [parentId, children] of childOf) {
    const parent = positions.get(parentId);
    if (parent === undefined) {
      continue;
    }
    const gatewayChildren = children.filter((id) => !parallelMembers.has(id));
    for (let index = 0; index < gatewayChildren.length; index++) {
      const rightX = parent.x + NODE_W + childOffset;
      positions.set(gatewayChildren[index]!, {
        x: rightX + NODE_W / 2 <= canvasWidth - pad ? rightX : Math.max(pad + NODE_W / 2, parent.x - NODE_W - childOffset),
        y: parent.y + index * (NODE_H + childGap),
      });
    }
  }
  for (const node of nodes) {
    if (!positions.has(node.actionId)) {
      positions.set(node.actionId, { x: pad + NODE_W / 2, y: pad + chain.length * stepY });
    }
  }
  return positions;
}

export function projectVisualEdges(edges: readonly GraphEdge[], batches: readonly ParallelBatch[]): readonly GraphEdge[] {
  const comboIdByNodeId = new Map(batches.flatMap((batch) => batch.nodeIds.map((nodeId) => [nodeId, batch.id] as const)));
  const projected: GraphEdge[] = [];
  const seen = new Set<string>();
  for (const edge of edges) {
    const visualEdge =
      edge.kind === 'parallel'
        ? { from: comboIdByNodeId.get(edge.from) ?? edge.from, to: comboIdByNodeId.get(edge.to) ?? edge.to, kind: 'parallel' as const }
        : edge;
    if (visualEdge.from === visualEdge.to) {
      continue;
    }
    const key = `${visualEdge.kind}:${visualEdge.from}:${visualEdge.to}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    projected.push(visualEdge);
  }
  return projected;
}

export function visualEdgeType(edge: GraphEdge): 'polyline' | 'quadratic' {
  return edge.kind === 'child' ? 'quadratic' : 'polyline';
}

export function visualEdgeAnchors(
  edge: GraphEdge,
  positions?: ReadonlyMap<string, { readonly x: number; readonly y: number }>,
): { readonly sourceAnchor?: number; readonly targetAnchor?: number } {
  if (edge.kind === 'child') {
    return {};
  }
  if (edge.kind === 'parallel') {
    return { sourceAnchor: 1, targetAnchor: 0 };
  }
  const source = positions?.get(edge.from);
  const target = positions?.get(edge.to);
  if (source !== undefined && target !== undefined && source.y === target.y) {
    return source.x < target.x ? { sourceAnchor: 2, targetAnchor: 3 } : { sourceAnchor: 3, targetAnchor: 2 };
  }
  return { sourceAnchor: 1, targetAnchor: 0 };
}

function gridX(col: number, row: number, perRow: number, canvasWidth: number, pad: number, gapX: number): number {
  const visualCol = row % 2 === 0 ? col : perRow - 1 - col;
  const usedWidth = perRow * NODE_W + (perRow - 1) * gapX;
  return Math.max(pad, (canvasWidth - usedWidth) / 2) + visualCol * (NODE_W + gapX) + NODE_W / 2;
}

function centeredGridX(col: number, count: number, canvasWidth: number, gapX: number): number {
  const usedWidth = count * NODE_W + (count - 1) * gapX;
  return Math.max(0, (canvasWidth - usedWidth) / 2) + col * (NODE_W + gapX) + NODE_W / 2;
}
