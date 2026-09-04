import { brand } from '@nextagent/agent-common';
import { SYSTEM_PROMPT, DefaultPromptTemplateAssembler } from '@nextagent/agent-context-engine';
import { describe, expect, it } from 'vitest';

describe('bilingual telecom output', () => {
  const assembler = new DefaultPromptTemplateAssembler();

  function request(purpose: string, locale = 'zh-CN') {
    return {
      purpose,
      agentId: brand<string, 'AgentId'>('test-agent'),
      agentVersion: brand<string, 'AgentVersion'>('v1'),
      locale: brand<string, 'RequestLocale'>(locale),
      flowVariables: {},
      selectedModel: { modelId: 'fast-model' },
    };
  }

  it('renders language following directive in assembled system prompt', async () => {
    const result = await assembler.assemble(request(SYSTEM_PROMPT));
    expect(result.renderedContent).toContain('same natural language as the user');
    expect(result.renderedContent).toContain('Do not rely on the `Locale/language hint`');
  });

  it('renders telecom term preservation directive in assembled system prompt', async () => {
    const result = await assembler.assemble(request(SYSTEM_PROMPT));
    expect(result.renderedContent).toContain('Keep all telecom terms in their original English form');
    expect(result.renderedContent).toContain('NE names, interface names, counters, alarms, KPI names');
    expect(result.renderedContent).toContain('Do not translate these terms regardless of output language');
  });

  it('includes both directives in communication_style section content', async () => {
    const result = await assembler.assemble(request(SYSTEM_PROMPT));
    const commStyle = result.sections.find((s) => s.id === 'communication_style');
    expect(commStyle).toBeDefined();
    expect(commStyle!.content).toContain('same natural language as the user');
    expect(commStyle!.content).toContain('telecom terms in their original English');
  });

  it('preserves locale hint line in rendered system message', async () => {
    const result = await assembler.assemble(request(SYSTEM_PROMPT, 'zh-CN'));
    const sectionBlock = result.sections.map((s) => s.content).join('\n\n');
    const systemMessage = `${sectionBlock}\n\nLocale/language hint: zh-CN.`;
    expect(systemMessage).toContain('same natural language as the user');
    expect(systemMessage).toContain('Locale/language hint: zh-CN');
    expect(systemMessage).toContain('Keep all telecom terms');
  });

  it('characterization: rules appear in assembled content regardless of locale', async () => {
    const zhResult = await assembler.assemble(request(SYSTEM_PROMPT, 'zh-CN'));
    const enResult = await assembler.assemble(request(SYSTEM_PROMPT, 'en-US'));
    expect(zhResult.renderedContent).toContain('same natural language as the user');
    expect(enResult.renderedContent).toContain('same natural language as the user');
    expect(zhResult.renderedContent).toContain('telecom terms');
    expect(enResult.renderedContent).toContain('telecom terms');
  });
});
