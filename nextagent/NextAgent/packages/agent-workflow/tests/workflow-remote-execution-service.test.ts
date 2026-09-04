import { bindRuntimeLoggerProvider, type JsonObject, type RuntimeLogger, type RuntimeLoggerProviderBinding } from '@nextagent/agent-common';
import type {
  WorkflowExecutionEvent,
  WorkflowExecutionObserver,
  WorkflowExecutionResult,
  WorkflowRemoteExecutionGateway,
  WorkflowRemoteExecutionStreamItem,
} from '@nextagent/agent-contracts/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRemoteWorkflowExecutionService } from '../src/index.js';
import { baseRequest } from './test-helpers.js';

let loggerBinding: RuntimeLoggerProviderBinding | undefined;
afterEach(() => loggerBinding?.unbind());

function createService(gateway: WorkflowRemoteExecutionGateway, logger: RuntimeLogger) {
  loggerBinding?.unbind();
  loggerBinding = bindRuntimeLoggerProvider({ getLogger: () => logger });
  return createRemoteWorkflowExecutionService({ gateway });
}

function createFakeGateway(items: readonly WorkflowRemoteExecutionStreamItem[]): WorkflowRemoteExecutionGateway {
  return {
    async *execute(_request, _signal): AsyncIterable<WorkflowRemoteExecutionStreamItem> {
      for (const item of items) {
        yield item;
      }
    },
  };
}

function createLoggingGateway(
  items: readonly WorkflowRemoteExecutionStreamItem[],
  log: { receivedRequests: unknown[] },
): WorkflowRemoteExecutionGateway {
  return {
    async *execute(request, _signal): AsyncIterable<WorkflowRemoteExecutionStreamItem> {
      log.receivedRequests.push(request);
      for (const item of items) {
        yield item;
      }
    },
  };
}

function completedResult(executionId = 'remote-exec-1'): WorkflowExecutionResult {
  return {
    executionId,
    status: 'COMPLETED',
    outputVariables: { result: 'ok' },
    nodeResults: [],
    startedAt: new Date(),
    completedAt: new Date(),
  };
}

function makeEvent(executionId = 'remote-exec-1'): WorkflowExecutionEvent {
  return {
    executionId,
    nodeId: 'node-1',
    nodeType: 'START',
    eventType: 'NODE_STARTED',
    retryCount: 0,
    startedAt: new Date(),
  };
}

function createMemoryLogger(): RuntimeLogger {
  const entries: Array<{ level: string; obj: Record<string, unknown> }> = [];
  return {
    error(caughtOrFields, fieldsOrMsg?: object | string) {
      entries.push({ level: 'error', obj: (typeof fieldsOrMsg === 'object' ? fieldsOrMsg : caughtOrFields) as Record<string, unknown> });
    },
    warn(caughtOrFields, fieldsOrMsg?: object | string) {
      entries.push({ level: 'warn', obj: (typeof fieldsOrMsg === 'object' ? fieldsOrMsg : caughtOrFields) as Record<string, unknown> });
    },
    info(obj) {
      entries.push({ level: 'info', obj: obj as Record<string, unknown> });
    },
    debug(obj) {
      entries.push({ level: 'debug', obj: obj as Record<string, unknown> });
    },
  };
}

type MemoryLogger = RuntimeLogger & { entries: Array<{ level: string; obj: Record<string, unknown>; caught?: unknown }> };

function createMemoryLoggerWithEntries(): MemoryLogger {
  const entries: Array<{ level: string; obj: Record<string, unknown>; caught?: unknown }> = [];
  const capture = (level: 'error' | 'warn', fields: object): void => {
    const { err, ...safeFields } = fields as Record<string, unknown>;
    entries.push({ level, obj: safeFields, ...(err === undefined ? {} : { caught: err }) });
  };
  return {
    error(fields) {
      capture('error', fields);
    },
    warn(fields) {
      capture('warn', fields);
    },
    info(obj) {
      entries.push({ level: 'info', obj: obj as Record<string, unknown> });
    },
    debug(obj) {
      entries.push({ level: 'debug', obj: obj as Record<string, unknown> });
    },
    entries,
  };
}

describe('RemoteWorkflowExecutionService', () => {
  it('streams events in real time and returns completed result', async () => {
    const emittedEvents: WorkflowExecutionEvent[] = [];
    const observer: WorkflowExecutionObserver = {
      emitEvent(event) {
        emittedEvents.push(event);
      },
    };
    const gateway = createFakeGateway([
      { kind: 'event', event: makeEvent() },
      { kind: 'event', event: { ...makeEvent(), eventType: 'NODE_COMPLETED' } },
      { kind: 'result', result: completedResult() },
    ]);
    const service = createRemoteWorkflowExecutionService({ gateway });

    const result = await service.execute(baseRequest(), new AbortController().signal, observer);

    expect(result.status).toBe('COMPLETED');
    expect(emittedEvents).toHaveLength(2);
    expect(emittedEvents[0]?.eventType).toBe('NODE_STARTED');
    expect(emittedEvents[1]?.eventType).toBe('NODE_COMPLETED');
  });

  it('returns failed result when gateway yields failure item', async () => {
    const gateway = createFakeGateway([{ kind: 'failure', reasonCode: 'WORKFLOW_REMOTE_UNAVAILABLE', message: 'unreachable' }]);
    const service = createRemoteWorkflowExecutionService({ gateway });

    const result = await service.execute(baseRequest(), new AbortController().signal);

    expect(result.status).toBe('FAILED');
    if (result.status === 'FAILED') {
      const nodeResult = result.nodeResults[0];
      expect(nodeResult?.safeError?.code).toBe('WORKFLOW_REMOTE_UNAVAILABLE');
      expect(nodeResult?.safeError?.safeDetails?.reasonCode).toBe('WORKFLOW_REMOTE_UNAVAILABLE');
    }
  });

  it('maps all failure reasonCodes to SafeError', async () => {
    const reasonCodes = [
      'WORKFLOW_REMOTE_UNAVAILABLE',
      'WORKFLOW_REMOTE_TIMEOUT',
      'WORKFLOW_REMOTE_UNAUTHORIZED',
      'WORKFLOW_REMOTE_INVALID_RESPONSE',
    ] as const;

    for (const reasonCode of reasonCodes) {
      const gateway = createFakeGateway([{ kind: 'failure', reasonCode, message: 'fail' }]);
      const service = createRemoteWorkflowExecutionService({ gateway });
      const result = await service.execute(baseRequest(), new AbortController().signal);

      expect(result.status).toBe('FAILED');
      const nodeResult = result.nodeResults[0];
      expect(nodeResult?.safeError?.code).toBe(reasonCode);
      expect(nodeResult?.safeError?.safeDetails?.reasonCode).toBe(reasonCode);
    }
  });

  it('returns interrupted when signal already aborted', async () => {
    const gateway = createFakeGateway([{ kind: 'result', result: completedResult() }]);
    const service = createRemoteWorkflowExecutionService({ gateway });
    const controller = new AbortController();
    controller.abort();

    const result = await service.execute(baseRequest(), controller.signal);

    expect(result.status).toBe('INTERRUPTED');
  });

  it('returns interrupted when signal aborts during stream consumption', async () => {
    const controller = new AbortController();
    const gateway: WorkflowRemoteExecutionGateway = {
      async *execute(_request, _signal): AsyncIterable<WorkflowRemoteExecutionStreamItem> {
        yield { kind: 'event', event: makeEvent() };
        controller.abort();
        throw new Error('aborted');
      },
    };
    const service = createRemoteWorkflowExecutionService({ gateway });

    const result = await service.execute(baseRequest(), controller.signal);

    expect(result.status).toBe('INTERRUPTED');
  });

  it('skips event replay when no observer provided', async () => {
    const gateway = createFakeGateway([
      { kind: 'event', event: makeEvent() },
      { kind: 'result', result: completedResult() },
    ]);
    const service = createRemoteWorkflowExecutionService({ gateway });

    const result = await service.execute(baseRequest(), new AbortController().signal);

    expect(result.status).toBe('COMPLETED');
  });

  it('does not override local scope fields with remote response', async () => {
    const remoteResult: WorkflowExecutionResult = {
      ...completedResult(),
      startedAt: new Date('2020-01-01'),
      completedAt: new Date('2020-01-02'),
    };
    const gateway = createFakeGateway([{ kind: 'result', result: remoteResult }]);
    const service = createRemoteWorkflowExecutionService({ gateway });

    const result = await service.execute(baseRequest(), new AbortController().signal);

    expect(result.executionId).toBe('remote-exec-1');
    expect(result.status).toBe('COMPLETED');
    expect(result.outputVariables).toMatchObject({ result: 'ok' });
  });

  it('returns failed when stream ends without terminal item', async () => {
    const gateway = createFakeGateway([{ kind: 'event', event: makeEvent() }]);
    const service = createRemoteWorkflowExecutionService({ gateway });

    const result = await service.execute(baseRequest(), new AbortController().signal);

    expect(result.status).toBe('FAILED');
    const nodeResult = result.nodeResults[0];
    expect(nodeResult?.safeError?.code).toBe('WORKFLOW_REMOTE_INVALID_RESPONSE');
  });

  it('retains the caught stream exception and failure stage in owner-private diagnostics', async () => {
    const failure = new TypeError('remote provider body token=secret');
    const logger = createMemoryLoggerWithEntries();
    const gateway: WorkflowRemoteExecutionGateway = {
      async *execute() {
        throw failure;
      },
    };
    const service = createService(gateway, logger);

    const result = await service.execute(baseRequest(), new AbortController().signal);

    expect(result.status).toBe('FAILED');
    expect(logger.entries.filter((entry) => entry.obj.event === 'workflow.remote.failed')).toEqual([
      expect.objectContaining({
        level: 'error',
        caught: failure,
        obj: expect.objectContaining({
          failureStage: 'WORKFLOW_STREAM_CONSUME',
          safeReasonCode: 'WORKFLOW_REMOTE_INVALID_RESPONSE',
        }),
      }),
    ]);
  });

  it('passes resumeState to gateway', async () => {
    const log = { receivedRequests: [] as unknown[] };
    const gateway = createLoggingGateway([{ kind: 'result', result: completedResult() }], log);
    const service = createRemoteWorkflowExecutionService({ gateway });
    const request = { ...baseRequest(), resumeState: { executionId: 'prev-exec', answers: [['yes']] } as JsonObject };

    await service.execute(request, new AbortController().signal);

    expect(log.receivedRequests).toHaveLength(1);
    const receivedRequest = log.receivedRequests[0] as { resumeState?: JsonObject };
    expect(receivedRequest.resumeState).toBeDefined();
    expect(receivedRequest.resumeState?.executionId).toBe('prev-exec');
  });

  it('bridges WAITING pending input via local runtime', async () => {
    const waitingResult: WorkflowExecutionResult = {
      executionId: 'remote-waiting',
      status: 'WAITING',
      outputVariables: {},
      nodeResults: [],
      startedAt: new Date(),
      completedAt: new Date(),
      pendingInput: {
        kind: 'QUESTION',
        questions: [{ prompt: 'Choose?', options: [{ label: 'Yes', value: 'yes' }] }],
        resumeState: { executionId: 'remote-waiting', recipeName: 'test', nodeId: 'interaction', nodeType: 'INTERACTION', variables: {} },
      } as JsonObject,
    };
    const gateway = createFakeGateway([{ kind: 'result', result: waitingResult }]);
    const service = createRemoteWorkflowExecutionService({ gateway });

    const runtime = {
      requestPendingInput: vi.fn().mockResolvedValue({ id: 'local-pending-1', sessionId: 'session-local' }),
    };

    const result = await service.execute(baseRequest(), new AbortController().signal, undefined, runtime);

    expect(result.status).toBe('WAITING');
    expect(runtime.requestPendingInput).toHaveBeenCalledOnce();
    expect(result.pendingInput).toMatchObject({ id: 'local-pending-1' });
  });

  it('returns failed when WAITING but no runtime provided', async () => {
    const waitingResult: WorkflowExecutionResult = {
      executionId: 'remote-waiting',
      status: 'WAITING',
      outputVariables: {},
      nodeResults: [],
      startedAt: new Date(),
      completedAt: new Date(),
      pendingInput: {
        kind: 'QUESTION',
        questions: [{ prompt: 'Choose?', options: [{ label: 'Yes', value: 'yes' }] }],
        resumeState: { executionId: 'remote-waiting', recipeName: 'test', nodeId: 'interaction', nodeType: 'INTERACTION', variables: {} },
      } as JsonObject,
    };
    const gateway = createFakeGateway([{ kind: 'result', result: waitingResult }]);
    const service = createRemoteWorkflowExecutionService({ gateway });

    const result = await service.execute(baseRequest(), new AbortController().signal);

    expect(result.status).toBe('FAILED');
    const nodeResult = result.nodeResults[0];
    expect(nodeResult?.safeError?.code).toBe('WORKFLOW_REMOTE_PENDING_INPUT_RUNTIME_MISSING');
  });

  it('logs lifecycle events at key points', async () => {
    const logger = createMemoryLoggerWithEntries();
    const gateway = createFakeGateway([{ kind: 'result', result: completedResult() }]);
    const service = createService(gateway, logger);

    await service.execute(baseRequest(), new AbortController().signal);

    const events = logger.entries.map((e) => (e.obj as Record<string, unknown>).event);
    expect(events).toContain('workflow.remote.started');
    expect(events).toContain('workflow.remote.result');
  });

  it('does not log sensitive fields', async () => {
    const logger = createMemoryLoggerWithEntries();
    const gateway = createFakeGateway([
      { kind: 'failure', reasonCode: 'WORKFLOW_REMOTE_UNAUTHORIZED', message: 'Bearer sk-secret-token at /etc/passwd' },
    ]);
    const service = createService(gateway, logger);

    await service.execute(baseRequest(), new AbortController().signal);

    const allLogs = logger.entries.map((entry) => JSON.stringify(entry.obj)).join(' ');
    expect(allLogs).not.toContain('sk-secret-token');
    expect(allLogs).not.toContain('/etc/passwd');
  });
});

describe('RemoteWorkflowExecutionService logging', () => {
  it('records workflow.remote.started on execute begin', async () => {
    const entries: Array<{ level: string; event: string }> = [];
    const logger: RuntimeLogger = {
      error(obj) {
        entries.push({ level: 'error', event: (obj as Record<string, unknown>).event as string });
      },
      warn(obj) {
        entries.push({ level: 'warn', event: (obj as Record<string, unknown>).event as string });
      },
      info(obj) {
        entries.push({ level: 'info', event: (obj as Record<string, unknown>).event as string });
      },
      debug(obj) {
        entries.push({ level: 'debug', event: (obj as Record<string, unknown>).event as string });
      },
    };
    const gateway = createFakeGateway([{ kind: 'result', result: completedResult() }]);
    const service = createService(gateway, logger);

    await service.execute(baseRequest(), new AbortController().signal);

    expect(entries.some((e) => e.event === 'workflow.remote.started')).toBe(true);
    expect(entries.some((e) => e.event === 'workflow.remote.result')).toBe(true);
  });

  it('records workflow.remote.failed on failure item', async () => {
    const entries: Array<{ level: string; event: string; fields: Record<string, unknown> }> = [];
    const logger: RuntimeLogger = {
      error(obj) {
        const fields = obj as Record<string, unknown>;
        entries.push({ level: 'error', event: fields.event as string, fields });
      },
      warn(obj) {
        const fields = obj as Record<string, unknown>;
        entries.push({ level: 'warn', event: fields.event as string, fields });
      },
      info(obj) {
        const fields = obj as Record<string, unknown>;
        entries.push({ level: 'info', event: fields.event as string, fields });
      },
      debug(obj) {
        const fields = obj as Record<string, unknown>;
        entries.push({ level: 'debug', event: fields.event as string, fields });
      },
    };
    const gateway = createFakeGateway([{ kind: 'failure', reasonCode: 'WORKFLOW_REMOTE_TIMEOUT', message: 'timeout' }]);
    const service = createService(gateway, logger);

    await service.execute(baseRequest(), new AbortController().signal);

    expect(entries).toContainEqual(
      expect.objectContaining({
        event: 'workflow.remote.failed',
        level: 'error',
        fields: expect.objectContaining({ safeReasonCode: 'WORKFLOW_REMOTE_TIMEOUT' }),
      }),
    );
    expect(entries.flatMap((entry) => Object.keys(entry.fields))).not.toContain('reasonCode');
  });

  it('records workflow.remote.aborted on abort before gateway call', async () => {
    const entries: Array<{ level: string; event: string }> = [];
    const logger: RuntimeLogger = {
      error(obj) {
        entries.push({ level: 'error', event: (obj as Record<string, unknown>).event as string });
      },
      warn(obj) {
        entries.push({ level: 'warn', event: (obj as Record<string, unknown>).event as string });
      },
      info(obj) {
        entries.push({ level: 'info', event: (obj as Record<string, unknown>).event as string });
      },
      debug(obj) {
        entries.push({ level: 'debug', event: (obj as Record<string, unknown>).event as string });
      },
    };
    const gateway = createFakeGateway([{ kind: 'result', result: completedResult() }]);
    const service = createService(gateway, logger);
    const controller = new AbortController();
    controller.abort();

    await service.execute(baseRequest(), controller.signal);

    expect(entries.some((e) => e.event === 'workflow.remote.aborted' && e.level === 'warn')).toBe(true);
  });

  it('records workflow.remote.pending_input.bridged on WAITING bridge', async () => {
    const entries: Array<{ level: string; event: string }> = [];
    const logger: RuntimeLogger = {
      error(obj) {
        entries.push({ level: 'error', event: (obj as Record<string, unknown>).event as string });
      },
      warn(obj) {
        entries.push({ level: 'warn', event: (obj as Record<string, unknown>).event as string });
      },
      info(obj) {
        entries.push({ level: 'info', event: (obj as Record<string, unknown>).event as string });
      },
      debug(obj) {
        entries.push({ level: 'debug', event: (obj as Record<string, unknown>).event as string });
      },
    };
    const waitingResult: WorkflowExecutionResult = {
      executionId: 'remote-waiting',
      status: 'WAITING',
      outputVariables: {},
      nodeResults: [],
      startedAt: new Date(),
      completedAt: new Date(),
      pendingInput: {
        kind: 'QUESTION',
        questions: [{ prompt: 'Choose?', options: [{ label: 'Yes', value: 'yes' }] }],
        resumeState: { executionId: 'remote-waiting', recipeName: 'test', nodeId: 'interaction', nodeType: 'INTERACTION', variables: {} },
      } as JsonObject,
    };
    const gateway = createFakeGateway([{ kind: 'result', result: waitingResult }]);
    const service = createService(gateway, logger);
    const runtime = {
      requestPendingInput: vi.fn().mockResolvedValue({ id: 'local-pending-1', sessionId: 'session-local' }),
    };

    await service.execute(baseRequest(), new AbortController().signal, undefined, runtime);

    expect(entries.some((e) => e.event === 'workflow.remote.pending_input.bridged')).toBe(true);
  });

  it('records workflow.remote.pending_input.missing_runtime when WAITING without runtime', async () => {
    const entries: Array<{ level: string; event: string }> = [];
    const logger: RuntimeLogger = {
      error(obj) {
        entries.push({ level: 'error', event: (obj as Record<string, unknown>).event as string });
      },
      warn(obj) {
        entries.push({ level: 'warn', event: (obj as Record<string, unknown>).event as string });
      },
      info(obj) {
        entries.push({ level: 'info', event: (obj as Record<string, unknown>).event as string });
      },
      debug(obj) {
        entries.push({ level: 'debug', event: (obj as Record<string, unknown>).event as string });
      },
    };
    const waitingResult: WorkflowExecutionResult = {
      executionId: 'remote-waiting',
      status: 'WAITING',
      outputVariables: {},
      nodeResults: [],
      startedAt: new Date(),
      completedAt: new Date(),
      pendingInput: {
        kind: 'QUESTION',
        questions: [{ prompt: 'Choose?', options: [{ label: 'Yes', value: 'yes' }] }],
        resumeState: { executionId: 'remote-waiting', recipeName: 'test', nodeId: 'interaction', nodeType: 'INTERACTION', variables: {} },
      } as JsonObject,
    };
    const gateway = createFakeGateway([{ kind: 'result', result: waitingResult }]);
    const service = createService(gateway, logger);

    await service.execute(baseRequest(), new AbortController().signal);

    expect(entries.some((e) => e.event === 'workflow.remote.pending_input.missing_runtime' && e.level === 'error')).toBe(true);
  });
});
