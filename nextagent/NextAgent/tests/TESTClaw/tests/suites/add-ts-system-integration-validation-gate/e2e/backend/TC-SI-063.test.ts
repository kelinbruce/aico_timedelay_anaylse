/** E2E rationale: validate TC-SI-063 through an isolated packed candidate and its public product boundaries. */
import { describe, it } from 'vitest';
import { runRemainingBackendCase } from '../../helpers/remaining-backend-black-box.js';
describe('TC-SI-063 packed backend path', () => {
  it('TC-SI-063', async () => runRemainingBackendCase('TC-SI-063'), 180_000);
});
