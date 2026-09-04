const { expect, test } = require('@playwright/test');

const sessionId = 'question-association-history-recall';

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
    createdAt: `2026-08-12T08:00:${String(sequence).padStart(2, '0')}.000Z`,
    visible: true,
  };
}

test('recalls submitted messages without querying associations and resumes after editing', async ({ page }) => {
  const associationKeywords = [];
  const conversation = [
    message('user-older', 'root-older', 'USER', 1, 'older question'),
    message('assistant-older', 'root-older', 'ASSISTANT', 2, 'older answer'),
    message('user-latest', 'root-latest', 'USER', 3, 'latest question'),
    message('assistant-latest', 'root-latest', 'ASSISTANT', 4, 'latest answer'),
  ];

  await page.routeWebSocket('**/api/v1/session-activities/ws**', (socket) => {
    socket.send(JSON.stringify({ type: 'SNAPSHOT', entries: [] }));
  });
  await page.route('**/rest/naie/guardrail/config/v1/report/risks', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ records: [] }) });
  });
  await page.route('**/api/v1/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname === '/api/v1/question-association') {
      associationKeywords.push(url.searchParams.get('keyword'));
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ locale: 'zh-CN', questions: [{ text: 'matched question', source: 'static' }] }),
      });
      return;
    }
    if (url.pathname === '/api/v1/sessions' && request.method() === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          entries: [{ sessionId, displayTitle: 'Association history', lastActivityAt: '2026-08-12T08:00:04.000Z' }],
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
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ sessionId, items: conversation, nextCursor: null, newerCursor: null, activeRun: null }),
      });
      return;
    }
    if (url.pathname === `/api/v1/sessions/${sessionId}/stream`) {
      await route.fulfill({ status: 200, contentType: 'text/event-stream', body: '' });
      return;
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ tasks: [] }) });
  });

  await page.goto(`/#/session/${sessionId}`);
  await expect(page.getByText('latest question', { exact: true })).toBeVisible();
  const textarea = page.getByTestId('message-textarea');
  await textarea.focus();
  await textarea.press('ArrowUp');

  await expect(textarea).toHaveValue('latest question');
  await page.waitForTimeout(600);
  expect(associationKeywords).toEqual([]);

  await textarea.fill('latest question edited');
  await expect.poll(() => associationKeywords).toEqual(['latest question edited']);
  await expect(page.getByTestId('association-panel')).toBeVisible();
});
