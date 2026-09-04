/**
 * E2E Case: TC-SI-086 disabled Tool remains hidden.
 * Risk: The packaged product may diverge across model, capability, runtime, persistence and public projection boundaries.
 * Design Rationale: Requires a real candidate process, provider HTTP stream and governed capability side effect.
 * Entry: Web HTTP submit.
 * Cross-module path: HTTP -> runtime/core -> model tool_calls -> capability -> stream/history/filesystem.
 * Untestable node: Real subprocess, network and filesystem or pending state.
 * Source deps: packed candidate public Web and capability contracts.
 */
import { describe, it } from 'vitest';
import { runCapabilityCase } from '../../helpers/capability-black-box.js';

describe('TC-SI-086 disabled Tool remains hidden', () => {
  it('TC-SI-086', async () => runCapabilityCase('TC-SI-086'), 180_000);
});
