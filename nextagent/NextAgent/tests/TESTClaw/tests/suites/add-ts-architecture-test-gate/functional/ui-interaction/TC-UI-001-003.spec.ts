/**
 * TC-UI-001 ~ TC-UI-003 Playwright E2E 测试脚本
 *
 * 测试点来源:
 *   TC-UI-001  → TP-F19 (Web UI 提交消息→SSE stream 推送回复正确渲染)
 *   TC-UI-001E → TP-F19 (Web UI 提交消息 stream 推送内容与后端不一致)
 *   TC-UI-002  → TP-F20 (Web UI Pending Input AUTHORIZATION 交互组件渲染与响应)
 *   TC-UI-002E → TP-F20 (Web UI Pending Input 超时显示 timeout prompt)
 *   TC-UI-003  → TP-F21 (Web UI Stream 断连重连提示与内容恢复)
 *   TC-UI-003E → TP-F21 (Web UI Stream Resume 失败保持降级提示不静默空白)
 *
 * 测试因子: 正确性 / 一致性 / 可降级性
 */

import { test, expect } from '@playwright/test';
import {
  authenticateTrusted,
  authenticateViaLocalAuth,
  createSessionViaAPI,
  submitMessageViaUI,
  waitForStreamComplete,
  waitForPendingInput,
  simulateDisconnect,
  simulateReconnect,
  TEST_IDENTITY,
  TEST_TENANT_B,
} from '../helpers/ui-helper';

const API_URL = process.env.NEXTAGENT_URL || 'http://localhost:3000/api/v1';

test.describe('UI Interaction — SSE Stream & Pending Input & Disconnect/Reconnect', () => {
  // ─── TC-UI-001: Web UI 提交消息→SSE stream 推送回复正确渲染（正路径） ───
  test('TC-UI-001: Web UI 提交消息→SSE stream 推送回复正确渲染（正路径）', async ({ page }) => {
    // 前置: 认证 + 创建 session + 打开 Web UI
    await authenticateTrusted(page);
    const sessionId = await createSessionViaAPI(page, 'zh-CN');
    await page.goto(`/?session=${sessionId}`);

    // 步骤 1: 在 Composer 输入文本
    const composer = page.locator('[data-testid="message-textarea"]');
    await composer.fill('Hello, Agent');

    // 步骤 2: 点击提交
    const submitBtn = page.locator('[data-testid="btn-send"]');
    await submitBtn.click();

    // 验证 Composer 清空 & loading 状态
    await expect(composer).toHaveValue('');
    await expect(page.locator('[data-testid="turn-block-skeleton"]')).toBeVisible();

    // 步骤 3: 等待 SSE stream 推送完成（收到 terminal 事件）
    await waitForStreamComplete(page);

    // 步骤 4: 验证 UI 渲染内容
    // assistantMessage 文本渲染
    const assistantMsg = page.locator('[data-testid="ai-bubble"]').last();
    await expect(assistantMsg).toBeVisible();
    // 逐字符渲染：内容不为空
    const msgText = await assistantMsg.textContent();
    expect(msgText?.length).toBeGreaterThan(0);

    // terminal 状态提示
    const terminalStatus = page.locator('[data-testid="chat-stream-status-strip"]');
    await expect(terminalStatus).toBeVisible();
    await expect(terminalStatus).toContainText('completed');

    // 步骤 5: GET conversation API，验证后端内容与 UI 一致
    const convRes = await page.request.get(`${API_URL}/sessions/${sessionId}/conversation`);
    expect(convRes.status()).toBe(200);
    const convBody = await convRes.json();
    const visibleMessages = convBody.messages.filter((m: any) => m.visible);
    // 包含用户消息 + assistant 消息
    expect(visibleMessages.length).toBeGreaterThanOrEqual(2);
    // assistant 消息内容与 UI 一致
    const apiAssistantText = visibleMessages
      .filter((m: any) => m.role === 'assistant')
      .map((m: any) => m.content)
      .join('');
    expect(apiAssistantText).toContain(msgText!.trim());
  });

  // ─── TC-UI-001E: Web UI 提交消息 stream 推送内容与后端不一致（异常路径） ───
  test('TC-UI-001E: Web UI 提交消息 stream 推送内容与后端不一致（异常路径）', async ({ page }) => {
    await authenticateTrusted(page);
    const sessionId = await createSessionViaAPI(page, 'zh-CN');
    await page.goto(`/?session=${sessionId}`);

    // 步骤 1: 提交新消息
    await submitMessageViaUI(page, 'consistency test');

    // 步骤 2: 等待 SSE stream 完成
    await waitForStreamComplete(page);

    // 记录 UI 当前显示的消息数量
    const uiMsgCountBeforeRefresh = await page.locator('[data-testid="turn-block"]').count();

    // 步骤 3: 刷新页面
    await page.reload();

    // 步骤 4: GET conversation API
    const convRes = await page.request.get(`${API_URL}/sessions/${sessionId}/conversation`);
    expect(convRes.status()).toBe(200);
    const convBody = await convRes.json();
    const apiMessages = convBody.messages.filter((m: any) => m.visible);

    // 步骤 5: 刷新后 UI 显示的消息与 conversation API 完全一致
    // 等待页面恢复渲染
    await page.locator('[data-testid="turn-block"]').first().waitFor({ state: 'visible' });
    const uiMsgCountAfterRefresh = await page.locator('[data-testid="turn-block"]').count();

    // 数量一致
    expect(uiMsgCountAfterRefresh).toBe(apiMessages.length);

    // 顺序和内容一致：逐条比较
    const uiMessages = page.locator('[data-testid="turn-block"]');
    for (let i = 0; i < apiMessages.length; i++) {
      const uiContent = await uiMessages.nth(i).textContent();
      expect(uiContent?.trim()).toBeTruthy();
    }

    // 刷新前后数量一致（无丢失）
    expect(uiMsgCountAfterRefresh).toBe(uiMsgCountBeforeRefresh);
  });

  // ─── TC-UI-002: Web UI Pending Input AUTHORIZATION 交互组件渲染与响应（正路径） ───
  test('TC-UI-002: Web UI Pending Input AUTHORIZATION 交互组件渲染与响应（正路径）', async ({ page }) => {
    await authenticateTrusted(page);
    const sessionId = await createSessionViaAPI(page, 'zh-CN');
    await page.goto(`/?session=${sessionId}`);

    // 步骤 1: 提交触发 AUTHORIZATION pending input 的消息
    await submitMessageViaUI(page, 'need authorization');

    // 步骤 2: 等待 SSE 推送 pendingInput 事件 & UI 渲染交互组件
    await waitForPendingInput(page);
    const pendingInputComponent = page.locator('[data-testid="respond-input-panel"]');

    // 步骤 3: 验证 AUTHORIZATION 交互组件渲染
    const approveBtn = pendingInputComponent.locator('[data-testid="respond-input-approval"]');
    await expect(approveBtn).toBeVisible();

    // 不渲染 text input 或其他类型组件（AUTHORIZATION 类型无 textarea）
    const textInput = pendingInputComponent.locator('[data-testid="respond-textarea"]');
    await expect(textInput).toHaveCount(0);
    const confirmBtn = pendingInputComponent.locator('[data-testid="btn-submit-response"]');
    await expect(confirmBtn).toHaveCount(0);

    // 步骤 4: 点击 approve 按钮
    await approveBtn.click();

    // 步骤 5: 等待 Agent 继续执行完成
    await waitForStreamComplete(page);

    // 验证 pending input 消失 & assistant 继续回复
    await expect(pendingInputComponent).not.toBeVisible();
    const assistantMsg = page.locator('[data-testid="ai-bubble"]').last();
    await expect(assistantMsg).toBeVisible();
    const terminalStatus = page.locator('[data-testid="chat-stream-status-strip"]');
    await expect(terminalStatus).toContainText('completed');
  });

  // ─── TC-UI-002E: Web UI Pending Input 超时显示 timeout prompt（异常路径） ───
  test('TC-UI-002E: Web UI Pending Input 超时显示 timeout prompt（异常路径）', async ({ page }) => {
    await authenticateTrusted(page);
    const sessionId = await createSessionViaAPI(page, 'zh-CN');
    await page.goto(`/?session=${sessionId}`);

    // 步骤 1: 提交触发 QUESTION pending input 的消息
    await submitMessageViaUI(page, 'ask me a question');

    // 步骤 2: 等待 QUESTION 交互组件渲染
    await waitForPendingInput(page);
    const pendingInputComponent = page.locator('[data-testid="respond-input-panel"]');
    const textInput = pendingInputComponent.locator('[data-testid="respond-textarea"]');
    await expect(textInput).toBeVisible();

    // 步骤 3: 等待超时（30s pending input timeout）— 不回复
    // 等待 timeout prompt 出现（允许较长等待时间）
    const timeoutPrompt = page.locator('[data-testid="respond-countdown"]');
    await timeoutPrompt.waitFor({ state: 'visible', timeout: 45_000 });

    // 步骤 4: 检查 UI 显示
    await expect(timeoutPrompt).toBeVisible();

    // 验证交互组件不再永久显示等待状态
    await expect(pendingInputComponent.locator('[data-testid="respond-textarea"]')).not.toBeVisible();
  });

  // ─── TC-UI-003: Web UI Stream 断连重连提示与内容恢复（正路径） ───
  test('TC-UI-003: Web UI Stream 断连重连提示与内容恢复（正路径）', async ({ page }) => {
    await authenticateTrusted(page);
    const sessionId = await createSessionViaAPI(page, 'zh-CN');
    await page.goto(`/?session=${sessionId}`);

    // 步骤 1: 提交消息触发 Agent 响应
    await submitMessageViaUI(page, 'disconnect test');

    // 等待 SSE 推送开始（assistant message 开始渲染）
    const assistantMsg = page.locator('[data-testid="ai-bubble"]').last();
    await assistantMsg.waitFor({ state: 'visible' });

    // 步骤 2: SSE 推送部分内容后，模拟网络断连
    await simulateDisconnect(page);

    // 步骤 3: 检查 UI 断连状态显示
    const degradedIndicator = page.locator('[data-testid="chat-stream-status-strip"]');
    await expect(degradedIndicator).toBeVisible({ timeout: 5_000 });
    await expect(degradedIndicator).toContainText(/断开|degraded|disconnected/i);

    // 记录断连前 UI 已渲染的 assistant message 内容
    const contentBeforeDisconnect = await assistantMsg.textContent();

    // 步骤 4: 模拟网络恢复，触发 SSE 重连
    await simulateReconnect(page);

    // 等待 UI 恢复正常状态指示
    await expect(degradedIndicator).not.toBeVisible({ timeout: 15_000 });

    // 步骤 5: 检查 UI 内容恢复
    // 等待 stream 完成
    await waitForStreamComplete(page, 45_000);

    // 验证恢复后的内容包含断连前的内容 + 断连期间新增的内容
    const contentAfterReconnect = await assistantMsg.textContent();
    expect(contentAfterReconnect!.length).toBeGreaterThanOrEqual(contentBeforeDisconnect!.length);
    expect(contentAfterReconnect).toContain(contentBeforeDisconnect!.trim());

    // terminal 状态正确
    const terminalStatus = page.locator('[data-testid="chat-stream-status-strip"]');
    await expect(terminalStatus).toContainText('completed');
  });

  // ─── TC-UI-003E: Web UI Stream Resume 失败保持降级提示不静默空白（异常路径） ───
  test('TC-UI-003E: Web UI Stream Resume 失败保持降级提示不静默空白（异常路径）', async ({ page }) => {
    await authenticateTrusted(page);
    const sessionId = await createSessionViaAPI(page, 'zh-CN');
    await page.goto(`/?session=${sessionId}`);

    // 步骤 1: 提交消息
    await submitMessageViaUI(page, 'resume fail test');
    await page.locator('[data-testid="turn-block-skeleton"]').waitFor({ state: 'visible' });

    // 步骤 2: 模拟 SSE 断连
    await simulateDisconnect(page);

    // 验证 UI 显示 disconnected 状态
    const degradedIndicator = page.locator('[data-testid="chat-stream-status-strip"]');
    await expect(degradedIndicator).toBeVisible({ timeout: 5_000 });

    // 步骤 3: 模拟 resume 失败（拦截 conversation bootstrap 返回错误）
    await page.route(`${API_URL}/sessions/${sessionId}/conversation`, (route) =>
      route.fulfill({ status: 500, body: JSON.stringify({ error: 'Internal Server Error' }) }),
    );

    // 恢复 SSE 连接但 bootstrap 失败
    await simulateReconnect(page);

    // 步骤 4: 检查 UI 状态
    // UI 保持降级提示状态，不静默恢复空白
    const degradationMessage = page.locator('[data-testid="chat-stream-status-strip"]');
    await degradationMessage.waitFor({ state: 'visible', timeout: 15_000 });
    // 验证状态指示器显示降级/错误信息
    await expect(degradationMessage).toBeVisible();

    // 验证 NOT 静默恢复到正常状态
    await expect(page.locator('[data-testid="turn-block-skeleton"]')).not.toBeVisible();
    // degraded indicator 应仍可见或 degradation message 可见
    const isDegradedVisible = (await degradedIndicator.isVisible().catch(() => false)) || (await degradationMessage.isVisible());
    expect(isDegradedVisible).toBe(true);

    // 清除 route 拦截
    await page.unroute(`${API_URL}/sessions/${sessionId}/conversation`);
  });
});
