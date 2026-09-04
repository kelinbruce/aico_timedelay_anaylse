# OpenSpec Proposal — ts-performance-test-gate

## 标题
NextAgent TS 后端性能测试门禁 (ts-performance-test-gate)

##提案编号
OS-PROP-2026-006

## 状态
Draft

## 作者
E2E Test Team

## 日期
2026-06-26

---

## 1. 背景

NextAgent TS 后端在 Lane 串行化模型下处理 Submit、Cancel、Retry 等控制面操作以及流式 Token 输出（TTFT），其时效性直接决定用户体验。当前缺少系统化的性能基线门禁：延迟超标、并发调度异常（饥饿/死锁）或 TTFT 指标不可度量等问题可能在发布后才发现。

**已有测试资产：**
- `TC-P-001-006.test.ts` 已覆盖 6 个性能用例（4 组测试点），但尚未纳入 OpenSpec 门禁体系。
- 测试因子为"时效性"，测试经验为 TE-07（时效性度量）和 TE-01（并发竞争时效性）。

**需解决的问题：**
1. 缺少正式的性能行为合约 (performance-test-behavior-contracts)；
2. 缺少归档前的基线数据（P99/P95 具体数值）；
3. Cancel on COMPLETED 返回 409 + `REQUEST_CANCEL_ALREADY_TERMINAL`（非标准 CONFLICT）需要明文记录；
4. SSE EventSource 超时为已知系统 bug，需在合约中标注为已知缺陷。

---

## 2. 变更范围

| 范围 | 说明 |
|------|------|
| **新增 Capability** | `performance-test-behavior-contracts` — 定义 Submit/Cancel/Retry 延迟、Lane 串行化正确性、TTFT 可度量性的行为合约 |
| **影响文件** | `specs/spec.md`, `design/design.md`, `tasks.md` |
| **无影响** | 现有功能 Capability 不变；API 协议不变（HTTP 200、trusted identity、SSE only） |
| **测试资产** | `TC-P-001-006.test.ts` 已存在，本次仅将其纳入 OpenSpec 门禁体系 |

---

## 3. Capability 影响

| Capability | 操作 | 说明 |
|------------|------|------|
| (新增) `performance-test-behavior-contracts` | ADDED | 定义 6 个性能场景的行为合约，覆盖延迟、并发、TTFT |

无已有 Capability 受影响。

---

## 4. 归档前更新基线

在 proposal 归档前，必须采集以下基线数据：

| 基线项 | 采集方法 | 归档要求 |
|--------|---------|---------|
| Submit P99/P95 延迟基线值 | 执行 TC-P-001 (batch 100) | 记录实际 P99、P95 数值 |
| 高并发 Submit P99 延迟基线值 | 执行 TC-P-001E (concurrent 50) | 记录实际 P99 数值 |
| Cancel 传播 P99 延迟基线值 | 执行 TC-P-002 (30 次 cancel) | 记录实际 P99 数值 |
| Retry 传播 P99 延迟基线值 | 执行 TC-P-002 (30 次 retry) | 记录实际 P99 数值 |
| EXECUTING Cancel 延迟基线值 | 执行 TC-P-002E (1 次边界 cancel) | 记录实际延迟数值 |
| Lane 串行化吞吐基线 | 执行 TC-P-003 (10 concurrent) | 记录全部到达 Terminal 的时间 |
| TTFT 基线值 | 执行 TC-P-004 | 记录实际 TTFT 数值，确认 /metrics 含 ttft 指标 |

**基线来源：** `TC-P-001-006.test.ts` 中的 percentile helper 和 performance.now() 测量。

---

## 5. 审批与归档

- 审批人：架构评审委员会
- 归档条件：基线数据已采集 + spec/design 审核通过 + tasks 完成验证
