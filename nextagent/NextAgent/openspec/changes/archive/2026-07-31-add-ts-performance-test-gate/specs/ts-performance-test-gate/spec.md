# OpenSpec Spec — ts-performance-test-gate

## Spec ID
OS-SPEC-2026-006

## 关联 Proposal
OS-PROP-2026-006

## 状态
Draft

---

## ADDED Requirements

### Requirement: performance-test-behavior-contracts

NextAgent TS 后端 MUST 在时效性维度满足本行为合约，覆盖 Submit/Cancel/Retry 响应延迟、Lane 并发串行化正确性、TTFT 指标可度量性。

---

#### Scenario 1: TC-P-001 — Submit 响应延迟 ≤100ms（正路径）

**测试点来源:** TP-P01  
**优先级:** P1  
**测试因子:** 时效性  
**测试经验:** TE-07

| ID | Requirement | Assertion |
|----|-------------|-----------|
| REQ-P-001-01 | 批量 100 次 Submit 全部返回 HTTP 200 | `expect(res.status).toBe(200)` 对每个 submit 成立 |
| REQ-P-001-02 | 每次 Submit 返回含 requestId 和 runId | `expect(res.body).toHaveProperty('requestId')` && `expect(res.body).toHaveProperty('runId')` |
| REQ-P-001-03 | Submit P99 响应延迟 ≤100ms | `percentile(latencies, 99) ≤ 100` |
| REQ-P-001-04 | Submit P95 响应延迟 ≤80ms | `percentile(latencies, 95) ≤ 80` |
| REQ-P-001-05 | Submit 最大延迟 ≤150ms（容差上限） | `max(latencies) ≤ 150` |

**约束:**
- HTTP 状态码为 200（非 202）
- trusted identity 模式（无需 auth）
- idempotencyKey 可选，API 自动生成

---

#### Scenario 2: TC-P-001E — 高并发下 Submit 响应延迟 ≤100ms（异常路径）

**测试点来源:** TP-P01  
**优先级:** P1  
**测试因子:** 时效性  
**测试经验:** TE-01

| ID | Requirement | Assertion |
|----|-------------|-----------|
| REQ-P-001E-01 | Lane 占用状态下并发 50 次 Submit 全部返回 HTTP 200 | `expect(res.status).toBe(200)` 对每个并发 submit 成立 |
| REQ-P-001E-02 | 并发 Submit P99 ≤100ms（Lane 调度不增加延迟） | `percentile(concurrentLatencies, 99) ≤ 100` |
| REQ-P-001E-03 | 同一 session 至多 1 个 EXECUTING run | `executingCount ≤ 1` |
| REQ-P-001E-04 | 并发请求全部 QUEUED | 非 EXECUTING 请求 state 为 QUEUED |

**前置条件:** 已有 1 个 run 进入 EXECUTING（Lane 占用）

**约束:**
- 并发 50 次 submit 使用 `Promise.all` 并行执行
- Lane 串行化模型保证 EXECUTING ≤ 1

---

#### Scenario 3: TC-P-002 — Cancel/Retry 传播延迟 ≤100ms（正路径）

**测试点来源:** TP-P02  
**优先级:** P1  
**测试因子:** 时效性  
**测试经验:** TE-07

| ID | Requirement | Assertion |
|----|-------------|-----------|
| REQ-P-002-01 | Cancel 传播延迟 P99 ≤100ms | `percentile(cancelLatencies, 99) ≤ 100` |
| REQ-P-002-02 | Cancel 有效响应为 200 或 409 | `cancelRes.status === 200 || cancelRes.status === 409` |
| REQ-P-002-03 | Cancel on COMPLETED 返回 409 + REQUEST_CANCEL_ALREADY_TERMINAL | 非 CONFLICT，而是 REQUEST_CANCEL_ALREADY_TERMINAL |
| REQ-P-002-04 | Retry 传播延迟 P99 ≤100ms | `percentile(retryLatencies, 99) ≤ 100` |

**前置条件:** 
- Cancel 测试需等待 run 进入 EXECUTING（500ms 等待）
- Retry 测试需先有 1 个 COMPLETED run

**约束:**
- Cancel 返回 HTTP 200（正常）或 409 + `REQUEST_CANCEL_ALREADY_TERMINAL`（对已完成 run）
- Retry 返回 HTTP 200

---

#### Scenario 4: TC-P-002E — EXECUTING 状态下 Cancel 传播延迟 ≤100ms（边界路径）

**测试点来源:** TP-P02  
**优先级:** P1  
**测试因子:** 时效性  
**测试经验:** TE-01

| ID | Requirement | Assertion |
|----|-------------|-----------|
| REQ-P-002E-01 | EXECUTING + stream delta 期间 Cancel 返回 HTTP 200 | `cancelRes.status === 200` |
| REQ-P-002E-02 | EXECUTING Cancel 传播延迟 ≤100ms | `propagationDelay ≤ 100` |
| REQ-P-002E-03 | Cancel 后 run 最终到达 Terminal 状态 | `waitForTerminal` 成功 |
| REQ-P-002E-04 | Cancel 后 ASSISTANT 消息存在（CAS 写入完成） | `items.some(m => m.role === 'ASSISTANT') === true` |

**前置条件:** 请求已进入 EXECUTING 且正在 stream delta

**已知缺陷:** SSE EventSource 可能超时，需在测试中处理

---

#### Scenario 5: TC-P-003 — 并发 Lane 冲突调度正确串行化（正路径）

**测试点来源:** TP-P03  
**优先级:** P2  
**测试因子:** 时效性  
**测试经验:** TE-01

| ID | Requirement | Assertion |
|----|-------------|-----------|
| REQ-P-003-01 | 10 个并发请求全部 Submit 成功（HTTP 200） | `expect(res.status).toBe(200)` 对 10 次 submit 成立 |
| REQ-P-003-02 | 所有 RequestRun 最终到达 Terminal 状态，无死锁/饥饿 | `stuck.length === 0`，120s 超时内全部到达 COMPLETED/FAILED/CANCELLED |
| REQ-P-003-03 | 同一 Lane 至多 1 个 EXECUTING run | `executing.length ≤ 1` |

**超时:** 最大等待 120s

**约束:**
- Lane 串行化模型保证串行执行
- 10 个并发请求使用 `Promise.all` 并行提交

---

#### Scenario 6: TC-P-004 — TTFT 指标可度量且可聚合（正路径）

**测试点来源:** TP-P04  
**优先级:** P2  
**测试因子:** 时效性  
**测试经验:** TE-07

| ID | Requirement | Assertion |
|----|-------------|-----------|
| REQ-P-004-01 | TTFT 从 Submit 到首 token 可度量 | `T_firstToken - T_submit > 0 && ≤ 10_000ms` |
| REQ-P-004-02 | /metrics endpoint 包含 TTFT 指标 | `text.toLowerCase().contains('ttft')` |
| REQ-P-004-03 | TTFT metric 标签不含高基数标签 (request-id/runId) | `line` 不含 `request-id` 或 `runId` |
| REQ-P-004-04 | TTFT metric 含低基数标签 (agentId) | `labels.toLowerCase().contains('agentid')` |

**约束:**
- SSE only（无 WebSocket）
- /metrics 返回 Prometheus 格式（text/plain 或 JSON）
- TTFT 定义：从 `performance.now()` at submit 到 SSE stream 首个 `assistantMessage` 或 `delta` event

**已知缺陷:** SSE EventSource 可能超时，TTFT 测量需处理 stream 断连

---

## API 行为合约补充

以下为测试中确认的 API 实际行为（非标准但已固化），需纳入合约：

| 行为 | 说明 | 来源 |
|------|------|------|
| Submit 返回 HTTP 200 | 非 202，所有控制面操作统一 200 | TC-P-001 |
| Cancel on COMPLETED 返回 409 + REQUEST_CANCEL_ALREADY_TERMINAL | 非 HTTP 409 + CONFLICT | TC-P-002 |
| trusted identity 模式 | 无需 auth header | 全部 TC |
| SSE only | 无 WebSocket 通道 | TC-P-004 |
| idempotencyKey 可选 | API 自动生成 | TC-P-001 |
| /capabilities 不存在 | 不依赖此 endpoint | 全局 |
| SSE EventSource 超时 | 已知系统 bug，需在测试中容错 | TC-P-002E, TC-P-004 |

---

## 术语表

| 术语 | 定义 |
|------|------|
| P99 | 第 99 百分位数，99% 的样本在该值以下 |
| P95 | 第 95 百分位数 |
| Lane | NextAgent 串行化执行单元，同一 Lane 至多 1 个 EXECUTING |
| TTFT | Time To First Token，从 Submit 到首个 stream delta 的时间 |
| Terminal 状态 | COMPLETED / FAILED / CANCELLED |
| CAS | Compare-And-Swap，用于状态原子写入 |
