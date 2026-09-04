/** E2E rationale: validate TC-SI-067 through an isolated packed candidate and its public product boundaries. */
import { describe, it } from 'vitest';
import { runRemainingBackendCase } from '../../helpers/remaining-backend-black-box.js';
describe('TC-SI-067 packed backend path', () => {
  it('TC-SI-067', async () => runRemainingBackendCase('TC-SI-067'), 180_000);
});
