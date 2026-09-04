import { createTestModelSelectionService } from './test-model-selection-helpers.js';
import { DefaultContextEngine, SYSTEM_PROMPT, type PromptTemplateAssembler } from '@nextagent/agent-context-engine';
import { AgentError, brand } from '@nextagent/agent-common';
import type { AgentAssembly } from '@nextagent/agent-contracts/agent-assembly';
import type { CapabilityCatalog, CapabilityCatalogRequest, CapabilityDescriptor, SkillMetadata } from '@nextagent/agent-contracts/capability';
import { describe, expect, it } from 'vitest';

describe('Context Engine Skill disclosure render', () => {
  it('partitions TOOL descriptors from SKILL disclosure and renders fixed English Skill instructions', async () => {
    const catalogRequests: CapabilityCatalogRequest[] = [];
    const engine = contextEngine(
      [skillTool(), readTool(), hiddenMcpTool(), skill('network-diagnostics'), skill('user-only', { modelInvocable: false })],
      { catalogRequests },
    );
    const rendered = await engine.render(await engine.assemble(request(), undefined, new AbortController().signal));

    expect(rendered.tools.map((tool) => tool.name)).toEqual(['Skill', 'Read']);
    expect(catalogRequests[0]).toMatchObject({ includeUnavailable: false, modelInvocable: true });
    const systemText = String(rendered.messages[0]?.content[0]?.type === 'text' ? rendered.messages[0].content[0].text : '');
    expect(systemText).toContain('Workspace root:');
    expect(systemText).toContain('Locale/language hint: en-US.');
    expect(systemText).toContain('### Available skills');
    expect(systemText).toContain('- network-diagnostics: Safe network Skill.');
    expect(systemText).not.toContain('user-only');
    expect(systemText).toContain('### How to use skills');
    expect(systemText).toContain('call the `Skill` tool immediately in the same assistant turn');
    expect(systemText).toContain('Such planning text is incomplete and is not a final answer.');
    expect(systemText).toContain("Construct task-specific ``args`` directly from the user's request");
    expect(systemText).not.toContain('C:\\');
    expect(systemText).not.toContain('SKILL.md');
    expect(systemText).not.toContain('sourceIdentity');
    expect(systemText).not.toContain('frontmatterHash');
  });

  it('renders TodoWrite by its canonical descriptor name without aliases', async () => {
    const engine = contextEngine([skillTool(), readTool(), todoWriteTool(), skill('network-diagnostics')]);
    const rendered = await engine.render(await engine.assemble(request(), undefined, new AbortController().signal));

    expect(rendered.tools.map((tool) => tool.name)).toEqual(['Skill', 'Read', 'TodoWrite']);
    expect(rendered.tools.find((tool) => tool.name === 'TodoWrite')).toMatchObject({
      name: 'TodoWrite',
      inputSchema: { type: 'object' },
    });
    expect(rendered.tools.map((tool) => tool.name)).not.toContain('todo_write');
    expect(rendered.tools.map((tool) => tool.name)).not.toContain('todoWrite');
  });

  it('renders governed Agent capabilities as safe delegable targets', async () => {
    const engine = contextEngine([skillTool(), readTool(), agent('alarm-correlation'), agent('hidden-agent', { modelInvocable: false })]);
    const rendered = await engine.render(await engine.assemble(request(), undefined, new AbortController().signal));
    const systemText = String(rendered.messages[0]?.content[0]?.type === 'text' ? rendered.messages[0].content[0].text : '');

    expect(systemText).toContain('### Available agents');
    expect(systemText).toContain('- alarm-correlation: Delegate telecom alarm correlation.');
    expect(systemText).not.toContain('hidden-agent');
    expect(systemText).not.toContain('sourceIdentity');
    expect(systemText).not.toContain('C:\\secret');
    expect(systemText).not.toContain('sourceIdentity');
    expect(systemText).not.toContain('loading-key');
    expect(systemText).not.toContain('prompt leak');
    expect(systemText).not.toContain('childAssembly');
  });

  it('activates hidden allowed tools from available capabilities without hiding baseline model-visible tools', async () => {
    const catalogRequests: CapabilityCatalogRequest[] = [];
    const engine = contextEngine([skillTool(), readTool(), hiddenMcpTool(), skill('network-diagnostics')], { catalogRequests });
    const rendered = await engine.render(
      await engine.assemble(
        {
          ...request(),
          capabilityContextPatch: { allowedTools: [brand<string, 'CapabilityId'>('@mcp-network/mcp-diagnose-link')] },
        },
        undefined,
        new AbortController().signal,
      ),
    );

    expect(rendered.tools.map((tool) => tool.name)).toEqual(['Skill', 'Read', 'mcp-diagnose-link']);
    const systemText = String(rendered.messages[0]?.content[0]?.type === 'text' ? rendered.messages[0].content[0].text : '');
    expect(systemText).toContain('### Available skills');
    expect(catalogRequests.map((catalogRequest) => catalogRequest.modelInvocable)).toEqual([true, undefined]);
  });

  it('matches allowed tools case-insensitively for bare and provider-qualified refs', async () => {
    const engine = contextEngine([skillTool(), readTool(), hiddenMcpTool(), skill('network-diagnostics')]);
    const rendered = await engine.render(
      await engine.assemble(
        {
          ...request(),
          capabilityContextPatch: {
            allowedTools: [brand<string, 'CapabilityId'>('read'), brand<string, 'CapabilityId'>('@MCP-NETWORK/MCP-DIAGNOSE-LINK')],
          },
        },
        undefined,
        new AbortController().signal,
      ),
    );

    expect(rendered.tools.map((tool) => tool.name)).toEqual(['Skill', 'Read', 'mcp-diagnose-link']);
  });

  it('applies denied tools as the final exclusion after allowed tool activation', async () => {
    const catalogRequests: CapabilityCatalogRequest[] = [];
    const engine = contextEngine([skillTool(), readTool(), hiddenMcpTool(), skill('network-diagnostics')], { catalogRequests });
    const rendered = await engine.render(
      await engine.assemble(
        {
          ...request(),
          capabilityContextPatch: {
            allowedTools: [brand<string, 'CapabilityId'>('@mcp-network/mcp-diagnose-link')],
            deniedTools: [brand<string, 'CapabilityId'>('Read'), brand<string, 'CapabilityId'>('missing-tool')],
          },
        },
        undefined,
        new AbortController().signal,
      ),
    );

    expect(rendered.tools.map((tool) => tool.name)).toEqual(['Skill', 'mcp-diagnose-link']);
    const systemText = String(rendered.messages[0]?.content[0]?.type === 'text' ? rendered.messages[0].content[0].text : '');
    expect(systemText).toContain('### Available skills');
    expect(catalogRequests.map((catalogRequest) => catalogRequest.modelInvocable)).toEqual([true, undefined]);
  });

  it('matches denied tools case-insensitively', async () => {
    const engine = contextEngine([skillTool(), readTool(), hiddenMcpTool(), skill('network-diagnostics')]);
    const rendered = await engine.render(
      await engine.assemble(
        {
          ...request(),
          capabilityContextPatch: {
            allowedTools: [brand<string, 'CapabilityId'>('@mcp-network/mcp-diagnose-link')],
            deniedTools: [brand<string, 'CapabilityId'>('read'), brand<string, 'CapabilityId'>('@BUILTIN-TOOLS/SKILL')],
          },
        },
        undefined,
        new AbortController().signal,
      ),
    );

    expect(rendered.tools.map((tool) => tool.name)).toEqual(['mcp-diagnose-link']);
  });

  it('omits Skill disclosure when denied tools remove the Skill wrapper', async () => {
    const engine = contextEngine([skillTool(), readTool(), skill('network-diagnostics')]);
    const rendered = await engine.render(
      await engine.assemble(
        {
          ...request(),
          capabilityContextPatch: { deniedTools: [brand<string, 'CapabilityId'>('@builtin-tools/Skill')] },
        },
        undefined,
        new AbortController().signal,
      ),
    );
    const systemText = String(rendered.messages[0]?.content[0]?.type === 'text' ? rendered.messages[0].content[0].text : '');

    expect(rendered.tools.map((tool) => tool.name)).toEqual(['Read']);
    expect(systemText).not.toContain('### Available skills');
  });

  it('rejects invalid allowed tools at Context Engine assembly', async () => {
    const engine = contextEngine([skillTool(), readTool()]);

    await expect(
      engine.assemble(
        {
          ...request(),
          capabilityContextPatch: { allowedTools: [brand<string, 'CapabilityId'>('missing-tool')] },
        },
        undefined,
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ code: 'CAPABILITY_CONTEXT_PATCH_DENIED' });
  });

  it('omits Skill disclosure when the Skill tool is filtered out and rejects oversized generated Skill context before model invoke', async () => {
    const engine = contextEngine([readTool(), skill('network-diagnostics')], { maxGeneratedMessageChars: 16 });
    const rendered = await engine.render(await engine.assemble(request(), undefined, new AbortController().signal));
    const systemText = String(rendered.messages[0]?.content[0]?.type === 'text' ? rendered.messages[0].content[0].text : '');

    expect(rendered.tools.map((tool) => tool.name)).toEqual(['Read']);
    expect(systemText).not.toContain('### Available skills');

    await expect(
      engine.render(
        await engine.assemble(
          {
            ...request(),
            capabilityGeneratedMessages: [
              { role: 'USER', meta: true, content: '<skill_content name="network-diagnostics">too long</skill_content>' },
            ],
          },
          undefined,
          new AbortController().signal,
        ),
      ),
    ).rejects.toMatchObject({ code: 'CAPABILITY_GENERATED_CONTEXT_BUDGET_EXCEEDED' });
  });

  it('applies prompt template assembly output to ContextAssembly', async () => {
    const assembler: PromptTemplateAssembler = {
      async assemble(request) {
        expect(request.purpose).toBe(SYSTEM_PROMPT);
        expect(request.selectedModel).toEqual({ modelId: 'test-model' });
        return {
          templateId: 'agent-template',
          templateRef: 'agent:default-agent:v1:agent-template:test',
          sections: [{ id: 'identity', content: 'Profile identity' }],
          renderedContent: 'Profile identity',
          modelOptions: { temperature: 0.2, maxOutputTokens: 2048 },
        };
      },
    };
    const engine = contextEngine([skillTool(), readTool()], { promptTemplateAssembler: assembler });

    const assembly = await engine.assemble(request(), undefined, new AbortController().signal);

    expect(assembly.modelOptions).toEqual({
      temperature: 0.2,
      maxOutputTokens: 2048,
      topP: 1,
      toolChoice: 'AUTO',
    });
    expect(assembly.systemPrompt.sections.find((section) => section.sectionId === 'identity')?.content).toBe('Profile identity');
    expect(Object.hasOwn(assembly, 'profileRef')).toBe(false);
  });

  it('refreshes capability disclosure from the catalog on each assembly', async () => {
    let capabilities: readonly CapabilityDescriptor[] = [skillTool(), readTool(), skill('network-diagnostics')];
    const engine = contextEngine([], { capabilitySource: () => capabilities });

    const first = await engine.render(await engine.assemble(request(), undefined, new AbortController().signal));
    capabilities = [];
    const second = await engine.render(await engine.assemble(request(), undefined, new AbortController().signal));
    const firstSystem = String(first.messages[0]?.content[0]?.type === 'text' ? first.messages[0].content[0].text : '');
    const secondSystem = String(second.messages[0]?.content[0]?.type === 'text' ? second.messages[0].content[0].text : '');

    expect(first.tools.map((tool) => tool.name)).toEqual(['Skill', 'Read']);
    expect(firstSystem).toContain('### Available skills');
    expect(second.tools).toEqual([]);
    expect(secondSystem).not.toContain('### Available skills');
  });

  it('keeps ToolSearch visible by default without pruning existing model-visible tools', async () => {
    const engine = contextEngine([toolSearchTool(), skillTool(), readTool(), deferredDiagnosticTool(), skill('network-diagnostics')]);

    const initial = await engine.render(await engine.assemble(request(), undefined, new AbortController().signal));

    expect(initial.tools.map((tool) => tool.name)).toEqual(['ToolSearch', 'Skill', 'Read', 'deferred-diagnostic']);
  });

  it('keeps existing model-visible tools unchanged when explicit ToolSearch mode is enabled', async () => {
    const engine = contextEngine([toolSearchTool(), skillTool(), readTool(), deferredDiagnosticTool(), skill('network-diagnostics')], {
      toolDisclosureMode: 'tool-search',
    });

    const initial = await engine.render(await engine.assemble(request(), undefined, new AbortController().signal));
    const activated = await engine.render(
      await engine.assemble(
        {
          ...request(),
          capabilityContextPatch: { allowedTools: [brand<string, 'CapabilityId'>('deferred-diagnostic')] },
        },
        undefined,
        new AbortController().signal,
      ),
    );

    expect(initial.tools.map((tool) => tool.name)).toEqual(['ToolSearch', 'Skill', 'Read', 'deferred-diagnostic']);
    expect(activated.tools.map((tool) => tool.name)).toEqual(['ToolSearch', 'Skill', 'Read', 'deferred-diagnostic']);
  });

  it('renders deferred CLIP ids while withholding CLIP tools until ToolSearch activates them', async () => {
    const engine = contextEngine([toolSearchTool(), skillTool(), readTool(), clipcTool('clipc-api-001'), clipcTool('clipc-api-002')]);

    const initial = await engine.render(await engine.assemble(request(), undefined, new AbortController().signal));
    const activated = await engine.render(
      await engine.assemble(
        {
          ...request(),
          capabilityContextPatch: { allowedTools: [brand<string, 'CapabilityId'>('clipc-api-002')] },
        },
        undefined,
        new AbortController().signal,
      ),
    );
    const initialSystemText = String(initial.messages[0]?.content[0]?.type === 'text' ? initial.messages[0].content[0].text : '');

    expect(initial.tools.map((tool) => tool.name)).toEqual(['ToolSearch', 'Skill', 'Read']);
    expect(initialSystemText).toContain('<available-deferred-clipc>\nclipc-api-001\nclipc-api-002\n</available-deferred-clipc>');
    expect(initialSystemText).not.toContain('CLIP private primitive');
    expect(activated.tools.map((tool) => tool.name)).toEqual(['ToolSearch', 'Skill', 'Read', 'clipc-api-002']);
    expect(activated.tools.find((tool) => tool.name === 'clipc-api-002')?.inputSchema).toEqual({ type: 'object' });
  });

  it('renders deferred Skill ids without descriptions when Skill disclosure uses ToolSearch mode', async () => {
    const engine = contextEngine([toolSearchTool(), skillTool(), readTool(), skill('network-diagnostics')], { skillDisclosureMode: 'tool-search' });

    const rendered = await engine.render(await engine.assemble(request(), undefined, new AbortController().signal));
    const systemText = String(rendered.messages[0]?.content[0]?.type === 'text' ? rendered.messages[0].content[0].text : '');

    expect(rendered.tools.map((tool) => tool.name)).toEqual(['ToolSearch', 'Skill', 'Read']);
    expect(systemText).toContain('### Available skills');
    expect(systemText).toContain('- network-diagnostics:');
    expect(systemText).toContain('Safe network Skill.');
    expect(systemText).not.toContain('<available-deferred-skills>');
    expect(systemText).toContain('Enabled Skills listed above may be called directly');
    expect(systemText).toContain('Use `ToolSearch` to find deferred Skills that are not listed above');
    expect(systemText).toContain('ToolSearch Skill matches appear in `<available-skills>`');
    expect(systemText).toContain('`defer_loading=true` means only metadata is loaded');
    expect(systemText).toContain('call the `Skill` tool immediately in the same assistant turn');
    expect(systemText).toContain('Such planning text is incomplete and is not a final answer.');
    expect(systemText).toContain("Construct task-specific ``args`` directly from the user's request");
  });

  it('honors descriptor disclosure policy when rendering Skill lists', async () => {
    const engine = contextEngine([
      skillTool(),
      readTool(),
      skill('eager-skill'),
      { ...skill('search-skill'), disclosurePolicy: { mode: 'DEFERRED' as const } },
      { ...skill('hidden-skill'), disclosurePolicy: { mode: 'HIDDEN' as const } },
    ]);

    const rendered = await engine.render(await engine.assemble(request(), undefined, new AbortController().signal));
    const systemText = String(rendered.messages[0]?.content[0]?.type === 'text' ? rendered.messages[0].content[0].text : '');
    const availableSkills = systemText.split('### Available skills')[1]?.split('### How to use skills')[0] ?? '';

    expect(availableSkills).toContain('- eager-skill:');
    expect(availableSkills).not.toContain('- search-skill:');
    expect(availableSkills).not.toContain('- hidden-skill:');
  });

  it('keeps eager-policy Skills visible while ToolSearch mode defers the rest', async () => {
    const engine = contextEngine(
      [toolSearchTool(), skillTool(), { ...skill('always-load-skill'), disclosurePolicy: { mode: 'EAGER' as const } }, skill('search-default-skill')],
      { skillDisclosureMode: 'tool-search' },
    );

    const rendered = await engine.render(await engine.assemble(request(), undefined, new AbortController().signal));
    const systemText = String(rendered.messages[0]?.content[0]?.type === 'text' ? rendered.messages[0].content[0].text : '');

    expect(systemText).toContain('### Available skills');
    expect(systemText).toContain('- always-load-skill:');
    expect(systemText).toContain('- search-default-skill:');
    expect(systemText).not.toContain('<available-deferred-skills>');
    expect(systemText).toContain('Enabled Skills listed above may be called directly');
  });

  it('renders the skill list exactly once with no duplicate tooling copy', async () => {
    const engine = contextEngine([skillTool(), readTool(), skill('network-diagnostics')]);
    const rendered = await engine.render(await engine.assemble(request(), undefined, new AbortController().signal));
    const systemText = String(rendered.messages[0]?.content[0]?.type === 'text' ? rendered.messages[0].content[0].text : '');

    expect(systemText.match(/- network-diagnostics: Safe network Skill\./gu)?.length).toBe(1);
    expect(systemText).not.toContain('Available skill capabilities');
  });
});

function contextEngine(
  capabilities: readonly CapabilityDescriptor[],
  options: {
    readonly maxGeneratedMessageChars?: number;
    readonly catalogRequests?: CapabilityCatalogRequest[];
    readonly promptTemplateAssembler?: PromptTemplateAssembler;
    readonly capabilitySource?: () => readonly CapabilityDescriptor[];
    readonly toolDisclosureMode?: 'list' | 'tool-search';
    readonly skillDisclosureMode?: 'list' | 'tool-search';
  } = {},
) {
  const assembly = testAssembly();
  return new DefaultContextEngine({
    activeContextStore: {
      async loadActiveContext() {
        // Skill-disclosure tests focus on capability/SystemPrompt rendering and intentionally
        // start from an empty active context. Throw a NOT_FOUND-coded AgentError so the
        // stricter loadActiveContextOrEmpty in DefaultContextEngine treats this as a
        // legitimate empty session rather than a hard CONTEXT_ACTIVE_VIEW_UNRESOLVABLE.
        throw new AgentError({
          code: 'NOT_FOUND',
          message: 'no active context for this test session',
          category: 'NOT_FOUND',
          retryable: false,
        });
      },
      async appendItem() {
        throw new Error('unused');
      },
      async commitCompaction() {
        throw new Error('unused');
      },
      async updateMetadata() {
        return { status: 'UPDATED' as const };
      },
    },
    messageStore: {
      async loadMessage() {
        return undefined;
      },
      async loadMessages() {
        return [];
      },
      async appendSessionMessage() {
        throw new Error('unused');
      },
      async listConversationPreview() {
        throw new Error('unused');
      },
      async listMessages() {
        throw new Error('unused');
      },
      async listCurrentRequestMessages() {
        throw new Error('unused');
      },
      async hideMessage() {
        throw new Error('unused');
      },
      async hideRequestMessages() {
        throw new Error('unused');
      },
    },
    assemblyRegistry: {
      async active() {
        return assembly;
      },
      async require() {
        return assembly;
      },
    },
    capabilityCatalog: {
      async listAvailable(catalogRequest) {
        options.catalogRequests?.push(catalogRequest);
        return (options.capabilitySource?.() ?? capabilities).filter(
          (capability) =>
            catalogRequest.modelInvocable === undefined ||
            (catalogRequest.modelInvocable ? capability.modelInvocable === true : capability.modelInvocable !== true),
        );
      },
      async resolve() {
        return undefined;
      },
    } satisfies CapabilityCatalog,
    modelSelectionService: createTestModelSelectionService({ modelId: 'test-model', contextWindowTokens: 128_000 }),
    ...(options.toolDisclosureMode === undefined ? {} : { toolDisclosureMode: options.toolDisclosureMode }),
    ...(options.skillDisclosureMode === undefined ? {} : { skillDisclosureMode: options.skillDisclosureMode }),
    ...(options.promptTemplateAssembler === undefined ? {} : { promptTemplateAssembler: options.promptTemplateAssembler }),
    ...(options.maxGeneratedMessageChars === undefined ? {} : { maxGeneratedMessageChars: options.maxGeneratedMessageChars }),
  });
}

function request() {
  return {
    sessionId: brand<string, 'SessionId'>('session-context'),
    requestId: brand<string, 'MessageId'>('message-context'),
    requestContextId: brand<string, 'RequestContextId'>('request-context'),
    identityContext: {
      tenantId: brand<string, 'TenantId'>('tenant-context'),
      subjectId: brand<string, 'SubjectId'>('subject-context'),
      displayName: 'Context tester',
    },
    agentId: brand<string, 'AgentId'>('default-agent'),
    agentVersion: brand<string, 'AgentVersion'>('v1'),
    runId: brand<string, 'RequestRunId'>('run-context'),
    stepId: 'turn-1',
    locale: brand<string, 'RequestLocale'>('en-US'),
    purpose: 'test',
  };
}

function testAssembly(): AgentAssembly {
  return {
    agentId: brand<string, 'AgentId'>('default-agent'),
    agentType: brand<string, 'AgentType'>('default'),
    agentVersion: brand<string, 'AgentVersion'>('v1'),
    agentAssemblyRef: 'default-agent:v1',
    displayName: 'Default Agent',
    description: 'Telecom test agent.',
    workspacePolicy: {
      schemaVersion: 'nextagent.agent-workspace-policy.v1',
      isolationMode: 'subject',
      roots: [
        { kind: 'workspace', logicalPath: 'workspace', access: 'readWrite' },
        { kind: 'systemResources', logicalPath: '.nextagent', access: 'read' },
        { kind: 'temp', logicalPath: 'temp', access: 'readWrite' },
      ],
    },
    modelIds: ['default'],
    capabilityBindings: [],
    userInvocable: true,
    agentInvocation: 'BOUND',
    runtimeSettings: { maxContextMessages: 20 },
  };
}

function skillTool(): CapabilityDescriptor {
  return {
    capabilityId: brand<string, 'CapabilityId'>('Skill'),
    kind: 'TOOL',
    provider: { providerId: 'builtin-tools', providerKind: 'BUNDLED' },
    displayName: 'Skill',
    description: 'Load a governed Skill.',
    modelInvocable: true,
    availabilityStatus: 'AVAILABLE',
    inputSchema: { type: 'object' },
    outputSchema: { type: 'object' },
  };
}

function toolSearchTool(): CapabilityDescriptor {
  return {
    capabilityId: brand<string, 'CapabilityId'>('ToolSearch'),
    kind: 'TOOL',
    provider: { providerId: 'builtin-tools', providerKind: 'BUNDLED' },
    displayName: 'ToolSearch',
    description: 'Search governed Tool metadata.',
    modelInvocable: true,
    availabilityStatus: 'AVAILABLE',
    inputSchema: { type: 'object' },
    outputSchema: { type: 'object' },
  };
}

function readTool(): CapabilityDescriptor {
  return {
    capabilityId: brand<string, 'CapabilityId'>('Read'),
    kind: 'TOOL',
    provider: { providerId: 'builtin-tools', providerKind: 'BUNDLED' },
    displayName: 'Read',
    description: 'Read files.',
    modelInvocable: true,
    availabilityStatus: 'AVAILABLE',
    disclosurePolicy: { mode: 'EAGER' },
    inputSchema: { type: 'object' },
    outputSchema: { type: 'object' },
  };
}

function todoWriteTool(): CapabilityDescriptor {
  return {
    capabilityId: brand<string, 'CapabilityId'>('TodoWrite'),
    kind: 'TOOL',
    provider: { providerId: 'builtin-tools', providerKind: 'BUNDLED' },
    displayName: 'TodoWrite',
    description: 'Replace the current scoped progress todo list.',
    modelInvocable: true,
    availabilityStatus: 'AVAILABLE',
    replayPolicy: 'NON_IDEMPOTENT',
    inputSchema: { type: 'object' },
    outputSchema: { type: 'object' },
  };
}

function deferredDiagnosticTool(): CapabilityDescriptor {
  return {
    capabilityId: brand<string, 'CapabilityId'>('deferred-diagnostic'),
    kind: 'TOOL',
    provider: { providerId: 'builtin-tools', providerKind: 'BUNDLED' },
    displayName: 'deferred-diagnostic',
    description: 'Deferred diagnostic Tool.',
    modelInvocable: true,
    availabilityStatus: 'AVAILABLE',
    inputSchema: { type: 'object' },
    outputSchema: { type: 'object' },
  };
}

function clipcTool(name: string): CapabilityDescriptor {
  return {
    capabilityId: brand<string, 'CapabilityId'>(name),
    kind: 'TOOL',
    provider: { providerId: 'clip-backed', providerKind: 'CUSTOM', providerType: 'clip_server' },
    displayName: name,
    description: 'Search-gated CLIP telecom Tool.',
    modelInvocable: true,
    availabilityStatus: 'AVAILABLE',
    disclosurePolicy: { mode: 'DEFERRED', searchHint: 'CLIP telecom search hint' },
    inputSchema: { type: 'object' },
    outputSchema: { type: 'object' },
    metadata: { privatePrimitive: 'CLIP private primitive' },
  };
}

function hiddenMcpTool(): CapabilityDescriptor {
  return {
    capabilityId: brand<string, 'CapabilityId'>('mcp-diagnose-link'),
    kind: 'TOOL',
    provider: { providerId: 'mcp-network', providerKind: 'MCP_SERVER' },
    displayName: 'mcp-diagnose-link',
    description: 'Hidden MCP diagnostic tool.',
    modelInvocable: false,
    availabilityStatus: 'AVAILABLE',
    inputSchema: { type: 'object' },
    outputSchema: { type: 'object' },
  };
}

function skill(name: string, overrides: Partial<SkillMetadata> = {}): CapabilityDescriptor {
  const metadata: SkillMetadata = {
    metadataKind: 'nextagent.skill',
    context: 'inline',
    userInvocable: false,
    modelInvocable: true,
    sourceMetadata: { sourceIdentity: `C:\\secret\\${name}\\SKILL.md`, frontmatterHash: 'hash' },
    ...overrides,
  };
  return {
    capabilityId: brand<string, 'CapabilityId'>(name),
    kind: 'SKILL',
    provider: { providerId: 'builtin-skills', providerKind: 'BUNDLED' },
    displayName: name,
    description: 'Safe network Skill.',
    modelInvocable: metadata.modelInvocable,
    availabilityStatus: 'AVAILABLE',
    metadata,
  };
}

function agent(name: string, overrides: Partial<CapabilityDescriptor> = {}): CapabilityDescriptor {
  return {
    capabilityId: brand<string, 'CapabilityId'>(name),
    kind: 'AGENT',
    provider: { providerId: 'local-agents', providerKind: 'LOCAL_DIRECTORY' },
    displayName: name,
    description: 'Delegate telecom alarm correlation.',
    modelInvocable: true,
    availabilityStatus: 'AVAILABLE',
    metadata: {
      sourceIdentity: 'C:\\secret\\agent.yaml',
      loadingKey: 'loading-key',
      promptBody: 'prompt leak',
      childAssembly: { raw: true },
    },
    ...overrides,
  };
}
