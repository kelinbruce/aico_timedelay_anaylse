import { AgentError, brand, type JsonValue, type MessageId } from '@nextagent/agent-common';
import type { AgentAssembly } from '@nextagent/agent-contracts/agent-assembly';
import type {
  CapabilityCatalog,
  CapabilityDescriptor,
  CapabilityInvocationPort,
  CapabilityInvocationResult,
  RuntimeCapabilityResolver,
} from '@nextagent/agent-contracts/capability';
import type { AgentRunStatePort, RequestContext, RequestRun } from '@nextagent/agent-contracts/runtime';

import { appendAssistantToolUseMessage, type RequestLocalCapabilityState } from '../tools/tool-loop.js';
import { capabilityStartedPayload, type CapabilityProcessIdentity } from '../tools/capability-lifecycle-payload.js';
import { authorizeCapabilityModelPatch, mergeGovernedCapabilityContextPatch } from '../model/capability-model-patch-resolver.js';
import {
  appendCapabilityResultMessage,
  buildFailedCapabilityPayload,
  buildModelVisibleCapabilityPayload,
} from '../tools/capability-result-projection.js';
import { runWithRoutingGuards } from './routing-async-guard.js';
import type { GovernedRoutingConstraints } from './routing-constraint-governor.js';
import { RoutingEvidenceRecorder } from './routing-evidence-recorder.js';

export interface TargetedSkillRouterDependencies {
  readonly capabilityCatalog: CapabilityCatalog;
  readonly capabilityInvocation: CapabilityInvocationPort;
  readonly runState: AgentRunStatePort;
  readonly routingEvidence: RoutingEvidenceRecorder;
}

interface DirectedSkillInvocationContext {
  readonly toolCallId: string;
  readonly processIdentity: CapabilityProcessIdentity;
  readonly assistantToolUseMessageId: MessageId;
  readonly startedAt: number;
}

export class TargetedSkillRouter {
  constructor(private readonly deps: TargetedSkillRouterDependencies) {}

  async invokeIfConfigured(input: {
    readonly run: RequestRun;
    readonly context: RequestContext;
    readonly signal: AbortSignal;
    readonly acceptedAssembly: AgentAssembly;
    readonly requestLocalCapabilityState: RequestLocalCapabilityState;
    readonly governedConstraints: GovernedRoutingConstraints;
    readonly targetSkillOverride?: string;
  }): Promise<void> {
    const { run, context, signal, acceptedAssembly, requestLocalCapabilityState, governedConstraints, targetSkillOverride } = input;
    const targetSkill = targetSkillOverride ?? context.routingConstraints?.targetSkill;
    if (targetSkill === undefined) {
      return;
    }
    if (signal.aborted) {
      throw new AgentError({
        code: 'ROUTING_ABORTED',
        message: 'Agent routing was canceled before directed Skill execution.',
        category: 'CANCELED',
        retryable: false,
        safeDetails: { reasonCode: 'ROUTING_ABORTED' },
      });
    }
    await this.deps.routingEvidence.record(run, context, {
      policyDomain: 'TARGETED_SKILL',
      outcome: 'constraint-accepted',
      reasonCode: 'PREFERRED_SKILL_REQUESTED',
      selectedCapabilityId: targetSkill,
    });
    await this.assertPreferredSkillAllowed(run, context, targetSkill, governedConstraints);

    const resolvedTargetSkill = await this.resolveCapability(run, context, acceptedAssembly, targetSkill, signal, 'directed Skill resolution');
    if (resolvedTargetSkill === undefined || resolvedTargetSkill.kind !== 'SKILL') {
      await this.deps.routingEvidence.record(run, context, {
        policyDomain: 'TARGETED_SKILL',
        outcome: 'constraint-rejected',
        reasonCode: 'PREFERRED_SKILL_UNAVAILABLE',
        selectedCapabilityId: targetSkill,
      });
      throw new AgentError({
        code: 'ROUTING_PREFERRED_SKILL_UNAVAILABLE',
        message:
          'The preferred Skill is unavailable in the accepted Agent assembly, so directed Skill loading did not start. Continue without that Skill, choose an available capability, or stop and report the unavailable target.',
        category: 'NOT_FOUND',
        retryable: false,
        safeDetails: { reasonCode: 'PREFERRED_SKILL_UNAVAILABLE', targetSkill },
      });
    }

    const skillTool = await this.resolveCapability(run, context, acceptedAssembly, 'Skill', signal, 'directed Skill preparation');
    if (skillTool === undefined || skillTool.kind !== 'TOOL') {
      throw new AgentError({
        code: 'ROUTING_PREFERRED_SKILL_TOOL_UNAVAILABLE',
        message:
          'Directed Skill loading could not start because the governed Skill loader capability is unavailable. Continue without the preferred Skill, choose another available capability, or stop and report the unavailable loader.',
        category: 'UNAVAILABLE',
        retryable: true,
      });
    }

    const toolCallId = `directed-skill:${resolvedTargetSkill.capabilityId}`;
    const assistantToolUseMessageId = await appendAssistantToolUseMessage(this.deps.runState, run, context, [
      { toolCallId, toolName: skillTool.capabilityId, arguments: { name: resolvedTargetSkill.capabilityId } },
    ]);
    const invocation: DirectedSkillInvocationContext = {
      toolCallId,
      processIdentity: {
        capabilityKind: skillTool.kind,
        capabilityId: skillTool.capabilityId,
        targetCapabilityId: resolvedTargetSkill.capabilityId,
      },
      assistantToolUseMessageId,
      startedAt: performance.now(),
    };
    await this.deps.runState.emitEvent(run, context, {
      type: 'CAPABILITY_STARTED',
      inlinePayload: capabilityStartedPayload({
        processIdentity: invocation.processIdentity,
        toolCallId: invocation.toolCallId,
        stepId: 'turn-1',
        messageId: invocation.assistantToolUseMessageId,
      }),
    });

    const result = await this.deps.capabilityInvocation.invoke(
      {
        invocationId: `${run.runId}:directed-skill:${resolvedTargetSkill.capabilityId}`,
        capabilityId: skillTool.capabilityId,
        resolvedDescriptor: skillTool,
        toolCallId: invocation.toolCallId,
        arguments: { name: resolvedTargetSkill.capabilityId },
        sessionId: run.sessionId,
        requestId: run.requestId,
        runId: run.runId,
        requestContextId: context.requestContextId,
        stepId: 'turn-1',
        identityContext: context.identityContext,
        agentId: run.agentId,
        agentVersion: run.agentVersion,
        timeoutMs: 30_000,
      },
      signal,
      {
        capabilityResolver: createDirectedSkillResolver(resolvedTargetSkill),
        // Trusted routing already resolved and governed this Skill for the request,
        // so it is disclosed for this invocation. Without it the Skill loader would
        // reject the directed load with SKILL_NOT_DISCOVERED whenever the Skill is
        // deferred or not model-invocable, which is exactly the rule-driven case.
        discoveredSkills: [resolvedTargetSkill.capabilityId],
      },
    );

    await this.consumeResult({
      run,
      context,
      acceptedAssembly,
      skillTool,
      resolvedTargetSkill,
      requestLocalCapabilityState,
      result,
      invocation,
    });
  }

  private async assertPreferredSkillAllowed(
    run: RequestRun,
    context: RequestContext,
    targetSkill: string,
    governedConstraints: GovernedRoutingConstraints,
  ): Promise<void> {
    if (governedConstraints.forbiddenCapabilityIds.has(targetSkill)) {
      await this.deps.routingEvidence.record(run, context, {
        policyDomain: 'TARGETED_SKILL',
        outcome: 'constraint-rejected',
        reasonCode: 'PREFERRED_SKILL_FORBIDDEN',
        selectedCapabilityId: targetSkill,
      });
      throw new AgentError({
        code: 'ROUTING_PREFERRED_SKILL_FORBIDDEN',
        message:
          'Directed Skill loading was rejected because the preferred Skill is forbidden by the accepted routing constraints. Continue without that Skill or choose a capability allowed by the current constraints; do not attempt to bypass them.',
        category: 'VALIDATION',
        retryable: false,
        safeDetails: { reasonCode: 'PREFERRED_SKILL_FORBIDDEN', targetSkill },
      });
    }
    if (context.routingConstraints?.executionMode === 'model-only') {
      await this.deps.routingEvidence.record(run, context, {
        policyDomain: 'TARGETED_SKILL',
        outcome: 'constraint-rejected',
        reasonCode: 'PREFERRED_SKILL_MODEL_ONLY',
        selectedCapabilityId: targetSkill,
      });
      throw new AgentError({
        code: 'ROUTING_PREFERRED_SKILL_MODEL_ONLY',
        message:
          'Directed Skill loading could not start because this request is model-only. Continue without the preferred Skill or submit a request that allows Tool execution.',
        category: 'VALIDATION',
        retryable: false,
        safeDetails: { reasonCode: 'PREFERRED_SKILL_MODEL_ONLY', targetSkill },
      });
    }
    if (run.deadlineAt !== undefined && Number(run.deadlineAt) <= Date.now()) {
      await this.deps.routingEvidence.record(run, context, {
        policyDomain: 'TARGETED_SKILL',
        outcome: 'degraded',
        reasonCode: 'PREFERRED_SKILL_DEADLINE_EXCEEDED',
        selectedCapabilityId: targetSkill,
      });
      throw new AgentError({
        code: 'ROUTING_PREFERRED_SKILL_DEADLINE_EXCEEDED',
        message:
          'Directed Skill loading could not start because the request deadline has elapsed. Continue without the preferred Skill or start a narrower request with a new deadline.',
        category: 'TIMEOUT',
        retryable: false,
        safeDetails: { reasonCode: 'PREFERRED_SKILL_DEADLINE_EXCEEDED', targetSkill },
      });
    }
  }

  private async resolveCapability(
    run: RequestRun,
    context: RequestContext,
    acceptedAssembly: AgentAssembly,
    capabilityId: string,
    signal: AbortSignal,
    canceledOperation: string,
  ): Promise<CapabilityDescriptor | undefined> {
    return await runWithRoutingGuards(
      this.deps.capabilityCatalog
        .resolve({
          tenantId: context.identityContext.tenantId,
          subjectId: context.identityContext.subjectId,
          ...(context.sessionId === undefined ? {} : { sessionId: context.sessionId }),
          agentAssembly: acceptedAssembly,
          capabilityId: brand<string, 'CapabilityId'>(capabilityId),
        })
        .catch((error) => {
          throw new AgentError({
            code: 'ROUTING_CONSTRAINT_DEPENDENCY_UNAVAILABLE',
            message:
              'Preferred Skill resolution failed before loading because the governed routing dependency is unavailable. Continue without the preferred Skill, choose another available capability, or try again later.',
            category: 'UNAVAILABLE',
            retryable: true,
            safeDetails: { reasonCode: 'ROUTING_CONSTRAINT_DEPENDENCY_UNAVAILABLE' },
            ...(error instanceof Error ? { cause: error } : {}),
          });
        }),
      run,
      {
        signal,
        ...(run.deadlineAt === undefined ? {} : { deadlineAt: run.deadlineAt }),
        timeoutCode: 'ROUTING_PREFERRED_SKILL_RESOLVE_TIMEOUT',
        timeoutMessage:
          'Preferred Skill resolution timed out before loading. Continue without the preferred Skill, choose another available capability, or try the resolution again later.',
        canceledMessage: `Agent routing was canceled during ${canceledOperation}.`,
      },
    );
  }

  private async consumeResult(input: {
    readonly run: RequestRun;
    readonly context: RequestContext;
    readonly acceptedAssembly: AgentAssembly;
    readonly skillTool: CapabilityDescriptor;
    readonly resolvedTargetSkill: CapabilityDescriptor;
    readonly requestLocalCapabilityState: RequestLocalCapabilityState;
    readonly result: CapabilityInvocationResult;
    readonly invocation: DirectedSkillInvocationContext;
  }): Promise<void> {
    const { run, context, acceptedAssembly, skillTool, resolvedTargetSkill, requestLocalCapabilityState, result, invocation } = input;
    const { toolCallId, processIdentity, startedAt } = invocation;
    const payload =
      result.status === 'FAILED' || result.status === 'TIMED_OUT'
        ? buildFailedCapabilityPayload({
            status: result.status,
            structuredPayload: result.structuredPayload,
            ...(result.safeError === undefined ? {} : { safeError: result.safeError }),
          })
        : buildModelVisibleCapabilityPayload(result);
    const capabilityResultMessageId = await appendCapabilityResultMessage(
      this.deps.runState,
      run,
      context,
      toolCallId,
      skillTool.capabilityId,
      payload,
    );
    await this.deps.runState.emitEvent(run, context, {
      type: 'CAPABILITY_COMPLETED',
      inlinePayload: {
        messageId: capabilityResultMessageId,
        ...processIdentity,
        toolCallId,
        status: result.status,
        durationMs: Math.max(0, Math.round(performance.now() - startedAt)),
        ...(result.safeError?.code === undefined ? {} : { safeErrorCode: result.safeError.code }),
        ...(result.safeError?.category === undefined ? {} : { safeErrorCategory: result.safeError.category }),
      },
    });
    if (result.status === 'FAILED' || result.status === 'TIMED_OUT') {
      throw new AgentError({
        code: result.safeError?.code ?? 'ROUTING_PREFERRED_SKILL_FAILED',
        message:
          result.safeError?.message ??
          'The preferred Skill failed during governed loading without a valid safe error. Continue without that Skill, choose another available capability, or stop and report the loading failure.',
        category: result.safeError?.category ?? 'UNAVAILABLE',
        retryable: result.safeError?.retryable ?? false,
        safeDetails: {
          reasonCode: result.safeError?.code ?? 'ROUTING_PREFERRED_SKILL_FAILED',
          targetSkill: resolvedTargetSkill.capabilityId,
          ...(result.safeError?.safeDetails ?? {}),
        },
      });
    }
    // Detect non-agentic API call signal from Skill tool result (same logic as tool-loop).
    // Without this, the TargetedSkillRouter path injects the Skill body into model context
    // and the model calls ApiCall itself, which loses the array-typed parameters
    // (e.g. hofsPath becomes a string instead of an array).
    if (result.metadata?.['nonAgenticApiCall'] === true && result.status === 'SUCCEEDED') {
      const flowVars = context.flowVariables as Record<string, JsonValue | undefined>;
      flowVars['nonAgenticApiCall'] = result.structuredPayload;
    }
    // Current inline Skill results carry the body in `structuredPayload.body`.
    // Keep this compatibility path for legacy or provider-specific results that
    // still return a generated USER message: persist it once as page-hidden
    // model context and avoid also pushing it into request-local volatile state.
    const skillBodyMessage = result.generatedMessages.find(
      (message) => message.role === 'USER' && message.meta === true && typeof message.content === 'string',
    );
    const canPersistSkillBody = skillBodyMessage !== undefined && this.deps.runState.appendGeneratedUserMessage !== undefined;
    requestLocalCapabilityState.generatedMessages.push(
      ...result.generatedMessages.filter((message) => message !== skillBodyMessage || !canPersistSkillBody),
    );
    if (result.contextPatch !== undefined) {
      requestLocalCapabilityState.contextPatch = mergeGovernedCapabilityContextPatch(
        requestLocalCapabilityState.contextPatch,
        result.contextPatch,
        authorizeCapabilityModelPatch(skillTool, result.contextPatch, acceptedAssembly),
      );
    }
    // Persist the Skill body as a fixed, page-hidden (`visible:false`) USER
    // message carrying `metadata.modelVisibility.included=true`, appended right
    // after the tool-result pair so its sequence ordinal places it immediately
    // after the user question within the loading round. `included=true` admits
    // it to model context despite `visible:false` (page-hidden). Because it is a
    // durable messageStore row it survives pending-input suspend/resume and
    // stays in place every round — it is NOT re-fed via the request-local
    // volatile state (consumed above), so it does not drift or duplicate.
    if (canPersistSkillBody) {
      await this.deps.runState.appendGeneratedUserMessage!(run, context, {
        role: 'USER',
        content: skillBodyMessage!.content,
        contentType: 'PLAIN_TEXT',
        visible: false,
        metadata: {
          modelVisibility: { included: true, reason: 'SKILL_BODY' },
          skillName: resolvedTargetSkill.capabilityId,
        },
        idempotencyKey: brand<string, 'IdempotencyKey'>(`${run.runId}:skill-content:${resolvedTargetSkill.capabilityId}`),
      });
    }
    if (result.status === 'DEGRADED') {
      await this.deps.routingEvidence.record(run, context, {
        policyDomain: 'TARGETED_SKILL',
        outcome: 'degraded',
        reasonCode: result.safeError?.code ?? 'DIRECTED_SKILL_DEGRADED',
        selectedCapabilityId: resolvedTargetSkill.capabilityId,
      });
      await this.deps.runState.emitEvent(run, context, {
        type: 'DEGRADATION_NOTICE',
        inlinePayload: { code: result.safeError?.code ?? 'DIRECTED_SKILL_DEGRADED' },
      });
      return;
    }
    await this.deps.routingEvidence.record(run, context, {
      policyDomain: 'TARGETED_SKILL',
      outcome: 'selected',
      reasonCode: 'PREFERRED_SKILL_LOADED',
      selectedCapabilityId: resolvedTargetSkill.capabilityId,
    });
  }
}

function createDirectedSkillResolver(resolvedTargetSkill: CapabilityDescriptor): RuntimeCapabilityResolver {
  return {
    async resolveCapability(request, signal) {
      if (signal.aborted) {
        return undefined;
      }
      return request.kind === 'SKILL' && request.capabilityId === resolvedTargetSkill.capabilityId ? resolvedTargetSkill : undefined;
    },
  };
}
