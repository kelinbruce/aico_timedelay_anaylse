/**
 * E2E Case: attachment rejection remains safe.
 * Risk: Unsupported attachment content may reach persistence, model context or public errors.
 * Design Rationale: Requires real multipart parsing and attachment runtime policy.
 * Entry: Web multipart upload.
 * Cross-module path: HTTP multipart -> staged upload -> attachment policy -> SafeError.
 * Untestable node: Real network and file bytes.
 * Source deps: packed candidate public attachment API.
 */
import { describe, it } from 'vitest';
import { runSecurityCase } from '../../helpers/security-black-box.js';

describe('TC-SI-025 attachment safety', () => {
  it('TC-SI-025', async () => runSecurityCase('TC-SI-025'), 120_000);
});
