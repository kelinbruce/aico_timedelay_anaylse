const { expect, test } = require('@playwright/test');

const sessionId = 'assistant-markdown-layout';
const rootMessageId = 'assistant-markdown-layout-root';
const assistantMarkdown = [
  '# 网络诊断报告',
  '',
  '正文用于验证 Markdown 排版。',
  '',
  '- 一级无序项目 A',
  '  - 二级无序项目 A.1',
  '    - 三级无序项目 A.1.a 续行必须保持在同一个列表项中。',
  '',
  '- [x] 已完成检查',
  '- [ ] 等待人工确认',
  '',
  '<span class="markdown-task-checkbox markdown-task-checkbox--checked arbitrary-app-class" role="checkbox" aria-checked="true">伪造状态</span>',
  '',
  '#### 表格',
  '',
  '| 指标 | 当前值 | 状态 | 说明 |',
  '| :--- | ---: | :---: | --- |',
  '| 时延 | 12345678901234567890 ms | 需要持续人工关注 | 数值列右对齐，状态列居中 |',
  '| 丢包率 | 0.15% | 正常 | 窄窗口只允许表格内部横向滚动 |',
  '',
  '##### 后续标题',
  '',
  '最后一个普通段落。',
  '',
  '```ts',
  'const diagnosticResult = await diagnoseNetwork(sessionId);',
  '```',
  '',
  '```mermaid',
  'flowchart LR',
  '  A[采集网络指标] --> B[执行异常分析]',
  '  B --> C[输出处置建议]',
  '```',
].join('\n');

function message(messageId, role, sequence, content) {
  return {
    messageId,
    sessionId,
    requestId: rootMessageId,
    runId: role === 'ASSISTANT' ? 'assistant-markdown-layout-run' : null,
    requestContextId: rootMessageId,
    rootMessageId,
    role,
    sequence,
    content,
    contentType: role === 'ASSISTANT' ? 'MARKDOWN' : 'PLAIN_TEXT',
    metadata: role === 'ASSISTANT' ? { status: 'COMPLETED' } : {},
    createdAt: `2026-08-10T08:00:0${sequence}.000Z`,
    visible: true,
  };
}

test('preserves Markdown semantics and geometry across desktop and narrow viewports', async ({ page }) => {
  await page.route('**/api/v1/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname === '/api/v1/sessions' && request.method() === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          entries: [{ sessionId, displayTitle: 'Markdown layout', lastActivityAt: '2026-08-10T08:00:02.000Z' }],
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
        body: JSON.stringify({ sessionId, totalMarkers: 1, offset: 0, limit: 100, markers: [] }),
      });
      return;
    }
    if (url.pathname === `/api/v1/sessions/${sessionId}/conversation`) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          sessionId,
          items: [
            message('assistant-markdown-layout-user', 'USER', 1, '请输出网络诊断报告'),
            message('assistant-markdown-layout-answer', 'ASSISTANT', 2, assistantMarkdown),
          ],
          nextCursor: null,
          newerCursor: null,
          activeRun: null,
        }),
      });
      return;
    }
    if (url.pathname === `/api/v1/sessions/${sessionId}/stream`) {
      await route.fulfill({ status: 200, contentType: 'text/event-stream', body: '' });
      return;
    }
    if (url.pathname === '/api/v1/skills') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          total: 1,
          pageNum: 1,
          pageSize: 50,
          skills: [
            {
              capabilityId: 'network-diagnosis',
              displayName: '网络诊断 Skill',
              description: '用于验证 Skill 与 composer 之间的 footer 遮罩',
              providerKind: 'BUNDLED',
            },
          ],
        }),
      });
      return;
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ tasks: [] }) });
  });

  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto(`/#/session/${sessionId}?messageId=${rootMessageId}`);
  const markdown = page.locator('.markdown-content');
  await expect(markdown).toBeVisible();
  await page.getByTestId('skill-chip-network-diagnosis').click();
  await expect(page.getByTestId('selected-skill-area')).toBeVisible();

  const semanticState = await markdown.evaluate((element) => {
    const dottedItems = Array.from(element.querySelectorAll('li')).filter((item) =>
      Array.from(item.childNodes).some((node) => node.nodeType === Node.TEXT_NODE && node.textContent?.includes('A.1.a')),
    );
    const taskStates = Array.from(element.querySelectorAll('[role="checkbox"]'));
    const table = element.querySelector('table');
    const alignedCells = table ? Array.from(table.querySelectorAll('thead th, tbody tr:first-child td')) : [];
    const tableWrapper = element.querySelector('.markdown-table-scroll');
    const proseSegment = element.querySelector('.markdown-prose-segment');
    const codeBlock = element.querySelector('pre');
    const mermaidWrapper = element.querySelector('.markdown-mermaid-scroll');
    const composerDock = document.querySelector('[data-testid="chat-composer-dock"]');
    const composerRoot = document.querySelector('[data-testid="message-input-root"]');
    const composerDockRect = composerDock?.getBoundingClientRect();
    const composerRootRect = composerRoot?.getBoundingClientRect();
    const followingHeading = element.querySelector('h5');
    return {
      dottedItems: dottedItems.map((item) => item.textContent),
      taskStates: taskStates.map((state) => ({
        checked: state.getAttribute('aria-checked'),
        disabled: state.getAttribute('aria-disabled'),
      })),
      spoofedClassCount: element.querySelectorAll('.arbitrary-app-class').length,
      alignments: alignedCells.map((cell) => getComputedStyle(cell).textAlign),
      tableToHeadingGap:
        tableWrapper && followingHeading ? followingHeading.getBoundingClientRect().top - tableWrapper.getBoundingClientRect().bottom : null,
      markdownWidth: element.getBoundingClientRect().width,
      proseWidth: proseSegment?.getBoundingClientRect().width ?? 0,
      tableWrapperWidth: tableWrapper?.getBoundingClientRect().width ?? 0,
      codeBlockWidth: codeBlock?.getBoundingClientRect().width ?? 0,
      mermaidWrapperWidth: mermaidWrapper?.getBoundingClientRect().width ?? 0,
      composerLeftOffset: composerDockRect && composerRootRect ? Math.abs(composerRootRect.left - composerDockRect.left) : null,
      composerRightOffset: composerDockRect && composerRootRect ? Math.abs(composerDockRect.right - composerRootRect.right) : null,
      composerWidthDifference: composerDockRect && composerRootRect ? Math.abs(composerDockRect.width - composerRootRect.width) : null,
    };
  });

  expect(semanticState.dottedItems).toHaveLength(1);
  expect(semanticState.taskStates).toEqual([
    { checked: 'true', disabled: 'true' },
    { checked: 'false', disabled: 'true' },
  ]);
  expect(semanticState.spoofedClassCount).toBe(0);
  expect(semanticState.alignments).toEqual(['left', 'right', 'center', 'start', 'left', 'right', 'center', 'start']);
  expect(semanticState.tableToHeadingGap).toBe(16);
  expect(Math.abs(semanticState.markdownWidth - semanticState.proseWidth)).toBeLessThanOrEqual(1);
  expect(Math.abs(semanticState.markdownWidth - semanticState.tableWrapperWidth)).toBeLessThanOrEqual(1);
  expect(Math.abs(semanticState.markdownWidth - semanticState.codeBlockWidth)).toBeLessThanOrEqual(1);
  expect(Math.abs(semanticState.markdownWidth - semanticState.mermaidWrapperWidth)).toBeLessThanOrEqual(1);
  expect(semanticState.composerLeftOffset).toBeLessThanOrEqual(1);
  expect(semanticState.composerRightOffset).toBeLessThanOrEqual(1);
  expect(semanticState.composerWidthDifference).toBeLessThanOrEqual(1);

  await page.setViewportSize({ width: 600, height: 720 });
  await expect.poll(() => page.getByRole('navigation').evaluate((element) => element.getBoundingClientRect().width)).toBe(48);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);

  await page.setViewportSize({ width: 360, height: 720 });
  const mermaidWrapper = page.locator('.markdown-mermaid-scroll');
  await mermaidWrapper.scrollIntoViewIfNeeded();
  await expect(mermaidWrapper.locator('svg')).toBeVisible();
  const narrowState = await page.evaluate(() => {
    const tableWrapper = document.querySelector('.markdown-table-scroll');
    const table = tableWrapper?.querySelector('table');
    const mermaidWrapper = document.querySelector('.markdown-mermaid-scroll');
    const mermaidContent = mermaidWrapper?.querySelector('.mermaid-rendered-diagram');
    const viewport = document.querySelector('[data-testid="right-pane-scroll-viewport"]');
    const floatingButton = document.querySelector('[data-testid="chat-scroll-to-bottom-floating"]');
    const contentColumn = document.querySelector('[data-testid="right-pane-content-column"]');
    const overlayLayer = document.querySelector('[data-testid="right-pane-footer-overlay"]');
    const footerSurface = document.querySelector('[data-testid="right-pane-footer-surface"]');
    const main = document.querySelector('[data-testid="right-pane-main"]');
    const conversationPane = document.querySelector('[data-testid="chat-conversation-pane"]');
    const composerDock = document.querySelector('[data-testid="chat-composer-dock"]');
    const composerRoot = document.querySelector('[data-testid="message-input-root"]');
    const viewportRect = viewport?.getBoundingClientRect();
    const buttonRect = floatingButton?.getBoundingClientRect();
    const contentRect = contentColumn?.getBoundingClientRect();
    const footerSurfaceRect = footerSurface?.getBoundingClientRect();
    const mainRect = main?.getBoundingClientRect();
    const composerDockRect = composerDock?.getBoundingClientRect();
    const composerRootRect = composerRoot?.getBoundingClientRect();
    return {
      pageOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      tableClientWidth: tableWrapper?.clientWidth ?? 0,
      tableScrollWidth: tableWrapper?.scrollWidth ?? 0,
      tableWidth: table?.getBoundingClientRect().width ?? 0,
      mermaidClientWidth: mermaidWrapper?.clientWidth ?? 0,
      mermaidScrollWidth: mermaidWrapper?.scrollWidth ?? 0,
      mermaidContentWidth: mermaidContent?.getBoundingClientRect().width ?? 0,
      floatingCenterOffset:
        buttonRect && contentRect ? Math.abs((buttonRect.left + buttonRect.right) / 2 - (contentRect.left + contentRect.right) / 2) : null,
      viewportTopOffset: viewportRect && mainRect ? Math.abs(viewportRect.top - mainRect.top) : null,
      viewportBottomOffset: viewportRect && mainRect ? Math.abs(viewportRect.bottom - mainRect.bottom) : null,
      viewportLeftOffset: viewportRect && mainRect ? Math.abs(viewportRect.left - mainRect.left) : null,
      viewportRightOffset: viewportRect && mainRect ? Math.abs(viewportRect.right - mainRect.right) : null,
      contentBottomSafeArea: contentColumn ? Number.parseFloat(getComputedStyle(contentColumn).paddingBottom) : null,
      footerSurfaceHeight: footerSurfaceRect?.height ?? null,
      overlayBackground: overlayLayer ? getComputedStyle(overlayLayer).backgroundColor : null,
      footerSurfaceBackground: footerSurface ? getComputedStyle(footerSurface).backgroundColor : null,
      paneBackground: conversationPane ? getComputedStyle(conversationPane).backgroundColor : null,
      floatingToFooterGap: buttonRect && footerSurfaceRect ? footerSurfaceRect.top - buttonRect.bottom : null,
      composerLeftOffset: composerDockRect && composerRootRect ? Math.abs(composerRootRect.left - composerDockRect.left) : null,
      composerRightOffset: composerDockRect && composerRootRect ? Math.abs(composerDockRect.right - composerRootRect.right) : null,
      composerWidthDifference: composerDockRect && composerRootRect ? Math.abs(composerDockRect.width - composerRootRect.width) : null,
    };
  });

  expect(narrowState.pageOverflow).toBe(0);
  expect(narrowState.tableScrollWidth).toBeGreaterThan(narrowState.tableClientWidth);
  expect(narrowState.tableWidth).toBeGreaterThanOrEqual(560);
  expect(narrowState.mermaidScrollWidth).toBeGreaterThan(narrowState.mermaidClientWidth);
  expect(narrowState.mermaidScrollWidth).toBeGreaterThanOrEqual(narrowState.mermaidContentWidth);
  expect(narrowState.mermaidContentWidth).toBeGreaterThanOrEqual(560);
  expect(narrowState.floatingCenterOffset).toBeLessThanOrEqual(1);
  expect(narrowState.viewportTopOffset).toBeLessThanOrEqual(1);
  expect(narrowState.viewportBottomOffset).toBeLessThanOrEqual(1);
  expect(narrowState.viewportLeftOffset).toBeLessThanOrEqual(1);
  expect(narrowState.viewportRightOffset).toBeLessThanOrEqual(1);
  expect(Math.abs(narrowState.contentBottomSafeArea - narrowState.footerSurfaceHeight)).toBeLessThanOrEqual(1);
  expect(narrowState.overlayBackground).toBe('rgba(0, 0, 0, 0)');
  expect(narrowState.footerSurfaceBackground).toBe(narrowState.paneBackground);
  expect(narrowState.footerSurfaceBackground).not.toBe('rgba(0, 0, 0, 0)');
  expect(Math.abs(narrowState.floatingToFooterGap)).toBeLessThanOrEqual(1);
  expect(narrowState.composerLeftOffset).toBeLessThanOrEqual(1);
  expect(narrowState.composerRightOffset).toBeLessThanOrEqual(1);
  expect(narrowState.composerWidthDifference).toBeLessThanOrEqual(1);

  const floatingButton = page.getByTestId('chat-scroll-to-bottom-floating');
  await floatingButton.click();
  await expect(floatingButton).toBeHidden();
  const viewport = page.getByTestId('right-pane-scroll-viewport');
  const viewportHeightAtBottom = await viewport.evaluate((element) => element.clientHeight);
  const viewportScrollHeightAtBottom = await viewport.evaluate((element) => element.scrollHeight);
  await viewport.evaluate((element) => {
    element.scrollTop = Math.max(0, element.scrollHeight - element.clientHeight - 48);
    element.dispatchEvent(new Event('scroll', { bubbles: true }));
  });
  await expect(floatingButton).toBeVisible();
  const viewportHeightWithFloatingButton = await viewport.evaluate((element) => element.clientHeight);
  const viewportScrollHeightWithFloatingButton = await viewport.evaluate((element) => element.scrollHeight);
  expect(viewportHeightWithFloatingButton).toBe(viewportHeightAtBottom);
  expect(viewportScrollHeightWithFloatingButton).toBe(viewportScrollHeightAtBottom);
});
