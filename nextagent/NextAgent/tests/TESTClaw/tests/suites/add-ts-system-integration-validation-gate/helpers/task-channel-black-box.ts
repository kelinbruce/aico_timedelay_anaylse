import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';

import { expect } from 'vitest';

import type { SystemIntegrationCaseId } from '../case-manifest.js';
import { requiredCandidateRoot, startCandidateHarness, type CandidateModelTurn } from './candidate-harness.js';
import { writePassingCaseEvidence } from './case-evidence.js';
import { hashDirectoryTree } from './external-consumer-root.js';
import { withRunScope } from './run-scope.js';

const taskHeaders = {
  'content-type': 'application/json',
  'x-tenant-id': 'testclaw-task-tenant',
  'x-subject-id': 'testclaw-task-user',
};
const taskIdentityHeaders = {
  'x-tenant-id': taskHeaders['x-tenant-id'],
  'x-subject-id': taskHeaders['x-subject-id'],
};

interface TaskCoordinates {
  readonly sessionId: string;
  readonly taskId: string;
  readonly taskStatus: string;
}

interface TaskEvent {
  readonly eventType: string;
  readonly sessionId: string;
  readonly taskId: string;
}

interface TaskStreamResult {
  readonly coordinates: TaskCoordinates;
  readonly body: string;
}

export async function runTaskChannelCase(caseId: SystemIntegrationCaseId): Promise<void> {
  const candidateRoot = requiredCandidateRoot();
  const candidateHashBefore = await hashDirectoryTree(candidateRoot);
  await withRunScope({ outputBase: process.env.TESTCLAW_SYSTEM_INTEGRATION_OUTPUT_ROOT }, async (scope) => {
    let callbackEventTypes: string[] = [];
    let callbackPayloadNarrowed = true;
    const callbackServer = createServer(async (request, response) => {
      const chunks: Buffer[] = [];
      for await (const chunk of request) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }
      const body: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if (isObject(body) && Array.isArray(body.events)) {
        callbackPayloadNarrowed &&= body.events.every(
          (event) =>
            isObject(event) &&
            Object.keys(event).every((key) => ['eventId', 'eventType', 'sessionId', 'taskId', 'sequence', 'createdAt', 'payload'].includes(key)),
        );
        callbackEventTypes.push(...body.events.flatMap((event) => (isObject(event) && typeof event.eventType === 'string' ? [event.eventType] : [])));
      }
      response.writeHead(204).end();
    });
    const callbackPort = caseId === 'TC-SI-075' ? await scope.listenOnRandomPort(callbackServer) : undefined;
    const callbackOrigin = callbackPort === undefined ? undefined : `http://127.0.0.1:${callbackPort}`;
    const modelTurns = turnsForCase(caseId);
    const harness = await startCandidateHarness({
      scope,
      candidateRoot,
      modelAnswer: 'task channel black box completed',
      ...(modelTurns === undefined ? {} : { modelTurns }),
      ...(callbackOrigin === undefined
        ? {}
        : {
            configureRuntime: (config) => {
              config.taskCallback = { allowedOrigins: [callbackOrigin], timeoutMs: 2_000, maxRetries: 2 };
            },
          }),
    });

    const observations = await executeCase(
      caseId,
      harness.baseUrl,
      callbackOrigin,
      () => callbackEventTypes,
      () => callbackPayloadNarrowed,
    );
    await writePassingCaseEvidence({
      evidenceRoot: scope.evidenceRoot,
      caseId,
      observations,
      canaries: [
        { category: 'prompt', value: `task-prompt-${caseId}` },
        { category: 'model-output', value: 'task channel black box completed' },
        { category: 'credential', value: 'testclaw-loopback-key' },
      ],
    });
  });
  expect(await hashDirectoryTree(candidateRoot)).toBe(candidateHashBefore);
}

async function executeCase(
  caseId: SystemIntegrationCaseId,
  baseUrl: string,
  callbackOrigin: string | undefined,
  callbackEvents: () => readonly string[],
  callbackNarrowed: () => boolean,
): Promise<Readonly<Record<string, boolean | number | string>>> {
  switch (caseId) {
    case 'TC-SI-068': {
      const created = await createTask(baseUrl, `task-prompt-${caseId}`);
      expect(created.taskStatus).toBe('TASK_ACCEPTED');
      return { coordinatesCreated: true, accepted: true };
    }
    case 'TC-SI-070': {
      const response = await fetch(`${baseUrl}/api/v1/async-tasks`, {
        method: 'POST',
        headers: taskHeaders,
        body: JSON.stringify({ tasks: [{ taskMessages: [{ text: `task-prompt-${caseId}` }] }] }),
      });
      expect(response.status).toBe(400);
      expect(await response.text()).toContain('REQUEST_VALIDATION_FAILED');
      return { missingCallbackRejected: true };
    }
    case 'TC-SI-071': {
      const created = await createTask(baseUrl, `task-prompt-${caseId}`, {
        metadata: { source: 'testclaw', version: '1' },
      });
      expect(created.taskStatus).toBe('TASK_ACCEPTED');
      return { optionalMetadataAccepted: true };
    }
    case 'TC-SI-072': {
      const key = `tc-si-072-${randomUUID()}`;
      const first = await createTask(baseUrl, `task-prompt-${caseId}`, {}, key);
      const replay = await createTask(baseUrl, `task-prompt-${caseId}`, {}, key);
      expect(replay).toEqual(first);
      return { coordinatesReplayed: true, sideEffectDeduplicated: true };
    }
    case 'TC-SI-073': {
      const stream = await createTaskStream(baseUrl, `task-prompt-${caseId}`);
      expect(stream.body).toContain('event: TASK_ACCEPTED');
      expect(stream.body).toContain('event: CONTENT_DELTA');
      expect(stream.body).toContain('event: TASK_COMPLETED');
      return { acceptedEvent: true, contentEvent: true, completedEvent: true };
    }
    case 'TC-SI-074': {
      const response = await fetch(`${baseUrl}/api/v1/stream-task`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ taskMessages: [{ text: `task-prompt-${caseId}` }] }),
      });
      expect(response.status).toBe(401);
      return { headerlessStreamRejected: true };
    }
    case 'TC-SI-075': {
      expect(callbackOrigin).toBeDefined();
      const response = await fetch(`${baseUrl}/api/v1/async-tasks`, {
        method: 'POST',
        headers: taskHeaders,
        body: JSON.stringify({
          tasks: [
            {
              taskMessages: [{ text: `task-prompt-${caseId}` }],
              callbackTarget: { url: `${callbackOrigin}/events` },
            },
          ],
        }),
      });
      expect(response.status).toBe(200);
      await waitFor(() => callbackEvents().includes('TASK_COMPLETED'), 20_000, 'task-callback-timeout');
      expect(callbackEvents().filter((eventType) => eventType === 'TASK_COMPLETED')).toHaveLength(1);
      expect(callbackNarrowed()).toBe(true);
      return { narrowedCallbackDelivered: true, callbackTerminalUnique: true };
    }
    case 'TC-SI-076': {
      const created = await createTask(baseUrl, `task-prompt-${caseId}-original`);
      const edited = await postTaskStream(baseUrl, `/api/v1/stream-task/${created.taskId}/edit`, {
        sessionId: created.sessionId,
        taskMessages: [{ text: `task-prompt-${caseId}-edited` }],
        idempotencyKey: `testclaw-edit-${randomUUID()}`,
      });
      expect(edited.taskId).not.toBe(created.taskId);
      return { editedAttemptCreated: true, sessionPreserved: edited.sessionId === created.sessionId };
    }
    case 'TC-SI-077': {
      const created = await createTask(baseUrl, `task-prompt-${caseId}`);
      const retried = await postTaskStream(baseUrl, `/api/v1/stream-task/${created.taskId}/retry`, {
        sessionId: created.sessionId,
      });
      expect(retried).toMatchObject({
        taskId: created.taskId,
        sessionId: created.sessionId,
        taskStatus: 'TASK_ACCEPTED',
      });
      return { retryAttemptCreated: true, priorTaskPreserved: true };
    }
    case 'TC-SI-078': {
      const response = await openTaskStream(baseUrl, '/api/v1/stream-task', {
        taskMessages: [{ text: `task-prompt-${caseId}` }],
        idempotencyKey: `testclaw-task-${randomUUID()}`,
      });
      const accepted = await readUntilTaskEvent(response, 'TASK_ACCEPTED');
      const created = coordinatesFromEvent(accepted.event);
      const canceled = await postTaskOperation(baseUrl, '/api/v1/tasks/cancel', {
        tasks: [{ taskId: created.taskId, sessionId: created.sessionId }],
      });
      expect(canceled).toMatchObject({ ...created, taskStatus: 'TASK_CANCELED' });
      await accepted.cancel();
      return { runningTaskCanceled: true };
    }
    case 'TC-SI-079': {
      const response = await openTaskStream(baseUrl, '/api/v1/stream-task', {
        taskMessages: [{ text: `task-prompt-${caseId}` }],
      });
      const pendingEvent = await readUntilTaskEvent(response, 'USER_INPUT_REQUIRED');
      const created = coordinatesFromEvent(pendingEvent.event);
      const pending = await waitForTaskQuery(baseUrl, created, 'TASK_PENDING');
      expect(pending.pendingInputId).toBeDefined();
      const answered = await postTaskOperation(baseUrl, '/api/v1/tasks/pending-inputs/answer', {
        tasks: [
          {
            taskId: created.taskId,
            pendingInputId: pending.pendingInputId,
            sessionId: created.sessionId,
            answers: [['north']],
          },
        ],
      });
      await waitForTaskStatus(baseUrl, answered, 'TASK_COMPLETED');
      await pendingEvent.cancel();
      return { pendingInputObserved: true, answerResumedTask: true };
    }
    case 'TC-SI-080': {
      const response = await fetch(`${baseUrl}/api/v1/task/unknown/ws?sessionId=unknown`, { headers: taskIdentityHeaders });
      expect(response.status).toBe(404);
      return { taskWebSocketAbsent: true };
    }
    case 'TC-SI-081': {
      const created = await createTask(baseUrl, `task-prompt-${caseId}`);
      const completed = await waitForTaskQuery(baseUrl, created, 'TASK_COMPLETED');
      expect(completed.taskStatus).toBe('TASK_COMPLETED');
      return { completedStatusReturned: true };
    }
    case 'TC-SI-082': {
      const response = await openTaskStream(baseUrl, '/api/v1/stream-task', {
        taskMessages: [{ text: `task-prompt-${caseId}` }],
      });
      const pendingEvent = await readUntilTaskEvent(response, 'USER_INPUT_REQUIRED');
      const created = coordinatesFromEvent(pendingEvent.event);
      const pending = await waitForTaskQuery(baseUrl, created, 'TASK_PENDING');
      expect(typeof pending.pendingInputId).toBe('string');
      await pendingEvent.cancel();
      return { pendingStatusReturned: true, pendingInputReturned: true };
    }
    case 'TC-SI-083': {
      const response = await taskQuery(baseUrl, { sessionId: 'missing-session', taskId: 'missing-task' });
      expect(response.errorCode).toContain('NOT_FOUND');
      return { perItemNotFoundReturned: true };
    }
    case 'TC-SI-084': {
      const paths: readonly [string, string][] = [
        ['POST', '/api/v1/task/unknown/submit'],
        ['POST', '/api/v1/task/unknown/stop'],
        ['POST', '/api/v1/task/unknown/resume'],
        ['GET', '/api/v1/task/unknown/conversation'],
        ['GET', '/api/v1/task/unknown'],
        ['GET', '/api/v1/task/unknown/ws'],
        ['DELETE', '/api/v1/task/unknown'],
      ];
      for (const [method, url] of paths) {
        const response = await fetch(`${baseUrl}${url}`, { method, headers: taskIdentityHeaders });
        expect(response.status).toBe(404);
      }
      return { absentEndpointCount: paths.length };
    }
    default:
      throw new Error(`unsupported-task-case-${caseId}`);
  }
}

function turnsForCase(caseId: SystemIntegrationCaseId): readonly CandidateModelTurn[] | undefined {
  if (caseId === 'TC-SI-073') {
    return [{ content: 'task channel black box completed', delayMs: 500 }];
  }
  if (caseId === 'TC-SI-078') {
    return [{ content: 'must be canceled', delayMs: 15_000 }];
  }
  if (caseId === 'TC-SI-079' || caseId === 'TC-SI-082') {
    return [
      {
        toolCalls: [
          {
            toolCallId: `ask-${caseId}`,
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
      { content: 'task channel black box completed' },
    ];
  }
  return undefined;
}

async function createTask(
  baseUrl: string,
  text: string,
  metadata: Readonly<Record<string, unknown>> = {},
  idempotencyKey = `testclaw-task-${randomUUID()}`,
): Promise<TaskCoordinates> {
  return (await createTaskStream(baseUrl, text, metadata, idempotencyKey)).coordinates;
}

async function createTaskStream(
  baseUrl: string,
  text: string,
  metadata: Readonly<Record<string, unknown>> = {},
  idempotencyKey = `testclaw-task-${randomUUID()}`,
): Promise<TaskStreamResult> {
  const response = await openTaskStream(baseUrl, '/api/v1/stream-task', {
    taskMessages: [{ text, ...(Object.keys(metadata).length === 0 ? {} : { metadata }) }],
    idempotencyKey,
  });
  const body = await response.text();
  const accepted = parseTaskEvents(body).find((event) => event.eventType === 'TASK_ACCEPTED');
  if (accepted === undefined) {
    throw new Error('task-accepted-event-missing');
  }
  return { coordinates: coordinatesFromEvent(accepted), body };
}

async function postTaskStream(baseUrl: string, route: string, body: unknown): Promise<TaskCoordinates> {
  const response = await openTaskStream(baseUrl, route, body);
  const stream = await response.text();
  const accepted = parseTaskEvents(stream).find((event) => event.eventType === 'TASK_ACCEPTED');
  if (accepted === undefined) {
    throw new Error('task-operation-accepted-event-missing');
  }
  return coordinatesFromEvent(accepted);
}

async function openTaskStream(baseUrl: string, route: string, body: unknown): Promise<Response> {
  const response = await fetch(`${baseUrl}${route}`, {
    method: 'POST',
    headers: taskHeaders,
    body: JSON.stringify(body),
  });
  expect(response.status).toBe(200);
  expect(response.headers.get('content-type')).toContain('text/event-stream');
  return response;
}

async function postTaskOperation(baseUrl: string, route: string, body: unknown): Promise<TaskCoordinates> {
  const response = await fetch(`${baseUrl}${route}`, {
    method: 'POST',
    headers: taskHeaders,
    body: JSON.stringify(body),
  });
  expect(response.status).toBe(200);
  const value: unknown = await response.json();
  if (!isObject(value) || !Array.isArray(value.results) || value.results.length !== 1) {
    throw new Error('task-operation-response-invalid');
  }
  return readCoordinates(value.results[0]);
}

async function waitForTaskStatus(baseUrl: string, coordinates: TaskCoordinates, expected: string): Promise<TaskCoordinates> {
  const result = await waitForTaskQuery(baseUrl, coordinates, expected);
  return readCoordinates(result.raw);
}

async function waitForTaskQuery(
  baseUrl: string,
  coordinates: TaskCoordinates,
  expected: string,
): Promise<{ readonly raw: unknown; readonly taskStatus: string; readonly pendingInputId?: string }> {
  let result: Awaited<ReturnType<typeof taskQuery>> | undefined;
  await waitFor(
    async () => {
      result = await taskQuery(baseUrl, coordinates);
      return result.taskStatus === expected;
    },
    30_000,
    `task-status-${expected}-timeout`,
  );
  if (result === undefined) {
    throw new Error('task-query-result-missing');
  }
  return {
    raw: result.raw,
    taskStatus: result.taskStatus ?? '',
    ...(result.pendingInputId === undefined ? {} : { pendingInputId: result.pendingInputId }),
  };
}

async function taskQuery(
  baseUrl: string,
  coordinates: Pick<TaskCoordinates, 'sessionId' | 'taskId'>,
): Promise<{
  readonly raw: unknown;
  readonly taskStatus?: string;
  readonly pendingInputId?: string;
  readonly errorCode?: string;
}> {
  const response = await fetch(`${baseUrl}/api/v1/tasks/query`, {
    method: 'POST',
    headers: taskHeaders,
    body: JSON.stringify({ tasks: [{ sessionId: coordinates.sessionId, taskId: coordinates.taskId }] }),
  });
  expect(response.status).toBe(200);
  const body: unknown = await response.json();
  if (!isObject(body) || !Array.isArray(body.results) || body.results.length !== 1) {
    throw new Error('task-query-response-invalid');
  }
  const raw = body.results[0];
  if (!isObject(raw)) {
    throw new Error('task-query-item-invalid');
  }
  return {
    raw,
    ...(typeof raw.taskStatus === 'string' ? { taskStatus: raw.taskStatus } : {}),
    ...(isObject(raw.data) && typeof raw.data.pendingInputId === 'string' ? { pendingInputId: raw.data.pendingInputId } : {}),
    ...(isObject(raw.error) && typeof raw.error.code === 'string' ? { errorCode: raw.error.code } : {}),
  };
}

function readCoordinates(value: unknown): TaskCoordinates {
  if (!isObject(value) || typeof value.sessionId !== 'string' || typeof value.taskId !== 'string' || typeof value.taskStatus !== 'string') {
    throw new Error('task-coordinates-invalid');
  }
  return { sessionId: value.sessionId, taskId: value.taskId, taskStatus: value.taskStatus };
}

function coordinatesFromEvent(event: TaskEvent): TaskCoordinates {
  return { sessionId: event.sessionId, taskId: event.taskId, taskStatus: 'TASK_ACCEPTED' };
}

function parseTaskEvents(body: string): readonly TaskEvent[] {
  return body
    .replaceAll('\r\n', '\n')
    .split('\n\n')
    .flatMap((frame) => {
      const data = frame
        .split('\n')
        .find((line) => line.startsWith('data: '))
        ?.slice('data: '.length);
      if (data === undefined) {
        return [];
      }
      const parsed: unknown = JSON.parse(data);
      return isTaskEvent(parsed) ? [parsed] : [];
    });
}

async function readUntilTaskEvent(
  response: Response,
  expectedEventType: string,
): Promise<{ readonly event: TaskEvent; readonly cancel: () => Promise<void> }> {
  const reader = response.body?.getReader();
  if (reader === undefined) {
    throw new Error('task-stream-body-missing');
  }
  const decoder = new TextDecoder();
  let buffered = '';
  while (true) {
    const chunk = await reader.read();
    buffered += decoder.decode(chunk.value, { stream: !chunk.done });
    const normalized = buffered.replaceAll('\r\n', '\n');
    const frames = normalized.split('\n\n');
    buffered = frames.pop() ?? '';
    for (const event of parseTaskEvents(frames.join('\n\n'))) {
      if (event.eventType === expectedEventType) {
        return {
          event,
          cancel: async () => {
            await reader.cancel();
          },
        };
      }
    }
    if (chunk.done) {
      throw new Error(`task-stream-event-missing-${expectedEventType}`);
    }
  }
}

function isTaskEvent(value: unknown): value is TaskEvent {
  return isObject(value) && typeof value.eventType === 'string' && typeof value.sessionId === 'string' && typeof value.taskId === 'string';
}

async function waitFor(condition: () => boolean | Promise<boolean>, timeoutMs: number, timeoutCode: string): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await condition()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(timeoutCode);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
