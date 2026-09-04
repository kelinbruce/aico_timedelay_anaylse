const { expect, test } = require('@playwright/test');

test('loads the chat shell', async ({ page }) => {
  await page.route('**/api/v1/sessions?**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        sessions: [],
        total: 0,
        hasMore: false,
      }),
    });
  });

  await page.goto('/');

  await expect(page.getByTestId('welcome-state-root')).toBeVisible();
  await expect(page.getByTestId('welcome-title-main')).toHaveText('NextAgent');
  await expect(page.getByTestId('message-textarea')).toBeVisible();
});

test('keeps long memory search text clear of the quick-clear button', async ({ page }) => {
  await page.route('**/api/v1/sessions?**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ sessions: [], total: 0, hasMore: false }),
    });
  });
  await page.route('**/api/v1/memory/long-term-mem?**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        errorCode: 0,
        errorMsg: 'SUCCESS',
        data: { items: [], total: 0, offset: 0, limit: 10 },
      }),
    });
  });

  await page.goto('/immersive/');
  await page.getByRole('button', { name: /Memory|记忆管理/ }).click();

  const search = page.getByPlaceholder(/Search summaries or content|搜索摘要或正文/);
  await search.fill('router-'.repeat(80));
  const clear = page.getByRole('button', { name: /Clear search|清除搜索/ });
  await expect(clear).toBeVisible();

  const layout = await search.evaluate((input) => {
    const style = getComputedStyle(input);
    const inputRect = input.getBoundingClientRect();
    const clearButton = input.parentElement?.querySelector('.ltm-search-clear');
    const clearRect = clearButton?.getBoundingClientRect();
    return {
      paddingRight: Number.parseFloat(style.paddingRight),
      overflow: style.overflow,
      whiteSpace: style.whiteSpace,
      textOverflow: style.textOverflow,
      inputRight: inputRect.right,
      clearLeft: clearRect?.left ?? 0,
      clearWidth: clearRect?.width ?? 0,
    };
  });

  expect(layout.paddingRight).toBeGreaterThanOrEqual(layout.clearWidth + 8);
  expect(layout.clearLeft).toBeGreaterThanOrEqual(layout.inputRight - layout.paddingRight);
  expect(['hidden', 'clip']).toContain(layout.overflow);
  expect(layout.whiteSpace).toBe('nowrap');
  expect(layout.textOverflow).toBe('ellipsis');
  await expect(search).toHaveValue('router-'.repeat(80));
});

test('keeps favorites and memory management mutually exclusive', async ({ page }) => {
  await page.route('**/api/v1/sessions?**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        entries: [
          {
            sessionId: 'session-1',
            displayTitle: 'Retained recent session',
            lastActivityAt: '2026-07-29T08:00:00.000Z',
          },
        ],
        total: 1,
        hasMore: false,
      }),
    });
  });
  await page.route('**/api/v1/memory/long-term-mem?**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        errorCode: 0,
        errorMsg: 'SUCCESS',
        data: { items: [], total: 0, offset: 0, limit: 10 },
      }),
    });
  });
  await page.route('**/api/v1/favorites?**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ entries: [], offset: 0, limit: 50, hasMore: false }),
    });
  });

  await page.goto('/immersive/');
  const memoryButton = page.getByRole('button', { name: /Memory management|记忆管理/ });
  const favoritesButton = page.getByRole('button', { name: /^(Favorites|收藏列表)$/ });
  await memoryButton.click();
  await expect(page.getByRole('heading', { name: /Memory management|记忆管理/ })).toBeVisible();
  await expect(memoryButton).toHaveAttribute('aria-current', 'page');
  await expect(page).toHaveURL(/#\/memory$/);

  await favoritesButton.click();

  await expect(page.getByTestId('favorite-turns-panel')).toBeVisible();
  await expect(page.getByTestId('favorite-turns-empty')).toBeVisible();
  await expect(page.getByTestId('sidebar-session-list')).toContainText('Retained recent session');
  await expect(favoritesButton).toHaveAttribute('aria-current', 'page');
  await expect(memoryButton).not.toHaveAttribute('aria-current', 'page');
  await expect(page).toHaveURL(/#\/favorites$/);

  await favoritesButton.click();
  await expect(page.getByTestId('favorite-turns-panel')).toBeVisible();

  await memoryButton.click();

  await expect(page.getByRole('heading', { name: /Memory management|记忆管理/ })).toBeVisible();
  await expect(page.getByTestId('favorite-turns-panel')).toBeHidden();
  await expect(favoritesButton).not.toHaveAttribute('aria-current', 'page');
  await expect(memoryButton).toHaveAttribute('aria-current', 'page');
  await expect(page).toHaveURL(/#\/memory$/);

  await page.goBack();
  await expect(page.getByTestId('favorite-turns-panel')).toBeVisible();
  await expect(favoritesButton).toHaveAttribute('aria-current', 'page');

  await page.reload();
  await expect(page.getByTestId('favorite-turns-panel')).toBeVisible();
});

test('removes the last favorite row and its empty session group without opening the conversation', async ({ page }) => {
  const sessionId = 'favorite-cancel-session';
  const runId = 'favorite-cancel-run';
  const rootMessageId = 'favorite-cancel-root';
  const question = 'cancel favorite question';
  let isFavorited = true;
  let annotationBody;

  await page.route('**/api/v1/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname === '/api/v1/favorites' && request.method() === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          entries: isFavorited
            ? [
                {
                  sessionId,
                  requestRunId: runId,
                  rootMessageId,
                  questionPreview: question,
                  questionTruncated: false,
                  sessionTitle: 'Favorite cancellation session',
                  sessionUpdatedAt: Date.parse('2026-07-29T08:00:00.000Z'),
                  favoritedAt: Date.parse('2026-07-29T08:30:00.000Z'),
                },
              ]
            : [],
          offset: 0,
          limit: 50,
          hasMore: false,
        }),
      });
      return;
    }
    if (url.pathname === `/api/v1/sessions/${sessionId}/conversation` && request.method() === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          sessionId,
          items: [
            {
              messageId: `${rootMessageId}-user`,
              sessionId,
              requestId: runId,
              rootMessageId,
              role: 'USER',
              sequence: 1,
              content: question,
              contentType: 'PLAIN_TEXT',
              metadata: {},
              createdAt: Date.parse('2026-07-29T08:30:00.000Z'),
              visible: true,
            },
            {
              messageId: `${rootMessageId}-assistant`,
              sessionId,
              requestId: runId,
              rootMessageId,
              role: 'ASSISTANT',
              sequence: 2,
              content: 'cancel favorite answer',
              contentType: 'PLAIN_TEXT',
              metadata: {},
              createdAt: Date.parse('2026-07-29T08:30:01.000Z'),
              visible: true,
            },
          ],
          nextCursor: null,
          newerCursor: null,
        }),
      });
      return;
    }
    if (url.pathname === `/api/v1/sessions/${sessionId}/runs/${runId}/annotations` && request.method() === 'POST') {
      annotationBody = request.postDataJSON();
      isFavorited = false;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ sentiment: null, isFavorited: false }),
      });
      return;
    }
    if (url.pathname === '/api/v1/sessions' && request.method() === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ entries: [], offset: 0, limit: 50, hasMore: false }),
      });
      return;
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ tasks: [] }) });
  });

  await page.goto('/immersive/');
  await page.getByRole('button', { name: /Favorites|收藏/ }).click();
  const initialUrl = page.url();
  await expect(page.getByText(question)).toBeHidden();
  await page.getByRole('button', { name: /Expand Favorite cancellation session|展开 Favorite cancellation session/ }).click();
  await expect(page.getByText(question)).toBeVisible();

  await page
    .getByRole('button', {
      name: /^(Remove from favorites: cancel favorite question|取消收藏：cancel favorite question)$/,
    })
    .click();
  const confirmation = page.getByRole('tooltip');
  await expect(confirmation.getByText(/Are you sure you want to remove this conversation from favorites|您确定要取消收藏该对话吗/)).toBeVisible();
  await confirmation.getByRole('button').first().click();
  await expect(confirmation).toBeHidden();
  expect(annotationBody).toBeUndefined();
  await expect(page).toHaveURL(initialUrl);

  await page
    .getByRole('button', {
      name: /^(Remove from favorites: cancel favorite question|取消收藏：cancel favorite question)$/,
    })
    .click();
  await expect(confirmation).toBeVisible();
  await confirmation.getByRole('button').last().click();

  await expect(page.getByText(question)).toBeHidden();
  await expect(page.getByTestId(`favorite-session-group-${sessionId}`)).toBeHidden();
  await expect(page.getByTestId('favorite-turns-empty')).toBeVisible();
  await expect(page.getByText(/Removed from favorites|已取消收藏/)).toBeVisible();
  expect(annotationBody).toEqual({ isFavorited: false });
  await expect(page).toHaveURL(initialUrl);
});

test('groups favorite turns into compact summaries and expands natural-height conversations', async ({ page }) => {
  const groupedSessionId = 'favorite-grouped-session';
  const otherSessionId = 'favorite-other-session';
  const entries = [
    ...Array.from({ length: 5 }, (_, index) => ({
      sessionId: groupedSessionId,
      requestRunId: `favorite-grouped-run-${index + 1}`,
      rootMessageId: `favorite-grouped-root-${index + 1}`,
      questionPreview: `grouped favorite question ${index + 1}`,
      questionTruncated: false,
      sessionTitle: 'Grouped favorite session',
      sessionUpdatedAt: Date.parse('2026-07-29T08:00:00.000Z'),
      favoritedAt: Date.parse(`2026-07-29T08:30:0${index}.000Z`),
    })),
    {
      sessionId: otherSessionId,
      requestRunId: 'favorite-other-run',
      rootMessageId: 'favorite-other-root',
      questionPreview: 'other session favorite',
      questionTruncated: false,
      sessionTitle: 'Other favorite session',
      sessionUpdatedAt: Date.parse('2026-07-29T09:00:00.000Z'),
      favoritedAt: Date.parse('2026-07-29T09:30:00.000Z'),
    },
  ];

  await page.route('**/api/v1/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname === '/api/v1/favorites' && request.method() === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ entries, offset: 0, limit: 50, hasMore: false }),
      });
      return;
    }
    if (url.pathname === `/api/v1/sessions/${groupedSessionId}/conversation` && request.method() === 'GET') {
      const rootMessageId = url.searchParams.get('anchorMessageId');
      const entry = entries.find((candidate) => candidate.rootMessageId === rootMessageId);
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          sessionId: groupedSessionId,
          items: entry
            ? [
                {
                  messageId: `${rootMessageId}-user`,
                  sessionId: groupedSessionId,
                  requestId: entry.requestRunId,
                  rootMessageId,
                  role: 'USER',
                  sequence: 1,
                  content: entry.questionPreview,
                  contentType: 'PLAIN_TEXT',
                  metadata: {},
                  createdAt: entry.favoritedAt,
                  visible: true,
                },
                {
                  messageId: `${rootMessageId}-assistant`,
                  sessionId: groupedSessionId,
                  requestId: entry.requestRunId,
                  rootMessageId,
                  role: 'ASSISTANT',
                  sequence: 2,
                  content:
                    entry.questionPreview === 'grouped favorite question 5'
                      ? `## answer for ${entry.questionPreview}\n\nquery complete\n\n- capacity evidence\n- reliability evidence\n\nThe longer answer keeps its natural Markdown height.`
                      : `answer for ${entry.questionPreview}`,
                  contentType: 'PLAIN_TEXT',
                  metadata: {},
                  createdAt: entry.favoritedAt + 1_000,
                  visible: true,
                },
              ]
            : [],
          nextCursor: null,
          newerCursor: null,
        }),
      });
      return;
    }
    if (url.pathname === '/api/v1/sessions' && request.method() === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ entries: [], offset: 0, limit: 50, hasMore: false }),
      });
      return;
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ tasks: [] }) });
  });

  await page.goto('/immersive/');
  await page.getByRole('button', { name: /Favorites|收藏/ }).click();

  const groupedSession = page.getByTestId(`favorite-session-group-${groupedSessionId}`);
  const otherSession = page.getByTestId(`favorite-session-group-${otherSessionId}`);
  await expect(groupedSession).toBeVisible();
  await expect(otherSession).toBeVisible();
  await expect(page.getByText('grouped favorite question 1', { exact: true })).toBeHidden();
  const groupedSessionBox = await groupedSession.boundingBox();
  const otherSessionBox = await otherSession.boundingBox();
  expect(groupedSessionBox).not.toBeNull();
  expect(otherSessionBox).not.toBeNull();
  expect(groupedSessionBox.height).toBeGreaterThanOrEqual(29);
  expect(groupedSessionBox.height).toBeLessThanOrEqual(56);
  expect(otherSessionBox.height).toBeGreaterThanOrEqual(29);
  expect(otherSessionBox.height).toBeLessThanOrEqual(56);
  expect(Math.abs(otherSessionBox.y - groupedSessionBox.y - groupedSessionBox.height - 8)).toBeLessThanOrEqual(1);

  await groupedSession
    .getByRole('button', {
      name: /Expand Grouped favorite session|展开 Grouped favorite session/,
    })
    .click();

  await expect(page.getByText('grouped favorite question 1', { exact: true })).toBeVisible();
  await expect(page.getByText('grouped favorite question 5', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'answer for grouped favorite question 5' })).toBeVisible();
  const assistantMessages = groupedSession.locator('.favorite-conversation-message-assistant');
  await expect(assistantMessages).toHaveCount(5);
  const [shortAnswerBox, longAnswerBox, answerSpacing] = await Promise.all([
    assistantMessages.first().boundingBox(),
    assistantMessages.last().boundingBox(),
    assistantMessages.first().evaluate((element) => {
      const style = getComputedStyle(element);
      const markdown = element.querySelector('.markdown-content');
      const paragraph = markdown?.querySelector('p');
      const markdownStyle = markdown ? getComputedStyle(markdown) : null;
      const paragraphStyle = paragraph ? getComputedStyle(paragraph) : null;
      return {
        minHeight: style.minHeight,
        paddingTop: style.paddingTop,
        paddingRight: style.paddingRight,
        markdownMinHeight: markdownStyle?.minHeight,
        markdownHeight: markdown?.getBoundingClientRect().height,
        markdownLineHeight: markdownStyle?.lineHeight,
        paragraphMarginTop: paragraphStyle?.marginTop,
        paragraphMarginBottom: paragraphStyle?.marginBottom,
      };
    }),
  ]);
  expect(shortAnswerBox).not.toBeNull();
  expect(longAnswerBox).not.toBeNull();
  expect(longAnswerBox.height).toBeGreaterThan(shortAnswerBox.height);
  expect(answerSpacing).toMatchObject({
    minHeight: '0px',
    paddingTop: '8px',
    paddingRight: '12px',
    markdownMinHeight: '0px',
    paragraphMarginTop: '0px',
    paragraphMarginBottom: '0px',
  });
  expect(Math.abs(answerSpacing.markdownHeight - Number.parseFloat(answerSpacing.markdownLineHeight))).toBeLessThanOrEqual(1);
  await groupedSession
    .getByRole('button', {
      name: /Collapse Grouped favorite session|收起 Grouped favorite session/,
    })
    .click();
  await expect(page.getByText('grouped favorite question 1', { exact: true })).toBeHidden();
});

test('paginates favorite sessions explicitly without collapsed-list scrolling', async ({ page }) => {
  const favoriteEntries = Array.from({ length: 45 }, (_, index) => ({
    sessionId: `scroll-favorite-session-${index + 1}`,
    requestRunId: `scroll-favorite-run-${index + 1}`,
    rootMessageId: `scroll-favorite-root-${index + 1}`,
    questionPreview: `scroll favorite question ${index + 1}`,
    questionTruncated: false,
    sessionTitle: `Scroll favorite session ${index + 1}`,
    sessionUpdatedAt: Date.parse('2026-07-29T08:00:00.000Z') - index,
    favoritedAt: Date.parse('2026-07-29T09:00:00.000Z') - index,
  }));
  const requestedWindows = [];

  await page.route('**/api/v1/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname === '/api/v1/favorites' && request.method() === 'GET') {
      const offset = Number(url.searchParams.get('offset') ?? '0');
      const limit = Number(url.searchParams.get('limit') ?? '20');
      requestedWindows.push({ offset, limit });
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          entries: favoriteEntries.slice(offset, offset + limit),
          offset,
          limit,
          hasMore: offset + limit < favoriteEntries.length,
        }),
      });
      return;
    }
    const scrollConversationMatch = url.pathname.match(/^\/api\/v1\/sessions\/scroll-favorite-session-(8|15)\/conversation$/);
    if (scrollConversationMatch && request.method() === 'GET') {
      const sessionNumber = scrollConversationMatch[1];
      const sessionId = `scroll-favorite-session-${sessionNumber}`;
      const rootMessageId = `scroll-favorite-root-${sessionNumber}`;
      const requestRunId = `scroll-favorite-run-${sessionNumber}`;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          sessionId,
          items: [
            {
              messageId: `${rootMessageId}-user`,
              sessionId,
              requestId: requestRunId,
              rootMessageId,
              role: 'USER',
              sequence: 1,
              content: `scroll favorite question ${sessionNumber}`,
              contentType: 'PLAIN_TEXT',
              metadata: {},
              createdAt: Date.parse('2026-07-29T09:00:00.000Z'),
              visible: true,
            },
            {
              messageId: `${rootMessageId}-assistant`,
              sessionId,
              requestId: requestRunId,
              rootMessageId,
              role: 'ASSISTANT',
              sequence: 2,
              content: `expanded answer ${sessionNumber} starts here`,
              contentType: 'MARKDOWN',
              metadata: {},
              createdAt: Date.parse('2026-07-29T09:00:01.000Z'),
              visible: true,
            },
          ],
          nextCursor: null,
          newerCursor: null,
        }),
      });
      return;
    }
    if (url.pathname === '/api/v1/sessions' && request.method() === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ entries: [], offset: 0, limit: 50, hasMore: false }),
      });
      return;
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ tasks: [] }) });
  });

  await page.goto('/immersive/');
  await page.getByRole('button', { name: /Favorites|收藏/ }).click();

  const panel = page.getByTestId('favorite-turns-panel');
  const scroller = panel.locator('.favorite-turns-scroll');
  await expect(page.getByRole('article')).toHaveCount(15);
  await expect(page.getByRole('button', { name: /More favorites|查看更多收藏/ })).toHaveCount(0);
  await expect(page.getByTestId('favorite-turns-pagination-sentinel')).toHaveCount(0);
  expect(await scroller.evaluate((element) => element.scrollHeight <= element.clientHeight)).toBe(true);

  const [scrollerBox, firstCardBox] = await Promise.all([scroller.boundingBox(), page.getByRole('article').first().boundingBox()]);
  expect(scrollerBox).not.toBeNull();
  expect(firstCardBox).not.toBeNull();
  expect(Math.abs(firstCardBox.width - scrollerBox.width)).toBeLessThanOrEqual(1);
  expect(await page.getByRole('tablist').evaluate((element) => getComputedStyle(element).marginBottom)).toBe('8px');
  const firstSummary = page.getByRole('article').first().locator('.favorite-session-summary');
  await firstSummary.hover();
  const firstCardBorder = await page
    .getByRole('article')
    .first()
    .evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        topWidth: style.borderTopWidth,
        topStyle: style.borderTopStyle,
        rightWidth: style.borderRightWidth,
        bottomWidth: style.borderBottomWidth,
        leftWidth: style.borderLeftWidth,
      };
    });
  expect(firstCardBorder).toEqual({
    topWidth: '1px',
    topStyle: 'solid',
    rightWidth: '1px',
    bottomWidth: '1px',
    leftWidth: '1px',
  });

  const middleSessionOnFirstPage = page.getByTestId('favorite-session-group-scroll-favorite-session-8');
  await middleSessionOnFirstPage.getByRole('button', { name: /Expand Scroll favorite session 8|展开 Scroll favorite session 8/ }).click();
  await expect(page.getByText('expanded answer 8 starts here', { exact: true })).toBeVisible();
  await expect
    .poll(async () => {
      const [currentScrollerBox, expandedCardBox] = await Promise.all([scroller.boundingBox(), middleSessionOnFirstPage.boundingBox()]);
      if (!currentScrollerBox || !expandedCardBox) return Number.POSITIVE_INFINITY;
      return Math.abs(expandedCardBox.y - currentScrollerBox.y);
    })
    .toBeLessThanOrEqual(2);
  await middleSessionOnFirstPage.getByRole('button', { name: /Collapse Scroll favorite session 8|收起 Scroll favorite session 8/ }).click();
  await scroller.evaluate((element) => {
    element.scrollTop = 0;
  });

  const lastSessionOnFirstPage = page.getByTestId('favorite-session-group-scroll-favorite-session-15');
  await lastSessionOnFirstPage.getByRole('button', { name: /Expand Scroll favorite session 15|展开 Scroll favorite session 15/ }).click();
  await expect(page.getByText('expanded answer 15 starts here', { exact: true })).toBeVisible();
  await expect
    .poll(async () => {
      const [currentScrollerBox, expandedCardBox, conversationStartBox] = await Promise.all([
        scroller.boundingBox(),
        lastSessionOnFirstPage.boundingBox(),
        lastSessionOnFirstPage.locator('.favorite-session-conversations').boundingBox(),
      ]);
      if (!currentScrollerBox || !expandedCardBox || !conversationStartBox) return false;
      const scrollerBottom = currentScrollerBox.y + currentScrollerBox.height;
      return expandedCardBox.y >= currentScrollerBox.y - 2 && conversationStartBox.y < scrollerBottom;
    })
    .toBe(true);

  await panel.locator('.favorite-turns-pagination').getByTitle('2').click();
  await expect(page.getByText('Scroll favorite session 16', { exact: true })).toBeVisible();
  await expect(page.getByRole('article')).toHaveCount(15);

  await panel.locator('.favorite-turns-pagination').getByTitle('3').click();
  await expect(page.getByText('Scroll favorite session 45', { exact: true })).toBeVisible();
  await expect(page.getByRole('article')).toHaveCount(15);
  expect(requestedWindows).toEqual([{ offset: 0, limit: 100 }]);
});

test('keeps a favorite turn in the middle of a long conversation at the viewport anchor', async ({ page }) => {
  const sessionId = 'favorite-middle-session';
  const targetRootMessageId = 'favorite-root-4';
  const messages = Array.from({ length: 8 }, (_, index) => {
    const turnNumber = index + 1;
    const rootMessageId = `favorite-root-${turnNumber}`;
    const content = turnNumber === 4 ? 'favorite middle question' : `long conversation question ${turnNumber} ${'network diagnostics '.repeat(30)}`;
    return [
      {
        messageId: `${rootMessageId}-user`,
        sessionId,
        requestId: rootMessageId,
        runId: `run-${turnNumber}`,
        role: 'USER',
        sequence: 0,
        content,
        contentType: 'PLAIN_TEXT',
        metadata: {},
        createdAt: Date.parse(`2026-07-29T08:00:${String(turnNumber * 2 - 1).padStart(2, '0')}.000Z`),
        visible: true,
      },
      {
        messageId: `${rootMessageId}-assistant`,
        sessionId,
        requestId: rootMessageId,
        runId: `run-${turnNumber}`,
        role: 'ASSISTANT',
        sequence: 0,
        content: `long conversation answer ${turnNumber} ${'capacity reliability evidence '.repeat(45)}`,
        contentType: 'MARKDOWN',
        metadata: { status: 'COMPLETED' },
        createdAt: Date.parse(`2026-07-29T08:00:${String(turnNumber * 2).padStart(2, '0')}.000Z`),
        visible: true,
      },
    ];
  }).flat();

  await page.route('**/api/v1/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname === '/api/v1/favorites') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          entries: [
            {
              sessionId,
              requestRunId: 'run-4',
              rootMessageId: targetRootMessageId,
              questionPreview: 'favorite middle question',
              questionTruncated: false,
              sessionTitle: 'Long favorite session',
              sessionUpdatedAt: Date.parse('2026-07-29T08:00:16.000Z'),
              favoritedAt: Date.parse('2026-07-29T08:30:00.000Z'),
            },
          ],
          offset: 0,
          limit: 50,
          hasMore: false,
        }),
      });
      return;
    }
    if (url.pathname === '/api/v1/sessions' && request.method() === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          entries: [
            {
              sessionId,
              displayTitle: 'Long favorite session',
              lastActivityAt: '2026-07-29T08:00:16.000Z',
            },
          ],
          offset: 0,
          limit: 50,
          hasMore: false,
        }),
      });
      return;
    }
    if (url.pathname === `/api/v1/sessions/${sessionId}/conversation`) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          items: messages,
        }),
      });
      return;
    }
    if (url.pathname === `/api/v1/sessions/${sessionId}/conversation/preview`) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ sessionId, totalMarkers: 8, offset: 0, limit: 100, markers: [] }),
      });
      return;
    }
    if (url.pathname === `/api/v1/sessions/${sessionId}/stream`) {
      await route.fulfill({ status: 200, contentType: 'text/event-stream', body: '' });
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
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ tasks: [] }) });
  });

  await page.goto('/immersive/');
  await page.getByRole('button', { name: /Favorites|收藏/ }).click();
  await page.getByRole('button', { name: /Expand Long favorite session|展开 Long favorite session/ }).click();
  await page.getByTestId(`favorite-turn-open-${sessionId}-run-4`).click();

  const target = page.getByTestId('turn-block').filter({ hasText: 'favorite middle question' });
  const viewport = page.getByTestId('right-pane-scroll-viewport');
  await expect(target).toBeVisible();
  await expect
    .poll(async () =>
      target.evaluate((element) => {
        const viewportElement = element.closest('[data-testid="right-pane-scroll-viewport"]');
        if (!(viewportElement instanceof HTMLElement)) {
          return null;
        }
        return Math.round(element.getBoundingClientRect().top - viewportElement.getBoundingClientRect().top);
      }),
    )
    .toBe(24);
  await page.waitForTimeout(500);
  const finalState = await viewport.evaluate((element) => ({
    scrollTop: element.scrollTop,
    distanceFromBottom: element.scrollHeight - element.clientHeight - element.scrollTop,
  }));
  expect(finalState.scrollTop).toBeGreaterThan(0);
  expect(finalState.distanceFromBottom).toBeGreaterThan(100);
});
