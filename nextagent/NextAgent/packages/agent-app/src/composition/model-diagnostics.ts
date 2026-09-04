import { emitModelConfigurationExclusionObservation, type ObservabilityProjectorHost, type TrustedOwnerScope } from '@nextagent/agent-observability';
import type { ModelProfileValidationEvidence } from '../config/component-config.js';
import type { AgentScope } from './composition-contracts.js';

export function reportModelDiagnostics(input: {
  readonly validationEvidence: readonly ModelProfileValidationEvidence[];
  readonly projectorHost: ObservabilityProjectorHost;
  readonly ownerScope: TrustedOwnerScope;
  readonly agentScope: AgentScope;
}): void {
  for (const item of input.validationEvidence) {
    emitModelConfigurationExclusionObservation({
      projectorHost: input.projectorHost,
      ownerScope: input.ownerScope,
      agentScope: input.agentScope,
      code: item.code,
    });
  }
}
