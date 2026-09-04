import { ThinkingTimelineEventLifecycleSchema } from '@nextagent/agent-contracts/runtime';
import { Ajv } from 'ajv/dist/ajv.js';
import { describe, expect, it } from 'vitest';

const validateThinkingLifecycle = new Ajv({ allErrors: true }).compile(ThinkingTimelineEventLifecycleSchema);

describe('session thinking timeline event contract', () => {
  it('accepts partial and final LLM_THINKING_DELTA lifecycle forms', () => {
    expect(
      validateThinkingLifecycle({
        type: 'LLM_THINKING_DELTA',
        persistence: 'LIVE_ONLY',
        inlinePayload: {
          reasoning: '  checking route policy  ',
          stepId: 'model:1',
        },
      }),
    ).toBe(true);

    expect(
      validateThinkingLifecycle({
        type: 'LLM_THINKING_DELTA',
        persistence: 'PERSISTED',
        inlinePayload: {
          reasoning: '  checking route policy  ',
          stepId: 'workflow:execution-1:node-1',
          completed: true,
          workflowEventType: 'NODE_COMPLETED',
          nodeId: 'node-1',
        },
      }),
    ).toBe(true);
  });

  it.each([
    {
      name: 'empty reasoning',
      event: {
        type: 'LLM_THINKING_DELTA',
        persistence: 'LIVE_ONLY',
        inlinePayload: { reasoning: '   ', stepId: 'model:1' },
      },
    },
    {
      name: 'empty step id',
      event: {
        type: 'LLM_THINKING_DELTA',
        persistence: 'LIVE_ONLY',
        inlinePayload: { reasoning: 'checking', stepId: '' },
      },
    },
    {
      name: 'completed false',
      event: {
        type: 'LLM_THINKING_DELTA',
        persistence: 'LIVE_ONLY',
        inlinePayload: { reasoning: 'checking', stepId: 'model:1', completed: false },
      },
    },
    {
      name: 'partial persisted',
      event: {
        type: 'LLM_THINKING_DELTA',
        persistence: 'PERSISTED',
        inlinePayload: { reasoning: 'checking', stepId: 'model:1' },
      },
    },
    {
      name: 'final live only',
      event: {
        type: 'LLM_THINKING_DELTA',
        persistence: 'LIVE_ONLY',
        inlinePayload: { reasoning: 'checking', stepId: 'model:1', completed: true },
      },
    },
  ])('rejects $name', ({ event }) => {
    expect(validateThinkingLifecycle(event)).toBe(false);
  });
});
