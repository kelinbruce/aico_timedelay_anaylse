import { Ajv } from 'ajv';
import {
  ModelCatalogEntrySchema,
  ModelFinalResultSchema,
  ModelInferenceOptionsSchema,
  ModelInvocationRequestSchema,
  ModelInvocationScopeSchema,
  ModelProviderProfileSchema,
  ModelStreamDeltaSchema,
  ResolvedModelConfigurationSchema,
} from '@nextagent/agent-contracts/model';
import { describe, expect, it } from 'vitest';

const ajv = new Ajv({ allErrors: true, strict: false });
const validateScope = ajv.compile(ModelInvocationScopeSchema);
const validateRequest = ajv.compile(ModelInvocationRequestSchema);
const validateResult = ajv.compile(ModelFinalResultSchema);
const validateDelta = ajv.compile(ModelStreamDeltaSchema);
const validateCatalogEntry = ajv.compile(ModelCatalogEntrySchema);
const validateProviderProfile = ajv.compile(ModelProviderProfileSchema);
const validateResolvedConfiguration = ajv.compile(ResolvedModelConfigurationSchema);

describe('canonical model invocation contracts', () => {
  it('keeps final results valid independently of stream delta shape', () => {
    expect(validateResult({ content: 'complete-only result' })).toBe(true);
    expect(
      validateResult({
        content: '',
        finishReason: 'stop',
        toolCalls: [{ toolCallId: 'call-1', toolName: 'Read', arguments: {} }],
      }),
    ).toBe(true);
    expect(
      validateResult({
        content: '',
        safeError: { code: 'MODEL_FAILED', message: 'Model failed safely.', category: 'INTERNAL', retryable: false },
      }),
    ).toBe(true);
  });

  it('keeps finish reason separate from a closed incomplete-output reason', () => {
    expect(validateResult({ content: 'partial', finishReason: 'length', incompleteOutputReason: 'output-limit' })).toBe(true);
    expect(validateResult({ content: '', finishReason: 'tool-calls', incompleteOutputReason: 'truncated-tool-call' })).toBe(true);
    expect(validateResult({ content: '', incompleteOutputReason: null })).toBe(false);
    expect(validateResult({ content: '', incompleteOutputReason: 'provider-quirk' })).toBe(false);
    expect(
      validateResult({
        content: '',
        incompleteOutputReason: 'output-limit',
        safeError: { code: 'MODEL_FAILED', message: 'failed', category: 'INTERNAL', retryable: false },
      }),
    ).toBe(false);
  });

  it('keeps the inference option vocabulary closed at exactly ten fields', () => {
    expect(Object.keys(ModelInferenceOptionsSchema.properties).sort()).toEqual([
      'frequencyPenalty',
      'maxOutputTokens',
      'modelParams',
      'presencePenalty',
      'providerOptions',
      'temperature',
      'thinking',
      'toolChoice',
      'topK',
      'topP',
    ]);
    const validateOptions = ajv.compile(ModelInferenceOptionsSchema);
    expect(
      validateOptions({
        temperature: 0.55,
        maxOutputTokens: 32_000,
        topP: 1,
        topK: 40,
        presencePenalty: 0.2,
        frequencyPenalty: -0.1,
        thinking: { depth: 'HIGH' },
        toolChoice: 'NONE',
        providerOptions: { serviceTier: 'priority' },
        modelParams: { seed: 42 },
      }),
    ).toBe(true);
    expect(validateOptions({ timeoutMs: 30_000 })).toBe(false);
    expect(validateOptions({ maxRetries: 2 })).toBe(false);
    expect(validateOptions({ providerOptions: null })).toBe(false);
    expect(validateOptions({ modelParams: 'seed=42' })).toBe(false);
  });

  it('keeps resolved configurations closed while applying canonical inference constraints', () => {
    const configuration = {
      modelId: 'compatible-model',
      contextWindowTokens: 64_000,
      temperature: 0.55,
      maxOutputTokens: 32_000,
      topP: 1,
      toolChoice: 'AUTO' as const,
      topK: 40,
      presencePenalty: 0.2,
      frequencyPenalty: -0.1,
      thinking: { depth: 'HIGH' },
      defaultTimeoutMs: 30_000,
      defaultMaxRetries: 2,
    };
    expect(validateResolvedConfiguration(configuration)).toBe(true);

    for (const invalidConfiguration of [
      { ...configuration, temperature: 2.1 },
      { ...configuration, maxOutputTokens: 0 },
      { ...configuration, topP: 1.1 },
      { ...configuration, topK: 0 },
      { ...configuration, presencePenalty: 2.1 },
      { ...configuration, frequencyPenalty: -2.1 },
      { ...configuration, thinking: { depth: 'DEEP' } },
      { ...configuration, providerOptions: {} },
      { ...configuration, reasoningTextMode: 'IMPLICIT_OPEN_THINK_TAG' },
    ]) {
      expect(validateResolvedConfiguration(invalidConfiguration)).toBe(false);
    }
  });

  it('requires the one flat trusted scope and enforces run coordinates all-or-none', () => {
    expect(validateScope(backgroundScope())).toBe(true);
    expect(validateScope(runScope())).toBe(true);

    for (const partial of [
      { ...backgroundScope(), sessionId: 'session-1' },
      { ...backgroundScope(), requestId: 'request-1' },
      { ...backgroundScope(), runId: 'run-1' },
      omitRequestId(runScope()),
    ]) {
      expect(validateScope(partial)).toBe(false);
    }

    expect(validateScope({ ...backgroundScope(), nested: { operationId: 'turn-1' } })).toBe(false);
    expect(validateScope({ ...backgroundScope(), operationId: ' \t ' })).toBe(false);
  });

  it('rejects unknown request, nested scope and result fields', () => {
    expect(validateRequest(request())).toBe(true);
    expect(validateRequest({ ...request(), providerId: 'openai-compatible' })).toBe(false);
    expect(validateRequest({ ...request(), reasoningTextMode: 'IMPLICIT_OPEN_THINK_TAG' })).toBe(false);
    expect(
      validateRequest({
        ...request(),
        invocationScope: { identityContext: backgroundScope() },
      }),
    ).toBe(false);

    expect(validateResult({ content: 'done', finishReason: 'stop' })).toBe(true);
    expect(validateResult({ content: 'done', modelId: 'compatible-model' })).toBe(false);
    expect(validateResult({ content: 'done', ['provider' + 'Kind']: 'compatible' })).toBe(false);
  });

  it('keeps stream deltas closed without adding a public discriminator', () => {
    expect(validateDelta({ content: 'visible' })).toBe(true);
    expect(
      validateDelta({
        toolCall: {
          toolCallId: 'call-1',
          toolName: 'Read',
          arguments: { path: 'alarm.log' },
        },
      }),
    ).toBe(true);
    expect(validateDelta({})).toBe(false);
    expect(validateDelta({ kind: 'content', content: 'visible' })).toBe(false);
    expect(
      validateDelta({
        safeError: { code: 'MODEL_FAILED', message: 'Model failed safely.', category: 'INTERNAL', retryable: false },
      }),
    ).toBe(false);
    expect(
      validateDelta({
        toolCall: {
          toolCallId: 'call-1',
          toolName: 'Read',
          arguments: {},
          unknown: true,
        },
      }),
    ).toBe(false);
  });

  it('admits an empty model-returned tool name for the Agent Core correction path', () => {
    expect(
      validateResult({
        content: '',
        toolCalls: [
          {
            toolCallId: 'call-empty-name',
            toolName: '',
            arguments: {},
          },
        ],
      }),
    ).toBe(true);
    expect(
      validateResult({
        content: '',
        toolCalls: [
          {
            toolCallId: 'call-control-name',
            toolName: '\u0000',
            arguments: {},
          },
        ],
      }),
    ).toBe(false);
  });

  it('uses mutually exclusive safe catalog entry shapes', () => {
    const configuration = {
      modelId: 'compatible-model',
      contextWindowTokens: 64_000,
      temperature: 0.55,
      maxOutputTokens: 32_000,
      topP: 1,
      toolChoice: 'AUTO' as const,
      defaultTimeoutMs: 30_000,
      defaultMaxRetries: 2,
    };
    expect(
      validateCatalogEntry({
        availability: 'AVAILABLE',
        fallbackEligible: false,
        configuration,
      }),
    ).toBe(true);
    expect(
      validateCatalogEntry({
        availability: 'AVAILABLE',
        modelId: 'compatible-model',
        fallbackEligible: false,
        configuration,
      }),
    ).toBe(false);
    expect(
      validateCatalogEntry({
        modelId: 'gateway-model',
        availability: 'UNAVAILABLE',
        fallbackEligible: true,
        unavailableReason: 'MODEL_NOT_FOUND',
      }),
    ).toBe(true);
    expect(
      validateCatalogEntry({
        modelId: 'gateway-model',
        availability: 'UNAVAILABLE',
        fallbackEligible: true,
        unavailableReason: 'MODEL_NOT_FOUND',
        configuration,
      }),
    ).toBe(false);
    expect(
      validateCatalogEntry({
        modelId: 'compatible-model',
        availability: 'UNAVAILABLE',
        fallbackEligible: false,
        unavailableReason: 'MODEL_PROVIDER_NOT_CONFIGURED',
      }),
    ).toBe(true);
  });

  it('accepts only the two-level provider configuration and exact provider allowlist', () => {
    const profile = {
      providerId: 'openai-compatible',
      baseUrl: 'https://provider.example/v1',
      credentialRef: 'env:MODEL_TOKEN',
      models: [
        {
          modelId: 'compatible-model',
          displayName: 'Compatible Model',
          fallbackEligible: false,
          temperature: 0.2,
        },
      ],
    };
    expect(validateProviderProfile(profile)).toBe(true);
    expect(
      validateProviderProfile({
        ...profile,
        models: [{ ...profile.models[0], reasoningTextMode: 'IMPLICIT_OPEN_THINK_TAG' }],
      }),
    ).toBe(true);
    expect(
      validateProviderProfile({
        ...profile,
        models: [{ ...profile.models[0], reasoningTextMode: 'EXPLICIT_THINK_TAG' }],
      }),
    ).toBe(true);
    expect(
      validateProviderProfile({
        ...profile,
        models: [{ ...profile.models[0], reasoningTextMode: null }],
      }),
    ).toBe(false);
    expect(
      validateProviderProfile({
        ...profile,
        models: [{ ...profile.models[0], reasoningTextMode: 'AUTO' }],
      }),
    ).toBe(false);
    expect(validateProviderProfile({ ...profile, providerId: 'OpenAI-Compatible' })).toBe(false);
    expect(validateProviderProfile({ ...profile, providerId: 'custom' })).toBe(false);
    expect(validateProviderProfile({ ...profile, models: [] })).toBe(false);
    expect(
      validateProviderProfile({
        ...profile,
        models: [{ ...profile.models[0], credentialRef: 'env:MODEL_TOKEN' }],
      }),
    ).toBe(false);
    expect(
      validateProviderProfile({
        ...profile,
        models: [{ ...profile.models[0], modelId: '   ' }],
      }),
    ).toBe(false);
  });
});

function backgroundScope(): Record<string, unknown> {
  return {
    tenantId: 'tenant-1',
    subjectId: 'subject-1',
    agentId: 'network-agent',
    agentVersion: 'v1',
    agentAssemblyRef: 'network-agent:v1',
    operationId: 'turn-1',
  };
}

function runScope(): Record<string, unknown> {
  return {
    ...backgroundScope(),
    sessionId: 'session-1',
    requestId: 'request-1',
    runId: 'run-1',
  };
}

function request(): Record<string, unknown> {
  return {
    invocationScope: runScope(),
    modelId: 'compatible-model',
    messages: [
      {
        role: 'USER',
        content: [{ type: 'text', text: 'Diagnose the LTE KPI regression.' }],
      },
    ],
    tools: [],
  };
}

function omitRequestId(scope: Record<string, unknown>): Record<string, unknown> {
  const { requestId: _requestId, ...partial } = scope;
  return partial;
}
