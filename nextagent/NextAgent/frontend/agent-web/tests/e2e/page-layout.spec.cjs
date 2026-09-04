const { expect, test } = require('@playwright/test');

const SESSION_ID = 'page-layout-session';
const FAVORITE_ROOT_ID = 'favorite-layout-root';

test.beforeEach(async ({ page }) => {
  await page.routeWebSocket('**/api/v1/session-activities/ws**', (socket) => {
    socket.send(JSON.stringify({ type: 'SNAPSHOT', entries: [] }));
  });
  await page.route('**/rest/naie/guardrail/config/v1/report/risks', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ records: [] }) });
  });
  await installLayoutApiRoutes(page);
});

test('renders the shared page geometry for conversation, cron, and favorites', async ({ page }, testInfo) => {
  await page.addInitScript(() => {
    if (!window.localStorage.getItem('nextagent.localePreference')) {
      window.localStorage.setItem('nextagent.localePreference', 'en-US');
    }
    if (!window.localStorage.getItem('nextagent.themePreference')) {
      window.localStorage.setItem('nextagent.themePreference', 'dark');
    }
  });
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto(`/#/session/${SESSION_ID}`);

  await expect(page.getByTestId('right-pane-title')).toHaveText('Layout validation session');
  const conversationGeometry = await readHeaderGeometry(page.getByTestId('right-pane-header'), page.getByTestId('right-pane-title'));
  expectSharedHeaderGeometry(conversationGeometry);
  await expectContainedFrame(page.getByTestId('right-pane-content-frame'));

  await page.getByRole('button', { name: /Scheduled tasks|定时任务/ }).click();
  await expect(page.getByTestId('cron-task-dashboard-page')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Scheduled tasks', level: 1 })).toHaveCount(1);
  await expect(page.getByTestId('page-layout-header')).toHaveCount(1);
  const cronGeometry = await readHeaderGeometry(page.getByTestId('page-layout-header'), page.getByTestId('page-layout-title'));
  expectSharedHeaderGeometry(cronGeometry);
  await expectContainedFrame(page.getByTestId('page-layout-content-frame'));
  await expect(page.getByTestId('page-layout-scroll-viewport')).toHaveCSS('overflow-y', 'auto');
  await expect(page.getByTestId('page-layout-root')).toHaveCSS('overflow', 'hidden');

  await page.setViewportSize({ width: 620, height: 720 });
  await expect(page.getByRole('button', { name: /Create via chat|通过会话创建/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /Create manually|手动创建/ })).toBeVisible();
  await expect(page.getByTestId('page-layout-more-actions')).toHaveCount(0);
  const cronScreenshot = await page.screenshot({ path: testInfo.outputPath('cron-page-owned-actions.png') });
  await testInfo.attach('cron-page-owned-actions', {
    body: cronScreenshot,
    contentType: 'image/png',
  });

  await page.setViewportSize({ width: 1280, height: 720 });
  await page.getByRole('button', { name: /^(Favorites List|收藏列表)$/ }).click();
  await expect(page.getByTestId('favorite-turns-panel')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Favorites List', level: 1 })).toHaveCount(1);
  await expect(page.getByTestId('page-layout-header')).toHaveCount(1);
  const favoriteGeometry = await readHeaderGeometry(page.getByTestId('page-layout-header'), page.getByTestId('page-layout-title'));
  expectSharedHeaderGeometry(favoriteGeometry);
  await expect(page.getByRole('button', { name: /Return to the previous conversation|返回之前的会话/ })).toHaveCount(0);
  await expect(page.getByTestId('page-layout-content-frame')).toHaveCSS('max-width', 'none');
  await expect(page.getByTestId('page-layout-main')).toHaveCSS('overflow', 'hidden');
  await expect(page.getByTestId('page-layout-scroll-viewport')).toHaveCount(0);
  await expect(page.getByTestId('favorite-turns-scroll')).toHaveCSS('overflow', 'hidden');
  await page.getByRole('button', { name: /Expand Favorite layout session|展开 Favorite layout session/ }).click();
  await expect(page.getByText('favorite layout answer marker', { exact: true })).toBeVisible();
  await expect(page.getByTestId('favorite-turns-scroll')).toHaveCSS('overflow-y', 'auto');

  await testInfo.attach('page-layout-geometry', {
    body: Buffer.from(JSON.stringify({ conversationGeometry, cronGeometry, favoriteGeometry }, null, 2)),
    contentType: 'application/json',
  });
  const favoriteScreenshot = await page.screenshot({ path: testInfo.outputPath('favorite-fluid-page-layout.png') });
  await testInfo.attach('favorite-fluid-page-layout', {
    body: favoriteScreenshot,
    contentType: 'image/png',
  });

  await page.evaluate(() => {
    window.localStorage.setItem('nextagent.localePreference', 'zh-CN');
    window.localStorage.setItem('nextagent.themePreference', 'light');
  });
  await page.reload();
  await expectNavigationImage(page.getByRole('button', { name: '定时任务' }), 'cron-light.svg', 20);
  await expectNavigationImage(page.getByRole('button', { name: '收藏列表' }), 'favorites-light.svg', 20);
  await expect(page.getByRole('button', { name: '记忆管理' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '投诉历史' })).toHaveCount(0);
  const localNavigationScreenshot = await page.screenshot({ path: testInfo.outputPath('local-navigation-zh-light.png') });
  await testInfo.attach('local-navigation-zh-light', { body: localNavigationScreenshot, contentType: 'image/png' });
});

test('preserves conversation history scrolling and composer height changes', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1100, height: 720 });
  await page.goto(`/#/session/${SESSION_ID}`);

  const viewport = page.getByTestId('right-pane-scroll-viewport');
  const footer = page.getByTestId('right-pane-footer-surface');
  const contentColumn = page.getByTestId('right-pane-content-column');
  await expect(page.getByText('Layout answer 24', { exact: true })).toBeVisible();
  await expect.poll(() => viewport.evaluate((element) => element.scrollHeight - element.clientHeight)).toBeGreaterThan(100);

  await viewport.evaluate((element) => {
    element.scrollTop = 0;
    element.dispatchEvent(new Event('scroll', { bubbles: true }));
  });
  await expect(page.getByTestId('chat-scroll-to-bottom-floating')).toBeVisible();
  await page.getByTestId('chat-scroll-to-bottom-floating').click();
  await expect.poll(() => distanceFromBottom(viewport)).toBeLessThanOrEqual(4);

  const initialFooterHeight = await footer.evaluate((element) => element.getBoundingClientRect().height);
  await page.getByTestId('message-textarea').fill(Array.from({ length: 8 }, (_, index) => `diagnostic line ${index + 1}`).join('\n'));
  await expect.poll(() => footer.evaluate((element) => element.getBoundingClientRect().height)).toBeGreaterThan(initialFooterHeight);
  const resizedFooterHeight = await footer.evaluate((element) => element.getBoundingClientRect().height);
  const reservedBottomSpace = await contentColumn.evaluate((element) => Number.parseFloat(getComputedStyle(element).paddingBottom));
  expect(Math.abs(reservedBottomSpace - resizedFooterHeight)).toBeLessThanOrEqual(2);
  await expect.poll(() => distanceFromBottom(viewport)).toBeLessThanOrEqual(4);

  await page.getByTestId('message-textarea').fill('diagnostic draft');
  await expect.poll(() => distanceFromBottom(viewport)).toBeLessThanOrEqual(4);
  await viewport.evaluate((element) => {
    element.scrollTop = 0;
    element.dispatchEvent(new Event('scroll', { bubbles: true }));
  });
  await expect(page.getByTestId('chat-scroll-to-bottom-floating')).toBeVisible();
  const readingScrollTop = await viewport.evaluate((element) => element.scrollTop);
  const compactFooterHeight = await footer.evaluate((element) => element.getBoundingClientRect().height);
  await page.getByTestId('message-textarea').fill(Array.from({ length: 8 }, (_, index) => `continued diagnostic line ${index + 1}`).join('\n'));
  await expect.poll(() => footer.evaluate((element) => element.getBoundingClientRect().height)).toBeGreaterThan(compactFooterHeight);
  await expect.poll(() => viewport.evaluate((element) => element.scrollTop)).toBe(readingScrollTop);
  await expect(page.getByTestId('chat-scroll-to-bottom-floating')).toBeVisible();

  const conversationScreenshot = await page.screenshot({ path: testInfo.outputPath('conversation-scroll-and-composer-layout.png') });
  await testInfo.attach('conversation-scroll-and-composer-layout', {
    body: conversationScreenshot,
    contentType: 'image/png',
  });
});

async function readHeaderGeometry(header, title) {
  return header.evaluate(
    (element, titleTestId) => {
      const titleElement = element.querySelector(`[data-testid="${titleTestId}"]`);
      if (!(titleElement instanceof HTMLElement)) {
        throw new Error('Page title was not found inside the header.');
      }
      const headerStyle = getComputedStyle(element);
      const titleStyle = getComputedStyle(titleElement);
      return {
        height: element.getBoundingClientRect().height,
        paddingLeft: headerStyle.paddingLeft,
        paddingRight: headerStyle.paddingRight,
        borderBottomWidth: headerStyle.borderBottomWidth,
        backgroundImage: headerStyle.backgroundImage,
        boxShadow: headerStyle.boxShadow,
        flexWrap: getComputedStyle(element.firstElementChild).flexWrap,
        titleFontSize: titleStyle.fontSize,
        titleFontWeight: titleStyle.fontWeight,
        titleLineHeight: titleStyle.lineHeight,
        titleWhiteSpace: titleStyle.whiteSpace,
      };
    },
    await title.getAttribute('data-testid'),
  );
}

function expectSharedHeaderGeometry(geometry) {
  expect(geometry).toEqual({
    height: 48,
    paddingLeft: '16px',
    paddingRight: '16px',
    borderBottomWidth: '0px',
    flexWrap: 'nowrap',
    backgroundImage: 'none',
    boxShadow: 'none',
    titleFontSize: '16px',
    titleFontWeight: '500',
    titleLineHeight: '28px',
    titleWhiteSpace: 'nowrap',
  });
}

async function expectContainedFrame(frame) {
  await expect(frame).toHaveCSS('box-sizing', 'border-box');
  await expect(frame).toHaveCSS('max-width', '1080px');
  await expect(frame).toHaveCSS('padding-left', '16px');
  await expect(frame).toHaveCSS('padding-right', '16px');
}

async function expectNavigationImage(button, iconFile, size) {
  const image = button.locator('img');
  await expect(image).toHaveCount(1);
  await expect(image).toHaveAttribute('src', new RegExp(iconFile.replace('.', '\\.')));
  await expect(image).toHaveAttribute('alt', '');
  await expect(image).toHaveAttribute('aria-hidden', 'true');
  await expect(image).toHaveCSS('width', `${size}px`);
  await expect(image).toHaveCSS('height', `${size}px`);
}

async function distanceFromBottom(viewport) {
  return viewport.evaluate((element) => Math.abs(element.scrollHeight - element.scrollTop - element.clientHeight));
}

async function installLayoutApiRoutes(page) {
  const conversationItems = Array.from({ length: 24 }, (_, index) => {
    const turn = index + 1;
    const rootMessageId = `layout-root-${turn}`;
    return [
      conversationMessage(`layout-user-${turn}`, rootMessageId, 'USER', turn * 2 - 1, `Layout question ${turn} ${'network evidence '.repeat(8)}`),
      conversationMessage(`layout-assistant-${turn}`, rootMessageId, 'ASSISTANT', turn * 2, `Layout answer ${turn}`),
    ];
  }).flat();

  await page.route('**/api/v1/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname === '/api/v1/sessions' && request.method() === 'GET') {
      await fulfillJson(route, {
        entries: [{ sessionId: SESSION_ID, displayTitle: 'Layout validation session', lastActivityAt: '2026-08-12T08:00:00.000Z' }],
        offset: 0,
        limit: 50,
        hasMore: false,
      });
      return;
    }
    if (url.pathname === `/api/v1/sessions/${SESSION_ID}/conversation/preview`) {
      await fulfillJson(route, { sessionId: SESSION_ID, totalMarkers: 24, offset: 0, limit: 100, markers: [] });
      return;
    }
    if (url.pathname === `/api/v1/sessions/${SESSION_ID}/conversation` && url.searchParams.get('anchorMessageId') !== FAVORITE_ROOT_ID) {
      await fulfillJson(route, {
        sessionId: SESSION_ID,
        items: conversationItems,
        nextCursor: null,
        newerCursor: null,
        activeRun: null,
      });
      return;
    }
    if (url.pathname === `/api/v1/sessions/${SESSION_ID}/stream`) {
      await route.fulfill({ status: 200, contentType: 'text/event-stream', body: '' });
      return;
    }
    if (url.pathname === `/api/v1/sessions/${SESSION_ID}/background-tasks`) {
      await fulfillJson(route, { tasks: [] });
      return;
    }
    if (url.pathname === '/api/v1/cron-tasks' && request.method() === 'GET') {
      await fulfillJson(route, { tasks: [], total: 0 });
      return;
    }
    if (url.pathname === '/api/v1/favorites' && request.method() === 'GET') {
      await fulfillJson(route, {
        entries: [
          {
            sessionId: SESSION_ID,
            requestRunId: 'favorite-layout-run',
            rootMessageId: FAVORITE_ROOT_ID,
            questionPreview: 'favorite layout question',
            questionTruncated: false,
            sessionTitle: 'Favorite layout session',
            sessionUpdatedAt: Date.parse('2026-08-12T08:00:00.000Z'),
            favoritedAt: Date.parse('2026-08-12T08:30:00.000Z'),
          },
        ],
        offset: 0,
        limit: 100,
        hasMore: false,
      });
      return;
    }
    if (url.pathname === `/api/v1/sessions/${SESSION_ID}/conversation` && url.searchParams.get('anchorMessageId') === FAVORITE_ROOT_ID) {
      await fulfillJson(route, {
        sessionId: SESSION_ID,
        items: [
          conversationMessage('favorite-layout-user', FAVORITE_ROOT_ID, 'USER', 1, 'favorite layout question'),
          conversationMessage(
            'favorite-layout-assistant',
            FAVORITE_ROOT_ID,
            'ASSISTANT',
            2,
            `favorite layout answer marker\n\n${'capacity evidence '.repeat(300)}`,
          ),
        ],
        nextCursor: null,
        newerCursor: null,
      });
      return;
    }
    await fulfillJson(route, { tasks: [], annotations: [] });
  });
}

function conversationMessage(messageId, rootMessageId, role, sequence, content) {
  return {
    messageId,
    sessionId: SESSION_ID,
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

async function fulfillJson(route, body) {
  await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
}
