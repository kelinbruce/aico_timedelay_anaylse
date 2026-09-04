import type { RenderedModelInput } from '@nextagent/agent-contracts/context';
import type { ModelInferenceOptions, ModelInvocationRequest } from '@nextagent/agent-contracts/model';
import type { RequestContext, RequestRun } from '@nextagent/agent-contracts/runtime';

export function flattenModelRequest(run: RequestRun, context: RequestContext, rendered: RenderedModelInput, stepId: string): ModelInvocationRequest {
  const inference = mergeRequestModelOptions(rendered.modelOptions, context.requestModelOptions);
  const toolChoice =
    context.routingConstraints?.executionMode === 'model-only' ? 'NONE' : (inference.toolChoice ?? rendered.modelConfiguration.toolChoice);
  return {
    invocationScope: {
      tenantId: context.identityContext.tenantId,
      subjectId: context.identityContext.subjectId,
      agentId: run.agentId,
      agentVersion: run.agentVersion,
      agentAssemblyRef: run.agentAssemblyRef,
      operationId: stepId,
      sessionId: run.sessionId,
      requestId: run.requestId,
      runId: run.runId,
    },
    modelId: rendered.modelConfiguration.modelId,
    contextWindowTokens: rendered.modelConfiguration.contextWindowTokens,
    messages: rendered.messages,
    tools: rendered.tools,
    ...inference,
    ...(toolChoice === undefined ? {} : { toolChoice }),
    ...(rendered.providerOptions === undefined ? {} : { providerOptions: rendered.providerOptions }),
    timeoutMs: rendered.modelConfiguration.defaultTimeoutMs,
    maxRetries: rendered.modelConfiguration.defaultMaxRetries,
  };
}

function mergeRequestModelOptions(
  effective: RenderedModelInput['modelOptions'],
  requestModelOptions: RequestContext['requestModelOptions'],
): ModelInferenceOptions {
  return {
    ...effective,
    ...(requestModelOptions?.thinking?.depth === 'OFF' ? { thinking: { depth: 'OFF' as const } } : {}),
    ...(requestModelOptions?.toolChoice === undefined ? {} : { toolChoice: requestModelOptions.toolChoice }),
  };
}
