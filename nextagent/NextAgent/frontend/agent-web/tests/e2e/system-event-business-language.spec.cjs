const { expect, test } = require('@playwright/test');

const SESSION_ID = 'session-system-event-business-language';
const ROOT_MESSAGE_ID = 'root-system-event-business-language';
const RUN_ID = 'run-system-event-business-language';
const RAW_EVENT_TEXT = 'RAW_SYSTEM_EVENT_TEXT_MUST_NOT_BE_VISIBLE';
const ERROR_CODE = 'MODEL_FALLBACK';

const hostModes = [
  { name: 'local', url: `/#/session/${SESSION_ID}` },
  { name: 'immersive', url: `/immersive#/session/${SESSION_ID}` },
  { name: 'collaborative', url: '/collaborative', collaborative: true },
];

const localeExpectations = {
  'zh-CN': {
    degradationTitle: '本次任务有部分内容未完成',
    degradationSummary: '请查看执行详情和本次答复，确认未完成的内容。',
    hookTitle: '本次任务有部分内容未完成',
    hookSummary: '请查看执行详情和本次答复，确认未完成的内容。',
    contextTitle: '已整理较早的对话',
    contextSummary: '系统已整理较早的对话内容，以便继续处理本次任务。',
    fullProcess: '完整过程',
    errorCode: `错误码：${ERROR_CODE}`,
    forbidden: ['降级通知', 'Hook 降级', '上下文压缩'],
  },
  'en-US': {
    degradationTitle: 'Some work in this task did not complete',
    degradationSummary: 'Review the execution details and response to identify what did not complete.',
    hookTitle: 'Some work in this task did not complete',
    hookSummary: 'Review the execution details and response to identify what did not complete.',
    contextTitle: 'Earlier messages were condensed',
    contextSummary: 'The system condensed earlier messages to continue this task.',
    fullProcess: 'Full process',
    errorCode: `Error code: ${ERROR_CODE}`,
    forbidden: ['Degradation notice', 'Hook degraded', 'Context compacted'],
  },
};

for (const host of hostModes) {
  for (const locale of /** @type {const} */ (['zh-CN', 'en-US'])) {
    test(`${host.name} presents governed system-event language in ${locale}`, async ({ page }) => {
      const expected = localeExpectations[locale];
      await installFixture(page, host, locale);
      await openHost(page, host, locale);
      await appendLiveEvents(page);

      const turn = page.locator(`[data-root-message-id="${ROOT_MESSAGE_ID}"]`);
      await expect(turn.getByText('Public answer is available.', { exact: true })).toBeVisible();
      await expect(turn.getByTestId('assistant-compaction-notice')).toHaveText(expected.contextSummary);

      const processToggle = turn.getByTestId('turn-process-toggle');
      if ((await processToggle.getAttribute('aria-expanded')) !== 'true') {
        await processToggle.click();
      }
      const processPanel = turn.getByTestId('turn-process-panel');
      for (const text of [
        expected.degradationTitle,
        expected.degradationSummary,
        expected.hookTitle,
        expected.hookSummary,
        expected.contextTitle,
        expected.contextSummary,
      ]) {
        await expect(processPanel).toContainText(text);
      }
      await expect(processPanel).not.toContainText(ERROR_CODE);
      await expect(processPanel).not.toContainText(RAW_EVENT_TEXT);
      await expect(processPanel.getByTestId('turn-process-entry-warning-icon')).toHaveCount(2);
      await expect(processPanel.getByTestId('turn-process-entry-info-icon')).toHaveCount(1);

      const degradationRow = processPanel
        .getByText(expected.degradationTitle, { exact: true })
        .first()
        .locator('xpath=ancestor::*[@data-testid="turn-process-entry"]');
      await degradationRow.getByTestId('turn-process-entry-toggle').click();
      await expect(degradationRow).toContainText(expected.errorCode);

      await turn.getByRole('button', { name: expected.fullProcess, exact: true }).click();
      const graphPanel = page.getByTestId('turn-run-graph-panel');
      await expect(graphPanel).toBeVisible();
      const graphSummary = graphPanel.getByTestId('turn-run-graph-summary');
      for (const text of [expected.degradationTitle, expected.hookTitle, expected.contextTitle]) {
        await expect(graphSummary).toContainText(text);
      }
      await expect(graphSummary).toContainText(expected.degradationSummary);
      await expect(graphSummary).not.toContainText(ERROR_CODE);
      await expect(graphPanel).not.toContainText(RAW_EVENT_TEXT);

      for (const forbidden of expected.forbidden) {
        await expect(page.getByText(forbidden, { exact: true })).toHaveCount(0);
      }
    });
  }
}

async function installFixture(page, host, locale) {
  await page.addInitScript(
    ({ selectedLocale, collaborative, sessionId }) => {
      window.localStorage.setItem('nextagent.localePreference', selectedLocale);
      if (collaborative) {
        window.sessionStorage.setItem('nextagent:AICOPIU:activeSessionId', sessionId);
      }
    },
    { selectedLocale: locale, collaborative: Boolean(host.collaborative), sessionId: SESSION_ID },
  );
  await page.route('**/api/v1/sessions?**', async (route) => {
    await json(route, { entries: [], offset: 0, limit: 50, hasMore: false });
  });
  await page.route('**/api/v1/sessions/**', async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname === `/api/v1/sessions/${SESSION_ID}/conversation`) {
      await json(route, { sessionId: SESSION_ID, items: [], nextCursor: null });
      return;
    }
    if (pathname === `/api/v1/sessions/${SESSION_ID}/annotations`) {
      await json(route, { annotations: [] });
      return;
    }
    if (pathname === `/api/v1/sessions/${SESSION_ID}/conversation/preview`) {
      await json(route, { sessionId: SESSION_ID, totalMarkers: 0, offset: 0, limit: 100, markers: [] });
      return;
    }
    if (pathname === `/api/v1/sessions/${SESSION_ID}/stream`) {
      return;
    }
    await json(route, { code: 'NOT_FOUND' }, 404);
  });
}

async function openHost(page, host, locale) {
  await page.goto(host.url);
  if (host.collaborative) {
    await page.getByTestId('ai-agent-piu-entrance').click();
    await expect(page.getByTestId('ai-agent-piu-panel')).toBeVisible();
  }
  await page.waitForTimeout(100);
  await page.evaluate(async (selectedLocale) => {
    const { setLocalePreference } = await import('/src/i18n/index.ts');
    await setLocalePreference(selectedLocale);
  }, locale);
  await expect.poll(() => page.evaluate(() => document.documentElement.lang)).toBe(locale);
}

async function appendLiveEvents(page) {
  await page.evaluate(
    async ({ sessionId, events }) => {
      const { useConversationStore } = await import('/src/state/conversationStore.ts');
      useConversationStore.getState().appendEnvelopes(sessionId, events);
    },
    { sessionId: SESSION_ID, events: liveEvents() },
  );
}

function liveEvents() {
  const common = {
    sessionId: SESSION_ID,
    requestId: ROOT_MESSAGE_ID,
    runId: RUN_ID,
    rootMessageId: ROOT_MESSAGE_ID,
    requestContextId: 'context-system-event-business-language',
    timelineEventRef: 'timeline-system-event-business-language',
    transportHints: ['SSE'],
  };
  const event = (sequence, eventType, payload) => ({
    ...common,
    eventId: `system-event-business-language-${sequence}`,
    sequence,
    eventType,
    payload,
    createdAt: `2026-08-08T12:00:0${sequence}.000Z`,
  });
  return [
    event(1, 'REQUEST_ACCEPTED', {
      role: 'USER',
      messageId: ROOT_MESSAGE_ID,
      rootMessageId: ROOT_MESSAGE_ID,
      content: 'Verify governed system-event language',
      text: 'Verify governed system-event language',
      contentType: 'PLAIN_TEXT',
      metadata: { accumulated: true },
      visible: true,
    }),
    event(2, 'CAPABILITY_STARTED', { capabilityId: 'systemProbe', toolCallId: 'system-probe-1', toolName: 'systemProbe' }),
    event(3, 'CAPABILITY_COMPLETED', {
      capabilityId: 'systemProbe',
      toolCallId: 'system-probe-1',
      toolName: 'systemProbe',
      status: 'SUCCEEDED',
      safeSummary: 'System probe completed.',
    }),
    event(4, 'DEGRADATION_NOTICE', { code: ERROR_CODE, message: RAW_EVENT_TEXT }),
    event(5, 'HOOK_DEGRADED', { code: 'HOOK_TIMEOUT', message: RAW_EVENT_TEXT }),
    event(6, 'LLM_CONTENT_DELTA', {
      role: 'ASSISTANT',
      content: 'Public answer is available.',
      text: 'Public answer is available.',
      metadata: { accumulated: true },
    }),
    event(7, 'CONTEXT_COMPACTED', { message: RAW_EVENT_TEXT }),
  ];
}

async function json(route, body, status = 200) {
  await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
}
