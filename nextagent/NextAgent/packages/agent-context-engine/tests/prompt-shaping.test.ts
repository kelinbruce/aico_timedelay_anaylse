import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { AgentError, brand } from '@nextagent/agent-common';
import { SYSTEM_PROMPT_CACHE_BOUNDARY_MARKER, type ContextAssembly } from '@nextagent/agent-contracts/context';
import type { CapabilityDescriptor } from '@nextagent/agent-contracts/capability';
import type { SessionMessage } from '@nextagent/agent-contracts/session';
import {
  MEMORY_EXTRACTION,
  SUMMARY_GENERATION,
  SYSTEM_PROMPT,
  DefaultPromptTemplateAssembler,
  DefaultPromptTemplateRegistry,
  DefaultModelInputRenderer,
  assertPromptPurpose,
  renderPromptTemplateWithVariables,
  systemPromptFromAssemblyResult,
  createDefaultPromptTemplateVariableResolver,
} from '@nextagent/agent-context-engine';
import { describe, expect, it, vi } from 'vitest';

describe('prompt template assembly', () => {
  it('keeps PromptPurpose as an open safe string with well-known constants', () => {
    expect(SYSTEM_PROMPT).toBe('SYSTEM_PROMPT');
    expect(SUMMARY_GENERATION).toBe('SUMMARY_GENERATION');
    expect(MEMORY_EXTRACTION).toBe('MEMORY_EXTRACTION');
    expect(assertPromptPurpose('CUSTOM_TELECOM_DIAGNOSIS')).toBe('CUSTOM_TELECOM_DIAGNOSIS');
    expect(() => assertPromptPurpose('../bad')).toThrow();
  });

  it('preserves migrated builtin system and summary prompt instructions', async () => {
    const assembler = new DefaultPromptTemplateAssembler();

    const system = await assembler.assemble(request(SYSTEM_PROMPT));
    expect(system.renderedContent).toContain('telecommunications network problem tasks');
    expect(system.renderedContent).toContain('# Text output');
    expect(system.renderedContent).toContain('# Session-specific guidance');
    expect(system.renderedContent).toContain('# Context management');
    expect(system.renderedContent).toContain('Workspace root: workspace/');
    expect(system.renderedContent).toContain('Reuse exact paths returned by earlier tool results');
    expect(system.renderedContent).toContain('Do not call Glob merely to confirm a known path');
    expect(system.renderedContent).toContain('Run an existing script or module with Bash');
    expect(system.renderedContent).toContain('Treat DEGRADED as partial or uncertain, not complete success');
    expect(system.renderedContent).toContain('Do not repeat an unchanged failed invocation');
    expect(system.renderedContent).toContain('ToolSearch discovers governed deferred Tools and Skills only');
    expect(system.renderedContent).toContain('When trusted context already contains the facts needed to answer, do not call a tool');
    expect(system.renderedContent).toContain('current objective or its earliest real blocker');
    expect(system.renderedContent).toContain('cheap, read-only, or available');
    expect(system.renderedContent).toContain('A concrete path such as `config.json` or `src/app.ts` is known');
    expect(system.renderedContent).toContain('Mentioning, comparing, explaining, or explicitly declining a tool is not a request to invoke it');
    expect(system.renderedContent).toContain('Generic labels such as document, configuration, or log do not identify a source');
    expect(system.renderedContent).toContain(
      'workspace files, governed knowledge indexes, prior-session memory, and the operating-system or CLI environment',
    );
    expect(system.renderedContent).toContain('answer availability-only questions from that catalog without invoking the capability or ToolSearch');
    expect(system.renderedContent).toContain('Use Glob as the first call only when the target path is unknown');
    expect(system.renderedContent).toContain('every call is necessary to complete the request');
    expect(system.renderedContent).toContain('answer independent questions');
    expect(system.renderedContent).toContain('does not prove facts outside those roots');
    expect(system.renderedContent).toContain('authoritative view of capability visibility for the current request scope');
    expect(system.renderedContent).toContain('Do not use file tools or ToolSearch to rediscover a listed Skill or Agent');
    expect(system.renderedContent).toContain(
      'Whenever you need the user to answer a question, you MUST use the `AskUserQuestion` tool. Never ask the user a question in plain assistant text.',
    );
    expect(system.renderedContent).toContain(
      'When you need to follow up with the user, clarify something, or obtain an ordinary confirmation, you MUST call `AskUserQuestion`. Never ask the question directly in assistant text.',
    );
    expect(system.renderedContent).toContain(
      'If `AskUserQuestion` is unavailable, proceed with a safe explicit assumption or provide a blocked explanation without asking a question.',
    );
    expect(system.renderedContent).toContain('protected-operation approval, high-risk confirmation');
    expect(system.renderedContent).not.toContain('current user-facing task cannot safely continue');
    expect(system.renderedContent).toContain('minimum inspection needed to determine their structure');
    expect(system.renderedContent).toContain('create a minimal valid version of every required artifact early');
    expect(system.renderedContent).toContain('bounded tool calls');
    expect(system.renderedContent).toContain('verify that every required artifact exists');
    expect(system.renderedContent).toContain('map every explicit rule relevant to the requested result');
    expect(system.renderedContent).toContain('check rule coverage, evidence support, and consistency across outputs');
    expect(system.renderedContent).toContain('recompute the key classifications, counts, and references from source evidence');
    expect(system.renderedContent).toContain('reconcile every discrepancy before claiming completion');
    expect(system.renderedContent).toContain('File existence, parseability, or format validation alone does not prove semantic correctness');
    expect(system.renderedContent).toContain('state the verifiable limitation instead of inventing unsupported facts');
    expect(system.renderedContent).not.toMatch(/\b\d{3}-(?:[a-z0-9]+-)+[a-z0-9]+\b/iu);
    expect(system.renderedContent).not.toMatch(/\b(?:oracle|rubric|grader feedback|fixed answer)\b/iu);

    const summary = await assembler.assemble(request(SUMMARY_GENERATION));
    expect(summary.renderedContent).toContain('telecom network agent runtime');
    expect(summary.renderedContent).toContain('OUTPUT FORMAT');
    expect(summary.renderedContent).toContain('<analysis>');
    expect(summary.renderedContent).toContain('<summary>');
    expect(summary.renderedContent).toContain('<checklist>');
    expect(summary.renderedContent).toContain('fact name="user_intent"');
  });

  it('renders the skill disclosure section when the governed skill list is non-empty', async () => {
    const assembler = new DefaultPromptTemplateAssembler();
    const skill: CapabilityDescriptor = {
      capabilityId: brand<string, 'CapabilityId'>('telecom-diagnosis'),
      kind: 'SKILL',
      provider: { providerId: 'builtin-skills', providerKind: 'BUNDLED' },
      displayName: 'Telecom diagnosis',
      description: 'Diagnose telecom network faults.',
      availabilityStatus: 'AVAILABLE',
      modelInvocable: true,
    };

    const result = await assembler.assemble({
      ...request(SYSTEM_PROMPT),
      skillDisclosure: skillDisclosureProjectionForTest('list', [skill]),
    });

    expect(result.renderedContent).toContain('### Available skills');
    expect(result.renderedContent).toContain('- telecom-diagnosis: Diagnose telecom network faults.');
    expect(result.renderedContent).toContain('### How to use skills');
    expect(result.renderedContent).toContain('call the `Skill` tool immediately in the same assistant turn');
    // The disclosure renders inside the dynamic block, after the cache boundary.
    expect(result.renderedContent.indexOf(SYSTEM_PROMPT_CACHE_BOUNDARY_MARKER)).toBeLessThan(result.renderedContent.indexOf('### Available skills'));
  });

  it('omits the skill disclosure section when the governed skill list is empty', async () => {
    const assembler = new DefaultPromptTemplateAssembler();

    const omitted = await assembler.assemble(request(SYSTEM_PROMPT));
    expect(omitted.renderedContent).not.toContain('### Available skills');
    expect(omitted.renderedContent).not.toContain('### How to use skills');

    const emptyList = await assembler.assemble({ ...request(SYSTEM_PROMPT), skillDisclosure: skillDisclosureProjectionForTest('list', []) });
    expect(emptyList.renderedContent).not.toContain('### Available skills');
  });

  it('renders the tool-search disclosure body only in tool-search mode', async () => {
    const assembler = new DefaultPromptTemplateAssembler();
    const skill: CapabilityDescriptor = {
      capabilityId: brand<string, 'CapabilityId'>('telecom-diagnosis'),
      kind: 'SKILL',
      provider: { providerId: 'builtin-skills', providerKind: 'BUNDLED' },
      displayName: 'Telecom diagnosis',
      description: 'Diagnose telecom network faults.',
      availabilityStatus: 'AVAILABLE',
      modelInvocable: true,
    };

    const listMode = await assembler.assemble({ ...request(SYSTEM_PROMPT), skillDisclosure: skillDisclosureProjectionForTest('list', [skill]) });
    expect(listMode.renderedContent).toContain('Use the `Skill` tool only when the user request clearly matches');
    expect(listMode.renderedContent).not.toContain('Enabled Skills listed above may be called directly');

    const toolSearchMode = await assembler.assemble({
      ...request(SYSTEM_PROMPT),
      skillDisclosure: skillDisclosureProjectionForTest('tool-search', [skill]),
    });
    expect(toolSearchMode.renderedContent).toContain('Enabled Skills listed above may be called directly');
    expect(toolSearchMode.renderedContent).toContain('Use `ToolSearch` to find deferred Skills that are not listed above');
    expect(toolSearchMode.renderedContent).not.toContain('Use the `Skill` tool only when the user request clearly matches');
  });

  it('lets an agent template override the skill disclosure section while remaining gated', async () => {
    await withPromptRoots(async ({ builtinRoot, agentRoot }) => {
      await writeBuiltinSystemTemplate(builtinRoot, 'Builtin system');
      await writeTemplate(
        agentRoot,
        'SYSTEM_PROMPT/template.yaml',
        [
          'content:',
          '  - id: identity',
          '    inline: Agent identity',
          '  - id: skill_disclosure',
          '    inline: Agent skill rules for {{ skillDisclosureMode }} mode. {{ skillDisclosureList }}',
        ].join('\n'),
      );
      const registry = new DefaultPromptTemplateRegistry(builtinRoot);
      registry.register({ agentId: 'agent-a', agentVersion: 'v1', path: agentRoot });
      const assembler = new DefaultPromptTemplateAssembler(registry);
      const skill: CapabilityDescriptor = {
        capabilityId: brand<string, 'CapabilityId'>('telecom-diagnosis'),
        kind: 'SKILL',
        provider: { providerId: 'builtin-skills', providerKind: 'BUNDLED' },
        displayName: 'Telecom diagnosis',
        description: 'Diagnose telecom network faults.',
        availabilityStatus: 'AVAILABLE',
        modelInvocable: true,
      };

      // Agent override wins and builtin default body no longer renders.
      const overridden = await assembler.assemble({
        ...request(SYSTEM_PROMPT),
        skillDisclosure: skillDisclosureProjectionForTest('list', [skill]),
      });
      expect(overridden.renderedContent).toContain('Agent skill rules for list mode.');
      expect(overridden.renderedContent).toContain('- telecom-diagnosis: Diagnose telecom network faults.');
      expect(overridden.renderedContent).not.toContain('### How to use skills');

      // The render filter still omits the overridden section when the list is empty.
      const gated = await assembler.assemble({
        ...request(SYSTEM_PROMPT),
        skillDisclosure: skillDisclosureProjectionForTest('list', []),
      });
      expect(gated.renderedContent).not.toContain('Agent skill rules');
      expect(gated.renderedContent).not.toContain('telecom-diagnosis');
    });
  });

  it.each([
    ['Asia/Shanghai', '2026-08-09T18:00:00.000Z', '2026-08-10'],
    ['America/New_York', '2026-08-10T01:00:00.000Z', '2026-08-09'],
    ['UTC', '2026-08-10T01:00:00.000Z', '2026-08-10'],
  ] as const)('renders timezone and currentDate from the same %s calendar', async (timezone, now, expectedDate) => {
    const previousTimezone = process.env.TZ;
    process.env.TZ = timezone;
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date(now));
      await withPromptRoots(async ({ builtinRoot }) => {
        await writeTemplate(
          builtinRoot,
          'SYSTEM_PROMPT/template.yaml',
          ['content:', '  - id: identity', `    inline: '{{ timezone }}|{{ currentDate }}'`].join('\n'),
        );
        const assembler = new DefaultPromptTemplateAssembler(new DefaultPromptTemplateRegistry(builtinRoot));

        const result = await assembler.assemble(request(SYSTEM_PROMPT));

        expect(result.renderedContent).toBe(`${timezone}|${expectedDate}`);
      });
    } finally {
      vi.useRealTimers();
      if (previousTimezone === undefined) {
        delete process.env.TZ;
      } else {
        process.env.TZ = previousTimezone;
      }
    }
  });

  it('renders the memory guidance section when memoryEnabled is true, ordered after tooling', async () => {
    const assembler = new DefaultPromptTemplateAssembler();
    const result = await assembler.assemble({ ...request(SYSTEM_PROMPT), memoryEnabled: true });

    expect(result.renderedContent).toContain('# Long-term memory');
    expect(result.renderedContent).toContain('search_memory');
    const toolingIdx = result.renderedContent.indexOf('# Using your tools');
    const memoryIdx = result.renderedContent.indexOf('# Long-term memory');
    const actionIdx = result.renderedContent.indexOf('# Executing actions with care');
    expect(toolingIdx).toBeGreaterThan(-1);
    expect(memoryIdx).toBeGreaterThan(toolingIdx);
    expect(actionIdx).toBeGreaterThan(memoryIdx);
  });

  it('omits the memory guidance section when memoryEnabled is false or not provided', async () => {
    const assembler = new DefaultPromptTemplateAssembler();

    const omitted = await assembler.assemble(request(SYSTEM_PROMPT));
    expect(omitted.renderedContent).not.toContain('# Long-term memory');

    const disabled = await assembler.assemble({ ...request(SYSTEM_PROMPT), memoryEnabled: false });
    expect(disabled.renderedContent).not.toContain('# Long-term memory');
  });

  it('keeps the memory guidance free of preloaded entries, file paths, and non-exposed tools', async () => {
    const assembler = new DefaultPromptTemplateAssembler();
    const result = await assembler.assemble({ ...request(SYSTEM_PROMPT), memoryEnabled: true });
    const memoryBlock = result.renderedContent.slice(
      result.renderedContent.indexOf('# Long-term memory'),
      result.renderedContent.indexOf('# Executing actions with care'),
    );

    expect(memoryBlock).not.toContain('update_memory');
    expect(memoryBlock).not.toContain('forget_memory');
    expect(memoryBlock).not.toContain('MEMORY.md');
    // The memory section must not preload retrieved memory entry id values.
    // The field name `longTermMemoryIds` MAY appear as a minimal call hint (max 20),
    // but no concrete retrieved entry id may be injected.
    expect(memoryBlock).not.toContain('ltm-');
    expect(memoryBlock).not.toMatch(/longTermMemoryId:\s*['"]/);
    // The memoryEnabled flag is a render signal, not prompt text.
    expect(result.renderedContent).not.toContain('memoryEnabled');
    // memoryEnabled does not change template selection.
    const withoutFlag = await assembler.assemble(request(SYSTEM_PROMPT));
    expect(result.templateId).toBe(withoutFlag.templateId);
  });

  it('compiles builtin and agent buckets without copying builtin facts into agent scope', async () => {
    await withPromptRoots(async ({ builtinRoot, agentRoot }) => {
      await writeBuiltinSystemTemplate(builtinRoot, 'Builtin system');
      await writeTemplate(agentRoot, 'SYSTEM_PROMPT/template.yaml', ['content:', '  - id: identity', '    inline: Agent system'].join('\n'));
      const registry = new DefaultPromptTemplateRegistry(builtinRoot);
      const builtin = registry.templatesFor('agent-a', 'v1').find((template) => template.sourceLayer === 'builtin');
      registry.register({ agentId: 'agent-a', agentVersion: 'v1', path: agentRoot });
      const templates = registry.templatesFor('agent-a', 'v1');
      const agent = templates.find((template) => template.sourceLayer === 'agent');

      expect(builtin?.templateRef).toMatch(/^builtin:SYSTEM_PROMPT:/u);
      expect(builtin?.templateRef).not.toContain('agent-a');
      expect(agent?.templateRef).toMatch(/^agent:agent-a:v1:SYSTEM_PROMPT:/u);
      expect(templates.filter((template) => template.sourceLayer === 'builtin')).toHaveLength(1);
      expect(registry.templatesFor('agent-b', 'v1').some((template) => template.sourceLayer === 'agent')).toBe(false);
    });
  });

  it('registers supported YAML authoring forms and rejects unsupported manifest authority', async () => {
    await withPromptRoots(async ({ builtinRoot, agentRoot }) => {
      await writeBuiltinSystemTemplate(builtinRoot, 'Builtin system');
      await writeTemplate(
        agentRoot,
        'summary-zh/template.yaml',
        ['purpose: SUMMARY_GENERATION', 'content:', '  - role.md', '  - id: rules', '    inline: Keep telecom diagnosis constraints.'].join('\n'),
      );
      await writeTemplate(agentRoot, 'summary-zh/role.md', 'Summarize the telecom network task.');
      await writeTemplate(agentRoot, 'freeform.md', 'This raw markdown must not register.');
      const registry = new DefaultPromptTemplateRegistry(builtinRoot);

      registry.register({ agentId: 'agent-a', agentVersion: 'v1', path: agentRoot });
      const template = registry.templatesFor('agent-a', 'v1').find((item) => item.templateId === 'summary-zh');

      expect(template?.purpose).toBe(SUMMARY_GENERATION);
      expect(template?.sections.map((section) => section.id)).toEqual(['role', 'rules']);
      expect(registry.templatesFor('agent-a', 'v1').some((item) => item.templateId === 'freeform')).toBe(false);
    });
  });

  it('fails closed for invalid manifests without leaking filesystem paths or prompt body', async () => {
    await withPromptRoots(async ({ builtinRoot, agentRoot }) => {
      await writeBuiltinSystemTemplate(builtinRoot, 'Builtin system');
      await writeTemplate(agentRoot, 'custom/template.yaml', 'content: secret prompt body');
      const registry = new DefaultPromptTemplateRegistry(builtinRoot);

      expect(() => registry.register({ agentId: 'agent-a', agentVersion: 'v1', path: agentRoot })).toThrowError(AgentError);
      try {
        registry.register({ agentId: 'agent-a', agentVersion: 'v1', path: agentRoot });
      } catch (error) {
        expect(String((error as Error).message)).not.toContain(agentRoot);
        expect(String((error as Error).message)).not.toContain('secret prompt body');
        expect((error as AgentError).safeDetails).toMatchObject({ templateId: 'custom' });
      }
    });
  });

  it('rejects untrusted agent prompt roots before compilation', async () => {
    await withPromptRoots(async ({ builtinRoot }) => {
      await writeBuiltinSystemTemplate(builtinRoot, 'Builtin system');
      const registry = new DefaultPromptTemplateRegistry(builtinRoot);

      expect(() => registry.register({ agentId: 'agent-a', agentVersion: 'v1', path: 'relative-prompts' })).toThrowError(AgentError);
      expect(() => registry.register({ agentId: 'agent-a', agentVersion: '../v1', path: builtinRoot })).toThrowError(AgentError);
    });
  });

  it('rejects system string content, identity fields, optional flags and invalid system sections', async () => {
    await withPromptRoots(async ({ builtinRoot, agentRoot }) => {
      await writeBuiltinSystemTemplate(builtinRoot, 'Builtin system');
      const invalidManifests = [
        ['SYSTEM_PROMPT/template.yaml', 'content: invalid system string', 'PROMPT_SYSTEM_CONTENT_ARRAY_REQUIRED'],
        ['SUMMARY_GENERATION.yaml', 'templateRef: user-ref\ncontent: ok', 'PROMPT_MANIFEST_FIELD_UNSUPPORTED'],
        ['SUMMARY_GENERATION/template.yaml', 'content:\n  - id: main\n    inline: ok\n    optional: true', 'PROMPT_SECTION_FIELD_UNSUPPORTED'],
        ['bad-system/template.yaml', 'purpose: SYSTEM_PROMPT\ncontent:\n  - id: not_owned\n    inline: ok', 'PROMPT_SYSTEM_SECTION_UNSUPPORTED'],
        ['bad-system/template.yaml', 'purpose: SYSTEM_PROMPT\ncontent:\n  - id: cache_boundary\n    inline: ok', 'PROMPT_SYSTEM_SECTION_SEALED'],
      ] as const;
      for (const [file, content, code] of invalidManifests) {
        await rm(agentRoot, { recursive: true, force: true });
        await writeTemplate(agentRoot, file, content);
        const registry = new DefaultPromptTemplateRegistry(builtinRoot);
        expect(() => registry.register({ agentId: 'agent-a', agentVersion: 'v1', path: agentRoot })).toThrowError(AgentError);
        try {
          registry.register({ agentId: 'agent-a', agentVersion: 'v1', path: agentRoot });
        } catch (error) {
          expect((error as AgentError).code).toBe(code);
        }
      }
    });
  });

  it('renders system sections through system policy order with a policy-owned cache boundary', async () => {
    await withPromptRoots(async ({ builtinRoot }) => {
      await writeTemplate(
        builtinRoot,
        'SYSTEM_PROMPT/template.yaml',
        ['content:', '  - id: runtime', '    inline: Runtime {{ runtime? }}', '  - id: identity', '    inline: Identity'].join('\n'),
      );
      const assembler = new DefaultPromptTemplateAssembler(new DefaultPromptTemplateRegistry(builtinRoot));
      const assemblyResult = await assembler.assemble(request(SYSTEM_PROMPT));
      const renderer = new DefaultModelInputRenderer();

      const assembly: ContextAssembly = {
        request: {
          sessionId: brand<string, 'SessionId'>('session-1'),
          requestId: brand<string, 'MessageId'>('request-1'),
          requestContextId: brand<string, 'RequestContextId'>('ctx-1'),
          identityContext: {
            tenantId: brand<string, 'TenantId'>('tenant-1'),
            subjectId: brand<string, 'SubjectId'>('subject-1'),
            displayName: 'Test User',
          },
          agentId: brand<string, 'AgentId'>('agent-a'),
          agentVersion: brand<string, 'AgentVersion'>('v1'),
          runId: brand<string, 'RequestRunId'>('run-1'),
          stepId: 'step-1',
          locale: brand<string, 'RequestLocale'>('zh-CN'),
          purpose: SYSTEM_PROMPT,
          flowVariables: {},
        },
        systemPrompt: systemPromptFromAssemblyResult(assemblyResult),
        selectedMessageRefs: [],
        visibleCapabilities: [],
        modelConfiguration: {
          modelId: 'fast-model',
          contextWindowTokens: 128_000,
          temperature: 0.55,
          maxOutputTokens: 32_000,
          topP: 1,
          toolChoice: 'AUTO' as const,
          defaultTimeoutMs: 30_000,
          defaultMaxRetries: 2,
        },
        modelOptions: {},
        modelSelectionReason: 'test',
      };

      const rendered = await renderer.render({
        assembly,
        selectedMessages: [],
        providerOptions: {},
      });

      const systemText = rendered.messages[0]!.content[0]!.type === 'text' ? rendered.messages[0]!.content[0]!.text : '';
      expect(systemText).toContain(`Identity\n\n${SYSTEM_PROMPT_CACHE_BOUNDARY_MARKER}\n\nRuntime`);
      expect(systemText.indexOf('Identity')).toBeLessThan(systemText.indexOf('Runtime'));
    });
  });

  it('keeps hidden Skill context after its matching tool result batch across later tool rounds', async () => {
    const renderer = new DefaultModelInputRenderer();
    const skillContent = '<skill_content name="telecom-domain-qa">Use telecom evidence.</skill_content>';
    const assembly = modelInputAssembly(skillContent);
    const userMessage = sessionMessage(1, 'USER', 'Diagnose the alarm.');
    const skillResultMessage = sessionMessage(
      3,
      'CAPABILITY_RESULT',
      JSON.stringify({
        toolCallId: 'skill-call',
        toolName: 'Skill',
        payload: { name: 'telecom-domain-qa', status: 'loaded' },
      }),
    );
    const readResultMessage = sessionMessage(
      5,
      'CAPABILITY_RESULT',
      JSON.stringify({
        toolCallId: 'read-call',
        toolName: 'Read',
        payload: { content: 'alarm evidence' },
      }),
    );
    const selectedMessages = [
      userMessage,
      sessionMessage(
        2,
        'ASSISTANT',
        JSON.stringify({
          toolCalls: [{ toolCallId: 'skill-call', toolName: 'Skill', arguments: { name: 'telecom-domain-qa' } }],
        }),
      ),
      skillResultMessage,
      sessionMessage(
        4,
        'ASSISTANT',
        JSON.stringify({
          toolCalls: [{ toolCallId: 'read-call', toolName: 'Read', arguments: { file_path: 'alarm.txt' } }],
        }),
      ),
      readResultMessage,
    ];

    const rendered = await renderer.render({ assembly, selectedMessages, providerOptions: {} });

    expect(rendered.messages.map((message) => message.role)).toEqual(['SYSTEM', 'USER', 'ASSISTANT', 'TOOL', 'USER', 'ASSISTANT', 'TOOL']);
    expect(rendered.messages[4]?.content).toEqual([{ type: 'text', text: skillContent }]);

    const withoutAnchor = await renderer.render({
      assembly,
      selectedMessages: [userMessage],
      providerOptions: {},
    });
    expect(withoutAnchor.messages.at(-1)?.content).toEqual([{ type: 'text', text: skillContent }]);

    const parallelBatch = await renderer.render({
      assembly,
      selectedMessages: [
        userMessage,
        sessionMessage(
          2,
          'ASSISTANT',
          JSON.stringify({
            toolCalls: [
              { toolCallId: 'skill-call', toolName: 'Skill', arguments: { name: 'telecom-domain-qa' } },
              { toolCallId: 'read-call', toolName: 'Read', arguments: { file_path: 'alarm.txt' } },
            ],
          }),
        ),
        skillResultMessage,
        readResultMessage,
      ],
      providerOptions: {},
    });
    expect(parallelBatch.messages.map((message) => message.role)).toEqual(['SYSTEM', 'USER', 'ASSISTANT', 'TOOL', 'TOOL', 'USER']);
    expect(parallelBatch.messages.at(-1)?.content).toEqual([{ type: 'text', text: skillContent }]);
  });

  it('keeps a persisted directed-Skill body in place and out of the last position across a later tool round', async () => {
    // Directed-skill path: the runtime persists the <skill_content> body as a
    // fixed USER(SKILL_CONTENT) message right after the Skill tool-result pair,
    // and does NOT pass it through capabilityGeneratedMessages. The renderer
    // must carry that persisted USER message in its sequence position and must
    // NOT reconstruct/duplicate it from the Skill tool-result body — otherwise
    // the body drifts to the end (last message) every round.
    const renderer = new DefaultModelInputRenderer();
    const skillContent = '<skill_content name="telecom-domain-qa">Use telecom evidence.</skill_content>';
    const assemblyWithoutGenerated: ContextAssembly = {
      ...modelInputAssembly(skillContent),
      request: { ...modelInputAssembly(skillContent).request, capabilityGeneratedMessages: [] },
    };
    const skillBodyMessage = sessionMessage(6, 'USER', skillContent);
    const skillResultWithBody = sessionMessage(
      3,
      'CAPABILITY_RESULT',
      JSON.stringify({
        toolCallId: 'skill-call',
        toolName: 'Skill',
        payload: { name: 'telecom-domain-qa', status: 'loaded', body: skillContent },
      }),
    );
    const selectedMessages = [
      sessionMessage(1, 'USER', 'Diagnose the alarm.'),
      sessionMessage(
        2,
        'ASSISTANT',
        JSON.stringify({
          toolCalls: [{ toolCallId: 'skill-call', toolName: 'Skill', arguments: { name: 'telecom-domain-qa' } }],
        }),
      ),
      skillResultWithBody,
      skillBodyMessage,
      sessionMessage(
        4,
        'ASSISTANT',
        JSON.stringify({
          toolCalls: [{ toolCallId: 'read-call', toolName: 'Read', arguments: { file_path: 'alarm.txt' } }],
        }),
      ),
      sessionMessage(5, 'CAPABILITY_RESULT', JSON.stringify({ toolCallId: 'read-call', toolName: 'Read', payload: { content: 'alarm evidence' } })),
    ];

    const rendered = await renderer.render({ assembly: assemblyWithoutGenerated, selectedMessages, providerOptions: {} });

    // The persisted skill body stays at its sequence position (right after the
    // Skill tool-result), and a later Bash/Read round follows it — so the body
    // is NOT the last message.
    expect(rendered.messages.map((message) => message.role)).toEqual(['SYSTEM', 'USER', 'ASSISTANT', 'TOOL', 'USER', 'ASSISTANT', 'TOOL']);
    expect(rendered.messages[4]?.content).toEqual([{ type: 'text', text: skillContent }]);
    expect(rendered.messages.at(-1)?.role).toBe('TOOL');
    // No duplicate reconstruction: the body text appears exactly once.
    expect(rendered.messages.filter((message) => message.content.some((part) => part.type === 'text' && part.text === skillContent))).toHaveLength(1);
  });

  it('renders CLIP response schema hints into model-visible tool descriptions', async () => {
    const renderer = new DefaultModelInputRenderer();
    const clipTool: CapabilityDescriptor = {
      capabilityId: brand<string, 'CapabilityId'>('clipc.subscribe.getHelloStream'),
      kind: 'TOOL',
      provider: { providerId: 'clipc', providerKind: 'CUSTOM' },
      displayName: 'getHelloStream',
      description: 'Subscribe to the hello stream.',
      availabilityStatus: 'AVAILABLE',
      inputSchema: { type: 'object', properties: {} },
      metadata: {
        clip: {
          streamEventSchema: {
            type: 'object',
            description: 'SSE event containing a character from the streaming greeting',
            properties: {
              event: {
                type: 'string',
                description: 'SSE event name, typically char for character events',
              },
              data: {
                type: 'object',
                description: 'Event payload',
                properties: {
                  char: {
                    type: 'string',
                    description: 'A single character from the greeting message',
                  },
                  timestamp: {
                    type: 'string',
                    format: 'date-time',
                    description: 'Time when the character was emitted',
                  },
                  index: {
                    type: 'integer',
                    description: 'Zero-based character index',
                  },
                },
              },
            },
          },
        },
      },
    };
    const assembly: ContextAssembly = {
      request: {
        sessionId: brand<string, 'SessionId'>('session-1'),
        requestId: brand<string, 'MessageId'>('request-1'),
        requestContextId: brand<string, 'RequestContextId'>('ctx-1'),
        identityContext: {
          tenantId: brand<string, 'TenantId'>('tenant-1'),
          subjectId: brand<string, 'SubjectId'>('subject-1'),
          displayName: 'Test User',
        },
        agentId: brand<string, 'AgentId'>('agent-a'),
        agentVersion: brand<string, 'AgentVersion'>('v1'),
        runId: brand<string, 'RequestRunId'>('run-1'),
        stepId: 'step-1',
        locale: brand<string, 'RequestLocale'>('zh-CN'),
        purpose: SYSTEM_PROMPT,
        flowVariables: {},
      },
      systemPrompt: { sections: [] },
      selectedMessageRefs: [],
      visibleCapabilities: [clipTool],
      modelConfiguration: {
        modelId: 'fast-model',
        contextWindowTokens: 128_000,
        temperature: 0.55,
        maxOutputTokens: 32_000,
        topP: 1,
        toolChoice: 'AUTO' as const,
        defaultTimeoutMs: 30_000,
        defaultMaxRetries: 2,
      },
      modelOptions: {},
      modelSelectionReason: 'test',
    };

    const rendered = await renderer.render({ assembly, selectedMessages: [], providerOptions: {} });

    expect(rendered.tools[0]?.description).toContain('CLIP response schema');
    expect(rendered.tools[0]?.description).toContain('event: string');
    expect(rendered.tools[0]?.description).toContain('data.char: string - A single character from the greeting message');
    expect(rendered.tools[0]?.description).toContain('data.timestamp: string/date-time');
    expect(rendered.tools[0]?.description).toContain('data.index: integer');
  });

  it('selects one complete template with agent source priority and same-layer specificity', async () => {
    await withPromptRoots(async ({ builtinRoot, agentRoot }) => {
      await writeTemplate(builtinRoot, 'SUMMARY_GENERATION/template.yaml', ['match:', '  locale: en-US', 'content: Builtin matched'].join('\n'));
      await writeTemplate(agentRoot, 'summary-default/template.yaml', ['purpose: SUMMARY_GENERATION', 'content: Agent default'].join('\n'));
      const registry = new DefaultPromptTemplateRegistry(builtinRoot);
      registry.register({ agentId: 'agent-a', agentVersion: 'v1', path: agentRoot });
      const assembler = new DefaultPromptTemplateAssembler(registry);

      const result = await assembler.assemble(request(SUMMARY_GENERATION, { locale: 'en-US' }));

      expect(result.templateId).toBe('summary-default');
      expect(result.renderedContent).toBe('Agent default');
    });
  });

  it('fails safely on equal highest-specificity conflicts in the same source layer', async () => {
    await withPromptRoots(async ({ builtinRoot, agentRoot }) => {
      await writeBuiltinSystemTemplate(builtinRoot, 'Builtin system');
      await writeTemplate(agentRoot, 'summary-a/template.yaml', 'purpose: SUMMARY_GENERATION\ncontent: A');
      await writeTemplate(agentRoot, 'summary-b/template.yaml', 'purpose: SUMMARY_GENERATION\ncontent: B');
      const registry = new DefaultPromptTemplateRegistry(builtinRoot);
      registry.register({ agentId: 'agent-a', agentVersion: 'v1', path: agentRoot });
      const assembler = new DefaultPromptTemplateAssembler(registry);

      await expect(assembler.assemble(request(SUMMARY_GENERATION))).rejects.toMatchObject({
        code: 'PROMPT_TEMPLATE_AMBIGUOUS_RESOLUTION',
      });
    });
  });

  it('computes compatible model ids only from matched agent model templates', async () => {
    await withPromptRoots(async ({ builtinRoot, agentRoot }) => {
      await writeTemplate(builtinRoot, 'SUMMARY_GENERATION/template.yaml', ['content: Builtin'].join('\n'));
      await writeTemplate(
        agentRoot,
        'summary-fast/template.yaml',
        ['purpose: SUMMARY_GENERATION', 'match:', '  locale: zh-CN', '  model: fast-model', 'content: Fast'].join('\n'),
      );
      const registry = new DefaultPromptTemplateRegistry(builtinRoot);
      registry.register({ agentId: 'agent-a', agentVersion: 'v1', path: agentRoot });

      expect(
        registry.compatibleModelIds({
          purpose: SUMMARY_GENERATION,
          agentId: 'agent-a',
          agentVersion: 'v1',
          locale: 'zh-CN',
          flowVariables: {},
          modelCandidates: [
            { modelId: 'slow-model', order: 0 },
            { modelId: 'fast-model', order: 1 },
          ],
        }),
      ).toEqual(['fast-model']);
      expect(
        registry.compatibleModelIds({
          purpose: SUMMARY_GENERATION,
          agentId: 'agent-a',
          agentVersion: 'v1',
          locale: 'en-US',
          flowVariables: {},
          modelCandidates: [{ modelId: 'fast-model', order: 0 }],
        }),
      ).toEqual([]);
    });
  });

  it('keeps the skill disclosure projection out of template selection and prompt text', async () => {
    const assembler = new DefaultPromptTemplateAssembler();
    const skill: CapabilityDescriptor = {
      capabilityId: brand<string, 'CapabilityId'>('telecom-diagnosis'),
      kind: 'SKILL',
      provider: { providerId: 'builtin-skills', providerKind: 'BUNDLED' },
      displayName: 'Telecom diagnosis',
      description: 'Diagnose telecom network faults.',
      availabilityStatus: 'AVAILABLE',
      modelInvocable: true,
    };

    const baseline = await assembler.assemble(request(SYSTEM_PROMPT));
    const listMode = await assembler.assemble({ ...request(SYSTEM_PROMPT), skillDisclosure: skillDisclosureProjectionForTest('list', [skill]) });
    const toolSearchMode = await assembler.assemble({
      ...request(SYSTEM_PROMPT),
      skillDisclosure: skillDisclosureProjectionForTest('tool-search', [skill]),
    });

    // The projection does not participate in template selection.
    expect(listMode.templateId).toBe(baseline.templateId);
    expect(toolSearchMode.templateId).toBe(baseline.templateId);
    // The raw mode value is not inlined into the prompt text.
    expect(listMode.renderedContent).not.toMatch(/skillDisclosureMode|mode=list/u);
    expect(toolSearchMode.renderedContent).not.toMatch(/skillDisclosureMode|mode=tool-search/u);
  });

  it('renders required and optional variables while rejecting unknown syntax', () => {
    const ctx = {
      sessionId: 'session',
      agentId: 'agent-a',
      agentVersion: 'v1',
      selectedModel: { modelId: 'model-a' },
      environmentInfo: { platform: 'win32', osVersion: 'test', timezone: 'Asia/Shanghai', currentDate: '2026-06-17' },
      locale: 'zh-CN',
      flowVariables: { networkEnvironment: 'lab', operationLevel: 'STANDARD' },
      workspaceDir: 'workspace/',
    };
    const resolver = createDefaultPromptTemplateVariableResolver();

    expect(renderPromptTemplateWithVariables('Agent {{ agentId }} {{ locale? }}', ctx, resolver).rendered).toBe('Agent agent-a zh-CN');
    expect(() => renderPromptTemplateWithVariables('{{ missing }}', ctx, resolver)).toThrowError(AgentError);
    expect(() => renderPromptTemplateWithVariables('{{ agentId | upper }}', ctx, resolver)).toThrowError(AgentError);
    // enabledSkills was removed with the enabledCapabilities projection; references fail closed.
    expect(() => renderPromptTemplateWithVariables('{{ enabledSkills? }}', ctx, resolver)).toThrowError(AgentError);
  });

  it('renders summary and memory through generic ordered sections', async () => {
    await withPromptRoots(async ({ builtinRoot }) => {
      await writeTemplate(
        builtinRoot,
        'SUMMARY_GENERATION/template.yaml',
        ['content:', '  - id: first', '    inline: First {{ selectedModelId }}', '  - id: second', '    inline: Second {{ locale? }}'].join('\n'),
      );
      await writeTemplate(builtinRoot, 'MEMORY_EXTRACTION/template.yaml', 'content: Memory prompt {{ selectedModelId }}');
      const assembler = new DefaultPromptTemplateAssembler(new DefaultPromptTemplateRegistry(builtinRoot));

      await expect(assembler.assemble(request(SUMMARY_GENERATION))).resolves.toMatchObject({
        renderedContent: 'First fast-model\n\nSecond zh-CN',
      });
      await expect(assembler.assemble(request(MEMORY_EXTRACTION))).resolves.toMatchObject({
        renderedContent: 'Memory prompt fast-model',
      });
    });
  });
});

function skillDisclosureProjectionForTest(
  mode: 'list' | 'tool-search',
  skills: readonly CapabilityDescriptor[],
): {
  readonly mode: 'list' | 'tool-search';
  readonly skills: readonly CapabilityDescriptor[];
  readonly body: string;
} {
  const body = readFileSync(
    join(repoRoot(), 'packages', 'agent-context-engine', 'prompt-templates', 'builtin', 'SYSTEM_PROMPT', `skill-disclosure-${mode}.md`),
    'utf8',
  ).trimEnd();
  return { mode, skills, body };
}

function repoRoot(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
}

function request(purpose: string, overrides: { readonly locale?: string } = {}) {
  return {
    purpose,
    agentId: brand<string, 'AgentId'>('agent-a'),
    agentVersion: brand<string, 'AgentVersion'>('v1'),
    locale: brand<string, 'RequestLocale'>(overrides.locale ?? 'zh-CN'),
    flowVariables: {},
    selectedModel: { modelId: 'fast-model' },
  };
}

function modelInputAssembly(skillContent: string): ContextAssembly {
  return {
    request: {
      sessionId: brand<string, 'SessionId'>('session-1'),
      requestId: brand<string, 'MessageId'>('request-1'),
      requestContextId: brand<string, 'RequestContextId'>('ctx-1'),
      identityContext: {
        tenantId: brand<string, 'TenantId'>('tenant-1'),
        subjectId: brand<string, 'SubjectId'>('subject-1'),
        displayName: 'Test User',
      },
      agentId: brand<string, 'AgentId'>('agent-a'),
      agentVersion: brand<string, 'AgentVersion'>('v1'),
      runId: brand<string, 'RequestRunId'>('run-1'),
      stepId: 'step-1',
      locale: brand<string, 'RequestLocale'>('zh-CN'),
      purpose: SYSTEM_PROMPT,
      capabilityGeneratedMessages: [{ role: 'USER', meta: true, content: skillContent }],
    },
    systemPrompt: { sections: [] },
    selectedMessageRefs: [],
    visibleCapabilities: [],
    modelConfiguration: {
      modelId: 'fast-model',
      contextWindowTokens: 128_000,
      temperature: 0,
      maxOutputTokens: 4096,
      topP: 1,
      toolChoice: 'AUTO' as const,
      defaultTimeoutMs: 30_000,
      defaultMaxRetries: 0,
    },
    modelOptions: {},
    modelSelectionReason: 'test',
  };
}

function sessionMessage(sequence: number, role: SessionMessage['role'], content: string): SessionMessage {
  return {
    messageId: brand<string, 'MessageId'>(`message-${sequence}`),
    sessionId: brand<string, 'SessionId'>('session-1'),
    requestId: brand<string, 'MessageId'>('request-1'),
    runId: brand<string, 'RequestRunId'>('run-1'),
    role,
    content,
    contentType: 'PLAIN_TEXT',
    metadata: {},
    sequence,
    visible: true,
    createdAt: brand<number, 'EpochMillis'>(sequence),
  };
}

async function withPromptRoots(test: (roots: { readonly builtinRoot: string; readonly agentRoot: string }) => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), 'nextagent-prompts-'));
  const builtinRoot = join(root, 'builtin');
  const agentRoot = join(root, 'agent');
  try {
    await test({ builtinRoot, agentRoot });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function writeBuiltinSystemTemplate(root: string, content: string): Promise<void> {
  await writeTemplate(root, 'SYSTEM_PROMPT/template.yaml', ['content:', '  - id: identity', `    inline: ${content}`].join('\n'));
}

async function writeTemplate(root: string, relativePath: string, content: string): Promise<void> {
  const path = join(root, relativePath);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content, 'utf8');
}
