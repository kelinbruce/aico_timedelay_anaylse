import type {
  ModelCatalogEntry,
  ModelCatalogQueryService,
  ModelGatewayModelInformationResult,
  ModelProfile,
  ModelUnavailableReason,
  ResolvedModelConfiguration,
} from '@nextagent/agent-contracts/model';
import { ModelGatewayModelInformationResultSchema } from '@nextagent/agent-contracts/model';
import { Ajv } from 'ajv/dist/ajv.js';
import { deepFreeze } from '@nextagent/agent-common';

import { defaultModelMaxRetries, defaultModelTimeoutMs } from '../internal/model-defaults.js';

const validateModelInformationResult = new Ajv({
  allErrors: true,
  strict: false,
}).compile(ModelGatewayModelInformationResultSchema);

export interface ModelCatalogSource {
  readonly definition: ModelProfile;
  readonly unavailableReason?: ModelUnavailableReason;
  readonly resolveModel?: (signal: AbortSignal) => Promise<ModelGatewayModelInformationResult>;
}

interface ResolvableModelCatalogSource extends ModelCatalogSource {
  readonly resolveModel: NonNullable<ModelCatalogSource['resolveModel']>;
}

type ModelCatalogSlot =
  | { readonly state: 'UNRESOLVED'; readonly source: ResolvableModelCatalogSource }
  | {
      readonly state: 'RESOLVING';
      readonly source: ResolvableModelCatalogSource;
      readonly resolution: Promise<ModelCatalogEntry>;
      readonly resolutionSignal: AbortSignal;
    }
  | { readonly state: 'RESOLVED'; readonly source: ModelCatalogSource; readonly entry: ModelCatalogEntry };

export function createModelCatalog(sources: readonly ModelCatalogSource[]): ModelCatalogQueryService {
  const slots = new Map<string, ModelCatalogSlot>();
  const order: string[] = [];

  for (const source of sources) {
    order.push(source.definition.modelId);
    slots.set(
      source.definition.modelId,
      source.unavailableReason !== undefined || !isResolvableSource(source)
        ? {
            state: 'RESOLVED',
            source,
            entry:
              source.unavailableReason === undefined
                ? availableEntry(source.definition, requireContextWindow(source.definition))
                : unavailableEntry(source.definition, source.unavailableReason),
          }
        : { state: 'UNRESOLVED', source },
    );
  }

  const query: ModelCatalogQueryService = {
    async list(signal) {
      throwIfAborted(signal);
      const entries = await Promise.all(order.map((modelId) => resolveSlot(modelId, signal)));
      throwIfAborted(signal);
      return Object.freeze(entries);
    },
    async get(modelId, signal) {
      throwIfAborted(signal);
      if (!slots.has(modelId)) {
        return undefined;
      }
      return resolveSlot(modelId, signal);
    },
  };
  return Object.freeze(query);

  async function resolveSlot(modelId: string, signal: AbortSignal): Promise<ModelCatalogEntry> {
    while (true) {
      throwIfAborted(signal);
      const slot = slots.get(modelId);
      if (slot === undefined) {
        throw new Error('Configured model slot is unavailable.');
      }
      if (slot.state === 'RESOLVED') {
        return slot.entry;
      }
      if (slot.state === 'RESOLVING') {
        try {
          return await raceWithSignal(slot.resolution, signal);
        } catch (error) {
          if (signal.aborted) {
            throw error;
          }
          if (slot.resolutionSignal.aborted) {
            continue;
          }
          throw error;
        }
      }
      const resolution = resolveProviderEntry(slot.source, signal);
      slots.set(modelId, {
        state: 'RESOLVING',
        source: slot.source,
        resolution,
        resolutionSignal: signal,
      });
      try {
        const entry = await resolution;
        const current = slots.get(modelId);
        if (current?.state === 'RESOLVING' && current.resolution === resolution) {
          slots.set(modelId, { state: 'RESOLVED', source: slot.source, entry });
        }
        return entry;
      } catch (error) {
        const current = slots.get(modelId);
        if (current?.state === 'RESOLVING' && current.resolution === resolution) {
          slots.set(modelId, { state: 'UNRESOLVED', source: slot.source });
        }
        throw error;
      }
    }
  }
}

function isResolvableSource(source: ModelCatalogSource): source is ResolvableModelCatalogSource {
  return source.resolveModel !== undefined;
}

async function resolveProviderEntry(source: ResolvableModelCatalogSource, signal: AbortSignal): Promise<ModelCatalogEntry> {
  const result = await source.resolveModel(signal);
  throwIfAborted(signal);
  return resolvedEntry(source.definition, result);
}

function resolvedEntry(definition: ModelProfile, result: ModelGatewayModelInformationResult): ModelCatalogEntry {
  if (!validateModelInformationResult(result)) {
    return unavailableEntry(definition, 'MODEL_INFORMATION_AMBIGUOUS');
  }
  if (result.status === 'NOT_FOUND') {
    return unavailableEntry(definition, 'MODEL_NOT_FOUND');
  }
  if (result.status === 'UNAVAILABLE') {
    return unavailableEntry(definition, result.reason);
  }
  if (result.information.modelId !== definition.modelId) {
    return unavailableEntry(definition, 'MODEL_INFORMATION_AMBIGUOUS');
  }
  if (!Number.isSafeInteger(result.information.contextWindowTokens) || result.information.contextWindowTokens <= 0) {
    return unavailableEntry(definition, 'CONTEXT_WINDOW_INVALID');
  }
  return availableEntry(definition, result.information.contextWindowTokens);
}

function availableEntry(definition: ModelProfile, contextWindowTokens: number): ModelCatalogEntry {
  const configuration: ResolvedModelConfiguration = deepFreeze({
    modelId: definition.modelId,
    contextWindowTokens,
    temperature: definition.temperature ?? 0.55,
    maxOutputTokens: definition.maxOutputTokens ?? 32_000,
    topP: definition.topP ?? 1,
    toolChoice: definition.toolChoice ?? 'AUTO',
    ...(definition.topK === undefined ? {} : { topK: definition.topK }),
    ...(definition.presencePenalty === undefined ? {} : { presencePenalty: definition.presencePenalty }),
    ...(definition.frequencyPenalty === undefined ? {} : { frequencyPenalty: definition.frequencyPenalty }),
    ...(definition.thinking === undefined ? {} : { thinking: definition.thinking }),
    defaultTimeoutMs: definition.timeoutMs ?? defaultModelTimeoutMs,
    defaultMaxRetries: definition.maxRetries ?? defaultModelMaxRetries,
  });
  return deepFreeze({
    availability: 'AVAILABLE',
    fallbackEligible: definition.fallbackEligible,
    ...(definition.displayName === undefined ? {} : { displayName: definition.displayName }),
    configuration,
  });
}

function unavailableEntry(definition: ModelProfile, unavailableReason: ModelUnavailableReason): ModelCatalogEntry {
  return deepFreeze({
    modelId: definition.modelId,
    availability: 'UNAVAILABLE',
    fallbackEligible: definition.fallbackEligible,
    ...(definition.displayName === undefined ? {} : { displayName: definition.displayName }),
    unavailableReason,
  });
}

function requireContextWindow(profile: ModelProfile): number {
  if (!Number.isSafeInteger(profile.contextWindowTokens) || Number(profile.contextWindowTokens) <= 0) {
    throw new Error(`Configured model context window is invalid: ${profile.modelId}.`);
  }
  return Number(profile.contextWindowTokens);
}

async function raceWithSignal<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) {
    throw signal.reason;
  }
  return await new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(signal.reason);
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener('abort', onAbort);
        reject(error);
      },
    );
  });
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) {
    throw signal.reason;
  }
}
