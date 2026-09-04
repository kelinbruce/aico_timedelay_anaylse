/**
 * E2E Case: feature-tree smoke - 会话管理.
 * Entry: session create, title update, list, and delete Web APIs.
 */
import { createNextAgentTestApp } from '@nextagent/agent-platform-gateway-local/testing';
import { expect, it } from 'vitest';
import { describeRealModelSmoke, idem, submitAndWaitForSession, waitForSessionStream } from './system-smoke-helpers.js';

describeRealModelSmoke('feature-tree smoke: 会话管理', () => {
  it('creates, updates, lists, and deletes a session through persisted session APIs', async () => {
    const app = createNextAgentTestApp({ workspaceDir: process.cwd(), modelSteps: [{ content: 'unused' }] });

    const created = await app.server.inject({ method: 'POST', url: '/api/v1/sessions', payload: { locale: 'zh-CN' } });
    expect(created.statusCode).toBe(200);
    const sessionId = created.json<{ sessionId: string }>().sessionId;

    const titled = await app.server.inject({
      method: 'PUT',
      url: `/api/v1/sessions/${sessionId}/title`,
      payload: { title: 'RAN smoke session' },
    });
    expect(titled.statusCode).toBe(200);
    expect(titled.json<{ sessionId: string; displayTitle: string }>()).toMatchObject({ sessionId, displayTitle: 'RAN smoke session' });

    const listed = await app.server.inject({ method: 'GET', url: '/api/v1/sessions?limit=10' });
    expect(listed.statusCode).toBe(200);
    expect(listed.json<{ entries: Array<{ sessionId: string }> }>().entries.some((entry) => entry.sessionId === sessionId)).toBe(true);

    const deleted = await app.server.inject({ method: 'DELETE', url: `/api/v1/sessions/${sessionId}` });
    expect(deleted.statusCode).toBe(204);
  });

  it('creates a scoped conversation share and reads only the selected run', async () => {
    const app = createNextAgentTestApp({
      workspaceDir: process.cwd(),
      modelSteps: [{ content: 'First shared answer.' }, { content: 'Second private answer.' }],
    });

    const first = await submitAndWaitForSession(app, 'First shared question.', 'First shared answer.', 'share-first');
    const secondAccepted = await app.server.inject({
      method: 'POST',
      url: '/api/v1/requests',
      payload: {
        sessionId: first.sessionId,
        inputText: 'Second private question.',
        idempotencyKey: idem('share-second'),
      },
    });
    expect(secondAccepted.statusCode).toBe(200);
    const second = secondAccepted.json<{ runId: string }>();
    await waitForSessionStream(app, first.sessionId, second.runId, 'Second private answer.');

    const createdShare = await app.server.inject({
      method: 'POST',
      url: `/api/v1/sessions/${first.sessionId}/shares`,
      payload: {
        runIds: [first.runId],
        originUrl: `http://127.0.0.1:3000/immersive.html#/session/${first.sessionId}`,
        expiresIn: 'permanent',
        allowedOps: null,
      },
    });
    expect(createdShare.statusCode).toBe(200);
    const share = createdShare.json<{ shareId: string; shareUrl: string }>();
    expect(share.shareUrl).toContain(`#/shared/${share.shareId}`);

    const sharedConversation = await app.server.inject({
      method: 'GET',
      url: `/api/v1/shares/${share.shareId}/conversation`,
    });
    expect(sharedConversation.statusCode).toBe(200);
    const body = sharedConversation.json<{ messages: Array<{ runId?: string; content: string }> }>();
    expect(body.messages.length).toBeGreaterThanOrEqual(2);
    expect(body.messages.every((message) => message.runId === first.runId)).toBe(true);
    expect(body.messages.some((message) => message.content === 'First shared question.')).toBe(true);
    expect(body.messages.some((message) => message.content === 'First shared answer.')).toBe(true);
    expect(body.messages.some((message) => message.content === 'Second private question.')).toBe(false);
    expect(body.messages.some((message) => message.content === 'Second private answer.')).toBe(false);
  });
});
