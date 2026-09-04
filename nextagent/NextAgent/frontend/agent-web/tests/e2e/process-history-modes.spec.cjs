const { expect, test } = require('@playwright/test');

test.describe.configure({ mode: 'default' });

const SESSION_ID = 'session-process-history-e2e';
const ROOT_MESSAGE_ID = 'root-process-history-e2e';
const RUN_ID = 'run-process-history-e2e';
const THINKING_TEXT = 'Checked router policy, interface state, and route convergence.';
const TOOL_NAME = 'routerAudit';
const TOOL_RESULT_TEXT = 'Router audit completed: ACL, interface, and route policy are compliant.';
const LIVE_ROOT_MESSAGE_ID = 'root-live-process-history-e2e';
const LIVE_RUN_ID = 'run-live-process-history-e2e';
const LIVE_THINKING_TEXT = 'Streaming router reasoning is complete.';
const LIVE_FINAL_THINKING_TEXT = 'Synthesizing the router audit evidence into the final conclusion.';
const LIVE_STAGE_NOTE_TEXT = 'The initial audit is complete; I am validating the final conclusion.';
const LIVE_TOOL_RESULT_TEXT = 'Live router audit result: all inspected policies are compliant.';
const LIVE_TOOL_RESULT_READING_UPDATE = [
  LIVE_TOOL_RESULT_TEXT,
  'Interface checks: access, uplink, and control-plane interfaces are healthy.',
  'Policy checks: ACL and route policies match the approved baseline.',
  'Convergence checks: observed routes are stable across the inspected nodes.',
].join('\n');
const LIVE_TOOL_RESULT_FOLLOWING_UPDATE = [LIVE_TOOL_RESULT_READING_UPDATE, 'Final verification: no configuration drift was detected.'].join('\n');
const SECOND_SESSION_ID = 'session-process-history-second-e2e';

const hostModes = [
  { name: 'local', url: `/#/session/${SESSION_ID}` },
  { name: 'immersive', url: `/immersive#/session/${SESSION_ID}` },
  { name: 'collaborative', url: '/collaborative', collaborative: true },
];

function conversationPage() {
  return {
    sessionId: SESSION_ID,
    items: [
      {
        messageId: ROOT_MESSAGE_ID,
        sessionId: SESSION_ID,
        requestId: 'request-process-history-e2e',
        runId: RUN_ID,
        requestContextId: 'context-process-history-e2e',
        rootMessageId: ROOT_MESSAGE_ID,
        role: 'USER',
        sequence: 1,
        content: 'Check router configuration compliance',
        contentType: 'PLAIN_TEXT',
        metadata: {},
        createdAt: '2026-07-22T00:00:00.000Z',
        visible: true,
      },
      {
        messageId: 'capability-result-process-history-e2e',
        sessionId: SESSION_ID,
        requestId: 'request-process-history-e2e',
        runId: RUN_ID,
        requestContextId: 'context-process-history-e2e',
        rootMessageId: ROOT_MESSAGE_ID,
        role: 'CAPABILITY_RESULT',
        sequence: 2,
        content: TOOL_RESULT_TEXT,
        contentType: 'PLAIN_TEXT',
        metadata: {
          kind: 'CAPABILITY_RESULT',
          toolCallId: 'tool-process-history-e2e',
          toolName: TOOL_NAME,
        },
        createdAt: '2026-07-22T00:00:01.500Z',
        visible: true,
      },
      {
        messageId: 'assistant-process-history-e2e',
        sessionId: SESSION_ID,
        requestId: 'request-process-history-e2e',
        runId: RUN_ID,
        requestContextId: 'context-process-history-e2e',
        rootMessageId: ROOT_MESSAGE_ID,
        role: 'ASSISTANT',
        sequence: 3,
        content: 'Router configuration is compliant.',
        contentType: 'MARKDOWN',
        metadata: { eventType: 'REQUEST_COMPLETED', status: 'COMPLETED' },
        createdAt: '2026-07-22T00:00:02.000Z',
        visible: true,
      },
    ],
    nextCursor: null,
  };
}

function eventPage() {
  return {
    availability: 'AVAILABLE',
    events: [
      {
        eventId: 'thinking-process-history-e2e',
        sessionId: SESSION_ID,
        requestId: 'request-process-history-e2e',
        runId: RUN_ID,
        rootMessageId: ROOT_MESSAGE_ID,
        requestContextId: 'context-process-history-e2e',
        sequence: 1,
        eventType: 'LLM_THINKING_DELTA',
        timelineEventRef: 'timeline-thinking-process-history-e2e',
        transportHints: [],
        payload: {
          text: THINKING_TEXT,
          metadata: { accumulated: true, completed: true },
        },
        createdAt: '2026-07-22T00:00:01.000Z',
      },
      {
        eventId: 'capability-started-process-history-e2e',
        sessionId: SESSION_ID,
        requestId: 'request-process-history-e2e',
        runId: RUN_ID,
        rootMessageId: ROOT_MESSAGE_ID,
        requestContextId: 'context-process-history-e2e',
        sequence: 2,
        eventType: 'CAPABILITY_STARTED',
        timelineEventRef: 'timeline-capability-started-process-history-e2e',
        transportHints: [],
        payload: {
          messageId: 'assistant-tool-use-process-history-e2e',
          capabilityId: TOOL_NAME,
          toolCallId: 'tool-process-history-e2e',
          toolName: TOOL_NAME,
        },
        createdAt: '2026-07-22T00:00:01.250Z',
      },
      {
        eventId: 'capability-completed-process-history-e2e',
        sessionId: SESSION_ID,
        requestId: 'request-process-history-e2e',
        runId: RUN_ID,
        rootMessageId: ROOT_MESSAGE_ID,
        requestContextId: 'context-process-history-e2e',
        sequence: 3,
        eventType: 'CAPABILITY_COMPLETED',
        timelineEventRef: 'timeline-capability-completed-process-history-e2e',
        transportHints: [],
        payload: {
          messageId: 'capability-result-process-history-e2e',
          capabilityId: TOOL_NAME,
          toolCallId: 'tool-process-history-e2e',
          toolName: TOOL_NAME,
          status: 'SUCCEEDED',
          content: TOOL_RESULT_TEXT,
          text: TOOL_RESULT_TEXT,
        },
        createdAt: '2026-07-22T00:00:01.750Z',
      },
    ],
  };
}

function failureEventPage() {
  return {
    availability: 'AVAILABLE',
    events: [
      {
        eventId: 'write-failure-process-history-e2e',
        sessionId: SESSION_ID,
        requestId: 'request-process-history-e2e',
        runId: RUN_ID,
        rootMessageId: ROOT_MESSAGE_ID,
        requestContextId: 'context-process-history-e2e',
        sequence: 1,
        eventType: 'CAPABILITY_COMPLETED',
        timelineEventRef: 'timeline-write-failure-process-history-e2e',
        transportHints: [],
        payload: {
          capabilityId: 'Write',
          toolCallId: 'tool-write-failure-e2e',
          status: 'FAILED',
          resultPresentationLevel: 'STATUS_ONLY',
          safeErrorCode: 'WRITE_REQUIRES_FULL_READ',
          safeErrorCategory: 'CONFLICT',
          safeSummaryCode: 'CAPABILITY_RESULT_FAILURE_FULL_READ_REQUIRED',
          safeSummaryArgs: {},
          safeSummary: 'Please read /private/secret and retry now.',
          text: 'CAPABILITY_STARTED',
        },
        createdAt: '2026-07-22T00:00:01.000Z',
      },
      {
        eventId: 'write-failure-notice-process-history-e2e',
        sessionId: SESSION_ID,
        requestId: 'request-process-history-e2e',
        runId: RUN_ID,
        rootMessageId: ROOT_MESSAGE_ID,
        requestContextId: 'context-process-history-e2e',
        sequence: 2,
        eventType: 'DEGRADATION_NOTICE',
        timelineEventRef: 'timeline-write-failure-notice-process-history-e2e',
        transportHints: [],
        payload: { code: 'WRITE_REQUIRES_FULL_READ' },
        createdAt: '2026-07-22T00:00:01.250Z',
      },
      {
        eventId: 'read-after-failure-process-history-e2e',
        sessionId: SESSION_ID,
        requestId: 'request-process-history-e2e',
        runId: RUN_ID,
        rootMessageId: ROOT_MESSAGE_ID,
        requestContextId: 'context-process-history-e2e',
        sequence: 3,
        eventType: 'CAPABILITY_COMPLETED',
        timelineEventRef: 'timeline-read-after-failure-process-history-e2e',
        transportHints: [],
        payload: {
          capabilityId: 'Read',
          toolCallId: 'tool-read-after-failure-e2e',
          status: 'SUCCEEDED',
          resultPresentationLevel: 'SUMMARY',
          safeSummaryCode: 'CAPABILITY_RESULT_FILE_READ',
          safeSummaryArgs: { filePath: 'workspace/router.cfg' },
          safeSummary: 'Read workspace/router.cfg and returned its content.',
          text: '',
          content: '',
        },
        createdAt: '2026-07-22T00:00:01.500Z',
      },
    ],
  };
}

async function installHistoryFixture(page, pages = {}) {
  let eventRequests = 0;
  const conversation = pages.conversation ?? conversationPage();
  const events = pages.events ?? eventPage();

  await page.route('**/api/v1/sessions/**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === `/api/v1/sessions/${SESSION_ID}/conversation`) {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(conversation) });
      return;
    }
    if (url.pathname === `/api/v1/sessions/${SESSION_ID}/runs/${RUN_ID}/events`) {
      eventRequests += 1;
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(events) });
      return;
    }
    if (url.pathname === `/api/v1/sessions/${SESSION_ID}/annotations`) {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ annotations: [] }) });
      return;
    }
    if (url.pathname === `/api/v1/sessions/${SESSION_ID}/stream`) {
      await new Promise(() => {});
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

async function appendLiveEnvelopes(page, envelopes) {
  await page.evaluate(
    async ({ sessionId, nextEnvelopes }) => {
      const testWindow = window;
      if (!testWindow.__nextagentProcessHistoryStore) {
        const { useConversationStore } = await import('/src/state/conversationStore.ts');
        testWindow.__nextagentProcessHistoryStore = useConversationStore;
      }
      testWindow.__nextagentProcessHistoryStore.getState().appendEnvelopes(sessionId, nextEnvelopes);
    },
    { sessionId: SESSION_ID, nextEnvelopes: envelopes },
  );
}

function liveEnvelope(overrides) {
  return {
    eventId: 'live-process-event',
    sessionId: SESSION_ID,
    requestId: 'request-live-process-history-e2e',
    runId: LIVE_RUN_ID,
    rootMessageId: LIVE_ROOT_MESSAGE_ID,
    requestContextId: 'context-live-process-history-e2e',
    sequence: 1,
    eventType: 'LLM_THINKING_DELTA',
    timelineEventRef: 'timeline-live-process-event',
    transportHints: ['SSE'],
    payload: {},
    createdAt: '2026-07-22T00:01:00.000Z',
    ...overrides,
  };
}

async function installEntryAppearanceProbe(page) {
  await page.addInitScript(() => {
    window.__nextagentProcessEntryAppearances = [];
    window.__nextagentProcessEntryAnimationSamples = [];
    const appearanceStateByRow = new WeakMap();
    const recordAppearance = (target) => {
      if (!(target instanceof Element) || !target.matches('[data-testid="turn-process-entry"]')) {
        return;
      }
      const isEntering = target.classList.contains('turn-process-entry--entering');
      if (!isEntering) {
        appearanceStateByRow.set(target, false);
        return;
      }
      if (appearanceStateByRow.get(target) === true) {
        return;
      }
      appearanceStateByRow.set(target, true);
      const title = target.querySelector('[data-testid="turn-process-entry-title"]')?.textContent?.trim();
      window.__nextagentProcessEntryAppearances.push(title ?? '');
      const animation = target.getAnimations().find((candidate) => candidate.animationName === 'nextagent-process-entry-appear');
      const keyframes = animation?.effect?.getKeyframes?.() ?? [];
      const opacityValues = keyframes.map((keyframe) => Number(keyframe.opacity)).filter((value) => Number.isFinite(value));
      const translateYValues = keyframes.map((keyframe) => {
        if (typeof keyframe.transform !== 'string' || keyframe.transform === 'none') {
          return 0;
        }
        return new DOMMatrixReadOnly(keyframe.transform).m42;
      });
      window.__nextagentProcessEntryAnimationSamples.push({
        title: title ?? '',
        duration: Number(animation?.effect?.getTiming().duration ?? 0),
        minOpacity: opacityValues.length > 0 ? Math.min(...opacityValues) : null,
        maxOpacity: opacityValues.length > 0 ? Math.max(...opacityValues) : null,
        maxTranslateY: translateYValues.length > 0 ? Math.max(...translateYValues.map((value) => Math.abs(value))) : 0,
      });
    };
    new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type === 'attributes') {
          recordAppearance(mutation.target);
          continue;
        }
        for (const node of mutation.addedNodes) {
          recordAppearance(node);
          if (node instanceof Element) {
            for (const row of node.querySelectorAll('[data-testid="turn-process-entry"].turn-process-entry--entering')) {
              recordAppearance(row);
            }
          }
        }
      }
    }).observe(document, {
      attributes: true,
      attributeFilter: ['class'],
      childList: true,
      subtree: true,
    });
  });
}

async function readEntryAppearanceTitles(page) {
  return page.evaluate(() => window.__nextagentProcessEntryAppearances ?? []);
}

async function readEntryAnimationSamples(page) {
  return page.evaluate(() => window.__nextagentProcessEntryAnimationSamples ?? []);
}

async function openHostConversation(page, host) {
  if (host.collaborative) {
    await page.addInitScript(
      ({ key, sessionId }) => {
        window.sessionStorage.setItem(key, sessionId);
      },
      { key: 'nextagent:AICOPIU:activeSessionId', sessionId: SESSION_ID },
    );
  }
  await page.goto(host.url);
  if (host.collaborative) {
    await page.getByTestId('ai-agent-piu-entrance').click();
    await expect(page.getByTestId('ai-agent-piu-panel')).toBeVisible();
  }
}

for (const host of hostModes) {
  test(`${host.name} shows one factual failure reason with expanded safe technical details`, async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    const readEventRequests = await installHistoryFixture(page, { events: failureEventPage() });

    await openHostConversation(page, host);

    await expect.poll(readEventRequests).toBeGreaterThanOrEqual(1);
    const panelToggle = page.getByTestId('turn-process-toggle');
    await expect(panelToggle).toHaveAttribute('aria-expanded', 'false');
    await panelToggle.click();

    const writeTitle = page.getByText(/Write · (未能完成|Could not complete)/u);
    const writeRow = writeTitle.locator('xpath=ancestor::*[@data-testid="turn-process-entry"]');
    const reason = writeRow.getByText(
      /修改文件前需要先完整读取最新内容。|The latest file content must be read completely before it can be modified\./u,
    );
    const writeToggle = writeRow.getByTestId('turn-process-entry-toggle');
    await expect(reason).toHaveCount(1);
    await expect(reason).toBeVisible();
    await expect(writeToggle).toHaveAttribute('aria-expanded', 'true');
    await expect(writeRow.getByTestId('turn-process-entry-detail')).toContainText('WRITE_REQUIRES_FULL_READ');
    await expect(writeRow.getByTestId('turn-process-entry-detail')).toContainText('CONFLICT');
    await expect(page.getByText(/Read · (已完成|Completed)/u)).toBeVisible();

    await writeToggle.click();

    await expect(writeToggle).toHaveAttribute('aria-expanded', 'false');
    await expect(reason).toHaveCount(1);
    const panelText = await page.getByTestId('turn-process-panel').innerText();
    expect(panelText).not.toMatch(/Please read|\/private\/secret|CAPABILITY_STARTED|执行结果：|Execution result:|系统将继续|retry now/u);
    expect(readEventRequests()).toBe(1);
  });

  test(`${host.name} shares process activity, disclosure, viewport, and handoff behavior`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.setViewportSize({ width: 1280, height: 520 });
    await installEntryAppearanceProbe(page);
    const readEventRequests = await installHistoryFixture(page);

    await openHostConversation(page, host);

    await expect.poll(readEventRequests).toBeGreaterThanOrEqual(1);
    const panelToggle = page.getByTestId('turn-process-toggle');
    await expect(panelToggle).toBeVisible();
    await expect(panelToggle).toHaveAttribute('aria-expanded', 'false');
    await expect(page.getByText('Router configuration is compliant.')).toBeVisible();
    expect(readEventRequests()).toBe(1);

    await panelToggle.click();
    await expect(panelToggle).toHaveAttribute('aria-expanded', 'true');
    const historyEntryToggles = page.getByTestId('turn-process-entry-toggle');
    const historyProcessPanel = page.getByTestId('turn-process-panel');
    await expect(historyEntryToggles).toHaveCount(2);
    await expect(historyEntryToggles.nth(1)).toContainText(TOOL_NAME);
    await expect(historyEntryToggles.nth(0)).toHaveAttribute('aria-expanded', 'false');
    await expect(historyEntryToggles.nth(1)).toHaveAttribute('aria-expanded', 'false');
    await expect(historyProcessPanel.getByTestId('turn-process-entry-detail')).toHaveCount(0);
    const historyIconNodes = historyProcessPanel.getByTestId('turn-process-entry-icon-node');
    await expect(historyIconNodes.nth(0).locator('img')).toHaveAttribute('src', /think-light\.svg/);
    await expect(historyIconNodes.nth(1).locator('img')).toHaveAttribute('src', /final-complete-light\.svg/);

    await historyEntryToggles.nth(0).click();
    await expect(historyProcessPanel.getByText(THINKING_TEXT, { exact: true })).toBeVisible();
    await expect(historyEntryToggles.nth(1)).toHaveAttribute('aria-expanded', 'false');
    await historyEntryToggles.nth(1).click();
    await expect(historyProcessPanel.getByText(TOOL_RESULT_TEXT, { exact: true })).toBeVisible();
    expect(readEventRequests()).toBe(1);

    await appendLiveEnvelopes(page, [
      liveEnvelope({
        eventId: 'live-user-accepted',
        sequence: 1,
        eventType: 'REQUEST_ACCEPTED',
        payload: {
          content: 'Run a live router compliance check',
          text: 'Run a live router compliance check',
          contentType: 'PLAIN_TEXT',
          role: 'USER',
          messageId: LIVE_ROOT_MESSAGE_ID,
          rootMessageId: LIVE_ROOT_MESSAGE_ID,
          metadata: { accumulated: true },
          visible: true,
        },
        transportHints: ['local-optimistic'],
      }),
      liveEnvelope({
        eventId: 'live-thinking-active',
        sequence: 2,
        payload: {
          text: LIVE_THINKING_TEXT,
          metadata: { accumulated: true },
        },
        createdAt: '2026-07-22T00:01:01.000Z',
      }),
    ]);

    const liveTurn = page.locator(`[data-root-message-id="${LIVE_ROOT_MESSAGE_ID}"]`);
    const livePanelToggle = liveTurn.getByTestId('turn-process-toggle');
    const liveEntryToggle = liveTurn.getByTestId('turn-process-entry-toggle');
    await expect(livePanelToggle).toHaveAttribute('aria-expanded', 'true');
    await expect(liveEntryToggle).toHaveAttribute('aria-expanded', 'true');
    await expect(liveTurn.getByTestId('turn-process-entry-detail')).toContainText(LIVE_THINKING_TEXT);
    const liveActiveRows = liveTurn.locator('[data-testid="turn-process-entry"][aria-current="step"]');
    await expect(liveActiveRows).toHaveCount(1);
    const liveActiveIcon = liveActiveRows.getByTestId('turn-process-entry-icon-node').locator('img');
    await expect(liveActiveIcon).toHaveAttribute('src', /think-light\.gif/);

    await page.evaluate(() => {
      document.documentElement.setAttribute('data-theme', 'evening');
    });
    await expect(liveActiveIcon).toHaveAttribute('src', /think-dark\.gif/);

    await page.emulateMedia({ reducedMotion: 'reduce' });
    await expect(liveActiveRows).toHaveCount(1);
    await expect(liveActiveIcon).toHaveAttribute('src', /think-dark\.gif/);

    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.evaluate(() => {
      document.documentElement.setAttribute('data-theme', 'lightday');
    });
    await expect(liveActiveIcon).toHaveAttribute('src', /think-light\.gif/);

    await appendLiveEnvelopes(page, [
      liveEnvelope({
        eventId: 'live-thinking-completed',
        sequence: 3,
        payload: {
          text: LIVE_THINKING_TEXT,
          metadata: { accumulated: true, completed: true },
        },
        createdAt: '2026-07-22T00:01:02.000Z',
      }),
    ]);
    await expect(liveEntryToggle).toHaveAttribute('aria-expanded', 'false', { timeout: 500 });
    await expect(liveTurn.getByTestId('turn-process-entry-detail')).toHaveCount(0);
    await expect(liveActiveRows).toHaveCount(0);

    await appendLiveEnvelopes(page, [
      liveEnvelope({
        eventId: 'live-capability-started',
        sequence: 4,
        eventType: 'CAPABILITY_STARTED',
        payload: {
          capabilityId: TOOL_NAME,
          toolCallId: 'live-tool-process-history-e2e',
          toolName: TOOL_NAME,
        },
        createdAt: '2026-07-22T00:01:03.000Z',
      }),
      liveEnvelope({
        eventId: 'live-capability-result',
        sequence: 5,
        eventType: 'CAPABILITY_RESULT_DELTA',
        timelineEventRef: null,
        payload: {
          capabilityId: TOOL_NAME,
          toolCallId: 'live-tool-process-history-e2e',
          toolName: TOOL_NAME,
          role: 'CAPABILITY_RESULT',
          content: LIVE_TOOL_RESULT_TEXT,
          contentType: 'PLAIN_TEXT',
        },
        createdAt: '2026-07-22T00:01:04.000Z',
      }),
    ]);
    const liveEntryToggles = liveTurn.getByTestId('turn-process-entry-toggle');
    const liveProcessPanel = liveTurn.getByTestId('turn-process-panel');
    await expect(liveEntryToggles).toHaveCount(2);
    await expect(liveEntryToggles.nth(1)).toContainText(TOOL_NAME);
    await expect(liveEntryToggles.nth(1)).toHaveAttribute('aria-expanded', 'true');
    await expect(liveProcessPanel.getByText(LIVE_TOOL_RESULT_TEXT, { exact: true })).toBeVisible();
    await expect(liveActiveRows).toHaveCount(1);
    await expect(liveActiveRows.getByTestId('turn-process-entry-title')).toContainText(TOOL_NAME);
    await expect(liveActiveRows.getByTestId('turn-process-entry-icon-node').locator('img')).toHaveAttribute('src', /step-running-animated\.svg/);
    const liveToolRow = liveTurn.getByTestId('turn-process-entry').filter({ hasText: TOOL_NAME });
    await page.waitForTimeout(250);
    await expect(liveToolRow).not.toHaveClass(/turn-process-entry--entering/);
    const appearancesBeforeToolUpdates = (await readEntryAppearanceTitles(page)).length;

    const viewport = page.getByTestId('right-pane-scroll-viewport');
    await expect.poll(() => viewport.evaluate((element) => element.scrollHeight - element.clientHeight)).toBeGreaterThan(80);
    await viewport.dispatchEvent('wheel', { deltaY: -120 });
    await viewport.evaluate((element) => {
      element.scrollTop = Math.max(0, element.scrollHeight - element.clientHeight - 120);
      element.dispatchEvent(new Event('scroll', { bubbles: true }));
    });
    await expect(page.getByTestId('chat-scroll-to-bottom-floating')).toBeVisible();
    const readingScrollTop = await viewport.evaluate((element) => element.scrollTop);

    await appendLiveEnvelopes(page, [
      liveEnvelope({
        eventId: 'live-capability-result-reading-update',
        sequence: 6,
        eventType: 'CAPABILITY_RESULT_DELTA',
        timelineEventRef: null,
        payload: {
          capabilityId: TOOL_NAME,
          toolCallId: 'live-tool-process-history-e2e',
          toolName: TOOL_NAME,
          role: 'CAPABILITY_RESULT',
          content: LIVE_TOOL_RESULT_READING_UPDATE,
          contentType: 'PLAIN_TEXT',
        },
        createdAt: '2026-07-22T00:01:04.500Z',
      }),
    ]);
    await expect(page.getByTestId('chat-scroll-to-bottom-floating')).toBeVisible();
    await expect.poll(() => viewport.evaluate((element) => element.scrollTop)).toBe(readingScrollTop);
    expect((await readEntryAppearanceTitles(page)).length).toBe(appearancesBeforeToolUpdates);

    await page.getByTestId('chat-scroll-to-bottom-floating').click();
    await expect
      .poll(() => viewport.evaluate((element) => Math.abs(element.scrollHeight - element.scrollTop - element.clientHeight)))
      .toBeLessThanOrEqual(4);

    await appendLiveEnvelopes(page, [
      liveEnvelope({
        eventId: 'live-capability-result-following-update',
        sequence: 7,
        eventType: 'CAPABILITY_RESULT_DELTA',
        timelineEventRef: null,
        payload: {
          capabilityId: TOOL_NAME,
          toolCallId: 'live-tool-process-history-e2e',
          toolName: TOOL_NAME,
          role: 'CAPABILITY_RESULT',
          content: LIVE_TOOL_RESULT_FOLLOWING_UPDATE,
          contentType: 'PLAIN_TEXT',
        },
        createdAt: '2026-07-22T00:01:04.750Z',
      }),
    ]);
    await expect
      .poll(() => viewport.evaluate((element) => Math.abs(element.scrollHeight - element.scrollTop - element.clientHeight)))
      .toBeLessThanOrEqual(4);

    await appendLiveEnvelopes(page, [
      liveEnvelope({
        eventId: 'live-capability-completed',
        sequence: 8,
        eventType: 'CAPABILITY_COMPLETED',
        payload: {
          capabilityId: TOOL_NAME,
          toolCallId: 'live-tool-process-history-e2e',
          toolName: TOOL_NAME,
          status: 'SUCCEEDED',
        },
        createdAt: '2026-07-22T00:01:05.000Z',
      }),
    ]);
    await expect(liveEntryToggles.nth(1)).toHaveAttribute('aria-expanded', 'false', { timeout: 500 });
    await expect(liveActiveRows).toHaveCount(0);

    const appearancesBeforeFinalThinking = (await readEntryAppearanceTitles(page)).length;
    await appendLiveEnvelopes(page, [
      liveEnvelope({
        eventId: 'live-final-thinking-active',
        sequence: 9,
        payload: {
          text: LIVE_FINAL_THINKING_TEXT,
          metadata: { accumulated: true },
        },
        createdAt: '2026-07-22T00:01:05.250Z',
      }),
    ]);
    const finalThinkingToggle = liveTurn.getByTestId('turn-process-entry-toggle').nth(2);
    const finalThinkingRow = liveTurn.getByTestId('turn-process-entry').nth(2);
    await expect(liveTurn.getByTestId('turn-process-entry-toggle')).toHaveCount(3);
    await expect(finalThinkingToggle).toHaveAttribute('aria-expanded', 'true');
    await expect(finalThinkingRow).toHaveAttribute('aria-current', 'step');
    await expect.poll(async () => (await readEntryAppearanceTitles(page)).length).toBe(appearancesBeforeFinalThinking + 1);
    const finalThinkingAnimation = (await readEntryAnimationSamples(page)).at(-1);
    expect(finalThinkingAnimation).toMatchObject({
      duration: 200,
      minOpacity: 0,
      maxOpacity: 1,
      maxTranslateY: 4,
    });
    await page.waitForTimeout(250);
    await expect(finalThinkingRow).not.toHaveClass(/turn-process-entry--entering/);

    await appendLiveEnvelopes(page, [
      liveEnvelope({
        eventId: 'live-stage-note',
        sequence: 10,
        eventType: 'LLM_CONTENT_DELTA',
        payload: {
          content: LIVE_STAGE_NOTE_TEXT,
          contentType: 'MARKDOWN',
          metadata: { accumulated: true },
        },
        createdAt: '2026-07-22T00:01:05.500Z',
      }),
    ]);
    await expect(liveTurn.getByText(LIVE_STAGE_NOTE_TEXT, { exact: true })).toBeVisible();
    await expect(livePanelToggle).toHaveAttribute('aria-expanded', 'true');
    await expect(finalThinkingToggle).toHaveAttribute('aria-expanded', 'false');
    await expect(liveActiveRows).toHaveCount(0);

    await appendLiveEnvelopes(page, [
      liveEnvelope({
        eventId: 'live-final-thinking-resumed',
        sequence: 11,
        payload: {
          text: LIVE_FINAL_THINKING_TEXT,
          metadata: { accumulated: true },
        },
        createdAt: '2026-07-22T00:01:05.750Z',
      }),
    ]);
    await expect(livePanelToggle).toHaveAttribute('aria-expanded', 'true');
    await expect(finalThinkingToggle).toHaveAttribute('aria-expanded', 'true');
    await expect(finalThinkingRow).toHaveAttribute('aria-current', 'step');

    await appendLiveEnvelopes(page, [
      liveEnvelope({
        eventId: 'live-final-thinking-completed',
        sequence: 12,
        payload: {
          text: LIVE_FINAL_THINKING_TEXT,
          metadata: { accumulated: true, completed: true },
        },
        createdAt: '2026-07-22T00:01:06.000Z',
      }),
    ]);
    await expect(finalThinkingToggle).toHaveAttribute('aria-expanded', 'false', { timeout: 500 });
    expect((await readEntryAppearanceTitles(page)).length).toBe(appearancesBeforeFinalThinking + 1);

    await appendLiveEnvelopes(page, [
      liveEnvelope({
        eventId: 'live-answer',
        sequence: 13,
        eventType: 'LLM_CONTENT_DELTA',
        payload: {
          content: 'Live router configuration is compliant.',
          contentType: 'MARKDOWN',
          metadata: { accumulated: true },
        },
        createdAt: '2026-07-22T00:01:06.250Z',
      }),
      liveEnvelope({
        eventId: 'live-request-completed',
        sequence: 14,
        eventType: 'REQUEST_COMPLETED',
        payload: { rootMessageId: LIVE_ROOT_MESSAGE_ID },
        createdAt: '2026-07-22T00:01:07.000Z',
      }),
    ]);
    await expect(livePanelToggle).toHaveAttribute('aria-expanded', 'false', { timeout: 2_000 });
    await expect(liveTurn.getByText('Live router configuration is compliant.')).toBeVisible();
    await livePanelToggle.click();
    await expect(livePanelToggle).toHaveAttribute('aria-expanded', 'true');
    await expect(liveEntryToggles).toHaveCount(3);
    await expect(liveEntryToggles.nth(0)).toHaveAttribute('aria-expanded', 'false');
    await expect(liveEntryToggles.nth(1)).toHaveAttribute('aria-expanded', 'false');
    await expect(liveEntryToggles.nth(2)).toHaveAttribute('aria-expanded', 'false');
    await expect(liveProcessPanel.getByTestId('turn-process-entry-detail')).toHaveCount(0);

    await liveEntryToggles.nth(0).click();
    await expect(liveProcessPanel.getByText(LIVE_THINKING_TEXT, { exact: true })).toBeVisible();
    await expect(liveEntryToggles.nth(1)).toHaveAttribute('aria-expanded', 'false');
    await liveEntryToggles.nth(1).click();
    await expect(liveProcessPanel).toContainText('Final verification: no configuration drift was detected.');
    await expect(liveEntryToggles.nth(2)).toHaveAttribute('aria-expanded', 'false');
    await liveEntryToggles.nth(2).click();
    await expect(liveProcessPanel.getByText(LIVE_FINAL_THINKING_TEXT, { exact: true })).toBeVisible();
    expect(readEventRequests()).toBe(1);
  });

  test(`${host.name} suppresses process entry motion for reduced-motion users`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await installEntryAppearanceProbe(page);
    await installHistoryFixture(page);
    await openHostConversation(page, host);

    await appendLiveEnvelopes(page, [
      liveEnvelope({
        eventId: 'live-reduced-user-accepted',
        sequence: 1,
        eventType: 'REQUEST_ACCEPTED',
        payload: {
          content: 'Run a reduced-motion router compliance check',
          text: 'Run a reduced-motion router compliance check',
          contentType: 'PLAIN_TEXT',
          role: 'USER',
          messageId: LIVE_ROOT_MESSAGE_ID,
          rootMessageId: LIVE_ROOT_MESSAGE_ID,
          metadata: { accumulated: true },
          visible: true,
        },
        transportHints: ['local-optimistic'],
      }),
      liveEnvelope({
        eventId: 'live-reduced-thinking',
        sequence: 2,
        payload: {
          text: LIVE_THINKING_TEXT,
          metadata: { accumulated: true, completed: true },
        },
      }),
    ]);
    await appendLiveEnvelopes(page, [
      liveEnvelope({
        eventId: 'live-reduced-capability-started',
        sequence: 3,
        eventType: 'CAPABILITY_STARTED',
        payload: {
          capabilityId: TOOL_NAME,
          toolCallId: 'live-reduced-tool-process-history-e2e',
          toolName: TOOL_NAME,
        },
      }),
    ]);
    await appendLiveEnvelopes(page, [
      liveEnvelope({
        eventId: 'live-reduced-capability-completed',
        sequence: 4,
        eventType: 'CAPABILITY_COMPLETED',
        payload: {
          capabilityId: TOOL_NAME,
          toolCallId: 'live-reduced-tool-process-history-e2e',
          toolName: TOOL_NAME,
          status: 'SUCCEEDED',
        },
      }),
      liveEnvelope({
        eventId: 'live-reduced-final-thinking',
        sequence: 5,
        payload: {
          text: LIVE_FINAL_THINKING_TEXT,
          metadata: { accumulated: true },
        },
      }),
    ]);

    const liveTurn = page.locator(`[data-root-message-id="${LIVE_ROOT_MESSAGE_ID}"]`);
    const finalThinkingRow = liveTurn.getByTestId('turn-process-entry').nth(2);
    await expect(liveTurn.getByTestId('turn-process-entry')).toHaveCount(3);
    await expect(finalThinkingRow).not.toHaveClass(/turn-process-entry--entering/);
    await expect(finalThinkingRow).toHaveAttribute('aria-current', 'step');
    expect(await finalThinkingRow.evaluate((row) => row.getAnimations().length)).toBe(0);
    expect(await readEntryAppearanceTitles(page)).toEqual([]);
    expect(await readEntryAnimationSamples(page)).toEqual([]);
  });
}

test('keeps pending tool-round output in the process bridge from its first visible text', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await installHistoryFixture(page);
  await page.goto(`/#/session/${SESSION_ID}`);
  await expect(page.getByText('Router configuration is compliant.')).toBeVisible();

  await appendLiveEnvelopes(page, [
    liveEnvelope({
      eventId: 'pending-bridge-request-accepted',
      sequence: 1,
      eventType: 'REQUEST_ACCEPTED',
      payload: {
        role: 'USER',
        content: 'Inspect route convergence',
        rootMessageId: LIVE_ROOT_MESSAGE_ID,
        messageId: LIVE_ROOT_MESSAGE_ID,
      },
    }),
    liveEnvelope({
      eventId: 'pending-bridge-thinking',
      sequence: 2,
      payload: {
        text: 'Checking route convergence evidence.',
        metadata: { accumulated: true },
      },
    }),
  ]);

  const liveTurn = page.locator(`[data-root-message-id="${LIVE_ROOT_MESSAGE_ID}"]`);
  const thinkingToggle = liveTurn.getByTestId('turn-process-entry-toggle');
  await expect(thinkingToggle).toHaveAttribute('aria-expanded', 'true');

  await appendLiveEnvelopes(page, [
    liveEnvelope({
      eventId: 'pending-bridge-content',
      sequence: 3,
      eventType: 'LLM_CONTENT_DELTA',
      payload: {
        content: 'I will correlate the route convergence record with the busy-hour load window.',
        contentType: 'MARKDOWN',
        stepId: 'route-convergence-step',
        metadata: { accumulated: true },
      },
    }),
  ]);

  const explanation = liveTurn.getByTestId('turn-process-explanation');
  await expect(explanation).toContainText('I will correlate the route convergence record with the busy-hour load window.');
  await expect(explanation.getByTestId('turn-process-entry-icon-node')).toHaveCount(0);
  await expect(liveTurn.getByTestId('assistant-content-region')).toHaveCount(0);
  await expect(thinkingToggle).toHaveAttribute('aria-expanded', 'false');

  await appendLiveEnvelopes(page, [
    liveEnvelope({
      eventId: 'pending-bridge-content-completed',
      sequence: 4,
      eventType: 'LLM_CONTENT_DELTA',
      payload: {
        content: 'I will correlate the route convergence record with the busy-hour load window.',
        contentType: 'MARKDOWN',
        stepId: 'route-convergence-step',
        completed: true,
        metadata: { accumulated: true, completed: true },
      },
    }),
    liveEnvelope({
      eventId: 'pending-bridge-tool-started',
      sequence: 5,
      eventType: 'CAPABILITY_STARTED',
      payload: {
        capabilityId: 'analyzeRouteConvergence',
        toolCallId: 'pending-bridge-tool',
        toolName: 'analyzeRouteConvergence',
      },
    }),
  ]);

  await expect(explanation).toHaveCount(1);
  await expect(liveTurn.getByText('analyzeRouteConvergence · Running', { exact: true })).toBeVisible();
  await expect(liveTurn.getByRole('button', { name: 'analyzeRouteConvergence · Running', exact: true })).toHaveCount(0);
  await expect(liveTurn.getByTestId('assistant-content-region')).toHaveCount(0);
});

test('hands pending output to the existing final-answer alignment without typography or opacity changes', async ({ page }) => {
  await installHistoryFixture(page);
  await page.goto(`/#/session/${SESSION_ID}`);
  await expect(page.getByText('Router configuration is compliant.')).toBeVisible();

  const pendingContent = [
    'The backbone latency check is complete.',
    'No sustained high-latency condition was detected, and the inspected links returned to the approved range.',
  ].join('\n\n');
  await appendLiveEnvelopes(page, [
    liveEnvelope({
      eventId: 'pending-answer-request-accepted',
      sequence: 1,
      eventType: 'REQUEST_ACCEPTED',
      payload: {
        role: 'USER',
        content: 'Inspect backbone latency',
        rootMessageId: LIVE_ROOT_MESSAGE_ID,
        messageId: LIVE_ROOT_MESSAGE_ID,
      },
    }),
    liveEnvelope({
      eventId: 'pending-answer-content',
      sequence: 2,
      eventType: 'LLM_CONTENT_DELTA',
      payload: {
        content: pendingContent,
        contentType: 'MARKDOWN',
        stepId: 'backbone-latency-final-step',
        metadata: { accumulated: true },
      },
    }),
  ]);

  const liveTurn = page.locator(`[data-root-message-id="${LIVE_ROOT_MESSAGE_ID}"]`);
  const explanationDetail = liveTurn.getByTestId('turn-process-explanation');
  await expect(explanationDetail).toContainText('The backbone latency check is complete.');
  const pendingPresentation = await explanationDetail.evaluate((element) => {
    const markdown = element.querySelector('.markdown-content');
    const style = getComputedStyle(markdown ?? element);
    const regionStyle = getComputedStyle(element);
    return {
      fontSize: style.fontSize,
      lineHeight: style.lineHeight,
      color: style.color,
      backgroundColor: regionStyle.backgroundColor,
    };
  });

  await appendLiveEnvelopes(page, [
    liveEnvelope({
      eventId: 'pending-answer-final',
      sequence: 3,
      eventType: 'LLM_CONTENT_DELTA',
      payload: {
        content: pendingContent,
        contentType: 'MARKDOWN',
        final: true,
        metadata: { accumulated: true },
      },
    }),
  ]);

  const answerRegion = liveTurn.getByTestId('assistant-content-region');
  await expect(answerRegion).toHaveAttribute('data-process-output-handoff', 'true');
  await expect(answerRegion).toContainText('The backbone latency check is complete.');
  await expect(answerRegion).not.toHaveClass(/turn-answer--handoff-from-process/);
  const handoffPresentation = await answerRegion.evaluate((element) => {
    const markdown = element.querySelector('.markdown-content');
    const style = getComputedStyle(markdown ?? element);
    const regionStyle = getComputedStyle(element);
    const bounds = element.getBoundingClientRect();
    const bubbleBounds = element.closest('[data-testid="ai-bubble"]')?.getBoundingClientRect();
    return {
      fontSize: style.fontSize,
      lineHeight: style.lineHeight,
      color: style.color,
      opacity: regionStyle.opacity,
      animationName: regionStyle.animationName,
      left: bounds.left - (bubbleBounds?.left ?? 0),
      right: bounds.right - (bubbleBounds?.left ?? 0),
      width: bounds.width,
    };
  });

  expect(handoffPresentation.fontSize).toBe(pendingPresentation.fontSize);
  expect(handoffPresentation.lineHeight).toBe(pendingPresentation.lineHeight);
  expect(handoffPresentation.color).toBe(pendingPresentation.color);
  expect(pendingPresentation.backgroundColor).toBe('rgba(0, 0, 0, 0)');
  expect(handoffPresentation.opacity).toBe('1');
  expect(handoffPresentation.animationName).toBe('none');

  await page.waitForTimeout(220);
  const historyTurn = page.locator(`[data-root-message-id="${ROOT_MESSAGE_ID}"]`);
  const stableBounds = await answerRegion.evaluate((element) => {
    const bounds = element.getBoundingClientRect();
    const bubble = element.closest('[data-testid="ai-bubble"]');
    const bubbleLeft = bubble?.getBoundingClientRect().left ?? 0;
    return {
      left: bounds.left - bubbleLeft,
      right: bounds.right - bubbleLeft,
      width: bounds.width,
    };
  });
  const existingAlignment = await historyTurn.getByTestId('assistant-content-region').evaluate((element) => {
    const bubble = element.closest('[data-testid="ai-bubble"]');
    return element.getBoundingClientRect().left - (bubble?.getBoundingClientRect().left ?? 0);
  });
  expect(stableBounds.left).toBeCloseTo(handoffPresentation.left, 1);
  expect(stableBounds.right).toBeCloseTo(handoffPresentation.right, 1);
  expect(stableBounds.width).toBeCloseTo(handoffPresentation.width, 1);
  expect(stableBounds.left).toBeCloseTo(existingAlignment, 1);

  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.reload();
  await expect(page.getByText('Router configuration is compliant.')).toBeVisible();
  await appendLiveEnvelopes(page, [
    liveEnvelope({
      eventId: 'reduced-pending-answer-request-accepted',
      sequence: 1,
      eventType: 'REQUEST_ACCEPTED',
      payload: {
        role: 'USER',
        content: 'Inspect backbone latency',
        rootMessageId: LIVE_ROOT_MESSAGE_ID,
        messageId: LIVE_ROOT_MESSAGE_ID,
      },
    }),
    liveEnvelope({
      eventId: 'reduced-pending-answer-content',
      sequence: 2,
      eventType: 'LLM_CONTENT_DELTA',
      payload: {
        content: pendingContent,
        contentType: 'MARKDOWN',
        stepId: 'backbone-latency-final-step',
        metadata: { accumulated: true },
      },
    }),
    liveEnvelope({
      eventId: 'reduced-pending-answer-final',
      sequence: 3,
      eventType: 'LLM_CONTENT_DELTA',
      payload: {
        content: pendingContent,
        contentType: 'MARKDOWN',
        final: true,
        metadata: { accumulated: true },
      },
    }),
  ]);

  const reducedMotionAnswer = page.locator(`[data-root-message-id="${LIVE_ROOT_MESSAGE_ID}"]`).getByTestId('assistant-content-region');
  await expect(reducedMotionAnswer).toHaveAttribute('data-process-output-handoff', 'true');
  await expect(reducedMotionAnswer).not.toHaveClass(/turn-answer--handoff-from-process/);
  await expect(reducedMotionAnswer).toHaveCSS('animation-name', 'none');
});

test('bounds a 200-turn multi-thinking and multi-tool history journey', async ({ page }) => {
  test.setTimeout(90_000);
  const turnCount = 200;
  const requestedRuns = new Set();
  const requestCountByRun = new Map();
  let activeEventRequests = 0;
  let peakEventRequests = 0;
  const messageItems = Array.from({ length: turnCount }, (_, index) => {
    const ordinal = index + 1;
    const rootMessageId = `root-long-${ordinal}`;
    const runId = `run-long-${ordinal}`;
    const requestId = `request-long-${ordinal}`;
    const common = {
      sessionId: SESSION_ID,
      requestId,
      runId,
      requestContextId: `context-long-${ordinal}`,
      rootMessageId,
      contentType: 'PLAIN_TEXT',
      visible: true,
    };
    return [
      {
        ...common,
        messageId: rootMessageId,
        role: 'USER',
        sequence: index * 4 + 1,
        content: `Long history question ${ordinal}`,
        metadata: {},
        createdAt: `2026-07-22T01:${String(index % 60).padStart(2, '0')}:00.000Z`,
      },
      {
        ...common,
        messageId: `capability-a-long-${ordinal}`,
        role: 'CAPABILITY_RESULT',
        sequence: index * 4 + 2,
        content: `Interface audit result ${ordinal}`,
        metadata: {
          kind: 'CAPABILITY_RESULT',
          toolCallId: `tool-a-long-${ordinal}`,
          toolName: 'interfaceAudit',
        },
        createdAt: `2026-07-22T01:${String(index % 60).padStart(2, '0')}:01.000Z`,
      },
      {
        ...common,
        messageId: `capability-b-long-${ordinal}`,
        role: 'CAPABILITY_RESULT',
        sequence: index * 4 + 3,
        content: `Route audit result ${ordinal}`,
        metadata: {
          kind: 'CAPABILITY_RESULT',
          toolCallId: `tool-b-long-${ordinal}`,
          toolName: 'routeAudit',
        },
        createdAt: `2026-07-22T01:${String(index % 60).padStart(2, '0')}:02.000Z`,
      },
      {
        ...common,
        messageId: `assistant-long-${ordinal}`,
        role: 'ASSISTANT',
        sequence: index * 4 + 4,
        content: `Long history answer ${ordinal}`,
        contentType: 'MARKDOWN',
        metadata: { eventType: 'REQUEST_COMPLETED', status: 'COMPLETED' },
        createdAt: `2026-07-22T01:${String(index % 60).padStart(2, '0')}:03.000Z`,
      },
    ];
  }).flat();

  const eventItems = (ordinal) => {
    const runId = `run-long-${ordinal}`;
    const rootMessageId = `root-long-${ordinal}`;
    const requestId = `request-long-${ordinal}`;
    const base = {
      sessionId: SESSION_ID,
      requestId,
      runId,
      rootMessageId,
      requestContextId: `context-long-${ordinal}`,
      transportHints: [],
    };
    return [
      {
        ...base,
        eventId: `thinking-a-long-${ordinal}`,
        sequence: 1,
        eventType: 'LLM_THINKING_DELTA',
        timelineEventRef: `timeline-thinking-a-long-${ordinal}`,
        payload: {
          text: `Planning reasoning ${ordinal}`,
          metadata: { accumulated: true, completed: true },
        },
        createdAt: '2026-07-22T01:00:00.100Z',
      },
      {
        ...base,
        eventId: `tool-a-start-long-${ordinal}`,
        sequence: 2,
        eventType: 'CAPABILITY_STARTED',
        timelineEventRef: `timeline-tool-a-start-long-${ordinal}`,
        payload: {
          messageId: `assistant-tool-use-a-long-${ordinal}`,
          capabilityId: 'interfaceAudit',
          toolCallId: `tool-a-long-${ordinal}`,
          toolName: 'interfaceAudit',
        },
        createdAt: '2026-07-22T01:00:00.200Z',
      },
      {
        ...base,
        eventId: `tool-a-complete-long-${ordinal}`,
        sequence: 3,
        eventType: 'CAPABILITY_COMPLETED',
        timelineEventRef: `timeline-tool-a-complete-long-${ordinal}`,
        payload: {
          messageId: `capability-a-long-${ordinal}`,
          capabilityId: 'interfaceAudit',
          toolCallId: `tool-a-long-${ordinal}`,
          toolName: 'interfaceAudit',
          status: 'SUCCEEDED',
          content: `Interface audit result ${ordinal}`,
          text: `Interface audit result ${ordinal}`,
        },
        createdAt: '2026-07-22T01:00:00.300Z',
      },
      {
        ...base,
        eventId: `thinking-b-long-${ordinal}`,
        sequence: 4,
        eventType: 'LLM_THINKING_DELTA',
        timelineEventRef: `timeline-thinking-b-long-${ordinal}`,
        payload: {
          text: `Validation reasoning ${ordinal}`,
          metadata: { accumulated: true, completed: true },
        },
        createdAt: '2026-07-22T01:00:00.400Z',
      },
      {
        ...base,
        eventId: `tool-b-start-long-${ordinal}`,
        sequence: 5,
        eventType: 'CAPABILITY_STARTED',
        timelineEventRef: `timeline-tool-b-start-long-${ordinal}`,
        payload: {
          messageId: `assistant-tool-use-b-long-${ordinal}`,
          capabilityId: 'routeAudit',
          toolCallId: `tool-b-long-${ordinal}`,
          toolName: 'routeAudit',
        },
        createdAt: '2026-07-22T01:00:00.500Z',
      },
      {
        ...base,
        eventId: `tool-b-complete-long-${ordinal}`,
        sequence: 6,
        eventType: 'CAPABILITY_COMPLETED',
        timelineEventRef: `timeline-tool-b-complete-long-${ordinal}`,
        payload: {
          messageId: `capability-b-long-${ordinal}`,
          capabilityId: 'routeAudit',
          toolCallId: `tool-b-long-${ordinal}`,
          toolName: 'routeAudit',
          status: 'SUCCEEDED',
          content: `Route audit result ${ordinal}`,
          text: `Route audit result ${ordinal}`,
        },
        createdAt: '2026-07-22T01:00:00.600Z',
      },
    ];
  };

  await page.route('**/api/v1/sessions/**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === `/api/v1/sessions/${SESSION_ID}/conversation/preview`) {
      const offset = Number(url.searchParams.get('offset') || 0);
      const limit = Number(url.searchParams.get('limit') || 100);
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          sessionId: SESSION_ID,
          totalMarkers: turnCount,
          offset,
          limit,
          markers: Array.from({ length: Math.max(0, Math.min(limit, turnCount - offset)) }, (_, markerIndex) => {
            const ordinal = offset + markerIndex + 1;
            return {
              messageId: `root-long-${ordinal}`,
              requestId: `request-long-${ordinal}`,
              createdAt: '2026-07-22T01:00:00.000Z',
              previewText: `Long history question ${ordinal}`,
              previewTruncated: false,
              answerPreviewText: `Long history answer ${ordinal}`,
              answerPreviewTruncated: false,
            };
          }),
        }),
      });
      return;
    }
    if (url.pathname === `/api/v1/sessions/${SESSION_ID}/conversation`) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ sessionId: SESSION_ID, items: messageItems, nextCursor: null }),
      });
      return;
    }
    if (url.pathname === `/api/v1/sessions/${SECOND_SESSION_ID}/conversation`) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          sessionId: SECOND_SESSION_ID,
          items: [
            {
              messageId: 'root-second-session',
              sessionId: SECOND_SESSION_ID,
              requestId: 'request-second-session',
              runId: 'run-second-session',
              requestContextId: 'context-second-session',
              rootMessageId: 'root-second-session',
              role: 'USER',
              sequence: 1,
              content: 'Second session question',
              contentType: 'PLAIN_TEXT',
              metadata: {},
              createdAt: '2026-07-22T02:00:00.000Z',
              visible: true,
            },
            {
              messageId: 'answer-second-session',
              sessionId: SECOND_SESSION_ID,
              requestId: 'request-second-session',
              runId: 'run-second-session',
              requestContextId: 'context-second-session',
              rootMessageId: 'root-second-session',
              role: 'ASSISTANT',
              sequence: 2,
              content: 'Second session answer',
              contentType: 'MARKDOWN',
              metadata: {},
              createdAt: '2026-07-22T02:00:01.000Z',
              visible: true,
            },
          ],
          nextCursor: null,
        }),
      });
      return;
    }
    if (url.pathname === `/api/v1/sessions/${SECOND_SESSION_ID}/runs/run-second-session/events`) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ availability: 'AVAILABLE', events: [] }),
      });
      return;
    }
    const runMatch = url.pathname.match(new RegExp(`^/api/v1/sessions/${SESSION_ID}/runs/run-long-(\\d+)/events$`));
    if (runMatch) {
      const ordinal = Number(runMatch[1]);
      requestedRuns.add(`run-long-${ordinal}`);
      requestCountByRun.set(`run-long-${ordinal}`, (requestCountByRun.get(`run-long-${ordinal}`) ?? 0) + 1);
      activeEventRequests += 1;
      peakEventRequests = Math.max(peakEventRequests, activeEventRequests);
      await new Promise((resolve) => setTimeout(resolve, 40));
      activeEventRequests -= 1;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ availability: 'AVAILABLE', events: eventItems(ordinal) }),
      });
      return;
    }
    if (url.pathname === `/api/v1/sessions/${SESSION_ID}/annotations`) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ annotations: [] }),
      });
      return;
    }
    if (url.pathname === `/api/v1/sessions/${SESSION_ID}/stream`) {
      await new Promise(() => {});
      return;
    }
    await route.fulfill({
      status: 404,
      contentType: 'application/json',
      body: JSON.stringify({ code: 'NOT_FOUND' }),
    });
  });
  await page.route('**/api/v1/sessions?**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ entries: [], offset: 0, limit: 50, hasMore: false }),
    });
  });

  await page.goto(`/#/session/${SESSION_ID}`);
  await expect(page.getByText('Long history answer 200', { exact: true })).toBeVisible();
  await expect.poll(() => requestedRuns.size).toBeGreaterThanOrEqual(4);
  await page.waitForTimeout(100);
  expect(requestedRuns.size).toBeLessThanOrEqual(16);

  const requestsBeforeHover = requestedRuns.size;
  const latestMarker = page.getByRole('button', {
    name: 'Long history question 200',
    exact: true,
  });
  await latestMarker.hover();
  await page.waitForTimeout(150);
  expect(requestedRuns.size).toBe(requestsBeforeHover);
  await latestMarker.click();
  await expect(page.locator('[data-root-message-id="root-long-200"]').getByText('Long history answer 200', { exact: true })).toBeVisible();

  await page.reload();
  await expect(page.locator('[data-root-message-id="root-long-200"]').getByText('Long history answer 200', { exact: true })).toBeVisible();
  const refreshedLatestTurn = page.locator('[data-root-message-id="root-long-200"]');
  await refreshedLatestTurn.scrollIntoViewIfNeeded();
  await expect.poll(() => requestCountByRun.get('run-long-200') ?? 0).toBeGreaterThanOrEqual(2);
  const refreshedLatestToggle = refreshedLatestTurn.getByTestId('turn-process-toggle');
  await expect(refreshedLatestToggle).toBeVisible();
  if ((await refreshedLatestToggle.getAttribute('aria-expanded')) !== 'true') {
    await refreshedLatestToggle.click();
  }
  await expect(refreshedLatestTurn.getByTestId('turn-process-entry-toggle')).toHaveCount(4);

  const viewport = page.getByTestId('right-pane-scroll-viewport');
  await viewport.dispatchEvent('pointerdown', { pointerId: 1 });
  await viewport.evaluate((element) => {
    element.scrollTop = 0;
    element.dispatchEvent(new Event('scroll', { bubbles: true }));
  });
  await page.evaluate(() => {
    window.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1, bubbles: true }));
  });
  await viewport.dispatchEvent('wheel', { deltaY: -120 });
  await expect.poll(() => requestedRuns.has('run-long-1')).toBe(true);

  const firstTurn = page.locator('[data-root-message-id="root-long-1"]');
  await expect(firstTurn.getByText('Long history answer 1', { exact: true })).toBeVisible();
  await page.waitForTimeout(1_000);
  const processToggle = firstTurn.getByTestId('turn-process-toggle');
  await expect(processToggle).toBeVisible();
  await processToggle.click();
  const entryToggles = firstTurn.getByTestId('turn-process-entry-toggle');
  await expect(entryToggles).toHaveCount(4);
  const thinkingToggles = entryToggles.filter({ hasText: 'Thinking' });
  await expect(thinkingToggles).toHaveCount(2);
  const processPanel = firstTurn.getByTestId('turn-process-panel');
  await thinkingToggles.nth(0).click();
  await expect(processPanel).toContainText('Planning reasoning 1');
  await thinkingToggles.nth(1).click();
  await expect(processPanel).toContainText('Validation reasoning 1');
  await entryToggles.filter({ hasText: 'interfaceAudit' }).click();
  await expect(processPanel).toContainText('Interface audit result 1');
  await entryToggles.filter({ hasText: 'routeAudit' }).click();
  await expect(processPanel).toContainText('Route audit result 1');
  expect(peakEventRequests).toBeLessThanOrEqual(4);
  expect(requestedRuns.size).toBeLessThan(turnCount);

  const runOneRequestsBeforeEviction = requestCountByRun.get('run-long-1') ?? 0;
  await viewport.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
    element.dispatchEvent(new Event('scroll', { bubbles: true }));
  });
  await viewport.dispatchEvent('wheel', { deltaY: 120 });
  await expect(page.locator('[data-root-message-id="root-long-200"]').getByText('Long history answer 200', { exact: true })).toBeVisible();
  await page.waitForTimeout(200);
  for (let ordinal = 195; ordinal >= 5; ordinal -= 5) {
    const checkpointTurn = page.locator(`[data-root-message-id="root-long-${ordinal}"]`);
    await checkpointTurn.scrollIntoViewIfNeeded();
    await viewport.dispatchEvent('wheel', { deltaY: -120 });
    await expect.poll(() => requestedRuns.has(`run-long-${ordinal}`)).toBe(true);
    await expect(checkpointTurn.getByTestId('turn-process-toggle')).toBeVisible();
  }
  expect(requestedRuns.size).toBeGreaterThanOrEqual(70);
  await viewport.evaluate((element) => {
    element.scrollTop = 0;
    element.dispatchEvent(new Event('scroll', { bubbles: true }));
  });
  await expect.poll(() => requestCountByRun.get('run-long-1') ?? 0).toBe(runOneRequestsBeforeEviction + 1);
  const revisitedFirstTurn = page.locator('[data-root-message-id="root-long-1"]');
  await expect(revisitedFirstTurn.getByTestId('turn-process-toggle')).toHaveAttribute('aria-expanded', 'true');

  await page.goto(`/#/session/${SECOND_SESSION_ID}`);
  await expect(page.getByText('Second session answer', { exact: true })).toBeVisible();
  await page.goto(`/#/session/${SESSION_ID}`);
  await expect(page.getByText('Long history answer 200', { exact: true })).toBeVisible();
  const explicitProbePage = await page.context().newPage();
  try {
    await runExplicitPanelDemandJourney(explicitProbePage);
  } finally {
    await explicitProbePage.close();
  }
});

async function runExplicitPanelDemandJourney(page) {
  await page.unrouteAll({ behavior: 'ignoreErrors' });
  const sessionId = 'session-process-history-explicit-probe';
  const startedRunIds = [];
  const heldRoutes = [];
  let activeRequests = 0;
  let peakActiveRequests = 0;
  const items = Array.from({ length: 21 }, (_, index) => {
    const ordinal = index + 1;
    const rootMessageId = `root-explicit-${ordinal}`;
    const runId = `run-explicit-${ordinal}`;
    const common = {
      sessionId,
      requestId: `request-explicit-${ordinal}`,
      runId,
      requestContextId: `context-explicit-${ordinal}`,
      rootMessageId,
      contentType: 'PLAIN_TEXT',
      visible: true,
    };
    return [
      {
        ...common,
        messageId: rootMessageId,
        role: 'USER',
        sequence: index * 2 + 1,
        content: `Explicit question ${ordinal}`,
        metadata: {},
        createdAt: `2026-07-22T03:00:${String(index).padStart(2, '0')}.000Z`,
      },
      {
        ...common,
        messageId: `answer-explicit-${ordinal}`,
        role: 'ASSISTANT',
        sequence: index * 2 + 2,
        content: `Explicit answer ${ordinal}`,
        contentType: 'MARKDOWN',
        metadata: {},
        createdAt: `2026-07-22T03:00:${String(index).padStart(2, '0')}.200Z`,
      },
    ];
  }).flat();

  await page.addInitScript(() => {
    class NonIntersectingObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
      takeRecords() {
        return [];
      }
      root = null;
      rootMargin = '0px';
      thresholds = [0];
    }
    window.IntersectionObserver = NonIntersectingObserver;
  });
  await page.route('**/api/v1/sessions/**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === `/api/v1/sessions/${sessionId}/conversation`) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ sessionId, items, nextCursor: null }),
      });
      return;
    }
    if (url.pathname.startsWith(`/api/v1/sessions/${sessionId}/runs/`) && url.pathname.endsWith('/events')) {
      startedRunIds.push(url.pathname.split('/').at(-2));
      activeRequests += 1;
      peakActiveRequests = Math.max(peakActiveRequests, activeRequests);
      heldRoutes.push(route);
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
    await route.fulfill({
      status: 404,
      contentType: 'application/json',
      body: JSON.stringify({ code: 'NOT_FOUND' }),
    });
  });
  await page.route('**/api/v1/sessions?**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ entries: [], offset: 0, limit: 50, hasMore: false }),
    });
  });

  await page.goto(`/#/session/${sessionId}`);
  await expect(page.getByText('Explicit answer 21', { exact: true })).toBeVisible();
  await page.evaluate(
    async ({ targetSessionId, targetCount }) => {
      const { useConversationStore } = await import('/src/state/conversationStore.ts');
      for (let ordinal = 1; ordinal <= targetCount; ordinal += 1) {
        useConversationStore.getState().setExplicitProcessHistoryTarget(targetSessionId, `capacity-probe:${ordinal}`, {
          sessionId: targetSessionId,
          rootMessageId: `root-explicit-${ordinal}`,
          runId: `run-explicit-${ordinal}`,
          priority: 'EXPLICIT',
          distanceFromViewportCenter: 0,
        });
      }
    },
    { targetSessionId: sessionId, targetCount: 21 },
  );
  await expect.poll(() => startedRunIds.length).toBe(4);

  while (startedRunIds.length < 20) {
    const batch = heldRoutes.splice(0);
    const startedBeforeRelease = startedRunIds.length;
    activeRequests -= batch.length;
    await Promise.all(
      batch.map((route) =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ availability: 'AVAILABLE', events: [] }),
        }),
      ),
    );
    await expect.poll(() => startedRunIds.length).toBeGreaterThan(startedBeforeRelease);
  }
  expect(startedRunIds.slice(4)).toEqual([
    'run-explicit-21',
    'run-explicit-20',
    'run-explicit-19',
    'run-explicit-18',
    'run-explicit-17',
    'run-explicit-16',
    'run-explicit-15',
    'run-explicit-14',
    'run-explicit-13',
    'run-explicit-12',
    'run-explicit-11',
    'run-explicit-10',
    'run-explicit-9',
    'run-explicit-8',
    'run-explicit-7',
    'run-explicit-6',
  ]);
  expect(startedRunIds).not.toContain('run-explicit-5');
  expect(peakActiveRequests).toBeLessThanOrEqual(4);
  const finalBatch = heldRoutes.splice(0);
  activeRequests -= finalBatch.length;
  await Promise.all(
    finalBatch.map((route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ availability: 'AVAILABLE', events: [] }),
      }),
    ),
  );
}
