/** E2E rationale: create and read a scoped conversation share through public endpoints. */
import { describe, it } from 'vitest';
import { runRemainingFixedCase } from '../../helpers/remaining-fixed-black-box.js';
describe('TC-SI-041 conversation share', () => {
  it('TC-SI-041', async () => runRemainingFixedCase('TC-SI-041'), 180_000);
});
