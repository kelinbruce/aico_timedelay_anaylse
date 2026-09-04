import { modelEventStreamFixture } from '../../../tests/helpers/model-stream-fixture.js';
import { brand } from '@nextagent/agent-common';
import type { AgentAssembly, AgentAssemblyRegistry } from '@nextagent/agent-contracts/agent-assembly';
import type { ModelInvocationRequest, ModelInvocationService } from '@nextagent/agent-contracts/model';
import type {
  LifecycleHookInvocationPort,
  LifecycleHookInvocationRequest,
  LifecycleHookInvocationResult,
  LifecycleStage,
} from '@nextagent/agent-contracts/runtime';
import { describe, expect, it, vi } from 'vitest';
import { createAppCredentialResolver } from '../src/config/env.js';
import { resolveDefaultSystemConfig } from '../src/config/system-config.js';
import { composeModelRuntime, prepareModelComposition } from '../src/composition/model-composition.js';
import { createScriptedModelProviderFixture } from '../src/testing/scripted-model-provider-fixture.js';

describe('model composition preload', () => {
  it('binds a scripted test provider through the canonical Model Gateway path', async () => {
    const credentialResolver = createAppCredentialResolver({
      OPENAI_MODEL_NAME: 'MiniMax-M2.7-highspeed',
    });
    const systemConfig = resolveDefaultSystemConfig({ cwd: process.cwd(), credentialResolver });
    const model = noopModel();
    const scriptedModel = createScriptedModelProviderFixture(systemConfig, model);
    const composition = prepareModelComposition({
      systemConfig: scriptedModel.systemConfig,
      modelGatewayProviders: scriptedModel.modelGatewayProviders,
    });
    const runtime = composeModelRuntime({
      composition,
      credentialResolver,
      assemblyRegistry: modelAssemblyRegistry(),
      lifecycleHookInvocation: passthroughHook(),
    });

    expect(runtime.modelInvocationService).not.toBe(model);
    expect(scriptedModel.systemConfig.modelProfiles).toEqual([expect.objectContaining({ providerId: 'model-gateway' })]);
    await expect(runtime.modelCatalog.get('MiniMax-M2.7-highspeed', new AbortController().signal)).resolves.toMatchObject({
      availability: 'AVAILABLE',
    });
  });

  it('uses the canonical provider registration rule', () => {
    const credentialResolver = createAppCredentialResolver({
      OPENAI_MODEL_NAME: 'MiniMax-M2.7-highspeed',
    });
    const systemConfig = resolveDefaultSystemConfig({ cwd: process.cwd(), credentialResolver });
    const composition = prepareModelComposition({ systemConfig });

    const runtime = composeModelRuntime({
      credentialResolver,
      composition,
      assemblyRegistry: modelAssemblyRegistry(),
      lifecycleHookInvocation: passthroughHook(),
    });

    expect(runtime).not.toHaveProperty('providerKind');
    expect(runtime.modelCatalog).not.toHaveProperty('complete');
    expect(runtime.modelInvocationService.complete).toBeDefined();
  });

  it('composes a model-gateway-only runtime without OpenAI-compatible registration', async () => {
    const credentialResolver = createAppCredentialResolver({ OPENAI_MODEL_NAME: 'MiniMax-M2.7-highspeed' });
    const systemConfig = resolveDefaultSystemConfig({ cwd: process.cwd(), credentialResolver });
    const scriptedModel = createScriptedModelProviderFixture(systemConfig, noopModel());
    const composition = prepareModelComposition({
      systemConfig: scriptedModel.systemConfig,
      modelGatewayProviders: scriptedModel.modelGatewayProviders,
      modelProviderProfile: 'MODEL_GATEWAY_ONLY',
    });

    const runtime = composeModelRuntime({
      credentialResolver,
      composition,
      assemblyRegistry: modelAssemblyRegistry(),
      lifecycleHookInvocation: passthroughHook(),
    });

    await expect(runtime.modelCatalog.get('MiniMax-M2.7-highspeed', new AbortController().signal)).resolves.toMatchObject({
      availability: 'AVAILABLE',
    });
  });

  it('fails closed when model-gateway-only composition sees an OpenAI-compatible profile', () => {
    const credentialResolver = createAppCredentialResolver({ OPENAI_MODEL_NAME: 'MiniMax-M2.7-highspeed' });
    const systemConfig = resolveDefaultSystemConfig({ cwd: process.cwd(), credentialResolver });
    expect(() =>
      prepareModelComposition({
        systemConfig,
        modelProviderProfile: 'MODEL_GATEWAY_ONLY',
      }),
    ).toThrowError(expect.objectContaining({ code: 'MODEL_PROVIDER_BUILD_PROFILE_INCOMPATIBLE' }));
  });

  it('adapts an optional FetchGateway into the compatible provider registration', async () => {
    const credentialResolver = createAppCredentialResolver({
      NEXTAGENT_TEST_MODEL_API_KEY: 'test-only',
      OPENAI_MODEL_NAME: 'MiniMax-M2.7-highspeed',
    });
    const baseConfig = resolveDefaultSystemConfig({ cwd: process.cwd(), credentialResolver });
    const systemConfig = {
      ...baseConfig,
      modelProfiles: baseConfig.modelProfiles.map((profile) =>
        profile.providerId === 'openai-compatible'
          ? {
              ...profile,
              baseUrl: 'https://api.minimaxi.com/v1',
              credentialRef: brand<'env:NEXTAGENT_TEST_MODEL_API_KEY', 'SecretReference'>('env:NEXTAGENT_TEST_MODEL_API_KEY'),
            }
          : profile,
      ),
    };
    const fetchMock = vi.fn<typeof globalThis.fetch>(
      async (_input, _init) =>
        new Response(
          JSON.stringify({
            id: 'response-composed-fetch',
            object: 'chat.completion',
            created: 0,
            model: 'MiniMax-M2.7-highspeed',
            choices: [
              {
                index: 0,
                message: { role: 'assistant', content: 'composed fetch' },
                finish_reason: 'stop',
              },
            ],
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          },
        ),
    );
    const composition = prepareModelComposition({ systemConfig });
    const runtime = composeModelRuntime({
      credentialResolver,
      composition,
      assemblyRegistry: modelAssemblyRegistry(),
      lifecycleHookInvocation: passthroughHook(),
      fetchGateway: { fetch: fetchMock },
    });

    const result = await runtime.modelInvocationService.complete(modelRequest(), new AbortController().signal);

    expect(result.content).toBe('composed fetch');
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0]?.[1]?.signal).toBeInstanceOf(AbortSignal);
  });
});

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

function modelRequest(): ModelInvocationRequest {
  return {
    invocationScope: {
      tenantId: brand<string, 'TenantId'>('tenant-model-preload'),
      subjectId: brand<string, 'SubjectId'>('subject-model-preload'),
      agentId: brand<string, 'AgentId'>('default-agent'),
      agentVersion: brand<string, 'AgentVersion'>('v1'),
      agentAssemblyRef: 'default-agent:v1',
      operationId: 'model-preload',
      sessionId: brand<string, 'SessionId'>('session-model-preload'),
      requestId: brand<string, 'MessageId'>('request-model-preload'),
      runId: brand<string, 'RequestRunId'>('run-model-preload'),
    },
    modelId: 'MiniMax-M2.7-highspeed',
    messages: [{ role: 'USER', content: [{ type: 'text', text: 'diagnose' }] }],
    tools: [],
    maxRetries: 0,
  };
}

function modelAssemblyRegistry(): AgentAssemblyRegistry {
  const assembly: AgentAssembly = {
    agentId: brand<string, 'AgentId'>('default-agent'),
    agentType: brand<string, 'AgentType'>('LLM'),
    agentVersion: brand<string, 'AgentVersion'>('v1'),
    agentAssemblyRef: 'default-agent:v1',
    displayName: 'Default Agent',
    description: 'model composition test',
    workspacePolicy: {
      schemaVersion: 'nextagent.agent-workspace-policy.v1',
      isolationMode: 'subject',
      roots: [],
    },
    modelIds: ['MiniMax-M2.7-highspeed'],
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
  return {
    async active() {
      return assembly;
    },
    async require() {
      return assembly;
    },
  };
}

function passthroughHook(): LifecycleHookInvocationPort {
  return {
    async invoke<S extends LifecycleStage>(invocation: LifecycleHookInvocationRequest<S>): Promise<LifecycleHookInvocationResult<S>> {
      return { status: 'CONTINUE', boundary: invocation.boundary };
    },
  };
}
