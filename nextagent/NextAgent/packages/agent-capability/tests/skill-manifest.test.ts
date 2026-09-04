import { mapSkillFrontmatterToDescriptor, parseSkillFrontmatter, readToolDefinition, readSkillMetadata } from '@nextagent/agent-capability';
import { SkillManifestDiagnosticSchema, SkillMetadataSchema, type SkillMetadata } from '@nextagent/agent-contracts/capability';
import { Ajv } from 'ajv/dist/ajv.js';
import { describe, expect, expectTypeOf, it } from 'vitest';

const provider = { providerId: 'local-source', providerKind: 'LOCAL_DIRECTORY' as const, providerType: 'skill-directory' };

describe('skill manifest contract', () => {
  it('accepts official SKILL.md frontmatter and maps it to a Skill descriptor with typed metadata', () => {
    const parsed = parseSkillFrontmatter({
      safeCandidateName: 'packet-inspector',
      providerId: provider.providerId,
      frontmatterSource: `---
name: packet-inspector
description: Inspect packet loss symptoms and suggest telecom troubleshooting next steps.
license: MIT
compatibility: Node.js 22
allowed-tools: Read Read alarm-query
disallowed-tools: shell shell
user-invocable: true
model: gpt-4.1
metadata:
  version: 1.2.3
  modelOptions: '{"thinking":{"depth":"LOW"},"toolChoice":"NONE"}'
  owner: ran-team
---
# Body content stays outside manifest validation
Use this skill when packet loss appears.
`,
    });

    expect(parsed.outcome).toBe('accepted');
    if (parsed.outcome === 'rejected') {
      throw new Error('expected accepted manifest');
    }

    const mapped = mapSkillFrontmatterToDescriptor(parsed.frontmatter, provider, parsed.diagnostics);

    expect(mapped.outcome).toBe('accepted');
    if (mapped.outcome === 'rejected') {
      throw new Error('expected mapped descriptor');
    }
    expect(mapped.descriptor).toMatchObject({
      capabilityId: 'packet-inspector',
      kind: 'SKILL',
      provider,
      version: '1.2.3',
      displayName: 'packet-inspector',
      description: 'Inspect packet loss symptoms and suggest telecom troubleshooting next steps.',
      modelInvocable: true,
      availabilityStatus: 'AVAILABLE',
    });
    expect(mapped.descriptor).not.toHaveProperty('safeDescription');
    expect(mapped.descriptor).not.toHaveProperty('compatibility');
    expect(mapped.metadata).toEqual({
      metadataKind: 'nextagent.skill',
      context: 'inline',
      userInvocable: true,
      modelInvocable: true,
      allowedTools: ['Read', 'alarm-query'],
      deniedTools: ['shell'],
      model: 'gpt-4.1',
      modelOptions: { thinking: { depth: 'LOW' }, toolChoice: 'NONE' },
      sourceMetadata: { owner: 'ran-team' },
    });

    const ajv = new Ajv();
    expect(ajv.compile(SkillMetadataSchema)(mapped.metadata)).toBe(true);
  });

  it('accepts tool constraints as YAML arrays and maps the tools alias to allowed tools', () => {
    const blockArray = parseSkillFrontmatter({
      safeCandidateName: 'array-tools',
      providerId: provider.providerId,
      frontmatterSource: `---
name: array-tools
description: Diagnose network symptoms with array tool constraints.
allowed-tools:
- Bash
- Read
- Agent
disallowed-tools:
  - Write
---
`,
    });

    expect(blockArray.outcome).toBe('accepted');
    if (blockArray.outcome === 'rejected') {
      throw new Error('expected accepted manifest');
    }
    expect(blockArray.frontmatter.allowedTools).toEqual(['Bash', 'Read', 'Agent']);
    expect(blockArray.frontmatter.deniedTools).toEqual(['Write']);

    const inlineArray = parseSkillFrontmatter({
      safeCandidateName: 'inline-array-tools',
      providerId: provider.providerId,
      frontmatterSource: `---
name: inline-array-tools
description: Diagnose network symptoms with inline array tool constraints.
allowed-tools: ["Bash", "Read", "Agent"]
---
`,
    });
    expect(inlineArray.outcome).toBe('accepted');
    if (inlineArray.outcome === 'rejected') {
      throw new Error('expected accepted manifest');
    }
    expect(inlineArray.frontmatter.allowedTools).toEqual(['Bash', 'Read', 'Agent']);

    const alias = parseSkillFrontmatter({
      safeCandidateName: 'alias-tools',
      providerId: provider.providerId,
      frontmatterSource: `---
name: alias-tools
description: Diagnose network symptoms with migrated tool constraints.
tools:
- Bash
- Read
- Agent
---
`,
    });

    expect(alias.outcome).toBe('accepted');
    if (alias.outcome === 'rejected') {
      throw new Error('expected accepted manifest');
    }
    expect(alias.frontmatter.allowedTools).toEqual(['Bash', 'Read', 'Agent']);

    const mapped = mapSkillFrontmatterToDescriptor(alias.frontmatter, provider, alias.diagnostics);
    expect(mapped.outcome).toBe('accepted');
    if (mapped.outcome === 'rejected') {
      throw new Error('expected mapped descriptor');
    }
    expect(mapped.metadata.allowedTools).toEqual(['Bash', 'Read', 'Agent']);
  });

  it('rejects manifests that declare both allowed-tools and tools', () => {
    const parsed = parseSkillFrontmatter({
      safeCandidateName: 'conflicting-tool-fields',
      providerId: provider.providerId,
      frontmatterSource: `---
name: conflicting-tool-fields
description: Conflicting tool constraints.
allowed-tools: Bash
tools: Read
---
`,
    });

    expect(parsed.outcome).toBe('rejected');
    expect(parsed.diagnostics[0]?.reasonCode).toBe('INVALID_TOOL_CONSTRAINTS');
  });

  it('accepts YAML block scalar descriptions and maps the normalized string to the descriptor', () => {
    const parsed = parseSkillFrontmatter({
      safeCandidateName: 'multi-line-description',
      frontmatterSource: `---
name: multi-line-description
description: >
  Inspect packet loss, jitter, and handoff symptoms
  before recommending safe telecom troubleshooting steps.
---
`,
    });

    expect(parsed.outcome).toBe('accepted');
    if (parsed.outcome === 'rejected') {
      throw new Error('expected accepted manifest');
    }
    expect(parsed.frontmatter.description).toBe(
      'Inspect packet loss, jitter, and handoff symptoms before recommending safe telecom troubleshooting steps.',
    );

    const mapped = mapSkillFrontmatterToDescriptor(parsed.frontmatter, provider, parsed.diagnostics);
    expect(mapped.outcome).toBe('accepted');
    if (mapped.outcome === 'rejected') {
      throw new Error('expected mapped descriptor');
    }
    expect(mapped.descriptor.description).toBe(
      'Inspect packet loss, jitter, and handoff symptoms before recommending safe telecom troubleshooting steps.',
    );
  });

  it('accepts plain scalar description continuation lines', () => {
    const parsed = parseSkillFrontmatter({
      safeCandidateName: 'plain-description-continuation',
      frontmatterSource: `---
name: plain-description-continuation
description: Inspect packet loss symptoms and
  continue with safe telecom troubleshooting guidance.
---
`,
    });

    expect(parsed.outcome).toBe('accepted');
    if (parsed.outcome === 'rejected') {
      throw new Error('expected accepted manifest');
    }
    expect(parsed.frontmatter.description).toBe('Inspect packet loss symptoms and continue with safe telecom troubleshooting guidance.');
    expect(parsed.diagnostics.map((diagnostic) => diagnostic.reasonCode)).not.toContain('unexpected-indented-line');
  });

  it('normalizes agent fork hints and exposes Skill metadata through the typed accessor', () => {
    const parsed = parseSkillFrontmatter({
      safeCandidateName: 'handoff-diagnosis',
      frontmatterSource: `---
name: handoff-diagnosis
description: Diagnose handoff failures with a specialist Agent.
agent: radio-agent
model-invocable: false
model: gpt-4.1
metadata:
  modelOptions: '{"thinking":{"depth":"LOW"}}'
---
`,
    });

    expect(parsed.outcome).toBe('accepted');
    if (parsed.outcome === 'rejected') {
      throw new Error('expected accepted manifest');
    }

    const mapped = mapSkillFrontmatterToDescriptor(parsed.frontmatter, provider, parsed.diagnostics);
    expect(mapped.outcome).toBe('accepted');
    if (mapped.outcome === 'rejected') {
      throw new Error('expected mapped descriptor');
    }
    expect(readSkillMetadata(mapped.descriptor)).toEqual({
      matched: true,
      metadata: {
        metadataKind: 'nextagent.skill',
        context: 'fork',
        agent: 'radio-agent',
        userInvocable: false,
        modelInvocable: false,
        model: 'gpt-4.1',
        modelOptions: { thinking: { depth: 'LOW' } },
      },
    });
    expect(
      readSkillMetadata({
        capabilityId: readToolDefinition.metadata.name,
        kind: 'TOOL',
        provider: { providerId: 'builtin-tools', providerKind: 'BUNDLED' },
        displayName: 'Read',
        description: readToolDefinition.metadata.description,
        modelInvocable: true,
        availabilityStatus: 'AVAILABLE',
        inputSchema: readToolDefinition.metadata.inputSchema,
        outputSchema: readToolDefinition.metadata.outputSchema,
        replayPolicy: 'IDEMPOTENT',
      }),
    ).toEqual({ matched: false, reason: 'NON_SKILL_DESCRIPTOR' });
    expect(
      readSkillMetadata({
        ...mapped.descriptor,
        metadata: { ...mapped.metadata, providerSecret: 'sk-test' },
      }),
    ).toEqual({ matched: false, reason: 'INVALID_SKILL_METADATA' });
  });

  it('treats metadata.model as plain string source metadata without governed model meaning', () => {
    const parsed = parseSkillFrontmatter({
      safeCandidateName: 'legacy-model-alias',
      providerId: provider.providerId,
      frontmatterSource: `---
name: legacy-model-alias
description: metadata.model is source metadata only.
metadata:
  model: gpt-4.1
---
`,
    });

    expect(parsed.outcome).toBe('accepted');
    if (parsed.outcome === 'rejected') {
      throw new Error('expected accepted manifest');
    }
    expect(parsed.frontmatter.model).toBeUndefined();
    expect(parsed.frontmatter.modelOptions).toBeUndefined();
    expect(parsed.frontmatter.sourceMetadata).toEqual({ model: 'gpt-4.1' });
  });

  it('normalizes top-level model string and metadata.modelOptions into one governed model hint', () => {
    const parsed = parseSkillFrontmatter({
      safeCandidateName: 'consistent-model-options',
      providerId: provider.providerId,
      frontmatterSource: `---
name: consistent-model-options
description: Model name and inference options normalize to one hint.
model: gpt-4.1
metadata:
  modelOptions: '{"topP":0.9}'
---
`,
    });

    expect(parsed.outcome).toBe('accepted');
    if (parsed.outcome === 'rejected') {
      throw new Error('expected accepted manifest');
    }
    expect(parsed.frontmatter.model).toBe('gpt-4.1');
    expect(parsed.frontmatter.modelOptions).toEqual({ topP: 0.9 });
  });

  it('silently omits unsafe unknown source metadata without changing governed Skill metadata', () => {
    const parsed = parseSkillFrontmatter({
      safeCandidateName: 'safe-summary',
      providerId: provider.providerId,
      frontmatterSource: `---
name: safe-summary
description: Summarize safe network troubleshooting context.
metadata:
  owner: operations
  support-url: https://internal.example.invalid/ticket
---
`,
    });

    expect(parsed.outcome).toBe('accepted');
    if (parsed.outcome === 'rejected') {
      throw new Error('expected accepted manifest');
    }
    expect(parsed.diagnostics).toEqual([]);
    expect(mapSkillFrontmatterToDescriptor(parsed.frontmatter, provider, parsed.diagnostics)).toMatchObject({
      outcome: 'accepted',
      metadata: { sourceMetadata: { owner: 'operations' } },
    });
  });

  it('silently omits reserved source metadata handles from ordinary SKILL.md metadata', () => {
    const parsed = parseSkillFrontmatter({
      safeCandidateName: 'reserved-source-metadata',
      providerId: provider.providerId,
      frontmatterSource: `---
name: reserved-source-metadata
description: Omit governance-like source metadata handles from ordinary manifests.
metadata:
  owner: operations
  sourceIdentity: local-skills:reserved-source-metadata
  frontmatterHash: forged-frontmatter-hash
---
`,
    });

    expect(parsed.outcome).toBe('accepted');
    if (parsed.outcome === 'rejected') {
      throw new Error('expected accepted manifest');
    }

    const mapped = mapSkillFrontmatterToDescriptor(parsed.frontmatter, provider, parsed.diagnostics);
    expect(mapped).toMatchObject({
      outcome: 'accepted',
      metadata: {
        sourceMetadata: { owner: 'operations' },
      },
    });
    expect(mapped.outcome).not.toBe('rejected');
    if (mapped.outcome === 'rejected') {
      throw new Error('expected mapped descriptor');
    }
    expect(mapped.metadata.sourceMetadata).not.toHaveProperty('sourceIdentity');
    expect(mapped.metadata.sourceMetadata).not.toHaveProperty('frontmatterHash');
    expect(parsed.diagnostics).toEqual([]);
  });

  it('accepts supported source metadata arrays without adding governed Skill metadata fields', () => {
    const parsed = parseSkillFrontmatter({
      safeCandidateName: 'array-metadata',
      providerId: provider.providerId,
      frontmatterSource: `---
name: array-metadata
description: Preserve multi-value source metadata for Skill authoring.
metadata:
  exclusiveWith:
    - skill-a
    - skill-b
  compatibleWith: [platform-1, platform-2]
  tags: ["ran", "diagnostics"]
---
`,
    });

    expect(parsed.outcome).toBe('accepted');
    if (parsed.outcome === 'rejected') {
      throw new Error('expected accepted manifest');
    }

    const mapped = mapSkillFrontmatterToDescriptor(parsed.frontmatter, provider, parsed.diagnostics);
    expect(mapped.outcome).toBe('accepted');
    if (mapped.outcome === 'rejected') {
      throw new Error('expected mapped descriptor');
    }
    expect(mapped.metadata).toEqual({
      metadataKind: 'nextagent.skill',
      context: 'inline',
      userInvocable: false,
      modelInvocable: true,
      sourceMetadata: {
        exclusiveWith: ['skill-a', 'skill-b'],
        compatibleWith: ['platform-1', 'platform-2'],
        tags: ['ran', 'diagnostics'],
      },
    });
    expect(mapped.metadata).not.toHaveProperty('exclusiveWith');
    expect(mapped.metadata).not.toHaveProperty('compatibleWith');
    expect(mapped.metadata).not.toHaveProperty('tags');

    const ajv = new Ajv();
    expect(ajv.compile(SkillMetadataSchema)(mapped.metadata)).toBe(true);
    expect(readSkillMetadata(mapped.descriptor)).toEqual({ matched: true, metadata: mapped.metadata });
  });

  it('silently omits unsafe supported source metadata arrays without preserving the unsafe values', () => {
    const parsed = parseSkillFrontmatter({
      safeCandidateName: 'unsafe-array-metadata',
      providerId: provider.providerId,
      frontmatterSource: `---
name: unsafe-array-metadata
description: Omit unsafe source metadata arrays.
metadata:
  owner: operations
  tags: [safe, https://internal.example.invalid]
---
`,
    });

    expect(parsed.outcome).toBe('accepted');
    if (parsed.outcome === 'rejected') {
      throw new Error('expected accepted manifest');
    }
    expect(parsed.diagnostics).toEqual([]);
    expect(mapSkillFrontmatterToDescriptor(parsed.frontmatter, provider, parsed.diagnostics)).toMatchObject({
      outcome: 'accepted',
      metadata: { sourceMetadata: { owner: 'operations' } },
    });
  });

  it('treats quoted empty string optional fields as not provided instead of rejecting', () => {
    const parsed = parseSkillFrontmatter({
      safeCandidateName: 'empty-optionals',
      providerId: provider.providerId,
      frontmatterSource: `---
name: empty-optionals
description: Skill with empty optional fields.
license: ""
compatibility: ""
agent: ""
allowed-tools: ""
disallowed-tools: ""
context: ""
user-invocable: ""
model-invocable: ""
model: ""
metadata:
  version: ""
---
`,
    });

    expect(parsed.outcome).toBe('accepted');
    if (parsed.outcome === 'rejected') {
      throw new Error('expected accepted manifest');
    }
    expect(parsed.frontmatter.name).toBe('empty-optionals');
    expect(parsed.frontmatter.description).toBe('Skill with empty optional fields.');
    expect(parsed.frontmatter.license).toBeUndefined();
    expect(parsed.frontmatter.compatibility).toBeUndefined();
    expect(parsed.frontmatter.agent).toBeUndefined();
    expect(parsed.frontmatter.allowedTools).toBeUndefined();
    expect(parsed.frontmatter.model).toBeUndefined();
    expect(parsed.frontmatter.version).toBeUndefined();
    expect(parsed.frontmatter.deniedTools).toBeUndefined();
    expect(parsed.frontmatter.context).toBe('inline');
    expect(parsed.frontmatter.userInvocable).toBe(false);
    expect(parsed.frontmatter.modelInvocable).toBe(true);
  });

  it('treats empty metadata fields as not provided instead of rejecting or preserving empty source metadata', () => {
    const parsed = parseSkillFrontmatter({
      safeCandidateName: 'empty-metadata-fields',
      providerId: provider.providerId,
      frontmatterSource: `---
name: empty-metadata-fields
description: Skill with empty metadata fields.
metadata:
  version: ""
  modelOptions: ""
  model: ""
  owner: ""
  tags: []
  compatibleWith:
  exclusiveWith:
---
`,
    });

    expect(parsed.outcome).toBe('accepted');
    if (parsed.outcome === 'rejected') {
      throw new Error('expected accepted manifest');
    }
    expect(parsed.frontmatter.version).toBeUndefined();
    expect(parsed.frontmatter.deniedTools).toBeUndefined();
    expect(parsed.frontmatter.model).toBeUndefined();
    expect(parsed.frontmatter.modelOptions).toBeUndefined();
    expect(parsed.frontmatter.sourceMetadata).toBeUndefined();

    const mapped = mapSkillFrontmatterToDescriptor(parsed.frontmatter, provider, parsed.diagnostics);
    expect(mapped.outcome).toBe('accepted');
    if (mapped.outcome === 'rejected') {
      throw new Error('expected mapped descriptor');
    }
    expect(mapped.metadata).toEqual({
      metadataKind: 'nextagent.skill',
      context: 'inline',
      userInvocable: false,
      modelInvocable: true,
    });
  });

  it('treats valueless optional fields (field with no value) as not provided instead of rejecting', () => {
    const parsed = parseSkillFrontmatter({
      safeCandidateName: 'valueless-optionals',
      providerId: provider.providerId,
      frontmatterSource: `---
name: valueless-optionals
description: Skill with valueless optional fields.
license:
compatibility:
agent:
allowed-tools:
context:
user-invocable:
model-invocable:
model:
---
`,
    });

    expect(parsed.outcome).toBe('accepted');
    if (parsed.outcome === 'rejected') {
      throw new Error('expected accepted manifest');
    }
    expect(parsed.frontmatter.name).toBe('valueless-optionals');
    expect(parsed.frontmatter.description).toBe('Skill with valueless optional fields.');
    expect(parsed.frontmatter.license).toBeUndefined();
    expect(parsed.frontmatter.compatibility).toBeUndefined();
    expect(parsed.frontmatter.agent).toBeUndefined();
    expect(parsed.frontmatter.allowedTools).toBeUndefined();
    expect(parsed.frontmatter.model).toBeUndefined();
    expect(parsed.frontmatter.context).toBe('inline');
    expect(parsed.frontmatter.userInvocable).toBe(false);
    expect(parsed.frontmatter.modelInvocable).toBe(true);
  });

  it('auto-infers fork context when agent is set and context is empty', () => {
    const parsed = parseSkillFrontmatter({
      safeCandidateName: 'empty-context-agent',
      frontmatterSource: `---
name: empty-context-agent
description: Agent skill with empty context.
agent: radio-agent
context: ""
---
`,
    });

    expect(parsed.outcome).toBe('accepted');
    if (parsed.outcome === 'rejected') {
      throw new Error('expected accepted manifest');
    }
    expect(parsed.frontmatter.context).toBe('fork');
    expect(parsed.frontmatter.agent).toBe('radio-agent');
  });

  it('ignores unknown top-level fields and loads only the governed field set', () => {
    const parsed = parseSkillFrontmatter({
      safeCandidateName: 'unknown-top-level-fields',
      providerId: provider.providerId,
      frontmatterSource: `---
name: unknown-top-level-fields
description: Unknown top-level fields are ignored without rejection.
icon: network-icon
last-updated: 2026-08-25
author: ran-team
---
`,
    });

    expect(parsed.outcome).toBe('accepted');
    if (parsed.outcome === 'rejected') {
      throw new Error('expected accepted manifest');
    }
    expect(parsed.frontmatter.name).toBe('unknown-top-level-fields');
    expect(parsed.frontmatter.sourceMetadata).toBeUndefined();

    const mapped = mapSkillFrontmatterToDescriptor(parsed.frontmatter, provider, parsed.diagnostics);
    expect(mapped.outcome).toBe('accepted');
    if (mapped.outcome === 'rejected') {
      throw new Error('expected mapped descriptor');
    }
    expect(mapped.descriptor.capabilityId).toBe('unknown-top-level-fields');
  });

  it('applies script-dependent description length limits', () => {
    const longEnglish = 'a'.repeat(4096);
    const englishAccepted = parseSkillFrontmatter({
      safeCandidateName: 'long-english-desc',
      providerId: provider.providerId,
      frontmatterSource: `---
name: long-english-desc
description: ${longEnglish}
---
`,
    });
    expect(englishAccepted.outcome).toBe('accepted');

    const tooLongEnglish = 'a'.repeat(4097);
    const englishRejected = parseSkillFrontmatter({
      safeCandidateName: 'too-long-english-desc',
      providerId: provider.providerId,
      frontmatterSource: `---
name: too-long-english-desc
description: ${tooLongEnglish}
---
`,
    });
    expect(englishRejected.outcome).toBe('rejected');
    expect(englishRejected.diagnostics[0]?.reasonCode).toBe('INVALID_DESCRIPTION');

    const mixedAccepted = parseSkillFrontmatter({
      safeCandidateName: 'mixed-desc-skill',
      providerId: provider.providerId,
      frontmatterSource: `---
name: mixed-desc-skill
description: ${'告警'.repeat(500)}${'a'.repeat(24)}
---
`,
    });
    expect(mixedAccepted.outcome).toBe('accepted');

    const tooLongChinese = '告'.repeat(1025);
    const chineseRejected = parseSkillFrontmatter({
      safeCandidateName: 'too-long-chinese-desc',
      providerId: provider.providerId,
      frontmatterSource: `---
name: too-long-chinese-desc
description: ${tooLongChinese}
---
`,
    });
    expect(chineseRejected.outcome).toBe('rejected');
    expect(chineseRejected.diagnostics[0]?.reasonCode).toBe('INVALID_DESCRIPTION');
  });

  it('treats removed governed metadata keys as plain source metadata without governed meaning', () => {
    const parsed = parseSkillFrontmatter({
      safeCandidateName: 'removed-keys-skill',
      providerId: provider.providerId,
      frontmatterSource: `---
name: removed-keys-skill
description: Removed governed keys degrade to source metadata.
model: gpt-4.1
disallowed-tools: shell
metadata:
  nextagent.model: gpt-4.2
  nextagent.modelOptions: '{"topP":0.9}'
  denied-tools: write
---
`,
    });

    expect(parsed.outcome).toBe('accepted');
    if (parsed.outcome === 'rejected') {
      throw new Error('expected accepted manifest');
    }
    expect(parsed.diagnostics).toEqual([]);
    expect(parsed.frontmatter.model).toBe('gpt-4.1');
    expect(parsed.frontmatter.deniedTools).toEqual(['shell']);
    expect(parsed.frontmatter.sourceMetadata).toEqual({
      'nextagent.model': 'gpt-4.2',
      'nextagent.modelOptions': '{"topP":0.9}',
      'denied-tools': 'write',
    });
  });

  it('rejects invalid official fields, governed extensions, tool constraints, and model declarations', () => {
    const cases = [
      {
        source: `---
name: PacketInspector
description: Invalid uppercase name.
---
`,
        reasonCode: 'INVALID_NAME',
      },
      {
        source: `---
name: packet-inspector
description: Candidate mismatch.
---
`,
        candidate: 'different-skill',
        reasonCode: 'NAME_MISMATCH',
      },
      {
        source: `---
name: invalid-context
description: Invalid context.
context: remote
---
`,
        candidate: 'invalid-context',
        reasonCode: 'INVALID_CONTEXT',
      },
      {
        source: `---
name: invalid-agent-context
description: Agent cannot run inline.
context: inline
agent: radio-agent
---
`,
        candidate: 'invalid-agent-context',
        reasonCode: 'AGENT_REQUIRES_FORK_CONTEXT',
      },
      {
        source: `---
name: invalid-invocable
description: Invalid invocability.
user-invocable: yes
---
`,
        candidate: 'invalid-invocable',
        reasonCode: 'INVALID_INVOCABILITY',
      },
      {
        source: `---
name: invalid-tool
description: Invalid tool constraints.
allowed-tools: read,,shell
---
`,
        candidate: 'invalid-tool',
        reasonCode: 'INVALID_TOOL_CONSTRAINTS',
      },
      {
        source: `---
name: unsafe-model
description: Unsafe model options.
metadata:
  modelOptions: '{"baseUrl":"https://provider.example.invalid"}'
---
`,
        candidate: 'unsafe-model',
        reasonCode: 'UNSAFE_MODEL_DECLARATION',
      },
      {
        source: `---
name: unsafe-tool-choice
description: Unsafe tool choice.
metadata:
  modelOptions: '{"toolChoice":"Read"}'
---
`,
        candidate: 'unsafe-tool-choice',
        reasonCode: 'UNSAFE_MODEL_DECLARATION',
      },
      {
        source: `---
name: model-options-with-model
description: modelOptions must not carry a model identifier.
metadata:
  modelOptions: '{"model":"gpt-4.1"}'
---
`,
        candidate: 'model-options-with-model',
        reasonCode: 'UNSAFE_MODEL_DECLARATION',
      },
      {
        source: `---
name: invalid-disallowed-tools
description: Invalid disallowed tool constraints.
disallowed-tools: read,,shell
---
`,
        candidate: 'invalid-disallowed-tools',
        reasonCode: 'INVALID_TOOL_CONSTRAINTS',
      },
      {
        source: `---
name: json-object-model
description: Top-level model only accepts a model name string.
model: '{"model":"gpt-4.1","modelOptions":{"topP":0.9}}'
---
`,
        candidate: 'json-object-model',
        reasonCode: 'UNSAFE_MODEL_DECLARATION',
      },
    ];

    for (const item of cases) {
      const parsed = parseSkillFrontmatter({
        safeCandidateName: item.candidate ?? item.reasonCode.toLowerCase().replaceAll('_', '-'),
        frontmatterSource: item.source,
      });

      expect(parsed.outcome, item.reasonCode).toBe('rejected');
      expect(parsed.diagnostics[0]?.reasonCode, item.reasonCode).toBe(item.reasonCode);
    }
  });

  describe('extension metadata', () => {
    it('accepts safe string array values at the public SkillMetadataSchema boundary', () => {
      expectTypeOf<readonly string[]>().toMatchTypeOf<NonNullable<SkillMetadata['extension']>[string]>();

      const validate = new Ajv().compile(SkillMetadataSchema);
      const metadata = {
        metadataKind: 'nextagent.skill',
        context: 'inline',
        userInvocable: true,
        modelInvocable: true,
      };

      expect(
        validate({
          ...metadata,
          extension: { flag: true, nested: { threshold: 95 } },
        }),
      ).toBe(true);
      expect(
        validate({
          ...metadata,
          extension: { list: ['one'] },
        }),
      ).toBe(true);
      // Arrays inside nested maps are still rejected
      expect(
        validate({
          ...metadata,
          extension: { nested: { list: ['one'] } },
        }),
      ).toBe(true);
    });

    it('accepts wrapper-form extension with primitive and object values and flattens into SkillMetadata.extension', () => {
      const parsed = parseSkillFrontmatter({
        safeCandidateName: 'extension-skill',
        providerId: provider.providerId,
        frontmatterSource: `---
name: extension-skill
description: A skill with extension metadata.
metadata:
  owner: ran-team
  extension:
    smartcanvas: true
    logging: false
    network:
      enabled: true
---
`,
      });

      expect(parsed.outcome).toBe('accepted');
      if (parsed.outcome === 'rejected') {
        throw new Error('expected accepted manifest');
      }

      const mapped = mapSkillFrontmatterToDescriptor(parsed.frontmatter, provider, parsed.diagnostics);
      expect(mapped.outcome).toBe('accepted');
      if (mapped.outcome === 'rejected') {
        throw new Error('expected mapped descriptor');
      }

      expect(mapped.metadata.sourceMetadata).toEqual({ owner: 'ran-team' });
      expect(mapped.metadata.extension).toEqual({
        smartcanvas: true,
        logging: false,
        network: { enabled: true },
      });
      expect((mapped.metadata.extension as Record<string, unknown>).extension).toBeUndefined();

      const ajv = new Ajv();
      expect(ajv.compile(SkillMetadataSchema)(mapped.metadata)).toBe(true);
    });

    it('accepts wrapper-form extension with multiple levels as extension metadata', () => {
      const parsed = parseSkillFrontmatter({
        safeCandidateName: 'nested-extension-skill',
        providerId: provider.providerId,
        frontmatterSource: `---
name: nested-extension-skill
description: A skill with nested extension metadata.
metadata:
  owner: ran-team
  extension:
    network:
      required: true
      timeout: 5000
---
`,
      });

      expect(parsed.outcome).toBe('accepted');
      if (parsed.outcome === 'rejected') {
        throw new Error('expected accepted manifest');
      }

      const mapped = mapSkillFrontmatterToDescriptor(parsed.frontmatter, provider, parsed.diagnostics);
      expect(mapped.outcome).toBe('accepted');
      if (mapped.outcome === 'rejected') {
        throw new Error('expected mapped descriptor');
      }

      expect(mapped.metadata.extension).toEqual({
        network: {
          required: true,
          timeout: 5000,
        },
      });
    });

    it('accepts skill manifest without extension metadata and does not emit diagnostic', () => {
      const parsed = parseSkillFrontmatter({
        safeCandidateName: 'no-extension-skill',
        providerId: provider.providerId,
        frontmatterSource: `---
name: no-extension-skill
description: A skill without extension metadata.
metadata:
  owner: ran-team
---
`,
      });

      expect(parsed.outcome).toBe('accepted');
      if (parsed.outcome === 'rejected') {
        throw new Error('expected accepted manifest');
      }

      expect(parsed.frontmatter.extension).toBeUndefined();
      expect(parsed.diagnostics.length).toBe(0);

      const mapped = mapSkillFrontmatterToDescriptor(parsed.frontmatter, provider, parsed.diagnostics);
      expect(mapped.outcome).toBe('accepted');
      if (mapped.outcome === 'rejected') {
        throw new Error('expected mapped descriptor');
      }

      expect(mapped.metadata.extension).toBeUndefined();
    });

    it('silently omits unsafe extension key without emitting diagnostic', () => {
      const parsed = parseSkillFrontmatter({
        safeCandidateName: 'unsafe-extension-key',
        providerId: provider.providerId,
        frontmatterSource: `---
name: unsafe-extension-key
description: A skill with unsafe extension key.
metadata:
  owner: ran-team
  extension:
    api_key: ok
    smartcanvas: true
---
`,
      });

      expect(parsed.outcome).toBe('accepted');
      if (parsed.outcome === 'rejected') {
        throw new Error('expected accepted manifest');
      }

      expect(parsed.diagnostics).toEqual([]);

      const mapped = mapSkillFrontmatterToDescriptor(parsed.frontmatter, provider, parsed.diagnostics);
      expect(mapped.outcome).toBe('accepted');
      if (mapped.outcome === 'rejected') {
        throw new Error('expected mapped descriptor');
      }

      expect(mapped.metadata.extension).toEqual({ smartcanvas: true });
    });

    it('silently omits unsafe extension value without emitting diagnostic', () => {
      const parsed = parseSkillFrontmatter({
        safeCandidateName: 'unsafe-extension-value',
        providerId: provider.providerId,
        frontmatterSource: `---
name: unsafe-extension-value
description: A skill with unsafe extension value.
metadata:
  owner: ran-team
  extension:
    server: https://api.example.com
    smartcanvas: true
---
`,
      });

      expect(parsed.outcome).toBe('accepted');
      if (parsed.outcome === 'rejected') {
        throw new Error('expected accepted manifest');
      }

      expect(parsed.diagnostics).toEqual([]);

      const mapped = mapSkillFrontmatterToDescriptor(parsed.frontmatter, provider, parsed.diagnostics);
      expect(mapped.outcome).toBe('accepted');
      if (mapped.outcome === 'rejected') {
        throw new Error('expected mapped descriptor');
      }
      expect(mapped.metadata.extension).toEqual({ smartcanvas: true });
    });

    it('accepts safe string array extension values without diagnostic', () => {
      const parsed = parseSkillFrontmatter({
        safeCandidateName: 'array-extension-value',
        providerId: provider.providerId,
        frontmatterSource: `---
name: array-extension-value
description: A skill with array extension value.
metadata:
  extension:
    smartcanvas: true
    list:
      - one
      - two
---
`,
      });

      expect(parsed.outcome).toBe('accepted');
      if (parsed.outcome === 'rejected') {
        throw new Error('expected accepted manifest');
      }

      const extensionDiagnostic = parsed.diagnostics.find((d) => d.reasonCode === 'EXTENSION_OMITTED');
      expect(extensionDiagnostic).toBeUndefined();

      const mapped = mapSkillFrontmatterToDescriptor(parsed.frontmatter, provider, parsed.diagnostics);
      expect(mapped.outcome).toBe('accepted');
      if (mapped.outcome === 'rejected') {
        throw new Error('expected accepted descriptor');
      }
      expect(mapped.metadata.extension).toEqual({ smartcanvas: true, list: ['one', 'two'] });
    });

    it('rejects non-object metadata.extension wrapper with INVALID_OFFICIAL_FIELD', () => {
      const parsed = parseSkillFrontmatter({
        safeCandidateName: 'non-object-wrapper',
        providerId: provider.providerId,
        frontmatterSource: `---
name: non-object-wrapper
description: A skill with non-object extension wrapper.
metadata:
  extension: true
---
`,
      });

      expect(parsed.outcome).toBe('rejected');
      const diagnostic = parsed.diagnostics.find((d) => d.reasonCode === 'INVALID_OFFICIAL_FIELD');
      expect(diagnostic).toBeDefined();
    });

    it('silently omits direct-form object metadata outside the metadata.extension wrapper', () => {
      const parsed = parseSkillFrontmatter({
        safeCandidateName: 'direct-form-object',
        providerId: provider.providerId,
        frontmatterSource: `---
name: direct-form-object
description: A skill with direct-form object metadata.
metadata:
  owner: ran-team
  smartcanvas:
    enabled: true
---
`,
      });

      expect(parsed.outcome).toBe('accepted');
      if (parsed.outcome === 'rejected') {
        throw new Error('expected accepted manifest');
      }
      expect(parsed.diagnostics).toEqual([]);

      const mapped = mapSkillFrontmatterToDescriptor(parsed.frontmatter, provider, parsed.diagnostics);
      expect(mapped.outcome).toBe('accepted');
      if (mapped.outcome === 'rejected') {
        throw new Error('expected mapped descriptor');
      }
      expect(mapped.metadata.sourceMetadata).toEqual({ owner: 'ran-team' });
      expect(mapped.metadata.extension).toBeUndefined();
    });

    it('silently omits direct-form primitive metadata as unsupported source metadata', () => {
      const parsed = parseSkillFrontmatter({
        safeCandidateName: 'direct-form-primitive',
        providerId: provider.providerId,
        frontmatterSource: `---
name: direct-form-primitive
description: A skill with direct-form primitive metadata.
metadata:
  threshold: 95
---
`,
      });

      expect(parsed.outcome).toBe('accepted');
      if (parsed.outcome === 'rejected') {
        throw new Error('expected accepted manifest');
      }
      expect(parsed.diagnostics).toEqual([]);

      const mapped = mapSkillFrontmatterToDescriptor(parsed.frontmatter, provider, parsed.diagnostics);
      expect(mapped.outcome).toBe('accepted');
      if (mapped.outcome === 'rejected') {
        throw new Error('expected mapped descriptor');
      }

      expect(mapped.metadata.extension).toBeUndefined();
      expect(mapped.metadata.sourceMetadata).toBeUndefined();
    });

    it('correctly classifies string source metadata, array source metadata, and wrapper-form extension', () => {
      const parsed = parseSkillFrontmatter({
        safeCandidateName: 'mixed-metadata-skill',
        providerId: provider.providerId,
        frontmatterSource: `---
name: mixed-metadata-skill
description: A skill with mixed metadata types.
metadata:
  owner: ran-team
  tags:
    - telecom
    - 5g
  extension:
    smartcanvas:
      enabled: true
    network:
      required: true
---
`,
      });

      expect(parsed.outcome).toBe('accepted');
      if (parsed.outcome === 'rejected') {
        throw new Error('expected accepted manifest');
      }

      const mapped = mapSkillFrontmatterToDescriptor(parsed.frontmatter, provider, parsed.diagnostics);
      expect(mapped.outcome).toBe('accepted');
      if (mapped.outcome === 'rejected') {
        throw new Error('expected accepted descriptor');
      }

      expect(mapped.metadata.sourceMetadata).toEqual({
        owner: 'ran-team',
        tags: ['telecom', '5g'],
      });
      expect(mapped.metadata.extension).toEqual({
        smartcanvas: {
          enabled: true,
        },
        network: {
          required: true,
        },
      });
    });

    it('exposes flattened extension through the typed readSkillMetadata accessor', () => {
      const parsed = parseSkillFrontmatter({
        safeCandidateName: 'accessor-skill',
        providerId: provider.providerId,
        frontmatterSource: `---
name: accessor-skill
description: A skill whose extension is read by upper-layer services.
context: inline
user-invocable: true
model-invocable: true
metadata:
  version: 1.0.0
  zh-name: Accessor 验证
  en-name: Accessor Verification
  extension:
    smartcanvas: true
    logging: false
---
`,
      });

      expect(parsed.outcome).toBe('accepted');
      if (parsed.outcome === 'rejected') {
        throw new Error('expected accepted manifest');
      }

      const mapped = mapSkillFrontmatterToDescriptor(parsed.frontmatter, provider, parsed.diagnostics);
      expect(mapped.outcome).toBe('accepted');
      if (mapped.outcome === 'rejected') {
        throw new Error('expected accepted descriptor');
      }
      expect(mapped.descriptor.version).toBe('1.0.0');
      expect(mapped.descriptor.locales).toEqual({
        language: {
          'zh-CN': { displayName: 'Accessor 验证' },
          'en-US': { displayName: 'Accessor Verification' },
        },
      });
      expect(mapped.metadata.sourceMetadata).toEqual({
        'zh-name': 'Accessor 验证',
        'en-name': 'Accessor Verification',
      });

      const accessorResult = readSkillMetadata(mapped.descriptor);
      expect(accessorResult.matched).toBe(true);
      if (!accessorResult.matched) {
        throw new Error('expected matched accessor result');
      }
      expect(accessorResult.metadata.extension).toEqual({
        smartcanvas: true,
        logging: false,
      });
    });

    it('accepts whitelisted api_header_params extension key', () => {
      const parsed = parseSkillFrontmatter({
        safeCandidateName: 'api-header-params-skill',
        providerId: provider.providerId,
        frontmatterSource: [
          '---',
          'name: api-header-params-skill',
          'description: A skill with api_header_params extension.',
          'metadata:',
          '  extension:',
          '    _naie_agentic_loop_flag: "false"',
          '    api_header_params: "x-user-id,x-user-name"',
          '---',
          '',
        ].join('\n'),
      });

      expect(parsed.outcome).toBe('accepted');
      if (parsed.outcome === 'rejected') {
        throw new Error('expected accepted manifest');
      }

      const mapped = mapSkillFrontmatterToDescriptor(parsed.frontmatter, provider, parsed.diagnostics);
      expect(mapped.outcome).toBe('accepted');
      if (mapped.outcome === 'rejected') {
        throw new Error('expected mapped descriptor');
      }

      expect(mapped.metadata.extension).toEqual({
        _naie_agentic_loop_flag: 'false',
        api_header_params: 'x-user-id,x-user-name',
      });
      expect(mapped.diagnostics.find((d) => d.reasonCode === 'EXTENSION_OMITTED')).toBeUndefined();
    });

    it('still silently omits other header-containing extension keys not in whitelist', () => {
      const parsed = parseSkillFrontmatter({
        safeCandidateName: 'other-header-key-skill',
        providerId: provider.providerId,
        frontmatterSource: [
          '---',
          'name: other-header-key-skill',
          'description: A skill with other header key.',
          'metadata:',
          '  extension:',
          '    authorization_header: "secret"',
          '    smartcanvas: true',
          '---',
          '',
        ].join('\n'),
      });

      expect(parsed.outcome).toBe('accepted');
      if (parsed.outcome === 'rejected') {
        throw new Error('expected accepted manifest');
      }
      expect(parsed.diagnostics).toEqual([]);

      const mapped = mapSkillFrontmatterToDescriptor(parsed.frontmatter, provider, parsed.diagnostics);
      expect(mapped.outcome).toBe('accepted');
      if (mapped.outcome === 'rejected') {
        throw new Error('expected mapped descriptor');
      }
      expect(mapped.metadata.extension).toEqual({ smartcanvas: true });
    });
  });
});
