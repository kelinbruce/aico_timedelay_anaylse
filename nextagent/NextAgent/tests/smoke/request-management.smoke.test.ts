/**
 * E2E Case: feature-tree smoke - 请求管理.
 * Entry: request validation, acceptance, run terminal commit, and conversation projection.
 */
import { createNextAgentTestApp } from '@nextagent/agent-platform-gateway-local/testing';
import { expect, it } from 'vitest';
import {
  describeRealModelSmoke,
  idem,
  smokeIdentity,
  submitAndWaitForSession,
  waitForActivePendingInput,
  waitForSessionStream,
} from './system-smoke-helpers.js';

describeRealModelSmoke('feature-tree smoke: 请求管理', () => {
  it('rejects invalid requests and commits a valid request to terminal history', async () => {
    const app = createNextAgentTestApp({
      workspaceDir: process.cwd(),
      modelSteps: [{ contentChunks: ['Request management', ' smoke completed.'] }],
    });

    const rejected = await app.server.inject({
      method: 'POST',
      url: '/api/v1/requests',
      payload: { inputText: '', idempotencyKey: idem('request-invalid') },
    });
    expect(rejected.statusCode).toBe(400);
    expect(rejected.body).toContain('REQUEST_VALIDATION_FAILED');

    const result = await submitAndWaitForSession(app, 'Run request management smoke.', 'Request management smoke completed.', 'request-valid');
    const conversation = await app.server.inject({ method: 'GET', url: `/api/v1/sessions/${result.sessionId}/conversation?limit=10` });
    expect(conversation.statusCode).toBe(200);
    expect(conversation.json<{ items: Array<{ role: string; content: string }> }>().items.map((item) => item.role)).toEqual(['USER', 'ASSISTANT']);
  });

  it('pauses on a model-requested human question and resumes after the answer boundary', async () => {
    const app = createNextAgentTestApp({
      workspaceDir: process.cwd(),
      identity: smokeIdentity,
      modelSteps: [
        {
          toolCalls: [
            {
              toolCallId: 'ask-region-smoke',
              toolName: 'AskUserQuestion',
              arguments: {
                questions: [
                  {
                    prompt: 'Which region should I inspect?',
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
        { content: 'human pending input smoke completed.' },
      ],
    });

    const accepted = await app.server.inject({
      method: 'POST',
      url: '/api/v1/requests',
      payload: {
        inputText: 'Ask for the region before continuing.',
        idempotencyKey: idem('request-pending-input'),
      },
    });
    expect(accepted.statusCode).toBe(200);
    const body = accepted.json<{ sessionId: string; runId: string }>();
    const pending = await waitForActivePendingInput(app, body.sessionId);
    expect(pending.kind).toBe('QUESTION');

    const answered = await app.server.inject({
      method: 'POST',
      url: `/api/v1/sessions/${body.sessionId}/pending-inputs/${String(pending.pendingInputId)}/answer`,
      payload: { answers: [['north']] },
    });
    expect(answered.statusCode).toBe(200);
    expect(answered.json<{ pendingInputId: string; status: string }>()).toMatchObject({
      pendingInputId: pending.pendingInputId,
      status: 'RECEIVED',
    });

    await waitForSessionStream(app, body.sessionId, body.runId, 'human pending input smoke completed.');
    const conversation = await app.server.inject({
      method: 'GET',
      url: `/api/v1/sessions/${body.sessionId}/conversation?limit=20&includeCapabilityResults=true`,
    });
    expect(conversation.statusCode).toBe(200);
    expect(conversation.body).toContain('"toolName":"AskUserQuestion"');
  });
});
