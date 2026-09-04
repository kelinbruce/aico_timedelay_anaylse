import { createSandboxClipCommandRunner, createUnavailableRagRetrievalGateway, type ClipCommandRunner } from '@nextagent/agent-capability';
import { AgentError, getLogger, type IdentityContext } from '@nextagent/agent-common';
import type { AgentAssembly } from '@nextagent/agent-contracts/agent-assembly';
import type { ExecutionCorrelationPort } from '@nextagent/agent-contracts/observability';
import type {
  GatewayBindings,
  CronTaskGatewayPort,
  GatewayProvider,
  GatewayProviderCreateInput,
  GatewayProviderSelectionEntry,
  RagRetrievalGateway,
  ScheduledMaintenanceGatewayPort,
  WorkflowRagRetrievalGateway,
} from '@nextagent/agent-contracts/gateway';
import { createMemoryConfiguredGateway } from '@nextagent/agent-memory';
import { createUnavailableWorkflowRagGateway } from '@nextagent/agent-workflow';
import { createObservedSandboxGateway, type ObservabilityProjectorHost, type TrustedOwnerScope } from '@nextagent/agent-observability';
import { createForkPromotionCleanupJob, createGatewayTodoState } from '@nextagent/agent-runtime';
import type { DefaultSystemConfig } from '../config/component-config.js';
import type {
  AppGatewayStores,
  AppSandboxGatewayPort,
  CronTaskGatewayFactory,
  RagRetrievalBinding,
  RagRetrievalFactory,
  SandboxGatewayFactoryInput,
  SandboxGatewayFactory,
  ScheduledMaintenanceGatewayFactory,
} from './composition-contracts.js';
import { emitDisabledLongTermMemoryInvocationLog } from './memory-config-telemetry.js';
import { findDuplicateProviderId } from './app-composition-helpers.js';
import { isGatewayAdapterSelected, isGatewayAdapterSelectedForDeployment } from '../config/gateway-selection.js';

const workflowRagGatewayLogger = getLogger({ component: 'agent-app', source: 'workflow-rag' });

interface ResolvedGatewayProviderSelection {
  readonly provider: GatewayProvider;
  readonly selectedEntries: readonly GatewayProviderSelectionEntry[];
}

function resolveGatewayProvidersForSelection(
  providers: readonly GatewayProvider[] | undefined,
  systemConfig: DefaultSystemConfig,
): readonly ResolvedGatewayProviderSelection[] | undefined {
  if (providers === undefined) {
    return undefined;
  }
  const duplicateProviderId = findDuplicateProviderId(providers);
  if (duplicateProviderId !== undefined) {
    throw new AgentError({
      code: 'GATEWAY_PROVIDER_DUPLICATE',
      message: 'Gateway provider identifiers must be unique.',
      category: 'VALIDATION',
      retryable: false,
      safeDetails: { providerId: duplicateProviderId },
    });
  }
  const entriesByProvider = new Map<GatewayProvider, GatewayProviderSelectionEntry[]>();
  for (const entry of selectedGatewayProviderEntries(systemConfig)) {
    const providersForEntry = providers.filter(
      (provider) => provider.deploymentMode === entry.deploymentMode && provider.supportedAdapterKinds.includes(entry.adapterKind),
    );
    if (providersForEntry.length !== 1) {
      throw new AgentError({
        code: providersForEntry.length === 0 ? 'GATEWAY_PROVIDER_MISSING' : 'GATEWAY_PROVIDER_AMBIGUOUS',
        message: 'Exactly one gateway provider must match each selected gateway entry.',
        category: 'VALIDATION',
        retryable: false,
        safeDetails: { deploymentMode: entry.deploymentMode, adapterKind: entry.adapterKind },
      });
    }
    const provider = providersForEntry[0]!;
    const selectedEntries = entriesByProvider.get(provider);
    if (selectedEntries === undefined) {
      entriesByProvider.set(provider, [entry]);
    } else {
      selectedEntries.push(entry);
    }
  }
  return Array.from(entriesByProvider, ([provider, selectedEntries]) => ({ provider, selectedEntries }));
}

export function createGatewayBindingsForSelection(
  providers: readonly GatewayProvider[] | undefined,
  systemConfig: DefaultSystemConfig,
  sandboxRuntimeInput: SandboxGatewayFactoryInput,
  executionCorrelation?: ExecutionCorrelationPort,
): GatewayBindings | undefined {
  const resolvedProviders = resolveGatewayProvidersForSelection(providers, systemConfig);
  if (resolvedProviders === undefined) {
    return undefined;
  }
  const bindings: GatewayBindings[] = [];
  try {
    for (const resolved of resolvedProviders) {
      let providerBindings: GatewayBindings;
      try {
        providerBindings = resolved.provider.create({
          selectedEntries: resolved.selectedEntries,
          runtime: gatewayProviderRuntimeContext(systemConfig, sandboxRuntimeInput),
          ...(executionCorrelation === undefined ? {} : { executionCorrelation }),
        });
      } catch (error) {
        throw new AgentError({
          code: 'GATEWAY_PROVIDER_CREATE_FAILED',
          message: 'Gateway provider failed to create bindings.',
          category: 'VALIDATION',
          retryable: false,
          safeDetails: { providerId: resolved.provider.providerId },
          cause: error,
        });
      }
      bindings.push(providerBindings);
      validateProviderGatewayBindings(providerBindings, resolved);
    }
    const mergedBindings = mergeGatewayBindings(bindings, systemConfig);
    validateGatewayBindings(mergedBindings, systemConfig);
    return mergedBindings;
  } catch (error) {
    closeCreatedGatewayBindings(bindings);
    throw error;
  }
}

function closeCreatedGatewayBindings(bindings: readonly GatewayBindings[]): void {
  for (const binding of [...bindings].reverse()) {
    closeGatewayBindingsQuietly(binding);
  }
}

function closeGatewayBindingsQuietly(bindings: GatewayBindings): void {
  try {
    void Promise.resolve(bindings.close?.()).catch(() => undefined);
  } catch {
    // Preserve the safe composition error that triggered cleanup.
  }
}

function validateProviderGatewayBindings(bindings: GatewayBindings, resolved: ResolvedGatewayProviderSelection): void {
  if (bindings.deploymentMode !== resolved.provider.deploymentMode) {
    throw new AgentError({
      code: 'GATEWAY_BINDINGS_DEPLOYMENT_MODE_MISMATCH',
      message: 'Gateway bindings deployment mode must match the selected gateway provider deployment mode.',
      category: 'VALIDATION',
      retryable: false,
      safeDetails: { providerId: resolved.provider.providerId, deploymentMode: resolved.provider.deploymentMode },
    });
  }
  if (bindings.readiness.state !== 'READY') {
    throw new AgentError({
      code: 'GATEWAY_BINDINGS_NOT_READY',
      message: 'Gateway bindings must be ready before app startup.',
      category: 'VALIDATION',
      retryable: false,
      safeDetails: {
        providerId: bindings.providerId,
        evidenceRef: bindings.readiness.evidenceRef,
      },
    });
  }
  for (const entry of resolved.selectedEntries) {
    const missingBinding = missingGatewayBinding(entry, bindings);
    if (missingBinding !== undefined) {
      throw new AgentError({
        code: 'GATEWAY_BINDINGS_INCOMPLETE',
        message: 'Gateway bindings must include the selected adapter binding.',
        category: 'VALIDATION',
        retryable: false,
        safeDetails: {
          providerId: bindings.providerId,
          adapterKind: entry.adapterKind,
          missingBinding,
        },
      });
    }
  }
  for (const [binding, adapterKind] of bindingAdapterKinds) {
    if (bindings[binding] !== undefined && !resolved.selectedEntries.some((entry) => entry.adapterKind === adapterKind)) {
      throw new AgentError({
        code: 'GATEWAY_BINDINGS_UNSELECTED',
        message: 'Gateway provider returned an unselected binding.',
        category: 'VALIDATION',
        retryable: false,
        safeDetails: { providerId: bindings.providerId, binding },
      });
    }
  }
}

export function validateGatewayBindings(bindings: GatewayBindings, systemConfig: DefaultSystemConfig): void {
  if (bindings.readiness.state !== 'READY') {
    throw new AgentError({
      code: 'GATEWAY_BINDINGS_NOT_READY',
      message: 'Gateway bindings must be ready before app startup.',
      category: 'VALIDATION',
      retryable: false,
      safeDetails: {
        providerId: bindings.providerId,
        evidenceRef: bindings.readiness.evidenceRef,
      },
    });
  }
  for (const entry of systemConfig.gatewaySelection.entries.filter((candidate) => candidate.selectionState === 'enabled')) {
    const missingBinding = missingGatewayBinding(entry, bindings);
    if (missingBinding !== undefined) {
      throw new AgentError({
        code: 'GATEWAY_BINDINGS_INCOMPLETE',
        message: 'Gateway bindings must include the selected adapter binding.',
        category: 'VALIDATION',
        retryable: false,
        safeDetails: {
          providerId: bindings.providerId,
          adapterKind: entry.adapterKind,
          missingBinding,
        },
      });
    }
  }
}

function mergeGatewayBindings(bindings: readonly GatewayBindings[], systemConfig: DefaultSystemConfig): GatewayBindings {
  if (bindings.length === 1) {
    return bindings[0]!;
  }
  const workingMemory = mergeGatewayBindingField(bindings, 'workingMemory');
  const longTermMemory = mergeGatewayBindingField(bindings, 'longTermMemory');
  const audit = mergeGatewayBindingField(bindings, 'audit');
  const sqliteStores = mergeGatewayBindingField(bindings, 'sqliteStores');
  const sandbox = mergeGatewayBindingField(bindings, 'sandbox');
  const ragRetrieval = mergeGatewayBindingField(bindings, 'ragRetrieval');
  const scheduledMaintenance = mergeGatewayBindingField(bindings, 'scheduledMaintenance');
  const cronTasks = mergeGatewayBindingField(bindings, 'cronTasks');
  const workflowRagRetrieval = mergeGatewayBindingField(bindings, 'workflowRagRetrieval');
  const guardrail = mergeGatewayBindingField(bindings, 'guardrail');
  const fetch = mergeGatewayBindingField(bindings, 'fetch');
  const watermark = mergeGatewayBindingField(bindings, 'watermark');
  const userQuery = mergeGatewayBindingField(bindings, 'userQuery');
  let closePromise: Promise<void> | undefined;
  const merged: GatewayBindings = {
    providerId: bindings.map((entry) => entry.providerId).join('+'),
    deploymentMode: systemConfig.gateway.deploymentMode,
    readiness: {
      state: 'READY',
      evidenceRef: bindings.map((entry) => entry.readiness.evidenceRef).join('+'),
      safeMessage: 'Gateway provider bindings are ready.',
    },
    ...(workingMemory === undefined ? {} : { workingMemory }),
    ...(longTermMemory === undefined ? {} : { longTermMemory }),
    ...(audit === undefined ? {} : { audit }),
    ...(sqliteStores === undefined ? {} : { sqliteStores }),
    ...(sandbox === undefined ? {} : { sandbox }),
    ...(ragRetrieval === undefined ? {} : { ragRetrieval }),
    ...(scheduledMaintenance === undefined ? {} : { scheduledMaintenance }),
    ...(cronTasks === undefined ? {} : { cronTasks }),
    ...(workflowRagRetrieval === undefined ? {} : { workflowRagRetrieval }),
    ...(guardrail === undefined ? {} : { guardrail }),
    ...(fetch === undefined ? {} : { fetch }),
    ...(watermark === undefined ? {} : { watermark }),
    ...(userQuery === undefined ? {} : { userQuery }),
    close: () => {
      closePromise ??= Promise.all(bindings.map((entry) => entry.close?.())).then(() => undefined);
      return closePromise;
    },
  };
  return merged;
}

function mergeGatewayBindingField<
  K extends
    | 'workingMemory'
    | 'longTermMemory'
    | 'audit'
    | 'sqliteStores'
    | 'sandbox'
    | 'ragRetrieval'
    | 'workflowRagRetrieval'
    | 'scheduledMaintenance'
    | 'cronTasks'
    | 'guardrail'
    | 'fetch'
    | 'watermark'
    | 'userQuery',
>(bindings: readonly GatewayBindings[], key: K): GatewayBindings[K] | undefined {
  const values = bindings.map((entry) => entry[key]).filter((value): value is NonNullable<GatewayBindings[K]> => value !== undefined);
  if (values.length > 1) {
    throw new AgentError({
      code: 'GATEWAY_BINDINGS_CONFLICT',
      message: 'Gateway providers returned conflicting bindings for the same adapter.',
      category: 'VALIDATION',
      retryable: false,
      safeDetails: { binding: key },
    });
  }
  return values[0];
}

function missingGatewayBinding(entry: GatewayProviderSelectionEntry, bindings: GatewayBindings): string | undefined {
  if (entry.adapterKind === 'working-memory' && bindings.workingMemory === undefined) {
    return 'workingMemory';
  }
  if (entry.adapterKind === 'long-term-memory' && bindings.longTermMemory === undefined) {
    return 'longTermMemory';
  }
  if (entry.adapterKind === 'sqlite' && bindings.sqliteStores === undefined) {
    return 'sqliteStores';
  }
  if (entry.adapterKind === 'sandbox' && bindings.sandbox === undefined) {
    return 'sandbox';
  }
  if (entry.adapterKind === 'rag-knowledge' && entry.deploymentMode === 'REMOTE' && bindings.ragRetrieval === undefined) {
    return 'ragRetrieval';
  }
  if (entry.adapterKind === 'scheduled-maintenance' && bindings.scheduledMaintenance === undefined) {
    return 'scheduledMaintenance';
  }
  if (entry.adapterKind === 'cron-tasks' && bindings.cronTasks === undefined) {
    return 'cronTasks';
  }
  if (entry.adapterKind === 'watermark' && entry.deploymentMode === 'REMOTE' && bindings.watermark === undefined) {
    return 'watermark';
  }
  if (entry.adapterKind === 'user-query' && bindings.userQuery === undefined) {
    return 'userQuery';
  }
  return undefined;
}

const bindingAdapterKinds = [
  ['workingMemory', 'working-memory'],
  ['longTermMemory', 'long-term-memory'],
  ['sqliteStores', 'sqlite'],
  ['sandbox', 'sandbox'],
  ['ragRetrieval', 'rag-knowledge'],
  ['scheduledMaintenance', 'scheduled-maintenance'],
  ['cronTasks', 'cron-tasks'],
  ['guardrail', 'guardrail'],
  ['watermark', 'watermark'],
  ['userQuery', 'user-query'],
] as const;

export function noopScheduledMaintenanceGateway(): ScheduledMaintenanceGatewayPort {
  return {
    register() {},
    start() {},
    async stop() {},
    async runOnce() {
      return { status: 'SKIPPED', safeReasonCode: 'SCHEDULED_MAINTENANCE_DISABLED' };
    },
  };
}

function gatewayProviderRuntimeContext(
  systemConfig: DefaultSystemConfig,
  sandboxRuntimeInput: SandboxGatewayFactoryInput,
): GatewayProviderCreateInput['runtime'] {
  return {
    paths: {
      workingMemorySqliteFile: systemConfig.paths.workingMemorySqliteFile,
      longTermMemorySqliteFile: systemConfig.paths.longTermMemorySqliteFile,
      sqliteFile: systemConfig.paths.sqliteFile,
      workspaceRoot: systemConfig.paths.workspaceRoot,
      logDirectory: systemConfig.paths.logDirectory,
      runtimeWorkspaceRoot: systemConfig.paths.runtimeWorkspaceRoot,
      sharedDataRoot: systemConfig.paths.sharedDataRoot,
    },
    sandbox: sandboxRuntimeInput,
  };
}

export function localGatewayStoresFromBindings(bindings?: GatewayBindings): AppGatewayStores | undefined {
  const workingMemory = bindings?.workingMemory;
  const longTermMemory = bindings?.longTermMemory;
  const sqliteStores = bindings?.sqliteStores;
  if (workingMemory === undefined || longTermMemory === undefined || sqliteStores === undefined) {
    return undefined;
  }
  const close = bindings?.close;
  return {
    ...workingMemory,
    ...sqliteStores,
    longTermMemoryStore: longTermMemory.store,
    longTermMemoryRetriever: longTermMemory.retriever,
    longTermMemorySharing: longTermMemory.sharing,
    gatewayKind: 'sqlite',
    ...(close === undefined ? {} : { close }),
  };
}

export function requireSandboxGatewayFactory(factory?: SandboxGatewayFactory): SandboxGatewayFactory {
  if (factory === undefined) {
    throw new AgentError({
      code: 'SANDBOX_GATEWAY_FACTORY_REQUIRED',
      message: 'Sandbox gateway bindings must be provided by a gateway provider or trusted entrypoint factory.',
      category: 'VALIDATION',
      retryable: false,
    });
  }
  return factory;
}

export function requireScheduledMaintenanceGatewayFactory(factory?: ScheduledMaintenanceGatewayFactory): ScheduledMaintenanceGatewayFactory {
  if (factory === undefined) {
    throw new AgentError({
      code: 'SCHEDULED_MAINTENANCE_GATEWAY_FACTORY_REQUIRED',
      message: 'Scheduled maintenance gateway bindings must be provided by a gateway provider or trusted entrypoint factory.',
      category: 'VALIDATION',
      retryable: false,
    });
  }
  return factory;
}

export function requireRagRetrievalFactory(factory?: RagRetrievalFactory): RagRetrievalFactory {
  if (factory === undefined) {
    throw new AgentError({
      code: 'RAG_RETRIEVAL_FACTORY_REQUIRED',
      message: 'RAG retrieval bindings must be provided by a trusted entrypoint factory.',
      category: 'VALIDATION',
      retryable: false,
    });
  }
  return factory;
}

export function selectedGatewayProviderEntries(systemConfig: DefaultSystemConfig): readonly GatewayProviderSelectionEntry[] {
  return systemConfig.gatewaySelection.entries
    .filter(
      (entry) =>
        entry.selectionState === 'enabled' &&
        entry.adapterKind !== 'workflow-execution' &&
        entry.adapterKind !== 'skillhub' &&
        entry.adapterKind !== 'api-call' &&
        !(entry.adapterKind === 'guardrail' && entry.deploymentMode === 'LOCAL') &&
        !(entry.adapterKind === 'watermark' && entry.deploymentMode === 'LOCAL'),
    )
    .map((entry) => ({
      gatewayId: entry.gatewayId,
      adapterKind: entry.adapterKind,
      deploymentMode: entry.deploymentMode,
      ...(entry.endpoint === undefined ? {} : { endpoint: entry.endpoint }),
    }));
}

export function resolveRagRetrievalGateway(
  systemConfig: DefaultSystemConfig,
  configuredRagRetrieval: RagRetrievalGateway | undefined,
  localRagRetrieval: RagRetrievalBinding,
): RagRetrievalBinding {
  const ragGateway = systemConfig.gatewaySelection.entries.find(
    (entry) => entry.adapterKind === 'rag-knowledge' && entry.selectionState === 'enabled',
  );
  if (ragGateway === undefined) {
    throw new AgentError({
      code: 'RAG_GATEWAY_UNAVAILABLE',
      message: 'RAG knowledge gateway is not enabled for the current deployment.',
      category: 'VALIDATION',
      retryable: false,
    });
  }
  if (configuredRagRetrieval !== undefined) {
    return configuredRagRetrievalBinding(configuredRagRetrieval);
  }
  if (ragGateway.deploymentMode !== 'LOCAL') {
    return configuredRagRetrievalBinding(createUnavailableRagRetrievalGateway());
  }
  return localRagRetrieval;
}

export function configuredRagRetrievalBinding(gateway: RagRetrievalGateway): RagRetrievalBinding {
  return {
    gateway,
    async build() {},
    async cleanup() {},
    close() {},
  };
}

export function resolveWorkflowRagGateway(
  systemConfig: DefaultSystemConfig,
  configuredWorkflowRagRetrieval: WorkflowRagRetrievalGateway | undefined,
  localRagRetrieval: RagRetrievalBinding,
): WorkflowRagRetrievalGateway {
  const ragGateway = systemConfig.gatewaySelection.entries.find(
    (entry) => entry.adapterKind === 'rag-knowledge' && entry.selectionState === 'enabled',
  );
  if (ragGateway === undefined) {
    throw new AgentError({
      code: 'RAG_GATEWAY_UNAVAILABLE',
      message: 'RAG knowledge gateway is not enabled for the current deployment.',
      category: 'VALIDATION',
      retryable: false,
    });
  }
  if (configuredWorkflowRagRetrieval !== undefined) {
    workflowRagGatewayLogger.info({ event: 'workflow_rag_gateway_resolved', path: 'remote-workflow-rag' });
    return configuredWorkflowRagRetrieval;
  }
  if (ragGateway.deploymentMode !== 'LOCAL') {
    workflowRagGatewayLogger.warn({ event: 'workflow_rag_gateway_resolved', path: 'unavailable', reason: 'remote_binding_missing' });
    return createUnavailableWorkflowRagGateway();
  }
  workflowRagGatewayLogger.info({ event: 'workflow_rag_gateway_resolved', path: 'local-rag-adapter' });
  if (localRagRetrieval.workflowGateway === undefined) {
    throw new AgentError({
      code: 'WORKFLOW_RAG_LOCAL_GATEWAY_REQUIRED',
      message: 'Local RAG bindings must provide the workflow RAG gateway.',
      category: 'VALIDATION',
      retryable: false,
    });
  }
  return localRagRetrieval.workflowGateway;
}

export interface GatewayLayerComposition {
  readonly gatewayBindings: GatewayBindings;
  readonly sandboxGateway: AppSandboxGatewayPort;
  readonly scheduledMaintenance: ScheduledMaintenanceGatewayPort;
  readonly cronTasks?: CronTaskGatewayPort;
  readonly closeCronTasks?: () => Promise<void> | void;
  readonly sqliteGateway: AppGatewayStores;
  readonly gateway: AppGatewayStores;
  readonly ragKnowledgeGovernance: RagRetrievalBinding;
  readonly ragRetrieval: RagRetrievalBinding;
  readonly workflowRagGateway: WorkflowRagRetrievalGateway;
  readonly todoState: ReturnType<typeof createGatewayTodoState>;
  readonly localPersistenceSelected: boolean;
  readonly cleanupHandles: ReadonlyArray<{
    readonly stage: string;
    readonly cleanup: () => void | Promise<void>;
  }>;
  ensureRagKnowledgeBuilt: (signal?: AbortSignal) => Promise<void>;
}

export function completeGatewayObservability(input: {
  readonly sandboxGateway: AppSandboxGatewayPort;
  readonly projectorHost: ObservabilityProjectorHost;
  readonly ownerScope: TrustedOwnerScope;
  readonly identity: IdentityContext;
  readonly injectedClipCommandRunner?: ClipCommandRunner;
  readonly executionCorrelation: ExecutionCorrelationPort;
  readonly remoteSandbox?: boolean;
}) {
  const sandboxGateway = createObservedSandboxGateway(input.sandboxGateway, {
    ownerScope: input.ownerScope,
    acceptor: input.projectorHost,
  });
  return {
    sandboxGateway,
    clipCommandRunner:
      input.injectedClipCommandRunner ??
      createSandboxClipCommandRunner({
        sandboxGateway,
        identity: input.identity,
        executionCorrelation: input.executionCorrelation,
        ...(input.remoteSandbox === undefined ? {} : { remoteSandbox: input.remoteSandbox }),
      }),
  };
}

export function composeGatewayLayer(input: {
  readonly systemConfig: DefaultSystemConfig;
  readonly sandboxRuntimeInput: SandboxGatewayFactoryInput;
  readonly identity: IdentityContext;
  readonly defaultRouteAssembly: AgentAssembly;
  readonly gatewayProviders?: readonly GatewayProvider[];
  readonly gatewayBindings?: GatewayBindings;
  readonly sandboxGatewayFactory?: SandboxGatewayFactory;
  readonly sandboxGateway?: AppSandboxGatewayPort;
  readonly scheduledMaintenanceGatewayFactory?: ScheduledMaintenanceGatewayFactory;
  readonly cronTaskGatewayFactory?: CronTaskGatewayFactory;
  readonly ragRetrievalFactory?: RagRetrievalFactory;
  readonly executionCorrelation: ExecutionCorrelationPort;
}): GatewayLayerComposition {
  const gatewayBindings =
    input.gatewayBindings ??
    createGatewayBindingsForSelection(input.gatewayProviders, input.systemConfig, input.sandboxRuntimeInput, input.executionCorrelation);
  if (gatewayBindings === undefined) {
    throw new AgentError({
      code: 'GATEWAY_PERSISTENCE_BINDINGS_REQUIRED',
      message: 'Working Memory, Long-term Memory, and retained SQLite bindings are required.',
      category: 'VALIDATION',
      retryable: false,
    });
  }
  validateGatewayBindings(gatewayBindings, input.systemConfig);
  const boundLocalStores = localGatewayStoresFromBindings(gatewayBindings);
  if (boundLocalStores === undefined) {
    closeGatewayBindingsQuietly(gatewayBindings);
    throw new AgentError({
      code: 'GATEWAY_PERSISTENCE_BINDINGS_REQUIRED',
      message: 'Working Memory, Long-term Memory, and retained SQLite bindings are required.',
      category: 'VALIDATION',
      retryable: false,
    });
  }
  const sandboxGateway =
    input.sandboxGateway ?? gatewayBindings?.sandbox ?? requireSandboxGatewayFactory(input.sandboxGatewayFactory)(input.sandboxRuntimeInput);
  const scheduledMaintenance =
    gatewayBindings?.scheduledMaintenance ??
    (isGatewayAdapterSelected(input.systemConfig, 'scheduled-maintenance')
      ? requireScheduledMaintenanceGatewayFactory(input.scheduledMaintenanceGatewayFactory)()
      : noopScheduledMaintenanceGateway());
  const cronTasksFromFactory =
    gatewayBindings?.cronTasks === undefined &&
    isGatewayAdapterSelected(input.systemConfig, 'cron-tasks') &&
    input.cronTaskGatewayFactory !== undefined
      ? input.cronTaskGatewayFactory(input.systemConfig.paths.sqliteFile)
      : undefined;
  const cronTasks = gatewayBindings?.cronTasks ?? cronTasksFromFactory;
  if (cronTasks === undefined && isGatewayAdapterSelected(input.systemConfig, 'cron-tasks')) {
    throw new AgentError({
      code: 'CRON_TASK_GATEWAY_UNAVAILABLE',
      message: 'Cron task gateway is required when Cron tools are registered.',
      category: 'VALIDATION',
      retryable: false,
    });
  }
  const closeCronTasks =
    cronTasks !== undefined &&
    (cronTasksFromFactory !== undefined || isGatewayAdapterSelectedForDeployment(input.systemConfig, 'cron-tasks', 'REMOTE'))
      ? async () => {
          const close = (cronTasks as { close?: () => Promise<void> | void }).close;
          try {
            await close?.call(cronTasks);
          } catch (error) {
            if (!(error instanceof Error) || !error.message.includes('database is not open')) {
              throw error;
            }
          }
        }
      : undefined;
  const sqliteGateway = boundLocalStores;
  const gateway = createMemoryConfiguredGateway(sqliteGateway, input.systemConfig.memory, {
    diagnosticObserver: (event) => emitDisabledLongTermMemoryInvocationLog({ event }),
  });
  scheduledMaintenance.register(createForkPromotionCleanupJob({ sessionForkStore: gateway.sessionForks }));
  const ragWorkspaceFilePolicy = input.defaultRouteAssembly.workspacePolicy.files ?? {
    readDirectories: ['.'],
    writeDirectories: ['.'],
    maxTextBytes: 256_000,
  };
  const ragKnowledgeGovernance =
    gatewayBindings?.ragRetrieval === undefined
      ? requireRagRetrievalFactory(input.ragRetrievalFactory)({
          sqliteFile: input.systemConfig.paths.sqliteFile,
          workspaceRoot: input.systemConfig.paths.workspaceRoot,
          workspacePolicy: {
            ...(ragWorkspaceFilePolicy.readDirectories === undefined ? {} : { readDirectories: ragWorkspaceFilePolicy.readDirectories }),
            maxTextBytes: ragWorkspaceFilePolicy.maxTextBytes ?? 256_000,
          },
          tenantId: input.identity.tenantId,
          subjectId: input.identity.subjectId,
          agentId: input.defaultRouteAssembly.agentId,
          agentVersion: input.defaultRouteAssembly.agentVersion,
        })
      : configuredRagRetrievalBinding(gatewayBindings.ragRetrieval);
  const ragRetrieval = resolveRagRetrievalGateway(input.systemConfig, gatewayBindings?.ragRetrieval, ragKnowledgeGovernance);
  const workflowRagGateway = resolveWorkflowRagGateway(input.systemConfig, gatewayBindings?.workflowRagRetrieval, ragKnowledgeGovernance);
  const todoState = createGatewayTodoState({ store: sqliteGateway.todoStateStore });
  const localPersistenceSelected =
    input.systemConfig.gateway.deploymentMode === 'LOCAL' && isGatewayAdapterSelectedForDeployment(input.systemConfig, 'sqlite', 'LOCAL');
  let ragKnowledgeBuildPromise: Promise<void> | undefined;
  return {
    gatewayBindings,
    sandboxGateway,
    scheduledMaintenance,
    ...(cronTasks === undefined ? {} : { cronTasks }),
    ...(closeCronTasks === undefined ? {} : { closeCronTasks }),
    sqliteGateway,
    gateway,
    ragKnowledgeGovernance,
    ragRetrieval,
    workflowRagGateway,
    todoState,
    localPersistenceSelected,
    cleanupHandles: [
      { stage: 'gateway-bindings', cleanup: () => gatewayBindings.close?.() },
      { stage: 'scheduled-maintenance', cleanup: () => scheduledMaintenance.stop() },
      ...(closeCronTasks === undefined ? [] : [{ stage: 'cron-task-store', cleanup: closeCronTasks }]),
      { stage: 'rag-governance', cleanup: () => ragKnowledgeGovernance.close() },
      { stage: 'rag-retrieval-close', cleanup: () => ragRetrieval.close() },
      { stage: 'rag-retrieval-cleanup', cleanup: () => ragRetrieval.cleanup() },
    ],
    async ensureRagKnowledgeBuilt(signal?: AbortSignal) {
      ragKnowledgeBuildPromise ??= ragRetrieval.build(signal);
      await ragKnowledgeBuildPromise;
    },
  };
}
