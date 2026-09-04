## Function

- **所属 Function**：`FN-6.5 请求用户确认或授权`
- **Function 变更类型**：`MODIFIED`
- **spec 角色**：主规格

## ADDED Requirements

### Requirement: 系统在可信 Agent Scope 内发现未完成 timeout facts

系统 MUST 只在 app composition 注入的可信 Agent Scope 内发现已经接受 `timeoutAt` 且 timeout 生命周期尚未完成的 pending input facts。发现结果 MUST 包含该 Agent Scope 下所有带 accepted `timeoutAt` 的 `PENDING`，无论 deadline 位于未来还是已经到期；也 MUST 包含已经进入 `TIMED_OUT` 但 owning RequestRun 尚未完成 terminal commit 的事实。`RECEIVED`、`CANCELED` 以及 terminal commit 已完成的 `TIMED_OUT` MUST NOT 出现在结果中。

当前时间、是否到期、timeout policy、状态转换、event 发布与 terminal commit decision MUST NOT 由事实发现边界决定。事实发现能力 MUST 只服务 runtime timeout/recovery，不得通过 Web/channel、Agent Core、model、capability 或客户端接口暴露；旧的全局 due query 与语义重叠 alias MUST 不可用。

**需求类别**：功能性需求

#### Scenario: 只返回可信 Agent Scope 内的未完成事实

- **GIVEN** 两个 Agent Scope 都存在带 accepted `timeoutAt` 的 pending input facts
- **WHEN** runtime 为其中一个可信 Agent Scope 发现未完成 timeout facts
- **THEN** 结果 MUST 只包含该 Agent Scope 的 facts
- **AND** MUST 包含 future/due `PENDING` 和 terminal 尚未提交的 `TIMED_OUT`
- **AND** MUST 排除 `RECEIVED`、`CANCELED` 和 terminal 已提交的 `TIMED_OUT`

#### Scenario: Fact discovery 不拥有 due decision

- **WHEN** 结果同时包含 future `PENDING`、due `PENDING` 和 incomplete `TIMED_OUT`
- **THEN** runtime MUST 使用自己的 lifecycle clock 与 durable state 决定后续动作
- **AND** fact discovery MUST NOT 接收当前时间、计算 due、修改 timeout policy 或推进 pending/run lifecycle

### Requirement: Timeout fact discovery 保持可信 scope 隔离

系统 MUST 使用 app composition 注入的可信 Agent Scope 筛选未完成 timeout facts。每条结果 MUST 保留自身可信 Owner + Agent + Session + Run coordinates；一次 Agent-scoped 内部维护查询 MAY 返回多个 Owner Scope 的事实，但 MUST NOT 合并或替换其 owner coordinates。缺少可信 Agent Scope 或调用方尝试使用旧全局 due query时 MUST fail closed，MUST NOT 回退为全局扫描、并行 alias 或客户端可见替代路径。

**需求类别**：系统质量属性

**质量属性**：安全

**适用范围**：该 Function

#### Scenario: 跨 Agent facts 被排除且 Owner coordinates 保留

- **GIVEN** 两个 Agent Scope 都存在未完成 timeout facts，且目标 Agent Scope 内包含多个 Owner Scope
- **WHEN** runtime 为目标可信 Agent Scope 发现 facts
- **THEN** 结果 MUST 排除其他 Agent Scope 的 facts
- **AND** 目标 Agent Scope 内每条 fact MUST 保留自己的 tenant、subject、session 和 run coordinates
- **AND** 系统 MUST NOT 合并或替换不同 Owner Scope 的 coordinates

#### Scenario: 非法或旧查询 fail closed

- **WHEN** 调用缺少可信 Agent Scope，或调用方尝试使用旧全局 due query
- **THEN** contract boundary MUST 拒绝调用
- **AND** MUST NOT 回退为全局扫描、并行 alias 或客户端可见替代路径

### Requirement: Timeout fact discovery 使用有界稳定遍历

事实发现 MUST 使用 `timeoutAt` 和 `pendingInputId` 的稳定升序与有界 keyset page；单次 page limit MUST 是 `1..1000` 的安全整数。不完整 keyset coordinate 或非法 limit MUST fail closed。Keyset coordinate MUST 只服务当前 processing pass，MUST NOT 被持久化、作为 feed revision 返回或跨 pass 复用。

**需求类别**：系统质量属性

**质量属性**：性能/容量

**适用范围**：该 Function

#### Scenario: 有界 keyset traversal 保持稳定

- **GIVEN** 同一可信 Agent Scope 存在超过一个 page 的未完成 timeout facts
- **WHEN** runtime 使用合法 limit 和上一页末尾的 `(timeoutAt, pendingInputId)` 继续读取
- **THEN** 每页 MUST 按 `timeoutAt`、`pendingInputId` 稳定升序返回
- **AND** 后续页 MUST 只返回严格大于 supplied coordinate 的 facts
- **AND** page limit MUST 在 `1..1000` 内
- **AND** keyset coordinate MUST NOT 被持久化、作为 feed revision 返回或跨 processing pass 复用

#### Scenario: 非法遍历边界 fail closed

- **WHEN** limit 不在 `1..1000` 或 keyset coordinate 缺少任一坐标
- **THEN** contract boundary MUST 拒绝调用
- **AND** MUST NOT 静默 clamp、回到首个 page 或执行无界扫描

## Function 变更汇总

### 描述

- **变更类型**：修改
- **目标内容**：系统在可信 Agent Scope 内发现已接受 deadline 且 timeout 生命周期尚未完成的 pending input facts，为后续自然到期处理和半完成恢复提供统一事实输入。
- **依据 Requirements**：`系统在可信 Agent Scope 内发现未完成 timeout facts`、`Timeout fact discovery 保持可信 scope 隔离`、`Timeout fact discovery 使用有界稳定遍历`

### 输入

- **变更类型**：修改
- **目标内容**：可信 Agent Scope、`1..1000` 的单页上限，以及可选的 `(timeoutAt, pendingInputId)` invocation-local keyset coordinate；不接收客户端 identity、当前时间或 due decision。
- **依据 Requirements**：`系统在可信 Agent Scope 内发现未完成 timeout facts`、`Timeout fact discovery 保持可信 scope 隔离`、`Timeout fact discovery 使用有界稳定遍历`

### 处理过程

- **变更类型**：修改
- **目标内容**：系统按可信 Agent Scope 筛选带 accepted deadline 的 `PENDING` 和 terminal 未提交的 `TIMED_OUT`，按稳定坐标有界遍历，并把是否到期与生命周期推进留给 runtime。
- **依据 Requirements**：`系统在可信 Agent Scope 内发现未完成 timeout facts`、`Timeout fact discovery 保持可信 scope 隔离`、`Timeout fact discovery 使用有界稳定遍历`

### 结果

- **变更类型**：修改
- **目标内容**：合法输入返回有界、稳定、保留 Owner coordinates 的未完成事实；非法 scope、limit、cursor 或旧全局查询安全失败且不产生全局扫描。
- **依据 Requirements**：`系统在可信 Agent Scope 内发现未完成 timeout facts`、`Timeout fact discovery 保持可信 scope 隔离`、`Timeout fact discovery 使用有界稳定遍历`

### 量化指标

- **指标名称**：单页事实数量
- **变更类型**：新增
- **原值或原口径**：旧契约只要求正数且由 adapter 静默截断，没有统一公共上限和 keyset 测量边界。
- **目标值或目标口径**：每页 `1..1000` 条，非法值直接拒绝；分页按 `(timeoutAt, pendingInputId)` 严格前进。
- **单位与测量边界**：条/单次可信 Agent Scope timeout fact query；筛选后、返回前计数。
- **依据 Requirements**：`Timeout fact discovery 使用有界稳定遍历`

### 接口

- **变更类型**：修改
- **目标内容**：runtime-internal Agent-scoped unresolved timeout fact query；旧全局 due query 与语义重叠 alias 不可用。
- **依据 Requirements**：`系统在可信 Agent Scope 内发现未完成 timeout facts`、`Timeout fact discovery 保持可信 scope 隔离`

### 主规格

- **变更类型**：修改
- **目标内容**：`human-pending-input-core`
- **依据 Requirements**：`系统在可信 Agent Scope 内发现未完成 timeout facts`、`Timeout fact discovery 保持可信 scope 隔离`、`Timeout fact discovery 使用有界稳定遍历`

### 遗留规格

- **变更类型**：修改
- **目标内容**：移除 `ts-core-contracts` 的 legacy `Pending input gateway fact queries` Requirement；active-pending 与 timeout discovery 黑盒行为统一由 `human-pending-input-core` 承载，白盒 gateway contract 进入 design。
- **依据 Requirements**：`系统在可信 Agent Scope 内发现未完成 timeout facts`、`Timeout fact discovery 保持可信 scope 隔离`、`Timeout fact discovery 使用有界稳定遍历`
