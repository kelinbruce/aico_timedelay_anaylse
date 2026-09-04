import type { MetricsRegistry } from '@nextagent/agent-observability';
import type { DefaultSystemConfig } from '../config/component-config.js';
import type { AppCredentialResolver } from '../config/env.js';
import { evaluateDefaultSystemConfigSource } from '../config/system-config.js';
import { requireReadyDefaultSystemConfig } from '../config/validation.js';
import { createSystemCapabilityProviderReferenceValidation } from './app-composition-helpers.js';
import type { CapabilityProviderReferenceValidation, SandboxGatewayFactoryInput } from './composition-contracts.js';
import { reportMemoryConfigurationFailureTelemetry } from './memory-config-telemetry.js';

export interface AppCompositionConfiguration {
  readonly systemConfig: DefaultSystemConfig;
  readonly capabilityProviderReferenceValidation: CapabilityProviderReferenceValidation;
  readonly sandboxRuntimeInput: SandboxGatewayFactoryInput;
}

export function loadAppCompositionConfiguration(input: {
  readonly systemConfig?: DefaultSystemConfig;
  readonly configFile?: string;
  readonly credentialResolver: AppCredentialResolver;
  readonly metricsRegistry: MetricsRegistry;
  readonly capabilityProviderReferenceValidation?: CapabilityProviderReferenceValidation;
}): AppCompositionConfiguration {
  const systemConfig = input.systemConfig ?? evaluateConfiguration(input);
  const clipcExecutableDirectory =
    input.credentialResolver.resolveEnv?.(systemConfig.sandbox.clipcExecutableDirectoryEnv) ??
    process.env[systemConfig.sandbox.clipcExecutableDirectoryEnv];
  return {
    systemConfig,
    capabilityProviderReferenceValidation:
      input.capabilityProviderReferenceValidation ?? createSystemCapabilityProviderReferenceValidation(systemConfig.paths),
    sandboxRuntimeInput: {
      allowedApis: systemConfig.sandbox.allowedApis,
      ...(systemConfig.sandbox.allowedExecutables === undefined ? {} : { allowedExecutables: systemConfig.sandbox.allowedExecutables }),
      ...(clipcExecutableDirectory === undefined ? {} : { clipcExecutableDirectory }),
      deniedExecutables: systemConfig.sandbox.deniedExecutables,
      enabled: systemConfig.sandbox.enabled,
    },
  };
}

function evaluateConfiguration(input: {
  readonly configFile?: string;
  readonly credentialResolver: AppCredentialResolver;
  readonly metricsRegistry: MetricsRegistry;
}): DefaultSystemConfig {
  const evaluation = evaluateDefaultSystemConfigSource({
    ...(input.configFile === undefined ? {} : { configFile: input.configFile }),
    credentialResolver: input.credentialResolver,
    loggingProfile: process.env['NEXTAGENT_ENTRYPOINT_PROFILE'] === 'development' ? 'development' : 'local',
  });
  if (evaluation.status === 'BLOCKED' || evaluation.config === undefined) {
    reportMemoryConfigurationFailureTelemetry({
      evaluation: evaluation.evidenceInput,
      metricsRegistry: input.metricsRegistry,
    });
  }
  return requireReadyDefaultSystemConfig(evaluation);
}
