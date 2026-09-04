/** E2E rationale: discover and load an Agent-owned Skill through the real capability loop. */
import { describe, it } from 'vitest';
import { runRemainingFixedCase } from '../../helpers/remaining-fixed-black-box.js';
describe('TC-SI-038 routing Skill', () => {
  it('TC-SI-038', async () => runRemainingFixedCase('TC-SI-038'), 180_000);
});
