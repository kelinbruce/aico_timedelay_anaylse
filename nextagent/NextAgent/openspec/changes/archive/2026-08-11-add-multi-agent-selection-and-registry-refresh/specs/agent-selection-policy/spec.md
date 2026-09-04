## Function

- 所属 Function：`FN-3.5 Agent 选择策略`
- Function 变更类型：`ADDED`
- spec 角色：主规格

## ADDED Requirements

### Requirement: Agent 选择策略在 session 创建前决定请求路由到哪个 agent

系统 MUST 在 `RuntimeSessionPort.createSession` 调用链中同步执行 Agent Selection Policy，决定当前请求由哪个 agent 处理。Agent Selection Policy 是请求入口层的 agent 选择策略，与 agent-internal routing policy（`AgentRoutingConfig`，决定 agent 内部走 skill/workflow/model-loop）是两个不同层级的策略，两者 MUST NOT 混用。

触发机制：Agent Selection Policy 在 `createSession` 调用链中同步执行，位于 channel boundary identity 解析和 header 提取之后、session 持久化之前。不涉及后台 job 或调度机制。Web channel 和 task channel 的 createSession MUST 统一调用此接口，保证多 channel 行为一致。

Agent Selection Policy MUST 接收以下输入：
- channel boundary 提取的 hosted-agent selection 原始值（如 header `x-agent-id` 的原始字符串，未经格式校验）
- 可信的 `defaultRouteAgentId`（来自 `hostedAgent.activeAgentId` 配置）

Agent Selection Policy MUST 执行以下判断：
1. 原始值存在且满足 agentId 格式约束（safeId 正则） -> 选择该 agentId，产出 safe reason code `HEADER_AGENT_ID_SELECTED`
2. 原始值缺失或为空 -> 选择 `defaultRouteAgentId`，产出 safe reason code `DEFAULT_ACTIVE_AGENT`
3. 原始值存在但不满足格式约束 -> 拒绝请求，返回 safe validation error，MUST NOT fallback

Agent Selection Policy MUST 产出以下结果：
- 选择的 `agentId`
- 选择原因的 safe reason code

safe reason code 是非持久化的运行时诊断值，生命周期限于当前 createSession 调用。它 MUST 通过 structured log 记录（event: `agent.selection.resolved`，字段: `agentId`、`safeReason`），MUST NOT 进入 Web API response、SSE、WebSocket、timeline、audit event 或 `ObservabilityObservationEvent`。

**需求类别**：功能性需求

#### Scenario: header 指定 agentId 时选择该 agent

- **WHEN** channel 从 header `x-agent-id` 提取原始值 `network-specialist` 并传给 Agent Selection Policy
- **THEN** Agent Selection Policy MUST 同步校验格式并选择该 agentId
- **AND** MUST 产出 safe reason code `HEADER_AGENT_ID_SELECTED`
- **AND** 该 reason code MUST 通过 structured log 记录，MUST NOT 进入 Web response

#### Scenario: 未指定 header 时 fallback 到默认 agent

- **WHEN** channel 未提取到 header `x-agent-id` 原始值或原始值为空
- **THEN** Agent Selection Policy MUST 同步选择 `defaultRouteAgentId`
- **AND** MUST 产出 safe reason code `DEFAULT_ACTIVE_AGENT`

#### Scenario: header 值无效时 fail closed

- **WHEN** channel 提取的 header `x-agent-id` 原始值不满足 agentId 格式约束
- **THEN** Agent Selection Policy MUST 同步拒绝该请求并返回 safe validation error
- **AND** MUST NOT fallback 到默认 agent 而静默忽略无效输入

#### Scenario: Web channel 和 task channel 统一调用 Agent Selection Policy

- **WHEN** Web channel 或 task channel 的 createSession 被调用
- **THEN** runtime MUST 通过统一的 `AgentSelectionPolicy.resolve` 执行 agent 选择
- **AND** 两个 channel 的选择行为 MUST 一致

### Requirement: Agent Selection Policy 校验选择的 agentId 可用后才绑定到 session

系统 MUST 在 Agent Selection Policy 产出 agentId 后，通过 `AgentAssemblyRegistry.active(agentId)` 校验该 agentId 对应一个存在且 user-invocable 的 assembly。校验通过后系统 MUST 将该 agentId 绑定到 session 并持久化。校验失败时系统 MUST 返回明确的 missing-assembly safe failure，MUST NOT 静默 fallback 到默认 agent。

session 一旦绑定 agentId，后续所有请求 MUST 使用 `session.agentId`，MUST NOT 重新从 header 解析 agentId。该不变量确保 agent scope 的信任链闭合：header（选择请求） -> AgentSelectionPolicy 格式校验 + assemblyRegistry 校验（可信） -> session 绑定（持久化） -> 后续用 session.agentId。

`session.agentId` 是持久化产物，生命周期与 session 相同。消费方包括：submit（`createSubmitSession` 用 agentId 创建 session，`SUBMIT_AGENT_SCOPE_MISMATCH` 校验一致性）、stream/message/attachment/cancel（通过 `requireSession` 读取 `session.agentId`）、recovery（通过 `require(agentId, agentVersion)` 读取 frozen assembly）。`session.agentId` 只能来自可信 app composition 校验路径，MUST NOT 来自客户端请求体或模型输出。

**需求类别**：功能性需求

#### Scenario: 选择的 agent 存在且可调用时绑定到 session

- **WHEN** Agent Selection Policy 选择 agentId `network-specialist`
- **AND** `AgentAssemblyRegistry.active('network-specialist')` 返回一个 `userInvocable=true` 的 assembly
- **THEN** 系统 MUST 将 `network-specialist` 绑定到创建的 session 并持久化
- **AND** session 的所有后续操作 MUST 使用该 agentId 隔离数据

#### Scenario: 选择的 agent 不存在时 fail closed

- **WHEN** Agent Selection Policy 选择 agentId `unknown-agent`
- **AND** `AgentAssemblyRegistry.active('unknown-agent')` 无法解析 assembly
- **THEN** 系统 MUST 返回 missing-assembly safe failure
- **AND** MUST NOT 创建绑定到默认 agent 的 session 作为 fallback

#### Scenario: 已绑定 session 不再从 header 取 agentId

- **WHEN** 一个 session 已绑定 agentId `network-specialist`
- **AND** 后续请求的 header `x-agent-id` 包含不同的 agentId
- **THEN** 系统 MUST 使用 session 已绑定的 agentId `network-specialist`
- **AND** MUST NOT 使用 header 中的 agentId 覆盖已绑定的 session agentId

### Requirement: Agent Selection Policy 接口可扩展支持集成服务定制

系统 MUST 提供 `AgentSelectionPolicy` 接口，允许集成服务提供自定义实现替换默认的显式选择策略。自定义实现 MUST 接收与默认实现相同的输入契约，MUST 产出相同的结果契约（agentId + safe reason code）。

默认实现 MUST 为显式选择（header agentId -> fallback `activeAgentId`）。集成服务 MAY 提供基于租户、意图或其他可信信号的自定义选择逻辑，但 MUST NOT 使用请求体、模型输出、capability 参数或客户端 metadata 覆盖 agent scope。

**需求类别**：系统质量属性

**质量属性**：可维护性

**适用范围**：该 Function

#### Scenario: 集成服务提供自定义选择策略

- **WHEN** 集成服务注册了一个自定义 `AgentSelectionPolicy` 实现
- **THEN** 系统 MUST 使用该实现替换默认实现
- **AND** 该实现 MUST 产出符合结果契约的 agentId 和 safe reason code
- **AND** 该实现 MUST NOT 从请求体或客户端 metadata 获取 agentId

#### Scenario: 自定义策略产出无效结果时 fail closed

- **WHEN** 自定义 `AgentSelectionPolicy` 实现产出的 agentId 无法通过 `AgentAssemblyRegistry.active(agentId)` 校验
- **THEN** 系统 MUST 返回 missing-assembly safe failure
- **AND** MUST NOT fallback 到默认 agent

## Function 变更汇总

### 描述

- **变更类型**：新增
- **目标内容**：请求入口层决定由哪个 agent 处理当前请求。接收 channel boundary 提取的 hosted-agent selection 原始值，经格式校验和可信 assemblyRegistry 校验后产出 agentId。默认实现为显式选择（header agentId -> fallback `activeAgentId`），接口预留集成服务定制扩展点。Web channel 和 task channel 的 createSession 统一调用。
- **依据 Requirements**：`Agent 选择策略在 session 创建前决定请求路由到哪个 agent`、`Agent Selection Policy 校验选择的 agentId 可用后才绑定到 session`、`Agent Selection Policy 接口可扩展支持集成服务定制`

### 前置条件

- **变更类型**：新增
- **目标内容**：请求已通过 channel boundary 的 identity 解析和 header 提取；`AgentAssemblyRegistry` 已初始化且包含至少一个 user-invocable agent。
- **依据 Requirements**：`Agent Selection Policy 校验选择的 agentId 可用后才绑定到 session`

### 输入

- **变更类型**：新增
- **目标内容**：channel boundary 提取的 hosted-agent selection 原始值（header `x-agent-id` 原始字符串，未经格式校验）、可信 `defaultRouteAgentId`。
- **依据 Requirements**：`Agent 选择策略在 session 创建前决定请求路由到哪个 agent`

### 输出

- **变更类型**：新增
- **目标内容**：选择的 agentId 和 safe reason code。safe reason code 通过 structured log 记录，不进入 Web response。校验通过后 agentId 绑定到 session 并持久化。
- **依据 Requirements**：`Agent 选择策略在 session 创建前决定请求路由到哪个 agent`、`Agent Selection Policy 校验选择的 agentId 可用后才绑定到 session`

### 处理过程

- **变更类型**：新增
- **目标内容**：同步执行格式校验（safeId 正则） -> 产出候选 agentId 或 fallback -> assemblyRegistry.active 校验存在且 user-invocable -> 绑定到 session。session 绑定后不再从 header 取。Web channel 和 task channel 统一调用。
- **依据 Requirements**：`Agent 选择策略在 session 创建前决定请求路由到哪个 agent`、`Agent Selection Policy 校验选择的 agentId 可用后才绑定到 session`

### 规格

- **规格项**：选择模式
- **变更类型**：新增
- **原规格值**：不适用（新增）
- **目标规格值**：显式选择（header `x-agent-id`）；未指定时 fallback 到 `activeAgentId`；接口支持集成服务定制；Web channel 和 task channel 统一调用
- **依据 Requirements**：`Agent 选择策略在 session 创建前决定请求路由到哪个 agent`、`Agent Selection Policy 接口可扩展支持集成服务定制`
