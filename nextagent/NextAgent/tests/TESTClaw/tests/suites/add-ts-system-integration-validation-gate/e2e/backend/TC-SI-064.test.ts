/** E2E rationale: validate TC-SI-064 through an isolated packed candidate and its public product boundaries. */
import { describe, it } from 'vitest';
import { runRemainingBackendCase } from '../../helpers/remaining-backend-black-box.js';
describe('TC-SI-064 packed backend path', () => {
  it('TC-SI-064', async () => runRemainingBackendCase('TC-SI-064'), 180_000);
});
