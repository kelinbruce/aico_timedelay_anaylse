/**
 * E2E Case: manifest layout and evidence integrity.
 * Risk: A manifest may declare missing, escaping or internally inconsistent evidence references.
 * Design Rationale: Requires an extracted candidate after a real startup generated execution proofs.
 * Entry: Candidate manifest and declared deployment module.
 * Cross-module path: manifest -> layout validator -> runtime proofs -> candidate evidence.
 * Untestable node: Real package filesystem and runtime lifecycle.
 * Source deps: packed candidate manifest-declared entrypoint.
 */
import { describe, it } from 'vitest';
import { runRuntimePackageCase } from '../../helpers/runtime-package-black-box.js';

describe('TC-SI-035 candidate evidence integrity', () => {
  it('TC-SI-035', async () => runRuntimePackageCase('TC-SI-035'), 120_000);
});
