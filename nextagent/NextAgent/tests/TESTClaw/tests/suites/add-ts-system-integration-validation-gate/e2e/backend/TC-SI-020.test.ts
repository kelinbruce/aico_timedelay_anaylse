/** E2E rationale: verify a disabled capability is rejected by the packed product path. */
import { describe, it } from 'vitest';
import { runRemainingFixedCase } from '../../helpers/remaining-fixed-black-box.js';
describe('TC-SI-020 disabled capability', () => {
  it('TC-SI-020', async () => runRemainingFixedCase('TC-SI-020'), 180_000);
});
