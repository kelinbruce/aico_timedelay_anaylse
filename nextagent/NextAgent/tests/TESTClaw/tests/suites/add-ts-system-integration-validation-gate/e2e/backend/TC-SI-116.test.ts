import { describe, it } from 'vitest';
import { runRemoteRuntimeCase } from '../../helpers/remote-runtime-black-box.js';
describe('TC-SI-116 remote runtime path', () => {
  it('TC-SI-116', async () => {
    await runRemoteRuntimeCase('TC-SI-116');
  }, 90_000);
});
