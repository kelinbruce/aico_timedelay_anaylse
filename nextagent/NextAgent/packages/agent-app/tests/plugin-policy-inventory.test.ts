import { describe, expect, it } from 'vitest';
import { OPEN_POLICY_INVENTORY } from '@nextagent/agent-plugin-sdk';
import { loadPluginRegistrySnapshot } from '../src/plugin/plugin-loader.js';
import { createPluginFixture, pluginWithPolicySource } from './plugin-test-helpers.js';

describe('plugin policy inventory', () => {
  it('keeps only agentRoutingPolicy open and marks future policy points reserved', () => {
    expect(OPEN_POLICY_INVENTORY.map((entry) => [entry.policyPointId, entry.status])).toEqual([
      ['agentRoutingPolicy', 'OPEN'],
      ['restrictedOperationPolicy', 'RESERVED'],
      ['modelSelectionPolicy', 'RESERVED'],
      ['modelFallbackPolicy', 'RESERVED'],
      ['contextWindowPolicy', 'RESERVED'],
    ]);
  });

  it('accepts agentRoutingPolicy and rejects reserved or closed policy points', async () => {
    const open = createPluginFixture({
      source: pluginWithPolicySource('telecom', 'agentRoutingPolicy'),
    });
    const snapshot = await loadPluginRegistrySnapshot([open.entry], open.root);
    expect(snapshot.policies).toHaveLength(1);

    for (const reserved of ['restrictedOperationPolicy', 'modelSelectionPolicy', 'modelFallbackPolicy', 'contextWindowPolicy']) {
      const fixture = createPluginFixture({ source: pluginWithPolicySource('telecom', reserved) });
      await expect(loadPluginRegistrySnapshot([fixture.entry], fixture.root)).rejects.toThrow('Required plugin failed');
    }

    const closed = createPluginFixture({ source: pluginWithPolicySource('telecom', 'redactionPolicy') });
    await expect(loadPluginRegistrySnapshot([closed.entry], closed.root)).rejects.toThrow('Required plugin failed');
  });
});
