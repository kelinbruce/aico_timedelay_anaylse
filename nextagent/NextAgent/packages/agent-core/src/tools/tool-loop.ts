import {
  AgentError,
  brand,
  deriveAssistantToolUseIdempotencyKey,
  deriveCapabilityInvocationIdempotencyKey,
  getLogger,
  runtimeRawExceptionData,
  SECRET_KEYWORD_PATTERN,
  type CapabilityId,
  type JsonObject,
  type JsonValue,
  type MessageId,
  type PendingInputId,
  type SafeError,
  type SubjectId,
  type TenantId,
} from '@nextagent/agent-common';
import type { AgentAssembly, AgentAssemblyRegistry } from '@nextagent/agent-contracts/agent-assembly';
import type {
  CapabilityCatalog,
  CapabilityContextPatch,
  CapabilityDescriptor,
  CapabilityGeneratedMessage,
  CapabilityInvocationPort,
  CapabilityInvocationResult,
  RuntimeCapabilityListRequest,
  RuntimeCapabilityResolveRequest,
  RuntimeCapabilityResolver,
} from '@nextagent/agent-contracts/capability';
import type { ModelFinalResult } from '@nextagent/agent-contracts/model';
import type { ExecutionCorrelationPort } from '@nextagent/agent-contracts/observability';
import type {
  AgentRunStatePort,
  HookBoundaryByStage,
  LifecycleHookInvocationPort,
  LifecycleStage,
  PendingInputIntent,
  PendingInputRequest,
  RequestContext,
  RequestRun,
  RiskPolicyEvaluator,
} from '@nextagent/agent-contracts/runtime';
import { LifecycleHookInterruptionError } from '@nextagent/agent-contracts/runtime';
import { Ajv } from 'ajv/dist/ajv.js';
import {
  authorizeCapabilityModelPatch,
  mergeGovernedCapabilityContextPatch,
  type AuthorizedCapabilityModelPatch,
} from '../model/capability-model-patch-resolver.js';
import { appendCapabilityResultMessage, buildFailedCapabilityPayload, buildModelVisibleCapabilityPayload } from './capability-result-projection.js';
import { projectClipCapabilityResultClassifierFields } from './clip-result-safe-projection.js';
import { projectWorkflowDeltaSafeFields } from './workflow-result-safe-projection.js';
import {
  emitStructuredDeltaData,
  identifyStructuredDelta,
  tryEmitStructuredDelta,
  type StructuredDeltaData,
} from './structured-delta-identification.js';
import { createWorkflowToolDeltaProjectionState, tryEmitWorkflowToolDelta } from './workflow-tool-delta-projection.js';
import { isWorkflowCapability } from './workflow-capability.js';
import { evaluateRiskPolicySafely, summarizeCapabilityOperation, toRiskPolicyError, toRiskPolicyEvaluation } from '../risk-policy/policy.js';
import { createCatalogBackedRuntimeCapabilityResolver } from './runtime-capability-resolver.js';
import {
  collectAskUserQuestionViolations,
  violationsToAskUserQuestionMessage,
  type AskUserQuestionViolation,
} from './ask-user-question-input-diagnostics.js';
import { capabilityStartedPayload, type CapabilityProcessIdentity } from './capability-lifecycle-payload.js';
import { isCapabilityStructureSafePayload, isPolicyProjectionPayload } from '../projection/timeline-safe-payload-schemas.js';
import { capabilityStructureDiagnostics } from '../projection/safe-structure-diagnostics.js';

const recoverableFailureCategories = new Set(['VALIDATION', 'CONFLICT', 'NOT_FOUND']);
const capabilityResultStatuses: ReadonlySet<string> = new Set(['SUCCEEDED', 'FAILED', 'DEGRADED', 'TIMED_OUT'] satisfies ReadonlyArray<
  CapabilityInvocationResult['status']
>);
const safeErrorCategories: ReadonlySet<string> = new Set([
  'VALIDATION',
  'AUTHORIZATION',
  'POLICY_DENIED',
  'NOT_FOUND',
  'CONFLICT',
  'UNAVAILABLE',
  'TIMEOUT',
  'CANCELED',
  'INTERNAL',
] satisfies ReadonlyArray<SafeError['category']>);
const safeErrorFields = new Set(['code', 'message', 'category', 'retryable', 'safeDetails']);
const askUserQuestionCapabilityId = 'AskUserQuestion';
const askUserQuestionProviderId = 'builtin-tools';
const askUserQuestionModelQuestionLimit = 3;
const askUserQuestionCompatibilityQuestionLimit = 20;
const askUserQuestionCountExceededReasonCode = 'ASK_USER_QUESTION_COUNT_EXCEEDED';
const askUserQuestionInputCorrectableReasonCode = 'ASK_USER_QUESTION_INPUT_CORRECTABLE';
const askUserQuestionForbiddenPurposeReasonCode = 'ASK_USER_QUESTION_FORBIDDEN_PURPOSE';
const askUserQuestionValidationMessagePrefix = 'Capability input failed validation: ';
const askUserQuestionValidationMessageLimit = 768;
const askUserQuestionInputCorrectionInstruction = [
  ' The question was not presented to the user.',
  ' No pending input was created and no user answer was received.',
  ' Options in the rejected call are unconfirmed candidates, not user selections.',
  ' Correct every listed field and call AskUserQuestion again.',
].join('');
class RiskPolicyAuthorizationControlError extends AgentError {
  constructor(error: AgentError) {
    super({
      code: error.code,
      message: error.message,
      category: error.category,
      retryable: error.retryable,
      ...(error.safeDetails === undefined ? {} : { safeDetails: error.safeDetails }),
      cause: error,
    });
    this.name = 'RiskPolicyAuthorizationControlError';
  }
}

function capabilityBatchRejectedSafeError(category: SafeError['category']): SafeError {
  return {
    code: 'CAPABILITY_BATCH_REJECTED',
    message:
      'This capability call was not executed because another call in the same batch failed pre-execution checks. Review the paired failure, then submit a corrected batch or call this capability separately.',
    category,
    retryable: false,
  };
}
const askUserQuestionValidator = new Ajv({ strict: false, allErrors: true });
const askUserQuestionForbiddenVisibleText =
  /password|credential|raw secret|secret key|api key|access token|bearer token|private key|authorization grant|oauth grant|approve protected operation|protected-operation approval|protected operation approval|high-risk confirmation|high risk confirmation|human handoff|handoff to human|escalation request|escalate to human/iu;
const defaultCapabilityTimeoutMs = 600_000;
const workspaceExtensionPolicyRejectedSummary = 'File extension is not allowed by Agent workspace policy.';
export type ToolCallList = NonNullable<ModelFinalResult['toolCalls']>;

export interface ToolCallAdmission {
  readonly admitted: ToolCallList;
  readonly requestedCount: number;
  readonly admittedCount: number;
  readonly omittedCount: number;
}

export function admitToolCalls(toolCalls: ToolCallList, maxToolCallsPerTurn: number): ToolCallAdmission {
  const admitted = toolCalls.slice(0, maxToolCallsPerTurn);
  return {
    admitted,
    requestedCount: toolCalls.length,
    admittedCount: admitted.length,
    omittedCount: toolCalls.length - admitted.length,
  };
}

export interface ToolLoopDependencies {
  readonly capabilityCatalog: CapabilityCatalog;
  readonly capabilityInvocation: CapabilityInvocationPort;
  readonly assemblyRegistry: AgentAssemblyRegistry;
  readonly lifecycleHook?: LifecycleHookInvocationPort;
  readonly riskPolicyEvaluator?: RiskPolicyEvaluator;
  readonly isSandboxExecutionReady?: () => boolean;
  readonly toolSearchSkillSearchEnabled?: boolean;
  readonly executionCorrelation?: ExecutionCorrelationPort;
}

export interface RequestLocalCapabilityState {
  readonly generatedMessages: CapabilityGeneratedMessage[];
  contextPatch?: CapabilityContextPatch;
}

const riskPolicyAuthorizationKey = 'riskPolicyAuthorization';
const logger = getLogger({ component: 'agent-core', source: 'tool-loop' });

export async function executeToolCallsInOrder(
  deps: ToolLoopDependencies,
  input: {
    run: RequestRun;
    context: RequestContext;
    runState: AgentRunStatePort;
    signal: AbortSignal;
    round: number;
    toolCalls: ToolCallList;
    requestLocalState: RequestLocalCapabilityState;
    forbiddenCapabilityIds?: ReadonlySet<string>;
    allowSubagents?: boolean;
    persistAssistantToolUse?: boolean;
    assistantToolUseMessageId?: MessageId;
    assistantContent?: string;
    attachmentPaths?: readonly string[];
  },
): Promise<PendingInputRequest | undefined> {
  const { run, context, runState, signal, round, toolCalls, requestLocalState } = input;
  if (hasEmptyToolName(toolCalls)) {
    logger.warn({
      event: 'tool.loop.empty_tool_name',
      ...toolLoopLogFields(run, round),
      toolCallCount: toolCalls.length,
      toolCalls: buildToolCallBatchLogEntries(toolCalls),
    });
    await runState.emitEvent(run, context, { type: 'DEGRADATION_NOTICE', inlinePayload: { code: 'TOOL_NAME_EMPTY' } });
    throw new AgentError({
      code: 'TOOL_NAME_EMPTY',
      message:
        'A capability call has no capability name, so the batch was not executed. Regenerate the call with an exact disclosed capability name, answer without that call, or stop and report the invalid model output.',
      category: 'VALIDATION',
      retryable: false,
    });
  }
  const assembly = await deps.assemblyRegistry.require(run.agentId, run.agentVersion);
  const capabilityResolver = createCatalogBackedRuntimeCapabilityResolver({
    catalog: deps.capabilityCatalog,
    assembly,
    tenantId: context.identityContext.tenantId,
    subjectId: context.identityContext.subjectId,
    sessionId: context.sessionId,
  });
  const assistantToolUseMessageId =
    input.persistAssistantToolUse === false
      ? input.assistantToolUseMessageId
      : await appendAssistantToolUseMessage(runState, run, context, toolCalls, input.assistantContent);
  if (assistantToolUseMessageId !== undefined && input.assistantContent !== undefined && input.assistantContent.trim().length > 0) {
    await runState.emitEvent(run, context, {
      type: 'LLM_CONTENT_DELTA',
      persistence: 'PERSISTED',
      inlinePayload: {
        messageId: assistantToolUseMessageId,
        stepId: `turn-${round + 1}`,
        completed: true,
      },
    });
  }
  const preflight = await preflightAskUserQuestionInput(deps, {
    ...input,
    assembly,
    capabilityResolver,
  });
  if (preflight.failure !== undefined) {
    throwIfPreparationControl(preflight.failure.error, signal);
    await appendRejectedToolCallBatchResults(runState, run, context, toolCalls, preflight.resolvedDescriptors, preflight.failure);
    const countExceeded = readAskUserQuestionCountExceeded(preflight.failure.error);
    const degradationCode =
      readAskUserQuestionInputCorrection(preflight.failure.error) !== undefined
        ? 'ASK_USER_QUESTION_INPUT_INVALID'
        : countExceeded !== undefined
          ? 'ASK_USER_QUESTION_COUNT_EXCEEDED'
          : preflight.failure.error.code;
    await runState.emitEvent(run, context, {
      type: 'DEGRADATION_NOTICE',
      inlinePayload: {
        code: degradationCode,
        attempt: 1,
        ...(countExceeded === undefined ? {} : { questionCount: countExceeded.questionCount, maxQuestions: countExceeded.maxQuestions }),
      },
    });
    return undefined;
  }
  const sandboxReady = deps.isSandboxExecutionReady?.() ?? true;
  return executeToolCallBatch(deps, {
    ...input,
    ...(assistantToolUseMessageId === undefined ? {} : { assistantToolUseMessageId }),
    assembly,
    capabilityResolver,
    preflightResolvedDescriptors: preflight.resolvedDescriptors,
    sandboxReady,
  });
}

interface AskUserQuestionPreflightResult {
  readonly resolvedDescriptors: ReadonlyMap<ToolCallList[number], CapabilityDescriptor | undefined>;
  readonly failure?: {
    readonly toolCall: ToolCallList[number];
    readonly error: AgentError;
  };
}

async function preflightAskUserQuestionInput(
  deps: ToolLoopDependencies,
  input: Parameters<typeof executeToolCallsInOrder>[1] & {
    readonly assembly: AgentAssembly;
    readonly capabilityResolver: RuntimeCapabilityResolver;
  },
): Promise<AskUserQuestionPreflightResult> {
  const resolvedDescriptors = new Map<ToolCallList[number], CapabilityDescriptor | undefined>();
  for (const toolCall of input.toolCalls) {
    if (!isAskUserQuestionToolName(toolCall.toolName)) {
      continue;
    }
    try {
      const descriptor = await resolveToolCallDescriptor(deps, input, toolCall);
      resolvedDescriptors.set(toolCall, descriptor);
      if (descriptor === undefined || !isCanonicalAskUserQuestionDescriptor(descriptor)) {
        throw new AgentError({
          code: 'CAPABILITY_UNAVAILABLE',
          message:
            'AskUserQuestion is unavailable in the current Agent assembly. Ask the question in a normal response, choose another available capability, or end the action.',
          category: 'UNAVAILABLE',
          retryable: false,
        });
      }
      if (!hasCanonicalAskUserQuestionCountLimit(descriptor)) {
        throw new AgentError({
          code: 'CAPABILITY_UNAVAILABLE',
          message:
            'AskUserQuestion input validation is unavailable in the current Agent assembly. Ask the question in a normal response, choose another available capability, or end the action.',
          category: 'UNAVAILABLE',
          retryable: false,
        });
      }
      const normalizedArgs = normalizeAskUserQuestionArguments(toolCall.arguments);
      const questions = normalizedArgs['questions'];
      if (Array.isArray(questions) && questions.length > askUserQuestionCompatibilityQuestionLimit) {
        throw new AgentError({
          code: 'INVALID_INPUT',
          message: `${askUserQuestionValidationMessagePrefix}Field "questions" must contain at most ${askUserQuestionModelQuestionLimit} items.`,
          category: 'VALIDATION',
          retryable: false,
          safeDetails: {
            reasonCode: askUserQuestionCountExceededReasonCode,
            questionCount: questions.length,
            maxQuestions: askUserQuestionModelQuestionLimit,
          },
        });
      }
      toAskUserQuestionPendingInputIntent(descriptor, toolCall.arguments);
    } catch (error) {
      return {
        resolvedDescriptors,
        failure: {
          toolCall,
          error:
            error instanceof AgentError
              ? error
              : new AgentError({
                  code: 'EXECUTION_FAILED',
                  message:
                    'AskUserQuestion preflight failed at the input preparation stage. Ask the question in a normal response, choose another available capability, or end and report the failure.',
                  category: 'INTERNAL',
                  retryable: false,
                }),
        },
      };
    }
  }
  return { resolvedDescriptors };
}

async function appendRejectedToolCallBatchResults(
  runState: AgentRunStatePort,
  run: RequestRun,
  context: RequestContext,
  toolCalls: ToolCallList,
  resolvedDescriptors: ReadonlyMap<ToolCallList[number], CapabilityDescriptor | undefined>,
  failure: NonNullable<AskUserQuestionPreflightResult['failure']>,
): Promise<void> {
  const failureSafeError = toAskUserQuestionPreflightSafeError(failure.error);
  for (const toolCall of toolCalls) {
    const resolvedDescriptor = resolvedDescriptors.get(toolCall);
    const isFailedAskUserQuestion = toolCall.toolCallId === failure.toolCall.toolCallId;
    const safeError = isFailedAskUserQuestion ? failureSafeError : capabilityBatchRejectedSafeError(failureSafeError.category);
    const messageId = await appendCapabilityResultMessage(
      runState,
      run,
      context,
      toolCall.toolCallId,
      toolCall.toolName,
      buildFailedCapabilityPayload({
        status: 'FAILED',
        structuredPayload: {},
        safeError,
      }),
    );
    await runState.emitEvent(run, context, {
      type: 'CAPABILITY_COMPLETED',
      inlinePayload: {
        messageId,
        ...(resolvedDescriptor === undefined ? {} : { capabilityKind: resolvedDescriptor.kind }),
        capabilityId: resolvedDescriptor?.capabilityId ?? toolCall.toolName,
        toolCallId: toolCall.toolCallId,
        status: 'FAILED',
        safeErrorCode: safeError.code,
        safeErrorCategory: safeError.category,
      },
    });
  }
}

function toAskUserQuestionPreflightSafeError(error: AgentError): SafeError {
  const isCorrectableInput = readAskUserQuestionInputCorrection(error) !== undefined || readAskUserQuestionCountExceeded(error) !== undefined;
  return {
    code: isCorrectableInput ? 'CAPABILITY_INPUT_INVALID' : error.code,
    message: error.message,
    category: error.category,
    retryable: false,
    ...(error.safeDetails === undefined ? {} : { safeDetails: error.safeDetails }),
  };
}

async function executeToolCallBatch(
  deps: ToolLoopDependencies,
  input: Parameters<typeof executeToolCallsInOrder>[1] & {
    readonly assembly: AgentAssembly;
    readonly capabilityResolver: RuntimeCapabilityResolver;
    readonly preflightResolvedDescriptors: ReadonlyMap<ToolCallList[number], CapabilityDescriptor | undefined>;
    readonly sandboxReady: boolean;
  },
): Promise<PendingInputRequest | undefined> {
  let ordinaryBatch: Array<ToolCallList[number]> = [];

  for (const toolCall of input.toolCalls) {
    if (isAskUserQuestionToolName(toolCall.toolName)) {
      if (ordinaryBatch.length > 0) {
        const pendingInput = await executeOrdinaryToolCallBatch(deps, input, ordinaryBatch);
        if (pendingInput !== undefined) {
          return pendingInput;
        }
        ordinaryBatch = [];
      }
      try {
        return await executeSingleToolCall(deps, { ...input, toolCall });
      } catch (error) {
        throwIfPreparationControl(error, input.signal);
        await appendSyntheticFailureResult(input, toolCall, error, undefined);
        return undefined;
      }
    }
    ordinaryBatch.push(toolCall);
  }

  if (ordinaryBatch.length > 0) {
    return executeOrdinaryToolCallBatch(deps, input, ordinaryBatch);
  }
  return undefined;
}

async function executeOrdinaryToolCallBatch(
  deps: ToolLoopDependencies,
  input: Parameters<typeof executeToolCallsInOrder>[1] & {
    readonly assembly: AgentAssembly;
    readonly capabilityResolver: RuntimeCapabilityResolver;
    readonly preflightResolvedDescriptors: ReadonlyMap<ToolCallList[number], CapabilityDescriptor | undefined>;
    readonly sandboxReady: boolean;
  },
  toolCalls: ToolCallList,
): Promise<PendingInputRequest | undefined> {
  const preparedToolCalls: PreparedOrdinaryToolCall[] = [];
  let preparationFailure:
    | {
        readonly toolCall: ToolCallList[number];
        readonly error: unknown;
        readonly toolBatchLogContext?: ToolBatchLogContext | undefined;
      }
    | undefined;
  for (const [index, toolCall] of toolCalls.entries()) {
    const toolBatchLogContext = createToolBatchLogContext(index, toolCalls.length);
    let prepared: PreparedToolCall;
    try {
      prepared = await prepareToolCall(deps, {
        ...input,
        toolCall,
        ...(toolBatchLogContext === undefined ? {} : { toolBatchLogContext }),
      });
    } catch (error) {
      throwIfPreparationControl(error, input.signal);
      preparationFailure = { toolCall, error, toolBatchLogContext };
      break;
    }
    if (prepared.kind === 'PENDING_INPUT') {
      return prepared.pendingInput;
    }
    preparedToolCalls.push(prepared);
  }

  if (preparationFailure !== undefined) {
    const preparationSafeError = toSyntheticFailureSafeError(preparationFailure.error);
    for (const [index, toolCall] of toolCalls.entries()) {
      const isFailedCall = toolCall.toolCallId === preparationFailure.toolCall.toolCallId;
      const error = isFailedCall ? preparationFailure.error : new AgentError(capabilityBatchRejectedSafeError(preparationSafeError.category));
      await appendSyntheticFailureResult(input, toolCall, error, createToolBatchLogContext(index, toolCalls.length));
    }
    return undefined;
  }

  const toolBatchExecutionMode =
    preparedToolCalls.length <= 1
      ? undefined
      : requiresRequestLocalToolSerialization(preparedToolCalls)
        ? ('SERIAL' as const)
        : ('PARALLEL' as const);
  if (toolBatchExecutionMode !== 'PARALLEL') {
    for (const preparedToolCall of preparedToolCalls) {
      await invokePreparedToolCall(deps, { ...input, preparedToolCall, ...(toolBatchExecutionMode === undefined ? {} : { toolBatchExecutionMode }) });
    }
    return undefined;
  }

  const finalizeTurns = createOrderedFinalizerTurns(preparedToolCalls.length);
  const results = await Promise.allSettled(
    preparedToolCalls.map((preparedToolCall, index) => {
      const finalizeTurn = finalizeTurns[index]!;
      return invokePreparedToolCall(deps, {
        ...input,
        preparedToolCall,
        toolBatchExecutionMode,
        acquireFinalizeTurn: finalizeTurn.acquire,
      }).finally(finalizeTurn.skip);
    }),
  );
  const firstRejected = results.find((result): result is PromiseRejectedResult => result.status === 'rejected');
  if (firstRejected !== undefined) {
    throw firstRejected.reason;
  }
  return undefined;
}

async function appendSyntheticFailureResult(
  input: Parameters<typeof executeToolCallsInOrder>[1] & {
    readonly assembly: AgentAssembly;
    readonly capabilityResolver: RuntimeCapabilityResolver;
    readonly preflightResolvedDescriptors: ReadonlyMap<ToolCallList[number], CapabilityDescriptor | undefined>;
    readonly sandboxReady: boolean;
  },
  toolCall: ToolCallList[number],
  error: unknown,
  toolBatchLogContext?: ToolBatchLogContext,
): Promise<void> {
  const { run, context, runState, round } = input;
  const capabilityId = brand<string, 'CapabilityId'>(toolCall.toolName);
  const safeError = toSyntheticFailureSafeError(error);
  logger.error({
    err: error,
    event: 'tool.call.failed',
    ...toolCallLogFields(run, round, toolCall.toolCallId, toolCall.toolName, capabilityId, toolBatchLogContext),
    safeErrorCode: safeError.code,
    safeErrorCategory: safeError.category,
    safeErrorSummary: safeError.message,
  });
  const payload = buildFailedCapabilityPayload({ status: 'FAILED', structuredPayload: {}, safeError });
  const messageId = await appendCapabilityResultMessage(runState, run, context, toolCall.toolCallId, toolCall.toolName, payload);
  await runState.emitEvent(run, context, {
    type: 'CAPABILITY_COMPLETED',
    inlinePayload: {
      messageId,
      capabilityId,
      toolCallId: toolCall.toolCallId,
      status: 'FAILED',
      safeErrorCode: safeError.code,
      safeErrorCategory: safeError.category,
    },
  });
  await runState.emitEvent(run, context, {
    type: 'DEGRADATION_NOTICE',
    inlinePayload: { code: safeError.code },
  });
}

function toSyntheticFailureSafeError(error: unknown): SafeError {
  return error instanceof AgentError
    ? {
        code: error.code,
        message: error.message,
        category: error.category,
        retryable: error.retryable,
        ...(error.safeDetails === undefined ? {} : { safeDetails: error.safeDetails }),
      }
    : {
        code: 'CAPABILITY_EXECUTION_FAILED',
        message:
          'Capability preparation failed unexpectedly before execution. Choose another available capability, provide a safe response without this operation, or end and report the failure.',
        category: 'INTERNAL',
        retryable: false,
      };
}

function throwIfPreparationControl(error: unknown, signal: AbortSignal): void {
  if (signal.aborted && !(error instanceof AgentError && error.category === 'CANCELED')) {
    throw new AgentError({
      code: 'ABORTED',
      message: 'Capability preparation was canceled.',
      category: 'CANCELED',
      retryable: false,
      cause: error,
    });
  }
  if (
    error instanceof LifecycleHookInterruptionError ||
    error instanceof RiskPolicyAuthorizationControlError ||
    (error instanceof AgentError && error.category === 'CANCELED')
  ) {
    throw error;
  }
}

interface OrderedFinalizerTurn {
  acquire: () => Promise<() => void>;
  skip: () => void;
}

interface PreparedOrdinaryToolCall {
  readonly kind: 'ORDINARY';
  readonly capabilityId: CapabilityId;
  readonly descriptor: CapabilityDescriptor;
  readonly toolCall: ToolCallList[number];
  readonly effectiveArguments: JsonObject;
  readonly effectiveTimeoutMs: number;
  readonly processIdentity: CapabilityProcessIdentity;
  readonly toolBatchLogContext?: ToolBatchLogContext | undefined;
}

interface PreparedPendingInputToolCall {
  readonly kind: 'PENDING_INPUT';
  readonly pendingInput: PendingInputRequest;
}

type PreparedToolCall = PreparedOrdinaryToolCall | PreparedPendingInputToolCall;

interface ToolBatchLogContext {
  readonly toolBatchOrdinal: number;
  readonly toolBatchSize: number;
}

type ToolBatchExecutionMode = 'PARALLEL' | 'SERIAL';

function createToolBatchLogContext(index: number, size: number): ToolBatchLogContext | undefined {
  if (size <= 1) {
    return undefined;
  }
  return { toolBatchOrdinal: index + 1, toolBatchSize: size };
}

function createOrderedFinalizerTurns(count: number): OrderedFinalizerTurn[] {
  const resolvers: Array<() => void> = Array.from({ length: count }, () => () => {});
  const turns = Array.from(
    { length: count },
    (_, index) =>
      new Promise<void>((resolve) => {
        resolvers[index] = resolve;
      }),
  );
  resolvers[0]?.();
  return turns.map((turn, index) => {
    let acquired = false;
    let released = false;
    const release = (): void => {
      if (!released) {
        released = true;
        resolvers[index + 1]?.();
      }
    };
    return {
      async acquire() {
        await turn;
        acquired = true;
        return release;
      },
      skip() {
        if (!acquired) {
          release();
        }
      },
    };
  });
}

async function executeSingleToolCall(
  deps: ToolLoopDependencies,
  input: Parameters<typeof executeToolCallsInOrder>[1] & {
    readonly assembly: AgentAssembly;
    readonly capabilityResolver: RuntimeCapabilityResolver;
    readonly preflightResolvedDescriptors: ReadonlyMap<ToolCallList[number], CapabilityDescriptor | undefined>;
    readonly sandboxReady: boolean;
    readonly toolCall: ToolCallList[number];
    readonly acquireFinalizeTurn?: () => Promise<() => void>;
  },
): Promise<PendingInputRequest | undefined> {
  const prepared = await prepareToolCall(deps, input);
  if (prepared.kind === 'PENDING_INPUT') {
    return prepared.pendingInput;
  }
  await invokePreparedToolCall(deps, { ...input, preparedToolCall: prepared });
  return undefined;
}

async function prepareToolCall(
  deps: ToolLoopDependencies,
  input: Parameters<typeof executeToolCallsInOrder>[1] & {
    readonly assembly: AgentAssembly;
    readonly capabilityResolver: RuntimeCapabilityResolver;
    readonly preflightResolvedDescriptors: ReadonlyMap<ToolCallList[number], CapabilityDescriptor | undefined>;
    readonly sandboxReady: boolean;
    readonly toolCall: ToolCallList[number];
    readonly toolBatchLogContext?: ToolBatchLogContext | undefined;
  },
): Promise<PreparedToolCall> {
  const { run, context, runState, signal, round, assembly, sandboxReady, toolCall } = input;
  const capabilityId = brand<string, 'CapabilityId'>(toolCall.toolName);
  if (input.forbiddenCapabilityIds?.has(capabilityId)) {
    throw new AgentError({
      code: 'CAPABILITY_FORBIDDEN_BY_ROUTING_CONSTRAINT',
      message:
        'This capability is not allowed by the current routing constraints. Choose a capability disclosed in the current route, handle the task without this call, or end the action.',
      category: 'VALIDATION',
      retryable: false,
    });
  }
  const replayAttempt = isRecoveredPendingToolCall(context, toolCall.toolCallId);
  const authorization = currentRunAuthorization(context.flowVariables);
  const descriptor = input.preflightResolvedDescriptors.has(toolCall)
    ? input.preflightResolvedDescriptors.get(toolCall)
    : await resolveToolCallDescriptor(deps, input, toolCall);
  if (descriptor === undefined) {
    if (deps.riskPolicyEvaluator !== undefined) {
      const policyInput = buildRiskPolicyEvaluationInput(
        run,
        context,
        {
          capabilityId,
          toolCallId: toolCall.toolCallId,
          arguments: toolCall.arguments,
          sandboxReady,
          observabilityReady: true,
          replayAttempt,
          ...(authorization === undefined ? {} : { currentRunAuthorizationOperationId: authorization.operationId }),
        },
        false,
      );
      const policyDecision = await evaluateRiskPolicySafely(deps.riskPolicyEvaluator, policyInput, signal);
      const policyEvaluation = toRiskPolicyEvaluation(policyInput, policyDecision);
      await emitPolicyApplied(runState, run, context, policyEvaluation);
      if (policyDecision.outcome !== 'ALLOW') {
        throw toPreparationRiskPolicyError(policyDecision, policyEvaluation);
      }
    }
    throw new AgentError({
      code: 'CAPABILITY_UNAVAILABLE',
      message:
        'This capability is unavailable in the current Agent assembly. Choose another disclosed capability, handle the task without this call, or end the action.',
      category: 'UNAVAILABLE',
      retryable: false,
    });
  }
  if (input.allowSubagents === false && descriptor.kind === 'AGENT') {
    throw new AgentError({
      code: 'SUBAGENT_FORBIDDEN_BY_ROUTING_CONSTRAINT',
      message:
        'Subagent invocation is not allowed by the current routing constraints. Use an allowed Tool or Skill, handle the task directly, or end the action.',
      category: 'VALIDATION',
      retryable: false,
    });
  }
  if (isAskUserQuestionToolName(toolCall.toolName) && !isCanonicalAskUserQuestionDescriptor(descriptor)) {
    throw new AgentError({
      code: 'CAPABILITY_UNAVAILABLE',
      message:
        'AskUserQuestion is unavailable in the current Agent assembly. Ask the question in a normal response, choose another available capability, or end the action.',
      category: 'UNAVAILABLE',
      retryable: false,
    });
  }
  if (isCanonicalAskUserQuestionDescriptor(descriptor)) {
    try {
      return {
        kind: 'PENDING_INPUT',
        pendingInput: await requestAskUserQuestionPendingInput({
          runState,
          run,
          context,
          descriptor,
          toolCall,
          signal,
        }),
      };
    } catch (error) {
      const safe = normalizeAskUserQuestionProducerError(error, signal);
      if (safe.category === 'CANCELED') {
        await runState.emitEvent(run, context, { type: 'DEGRADATION_NOTICE', inlinePayload: { code: safe.code } });
      }
      throw safe;
    }
  }
  const beforeCapability = await invokeLifecycleHook(
    deps.lifecycleHook,
    run,
    context,
    'BEFORE_CAPABILITY_INVOKE',
    {
      capabilityId,
      capabilityKind: descriptor.kind,
      providerKind: descriptor.provider.providerKind,
      toolCallId: toolCall.toolCallId,
      safeInputSummary: buildRuntimeToolInputPreview(capabilityId, toolCall.arguments),
      arguments: toolCall.arguments,
      timeoutMs: defaultCapabilityTimeoutMs,
      ...pendingHookResumeBoundary(context, 'BEFORE_CAPABILITY_INVOKE'),
    },
    signal,
    `round:${input.round}:tool:${toolCall.toolCallId}:before`,
  );
  const effectiveArguments = beforeCapability.arguments ?? toolCall.arguments;
  const effectiveTimeoutMs = beforeCapability.timeoutMs ?? defaultCapabilityTimeoutMs;
  await runState.saveCheckpoint(run, context, 'CAPABILITY_BEFORE_CALL');
  if (deps.riskPolicyEvaluator !== undefined) {
    const policyInput = buildRiskPolicyEvaluationInput(
      run,
      context,
      {
        descriptor,
        toolCallId: toolCall.toolCallId,
        arguments: effectiveArguments,
        sandboxReady,
        observabilityReady: true,
        replayAttempt,
        ...(authorization === undefined ? {} : { currentRunAuthorizationOperationId: authorization.operationId }),
      },
      true,
    );
    const policyDecision = await evaluateRiskPolicySafely(deps.riskPolicyEvaluator, policyInput, signal);
    const policyEvaluation = toRiskPolicyEvaluation(policyInput, policyDecision);
    await emitPolicyApplied(runState, run, context, policyEvaluation);
    if (policyDecision.outcome !== 'ALLOW') {
      throw toPreparationRiskPolicyError(policyDecision, policyEvaluation);
    }
  }
  return {
    kind: 'ORDINARY',
    capabilityId,
    descriptor,
    toolCall,
    effectiveArguments,
    effectiveTimeoutMs,
    processIdentity: buildCapabilityProcessIdentity(descriptor, effectiveArguments),
    ...(input.toolBatchLogContext === undefined ? {} : { toolBatchLogContext: input.toolBatchLogContext }),
  };
}

async function resolveToolCallDescriptor(
  deps: ToolLoopDependencies,
  input: {
    readonly context: RequestContext;
    readonly assembly: AgentAssembly;
    readonly capabilityResolver: RuntimeCapabilityResolver;
    readonly signal: AbortSignal;
  },
  toolCall: ToolCallList[number],
): Promise<CapabilityDescriptor | undefined> {
  const capabilityId = brand<string, 'CapabilityId'>(toolCall.toolName);
  return (
    (await deps.capabilityCatalog.resolve({
      tenantId: input.context.identityContext.tenantId,
      subjectId: input.context.identityContext.subjectId,
      agentAssembly: input.assembly,
      capabilityId,
    })) ?? (await input.capabilityResolver.resolveCapability({ kind: 'TOOL', capabilityId }, input.signal))
  );
}

type PreparedToolCallExecutionInput = Parameters<typeof executeToolCallsInOrder>[1] & {
  readonly assembly: AgentAssembly;
  readonly capabilityResolver: RuntimeCapabilityResolver;
  readonly sandboxReady: boolean;
  readonly preparedToolCall: PreparedOrdinaryToolCall;
  readonly toolBatchExecutionMode?: ToolBatchExecutionMode;
  readonly acquireFinalizeTurn?: () => Promise<() => void>;
};

async function invokePreparedToolCall(deps: ToolLoopDependencies, input: PreparedToolCallExecutionInput): Promise<void> {
  const { run, context, runState, round, preparedToolCall } = input;
  const { capabilityId, descriptor, toolCall, effectiveArguments, effectiveTimeoutMs, processIdentity } = preparedToolCall;
  const capabilityStartedAt = performance.now();
  const isWorkflow = isWorkflowCapability(descriptor);
  await runState.emitEvent(run, context, {
    type: 'CAPABILITY_STARTED',
    inlinePayload: capabilityStartedPayload({
      processIdentity,
      toolCallId: toolCall.toolCallId,
      stepId: `turn-${round + 1}`,
      ...(input.assistantToolUseMessageId === undefined ? {} : { messageId: input.assistantToolUseMessageId }),
      ...(preparedToolCall.toolBatchLogContext === undefined || input.toolBatchExecutionMode === undefined
        ? {}
        : {
            toolBatch: {
              executionMode: input.toolBatchExecutionMode,
              ordinal: preparedToolCall.toolBatchLogContext.toolBatchOrdinal,
              size: preparedToolCall.toolBatchLogContext.toolBatchSize,
            },
          }),
    }),
  });
  const execute = () => invokePreparedToolCallCorrelated(deps, input, capabilityStartedAt, isWorkflow);
  return deps.executionCorrelation === undefined
    ? execute()
    : deps.executionCorrelation.withExecutionRef(
        {
          requestRunId: run.runId,
          kind: 'CAPABILITY',
          executionId: toolCall.toolCallId,
        },
        execute,
      );
}

async function invokePreparedToolCallCorrelated(
  deps: ToolLoopDependencies,
  input: PreparedToolCallExecutionInput,
  capabilityStartedAt: number,
  isWorkflow: boolean,
): Promise<void> {
  const { run, context, runState, signal, round, requestLocalState, assembly, capabilityResolver, preparedToolCall } = input;
  const { capabilityId, descriptor, toolCall, effectiveArguments, effectiveTimeoutMs, processIdentity } = preparedToolCall;
  let result: CapabilityInvocationResult;
  let invokeDurationMs = 0;
  const workflowToolDeltaProjectionState = createWorkflowToolDeltaProjectionState();
  const isBashCapability = descriptor.capabilityId === bashCapabilityId;
  let structuredDeltaEmittedDuringExecution = false;
  let bashResultDeltaEmittedDuringExecution = false;
  try {
    const invokeCapability = () =>
      deps.capabilityInvocation.invoke(
        {
          invocationId: `${run.runId}:${toolCall.toolCallId}`,
          capabilityId: descriptor.capabilityId,
          resolvedDescriptor: descriptor,
          toolCallId: toolCall.toolCallId,
          arguments: effectiveArguments,
          sessionId: run.sessionId,
          requestId: run.requestId,
          runId: run.runId,
          requestContextId: context.requestContextId,
          stepId: `turn-${round + 1}`,
          identityContext: context.identityContext,
          locale: context.locale,
          agentId: run.agentId,
          agentVersion: run.agentVersion,
          timeoutMs: effectiveTimeoutMs,
          idempotencyKey: deriveCapabilityInvocationIdempotencyKey(run.runId, toolCall.toolCallId),
        },
        signal,
        {
          capabilityResolver,
          emitPolicyApplied: async (payload) => {
            const inlinePayload = policyAppliedTimelinePayload({
              operationKind: payload.operationKind,
              operationId: payload.operationId,
              outcome: payload.outcome,
              reasonCode: payload.reasonCode,
              policyId: 'capability-risk-policy',
              policyVersion: 'v1',
              policyDomain: 'CAPABILITY_RISK',
              policyPoint: payload.operationKind,
              ...(payload.capabilityId === undefined ? {} : { capabilityId: payload.capabilityId }),
              ...(payload.toolCallId === undefined ? {} : { toolCallId: payload.toolCallId }),
              riskLevel: payload.riskLevel,
            });
            await runState.emitEvent(run, context, {
              type: 'POLICY_APPLIED',
              inlinePayload,
            });
          },
          emitResultDelta: async (payload) => {
            if (isBashCapability) {
              bashResultDeltaEmittedDuringExecution = true;
            }
            const structuredPayload = payload.structuredPayload ?? {};
            // Unwrap nested structuredPayload envelope from executor bridge so
            // tryEmitStructuredDelta receives the inner event object, not the wrapper.
            const sdiCandidate = (structuredPayload?.['structuredPayload'] ?? structuredPayload) as JsonObject;
            logger.info({
              event: 'tool_loop.streaming.bridge',
              capabilityId: descriptor.capabilityId,
              structuredPayloadKeys: Object.keys(structuredPayload),
            });
            if (
              await tryEmitWorkflowToolDelta({
                runState,
                run,
                context,
                descriptor,
                toolCallId: toolCall.toolCallId,
                structuredPayload: sdiCandidate,
                state: workflowToolDeltaProjectionState,
              })
            ) {
              return;
            }
            if (await tryEmitStructuredDelta(runState, run, context, descriptor.capabilityId, toolCall.toolCallId, sdiCandidate, true)) {
              structuredDeltaEmittedDuringExecution = true;
              logger.info({
                event: 'tool_loop.streaming.structured_delta_emitted',
                capabilityId: descriptor.capabilityId,
              });
              return;
            }
            const safeProjection = {
              ...projectClipCapabilityResultClassifierFields(descriptor),
              ...projectWorkflowDeltaSafeFields(descriptor, sdiCandidate),
            };
            await runState.emitEvent(run, context, {
              type: 'CAPABILITY_RESULT_DELTA',
              inlinePayload: {
                capabilityId: descriptor.capabilityId,
                toolCallId: toolCall.toolCallId,
                result: sdiCandidate,
                ...safeProjection,
              },
            });
          },
          ...(deps.toolSearchSkillSearchEnabled === true ? { toolSearchSkillSearchEnabled: true } : {}),
          ...(requestLocalState.contextPatch?.discoveredSkills === undefined
            ? {}
            : { discoveredSkills: requestLocalState.contextPatch.discoveredSkills }),
          ...(input.attachmentPaths === undefined ? {} : { attachmentPaths: input.attachmentPaths }),
          flowVariables: context.flowVariables,
        },
      );
    result =
      deps.executionCorrelation === undefined
        ? await invokeCapability()
        : await deps.executionCorrelation.withExecutionRef(
            {
              requestRunId: run.runId,
              kind: 'CAPABILITY',
              executionId: toolCall.toolCallId,
            },
            invokeCapability,
          );
    invokeDurationMs = durationMs(capabilityStartedAt);
  } catch (error) {
    const invocationError = toCapabilityInvocationAgentError(error, signal);
    const safe = normalizeCapabilityInvocationError(invocationError);
    const rawExceptionData = runtimeRawExceptionData(error);
    invokeDurationMs = durationMs(capabilityStartedAt);
    logger.error({
      err: error,
      ...(rawExceptionData === undefined ? {} : { rawExceptionData }),
      event: 'tool.call.failed',
      ...toolCallLogFields(run, round, toolCall.toolCallId, toolCall.toolName, capabilityId, preparedToolCall.toolBatchLogContext),
      ...runtimeToolInputLogFields(capabilityId, effectiveArguments),
      safeErrorCode: safe.code,
      safeErrorCategory: safe.category,
      safeErrorSummary: safe.message,
    });
    if (safe.category === 'CANCELED') {
      await runState.emitEvent(run, context, {
        type: 'CAPABILITY_COMPLETED',
        inlinePayload: {
          ...processIdentity,
          toolCallId: toolCall.toolCallId,
          status: safe.status,
          durationMs: invokeDurationMs,
          safeErrorCode: safe.code,
          safeErrorCategory: safe.category,
          ...safeToolObservationFields(descriptor, effectiveArguments, undefined),
        },
      });
      await runState.emitEvent(run, context, { type: 'DEGRADATION_NOTICE', inlinePayload: { code: safe.code } });
      throw invocationError;
    }
    result = {
      status: safe.status,
      structuredPayload: {},
      generatedMessages: [],
      artifactRefs: [],
      safeError: {
        code: safe.code,
        message: safe.message,
        category: safe.category,
        retryable: safe.retryable,
        ...(safe.safeDetails === undefined ? {} : { safeDetails: safe.safeDetails }),
      },
    };
  }
  try {
    assertCapabilityResultSafe(result);
  } catch (error) {
    const safe = normalizeCapabilityInvocationError(error);
    const rawExceptionData = runtimeRawExceptionData(error);
    logger.error({
      err: error,
      ...(rawExceptionData === undefined ? {} : { rawExceptionData }),
      event: 'tool.call.result_invalid',
      ...toolCallLogFields(run, round, toolCall.toolCallId, toolCall.toolName, capabilityId, preparedToolCall.toolBatchLogContext),
      ...runtimeToolInputLogFields(capabilityId, effectiveArguments),
      safeErrorCode: safe.code,
      safeErrorCategory: safe.category,
      safeErrorSummary: safe.message,
    });
    if (safe.category === 'CANCELED') {
      await runState.emitEvent(run, context, {
        type: 'CAPABILITY_COMPLETED',
        inlinePayload: {
          ...processIdentity,
          toolCallId: toolCall.toolCallId,
          status: safe.status,
          durationMs: durationMs(capabilityStartedAt),
          safeErrorCode: safe.code,
          safeErrorCategory: safe.category,
          ...safeToolObservationFields(descriptor, effectiveArguments, undefined),
        },
      });
      await runState.emitEvent(run, context, { type: 'DEGRADATION_NOTICE', inlinePayload: { code: safe.code } });
      throw error;
    }
    result = {
      status: safe.status,
      structuredPayload: {},
      generatedMessages: [],
      artifactRefs: [],
      safeError: {
        code: safe.code,
        message: safe.message,
        category: safe.category,
        retryable: safe.retryable,
        ...(safe.safeDetails === undefined ? {} : { safeDetails: safe.safeDetails }),
      },
    };
  }
  let authorizedModelPatch: AuthorizedCapabilityModelPatch | undefined;
  if (result.status !== 'FAILED' && result.status !== 'TIMED_OUT') {
    try {
      await assertCapabilityAllowedToolsAuthorized(result.contextPatch, capabilityResolver, signal);
      authorizedModelPatch = authorizeCapabilityModelPatch(descriptor, result.contextPatch, assembly);
    } catch (error) {
      const resultExtensionError = toCapabilityInvocationAgentError(error, signal);
      const safe = normalizeCapabilityInvocationError(resultExtensionError);
      const rawExceptionData = runtimeRawExceptionData(error);
      logger.error({
        err: error,
        ...(rawExceptionData === undefined ? {} : { rawExceptionData }),
        event: 'tool.call.result_extension_denied',
        ...toolCallLogFields(run, round, toolCall.toolCallId, toolCall.toolName, capabilityId, preparedToolCall.toolBatchLogContext),
        ...runtimeToolInputLogFields(capabilityId, effectiveArguments),
        safeErrorCode: safe.code,
        safeErrorCategory: safe.category,
        safeErrorSummary: safe.message,
      });
      if (safe.category === 'CANCELED') {
        await runState.emitEvent(run, context, {
          type: 'CAPABILITY_COMPLETED',
          inlinePayload: {
            ...processIdentity,
            toolCallId: toolCall.toolCallId,
            status: safe.status,
            durationMs: durationMs(capabilityStartedAt),
            safeErrorCode: safe.code,
            safeErrorCategory: safe.category,
            ...safeToolObservationFields(descriptor, effectiveArguments, undefined),
          },
        });
        await runState.emitEvent(run, context, { type: 'DEGRADATION_NOTICE', inlinePayload: { code: safe.code } });
        throw resultExtensionError;
      }
      result = {
        status: safe.status,
        structuredPayload: {},
        generatedMessages: [],
        artifactRefs: [],
        safeError: {
          code: safe.code,
          message: safe.message,
          category: safe.category,
          retryable: safe.retryable,
          ...(safe.safeDetails === undefined ? {} : { safeDetails: safe.safeDetails }),
        },
      };
    }
  }
  let releaseFinalize: (() => void) | undefined;
  let finalizeWaitMs: number | undefined;
  if (input.acquireFinalizeTurn !== undefined) {
    const finalizeWaitStartedAt = performance.now();
    releaseFinalize = await input.acquireFinalizeTurn();
    finalizeWaitMs = durationMs(finalizeWaitStartedAt);
  }
  const completionTimingFields = {
    invokeDurationMs,
    ...(finalizeWaitMs === undefined ? {} : { finalizeWaitMs }),
  };
  try {
    if (result.status === 'FAILED' || result.status === 'TIMED_OUT') {
      const failedLogFields = {
        event: 'tool.call.failed',
        ...toolCallLogFields(run, round, toolCall.toolCallId, toolCall.toolName, capabilityId, preparedToolCall.toolBatchLogContext),
        ...runtimeToolInputLogFields(capabilityId, effectiveArguments),
        ...runtimeToolOutputLogFields(result),
        safeErrorCode: result.safeError?.code ?? 'CAPABILITY_FAILED',
        safeErrorCategory: result.safeError?.category ?? 'UNAVAILABLE',
        safeErrorSummary: result.safeError?.message ?? fallbackCapabilityFailureMessage(result.status),
      };
      if (result.status === 'TIMED_OUT') {
        logger.warn(failedLogFields);
      } else {
        logger.error(failedLogFields);
      }
      const capabilityResultMessageId = await appendCapabilityResultMessage(
        runState,
        run,
        context,
        toolCall.toolCallId,
        toolCall.toolName,
        buildFailedCapabilityPayload({
          status: result.status,
          structuredPayload: result.structuredPayload,
          ...(result.safeError === undefined ? {} : { safeError: result.safeError }),
          ...(result.resultRef === undefined ? {} : { resultRef: result.resultRef }),
          ...(result.artifactRefs.length === 0 ? {} : { artifactRefs: result.artifactRefs }),
        }),
      );
      if (isWorkflow && result.status === 'TIMED_OUT') {
        await runState.emitEvent(run, context, {
          type: 'CAPABILITY_RESULT_DELTA',
          inlinePayload: {
            capabilityId: descriptor.capabilityId,
            toolCallId: toolCall.toolCallId,
            status: result.status,
            result: result.structuredPayload,
            safeErrorCode: result.safeError?.code ?? 'CAPABILITY_FAILED',
            safeErrorCategory: result.safeError?.category ?? 'UNAVAILABLE',
          },
        });
      }
      logger.info({
        event: 'tool.failure_feedback.appended',
        ...toolCallLogFields(run, round, toolCall.toolCallId, toolCall.toolName, capabilityId, preparedToolCall.toolBatchLogContext),
        status: result.status,
        safeErrorCode: result.safeError?.code ?? 'CAPABILITY_FAILED',
        safeErrorCategory: result.safeError?.category ?? 'UNAVAILABLE',
        safeErrorSummary: result.safeError?.message ?? fallbackCapabilityFailureMessage(result.status),
        retryable: result.safeError?.retryable ?? false,
        feedbackMessageKind: 'CAPABILITY_RESULT',
      });
      if (
        (capabilityId === 'Write' || capabilityId === 'Edit') &&
        result.safeError?.code === 'CAPABILITY_PATH_REJECTED' &&
        result.safeError.retryable === true
      ) {
        await runState.emitEvent(run, context, {
          type: 'CAPABILITY_RESULT_DELTA',
          inlinePayload: {
            capabilityId: descriptor.capabilityId,
            toolCallId: toolCall.toolCallId,
            status: result.status,
            safeErrorCode: result.safeError.code,
            safeErrorCategory: result.safeError.category,
            safeSummary: workspaceExtensionPolicyRejectedSummary,
          },
        });
      }
      await runState.emitEvent(run, context, {
        type: 'CAPABILITY_COMPLETED',
        inlinePayload: {
          messageId: capabilityResultMessageId,
          ...processIdentity,
          toolCallId: toolCall.toolCallId,
          status: result.status,
          durationMs: durationMs(capabilityStartedAt),
          safeErrorCode: result.safeError?.code ?? 'CAPABILITY_FAILED',
          safeErrorCategory: result.safeError?.category ?? 'UNAVAILABLE',
          ...((capabilityId === 'Write' || capabilityId === 'Edit') &&
          result.safeError?.code === 'CAPABILITY_PATH_REJECTED' &&
          result.safeError.retryable === true
            ? { safeSummary: workspaceExtensionPolicyRejectedSummary }
            : {}),
          ...safeToolObservationFields(descriptor, effectiveArguments, result),
        },
      });
      await runState.emitEvent(run, context, {
        type: 'DEGRADATION_NOTICE',
        inlinePayload: { code: result.safeError?.code ?? 'CAPABILITY_FAILED' },
      });
      if (shouldTerminateCapabilityFailure(result)) {
        throw toCapabilityFailureError(result);
      }
      return;
    }
    if (result.status === 'DEGRADED') {
      await runState.emitEvent(run, context, {
        type: 'DEGRADATION_NOTICE',
        inlinePayload: { code: result.safeError?.code ?? 'CAPABILITY_DEGRADED' },
      });
    }
    const afterCapability = await invokeLifecycleHook(
      deps.lifecycleHook,
      run,
      context,
      'AFTER_CAPABILITY_RESULT',
      {
        capabilityId: descriptor.capabilityId,
        capabilityInvocationId: `${run.runId}:${toolCall.toolCallId}`,
        arguments: effectiveArguments,
        status: result.status,
        safeResultSummary: buildCapabilityResultSafeSummary(capabilityId, result.structuredPayload, result.metadata),
        generatedMessageCount: result.generatedMessages.length,
        artifactCount: result.artifactRefs.length,
        structuredPayload: result.structuredPayload,
        generatedMessages: result.generatedMessages as unknown as readonly JsonObject[],
        ...(result.contextPatch === undefined ? {} : { contextPatch: result.contextPatch as unknown as JsonObject }),
      },
      signal,
      `round:${round}:tool:${toolCall.toolCallId}:after`,
    );
    if (afterCapability.safeResultSummary.length === 0) {
      result = { ...result, generatedMessages: [] };
    }
    const effectiveContextPatch =
      afterCapability.contextPatch !== undefined
        ? (afterCapability.contextPatch as unknown as CapabilityInvocationResult['contextPatch'])
        : result.contextPatch;
    result = {
      ...result,
      structuredPayload: afterCapability.structuredPayload ?? result.structuredPayload,
      generatedMessages:
        afterCapability.generatedMessages !== undefined
          ? (afterCapability.generatedMessages as unknown as CapabilityInvocationResult['generatedMessages'])
          : result.generatedMessages,
      ...(effectiveContextPatch === undefined ? {} : { contextPatch: effectiveContextPatch }),
    };
    // Extract an agentic Skill body out of `result.generatedMessages` now (so
    // `applyRequestLocalResultEffects` below cannot also push it into the
    // request-local volatile state, which is re-fed to the renderer every round
    // and would duplicate the persisted message). The body is persisted as a
    // dedicated page-hidden USER message (`modelVisibility.included`) AFTER the
    // tool-result is appended below, so its sequence ordinal lands right after
    // the tool-result (ASSISTANT call -> TOOL result -> USER skill body), not
    // before it. This is the consume-once contract: extract+clear here, persist
    // after appendCapabilityResultMessage.
    const extractedSkillBody = extractSkillBody(capabilityId, result, runState.appendGeneratedUserMessage !== undefined);
    if (extractedSkillBody !== undefined) {
      result = { ...result, generatedMessages: extractedSkillBody.remaining };
    }
    applyRequestLocalResultEffects(requestLocalState, {
      capabilityId,
      authorizedModelPatch,
      result,
      run,
      context,
    });
    if (!structuredDeltaEmittedDuringExecution) {
      await tryEmitToolStructuredDelta(runState, run, context, descriptor, toolCall.toolCallId, result.structuredPayload);
    } else {
      logger.info({
        event: 'tool_loop.streaming.structured_delta_skipped',
        capabilityId: descriptor.capabilityId,
        reason: 'already_emitted_during_execution',
      });
    }
    const payload = buildModelVisibleCapabilityPayload(result);
    const capabilityResultMessageId = await appendCapabilityResultMessage(runState, run, context, toolCall.toolCallId, toolCall.toolName, payload);
    // Persist the extracted Skill body as a page-hidden USER message
    // (`modelVisibility.included`) AFTER the tool-result, so its sequence
    // ordinal lands right after the tool-result pair (ASSISTANT call ->
    // TOOL result -> USER skill body) — the model-visible instructions sit
    // immediately after the Skill load result, in a fixed position.
    if (extractedSkillBody !== undefined) {
      await persistExtractedSkillBody(runState, run, context, extractedSkillBody.body, extractedSkillBody.skillName);
    }
    logger.info({
      event: 'tool.payload.captured',
      ...toolCallLogFields(run, round, toolCall.toolCallId, toolCall.toolName, capabilityId, preparedToolCall.toolBatchLogContext),
      status: result.status,
      ...runtimeToolInputLogFields(capabilityId, effectiveArguments),
      ...runtimeToolOutputLogFields(result),
    });
    if (capabilityId === 'TodoWrite' && result.status === 'SUCCEEDED') {
      await runState.saveCheckpoint(run, context, 'CAPABILITY_AFTER_RETURN');
    }
    // Workflow node events remain inner process facts. The outer model-loop
    // invocation still publishes its ordinary result and Message reference.
    // Bash streaming has already delivered per-frame result deltas, so it does
    // not repeat the same result as a terminal delta.
    if (!isBashCapability || !bashResultDeltaEmittedDuringExecution) {
      await runState.emitEvent(run, context, {
        type: 'CAPABILITY_RESULT_DELTA',
        inlinePayload: {
          capabilityId: descriptor.capabilityId,
          toolCallId: toolCall.toolCallId,
          result: result.structuredPayload,
          ...(isWorkflow ? { status: result.status } : {}),
          ...projectClipCapabilityResultClassifierFields(descriptor),
          ...(isWorkflow && result.safeError?.code !== undefined ? { safeErrorCode: result.safeError.code } : {}),
          ...(isWorkflow && result.safeError?.category !== undefined ? { safeErrorCategory: result.safeError.category } : {}),
        },
      });
    }
    await runState.emitEvent(run, context, {
      type: 'CAPABILITY_COMPLETED',
      inlinePayload: {
        messageId: capabilityResultMessageId,
        ...processIdentity,
        toolCallId: toolCall.toolCallId,
        status: result.status,
        durationMs: durationMs(capabilityStartedAt),
        ...projectClipCapabilityResultClassifierFields(descriptor),
        ...(result.safeError?.code === undefined ? {} : { safeErrorCode: result.safeError.code }),
        ...(result.safeError?.category === undefined ? {} : { safeErrorCategory: result.safeError.category }),
        ...safeToolObservationFields(descriptor, effectiveArguments, result),
      },
    });
  } finally {
    releaseFinalize?.();
  }
}

async function invokeLifecycleHook<S extends LifecycleStage>(
  hook: LifecycleHookInvocationPort | undefined,
  run: RequestRun,
  context: RequestContext,
  stage: S,
  boundary: HookBoundaryByStage[S],
  signal: AbortSignal,
  occurrence: string,
): Promise<HookBoundaryByStage[S]> {
  if (hook === undefined) {
    return boundary;
  }
  const result = await hook.invoke(
    {
      stage,
      coordinates: {
        sessionId: run.sessionId,
        requestId: run.requestId,
        requestRunId: run.runId,
        agentId: run.agentId,
        agentVersion: run.agentVersion,
        agentAssemblyRef: run.agentAssemblyRef,
        stageOccurrenceKey: `${stage}:${occurrence}`,
      },
      ownerScope: {
        tenantId: context.identityContext.tenantId,
        subjectId: context.identityContext.subjectId,
      },
      boundary,
    },
    signal,
  );
  if (result.status === 'CONTINUE') {
    return result.boundary;
  }
  throw new LifecycleHookInterruptionError(result.interruption);
}

function requiresRequestLocalToolSerialization(preparedToolCalls: readonly PreparedOrdinaryToolCall[]): boolean {
  const firstToolSearchIndex = preparedToolCalls.findIndex((prepared) => prepared.capabilityId === 'ToolSearch');
  return firstToolSearchIndex >= 0 && preparedToolCalls.slice(firstToolSearchIndex + 1).some((prepared) => prepared.capabilityId === 'Skill');
}

function pendingHookResumeBoundary(
  context: RequestContext,
  stage: 'BEFORE_CAPABILITY_INVOKE',
): { readonly pendingInputId?: PendingInputId; readonly pendingAnswerSummary?: string } {
  const flow = context.flowVariables as Record<string, unknown>;
  const resume = flow['pendingHookResume'];
  if (resume === null || typeof resume !== 'object' || Array.isArray(resume)) {
    return {};
  }
  const resumeStage = (resume as Record<string, unknown>)['stage'];
  if (resumeStage !== stage) {
    return {};
  }
  const pendingInputId = (resume as Record<string, unknown>)['pendingInputId'];
  const pendingAnswerSummary = (resume as Record<string, unknown>)['pendingAnswerSummary'];
  delete flow['pendingHookResume'];
  return {
    ...(typeof pendingInputId === 'string' ? { pendingInputId: brand<string, 'PendingInputId'>(pendingInputId) } : {}),
    ...(typeof pendingAnswerSummary === 'string' ? { pendingAnswerSummary } : {}),
  };
}

function durationMs(startedAt: number): number {
  return Math.max(0, Math.round(performance.now() - startedAt));
}

function toPreparationRiskPolicyError(
  decision: Parameters<typeof toRiskPolicyError>[0],
  evaluation: Parameters<typeof toRiskPolicyError>[1],
): AgentError {
  const error = toRiskPolicyError(decision, evaluation);
  return decision.outcome === 'REQUIRE_AUTHORIZATION' ? new RiskPolicyAuthorizationControlError(error) : error;
}

function toCapabilityInvocationAgentError(error: unknown, signal: AbortSignal): AgentError {
  if (signal.aborted && !(error instanceof AgentError && error.category === 'CANCELED')) {
    return new AgentError({
      code: 'ABORTED',
      message: 'Capability invocation was canceled.',
      category: 'CANCELED',
      retryable: false,
      cause: error,
    });
  }
  if (error instanceof AgentError) {
    return error;
  }
  return new AgentError({
    code: 'CAPABILITY_EXECUTION_FAILED',
    message:
      'Capability invocation failed unexpectedly after dispatch and has stopped. Choose another capability, provide a safe response without this operation, or end and report the failure.',
    category: 'INTERNAL',
    retryable: false,
    cause: error,
  });
}

function normalizeCapabilityInvocationError(error: unknown): {
  readonly code: string;
  readonly category: SafeError['category'];
  readonly message: string;
  readonly status: 'FAILED' | 'TIMED_OUT';
  readonly retryable: boolean;
  readonly safeDetails?: JsonObject;
} {
  if (error instanceof AgentError) {
    return {
      code: error.code,
      category: error.category,
      message: error.message,
      status: error.category === 'TIMEOUT' ? 'TIMED_OUT' : 'FAILED',
      retryable: error.retryable,
      ...(error.safeDetails === undefined ? {} : { safeDetails: error.safeDetails }),
    };
  }
  return {
    code: 'CAPABILITY_EXECUTION_FAILED',
    category: 'INTERNAL',
    message:
      'Capability invocation failed unexpectedly after dispatch and has stopped. Choose another capability, provide a safe response without this operation, or end and report the failure.',
    status: 'FAILED',
    retryable: false,
  };
}

function fallbackCapabilityFailureMessage(status: 'FAILED' | 'TIMED_OUT'): string {
  return status === 'TIMED_OUT'
    ? 'The capability timed out without a valid safe error. Choose another capability, narrow the request, or end and report the timeout.'
    : 'The capability failed without a valid safe error. Choose another capability, revise the request, or end and report the failure.';
}

function buildRiskPolicyEvaluationInput(
  run: RequestRun,
  context: RequestContext,
  operationInput: Parameters<typeof summarizeCapabilityOperation>[0],
  capabilityAvailable: boolean,
) {
  const operation = summarizeCapabilityOperation(operationInput);
  return {
    sessionId: run.sessionId,
    requestId: run.requestId,
    requestRunId: run.runId,
    requestContextId: context.requestContextId,
    identityContext: context.identityContext,
    agentId: run.agentId,
    agentVersion: run.agentVersion,
    operation,
    capabilityAvailable,
    capabilityEnabled: 'descriptor' in operationInput ? operationInput.descriptor.availabilityStatus === 'AVAILABLE' : false,
    policyId: 'builtin-risk-policy',
    policyVersion: '1',
  };
}

async function emitPolicyApplied(
  runState: AgentRunStatePort,
  run: RequestRun,
  context: RequestContext,
  evaluation: ReturnType<typeof toRiskPolicyEvaluation>,
): Promise<void> {
  await runState.emitEvent(run, context, {
    type: 'POLICY_APPLIED',
    inlinePayload: policyAppliedTimelinePayload({
      operationKind: evaluation.operationKind,
      operationId: evaluation.operationId,
      outcome: evaluation.outcome,
      reasonCode: evaluation.reasonCode,
      policyId: 'builtin-risk-policy',
      policyVersion: '1',
      policyDomain: 'CAPABILITY_RISK',
      policyPoint: evaluation.operationKind,
      ...(evaluation.capabilityId === undefined ? {} : { capabilityId: evaluation.capabilityId }),
      ...(evaluation.toolCallId === undefined ? {} : { toolCallId: evaluation.toolCallId }),
      riskLevel: evaluation.riskLevel,
    }),
  });
}

function policyAppliedTimelinePayload(payload: JsonObject): JsonObject {
  return isPolicyProjectionPayload(payload)
    ? payload
    : {
        outcome: typeof payload['outcome'] === 'string' ? payload['outcome'] : 'rejected',
        reasonCode: typeof payload['reasonCode'] === 'string' ? payload['reasonCode'] : 'POLICY_PROJECTION_INVALID',
        projectionUnavailable: 'POLICY_PROJECTION_INVALID',
      };
}

function currentRunAuthorization(flowVariables: JsonObject): { readonly operationId: string } | undefined {
  const raw = flowVariables[riskPolicyAuthorizationKey];
  if (raw === undefined || raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return undefined;
  }
  const operationId = (raw as Record<string, unknown>)['operationId'];
  return typeof operationId === 'string' && operationId.length > 0 ? { operationId } : undefined;
}

function isRecoveredPendingToolCall(context: RequestContext, toolCallId: string): boolean {
  return (
    context.nextLifecycleStage === 'BEFORE_CAPABILITY_INVOKE' &&
    context.toolCallStates.some((toolCall) => toolCall.toolCallId === toolCallId && toolCall.status === 'PENDING')
  );
}

interface AskUserQuestionInput extends JsonObject {
  readonly questions: readonly AskUserQuestionInputQuestion[];
}

interface AskUserQuestionInputQuestion extends JsonObject {
  readonly prompt: string;
  readonly options?: readonly AskUserQuestionInputOption[];
  readonly multiple?: boolean;
  readonly custom?: boolean;
}

interface AskUserQuestionInputOption extends JsonObject {
  readonly value: string;
  readonly label: string;
  readonly requiresTextInput?: boolean;
  readonly inputPlaceholder?: string;
}

async function requestAskUserQuestionPendingInput(input: {
  readonly runState: AgentRunStatePort;
  readonly run: RequestRun;
  readonly context: RequestContext;
  readonly descriptor: CapabilityDescriptor;
  readonly toolCall: ToolCallList[number];
  readonly signal: AbortSignal;
}): Promise<PendingInputRequest> {
  if (input.signal.aborted) {
    throw new AgentError({
      code: 'ABORTED',
      message: 'AskUserQuestion was aborted before pending input acceptance.',
      category: 'CANCELED',
      retryable: false,
    });
  }
  const intent = toAskUserQuestionPendingInputIntent(input.descriptor, input.toolCall.arguments);
  const pendingContext = toAskUserQuestionPendingContext(input.context, input.descriptor, input.toolCall);
  return input.runState.requestPendingInput(input.run, pendingContext, intent);
}

function toAskUserQuestionPendingInputIntent(descriptor: CapabilityDescriptor, args: JsonObject): PendingInputIntent {
  if (descriptor.inputSchema === undefined) {
    throw new AgentError({
      code: 'CAPABILITY_UNAVAILABLE',
      message:
        'AskUserQuestion input validation is unavailable before pending-input creation. Ask the question in a normal response, choose another available capability, or stop and report the unavailable validation boundary.',
      category: 'UNAVAILABLE',
      retryable: false,
    });
  }
  const normalizedArgs = normalizeAskUserQuestionArguments(args);
  const validationSchema = askUserQuestionValidationSchema(descriptor.inputSchema, normalizedArgs);
  let validate: ReturnType<typeof askUserQuestionValidator.compile>;
  try {
    validate = askUserQuestionValidator.compile(validationSchema);
  } catch {
    throw new AgentError({
      code: 'CAPABILITY_UNAVAILABLE',
      message:
        'AskUserQuestion input validation could not compile before pending-input creation. Ask the question in a normal response, choose another available capability, or stop and report the unavailable validation boundary.',
      category: 'UNAVAILABLE',
      retryable: false,
    });
  }
  if (validate(normalizedArgs) !== true) {
    const violations = collectAskUserQuestionViolations(validate.errors ?? [], validationSchema);
    throw correctableAskUserQuestionInput(violationsToAskUserQuestionMessage(violations), violations);
  }

  const input = normalizedArgs as AskUserQuestionInput;
  const questions = input.questions.map((question) => {
    assertSafeAskUserQuestionText(question.prompt);
    const options = question.options;
    if (options === undefined) {
      if (question.multiple !== undefined || (question.custom !== undefined && question.custom !== true)) {
        throw correctableAskUserQuestionInput('Text questions cannot include option modifiers.');
      }
      return { prompt: question.prompt, options: [] };
    }

    const optionValues = new Set<string>();
    let hasAttachedTextInput = false;
    for (const option of options) {
      assertSafeAskUserQuestionText(option.value);
      assertSafeAskUserQuestionText(option.label);
      if (option.inputPlaceholder !== undefined && option.requiresTextInput !== true) {
        throw correctableAskUserQuestionInput(
          'Field "questions.options.inputPlaceholder" requires "questions.options.requiresTextInput" to be true.',
        );
      }
      hasAttachedTextInput ||= option.requiresTextInput === true;
      if (optionValues.has(option.value)) {
        throw correctableAskUserQuestionInput('Field "questions.options.value" must be unique within each question.');
      }
      optionValues.add(option.value);
    }
    if (hasAttachedTextInput && question.multiple === true) {
      throw correctableAskUserQuestionInput('Option-attached text input requires "questions.multiple" to be false.');
    }
    return {
      prompt: question.prompt,
      options: options.map((option) => ({
        value: option.value,
        label: option.label,
        ...(option.requiresTextInput === undefined ? {} : { requiresTextInput: option.requiresTextInput }),
        ...(option.inputPlaceholder === undefined ? {} : { inputPlaceholder: option.inputPlaceholder }),
      })),
      ...(question.multiple === undefined ? {} : { multiple: question.multiple }),
      ...(question.custom === undefined ? {} : { custom: question.custom }),
    };
  });

  return { kind: 'QUESTION', questions };
}

function askUserQuestionValidationSchema(inputSchema: JsonObject, normalizedArgs: JsonObject): JsonObject {
  const questions = normalizedArgs['questions'];
  if (!Array.isArray(questions) || questions.length <= askUserQuestionModelQuestionLimit) {
    return inputSchema;
  }
  if (questions.length > askUserQuestionCompatibilityQuestionLimit || !hasCanonicalAskUserQuestionCountLimit({ inputSchema })) {
    return inputSchema;
  }
  const properties = inputSchema['properties'] as JsonObject;
  const questionsSchema = properties['questions'] as JsonObject;
  return {
    ...inputSchema,
    properties: {
      ...properties,
      questions: {
        ...questionsSchema,
        maxItems: askUserQuestionCompatibilityQuestionLimit,
      },
    },
  };
}

function normalizeAskUserQuestionArguments(args: JsonObject): JsonObject {
  let questions = args['questions'];
  let normalizedArgs = args;
  if (typeof questions === 'string') {
    const trimmed = questions.trim();
    if (!trimmed.startsWith('[') || trimmed.length > 10_000) {
      return args;
    }
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      if (isJsonValue(parsed)) {
        questions = parsed;
        normalizedArgs = { ...args, questions };
      }
    } catch {
      return args;
    }
  }
  if (questions === undefined) {
    return args;
  }
  const normalizedQuestions = normalizeAskUserQuestionQuestions(questions);
  return normalizedQuestions === questions ? normalizedArgs : { ...normalizedArgs, questions: normalizedQuestions };
}

function normalizeAskUserQuestionQuestions(value: JsonValue): JsonValue {
  if (!Array.isArray(value)) {
    return value;
  }
  let changed = false;
  const questions = value.map((item) => {
    if (!isJsonObject(item) || !Array.isArray(item['options']) || item['options'].length >= 2) {
      return item;
    }
    changed = true;
    const { options: _options, multiple: _multiple, custom: _custom, ...textQuestion } = item;
    return textQuestion;
  });
  return changed ? questions : value;
}

function isJsonValue(value: unknown): value is JsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return true;
  }
  if (typeof value === 'number') {
    return Number.isFinite(value);
  }
  if (Array.isArray(value)) {
    return value.every(isJsonValue);
  }
  if (typeof value !== 'object') {
    return false;
  }
  return Object.values(value).every(isJsonValue);
}

function toAskUserQuestionPendingContext(context: RequestContext, descriptor: CapabilityDescriptor, toolCall: ToolCallList[number]): RequestContext {
  return {
    ...context,
    nextLifecycleStage: 'BEFORE_CAPABILITY_INVOKE',
    toolCallStates: [
      {
        toolCallId: toolCall.toolCallId,
        capabilityId: descriptor.capabilityId,
        arguments: toolCall.arguments,
        status: 'PENDING',
      },
    ],
  };
}

function assertSafeAskUserQuestionText(value: string): void {
  if (value.trim().length === 0 || value.length > 500) {
    throw correctableAskUserQuestionInput('Visible text must be non-empty and contain at most 500 characters.');
  }
  if (askUserQuestionForbiddenVisibleText.test(value)) {
    throw new AgentError({
      code: 'INVALID_INPUT',
      message:
        'AskUserQuestion cannot request protected credentials, approvals, protected-operation confirmation, or human handoff. Continue without requesting protected input, use an authorized workflow, or end the action.',
      category: 'VALIDATION',
      retryable: false,
      safeDetails: { reasonCode: askUserQuestionForbiddenPurposeReasonCode },
    });
  }
}

function correctableAskUserQuestionInput(detail: string, violations?: readonly AskUserQuestionViolation[]): AgentError {
  const maximumDetailLength =
    askUserQuestionValidationMessageLimit - askUserQuestionValidationMessagePrefix.length - askUserQuestionInputCorrectionInstruction.length;
  const boundedDetail = detail.slice(0, maximumDetailLength);
  return new AgentError({
    code: 'INVALID_INPUT',
    message: `${askUserQuestionValidationMessagePrefix}${boundedDetail}${askUserQuestionInputCorrectionInstruction}`,
    category: 'VALIDATION',
    retryable: false,
    safeDetails: {
      reasonCode: askUserQuestionInputCorrectableReasonCode,
      ...(violations === undefined || violations.length === 0 ? {} : { violations: violations as unknown as JsonValue[] }),
    },
  });
}

function normalizeAskUserQuestionProducerError(error: unknown, signal: AbortSignal): AgentError {
  if (signal.aborted) {
    return new AgentError({
      code: 'ABORTED',
      message: 'AskUserQuestion was aborted before pending input acceptance.',
      category: 'CANCELED',
      retryable: false,
    });
  }
  if (error instanceof AgentError) {
    if (error.code === 'CAPABILITY_UNAVAILABLE' || error.code === 'INVALID_INPUT' || error.code === 'ABORTED') {
      return error;
    }
    if (error.code === 'PENDING_INPUT_INTENT_INVALID') {
      return new AgentError({
        code: 'INVALID_INPUT',
        message:
          'AskUserQuestion pending input intent is invalid. Correct the question structure, ask in a normal response, or choose another capability.',
        category: 'VALIDATION',
        retryable: false,
      });
    }
    if (error.code.startsWith('PENDING_INPUT_') || error.code === 'RUN_CONTEXT_MISMATCH') {
      return new AgentError({
        code: 'PENDING_INPUT_UNAVAILABLE',
        message:
          'AskUserQuestion pending input is unavailable. Ask the question in a normal response, choose another available capability, or end the action.',
        category: 'UNAVAILABLE',
        retryable: error.retryable,
        safeDetails: { reasonCode: error.code },
      });
    }
  }
  return new AgentError({
    code: 'EXECUTION_FAILED',
    message:
      'AskUserQuestion failed at the pending-input stage. Ask the question in a normal response, choose another available capability, or end and report the failure.',
    category: 'INTERNAL',
    retryable: false,
  });
}

function hasCanonicalAskUserQuestionCountLimit(descriptor: Pick<CapabilityDescriptor, 'inputSchema'>): boolean {
  const properties = descriptor.inputSchema?.['properties'];
  if (!isJsonObject(properties)) {
    return false;
  }
  const questions = properties['questions'];
  return isJsonObject(questions) && questions['maxItems'] === askUserQuestionModelQuestionLimit;
}

function isCanonicalAskUserQuestionDescriptor(descriptor?: CapabilityDescriptor): boolean {
  return (
    descriptor !== undefined &&
    descriptor.kind === 'TOOL' &&
    descriptor.capabilityId === askUserQuestionCapabilityId &&
    descriptor.provider.providerId === askUserQuestionProviderId &&
    descriptor.provider.providerKind === 'BUNDLED' &&
    descriptor.availabilityStatus === 'AVAILABLE'
  );
}

function isAskUserQuestionToolName(toolName: string): boolean {
  return toolName === askUserQuestionCapabilityId;
}

function toolLoopLogFields(run: RequestRun, round: number): Record<string, string | number> {
  return {
    agentId: run.agentId,
    sessionId: run.sessionId,
    requestId: run.requestId,
    runId: run.runId,
    round,
  };
}

function toolCallLogFields(
  run: RequestRun,
  round: number,
  toolCallId: string,
  toolName: string,
  capabilityId: CapabilityId,
  toolBatchLogContext?: ToolBatchLogContext,
): Record<string, string | number> {
  return {
    ...toolLoopLogFields(run, round),
    stepId: `turn-${round + 1}`,
    toolCallId,
    toolName,
    capabilityId,
    ...toolBatchLogFields(toolBatchLogContext),
  };
}

function toolBatchLogFields(toolBatchLogContext?: ToolBatchLogContext): Record<string, string | number> {
  if (toolBatchLogContext === undefined) {
    return {};
  }
  return {
    parallelToolBatch: 'same_round',
    toolBatchOrdinal: toolBatchLogContext.toolBatchOrdinal,
    toolBatchSize: toolBatchLogContext.toolBatchSize,
  };
}

function runtimeToolInputLogFields(capabilityId: CapabilityId, toolArguments: JsonObject): Record<string, unknown> {
  return {
    toolInput: toolArguments,
    toolSafeSummary: buildToolArgumentSafeSummary(capabilityId, toolArguments),
  };
}

function runtimeToolOutputLogFields(result: CapabilityInvocationResult): Record<string, unknown> {
  const { generatedMessages, ...output } = result;
  const generatedMessageKinds = (['USER', 'USER_META'] as const).filter((kind) =>
    generatedMessages.some((message) => (message.meta === true ? 'USER_META' : 'USER') === kind),
  );
  return {
    toolOutput: {
      ...output,
      generatedMessageCount: generatedMessages.length,
      generatedMessageKinds,
    },
  };
}

function buildToolArgumentSafeSummary(capabilityId: CapabilityId, toolArguments: JsonObject): string {
  if (capabilityId === 'Bash' && typeof toolArguments['command'] === 'string') {
    return sanitizeCommandSummary('command', toolArguments['command']);
  }
  if (capabilityId === 'Python' && typeof toolArguments['code'] === 'string') {
    return sanitizeCommandSummary('code', toolArguments['code']);
  }
  const parts = Object.values(sanitizeSummaryToolArguments(toolArguments))
    .flatMap((value) => summaryTextParts(value))
    .slice(0, 12);
  return parts.length === 0 ? 'no-args' : parts.join(' ');
}

function buildRuntimeToolInputPreview(capabilityId: CapabilityId, toolArguments: JsonObject): string {
  if (capabilityId === 'Bash' && typeof toolArguments['command'] === 'string') {
    return sanitizeCommandSummary('command', toolArguments['command']);
  }
  if (capabilityId === 'Python' && typeof toolArguments['code'] === 'string') {
    return sanitizeCommandSummary('code', toolArguments['code']);
  }
  const toolSpecificPreview = buildToolSpecificPreview(capabilityId, toolArguments);
  if (toolSpecificPreview !== undefined) {
    return toolSpecificPreview;
  }
  const parts = Object.values(sanitizeRuntimeSummaryToolArguments(toolArguments))
    .flatMap((value) => summaryTextParts(value))
    .slice(0, 12);
  return parts.length === 0 ? 'no-args' : parts.join(' ');
}

function buildToolSpecificPreview(capabilityId: CapabilityId, toolArguments: JsonObject): string | undefined {
  if (capabilityId === 'Read') {
    return buildKeyedPreview(toolArguments, ['file_path', 'offset', 'limit']);
  }
  if (capabilityId === 'Grep') {
    return buildKeyedPreview(toolArguments, ['pattern', 'path', 'output_mode', 'glob']);
  }
  if (capabilityId === 'Glob') {
    return buildKeyedPreview(toolArguments, ['pattern', 'path']);
  }
  if (capabilityId === 'Edit' || capabilityId === 'Write') {
    return buildKeyedPreview(toolArguments, ['file_path']);
  }
  if (capabilityId === 'Agent') {
    return buildKeyedPreview(toolArguments, ['agentId']);
  }
  if (capabilityId === 'Skill') {
    return buildKeyedPreview(toolArguments, ['name']);
  }
  return undefined;
}

function buildKeyedPreview(toolArguments: JsonObject, keys: readonly string[]): string | undefined {
  const parts: string[] = [];
  for (const key of keys) {
    const value = toolArguments[key];
    if (value === undefined) {
      continue;
    }
    if (typeof value === 'string') {
      parts.push(`${key}=${sanitizeRuntimeToolArgumentString(key, value)}`);
    } else if (typeof value === 'number' || typeof value === 'boolean') {
      parts.push(`${key}=${String(value)}`);
    }
  }
  return parts.length === 0 ? undefined : parts.join(' ');
}

function sanitizeSummaryToolArguments(toolArguments: JsonObject): JsonObject {
  return Object.fromEntries(
    Object.entries(toolArguments)
      .slice(0, 8)
      .map(([key, value]) => [key, sanitizeSummaryToolArgumentValue(key, value)]),
  );
}

function sanitizeRuntimeSummaryToolArguments(toolArguments: JsonObject): JsonObject {
  return Object.fromEntries(
    Object.entries(toolArguments)
      .slice(0, 8)
      .map(([key, value]) => [key, sanitizeRuntimeSummaryToolArgumentValue(key, value)]),
  );
}

function sanitizeSummaryToolArgumentValue(key: string, value: JsonValue): JsonValue {
  if (value === null || typeof value === 'boolean' || typeof value === 'number') {
    return value;
  }
  if (typeof value === 'string') {
    return sanitizeFailureToolArgumentString(key, value);
  }
  if (Array.isArray(value)) {
    return value.slice(0, 5).map((item) => sanitizeSummaryToolArgumentValue(key, item));
  }
  return Object.fromEntries(
    Object.entries(value)
      .slice(0, 5)
      .map(([childKey, childValue]) => [childKey, sanitizeSummaryToolArgumentValue(childKey, childValue)]),
  );
}

function sanitizeRuntimeSummaryToolArgumentValue(key: string, value: JsonValue): JsonValue {
  if (value === null || typeof value === 'boolean' || typeof value === 'number') {
    return value;
  }
  if (typeof value === 'string') {
    return sanitizeRuntimeToolArgumentString(key, value);
  }
  if (Array.isArray(value)) {
    return value.slice(0, 5).map((item) => sanitizeRuntimeSummaryToolArgumentValue(key, item));
  }
  return Object.fromEntries(
    Object.entries(value)
      .slice(0, 5)
      .map(([childKey, childValue]) => [childKey, sanitizeRuntimeSummaryToolArgumentValue(childKey, childValue)]),
  );
}

function summaryTextParts(value: JsonValue): readonly string[] {
  if (value === null) {
    return ['null'];
  }
  if (typeof value === 'boolean' || typeof value === 'number') {
    return [String(value)];
  }
  if (typeof value === 'string') {
    return [value];
  }
  if (Array.isArray(value)) {
    return value.flatMap((item) => summaryTextParts(item));
  }
  return Object.values(value).flatMap((item) => summaryTextParts(item as JsonValue));
}

function sanitizeFailureToolArgumentString(key: string, value: string): string {
  if (isSensitiveLogFieldName(key) || SECRET_KEYWORD_PATTERN.test(value)) {
    return maskTextValue(value);
  }
  if (isPathLikeLogFieldName(key) || looksLikePathOrUrl(value)) {
    return maskPathLikeValue(value);
  }
  if (isVerboseTextLogFieldName(key) || value.length > 128 || /[\r\n\t]/u.test(value) || /\s/u.test(value)) {
    return maskTextValue(value);
  }
  return value;
}

function sanitizeRuntimeToolArgumentString(key: string, value: string): string {
  if (key === 'command' || key === 'code') {
    return sanitizeCommandSummary(key, value);
  }
  if (isSensitiveLogFieldName(key) || SECRET_KEYWORD_PATTERN.test(value)) {
    return maskTextValue(value);
  }
  if (isPathLikeLogFieldName(key) || looksLikePathOrUrl(value)) {
    return sanitizeRuntimePathValue(value);
  }
  if (isStrongSensitiveTextLogFieldName(key)) {
    return maskTextValue(value);
  }
  if (value.length > 128 || /[\r\n\t]/u.test(value) || /\s/u.test(value) || isReadableQueryTextLogFieldName(key)) {
    return sanitizeRuntimeTextExcerpt(value);
  }
  return value.length <= 96 ? value : `${value.slice(0, 93)}...`;
}

function sanitizeCommandSummary(key: 'command' | 'code', value: string): string {
  const normalized = key === 'code' ? (value.split(/\r?\n/u, 1)[0] ?? '') : value;
  const compact = normalized.trim().replace(/\s+/gu, ' ').slice(0, 160);
  if (compact.length === 0) {
    return '<redacted:text>';
  }
  return compact
    .split(' ')
    .slice(0, 12)
    .map((token) => sanitizeCommandSummaryToken(token))
    .join(' ');
}

function sanitizeCommandSummaryToken(token: string): string {
  if (token.length === 0) {
    return token;
  }
  const [prefix, suffix] = unwrapQuotedToken(token);
  if (isSensitiveToken(suffix)) {
    return `${prefix}${maskTextValue(suffix)}`;
  }
  if (looksLikePathOrUrl(suffix)) {
    return `${prefix}${maskPathLikeValue(suffix)}`;
  }
  const assignment = splitAssignmentToken(suffix);
  if (assignment !== undefined) {
    return assignment.safe;
  }
  return `${prefix}${suffix.length > 64 ? maskTextValue(suffix) : suffix}`;
}

function unwrapQuotedToken(token: string): readonly [string, string] {
  if ((token.startsWith('"') && token.endsWith('"')) || (token.startsWith("'") && token.endsWith("'"))) {
    return [token[0] ?? '', token.slice(1, -1)];
  }
  return ['', token];
}

function splitAssignmentToken(token: string): { readonly safe: string } | undefined {
  const index = token.indexOf('=');
  if (index <= 0) {
    return undefined;
  }
  const key = token.slice(0, index);
  const value = token.slice(index + 1);
  if (isSensitiveLogFieldName(key) || SECRET_KEYWORD_PATTERN.test(value)) {
    return { safe: `${key}=${maskTextValue(value)}` };
  }
  if (looksLikePathOrUrl(value)) {
    return { safe: `${key}=${maskPathLikeValue(value)}` };
  }
  return { safe: `${key}=${value.length > 64 ? maskTextValue(value) : value}` };
}

function isSensitiveToken(token: string): boolean {
  return SECRET_KEYWORD_PATTERN.test(token) || /sk-[A-Za-z0-9._-]{10,}/u.test(token) || /^Bearer$/iu.test(token) || /^Bearer[:=]/iu.test(token);
}

function isSensitiveLogFieldName(key: string): boolean {
  return /(?:password|api[-_]?key|token|secret|credential|authorization)/iu.test(key);
}

function isPathLikeLogFieldName(key: string): boolean {
  return /(?:^|[_-])(path|file|dir|root|cwd|workspace)(?:$|[_-])/iu.test(key);
}

function isStrongSensitiveTextLogFieldName(key: string): boolean {
  return /(?:^|[_-])(prompt|content|body|message|script)(?:$|[_-])/iu.test(key);
}

function isReadableQueryTextLogFieldName(key: string): boolean {
  return /(?:^|[_-])(query|pattern|text|string|input|question)(?:$|[_-])/iu.test(key);
}

function isVerboseTextLogFieldName(key: string): boolean {
  return /(?:^|[_-])(prompt|content|query|pattern|command|script|code|text|message|string|input|question|body)(?:$|[_-])/iu.test(key);
}

function looksLikePathOrUrl(value: string): boolean {
  return value.includes('\\') || value.includes('/') || /^[A-Za-z]:/u.test(value) || /^[A-Za-z][A-Za-z0-9+.-]*:\/\//u.test(value);
}

function maskTextValue(value: string): string {
  const compact = value.trim().replace(/\s+/gu, ' ');
  if (compact.length === 0) {
    return '****';
  }
  return maskMiddle(compact, 2, 2);
}

function maskPathLikeValue(value: string): string {
  const normalized = value.trim();
  if (normalized.length === 0) {
    return '****';
  }
  return normalized
    .split(/([\\/]+)/u)
    .map((part) => {
      if (part.length === 0 || /^[\\/]+$/u.test(part)) {
        return part;
      }
      if (/^[A-Za-z]:$/u.test(part)) {
        return part;
      }
      return maskMiddle(part, 2, 2);
    })
    .join('');
}

function sanitizeRuntimePathValue(value: string): string {
  const normalized = value.trim();
  if (normalized.length === 0) {
    return '****';
  }
  if (looksLikeAbsolutePathOrUrl(normalized)) {
    return maskPathLikeValue(normalized);
  }
  const segments = normalized.split(/[\\/]+/u).filter((segment) => segment.length > 0);
  if (segments.length === 0) {
    return normalized;
  }
  if (segments.length <= 3) {
    return normalized;
  }
  return segments.slice(-3).join('/');
}

function looksLikeAbsolutePathOrUrl(value: string): boolean {
  return /^[A-Za-z]:/u.test(value) || value.startsWith('\\\\') || value.startsWith('/') || /^[A-Za-z][A-Za-z0-9+.-]*:\/\//u.test(value);
}

function sanitizeRuntimeTextExcerpt(value: string): string {
  const compact = value.trim().replace(/\s+/gu, ' ');
  if (compact.length === 0) {
    return '****';
  }
  return compact
    .split(' ')
    .slice(0, 12)
    .map((token) => sanitizeCommandSummaryToken(token))
    .join(' ')
    .slice(0, 96);
}

function maskMiddle(value: string, prefixLength: number, suffixLength: number): string {
  if (value.length <= prefixLength + suffixLength) {
    return '****';
  }
  return `${value.slice(0, prefixLength)}****${value.slice(value.length - suffixLength)}`;
}

function buildCapabilityProcessIdentity(descriptor: CapabilityDescriptor, effectiveArguments: JsonObject): CapabilityProcessIdentity {
  const targetField =
    descriptor.kind === 'TOOL' && descriptor.capabilityId === 'Agent'
      ? 'agentId'
      : descriptor.kind === 'TOOL' && descriptor.capabilityId === 'Skill'
        ? 'name'
        : descriptor.kind === 'TOOL' && descriptor.capabilityId === 'Workflow'
          ? 'recipeName'
          : undefined;
  const targetCapabilityId = targetField === undefined ? undefined : normalizeTargetCapabilityId(effectiveArguments[targetField]);
  return Object.freeze({
    capabilityKind: descriptor.kind,
    capabilityId: descriptor.capabilityId,
    ...(targetCapabilityId === undefined ? {} : { targetCapabilityId }),
  });
}

function normalizeTargetCapabilityId(value?: JsonValue): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 && Array.from(trimmed).length <= 128 && !/\p{Cc}/u.test(trimmed) ? trimmed : undefined;
}

function buildCapabilityResultSafeSummary(capabilityId: CapabilityId, structuredPayload: JsonObject, metadata?: JsonObject): string {
  if (capabilityId === 'Grep') {
    return `grep results=${grepResultCountBucket(structuredPayload)} truncated=${structuredPayload['truncated'] === true ? 'yes' : 'no'}`;
  }
  if (capabilityId === 'Rag') {
    return `rag status=${typeof structuredPayload['status'] === 'string' ? structuredPayload['status'] : 'unknown'} results=${ragResultCountBucket(structuredPayload)}`;
  }
  if (capabilityId === 'Skill') {
    const targetSkillId = skillResultTargetId(structuredPayload, metadata);
    return `skill result target=${targetSkillId}`;
  }
  const topLevelFieldCount = Object.keys(structuredPayload).length;
  return `result fields=${topLevelFieldCount}`;
}

function skillResultTargetId(structuredPayload: JsonObject, metadata?: JsonObject): string {
  if (typeof structuredPayload['name'] === 'string') {
    return structuredPayload['name'];
  }
  if (typeof metadata?.['targetSkillId'] === 'string') {
    return metadata['targetSkillId'];
  }
  return 'unknown';
}

/**
 * Extract an agentic Skill body out of `result.generatedMessages` WITHOUT
 * persisting it yet. Returns the body content, skill name, and the remaining
 * generated messages (body removed) so the caller can clear `generatedMessages`
 * immediately (consume-once: `applyRequestLocalResultEffects` must not see the
 * body) while persisting the body LATER, after the tool-result is appended, so
 * its sequence ordinal lands right after the tool-result pair.
 *
 * Returns undefined when there is no Skill body to extract: non-Skill results,
 * failed loads, or a run state that does not support `appendGeneratedUserMessage`
 * (in which case the body stays volatile in `generatedMessages` and the renderer
 * anchors it after the tool-result).
 */
function extractSkillBody(
  capabilityId: CapabilityId,
  result: CapabilityInvocationResult,
  canPersist: boolean,
): { readonly body: string; readonly skillName: string; readonly remaining: readonly CapabilityGeneratedMessage[] } | undefined {
  if (!canPersist || capabilityId !== 'Skill' || result.status !== 'SUCCEEDED') {
    return undefined;
  }
  const skillName = typeof result.structuredPayload['name'] === 'string' ? (result.structuredPayload['name'] as string) : undefined;
  const bodyMessage = result.generatedMessages.find(
    (message) => message.role === 'USER' && message.meta === true && typeof message.content === 'string',
  );
  if (bodyMessage === undefined || skillName === undefined) {
    return undefined;
  }
  return {
    body: bodyMessage.content,
    skillName,
    remaining: result.generatedMessages.filter((message) => message !== bodyMessage),
  };
}

/**
 * Persist a previously-extracted Skill body as a page-hidden USER message
 * (`visible:false` + `metadata.modelVisibility.included=true`). Must be called
 * AFTER `appendCapabilityResultMessage` so the body's sequence ordinal lands
 * right after the tool-result pair. Only call this when the run state supports
 * `appendGeneratedUserMessage`; the caller (`extractSkillBody`) already gated
 * on that by returning undefined otherwise — but this guard is defensive.
 */
async function persistExtractedSkillBody(
  runState: AgentRunStatePort,
  run: RequestRun,
  context: RequestContext,
  body: string,
  skillName: string,
): Promise<void> {
  const appendGeneratedUserMessage = runState.appendGeneratedUserMessage;
  if (appendGeneratedUserMessage === undefined) {
    return;
  }
  await appendGeneratedUserMessage.call(runState, run, context, {
    role: 'USER',
    content: body,
    contentType: 'PLAIN_TEXT',
    visible: false,
    metadata: {
      modelVisibility: { included: true, reason: 'SKILL_BODY' },
      skillName,
    },
    idempotencyKey: brand<string, 'IdempotencyKey'>(`${run.runId}:skill-content:${skillName}`),
  });
}

function safeCapabilityCompletionFieldsForDiagnostics(diagnostics: unknown): JsonObject {
  if (!Array.isArray(diagnostics)) {
    return {};
  }
  const safeDiagnostics = diagnostics.flatMap((item): JsonObject[] => {
    if (item === null || typeof item !== 'object' || Array.isArray(item)) {
      return [];
    }
    const candidate = item as Record<string, unknown>;
    const key = candidate['key'];
    const value = candidate['value'];
    if (typeof key !== 'string' || typeof value !== 'string') {
      return [];
    }
    if (!isAllowedToolDiagnosticKey(key) || !isSafeLowCardinalityToolDiagnosticValue(value)) {
      return [];
    }
    return [{ key, value }];
  });
  if (safeDiagnostics.length === 0) {
    return {};
  }
  return {
    toolDiagnostics: safeDiagnostics,
  };
}

function safeToolObservationFields(descriptor: CapabilityDescriptor, toolArguments: JsonObject, result?: CapabilityInvocationResult): JsonObject {
  const toolDiagnostics = [
    ...safeToolArgumentDiagnostics(descriptor.capabilityId, toolArguments),
    ...safeCapabilityMetadataDiagnostics(result?.metadata),
  ];
  const structureDiagnostics = capabilityStructureDiagnostics(descriptor, toolArguments, result);
  return {
    toolSafeSummary: buildToolArgumentSafeSummary(descriptor.capabilityId, toolArguments),
    ...(isCapabilityStructureSafePayload(structureDiagnostics)
      ? structureDiagnostics
      : { argumentProjectionStatus: 'FILTERED', resultProjectionStatus: result === undefined ? 'NOT_PRODUCED' : 'FILTERED' }),
    ...safeCapabilityCompletionFieldsForDiagnostics(toolDiagnostics),
  };
}

function safeToolArgumentDiagnostics(capabilityId: CapabilityId, toolArguments: JsonObject): readonly JsonObject[] {
  const diagnostics: JsonObject[] = [{ key: 'toolInputRedaction', value: 'simple' }];
  if (capabilityId === 'Grep') {
    diagnostics.push({ key: 'grepOutputMode', value: grepOutputMode(toolArguments) });
  }
  if (capabilityId === 'Rag') {
    diagnostics.push(
      { key: 'ragIndexCountBucket', value: ragIndexCountBucket(toolArguments) },
      { key: 'ragTopKBucket', value: ragTopKBucket(toolArguments) },
    );
  }
  return diagnostics;
}

function safeCapabilityMetadataDiagnostics(metadata?: JsonObject): readonly JsonObject[] {
  const diagnostics = metadata?.['toolDiagnostics'];
  return Array.isArray(diagnostics)
    ? diagnostics.filter((item): item is JsonObject => item !== null && typeof item === 'object' && !Array.isArray(item))
    : [];
}

function isAllowedToolDiagnosticKey(key: string): boolean {
  return (
    key === 'toolResultStatus' ||
    key === 'toolResultCountBucket' ||
    key === 'reasonCode' ||
    key === 'toolInputRedaction' ||
    key === 'grepOutputMode' ||
    key === 'ragIndexCountBucket' ||
    key === 'ragTopKBucket'
  );
}

function isSafeLowCardinalityToolDiagnosticValue(value: string): boolean {
  return value.length > 0 && value.length <= 128 && /^[A-Za-z0-9_.+-]+$/u.test(value);
}

function grepOutputMode(toolArguments: JsonObject): 'content' | 'files_with_matches' {
  return toolArguments['output_mode'] === 'content' ? 'content' : 'files_with_matches';
}

function grepResultCountBucket(structuredPayload: JsonObject): '0' | '1' | '2-10' | '11-100' | '101+' | 'unknown' {
  const rawCount =
    typeof structuredPayload['total_matches'] === 'number'
      ? structuredPayload['total_matches']
      : typeof structuredPayload['total_files_with_matches'] === 'number'
        ? structuredPayload['total_files_with_matches']
        : undefined;
  if (rawCount === undefined || !Number.isFinite(rawCount) || rawCount < 0) {
    return 'unknown';
  }
  if (rawCount === 0) {
    return '0';
  }
  if (rawCount === 1) {
    return '1';
  }
  if (rawCount <= 10) {
    return '2-10';
  }
  if (rawCount <= 100) {
    return '11-100';
  }
  return '101+';
}

function ragIndexCountBucket(toolArguments: JsonObject): '0' | '1' | '2-10' | '11-100' | '101+' | 'unknown' {
  const indexes = toolArguments['indexes'];
  if (indexes === undefined) {
    return '1';
  }
  return countBucket(Array.isArray(indexes) ? indexes.length : undefined);
}

function ragResultCountBucket(structuredPayload: JsonObject): '0' | '1' | '2-10' | '11-100' | '101+' | 'unknown' {
  const results = structuredPayload['results'];
  return countBucket(Array.isArray(results) ? results.length : undefined);
}

function ragTopKBucket(toolArguments: JsonObject): '0' | '1' | '2-10' | '11-100' | '101+' | 'unknown' {
  const topK = typeof toolArguments['topK'] === 'number' ? Math.trunc(toolArguments['topK']) : 5;
  return countBucket(topK);
}

function countBucket(rawCount?: number): '0' | '1' | '2-10' | '11-100' | '101+' | 'unknown' {
  if (rawCount === undefined || !Number.isFinite(rawCount) || rawCount < 0) {
    return 'unknown';
  }
  if (rawCount === 0) {
    return '0';
  }
  if (rawCount === 1) {
    return '1';
  }
  if (rawCount <= 10) {
    return '2-10';
  }
  if (rawCount <= 100) {
    return '11-100';
  }
  return '101+';
}

function ragReasonCode(structuredPayload: JsonObject): string | undefined {
  const diagnostics = structuredPayload['diagnostics'];
  if (diagnostics === null || typeof diagnostics !== 'object' || Array.isArray(diagnostics)) {
    return undefined;
  }
  const reason = (diagnostics as JsonObject)['reason'];
  return typeof reason === 'string' ? reason : undefined;
}

export async function appendAssistantToolUseMessage(
  runState: AgentRunStatePort,
  run: RequestRun,
  context: RequestContext,
  toolCalls: ModelFinalResult['toolCalls'],
  assistantContent?: string,
): Promise<MessageId> {
  const toolCallIds = (toolCalls ?? []).map((toolCall) => toolCall.toolCallId);
  const content =
    assistantContent === undefined || assistantContent.length === 0
      ? JSON.stringify({ toolCalls })
      : JSON.stringify({ content: assistantContent, toolCalls });
  return await runState.appendMessage(run, context, {
    role: 'ASSISTANT',
    content,
    contentType: 'PLAIN_TEXT',
    visible: false,
    metadata: { kind: 'ASSISTANT_TOOL_USE', toolCallIds },
    idempotencyKey: deriveAssistantToolUseIdempotencyKey(run.runId, toolCallIds),
  });
}

// Describe only the omitted suffix; the admitted prefix has already completed
// its ordinary governed execution and tool-use/result pairing.
export function buildToolCallLimitCorrectionMessage(admission: ToolCallAdmission): string {
  return (
    `Tool call limit exceeded. The model requested ${admission.requestedCount} tool calls; ` +
    `${admission.admittedCount} were admitted and ${admission.omittedCount} were not admitted or executed. ` +
    `If more work is still needed, split the omitted work across later turns without assuming it already ran.`
  );
}

export function hasEmptyToolName(toolCalls: ToolCallList): boolean {
  return toolCalls.some((toolCall) => toolCall.toolName.trim().length === 0);
}

export function buildEmptyToolNameCorrectionMessage(toolCalls: ToolCallList): string {
  const emptyToolCallIds = toolCalls.filter((toolCall) => toolCall.toolName.trim().length === 0).map((toolCall) => toolCall.toolCallId);
  return (
    `One or more admitted tool calls had an empty tool name. ` +
    `The following tool call ids were missing a tool name: ${emptyToolCallIds.join(', ')}. ` +
    `Re-issue the tool calls with a valid tool name chosen from the available tools; do not omit the tool name field.`
  );
}

export function readAskUserQuestionCountExceeded(error: unknown):
  | {
      readonly questionCount: number;
      readonly maxQuestions: number;
    }
  | undefined {
  if (
    !(error instanceof AgentError) ||
    error.code !== 'INVALID_INPUT' ||
    error.safeDetails?.['reasonCode'] !== askUserQuestionCountExceededReasonCode
  ) {
    return undefined;
  }
  const questionCount = error.safeDetails['questionCount'];
  const maxQuestions = error.safeDetails['maxQuestions'];
  return typeof questionCount === 'number' &&
    Number.isInteger(questionCount) &&
    questionCount > askUserQuestionCompatibilityQuestionLimit &&
    maxQuestions === askUserQuestionModelQuestionLimit
    ? { questionCount, maxQuestions }
    : undefined;
}

export function readAskUserQuestionInputCorrection(error: unknown): string | undefined {
  if (
    !(error instanceof AgentError) ||
    error.code !== 'INVALID_INPUT' ||
    error.safeDetails?.['reasonCode'] !== askUserQuestionInputCorrectableReasonCode ||
    !error.message.startsWith(askUserQuestionValidationMessagePrefix) ||
    error.message.length > askUserQuestionValidationMessageLimit
  ) {
    return undefined;
  }
  return error.message;
}

export function buildToolCallBatchLogEntries(toolCalls: ToolCallList): readonly object[] {
  return toolCalls.map((toolCall) => ({
    toolCallId: toolCall.toolCallId,
    toolName: toolCall.toolName,
  }));
}

export function assertCapabilityResultSafe(result: CapabilityInvocationResult): void {
  if (
    !isCapabilityResultEnvelopeSafe(result) ||
    !isJsonObject(result.structuredPayload) ||
    !Array.isArray(result.generatedMessages) ||
    !Array.isArray(result.artifactRefs)
  ) {
    throw new AgentError({
      code: 'CAPABILITY_RESULT_INVALID',
      message:
        'The capability returned an invalid result envelope, so its result cannot be delivered safely. Stop this action, choose another capability, or report the invalid capability result.',
      category: 'VALIDATION',
      retryable: false,
    });
  }
  if (
    result.generatedMessages.length > 10 ||
    result.generatedMessages.some((message) => message.role !== 'USER' || typeof message.content !== 'string')
  ) {
    throw new AgentError({
      code: 'CAPABILITY_GENERATED_MESSAGE_INVALID',
      message:
        'The capability returned invalid generated messages, so the result cannot be delivered safely. Stop this action, choose another capability, or report the invalid capability result.',
      category: 'VALIDATION',
      retryable: false,
    });
  }
  for (const ref of [result.resultRef, ...result.artifactRefs].filter((value): value is string => value !== undefined)) {
    if (!/^[A-Za-z0-9._:-]{1,256}$/u.test(ref)) {
      throw new AgentError({
        code: 'CAPABILITY_REF_INVALID',
        message:
          'The capability returned an invalid artifact or attachment reference, so the result cannot be delivered safely. Stop this action, choose another capability, or report the invalid capability result.',
        category: 'VALIDATION',
        retryable: false,
      });
    }
  }
  if (result.metadata !== undefined) {
    const serialized = JSON.stringify(result.metadata);
    if (serialized.length > 4096 || SECRET_KEYWORD_PATTERN.test(serialized)) {
      throw new AgentError({
        code: 'CAPABILITY_METADATA_INVALID',
        message:
          'The capability returned invalid result metadata, so the result cannot be delivered safely. Stop this action, choose another capability, or report the invalid capability result.',
        category: 'VALIDATION',
        retryable: false,
      });
    }
  }
}

function isCapabilityResultEnvelopeSafe(value: unknown): boolean {
  if (!isJsonObject(value)) {
    return false;
  }
  const status = value['status'];
  if (typeof status !== 'string' || !capabilityResultStatuses.has(status)) {
    return false;
  }
  const safeError = value['safeError'];
  if (safeError === undefined) {
    return status === 'SUCCEEDED' || status === 'DEGRADED';
  }
  if (!isJsonObject(safeError) || Object.keys(safeError).some((key) => !safeErrorFields.has(key))) {
    return false;
  }
  const category = safeError['category'];
  if (
    typeof safeError['code'] !== 'string' ||
    safeError['code'].length === 0 ||
    typeof safeError['message'] !== 'string' ||
    typeof category !== 'string' ||
    !safeErrorCategories.has(category) ||
    typeof safeError['retryable'] !== 'boolean' ||
    (safeError['safeDetails'] !== undefined && (!isJsonObject(safeError['safeDetails']) || !isJsonValue(safeError['safeDetails'])))
  ) {
    return false;
  }
  if (status === 'SUCCEEDED') {
    return false;
  }
  if (category === 'TIMEOUT') {
    return status === 'TIMED_OUT';
  }
  if (status === 'TIMED_OUT') {
    return false;
  }
  return category !== 'CANCELED' || status === 'FAILED';
}

async function assertCapabilityAllowedToolsAuthorized(
  patch: CapabilityContextPatch | undefined,
  capabilityResolver: RuntimeCapabilityResolver,
  signal: AbortSignal,
): Promise<void> {
  if (patch?.allowedTools === undefined) {
    return;
  }
  const visibleCapabilities = await capabilityResolver.listCapabilities?.({ kind: 'TOOL' }, signal);
  if (signal.aborted) {
    throw new AgentError({
      code: 'ABORTED',
      message: 'Capability result extension validation was canceled.',
      category: 'CANCELED',
      retryable: false,
    });
  }
  const visibleRefs = new Set(
    (visibleCapabilities ?? []).flatMap((capability) => [
      capability.capabilityId,
      capability.capabilityId.toLowerCase(),
      `@${capability.provider.providerId}/${capability.capabilityId}`,
      `@${capability.provider.providerId}/${capability.capabilityId}`.toLowerCase(),
    ]),
  );
  if (patch.allowedTools.some((capabilityId) => !visibleRefs.has(capabilityId) && !visibleRefs.has(capabilityId.toLowerCase()))) {
    throw new AgentError({
      code: 'CAPABILITY_CONTEXT_PATCH_DENIED',
      message:
        'The capability returned a tool context patch containing a capability that is not authorized and visible in the current request, so the patch was rejected. Continue with the current authorized capabilities, choose another available capability, or stop and report the denied patch.',
      category: 'AUTHORIZATION',
      retryable: false,
    });
  }
}

// Capability result metadata may legitimately describe the source it touched
// (file paths, URLs, agent-registry endpoints, MCP server endpoints, etc.).
// The runtime guard is responsible for catching accidental secret-keyword
// leakage (e.g. a capability that smuggles a token value under a `token:`
// key). It must NOT block paths or URLs — those are normal product surface
// and a blanket `/` or `\` check breaks every legitimate capability.

function applyRequestLocalResultEffects(
  state: RequestLocalCapabilityState,
  input: {
    readonly capabilityId: CapabilityId;
    readonly authorizedModelPatch?: AuthorizedCapabilityModelPatch | undefined;
    readonly result: CapabilityInvocationResult;
    readonly run: RequestRun;
    readonly context: import('@nextagent/agent-contracts/runtime').RequestContext;
  },
): void {
  const nextContextPatch =
    input.result.contextPatch === undefined
      ? undefined
      : mergeGovernedCapabilityContextPatch(state.contextPatch, input.result.contextPatch, input.authorizedModelPatch);
  state.generatedMessages.push(...uniqueGeneratedMessages(state.generatedMessages, input.result.generatedMessages));
  if (input.capabilityId === 'TodoWrite' && input.result.status === 'SUCCEEDED') {
    const todos = readTodoWriteTodos(input.result.structuredPayload);
    if (todos !== undefined) {
      const flowVariables = input.context.flowVariables as Record<string, JsonValue | undefined>;
      flowVariables['todoWriteState'] = {
        todos,
        updatedAtRunId: input.run.runId,
      };
    }
  }
  // Detect non-agentic API call signal from Skill tool result.
  // The non-agentic Skill result intentionally omits contextPatch.
  if (input.result.metadata?.['nonAgenticApiCall'] === true && input.result.status === 'SUCCEEDED') {
    const flowVars = input.context.flowVariables as Record<string, JsonValue | undefined>;
    flowVars['nonAgenticApiCall'] = input.result.structuredPayload;
  }
  // Persist agentic skill descriptor info to flowVariables so ApiCall can
  // auto-resolve skillName/providerId when the model calls it directly.
  const hasAgenticFlag = input.result.metadata?.['agenticSkillLoaded'] === true;
  if (hasAgenticFlag && input.result.status === 'SUCCEEDED') {
    const agenticFlowVars = input.context.flowVariables as Record<string, JsonValue | undefined>;
    agenticFlowVars['activeSkillContext'] = {
      skillName: input.result.metadata?.['skillName'] as string | undefined,
      skillVersion: input.result.metadata?.['skillVersion'] as string | undefined,
      providerId: input.result.metadata?.['providerId'] as string | undefined,
      sourceIdentity: input.result.metadata?.['sourceIdentity'] as string | undefined,
      frontmatterHash: input.result.metadata?.['frontmatterHash'] as string | undefined,
      ...(input.result.metadata?.['passThroughFlag'] !== undefined ? { passThroughFlag: input.result.metadata['passThroughFlag'] as string } : {}),
      ...(input.result.metadata?.['apiHeaderParams'] !== undefined ? { apiHeaderParams: input.result.metadata['apiHeaderParams'] as string } : {}),
      ...(input.result.metadata?.['apiRequestParams'] !== undefined ? { apiRequestParams: input.result.metadata['apiRequestParams'] as string } : {}),
    } as unknown as JsonObject;
  }
  if (nextContextPatch !== undefined) {
    state.contextPatch = nextContextPatch;
  }
}

function readTodoWriteTodos(payload: JsonObject): readonly JsonObject[] | undefined {
  const todos = payload['newTodos'];
  if (!Array.isArray(todos)) {
    return undefined;
  }
  return todos.flatMap((item): JsonObject[] => {
    if (item === null || typeof item !== 'object' || Array.isArray(item)) {
      return [];
    }
    const record = item as Record<string, unknown>;
    const content = record['content'];
    const activeForm = record['activeForm'];
    const status = record['status'];
    if (typeof content !== 'string' || typeof activeForm !== 'string' || !isTodoStatus(status)) {
      return [];
    }
    return [{ content, activeForm, status }];
  });
}

function isTodoStatus(value: unknown): value is 'pending' | 'in_progress' | 'completed' {
  return value === 'pending' || value === 'in_progress' || value === 'completed';
}

function uniqueGeneratedMessages(
  existing: readonly CapabilityGeneratedMessage[],
  messages: readonly CapabilityGeneratedMessage[],
): readonly CapabilityGeneratedMessage[] {
  const seen = new Set(existing.map(generatedMessageKey));
  return messages.filter((message) => {
    const key = generatedMessageKey(message);
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function generatedMessageKey(message: CapabilityGeneratedMessage): string {
  return `${message.role}\u0000${message.content}`;
}

function shouldTerminateCapabilityFailure(result: CapabilityInvocationResult): boolean {
  const safeError = result.safeError;
  if (safeError === undefined) {
    return false;
  }
  return safeError.category === 'CANCELED';
}

function toCapabilityFailureError(result: CapabilityInvocationResult): AgentError {
  const safeError = result.safeError;
  if (safeError === undefined) {
    return new AgentError({
      code: result.status === 'TIMED_OUT' ? 'CAPABILITY_TIMED_OUT' : 'CAPABILITY_FAILED',
      message:
        result.status === 'TIMED_OUT'
          ? 'The capability timed out without returning a valid safe error. Choose another capability, narrow the request, or end and report the timeout.'
          : 'The capability failed without returning a valid safe error. Choose another capability, revise the request, or end and report the failure.',
      category: result.status === 'TIMED_OUT' ? 'TIMEOUT' : 'UNAVAILABLE',
      retryable: false,
    });
  }
  return new AgentError({
    code: safeError.code,
    message: safeError.message,
    category: safeError.category,
    retryable: safeError.retryable,
    ...(safeError.safeDetails === undefined ? {} : { safeDetails: safeError.safeDetails }),
  });
}

function isJsonObject(value: unknown): value is JsonObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isClipProvider(descriptor: CapabilityDescriptor): boolean {
  return descriptor.provider.providerKind === 'CUSTOM' && descriptor.provider.providerType === 'clip_server';
}

const bashCapabilityId = brand<string, 'CapabilityId'>('Bash');

// Detects clipc structured event envelope in Bash tool stdout:
// {"status":"ok","data":{"raw":"{\"eventType\":...,\"messageType\":...,\"content\":...}"}}
function extractClipcStructuredEvent(structuredPayload: JsonObject): StructuredDeltaData | undefined {
  const exitCode = structuredPayload['exitCode'];
  const stdoutTruncated = structuredPayload['stdoutTruncated'];
  const stdout = structuredPayload['stdout'];
  if (exitCode !== 0 || stdoutTruncated === true || typeof stdout !== 'string') {
    return undefined;
  }
  const trimmed = stdout.trimStart();
  if (!trimmed.startsWith('{')) {
    return undefined;
  }
  let candidate: unknown;
  try {
    candidate = JSON.parse(stdout);
  } catch {
    return undefined;
  }
  return identifyStructuredDelta(candidate);
}

async function tryEmitToolStructuredDelta(
  runState: AgentRunStatePort,
  run: RequestRun,
  context: RequestContext,
  descriptor: CapabilityDescriptor,
  toolCallId: string,
  structuredPayload: JsonObject,
): Promise<void> {
  let structured: StructuredDeltaData | undefined;
  if (isClipProvider(descriptor)) {
    structured = identifyStructuredDelta(structuredPayload);
  } else if (descriptor.capabilityId === bashCapabilityId) {
    structured = extractClipcStructuredEvent(structuredPayload);
  }
  await emitStructuredDeltaData(runState, run, context, descriptor.capabilityId, toolCallId, structured);
}
