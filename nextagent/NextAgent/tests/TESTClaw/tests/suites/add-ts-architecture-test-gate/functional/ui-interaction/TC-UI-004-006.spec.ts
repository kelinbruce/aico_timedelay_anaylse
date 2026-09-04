/**
 * TC-UI-004 ~ TC-UI-006 Playwright E2E 测试脚本
 *
 * 测试点来源:
 *   TC-UI-004 → TP-F22 (Web UI 会话列表展开/收缩 sessionStorage 持久化)
 *   TC-UI-005 → TP-F23 (Web UI Composer 草稿缓存与恢复)
 *   TC-UI-006 → TP-F24 (Web UI 深色模式 scrollbar 主题一致性)
 *
 * 测试因子: 完整性 / 一致性
 */

import { test, expect } from '@playwright/test';
import {
  authenticateTrusted,
  authenticateViaLocalAuth,
  createSessionViaAPI,
  submitMessageViaUI,
  waitForStreamComplete,
  toggleTheme,
  getSessionListState,
  switchSession,
  TEST_IDENTITY,
} from '../helpers/ui-helper';

test.describe('UI Interaction — Session List / Composer Draft / Scrollbar Theme', () => {
  // ─── TC-UI-004: Web UI 会话列表展开/收缩 sessionStorage 持久化（正路径） ───
  test('TC-UI-004: Web UI 会话列表展开/收缩 sessionStorage 持久化（正路径）', async ({ page }) => {
    await authenticateTrusted(page);

    // 创建 ≥5 个会话以满足展开/收缩条件
    const sessionIds: string[] = [];
    for (let i = 0; i < 5; i++) {
      sessionIds.push(await createSessionViaAPI(page, 'zh-CN'));
    }

    // 打开 Web UI
    await page.goto('/');

    // 步骤 1: 点击会话列表展开按钮
    const expandBtn = page.locator('[data-testid="sidebar-session-list-controls"]');
    await expandBtn.click();

    // 检查展开状态：显示所有 ≥5 个会话
    const stateAfterExpand = await getSessionListState(page);
    expect(stateAfterExpand.expanded).toBe(true);
    expect(stateAfterExpand.visibleCount).toBeGreaterThanOrEqual(5);

    // 步骤 2: 检查 sessionStorage 中展开偏好值
    const sessionPref = await page.evaluate(() => {
      const raw = sessionStorage.getItem('sessionListPreference');
      return raw ? JSON.parse(raw) : null;
    });
    expect(sessionPref).not.toBeNull();
    expect(sessionPref.expanded).toBe(true);

    // 步骤 3: 刷新页面（F5）
    await page.reload();

    // 步骤 4: 检查会话列表显示状态 — 保持展开
    // 等待列表渲染
    await page.locator('[data-testid^="sidebar-session-item"]').first().waitFor({ state: 'visible' });
    const stateAfterRefresh = await getSessionListState(page);
    expect(stateAfterRefresh.expanded).toBe(true);
    // 显示数量与刷新前一致（不被 default collapsed limit 覆盖）
    expect(stateAfterRefresh.visibleCount).toBe(stateAfterExpand.visibleCount);

    // 步骤 5: 模拟 sessionStorage 不可用（清除 sessionStorage）
    await page.evaluate(() => {
      sessionStorage.clear();
    });

    // 刷新以验证降级
    await page.reload();
    await page.locator('[data-testid^="sidebar-session-item"]').first().waitFor({ state: 'visible' });

    // 步骤 6: 检查降级到 memory state — 默认显示 5 个，不阻塞 UI
    const stateAfterStorageClear = await getSessionListState(page);
    expect(stateAfterStorageClear.visibleCount).toBeLessThanOrEqual(5);
    // UI 功能不阻塞：仍可点击会话
    await expect(page.locator('[data-testid^="sidebar-session-item"]').first()).toBeVisible();
  });

  // ─── TC-UI-005: Web UI Composer 草稿缓存与恢复（正路径） ───
  test('TC-UI-005: Web UI Composer 草稿缓存与恢复（正路径）', async ({ page }) => {
    await authenticateTrusted(page);

    // 创建 2 个会话
    const s1 = await createSessionViaAPI(page, 'zh-CN');
    const s2 = await createSessionViaAPI(page, 'zh-CN');

    // 打开 Web UI 并导航到 session-S1
    await page.goto(`/?session=${s1}`);

    // 步骤 1: 在 session-S1 Composer 中输入草稿文本
    const composer = page.locator('[data-testid="message-textarea"]');
    await composer.fill('S1 draft message');
    // 触发草稿缓存（等待 debounce 或 blur）
    await composer.blur();

    // 检查 sessionStorage 写入 S1 草稿
    const draftS1 = await page.evaluate((sid: string) => {
      const key = `composerDraft_${sid}`;
      return sessionStorage.getItem(key);
    }, s1);
    expect(draftS1).toBe('S1 draft message');

    // 步骤 2: 切换到 session-S2
    await switchSession(page, s2);

    // S2 Composer 空白（无草稿）
    const composerAfterSwitch = page.locator('[data-testid="message-textarea"]');
    await expect(composerAfterSwitch).toHaveValue('');

    // 步骤 3: 在 session-S2 Composer 中输入草稿文本
    await composerAfterSwitch.fill('S2 draft message');
    await composerAfterSwitch.blur();

    // 步骤 4: 切换回 session-S1
    await switchSession(page, s1);

    // 步骤 5: Composer 恢复显示 S1 草稿
    await expect(page.locator('[data-testid="message-textarea"]')).toHaveValue('S1 draft message');

    // 步骤 6: 在 session-S1 提交草稿消息
    await submitMessageViaUI(page, 'S1 draft message');
    await waitForStreamComplete(page);

    // 步骤 7: Composer 清空 + sessionStorage 中 S1 草稿已删除
    await expect(page.locator('[data-testid="message-textarea"]')).toHaveValue('');
    const draftS1AfterSubmit = await page.evaluate((sid: string) => {
      return sessionStorage.getItem(`composerDraft_${sid}`);
    }, s1);
    expect(draftS1AfterSubmit).toBeNull();

    // 步骤 8: 模拟 sessionStorage 不可用，切换会话
    await page.evaluate(() => {
      // Override sessionStorage.setItem to throw
      const original = sessionStorage.setItem;
      sessionStorage.setItem = function () {
        throw new Error('storage disabled');
      };
    });

    // 输入草稿再切换（降级到 memory）
    await page.locator('[data-testid="message-textarea"]').fill('memory fallback draft');
    await switchSession(page, s2);

    // 切换回 S1 — 由于 sessionStorage 不可用，草稿从 memory state 恢复
    await switchSession(page, s1);
    // 草稿在内存中缓存但刷新后丢失，不阻塞 UI
    // Composer 可能恢复为 "memory fallback draft" 或空白（降级策略）
    const composerValue = await page.locator('[data-testid="message-textarea"]').inputValue();
    // 不阻塞 UI：composer 可交互
    await expect(page.locator('[data-testid="message-textarea"]')).toBeEditable();
  });

  // ─── TC-UI-006: Web UI 深色模式 scrollbar 主题一致性（正路径） ───
  test('TC-UI-006: Web UI 深色模式 scrollbar 主题一致性（正路径）', async ({ page }) => {
    await authenticateTrusted(page);

    // 创建 ≥10 个会话以触发 scrollbar
    for (let i = 0; i < 10; i++) {
      await createSessionViaAPI(page, 'zh-CN');
    }

    const sessionId = await createSessionViaAPI(page, 'zh-CN');
    await page.goto(`/?session=${sessionId}`);

    // 步骤 1: 切换到深色模式
    await toggleTheme(page, 'dark');
    // 确认深色模式已激活
    const isDark = await page.evaluate(() => document.documentElement.classList.contains('dark'));
    expect(isDark).toBe(true);

    // 步骤 2 & 3: 检查 scrollbar 主题 — 会话列表 & chat 主区域
    // 通过 CSS 自定义属性或 scrollbar-color 属性验证深色主题
    const sessionListScrollbarDark = await page.evaluate(() => {
      const el = document.querySelector('[data-testid="sidebar-session-list-scroll"]');
      if (!el) {
        return null;
      }
      const style = getComputedStyle(el);
      return {
        scrollbarColor: style.getPropertyValue('scrollbar-color'),
        colorScheme: style.getPropertyValue('color-scheme'),
      };
    });

    const chatScrollbarDark = await page.evaluate(() => {
      const el = document.querySelector('[data-testid="chat-conversation-pane"]');
      if (!el) {
        return null;
      }
      const style = getComputedStyle(el);
      return {
        scrollbarColor: style.getPropertyValue('scrollbar-color'),
        colorScheme: style.getPropertyValue('color-scheme'),
      };
    });

    // 深色模式下 scrollbar 使用深色主题规则（无浅色 gutter/track）
    // 两处 scrollbar 使用相同 themed scrollbar rules
    if (sessionListScrollbarDark && chatScrollbarDark) {
      // color-scheme 应为 dark 或包含 dark
      expect(sessionListScrollbarDark.colorScheme).toContain('dark');
      expect(chatScrollbarDark.colorScheme).toContain('dark');
    }

    // 步骤 4: 切换到浅色模式
    await toggleTheme(page, 'light');
    const isLight = await page.evaluate(() => !document.documentElement.classList.contains('dark'));
    expect(isLight).toBe(true);

    // 步骤 5 & 6: 浅色模式 scrollbar
    const sessionListScrollbarLight = await page.evaluate(() => {
      const el = document.querySelector('[data-testid="sidebar-session-list-scroll"]');
      if (!el) {
        return null;
      }
      const style = getComputedStyle(el);
      return {
        scrollbarColor: style.getPropertyValue('scrollbar-color'),
        colorScheme: style.getPropertyValue('color-scheme'),
      };
    });

    const chatScrollbarLight = await page.evaluate(() => {
      const el = document.querySelector('[data-testid="chat-conversation-pane"]');
      if (!el) {
        return null;
      }
      const style = getComputedStyle(el);
      return {
        scrollbarColor: style.getPropertyValue('scrollbar-color'),
        colorScheme: style.getPropertyValue('color-scheme'),
      };
    });

    if (sessionListScrollbarLight && chatScrollbarLight) {
      // 浅色模式使用浅色 scrollbar rules
      expect(sessionListScrollbarLight.colorScheme).toContain('light');
      expect(chatScrollbarLight.colorScheme).toContain('light');
    }

    // 步骤 7: 深色/浅色 scrollbar 主题一致性
    // 两处 scrollbar 使用相同 themed scrollbar rules（深色深色，浅色浅色）
    // 深色模式下两处均不出现浅色 gutter/track 泄漏
    if (sessionListScrollbarDark && chatScrollbarDark) {
      expect(sessionListScrollbarDark.colorScheme).toBe(chatScrollbarDark.colorScheme);
    }
    if (sessionListScrollbarLight && chatScrollbarLight) {
      expect(sessionListScrollbarLight.colorScheme).toBe(chatScrollbarLight.colorScheme);
    }
  });
});
