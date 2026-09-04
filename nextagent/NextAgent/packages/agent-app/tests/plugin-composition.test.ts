import { describe, expect, it } from 'vitest';
import { createAppCredentialResolver } from '../src/config/env.js';
import { resolveDefaultSystemConfig } from '../src/config/system-config.js';
import { preloadPluginCompositionAsync, preloadPluginCompositionSync } from '../src/composition/plugin-composition.js';

describe('plugin composition preload', () => {
  it('returns the same frozen empty composition shape for sync and async preparation', async () => {
    const systemConfig = resolveDefaultSystemConfig({
      cwd: process.cwd(),
      credentialResolver: testCredentialResolver(),
    });

    const syncComposition = preloadPluginCompositionSync({ systemConfig });
    const asyncComposition = await preloadPluginCompositionAsync({ systemConfig });

    expect(syncComposition).toEqual(asyncComposition);
    expect(Object.isFrozen(syncComposition)).toBe(true);
    expect(Object.isFrozen(asyncComposition)).toBe(true);
    expect(Object.isFrozen(syncComposition.snapshot)).toBe(true);
  });

  it('preserves one injected snapshot and projects each consumer facet without reloading', async () => {
    const systemConfig = resolveDefaultSystemConfig({
      cwd: process.cwd(),
      credentialResolver: testCredentialResolver(),
    });
    const snapshot = Object.freeze({
      plugins: Object.freeze([]),
      providers: Object.freeze([]),
      policies: Object.freeze([]),
      hooks: Object.freeze([]),
      diagnostics: Object.freeze([]),
    });

    const syncComposition = preloadPluginCompositionSync({ systemConfig, injectedSnapshot: snapshot });
    const asyncComposition = await preloadPluginCompositionAsync({ systemConfig, injectedSnapshot: snapshot });

    for (const composition of [syncComposition, asyncComposition]) {
      expect(composition.snapshot).toBe(snapshot);
      expect(composition.lifecycleHooks).toBe(snapshot.hooks);
      expect(composition.assemblyAndRequestPolicies).toBe(snapshot.policies);
      expect(composition.capabilityProviders).toBe(snapshot.providers);
      expect(composition.diagnostics).toBe(snapshot.diagnostics);
    }
  });
});

function testCredentialResolver() {
  return createAppCredentialResolver({
    OPENAI_API_KEY: 'test-only',
    OPENAI_MODEL_NAME: 'MiniMax-M2.7-highspeed',
    OPENAI_BASE_URL: 'https://api.minimaxi.com/v1',
  });
}
