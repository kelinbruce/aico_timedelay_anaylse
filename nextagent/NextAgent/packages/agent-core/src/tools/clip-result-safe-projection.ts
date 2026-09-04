import { CLIP_STREAM_RESULT_PROJECTION_KIND, type JsonObject } from '@nextagent/agent-common';
import type { CapabilityDescriptor } from '@nextagent/agent-contracts/capability';

export function projectClipCapabilityResultClassifierFields(descriptor: CapabilityDescriptor): JsonObject {
  return descriptor.provider.providerKind === 'CUSTOM' && descriptor.provider.providerType === 'clip_server'
    ? { resultProjectionKind: CLIP_STREAM_RESULT_PROJECTION_KIND }
    : {};
}
