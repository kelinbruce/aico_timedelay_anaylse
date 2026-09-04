import { Type, type Static } from '@sinclair/typebox';
import type {
  AgentId,
  AgentVersion,
  ArtifactId,
  CapabilityId,
  CapabilityKind,
  CapabilityProviderKind,
  CapabilityReplayPolicy,
  IdempotencyKey,
  IdentityContext,
  JsonObject,
  MessageId,
  RequestContextId,
  RequestLocale,
  RequestRunId,
  RiskLevel,
  RiskPolicyOutcome,
  SafeError,
  SecretReference,
  SessionId,
  SubjectId,
  TenantId,
} from '@nextagent/agent-common';
import type { AgentAssembly } from '../agent-assembly/index.js';
import { ModelIdSchema, ModelInferenceOptionsSchema, type ModelInferenceOptions } from '../model/index.js';

export interface AttachmentRef {
  readonly attachmentId: import('@nextagent/agent-common').AttachmentId;
  readonly fileName: string;
  readonly mediaType: string;
  readonly sizeBytes: number;
  readonly storageRef: string;
}

export type AvailabilityStatus = 'AVAILABLE' | 'DISABLED' | 'UNAVAILABLE';
export type OsFamily = 'LINUX' | 'WINDOWS' | 'MACOS';
export type CpuArchitecture = 'X64' | 'ARM64';
export type CapabilityDisclosureMode = 'EAGER' | 'DEFERRED' | 'HIDDEN';
export type SkillManifestValidationOutcome = 'accepted' | 'rejected' | 'degraded';
export type SkillManifestDiagnosticSeverity = 'INFO' | 'WARNING' | 'ERROR';
export type SkillManifestDiagnosticReasonCode =
  | 'SKILL_MD_MISSING'
  | 'SKILL_MD_UNSUPPORTED_ENCODING'
  | 'INVALID_NAME'
  | 'NAME_MISMATCH'
  | 'INVALID_DESCRIPTION'
  | 'INVALID_OFFICIAL_FIELD'
  | 'INVALID_CONTEXT'
  | 'INVALID_AGENT'
  | 'AGENT_REQUIRES_FORK_CONTEXT'
  | 'INVALID_INVOCABILITY'
  | 'INVALID_TOOL_CONSTRAINTS'
  | 'UNSAFE_MODEL_DECLARATION'
  | 'CONFLICTING_MODEL_DECLARATION'
  | 'SOURCE_METADATA_OMITTED'
  | 'DESCRIPTOR_MAPPING_FAILED'
  | 'EXTENSION_OMITTED';

type SkillExtensionValue = string | number | boolean | null | readonly string[] | { readonly [key: string]: SkillExtensionValue };

const SkillExtensionValueSchema = Type.Recursive(
  (self) =>
    Type.Union([
      Type.String({ maxLength: 512 }),
      Type.Number(),
      Type.Boolean(),
      Type.Null(),
      Type.Array(Type.String({ maxLength: 512 }), { maxItems: 64 }),
      Type.Unsafe<{ readonly [key: string]: SkillExtensionValue }>({
        type: 'object',
        propertyNames: { type: 'string', minLength: 1, maxLength: 128 },
        additionalProperties: self,
      }),
    ]),
  { $id: 'nextagent.skill-extension-value' },
);

export const SkillMetadataSchema = Type.Object(
  {
    metadataKind: Type.Literal('nextagent.skill'),
    context: Type.Union([Type.Literal('inline'), Type.Literal('fork')]),
    userInvocable: Type.Boolean(),
    modelInvocable: Type.Boolean(),
    agent: Type.Optional(Type.String({ minLength: 1, maxLength: 128 })),
    allowedTools: Type.Optional(Type.Array(Type.String({ minLength: 1, maxLength: 128 }))),
    deniedTools: Type.Optional(Type.Array(Type.String({ minLength: 1, maxLength: 128 }))),
    model: Type.Optional(ModelIdSchema),
    modelOptions: Type.Optional(ModelInferenceOptionsSchema),
    sourceMetadata: Type.Optional(
      Type.Unsafe<Record<string, string | string[]>>({
        type: 'object',
        propertyNames: { type: 'string', minLength: 1, maxLength: 128 },
        additionalProperties: { type: 'string', maxLength: 512 },
        properties: {
          exclusiveWith: {
            oneOf: [
              { type: 'string', maxLength: 512 },
              { type: 'array', minItems: 1, items: { type: 'string', minLength: 1, maxLength: 512 } },
            ],
          },
          compatibleWith: {
            oneOf: [
              { type: 'string', maxLength: 512 },
              { type: 'array', minItems: 1, items: { type: 'string', minLength: 1, maxLength: 512 } },
            ],
          },
          tags: {
            oneOf: [
              { type: 'string', maxLength: 512 },
              { type: 'array', minItems: 1, items: { type: 'string', minLength: 1, maxLength: 512 } },
            ],
          },
        },
      }),
    ),
    extension: Type.Optional(
      Type.Unsafe<Readonly<Record<string, SkillExtensionValue>>>({
        type: 'object',
        propertyNames: { type: 'string', minLength: 1, maxLength: 128 },
        additionalProperties: SkillExtensionValueSchema,
      }),
    ),
  },
  { additionalProperties: false },
);

export type SkillMetadata = Static<typeof SkillMetadataSchema> & JsonObject;

export const SkillManifestDiagnosticSchema = Type.Object(
  {
    reasonCode: Type.Union([
      Type.Literal('SKILL_MD_MISSING'),
      Type.Literal('SKILL_MD_UNSUPPORTED_ENCODING'),
      Type.Literal('INVALID_NAME'),
      Type.Literal('NAME_MISMATCH'),
      Type.Literal('INVALID_DESCRIPTION'),
      Type.Literal('INVALID_OFFICIAL_FIELD'),
      Type.Literal('INVALID_CONTEXT'),
      Type.Literal('INVALID_AGENT'),
      Type.Literal('AGENT_REQUIRES_FORK_CONTEXT'),
      Type.Literal('INVALID_INVOCABILITY'),
      Type.Literal('INVALID_TOOL_CONSTRAINTS'),
      Type.Literal('UNSAFE_MODEL_DECLARATION'),
      Type.Literal('CONFLICTING_MODEL_DECLARATION'),
      Type.Literal('SOURCE_METADATA_OMITTED'),
      Type.Literal('DESCRIPTOR_MAPPING_FAILED'),
      Type.Literal('EXTENSION_OMITTED'),
    ]),
    severity: Type.Union([Type.Literal('INFO'), Type.Literal('WARNING'), Type.Literal('ERROR')]),
    outcome: Type.Union([Type.Literal('accepted'), Type.Literal('rejected'), Type.Literal('degraded')]),
    message: Type.String({ minLength: 1, maxLength: 240 }),
    providerId: Type.Optional(Type.String({ minLength: 1, maxLength: 128 })),
    skillName: Type.Optional(Type.String({ minLength: 1, maxLength: 64 })),
  },
  { additionalProperties: false },
);

export type SkillManifestDiagnostic = Static<typeof SkillManifestDiagnosticSchema>;

export interface CapabilityProviderIdentity {
  readonly providerId: string;
  readonly providerKind: CapabilityProviderKind;
  readonly providerType?: string;
}

export type CapabilityDiscoveryMode = 'EAGER' | 'SEARCH';

export const CapabilityLocaleTagPattern = '^[a-zA-Z]{2,8}(?:-[a-zA-Z0-9]{1,8})*$';
export interface LocalizedCapabilityContent {
  readonly displayName: string;
}
export interface CapabilityLocales {
  readonly language: Readonly<Record<string, LocalizedCapabilityContent>>;
}
export const LocalizedCapabilityContentSchema = Type.Unsafe<LocalizedCapabilityContent>({
  type: 'object',
  additionalProperties: false,
  required: ['displayName'],
  properties: {
    displayName: {
      type: 'string',
      minLength: 1,
      maxLength: 256,
      pattern: '^(?=.*\\S)(?!.*[\\x00-\\x1F\\x7F-\\x9F]).*$',
    },
  },
});
export const CapabilityLocalesSchema = Type.Unsafe<CapabilityLocales>({
  type: 'object',
  additionalProperties: false,
  required: ['language'],
  properties: {
    language: {
      type: 'object',
      minProperties: 1,
      propertyNames: { type: 'string', minLength: 2, maxLength: 35, pattern: CapabilityLocaleTagPattern },
      additionalProperties: LocalizedCapabilityContentSchema,
    },
  },
});

export interface CapabilityProviderConfig {
  readonly provider: CapabilityProviderIdentity;
  readonly discoveryMode: CapabilityDiscoveryMode;
  readonly options: CapabilityProviderOptions;
}

export interface CapabilitySearchCriteria {
  readonly tenantId: TenantId;
  readonly subjectId: SubjectId;
  readonly agentId: AgentId;
  readonly agentVersion: AgentVersion;
  readonly agentAssemblyRef: string;
  readonly sessionId?: SessionId;
  readonly requestedCapabilityId?: CapabilityId;
  readonly modelInvocable?: boolean;
}

export interface CapabilityCurrentDiscoveryCriteria {
  readonly tenantId: TenantId;
  readonly subjectId: SubjectId;
  readonly sessionId: SessionId;
  readonly agentId: AgentId;
  readonly agentVersion: AgentVersion;
  readonly agentAssemblyRef: string;
}

export interface SkillScanEvidenceItem {
  readonly skillId?: string;
  readonly outcomeCode: string;
  readonly message: string;
}

export interface CapabilityDiscovery {
  readonly provider: CapabilityProviderIdentity;
  readonly discoveryMode: CapabilityDiscoveryMode;
  listAll?: (signal: AbortSignal) => Promise<readonly CapabilityDescriptor[]>;
  resolve?: (capabilityId: CapabilityId, signal: AbortSignal) => Promise<CapabilityDescriptor | undefined>;
  search?: (criteria: CapabilitySearchCriteria, signal: AbortSignal) => Promise<readonly CapabilityDescriptor[]>;
  listCurrent?: (criteria: CapabilityCurrentDiscoveryCriteria, signal: AbortSignal) => Promise<readonly CapabilityDescriptor[]>;
  getSkillScanEvidence?: () => readonly SkillScanEvidenceItem[];
  getSkillScanRoot?: () => string | undefined;
}

export interface ExecutableTool {
  readonly metadata: unknown;
  readonly tool: unknown;
  readonly deps?: unknown;
}

export interface ToolExecutableDiscovery extends CapabilityDiscovery {
  readonly discoveryMode: 'EAGER';
  resolveExecutable: (capabilityId: CapabilityId) => ExecutableTool | undefined;
}

export interface ToolConfig {
  readonly safeDescriptionOverride?: string;
  readonly config?: JsonObject;
}

export interface ToolCatalogConfig {
  readonly tools?: Readonly<Record<string, ToolConfig>>;
}

export type ToolDependencyName =
  'approval' | 'sandbox' | 'workspaceFiles' | 'skillSources' | 'ragRetrieval' | 'subagentExecution' | 'workflowExecution';

export interface ToolDependencies {
  readonly approval?: never;
  readonly sandbox?: unknown;
  readonly workspaceFiles?: unknown;
  readonly skillSources?: unknown;
  readonly ragRetrieval?: unknown;
  readonly ragDefaultIndexes?: readonly string[];
  readonly subagentExecution?: SubagentExecutionPort;
  readonly workflowExecution?: unknown;
}

export interface ToolExecutionContext {
  readonly identityContext: IdentityContext;
  readonly agentId: AgentId;
  readonly agentVersion: AgentVersion;
  readonly sessionId: SessionId;
  readonly requestId: MessageId;
  readonly runId: RequestRunId;
  readonly requestContextId: RequestContextId;
  readonly stepId: string;
  readonly toolCallId: string;
  readonly locale?: RequestLocale;
  readonly timeoutMs: number;
  readonly capabilityResolver?: RuntimeCapabilityResolver;
  readonly emitPolicyApplied?: (payload: {
    readonly operationKind: 'CAPABILITY_INVOCATION' | 'SANDBOX_EXECUTION' | 'AUTHORIZATION_REQUEST' | 'RECOVERY_REPLAY';
    readonly operationId: string;
    readonly outcome: RiskPolicyOutcome;
    readonly reasonCode: string;
    readonly riskLevel: RiskLevel;
    readonly capabilityId?: string;
    readonly toolCallId?: string;
  }) => Promise<void>;
  readonly emitResultDelta?: (payload: JsonObject) => Promise<void>;
  readonly toolSearchSkillSearchEnabled?: boolean;
  readonly discoveredSkills?: readonly CapabilityId[];
  readonly attachmentPaths?: readonly string[];
}

export interface ToolExecuteOptions {
  readonly context?: ToolExecutionContext;
  readonly deps?: ToolDependencies;
  readonly signal?: AbortSignal;
}

export type ToolDiagnosticKey = 'toolResultStatus' | 'toolResultCountBucket' | 'reasonCode';

export interface ToolDiagnosticCandidate {
  readonly key: ToolDiagnosticKey;
  readonly value: string;
}

export interface ToolObservabilityDefinition {
  safeCompletionDiagnostics: (input: {
    readonly status: CapabilityInvocationResult['status'];
    readonly structuredPayload: JsonObject;
    readonly metadata?: JsonObject;
  }) => readonly ToolDiagnosticCandidate[];
}

export interface ToolMetadata<TConfig extends JsonObject = JsonObject> {
  readonly name: CapabilityId;
  readonly displayName?: string;
  readonly locales?: CapabilityLocales;
  readonly description: string;
  readonly inputSchema: JsonObject;
  readonly outputSchema: JsonObject;
  readonly configSchema?: JsonObject;
  readonly requiredDependencies?: readonly ToolDependencyName[];
  readonly replayPolicy?: CapabilityReplayPolicy;
  readonly disclosurePolicy?: CapabilityDisclosurePolicy;
  readonly returnsCapabilityResult?: boolean;
  readonly observability?: ToolObservabilityDefinition;
}

export interface Tool<TInput extends JsonObject = JsonObject, TOutput extends JsonObject = JsonObject, TConfig extends JsonObject = JsonObject> {
  configure?: (config: TConfig, deps?: ToolDependencies) => Tool<TInput, TOutput, TConfig>;
  execute: (input: TInput, options?: ToolExecuteOptions) => Promise<TOutput | CapabilityInvocationResult>;
}

export interface DefineToolInput<
  TInput extends JsonObject = JsonObject,
  TOutput extends JsonObject = JsonObject,
  TConfig extends JsonObject = JsonObject,
> {
  readonly name: CapabilityId;
  readonly displayName?: string;
  readonly locales?: CapabilityLocales;
  readonly description: string;
  readonly inputSchema: JsonObject;
  readonly outputSchema: JsonObject;
  readonly configSchema?: JsonObject;
  readonly requiredDependencies?: readonly ToolDependencyName[];
  readonly replayPolicy?: CapabilityReplayPolicy;
  readonly disclosurePolicy?: CapabilityDisclosurePolicy;
  readonly returnsCapabilityResult?: boolean;
  readonly observability?: ToolObservabilityDefinition;
  configure?: (config: TConfig, deps?: ToolDependencies) => Tool<TInput, TOutput, TConfig>;
  execute: (input: TInput, options?: ToolExecuteOptions) => Promise<TOutput | CapabilityInvocationResult>;
}

export interface ToolDefinition<
  TInput extends JsonObject = JsonObject,
  TOutput extends JsonObject = JsonObject,
  TConfig extends JsonObject = JsonObject,
> {
  readonly metadata: ToolMetadata<TConfig>;
  readonly tool: Tool<TInput, TOutput, TConfig>;
}

export interface DefineToolProviderInput {
  readonly providerId: string;
  readonly providerType?: string;
  readonly description?: string;
  readonly tools: readonly ToolDefinition[];
}

export interface CapabilityExecutor {
  readonly capabilityKinds: readonly CapabilityKind[];
  invoke: (
    descriptor: CapabilityDescriptor,
    request: CapabilityInvocationRequest,
    signal: AbortSignal,
    runtimeContext?: CapabilityInvocationRuntimeContext,
  ) => Promise<CapabilityInvocationResult>;
}
export interface WorkflowSandboxExecutionInput {
  readonly code: string;
  readonly args: readonly string[];
  readonly environment?: JsonObject;
  readonly timeoutMs: number;
  readonly stdoutLimitBytes: number;
  readonly stderrLimitBytes: number;
}

export interface WorkflowSandboxExecutionPort {
  runPython: (input: WorkflowSandboxExecutionInput, context: ToolExecutionContext, signal?: AbortSignal) => Promise<JsonObject>;
}

export interface CapabilityProvider {
  readonly identity: CapabilityProviderIdentity;
  readonly discovery: CapabilityDiscovery;
  readonly executor?: CapabilityExecutor;
}

export type CapabilityProviderOptions =
  LocalDirectoryProviderOptions | SkillHubOptions | McpServerOptions | AgentRegistryOptions | CustomProviderOptions;

export interface LocalDirectoryProviderOptions {
  readonly directoryRef: string;
}

export interface SkillHubOptions {
  readonly gatewayId: string;
  readonly managedInstallRef: string;
}

export interface McpServerOptions {
  readonly endpoint: string;
  readonly credentialRef?: SecretReference;
  readonly timeoutMs?: number;
}

export interface AgentRegistryOptions {
  readonly registryRef: string;
  readonly credentialRef?: SecretReference;
}

export interface CustomProviderOptions {
  readonly customOptions: JsonObject;
}

export const capabilityProviderConfigSchema: JsonObject = {
  type: 'object',
  additionalProperties: false,
  required: ['provider', 'discoveryMode', 'options'],
  properties: {
    provider: {
      type: 'object',
      additionalProperties: false,
      required: ['providerId', 'providerKind'],
      properties: {
        providerId: { type: 'string', minLength: 1 },
        providerKind: { enum: ['LOCAL_DIRECTORY', 'SKILL_HUB', 'MCP_SERVER', 'AGENT_REGISTRY', 'CUSTOM'] },
        providerType: { type: 'string', minLength: 1 },
      },
    },
    discoveryMode: { enum: ['EAGER', 'SEARCH'] },
    options: { type: 'object' },
  },
  allOf: [
    {
      if: { properties: { provider: { properties: { providerKind: { const: 'LOCAL_DIRECTORY' } } } } },
      then: {
        properties: {
          options: {
            type: 'object',
            additionalProperties: false,
            required: ['directoryRef'],
            properties: { directoryRef: { type: 'string', minLength: 1 } },
          },
        },
      },
    },
    {
      if: { properties: { provider: { properties: { providerKind: { const: 'SKILL_HUB' } } } } },
      then: {
        properties: {
          options: {
            type: 'object',
            additionalProperties: false,
            required: ['gatewayId', 'managedInstallRef'],
            properties: {
              gatewayId: { type: 'string', minLength: 1 },
              managedInstallRef: { type: 'string', minLength: 1 },
            },
          },
        },
      },
    },
    {
      if: { properties: { provider: { properties: { providerKind: { const: 'MCP_SERVER' } } } } },
      then: {
        properties: {
          options: {
            type: 'object',
            additionalProperties: false,
            required: ['endpoint'],
            properties: {
              endpoint: { type: 'string', minLength: 1 },
              credentialRef: { type: 'string', pattern: '^(env|file):' },
              timeoutMs: { type: 'integer', minimum: 1 },
            },
          },
        },
      },
    },
    {
      if: { properties: { provider: { properties: { providerKind: { const: 'AGENT_REGISTRY' } } } } },
      then: {
        properties: {
          options: {
            type: 'object',
            additionalProperties: false,
            required: ['registryRef'],
            properties: {
              registryRef: { type: 'string', minLength: 1 },
              credentialRef: { type: 'string', pattern: '^(env|file):' },
            },
          },
        },
      },
    },
    {
      if: { properties: { provider: { properties: { providerKind: { const: 'CUSTOM' } } } } },
      then: {
        properties: {
          provider: { required: ['providerType'] },
          options: {
            type: 'object',
            additionalProperties: false,
            required: ['customOptions'],
            properties: { customOptions: { type: 'object' } },
          },
        },
      },
    },
  ],
};

export const capabilityDescriptorSchema: JsonObject = {
  type: 'object',
  additionalProperties: false,
  required: ['capabilityId', 'kind', 'provider', 'displayName', 'description', 'availabilityStatus'],
  properties: {
    capabilityId: { type: 'string', minLength: 1 },
    kind: { enum: ['TOOL', 'SKILL', 'AGENT', 'WORKFLOW'] },
    provider: {
      type: 'object',
      additionalProperties: false,
      required: ['providerId', 'providerKind'],
      properties: {
        providerId: { type: 'string', minLength: 1 },
        providerKind: { enum: ['BUNDLED', 'LOCAL_DIRECTORY', 'SKILL_HUB', 'MCP_SERVER', 'AGENT_REGISTRY', 'CUSTOM'] },
        providerType: { type: 'string', minLength: 1 },
      },
    },
    version: { type: 'string', minLength: 1 },
    displayName: { type: 'string', minLength: 1 },
    locales: CapabilityLocalesSchema,
    description: { type: 'string', minLength: 1 },
    modelInvocable: { type: 'boolean' },
    availabilityStatus: { enum: ['AVAILABLE', 'DISABLED', 'UNAVAILABLE'] },
    availabilityReason: { type: 'string', minLength: 1 },
    disclosurePolicy: {
      type: 'object',
      additionalProperties: false,
      required: ['mode'],
      properties: {
        mode: { enum: ['EAGER', 'DEFERRED', 'HIDDEN'] },
        searchHint: { type: 'string', minLength: 1, maxLength: 256 },
      },
    },
    compatibility: { type: 'object' },
    inputSchema: { type: 'object' },
    outputSchema: { type: 'object' },
    replayPolicy: { enum: ['NON_IDEMPOTENT', 'IDEMPOTENT'] },
    metadata: { type: 'object' },
  },
};

export interface CapabilityDescriptor {
  readonly capabilityId: CapabilityId;
  readonly kind: CapabilityKind;
  readonly provider: CapabilityProviderIdentity;
  readonly version?: string;
  readonly displayName: string;
  readonly locales?: CapabilityLocales;
  readonly description: string;
  readonly modelInvocable?: boolean;
  readonly availabilityStatus: AvailabilityStatus;
  readonly availabilityReason?: string;
  readonly disclosurePolicy?: CapabilityDisclosurePolicy;
  readonly compatibility?: CapabilityCompatibility;
  readonly inputSchema?: JsonObject;
  readonly outputSchema?: JsonObject;
  readonly replayPolicy?: CapabilityReplayPolicy;
  readonly metadata?: JsonObject;
}

export interface CapabilityCompatibility {
  readonly supportedOsFamilies: readonly OsFamily[];
  readonly supportedCpuArchitectures: readonly CpuArchitecture[];
  readonly requiredExecutables: readonly string[];
  readonly requiredEnvironmentKeys: readonly string[];
  readonly requiredConfigurationKeys: readonly string[];
  readonly networkRequired: boolean;
  readonly runtimeTags: readonly string[];
}

export interface CapabilityInvocationRequest {
  readonly invocationId: string;
  readonly capabilityId: CapabilityId;
  readonly resolvedDescriptor?: CapabilityDescriptor;
  readonly toolCallId?: string;
  readonly arguments: JsonObject;
  readonly sessionId: SessionId;
  readonly requestId: MessageId;
  readonly runId: RequestRunId;
  readonly requestContextId: RequestContextId;
  readonly stepId: string;
  readonly identityContext: IdentityContext;
  readonly locale?: RequestLocale;
  readonly agentId: AgentId;
  readonly agentVersion: AgentVersion;
  readonly timeoutMs: number;
  readonly maxRetries?: number;
  readonly idempotencyKey?: IdempotencyKey;
}

export interface RuntimeCapabilityResolveRequest {
  readonly kind: CapabilityKind;
  readonly capabilityId: CapabilityId;
  readonly providerId?: string;
}

export interface CapabilityDisclosurePolicy {
  readonly mode: CapabilityDisclosureMode;
  readonly searchHint?: string;
}

export interface RuntimeCapabilityListRequest {
  readonly kind?: CapabilityKind;
  readonly modelInvocable?: boolean;
}

export interface RuntimeCapabilityResolver {
  resolveCapability: (request: RuntimeCapabilityResolveRequest, signal: AbortSignal) => Promise<CapabilityDescriptor | undefined>;
  listCapabilities?: (request: RuntimeCapabilityListRequest, signal: AbortSignal) => Promise<readonly CapabilityDescriptor[]>;
}

export interface SubagentExecutionRequest {
  readonly targetAgentId: AgentId;
  readonly targetAgentVersion?: AgentVersion;
  readonly targetProviderKind: CapabilityProviderKind;
  readonly prompt: string;
  readonly parentSessionId: SessionId;
  readonly parentRunId: RequestRunId;
  readonly parentRequestId: MessageId;
  readonly parentToolCallId: string;
  readonly identityContext: IdentityContext;
  readonly locale: RequestLocale;
  readonly idempotencyKey: IdempotencyKey;
}

export interface SubagentExecutionResult {
  readonly status: 'COMPLETED' | 'FAILED' | 'TIMED_OUT' | 'CANCELED';
  readonly terminalText: string;
  readonly childSessionId?: SessionId;
  readonly childRunId?: RequestRunId;
  readonly safeError?: SafeError;
}

export interface SubagentExecutionPort {
  executeSubagent: (request: SubagentExecutionRequest, signal: AbortSignal) => Promise<SubagentExecutionResult>;
}

export interface ParameterExtractionRequest {
  readonly prompt: string;
  readonly identityContext: IdentityContext;
  readonly agentId: AgentId;
  readonly agentVersion: AgentVersion;
  readonly sessionId: SessionId;
  readonly requestId: MessageId;
  readonly runId: RequestRunId;
  readonly requestContextId: RequestContextId;
  readonly stepId: string;
  readonly locale?: RequestLocale;
  readonly timeoutMs: number;
}

export interface ParameterExtractionResult {
  readonly status: 'SUCCEEDED' | 'FAILED' | 'TIMED_OUT';
  readonly parameters?: JsonObject;
  readonly safeErrorCode?: string;
  readonly safeErrorMessage?: string;
}

export interface ParameterExtractionPort {
  extractParams: (request: ParameterExtractionRequest, signal: AbortSignal) => Promise<ParameterExtractionResult>;
}

export interface ApiCallRequest {
  readonly baseUrl: string;
  readonly path: string;
  readonly method: string;
  readonly headers: Record<string, string>;
  readonly query?: string;
  readonly body?: string;
  readonly credentialRef?: string;
  readonly timeoutMs: number;
  readonly requestId?: string;
}

export interface ApiCallResult {
  readonly status: number;
  readonly headers: Record<string, string>;
  readonly body: string;
}

export interface ApiCallStreamChunk {
  readonly data: string;
}

export interface ApiCallPort {
  callApi: (request: ApiCallRequest, signal: AbortSignal) => Promise<ApiCallResult>;
  callApiStream: (request: ApiCallRequest, signal: AbortSignal) => AsyncIterable<ApiCallStreamChunk>;
}

export interface CapabilityPolicyAppliedPayload {
  readonly operationKind: 'CAPABILITY_INVOCATION' | 'SANDBOX_EXECUTION' | 'AUTHORIZATION_REQUEST' | 'RECOVERY_REPLAY';
  readonly operationId: string;
  readonly outcome: RiskPolicyOutcome;
  readonly reasonCode: string;
  readonly riskLevel: RiskLevel;
  readonly capabilityId?: string;
  readonly toolCallId?: string;
}

export interface CapabilityResultDeltaPayload {
  readonly structuredPayload: JsonObject;
}

export interface CapabilityInvocationRuntimeContext {
  readonly capabilityResolver?: RuntimeCapabilityResolver;
  readonly emitPolicyApplied?: (payload: CapabilityPolicyAppliedPayload) => Promise<void>;
  readonly emitResultDelta?: (payload: CapabilityResultDeltaPayload) => Promise<void>;
  readonly toolSearchSkillSearchEnabled?: boolean;
  readonly discoveredSkills?: readonly CapabilityId[];
  readonly attachmentPaths?: readonly string[];
  readonly flowVariables?: import('@nextagent/agent-common').JsonObject;
}

export interface CapabilityGeneratedMessage {
  readonly role: 'USER';
  readonly content: string;
  readonly meta?: boolean;
}

export interface CapabilityContextPatch {
  readonly allowedTools?: readonly CapabilityId[];
  readonly deniedTools?: readonly CapabilityId[];
  readonly discoveredSkills?: readonly CapabilityId[];
  readonly modelId?: string;
  readonly modelOptions?: ModelInferenceOptions;
}

export const CapabilityContextPatchSchema = Type.Object(
  {
    allowedTools: Type.Optional(Type.Array(Type.String({ minLength: 1, maxLength: 256 }))),
    deniedTools: Type.Optional(Type.Array(Type.String({ minLength: 1, maxLength: 256 }))),
    discoveredSkills: Type.Optional(Type.Array(Type.String({ minLength: 1, maxLength: 256 }))),
    modelId: Type.Optional(ModelIdSchema),
    modelOptions: Type.Optional(ModelInferenceOptionsSchema),
  },
  { additionalProperties: false },
);

export interface CapabilityInvocationResult {
  readonly status: 'SUCCEEDED' | 'FAILED' | 'DEGRADED' | 'TIMED_OUT';
  readonly structuredPayload: JsonObject;
  readonly generatedMessages: readonly CapabilityGeneratedMessage[];
  readonly contextPatch?: CapabilityContextPatch;
  readonly resultRef?: string;
  readonly artifactRefs: readonly ArtifactId[];
  readonly safeError?: SafeError;
  readonly fallbackTriggered?: boolean;
  readonly metadata?: JsonObject;
}

export interface CapabilityCatalogRequest {
  readonly tenantId: TenantId;
  readonly subjectId: SubjectId;
  readonly sessionId?: SessionId;
  readonly agentAssembly: AgentAssembly;
  readonly includeUnavailable: boolean;
  readonly modelInvocable?: boolean;
}

export interface CapabilityResolveRequest {
  readonly tenantId: TenantId;
  readonly subjectId: SubjectId;
  readonly sessionId?: SessionId;
  readonly agentAssembly: AgentAssembly;
  readonly capabilityId: CapabilityId;
}

export interface CapabilityCatalog {
  listAvailable: (request: CapabilityCatalogRequest) => Promise<readonly CapabilityDescriptor[]>;
  resolve: (request: CapabilityResolveRequest) => Promise<CapabilityDescriptor | undefined>;
}

export interface CapabilityCurrentViewRequest {
  readonly tenantId: TenantId;
  readonly subjectId: SubjectId;
  readonly sessionId: SessionId;
  readonly agentAssembly: AgentAssembly;
}

export interface CapabilityCurrentViewPort {
  listCurrent: (request: CapabilityCurrentViewRequest, signal: AbortSignal) => Promise<readonly CapabilityDescriptor[]>;
}

export interface CapabilityInvocationPort {
  invoke: (
    request: CapabilityInvocationRequest,
    signal: AbortSignal,
    runtimeContext?: CapabilityInvocationRuntimeContext,
  ) => Promise<CapabilityInvocationResult>;
}
