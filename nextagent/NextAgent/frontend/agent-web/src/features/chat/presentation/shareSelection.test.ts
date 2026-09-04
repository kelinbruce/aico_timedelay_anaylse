import { describe, expect, it } from 'vitest';
import { selectAllShareable, toggleShareSelection } from './shareSelection.ts';
import { SHARE_RUN_IDS_MAX_ITEMS } from '../../../constants/inputLimits.ts';

describe('toggleShareSelection', () => {
  it('adds a new runId when below the limit', () => {
    const prev = new Set(['r1', 'r2']);
    const result = toggleShareSelection(prev, 'r3');
    expect(result.rejected).toBe(false);
    expect(result.next.has('r3')).toBe(true);
    expect(result.next.size).toBe(3);
  });

  it('removes an already-selected runId (deselection always works)', () => {
    const prev = new Set(['r1', 'r2']);
    const result = toggleShareSelection(prev, 'r1');
    expect(result.rejected).toBe(false);
    expect(result.next.has('r1')).toBe(false);
    expect(result.next.size).toBe(1);
  });

  it('rejects the 101st addition when 100 are already selected', () => {
    const prev = new Set(Array.from({ length: 100 }, (_, i) => `r${i}`));
    const result = toggleShareSelection(prev, 'r100-extra');
    expect(result.rejected).toBe(true);
    expect(result.next.size).toBe(100);
    expect(result.next.has('r100-extra')).toBe(false);
  });

  it('still allows deselection at the limit', () => {
    const prev = new Set(Array.from({ length: 100 }, (_, i) => `r${i}`));
    const result = toggleShareSelection(prev, 'r0');
    expect(result.rejected).toBe(false);
    expect(result.next.size).toBe(99);
  });

  it('does not mutate the input set', () => {
    const prev = new Set(['r1']);
    const snapshot = new Set(prev);
    toggleShareSelection(prev, 'r2');
    expect(prev).toEqual(snapshot);
  });

  it('respects a custom maxItems', () => {
    const prev = new Set(['r1', 'r2']);
    const result = toggleShareSelection(prev, 'r3', 2);
    expect(result.rejected).toBe(true);
    expect(result.next.size).toBe(2);
  });

  it('uses SHARE_RUN_IDS_MAX_ITEMS as default', () => {
    expect(SHARE_RUN_IDS_MAX_ITEMS).toBe(100);
    const prev = new Set(Array.from({ length: SHARE_RUN_IDS_MAX_ITEMS - 1 }, (_, i) => `r${i}`));
    const result = toggleShareSelection(prev, 'last');
    expect(result.rejected).toBe(false);
    expect(result.next.size).toBe(SHARE_RUN_IDS_MAX_ITEMS);
  });
});

describe('selectAllShareable', () => {
  it('selects all when within the limit', () => {
    const selectable = ['r1', 'r2', 'r3'];
    const result = selectAllShareable(selectable);
    expect(result.truncated).toBe(false);
    expect(result.next.size).toBe(3);
  });

  it('truncates to maxItems when selectable exceeds the limit', () => {
    const selectable = Array.from({ length: 120 }, (_, i) => `r${i}`);
    const result = selectAllShareable(selectable);
    expect(result.truncated).toBe(true);
    expect(result.next.size).toBe(100);
  });

  it('selects exactly maxItems when selectable equals the limit', () => {
    const selectable = Array.from({ length: 100 }, (_, i) => `r${i}`);
    const result = selectAllShareable(selectable);
    expect(result.truncated).toBe(false);
    expect(result.next.size).toBe(100);
  });

  it('selects all for an empty set', () => {
    const result = selectAllShareable([]);
    expect(result.truncated).toBe(false);
    expect(result.next.size).toBe(0);
  });

  it('respects a custom maxItems', () => {
    const selectable = ['r1', 'r2', 'r3', 'r4', 'r5'];
    const result = selectAllShareable(selectable, 3);
    expect(result.truncated).toBe(true);
    expect(result.next.size).toBe(3);
  });

  it('preserves input order in the truncated set', () => {
    const selectable = Array.from({ length: 120 }, (_, i) => `r${i}`);
    const result = selectAllShareable(selectable);
    const items = [...result.next];
    expect(items[0]).toBe('r0');
    expect(items[99]).toBe('r99');
  });
});
