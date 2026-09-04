import { cleanupNextAgentTestApps, createNextAgentTestApp } from '@nextagent/agent-platform-gateway-local/testing';
import { brand } from '@nextagent/agent-common';
import type { PendingInputRecord } from '@nextagent/agent-contracts/gateway';
import { afterEach, describe, expect, it } from 'vitest';

afterEach(async () => {
  await cleanupNextAgentTestApps();
});

describe('daily product path', () => {
  it('runs a single-turn request through Web API, stream, and conversation history', async () => {
    const app = createNextAgentTestApp({
      workspaceDir: process.cwd(),
      modelSteps: [{ contentChunks: ['LTE KPI', ' RRC setup success rate is healthy.'] }],
    });

    const accepted = await app.server.inject({
      method: 'POST',
      url: '/api/v1/requests',
      payload: { inputText: 'Check LTE KPI health.', idempotencyKey: idempotencyKey('single-turn'), locale: 'en-US' },
    });

    expect(accepted.statusCode).toBe(200);
    const body = accepted.json<{ sessionId: string; runId: string }>();
    const streamBody = await expectCompletedStream(app, body.sessionId, body.runId, 'LTE KPI RRC setup success rate is healthy.');

    const conversation = await app.server.inject({ method: 'GET', url: `/api/v1/sessions/${body.sessionId}/conversation?limit=10` });
    expect(conversation.statusCode).toBe(200);
    const history = conversation.json<{ items: Array<{ role: string; content: string }> }>();
    expect(history.items.map((item) => item.role)).toEqual(['USER', 'ASSISTANT']);
    expect(history.items.at(-1)?.content).toContain('RRC setup success rate');
    expect(streamBody).toContain('event: REQUEST_COMPLETED');
  }, 20_000);

  it('keeps multi-turn session state across two requests', async () => {
    const app = createNextAgentTestApp({
      workspaceDir: process.cwd(),
      modelSteps: [{ content: 'first alarm summary' }, { content: 'second answer uses prior alarm summary' }],
    });
    const created = await app.server.inject({ method: 'POST', url: '/api/v1/sessions', payload: {} });
    expect(created.statusCode).toBe(200);
    const { sessionId } = created.json<{ sessionId: string }>();

    const first = await submitSessionRequest(app, sessionId, 'Summarize current alarms.', 'multi-turn-1');
    await expectCompletedStream(app, sessionId, first.runId, 'first alarm summary');

    const second = await submitSessionRequest(app, sessionId, 'Use the previous answer for next action.', 'multi-turn-2');
    await expectCompletedStream(app, sessionId, second.runId, 'second answer uses prior alarm summary');

    const conversation = await app.server.inject({ method: 'GET', url: `/api/v1/sessions/${sessionId}/conversation?limit=10` });
    const history = conversation.json<{ items: Array<{ role: string; content: string }> }>();
    expect(history.items.map((item) => item.role)).toEqual(['USER', 'ASSISTANT', 'USER', 'ASSISTANT']);
    expect(history.items.at(-1)?.content).toContain('prior alarm summary');
  }, 30_000);

  it('executes Tool, Skill, and Agent capabilities on the product path', async () => {
    const app = createNextAgentTestApp({
      workspaceDir: process.cwd(),
      modelSteps: [
        {
          toolCalls: [
            { toolCallId: 'tool-glob-product', toolName: 'Glob', arguments: { pattern: 'workspace/**/*' } },
            { toolCallId: 'tool-skill-product', toolName: 'Skill', arguments: { name: 'skill-creator', args: { alarm: 'LOS' } } },
            {
              toolCallId: 'tool-agent-product',
              toolName: 'Agent',
              arguments: { agentId: 'network-explorer', prompt: 'Collect bounded LTE alarm evidence.' },
            },
          ],
        },
        { content: 'network explorer terminal evidence' },
        { content: 'parent incorporated tool, skill, and agent evidence' },
      ],
    });

    const accepted = await app.server.inject({
      method: 'POST',
      url: '/api/v1/requests',
      payload: { inputText: 'Collect telecom evidence.', idempotencyKey: idempotencyKey('capabilities') },
    });
    expect(accepted.statusCode).toBe(200);
    const body = accepted.json<{ sessionId: string; requestId: string; runId: string }>();
    const streamBody = await expectCompletedStream(app, body.sessionId, body.runId, 'parent incorporated tool, skill, and agent evidence', 20_000);

    for (const toolCallId of ['tool-glob-product', 'tool-skill-product', 'tool-agent-product']) {
      expect(streamBody).toContain(toolCallId);
    }
    expect(streamBody).not.toContain('UNKNOWN_AGENT_TYPE');

    const conversation = await app.server.inject({
      method: 'GET',
      url: `/api/v1/sessions/${body.sessionId}/conversation?limit=20&includeCapabilityResults=true`,
    });
    expect(conversation.statusCode).toBe(200);
    const history = conversation.json<{ items: Array<{ role: string; content: string; metadata?: Record<string, unknown> }> }>();
    const capabilityResults = history.items.filter((item) => item.role === 'CAPABILITY_RESULT');
    expect(capabilityResults).toHaveLength(3);
    expect(capabilityResults.every((item) => item.content === '')).toBe(true);

    const childSessions = await app.gateway.sessions.listSessions({
      tenantId: brand<string, 'TenantId'>('tenant-1'),
      subjectId: brand<string, 'SubjectId'>('subject-1'),
      agentId: brand<string, 'AgentId'>('network-explorer'),
      offset: 0,
      limit: 10,
    });
    expect(
      childSessions.entries.some(
        (entry) =>
          entry.parentSessionId === body.sessionId &&
          entry.parentRequestId === body.requestId &&
          entry.parentRunId === body.runId &&
          entry.latestRunStatus === 'COMPLETED',
      ),
    ).toBe(true);
  }, 20_000);

  it('round-trips human input through pending input answer API', async () => {
    const app = createNextAgentTestApp({
      workspaceDir: process.cwd(),
      modelSteps: [
        {
          toolCalls: [
            {
              toolCallId: 'ask-region-product',
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
        { content: 'north region accepted' },
      ],
    });

    const accepted = await app.server.inject({
      method: 'POST',
      url: '/api/v1/requests',
      payload: { inputText: 'Need region before diagnosis.', idempotencyKey: idempotencyKey('human-input') },
    });
    expect(accepted.statusCode).toBe(200);
    const body = accepted.json<{ sessionId: string; runId: string }>();
    const pending = await waitForActivePending(app, body.sessionId);
    expect(pending).toMatchObject({ kind: 'QUESTION', producerRef: { kind: 'CAPABILITY_INVOCATION', capabilityId: 'AskUserQuestion' } });

    const answered = await app.server.inject({
      method: 'POST',
      url: `/api/v1/sessions/${pending.sessionId}/pending-inputs/${pending.pendingInputId}/answer`,
      payload: { answers: [['north']] },
    });
    expect(answered.statusCode).toBe(200);
    await waitFor(async () => {
      const conversation = await app.server.inject({ method: 'GET', url: `/api/v1/sessions/${body.sessionId}/conversation?limit=10` });
      return conversation.body.includes('north region accepted');
    });

    const streamBody = await expectCompletedStream(app, body.sessionId, body.runId, 'north region accepted');
    expect(streamBody).toContain('event: USER_INPUT_REQUIRED');
    expect(streamBody).toContain('event: USER_INPUT_RECEIVED');
  }, 20_000);
});

async function submitSessionRequest(
  app: ReturnType<typeof createNextAgentTestApp>,
  sessionId: string,
  inputText: string,
  keyPrefix: string,
): Promise<{ runId: string }> {
  const response = await app.server.inject({
    method: 'POST',
    url: `/api/v1/sessions/${sessionId}/requests`,
    payload: { inputText, idempotencyKey: idempotencyKey(keyPrefix) },
  });
  expect(response.statusCode).toBe(200);
  return response.json<{ runId: string }>();
}

async function expectCompletedStream(
  app: ReturnType<typeof createNextAgentTestApp>,
  sessionId: string,
  runId: string,
  content: string,
  timeoutMs = 15_000,
): Promise<string> {
  let streamBody = '';
  await waitFor(async () => {
    const stream = await app.server.inject({ method: 'GET', url: `/api/v1/sessions/${sessionId}/stream?lastSeenSequence=0&runId=${runId}` });
    expect(stream.statusCode).toBe(200);
    streamBody = stream.body;
    return streamBody.includes('event: REQUEST_COMPLETED') && streamBody.includes(content);
  }, timeoutMs);
  return streamBody;
}

async function waitForActivePending(app: ReturnType<typeof createNextAgentTestApp>, sessionId: string): Promise<PendingInputRecord> {
  await waitFor(async () => (await loadActivePending(app, sessionId)) !== undefined);
  return (await loadActivePending(app, sessionId))!;
}

function loadActivePending(app: ReturnType<typeof createNextAgentTestApp>, sessionId: string): Promise<PendingInputRecord | undefined> {
  return app.gateway.pendingInputs.loadActivePendingInput({
    tenantId: brand<string, 'TenantId'>('tenant-1'),
    subjectId: brand<string, 'SubjectId'>('subject-1'),
    agentId: brand<string, 'AgentId'>('default-agent'),
    sessionId: brand<string, 'SessionId'>(sessionId),
  });
}

async function waitFor(assertion: () => boolean | Promise<boolean>, timeoutMs = 15_000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await assertion()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('Timed out waiting for product path condition.');
}

function idempotencyKey(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}
