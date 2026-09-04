import { brand, type JsonObject, type SafeError } from '@nextagent/agent-common';
import type { CapabilityInvocationResult } from '@nextagent/agent-contracts/capability';
import type { RecipeDefinition, WorkflowExecutionResult } from '@nextagent/agent-contracts/core';
import { describe, expect, it } from 'vitest';

import { mapWorkflowResult } from '../../packages/agent-workflow/src/workflow-tool-port.js';

describe('Workflow tool structuredPayload safety contract', () => {
  function safeRecipe(): RecipeDefinition {
    return {
      recipeName: 'safe-recipe',
      version: 'v1',
      displayName: 'Safe Recipe',
      flowGraph: {
        nodes: {
          start: { type: 'START', next: { answer: {} } },
          answer: { type: 'LLM', next: { end: {} } },
          end: { type: 'END', next: {} },
        },
      },
    };
  }

  const baseResult: WorkflowExecutionResult = {
    executionId: 'exec-safe-1',
    status: 'COMPLETED',
    outputVariables: {},
    nodeResults: [],
    startedAt: new Date('2026-01-01T00:00:00Z'),
    completedAt: new Date('2026-01-01T00:00:01Z'),
  };

  it('does not include secret-like keys in structuredPayload outputVariables', () => {
    const result = mapWorkflowResult('safe-recipe', safeRecipe(), {
      ...baseResult,
      nodeResults: [
        {
          nodeId: 'answer',
          nodeType: 'LLM' as never,
          status: 'NODE_COMPLETED',
          retryCount: 0,
          startedAt: new Date(),
          completedAt: new Date(),
          output: {
            summary: 'diagnosis ok',
            secretKey: 'hidden',
            apiKey: 'hidden',
            password: 'hidden',
            credential: 'hidden',
            token: 'hidden',
            access_key: 'hidden',
            private_key: 'hidden',
            alarmCount: 2,
          },
        },
      ],
    });
    expect(result.status).toBe('SUCCEEDED');
    const payload = result.structuredPayload;
    const payloadStr = JSON.stringify(payload);
    expect(payloadStr).not.toContain('hidden');
    expect(payloadStr).toContain('diagnosis ok');
    expect(payloadStr).toContain('alarmCount');
  });

  it('does not include raw provider error in safeError', () => {
    const result = mapWorkflowResult('safe-recipe', safeRecipe(), {
      ...baseResult,
      status: 'FAILED',
      nodeResults: [
        {
          nodeId: 'node-fail',
          nodeType: 'LLM' as never,
          status: 'NODE_FAILED',
          retryCount: 1,
          startedAt: new Date(),
          completedAt: new Date(),
          safeError: {
            code: 'NODE_LLM_ERROR',
            message: 'LLM node encountered a safe error.',
            category: 'INTERNAL',
            retryable: false,
          },
        },
      ],
    });
    expect(result.status).toBe('FAILED');
    expect(result.safeError?.code).toBe('NODE_LLM_ERROR');
    const safeErrorStr = JSON.stringify(result.safeError ?? {});
    expect(safeErrorStr).not.toContain('path');
    expect(safeErrorStr).not.toContain('credential');
    expect(safeErrorStr).not.toContain('stack');
  });

  it('metadata only contains safe traceable keys', () => {
    const result = mapWorkflowResult('safe-recipe', safeRecipe(), {
      ...baseResult,
      nodeResults: [
        {
          nodeId: 'answer',
          nodeType: 'LLM' as never,
          status: 'NODE_COMPLETED',
          retryCount: 0,
          startedAt: new Date(),
          completedAt: new Date(),
          output: { summary: 'ok' },
        },
      ],
    });
    const metadata = result.metadata as JsonObject;
    expect(metadata).toBeDefined();
    const keys = Object.keys(metadata);
    expect(keys).toEqual(['executionId', 'nodeResultCount']);
    expect(keys).not.toContain('rawError');
    expect(keys).not.toContain('secret');
    expect(keys).not.toContain('internalPath');
  });

  it('WAITING pendingInput summary only contains prompt and option labels', () => {
    const result = mapWorkflowResult('safe-recipe', safeRecipe(), {
      ...baseResult,
      status: 'WAITING',
      pendingInput: {
        id: 'pending-user-check',
        sessionId: 'session-workflow-tool-safety',
        kind: 'QUESTION',
        questions: [
          {
            prompt: 'Select action',
            options: [
              { label: 'restart', value: 'restart-cmd', internalRef: 'secret-path' },
              { label: 'escalate', value: 'escalate-cmd', internalRef: 'secret-path2' },
            ],
          },
        ],
      } as JsonObject,
    });
    expect(result.status).toBe('SUCCEEDED');
    expect(result.safeError).toBeUndefined();
    const pendingInput = result.structuredPayload.pendingInput as JsonObject;
    const pendingStr = JSON.stringify(pendingInput);
    expect(pendingStr).toContain('Select action');
    expect(pendingStr).toContain('restart');
    expect(pendingStr).toContain('escalate');
    expect(pendingStr).not.toContain('restart-cmd');
    expect(pendingStr).not.toContain('escalate-cmd');
    expect(pendingStr).not.toContain('secret-path');
  });
});

describe('Workflow tool answerPreviews extraction', () => {
  function answerRecipe(): RecipeDefinition {
    return {
      recipeName: 'answer-recipe',
      version: 'v1',
      displayName: 'Answer Recipe',
      flowGraph: {
        nodes: {
          start: { type: 'START', next: { 'answer-node-1': {} } },
          'answer-node-1': { type: 'LLM', next: { end: {} } },
          end: { type: 'END', next: {} },
        },
      },
    };
  }

  const baseNodeResult = {
    nodeId: 'answer-node-1',
    nodeType: 'LLM',
    status: 'NODE_COMPLETED',
    retryCount: 0,
    startedAt: new Date('2026-01-01T00:00:00Z'),
    completedAt: new Date('2026-01-01T00:00:01Z'),
  };

  it('extracts answer node content into answerPreviews for COMPLETED', () => {
    const result = mapWorkflowResult('answer-recipe', answerRecipe(), {
      executionId: 'exec-answer-1',
      status: 'COMPLETED',
      outputVariables: {},
      nodeResults: [{ ...baseNodeResult, output: { content: 'The root cause is high CPU on cell-1.' } }],
      startedAt: new Date('2026-01-01T00:00:00Z'),
      completedAt: new Date('2026-01-01T00:00:02Z'),
    });
    expect(result.status).toBe('SUCCEEDED');
    const previews = result.structuredPayload.answerPreviews as readonly string[];
    expect(previews).toHaveLength(1);
    expect(previews[0]).toBe('The root cause is high CPU on cell-1.');
  });

  it('includes answerPreviews in INTERRUPTED status', () => {
    const result = mapWorkflowResult('answer-recipe', answerRecipe(), {
      executionId: 'exec-answer-2',
      status: 'INTERRUPTED',
      outputVariables: {},
      nodeResults: [{ ...baseNodeResult, output: { content: 'Partial diagnosis before interruption.' } }],
      startedAt: new Date('2026-01-01T00:00:00Z'),
      completedAt: new Date('2026-01-01T00:00:01Z'),
    });
    expect(result.status).toBe('FAILED');
    const previews = result.structuredPayload.answerPreviews as readonly string[];
    expect(previews).toHaveLength(1);
    expect(previews[0]).toBe('Partial diagnosis before interruption.');
  });

  it('includes answerPreviews in WAITING status', () => {
    const result = mapWorkflowResult('answer-recipe', answerRecipe(), {
      executionId: 'exec-answer-3',
      status: 'WAITING',
      outputVariables: {},
      nodeResults: [{ ...baseNodeResult, output: { content: 'Need user confirmation before proceeding.' } }],
      pendingInput: { kind: 'USER_CHECK', questions: [{ prompt: 'Confirm?', options: [{ label: 'yes' }] }] } as JsonObject,
      startedAt: new Date('2026-01-01T00:00:00Z'),
      completedAt: new Date('2026-01-01T00:00:01Z'),
    });
    expect(result.status).toBe('SUCCEEDED');
    expect(result.safeError).toBeUndefined();
    const previews = result.structuredPayload.answerPreviews as readonly string[];
    expect(previews).toHaveLength(1);
    expect(previews[0]).toBe('Need user confirmation before proceeding.');
  });

  it('returns empty answerPreviews when answer node is resolved but has no output', () => {
    const result = mapWorkflowResult('answer-recipe', answerRecipe(), {
      executionId: 'exec-answer-4',
      status: 'COMPLETED',
      outputVariables: {},
      nodeResults: [{ ...baseNodeResult, nodeId: 'detail-1', output: { content: 'trace data' } }],
      startedAt: new Date('2026-01-01T00:00:00Z'),
      completedAt: new Date('2026-01-01T00:00:01Z'),
    });
    expect(result.status).toBe('SUCCEEDED');
    const previews = result.structuredPayload.answerPreviews as readonly string[];
    expect(previews).toHaveLength(0);
  });

  it('truncates answer previews exceeding 4000 characters', () => {
    const longContent = 'A'.repeat(5000);
    const result = mapWorkflowResult('answer-recipe', answerRecipe(), {
      executionId: 'exec-answer-5',
      status: 'COMPLETED',
      outputVariables: {},
      nodeResults: [{ ...baseNodeResult, output: { content: longContent } }],
      startedAt: new Date('2026-01-01T00:00:00Z'),
      completedAt: new Date('2026-01-01T00:00:01Z'),
    });
    const previews = result.structuredPayload.answerPreviews as readonly string[];
    expect(previews).toHaveLength(1);
    const first = previews[0]!;
    expect(first.length).toBeLessThan(5000);
    expect(first).toContain('...');
    expect(first.startsWith('A')).toBe(true);
  });

  it('extracts only the resolved answer node content', () => {
    const result = mapWorkflowResult('answer-recipe', answerRecipe(), {
      executionId: 'exec-answer-6',
      status: 'COMPLETED',
      outputVariables: {},
      nodeResults: [
        { ...baseNodeResult, nodeId: 'other-node', output: { content: 'should not appear' } },
        { ...baseNodeResult, output: { content: 'Answer from resolved node' } },
      ],
      startedAt: new Date('2026-01-01T00:00:00Z'),
      completedAt: new Date('2026-01-01T00:00:01Z'),
    });
    const previews = result.structuredPayload.answerPreviews as readonly string[];
    expect(previews).toHaveLength(1);
    expect(previews[0]!).toBe('Answer from resolved node');
  });
});
