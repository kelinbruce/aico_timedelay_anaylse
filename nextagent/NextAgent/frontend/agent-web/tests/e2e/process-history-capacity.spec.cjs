const { expect, test } = require('@playwright/test');

test.describe.configure({ mode: 'default' });

const SESSION_ID = 'session-process-history-capacity';
const TURN_COUNT = 10_000;
const PREVIEW_ROW_HEIGHT = 12;
const DETAILED_PROCESS_ENTRY_COUNT = 500;
const DETAILED_RUN_ORDINALS = new Set([2_500, 5_000, 7_500, 9_000, TURN_COUNT]);

test('keeps 10,000-turn process-history navigation bounded across rapid preview inputs', async ({ page }) => {
  const eventRequests = [];
  const anchorRequests = [];
  let activeEventRequests = 0;
  let peakEventRequests = 0;
  let unexpectedAssociationRequests = 0;

  await page.route('**/api/v1/sessions/**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === `/api/v1/sessions/${SESSION_ID}/conversation/preview`) {
      const offset = Number(url.searchParams.get('offset') ?? Math.max(0, TURN_COUNT - 100));
      const limit = Number(url.searchParams.get('limit') ?? 100);
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          sessionId: SESSION_ID,
          totalMarkers: TURN_COUNT,
          offset,
          limit,
          markers: Array.from({ length: Math.max(0, Math.min(limit, TURN_COUNT - offset)) }, (_, index) => previewMarker(offset + index + 1)),
        }),
      });
      return;
    }
    if (url.pathname === `/api/v1/sessions/${SESSION_ID}/conversation`) {
      const anchor = url.searchParams.get('anchorMessageId');
      const ordinal = anchor === null ? TURN_COUNT : readOrdinal(anchor);
      if (anchor !== null) {
        anchorRequests.push(ordinal);
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(conversationPage(ordinal)),
      });
      return;
    }
    const eventMatch = new RegExp(`^/api/v1/sessions/${SESSION_ID}/runs/run-capacity-(\\d+)/events$`).exec(url.pathname);
    if (eventMatch) {
      const ordinal = Number(eventMatch[1]);
      eventRequests.push(ordinal);
      activeEventRequests += 1;
      peakEventRequests = Math.max(peakEventRequests, activeEventRequests);
      await new Promise((resolve) => setTimeout(resolve, 35));
      activeEventRequests -= 1;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(eventPage(ordinal)),
      });
      return;
    }
    if (url.pathname.includes('process-message') || url.pathname.includes('/messages/resolve')) {
      unexpectedAssociationRequests += 1;
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
  await expect(page.getByText(`Capacity answer ${TURN_COUNT}`, { exact: true })).toBeVisible();
  const latestTurn = page.locator(`[data-root-message-id="root-capacity-${TURN_COUNT}"]`);
  const latestProcessToggle = latestTurn.getByTestId('turn-process-toggle');
  await expect(latestProcessToggle).toBeVisible();
  if ((await latestProcessToggle.getAttribute('aria-expanded')) !== 'true') {
    await latestProcessToggle.click();
  }
  await expect(latestTurn.getByTestId('turn-process-entry')).toHaveCount(DETAILED_PROCESS_ENTRY_COUNT);
  await latestProcessToggle.click();
  const rail = page.getByTestId('conversation-preview-rail');
  await expect(rail).toBeVisible();

  const requestBatchSizes = [];
  let previousRequestedRunCount = new Set(eventRequests).size;
  await navigatePreviewRail(page, rail, 2_500, 'click');
  requestBatchSizes.push(new Set(eventRequests).size - previousRequestedRunCount);
  previousRequestedRunCount = new Set(eventRequests).size;
  await navigatePreviewRail(page, rail, 7_500, 'drag');
  requestBatchSizes.push(new Set(eventRequests).size - previousRequestedRunCount);
  previousRequestedRunCount = new Set(eventRequests).size;
  await navigatePreviewRail(page, rail, 5_000, 'track');
  requestBatchSizes.push(new Set(eventRequests).size - previousRequestedRunCount);
  previousRequestedRunCount = new Set(eventRequests).size;
  await navigatePreviewRail(page, rail, 9_000, 'wheel');
  requestBatchSizes.push(new Set(eventRequests).size - previousRequestedRunCount);

  await expect.poll(() => anchorRequests.at(-1)).toBe(9_000);
  await expect(page.locator('[data-root-message-id="root-capacity-9000"]').getByText('Capacity answer 9000', { exact: true })).toBeVisible();
  await page.waitForTimeout(250);

  expect(anchorRequests).toEqual(expect.arrayContaining([2_500, 7_500, 9_000]));
  expect(anchorRequests.some((ordinal) => ordinal === 4_999 || ordinal === 5_000)).toBe(true);
  expect(peakEventRequests).toBeLessThanOrEqual(4);
  expect(requestBatchSizes.every((size) => size <= 16)).toBe(true);
  expect(new Set(eventRequests).size).toBeLessThanOrEqual(16 * requestBatchSizes.length);
  expect(unexpectedAssociationRequests).toBe(0);
  await expect(page.getByTestId('right-pane-scroll-viewport')).toBeVisible();
});

async function navigatePreviewRail(page, rail, ordinal, interaction) {
  const targetScrollTop = Math.max(0, (ordinal - 1) * PREVIEW_ROW_HEIGHT - 120);
  if (interaction === 'drag') {
    await rail.dispatchEvent('pointerdown', { pointerId: 1 });
  }
  await rail.evaluate((element, scrollTop) => {
    element.scrollTop = scrollTop;
    element.dispatchEvent(new Event('scroll', { bubbles: true }));
  }, targetScrollTop);
  if (interaction === 'drag') {
    await page.evaluate(() => {
      window.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1, bubbles: true }));
    });
  } else if (interaction === 'wheel') {
    await rail.dispatchEvent('wheel', { deltaY: -480 });
  } else if (interaction === 'track') {
    await rail.click({ position: { x: 2, y: 120 }, force: true });
  }
  const marker = page.getByRole('button', {
    name: `Capacity question ${ordinal}`,
    exact: true,
  });
  await expect(marker).toBeVisible();
  await marker.click();
  await expect(
    page.locator(`[data-root-message-id="root-capacity-${ordinal}"]`).getByText(`Capacity answer ${ordinal}`, { exact: true }),
  ).toBeVisible();
}

function previewMarker(ordinal) {
  return {
    messageId: `root-capacity-${ordinal}`,
    requestId: `request-capacity-${ordinal}`,
    createdAt: '2026-07-29T00:00:00.000Z',
    previewText: `Capacity question ${ordinal}`,
    previewTruncated: false,
    answerPreviewText: `Capacity answer ${ordinal}`,
    answerPreviewTruncated: false,
  };
}

function conversationPage(centerOrdinal) {
  const first = Math.max(1, Math.min(TURN_COUNT - 20, centerOrdinal - 10));
  const items = [];
  for (let ordinal = first; ordinal <= first + 20; ordinal += 1) {
    items.push(...turnMessages(ordinal));
  }
  return {
    sessionId: SESSION_ID,
    items,
    nextCursor: first > 1 ? `older-${first}` : null,
    newerCursor: first + 20 < TURN_COUNT ? `newer-${first + 20}` : null,
  };
}

function turnMessages(ordinal) {
  const common = {
    sessionId: SESSION_ID,
    requestId: `request-capacity-${ordinal}`,
    runId: `run-capacity-${ordinal}`,
    requestContextId: `context-capacity-${ordinal}`,
    rootMessageId: `root-capacity-${ordinal}`,
    contentType: 'PLAIN_TEXT',
    visible: true,
  };
  return [
    {
      ...common,
      messageId: common.rootMessageId,
      role: 'USER',
      sequence: ordinal * 2 - 1,
      content: `Capacity question ${ordinal}`,
      metadata: {},
      createdAt: '2026-07-29T00:00:00.000Z',
    },
    {
      ...common,
      messageId: `answer-capacity-${ordinal}`,
      role: 'ASSISTANT',
      sequence: ordinal * 2,
      content: `Capacity answer ${ordinal}`,
      contentType: 'MARKDOWN',
      metadata: { eventType: 'REQUEST_COMPLETED', status: 'COMPLETED' },
      createdAt: '2026-07-29T00:00:00.300Z',
    },
  ];
}

function eventPage(ordinal) {
  const common = {
    sessionId: SESSION_ID,
    requestId: `request-capacity-${ordinal}`,
    runId: `run-capacity-${ordinal}`,
    requestContextId: `context-capacity-${ordinal}`,
    rootMessageId: `root-capacity-${ordinal}`,
    transportHints: [],
    createdAt: '2026-07-29T00:00:00.100Z',
  };
  if (DETAILED_RUN_ORDINALS.has(ordinal)) {
    return {
      availability: 'AVAILABLE',
      events: Array.from({ length: DETAILED_PROCESS_ENTRY_COUNT / 2 }, (_, index) => {
        const step = index + 1;
        const toolCallId = `probe-${step}-capacity-${ordinal}`;
        const sequence = index * 4;
        const capability = capacityCapability(step);
        return [
          {
            ...common,
            eventId: `thinking-${step}-capacity-${ordinal}`,
            sequence: sequence + 1,
            eventType: 'LLM_THINKING_DELTA',
            timelineEventRef: `timeline-thinking-${step}-capacity-${ordinal}`,
            payload: {
              text: `Capacity reasoning ${step} for turn ${ordinal}`,
              metadata: { accumulated: true, completed: true },
            },
          },
          {
            ...common,
            eventId: `probe-${step}-start-capacity-${ordinal}`,
            sequence: sequence + 2,
            eventType: 'CAPABILITY_STARTED',
            timelineEventRef: `timeline-probe-${step}-start-capacity-${ordinal}`,
            payload: {
              capabilityId: capability.capabilityId,
              toolCallId,
              toolName: capability.toolName,
            },
          },
          {
            ...common,
            eventId: `probe-${step}-result-capacity-${ordinal}`,
            sequence: sequence + 3,
            eventType: 'CAPABILITY_RESULT_DELTA',
            timelineEventRef: `timeline-probe-${step}-result-capacity-${ordinal}`,
            payload: {
              capabilityId: capability.capabilityId,
              toolCallId,
              toolName: capability.toolName,
              status: 'SUCCEEDED',
              content: '',
              text: '',
              contentType: 'PLAIN_TEXT',
              ...capability.resultProjection,
            },
          },
          {
            ...common,
            eventId: `probe-${step}-complete-capacity-${ordinal}`,
            sequence: sequence + 4,
            eventType: 'CAPABILITY_COMPLETED',
            timelineEventRef: `timeline-probe-${step}-complete-capacity-${ordinal}`,
            payload: {
              capabilityId: capability.capabilityId,
              toolCallId,
              toolName: capability.toolName,
              status: 'SUCCEEDED',
            },
          },
        ];
      }).flat(),
    };
  }
  return {
    availability: 'AVAILABLE',
    events: [
      {
        ...common,
        eventId: `thinking-a-capacity-${ordinal}`,
        sequence: 1,
        eventType: 'LLM_THINKING_DELTA',
        timelineEventRef: `timeline-thinking-a-capacity-${ordinal}`,
        payload: {
          text: `Capacity thinking A ${ordinal}`,
          metadata: { accumulated: true, completed: true },
        },
      },
      {
        ...common,
        eventId: `tool-a-start-capacity-${ordinal}`,
        sequence: 2,
        eventType: 'CAPABILITY_STARTED',
        timelineEventRef: `timeline-tool-a-start-capacity-${ordinal}`,
        payload: {
          capabilityId: 'interfaceAudit',
          toolCallId: `tool-a-capacity-${ordinal}`,
          toolName: 'interfaceAudit',
        },
      },
      {
        ...common,
        eventId: `tool-a-complete-capacity-${ordinal}`,
        sequence: 3,
        eventType: 'CAPABILITY_COMPLETED',
        timelineEventRef: `timeline-tool-a-complete-capacity-${ordinal}`,
        payload: {
          capabilityId: 'interfaceAudit',
          toolCallId: `tool-a-capacity-${ordinal}`,
          toolName: 'interfaceAudit',
          status: 'SUCCEEDED',
        },
      },
      {
        ...common,
        eventId: `thinking-b-capacity-${ordinal}`,
        sequence: 4,
        eventType: 'LLM_THINKING_DELTA',
        timelineEventRef: `timeline-thinking-b-capacity-${ordinal}`,
        payload: {
          text: `Capacity thinking B ${ordinal}`,
          metadata: { accumulated: true, completed: true },
        },
      },
      {
        ...common,
        eventId: `tool-b-start-capacity-${ordinal}`,
        sequence: 5,
        eventType: 'CAPABILITY_STARTED',
        timelineEventRef: `timeline-tool-b-start-capacity-${ordinal}`,
        payload: {
          capabilityId: 'routeAudit',
          toolCallId: `tool-b-capacity-${ordinal}`,
          toolName: 'routeAudit',
        },
      },
      {
        ...common,
        eventId: `tool-b-complete-capacity-${ordinal}`,
        sequence: 6,
        eventType: 'CAPABILITY_COMPLETED',
        timelineEventRef: `timeline-tool-b-complete-capacity-${ordinal}`,
        payload: {
          capabilityId: 'routeAudit',
          toolCallId: `tool-b-capacity-${ordinal}`,
          toolName: 'routeAudit',
          status: 'SUCCEEDED',
        },
      },
    ],
  };
}

function capacityCapability(step) {
  switch (step % 5) {
    case 0:
      return {
        capabilityId: 'CustomNetworkProbe',
        toolName: 'CustomNetworkProbe',
        resultProjection: {},
      };
    case 1:
      return {
        capabilityId: 'Read',
        toolName: 'Read',
        resultProjection: { safeSummary: `Read capacity evidence ${step}.` },
      };
    case 2:
      return {
        capabilityId: 'Read',
        toolName: 'Read',
        resultProjection: {
          safeSummary: `Read capacity evidence ${step}.`,
          safeResult: {
            kind: 'fileRead',
            filePath: `workspace/capacity-${step}.log`,
            contentPreview: `Bounded capacity evidence ${step}`,
            truncated: false,
          },
        },
      };
    case 3:
      return {
        capabilityId: 'Skill',
        toolName: 'Skill',
        resultProjection: {},
      };
    default:
      return {
        capabilityId: 'dynamic-clip-network-inspector',
        toolName: 'dynamic-clip-network-inspector',
        resultProjection: {
          safeSummary: 'CLIP stream event received.',
          content: `Bounded CLIP capacity evidence ${step}`,
          text: `Bounded CLIP capacity evidence ${step}`,
          safeResult: {
            kind: 'clipStreamEvent',
            eventType: 'DETAIL',
            dataRawPreview: `Bounded CLIP capacity evidence ${step}`,
            dataRawTruncated: false,
          },
        },
      };
  }
}

function readOrdinal(value) {
  const match = /(\d+)$/u.exec(value);
  if (!match) {
    throw new Error(`Missing ordinal in ${value}`);
  }
  return Number(match[1]);
}
