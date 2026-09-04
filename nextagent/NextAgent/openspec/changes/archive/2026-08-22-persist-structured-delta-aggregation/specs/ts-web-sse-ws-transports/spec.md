## Function

- **所属 Function**：`FN-1.1 查看会话消息流`
- **Function 变更类型**：`MODIFIED`
- **spec 角色**：主规格

## MODIFIED Requirements

### Requirement: 可恢复过程事件引用唯一消息正文

当一次模型 Tool 轮次的公开说明、Tool 调用参数或 ordinary Tool 终态语义结果已经形成持久化 `SessionMessage` 时，系统 MUST 先确认该消息写入成功，再发布对应的可恢复 lifecycle Event。该 Event MUST 通过 `messageId` 引用该消息，MUST NOT 在持久化 Event payload 中重复保存可从该消息恢复的正文、Tool 参数或 Tool 语义结果。

`messageId` MUST 是非空 `MessageId`。引用 Event 与目标消息 MUST 具有相同的 Owner Scope、Agent Scope、`sessionId`、`requestId` 和 `runId`；Tool Event 还 MUST 具有一致的 `toolCallId`。不满足全部关联条件的引用 MUST 被视为无效引用。

公开说明的引用 Event MUST 是携带非空 `stepId` 和 `completed=true` 的 `LLM_CONTENT_DELTA`；Tool 调用的引用 Event MUST 是 `CAPABILITY_STARTED`；已形成结果消息的 Tool 终态引用 Event MUST 是 `CAPABILITY_COMPLETED`。Tool 在结果消息形成前失败时，`CAPABILITY_COMPLETED` MUST 不携带 `messageId`，并且 MUST 只表达安全终态。

经过受治理 producer 的 canonical shape validation、安全过滤和 structured-delta 识别，并由 `tool-structured-delta` persistence rules 选为 durable history 的 `TOOL_STRUCTURED_DELTA`，在 canonical Message 尚不能分别承载语义结果与最终 structured presentation snapshot 的兼容阶段，MUST 作为独立的有界过渡 presentation Event 持久化。该 Event MUST 只表达 Channel/UI presentation，MUST NOT 取代 `CAPABILITY_RESULT` Message 的语义结果所有权，MUST NOT 进入模型上下文，MUST NOT 产生或改变 request terminal status、degradation、新的 request-level terminal fact 或 annotation。任意 stdout、JSON、Tool 自报字段或 Message 内容不满足上述可信识别条件时 MUST NOT 使用该例外。

当模型或 Tool 已产生可公开的进行中累计内容时，系统 MAY 使用 live-only delta 投影该内容；系统不选择投影或上游没有产生该内容时，系统 MUST NOT 虚构进行中正文。该 delta MUST NOT 作为历史、派生会话过程快照或模型上下文事实。最终 Assistant Message 继续遵循既有终态消息语义，不适用本 Requirement 的 structured presentation 例外。

**需求类别**：功能性需求

#### Scenario: Tool轮次公开说明先写消息再发布引用Event

- **WHEN** 模型在同一轮输出非空公开说明和至少一个 Tool 调用
- **THEN** 系统 MUST 先持久化包含该轮公开说明与 Tool 调用事实的消息
- **AND** completed `LLM_CONTENT_DELTA` MUST 通过该消息的 `messageId` 引用公开说明
- **AND** 每个 `CAPABILITY_STARTED` MUST 通过同一消息的 `messageId` 和自身 `toolCallId` 引用对应 Tool 调用
- **AND** 持久化 Event payload MUST NOT 再包含该公开说明正文或 Tool 参数副本

#### Scenario: Tool终态Event引用结果消息

- **WHEN** Tool 调用形成持久化 `CAPABILITY_RESULT` Message 和可恢复 `CAPABILITY_COMPLETED` 终态 Event
- **THEN** `CAPABILITY_COMPLETED` MUST 携带该结果消息的 `messageId`
- **AND** Event 与 Message 的 `toolCallId`、Owner Scope、Agent Scope、会话、请求和运行坐标 MUST 一致
- **AND** 持久化 Event payload MUST NOT 再包含可从结果消息恢复的 Tool 语义结果正文

#### Scenario: 可信结构化呈现使用独立Event

- **GIVEN** 一个 Tool 输出已通过受治理 producer 的 canonical structured-delta 识别和安全过滤
- **WHEN** `tool-structured-delta` persistence rules 选择 runtime 持久化该 structured presentation
- **THEN** `TOOL_STRUCTURED_DELTA` Event MUST 携带有界 presentation body
- **AND** `CAPABILITY_RESULT` Message MUST 继续持有 ordinary Capability 语义结果
- **AND** Context 与 Agent Loop MUST NOT 从该 Event 恢复模型输入

#### Scenario: 任意自报内容不能建立presentation例外

- **WHEN** arbitrary stdout、JSON、Tool 自报字段或 Message 内容未通过 canonical structured-delta 识别
- **THEN** 系统 MUST NOT 将其作为 durable structured presentation Event
- **AND** ordinary lifecycle Event MUST 继续遵循 Message 引用与无正文规则

#### Scenario: 进行中delta不成为持久化正文

- **WHEN** 模型或 Tool 在持久化消息形成前发布累计的进行中内容
- **THEN** 该内容 Event MUST 为 live-only
- **AND** 历史读取和派生会话过程快照 MUST NOT 把该内容当作持久化正文

#### Scenario: 消息写入失败阻止引用Event

- **WHEN** 公开过程内容对应的消息写入失败
- **THEN** 系统 MUST NOT 发布声称引用该消息的可恢复 lifecycle Event
- **AND** 本次执行 MUST 进入既有显式安全失败路径

## Function 变更汇总

### 处理过程

- **变更类型**：修改
- **目标内容**：普通 lifecycle Event 继续通过强 Message 引用恢复唯一语义正文；只有经过可信识别的 structured presentation 使用独立有界 Event，且不得进入 Context 或请求终态。
- **依据 Requirements**：`可恢复过程事件引用唯一消息正文`

### 结果

- **变更类型**：修改
- **目标内容**：SSE、WebSocket 与 history 能恢复同一可信 structured presentation，同时 ordinary Capability 语义结果与 terminal answer 继续保持 Message-first。
- **依据 Requirements**：`可恢复过程事件引用唯一消息正文`
