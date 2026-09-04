/** E2E rationale: exercise large content through the packed HTTP, stream, persistence and readback boundaries. */
import { describe, it } from 'vitest';
import { runRemainingFixedCase } from '../../helpers/remaining-fixed-black-box.js';
describe('TC-SI-018 large content lazy readback', () => {
  it('TC-SI-018', async () => runRemainingFixedCase('TC-SI-018'), 180_000);
});
