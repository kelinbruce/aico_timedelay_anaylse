/**
 * E2E Case: candidate process restart recovery.
 * Risk: Persisted session truth may be lost or unusable after a real process restart.
 * Design Rationale: Requires two independent candidate processes over one real SQLite package state.
 * Entry: Packaged start script and Web HTTP API.
 * Cross-module path: process -> gateway-local -> runtime -> channel -> restored history.
 * Untestable node: Real subprocess, network and filesystem.
 * Source deps: packed candidate public entrypoints.
 */
import { describe, it } from 'vitest';
import { runRuntimePackageCase } from '../../helpers/runtime-package-black-box.js';

describe('TC-SI-030 candidate restart recovery', () => {
  it('TC-SI-030', async () => runRuntimePackageCase('TC-SI-030'), 180_000);
});
