## Function

- **所属 Function**：`FN-3.2 编译智能体装配`
- **Function 变更类型**：`MODIFIED`
- **spec 角色**：主规格

## ADDED Requirements

### Requirement: Agent package 保留可选本地化展示名称

`agent.yaml` MUST 支持 optional、非 `null` 的 `locales`，其结构和校验边界 MUST 与 `CapabilityDescriptor.locales` 相同。字段缺失时 Agent package MUST 继续按既有 `displayName` 编译；字段非法时 package compilation MUST fail closed，并 MUST NOT 发布半成品 `AgentAssembly`。

**需求类别**：功能性需求

runtime-ready `AgentAssembly` MUST 保留已校验的 optional `locales`，使 Agent Capability Provider 可以把 `AgentAssembly.displayName` 和 `AgentAssembly.locales` 逐值投影到同一 Agent descriptor。`locales` MUST 只承载展示事实，MUST NOT 改变 `agentId`、`agentVersion`、assembly selection、routing、model、prompt、capability binding、Agent invocation、workspace policy 或 Agent Scope。

#### Scenario: Agent package 提供中英文名称

- **WHEN** 合法 `agent.yaml` 提供稳定 `displayName` 以及 `zh-CN`、`en-US` 本地化名称
- **THEN** compilation MUST 在 runtime-ready `AgentAssembly` 中保留这些展示事实
- **AND** Agent Provider 产生的 descriptor MUST 逐值保留相同事实

#### Scenario: Agent package 未提供本地化名称

- **WHEN** 合法 `agent.yaml` 不包含 `locales`
- **THEN** compilation MUST 继续成功
- **AND** Agent descriptor MUST 使用既有稳定 `displayName`，MUST NOT 伪造本地化名称

#### Scenario: 随产品交付的 network-explorer 可直接验收中英文名称

- **GIVEN** 仓库随产品交付既有 `network-explorer` builtin Agent package
- **WHEN** app-owned loader 编译该 package
- **THEN** runtime-ready assembly MUST 包含产品定义的 `zh-CN` 与 `en-US` 名称
- **AND** `agentId`、稳定 `displayName`、description、binding 和 Agent invocation MUST 保持不变

#### Scenario: Agent package 名称非法

- **WHEN** `agent.yaml.locales` 不满足 `CapabilityDescriptor.locales` 的结构、locale grammar 或文本约束
- **THEN** package compilation MUST fail closed
- **AND** 系统 MUST NOT 发布该 Agent 的半成品 assembly 或 descriptor

## Function 变更汇总

### 输入

- **变更类型**：修改
- **目标内容**：Agent package 可以提供与统一 Capability 展示事实同形的 optional 本地化名称。
- **依据 Requirements**：`Agent package 保留可选本地化展示名称`

### 输出

- **变更类型**：修改
- **目标内容**：runtime-ready `AgentAssembly` 和由其产生的 Agent descriptor 保留已校验的稳定及本地化名称；字段缺失时保持既有输出。
- **依据 Requirements**：`Agent package 保留可选本地化展示名称`

### 处理过程

- **变更类型**：修改
- **目标内容**：系统在 package compilation 时校验名称事实，非法输入 fail closed，合法输入不改变装配、路由和执行选择。
- **依据 Requirements**：`Agent package 保留可选本地化展示名称`
