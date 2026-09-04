import { brand, type JsonObject } from '@nextagent/agent-common';
import type { CapabilityInvocationResult } from '@nextagent/agent-contracts/capability';
import type {
  WorkflowExecutionEvent,
  WorkflowExecutionRequest,
  WorkflowExecutionResult,
  WorkflowExecutionService,
} from '@nextagent/agent-contracts/core';
import { describe, expect, it } from 'vitest';
import { createWorkflowToolPort, mapWorkflowResult } from '../src/workflow-tool-port.js';

describe('workflow tool port observer', () => {
  it('emits JSON-safe workflow execution events with the recipe snapshot', async () => {
    const emitted: JsonObject[] = [];
    const startedAt = new Date('2026-07-13T00:00:00.000Z');
    const completedAt = new Date('2026-07-13T00:00:01.000Z');
    const port = createWorkflowToolPort({
      resolveRecipeDefinition: () => recipe(),
      workflowExecutionService: mockService({
        executionId: 'exec-1',
        status: 'COMPLETED',
        outputVariables: {},
        nodeResults: [],
        startedAt,
        completedAt,
        _testEvents: [
          {
            executionId: 'exec-1',
            nodeId: 'check-1',
            nodeType: 'USER_CHECK',
            eventType: 'NODE_COMPLETED',
            output: { level: 'user_check', content: 'user selected option A' },
            retryCount: 0,
            startedAt,
            completedAt,
          },
        ],
      } as never),
    });

    await port.execute({
      recipeName: 'test',
      inputVariables: {},
      context: mockContext(async (payload) => {
        emitted.push(payload);
      }),
      signal: new AbortController().signal,
    });

    expect(emitted).toHaveLength(1);
    expect(emitted[0]).toEqual({
      workflowRecipe: recipe(),
      workflowExecutionEvent: {
        executionId: 'exec-1',
        nodeId: 'check-1',
        nodeType: 'USER_CHECK',
        eventType: 'NODE_COMPLETED',
        retryCount: 0,
        startedAtEpochMs: startedAt.getTime(),
        completedAtEpochMs: completedAt.getTime(),
        output: { level: 'user_check', content: 'user selected option A' },
      },
    });
  });

  it('emits visible delta as part of the original workflow execution event', async () => {
    const emitted: JsonObject[] = [];
    const startedAt = new Date('2026-07-13T00:00:00.000Z');
    const port = createWorkflowToolPort({
      resolveRecipeDefinition: () => recipe(),
      workflowExecutionService: mockService({
        executionId: 'exec-1',
        status: 'COMPLETED',
        outputVariables: {},
        nodeResults: [],
        startedAt,
        completedAt: startedAt,
        _testEvents: [
          {
            executionId: 'exec-1',
            nodeId: 'llm-1',
            nodeType: 'LLM',
            eventType: 'NODE_OUTPUT_DELTA',
            visibleDelta: { channel: 'CONTENT', content: 'hello ' },
            retryCount: 0,
            startedAt,
          },
        ],
      } as never),
    });

    await port.execute({
      recipeName: 'test',
      inputVariables: {},
      context: mockContext(async (payload) => {
        emitted.push(payload);
      }),
      signal: new AbortController().signal,
    });

    expect((emitted[0]?.['workflowExecutionEvent'] as JsonObject)['visibleDelta']).toEqual({
      channel: 'CONTENT',
      content: 'hello ',
    });
  });
});

describe('workflow tool port answer extraction', () => {
  it('exposes only the declared safe workflow metadata facts', async () => {
    const startedAt = new Date('2026-07-13T00:00:00.000Z');
    const completedAt = new Date('2026-07-13T00:00:01.000Z');
    const port = createWorkflowToolPort({
      resolveRecipeDefinition: () => recipe(),
      workflowExecutionService: mockService({
        executionId: 'exec-safe-metadata',
        status: 'COMPLETED',
        outputVariables: {},
        nodeResults: [],
        startedAt,
        completedAt,
      }),
    });

    const result = await port.execute({
      recipeName: 'test',
      inputVariables: {},
      context: mockContext(),
      signal: new AbortController().signal,
    });

    expect(result.metadata).toEqual({ executionId: 'exec-safe-metadata', nodeResultCount: 0 });
    expect(result.metadata).not.toHaveProperty('durationMs');
  });

  it('omits workflow metadata when the execution exposes neither declared fact', () => {
    const startedAt = new Date('2026-07-13T00:00:00.000Z');

    const result = mapWorkflowResult('test', recipe(), {
      status: 'COMPLETED',
      outputVariables: {},
      startedAt,
      completedAt: startedAt,
    });

    expect(result.metadata).toBeUndefined();
  });

  it('recognizes uppercase ANSWER level in answer previews', async () => {
    const startedAt = new Date('2026-07-13T00:00:00.000Z');
    const port = createWorkflowToolPort({
      resolveRecipeDefinition: () => recipe(),
      workflowExecutionService: mockService({
        executionId: 'exec-1',
        status: 'COMPLETED',
        outputVariables: {},
        nodeResults: [
          {
            nodeId: 'llm-1',
            nodeType: 'LLM',
            status: 'NODE_COMPLETED',
            output: { content: 'final answer' },
            retryCount: 0,
            startedAt,
            completedAt: startedAt,
          },
        ],
        startedAt,
        completedAt: startedAt,
      } as never),
    });

    const result = await port.execute({
      recipeName: 'test',
      inputVariables: {},
      context: mockContext(),
      signal: new AbortController().signal,
    });

    expect(result.structuredPayload?.['answerPreviews']).toEqual(['final answer']);
  });

  it('recognizes lowercase answer level in answer previews', async () => {
    const startedAt = new Date('2026-07-13T00:00:00.000Z');
    const port = createWorkflowToolPort({
      resolveRecipeDefinition: () => recipe(),
      workflowExecutionService: mockService({
        executionId: 'exec-1',
        status: 'COMPLETED',
        outputVariables: {},
        nodeResults: [
          {
            nodeId: 'llm-1',
            nodeType: 'LLM',
            status: 'NODE_COMPLETED',
            output: { content: 'final answer' },
            retryCount: 0,
            startedAt,
            completedAt: startedAt,
          },
        ],
        startedAt,
        completedAt: startedAt,
      } as never),
    });

    const result = await port.execute({
      recipeName: 'test',
      inputVariables: {},
      context: mockContext(),
      signal: new AbortController().signal,
    });

    expect(result.structuredPayload?.['answerPreviews']).toEqual(['final answer']);
  });

  it('does not pick up detail nodes when answer node is resolved but has no output', async () => {
    const startedAt = new Date('2026-07-13T00:00:00.000Z');
    const port = createWorkflowToolPort({
      resolveRecipeDefinition: () => recipe(),
      workflowExecutionService: mockService({
        executionId: 'exec-1',
        status: 'COMPLETED',
        outputVariables: {},
        nodeResults: [
          {
            nodeId: 'detail-1',
            nodeType: 'LLM',
            status: 'NODE_COMPLETED',
            output: { content: 'not an answer' },
            retryCount: 0,
            startedAt,
            completedAt: startedAt,
          },
        ],
        startedAt,
        completedAt: startedAt,
      } as never),
    });

    const result = await port.execute({
      recipeName: 'test',
      inputVariables: {},
      context: mockContext(),
      signal: new AbortController().signal,
    });

    expect(result.structuredPayload?.['answerPreviews']).toEqual([]);
  });
});

describe('workflow tool port WAITING projection', () => {
  it('fails safely with an empty payload when WAITING has no usable pending context', async () => {
    const result = await executeWaiting({ nodeResults: [] });

    expect(result).toMatchObject({
      status: 'FAILED',
      structuredPayload: {},
      safeError: { code: 'CAPABILITY_EXECUTION_FAILED', category: 'INTERNAL', retryable: false },
    });
    expect(result.safeError?.message).toContain('Stop this workflow action and report the error.');
  });

  it('fails safely when WAITING pending input is malformed and there are no answer previews', async () => {
    const result = await executeWaiting({
      pendingInput: { kind: 'QUESTION', questions: [{ prompt: '', options: [] }] },
      nodeResults: [],
    });

    expect(result).toMatchObject({
      status: 'FAILED',
      structuredPayload: {},
      safeError: { code: 'CAPABILITY_EXECUTION_FAILED', category: 'INTERNAL', retryable: false },
    });
  });

  it('fails safely when pendingInput kind is not a valid pending input kind', async () => {
    const result = await executeWaiting({
      pendingInput: {
        id: 'pending-invalid-kind',
        sessionId: 'session-invalid-kind',
        kind: 'USER_CHECK',
        questions: [
          {
            prompt: 'Select action',
            options: [
              { label: 'restart', value: 'restart' },
              { label: 'escalate', value: 'escalate' },
            ],
          },
        ],
      } as JsonObject,
      nodeResults: [],
    });

    expect(result).toMatchObject({
      status: 'FAILED',
      structuredPayload: {},
      safeError: { code: 'CAPABILITY_EXECUTION_FAILED', category: 'INTERNAL', retryable: false },
    });
  });

  it('returns SUCCEEDED with answer previews and omits missing pending input', async () => {
    const now = new Date('2026-07-13T00:00:00.000Z');
    const result = await executeWaiting({
      nodeResults: [
        {
          nodeId: 'answer-1',
          nodeType: 'LLM',
          status: 'NODE_COMPLETED',
          output: { level: 'ANSWER', content: 'Use the verified fallback route.' },
          retryCount: 0,
          startedAt: now,
          completedAt: now,
        },
      ],
    });

    expect(result).toMatchObject({
      status: 'SUCCEEDED',
      structuredPayload: {
        recipeName: 'test',
        status: 'waiting',
        answerPreviews: ['Use the verified fallback route.'],
      },
    });
    expect(result.structuredPayload).not.toHaveProperty('pendingInput');
    expect(result.safeError).toBeUndefined();
  });

  it('returns SUCCEEDED with valid pending input and preserves questions', async () => {
    const result = await executeWaiting({
      pendingInput: {
        id: 'pending-valid',
        sessionId: 'session-valid',
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
      nodeResults: [],
    });

    expect(result).toMatchObject({
      status: 'SUCCEEDED',
    });
    expect(result.safeError).toBeUndefined();
    const pendingInput = result.structuredPayload.pendingInput as JsonObject;
    expect(pendingInput.kind).toBe('QUESTION');
    expect(Array.isArray(pendingInput.questions)).toBe(true);
  });

  it('returns SUCCEEDED with both pending questions and answer previews', async () => {
    const now = new Date('2026-07-13T00:00:00.000Z');
    const result = await executeWaiting({
      pendingInput: {
        id: 'pending-both',
        sessionId: 'session-both',
        kind: 'CONFIRMATION',
        questions: [
          {
            prompt: 'Confirm restart?',
            options: [{ label: 'yes', value: 'yes' }],
          },
        ],
      } as JsonObject,
      nodeResults: [
        {
          nodeId: 'answer-1',
          nodeType: 'LLM',
          status: 'NODE_COMPLETED',
          output: { level: 'ANSWER', content: 'Partial diagnosis available.' },
          retryCount: 0,
          startedAt: now,
          completedAt: now,
        },
      ],
    });

    expect(result.status).toBe('SUCCEEDED');
    expect(result.safeError).toBeUndefined();
    expect(result.structuredPayload.pendingInput).toBeDefined();
    const previews = result.structuredPayload.answerPreviews as readonly string[];
    expect(previews).toHaveLength(1);
  });
});

function mockService(result: Partial<WorkflowExecutionResult> & { readonly _testEvents?: readonly unknown[] }): WorkflowExecutionService {
  return {
    execute: async (
      _request: WorkflowExecutionRequest,
      _signal: AbortSignal,
      observer?: { emitEvent: (event: WorkflowExecutionEvent) => Promise<void> | void },
    ) => {
      if (observer !== undefined) {
        for (const evt of result._testEvents ?? []) {
          await observer.emitEvent(evt as WorkflowExecutionEvent);
        }
      }
      return result as WorkflowExecutionResult;
    },
  } as never;
}

function mockContext(emitResultDelta?: (payload: JsonObject) => Promise<void>) {
  return {
    identityContext: { tenantId: brand<string, 'TenantId'>('t1'), subjectId: brand<string, 'SubjectId'>('s1') },
    agentId: brand<string, 'AgentId'>('agent-1'),
    agentVersion: brand<string, 'AgentVersion'>('v1'),
    sessionId: brand<string, 'SessionId'>('sess-1'),
    requestId: brand<string, 'MessageId'>('msg-1'),
    runId: brand<string, 'RequestRunId'>('run-1'),
    requestContextId: brand<string, 'RequestContextId'>('ctx-1'),
    emitResultDelta,
  } as never;
}

async function executeWaiting(
  overrides: Pick<WorkflowExecutionResult, 'nodeResults'> & Partial<Pick<WorkflowExecutionResult, 'pendingInput'>>,
): Promise<CapabilityInvocationResult> {
  const now = new Date('2026-07-13T00:00:00.000Z');
  const port = createWorkflowToolPort({
    resolveRecipeDefinition: () => recipe(),
    workflowExecutionService: mockService({
      executionId: 'exec-waiting',
      status: 'WAITING',
      outputVariables: {},
      startedAt: now,
      completedAt: now,
      ...overrides,
    }),
  });
  return port.execute({
    recipeName: 'test',
    inputVariables: {},
    context: mockContext(),
    signal: new AbortController().signal,
  });
}

function recipe() {
  return {
    recipeName: 'test',
    version: 'v1',
    flowGraph: {
      nodes: {
        start: { id: 'start', type: 'START', next: { 'check-1': {} } },
        'check-1': { id: 'check-1', type: 'USER_CHECK', next: { 'llm-1': {} } },
        'llm-1': { id: 'llm-1', type: 'LLM', next: { end: {} } },
        end: { id: 'end', type: 'END', next: {} },
      },
    },
  } as never;
}
