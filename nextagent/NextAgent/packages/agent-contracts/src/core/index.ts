import type {
  AgentId,
  AgentVersion,
  IdentityContext,
  JsonObject,
  JsonValue,
  RequestContextId,
  RequestRunId,
  SafeError,
  SessionId,
  ToolEventType,
  WorkflowNodeType,
} from '@nextagent/agent-common';
import type { MessageId } from '@nextagent/agent-common';
import type { RequestContext, RequestRun } from '../runtime/index.js';
import { Type, type Static, type TSchema } from '@sinclair/typebox';
import { CapabilityLocalesSchema } from '../capability/index.js';

export type RoutingDecisionKind = 'DETERMINISTIC_FLOW' | 'MODEL_DRIVEN_LOOP' | 'CLARIFY' | 'REJECT' | 'HUMAN_HANDOFF';

export interface AgentRoutingDecision {
  readonly kind: RoutingDecisionKind;
  readonly safeReason: string;
  readonly evidenceRef?: string;
  readonly skillName?: string;
  readonly recipeName?: string;
}

export type AgentRoutingPolicyResult = AgentRoutingDecision;

export interface AgentRoutingPolicyExecutable {
  decide: (run: RequestRun, context: RequestContext, signal: AbortSignal) => Promise<AgentRoutingPolicyResult> | AgentRoutingPolicyResult;
}

const WorkflowSafeIdSchema = Type.String({ minLength: 1, maxLength: 128, pattern: '^[A-Za-z0-9._:-]+$' });
// Type.Record (kind "Record") is used instead of Type.Unsafe so that Value.Check
// can validate payloads at untrusted boundaries. The cast preserves JsonObject
// as the static type for all existing Static<typeof ...> derivations.
const WorkflowOpaqueObjectSchema = Type.Record(Type.String(), Type.Unknown()) as unknown as TSchema & { static: JsonObject };
const WorkflowOpaqueArraySchema = Type.Array(Type.Unknown()) as unknown as TSchema & { static: readonly JsonValue[] };

export const WorkflowBatchInputDataItemSchema = Type.Union([
  WorkflowOpaqueArraySchema,
  Type.String({ minLength: 1, maxLength: 1024 }),
]) as unknown as TSchema & { static: readonly JsonValue[] | string };

export const WorkflowBranchDefSchema = Type.Object(
  {
    condition: Type.Optional(Type.String({ minLength: 0, maxLength: 4096 })),
  },
  { additionalProperties: false },
);

export type WorkflowBranchDef = Static<typeof WorkflowBranchDefSchema>;

export const WorkflowNodeTypeSchema = Type.Union([
  Type.Literal('START'),
  Type.Literal('END'),
  Type.Literal('LLM'),
  Type.Literal('LLM_ROUTER'),
  Type.Literal('INTENT_RECOGNITION'),
  Type.Literal('QUESTION_REWRITING'),
  Type.Literal('TRANSLATION'),
  Type.Literal('DATA_ANALYSIS'),
  Type.Literal('PARAM_EXTRACT'),
  Type.Literal('TOOL'),
  Type.Literal('TOOL_CHOICE'),
  Type.Literal('RESTFUL'),
  Type.Literal('PYTHON'),
  Type.Literal('AGENT'),
  Type.Literal('SKILL'),
  Type.Literal('DISPLAY'),
  Type.Literal('GUARDRAIL'),
  Type.Literal('KNOWLEDGE_SEARCH'),
  Type.Literal('KNOWLEDGE_QA'),
  Type.Literal('API_CHOICE'),
  Type.Literal('RECIPE_CHOICE'),
  Type.Literal('USER_CHECK'),
  Type.Literal('INTERRUPT'),
  Type.Literal('ROUTER'),
  Type.Literal('CONDITION'),
  Type.Literal('SUBFLOW'),
  Type.Literal('PARALLEL'),
  Type.Literal('DELAY'),
]);

export const RetryPolicySchema = Type.Object(
  {
    maxAttempts: Type.Optional(Type.Integer({ minimum: 0 })),
    backoff: Type.Optional(Type.Union([Type.Literal('fixed'), Type.Literal('exponential')])),
    delay: Type.Optional(Type.Integer({ minimum: 0 })),
  },
  { additionalProperties: false },
);

export type RetryPolicy = Static<typeof RetryPolicySchema>;

export const CancelPolicySchema = Type.Object(
  {
    rollbackNode: Type.Optional(Type.Record(WorkflowSafeIdSchema, WorkflowBranchDefSchema)),
  },
  { additionalProperties: false },
);

export type CancelPolicy = Static<typeof CancelPolicySchema>;

export const ControlPolicySchema = Type.Object(
  {
    cancel: Type.Optional(CancelPolicySchema),
    cancelTimeout: Type.Optional(Type.Integer({ minimum: 1 })),
  },
  { additionalProperties: false },
);

export type ControlPolicy = Static<typeof ControlPolicySchema>;

export const RuntimeConfigSchema = Type.Object(
  {
    timeout: Type.Optional(Type.Integer({ minimum: 1 })),
    incremental: Type.Optional(Type.Boolean()),
    persistence: Type.Optional(
      Type.Object(
        {
          checkpoint: Type.Optional(Type.Boolean()),
        },
        { additionalProperties: false },
      ),
    ),
    defaultRetry: Type.Optional(RetryPolicySchema),
    controlPolicy: Type.Optional(ControlPolicySchema),
  },
  { additionalProperties: false },
);

export type RuntimeConfig = Static<typeof RuntimeConfigSchema>;

export const InputDefSchema = Type.Object(
  {
    type: Type.Union([Type.Literal('string'), Type.Literal('number'), Type.Literal('boolean'), Type.Literal('array'), Type.Literal('object')]),
    required: Type.Optional(Type.Boolean()),
    default: Type.Optional(Type.Unknown()),
    description: Type.Optional(Type.String({ minLength: 1, maxLength: 512 })),
  },
  { additionalProperties: false },
);

export type InputDef = Static<typeof InputDefSchema>;

export const NodePresentationSchema = Type.Object(
  {
    outputParser: Type.Optional(WorkflowOpaqueObjectSchema),
    recommends: Type.Optional(Type.Array(Type.String({ maxLength: 256 }), { maxItems: 10 })),
    tag: Type.Optional(Type.String({ maxLength: 64 })),
  },
  { additionalProperties: false },
);

export type NodePresentation = Static<typeof NodePresentationSchema>;

export const RecipePresentationSchema = Type.Object(
  {
    recommends: Type.Optional(
      Type.Object(
        {
          enabled: Type.Optional(Type.Boolean()),
          topN: Type.Optional(Type.Integer({ minimum: 1, maximum: 10 })),
        },
        { additionalProperties: false },
      ),
    ),
  },
  { additionalProperties: false },
);

export type RecipePresentation = Static<typeof RecipePresentationSchema>;

export const WorkflowLoopResultTypeSchema = Type.Union([Type.Literal('List'), Type.Literal('Map')]);
export type WorkflowLoopResultType = Static<typeof WorkflowLoopResultTypeSchema>;

export const WorkflowLoopConfigSchema = Type.Object(
  {
    loopId: Type.Optional(WorkflowSafeIdSchema),
    loopCardinality: Type.Optional(Type.Integer({ minimum: 1, maximum: 1000 })),
    loopCompletionCondition: Type.Optional(Type.String({ minLength: 1, maxLength: 1024 })),
    loopInputDataItem: Type.Optional(Type.String({ minLength: 1, maxLength: 1024 })),
    loopElementVariable: Type.Optional(Type.String({ minLength: 1, maxLength: 128 })),
    loopTimeCycle: Type.Optional(Type.Integer({ minimum: 0 })),
    loopEndNode: Type.Optional(WorkflowSafeIdSchema),
    loopStartNode: Type.Optional(WorkflowSafeIdSchema),
    loopResultVariable: Type.Optional(Type.String({ minLength: 1, maxLength: 128 })),
    loopResultType: Type.Optional(WorkflowLoopResultTypeSchema),
    loopResultKey: Type.Optional(Type.String({ minLength: 1, maxLength: 1024 })),
    loopResultValue: Type.Optional(Type.String({ minLength: 1, maxLength: 1024 })),
  },
  { additionalProperties: false },
);
export type WorkflowLoopConfig = Static<typeof WorkflowLoopConfigSchema>;

export const WorkflowBatchModeSchema = Type.Union([Type.Literal('serial'), Type.Literal('parallel')]);
export type WorkflowBatchMode = Static<typeof WorkflowBatchModeSchema>;

export const WorkflowBatchFailStrategySchema = Type.Union([Type.Literal('continue'), Type.Literal('abort')]);
export type WorkflowBatchFailStrategy = Static<typeof WorkflowBatchFailStrategySchema>;

export const WorkflowBatchResultMergeSchema = Type.Union([Type.Literal('append'), Type.Literal('map')]);
export type WorkflowBatchResultMerge = Static<typeof WorkflowBatchResultMergeSchema>;

export const WorkflowBatchConfigSchema = Type.Object(
  {
    batchInputDataItem: Type.Optional(WorkflowBatchInputDataItemSchema),
    batchElementVariable: Type.Optional(Type.String({ minLength: 1, maxLength: 128 })),
    batchSize: Type.Optional(Type.Integer({ minimum: 1 })),
    batchMode: Type.Optional(WorkflowBatchModeSchema),
    batchFailStrategy: Type.Optional(WorkflowBatchFailStrategySchema),
    batchParallelism: Type.Optional(Type.Integer({ minimum: 1, maximum: 20 })),
    batchResultMerge: Type.Optional(WorkflowBatchResultMergeSchema),
  },
  { additionalProperties: false },
);
export type WorkflowBatchConfig = Static<typeof WorkflowBatchConfigSchema>;

export const WorkflowNodeDefSchema = Type.Object(
  {
    type: WorkflowNodeTypeSchema,
    description: Type.Optional(Type.String({ minLength: 1, maxLength: 4096 })),
    inputs: Type.Optional(WorkflowOpaqueObjectSchema),
    outputs: Type.Optional(WorkflowOpaqueObjectSchema),
    dependsOn: Type.Optional(Type.Array(WorkflowSafeIdSchema)),
    retry: Type.Optional(RetryPolicySchema),
    timeout: Type.Optional(Type.Integer({ minimum: 1 })),
    presentation: Type.Optional(NodePresentationSchema),
    outputParser: Type.Optional(WorkflowOpaqueObjectSchema),
    retryPolicy: Type.Optional(WorkflowOpaqueObjectSchema),
    onError: Type.Optional(WorkflowOpaqueObjectSchema),
    exception: Type.Optional(Type.Record(WorkflowSafeIdSchema, WorkflowBranchDefSchema)),
    loopConfig: Type.Optional(WorkflowLoopConfigSchema),
    batchConfig: Type.Optional(WorkflowBatchConfigSchema),
    next: Type.Optional(Type.Record(WorkflowSafeIdSchema, WorkflowBranchDefSchema)),
  },
  { additionalProperties: false },
);

export type WorkflowNodeDef = Omit<Static<typeof WorkflowNodeDefSchema>, 'type'> & {
  readonly type: WorkflowNodeType;
};

export const FlowGraphSchema = Type.Object(
  {
    nodes: Type.Record(WorkflowSafeIdSchema, WorkflowNodeDefSchema),
  },
  { additionalProperties: false },
);

export type FlowGraph = Static<typeof FlowGraphSchema>;

export const RecipeTypeSchema = Type.Union([Type.Literal('recipe'), Type.Literal('boot-recipe')]);

export type RecipeType = Static<typeof RecipeTypeSchema>;

// Free-text classification fields (domain/scene) per 1.0 DSL spec: max 512, allows Chinese.
// Distinct from WorkflowSafeIdSchema which serves structural identifiers (node-id etc).
const RecipeClassificationFieldSchema = Type.String({ minLength: 1, maxLength: 512 });
const RecipeLanguageSchema = Type.Union([Type.Literal('zh'), Type.Literal('en')]);

export const RecipeDefinitionSchema = Type.Object(
  {
    type: Type.Optional(RecipeTypeSchema),
    recipeName: Type.String({ maxLength: 255 }),
    version: Type.String({ minLength: 1, maxLength: 128 }),
    displayName: Type.String({ minLength: 1, maxLength: 256 }),
    locales: Type.Optional(CapabilityLocalesSchema),
    description: Type.Optional(Type.String({ minLength: 1, maxLength: 4096 })),
    domain: Type.Optional(RecipeClassificationFieldSchema),
    scene: Type.Optional(RecipeClassificationFieldSchema),
    lang: Type.Optional(RecipeLanguageSchema),
    flowGraph: FlowGraphSchema,
    runtime: Type.Optional(RuntimeConfigSchema),
    inputs: Type.Optional(Type.Record(WorkflowSafeIdSchema, InputDefSchema)),
    metadata: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
    presentation: Type.Optional(RecipePresentationSchema),
    priority: Type.Optional(Type.Integer()),
    inputSchema: Type.Optional(WorkflowOpaqueObjectSchema),
    outputSchema: Type.Optional(WorkflowOpaqueObjectSchema),
  },
  { additionalProperties: false },
);

export type RecipeDefinition = Static<typeof RecipeDefinitionSchema>;

export type WorkflowExecutionStatus = 'COMPLETED' | 'FAILED' | 'INTERRUPTED' | 'WAITING';
export type WorkflowNodeStatus = 'NODE_COMPLETED' | 'NODE_FAILED' | 'NODE_SKIPPED' | 'NODE_WAITING';
export type WorkflowExecutionEventType = 'NODE_STARTED' | 'NODE_COMPLETED' | 'NODE_FAILED' | 'NODE_SKIPPED' | 'NODE_WAITING' | 'NODE_OUTPUT_DELTA';
export type WorkflowVisibleDeltaChannel = 'CONTENT' | 'THINKING' | 'CHART' | 'TABLE' | 'DSL';

export interface WorkflowExecutionDiagnostic {
  readonly reasonCode: string;
  readonly selectedBranchId?: string;
  readonly waitingBranchCount?: number;
  readonly conditionIndex?: number;
}

export interface WorkflowVisibleDelta {
  readonly channel: WorkflowVisibleDeltaChannel;
  readonly content: string;
  readonly level?: ToolEventType;
}

export interface WorkflowExecutionRequest {
  readonly recipeName: RecipeDefinition['recipeName'];
  readonly recipeVersion: RecipeDefinition['version'];
  readonly inputText?: string;
  readonly inputVariables: JsonObject;
  readonly executionMetadata?: JsonObject;
  readonly identityContext: IdentityContext;
  readonly agentId: AgentId;
  readonly agentVersion: AgentVersion;
  readonly agentAssemblyRef?: string;
  readonly sessionId: SessionId;
  readonly requestId: MessageId;
  readonly runId: RequestRunId;
  readonly requestContextId: RequestContextId;
  readonly resumeState?: JsonObject;
}

export interface WorkflowNodeResult {
  readonly nodeId: string;
  readonly nodeType: WorkflowNodeType;
  readonly status: WorkflowNodeStatus;
  readonly output?: JsonObject;
  readonly safeError?: SafeError;
  readonly retryCount: number;
  readonly startedAt: Date;
  readonly completedAt: Date;
}

export interface WorkflowExecutionResult {
  readonly executionId: string;
  readonly status: WorkflowExecutionStatus;
  readonly outputVariables: JsonObject;
  readonly nodeResults: readonly WorkflowNodeResult[];
  readonly startedAt: Date;
  readonly completedAt: Date;
  readonly pendingInput?: JsonObject;
}

export interface WorkflowPendingInputOption {
  readonly label: string;
  readonly value: string;
}

export interface WorkflowPendingInputQuestion {
  readonly prompt: string;
  readonly options: readonly WorkflowPendingInputOption[];
  readonly multiple?: boolean;
  readonly custom?: boolean;
}

export interface WorkflowLoopContext {
  readonly loopId: string;
  readonly iteration: number;
  readonly elementIndex: number;
  readonly collectedResults: readonly JsonValue[];
}

export interface WorkflowExecutionResumeState {
  readonly executionId: string;
  readonly recipeName: RecipeDefinition['recipeName'];
  readonly nodeId: string;
  readonly nodeType: WorkflowNodeType;
  readonly variables: JsonObject;
  readonly pendingInputId?: string;
  readonly answers?: ReadonlyArray<readonly string[]>;
  readonly pendingAnswerSummary?: string;
  readonly loopContext?: WorkflowLoopContext;
}

export interface WorkflowPendingInputRequest {
  readonly id: string;
  readonly sessionId: string;
  readonly kind: 'QUESTION' | 'CONFIRMATION' | 'AUTHORIZATION' | 'HUMAN_HANDOFF';
  readonly questions: readonly WorkflowPendingInputQuestion[];
  readonly timeoutAt?: number;
}

export interface WorkflowPendingInputActivation {
  readonly kind: WorkflowPendingInputRequest['kind'];
  readonly questions: readonly WorkflowPendingInputQuestion[];
  readonly timeoutAt?: number;
  readonly resumeState: WorkflowExecutionResumeState;
}

export interface WorkflowExecutionEvent {
  readonly executionId: string;
  readonly nodeExecutionId?: string;
  readonly predecessorNodeExecutionIds?: readonly string[];
  readonly nodeId: string;
  readonly nodeType: WorkflowNodeType;
  readonly eventType: WorkflowExecutionEventType;
  readonly visibleDelta?: WorkflowVisibleDelta;
  readonly output?: JsonObject;
  readonly input?: JsonObject;
  readonly diagnostic?: WorkflowExecutionDiagnostic;
  readonly safeError?: SafeError;
  readonly retryCount: number;
  readonly startedAt: Date;
  readonly completedAt?: Date;
}

export interface WorkflowExecutionObserver {
  emitEvent: (event: WorkflowExecutionEvent) => void | Promise<void>;
}

export interface WorkflowExecutionService {
  execute: (
    request: WorkflowExecutionRequest,
    signal: AbortSignal,
    observer?: WorkflowExecutionObserver,
    runtime?: {
      requestPendingInput: (request: JsonObject, signal: AbortSignal) => Promise<JsonObject>;
      saveCheckpoint?: (input: { readonly resumeState: WorkflowExecutionResumeState }) => Promise<void>;
    },
  ) => Promise<WorkflowExecutionResult>;
}

export type WorkflowExecutionMode = 'local' | 'remote';

export type WorkflowRemoteExecutionFailureReasonCode =
  'WORKFLOW_REMOTE_UNAVAILABLE' | 'WORKFLOW_REMOTE_TIMEOUT' | 'WORKFLOW_REMOTE_UNAUTHORIZED' | 'WORKFLOW_REMOTE_INVALID_RESPONSE';

export type WorkflowRemoteExecutionStreamItem =
  | { readonly kind: 'event'; readonly event: WorkflowExecutionEvent }
  | { readonly kind: 'result'; readonly result: WorkflowExecutionResult }
  | { readonly kind: 'failure'; readonly reasonCode: WorkflowRemoteExecutionFailureReasonCode; readonly message: string };

export interface WorkflowRemoteExecutionGateway {
  execute: (request: WorkflowExecutionRequest, signal: AbortSignal) => AsyncIterable<WorkflowRemoteExecutionStreamItem>;
}

const WorkflowDateSchema = Type.String({ minLength: 1, maxLength: 128 });
const SafeErrorSchema = Type.Object(
  {
    code: Type.String({ minLength: 1, maxLength: 128 }),
    message: Type.String({ minLength: 1, maxLength: 4096 }),
    category: Type.Union([
      Type.Literal('VALIDATION'),
      Type.Literal('AUTHORIZATION'),
      Type.Literal('POLICY_DENIED'),
      Type.Literal('NOT_FOUND'),
      Type.Literal('CONFLICT'),
      Type.Literal('UNAVAILABLE'),
      Type.Literal('TIMEOUT'),
      Type.Literal('CANCELED'),
      Type.Literal('INTERNAL'),
    ]),
    retryable: Type.Boolean(),
    safeDetails: Type.Optional(WorkflowOpaqueObjectSchema),
  },
  { additionalProperties: false },
);

export const WorkflowExecutionDiagnosticSchema = Type.Object(
  {
    reasonCode: Type.String({ minLength: 1, maxLength: 128 }),
    selectedBranchId: Type.Optional(WorkflowSafeIdSchema),
    waitingBranchCount: Type.Optional(Type.Integer({ minimum: 0 })),
    conditionIndex: Type.Optional(Type.Integer({ minimum: 0 })),
  },
  { additionalProperties: false },
);

export const WorkflowVisibleDeltaSchema = Type.Object(
  {
    channel: Type.Union([Type.Literal('CONTENT'), Type.Literal('THINKING'), Type.Literal('CHART'), Type.Literal('TABLE'), Type.Literal('DSL')]),
    content: Type.String({ minLength: 1, maxLength: 150_000 }),
    level: Type.Optional(
      Type.Union([
        Type.Literal('TITLE'),
        Type.Literal('DETAIL'),
        Type.Literal('ANSWER'),
        Type.Literal('SUB_TITLE'),
        Type.Literal('SUB_DETAIL'),
        Type.Literal('SUB_CONCLUSION'),
        Type.Literal('EXPAND_PANEL'),
      ]),
    ),
  },
  { additionalProperties: false },
);

export const WorkflowNodeResultSchema = Type.Object(
  {
    nodeId: WorkflowSafeIdSchema,
    nodeType: WorkflowNodeTypeSchema,
    status: Type.Union([Type.Literal('NODE_COMPLETED'), Type.Literal('NODE_FAILED'), Type.Literal('NODE_SKIPPED'), Type.Literal('NODE_WAITING')]),
    output: Type.Optional(WorkflowOpaqueObjectSchema),
    safeError: Type.Optional(SafeErrorSchema),
    retryCount: Type.Integer({ minimum: 0 }),
    startedAt: WorkflowDateSchema,
    completedAt: WorkflowDateSchema,
  },
  { additionalProperties: false },
);

export const WorkflowExecutionResultSchema = Type.Object(
  {
    executionId: WorkflowSafeIdSchema,
    status: Type.Union([Type.Literal('COMPLETED'), Type.Literal('FAILED'), Type.Literal('INTERRUPTED'), Type.Literal('WAITING')]),
    outputVariables: WorkflowOpaqueObjectSchema,
    nodeResults: Type.Array(WorkflowNodeResultSchema),
    startedAt: WorkflowDateSchema,
    completedAt: WorkflowDateSchema,
    pendingInput: Type.Optional(
      Type.Object(
        {
          id: WorkflowSafeIdSchema,
          sessionId: WorkflowSafeIdSchema,
          kind: Type.Union([Type.Literal('QUESTION'), Type.Literal('CONFIRMATION'), Type.Literal('AUTHORIZATION'), Type.Literal('HUMAN_HANDOFF')]),
          questions: Type.Array(
            Type.Object(
              {
                prompt: Type.String({ minLength: 1, maxLength: 1000 }),
                options: Type.Array(
                  Type.Object(
                    {
                      label: Type.String({ minLength: 1, maxLength: 200 }),
                      value: Type.String({ minLength: 1, maxLength: 200 }),
                    },
                    { additionalProperties: false },
                  ),
                ),
                multiple: Type.Optional(Type.Boolean()),
                custom: Type.Optional(Type.Boolean()),
              },
              { additionalProperties: false },
            ),
          ),
          timeoutAt: Type.Optional(Type.Integer({ minimum: 1 })),
        },
        { additionalProperties: false },
      ),
    ),
  },
  { additionalProperties: false },
);

export const WorkflowExecutionEventSchema = Type.Object(
  {
    executionId: WorkflowSafeIdSchema,
    nodeExecutionId: Type.Optional(WorkflowSafeIdSchema),
    predecessorNodeExecutionIds: Type.Optional(Type.Array(WorkflowSafeIdSchema, { maxItems: 128 })),
    nodeId: WorkflowSafeIdSchema,
    nodeType: WorkflowNodeTypeSchema,
    eventType: Type.Union([
      Type.Literal('NODE_STARTED'),
      Type.Literal('NODE_COMPLETED'),
      Type.Literal('NODE_FAILED'),
      Type.Literal('NODE_SKIPPED'),
      Type.Literal('NODE_WAITING'),
      Type.Literal('NODE_OUTPUT_DELTA'),
    ]),
    visibleDelta: Type.Optional(WorkflowVisibleDeltaSchema),
    output: Type.Optional(WorkflowOpaqueObjectSchema),
    input: Type.Optional(WorkflowOpaqueObjectSchema),
    diagnostic: Type.Optional(WorkflowExecutionDiagnosticSchema),
    safeError: Type.Optional(SafeErrorSchema),
    retryCount: Type.Integer({ minimum: 0 }),
    startedAt: WorkflowDateSchema,
    completedAt: Type.Optional(WorkflowDateSchema),
  },
  { additionalProperties: false },
);
