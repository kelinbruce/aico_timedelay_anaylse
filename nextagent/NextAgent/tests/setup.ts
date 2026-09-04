import { cleanupNextAgentTestApps } from '@nextagent/agent-app/testing';
import { afterEach } from 'vitest';

afterEach(async () => {
  await cleanupNextAgentTestApps();
});
