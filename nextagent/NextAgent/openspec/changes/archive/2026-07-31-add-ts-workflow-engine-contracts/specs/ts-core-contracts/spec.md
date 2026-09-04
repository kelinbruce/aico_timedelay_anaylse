## MODIFIED Requirements

### Requirement: Runtime Command 与 RequestRun 基线

`SubmitRequestCommand` SHALL 接受可选 `inputVariables?: JsonObject`。`inputVariables` SHALL 由 runtime 存入已接受的 request 事实，并在 recipe 执行由 `routingConstraints.targetRecipe` 触发时提供给 `WorkflowExecutionRequest.inputVariables`。当未指定 `targetRecipe` 时，`inputVariables` SHALL 被忽略。`RequestContext` SHALL NOT 扩展 `inputVariables`；消费路径是 `SubmitRequestCommand` 到已接受 request 事实再到 `WorkflowExecutionRequest`，绕过 `RequestContext`。新字段是可选的，MUST NOT 破坏既有 `SubmitRequestCommand` 消费者。

`EditLatestRequestCommand` SHALL 接受与 `SubmitRequestCommand.inputVariables` 语义相同的可选 `inputVariables?: JsonObject`：仅在原始 submit 请求指定了 `routingConstraints.targetRecipe` 时生效，存入已接受的 request 事实，绕过 `RequestContext`。`EditLatestRequestCommand` 不携带 `routingConstraints`；runtime 从已持久化的 request 事实读取原始 submit 的 routing 约束，以判定是否适用 recipe 执行。新字段是可选的，MUST NOT 破坏既有 `EditLatestRequestCommand` 消费者。



#### Scenario: inputVariables 流向 recipe 执行
- **WHEN** 一个 submit 或 edit-latest 请求包含 `inputVariables` 和 `routingConstraints.targetRecipe`
- **THEN** `inputVariables` MUST 通过 `SubmitRequestCommand.inputVariables` 或 `EditLatestRequestCommand.inputVariables` 传递
- **AND** runtime MUST 将 `inputVariables` 存入已接受的 request 事实
- **AND** 当 recipe 执行被触发时，`inputVariables` MUST 流向 `WorkflowExecutionRequest.inputVariables`

#### Scenario: 无 targetRecipe 时 inputVariables 被忽略
- **WHEN** 一个 submit 或 edit-latest 请求包含 `inputVariables` 但未指定 `routingConstraints.targetRecipe`
- **THEN** `inputVariables` MUST 被接受但被忽略
- **AND** `inputVariables` MUST NOT 影响执行行为

#### Scenario: RequestContext 不扩展 inputVariables
- **WHEN** 一个 submit 或 edit-latest 请求包含 `inputVariables`
- **THEN** `RequestContext` MUST NOT 携带 `inputVariables`
- **AND** `inputVariables` 消费 MUST 绕过 `RequestContext`

#### Scenario: 不带 inputVariables 的既有 submit 或 edit-latest 保持兼容
- **WHEN** 一个 submit 或 edit-latest 请求不包含 `inputVariables`
- **THEN** 该请求 MUST 与 change 之前的行为完全一致地被处理
