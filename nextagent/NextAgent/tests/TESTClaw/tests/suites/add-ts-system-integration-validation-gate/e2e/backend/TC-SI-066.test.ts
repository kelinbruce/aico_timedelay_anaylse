/** E2E rationale: validate TC-SI-066 through an isolated packed candidate and its public product boundaries. */
import { describe, it } from 'vitest';
import { runRemainingBackendCase } from '../../helpers/remaining-backend-black-box.js';
describe('TC-SI-066 packed backend path', () => {
  it('TC-SI-066', async () => runRemainingBackendCase('TC-SI-066'), 180_000);
});
