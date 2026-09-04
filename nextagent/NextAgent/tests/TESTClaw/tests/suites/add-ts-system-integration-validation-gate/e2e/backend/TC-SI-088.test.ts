import { describe, it } from 'vitest';
import { runRemainingBackendCase } from '../../helpers/remaining-backend-black-box.js';
describe('TC-SI-088 packed backend path', () => {
  it('TC-SI-088', async () => {
    await runRemainingBackendCase('TC-SI-088');
  }, 60_000);
});
