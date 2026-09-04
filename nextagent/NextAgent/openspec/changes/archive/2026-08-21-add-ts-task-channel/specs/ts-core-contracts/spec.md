## MODIFIED Requirements

### Requirement: Runtime Request 摘要读模型

既有 `RuntimeSessionPort` SHALL 为 channel 对账暴露一个异步的 `getRequestSummary(query)` 应用查询。该查询 SHALL 接受受信 `IdentityContext`、`sessionId` 和 `requestId`。Runtime SHALL 返回一个使用 canonical `sessionId`、`requestId`、`RunStatus`、`updatedAt`、可选 `activePendingInput` 和可选 `terminalResult` 的领域读模型。

当 request 状态为 terminal（COMPLETED、FAILED、CANCELED、SUPERSEDED）且 terminal timeline 事件 payload 包含结果内容时，`terminalResult` SHALL 存在。它 SHALL 包含 `content`（terminal 结果文本）、`contentType`，以及针对失败 request 的可选安全错误字段（`code`、`category`、`retryable`）。Runtime SHALL 从该 request 最后一个 terminal timeline 事件提取 `terminalResult`。当未找到 terminal 事件或 request 不是 terminal 时，`terminalResult` MUST 缺失。

该查询 SHALL 在返回数据前校验 Owner Scope 和已持久化的 Agent Scope。Runtime SHALL 从既有专用持久化事实组装 request 状态和 active PendingInput；它 MUST NOT 返回 gateway `*Record` 对象，也不得在 runtime 契约中引入 Task Channel 别名。该查询 SHALL 由既有 RuntimeSessionPort 拥有；MUST NOT 引入平行的 request-query port。该读模型 MUST NOT 向 channel 暴露 `runId`、`requestContextId`、`lastEventSequence` 或 `attempt`；这些仍为内部 runtime 诊断信息。

#### Scenario: Runtime 返回带 terminal 结果的 request 摘要
- **WHEN** 一个已授权的 channel 查询一个 terminal request
- **THEN** runtime MUST 返回带 `terminalResult` 的摘要，其中包含 `content` 和 `contentType`
- **AND** 对于失败 request，`terminalResult` MAY 包含 `code`、`category` 和 `retryable`

#### Scenario: Runtime 一致地返回 active pending input
- **WHEN** 一个当前 request run 存在 active PendingInput
- **THEN** 其摘要 MUST 包含该 PendingInput 以及来自同一逻辑快照的匹配当前 run 状态

#### Scenario: Runtime 返回不带内部诊断信息的摘要
- **WHEN** 为任何 request 返回摘要
- **THEN** 它 MUST NOT 包含 `runId`、`requestContextId`、`lastEventSequence` 或 `attempt`
- **AND** 它 MUST 只使用 canonical runtime 字段名

#### Scenario: 跨 scope 查询被隐藏
- **WHEN** 调用方查询受信 Owner Scope 或 Agent Scope 之外的 request
- **THEN** runtime MUST 返回 undefined
- **AND** MUST NOT 泄露该 request 的存在性
