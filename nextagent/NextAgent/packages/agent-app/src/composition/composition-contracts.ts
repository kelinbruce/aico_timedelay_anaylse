import type { CapabilitySubsystemOptions } from '@nextagent/agent-capability';
import type {
  AttachmentCleanupRuntime,
  AttachmentIntakeRuntime,
  AttachmentStagedUploadRuntime,
  AttachmentSummaryResolver,
} from '@nextagent/agent-attachment-runtime';
import type { registerWebChannel } from '@nextagent/agent-channel-web';
import type { AgentId, AgentVersion, IdentityContext, JsonObject, SecretReference, SubjectId, TenantId } from '@nextagent/agent-common';
import type { AgentAssembly, AgentAssemblyRegistry } from '@nextagent/agent-contracts/agent-assembly';
import type { CapabilityCatalog, CapabilityCurrentViewPort } from '@nextagent/agent-contracts/capability';
import type { CronTaskManagementPort, LongTermMemoryManagementPort } from '@nextagent/agent-contracts/channel';
import type { WorkflowExecutionMode, WorkflowExecutionService, WorkflowRemoteExecutionGateway } from '@nextagent/agent-contracts/core';
import type {
  GatewayBindings,
  GatewayProvider,
  QuestionRecommendationGateway,
  LongTermMemoryGatewayBindings,
  SqliteGatewayStoreBindings,
  WorkingMemoryGatewayBindings,
  BackgroundTaskStoreGatewayPort,
  CronTaskGatewayPort,
  RagRetrievalGateway,
  WorkflowRagRetrievalGateway,
  SandboxExecutionRequest,
  SandboxExecutionResult,
  ScheduledMaintenanceGatewayPort,
} from '@nextagent/agent-contracts/gateway';
import type { ModelGatewayProvider } from '@nextagent/agent-contracts/model';
import type { ExecutionCorrelationPort } from '@nextagent/agent-contracts/observability';
import type {
  CategoryQuestionPort,
  FrequentQuestionPort,
  LifecycleHook,
  RiskPolicyEvaluator,
  RuntimeSessionActivityPort,
  SuggestedQuestionPort,
} from '@nextagent/agent-contracts/runtime';
import type { CredentialResolver } from '@nextagent/agent-model';
import type {
  AuditEvent,
  AuditEventWriter,
  HealthEvaluator,
  MetricsRegistry,
  MetricsInfrastructure,
  PushMetricExporter,
  ObservabilityProjector,
} from '@nextagent/agent-observability';
import type { createConversationAnnotationService, createConversationShareService, createUserSessionService } from '@nextagent/agent-session';
import type { createRequestLifecycleCoordinator, LifecycleHookDefinition, RuntimeLifecycleHookExecutor } from '@nextagent/agent-runtime';
import type { WorkflowExecutionServiceFactoryOptions } from '@nextagent/agent-workflow';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { IncomingMessage } from 'node:http';
import type { AgentDefinition } from '../assembly/agent-definition.js';
import type { ResolvedCapabilityProviders } from '../config/capability-providers.js';
import type { DefaultSystemConfig } from '../config/component-config.js';
import type { AppCredentialResolver } from '../config/env.js';
import type { PluginRegistrySnapshot } from '../plugin/plugin-loader.js';
import type { OperationalLogWriter } from '@nextagent/agent-log';
import type { DeveloperDiagnosticArtifactEmitResult, DeveloperDiagnosticArtifactInput } from '@nextagent/agent-plugin-sdk';
import type { CronTriggerCallbackHandler } from './cron-trigger-callback-handler.js';

export type AgentScope = Pick<AgentAssembly, 'agentId' | 'agentVersion'>;
type CapabilitySkillHubAccessFactory = NonNullable<CapabilitySubsystemOptions['skillHubRemoteAccessFactory']>;
export type SkillHubAccessFactory = (
  config: Parameters<CapabilitySkillHubAccessFactory>[0],
  executionCorrelation?: ExecutionCorrelationPort,
) => ReturnType<CapabilitySkillHubAccessFactory>;

export interface RagRetrievalBinding {
  readonly gateway: RagRetrievalGateway;
  readonly workflowGateway?: WorkflowRagRetrievalGateway;
  build: (signal?: AbortSignal) => Promise<void>;
  cleanup: () => Promise<void>;
  close: () => void;
}

export type { AttachmentSummaryResolver };

export type ModelProviderBuildProfile = 'DEFAULT' | 'MODEL_GATEWAY_ONLY';

export interface CreateNextAgentAppOptions {
  readonly serviceVersion?: string;
  readonly credentialResolver?: AppCredentialResolver;
  readonly identity?: IdentityContext;
  readonly configFile?: string;
  readonly gatewayProviders?: readonly GatewayProvider[];
  readonly sandboxGatewayFactory?: SandboxGatewayFactory;
  readonly scheduledMaintenanceGatewayFactory?: ScheduledMaintenanceGatewayFactory;
  readonly cronTaskGatewayFactory?: CronTaskGatewayFactory;
  readonly cronTaskSchedulerFactory?: CronTaskSchedulerFactory;
  readonly cronTriggerCallbackCredentialRef?: SecretReference;
  readonly cronTriggerCallbackRegistration?: CronTriggerCallbackRegistrationFactory;
  readonly ragRetrievalFactory?: RagRetrievalFactory;
  readonly backgroundTaskStoreFactory?: () => BackgroundTaskStoreGatewayPort;
  readonly skillHubAccessFactory?: SkillHubAccessFactory;
  readonly modelGatewayProviders?: readonly ModelGatewayProvider[];
  readonly modelProviderProfile?: ModelProviderBuildProfile;
  readonly metricsExporter?: PushMetricExporter;
  readonly questionRecommendationsGateway?: QuestionRecommendationGateway;
  readonly webChannelRegistration?: WebChannelRegistrationFactory;
  readonly webIdentityResolver?: WebIdentityResolver;
  readonly developerDiagnosticArtifactWriterFactory?: DeveloperDiagnosticArtifactWriterFactory;
}

export type NextAgentAppOptions = CreateNextAgentAppOptions;

export interface CreateComposedAppOptions extends Omit<CreateNextAgentAppOptions, 'credentialResolver'> {
  readonly credentialResolver?: AppCredentialResolver;
  readonly systemConfig?: DefaultSystemConfig;
  readonly agentDefinition?: AgentDefinition;
  readonly riskPolicyEvaluator?: RiskPolicyEvaluator;
  readonly registeredCustomAdapterTypes?: ReadonlySet<string>;
  readonly capabilityProviderReferenceValidation?: CapabilityProviderReferenceValidation;
  readonly sandboxGateway?: AppSandboxGatewayPort;
  readonly operationalLogWriter?: OperationalLogWriter;
  readonly metricsRegistry?: MetricsRegistry;
  readonly metricsInfrastructure?: MetricsInfrastructure;
  readonly clipCommandRunner?: import('@nextagent/agent-capability').ClipCommandRunner;
  readonly traceProjector?: ObservabilityProjector;
  readonly trustedLocalWebExtensionRegistration?: TrustedLocalWebExtensionRegistration;
  readonly trustedLocalWebExtensionProtectedPrefixes?: readonly string[];
  readonly taskChannelRegistration?: TaskChannelRegistrationFactory;
  readonly lifecycleHooks?: readonly LifecycleHook[];
  readonly lifecycleHook?: RuntimeLifecycleHookExecutor;
  readonly lifecycleHookDefinitions?: readonly LifecycleHookDefinition[];
  readonly workflowExecutionServiceFactory?: (options: WorkflowExecutionServiceFactoryOptions) => WorkflowExecutionService;
  readonly workflowExecutionMode?: WorkflowExecutionMode;
  readonly workflowRemoteExecutionGateway?: WorkflowRemoteExecutionGateway;
  readonly pluginRegistrySnapshot?: PluginRegistrySnapshot;
  readonly gatewayBindings?: GatewayBindings;
  readonly cronTaskIdFactory?: () => string;
  readonly chatUploadFileConfig?: import('@nextagent/agent-attachment-runtime').ChatUploadFileConfig;
  readonly chatUploadConfigProvider?: import('@nextagent/agent-channel-web').ChatUploadConfigProviderPort;
  readonly operationLogPort?: import('@nextagent/agent-contracts/gateway').OperationLogGatewayPort;
}

export interface DeveloperDiagnosticArtifactWriter {
  start: () => Promise<void>;
  emit: (input: DeveloperDiagnosticArtifactInput & { readonly pluginId: string }) => Promise<DeveloperDiagnosticArtifactEmitResult>;
  close: (timeoutMs?: number) => Promise<void>;
  status: () => DeveloperDiagnosticArtifactStatus;
}

export interface DeveloperDiagnosticArtifactStatus {
  readonly availability: 'AVAILABLE' | 'DEGRADED';
  readonly droppedCount: number;
  readonly lastFailureCode?: 'INVALID_RECORD' | 'RECORD_TOO_LARGE' | 'QUEUE_OVERLOADED' | 'OUTPUT_UNAVAILABLE';
}

export type DeveloperDiagnosticArtifactWriterFactory = (input: { readonly logDirectory: string }) => DeveloperDiagnosticArtifactWriter;

export interface AppSandboxGatewayPort {
  execute: (request: SandboxExecutionRequest, signal?: AbortSignal) => Promise<SandboxExecutionResult>;
  executeWithStdoutChunks?: (
    request: SandboxExecutionRequest,
    options: { readonly onStdoutChunk?: (chunk: string) => void | Promise<void> },
    signal?: AbortSignal,
  ) => Promise<SandboxExecutionResult>;
  isExecutionReady?: () => boolean;
}

export type AppGatewayStores = WorkingMemoryGatewayBindings &
  SqliteGatewayStoreBindings & {
    readonly longTermMemoryStore: LongTermMemoryGatewayBindings['store'];
    readonly longTermMemoryRetriever: LongTermMemoryGatewayBindings['retriever'];
    readonly longTermMemorySharing: LongTermMemoryGatewayBindings['sharing'];
    readonly gatewayKind: 'sqlite';
    close?: () => Promise<void> | void;
  };

export type SandboxGatewayFactory = (input: SandboxGatewayFactoryInput) => AppSandboxGatewayPort;

export interface SandboxGatewayFactoryInput {
  readonly allowedApis: readonly string[];
  readonly allowedExecutables?: readonly string[];
  readonly clipcExecutableDirectory?: string;
  readonly deniedExecutables: readonly string[];
  readonly enabled: boolean;
}

export type ScheduledMaintenanceGatewayFactory = () => ScheduledMaintenanceGatewayPort;

export type CronTaskGatewayFactory = (sqliteFile: string) => CronTaskGatewayPort;

export type CronTaskSchedulerFactory = (input: {
  readonly cronTasks: CronTaskGatewayPort;
  readonly delivery: {
    deliver: (request: {
      readonly task: import('@nextagent/agent-contracts/gateway').CronTaskRecord;
      readonly trigger: import('@nextagent/agent-contracts/gateway').CronTriggerRecord;
      readonly signal: AbortSignal;
    }) => Promise<unknown>;
  };
  readonly computeNextRunAt: (cron: string, fromMs: number) => number | null;
}) => { start: () => void; stop: () => Promise<void> };

export interface CronTriggerCallbackRegistrationContext {
  readonly server: FastifyInstance;
  readonly handler: CronTriggerCallbackHandler;
}

export interface CronTriggerCallbackRegistration {
  ready?: () => Promise<void>;
  close?: () => Promise<void>;
}

export type CronTriggerCallbackRegistrationFactory = (context: CronTriggerCallbackRegistrationContext) => CronTriggerCallbackRegistration | void;

export type RagRetrievalFactory = (input: RagRetrievalFactoryInput) => RagRetrievalBinding;

export interface RagRetrievalFactoryInput {
  readonly sqliteFile: string;
  readonly workspaceRoot: string;
  readonly workspacePolicy: {
    readonly readDirectories?: readonly string[];
    readonly maxTextBytes: number;
  };
  readonly tenantId: TenantId;
  readonly subjectId: SubjectId;
  readonly agentId: AgentId;
  readonly agentVersion: AgentVersion;
}

export interface CapabilityProviderReferenceValidation {
  readonly isCredentialReferenceResolvable: (reference: SecretReference) => boolean;
  readonly resolveLocalDirectoryPath: (path: string) => string;
  readonly isUrlResolvable: (url: string) => boolean;
}

export type WebIdentityResolver = (request: FastifyRequest | IncomingMessage) => IdentityContext;
export type WebRuntimeCommandPort = Parameters<typeof registerWebChannel>[1]['runtime'];

export interface WebChannelRegistrationContext {
  readonly server: FastifyInstance;
  readonly runtime: ReturnType<typeof createRequestLifecycleCoordinator>;
  readonly runtimeCommands: WebRuntimeCommandPort;
  readonly sessionActivities: RuntimeSessionActivityPort;
  readonly attachmentRuntime: AttachmentIntakeRuntime;
  readonly attachmentCleanupRuntime: AttachmentCleanupRuntime;
  readonly systemConfig: DefaultSystemConfig;
  readonly credentialResolver: CredentialResolver;
  readonly identity: IdentityContext;
  readonly health: HealthEvaluator;
  readonly catalog: CapabilityCatalog;
  readonly capabilityCurrentView: CapabilityCurrentViewPort;
  readonly assemblyRegistry: AgentAssemblyRegistry;
  readonly annotationService: ReturnType<typeof createConversationAnnotationService>;
  readonly suggestedQuestions: SuggestedQuestionPort;
  readonly categoryQuestions: CategoryQuestionPort;
  readonly frequentQuestions?: FrequentQuestionPort;
  readonly shareService: ReturnType<typeof createConversationShareService>;
  readonly longTermMemoryManagement?: LongTermMemoryManagementPort;
  readonly cronTaskManagement?: CronTaskManagementPort;
  readonly sandboxGateway?: AppSandboxGatewayPort;
  readonly backgroundTasks?: BackgroundTaskStoreGatewayPort;
  readonly operationalLogActiveIdentity?: () => { readonly file: string } | undefined;
  readonly developerDiagnosticArtifactStatus?: () => DeveloperDiagnosticArtifactStatus;
  readonly resolvePromptTemplate: (query: {
    readonly agentId: string;
    readonly agentVersion: string;
    readonly promptTemplateRef: string;
  }) => Promise<JsonObject | undefined>;
  readonly resolveAgentInventory: () => Promise<readonly JsonObject[]>;
  readonly chatUploadFileConfig?: import('@nextagent/agent-attachment-runtime').ChatUploadFileConfig;
  readonly chatUploadConfigProvider?: import('@nextagent/agent-channel-web').ChatUploadConfigProviderPort;
  readonly portalAbilityConfigProvider?: import('@nextagent/agent-channel-web').PortalAbilityConfigProviderPort;
  readonly stagedUploadRuntime?: AttachmentStagedUploadRuntime;
  readonly fileDownloadRuntime?: import('@nextagent/agent-channel-web').FileDownloadPort;
  readonly attachmentSummaryResolver?: AttachmentSummaryResolver;
  readonly gatewayBindings?: GatewayBindings;
  readonly getWatermarkEnabled?: () => boolean;
  readonly executionCorrelation: ExecutionCorrelationPort;
  /**
   * Deployment `defaultLanguage` (BCP-47, e.g. "zh-CN" / "en-US") used to
   * localize the output guard's fail-closed refusal message when the guard
   * service itself is unavailable. Falls back to zh-CN when absent.
   */
  readonly guardLocale?: string;
}

export interface TrustedLocalWebExtensionRegistrationContext extends WebChannelRegistrationContext {
  readonly identityResolver: WebIdentityResolver;
}

export interface WebChannelRegistration {
  ready?: () => Promise<void>;
}

export type WebChannelRegistrationFactory = (context: WebChannelRegistrationContext) => WebChannelRegistration | void;

export type TrustedLocalWebExtensionRegistration = (context: TrustedLocalWebExtensionRegistrationContext) => void | Promise<void>;

export interface TaskChannelRegistrationContext {
  readonly server: FastifyInstance;
  readonly runtimeCommands: WebRuntimeCommandPort;
  readonly runtime: ReturnType<typeof createRequestLifecycleCoordinator>;
  readonly attachmentRuntime: AttachmentIntakeRuntime;
  readonly systemConfig: DefaultSystemConfig;
  readonly identityResolver: WebIdentityResolver;
  readonly traceEnabled: boolean;
  readonly executionCorrelation: ExecutionCorrelationPort;
}

export interface TaskChannelRegistration {
  ready?: () => Promise<void>;
}

export type TaskChannelRegistrationFactory = (context: TaskChannelRegistrationContext) => TaskChannelRegistration | void;

export interface NextAgentApp {
  readonly server: FastifyInstance;
  readonly runtime: ReturnType<typeof createRequestLifecycleCoordinator>;
  readonly sessions: ReturnType<typeof createUserSessionService>;
  readonly gateway: AppGatewayStores;
  readonly assemblyRegistry: AgentAssemblyRegistry;
  readonly auditWriter?: AuditEventWriter;
  readonly metricsRegistry: MetricsRegistry;
  metricsReadiness: () => import('@nextagent/agent-observability').MetricsReadiness;
  readonly health: HealthEvaluator;
  readonly capabilityProviders: ResolvedCapabilityProviders;
  readonly systemConfig: DefaultSystemConfig;
  start: () => Promise<void>;
  close: () => Promise<void>;
}
