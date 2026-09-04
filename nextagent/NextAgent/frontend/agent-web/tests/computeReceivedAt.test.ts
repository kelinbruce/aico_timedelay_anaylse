// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { computeReceivedAt, clearReceivedAtTimestamp } from '../src/features/chat/hooks/useChatSessionStream.ts';

describe('computeReceivedAt page-refresh resilience', () => {
  afterEach(() => {
    sessionStorage.clear();
    vi.useRealTimers();
  });

  it('returns performance.now() on first receive and stores wall-clock time', () => {
    vi.useFakeTimers({ toFake: ['Date', 'performance'] });
    vi.setSystemTime(new Date('2026-04-19T10:00:00.000Z'));

    const result = computeReceivedAt('input-1');

    // Should be approximately performance.now() (0 at page load)
    expect(result).toBe(0);

    // sessionStorage should have a wall-clock entry
    const stored = sessionStorage.getItem('nextagent:userInput:receivedAt:input-1');
    expect(stored).toBe(String(Date.parse('2026-04-19T10:00:00.000Z')));
  });

  it('adjusts receivedAt backwards by elapsed wall-clock time on replay (page refresh)', () => {
    vi.useFakeTimers({ toFake: ['Date', 'performance'] });
    vi.setSystemTime(new Date('2026-04-19T10:00:00.000Z'));

    // First receive — stores wall-clock time
    computeReceivedAt('input-1');

    // Simulate 10 minutes passing, then page refresh
    // (performance.now() resets to ~0, but wall-clock advanced 10 min)
    vi.setSystemTime(new Date('2026-04-19T10:10:00.000Z'));

    // Simulate new page load — performance.now() starts at 0 again
    // We can't easily reset performance.now() in vitest, but computeReceivedAt
    // reads performance.now() at call time, so we verify the adjustment via
    // the formula: receivedAt = performance.now() - elapsed
    const elapsedMs = 10 * 60 * 1000; // 10 minutes
    const currentPerfNow = performance.now();

    const result = computeReceivedAt('input-1');

    // receivedAt should be adjusted: performance.now() - 10min elapsed
    expect(result).toBeCloseTo(currentPerfNow - elapsedMs, -2);

    // The countdown formula: timeoutDurationMs - (performance.now() - receivedAt)
    // = 30min - (performance.now() - (performance.now() - 10min))
    // = 30min - 10min = 20min remaining (correct!)
    const timeoutDurationMs = 30 * 60 * 1000;
    const remaining = timeoutDurationMs - (performance.now() - result);
    const remainingMinutes = Math.floor(remaining / 60000);
    expect(remainingMinutes).toBe(20);
  });

  it('clamps negative elapsed time to zero (clock moved backward)', () => {
    vi.useFakeTimers({ toFake: ['Date', 'performance'] });
    vi.setSystemTime(new Date('2026-04-19T10:10:00.000Z'));

    // First receive
    computeReceivedAt('input-1');

    // Clock moves backward
    vi.setSystemTime(new Date('2026-04-19T10:00:00.000Z'));

    const result = computeReceivedAt('input-1');

    // Elapsed would be negative (-10min), clamped to 0
    // receivedAt = performance.now() - 0 = performance.now()
    const currentPerfNow = performance.now();
    expect(result).toBeCloseTo(currentPerfNow, -2);
  });

  it('clearReceivedAtTimestamp removes the stored entry', () => {
    computeReceivedAt('input-1');
    expect(sessionStorage.getItem('nextagent:userInput:receivedAt:input-1')).not.toBeNull();

    clearReceivedAtTimestamp('input-1');
    expect(sessionStorage.getItem('nextagent:userInput:receivedAt:input-1')).toBeNull();
  });

  it('returns performance.now() when sessionStorage is unavailable', () => {
    // Simulate sessionStorage being unavailable
    const originalGetItem = sessionStorage.getItem;
    const originalSetItem = sessionStorage.setItem;
    sessionStorage.getItem = () => {
      throw new Error('unavailable');
    };
    sessionStorage.setItem = () => {
      throw new Error('unavailable');
    };

    try {
      const result = computeReceivedAt('input-2');
      const currentPerfNow = performance.now();
      // Should fall back to performance.now()
      expect(result).toBeCloseTo(currentPerfNow, -2);
    } finally {
      sessionStorage.getItem = originalGetItem;
      sessionStorage.setItem = originalSetItem;
    }
  });
});
