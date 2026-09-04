# OpenSpec Tasks — ts-performance-test-gate

## Tasks ID
OS-TASKS-2026-006

## 关联 Design
OS-DESIGN-2026-006

## 状态
Draft

---

## Implementation Task Checklist

### Phase 1: 测试代码修复与稳定化

| # | Task | 验证方法 | Source Reference | Status |
|---|------|---------|-----------------|--------|
| T1.1 | 修复 `requestRaw` 函数：测试代码中 TC-P-001E 和 TC-P-003 直接调用 `requestRaw`，但该函数仅在文件末尾定义为局部函数；需确认 `api-client` helper 是否导出或改用文件内定义 | 编译通过 + TC-P-001E/TC-P-003 运行不报 undefined | TC-P-001E: `reqs = await requestRaw(...)` | pending |
| T1.2 | 修复 `baseRequestId` 未定义变量：TC-P-002 Retry 测试中使用 `baseRequestId` 但定义为 `baseRunId`，变量名不匹配 | `retryRun(sessionIdCancel, baseRequestId)` 编译通过 + retry 调用成功 | TC-P-002: `retryRun(sessionIdCancel, baseRequestId)` | pending |
| T1.3 | 修复 `runId` 未定义变量：TC-P-004 中 `if (runId)` 检查但 `runId` 未在 scope 中声明 | 编译通过 + waitForTerminal 调用成功 | TC-P-004: `if (runId) { await waitForTerminal(...) }` | pending |
| T1.4 | 增加 SSE EventSource 超时容错处理：TC-P-002E 和 TC-P-004 的 stream 读取需处理超时断连 | 超时场景不抛异常，测试继续 | TC-P-002E, TC-P-004 | pending |

### Phase 2: 测试运行与基线采集

| # | Task | 验证方法 | Source Reference | Status |
|---|------|---------|-----------------|--------|
| T2.1 | 执行 TC-P-001 并采集 Submit 延迟基线 (P99, P95, max) | 输出实际数值，记录到基线文件 | TC-P-001: percentile(latencies, 99/95) + max | pending |
| T2.2 | 执行 TC-P-001E 并采集并发 Submit 延迟基线 (P99) | 输出实际数值 | TC-P-001E: percentile(concurrentLatencies, 99) | pending |
| T2.3 | 执行 TC-P-002 并采集 Cancel/Retry 传播延迟基线 (P99) | 输出实际数值 | TC-P-002: percentile(cancel/retryLatencies, 99) | pending |
| T2.4 | 执行 TC-P-002E 并采集 EXECUTING Cancel 延迟基线 | 输出实际数值 | TC-P-002E: propagationDelay | pending |
| T2.5 | 执行 TC-P-003 并采集 Lane 串行化吞吐基线 | 全部到达 Terminal 时间 | TC-P-003: 120s 内 stuck.length === 0 | pending |
| T2.6 | 执行 TC-P-004 并采集 TTFT 基线 | TTFT 数值 + /metrics ttft 指标确认 | TC-P-004: T_firstToken - T_submit | pending |
| T2.7 | 将基线数据写入 proposal.md 归档前更新基线章节 | 基线文件包含所有数值 | OS-PROP-2026-006 §4 | pending |

### Phase 3: 合约与文档完善

| # | Task | 验证方法 | Source Reference | Status |
|---|------|---------|-----------------|--------|
| T3.1 | 确认 Cancel on COMPLETED 返回 409 + REQUEST_CANCEL_ALREADY_TERMINAL 在 API 文档中已记录 | API 文档含此行为说明 | TC-P-002: Cancel 409 | pending |
| T3.2 | 确认 /metrics endpoint TTFT 指标格式和标签符合合约 | /metrics 输出含 ttft{agentId=...} 无 request-id/runId | TC-P-004: REQ-P-004-02~04 | pending |
| T3.3 | 更新 SSE EventSource 超时 bug 状态跟踪 | bug ticket 已关联到设计文档 | DD-04 | pending |

### Phase 4: 门禁配置

| # | Task | 验证方法 | Source Reference | Status |
|---|------|---------|-----------------|--------|
| T4.1 | 配置 CI pipeline 运行 TC-P-001~TC-P-004 作为性能门禁 | CI 触发后自动运行 + 结果报告 | 全部 TC | pending |
| T4.2 | 配置 staging 环境硬断言 (P99 ≤ 100ms) | 门禁阻断发布（staging 失败则不发布） | REQ-P-001-03, REQ-P-002-01 | pending |
| T4.3 | 配置 CI 环境软断言 (P99 ≤ 150ms 容差) | CI 报告 warning 但不阻断 | R1 缓解措施 | pending |
| T4.4 | 设置 TTFT dashboard/告警（如 Q4 确认需要） | dashboard 可查看 TTFT P99 by agentId | TC-P-004 | pending |

### Phase 5: 归档

| # | Task | 验证方法 | Source Reference | Status |
|---|------|---------|-----------------|--------|
| T5.1 | Proposal 归档（基线已采集 + spec/design 审核 + tasks 验证） | OS-PROP-2026-006 status → Approved | OS-PROP-2026-006 §5 | pending |
| T5.2 | Spec 归档 | OS-SPEC-2026-006 status → Approved | — | pending |
| T5.3 | Design 归档 | OS-DESIGN-2026-006 status → Approved | — | pending |

---

## Verification Summary

| 验证维度 | 覆盖 TC | 通过标准 |
|---------|---------|---------|
| Submit 延迟合规 | TC-P-001, TC-P-001E | P99 ≤ 100ms, P95 ≤ 80ms, 并发 P99 ≤ 100ms |
| Cancel/Retry 延迟合规 | TC-P-002, TC-P-002E | P99 ≤ 100ms, 边界 ≤ 100ms |
| Lane 串行化正确性 | TC-P-001E, TC-P-003 | EXECUTING ≤ 1, 无死锁 |
| TTFT 可度量 | TC-P-004 | TTFT > 0 且 ≤ 10s, /metrics 含 ttft |
| API 行为合约一致 | 全部 TC | HTTP 200, 409 + REQUEST_CANCEL_ALREADY_TERMINAL, trusted identity |

---

## Source Traceability

| Test Case | Test Point | Test Experience | Spec Requirement IDs |
|-----------|------------|----------------|---------------------|
| TC-P-001 | TP-P01 | TE-07 | REQ-P-001-01~05 |
| TC-P-001E | TP-P01 | TE-01 | REQ-P-001E-01~04 |
| TC-P-002 | TP-P02 | TE-07 | REQ-P-002-01~04 |
| TC-P-002E | TP-P02 | TE-01 | REQ-P-002E-01~04 |
| TC-P-003 | TP-P03 | TE-01 | REQ-P-003-01~03 |
| TC-P-004 | TP-P04 | TE-07 | REQ-P-004-01~04 |
