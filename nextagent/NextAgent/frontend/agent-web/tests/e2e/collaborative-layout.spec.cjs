const { expect, test } = require('@playwright/test');

test('widens the collaborative conversation surface without compressing the shared expand panel', async ({ page }) => {
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

  await page.goto('/collaborative');
  await page.getByTestId('ai-agent-piu-entrance').click();
  await page.getByTestId('piu-more-menu').click();
  await page.getByRole('menuitem', { name: /Memory Management|记忆管理/ }).click();

  const expandPanel = page.getByTestId('ai-agent-expand-panel-region');
  const conversationPanel = page.getByTestId('ai-agent-piu-panel');
  const conversationPane = page.getByTestId('chat-conversation-pane');
  await expect(expandPanel).toBeVisible();

  const initialExpandPanelBox = await expandPanel.boundingBox();
  const initialConversationPaneBox = await conversationPane.boundingBox();
  expect(initialConversationPaneBox.width).toBeLessThanOrEqual(484);

  const resizeHandle = page.getByTestId('ai-agent-piu-docked-resize');
  const resizeBox = await resizeHandle.boundingBox();
  await page.mouse.move(resizeBox.x + resizeBox.width / 2, resizeBox.y + resizeBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(resizeBox.x + resizeBox.width / 2 - 200, resizeBox.y + resizeBox.height / 2, { steps: 10 });
  await page.mouse.up();

  const expandedPanelBox = await conversationPanel.boundingBox();
  const expandedPaneBox = await conversationPane.boundingBox();
  const expandedExpandPanelBox = await expandPanel.boundingBox();
  expect(expandedPanelBox.width).toBeGreaterThan(683);
  expect(expandedPaneBox.width).toBeGreaterThan(681);
  expect(expandedExpandPanelBox.width).toBe(initialExpandPanelBox.width);
  await expect(expandPanel).toHaveCSS('right', '484px');
});
