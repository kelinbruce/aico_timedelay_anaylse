import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { brand } from '@nextagent/agent-common';
import type {
  CapabilityDescriptor,
  CapabilityInvocationRuntimeContext,
  RuntimeCapabilityResolveRequest,
  RuntimeCapabilityResolver,
} from '@nextagent/agent-contracts/capability';
import { describe, expect, it } from 'vitest';

describe('runtime capability resolver contract', () => {
  it('uses flat scheme-B request fields without CapabilityRef', async () => {
    const descriptor: CapabilityDescriptor = {
      capabilityId: brand<string, 'CapabilityId'>('network-diagnostics'),
      kind: 'SKILL',
      provider: { providerId: 'builtin-skills', providerKind: 'BUNDLED' },
      displayName: 'network-diagnostics',
      description: 'Safe network Skill.',
      availabilityStatus: 'AVAILABLE',
    };
    const request: RuntimeCapabilityResolveRequest = {
      kind: 'SKILL',
      capabilityId: descriptor.capabilityId,
      providerId: descriptor.provider.providerId,
    };
    const resolver: RuntimeCapabilityResolver = {
      async resolveCapability(input) {
        return input.kind === descriptor.kind && input.capabilityId === descriptor.capabilityId && input.providerId === descriptor.provider.providerId
          ? descriptor
          : undefined;
      },
    };
    const runtimeContext: CapabilityInvocationRuntimeContext = { capabilityResolver: resolver };

    await expect(runtimeContext.capabilityResolver?.resolveCapability(request, new AbortController().signal)).resolves.toBe(descriptor);
    expect(Object.keys(request).sort()).toEqual(['capabilityId', 'kind', 'providerId']);
    expect(readFileSync(join(process.cwd(), 'packages/agent-contracts/src/capability/index.ts'), 'utf8')).not.toContain('CapabilityRef');
  });
});
