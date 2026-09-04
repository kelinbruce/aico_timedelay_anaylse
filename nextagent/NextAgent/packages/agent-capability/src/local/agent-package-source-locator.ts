import type { AgentId, AgentVersion } from '@nextagent/agent-common';

export interface AgentPackageSourceLocator {
  locate: (
    input: {
      readonly agentId: AgentId;
      readonly agentVersion: AgentVersion;
      readonly agentAssemblyRef: string;
    },
    options?: AgentPackageLocatorOptions,
  ) => Promise<
    | { readonly status: 'found'; readonly agentPackageRoot: string }
    | { readonly status: 'not-configured' | 'not-found' | 'unavailable' | 'invalid'; readonly safeCode: string }
  >;
}

export interface AgentPackageLocatorOptions {
  readonly signal?: AbortSignal;
}
