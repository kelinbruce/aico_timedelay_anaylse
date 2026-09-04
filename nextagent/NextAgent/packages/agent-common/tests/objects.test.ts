import { describe, expect, it } from 'vitest';

import { deepFreeze } from '../src/objects.js';

describe('deepFreeze', () => {
  it('freezes nested values even when the containing object is already frozen', () => {
    const nested = { value: 'mutable before traversal' };
    const value = Object.freeze({ nested });

    deepFreeze(value);

    expect(Object.isFrozen(nested)).toBe(true);
  });
});
