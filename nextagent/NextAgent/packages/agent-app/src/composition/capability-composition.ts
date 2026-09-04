import {
  clipServerProviderType,
  createCapabilitySubsystem,
  createSkillHubAssemblySourceAuthorization,
  type AgentDiscoverySource,
  type ClipCommandRunner,
} from '@nextagent/agent-capability';
import type { TodoStatePort } from '@nextagent/agent-capability';
import type { CronTaskPort } from '@nextagent/agent-capability';
import type { AgentAssembly, AgentAssemblyRegistry } from '@nextagent/agent-contracts/agent-assembly';
import type {
  CapabilityCatalog,
  CapabilityInvocationPort,
  CapabilityProvider,
  SubagentExecutionPort,
  ParameterExtractionPort,
} from '@nextagent/agent-contracts/capability';
import type { ApiCallPort } from '@nextagent/agent-contracts/capability';
import type { ModelCatalogQueryService, ModelInvocationService } from '@nextagent/agent-contracts/model';
import type { WorkflowExecutionService } from '@nextagent/agent-contracts/core';
import type { ModelSelectionService } from '@nextagent/agent-contracts/context';
import type {
  BackgroundCompletionPayload,
  BackgroundTaskRecord,
  BackgroundTaskStoreGatewayPort,
  GuardrailGatewayPort,
  RagRetrievalGateway,
  ScheduledMaintenanceJob,
} from '@nextagent/agent-contracts/gateway';
import type { ExecutionCorrelationPort } from '@nextagent/agent-contracts/observability';
import type { RiskPolicyEvaluator, LifecycleHookDefinition } from '@nextagent/agent-contracts/runtime';
import { getLogger } from '@nextagent/agent-common';
import type { PromptTemplateAssembler } from '@nextagent/agent-context-engine';
import { createDeferredSubagentExecutionPort } from '@nextagent/agent-runtime';
import { createWorkflowRuntimeAdapters, createWorkflowToolPort, type WorkflowRecipeDefinitionSource } from '@nextagent/agent-workflow';
import { createStartupResourceProviderRegistry } from '../assembly/resource-provider-registry.js';
import {
  validateStartupAgentAssemblyGraph,
  compileWorkspaceFileExtensionPolicy,
  type AgentAssemblyResourceReferences,
} from '../assembly/agent-assembly-compiler.js';
import { requireAgentDefinitionForScope } from '../assembly/agent-discovery-source.js';
import type { AgentDefinition } from '../assembly/agent-definition.js';
import type { DefaultSystemConfig } from '../config/component-config.js';
import { resolveCapabilityProviders, type ResolvedCapabilityProviders } from '../config/capability-providers.js';
import { createAgentPackageSourceLocator } from '../assembly/agent-package-source-locator.js';
import type { LoadedPluginPolicy } from '../plugin/plugin-loader.js';
import { closeGateway } from './app-composition-helpers.js';
import type {
  AppGatewayStores,
  AppSandboxGatewayPort,
  CapabilityProviderReferenceValidation,
  SkillHubAccessFactory,
} from './composition-contracts.js';

const logger = getLogger({ component: 'agent-app', source: 'capability-composition' });

export function resolveCapabilityProviderComposition(input: {
  readonly systemConfig: DefaultSystemConfig;
  readonly referenceValidation: CapabilityProviderReferenceValidation;
  readonly registeredCustomAdapterTypes?: ReadonlySet<string>;
  readonly skillHubAccessFactory?: SkillHubAccessFactory | undefined;
}): ResolvedCapabilityProviders {
  return resolveCapabilityProviders(input.systemConfig.userCapabilityProviders, {
    ...(input.registeredCustomAdapterTypes === undefined ? {} : { registeredCustomAdapterTypes: input.registeredCustomAdapterTypes }),
    isCredentialReferenceResolvable: input.referenceValidation.isCredentialReferenceResolvable,
    resolveLocalDirectoryPath: input.referenceValidation.resolveLocalDirectoryPath,
    isUrlResolvable: input.referenceValidation.isUrlResolvable,
    isProviderAdapterRegistered: (kind, providerType) => {
      if (kind === 'SKILL_HUB') {
        return input.skillHubAccessFactory !== undefined;
      }
      if (kind === 'CUSTOM') {
        if (providerType === clipServerProviderType) {
          return true;
        }
        return providerType !== undefined && input.registeredCustomAdapterTypes?.has(providerType) === true;
      }
      return false;
    },
  });
}

export interface CapabilityLayerComposition {
  readonly subsystem: ReturnType<typeof createCapabilitySubsystem>;
  readonly catalog: CapabilityCatalog;
  readonly invocationPort: CapabilityInvocationPort;
  readonly workflowRuntimeAdapters: ReturnType<typeof createWorkflowRuntimeAdapters>;
  readonly assemblyValidationReferences: AgentAssemblyResourceReferences;
}

export function composeCapabilityLayer(input: {
  readonly systemConfig: DefaultSystemConfig;
  readonly agentDefinition: AgentDefinition;
  readonly capabilityProviders: ResolvedCapabilityProviders;
  readonly recipeCapabilityProvider: CapabilityProvider;
  readonly pluginCapabilityProviders: readonly CapabilityProvider[];
  readonly memoryCapabilityProvider?: CapabilityProvider;
  readonly assemblyRegistry: AgentAssemblyRegistry & AgentDiscoverySource;
  readonly agentAssemblies: readonly AgentAssembly[];
  readonly assemblyValidationReferences: AgentAssemblyResourceReferences;
  readonly lifecycleHookDefinitions?: readonly LifecycleHookDefinition[] | undefined;
  readonly pluginPolicies: readonly LoadedPluginPolicy[];
  readonly executionWorkspaceResolver: ReturnType<typeof import('@nextagent/agent-runtime').createExecutionWorkspaceResolver>;
  readonly sandboxGateway: AppSandboxGatewayPort;
  readonly riskPolicyEvaluator: RiskPolicyEvaluator;
  readonly ragRetrieval: { readonly gateway: RagRetrievalGateway; close: () => void };
  readonly todoState: TodoStatePort;
  readonly cronTasks?: CronTaskPort;
  readonly recipeDefinitionSource: WorkflowRecipeDefinitionSource;
  readonly workflowExecutionService: WorkflowExecutionService;
  readonly agentPackageSourceLocator: ReturnType<typeof createAgentPackageSourceLocator>;
  readonly skillHubAccessFactory?: SkillHubAccessFactory | undefined;
  readonly executionCorrelation: ExecutionCorrelationPort;
  readonly defaultRouteAssembly: AgentAssembly;
  readonly clipCommandRunner: ClipCommandRunner;
  readonly gateway: AppGatewayStores;
  readonly promptTemplateAssembler: PromptTemplateAssembler;
  readonly modelSelectionService: ModelSelectionService;
  readonly scheduledMaintenance: { register: (job: ScheduledMaintenanceJob) => void };
  readonly backgroundTasks:
    | { readonly enabled: false }
    | {
        readonly enabled: true;
        readonly store: BackgroundTaskStoreGatewayPort;
        readonly onStart: (record: BackgroundTaskRecord) => Promise<void>;
        readonly onComplete: (payload: BackgroundCompletionPayload) => void;
      };
  readonly runtimeSubagentExecution: () => SubagentExecutionPort | undefined;
  readonly parameterExtractionPort: ParameterExtractionPort;
  readonly apiCallPort: ApiCallPort;
  readonly guardrail?: GuardrailGatewayPort;
  readonly modelCatalog: ModelCatalogQueryService;
}): CapabilityLayerComposition {
  const externalProviders = [
    input.recipeCapabilityProvider,
    ...input.pluginCapabilityProviders,
    ...(input.memoryCapabilityProvider === undefined ? [] : [input.memoryCapabilityProvider]),
  ];
  const workspaceFileExtensionPolicies = new Map(
    input.agentAssemblies.map((assembly) => {
      const definition = requireAgentDefinitionForScope(
        {
          systemConfig: input.systemConfig,
          activeDefinition: input.agentDefinition,
        },
        assembly.agentId,
        assembly.agentVersion,
      );
      return [`${assembly.agentId}:${assembly.agentVersion}`, compileWorkspaceFileExtensionPolicy(definition.workspaceFiles)] as const;
    }),
  );
  const subsystem = createCapabilitySubsystem({
    providerConfigs: input.capabilityProviders.providers,
    ...(externalProviders.length === 0 ? {} : { externalProviders }),
    read: {
      runtimeWorkspaceRoot: input.systemConfig.paths.runtimeWorkspaceRoot,
      sharedDataRoot: input.systemConfig.paths.sharedDataRoot,
      executionWorkspaceResolver: input.executionWorkspaceResolver,
      deploymentMode: input.systemConfig.gateway.deploymentMode,
      workspacePolicyProvider: {
        require: async (agentId, agentVersion) => (await input.assemblyRegistry.require(agentId, agentVersion)).workspacePolicy,
      },
      workspaceFileExtensionPolicyProvider: {
        require: async (agentId, agentVersion) => {
          const policy = workspaceFileExtensionPolicies.get(`${agentId}:${agentVersion}`);
          if (policy === undefined) {
            throw new Error('Agent workspace file extension policy is unavailable.');
          }
          return policy;
        },
      },
    },
    sandbox: {
      gateway: input.sandboxGateway,
      riskPolicyEvaluator: input.riskPolicyEvaluator,
      toolPolicy: {
        ...(input.systemConfig.sandbox.allowedExecutables === undefined ? {} : { allowedExecutables: input.systemConfig.sandbox.allowedExecutables }),
        deniedExecutables: input.systemConfig.sandbox.deniedExecutables,
        enabled: input.systemConfig.sandbox.enabled,
      },
      ...(input.backgroundTasks.enabled
        ? {
            backgroundTaskStore: input.backgroundTasks.store,
            onBackgroundStart: input.backgroundTasks.onStart,
            onBackgroundComplete: input.backgroundTasks.onComplete,
          }
        : {}),
    },
    toolDependencies: {
      ragRetrieval: input.ragRetrieval.gateway,
      ragDefaultIndexes: input.systemConfig.rag.indexes,
      subagentExecution: createDeferredSubagentExecutionPort(input.runtimeSubagentExecution),
      todoState: input.todoState,
      ...(input.cronTasks === undefined ? {} : { cronTasks: input.cronTasks }),
      ...(input.guardrail === undefined ? {} : { guardrail: input.guardrail }),
      workflowExecution: createWorkflowToolPort({
        resolveRecipeDefinition: (request) => input.recipeDefinitionSource.require(request.agentId, request.recipeName),
        workflowExecutionService: input.workflowExecutionService,
      }),
      apiCallPort: input.apiCallPort,
      parameterExtraction: input.parameterExtractionPort,
    },
    localSkillDiscoveryOptions: {
      systemSkillsRoot: input.systemConfig.paths.systemSkillsRoot,
      agentPackageSourceLocator: input.agentPackageSourceLocator,
    },
    ...(input.skillHubAccessFactory === undefined
      ? {}
      : {
          skillHubRemoteAccessFactory: (config) => input.skillHubAccessFactory?.(config, input.executionCorrelation),
        }),
    agentDiscoverySource: input.assemblyRegistry,
    skillHubSourceAuthorization: createSkillHubAssemblySourceAuthorization(input.defaultRouteAssembly),
    planningToolCallingMode: input.systemConfig.planningToolCallingMode,
    clipcDisclosureMode: input.systemConfig.capabilityDisclosure.clipcDisclosureMode,
    clipCommandRunner: input.clipCommandRunner,
    ...(input.backgroundTasks.enabled ? { backgroundExecutionEnabled: true } : {}),
  });
  for (const job of subsystem.maintenanceJobs) {
    input.scheduledMaintenance.register(job);
  }
  const startupProviderRegistry = createStartupResourceProviderRegistry(subsystem.capabilityProviders);
  const assemblyValidationReferences = {
    ...input.assemblyValidationReferences,
    capabilityProviders: startupProviderRegistry.capabilityProviders,
  };
  try {
    validateStartupAgentAssemblyGraph({
      systemConfig: input.systemConfig,
      assemblies: input.agentAssemblies,
      resourceReferences: {
        capabilityProviders: assemblyValidationReferences.capabilityProviders,
        lifecycleHookDefinitions: assemblyValidationReferences.lifecycleHookDefinitions ?? [],
        pluginPolicies: input.pluginPolicies,
      },
    });
  } catch (error) {
    input.ragRetrieval.close();
    void closeGateway(input.gateway).catch(() => undefined);
    throw error;
  }
  const catalog = subsystem.catalog;
  const workflowRuntimeAdapters = createWorkflowRuntimeAdapters({
    catalog,
    assemblyRegistry: input.assemblyRegistry,
    modelSelectionService: input.modelSelectionService,
    modelProfiles: input.systemConfig.modelProfiles,
    modelCatalog: input.modelCatalog,
    assemblePrompt: (request) =>
      input.promptTemplateAssembler.assemble({
        purpose: request.purpose,
        agentId: request.agentId,
        agentVersion: request.agentVersion,
        flowVariables: {},
        selectedModel: request.selectedModel,
      }),
  });
  subsystem
    .collectSkillScanReport()
    .then((report) => {
      for (const source of report.sources) {
        const failureReasonCodes = [...new Set(source.failures.map((failure) => failure.outcomeCode))].sort();
        const fields = {
          event: source.failures.length === 0 ? 'skill.scan.completed' : 'skill.scan.degraded',
          providerId: source.providerId,
          discoveredCount: source.discovered.length,
          failureCount: source.failures.length,
          failureReasonCodes,
        };
        if (source.failures.length === 0) {
          logger.info(fields);
        } else {
          logger.warn(fields);
        }
      }
    })
    .catch(() => {
      logger.warn({ event: 'skill.scan.report_failed', safeReasonCode: 'SKILL_SCAN_REPORT_FAILED' });
    });
  logger.info({ event: 'capability.subsystem.initialized' });
  return {
    subsystem,
    catalog,
    invocationPort: subsystem.invocationPort,
    workflowRuntimeAdapters,
    assemblyValidationReferences,
  };
}
