import { describe, it } from 'vitest';
import { runRemainingBackendCase } from '../../helpers/remaining-backend-black-box.js';
describe('TC-SI-044 packed backend path', () => {
  it('TC-SI-044', async () => runRemainingBackendCase('TC-SI-044'), 120_000);
});
