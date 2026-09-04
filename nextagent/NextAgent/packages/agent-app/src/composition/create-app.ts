import { createDefaultAgentSelectionPolicy } from './agent-selection-policy.js';
import { nextCronRunMs } from '@nextagent/agent-capability';
import { AgentError, brand, getLogger } from '@nextagent/agent-common';
import type { ModelGatewayProvider } from '@nextagent/agent-contracts/model';
import { createDeveloperDiagnosticArtifactWriter } from '@nextagent/agent-log';
import { createTimelineTraceRuntime } from '@nextagent/agent-observability';
import { mkdirSync } from 'node:fs';
import { defaultIdentity } from '../auth/local-auth.js';
import type { DefaultSystemConfig } from '../config/component-config.js';
import { createAppCredentialResolver, type AppCredentialResolver } from '../config/env.js';
import { sqliteParentDir } from '../config/paths.js';
import { classifyAppStartupFailure } from '../app-startup-failure.js';
import { createMonotonicClock, requireAppCredentialResolver } from './app-composition-helpers.js';
import { composeAgentAssemblyLayer } from './assembly-composition.js';
import { composeProductChannelLayer, type ChannelAuthProfile, type LocalConfiguredAuthChannelContribution } from './channel-composition.js';
import { composeCapabilityLayer, resolveCapabilityProviderComposition } from './capability-composition.js';
import { createParameterExtractionPort } from './parameter-extraction-port.js';
import type { ApiCallPort } from '@nextagent/agent-contracts/capability';
import type { OperationLogGatewayPort } from '@nextagent/agent-contracts/gateway';

import { composeAppLifecycle } from './app-lifecycle-composition.js';
import { composeCronCapabilityLayer, composeCronRuntimeLayer } from '../cron/cron-runtime-composition.js';
import { createCronTaskManagementService } from '../cron/cron-task-management.js';
import { createRuntimeCronTriggerDelivery } from './cron-delivery-composition.js';
import { resolveCronDeploymentSelection } from '../config/gateway-selection.js';
import { isGatewayAdapterSelectedForDeployment } from '../config/gateway-selection.js';
import { composeWorkflowExecutionLayer } from './workflow-composition.js';
import { composeMemoryCapabilityLayer, composeMemoryMaintenanceLayer } from './memory-maintenance-composition.js';
import { composeContextEngineLayer, composeModelSelectionService } from './context-engine-composition.js';
import { createForkActiveContextSelector } from '@nextagent/agent-context-engine';
import { composeRequestRuntimeLayer, prepareRequestRuntimePolicy } from './request-runtime-composition.js';
import { composeSessionServicesLayer } from './session-services-composition.js';
import { createCompositionDeferredBindings } from './deferred-composition-bindings.js';
import { createDeferredPluginRuntimeServices, type DeferredPluginRuntimeServices } from './plugin-runtime-services.js';
import {
  composeAttachmentLayer,
  preloadAttachmentCompositionAsync,
  preloadAttachmentCompositionSync,
  type PreparedAttachmentComposition,
} from './attachment-composition.js';
import { composeHealthEvaluator } from './health-composition.js';
import { completeGatewayObservability, composeGatewayLayer } from './gateway-composition.js';
import {
  composeObservabilityInfrastructure,
  prepareConfigFailureObservability,
  prepareConfigFailureMetricsRegistry,
  preloadObservabilityCompositionAsync,
  preloadObservabilityCompositionSync,
  type PreparedObservabilityComposition,
} from './observability-composition.js';
import { composeLifecycleHookDefinitions, composeLifecycleHookMaterialization } from './lifecycle-hook-composition.js';
import { createUserQueryMemoryRecallTrustedHook } from './user-query-memory-recall-hook.js';
import { composeModelRuntime, prepareModelComposition, type PreparedModelComposition } from './model-composition.js';
import { preloadPortalAbilityComposition, type PreparedPortalAbilityComposition } from './portal-ability-composition.js';
import { reportModelDiagnostics } from './model-diagnostics.js';
import { composePromptTemplateLayer } from './prompt-template-composition.js';
import { composeBackgroundTaskLayer } from './background-task-composition.js';
import { createWatermarkConfigProvider } from './watermark-composition.js';
import type {
  CreateComposedAppOptions,
  CreateNextAgentAppOptions,
  DeveloperDiagnosticArtifactWriter,
  NextAgentApp,
} from './composition-contracts.js';
import { loadAppCompositionConfiguration, type AppCompositionConfiguration } from './configuration-composition.js';
import { preloadPluginCompositionAsync, preloadPluginCompositionSync, type PluginComposition } from './plugin-composition.js';
import { createCompositionFailureScope, type CompositionFailureScope } from './composition-failure-scope.js';
import { loadLocalRuntimeBindings, loadRemoteApiCallPort } from '../local-runtime-package/local-runtime-bindings.js';
import type { LocalRuntimeBindings } from '../local-runtime-package/local-runtime-bindings.js';

const logger = getLogger({ component: 'agent-app', source: 'composition' });
const localConfiguredAuthListenerHosts = new Set(['localhost', '127.0.0.1', '::1']);

export type {
  AppGatewayStores,
  AppSandboxGatewayPort,
  CapabilityProviderReferenceValidation,
  CreateComposedAppOptions,
  CreateNextAgentAppOptions,
  CronTaskGatewayFactory,
  CronTaskSchedulerFactory,
  CronTriggerCallbackRegistration,
  CronTriggerCallbackRegistrationContext,
  CronTriggerCallbackRegistrationFactory,
  NextAgentApp,
  NextAgentAppOptions,
  RagRetrievalBinding,
  RagRetrievalFactory,
  RagRetrievalFactoryInput,
  SandboxGatewayFactory,
  SandboxGatewayFactoryInput,
  ScheduledMaintenanceGatewayFactory,
  SkillHubAccessFactory,
  TaskChannelRegistration,
  TaskChannelRegistrationContext,
  WebChannelRegistration,
  WebChannelRegistrationContext,
  WebIdentityResolver,
  TrustedLocalWebExtensionRegistrationContext,
} from './composition-contracts.js';
export { createAppOperationalLogWriter } from './observability-composition.js';

export function createDefaultProductOptions(): CreateNextAgentAppOptions {
  return {
    credentialResolver: createAppCredentialResolver(),
  };
}

export function createNextAgentApp(options: CreateNextAgentAppOptions = createDefaultProductOptions()): NextAgentApp {
  try {
    return runProductCompositionSync(options, defaultHostCompositionSelection()).app;
  } catch (error) {
    throw appCompositionFailure(error);
  }
}

export async function createNextAgentAppAsync(options: CreateNextAgentAppOptions = createDefaultProductOptions()): Promise<NextAgentApp> {
  try {
    return (await runProductCompositionAsync(options, defaultHostCompositionSelection())).app;
  } catch (error) {
    throw appCompositionFailure(error);
  }
}

function appCompositionFailure(error: unknown): AgentError {
  if (error instanceof AgentError) {
    return error;
  }
  return new AgentError({
    code: 'APP_START_FAILED',
    message: 'NextAgent app composition failed.',
    category: 'INTERNAL',
    retryable: false,
    safeDetails: { failureStage: 'APP_STARTUP' },
    cause: error,
  });
}

export type FrontendHostingProfile = 'NONE' | 'WITH_FRONTEND';

export interface HostCompositionSelection {
  readonly channelAuthProfile: ChannelAuthProfile;
  readonly frontendHostingProfile: FrontendHostingProfile;
  readonly localConfiguredAuthContribution?: LocalConfiguredAuthChannelContribution;
}

export interface ProductHostCompositionInput {
  readonly productVersion: string;
  readonly resolveFrontendHostingManifest: () => Promise<unknown> | unknown;
  readonly indexHtmlScripts?: readonly string[];
  readonly useDefaultWorkbenchScripts: boolean;
}

interface PreparedCompositionInputs {
  readonly identity: {
    readonly credentialResolver: AppCredentialResolver;
    readonly identity: ReturnType<typeof defaultIdentity>;
    readonly clock: ReturnType<typeof createMonotonicClock>;
  };
  readonly configuration: AppCompositionConfiguration;
  readonly observability: PreparedObservabilityComposition;
  readonly plugin: PluginComposition;
  readonly pluginRuntimeServices: DeferredPluginRuntimeServices;
  readonly developerDiagnosticArtifactWriter?: DeveloperDiagnosticArtifactWriter;
  readonly attachment: PreparedAttachmentComposition;
  readonly portalAbility: PreparedPortalAbilityComposition;
  readonly model: PreparedModelComposition;
  readonly timelineTrace: ReturnType<typeof createTimelineTraceRuntime>;
  readonly assemblyInput: {
    readonly agentDefinition?: CreateComposedAppOptions['agentDefinition'];
  };
  readonly gatewayInput: {
    readonly gatewayProviders?: CreateComposedAppOptions['gatewayProviders'];
    readonly gatewayBindings?: CreateComposedAppOptions['gatewayBindings'];
    readonly sandboxGatewayFactory?: CreateComposedAppOptions['sandboxGatewayFactory'];
    readonly sandboxGateway?: CreateComposedAppOptions['sandboxGateway'];
    readonly scheduledMaintenanceGatewayFactory?: CreateComposedAppOptions['scheduledMaintenanceGatewayFactory'];
    readonly cronTaskGatewayFactory?: CreateComposedAppOptions['cronTaskGatewayFactory'];
    readonly ragRetrievalFactory?: CreateComposedAppOptions['ragRetrievalFactory'];
    readonly clipCommandRunner?: CreateComposedAppOptions['clipCommandRunner'];
    readonly questionRecommendationsGateway?: CreateComposedAppOptions['questionRecommendationsGateway'];
  };
  readonly capabilityRuntimeInput: {
    readonly riskPolicyEvaluator?: CreateComposedAppOptions['riskPolicyEvaluator'];
    readonly registeredCustomAdapterTypes?: CreateComposedAppOptions['registeredCustomAdapterTypes'];
    readonly skillHubAccessFactory?: CreateComposedAppOptions['skillHubAccessFactory'];
    readonly backgroundTaskStoreFactory?: CreateComposedAppOptions['backgroundTaskStoreFactory'];
    readonly cronTaskIdFactory?: CreateComposedAppOptions['cronTaskIdFactory'];
    readonly apiCallPort?: ApiCallPort;
  };
  readonly lifecycleWorkflowInput: {
    readonly lifecycleHooks?: CreateComposedAppOptions['lifecycleHooks'];
    readonly lifecycleHook?: CreateComposedAppOptions['lifecycleHook'];
    readonly lifecycleHookDefinitions?: CreateComposedAppOptions['lifecycleHookDefinitions'] | undefined;
    readonly workflowExecutionServiceFactory?: CreateComposedAppOptions['workflowExecutionServiceFactory'];
    readonly workflowExecutionMode?: CreateComposedAppOptions['workflowExecutionMode'];
    readonly workflowRemoteExecutionGateway?: CreateComposedAppOptions['workflowRemoteExecutionGateway'];
  };
  readonly channelInput: {
    readonly channelAuthProfile: ChannelAuthProfile;
    readonly localConfiguredAuthContribution?: LocalConfiguredAuthChannelContribution;
    readonly webChannelRegistration?: CreateComposedAppOptions['webChannelRegistration'];
    readonly webIdentityResolver?: CreateComposedAppOptions['webIdentityResolver'];
    readonly trustedLocalWebExtensionRegistration?: CreateComposedAppOptions['trustedLocalWebExtensionRegistration'];
    readonly trustedLocalWebExtensionProtectedPrefixes?: CreateComposedAppOptions['trustedLocalWebExtensionProtectedPrefixes'];
    readonly taskChannelRegistration?: CreateComposedAppOptions['taskChannelRegistration'];
  };
  readonly cronInput: {
    readonly deploymentSelection: ReturnType<typeof resolveCronDeploymentSelection>;
    readonly cronTaskSchedulerFactory?: CreateComposedAppOptions['cronTaskSchedulerFactory'];
    readonly cronTriggerCallbackCredentialRef?: CreateComposedAppOptions['cronTriggerCallbackCredentialRef'];
    readonly cronTriggerCallbackRegistration?: CreateComposedAppOptions['cronTriggerCallbackRegistration'];
  };
}

export interface ProductCompositionOutcome {
  readonly app: NextAgentApp;
  readonly hostFacts: {
    readonly gatewayReadiness: {
      readonly selectedProviderId: string;
      readonly deploymentMode: 'LOCAL' | 'REMOTE';
      readonly gatewaySnapshotRef: string;
      readonly bindingsReadinessRef: string;
    };
    reportAppStartFailure: (error: unknown) => void;
  };
}

function defaultHostCompositionSelection(): HostCompositionSelection {
  return { channelAuthProfile: 'DEFAULT_WEB', frontendHostingProfile: 'NONE' };
}

function assertChannelAuthHostSafety(systemConfig: DefaultSystemConfig, selection: HostCompositionSelection): void {
  if (
    selection.channelAuthProfile === 'LOCAL_CONFIGURED_AUTH' &&
    (systemConfig.channel.host === undefined || !localConfiguredAuthListenerHosts.has(systemConfig.channel.host))
  ) {
    throw new AgentError({
      code: 'APP_CONFIG_BLOCKED',
      message: 'Local configured authentication requires a loopback listener.',
      category: 'VALIDATION',
      retryable: false,
    });
  }
}

/**
 * In the backend-only profile (DEFAULT_WEB + no frontend hosting), neither
 * auth-local nor frontend-hosting is registered, so Fastify's default 404
 * handler would return { message, error, statusCode } and leak the internal
 * route name. Register a root not-found handler returning the interface's
 * { error: { code, message } } contract. The other profiles register their
 * own not-found handler (auth-local / frontend-hosting) and are skipped here
 * to avoid Fastify's "Not found handler already set" conflict.
 */
function ensureBackendOnlyNotFoundHandler(app: NextAgentApp, selection: HostCompositionSelection): void {
  if (selection.channelAuthProfile !== 'DEFAULT_WEB' || selection.frontendHostingProfile !== 'NONE') {
    return;
  }
  app.server.setNotFoundHandler(async (_request, reply) => {
    await reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Route not found.' } });
  });
}

export function runProductCompositionSync(options: CreateComposedAppOptions, selection: HostCompositionSelection): ProductCompositionOutcome {
  const failureScope = createCompositionFailureScope();
  try {
    const preparedInputs = prepareCompositionInputsSync(options, selection, failureScope);
    const outcome = composeNextAgentApp(preparedInputs, failureScope, options.operationLogPort);
    ensureBackendOnlyNotFoundHandler(outcome.app, selection);
    failureScope.commit();
    return outcome;
  } catch (error) {
    failureScope.rollbackSync();
    throw error;
  }
}

export async function runProductCompositionAsync(
  options: CreateComposedAppOptions,
  selection: HostCompositionSelection,
  productHostInput?: ProductHostCompositionInput,
): Promise<ProductCompositionOutcome> {
  const failureScope = createCompositionFailureScope();
  try {
    const preparedInputs = await prepareCompositionInputsAsync(options, selection, failureScope);
    const outcome = composeNextAgentApp(preparedInputs, failureScope, options.operationLogPort);
    if (productHostInput !== undefined) {
      const { completeWithFrontendProductComposition } = await import('../entrypoints/with-frontend-finalizer.js');
      await completeWithFrontendProductComposition(outcome.app, productHostInput);
    }
    ensureBackendOnlyNotFoundHandler(outcome.app, selection);
    failureScope.commit();
    return outcome;
  } catch (error) {
    await failureScope.rollbackAsync();
    throw error;
  }
}

function prepareCompositionInputsSync(
  options: CreateComposedAppOptions,
  selection: HostCompositionSelection,
  failureScope: CompositionFailureScope,
): PreparedCompositionInputs {
  // Layer 0: identity/clock -> bootstrap metrics -> config -> plugin -> host defaults -> remaining preload.
  const credentialResolver = requireAppCredentialResolver(options.credentialResolver);
  const identity = options.identity ?? defaultIdentity();
  const clock = createMonotonicClock();
  registerAcceptedInputOwnership({
    failureScope,
    ...(options.operationalLogWriter === undefined ? {} : { operationalLogWriter: options.operationalLogWriter }),
    ...(options.metricsInfrastructure === undefined ? {} : { metricsInfrastructure: options.metricsInfrastructure }),
    ...(options.gatewayBindings === undefined ? {} : { gatewayBindings: options.gatewayBindings }),
  });
  const configFailureObservability = prepareConfigFailureObservability({
    ...(options.metricsRegistry === undefined ? {} : { metricsRegistry: options.metricsRegistry }),
    ...(options.operationalLogWriter === undefined ? {} : { operationalLogWriter: options.operationalLogWriter }),
  });
  if (configFailureObservability.runtimeLoggerProviderBinding !== undefined) {
    failureScope.register('runtime-logger-binding', () => configFailureObservability.runtimeLoggerProviderBinding?.unbind());
  }
  const configuration = loadAppCompositionConfiguration({
    ...(options.systemConfig === undefined ? {} : { systemConfig: options.systemConfig }),
    ...(options.configFile === undefined ? {} : { configFile: options.configFile }),
    credentialResolver,
    metricsRegistry: configFailureObservability.metricsRegistry,
    ...(options.capabilityProviderReferenceValidation === undefined
      ? {}
      : { capabilityProviderReferenceValidation: options.capabilityProviderReferenceValidation }),
  });
  assertChannelAuthHostSafety(configuration.systemConfig, selection);
  const developerDiagnosticArtifactWriter = (options.developerDiagnosticArtifactWriterFactory ?? createDeveloperDiagnosticArtifactWriter)({
    logDirectory: configuration.systemConfig.paths.logDirectory,
  });
  const pluginRuntimeServices = createDeferredPluginRuntimeServices();
  if (developerDiagnosticArtifactWriter !== undefined) {
    failureScope.register('developer-diagnostic-artifact-writer', () => developerDiagnosticArtifactWriter.close(5_000));
  }
  const plugin = preloadPluginCompositionSync({
    systemConfig: configuration.systemConfig,
    ...(options.pluginRegistrySnapshot === undefined ? {} : { injectedSnapshot: options.pluginRegistrySnapshot }),
    hostServices: createPluginHostServices(pluginRuntimeServices.services, developerDiagnosticArtifactWriter),
  });
  const observability = preloadObservabilityCompositionSync({
    systemConfig: configuration.systemConfig,
    ...(options.serviceVersion === undefined ? {} : { serviceVersion: options.serviceVersion }),
    bootstrapMetricsRegistry: configFailureObservability.metricsRegistry,
    ...(options.operationalLogWriter === undefined ? {} : { operationalLogWriter: options.operationalLogWriter }),
    ...(options.metricsRegistry === undefined ? {} : { metricsRegistry: options.metricsRegistry }),
    ...(options.metricsInfrastructure === undefined ? {} : { metricsInfrastructure: options.metricsInfrastructure }),
    ...(options.metricsExporter === undefined ? {} : { metricsExporter: options.metricsExporter }),
    ...(configFailureObservability.runtimeLoggerProviderBinding === undefined
      ? {}
      : { runtimeLoggerProviderBinding: configFailureObservability.runtimeLoggerProviderBinding }),
    ...(options.traceProjector === undefined ? {} : { traceProjector: options.traceProjector }),
  });
  if (observability.metricsInfrastructure !== undefined && observability.metricsInfrastructure !== options.metricsInfrastructure) {
    registerMetricsInfrastructure(failureScope, observability.metricsInfrastructure);
  }
  const attachment = preloadAttachmentCompositionSync({
    ...(options.chatUploadFileConfig === undefined ? {} : { chatUploadFileConfig: options.chatUploadFileConfig }),
    ...(options.chatUploadConfigProvider === undefined ? {} : { chatUploadConfigProvider: options.chatUploadConfigProvider }),
  });
  const portalAbility = preloadPortalAbilityComposition({ systemConfig: configuration.systemConfig });
  const timelineTrace = createTimelineTraceRuntime({
    enabled: observability.traceEnabled,
  });
  const model = prepareModelComposition({
    systemConfig: configuration.systemConfig,
    ...(options.modelGatewayProviders === undefined ? {} : { modelGatewayProviders: options.modelGatewayProviders }),
    ...(options.modelProviderProfile === undefined ? {} : { modelProviderProfile: options.modelProviderProfile }),
  });
  return {
    identity: { credentialResolver, identity, clock },
    configuration,
    observability,
    plugin,
    pluginRuntimeServices,
    ...(developerDiagnosticArtifactWriter === undefined ? {} : { developerDiagnosticArtifactWriter }),
    attachment,
    portalAbility,
    model,
    timelineTrace,
    assemblyInput: {
      ...(options.agentDefinition === undefined ? {} : { agentDefinition: options.agentDefinition }),
    },
    gatewayInput: {
      ...(options.gatewayProviders === undefined ? {} : { gatewayProviders: options.gatewayProviders }),
      ...(options.gatewayBindings === undefined ? {} : { gatewayBindings: options.gatewayBindings }),
      ...(options.sandboxGatewayFactory === undefined ? {} : { sandboxGatewayFactory: options.sandboxGatewayFactory }),
      ...(options.sandboxGateway === undefined ? {} : { sandboxGateway: options.sandboxGateway }),
      ...(options.scheduledMaintenanceGatewayFactory === undefined
        ? {}
        : { scheduledMaintenanceGatewayFactory: options.scheduledMaintenanceGatewayFactory }),
      ...(options.cronTaskGatewayFactory === undefined ? {} : { cronTaskGatewayFactory: options.cronTaskGatewayFactory }),
      ...(options.ragRetrievalFactory === undefined ? {} : { ragRetrievalFactory: options.ragRetrievalFactory }),
      ...(options.clipCommandRunner === undefined ? {} : { clipCommandRunner: options.clipCommandRunner }),
      ...(options.questionRecommendationsGateway === undefined ? {} : { questionRecommendationsGateway: options.questionRecommendationsGateway }),
    },
    capabilityRuntimeInput: {
      ...(options.riskPolicyEvaluator === undefined ? {} : { riskPolicyEvaluator: options.riskPolicyEvaluator }),
      ...(options.registeredCustomAdapterTypes === undefined ? {} : { registeredCustomAdapterTypes: options.registeredCustomAdapterTypes }),
      ...(options.skillHubAccessFactory === undefined ? {} : { skillHubAccessFactory: options.skillHubAccessFactory }),
      ...(options.backgroundTaskStoreFactory === undefined ? {} : { backgroundTaskStoreFactory: options.backgroundTaskStoreFactory }),
      ...(options.cronTaskIdFactory === undefined ? {} : { cronTaskIdFactory: options.cronTaskIdFactory }),
    },
    lifecycleWorkflowInput: {
      ...(options.lifecycleHooks === undefined ? {} : { lifecycleHooks: options.lifecycleHooks }),
      ...(options.lifecycleHook === undefined ? {} : { lifecycleHook: options.lifecycleHook }),
      ...(options.lifecycleHookDefinitions === undefined ? {} : { lifecycleHookDefinitions: options.lifecycleHookDefinitions }),
      ...(options.workflowExecutionServiceFactory === undefined ? {} : { workflowExecutionServiceFactory: options.workflowExecutionServiceFactory }),
      ...(options.workflowExecutionMode === undefined ? {} : { workflowExecutionMode: options.workflowExecutionMode }),
      ...(options.workflowRemoteExecutionGateway === undefined ? {} : { workflowRemoteExecutionGateway: options.workflowRemoteExecutionGateway }),
    },
    channelInput: {
      channelAuthProfile: selection.channelAuthProfile,
      ...(selection.localConfiguredAuthContribution === undefined
        ? {}
        : { localConfiguredAuthContribution: selection.localConfiguredAuthContribution }),
      ...(options.webChannelRegistration === undefined ? {} : { webChannelRegistration: options.webChannelRegistration }),
      ...(options.webIdentityResolver === undefined ? {} : { webIdentityResolver: options.webIdentityResolver }),
      ...(options.trustedLocalWebExtensionRegistration === undefined
        ? {}
        : { trustedLocalWebExtensionRegistration: options.trustedLocalWebExtensionRegistration }),
      ...(options.trustedLocalWebExtensionProtectedPrefixes === undefined
        ? {}
        : { trustedLocalWebExtensionProtectedPrefixes: options.trustedLocalWebExtensionProtectedPrefixes }),
      ...(options.taskChannelRegistration === undefined ? {} : { taskChannelRegistration: options.taskChannelRegistration }),
    },
    cronInput: {
      deploymentSelection: resolveCronDeploymentSelection(configuration.systemConfig),
      ...(options.cronTaskSchedulerFactory === undefined ? {} : { cronTaskSchedulerFactory: options.cronTaskSchedulerFactory }),
      ...(options.cronTriggerCallbackCredentialRef === undefined
        ? {}
        : { cronTriggerCallbackCredentialRef: options.cronTriggerCallbackCredentialRef }),
      ...(options.cronTriggerCallbackRegistration === undefined ? {} : { cronTriggerCallbackRegistration: options.cronTriggerCallbackRegistration }),
      ...(options.operationLogPort === undefined ? {} : { operationLogPort: options.operationLogPort }),
    },
  };
}

async function prepareCompositionInputsAsync(
  options: CreateComposedAppOptions,
  selection: HostCompositionSelection,
  failureScope: CompositionFailureScope,
): Promise<PreparedCompositionInputs> {
  // Layer 0: identity/clock -> bootstrap metrics -> config -> plugin -> host defaults -> remaining preload.
  const credentialResolver = requireAppCredentialResolver(options.credentialResolver);
  const identity = options.identity ?? defaultIdentity();
  const clock = createMonotonicClock();
  registerAcceptedInputOwnership({
    failureScope,
    ...(options.operationalLogWriter === undefined ? {} : { operationalLogWriter: options.operationalLogWriter }),
    ...(options.metricsInfrastructure === undefined ? {} : { metricsInfrastructure: options.metricsInfrastructure }),
    ...(options.gatewayBindings === undefined ? {} : { gatewayBindings: options.gatewayBindings }),
  });
  const bootstrapMetricsRegistry = prepareConfigFailureMetricsRegistry(options.metricsRegistry);
  const configuration = loadAppCompositionConfiguration({
    ...(options.systemConfig === undefined ? {} : { systemConfig: options.systemConfig }),
    ...(options.configFile === undefined ? {} : { configFile: options.configFile }),
    credentialResolver,
    metricsRegistry: bootstrapMetricsRegistry,
    ...(options.capabilityProviderReferenceValidation === undefined
      ? {}
      : { capabilityProviderReferenceValidation: options.capabilityProviderReferenceValidation }),
  });
  assertChannelAuthHostSafety(configuration.systemConfig, selection);
  let localRuntimeBindings: Awaited<ReturnType<typeof loadLocalRuntimeBindings>> | undefined;
  const developerDiagnosticArtifactWriter = (options.developerDiagnosticArtifactWriterFactory ?? createDeveloperDiagnosticArtifactWriter)({
    logDirectory: configuration.systemConfig.paths.logDirectory,
  });
  const pluginRuntimeServices = createDeferredPluginRuntimeServices();
  if (developerDiagnosticArtifactWriter !== undefined) {
    failureScope.register('developer-diagnostic-artifact-writer', () => developerDiagnosticArtifactWriter.close(5_000));
  }
  const plugin = await preloadPluginCompositionAsync({
    systemConfig: configuration.systemConfig,
    ...(options.pluginRegistrySnapshot === undefined ? {} : { injectedSnapshot: options.pluginRegistrySnapshot }),
    hostServices: createPluginHostServices(pluginRuntimeServices.services, developerDiagnosticArtifactWriter),
  });
  let gatewayProviders = options.gatewayProviders;
  let sandboxGatewayFactory = options.sandboxGatewayFactory;
  let scheduledMaintenanceGatewayFactory = options.scheduledMaintenanceGatewayFactory;
  let cronTaskGatewayFactory = options.cronTaskGatewayFactory;
  let cronTaskSchedulerFactory = options.cronTaskSchedulerFactory;
  let ragRetrievalFactory = options.ragRetrievalFactory;
  let backgroundTaskStoreFactory = options.backgroundTaskStoreFactory;
  let trustedLocalWebExtensionRegistration = options.trustedLocalWebExtensionRegistration;
  let trustedLocalWebExtensionProtectedPrefixes = options.trustedLocalWebExtensionProtectedPrefixes;
  const needsLocalFrontendDefaults =
    selection.frontendHostingProfile === 'WITH_FRONTEND' &&
    (gatewayProviders === undefined ||
      sandboxGatewayFactory === undefined ||
      scheduledMaintenanceGatewayFactory === undefined ||
      cronTaskGatewayFactory === undefined ||
      cronTaskSchedulerFactory === undefined ||
      ragRetrievalFactory === undefined ||
      backgroundTaskStoreFactory === undefined ||
      trustedLocalWebExtensionRegistration === undefined ||
      trustedLocalWebExtensionProtectedPrefixes === undefined);
  if (needsLocalFrontendDefaults) {
    const localGateway = localRuntimeBindings ?? (await loadLocalRuntimeBindings());
    gatewayProviders ??= [
      localGateway.createSqliteWorkingMemoryGatewayProvider('local-working-memory-gateway', {
        forkActiveContextSelector: createForkActiveContextSelector(),
      }),
      localGateway.createSqliteLongTermMemoryGatewayProvider(),
      localGateway.createLocalGatewayProvider('local-gateway', { allowedApis: configuration.systemConfig.sandbox.allowedApis }),
    ];
    sandboxGatewayFactory ??= localGateway.createRestrictedLocalSandboxGateway;
    scheduledMaintenanceGatewayFactory ??= localGateway.createLocalScheduledMaintenanceGateway;
    cronTaskGatewayFactory ??= localGateway.createSqliteCronTaskGateway;
    cronTaskSchedulerFactory ??= localGateway.createLocalCronTaskScheduler;
    ragRetrievalFactory ??= localGateway.createLocalRagKnowledgeGovernance;
    backgroundTaskStoreFactory ??= localGateway.createLocalBackgroundTaskStore;
    trustedLocalWebExtensionRegistration ??= localGateway.workbenchContribution;
    trustedLocalWebExtensionProtectedPrefixes ??= localGateway.protectedPathPrefixes;
  }
  // Create apiCallPort based on api-call gateway selection
  let apiCallPort: ApiCallPort;
  if (isGatewayAdapterSelectedForDeployment(configuration.systemConfig, 'api-call', 'REMOTE')) {
    apiCallPort = await loadRemoteApiCallPort();
  } else {
    const localGateway = localRuntimeBindings ?? (await loadLocalRuntimeBindings());
    apiCallPort = localGateway.createLocalApiCallPort();
  }
  const observability = await preloadObservabilityCompositionAsync({
    systemConfig: configuration.systemConfig,
    ...(options.serviceVersion === undefined ? {} : { serviceVersion: options.serviceVersion }),
    bootstrapMetricsRegistry,
    ...(options.operationalLogWriter === undefined ? {} : { operationalLogWriter: options.operationalLogWriter }),
    ...(options.metricsRegistry === undefined ? {} : { metricsRegistry: options.metricsRegistry }),
    ...(options.metricsInfrastructure === undefined ? {} : { metricsInfrastructure: options.metricsInfrastructure }),
    ...(options.metricsExporter === undefined ? {} : { metricsExporter: options.metricsExporter }),
    credentialResolver,
    ...(options.traceProjector === undefined ? {} : { traceProjector: options.traceProjector }),
  });
  registerCreatedObservabilityOwnership({
    failureScope,
    observability,
    ...(options.operationalLogWriter === undefined ? {} : { injectedOperationalLogWriter: options.operationalLogWriter }),
    ...(options.metricsInfrastructure === undefined ? {} : { injectedMetricsInfrastructure: options.metricsInfrastructure }),
  });
  const attachment = await preloadAttachmentCompositionAsync({
    systemConfig: configuration.systemConfig,
    ...(options.chatUploadFileConfig === undefined ? {} : { chatUploadFileConfig: options.chatUploadFileConfig }),
    ...(options.chatUploadConfigProvider === undefined ? {} : { chatUploadConfigProvider: options.chatUploadConfigProvider }),
  });
  const portalAbility = preloadPortalAbilityComposition({ systemConfig: configuration.systemConfig });
  const timelineTrace = createTimelineTraceRuntime({
    enabled: observability.traceEnabled,
  });
  const model = prepareModelComposition({
    systemConfig: configuration.systemConfig,
    ...(options.modelGatewayProviders === undefined ? {} : { modelGatewayProviders: options.modelGatewayProviders }),
    ...(options.modelProviderProfile === undefined ? {} : { modelProviderProfile: options.modelProviderProfile }),
  });
  return {
    identity: { credentialResolver, identity, clock },
    configuration,
    observability,
    plugin,
    pluginRuntimeServices,
    ...(developerDiagnosticArtifactWriter === undefined ? {} : { developerDiagnosticArtifactWriter }),
    attachment,
    portalAbility,
    model,
    timelineTrace,
    assemblyInput: {
      ...(options.agentDefinition === undefined ? {} : { agentDefinition: options.agentDefinition }),
    },
    gatewayInput: {
      ...(gatewayProviders === undefined ? {} : { gatewayProviders }),
      ...(options.gatewayBindings === undefined ? {} : { gatewayBindings: options.gatewayBindings }),
      ...(sandboxGatewayFactory === undefined ? {} : { sandboxGatewayFactory }),
      ...(options.sandboxGateway === undefined ? {} : { sandboxGateway: options.sandboxGateway }),
      ...(scheduledMaintenanceGatewayFactory === undefined ? {} : { scheduledMaintenanceGatewayFactory }),
      ...(cronTaskGatewayFactory === undefined ? {} : { cronTaskGatewayFactory }),
      ...(ragRetrievalFactory === undefined ? {} : { ragRetrievalFactory }),
      ...(options.clipCommandRunner === undefined ? {} : { clipCommandRunner: options.clipCommandRunner }),
      ...(options.questionRecommendationsGateway === undefined ? {} : { questionRecommendationsGateway: options.questionRecommendationsGateway }),
    },
    capabilityRuntimeInput: {
      ...(options.riskPolicyEvaluator === undefined ? {} : { riskPolicyEvaluator: options.riskPolicyEvaluator }),
      ...(options.registeredCustomAdapterTypes === undefined ? {} : { registeredCustomAdapterTypes: options.registeredCustomAdapterTypes }),
      ...(options.skillHubAccessFactory === undefined ? {} : { skillHubAccessFactory: options.skillHubAccessFactory }),
      ...(backgroundTaskStoreFactory === undefined ? {} : { backgroundTaskStoreFactory }),
      ...(options.cronTaskIdFactory === undefined ? {} : { cronTaskIdFactory: options.cronTaskIdFactory }),
      apiCallPort,
    },
    lifecycleWorkflowInput: {
      ...(options.lifecycleHooks === undefined ? {} : { lifecycleHooks: options.lifecycleHooks }),
      ...(options.lifecycleHook === undefined ? {} : { lifecycleHook: options.lifecycleHook }),
      ...(options.lifecycleHookDefinitions === undefined ? {} : { lifecycleHookDefinitions: options.lifecycleHookDefinitions }),
      ...(options.workflowExecutionServiceFactory === undefined ? {} : { workflowExecutionServiceFactory: options.workflowExecutionServiceFactory }),
      ...(options.workflowExecutionMode === undefined ? {} : { workflowExecutionMode: options.workflowExecutionMode }),
      ...(options.workflowRemoteExecutionGateway === undefined ? {} : { workflowRemoteExecutionGateway: options.workflowRemoteExecutionGateway }),
    },
    channelInput: {
      channelAuthProfile: selection.channelAuthProfile,
      ...(selection.localConfiguredAuthContribution === undefined
        ? {}
        : { localConfiguredAuthContribution: selection.localConfiguredAuthContribution }),
      ...(options.webChannelRegistration === undefined ? {} : { webChannelRegistration: options.webChannelRegistration }),
      ...(options.webIdentityResolver === undefined ? {} : { webIdentityResolver: options.webIdentityResolver }),
      ...(trustedLocalWebExtensionRegistration === undefined ? {} : { trustedLocalWebExtensionRegistration }),
      ...(trustedLocalWebExtensionProtectedPrefixes === undefined ? {} : { trustedLocalWebExtensionProtectedPrefixes }),
      ...(options.taskChannelRegistration === undefined ? {} : { taskChannelRegistration: options.taskChannelRegistration }),
    },
    cronInput: {
      deploymentSelection: resolveCronDeploymentSelection(configuration.systemConfig),
      ...(cronTaskSchedulerFactory === undefined ? {} : { cronTaskSchedulerFactory }),
      ...(options.cronTriggerCallbackCredentialRef === undefined
        ? {}
        : { cronTriggerCallbackCredentialRef: options.cronTriggerCallbackCredentialRef }),
      ...(options.cronTriggerCallbackRegistration === undefined ? {} : { cronTriggerCallbackRegistration: options.cronTriggerCallbackRegistration }),
      ...(options.operationLogPort === undefined ? {} : { operationLogPort: options.operationLogPort }),
    },
  };
}

function composeNextAgentApp(
  preparedInputs: PreparedCompositionInputs,
  failureScope: CompositionFailureScope,
  operationLogPort?: OperationLogGatewayPort,
): ProductCompositionOutcome {
  const { clock, credentialResolver, identity } = preparedInputs.identity;
  const configuration = preparedInputs.configuration;
  const systemConfig = configuration.systemConfig;
  const observability = preparedInputs.observability;
  const pluginComposition = preparedInputs.plugin;
  const developerDiagnosticArtifactWriter = preparedInputs.developerDiagnosticArtifactWriter;
  const attachmentPreparation = preparedInputs.attachment;
  const portalAbilityConfigProvider = preparedInputs.portalAbility.provider;
  const { metricsInfrastructure, metricsRegistry, observationLogger, runtimeLoggerProviderBinding } = observability;
  const traceEnabled = observability.traceEnabled;
  const timelineTrace = preparedInputs.timelineTrace;
  if (observability.traceProjector !== undefined && 'bindTimelineSpanRegistry' in observability.traceProjector) {
    const bindTimelineSpanRegistry = observability.traceProjector.bindTimelineSpanRegistry;
    if (typeof bindTimelineSpanRegistry === 'function') {
      bindTimelineSpanRegistry.call(observability.traceProjector, timelineTrace.registry);
    }
  }
  const cronDeploymentSelection = preparedInputs.cronInput.deploymentSelection;
  logger.info({ event: 'app.config.accepted' });
  // Layer 1: startup contributions.
  const lifecycleHookComposition = composeLifecycleHookDefinitions({
    pluginHooks: pluginComposition.lifecycleHooks,
    ...(preparedInputs.lifecycleWorkflowInput.lifecycleHooks === undefined
      ? {}
      : { lifecycleHooks: preparedInputs.lifecycleWorkflowInput.lifecycleHooks }),
    ...(preparedInputs.lifecycleWorkflowInput.lifecycleHookDefinitions === undefined
      ? {}
      : { lifecycleHookDefinitions: preparedInputs.lifecycleWorkflowInput.lifecycleHookDefinitions }),
  });
  const { executableHooks, startupLifecycleHooks, lifecycleHookDefinitions } = lifecycleHookComposition;
  const deferredBindings = createCompositionDeferredBindings();
  const lifecycleHookInvocation = deferredBindings.lifecycleHookInvocation;
  const referenceValidation = configuration.capabilityProviderReferenceValidation;
  const skillHubAccessFactory = preparedInputs.capabilityRuntimeInput.skillHubAccessFactory;
  const capabilityProviders = resolveCapabilityProviderComposition({
    systemConfig,
    referenceValidation,
    ...(preparedInputs.capabilityRuntimeInput.registeredCustomAdapterTypes === undefined
      ? {}
      : { registeredCustomAdapterTypes: preparedInputs.capabilityRuntimeInput.registeredCustomAdapterTypes }),
    ...(skillHubAccessFactory === undefined ? {} : { skillHubAccessFactory }),
  });
  // Layer 2: static Agent assembly.
  const assemblyLayer = composeAgentAssemblyLayer({
    systemConfig,
    ...(preparedInputs.assemblyInput.agentDefinition === undefined ? {} : { agentDefinition: preparedInputs.assemblyInput.agentDefinition }),
    identity,
    lifecycleHookDefinitions: lifecycleHookDefinitions ?? [],
    pluginPolicies: pluginComposition.assemblyAndRequestPolicies,
  });
  const {
    agentDefinition,
    resourceReferences,
    recipeDefinitionSource,
    recipeCapabilityProvider,
    agentAssemblies,
    assemblyValidationReferences,
    assemblyRegistry,
    defaultRouteAssembly,
    defaultRouteAgentScope,
    defaultRouteOwnerScope,
    agentScopesByAgentId,
    agentPackageSourceLocator,
    executionWorkspaceResolver,
  } = assemblyLayer;
  prepareConfiguredAppDirectories(systemConfig);
  const lifecycleHookMaterialization = composeLifecycleHookMaterialization({
    lifecycleHookDefinitions: lifecycleHookDefinitions ?? [],
    agentAssemblies,
    startupLifecycleHooks,
    executableHooks,
    ...(preparedInputs.lifecycleWorkflowInput.lifecycleHook === undefined
      ? {}
      : { lifecycleHook: preparedInputs.lifecycleWorkflowInput.lifecycleHook }),
  });
  const { lifecycleHookSnapshots, lifecycleHook } = lifecycleHookMaterialization;
  const { promptTemplateRegistry, promptTemplateAssembler, promptTemplateResolver } = composePromptTemplateLayer({
    systemConfig,
    agentDefinition,
    agentAssemblies,
  });
  // Layer 3: platform infrastructure.
  const observabilityInfrastructure = composeObservabilityInfrastructure({
    systemConfig,
    metricsRegistry,
    ...(observationLogger === undefined ? {} : { observationLogger }),
    ...(observability.traceProjector === undefined ? {} : { traceProjector: observability.traceProjector }),
    defaultRouteOwnerScope,
  });
  const gatewayLayer = composeGatewayLayer({
    systemConfig,
    sandboxRuntimeInput: configuration.sandboxRuntimeInput,
    identity,
    defaultRouteAssembly,
    executionCorrelation: timelineTrace.correlation,
    ...(preparedInputs.gatewayInput.gatewayProviders === undefined ? {} : { gatewayProviders: preparedInputs.gatewayInput.gatewayProviders }),
    ...(preparedInputs.gatewayInput.gatewayBindings === undefined ? {} : { gatewayBindings: preparedInputs.gatewayInput.gatewayBindings }),
    ...(preparedInputs.gatewayInput.sandboxGatewayFactory === undefined
      ? {}
      : { sandboxGatewayFactory: preparedInputs.gatewayInput.sandboxGatewayFactory }),
    ...(preparedInputs.gatewayInput.sandboxGateway === undefined ? {} : { sandboxGateway: preparedInputs.gatewayInput.sandboxGateway }),
    ...(preparedInputs.gatewayInput.scheduledMaintenanceGatewayFactory === undefined
      ? {}
      : { scheduledMaintenanceGatewayFactory: preparedInputs.gatewayInput.scheduledMaintenanceGatewayFactory }),
    ...(preparedInputs.gatewayInput.cronTaskGatewayFactory === undefined
      ? {}
      : { cronTaskGatewayFactory: preparedInputs.gatewayInput.cronTaskGatewayFactory }),
    ...(preparedInputs.gatewayInput.ragRetrievalFactory === undefined
      ? {}
      : { ragRetrievalFactory: preparedInputs.gatewayInput.ragRetrievalFactory }),
  });
  const {
    gatewayBindings,
    sandboxGateway: unobservedSandboxGateway,
    scheduledMaintenance,
    cronTasks: cronTaskGateway,
    closeCronTasks,
    sqliteGateway,
    gateway,
    ragKnowledgeGovernance,
    ragRetrieval,
    todoState,
    localPersistenceSelected,
    ensureRagKnowledgeBuilt,
    workflowRagGateway,
  } = gatewayLayer;
  for (const handle of gatewayLayer.cleanupHandles) {
    if (handle.stage !== 'gateway-bindings' || preparedInputs.gatewayInput.gatewayBindings === undefined) {
      failureScope.register(handle.stage, handle.cleanup);
    }
  }
  logger.info({ event: 'gateway.initialized' });
  const { modelCatalog, modelInvocationService } = composeModelRuntime({
    composition: preparedInputs.model,
    credentialResolver,
    assemblyRegistry,
    lifecycleHookInvocation,
    executionCorrelation: timelineTrace.correlation,
    ...(gatewayBindings.fetch === undefined ? {} : { fetchGateway: gatewayBindings.fetch }),
  });
  logger.info({ event: 'agent.assemblies.compiled', agentCount: agentAssemblies.length });
  const modelSelectionService = composeModelSelectionService({
    assemblyRegistry,
    modelCatalog,
    promptTemplateRegistry,
  });
  const { projectorHost, auditWriter } = observabilityInfrastructure.complete({
    gatewayAuditStore: gatewayBindings.audit,
  });
  failureScope.register('observability-projectors', () => projectorHost.close?.(5_000));
  const gatewayObservability = completeGatewayObservability({
    sandboxGateway: unobservedSandboxGateway,
    projectorHost,
    ownerScope: defaultRouteOwnerScope,
    identity,
    executionCorrelation: timelineTrace.correlation,
    remoteSandbox: systemConfig.gateway.deploymentMode === 'REMOTE',
    ...(preparedInputs.gatewayInput.clipCommandRunner === undefined
      ? {}
      : { injectedClipCommandRunner: preparedInputs.gatewayInput.clipCommandRunner }),
  });
  const { sandboxGateway, clipCommandRunner } = gatewayObservability;
  reportModelDiagnostics({
    validationEvidence: systemConfig.modelProfileValidationEvidence,
    projectorHost,
    ownerScope: defaultRouteOwnerScope,
    agentScope: defaultRouteAgentScope,
  });
  // Layer 4: execution capabilities.
  const riskPolicyEvaluator = prepareRequestRuntimePolicy({
    ...(preparedInputs.capabilityRuntimeInput.riskPolicyEvaluator === undefined
      ? {}
      : { riskPolicyEvaluator: preparedInputs.capabilityRuntimeInput.riskPolicyEvaluator }),
  });
  const cronCapability = composeCronCapabilityLayer({
    deploymentSelection: cronDeploymentSelection,
    ...(cronTaskGateway === undefined ? {} : { cronTasks: cronTaskGateway }),
    ...(preparedInputs.capabilityRuntimeInput.cronTaskIdFactory === undefined
      ? {}
      : { cronTaskIdFactory: preparedInputs.capabilityRuntimeInput.cronTaskIdFactory }),
    clock,
    projectorHost,
  });
  const memoryCapability = composeMemoryCapabilityLayer({
    systemConfig,
    agentAssemblies,
    gateway,
    localPersistenceSelected,
    identity,
    agentScopesByAgentId,
    projectorHost,
    metricsRegistry,
    ownerScope: defaultRouteOwnerScope,
    agentScope: defaultRouteAgentScope,
    ...(gatewayBindings.guardrail === undefined ? {} : { guardrail: gatewayBindings.guardrail }),
  });
  const backgroundTasks = composeBackgroundTaskLayer({
    ...(preparedInputs.capabilityRuntimeInput.backgroundTaskStoreFactory === undefined
      ? {}
      : { storeFactory: preparedInputs.capabilityRuntimeInput.backgroundTaskStoreFactory }),
    runtimeTimeline: deferredBindings.backgroundRuntimeTimeline,
  });
  const workflowExecutionService = composeWorkflowExecutionLayer({
    systemConfig,
    ...(preparedInputs.lifecycleWorkflowInput.workflowExecutionMode === undefined
      ? {}
      : { workflowExecutionMode: preparedInputs.lifecycleWorkflowInput.workflowExecutionMode }),
    ...(preparedInputs.lifecycleWorkflowInput.workflowRemoteExecutionGateway === undefined
      ? {}
      : { workflowRemoteExecutionGateway: preparedInputs.lifecycleWorkflowInput.workflowRemoteExecutionGateway }),
    ...(preparedInputs.lifecycleWorkflowInput.workflowExecutionServiceFactory === undefined
      ? {}
      : { workflowExecutionServiceFactory: preparedInputs.lifecycleWorkflowInput.workflowExecutionServiceFactory }),
    recipeDefinitionSource,
    credentialResolver,
    lifecycleHook,
    ragKnowledgeGovernance,
    workflowRagGateway,
    ensureRagKnowledgeBuilt,
    workflowCapabilityInvocation: deferredBindings.workflowCapabilityInvocation,
    workflowSandboxExecution: deferredBindings.workflowSandboxExecution,
    modelInvocationService,
    workflowRuntimeAdapters: deferredBindings.workflowRuntimeAdapters,
    executionCorrelation: timelineTrace.correlation,
  });
  const parameterExtractionPort = createParameterExtractionPort({
    modelInvocationService,
    modelSelectionService,
    assemblyRegistry,
  });
  const apiCallPort = preparedInputs.capabilityRuntimeInput.apiCallPort!;
  const capabilityLayer = composeCapabilityLayer({
    systemConfig,
    agentDefinition,
    capabilityProviders,
    recipeCapabilityProvider,
    pluginCapabilityProviders: pluginComposition.capabilityProviders,
    ...(memoryCapability.memoryCapabilityProvider === undefined ? {} : { memoryCapabilityProvider: memoryCapability.memoryCapabilityProvider }),
    assemblyRegistry,
    agentAssemblies,
    assemblyValidationReferences,
    lifecycleHookDefinitions,
    pluginPolicies: pluginComposition.assemblyAndRequestPolicies,
    executionWorkspaceResolver,
    sandboxGateway,
    riskPolicyEvaluator,
    ragRetrieval,
    todoState,
    ...(cronCapability.enabled ? { cronTasks: cronCapability.capabilityPort } : {}),
    recipeDefinitionSource,
    workflowExecutionService,
    agentPackageSourceLocator,
    skillHubAccessFactory,
    executionCorrelation: timelineTrace.correlation,
    defaultRouteAssembly,
    clipCommandRunner,
    gateway,
    promptTemplateAssembler,
    modelSelectionService,
    scheduledMaintenance,
    runtimeSubagentExecution: deferredBindings.runtimeSubagentExecution,
    parameterExtractionPort,
    apiCallPort,
    backgroundTasks,
    ...(gatewayBindings?.guardrail === undefined ? {} : { guardrail: gatewayBindings.guardrail }),
    modelCatalog,
  });
  const capabilitySubsystem = capabilityLayer.subsystem;
  const catalog = capabilityLayer.catalog;
  preparedInputs.pluginRuntimeServices.bind({
    agentAssemblies: assemblyRegistry,
    capabilityCatalog: catalog,
    capabilityInvocation: capabilityLayer.invocationPort,
    modelSelection: modelSelectionService,
    modelInvocation: modelInvocationService,
    promptTemplates: promptTemplateResolver,
  });
  assemblyRegistry.updateValidationReferences(capabilityLayer.assemblyValidationReferences);
  deferredBindings.bindWorkflowRuntimeAdapters(capabilityLayer.workflowRuntimeAdapters);
  deferredBindings.bindWorkflowCapabilityInvocation(capabilityLayer.invocationPort);
  if (capabilitySubsystem.workflowSandboxExecution !== undefined) {
    deferredBindings.bindWorkflowSandboxExecution(capabilitySubsystem.workflowSandboxExecution);
  }
  // Layer 5: application services.
  const {
    attachmentRuntime,
    attachmentCleanupRuntime,
    attachmentExecutionRuntime,
    stagedUploadRuntime,
    fileDownloadRuntime,
    attachmentSummaryResolver,
  } = composeAttachmentLayer({
    gateway,
    clock,
    projectorHost,
    defaultRouteOwnerScope,
    uploadTempDir: systemConfig.paths.uploadTempDir,
    downloadTempDir: systemConfig.paths.downloadTempDir,
    scheduledMaintenance,
  });
  const memoryMaintenance = composeMemoryMaintenanceLayer({
    localPersistenceSelected,
    systemConfig,
    gateway,
    identity,
    agentScopesByAgentId,
    projectorHost,
    assemblyRegistry,
    modelSelectionService,
    modelInvocationService,
    promptTemplateAssembler,
    memoryCapability,
    ...(gatewayBindings.guardrail === undefined ? {} : { guardrail: gatewayBindings.guardrail }),
  });
  if (memoryMaintenance.taskTrajectoryWorker !== undefined) {
    failureScope.register('task-trajectory-worker', () => memoryMaintenance.taskTrajectoryWorker?.stop());
  }
  for (const scheduler of memoryMaintenance.memoryAgingSchedulers) {
    failureScope.register('memory-aging-scheduler', () => scheduler.stop());
  }
  for (const scheduler of memoryMaintenance.memoryExtractionSchedulers) {
    failureScope.register('memory-extraction-scheduler', () => scheduler.stop());
  }
  const sessionServices = composeSessionServicesLayer({
    systemConfig,
    gateway,
    clock,
    modelInvocationService,
    assemblyRegistry,
    modelSelectionService,
    catalog,
    agentPackageSourceLocator,
    portalAbilityConfigProvider,
    ...(preparedInputs.gatewayInput.questionRecommendationsGateway === undefined
      ? {}
      : { questionRecommendations: preparedInputs.gatewayInput.questionRecommendationsGateway }),
  });
  failureScope.register('session-activity', () => sessionServices.sessionActivityService.close());
  const contextLayer = composeContextEngineLayer({
    systemConfig,
    executionWorkspaceResolver,
    assemblyRegistry,
    gateway,
    catalog,
    modelInvocationService,
    modelSelectionService,
    promptTemplateRegistry,
    promptTemplateAssembler,
    lifecycleHookInvocation,
    now: clock,
    projectorHost,
  });
  const health = composeHealthEvaluator({
    metricsRegistry,
    gateway,
    identity,
    defaultRouteAgentId: systemConfig.activeAgentId,
    modelCatalog,
    assemblyRegistry,
    catalog,
    projectorHost,
    ownerScope: defaultRouteOwnerScope,
    agentScope: defaultRouteAgentScope,
  });
  const trustedTerminalLifecycleHook = createUserQueryMemoryRecallTrustedHook({
    assemblyRegistry,
    requestRuns: gateway.requestRuns,
    messages: gateway.messages,
    longTermMemoryRetriever: gateway.longTermMemoryRetriever,
    longTermMemoryStore: gateway.longTermMemoryStore,
  });
  // Layer 6: request runtime and product channels.
  const requestRuntimeLayer = composeRequestRuntimeLayer({
    systemConfig,
    agentAssemblies,
    pluginPolicies: pluginComposition.assemblyAndRequestPolicies,
    assemblyRegistry,
    agentSelectionPolicy: createDefaultAgentSelectionPolicy(),
    contextLayer,
    modelInvocationService,
    catalog,
    capabilitySubsystem,
    riskPolicyEvaluator,
    lifecycleHookInvocation,
    recipeDefinitionSource,
    workflowExecutionService,
    sessions: sessionServices.sessions,
    sessionActivities: sessionServices.sessionActivityService,
    gateway,
    lifecycleHook,
    trustedTerminalLifecycleHook,
    lifecycleHookDefinitions,
    lifecycleHookSnapshots,
    clock,
    memoryMaintenance,
    projectorHost,
    defaultRouteAgentScope,
    precomputedSuggestedQuestions: sessionServices.suggestedQuestions,
    portalAbilityConfigProvider,
    executionWorkspaceResolver,
    attachmentExecutionRuntime,
    bindLifecycleHookInvocationTarget: deferredBindings.bindLifecycleHookInvocationTarget,
    executionCorrelation: timelineTrace.correlation,
    timelineSpanLifecycle: timelineTrace.lifecycle,
    traceEnabled,
    ...(operationLogPort === undefined ? {} : { operationLogPort }),
  });
  deferredBindings.bindRuntimeSubagentExecution(requestRuntimeLayer.runtimeSubagentExecution);
  const { runtime, trackedRuntimeCommands } = requestRuntimeLayer;
  if (runtime.close !== undefined) {
    failureScope.register('request-runtime', () => runtime.close?.());
  }
  deferredBindings.bindBackgroundRuntimeTimelineTarget(runtime);
  const cronTriggerDelivery = cronCapability.enabled
    ? createRuntimeCronTriggerDelivery({
        runtime,
        cronTasks: cronCapability.cronTasks,
        requestRuns: gateway.requestRuns,
        projectorHost,
        locale: brand<string, 'RequestLocale'>(defaultRouteAssembly.runtimeSettings.defaultLanguage ?? 'zh-CN'),
      })
    : undefined;
  const cronTaskManagement =
    cronTaskGateway === undefined
      ? undefined
      : createCronTaskManagementService({
          cronTasks: cronTaskGateway,
          requestRuns: gateway.requestRuns,
          timeline: gateway.timeline,
          messages: gateway.messages,
          ...(cronTriggerDelivery === undefined ? {} : { delivery: cronTriggerDelivery }),
          ...(preparedInputs.capabilityRuntimeInput.cronTaskIdFactory === undefined
            ? {}
            : { taskIdFactory: preparedInputs.capabilityRuntimeInput.cronTaskIdFactory }),
        });
  const chatUploadFileConfig = attachmentPreparation.chatUploadFileConfig;
  const chatUploadConfigProvider = attachmentPreparation.chatUploadConfigProvider;
  // Create a lazy-reading provider so watermark config is read at request time,
  // not at startup, surviving CSI volume late-mount in K8s deployments.
  const watermarkConfigProvider = gatewayBindings?.watermark !== undefined ? createWatermarkConfigProvider(systemConfig) : undefined;
  const channelLayer = composeProductChannelLayer({
    traceEnabled,
    executionCorrelation: timelineTrace.correlation,
    channelAuthProfile: preparedInputs.channelInput.channelAuthProfile,
    ...(preparedInputs.channelInput.localConfiguredAuthContribution === undefined
      ? {}
      : { localConfiguredAuthContribution: preparedInputs.channelInput.localConfiguredAuthContribution }),
    ...(preparedInputs.channelInput.webChannelRegistration === undefined
      ? {}
      : { webChannelRegistration: preparedInputs.channelInput.webChannelRegistration }),
    ...(preparedInputs.channelInput.trustedLocalWebExtensionRegistration === undefined
      ? {}
      : { trustedLocalWebExtensionRegistration: preparedInputs.channelInput.trustedLocalWebExtensionRegistration }),
    ...(preparedInputs.channelInput.trustedLocalWebExtensionProtectedPrefixes === undefined
      ? {}
      : { trustedLocalWebExtensionProtectedPrefixes: preparedInputs.channelInput.trustedLocalWebExtensionProtectedPrefixes }),
    ...(preparedInputs.channelInput.taskChannelRegistration === undefined
      ? {}
      : { taskChannelRegistration: preparedInputs.channelInput.taskChannelRegistration }),
    ...(preparedInputs.channelInput.webIdentityResolver === undefined
      ? {}
      : { webIdentityResolver: preparedInputs.channelInput.webIdentityResolver }),
    context: {
      runtime,
      runtimeCommands: trackedRuntimeCommands,
      attachmentRuntime,
      attachmentCleanupRuntime,
      systemConfig,
      credentialResolver,
      identity,
      health,
      catalog,
      capabilityCurrentView: capabilitySubsystem.currentView,
      assemblyRegistry,
      annotationService: sessionServices.annotationService,
      shareService: sessionServices.shareService,
      suggestedQuestions: sessionServices.suggestedQuestions,
      categoryQuestions: sessionServices.categoryQuestions,
      frequentQuestions: sessionServices.frequentQuestions,
      sessionActivities: sessionServices.runtimeSessionActivities,
      sandboxGateway,
      ...(chatUploadFileConfig === undefined ? {} : { chatUploadFileConfig }),
      ...(chatUploadConfigProvider === undefined ? {} : { chatUploadConfigProvider }),
      portalAbilityConfigProvider,
      stagedUploadRuntime,
      fileDownloadRuntime,
      executionCorrelation: timelineTrace.correlation,
      ...(developerDiagnosticArtifactWriter === undefined
        ? {}
        : { developerDiagnosticArtifactStatus: () => developerDiagnosticArtifactWriter.status() }),
      ...(attachmentSummaryResolver === undefined ? {} : { attachmentSummaryResolver }),
      ...(gatewayBindings === undefined ? {} : { gatewayBindings }),
      ...(watermarkConfigProvider !== undefined ? { getWatermarkEnabled: watermarkConfigProvider.get.bind(watermarkConfigProvider) } : {}),
      guardLocale: defaultRouteAssembly.runtimeSettings.defaultLanguage ?? 'zh-CN',
    },
    promptTemplateRegistry,
    agentAssemblies,
    gateway,
    ...(backgroundTasks.enabled ? { backgroundTasks: backgroundTasks.store } : {}),
    ...(cronTaskManagement === undefined ? {} : { cronTaskManagement }),
    ...(observability.operationalLogWriter === undefined ? {} : { operationalLogWriter: observability.operationalLogWriter }),
  });
  const { server, webChannelRegistration, taskChannelRegistration } = channelLayer;
  failureScope.register('fastify-server', () => server.close());
  const cronRuntimeLayer = composeCronRuntimeLayer({
    capability: cronCapability,
    ...(preparedInputs.cronInput.cronTaskSchedulerFactory === undefined
      ? {}
      : { cronTaskSchedulerFactory: preparedInputs.cronInput.cronTaskSchedulerFactory }),
    ...(preparedInputs.cronInput.cronTriggerCallbackCredentialRef === undefined
      ? {}
      : { cronTriggerCallbackCredentialRef: preparedInputs.cronInput.cronTriggerCallbackCredentialRef }),
    ...(preparedInputs.cronInput.cronTriggerCallbackRegistration === undefined
      ? {}
      : { cronTriggerCallbackRegistration: preparedInputs.cronInput.cronTriggerCallbackRegistration }),
    runtime,
    requestRuns: gateway.requestRuns,
    projectorHost,
    credentialResolver,
    server,
    locale: brand<string, 'RequestLocale'>(defaultRouteAssembly.runtimeSettings.defaultLanguage ?? 'zh-CN'),
    computeNextRunAt: nextCronRunMs,
    ...(cronTriggerDelivery === undefined ? {} : { delivery: cronTriggerDelivery }),
  });
  if (cronRuntimeLayer.cronTaskScheduler !== undefined) {
    failureScope.register('cron-task-scheduler', () => cronRuntimeLayer.cronTaskScheduler?.stop());
  }
  if (cronRuntimeLayer.cronTriggerCallbackRegistration?.close !== undefined) {
    failureScope.register('cron-callback-registration', () => cronRuntimeLayer.cronTriggerCallbackRegistration?.close?.());
  }
  // Layer 7: app lifecycle and private host handoff.
  const app: NextAgentApp = {
    server,
    runtime,
    sessions: sessionServices.sessions,
    gateway,
    assemblyRegistry,
    ...(auditWriter === undefined ? {} : { auditWriter }),
    metricsRegistry,
    metricsReadiness: () => metricsInfrastructure?.readiness() ?? ({ state: 'READY' } as const),
    health,
    capabilityProviders,
    systemConfig,
    ...composeAppLifecycle({
      scheduledMaintenance,
      ...(cronRuntimeLayer.cronTaskScheduler === undefined ? {} : { cronTaskScheduler: cronRuntimeLayer.cronTaskScheduler }),
      ...(memoryMaintenance.taskTrajectoryWorker === undefined ? {} : { taskTrajectoryWorker: memoryMaintenance.taskTrajectoryWorker }),
      memoryAgingSchedulers: memoryMaintenance.memoryAgingSchedulers,
      memoryExtractionSchedulers: memoryMaintenance.memoryExtractionSchedulers,
      capabilitySubsystem,
      webChannelRegistration,
      taskChannelRegistration,
      ...(cronRuntimeLayer.cronTriggerCallbackRegistration === undefined
        ? {}
        : { cronTriggerCallbackRegistration: cronRuntimeLayer.cronTriggerCallbackRegistration }),
      ensureRagKnowledgeBuilt,
      runtime,
      sessionActivityService: sessionServices.sessionActivityService,
      server,
      systemConfig,
      projectorHost,
      ragRetrieval,
      ragKnowledgeGovernance,
      gatewayBindings,
      ...(observability.operationalLogWriter === undefined ? {} : { operationalLogWriter: observability.operationalLogWriter }),
      ...(runtimeLoggerProviderBinding === undefined ? {} : { runtimeLoggerProviderBinding }),
      ...(metricsInfrastructure === undefined ? {} : { metricsInfrastructure }),
      ...(developerDiagnosticArtifactWriter === undefined ? {} : { developerDiagnosticArtifactWriter }),
      ...(closeCronTasks === undefined ? {} : { closeCronTasks }),
    }),
  };
  const selectedGatewayProviderId =
    preparedInputs.gatewayInput.gatewayProviders?.find(
      (provider) => provider.deploymentMode === systemConfig.gateway.deploymentMode && provider.supportedAdapterKinds.includes('sqlite'),
    )?.providerId ?? gatewayBindings.providerId;
  return {
    app,
    hostFacts: {
      gatewayReadiness: {
        selectedProviderId: selectedGatewayProviderId,
        deploymentMode: systemConfig.gateway.deploymentMode,
        gatewaySnapshotRef: systemConfig.gatewaySelection.diagnosticRef,
        bindingsReadinessRef: `gateway-provider:${selectedGatewayProviderId}:ready`,
      },
      reportAppStartFailure(error) {
        observability.operationalLogWriter
          ?.getLogger({
            component: 'agent-app',
            source: 'startup',
          })
          .error({
            err: error,
            event: 'app.start.failed',
            failureStage: classifyAppStartupFailure(error),
          });
      },
    },
  };
}

function createPluginHostServices(
  runtime: import('@nextagent/agent-plugin-sdk').PluginRuntimeServices,
  writer: PreparedCompositionInputs['developerDiagnosticArtifactWriter'],
) {
  return {
    runtime,
    developerDiagnosticsForPlugin(pluginId: string) {
      return {
        emit(input: import('@nextagent/agent-plugin-sdk').DeveloperDiagnosticArtifactInput) {
          return writer?.emit({ ...input, pluginId }) ?? Promise.resolve({ status: 'DROPPED' as const, reasonCode: 'OUTPUT_UNAVAILABLE' as const });
        },
      };
    },
  };
}

function prepareConfiguredAppDirectories(systemConfig: DefaultSystemConfig): void {
  mkdirSync(sqliteParentDir(systemConfig.paths), { recursive: true });
  mkdirSync(systemConfig.paths.runtimeWorkspaceRoot, { recursive: true });
  mkdirSync(systemConfig.paths.sharedDataRoot, { recursive: true });
}

function registerAcceptedInputOwnership(input: {
  readonly failureScope: CompositionFailureScope;
  readonly operationalLogWriter?: NonNullable<CreateComposedAppOptions['operationalLogWriter']>;
  readonly metricsInfrastructure?: NonNullable<CreateComposedAppOptions['metricsInfrastructure']>;
  readonly gatewayBindings?: NonNullable<CreateComposedAppOptions['gatewayBindings']>;
}): void {
  if (input.operationalLogWriter !== undefined) {
    input.failureScope.register('operational-log-writer', () => input.operationalLogWriter?.close(5_000));
  }
  if (input.metricsInfrastructure !== undefined) {
    registerMetricsInfrastructure(input.failureScope, input.metricsInfrastructure);
  }
  if (input.gatewayBindings !== undefined) {
    input.failureScope.register('injected-gateway-bindings', () => input.gatewayBindings?.close?.());
  }
}

function registerCreatedObservabilityOwnership(input: {
  readonly failureScope: CompositionFailureScope;
  readonly observability: PreparedObservabilityComposition;
  readonly injectedOperationalLogWriter?: NonNullable<CreateComposedAppOptions['operationalLogWriter']>;
  readonly injectedMetricsInfrastructure?: NonNullable<CreateComposedAppOptions['metricsInfrastructure']>;
}): void {
  if (input.observability.operationalLogWriter !== undefined && input.observability.operationalLogWriter !== input.injectedOperationalLogWriter) {
    input.failureScope.register('operational-log-writer', () => input.observability.operationalLogWriter?.close(5_000));
  }
  if (input.observability.metricsInfrastructure !== undefined && input.observability.metricsInfrastructure !== input.injectedMetricsInfrastructure) {
    registerMetricsInfrastructure(input.failureScope, input.observability.metricsInfrastructure);
  }
  if (input.observability.runtimeLoggerProviderBinding !== undefined) {
    input.failureScope.register('runtime-logger-binding', () => input.observability.runtimeLoggerProviderBinding?.unbind());
  }
}

function registerMetricsInfrastructure(
  failureScope: CompositionFailureScope,
  metricsInfrastructure: NonNullable<PreparedObservabilityComposition['metricsInfrastructure']>,
): void {
  failureScope.register('metrics-infrastructure', async () => {
    await metricsInfrastructure.forceFlush(10_000);
    await metricsInfrastructure.shutdown(10_000);
  });
}
