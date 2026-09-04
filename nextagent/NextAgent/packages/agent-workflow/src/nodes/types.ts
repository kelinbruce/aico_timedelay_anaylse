import type { JsonObject, WorkflowNodeType } from '@nextagent/agent-common';
import type { CapabilityInvocationPort, RuntimeCapabilityResolver, WorkflowSandboxExecutionPort } from '@nextagent/agent-contracts/capability';
import type {
  RecipeDefinition,
  WorkflowExecutionDiagnostic,
  WorkflowExecutionObserver,
  WorkflowExecutionRequest,
  WorkflowExecutionResult,
  WorkflowNodeDef,
  WorkflowNodeStatus,
  WorkflowVisibleDelta,
  WorkflowExecutionResumeState,
  WorkflowPendingInputActivation,
  WorkflowPendingInputOption,
  WorkflowPendingInputQuestion,
  WorkflowPendingInputRequest,
} from '@nextagent/agent-contracts/core';
import type { ModelInferenceOptions, ModelInvocationService } from '@nextagent/agent-contracts/model';

export type {
  WorkflowExecutionResumeState,
  WorkflowPendingInputActivation,
  WorkflowPendingInputOption,
  WorkflowPendingInputQuestion,
  WorkflowPendingInputRequest,
} from '@nextagent/agent-contracts/core';

export interface WorkflowRecipeAwareObserver extends WorkflowExecutionObserver {
  readonly registerExecutionRecipe?: (executionId: string, recipe: RecipeDefinition) => void;
}

export interface WorkflowNodeHandlerContext {
  readonly executionId: string;
  readonly request: WorkflowExecutionRequest;
  readonly enableQueryRewrite?: boolean;
  readonly recipe: RecipeDefinition;
  readonly nodeId: string;
  readonly nodeExecutionId?: string;
  readonly node: WorkflowNodeDef;
  readonly variables: JsonObject;
  readonly attempt: number;
  readonly signal: AbortSignal;
  readonly emitOutputDelta: (delta: WorkflowVisibleDelta) => void | Promise<void>;
  readonly resumeState?: WorkflowExecutionResumeState;
  readonly requestPendingInput?: (request: WorkflowPendingInputActivation, signal: AbortSignal) => Promise<WorkflowPendingInputRequest>;
  readonly observer?: WorkflowRecipeAwareObserver;
}

export type WorkflowNodeTransition =
  | { readonly kind: 'CONTINUE'; readonly nextNodeId?: string }
  | { readonly kind: 'BRANCH'; readonly nextNodeId: string }
  | {
      readonly kind: 'FORK_JOIN';
      readonly branchNodeIds: readonly string[];
      readonly joinNodeId: string;
      readonly joinOnFailure?: 'break' | 'wait';
      /** Convergence timeout in milliseconds. */
      readonly joinTimeout?: number;
    }
  | { readonly kind: 'TERMINAL' };

export interface WorkflowNodeHandlerResult {
  readonly status?: WorkflowNodeStatus;
  readonly outputVariables?: JsonObject;
  readonly diagnostic?: WorkflowExecutionDiagnostic;
  readonly transition?: WorkflowNodeTransition;
  readonly pendingInput?: WorkflowPendingInputRequest;
}

export type WorkflowNodeHandler = (context: WorkflowNodeHandlerContext) => Promise<WorkflowNodeHandlerResult | void>;

export interface WorkflowNodeCatalog {
  readonly handlers: Readonly<Partial<Record<WorkflowNodeType, WorkflowNodeHandler>>>;
}

export interface WorkflowNodeModelInvocationConfig {
  readonly modelId: string;
  readonly contextWindowTokens: number;
  readonly inferenceOptions: ModelInferenceOptions;
  readonly timeoutMs: number;
  readonly maxRetries: number;
}

export interface WorkflowNodeLlmPromptRequest {
  readonly request: WorkflowExecutionRequest;
  readonly enableQueryRewrite?: boolean;
  readonly nodeId: string;
  readonly node: WorkflowNodeDef;
  readonly resolvedInputs: Record<string, unknown>;
  readonly variables: JsonObject;
  readonly modelConfig: WorkflowNodeModelInvocationConfig;
  readonly defaultPurpose: string;
  readonly defaultUserPrompt: string;
}

export interface WorkflowNodeLlmPrompt {
  readonly systemPrompt?: string;
  readonly userPrompt: string;
  readonly inferenceOptions?: ModelInferenceOptions;
  readonly diagnostic?: WorkflowExecutionDiagnostic;
}

export interface WorkflowGuardrailRequest {
  readonly policyId: string;
  readonly guardrailType?: 'QUESTION' | 'TOPIC' | 'ANSWER';
  readonly guardrailParams?: JsonObject;
  readonly sessionId: WorkflowExecutionRequest['sessionId'];
  readonly requestId: WorkflowExecutionRequest['requestId'];
  readonly runId: WorkflowExecutionRequest['runId'];
  readonly agentId: WorkflowExecutionRequest['agentId'];
  readonly agentVersion: WorkflowExecutionRequest['agentVersion'];
  readonly workflowNodeId: string;
  readonly workflowNodeType: WorkflowNodeType;
  readonly content: string;
  readonly safeContentSummary: string;
}

export interface WorkflowGuardrailDecision {
  readonly decision: 'PASS' | 'REJECT' | 'NO_OPINION';
  readonly safeReason?: string;
  readonly safeError?: {
    readonly code: string;
    readonly message: string;
    readonly category:
      'VALIDATION' | 'AUTHORIZATION' | 'POLICY_DENIED' | 'NOT_FOUND' | 'CONFLICT' | 'UNAVAILABLE' | 'TIMEOUT' | 'CANCELED' | 'INTERNAL';
    readonly retryable: boolean;
    readonly safeDetails?: JsonObject;
  };
}

export interface WorkflowKnowledgeIndex {
  readonly domain?: string;
  readonly scene?: string;
  readonly indexName: string;
  readonly indexType?: 'API' | 'RECIPE' | 'KNOWLEDGE';
  readonly priority?: number;
  readonly vsTopN?: number;
  readonly esTopN?: number;
  readonly filters?: JsonObject;
}

export interface WorkflowKnowledgeRetrievalRequest {
  readonly query: string;
  readonly indexes: readonly WorkflowKnowledgeIndex[];
  readonly filters?: JsonObject;
  readonly extensions?: readonly string[];
  readonly rankTopN: number;
  readonly vsTopN: number;
  readonly esTopN: number;
  readonly topK: number;
  readonly request: WorkflowExecutionRequest;
  readonly enableQueryRewrite?: boolean;
  readonly defaultIndexType: 'API' | 'RECIPE' | 'KNOWLEDGE';
}

export interface WorkflowKnowledgeRetrievalResult {
  readonly status: 'OK' | 'NO_INDEX' | 'UNAVAILABLE' | 'DEGRADED' | 'FAILED' | 'TIMEOUT' | 'CANCELED';
  readonly recommends: readonly JsonObject[];
  readonly diagnosticReason?: string;
}

export interface WorkflowFreeInferRequest {
  readonly question: string;
  readonly chatId?: string;
  readonly conversationId?: string;
  readonly agentName?: string;
  readonly request: WorkflowExecutionRequest;
}

export interface WorkflowFreeInferResult {
  readonly hit: boolean;
  readonly answer?: string;
}

export interface WorkflowModelInvocationHint {
  readonly capabilityId?: string;
  readonly modelId?: string;
  readonly modelGroup?: string;
}

export interface IntentMatchRule {
  readonly intentName: string;
  readonly patterns: readonly string[];
  readonly matchMode: 'ANY' | 'MUST' | 'NOT';
}

export interface CreateWorkflowNodeCatalogOptions {
  readonly capabilityInvocation?: CapabilityInvocationPort | (() => CapabilityInvocationPort | undefined);
  readonly sandboxExecution?: WorkflowSandboxExecutionPort;
  readonly runtimeCapabilityResolver?: (request: WorkflowExecutionRequest) => RuntimeCapabilityResolver | undefined;
  readonly modelInvocation?: ModelInvocationService | (() => ModelInvocationService | undefined);
  readonly tryFreeInfer?: (request: WorkflowFreeInferRequest, signal: AbortSignal) => Promise<WorkflowFreeInferResult> | WorkflowFreeInferResult;
  readonly resolveModelInvocationConfig?: (
    request: WorkflowExecutionRequest,
    signal: AbortSignal,
    hint?: WorkflowModelInvocationHint,
  ) => Promise<WorkflowNodeModelInvocationConfig> | WorkflowNodeModelInvocationConfig;
  readonly prepareLlmPrompt?: (request: WorkflowNodeLlmPromptRequest) => Promise<WorkflowNodeLlmPrompt> | WorkflowNodeLlmPrompt;
  readonly resolveIntentRules?: (request: WorkflowExecutionRequest) => Promise<readonly IntentMatchRule[]> | readonly IntentMatchRule[];
  readonly resolveSecretReference?: (reference: string) => Promise<string>;
  readonly evaluateGuardrail?: (
    request: WorkflowGuardrailRequest,
    signal: AbortSignal,
  ) => Promise<WorkflowGuardrailDecision> | WorkflowGuardrailDecision;
  readonly retrieveKnowledge?: (
    request: WorkflowKnowledgeRetrievalRequest,
    signal: AbortSignal,
  ) => Promise<WorkflowKnowledgeRetrievalResult> | WorkflowKnowledgeRetrievalResult;
  readonly resolveRecipeDefinition?: (request: WorkflowExecutionRequest, recipeName: RecipeDefinition['recipeName']) => RecipeDefinition | undefined;
  readonly executeSubRecipe?: (
    request: WorkflowExecutionRequest,
    signal: AbortSignal,
    observer?: WorkflowRecipeAwareObserver,
  ) => Promise<WorkflowExecutionResult>;
  readonly scene?: string;
  /** Resolve model invocation config with node-level model/modelGroup override.
   *  Falls back to resolveModelInvocationConfig when not provided or when model/modelGroup are absent.
   *  Note: modelGroup is currently deferred: the adapter does not route by group, it only applies model name override. */
  readonly resolveModelForParamExtract?: (
    request: WorkflowExecutionRequest,
    signal: AbortSignal,
    model?: string,
    modelGroup?: string,
  ) => Promise<WorkflowNodeModelInvocationConfig> | WorkflowNodeModelInvocationConfig;
}
