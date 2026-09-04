import type { AgentAssemblyRegistry } from '@nextagent/agent-contracts/agent-assembly';
import type { CapabilityCatalog, CapabilityInvocationPort } from '@nextagent/agent-contracts/capability';
import type { ModelSelectionService, PromptTemplateResolverPort } from '@nextagent/agent-contracts/context';
import type { ModelInvocationService } from '@nextagent/agent-contracts/model';
import type { PluginRuntimeServices } from '@nextagent/agent-plugin-sdk';

export class PluginRuntimeServicesUnavailableError extends Error {
  readonly code = 'PLUGIN_RUNTIME_SERVICES_UNAVAILABLE';

  constructor(service: string) {
    super(`Plugin runtime service ${service} is not bound.`);
    this.name = 'PluginRuntimeServicesUnavailableError';
  }
}

export interface DeferredPluginRuntimeServices {
  readonly services: PluginRuntimeServices;
  bind: (targets: PluginRuntimeServices) => void;
}

export function createDeferredPluginRuntimeServices(): DeferredPluginRuntimeServices {
  let targets: PluginRuntimeServices | undefined;
  const requireTargets = (): PluginRuntimeServices => {
    if (targets === undefined) {
      throw new PluginRuntimeServicesUnavailableError('runtime');
    }
    return targets;
  };
  const agentAssemblies: AgentAssemblyRegistry = {
    active(agentId) {
      return requireTargets().agentAssemblies.active(agentId);
    },
    require(agentId, agentVersion) {
      return requireTargets().agentAssemblies.require(agentId, agentVersion);
    },
  };
  const capabilityCatalog: CapabilityCatalog = {
    listAvailable(request) {
      return requireTargets().capabilityCatalog.listAvailable(request);
    },
    resolve(request) {
      return requireTargets().capabilityCatalog.resolve(request);
    },
  };
  const capabilityInvocation: CapabilityInvocationPort = {
    invoke(request, signal, runtimeContext) {
      return requireTargets().capabilityInvocation.invoke(request, signal, runtimeContext);
    },
  };
  const modelSelection: ModelSelectionService = {
    select(request, signal) {
      return requireTargets().modelSelection.select(request, signal);
    },
  };
  const modelInvocation: ModelInvocationService = {
    complete(request, signal) {
      return requireTargets().modelInvocation.complete(request, signal);
    },
    stream(request, signal, onDelta) {
      return requireTargets().modelInvocation.stream(request, signal, onDelta);
    },
  };
  const promptTemplates: PromptTemplateResolverPort = {
    resolve(request, signal) {
      return requireTargets().promptTemplates.resolve(request, signal);
    },
  };
  const services = Object.freeze({
    agentAssemblies: Object.freeze(agentAssemblies),
    capabilityCatalog: Object.freeze(capabilityCatalog),
    capabilityInvocation: Object.freeze(capabilityInvocation),
    modelSelection: Object.freeze(modelSelection),
    modelInvocation: Object.freeze(modelInvocation),
    promptTemplates: Object.freeze(promptTemplates),
  });
  return Object.freeze({
    services,
    bind(nextTargets: PluginRuntimeServices) {
      if (targets !== undefined) {
        throw new Error('Plugin runtime services are already bound.');
      }
      targets = Object.freeze({ ...nextTargets });
    },
  });
}
