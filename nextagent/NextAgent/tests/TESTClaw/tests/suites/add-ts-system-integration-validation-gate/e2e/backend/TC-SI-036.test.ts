/** E2E rationale: observe packaged lifecycle extension governance through real diagnostics. */
import { describe, it } from 'vitest';
import { runRemainingFixedCase } from '../../helpers/remaining-fixed-black-box.js';
describe('TC-SI-036 extension governance', () => {
  it('TC-SI-036', async () => runRemainingFixedCase('TC-SI-036'), 180_000);
});
