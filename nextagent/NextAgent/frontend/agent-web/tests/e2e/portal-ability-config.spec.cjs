const { expect, test } = require('@playwright/test');

const sessionId = 'portal-ability-config';

function message(messageId, rootMessageId, role, sequence, content) {
  return {
    messageId,
    sessionId,
    requestId: rootMessageId,
    runId: role === 'USER' ? null : `run-${rootMessageId}`,
    requestContextId: rootMessageId,
    rootMessageId,
    role,
    sequence,
    content,
    contentType: role === 'ASSISTANT' ? 'MARKDOWN' : 'PLAIN_TEXT',
    metadata: role === 'ASSISTANT' ? { status: 'COMPLETED' } : {},
    createdAt: `2026-08-19T08:00:${String(sequence).padStart(2, '0')}.000Z`,
    visible: true,
  };
}

function streamEnvelope(sequence, eventType, payload) {
  return {
    eventId: `portal-ability-${sequence}`,
    sessionId,
    requestId: 'root-new',
    runId: 'run-new',
    requestContextId: 'context-new',
    rootMessageId: 'root-new',
    sequence,
    eventType,
    timelineEventRef: `timeline-new-${sequence}`,
    transportHints: ['SSE'],
    payload: {
      rootMessageId: 'root-new',
      requestId: 'root-new',
      runId: 'run-new',
      requestContextId: 'context-new',
      ...payload,
    },
    createdAt: new Date(Date.now() + sequence).toISOString(),
  };
}

function toSse(envelopes) {
  return envelopes.map((envelope) => `data: ${JSON.stringify(envelope)}\n\n`).join('');
}

for (const scenario of [
  { name: 'false', bootstrap: { transportKind: 'SSE', portalAbilityConfig: { suggestedQuestionsEnabled: false } }, expectQuestions: false },
  { name: 'default', bootstrap: { transportKind: 'SSE' }, expectQuestions: true },
  { name: 'true', bootstrap: { transportKind: 'SSE', portalAbilityConfig: { suggestedQuestionsEnabled: true } }, expectQuestions: true },
]) {
  test(`renders live suggested questions according to portal ability config: ${scenario.name}`, async ({ page }) => {
    let suggestedQuestionRequests = 0;
    let streamBodyDelivered = false;

    await page.routeWebSocket('**/api/v1/session-activities/ws**', (socket) => {
      socket.send(JSON.stringify({ type: 'SNAPSHOT', entries: [] }));
    });
    await page.route('**/rest/naie/guardrail/config/v1/report/risks', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ records: [] }) });
    });

    await page.route('**/api/v1/**', async (route) => {
      const request = route.request();
      const url = new URL(request.url());

      if (url.pathname === '/api/v1/runtime/bootstrap') {
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(scenario.bootstrap) });
        return;
      }

      if (url.pathname === `/api/v1/sessions/${sessionId}/stream`) {
        if (!url.searchParams.has('requestId') || streamBodyDelivered) {
          await route.fulfill({ status: 200, contentType: 'text/event-stream', body: '' });
          return;
        }
        streamBodyDelivered = true;
        await route.fulfill({
          status: 200,
          contentType: 'text/event-stream',
          body: toSse([
            streamEnvelope(1, 'REQUEST_ACCEPTED', {
              attempt: 1,
              agentId: 'default-agent',
              agentVersion: 'v1',
              status: 'QUEUED',
              metadata: { accumulated: true },
            }),
            streamEnvelope(2, 'LLM_CONTENT_DELTA', {
              role: 'ASSISTANT',
              content: '网络诊断已完成',
              contentType: 'MARKDOWN',
              metadata: { accumulated: true },
            }),
            streamEnvelope(3, 'REQUEST_COMPLETED', { status: 'COMPLETED' }),
          ]),
        });
        return;
      }

      if (url.pathname === '/api/v1/sessions' && request.method() === 'GET') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            entries: [{ sessionId, displayTitle: 'Portal ability journey', lastActivityAt: '2026-08-19T08:00:02.000Z' }],
            offset: 0,
            limit: 50,
            hasMore: false,
          }),
        });
        return;
      }

      if (url.pathname === `/api/v1/sessions/${sessionId}/conversation/preview`) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ sessionId, totalMarkers: 1, offset: 0, limit: 100, markers: [] }),
        });
        return;
      }

      if (url.pathname === `/api/v1/sessions/${sessionId}/conversation`) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            sessionId,
            items: [
              message('portal-user', 'portal-root', 'USER', 1, '请诊断网络'),
              message('portal-assistant', 'portal-root', 'ASSISTANT', 2, '历史诊断结果'),
            ],
            nextCursor: null,
            newerCursor: null,
            activeRun: null,
          }),
        });
        return;
      }

      if (url.pathname === `/api/v1/sessions/${sessionId}/requests/root-new/suggested-questions`) {
        suggestedQuestionRequests += 1;
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ questions: ['下一步如何核查链路？'] }) });
        return;
      }

      if (url.pathname === `/api/v1/sessions/${sessionId}/requests` && request.method() === 'POST') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ sessionId, requestId: 'root-new', runId: 'run-new', attempt: 1 }),
        });
        return;
      }

      if (url.pathname === '/api/v1/skills') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ total: 0, pageNum: 1, pageSize: 50, skills: [] }),
        });
        return;
      }

      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ tasks: [] }) });
    });

    await page.goto(`/#/session/${sessionId}`);
    await expect(page.getByText('历史诊断结果', { exact: true })).toBeVisible();

    await page.getByTestId('message-textarea').fill('请生成新的网络诊断');
    await page.getByTestId('btn-send').click();
    await expect(page.getByText('网络诊断已完成', { exact: true })).toBeVisible();

    if (scenario.expectQuestions) {
      await expect(page.getByTestId('suggested-questions')).toBeVisible();
      await expect(page.getByTestId('suggested-question-item')).toHaveText('下一步如何核查链路？');
      expect(suggestedQuestionRequests).toBe(1);
    } else {
      await expect(page.getByTestId('suggested-questions')).toHaveCount(0);
      await expect(page.getByTestId('suggested-questions-loading')).toHaveCount(0);
      expect(suggestedQuestionRequests).toBe(0);
    }
  });
}
