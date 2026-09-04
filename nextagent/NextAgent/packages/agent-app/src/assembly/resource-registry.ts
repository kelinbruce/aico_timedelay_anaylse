import type { CapabilityId } from '@nextagent/agent-common';
import type { ModelProfile } from '@nextagent/agent-contracts/model';
import type { CapabilityDescriptor } from '@nextagent/agent-contracts/capability';

export interface StartupResourceRegistry {
  readonly modelProfiles: readonly ModelProfile[];
  readonly capabilityDescriptors: readonly CapabilityDescriptor[];
}

export interface StartupResourceRegistryInput {
  readonly modelProfiles: readonly ModelProfile[];
  readonly capabilityDescriptors?: readonly CapabilityDescriptor[];
}

export function createStartupResourceRegistry(input: StartupResourceRegistryInput): StartupResourceRegistry {
  const capabilityDescriptors = input.capabilityDescriptors ?? [];
  assertUnique(
    input.modelProfiles.map((profile) => profile.modelId),
    'model',
  );
  assertUnique(
    capabilityDescriptors.map((descriptor) => descriptor.capabilityId),
    'capability',
  );
  return { ...input, capabilityDescriptors };
}

function assertUnique(values: ReadonlyArray<string | CapabilityId>, label: string): void {
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) {
      throw new Error(`Duplicate ${label} id: ${value}.`);
    }
    seen.add(value);
  }
}
