## ADDED Requirements

### Requirement: Runtime owns request-carried ModelOptions contract
系统 SHALL 在 `agent-contracts/runtime` 下定义 request-carried `RequestModelOptions` contract。`SubmitRequestCommand`、accepted `RequestContext`，以及 retry/recovery 重建出的等价 submit/context 形态 MUST 能携带可选的 request-scoped model options。runtime SHALL 把该 typed 值作为可信请求事实稳定传递到 Agent 执行路径，而不是把它当作 profile 配置、provider 配置或全局默认值。

#### Scenario: Submit command carries request-scoped model options
- **WHEN** channel/auth boundary 构造一个包含允许字段的 submit 请求
- **THEN** `SubmitRequestCommand` MAY carry `requestModelOptions`
- **AND** accepted `RequestContext` MAY carry同一 typed `requestModelOptions`
- **AND** runtime MUST NOT 将该字段解释为 owner override、agent override、provider override、model profile override 或全局配置变更

#### Scenario: Retry and recovery preserve request-scoped model options
- **WHEN** runtime 对一个已接受请求执行 retry、queue rebuild、claimed-run recovery 或 terminal-pending recovery
- **THEN** 重建出的 `SubmitRequestCommand` 与 `RequestContext` MUST 保留原请求的 `requestModelOptions`
- **AND** 同一请求的 thinking 关闭事实 MUST NOT 在 retry 或 recovery 时回退为 profile 默认值
- **AND** request-scoped model options 的存在或缺失 MUST 参与相同请求语义的 idempotency 判定

#### Scenario: Request has no request-scoped model options
- **WHEN** channel/auth boundary 构造请求时未提供 request-scoped model options
- **THEN** `SubmitRequestCommand.requestModelOptions` MAY be absent
- **AND** accepted `RequestContext.requestModelOptions` MAY be absent
- **AND** 请求生命周期 MUST 保持既有 model profile 与 prompt 驱动的默认 model option 行为

### Requirement: RequestModelOptions fields are minimal and safe
`RequestModelOptions` SHALL 只定义 request-scoped、provider-neutral、allowlist 的模型行为偏好字段。本 change 首版只允许 `thinking.depth`，取值仅限 `OFF`。该 contract MUST NOT 定义 temperature、topP、maxOutputTokens、provider-private reasoning knobs、raw prompt、credential、路径、provider override、model profile override、owner/agent override 或其他未授权字段。

#### Scenario: Allowed field is represented
- **WHEN** 请求提供 `requestModelOptions.thinking.depth = "OFF"`
- **THEN** typed runtime contract MUST 能表示该字段
- **AND** 该字段 MUST 仅表示当前请求关闭 think 的偏好
- **AND** 该字段 MUST NOT 直接暴露 provider-specific reasoning 参数

#### Scenario: Forbidden model override is attempted
- **WHEN** 输入尝试通过 request-scoped model options 传入 `temperature`、`topP`、`maxOutputTokens`、provider reasoning object、provider options、owner/agent override、credential、路径或其他未授权字段
- **THEN** 这些字段 MUST NOT 在 `RequestModelOptions` contract 中可表示
- **AND** Web/runtime schema validation MUST fail closed before它们进入 accepted request execution path
