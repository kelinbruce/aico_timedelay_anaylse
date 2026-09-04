import { bindRuntimeLoggerProvider, type RuntimeLogger, type RuntimeLoggerProviderBinding } from '@nextagent/agent-common';
import type { WorkflowExecutionEvent } from '@nextagent/agent-contracts/core';
import { afterEach, describe, expect, it } from 'vitest';
import { createWorkflowExecutionService } from '../src/index.js';
import { baseRequest, node, recipe } from './test-helpers.js';

let loggerBinding: RuntimeLoggerProviderBinding | undefined;
afterEach(() => loggerBinding?.unbind());

function createRecordingLogger(): RuntimeLogger & { readonly calls: ReadonlyArray<{ level: string; obj: object; msg?: string }> } {
  const calls: Array<{ level: string; obj: object; msg?: string }> = [];
  return {
    calls,
    error(obj, msg) {
      calls.push(msg !== undefined ? { level: 'error', obj, msg } : { level: 'error', obj });
    },
    warn(obj, msg) {
      calls.push(msg !== undefined ? { level: 'warn', obj, msg } : { level: 'warn', obj });
    },
    info(obj, msg) {
      calls.push(msg !== undefined ? { level: 'info', obj, msg } : { level: 'info', obj });
    },
    debug(obj, msg) {
      calls.push(msg !== undefined ? { level: 'debug', obj, msg } : { level: 'debug', obj });
    },
  };
}

describe('workflow engine node logging', () => {
  it('logs node start with input keys and completion with output keys', async () => {
    const logger = createRecordingLogger();
    loggerBinding?.unbind();
    loggerBinding = bindRuntimeLoggerProvider({ getLogger: () => logger });
    const service = createWorkflowExecutionService({
      resolveRecipeDefinition: () =>
        recipe({
          start: node('START', { llm: {} }),
          llm: node('LLM', { end: {} }, { inputs: { question: 'hello' } }),
          end: node('END'),
        }),
    });

    await service.execute(baseRequest(), new AbortController().signal);

    const startLog = logger.calls.find(
      (c) =>
        c.level === 'debug' && (c.obj as { event?: string }).event === 'workflow.node.started' && (c.obj as { nodeId?: string }).nodeId === 'llm',
    );
    expect(startLog).toBeDefined();
    expect((startLog!.obj as { inputKeys?: string[] }).inputKeys).toEqual(['question']);

    const completedLog = logger.calls.find(
      (c) =>
        c.level === 'debug' && (c.obj as { event?: string }).event === 'workflow.node.completed' && (c.obj as { nodeId?: string }).nodeId === 'llm',
    );
    expect(completedLog).toBeDefined();
    expect((completedLog!.obj as { status?: string }).status).toBe('NODE_COMPLETED');
  });

  it('logs detailed error info when a node fails', async () => {
    const logger = createRecordingLogger();
    loggerBinding?.unbind();
    loggerBinding = bindRuntimeLoggerProvider({ getLogger: () => logger });
    const service = createWorkflowExecutionService({
      resolveRecipeDefinition: () =>
        recipe({
          start: node('START', { failing: {} }),
          failing: node(
            'KNOWLEDGE_SEARCH',
            { end: {} },
            {
              inputs: {},
              outputs: { knowledge_search_result: '${knowledge_search_result}' },
            },
          ),
          end: node('END'),
        }),
    });

    const result = await service.execute(baseRequest(), new AbortController().signal);
    expect(result.status).toBe('FAILED');

    const errorLog = logger.calls.find((c) => c.level === 'error' && (c.obj as { event?: string }).event === 'workflow.node.failed');
    expect(errorLog).toBeDefined();
    const fields = errorLog!.obj as Record<string, unknown>;
    expect(fields.nodeId).toBe('failing');
    expect(fields.nodeType).toBe('KNOWLEDGE_SEARCH');
    expect(fields.errorName).toBe('AgentError');
    expect(typeof fields.errorMessage).toBe('string');
    expect((fields.errorFields as { code?: string }).code).toBeDefined();
    expect((fields.errorFields as { category?: string }).category).toBeDefined();
  });

  it('logs workflow execution started with runId and startedAtEpochMs at info level', async () => {
    const logger = createRecordingLogger();
    loggerBinding?.unbind();
    loggerBinding = bindRuntimeLoggerProvider({ getLogger: () => logger });
    const service = createWorkflowExecutionService({
      resolveRecipeDefinition: () =>
        recipe({
          start: node('START', { llm: {} }),
          llm: node('LLM', { end: {} }, { inputs: { question: 'hello' } }),
          end: node('END'),
        }),
    });

    const request = baseRequest();
    await service.execute(request, new AbortController().signal);

    const startedLog = logger.calls.find((c) => c.level === 'info' && (c.obj as { event?: string }).event === 'workflow.execution.started');
    expect(startedLog).toBeDefined();
    const fields = startedLog!.obj as Record<string, unknown>;
    expect(fields.runId).toBe(request.runId);
    expect(fields.recipeName).toBe('workflow-test');
    expect(typeof fields.executionId).toBe('string');
    expect(typeof fields.startedAtEpochMs).toBe('number');
    expect(fields.startedAtEpochMs).toBeGreaterThan(0);
  });

  it('does not emit workflow.execution.started through observer as timeline event', async () => {
    const logger = createRecordingLogger();
    loggerBinding?.unbind();
    loggerBinding = bindRuntimeLoggerProvider({ getLogger: () => logger });
    const emittedEventTypes: string[] = [];
    const observer = {
      emitEvent(event: WorkflowExecutionEvent): void {
        emittedEventTypes.push(event.eventType);
      },
    };
    const service = createWorkflowExecutionService({
      resolveRecipeDefinition: () =>
        recipe({
          start: node('START', { llm: {} }),
          llm: node('LLM', { end: {} }, { inputs: { question: 'hello' } }),
          end: node('END'),
        }),
    });

    const request = baseRequest();
    await service.execute(request, new AbortController().signal, observer);

    const startedLog = logger.calls.find((c) => c.level === 'info' && (c.obj as { event?: string }).event === 'workflow.execution.started');
    expect(startedLog).toBeDefined();

    const diagnosticInObserver = emittedEventTypes.filter(
      (eventType) => eventType === 'WORKFLOW_EXECUTION_STARTED' || eventType === 'workflow.execution.started',
    );
    expect(diagnosticInObserver).toHaveLength(0);
  });
});
