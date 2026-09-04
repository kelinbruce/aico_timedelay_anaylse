import { AgentError } from '@nextagent/agent-common';
import type { AgentAssemblyRegistry } from '@nextagent/agent-contracts/agent-assembly';
import {
  ModelSelectionRequestSchema,
  type ModelSelectionRequest,
  type ModelSelectionResult,
  type ModelSelectionService,
} from '@nextagent/agent-contracts/context';
import type { ModelCatalogQueryService } from '@nextagent/agent-contracts/model';
import { Ajv } from 'ajv/dist/ajv.js';
import type { PromptTemplateRegistry } from '../prompt-shaping/prompt-template-types.js';

const validateModelSelectionRequest = new Ajv({
  allErrors: true,
  strict: false,
}).compile(ModelSelectionRequestSchema);

export interface ModelSelectionServiceDependencies {
  readonly assemblyRegistry: AgentAssemblyRegistry;
  readonly modelCatalog: ModelCatalogQueryService;
  readonly promptTemplateRegistry: PromptTemplateRegistry;
}

export class DefaultModelSelectionService implements ModelSelectionService {
  constructor(private readonly dependencies: ModelSelectionServiceDependencies) {}

  async select(request: ModelSelectionRequest, signal: AbortSignal): Promise<ModelSelectionResult> {
    throwIfAborted(signal);
    if (!validateModelSelectionRequest(request)) {
      throw new AgentError({
        code: 'MODEL_SELECTION_REQUEST_INVALID',
        message: 'Model selection request is invalid.',
        category: 'VALIDATION',
        retryable: false,
      });
    }
    const assembly = await this.dependencies.assemblyRegistry.require(request.agentId, request.agentVersion);
    if (assembly.agentAssemblyRef !== request.agentAssemblyRef) {
      return failed('AGENT_ASSEMBLY_MISMATCH');
    }
    const attempted = request.attemptedModelIds ?? [];
    if (request.mode === 'FALLBACK' && attempted.some((modelId) => !assembly.modelIds.includes(modelId))) {
      return failed('FALLBACK_ATTEMPTED_MODEL_NOT_ACTIVATED');
    }

    const orderedIds = orderedCandidateIds(assembly.modelIds, assembly.defaultModelId, request);
    if (orderedIds.length === 0) {
      return failed(request.mode === 'FALLBACK' ? 'FALLBACK_EXHAUSTED' : 'MODEL_ID_NOT_ELIGIBLE');
    }
    const compatibleModelIds = this.dependencies.promptTemplateRegistry.compatibleModelIds({
      purpose: request.purpose,
      agentId: request.agentId,
      agentVersion: request.agentVersion,
      ...(request.locale === undefined ? {} : { locale: request.locale }),
      flowVariables: request.flowVariables,
      modelCandidates: assembly.modelIds.map((modelId, order) => ({ modelId, order })),
    });
    const compatibilityFilter = compatibleModelIds.length === 0 ? undefined : new Set(compatibleModelIds);

    for (const modelId of orderedIds) {
      if (compatibilityFilter !== undefined && !compatibilityFilter.has(modelId)) {
        continue;
      }
      const entry = await this.dependencies.modelCatalog.get(modelId, signal);
      if (entry?.availability !== 'AVAILABLE') {
        continue;
      }
      if (request.mode === 'FALLBACK' && !entry.fallbackEligible) {
        continue;
      }
      return {
        status: 'SELECTED',
        reason: selectionReason(request, modelId, assembly.defaultModelId),
        configuration: entry.configuration,
      };
    }
    return failed(request.mode === 'FALLBACK' ? 'FALLBACK_EXHAUSTED' : 'NO_AVAILABLE_MODEL');
  }
}

export function createModelSelectionService(dependencies: ModelSelectionServiceDependencies): DefaultModelSelectionService {
  return new DefaultModelSelectionService(dependencies);
}

function orderedCandidateIds(
  activatedModelIds: readonly string[],
  defaultModelId: string | undefined,
  request: ModelSelectionRequest,
): readonly string[] {
  if (request.modelId !== undefined) {
    return activatedModelIds.includes(request.modelId) && !(request.attemptedModelIds ?? []).includes(request.modelId) ? [request.modelId] : [];
  }
  const ordered =
    defaultModelId === undefined ? [...activatedModelIds] : [defaultModelId, ...activatedModelIds.filter((modelId) => modelId !== defaultModelId)];
  const attempted = new Set(request.attemptedModelIds ?? []);
  return ordered.filter((modelId) => !attempted.has(modelId));
}

function selectionReason(
  request: ModelSelectionRequest,
  modelId: string,
  defaultModelId?: string,
): Extract<ModelSelectionResult, { status: 'SELECTED' }>['reason'] {
  if (request.mode === 'FALLBACK') {
    return 'FALLBACK_NEXT_ELIGIBLE';
  }
  if (request.modelId !== undefined) {
    return 'EXPLICIT_MODEL_ID';
  }
  return modelId === defaultModelId ? 'AGENT_DEFAULT' : 'FIRST_ELIGIBLE';
}

function failed(failureReason: Extract<ModelSelectionResult, { status: 'FAILED' }>['failureReason']): ModelSelectionResult {
  return { status: 'FAILED', failureReason };
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) {
    throw signal.reason;
  }
}
