const { expect, test } = require('@playwright/test');

const sessionId = 'session-edit-retry';

function historyMessage(messageId, role, sequence, content) {
  return {
    messageId,
    sessionId,
    requestId: 'root-original',
    runId: role === 'USER' ? null : 'run-original',
    requestContextId: 'root-original',
    rootMessageId: 'root-original',
    role,
    sequence,
    content,
    contentType: role === 'ASSISTANT' ? 'MARKDOWN' : 'PLAIN_TEXT',
    metadata: role === 'ASSISTANT' ? { eventType: 'REQUEST_COMPLETED', status: 'COMPLETED' } : {},
    createdAt: `2026-07-22T08:10:0${sequence}.000Z`,
    visible: true,
  };
}

function scopedHistoryMessage(targetSessionId, messageId, requestId, runId, role, sequence, content, forkInherited = false) {
  return {
    messageId,
    sessionId: targetSessionId,
    requestId,
    runId,
    requestContextId: `${requestId}-context`,
    role,
    sequence,
    content,
    contentType: role === 'ASSISTANT' ? 'MARKDOWN' : 'PLAIN_TEXT',
    metadata: {
      ...(role === 'ASSISTANT' ? { eventType: 'REQUEST_COMPLETED', status: 'COMPLETED' } : {}),
      ...(forkInherited ? { forkInherited: true } : {}),
    },
    createdAt: `2026-07-30T08:10:${String(sequence).padStart(2, '0')}.000Z`,
    visible: true,
  };
}

function lifecycle(sequence, eventType, rootMessageId, runId, payload) {
  const requestContextId = runId.replace(/^run-/, 'context-');
  return {
    eventId: `${runId}-${sequence}`,
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

function scopedLifecycle(targetSessionId, sequence, eventType, rootMessageId, runId, payload) {
  return {
    ...lifecycle(sequence, eventType, rootMessageId, runId, payload),
    sessionId: targetSessionId,
  };
}

function toSse(envelopes) {
  return envelopes.map((envelope) => `data: ${JSON.stringify(envelope)}\n\n`).join('');
}

function createBodyQueue() {
  const bodies = new Map();
  const waiters = new Map();
  return {
    push(runId, body) {
      const waiter = waiters.get(runId)?.shift();
      if (waiter) waiter(body);
      else bodies.set(runId, [...(bodies.get(runId) ?? []), body]);
    },
    take(runId) {
      const queued = bodies.get(runId) ?? [];
      const body = queued.shift();
      bodies.set(runId, queued);
      if (body !== undefined) return Promise.resolve(body);
      return new Promise((resolve) => waiters.set(runId, [...(waiters.get(runId) ?? []), resolve]));
    },
  };
}

test('keeps only the latest edit/retry attempt and rolls back a failed edit', async ({ page }) => {
  const streamBodies = createBodyQueue();
  let editCalls = 0;
  let retryCalls = 0;
  let liveTailConnections = 0;

  await page.route('**/api/v1/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname === `/api/v1/sessions/${sessionId}/stream`) {
      const streamKey = url.searchParams.get('runId') ?? 'live-tail';
      if (streamKey === 'live-tail') {
        liveTailConnections += 1;
      }
      await route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        body: await streamBodies.take(streamKey),
      });
      return;
    }
    if (url.pathname === '/api/v1/sessions' && request.method() === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          entries: [{ sessionId, displayTitle: 'Edit retry session', lastActivityAt: '2026-07-22T09:10:00.000Z' }],
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
            historyMessage('original-user', 'USER', 1, 'original question'),
            historyMessage('original-assistant', 'ASSISTANT', 2, 'original answer'),
          ],
          nextCursor: null,
          newerCursor: null,
          activeRun: null,
        }),
      });
      return;
    }
    if (url.pathname === `/api/v1/sessions/${sessionId}/requests/latest/edit` && request.method() === 'POST') {
      editCalls += 1;
      if (editCalls === 2) {
        await route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: JSON.stringify({ error: { code: 'EDIT_FAILED', message: 'simulated edit failure' } }),
        });
        return;
      }
      streamBodies.push(
        'live-tail',
        toSse([
          lifecycle(1, 'REQUEST_ACCEPTED', 'root-edited', 'run-edit', {
            attempt: 1,
            agentId: 'default-agent',
            agentVersion: 'v1',
            status: 'QUEUED',
            metadata: { accumulated: true },
          }),
          lifecycle(2, 'LLM_CONTENT_DELTA', 'root-edited', 'run-edit', {
            role: 'ASSISTANT',
            content: 'edited answer',
            contentType: 'MARKDOWN',
            metadata: { accumulated: true },
          }),
          lifecycle(3, 'REQUEST_COMPLETED', 'root-edited', 'run-edit', { status: 'COMPLETED' }),
        ]),
      );
      await page.getByText('edited answer', { exact: true }).waitFor({ state: 'visible', timeout: 5_000 });
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ sessionId, requestId: 'root-edited', runId: 'run-edit', attempt: 1 }),
      });
      return;
    }
    if (url.pathname === `/api/v1/sessions/${sessionId}/retry` && request.method() === 'POST') {
      retryCalls += 1;
      await expect(page.getByText(retryCalls === 1 ? 'edited answer' : 'retried answer', { exact: true })).toHaveCount(0);
      if (retryCalls === 2) {
        await route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: JSON.stringify({ error: { code: 'RETRY_FAILED', message: 'simulated retry failure' } }),
        });
        return;
      }
      streamBodies.push(
        'live-tail',
        toSse([
          lifecycle(4, 'REQUEST_ACCEPTED', 'root-edited', 'run-retry', {
            attempt: 2,
            agentId: 'default-agent',
            agentVersion: 'v1',
            status: 'QUEUED',
            metadata: { accumulated: true },
          }),
        ]),
      );
      await expect(page.getByText('edited answer', { exact: true })).toHaveCount(0);
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ sessionId, requestId: 'root-edited', runId: 'run-retry', attempt: 2 }),
      });
      streamBodies.push(
        'live-tail',
        toSse([
          lifecycle(5, 'LLM_CONTENT_DELTA', 'root-edited', 'run-retry', {
            role: 'ASSISTANT',
            content: 'retried answer',
            contentType: 'MARKDOWN',
            metadata: { accumulated: true },
          }),
          lifecycle(6, 'REQUEST_COMPLETED', 'root-edited', 'run-retry', { status: 'COMPLETED' }),
        ]),
      );
      return;
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ tasks: [] }) });
  });

  await page.goto(`/#/session/${sessionId}`);
  await expect(page.getByText('original question', { exact: true })).toBeVisible();
  await expect.poll(() => liveTailConnections).toBeGreaterThanOrEqual(1);

  await page.getByTestId('user-content-region').hover();
  await page.getByTestId('btn-edit-user').click();
  await page.getByTestId('message-textarea').fill('edited question');
  await page.getByTestId('btn-confirm-edit').click();
  await expect(page.getByText('edited answer', { exact: true })).toBeVisible();
  await expect(page.getByText('original question', { exact: true })).toHaveCount(0);
  await expect.poll(() => liveTailConnections).toBeGreaterThanOrEqual(2);

  await page.getByTestId('ai-bubble').hover();
  await page.getByTestId('btn-retry-ai').click();
  await expect(page.getByText('retried answer', { exact: true })).toBeVisible();
  await expect(page.getByText('edited answer', { exact: true })).toHaveCount(0);
  await expect(page.getByTestId('turn-block').filter({ hasText: 'edited question' })).toHaveCount(1);

  await page.getByTestId('ai-bubble').hover();
  await page.getByTestId('btn-retry-ai').click();
  await expect(page.getByText('simulated retry failure', { exact: false })).toBeVisible();
  await expect(page.getByText('retried answer', { exact: true })).toBeVisible();

  const viewport = page.getByTestId('right-pane-scroll-viewport');
  const scrollTopBeforeFailure = await viewport.evaluate((node) => node.scrollTop);
  await page.getByTestId('user-content-region').hover();
  await page.getByTestId('btn-edit-user').click();
  await page.getByTestId('message-textarea').fill('failed edit draft');
  await page.getByTestId('btn-confirm-edit').click();
  await expect(page.getByText('simulated edit failure', { exact: false })).toBeVisible();
  await page.getByTestId('btn-cancel-edit').click();

  await expect(page.getByText('edited question', { exact: true })).toBeVisible();
  await expect(page.getByText('retried answer', { exact: true })).toBeVisible();
  await expect(page.getByText('failed edit draft', { exact: true })).toHaveCount(0);
  await expect.poll(() => viewport.evaluate((node) => node.scrollTop)).toBe(scrollTopBeforeFailure);
});

test('keeps fork retry edit recursive fork reload and share composable', async ({ page }) => {
  const sourceSessionId = 'session-composite-source';
  const childSessionId = 'session-composite-child';
  const grandchildSessionId = 'session-composite-grandchild';
  const streamBodies = createBodyQueue();
  const liveTailConnections = new Map();
  const conversations = new Map([
    [
      sourceSessionId,
      [
        scopedHistoryMessage(sourceSessionId, 'source-user', 'source-root', 'source-run', 'USER', 1, 'SOURCE QUESTION'),
        scopedHistoryMessage(sourceSessionId, 'source-assistant', 'source-root', 'source-run', 'ASSISTANT', 2, 'SOURCE ANSWER'),
      ],
    ],
    [
      childSessionId,
      [
        scopedHistoryMessage(childSessionId, 'child-user', 'child-root', 'child-anchor-run', 'USER', 1, 'SOURCE QUESTION', true),
        scopedHistoryMessage(childSessionId, 'child-assistant', 'child-root', 'child-anchor-run', 'ASSISTANT', 2, 'SOURCE ANSWER', true),
      ],
    ],
  ]);

  await page.route('**/api/v1/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const streamMatch = url.pathname.match(/^\/api\/v1\/sessions\/([^/]+)\/stream$/);
    if (streamMatch) {
      const targetSessionId = streamMatch[1];
      const streamKey = url.searchParams.get('runId') ?? `${targetSessionId}:live-tail`;
      if (!url.searchParams.has('runId')) {
        liveTailConnections.set(targetSessionId, (liveTailConnections.get(targetSessionId) ?? 0) + 1);
      }
      await route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        body: await streamBodies.take(streamKey),
      });
      return;
    }
    if (url.pathname === '/api/v1/sessions' && request.method() === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          entries: [...conversations.keys()].map((entrySessionId) => ({
            sessionId: entrySessionId,
            displayTitle: entrySessionId,
            lastActivityAt: '2026-07-30T08:10:00.000Z',
          })),
          offset: 0,
          limit: 50,
          hasMore: false,
        }),
      });
      return;
    }
    const previewMatch = url.pathname.match(/^\/api\/v1\/sessions\/([^/]+)\/conversation\/preview$/);
    if (previewMatch) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ sessionId: previewMatch[1], totalMarkers: 1, offset: 0, limit: 100, markers: [] }),
      });
      return;
    }
    const conversationMatch = url.pathname.match(/^\/api\/v1\/sessions\/([^/]+)\/conversation$/);
    if (conversationMatch) {
      const targetSessionId = conversationMatch[1];
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          sessionId: targetSessionId,
          items: conversations.get(targetSessionId) ?? [],
          nextCursor: null,
          newerCursor: null,
          activeRun: null,
        }),
      });
      return;
    }
    if (url.pathname === `/api/v1/sessions/${sourceSessionId}/messages/source-assistant/fork`) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          sessionId: childSessionId,
          displayTitle: 'Composite child',
          lastActivityAt: '2026-07-30T08:10:03.000Z',
        }),
      });
      return;
    }
    if (url.pathname === `/api/v1/sessions/${childSessionId}/runs/child-anchor-run/events`) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          availability: 'AVAILABLE',
          events: [
            scopedLifecycle(childSessionId, 1, 'LLM_THINKING_DELTA', 'child-root', 'child-anchor-run', {
              text: 'CHILD SOURCE THINKING',
              metadata: { accumulated: true, completed: true },
            }),
          ],
        }),
      });
      return;
    }
    if (url.pathname === `/api/v1/sessions/${childSessionId}/requests` && request.method() === 'POST') {
      conversations.set(childSessionId, [
        scopedHistoryMessage(childSessionId, 'child-user', 'child-root', 'child-retry-run', 'USER', 1, 'CHILD EDITED QUESTION'),
        scopedHistoryMessage(childSessionId, 'child-retry-assistant', 'child-root', 'child-retry-run', 'ASSISTANT', 3, 'CHILD EDIT ANSWER'),
      ]);
      streamBodies.push(
        `${childSessionId}:live-tail`,
        toSse([
          scopedLifecycle(childSessionId, 1, 'REQUEST_ACCEPTED', 'child-root', 'child-retry-run', {
            attempt: 1,
            agentId: 'default-agent',
            agentVersion: 'v1',
            status: 'QUEUED',
            metadata: { accumulated: true },
          }),
          scopedLifecycle(childSessionId, 2, 'LLM_THINKING_DELTA', 'child-root', 'child-retry-run', {
            text: 'CHILD EDIT THINKING',
            metadata: { accumulated: true },
          }),
        ]),
      );
      await expect(page.getByText('CHILD EDIT THINKING', { exact: true })).toBeVisible();
      await expect(page.getByTestId('turn-process-toggle')).toHaveAttribute('aria-expanded', 'true');
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ sessionId: childSessionId, requestId: 'child-root', runId: 'child-retry-run', attempt: 1 }),
      });
      streamBodies.push(
        `${childSessionId}:live-tail`,
        toSse([
          scopedLifecycle(childSessionId, 3, 'LLM_CONTENT_DELTA', 'child-root', 'child-retry-run', {
            role: 'ASSISTANT',
            content: 'CHILD EDIT ANSWER',
            contentType: 'MARKDOWN',
            metadata: { accumulated: true },
          }),
          scopedLifecycle(childSessionId, 4, 'REQUEST_COMPLETED', 'child-root', 'child-retry-run', { status: 'COMPLETED' }),
        ]),
      );
      return;
    }
    if (url.pathname === `/api/v1/sessions/${childSessionId}/requests/latest/edit`) {
      conversations.set(childSessionId, [
        scopedHistoryMessage(childSessionId, 'child-edit-user', 'child-edit-root', 'child-edit-run', 'USER', 3, 'CHILD EDITED QUESTION'),
        scopedHistoryMessage(childSessionId, 'child-edit-assistant', 'child-edit-root', 'child-edit-run', 'ASSISTANT', 4, 'CHILD EDIT ANSWER'),
      ]);
      const envelopes = [
        scopedLifecycle(childSessionId, 4, 'REQUEST_ACCEPTED', 'child-edit-root', 'child-edit-run', {
          attempt: 1,
          agentId: 'default-agent',
          agentVersion: 'v1',
          status: 'QUEUED',
          metadata: { accumulated: true },
        }),
        scopedLifecycle(childSessionId, 5, 'LLM_CONTENT_DELTA', 'child-edit-root', 'child-edit-run', {
          role: 'ASSISTANT',
          content: 'CHILD EDIT ANSWER',
          contentType: 'MARKDOWN',
          metadata: { accumulated: true },
        }),
        scopedLifecycle(childSessionId, 6, 'REQUEST_COMPLETED', 'child-edit-root', 'child-edit-run', { status: 'COMPLETED' }),
      ];
      streamBodies.push(`${childSessionId}:live-tail`, toSse(envelopes));
      await page.getByText('CHILD EDIT ANSWER', { exact: true }).waitFor({ state: 'visible', timeout: 5_000 });
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ sessionId: childSessionId, requestId: 'child-edit-root', runId: 'child-edit-run', attempt: 1 }),
      });
      return;
    }
    if (url.pathname === `/api/v1/sessions/${childSessionId}/messages/child-retry-assistant/fork`) {
      conversations.set(grandchildSessionId, [
        scopedHistoryMessage(grandchildSessionId, 'grandchild-user', 'grandchild-root', 'grandchild-anchor-run', 'USER', 1, 'CHILD EDITED QUESTION'),
        scopedHistoryMessage(
          grandchildSessionId,
          'grandchild-assistant',
          'grandchild-root',
          'grandchild-anchor-run',
          'ASSISTANT',
          2,
          'CHILD EDIT ANSWER',
          true,
        ),
      ]);
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          sessionId: grandchildSessionId,
          displayTitle: 'Composite grandchild',
          lastActivityAt: '2026-07-30T08:10:07.000Z',
        }),
      });
      return;
    }
    if (url.pathname === `/api/v1/sessions/${grandchildSessionId}/requests` && request.method() === 'POST') {
      conversations.set(grandchildSessionId, [
        scopedHistoryMessage(grandchildSessionId, 'grandchild-user', 'grandchild-root', 'grandchild-retry-run', 'USER', 1, 'CHILD EDITED QUESTION'),
        scopedHistoryMessage(
          grandchildSessionId,
          'grandchild-retry-assistant',
          'grandchild-root',
          'grandchild-retry-run',
          'ASSISTANT',
          3,
          'CHILD EDIT ANSWER',
        ),
      ]);
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ sessionId: grandchildSessionId, requestId: 'grandchild-root', runId: 'grandchild-retry-run', attempt: 1 }),
      });
      return;
    }
    if (url.pathname === `/api/v1/sessions/${grandchildSessionId}/shares` && request.method() === 'POST') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ shareId: 'share-composite', shareUrl: 'http://127.0.0.1:5173/#/shared/share-composite' }),
      });
      return;
    }
    if (url.pathname === '/api/v1/shares/share-composite/conversation') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          sessionId: grandchildSessionId,
          messages: conversations.get(grandchildSessionId),
          createdAt: Date.now(),
        }),
      });
      return;
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ availability: 'AVAILABLE', events: [], tasks: [] }) });
  });

  await page.goto(`/#/session/${sourceSessionId}`);
  const sourceTurn = page.getByTestId('turn-block').filter({ hasText: 'SOURCE ANSWER' });
  await sourceTurn.getByTestId('ai-bubble').hover();
  await sourceTurn.getByTestId('btn-more-actions').click();
  await page.getByTestId('btn-fork-ai').click();
  await expect(page).toHaveURL(new RegExp(`#/session/${childSessionId}$`));
  await expect(page.getByText('SOURCE ANSWER', { exact: true })).toBeVisible();
  await expect.poll(() => liveTailConnections.get(childSessionId) ?? 0).toBeGreaterThanOrEqual(1);
  await expect(page.getByText('CHILD SOURCE THINKING', { exact: true })).toHaveCount(0);
  await expect(page.getByTestId('turn-process-toggle')).toHaveAttribute('aria-expanded', 'false');

  // fork-inherited latest turn has disabled retry/edit buttons with explanatory tooltips
  let activeTurn = page.getByTestId('turn-block').filter({ hasText: 'SOURCE ANSWER' });
  await activeTurn.getByTestId('ai-bubble').hover();
  await expect(activeTurn.getByTestId('btn-retry-ai')).toHaveAttribute('aria-disabled', 'true');

  // Submit a new question to create a non-inherited latest turn
  await page.getByTestId('message-textarea').fill('CHILD EDITED QUESTION');
  await page.getByTestId('btn-send').click();
  await expect(page.getByText('CHILD EDIT ANSWER', { exact: true })).toBeVisible();

  // CHILD EDIT ANSWER is from the new question submit, not from edit-replacement
  await expect(page.getByText('SOURCE ANSWER', { exact: true })).toHaveCount(0);
  await expect(page.getByTestId('user-bubble').getByText('CHILD EDITED QUESTION', { exact: true })).toBeVisible();

  await page.getByText(sourceSessionId, { exact: true }).first().click();
  await expect(page).toHaveURL(new RegExp(`#/session/${sourceSessionId}$`));
  await page.getByText(childSessionId, { exact: true }).first().click();
  await expect(page).toHaveURL(new RegExp(`#/session/${childSessionId}$`));
  await expect(page.getByText('SOURCE ANSWER', { exact: true })).toHaveCount(0);
  await expect(page.getByText('SOURCE QUESTION', { exact: true })).toHaveCount(0);
  await expect(page.getByText('CHILD EDIT ANSWER', { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByText('CHILD EDIT ANSWER', { exact: true })).toBeVisible();

  activeTurn = page.getByTestId('turn-block').filter({ hasText: 'CHILD EDIT ANSWER' });
  await activeTurn.getByTestId('ai-bubble').hover();
  await activeTurn.getByTestId('btn-more-actions').click();
  await page.getByTestId('btn-fork-ai').click();
  await expect(page).toHaveURL(new RegExp(`#/session/${grandchildSessionId}$`));
  await expect(page.getByText('CHILD EDIT ANSWER', { exact: true })).toBeVisible();
  await expect.poll(() => liveTailConnections.get(grandchildSessionId) ?? 0).toBeGreaterThanOrEqual(1);

  // grandchild fork-inherited latest turn also has disabled retry
  activeTurn = page.getByTestId('turn-block').filter({ hasText: 'CHILD EDIT ANSWER' });
  await activeTurn.getByTestId('ai-bubble').hover();
  await expect(activeTurn.getByTestId('btn-retry-ai')).toHaveAttribute('aria-disabled', 'true');

  activeTurn = page.getByTestId('turn-block').filter({ hasText: 'CHILD EDIT ANSWER' });
  await activeTurn.getByTestId('ai-bubble').hover();
  await activeTurn.getByTestId('btn-more-actions').click();
  await page.getByTestId('btn-share').click();
  await page.getByTestId('share-confirm-btn').click();
  await page.getByTestId('share-generate-btn').click();
  await expect(page.getByTestId('share-url-display').locator('input')).toHaveValue(/share-composite$/);
  await page.goto('/#/shared/share-composite');
  await expect(page.getByText('CHILD EDIT ANSWER', { exact: true })).toBeVisible();
});
