import { getLogger } from '@nextagent/agent-common';
import type {
  DisabledLongTermMemoryDiagnostic,
  MemoryConfigurationMetricOutcome,
  MemoryToolDescriptionOverrideDiagnostic,
} from '@nextagent/agent-memory';
import {
  emitMemoryConfigurationObservation,
  emitMemoryDescriptionOverrideObservation,
  type MetricsRegistry,
  type ObservabilityProjectorHost,
  type TrustedOwnerScope,
} from '@nextagent/agent-observability';
import type { AppConfigEvaluation } from '../config/config-artifacts.js';
import type { DefaultSystemConfig } from '../config/component-config.js';
import type { AgentScope } from './composition-contracts.js';

const logger = getLogger({ component: 'agent-app', source: 'memory-config' });

export function reportMemoryConfigurationFailureTelemetry(input: {
  readonly evaluation: AppConfigEvaluation;
  readonly metricsRegistry: MetricsRegistry;
}): void {
  const diagnostic = input.evaluation.diagnostics.find((entry) => entry.scope === 'memory');
  if (diagnostic === undefined) {
    return;
  }
  input.metricsRegistry.increment('configuration_evaluation_total', { component: 'memory', outcome: 'failure' });
  logger.error({
    event: 'memory.config.failed',
    safeReasonCode: diagnostic.issueCode,
    scope: 'memory',
    status: diagnostic.configurationStatus ?? 'INVALID',
  });
}

export function reportMemoryConfigurationTelemetry(input: {
  readonly memoryConfig: DefaultSystemConfig['memory'];
  readonly descriptionDiagnostics: readonly MemoryToolDescriptionOverrideDiagnostic[];
  readonly metricsRegistry: MetricsRegistry;
  readonly projectorHost: ObservabilityProjectorHost;
  readonly ownerScope: TrustedOwnerScope;
  readonly agentScope: AgentScope;
}): void {
  const memoryDiagnostic = input.memoryConfig.diagnostics[0];
  const memoryMetricOutcome: MemoryConfigurationMetricOutcome = input.memoryConfig.status === 'VALID' ? 'success' : 'disabled';
  input.metricsRegistry.increment('configuration_evaluation_total', { component: 'memory', outcome: memoryMetricOutcome });
  emitMemoryConfigurationObservation({
    projectorHost: input.projectorHost,
    ownerScope: input.ownerScope,
    agentScope: input.agentScope,
    status: input.memoryConfig.status,
    source: memoryDiagnostic?.source ?? 'explicit',
    issueCode: memoryDiagnostic?.issueCode ?? 'MEMORY_CONFIG_VALID',
    safeMessage: memoryDiagnostic?.safeMessage ?? 'Long-term memory configuration was evaluated.',
  });

  for (const diagnostic of input.descriptionDiagnostics) {
    input.metricsRegistry.increment('configuration_evaluation_total', {
      component: 'capability_description_override',
      outcome: diagnostic.metricOutcome,
    });
    emitMemoryDescriptionOverrideObservation({
      projectorHost: input.projectorHost,
      ownerScope: input.ownerScope,
      agentScope: input.agentScope,
      outcome: diagnostic.observationOutcome,
      issueCode: diagnostic.issueCode,
      safeMessage: diagnostic.safeMessage,
      ...(diagnostic.capabilityId === undefined ? {} : { capabilityId: diagnostic.capabilityId }),
    });
  }
}

export function emitDisabledLongTermMemoryInvocationLog(input: { readonly event: DisabledLongTermMemoryDiagnostic }): void {
  logger.warn({
    event: 'memory.invocation.disabled',
    eventType: input.event.eventType,
    safeReasonCode: input.event.safeReasonCode,
    memoryOperation: input.event.operation,
  });
}
