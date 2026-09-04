/**
 * Design-only test-first skeleton. This directory is not discovered by TestClaw.
 * Rationale: invalid remote data, remote failure, timeout and active cancellation
 * must each converge to at most one safe terminal with stream/history/replay consistency.
 */
import { describe, it } from 'vitest';

describe('TC-SI-118 remote failure and cancellation', () => {
  it('maps invalid responses, remote failures, timeout and cancellation to one safe terminal', async () => {
    // Each branch must preserve cancellation propagation and stream/history/replay
    // consistency without raw remote or trusted-scope leakage.
    throw new Error('Design skeleton: move into tests/suites and implement TC-SI-118');
  });
});
