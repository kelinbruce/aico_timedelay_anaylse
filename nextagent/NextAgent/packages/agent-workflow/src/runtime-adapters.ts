import { AgentError, brand } from '@nextagent/agent-common';
import type { AgentAssemblyRegistry } from '@nextagent/agent-contracts/agent-assembly';
import type {
  CapabilityCatalog,
  CapabilityDescriptor,
  RuntimeCapabilityListRequest,
  RuntimeCapabilityResolveRequest,
  RuntimeCapabilityResolver,
} from '@nextagent/agent-contracts/capability';
import type { WorkflowExecutionRequest } from '@nextagent/agent-contracts/core';
import type {
  ModelCatalogQueryService,
  ModelInferenceOptions,
  ModelProviderProfile,
  ResolvedModelConfiguration,
} from '@nextagent/agent-contracts/model';
import type { ModelSelectionService } from '@nextagent/agent-contracts/context';
import type { CreateWorkflowNodeCatalogOptions, WorkflowNodeLlmPromptRequest, WorkflowNodeModelInvocationConfig } from './nodes/index.js';

export interface WorkflowPromptAssemblyRequest {
  readonly purpose: string;
  readonly agentId: WorkflowExecutionRequest['agentId'];
  readonly agentVersion: WorkflowExecutionRequest['agentVersion'];
  readonly selectedModel: {
    readonly modelId: string;
  };
}

export interface WorkflowPromptAssemblyResult {
  readonly renderedContent: string;
  readonly modelOptions?: ModelInferenceOptions;
}

export interface WorkflowRuntimeAdaptersOptions {
  readonly catalog: CapabilityCatalog;
  readonly assemblyRegistry: Pick<AgentAssemblyRegistry, 'require'>;
  readonly modelSelectionService: ModelSelectionService;
  readonly assemblePrompt: (request: WorkflowPromptAssemblyRequest) => Promise<WorkflowPromptAssemblyResult> | WorkflowPromptAssemblyResult;
  readonly modelProfiles?: readonly ModelProviderProfile[];
  readonly modelCatalog?: ModelCatalogQueryService;
}

export function createWorkflowRuntimeAdapters(
  input: WorkflowRuntimeAdaptersOptions,
): Pick<
  CreateWorkflowNodeCatalogOptions,
  'runtimeCapabilityResolver' | 'resolveModelInvocationConfig' | 'prepareLlmPrompt' | 'resolveModelForParamExtract'
> {
  const isModelGateway = Array.isArray(input.modelProfiles) && input.modelProfiles.some((p) => p.providerId === 'model-gateway');
  return {
    runtimeCapabilityResolver: (request) => createWorkflowRuntimeCapabilityResolver(input, request),
    resolveModelInvocationConfig: async (request, signal, hint) => {
      const assembly = await input.assemblyRegistry.require(request.agentId, request.agentVersion);
      const selected = await input.modelSelectionService.select(
        {
          identityContext: request.identityContext,
          agentId: assembly.agentId,
          agentVersion: assembly.agentVersion,
          agentAssemblyRef: assembly.agentAssemblyRef,
          purpose: hint?.capabilityId ?? 'WORKFLOW_MODEL_NODE',
          flowVariables: {},
          mode: 'INITIAL',
          ...(hint?.modelId === undefined ? {} : { modelId: hint.modelId }),
        },
        signal,
      );
      if (selected.status === 'FAILED') {
        if (selected.failureReason === 'MODEL_ID_NOT_ELIGIBLE' && isModelGateway && hint?.modelId !== undefined) {
          return resolveModelGatewayConfig(input, hint.modelId, signal);
        }
        throw new AgentError({
          code: selected.failureReason,
          message: 'Workflow model selection failed safely.',
          category: 'VALIDATION',
          retryable: false,
        });
      }
      return workflowModelInvocationConfig(selected.configuration);
    },
    prepareLlmPrompt: async (request) => prepareWorkflowLlmPrompt(input, request),
    resolveModelForParamExtract: async (request, signal, model, modelGroup) => {
      void modelGroup;
      const assembly = await input.assemblyRegistry.require(request.agentId, request.agentVersion);
      const selected = await input.modelSelectionService.select(
        {
          identityContext: request.identityContext,
          agentId: assembly.agentId,
          agentVersion: assembly.agentVersion,
          agentAssemblyRef: assembly.agentAssemblyRef,
          purpose: 'API_PARAMETER_EXTRACTION',
          flowVariables: {},
          mode: 'INITIAL',
          ...(model === undefined ? {} : { modelId: model }),
        },
        signal,
      );
      if (selected.status === 'FAILED') {
        if (selected.failureReason === 'MODEL_ID_NOT_ELIGIBLE' && isModelGateway && model !== undefined) {
          return resolveModelGatewayConfig(input, model, signal);
        }
        throw new AgentError({
          code: selected.failureReason,
          message: 'Workflow parameter-extraction model selection failed safely.',
          category: 'VALIDATION',
          retryable: false,
        });
      }
      return workflowModelInvocationConfig(selected.configuration);
    },
  };
}

async function resolveModelGatewayConfig(
  input: WorkflowRuntimeAdaptersOptions,
  requestedModelId: string,
  signal: AbortSignal,
): Promise<WorkflowNodeModelInvocationConfig> {
  const gatewayProfile = input.modelProfiles?.find((p) => p.providerId === 'model-gateway');
  const registeredModelId = gatewayProfile?.models?.[0]?.modelId;
  if (registeredModelId !== undefined && input.modelCatalog !== undefined) {
    const entry = await input.modelCatalog.get(registeredModelId, signal);
    if (entry?.availability === 'AVAILABLE') {
      const gatewayConfig = {
        ...entry.configuration,
        modelId: requestedModelId,
      };
      return workflowModelInvocationConfig(gatewayConfig);
    }
  }
  throw new AgentError({
    code: 'MODEL_ID_NOT_ELIGIBLE',
    message: 'Workflow model selection failed safely.',
    category: 'VALIDATION',
    retryable: false,
  });
}

function createWorkflowRuntimeCapabilityResolver(
  input: WorkflowRuntimeAdaptersOptions,
  workflowRequest: WorkflowExecutionRequest,
): RuntimeCapabilityResolver {
  return {
    async resolveCapability(request: RuntimeCapabilityResolveRequest, signal: AbortSignal): Promise<CapabilityDescriptor | undefined> {
      if (signal.aborted) {
        return undefined;
      }
      const assembly = await input.assemblyRegistry.require(workflowRequest.agentId, workflowRequest.agentVersion);
      const candidate = await input.catalog.resolve({
        tenantId: workflowRequest.identityContext.tenantId,
        subjectId: workflowRequest.identityContext.subjectId,
        agentAssembly: assembly,
        capabilityId: request.capabilityId,
        ...(workflowRequest.sessionId === undefined ? {} : { sessionId: brand<string, 'SessionId'>(workflowRequest.sessionId) }),
      });
      if (
        signal.aborted ||
        candidate === undefined ||
        candidate.kind !== request.kind ||
        candidate.availabilityStatus !== 'AVAILABLE' ||
        (request.providerId !== undefined && candidate.provider.providerId !== request.providerId)
      ) {
        return undefined;
      }
      return candidate;
    },
    async listCapabilities(request: RuntimeCapabilityListRequest, signal: AbortSignal): Promise<readonly CapabilityDescriptor[]> {
      if (signal.aborted) {
        return [];
      }
      const assembly = await input.assemblyRegistry.require(workflowRequest.agentId, workflowRequest.agentVersion);
      const candidates = await input.catalog.listAvailable({
        tenantId: workflowRequest.identityContext.tenantId,
        subjectId: workflowRequest.identityContext.subjectId,
        agentAssembly: assembly,
        includeUnavailable: false,
        ...(request.modelInvocable === undefined ? {} : { modelInvocable: request.modelInvocable }),
        ...(workflowRequest.sessionId === undefined ? {} : { sessionId: brand<string, 'SessionId'>(workflowRequest.sessionId) }),
      });
      return signal.aborted
        ? []
        : candidates.filter(
            (candidate) =>
              (request.kind === undefined || candidate.kind === request.kind) &&
              candidate.availabilityStatus === 'AVAILABLE' &&
              matchesModelInvocable(candidate, request.modelInvocable),
          );
    },
  };
}

function matchesModelInvocable(descriptor: CapabilityDescriptor, modelInvocable?: boolean): boolean {
  if (modelInvocable === undefined) {
    return true;
  }
  return modelInvocable ? descriptor.modelInvocable === true : descriptor.modelInvocable !== true;
}

function workflowModelInvocationConfig(configuration: ResolvedModelConfiguration): WorkflowNodeModelInvocationConfig {
  return {
    modelId: configuration.modelId,
    contextWindowTokens: configuration.contextWindowTokens,
    inferenceOptions: {
      temperature: configuration.temperature,
      maxOutputTokens: configuration.maxOutputTokens,
      topP: configuration.topP,
      ...(configuration.topK === undefined ? {} : { topK: configuration.topK }),
      ...(configuration.presencePenalty === undefined ? {} : { presencePenalty: configuration.presencePenalty }),
      ...(configuration.frequencyPenalty === undefined ? {} : { frequencyPenalty: configuration.frequencyPenalty }),
      ...(configuration.thinking === undefined ? {} : { thinking: configuration.thinking }),
    },
    timeoutMs: configuration.defaultTimeoutMs,
    maxRetries: configuration.defaultMaxRetries,
  };
}

async function prepareWorkflowLlmPrompt(input: WorkflowRuntimeAdaptersOptions, request: WorkflowNodeLlmPromptRequest) {
  const configuredPurpose =
    typeof request.resolvedInputs.prompt_template_name === 'string' && request.resolvedInputs.prompt_template_name.length > 0
      ? request.resolvedInputs.prompt_template_name
      : request.defaultPurpose;
  const inlinePromptContent =
    typeof request.resolvedInputs.prompt_template === 'string' && request.resolvedInputs.prompt_template.length > 0
      ? request.resolvedInputs.prompt_template
      : undefined;
  if (inlinePromptContent !== undefined) {
    return {
      systemPrompt: inlinePromptContent,
      userPrompt: request.defaultUserPrompt,
    };
  }
  try {
    const prompt = await input.assemblePrompt({
      purpose: configuredPurpose,
      agentId: request.request.agentId,
      agentVersion: request.request.agentVersion,
      selectedModel: {
        modelId: request.modelConfig.modelId,
      },
    });
    return {
      systemPrompt: prompt.renderedContent,
      userPrompt: request.defaultUserPrompt,
      ...(prompt.modelOptions === undefined ? {} : { inferenceOptions: prompt.modelOptions }),
      diagnostic: {
        reasonCode: 'WORKFLOW_LLM_PROMPT_TEMPLATE_APPLIED',
      },
    };
  } catch (error) {
    if (error instanceof AgentError && error.code.startsWith('PROMPT_')) {
      throw new AgentError({
        code: 'WORKFLOW_LLM_PROMPT_TEMPLATE_UNAVAILABLE',
        message: 'Workflow LLM prompt template could not be resolved safely.',
        category: 'VALIDATION',
        retryable: false,
        safeDetails: {
          reasonCode: 'WORKFLOW_LLM_PROMPT_TEMPLATE_UNAVAILABLE',
          nodeId: request.nodeId,
          nodeType: request.node.type,
          purpose: configuredPurpose,
        },
      });
    }
    throw error;
  }
}
