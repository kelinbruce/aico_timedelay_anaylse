import { AgentError, bindRuntimeLoggerProvider, brand, type RuntimeLoggerProviderBinding } from '@nextagent/agent-common';
import type { RunTimelineEvent, RuntimeCommandPort, RuntimeSessionPort } from '@nextagent/agent-contracts/runtime';
import Fastify from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { registerTaskChannel } from '../src/routes.js';
import type { TaskAttachmentIntakeRuntime, TaskChannelDependencies } from '../src/routes.js';

let loggerBinding: RuntimeLoggerProviderBinding | undefined;
afterEach(() => loggerBinding?.unbind());

const ASYNC_CALLBACK_URL = 'https://ir.example/callback';

describe('Task channel API surface', () => {
  it('registers the current 9 endpoints under /api/v1/task, /api/v1/task/:taskId/stream, and /api/v1/tasks', async () => {
    const app = Fastify();
    await registerTaskChannel(app, makeDependencies());

    const createResponse = await app.inject({
      method: 'POST',
      url: '/api/v1/stream-task',
      headers: { 'content-type': 'application/json', 'x-tenant-id': 't1', 'x-subject-id': 'u1' },
      payload: createPayload('hello'),
    });
    expect(createResponse.statusCode).toBe(200);

    const editResponse = await app.inject({
      method: 'POST',
      url: '/api/v1/async-tasks/edit',
      headers: { 'content-type': 'application/json', 'x-tenant-id': 't1', 'x-subject-id': 'u1' },
      payload: editPayload('edited'),
    });
    expect(editResponse.statusCode).toBe(200);

    const cancelResponse = await app.inject({
      method: 'POST',
      url: '/api/v1/tasks/cancel',
      headers: { 'content-type': 'application/json', 'x-tenant-id': 't1', 'x-subject-id': 'u1' },
      payload: retryPayload(),
    });
    expect(cancelResponse.statusCode).toBe(200);

    const retryResponse = await app.inject({
      method: 'POST',
      url: '/api/v1/async-tasks/retry',
      headers: { 'content-type': 'application/json', 'x-tenant-id': 't1', 'x-subject-id': 'u1' },
      payload: retryPayload(),
    });
    expect(retryResponse.statusCode).toBe(200);

    const answerResponse = await app.inject({
      method: 'POST',
      url: '/api/v1/tasks/pending-inputs/answer',
      headers: { 'content-type': 'application/json', 'x-tenant-id': 't1', 'x-subject-id': 'u1' },
      payload: answerPayload([['yes']]),
    });
    expect(answerResponse.statusCode).toBe(200);

    const queryResponse = await app.inject({
      method: 'POST',
      url: '/api/v1/tasks/query',
      headers: { 'content-type': 'application/json', 'x-tenant-id': 't1', 'x-subject-id': 'u1' },
      payload: { tasks: [{ sessionId: 'sess-1', taskId: 'req-1' }] },
    });
    expect(queryResponse.statusCode).toBe(200);

    const asyncResponse = await app.inject({
      method: 'POST',
      url: '/api/v1/async-tasks',
      headers: { 'content-type': 'application/json', 'x-tenant-id': 't1', 'x-subject-id': 'u1' },
      payload: asyncCreatePayload('hello'),
    });
    expect(asyncResponse.statusCode).toBe(200);

    await app.close();
  });

  it('returns 404 for append-request endpoint', async () => {
    const app = Fastify();
    await registerTaskChannel(app, makeDependencies());
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/tasks/sess-1/submit',
      headers: { 'content-type': 'application/json', 'x-tenant-id': 't1', 'x-subject-id': 'u1' },
      payload: { inputText: 'test' },
    });
    expect(response.statusCode).toBe(404);
    await app.close();
  });

  it('returns 404 for stop endpoint', async () => {
    const app = Fastify();
    await registerTaskChannel(app, makeDependencies());
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/tasks/sess-1/stop',
      headers: { 'content-type': 'application/json', 'x-tenant-id': 't1', 'x-subject-id': 'u1' },
      payload: {},
    });
    expect(response.statusCode).toBe(404);
    await app.close();
  });

  it('returns 404 for resume endpoint', async () => {
    const app = Fastify();
    await registerTaskChannel(app, makeDependencies());
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/tasks/sess-1/resume',
      headers: { 'content-type': 'application/json', 'x-tenant-id': 't1', 'x-subject-id': 'u1' },
      payload: {},
    });
    expect(response.statusCode).toBe(404);
    await app.close();
  });

  it('returns 404 for conversation history endpoint', async () => {
    const app = Fastify();
    await registerTaskChannel(app, makeDependencies());
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/tasks/sess-1/conversation',
      headers: { 'x-tenant-id': 't1', 'x-subject-id': 'u1' },
    });
    expect(response.statusCode).toBe(404);
    await app.close();
  });

  it('returns 404 for task detail endpoint', async () => {
    const app = Fastify();
    await registerTaskChannel(app, makeDependencies());
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/tasks/sess-1',
      headers: { 'x-tenant-id': 't1', 'x-subject-id': 'u1' },
    });
    expect(response.statusCode).toBe(404);
    await app.close();
  });

  it('returns 404 for GET on create path', async () => {
    const app = Fastify();
    await registerTaskChannel(app, makeDependencies());
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/stream-task',
      headers: { 'x-tenant-id': 't1', 'x-subject-id': 'u1' },
    });
    expect(response.statusCode).toBe(404);
    await app.close();
  });

  it('returns 404 for delete task endpoint', async () => {
    const app = Fastify();
    await registerTaskChannel(app, makeDependencies());
    const response = await app.inject({
      method: 'DELETE',
      url: '/api/v1/tasks/sess-1',
      headers: { 'x-tenant-id': 't1', 'x-subject-id': 'u1' },
    });
    expect(response.statusCode).toBe(404);
    await app.close();
  });

  it('returns 404 for WS stream endpoint', async () => {
    const app = Fastify();
    await registerTaskChannel(app, makeDependencies());
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/task/req-1/ws',
      headers: { 'x-tenant-id': 't1', 'x-subject-id': 'u1' },
    });
    expect(response.statusCode).toBe(404);
    await app.close();
  });
});

describe('route prefix P (prepended in front of /api/v1)', () => {
  it('mounts async-tasks at /svcA/api/v1/async-tasks and 404s /api/v1/async-tasks when P=/svcA', async () => {
    const app = Fastify();
    await registerTaskChannel(app, makeDependencies({ routePrefix: '/svcA' }));

    const prefixed = await app.inject({
      method: 'POST',
      url: '/svcA/api/v1/async-tasks',
      headers: { 'content-type': 'application/json', 'x-tenant-id': 't1', 'x-subject-id': 'u1' },
      payload: asyncCreatePayload('hello'),
    });
    expect(prefixed.statusCode).toBe(200);

    const unprefixed = await app.inject({
      method: 'POST',
      url: '/api/v1/async-tasks',
      headers: { 'content-type': 'application/json', 'x-tenant-id': 't1', 'x-subject-id': 'u1' },
      payload: asyncCreatePayload('hello'),
    });
    expect(unprefixed.statusCode).toBe(404);
    await app.close();
  });

  it('mounts all task routes under the prefix when P=/svcA', async () => {
    const app = Fastify();
    await registerTaskChannel(app, makeDependencies({ routePrefix: '/svcA' }));

    const cases = [
      { method: 'POST', url: '/svcA/api/v1/stream-task', payload: createPayload('hello') },
      { method: 'POST', url: '/svcA/api/v1/async-tasks', payload: asyncCreatePayload('hello') },
      { method: 'POST', url: '/svcA/api/v1/async-tasks/edit', payload: editPayload('edited') },
      { method: 'POST', url: '/svcA/api/v1/async-tasks/retry', payload: retryPayload() },
      { method: 'POST', url: '/svcA/api/v1/tasks/cancel', payload: retryPayload() },
      { method: 'POST', url: '/svcA/api/v1/tasks/pending-inputs/answer', payload: answerPayload([['yes']]) },
      { method: 'POST', url: '/svcA/api/v1/tasks/query', payload: { tasks: [{ sessionId: 'sess-1', taskId: 'req-1' }] } },
    ];
    for (const c of cases) {
      const res = await app.inject({
        method: c.method as 'POST',
        url: c.url,
        headers: { 'content-type': 'application/json', 'x-tenant-id': 't1', 'x-subject-id': 'u1' },
        payload: c.payload,
      });
      expect(res.statusCode, `${c.url}`).not.toBe(404);
    }

    // Unprefixed equivalents must miss.
    const stale = await app.inject({
      method: 'POST',
      url: '/api/v1/tasks/cancel',
      headers: { 'content-type': 'application/json', 'x-tenant-id': 't1', 'x-subject-id': 'u1' },
      payload: retryPayload(),
    });
    expect(stale.statusCode).toBe(404);
    await app.close();
  });

  it('keeps /api/v1/... when P is the default /', async () => {
    const app = Fastify();
    await registerTaskChannel(app, makeDependencies());

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/async-tasks',
      headers: { 'content-type': 'application/json', 'x-tenant-id': 't1', 'x-subject-id': 'u1' },
      payload: asyncCreatePayload('hello'),
    });
    expect(res.statusCode).toBe(200);
    await app.close();
  });
});

describe('POST /api/v1/stream-task create', () => {
  it('returns SSE stream with TASK_ACCEPTED as first event', async () => {
    const deps = makeDependencies();
    deps.sessions.streamEvents = vi.fn(async function* () {
      yield {
        eventId: 'evt-1',
        sessionId: brand<string, 'SessionId'>('sess-create'),
        requestId: brand<string, 'MessageId'>('req-create'),
        runId: brand<string, 'RequestRunId'>('run-create'),
        requestContextId: brand<string, 'RequestContextId'>('ctx-create'),
        sequence: brand<number, 'TimelineSequence'>(1),
        type: 'REQUEST_ACCEPTED' as const,
        inlinePayload: {},
        createdAt: new Date(10),
      };
    });
    const app = Fastify();
    await registerTaskChannel(app, deps);
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/stream-task',
      headers: { 'content-type': 'application/json', 'x-tenant-id': 't1', 'x-subject-id': 'u1' },
      payload: createPayload('analyze alarm'),
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('text/event-stream');
    const dataLines = response.body.split('\n').filter((l) => l.startsWith('data:'));
    expect(dataLines.length).toBeGreaterThanOrEqual(1);
    const acceptedLine = dataLines.find((l) => l.includes('TASK_ACCEPTED'));
    expect(acceptedLine).toBeDefined();
    await app.close();
  });

  it('accepts optional idempotencyKey', async () => {
    const app = Fastify();
    await registerTaskChannel(app, makeDependencies());
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/stream-task',
      headers: { 'content-type': 'application/json', 'x-tenant-id': 't1', 'x-subject-id': 'u1' },
      payload: { ...createPayload('test'), idempotencyKey: 'client-key-1' },
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('text/event-stream');
    await app.close();
  });

  it('maps metadata.eventId only when the injected trace policy is enabled', async () => {
    const enabled = { ...makeDependencies(), traceEnabled: true };
    const enabledApp = Fastify();
    await registerTaskChannel(enabledApp, enabled);
    await enabledApp.inject({
      method: 'POST',
      url: '/api/v1/stream-task',
      headers: { 'content-type': 'application/json', 'x-tenant-id': 't1', 'x-subject-id': 'u1' },
      payload: {
        ...createPayload('trace me'),
        taskMessages: [{ text: 'trace me', metadata: { eventId: 'event-01' } }],
        idempotencyKey: 'key-event-enabled',
      },
    });
    expect(enabled.runtime.submit).toHaveBeenCalledWith(
      expect.objectContaining({
        propagationAttributes: { taskEventId: 'event-01' },
      }),
    );
    await enabledApp.close();

    const disabled = { ...makeDependencies(), traceEnabled: false };
    const disabledApp = Fastify();
    await registerTaskChannel(disabledApp, disabled);
    await disabledApp.inject({
      method: 'POST',
      url: '/api/v1/stream-task',
      headers: { 'content-type': 'application/json', 'x-tenant-id': 't1', 'x-subject-id': 'u1' },
      payload: {
        ...createPayload('do not trace'),
        taskMessages: [{ text: 'do not trace', metadata: { eventId: 'event-02' } }],
        idempotencyKey: 'key-event-disabled',
      },
    });
    expect(disabled.runtime.submit).toHaveBeenCalledWith(expect.not.objectContaining({ propagationAttributes: expect.anything() }));
    await disabledApp.close();
  });

  it('cleans up session when stream-task submit fails before run acceptance', async () => {
    const deps = makeDependencies();
    deps.runtime.submit = vi.fn(async () => {
      throw new AgentError({
        code: 'CAPABILITY_DIRECTIVE_EFFECTIVE_QUESTION_EMPTY',
        message: 'Capability directive stripped the effective user question to empty.',
        category: 'VALIDATION',
        retryable: false,
      });
    });
    const app = Fastify();
    await registerTaskChannel(app, deps);
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/stream-task',
      headers: { 'content-type': 'application/json', 'x-tenant-id': 't1', 'x-subject-id': 'u1' },
      payload: createPayload('$workflow:recipe_name'),
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('CAPABILITY_DIRECTIVE_EFFECTIVE_QUESTION_EMPTY');
    expect(deps.sessions.deleteSession).toHaveBeenCalledTimes(1);
    await app.close();
  });
});

describe('GET /api/v1/task/:taskId/stream', () => {
  it('returns 404 for GET stream endpoint', async () => {
    const app = Fastify();
    await registerTaskChannel(app, makeDependencies());
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/task/req-create/stream?sessionId=sess-create',
      headers: { 'x-tenant-id': 't1', 'x-subject-id': 'u1' },
    });
    expect(response.statusCode).toBe(404);
    await app.close();
  });

  it('returns 404 for GET stream without sessionId', async () => {
    const app = Fastify();
    await registerTaskChannel(app, makeDependencies());
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/task/req-create/stream',
      headers: { 'x-tenant-id': 't1', 'x-subject-id': 'u1' },
    });
    expect(response.statusCode).toBe(404);
    await app.close();
  });
});
describe('POST /api/v1/tasks/async create task', () => {
  it('isolates invalid eventId failures within an async JSON batch', async () => {
    const dependencies = { ...makeDependencies(), traceEnabled: true };
    const app = Fastify();
    await registerTaskChannel(app, dependencies);

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/async-tasks',
      headers: {
        'content-type': 'application/json',
        'x-tenant-id': 't1',
        'x-subject-id': 'u1',
      },
      payload: {
        tasks: [
          {
            taskMessages: [{ text: 'invalid item', metadata: { eventId: 'invalid/event' } }],
            callbackTarget: { url: ASYNC_CALLBACK_URL },
          },
          {
            taskMessages: [{ text: 'valid item', metadata: { eventId: 'event-02' } }],
            callbackTarget: { url: ASYNC_CALLBACK_URL },
          },
        ],
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().results).toEqual([
      {
        error: {
          code: 'REQUEST_VALIDATION_FAILED',
          message: expect.any(String),
          retryable: expect.any(Boolean),
        },
      },
      expect.objectContaining({ taskStatus: 'TASK_ACCEPTED' }),
    ]);
    expect(dependencies.runtime.submit).toHaveBeenCalledTimes(1);
    expect(dependencies.runtime.submit).toHaveBeenCalledWith(
      expect.objectContaining({
        propagationAttributes: { taskEventId: 'event-02' },
      }),
    );
    await app.close();
  });

  it('creates session and submits request with JSON body', async () => {
    const deps = makeDependencies();
    const app = Fastify();
    await registerTaskChannel(app, deps);
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/async-tasks',
      headers: { 'content-type': 'application/json', 'x-tenant-id': 't1', 'x-subject-id': 'u1' },
      payload: asyncCreatePayload('analyze alarm'),
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.results[0].sessionId).toBe('sess-create');
    expect(body.results[0].taskId).toBe('req-create');
    expect(body.results[0]).not.toHaveProperty('runId');
    expect(body.results[0]).not.toHaveProperty('requestId');
    expect(body.results[0].taskStatus).toBe('TASK_ACCEPTED');
    expect(deps.runtime.submit).toHaveBeenCalledTimes(1);
    await app.close();
  });

  it('requires tasks array', async () => {
    const app = Fastify();
    await registerTaskChannel(app, makeDependencies());
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/async-tasks',
      headers: { 'content-type': 'application/json', 'x-tenant-id': 't1', 'x-subject-id': 'u1' },
      payload: { taskMessages: [{ text: 'test' }] },
    });
    expect(response.statusCode).toBe(400);
    await app.close();
  });

  it('requires callbackTarget for async-task items', async () => {
    const app = Fastify();
    await registerTaskChannel(app, makeDependencies());
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/async-tasks',
      headers: { 'content-type': 'application/json', 'x-tenant-id': 't1', 'x-subject-id': 'u1' },
      payload: { tasks: [{ taskMessages: [{ text: 'test' }] }] },
    });
    expect(response.statusCode).toBe(400);
    await app.close();
  });

  it('rejects async-task when callback delivery port is unavailable', async () => {
    const app = Fastify();
    await registerTaskChannel(app, makeDependencies({ withCallbackPort: false }));
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/async-tasks',
      headers: { 'content-type': 'application/json', 'x-tenant-id': 't1', 'x-subject-id': 'u1' },
      payload: { tasks: [{ taskMessages: [{ text: 'test' }], callbackTarget: { url: ASYNC_CALLBACK_URL } }] },
    });
    expect(response.statusCode).toBe(503);
    await app.close();
  });

  it.each(['inputText', 'routingConstraints', 'callbackClipTarget'])('strips removed public field %s from body', async (field) => {
    const deps = makeDependencies();
    const app = Fastify();
    await registerTaskChannel(app, deps);
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/async-tasks',
      headers: { 'content-type': 'application/json', 'x-tenant-id': 't1', 'x-subject-id': 'u1' },
      payload: { ...asyncCreatePayload('test'), [field]: field === 'inputText' ? 'legacy' : {} },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().results[0].taskStatus).toBe('TASK_ACCEPTED');
    await app.close();
  });

  it('always creates new session for async create', async () => {
    const deps = makeDependencies();
    const app = Fastify();
    await registerTaskChannel(app, deps);
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/async-tasks',
      headers: { 'content-type': 'application/json', 'x-tenant-id': 't1', 'x-subject-id': 'u1' },
      payload: asyncCreatePayload('follow up'),
    });
    expect(response.statusCode).toBe(200);
    expect(deps.sessions.createSession).toHaveBeenCalledTimes(1);
    await app.close();
  });

  it('rejects an unsafe async callback target before session or request side effects', async () => {
    const base = makeDependencies();
    const deps: TaskChannelDependencies = {
      ...base,
      callbackDeliveryPort: {
        validateTarget() {
          throw new AgentError({
            code: 'TASK_CALLBACK_TARGET_REJECTED',
            message: 'Task callback target is not allowed.',
            category: 'AUTHORIZATION',
            retryable: false,
          });
        },
        deliver: vi.fn(async () => true),
      },
    };
    const app = Fastify();
    await registerTaskChannel(app, deps);
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/async-tasks',
      headers: { 'content-type': 'application/json', 'x-tenant-id': 't1', 'x-subject-id': 'u1' },
      payload: {
        tasks: [{ taskMessages: [{ text: 'test' }], callbackTarget: { url: 'https://evil.example/callback' } }],
      },
    });
    const body = response.json();
    expect(response.statusCode).toBe(400);
    expect(body.results[0].error.code).toBe('TASK_CALLBACK_TARGET_REJECTED');
    expect(deps.sessions.createSession).not.toHaveBeenCalled();
    expect(deps.runtime.submit).not.toHaveBeenCalled();
    await app.close();
  });

  it('routes inline raw fileContent through attachment intake before submit', async () => {
    const deps = makeDependencies();
    deps.runtime.reserveSubmit = vi.fn(async () => ({
      sessionId: brand<string, 'SessionId'>('sess-create'),
      agentId: brand<string, 'AgentId'>('agent-1'),
      reservationId: brand<string, 'AttachmentIntakeReservationId'>('reservation-1'),
      requestId: brand<string, 'MessageId'>('req-reserved'),
      runId: brand<string, 'RequestRunId'>('run-reserved'),
      requestContextId: brand<string, 'RequestContextId'>('context-reserved'),
      replay: false,
    }));
    const app = Fastify();
    await registerTaskChannel(app, deps);
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/async-tasks',
      headers: { 'content-type': 'application/json', 'x-tenant-id': 't1', 'x-subject-id': 'u1' },
      payload: {
        tasks: [
          {
            taskMessages: [{ fileContent: { raw: Buffer.from('alarm details').toString('base64'), filename: 'alarm.txt', mediaType: 'text/plain' } }],
            callbackTarget: { url: ASYNC_CALLBACK_URL },
          },
        ],
      },
    });
    expect(response.statusCode).toBe(200);
    expect(deps.attachmentRuntime.intake).toHaveBeenCalledWith(
      expect.objectContaining({
        files: [expect.objectContaining({ fileName: 'alarm.txt', declaredMimeType: 'text/plain', sizeBytes: 13 })],
      }),
    );
    expect(deps.runtime.submit).toHaveBeenCalledWith(expect.objectContaining({ attachmentIds: ['att-1'] }));
    expect(deps.runtime.submit).toHaveBeenCalledWith(
      expect.objectContaining({
        reservedRequest: {
          reservationId: 'reservation-1',
          requestId: 'req-reserved',
          runId: 'run-reserved',
          requestContextId: 'context-reserved',
        },
      }),
    );
    await app.close();
  });

  it('rejects remote fileContent without creating a session or submitting a request', async () => {
    const deps = makeDependencies();
    const app = Fastify();
    await registerTaskChannel(app, deps);
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/async-tasks',
      headers: { 'content-type': 'application/json', 'x-tenant-id': 't1', 'x-subject-id': 'u1' },
      payload: {
        tasks: [
          {
            taskMessages: [{ fileContent: { url: 'https://files.example/alarm.txt', filename: 'alarm.txt', mediaType: 'text/plain' } }],
            callbackTarget: { url: ASYNC_CALLBACK_URL },
          },
        ],
      },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().results[0].error.code).toBe('ATTACHMENT_REMOTE_URL_UNAVAILABLE');
    expect(deps.sessions.createSession).not.toHaveBeenCalled();
    expect(deps.runtime.submit).not.toHaveBeenCalled();
    await app.close();
  });

  it('does not submit when inline attachment intake rejects the file', async () => {
    const deps = makeDependencies();
    deps.runtime.reserveSubmit = vi.fn(async () => ({
      sessionId: brand<string, 'SessionId'>('sess-create'),
      agentId: brand<string, 'AgentId'>('agent-1'),
      reservationId: brand<string, 'AttachmentIntakeReservationId'>('reservation-rejected'),
      requestId: brand<string, 'MessageId'>('req-rejected'),
      runId: brand<string, 'RequestRunId'>('run-rejected'),
      requestContextId: brand<string, 'RequestContextId'>('context-rejected'),
      replay: false,
    }));
    deps.attachmentRuntime.intake = vi.fn(async () => ({
      status: 'REJECTED' as const,
      attachmentIds: [],
      rejected: [{ reasonCode: 'ATTACHMENT_TYPE_UNSUPPORTED' }],
    }));
    const app = Fastify();
    await registerTaskChannel(app, deps);
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/async-tasks',
      headers: { 'content-type': 'application/json', 'x-tenant-id': 't1', 'x-subject-id': 'u1' },
      payload: {
        tasks: [
          {
            taskMessages: [
              { fileContent: { raw: Buffer.from('binary').toString('base64'), filename: 'alarm.bin', mediaType: 'application/octet-stream' } },
            ],
            callbackTarget: { url: ASYNC_CALLBACK_URL },
          },
        ],
      },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().results[0].error).toBeDefined();
    expect(deps.runtime.submit).not.toHaveBeenCalled();
    await app.close();
  });

  it('strips owner/agent fields from request body without overriding identity', async () => {
    const deps = makeDependencies();
    const app = Fastify();
    await registerTaskChannel(app, deps);
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/async-tasks',
      headers: { 'content-type': 'application/json', 'x-tenant-id': 't1', 'x-subject-id': 'u1' },
      payload: { ...asyncCreatePayload('test'), tenantId: 'hacked' },
    });
    expect(response.statusCode).toBe(200);
    const submitCall = (deps.runtime.submit as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(submitCall.identityContext.tenantId).toBe('t1');
    await app.close();
  });

  it('accepts metadata but does not forward to runtime', async () => {
    const deps = makeDependencies();
    const app = Fastify();
    await registerTaskChannel(app, deps);
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/async-tasks',
      headers: { 'content-type': 'application/json', 'x-tenant-id': 't1', 'x-subject-id': 'u1' },
      payload: { tasks: [{ taskMessages: [{ text: 'test', metadata: { source: 'NMS' } }], callbackTarget: { url: ASYNC_CALLBACK_URL } }] },
    });
    expect(response.statusCode).toBe(200);
    const submitCall = (deps.runtime.submit as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(submitCall).not.toHaveProperty('metadata');
    await app.close();
  });

  it('returns per-item error for NOT_FOUND', async () => {
    const deps = makeDependencies();
    deps.runtime.submit = vi.fn(async () => {
      throw new AgentError({ code: 'SESSION_NOT_FOUND', message: 'not found', category: 'NOT_FOUND', retryable: false });
    });
    const app = Fastify();
    await registerTaskChannel(app, deps);
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/async-tasks',
      headers: { 'content-type': 'application/json', 'x-tenant-id': 't1', 'x-subject-id': 'u1' },
      payload: asyncCreatePayload('test'),
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().results[0].error.code).toBe('SESSION_NOT_FOUND');
    await app.close();
  });

  it('returns per-item error for CONFLICT', async () => {
    const deps = makeDependencies();
    deps.runtime.submit = vi.fn(async () => {
      throw new AgentError({ code: 'TERMINAL_COMMIT_PENDING', message: 'pending', category: 'CONFLICT', retryable: false });
    });
    const app = Fastify();
    await registerTaskChannel(app, deps);
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/async-tasks',
      headers: { 'content-type': 'application/json', 'x-tenant-id': 't1', 'x-subject-id': 'u1' },
      payload: asyncCreatePayload('test'),
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().results[0].error.code).toBe('TERMINAL_COMMIT_PENDING');
    await app.close();
  });

  it('cleans up session when submit fails before run acceptance', async () => {
    const deps = makeDependencies({ withCallbackPort: true });
    deps.runtime.submit = vi.fn(async () => {
      throw new AgentError({
        code: 'CAPABILITY_DIRECTIVE_EFFECTIVE_QUESTION_EMPTY',
        message: 'Capability directive stripped the effective user question to empty.',
        category: 'VALIDATION',
        retryable: false,
      });
    });
    const app = Fastify();
    await registerTaskChannel(app, deps);
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/async-tasks',
      headers: { 'content-type': 'application/json', 'x-tenant-id': 't1', 'x-subject-id': 'u1' },
      payload: asyncCreatePayload('test'),
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().results[0].error.code).toBe('CAPABILITY_DIRECTIVE_EFFECTIVE_QUESTION_EMPTY');
    expect(deps.sessions.deleteSession).toHaveBeenCalledTimes(1);
    await app.close();
  });

  it('returns sessionId and request-backed taskId without requestId alias', async () => {
    const app = Fastify();
    await registerTaskChannel(app, makeDependencies());
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/async-tasks',
      headers: { 'content-type': 'application/json', 'x-tenant-id': 't1', 'x-subject-id': 'u1' },
      payload: asyncCreatePayload('test'),
    });
    const body = response.json();
    expect(body.results[0]).toHaveProperty('taskId');
    expect(body.results[0]).toHaveProperty('sessionId');
    expect(body.results[0]).not.toHaveProperty('requestId');
    await app.close();
  });

  it('returns 400 when all items in a batch fail', async () => {
    const deps = makeDependencies();
    deps.runtime.submit = vi.fn(async () => {
      throw new AgentError({ code: 'SESSION_NOT_FOUND', message: 'not found', category: 'NOT_FOUND', retryable: false });
    });
    const app = Fastify();
    await registerTaskChannel(app, deps);
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/async-tasks',
      headers: { 'content-type': 'application/json', 'x-tenant-id': 't1', 'x-subject-id': 'u1' },
      payload: {
        tasks: [
          { taskMessages: [{ text: 'fail-1' }], callbackTarget: { url: ASYNC_CALLBACK_URL } },
          { taskMessages: [{ text: 'fail-2' }], callbackTarget: { url: ASYNC_CALLBACK_URL } },
        ],
      },
    });
    expect(response.statusCode).toBe(400);
    const body = response.json();
    expect(body.results).toHaveLength(2);
    expect(body.results[0].error).toBeDefined();
    expect(body.results[1].error).toBeDefined();
    await app.close();
  });
});

describe('POST /api/v1/tasks/cancel', () => {
  it('returns taskStatus TASK_CANCELED', async () => {
    const deps = makeDependencies();
    const app = Fastify();
    await registerTaskChannel(app, deps);
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/tasks/cancel',
      headers: { 'content-type': 'application/json', 'x-tenant-id': 't1', 'x-subject-id': 'u1' },
      payload: retryPayload(),
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.results[0]).toMatchObject({ sessionId: 'sess-1', taskId: 'req-1', taskStatus: 'TASK_CANCELED' });
    expect(deps.runtime.cancel).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: 'sess-1',
        expectedLatestRequestId: 'req-1',
      }),
    );
    await app.close();
  });

  it('maps runtime CONFLICT to 409 on terminal run', async () => {
    const deps = makeDependencies();
    deps.runtime.cancel = vi.fn(async () => {
      throw new AgentError({ code: 'CANCEL_CONFLICT', message: 'conflict', category: 'CONFLICT', retryable: false });
    });
    const app = Fastify();
    await registerTaskChannel(app, deps);
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/tasks/cancel',
      headers: { 'content-type': 'application/json', 'x-tenant-id': 't1', 'x-subject-id': 'u1' },
      payload: retryPayload(),
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().results[0].error.code).toBe('CANCEL_CONFLICT');
    await app.close();
  });

  it('returns 200 for partial failure in cancel batch', async () => {
    const deps = makeDependencies();
    deps.runtime.cancel = vi
      .fn()
      .mockImplementationOnce(async () => ({
        sessionId: brand<string, 'SessionId'>('sess-1'),
        targetRequestId: brand<string, 'MessageId'>('req-1'),
        action: 'CANCEL' as const,
        idempotencyKey: brand<string, 'IdempotencyKey'>('idem-1'),
      }))
      .mockImplementationOnce(async () => {
        throw new AgentError({ code: 'CANCEL_NOT_FOUND', message: 'not found', category: 'NOT_FOUND', retryable: false });
      });
    const app = Fastify();
    await registerTaskChannel(app, deps);
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/tasks/cancel',
      headers: { 'content-type': 'application/json', 'x-tenant-id': 't1', 'x-subject-id': 'u1' },
      payload: {
        tasks: [
          { taskId: 'req-1', sessionId: 'sess-1' },
          { taskId: 'req-2', sessionId: 'sess-2' },
        ],
      },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.results[0]).toMatchObject({ taskStatus: 'TASK_CANCELED' });
    expect(body.results[1].error).toBeDefined();
    await app.close();
  });
});

describe('POST /api/v1/tasks/retry', () => {
  it('creates new attempt with taskStatus TASK_ACCEPTED', async () => {
    const deps = makeDependencies();
    const app = Fastify();
    await registerTaskChannel(app, deps);
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/async-tasks/retry',
      headers: { 'content-type': 'application/json', 'x-tenant-id': 't1', 'x-subject-id': 'u1' },
      payload: retryPayload(),
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.results[0]).toMatchObject({ sessionId: 'sess-1', taskId: 'req-1', taskStatus: 'TASK_ACCEPTED' });
    await app.close();
  });

  it('returns 200 for partial failure in retry batch', async () => {
    const deps = makeDependencies();
    deps.runtime.retryLatest = vi
      .fn()
      .mockImplementationOnce(async () => ({
        sessionId: brand<string, 'SessionId'>('sess-1'),
        requestId: brand<string, 'MessageId'>('req-1'),
        runId: brand<string, 'RequestRunId'>('run-retry'),
        attempt: 2,
      }))
      .mockImplementationOnce(async () => {
        throw new AgentError({ code: 'RETRY_NOT_FOUND', message: 'not found', category: 'NOT_FOUND', retryable: false });
      });
    const app = Fastify();
    await registerTaskChannel(app, deps);
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/async-tasks/retry',
      headers: { 'content-type': 'application/json', 'x-tenant-id': 't1', 'x-subject-id': 'u1' },
      payload: {
        tasks: [
          { taskId: 'req-1', sessionId: 'sess-1' },
          { taskId: 'req-2', sessionId: 'sess-2' },
        ],
      },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.results[0]).toMatchObject({ taskStatus: 'TASK_ACCEPTED' });
    expect(body.results[1].error).toBeDefined();
    await app.close();
  });
});

describe('POST /api/v1/tasks/edit', () => {
  it('calls editLatest with edited input', async () => {
    const deps = makeDependencies();
    const app = Fastify();
    await registerTaskChannel(app, deps);
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/async-tasks/edit',
      headers: { 'content-type': 'application/json', 'x-tenant-id': 't1', 'x-subject-id': 'u1' },
      payload: editPayload('edited text'),
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.results[0]).toMatchObject({ sessionId: 'sess-1', taskId: 'req-edit', taskStatus: 'TASK_ACCEPTED' });
    expect(deps.runtime.editLatest).toHaveBeenCalledWith(
      expect.objectContaining({
        editedInputText: 'edited text',
        expectedLatestRequestId: 'req-1',
      }),
    );
    await app.close();
  });

  it('passes inputVariables to editLatest', async () => {
    const deps = makeDependencies();
    const app = Fastify();
    await registerTaskChannel(app, deps);
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/async-tasks/edit',
      headers: { 'content-type': 'application/json', 'x-tenant-id': 't1', 'x-subject-id': 'u1' },
      payload: {
        tasks: [
          {
            taskId: 'req-1',
            sessionId: 'sess-1',
            taskMessages: [{ data: { key: 'val' } }],
            idempotencyKey: 'edit-key-2',
          },
        ],
      },
    });
    expect(response.statusCode).toBe(200);
    const editCall = (deps.runtime.editLatest as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(editCall?.[0]).toEqual(
      expect.objectContaining({
        inputVariables: { key: 'val' },
        editedInputText: JSON.stringify({ key: 'val' }),
      }),
    );
    await app.close();
  });

  it('returns 200 for partial failure in edit batch', async () => {
    const deps = makeDependencies();
    deps.runtime.editLatest = vi
      .fn()
      .mockImplementationOnce(async () => ({
        sessionId: brand<string, 'SessionId'>('sess-1'),
        requestId: brand<string, 'MessageId'>('req-edit'),
        runId: brand<string, 'RequestRunId'>('run-edit'),
        attempt: 1,
      }))
      .mockImplementationOnce(async () => {
        throw new AgentError({ code: 'EDIT_NOT_FOUND', message: 'not found', category: 'NOT_FOUND', retryable: false });
      });
    const app = Fastify();
    await registerTaskChannel(app, deps);
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/async-tasks/edit',
      headers: { 'content-type': 'application/json', 'x-tenant-id': 't1', 'x-subject-id': 'u1' },
      payload: {
        tasks: [
          { taskId: 'req-1', sessionId: 'sess-1', taskMessages: [{ text: 'ok' }], idempotencyKey: 'edit-ok' },
          { taskId: 'req-2', sessionId: 'sess-2', taskMessages: [{ text: 'fail' }], idempotencyKey: 'edit-fail' },
        ],
      },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.results[0]).toMatchObject({ taskStatus: 'TASK_ACCEPTED' });
    expect(body.results[1].error).toBeDefined();
    await app.close();
  });
});

describe('POST /api/v1/tasks/pending-inputs/answer', () => {
  it('answers pending input and returns accepted', async () => {
    const app = Fastify();
    await registerTaskChannel(app, makeDependencies());
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/tasks/pending-inputs/answer',
      headers: { 'content-type': 'application/json', 'x-tenant-id': 't1', 'x-subject-id': 'u1' },
      payload: answerPayload([['option-a']]),
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.results[0]).toEqual({ sessionId: 'sess-1', taskId: 'req-1', taskStatus: 'TASK_EXECUTING' });
    await app.close();
  });

  it('rejects empty answers array', async () => {
    const app = Fastify();
    await registerTaskChannel(app, makeDependencies());
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/tasks/pending-inputs/answer',
      headers: { 'content-type': 'application/json', 'x-tenant-id': 't1', 'x-subject-id': 'u1' },
      payload: answerPayload([]),
    });
    expect(response.statusCode).toBe(400);
    await app.close();
  });

  it('returns 200 for partial failure in answer batch', async () => {
    const deps = makeDependencies();
    deps.sessions.getActiveRun = vi
      .fn()
      .mockImplementationOnce(async () => ({
        requestId: brand<string, 'MessageId'>('req-1'),
        runId: brand<string, 'RequestRunId'>('run-1'),
        status: 'EXECUTING' as const,
      }))
      .mockImplementationOnce(async () => undefined);
    const app = Fastify();
    await registerTaskChannel(app, deps);
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/tasks/pending-inputs/answer',
      headers: { 'content-type': 'application/json', 'x-tenant-id': 't1', 'x-subject-id': 'u1' },
      payload: {
        tasks: [
          { taskId: 'req-1', pendingInputId: 'pi-1', sessionId: 'sess-1', answers: [['yes']] },
          { taskId: 'req-2', pendingInputId: 'pi-2', sessionId: 'sess-1', answers: [['no']] },
        ],
      },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.results[0]).toMatchObject({ taskStatus: 'TASK_EXECUTING' });
    expect(body.results[1].error).toBeDefined();
    await app.close();
  });
});

describe('Task channel safe error mapping', () => {
  it('maps an unknown transport-root failure to safe 500 with one diagnostic', async () => {
    const errors: object[] = [];
    loggerBinding = bindRuntimeLoggerProvider({
      getLogger: () => ({
        debug() {},
        info() {},
        warn() {},
        error(fields) {
          errors.push(fields);
        },
      }),
    });
    const deps = makeDependencies();
    const failure = new TypeError('private task provider body');
    deps.runtime.submit = vi.fn(async () => {
      throw failure;
    });
    const app = Fastify();
    await registerTaskChannel(app, deps);
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/async-tasks',
      headers: { 'content-type': 'application/json', 'x-tenant-id': 't1', 'x-subject-id': 'u1' },
      payload: asyncCreatePayload('test'),
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().results[0].error).toEqual({
      code: 'INTERNAL_SERVER_ERROR',
      message: 'An internal error occurred. Retry the request.',
      retryable: false,
    });
    expect(errors).toEqual([
      expect.objectContaining({
        err: failure,
        event: 'channel.task.batch.item.failed',
        failureStage: 'TASK_CHANNEL_BATCH_ITEM',
      }),
    ]);
    await app.close();
  });

  it('returns per-item error for UNAVAILABLE', async () => {
    const deps = makeDependencies();
    deps.runtime.submit = vi.fn(async () => {
      throw new AgentError({ code: 'STORE_UNAVAILABLE', message: 'unavailable', category: 'UNAVAILABLE', retryable: true });
    });
    const app = Fastify();
    await registerTaskChannel(app, deps);
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/async-tasks',
      headers: { 'content-type': 'application/json', 'x-tenant-id': 't1', 'x-subject-id': 'u1' },
      payload: asyncCreatePayload('test'),
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().results[0].error.code).toBe('STORE_UNAVAILABLE');
    await app.close();
  });

  it('returns per-item error for AUTHORIZATION', async () => {
    const deps = makeDependencies();
    deps.sessions.requireSession = vi.fn(async () => {
      throw new AgentError({ code: 'FORBIDDEN', message: 'forbidden', category: 'AUTHORIZATION', retryable: false });
    });
    const app = Fastify();
    await registerTaskChannel(app, deps);
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/tasks/cancel',
      headers: { 'content-type': 'application/json', 'x-tenant-id': 't1', 'x-subject-id': 'u1' },
      payload: retryPayload(),
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().results[0].error.code).toBe('FORBIDDEN');
    await app.close();
  });

  it('per-item error contains code, message, and retryable', async () => {
    const deps = makeDependencies();
    deps.runtime.submit = vi.fn(async () => {
      throw new AgentError({ code: 'INTERNAL_ERROR', message: 'failed', category: 'VALIDATION', retryable: false });
    });
    const app = Fastify();
    await registerTaskChannel(app, deps);
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/async-tasks',
      headers: { 'content-type': 'application/json', 'x-tenant-id': 't1', 'x-subject-id': 'u1' },
      payload: asyncCreatePayload('test'),
    });
    expect(response.statusCode).toBe(400);
    const body = response.json();
    expect(Object.keys(body.results[0].error)).toEqual(['code', 'message', 'retryable']);
    await app.close();
  });

  it('returns 401 when identity resolver throws', async () => {
    const base = makeDependencies();
    const deps: TaskChannelDependencies = {
      ...base,
      identityResolver: () => {
        throw new AgentError({ code: 'LOCAL_AUTH_REQUIRED', message: 'Identity headers are required.', category: 'AUTHORIZATION', retryable: false });
      },
    };
    const app = Fastify();
    await registerTaskChannel(app, deps);
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/stream-task',
      headers: { 'content-type': 'application/json' },
      payload: createPayload('test'),
    });
    expect(response.statusCode).toBe(401);
    const body = response.json();
    expect(body.error.code).toBe('IDENTITY_RESOLUTION_FAILED');
    await app.close();
  });
});

describe('Pending-input answer three-way consistency', () => {
  it('answers when taskId matches the active run requestId', async () => {
    const deps = makeDependencies();
    deps.sessions.getActiveRun = vi.fn(async () => ({
      requestId: brand<string, 'MessageId'>('req-1'),
      runId: brand<string, 'RequestRunId'>('run-1'),
      status: 'EXECUTING' as const,
    }));
    const app = Fastify();
    await registerTaskChannel(app, deps);
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/tasks/pending-inputs/answer',
      headers: { 'content-type': 'application/json', 'x-tenant-id': 't1', 'x-subject-id': 'u1' },
      payload: answerPayload([['yes']]),
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.results[0]).toEqual({ sessionId: 'sess-1', taskId: 'req-1', taskStatus: 'TASK_EXECUTING' });
    expect(deps.runtime.answerPendingInput).toHaveBeenCalledTimes(1);
    await app.close();
  });

  it('rejects when taskId does not match active run requestId', async () => {
    const deps = makeDependencies();
    deps.sessions.getActiveRun = vi.fn(async () => ({
      requestId: brand<string, 'MessageId'>('req-other'),
      runId: brand<string, 'RequestRunId'>('run-other'),
      status: 'EXECUTING' as const,
    }));
    const app = Fastify();
    await registerTaskChannel(app, deps);
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/tasks/pending-inputs/answer',
      headers: { 'content-type': 'application/json', 'x-tenant-id': 't1', 'x-subject-id': 'u1' },
      payload: answerPayload([['yes']]),
    });
    expect(response.statusCode).toBe(400);
    const body = response.json();
    expect(body.results[0].error.code).toBe('TASK_NOT_FOUND');
    expect(deps.runtime.answerPendingInput).not.toHaveBeenCalled();
    await app.close();
  });

  it('rejects when there is no active run (task already completed)', async () => {
    const deps = makeDependencies();
    deps.sessions.getActiveRun = vi.fn(async () => undefined);
    const app = Fastify();
    await registerTaskChannel(app, deps);
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/tasks/pending-inputs/answer',
      headers: { 'content-type': 'application/json', 'x-tenant-id': 't1', 'x-subject-id': 'u1' },
      payload: answerPayload([['yes']]),
    });
    expect(response.statusCode).toBe(400);
    const body = response.json();
    expect(body.results[0].error.code).toBe('TASK_NOT_FOUND');
    expect(deps.runtime.answerPendingInput).not.toHaveBeenCalled();
    await app.close();
  });

  it('rejects when session does not exist (cross-owner safe not-found)', async () => {
    const deps = makeDependencies();
    deps.sessions.requireSession = vi.fn(async () => {
      throw new AgentError({ code: 'SESSION_NOT_FOUND', message: 'not found', category: 'NOT_FOUND', retryable: false });
    });
    const app = Fastify();
    await registerTaskChannel(app, deps);
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/tasks/pending-inputs/answer',
      headers: { 'content-type': 'application/json', 'x-tenant-id': 't1', 'x-subject-id': 'u1' },
      payload: answerPayload([['yes']]),
    });
    expect(response.statusCode).toBe(400);
    const body = response.json();
    expect(body.results[0].error.code).toBe('SESSION_NOT_FOUND');
    expect(deps.sessions.getActiveRun).not.toHaveBeenCalled();
    expect(deps.runtime.answerPendingInput).not.toHaveBeenCalled();
    await app.close();
  });

  it('rejects when runtime reports pending input already answered or timed out (CONFLICT)', async () => {
    const deps = makeDependencies();
    deps.sessions.getActiveRun = vi.fn(async () => ({
      requestId: brand<string, 'MessageId'>('req-1'),
      runId: brand<string, 'RequestRunId'>('run-1'),
      status: 'EXECUTING' as const,
    }));
    deps.runtime.answerPendingInput = vi.fn(async () => {
      throw new AgentError({ code: 'PENDING_INPUT_ALREADY_ANSWERED', message: 'already answered', category: 'CONFLICT', retryable: false });
    });
    const app = Fastify();
    await registerTaskChannel(app, deps);
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/tasks/pending-inputs/answer',
      headers: { 'content-type': 'application/json', 'x-tenant-id': 't1', 'x-subject-id': 'u1' },
      payload: answerPayload([['yes']]),
    });
    expect(response.statusCode).toBe(400);
    const body = response.json();
    expect(body.results[0].error.code).toBe('PENDING_INPUT_ALREADY_ANSWERED');
    await app.close();
  });

  it('does not leak cross-owner data in mismatch error message', async () => {
    const deps = makeDependencies();
    deps.sessions.getActiveRun = vi.fn(async () => ({
      requestId: brand<string, 'MessageId'>('req-other-owner'),
      runId: brand<string, 'RequestRunId'>('run-other-owner'),
      status: 'EXECUTING' as const,
    }));
    const app = Fastify();
    await registerTaskChannel(app, deps);
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/tasks/pending-inputs/answer',
      headers: { 'content-type': 'application/json', 'x-tenant-id': 't1', 'x-subject-id': 'u1' },
      payload: answerPayload([['yes']]),
    });
    expect(response.statusCode).toBe(400);
    const body = response.json();
    expect(body.results[0].error.message).toBe('Task was not found. Verify sessionId and taskId are correct.');
    expect(JSON.stringify(body.results[0])).not.toContain('req-other-owner');
    await app.close();
  });
});

describe('Task channel redaction boundary', () => {
  it('batch item error contains code, message, and retryable for internal failures', async () => {
    const deps = makeDependencies();
    deps.runtime.submit = vi.fn(async () => {
      throw new Error('secret credential abc123 in prompt content');
    });
    const app = Fastify();
    await registerTaskChannel(app, deps);
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/async-tasks',
      headers: { 'content-type': 'application/json', 'x-tenant-id': 't1', 'x-subject-id': 'u1' },
      payload: asyncCreatePayload('test'),
    });
    expect(response.statusCode).toBe(400);
    const body = response.json();
    expect(Object.keys(body.results[0].error)).toEqual(['code', 'message', 'retryable']);
    expect(body.results[0].error.message).toBe('An internal error occurred. Retry the request.');
    expect(JSON.stringify(body)).not.toContain('secret');
    expect(JSON.stringify(body)).not.toContain('credential');
    await app.close();
  });

  it('per-item error does not echo raw file content on intake rejection', async () => {
    const deps = makeDependencies();
    deps.runtime.reserveSubmit = vi.fn(async () => ({
      sessionId: brand<string, 'SessionId'>('sess-create'),
      agentId: brand<string, 'AgentId'>('agent-1'),
      reservationId: brand<string, 'AttachmentIntakeReservationId'>('reservation-rej'),
      requestId: brand<string, 'MessageId'>('req-rej'),
      runId: brand<string, 'RequestRunId'>('run-rej'),
      requestContextId: brand<string, 'RequestContextId'>('ctx-rej'),
      replay: false,
    }));
    deps.attachmentRuntime.intake = vi.fn(async () => ({
      status: 'REJECTED' as const,
      attachmentIds: [],
      rejected: [{ reasonCode: 'ATTACHMENT_TYPE_UNSUPPORTED' }],
    }));
    const app = Fastify();
    await registerTaskChannel(app, deps);
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/async-tasks',
      headers: { 'content-type': 'application/json', 'x-tenant-id': 't1', 'x-subject-id': 'u1' },
      payload: {
        tasks: [
          {
            taskMessages: [
              { fileContent: { raw: Buffer.from('secret-content').toString('base64'), filename: 'secret.txt', mediaType: 'text/plain' } },
            ],
            callbackTarget: { url: ASYNC_CALLBACK_URL },
          },
        ],
      },
    });
    const body = response.json();
    expect(response.statusCode).toBe(400);
    expect(body.results[0].error).toBeDefined();
    expect(JSON.stringify(body)).not.toContain('secret-content');
    expect(JSON.stringify(body)).not.toContain('secret.txt');
    await app.close();
  });

  it('callback delivery failure log does not contain callback body or raw URL', async () => {
    const logs: object[] = [];
    loggerBinding = bindRuntimeLoggerProvider({
      getLogger: () => ({
        debug() {},
        info() {},
        warn(fields) {
          logs.push(fields);
        },
        error() {},
      }),
    });
    const deps = makeDependencies();
    deps.sessions.getActiveRun = vi.fn(async () => ({
      requestId: brand<string, 'MessageId'>('req-callback'),
      runId: brand<string, 'RequestRunId'>('run-callback'),
      status: 'EXECUTING' as const,
    }));
    deps.sessions.streamEvents = vi.fn(async function* () {
      yield {
        eventId: 'evt-1',
        sessionId: brand<string, 'SessionId'>('sess-1'),
        requestId: brand<string, 'MessageId'>('req-callback'),
        runId: brand<string, 'RequestRunId'>('run-callback'),
        requestContextId: brand<string, 'RequestContextId'>('ctx-1'),
        sequence: brand<number, 'TimelineSequence'>(1),
        type: 'USER_INPUT_REQUIRED' as const,
        inlinePayload: { pendingInputId: 'pi-1', questions: [{ id: 'q1', text: 'Select option' }] },
        createdAt: new Date(10),
      };
    });
    const deliveryPort = {
      validateTarget() {},
      deliver: vi.fn(async () => false),
    };
    const depsWithCallback: TaskChannelDependencies = {
      ...deps,
      callbackDeliveryPort: deliveryPort,
      callbackDeliveryOptions: { timeoutMs: 100, maxRetries: 1 },
    };
    const app = Fastify();
    await registerTaskChannel(app, depsWithCallback);
    await app.inject({
      method: 'POST',
      url: '/api/v1/async-tasks',
      headers: { 'content-type': 'application/json', 'x-tenant-id': 't1', 'x-subject-id': 'u1' },
      payload: {
        tasks: [
          {
            taskMessages: [{ text: 'test' }],
            callbackTarget: { url: 'https://callback.example/secret-endpoint' },
          },
        ],
      },
    });
    await new Promise((r) => setTimeout(r, 500));
    const logText = JSON.stringify(logs);
    expect(logText).not.toContain('secret-endpoint');
    expect(logText).not.toContain('questions');
    await app.close();
  });
});

describe('Channel-generated idempotency characterization', () => {
  it('passes channel-generated idempotencyKey to runtime per batch item', async () => {
    const deps = makeDependencies();
    const app = Fastify();
    await registerTaskChannel(app, deps);
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/async-tasks',
      headers: { 'content-type': 'application/json', 'x-tenant-id': 't1', 'x-subject-id': 'u1' },
      payload: {
        tasks: [
          { taskMessages: [{ text: 'task-a' }], callbackTarget: { url: ASYNC_CALLBACK_URL } },
          { taskMessages: [{ text: 'task-b' }], callbackTarget: { url: ASYNC_CALLBACK_URL } },
        ],
      },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.results).toHaveLength(2);
    expect(deps.runtime.submit).toHaveBeenCalledTimes(2);
    const submitCalls = (deps.runtime.submit as ReturnType<typeof vi.fn>).mock.calls;
    const keyA = String(submitCalls[0]![0].idempotencyKey);
    const keyB = String(submitCalls[1]![0].idempotencyKey);
    expect(keyA).not.toBe(keyB);
    expect(keyA).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(keyB).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    await app.close();
  });
});

describe('Callback failure recovery', () => {
  it('callback delivery failure does not invoke runtime cancel or terminal side effect', async () => {
    const deps = makeDependencies();
    deps.sessions.getActiveRun = vi.fn(async () => ({
      requestId: brand<string, 'MessageId'>('req-cb-fail'),
      runId: brand<string, 'RequestRunId'>('run-cb-fail'),
      status: 'EXECUTING' as const,
    }));
    deps.sessions.streamEvents = vi.fn(async function* () {
      yield {
        eventId: 'evt-1',
        sessionId: brand<string, 'SessionId'>('sess-cb'),
        requestId: brand<string, 'MessageId'>('req-cb-fail'),
        runId: brand<string, 'RequestRunId'>('run-cb-fail'),
        requestContextId: brand<string, 'RequestContextId'>('ctx-cb'),
        sequence: brand<number, 'TimelineSequence'>(1),
        type: 'REQUEST_COMPLETED' as const,
        inlinePayload: { content: 'done' },
        createdAt: new Date(10),
      };
    });
    const deliveryPort = {
      validateTarget() {},
      deliver: vi.fn(async () => false),
    };
    const depsWithCallback: TaskChannelDependencies = {
      ...deps,
      callbackDeliveryPort: deliveryPort,
      callbackDeliveryOptions: { timeoutMs: 50, maxRetries: 1 },
    };
    const app = Fastify();
    await registerTaskChannel(app, depsWithCallback);
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/async-tasks',
      headers: { 'content-type': 'application/json', 'x-tenant-id': 't1', 'x-subject-id': 'u1' },
      payload: {
        tasks: [
          {
            taskMessages: [{ text: 'test' }],
            callbackTarget: { url: 'https://callback.example/hook' },
          },
        ],
      },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().results[0].taskId).toBeDefined();
    await new Promise((r) => setTimeout(r, 500));
    expect(deps.runtime.cancel).not.toHaveBeenCalled();
    await app.close();
  });
});

describe('POST /api/v1/tasks/query', () => {
  it('returns task status for an executing task', async () => {
    const deps = makeDependencies();
    deps.sessions.getRequestSummary = vi.fn(async () => ({
      sessionId: brand<string, 'SessionId'>('sess-1'),
      requestId: brand<string, 'MessageId'>('req-1'),
      runId: brand<string, 'RequestRunId'>('run-1'),
      status: 'EXECUTING' as const,
      updatedAt: brand<number, 'EpochMillis'>(100),
    }));
    const app = Fastify();
    await registerTaskChannel(app, deps);
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/tasks/query',
      headers: { 'content-type': 'application/json', 'x-tenant-id': 't1', 'x-subject-id': 'u1' },
      payload: { tasks: [{ sessionId: 'sess-1', taskId: 'req-1' }] },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.results[0]).toEqual({ sessionId: 'sess-1', taskId: 'req-1', taskStatus: 'TASK_EXECUTING' });
    await app.close();
  });

  it('returns TASK_PENDING with pendingInput for active pending input', async () => {
    const deps = makeDependencies();
    deps.sessions.getRequestSummary = vi.fn(async () => ({
      sessionId: brand<string, 'SessionId'>('sess-1'),
      requestId: brand<string, 'MessageId'>('req-1'),
      runId: brand<string, 'RequestRunId'>('run-1'),
      status: 'EXECUTING' as const,
      updatedAt: brand<number, 'EpochMillis'>(100),
      activePendingInput: {
        id: brand<string, 'PendingInputId'>('pi-1'),
        sessionId: brand<string, 'SessionId'>('sess-1'),
        kind: 'QUESTION' as const,
        questions: [{ prompt: 'Select option', options: [{ label: 'A', value: 'a' }] }],
        timeoutAt: brand<number, 'EpochMillis'>(200),
      },
    }));
    const app = Fastify();
    await registerTaskChannel(app, deps);
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/tasks/query',
      headers: { 'content-type': 'application/json', 'x-tenant-id': 't1', 'x-subject-id': 'u1' },
      payload: { tasks: [{ sessionId: 'sess-1', taskId: 'req-1' }] },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.results[0].taskStatus).toBe('TASK_PENDING');
    expect(body.results[0].data).toBeDefined();
    expect(body.results[0].data.pendingInputId).toBe('pi-1');
    expect(body.results[0].data.overtime).toBe(200);
    await app.close();
  });

  it('returns TASK_PENDING without overtime when timeoutAt is absent', async () => {
    const deps = makeDependencies();
    deps.sessions.getRequestSummary = vi.fn(async () => ({
      sessionId: brand<string, 'SessionId'>('sess-1'),
      requestId: brand<string, 'MessageId'>('req-1'),
      runId: brand<string, 'RequestRunId'>('run-1'),
      status: 'EXECUTING' as const,
      updatedAt: brand<number, 'EpochMillis'>(100),
      activePendingInput: {
        id: brand<string, 'PendingInputId'>('pi-2'),
        sessionId: brand<string, 'SessionId'>('sess-1'),
        kind: 'QUESTION' as const,
        questions: [{ prompt: 'Confirm?', options: [] }],
      },
    }));
    const app = Fastify();
    await registerTaskChannel(app, deps);
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/tasks/query',
      headers: { 'content-type': 'application/json', 'x-tenant-id': 't1', 'x-subject-id': 'u1' },
      payload: { tasks: [{ sessionId: 'sess-1', taskId: 'req-1' }] },
    });
    const body = response.json();
    expect(body.results[0].data.overtime).toBeUndefined();
    await app.close();
  });
  it('exposes structured question fields in pending input data', async () => {
    const deps = makeDependencies();
    deps.sessions.getRequestSummary = vi.fn(async () => ({
      sessionId: brand<string, 'SessionId'>('sess-1'),
      requestId: brand<string, 'MessageId'>('req-1'),
      runId: brand<string, 'RequestRunId'>('run-1'),
      status: 'EXECUTING' as const,
      updatedAt: brand<number, 'EpochMillis'>(100),
      activePendingInput: {
        id: brand<string, 'PendingInputId'>('pi-3'),
        sessionId: brand<string, 'SessionId'>('sess-1'),
        kind: 'QUESTION' as const,
        questions: [
          {
            prompt: 'Select diagnosis strategy',
            options: [
              { label: 'Option A', value: 'a', requiresTextInput: true, inputPlaceholder: 'Enter detail' },
              { label: 'Option B', value: 'b' },
            ],
            multiple: true,
            custom: true,
          },
        ],
      },
    }));
    const app = Fastify();
    await registerTaskChannel(app, deps);
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/tasks/query',
      headers: { 'content-type': 'application/json', 'x-tenant-id': 't1', 'x-subject-id': 'u1' },
      payload: { tasks: [{ sessionId: 'sess-1', taskId: 'req-1' }] },
    });
    const body = response.json();
    expect(body.results[0].taskStatus).toBe('TASK_PENDING');
    expect(body.results[0].data.kind).toBe('QUESTION');
    expect(body.results[0].data.questions).toHaveLength(1);
    const question = body.results[0].data.questions[0];
    expect(question.prompt).toBe('Select diagnosis strategy');
    expect(question.multiple).toBe(true);
    expect(question.custom).toBe(true);
    expect(question.options).toHaveLength(2);
    expect(question.options[0]).toMatchObject({ label: 'Option A', value: 'a', requiresTextInput: true, inputPlaceholder: 'Enter detail' });
    expect(question.options[1]).toMatchObject({ label: 'Option B', value: 'b' });
    await app.close();
  });
  it('returns terminal task status for completed task', async () => {
    const deps = makeDependencies();
    deps.sessions.getRequestSummary = vi.fn(async () => ({
      sessionId: brand<string, 'SessionId'>('sess-1'),
      requestId: brand<string, 'MessageId'>('req-1'),
      runId: brand<string, 'RequestRunId'>('run-1'),
      status: 'COMPLETED' as const,
      updatedAt: brand<number, 'EpochMillis'>(200),
    }));
    const app = Fastify();
    await registerTaskChannel(app, deps);
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/tasks/query',
      headers: { 'content-type': 'application/json', 'x-tenant-id': 't1', 'x-subject-id': 'u1' },
      payload: { tasks: [{ sessionId: 'sess-1', taskId: 'req-1' }] },
    });
    const body = response.json();
    expect(body.results[0].taskStatus).toBe('TASK_COMPLETED');
    expect(body.results[0].data).toBeUndefined();
    await app.close();
  });

  it('returns terminal result in taskMessages for completed task', async () => {
    const deps = makeDependencies();
    deps.sessions.getRequestSummary = vi.fn(async () => ({
      sessionId: brand<string, 'SessionId'>('sess-1'),
      requestId: brand<string, 'MessageId'>('req-1'),
      runId: brand<string, 'RequestRunId'>('run-1'),
      status: 'COMPLETED' as const,
      updatedAt: brand<number, 'EpochMillis'>(200),
      terminalResult: {
        content: 'task completed result',
        contentType: 'text/plain',
      },
    }));
    const app = Fastify();
    await registerTaskChannel(app, deps);
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/tasks/query',
      headers: { 'content-type': 'application/json', 'x-tenant-id': 't1', 'x-subject-id': 'u1' },
      payload: { tasks: [{ sessionId: 'sess-1', taskId: 'req-1' }] },
    });
    const body = response.json();
    expect(body.results[0].taskStatus).toBe('TASK_COMPLETED');
    expect(body.results[0].data).toEqual({ content: 'task completed result', contentType: 'text/plain' });
    await app.close();
  });

  it('returns terminal result with safeError for failed task', async () => {
    const deps = makeDependencies();
    deps.sessions.getRequestSummary = vi.fn(async () => ({
      sessionId: brand<string, 'SessionId'>('sess-1'),
      requestId: brand<string, 'MessageId'>('req-1'),
      runId: brand<string, 'RequestRunId'>('run-1'),
      status: 'FAILED' as const,
      updatedAt: brand<number, 'EpochMillis'>(200),
      terminalResult: {
        content: 'failure detail',
        contentType: 'text/plain',
        safeError: { code: 'TASK_FAILED', message: 'Task failed safely.', category: 'INTERNAL', retryable: false },
      },
    }));
    const app = Fastify();
    await registerTaskChannel(app, deps);
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/tasks/query',
      headers: { 'content-type': 'application/json', 'x-tenant-id': 't1', 'x-subject-id': 'u1' },
      payload: { tasks: [{ sessionId: 'sess-1', taskId: 'req-1' }] },
    });
    const body = response.json();
    expect(body.results[0].taskStatus).toBe('TASK_FAILED');
    expect(body.results[0].data).toBeDefined();
    expect(body.results[0].data).toMatchObject({ code: 'TASK_FAILED' });
    await app.close();
  });

  it('returns per-item error for not-found task', async () => {
    const deps = makeDependencies();
    deps.sessions.getRequestSummary = vi.fn(async () => undefined);
    const app = Fastify();
    await registerTaskChannel(app, deps);
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/tasks/query',
      headers: { 'content-type': 'application/json', 'x-tenant-id': 't1', 'x-subject-id': 'u1' },
      payload: { tasks: [{ sessionId: 'sess-1', taskId: 'req-missing' }] },
    });
    const body = response.json();
    expect(body.results[0].error.code).toBe('TASK_NOT_FOUND');
    await app.close();
  });

  it('supports batch queries across different sessions', async () => {
    const deps = makeDependencies();
    deps.sessions.getRequestSummary = vi.fn(async (query) => ({
      sessionId: query.sessionId,
      requestId: query.requestId,
      runId: brand<string, 'RequestRunId'>('run-x'),
      status: 'EXECUTING' as const,
      updatedAt: brand<number, 'EpochMillis'>(100),
    }));
    const app = Fastify();
    await registerTaskChannel(app, deps);
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/tasks/query',
      headers: { 'content-type': 'application/json', 'x-tenant-id': 't1', 'x-subject-id': 'u1' },
      payload: {
        tasks: [
          { sessionId: 'sess-1', taskId: 'req-1' },
          { sessionId: 'sess-2', taskId: 'req-2' },
        ],
      },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.results).toHaveLength(2);
    expect(body.results[0].sessionId).toBe('sess-1');
    expect(body.results[1].sessionId).toBe('sess-2');
    expect(deps.sessions.getRequestSummary).toHaveBeenCalledTimes(2);
    await app.close();
  });

  it('rejects empty tasks array', async () => {
    const app = Fastify();
    await registerTaskChannel(app, makeDependencies());
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/tasks/query',
      headers: { 'content-type': 'application/json', 'x-tenant-id': 't1', 'x-subject-id': 'u1' },
      payload: { tasks: [] },
    });
    expect(response.statusCode).toBe(400);
    await app.close();
  });

  it('rejects more than 20 items', async () => {
    const app = Fastify();
    await registerTaskChannel(app, makeDependencies());
    const tasks = Array.from({ length: 21 }, (_, i) => ({ sessionId: 'sess-1', taskId: 'req-' + i }));
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/tasks/query',
      headers: { 'content-type': 'application/json', 'x-tenant-id': 't1', 'x-subject-id': 'u1' },
      payload: { tasks },
    });
    expect(response.statusCode).toBe(400);
    await app.close();
  });
});

describe('Task channel body parse errors return 400/415 not 500', () => {
  it('returns 400 for an empty body on POST /api/v1/tasks/query', async () => {
    const app = Fastify();
    await registerTaskChannel(app, makeDependencies());
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/tasks/query',
      headers: { 'content-type': 'application/json', 'x-tenant-id': 't1', 'x-subject-id': 'u1' },
      payload: '',
    });
    expect(res.statusCode).toBe(400);
    const body = res.json<{ error: { code: string; message: string } }>();
    expect(body.error.code).toBe('REQUEST_VALIDATION_FAILED');
    expect(body.error.message).toBe('Request body cannot be empty when Content-Type is application/json.');
    await app.close();
  });

  it('returns 400 for malformed JSON on POST /api/v1/tasks/cancel', async () => {
    const app = Fastify();
    await registerTaskChannel(app, makeDependencies());
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/tasks/cancel',
      headers: { 'content-type': 'application/json', 'x-tenant-id': 't1', 'x-subject-id': 'u1' },
      payload: '{"tasks":',
    });
    expect(res.statusCode).toBe(400);
    expect(res.json<{ error: { code: string } }>().error.code).toBe('REQUEST_VALIDATION_FAILED');
    await app.close();
  });

  it('returns 415 when Content-Type is missing on POST /api/v1/tasks/query', async () => {
    const app = Fastify();
    await registerTaskChannel(app, makeDependencies());
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/tasks/query',
      headers: { 'x-tenant-id': 't1', 'x-subject-id': 'u1' },
      payload: '{}',
    });
    expect(res.statusCode).toBe(415);
    const body = res.json<{ error: { code: string; message: string } }>();
    expect(body.error.code).toBe('REQUEST_VALIDATION_FAILED');
    expect(body.error.message).toBe('Unsupported Media Type. Use application/json.');
    await app.close();
  });
});

function makeDependencies(opts?: { withCallbackPort?: boolean; routePrefix?: string }): TaskChannelDependencies {
  const sessions: RuntimeSessionPort = {
    createSession: vi.fn(async () => makeSession('sess-create')),
    requireSession: vi.fn(async ({ sessionId }) => makeSession(typeof sessionId === 'string' ? sessionId : String(sessionId))),
    listSessions: vi.fn(async () => ({ entries: [], offset: 0, limit: 10, hasMore: false })),
    deleteSession: vi.fn(async () => undefined),
    forkFromMessage: vi.fn(async () => ({ childSession: makeSession('sess-fork'), replayed: false })),
    forkFromRequest: vi.fn(async () => ({ childSession: makeSession('sess-fork'), replayed: false })),
    listMessages: vi.fn(async () => ({ items: [], limit: 20, hasMore: false })),
    listConversationPreview: vi.fn(async ({ sessionId }) => ({ sessionId, totalMarkers: 0, offset: 0, limit: 100, markers: [] })),
    updateTitle: vi.fn(async () => makeSession('sess-1')),
    streamEvents: vi.fn(async function* () {}),
    getActiveRun: vi.fn(async () => ({
      requestId: brand<string, 'MessageId'>('req-1'),
      runId: brand<string, 'RequestRunId'>('run-1'),
      status: 'EXECUTING' as const,
    })),
    listEvents: vi.fn(async () => ({ availability: 'AVAILABLE' as const, events: [] })),
    getRequestSummary: vi.fn(async () => ({
      sessionId: brand<string, 'SessionId'>('sess-1'),
      requestId: brand<string, 'MessageId'>('req-1'),
      runId: brand<string, 'RequestRunId'>('run-1'),
      status: 'EXECUTING' as const,
      updatedAt: brand<number, 'EpochMillis'>(100),
    })),
  };
  const runtime: RuntimeCommandPort = {
    submit: vi.fn(async () => ({
      sessionId: brand<string, 'SessionId'>('sess-create'),
      requestId: brand<string, 'MessageId'>('req-create'),
      runId: brand<string, 'RequestRunId'>('run-create'),
      attempt: 1,
    })),
    cancel: vi.fn(async () => ({
      sessionId: brand<string, 'SessionId'>('sess-1'),
      targetRequestId: brand<string, 'MessageId'>('req-1'),
      action: 'CANCEL' as const,
      idempotencyKey: brand<string, 'IdempotencyKey'>('idem-cancel'),
    })),
    retryLatest: vi.fn(async () => ({
      sessionId: brand<string, 'SessionId'>('sess-1'),
      requestId: brand<string, 'MessageId'>('req-1'),
      runId: brand<string, 'RequestRunId'>('run-retry'),
      attempt: 2,
    })),
    editLatest: vi.fn(async () => ({
      sessionId: brand<string, 'SessionId'>('sess-1'),
      requestId: brand<string, 'MessageId'>('req-edit'),
      runId: brand<string, 'RequestRunId'>('run-edit'),
      attempt: 1,
    })),
    answerPendingInput: vi.fn(async () => ({
      sessionId: brand<string, 'SessionId'>('sess-1'),
      pendingInputId: brand<string, 'PendingInputId'>('pi-1'),
      status: 'RECEIVED' as const,
    })),
  };
  const attachmentRuntime: TaskAttachmentIntakeRuntime = {
    intake: vi.fn(async () => ({
      status: 'ACCEPTED' as const,
      attachmentIds: [brand<string, 'AttachmentId'>('att-1')],
      rejected: [],
    })),
  };
  const base: TaskChannelDependencies = {
    runtime,
    sessions,
    attachmentRuntime,
    identityResolver: () => ({
      tenantId: brand<string, 'TenantId'>('t1'),
      subjectId: brand<string, 'SubjectId'>('u1'),
      displayName: 'test-user',
    }),
  };
  if (opts?.withCallbackPort === false) {
    return opts.routePrefix === undefined ? base : { ...base, routePrefix: opts.routePrefix };
  }
  return {
    ...base,
    ...(opts?.routePrefix === undefined ? {} : { routePrefix: opts.routePrefix }),
    callbackDeliveryPort: {
      validateTarget() {},
      deliver: vi.fn(async () => true),
    },
  };
}

function makeSession(sessionId: string) {
  return {
    tenantId: brand<string, 'TenantId'>('t1'),
    subjectId: brand<string, 'SubjectId'>('u1'),
    agentId: brand<string, 'AgentId'>('agent-1'),
    sessionId: brand<string, 'SessionId'>(sessionId),
    title: 'Test session',
    createdAt: brand<number, 'EpochMillis'>(1),
    updatedAt: brand<number, 'EpochMillis'>(1),
    hasInFlightRequest: false,
  };
}

function createPayload(text: string) {
  return { taskMessages: [{ text }] };
}

function asyncCreatePayload(text: string) {
  return { tasks: [{ taskMessages: [{ text }], callbackTarget: { url: ASYNC_CALLBACK_URL } }] };
}

function editPayload(text: string) {
  return { tasks: [{ taskId: 'req-1', sessionId: 'sess-1', taskMessages: [{ text }], idempotencyKey: 'edit-key-1' }] };
}

function controlPayload() {
  return { tasks: [{ taskId: 'req-1', sessionId: 'sess-1' }] };
}

function retryPayload() {
  return { tasks: [{ taskId: 'req-1', sessionId: 'sess-1' }] };
}

function answerPayload(answers: ReadonlyArray<readonly string[]>) {
  return { tasks: [{ taskId: 'req-1', pendingInputId: 'pi-1', sessionId: 'sess-1', answers }] };
}
