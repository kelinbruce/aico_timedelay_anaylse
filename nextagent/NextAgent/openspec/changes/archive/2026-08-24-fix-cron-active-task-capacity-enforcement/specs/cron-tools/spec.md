## Function

- **所属 Function**：`FN-10.9 Cron 工具`
- **Function 变更类型**：`MODIFIED`
- **spec 角色**：主规格

## ADDED Requirements

### Requirement: Cron 创建执行 ACTIVE 任务容量限制

系统 MUST 对每个 trusted Cron task scope（`tenantId + subjectId + agentId`）的 ACTIVE task 数量执行固定上限 50。容量判定 MUST 只统计 `status='ACTIVE'` 的 durable task；`COMPLETED` 和 `DELETED` task MUST NOT 占用额度。Cron Tool create、Web management create 以及任何主路径 durable create MUST 使用同一可观察容量不变量。

当新 create 会使当前 scope 的 ACTIVE task 数量超过 50 时，系统 MUST 返回 `AgentError { code: 'CRON_TASK_LIMIT_REACHED', category: 'CONFLICT', retryable: false }`，并 MUST NOT 创建 task、创建 trigger、修改既有 task 或推进任何持久化状态。幂等重放 MUST 先于容量检查返回首次已持久化结果。并发 create MUST NOT 使同一 scope 的 ACTIVE task 数量超过 50。LOCAL 与 REMOTE deployment MUST 提供相同的容量拒绝可观察语义；REMOTE backend MUST 在自身 durable create 边界提供权威拒绝，不得仅依赖调用方 count 预检。

**需求类别**：系统质量属性
**质量属性**：容量、可靠性/恢复、安全
**适用范围**：该 Function

#### Scenario: 第 50 个 ACTIVE task 被接受

- **WHEN** 当前 trusted scope 已有 49 个 ACTIVE task
- **AND** 系统收到一个合法 Cron create
- **THEN** gateway MUST 接受写入
- **AND** scope 内 ACTIVE task 数量变为 50

#### Scenario: 第 51 个 ACTIVE task 被拒绝

- **WHEN** 当前 trusted scope 已有 50 个 ACTIVE task
- **AND** 系统收到一个合法 Cron create
- **THEN** gateway MUST 返回 `CRON_TASK_LIMIT_REACHED`
- **AND** 错误 category MUST 为 `CONFLICT` 且 `retryable=false`
- **AND** gateway MUST NOT 插入新 task、修改既有 task 或改变 scope 内 ACTIVE 数量

#### Scenario: COMPLETED 和 DELETED task 不占用额度

- **WHEN** scope 内有任意数量的 `COMPLETED` 或 `DELETED` task
- **AND** 当前 ACTIVE task 少于 50
- **THEN** 新 create MUST 可以成功
- **AND** 容量检查 MUST NOT 把这些非 ACTIVE task 计入

#### Scenario: 完成一次性任务释放额度

- **WHEN** scope 内已有 50 个 ACTIVE task
- **AND** 其中一个 one-shot task 成功 claim 后变为 `COMPLETED`
- **THEN** 后续合法 create MUST 可以成功
- **AND** 新 task 创建后 ACTIVE 数量必须仍不超过 50

#### Scenario: 容量按 trusted scope 隔离

- **WHEN** 当前 scope 已有 50 个 ACTIVE task
- **AND** 新 create 属于不同 tenant、subject 或 agent scope
- **THEN** 该 create 的容量检查 MUST 只统计自身 scope
- **AND** MUST NOT 因其他 scope 满额而失败

#### Scenario: 幂等重放不受容量限制影响

- **WHEN** scope 内已有 50 个 ACTIVE task
- **AND** 一个 create 在达到上限前已通过同一 idempotency key 持久化
- **AND** client 以相同 key 重放该 create
- **THEN** gateway MUST 返回首次已持久化结果
- **AND** gateway MUST NOT 因当前满额而返回容量错误

#### Scenario: 并发创建不得突破 50

- **WHEN** 多个并发 create 在 scope 已有 49 个 ACTIVE task 时提交
- **THEN** gateway MUST 恰好接受其中一个新 task
- **AND** 其余 create MUST 以 `CRON_TASK_LIMIT_REACHED` 失败
- **AND** durable scope 内 ACTIVE task 数量 MUST 最终为 50

## MODIFIED Requirements

### Requirement: Cron Tool 调用指导

系统 SHALL 为 `Cron` Tool 及其输入字段提供与实际 schema、解析器和执行生命周期一致的模型可见描述。描述 MUST 使模型能够区分相对 delay、一次性日历 cron、周期 cron、list 和 delete；MUST 说明支持的五段数字 cron 子集、本地时间与分钟精度、recurring 默认行为、delay 总量边界以及 task scope 容量。描述 MUST NOT 把单轮副作用 Tool 调用限制表述为 Cron 的总任务上限。

描述中的 scope 容量 MUST 指当前 trusted scope 最多保存 50 个 ACTIVE task；已完成或已删除 task MUST NOT 被描述为仍占用容量。描述 MUST NOT 声称 `COMPLETED` 或 `DELETED` task 会阻止新任务创建。

#### Scenario: 容量与单轮限制不混淆

- **WHEN** 一次用户意图需要创建多个 Cron task
- **THEN** 描述 MUST 说明当前 scope 最多保存 50 个 ACTIVE task
- **AND** MUST 说明单轮最多 5 次副作用调用不是 Cron 总容量，剩余创建应由后续执行轮次继续
- **AND** MUST NOT 把 COMPLETED 或 DELETED task 描述为仍占用容量

## Function 变更汇总

### 描述

- **变更类型**：修改
- **目标内容**：Cron 定时任务能力增加每个 trusted scope 最多 50 个 ACTIVE task 的容量治理语义；COMPLETED 和 DELETED task 不占用额度。
- **依据 Requirements**：`Cron 创建执行 ACTIVE 任务容量限制`

### 处理过程

- **变更类型**：修改
- **目标内容**：系统收到合法 Cron create 后，先判定该 trusted scope 的 ACTIVE task 数量；数量已达到 50 时拒绝创建并返回容量冲突，未达到 50 时继续现有 durable create 和到期触发流程。幂等重放优先返回首次结果。
- **依据 Requirements**：`Cron 创建执行 ACTIVE 任务容量限制`

### 结果

- **变更类型**：修改
- **目标内容**：容量内创建返回稳定 task 结果；容量已满时返回 `CRON_TASK_LIMIT_REACHED` 的 `CONFLICT` 安全错误，不产生 task、trigger 或其他持久化 side effect。
- **依据 Requirements**：`Cron 创建执行 ACTIVE 任务容量限制`

### 规格

| 规格项 | 变更类型 | 原规格值 | 目标规格值 | 依据 Requirements |
| --- | --- | --- | --- | --- |
| Cron ACTIVE task 容量 | 新增 | 无 | 每个 trusted `(tenantId, subjectId, agentId)` scope 最多 50 个 `ACTIVE` task；`COMPLETED` 和 `DELETED` 不占用额度 | `Cron 创建执行 ACTIVE 任务容量限制` |
| Cron Tool 容量指导 | 修改 | 描述当前 scope 最多保存 50 个任务 | 描述当前 scope 最多保存 50 个 ACTIVE task，并说明 COMPLETED/DELETED 不占用容量 | `Cron Tool 调用指导` |
