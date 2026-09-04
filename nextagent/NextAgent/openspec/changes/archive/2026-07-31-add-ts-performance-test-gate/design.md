# OpenSpec Design — ts-performance-test-gate

## Design ID
OS-DESIGN-2026-006

## 关联 Spec
OS-SPEC-2026-006

## 状态
Draft

---

## 1. 背景

NextAgent TS 后端基于 Lane 串行化模型处理 Agent 请求。控制面操作（Submit/Cancel/Retry）和流式输出（TTFT）的时效性是用户体验的核心决定因素。当前缺少正式的性能行为合约和门禁机制，导致延迟超标、并发调度异常或指标缺失等问题可能在发布后才发现。

**已有资产：**
- 测试用例 `TC-P-001-006.test.ts` 覆盖 6 个性能场景
- 测试点 TP-P01~TP-P04 对应 4 组时效性维度
- 测试经验 TE-07（时效性度量）和 TE-01（并发竞争时效性）

**本设计目标：** 将已有测试资产纳入 OpenSpec 门禁体系，补充行为合约、设计决策、质量属性、验证映射和风险管理。

---

## 2. 目标

| # | 目标 | 可度量标准 |
|---|------|-----------|
| G1 | Submit 响应延迟合规 | P99 ≤ 100ms, P95 ≤ 80ms, max ≤ 150ms |
| G2 | 高并发 Submit 延迟不退化 | 并发 50 Lane 占用下 P99 ≤ 100ms |
| G3 | Cancel/Retry 传播延迟合规 | 各 P99 ≤ 100ms |
| G4 | EXECUTING Cancel 边界延迟合规 | 传播延迟 ≤ 100ms |
| G5 | Lane 串行化正确性 | 10 并发全部 Terminal，无死锁，EXECUTING ≤ 1 |
| G6 | TTFT 可度量且可聚合 | TTFT > 0 且 ≤ 10s，/metrics 含 ttft 无高基数标签 |

---

## 3. 设计决策

### DD-01: 百分位数阈值选择

**决策:** Submit P99 ≤ 100ms, P95 ≤ 80ms, max ≤ 150ms

**理由:**
- P99 ≤ 100ms 为行业标准（对标 LLM inference gateway P99 SLA）
- P95 ≤ 80ms 提供 20% 余量给尾部延迟
- max ≤ 150ms 为容差上限，允许极端情况但拒绝持续退化
- Cancel/Retry 统一 P99 ≤ 100ms，控制面操作延迟不应高于 Submit

**替代方案:** 仅用 P99 ≤ 100ms 无 P95/max 约束 → 风险：尾部延迟不受控

### DD-02: 并发测试规模

**决策:** TC-P-001E 50 并发, TC-P-003 10 并发

**理由:**
- 50 并发覆盖 Lane 占用下真实生产负载（单 session 高频提交）
- 10 并发覆盖 Lane 冲突调度验证（足够验证串行化，不过度消耗资源）
- 两者分别验证延迟不退化和正确性

**替代方案:** 统一 100 并发 → 资源消耗过大，CI 环境不稳定

### DD-03: Cancel on COMPLETED 行为合约

**决策:** 明文记录 409 + `REQUEST_CANCEL_ALREADY_TERMINAL`（非标准 CONFLICT）

**理由:**
- 测试中已确认此行为，属于已固化的 API 行为
- 与标准 HTTP 409 + CONFLICT 不同，需明文区分避免混淆
- 此行为合理：已终止的 run 无法取消

**替代方案:** 要求改为标准 CONFLICT → API 变更成本高，且行为已合理

### DD-04: SSE EventSource 超时容忍

**决策:** 在合约中标注为已知缺陷，测试中需容错处理

**理由:**
- SSE EventSource 超时为已知系统 bug
- 测试必须处理 stream 断连场景
- 后续修复后需更新合约

**替代方案:** 暂不纳入 → TTFT 和 Cancel 边界测试无法稳定运行

### DD-05: TTFT 指标低基数标签策略

**决策:** TTFT metric 仅含 agentId（不含 request-id/runId）

**理由:**
- request-id/runId 为高基数标签，导致 Prometheus 存储膨胀
- agentId 为低基数，支持聚合查询（如按 agent 统计 P99 TTFT）
- 符合 Prometheus 最佳实践

**替代方案:** 含 runId → 可追踪单次请求但不可聚合，违背 TP-P04 目标

### DD-06: HTTP 200 统一状态码

**决策:** 所有控制面操作（Submit/Cancel/Retry）统一返回 HTTP 200

**理由:**
- 当前 API 实现：Submit 返回 200（非 202），Cancel 正常返回 200
- 已固化行为，修改成本高
- 200 + body requestId/runId 提供足够信息

---

## 4. 质量属性

| 属性 | 体现 | 测试覆盖 |
|------|------|---------|
| **时效性 (Timeliness)** | Submit/Cancel/Retry P99 ≤ 100ms | TC-P-001, TC-P-001E, TC-P-002, TC-P-002E |
| **并发正确性 (Concurrency Correctness)** | Lane 串行化，无死锁/饥饿 | TC-P-001E, TC-P-003 |
| **可观测性 (Observability)** | TTFT 指标可度量可聚合 | TC-P-004 |
| **鲁棒性 (Robustness)** | Lane 占用下延迟不退化 | TC-P-001E |
| **边界完整性 (Boundary Completeness)** | EXECUTING Cancel + stream delta | TC-P-002E |

---

## 5. 验证映射

| Requirement ID | Test Case | 验证方法 |
|----------------|-----------|---------|
| REQ-P-001-01 | TC-P-001 | batch 100 submit，逐次检查 HTTP 200 |
| REQ-P-001-02 | TC-P-001 | 逐次检查 body 含 requestId + runId |
| REQ-P-001-03 | TC-P-001 | percentile(latencies, 99) 计算 |
| REQ-P-001-04 | TC-P-001 | percentile(latencies, 95) 计算 |
| REQ-P-001-05 | TC-P-001 | max(latencies) 计算 |
| REQ-P-001E-01 | TC-P-001E | concurrent 50 submit，逐次检查 HTTP 200 |
| REQ-P-001E-02 | TC-P-001E | percentile(concurrentLatencies, 99) 计算 |
| REQ-P-001E-03 | TC-P-001E | GET /sessions/{id}/requests → executingCount ≤ 1 |
| REQ-P-001E-04 | TC-P-001E | 非 EXECUTING 请求 state 为 QUEUED |
| REQ-P-002-01 | TC-P-002 | 30 次 cancel，percentile(cancelLatencies, 99) |
| REQ-P-002-02 | TC-P-002 | cancelRes.status === 200 || 409 |
| REQ-P-002-03 | TC-P-002 | Cancel on COMPLETED → 409 + REQUEST_CANCEL_ALREADY_TERMINAL |
| REQ-P-002-04 | TC-P-002 | 30 次 retry，percentile(retryLatencies, 99) |
| REQ-P-002E-01 | TC-P-002E | cancelRes.status === 200 |
| REQ-P-002E-02 | TC-P-002E | propagationDelay = end - start ≤ 100 |
| REQ-P-002E-03 | TC-P-002E | waitForTerminal 成功 |
| REQ-P-002E-04 | TC-P-002E | items.some(m => m.role === 'ASSISTANT') |
| REQ-P-003-01 | TC-P-003 | 10 concurrent submit 全部 HTTP 200 |
| REQ-P-003-02 | TC-P-003 | 120s 内全部到达 Terminal，stuck.length === 0 |
| REQ-P-003-03 | TC-P-003 | executing.length ≤ 1 |
| REQ-P-004-01 | TC-P-004 | ttft = T_firstToken - T_submit ∈ (0, 10_000) |
| REQ-P-004-02 | TC-P-004 | GET /metrics → text contains 'ttft' |
| REQ-P-004-03 | TC-P-004 | ttft lines 不含 request-id / runId |
| REQ-P-004-04 | TC-P-004 | ttft labels 含 agentId |

---

## 6. 风险

| # | 风险 | 影响 | 缓解措施 |
|---|------|------|---------|
| R1 | CI 环境资源不足导致延迟测量不准 | P99/P95 断言不稳定 | CI 中标注为 soft-threshold，仅在 staging/prod 环境硬断言 |
| R2 | SSE EventSource 超时 bug 导致 TC-P-002E/TC-P-004 不稳定 | 测试偶尔失败 | 测试中增加 retry/timeout 容错，bug 修复后更新合约 |
| R3 | Cancel on COMPLETED 行为与 HTTP 标准不一致 | API 文档混淆 | 已明文记录在合约中（DD-03） |
| R4 | /metrics endpoint 不稳定或格式变更 | TC-P-004 断言失效 | 使用 `if (metricsRes.status === 200)` 条件断言 |
| R5 | 测试代码中存在未定义变量引用 (requestRaw, baseRequestId, runId) | 测试编译失败 | 需在 tasks.md 中标注修复项 |

---

## 7. 待确认问题

| # | 问题 | 需确认方 | 优先级 |
|---|------|---------|--------|
| Q1 | Submit 延迟阈值是否适用于 staging + prod 统一？ | 架构委员会 | P1 |
| Q2 | SSE EventSource 超时 bug 修复时间线？ | 后端团队 | P1 |
| Q3 | Cancel 409 + REQUEST_CANCEL_ALREADY_TERMINAL 是否纳入 API 正式文档？ | API Owner | P2 |
| Q4 | TTFT 指标是否需要 dashboard/告警？ | 运维团队 | P2 |
| Q5 | TC-P-001E 中 50 并发是否需根据生产实际调整？ | 产品团队 | P2 |

---

## 8. 审批

- Design 审批人：架构评审委员会
- 前置条件：Spec OS-SPEC-2026-006 已审核通过

## 长期基线刷新计划

本节将旧模板的“归档前更新基线”归一为可审计的归档门禁；以下均为**归档前待执行**，不表示 stable baseline 已刷新。

- **Function：**以 `FN-11.3-容量与可靠性验证门禁` 为唯一用户可见行为 owner；若本 change 增加的行为不能被该 Function 的既有边界完整表达，先在同一能力域新增一个单一职责 Function，再更新 `openspec/designs/functions/index.md`，不得把实现细节直接写入 Function。
- **Stable spec：**将 delta Requirement 合并至 `openspec/specs/ts-performance-test-gate/spec.md`，逐条核对 Requirement 标题、MUST/SHALL 语义、场景、迁移和 metadata；不得以 `--skip-specs` 绕过同名 Requirement 重叠。
- **长期设计：**先执行本 design/proposal 已列出的“归档前更新基线”设计 owner；再在 `openspec/designs/spec-to-design-map.md` 为上述 stable spec 写入该 Function、实际承载的 architecture/module/ADR 与验证入口。若现有 map 无该 spec 行，先创建该行，而非把 change-local design 当作长期设计。
- **归档判定：**Function、stable spec、长期设计和 map 四端均完成 diff 审阅且 `openspec validate --all --strict` 通过后，才允许归档；任一端无法唯一归属时保留 active 并标记阻塞。
