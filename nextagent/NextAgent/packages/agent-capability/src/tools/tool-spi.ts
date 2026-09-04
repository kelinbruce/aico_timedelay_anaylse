import type {
  AgentId,
  AgentVersion,
  JsonObject,
  RiskLevel,
  RiskPolicyOutcome,
  CapabilityId,
  CapabilityReplayPolicy,
  IdentityContext,
  MessageId,
  RequestContextId,
  RequestLocale,
  RequestRunId,
  SafeError,
  SessionId,
  SubjectId,
  TenantId,
} from '@nextagent/agent-common';
import type {
  CapabilityDisclosurePolicy,
  CapabilityLocales,
  CapabilityInvocationResult,
  RuntimeCapabilityResolver,
  SubagentExecutionPort,
  ParameterExtractionPort,
  ApiCallPort,
  ApiCallRequest,
  ApiCallResult,
  ApiCallStreamChunk,
} from '@nextagent/agent-contracts/capability';
import type { GuardrailGatewayPort } from '@nextagent/agent-contracts/gateway';
import type { RagRetrievalGateway } from '@nextagent/agent-contracts/gateway';
import type { SkillSourceRegistry } from '../skills/skill-source-discovery.js';

export type ToolDependencyName =
  | 'approval'
  | 'sandbox'
  | 'workspaceFiles'
  | 'skillSources'
  | 'ragRetrieval'
  | 'subagentExecution'
  | 'todoState'
  | 'workflowExecution'
  | 'cronTasks'
  | 'apiCallPort'
  | 'parameterExtraction';

export interface WorkflowExecutionToolPort {
  execute: (input: {
    readonly recipeName: string;
    readonly inputText?: string;
    readonly inputVariables: JsonObject;
    readonly context: ToolExecutionContext;
    readonly signal: AbortSignal;
  }) => Promise<CapabilityInvocationResult>;
}

export type { ApiCallPort, ApiCallRequest, ApiCallResult, ApiCallStreamChunk };

export interface WorkspaceFilePort {
  readText: (input: JsonObject, context: ToolExecutionContext, signal?: AbortSignal) => Promise<JsonObject>;
  writeText: (input: JsonObject, context: ToolExecutionContext, signal?: AbortSignal) => Promise<JsonObject>;
  editText: (input: JsonObject, context: ToolExecutionContext, signal?: AbortSignal) => Promise<JsonObject>;
  globFiles: (input: JsonObject, context: ToolExecutionContext, signal?: AbortSignal) => Promise<JsonObject>;
  grepFiles: (input: JsonObject, context: ToolExecutionContext, signal?: AbortSignal) => Promise<JsonObject>;
  projectSkillResources: (
    input: SkillResourceProjectionInput,
    context: ToolExecutionContext,
    signal?: AbortSignal,
  ) => Promise<SkillResourceProjectionResult>;
  resolveSkillResourcePath?: (relativePath: string, context: ToolExecutionContext) => Promise<SkillResourcePathResolution>;
  sandboxFilesystem: (context: ToolExecutionContext) => Promise<SandboxFilesystemLayout>;
  resolveView: (context: ToolExecutionContext) => Promise<ExecutionWorkspaceView>;
  clearRun: (context: Pick<ToolExecutionContext, 'agentId' | 'runId'>) => void;
}

export type SkillResourcePathResolution =
  | { readonly status: 'resolved'; readonly logicalPath: string }
  | { readonly status: 'not-found' }
  | { readonly status: 'ambiguous'; readonly candidates: readonly string[] };

export interface ExecutionWorkspaceView {
  readonly workspaceDir: 'workspace/';
  readonly defaultCwd: string;
  readonly roots: readonly ExecutionWorkspaceRootView[];
}

export interface ExecutionWorkspaceRootView {
  readonly kind: 'workspace' | 'systemResources' | 'temp' | 'generatedSkills' | 'sharedData';
  readonly logicalPath: string;
  readonly physicalPath: string;
  readonly access: 'read' | 'readWrite';
}

export interface SandboxFilesystemLayout {
  readonly defaultCwd: string;
  readonly roots: readonly SandboxFilesystemRoot[];
}

export interface SandboxFilesystemRoot {
  readonly kind: 'workspace' | 'systemResources' | 'temp' | 'generatedSkills' | 'sharedData';
  readonly logicalPath: string;
  readonly physicalPath: string;
  readonly access: 'read' | 'readWrite';
}

export interface SkillResourceProjectionInput {
  readonly providerId: string;
  readonly skillName: string;
  readonly skillVersion: string;
  readonly listResources?: SkillResourceProjectionLister;
  readonly readResource?: SkillResourceProjectionReader;
}

export interface SkillResourceProjectionMetadata {
  readonly relativePath: string;
  readonly kind: 'script' | 'reference' | 'asset';
  readonly sizeBytes: number;
  readonly contentHash?: string;
}

export interface SkillResourceProjectionEntry extends SkillResourceProjectionMetadata {
  readonly contentStream: AsyncIterable<Uint8Array>;
}

export type SkillResourceProjectionLister = (signal?: AbortSignal) => Promise<readonly SkillResourceProjectionMetadata[]>;
export type SkillResourceProjectionReader = (
  resource: SkillResourceProjectionMetadata,
  signal?: AbortSignal,
) => Promise<SkillResourceProjectionEntry | undefined>;

export interface SkillResourceProjectionResult {
  readonly skillProjectionKey: string;
  readonly rootRelativePath: string;
  readonly projectedCount: number;
}

export interface SandboxExecutionInput {
  readonly command: string;
  readonly args: readonly string[];
  readonly environment?: JsonObject;
  readonly timeoutMs: number;
  readonly stdoutLimitBytes: number;
  readonly stderrLimitBytes: number;
}

export interface SandboxExecutionPort {
  runShell: (input: SandboxExecutionInput, context: ToolExecutionContext, signal?: AbortSignal) => Promise<JsonObject>;
  runPython: (input: SandboxExecutionInput, context: ToolExecutionContext, signal?: AbortSignal) => Promise<JsonObject>;
  startBackgroundShell: (input: SandboxExecutionInput, context: ToolExecutionContext) => Promise<JsonObject>;
  runShellBackgroundable: (input: SandboxExecutionInput, context: ToolExecutionContext, signal?: AbortSignal) => Promise<JsonObject>;
  runShellStreaming?: (
    input: SandboxExecutionInput,
    context: ToolExecutionContext,
    onStdoutChunk: (chunk: string) => void | Promise<void>,
    signal?: AbortSignal,
  ) => Promise<JsonObject>;
}

export interface TodoStatePort {
  replaceTodos: (
    input: { readonly todos: readonly TodoStateItem[] },
    context: ToolExecutionContext,
    signal?: AbortSignal,
  ) => Promise<TodoStateReplacementResult>;
}

export interface TodoStateItem {
  readonly content: string;
  readonly activeForm: string;
  readonly status: 'pending' | 'in_progress' | 'completed';
}

export interface TodoStateReplacementResult {
  readonly oldTodos: readonly TodoStateItem[];
  readonly newTodos: readonly TodoStateItem[];
}

export interface CronTaskScope {
  readonly tenantId: TenantId;
  readonly subjectId: SubjectId;
  readonly displayName: string;
  readonly agentId: AgentId;
  readonly agentVersion: AgentVersion;
  readonly sessionId: SessionId;
  readonly requestRunId: RequestRunId;
}

export interface CronTaskMutationObservation {
  readonly operation: 'CRON_TASK_CREATED' | 'CRON_TASK_DELETED';
  readonly taskId: string;
  readonly scope: CronTaskScope;
}

export interface CronTaskRecord {
  readonly id: string;
  readonly cron: string;
  readonly prompt: string;
  readonly createdAt: number;
  readonly recurring: boolean;
  readonly humanSchedule: string;
}

export interface CronDelay {
  readonly days?: number;
  readonly hours?: number;
  readonly minutes?: number;
}

export interface CronTaskPort {
  addTask: (
    input:
      | { readonly scope: CronTaskScope; readonly cron: string; readonly prompt: string; readonly recurring: boolean }
      | { readonly scope: CronTaskScope; readonly delay: CronDelay; readonly prompt: string; readonly recurring: false },
  ) => Promise<string>;

  removeTasks: (input: { readonly scope: CronTaskScope; readonly ids: readonly string[] }) => Promise<void>;

  listTasks: (input: { readonly scope: CronTaskScope }) => Promise<readonly CronTaskRecord[]>;

  findTask: (input: { readonly scope: CronTaskScope; readonly id: string }) => Promise<CronTaskRecord | undefined>;
}

export interface ToolDependencies {
  readonly approval?: never;
  readonly sandbox?: SandboxExecutionPort;
  readonly guardrail?: GuardrailGatewayPort;
  readonly workspaceFiles?: WorkspaceFilePort;
  readonly skillSources?: SkillSourceRegistry;
  readonly ragRetrieval?: RagRetrievalGateway;
  readonly ragDefaultIndexes?: readonly string[];
  readonly subagentExecution?: SubagentExecutionPort;
  readonly todoState?: TodoStatePort;
  readonly workflowExecution?: WorkflowExecutionToolPort;
  readonly cronTasks?: CronTaskPort;
  readonly apiCallPort?: ApiCallPort;
  readonly parameterExtraction?: ParameterExtractionPort;
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
  readonly flowVariables?: import('@nextagent/agent-common').JsonObject;
}

export interface ToolExecuteOptions {
  readonly context?: ToolExecutionContext;
  readonly deps?: ToolDependencies;
  readonly signal?: AbortSignal;
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

export interface Tool<TInput extends JsonObject = JsonObject, TOutput extends JsonObject = JsonObject, TConfig extends JsonObject = JsonObject> {
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

export function defineTool<
  TInput extends JsonObject = JsonObject,
  TOutput extends JsonObject = JsonObject,
  TConfig extends JsonObject = JsonObject,
>(definition: {
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
}): ToolDefinition<TInput, TOutput, TConfig> {
  return {
    metadata: {
      name: definition.name,
      ...(definition.displayName === undefined ? {} : { displayName: definition.displayName }),
      ...(definition.locales === undefined ? {} : { locales: definition.locales }),
      description: definition.description,
      inputSchema: definition.inputSchema,
      outputSchema: definition.outputSchema,
      ...(definition.configSchema === undefined ? {} : { configSchema: definition.configSchema }),
      ...(definition.requiredDependencies === undefined ? {} : { requiredDependencies: definition.requiredDependencies }),
      ...(definition.replayPolicy === undefined ? {} : { replayPolicy: definition.replayPolicy }),
      ...(definition.disclosurePolicy === undefined ? {} : { disclosurePolicy: definition.disclosurePolicy }),
      ...(definition.returnsCapabilityResult === undefined ? {} : { returnsCapabilityResult: definition.returnsCapabilityResult }),
      ...(definition.observability === undefined ? {} : { observability: definition.observability }),
    },
    tool: {
      ...(definition.configure === undefined ? {} : { configure: definition.configure }),
      execute: definition.execute,
    },
  };
}

export class ToolDegradedResultError extends Error {
  readonly structuredPayload: JsonObject;
  readonly reasonCode: string;
  readonly safeMessage?: string;

  constructor(structuredPayload: JsonObject, reasonCode: string, options: { readonly safeMessage?: string } = {}) {
    super('Tool returned a safe degraded result.');
    this.name = 'ToolDegradedResultError';
    this.structuredPayload = structuredPayload;
    this.reasonCode = reasonCode;
    if (options.safeMessage !== undefined && options.safeMessage.length > 0) {
      this.safeMessage = options.safeMessage;
    }
  }
}

export class ToolFailedResultError extends Error {
  readonly structuredPayload: JsonObject;
  readonly code: string;
  readonly category: SafeError['category'];
  readonly retryable: boolean;
  readonly safeMessage?: string;
  readonly safeDetails?: JsonObject;

  constructor(
    structuredPayload: JsonObject,
    code: string,
    category: SafeError['category'],
    options: { readonly retryable?: boolean; readonly safeMessage?: string; readonly safeDetails?: JsonObject } = {},
  ) {
    super('Tool returned a safe failed result.');
    this.name = 'ToolFailedResultError';
    this.structuredPayload = structuredPayload;
    this.code = code;
    this.category = category;
    this.retryable = options.retryable ?? false;
    if (options.safeMessage !== undefined && options.safeMessage.length > 0) {
      this.safeMessage = options.safeMessage;
    }
    if (options.safeDetails !== undefined) {
      this.safeDetails = options.safeDetails;
    }
  }
}

export class ToolTimedOutResultError extends Error {
  readonly structuredPayload: JsonObject;
  readonly code: string;
  readonly retryable: boolean;
  readonly safeMessage?: string;

  constructor(structuredPayload: JsonObject, code: string, options: { readonly safeMessage?: string; readonly retryable?: boolean } = {}) {
    super('Tool timed out safely.');
    this.name = 'ToolTimedOutResultError';
    this.structuredPayload = structuredPayload;
    this.code = code;
    this.retryable = options.retryable ?? false;
    if (options.safeMessage !== undefined && options.safeMessage.length > 0) {
      this.safeMessage = options.safeMessage;
    }
  }
}
