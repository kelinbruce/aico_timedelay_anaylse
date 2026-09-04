import type { AgentAssembly } from '@nextagent/agent-contracts/agent-assembly';
import type {
  CapabilityCatalog,
  CapabilityDescriptor,
  RuntimeCapabilityListRequest,
  RuntimeCapabilityResolveRequest,
  RuntimeCapabilityResolver,
} from '@nextagent/agent-contracts/capability';
import type { SessionId, SubjectId, TenantId } from '@nextagent/agent-common';

export function createCatalogBackedRuntimeCapabilityResolver(input: {
  readonly catalog: CapabilityCatalog;
  readonly assembly: AgentAssembly;
  readonly tenantId: TenantId;
  readonly subjectId: SubjectId;
  readonly sessionId?: SessionId;
}): RuntimeCapabilityResolver {
  async function listVisibleCapabilities(signal: AbortSignal): Promise<readonly CapabilityDescriptor[]> {
    if (signal.aborted) {
      return [];
    }
    const candidates = await input.catalog.listAvailable({
      tenantId: input.tenantId,
      subjectId: input.subjectId,
      ...(input.sessionId === undefined ? {} : { sessionId: input.sessionId }),
      agentAssembly: input.assembly,
      includeUnavailable: false,
    });
    return signal.aborted ? [] : candidates;
  }
  return {
    async resolveCapability(request: RuntimeCapabilityResolveRequest, signal: AbortSignal): Promise<CapabilityDescriptor | undefined> {
      if (signal.aborted) {
        return undefined;
      }
      const candidate = await input.catalog.resolve({
        tenantId: input.tenantId,
        subjectId: input.subjectId,
        ...(input.sessionId === undefined ? {} : { sessionId: input.sessionId }),
        agentAssembly: input.assembly,
        capabilityId: request.capabilityId,
      });
      if (
        signal.aborted ||
        candidate === undefined ||
        candidate.kind !== request.kind ||
        candidate.availabilityStatus !== 'AVAILABLE' ||
        (request.providerId !== undefined && candidate.provider.providerId !== request.providerId)
      ) {
        return undefined;
      }
      return candidate;
    },
    async listCapabilities(request: RuntimeCapabilityListRequest, signal: AbortSignal): Promise<readonly CapabilityDescriptor[]> {
      return (await listVisibleCapabilities(signal)).filter(
        (candidate) =>
          (request.kind === undefined || candidate.kind === request.kind) &&
          candidate.availabilityStatus === 'AVAILABLE' &&
          matchesModelInvocable(candidate, request.modelInvocable),
      );
    },
  };
}

function matchesModelInvocable(descriptor: CapabilityDescriptor, modelInvocable?: boolean): boolean {
  if (modelInvocable === undefined) {
    return true;
  }
  return modelInvocable ? descriptor.modelInvocable === true : descriptor.modelInvocable !== true;
}
