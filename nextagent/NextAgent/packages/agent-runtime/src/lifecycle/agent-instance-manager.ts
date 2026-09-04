import { AgentError, type AgentType } from '@nextagent/agent-common';
import type { AgentAssembly } from '@nextagent/agent-contracts/agent-assembly';
import type { Agent, AgentConstructor, AgentRunStatePort } from '@nextagent/agent-contracts/runtime';

export type AgentRuntimeKit<TDependencies extends object> = TDependencies & {
  readonly runState: AgentRunStatePort;
};

export interface AgentInstanceManagerDependencies<TDependencies extends object> {
  readonly agentConstructors: ReadonlyArray<AgentConstructor<AgentRuntimeKit<TDependencies>>>;
  readonly agentRuntimeDependencies: TDependencies;
  readonly runState: AgentRunStatePort;
}

export class AgentInstanceManager<TDependencies extends object> {
  private readonly constructors = new Map<AgentType, AgentConstructor<AgentRuntimeKit<TDependencies>>>();
  private readonly instances = new Map<string, Agent>();

  constructor(private readonly deps: AgentInstanceManagerDependencies<TDependencies>) {
    for (const constructor of deps.agentConstructors) {
      const agentType = constructor.getType();
      if (this.constructors.has(agentType)) {
        throw new AgentError({ code: 'DUPLICATE_AGENT_TYPE', message: 'Duplicate Agent type.', category: 'VALIDATION', retryable: false });
      }
      this.constructors.set(agentType, constructor);
    }
    if (this.constructors.size === 0) {
      throw new AgentError({
        code: 'NO_AGENT_CONSTRUCTORS',
        message: 'At least one Agent constructor is required.',
        category: 'VALIDATION',
        retryable: false,
      });
    }
  }

  getOrCreate(assembly: AgentAssembly): Agent {
    const cacheKey = `${assembly.agentId}:${assembly.agentVersion}:${assembly.agentAssemblyRef}`;
    const cached = this.instances.get(cacheKey);
    if (cached !== undefined) {
      return cached;
    }
    const constructor = this.constructors.get(assembly.agentType);
    if (constructor === undefined) {
      throw new AgentError({ code: 'UNKNOWN_AGENT_TYPE', message: 'Agent type is not registered.', category: 'VALIDATION', retryable: false });
    }
    const agent = new constructor({ ...this.deps.agentRuntimeDependencies, runState: this.deps.runState });
    this.instances.set(cacheKey, agent);
    return agent;
  }
}
