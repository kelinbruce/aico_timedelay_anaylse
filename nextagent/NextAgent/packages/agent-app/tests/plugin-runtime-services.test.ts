import { describe, expect, it, vi } from 'vitest';
import type { AgentAssembly } from '@nextagent/agent-contracts/agent-assembly';
import { createDeferredPluginRuntimeServices, PluginRuntimeServicesUnavailableError } from '../src/composition/plugin-runtime-services.js';

describe('deferred plugin runtime services', () => {
  it('keeps one stable facade, fails before binding and delegates after binding', async () => {
    const deferred = createDeferredPluginRuntimeServices();
    expect(() => deferred.services.agentAssemblies.active('agent' as never)).toThrow(PluginRuntimeServicesUnavailableError);

    const active = vi.fn(async () => ({ agentId: 'agent' }) as AgentAssembly);
    deferred.bind({
      agentAssemblies: { active, require: vi.fn() as never },
      capabilityCatalog: { listAvailable: vi.fn() as never, resolve: vi.fn() as never },
      capabilityInvocation: { invoke: vi.fn() as never },
      modelSelection: { select: vi.fn() as never },
      modelInvocation: { complete: vi.fn() as never, stream: vi.fn() as never },
      promptTemplates: { resolve: vi.fn() as never },
    });

    await expect(deferred.services.agentAssemblies.active('agent' as never)).resolves.toMatchObject({ agentId: 'agent' });
    expect(active).toHaveBeenCalledWith('agent');
  });

  it('rejects duplicate binding', () => {
    const deferred = createDeferredPluginRuntimeServices();
    const services = deferred.services;
    deferred.bind(services);
    expect(() => deferred.bind(services)).toThrow('already bound');
  });
});
