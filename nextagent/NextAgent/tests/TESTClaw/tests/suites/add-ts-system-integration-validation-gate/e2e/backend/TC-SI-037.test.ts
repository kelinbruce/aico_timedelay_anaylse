/** E2E rationale: store and recall long-term memory through model tool calls and a later HTTP request. */
import { describe, it } from 'vitest';
import { runRemainingFixedCase } from '../../helpers/remaining-fixed-black-box.js';
describe('TC-SI-037 long-term memory', () => {
  it('TC-SI-037', async () => runRemainingFixedCase('TC-SI-037'), 180_000);
});
