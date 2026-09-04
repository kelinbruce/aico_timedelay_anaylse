import type { AgentId, IdentityContext } from '@nextagent/agent-common';
import type { SessionStoreGateway } from '@nextagent/agent-contracts/gateway';

export interface SessionGatewayReadHealthProbe {
  readonly name: 'gateway';
  readonly critical: true;
  readonly timeoutMs: number;
  run: (signal: AbortSignal) => Promise<{
    readonly status: 'UP' | 'DOWN';
    readonly reasonCode: 'GATEWAY_READ_OK' | 'GATEWAY_READ_FAILED';
    readonly summary: string;
  }>;
}

export interface SessionGatewayReadHealthProbeOptions {
  readonly sessions: Pick<SessionStoreGateway, 'listSessions'>;
  readonly identity: IdentityContext;
  readonly defaultRouteAgentId: AgentId;
}

export function createSessionGatewayReadHealthProbe(input: SessionGatewayReadHealthProbeOptions): SessionGatewayReadHealthProbe {
  return {
    name: 'gateway',
    critical: true,
    timeoutMs: 1000,
    run: async () => {
      try {
        await input.sessions.listSessions({
          tenantId: input.identity.tenantId,
          subjectId: input.identity.subjectId,
          agentId: input.defaultRouteAgentId,
          offset: 0,
          limit: 1,
        });
        return { status: 'UP', reasonCode: 'GATEWAY_READ_OK', summary: 'Gateway read check completed.' };
      } catch {
        return { status: 'DOWN', reasonCode: 'GATEWAY_READ_FAILED', summary: 'Gateway read check failed safely.' };
      }
    },
  };
}
