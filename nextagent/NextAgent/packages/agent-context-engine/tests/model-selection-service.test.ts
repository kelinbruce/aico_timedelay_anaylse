import { Ajv } from 'ajv';
import { brand } from '@nextagent/agent-common';
import type { AgentAssembly } from '@nextagent/agent-contracts/agent-assembly';
import { ModelSelectionRequestSchema, ModelSelectionResultSchema, type ModelSelectionRequest } from '@nextagent/agent-contracts/context';
import type { ModelCatalogEntry, ResolvedModelConfiguration } from '@nextagent/agent-contracts/model';
import { createModelSelectionService, type PromptTemplateRegistry } from '@nextagent/agent-context-engine';
import { describe, expect, it, vi } from 'vitest';

const configurationA = resolved('model-a', 64_000);
const configurationB = resolved('model-b', 32_000);

describe('model selection service', () => {
  it('selects the Agent default in declared scope and reuses the frozen catalog configuration', async () => {
    const catalogEntry = Object.freeze({
      availability: 'AVAILABLE' as const,
      fallbackEligible: false,
      configuration: configurationB,
    });
    const get = vi.fn(async (modelId: string) => (modelId === 'model-b' ? catalogEntry : available(configurationA, true)));
    const service = createService({ get });

    const result = await service.select(request(), new AbortController().signal);

    expect(get).toHaveBeenCalledTimes(1);
    expect(get).toHaveBeenCalledWith('model-b', expect.any(AbortSignal));
    expect(result).toEqual({
      status: 'SELECTED',
      reason: 'AGENT_DEFAULT',
      configuration: configurationB,
    });
    if (result.status === 'SELECTED') {
      expect(result.configuration).toBe(catalogEntry.configuration);
    }
  });

  it('queries only compatible candidates and preserves declared order', async () => {
    const get = vi.fn(async (modelId: string) => available(modelId === 'model-a' ? configurationA : configurationB, true));
    const service = createService({
      get,
      compatibleModelIds: ['model-a'],
    });

    await expect(service.select(request(), new AbortController().signal)).resolves.toEqual({
      status: 'SELECTED',
      reason: 'FIRST_ELIGIBLE',
      configuration: configurationA,
    });
    expect(get).toHaveBeenCalledTimes(1);
    expect(get).toHaveBeenCalledWith('model-a', expect.any(AbortSignal));
  });

  it('skips unavailable models and reports exact initial failure reasons', async () => {
    const unavailable: ModelCatalogEntry = {
      modelId: 'model-b',
      availability: 'UNAVAILABLE',
      fallbackEligible: false,
      unavailableReason: 'MODEL_NOT_FOUND',
    };
    const service = createService({
      get: vi.fn(async () => unavailable),
    });

    await expect(service.select(request(), new AbortController().signal)).resolves.toEqual({
      status: 'FAILED',
      failureReason: 'NO_AVAILABLE_MODEL',
    });
    await expect(
      service.select(
        {
          ...request(),
          modelId: 'not-activated',
        },
        new AbortController().signal,
      ),
    ).resolves.toEqual({
      status: 'FAILED',
      failureReason: 'MODEL_ID_NOT_ELIGIBLE',
    });
  });

  it('excludes attempted models and selects only fallback-eligible entries', async () => {
    const get = vi.fn(async (modelId: string) => (modelId === 'model-b' ? available(configurationB, false) : available(configurationA, true)));
    const service = createService({ get });

    await expect(
      service.select(
        {
          ...request(),
          mode: 'FALLBACK',
          attemptedModelIds: ['model-b'],
        },
        new AbortController().signal,
      ),
    ).resolves.toEqual({
      status: 'SELECTED',
      reason: 'FALLBACK_NEXT_ELIGIBLE',
      configuration: configurationA,
    });
    expect(get).toHaveBeenCalledTimes(1);
    expect(get).toHaveBeenCalledWith('model-a', expect.any(AbortSignal));
  });

  it('fails fallback safely for non-activated attempts, exhaustion and non-fallback candidates', async () => {
    const service = createService({
      get: vi.fn(async () => available(configurationA, false)),
    });
    await expect(
      service.select(
        {
          ...request(),
          mode: 'FALLBACK',
          attemptedModelIds: ['unknown'],
        },
        new AbortController().signal,
      ),
    ).resolves.toEqual({
      status: 'FAILED',
      failureReason: 'FALLBACK_ATTEMPTED_MODEL_NOT_ACTIVATED',
    });
    await expect(
      service.select(
        {
          ...request(),
          mode: 'FALLBACK',
          attemptedModelIds: ['model-a', 'model-b'],
        },
        new AbortController().signal,
      ),
    ).resolves.toEqual({
      status: 'FAILED',
      failureReason: 'FALLBACK_EXHAUSTED',
    });
    await expect(
      service.select(
        {
          ...request(),
          mode: 'FALLBACK',
          attemptedModelIds: ['model-b'],
        },
        new AbortController().signal,
      ),
    ).resolves.toEqual({
      status: 'FAILED',
      failureReason: 'FALLBACK_EXHAUSTED',
    });
  });

  it('fails before catalog access for assembly mismatch', async () => {
    const get = vi.fn();
    await expect(
      createService({ get }).select(
        {
          ...request(),
          agentAssemblyRef: 'agent:v2',
        },
        new AbortController().signal,
      ),
    ).resolves.toEqual({
      status: 'FAILED',
      failureReason: 'AGENT_ASSEMBLY_MISMATCH',
    });
    expect(get).not.toHaveBeenCalled();
  });

  it('propagates cancellation without catalog access', async () => {
    const get = vi.fn();
    const service = createService({ get });
    const controller = new AbortController();
    const reason = new DOMException('canceled', 'AbortError');
    controller.abort(reason);

    await expect(service.select(request(), controller.signal)).rejects.toBe(reason);
    expect(get).not.toHaveBeenCalled();
  });

  it('rejects malformed requests before assembly or catalog access', async () => {
    const get = vi.fn();
    const requireAssembly = vi.fn();
    const service = createService({ get, requireAssembly });

    await expect(
      service.select(
        {
          ...request(),
          mode: 'FALLBACK',
        } as ModelSelectionRequest,
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({
      code: 'MODEL_SELECTION_REQUEST_INVALID',
    });
    expect(requireAssembly).not.toHaveBeenCalled();
    expect(get).not.toHaveBeenCalled();
  });
});

describe('model selection schemas', () => {
  const ajv = new Ajv({ allErrors: true, strict: false });
  const validateRequest = ajv.compile(ModelSelectionRequestSchema);
  const validateResult = ajv.compile(ModelSelectionResultSchema);

  it('keeps identity, accepted Agent coordinates and mode combinations closed', () => {
    expect(validateRequest(request())).toBe(true);
    expect(validateRequest({ ...request(), unknown: true })).toBe(false);
    expect(
      validateRequest({
        ...request(),
        identityContext: { ...request().identityContext, agentId: 'untrusted-agent' },
      }),
    ).toBe(false);
    expect(validateRequest({ ...request(), attemptedModelIds: ['model-a'] })).toBe(false);
    expect(
      validateRequest({
        ...request(),
        mode: 'FALLBACK',
        attemptedModelIds: ['model-a'],
      }),
    ).toBe(true);
    expect(validateRequest({ ...request(), mode: 'FALLBACK' })).toBe(false);
    expect(validateRequest({ ...request(), mode: 'RETRY' })).toBe(false);
  });

  it('keeps selected and failed results mutually exclusive', () => {
    expect(
      validateResult({
        status: 'SELECTED',
        reason: 'AGENT_DEFAULT',
        configuration: configurationB,
      }),
    ).toBe(true);
    expect(
      validateResult({
        status: 'SELECTED',
        reason: 'AGENT_DEFAULT',
        configuration: configurationB,
        modelId: 'model-b',
      }),
    ).toBe(false);
    expect(
      validateResult({
        status: 'FAILED',
        failureReason: 'ACTIVATED_MODEL_UNKNOWN_OR_DISABLED',
      }),
    ).toBe(false);
    expect(
      validateResult({
        status: 'FAILED',
        failureReason: 'ACTIVATED_MODEL_UNKNOWN',
      }),
    ).toBe(false);
  });
});

function createService(options: {
  readonly get: (modelId: string, signal: AbortSignal) => Promise<ModelCatalogEntry | undefined>;
  readonly compatibleModelIds?: readonly string[];
  readonly requireAssembly?: () => Promise<AgentAssembly>;
}) {
  const assembly = agentAssembly();
  const promptTemplateRegistry: PromptTemplateRegistry = {
    register() {},
    templatesFor: () => [],
    compatibleModelIds: () => options.compatibleModelIds ?? [],
  };
  return createModelSelectionService({
    assemblyRegistry: {
      async active() {
        return assembly;
      },
      require: options.requireAssembly ?? (async () => assembly),
    },
    modelCatalog: {
      list: async () => [],
      get: options.get,
    },
    promptTemplateRegistry,
  });
}

function request() {
  return {
    identityContext: {
      tenantId: brand<string, 'TenantId'>('tenant'),
      subjectId: brand<string, 'SubjectId'>('subject'),
      displayName: 'Operator',
    },
    agentId: brand<string, 'AgentId'>('agent'),
    agentVersion: brand<string, 'AgentVersion'>('v1'),
    agentAssemblyRef: 'agent:v1',
    purpose: 'SYSTEM_PROMPT',
    flowVariables: {},
    mode: 'INITIAL' as const,
  };
}

function agentAssembly(): AgentAssembly {
  return {
    agentId: brand<string, 'AgentId'>('agent'),
    agentType: brand<string, 'AgentType'>('LLM'),
    agentVersion: brand<string, 'AgentVersion'>('v1'),
    agentAssemblyRef: 'agent:v1',
    displayName: 'Network Agent',
    description: 'Telecom diagnostics',
    workspacePolicy: {
      schemaVersion: 'nextagent.agent-workspace-policy.v1',
      isolationMode: 'subject',
      roots: [],
    },
    modelIds: ['model-a', 'model-b'],
    defaultModelId: 'model-b',
    capabilityBindings: [],
    userInvocable: true,
    agentInvocation: 'NONE',
    runtimeSettings: {
      defaultLanguage: 'en',
      maxTurns: 1,
      maxToolCallsPerTurn: 30,
      maxContextMessages: 10,
      requestTimeoutMs: 30_000,
    },
  };
}

function resolved(modelId: string, contextWindowTokens: number): ResolvedModelConfiguration {
  return Object.freeze({
    modelId,
    contextWindowTokens,
    temperature: 0.55,
    maxOutputTokens: 32_000,
    topP: 1,
    toolChoice: 'AUTO' as const,
    defaultTimeoutMs: 30_000,
    defaultMaxRetries: 2,
  });
}

function available(configuration: ResolvedModelConfiguration, fallbackEligible: boolean): ModelCatalogEntry {
  return {
    availability: 'AVAILABLE',
    fallbackEligible,
    configuration,
  };
}
