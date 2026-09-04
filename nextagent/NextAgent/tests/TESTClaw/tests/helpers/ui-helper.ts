/**
 * Playwright E2E 测试共用工具 — NextAgent TS Web UI
 *
 * 提供页面导航、消息提交、SSE 监听等基础 UI 操作，
 * 所有 Playwright 测试用例共享此 helper。
 *
 * ⚠️ 真实 API 规则:
 *   - /health 无前缀（非 /api/v1/health）
 *   - /api/v1/* 业务 API 带前缀
 *   - 默认 trusted identity 模式（localAuth.enabled=false），无需认证
 *   - Create session: body = { locale? }
 */

import { Page, Locator, expect } from '@playwright/test';

const BASE_URL = process.env.NEXTAGENT_URL || 'http://localhost:3000';
const API_URL = `${BASE_URL}/api/v1`;

/**
 * Trusted identity 模式下的认证 — 默认配置无需认证
 * 直接创建 session 即可，身份从 server config 注入
 */
export async function authenticateTrusted(page: Page): Promise<void> {
  // Trusted identity mode: no auth needed, identity injected from server config
  // Just visit the page to establish context
  await page.goto(BASE_URL);
}

/**
 * 通过 Local Auth 登录并获取 auth cookie（仅在 localAuth.enabled=true 时可用）
 * 路径: /api/v1/auth/local/login
 */
export async function authenticateViaLocalAuth(
  page: Page,
  tenantId: string = 'local-tenant',
  subjectId: string = 'local-subject',
  password?: string,
): Promise<void> {
  const res = await page.request.post(`${API_URL}/auth/local/login`, {
    data: { tenantId, subjectId, password: password ?? 'test-password' },
  });
  expect(res.status()).toBe(200);

  // Extract and inject cookies into page context
  const setCookies = res.headersArray().filter((h) => h.name === 'set-cookie');
  for (const cookieHeader of setCookies) {
    const cookie = cookieHeader.value.split(';')[0];
    const [name, value] = cookie.split('=');
    await page.context().addCookies([
      {
        name,
        value,
        domain: 'localhost',
        path: '/',
      },
    ]);
  }
}

/**
 * 通过 API 创建 session
 * 真实 API: POST /api/v1/sessions body={locale?}
 */
export async function createSessionViaAPI(page: Page, locale?: string): Promise<string> {
  const res = await page.request.post(`${API_URL}/sessions`, {
    data: locale ? { locale } : {},
  });
  expect(res.status()).toBe(200);
  const body = await res.json();
  return body.sessionId as string;
}

/**
 * 在 Web UI Composer 中输入文本并提交
 */
export async function submitMessageViaUI(page: Page, text: string): Promise<void> {
  const composer = page.locator('[data-testid="composer-input"]');
  await composer.fill(text);

  const submitBtn = page.locator('[data-testid="composer-submit"]');
  await submitBtn.click();
}

/**
 * 等待 SSE stream 推送完成（收到 terminal 事件）
 */
export async function waitForStreamComplete(page: Page, timeoutMs = 30_000): Promise<void> {
  await page.locator('[data-testid="terminal-status"]').waitFor({ state: 'visible', timeout: timeoutMs });
}

/**
 * 等待特定文本出现在对话区
 */
export async function waitForMessageText(page: Page, text: string, timeoutMs = 30_000): Promise<void> {
  await page.locator('.message-content').filter({ hasText: text }).waitFor({ timeout: timeoutMs });
}

// 测试常量
export const TEST_IDENTITY = {
  tenantId: 'local-tenant',
  subjectId: 'local-subject',
  displayName: 'Local developer',
};

export const TEST_AGENT = {
  agentId: 'default-agent',
  agentVersion: 'v1',
  displayName: 'NextAgent telecom agent',
  defaultLanguage: 'zh-CN',
};

// ⚠️ 以下为测试用 stub/placeholder，待真实 UI 实现后替换
export const TEST_TENANT_B = {
  tenantId: 'tenant-b',
  subjectId: 'user-b',
};

/** 等待 Pending Input UI 元素出现 */
export async function waitForPendingInput(page: Page, timeoutMs = 30_000): Promise<void> {
  await page.locator('[data-testid="pending-input-card"]').waitFor({ state: 'visible', timeout: timeoutMs });
}

/** 模拟 SSE 断连 */
export async function simulateDisconnect(page: Page): Promise<void> {
  // TODO: 需要真实 UI 实现后补充
  await page.evaluate(() => {
    const es = (window as any).__eventSource as EventSource;
    if (es) {
      es.close();
    }
  });
}

/** 模拟 SSE 重连 */
export async function simulateReconnect(page: Page): Promise<void> {
  // TODO: 需要真实 UI 实现后补充
  await page.evaluate(() => {
    const sid = (window as any).__sessionId as string;
    if (sid) {
      const es = new EventSource(`/api/v1/sessions/${sid}/stream`);
      (window as any).__eventSource = es;
    }
  });
}

/** 切换深色/浅色主题 */
export async function toggleTheme(page: Page): Promise<void> {
  await page.locator('[data-testid="theme-toggle-btn"]').click();
}

/** 获取会话列表 UI 状态 */
export async function getSessionListState(page: Page): Promise<{ expanded: boolean; visibleCount: number }> {
  // TODO: 需要真实 UI 实现后补充
  const items = await page.locator('[data-testid="session-list-item"]').count();
  const expanded = await page.locator('[data-testid="session-list-expanded"]').isVisible();
  return { expanded, visibleCount: items };
}

/** 切换到指定会话 */
export async function switchSession(page: Page, sessionId: string): Promise<void> {
  await page.locator(`[data-session-id="${sessionId}"]`).click();
}
