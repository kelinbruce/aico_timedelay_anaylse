## Function

- **所属 Function**：`FN-6.5 请求用户确认或授权`
- **Function 变更类型**：`MODIFIED`
- **spec 角色**：主规格

## MODIFIED Requirements

### Requirement: Runtime resolves pending input timeout

系统 MUST 根据已接受的 `timeoutAt` 和已提交的 pending-input lifecycle facts 处理待确认输入超时。客户端请求、模型输出、channel metadata 或事实读取结果 MUST NOT 定义或覆盖 timeout policy。系统可用时，即使没有新 submit、会话导航、Web stream connection、页面可见性变化或进程重启，也 MUST 在执行环境能于 deadline 后继续运行时推进已经到期的 timeout。

对于 `producerRef.kind === 'WORKFLOW_NODE'` 的 pending input 超时，系统 MUST resume 原 run（从 checkpoint 重建 recovery context 并 re-queue 执行），MUST NOT 直接终态化 `FAILED`。resume 时 MUST NOT 设置 `answers` 字段，使 workflow engine handler 识别为超时恢复并触发 exception 路由或终态化。对于 `producerRef.kind !== 'WORKFLOW_NODE'`（`LIFECYCLE_HOOK`、`CAPABILITY_INVOCATION`）的 pending input 超时，系统 MUST 保持直接终态化 `FAILED` 的现有行为。

checkpoint 不可用时，系统 MUST fallback 到直接终态化 `FAILED`（`failureReason: PENDING_INPUT_TIMEOUT`），MUST NOT 让 run 挂死。

**需求类别**：功能性需求

#### Scenario: Runtime owns timeout decision
- **WHEN** 系统接受一个 pending input intent
- **THEN** 系统 MUST 使用统一 pending lifecycle clock 计算并校验 accepted `timeoutAt`
- **AND** producer-provided `timeoutAt` MUST 只作为显式 timeout 请求，而不是 policy authority
- **AND** client payload、model output、channel metadata 和读取到的 facts MUST NOT 定义或覆盖 timeout policy
- **AND** 该稳定能力 MUST NOT 引入 per-agent、per-kind、per-tenant、client-provided、model-provided 或 configurable timeout policy

#### Scenario: Default timeout is assigned
- **WHEN** 系统创建未显式指定 `timeoutAt` 的 pending input
- **THEN** 系统 MUST 把 accepted `timeoutAt` 设为创建时刻后 30 分钟
- **AND** safe pending-input request MUST 展示该 accepted deadline

#### Scenario: Explicit timeout is bounded
- **WHEN** pending input intent 请求显式 `timeoutAt`
- **THEN** 系统 MUST 只接受晚于创建时刻且不晚于创建后 48 小时的值
- **AND** 非法或更长的 timeout request MUST 返回安全 validation outcome

#### Scenario: Due timeout is processed without external traffic
- **GIVEN** 一个 pending input 仍为 `PENDING`
- **AND** accepted `timeoutAt` 已经过期
- **AND** 执行环境可继续运行并访问已提交 lifecycle facts
- **WHEN** 没有新请求提交且没有客户端连接
- **THEN** 系统 MUST 在执行环境于 deadline 后恢复运行时处理该事实
- **AND** 结果 MUST 收敛为 `TIMED_OUT`
- **AND** 并发 answer、cancel 或 timeout 已先完成时，系统 MUST 保留先完成的合法结果

#### Scenario: Earlier accepted deadline is not delayed
- **GIVEN** 系统已经等待一个较晚的 accepted pending-input deadline
- **WHEN** 系统接受一个更早的 pending-input deadline
- **THEN** 较早 deadline 到达后 MUST 能被处理
- **AND** 既有较晚 deadline MUST NOT 推迟该结果

#### Scenario: WORKFLOW_NODE timeout resumes original run
- **WHEN** 系统处理一个 `producerRef.kind === 'WORKFLOW_NODE'` 的 pending input 超时
- **AND** owning RequestRun 尚未 terminal
- **AND** checkpoint 可用
- **THEN** 系统 MUST resume 原 run（从 checkpoint 重建 recovery context 并 re-queue 执行）
- **AND** resume 时 MUST NOT 设置 `answers` 字段
- **AND** 系统 MUST 在 resume 前发布 `USER_INPUT_TIMEOUT` 事件
- **AND** 系统 MUST NOT 直接终态化 `FAILED`

#### Scenario: WORKFLOW_NODE timeout checkpoint unavailable fallback
- **WHEN** 系统处理一个 `producerRef.kind === 'WORKFLOW_NODE'` 的 pending input 超时
- **AND** checkpoint 不可用
- **THEN** 系统 MUST fallback 到直接终态化 `FAILED`
- **AND** `failureReason` MUST 为 `PENDING_INPUT_TIMEOUT`
- **AND** 系统 MUST NOT 让 run 挂死

#### Scenario: Non-WORKFLOW_NODE timeout terminalizes directly
- **WHEN** 系统处理一个 `producerRef.kind !== 'WORKFLOW_NODE'`（`LIFECYCLE_HOOK` 或 `CAPABILITY_INVOCATION`）的 pending input 超时
- **THEN** 系统 MUST 直接终态化 `FAILED`
- **AND** `failureReason` MUST 为 `PENDING_INPUT_TIMEOUT`
- **AND** 系统 MUST NOT resume 原 run

#### Scenario: Timeout terminalization does not create replacement pending input
- **WHEN** 系统把 timed-out pending input 终止为 `TIMED_OUT`
- **THEN** 该 timeout 处理 MUST NOT 创建 replacement pending input
- **AND** reject、deny、normal answer 和其他 terminal outcome MUST 保持既有行为
- **AND** 对于 `WORKFLOW_NODE` producerRef，resume 后 engine handler 可能 throw 超时错误走 exception 路由，exception 分支中的新 pending input 属于新节点产生，不属于 replacement

#### Scenario: Partial timeout completion is retried from durable facts
- **GIVEN** pending input 已为 `TIMED_OUT`
- **AND** owning RequestRun 尚未完成 terminal result
- **WHEN** 之前的 timeout attempt 在 canonical event 或 terminal result 完成前中断
- **THEN** 后续 processing MUST 重新发现并继续该 incomplete fact
- **AND** MUST 幂等形成 canonical `USER_INPUT_TIMEOUT`
- **AND** 对于 `WORKFLOW_NODE` producerRef，MUST resume 原 run（若 checkpoint 可用）或 fallback 到 `FAILED/PENDING_INPUT_TIMEOUT`（若 checkpoint 不可用）
- **AND** 对于非 WORKFLOW_NODE producerRef，MUST 幂等完成 `FAILED/PENDING_INPUT_TIMEOUT`
- **AND** MUST NOT 把 pending input 恢复为 `PENDING`

## Function 变更汇总

### 处理过程

- **变更类型**：修改
- **目标内容**：系统对 `producerRef.kind === 'WORKFLOW_NODE'` 的 pending input 超时 resume 原 run（从 checkpoint 重建 recovery context 并 re-queue 执行，不设 `answers` 字段），由 workflow engine handler 决定终态；对 `producerRef.kind !== 'WORKFLOW_NODE'` 的 pending input 超时保持直接终态化 `FAILED`。checkpoint 不可用时 fallback 到直接终态化 `FAILED`（`PENDING_INPUT_TIMEOUT`）。
- **依据 Requirements**：`Runtime resolves pending input timeout`

### 结果

- **变更类型**：修改
- **目标内容**：WORKFLOW_NODE 超时终态由 engine 决定（`WORKFLOW_NODE_TIMEOUT` 无 exception 或 `COMPLETED` 有 exception）；非 WORKFLOW_NODE 和 checkpoint 不可用 fallback 终态为 `FAILED`（`PENDING_INPUT_TIMEOUT`）。
- **依据 Requirements**：`Runtime resolves pending input timeout`

### 规格

#### 规格项：WORKFLOW_NODE 超时处理

- **变更类型**：修改
- **原规格值**：所有 pending input 超时直接终态化 `FAILED`（`PENDING_INPUT_TIMEOUT`）
- **目标规格值**：WORKFLOW_NODE 超时 resume 原 run（不设 `answers`），终态由 engine 决定；非 WORKFLOW_NODE 直接终态化 `FAILED`（`PENDING_INPUT_TIMEOUT`）；checkpoint 不可用时 fallback `FAILED`（`PENDING_INPUT_TIMEOUT`）
- **依据 Requirements**：`Runtime resolves pending input timeout`
