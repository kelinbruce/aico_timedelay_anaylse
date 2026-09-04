import { MEMORY_EXTRACTION, createDefaultPromptTemplateAssembler, createDefaultPromptTemplateRegistry } from '@nextagent/agent-context-engine';
import { brand } from '@nextagent/agent-common';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('memory extraction contract', () => {
  it('keeps the builtin MEMORY_EXTRACTION prompt constrained to task trajectory safe projection', () => {
    const templatePath = join(process.cwd(), 'packages', 'agent-context-engine', 'prompt-templates', 'builtin', 'MEMORY_EXTRACTION', 'template.yaml');
    expect(existsSync(templatePath)).toBe(true);
    const content = readFileSync(templatePath, 'utf8');

    for (const category of ['FACTUAL', 'CONCEPTUAL', 'PROCEDURAL', 'USER_CHARACTERISTICS']) {
      expect(content).toContain(category);
    }
    for (const boundary of [
      'TaskTrajectory',
      'sourceTrace',
      'raw message history',
      'raw prompts',
      'provider payloads',
      'attachment bodies',
      'credentials',
      'secrets',
      'raw trait value',
    ]) {
      expect(content).toContain(boundary);
    }
    expect(content).toMatch(/PROCEDURAL[\s\S]*VERIFICATION[\s\S]*USER_CONFIRMATION/u);
    expect(content).toMatch(/USER_CHARACTERISTICS[\s\S]*low-sensitivity[\s\S]*purpose/u);
  });

  it('selects Agent MEMORY_EXTRACTION prompt overrides through the shared registry', async () => {
    const root = mkdtempSync(join(tmpdir(), 'nextagent-memory-prompt-agent-'));
    try {
      const promptRoot = join(root, 'prompts');
      mkdirSync(join(promptRoot, 'MEMORY_EXTRACTION'), { recursive: true });
      writeFileSync(
        join(promptRoot, 'MEMORY_EXTRACTION', 'template.yaml'),
        [
          'content: |',
          '  Agent MEMORY_EXTRACTION override for telecom SON troubleshooting.',
          '  Preserve FACTUAL, CONCEPTUAL, PROCEDURAL, USER_CHARACTERISTICS boundaries and sourceTrace refs.',
        ].join('\n'),
      );

      const registry = createDefaultPromptTemplateRegistry();
      registry.register({ agentId: 'agent-a', agentVersion: '1.0.0', path: promptRoot });
      const assembler = createDefaultPromptTemplateAssembler(registry);
      const result = await assembler.assemble(request());

      expect(result.templateRef).toMatch(/^agent:agent-a:1\.0\.0:MEMORY_EXTRACTION:/u);
      expect(result.renderedContent).toContain('Agent MEMORY_EXTRACTION override');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('falls back to builtin MEMORY_EXTRACTION prompt when Agent override is absent', async () => {
    const assembler = createDefaultPromptTemplateAssembler(createDefaultPromptTemplateRegistry());
    const result = await assembler.assemble(request());

    expect(result.templateRef).toMatch(/^builtin:MEMORY_EXTRACTION:/u);
    expect(result.renderedContent).toContain('TaskTrajectory safety projection');
  });
});

function request() {
  return {
    purpose: MEMORY_EXTRACTION,
    agentId: brand<string, 'AgentId'>('agent-a'),
    agentVersion: brand<string, 'AgentVersion'>('1.0.0'),
    locale: brand<string, 'RequestLocale'>('zh-CN'),
    flowVariables: {},
    selectedModel: { modelId: 'MiniMax-M2.7' },
  };
}
