import type { SandboxExecutionRequest, SandboxExecutionResult, SandboxGatewayPort } from '@nextagent/agent-contracts/gateway';

export interface ReferenceRemoteSandboxClient {
  execute: (request: SandboxExecutionRequest, signal?: AbortSignal) => Promise<SandboxExecutionResult>;
}

export function createReferenceRemoteSandboxGateway(client: ReferenceRemoteSandboxClient): SandboxGatewayPort {
  return {
    execute(request, signal) {
      return client.execute(request, signal);
    },
  };
}
