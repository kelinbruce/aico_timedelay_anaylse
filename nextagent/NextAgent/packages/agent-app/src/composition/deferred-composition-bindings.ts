import type { CapabilityInvocationPort, SubagentExecutionPort } from '@nextagent/agent-contracts/capability';
import type { WorkflowSandboxExecutionPort } from '@nextagent/agent-contracts/capability';
import type {
  LifecycleHookInvocationPort,
  LifecycleHookInvocationRequest,
  LifecycleHookInvocationResult,
  SessionTimelineEventInput,
} from '@nextagent/agent-contracts/runtime';
import type { createWorkflowRuntimeAdapters } from '@nextagent/agent-workflow';

type WorkflowRuntimeAdapters = ReturnType<typeof createWorkflowRuntimeAdapters>;
interface BackgroundRuntimeTimeline {
  emitSessionTimelineEvent: (input: SessionTimelineEventInput) => Promise<void>;
}

export class CompositionDeferredBindingUnavailableError extends Error {
  readonly code = 'COMPOSITION_DEFERRED_BINDING_UNBOUND';

  constructor(bindingName: string) {
    super(`Composition deferred binding for ${bindingName} is not bound.`);
    this.name = 'CompositionDeferredBindingUnavailableError';
  }
}

export interface CompositionDeferredBindings {
  readonly lifecycleHookInvocation: LifecycleHookInvocationPort;
  bindLifecycleHookInvocationTarget: (target: LifecycleHookInvocationPort) => void;
  workflowCapabilityInvocation: () => CapabilityInvocationPort | undefined;
  bindWorkflowCapabilityInvocation: (target: CapabilityInvocationPort) => void;
  workflowSandboxExecution: () => WorkflowSandboxExecutionPort | undefined;
  bindWorkflowSandboxExecution: (target: WorkflowSandboxExecutionPort) => void;
  workflowRuntimeAdapters: () => WorkflowRuntimeAdapters | undefined;
  bindWorkflowRuntimeAdapters: (target: WorkflowRuntimeAdapters) => void;
  runtimeSubagentExecution: () => SubagentExecutionPort | undefined;
  bindRuntimeSubagentExecution: (target: SubagentExecutionPort) => void;
  readonly backgroundRuntimeTimeline: BackgroundRuntimeTimeline;
  bindBackgroundRuntimeTimelineTarget: (target: BackgroundRuntimeTimeline) => void;
}

export function createCompositionDeferredBindings(): CompositionDeferredBindings {
  let lifecycleHookInvocationTarget: LifecycleHookInvocationPort | undefined;
  let workflowCapabilityInvocationTarget: CapabilityInvocationPort | undefined;
  let workflowSandboxExecutionTarget: WorkflowSandboxExecutionPort | undefined;
  let workflowRuntimeAdaptersTarget: WorkflowRuntimeAdapters | undefined;
  let runtimeSubagentExecutionTarget: SubagentExecutionPort | undefined;
  let backgroundRuntimeTimelineTarget: BackgroundRuntimeTimeline | undefined;

  return {
    lifecycleHookInvocation: {
      invoke: <S extends LifecycleHookInvocationRequest['stage']>(
        request: LifecycleHookInvocationRequest<S>,
        signal?: AbortSignal,
      ): Promise<LifecycleHookInvocationResult<S>> => {
        if (lifecycleHookInvocationTarget === undefined) {
          return Promise.resolve({ status: 'CONTINUE', boundary: request.boundary });
        }
        return lifecycleHookInvocationTarget.invoke(request, signal);
      },
    },
    bindLifecycleHookInvocationTarget(target) {
      assertNotBound('lifecycle hook invocation', lifecycleHookInvocationTarget);
      lifecycleHookInvocationTarget = target;
    },
    workflowCapabilityInvocation() {
      return workflowCapabilityInvocationTarget;
    },
    bindWorkflowCapabilityInvocation(target) {
      assertNotBound('workflow capability invocation', workflowCapabilityInvocationTarget);
      workflowCapabilityInvocationTarget = target;
    },
    workflowSandboxExecution() {
      return workflowSandboxExecutionTarget;
    },
    bindWorkflowSandboxExecution(target) {
      assertNotBound('workflow sandbox execution', workflowSandboxExecutionTarget);
      workflowSandboxExecutionTarget = target;
    },
    workflowRuntimeAdapters() {
      return workflowRuntimeAdaptersTarget;
    },
    bindWorkflowRuntimeAdapters(target) {
      assertNotBound('workflow runtime adapters', workflowRuntimeAdaptersTarget);
      workflowRuntimeAdaptersTarget = target;
    },
    runtimeSubagentExecution() {
      return runtimeSubagentExecutionTarget;
    },
    bindRuntimeSubagentExecution(target) {
      assertNotBound('runtime subagent execution', runtimeSubagentExecutionTarget);
      runtimeSubagentExecutionTarget = target;
    },
    backgroundRuntimeTimeline: {
      emitSessionTimelineEvent(input) {
        if (backgroundRuntimeTimelineTarget === undefined) {
          return Promise.reject(new CompositionDeferredBindingUnavailableError('background runtime timeline'));
        }
        return backgroundRuntimeTimelineTarget.emitSessionTimelineEvent(input);
      },
    },
    bindBackgroundRuntimeTimelineTarget(target) {
      assertNotBound('background runtime timeline', backgroundRuntimeTimelineTarget);
      backgroundRuntimeTimelineTarget = target;
    },
  };
}

function assertNotBound(name: string, currentTarget: unknown): void {
  if (currentTarget !== undefined) {
    throw new Error(`Composition deferred binding for ${name} is already bound.`);
  }
}
