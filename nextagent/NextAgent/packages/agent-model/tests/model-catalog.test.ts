import { collectModelStream, modelEventStreamFixture } from '../../../tests/helpers/model-stream-fixture.js';
import { brand } from '@nextagent/agent-common';
import type {
  ModelGatewayModelInformationResult,
  ModelGatewayProvider,
  ModelInvocationRequest,
  ModelInvocationService,
  ModelProviderProfile,
} from '@nextagent/agent-contracts/model';
import type { AgentAssembly, AgentAssemblyRegistry } from '@nextagent/agent-contracts/agent-assembly';
import type {
  LifecycleHookInvocationPort,
  LifecycleHookInvocationRequest,
  LifecycleHookInvocationResult,
  LifecycleStage,
} from '@nextagent/agent-contracts/runtime';
import { createConfiguredModelRuntime, prepareConfiguredModelProviders } from '@nextagent/agent-model';
import { describe, expect, it, vi } from 'vitest';
import { createModelCatalog, type ModelCatalogSource } from '../src/catalog/model-catalog.js';
import { createCatalogBackedModelInvocationService } from '../src/invocation/catalog-backed-model-invocation.js';
import type { ModelProviderRuntime, ModelProviderRuntimeRegistration } from '../src/runtime/model-provider-runtime.js';
import { createModelRuntimeRegistry, type ModelRuntimeBinding } from '../src/runtime/model-runtime-registry.js';
import { createTestModelGatewayProvider } from '../src/testing/model-gateway-provider.js';

const signal = () => new AbortController().signal;

describe('model catalog runtime', () => {
  it('composes configured provider registrations behind catalog and invocation ports', async () => {
    const providers = preparedTestProviders(noopModel());
    const runtime = createConfiguredModelRuntime({
      providers,
      credentialResolver: async () => 'unused',
      assemblyRegistry: configuredAssemblyRegistry(),
      lifecycleHookInvocation: recordingHook([]),
    });

    expect(runtime.modelCatalog.get).toBeTypeOf('function');
    await expect(runtime.modelCatalog.get('compatible-model', signal())).resolves.toMatchObject({ availability: 'AVAILABLE' });
    expect(runtime.modelCatalog).not.toHaveProperty('complete');
    expect(runtime.modelInvocationService.complete).toBeTypeOf('function');
    expect(runtime.modelInvocationService).not.toHaveProperty('get');
  });

  it('requires an explicit registration for a configured compatible provider', async () => {
    const providers = prepareConfiguredModelProviders({ profiles: [compatibleProfile()] });
    const options = {
      providers,
      credentialResolver: async () => 'unused',
      assemblyRegistry: configuredAssemblyRegistry(),
      lifecycleHookInvocation: recordingHook([]),
    };

    expect(() => createConfiguredModelRuntime(options)).toThrowError(expect.objectContaining({ code: 'MODEL_PROVIDER_REGISTRATION_UNAVAILABLE' }));

    const runtime = createConfiguredModelRuntime({
      ...options,
      openAICompatibleProviderRegistration: noopCompatibleRegistration(),
    });
    await expect(runtime.modelCatalog.get('compatible-model', signal())).resolves.toMatchObject({
      availability: 'AVAILABLE',
    });
    await expect(runtime.modelInvocationService.complete(request('compatible-model'), signal())).resolves.toEqual({ content: 'ok' });
  });

  it('requires exactly one Model Gateway provider when Gateway profiles are configured', () => {
    const base = {
      profiles: [gatewayProfile()],
    };

    expect(() => prepareConfiguredModelProviders(base)).toThrow('Exactly one Model Gateway provider is required.');
    expect(() =>
      prepareConfiguredModelProviders({
        ...base,
        modelGatewayProviders: [modelGatewayProvider('first'), modelGatewayProvider('second')],
      }),
    ).toThrow('Exactly one Model Gateway provider is required.');
    expect(() =>
      prepareConfiguredModelProviders({
        ...base,
        modelGatewayProviders: [modelGatewayProvider('only')],
      }),
    ).not.toThrow();
  });

  it('resolves Gateway entries lazily, single-flights concurrent reads and freezes the canonical result', async () => {
    let resolve!: (result: ModelGatewayModelInformationResult) => void;
    const pending = new Promise<ModelGatewayModelInformationResult>((complete) => {
      resolve = complete;
    });
    const resolveModel = vi.fn(() => pending);
    const catalog = createCatalog([gatewayProfile()], [registration('model-gateway', resolveModel)]);

    expect(resolveModel).not.toHaveBeenCalled();
    const first = catalog.get('gateway-model', signal());
    const second = catalog.get('gateway-model', signal());
    expect(resolveModel).toHaveBeenCalledTimes(1);
    resolve({
      status: 'FOUND',
      information: { modelId: 'gateway-model', contextWindowTokens: 64_000 },
    });

    const [left, right] = await Promise.all([first, second]);
    expect(left).toBe(right);
    expect(Object.isFrozen(left)).toBe(true);
    expect(left).toEqual({
      availability: 'AVAILABLE',
      fallbackEligible: true,
      configuration: {
        modelId: 'gateway-model',
        contextWindowTokens: 64_000,
        temperature: 0.55,
        maxOutputTokens: 32_000,
        topP: 1,
        toolChoice: 'AUTO' as const,
        defaultTimeoutMs: 30_000,
        defaultMaxRetries: 2,
      },
    });
    expect(await catalog.get('gateway-model', signal())).toBe(left);
    expect(resolveModel).toHaveBeenCalledTimes(1);
  });

  it('lets an uncanceled waiter retry after the shared Gateway resolution is canceled', async () => {
    const firstController = new AbortController();
    let calls = 0;
    const resolveModel = vi.fn(async (_profile, providerSignal: AbortSignal) => {
      calls += 1;
      if (calls === 1) {
        await new Promise<void>((_resolve, reject) => {
          providerSignal.addEventListener('abort', () => reject(providerSignal.reason), { once: true });
        });
      }
      return {
        status: 'FOUND' as const,
        information: { modelId: 'gateway-model', contextWindowTokens: 80_000 },
      };
    });
    const catalog = createCatalog([gatewayProfile()], [registration('model-gateway', resolveModel)]);

    const canceled = catalog.get('gateway-model', firstController.signal);
    const waiter = catalog.get('gateway-model', signal());
    firstController.abort(new DOMException('canceled', 'AbortError'));

    await expect(canceled).rejects.toMatchObject({ name: 'AbortError' });
    await expect(waiter).resolves.toMatchObject({
      availability: 'AVAILABLE',
      configuration: { contextWindowTokens: 80_000 },
    });
    expect(resolveModel).toHaveBeenCalledTimes(2);
  });

  it('isolates unavailable Gateway entries while list resolves the remaining catalog', async () => {
    const catalog = createCatalog(
      [
        {
          providerId: 'model-gateway',
          models: [
            { modelId: 'missing', fallbackEligible: false },
            { modelId: 'found', fallbackEligible: true },
          ],
        },
      ],
      [
        registration('model-gateway', async (profile) =>
          profile.modelId === 'missing'
            ? { status: 'NOT_FOUND' }
            : {
                status: 'FOUND',
                information: { modelId: profile.modelId, contextWindowTokens: 16_000 },
              },
        ),
      ],
    );

    await expect(catalog.list(signal())).resolves.toEqual([
      {
        modelId: 'missing',
        availability: 'UNAVAILABLE',
        fallbackEligible: false,
        unavailableReason: 'MODEL_NOT_FOUND',
      },
      expect.objectContaining({
        availability: 'AVAILABLE',
        configuration: expect.objectContaining({ modelId: 'found' }),
      }),
    ]);
    await expect(catalog.get('unknown', signal())).resolves.toBeUndefined();
  });

  it('marks an unconfigured compatible provider unavailable without invoking the provider', async () => {
    const profile = unconfiguredCompatibleProfile();
    const provider = failingCompatibleRegistration();
    const registry = createModelRuntimeRegistry([profile], [provider]);
    const catalog = createModelCatalog([
      {
        definition: profile.models[0]!,
        unavailableReason: 'MODEL_PROVIDER_NOT_CONFIGURED',
      },
    ]);
    const invocation = createCatalogBackedModelInvocationService(registry, catalog);

    await expect(catalog.get('compatible-model', signal())).resolves.toEqual({
      modelId: 'compatible-model',
      availability: 'UNAVAILABLE',
      fallbackEligible: false,
      unavailableReason: 'MODEL_PROVIDER_NOT_CONFIGURED',
    });
    await expect(invocation.complete(request('compatible-model'), signal())).resolves.toMatchObject({
      content: '',
      safeError: {
        code: 'MODEL_UNAVAILABLE',
        category: 'UNAVAILABLE',
        retryable: true,
      },
    });
    expect(provider.createRuntime(profile).invocationService.complete).not.toHaveBeenCalled();
  });

  it('keeps a viable Gateway model callable beside an unconfigured compatible provider', async () => {
    const compatible = unconfiguredCompatibleProfile();
    const gateway = gatewayProfile();
    const compatibleProvider = failingCompatibleRegistration();
    const gatewayProvider: ModelProviderRuntimeRegistration = {
      providerId: 'model-gateway',
      createRuntime() {
        return {
          invocationService: noopModel(),
          async resolveModel(profile) {
            return {
              status: 'FOUND',
              information: { modelId: profile.modelId, contextWindowTokens: 64_000 },
            };
          },
        };
      },
    };
    const registry = createModelRuntimeRegistry([compatible, gateway], [compatibleProvider, gatewayProvider]);
    const catalog = createModelCatalog([
      {
        definition: compatible.models[0]!,
        unavailableReason: 'MODEL_PROVIDER_NOT_CONFIGURED',
      },
      {
        definition: gateway.models[0]!,
        resolveModel: async () => {
          await Promise.resolve();
          return {
            status: 'FOUND',
            information: { modelId: 'gateway-model', contextWindowTokens: 64_000 },
          };
        },
      },
    ]);
    const invocation = createCatalogBackedModelInvocationService(registry, catalog);

    await expect(invocation.complete(request('gateway-model'), signal())).resolves.toMatchObject({ content: 'ok' });
    await expect(invocation.complete(request('compatible-model'), signal())).resolves.toMatchObject({
      safeError: { code: 'MODEL_UNAVAILABLE' },
    });
  });

  it('freezes malformed Gateway model information as a safe unavailable entry', async () => {
    const resolveModel = vi.fn(
      async () =>
        ({
          status: 'FOUND',
          information: {
            modelId: 'gateway-model',
            contextWindowTokens: 64_000,
            unknown: true,
          },
        }) as never,
    );
    const catalog = createCatalog([gatewayProfile()], [registration('model-gateway', resolveModel)]);

    const entry = await catalog.get('gateway-model', signal());

    expect(entry).toEqual({
      modelId: 'gateway-model',
      availability: 'UNAVAILABLE',
      fallbackEligible: true,
      unavailableReason: 'MODEL_INFORMATION_AMBIGUOUS',
    });
    expect(Object.isFrozen(entry)).toBe(true);
    expect(await catalog.get('gateway-model', signal())).toBe(entry);
    expect(resolveModel).toHaveBeenCalledTimes(1);
  });

  it('rejects duplicate provider registrations and globally duplicate model ids', () => {
    const provider = registration('openai-compatible', async (profile) => ({
      status: 'FOUND',
      information: { modelId: profile.modelId, contextWindowTokens: 10_000 },
    }));
    expect(() => createRuntime([compatibleProfile()], [provider, provider])).toThrow('Duplicate model provider registration');
    expect(() =>
      createRuntime(
        [compatibleProfile(), { ...gatewayProfile(), models: [{ modelId: 'compatible-model', fallbackEligible: true }] }],
        [provider, registration('model-gateway', vi.fn())],
      ),
    ).toThrow('Duplicate model id');
  });

  it('recursively freezes nested profile values even when an intermediate object is already frozen', () => {
    const nestedProviderOption = { cache: 'enabled' };
    const providerOptions = Object.freeze({ vendor: nestedProviderOption });
    const registry = createModelRuntimeRegistry(
      [
        {
          providerId: 'openai-compatible',
          baseUrl: 'https://example.invalid/v1',
          models: [
            {
              modelId: 'compatible-model',
              contextWindowTokens: 32_000,
              fallbackEligible: false,
              providerOptions,
            },
          ],
        },
      ],
      [registration('openai-compatible', vi.fn())],
    );

    expect(Object.isFrozen(registry.get('compatible-model')?.definition.providerOptions)).toBe(true);
    expect(Object.isFrozen(nestedProviderOption)).toBe(true);
  });

  it('fails closed when a provider without a resolver also lacks configured model information', () => {
    expect(() =>
      createRuntime(
        [gatewayProfile()],
        [
          {
            providerId: 'model-gateway',
            createRuntime() {
              return { invocationService: noopModel() };
            },
          },
        ],
      ),
    ).toThrow('Configured model context window is invalid');
  });

  it('applies profile defaults before request overrides with shallow provider-option merging', async () => {
    let seenRequest: ModelInvocationRequest | undefined;
    const provider: ModelProviderRuntimeRegistration = {
      providerId: 'openai-compatible',
      createRuntime() {
        return {
          invocationService: {
            async complete(request) {
              seenRequest = request;
              return { content: 'ok', finishReason: 'stop' };
            },
            stream: modelEventStreamFixture(async function* () {
              yield { content: 'ok', finishReason: 'stop' };
            }),
          },
          async resolveModel(profile) {
            return {
              status: 'FOUND',
              information: { modelId: profile.modelId, contextWindowTokens: 32_000 },
            };
          },
        };
      },
    };
    const invocation = createRuntime(
      [
        {
          providerId: 'openai-compatible',
          baseUrl: 'https://example.invalid/v1',
          models: [
            {
              modelId: 'compatible-model',
              contextWindowTokens: 32_000,
              fallbackEligible: false,
              providerOptions: {
                nested: { fromProfile: true },
                profileOnly: true,
              },
            },
          ],
        },
      ],
      [provider],
    ).invocation;

    await invocation.complete(
      {
        ...request('compatible-model'),
        temperature: 0.2,
        providerOptions: {
          nested: { fromRequest: true },
          requestOnly: true,
        },
      },
      signal(),
    );

    expect(seenRequest).toMatchObject({
      contextWindowTokens: 32_000,
      temperature: 0.2,
      maxOutputTokens: 32_000,
      topP: 1,
      timeoutMs: 30_000,
      maxRetries: 2,
      providerOptions: {
        nested: { fromRequest: true },
        profileOnly: true,
        requestOnly: true,
      },
    });
  });

  it('does not materialize empty provider options when no layer supplies them', async () => {
    let seenRequest: ModelInvocationRequest | undefined;
    const provider: ModelProviderRuntimeRegistration = {
      providerId: 'openai-compatible',
      createRuntime() {
        return {
          invocationService: {
            async complete(request) {
              seenRequest = request;
              return { content: 'ok', finishReason: 'stop' };
            },
            stream: modelEventStreamFixture(async function* () {
              yield { content: 'ok', finishReason: 'stop' };
            }),
          },
          async resolveModel(profile) {
            return {
              status: 'FOUND',
              information: { modelId: profile.modelId, contextWindowTokens: 32_000 },
            };
          },
        };
      },
    };
    const invocation = createRuntime([compatibleProfile()], [provider]).invocation;

    await invocation.complete(request('compatible-model'), signal());

    expect(seenRequest).not.toHaveProperty('providerOptions');
  });

  it('keeps stateful provider execution internals outside the immutable catalog boundary', async () => {
    const calls: ModelInvocationRequest[] = [];
    const provider: ModelProviderRuntimeRegistration = {
      providerId: 'openai-compatible',
      createRuntime() {
        return {
          invocationService: {
            async complete(invocation) {
              calls.push(invocation);
              return { content: 'ok', finishReason: 'stop' };
            },
            stream: modelEventStreamFixture(async function* () {
              yield { content: 'ok', finishReason: 'stop' };
            }),
          },
          async resolveModel(profile) {
            return {
              status: 'FOUND',
              information: { modelId: profile.modelId, contextWindowTokens: 32_000 },
            };
          },
        };
      },
    };
    const invocation = createRuntime([compatibleProfile()], [provider]).invocation;

    await invocation.complete(request('compatible-model'), signal());

    expect(calls).toHaveLength(1);
  });

  it('normalizes catalog resolution and provider execution failures before they cross the model boundary', async () => {
    const resolutionFailure = new Error('private gateway failure');
    const failingResolver: ModelProviderRuntimeRegistration = {
      providerId: 'openai-compatible',
      createRuntime() {
        return {
          invocationService: noopModel(),
          async resolveModel() {
            throw resolutionFailure;
          },
        };
      },
    };
    const resolutionInvocation = createRuntime([compatibleProfile()], [failingResolver]).invocation;

    await expect(resolutionInvocation.complete(request('compatible-model'), signal())).resolves.toMatchObject({
      safeError: { code: 'MODEL_INTERNAL_ERROR', category: 'INTERNAL' },
    });
    await expect(collectModelStream(resolutionInvocation, request('compatible-model'), signal())).resolves.toEqual([
      expect.objectContaining({ safeError: expect.objectContaining({ code: 'MODEL_INTERNAL_ERROR' }) }),
    ]);

    const failingProvider: ModelProviderRuntimeRegistration = {
      providerId: 'openai-compatible',
      createRuntime() {
        return {
          invocationService: {
            async complete() {
              throw new Error('private provider failure');
            },
            async stream() {
              throw new Error('private provider stream failure');
            },
          },
        };
      },
    };
    const providerInvocation = createRuntime([compatibleProfile()], [failingProvider]).invocation;
    await expect(providerInvocation.complete(request('compatible-model'), signal())).resolves.toMatchObject({
      safeError: { code: 'MODEL_INTERNAL_ERROR', category: 'INTERNAL' },
    });
    await expect(collectModelStream(providerInvocation, request('compatible-model'), signal())).resolves.toEqual([
      expect.objectContaining({ safeError: expect.objectContaining({ code: 'MODEL_INTERNAL_ERROR' }) }),
    ]);
  });

  it('does not convert a stream consumer failure into a model safe error', async () => {
    const consumerFailure = new Error('consumer stopped projection');
    const provider: ModelProviderRuntimeRegistration = {
      providerId: 'openai-compatible',
      createRuntime() {
        return {
          invocationService: {
            async complete() {
              return { content: 'ok', finishReason: 'stop' };
            },
            async stream(_request, _signal, onDelta) {
              await onDelta({ content: 'partial' });
              return { content: 'partial', finishReason: 'stop' };
            },
          },
        };
      },
    };
    const invocation = createRuntime([compatibleProfile()], [provider]).invocation;

    await expect(
      invocation.stream(request('compatible-model'), signal(), async () => {
        throw consumerFailure;
      }),
    ).rejects.toBe(consumerFailure);
  });
});

describe('assembly-authorized model invocation', () => {
  it('blocks a model with mismatched assemblyRef before hooks and provider execution', async () => {
    const inner: ModelInvocationService = {
      complete: vi.fn(async () => ({ content: 'should not run' })),
      stream: vi.fn(
        modelEventStreamFixture(async function* () {
          yield { content: 'should not run', finishReason: 'stop' };
        }),
      ),
    };
    const hookStages: LifecycleStage[] = [];
    const runtime = createConfiguredModelRuntime({
      providers: preparedTestProviders(inner),
      credentialResolver: async () => 'unused',
      assemblyRegistry: mismatchedAssemblyRefRegistry(),
      lifecycleHookInvocation: recordingHook(hookStages),
    });

    await expect(runtime.modelInvocationService.complete(request('other-model'), signal())).resolves.toMatchObject({
      safeError: { code: 'MODEL_NOT_ACTIVATED', category: 'AUTHORIZATION' },
    });
    expect(hookStages).toEqual([]);
    expect(inner.complete).not.toHaveBeenCalled();
  });

  it('model-gateway bypasses modelId eligibility check for non-activated model', async () => {
    const inner: ModelInvocationService = {
      complete: vi.fn(async () => ({ content: 'gateway passthrough' })),
      stream: vi.fn(
        modelEventStreamFixture(async function* () {
          yield { content: 'gateway passthrough', finishReason: 'stop' };
        }),
      ),
    };
    const hookStages: LifecycleStage[] = [];
    const runtime = createConfiguredModelRuntime({
      providers: preparedTestProviders(inner),
      credentialResolver: async () => 'unused',
      assemblyRegistry: configuredAssemblyRegistry(),
      lifecycleHookInvocation: recordingHook(hookStages),
    });

    // other-model is not in assembly.modelIds, but model-gateway bypasses the check
    await expect(runtime.modelInvocationService.complete(request('other-model'), signal())).resolves.toMatchObject({
      content: 'gateway passthrough',
    });
    expect(inner.complete).toHaveBeenCalled();
  });

  it('returns one ModelInvocationService with authorization and model hooks applied', async () => {
    const hookStages: LifecycleStage[] = [];
    const runtime = createConfiguredModelRuntime({
      providers: preparedTestProviders(noopModel()),
      credentialResolver: async () => 'unused',
      assemblyRegistry: configuredAssemblyRegistry(),
      lifecycleHookInvocation: recordingHook(hookStages),
    });

    await expect(runtime.modelInvocationService.complete(request('compatible-model'), signal())).resolves.toMatchObject({ content: 'ok' });
    expect(hookStages).toEqual(['BEFORE_MODEL_INVOKE', 'AFTER_MODEL_RESULT']);
  });
});

function createRuntime(profiles: readonly ModelProviderProfile[], registrations: readonly ModelProviderRuntimeRegistration[]) {
  const registry = createModelRuntimeRegistry(profiles, registrations);
  const catalog = createModelCatalog(registry.list().map(toCatalogSource));
  return {
    catalog,
    invocation: createCatalogBackedModelInvocationService(registry, catalog),
  };
}

function toCatalogSource(binding: ModelRuntimeBinding): ModelCatalogSource {
  const resolveModel = binding.runtime.resolveModel;
  return {
    definition: binding.definition,
    ...(resolveModel === undefined
      ? {}
      : {
          resolveModel: (providerSignal: AbortSignal) => resolveModel(binding.definition, providerSignal),
        }),
  };
}

function createCatalog(profiles: readonly ModelProviderProfile[], registrations: readonly ModelProviderRuntimeRegistration[]) {
  return createRuntime(profiles, registrations).catalog;
}

function compatibleProfile(): ModelProviderProfile {
  return {
    providerId: 'openai-compatible',
    baseUrl: 'https://example.invalid/v1',
    models: [
      {
        modelId: 'compatible-model',
        contextWindowTokens: 32_000,
        fallbackEligible: false,
      },
    ],
  };
}

function unconfiguredCompatibleProfile(): ModelProviderProfile {
  return {
    providerId: 'openai-compatible',
    models: [
      {
        modelId: 'compatible-model',
        contextWindowTokens: 32_000,
        fallbackEligible: false,
      },
    ],
  };
}

function preparedTestProviders(model: ModelInvocationService) {
  return prepareConfiguredModelProviders({
    profiles: [
      {
        providerId: 'model-gateway',
        models: [
          {
            modelId: 'compatible-model',
            fallbackEligible: false,
          },
        ],
      },
    ],
    modelGatewayProviders: [
      createTestModelGatewayProvider(model, [
        {
          modelId: 'compatible-model',
          contextWindowTokens: 32_000,
        },
      ]),
    ],
  });
}

function gatewayProfile(): ModelProviderProfile {
  return {
    providerId: 'model-gateway',
    models: [{ modelId: 'gateway-model', fallbackEligible: true }],
  };
}

function registration(
  providerId: 'openai-compatible' | 'model-gateway',
  resolveModel: NonNullable<ModelProviderRuntime['resolveModel']>,
): ModelProviderRuntimeRegistration {
  return {
    providerId,
    createRuntime() {
      return {
        invocationService: noopModel(),
        resolveModel,
      };
    },
  };
}

function failingCompatibleRegistration(): ModelProviderRuntimeRegistration {
  const complete = vi.fn(async () => {
    throw new Error('unconfigured provider must not execute');
  });
  const stream = vi.fn(async () => {
    throw new Error('unconfigured provider must not execute');
  });
  return {
    providerId: 'openai-compatible',
    createRuntime() {
      return { invocationService: { complete, stream } };
    },
  };
}

function noopCompatibleRegistration(): ModelProviderRuntimeRegistration {
  return {
    providerId: 'openai-compatible',
    createRuntime() {
      return { invocationService: noopModel() };
    },
  };
}

function noopModel(): ModelInvocationService {
  return {
    async complete() {
      return { content: 'ok' };
    },
    stream: modelEventStreamFixture(async function* () {
      yield { content: 'ok', finishReason: 'stop' };
    }),
  };
}

function modelGatewayProvider(providerId: string): ModelGatewayProvider {
  return {
    providerId,
    createModelService: noopModel,
    createModelInformationService() {
      return {
        async get(modelId) {
          return {
            status: 'FOUND',
            information: { modelId, contextWindowTokens: 64_000 },
          };
        },
      };
    },
  };
}

function request(modelId: string): ModelInvocationRequest {
  return {
    invocationScope: {
      tenantId: brand<string, 'TenantId'>('tenant'),
      subjectId: brand<string, 'SubjectId'>('subject'),
      agentId: brand<string, 'AgentId'>('agent'),
      agentVersion: brand<string, 'AgentVersion'>('v1'),
      agentAssemblyRef: 'agent:v1',
      operationId: 'turn-1',
      sessionId: brand<string, 'SessionId'>('session'),
      requestId: brand<string, 'MessageId'>('request'),
      runId: brand<string, 'RequestRunId'>('run'),
    },
    modelId,
    messages: [{ role: 'USER', content: [{ type: 'text', text: 'diagnose' }] }],
    tools: [],
  };
}

function assembly(): AgentAssembly {
  return {
    agentId: brand<string, 'AgentId'>('agent'),
    agentType: brand<string, 'AgentType'>('LLM'),
    agentVersion: brand<string, 'AgentVersion'>('v1'),
    agentAssemblyRef: 'agent:v1',
    displayName: 'Agent',
    description: 'test',
    workspacePolicy: {
      schemaVersion: 'nextagent.agent-workspace-policy.v1' as const,
      isolationMode: 'subject' as const,
      roots: [],
    },
    modelIds: ['compatible-model'],
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

function configuredAssemblyRegistry(): AgentAssemblyRegistry {
  return {
    async active() {
      return assembly();
    },
    async require() {
      return assembly();
    },
  };
}

function mismatchedAssemblyRefRegistry(): AgentAssemblyRegistry {
  return {
    async active() {
      return { ...assembly(), agentAssemblyRef: 'agent:other-version' };
    },
    async require() {
      return { ...assembly(), agentAssemblyRef: 'agent:other-version' };
    },
  };
}

function recordingHook(stages: LifecycleStage[]): LifecycleHookInvocationPort {
  return {
    async invoke<S extends LifecycleStage>(invocation: LifecycleHookInvocationRequest<S>): Promise<LifecycleHookInvocationResult<S>> {
      stages.push(invocation.stage);
      return { status: 'CONTINUE', boundary: invocation.boundary };
    },
  };
}
