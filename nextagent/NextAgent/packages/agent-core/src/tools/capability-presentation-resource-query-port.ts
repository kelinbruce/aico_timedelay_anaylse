import type { AgentAssemblyRegistry } from '@nextagent/agent-contracts/agent-assembly';
import type { CapabilityCurrentViewPort } from '@nextagent/agent-contracts/capability';
import type { CapabilityPresentationResource, CapabilityPresentationResourceQueryPort } from '@nextagent/agent-contracts/runtime';

export interface CapabilityPresentationResourceQueryPortOptions {
  readonly assemblyRegistry: AgentAssemblyRegistry;
  readonly currentView: CapabilityCurrentViewPort;
}

export function createCapabilityPresentationResourceQueryPort(
  options: CapabilityPresentationResourceQueryPortOptions,
): CapabilityPresentationResourceQueryPort {
  return {
    async listResources(request, signal) {
      const assembly = await options.assemblyRegistry.active(request.agentId);
      signal.throwIfAborted();
      const descriptors = await options.currentView.listCurrent(
        {
          tenantId: request.identityContext.tenantId,
          subjectId: request.identityContext.subjectId,
          sessionId: request.sessionId,
          agentAssembly: assembly,
        },
        signal,
      );
      const resources: CapabilityPresentationResource[] = descriptors.map((descriptor) => ({
        capabilityKind: descriptor.kind,
        capabilityId: descriptor.capabilityId,
        displayName: descriptor.displayName,
        ...(descriptor.locales === undefined ? {} : { locales: descriptor.locales }),
      }));
      resources.sort((left, right) => {
        const kindOrder = left.capabilityKind.localeCompare(right.capabilityKind);
        return kindOrder === 0 ? left.capabilityId.localeCompare(right.capabilityId) : kindOrder;
      });
      return { resources };
    },
  };
}
