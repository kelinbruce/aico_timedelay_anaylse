import type { ModelProfile } from '@nextagent/agent-contracts/app';
import type { ContextAssemblyRequest } from '@nextagent/agent-contracts/context';
import { describe, expect, expectTypeOf, it } from 'vitest';

describe('model profile context window contract', () => {
  it('allows the canonical child profile to carry a provider-resolved context window', () => {
    const profile: ModelProfile = {
      modelId: 'compatible-model',
      contextWindowTokens: 128_000,
      fallbackEligible: false,
    };

    expectTypeOf<ModelProfile['contextWindowTokens']>().toEqualTypeOf<number | undefined>();
    expect(profile.contextWindowTokens).toBe(128_000);
  });

  it('does not put model window or selected model authority on ContextAssemblyRequest', () => {
    type RequestKeys = keyof ContextAssemblyRequest;
    type AssertNotIn<K extends string> = K extends RequestKeys ? never : K;
    const absent: [AssertNotIn<'contextWindowTokens'>, AssertNotIn<'window'>, AssertNotIn<'availableInputUnits'>, AssertNotIn<'modelConfiguration'>] =
      ['contextWindowTokens', 'window', 'availableInputUnits', 'modelConfiguration'];

    expect(absent).toHaveLength(4);
  });
});
