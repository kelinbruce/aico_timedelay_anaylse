import { brand, type AgentId, type AgentVersion, type RequestRunId } from '@nextagent/agent-common';
import type { AgentAssembly } from '@nextagent/agent-contracts/agent-assembly';
import type {
  CapabilityCatalog,
  CapabilityCurrentViewPort,
  CapabilitySearchCriteria,
  CapabilityInvocationPort,
  CapabilityProviderIdentity,
  CapabilityProviderConfig,
  CapabilityProvider,
} from '@nextagent/agent-contracts/capability';
import { join } from 'node:path';
import { rm } from 'node:fs/promises';
import type {
  BackgroundCompletionPayload,
  BackgroundTaskRecord,
  BackgroundTaskStoreGatewayPort,
  SandboxGatewayPort,
} from '@nextagent/agent-contracts/gateway';

import { builtinSkillsProvider, builtinToolsProvider } from './builtins/index.js';
import {
  builtinAgentsProvider,
  localAgentsProvider,
  localSubagentsProvider,
  type AgentDiscoverySource,
  type BuiltinAgentDiscoveryOptions,
} from './agents/agent-discovery.js';
import { bashCapabilityId } from './builtins/bash/bash-tool.js';
import type { BuiltinSkillDiscoveryOptions } from './builtins/skill-discovery.js';
import {
  ClipToolRegistry,
  createClipToolExecutor,
  isClipServerProvider,
  clipServerProviderType,
  type ClipCommandRunner,
  type ClipSafeDiagnostic,
} from './clip/clip-tool-source.js';
import { createExecutionFilesystemCleanupJobs, type ExecutionFilesystemCleanupJob } from './builtins/workspace-files/execution-cleanup-jobs.js';
import {
  createWorkspaceBackedSandboxExecutionPort,
  type RiskPolicyEvaluator,
  type SandboxGatewayExecutionAdapter,
} from './builtins/sandbox/sandbox-execution-port.js';
import { createWorkspaceFilePort, type ReadWorkspaceFileOptions } from './builtins/workspace-files/workspace-file-port.js';
import { StaticCapabilityCatalog, type SkillScanReport } from './catalog/catalog.js';
import { createDefaultCapabilityDiscoveryFactory, type CapabilityDiscoveryFactory } from './discovery/discovery.js';
import { GovernedCapabilityInvocationPort, createStaticCapabilityExecutorFactory } from './execution/executor.js';
import { assembleCapabilityProviders, type ExtensionRegistrationDiagnostic } from './extension-registration.js';
import {
  localSkillsAgentOwnedProvider,
  localSkillsRuntimeGeneratedProvider,
  localSkillsSystemProvider,
  type LocalSkillDiscoveryOptions,
  type RuntimeGeneratedSkillRootLocator,
} from './local/skill-discovery.js';
import { normalizeCapabilityProviderConfigs } from './provider-config.js';
import { createSkillHubAcquisitionExecutor } from './skillhub/skillhub-acquisition-tool.js';
import type { SkillHubRemoteAccessPort } from './skillhub/skillhub-source.js';
import type { SkillSourceDiscovery, SkillSourceRegistry } from './skills/skill-source-discovery.js';
import type { ToolCatalogConfig } from './tools/tool-catalog.js';
import type { PlanningToolCallingMode } from './tools/tool-catalog.js';
import type { ToolDependencies } from './tools/tool-spi.js';
import type { WorkflowSandboxExecutionPort } from './workflow-sandbox-execution-port.js';
import { createWorkflowSandboxExecutionPort } from './workflow-sandbox-execution-port.js';

export interface CapabilitySubsystem {
  readonly catalog: CapabilityCatalog;
  readonly currentView: CapabilityCurrentViewPort;
  readonly invocationPort: CapabilityInvocationPort;
  readonly capabilityProviders: readonly CapabilityProviderIdentity[];
  readonly runLifecycle: CapabilityRunLifecycleHooks;
  readonly maintenanceJobs: readonly ExecutionFilesystemCleanupJob[];
  readonly workflowSandboxExecution?: WorkflowSandboxExecutionPort;
  validateStartupRegistration: (signal?: AbortSignal) => Promise<readonly ExtensionRegistrationDiagnostic[]>;
  collectSkillScanReport: () => Promise<SkillScanReport>;
}

export interface CapabilityRunLifecycleHooks {
  onTerminalRun: (context: { readonly agentId: AgentId; readonly runId: RequestRunId }) => void;
}

export type SkillHubSourceAuthorization = (request: {
  readonly providerId: string;
  readonly tenantId: string;
  readonly subjectId: string;
  readonly agentId: AgentId;
  readonly agentVersion: AgentVersion;
  readonly agentAssemblyRef: string;
}) => boolean;

export function createSkillHubAssemblySourceAuthorization(
  activeAssembly: Pick<AgentAssembly, 'agentId' | 'agentVersion' | 'agentAssemblyRef' | 'capabilityBindings'>,
): SkillHubSourceAuthorization {
  return (request) =>
    request.agentId === activeAssembly.agentId &&
    request.agentVersion === activeAssembly.agentVersion &&
    request.agentAssemblyRef === activeAssembly.agentAssemblyRef &&
    activeAssembly.capabilityBindings.some(
      (binding) => binding.providerId === request.providerId && binding.capabilityType === 'SKILL' && binding.enabled !== false,
    );
}

export interface CapabilitySubsystemOptions {
  readonly providerConfigs?: readonly CapabilityProviderConfig[];
  readonly externalProviders?: readonly CapabilityProvider[];
  readonly read?: ReadWorkspaceFileOptions;
  readonly builtinSkillDiscoveryOptions?: BuiltinSkillDiscoveryOptions | undefined;
  readonly localSkillDiscoveryOptions?: LocalSkillDiscoveryOptions | undefined;
  readonly builtinAgentDiscoveryOptions?: BuiltinAgentDiscoveryOptions | undefined;
  readonly agentDiscoverySource?: AgentDiscoverySource | undefined;
  readonly toolCatalogConfig?: ToolCatalogConfig | undefined;
  readonly planningToolCallingMode?: PlanningToolCallingMode;
  readonly toolDependencies?: ToolDependencies;
  readonly clipCommandRunner?: ClipCommandRunner | undefined;
  readonly clipDiagnostics?: ClipSafeDiagnostic[] | undefined;
  readonly clipcDisclosureMode?: 'list' | 'tool-search' | undefined;
  readonly skillHubRemoteAccessFactory?: (config: CapabilityProviderConfig) => SkillHubRemoteAccessPort | undefined;
  readonly skillHubSourceAuthorization?: SkillHubSourceAuthorization;
  readonly sandbox?: CapabilitySandboxOptions;
  /**
   * Whether background shell execution is available (LOCAL deployments).
   * Threads through to the bash tool definition so `run_in_background` is
   * only offered to the model and the auto-background path is only active
   * when the deployment supports it.
   */
  readonly backgroundExecutionEnabled?: boolean | undefined;
}

export interface CapabilitySandboxOptions {
  readonly gateway: SandboxGatewayPort;
  readonly riskPolicyEvaluator: RiskPolicyEvaluator;
  readonly toolPolicy?: CapabilitySandboxToolPolicy;
  readonly backgroundTaskStore?: BackgroundTaskStoreGatewayPort;
  readonly onBackgroundStart?: (record: BackgroundTaskRecord) => Promise<void>;
  readonly onBackgroundComplete?: (payload: BackgroundCompletionPayload) => void;
}

export interface CapabilitySandboxToolPolicy {
  readonly allowedExecutables?: readonly string[];
  readonly enabled: boolean;
  readonly deniedExecutables: readonly string[];
}

const runtimeGeneratedCapabilityDiscoveryRunId = brand<string, 'RequestRunId'>('runtime-generated-skill-discovery');

export function createCapabilitySubsystem(options: CapabilitySubsystemOptions = {}): CapabilitySubsystem {
  const providerConfigs = Array.isArray(options.providerConfigs) ? options.providerConfigs : [];
  const builtinDiscoveryFactory = createDefaultCapabilityDiscoveryFactory();
  const clipRegistry = new ClipToolRegistry();
  const workspaceFileOptions = options.read ?? { workspaceDir: join(process.cwd(), '.nextagent', 'workspace') };
  const workspaceFiles = options.toolDependencies?.workspaceFiles ?? createWorkspaceFilePort(workspaceFileOptions);
  const sandbox =
    options.toolDependencies?.sandbox ??
    (options.sandbox === undefined
      ? undefined
      : createWorkspaceBackedSandboxExecutionPort({
          gateway: options.sandbox.gateway,
          workspaceFiles,
          riskPolicyEvaluator: options.sandbox.riskPolicyEvaluator,
          ...(options.sandbox.backgroundTaskStore === undefined ? {} : { backgroundTaskStore: options.sandbox.backgroundTaskStore }),
          ...(options.sandbox.onBackgroundStart === undefined ? {} : { onBackgroundStart: options.sandbox.onBackgroundStart }),
          ...(options.sandbox.onBackgroundComplete === undefined ? {} : { onBackgroundComplete: options.sandbox.onBackgroundComplete }),
        }));
  const toolDependencies: ToolDependencies = {
    ...(options.toolDependencies ?? {}),
    workspaceFiles,
    ...(sandbox === undefined ? {} : { sandbox }),
  };
  const runtimeGeneratedSkillRootLocator = createRuntimeGeneratedSkillRootLocator(workspaceFileOptions);
  let catalog: StaticCapabilityCatalog | undefined;
  const skillSources: SkillSourceRegistry = {
    resolveSkillSource(providerId) {
      return catalog?.resolveSkillSourceDiscovery(providerId);
    },
  };
  const internalProviders = createInternalProviders({
    discoveryFactory: builtinDiscoveryFactory,
    toolCatalogConfig: createBuiltinToolCatalogConfig(options.toolCatalogConfig, options.sandbox?.toolPolicy, options.planningToolCallingMode),
    toolDependencies: { ...toolDependencies, skillSources },
    builtinSkillDiscoveryOptions: options.builtinSkillDiscoveryOptions,
    builtinAgentDiscoveryOptions: options.builtinAgentDiscoveryOptions,
    localSkillDiscoveryOptions: options.localSkillDiscoveryOptions,
    agentDiscoverySource: options.agentDiscoverySource,
    backgroundExecutionEnabled: options.backgroundExecutionEnabled,
    runtimeGeneratedSkillRootLocator,
  });
  const externalProviders = options.externalProviders ?? [];
  const occupiedProviders = [...internalProviders.map((provider) => provider.identity), ...externalProviders.map((provider) => provider.identity)];
  const normalizedConfigs = normalizeCapabilityProviderConfigs(providerConfigs, {
    occupiedProviders,
  });
  const providers = [
    ...internalProviders,
    ...externalProviders,
    ...createConfigDrivenProviders({
      discoveryFactory: builtinDiscoveryFactory,
      configs: normalizedConfigs,
      clipRegistry,
      clipCommandRunner: options.clipCommandRunner,
      clipDiagnostics: options.clipDiagnostics,
      clipcDisclosureMode: options.clipcDisclosureMode,
      skillHubRemoteAccessFactory: options.skillHubRemoteAccessFactory,
    }),
    ...createDefaultClipProviderIfAvailable({
      normalizedConfigs,
      clipCommandRunner: options.clipCommandRunner,
      clipRegistry,
      clipDiagnostics: options.clipDiagnostics,
      clipcDisclosureMode: options.clipcDisclosureMode,
      discoveryFactory: builtinDiscoveryFactory,
    }),
  ];
  const snapshot = assembleCapabilityProviders(providers);
  const maintenanceJobs =
    'runtimeWorkspaceRoot' in workspaceFileOptions
      ? createExecutionFilesystemCleanupJobs({ runtimeWorkspaceRoot: workspaceFileOptions.runtimeWorkspaceRoot })
      : [];
  catalog = new StaticCapabilityCatalog([], {
    eagerDiscoveries: snapshot.eagerDiscoveries,
    searchDiscoveries: snapshot.searchDiscoveries,
    skillSourceDiscoveries: skillSourceDiscoveries([...snapshot.eagerDiscoveries, ...snapshot.searchDiscoveries]),
    ...(options.skillHubSourceAuthorization === undefined ? {} : { skillHubSourceAuthorization: options.skillHubSourceAuthorization }),
  });
  const executorFactory = createStaticCapabilityExecutorFactory(snapshot.executors);
  const validateStartupRegistration = (signal: AbortSignal = new AbortController().signal) => snapshot.validateStartupRegistration(signal);
  const collectSkillScanReport = () => catalog.collectSkillScanReport();
  return {
    catalog,
    currentView: catalog,
    invocationPort: new GovernedCapabilityInvocationPort(catalog, executorFactory),
    capabilityProviders: Object.freeze(snapshot.providers.map((provider) => Object.freeze({ ...provider.identity }))),
    runLifecycle: {
      onTerminalRun(context): void {
        workspaceFiles.clearRun(context);
      },
    },
    maintenanceJobs,
    ...(sandbox === undefined ? {} : { workflowSandboxExecution: createWorkflowSandboxExecutionPort(sandbox) }),
    validateStartupRegistration,
    collectSkillScanReport,
  };
}

interface InternalProviderInput {
  readonly discoveryFactory: CapabilityDiscoveryFactory;
  readonly toolCatalogConfig?: ToolCatalogConfig | undefined;
  readonly toolDependencies: ToolDependencies;
  readonly builtinSkillDiscoveryOptions?: BuiltinSkillDiscoveryOptions | undefined;
  readonly builtinAgentDiscoveryOptions?: BuiltinAgentDiscoveryOptions | undefined;
  readonly localSkillDiscoveryOptions?: LocalSkillDiscoveryOptions | undefined;
  readonly agentDiscoverySource?: AgentDiscoverySource | undefined;
  readonly backgroundExecutionEnabled?: boolean | undefined;
  readonly runtimeGeneratedSkillRootLocator?: RuntimeGeneratedSkillRootLocator | undefined;
}

interface ConfigDrivenProviderInput {
  readonly discoveryFactory: CapabilityDiscoveryFactory;
  readonly configs: readonly CapabilityProviderConfig[];
  readonly clipRegistry: ClipToolRegistry;
  readonly clipCommandRunner?: ClipCommandRunner | undefined;
  readonly clipDiagnostics?: ClipSafeDiagnostic[] | undefined;
  readonly clipcDisclosureMode?: 'list' | 'tool-search' | undefined;
  readonly skillHubRemoteAccessFactory?: ((config: CapabilityProviderConfig) => SkillHubRemoteAccessPort | undefined) | undefined;
}

function createInternalProviders(input: InternalProviderInput): readonly CapabilityProvider[] {
  const [localAgentsProvider, localSubagentsProvider] = createLocalAgentProviders(input);
  return [
    createBuiltinToolsProvider(input),
    createBuiltinSkillsProvider(input),
    createBuiltinAgentsProvider(input),
    localAgentsProvider,
    ...createLocalSkillProviders(input),
    localSubagentsProvider,
  ];
}

function createBuiltinToolsProvider(input: InternalProviderInput): CapabilityProvider {
  return {
    identity: builtinToolsProvider,
    discovery: input.discoveryFactory.create({
      provider: builtinToolsProvider,
      discoveryMode: 'EAGER',
      ...(input.toolCatalogConfig === undefined ? {} : { toolCatalogConfig: input.toolCatalogConfig }),
      toolDependencies: input.toolDependencies,
      ...(input.backgroundExecutionEnabled === undefined ? {} : { backgroundExecutionEnabled: input.backgroundExecutionEnabled }),
    }),
  };
}

function createBuiltinToolCatalogConfig(
  config?: ToolCatalogConfig,
  sandboxToolPolicy?: CapabilitySandboxToolPolicy,
  planningToolCallingMode?: PlanningToolCallingMode,
): ToolCatalogConfig | undefined {
  if (sandboxToolPolicy === undefined && planningToolCallingMode === undefined) {
    return config;
  }
  const tools = { ...(config?.tools ?? {}) };
  if (sandboxToolPolicy !== undefined) {
    const bashConfig = tools[bashCapabilityId] ?? {};
    tools[bashCapabilityId] = {
      ...bashConfig,
      config: {
        ...(bashConfig.config ?? {}),
        ...(sandboxToolPolicy.allowedExecutables === undefined ? {} : { allowedExecutables: sandboxToolPolicy.allowedExecutables }),
        deniedExecutables: sandboxToolPolicy.deniedExecutables,
        enabled: sandboxToolPolicy.enabled,
      },
    };
  }
  const selectedPlanningToolCallingMode = planningToolCallingMode ?? config?.planningToolCallingMode;
  return {
    tools,
    ...(selectedPlanningToolCallingMode === undefined ? {} : { planningToolCallingMode: selectedPlanningToolCallingMode }),
  };
}

function createBuiltinSkillsProvider(input: InternalProviderInput): CapabilityProvider {
  return {
    identity: builtinSkillsProvider,
    discovery: input.discoveryFactory.create({
      provider: builtinSkillsProvider,
      discoveryMode: 'EAGER',
      ...(input.builtinSkillDiscoveryOptions === undefined ? {} : { builtinSkillDiscoveryOptions: input.builtinSkillDiscoveryOptions }),
    }),
  };
}

function createBuiltinAgentsProvider(input: InternalProviderInput): CapabilityProvider {
  return {
    identity: builtinAgentsProvider,
    discovery: input.discoveryFactory.create({
      provider: builtinAgentsProvider,
      discoveryMode: 'EAGER',
      ...(input.builtinAgentDiscoveryOptions === undefined ? {} : { builtinAgentDiscoveryOptions: input.builtinAgentDiscoveryOptions }),
      ...(input.agentDiscoverySource === undefined ? {} : { agentDiscoverySource: input.agentDiscoverySource }),
    }),
  };
}

function createLocalSkillProviders(input: InternalProviderInput): readonly CapabilityProvider[] {
  const providers: CapabilityProvider[] = [
    {
      identity: localSkillsSystemProvider,
      discovery: input.discoveryFactory.create({
        provider: localSkillsSystemProvider,
        discoveryMode: 'EAGER',
        ...(input.localSkillDiscoveryOptions === undefined ? {} : { localSkillDiscoveryOptions: input.localSkillDiscoveryOptions }),
      }),
    },
    {
      identity: localSkillsAgentOwnedProvider,
      discovery: input.discoveryFactory.create({
        provider: localSkillsAgentOwnedProvider,
        discoveryMode: 'SEARCH',
        ...(input.localSkillDiscoveryOptions === undefined ? {} : { localSkillDiscoveryOptions: input.localSkillDiscoveryOptions }),
      }),
    },
  ];
  if (input.runtimeGeneratedSkillRootLocator !== undefined) {
    providers.push({
      identity: localSkillsRuntimeGeneratedProvider,
      discovery: input.discoveryFactory.create({
        provider: localSkillsRuntimeGeneratedProvider,
        discoveryMode: 'SEARCH',
        localSkillDiscoveryOptions: {
          ...(input.localSkillDiscoveryOptions ?? {}),
          runtimeGeneratedSkillRootLocator: input.runtimeGeneratedSkillRootLocator,
        },
      }),
    });
  }
  return providers;
}

function createLocalAgentProviders(input: InternalProviderInput): readonly [CapabilityProvider, CapabilityProvider] {
  return [
    {
      identity: localAgentsProvider,
      discovery: input.discoveryFactory.create({
        provider: localAgentsProvider,
        discoveryMode: 'EAGER',
        ...(input.agentDiscoverySource === undefined ? {} : { agentDiscoverySource: input.agentDiscoverySource }),
      }),
    },
    {
      identity: localSubagentsProvider,
      discovery: input.discoveryFactory.create({
        provider: localSubagentsProvider,
        discoveryMode: 'SEARCH',
        ...(input.agentDiscoverySource === undefined ? {} : { agentDiscoverySource: input.agentDiscoverySource }),
      }),
    },
  ];
}

function createConfigDrivenProviders(input: ConfigDrivenProviderInput): readonly CapabilityProvider[] {
  return input.configs.map((config) => {
    const discovery = input.discoveryFactory.create({
      provider: config.provider,
      discoveryMode: config.discoveryMode,
      config,
      clipRegistry: input.clipRegistry,
      ...(input.clipCommandRunner === undefined ? {} : { clipCommandRunner: input.clipCommandRunner }),
      ...(input.clipDiagnostics === undefined ? {} : { clipDiagnostics: input.clipDiagnostics }),
      ...(input.clipcDisclosureMode === undefined ? {} : { clipcDisclosureMode: input.clipcDisclosureMode }),
      ...(input.skillHubRemoteAccessFactory === undefined ? {} : { skillHubRemoteAccessFactory: input.skillHubRemoteAccessFactory }),
    });
    return {
      identity: config.provider,
      discovery,
      ...(config.provider.providerKind === 'SKILL_HUB'
        ? { executor: createSkillHubAcquisitionExecutor({ ...config.provider, providerKind: 'SKILL_HUB' }) }
        : {}),
      ...(isClipServerProvider(config.provider)
        ? {
            executor: createClipToolExecutor({
              provider: config.provider,
              registry: input.clipRegistry,
              ...(input.clipCommandRunner === undefined ? {} : { runner: input.clipCommandRunner }),
            }),
          }
        : {}),
    };
  });
}

const DEFAULT_CLIP_PROVIDER_ID = 'clip-server-default';
const DEFAULT_CLIP_PATH_REF = 'clipc';
const DEFAULT_CLIP_ENDPOINT_REF = 'default';
const DEFAULT_CLIP_TIMEOUT_MS = 30_000;

interface DefaultClipProviderInput {
  readonly normalizedConfigs: readonly CapabilityProviderConfig[];
  readonly clipCommandRunner?: ClipCommandRunner | undefined;
  readonly clipRegistry: ClipToolRegistry;
  readonly clipDiagnostics?: ClipSafeDiagnostic[] | undefined;
  readonly clipcDisclosureMode?: 'list' | 'tool-search' | undefined;
  readonly discoveryFactory: CapabilityDiscoveryFactory;
}

function createDefaultClipProviderIfAvailable(input: DefaultClipProviderInput): readonly CapabilityProvider[] {
  if (input.clipCommandRunner === undefined) {
    return [];
  }
  const hasClipProvider = input.normalizedConfigs.some((config) => isClipServerProvider(config.provider));
  if (hasClipProvider) {
    return [];
  }
  const defaultProvider: CapabilityProviderIdentity = {
    providerId: DEFAULT_CLIP_PROVIDER_ID,
    providerKind: 'CUSTOM',
    providerType: clipServerProviderType,
  };
  const defaultConfig: CapabilityProviderConfig = {
    provider: defaultProvider,
    discoveryMode: 'EAGER',
    options: {
      customOptions: {
        enabled: true,
        clipPathRef: DEFAULT_CLIP_PATH_REF,
        endpointRef: DEFAULT_CLIP_ENDPOINT_REF,
        timeoutMs: DEFAULT_CLIP_TIMEOUT_MS,
        retry: { maxAttempts: 1 },
      },
    },
  };
  const discovery = input.discoveryFactory.create({
    provider: defaultProvider,
    discoveryMode: 'EAGER',
    config: defaultConfig,
    clipRegistry: input.clipRegistry,
    clipCommandRunner: input.clipCommandRunner,
    ...(input.clipDiagnostics === undefined ? {} : { clipDiagnostics: input.clipDiagnostics }),
    ...(input.clipcDisclosureMode === undefined ? {} : { clipcDisclosureMode: input.clipcDisclosureMode }),
  });
  return [
    {
      identity: defaultProvider,
      discovery,
      executor: createClipToolExecutor({
        provider: defaultProvider,
        registry: input.clipRegistry,
        runner: input.clipCommandRunner,
      }),
    },
  ];
}

function skillSourceDiscoveries(
  discoveries: readonly unknown[],
): ReadonlyArray<SkillSourceDiscovery & { readonly provider: { readonly providerId: string } }> {
  return discoveries.filter(isSkillSourceDiscovery);
}

function isSkillSourceDiscovery(value: unknown): value is SkillSourceDiscovery & { readonly provider: { readonly providerId: string } } {
  return (
    value !== null &&
    typeof value === 'object' &&
    'provider' in value &&
    'loadCanonicalBodyView' in value &&
    typeof value.loadCanonicalBodyView === 'function'
  );
}

function createRuntimeGeneratedSkillRootLocator(workspaceFileOptions: ReadWorkspaceFileOptions): RuntimeGeneratedSkillRootLocator | undefined {
  if (!('runtimeWorkspaceRoot' in workspaceFileOptions)) {
    return undefined;
  }
  return {
    async locate(criteria: CapabilitySearchCriteria): Promise<string | undefined> {
      const workspacePolicy = await workspaceFileOptions.workspacePolicyProvider.require(criteria.agentId, criteria.agentVersion);
      if (workspacePolicy.isolationMode === 'session' && criteria.sessionId === undefined) {
        return undefined;
      }
      const view = workspaceFileOptions.executionWorkspaceResolver.resolve({
        runtimeWorkspaceRoot: workspaceFileOptions.runtimeWorkspaceRoot,
        ...(workspaceFileOptions.sharedDataRoot === undefined ? {} : { sharedDataRoot: workspaceFileOptions.sharedDataRoot }),
        workspacePolicy,
        agentId: criteria.agentId,
        tenantId: criteria.tenantId,
        subjectId: criteria.subjectId,
        ...(criteria.sessionId === undefined ? {} : { sessionId: criteria.sessionId }),
        runId: runtimeGeneratedCapabilityDiscoveryRunId,
        deploymentMode: workspaceFileOptions.deploymentMode,
      });
      // Discovery only needs the generated-skills root, but the resolver
      // materializes every policy root — including a per-run `temp/{runKey}`
      // dir for this constant discovery runId. That dir has no real run to
      // clean it up via postTerminalCallback, so remove it here to avoid
      // leaving an empty temp dir on every discovery pass. The constant runId
      // never collides with a real run's temp dir.
      const discoveryTempRoot = view.roots.find((root) => root.kind === 'temp');
      if (discoveryTempRoot !== undefined) {
        await rm(discoveryTempRoot.physicalPath, { recursive: true, force: true }).catch(() => undefined);
      }
      return view.roots.find((root) => root.kind === 'generatedSkills')?.physicalPath;
    },
    async locateCurrent(criteria): Promise<string | undefined> {
      if (workspaceFileOptions.executionWorkspaceResolver.locateRoot === undefined) {
        throw new Error('Runtime-generated Skill current view is unavailable.');
      }
      const workspacePolicy = await workspaceFileOptions.workspacePolicyProvider.require(criteria.agentId, criteria.agentVersion);
      if (workspacePolicy.isolationMode === 'session' && criteria.sessionId === undefined) {
        return undefined;
      }
      return workspaceFileOptions.executionWorkspaceResolver.locateRoot(
        {
          runtimeWorkspaceRoot: workspaceFileOptions.runtimeWorkspaceRoot,
          ...(workspaceFileOptions.sharedDataRoot === undefined ? {} : { sharedDataRoot: workspaceFileOptions.sharedDataRoot }),
          workspacePolicy,
          agentId: criteria.agentId,
          tenantId: criteria.tenantId,
          subjectId: criteria.subjectId,
          sessionId: criteria.sessionId,
          deploymentMode: workspaceFileOptions.deploymentMode,
        },
        'generatedSkills',
      );
    },
  };
}
