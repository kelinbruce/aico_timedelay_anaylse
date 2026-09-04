import { cleanupNextAgentTestApps, createNextAgentTestApp } from '@nextagent/agent-platform-gateway-local/testing';
import type { ModelInvocationRequest } from '@nextagent/agent-contracts/model';
import { createServer } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';

afterEach(async () => {
  await cleanupNextAgentTestApps();
});

const taskHeaders = {
  'content-type': 'application/json',
  'x-tenant-id': 'e2e-task-tenant',
  'x-subject-id': 'e2e-task-user',
};
const unreachableCallbackOrigin = 'https://callback.example.invalid';

interface TaskCoordinates {
  readonly sessionId: string;
  readonly taskId: string;
  readonly taskStatus: string;
  readonly attempt?: number;
}

interface TaskQueryResult extends TaskCoordinates {
  readonly data?: {
    readonly content?: string;
    readonly pendingInputId?: string;
  };
}

interface TaskCallbackPayload {
  readonly events: ReadonlyArray<{
    readonly eventType: string;
    readonly sessionId: string;
    readonly taskId: string;
  }>;
}

describe('Task channel product path', () => {
  it('streams a task from TASK_ACCEPTED through TASK_COMPLETED on the current endpoint', async () => {
    const app = createNextAgentTestApp({
      workspaceDir: process.cwd(),
      modelSteps: [{ contentChunks: ['Task SSE answer.'] }],
    });

    const response = await app.server.inject({
      method: 'POST',
      url: '/api/v1/stream-task',
      headers: taskHeaders,
      payload: {
        taskMessages: [{ text: 'diagnose the alarm' }],
        idempotencyKey: `stream-task-${crypto.randomUUID()}`,
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('text/event-stream');
    expect(response.body).toContain('event: TASK_ACCEPTED');
    expect(response.body).toContain('event: TASK_COMPLETED');
    expect(response.body).toContain('Task SSE answer.');
  });

  it('rejects a stream task without trusted identity headers', async () => {
    const app = createNextAgentTestApp({ workspaceDir: process.cwd(), modelSteps: [{ content: 'unused' }] });

    const response = await app.server.inject({
      method: 'POST',
      url: '/api/v1/stream-task',
      headers: { 'content-type': 'application/json' },
      payload: { taskMessages: [{ text: 'missing identity' }] },
    });

    expect(response.statusCode).toBe(401);
  });

  it('requires a callback target for every asynchronous task item', async () => {
    const app = createNextAgentTestApp({ workspaceDir: process.cwd(), modelSteps: [{ content: 'unused' }] });

    const response = await app.server.inject({
      method: 'POST',
      url: '/api/v1/async-tasks',
      headers: taskHeaders,
      payload: { tasks: [{ taskMessages: [{ text: 'missing callback' }] }] },
    });

    expect(response.statusCode).toBe(400);
  });

  it('delivers terminal events through the real HTTP callback boundary', async () => {
    const capturedPayloads: TaskCallbackPayload[] = [];
    const callbackServer = createServer((request, response) => {
      const chunks: Buffer[] = [];
      request.on('data', (chunk: Buffer) => chunks.push(chunk));
      request.on('end', () => {
        capturedPayloads.push(JSON.parse(Buffer.concat(chunks).toString('utf8')) as TaskCallbackPayload);
        response.writeHead(204).end();
      });
    });
    await new Promise<void>((resolve) => callbackServer.listen(0, '127.0.0.1', resolve));
    const address = callbackServer.address();
    if (address === null || typeof address === 'string') {
      throw new Error('Callback server did not expose a TCP address.');
    }
    const callbackOrigin = `http://127.0.0.1:${address.port}`;
    const app = createNextAgentTestApp({
      workspaceDir: process.cwd(),
      modelSteps: [{ contentChunks: ['Async callback answer.'] }],
      taskCallback: { allowedOrigins: [callbackOrigin], timeoutMs: 2_000, maxRetries: 2 },
    });

    try {
      const created = await createAsyncTask(app, 'deliver the terminal callback', `${callbackOrigin}/task-events`);
      await waitFor(() => capturedPayloads.some((payload) => payload.events.some((event) => event.eventType === 'TASK_COMPLETED')));

      const events = capturedPayloads.flatMap((payload) => payload.events);
      expect(events[0]).toMatchObject({ sessionId: created.sessionId, taskId: created.taskId });
      expect(events.some((event) => event.eventType === 'TASK_COMPLETED')).toBe(true);
    } finally {
      await new Promise<void>((resolve, reject) => {
        callbackServer.close((error) => (error === undefined ? resolve() : reject(error)));
      });
    }
  }, 20_000);

  it('edits a terminal task and retries the edited task through current async endpoints', async () => {
    const modelRequests: ModelInvocationRequest[] = [];
    const app = createAsyncTaskApp(
      [{ content: 'Task answer.' }, { content: 'Task answer.' }, { content: 'Task answer.' }, { content: 'Task answer.' }],
      modelRequests,
    );
    const created = await createAsyncTask(app, 'original diagnosis', `${unreachableCallbackOrigin}/task`);
    await waitForTask(app, created, (task) => task.taskStatus === 'TASK_COMPLETED');

    const edited = await postSingleTask(app, '/api/v1/async-tasks/edit', {
      taskId: created.taskId,
      sessionId: created.sessionId,
      taskMessages: [{ text: 'edited diagnosis' }],
      idempotencyKey: `edit-${crypto.randomUUID()}`,
    });
    expect(edited).toMatchObject({ sessionId: created.sessionId, taskStatus: 'TASK_ACCEPTED' });
    expect(edited).not.toHaveProperty('attempt');
    expect(edited.taskId).not.toBe(created.taskId);
    await waitFor(() => JSON.stringify(modelRequests.at(-1)?.messages).includes('edited diagnosis'));
    await waitForTask(app, edited, (task) => task.taskStatus === 'TASK_COMPLETED');

    const invocationCountBeforeRetry = modelRequests.length;
    const retried = await postSingleTask(app, '/api/v1/async-tasks/retry', {
      taskId: edited.taskId,
      sessionId: edited.sessionId,
    });
    expect(retried).toMatchObject({ sessionId: edited.sessionId, taskId: edited.taskId, taskStatus: 'TASK_ACCEPTED', attempt: 2 });
    await waitFor(() => modelRequests.length > invocationCountBeforeRetry);
    expect(JSON.stringify(modelRequests.at(-1)?.messages)).toContain('edited diagnosis');
    await waitForTask(app, retried, (task) => task.taskStatus === 'TASK_COMPLETED');
  }, 20_000);

  it('answers a pending input and reaches the terminal result through query reconciliation', async () => {
    const app = createAsyncTaskApp([
      {
        toolCalls: [
          {
            toolCallId: 'ask-region-task',
            toolName: 'AskUserQuestion',
            arguments: {
              questions: [
                {
                  prompt: 'Which region?',
                  options: [
                    { value: 'north', label: 'North' },
                    { value: 'south', label: 'South' },
                  ],
                },
              ],
            },
          },
        ],
      },
      { contentChunks: ['Region accepted.'] },
    ]);
    const created = await createAsyncTask(app, 'choose a region', `${unreachableCallbackOrigin}/task`);
    const pending = await waitForTask(app, created, (task) => task.taskStatus === 'TASK_PENDING');
    expect(pending.data?.pendingInputId).toBeTruthy();

    const answered = await postSingleTask(app, '/api/v1/tasks/pending-inputs/answer', {
      taskId: created.taskId,
      sessionId: created.sessionId,
      pendingInputId: pending.data!.pendingInputId,
      answers: [['north']],
    });
    expect(answered).toMatchObject({ sessionId: created.sessionId, taskId: created.taskId, taskStatus: 'TASK_EXECUTING' });
    const terminal = await waitForTask(app, created, (task) => task.taskStatus === 'TASK_COMPLETED');
    expect(terminal.data?.content).toBe('Region accepted.');
  }, 20_000);

  it('cancels a pending task through the current control endpoint', async () => {
    const app = createAsyncTaskApp([
      {
        toolCalls: [
          {
            toolCallId: 'ask-before-cancel',
            toolName: 'AskUserQuestion',
            arguments: { questions: [{ prompt: 'Continue?', options: [{ value: 'yes', label: 'Yes' }] }] },
          },
        ],
      },
    ]);
    const created = await createAsyncTask(app, 'wait before cancel', `${unreachableCallbackOrigin}/task`);
    await waitForTask(app, created, (task) => task.taskStatus === 'TASK_PENDING');

    const canceled = await postSingleTask(app, '/api/v1/tasks/cancel', {
      taskId: created.taskId,
      sessionId: created.sessionId,
    });
    expect(canceled).toMatchObject({ sessionId: created.sessionId, taskId: created.taskId, taskStatus: 'TASK_CANCELED' });
    await waitForTask(app, created, (task) => task.taskStatus === 'TASK_CANCELED');
  }, 20_000);
});

function createAsyncTaskApp(
  modelSteps: Parameters<typeof createNextAgentTestApp>[0]['modelSteps'],
  modelRequestSink?: ModelInvocationRequest[],
): ReturnType<typeof createNextAgentTestApp> {
  return createNextAgentTestApp({
    workspaceDir: process.cwd(),
    modelSteps,
    ...(modelRequestSink === undefined ? {} : { modelRequestSink }),
    taskCallback: { allowedOrigins: [unreachableCallbackOrigin], timeoutMs: 100, maxRetries: 0 },
  });
}

async function createAsyncTask(app: ReturnType<typeof createNextAgentTestApp>, text: string, callbackUrl: string): Promise<TaskCoordinates> {
  return postSingleTask(app, '/api/v1/async-tasks', {
    taskMessages: [{ text }],
    callbackTarget: { url: callbackUrl },
    reportEvents: 'TERMINAL',
  });
}

async function postSingleTask(app: ReturnType<typeof createNextAgentTestApp>, url: string, task: Record<string, unknown>): Promise<TaskCoordinates> {
  const response = await app.server.inject({ method: 'POST', url, headers: taskHeaders, payload: { tasks: [task] } });
  expect(response.statusCode, response.body).toBe(200);
  return response.json<{ results: TaskCoordinates[] }>().results[0]!;
}

async function queryTask(app: ReturnType<typeof createNextAgentTestApp>, task: TaskCoordinates): Promise<TaskQueryResult> {
  const response = await app.server.inject({
    method: 'POST',
    url: '/api/v1/tasks/query',
    headers: taskHeaders,
    payload: { tasks: [{ sessionId: task.sessionId, taskId: task.taskId }] },
  });
  expect(response.statusCode, response.body).toBe(200);
  return response.json<{ results: TaskQueryResult[] }>().results[0]!;
}

async function waitForTask(
  app: ReturnType<typeof createNextAgentTestApp>,
  task: TaskCoordinates,
  predicate: (result: TaskQueryResult) => boolean,
): Promise<TaskQueryResult> {
  let latest: TaskQueryResult | undefined;
  await waitFor(async () => {
    latest = await queryTask(app, task);
    return predicate(latest);
  });
  if (latest === undefined) {
    throw new Error('Task query did not return coordinates.');
  }
  return latest;
}

async function waitFor(predicate: () => boolean | Promise<boolean>, timeoutMs = 15_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error('Timed out waiting for task-channel product state.');
}
