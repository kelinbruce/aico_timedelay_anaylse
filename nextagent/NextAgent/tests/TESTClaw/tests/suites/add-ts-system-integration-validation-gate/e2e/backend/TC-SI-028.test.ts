/**
 * E2E Case: operational logging safety.
 * Risk: Prompt, credential or absolute path data may escape through candidate diagnostics.
 * Design Rationale: Requires a real request and the packaged file logging sink in a restricted diagnostic root.
 * Entry: Web HTTP submit and local operational JSONL.
 * Cross-module path: request -> runtime/model -> observability -> restricted file sink.
 * Untestable node: Real process and filesystem diagnostics.
 * Source deps: packed candidate public Web API and operational log contract.
 */
import { describe, it } from 'vitest';
import { runSecurityCase } from '../../helpers/security-black-box.js';

describe('TC-SI-028 audit and log safety', () => {
  it('TC-SI-028', async () => runSecurityCase('TC-SI-028'), 120_000);
});
