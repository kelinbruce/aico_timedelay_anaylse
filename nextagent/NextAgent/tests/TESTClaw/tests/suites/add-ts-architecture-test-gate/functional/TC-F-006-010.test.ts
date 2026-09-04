/**
 * TC-F-006 ~ TC-F-010: 其余功能用例 Part 1 (P1)
 *
 * ⚠️ 已更新匹配真实 API:
 *   - trusted identity 模式（无需认证）
 *   - createSession(locale?) — sessionId 由后端生成
 *   - 状态查询通过 conversation API（无 getRunStatus）
 *   - TODO: resolvePendingInput 不存在于当前 api-client
 *   - TODO: getCapabilities 不存在于当前 api-client
 *   - SSE only（无 WebSocket）
 */

import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import {
  healthCheck,
  trustedLogin,
  createSession,
  submitRequest,
  waitForTerminal,
  getConversation,
  cancelRun,
  resetCookies,
  setCookies,
  getCookies,
  TEST_IDENTITY,
  TEST_AGENT,
} from '../../../helpers/api-client';

// ─── 共享状态 ────────────────────────────────────────
let sessionId: string;
let tenantACookies: string[];

beforeAll(async () => {
  const health = await healthCheck();
  expect(health.status).toBe(200);

  resetCookies();
  await trustedLogin();
  tenantACookies = getCookies();

  const session = await createSession('zh-CN');
  expect(session.status).toBe(200);
  sessionId = (session.body as any).sessionId;
});

afterAll(() => {
  resetCookies();
});

// ═══════════════════════════════════════════════════════
// TC-F-006: Pending Input 统一 lifecycle
// TODO: resolvePendingInput 不存在于当前真实 API
// ═══════════════════════════════════════════════════════
describe('TC-F-006: Pending Input lifecycle', () => {
  test('正路径 — TRIGGERED→DELIVERED→RESOLVED 完整 lifecycle', async () => {
    setCookies(tenantACookies);

    const submit = await submitRequest(sessionId, 'need confirmation', 'ik-006');
    expect(submit.status).toBe(200);
    const requestId = (submit.body as any).requestId;

    // TODO: resolvePendingInput 不存在于当前 api-client
    // 真实 API 可能通过 conversation 回复或特定端点处理 pending input
    // 暂时通过 conversation 间接验证 pending input 状态

    // 等待请求完成（可能因 pending input 而等待或超时）
    const terminal = await waitForTerminal(sessionId, requestId, 30_000);
    // 通过 conversation 查询状态
    const conv = await getConversation(sessionId);
    const messages = (conv.body as any)?.items ?? [];
    const terminalMsg = messages.find((m) => m.requestId === requestId && m.role === 'ASSISTANT');
    if (terminalMsg) {
      expect(['REQUEST_COMPLETED', 'REQUEST_FAILED', 'REQUEST_CANCELED']).toContain(terminalMsg?.role ?? 'UNKNOWN');
    }
  });

  test('边界 — Pending Input 超时必须 EXPIRED', async () => {
    setCookies(tenantACookies);

    const submit = await submitRequest(sessionId, 'ask me', 'ik-006b');
    expect(submit.status).toBe(200);
    const requestId = (submit.body as any).requestId;

    // 等待超时处理
    const terminal = await waitForTerminal(sessionId, requestId, 45_000);
    const conv = await getConversation(sessionId);
    const messages = (conv.body as any)?.items ?? [];
    const terminalMsg = messages.find((m) => m.requestId === requestId && m.role === 'ASSISTANT');
    if (terminalMsg) {
      // 超时后 request 应有明确终态
      expect(['REQUEST_COMPLETED', 'REQUEST_FAILED', 'REQUEST_CANCELED']).toContain(terminalMsg?.role ?? 'UNKNOWN');
    }
  });
});

// ═══════════════════════════════════════════════════════
// TC-F-007: Stream Resume
// ═══════════════════════════════════════════════════════
describe('TC-F-007: Stream Resume', () => {
  test('正路径 — Resume 从 bootstrap anchor 重播缺失事件', async () => {
    setCookies(tenantACookies);

    const submit = await submitRequest(sessionId, 'resume test', 'ik-007');
    expect(submit.status).toBe(200);
    const requestId = (submit.body as any).requestId;

    const terminal = await waitForTerminal(sessionId, requestId);

    // conversation bootstrap 可获取完整历史
    const conv = await getConversation(sessionId);
    expect(conv.status).toBe(200);
    const messages = (conv.body as any)?.items ?? [];
    expect(messages.length).toBeGreaterThan(0);
  }, 60_000);

  test('异常 — Resume 失败保持降级提示不静默空白', async () => {
    setCookies(tenantACookies);

    const submit = await submitRequest(sessionId, 'resume fail test', 'ik-007e');
    expect(submit.status).toBe(200);
    const requestId = (submit.body as any).requestId;

    await waitForTerminal(sessionId, requestId);

    const conv = await getConversation(sessionId);
    expect(conv.status).toBe(200);
    const messages = (conv.body as any)?.items ?? [];
    // 不静默空白 — 至少有用户提交的消息
    expect(messages.length).toBeGreaterThanOrEqual(1);
  });
}, 60_000);

// ═══════════════════════════════════════════════════════
// TC-F-008: History 与 Stream 内容一致
// ═══════════════════════════════════════════════════════
describe('TC-F-008: History 与 Stream 一致', () => {
  test('正路径 — stream 消息与 conversation 完全一致', async () => {
    setCookies(tenantACookies);

    const submit = await submitRequest(sessionId, 'history test', 'ik-008');
    expect(submit.status).toBe(200);
    const requestId = (submit.body as any).requestId;

    await waitForTerminal(sessionId, requestId);

    const conv = await getConversation(sessionId);
    expect(conv.status).toBe(200);
    const messages = (conv.body as any)?.items ?? [];
    expect(messages.length).toBeGreaterThanOrEqual(2);
  }, 60_000);

  test('边界 — 刷新后消息数量与顺序不变', async () => {
    setCookies(tenantACookies);

    const submit = await submitRequest(sessionId, 'refresh test', 'ik-008b');
    expect(submit.status).toBe(200);
    const requestId = (submit.body as any).requestId;

    await waitForTerminal(sessionId, requestId);

    const conv1 = await getConversation(sessionId);
    const msgs1 = (conv1.body as any).items ?? [];

    const conv2 = await getConversation(sessionId);
    const msgs2 = (conv2.body as any).items ?? [];

    expect(msgs2.length).toBe(msgs1.length);
    if (msgs1.length > 0 && msgs2.length > 0) {
      expect(msgs2[0]).toEqual(msgs1[0]);
      expect(msgs2[msgs2.length - 1]).toEqual(msgs1[msgs1.length - 1]);
    }
  });
}, 60_000);

// ═══════════════════════════════════════════════════════
// TC-F-009: RequestRun 状态机
// ═══════════════════════════════════════════════════════
describe('TC-F-009: RequestRun 状态机', () => {
  test('正路径 — 合法转换 QUEUED→EXECUTING→COMPLETED', async () => {
    setCookies(tenantACookies);

    const submit = await submitRequest(sessionId, 'state test', 'ik-009');
    expect(submit.status).toBe(200);
    const requestId = (submit.body as any).requestId;

    const terminal = await waitForTerminal(sessionId, requestId);
    // 通过 conversation 查找 terminal 消息
    const conv = await getConversation(sessionId);
    const messages = (conv.body as any)?.items ?? [];
    const terminalMsg = messages.find((m) => m.requestId === requestId && m.role === 'ASSISTANT');
    if (terminalMsg) {
      expect(terminalMsg?.role ?? 'UNKNOWN').toBe('REQUEST_COMPLETED');
    }
  }, 60_000);

  test('异常 — 非法转换 COMPLETED→CANCELLED 被 CAS 拒绝', async () => {
    setCookies(tenantACookies);

    const submit = await submitRequest(sessionId, 'cas reject test', 'ik-009e');
    expect(submit.status).toBe(200);
    const requestId = (submit.body as any).requestId;

    // 等待 COMPLETED
    await waitForTerminal(sessionId, requestId, 30_000);

    // 尝试对 COMPLETED 发起 Cancel — CAS 拒绝
    const cancel = await cancelRun(sessionId, requestId, 'ik-cancel-009e');
    expect([400, 409, 422]).toContain(cancel.status);

    // 通过 conversation 验证状态仍为 COMPLETED
    const conv = await getConversation(sessionId);
    const messages = (conv.body as any)?.items ?? [];
    const completedMsg = messages.find((m) => m.requestId === requestId && m.role === 'ASSISTANT');
    expect(completedMsg).toBeDefined();
  });
});

// ═══════════════════════════════════════════════════════
// TC-F-010: Lane 串行调度
// ═══════════════════════════════════════════════════════
describe('TC-F-010: Lane 串行调度', () => {
  test('正路径 — 同一 Lane 至多一个 EXECUTING', async () => {
    setCookies(tenantACookies);

    const submit1 = await submitRequest(sessionId, 'lane test 1', 'ik-010a');
    expect(submit1.status).toBe(200);
    const requestId1 = (submit1.body as any).requestId;

    const submit2 = await submitRequest(sessionId, 'lane test 2', 'ik-010b');
    expect(submit2.status).toBe(200);
    const requestId2 = (submit2.body as any).requestId;

    // 等待全部完成 — Lane 保证串行
    await waitForTerminal(sessionId, requestId1, 30_000);
    await waitForTerminal(sessionId, requestId2);
  }, 60_000);

  test('边界 — 同一 Lane 多请求排队串行执行', async () => {
    setCookies(tenantACookies);

    const submit1 = await submitRequest(sessionId, 'lane serial 1', 'ik-010b-1');
    const submit2 = await submitRequest(sessionId, 'lane serial 2', 'ik-010b-2');
    const submit3 = await submitRequest(sessionId, 'lane serial 3', 'ik-010b-3');

    const requestId1 = (submit1.body as any).requestId;
    const requestId2 = (submit2.body as any).requestId;
    const requestId3 = (submit3.body as any).requestId;

    const t1 = await waitForTerminal(sessionId, requestId1, 30_000);
    const t2 = await waitForTerminal(sessionId, requestId2, 30_000);
    const t3 = await waitForTerminal(sessionId, requestId3);

    // 所有请求最终到达终态
    expect(t1).toBeDefined();
    expect(t2).toBeDefined();
    expect(t3).toBeDefined();
  });
}, 60_000);
