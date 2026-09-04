import { describe, it } from 'vitest';
import { runRemoteRuntimeCase } from '../../helpers/remote-runtime-black-box.js';
describe('TC-SI-115 remote runtime path', () => {
  it('TC-SI-115', async () => {
    await runRemoteRuntimeCase('TC-SI-115');
  }, 90_000);
});
