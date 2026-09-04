const { expect, test } = require('@playwright/test');

const sessionId = 'session-history-streaming';
const longSettledAnswer = [
  'new settled answer',
  Array.from(
    { length: 500 },
    (_, index) => `排查步骤 ${index + 1}：核对骨干链路时延、抖动、丢包、队列和路由收敛证据，并保留唯一序号 ${index + 1}。`,
  ).join('\n'),
  'new settled answer final marker',
].join('\n\n');

test.beforeEach(async ({ page }) => {
  await page.routeWebSocket('**/api/v1/session-activities/ws**', (socket) => {
    socket.send(JSON.stringify({ type: 'SNAPSHOT', entries: [] }));
  });
  await page.route('**/rest/naie/guardrail/config/v1/report/risks', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ records: [] }),
    });
  });
});

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
    createdAt: `2026-07-22T08:00:${String(sequence).padStart(2, '0')}.000Z`,
    visible: true,
  };
}

function streamEnvelope(sequence, eventType, payload) {
  const requestContextId = 'context-new';
  return {
    eventId: `history-stream-${sequence}`,
    sessionId,
    requestId: 'root-new',
    runId: 'run-new',
    requestContextId,
    rootMessageId: 'root-new',
    sequence,
    eventType,
    timelineEventRef: `timeline-new-${sequence}`,
    transportHints: ['SSE'],
    payload: {
      rootMessageId: 'root-new',
      requestId: 'root-new',
      runId: 'run-new',
      requestContextId,
      ...payload,
    },
    createdAt: new Date(Date.now() + sequence).toISOString(),
  };
}

function runEnvelope(runId, rootMessageId, requestContextId, sequence, eventType, payload) {
  return {
    eventId: `${runId}-${eventType}-${sequence}`,
    sessionId,
    requestId: rootMessageId,
    runId,
    requestContextId,
    rootMessageId,
    sequence,
    eventType,
    timelineEventRef: eventType === 'CAPABILITY_RESULT_DELTA' ? null : `${runId}-timeline-${sequence}`,
    transportHints: ['SSE'],
    payload: {
      rootMessageId,
      requestId: rootMessageId,
      runId,
      requestContextId,
      ...payload,
    },
    createdAt: new Date(Date.now() + sequence).toISOString(),
  };
}

function toSse(envelopes) {
  return envelopes.map((envelope) => `data: ${JSON.stringify(envelope)}\n\n`).join('');
}

function usesWebSocketTransport() {
  return process.env.VITE_TRANSPORT_KIND?.toUpperCase() === 'WEBSOCKET';
}

function sendWebSocketEnvelopes(socket, envelopes) {
  for (const envelope of envelopes) {
    socket.send(JSON.stringify(envelope));
  }
}

function createBodyQueue() {
  const pendingBodies = new Map();
  const waiters = new Map();
  return {
    push(runId, body) {
      const waiter = waiters.get(runId)?.shift();
      if (waiter) {
        waiter(body);
      } else {
        pendingBodies.set(runId, [...(pendingBodies.get(runId) ?? []), body]);
      }
    },
    take(runId) {
      const bodies = pendingBodies.get(runId) ?? [];
      const body = bodies.shift();
      pendingBodies.set(runId, bodies);
      if (body !== undefined) {
        return Promise.resolve(body);
      }
      return new Promise((resolve) => waiters.set(runId, [...(waiters.get(runId) ?? []), resolve]));
    },
  };
}

test('keeps an anchored window stable while a submitted turn settles, then reveals it in recent mode', async ({ page }) => {
  const streamBodies = createBodyQueue();
  let pendingWebSocketEnvelopes = null;
  let conversationRequests = 0;
  let backgroundTaskRequests = 0;
  const oldPage = [
    message('old-user', 'root-old', 'USER', 1, 'anchored old question'),
    message('old-assistant', 'root-old', 'ASSISTANT', 2, 'anchored old answer'),
  ];
  const recentPage = [
    message('recent-user', 'root-recent', 'USER', 3, 'recent question'),
    message('recent-assistant', 'root-recent', 'ASSISTANT', 4, 'recent answer'),
  ];

  if (usesWebSocketTransport()) {
    await page.routeWebSocket(`**/api/v1/sessions/${sessionId}/ws**`, (socket) => {
      if (pendingWebSocketEnvelopes) {
        sendWebSocketEnvelopes(socket, pendingWebSocketEnvelopes);
        pendingWebSocketEnvelopes = null;
      }
    });
  }

  await page.route('**/api/v1/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname === `/api/v1/sessions/${sessionId}/stream`) {
      if (!url.searchParams.has('requestId')) {
        await route.fulfill({ status: 200, contentType: 'text/event-stream', body: '' });
        return;
      }
      const body = await streamBodies.take(url.searchParams.get('runId'));
      await route.fulfill({ status: 200, contentType: 'text/event-stream', body });
      return;
    }
    if (url.pathname === '/api/v1/sessions' && request.method() === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          entries: [{ sessionId, displayTitle: 'Lifecycle session', lastActivityAt: '2026-07-22T09:00:00.000Z' }],
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
        body: JSON.stringify({ sessionId, totalMarkers: 2, offset: 0, limit: 100, markers: [] }),
      });
      return;
    }
    if (url.pathname === `/api/v1/sessions/${sessionId}/conversation`) {
      conversationRequests += 1;
      const anchored = url.searchParams.get('anchorMessageId') === 'root-old';
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          sessionId,
          items: anchored ? oldPage : [...oldPage, ...recentPage],
          nextCursor: null,
          newerCursor: anchored ? 'newer-page' : null,
          activeRun: null,
        }),
      });
      return;
    }
    if (url.pathname === `/api/v1/sessions/${sessionId}/background-tasks`) {
      backgroundTaskRequests += 1;
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ tasks: [] }) });
      return;
    }
    if (url.pathname === `/api/v1/sessions/${sessionId}/requests` && request.method() === 'POST') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ sessionId, requestId: 'root-new', runId: 'run-new', attempt: 1 }),
      });
      const envelopes = [
        streamEnvelope(1, 'REQUEST_ACCEPTED', {
          attempt: 1,
          agentId: 'default-agent',
          agentVersion: 'v1',
          status: 'QUEUED',
          metadata: { accumulated: true },
        }),
        streamEnvelope(2, 'LLM_THINKING_DELTA', { delta: 'retained reasoning', contentType: 'PLAIN_TEXT' }),
        streamEnvelope(3, 'CAPABILITY_RESULT_DELTA', { toolCallId: 'tool-new', delta: 'diagnostic progress', contentType: 'PLAIN_TEXT' }),
        streamEnvelope(4, 'REQUEST_COMPLETED', {
          status: 'COMPLETED',
          content: longSettledAnswer,
          text: longSettledAnswer,
          contentType: 'MARKDOWN',
          metadata: { accumulated: true },
        }),
      ];
      if (usesWebSocketTransport()) {
        pendingWebSocketEnvelopes = envelopes;
      } else {
        streamBodies.push('run-new', toSse(envelopes));
      }
      return;
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ tasks: [] }) });
  });

  await page.goto(`/#/session/${sessionId}?messageId=root-old`);
  await expect(page.getByText('anchored old question', { exact: true })).toBeVisible();
  await expect(page.getByTestId('chat-scroll-to-bottom-floating')).toBeVisible();

  await page.getByTestId('message-textarea').fill('new anchored submission');
  await page.getByTestId('btn-send').click();
  await expect(page.getByText('new settled answer', { exact: true })).toHaveCount(0);
  await expect(page.getByText('anchored old question', { exact: true })).toBeVisible();
  await expect(page.locator('[data-testid="new-messages-banner"], [data-testid="new-messages-badge"]')).toHaveCount(0);
  await expect(page.getByTestId('btn-send')).toBeVisible();

  await page.getByTestId('chat-scroll-to-bottom-floating').click();
  await expect(page.getByText('new anchored submission', { exact: true })).toBeVisible();
  expect(longSettledAnswer.length).toBeGreaterThan(20_000);
  await expect(page.getByText('new settled answer', { exact: true })).toBeVisible();
  await expect(page.getByText('new settled answer final marker', { exact: true })).toBeVisible();
  await expect(page.getByTestId('turn-block').filter({ hasText: 'new anchored submission' })).toHaveCount(1);
  await expect(page.getByTestId('turn-process-summary').last()).toBeVisible();
  expect(conversationRequests).toBe(2);
  expect(backgroundTaskRequests).toBe(1);
});

test('keeps a settled answer visible when matching history only has the user message', async ({ page }) => {
  const userOnlySnapshot = [
    message('existing-user', 'root-existing', 'USER', 1, 'existing question'),
    message('existing-assistant', 'root-existing', 'ASSISTANT', 2, 'existing answer'),
    message('user-new', 'root-new', 'USER', 3, 'question during snapshot race'),
  ];
  let streamDelivered = false;
  const envelopes = [
    streamEnvelope(1, 'REQUEST_ACCEPTED', {
      attempt: 1,
      agentId: 'default-agent',
      agentVersion: 'v1',
      status: 'QUEUED',
      metadata: { accumulated: true },
    }),
    streamEnvelope(2, 'LLM_CONTENT_DELTA', {
      role: 'ASSISTANT',
      content: 'answer after the user-only snapshot',
      contentType: 'MARKDOWN',
      metadata: { accumulated: true },
    }),
    streamEnvelope(3, 'REQUEST_COMPLETED', { status: 'COMPLETED' }),
  ];

  if (usesWebSocketTransport()) {
    await page.routeWebSocket(`**/api/v1/sessions/${sessionId}/ws**`, (socket) => {
      if (!streamDelivered) {
        streamDelivered = true;
        sendWebSocketEnvelopes(socket, envelopes);
      }
    });
  }

  await page.route('**/api/v1/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname === `/api/v1/sessions/${sessionId}/stream`) {
      if (streamDelivered) {
        await route.fulfill({ status: 200, contentType: 'text/event-stream', body: '' });
        return;
      }
      streamDelivered = true;
      await route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        body: toSse(envelopes),
      });
      return;
    }
    if (url.pathname === '/api/v1/sessions' && request.method() === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          entries: [{ sessionId, displayTitle: 'Lifecycle session', lastActivityAt: '2026-07-22T09:00:00.000Z' }],
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
          items: userOnlySnapshot,
          nextCursor: null,
          newerCursor: null,
          activeRun: null,
        }),
      });
      return;
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ tasks: [] }) });
  });

  await page.goto(`/#/session/${sessionId}`);
  await expect(page.getByText('answer after the user-only snapshot', { exact: true })).toBeVisible();
  await expect(page.getByTestId('turn-block').filter({ hasText: 'question during snapshot race' })).toHaveCount(1);
});

test('keeps one AskUserQuestion supplemental entry through live answer, settlement, second submit and refresh', async ({ page }) => {
  const streamBodies = createBodyQueue();
  const sessionStreamKey = 'ask-user-session-stream';
  const longProjectedAnswer = '长'.repeat(4_096);
  let submitCount = 0;
  let conversationRequests = 0;
  let streamRequests = 0;
  let answerRequests = 0;
  const answerRequestPayloads = [];
  let conversationItems = [];
  const browserErrors = [];
  page.on('pageerror', (error) => {
    browserErrors.push(error.message);
  });
  page.on('console', (message) => {
    if (message.type() === 'error') {
      browserErrors.push(message.text());
    }
  });
  const expandIfCollapsed = async (toggle) => {
    if ((await toggle.getAttribute('aria-expanded')) !== 'true') {
      await toggle.click();
    }
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  };

  await page.route('**/api/v1/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname === '/api/v1/runtime/bootstrap') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ transportKind: 'SSE' }),
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
    if (url.pathname === '/api/v1/frequent-questions') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ locale: 'zh-CN', questions: [] }),
      });
      return;
    }
    if (url.pathname === `/api/v1/sessions/${sessionId}/stream`) {
      if (url.searchParams.get('runId') === null && submitCount === 0) {
        await route.fulfill({ status: 200, contentType: 'text/event-stream', body: '' });
        return;
      }
      streamRequests += 1;
      const runId = url.searchParams.get('runId');
      const body = await streamBodies.take(runId === null ? sessionStreamKey : `run:${runId}`);
      await route.fulfill({ status: 200, contentType: 'text/event-stream', body });
      return;
    }
    if (url.pathname === '/api/v1/sessions' && request.method() === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          entries: [{ sessionId, displayTitle: 'Ask user lifecycle', lastActivityAt: '2026-07-23T09:00:00.000Z' }],
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
        body: JSON.stringify({ sessionId, totalMarkers: conversationItems.length, offset: 0, limit: 100, markers: [] }),
      });
      return;
    }
    if (url.pathname === `/api/v1/sessions/${sessionId}/conversation`) {
      conversationRequests += 1;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          sessionId,
          items: conversationItems,
          nextCursor: null,
          newerCursor: null,
          activeRun: null,
        }),
      });
      return;
    }
    if (url.pathname === `/api/v1/sessions/${sessionId}/requests` && request.method() === 'POST') {
      submitCount += 1;
      if (submitCount === 1) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ sessionId, requestId: 'root-ask', runId: 'run-ask', attempt: 1 }),
        });
        streamBodies.push(
          'run:run-ask',
          toSse([
            runEnvelope('run-ask', 'root-ask', 'context-ask', 1, 'REQUEST_ACCEPTED', {
              attempt: 1,
              agentId: 'default-agent',
              agentVersion: 'v1',
              status: 'QUEUED',
            }),
            runEnvelope('run-ask', 'root-ask', 'context-ask', 2, 'USER_INPUT_REQUIRED', {
              pendingInputId: 'pending-ask',
              id: 'pending-ask',
              kind: 'QUESTION',
              status: 'PENDING',
              timeoutAt: Date.now() + 60_000,
              questions: Array.from({ length: 4 }, (_, index) => ({
                prompt: `Question ${index + 1}?`,
                options: [],
              })),
            }),
          ]),
        );
        return;
      }

      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ sessionId, requestId: 'root-second', runId: 'run-second', attempt: 1 }),
      });
      conversationItems = [
        ...conversationItems,
        {
          messageId: 'root-second',
          sessionId,
          requestId: 'root-second',
          runId: null,
          requestContextId: 'context-second',
          rootMessageId: 'root-second',
          role: 'USER',
          sequence: 4,
          content: 'second request after answer',
          contentType: 'PLAIN_TEXT',
          metadata: {},
          createdAt: '2026-07-23T09:00:04.000Z',
          visible: true,
        },
        {
          messageId: 'assistant-second',
          sessionId,
          requestId: 'root-second',
          runId: 'run-second',
          requestContextId: 'context-second',
          rootMessageId: 'root-second',
          role: 'ASSISTANT',
          sequence: 5,
          content: 'second request completed',
          contentType: 'MARKDOWN',
          metadata: { status: 'COMPLETED' },
          createdAt: '2026-07-23T09:00:05.000Z',
          visible: true,
        },
      ];
      streamBodies.push(
        'run:run-second',
        toSse([
          runEnvelope('run-second', 'root-second', 'context-second', 1, 'REQUEST_ACCEPTED', {
            attempt: 1,
            agentId: 'default-agent',
            agentVersion: 'v1',
            status: 'QUEUED',
          }),
          runEnvelope('run-second', 'root-second', 'context-second', 2, 'LLM_CONTENT_DELTA', {
            role: 'ASSISTANT',
            content: 'second request completed',
            contentType: 'MARKDOWN',
            metadata: { accumulated: true },
          }),
          runEnvelope('run-second', 'root-second', 'context-second', 3, 'REQUEST_COMPLETED', {
            status: 'COMPLETED',
          }),
        ]),
      );
      return;
    }
    if (url.pathname === `/api/v1/sessions/${sessionId}/pending-inputs/pending-ask/answer` && request.method() === 'POST') {
      answerRequests += 1;
      answerRequestPayloads.push(request.postDataJSON());
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ sessionId, pendingInputId: 'pending-ask', status: 'RECEIVED' }),
      });
      conversationItems = [
        {
          messageId: 'root-ask',
          sessionId,
          requestId: 'root-ask',
          runId: null,
          requestContextId: 'context-ask',
          rootMessageId: 'root-ask',
          role: 'USER',
          sequence: 1,
          content: 'need site information',
          contentType: 'PLAIN_TEXT',
          metadata: {},
          createdAt: '2026-07-23T09:00:01.000Z',
          visible: true,
        },
        {
          messageId: 'ask-user-answer',
          sessionId,
          requestId: 'root-ask',
          runId: 'run-ask',
          role: 'CAPABILITY_RESULT',
          sequence: 2,
          content: JSON.stringify({
            toolCallId: 'ask-user-1',
            toolName: 'AskUserQuestion',
            payload: { answers: [['RAW_DURABLE_ANSWER_MUST_NOT_RENDER']] },
          }),
          contentType: 'PLAIN_TEXT',
          metadata: { kind: 'CAPABILITY_RESULT', toolCallId: 'ask-user-1', toolName: 'AskUserQuestion' },
          pendingInputAnswer: {
            capabilityId: 'AskUserQuestion',
            toolCallId: 'ask-user-1',
            pendingInputId: 'pending-ask',
            kind: 'QUESTION',
            status: 'RECEIVED',
            safeSummary: 'Pending input answer received.',
            safeResult: {
              kind: 'pendingInputAnswer',
              answers: [[longProjectedAnswer], ['answer-2'], ['answer-3'], ['answer-4']],
              truncated: true,
            },
          },
          createdAt: '2026-07-23T09:00:02.000Z',
          visible: true,
        },
        {
          messageId: 'assistant-ask',
          sessionId,
          requestId: 'root-ask',
          runId: 'run-ask',
          requestContextId: 'context-ask',
          rootMessageId: 'root-ask',
          role: 'ASSISTANT',
          sequence: 3,
          content: 'site information accepted',
          contentType: 'MARKDOWN',
          metadata: { status: 'COMPLETED' },
          createdAt: '2026-07-23T09:00:03.000Z',
          visible: true,
        },
      ];
      streamBodies.push(
        sessionStreamKey,
        toSse([
          runEnvelope('run-ask', 'root-ask', 'context-ask', 3, 'USER_INPUT_RECEIVED', {
            pendingInputId: 'pending-ask',
            id: 'pending-ask',
            kind: 'QUESTION',
            status: 'RECEIVED',
            safeSummary: 'Pending input answer received.',
          }),
          runEnvelope('run-ask', 'root-ask', 'context-ask', 4, 'CAPABILITY_RESULT_DELTA', {
            capabilityId: 'AskUserQuestion',
            toolCallId: 'ask-user-1',
            pendingInputId: 'pending-ask',
            kind: 'QUESTION',
            status: 'RECEIVED',
            safeSummary: 'Pending input answer received.',
            text: '',
            content: '',
            contentType: 'PLAIN_TEXT',
            metadata: { accumulated: true },
            safeResult: {
              kind: 'pendingInputAnswer',
              answers: [[longProjectedAnswer], ['answer-2'], ['answer-3'], ['answer-4']],
              truncated: true,
            },
          }),
          runEnvelope('run-ask', 'root-ask', 'context-ask', 5, 'CAPABILITY_COMPLETED', {
            capabilityId: 'AskUserQuestion',
            toolCallId: 'ask-user-1',
            pendingInputId: 'pending-ask',
            kind: 'QUESTION',
            status: 'SUCCEEDED',
            safeSummary: 'Pending input answer received.',
            text: '',
            content: '',
            contentType: 'PLAIN_TEXT',
            metadata: { accumulated: true },
            safeResult: {
              kind: 'pendingInputAnswer',
              answers: [[longProjectedAnswer], ['answer-2'], ['answer-3'], ['answer-4']],
              truncated: true,
            },
          }),
          runEnvelope('run-ask', 'root-ask', 'context-ask', 6, 'LLM_CONTENT_DELTA', {
            role: 'ASSISTANT',
            content: 'site information accepted',
            contentType: 'MARKDOWN',
            metadata: { accumulated: true },
          }),
          runEnvelope('run-ask', 'root-ask', 'context-ask', 7, 'REQUEST_COMPLETED', {
            status: 'COMPLETED',
          }),
        ]),
      );
      return;
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ tasks: [] }) });
  });

  await page.goto(`/#/session/${sessionId}`);
  await expect(page.getByTestId('message-textarea')).toBeVisible();
  await page.getByTestId('message-textarea').fill('need site information');
  await page.getByTestId('btn-send').click();
  await expect(page.getByTestId('respond-input-question')).toBeVisible();

  const firstTurn = page.getByTestId('turn-block').filter({ hasText: 'need site information' });
  const firstTurnProcessToggle = firstTurn.getByTestId('turn-process-toggle');
  await expandIfCollapsed(firstTurnProcessToggle);
  await expect(firstTurn.getByText('Waiting for additional information', { exact: true })).toHaveCount(1);
  await expect(page.getByTestId('user-bubble')).toHaveCount(1);

  const conversationRequestCount = conversationRequests;
  await page.getByTestId('respond-question-0-textarea').fill('answer-1');
  await page.getByTestId('btn-next-question').click();
  await page.getByTestId('respond-question-1-textarea').fill('answer-2');
  await page.getByTestId('btn-next-question').click();
  await page.getByTestId('respond-question-2-textarea').fill('answer-3');
  await page.getByTestId('btn-previous-question').click();
  await page.getByTestId('respond-question-1-textarea').fill('answer-2-modified');
  await page.getByTestId('btn-next-question').click();
  await expect(page.getByTestId('respond-question-2-textarea')).toHaveValue('answer-3');
  await page.getByTestId('btn-next-question').click();
  await expect(page.getByTestId('respond-question-progress')).toContainText('4 / 4');
  await page.getByTestId('respond-question-3-textarea').fill('answer-4');
  expect(conversationRequests).toBe(conversationRequestCount);
  expect(answerRequests).toBe(0);
  await page.getByTestId('btn-submit-response').click();
  await expect(page.getByText('site information accepted', { exact: true })).toBeVisible();
  await expect(firstTurn.getByTestId('turn-process-summary-text')).toContainText('Completed');
  await expect(firstTurnProcessToggle).toHaveAttribute('aria-expanded', 'false');
  await expandIfCollapsed(firstTurnProcessToggle);
  await expect(firstTurn.getByText('Additional information', { exact: true })).toHaveCount(1);
  await expect(firstTurn.getByText('Waiting for additional information', { exact: true })).toHaveCount(0);
  await expandIfCollapsed(
    firstTurn.getByTestId('turn-process-entry-toggle').filter({
      hasText: 'Additional information',
    }),
  );
  await expect(firstTurn.getByTestId('turn-process-entry-detail')).toContainText('Content was too long and has been truncated');
  await expect(firstTurn.getByText('AskUserQuestion', { exact: false })).toHaveCount(0);
  await expect(firstTurn.getByText('Responded', { exact: true })).toHaveCount(0);
  await expect(page.getByTestId('user-bubble')).toHaveCount(1);
  expect(answerRequests).toBe(1);
  expect(answerRequestPayloads).toEqual([
    {
      answers: [['answer-1'], ['answer-2-modified'], ['answer-3'], ['answer-4']],
    },
  ]);

  await page.getByTestId('message-textarea').fill('second request after answer');
  await page.getByTestId('btn-send').click();
  await expect(page.getByText('second request completed', { exact: true })).toBeVisible();
  await expect(page.getByTestId('user-bubble')).toHaveCount(2);
  await expandIfCollapsed(firstTurnProcessToggle);
  await expect(firstTurn.getByText('Additional information', { exact: true })).toHaveCount(1);

  await page.reload();
  const refreshedFirstTurn = page.getByTestId('turn-block').filter({ hasText: 'need site information' });
  await expect(refreshedFirstTurn).toHaveCount(1);
  const refreshedFirstTurnProcessToggle = refreshedFirstTurn.getByTestId('turn-process-toggle');
  await expandIfCollapsed(refreshedFirstTurnProcessToggle);
  await expect(refreshedFirstTurn.getByText('Additional information', { exact: true })).toHaveCount(1);
  await expandIfCollapsed(
    refreshedFirstTurn.getByTestId('turn-process-entry-toggle').filter({
      hasText: 'Additional information',
    }),
  );
  await expect(refreshedFirstTurn.getByTestId('turn-process-entry-detail')).toContainText('Content was too long and has been truncated');
  await expect(refreshedFirstTurn.getByText('RAW_DURABLE_ANSWER_MUST_NOT_RENDER', { exact: false })).toHaveCount(0);

  const requestCounts = { conversationRequests, streamRequests };
  await page.waitForTimeout(500);
  expect({ conversationRequests, streamRequests }).toEqual(requestCounts);
  expect(conversationRequests).toBeLessThanOrEqual(5);
  expect(streamRequests).toBeLessThanOrEqual(6);
  expect(browserErrors).toEqual([]);
});

test('keeps a 20-question compatibility input reachable without navigation requests or freezing', async ({ page }) => {
  let submitted = false;
  let streamDelivered = false;
  let requestSubmits = 0;
  let conversationRequests = 0;
  let streamRequests = 0;
  let answerRequests = 0;
  let answerPayload;
  const browserErrors = [];
  page.on('pageerror', (error) => browserErrors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') {
      browserErrors.push(message.text());
    }
  });

  await page.route('**/api/v1/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname === '/api/v1/runtime/bootstrap') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ transportKind: 'SSE' }) });
      return;
    }
    if (url.pathname === '/api/v1/skills') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ total: 0, pageNum: 1, pageSize: 50, skills: [] }) });
      return;
    }
    if (url.pathname === '/api/v1/frequent-questions') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ locale: 'zh-CN', questions: [] }) });
      return;
    }
    if (url.pathname === '/api/v1/sessions' && request.method() === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          entries: [{ sessionId, displayTitle: 'Twenty questions', lastActivityAt: '2026-07-23T09:00:00.000Z' }],
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
        body: JSON.stringify({ sessionId, totalMarkers: 0, offset: 0, limit: 100, markers: [] }),
      });
      return;
    }
    if (url.pathname === `/api/v1/sessions/${sessionId}/conversation`) {
      conversationRequests += 1;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ sessionId, items: [], nextCursor: null, newerCursor: null, activeRun: null }),
      });
      return;
    }
    if (url.pathname === `/api/v1/sessions/${sessionId}/requests` && request.method() === 'POST') {
      submitted = true;
      requestSubmits += 1;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ sessionId, requestId: 'root-20', runId: 'run-20', attempt: 1 }),
      });
      return;
    }
    if (url.pathname === `/api/v1/sessions/${sessionId}/stream`) {
      streamRequests += 1;
      if (!submitted || streamDelivered) {
        await route.fulfill({ status: 200, contentType: 'text/event-stream', body: '' });
        return;
      }
      streamDelivered = true;
      await route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        body: toSse([
          runEnvelope('run-20', 'root-20', 'context-20', 1, 'REQUEST_ACCEPTED', {
            attempt: 1,
            agentId: 'default-agent',
            agentVersion: 'v1',
            status: 'QUEUED',
          }),
          runEnvelope('run-20', 'root-20', 'context-20', 2, 'USER_INPUT_REQUIRED', {
            pendingInputId: 'pending-20',
            id: 'pending-20',
            kind: 'QUESTION',
            status: 'PENDING',
            timeoutAt: Date.now() + 60_000,
            questions: Array.from({ length: 20 }, (_, index) => ({
              prompt: `Compatibility question ${index + 1}?`,
              options: [],
            })),
          }),
        ]),
      });
      return;
    }
    if (url.pathname === `/api/v1/sessions/${sessionId}/pending-inputs/pending-20/answer` && request.method() === 'POST') {
      answerRequests += 1;
      answerPayload = request.postDataJSON();
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ sessionId, pendingInputId: 'pending-20', status: 'RECEIVED' }),
      });
      return;
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ tasks: [] }) });
  });

  await page.goto(`/#/session/${sessionId}`);
  await page.getByTestId('message-textarea').fill('trigger twenty questions');
  await page.getByTestId('btn-send').click();
  await expect(page.getByTestId('respond-question-progress')).toContainText('1 / 20');
  const navigationRequestCounts = { requestSubmits, conversationRequests, streamRequests };

  await page.evaluate(async () => {
    const setTextareaValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
    if (setTextareaValue === undefined) {
      throw new Error('textarea value setter unavailable');
    }
    for (let index = 0; index < 20; index += 1) {
      const textarea = document.querySelector(`[data-testid="respond-question-${index}-textarea"]`);
      if (!(textarea instanceof HTMLTextAreaElement)) {
        throw new Error(`question ${index + 1} is not reachable`);
      }
      if (document.querySelectorAll('[data-testid^="respond-question-"][data-testid$="-textarea"]').length !== 1) {
        throw new Error('more than one question is mounted');
      }
      setTextareaValue.call(textarea, `answer-${index + 1}`);
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 0));
      if (index < 19) {
        const next = document.querySelector('[data-testid="btn-next-question"]');
        if (!(next instanceof HTMLButtonElement) || next.disabled) {
          throw new Error(`question ${index + 1} cannot advance`);
        }
        next.click();
        await new Promise(requestAnimationFrame);
      }
    }
  });

  expect({ requestSubmits, conversationRequests, streamRequests }).toEqual(navigationRequestCounts);
  expect(answerRequests).toBe(0);
  await expect(page.getByTestId('respond-question-progress')).toContainText('20 / 20');
  await page.getByTestId('btn-submit-response').click();
  await expect.poll(() => answerRequests).toBe(1);
  expect(answerPayload).toEqual({
    answers: Array.from({ length: 20 }, (_, index) => [`answer-${index + 1}`]),
  });
  expect(requestSubmits).toBe(1);
  expect(browserErrors).toEqual([]);
});
