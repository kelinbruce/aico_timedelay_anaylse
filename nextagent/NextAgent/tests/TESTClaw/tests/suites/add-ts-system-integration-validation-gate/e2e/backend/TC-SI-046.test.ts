/** E2E rationale: validate TC-SI-046 through an isolated packed candidate and its public product boundaries. */
import { describe, it } from 'vitest';
import { runRemainingBackendCase } from '../../helpers/remaining-backend-black-box.js';
describe('TC-SI-046 packed backend path', () => {
  it('TC-SI-046', async () => runRemainingBackendCase('TC-SI-046'), 180_000);
});
