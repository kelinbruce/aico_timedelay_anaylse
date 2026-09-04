import { brand } from '@nextagent/agent-common';
import type { ContextAssembly, ContextAssemblyRequest } from '@nextagent/agent-contracts/context';
import type { ModelInferenceOptions } from '@nextagent/agent-contracts/model';
import { DefaultContextEngine, DefaultModelInputRenderer, mergePromptModelOptions } from '@nextagent/agent-context-engine';
import { describe, expect, it, vi } from 'vitest';

describe('Context Engine model option assembly', () => {
  it('applies profile, selected template and governed Skill patch precedence field by field', () => {
    const profile: ModelInferenceOptions = {
      temperature: 0.55,
      maxOutputTokens: 32_000,
      topP: 1,
      topK: 20,
      presencePenalty: 0,
      frequencyPenalty: 0,
      thinking: { depth: 'LOW' },
      toolChoice: 'AUTO' as const,
    };
    const template: ModelInferenceOptions = {
      temperature: 0.4,
      topP: 0.9,
      topK: 40,
      thinking: { depth: 'MEDIUM' },
      toolChoice: 'REQUIRED',
      providerOptions: {
        nested: { source: 'template', retained: false },
        templateOnly: true,
      },
    };
    const governedSkillPatch: ModelInferenceOptions = {
      maxOutputTokens: 4096,
      presencePenalty: 0.3,
      frequencyPenalty: -0.2,
      toolChoice: 'NONE',
      providerOptions: {
        nested: { source: 'skill' },
        skillOnly: true,
      },
    };

    const effective = mergePromptModelOptions(mergePromptModelOptions(profile, template), governedSkillPatch);

    expect(effective).toEqual({
      temperature: 0.4,
      maxOutputTokens: 4096,
      topP: 0.9,
      topK: 40,
      presencePenalty: 0.3,
      frequencyPenalty: -0.2,
      thinking: { depth: 'MEDIUM' },
      toolChoice: 'NONE',
      providerOptions: {
        nested: { source: 'skill' },
        templateOnly: true,
        skillOnly: true,
      },
    });
  });

  it('shallow-merges trusted request provider options last and replaces nested values as a whole', async () => {
    const renderer = new DefaultModelInputRenderer();
    const rendered = await renderer.render({
      assembly: assembly({
        nested: { source: 'skill', retained: false },
        templateOnly: true,
        skillOnly: true,
      }),
      selectedMessages: [],
      providerOptions: {
        nested: { source: 'trusted-request' },
        requestOnly: true,
      },
    });

    expect(rendered.providerOptions).toEqual({
      nested: { source: 'trusted-request' },
      templateOnly: true,
      skillOnly: true,
      requestOnly: true,
    });
  });

  it('does not synthesize provider options when every call-level source is absent', async () => {
    const renderer = new DefaultModelInputRenderer();
    const rendered = await renderer.render({
      assembly: assembly(),
      selectedMessages: [],
    });

    expect(rendered).not.toHaveProperty('providerOptions');
    expect(rendered.modelOptions).not.toHaveProperty('providerOptions');
  });

  it('rejects malformed fallback options before reading context dependencies', async () => {
    const loadActiveContext = vi.fn();
    const requireAssembly = vi.fn();
    const engine = new DefaultContextEngine({
      activeContextStore: { load: loadActiveContext } as never,
      messageStore: {} as never,
      assemblyRegistry: { require: requireAssembly } as never,
      capabilityCatalog: {} as never,
      modelSelectionService: {} as never,
    });

    await expect(engine.assemble({} as ContextAssemblyRequest, { mode: 'FALLBACK' }, new AbortController().signal)).rejects.toMatchObject({
      code: 'CONTEXT_ASSEMBLY_OPTIONS_INVALID',
    });
    expect(loadActiveContext).not.toHaveBeenCalled();
    expect(requireAssembly).not.toHaveBeenCalled();
  });
});

function assembly(providerOptions?: ModelInferenceOptions['providerOptions']): ContextAssembly {
  return {
    request: {
      sessionId: brand<string, 'SessionId'>('session'),
      requestId: brand<string, 'MessageId'>('request'),
      requestContextId: brand<string, 'RequestContextId'>('context'),
      identityContext: {
        tenantId: brand<string, 'TenantId'>('tenant'),
        subjectId: brand<string, 'SubjectId'>('subject'),
        displayName: 'Operator',
      },
      agentId: brand<string, 'AgentId'>('agent'),
      agentVersion: brand<string, 'AgentVersion'>('v1'),
      runId: brand<string, 'RequestRunId'>('run'),
      stepId: 'turn-1',
      locale: brand<string, 'RequestLocale'>('en-US'),
      purpose: 'SYSTEM_PROMPT',
    },
    systemPrompt: {
      sections: [
        {
          sectionId: 'identity',
          heading: 'Identity',
          content: 'You are a telecom diagnostics agent.',
          metadata: {
            overridable: false,
            order: 0,
            dependencies: [],
          },
        },
      ],
    },
    selectedMessageRefs: [],
    visibleCapabilities: [],
    modelConfiguration: {
      modelId: 'model-a',
      contextWindowTokens: 64_000,
      temperature: 0.55,
      maxOutputTokens: 32_000,
      topP: 1,
      toolChoice: 'AUTO' as const,
      defaultTimeoutMs: 30_000,
      defaultMaxRetries: 2,
    },
    modelOptions: {
      temperature: 0.55,
      maxOutputTokens: 32_000,
      topP: 1,
      ...(providerOptions === undefined ? {} : { providerOptions }),
    },
    modelSelectionReason: 'AGENT_DEFAULT',
  };
}
