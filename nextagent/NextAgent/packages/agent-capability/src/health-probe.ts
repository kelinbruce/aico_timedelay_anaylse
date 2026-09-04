import type { IdentityContext, AgentId } from '@nextagent/agent-common';
import type { AgentAssemblyRegistry } from '@nextagent/agent-contracts/agent-assembly';
import type { CapabilityCatalog } from '@nextagent/agent-contracts/capability';

export interface CapabilityHealthProbe {
  readonly name: 'capability';
  readonly critical: false;
  readonly timeoutMs: number;
  run: (signal: AbortSignal) => Promise<{
    readonly status: 'UP' | 'DOWN';
    readonly reasonCode: 'CAPABILITY_CATALOG_READ_OK' | 'CAPABILITY_CATALOG_READ_FAILED';
    readonly summary: string;
  }>;
}

export interface CapabilityHealthProbeOptions {
  readonly assemblyRegistry: AgentAssemblyRegistry;
  readonly catalog: CapabilityCatalog;
  readonly identity: IdentityContext;
  readonly defaultRouteAgentId: AgentId;
}

export function createCapabilityCatalogHealthProbe(input: CapabilityHealthProbeOptions): CapabilityHealthProbe {
  return {
    name: 'capability',
    critical: false,
    timeoutMs: 1000,
    run: async () => {
      try {
        const assembly = await input.assemblyRegistry.active(input.defaultRouteAgentId);
        await input.catalog.listAvailable({
          tenantId: input.identity.tenantId,
          subjectId: input.identity.subjectId,
          agentAssembly: assembly,
          includeUnavailable: false,
        });
        return { status: 'UP', reasonCode: 'CAPABILITY_CATALOG_READ_OK', summary: 'Capability catalog read check completed.' };
      } catch {
        return { status: 'DOWN', reasonCode: 'CAPABILITY_CATALOG_READ_FAILED', summary: 'Capability catalog read check failed safely.' };
      }
    },
  };
}
