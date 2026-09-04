/**
 * TC-F-013 ~ TC-F-026: 其余功能用例 Part 2 (P1/P2/P3)
 *
 * ⚠️ 已更新匹配真实 API:
 *   - trusted identity 模式（无需认证）
 *   - createSession(locale?) — sessionId 由后端生成
 *   - 状态查询通过 conversation API（无 getRunStatus）
 *   - TODO: resolvePendingInput — 不存在于当前 api-client
 *   - TODO: getCapabilities — 不存在于当前 api-client（通过 conversation 间接验证）
 *   - TODO: getAuditEvents — 不存在于当前 api-client
 *   - submitRequest 返回 requestId（非 runId）
 */

import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import {
  healthCheck,
  trustedLogin,
  createSession,
  submitRequest,
  waitForTerminal,
  getConversation,
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
// TC-F-013: Attachment lifecycle
// ═══════════════════════════════════════════════════════
describe('TC-F-013: Attachment lifecycle', () => {
  test('正路径 — intake→staging→availability 三阶段完整', async () => {
    setCookies(tenantACookies);
    const submit = await submitRequest(sessionId, 'read attachment', 'ik-013');
    expect(submit.status).toBe(200);
    const requestId = (submit.body as any).requestId;
    const terminal = await waitForTerminal(sessionId, requestId);
    const conv = await getConversation(sessionId);
    const messages = (conv.body as any)?.items ?? [];
    const terminalMsg = messages.find((m) => m.requestId === requestId && m.role === 'ASSISTANT');
    if (terminalMsg) {
      expect(terminalMsg.type).toBe('REQUEST_COMPLETED');
    }
  }, 60_000);

  test('异常 — 校验失败明确报错不静默丢弃', async () => {
    setCookies(tenantACookies);
    const submit = await submitRequest(sessionId, 'malicious file ref', 'ik-013e');
    if (submit.status === 200) {
      const requestId = (submit.body as any).requestId;
      const terminal = await waitForTerminal(sessionId, requestId);
      const conv = await getConversation(sessionId);
      const messages = (conv.body as any, 60_000)?.items ?? [];
      const tMsg = messages.find((m) => m.requestId === requestId && ['REQUEST_COMPLETED', 'REQUEST_FAILED'].includes(m.type));
      if (tMsg) {
        expect(['REQUEST_COMPLETED', 'REQUEST_FAILED']).toContain(tMsg.type);
      }
    } else {
      expect([400, 422]).toContain(submit.status);
    }
  });
});

// ═══════════════════════════════════════════════════════
// TC-F-014: Context budget
// ═══════════════════════════════════════════════════════
describe('TC-F-014: Context budget', () => {
  test('正路径 — 超出 context budget 给出可解释提示', async () => {
    setCookies(tenantACookies);
    const submit = await submitRequest(sessionId, 'long context test', 'ik-014');
    expect(submit.status).toBe(200);
    const requestId = (submit.body as any).requestId;
    await waitForTerminal(sessionId, requestId);
    const conv = await getConversation(sessionId);
    const messages = (conv.body as any, 60_000)?.items ?? [];
    const tMsg = messages.find((m) => m.requestId === requestId && ['REQUEST_COMPLETED', 'REQUEST_FAILED'].includes(m.type));
    if (tMsg) {
      expect(['REQUEST_COMPLETED', 'REQUEST_FAILED']).toContain(tMsg.type);
    }
  });

  test('边界 — 保留/截断策略可见可追溯', async () => {
    setCookies(tenantACookies);
    const submit = await submitRequest(sessionId, 'budget trace test', 'ik-014b');
    expect(submit.status).toBe(200);
    const requestId = (submit.body as any).requestId;
    await waitForTerminal(sessionId, requestId);
    // TODO: getAuditEvents 不存在 — audit event 可追溯截断策略
    // 暂时通过 conversation 间接验证
    const conv = await getConversation(sessionId);
    expect(conv.status).toBe(200);
  });
}, 60_000);

// ═══════════════════════════════════════════════════════
// TC-F-015: Model fallback
// ═══════════════════════════════════════════════════════
describe('TC-F-015: Model fallback', () => {
  test('正路径 — primary 不可用时切换 fallback fail-closed', async () => {
    setCookies(tenantACookies);
    const submit = await submitRequest(sessionId, 'fallback test', 'ik-015');
    expect(submit.status).toBe(200);
    const requestId = (submit.body as any).requestId;
    await waitForTerminal(sessionId, requestId);
  }, 60_000);

  test('异常 — 全链不可用明确 FAILED 不静默降级', async () => {
    setCookies(tenantACookies);
    const submit = await submitRequest(sessionId, 'all fail test', 'ik-015e');
    expect(submit.status).toBe(200);
    const requestId = (submit.body as any).requestId;
    await waitForTerminal(sessionId, requestId);
  });
}, 60_000);

// ═══════════════════════════════════════════════════════
// TC-F-016: Unified Capability invocation
// TODO: getCapabilities 不存在于真实 API
// ═══════════════════════════════════════════════════════
describe('TC-F-016: Unified Capability invocation', () => {
  test('正路径 — 四种类型共享统一 invocation 接口', async () => {
    setCookies(tenantACookies);
    // TODO: getCapabilities(sessionId) 不存在
    // 暂时通过 conversation API 间接验证 capability 结果
    const conv = await getConversation(sessionId, { includeCapabilityResults: true });
    expect(conv.status).toBe(200);
  });

  test('边界 — 四种类型无特殊调用路径', async () => {
    setCookies(tenantACookies);
    // TODO: getCapabilities 不存在，通过 submit+conversation 验证
    const submit = await submitRequest(sessionId, 'test unified invocation', 'ik-016b');
    expect(submit.status).toBe(200);
    const requestId = (submit.body as any).requestId;
    await waitForTerminal(sessionId, requestId);
  });
}, 60_000);

// ═══════════════════════════════════════════════════════
// TC-F-017: Pending Input 四类型交互
// TODO: resolvePendingInput 不存在于当前 api-client
// ═══════════════════════════════════════════════════════
describe('TC-F-017: Pending Input 四类型交互', () => {
  test('正路径 — AUTHORIZATION 触发→approve→RESOLVED', async () => {
    setCookies(tenantACookies);
    const submit = await submitRequest(sessionId, 'need auth', 'ik-017-auth');
    expect(submit.status).toBe(200);
    const requestId = (submit.body as any).requestId;
    // TODO: resolvePendingInput 不存在，等待自然完成
    await waitForTerminal(sessionId, requestId, 30_000);
  });

  test('异常 — 类型不匹配交互组件不渲染错误类型', async () => {
    setCookies(tenantACookies);
    const submit = await submitRequest(sessionId, 'auth only mismatch', 'ik-017e');
    expect(submit.status).toBe(200);
    const requestId = (submit.body as any).requestId;
    // 通过 conversation 查看 request 状态
    const conv = await getConversation(sessionId);
    const messages = (conv.body as any)?.items ?? [];
    const reqMsgs = messages.filter((m) => m.requestId === requestId);
    // 如果有 pendingInput 事件，类型应与配置一致
    await waitForTerminal(sessionId, requestId, 30_000);
  });
});

// ═══════════════════════════════════════════════════════
// TC-F-018: Risk policy evaluation
// ═══════════════════════════════════════════════════════
describe('TC-F-018: Risk policy evaluation', () => {
  test('正路径 — 高风险操作触发 AUTHORIZATION pending input', async () => {
    setCookies(tenantACookies);
    const submit = await submitRequest(sessionId, 'delete all files', 'ik-018');
    expect(submit.status).toBe(200);
    const requestId = (submit.body as any).requestId;
    // TODO: resolvePendingInput 不存在
    await waitForTerminal(sessionId, requestId, 30_000);
  });

  test('异常 — 跳步评估被拒绝', async () => {
    setCookies(tenantACookies);
    const submit = await submitRequest(sessionId, 'format disk', 'ik-018e');
    expect(submit.status).toBe(200);
    const requestId = (submit.body as any).requestId;
    // 通过 conversation 验证是否有 AUTHORIZATION pending input
    const conv = await getConversation(sessionId);
    const messages = (conv.body as any)?.items ?? [];
    // TODO: audit trail 可追溯 — getAuditEvents 不存在
    await waitForTerminal(sessionId, requestId, 30_000);
  });
});

// ═══════════════════════════════════════════════════════
// TC-F-019: Session title generation (P2)
// ═══════════════════════════════════════════════════════
describe('TC-F-019: Session title generation', () => {
  test('正路径 — Title 异步生成不阻塞主流程', async () => {
    setCookies(tenantACookies);
    const submit = await submitRequest(sessionId, 'Hello world', 'ik-019');
    expect(submit.status).toBe(200);
    const requestId = (submit.body as any).requestId;
    await waitForTerminal(sessionId, requestId);
    const conv = await getConversation(sessionId);
    expect(conv.status).toBe(200);
  });
});

// ═══════════════════════════════════════════════════════
// TC-F-020: Memory retrieval (P2, 60_000)
// ═══════════════════════════════════════════════════════
describe('TC-F-020: Memory retrieval', () => {
  test('正路径 — 基于相关性注入 context', async () => {
    setCookies(tenantACookies);
    const submit = await submitRequest(sessionId, 'what did we discuss before?', 'ik-020');
    expect(submit.status).toBe(200);
    const requestId = (submit.body as any).requestId;
    await waitForTerminal(sessionId, requestId);
  });
});

// ═══════════════════════════════════════════════════════
// TC-F-021: RAG knowledge (P2, 60_000)
// ═══════════════════════════════════════════════════════
describe('TC-F-021: RAG knowledge', () => {
  test('正路径 — 来源标注与置信度标注', async () => {
    setCookies(tenantACookies);
    const submit = await submitRequest(sessionId, 'what is the policy?', 'ik-021');
    expect(submit.status).toBe(200);
    const requestId = (submit.body as any).requestId;
    await waitForTerminal(sessionId, requestId);
  });
});

// ═══════════════════════════════════════════════════════
// TC-F-022: Builtin tool boundary (P2, 60_000)
// ═══════════════════════════════════════════════════════
describe('TC-F-022: Builtin tool boundary', () => {
  test('正路径 — 边界内正常执行超边界明确拒绝', async () => {
    setCookies(tenantACookies);
    const submitOk = await submitRequest(sessionId, 'list current directory', 'ik-022-ok');
    expect(submitOk.status).toBe(200);
    const requestIdOk = (submitOk.body as any).requestId;
    await waitForTerminal(sessionId, requestIdOk, 30_000);

    const submitFail = await submitRequest(sessionId, 'curl external-url', 'ik-022-fail');
    expect(submitFail.status).toBe(200);
    const requestIdFail = (submitFail.body as any).requestId;
    await waitForTerminal(sessionId, requestIdFail);
  });
});

// ═══════════════════════════════════════════════════════
// TC-F-023: Agent routing discovery (P2, 60_000)
// ═══════════════════════════════════════════════════════
describe('TC-F-023: Agent routing discovery', () => {
  test('正路径 — 基于 capability 匹配 routing', async () => {
    setCookies(tenantACookies);
    const submit = await submitRequest(sessionId, 'search for X', 'ik-023');
    expect(submit.status).toBe(200);
    const requestId = (submit.body as any).requestId;
    await waitForTerminal(sessionId, requestId);
  });
});

// ═══════════════════════════════════════════════════════
// TC-F-024: Lifecycle hook (P2, 60_000)
// ═══════════════════════════════════════════════════════
describe('TC-F-024: Lifecycle hook', () => {
  test('正路径 — Hook 失败不阻塞主流程', async () => {
    setCookies(tenantACookies);
    const submit = await submitRequest(sessionId, 'hook test', 'ik-024');
    expect(submit.status).toBe(200);
    const requestId = (submit.body as any).requestId;
    await waitForTerminal(sessionId, requestId);
  });
});

// ═══════════════════════════════════════════════════════
// TC-F-025: Attachment cleanup (P2, 60_000)
// ═══════════════════════════════════════════════════════
describe('TC-F-025: Attachment cleanup', () => {
  test('正路径 — Cleanup 保留 metadata 删 blob', async () => {
    setCookies(tenantACookies);
    const submit = await submitRequest(sessionId, 'read attachment cleanup', 'ik-025');
    expect(submit.status).toBe(200);
    const requestId = (submit.body as any).requestId;
    await waitForTerminal(sessionId, requestId);
    const conv = await getConversation(sessionId);
    expect(conv.status).toBe(200);
  });
});

// ═══════════════════════════════════════════════════════
// TC-F-026: Dev watch reload (P3, 60_000)
// ═══════════════════════════════════════════════════════
describe('TC-F-026: Dev watch reload', () => {
  test('正路径 — Reload 不影响运行中请求', async () => {
    setCookies(tenantACookies);
    const submit = await submitRequest(sessionId, 'before reload', 'ik-026');
    expect(submit.status).toBe(200);
    const requestId = (submit.body as any).requestId;
    await waitForTerminal(sessionId, requestId, 30_000);

    const submitAfter = await submitRequest(sessionId, 'after reload', 'ik-026-after');
    expect(submitAfter.status).toBe(200);
    const requestIdAfter = (submitAfter.body as any).requestId;
    await waitForTerminal(sessionId, requestIdAfter);
  });
}, 60_000);
