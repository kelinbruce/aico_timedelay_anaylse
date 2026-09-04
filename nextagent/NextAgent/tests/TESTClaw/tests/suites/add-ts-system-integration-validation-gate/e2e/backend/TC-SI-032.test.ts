/**
 * E2E Case: invalid candidate configuration fails closed.
 * Risk: A release candidate could listen or create data after configuration validation fails.
 * Design Rationale: Requires the packaged executable and its runtime proof filesystem.
 * Entry: Packaged start script.
 * Cross-module path: config parser -> readiness evaluation -> startup guard -> proof files.
 * Untestable node: Real subprocess and filesystem.
 * Source deps: packed candidate public entrypoints.
 */
import { describe, it } from 'vitest';
import { runRuntimePackageCase } from '../../helpers/runtime-package-black-box.js';

describe('TC-SI-032 invalid candidate config', () => {
  it('TC-SI-032', async () => runRuntimePackageCase('TC-SI-032'), 120_000);
});
