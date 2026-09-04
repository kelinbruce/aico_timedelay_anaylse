import type { AgentId, SecretReference } from '@nextagent/agent-common';
import type { ModelProfile, ModelProviderId, ModelProviderProfile } from '@nextagent/agent-contracts/model';
import type { CapabilityResultPresentationLevel, CapabilityResultPresentationPolicy } from '@nextagent/agent-channel-common';
import type { CapabilityProvidersConfig } from './capability-providers.js';
import type { AppConfigEvaluation, ConfigReadinessState, DeploymentMode } from './config-artifacts.js';
import type { AppRuntimePaths } from './paths.js';

export interface ModelProfileValidationEvidence {
  readonly modelId: string;
  readonly code: string;
  readonly message: string;
}

export interface LocalIdentityConfig {
  readonly tenantId: string;
  readonly subjectId: string;
  readonly displayName?: string;
}

export interface DeploymentConfig {
  readonly mode: 'LOCAL' | 'REMOTE';
  readonly deploymentEntrypointRefs?: Partial<Record<DeploymentMode, DeploymentEntrypointRef>>;
}

export interface DeploymentEntrypointRef {
  readonly module: string;
  readonly exportName: string;
}

export interface LocalAuthConfig {
  readonly enabled: boolean;
  readonly credentialRef?: SecretReference;
  readonly cookieTtlMs?: number;
}

export interface LocalChannelOptions {
  readonly transport: 'fastify';
  readonly host?: string;
  readonly port?: number;
  readonly udsPath?: string;
  // Public path prefix P prepended in front of the fixed API segment `/api/v1`
  // for all NextAgent Web APIs (main channel, memory, auth-local, IR, health).
  // Defaults to `/` (no prefix → /api/v1/...). Set to /svcA to mount APIs at
  // /svcA/api/v1/... . Pages/assets/SPA routes are not affected (stay at root).
  // Backend and frontend must resolve to the same P or requests miss (404).
  readonly routePrefix?: string;
}

export interface TaskCallbackConfig {
  readonly allowedOrigins: readonly string[];
  readonly socketPath?: string;
  readonly timeoutMs: number;
  readonly maxRetries: number;
  readonly tlsInsecure?: boolean;
}

export interface HostedAgentConfig {
  readonly activeAgentId: AgentId;
}

export interface LocalGatewayConfig {
  readonly gatewayId: string;
  readonly gatewayKind: GatewayAdapterKind;
  readonly deploymentMode: DeploymentMode;
  readonly sqliteFileRef?: 'paths.sqliteFile';
  readonly endpoint?: string;
}

// Adapter kinds registered for the current product release. Each maps to a
// gateway provider assembled by app composition.
export type GatewayAdapterKind =
  | 'working-memory'
  | 'long-term-memory'
  | 'sqlite'
  | 'sandbox'
  | 'scheduled-maintenance'
  | 'cron-tasks'
  | 'rag-knowledge'
  | 'skillhub'
  | 'workflow-execution'
  | 'api-call'
  | 'user-query'
  | 'guardrail'
  | 'watermark';

export interface GatewayConfig {
  readonly gateways: readonly LocalGatewayConfig[];
}

export type GatewaySelectionState = 'enabled';

export interface GatewaySelectionEntry {
  readonly gatewayId: string;
  readonly adapterKind: GatewayAdapterKind;
  readonly deploymentMode: DeploymentMode;
  readonly selectionState: GatewaySelectionState;
  readonly endpoint?: string;
}

// Frozen per-process gateway adapter selection snapshot. Downstream modules
// consume this instead of re-reading source configuration.
export interface GatewaySelectionSnapshot {
  readonly entries: readonly GatewaySelectionEntry[];
  readonly validatedAt: string;
  readonly readinessState: ConfigReadinessState;
  readonly diagnosticRef: string;
}

export interface NoopBoundaryOptions {
  readonly lifecycleHook: 'noop';
  readonly checkpoint: 'noop';
  readonly audit: 'noop';
}

export interface WorkflowTraceConfig {
  readonly enabled: boolean;
}

export interface SandboxConfig {
  readonly allowedApis: readonly string[];
  readonly allowedExecutables?: readonly string[];
  readonly clipcExecutableDirectoryEnv: string;
  readonly clipPathRef: string;
  readonly deniedExecutables: readonly string[];
  readonly enabled: boolean;
}

export interface RagConfig {
  readonly indexes: readonly string[];
}

export type MemoryConfigStatus = 'VALID' | 'INVALID' | 'DISABLED';
export type MemoryConfigDiagnosticSource = 'default' | 'explicit';

export interface MemorySearchConfig {
  readonly defaultLimit: number;
  readonly minConfidence: number;
}

export type MemoryExtractionStrategy = 'RULE_FIRST' | 'LLM_ONLY';

export interface MemoryExtractionConfig {
  readonly enabled: boolean;
  readonly strategy: MemoryExtractionStrategy;
  readonly crossSessionSchedule?: string;
  readonly maxCycleTrajectories: number;
  readonly maxCandidates: number;
  readonly timeoutMs: number;
  readonly lookbackDays: number;
}

export interface MemoryAgingConfig {
  readonly enabled: boolean;
  readonly schedule?: string;
  readonly decayStaleDays: number;
  readonly archiveRetentionDays: number;
  readonly decayFactor: number;
  readonly batchLimit: number;
  readonly timeoutMs: number;
  readonly reviveConfidenceBoost: number;
}

export interface MemoryConfigDiagnostic {
  readonly issueCode: string;
  readonly status: MemoryConfigStatus;
  readonly fieldRef: string;
  readonly safeMessage: string;
  readonly source: MemoryConfigDiagnosticSource;
}

export interface HighFrequencyQuestionConfig {
  readonly frequencyThreshold: number;
}
export interface MemoryConfig {
  readonly enabled: boolean;
  readonly status: MemoryConfigStatus;
  readonly search: MemorySearchConfig;
  readonly extraction: MemoryExtractionConfig;
  readonly aging: MemoryAgingConfig;
  readonly diagnostics: readonly MemoryConfigDiagnostic[];
}

export interface ObservabilityLoggingConfig {
  readonly diagnosticDetail: 'normal' | 'debug';
  readonly level: 'error' | 'warn' | 'info' | 'debug';
  readonly console: { readonly enabled: boolean };
  readonly file: {
    readonly enabled: boolean;
    readonly directory: string;
    readonly name: string;
    readonly rotation: { readonly maxFileSizeMiB: number };
    readonly retentionDays: number;
    readonly maxArchiveFiles: number;
  };
}

export interface ObservabilityConfig {
  readonly logging: ObservabilityLoggingConfig;
  readonly tracing?: ObservabilityTracingConfig;
}

export interface ObservabilityTracingConfig {
  readonly enabled: boolean;
  readonly endpoint?: SecretReference;
  readonly authPkRef?: SecretReference;
  readonly authSkRef?: SecretReference;
  readonly serviceName?: string;
}

export type ToolDisclosureMode = 'list' | 'tool-search';
export type SkillDisclosureMode = 'list' | 'tool-search';
export type ClipcDisclosureMode = 'list' | 'tool-search';
export type PlanningToolCallingMode = 'todo-write' | 'task-tools';

export interface CapabilityDisclosureConfig {
  readonly toolDisclosureMode: ToolDisclosureMode;
  readonly skillDisclosureMode: SkillDisclosureMode;
  readonly clipcDisclosureMode: ClipcDisclosureMode;
}

export interface PluginSystemConfigEntry {
  readonly pluginId: string;
  readonly path: string;
  readonly required: boolean;
}

export interface PluginSystemConfig {
  readonly plugins: readonly PluginSystemConfigEntry[];
}

export interface DefaultSystemConfig {
  readonly deployment: DeploymentConfig;
  readonly activeAgentId: AgentId;
  readonly paths: AppRuntimePaths;
  readonly observability: ObservabilityConfig;
  readonly capabilityDisclosure: CapabilityDisclosureConfig;
  readonly capabilityResultPresentationPolicy: CapabilityResultPresentationPolicy;
  readonly planningToolCallingMode: PlanningToolCallingMode;
  readonly auth: {
    readonly mode: 'local';
    readonly localIdentity: LocalIdentityConfig;
    readonly localAuth?: LocalAuthConfig;
  };
  readonly channel: LocalChannelOptions;
  readonly taskCallback: TaskCallbackConfig;
  readonly hostedAgent: HostedAgentConfig;
  readonly modelProfiles: readonly ModelProviderProfile[];
  readonly userCapabilityProviders: CapabilityProvidersConfig;
  readonly pluginSystem: PluginSystemConfig;
  readonly gateway: LocalGatewayConfig;
  readonly gatewaySelection: GatewaySelectionSnapshot;
  readonly rag: RagConfig;
  readonly sandbox: SandboxConfig;
  readonly memory: MemoryConfig;
  readonly highFrequencyQuestion: HighFrequencyQuestionConfig;
  readonly modelProfileValidationEvidence: readonly ModelProfileValidationEvidence[];
  readonly noopBoundaries: NoopBoundaryOptions;
  readonly workflowTrace?: WorkflowTraceConfig;
  readonly configEvaluation: AppConfigEvaluation;
}

export interface RawDefaultSystemConfig {
  readonly deployment: DeploymentConfig;
  readonly paths: {
    readonly workspaceRoot: string;
    readonly logDirectory?: string;
    readonly skillRoot?: string;
    readonly agentRoot?: string;
  };
  readonly observability?: {
    readonly logging?: {
      readonly diagnosticDetail?: 'normal' | 'debug';
      readonly level?: 'error' | 'warn' | 'info' | 'debug';
      readonly console?: { readonly enabled?: boolean };
      readonly file?: {
        readonly enabled?: boolean;
        readonly directory?: string;
        readonly name?: string;
        readonly rotation?: { readonly maxFileSizeMiB?: number };
        readonly retentionDays?: number;
        readonly maxArchiveFiles?: number;
      };
    };
    readonly tracing?: {
      readonly enabled?: boolean;
      readonly endpoint?: SecretReference | string;
      readonly authPkRef?: SecretReference | string;
      readonly authSkRef?: SecretReference | string;
      readonly serviceName?: string;
    };
  };
  readonly auth: {
    readonly mode: 'local';
    readonly localIdentity: LocalIdentityConfig;
    readonly localAuth?: Omit<LocalAuthConfig, 'credentialRef'> & { readonly credentialRef?: SecretReference | string };
  };
  readonly channel: LocalChannelOptions;
  readonly taskCallback?: {
    readonly allowedOrigins?: readonly string[];
    readonly socketPath?: string;
    readonly timeoutMs?: number;
    readonly maxRetries?: number;
    readonly tlsInsecure?: boolean;
  };
  readonly hostedAgent: {
    readonly activeAgentId: string;
  };
  readonly modelProfiles: readonly RawModelProviderProfileConfig[];
  readonly rag?: RagConfig;
  readonly sandbox?: {
    readonly allowedApis?: readonly string[];
    readonly allowedExecutables?: readonly string[];
    readonly clipcExecutableDirectoryEnv?: string;
    readonly clipPathRef?: string;
    readonly deniedExecutables?: readonly string[];
    readonly enabled?: boolean;
  };
  readonly noopBoundaries: NoopBoundaryOptions;
  readonly workflowTrace?: { readonly enabled: boolean };
  readonly nextAgent?: {
    readonly system?: {
      readonly 'capability-providers'?: readonly RawCapabilityProviderUserConfig[];
      readonly plugins?: readonly RawPluginSystemConfigEntry[];
      readonly 'capability-disclosure'?: {
        readonly 'tool-disclosure-mode'?: ToolDisclosureMode;
        readonly 'skill-disclosure-mode'?: SkillDisclosureMode;
        readonly 'clipc-disclosure-mode'?: ClipcDisclosureMode;
      };
      readonly 'capability-result-presentation'?: {
        readonly 'default-level'?: CapabilityResultPresentationLevel;
        readonly rules?: ReadonlyArray<{
          readonly 'capability-id': string;
          readonly level: CapabilityResultPresentationLevel;
        }>;
      };
      readonly 'planning-tool-calling-mode'?: PlanningToolCallingMode;
    };
    readonly memory?: RawMemoryConfig;
    readonly highFrequencyQuestion?: RawHighFrequencyQuestionConfig;
  };
  readonly gateway?: GatewayConfig;
}

export interface RawHighFrequencyQuestionConfig {
  readonly frequencyThreshold?: number;
}
export interface RawMemoryConfig {
  readonly enabled?: boolean;
  readonly search?: {
    readonly 'default-limit'?: number;
    readonly 'min-confidence'?: number;
  };
  readonly extraction?: {
    readonly enabled?: boolean;
    readonly strategy?: MemoryExtractionStrategy;
    readonly crossSessionSchedule?: string;
    readonly maxCycleTrajectories?: number;
    readonly maxCandidates?: number;
    readonly timeoutMs?: number;
    readonly lookbackDays?: number;
  };
  readonly aging?: {
    readonly enabled?: boolean;
    readonly schedule?: string;
    readonly decayStaleDays?: number;
    readonly archiveRetentionDays?: number;
    readonly decayFactor?: number;
    readonly batchLimit?: number;
    readonly timeoutMs?: number;
    readonly reviveConfidenceBoost?: number;
  };
}

export interface RawCapabilityProviderUserConfig {
  readonly id?: string;
  readonly type?: string;
  readonly path?: string;
  readonly gatewayId?: string;
  readonly url?: string;
  readonly credential?: string;
  readonly installDir?: string;
  readonly adapter?: string;
  readonly config?: unknown;
}

export interface RawPluginSystemConfigEntry {
  readonly pluginId?: string;
  readonly path?: string;
  readonly required?: boolean;
}

export interface RawModelProviderProfileConfig {
  readonly providerId: ModelProviderId | string;
  readonly baseUrl?: string;
  readonly credentialRef?: SecretReference | string;
  readonly models: readonly RawModelProfileConfig[];
}

export type RawModelProfileConfig = ModelProfile;

export interface LocalGatewayOptions {
  readonly sqliteFile: string;
}
