import { AgentError, brand, getLogger, type AgentType, type EpochMillis, type JsonObject, type WorkflowNodeType } from '@nextagent/agent-common';
import type { AgentAssemblyRegistry } from '@nextagent/agent-contracts/agent-assembly';
import type {
  AttachmentRef,
  CapabilityCatalog,
  CapabilityDescriptor,
  CapabilityGeneratedMessage,
  CapabilityInvocationPort,
} from '@nextagent/agent-contracts/capability';
import type {
  RecipeDefinition,
  WorkflowExecutionEvent,
  WorkflowExecutionResumeState,
  WorkflowExecutionService,
  WorkflowLoopContext,
  WorkflowPendingInputActivation,
  WorkflowPendingInputQuestion,
  WorkflowPendingInputRequest,
} from '@nextagent/agent-contracts/core';
import type { ContextAssembly, ContextAssemblyOptions, ContextEnginePort, RenderedModelInput } from '@nextagent/agent-contracts/context';
import { type ModelFinalResult, type ModelInvocationService, type ModelToolCall } from '@nextagent/agent-contracts/model';
import type { ExecutionCorrelationPort } from '@nextagent/agent-contracts/observability';
import {
  LifecycleHookInterruptionError,
  type AgentExecutionOutcome,
  type AgentPolicyResolverPort,
  type AgentRunStatePort,
  type HookBoundaryByStage,
  type LifecycleHookInvocationPort,
  type LifecycleStage,
  type RequestContext,
  type RequestRun,
  type RiskPolicyEvaluator,
} from '@nextagent/agent-contracts/runtime';

import { BaseAgent } from './base-agent.js';
import { WorkflowRuntimeEventProjector } from './workflow-runtime-event-projector.js';
import { projectWorkflowExecutionResult } from './workflow-result-projector.js';
import { executeModelRoute } from '../model/model-route-execution.js';
import { flattenModelRequest } from '../model/model-request-builder.js';
import { assertTerminalContentComplete, assertTerminalContentPresent } from '../model/output-guard.js';
import {
  appendCapabilityResultMessage,
  buildFailedCapabilityPayload,
  buildModelVisibleCapabilityPayload,
} from '../tools/capability-result-projection.js';
import { tryEmitStructuredDelta } from '../tools/structured-delta-identification.js';
import {
  admitToolCalls,
  appendAssistantToolUseMessage,
  buildEmptyToolNameCorrectionMessage,
  buildToolCallLimitCorrectionMessage,
  executeToolCallsInOrder,
  hasEmptyToolName,
  readAskUserQuestionCountExceeded,
  readAskUserQuestionInputCorrection,
  type RequestLocalCapabilityState,
} from '../tools/tool-loop.js';
import { type AgentRoutingDecision, type AgentRoutingPolicy } from '../routing/agent-routing-policy.js';
import { decideAgentRoutingPolicy } from '../routing/agent-routing-policy-executor.js';
import { ModelFallbackOrchestrator } from '../routing/model-fallback-orchestrator.js';
import { RoutingConstraintGovernor, type GovernedRoutingConstraints } from '../routing/routing-constraint-governor.js';
import { RoutingEvidenceRecorder, type RoutingPolicyOutcome } from '../routing/routing-evidence-recorder.js';
import { TargetedSkillRouter } from '../routing/targeted-skill-router.js';

const workflowExecutionStateKey = 'workflowExecutionState';
const workflowPendingResumeKey = 'workflowPendingResume';
const terminalHookResumeSnapshotKey = 'terminalHookResumeSnapshot';
const toolCallLimitFeedbackFlowKey = 'toolCallLimitFeedback';
const rawUserQuestionFlowVariable = 'input_question';
const logger = getLogger({ component: 'agent-core', source: 'default-agent' });

export type { AgentRoutingPolicy };

export interface DefaultAgentDependencies {
  readonly contextEngine: ContextEnginePort;
  readonly model: ModelInvocationService;
  readonly capabilityCatalog: CapabilityCatalog;
  readonly capabilityInvocation: CapabilityInvocationPort;
  readonly isSandboxExecutionReady?: () => boolean;
  readonly assemblyRegistry: AgentAssemblyRegistry;
  readonly runState: AgentRunStatePort;
  readonly lifecycleHook?: LifecycleHookInvocationPort;
  readonly riskPolicyEvaluator?: RiskPolicyEvaluator;
  readonly policyResolver?: AgentPolicyResolverPort;
  readonly toolSearchSkillSearchEnabled?: boolean;
  readonly executionCorrelation?: ExecutionCorrelationPort;
  readonly resolveRecipeDefinition?: (request: { readonly agentId: RequestRun['agentId']; readonly recipeName: string }) => RecipeDefinition;
  readonly workflowExecutionService?: WorkflowExecutionService;
  readonly attachmentStore?: AttachmentRecordSource;
  readonly attachmentPathResolver?: (input: {
    readonly run: RequestRun;
    readonly context: RequestContext;
    readonly attachments: readonly AttachmentRef[];
    readonly signal?: AbortSignal;
  }) => Promise<readonly string[]>;
}

interface ModelTurnInput {
  readonly run: RequestRun;
  readonly context: RequestContext;
  readonly signal: AbortSignal;
  readonly round: number;
  readonly isFinalizing: boolean;
  readonly requestLocalCapabilityState: RequestLocalCapabilityState;
  readonly attemptedModelIds: Set<string>;
  readonly routingEvidence: RoutingEvidenceRecorder;
}

interface ModelTurnResult {
  readonly status: 'COMPLETED' | 'OUTPUT_TRUNCATED';
  readonly content: string;
  readonly toolCalls: readonly ModelToolCall[];
}

export class DefaultAgent extends BaseAgent<DefaultAgentDependencies> {
  static getType(): AgentType {
    return brand<string, 'AgentType'>('default');
  }

  constructor(deps: DefaultAgentDependencies) {
    super(deps);
  }

  protected async executeRun(run: RequestRun, context: RequestContext, signal: AbortSignal): Promise<AgentExecutionOutcome | void> {
    const attachmentRefs = await this.resolveAttachmentRefs(run, context);
    const attachmentPaths = await this.resolveAttachmentPaths(run, context, attachmentRefs);
    const routingEvidence = new RoutingEvidenceRecorder(this.deps.runState);
    const governedConstraints = new RoutingConstraintGovernor().govern(context);
    const routingDecision = await this.decideRouting(run, context, signal);
    await routingEvidence.record(run, context, {
      policyDomain: 'ROUTING',
      outcome: this.routingOutcomeForDecision(routingDecision),
      reasonCode: routingDecision.safeReason ?? 'ROUTING_DECISION_INVALID',
    });
    const acceptedAssembly = await this.translateRoutingDecision(routingDecision, run, context, governedConstraints);
    if (routingDecision.kind === 'DETERMINISTIC_FLOW' && routingDecision.recipeName !== undefined) {
      return await this.executeRecipeRoute(routingDecision.recipeName, run, context, signal);
    }
    const maxTurns = acceptedAssembly.runtimeSettings.maxTurns ?? 50;
    const maxToolCallsPerTurn = acceptedAssembly.runtimeSettings.maxToolCallsPerTurn ?? 30;
    if (context.routingConstraints !== undefined) {
      await routingEvidence.record(run, context, {
        policyDomain: 'CONSTRAINT',
        outcome: 'constraint-accepted',
        reasonCode: 'ROUTING_CONSTRAINTS_GOVERNED',
      });
    }

    const requestLocalCapabilityState: RequestLocalCapabilityState = { generatedMessages: [] };
    let initialTurn = context.agentTurnIndex;
    const attemptedModelIds = new Set<string>();

    const targetedSkillRouter = new TargetedSkillRouter({
      capabilityCatalog: this.deps.capabilityCatalog,
      capabilityInvocation: this.deps.capabilityInvocation,
      runState: this.deps.runState,
      routingEvidence,
    });

    if (routingDecision.kind === 'DETERMINISTIC_FLOW' && routingDecision.skillName !== undefined) {
      await targetedSkillRouter.invokeIfConfigured({
        run,
        context,
        signal,
        acceptedAssembly,
        requestLocalCapabilityState,
        governedConstraints,
        targetSkillOverride: routingDecision.skillName,
      });
    }

    if (context.nextLifecycleStage === 'BEFORE_MODEL_INVOKE') {
      await targetedSkillRouter.invokeIfConfigured({
        run,
        context,
        signal,
        acceptedAssembly,
        requestLocalCapabilityState,
        governedConstraints,
      });
    }

    if (context.nextLifecycleStage === 'BEFORE_CAPABILITY_INVOKE') {
      initialTurn = context.agentTurnIndex + 1;
      const recoveredPendingCalls = context.toolCallStates
        .filter((toolCall) => toolCall.status === 'PENDING')
        .map((toolCall) => ({
          toolCallId: toolCall.toolCallId,
          toolName: String(toolCall.capabilityId),
          arguments: toolCall.arguments,
        }));
      if (recoveredPendingCalls.length > 0) {
        const pendingInput = await executeToolCallsInOrder(
          {
            capabilityCatalog: this.deps.capabilityCatalog,
            capabilityInvocation: this.deps.capabilityInvocation,
            ...(this.deps.isSandboxExecutionReady === undefined ? {} : { isSandboxExecutionReady: this.deps.isSandboxExecutionReady }),
            ...(this.deps.riskPolicyEvaluator === undefined ? {} : { riskPolicyEvaluator: this.deps.riskPolicyEvaluator }),
            assemblyRegistry: this.deps.assemblyRegistry,
            ...(this.deps.toolSearchSkillSearchEnabled === true ? { toolSearchSkillSearchEnabled: true } : {}),
            ...(this.deps.lifecycleHook === undefined ? {} : { lifecycleHook: this.deps.lifecycleHook }),
            ...(this.deps.executionCorrelation === undefined ? {} : { executionCorrelation: this.deps.executionCorrelation }),
          },
          {
            run,
            context,
            runState: this.deps.runState,
            signal,
            round: 0,
            toolCalls: recoveredPendingCalls,
            requestLocalState: requestLocalCapabilityState,

            ...(attachmentPaths === undefined ? {} : { attachmentPaths }),
            forbiddenCapabilityIds: governedConstraints.forbiddenCapabilityIds,
            allowSubagents: governedConstraints.allowSubagents,
            persistAssistantToolUse: context.currentToolBatchMessageId === undefined,
            ...(context.currentToolBatchMessageId === undefined ? {} : { assistantToolUseMessageId: context.currentToolBatchMessageId }),
          },
        );
        if (pendingInput !== undefined) {
          return { status: 'PENDING_INPUT', pendingInput };
        }
      }
    }
    await this.appendDeferredToolCallLimitFeedback(run, context, requestLocalCapabilityState);

    for (let round = initialTurn; round <= maxTurns; round++) {
      const isFinalizing = round === maxTurns;
      context = { ...context, agentTurnIndex: round, activeStepId: `turn-${round + 1}` };
      const planningBoundary = await this.invokeLifecycleHook(
        run,
        context,
        'BEFORE_PLANNING',
        {
          stepId: `turn-${round + 1}`,
          roundIndex: round,
          locale: context.locale,
          acceptedInputSummary: 'accepted-request',
          attachmentCount: requestLocalCapabilityState.generatedMessages.length,
          flowVariables: context.flowVariables,
          ...(requestLocalCapabilityState.generatedMessages.length === 0
            ? {}
            : { capabilityGeneratedMessages: requestLocalCapabilityState.generatedMessages as unknown as readonly JsonObject[] }),
          ...(requestLocalCapabilityState.contextPatch === undefined
            ? {}
            : { capabilityContextPatch: requestLocalCapabilityState.contextPatch as unknown as JsonObject }),
        },
        signal,
        `round:${round}`,
      );
      context = applyPlanningBoundary(context, requestLocalCapabilityState, planningBoundary);
      if (isFinalizing) {
        await this.deps.runState.emitEvent(run, context, {
          type: 'DEGRADATION_NOTICE',
          inlinePayload: { code: 'TOOL_ROUND_LIMIT_EXCEEDED' },
        });
        requestLocalCapabilityState.generatedMessages.push({
          role: 'USER',
          content:
            'The Agent has reached its normal turn limit. Summarize only the verified results in the current transcript, clearly distinguish completed and incomplete work, and do not request or claim any additional Tool action.',
          meta: true,
        });
        requestLocalCapabilityState.contextPatch = {
          ...(requestLocalCapabilityState.contextPatch ?? {}),
          modelOptions: {
            ...(requestLocalCapabilityState.contextPatch?.modelOptions ?? {}),
            toolChoice: 'NONE',
          },
        };
      }
      await this.deps.runState.saveCheckpoint(run, context, 'STEP_STARTED');
      // Non-agentic API call: skip model invocation and execute ApiCall directly.
      // MUST check BEFORE executeModelTurn — nonAgentic flow should not invoke the model.
      // This handles resume scenarios where nonAgenticApiCall was set in a previous round.
      const _nonAgenticPayloadPre = context.flowVariables['nonAgenticApiCall'];
      if (
        _nonAgenticPayloadPre !== undefined &&
        _nonAgenticPayloadPre !== null &&
        typeof _nonAgenticPayloadPre === 'object' &&
        !Array.isArray(_nonAgenticPayloadPre)
      ) {
        const _apiPayloadPre = _nonAgenticPayloadPre as Record<string, unknown>;
        const _apiCommandRawPre = _apiPayloadPre['apiCommand'];
        const _apiNamePre =
          _apiCommandRawPre !== null && typeof _apiCommandRawPre === 'object' && !Array.isArray(_apiCommandRawPre)
            ? (_apiCommandRawPre as Record<string, unknown>)['name']
            : undefined;
        if (typeof _apiNamePre === 'string' && _apiNamePre.length > 0) {
          const _nonAgenticToolCallId = `func_${Date.now()}_nonagentic`;
          const _assistantToolUseMsgId = await appendAssistantToolUseMessage(
            this.deps.runState,
            run,
            context,
            [
              {
                toolCallId: _nonAgenticToolCallId,
                toolName: 'ApiCall',
                arguments: {
                  apiName: _apiNamePre,
                  ...(typeof (_apiCommandRawPre as Record<string, unknown> | undefined)?.['hiro'] === 'string'
                    ? { hiro: (_apiCommandRawPre as Record<string, unknown>)['hiro'] as string }
                    : {}),
                } as JsonObject,
              },
            ],
            '',
          );
          await this.deps.runState.emitEvent(run, context, {
            type: 'CAPABILITY_STARTED',
            inlinePayload: {
              capabilityId: 'ApiCall',
              toolCallId: _nonAgenticToolCallId,
              stepId: `turn-${round + 1}`,
              ...(_assistantToolUseMsgId !== undefined ? { messageId: _assistantToolUseMsgId } : {}),
            },
          });
          const _apiCallStartedAtPre = Date.now();
          await this.deps.runState.saveCheckpoint(run, context, 'CAPABILITY_AFTER_RETURN');
          let _streamDeltaTotalPre = 0;
          let _streamDeltaStructuredPre = 0;
          const _nonStructuredPartsPre: string[] = [];
          const _apiResultPre = await this.deps.capabilityInvocation.invoke(
            {
              invocationId: `${run.runId}:api-call:${_apiNamePre}`,
              capabilityId: brand<string, 'CapabilityId'>('ApiCall'),
              arguments: {
                apiName: _apiNamePre,
                ...(typeof (_apiCommandRawPre as Record<string, unknown> | undefined)?.['hiro'] === 'string'
                  ? { hiro: (_apiCommandRawPre as Record<string, unknown>)['hiro'] as string }
                  : {}),
                userQuestion: context.acceptedInputText ?? '',
                headerParams: extractHeaderParams(_apiPayloadPre, context.flowVariables),
                requestParams: extractRequestParams(
                  _apiPayloadPre,
                  attachmentRefs,
                  context.acceptedInputText ?? '',
                ) as import('@nextagent/agent-common').JsonObject,
                ...(typeof _apiPayloadPre['passThroughFlag'] === 'string' && _apiPayloadPre['passThroughFlag'].length > 0
                  ? { passThroughFlag: _apiPayloadPre['passThroughFlag'] }
                  : {}),
                skillName: typeof _apiPayloadPre['skillName'] === 'string' ? _apiPayloadPre['skillName'] : '',
                skillVersion: typeof _apiPayloadPre['skillVersion'] === 'string' ? _apiPayloadPre['skillVersion'] : 'unversioned',
                providerId: typeof _apiPayloadPre['providerId'] === 'string' ? _apiPayloadPre['providerId'] : '',
                sourceIdentity: typeof _apiPayloadPre['sourceIdentity'] === 'string' ? _apiPayloadPre['sourceIdentity'] : '',
                frontmatterHash: typeof _apiPayloadPre['frontmatterHash'] === 'string' ? _apiPayloadPre['frontmatterHash'] : '',
                skillBody: typeof _apiPayloadPre['skillBody'] === 'string' ? _apiPayloadPre['skillBody'] : '',
              },
              sessionId: run.sessionId,
              requestId: run.requestId,
              runId: run.runId,
              requestContextId: context.requestContextId,
              stepId: `round:${round}:api-call`,
              identityContext: context.identityContext,
              agentId: run.agentId,
              agentVersion: run.agentVersion,
              timeoutMs: run.deadlineAt !== undefined ? Math.max(1000, Number(run.deadlineAt) - Date.now()) : 600_000,
            },
            signal,
            {
              emitResultDelta: async (payload) => {
                const structuredPayload = payload.structuredPayload ?? {};
                // Unwrap nested structuredPayload envelope from api-call-tool streaming chunks so
                // tryEmitStructuredDelta receives the inner event object, not the wrapper.
                const _sdiCandidate = structuredPayload?.['structuredPayload'] ?? structuredPayload;
                _streamDeltaTotalPre++;
                const emitted = await tryEmitStructuredDelta(this.deps.runState, run, context, 'ApiCall', _nonAgenticToolCallId, _sdiCandidate, true);
                if (emitted) {
                  _streamDeltaStructuredPre++;
                  return;
                }
                _nonStructuredPartsPre.push(typeof _sdiCandidate === 'string' ? _sdiCandidate : JSON.stringify(_sdiCandidate));
                await this.deps.runState.emitEvent(run, context, {
                  type: 'CAPABILITY_RESULT_DELTA',
                  inlinePayload: {
                    capabilityId: 'ApiCall',
                    toolCallId: _nonAgenticToolCallId,
                    result: _sdiCandidate,
                  },
                });
              },
              flowVariables: context.flowVariables,
            },
          );
          await this.deps.runState.saveCheckpoint(run, context, 'CAPABILITY_AFTER_RETURN');
          const _sdiCandidatePre = (_apiResultPre.structuredPayload?.['structuredPayload'] ?? _apiResultPre.structuredPayload) as JsonObject;
          const _sdiEmittedPre = await tryEmitStructuredDelta(this.deps.runState, run, context, 'ApiCall', _nonAgenticToolCallId, _sdiCandidatePre);
          if (_sdiEmittedPre) {
            _streamDeltaStructuredPre++;
          }
          if (_apiResultPre.status === 'SUCCEEDED' || _apiResultPre.status === 'DEGRADED') {
            delete (context.flowVariables as Record<string, unknown>)['nonAgenticApiCall'];
            const _capabilityResultMsgIdPre = await appendCapabilityResultMessage(
              this.deps.runState,
              run,
              context,
              _nonAgenticToolCallId,
              'ApiCall',
              buildModelVisibleCapabilityPayload({
                structuredPayload: _apiResultPre.structuredPayload,
                ...(_apiResultPre.resultRef === undefined ? {} : { resultRef: _apiResultPre.resultRef }),
                ...(_apiResultPre.artifactRefs.length === 0 ? {} : { artifactRefs: _apiResultPre.artifactRefs }),
                ...(_apiResultPre.metadata === undefined ? {} : { metadata: _apiResultPre.metadata }),
              }),
            );
            if (_streamDeltaTotalPre === 0) {
              await this.deps.runState.emitEvent(run, context, {
                type: 'CAPABILITY_RESULT_DELTA',
                inlinePayload: {
                  capabilityId: 'ApiCall',
                  toolCallId: _nonAgenticToolCallId,
                  result: _apiResultPre.structuredPayload,
                },
              });
            }
            await this.deps.runState.emitEvent(run, context, {
              type: 'CAPABILITY_COMPLETED',
              inlinePayload: {
                ...(_capabilityResultMsgIdPre !== undefined ? { messageId: _capabilityResultMsgIdPre } : {}),
                capabilityId: 'ApiCall',
                toolCallId: _nonAgenticToolCallId,
                status: _apiResultPre.status,
                durationMs: Date.now() - _apiCallStartedAtPre,
              },
            });
            const _terminalContentPre = JSON.stringify(_apiResultPre.structuredPayload);
            attachTerminalHookResumeSnapshot(context, _terminalContentPre);
            await this.deps.runState.saveCheckpoint(run, context, 'TERMINAL_COMMIT_PENDING');
            const _terminalBoundaryPre = await this.invokeLifecycleHook(
              run,
              context,
              'BEFORE_AGENT_TERMINAL',
              {
                safeTerminalSummary: _terminalContentPre,
                finalContent: _terminalContentPre,
                toolCalls: [],
              },
              signal,
              `round:${round}:non-agentic-terminal`,
            );
            markTerminalLifecycleHookApplied(context);
            const _terminalToolCallsPre = _terminalBoundaryPre.toolCalls;
            if (_terminalToolCallsPre !== undefined && _terminalToolCallsPre.length > 0) {
              const _pendingInputPre = await executeToolCallsInOrder(
                {
                  capabilityCatalog: this.deps.capabilityCatalog,
                  capabilityInvocation: this.deps.capabilityInvocation,
                  ...(this.deps.isSandboxExecutionReady === undefined ? {} : { isSandboxExecutionReady: this.deps.isSandboxExecutionReady }),
                  ...(this.deps.riskPolicyEvaluator === undefined ? {} : { riskPolicyEvaluator: this.deps.riskPolicyEvaluator }),
                  assemblyRegistry: this.deps.assemblyRegistry,
                  ...(this.deps.toolSearchSkillSearchEnabled === true ? { toolSearchSkillSearchEnabled: true } : {}),
                  ...(this.deps.lifecycleHook === undefined ? {} : { lifecycleHook: this.deps.lifecycleHook }),
                  ...(this.deps.executionCorrelation === undefined ? {} : { executionCorrelation: this.deps.executionCorrelation }),
                },
                {
                  run,
                  context,
                  runState: this.deps.runState,
                  signal,
                  round,
                  toolCalls: _terminalToolCallsPre as unknown as NonNullable<ModelFinalResult['toolCalls']>,
                  requestLocalState: requestLocalCapabilityState,
                  assistantContent: '',
                  ...(attachmentPaths === undefined ? {} : { attachmentPaths }),
                  forbiddenCapabilityIds: governedConstraints.forbiddenCapabilityIds,
                  allowSubagents: governedConstraints.allowSubagents,
                },
              );
              if (_pendingInputPre !== undefined) {
                return { status: 'PENDING_INPUT', pendingInput: _pendingInputPre };
              }
              continue;
            }
            const _finalTerminalContentPre = _terminalBoundaryPre.finalContent;
            const _hasStructuredPre = _streamDeltaStructuredPre > 0;
            const _capabilityTerminalContentPre = _hasStructuredPre
              ? '\u200B'
              : _streamDeltaTotalPre > 0
                ? _nonStructuredPartsPre.join('')
                : _finalTerminalContentPre;
            await this.deps.runState.setCapabilityTerminalAnswer(run, context, { content: _capabilityTerminalContentPre });
            return undefined;
          }
          throw new AgentError({
            code: _apiResultPre.safeError?.code ?? 'API_CALL_FAILED',
            message: _apiResultPre.safeError?.message ?? 'API call failed safely.',
            category: _apiResultPre.safeError?.category ?? 'UNAVAILABLE',
            retryable: _apiResultPre.safeError?.retryable ?? false,
          });
        }
      }
      const modelTurn = await this.executeModelTurn({
        run,
        context,
        signal,
        round,
        isFinalizing,
        requestLocalCapabilityState,
        attemptedModelIds,
        routingEvidence,
      });
      const currentModelRoundContent = modelTurn.content;
      const isToolExecutionDisabled = isFinalizing || context.routingConstraints?.executionMode === 'model-only';
      const toolCalls = isToolExecutionDisabled ? [] : modelTurn.toolCalls;
      if (toolCalls.length === 0) {
        let terminalContent = currentModelRoundContent;
        logger.info({
          event: 'tool.loop.no_tool_calls',
          agentId: run.agentId,
          sessionId: run.sessionId,
          requestId: run.requestId,
          runId: run.runId,
          round,
          toolCallCount: 0,
          modelOutputCharCount: terminalContent.length,
        });
        if (isFinalizing && terminalContent.trim().length === 0) {
          throw new AgentError({
            code: 'TOOL_ROUND_LIMIT_EXCEEDED',
            message: 'The Agent reached the configured turn limit and the finalizing model turn did not provide a safe textual summary.',
            category: 'VALIDATION',
            retryable: false,
          });
        }
        const terminalGuard = isFinalizing || modelTurn.status === 'OUTPUT_TRUNCATED' ? undefined : todoTerminalGuard(context);
        if (terminalGuard !== undefined) {
          requestLocalCapabilityState.generatedMessages.push(terminalGuard);
          await this.deps.runState.emitEvent(run, context, {
            type: 'DEGRADATION_NOTICE',
            inlinePayload: {
              code: 'TODO_WRITE_UNFINISHED_TERMINAL_GUARD',
              reasonCode: 'TODO_WRITE_UNFINISHED',
              unfinishedTodoCount: unfinishedTodoCount(context),
            },
          });
          await this.deps.runState.saveCheckpoint(run, context, 'CAPABILITY_AFTER_RETURN');
          continue;
        }
        await this.assertTerminalContentReady(run, context, terminalContent);
        attachTerminalHookResumeSnapshot(context, terminalContent);
        await this.deps.runState.saveCheckpoint(run, context, 'TERMINAL_COMMIT_PENDING');
        const terminalBoundary = await this.invokeLifecycleHook(
          run,
          context,
          'BEFORE_AGENT_TERMINAL',
          {
            safeTerminalSummary: terminalContent,
            finalContent: terminalContent,
            toolCalls: [],
          },
          signal,
          `round:${round}:terminal`,
        );
        markTerminalLifecycleHookApplied(context);
        const terminalToolCalls = isToolExecutionDisabled ? [] : terminalBoundary.toolCalls;
        if (terminalToolCalls !== undefined && terminalToolCalls.length > 0) {
          if (terminalBoundary.finalContent !== terminalContent) {
            throw new AgentError({
              code: 'LIFECYCLE_HOOK_TERMINAL_MUTATION_CONFLICT',
              message: 'Lifecycle hook terminal tool calls cannot also replace final content.',
              category: 'VALIDATION',
              retryable: false,
            });
          }
          const pendingInput = await executeToolCallsInOrder(
            {
              capabilityCatalog: this.deps.capabilityCatalog,
              capabilityInvocation: this.deps.capabilityInvocation,
              ...(this.deps.isSandboxExecutionReady === undefined ? {} : { isSandboxExecutionReady: this.deps.isSandboxExecutionReady }),
              ...(this.deps.riskPolicyEvaluator === undefined ? {} : { riskPolicyEvaluator: this.deps.riskPolicyEvaluator }),
              assemblyRegistry: this.deps.assemblyRegistry,
              ...(this.deps.toolSearchSkillSearchEnabled === true ? { toolSearchSkillSearchEnabled: true } : {}),
              ...(this.deps.lifecycleHook === undefined ? {} : { lifecycleHook: this.deps.lifecycleHook }),
              ...(this.deps.executionCorrelation === undefined ? {} : { executionCorrelation: this.deps.executionCorrelation }),
            },
            {
              run,
              context,
              runState: this.deps.runState,
              signal,
              round,
              toolCalls: terminalToolCalls as unknown as NonNullable<ModelFinalResult['toolCalls']>,
              requestLocalState: requestLocalCapabilityState,
              assistantContent: currentModelRoundContent,

              ...(attachmentPaths === undefined ? {} : { attachmentPaths }),
              forbiddenCapabilityIds: governedConstraints.forbiddenCapabilityIds,
              allowSubagents: governedConstraints.allowSubagents,
            },
          );
          if (pendingInput !== undefined) {
            return { status: 'PENDING_INPUT', pendingInput };
          }
          continue;
        }
        terminalContent = terminalBoundary.finalContent;
        await this.assertTerminalContentReady(run, context, terminalContent);
        await this.deps.runState.emitEvent(run, context, { type: 'LLM_CONTENT_DELTA', inlinePayload: { final: true, content: terminalContent } });
        return undefined;
      }

      const admission = admitToolCalls(toolCalls, maxToolCallsPerTurn);
      if (hasEmptyToolName(admission.admitted)) {
        await this.deps.runState.emitEvent(run, context, { type: 'DEGRADATION_NOTICE', inlinePayload: { code: 'TOOL_NAME_EMPTY' } });
        requestLocalCapabilityState.generatedMessages.push({
          role: 'USER',
          content: buildEmptyToolNameCorrectionMessage(admission.admitted),
          meta: true,
        });
        if (admission.omittedCount > 0) {
          await this.deps.runState.emitEvent(run, context, { type: 'DEGRADATION_NOTICE', inlinePayload: { code: 'TOOL_CALL_LIMIT_EXCEEDED' } });
          requestLocalCapabilityState.generatedMessages.push({
            role: 'USER',
            content: buildToolCallLimitCorrectionMessage(admission),
            meta: true,
          });
        }
        continue;
      }

      if (admission.omittedCount > 0) {
        (context.flowVariables as Record<string, unknown>)[toolCallLimitFeedbackFlowKey] = buildToolCallLimitCorrectionMessage(admission);
      }
      try {
        const pendingInput = await executeToolCallsInOrder(
          {
            capabilityCatalog: this.deps.capabilityCatalog,
            capabilityInvocation: this.deps.capabilityInvocation,
            ...(this.deps.isSandboxExecutionReady === undefined ? {} : { isSandboxExecutionReady: this.deps.isSandboxExecutionReady }),
            ...(this.deps.riskPolicyEvaluator === undefined ? {} : { riskPolicyEvaluator: this.deps.riskPolicyEvaluator }),
            assemblyRegistry: this.deps.assemblyRegistry,
            ...(this.deps.toolSearchSkillSearchEnabled === true ? { toolSearchSkillSearchEnabled: true } : {}),
            ...(this.deps.lifecycleHook === undefined ? {} : { lifecycleHook: this.deps.lifecycleHook }),
            ...(this.deps.executionCorrelation === undefined ? {} : { executionCorrelation: this.deps.executionCorrelation }),
          },
          {
            run,
            context,
            runState: this.deps.runState,
            signal,
            round,
            toolCalls: admission.admitted,
            requestLocalState: requestLocalCapabilityState,
            assistantContent: currentModelRoundContent,
            ...(attachmentPaths === undefined ? {} : { attachmentPaths }),
            forbiddenCapabilityIds: governedConstraints.forbiddenCapabilityIds,
            allowSubagents: governedConstraints.allowSubagents,
          },
        );
        if (pendingInput !== undefined) {
          return { status: 'PENDING_INPUT', pendingInput };
        }
        await this.appendDeferredToolCallLimitFeedback(run, context, requestLocalCapabilityState);
        // Non-agentic API call detection
        const nonAgenticPayload = context.flowVariables['nonAgenticApiCall'];
        if (
          nonAgenticPayload !== undefined &&
          nonAgenticPayload !== null &&
          typeof nonAgenticPayload === 'object' &&
          !Array.isArray(nonAgenticPayload)
        ) {
          const apiPayload = nonAgenticPayload as Record<string, unknown>;
          const apiCommandRaw = apiPayload['apiCommand'];
          const apiName =
            apiCommandRaw !== null && typeof apiCommandRaw === 'object' && !Array.isArray(apiCommandRaw)
              ? (apiCommandRaw as Record<string, unknown>)['name']
              : undefined;
          if (typeof apiName === 'string' && apiName.length > 0) {
            if (admission.admittedCount > 1) {
              throw new AgentError({
                code: 'NON_AGENTIC_BATCH_CONFLICT',
                message: 'Non-agentic API call cannot be mixed with other tool calls.',
                category: 'VALIDATION',
                retryable: false,
              });
            }
            await this.deps.runState.saveCheckpoint(run, context, 'CAPABILITY_AFTER_RETURN');
            const apiToolCallId = `${run.runId}:api-call:${apiName}`;
            const apiAssistantMessageId = await appendAssistantToolUseMessage(this.deps.runState, run, context, [
              { toolCallId: apiToolCallId, toolName: 'ApiCall', arguments: { apiName } as JsonObject },
            ]);
            const apiCapabilityStartedAt = performance.now();
            await this.deps.runState.emitEvent(run, context, {
              type: 'CAPABILITY_STARTED',
              inlinePayload: {
                messageId: apiAssistantMessageId,
                capabilityId: 'ApiCall',
                toolCallId: apiToolCallId,
                stepId: `round:${round}:api-call`,
              },
            });
            let streamDeltaTotal = 0;
            let streamDeltaStructured = 0;
            const nonStructuredParts: string[] = [];
            const apiResult = await this.deps.capabilityInvocation.invoke(
              {
                invocationId: apiToolCallId,
                capabilityId: brand<string, 'CapabilityId'>('ApiCall'),
                arguments: {
                  apiName,
                  ...(typeof (apiCommandRaw as Record<string, unknown> | undefined)?.['hiro'] === 'string'
                    ? { hiro: (apiCommandRaw as Record<string, unknown>)['hiro'] as string }
                    : {}),
                  userQuestion: context.acceptedInputText ?? '',
                  headerParams: extractHeaderParams(apiPayload, context.flowVariables),
                  requestParams: extractRequestParams(
                    apiPayload,
                    attachmentRefs,
                    context.acceptedInputText ?? '',
                  ) as import('@nextagent/agent-common').JsonObject,
                  ...(typeof apiPayload['passThroughFlag'] === 'string' && apiPayload['passThroughFlag'].length > 0
                    ? { passThroughFlag: apiPayload['passThroughFlag'] }
                    : {}),
                  skillName: typeof apiPayload['skillName'] === 'string' ? apiPayload['skillName'] : '',
                  skillVersion: typeof apiPayload['skillVersion'] === 'string' ? apiPayload['skillVersion'] : 'unversioned',
                  providerId: typeof apiPayload['providerId'] === 'string' ? apiPayload['providerId'] : '',
                  sourceIdentity: typeof apiPayload['sourceIdentity'] === 'string' ? apiPayload['sourceIdentity'] : '',
                  frontmatterHash: typeof apiPayload['frontmatterHash'] === 'string' ? apiPayload['frontmatterHash'] : '',
                  skillBody: typeof apiPayload['skillBody'] === 'string' ? apiPayload['skillBody'] : '',
                },
                sessionId: run.sessionId,
                requestId: run.requestId,
                runId: run.runId,
                requestContextId: context.requestContextId,
                stepId: `round:${round}:api-call`,
                identityContext: context.identityContext,
                agentId: run.agentId,
                agentVersion: run.agentVersion,
                timeoutMs: run.deadlineAt !== undefined ? Math.max(1000, Number(run.deadlineAt) - Date.now()) : 600_000,
              },
              signal,
              {
                emitResultDelta: async (payload) => {
                  const structuredPayload = payload.structuredPayload ?? {};
                  // Unwrap nested structuredPayload envelope from api-call-tool streaming chunks so
                  // tryEmitStructuredDelta receives the inner event object, not the wrapper.
                  const _sdiCandidate = structuredPayload?.['structuredPayload'] ?? structuredPayload;
                  streamDeltaTotal++;
                  const emitted = await tryEmitStructuredDelta(this.deps.runState, run, context, 'ApiCall', apiToolCallId, _sdiCandidate, true);
                  if (emitted) {
                    streamDeltaStructured++;
                    return;
                  }
                  nonStructuredParts.push(typeof _sdiCandidate === 'string' ? _sdiCandidate : JSON.stringify(_sdiCandidate));
                  await this.deps.runState.emitEvent(run, context, {
                    type: 'CAPABILITY_RESULT_DELTA',
                    inlinePayload: {
                      capabilityId: 'ApiCall',
                      toolCallId: apiToolCallId,
                      result: _sdiCandidate,
                    },
                  });
                },
                flowVariables: context.flowVariables,
              },
            );
            await this.deps.runState.saveCheckpoint(run, context, 'CAPABILITY_AFTER_RETURN');
            const _sdiCandidateApi = (apiResult.structuredPayload?.['structuredPayload'] ?? apiResult.structuredPayload) as JsonObject;
            const _sdiEmittedApi = await tryEmitStructuredDelta(this.deps.runState, run, context, 'ApiCall', apiToolCallId, _sdiCandidateApi);
            if (_sdiEmittedApi) {
              streamDeltaStructured++;
            }
            const isSuccessfulApiResult = apiResult.status === 'SUCCEEDED' || apiResult.status === 'DEGRADED';
            const apiResultPayload = isSuccessfulApiResult
              ? buildModelVisibleCapabilityPayload({
                  structuredPayload: apiResult.structuredPayload,
                  ...(apiResult.resultRef === undefined ? {} : { resultRef: apiResult.resultRef }),
                  ...(apiResult.artifactRefs.length === 0 ? {} : { artifactRefs: apiResult.artifactRefs }),
                  ...(apiResult.metadata === undefined ? {} : { metadata: apiResult.metadata }),
                })
              : buildFailedCapabilityPayload({
                  status: apiResult.status,
                  structuredPayload: apiResult.structuredPayload,
                  ...(apiResult.safeError === undefined ? {} : { safeError: apiResult.safeError }),
                  ...(apiResult.resultRef === undefined ? {} : { resultRef: apiResult.resultRef }),
                  ...(apiResult.artifactRefs.length === 0 ? {} : { artifactRefs: apiResult.artifactRefs }),
                });
            const apiResultMessageId = await appendCapabilityResultMessage(
              this.deps.runState,
              run,
              context,
              apiToolCallId,
              'ApiCall',
              apiResultPayload,
            );
            if (streamDeltaTotal === 0) {
              await this.deps.runState.emitEvent(run, context, {
                type: 'CAPABILITY_RESULT_DELTA',
                inlinePayload: {
                  capabilityId: 'ApiCall',
                  toolCallId: apiToolCallId,
                  result: apiResult.structuredPayload,
                },
              });
            }
            await this.deps.runState.emitEvent(run, context, {
              type: 'CAPABILITY_COMPLETED',
              inlinePayload: {
                messageId: apiResultMessageId,
                capabilityId: 'ApiCall',
                toolCallId: apiToolCallId,
                status: apiResult.status,
                durationMs: Math.max(0, Math.round(performance.now() - apiCapabilityStartedAt)),
                ...(apiResult.safeError?.code === undefined ? {} : { safeErrorCode: apiResult.safeError.code }),
                ...(apiResult.safeError?.category === undefined ? {} : { safeErrorCategory: apiResult.safeError.category }),
              },
            });
            delete (context.flowVariables as Record<string, unknown>)['nonAgenticApiCall'];
            if (!isSuccessfulApiResult) {
              throw new AgentError({
                code: apiResult.safeError?.code ?? 'API_CALL_FAILED',
                message:
                  apiResult.safeError?.message ??
                  'The API capability failed without returning a valid safe error. Choose another capability, answer without this API, or end and report the failure.',
                category: apiResult.safeError?.category ?? 'UNAVAILABLE',
                retryable: apiResult.safeError?.retryable ?? false,
              });
            }
            const terminalContent = JSON.stringify(apiResult.structuredPayload);
            attachTerminalHookResumeSnapshot(context, terminalContent);
            await this.deps.runState.saveCheckpoint(run, context, 'TERMINAL_COMMIT_PENDING');
            const nonAgenticTerminalBoundary = await this.invokeLifecycleHook(
              run,
              context,
              'BEFORE_AGENT_TERMINAL',
              {
                safeTerminalSummary: terminalContent,
                finalContent: terminalContent,
                toolCalls: [],
              },
              signal,
              `round:${round}:non-agentic-terminal`,
            );
            markTerminalLifecycleHookApplied(context);
            const nonAgenticTerminalToolCalls = nonAgenticTerminalBoundary.toolCalls;
            if (nonAgenticTerminalToolCalls !== undefined && nonAgenticTerminalToolCalls.length > 0) {
              if (nonAgenticTerminalBoundary.finalContent !== terminalContent) {
                throw new AgentError({
                  code: 'LIFECYCLE_HOOK_TERMINAL_MUTATION_CONFLICT',
                  message: 'Lifecycle hook terminal tool calls cannot also replace final content.',
                  category: 'VALIDATION',
                  retryable: false,
                });
              }
              const pendingInput = await executeToolCallsInOrder(
                {
                  capabilityCatalog: this.deps.capabilityCatalog,
                  capabilityInvocation: this.deps.capabilityInvocation,
                  ...(this.deps.isSandboxExecutionReady === undefined ? {} : { isSandboxExecutionReady: this.deps.isSandboxExecutionReady }),
                  ...(this.deps.riskPolicyEvaluator === undefined ? {} : { riskPolicyEvaluator: this.deps.riskPolicyEvaluator }),
                  assemblyRegistry: this.deps.assemblyRegistry,
                  ...(this.deps.toolSearchSkillSearchEnabled === true ? { toolSearchSkillSearchEnabled: true } : {}),
                  ...(this.deps.lifecycleHook === undefined ? {} : { lifecycleHook: this.deps.lifecycleHook }),
                  ...(this.deps.executionCorrelation === undefined ? {} : { executionCorrelation: this.deps.executionCorrelation }),
                },
                {
                  run,
                  context,
                  runState: this.deps.runState,
                  signal,
                  round,
                  toolCalls: nonAgenticTerminalToolCalls as unknown as NonNullable<ModelFinalResult['toolCalls']>,
                  requestLocalState: requestLocalCapabilityState,
                  assistantContent: currentModelRoundContent,
                  ...(attachmentPaths === undefined ? {} : { attachmentPaths }),
                  forbiddenCapabilityIds: governedConstraints.forbiddenCapabilityIds,
                  allowSubagents: governedConstraints.allowSubagents,
                },
              );
              if (pendingInput !== undefined) {
                return { status: 'PENDING_INPUT', pendingInput };
              }
              continue;
            }
            const nonAgenticFinalContent = nonAgenticTerminalBoundary.finalContent;
            const hasStructuredStream = streamDeltaStructured > 0;
            const capabilityTerminalContent = hasStructuredStream
              ? '\u200B'
              : streamDeltaTotal > 0
                ? nonStructuredParts.join('')
                : nonAgenticFinalContent;
            await this.deps.runState.setCapabilityTerminalAnswer(run, context, { content: capabilityTerminalContent });
            return undefined;
          }
        }
      } catch (error) {
        const countExceeded = readAskUserQuestionCountExceeded(error);
        const inputCorrection = readAskUserQuestionInputCorrection(error);
        if (countExceeded === undefined && inputCorrection === undefined) {
          throw error;
        }
        if (inputCorrection !== undefined) {
          logger.warn({
            event: 'tool.loop.ask_user_question_input_recoverable',
            agentId: run.agentId,
            sessionId: run.sessionId,
            requestId: run.requestId,
            runId: run.runId,
            round,
          });
          await this.deps.runState.emitEvent(run, context, {
            type: 'DEGRADATION_NOTICE',
            inlinePayload: {
              code: 'ASK_USER_QUESTION_INPUT_INVALID',
            },
          });
          continue;
        }
        logger.warn({
          event: 'tool.loop.ask_user_question_count_recoverable',
          agentId: run.agentId,
          sessionId: run.sessionId,
          requestId: run.requestId,
          runId: run.runId,
          round,
          questionCount: countExceeded!.questionCount,
          maxQuestions: countExceeded!.maxQuestions,
        });
        await this.deps.runState.emitEvent(run, context, {
          type: 'DEGRADATION_NOTICE',
          inlinePayload: {
            code: 'ASK_USER_QUESTION_COUNT_EXCEEDED',
            questionCount: countExceeded!.questionCount,
            maxQuestions: countExceeded!.maxQuestions,
          },
        });
        continue;
      }
    }

    throw new AgentError({
      code: 'TOOL_ROUND_LIMIT_EXCEEDED',
      message: 'The Agent reached the configured turn limit and could not produce a safe final summary.',
      category: 'VALIDATION',
      retryable: false,
    });
  }

  private async appendDeferredToolCallLimitFeedback(
    run: RequestRun,
    context: RequestContext,
    requestLocalState: RequestLocalCapabilityState,
  ): Promise<void> {
    const flowVariables = context.flowVariables as Record<string, unknown>;
    const feedback = flowVariables[toolCallLimitFeedbackFlowKey];
    delete flowVariables[toolCallLimitFeedbackFlowKey];
    if (typeof feedback !== 'string') {
      return;
    }
    await this.deps.runState.emitEvent(run, context, {
      type: 'DEGRADATION_NOTICE',
      inlinePayload: { code: 'TOOL_CALL_LIMIT_EXCEEDED' },
    });
    requestLocalState.generatedMessages.push({ role: 'USER', content: feedback, meta: true });
  }

  private async executeModelTurn(input: ModelTurnInput): Promise<ModelTurnResult> {
    const stepId = `turn-${input.round + 1}`;
    const modelFallback = new ModelFallbackOrchestrator(input.routingEvidence);
    let { assembly, rendered } = await this.render(input.run, input.context, stepId, input.requestLocalCapabilityState, undefined, input.signal);
    let reasoningCorrectionAvailable = true;

    while (true) {
      const flattenedRequest = flattenModelRequest(input.run, input.context, rendered, stepId);
      const request = input.isFinalizing ? { ...flattenedRequest, toolChoice: 'NONE' as const } : flattenedRequest;
      const route = await executeModelRoute({
        model: this.deps.model,
        runState: this.deps.runState,
        run: input.run,
        context: input.context,
        signal: input.signal,
        assembly,
        request,
        reasoningCorrectionAvailable,
        ...(this.deps.executionCorrelation === undefined ? {} : { executionCorrelation: this.deps.executionCorrelation }),
      });
      if (route.reasoningCorrectionAttempted) {
        reasoningCorrectionAvailable = false;
      }
      if (route.status === 'OUTPUT_TRUNCATED') {
        return {
          status: route.status,
          content: route.content,
          toolCalls: [],
        };
      }

      const safeError = route.final.safeError;
      if (input.isFinalizing && route.isEmptyOutputSynthesized) {
        return {
          status: 'COMPLETED',
          content: route.content,
          toolCalls: [],
        };
      }
      if (safeError === undefined) {
        return {
          status: 'COMPLETED',
          content: route.content,
          toolCalls: route.final.toolCalls ?? [],
        };
      }
      if (input.isFinalizing) {
        return this.failModelTurn(input.run, input.context, safeError);
      }

      const fallbackAllowed = await modelFallback.allowFallback({
        run: input.run,
        context: input.context,
        request,
        safeError,
        stepHasVisibleOutput: route.stepHasVisibleOutput,
        attemptedModelIds: input.attemptedModelIds,
        signal: input.signal,
      });
      if (!fallbackAllowed) {
        return this.failModelTurn(input.run, input.context, safeError);
      }

      let fallbackRender: { readonly assembly: ContextAssembly; readonly rendered: RenderedModelInput };
      try {
        fallbackRender = await this.render(
          input.run,
          input.context,
          stepId,
          input.requestLocalCapabilityState,
          { mode: 'FALLBACK', attemptedModelIds: [...input.attemptedModelIds] },
          input.signal,
        );
      } catch (error) {
        const reasonCode = safeErrorCode(error);
        if (reasonCode !== 'FALLBACK_EXHAUSTED' && reasonCode !== 'NO_AVAILABLE_MODEL') {
          throw error;
        }
        await modelFallback.recordExhausted(input.run, input.context, reasonCode);
        return this.failModelTurn(input.run, input.context, safeError);
      }

      logger.warn({
        event: 'model.call.fallback',
        agentId: input.run.agentId,
        sessionId: input.run.sessionId,
        requestId: input.run.requestId,
        runId: input.run.runId,
        stepId: request.invocationScope.operationId,
        safeErrorCode: safeError.code,
        safeErrorCategory: safeError.category,
        fallbackCount: input.attemptedModelIds.size,
      });
      await input.routingEvidence.record(input.run, input.context, {
        policyDomain: 'MODEL_FALLBACK',
        outcome: 'fallback-applied',
        reasonCode: safeError.code,
      });
      assembly = fallbackRender.assembly;
      rendered = fallbackRender.rendered;
    }
  }

  private async failModelTurn(run: RequestRun, context: RequestContext, safeError: NonNullable<ModelFinalResult['safeError']>): Promise<never> {
    await this.deps.runState.emitEvent(run, context, {
      type: 'DEGRADATION_NOTICE',
      inlinePayload: { code: safeError.code, category: safeError.category },
    });
    throw new AgentError({
      code: safeError.code,
      message: safeError.message,
      category: safeError.category,
      retryable: safeError.retryable,
    });
  }

  private async resolveAttachmentRefs(run: RequestRun, context: RequestContext): Promise<readonly AttachmentRef[] | undefined> {
    if (this.deps.attachmentStore === undefined) {
      return undefined;
    }
    try {
      const records = await this.deps.attachmentStore.listAttachmentsBySession({
        tenantId: context.identityContext.tenantId,
        subjectId: context.identityContext.subjectId,
        agentId: run.agentId,
        sessionId: run.sessionId,
      });
      if (records.length === 0) {
        return undefined;
      }
      return records
        .filter((record) => record.validationStatus === 'ACCEPTED' && record.availabilityStatus === 'AVAILABLE')
        .map((record) => ({
          attachmentId: record.attachmentId,
          fileName: record.fileName,
          mediaType: record.mediaType,
          sizeBytes: record.sizeBytes,
          storageRef: record.storageRef,
        }));
    } catch {
      return undefined;
    }
  }

  private async resolveAttachmentPaths(
    run: RequestRun,
    context: RequestContext,
    attachments?: readonly AttachmentRef[],
  ): Promise<readonly string[] | undefined> {
    if (attachments === undefined || attachments.length === 0 || this.deps.attachmentPathResolver === undefined) {
      return undefined;
    }
    const paths = await this.deps.attachmentPathResolver({ run, context, attachments });
    return paths.length === 0 ? undefined : paths;
  }

  private async decideRouting(run: RequestRun, context: RequestContext, signal: AbortSignal): Promise<AgentRoutingDecision> {
    return decideAgentRoutingPolicy({
      assemblyRegistry: this.deps.assemblyRegistry,
      capabilityCatalog: this.deps.capabilityCatalog,
      ...(this.deps.policyResolver === undefined ? {} : { policyResolver: this.deps.policyResolver }),
      run,
      context,
      signal,
    });
  }

  private async translateRoutingDecision(
    decision: AgentRoutingDecision,
    run: RequestRun,
    context: RequestContext,
    governedConstraints: GovernedRoutingConstraints,
  ) {
    switch (decision.kind) {
      case 'MODEL_DRIVEN_LOOP':
      case 'DETERMINISTIC_FLOW':
        return decision.acceptedAssembly ?? this.deps.assemblyRegistry.require(run.agentId, run.agentVersion);
      case 'REJECT':
        throw new AgentError({
          code: 'ROUTING_REJECTED',
          message: 'Agent routing rejected the request safely.',
          category: 'VALIDATION',
          retryable: false,
          safeDetails: { reasonCode: decision.safeReason },
        });
      case 'CLARIFY':
      case 'HUMAN_HANDOFF':
        if ((decision.kind === 'CLARIFY' || decision.kind === 'HUMAN_HANDOFF') && !governedConstraints.allowHumanInput) {
          throw new AgentError({
            code: 'ROUTING_HUMAN_INPUT_DISALLOWED',
            message: 'Routing selected a human-input path that is disallowed by constraints.',
            category: 'VALIDATION',
            retryable: false,
            safeDetails: { reasonCode: decision.safeReason },
          });
        }
        throw new AgentError({
          code: 'ROUTING_DECISION_UNSUPPORTED',
          message: 'Agent routing selected an unsupported path for this change.',
          category: 'INTERNAL',
          retryable: false,
          safeDetails: { reasonCode: decision.safeReason },
        });
      default: {
        const unknown = decision as AgentRoutingDecision & { readonly kind: string };
        throw new AgentError({
          code: 'ROUTING_DECISION_INVALID',
          message: 'Agent routing produced an invalid decision.',
          category: 'INTERNAL',
          retryable: false,
          safeDetails: { reasonCode: unknown.kind },
        });
      }
    }
  }

  private routingOutcomeForDecision(decision: AgentRoutingDecision): RoutingPolicyOutcome {
    switch (decision.kind) {
      case 'MODEL_DRIVEN_LOOP':
      case 'DETERMINISTIC_FLOW':
        return 'selected';
      case 'REJECT':
        return 'rejected';
      case 'CLARIFY':
        return 'clarification';
      case 'HUMAN_HANDOFF':
        return 'handoff';
      default:
        return 'rejected';
    }
  }

  private async render(
    run: RequestRun,
    context: RequestContext,
    stepId: string,
    requestLocalCapabilityState: RequestLocalCapabilityState,
    options: ContextAssemblyOptions | undefined,
    signal: AbortSignal,
  ): Promise<{ readonly assembly: ContextAssembly; readonly rendered: RenderedModelInput }> {
    const capabilityGeneratedMessages = withCurrentTodoContext(requestLocalCapabilityState.generatedMessages, context);
    let assembly;
    try {
      assembly = await this.deps.contextEngine.assemble(
        {
          sessionId: run.sessionId,
          requestId: run.requestId,
          requestContextId: context.requestContextId,
          identityContext: context.identityContext,
          agentId: run.agentId,
          agentVersion: run.agentVersion,
          runId: run.runId,
          stepId,
          locale: context.locale,
          purpose: 'minimal-question-answer',
          flowVariables: projectTrustedPromptFlowVariables(context.flowVariables),
          ...(capabilityGeneratedMessages.length === 0 ? {} : { capabilityGeneratedMessages }),
          ...(requestLocalCapabilityState.contextPatch === undefined ? {} : { capabilityContextPatch: requestLocalCapabilityState.contextPatch }),
        },
        options,
        signal,
      );
    } catch (error) {
      // Section 6.1 / D6: runtime-owned degradation projection. The
      // context-engine's budget gate can fail with
      // CONTEXT_INSUFFICIENT_BUDGET when the minimum-safe baseline
      // exceeds the available input budget. Emit a DEGRADATION_NOTICE
      // runtime fact BEFORE re-throwing so the user-visible stream
      // receives the failure as a runtime-owned event (not a
      // locally-synthesized one). Re-throw preserves the error path
      // for the orchestrator (REQUEST_FAILED etc.).
      if (isContextInsufficientBudgetError(error)) {
        await this.deps.runState.emitEvent(run, context, {
          type: 'DEGRADATION_NOTICE',
          inlinePayload: {
            stepId,
            code: 'MINIMUM_SAFE_CONTEXT_EXCEEDS_BUDGET',
            decision: 'explicit_failure',
            reasonCode: 'MINIMUM_SAFE_CONTEXT_EXCEEDS_BUDGET',
          },
        });
      }
      throw error;
    }

    // Section 6.1 / D6: project non-`continue` budget decisions to the
    // runtime timeline as presentation-safe events. When compression
    // succeeded, emit CONTEXT_COMPACTED (a normal lifecycle event);
    // otherwise emit DEGRADATION_NOTICE for actual degradation.
    // The payload is the safe subset of `ContextCompactionPlan` fields
    // only; the raw per-source high-cardinality evidence array is
    // intentionally NOT projected.
    //
    // CONTEXT_COMPACTED must fire on EVERY successful compression, independent
    // of `budgetPlan.decision`: the real `DefaultProportionalBudgetPolicy`
    // returns `pre_send_check_required` (not `compact_degrade`) when the
    // compression threshold crosses, so the prior `decision !==
    // pre_send_check_required` guard wrongly swallowed the event and the
    // frontend never saw compression happen. The `pre_send_check_required`
    // exclusion only applies to DEGRADATION_NOTICE (an internal pre-flight
    // check that is not user-facing degradation).
    const compressionSucceeded = assembly.compressionEvidence !== undefined;
    const emitCompactedEvent = compressionSucceeded;
    const emitDegradationEvent =
      assembly.budgetPlan !== undefined &&
      assembly.budgetPlan.decision !== 'continue' &&
      assembly.budgetPlan.decision !== 'pre_send_check_required' &&
      !compressionSucceeded;
    if (emitCompactedEvent) {
      const evidence = assembly.compressionEvidence!;
      await this.deps.runState.emitEvent(run, context, {
        type: 'CONTEXT_COMPACTED',
        inlinePayload: {
          stepId,
          // Budget-plan fields are kept for the existing contract test that
          // asserts payload.decision / payload.code on a compact_degrade plan.
          ...(assembly.budgetPlan === undefined
            ? {}
            : {
                code: assembly.budgetPlan.reasonCode,
                decision: assembly.budgetPlan.decision,
                degradationMode: [...assembly.budgetPlan.degradationMode],
                omittedContextTypes: [...assembly.budgetPlan.omittedContextTypes],
                pipelineStageStoppedAt: assembly.budgetPlan.pipelineStageStoppedAt,
                estimatedFinalInputUnits: assembly.budgetPlan.estimatedFinalInputUnits,
              }),
          // Fields the stream-envelope projection copies (stream-envelope.ts
          // CONTEXT_COMPACTED branch). Without these the envelope payload was
          // empty and the frontend rendered a content-less event.
          summaryMessageId: evidence.summaryMessageId,
          contextVersion: evidence.targetActiveContextVersion,
          safeSummary: evidence.safeReason,
          ...(assembly.budgetPlan === undefined ? {} : { tokenEstimate: assembly.budgetPlan.estimatedFinalInputUnits }),
        },
      });
    } else if (emitDegradationEvent) {
      await this.deps.runState.emitEvent(run, context, {
        type: 'DEGRADATION_NOTICE',
        inlinePayload: {
          stepId,
          code: assembly.budgetPlan!.reasonCode,
          decision: assembly.budgetPlan!.decision,
          degradationMode: [...assembly.budgetPlan!.degradationMode],
          omittedContextTypes: [...assembly.budgetPlan!.omittedContextTypes],
          pipelineStageStoppedAt: assembly.budgetPlan!.pipelineStageStoppedAt,
          estimatedFinalInputUnits: assembly.budgetPlan!.estimatedFinalInputUnits,
        },
      });
    }

    if ((assembly.attachmentDegradationEvidence ?? []).length > 0) {
      await this.deps.runState.emitEvent(run, context, {
        type: 'DEGRADATION_NOTICE',
        inlinePayload: {
          stepId,
          code: (assembly.attachmentDegradationEvidence ?? []).map((evidence) => evidence.safeReasonCode)[0] ?? 'ATTACHMENT_EXCLUDED',
          decision: 'attachment_degradation',
          reasonCode: (assembly.attachmentDegradationEvidence ?? []).map((evidence) => evidence.safeReasonCode).join(','),
          safeSummary: 'attachment context degraded',
        },
      });
    }

    // add-ts-context-compression Section 6: after a successful
    // `commitCompaction` the runtime-owned checkpoint is recorded by
    // forwarding the engine-produced `ContextCompressionEvidence` to
    // the existing `runState.saveCheckpoint(...)` entry point. The
    // evidence is presentation-safe; the runtime does not need to
    // inspect it beyond the trigger-reason and the canonical
    // execution coordinates. No runtime-specific compression port is
    // introduced.
    if (assembly.compressionEvidence !== undefined) {
      await this.deps.runState.saveCheckpoint(run, context, 'CONTEXT_COMPACTED');
    }

    return {
      assembly,
      rendered: await this.deps.contextEngine.render(assembly),
    };
  }

  private async executeRecipeRoute(
    recipeName: string,
    run: RequestRun,
    context: RequestContext,
    signal: AbortSignal,
  ): Promise<AgentExecutionOutcome | void> {
    const resolveRecipeDefinition = this.deps.resolveRecipeDefinition;
    const workflowExecutionService = this.deps.workflowExecutionService;
    if (resolveRecipeDefinition === undefined || workflowExecutionService === undefined) {
      throw new AgentError({
        code: 'WORKFLOW_ROUTING_UNAVAILABLE',
        message: 'Workflow routing was selected but the workflow runtime is not composed.',
        category: 'UNAVAILABLE',
        retryable: true,
        safeDetails: { reasonCode: 'WORKFLOW_ROUTING_UNAVAILABLE', recipeName },
      });
    }
    const recipe = resolveRecipeDefinition({ agentId: run.agentId, recipeName });
    const rootWorkflowEventProjector = new WorkflowRuntimeEventProjector(recipe);
    const workflowEventProjectorsByExecution = new Map<string, WorkflowRuntimeEventProjector>();
    let rootExecutionId: string | undefined;
    const resumeState = readWorkflowResumeState(context.flowVariables, recipeName);
    const workflowRuntime = {
      requestPendingInput: async (rawRequest: JsonObject, _signal: AbortSignal) => {
        const request = readWorkflowPendingInputActivation(rawRequest);
        if (request === undefined) {
          throw new AgentError({
            code: 'WORKFLOW_PENDING_INPUT_BRIDGE_INVALID',
            message: 'Workflow pending input activation is invalid.',
            category: 'INTERNAL',
            retryable: false,
            safeDetails: { reasonCode: 'WORKFLOW_PENDING_INPUT_BRIDGE_INVALID', recipeName },
          });
        }
        const flowVariables = context.flowVariables as Record<string, JsonObject[keyof JsonObject] | undefined>;
        flowVariables[workflowExecutionStateKey] = {
          executionId: request.resumeState.executionId,
          recipeName: request.resumeState.recipeName,
          nodeId: request.resumeState.nodeId,
          nodeType: request.resumeState.nodeType,
          variables: request.resumeState.variables,
          ...(request.resumeState.loopContext === undefined
            ? {}
            : {
                loopContext: {
                  loopId: request.resumeState.loopContext.loopId,
                  iteration: request.resumeState.loopContext.iteration,
                  elementIndex: request.resumeState.loopContext.elementIndex,
                  collectedResults: request.resumeState.loopContext.collectedResults,
                },
              }),
        };
        delete flowVariables[workflowPendingResumeKey];
        const pendingInput = await this.deps.runState.requestPendingInput(
          run,
          context,
          {
            kind: request.kind,
            questions: request.questions,
            ...(request.timeoutAt === undefined ? {} : { timeoutAt: brand<number, 'EpochMillis'>(request.timeoutAt) as EpochMillis }),
          },
          {
            producerRef: {
              kind: 'WORKFLOW_NODE',
              recipeName: request.resumeState.recipeName,
              nodeId: request.resumeState.nodeId,
              nodeType: request.resumeState.nodeType,
              executionId: request.resumeState.executionId,
            },
            checkpointTrigger: 'STEP_STARTED',
          },
        );
        return workflowPendingInputRequestToJson({
          id: String(pendingInput.id),
          sessionId: pendingInput.sessionId,
          kind: pendingInput.kind,
          questions: pendingInput.questions,
          ...(pendingInput.timeoutAt === undefined ? {} : { timeoutAt: Number(pendingInput.timeoutAt) }),
        });
      },
      saveCheckpoint: async (input: { readonly resumeState: WorkflowExecutionResumeState }) => {
        const flowVariables = context.flowVariables as Record<string, JsonObject[keyof JsonObject] | undefined>;
        const rs = input.resumeState;
        flowVariables[workflowExecutionStateKey] = {
          executionId: rs.executionId,
          recipeName: rs.recipeName,
          nodeId: rs.nodeId,
          nodeType: rs.nodeType,
          variables: rs.variables,
          ...(rs.loopContext === undefined
            ? {}
            : {
                loopContext: {
                  loopId: rs.loopContext.loopId,
                  iteration: rs.loopContext.iteration,
                  elementIndex: rs.loopContext.elementIndex,
                  collectedResults: rs.loopContext.collectedResults,
                },
              }),
        };
        await this.deps.runState.saveCheckpoint(run, context, 'STEP_STARTED');
      },
    };
    const inputVariables = asJsonObject(context.flowVariables.input_variables);
    const attachmentRefs = await this.resolveAttachmentRefs(run, context);
    const fileContent =
      attachmentRefs !== undefined &&
      attachmentRefs.length > 0 &&
      !(inputVariables !== undefined && Object.prototype.hasOwnProperty.call(inputVariables, 'fileContent'))
        ? (JSON.parse(JSON.stringify(attachmentRefs[0])) as import('@nextagent/agent-common').JsonObject)
        : undefined;
    const workflowObserver = {
      registerExecutionRecipe(executionId: string, executionRecipe: RecipeDefinition) {
        if (rootExecutionId === undefined) {
          rootExecutionId = executionId;
          workflowEventProjectorsByExecution.set(executionId, new WorkflowRuntimeEventProjector(executionRecipe));
          return;
        }
        workflowEventProjectorsByExecution.set(executionId, new WorkflowRuntimeEventProjector(executionRecipe, 'SUB'));
      },
      emitEvent: async (event: WorkflowExecutionEvent) => {
        const projector = workflowEventProjectorsByExecution.get(event.executionId) ?? rootWorkflowEventProjector;
        for (const timelineEvent of projector.project(event)) {
          await this.deps.runState.emitEvent(run, context, timelineEvent);
        }
      },
    };
    const result = await workflowExecutionService.execute(
      {
        recipeName: recipe.recipeName,
        recipeVersion: recipe.version,
        inputVariables: {
          ...(inputVariables ?? {}),
          ...(fileContent !== undefined ? { fileContent } : {}),
        },
        ...(typeof context.flowVariables.input_question === 'string' ? { inputText: context.flowVariables.input_question } : {}),
        identityContext: context.identityContext,
        agentId: run.agentId,
        agentVersion: run.agentVersion,
        agentAssemblyRef: run.agentAssemblyRef,
        sessionId: run.sessionId,
        requestId: run.requestId,
        runId: run.runId,
        requestContextId: context.requestContextId,
        ...(resumeState === undefined ? {} : { resumeState: workflowResumeStateToJson(resumeState) }),
      },
      signal,
      workflowObserver,
      workflowRuntime,
    );
    const flowVariables = context.flowVariables as Record<string, JsonObject[keyof JsonObject] | undefined>;
    if (result.status === 'WAITING') {
      const pendingInput = readWorkflowPendingInputRequest(result.pendingInput);
      if (pendingInput === undefined) {
        throw new AgentError({
          code: 'WORKFLOW_PENDING_INPUT_MISSING',
          message: 'Workflow entered waiting state without a pending input payload.',
          category: 'INTERNAL',
          retryable: false,
          safeDetails: { reasonCode: 'WORKFLOW_PENDING_INPUT_MISSING', recipeName },
        });
      }
      return {
        status: 'PENDING_INPUT',
        pendingInput: {
          id: brand<string, 'PendingInputId'>(pendingInput.id),
          sessionId: brand<string, 'SessionId'>(pendingInput.sessionId),
          kind: pendingInput.kind,
          questions: pendingInput.questions,
          ...(pendingInput.timeoutAt === undefined ? {} : { timeoutAt: brand<number, 'EpochMillis'>(pendingInput.timeoutAt) as EpochMillis }),
        },
      };
    }
    delete flowVariables[workflowExecutionStateKey];
    delete flowVariables[workflowPendingResumeKey];
    const projection = projectWorkflowExecutionResult(recipe, result);
    if (projection.terminalError !== undefined) {
      await this.deps.runState.emitEvent(run, context, {
        type: 'LLM_CONTENT_DELTA',
        inlinePayload: {
          final: true,
          content: projection.terminalContent,
        },
      });
      throw projection.terminalError;
    }
    await this.deps.runState.setCapabilityTerminalAnswer(run, context, { content: projection.terminalContent });
    return undefined;
  }

  private async invokeLifecycleHook<S extends LifecycleStage>(
    run: RequestRun,
    context: RequestContext,
    stage: S,
    boundary: HookBoundaryByStage[S],
    signal: AbortSignal,
    occurrence: string,
  ): Promise<HookBoundaryByStage[S]> {
    if (this.deps.lifecycleHook === undefined) {
      return boundary;
    }
    const result = await this.deps.lifecycleHook.invoke(
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

  private async assertTerminalContentReady(run: RequestRun, context: RequestContext, finalContent: string): Promise<void> {
    try {
      assertTerminalContentPresent(finalContent);
      assertTerminalContentComplete(finalContent);
    } catch (error) {
      if (error instanceof AgentError) {
        await this.deps.runState.emitEvent(run, context, {
          type: 'DEGRADATION_NOTICE',
          inlinePayload: { code: error.code, category: error.category },
        });
      }
      throw error;
    }
  }
}

function readWorkflowResumeState(flowVariables: JsonObject, recipeName: string): WorkflowExecutionResumeState | undefined {
  const record = asRecord(flowVariables[workflowExecutionStateKey]);
  if (record === undefined || record['recipeName'] !== recipeName) {
    return undefined;
  }
  const nodeId = asString(record['nodeId']);
  const nodeType = asWorkflowNodeType(record['nodeType']);
  const variables = asJsonObject(record['variables']);
  if (nodeId === undefined || nodeType === undefined || variables === undefined) {
    return undefined;
  }
  const pendingResume = asRecord(flowVariables[workflowPendingResumeKey]);
  const answers = asStringMatrix(pendingResume?.['answers']);
  return {
    executionId: asString(record['executionId']) ?? `workflow-resume:${recipeName}:${nodeId}`,
    recipeName,
    nodeId,
    nodeType,
    variables,
    ...(asString(pendingResume?.['pendingInputId']) === undefined ? {} : { pendingInputId: asString(pendingResume?.['pendingInputId'])! }),
    ...(answers === undefined ? {} : { answers }),
    ...(asString(pendingResume?.['pendingAnswerSummary']) === undefined
      ? {}
      : { pendingAnswerSummary: asString(pendingResume?.['pendingAnswerSummary'])! }),
    ...(asWorkflowLoopContext(record['loopContext']) === undefined ? {} : { loopContext: asWorkflowLoopContext(record['loopContext'])! }),
  };
}

function asWorkflowLoopContext(value: unknown): WorkflowLoopContext | undefined {
  const record = asRecord(value);
  if (record === undefined) {
    return undefined;
  }
  const loopId = asString(record['loopId']);
  const iteration = typeof record['iteration'] === 'number' ? record['iteration'] : undefined;
  const elementIndex = typeof record['elementIndex'] === 'number' ? record['elementIndex'] : undefined;
  if (loopId === undefined || iteration === undefined || elementIndex === undefined) {
    return undefined;
  }
  const collectedResults = Array.isArray(record['collectedResults']) ? record['collectedResults'] : [];
  return { loopId, iteration, elementIndex, collectedResults };
}

function readWorkflowPendingInputActivation(value: JsonObject): WorkflowPendingInputActivation | undefined {
  const record = asRecord(value);
  if (record === undefined) {
    return undefined;
  }
  const kind = asPendingInputKind(record['kind']);
  const questions = asWorkflowPendingInputQuestions(record['questions']);
  const resumeState = asWorkflowExecutionResumeState(record['resumeState']);
  if (kind === undefined || questions === undefined || resumeState === undefined) {
    return undefined;
  }
  return {
    kind,
    questions,
    ...(typeof record['timeoutAt'] === 'number' ? { timeoutAt: record['timeoutAt'] } : {}),
    resumeState,
  };
}

function readWorkflowPendingInputRequest(value?: JsonObject): WorkflowPendingInputRequest | undefined {
  const record = asRecord(value);
  if (record === undefined) {
    return undefined;
  }
  const id = asString(record['id']);
  const sessionId = asString(record['sessionId']);
  const kind = asPendingInputKind(record['kind']);
  const questions = asWorkflowPendingInputQuestions(record['questions']);
  if (id === undefined || sessionId === undefined || kind === undefined || questions === undefined) {
    return undefined;
  }
  return {
    id,
    sessionId,
    kind,
    questions,
    ...(typeof record['timeoutAt'] === 'number' ? { timeoutAt: record['timeoutAt'] } : {}),
  };
}

function asWorkflowExecutionResumeState(value: unknown): WorkflowExecutionResumeState | undefined {
  const record = asRecord(value);
  if (record === undefined) {
    return undefined;
  }
  const executionId = asString(record['executionId']);
  const recipeName = asString(record['recipeName']);
  const nodeId = asString(record['nodeId']);
  const nodeType = asWorkflowNodeType(record['nodeType']);
  const variables = asJsonObject(record['variables']);
  if (executionId === undefined || recipeName === undefined || nodeId === undefined || nodeType === undefined || variables === undefined) {
    return undefined;
  }
  return {
    executionId,
    recipeName,
    nodeId,
    nodeType,
    variables,
    ...(asString(record['pendingInputId']) === undefined ? {} : { pendingInputId: asString(record['pendingInputId'])! }),
    ...(isStringMatrix(record['answers']) ? { answers: record['answers'] } : {}),
    ...(asString(record['pendingAnswerSummary']) === undefined ? {} : { pendingAnswerSummary: asString(record['pendingAnswerSummary'])! }),
    ...(asWorkflowLoopContext(record['loopContext']) === undefined ? {} : { loopContext: asWorkflowLoopContext(record['loopContext'])! }),
  };
}

function workflowResumeStateToJson(state: WorkflowExecutionResumeState): JsonObject {
  return {
    executionId: state.executionId,
    recipeName: state.recipeName,
    nodeId: state.nodeId,
    nodeType: state.nodeType,
    variables: state.variables,
    ...(state.pendingInputId === undefined ? {} : { pendingInputId: state.pendingInputId }),
    ...(state.answers === undefined ? {} : { answers: state.answers }),
    ...(state.pendingAnswerSummary === undefined ? {} : { pendingAnswerSummary: state.pendingAnswerSummary }),
  };
}

function workflowPendingInputRequestToJson(request: WorkflowPendingInputRequest): JsonObject {
  return {
    id: request.id,
    sessionId: request.sessionId,
    kind: request.kind,
    questions: request.questions.map((question) => ({
      prompt: question.prompt,
      options: question.options.map((option) => ({
        label: option.label,
        value: option.value,
      })),
      ...(question.multiple === undefined ? {} : { multiple: question.multiple }),
      ...(question.custom === undefined ? {} : { custom: question.custom }),
    })),
    ...(request.timeoutAt === undefined ? {} : { timeoutAt: request.timeoutAt }),
  };
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

function projectTrustedPromptFlowVariables(flowVariables: JsonObject): Readonly<Record<string, string>> {
  const projected: Record<string, string> = {};
  for (const [key, value] of Object.entries(flowVariables)) {
    if (key !== rawUserQuestionFlowVariable && typeof value === 'string') {
      projected[key] = value;
    }
  }
  return projected;
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function asJsonObject(value: unknown): JsonObject | undefined {
  return asRecord(value) as JsonObject | undefined;
}

function asWorkflowNodeType(value: unknown): WorkflowNodeType | undefined {
  return typeof value === 'string' && value.length > 0 ? (value as WorkflowNodeType) : undefined;
}

function asPendingInputKind(value: unknown): WorkflowPendingInputRequest['kind'] | undefined {
  return value === 'QUESTION' || value === 'CONFIRMATION' || value === 'AUTHORIZATION' || value === 'HUMAN_HANDOFF' ? value : undefined;
}

function asWorkflowPendingInputQuestions(value: unknown): readonly WorkflowPendingInputQuestion[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const questions = value.map((entry) => {
    const record = asRecord(entry);
    const prompt = asString(record?.['prompt']);
    const optionEntries = Array.isArray(record?.['options']) ? record['options'] : undefined;
    if (prompt === undefined || optionEntries === undefined) {
      return undefined;
    }
    const options = optionEntries.map((option) => {
      const optionRecord = asRecord(option);
      const label = asString(optionRecord?.['label']);
      const optionValue = asString(optionRecord?.['value']);
      return label === undefined || optionValue === undefined ? undefined : { label, value: optionValue };
    });
    if (options.some((option) => option === undefined)) {
      return undefined;
    }
    return {
      prompt,
      options: options as ReadonlyArray<{ readonly label: string; readonly value: string }>,
      ...(typeof record?.['multiple'] === 'boolean' ? { multiple: record['multiple'] } : {}),
      ...(typeof record?.['custom'] === 'boolean' ? { custom: record['custom'] } : {}),
    };
  });
  return questions.every((question) => question !== undefined) ? questions : undefined;
}

function asStringMatrix(value: unknown): ReadonlyArray<readonly string[]> | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const answers = value.map((entry) => (Array.isArray(entry) && entry.every((item) => typeof item === 'string') ? [...entry] : undefined));
  return answers.every((entry) => entry !== undefined) ? (answers as ReadonlyArray<readonly string[]>) : undefined;
}

function isStringMatrix(value: unknown): value is ReadonlyArray<readonly string[]> {
  return asStringMatrix(value) !== undefined;
}

function isContextInsufficientBudgetError(error: unknown): boolean {
  if (error === null || typeof error !== 'object') {
    return false;
  }
  const code = (error as { readonly code?: unknown }).code;
  return code === 'CONTEXT_INSUFFICIENT_BUDGET';
}

function safeErrorCode(error: unknown): string {
  return error instanceof AgentError ? error.code : '';
}

function applyPlanningBoundary(
  context: RequestContext,
  requestLocalCapabilityState: RequestLocalCapabilityState,
  boundary: HookBoundaryByStage['BEFORE_PLANNING'],
): RequestContext {
  if (boundary.capabilityGeneratedMessages !== undefined) {
    requestLocalCapabilityState.generatedMessages.splice(
      0,
      requestLocalCapabilityState.generatedMessages.length,
      ...(boundary.capabilityGeneratedMessages as unknown as RequestLocalCapabilityState['generatedMessages']),
    );
  }
  if (boundary.capabilityContextPatch !== undefined) {
    const contextPatch = boundary.capabilityContextPatch as unknown as NonNullable<RequestLocalCapabilityState['contextPatch']>;
    requestLocalCapabilityState.contextPatch = contextPatch;
  }
  if (boundary.flowVariables === undefined) {
    return context;
  }
  return {
    ...context,
    flowVariables: boundary.flowVariables,
  };
}

function withCurrentTodoContext(messages: readonly CapabilityGeneratedMessage[], context: RequestContext): readonly CapabilityGeneratedMessage[] {
  const todoMessage = renderCurrentTodoMessage(context);
  if (todoMessage === undefined || messages.some((message) => message.content === todoMessage.content)) {
    return messages;
  }
  return [...messages, todoMessage];
}

function todoTerminalGuard(context: RequestContext): CapabilityGeneratedMessage | undefined {
  if (unfinishedTodoCount(context) === 0) {
    return undefined;
  }
  const flowVariables = context.flowVariables as Record<string, unknown>;
  if (flowVariables['todoWriteTerminalGuarded'] === true) {
    return undefined;
  }
  flowVariables['todoWriteTerminalGuarded'] = true;
  return {
    role: 'USER',
    content: [
      'Current TodoWrite state still contains unfinished items.',
      'Before ending, either continue working on them with the available tools or call TodoWrite with an updated full list that marks completed work as completed.',
    ].join('\n'),
  };
}

function renderCurrentTodoMessage(context: RequestContext): CapabilityGeneratedMessage | undefined {
  const todos = currentTodos(context);
  if (todos.length === 0) {
    return undefined;
  }
  const lines = todos.map((todo, index) => `${index + 1}. [${todo.status}] ${todo.content} (${todo.activeForm})`);
  return {
    role: 'USER',
    content: [
      'Current TodoWrite state for this session/request context:',
      ...lines,
      'Use this state as the authoritative progress list. TodoWrite submits the full replacement list, including existing unfinished items.',
    ].join('\n'),
  };
}

function unfinishedTodoCount(context: RequestContext): number {
  return currentTodos(context).filter((todo) => todo.status !== 'completed').length;
}

function currentTodos(context: RequestContext): readonly TodoContextItem[] {
  const state = context.flowVariables['todoWriteState'];
  if (state === null || typeof state !== 'object' || Array.isArray(state)) {
    return [];
  }
  const todos = (state as Record<string, unknown>)['todos'];
  if (!Array.isArray(todos)) {
    return [];
  }
  return todos.flatMap((item): TodoContextItem[] => {
    if (item === null || typeof item !== 'object' || Array.isArray(item)) {
      return [];
    }
    const record = item as Record<string, unknown>;
    const content = record['content'];
    const activeForm = record['activeForm'];
    const status = record['status'];
    return typeof content === 'string' && typeof activeForm === 'string' && isTodoStatus(status) ? [{ content, activeForm, status }] : [];
  });
}

interface TodoContextItem {
  readonly content: string;
  readonly activeForm: string;
  readonly status: 'pending' | 'in_progress' | 'completed';
}

function isTodoStatus(value: unknown): value is TodoContextItem['status'] {
  return value === 'pending' || value === 'in_progress' || value === 'completed';
}

function markTerminalLifecycleHookApplied(context: RequestContext): void {
  Object.defineProperty(context.flowVariables as Record<string, unknown>, 'terminalLifecycleHookApplied', {
    value: true,
    enumerable: false,
    configurable: true,
  });
}

function attachTerminalHookResumeSnapshot(context: RequestContext, finalContent: string): void {
  (context.flowVariables as Record<string, unknown>)[terminalHookResumeSnapshotKey] = {
    finalContent,
    terminalStatus: 'COMPLETED',
  };
}
// Local port interface for attachment record access.
// Structural type matching AttachmentStoreGateway.listAttachmentsBySession
// without importing from agent-contracts/gateway (architecture boundary).
export interface AttachmentRecordSource {
  readonly listAttachmentsBySession: (request: {
    readonly tenantId: import('@nextagent/agent-common').TenantId;
    readonly subjectId: import('@nextagent/agent-common').SubjectId;
    readonly agentId: import('@nextagent/agent-common').AgentId;
    readonly sessionId: import('@nextagent/agent-common').SessionId;
  }) => Promise<
    ReadonlyArray<{
      readonly attachmentId: import('@nextagent/agent-common').AttachmentId;
      readonly fileName: string;
      readonly mediaType: string;
      readonly sizeBytes: number;
      readonly storageRef: string;
      readonly validationStatus: string;
      readonly availabilityStatus: string;
    }>
  >;
}

function extractHeaderParams(apiPayload: Record<string, unknown>, flowVariables: JsonObject): Record<string, string> {
  const headerParamNames =
    typeof apiPayload['apiHeaderParams'] === 'string'
      ? (apiPayload['apiHeaderParams'] as string)
          .split(',')
          .map((s) => s.trim())
          .filter((s) => s.length > 0)
      : [];
  const inputVariables = flowVariables['input_variables'];
  const requestHeaders =
    inputVariables !== undefined && inputVariables !== null && typeof inputVariables === 'object' && !Array.isArray(inputVariables)
      ? (inputVariables as Record<string, unknown>)['requestHeaders']
      : undefined;
  const requestHeadersMap =
    requestHeaders !== undefined && requestHeaders !== null && typeof requestHeaders === 'object' && !Array.isArray(requestHeaders)
      ? (requestHeaders as Record<string, unknown>)
      : {};
  const result: Record<string, string> = {};
  for (const name of headerParamNames) {
    const value = requestHeadersMap[name];
    result[name] = typeof value === 'string' ? value : '';
  }
  return result;
}

function extractRequestParams(
  apiPayload: Record<string, unknown>,
  attachmentRefs: readonly AttachmentRef[] | undefined,
  userQuestion: string,
): Record<string, unknown> {
  const requestParamNames =
    typeof apiPayload['apiRequestParams'] === 'string'
      ? (apiPayload['apiRequestParams'] as string)
          .split(',')
          .map((s) => s.trim())
          .filter((s) => s.length > 0)
      : [];
  const result: Record<string, unknown> = {};
  for (const name of requestParamNames) {
    if (name === 'hofsPath' && attachmentRefs !== undefined && attachmentRefs.length > 0) {
      result[name] = attachmentRefs.map((ref) => ref.storageRef);
    }
    if (name === 'query' && typeof userQuestion === 'string') {
      result[name] = userQuestion;
    }
  }
  return result;
}
