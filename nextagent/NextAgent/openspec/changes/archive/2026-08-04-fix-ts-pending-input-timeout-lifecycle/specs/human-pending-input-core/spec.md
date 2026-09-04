## Function

- **所属 Function**：`FN-6.5 请求用户确认或授权`
- **Function 变更类型**：`MODIFIED`
- **spec 角色**：主规格

## ADDED Requirements

### Requirement: Runtime resolves pending input timeout

系统 MUST 根据已接受的 `timeoutAt` 和已提交的 pending-input lifecycle facts 处理待确认输入超时。客户端请求、模型输出、channel metadata 或事实读取结果 MUST NOT 定义或覆盖 timeout policy。系统可用时，即使没有新 submit、会话导航、Web stream connection、页面可见性变化或进程重启，也 MUST 在执行环境能于 deadline 后继续运行时推进已经到期的 timeout。

**需求类别**：功能性需求

#### Scenario: Runtime owns timeout decision

- **WHEN** 系统接受一个 pending input intent
- **THEN** 系统 MUST 使用统一 pending lifecycle clock 计算并校验 accepted `timeoutAt`
- **AND** producer-provided `timeoutAt` MUST 只作为显式 timeout 请求，而不是 policy authority
- **AND** client payload、model output、channel metadata 和读取到的 facts MUST NOT 定义或覆盖 timeout policy
- **AND** 本 change MUST NOT 引入 per-agent、per-kind、per-tenant、client-provided、model-provided 或 configurable timeout policy

#### Scenario: Default timeout is assigned

- **WHEN** 系统创建未显式指定 `timeoutAt` 的 pending input
- **THEN** 系统 MUST 把 accepted `timeoutAt` 设为创建时刻后 30 分钟
- **AND** safe pending-input request MUST 展示该 accepted deadline

#### Scenario: Explicit timeout is bounded

- **WHEN** pending input intent 请求显式 `timeoutAt`
- **THEN** 系统 MUST 只接受晚于创建时刻且不晚于创建后 24 小时的值
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

#### Scenario: Timeout terminalization does not request input again

- **WHEN** 系统把 timed-out pending input 终止为 `FAILED/PENDING_INPUT_TIMEOUT`
- **THEN** 该 timeout terminalization MUST NOT 创建 replacement pending input
- **AND** reject、deny、normal answer 和其他 terminal outcome MUST 保持既有行为

### Requirement: Timeout processing remains idle and bounded

系统在没有新 accepted deadline、没有 dependency failure 且最早 unresolved deadline 尚未到达时，MUST NOT 按固定周期重复读取 timeout facts。一次处理 MUST 以至多 100 条 facts 为一个 batch，并 MUST 保证同一 runtime instance 同时至多有一个 timeout processing flow。超过一批的 facts MUST 被继续处理，MUST NOT 因批次边界、相同 deadline 或单条失败而静默遗漏。

**需求类别**：系统质量属性

**质量属性**：性能/容量

**适用范围**：该 Function

#### Scenario: Healthy idle runtime does not poll

- **GIVEN** 初始化读取已经成功完成
- **AND** 最早 unresolved `PENDING` deadline 位于未来
- **WHEN** deadline 前没有新 pending input 且没有 dependency failure
- **THEN** 系统 MUST NOT 按固定间隔重复读取 unresolved timeout facts

#### Scenario: Candidate processing is bounded and non-overlapping

- **GIVEN** 一个可信 Agent Scope 包含超过 100 条 unresolved timeout facts
- **WHEN** timeout processing 运行
- **THEN** 系统 MUST 每批检查至多 100 条 facts
- **AND** 同一 runtime instance 同时 MUST 至多执行一个 processing flow
- **AND** 系统 MUST 继续后续批次直到全部 eligible facts 都被检查
- **AND** 同 deadline、跨批次或单条失败 MUST NOT 造成后续 fact 静默遗漏

### Requirement: Timeout processing recovers safely from interruption

系统 MUST 从已提交 facts 恢复 due `PENDING` 和 terminal 尚未完成的 `TIMED_OUT`。单条或 dependency failure MUST NOT 终止系统进程、回滚已完成状态或阻止后续 eligible fact；依赖恢复后 MUST 继续收敛缺失的 canonical timeout event 和 terminal result。系统关闭或 session 删除后 MUST 不再处理已退出其有效生命周期范围的 timeout fact。

**需求类别**：系统质量属性

**质量属性**：可靠性/恢复

**适用范围**：该 Function

#### Scenario: Startup processes already-due facts before readiness

- **GIVEN** 系统启动时可信 Agent Scope 内存在 due `PENDING` facts
- **WHEN** startup recovery 完成
- **THEN** 系统 MUST 在 readiness 前执行一次 timeout recovery
- **AND** MUST NOT 处理其他 Agent Scope 的 fact
- **AND** future `PENDING` facts MUST 继续在各自 accepted deadline 后得到处理

#### Scenario: Partial timeout completion is retried from durable facts

- **GIVEN** pending input 已为 `TIMED_OUT`
- **AND** owning RequestRun 尚未完成 terminal result
- **WHEN** 之前的 timeout attempt 在 canonical event 或 terminal result 完成前中断
- **THEN** 后续 processing MUST 重新发现并继续该 incomplete fact
- **AND** MUST 幂等形成 canonical `USER_INPUT_TIMEOUT`
- **AND** MUST 幂等完成 `FAILED/PENDING_INPUT_TIMEOUT`
- **AND** MUST NOT 把 pending input 恢复为 `PENDING` 或恢复原 run

#### Scenario: One candidate failure does not stop later candidates

- **GIVEN** 同一批次中一个 timeout fact 因 dependency 暂时不可用而失败
- **WHEN** 该批次还有其他 eligible facts
- **THEN** 系统 MUST 继续处理其他 facts
- **AND** dependency 恢复后 MUST 重试 incomplete fact
- **AND** failure MUST NOT 终止系统进程

#### Scenario: Session deletion removes timeout facts

- **GIVEN** 一个 session 已没有 active run 且包含 resolved 或 terminal pending-input facts
- **WHEN** scoped session deletion 成功
- **THEN** 该 session 的 pending-input facts MUST 不再可见或可被 timeout processing 重新发现
- **AND** 删除 MUST NOT 影响其他 session 的 timeout facts

#### Scenario: Runtime close stops timeout processing

- **WHEN** 系统关闭开始
- **THEN** 系统 MUST 不再启动新的 timeout processing flow
- **AND** 已开始的 flow MUST 在既有 bounded close budget 内结束或停止
- **AND** 关闭完成后 MUST 不再处理新的 timeout fact

### Requirement: Timeout is visible and rejects late answers

系统 MUST 把 completed timeout 作为 pending-input lifecycle event 暴露，并拒绝所有 late answers。Timeout MUST 通过与其他 committed lifecycle facts 相同的 canonical stream、history、session activity 和 frontend pending-input projection 可见。

**需求类别**：功能性需求

#### Scenario: Timeout publishes safe event

- **WHEN** pending input 收敛为 `TIMED_OUT`
- **THEN** 系统 MUST 发布 canonical `USER_INPUT_TIMEOUT`
- **AND** stream projection MUST 只暴露 pending input id、kind、status 和 safe summary
- **AND** MUST NOT 暴露 raw prompt、raw answer、model-formatted answer、identity、idempotency key 或 timeout behavior

#### Scenario: Timed-out background session becomes unread failure

- **GIVEN** 一个 session 已投影为 `WAITING_FOR_INPUT`
- **AND** 用户正在查看其他 session
- **WHEN** pending input timeout 与 owning RequestRun terminal result 完成
- **THEN** 既有 session activity projection MUST 把 `WAITING_FOR_INPUT` 替换为 `UNREAD_FAILURE`
- **AND** MUST NOT 要求 timed-out session detail stream 保持打开

#### Scenario: Switching back restores the normal Composer

- **GIVEN** pending input 在其 session 非当前 conversation 时超时
- **WHEN** 用户打开该 session 且 canonical timeout history 或 stream facts 已投影
- **THEN** agent-web MUST 不再保持 timed-out pending-input response surface
- **AND** MUST 呈现 normal message Composer
- **AND** local countdown expiry MUST 继续无权清除 pending input state

#### Scenario: Late answer after timeout is rejected

- **WHEN** channel 为已收敛为 `TIMED_OUT` 的 pending input 提交 answer
- **THEN** 系统 MUST 返回安全 timeout/conflict outcome
- **AND** MUST NOT 恢复原 run
- **AND** MUST NOT 把 timed-out fact 改回 `RECEIVED`

## Function 变更汇总

### 描述

- **变更类型**：修改
- **目标内容**：系统为确认或授权等待建立受控 deadline；deadline 到达后，即使没有新请求、页面连接或进程重启，也会继续推进 timeout 并以 canonical failure 结束等待。
- **依据 Requirements**：`Runtime resolves pending input timeout`、`Timeout processing remains idle and bounded`、`Timeout processing recovers safely from interruption`、`Timeout is visible and rejects late answers`

### 输入

- **变更类型**：修改
- **目标内容**：已接受的 pending input、可选显式 `timeoutAt`、可信 Agent Scope 和已提交 lifecycle facts；客户端、模型和 channel metadata 不能覆盖 timeout policy。
- **依据 Requirements**：`Runtime resolves pending input timeout`、`Timeout processing recovers safely from interruption`

### 输出

- **变更类型**：修改
- **目标内容**：到期后形成 `TIMED_OUT`、canonical `USER_INPUT_TIMEOUT` 和 `FAILED/PENDING_INPUT_TIMEOUT`；前端与跨会话活动只消费安全投影。
- **依据 Requirements**：`Runtime resolves pending input timeout`、`Timeout is visible and rejects late answers`

### 处理过程

- **变更类型**：修改
- **目标内容**：系统接受并校验 deadline，在 deadline 到达后有界处理 eligible facts；中断后从已提交 facts 继续收敛，timeout terminalization 不再次请求输入。
- **依据 Requirements**：`Runtime resolves pending input timeout`、`Timeout processing remains idle and bounded`、`Timeout processing recovers safely from interruption`

### 结果

- **变更类型**：修改
- **目标内容**：正常到期会安全终止并恢复普通 Composer；半完成结果可幂等恢复；late answer、跨 Agent fact 与关闭后的新处理均被拒绝或忽略，不逆转已提交结果。
- **依据 Requirements**：`Runtime resolves pending input timeout`、`Timeout processing recovers safely from interruption`、`Timeout is visible and rejects late answers`

### 量化指标

- **指标名称**：默认待确认输入超时
- **变更类型**：修改
- **原值或原口径**：stable spec 已定义创建后 30 分钟，当前 Function 文档未记录该值。
- **目标值或目标口径**：无显式 deadline 时为创建时刻后 30 分钟。
- **单位与测量边界**：分钟；从统一 pending lifecycle clock 的创建时刻到 accepted `timeoutAt`。
- **依据 Requirements**：`Runtime resolves pending input timeout`

- **指标名称**：显式待确认输入超时上限
- **变更类型**：状态收敛
- **原值或原口径**：当前 Function 文档记录 24 小时为“建议评审值”，stable spec 已将其定义为强制上限。
- **目标值或目标口径**：显式 `timeoutAt` 必须晚于创建时刻且不超过创建后 24 小时，状态为已定义。
- **单位与测量边界**：小时；从统一 pending lifecycle clock 的创建时刻到 requested `timeoutAt`。
- **依据 Requirements**：`Runtime resolves pending input timeout`

- **指标名称**：单次 timeout processing 批次
- **变更类型**：新增
- **原值或原口径**：无稳定批次指标。
- **目标值或目标口径**：每批至多 100 条 unresolved timeout facts；同一 runtime instance 同时至多执行一个 processing flow。
- **单位与测量边界**：条/批次与个/运行时实例；从一批 facts 开始处理到该批结束。
- **依据 Requirements**：`Timeout processing remains idle and bounded`

### 接口

- **变更类型**：修改
- **目标内容**：系统内部 pending-input lifecycle；public answer API 与 stream payload shape 不变，timeout 继续通过 canonical `USER_INPUT_TIMEOUT` 和安全终态投影可见。
- **依据 Requirements**：`Runtime resolves pending input timeout`、`Timeout is visible and rejects late answers`

### 覆盖特性

- **变更类型**：修改
- **目标内容**：`F-6.5 人工交互边界`
- **依据 Requirements**：`Runtime resolves pending input timeout`、`Timeout is visible and rejects late answers`

### 主规格

- **变更类型**：修改
- **目标内容**：`human-pending-input-core`
- **依据 Requirements**：`Runtime resolves pending input timeout`、`Timeout processing remains idle and bounded`、`Timeout processing recovers safely from interruption`、`Timeout is visible and rejects late answers`

### 遗留规格

- **变更类型**：修改
- **目标内容**：`human-pending-input-timeout` 只保留未触及的 `Timeout never auto-approves`；`confirmation-pending-input` 与 `authorization-pending-input` 等其他 legacy Requirements 原位保留，不新增映射。
- **依据 Requirements**：`Runtime resolves pending input timeout`、`Timeout is visible and rejects late answers`
