/** E2E rationale: prove persisted conversation facts have no public mutation path. */
import { describe, it } from 'vitest';
import { runRemainingFixedCase } from '../../helpers/remaining-fixed-black-box.js';
describe('TC-SI-021 immutable facts', () => {
  it('TC-SI-021', async () => runRemainingFixedCase('TC-SI-021'), 180_000);
});
