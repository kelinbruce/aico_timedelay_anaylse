/**
 * Design-only test-first skeleton. This directory is not discovered by TestClaw.
 * Rationale: adapter fixtures do not prove real HTTP framing, schema rejection,
 * trusted metadata propagation, Workflow input separation, cancellation and
 * safe error mapping together.
 */
import { describe, it } from 'vitest';

describe('TC-SI-113 remote gateways loopback', () => {
  it('combines packed gateway exports with real loopback remote services', async () => {
    // Target branches: normal, invalid schema, scope override, input separation,
    // safe remote failure and cancellation.
    throw new Error('Design skeleton: move into tests/suites and implement TC-SI-113');
  });
});
