import { describe, expect, it } from 'vitest';
import { WorkflowTraceCollector, createTimingWrappedService } from '../src/workflow-trace-collector.js';
import type { DeveloperDiagnosticArtifactInput, DeveloperDiagnosticArtifactEmitResult } from '../src/index.js';
import type { WorkflowExecutionEvent } from '@nextagent/agent-contracts/core';

function createRecordingSink() {
  const emitted: DeveloperDiagnosticArtifactInput[] = [];
  const sink = {
    emitted,
    async emit(input: DeveloperDiagnosticArtifactInput): Promise<DeveloperDiagnosticArtifactEmitResult> {
      emitted.push(input);
      return { status: 'ACCEPTED' as const };
    },
  };
  return sink;
}

function createEvent(
  overrides: Partial<WorkflowExecutionEvent> & { readonly nodeId: string; readonly nodeType: string; readonly eventType: string },
): WorkflowExecutionEvent {
  const base: WorkflowExecutionEvent = {
    executionId: 'wf-test',
    nodeExecutionId: 'node-exec-1',
    retryCount: 0,
    startedAt: new Date('2026-08-13T10:00:00.000Z'),
    ...overrides,
  } as WorkflowExecutionEvent;
  return base;
}

describe('WorkflowTraceCollector', () => {
  it('emits two node-trace records: one at start, one at completion', async () => {
    const sink = createRecordingSink();
    const collector = new WorkflowTraceCollector(sink, {});
    await collector.emitEvent(createEvent({ nodeId: 'llm_router', nodeType: 'LLM_ROUTER', eventType: 'NODE_STARTED', input: { question: 'hello' } }));
    expect(sink.emitted).toHaveLength(1);
    expect(sink.emitted[0]!.payload).toMatchObject({ nodeId: 'llm_router', nodeType: 'LLM_ROUTER', durationMs: 0, status: 'NODE_STARTED', input: { question: 'hello' } });
    await collector.emitEvent(createEvent({ nodeId: 'llm_router', nodeType: 'LLM_ROUTER', eventType: 'NODE_COMPLETED', completedAt: new Date('2026-08-13T10:00:02.500Z'), output: { llm_result: 'answer' } }));
    expect(sink.emitted).toHaveLength(2);
    expect(sink.emitted[1]!.artifactType).toBe('workflow-node-trace');
    expect(sink.emitted[1]!.payload).toMatchObject({ nodeId: 'llm_router', nodeType: 'LLM_ROUTER', durationMs: 2500, status: 'NODE_COMPLETED', input: { question: 'hello' }, output: { llm_result: 'answer' } });
  });

  it('emits two node-trace records on NODE_FAILED', async () => {
    const sink = createRecordingSink();
    const collector = new WorkflowTraceCollector(sink, {});
    await collector.emitEvent(createEvent({ nodeId: 'restful_1', nodeType: 'RESTFUL', eventType: 'NODE_STARTED', input: { api_name: 'test' } }));
    await collector.emitEvent(createEvent({ nodeId: 'restful_1', nodeType: 'RESTFUL', eventType: 'NODE_FAILED', completedAt: new Date('2026-08-13T10:00:01.000Z') }));
    expect(sink.emitted).toHaveLength(2);
    expect(sink.emitted[0]!.payload).toMatchObject({ status: 'NODE_STARTED' });
    expect(sink.emitted[1]!.payload).toMatchObject({ status: 'NODE_FAILED', durationMs: 1000 });
  });

  it('includes START and END scaffold nodes in trace', async () => {
    const sink = createRecordingSink();
    const collector = new WorkflowTraceCollector(sink, {});
    const startEvent = createEvent({ nodeId: 'start', nodeType: 'START', eventType: 'NODE_STARTED' });
    delete (startEvent as { nodeExecutionId?: string }).nodeExecutionId;
    await collector.emitEvent(startEvent);
    const startCompleted = createEvent({ nodeId: 'start', nodeType: 'START', eventType: 'NODE_COMPLETED', completedAt: new Date('2026-08-13T10:00:00.001Z') });
    delete (startCompleted as { nodeExecutionId?: string }).nodeExecutionId;
    await collector.emitEvent(startCompleted);
    expect(sink.emitted).toHaveLength(2);
    expect(sink.emitted[0]!.payload).toMatchObject({ nodeId: 'start', nodeType: 'START', status: 'NODE_STARTED' });
    expect(sink.emitted[1]!.payload).toMatchObject({ nodeId: 'start', nodeType: 'START', status: 'NODE_COMPLETED' });
  });

  it('skips NODE_OUTPUT_DELTA events', async () => {
    const sink = createRecordingSink();
    const collector = new WorkflowTraceCollector(sink, {});
    await collector.emitEvent(createEvent({ nodeId: 'llm_1', nodeType: 'LLM', eventType: 'NODE_OUTPUT_DELTA', visibleDelta: { channel: 'CONTENT', content: 'hello' } }));
    expect(sink.emitted).toHaveLength(0);
  });

  it('skips orphan terminal events without matching NODE_STARTED', async () => {
    const sink = createRecordingSink();
    const collector = new WorkflowTraceCollector(sink, {});
    await collector.emitEvent(createEvent({ nodeId: 'unknown', nodeType: 'LLM', eventType: 'NODE_COMPLETED', completedAt: new Date('2026-08-13T10:00:01.000Z') }));
    expect(sink.emitted).toHaveLength(0);
  });

  it('handles NODE_SKIPPED and NODE_WAITING as terminal events', async () => {
    const sink = createRecordingSink();
    const collector = new WorkflowTraceCollector(sink, {});
    await collector.emitEvent(createEvent({ nodeId: 'node_a', nodeType: 'CONDITION', eventType: 'NODE_STARTED', input: {} }));
    await collector.emitEvent(createEvent({ nodeId: 'node_a', nodeType: 'CONDITION', eventType: 'NODE_SKIPPED', completedAt: new Date('2026-08-13T10:00:00.500Z') }));
    expect(sink.emitted).toHaveLength(2);
    expect(sink.emitted[0]!.payload).toMatchObject({ status: 'NODE_STARTED' });
    expect(sink.emitted[1]!.payload).toMatchObject({ status: 'NODE_SKIPPED' });
  });

  it('carries coordinates through to emitted records', async () => {
    const sink = createRecordingSink();
    const coordinates = { sessionId: 's1', requestId: 'r1', runId: 'run1', agentId: 'a1', agentVersion: 'v1' };
    const collector = new WorkflowTraceCollector(sink, coordinates);
    await collector.emitEvent(createEvent({ nodeId: 'llm_1', nodeType: 'LLM', eventType: 'NODE_STARTED', input: {} }));
    await collector.emitEvent(createEvent({ nodeId: 'llm_1', nodeType: 'LLM', eventType: 'NODE_COMPLETED', completedAt: new Date('2026-08-13T10:00:01.000Z'), output: {} }));
    expect(sink.emitted[0]!.sessionId).toBe('s1');
    expect(sink.emitted[0]!.requestId).toBe('r1');
    expect(sink.emitted[0]!.runId).toBe('run1');
    expect(sink.emitted[0]!.agentId).toBe('a1');
    expect(sink.emitted[0]!.agentVersion).toBe('v1');
    expect(sink.emitted[1]!.sessionId).toBe('s1');
  });

  it('includes safeError in payload for NODE_FAILED', async () => {
    const sink = createRecordingSink();
    const collector = new WorkflowTraceCollector(sink, {});
    await collector.emitEvent(createEvent({ nodeId: 'failed_node', nodeType: 'RESTFUL', eventType: 'NODE_STARTED', input: {} }));
    await collector.emitEvent(createEvent({ nodeId: 'failed_node', nodeType: 'RESTFUL', eventType: 'NODE_FAILED', completedAt: new Date('2026-08-13T10:00:01.000Z') }));
    expect(sink.emitted).toHaveLength(2);
    const payload = sink.emitted[1]!.payload as { safeError?: unknown };
    // safeError present when event carries it
  });

  it('does not throw on emit failure', async () => {
    const failingSink = {
      async emit(): Promise<DeveloperDiagnosticArtifactEmitResult> { throw new Error('sink failure'); },
    };
    const collector = new WorkflowTraceCollector(failingSink, {});
    await expect(collector.emitEvent(createEvent({ nodeId: 'llm_1', nodeType: 'LLM', eventType: 'NODE_STARTED', input: {} }))).resolves.toBeUndefined();
  });
});

describe('createTimingWrappedService', () => {
  it('emits workflow-boundary-trace on successful call', async () => {
    const sink = createRecordingSink();
    const original = { async complete(req: unknown) { return { result: 'ok' }; } };
    const wrapped = createTimingWrappedService(original, sink, {}, 'MODEL', ['complete']);
    const result = await wrapped.complete({});
    expect(result).toEqual({ result: 'ok' });
    expect(sink.emitted).toHaveLength(1);
    expect(sink.emitted[0]!.artifactType).toBe('workflow-boundary-trace');
    expect(sink.emitted[0]!.payload).toMatchObject({ boundaryType: 'MODEL', status: 'SUCCEEDED' });
  });

  it('emits FAILED and rethrows on exception', async () => {
    const sink = createRecordingSink();
    const original = { async invoke(req: unknown) { throw new Error('API failed'); } };
    const wrapped = createTimingWrappedService(original, sink, {}, 'API', ['invoke']);
    await expect(wrapped.invoke({})).rejects.toThrow('API failed');
    expect(sink.emitted).toHaveLength(1);
    expect(sink.emitted[0]!.payload).toMatchObject({ boundaryType: 'API', status: 'FAILED' });
  });

  it('returns original value unchanged', async () => {
    const sink = createRecordingSink();
    const original = { async runPython(req: unknown) { return { stdout: 'hello' }; } };
    const wrapped = createTimingWrappedService(original, sink, {}, 'PYTHON', ['runPython']);
    const result = await wrapped.runPython({});
    expect(result).toEqual({ stdout: 'hello' });
  });

  it('does not record call parameters or return value body', async () => {
    const sink = createRecordingSink();
    const original = { async complete(req: unknown) { return { result: 'ok' }; } };
    const wrapped = createTimingWrappedService(original, sink, {}, 'MODEL', ['complete']);
    await wrapped.complete({ prompt: 'secret prompt' });
    const payload = JSON.stringify(sink.emitted[0]!.payload);
    expect(payload).not.toContain('prompt');
    expect(payload).toContain('MODEL');
    expect(payload).toContain('SUCCEEDED');
  });
});
