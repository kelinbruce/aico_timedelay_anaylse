import { describe, expect, it, vi } from 'vitest';
import { createCompositionFailureScope } from '../src/composition/composition-failure-scope.js';

describe('composition failure scope', () => {
  it('triggers sync cleanup in reverse order at most once and absorbs failures', () => {
    const order: string[] = [];
    const scope = createCompositionFailureScope();
    scope.register('first', () => {
      order.push('first');
    });
    scope.register('rejecting', () => {
      order.push('rejecting');
      return Promise.reject(new Error('cleanup unavailable'));
    });
    scope.register('throwing', () => {
      order.push('throwing');
      throw new Error('cleanup failed');
    });

    expect(() => scope.rollbackSync()).not.toThrow();
    scope.rollbackSync();

    expect(order).toEqual(['throwing', 'rejecting', 'first']);
    expect(() => scope.register('late', () => {})).toThrow('only be registered while');
  });

  it('awaits async cleanup sequentially in reverse order and preserves progress after rejection', async () => {
    const order: string[] = [];
    const scope = createCompositionFailureScope();
    scope.register('first', async () => {
      order.push('first');
    });
    scope.register('second', async () => {
      order.push('second:start');
      await Promise.resolve();
      order.push('second:end');
      throw new Error('ignored');
    });
    scope.register('third', async () => {
      order.push('third');
    });

    await expect(scope.rollbackAsync()).resolves.toBeUndefined();
    await scope.rollbackAsync();

    expect(order).toEqual(['third', 'second:start', 'second:end', 'first']);
  });

  it('drops rollback ownership after commit and rejects a duplicate commit', async () => {
    const cleanup = vi.fn();
    const scope = createCompositionFailureScope();
    scope.register('owned', cleanup);

    scope.commit();
    scope.rollbackSync();
    await scope.rollbackAsync();

    expect(cleanup).not.toHaveBeenCalled();
    expect(() => scope.commit()).toThrow('only be committed once');
  });
});
