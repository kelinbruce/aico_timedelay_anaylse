const { expect, test } = require('@playwright/test');

const SESSION_IDS = ['session-process-child', 'session-process-grandchild'];
const COLLISION_SESSION_ID = 'session-capability-identity-collision';
const READ_VISIBLE_EVIDENCE = 'workspace router configuration is compliant';
const SKILL_HIDDEN_EVIDENCE = 'internal SKILL.md instructions must stay hidden';

test('restores child-owned process content after the source is unavailable', async ({ page }) => {
  const requestedSessions = [];
  await page.route('**/api/v1/sessions/**', async (route) => {
    const url = new URL(route.request().url());
    const sessionId = SESSION_IDS.find((candidate) => url.pathname.includes(candidate));
    if (sessionId === undefined) {
      await route.fulfill({
        status: 404,
        contentType: 'application/json',
        body: JSON.stringify({ code: 'SOURCE_SESSION_NOT_FOUND' }),
      });
      return;
    }
    requestedSessions.push(sessionId);
    if (url.pathname === `/api/v1/sessions/${sessionId}/conversation`) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(conversationPage(sessionId)),
      });
      return;
    }
    if (url.pathname === `/api/v1/sessions/${sessionId}/runs/run-1/events`) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(eventPage(sessionId)),
      });
      return;
    }
    if (url.pathname === `/api/v1/sessions/${sessionId}/annotations`) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ annotations: [] }),
      });
      return;
    }
    if (url.pathname === `/api/v1/sessions/${sessionId}/stream`) {
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
    await route.fulfill({ status: 404, body: '{}' });
  });
  await page.route('**/api/v1/sessions?**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ entries: [], offset: 0, limit: 50, hasMore: false }),
    });
  });

  for (const sessionId of SESSION_IDS) {
    await page.goto(`/#/session/${sessionId}`);
    const turn = page.locator('[data-root-message-id="root-1"]');
    await expect(turn.getByText('Router configuration is healthy.', { exact: true })).toHaveCount(1);
    const processToggle = turn.getByTestId('turn-process-toggle');
    await expect(processToggle).toBeVisible();
    if ((await processToggle.getAttribute('aria-expanded')) !== 'true') {
      await processToggle.click();
    }
    const panel = turn.getByTestId('turn-process-panel');
    const explanation = panel.getByRole('note', { name: /Execution update|执行说明/u });
    await expect(explanation).toHaveCount(1);
    await expect(explanation.getByText('I will inspect the router configuration.', { exact: true })).toHaveCount(1);
    await expect(explanation.getByTestId('turn-process-entry-title')).toHaveCount(0);
    await expect(explanation.getByTestId('turn-process-entry-icon-node')).toHaveCount(0);
    await expect(explanation.getByTestId('turn-process-entry-toggle')).toHaveCount(0);
    const tool = panel.getByTestId('turn-process-entry-toggle').filter({ hasText: 'routerAudit' });
    await expect(tool).toHaveCount(1);
    await expect(explanation.locator('xpath=following-sibling::*[1]')).toContainText('routerAudit');
    await tool.click();
    await expect(panel.getByText('Router audit result: healthy.', { exact: true })).toHaveCount(1);
  }

  expect(requestedSessions).toEqual(expect.arrayContaining(SESSION_IDS));
  expect(requestedSessions.some((sessionId) => sessionId.includes('source'))).toBe(false);
});

for (const host of [
  { name: 'local', url: `/#/session/${COLLISION_SESSION_ID}` },
  { name: 'immersive', url: `/immersive#/session/${COLLISION_SESSION_ID}` },
  { name: 'collaborative', url: '/collaborative', collaborative: true },
]) {
  test(`${host.name} keeps Read detail visible and Skill resource content hidden across refresh`, async ({ page }) => {
    const readEventRequestCount = await installIdentityCollisionFixture(page);
    await openIdentityCollisionHost(page, host);
    await expect.poll(readEventRequestCount).toBeGreaterThanOrEqual(1);
    await expect.poll(() => readIdentityCollisionHistoryStatus(page)).toBe('AVAILABLE');
    await assertIdentityCollisionProjection(page);

    await page.reload();
    if (host.collaborative) {
      await page.getByTestId('ai-agent-piu-entrance').click();
      await expect(page.getByTestId('ai-agent-piu-panel')).toBeVisible();
    }
    await expect.poll(readEventRequestCount).toBeGreaterThanOrEqual(2);
    await expect.poll(() => readIdentityCollisionHistoryStatus(page)).toBe('AVAILABLE');
    await assertIdentityCollisionProjection(page);
  });
}

async function readIdentityCollisionHistoryStatus(page) {
  return page.evaluate(
    async ({ sessionId, runId }) => {
      const { useConversationStore } = await import('/src/state/conversationStore.ts');
      return useConversationStore.getState().processHistoryBySession[sessionId]?.[runId]?.status ?? null;
    },
    { sessionId: COLLISION_SESSION_ID, runId: 'run-collision' },
  );
}

async function installIdentityCollisionFixture(page) {
  let eventRequests = 0;
  await page.route('**/api/v1/sessions/**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === `/api/v1/sessions/${COLLISION_SESSION_ID}/conversation`) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(identityCollisionConversationPage()),
      });
      return;
    }
    if (url.pathname === `/api/v1/sessions/${COLLISION_SESSION_ID}/runs/run-collision/events`) {
      eventRequests += 1;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(identityCollisionEventPage()),
      });
      return;
    }
    if (url.pathname === `/api/v1/sessions/${COLLISION_SESSION_ID}/annotations`) {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ annotations: [] }) });
      return;
    }
    if (url.pathname === `/api/v1/sessions/${COLLISION_SESSION_ID}/conversation/preview`) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ sessionId: COLLISION_SESSION_ID, totalMarkers: 0, offset: 0, limit: 100, markers: [] }),
      });
      return;
    }
    if (url.pathname === `/api/v1/sessions/${COLLISION_SESSION_ID}/stream`) {
      return;
    }
    await route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ code: 'NOT_FOUND' }) });
  });
  await page.route('**/api/v1/sessions?**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ entries: [], offset: 0, limit: 50, hasMore: false }),
    });
  });
  return () => eventRequests;
}

async function openIdentityCollisionHost(page, host) {
  if (host.collaborative) {
    await page.addInitScript(
      ({ sessionId }) => {
        window.sessionStorage.setItem('nextagent:AICOPIU:activeSessionId', sessionId);
      },
      { sessionId: COLLISION_SESSION_ID },
    );
  }
  await page.goto(host.url);
  if (host.collaborative) {
    await page.getByTestId('ai-agent-piu-entrance').click();
    await expect(page.getByTestId('ai-agent-piu-panel')).toBeVisible();
  }
}

async function assertIdentityCollisionProjection(page) {
  const turn = page.locator('[data-root-message-id="root-collision"]');
  await expect(turn.getByText('Identity projection verified.', { exact: true })).toBeVisible();
  const processToggle = turn.getByTestId('turn-process-toggle');
  await expect(processToggle).toBeVisible();
  if ((await processToggle.getAttribute('aria-expanded')) !== 'true') {
    await processToggle.click();
  }
  const panel = turn.getByTestId('turn-process-panel');
  const readToggle = panel.getByTestId('turn-process-entry-toggle').filter({ hasText: 'Read' });
  await expect(readToggle).toHaveCount(1);
  await readToggle.click();
  await expect(panel).toContainText(READ_VISIBLE_EVIDENCE);
  const skillTitle = /skill|技能/iu;
  await expect(panel.getByTestId('turn-process-entry-title').filter({ hasText: skillTitle })).toHaveCount(1);
  await expect(panel.getByTestId('turn-process-entry-toggle').filter({ hasText: skillTitle })).toHaveCount(0);
  await expect(panel).not.toContainText(SKILL_HIDDEN_EVIDENCE);
}

function identityCollisionConversationPage() {
  const common = {
    sessionId: COLLISION_SESSION_ID,
    requestId: 'request-collision',
    runId: 'run-collision',
    requestContextId: 'context-collision',
    rootMessageId: 'root-collision',
    contentType: 'PLAIN_TEXT',
    visible: true,
  };
  return {
    sessionId: COLLISION_SESSION_ID,
    items: [
      {
        ...common,
        messageId: 'root-collision',
        role: 'USER',
        sequence: 1,
        content: 'Compare workspace Read and internal Skill resource projection',
        metadata: {},
        createdAt: '2026-07-29T01:00:00.000Z',
      },
      {
        ...common,
        messageId: 'read-result-collision',
        role: 'CAPABILITY_RESULT',
        sequence: 2,
        content: '',
        metadata: { kind: 'CAPABILITY_RESULT', toolCallId: 'read-call-collision', toolName: 'Read' },
        createdAt: '2026-07-29T01:00:00.100Z',
      },
      {
        ...common,
        messageId: 'skill-result-collision',
        role: 'CAPABILITY_RESULT',
        sequence: 3,
        content: '',
        metadata: { kind: 'CAPABILITY_RESULT', toolCallId: 'skill-call-collision', toolName: 'Skill' },
        createdAt: '2026-07-29T01:00:00.200Z',
      },
      {
        ...common,
        messageId: 'answer-collision',
        role: 'ASSISTANT',
        sequence: 4,
        content: 'Identity projection verified.',
        contentType: 'MARKDOWN',
        metadata: { eventType: 'REQUEST_COMPLETED', status: 'COMPLETED' },
        createdAt: '2026-07-29T01:00:00.300Z',
      },
    ],
    nextCursor: null,
  };
}

function identityCollisionEventPage() {
  const common = {
    sessionId: COLLISION_SESSION_ID,
    requestId: 'request-collision',
    runId: 'run-collision',
    requestContextId: 'context-collision',
    rootMessageId: 'root-collision',
    transportHints: ['SSE', 'WEBSOCKET'],
    createdAt: '2026-07-29T01:00:00.100Z',
  };
  return {
    availability: 'AVAILABLE',
    events: [
      {
        ...common,
        eventId: 'read-start-collision',
        sequence: 1,
        eventType: 'CAPABILITY_STARTED',
        timelineEventRef: 'timeline-read-start-collision',
        payload: { capabilityId: 'Read', toolCallId: 'read-call-collision', toolName: 'Read' },
      },
      {
        ...common,
        eventId: 'read-result-collision',
        sequence: 2,
        eventType: 'CAPABILITY_RESULT_DELTA',
        timelineEventRef: 'timeline-read-result-collision',
        payload: {
          capabilityId: 'Read',
          toolCallId: 'read-call-collision',
          toolName: 'Read',
          status: 'SUCCEEDED',
          resultPresentationLevel: 'DETAIL',
          content: READ_VISIBLE_EVIDENCE,
          text: READ_VISIBLE_EVIDENCE,
          contentType: 'PLAIN_TEXT',
          safeSummary: 'Read network/router.cfg and returned its content.',
          safeResult: {
            kind: 'fileRead',
            filePath: 'network/router.cfg',
            contentPreview: READ_VISIBLE_EVIDENCE,
            truncated: false,
          },
        },
      },
      {
        ...common,
        eventId: 'read-complete-collision',
        sequence: 3,
        eventType: 'CAPABILITY_COMPLETED',
        timelineEventRef: 'timeline-read-complete-collision',
        payload: {
          capabilityId: 'Read',
          toolCallId: 'read-call-collision',
          toolName: 'Read',
          status: 'SUCCEEDED',
          resultPresentationLevel: 'DETAIL',
        },
      },
      {
        ...common,
        eventId: 'skill-start-collision',
        sequence: 4,
        eventType: 'CAPABILITY_STARTED',
        timelineEventRef: 'timeline-skill-start-collision',
        payload: { capabilityId: 'Skill', toolCallId: 'skill-call-collision', toolName: 'Skill' },
      },
      {
        ...common,
        eventId: 'skill-result-collision',
        sequence: 5,
        eventType: 'CAPABILITY_RESULT_DELTA',
        timelineEventRef: 'timeline-skill-result-collision',
        payload: {
          capabilityId: 'Skill',
          toolCallId: 'skill-call-collision',
          toolName: 'Skill',
          status: 'SUCCEEDED',
          resultPresentationLevel: 'STATUS_ONLY',
          content: '',
          text: '',
        },
      },
      {
        ...common,
        eventId: 'skill-complete-collision',
        sequence: 6,
        eventType: 'CAPABILITY_COMPLETED',
        timelineEventRef: 'timeline-skill-complete-collision',
        payload: {
          capabilityId: 'Skill',
          toolCallId: 'skill-call-collision',
          toolName: 'Skill',
          status: 'SUCCEEDED',
          resultPresentationLevel: 'STATUS_ONLY',
        },
      },
    ],
  };
}

function conversationPage(sessionId) {
  const common = {
    sessionId,
    requestId: 'request-1',
    runId: 'run-1',
    requestContextId: 'context-1',
    rootMessageId: 'root-1',
    contentType: 'PLAIN_TEXT',
    visible: true,
  };
  return {
    sessionId,
    items: [
      {
        ...common,
        messageId: 'root-1',
        role: 'USER',
        sequence: 1,
        content: 'Check router configuration',
        metadata: { eventType: 'REQUEST_COMPLETED', status: 'COMPLETED' },
        createdAt: '2026-07-29T00:00:00.000Z',
      },
      {
        ...common,
        messageId: 'result-1',
        role: 'CAPABILITY_RESULT',
        sequence: 2,
        content: 'Router audit result: healthy.',
        metadata: {
          kind: 'CAPABILITY_RESULT',
          toolCallId: 'tool-1',
          toolName: 'routerAudit',
        },
        createdAt: '2026-07-29T00:00:00.100Z',
      },
      {
        ...common,
        messageId: 'answer-1',
        role: 'ASSISTANT',
        sequence: 3,
        content: 'Router configuration is healthy.',
        contentType: 'MARKDOWN',
        metadata: { eventType: 'REQUEST_COMPLETED', status: 'COMPLETED' },
        createdAt: '2026-07-29T00:00:00.200Z',
      },
    ],
    nextCursor: null,
  };
}

function eventPage(sessionId) {
  const common = {
    sessionId,
    requestId: 'request-1',
    runId: 'run-1',
    requestContextId: 'context-1',
    rootMessageId: 'root-1',
    transportHints: [],
    createdAt: '2026-07-29T00:00:00.100Z',
  };
  return {
    availability: 'AVAILABLE',
    events: [
      {
        ...common,
        eventId: 'stage-1',
        sequence: 1,
        eventType: 'LLM_CONTENT_DELTA',
        timelineEventRef: 'timeline-stage-1',
        payload: {
          content: 'I will inspect the router configuration.',
          text: 'I will inspect the router configuration.',
          contentType: 'MARKDOWN',
          stepId: 'turn-1',
          completed: true,
        },
      },
      {
        ...common,
        eventId: 'tool-start-1',
        sequence: 2,
        eventType: 'CAPABILITY_STARTED',
        timelineEventRef: 'timeline-tool-start-1',
        payload: {
          capabilityId: 'routerAudit',
          toolCallId: 'tool-1',
          toolName: 'routerAudit',
        },
      },
      {
        ...common,
        eventId: 'tool-complete-1',
        sequence: 3,
        eventType: 'CAPABILITY_COMPLETED',
        timelineEventRef: 'timeline-tool-complete-1',
        payload: {
          capabilityId: 'routerAudit',
          toolCallId: 'tool-1',
          toolName: 'routerAudit',
          status: 'SUCCEEDED',
          content: 'Router audit result: healthy.',
        },
      },
    ],
  };
}
