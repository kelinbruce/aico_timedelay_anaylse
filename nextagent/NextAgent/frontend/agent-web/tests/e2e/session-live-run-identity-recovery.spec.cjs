const { expect, test } = require('@playwright/test');

const sessionId = 'session-live-run-identity-recovery';

function toSse(envelopes) {
  return envelopes.map((envelope) => `data: ${JSON.stringify(envelope)}\n\n`).join('');
}

function runEnvelope({ sequence, eventType, rootMessageId, runId, requestContextId, payload }) {
  return {
    eventId: `${runId}-${eventType}-${sequence}`,
    sessionId,
    requestId: rootMessageId,
    runId,
    requestContextId,
    rootMessageId,
    sequence,
    eventType,
    timelineEventRef: `${runId}-timeline-${sequence}`,
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

function userMessage(rootMessageId, content) {
  return {
    messageId: `${rootMessageId}-user`,
    sessionId,
    requestId: rootMessageId,
    runId: null,
    requestContextId: rootMessageId,
    rootMessageId,
    role: 'USER',
    sequence: 1,
    content,
    contentType: 'PLAIN_TEXT',
    metadata: {},
    createdAt: '2026-07-24T08:00:00.000Z',
    visible: true,
  };
}

function assistantMessage(rootMessageId, content) {
  return {
    messageId: `${rootMessageId}-assistant`,
    sessionId,
    requestId: rootMessageId,
    runId: null,
    requestContextId: rootMessageId,
    rootMessageId,
    role: 'ASSISTANT',
    sequence: 2,
    content,
    contentType: 'MARKDOWN',
    metadata: { status: 'COMPLETED' },
    createdAt: '2026-07-24T08:00:01.000Z',
    visible: true,
  };
}

function createRunBodyBroker() {
  const bodies = new Map();
  const waiters = new Map();
  return {
    push(runId, body) {
      const waiter = waiters.get(runId)?.shift();
      if (waiter) {
        waiter(body);
        return;
      }
      bodies.set(runId, body);
    },
    take(runId) {
      const body = bodies.get(runId);
      if (body !== undefined) {
        bodies.delete(runId);
        return Promise.resolve(body);
      }
      return new Promise((resolve) => {
        waiters.set(runId, [...(waiters.get(runId) ?? []), resolve]);
      });
    },
  };
}

function createSignal() {
  let resolve;
  const promise = new Promise((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
}

function bodyWithoutAccepted({ rootMessageId, runId, requestContextId, sequenceOffset, answer }) {
  return toSse([
    runEnvelope({
      sequence: sequenceOffset + 1,
      eventType: 'LLM_THINKING_DELTA',
      rootMessageId,
      runId,
      requestContextId,
      payload: {
        delta: 'checking the network path',
        contentType: 'PLAIN_TEXT',
      },
    }),
    runEnvelope({
      sequence: sequenceOffset + 2,
      eventType: 'CAPABILITY_RESULT_DELTA',
      rootMessageId,
      runId,
      requestContextId,
      payload: {
        toolCallId: `${runId}-tool`,
        delta: 'diagnostic detail',
        contentType: 'PLAIN_TEXT',
      },
    }),
    runEnvelope({
      sequence: sequenceOffset + 3,
      eventType: 'LLM_CONTENT_DELTA',
      rootMessageId,
      runId,
      requestContextId,
      payload: {
        role: 'ASSISTANT',
        content: `${answer} partial`,
        contentType: 'MARKDOWN',
        metadata: { accumulated: true },
      },
    }),
    runEnvelope({
      sequence: sequenceOffset + 4,
      eventType: 'REQUEST_COMPLETED',
      rootMessageId,
      runId,
      requestContextId,
      payload: {
        status: 'COMPLETED',
        content: `${answer} final`,
        text: `${answer} final`,
        contentType: 'MARKDOWN',
        metadata: { accumulated: true },
      },
    }),
  ]);
}

async function fulfillCommonRequest(route, counters, conversationPage) {
  const request = route.request();
  const url = new URL(request.url());
  if (url.pathname === '/api/v1/runtime/bootstrap') {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ transportKind: 'SSE' }),
    });
    return true;
  }
  if (url.pathname === '/api/v1/skills') {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ total: 0, pageNum: 1, pageSize: 50, skills: [] }),
    });
    return true;
  }
  if (url.pathname === '/api/v1/frequent-questions') {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ locale: 'zh-CN', questions: [] }),
    });
    return true;
  }
  if (url.pathname === '/api/v1/sessions' && request.method() === 'GET') {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        entries: [
          {
            sessionId,
            displayTitle: 'Live run recovery',
            lastActivityAt: '2026-07-24T08:00:00.000Z',
          },
        ],
        offset: 0,
        limit: 50,
        hasMore: false,
      }),
    });
    return true;
  }
  if (url.pathname === `/api/v1/sessions/${sessionId}/conversation/preview`) {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ sessionId, totalMarkers: 0, offset: 0, limit: 100, markers: [] }),
    });
    return true;
  }
  if (url.pathname === `/api/v1/sessions/${sessionId}/conversation`) {
    counters.conversationRequests += 1;
    const page = await conversationPage(counters.conversationRequests);
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(page),
    });
    return true;
  }
  if (url.pathname === `/api/v1/sessions/${sessionId}/background-tasks`) {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ tasks: [] }),
    });
    return true;
  }
  if (/\/api\/v1\/sessions\/[^/]+\/runs\/[^/]+\/events$/.test(url.pathname)) {
    counters.processHistoryRequests += 1;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ availability: 'AVAILABLE', events: [] }),
    });
    return true;
  }
  return false;
}

test('keeps live-tail content and terminal that arrive before the submit response', async ({ page }) => {
  const counters = {
    conversationRequests: 0,
    processHistoryRequests: 0,
    liveTailRequests: 0,
    boundedRunRequests: 0,
  };
  const postStarted = createSignal();
  const liveTailDelivered = createSignal();
  const releaseHttpResponse = createSignal();
  const rootMessageId = 'request-before-http';
  const runId = 'run-before-http';
  const requestContextId = 'context-before-http';

  await page.route('**/api/v1/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());

    if (url.pathname === `/api/v1/sessions/${sessionId}/stream`) {
      const requestedRunId = url.searchParams.get('runId');
      if (requestedRunId) {
        counters.boundedRunRequests += 1;
        await route.fulfill({ status: 200, contentType: 'text/event-stream', body: '' });
        return;
      }
      counters.liveTailRequests += 1;
      await postStarted.promise;
      await route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        body: bodyWithoutAccepted({
          rootMessageId,
          runId,
          requestContextId,
          sequenceOffset: 20,
          answer: 'pre-http answer',
        }),
      });
      liveTailDelivered.resolve();
      return;
    }

    if (
      await fulfillCommonRequest(route, counters, async () => ({
        sessionId,
        items: [],
        nextCursor: null,
        newerCursor: null,
        activeRun: null,
      }))
    ) {
      return;
    }

    if (url.pathname === `/api/v1/sessions/${sessionId}/requests` && request.method() === 'POST') {
      postStarted.resolve();
      await releaseHttpResponse.promise;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          sessionId,
          requestId: rootMessageId,
          runId,
          attempt: 1,
        }),
      });
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ tasks: [] }),
    });
  });

  await page.goto(`/#/session/${sessionId}`);
  await expect(page.getByTestId('message-textarea')).toBeVisible();
  await page.getByTestId('message-textarea').fill('diagnose before HTTP');
  await page.getByTestId('btn-send').click();

  await liveTailDelivered.promise;
  await page.waitForTimeout(100);
  releaseHttpResponse.resolve();

  const turn = page.getByTestId('turn-block').filter({ hasText: 'diagnose before HTTP' });
  await expect(turn).toHaveCount(1);
  await expect(turn).toContainText('pre-http answer partial');
  await expect(turn.getByTestId('turn-process-summary-text')).toContainText('Completed');
  await expect(turn).not.toContainText('执行中');
  expect(counters.liveTailRequests).toBe(1);
  expect(counters.boundedRunRequests).toBe(0);
  expect(counters.processHistoryRequests).toBe(0);
});

test('keeps submit, retry, and edit in one turn when the first run event is not REQUEST_ACCEPTED', async ({ page }) => {
  const runBodies = createRunBodyBroker();
  const counters = {
    conversationRequests: 0,
    processHistoryRequests: 0,
    liveTailRequests: 0,
    boundedRunRequests: 0,
  };
  let requestSequence = 0;

  await page.route('**/api/v1/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());

    if (url.pathname === `/api/v1/sessions/${sessionId}/stream`) {
      const runId = url.searchParams.get('runId');
      if (!runId) {
        counters.liveTailRequests += 1;
        await new Promise((resolve) => setTimeout(resolve, 5_000));
        await route.fulfill({ status: 200, contentType: 'text/event-stream', body: '' });
        return;
      }
      counters.boundedRunRequests += 1;
      await route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        body: await runBodies.take(runId),
      });
      return;
    }

    if (
      await fulfillCommonRequest(route, counters, async () => ({
        sessionId,
        items: [],
        nextCursor: null,
        newerCursor: null,
        activeRun: null,
      }))
    ) {
      return;
    }

    const responseFor = async ({ rootMessageId, runId, requestContextId, attempt, answer }) => {
      requestSequence += 10;
      runBodies.push(
        runId,
        bodyWithoutAccepted({
          rootMessageId,
          runId,
          requestContextId,
          sequenceOffset: requestSequence,
          answer,
        }),
      );
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ sessionId, requestId: rootMessageId, runId, attempt }),
      });
    };

    if (url.pathname === `/api/v1/sessions/${sessionId}/requests` && request.method() === 'POST') {
      await responseFor({
        rootMessageId: 'request-submit',
        runId: 'run-submit',
        requestContextId: 'context-submit',
        attempt: 1,
        answer: 'submit answer',
      });
      return;
    }
    if (url.pathname === `/api/v1/sessions/${sessionId}/retry` && request.method() === 'POST') {
      await responseFor({
        rootMessageId: 'request-submit',
        runId: 'run-retry',
        requestContextId: 'context-retry',
        attempt: 2,
        answer: 'retry answer',
      });
      return;
    }
    if (url.pathname === `/api/v1/sessions/${sessionId}/requests/latest/edit` && request.method() === 'POST') {
      await responseFor({
        rootMessageId: 'request-edit',
        runId: 'run-edit',
        requestContextId: 'context-edit',
        attempt: 1,
        answer: 'edit answer',
      });
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ tasks: [] }),
    });
  });

  await page.goto(`/#/session/${sessionId}`);
  await expect(page.getByTestId('message-textarea')).toBeVisible();

  await page.getByTestId('message-textarea').fill('diagnose submit');
  await page.getByTestId('btn-send').click();
  const submitTurn = page.getByTestId('turn-block').filter({ hasText: 'diagnose submit' });
  await expect(submitTurn).toHaveCount(1);
  await expect(submitTurn).toContainText('submit answer partial');
  await expect(submitTurn.getByTestId('turn-process-summary-text')).toContainText('Completed');

  await submitTurn.getByTestId('ai-bubble').hover();
  await submitTurn.getByTestId('btn-retry-ai').click();
  await expect(submitTurn).toContainText('retry answer partial');
  await expect(submitTurn).not.toContainText('submit answer partial');
  await expect(submitTurn.getByTestId('turn-process-summary-text')).toContainText('Completed');

  await submitTurn.getByTestId('user-content-region').hover();
  await submitTurn.getByTestId('btn-edit-user').click();
  await page.getByTestId('message-textarea').fill('diagnose edited');
  await page.getByTestId('btn-confirm-edit').click();
  const editedTurn = page.getByTestId('turn-block').filter({ hasText: 'diagnose edited' });
  await expect(editedTurn).toHaveCount(1);
  await expect(editedTurn).toContainText('edit answer partial');
  await expect(editedTurn).not.toContainText('retry answer partial');
  await expect(editedTurn.getByTestId('turn-process-summary-text')).toContainText('Completed');
  await expect(page.getByTestId('turn-block')).toHaveCount(1);

  const conversationCountAfterTerminal = counters.conversationRequests;
  await page.waitForTimeout(750);
  expect(counters.conversationRequests).toBe(conversationCountAfterTerminal);
  expect(counters.processHistoryRequests).toBe(0);
  expect(counters.boundedRunRequests).toBeGreaterThanOrEqual(3);
});

test('retries a refreshed historical turn without retaining the old answer', async ({ page }) => {
  const counters = {
    conversationRequests: 0,
    processHistoryRequests: 0,
    liveTailRequests: 0,
    boundedRunRequests: 0,
  };

  await page.route('**/api/v1/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());

    if (url.pathname === `/api/v1/sessions/${sessionId}/stream`) {
      const runId = url.searchParams.get('runId');
      if (runId === 'run-history-retry') {
        counters.boundedRunRequests += 1;
        await route.fulfill({
          status: 200,
          contentType: 'text/event-stream',
          body: bodyWithoutAccepted({
            rootMessageId: 'request-history',
            runId,
            requestContextId: 'context-history-retry',
            sequenceOffset: 20,
            answer: 'refreshed retry answer',
          }),
        });
        return;
      }

      counters.liveTailRequests += 1;
      await new Promise((resolve) => setTimeout(resolve, 5_000));
      await route.fulfill({ status: 200, contentType: 'text/event-stream', body: '' });
      return;
    }

    if (
      await fulfillCommonRequest(route, counters, async () => ({
        sessionId,
        items: [userMessage('request-history', 'retry after refresh'), assistantMessage('request-history', 'historical answer')],
        nextCursor: null,
        newerCursor: null,
        activeRun: null,
      }))
    ) {
      return;
    }

    if (url.pathname === `/api/v1/sessions/${sessionId}/retry` && request.method() === 'POST') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          sessionId,
          requestId: 'request-history',
          runId: 'run-history-retry',
          attempt: 2,
        }),
      });
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ tasks: [] }),
    });
  });

  await page.goto(`/#/session/${sessionId}`);
  let historicalTurn = page.getByTestId('turn-block').filter({ hasText: 'retry after refresh' });
  await expect(historicalTurn).toContainText('historical answer');

  await page.reload();
  historicalTurn = page.getByTestId('turn-block').filter({ hasText: 'retry after refresh' });
  await expect(historicalTurn).toContainText('historical answer');

  await historicalTurn.getByTestId('ai-bubble').hover();
  await historicalTurn.getByTestId('btn-retry-ai').click();

  await expect(historicalTurn).toContainText('refreshed retry answer partial');
  await expect(historicalTurn).not.toContainText('historical answer');
  await expect(historicalTurn.getByTestId('turn-process-summary-text')).toContainText('Completed');
  await expect(historicalTurn).toHaveCount(1);
  expect(counters.processHistoryRequests).toBe(0);
  expect(counters.boundedRunRequests).toBe(1);
});

test('replays the exact active run after an unrelated event advanced the session cursor', async ({ page }) => {
  const counters = {
    conversationRequests: 0,
    processHistoryRequests: 0,
    liveTailRequests: 0,
    boundedRunRequests: 0,
  };
  const boundedQueries = [];
  let showSettledSnapshot = false;

  await page.route('**/api/v1/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());

    if (url.pathname === `/api/v1/sessions/${sessionId}/stream`) {
      const runId = url.searchParams.get('runId');
      if (runId === 'run-target') {
        counters.boundedRunRequests += 1;
        boundedQueries.push({
          requestId: url.searchParams.get('requestId'),
          runId,
          lastSeenSequence: url.searchParams.get('lastSeenSequence'),
        });
        await route.fulfill({
          status: 200,
          contentType: 'text/event-stream',
          body: bodyWithoutAccepted({
            rootMessageId: 'request-target',
            runId: 'run-target',
            requestContextId: 'context-target',
            sequenceOffset: 100,
            answer: 'recovered active answer',
          }),
        });
        return;
      }

      counters.liveTailRequests += 1;
      const body =
        counters.liveTailRequests === 1
          ? toSse([
              runEnvelope({
                sequence: 90,
                eventType: 'LLM_CONTENT_DELTA',
                rootMessageId: 'request-unrelated',
                runId: 'run-unrelated',
                requestContextId: 'context-unrelated',
                payload: {
                  role: 'ASSISTANT',
                  content: 'unrelated content',
                  contentType: 'MARKDOWN',
                  metadata: { accumulated: true },
                },
              }),
            ])
          : '';
      if (counters.liveTailRequests > 1) {
        await new Promise((resolve) => setTimeout(resolve, 5_000));
      }
      await route.fulfill({ status: 200, contentType: 'text/event-stream', body });
      return;
    }

    if (
      await fulfillCommonRequest(route, counters, async (conversationRequestNumber) => {
        if (showSettledSnapshot) {
          return {
            sessionId,
            items: [userMessage('request-target', 'recover active request'), assistantMessage('request-target', 'recovered active answer final')],
            nextCursor: null,
            newerCursor: null,
            activeRun: null,
          };
        }
        if (conversationRequestNumber > 1) {
          await new Promise((resolve) => setTimeout(resolve, 150));
        }
        return {
          sessionId,
          items: [userMessage('request-target', 'recover active request')],
          nextCursor: null,
          newerCursor: null,
          activeRun: conversationRequestNumber > 1 ? { requestId: 'request-target', runId: 'run-target', status: 'RUNNING' } : null,
        };
      })
    ) {
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ tasks: [] }),
    });
  });

  await page.goto(`/#/session/${sessionId}`);
  const targetTurn = page.getByTestId('turn-block').filter({ hasText: 'recover active request' });
  await expect(targetTurn).toContainText('recovered active answer partial');
  await expect(targetTurn.getByTestId('turn-process-summary-text')).toContainText('Completed');
  await expect(targetTurn).toHaveCount(1);
  expect(boundedQueries).toContainEqual({
    requestId: 'request-target',
    runId: 'run-target',
    lastSeenSequence: '0',
  });
  expect(counters.processHistoryRequests).toBe(0);

  showSettledSnapshot = true;
  await page.reload();
  const refreshedTurn = page.getByTestId('turn-block').filter({ hasText: 'recover active request' });
  await expect(refreshedTurn).toHaveCount(1);
  await expect(refreshedTurn).toContainText('recovered active answer final');
  await expect(refreshedTurn.getByTestId('turn-process-summary-text')).toContainText('Completed');
  expect(counters.processHistoryRequests).toBe(0);
});
