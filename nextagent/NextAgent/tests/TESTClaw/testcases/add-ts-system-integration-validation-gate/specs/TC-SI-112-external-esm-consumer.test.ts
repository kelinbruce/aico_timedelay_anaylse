/**
 * Design-only test-first skeleton. This directory is not discovered by TestClaw.
 * Rationale: source guards cannot prove that an external ESM TypeScript consumer
 * resolves the packed declarations and runtime exports without private paths.
 * Implementation target:
 * tests/suites/add-ts-system-integration-validation-gate/integration/
 */
import { describe, it } from 'vitest';

describe('TC-SI-112 external ESM consumer', () => {
  it('builds and imports a temporary consumer using only packed public exports', async () => {
    // Target assertions include private-subpath and declaration/runtime mismatch negatives.
    throw new Error('Design skeleton: move into tests/suites and implement TC-SI-112');
  });
});
