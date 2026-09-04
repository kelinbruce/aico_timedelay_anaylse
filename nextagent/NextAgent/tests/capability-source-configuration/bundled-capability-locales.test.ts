import { loadBuiltInAgentDefinition } from '@nextagent/agent-platform-gateway-local/testing';
import { describe, expect, it } from 'vitest';

describe('bundled Capability localized names', () => {
  it('publishes zh-CN and en-US names for the existing network-explorer Agent', () => {
    expect(loadBuiltInAgentDefinition('network-explorer')).toMatchObject({
      agentId: 'network-explorer',
      displayName: 'Network Explorer',
      locales: {
        language: {
          'zh-CN': { displayName: '网络探索智能体' },
          'en-US': { displayName: 'Network Explorer' },
        },
      },
    });
  });
});
