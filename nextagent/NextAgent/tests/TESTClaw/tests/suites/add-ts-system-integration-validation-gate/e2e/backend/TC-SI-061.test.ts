/** E2E rationale: validate TC-SI-061 through an isolated packed candidate and its public product boundaries. */
import { describe, it } from 'vitest';
import { runRemainingBackendCase } from '../../helpers/remaining-backend-black-box.js';
describe('TC-SI-061 packed backend path', () => {
  it('TC-SI-061', async () => runRemainingBackendCase('TC-SI-061'), 180_000);
});
