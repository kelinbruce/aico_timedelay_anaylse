## MODIFIED Requirements

### Requirement: Messages 与 tools 是 provider-neutral 契约输入
目标 contract refinement SHALL 用 provider-neutral 的 message 与 tool 契约替换当前最小的 `ChatMessage.content: string`、`toolCallId?` 和 `tools: JsonObject[]` 基线。

目标 message 契约 SHALL 为模型输入定义 `ModelMessage` 与 `ModelMessageContentPart` 语义，包括 role、text content 以及显式的 tool-call / tool-result 配对。Multi-part content 与 attachment 引用 SHALL 作为本次 refinement 的一部分被评审，并要么纳入目标契约，要么显式延期。

目标 tool 契约 SHALL 定义以 capability binding、稳定 tool name、可选 description 和 provider-neutral input schema 为中心的 `ModelToolDescriptor` 语义。AI SDK 的 message、tool、tool part 以及 provider 特定的 tool schema 类型 MUST NOT 进入 `agent-contracts`；`agent-model` MUST 在内部把 provider-neutral 契约映射到 AI SDK。

`ModelToolCall` SHALL 携带 `toolCallId`、`toolName` 和结构化 JSON `arguments`。`toolName` SHALL 表示在模型消息和 provider adapter 映射中使用的 provider-neutral 模型 tool name；在公开的 model invocation 契约中它 SHALL NOT 被命名为 `capabilityId`。

`ModelToolResultContentPart` SHALL 携带 `toolCallId`、`toolName` 和结构化 JSON `output`。Tool result message SHALL 保留与 assistant tool call 配对所需的原始 tool name，而不要求 provider adapter 从之前的消息推断它。

`agent-core` SHALL 在调用任何 capability 之前，针对当前 Agent 可见的 capability descriptor 解析 `ModelToolCall.toolName`。Capability invocation、runtime context、timeline、recovery、audit 和 web projection 契约 SHALL 继续使用 `capabilityId` 表示已解析的 NextAgent capability 身份。

#### Scenario: 模型请求包含 tools
- **WHEN** 调用方为 invocation 准备模型 tools
- **THEN** 公开请求 MUST 把它们表达为 provider-neutral 的 `ModelToolDescriptor` 值，而不是 raw AI SDK tool 定义

#### Scenario: 组装 tool result message
- **WHEN** 一个 tool result 被包含在模型输入中
- **THEN** 公开 message 契约 MUST 使用 `toolCallId` 和 `toolName` 保持 tool-call / tool-result 配对，而不要求上游 package 构造 AI SDK message part

#### Scenario: Provider adapter 映射 tool 消息
- **WHEN** `agent-model` 把 provider-neutral 模型消息映射到 adapter 特定的请求
- **THEN** 它 MUST 直接使用 `ModelToolCall.toolName` 和 `ModelToolResultContentPart.toolName` 作为 provider tool name
- **AND** 当 tool result part 已携带 `toolName` 时，它 MUST NOT 从之前的 assistant 消息推断 tool result name

#### Scenario: Core 解析模型 tool call
- **WHEN** 模型结果包含 `ModelToolCall.toolName`
- **THEN** `agent-core` MUST 在 capability 调用之前把该 tool name 解析为已受理 Agent 的一个可见 capability descriptor
- **AND** 下游 capability 执行 MUST 使用已解析 descriptor 的 `capabilityId`