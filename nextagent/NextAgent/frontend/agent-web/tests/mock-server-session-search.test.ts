import { createRequire } from 'node:module';
import { afterEach, describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const store = require('../../agent-web-mock-server/data/store.js');

function resetMockStore(): void {
  store.sessions.length = 0;
  store.sessionCounter.value = 0;
  for (const registry of [
    store.sessionDetails,
    store.conversations,
    store.sseConnections,
    store.wsConnections,
    store.activeStreams,
    store.pendingInputRequests,
  ]) {
    for (const key of Object.keys(registry)) {
      delete registry[key];
    }
  }
}

describe('agent-web mock session search', () => {
  afterEach(() => {
    resetMockStore();
  });

  it('matches numeric ASCII keywords against session titles', () => {
    store.createSession('session-1', 'zh-CN');
    store.updateSessionTitle('session-1', '202607会话');

    const page = store.getSessions({ offset: 0, limit: 20, q: '202' });

    expect(page.entries.map((entry: { sessionId: string }) => entry.sessionId)).toEqual(['session-1']);
  });
});
