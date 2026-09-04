## Function

- **所属 Function**：`FN-10.10 任务通道`
- **Function 变更类型**：`MODIFIED`
- **spec 角色**：主规格

## ADDED Requirements

### Requirement: Runtime Request Summary Read Model

既有 `RuntimeSessionPort` SHALL 提供异步 `getRequestSummary(query)` application query 供 Channel reconciliation 使用。query SHALL 接受可信 `IdentityContext`、`sessionId` 和 `requestId`；返回 domain read model SHALL 使用 canonical `sessionId`、`requestId`、`RunStatus`、`updatedAt`、可选 `activePendingInput` 和可选 `terminalResult`。

request status 为 `COMPLETED`、`FAILED`、`CANCELED` 或 `SUPERSEDED`，且最后一个 matching terminal Event 通过 `terminalMessageId` 关联同一可信 Owner Scope、Agent Scope、session、request 与 run 下满足既有可见性策略的 terminal Assistant Message 时，`terminalResult` MUST 存在。`terminalResult.content` MUST 等于该 Message 已提交的 inline 或 `PERSISTED_PREVIEW` projection，`contentType` MUST 来自该 Message；Runtime MUST NOT 读取 workspace 文件把 preview 自动展开为全文。

失败 terminal Event 同时提供合法非空 `code`、合法非空 `category` 和 boolean `retryable` 时，`terminalResult.safeError` MUST 包含三个字段；任一字段缺失或非法时 `safeError` MUST 省略。Message 缺失、隐藏、role 或 terminal metadata 非法、坐标不匹配、Event 缺失或 request 非终态时，`terminalResult` MUST 省略，MUST NOT 从 Event body、workspace 文件或其他 Message 回退。

query SHALL 在返回前验证 Owner Scope 与 persisted Agent Scope。Runtime SHALL 从既有专用持久化事实组装 request status、active PendingInput 与 terminal result，MUST NOT 返回 gateway `*Record` 或引入 Task Channel alias。既有 `RuntimeSessionPort` SHALL 继续唯一拥有该 query；系统 MUST NOT 新增平行 request-query port。read model MUST NOT 暴露 `runId`、`requestContextId`、`lastEventSequence` 或 `attempt`。

**需求类别**：功能性需求

#### Scenario: Runtime从terminal Message返回committed projection

- **GIVEN** authorized Channel 查询已提交终态的 request
- **AND**最后一个 terminal Event 强关联合法 terminal Assistant Message
- **WHEN** Runtime 返回 request summary
- **THEN** `terminalResult.content` MUST 等于该 Message 的 committed content
- **AND** Capability 大结果 MUST 返回 Message 中的 preview/ref projection
- **AND** Runtime MUST NOT 自动读取 workspace 文件返回全文

#### Scenario: Runtime不从Event或workspace回退

- **GIVEN** request 为 terminal status，但 terminal Message association 缺失、损坏或坐标不匹配
- **WHEN** Runtime 返回 request summary
- **THEN** summary MUST 省略 `terminalResult`
- **AND** MUST NOT 使用 Event body、workspace 文件或其他 Message

#### Scenario: Runtime一致返回active pending input

- **WHEN** current request run 存在 active PendingInput
- **THEN** summary MUST 包含该 PendingInput 与同一 logical snapshot 的 current run status

#### Scenario: Runtime summary不暴露内部诊断坐标

- **WHEN** Runtime 返回任一 request summary
- **THEN** summary MUST NOT 包含 `runId`、`requestContextId`、`lastEventSequence` 或 `attempt`
- **AND** MUST 只使用 canonical runtime 字段名

#### Scenario: Cross-scope request summary被隐藏

- **WHEN** caller 查询 trusted Owner Scope 或 Agent Scope 外的 request
- **THEN** Runtime MUST 返回 undefined
- **AND** MUST NOT 泄露 request、terminal Message 或 workspace ref 是否存在

## Function 变更汇总

### 描述

- **变更类型**：修改
- **目标内容**：Task Channel 通过既有 request summary 读取状态、PendingInput 与 Message-owned terminal result。
- **依据 Requirements**：`Runtime Request Summary Read Model`

### 处理过程

- **变更类型**：修改
- **目标内容**：系统在可信 scope 与 run 坐标内关联 terminal Message；合法时返回 committed inline 或 preview/ref projection，关联失败省略结果。
- **依据 Requirements**：`Runtime Request Summary Read Model`

### 主规格

- **变更类型**：修改
- **目标内容**：`agent-task-channel`
- **依据 Requirements**：`Runtime Request Summary Read Model`

### 遗留规格

- **变更类型**：修改
- **目标内容**：`ts-core-contracts` 不再承载 Task Channel 的 `Runtime Request Summary Read Model`
- **依据 Requirements**：`Runtime Request Summary Read Model`

### 规格

- **规格项**：Task terminal result正文来源
- **变更类型**：新增
- **原规格值**：不适用（新增）
- **目标规格值**：可信 terminal Message 的 committed inline 或 preview/ref projection；关联失败省略结果，不回退 Event 或 workspace
- **依据 Requirements**：`Runtime Request Summary Read Model`
