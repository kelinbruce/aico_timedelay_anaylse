# FN-6.5 请求用户确认或授权

> 能力域 D6 安全与治理 · 子域 [D6.3 交互与信息安全](.) · 返回 [功能树](../../index.md)

| 项 | 值 |
|---|---|
| 当前状态 | 稳定 |
| 覆盖特性 | [F-6.5](../../../features/D6-安全与治理/D6.3-交互与信息安全/F-6.5-人工交互边界.md) |
| 主规格 | [`human-pending-input-core`](../../../../specs/human-pending-input-core/spec.md) |
| 遗留规格 | [`confirmation-pending-input`](../../../../specs/confirmation-pending-input/spec.md)、[`authorization-pending-input`](../../../../specs/authorization-pending-input/spec.md)、[`human-pending-input-timeout`](../../../../specs/human-pending-input-timeout/spec.md) |
| 接口 | 系统内部，待确认输入生命周期 |

## 描述

系统在原 RequestRun 内创建确认或授权待确认输入，按受控 deadline 暂停并等待用户响应；回答后恢复或终止，到期后即使没有新请求或页面连接也会安全收敛为 timeout failure。

## 前置条件

- 请求正在执行。
- 高风险操作待确认或授权。

## 输入

| 参数 | 必填 | 说明 |
|---|---|---|
| 类型 | 是 | 确认或授权 |
| 操作信息 | 是 | 待确认的操作 |
| timeoutAt | 否 | 显式 deadline；必须晚于创建时刻且不超过创建后 24 小时 |

## 输出

创建带 accepted deadline 的待确认输入并暂停原请求；回答、取消或超时后输出 canonical lifecycle 与终态结果。

## 处理过程

1. 系统创建确认或授权待确认输入。
2. 暂停请求，等待用户响应。
3. 未显式指定 deadline 时采用创建后 30 分钟；显式 deadline 只接受创建后 24 小时内的未来值。
4. 用户确认后恢复请求；拒绝后终止；授权只绑定当前请求内一次受限操作。
5. 系统根据已接受 deadline 和已提交生命周期事实判定到期，不依赖客户端流量；到期后形成 `TIMED_OUT` 和 `USER_INPUT_TIMEOUT`。
6. `producerRef.kind === 'WORKFLOW_NODE'` 的超时 resume 原 run（从 checkpoint 重建 recovery context 并 re-queue 执行，不设 `answers` 字段），由 workflow engine handler 决定终态（exception 分支匹配时 `COMPLETED`，无匹配时 `FAILED/WORKFLOW_NODE_TIMEOUT`）；checkpoint 不可用时 fallback 到直接终态化 `FAILED/PENDING_INPUT_TIMEOUT`。
7. `producerRef.kind !== 'WORKFLOW_NODE'`（`LIFECYCLE_HOOK`、`CAPABILITY_INVOCATION`）的超时直接终态化 `FAILED/PENDING_INPUT_TIMEOUT`。
8. 超时处理被中断后继续收敛未完成结果；late answer 安全拒绝且不能恢复原 run。

## 结果

- 用户确认：恢复请求。
- 用户拒绝：终止请求。
- 超时（WORKFLOW_NODE producerRef）：resume 原 run 由 engine 决定终态——exception 匹配时 `COMPLETED`，无匹配时 `FAILED/WORKFLOW_NODE_TIMEOUT`；checkpoint 不可用时 `FAILED/PENDING_INPUT_TIMEOUT`。
- 超时（非 WORKFLOW_NODE producerRef）：安全终止为 `FAILED/PENDING_INPUT_TIMEOUT`，不伪造批准、授权或答案。

## 规格

| 规格项 | 规格值 | 权威来源 |
|---|---|---|
| 待确认输入 deadline | 未显式指定时为创建后 30 分钟；显式值必须晚于创建时刻且不超过创建后 24 小时 | `human-pending-input-core / Runtime resolves pending input timeout` |
| Timeout processing batch | 每批至多 100 条；每个 runtime instance 同时至多一个 processing flow | `human-pending-input-core / Timeout processing remains idle and bounded` |
| WORKFLOW_NODE 超时处理 | resume 原 run（不设 `answers`），终态由 engine 决定（`WORKFLOW_NODE_TIMEOUT` 无 exception 或 `COMPLETED` 有 exception）；checkpoint 不可用 fallback `FAILED/PENDING_INPUT_TIMEOUT`；非 WORKFLOW_NODE 直接终态化 `FAILED/PENDING_INPUT_TIMEOUT` | `human-pending-input-core / Runtime resolves pending input timeout`、`human-pending-input-timeout / Timeout never auto-approves` |
| 超时不等同批准 | 超时拒绝 late answer，且不得被解释为批准、授权或用户答案 | `human-pending-input-core / Timeout is visible and rejects late answers`、`human-pending-input-timeout / Timeout never auto-approves` |
| 单次授权覆盖操作数 | 1 | `authorization-pending-input` |
