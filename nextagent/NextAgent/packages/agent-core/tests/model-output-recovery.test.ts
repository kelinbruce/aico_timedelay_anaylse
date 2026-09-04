import { brand } from '@nextagent/agent-common';
import type { ModelInvocationRequest } from '@nextagent/agent-contracts/model';
import { describe, expect, it } from 'vitest';

import { calculateEscalatedMaxOutputTokens, withReasoningOnlyCorrection, withOutputContinuation } from '../src/model/model-output-recovery.js';
import {
  assertTerminalContentComplete,
  maxModelVisibleChars,
  modelOutputTruncationMarker,
  truncateModelVisibleContent,
} from '../src/model/output-guard.js';

describe('model output recovery', () => {
  it('raises the default 2048-token budget by 8x', () => {
    expect(
      calculateEscalatedMaxOutputTokens({
        currentMaxOutputTokens: 2_048,
        contextWindowTokens: 128_000,
        providerInputTokens: 1_000,
      }),
    ).toBe(16_384);
  });

  it('uses 32000 tokens when the request has no explicit output limit', () => {
    expect(
      calculateEscalatedMaxOutputTokens({
        contextWindowTokens: 128_000,
        estimatedInputTokens: 10_000,
      }),
    ).toBe(32_000);
  });

  it('never exceeds the remaining context window', () => {
    expect(
      calculateEscalatedMaxOutputTokens({
        currentMaxOutputTokens: 2_048,
        contextWindowTokens: 16_000,
        providerInputTokens: 7_000,
        estimatedInputTokens: 6_000,
      }),
    ).toBe(9_000);
  });

  it('does not retry when the remaining window cannot raise the current limit', () => {
    expect(
      calculateEscalatedMaxOutputTokens({
        currentMaxOutputTokens: 8_000,
        contextWindowTokens: 16_000,
        providerInputTokens: 9_000,
      }),
    ).toBeUndefined();
  });

  it('limits output to 25% of context when no input estimate exists', () => {
    expect(
      calculateEscalatedMaxOutputTokens({
        currentMaxOutputTokens: 4_096,
        contextWindowTokens: 64_000,
      }),
    ).toBe(16_000);
  });

  it('appends only the assistant segment and provider-neutral continuation instruction', () => {
    const request = makeRequest();
    const continued = withOutputContinuation(request, 'first segment');

    expect(continued.messages).toEqual([
      ...request.messages,
      { role: 'ASSISTANT', content: [{ type: 'text', text: 'first segment' }] },
      {
        role: 'USER',
        content: [
          {
            type: 'text',
            text: 'Continue directly from the preceding assistant output. Do not apologize, repeat, or summarize content already produced. If the remaining answer is long, divide it into smaller complete sections.',
          },
        ],
      },
    ]);
  });

  it('appends a fixed correction without replaying model reasoning', () => {
    const request = makeRequest();
    const corrected = withReasoningOnlyCorrection(request);

    expect(corrected.messages).toEqual([
      ...request.messages,
      {
        role: 'USER',
        content: [
          {
            type: 'text',
            text: 'The previous response ended after internal reasoning without user-visible content or a tool call. Return either a concise user-visible answer or one necessary tool call now. Do not repeat internal reasoning or describe what you plan to do.',
          },
        ],
      },
    ]);
  });
});

describe('model output capacity projection', () => {
  it('leaves content at the hard boundary unchanged', () => {
    const content = 'x'.repeat(maxModelVisibleChars);

    expect(truncateModelVisibleContent(content)).toBe(content);
  });

  it('preserves an ordered prefix and appends the fixed marker within the hard limit', () => {
    const content = `retained-prefix-${'x'.repeat(maxModelVisibleChars)}-discarded-tail`;

    const truncated = truncateModelVisibleContent(content);

    expect(truncated).toHaveLength(maxModelVisibleChars);
    expect(truncated.startsWith('retained-prefix-')).toBe(true);
    expect(truncated.endsWith(modelOutputTruncationMarker)).toBe(true);
    expect(truncated).not.toContain('discarded-tail');
  });

  it('closes an open markdown fence before the truncation marker', () => {
    const content = `analysis\n\`\`\`text\n${'x'.repeat(maxModelVisibleChars)}discarded-tail`;

    const truncated = truncateModelVisibleContent(content);

    expect(truncated).toContain(`\n\`\`\`\n\n${modelOutputTruncationMarker}`);
    expect(() => assertTerminalContentComplete(truncated)).not.toThrow();
    expect(truncated).not.toContain('discarded-tail');
  });

  it('accepts a closed code fence emitted immediately after a reasoning close tag', () => {
    const content = [
      'Earlier quoted request:',
      '```json',
      '{"protocol":"A2A-T"}',
      '```',
      'Let me output the JSON first.</think>```json',
      '{"sub_questions":[]}',
      '```',
      'Skill missing.',
    ].join('\n');

    expect(() => assertTerminalContentComplete(content)).not.toThrow();
  });

  it('accepts closed code fences emitted immediately after other tags or colons', () => {
    const examples = [
      ['Result</analysis>```json', '{"ok":true}', '```'].join('\n'),
      ['分类结果：```json', '{"type":"自我认知"}', '```'].join('\n'),
      ['Result:```json', '{"type":"self"}', '```'].join('\n'),
      ['<div>result</div>```json', '{"ok":true}', '```'].join('\n'),
      ['  ```json', '{"indented":true}', '  ```'].join('\n'),
    ];

    for (const content of examples) {
      expect(() => assertTerminalContentComplete(content)).not.toThrow();
    }
  });

  it('does not treat ordinary inline triple backticks as markdown fence state', () => {
    const content = '普通说明里包含 ```inline``` 这样的行内标记，但不是块级代码。';

    expect(() => assertTerminalContentComplete(content)).not.toThrow();
  });

  it('still rejects a genuinely unclosed markdown code fence', () => {
    const content = ['Final answer:', '```json', '{"sub_questions":[]}', 'Skill missing.'].join('\n');

    expect(() => assertTerminalContentComplete(content)).toThrow('Model output ended in an incomplete final structure.');
  });

  it('still rejects an adjacent code fence when the closing fence is missing', () => {
    const content = ['分类结果：```json', '{"type":"自我认知"}'].join('\n');

    expect(() => assertTerminalContentComplete(content)).toThrow('Model output ended in an incomplete final structure.');
  });

  it('closes an incomplete markdown table row before the truncation marker', () => {
    const content = `| Item | Value |\n|---|---|\n| retained ${'x'.repeat(maxModelVisibleChars)}discarded-tail`;

    const truncated = truncateModelVisibleContent(content);

    expect(truncated).toContain(`|\n\n${modelOutputTruncationMarker}`);
    expect(truncated).not.toContain('discarded-tail');
  });

  it('does not split a Unicode surrogate pair at the retained-prefix boundary', () => {
    const markerLength = `\n\n${modelOutputTruncationMarker}`.length;
    const prefixCapacity = maxModelVisibleChars - markerLength;
    const content = `${'x'.repeat(prefixCapacity - 1)}😀${'y'.repeat(100)}discarded-tail`;

    const truncated = truncateModelVisibleContent(content);

    expect(truncated.length).toBeLessThanOrEqual(maxModelVisibleChars);
    expect(/[\uD800-\uDFFF]/u.test(truncated)).toBe(false);
    expect(truncated).not.toContain('discarded-tail');
    expect(truncated.endsWith(modelOutputTruncationMarker)).toBe(true);
  });
});

function makeRequest(): ModelInvocationRequest {
  return {
    invocationScope: {
      tenantId: brand<string, 'TenantId'>('tenant-1'),
      subjectId: brand<string, 'SubjectId'>('subject-1'),
      agentId: brand<string, 'AgentId'>('agent-1'),
      agentVersion: brand<string, 'AgentVersion'>('v1'),
      agentAssemblyRef: 'agent-1:v1',
      operationId: 'turn-1',
    },
    modelId: 'test-model',
    messages: [{ role: 'USER', content: [{ type: 'text', text: 'question' }] }],
    tools: [],
    maxOutputTokens: 2_048,
    timeoutMs: 120_000,
  };
}
