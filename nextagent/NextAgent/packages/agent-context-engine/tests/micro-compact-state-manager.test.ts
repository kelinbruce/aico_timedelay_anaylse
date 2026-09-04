import { describe, expect, it } from 'vitest';
import {
  readMicroCompactState,
  writeMicroCompactState,
  clearMicroCompactState,
  EMPTY_MICRO_COMPACT_STATE,
} from '../src/micro-compact/state-manager.js';

describe('readMicroCompactState', () => {
  it('returns empty state for undefined metadata', () => {
    expect(readMicroCompactState(undefined)).toEqual(EMPTY_MICRO_COMPACT_STATE);
  });

  it('returns empty state when microCompactState is missing', () => {
    expect(readMicroCompactState({ otherField: true })).toEqual(EMPTY_MICRO_COMPACT_STATE);
  });

  it('returns empty state for malformed microCompactState (not object)', () => {
    expect(readMicroCompactState({ microCompactState: 'string' })).toEqual(EMPTY_MICRO_COMPACT_STATE);
  });

  it('returns empty state for malformed microCompactState (array)', () => {
    expect(readMicroCompactState({ microCompactState: [] })).toEqual(EMPTY_MICRO_COMPACT_STATE);
  });

  it('returns empty state when compactedIds is missing', () => {
    expect(readMicroCompactState({ microCompactState: {} })).toEqual(EMPTY_MICRO_COMPACT_STATE);
  });

  it('returns empty state when compactedIds is not array', () => {
    expect(readMicroCompactState({ microCompactState: { compactedIds: 'bad' } })).toEqual(EMPTY_MICRO_COMPACT_STATE);
  });

  it('filters out non-string and empty entries from compactedIds', () => {
    const state = readMicroCompactState({
      microCompactState: { compactedIds: ['a', '', 42, null, 'b', undefined] },
    });
    expect(state.compactedIds).toEqual(['a', 'b']);
  });

  it('reads valid state correctly', () => {
    const state = readMicroCompactState({
      microCompactState: { compactedIds: ['msg-1', 'msg-2', 'msg-3'] },
    });
    expect(state.compactedIds).toEqual(['msg-1', 'msg-2', 'msg-3']);
  });
});

describe('writeMicroCompactState', () => {
  it('does not mutate the original metadata', () => {
    const original = { existingField: 'value' };
    const result = writeMicroCompactState(original, { compactedIds: ['a'] });

    expect(original).toEqual({ existingField: 'value' });
    expect(result).toHaveProperty('existingField', 'value');
    expect(result).toHaveProperty('microCompactState');
  });

  it('projects state into metadata', () => {
    const result = writeMicroCompactState({ existing: true }, { compactedIds: ['msg-1', 'msg-2'] });
    expect(result).toEqual({
      existing: true,
      microCompactState: { compactedIds: ['msg-1', 'msg-2'] },
    });
  });

  it('creates a copy of compactedIds (not same reference)', () => {
    const ids = ['a', 'b'];
    const result = writeMicroCompactState({}, { compactedIds: ids });
    const written = (result.microCompactState as { compactedIds: string[] }).compactedIds;
    expect(written).toEqual(ids);
    expect(written).not.toBe(ids); // different array reference
  });
});

describe('clearMicroCompactState', () => {
  it('removes microCompactState field from metadata', () => {
    const result = clearMicroCompactState({
      existing: true,
      microCompactState: { compactedIds: ['a'] },
    });
    expect(result).toEqual({ existing: true });
    expect(result).not.toHaveProperty('microCompactState');
  });

  it('does not mutate the original metadata', () => {
    const original = {
      existing: true,
      microCompactState: { compactedIds: ['a'] },
    };
    const result = clearMicroCompactState(original);
    expect(original).toHaveProperty('microCompactState');
    expect(result).not.toHaveProperty('microCompactState');
  });

  it('handles metadata without microCompactState gracefully', () => {
    const result = clearMicroCompactState({ other: 'field' });
    expect(result).toEqual({ other: 'field' });
  });
});
