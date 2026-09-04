/**
 * E2E Case: unauthenticated request creates no user data.
 * Risk: Authentication rejection may occur after persistence or model side effects.
 * Design Rationale: Requires real auth middleware, runtime persistence and a process restart to inspect durable truth.
 * Entry: Web HTTP submit.
 * Cross-module path: HTTP -> auth -> runtime acceptance -> SQLite.
 * Untestable node: Real subprocess, network and filesystem.
 * Source deps: packed candidate public Web API.
 */
import { describe, it } from 'vitest';
import { runSecurityCase } from '../../helpers/security-black-box.js';

describe('TC-SI-024 unauthenticated safety', () => {
  it('TC-SI-024', async () => runSecurityCase('TC-SI-024'), 180_000);
});
