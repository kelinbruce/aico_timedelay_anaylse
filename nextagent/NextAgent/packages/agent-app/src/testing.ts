import type { ModelInvocationService } from '@nextagent/agent-contracts/model';
import type { RuntimeLogger } from '@nextagent/agent-common';
import {
  runProductCompositionAsync,
  runProductCompositionSync,
  type CreateComposedAppOptions as InternalCreateComposedAppOptions,
  type CreateNextAgentAppOptions,
  type NextAgentApp,
} from './composition/create-app.js';
import { withTestObservationLogger } from './composition/test-observation-logger.js';
import { createLocalConfiguredAuthChannelContribution } from './composition/local-configured-auth-channel-contribution.js';
import { registerNextAgentTestApp } from './composition/test-lifecycle.js';
import { createIsolatedTestSqliteFile } from './composition/test-sqlite-path.js';
import { loadBuiltInDefaultAgentDefinition } from './assembly/agent-directory-loader.js';
import { createAppCredentialResolver } from './config/env.js';
import { resolveDefaultSystemConfig } from './config/system-config.js';
import { createScriptedModelProviderFixture } from './testing/scripted-model-provider-fixture.js';

export interface CreateNextAgentTestProductAppOptions extends CreateNextAgentAppOptions {
  readonly channelPort?: number;
}

export type CreateComposedAppOptions = InternalCreateComposedAppOptions;

export interface CreateComposedTestAppOptions extends CreateComposedAppOptions {
  readonly observationLogger?: RuntimeLogger;
}

export { createStartupAgentAssemblyCompiler, validateStartupAgentAssemblyGraph } from './assembly/agent-assembly-compiler.js';
export { builtinAgentPromptTemplateRegistrations, createAgentDiscoveryAssemblies } from './assembly/agent-discovery-source.js';
export { createAgentPackageSourceLocator } from './assembly/agent-package-source-locator.js';
export { createDefaultAgentTestAssemblyRegistry } from './testing/default-agent-assembly-fixture.js';
export {
  loadAgentDefinitionFile,
  loadAgentDefinitionForSystemConfig,
  loadBuiltInAgentDefinition,
  loadBuiltInDefaultAgentDefinition,
} from './assembly/agent-directory-loader.js';
export { parseAgentDefinition as parseAgentDefinitionForTesting } from './assembly/agent-definition-parser.js';
export { createStartupResourceProviderRegistry } from './assembly/resource-provider-registry.js';
export { createStartupResourceRegistry } from './assembly/resource-registry.js';
export type {
  AgentCapabilityBindingDefinition,
  AgentDefinition,
  AgentDefinitionResource,
  WorkspaceFilesDefinition,
} from './assembly/agent-definition.js';
export type { DefaultSystemConfig } from './config/component-config.js';
export type { AppCredentialResolver } from './config/env.js';
export type { ObservabilityTracingConfig } from './config/component-config.js';
export {
  CapabilityProviderConfigurationError,
  resolveCapabilityProviders,
  type CapabilityProviderDiagnostic,
  type CapabilityProviderDiagnosticReasonCode,
  type CapabilityProviderUserConfig,
  type CapabilityProviderUserType,
  type CapabilityProvidersConfig,
  type ResolveCapabilityProvidersOptions,
  type ResolvedCapabilityProviders,
} from './config/capability-providers.js';
export type { CreateNextAgentAppOptions, NextAgentApp, NextAgentAppOptions, SkillHubAccessFactory } from './composition/create-app.js';
export { adaptFetchWorkflowRemoteGateway } from '@nextagent/agent-workflow';
export { createInMemoryMetricsRegistry } from '@nextagent/agent-observability';
export { createLocalConfiguredNextAgentApp } from './composition/create-local-configured-app.js';
export { createNextAgentTestApp, readCapturedAuditRecords, readCapturedMetricSamples } from './composition/create-test-composition.js';
export type { NextAgentTestAppOptions } from './composition/create-test-composition.js';
export { buildCronTriggerCallbackSigningPayload } from './cron/cron-trigger-callback-verifier.js';
export { cleanupNextAgentTestApps, registerNextAgentTestApp } from './composition/test-lifecycle.js';
export {
  resolveDefaultSystemConfig,
  evaluateDefaultSystemConfigSource,
  parseBuiltInConfig,
  builtInDefaultSystemConfigPath,
} from './config/system-config.js';
export { createAppCredentialResolver } from './config/env.js';
export { evaluateDefaultSystemConfig, validateDefaultSystemConfig } from './config/validation.js';
export {
  checkLocalRuntimePackageLayout,
  createLocalRuntimePackageEvidence,
  createPackageCandidateEvidence,
  createLocalRuntimePackageManifest,
  readLocalRuntimePackageManifest,
  runLocalRuntimePackageSelfCheck,
  safeDiagnosticMessage,
  stageLocalRuntimePackage,
  startLocalRuntimePackage,
  startRuntimePackage,
  stopLocalRuntimePackage,
  createRuntimePackageServiceVersion,
  validateLocalRuntimePackageConfigSample,
  validateLocalRuntimePackageManifest,
} from './local-runtime-package/index.js';
export type { LocalRuntimeModelProviderProfile, LocalRuntimePackageManifest, LocalRuntimeStartProof } from './local-runtime-package/index.js';
export type { ConfigValidationEvidence } from './config/config-artifacts.js';
export type { PackageCandidateEvidence } from './packaging/index.js';
export { qualify, readConfigValidationEvidence, releaseCheckCommands } from './release/index.js';
export { runReleaseQualification } from './release/run-release-qualification.js';
export type {
  HealthProof,
  QualificationStatus,
  ReleaseCheckId,
  ReleaseCheckResult,
  ReleaseCheckStatus,
  ReleaseQualificationInput,
  ReleaseQualificationResult,
} from './release/index.js';

export function createNextAgentApp(options?: CreateNextAgentTestProductAppOptions): NextAgentApp {
  const credentialResolver = options?.credentialResolver ?? createAppCredentialResolver();
  const systemConfig = createTestSystemConfig(process.cwd(), credentialResolver);
  const channelPort = options?.channelPort ?? systemConfig.channel.port;
  return registerNextAgentTestApp(
    runProductCompositionSync(
      {
        ...options,
        credentialResolver,
        systemConfig: {
          ...systemConfig,
          channel: {
            ...systemConfig.channel,
            ...(channelPort === undefined ? {} : { port: channelPort }),
          },
        },
        agentDefinition: loadBuiltInDefaultAgentDefinition(),
      },
      { channelAuthProfile: 'DEFAULT_WEB', frontendHostingProfile: 'NONE' },
    ).app,
  );
}

export function createComposedApp(options: CreateComposedTestAppOptions, model: ModelInvocationService): NextAgentApp {
  const { observationLogger, ...productOptions } = options;
  const scriptedModelOptions = withScriptedModelProvider(productOptions, model);
  return registerNextAgentTestApp(
    runProductCompositionSync(
      observationLogger === undefined
        ? scriptedModelOptions
        : {
            ...scriptedModelOptions,
            operationalLogWriter: withTestObservationLogger(observationLogger, productOptions.operationalLogWriter),
          },
      { channelAuthProfile: 'DEFAULT_WEB', frontendHostingProfile: 'NONE' },
    ).app,
  );
}

export async function createComposedAppAsync(options: CreateComposedAppOptions, model: ModelInvocationService): Promise<NextAgentApp> {
  return registerNextAgentTestApp(
    (
      await runProductCompositionAsync(withScriptedModelProvider(options, model), {
        channelAuthProfile: 'DEFAULT_WEB',
        frontendHostingProfile: 'NONE',
      })
    ).app,
  );
}

export function createLocalConfiguredComposedApp(options: CreateComposedAppOptions, model: ModelInvocationService): NextAgentApp {
  return registerNextAgentTestApp(
    runProductCompositionSync(withScriptedModelProvider(options, model), {
      channelAuthProfile: 'LOCAL_CONFIGURED_AUTH',
      frontendHostingProfile: 'NONE',
      localConfiguredAuthContribution: createLocalConfiguredAuthChannelContribution(),
    }).app,
  );
}

export function createProviderConfiguredComposedApp(options: CreateComposedTestAppOptions): NextAgentApp {
  const { observationLogger, ...productOptions } = options;
  return registerNextAgentTestApp(
    runProductCompositionSync(
      observationLogger === undefined
        ? productOptions
        : {
            ...productOptions,
            operationalLogWriter: withTestObservationLogger(observationLogger, productOptions.operationalLogWriter),
          },
      { channelAuthProfile: 'DEFAULT_WEB', frontendHostingProfile: 'NONE' },
    ).app,
  );
}

export async function createProviderConfiguredComposedAppAsync(options: CreateComposedAppOptions): Promise<NextAgentApp> {
  return registerNextAgentTestApp(
    (await runProductCompositionAsync(options, { channelAuthProfile: 'DEFAULT_WEB', frontendHostingProfile: 'NONE' })).app,
  );
}

const defaultTestModelEnv = {
  OPENAI_MODEL_NAME: 'MiniMax-M3',
} as const;

export function createTestSystemConfig(workspaceDir: string, credentialResolver = createAppCredentialResolver(defaultTestModelEnv)) {
  const base = resolveDefaultSystemConfig({ cwd: workspaceDir, credentialResolver });
  const sqliteFile = createIsolatedTestSqliteFile();
  return {
    ...base,
    modelProfiles: withEnvModelProfileOverrides(base.modelProfiles, credentialResolver),
    paths: { ...base.paths, sqliteFile },
  };
}

function withEnvModelProfileOverrides(
  modelProfiles: ReturnType<typeof resolveDefaultSystemConfig>['modelProfiles'],
  credentialResolver: ReturnType<typeof createAppCredentialResolver>,
) {
  const modelIdOverride = credentialResolver.resolveEnv?.('OPENAI_MODEL_NAME');
  if (modelIdOverride === undefined || modelIdOverride.length === 0) {
    return modelProfiles;
  }
  return modelProfiles.map((profile) =>
    profile.providerId === 'openai-compatible'
      ? {
          ...profile,
          models: profile.models.map((model, index) =>
            index !== 0 || modelIdOverride === undefined || modelIdOverride.length === 0 ? model : { ...model, modelId: modelIdOverride },
          ),
        }
      : profile,
  );
}

function withScriptedModelProvider(options: CreateComposedAppOptions, model: ModelInvocationService): CreateComposedAppOptions {
  if (options.modelGatewayProviders !== undefined) {
    throw new Error('Scripted model test composition cannot also provide Model Gateway providers.');
  }
  const credentialResolver = options.credentialResolver ?? createAppCredentialResolver();
  let systemConfig = options.systemConfig;
  if (systemConfig === undefined) {
    try {
      systemConfig = resolveDefaultSystemConfig({
        ...(options.configFile === undefined ? {} : { configFile: options.configFile }),
        credentialResolver,
        loggingProfile: 'test',
      });
    } catch {
      return { ...options, credentialResolver };
    }
  }
  const fixture = createScriptedModelProviderFixture(systemConfig, model);
  return {
    ...options,
    credentialResolver,
    systemConfig: fixture.systemConfig,
    modelGatewayProviders: fixture.modelGatewayProviders,
  };
}
