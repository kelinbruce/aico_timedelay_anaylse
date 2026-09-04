import { brand, type JsonObject, type SafeError } from '@nextagent/agent-common';
import type { CapabilityInvocationResult } from '@nextagent/agent-contracts/capability';
import type { RecipeDefinition, WorkflowExecutionResult } from '@nextagent/agent-contracts/core';
import { describe, expect, it } from 'vitest';

import { mapWorkflowResult } from '../../agent-workflow/src/workflow-tool-port.js';
import { workflowToolDefinition } from '@nextagent/agent-capability';

describe('Workflow tool definition', () => {
  it('declares requiredDependencies, replayPolicy, returnsCapabilityResult and disclosurePolicy', () => {
    const meta = workflowToolDefinition.metadata;
    expect(String(meta.name)).toBe('Workflow');
    expect(meta.requiredDependencies).toEqual(['workflowExecution']);
    expect(meta.replayPolicy).toBe('NON_IDEMPOTENT');
    expect(meta.returnsCapabilityResult).toBe(true);
    expect(meta.disclosurePolicy?.mode).toBe('EAGER');
  });

  it('rejects empty recipeName', async () => {
    const result = await workflowToolDefinition.tool.execute({ recipeName: '' } as JsonObject, { signal: new AbortController().signal });
    expect(result).toMatchObject({ status: 'FAILED' });
    expect((result as CapabilityInvocationResult).safeError?.category).toBe('VALIDATION');
    expect((result as CapabilityInvocationResult).safeError?.message).toBe(
      'Workflow validation failed before execution: recipeName must be a non-empty string. Supply a registered recipe name and call again.',
    );
  });

  it('rejects recipeName exceeding length budget', async () => {
    const result = await workflowToolDefinition.tool.execute({ recipeName: 'x'.repeat(200) } as JsonObject, { signal: new AbortController().signal });
    expect(result).toMatchObject({ status: 'FAILED' });
    expect((result as CapabilityInvocationResult).safeError?.category).toBe('VALIDATION');
    expect((result as CapabilityInvocationResult).safeError?.message).toBe(
      'Workflow validation failed before execution: recipeName must contain at most 128 characters. Use a valid registered recipe name and call again.',
    );
  });

  it('rejects inputVariables that is not an object', async () => {
    const result = await workflowToolDefinition.tool.execute(
      { recipeName: 'test-recipe', inputVariables: 'not-an-object' } as unknown as JsonObject,
      { signal: new AbortController().signal },
    );
    expect(result).toMatchObject({ status: 'FAILED' });
    expect((result as CapabilityInvocationResult).safeError?.category).toBe('VALIDATION');
  });

  it('rejects unsupported input fields', async () => {
    const result = await workflowToolDefinition.tool.execute({ recipeName: 'test-recipe', extraField: 'bad' } as JsonObject, {
      signal: new AbortController().signal,
    });
    expect(result).toMatchObject({ status: 'FAILED' });
    expect((result as CapabilityInvocationResult).safeError?.category).toBe('VALIDATION');
    expect((result as CapabilityInvocationResult).safeError?.message).toBe(
      'Workflow validation failed before execution: input supports only recipeName, inputText, and inputVariables. Remove unsupported fields and call again.',
    );
  });

  it('returns FAILED when context or workflowExecution dependency is missing', async () => {
    const result = await workflowToolDefinition.tool.execute({ recipeName: 'test-recipe' } as JsonObject, { signal: new AbortController().signal });
    expect(result).toMatchObject({ status: 'FAILED' });
    expect((result as CapabilityInvocationResult).safeError?.category).toBe('UNAVAILABLE');
  });

  it('returns FAILED when signal is already aborted', async () => {
    const ac = new AbortController();
    ac.abort();
    const result = await workflowToolDefinition.tool.execute({ recipeName: 'test-recipe' } as JsonObject, { signal: ac.signal });
    expect(result).toMatchObject({ status: 'FAILED' });
    expect((result as CapabilityInvocationResult).safeError?.category).toBe('CANCELED');
  });

  it('delegates to workflowExecution port on valid input', async () => {
    const expectedResult: CapabilityInvocationResult = {
      status: 'SUCCEEDED',
      structuredPayload: { recipeName: 'test-recipe', status: 'succeeded' },
      generatedMessages: [],
      artifactRefs: [],
    };
    const mockPort = {
      execute: async () => expectedResult,
    };
    const result = await workflowToolDefinition.tool.execute(
      { recipeName: 'test-recipe', inputText: 'user question', inputVariables: { key: 'value' } } as JsonObject,
      {
        signal: new AbortController().signal,
        context: createMockContext({ recipeName: 'test-recipe' }),
        deps: { workflowExecution: mockPort } as never,
      },
    );
    expect(result).toEqual(expectedResult);
  });

  it('fails closed when recipe capability is not visible in current scope', async () => {
    let executeCalled = false;
    const mockPort = {
      execute: async () => {
        executeCalled = true;
        return {
          status: 'SUCCEEDED',
          structuredPayload: { recipeName: 'test-recipe', status: 'succeeded' },
          generatedMessages: [],
          artifactRefs: [],
        } satisfies CapabilityInvocationResult;
      },
    };
    const result = await workflowToolDefinition.tool.execute({ recipeName: 'test-recipe' } as JsonObject, {
      signal: new AbortController().signal,
      context: createMockContext(),
      deps: { workflowExecution: mockPort } as never,
    });
    expect(result).toMatchObject({
      status: 'FAILED',
      safeError: {
        code: 'RECIPE_NOT_FOUND',
        category: 'NOT_FOUND',
        retryable: false,
        message: expect.stringMatching(/not available.*registered.*without Workflow/iu),
      },
    });
    expect(executeCalled).toBe(false);
  });
});

describe('mapWorkflowResult', () => {
  function testRecipe(answerNodeId = 'answer'): RecipeDefinition {
    return {
      recipeName: 'test-recipe',
      version: 'v1',
      displayName: 'Test Recipe',
      flowGraph: {
        nodes: {
          start: { type: 'START', next: { [answerNodeId]: {} } },
          [answerNodeId]: { type: 'LLM', next: { end: {} } },
          end: { type: 'END', next: {} },
        },
      },
    };
  }

  const baseResult: WorkflowExecutionResult = {
    executionId: 'exec-123',
    status: 'COMPLETED',
    outputVariables: {},
    nodeResults: [],
    startedAt: new Date('2026-01-01T00:00:00Z'),
    completedAt: new Date('2026-01-01T00:00:01Z'),
  };

  it('maps COMPLETED to SUCCEEDED with outputVariables', () => {
    const result = mapWorkflowResult('test-recipe', testRecipe(), {
      ...baseResult,
      nodeResults: [
        {
          nodeId: 'answer',
          nodeType: 'LLM' as never,
          status: 'NODE_COMPLETED',
          retryCount: 0,
          startedAt: new Date(),
          completedAt: new Date(),
          output: { summary: 'diagnosis complete', alarmCount: 3 },
        },
      ],
    });
    expect(result.status).toBe('SUCCEEDED');
    expect(result.structuredPayload).toMatchObject({
      recipeName: 'test-recipe',
      status: 'succeeded',
      outputVariables: { summary: 'diagnosis complete', alarmCount: 3 },
    });
    expect(result.metadata).toMatchObject({ executionId: 'exec-123', nodeResultCount: 1 });
  });

  it('maps INTERRUPTED to FAILED with CANCELED', () => {
    const result = mapWorkflowResult('test-recipe', testRecipe(), {
      ...baseResult,
      status: 'INTERRUPTED',
    });
    expect(result.status).toBe('FAILED');
    expect(result.safeError?.category).toBe('CANCELED');
    expect(result.safeError?.retryable).toBe(false);
  });

  it('maps FAILED to FAILED with safeError from last failed node', () => {
    const nodeSafeError: SafeError = {
      code: 'NODE_EXECUTION_ERROR',
      message: 'Node failed safely.',
      category: 'INTERNAL',
      retryable: false,
    };
    const result = mapWorkflowResult('test-recipe', testRecipe(), {
      ...baseResult,
      status: 'FAILED',
      nodeResults: [
        {
          nodeId: 'node-1',
          nodeType: 'LLM' as never,
          status: 'NODE_FAILED',
          retryCount: 0,
          startedAt: new Date(),
          completedAt: new Date(),
          safeError: nodeSafeError,
        },
      ],
    });
    expect(result.status).toBe('FAILED');
    expect(result.safeError?.code).toBe('NODE_EXECUTION_ERROR');
  });

  it('maps WAITING to SUCCEEDED with pendingInput summary', () => {
    const result = mapWorkflowResult('test-recipe', testRecipe(), {
      ...baseResult,
      status: 'WAITING',
      pendingInput: {
        id: 'pending-user-check',
        sessionId: 'session-workflow-tool',
        kind: 'QUESTION',
        questions: [
          {
            prompt: 'Select recovery action',
            options: [
              { label: 'restart', value: 'restart' },
              { label: 'escalate', value: 'escalate' },
            ],
          },
        ],
      } as JsonObject,
    });
    expect(result.status).toBe('SUCCEEDED');
    expect(result.safeError).toBeUndefined();
    expect(result.structuredPayload).toMatchObject({
      recipeName: 'test-recipe',
      status: 'waiting',
    });
    const pendingInput = result.structuredPayload.pendingInput as JsonObject;
    expect(pendingInput.kind).toBe('QUESTION');
    expect(Array.isArray(pendingInput.questions)).toBe(true);
  });

  it('filters outputVariables with secret keyword pattern', () => {
    const result = mapWorkflowResult('test-recipe', testRecipe(), {
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
            summary: 'safe',
            secretToken: 'sensitive',
            apiKey: 'sensitive',
            password: 'sensitive',
            alarmCount: 5,
          },
        },
      ],
    });
    expect(result.status).toBe('SUCCEEDED');
    const outputVariables = result.structuredPayload.outputVariables as JsonObject;
    expect(outputVariables.summary).toBe('safe');
    expect(outputVariables.alarmCount).toBe(5);
    expect(outputVariables.secretToken).toBeUndefined();
    expect(outputVariables.apiKey).toBeUndefined();
    expect(outputVariables.password).toBeUndefined();
  });

  it('uses fallback safeError when no failed node has safeError', () => {
    const result = mapWorkflowResult('test-recipe', testRecipe(), {
      ...baseResult,
      status: 'FAILED',
      nodeResults: [],
    });
    expect(result.status).toBe('FAILED');
    expect(result.safeError?.code).toBe('WORKFLOW_FAILED');
    expect(result.safeError?.category).toBe('INTERNAL');
  });

  it('extracts answer content into generatedMessages', () => {
    const result = mapWorkflowResult('test-recipe', testRecipe(), {
      ...baseResult,
      nodeResults: [
        {
          nodeId: 'answer',
          nodeType: 'LLM' as never,
          status: 'NODE_COMPLETED',
          retryCount: 0,
          startedAt: new Date(),
          completedAt: new Date(),
          output: { content: 'diagnosis: power anomaly' },
        },
      ],
    });
    expect(result.generatedMessages).toHaveLength(1);
    expect(result.generatedMessages[0]).toEqual({ role: 'USER', content: 'diagnosis: power anomaly' });
  });

  it('does not extract content from non-answer nodes', () => {
    const result = mapWorkflowResult('test-recipe', testRecipe(), {
      ...baseResult,
      nodeResults: [
        {
          nodeId: 'detail',
          nodeType: 'TOOL' as never,
          status: 'NODE_COMPLETED',
          retryCount: 0,
          startedAt: new Date(),
          completedAt: new Date(),
          output: { content: 'report title' },
        },
        {
          nodeId: 'answer',
          nodeType: 'LLM' as never,
          status: 'NODE_COMPLETED',
          retryCount: 0,
          startedAt: new Date(),
          completedAt: new Date(),
        },
      ],
    });
    expect(result.generatedMessages).toHaveLength(0);
  });

  it('skips answer nodes with empty content', () => {
    const result = mapWorkflowResult('test-recipe', testRecipe(), {
      ...baseResult,
      nodeResults: [
        {
          nodeId: 'answer',
          nodeType: 'LLM' as never,
          status: 'NODE_COMPLETED',
          retryCount: 0,
          startedAt: new Date(),
          completedAt: new Date(),
          output: { content: '   ' },
        },
      ],
    });
    expect(result.generatedMessages).toHaveLength(0);
  });

  it('extracts answer content via fallback when answer node cannot be resolved', () => {
    // Recipe with multi-predecessor END: resolveSubRecipeAnswerNodeId
    // returns undefined, so the last non-gateway node with output is used.
    const fallbackRecipe: RecipeDefinition = {
      recipeName: 'test-recipe',
      version: 'v1',
      displayName: 'Test Recipe',
      flowGraph: {
        nodes: {
          start: { type: 'START', next: { 'branch-a': {}, 'branch-b': {} } },
          'branch-a': { type: 'LLM', next: { end: {} } },
          'branch-b': { type: 'LLM', next: { end: {} } },
          end: { type: 'END', next: {} },
        },
      },
    };
    const result = mapWorkflowResult('test-recipe', fallbackRecipe, {
      ...baseResult,
      nodeResults: [
        {
          nodeId: 'branch-a',
          nodeType: 'LLM' as never,
          status: 'NODE_COMPLETED',
          retryCount: 0,
          startedAt: new Date(),
          completedAt: new Date(),
          output: { content: 'branch-a result' },
        },
        {
          nodeId: 'branch-b',
          nodeType: 'LLM' as never,
          status: 'NODE_COMPLETED',
          retryCount: 0,
          startedAt: new Date(),
          completedAt: new Date(),
          output: { content: 'branch-b result' },
        },
      ],
    });
    expect(result.generatedMessages).toHaveLength(1);
    expect(result.generatedMessages[0]).toEqual({ role: 'USER', content: 'branch-b result' });
  });

  it('extracts answer content from non-LLM answer node', () => {
    // resolveSubRecipeAnswerNodeId returns the first non-gateway node
    // regardless of type. A TOOL node directly before END should be
    // resolved as the answer node just like an LLM node.
    const toolAnswerRecipe: RecipeDefinition = {
      recipeName: 'test-recipe',
      version: 'v1',
      displayName: 'Test Recipe',
      flowGraph: {
        nodes: {
          start: { type: 'START', next: { 'tool-node': {} } },
          'tool-node': { type: 'TOOL', next: { end: {} } },
          end: { type: 'END', next: {} },
        },
      },
    };
    const result = mapWorkflowResult('test-recipe', toolAnswerRecipe, {
      ...baseResult,
      nodeResults: [
        {
          nodeId: 'tool-node',
          nodeType: 'TOOL' as never,
          status: 'NODE_COMPLETED',
          retryCount: 0,
          startedAt: new Date(),
          completedAt: new Date(),
          output: { result: 'tool produced answer' },
        },
      ],
    });
    expect(result.generatedMessages).toHaveLength(1);
    expect(result.generatedMessages[0]).toEqual({ role: 'USER', content: 'tool produced answer' });
    expect(result.structuredPayload?.['answerPreviews']).toEqual(['tool produced answer']);
  });
});

function createMockContext(options: { readonly recipeName?: string } = {}) {
  return {
    identityContext: {
      tenantId: brand<string, 'TenantId'>('tenant-1'),
      subjectId: brand<string, 'SubjectId'>('subject-1'),
    },
    agentId: brand<string, 'AgentId'>('agent-1'),
    agentVersion: brand<string, 'AgentVersion'>('v1'),
    sessionId: brand<string, 'SessionId'>('session-1'),
    requestId: brand<string, 'MessageId'>('msg-1'),
    runId: brand<string, 'RequestRunId'>('run-1'),
    requestContextId: brand<string, 'RequestContextId'>('ctx-1'),
    stepId: 'step-1',
    toolCallId: 'call-1',
    timeoutMs: 30000,
    capabilityResolver: {
      resolveCapability: async (request: { readonly kind: string; readonly capabilityId: string }) => {
        if (request.kind !== 'WORKFLOW' || request.capabilityId !== options.recipeName) {
          return undefined;
        }
        return {
          capabilityId: brand<string, 'CapabilityId'>(options.recipeName),
          kind: 'WORKFLOW',
          provider: {
            providerId: brand<string, 'CapabilityProviderId'>('local-recipes'),
            providerKind: 'LOCAL_DIRECTORY',
          },
          displayName: options.recipeName,
          description: options.recipeName,
          modelInvocable: false,
          availabilityStatus: 'AVAILABLE',
        };
      },
    },
  } as never;
}
