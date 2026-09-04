/**
 * Design-only Playwright test-first skeleton. This directory is not discovered.
 * Rationale: route fixtures can prove UI projection but cannot prove that local,
 * immersive and collaborative hosts share one real backend canonical truth.
 */
import { test } from '@playwright/test';

test('TC-SI-119 three hosts use the same real backend semantics', async () => {
  // Iterate local, immersive and collaborative inside one case result.
  // Target assertions: session, submit, SSE, pending input, active-run replay and
  // refresh recovery.
  throw new Error('Design skeleton: move into tests/suites and implement TC-SI-119');
});
