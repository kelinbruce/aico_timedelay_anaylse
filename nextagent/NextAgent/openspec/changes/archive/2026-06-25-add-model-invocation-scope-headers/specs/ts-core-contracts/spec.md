# ts-core-contracts Specification Delta

## Modified Requirements

### Requirement: Model 调用请求携带可信 run 坐标用于 provider 关联

`ModelInvocationRequest` MAY 携带可信的 `invocationScope`，包含来自已接受 `RequestRun` 的 `agentId`、`sessionId`、`requestId` 和 `runId` 坐标。Agent Core SHALL 在构造已接受 run 的 model 调用请求时，从 runtime 拥有的 run 状态填充该 scope。如果提供，`invocationScope` MUST 完整，且 `invocationScope.requestId` MUST 与 `ModelInvocationRequest.requestId` 匹配。Provider adapter MAY 将该 scope 作为出站 HTTP 关联 header 的来源，并 MUST NOT 将其放入 model 可见 message、tool 结果、safe error 或 provider JSON 请求体中。当 `invocationScope` 缺失时，provider adapter SHALL 省略这些关联 header。

#### Scenario: Agent Core 填充 model 调用坐标

- **WHEN** Agent Core 构造一个 `ModelInvocationRequest`
- **THEN** 它 MUST 从已接受的 `RequestRun` 设置 `invocationScope.agentId`、`invocationScope.sessionId`、`invocationScope.requestId` 和 `invocationScope.runId`
- **AND** 它 MUST NOT 从 client 请求体、model 输出或 capability 参数接受这些坐标

#### Scenario: Provider adapter 发出关联 header

- **WHEN** provider adapter 发送出站 model HTTP 请求
- **AND** `invocationScope` 存在且有效
- **THEN** 它 MAY 添加 `X-NextAgent-Agent-Id`、`X-NextAgent-Session-Id`、`X-NextAgent-Request-Id` 和 `X-NextAgent-Run-Id`
- **AND** 相同的标识符 MUST NOT 被添加到 prompt message 或 provider JSON 请求体中

#### Scenario: Provider adapter 在无 invocation scope 时省略关联 header

- **WHEN** provider adapter 发送出站 model HTTP 请求
- **AND** `invocationScope` 缺失
- **THEN** 它 MUST NOT 添加 `X-NextAgent-Agent-Id`、`X-NextAgent-Session-Id`、`X-NextAgent-Request-Id` 或 `X-NextAgent-Run-Id`
