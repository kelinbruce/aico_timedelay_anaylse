import { describe, it } from 'vitest';
import { runRemoteCronCallbackCase } from '../../helpers/cron-remote-black-box.js';
describe('TC-SI-049 signed remote cron callback', () => {
  it('TC-SI-049', runRemoteCronCallbackCase, 120_000);
});
