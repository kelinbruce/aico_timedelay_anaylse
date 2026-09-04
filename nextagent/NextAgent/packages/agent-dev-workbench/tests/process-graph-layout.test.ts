import { describe, expect, it } from 'vitest';
import { projectVisualEdges, visualEdgeAnchors, visualEdgeType, wrapLayout } from '../web/src/process-graph-layout.js';

const nodeWidth = 210;
const nodeHeight = 50;

describe('process graph parallel layout', () => {
  it.each([
    { size: 2, width: 560 },
    { size: 5, width: 900 },
    { size: 8, width: 720 },
  ])('keeps a $size-call parallel block bounded and non-overlapping at $width px', ({ size, width }) => {
    const fixture = parallelFixture(size);
    const positions = wrapLayout(fixture.nodes, fixture.edges, width);

    expect(positions.size).toBe(fixture.nodes.length);
    for (const position of positions.values()) {
      expect(position.x - nodeWidth / 2).toBeGreaterThanOrEqual(0);
      expect(position.x + nodeWidth / 2).toBeLessThanOrEqual(width);
    }
    const entries = [...positions.entries()];
    for (let left = 0; left < entries.length; left++) {
      for (let right = left + 1; right < entries.length; right++) {
        expect(overlaps(entries[left]![1], entries[right]![1])).toBe(false);
      }
    }

    const members = Array.from({ length: size }, (_, index) => positions.get(`tool-${index + 1}`)!);
    const source = positions.get('model')!;
    const join = positions.get('terminal')!;
    expect(positions.get('request')!.y).toBe(source.y);
    expect(positions.get('request')!.x).not.toBe(source.x);
    expect(Math.min(...members.map((position) => position.y))).toBeGreaterThan(source.y);
    expect(join.y).toBeGreaterThan(Math.max(...members.map((position) => position.y)));
  });

  it.each([2, 5, 8])('collapses %i member-level routes to two group-level edges', (size) => {
    const fixture = parallelFixture(size);
    const visualEdges = projectVisualEdges(fixture.edges, [
      {
        id: 'parallel-batch-1',
        size,
        nodeIds: Array.from({ length: size }, (_, index) => `tool-${index + 1}`),
      },
    ]);
    const positions = wrapLayout(fixture.nodes, fixture.edges, 560);
    expect(visualEdges).toEqual([
      { from: 'request', to: 'model', kind: 'sequence' },
      { from: 'model', to: 'parallel-batch-1', kind: 'parallel' },
      { from: 'parallel-batch-1', to: 'terminal', kind: 'parallel' },
    ]);
    expect(visualEdges.some((edge) => edge.from.startsWith('tool-') || edge.to.startsWith('tool-'))).toBe(false);
    expect(visualEdges.map((edge) => visualEdgeType(edge))).toEqual(['polyline', 'polyline', 'polyline']);
    expect(visualEdges.map((edge) => visualEdgeAnchors(edge, positions))).toEqual([
      { sourceAnchor: 2, targetAnchor: 3 },
      { sourceAnchor: 1, targetAnchor: 0 },
      { sourceAnchor: 1, targetAnchor: 0 },
    ]);
  });
});

function parallelFixture(size: number) {
  const nodes = [node('request'), node('model'), ...Array.from({ length: size }, (_, index) => parallelNode(index + 1, size)), node('terminal')];
  const edges = [
    { from: 'request', to: 'model', kind: 'sequence' as const },
    ...Array.from({ length: size }, (_, index) => ({ from: 'model', to: `tool-${index + 1}`, kind: 'parallel' as const })),
    ...Array.from({ length: size }, (_, index) => ({ from: `tool-${index + 1}`, to: 'terminal', kind: 'parallel' as const })),
  ];
  return { nodes, edges };
}

function node(actionId: string) {
  return { actionId, type: 'model', label: actionId, status: 'completed', refs: {}, detailAvailability: { status: 'available' } };
}

function parallelNode(ordinal: number, size: number) {
  return {
    ...node(`tool-${ordinal}`),
    type: 'capability',
    refs: { toolBatchExecutionMode: 'PARALLEL', toolBatchOrdinal: ordinal, toolBatchSize: size },
  };
}

function overlaps(left: { readonly x: number; readonly y: number }, right: { readonly x: number; readonly y: number }): boolean {
  return Math.abs(left.x - right.x) < nodeWidth && Math.abs(left.y - right.y) < nodeHeight;
}
