/** E2E rationale: resolve and execute a packaged Agent recipe through Workflow. */
import { describe, it } from 'vitest';
import { runRemainingFixedCase } from '../../helpers/remaining-fixed-black-box.js';
describe('TC-SI-040 workflow routing', () => {
  it('TC-SI-040', async () => runRemainingFixedCase('TC-SI-040'), 180_000);
});
