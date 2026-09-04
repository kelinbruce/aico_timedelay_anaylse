import { brand } from '@nextagent/agent-common';
import {
  createDefaultPromptTemplateAssembler,
  createDefaultPromptTemplateRegistry,
  createPromptTemplateResolver,
} from '@nextagent/agent-context-engine';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('PromptTemplateResolverPort implementation', () => {
  it('returns NOT_FOUND when the Agent has no routing selection template', async () => {
    const resolver = createPromptTemplateResolver(createDefaultPromptTemplateAssembler(createDefaultPromptTemplateRegistry()));
    const result = await resolver.resolve(
      {
        purpose: 'AGENT_ROUTING_SELECTION',
        agentId: brand<string, 'AgentId'>('router-agent'),
        agentVersion: brand<string, 'AgentVersion'>('v1'),
        locale: brand<string, 'RequestLocale'>('zh-CN'),
        flowVariables: {},
        selectedModel: { modelId: 'router-model' },
      },
      new AbortController().signal,
    );

    expect(result).toEqual({ status: 'NOT_FOUND' });
  });

  it('stops before resolution when canceled', async () => {
    const resolver = createPromptTemplateResolver(createDefaultPromptTemplateAssembler(createDefaultPromptTemplateRegistry()));
    const controller = new AbortController();
    controller.abort(new Error('canceled'));
    await expect(
      resolver.resolve(
        {
          purpose: 'AGENT_ROUTING_SELECTION',
          agentId: brand<string, 'AgentId'>('router-agent'),
          agentVersion: brand<string, 'AgentVersion'>('v1'),
          flowVariables: {},
          selectedModel: { modelId: 'router-model' },
        },
        controller.signal,
      ),
    ).rejects.toThrow('canceled');
  });

  it('resolves a matching Agent template', async () => {
    const root = await mkdtemp(join(tmpdir(), 'nextagent-router-prompt-'));
    try {
      const templateRoot = join(root, 'router-selection');
      await mkdir(templateRoot, { recursive: true });
      await writeFile(
        join(templateRoot, 'template.yaml'),
        [
          'schemaVersion: nextagent.prompt-template/v1',
          'purpose: AGENT_ROUTING_SELECTION',
          'match:',
          '  locale: zh-CN',
          'content: |',
          '  使用当前 Agent 自定义路由提示词。',
          '',
        ].join('\n'),
        'utf8',
      );
      const registry = createDefaultPromptTemplateRegistry();
      registry.register({ agentId: 'router-agent', agentVersion: 'v1', path: root });
      const resolver = createPromptTemplateResolver(createDefaultPromptTemplateAssembler(registry));
      const result = await resolver.resolve(
        {
          purpose: 'AGENT_ROUTING_SELECTION',
          agentId: brand<string, 'AgentId'>('router-agent'),
          agentVersion: brand<string, 'AgentVersion'>('v1'),
          locale: brand<string, 'RequestLocale'>('zh-CN'),
          flowVariables: {},
          selectedModel: { modelId: 'router-model' },
        },
        new AbortController().signal,
      );

      expect(result).toMatchObject({
        status: 'RESOLVED',
        templateId: 'router-selection',
        renderedContent: '使用当前 Agent 自定义路由提示词。',
      });
      expect(result.status === 'RESOLVED' ? result.templateRef : '').toMatch(/^agent:router-agent:v1:/u);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
