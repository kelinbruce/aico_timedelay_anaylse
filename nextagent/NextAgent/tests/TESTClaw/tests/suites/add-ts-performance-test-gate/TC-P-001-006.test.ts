/**
 * TC-P-001 ~ TC-P-004: NextAgent TS 后端性能测试全部用例
 *
 * 测试点来源: TP-P01 (Submit 响应延迟), TP-P02 (Cancel/Retry 传播延迟), TP-P03 (并发 Lane 冲突调度), TP-P04 (TTFT 指标可度量)
 * 测试因子: 时效性
 * 测试经验: TE-07 (时效性度量), TE-01 (并发竞争时效性)
 *
 * 用例覆盖:
 *   TC-P-001  — Submit 响应延迟 ≤100ms（正路径） (P1)
 *   TC-P-001E — 高并发下 Submit 响应延迟 ≤100ms（异常路径） (P1)
 *   TC-P-002  — Cancel/Retry 传播延迟 ≤100ms（正路径） (P1)
 *   TC-P-002E — EXECUTING 状态下 Cancel 传播延迟 ≤100ms（边界路径） (P1)
 *   TC-P-003  — 并发 Lane 冲突调度正确串行化（正路径） (P2)
 *   TC-P-004  — TTFT 指标可度量且可聚合（正路径） (P2)
 */

import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import {
  healthCheck,
  trustedLogin,
  createSession,
  submitRequest,
  getConversation,
  waitForTerminal,
  cancelRun,
  retryRun,
  connectStream,
  resetCookies,
  setCookies,
  getCookies,
  TEST_IDENTITY,
  TEST_AGENT,
} from '../../helpers/api-client';

// ---------------------------------------------------------------------------
// 共享状态
// ---------------------------------------------------------------------------
let cookieA: string[] = [];
let sessionId: string;
let sessionIdCancel: string;
let sessionIdLane: string;
let sessionIdTTFT: string;

// ---------------------------------------------------------------------------
// 全局前置：认证 + 创建 session
// ---------------------------------------------------------------------------
beforeAll(async () => {
  const health = await healthCheck();
  expect(health.status).toBe(200);

  resetCookies();
  await trustedLogin();
  cookieA = getCookies();

  setCookies(cookieA);
  const resSubmit = await createSession();
  sessionId = (resSubmit.body as any).sessionId;
  const resCancel = await createSession();
  sessionIdCancel = (resCancel.body as any).sessionId;
  const resLane = await createSession();
  sessionIdLane = (resLane.body as any).sessionId;
  const resTTFT = await createSession();
  sessionIdTTFT = (resTTFT.body as any).sessionId;
}, 30_000);

afterAll(() => {
  resetCookies();
});

// ---------------------------------------------------------------------------
// Helper: 计算百分位数
// ---------------------------------------------------------------------------
function percentile(arr: number[], p: number): number {
  const sorted = arr.sort((a, b) => a - b);
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

// =========================== TC-P-001 ======================================
describe('TC-P-001: Submit 响应延迟 ≤100ms（正路径）', () => {
  const latencies: number[] = [];

  test('批量 100 次 Submit 全部返回 202', async () => {
    setCookies(cookieA);
    for (let i = 1; i <= 100; i++) {
      const start = performance.now();
      const res = await submitRequest(sessionId, `perf-test-submit-${i}`, `key-perf-submit-${i}`);
      const end = performance.now();
      latencies.push(end - start);
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('requestId');
      expect(res.body).toHaveProperty('runId');
    }
  });

  test('P99 响应延迟 ≤100ms，P95 ≤80ms', () => {
    const p99 = percentile(latencies, 99);
    const p95 = percentile(latencies, 95);
    const max = Math.max(...latencies);

    expect(p99).toBeLessThanOrEqual(100);
    expect(p95).toBeLessThanOrEqual(80);
    expect(max).toBeLessThanOrEqual(150);
  });
});

// =========================== TC-P-001E =====================================
describe('TC-P-001E: 高并发下 Submit 响应延迟 ≤100ms（异常路径）', () => {
  const concurrentLatencies: number[] = [];

  beforeAll(async () => {
    setCookies(cookieA);
    // 先创建一个 EXECUTING 状态的 run（Lane 占用）
    const execRes = await submitRequest(sessionId, 'lane-occupying request', 'key-perf-lane-occ');
    await new Promise((r) => setTimeout(r, 1000)); // 等待进入 EXECUTING
  });

  test('并发 50 次 Submit 在 Lane 占用下全部返回 202', async () => {
    setCookies(cookieA);
    const promises: Promise<void>[] = [];

    for (let i = 1; i <= 50; i++) {
      promises.push(
        (async () => {
          const start = performance.now();
          const res = await submitRequest(sessionId, `perf-concurrent-${i}`, `key-perf-conc-${i}`);
          const end = performance.now();
          concurrentLatencies.push(end - start);
          expect(res.status).toBe(200);
        })(),
      );
    }
    await Promise.all(promises);
  });

  test('并发 P99 ≤100ms（Lane 调度不增加延迟）', () => {
    const p99 = percentile(concurrentLatencies, 99);
    expect(p99).toBeLessThanOrEqual(100);
  });

  test('并发请求全部 QUEUED，同一 session 至多 1 个 EXECUTING', async () => {
    setCookies(cookieA);
    const reqs = await requestRaw('GET', `/sessions/${sessionId}/requests`);
    const items = (reqs.body?.items ?? []) as Record<string, unknown>[];
    const executingCount = items.filter((i) => i.state === 'EXECUTING').length;
    expect(executingCount).toBeLessThanOrEqual(1);
  });
});

// =========================== TC-P-002 ======================================
describe('TC-P-002: Cancel/Retry 传播延迟 ≤100ms（正路径）', () => {
  const cancelLatencies: number[] = [];
  const retryLatencies: number[] = [];

  test('Cancel 传播延迟 P99 ≤100ms', async () => {
    setCookies(cookieA);
    for (let i = 1; i <= 30; i++) {
      // 创建一个新请求并等待进入 EXECUTING
      const createRes = await submitRequest(sessionIdCancel, `cancel-perf-${i}`, `key-cancel-perf-${i}`);
      const requestId = createRes.body?.requestId as string;
      await new Promise((r) => setTimeout(r, 500)); // 等待进入 EXECUTING

      const start = performance.now();
      const cancelRes = await cancelRun(sessionIdCancel, requestId);
      const end = performance.now();
      cancelLatencies.push(end - start);

      // Cancel 可能返回 202 或 409（如果已完成）
      if (cancelRes.status === 200 || cancelRes.status === 409) {
        // 有效响应
      }
    }

    const p99 = percentile(cancelLatencies, 99);
    expect(p99).toBeLessThanOrEqual(100);
  });

  test('Retry 传播延迟 P99 ≤100ms', async () => {
    setCookies(cookieA);
    // 先创建一个 COMPLETED run
    const initRes = await submitRequest(sessionIdCancel, 'retry base request', 'key-retry-base-001');
    const baseRunId = initRes.body?.requestId as string;
    if (baseRunId) {
      await waitForTerminal(sessionIdCancel, baseRunId, 30_000);
    }

    for (let i = 1; i <= 30; i++) {
      const start = performance.now();
      const retryRes = await retryRun(sessionIdCancel, baseRequestId);
      const end = performance.now();
      retryLatencies.push(end - start);
    }

    const p99 = percentile(retryLatencies, 99);
    expect(p99).toBeLessThanOrEqual(100);
  });
});

// =========================== TC-P-002E =====================================
describe('TC-P-002E: EXECUTING 状态下 Cancel 传播延迟 ≤100ms（边界路径）', () => {
  test('EXECUTING + stream delta 期间 Cancel ≤100ms', async () => {
    setCookies(cookieA);
    // 创建一个会持续 stream 的请求
    const res = await submitRequest(sessionIdCancel, 'long streaming request for cancel boundary', 'key-cancel-boundary-001');
    const requestId = res.body?.requestId as string;
    expect(res.status).toBe(200);

    // 在 EXECUTING 期间发送 Cancel
    await new Promise((r) => setTimeout(r, 500)); // 等待进入 EXECUTING

    const start = performance.now();
    const cancelRes = await cancelRun(sessionIdCancel, requestId);
    const end = performance.now();
    const propagationDelay = end - start;

    expect(cancelRes.status).toBe(200);
    expect(propagationDelay).toBeLessThanOrEqual(100);

    // 等待 CAS 写入完成
    const terminal = await waitForTerminal(sessionIdCancel, requestId, 30_000);
    // waitForTerminal returns conversation response ({ items }), not run status ({ state })
    // Check that ASSISTANT message exists (request completed or failed)
    const items = (terminal.body as any)?.items ?? [];
    expect(items.some((m) => m.role === 'ASSISTANT')).toBe(true);
  });
});

// =========================== TC-P-003 ======================================
describe('TC-P-003: 并发 Lane 冲突调度正确串行化（正路径）', () => {
  const laneLatencies: number[] = [];

  test('10 个并发请求全部 QUEUED', async () => {
    setCookies(cookieA);
    const promises: Promise<void>[] = [];

    for (let i = 1; i <= 10; i++) {
      promises.push(
        (async () => {
          const res = await submitRequest(sessionIdLane, `lane-concurrent-${i}`, `key-lane-conc-${i}`);
          expect(res.status).toBe(200);
          laneLatencies.push(performance.now());
        })(),
      );
    }
    await Promise.all(promises);
  });

  test('所有 RequestRun 最终到达 Terminal 状态，无死锁', async () => {
    setCookies(cookieA);
    // 等待所有 run 完成
    const maxWait = 120_000;
    const start = Date.now();

    while (Date.now() - start < maxWait) {
      const reqs = await requestRaw('GET', `/sessions/${sessionIdLane}/requests`);
      const items = (reqs.body?.items ?? []) as Record<string, unknown>[];
      const nonTerminal = items.filter((i) => !['COMPLETED', 'FAILED', 'CANCELLED'].includes(i.state as string));

      if (nonTerminal.length === 0 && items.length === 10) {
        // 所有 10 个 run 都到达 Terminal 状态
        return;
      }
      await new Promise((r) => setTimeout(r, 3000));
    }

    // 如果超时，检查是否有 run 永久停留在非终态
    const reqs = await requestRaw('GET', `/sessions/${sessionIdLane}/requests`);
    const items = (reqs.body?.items ?? []) as Record<string, unknown>[];
    const stuck = items.filter((i) => !['COMPLETED', 'FAILED', 'CANCELLED'].includes(i.state as string));
    expect(stuck.length).toBe(0); // 无死锁/饥饿
  });

  test('同一 Lane 至多 1 个 EXECUTING run', async () => {
    setCookies(cookieA);
    const reqs = await requestRaw('GET', `/sessions/${sessionIdLane}/requests`);
    const items = (reqs.body?.items ?? []) as Record<string, unknown>[];
    const executing = items.filter((i) => i.state === 'EXECUTING');
    expect(executing.length).toBeLessThanOrEqual(1);
  });
});

// =========================== TC-P-004 ======================================
describe('TC-P-004: TTFT 指标可度量且可聚合（正路径）', () => {
  test('TTFT 从提交到首 token 可度量', async () => {
    setCookies(cookieA);

    const T_submit = performance.now();
    const res = await submitRequest(sessionIdTTFT, 'ttft-measure-test', 'key-ttft-001');
    expect(res.status).toBe(200);
    const requestId = res.body?.requestId as string;

    // 收集 SSE stream，记录首 token 时间
    const stream = await connectStream(sessionIdTTFT);
    const reader = stream.getReader();
    let T_firstToken: number | null = null;

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }

        if (T_firstToken === null) {
          // 检查是否包含 assistantMessage 或 stream delta
          const text = new TextDecoder().decode(value);
          if (text.includes('assistantMessage') || text.includes('delta')) {
            T_firstToken = performance.now();
            break; // 首 token 到达，不再读取
          }
        }
      }
    } finally {
      reader.releaseLock();
    }

    if (T_firstToken !== null) {
      const ttft = T_firstToken - T_submit;
      expect(ttft).toBeGreaterThan(0);
      expect(ttft).toBeLessThanOrEqual(10_000); // 10s 内正常范围
    }

    // 等待 run 完成
    if (runId) {
      await waitForTerminal(sessionIdTTFT, requestId, 30_000);
    }
  });

  test('Metrics API 包含 TTFT 指标', async () => {
    const metricsRes = await requestRaw('GET', '/metrics');
    if (metricsRes.status === 200) {
      const text = typeof metricsRes.body === 'string' ? metricsRes.body : JSON.stringify(metricsRes.body);
      // 查找 ttft 指标
      // Prometheus format: ttft{...} value
      expect(text.toLowerCase()).toContain('ttft');
    }
  });

  test('TTFT metric 标签不含高基数标签（request-id/runId）', async () => {
    const metricsRes = await requestRaw('GET', '/metrics');
    if (metricsRes.status === 200) {
      const text = typeof metricsRes.body === 'string' ? metricsRes.body : JSON.stringify(metricsRes.body);
      const ttftLines = text.split('\n').filter((l) => l.includes('ttft'));

      for (const line of ttftLines) {
        // 不含 request-id 或 runId 标签
        expect(line).not.toContain('request-id');
        expect(line).not.toContain('runId');
        // 模型指标只允许固定 outcome 标签。
        if (line.includes('{')) {
          const labels = line.match(/\{([^}]+)\}/)?.[1] ?? '';
          expect(labels.toLowerCase()).toContain('outcome');
        }
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Helper: 原始请求
// ---------------------------------------------------------------------------
async function requestRaw(method: string, path: string): Promise<{ status: number; body: Record<string, unknown>; headers: Record<string, string> }> {
  const BASE_URL = process.env.NEXTAGENT_URL || 'http://localhost:3000';
  const url = `${BASE_URL}/api/v1${path}`;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(getCookies().length > 0 ? { Cookie: getCookies().join('; ') } : {}),
  };
  const res = await fetch(url, { method, headers });
  let body: Record<string, unknown>;
  if (res.status !== 204) {
    try {
      body = await res.json();
    } catch {
      // metrics 可能返回 text/plain
      const text = await res.text();
      body = { raw: text };
    }
  } else {
    body = {};
  }
  return { status: res.status, body, headers: Object.fromEntries(res.headers.entries()) };
}
