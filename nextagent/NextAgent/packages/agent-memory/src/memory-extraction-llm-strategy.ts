import { AgentError, brand, type IdentityContext, type JsonObject, type RequestLocale, type SafeError } from '@nextagent/agent-common';
import type { ModelInferenceOptions, ModelInvocationService, ResolvedModelConfiguration } from '@nextagent/agent-contracts/model';
import type { ModelSelectionService } from '@nextagent/agent-contracts/context';
import {
  memoryExtractionSourceTraceFromTrajectory,
  type MemoryExtractionCandidate,
  type MemoryExtractionLlmStrategy,
  type MemoryExtractionScope,
} from './memory-extraction.js';
import { projectTaskTrajectoryForMemoryExtractionPrompt } from './memory-extraction.js';

export interface MemoryExtractionAssemblyView {
  readonly agentId: MemoryExtractionScope['agentId'];
  readonly agentVersion: NonNullable<MemoryExtractionScope['agentVersion']>;
  readonly agentAssemblyRef: string;
  readonly runtimeSettings: {
    readonly defaultLanguage?: string;
  };
}

export interface MemoryExtractionPromptAssemblyRequest {
  readonly agentId: MemoryExtractionAssemblyView['agentId'];
  readonly agentVersion: MemoryExtractionAssemblyView['agentVersion'];
  readonly locale?: RequestLocale;
  readonly selectedModel: {
    readonly modelId: string;
  };
}

export interface MemoryExtractionPromptAssemblyResult {
  readonly renderedContent: string;
  readonly modelOptions?: ModelInferenceOptions;
}

export interface MemoryExtractionLlmStrategyOptions {
  readonly resolveAssembly: (scope: MemoryExtractionScope) => Promise<MemoryExtractionAssemblyView> | MemoryExtractionAssemblyView;
  readonly modelSelectionService: ModelSelectionService;
  readonly model: ModelInvocationService;
  readonly identity: IdentityContext;
  readonly assemblePrompt: (
    request: MemoryExtractionPromptAssemblyRequest,
  ) => Promise<MemoryExtractionPromptAssemblyResult> | MemoryExtractionPromptAssemblyResult;
}

type MemoryExtractionTrajectory = Parameters<MemoryExtractionLlmStrategy>[0]['trajectories'][number];

export function createMemoryExtractionLlmStrategy(input: MemoryExtractionLlmStrategyOptions): MemoryExtractionLlmStrategy {
  return async (request, signal) => {
    if (signal?.aborted === true) {
      return memoryExtractionSafeError('MEMORY_EXTRACTION_CANCELED', 'CANCELED', false);
    }
    try {
      const assembly = await input.resolveAssembly(request.scope);
      const extractionLocale =
        assembly.runtimeSettings.defaultLanguage === undefined ? undefined : brand<string, 'RequestLocale'>(assembly.runtimeSettings.defaultLanguage);
      const invocationSignal = signal ?? new AbortController().signal;
      const selected = await input.modelSelectionService.select(
        {
          identityContext: input.identity,
          agentId: assembly.agentId,
          agentVersion: assembly.agentVersion,
          agentAssemblyRef: assembly.agentAssemblyRef,
          purpose: 'MEMORY_EXTRACTION',
          flowVariables: {},
          mode: 'INITIAL',
          ...(extractionLocale === undefined ? {} : { locale: extractionLocale }),
        },
        invocationSignal,
      );
      if (selected.status === 'FAILED') {
        return memoryExtractionSafeError(selected.failureReason, 'UNAVAILABLE', false);
      }
      const prompt = await input.assemblePrompt({
        agentId: assembly.agentId,
        agentVersion: assembly.agentVersion,
        ...(extractionLocale === undefined ? {} : { locale: extractionLocale }),
        selectedModel: {
          modelId: selected.configuration.modelId,
        },
      });
      const result = await input.model.complete(
        {
          invocationScope: {
            tenantId: input.identity.tenantId,
            subjectId: input.identity.subjectId,
            agentId: assembly.agentId,
            agentVersion: assembly.agentVersion,
            agentAssemblyRef: assembly.agentAssemblyRef,
            operationId: `memory-extraction:${request.cycleId}`,
          },
          modelId: selected.configuration.modelId,
          messages: [
            { role: 'SYSTEM', content: [{ type: 'text', text: prompt.renderedContent }] },
            {
              role: 'USER',
              content: [
                {
                  type: 'text',
                  text: JSON.stringify({ taskTrajectories: request.trajectories.map(projectTaskTrajectoryForMemoryExtractionPrompt) }),
                },
              ],
            },
          ],
          tools: [],
          ...mergeInferenceOptions(configurationInferenceOptions(selected.configuration), prompt.modelOptions),
          timeoutMs: selected.configuration.defaultTimeoutMs,
          maxRetries: selected.configuration.defaultMaxRetries,
        },
        invocationSignal,
      );
      if (result.safeError !== undefined) {
        return result.safeError;
      }
      return {
        candidates: parseMemoryExtractionLlmCandidates(result.content, request.trajectories, request.cycleId).slice(0, request.maxCandidates),
        reasonCode: 'LLM_EXTRACTION_ATTEMPTED',
      };
    } catch (error) {
      return memoryExtractionSafeError(
        error instanceof AgentError && error.code.startsWith('PROMPT_') ? 'PROMPT_TEMPLATE_RESOLUTION_FAILED' : 'MODEL_UNAVAILABLE',
        'UNAVAILABLE',
        false,
      );
    }
  };
}

function configurationInferenceOptions(configuration: ResolvedModelConfiguration): ModelInferenceOptions {
  return {
    temperature: configuration.temperature,
    maxOutputTokens: configuration.maxOutputTokens,
    topP: configuration.topP,
    ...(configuration.topK === undefined ? {} : { topK: configuration.topK }),
    ...(configuration.presencePenalty === undefined ? {} : { presencePenalty: configuration.presencePenalty }),
    ...(configuration.frequencyPenalty === undefined ? {} : { frequencyPenalty: configuration.frequencyPenalty }),
    ...(configuration.thinking === undefined ? {} : { thinking: configuration.thinking }),
  };
}

function mergeInferenceOptions(base: ModelInferenceOptions, override?: ModelInferenceOptions): ModelInferenceOptions {
  if (override === undefined) {
    return base;
  }
  return {
    ...base,
    ...override,
    ...(override.providerOptions === undefined ? {} : { providerOptions: { ...(base.providerOptions ?? {}), ...override.providerOptions } }),
  };
}

export function parseMemoryExtractionLlmCandidates(
  content: string,
  trajectories: readonly MemoryExtractionTrajectory[],
  cycleId: string,
): readonly MemoryExtractionCandidate[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return [];
  }
  const items = Array.isArray(parsed)
    ? parsed
    : parsed !== null && typeof parsed === 'object' && Array.isArray((parsed as { readonly candidates?: unknown }).candidates)
      ? (parsed as { readonly candidates: readonly unknown[] }).candidates
      : [];
  return items.flatMap((item): readonly MemoryExtractionCandidate[] => {
    if (item === null || typeof item !== 'object') {
      return [];
    }
    const candidate = item as Record<string, unknown>;
    const category = candidate.category;
    const contentValue = candidate.content;
    const trajectoryIndex =
      typeof candidate.trajectoryIndex === 'number' && Number.isInteger(candidate.trajectoryIndex) ? candidate.trajectoryIndex : 0;
    const trajectory = trajectories[trajectoryIndex];
    if (!isMemoryExtractionCategory(category) || !isPlainJsonObject(contentValue) || trajectory === undefined) {
      return [];
    }
    const contentObject = contentValue as JsonObject;
    if (contentObject.category !== category) {
      return [];
    }
    return [
      {
        category,
        content: contentObject as unknown as MemoryExtractionCandidate['content'],
        briefIndex: typeof candidate.briefIndex === 'string' ? candidate.briefIndex : 'LLM memory candidate.',
        confidence: typeof candidate.confidence === 'number' ? candidate.confidence : 0.5,
        tags: Array.isArray(candidate.tags) ? candidate.tags.filter((tag): tag is string => typeof tag === 'string') : ['llm'],
        sourceTrace: memoryExtractionSourceTraceFromTrajectory(trajectory, cycleId),
        strategyProvenance: 'LLM',
      },
    ];
  });
}

function isMemoryExtractionCategory(value: unknown): value is MemoryExtractionCandidate['category'] {
  return value === 'FACTUAL' || value === 'CONCEPTUAL' || value === 'PROCEDURAL' || value === 'USER_CHARACTERISTICS';
}

function isPlainJsonObject(value: unknown): value is JsonObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function memoryExtractionSafeError(code: string, category: SafeError['category'], retryable: boolean): SafeError {
  return {
    code,
    message: 'Memory extraction model step failed safely.',
    category,
    retryable,
  };
}
