import type { ClipCommandRunner } from '@nextagent/agent-capability';
import type { IdentityContext, RuntimeLogger } from '@nextagent/agent-common';
import type { ModelInvocationRequest, ModelInvocationService } from '@nextagent/agent-contracts/model';
import { createForkActiveContextSelector } from '@nextagent/agent-context-engine';
import {
  createInMemoryMetricsRegistry,
  type InMemoryMetricsRegistry,
  type MetricSample,
  type MetricsRegistry,
  type ObservabilityProjector,
  type PushMetricExporter,
} from '@nextagent/agent-observability';
import type { DeterministicModelStep } from '@nextagent/agent-model/testing';
import type { RiskPolicyEvaluator } from '@nextagent/agent-contracts/runtime';
import type { LifecycleHook } from '@nextagent/agent-contracts/runtime';
import type { LifecycleHookDefinition, RuntimeLifecycleHookExecutor } from '@nextagent/agent-runtime';
import { createDeterministicModelInvocationService } from '@nextagent/agent-model/testing';

// Dynamic import avoids the agent-app ↔ agent-platform-gateway-local static-import
// cycle (agent-platform-gateway-local references agent-app in its tsconfig). A
// variable specifier (not a string literal) prevents tsc from resolving the
// import at compile time. TLA is supported in ESM with target ES2022.
const localGatewayPackage = '@nextagent/agent-platform-gateway-local';
const localGateway = (await import(localGatewayPackage)) as {
  readonly createLocalBackgroundTaskStore?: () => unknown;
  readonly createLocalGatewayProvider?: () => import('@nextagent/agent-contracts/gateway').GatewayProvider;
  readonly createSqliteWorkingMemoryGatewayProvider?: (
    providerId?: string,
    options?: { readonly forkActiveContextSelector?: import('@nextagent/agent-contracts/context').ForkActiveContextSelectionPort },
  ) => import('@nextagent/agent-contracts/gateway').GatewayProvider;
  readonly createSqliteLongTermMemoryGatewayProvider?: () => import('@nextagent/agent-contracts/gateway').GatewayProvider;
  readonly createSqliteCronTaskGateway: CronTaskGatewayFactory;
  readonly createLocalCronTaskScheduler: NonNullable<CreateComposedAppOptions['cronTaskSchedulerFactory']>;
  readonly createRestrictedLocalSandboxGateway?: (input: Record<string, unknown>) => unknown;
  readonly createLocalScheduledMaintenanceGateway?: () => unknown;
  readonly createLocalRagKnowledgeGovernance?: (input: Record<string, unknown>) => unknown;
};
import { loadBuiltInDefaultAgentDefinition } from '../assembly/agent-directory-loader.js';
import type { ClipcDisclosureMode, SkillDisclosureMode, ToolDisclosureMode } from '../config/component-config.js';
import type { RawModelProviderProfileConfig } from '../config/component-config.js';
import type { CapabilityProvidersConfig } from '../config/capability-providers.js';
import { createAppCredentialResolver } from '../config/env.js';
import { validateDefaultSystemConfig } from '../config/validation.js';
import type {
  AppSandboxGatewayPort,
  CreateComposedAppOptions,
  CronTaskGatewayFactory,
  NextAgentApp,
  RagRetrievalFactory,
  SandboxGatewayFactory,
  ScheduledMaintenanceGatewayFactory,
} from './composition-contracts.js';
import type { BackgroundTaskStoreGatewayPort } from '@nextagent/agent-contracts/gateway';
import type { AuditEventRecord, GatewayProvider } from '@nextagent/agent-contracts/gateway';
import type { OperationalLogWriter } from '@nextagent/agent-log';
import { runProductCompositionSync } from './create-app.js';
import { createLocalConfiguredAuthChannelContribution } from './local-configured-auth-channel-contribution.js';
import { withTestObservationLogger } from './test-observation-logger.js';
import { registerNextAgentTestApp } from './test-lifecycle.js';
import { createIsolatedTestSqlitePaths } from './test-sqlite-path.js';
import { createScriptedModelProviderFixture } from '../testing/scripted-model-provider-fixture.js';

export interface NextAgentTestAppOptions {
  readonly serviceVersion?: string;
  readonly workspaceDir?: string;
  readonly modelSteps: readonly DeterministicModelStep[];
  readonly model?: ModelInvocationService;
  readonly agentDefinition?: CreateComposedAppOptions['agentDefinition'];
  readonly identity?: IdentityContext;
  readonly channelPort?: number;
  readonly localAuthEnabled?: boolean;
  readonly operationalLogWriter?: OperationalLogWriter;
  readonly observationLogger?: RuntimeLogger;
  readonly metricsRegistry?: MetricsRegistry;
  readonly metricsExporter?: PushMetricExporter;
  readonly traceProjector?: ObservabilityProjector;
  readonly diagnosticDetail?: 'normal' | 'debug';
  readonly lifecycleHooks?: readonly LifecycleHook[];
  readonly lifecycleHook?: RuntimeLifecycleHookExecutor;
  readonly lifecycleHookDefinitions?: readonly LifecycleHookDefinition[] | undefined;
  readonly hooks?: ReadonlyArray<{
    readonly hookId: string;
    readonly enabled?: boolean;
    readonly disabled?: boolean;
    readonly stages?: ReadonlyArray<import('@nextagent/agent-contracts/runtime').LifecycleStage>;
    readonly order?:
      number | { readonly priority?: number; readonly before?: string | readonly string[]; readonly after?: string | readonly string[] };
    readonly timeoutMs?: number;
    readonly config?: import('@nextagent/agent-common').JsonObject;
  }>;
  readonly sandboxGateway?: AppSandboxGatewayPort;
  readonly sandboxGatewayFactory?: SandboxGatewayFactory;
  readonly scheduledMaintenanceGatewayFactory?: ScheduledMaintenanceGatewayFactory;
  readonly cronTaskGatewayFactory?: CronTaskGatewayFactory;
  readonly cronTaskSchedulerFactory?: CreateComposedAppOptions['cronTaskSchedulerFactory'];
  readonly cronTaskIdFactory?: () => string;
  readonly cronDeploymentMode?: 'LOCAL' | 'REMOTE';
  readonly cronTriggerCallbackCredentialRef?: CreateComposedAppOptions['cronTriggerCallbackCredentialRef'];
  readonly cronTriggerCallbackRegistration?: CreateComposedAppOptions['cronTriggerCallbackRegistration'];
  readonly ragRetrievalFactory?: RagRetrievalFactory;
  readonly backgroundTaskStoreFactory?: () => BackgroundTaskStoreGatewayPort;
  readonly riskPolicyEvaluator?: RiskPolicyEvaluator;
  readonly modelRequestSink?: ModelInvocationRequest[];
  readonly modelProfiles?: readonly RawModelProviderProfileConfig[];
  readonly toolDisclosureMode?: ToolDisclosureMode;
  readonly skillDisclosureMode?: SkillDisclosureMode;
  readonly clipcDisclosureMode?: ClipcDisclosureMode;
  readonly taskCallback?: {
    readonly allowedOrigins: readonly string[];
    readonly timeoutMs?: number;
    readonly maxRetries?: number;
  };
  readonly capabilityProviders?: CapabilityProvidersConfig;
  readonly clipCommandRunner?: ClipCommandRunner;
  readonly gatewayProviders?: NonNullable<CreateComposedAppOptions['gatewayProviders']>;
  readonly skillHubAccessFactory?: CreateComposedAppOptions['skillHubAccessFactory'] | undefined;
  readonly guardrailProvider?: NonNullable<CreateComposedAppOptions['gatewayProviders']>[number];
}

const capturedAuditRecords = new WeakMap<NextAgentApp, AuditEventRecord[]>();

export function readCapturedAuditRecords(app: NextAgentApp): readonly AuditEventRecord[] {
  return capturedAuditRecords.get(app) ?? [];
}

export function readCapturedMetricSamples(app: NextAgentApp): readonly MetricSample[] {
  const registry = app.metricsRegistry as MetricsRegistry & Partial<Pick<InMemoryMetricsRegistry, 'snapshot'>>;
  return registry.snapshot?.() ?? [];
}

export function createNextAgentTestApp(options: NextAgentTestAppOptions): NextAgentApp {
  const auditRecords: AuditEventRecord[] = [];
  const credentialResolver = createAppCredentialResolver({
    NEXTAGENT_TEST_ONLY: 'test-only',
    NEXTAGENT_TEST_LOCAL_AUTH: 'test-local-auth',
    NEXTAGENT_TEST_CRON_CALLBACK: 'cron-callback-secret',
  });
  const modelProfiles = options.modelProfiles ?? [
    {
      providerId: 'openai-compatible',
      baseUrl: 'https://api.minimaxi.com/v1',
      credentialRef: 'env:NEXTAGENT_TEST_ONLY',
      models: [
        {
          modelId: 'deterministic-test-model',
          timeoutMs: 30_000,
          temperature: 0.2,
          maxOutputTokens: 2048,
          contextWindowTokens: 128_000,
          fallbackEligible: false,
        },
      ],
    },
  ];
  const baseSystemConfig = validateDefaultSystemConfig(
    {
      deployment: { mode: 'LOCAL' },
      paths: { workspaceRoot: '.' },
      observability: { logging: { diagnosticDetail: options.diagnosticDetail ?? 'normal' } },
      auth: {
        mode: 'local',
        localIdentity: { tenantId: 'local-tenant', subjectId: 'local-subject', displayName: 'Local developer' },
        localAuth:
          options.localAuthEnabled === true
            ? { enabled: true, credentialRef: 'env:NEXTAGENT_TEST_LOCAL_AUTH', cookieTtlMs: 3_600_000 }
            : { enabled: false },
      },
      channel: { transport: 'fastify', host: '127.0.0.1', port: options.channelPort ?? 3000 },
      hostedAgent: { activeAgentId: 'default-agent' },
      modelProfiles,
      gateway: {
        gateways: [
          { gatewayId: 'local-working-memory', gatewayKind: 'working-memory', deploymentMode: 'LOCAL' },
          { gatewayId: 'local-long-term-memory', gatewayKind: 'long-term-memory', deploymentMode: 'LOCAL' },
          { gatewayId: 'local-sqlite', gatewayKind: 'sqlite', deploymentMode: 'LOCAL', sqliteFileRef: 'paths.sqliteFile' },
          options.cronDeploymentMode === 'REMOTE'
            ? { gatewayId: 'remote-cron', gatewayKind: 'cron-tasks', deploymentMode: 'REMOTE' }
            : { gatewayId: 'local-cron', gatewayKind: 'cron-tasks', deploymentMode: 'LOCAL', sqliteFileRef: 'paths.sqliteFile' },
          { gatewayId: 'local-rag', gatewayKind: 'rag-knowledge', deploymentMode: 'LOCAL' },
          { gatewayId: 'skillhub', gatewayKind: 'skillhub', deploymentMode: 'REMOTE' },
          { gatewayId: 'local-workflow', gatewayKind: 'workflow-execution', deploymentMode: 'LOCAL' },
          { gatewayId: 'local-user-query', gatewayKind: 'user-query', deploymentMode: 'LOCAL' },
          ...(options.guardrailProvider === undefined
            ? []
            : [{ gatewayId: 'guardrail-1', gatewayKind: 'guardrail', deploymentMode: 'REMOTE' as const }]),
        ],
      },
      noopBoundaries: { lifecycleHook: 'noop', checkpoint: 'noop', audit: 'noop' },
      nextAgent: {
        system: {
          'capability-providers': [
            {
              id: 'hub-local',
              type: 'skill-hub',
              gatewayId: 'skillhub',
              installDir: './skillhub-managed',
            },
          ],
        },
      },
    },
    options.workspaceDir ?? process.cwd(),
    { credentialResolver, loggingProfile: 'test' },
  );
  const isolatedSqlitePaths = createIsolatedTestSqlitePaths();
  const systemConfig = {
    ...baseSystemConfig,
    observability: {
      ...baseSystemConfig.observability,
      ...(options.traceProjector === undefined
        ? {}
        : {
            tracing: {
              ...baseSystemConfig.observability.tracing,
              enabled: true,
            },
          }),
    },
    taskCallback: {
      allowedOrigins: options.taskCallback?.allowedOrigins ?? baseSystemConfig.taskCallback.allowedOrigins,
      timeoutMs: options.taskCallback?.timeoutMs ?? baseSystemConfig.taskCallback.timeoutMs,
      maxRetries: options.taskCallback?.maxRetries ?? baseSystemConfig.taskCallback.maxRetries,
    },
    capabilityDisclosure: {
      ...baseSystemConfig.capabilityDisclosure,
      toolDisclosureMode: options.toolDisclosureMode ?? baseSystemConfig.capabilityDisclosure.toolDisclosureMode,
      skillDisclosureMode: options.skillDisclosureMode ?? baseSystemConfig.capabilityDisclosure.skillDisclosureMode,
      clipcDisclosureMode: options.clipcDisclosureMode ?? baseSystemConfig.capabilityDisclosure.clipcDisclosureMode,
    },
    userCapabilityProviders: options.capabilityProviders ?? baseSystemConfig.userCapabilityProviders,
    paths: {
      ...baseSystemConfig.paths,
      ...isolatedSqlitePaths,
    },
  };
  const agentDefinition = options.agentDefinition ?? { ...loadBuiltInDefaultAgentDefinition(), workspaceDir: '.' };
  const appOptions: CreateComposedAppOptions = {
    ...(options.serviceVersion === undefined ? {} : { serviceVersion: options.serviceVersion }),
    systemConfig,
    agentDefinition: {
      ...agentDefinition,
      hooks:
        options.hooks?.map((binding) => ({
          hookId: binding.hookId,
          ...(binding.enabled === undefined ? {} : { enabled: binding.enabled }),
          ...(binding.disabled === undefined ? {} : { disabled: binding.disabled }),
          ...(binding.stages === undefined ? {} : { stages: binding.stages }),
          ...(binding.order === undefined ? {} : { order: typeof binding.order === 'number' ? { priority: binding.order } : binding.order }),
          ...(binding.timeoutMs === undefined ? {} : { timeoutMs: binding.timeoutMs }),
          ...(binding.config === undefined ? {} : { config: binding.config }),
        })) ??
        agentDefinition.hooks ??
        [],
    },
    credentialResolver,
    ...(options.metricsExporter === undefined
      ? { metricsRegistry: options.metricsRegistry ?? createInMemoryMetricsRegistry() }
      : { metricsExporter: options.metricsExporter }),
    ...(options.observationLogger === undefined
      ? options.operationalLogWriter === undefined
        ? {}
        : { operationalLogWriter: options.operationalLogWriter }
      : { operationalLogWriter: withTestObservationLogger(options.observationLogger, options.operationalLogWriter) }),
    ...(options.identity === undefined ? {} : { identity: options.identity }),
    ...(options.traceProjector === undefined ? {} : { traceProjector: options.traceProjector }),
    ...(options.lifecycleHooks === undefined ? {} : { lifecycleHooks: options.lifecycleHooks }),
    ...(options.lifecycleHook === undefined ? {} : { lifecycleHook: options.lifecycleHook }),
    ...(options.lifecycleHookDefinitions === undefined ? {} : { lifecycleHookDefinitions: options.lifecycleHookDefinitions }),
    ...(options.sandboxGateway === undefined ? {} : { sandboxGateway: options.sandboxGateway }),
    ...(options.riskPolicyEvaluator === undefined ? {} : { riskPolicyEvaluator: options.riskPolicyEvaluator }),
    ...(options.clipCommandRunner === undefined ? {} : { clipCommandRunner: options.clipCommandRunner }),
    // Default the local gateway factories so tests get real sqlite stores /
    // sandbox / scheduled-maintenance / rag without wiring them explicitly
    // (matches the pre-gateway-provider-refactor inline creation). Tests can
    // still override sandboxGateway with a mock.
    gatewayProviders: [
      ...(options.gatewayProviders ?? defaultLocalPersistenceProviders(auditRecords)),
      ...(options.guardrailProvider === undefined ? [] : [options.guardrailProvider]),
    ],
    skillHubAccessFactory: options.skillHubAccessFactory ?? unavailableTestSkillHubAccessFactory,
    ...(options.backgroundTaskStoreFactory === undefined
      ? { backgroundTaskStoreFactory: localGateway.createLocalBackgroundTaskStore as () => BackgroundTaskStoreGatewayPort }
      : { backgroundTaskStoreFactory: options.backgroundTaskStoreFactory }),
    ...(options.cronTaskGatewayFactory === undefined
      ? { cronTaskGatewayFactory: localGateway.createSqliteCronTaskGateway }
      : { cronTaskGatewayFactory: options.cronTaskGatewayFactory }),
    ...(options.cronTaskSchedulerFactory === undefined
      ? { cronTaskSchedulerFactory: localGateway.createLocalCronTaskScheduler }
      : { cronTaskSchedulerFactory: options.cronTaskSchedulerFactory }),
    ...(options.cronTaskIdFactory === undefined ? {} : { cronTaskIdFactory: options.cronTaskIdFactory }),
    ...(options.cronTriggerCallbackCredentialRef === undefined ? {} : { cronTriggerCallbackCredentialRef: options.cronTriggerCallbackCredentialRef }),
    ...(options.cronTriggerCallbackRegistration === undefined ? {} : { cronTriggerCallbackRegistration: options.cronTriggerCallbackRegistration }),
    ...(options.sandboxGatewayFactory === undefined
      ? { sandboxGatewayFactory: localGateway.createRestrictedLocalSandboxGateway as unknown as SandboxGatewayFactory }
      : { sandboxGatewayFactory: options.sandboxGatewayFactory }),
    ...(options.scheduledMaintenanceGatewayFactory === undefined
      ? { scheduledMaintenanceGatewayFactory: localGateway.createLocalScheduledMaintenanceGateway as ScheduledMaintenanceGatewayFactory }
      : { scheduledMaintenanceGatewayFactory: options.scheduledMaintenanceGatewayFactory }),
    ...(options.ragRetrievalFactory === undefined
      ? { ragRetrievalFactory: localGateway.createLocalRagKnowledgeGovernance as unknown as RagRetrievalFactory }
      : { ragRetrievalFactory: options.ragRetrievalFactory }),
  };
  const model = captureModelRequests(options.model ?? createDeterministicModelInvocationService(options.modelSteps), options.modelRequestSink);
  const scriptedModel = createScriptedModelProviderFixture(systemConfig, model);
  const app = runProductCompositionSync(
    {
      ...appOptions,
      systemConfig: scriptedModel.systemConfig,
      modelGatewayProviders: scriptedModel.modelGatewayProviders,
    },
    options.localAuthEnabled === true
      ? {
          channelAuthProfile: 'LOCAL_CONFIGURED_AUTH',
          frontendHostingProfile: 'NONE',
          localConfiguredAuthContribution: createLocalConfiguredAuthChannelContribution(),
        }
      : { channelAuthProfile: 'DEFAULT_WEB', frontendHostingProfile: 'NONE' },
  ).app;
  capturedAuditRecords.set(app, auditRecords);
  return registerNextAgentTestApp(app);
}

function defaultLocalPersistenceProviders(auditRecords: AuditEventRecord[]): NonNullable<CreateComposedAppOptions['gatewayProviders']> {
  if (
    typeof localGateway.createSqliteWorkingMemoryGatewayProvider !== 'function' ||
    typeof localGateway.createSqliteLongTermMemoryGatewayProvider !== 'function' ||
    typeof localGateway.createLocalGatewayProvider !== 'function'
  ) {
    throw new Error('NextAgent test composition requires all local persistence gateway providers.');
  }
  const localProvider = localGateway.createLocalGatewayProvider();
  const captureProvider: GatewayProvider = {
    ...localProvider,
    create(input) {
      const bindings = localProvider.create(input);
      return {
        ...bindings,
        audit: {
          async appendAuditEvent(record) {
            auditRecords.push(record);
          },
        },
      };
    },
  };
  return [
    localGateway.createSqliteWorkingMemoryGatewayProvider('local-working-memory-gateway', {
      forkActiveContextSelector: createForkActiveContextSelector(),
    }),
    localGateway.createSqliteLongTermMemoryGatewayProvider(),
    captureProvider,
  ];
}

function captureModelRequests(model: ModelInvocationService, sink?: ModelInvocationRequest[]): ModelInvocationService {
  if (sink === undefined) {
    return model;
  }
  return {
    async complete(request, signal) {
      sink.push(request);
      return await model.complete(request, signal);
    },
    async stream(request, signal, onDelta) {
      sink.push(request);
      return await model.stream(request, signal, onDelta);
    },
  };
}

const unavailableTestSkillHubAccessFactory: NonNullable<CreateComposedAppOptions['skillHubAccessFactory']> = () => ({
  async listCandidates() {
    return { status: 'failed', reasonCode: 'unavailable', message: 'SkillHub unavailable.' };
  },
  async fetchContent() {
    return { status: 'failed', reasonCode: 'download-failed', message: 'Package unavailable.' };
  },
});
