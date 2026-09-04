import { describe, expect, it } from 'vitest';
import {
  GRAPH_CHAT_MIN_WIDTH,
  GRAPH_DETAIL_DEFAULT_WIDTH,
  GRAPH_DETAIL_MIN_WIDTH,
  GRAPH_RESIZE_HANDLE_WIDTH,
  clampGraphDetailWidth,
  readGraphDetailMaxWidth,
  shouldUseGraphDrawer,
} from '../src/features/run-graph/graphDetailLayout.ts';

describe('graph detail layout', () => {
  it('clamps graph detail width to the available chat split range', () => {
    const containerWidth = GRAPH_CHAT_MIN_WIDTH + GRAPH_DETAIL_DEFAULT_WIDTH + GRAPH_RESIZE_HANDLE_WIDTH;

    expect(clampGraphDetailWidth(100, containerWidth)).toBe(GRAPH_DETAIL_MIN_WIDTH);
    expect(clampGraphDetailWidth(10_000, containerWidth)).toBe(readGraphDetailMaxWidth(containerWidth));
  });

  it('uses drawer mode when the split cannot satisfy chat and detail minimum widths', () => {
    expect(shouldUseGraphDrawer(GRAPH_CHAT_MIN_WIDTH + GRAPH_DETAIL_MIN_WIDTH + GRAPH_RESIZE_HANDLE_WIDTH - 1)).toBe(true);
    expect(shouldUseGraphDrawer(GRAPH_CHAT_MIN_WIDTH + GRAPH_DETAIL_MIN_WIDTH + GRAPH_RESIZE_HANDLE_WIDTH)).toBe(false);
  });
});
