import { describe, expect, it } from 'vitest';

import { WorkflowRuntimeEventProjector } from '../src/agent/workflow-runtime-event-projector.js';
import type { RecipeDefinition, WorkflowExecutionEvent } from '@nextagent/agent-contracts/core';
import type { RunTimelineEvent } from '@nextagent/agent-contracts/runtime';

describe('workflow runtime event projector', () => {
  it.each([
    ['tool', 'TOOL', 'Read', 'TOOL'],
    ['skill', 'SKILL', 'network-diagnosis', 'SKILL'],
    ['agent', 'AGENT', 'network-agent', 'AGENT'],
    ['subflow', 'SUBFLOW', 'alarm-recovery', 'WORKFLOW'],
    ['restful', 'RESTFUL', 'network-stream', 'TOOL'],
  ] as const)('projects direct %s node identity', (nodeId, nodeType, capabilityId, capabilityKind) => {
    const projector = new WorkflowRuntimeEventProjector(identityRecipe());
    const eventIdentity = { nodeId, nodeType, nodeExecutionId: `${nodeId}-execution` };
    const projected = [
      ...projector.project(event({ ...eventIdentity, eventType: 'NODE_STARTED' })),
      ...projector.project(event({ ...eventIdentity, eventType: 'NODE_COMPLETED', output: {}, completedAt: new Date('2026-06-24T00:00:01.000Z') })),
    ].filter((item) => item.type === 'CAPABILITY_STARTED' || item.type === 'CAPABILITY_COMPLETED');

    expect(projected).toHaveLength(2);
    for (const item of projected) {
      expect(item.inlinePayload).toMatchObject({ capabilityKind, capabilityId });
      expect(item.inlinePayload).not.toHaveProperty('targetCapabilityId');
    }
  });

  it('does not fabricate capability kind for a non-capability workflow node', () => {
    const projector = new WorkflowRuntimeEventProjector(identityRecipe());
    const projected = projector.project(
      event({ nodeId: 'condition', nodeType: 'CONDITION', nodeExecutionId: 'condition-execution', eventType: 'NODE_STARTED' }),
    );

    expect(projected).toHaveLength(1);
    expect(projected[0]?.inlinePayload).not.toHaveProperty('capabilityKind');
  });

  it('accumulates workflow visible content and thinking onto the runtime delta path', () => {
    const projector = new WorkflowRuntimeEventProjector(recipe());

    const thinking = projector.project(
      event({ nodeId: 'askModel', nodeType: 'LLM', eventType: 'NODE_OUTPUT_DELTA', visibleDelta: { channel: 'THINKING', content: 'planning' } }),
    );
    const contentA = projector.project(
      event({ nodeId: 'askModel', nodeType: 'LLM', eventType: 'NODE_OUTPUT_DELTA', visibleDelta: { channel: 'CONTENT', content: 'hello ' } }),
    );
    const contentB = projector.project(
      event({ nodeId: 'askModel', nodeType: 'LLM', eventType: 'NODE_OUTPUT_DELTA', visibleDelta: { channel: 'CONTENT', content: 'world' } }),
    );

    expect(thinking).toEqual([
      expect.objectContaining({
        type: 'LLM_THINKING_DELTA',
        inlinePayload: expect.objectContaining({ reasoning: 'planning' }),
      }),
    ]);
    expect(contentA).toEqual([
      expect.objectContaining({
        type: 'LLM_CONTENT_DELTA',
        inlinePayload: expect.objectContaining({ content: 'hello ' }),
      }),
    ]);
    expect(contentB).toEqual([
      expect.objectContaining({
        type: 'LLM_CONTENT_DELTA',
        inlinePayload: expect.objectContaining({ content: 'hello world' }),
      }),
    ]);
  });

  it('keeps LLM visible buffers isolated per workflow node', () => {
    const projector = new WorkflowRuntimeEventProjector(recipe());

    const nodeAFirst = projector.project(
      event({ nodeId: 'askModelA', nodeType: 'LLM', eventType: 'NODE_OUTPUT_DELTA', visibleDelta: { channel: 'CONTENT', content: 'alpha ' } }),
    );
    const nodeBFirst = projector.project(
      event({ nodeId: 'askModelB', nodeType: 'LLM', eventType: 'NODE_OUTPUT_DELTA', visibleDelta: { channel: 'CONTENT', content: 'beta ' } }),
    );
    const nodeASecond = projector.project(
      event({ nodeId: 'askModelA', nodeType: 'LLM', eventType: 'NODE_OUTPUT_DELTA', visibleDelta: { channel: 'CONTENT', content: 'done' } }),
    );

    expect(nodeAFirst[0]?.inlinePayload).toEqual(expect.objectContaining({ content: 'alpha ', stepId: 'workflow:workflow-execution:askModelA' }));
    expect(nodeBFirst[0]?.inlinePayload).toEqual(expect.objectContaining({ content: 'beta ', stepId: 'workflow:workflow-execution:askModelB' }));
    expect(nodeASecond[0]?.inlinePayload).toEqual(
      expect.objectContaining({ content: 'alpha done', stepId: 'workflow:workflow-execution:askModelA' }),
    );
  });

  it('keeps LLM visible buffers isolated per workflow node execution occurrence', () => {
    const projector = new WorkflowRuntimeEventProjector(recipe());

    const firstAttempt = projector.project(
      event({
        nodeId: 'askModel',
        nodeType: 'LLM',
        nodeExecutionId: 'ask-model-attempt-1',
        eventType: 'NODE_OUTPUT_DELTA',
        visibleDelta: { channel: 'CONTENT', content: 'first attempt' },
      }),
    );
    const secondAttempt = projector.project(
      event({
        nodeId: 'askModel',
        nodeType: 'LLM',
        nodeExecutionId: 'ask-model-attempt-2',
        eventType: 'NODE_OUTPUT_DELTA',
        visibleDelta: { channel: 'CONTENT', content: 'second attempt' },
      }),
    );
    const completedSecondAttempt = projector.project(
      event({
        nodeId: 'askModel',
        nodeType: 'LLM',
        nodeExecutionId: 'ask-model-attempt-2',
        eventType: 'NODE_COMPLETED',
        output: { level: 'detail', content: 'second attempt' },
        completedAt: new Date('2026-06-24T00:00:01.000Z'),
      }),
    );

    expect(firstAttempt[0]?.inlinePayload).toEqual(
      expect.objectContaining({
        content: 'first attempt',
        stepId: 'workflow:workflow-execution:askModel:ask-model-attempt-1',
      }),
    );
    expect(secondAttempt[0]?.inlinePayload).toEqual(
      expect.objectContaining({
        content: 'second attempt',
        stepId: 'workflow:workflow-execution:askModel:ask-model-attempt-2',
      }),
    );
    expect(completedSecondAttempt.find((projected) => projected.type === 'TOOL_STRUCTURED_DELTA')?.inlinePayload).toEqual(
      expect.objectContaining({ nodeExecutionId: 'ask-model-attempt-2', content: 'second attempt' }),
    );
  });

  it.each(['NODE_COMPLETED', 'NODE_FAILED', 'NODE_SKIPPED'] as const)(
    'does not infer model thinking completion from workflow LLM %s',
    (eventType) => {
      const projector = new WorkflowRuntimeEventProjector(recipe());
      projector.project(
        event({
          nodeId: 'askModel',
          nodeType: 'LLM',
          eventType: 'NODE_OUTPUT_DELTA',
          visibleDelta: { channel: 'THINKING', content: 'checking ' },
        }),
      );
      projector.project(
        event({
          nodeId: 'askModel',
          nodeType: 'LLM',
          eventType: 'NODE_OUTPUT_DELTA',
          visibleDelta: { channel: 'THINKING', content: 'routes' },
        }),
      );

      const terminal = projector.project(
        event({
          nodeId: 'askModel',
          nodeType: 'LLM',
          eventType,
          completedAt: new Date('2026-06-24T00:00:01.000Z'),
          ...(eventType === 'NODE_FAILED'
            ? { safeError: { code: 'WORKFLOW_LLM_FAILED', category: 'INTERNAL', message: 'safe', retryable: false } }
            : {}),
        }),
      );

      expect(terminal.filter((projected) => projected.type === 'LLM_THINKING_DELTA')).toHaveLength(0);
    },
  );

  it('does not infer completed thinking from a workflow terminal with empty reasoning', () => {
    const projector = new WorkflowRuntimeEventProjector(recipe());
    projector.project(
      event({
        nodeId: 'askModel',
        nodeType: 'LLM',
        eventType: 'NODE_OUTPUT_DELTA',
        visibleDelta: { channel: 'THINKING', content: '   ' },
      }),
    );

    const completed = projector.project(
      event({
        nodeId: 'askModel',
        nodeType: 'LLM',
        eventType: 'NODE_COMPLETED',
        completedAt: new Date('2026-06-24T00:00:01.000Z'),
      }),
    );

    expect(completed.some((projected) => projected.type === 'LLM_THINKING_DELTA')).toBe(false);
  });

  it('projects display nodes onto the visible content stream path', () => {
    const projector = new WorkflowRuntimeEventProjector(recipe());

    const projected = projector.project(
      event({
        nodeId: 'showMessage',
        nodeType: 'DISPLAY',
        eventType: 'NODE_OUTPUT_DELTA',
        visibleDelta: { channel: 'CONTENT', content: 'safe markdown' },
      }),
    );

    expect(projected[0]?.inlinePayload).toEqual(
      expect.objectContaining({ content: 'safe markdown', stepId: 'workflow:workflow-execution:showMessage' }),
    );
  });

  it.each([
    {
      nodeId: 'callTool',
      nodeType: 'TOOL' as const,
      capabilityId: 'code',
      input: { tool_name: 'code' },
      output: { level: 'detail', type: 'text', content: 'tool result' },
    },
    {
      nodeId: 'callSkill',
      nodeType: 'SKILL' as const,
      capabilityId: 'alarm-diagnosis',
      input: { skill_name: 'alarm-diagnosis' },
      output: { level: 'detail', type: 'dsl', content: '<dsl>skill result</dsl>' },
    },
    {
      nodeId: 'callSubflow',
      nodeType: 'SUBFLOW' as const,
      capabilityId: 'child-flow',
      input: { recipe_name: 'child-flow' },
      output: { level: 'detail', type: 'piu', content: { kind: 'subflow-result' } },
    },
  ])(
    'keeps inner $nodeType lifecycle body-free and emits product only through structured events',
    ({ nodeId, nodeType, capabilityId, input, output }) => {
      const projector = new WorkflowRuntimeEventProjector(recipeWithCapabilityNodes());
      const toolCallId = `workflow:workflow-execution:${nodeId}`;
      const started = projector.project(
        event({
          nodeId,
          nodeType,
          nodeExecutionId: `${nodeId}-execution`,
          predecessorNodeExecutionIds: ['previous-execution'],
          eventType: 'NODE_STARTED',
          input,
        }),
      );
      const completed = projector.project(
        event({
          nodeId,
          nodeType,
          nodeExecutionId: `${nodeId}-execution`,
          predecessorNodeExecutionIds: ['previous-execution'],
          eventType: 'NODE_COMPLETED',
          output,
          completedAt: new Date('2026-06-24T00:00:01.000Z'),
        }),
      );

      const startedLifecycle = started.find((projected) => projected.type === 'CAPABILITY_STARTED');
      expect(startedLifecycle).toEqual(
        expect.objectContaining({
          type: 'CAPABILITY_STARTED',
          inlinePayload: expect.objectContaining({
            capabilityId,
            toolCallId,
            workflowEventType: 'NODE_STARTED',
            nodeId,
            nodeType,
            nodeExecutionId: `${nodeId}-execution`,
            predecessorNodeExecutionIds: ['previous-execution'],
          }),
        }),
      );
      expectWorkflowLifecycleBodyFree(startedLifecycle);

      const completedLifecycle = completed.find((projected) => projected.type === 'CAPABILITY_COMPLETED');
      expect(completedLifecycle).toEqual(
        expect.objectContaining({
          type: 'CAPABILITY_COMPLETED',
          inlinePayload: expect.objectContaining({
            capabilityId,
            toolCallId,
            status: 'SUCCEEDED',
            durationMs: 1000,
            workflowEventType: 'NODE_COMPLETED',
            nodeId,
            nodeType,
            nodeExecutionId: `${nodeId}-execution`,
            predecessorNodeExecutionIds: ['previous-execution'],
          }),
        }),
      );
      expectWorkflowLifecycleBodyFree(completedLifecycle);
      expect(completed.some((projected) => projected.type === 'CAPABILITY_RESULT_DELTA')).toBe(false);

      expect(completed.find((projected) => projected.type === 'TOOL_STRUCTURED_DELTA')).toEqual(
        expect.objectContaining({
          inlinePayload: expect.objectContaining({
            capabilityId,
            toolCallId,
            workflowEventType: 'NODE_COMPLETED',
            toolEventType: 'DETAIL',
            content: output.content,
          }),
        }),
      );
    },
  );

  it('projects start_event as CAPABILITY_STARTED without input/output', () => {
    const projector = new WorkflowRuntimeEventProjector(recipe());

    const started = projector.project(event({ nodeId: 'start', nodeType: 'START', eventType: 'NODE_STARTED' }));
    const completed = projector.project(
      event({ nodeId: 'start', nodeType: 'START', eventType: 'NODE_COMPLETED', completedAt: new Date('2026-06-24T00:00:01.000Z') }),
    );

    expect(started).toEqual([]);
    expect(completed).toEqual([]);
  });

  it('projects end_event as CAPABILITY_COMPLETED not REQUEST_COMPLETED', () => {
    const projector = new WorkflowRuntimeEventProjector(recipe());

    const completed = projector.project(
      event({ nodeId: 'end', nodeType: 'END', eventType: 'NODE_COMPLETED', completedAt: new Date('2026-06-24T00:00:01.000Z') }),
    );

    expect(completed).toEqual([]);
  });

  it('projects condition nodes as real execution nodes', () => {
    const projector = new WorkflowRuntimeEventProjector(recipe());

    const started = projector.project(event({ nodeId: 'gateway', nodeType: 'CONDITION', eventType: 'NODE_STARTED' }));
    const completed = projector.project(
      event({ nodeId: 'gateway', nodeType: 'CONDITION', eventType: 'NODE_COMPLETED', completedAt: new Date('2026-06-24T00:00:01.000Z') }),
    );

    expect(started).toEqual([
      expect.objectContaining({
        type: 'CAPABILITY_STARTED',
        inlinePayload: expect.objectContaining({
          workflowEventType: 'NODE_STARTED',
          nodeId: 'gateway',
          nodeType: 'CONDITION',
        }),
      }),
    ]);
    expect(completed).toEqual([
      expect.objectContaining({
        type: 'CAPABILITY_COMPLETED',
        inlinePayload: expect.objectContaining({
          workflowEventType: 'NODE_COMPLETED',
          nodeId: 'gateway',
          nodeType: 'CONDITION',
          status: 'SUCCEEDED',
        }),
      }),
    ]);
  });

  it('projects RESTFUL as capability-like with api_name identity and live result delta', () => {
    const projector = new WorkflowRuntimeEventProjector(recipeWithDescription());

    const started = projector.project(
      event({ nodeId: 'callApi', nodeType: 'RESTFUL', eventType: 'NODE_STARTED', input: { api_name: 'queryDevice' } }),
    );
    const completed = projector.project(
      event({
        nodeId: 'callApi',
        nodeType: 'RESTFUL',
        eventType: 'NODE_COMPLETED',
        output: { result: 'ok' },
        completedAt: new Date('2026-06-24T00:00:01.000Z'),
      }),
    );

    expect(started[0]?.type).toBe('CAPABILITY_STARTED');
    expect(started[0]?.inlinePayload).toEqual(
      expect.objectContaining({
        capabilityKind: 'TOOL',
        capabilityId: 'callApi',
        toolCallId: 'workflow:workflow-execution:callApi',
        workflowEventType: 'NODE_STARTED',
        nodeId: 'callApi',
        nodeType: 'RESTFUL',
      }),
    );
    expectWorkflowLifecycleBodyFree(started[0]);
    const resultDelta = completed.find((projected) => projected.type === 'CAPABILITY_RESULT_DELTA');
    expect(resultDelta?.persistence).toBe('LIVE_ONLY');
    expect(resultDelta?.inlinePayload).toEqual(
      expect.objectContaining({
        capabilityId: 'callApi',
        toolCallId: 'workflow:workflow-execution:callApi',
        workflowEventType: 'NODE_COMPLETED',
        result: { result: 'ok' },
      }),
    );
    const lifecycle = completed.find((projected) => projected.type === 'CAPABILITY_COMPLETED');
    expect(lifecycle?.inlinePayload).toEqual(
      expect.objectContaining({
        capabilityId: 'callApi',
        toolCallId: 'workflow:workflow-execution:callApi',
        workflowEventType: 'NODE_COMPLETED',
        status: 'SUCCEEDED',
      }),
    );
    expectWorkflowLifecycleBodyFree(lifecycle);
    expect(completed.find((projected) => projected.type === 'TOOL_STRUCTURED_DELTA')).toEqual(
      expect.objectContaining({
        inlinePayload: expect.objectContaining({
          capabilityId: 'callApi',
          toolCallId: 'workflow:workflow-execution:callApi',
          toolEventType: 'DETAIL',
          content: 'ok',
        }),
      }),
    );
  });

  it('projects RESTFUL SSE stream deltas as accumulated TOOL_STRUCTURED_DELTA with api_name identity', () => {
    const projector = new WorkflowRuntimeEventProjector(recipeWithRestfulApiName());

    const first = projector.project(
      event({
        nodeId: 'callApi',
        nodeType: 'RESTFUL',
        eventType: 'NODE_OUTPUT_DELTA',
        visibleDelta: { channel: 'DSL', content: '{"event":"a"}\n', level: 'DETAIL' },
      }),
    );
    const second = projector.project(
      event({
        nodeId: 'callApi',
        nodeType: 'RESTFUL',
        eventType: 'NODE_OUTPUT_DELTA',
        visibleDelta: { channel: 'DSL', content: '{"event":"b"}\n', level: 'DETAIL' },
      }),
    );

    expect(first).toHaveLength(1);
    expect(first[0]?.type).toBe('TOOL_STRUCTURED_DELTA');
    expect(first[0]?.inlinePayload).toEqual(
      expect.objectContaining({
        capabilityId: 'queryDevice',
        toolCallId: 'workflow:workflow-execution:callApi',
        toolEventType: 'DETAIL',
        toolMessageType: 'DSL',
        content: '{"event":"a"}\n',
        accumulated: true,
        workflowEventType: 'NODE_OUTPUT_DELTA',
      }),
    );
    expect(second[0]?.inlinePayload).toEqual(expect.objectContaining({ content: '{"event":"a"}\n{"event":"b"}\n' }));
  });

  it('emits RESTFUL CAPABILITY_RESULT_DELTA with api_name identity at NODE_COMPLETED', () => {
    const projector = new WorkflowRuntimeEventProjector(recipeWithRestfulApiName());

    const completed = projector.project(
      event({
        nodeId: 'callApi',
        nodeType: 'RESTFUL',
        eventType: 'NODE_COMPLETED',
        output: { api_response: { events: [], completion: { reason: 'eof', event_count: 0 } } },
        completedAt: new Date('2026-06-24T00:00:01.000Z'),
      }),
    );

    const resultDelta = completed.find((projected) => projected.type === 'CAPABILITY_RESULT_DELTA');
    expect(resultDelta?.persistence).toBe('LIVE_ONLY');
    expect(resultDelta?.inlinePayload).toEqual(
      expect.objectContaining({
        capabilityId: 'queryDevice',
        toolCallId: 'workflow:workflow-execution:callApi',
        result: { api_response: { events: [], completion: { reason: 'eof', event_count: 0 } } },
      }),
    );
    expect(completed.find((projected) => projected.type === 'CAPABILITY_COMPLETED')?.inlinePayload).toEqual(
      expect.objectContaining({
        capabilityId: 'queryDevice',
        status: 'SUCCEEDED',
      }),
    );
  });

  it('suppresses user-check NODE_WAITING to avoid duplicate USER_INPUT_REQUIRED', () => {
    const projector = new WorkflowRuntimeEventProjector(recipe());

    const waiting = projector.project(event({ nodeId: 'askUser', nodeType: 'USER_CHECK', eventType: 'NODE_WAITING' }));

    // NODE_WAITING must not emit USER_INPUT_REQUIRED from the projector.
    // The real USER_INPUT_REQUIRED is emitted by acceptPendingInput with
    // full questions data; the projector's version would be a duplicate.
    expect(waiting).toEqual([]);
  });

  it('keeps LLM and waiting lifecycle body-free while retaining span and capability identity', () => {
    const projector = new WorkflowRuntimeEventProjector(recipeWithLifecycleFamilies());
    const started = projector.project(
      event({
        nodeId: 'summarize',
        nodeType: 'LLM',
        nodeExecutionId: 'node-llm-1',
        predecessorNodeExecutionIds: [],
        eventType: 'NODE_STARTED',
        input: { prompt: 'private workflow prompt' },
      }),
    );
    const completed = projector.project(
      event({
        nodeId: 'summarize',
        nodeType: 'LLM',
        nodeExecutionId: 'node-llm-1',
        predecessorNodeExecutionIds: [],
        eventType: 'NODE_COMPLETED',
        output: { result: 'summary result' },
        completedAt: new Date('2026-06-24T00:00:01.000Z'),
      }),
    );
    const waiting = projector.project(
      event({
        nodeId: 'askUser',
        nodeType: 'USER_CHECK',
        nodeExecutionId: 'node-waiting-1',
        predecessorNodeExecutionIds: ['node-llm-1'],
        eventType: 'NODE_WAITING',
        input: { questions: ['private workflow question'] },
        output: { pending: true },
        completedAt: new Date('2026-06-24T00:00:01.000Z'),
      }),
    );

    const startedLifecycle = started.find((projected) => projected.type === 'CAPABILITY_STARTED');
    expect(startedLifecycle).toEqual(
      expect.objectContaining({
        type: 'CAPABILITY_STARTED',
        inlinePayload: expect.objectContaining({
          capabilityId: 'summarize',
          toolCallId: 'workflow:workflow-execution:summarize',
          nodeExecutionId: 'node-llm-1',
          predecessorNodeExecutionIds: [],
        }),
      }),
    );
    expectWorkflowLifecycleBodyFree(startedLifecycle);
    expect(completed[0]).toEqual(
      expect.objectContaining({
        type: 'CAPABILITY_COMPLETED',
        inlinePayload: expect.objectContaining({
          capabilityId: 'summarize',
          toolCallId: 'workflow:workflow-execution:summarize',
          nodeExecutionId: 'node-llm-1',
          status: 'SUCCEEDED',
        }),
      }),
    );
    expectWorkflowLifecycleBodyFree(completed[0]);
    expect(waiting[0]).toEqual(
      expect.objectContaining({
        type: 'CAPABILITY_COMPLETED',
        inlinePayload: expect.objectContaining({
          capabilityId: 'askUser',
          toolCallId: 'workflow:workflow-execution:askUser',
          nodeExecutionId: 'node-waiting-1',
          status: 'DEGRADED',
          reasonCode: 'WORKFLOW_NODE_WAITING',
        }),
      }),
    );
    expectWorkflowLifecycleBodyFree(waiting[0]);
  });

  it('projects NODE_FAILED as CAPABILITY_COMPLETED with FAILED status', () => {
    const projector = new WorkflowRuntimeEventProjector(recipe());

    const failed = projector.project(
      event({
        nodeId: 'callTool',
        nodeType: 'TOOL',
        eventType: 'NODE_FAILED',
        safeError: { code: 'WORKFLOW_TOOL_FAILED', category: 'INTERNAL', message: 'safe', retryable: false },
        retryCount: 1,
        completedAt: new Date('2026-06-24T00:00:01.000Z'),
      }),
    );

    expect(failed[0]?.type).toBe('CAPABILITY_COMPLETED');
    expect(failed[0]?.inlinePayload).toEqual(
      expect.objectContaining({
        workflowEventType: 'NODE_FAILED',
        status: 'FAILED',
        retryCount: 1,
        safeErrorCode: 'WORKFLOW_TOOL_FAILED',
      }),
    );
  });

  it('omits nodeDesc when show_title is false but keeps event', () => {
    const projector = new WorkflowRuntimeEventProjector(recipeWithOutputParser({ show_title: false }));

    const completed = projector.project(
      event({
        nodeId: 'callApi',
        nodeType: 'RESTFUL',
        eventType: 'NODE_COMPLETED',
        output: { result: 'ok' },
        completedAt: new Date('2026-06-24T00:00:01.000Z'),
      }),
    );

    expect(completed).toHaveLength(3);
    expect(completed[0]?.type).toBe('CAPABILITY_RESULT_DELTA');
    expect(completed[0]?.inlinePayload).not.toHaveProperty('nodeDesc');
    expect(completed[0]?.inlinePayload).toEqual(
      expect.objectContaining({
        nodeId: 'callApi',
        nodeType: 'RESTFUL',
      }),
    );
  });

  it('keeps titled lifecycle status body-free when show_content is false', () => {
    const projector = new WorkflowRuntimeEventProjector(recipeWithOutputParser({ show_content: false }));

    const started = projector.project(
      event({ nodeId: 'callApi', nodeType: 'RESTFUL', eventType: 'NODE_STARTED', input: { api_name: 'queryDevice' } }),
    );
    const completed = projector.project(
      event({
        nodeId: 'callApi',
        nodeType: 'RESTFUL',
        eventType: 'NODE_COMPLETED',
        output: { result: 'ok' },
        completedAt: new Date('2026-06-24T00:00:01.000Z'),
      }),
    );

    expect(started[0]?.inlinePayload).toEqual(
      expect.objectContaining({
        capabilityId: 'callApi',
        toolCallId: 'workflow:workflow-execution:callApi',
        workflowEventType: 'NODE_STARTED',
      }),
    );
    expectWorkflowLifecycleBodyFree(started[0]);
    const completedLifecycle = completed.find((projected) => projected.type === 'CAPABILITY_COMPLETED');
    expect(completedLifecycle?.inlinePayload).toEqual(
      expect.objectContaining({
        capabilityId: 'callApi',
        toolCallId: 'workflow:workflow-execution:callApi',
        workflowEventType: 'NODE_COMPLETED',
        status: 'SUCCEEDED',
      }),
    );
    expectWorkflowLifecycleBodyFree(completedLifecycle);
    expect(completed.find((projected) => projected.type === 'TOOL_STRUCTURED_DELTA')).toBeUndefined();
  });

  it('defaults to full product recording without copying the product into lifecycle', () => {
    const projector = new WorkflowRuntimeEventProjector(recipeWithDescription());

    const completed = projector.project(
      event({
        nodeId: 'callApi',
        nodeType: 'RESTFUL',
        eventType: 'NODE_COMPLETED',
        output: { result: 'ok' },
        completedAt: new Date('2026-06-24T00:00:01.000Z'),
      }),
    );

    const lifecycle = completed.find((projected) => projected.type === 'CAPABILITY_COMPLETED');
    expect(lifecycle?.inlinePayload).toEqual(
      expect.objectContaining({
        capabilityId: 'callApi',
        toolCallId: 'workflow:workflow-execution:callApi',
        status: 'SUCCEEDED',
      }),
    );
    expectWorkflowLifecycleBodyFree(lifecycle);
    expect(completed.find((projected) => projected.type === 'TOOL_STRUCTURED_DELTA')?.inlinePayload).toEqual(
      expect.objectContaining({
        capabilityId: 'callApi',
        toolCallId: 'workflow:workflow-execution:callApi',
        toolEventType: 'DETAIL',
        toolMessageType: 'TEXT',
        content: 'ok',
      }),
    );
  });

  it('keeps persisted workflow capability lifecycle events free of every product body field', () => {
    const projector = new WorkflowRuntimeEventProjector(recipe());

    const started = projector.project(event({ nodeId: 'callTool', nodeType: 'TOOL', eventType: 'NODE_STARTED', input: { tool_name: 'code' } }));
    const completed = projector.project(
      event({
        nodeId: 'callTool',
        nodeType: 'TOOL',
        eventType: 'NODE_COMPLETED',
        output: { answer: 'ok' },
        completedAt: new Date('2026-06-24T00:00:01.000Z'),
      }),
    );

    expectWorkflowLifecycleBodyFree(started.find((projected) => projected.type === 'CAPABILITY_STARTED'));
    expectWorkflowLifecycleBodyFree(completed.find((projected) => projected.type === 'CAPABILITY_COMPLETED'));
    expect(completed.some((projected) => projected.type === 'CAPABILITY_RESULT_DELTA')).toBe(false);
  });

  it('emits TOOL_STRUCTURED_DELTA TITLE on NODE_STARTED for non-gateway nodes', () => {
    const projector = new WorkflowRuntimeEventProjector(recipeWithDescription());

    const started = projector.project(
      event({ nodeId: 'callApi', nodeType: 'RESTFUL', eventType: 'NODE_STARTED', input: { api_name: 'queryDevice' } }),
    );

    const structured = started.find((e) => e.type === 'TOOL_STRUCTURED_DELTA');
    expect(structured).toEqual(
      expect.objectContaining({
        type: 'TOOL_STRUCTURED_DELTA',
        inlinePayload: expect.objectContaining({
          toolEventType: 'TITLE',
          toolMessageType: 'TEXT',
          content: '调用查询接口',
          accumulated: true,
          nodeId: 'callApi',
          nodeType: 'RESTFUL',
        }),
      }),
    );
  });

  it('emits TOOL_STRUCTURED_DELTA DETAIL on NODE_COMPLETED for non-gateway nodes', () => {
    const projector = new WorkflowRuntimeEventProjector(recipeWithDescription());

    const completed = projector.project(
      event({
        nodeId: 'callApi',
        nodeType: 'RESTFUL',
        eventType: 'NODE_COMPLETED',
        output: { result: 'ok' },
        completedAt: new Date('2026-06-24T00:00:01.000Z'),
      }),
    );

    const structured = completed.find((e) => e.type === 'TOOL_STRUCTURED_DELTA');
    expect(structured).toEqual(
      expect.objectContaining({
        type: 'TOOL_STRUCTURED_DELTA',
        inlinePayload: expect.objectContaining({
          toolEventType: 'DETAIL',
          toolMessageType: 'TEXT',
          accumulated: true,
          nodeId: 'callApi',
        }),
      }),
    );
  });

  it('emits ANSWER instead of DETAIL for the last non-gateway node', () => {
    const projector = new WorkflowRuntimeEventProjector(recipeWithChain());

    const detail = projector.project(
      event({
        nodeId: 'callApi',
        nodeType: 'RESTFUL',
        eventType: 'NODE_COMPLETED',
        output: { result: 'ok' },
        completedAt: new Date('2026-06-24T00:00:01.000Z'),
      }),
    );
    const answer = projector.project(
      event({
        nodeId: 'summarize',
        nodeType: 'LLM',
        eventType: 'NODE_COMPLETED',
        output: { summary: 'done' },
        completedAt: new Date('2026-06-24T00:00:02.000Z'),
      }),
    );

    const detailStructured = detail.find((e) => e.type === 'TOOL_STRUCTURED_DELTA');
    const answerStructured = answer.find((e) => e.type === 'TOOL_STRUCTURED_DELTA');
    expect(detailStructured?.inlinePayload).toEqual(expect.objectContaining({ toolEventType: 'DETAIL' }));
    expect(answerStructured?.inlinePayload).toEqual(expect.objectContaining({ toolEventType: 'ANSWER' }));
  });
  it('emits ANSWER for the post-join summary node, not the pre-fork init node', () => {
    const projector = new WorkflowRuntimeEventProjector(recipeWithForkJoin());

    const initCompleted = projector.project(
      event({
        nodeId: 'init',
        nodeType: 'DISPLAY',
        eventType: 'NODE_COMPLETED',
        output: { smsg: 'init continue' },
        completedAt: new Date('2026-06-24T00:00:01.000Z'),
      }),
    );
    const summaryCompleted = projector.project(
      event({
        nodeId: 'summary',
        nodeType: 'DISPLAY',
        eventType: 'NODE_COMPLETED',
        output: { smsg_end: 'summary end' },
        completedAt: new Date('2026-06-24T00:00:05.000Z'),
      }),
    );

    const initStructured = initCompleted.find((e) => e.type === 'TOOL_STRUCTURED_DELTA');
    const summaryStructured = summaryCompleted.find((e) => e.type === 'TOOL_STRUCTURED_DELTA');
    expect(initStructured?.inlinePayload).toEqual(expect.objectContaining({ toolEventType: 'DETAIL' }));
    expect(summaryStructured?.inlinePayload).toEqual(expect.objectContaining({ toolEventType: 'ANSWER' }));
  });

  it('maps output {level, type, content} to structured delta via output-driven mapping', () => {
    const projector = new WorkflowRuntimeEventProjector(recipe());

    const completed = projector.project(
      event({
        nodeId: 'callTool',
        nodeType: 'TOOL',
        eventType: 'NODE_COMPLETED',
        output: { level: 'answer', type: 'dsl', content: '<dsl>chart</dsl>' },
        completedAt: new Date('2026-06-24T00:00:01.000Z'),
      }),
    );

    const structured = completed.find((e) => e.type === 'TOOL_STRUCTURED_DELTA');
    expect(structured?.inlinePayload).toEqual(
      expect.objectContaining({
        toolEventType: 'ANSWER',
        toolMessageType: 'DSL',
        content: '<dsl>chart</dsl>',
      }),
    );
  });

  it('falls back to topology-driven DETAIL when output level is invalid', () => {
    const projector = new WorkflowRuntimeEventProjector(recipeWithChain());

    const completed = projector.project(
      event({
        nodeId: 'callApi',
        nodeType: 'RESTFUL',
        eventType: 'NODE_COMPLETED',
        output: { level: 'unknown', result: 'ok' },
        completedAt: new Date('2026-06-24T00:00:01.000Z'),
      }),
    );

    const structured = completed.find((e) => e.type === 'TOOL_STRUCTURED_DELTA');
    expect(structured?.inlinePayload).toEqual(
      expect.objectContaining({
        toolEventType: 'DETAIL',
        toolMessageType: 'TEXT',
      }),
    );
  });

  it('defaults toolMessageType to TEXT when output has level but no type', () => {
    const projector = new WorkflowRuntimeEventProjector(recipe());

    const completed = projector.project(
      event({
        nodeId: 'callTool',
        nodeType: 'TOOL',
        eventType: 'NODE_COMPLETED',
        output: { level: 'title', content: 'hello' },
        completedAt: new Date('2026-06-24T00:00:01.000Z'),
      }),
    );

    const structured = completed.find((e) => e.type === 'TOOL_STRUCTURED_DELTA');
    expect(structured?.inlinePayload).toEqual(
      expect.objectContaining({
        toolEventType: 'TITLE',
        toolMessageType: 'TEXT',
        content: 'hello',
      }),
    );
  });

  it('does not emit TOOL_STRUCTURED_DELTA for gateway nodes', () => {
    const projector = new WorkflowRuntimeEventProjector(recipe());

    const started = projector.project(event({ nodeId: 'gateway', nodeType: 'CONDITION', eventType: 'NODE_STARTED' }));
    const completed = projector.project(
      event({ nodeId: 'gateway', nodeType: 'CONDITION', eventType: 'NODE_COMPLETED', completedAt: new Date('2026-06-24T00:00:01.000Z') }),
    );

    expect(started.find((e) => e.type === 'TOOL_STRUCTURED_DELTA')).toBeUndefined();
    expect(completed.find((e) => e.type === 'TOOL_STRUCTURED_DELTA')).toBeUndefined();
  });

  it('preserves existing CAPABILITY events alongside TOOL_STRUCTURED_DELTA', () => {
    const projector = new WorkflowRuntimeEventProjector(recipe());

    const started = projector.project(event({ nodeId: 'callTool', nodeType: 'TOOL', eventType: 'NODE_STARTED', input: { tool_name: 'code' } }));
    const completed = projector.project(
      event({
        nodeId: 'callTool',
        nodeType: 'TOOL',
        eventType: 'NODE_COMPLETED',
        output: { answer: 'ok' },
        completedAt: new Date('2026-06-24T00:00:01.000Z'),
      }),
    );

    expect(started.some((e) => e.type === 'CAPABILITY_STARTED')).toBe(true);
    expect(started.some((e) => e.type === 'TOOL_STRUCTURED_DELTA')).toBe(true);
    expect(completed.some((e) => e.type === 'CAPABILITY_COMPLETED')).toBe(true);
    expect(completed.some((e) => e.type === 'TOOL_STRUCTURED_DELTA')).toBe(true);
  });

  it('omits structured delta when show_title is false on NODE_STARTED', () => {
    const projector = new WorkflowRuntimeEventProjector(recipeWithOutputParser({ show_title: false }));

    const started = projector.project(
      event({ nodeId: 'callApi', nodeType: 'RESTFUL', eventType: 'NODE_STARTED', input: { api_name: 'queryDevice' } }),
    );

    expect(started.find((e) => e.type === 'TOOL_STRUCTURED_DELTA')).toBeUndefined();
  });

  it('omits structured delta when show_content is false on NODE_COMPLETED', () => {
    const projector = new WorkflowRuntimeEventProjector(recipeWithOutputParser({ show_content: false }));

    const completed = projector.project(
      event({
        nodeId: 'callApi',
        nodeType: 'RESTFUL',
        eventType: 'NODE_COMPLETED',
        output: { result: 'ok' },
        completedAt: new Date('2026-06-24T00:00:01.000Z'),
      }),
    );

    expect(completed.find((e) => e.type === 'TOOL_STRUCTURED_DELTA')).toBeUndefined();
  });

  it('suppresses CAPABILITY_STARTED when show_title is false on capability node', () => {
    const projector = new WorkflowRuntimeEventProjector(recipeWithOutputParser({ show_title: false }));

    const started = projector.project(
      event({ nodeId: 'callApi', nodeType: 'RESTFUL', eventType: 'NODE_STARTED', input: { api_name: 'queryDevice' } }),
    );

    expect(started.some((e) => e.type === 'CAPABILITY_STARTED')).toBe(false);
  });

  it('keeps CAPABILITY_COMPLETED status when show_content is false on capability node', () => {
    const projector = new WorkflowRuntimeEventProjector(recipeWithOutputParser({ show_content: false }));

    const completed = projector.project(
      event({
        nodeId: 'callApi',
        nodeType: 'RESTFUL',
        eventType: 'NODE_COMPLETED',
        output: { result: 'ok' },
        completedAt: new Date('2026-06-24T00:00:01.000Z'),
      }),
    );

    expect(completed.find((projected) => projected.type === 'CAPABILITY_COMPLETED')?.inlinePayload).toEqual(
      expect.objectContaining({ status: 'SUCCEEDED' }),
    );
    expect(completed.some((e) => e.type === 'CAPABILITY_RESULT_DELTA')).toBe(false);
    expect(completed.some((e) => e.type === 'TOOL_STRUCTURED_DELTA')).toBe(false);
  });

  it('suppresses CAPABILITY_STARTED when show_title is false on LLM node', () => {
    const projector = new WorkflowRuntimeEventProjector(recipeWithChainAndOutputParser({ show_title: false }));

    const started = projector.project(
      event({ nodeId: 'summarize', nodeType: 'LLM', nodeExecutionId: 'summarize-attempt-1', eventType: 'NODE_STARTED' }),
    );

    expect(started.some((e) => e.type === 'CAPABILITY_STARTED')).toBe(false);
  });

  it('keeps CAPABILITY_COMPLETED status when show_content is false on LLM node', () => {
    const projector = new WorkflowRuntimeEventProjector(recipeWithChainAndOutputParser({ show_content: false }));

    const completed = projector.project(
      event({
        nodeId: 'summarize',
        nodeType: 'LLM',
        nodeExecutionId: 'summarize-attempt-1',
        eventType: 'NODE_COMPLETED',
        output: { result: 'summary text' },
        completedAt: new Date('2026-06-24T00:00:01.000Z'),
      }),
    );

    expect(completed.find((projected) => projected.type === 'CAPABILITY_COMPLETED')?.inlinePayload).toEqual(
      expect.objectContaining({ status: 'SUCCEEDED' }),
    );
    expect(completed.some((e) => e.type === 'TOOL_STRUCTURED_DELTA')).toBe(false);
  });

  it('maps output_parser type PIU to PIU message type with displayType metadata', () => {
    const projector = new WorkflowRuntimeEventProjector(
      recipeWithOutputParser({ type: 'PIU', data: { piuName: 'reportViewer', piuVersion: '1.0.0' } }),
    );

    const completed = projector.project(
      event({
        nodeId: 'callApi',
        nodeType: 'RESTFUL',
        eventType: 'NODE_COMPLETED',
        output: { result: 'ok' },
        completedAt: new Date('2026-06-24T00:00:01.000Z'),
      }),
    );

    const structured = completed.find((e) => e.type === 'TOOL_STRUCTURED_DELTA');
    expect(structured?.inlinePayload).toEqual(
      expect.objectContaining({
        toolMessageType: 'PIU',
        displayType: 'PIU',
        content: { piuName: 'reportViewer', piuVersion: '1.0.0' },
      }),
    );
  });

  it('maps output_parser type TABLE to TEXT message type with displayType metadata', () => {
    const projector = new WorkflowRuntimeEventProjector(recipeWithOutputParser({ type: 'TABLE', data: { rows: [] } }));

    const completed = projector.project(
      event({
        nodeId: 'callApi',
        nodeType: 'RESTFUL',
        eventType: 'NODE_COMPLETED',
        output: { result: 'ok' },
        completedAt: new Date('2026-06-24T00:00:01.000Z'),
      }),
    );

    const structured = completed.find((e) => e.type === 'TOOL_STRUCTURED_DELTA');
    expect(structured?.inlinePayload).toEqual(
      expect.objectContaining({
        toolMessageType: 'TEXT',
        displayType: 'TABLE',
      }),
    );
  });

  it('maps output_parser type DSL to DSL message type', () => {
    const projector = new WorkflowRuntimeEventProjector(recipeWithOutputParser({ type: 'DSL', data: { dsl: 'content' } }));

    const completed = projector.project(
      event({
        nodeId: 'callApi',
        nodeType: 'RESTFUL',
        eventType: 'NODE_COMPLETED',
        output: { result: 'ok' },
        completedAt: new Date('2026-06-24T00:00:01.000Z'),
      }),
    );

    const structured = completed.find((e) => e.type === 'TOOL_STRUCTURED_DELTA');
    expect(structured?.inlinePayload).toEqual(
      expect.objectContaining({
        toolMessageType: 'DSL',
        displayType: 'DSL',
      }),
    );
  });

  it('uses output_parser data as content when present', () => {
    const projector = new WorkflowRuntimeEventProjector(recipeWithOutputParser({ data: { piuName: 'thoughtChain', piuVersion: '2.0.0' } }));

    const completed = projector.project(
      event({
        nodeId: 'callApi',
        nodeType: 'RESTFUL',
        eventType: 'NODE_COMPLETED',
        output: { result: 'ok' },
        completedAt: new Date('2026-06-24T00:00:01.000Z'),
      }),
    );

    const structured = completed.find((e) => e.type === 'TOOL_STRUCTURED_DELTA');
    expect(structured?.inlinePayload).toEqual(
      expect.objectContaining({
        content: { piuName: 'thoughtChain', piuVersion: '2.0.0' },
      }),
    );
  });

  it('type alone without data or message_level still triggers output_parser path with PIU messageType', () => {
    const projector = new WorkflowRuntimeEventProjector(recipeWithOutputParser({ type: 'PIU' }));

    const completed = projector.project(
      event({
        nodeId: 'callApi',
        nodeType: 'RESTFUL',
        eventType: 'NODE_COMPLETED',
        output: { result: 'ok' },
        completedAt: new Date('2026-06-24T00:00:01.000Z'),
      }),
    );

    const structured = completed.find((e) => e.type === 'TOOL_STRUCTURED_DELTA');
    expect(structured?.inlinePayload).toEqual(
      expect.objectContaining({
        content: 'ok',
        toolMessageType: 'PIU',
        displayType: 'PIU',
      }),
    );
  });

  it('runtime-resolved output_parser from event.output drives PIU content', () => {
    const projector = new WorkflowRuntimeEventProjector(recipeWithOutputParser({ type: 'PIU', data: '${piuData}' }));

    const completed = projector.project(
      event({
        nodeId: 'callApi',
        nodeType: 'RESTFUL',
        eventType: 'NODE_COMPLETED',
        output: { result: 'text', piuData: { a: '00', b: '1' }, output_parser: { type: 'PIU', data: { a: '00', b: '1' } } },
        completedAt: new Date('2026-06-24T00:00:01.000Z'),
      }),
    );

    const structured = completed.find((e) => e.type === 'TOOL_STRUCTURED_DELTA');
    expect(structured?.inlinePayload).toEqual(
      expect.objectContaining({
        toolMessageType: 'PIU',
        content: { a: '00', b: '1' },
        displayType: 'PIU',
      }),
    );
  });

  it('string data carries as content (JsonValue support)', () => {
    const projector = new WorkflowRuntimeEventProjector(recipeWithOutputParser({ type: 'PIU', data: 'plain string' }));

    const completed = projector.project(
      event({
        nodeId: 'callApi',
        nodeType: 'RESTFUL',
        eventType: 'NODE_COMPLETED',
        output: { result: 'ok' },
        completedAt: new Date('2026-06-24T00:00:01.000Z'),
      }),
    );

    const structured = completed.find((e) => e.type === 'TOOL_STRUCTURED_DELTA');
    expect(structured?.inlinePayload).toEqual(
      expect.objectContaining({
        toolMessageType: 'PIU',
        content: 'plain string',
        displayType: 'PIU',
      }),
    );
  });

  it('NODE_OUTPUT_DELTA does not create structured delta when displayType is configured', () => {
    const projector = new WorkflowRuntimeEventProjector(recipeWithOutputParser({ type: 'PIU', data: '${piuData}' }));

    const deltaEvents = projector.project(
      event({
        nodeId: 'callApi',
        nodeType: 'RESTFUL',
        eventType: 'NODE_OUTPUT_DELTA',
        visibleDelta: { channel: 'CONTENT', content: 'streamed text', level: 'DETAIL' },
      }),
    );

    expect(deltaEvents.find((e) => e.type === 'TOOL_STRUCTURED_DELTA')).toBeUndefined();
  });

  it('full flow: delta + completed produces exactly one PIU detail with resolved data', () => {
    const projector = new WorkflowRuntimeEventProjector(recipeWithOutputParser({ type: 'PIU', data: '${piuData}' }));

    projector.project(
      event({
        nodeId: 'callApi',
        nodeType: 'RESTFUL',
        eventType: 'NODE_OUTPUT_DELTA',
        visibleDelta: { channel: 'CONTENT', content: 'wrong content', level: 'DETAIL' },
      }),
    );

    const completedEvents = projector.project(
      event({
        nodeId: 'callApi',
        nodeType: 'RESTFUL',
        eventType: 'NODE_COMPLETED',
        output: {
          result: 'text result',
          piuData: { a: '00', b: '1' },
          output_parser: { type: 'PIU', data: { a: '00', b: '1' } },
        },
        completedAt: new Date('2026-06-24T00:00:01.000Z'),
      }),
    );

    const structuredDeltas = completedEvents.filter((e) => e.type === 'TOOL_STRUCTURED_DELTA');
    expect(structuredDeltas).toHaveLength(1);
    expect(structuredDeltas[0]?.inlinePayload).toEqual(
      expect.objectContaining({
        toolMessageType: 'PIU',
        content: { a: '00', b: '1' },
        displayType: 'PIU',
        toolEventType: 'DETAIL',
      }),
    );
  });

  it('DISPLAY node with output_parser: delta shows as LLM_CONTENT_DELTA, completed shows PIU detail', () => {
    const recipe: RecipeDefinition = {
      recipeName: 'test',
      version: 'v1',
      displayName: 'Test',
      flowGraph: {
        nodes: {
          displayHtml: {
            type: 'DISPLAY',
            description: 'HTML content',
            presentation: { outputParser: { type: 'PIU', data: '${piuData}' } },
            next: {},
          },
        },
      },
    } as unknown as RecipeDefinition;
    const projector = new WorkflowRuntimeEventProjector(recipe);

    const deltaEvents = projector.project(
      event({
        nodeId: 'displayHtml',
        nodeType: 'DISPLAY',
        eventType: 'NODE_OUTPUT_DELTA',
        visibleDelta: { channel: 'CONTENT', content: '<h3>report</h3>', level: 'DETAIL' },
      }),
    );
    expect(deltaEvents.find((e) => e.type === 'TOOL_STRUCTURED_DELTA')).toBeUndefined();
    expect(deltaEvents.find((e) => e.type === 'LLM_CONTENT_DELTA')).toBeDefined();

    const completedEvents = projector.project(
      event({
        nodeId: 'displayHtml',
        nodeType: 'DISPLAY',
        eventType: 'NODE_COMPLETED',
        output: {
          piuData: { a: '00', b: '1' },
          output_parser: { type: 'PIU', data: { a: '00', b: '1' } },
        },
        completedAt: new Date('2026-06-24T00:00:01.000Z'),
      }),
    );

    const structured = completedEvents.filter((e) => e.type === 'TOOL_STRUCTURED_DELTA');
    expect(structured).toHaveLength(1);
    expect(structured[0]?.inlinePayload).toEqual(
      expect.objectContaining({
        toolMessageType: 'PIU',
        content: { a: '00', b: '1' },
        displayType: 'PIU',
      }),
    );
  });

  it('type CHART_PRO is valid and maps to TEXT', () => {
    const projector = new WorkflowRuntimeEventProjector(recipeWithOutputParser({ type: 'CHART_PRO', data: { chart: 'data' } }));

    const completed = projector.project(
      event({
        nodeId: 'callApi',
        nodeType: 'RESTFUL',
        eventType: 'NODE_COMPLETED',
        output: { result: 'ok' },
        completedAt: new Date('2026-06-24T00:00:01.000Z'),
      }),
    );

    const structured = completed.find((e) => e.type === 'TOOL_STRUCTURED_DELTA');
    expect(structured?.inlinePayload).toEqual(
      expect.objectContaining({
        toolMessageType: 'TEXT',
        displayType: 'CHART_PRO',
      }),
    );
  });

  it('overrides answer-node level with output_parser message_level', () => {
    const projector = new WorkflowRuntimeEventProjector(recipeWithChainAndOutputParser({ message_level: 'ANSWER' }));

    const completed = projector.project(
      event({
        nodeId: 'callApi',
        nodeType: 'RESTFUL',
        eventType: 'NODE_COMPLETED',
        output: { result: 'ok' },
        completedAt: new Date('2026-06-24T00:00:01.000Z'),
      }),
    );

    const structured = completed.find((e) => e.type === 'TOOL_STRUCTURED_DELTA');
    expect(structured?.inlinePayload).toEqual(
      expect.objectContaining({
        toolEventType: 'ANSWER',
      }),
    );
  });

  it('ignores invalid message_level and uses default derivation', () => {
    const projector = new WorkflowRuntimeEventProjector(recipeWithOutputParser({ message_level: 'INVALID' }));

    const completed = projector.project(
      event({
        nodeId: 'callApi',
        nodeType: 'RESTFUL',
        eventType: 'NODE_COMPLETED',
        output: { result: 'ok' },
        completedAt: new Date('2026-06-24T00:00:01.000Z'),
      }),
    );

    const structured = completed.find((e) => e.type === 'TOOL_STRUCTURED_DELTA');
    expect(structured?.inlinePayload).toEqual(
      expect.objectContaining({
        toolEventType: 'DETAIL',
      }),
    );
  });

  it('includes aigc flag when show_aigc is true with data', () => {
    const projector = new WorkflowRuntimeEventProjector(recipeWithOutputParser({ show_aigc: true, data: { content: 'x' } }));

    const completed = projector.project(
      event({
        nodeId: 'callApi',
        nodeType: 'RESTFUL',
        eventType: 'NODE_COMPLETED',
        output: { result: 'ok' },
        completedAt: new Date('2026-06-24T00:00:01.000Z'),
      }),
    );

    const structured = completed.find((e) => e.type === 'TOOL_STRUCTURED_DELTA');
    expect(structured?.inlinePayload).toEqual(
      expect.objectContaining({
        aigc: true,
      }),
    );
  });

  it('omits aigc flag when show_aigc is false with data', () => {
    const projector = new WorkflowRuntimeEventProjector(recipeWithOutputParser({ show_aigc: false, data: { content: 'x' } }));
    const completed = projector.project(
      event({
        nodeId: 'callApi',
        nodeType: 'RESTFUL',
        eventType: 'NODE_COMPLETED',
        output: { result: 'ok' },
        completedAt: new Date('2026-06-24T00:00:01.000Z'),
      }),
    );

    const structured = completed.find((e) => e.type === 'TOOL_STRUCTURED_DELTA');
    expect(structured?.inlinePayload).not.toHaveProperty('aigc');
  });

  it('show_aigc alone without data or message_level does not emit aigc', () => {
    const projector = new WorkflowRuntimeEventProjector(recipeWithOutputParser({ show_aigc: true }));

    const completed = projector.project(
      event({
        nodeId: 'callApi',
        nodeType: 'RESTFUL',
        eventType: 'NODE_COMPLETED',
        output: { result: 'ok' },
        completedAt: new Date('2026-06-24T00:00:01.000Z'),
      }),
    );

    const structured = completed.find((e) => e.type === 'TOOL_STRUCTURED_DELTA');
    expect(structured?.inlinePayload).not.toHaveProperty('aigc');
  });

  it('output_parser data takes precedence over output-driven content', () => {
    const projector = new WorkflowRuntimeEventProjector(recipeWithOutputParser({ data: { custom: 'value' } }));

    const completed = projector.project(
      event({
        nodeId: 'callApi',
        nodeType: 'RESTFUL',
        eventType: 'NODE_COMPLETED',
        output: { level: 'answer', type: 'dsl', content: '<dsl>chart</dsl>' },
        completedAt: new Date('2026-06-24T00:00:01.000Z'),
      }),
    );

    const structured = completed.find((e) => e.type === 'TOOL_STRUCTURED_DELTA');
    expect(structured?.inlinePayload).toEqual(
      expect.objectContaining({
        content: { custom: 'value' },
      }),
    );
  });

  it('output_parser message_level takes precedence over output level', () => {
    const projector = new WorkflowRuntimeEventProjector(recipeWithOutputParser({ message_level: 'TITLE' }));

    const completed = projector.project(
      event({
        nodeId: 'callApi',
        nodeType: 'RESTFUL',
        eventType: 'NODE_COMPLETED',
        output: { level: 'answer', content: 'result' },
        completedAt: new Date('2026-06-24T00:00:01.000Z'),
      }),
    );

    const structured = completed.find((e) => e.type === 'TOOL_STRUCTURED_DELTA');
    expect(structured?.inlinePayload).toEqual(
      expect.objectContaining({
        toolEventType: 'TITLE',
      }),
    );
  });
});

describe('workflow runtime event projector - USER_CHECK and ANSWER dedup', () => {
  it('suppresses structured delta for output level user_check', () => {
    const projector = new WorkflowRuntimeEventProjector(recipe());

    const completed = projector.project(
      event({
        nodeId: 'check-1',
        nodeType: 'USER_CHECK',
        eventType: 'NODE_COMPLETED',
        output: { level: 'user_check', content: 'user selected A' },
        completedAt: new Date('2026-06-24T00:00:01.000Z'),
      }),
    );

    // Interaction prompt text (level=user_check) must not produce a
    // structured delta. The prompt is carried by USER_INPUT_REQUIRED
    // via the pending input bridge, not by TOOL_STRUCTURED_DELTA.
    const structured = completed.find((e) => e.type === 'TOOL_STRUCTURED_DELTA');
    expect(structured).toBeUndefined();
    // CAPABILITY_COMPLETED is still emitted for node lifecycle tracking.
    expect(completed.some((e) => e.type === 'CAPABILITY_COMPLETED')).toBe(true);
  });

  it('persists ANSWER content from LLM stream at NODE_COMPLETED', () => {
    const projector = new WorkflowRuntimeEventProjector(recipeWithChain());

    projector.project(
      event({
        nodeId: 'summarize',
        nodeType: 'LLM',
        eventType: 'NODE_OUTPUT_DELTA',
        visibleDelta: { channel: 'CONTENT', content: 'streamed answer' },
      }),
    );
    const completed = projector.project(
      event({
        nodeId: 'summarize',
        nodeType: 'LLM',
        eventType: 'NODE_COMPLETED',
        output: { level: 'answer', content: 'streamed answer' },
        completedAt: new Date('2026-06-24T00:00:01.000Z'),
      }),
    );

    const structured = completed.find((e) => e.type === 'TOOL_STRUCTURED_DELTA');
    expect(structured).toBeDefined();
    expect(structured?.inlinePayload).toEqual(
      expect.objectContaining({
        toolEventType: 'ANSWER',
        content: 'streamed answer',
      }),
    );
  });

  it('keeps ANSWER content when no prior streaming occurred', () => {
    const projector = new WorkflowRuntimeEventProjector(recipe());

    const completed = projector.project(
      event({
        nodeId: 'answer-node',
        nodeType: 'LLM',
        eventType: 'NODE_COMPLETED',
        output: { level: 'answer', content: 'final result' },
        completedAt: new Date('2026-06-24T00:00:01.000Z'),
      }),
    );

    const structured = completed.find((e) => e.type === 'TOOL_STRUCTURED_DELTA');
    expect(structured).toBeDefined();
    expect(structured?.inlinePayload).toEqual(
      expect.objectContaining({
        toolEventType: 'ANSWER',
        content: 'final result',
      }),
    );
  });

  it('emits TOOL_STRUCTURED_DELTA fragment when visibleDelta carries level regardless of nodeType', () => {
    const projector = new WorkflowRuntimeEventProjector(recipe());

    const delta = projector.project(
      event({
        nodeId: 'callTool',
        nodeType: 'TOOL',
        eventType: 'NODE_OUTPUT_DELTA',
        visibleDelta: { channel: 'CONTENT', content: 'fragment-1', level: 'ANSWER' },
      }),
    );

    expect(delta).toHaveLength(1);
    expect(delta[0]?.type).toBe('TOOL_STRUCTURED_DELTA');
    expect(delta[0]?.inlinePayload).toEqual(
      expect.objectContaining({
        toolEventType: 'ANSWER',
        toolMessageType: 'TEXT',
        content: 'fragment-1',
      }),
    );
  });

  it('emits final accumulated TOOL_STRUCTURED_DELTA at NODE_COMPLETED after visibleDelta.level streaming', () => {
    const projector = new WorkflowRuntimeEventProjector(recipe());

    projector.project(
      event({
        nodeId: 'callTool',
        nodeType: 'TOOL',
        eventType: 'NODE_OUTPUT_DELTA',
        visibleDelta: { channel: 'CONTENT', content: 'fragment-1', level: 'ANSWER' },
      }),
    );
    projector.project(
      event({
        nodeId: 'callTool',
        nodeType: 'TOOL',
        eventType: 'NODE_OUTPUT_DELTA',
        visibleDelta: { channel: 'CONTENT', content: 'fragment-2', level: 'ANSWER' },
      }),
    );
    const completed = projector.project(
      event({
        nodeId: 'callTool',
        nodeType: 'TOOL',
        eventType: 'NODE_COMPLETED',
        output: { result: 'ok' },
        completedAt: new Date('2026-06-24T00:00:01.000Z'),
      }),
    );

    const structured = completed.find((e) => e.type === 'TOOL_STRUCTURED_DELTA');
    expect(structured).toBeDefined();
    expect(structured?.inlinePayload).toEqual(
      expect.objectContaining({
        toolEventType: 'ANSWER',
        toolMessageType: 'TEXT',
        content: 'fragment-1fragment-2',
        accumulated: true,
        workflowEventType: 'NODE_COMPLETED',
      }),
    );
  });

  it('emits fallback structured delta with LLM streamed content at NODE_COMPLETED', () => {
    const projector = new WorkflowRuntimeEventProjector(recipeWithChain());

    projector.project(
      event({
        nodeId: 'summarize',
        nodeType: 'LLM',
        eventType: 'NODE_OUTPUT_DELTA',
        visibleDelta: { channel: 'CONTENT', content: 'streamed content' },
      }),
    );
    const completed = projector.project(
      event({
        nodeId: 'summarize',
        nodeType: 'LLM',
        eventType: 'NODE_COMPLETED',
        output: { result: 'streamed content' },
        completedAt: new Date('2026-06-24T00:00:01.000Z'),
      }),
    );

    // tryOutputDrivenDelta returns undefined (no output.level); fallback uses
    // accumulated LLM streamed content for the persisted structured delta.
    const structured = completed.find((e) => e.type === 'TOOL_STRUCTURED_DELTA');
    expect(structured).toBeDefined();
    expect(structured?.inlinePayload).toEqual(
      expect.objectContaining({
        toolEventType: 'ANSWER',
        content: 'streamed content',
      }),
    );
  });
});

function expectWorkflowLifecycleBodyFree(event?: RunTimelineEvent): void {
  expect(event).toBeDefined();
  for (const field of ['messageId', 'description', 'input', 'output', 'arguments', 'result', 'safeResult', 'structuredPayload']) {
    expect(event?.inlinePayload).not.toHaveProperty(field);
  }
}

function event(
  overrides: Partial<WorkflowExecutionEvent> & {
    readonly nodeId: string;
    readonly nodeType: WorkflowExecutionEvent['nodeType'];
    readonly eventType: WorkflowExecutionEvent['eventType'];
  },
): WorkflowExecutionEvent {
  return {
    executionId: 'workflow-execution',
    retryCount: 0,
    startedAt: new Date('2026-06-24T00:00:00.000Z'),
    ...overrides,
  } as WorkflowExecutionEvent;
}

function recipe(): RecipeDefinition {
  return {
    recipeName: 'workflow-runtime-projector-test',
    version: 'v1',
    displayName: 'Workflow runtime projector test',
    flowGraph: {
      nodes: {
        callTool: { type: 'TOOL', description: 'Call tool', inputs: { tool_name: 'code' }, next: {} },
      },
    },
  } as unknown as RecipeDefinition;
}

function recipeWithCapabilityNodes(): RecipeDefinition {
  return {
    recipeName: 'workflow-runtime-projector-test',
    version: 'v1',
    displayName: 'Workflow runtime projector test',
    flowGraph: {
      nodes: {
        start: { type: 'START', next: { callTool: {} } },
        callTool: {
          type: 'TOOL',
          description: 'Call tool',
          inputs: { tool_name: 'code' },
          next: { callSkill: {} },
        },
        callSkill: {
          type: 'SKILL',
          description: 'Call skill',
          inputs: { skill_name: 'alarm-diagnosis' },
          next: { callSubflow: {} },
        },
        callSubflow: {
          type: 'SUBFLOW',
          description: 'Call subflow',
          inputs: { recipe_name: 'child-flow' },
          next: { end: {} },
        },
        end: { type: 'END', next: {} },
      },
    },
  } as unknown as RecipeDefinition;
}

function recipeWithLifecycleFamilies(): RecipeDefinition {
  return {
    recipeName: 'workflow-runtime-projector-test',
    version: 'v1',
    displayName: 'Workflow runtime projector test',
    flowGraph: {
      nodes: {
        start: { type: 'START', next: { summarize: {} } },
        summarize: { type: 'LLM', description: 'Summarize private result', next: { askUser: {} } },
        askUser: { type: 'USER_CHECK', description: 'Ask private workflow question', next: { end: {} } },
        end: { type: 'END', next: {} },
      },
    },
  } as unknown as RecipeDefinition;
}

function identityRecipe(): RecipeDefinition {
  return {
    recipeName: 'identity-recipe',
    version: 'v1',
    displayName: 'Identity recipe',
    flowGraph: {
      nodes: {
        tool: { type: 'TOOL', inputs: { tool_name: 'Read' }, next: {} },
        skill: { type: 'SKILL', inputs: { skill_name: 'network-diagnosis' }, next: {} },
        agent: { type: 'AGENT', inputs: { agent_name: 'network-agent' }, next: {} },
        subflow: { type: 'SUBFLOW', inputs: { recipe_name: 'alarm-recovery' }, next: {} },
        restful: { type: 'RESTFUL', inputs: { api_name: 'network-stream' }, next: {} },
        condition: { type: 'CONDITION', next: {} },
      },
    },
  } as unknown as RecipeDefinition;
}

function recipeWithDescription(): RecipeDefinition {
  return {
    recipeName: 'workflow-runtime-projector-test',
    version: 'v1',
    displayName: 'Workflow runtime projector test',
    flowGraph: {
      nodes: {
        callApi: { type: 'RESTFUL', description: '调用查询接口', next: {} },
      },
    },
  } as unknown as RecipeDefinition;
}

function recipeWithRestfulApiName(): RecipeDefinition {
  return {
    recipeName: 'workflow-runtime-projector-test',
    version: 'v1',
    displayName: 'Workflow runtime projector test',
    flowGraph: {
      nodes: {
        callApi: { type: 'RESTFUL', description: '调用查询接口', inputs: { api_name: 'queryDevice' }, next: {} },
      },
    },
  } as unknown as RecipeDefinition;
}

function recipeWithOutputParser(parser: Record<string, unknown>): RecipeDefinition {
  return {
    recipeName: 'workflow-runtime-projector-test',
    version: 'v1',
    displayName: 'Workflow runtime projector test',
    flowGraph: {
      nodes: {
        callApi: { type: 'RESTFUL', description: '调用查询接口', presentation: { outputParser: parser }, next: {} },
      },
    },
  } as unknown as RecipeDefinition;
}

function recipeWithChainAndOutputParser(parser: Record<string, unknown>): RecipeDefinition {
  return {
    recipeName: 'workflow-runtime-projector-test',
    version: 'v1',
    displayName: 'Workflow runtime projector test',
    flowGraph: {
      nodes: {
        start: { type: 'START', next: { callApi: {} } },
        callApi: { type: 'RESTFUL', description: '调用查询接口', presentation: { outputParser: parser }, next: { summarize: {} } },
        summarize: { type: 'LLM', description: '总结结果', presentation: { outputParser: parser }, next: { end: {} } },
        end: { type: 'END', next: {} },
      },
    },
  } as unknown as RecipeDefinition;
}

function recipeWithChain(): RecipeDefinition {
  return {
    recipeName: 'workflow-runtime-projector-test',
    version: 'v1',
    displayName: 'Workflow runtime projector test',
    flowGraph: {
      nodes: {
        start: { type: 'START', next: { callApi: {} } },
        callApi: { type: 'RESTFUL', description: '调用查询接口', next: { summarize: {} } },
        summarize: { type: 'LLM', description: '总结结果', next: { end: {} } },
        end: { type: 'END', next: {} },
      },
    },
  } as unknown as RecipeDefinition;
}

function recipeWithForkJoin(): RecipeDefinition {
  return {
    recipeName: 'workflow-runtime-projector-test',
    version: 'v1',
    displayName: 'Workflow runtime projector test',
    flowGraph: {
      nodes: {
        start: { type: 'START', next: { init: {} } },
        init: { type: 'DISPLAY', description: 'init way', next: { fork: {} } },
        fork: { type: 'PARALLEL', next: { branch_a: {}, branch_b: {} } },
        branch_a: { type: 'DISPLAY', description: 'branch a', next: { join_node: {} } },
        branch_b: { type: 'DISPLAY', description: 'branch b', next: { join_node: {} } },
        join_node: { type: 'DISPLAY', description: 'join', next: { summary: {} } },
        summary: { type: 'DISPLAY', description: 'summary', next: { end: {} } },
        end: { type: 'END', next: {} },
      },
    },
  } as unknown as RecipeDefinition;
}

describe('workflow runtime event projector - remote SUB scope fixes', () => {
  it('suppresses empty TITLE on NODE_STARTED when node has no description', () => {
    const projector = new WorkflowRuntimeEventProjector(recipe());

    const started = projector.project(event({ nodeId: 'synthetic-step-20', nodeType: 'TOOL', eventType: 'NODE_STARTED' }));

    expect(started.some((e) => e.type === 'CAPABILITY_STARTED')).toBe(true);
    expect(started.find((e) => e.type === 'TOOL_STRUCTURED_DELTA')).toBeUndefined();
  });

  it('maps fast-path level to SUB scope when levelScope is SUB', () => {
    const projector = new WorkflowRuntimeEventProjector(recipe(), 'SUB');

    const titleDelta = projector.project(
      event({
        nodeId: 'callTool',
        nodeType: 'TOOL',
        eventType: 'NODE_OUTPUT_DELTA',
        visibleDelta: { channel: 'CONTENT', content: 't', level: 'TITLE' },
      }),
    );
    const detailDelta = projector.project(
      event({
        nodeId: 'callTool',
        nodeType: 'TOOL',
        eventType: 'NODE_OUTPUT_DELTA',
        visibleDelta: { channel: 'CONTENT', content: 'd', level: 'DETAIL' },
      }),
    );
    const answerDelta = projector.project(
      event({
        nodeId: 'callTool',
        nodeType: 'TOOL',
        eventType: 'NODE_OUTPUT_DELTA',
        visibleDelta: { channel: 'CONTENT', content: 'a', level: 'ANSWER' },
      }),
    );

    expect(titleDelta[0]?.inlinePayload).toEqual(expect.objectContaining({ toolEventType: 'SUB_TITLE' }));
    expect(detailDelta[0]?.inlinePayload).toEqual(expect.objectContaining({ toolEventType: 'SUB_DETAIL' }));
    expect(answerDelta[0]?.inlinePayload).toEqual(expect.objectContaining({ toolEventType: 'SUB_CONCLUSION' }));
  });

  it('accumulates fast-path fragments into full content', () => {
    const projector = new WorkflowRuntimeEventProjector(recipe());

    const first = projector.project(
      event({
        nodeId: 'callTool',
        nodeType: 'TOOL',
        eventType: 'NODE_OUTPUT_DELTA',
        visibleDelta: { channel: 'CONTENT', content: 'hello ', level: 'ANSWER' },
      }),
    );
    const second = projector.project(
      event({
        nodeId: 'callTool',
        nodeType: 'TOOL',
        eventType: 'NODE_OUTPUT_DELTA',
        visibleDelta: { channel: 'CONTENT', content: 'world', level: 'ANSWER' },
      }),
    );

    expect(first[0]?.inlinePayload).toEqual(expect.objectContaining({ content: 'hello ' }));
    expect(second[0]?.inlinePayload).toEqual(expect.objectContaining({ content: 'hello world' }));
  });

  it('isolates and clears structured fragments per workflow node execution occurrence', () => {
    const projector = new WorkflowRuntimeEventProjector(recipe());

    const firstAttempt = projector.project(
      event({
        nodeId: 'callTool',
        nodeType: 'TOOL',
        nodeExecutionId: 'call-tool-attempt-1',
        eventType: 'NODE_OUTPUT_DELTA',
        visibleDelta: { channel: 'CONTENT', content: 'first attempt', level: 'DETAIL' },
      }),
    );
    const secondAttempt = projector.project(
      event({
        nodeId: 'callTool',
        nodeType: 'TOOL',
        nodeExecutionId: 'call-tool-attempt-2',
        eventType: 'NODE_OUTPUT_DELTA',
        visibleDelta: { channel: 'CONTENT', content: 'second attempt', level: 'DETAIL' },
      }),
    );
    const completedSecondAttempt = projector.project(
      event({
        nodeId: 'callTool',
        nodeType: 'TOOL',
        nodeExecutionId: 'call-tool-attempt-2',
        eventType: 'NODE_COMPLETED',
        output: { result: 'second attempt' },
        completedAt: new Date('2026-06-24T00:00:01.000Z'),
      }),
    );
    const freshAfterCompletion = projector.project(
      event({
        nodeId: 'callTool',
        nodeType: 'TOOL',
        nodeExecutionId: 'call-tool-attempt-2',
        eventType: 'NODE_OUTPUT_DELTA',
        visibleDelta: { channel: 'CONTENT', content: 'fresh content', level: 'DETAIL' },
      }),
    );

    expect(firstAttempt[0]?.inlinePayload).toEqual(expect.objectContaining({ nodeExecutionId: 'call-tool-attempt-1', content: 'first attempt' }));
    expect(secondAttempt[0]?.inlinePayload).toEqual(expect.objectContaining({ nodeExecutionId: 'call-tool-attempt-2', content: 'second attempt' }));
    expect(completedSecondAttempt.find((projected) => projected.type === 'TOOL_STRUCTURED_DELTA')?.inlinePayload).toEqual(
      expect.objectContaining({ nodeExecutionId: 'call-tool-attempt-2', content: 'second attempt' }),
    );
    expect(freshAfterCompletion[0]?.inlinePayload).toEqual(
      expect.objectContaining({ nodeExecutionId: 'call-tool-attempt-2', content: 'fresh content' }),
    );
  });

  it('uses LLM streamed content for persisted structured delta in tryOutputDrivenDelta', () => {
    const projector = new WorkflowRuntimeEventProjector(recipeWithChain());

    projector.project(
      event({
        nodeId: 'summarize',
        nodeType: 'LLM',
        eventType: 'NODE_OUTPUT_DELTA',
        visibleDelta: { channel: 'CONTENT', content: 'streamed detail' },
      }),
    );
    const completed = projector.project(
      event({
        nodeId: 'summarize',
        nodeType: 'LLM',
        eventType: 'NODE_COMPLETED',
        output: { level: 'detail', content: 'streamed detail' },
        completedAt: new Date('2026-06-24T00:00:01.000Z'),
      }),
    );

    const structured = completed.find((e) => e.type === 'TOOL_STRUCTURED_DELTA');
    expect(structured).toBeDefined();
    expect(structured?.inlinePayload).toEqual(expect.objectContaining({ content: 'streamed detail' }));
  });

  it('uses consistent capabilityId between CAPABILITY events and TOOL_STRUCTURED_DELTA', () => {
    const projector = new WorkflowRuntimeEventProjector(recipe());

    const started = projector.project(event({ nodeId: 'callTool', nodeType: 'TOOL', eventType: 'NODE_STARTED', input: { tool_name: 'code' } }));
    const completed = projector.project(
      event({
        nodeId: 'callTool',
        nodeType: 'TOOL',
        eventType: 'NODE_COMPLETED',
        output: { level: 'detail', content: 'result' },
        completedAt: new Date('2026-06-24T00:00:01.000Z'),
      }),
    );

    const capStarted = started.find((e) => e.type === 'CAPABILITY_STARTED');
    const structured = completed.find((e) => e.type === 'TOOL_STRUCTURED_DELTA');
    expect(capStarted?.inlinePayload?.capabilityId).toBe('code');
    expect(structured?.inlinePayload?.capabilityId).toBe('code');
    expect(structured?.inlinePayload?.toolCallId).toBe(capStarted?.inlinePayload?.toolCallId);
  });

  it('includes parentToolCallId in all events when provided', () => {
    const projector = new WorkflowRuntimeEventProjector(recipe(), 'SUB', 'outer-call-1');

    const started = projector.project(event({ nodeId: 'callTool', nodeType: 'TOOL', eventType: 'NODE_STARTED', input: { tool_name: 'code' } }));
    const delta = projector.project(
      event({
        nodeId: 'callTool',
        nodeType: 'TOOL',
        eventType: 'NODE_OUTPUT_DELTA',
        visibleDelta: { channel: 'CONTENT', content: 'frag', level: 'ANSWER' },
      }),
    );

    expect(started[0]?.inlinePayload?.parentToolCallId).toBe('outer-call-1');
    expect(delta[0]?.inlinePayload?.parentToolCallId).toBe('outer-call-1');
  });

  it('omits parentToolCallId when not provided', () => {
    const projector = new WorkflowRuntimeEventProjector(recipe());

    const started = projector.project(event({ nodeId: 'callTool', nodeType: 'TOOL', eventType: 'NODE_STARTED', input: { tool_name: 'code' } }));

    expect(started[0]?.inlinePayload).not.toHaveProperty('parentToolCallId');
  });

  it('maps output-driven level to SUB scope in tryOutputDrivenDelta', () => {
    const projector = new WorkflowRuntimeEventProjector(recipeWithChain(), 'SUB');

    const completed = projector.project(
      event({
        nodeId: 'callApi',
        nodeType: 'RESTFUL',
        eventType: 'NODE_COMPLETED',
        output: { level: 'detail', content: 'result' },
        completedAt: new Date('2026-06-24T00:00:01.000Z'),
      }),
    );

    const structured = completed.find((e) => e.type === 'TOOL_STRUCTURED_DELTA');
    expect(structured?.inlinePayload).toEqual(expect.objectContaining({ toolEventType: 'SUB_DETAIL' }));
  });
});
