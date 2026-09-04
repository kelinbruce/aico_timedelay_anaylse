const { expect, test } = require('@playwright/test');

const sessions = [
  session('session-running', 'Running diagnosis with a deliberately long session title'),
  session('session-waiting', 'Waiting authorization'),
  session('session-result', 'Completed diagnosis'),
  session('session-failure', 'Failed diagnosis'),
];

const initialActivities = [
  { sessionId: 'session-running', status: 'RUNNING' },
  {
    sessionId: 'session-waiting',
    status: 'WAITING_FOR_INPUT',
    pendingInputKind: 'AUTHORIZATION',
  },
  {
    sessionId: 'session-result',
    status: 'UNREAD_RESULT',
    activityId: 'activity-result',
  },
  {
    sessionId: 'session-failure',
    status: 'UNREAD_FAILURE',
    activityId: 'activity-failure',
  },
];

test('projects cross-session activity through the real sidebar and consumes a visible terminal result', async ({ page }) => {
  const state = createBackendState();
  await installApiFixture(page, state);

  await page.goto('/');

  const runningRow = page.getByTestId('sidebar-session-item-session-running');
  const waitingRow = page.getByTestId('sidebar-session-item-session-waiting');
  const resultRow = page.getByTestId('sidebar-session-item-session-result');
  const failureRow = page.getByTestId('sidebar-session-item-session-failure');
  await expect(runningRow.getByTestId('session-activity-running')).toBeVisible();
  await expect(waitingRow.getByTestId('session-activity-waiting')).toHaveAttribute('aria-label', 'Awaiting authorization');
  await expect(resultRow.getByTestId('session-activity-unread-result')).toBeVisible();
  await expect(failureRow.getByTestId('session-activity-unread-failure')).toBeVisible();
  const sidebarRowLayout = await runningRow.evaluate((row) => {
    const title = row.querySelector('[data-testid="session-history-entry-title-session-running"]');
    const slot = row.querySelector('[data-testid="session-activity-trailing-slot-session-running"]');
    const overlay = row.querySelector('[data-testid="session-history-entry-trailing-overlay-session-running"]');
    if (!(title instanceof HTMLElement) || !(slot instanceof HTMLElement)) {
      throw new Error('Sidebar title or trailing slot is missing');
    }
    const rowRect = row.getBoundingClientRect();
    const titleRect = title.getBoundingClientRect();
    const slotRect = slot.getBoundingClientRect();
    const rowStyle = getComputedStyle(row);
    const titleStyle = getComputedStyle(title);
    return {
      overlayPresent: overlay !== null,
      rowWidth: rowRect.width,
      titleWidth: titleRect.width,
      slotWidth: slotRect.width,
      trailingRightGap: rowRect.right - slotRect.right,
      rowGap: rowStyle.columnGap,
      titleOverflow: titleStyle.overflow,
      titleTextOverflow: titleStyle.textOverflow,
      titleWhiteSpace: titleStyle.whiteSpace,
      titleHasEllipsisClass: title.classList.contains('ant-typography-ellipsis'),
    };
  });
  expect(sidebarRowLayout.overlayPresent).toBe(false);
  expect(Math.abs(sidebarRowLayout.titleWidth + sidebarRowLayout.slotWidth + 8 - (sidebarRowLayout.rowWidth - 28))).toBeLessThanOrEqual(1);
  expect(sidebarRowLayout.rowGap).toBe('8px');
  expect(sidebarRowLayout.titleOverflow).toBe('hidden');
  expect(sidebarRowLayout.titleTextOverflow).toBe('clip');
  expect(sidebarRowLayout.titleWhiteSpace).toBe('nowrap');
  expect(sidebarRowLayout.titleHasEllipsisClass).toBe(false);
  expect(sidebarRowLayout.slotWidth).toBeLessThan(140);
  expect(sidebarRowLayout.trailingRightGap).toBeGreaterThanOrEqual(13);
  expect(sidebarRowLayout.trailingRightGap).toBeLessThanOrEqual(15);

  const historySearch = page.getByRole('textbox', { name: 'Search history' });
  await historySearch.fill('Running diagnosis');
  await expect(runningRow.getByTestId('session-activity-running')).toBeVisible();
  await historySearch.clear();
  await expect(waitingRow).toBeVisible();

  await runningRow.click();
  await expect(page).toHaveURL(/#\/session\/session-running$/);
  await expect(runningRow.getByTestId('session-activity-running')).toHaveCount(0);

  await page.getByRole('button', { name: 'Scheduled tasks' }).click();
  await expect(page).toHaveURL(/#\/cron-tasks$/);
  await expect(runningRow.getByTestId('session-activity-running')).toBeVisible();

  await resultRow.click();
  await expect(page).toHaveURL(/#\/session\/session-result$/);
  await expect(page.getByText('Completed terminal answer', { exact: true })).toBeVisible();
  await expect.poll(() => state.consumeBodies.length).toBe(1);
  expect(state.consumeBodies[0]).toEqual({
    activityId: 'activity-result',
    observedRunId: 'run-result',
  });

  await page.getByRole('button', { name: 'Scheduled tasks' }).click();
  await expect(resultRow.getByTestId('session-activity-unread-result')).toHaveCount(0);
  expect(state.activityRequestCount).toBeGreaterThanOrEqual(1);
});

test('clears the consumed terminal activity in a second browser page after its next scope snapshot', async ({ context, page }) => {
  const state = createBackendState();
  const secondPage = await context.newPage();
  await Promise.all([installApiFixture(page, state), installApiFixture(secondPage, state)]);

  await Promise.all([page.goto('/'), secondPage.goto('/')]);
  await expect(page.getByTestId('sidebar-session-item-session-result').getByTestId('session-activity-unread-result')).toBeVisible();
  await expect(secondPage.getByTestId('sidebar-session-item-session-result').getByTestId('session-activity-unread-result')).toBeVisible();

  await page.getByTestId('sidebar-session-item-session-result').click();
  await expect(page.getByText('Completed terminal answer', { exact: true })).toBeVisible();
  await expect.poll(() => state.consumeBodies.length).toBe(1);

  await expect(secondPage.getByTestId('sidebar-session-item-session-result').getByTestId('session-activity-unread-result')).toHaveCount(0);
  await secondPage.close();
});

test('reuses the activity marker in the immersive History card list without consuming on open', async ({ page }) => {
  await installRightLayoutPrel(page);
  const state = createBackendState();
  await installApiFixture(page, state);

  await page.goto('/immersive');
  await expect(page.getByTestId('immersive-shell')).toBeVisible();
  await page.evaluate(async () => {
    const { aicoConfigStore } = await import('/src/aico-config/AICOConfigStore.ts');
    aicoConfigStore.setConfig({ layoutConfig: { operatorPosition: 'RIGHT' } });
  });
  await expect(page.getByTestId('immersive-top-bar')).toBeVisible();
  await page.getByRole('button', { name: 'Recent sessions' }).click();

  const resultCard = page.getByTestId('card-item-session-result');
  await expect(resultCard.getByTestId('session-activity-unread-result')).toBeVisible();
  expect(state.consumeBodies).toEqual([]);

  await resultCard.click();
  await expect(page.getByText('Completed terminal answer', { exact: true })).toBeVisible();
  await expect.poll(() => state.consumeBodies.length).toBe(1);
  expect(state.consumeBodies[0]).toEqual({
    activityId: 'activity-result',
    observedRunId: 'run-result',
  });
});

test('shows the active-session marker when immersive left layout displays scheduled tasks', async ({ page }) => {
  await installImmersivePrel(page, 'LEFT');
  const state = createBackendState();
  await installApiFixture(page, state);

  await page.goto('/immersive#/session/session-running');
  await expect(page.getByTestId('immersive-shell')).toBeVisible();
  const runningRow = page.getByTestId('sidebar-session-item-session-running');
  await expect(runningRow.getByTestId('session-activity-running')).toHaveCount(0);

  await page.getByRole('button', { name: 'Scheduled tasks' }).click();
  await expect(page).toHaveURL(/#\/cron-tasks$/);
  await expect(runningRow.getByTestId('session-activity-running')).toBeVisible();
});

test('replaces waiting input with unread failure and restores the composer after canonical timeout replay', async ({ page }) => {
  const state = createTimeoutJourneyState();
  await installTimeoutJourneyFixture(page, state);

  await page.goto('/');
  const sessionARow = page.getByTestId('sidebar-session-item-session-timeout-a');
  const sessionBRow = page.getByTestId('sidebar-session-item-session-timeout-b');
  await expect(sessionARow.getByTestId('session-activity-waiting')).toBeVisible();

  await sessionARow.click();
  await expect(page).toHaveURL(/#\/session\/session-timeout-a$/);
  await expect(page.getByTestId('respond-input')).toBeVisible();

  await sessionBRow.click();
  await expect(page).toHaveURL(/#\/session\/session-timeout-b$/);
  await expect(page.getByTestId('message-textarea')).toBeVisible();
  await expect.poll(() => state.pendingActivityRoutes.length).toBeGreaterThan(0);

  state.timeoutEmitted = true;
  const pendingActivityRoutes = state.pendingActivityRoutes.splice(0);
  await Promise.all(
    pendingActivityRoutes.map(async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        body: `event: SNAPSHOT\ndata: ${JSON.stringify({
          type: 'SNAPSHOT',
          entries: [
            {
              sessionId: 'session-timeout-a',
              status: 'UNREAD_FAILURE',
              activityId: 'activity-timeout-a',
            },
          ],
        })}\n\n`,
      });
    }),
  );
  await expect(sessionARow.getByTestId('session-activity-unread-failure')).toBeVisible();

  await sessionARow.click();
  await expect(page).toHaveURL(/#\/session\/session-timeout-a$/);
  await expect(page.getByTestId('message-textarea')).toBeVisible();
  await expect(page.getByTestId('respond-input')).toHaveCount(0);
  expect(state.sessionAStreamRequests).toBeGreaterThanOrEqual(2);
});

function createBackendState() {
  return {
    consumedSessionIds: new Set(),
    pendingActivityRoutes: [],
    consumeBodies: [],
    activityRequestCount: 0,
  };
}

function createTimeoutJourneyState() {
  return {
    activityRequestCount: 0,
    pendingActivityRoutes: [],
    sessionAStreamRequests: 0,
    timeoutEmitted: false,
  };
}

async function installRightLayoutPrel(page) {
  await installImmersivePrel(page, 'RIGHT');
}

async function installImmersivePrel(page, operatorPosition) {
  await page.route('**/febs/v1/assets/prelude-loader', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'text/javascript',
      body: `
        (() => {
          const site = {
            session: {},
            user: { id: "e2e-user", name: "E2E User", ops: null, roles: [] },
            locale: "en-us",
            theme: "lightday"
          };
          const piu = {
            id: "e2e-piu",
            name: "AFWebsitePIU",
            version: "1.0.0",
            config: { layoutConfig: { operatorPosition: "${operatorPosition}" } },
            deps: [],
            isBrowser: true,
            revs: { "febs.regs": "e2e", "febs.server": "e2e" },
            attach: () => undefined,
            emit: () => undefined
          };
          window.Prel = {
            ready: (callback) => callback(),
            autoLoad: () => Promise.resolve(),
            start: (_name, _version, _deps, callback) => callback(piu, site)
          };
        })();
      `,
    });
  });
}

async function installApiFixture(page, state) {
  let activityResponses = 0;
  await page.route('**/api/v1/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());

    if (url.pathname === '/api/v1/runtime/bootstrap') {
      await json(route, { transportKind: 'SSE' });
      return;
    }
    if (url.pathname === '/api/v1/skills') {
      await json(route, { total: 0, pageNum: 1, pageSize: 50, skills: [] });
      return;
    }
    if (url.pathname === '/api/v1/frequent-questions') {
      await json(route, { locale: 'zh-CN', questions: [] });
      return;
    }
    if (url.pathname === '/api/v1/session-activities/stream') {
      state.activityRequestCount += 1;
      activityResponses += 1;
      if (activityResponses > 1 && state.consumedSessionIds.size === 0) {
        await new Promise((resolve) => {
          state.pendingActivityRoutes.push({ route, resolve });
        });
        return;
      }
      await fulfillActivitySnapshot(route, state);
      return;
    }
    const consumeMatch = /^\/api\/v1\/sessions\/([^/]+)\/activity\/consume$/.exec(url.pathname);
    if (consumeMatch && request.method() === 'POST') {
      const sessionId = decodeURIComponent(consumeMatch[1]);
      state.consumeBodies.push(request.postDataJSON());
      state.consumedSessionIds.add(sessionId);
      const pending = state.pendingActivityRoutes.splice(0);
      await Promise.all(
        pending.map(async ({ route: pendingRoute, resolve }) => {
          await fulfillActivitySnapshot(pendingRoute, state);
          resolve();
        }),
      );
      await route.fulfill({ status: 204, body: '' });
      return;
    }
    if (url.pathname === '/api/v1/sessions' && request.method() === 'GET') {
      await json(route, {
        entries: sessions,
        offset: Number(url.searchParams.get('offset') ?? 0),
        limit: Number(url.searchParams.get('limit') ?? 50),
        hasMore: false,
      });
      return;
    }
    if (url.pathname === '/api/v1/cron-tasks' && request.method() === 'GET') {
      await json(route, { tasks: [], total: 0 });
      return;
    }
    const previewMatch = /^\/api\/v1\/sessions\/([^/]+)\/conversation\/preview$/.exec(url.pathname);
    if (previewMatch) {
      await json(route, {
        sessionId: decodeURIComponent(previewMatch[1]),
        totalMarkers: 0,
        offset: 0,
        limit: 100,
        markers: [],
      });
      return;
    }
    const conversationMatch = /^\/api\/v1\/sessions\/([^/]+)\/conversation$/.exec(url.pathname);
    if (conversationMatch) {
      const sessionId = decodeURIComponent(conversationMatch[1]);
      await json(route, {
        sessionId,
        items: sessionId === 'session-result' ? terminalConversation(sessionId) : [],
        nextCursor: null,
        newerCursor: null,
        activeRun: null,
      });
      return;
    }
    if (/^\/api\/v1\/sessions\/[^/]+\/background-tasks$/.test(url.pathname)) {
      await json(route, { tasks: [] });
      return;
    }
    if (/^\/api\/v1\/sessions\/[^/]+\/stream$/.test(url.pathname)) {
      await route.fulfill({ status: 200, contentType: 'text/event-stream', body: '' });
      return;
    }
    await json(route, {});
  });
}

async function installTimeoutJourneyFixture(page, state) {
  await page.route('**/api/v1/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());

    if (url.pathname === '/api/v1/runtime/bootstrap') {
      await json(route, { transportKind: 'SSE' });
      return;
    }
    if (url.pathname === '/api/v1/skills') {
      await json(route, { total: 0, pageNum: 1, pageSize: 50, skills: [] });
      return;
    }
    if (url.pathname === '/api/v1/frequent-questions') {
      await json(route, { locale: 'zh-CN', questions: [] });
      return;
    }
    if (url.pathname === '/api/v1/session-activities/stream') {
      state.activityRequestCount += 1;
      if (state.activityRequestCount === 1) {
        await route.fulfill({
          status: 200,
          contentType: 'text/event-stream',
          body: `event: SNAPSHOT\ndata: ${JSON.stringify({
            type: 'SNAPSHOT',
            entries: [
              {
                sessionId: 'session-timeout-a',
                status: 'WAITING_FOR_INPUT',
                pendingInputKind: 'QUESTION',
              },
            ],
          })}\n\n`,
        });
        return;
      }
      state.pendingActivityRoutes.push(route);
      return;
    }
    if (url.pathname === '/api/v1/sessions' && request.method() === 'GET') {
      await json(route, {
        entries: [session('session-timeout-a', 'Timeout session A'), session('session-timeout-b', 'Viewing session B')],
        offset: Number(url.searchParams.get('offset') ?? 0),
        limit: Number(url.searchParams.get('limit') ?? 50),
        hasMore: false,
      });
      return;
    }
    if (url.pathname === '/api/v1/cron-tasks' && request.method() === 'GET') {
      await json(route, { tasks: [], total: 0 });
      return;
    }
    const previewMatch = /^\/api\/v1\/sessions\/([^/]+)\/conversation\/preview$/.exec(url.pathname);
    if (previewMatch) {
      await json(route, {
        sessionId: decodeURIComponent(previewMatch[1]),
        totalMarkers: 0,
        offset: 0,
        limit: 100,
        markers: [],
      });
      return;
    }
    const conversationMatch = /^\/api\/v1\/sessions\/([^/]+)\/conversation$/.exec(url.pathname);
    if (conversationMatch) {
      await json(route, {
        sessionId: decodeURIComponent(conversationMatch[1]),
        items: [],
        nextCursor: null,
        newerCursor: null,
        activeRun: null,
      });
      return;
    }
    if (/^\/api\/v1\/sessions\/[^/]+\/background-tasks$/.test(url.pathname)) {
      await json(route, { tasks: [] });
      return;
    }
    if (url.pathname === '/api/v1/sessions/session-timeout-a/stream') {
      state.sessionAStreamRequests += 1;
      const required = timeoutRunEnvelope(1, 'USER_INPUT_REQUIRED', {
        pendingInputId: 'pending-timeout-a',
        id: 'pending-timeout-a',
        kind: 'QUESTION',
        status: 'PENDING',
        timeoutAt: Date.now() - 1,
        questions: [{ prompt: 'Provide timeout input?', options: [] }],
      });
      const envelopes = state.timeoutEmitted
        ? [
            required,
            timeoutRunEnvelope(2, 'USER_INPUT_TIMEOUT', {
              pendingInputId: 'pending-timeout-a',
              id: 'pending-timeout-a',
              kind: 'QUESTION',
              status: 'TIMED_OUT',
              safeSummary: 'Pending input timed out.',
            }),
            timeoutRunEnvelope(3, 'REQUEST_FAILED', {
              status: 'FAILED',
              code: 'PENDING_INPUT_TIMEOUT',
              content: 'Request failed safely: PENDING_INPUT_TIMEOUT',
            }),
          ]
        : [required];
      await route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        body: envelopes.map((envelope) => `data: ${JSON.stringify(envelope)}\n\n`).join(''),
      });
      return;
    }
    if (/^\/api\/v1\/sessions\/[^/]+\/stream$/.test(url.pathname)) {
      await route.fulfill({ status: 200, contentType: 'text/event-stream', body: '' });
      return;
    }
    await json(route, {});
  });
}

function timeoutRunEnvelope(sequence, eventType, payload) {
  return {
    eventId: `run-timeout-a-${eventType}-${sequence}`,
    sessionId: 'session-timeout-a',
    requestId: 'request-timeout-a',
    runId: 'run-timeout-a',
    requestContextId: 'context-timeout-a',
    rootMessageId: 'request-timeout-a',
    sequence,
    eventType,
    timelineEventRef: `run-timeout-a-timeline-${sequence}`,
    transportHints: ['SSE'],
    payload: {
      rootMessageId: 'request-timeout-a',
      requestId: 'request-timeout-a',
      runId: 'run-timeout-a',
      requestContextId: 'context-timeout-a',
      ...payload,
    },
    createdAt: new Date(Date.now() + sequence).toISOString(),
  };
}

async function fulfillActivitySnapshot(route, state) {
  const entries = initialActivities.filter((entry) => !state.consumedSessionIds.has(entry.sessionId));
  await route.fulfill({
    status: 200,
    contentType: 'text/event-stream',
    body: `event: SNAPSHOT\ndata: ${JSON.stringify({ type: 'SNAPSHOT', entries })}\n\n`,
  });
}

function terminalConversation(sessionId) {
  return [
    {
      messageId: 'message-result-user',
      sessionId,
      requestId: 'request-result',
      runId: null,
      requestContextId: 'context-result',
      rootMessageId: 'message-result-user',
      role: 'USER',
      sequence: 1,
      content: 'Complete the diagnosis',
      contentType: 'PLAIN_TEXT',
      metadata: {},
      createdAt: '2026-07-28T12:00:00.000Z',
      visible: true,
    },
    {
      messageId: 'message-result-assistant',
      sessionId,
      requestId: 'request-result',
      runId: 'run-result',
      requestContextId: 'context-result',
      rootMessageId: 'message-result-user',
      role: 'ASSISTANT',
      sequence: 2,
      content: 'Completed terminal answer',
      contentType: 'MARKDOWN',
      metadata: { status: 'COMPLETED', runId: 'run-result' },
      createdAt: '2026-07-28T12:00:01.000Z',
      visible: true,
    },
  ];
}

function session(sessionId, displayTitle) {
  return {
    sessionId,
    displayTitle,
    lastActivityAt: '2026-07-28T12:00:00.000Z',
  };
}

async function json(route, body) {
  await route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(body),
  });
}
