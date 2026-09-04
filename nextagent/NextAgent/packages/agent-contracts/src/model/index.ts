import type {
  AgentId,
  AgentVersion,
  JsonObject,
  MessageId,
  RequestRunId,
  SafeError,
  SecretReference,
  SessionId,
  SubjectId,
  TenantId,
} from '@nextagent/agent-common';
import { Type } from '@sinclair/typebox';

export type ModelProviderId = 'openai-compatible' | 'model-gateway';
export type ModelMessageRole = 'SYSTEM' | 'USER' | 'ASSISTANT' | 'TOOL';
export type ThinkingDepth = 'OFF' | 'LOW' | 'MEDIUM' | 'HIGH';
export type ReasoningTextMode = 'EXPLICIT_THINK_TAG' | 'IMPLICIT_OPEN_THINK_TAG';
export type ToolChoice = 'AUTO' | 'NONE' | 'REQUIRED';
export type ModelFinishReason = 'stop' | 'length' | 'tool-calls' | 'content-filter' | 'error' | 'unknown';
export type ModelIncompleteOutputReason = 'output-limit' | 'truncated-tool-call';
export type ModelAvailability = 'AVAILABLE' | 'UNAVAILABLE';
export type ModelUnavailableReason =
  'MODEL_PROVIDER_NOT_CONFIGURED' | 'MODEL_INFORMATION_UNAVAILABLE' | 'MODEL_NOT_FOUND' | 'MODEL_INFORMATION_AMBIGUOUS' | 'CONTEXT_WINDOW_INVALID';

export interface ThinkingOptions {
  readonly depth: ThinkingDepth;
}

export interface ModelInferenceOptions {
  readonly temperature?: number;
  readonly maxOutputTokens?: number;
  readonly topP?: number;
  readonly topK?: number;
  readonly presencePenalty?: number;
  readonly frequencyPenalty?: number;
  readonly thinking?: ThinkingOptions;
  readonly toolChoice?: ToolChoice;
  readonly providerOptions?: JsonObject;
  readonly modelParams?: JsonObject;
}

export interface ModelProfile extends ModelInferenceOptions {
  readonly modelId: string;
  readonly displayName?: string;
  readonly contextWindowTokens?: number;
  readonly fallbackEligible: boolean;
  readonly reasoningTextMode?: ReasoningTextMode;
  readonly timeoutMs?: number;
  readonly maxRetries?: number;
}

export interface ModelProviderProfile {
  readonly providerId: ModelProviderId;
  readonly baseUrl?: string;
  readonly credentialRef?: SecretReference;
  readonly models: readonly ModelProfile[];
}

export interface ResolvedModelConfiguration extends Omit<ModelInferenceOptions, 'providerOptions'> {
  readonly modelId: string;
  readonly contextWindowTokens: number;
  readonly temperature: number;
  readonly maxOutputTokens: number;
  readonly topP: number;
  readonly toolChoice: ToolChoice;
  readonly defaultTimeoutMs: number;
  readonly defaultMaxRetries: number;
}

export type ModelCatalogEntry =
  | {
      readonly availability: 'AVAILABLE';
      readonly fallbackEligible: boolean;
      readonly displayName?: string;
      readonly configuration: ResolvedModelConfiguration;
    }
  | {
      readonly modelId: string;
      readonly availability: 'UNAVAILABLE';
      readonly fallbackEligible: boolean;
      readonly displayName?: string;
      readonly unavailableReason: ModelUnavailableReason;
    };

export interface ModelCatalogQueryService {
  list: (signal: AbortSignal) => Promise<readonly ModelCatalogEntry[]>;
  get: (modelId: string, signal: AbortSignal) => Promise<ModelCatalogEntry | undefined>;
}

export interface ModelGatewayModelInformation {
  readonly modelId: string;
  readonly contextWindowTokens: number;
}

export type ModelGatewayModelInformationResult =
  | { readonly status: 'FOUND'; readonly information: ModelGatewayModelInformation }
  | { readonly status: 'NOT_FOUND' }
  | {
      readonly status: 'UNAVAILABLE';
      readonly reason: 'MODEL_INFORMATION_UNAVAILABLE' | 'MODEL_INFORMATION_AMBIGUOUS';
    };

export interface ModelGatewayModelInformationService {
  get: (modelId: string, signal: AbortSignal) => Promise<ModelGatewayModelInformationResult>;
}

export interface ModelTextContentPart {
  readonly type: 'text';
  readonly text: string;
}

export interface ModelToolCallContentPart {
  readonly type: 'tool-call';
  readonly toolCall: ModelToolCall;
}

export interface ModelToolResultContentPart {
  readonly type: 'tool-result';
  readonly toolCallId: string;
  readonly toolName: string;
  readonly output: JsonObject;
}

export type ModelMessageContentPart = ModelTextContentPart | ModelToolCallContentPart | ModelToolResultContentPart;

export interface ModelMessage {
  readonly role: ModelMessageRole;
  readonly content: readonly ModelMessageContentPart[];
}

export interface ModelToolDescriptor {
  readonly capabilityId: string;
  readonly name: string;
  readonly description?: string;
  readonly inputSchema: JsonObject;
}

export interface ModelToolCall {
  readonly toolCallId: string;
  readonly toolName: string;
  readonly arguments: JsonObject;
}

export interface ModelInvocationScope {
  readonly tenantId: TenantId;
  readonly subjectId: SubjectId;
  readonly agentId: AgentId;
  readonly agentVersion: AgentVersion;
  readonly agentAssemblyRef: string;
  readonly operationId: string;
  readonly sessionId?: SessionId;
  readonly requestId?: MessageId;
  readonly runId?: RequestRunId;
}

export interface ModelInvocationRequest extends ModelInferenceOptions {
  readonly invocationScope: ModelInvocationScope;
  readonly modelId: string;
  readonly contextWindowTokens?: number;
  readonly messages: readonly ModelMessage[];
  readonly tools: readonly ModelToolDescriptor[];
  readonly timeoutMs?: number;
  readonly maxRetries?: number;
}

export interface ModelStreamDelta {
  readonly content?: string;
  readonly reasoning?: string;
  readonly toolCall?: ModelToolCall;
}

export interface ModelUsage {
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  readonly totalTokens?: number;
}

export interface ModelFinalResult {
  readonly content: string;
  readonly reasoning?: string;
  readonly finishReason?: ModelFinishReason;
  readonly incompleteOutputReason?: ModelIncompleteOutputReason;
  readonly usage?: ModelUsage;
  readonly toolCalls?: readonly ModelToolCall[];
  readonly providerResponseId?: string;
  readonly safeError?: SafeError;
}

export interface ModelInvocationService {
  complete: (request: ModelInvocationRequest, signal: AbortSignal) => Promise<ModelFinalResult>;
  stream: (request: ModelInvocationRequest, signal: AbortSignal, onDelta: (delta: ModelStreamDelta) => Promise<void>) => Promise<ModelFinalResult>;
}

export interface ModelGatewayProvider {
  readonly providerId: string;
  createModelService: (scopedResolver?: () => Promise<string>, credentialRef?: string) => ModelInvocationService;
  createModelInformationService: () => ModelGatewayModelInformationService;
}

const ModelScalarSchema = Type.String({
  minLength: 1,
  maxLength: 256,
  pattern: '^(?=.*\\S)[^\\u0000-\\u001F\\u007F-\\u009F]+$',
});
const JsonObjectSchema = Type.Unsafe<JsonObject>({ type: 'object', additionalProperties: true });
const SafeIntegerSchema = Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER });
const PositiveSafeIntegerSchema = Type.Integer({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER });
const ModelTemperatureSchema = Type.Number({ minimum: 0, maximum: 2 });
const ModelTopPSchema = Type.Number({ minimum: 0, maximum: 1 });
const ModelPenaltySchema = Type.Number({ minimum: -2, maximum: 2 });

export const ModelIdSchema = ModelScalarSchema;

export const ThinkingOptionsSchema = Type.Object(
  {
    depth: Type.Union([Type.Literal('OFF'), Type.Literal('LOW'), Type.Literal('MEDIUM'), Type.Literal('HIGH')]),
  },
  { additionalProperties: false },
);

export const ToolChoiceSchema = Type.Union([Type.Literal('AUTO'), Type.Literal('NONE'), Type.Literal('REQUIRED')]);

export const ReasoningTextModeSchema = Type.Union([Type.Literal('EXPLICIT_THINK_TAG'), Type.Literal('IMPLICIT_OPEN_THINK_TAG')]);

const ProviderNeutralModelInferenceOptionProperties = {
  temperature: Type.Optional(ModelTemperatureSchema),
  maxOutputTokens: Type.Optional(PositiveSafeIntegerSchema),
  topP: Type.Optional(ModelTopPSchema),
  topK: Type.Optional(PositiveSafeIntegerSchema),
  presencePenalty: Type.Optional(ModelPenaltySchema),
  frequencyPenalty: Type.Optional(ModelPenaltySchema),
  thinking: Type.Optional(ThinkingOptionsSchema),
  toolChoice: Type.Optional(ToolChoiceSchema),
} as const;

const ModelInferenceOptionProperties = {
  ...ProviderNeutralModelInferenceOptionProperties,
  providerOptions: Type.Optional(JsonObjectSchema),
  modelParams: Type.Optional(JsonObjectSchema),
} as const;

export const ModelInferenceOptionsSchema = Type.Object(ModelInferenceOptionProperties, { additionalProperties: false });

export const ModelProfileSchema = Type.Object(
  {
    modelId: ModelIdSchema,
    displayName: Type.Optional(ModelScalarSchema),
    contextWindowTokens: Type.Optional(PositiveSafeIntegerSchema),
    fallbackEligible: Type.Boolean(),
    reasoningTextMode: Type.Optional(ReasoningTextModeSchema),
    ...ModelInferenceOptionProperties,
    timeoutMs: Type.Optional(PositiveSafeIntegerSchema),
    maxRetries: Type.Optional(SafeIntegerSchema),
  },
  { additionalProperties: false },
);

export const ModelProviderProfileSchema = Type.Object(
  {
    providerId: Type.Union([Type.Literal('openai-compatible'), Type.Literal('model-gateway')]),
    baseUrl: Type.Optional(Type.String({ minLength: 1, maxLength: 2048 })),
    credentialRef: Type.Optional(Type.String({ pattern: '^(env|file):.+' })),
    models: Type.Array(ModelProfileSchema, { minItems: 1 }),
  },
  { additionalProperties: false },
);

export const ResolvedModelConfigurationSchema = Type.Object(
  {
    ...ProviderNeutralModelInferenceOptionProperties,
    modelId: ModelIdSchema,
    contextWindowTokens: PositiveSafeIntegerSchema,
    temperature: ModelTemperatureSchema,
    maxOutputTokens: PositiveSafeIntegerSchema,
    topP: ModelTopPSchema,
    toolChoice: ToolChoiceSchema,
    defaultTimeoutMs: PositiveSafeIntegerSchema,
    defaultMaxRetries: SafeIntegerSchema,
  },
  { additionalProperties: false },
);

export const ModelCatalogEntrySchema = Type.Union([
  Type.Object(
    {
      availability: Type.Literal('AVAILABLE'),
      fallbackEligible: Type.Boolean(),
      displayName: Type.Optional(ModelScalarSchema),
      configuration: ResolvedModelConfigurationSchema,
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      modelId: ModelIdSchema,
      availability: Type.Literal('UNAVAILABLE'),
      fallbackEligible: Type.Boolean(),
      displayName: Type.Optional(ModelScalarSchema),
      unavailableReason: Type.Union([
        Type.Literal('MODEL_PROVIDER_NOT_CONFIGURED'),
        Type.Literal('MODEL_INFORMATION_UNAVAILABLE'),
        Type.Literal('MODEL_NOT_FOUND'),
        Type.Literal('MODEL_INFORMATION_AMBIGUOUS'),
        Type.Literal('CONTEXT_WINDOW_INVALID'),
      ]),
    },
    { additionalProperties: false },
  ),
]);

export const ModelGatewayModelInformationResultSchema = Type.Union([
  Type.Object(
    {
      status: Type.Literal('FOUND'),
      information: Type.Object(
        {
          modelId: ModelIdSchema,
          contextWindowTokens: PositiveSafeIntegerSchema,
        },
        { additionalProperties: false },
      ),
    },
    { additionalProperties: false },
  ),
  Type.Object({ status: Type.Literal('NOT_FOUND') }, { additionalProperties: false }),
  Type.Object(
    {
      status: Type.Literal('UNAVAILABLE'),
      reason: Type.Union([Type.Literal('MODEL_INFORMATION_UNAVAILABLE'), Type.Literal('MODEL_INFORMATION_AMBIGUOUS')]),
    },
    { additionalProperties: false },
  ),
]);

export const ModelToolCallSchema = Type.Object(
  {
    toolCallId: ModelScalarSchema,
    toolName: Type.String({
      maxLength: 256,
      pattern: '^[^\\u0000-\\u001F\\u007F-\\u009F]*$',
    }),
    arguments: JsonObjectSchema,
  },
  { additionalProperties: false },
);

const ModelMessageContentPartSchema = Type.Union([
  Type.Object(
    {
      type: Type.Literal('text'),
      text: Type.String(),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      type: Type.Literal('tool-call'),
      toolCall: ModelToolCallSchema,
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      type: Type.Literal('tool-result'),
      toolCallId: ModelScalarSchema,
      toolName: ModelScalarSchema,
      output: JsonObjectSchema,
    },
    { additionalProperties: false },
  ),
]);

export const ModelMessageSchema = Type.Object(
  {
    role: Type.Union([Type.Literal('SYSTEM'), Type.Literal('USER'), Type.Literal('ASSISTANT'), Type.Literal('TOOL')]),
    content: Type.Array(ModelMessageContentPartSchema),
  },
  { additionalProperties: false },
);

export const ModelToolDescriptorSchema = Type.Object(
  {
    capabilityId: ModelScalarSchema,
    name: ModelScalarSchema,
    description: Type.Optional(Type.String({ maxLength: 4096 })),
    inputSchema: JsonObjectSchema,
  },
  { additionalProperties: false },
);

export const ModelInvocationScopeSchema = Type.Object(
  {
    tenantId: ModelScalarSchema,
    subjectId: ModelScalarSchema,
    agentId: ModelScalarSchema,
    agentVersion: ModelScalarSchema,
    agentAssemblyRef: ModelScalarSchema,
    operationId: ModelScalarSchema,
    sessionId: Type.Optional(ModelScalarSchema),
    requestId: Type.Optional(ModelScalarSchema),
    runId: Type.Optional(ModelScalarSchema),
  },
  {
    additionalProperties: false,
    allOf: [
      {
        if: {
          anyOf: [{ required: ['sessionId'] }, { required: ['requestId'] }, { required: ['runId'] }],
        },
        then: { required: ['sessionId', 'requestId', 'runId'] },
      },
    ],
  },
);

export const ModelInvocationRequestSchema = Type.Object(
  {
    invocationScope: ModelInvocationScopeSchema,
    modelId: ModelIdSchema,
    contextWindowTokens: Type.Optional(PositiveSafeIntegerSchema),
    messages: Type.Array(ModelMessageSchema),
    tools: Type.Array(ModelToolDescriptorSchema),
    ...ModelInferenceOptionProperties,
    timeoutMs: Type.Optional(PositiveSafeIntegerSchema),
    maxRetries: Type.Optional(SafeIntegerSchema),
  },
  { additionalProperties: false },
);

const ModelUsageSchema = Type.Object(
  {
    inputTokens: Type.Optional(SafeIntegerSchema),
    outputTokens: Type.Optional(SafeIntegerSchema),
    totalTokens: Type.Optional(SafeIntegerSchema),
  },
  { additionalProperties: false },
);

const SafeErrorSchema = Type.Object(
  {
    code: ModelScalarSchema,
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
    safeDetails: Type.Optional(JsonObjectSchema),
  },
  { additionalProperties: false },
);

const ModelFinishReasonSchema = Type.Union([
  Type.Literal('stop'),
  Type.Literal('length'),
  Type.Literal('tool-calls'),
  Type.Literal('content-filter'),
  Type.Literal('error'),
  Type.Literal('unknown'),
]);

const ModelIncompleteOutputReasonSchema = Type.Union([Type.Literal('output-limit'), Type.Literal('truncated-tool-call')]);

const ModelFinalResultProperties = {
  content: Type.String(),
  reasoning: Type.Optional(Type.String()),
  finishReason: Type.Optional(ModelFinishReasonSchema),
  incompleteOutputReason: Type.Optional(ModelIncompleteOutputReasonSchema),
  usage: Type.Optional(ModelUsageSchema),
  toolCalls: Type.Optional(Type.Array(ModelToolCallSchema)),
  providerResponseId: Type.Optional(ModelScalarSchema),
  safeError: Type.Optional(SafeErrorSchema),
} as const;

export const ModelFinalResultSchema = Type.Intersect([
  Type.Object(ModelFinalResultProperties, { additionalProperties: false }),
  Type.Not(Type.Object({ safeError: SafeErrorSchema, incompleteOutputReason: ModelIncompleteOutputReasonSchema }, { additionalProperties: true })),
]);

export const ModelStreamDeltaSchema = Type.Object(
  {
    content: Type.Optional(Type.String()),
    reasoning: Type.Optional(Type.String()),
    toolCall: Type.Optional(ModelToolCallSchema),
  },
  { additionalProperties: false, minProperties: 1 },
);
