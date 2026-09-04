import {
  PromptTemplateResolveRequestSchema,
  PromptTemplateResolveResultSchema,
  type PromptTemplateResolverPort,
} from '@nextagent/agent-contracts/context';
import { Ajv } from 'ajv/dist/ajv.js';
import { describe, expect, it } from 'vitest';

describe('prompt template resolver public contract', () => {
  const ajv = new Ajv({ allErrors: true, strict: false });
  const validateRequest = ajv.compile(PromptTemplateResolveRequestSchema);
  const validateResult = ajv.compile(PromptTemplateResolveResultSchema);

  it('accepts only trusted selected-model resolution input', () => {
    expect(
      validateRequest({
        purpose: 'AGENT_ROUTING_SELECTION',
        agentId: 'router-agent',
        agentVersion: 'v1',
        locale: 'zh-CN',
        flowVariables: { environment: 'production' },
        selectedModel: { modelId: 'router-model' },
      }),
    ).toBe(true);
    expect(
      validateRequest({
        purpose: 'AGENT_ROUTING_SELECTION',
        agentId: 'router-agent',
        agentVersion: 'v1',
        flowVariables: {},
        selectedModel: { modelId: 'router-model' },
        templateId: 'caller-selected',
      }),
    ).toBe(false);
  });

  it('returns safe resolved template identity and rendered content through one port', async () => {
    const resolver: PromptTemplateResolverPort = {
      resolve: async () => ({
        status: 'RESOLVED',
        templateId: 'AGENT_ROUTING_SELECTION',
        templateRef: 'builtin:AGENT_ROUTING_SELECTION:0123456789abcdef',
        sections: [{ id: 'content', content: 'Select one candidate.' }],
        renderedContent: 'Select one candidate.',
      }),
    };
    const result = await resolver.resolve(
      {
        purpose: 'AGENT_ROUTING_SELECTION',
        agentId: 'router-agent' as never,
        agentVersion: 'v1' as never,
        flowVariables: {},
        selectedModel: { modelId: 'router-model' },
      },
      new AbortController().signal,
    );
    expect(validateResult(result)).toBe(true);
  });

  it('returns a closed NOT_FOUND result without prompt content', () => {
    expect(validateResult({ status: 'NOT_FOUND' })).toBe(true);
    expect(validateResult({ status: 'NOT_FOUND', renderedContent: 'hidden fallback' })).toBe(false);
    expect(validateResult({ status: 'NOT_FOUND', templateRef: 'builtin:unexpected' })).toBe(false);
  });
});
