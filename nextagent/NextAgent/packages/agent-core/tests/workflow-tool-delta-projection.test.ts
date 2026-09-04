import { brand, type JsonObject } from '@nextagent/agent-common';
import type { CapabilityDescriptor } from '@nextagent/agent-contracts/capability';
import type { AgentRunStatePort } from '@nextagent/agent-contracts/runtime';
import { describe, expect, it } from 'vitest';
import { createWorkflowToolDeltaProjectionState, tryEmitWorkflowToolDelta } from '../src/tools/workflow-tool-delta-projection.js';

describe('tryEmitWorkflowToolDelta', () => {
  it('keeps Workflow-as-Tool inner capability nodes Event-only under the outer tool call', async () => {
    const { appendedMessages, events, runState } = collectEvents();
    const startedAt = new Date('2026-07-13T00:00:00.000Z');
    const state = createWorkflowToolDeltaProjectionState();
    const base = {
      runState,
      run: {} as never,
      context: {} as never,
      descriptor: workflowDescriptor(),
      toolCallId: 'outer-workflow-call',
      state,
    };

    await tryEmitWorkflowToolDelta({
      ...base,
      structuredPayload: {
        workflowRecipe: recipeWithCapabilityProduct(),
        workflowExecutionEvent: {
          executionId: 'exec-1',
          nodeId: 'call-tool',
          nodeType: 'TOOL',
          nodeExecutionId: 'inner-node-execution-1',
          predecessorNodeExecutionIds: ['inner-start-execution'],
          eventType: 'NODE_STARTED',
          retryCount: 0,
          startedAtEpochMs: startedAt.getTime(),
          input: { tool_name: 'code', privateArgument: 'must-not-be-persisted' },
        },
      },
    });
    await tryEmitWorkflowToolDelta({
      ...base,
      structuredPayload: {
        workflowRecipe: recipeWithCapabilityProduct(),
        workflowExecutionEvent: {
          executionId: 'exec-1',
          nodeId: 'call-tool',
          nodeType: 'TOOL',
          nodeExecutionId: 'inner-node-execution-1',
          predecessorNodeExecutionIds: ['inner-start-execution'],
          eventType: 'NODE_COMPLETED',
          retryCount: 0,
          startedAtEpochMs: startedAt.getTime(),
          completedAtEpochMs: startedAt.getTime() + 1000,
          output: { level: 'detail', type: 'dsl', content: '<dsl>inner product</dsl>' },
        },
      },
    });

    expect(appendedMessages).toEqual([]);
    const started = events.find((event) => event.type === 'CAPABILITY_STARTED');
    expect(started?.inlinePayload).toEqual(
      expect.objectContaining({
        capabilityKind: 'TOOL',
        capabilityId: 'code',
        toolCallId: 'workflow:exec-1:call-tool',
        parentToolCallId: 'outer-workflow-call',
        workflowEventType: 'NODE_STARTED',
        nodeExecutionId: 'inner-node-execution-1',
        predecessorNodeExecutionIds: ['inner-start-execution'],
      }),
    );
    expectWorkflowLifecycleBodyFree(started);

    const completed = events.find((event) => event.type === 'CAPABILITY_COMPLETED');
    expect(completed?.inlinePayload).toEqual(
      expect.objectContaining({
        capabilityKind: 'TOOL',
        capabilityId: 'code',
        toolCallId: 'workflow:exec-1:call-tool',
        parentToolCallId: 'outer-workflow-call',
        workflowEventType: 'NODE_COMPLETED',
        nodeExecutionId: 'inner-node-execution-1',
        predecessorNodeExecutionIds: ['inner-start-execution'],
        status: 'SUCCEEDED',
      }),
    );
    expectWorkflowLifecycleBodyFree(completed);
    expect(events.some((event) => event.type === 'CAPABILITY_RESULT_DELTA')).toBe(false);
    expect(
      events.find((event) => event.type === 'TOOL_STRUCTURED_DELTA' && event.inlinePayload['workflowEventType'] === 'NODE_COMPLETED')?.inlinePayload,
    ).toEqual(
      expect.objectContaining({
        capabilityId: 'code',
        toolCallId: 'workflow:exec-1:call-tool',
        parentToolCallId: 'outer-workflow-call',
        workflowEventType: 'NODE_COMPLETED',
        toolEventType: 'SUB_DETAIL',
        toolMessageType: 'DSL',
        content: '<dsl>inner product</dsl>',
      }),
    );
  });

  it.each([
    ['SKILL', 'skill', { skill_name: 'network-diagnosis' }, 'network-diagnosis'],
    ['SUBFLOW', 'subflow', { recipe_name: 'alarm-recovery' }, 'alarm-recovery'],
  ] as const)('projects direct %s identity through Workflow Tool deltas', async (nodeType, nodeId, inputs, capabilityId) => {
    const { events, runState } = collectEvents();
    const startedAt = new Date('2026-07-13T00:00:00.000Z');
    const base = {
      runState,
      run: {} as never,
      context: {} as never,
      descriptor: workflowDescriptor(),
      toolCallId: 'outer-workflow-call',
      state: createWorkflowToolDeltaProjectionState(),
    };
    const workflowRecipe = {
      recipeName: 'identity-recipe',
      version: 'v1',
      flowGraph: { nodes: { [nodeId]: { type: nodeType, inputs, next: {} } } },
    };

    for (const eventType of ['NODE_STARTED', 'NODE_COMPLETED'] as const) {
      await tryEmitWorkflowToolDelta({
        ...base,
        structuredPayload: {
          workflowRecipe,
          workflowExecutionEvent: {
            executionId: 'exec-identity',
            nodeId,
            nodeType,
            nodeExecutionId: `${nodeId}-execution`,
            eventType,
            retryCount: 0,
            startedAtEpochMs: startedAt.getTime(),
            ...(eventType === 'NODE_COMPLETED' ? { completedAtEpochMs: startedAt.getTime() + 1000, output: {} } : {}),
          },
        },
      });
    }

    const capabilityKind = nodeType === 'SKILL' ? 'SKILL' : 'WORKFLOW';
    const lifecycle = events.filter((event) => event.type === 'CAPABILITY_STARTED' || event.type === 'CAPABILITY_COMPLETED');
    expect(lifecycle).toHaveLength(2);
    expect(lifecycle.map((event) => event.inlinePayload)).toEqual([
      expect.objectContaining({ capabilityKind, capabilityId }),
      expect.objectContaining({ capabilityKind, capabilityId }),
    ]);
  });

  it('projects workflow execution events through the workflow runtime projector', async () => {
    const { events, runState } = collectEvents();
    const startedAt = new Date('2026-07-13T00:00:00.000Z');
    const handled = await tryEmitWorkflowToolDelta({
      runState,
      run: {} as never,
      context: {} as never,
      descriptor: workflowDescriptor(),
      toolCallId: 'call-1',
      state: createWorkflowToolDeltaProjectionState(),
      structuredPayload: {
        workflowRecipe: recipe(),
        workflowExecutionEvent: {
          executionId: 'exec-1',
          nodeId: 'check-1',
          nodeType: 'USER_CHECK',
          eventType: 'NODE_WAITING',
          retryCount: 0,
          startedAtEpochMs: startedAt.getTime(),
        },
      },
    });

    expect(handled).toBe(true);
    // NODE_WAITING is suppressed in the projector; the real
    // USER_INPUT_REQUIRED is emitted by acceptPendingInput with
    // full questions data, not by the projector.
    expect(events).toEqual([]);
  });

  it('recognizes a recipe-backed WORKFLOW descriptor', async () => {
    const { runState } = collectEvents();
    const handled = await tryEmitWorkflowToolDelta({
      runState,
      run: {} as never,
      context: {} as never,
      descriptor: { ...workflowDescriptor(), kind: 'WORKFLOW', capabilityId: brand<string, 'CapabilityId'>('alarm-diagnosis') },
      toolCallId: 'call-1',
      state: createWorkflowToolDeltaProjectionState(),
      structuredPayload: {
        workflowRecipe: recipe(),
        workflowExecutionEvent: {
          executionId: 'exec-1',
          nodeId: 'check-1',
          nodeType: 'USER_CHECK',
          eventType: 'NODE_WAITING',
          retryCount: 0,
          startedAtEpochMs: Date.now(),
        },
      },
    });

    expect(handled).toBe(true);
  });

  it('reuses projector output-driven mapping for workflow structured deltas', async () => {
    const { events, runState } = collectEvents();
    const startedAt = new Date('2026-07-13T00:00:00.000Z');
    const state = createWorkflowToolDeltaProjectionState();
    const handled = await tryEmitWorkflowToolDelta({
      runState,
      run: {} as never,
      context: {} as never,
      descriptor: workflowDescriptor(),
      toolCallId: 'call-1',
      state,
      structuredPayload: {
        workflowRecipe: recipe(),
        workflowExecutionEvent: {
          executionId: 'exec-1',
          nodeId: 'check-1',
          nodeType: 'USER_CHECK',
          eventType: 'NODE_COMPLETED',
          retryCount: 0,
          startedAtEpochMs: startedAt.getTime(),
          completedAtEpochMs: startedAt.getTime() + 1000,
          output: { level: 'user_check', content: 'user selected option A' },
        },
      },
    });

    expect(handled).toBe(true);
    // level=user_check interaction prompt must not produce a structured
    // delta. The prompt is carried by USER_INPUT_REQUIRED via the pending
    // input bridge, not by TOOL_STRUCTURED_DELTA.
    expect(events.find((event) => event.type === 'TOOL_STRUCTURED_DELTA')).toBeUndefined();
  });

  it('keeps projector state across deltas in one tool invocation', async () => {
    const { events, runState } = collectEvents();
    const startedAt = new Date('2026-07-13T00:00:00.000Z');
    const state = createWorkflowToolDeltaProjectionState();
    const base = {
      runState,
      run: {} as never,
      context: {} as never,
      descriptor: workflowDescriptor(),
      toolCallId: 'call-1',
      state,
    };

    await tryEmitWorkflowToolDelta({
      ...base,
      structuredPayload: {
        workflowRecipe: recipeWithLlmAnswer(),
        workflowExecutionEvent: {
          executionId: 'exec-1',
          nodeId: 'answer',
          nodeType: 'LLM',
          eventType: 'NODE_OUTPUT_DELTA',
          retryCount: 0,
          startedAtEpochMs: startedAt.getTime(),
          visibleDelta: { channel: 'CONTENT', content: 'streamed answer' },
        },
      },
    });
    await tryEmitWorkflowToolDelta({
      ...base,
      structuredPayload: {
        workflowRecipe: recipeWithLlmAnswer(),
        workflowExecutionEvent: {
          executionId: 'exec-1',
          nodeId: 'answer',
          nodeType: 'LLM',
          eventType: 'NODE_COMPLETED',
          retryCount: 0,
          startedAtEpochMs: startedAt.getTime(),
          completedAtEpochMs: startedAt.getTime() + 1000,
          output: { level: 'answer', content: 'streamed answer' },
        },
      },
    });

    expect(events.find((event) => event.type === 'TOOL_STRUCTURED_DELTA')?.inlinePayload).toEqual(
      expect.objectContaining({
        toolEventType: 'SUB_CONCLUSION',
        content: 'streamed answer',
      }),
    );
  });

  it('keeps retry and loop occurrences isolated inside one Workflow-as-Tool invocation', async () => {
    const { events, runState } = collectEvents();
    const startedAt = new Date('2026-07-13T00:00:00.000Z');
    const state = createWorkflowToolDeltaProjectionState();
    const base = {
      runState,
      run: {} as never,
      context: {} as never,
      descriptor: workflowDescriptor(),
      toolCallId: 'outer-workflow-call',
      state,
    };

    for (const [nodeExecutionId, content] of [
      ['call-tool-attempt-1', 'first attempt'],
      ['call-tool-attempt-2', 'second attempt'],
    ] as const) {
      await tryEmitWorkflowToolDelta({
        ...base,
        structuredPayload: {
          workflowRecipe: recipeWithCapabilityProduct(),
          workflowExecutionEvent: {
            executionId: 'exec-1',
            nodeId: 'call-tool',
            nodeType: 'TOOL',
            nodeExecutionId,
            eventType: 'NODE_OUTPUT_DELTA',
            retryCount: nodeExecutionId.endsWith('-2') ? 1 : 0,
            startedAtEpochMs: startedAt.getTime(),
            visibleDelta: { channel: 'CONTENT', content, level: 'DETAIL' },
          },
        },
      });
    }
    await tryEmitWorkflowToolDelta({
      ...base,
      structuredPayload: {
        workflowRecipe: recipeWithCapabilityProduct(),
        workflowExecutionEvent: {
          executionId: 'exec-1',
          nodeId: 'call-tool',
          nodeType: 'TOOL',
          nodeExecutionId: 'call-tool-attempt-2',
          eventType: 'NODE_COMPLETED',
          retryCount: 1,
          startedAtEpochMs: startedAt.getTime(),
          completedAtEpochMs: startedAt.getTime() + 1000,
          output: { result: 'second attempt' },
        },
      },
    });

    const products = events.filter((event) => event.type === 'TOOL_STRUCTURED_DELTA');
    expect(products.map((event) => event.inlinePayload.nodeExecutionId)).toEqual([
      'call-tool-attempt-1',
      'call-tool-attempt-2',
      'call-tool-attempt-2',
    ]);
    expect(products.map((event) => event.inlinePayload.content)).toEqual(['first attempt', 'second attempt', 'second attempt']);
  });

  it('does not handle workflow-shaped deltas for non-Workflow capabilities', async () => {
    const { events, runState } = collectEvents();
    const handled = await tryEmitWorkflowToolDelta({
      runState,
      run: {} as never,
      context: {} as never,
      descriptor: { ...workflowDescriptor(), capabilityId: brand<string, 'CapabilityId'>('OtherTool') },
      toolCallId: 'call-1',
      state: createWorkflowToolDeltaProjectionState(),
      structuredPayload: {
        workflowRecipe: recipe(),
        workflowExecutionEvent: { startedAtEpochMs: Date.now() },
      },
    });

    expect(handled).toBe(false);
    expect(events).toEqual([]);
  });

  it('includes parentToolCallId from outer tool call in projected events', async () => {
    const { events, runState } = collectEvents();
    const startedAt = new Date('2026-07-13T00:00:00.000Z');
    const state = createWorkflowToolDeltaProjectionState();
    const handled = await tryEmitWorkflowToolDelta({
      runState,
      run: {} as never,
      context: {} as never,
      descriptor: workflowDescriptor(),
      toolCallId: 'outer-call-42',
      state,
      structuredPayload: {
        workflowRecipe: recipeWithLlmAnswer(),
        workflowExecutionEvent: {
          executionId: 'exec-1',
          nodeId: 'answer',
          nodeType: 'LLM',
          eventType: 'NODE_OUTPUT_DELTA',
          retryCount: 0,
          startedAtEpochMs: startedAt.getTime(),
          visibleDelta: { channel: 'CONTENT', content: 'fragment', level: 'ANSWER' },
        },
      },
    });

    expect(handled).toBe(true);
    const structured = events.find((event) => event.type === 'TOOL_STRUCTURED_DELTA');
    expect(structured).toBeDefined();
    expect(structured?.inlinePayload?.parentToolCallId).toBe('outer-call-42');
  });
});

function collectEvents(): {
  readonly events: Array<{ readonly type: string; readonly inlinePayload: JsonObject }>;
  readonly appendedMessages: unknown[];
  readonly runState: AgentRunStatePort;
} {
  const events: Array<{ readonly type: string; readonly inlinePayload: JsonObject }> = [];
  const appendedMessages: unknown[] = [];
  return {
    events,
    appendedMessages,
    runState: {
      async setCapabilityTerminalAnswer(): Promise<void> {},
      async emitEvent(_run, _context, event) {
        events.push(event as { readonly type: string; readonly inlinePayload: JsonObject });
      },
      async appendMessage(_run, _context, draft) {
        appendedMessages.push(draft);
        return brand<string, 'MessageId'>('msg-1');
      },
      async saveCheckpoint() {},
      async requestPendingInput() {
        throw new Error('not expected');
      },
    },
  };
}

function expectWorkflowLifecycleBodyFree(event?: { readonly inlinePayload: JsonObject }): void {
  expect(event).toBeDefined();
  for (const field of ['messageId', 'description', 'input', 'output', 'arguments', 'result', 'safeResult', 'structuredPayload']) {
    expect(event?.inlinePayload).not.toHaveProperty(field);
  }
}

function recipe(): JsonObject {
  return {
    recipeName: 'test',
    version: 'v1',
    flowGraph: {
      nodes: {
        start: { id: 'start', type: 'START', next: { 'check-1': {} } },
        'check-1': { id: 'check-1', type: 'USER_CHECK', next: {} },
      },
    },
  };
}

function recipeWithLlmAnswer(): JsonObject {
  return {
    recipeName: 'test',
    version: 'v1',
    flowGraph: {
      nodes: {
        start: { id: 'start', type: 'START', next: { answer: {} } },
        answer: { id: 'answer', type: 'LLM', next: {} },
      },
    },
  };
}

function recipeWithCapabilityProduct(): JsonObject {
  return {
    recipeName: 'test',
    version: 'v1',
    flowGraph: {
      nodes: {
        start: { id: 'start', type: 'START', next: { 'call-tool': {} } },
        'call-tool': {
          id: 'call-tool',
          type: 'TOOL',
          description: 'Execute inner tool',
          inputs: { tool_name: 'code' },
          next: { end: {} },
        },
        end: { id: 'end', type: 'END', next: {} },
      },
    },
  };
}

function workflowDescriptor(): CapabilityDescriptor {
  return {
    capabilityId: brand<string, 'CapabilityId'>('Workflow'),
    kind: 'TOOL',
    displayName: 'Workflow',
    description: 'Execute workflow',
    provider: { providerId: 'builtin', providerKind: 'BUNDLED' },
    inputSchema: { type: 'object' },
    outputSchema: { type: 'object' },
    version: '1.0.0',
    availabilityStatus: 'AVAILABLE',
  } as CapabilityDescriptor;
}
