## Function

- **所属 Function**：`FN-8.2 检索和写入记忆`
- **Function 变更类型**：`MODIFIED`
- **spec 角色**：主规格

## MODIFIED Requirements

### Requirement: Memory tools architecture boundaries

系统 SHALL 保持 memory tools 与架构、核心契约和并行开发边界一致。Memory tools 不得重新定义已由 `add-ts-memory-core` 冻结的核心 memory DTO、port、ranking、state enum 或 owner scope 语义，不得修改 runtime lifecycle、session store schema、platform endpoint 或后台 scheduler。

当已启用的 Agent 在首个 `BEFORE_MODEL_INVOKE` 触发用户 Query 主动记忆召回时，系统 MUST 通过 owning-change application service boundary 使用 memory core gateway public ports 执行 L1 检索和 L2 详情读取；该路径 MUST 使用可信的 Owner Scope 和 Agent Scope，MUST NOT 调用 `search_memory`、`get_memory_detail`、`add_memory`、`LongTermMemoryToolPort`、memory tool descriptor、capability executor 或 capability invocation。该路径 MUST 由 app/runtime 的受信终末 Hook 执行通道调用；通用 `LifecycleHook`、plugin SDK 和 `HookInput` 不得获得 Owner Scope、长期记忆读取 port 或原始召回结果。除该受控主动召回外，context assembly MUST NOT 自动检索长期记忆；system prompt 仍 MUST NOT 预加载 `search_memory` 的用户特征检索结果。

**需求类别**：功能性需求

#### Scenario: 已启用 Agent 在首次模型调用前主动召回
- **GIVEN** AgentAssembly 已启用 `user-query-memory-recall`，且当前请求具有可信 Owner Scope 和 Agent Scope
- **WHEN** 首个 `BEFORE_MODEL_INVOKE` 的主动记忆召回读取长期记忆
- **THEN** 系统 MUST 通过 memory core gateway public ports 或 owning-change application service boundary 执行读取
- **AND** 系统 MUST NOT 发起模型工具调用或 capability invocation

#### Scenario: 未启用 Agent 不自动读取长期记忆
- **GIVEN** AgentAssembly 未启用 `user-query-memory-recall`
- **WHEN** 系统为请求构造模型输入
- **THEN** Context Engine MUST NOT 自动检索长期记忆
- **AND** 模型仍可在后续执行期自主调用已绑定的 memory tools

#### Scenario: 主动召回遵守双重作用域
- **GIVEN** 主动记忆召回请求包含当前执行 Agent 的可信 Agent Scope 和可信 Owner Scope
- **WHEN** 系统执行 L1 检索或 L2 详情读取
- **THEN** 系统 MUST 只读取同时属于该 Agent Scope 和 Owner Scope 的 `ACTIVE` 记忆
- **AND** 不存在、不可披露或不属于当前作用域的条目 MUST NOT 进入模型输入

#### Scenario: 通用 Hook 输入不承载 owner scope
- **WHEN** 实现用户 Query 主动记忆召回
- **THEN** 系统 MUST NOT 通过通用 plugin Lifecycle Hook Input 向插件暴露 Owner Scope
- **AND** 主动召回所需的可信作用域 MUST 仅在 app/runtime 的受信执行通道和受控 application service boundary 内取得和消费
- **AND** 主动召回的原始结果和模型消息 mutation MUST NOT 写入 `HOOK_INVOKED` 的持久化 payload、timeline、日志、metric、trace 或 audit；仅固定结果码、最多 `10` 的 L1 候选数、可用 L2 详情数和枚举化的准入结果可作为安全诊断摘要写入

#### Scenario: 不新增竞争性记忆契约
- **WHEN** memory tools 或用户 Query 主动记忆召回需要读取或写入长期记忆
- **THEN** 它们 MUST 使用 `add-ts-memory-core` 的 public memory contract
- **AND** 它们 MUST NOT 定义竞争性的 memory record、state、ranking 或 owner scope 契约

#### Scenario: 不新增平台接口
- **WHEN** 完成本变更
- **THEN** 系统 MUST NOT 新增长期记忆 REST API、Web UI 管理入口或 platform endpoint
- **AND** 用户管理、维护和共享能力 MUST 由后续独立 change 定义

#### Scenario: 非主动召回的非模型消费者
- **WHEN** 非模型模块需要读取、写入、更新、删除、排序、老化、提取或维护长期记忆，且该操作不是用户 Query 主动记忆召回
- **THEN** 它 MUST 依赖 `LongTermMemoryStoreGateway`、`LongTermMemoryRetrieverGateway` 或自身 owning-change application service boundary
- **AND** 它 MUST NOT 将 model-facing memory tools、`LongTermMemoryToolPort`、tool descriptor、tool input/output schema 或 capability invocation 作为内部服务 API

#### Scenario: Narrow Tool SPI dependency authorization
- **WHEN** implementing the `agent-memory` memory tools provider/factory
- **THEN** the provider/factory MAY import only public Tool SPI and capability contribution SPI types
- **AND** it MUST NOT import `agent-capability` catalog, discovery, executor, builtin tool definitions, private source paths, or value-level helpers
- **AND** `agent-capability` MUST NOT import `agent-memory`, memory gateway ports, memory DTOs, or memory-specific provider code

## ADDED Requirements

### Requirement: 主动召回的 L2 读取有界、响应取消且全有或全无

`UserQueryMemoryRecallService` MUST 在单次 L1 检索返回的全部候选上执行 L2 详情读取；候选数量受 L1 的 `limit=10` 限制。服务 MUST 将并发读取数限制为最多 `3` 个，MUST NOT 对 L1 或 L2 发起重试。父请求取消或任一 L2 失败后，服务 MUST 停止分发尚未开始的 L2 调用，并在所有已开始调用结束后返回无上下文结果。底层 gateway 不支持取消在途调用时，服务 MUST NOT 将取消后完成的结果返回给调用方。

任一 L2 调用发生超时、取消、不可用、权限拒绝或失败时，服务 MUST 停止分发尚未开始的 L2 调用，并在所有已开始调用结束后仅返回无上下文结果。服务 MUST NOT 返回部分 L2 结果，MUST NOT 以缺失条目外的详情形成模型输入。L1 未命中时，服务 MUST 不发起 L2 调用并返回无上下文结果。

**需求类别**：系统质量属性
**质量属性**：性能/容量、可靠性/恢复
**适用范围**：该 Function

#### Scenario: L2 并发受限
- **GIVEN** L1 返回了多条候选记忆
- **WHEN** 服务读取这些候选的 L2 详情
- **THEN** 同时在途的 L2 读取数 MUST NOT 超过 `3`
- **AND** 每个候选 MUST 仅被读取一次

#### Scenario: 任一 L2 失败时停止分发同批读取
- **GIVEN** 同一批 L2 详情读取已经开始
- **WHEN** 任一详情读取超时、取消、不可用、权限拒绝或失败
- **THEN** 服务 MUST 不再启动尚未开始的读取，并等待已开始读取结束
- **AND** 服务 MUST 返回不含任何 L2 详情的无上下文结果

#### Scenario: 父请求取消
- **GIVEN** 同一批 L2 详情读取已经开始
- **WHEN** 父请求被取消
- **THEN** 服务 MUST 不再启动尚未开始的读取
- **AND** 服务 MUST 忽略取消后完成的详情并返回无上下文结果

#### Scenario: L1 未命中
- **GIVEN** L1 未返回候选记忆
- **WHEN** 服务完成本次主动召回
- **THEN** 服务 MUST NOT 调用 L2 详情读取
- **AND** 服务 MUST 返回无上下文结果

## Function 变更汇总

### 描述

- **变更类型**：修改
- **目标内容**：长期记忆保留模型显式工具检索和写入能力，并为已启用 Agent 的首轮用户 Query 提供受控的非模型主动读取消费者。
- **依据 Requirements**：`Memory tools architecture boundaries`

### 前置条件

- **变更类型**：修改
- **目标内容**：主动读取仅在 Agent 显式启用、首个 `BEFORE_MODEL_INVOKE` 阶段和可信双重作用域可用时执行。
- **依据 Requirements**：`Memory tools architecture boundaries`

### 处理过程

- **变更类型**：修改
- **目标内容**：模型工具路径仍经 capability invocation 执行；用户 Query 主动召回经受控 application service 或 memory core gateway public port 读取，不进入模型工具路径。
- **依据 Requirements**：`Memory tools architecture boundaries`

### 结果

- **变更类型**：修改
- **目标内容**：主动召回只能产生当前双重作用域内的 `ACTIVE` 记忆读取结果，越权或不可披露条目不进入模型输入。
- **依据 Requirements**：`Memory tools architecture boundaries`
