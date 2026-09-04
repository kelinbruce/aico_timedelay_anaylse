import type { TokenEstimator } from '@nextagent/agent-contracts/context';
import type { ModelMessage, ModelToolDescriptor } from '@nextagent/agent-contracts/model';
import { describe, expect, it } from 'vitest';
import { RenderedContextSupplementAdmission, type RenderedContextSupplement } from '../src/budget/rendered-context-supplement-admission.js';

const estimator: TokenEstimator = {
  estimateTokens: (text) => text.length,
  estimateMessageTokens: (_role, content) => content.length,
  estimateToolMessageTokens: (toolCallId, toolName, content) => toolCallId.length + toolName.length + content.length,
  estimateTokensBatch: (texts) => texts.reduce((total, text) => total + text.length, 0),
};

const existingMessage: ModelMessage = {
  role: 'USER',
  content: [{ type: 'text', text: 'query' }],
};

const l2Message: ModelMessage = {
  role: 'SYSTEM',
  content: [{ type: 'text', text: 'full-memory-detail' }],
};

const l1Message: ModelMessage = {
  role: 'SYSTEM',
  content: [{ type: 'text', text: 'memory-summary' }],
};

const characteristicsMessage: ModelMessage = {
  role: 'SYSTEM',
  content: [{ type: 'text', text: 'user-traits' }],
};

const broadRecallSupplements: readonly RenderedContextSupplement[] = [
  { kind: 'L2', message: l2Message, exclusiveGroup: 'broad-recall' },
  { kind: 'L1', message: l1Message, exclusiveGroup: 'broad-recall' },
];

const tool: ModelToolDescriptor = {
  capabilityId: 'search',
  name: 'search',
  description: 'search memory',
  inputSchema: { type: 'object' },
};

describe('RenderedContextSupplementAdmission', () => {
  const admission = new RenderedContextSupplementAdmission(estimator);

  it('admits the complete L2 message when the final model input fits', () => {
    const result = admission.admit({
      messages: [existingMessage],
      tools: [],
      contextWindowTokens: 31,
      reservedOutputTokens: 5,
      supplements: broadRecallSupplements,
    });

    expect(result).toEqual({ disposition: 'L2_CONTEXT', messages: [l2Message] });
  });

  it('degrades the complete L2 message to the complete L1 message', () => {
    const result = admission.admit({
      messages: [existingMessage],
      tools: [],
      contextWindowTokens: 24,
      reservedOutputTokens: 5,
      supplements: broadRecallSupplements,
    });

    expect(result).toEqual({ disposition: 'L1_CONTEXT', messages: [l1Message] });
  });

  it('returns no context when neither complete candidate fits', () => {
    const result = admission.admit({
      messages: [existingMessage],
      tools: [],
      contextWindowTokens: 18,
      reservedOutputTokens: 5,
      supplements: broadRecallSupplements,
    });

    expect(result).toEqual({ disposition: 'NO_CONTEXT' });
  });

  it('counts the final tool descriptors and accepts an exact budget boundary', () => {
    const existingUnits = 'query'.length;
    const toolUnits = JSON.stringify(tool).length;
    const l1Units = 'memory-summary'.length;

    const result = admission.admit({
      messages: [existingMessage],
      tools: [tool],
      contextWindowTokens: existingUnits + toolUnits + l1Units + 7,
      reservedOutputTokens: 7,
      supplements: broadRecallSupplements,
    });

    expect(result).toEqual({ disposition: 'L1_CONTEXT', messages: [l1Message] });
  });

  it('admits the characteristics message alongside L2 when both fit', () => {
    const result = admission.admit({
      messages: [existingMessage],
      tools: [],
      contextWindowTokens: 50,
      reservedOutputTokens: 5,
      supplements: [...broadRecallSupplements, { kind: 'CHARACTERISTICS', message: characteristicsMessage }],
    });

    expect(result).toEqual({ disposition: 'L2_CONTEXT', messages: [l2Message, characteristicsMessage] });
  });

  it('admits only the characteristics message when the broad-recall pair does not fit', () => {
    const result = admission.admit({
      messages: [existingMessage],
      tools: [],
      contextWindowTokens: 23,
      reservedOutputTokens: 5,
      supplements: [...broadRecallSupplements, { kind: 'CHARACTERISTICS', message: characteristicsMessage }],
    });

    expect(result).toEqual({ disposition: 'CHARACTERISTICS_CONTEXT', messages: [characteristicsMessage] });
  });

  it('returns no context when no supplement fits', () => {
    const result = admission.admit({
      messages: [existingMessage],
      tools: [],
      contextWindowTokens: 10,
      reservedOutputTokens: 5,
      supplements: [...broadRecallSupplements, { kind: 'CHARACTERISTICS', message: characteristicsMessage }],
    });

    expect(result).toEqual({ disposition: 'NO_CONTEXT' });
  });

  it('admits only the first fitting supplement within an exclusive group', () => {
    const result = admission.admit({
      messages: [existingMessage],
      tools: [],
      contextWindowTokens: 28,
      reservedOutputTokens: 5,
      supplements: [...broadRecallSupplements, { kind: 'CHARACTERISTICS', message: characteristicsMessage }],
    });

    expect(result).toEqual({ disposition: 'L2_CONTEXT', messages: [l2Message] });
  });
});
