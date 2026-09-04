import { AgentError, brand, type AgentId } from '@nextagent/agent-common';
import type { AgentSelectionPolicy, AgentSelectionRequest, AgentSelectionResult } from '@nextagent/agent-contracts/agent-assembly';

const safeId = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;

export function createDefaultAgentSelectionPolicy(): AgentSelectionPolicy {
  return {
    async resolve(request: AgentSelectionRequest, signal: AbortSignal): Promise<AgentSelectionResult> {
      if (signal.aborted) {
        throw new AgentError({
          code: 'AGENT_SELECTION_ABORTED',
          message: 'Agent selection was canceled.',
          category: 'CANCELED',
          retryable: false,
          safeDetails: { reasonCode: 'AGENT_SELECTION_ABORTED' },
        });
      }
      const headerValue = request.headerAgentId;
      if (headerValue === undefined || headerValue.length === 0) {
        return { agentId: request.defaultRouteAgentId, safeReason: 'DEFAULT_ACTIVE_AGENT' };
      }
      if (!safeId.test(headerValue)) {
        throw new AgentError({
          code: 'AGENT_SELECTION_INVALID_AGENT_ID',
          message: 'Header x-agent-id does not satisfy agentId format constraints.',
          category: 'VALIDATION',
          retryable: false,
          safeDetails: { reasonCode: 'AGENT_SELECTION_INVALID_AGENT_ID' },
        });
      }
      return { agentId: brand<string, 'AgentId'>(headerValue), safeReason: 'HEADER_AGENT_ID_SELECTED' };
    },
  };
}
