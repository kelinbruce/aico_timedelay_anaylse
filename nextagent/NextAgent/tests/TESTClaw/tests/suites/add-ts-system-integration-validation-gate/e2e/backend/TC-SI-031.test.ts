/** E2E rationale: kill and restart a real candidate at an uncertain non-idempotent capability boundary. */
import { describe, it } from 'vitest';
import { runRemainingFixedCase } from '../../helpers/remaining-fixed-black-box.js';
describe('TC-SI-031 uncertain recovery', () => {
  it('TC-SI-031', async () => runRemainingFixedCase('TC-SI-031'), 180_000);
});
