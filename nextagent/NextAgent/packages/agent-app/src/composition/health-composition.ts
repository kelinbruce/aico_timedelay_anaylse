import { createCapabilityCatalogHealthProbe } from '@nextagent/agent-capability';
import { getLogger, type IdentityContext } from '@nextagent/agent-common';
import type { AgentAssemblyRegistry } from '@nextagent/agent-contracts/agent-assembly';
import type { CapabilityCatalog } from '@nextagent/agent-contracts/capability';
import type { ModelCatalogQueryService } from '@nextagent/agent-contracts/model';
import type { AgentId } from '@nextagent/agent-common';
import { createModelProviderHealthProbe } from '@nextagent/agent-model';
import {
  createHealthEvaluator,
  createObservedHealthEvaluator,
  type HealthEvaluator,
  type MetricsRegistry,
  type ObservabilityProjectorHost,
  type TrustedOwnerScope,
} from '@nextagent/agent-observability';
import { createSessionGatewayReadHealthProbe } from '@nextagent/agent-session';
import type { AgentScope, AppGatewayStores } from './composition-contracts.js';

const logger = getLogger({ component: 'agent-app', source: 'health-composition' });

export function composeHealthEvaluator(input: {
  readonly metricsRegistry: MetricsRegistry;
  readonly gateway: AppGatewayStores;
  readonly identity: IdentityContext;
  readonly defaultRouteAgentId: AgentId;
  readonly modelCatalog: ModelCatalogQueryService;
  readonly assemblyRegistry: AgentAssemblyRegistry;
  readonly catalog: CapabilityCatalog;
  readonly projectorHost: ObservabilityProjectorHost;
  readonly ownerScope: TrustedOwnerScope;
  readonly agentScope: AgentScope;
}): HealthEvaluator {
  return withHealthDiagnostics(
    createObservedHealthEvaluator({
      evaluator: createHealthEvaluator({
        metricsRegistry: input.metricsRegistry,
        probes: [
          createSessionGatewayReadHealthProbe({
            sessions: input.gateway.sessions,
            identity: input.identity,
            defaultRouteAgentId: input.defaultRouteAgentId,
          }),
          createModelProviderHealthProbe({
            modelCatalog: input.modelCatalog,
            assemblyRegistry: input.assemblyRegistry,
            defaultRouteAgentId: input.defaultRouteAgentId,
          }),
          createCapabilityCatalogHealthProbe({
            assemblyRegistry: input.assemblyRegistry,
            catalog: input.catalog,
            identity: input.identity,
            defaultRouteAgentId: input.defaultRouteAgentId,
          }),
        ],
      }),
      projectorHost: input.projectorHost,
      ownerScope: input.ownerScope,
      agentScope: input.agentScope,
    }),
  );
}

export function withHealthDiagnostics(evaluator: HealthEvaluator): HealthEvaluator {
  const previousStatus = new Map<'primary' | 'deep', string>();
  const activeFailures = new Set<string>();
  const evaluate = async (kind: 'primary' | 'deep', signal?: AbortSignal) => {
    const result = await evaluator[kind](signal);
    const previous = previousStatus.get(kind);
    if (previous !== result.status) {
      previousStatus.set(kind, result.status);
      if (!(previous === undefined && result.status === 'UP')) {
        const entry = { event: 'health.state.changed', probeKind: kind, previousStatus: previous ?? 'UNKNOWN', status: result.status };
        if (result.status === 'UP') {
          logger.info(entry);
        } else {
          logger.warn(entry);
        }
      }
    }

    const currentFailures = new Set<string>();
    for (const component of result.components) {
      if (component.status !== 'DOWN') {
        continue;
      }
      const key = `${kind}:${component.name}:${component.reasonCode ?? 'HEALTH_PROBE_FAILED'}`;
      currentFailures.add(key);
      if (!activeFailures.has(key)) {
        logger.error({
          event: 'health.probe.subsystem_failed',
          probeKind: kind,
          component: component.name,
          safeReasonCode: component.reasonCode ?? 'HEALTH_PROBE_FAILED',
        });
      }
    }
    for (const key of [...activeFailures]) {
      if (key.startsWith(`${kind}:`) && !currentFailures.has(key)) {
        activeFailures.delete(key);
      }
    }
    for (const key of currentFailures) {
      activeFailures.add(key);
    }
    return result;
  };
  return {
    primary: (signal) => evaluate('primary', signal),
    deep: (signal) => evaluate('deep', signal),
  };
}
