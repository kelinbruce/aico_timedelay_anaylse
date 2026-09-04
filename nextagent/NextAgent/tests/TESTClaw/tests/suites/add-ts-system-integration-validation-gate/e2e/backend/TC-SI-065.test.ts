/** E2E rationale: validate TC-SI-065 through an isolated packed candidate and its public product boundaries. */
import { describe, it } from 'vitest';
import { runRemainingBackendCase } from '../../helpers/remaining-backend-black-box.js';
describe('TC-SI-065 packed backend path', () => {
  it('TC-SI-065', async () => runRemainingBackendCase('TC-SI-065'), 180_000);
});
