## Function

- 所属 Function：`FN-3.2 编译智能体装配`
- Function 变更类型：`MODIFIED`
- spec 角色：主规格

## ADDED Requirements

### Requirement: AgentAssemblyRegistry 支持运行时动态刷新发现新增 agent

系统 MUST 在运行时检测 `agentsRoot` 下顶层 agent 目录的新增、删除和 agent.yaml 修改。fingerprint 覆盖范围限定为 `agentsRoot` 下的顶层 agent 目录（`agents/{agentId}/agent.yaml`），不覆盖 `agents/{parentAgentId}/subagents/` 目录，并在检测到变化后重建编译后的 assembly 集合。重建后 `AgentAssemblyRegistry.active`、`AgentAssemblyRegistry.require`、`AgentDiscoverySource.listBuiltinAgentAssemblies`、`AgentDiscoverySource.listTopLevelLocalAgentAssemblies` 和 `AgentDiscoverySource.listParentSubagentAssemblies` MUST 返回更新后的 assembly 集合。

触发机制：fingerprint 检查在 `AgentAssemblyRegistry.active`、`AgentAssemblyRegistry.require` 和 `AgentDiscoverySource` 的 list 方法被调用时同步执行。fingerprint 未变化时直接返回当前集合，不产生额外开销。fingerprint 变化时同步执行重建。不涉及后台 job 或调度机制。

前置条件：`agentsRoot` 目录可访问；`systemConfig` 和 `modelProfiles` 已初始化；`assemblyRegistry` 已在启动时完成首次编译。

重建 MUST 复用与启动时相同的 Agent package assembly 编译边界和校验规则。重建过程中已 accepted 的 request MUST 继续使用其 frozen assembly（通过 `require(agentId, agentVersion)`），MUST NOT 受重建影响。

重建失败时系统 MUST 保留上一次有效的 assembly 集合，MUST NOT 用半成品或部分重建结果替换已有 registry。重建失败 MUST 通过 structured log 记录（event: `agent.registry.refresh_failed`，字段: `safeReasonCode`），MUST NOT 进入 Web API response 或 audit event。

并发触发语义：当多个请求并发触发 fingerprint 检查且 fingerprint 已变化时，系统 MUST 使用上一次有效的 assembly 集合响应当前请求，MUST NOT 阻塞请求等待重建完成。重建 MUST 在当前请求的 fingerprint 检查中同步完成；如果重建期间有新请求到达，新请求 MUST 触发独立的 fingerprint 检查，若 fingerprint 仍未变化（已重建完成）则直接返回新集合，若仍在重建中则使用上一次有效集合响应。

**需求类别**：功能性需求

#### Scenario: pub 新增 agent 目录后 registry 自动发现

- **WHEN** 进程启动后 `agentsRoot` 下新增一个 agent 目录 `agents/network-specialist/agent.yaml`
- **THEN** 系统 MUST 在下一次 registry 查询时同步检测到目录变化
- **AND** MUST 重新编译 `agentsRoot` 下所有 agent 的 assembly 集合
- **AND** `AgentAssemblyRegistry.active('network-specialist')` MUST 能返回该 agent 的 assembly
- **AND** `AgentDiscoverySource.listTopLevelLocalAgentAssemblies` MUST 包含该 agent 的 assembly

#### Scenario: 删除 agent 目录后 registry 不再返回该 agent

- **WHEN** 进程启动后 `agentsRoot` 下删除一个 agent 目录
- **THEN** 系统 MUST 在下一次 registry 查询时同步检测到目录变化
- **AND** 重建后 `AgentAssemblyRegistry.active(deletedAgentId)` MUST 返回 missing-assembly safe failure
- **AND** 已 accepted 且 frozen 到该 agent 的 request MUST 继续通过 `require(agentId, agentVersion)` 正常执行

#### Scenario: 重建失败时保留上一次有效 assembly 集合

- **WHEN** registry 重建过程中编译失败（如新增的 agent.yaml 格式非法）
- **THEN** 系统 MUST 保留上一次有效的 assembly 集合
- **AND** MUST 通过 structured log 记录失败（event: `agent.registry.refresh_failed`）
- **AND** MUST NOT 用部分重建结果替换已有 registry

#### Scenario: 已 accepted request 不受重建影响

- **WHEN** 一个 request 已 accepted 并 frozen 到 `agentId:default-agent, agentVersion:v1`
- **AND** registry 重建后 `default-agent` 的 agent.yaml 发生变化
- **THEN** 该 accepted request MUST 继续通过 `require('default-agent', 'v1')` 读取 frozen assembly
- **AND** MUST NOT 使用重建后的新 assembly 替换该 request 的 frozen assembly

#### Scenario: 并发请求不阻塞等待重建

- **WHEN** 多个请求并发触发 fingerprint 检查且 fingerprint 已变化
- **THEN** 当前正在重建的请求 MUST 同步完成重建后返回新集合
- **AND** 重建期间到达的新请求 MUST 使用上一次有效集合响应，MUST NOT 阻塞等待

## MODIFIED Requirements

### Requirement: AgentAssemblyRegistry Lookup Semantics Stay Frozen

系统 MUST 提供 in-memory `AgentAssemblyRegistry` 作为 runtime-facing lookup boundary。

- `active(agentId)` MUST 可用于 request acceptance 或等效的 pre-acceptance active-version 解析
- `require(agentId, agentVersion)` MUST 可用于 accepted request execution、recovery、context engine、core 和 capability routing
- request 一旦被 accepted，系统 MUST 持续通过 `require(agentId, agentVersion)` 使用 frozen assembly
- accepted execution MUST NOT 回退到 `active(agentId)` 或静默切换到另一个 active version
- `active(agentId)` MUST 支持查找 registry 中任意已注册的 user-invocable agent，MUST NOT 限制为单一的 configured `activeAgentId`
- registry MUST 支持运行时动态刷新（见"AgentAssemblyRegistry 支持运行时动态刷新发现新增 agent"），刷新后 `active` 和 `require` MUST 返回更新后的 assembly 集合

#### Scenario: Acceptance uses active lookup and accepted run uses require lookup

- **WHEN** runtime 即将接受一个新 request
- **THEN** MUST 通过 `AgentAssemblyRegistry.active(agentId)` 解析当前 active assembly
- **AND** acceptance 之后的执行与恢复路径 MUST 通过 `AgentAssemblyRegistry.require(agentId, agentVersion)` 读取 frozen assembly
- **AND** runtime MUST 在 accepted request state 中固化 `agentId`、`agentVersion` 和 `agentAssemblyRef`
- **AND** 后续处理 MUST NOT 重新读取 package 输入来改写该 request 的 assembly

#### Scenario: Missing assembly does not fall back to a default assembly

- **WHEN** `active(agentId)` 或 `require(agentId, agentVersion)` 无法解析所需 assembly
- **THEN** 系统 MUST 返回明确的 missing-assembly / not-found safe failure
- **AND** MUST NOT 合成 implicit default assembly 或静默切换版本

#### Scenario: 任意已注册 agent 均可通过 active 查找

- **WHEN** registry 中包含多个 user-invocable agent（如 `default-agent` 和 `network-specialist`）
- **THEN** `AgentAssemblyRegistry.active('network-specialist')` MUST 返回 `network-specialist` 的 assembly
- **AND** `AgentAssemblyRegistry.active('default-agent')` MUST 返回 `default-agent` 的 assembly
- **AND** 查找结果 MUST NOT 限制为 configured `activeAgentId`

## Function 变更汇总

### 描述

- **变更类型**：修改
- **目标内容**：registry 从启动时固定数组扩展为支持运行时动态刷新。`active(agentId)` 支持查找任意已注册 user-invocable agent，不再限制为单一 configured `activeAgentId`。
- **依据 Requirements**：`AgentAssemblyRegistry 支持运行时动态刷新发现新增 agent`、`AgentAssemblyRegistry Lookup Semantics Stay Frozen`

### 前置条件

- **变更类型**：新增
- **目标内容**：`agentsRoot` 目录可访问；`systemConfig` 和 `modelProfiles` 已初始化；`assemblyRegistry` 已在启动时完成首次编译。
- **依据 Requirements**：`AgentAssemblyRegistry 支持运行时动态刷新发现新增 agent`

### 处理过程

- **变更类型**：修改
- **目标内容**：registry 在 active/require/list 方法调用时同步检测 fingerprint 变化并重建 assembly 集合。重建复用启动时编译边界。重建失败保留上一次有效集合。并发请求不阻塞等待重建。已 accepted request 不受重建影响。
- **依据 Requirements**：`AgentAssemblyRegistry 支持运行时动态刷新发现新增 agent`

### 规格

- **规格项**：registry 刷新模式
- **变更类型**：新增
- **原规格值**：不适用（新增）
- **目标规格值**：active/require/list 调用时同步检测 fingerprint 并重建；重建失败保留上一次有效集合；并发不阻塞；已 accepted request 不受影响
- **依据 Requirements**：`AgentAssemblyRegistry 支持运行时动态刷新发现新增 agent`

- **规格项**：active 查找范围
- **变更类型**：修改
- **原规格值**：限于 configured `activeAgentId`
- **目标规格值**：任意已注册 user-invocable agent
- **依据 Requirements**：`AgentAssemblyRegistry Lookup Semantics Stay Frozen`

