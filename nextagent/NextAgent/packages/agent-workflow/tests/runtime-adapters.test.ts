import { AgentError, brand } from '@nextagent/agent-common';
import type { AgentAssembly } from '@nextagent/agent-contracts/agent-assembly';
import type { CapabilityCatalog, CapabilityDescriptor } from '@nextagent/agent-contracts/capability';
import { createWorkflowRuntimeAdapters } from '../src/runtime-adapters.js';
import { baseRequest } from './test-helpers.js';
import { describe, expect, it, vi } from 'vitest';

const assembly = {
  agentId: brand<string, 'AgentId'>('agent-workflow'),
  agentVersion: brand<string, 'AgentVersion'>('v1'),
  agentAssemblyRef: 'agent-workflow:v1',
} as AgentAssembly;

describe('createWorkflowRuntimeAdapters', () => {
  it('resolves only available capabilities matching kind, provider and model-invocable filters', async () => {
    const tool = descriptor({ capabilityId: brand<string, 'CapabilityId'>('ToolA'), kind: 'TOOL', modelInvocable: true });
    const catalog: Pick<CapabilityCatalog, 'resolve' | 'listAvailable'> = {
      resolve: vi.fn(async () => tool),
      listAvailable: vi.fn(async () => [
        tool,
        descriptor({ capabilityId: brand<string, 'CapabilityId'>('AgentA'), kind: 'AGENT', modelInvocable: true }),
        descriptor({ capabilityId: brand<string, 'CapabilityId'>('ToolB'), kind: 'TOOL', modelInvocable: false }),
        descriptor({ capabilityId: brand<string, 'CapabilityId'>('ToolC'), kind: 'TOOL', availabilityStatus: 'UNAVAILABLE', modelInvocable: true }),
      ]),
    };
    const adapters = createWorkflowRuntimeAdapters({
      catalog: catalog as CapabilityCatalog,
      assemblyRegistry: { require: vi.fn(async () => assembly) },
      modelSelectionService: modelSelectionService(),
      assemblePrompt: () => ({ renderedContent: 'prompt' }),
    });
    const resolver = adapters.runtimeCapabilityResolver?.(baseRequest());
    expect(resolver).toBeDefined();

    await expect(
      resolver!.resolveCapability(
        { capabilityId: brand<string, 'CapabilityId'>('ToolA'), kind: 'TOOL', providerId: 'provider-a' },
        new AbortController().signal,
      ),
    ).resolves.toBe(tool);
    await expect(
      resolver!.resolveCapability(
        { capabilityId: brand<string, 'CapabilityId'>('ToolA'), kind: 'TOOL', providerId: 'other-provider' },
        new AbortController().signal,
      ),
    ).resolves.toBeUndefined();
    await expect(resolver!.listCapabilities!({ kind: 'TOOL', modelInvocable: true }, new AbortController().signal)).resolves.toEqual([tool]);
  });

  it('projects model profiles and prepares inline or template prompts', async () => {
    const adapters = createWorkflowRuntimeAdapters({
      catalog: { resolve: vi.fn(), listAvailable: vi.fn() } as unknown as CapabilityCatalog,
      assemblyRegistry: { require: vi.fn(async () => assembly) },
      modelSelectionService: modelSelectionService(),
      assemblePrompt: vi.fn(() => ({
        renderedContent: 'template system prompt',
        modelOptions: { temperature: 0.2 },
      })),
    });

    await expect(adapters.resolveModelInvocationConfig!(baseRequest(), new AbortController().signal)).resolves.toMatchObject({
      modelId: 'workflow-model',
      contextWindowTokens: 128_000,
      inferenceOptions: { temperature: 0.1 },
      timeoutMs: 7000,
      maxRetries: 2,
    });
    await expect(adapters.prepareLlmPrompt!(llmPromptRequest({ prompt_template: 'inline prompt' }))).resolves.toEqual({
      systemPrompt: 'inline prompt',
      userPrompt: 'default user',
    });
    await expect(adapters.prepareLlmPrompt!(llmPromptRequest({ prompt_template_name: 'workflow/custom' }))).resolves.toMatchObject({
      systemPrompt: 'template system prompt',
      userPrompt: 'default user',
      inferenceOptions: { temperature: 0.2 },
      diagnostic: { reasonCode: 'WORKFLOW_LLM_PROMPT_TEMPLATE_APPLIED' },
    });
  });

  it('maps prompt template failures to workflow-safe validation errors', async () => {
    const adapters = createWorkflowRuntimeAdapters({
      catalog: { resolve: vi.fn(), listAvailable: vi.fn() } as unknown as CapabilityCatalog,
      assemblyRegistry: { require: vi.fn(async () => assembly) },
      modelSelectionService: modelSelectionService(),
      assemblePrompt: () => {
        throw new AgentError({ code: 'PROMPT_TEMPLATE_UNAVAILABLE', message: 'prompt missing', category: 'VALIDATION', retryable: false });
      },
    });

    await expect(adapters.prepareLlmPrompt!(llmPromptRequest({ prompt_template_name: 'missing' }))).rejects.toMatchObject({
      code: 'WORKFLOW_LLM_PROMPT_TEMPLATE_UNAVAILABLE',
      category: 'VALIDATION',
      safeDetails: {
        reasonCode: 'WORKFLOW_LLM_PROMPT_TEMPLATE_UNAVAILABLE',
        nodeId: 'node-llm',
        nodeType: 'LLM',
        purpose: 'missing',
      },
    });
  });
});

function modelSelectionService() {
  return {
    async select() {
      return {
        status: 'SELECTED' as const,
        reason: 'AGENT_DEFAULT' as const,
        configuration: {
          modelId: 'workflow-model',
          contextWindowTokens: 128_000,
          temperature: 0.1,
          maxOutputTokens: 32_000,
          topP: 1,
          toolChoice: 'AUTO' as const,
          defaultTimeoutMs: 7_000,
          defaultMaxRetries: 2,
        },
      };
    },
  };
}

function descriptor(overrides: Partial<CapabilityDescriptor>): CapabilityDescriptor {
  return {
    capabilityId: brand<string, 'CapabilityId'>('ToolA'),
    kind: 'TOOL',
    provider: { providerId: 'provider-a', providerKind: 'BUNDLED' },
    displayName: 'Tool A',
    description: 'Tool A',
    availabilityStatus: 'AVAILABLE',
    ...overrides,
  };
}

function llmPromptRequest(resolvedInputs: Record<string, unknown>) {
  return {
    nodeId: 'node-llm',
    node: { type: 'LLM' },
    request: baseRequest(),
    modelConfig: { modelId: 'workflow-model', contextWindowTokens: 128_000, inferenceOptions: {}, timeoutMs: 1000, maxRetries: 2 },
    resolvedInputs,
    defaultPurpose: 'workflow/default',
    defaultUserPrompt: 'default user',
  } as Parameters<NonNullable<ReturnType<typeof createWorkflowRuntimeAdapters>['prepareLlmPrompt']>>[0];
}
