const { expect, test } = require('@playwright/test');

test.describe.configure({ mode: 'default' });

const sessionId = 'complaint-feedback-session';
const rootMessageId = 'complaint-feedback-root';
const runId = 'complaint-feedback-run';
const complaintLabel = /Complaint History|投诉历史/;

async function installComplaintFixture(page) {
  await page.route('**/rest/naie/guardrail/config/v1/report/risks', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        records: [
          { id: '1', name_en: 'Incorrect diagnosis', name_zh: '诊断错误' },
          { id: '8', name_en: 'Other', name_zh: '其他' },
        ],
      }),
    });
  });
  await page.route('**/api/v1/sessions?**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ entries: [], offset: 0, limit: 50, hasMore: false }),
    });
  });
  await page.route('**/api/v1/sessions/**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === `/api/v1/sessions/${sessionId}/conversation`) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          sessionId,
          items: [
            {
              messageId: rootMessageId,
              sessionId,
              requestId: rootMessageId,
              runId: null,
              requestContextId: rootMessageId,
              rootMessageId,
              role: 'USER',
              sequence: 1,
              content: 'Why is the RAN link dropping packets?',
              contentType: 'PLAIN_TEXT',
              metadata: {},
              createdAt: '2026-07-29T00:00:00.000Z',
              visible: true,
            },
            {
              messageId: 'complaint-feedback-answer',
              sessionId,
              requestId: rootMessageId,
              runId,
              requestContextId: rootMessageId,
              rootMessageId,
              role: 'ASSISTANT',
              sequence: 2,
              content: 'The diagnosis indicates interface congestion.',
              contentType: 'MARKDOWN',
              metadata: { eventType: 'REQUEST_COMPLETED', status: 'COMPLETED' },
              createdAt: '2026-07-29T00:00:01.000Z',
              visible: true,
            },
          ],
          nextCursor: null,
          newerCursor: null,
          activeRun: null,
        }),
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
      await route.fulfill({ status: 200, contentType: 'text/event-stream', body: '' });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ tasks: [] }),
    });
  });
}

test('local host opens complaint feedback but hides complaint history', async ({ page }) => {
  await installComplaintFixture(page);
  await page.goto(`/#/session/${sessionId}`);

  await page.getByTestId('btn-more-actions').click();
  await page.getByTestId('btn-complaint-feedback').click();
  await expect(page.getByText(/Complaint Center|投诉中心/)).toBeVisible();
  await expect(page.getByRole('button', { name: complaintLabel })).toHaveCount(0);
});

test('immersive left layout opens complaint history', async ({ page }, testInfo) => {
  await installComplaintFixture(page);
  await page.goto('/immersive/');

  await expectNavigationImage(page.getByRole('button', { name: '投诉历史' }), 'complaint-light.svg', 20);
  await page.getByRole('button', { name: '投诉历史' }).click();
  await expect(page.getByRole('heading', { name: '投诉历史', level: 1 })).toHaveCount(1);
  await expect(page.getByTestId('piu-renderer-container')).toBeVisible();

  await switchHostProjection(page, 'AFWebsitePIU', 'en-us', 'evening');
  await expectNavigationImage(page.getByRole('button', { name: 'Complaint History' }), 'complaint-dark.svg', 20);
  await expect(page.getByRole('heading', { name: 'Complaint History', level: 1 })).toHaveCount(1);
  const screenshot = await page.screenshot({ path: testInfo.outputPath('immersive-left-complaint-en-dark.png') });
  await testInfo.attach('immersive-left-complaint-en-dark', { body: screenshot, contentType: 'image/png' });
});

test('immersive right layout opens complaint history', async ({ page }, testInfo) => {
  await page.addInitScript(() => {
    window.sessionStorage.setItem('AICOConfig', JSON.stringify({ layoutConfig: { operatorPosition: 'RIGHT' } }));
  });
  await installComplaintFixture(page);
  await page.goto('/immersive/');

  await expectNavigationImage(page.getByRole('button', { name: '新建会话' }), 'new-session-light.svg', 20);
  await expectNavigationImage(page.getByRole('button', { name: '收藏列表' }), 'favorites-light.svg', 16);
  await expectNavigationImage(page.getByRole('button', { name: '记忆管理' }), 'memory-light.svg', 16);
  await expectNavigationImage(page.getByRole('button', { name: '投诉历史' }), 'complaint-light.svg', 16);
  await expect(page.getByRole('button', { name: '定时任务' })).toHaveCount(0);
  await switchHostProjection(page, 'AFWebsitePIU', 'en-us', 'evening');
  await expectNavigationImage(page.getByRole('button', { name: 'New Session' }), 'new-session-dark.svg', 20);
  await expectNavigationImage(page.getByRole('button', { name: 'Favorites List' }), 'favorites-dark.svg', 16);
  await expectNavigationImage(page.getByRole('button', { name: 'Memory Management' }), 'memory-dark.svg', 16);
  await expectNavigationImage(page.getByRole('button', { name: 'Complaint History' }), 'complaint-dark.svg', 16);
  await expect(page.getByRole('button', { name: 'Scheduled tasks' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Complaint History' }).click();
  await expect(page.getByRole('heading', { name: 'Complaint History', level: 1 })).toHaveCount(1);
  await expect(page.getByTestId('piu-renderer-container')).toBeVisible();
  const screenshot = await page.screenshot({ path: testInfo.outputPath('immersive-right-navigation-en-dark.png') });
  await testInfo.attach('immersive-right-navigation-en-dark', { body: screenshot, contentType: 'image/png' });
});

test('collaborative host opens complaint history in the shared expand panel', async ({ page }, testInfo) => {
  await installComplaintFixture(page);
  await page.goto('/collaborative');
  await page.getByTestId('ai-agent-piu-entrance').click();
  await page.evaluate(async () => {
    const { aicoConfigStore } = await import('/src/aico-config/AICOConfigStore.ts');
    aicoConfigStore.setConfig({
      operators: [
        {
          enName: 'custom-inner',
          zhName: '协作式专有入口',
          position: 'INNER',
          type: 'PANEL',
          lightIcon: '/custom-light.svg',
          darkIcon: '/custom-dark.svg',
          data: { piuName: 'CustomPIU', piuVersion: '1.0.0', renderFunc: 'render' },
        },
      ],
    });
  });

  await switchHostProjection(page, 'AICOPIU', 'en-us', 'evening');
  await page.getByTestId('piu-more-menu').click();
  const menuItems = page.getByRole('menuitem');
  await expect(menuItems).toHaveCount(6);
  await expect(menuItems).toHaveText(['协作式专有入口', 'Favorites List', 'Memory Management', 'Complaint History', 'Scheduled tasks', '窗口模式']);
  await expectNavigationImage(page.getByRole('menuitem', { name: 'Favorites List' }), 'favorites-dark.svg', 16);
  await expectNavigationImage(page.getByRole('menuitem', { name: 'Memory Management' }), 'memory-dark.svg', 16);
  await expectNavigationImage(page.getByRole('menuitem', { name: 'Complaint History' }), 'complaint-dark.svg', 16);
  await expectNavigationImage(page.getByRole('menuitem', { name: 'Scheduled tasks' }), 'cron-dark.svg', 16);
  await page.getByRole('menuitem', { name: 'Complaint History' }).click();
  await expect(page.getByRole('heading', { name: 'Complaint History', level: 1 })).toHaveCount(1);
  await expect(page.getByTestId('piu-renderer-container')).toBeVisible();
  const screenshot = await page.screenshot({ path: testInfo.outputPath('collaborative-navigation-en-dark.png') });
  await testInfo.attach('collaborative-navigation-en-dark', { body: screenshot, contentType: 'image/png' });
});

async function switchHostProjection(page, piuName, locale, theme) {
  await page.evaluate(
    ({ targetPiuName, nextLocale, nextTheme }) => {
      const piu = window.__AIAgentPiuMockPrel?.getPiu(targetPiuName);
      piu?.__handlers?.switchLocale?.(nextLocale);
      piu?.__handlers?.switchTheme?.(nextTheme);
    },
    { targetPiuName: piuName, nextLocale: locale, nextTheme: theme },
  );
}

async function expectNavigationImage(entry, iconFile, size) {
  const image = entry.locator('img');
  await expect(image).toHaveCount(1);
  await expect(image).toHaveAttribute('src', new RegExp(iconFile.replace('.', '\\.')));
  await expect(image).toHaveAttribute('alt', '');
  await expect(image).toHaveAttribute('aria-hidden', 'true');
  await expect(image).toHaveCSS('width', `${size}px`);
  await expect(image).toHaveCSS('height', `${size}px`);
}
