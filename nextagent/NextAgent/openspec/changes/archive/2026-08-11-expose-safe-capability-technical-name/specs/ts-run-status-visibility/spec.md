## Function

- **所属 Function**：`FN-2.4 查看请求状态`
- **Function 变更类型**：`MODIFIED`
- **spec 角色**：主规格

## ADDED Requirements

### Requirement: Capability 生命周期可显示受限技术目标名称

当 `CAPABILITY_STARTED` 对应的运行时 Capability 为 `Skill`、`Agent` 或普通 Tool 生命周期下的 `ApiCall`，且可信后端能够证明该事件与同一 owner、Agent、session、request、run、tool call 和 Capability 的模型工具调用唯一关联时，Web stream projection MUST 输出该调用的受限技术目标名称。`Skill` MUST 使用模型工具调用中已校验的 `name`，`Agent` MUST 使用已校验的 `agentId`，`ApiCall` MUST 使用已校验的 `apiName`；该名称 MUST 作为 optional、non-null string 字段 `capabilityTargetName` 输出。

`capabilityTargetName` trim 后 MUST 匹配 `^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$`。字段缺失、关联无法唯一证明或值不匹配该闭合格式时，projection MUST 省略该字段并保留现有 wrapper 身份和状态；projection MUST NOT 因名称不可用而隐藏过程步骤、其他过程内容或最终答案。该字段的默认行为是缺失，旧服务、旧历史和旧客户端 MUST 继续按现有 wrapper 标题互操作。

Agent Web MUST 将 wrapper 身份、合法 `capabilityTargetName` 和当前本地化状态组合为同一标题。同一 `toolCallId` 的后续结果或完成事件未重复携带该名称时，Agent Web MUST 保留已经观察到的名称；没有先前名称时 MUST 使用 wrapper 标题。该行为 MUST 在 live、刷新后的 run-event history、SSE、WebSocket 以及 local、immersive、collaborative 三种宿主中一致。

**需求类别**：功能性需求

#### Scenario: Skill 显示实际技术名称

- **GIVEN** 一个 `Skill` 启动事件唯一关联到 `arguments.name=network-diagnostics` 的模型工具调用
- **WHEN** 用户在 live 或刷新后的 history 查看该步骤
- **THEN** stream payload MUST 包含 `capabilityTargetName=network-diagnostics`
- **AND** 中文 Agent Web 标题 MUST 显示 `SKILL · network-diagnostics` 和当前本地化状态

#### Scenario: Agent 名称在完成事件中保留

- **GIVEN** 一个 `Agent` 启动事件投影了 `capabilityTargetName=network-explorer`
- **AND** 同一 `toolCallId` 的结果和完成事件没有重复该字段
- **WHEN** Agent Web 将该调用聚合为已完成步骤
- **THEN** 标题 MUST 继续显示 `Agent · network-explorer` 和已完成状态
- **AND** 系统 MUST NOT 为恢复名称新增网络请求

#### Scenario: 普通 Tool 生命周期下的 ApiCall 显示 API 名称

- **GIVEN** 一个普通 Tool 生命周期下的 `ApiCall` 启动事件唯一关联到 `arguments.apiName=query-network-kpi` 的模型工具调用
- **WHEN** 用户查看该步骤
- **THEN** 标题 MUST 显示 `ApiCall · query-network-kpi` 和当前状态
- **AND** 当前未产生普通 Capability 卡片的直接 ApiCall 路径 MUST NOT 因本 Requirement 新增卡片

#### Scenario: completion-only 路径安全降级

- **GIVEN** 一个合法 completion-only 过程只有 `CAPABILITY_COMPLETED` 且此前没有可关联的启动名称
- **WHEN** Agent Web 显示该步骤
- **THEN** 标题 MUST 使用现有 wrapper 身份和完成状态
- **AND** 系统 MUST NOT 从结果正文恢复或猜测目标名称

### Requirement: 技术目标名称不得扩大结果披露边界

可信后端 MUST 只从已通过完整模型工具调用关联校验的 `Skill.name`、`Agent.agentId` 或 `ApiCall.apiName` 形成 `capabilityTargetName`，并 MUST NOT 投影该工具调用的其他参数。模型工具调用中的 `args`、`prompt`、路径、请求参数、credential、token、原始结果、Capability Result Message 正文和未白名单 metadata MUST NOT 因技术目标名称投影进入普通 Agent Web。

`capabilityTargetName` MUST 与 `STATUS_ONLY`、`SUMMARY`、`DETAIL` 的有效结果级别独立。同一合法名称在三种配置级别下 MUST 相同；名称存在 MUST NOT 提高平台安全上限、创建 `safeSummary` 或 `safeResult`、开放结果正文或改变安全失败投影。没有平台安全 projector 的运行时 Capability 即使配置为 `DETAIL` 也 MUST 继续降级为 `STATUS_ONLY`。`Bash` 和 `Read` 配置为 `DETAIL` 时 MUST 继续只显示其已有安全 projector 允许的有界详情，且生产默认级别 MUST 保持不变。

**需求类别**：系统质量属性

**质量属性**：安全
**适用范围**：该 Function

#### Scenario: 非白名单参数不随名称输出

- **GIVEN** 一个 `Skill` 模型工具调用同时包含合法 `name` 以及 `args`、`path` 和 `prompt`
- **WHEN** 后端投影对应 `CAPABILITY_STARTED`
- **THEN** payload MUST 只增加合法 `capabilityTargetName`
- **AND** payload MUST NOT 包含 `args`、`path`、`prompt` 或这些字段的值

#### Scenario: 非法名称被局部省略

- **GIVEN** 一个目标名称为空、超过 128 个 ASCII 字符、包含换行、控制字符、空白或路径分隔符
- **WHEN** 后端投影对应生命周期事件
- **THEN** payload MUST 省略 `capabilityTargetName`
- **AND** 该步骤 MUST 继续显示 wrapper 身份和状态

#### Scenario: 普通工具不能借同名参数获得目标名称

- **GIVEN** 一个 `Read` 或未知扩展 Tool 的模型工具调用包含 `name`、`agentId` 或 `apiName`
- **WHEN** 后端投影对应启动事件
- **THEN** payload MUST 省略 `capabilityTargetName`
- **AND** 该 Tool 的既有公开身份与有效结果级别 MUST 保持不变

#### Scenario: 结果显示级别不改变名称和安全上限

- **GIVEN** 同一个合法 wrapper 调用分别应用 `STATUS_ONLY`、`SUMMARY` 和 `DETAIL` 配置
- **WHEN** 后端投影其生命周期与结果
- **THEN** 三种配置下 MUST 输出相同的 `capabilityTargetName`
- **AND** 结果摘要、详情和正文 MUST 继续由各自有效结果级别与平台安全 projector 决定

## Function 变更汇总

### 描述

- **变更类型**：修改
- **目标内容**：请求状态过程可以显示受限 runtime Capability wrapper 技术目标名称；名称不可用时保持现有安全降级，并且结果披露边界不变。
- **依据 Requirements**：`Capability 生命周期可显示受限技术目标名称`、`技术目标名称不得扩大结果披露边界`

### 规格

- **规格项**：技术目标名称范围
- **变更类型**：新增
- **原规格值**：不适用（新增）
- **目标规格值**：仅支持 `Skill.name`、`Agent.agentId`、普通 Tool 生命周期下的 `ApiCall.apiName`；值匹配 `^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$`，否则省略。
- **依据 Requirements**：`Capability 生命周期可显示受限技术目标名称`、`技术目标名称不得扩大结果披露边界`

### 处理过程

- **变更类型**：修改
- **目标内容**：系统在完整关联校验成功后输出受限技术目标名称，Agent Web 按同一调用保留名称；关联或格式校验失败时只省略名称。
- **依据 Requirements**：`Capability 生命周期可显示受限技术目标名称`、`技术目标名称不得扩大结果披露边界`
