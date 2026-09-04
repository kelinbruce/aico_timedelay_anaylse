## ADDED Requirements

### Requirement: Stream normalization 定义一个稳定的流式语义模型
本能力 SHALL 使用有序的 `ModelStreamDelta` 项和一个 terminal `ModelFinalResult` 定义一个稳定的流式语义模型。

#### Scenario: Stream contract 已被 review
- **WHEN** stream normalization change 被用作设计输入
- **THEN** 它 MUST 被解释为目标流式语义模型，而不是 provider 特定的 stream 形状

### Requirement: Stream delta 是 provider 中立的
`ModelStreamDelta` SHALL 表示 provider 中立的 model 事实，而不是 provider 原生 transport chunk、AI SDK stream part 或内部 AI SDK raw part。

TS 首版实现 SHALL 使用 `@openrouter/ai-sdk-provider@2.9.0` 和 `ai@^6.0.195` 作为内部 AI SDK provider 组件和 stream part 映射 baseline。所选的 `ai@^6.0.195` 版本 SHALL 满足 OpenRouter provider package 的 peer dependency `ai@^6.0.0`。这些版本选择 SHALL 保持为 `agent-model` 的实现细节，并 SHALL NOT 把 AI SDK 类型、OpenRouter provider 类型、part 名称或版本特定的 DTO 引入 public contract。

当这些抽象能够表达所需的 model 事实时，实现 SHOULD 优先使用 `@openrouter/ai-sdk-provider@2.9.0` 的 stream 抽象，而不是手写的 provider 原生 stream 解析器。额外的 provider 支持 SHALL 通过 OpenRouter 支撑的内部 adapter 映射到相同的 provider 中立 `ModelStreamDelta` / `ModelFinalResult` 语义来添加，而不是通过扩展 public stream contract。

至少，stream delta MUST 使用现有的 `ModelStreamDelta` 公开字段 `reasoning?`、`content?` 和 `toolCall?` 支持已 normalize 的 reasoning、内容推进和完整的 tool-call 发射。

当前的 `agent-contracts/model` 边界 SHALL NOT 被本能力改变。Stream normalization SHALL 使用现有的按字段成形的 `ModelStreamDelta` contract，而不是添加 public `kind` 判别字段或新的 delta 词汇表。

Tool-call 推进 MUST 在 provider 或 AI SDK part 尚不完整时于 `agent-model` 内部累积。normalizer MUST 在一旦能够产生带稳定 `toolCallId`、`capabilityId` 和已解析 JSON `arguments` 的完整规范化 `ModelToolCall` 时，就发射 `ModelStreamDelta.toolCall`。`ModelStreamDelta.toolCall` MUST NOT 携带部分 arguments、provider 原始 function-call payload、AI SDK raw part 或 AI SDK 特定的 tool 状态。

terminal 的 `ModelFinalResult.toolCalls` 字段 MUST 仍然包含流式期间产生的完整有序的已规范化 tool call 集合。

Terminal 完成和 terminal 失败 SHALL 通过 `ModelFinalResult` 表达，而不是额外的 public delta kind。

#### Scenario: Provider 发出内容 chunk
- **WHEN** 某 provider 发出增量内容
- **THEN** stream 输出 MUST 暴露 provider 中立的 content delta，而不是原始的 provider chunk payload

#### Scenario: OpenRouter AI SDK provider stream part 被规范化
- **WHEN** adapter 收到 `@openrouter/ai-sdk-provider@2.9.0` stream part
- **THEN** Core `text` part、UI `text-delta` part 或 provider 等价的 content delta MUST 映射到 `ModelStreamDelta.content`
- **AND** Core `reasoning` part、UI `reasoning-delta` part 或 provider 等价的 reasoning delta MUST 映射到 `ModelStreamDelta.reasoning`
- **AND** Core `tool-call-streaming-start` / `tool-call-delta`、UI `tool-input-start` / `tool-input-delta` 或 provider 等价的 function-call 片段 MUST 更新内部 tool-call 聚合，直到可以发射完整的 `ModelToolCall`
- **AND** Core `tool-call`、UI `tool-input-available` 或成功解析的 provider 等价完整 tool call MUST 映射到 `ModelStreamDelta.toolCall`
- **AND** start、finish、step、usage 和 response metadata part MUST 更新 terminal 聚合，而不是创建 public terminal delta kind

#### Scenario: 通过 AI SDK 引入额外的 provider
- **WHEN** 一个新 provider 可以通过 `@openrouter/ai-sdk-provider@2.9.0` stream 抽象到达
- **THEN** `agent-model` MUST 在内部把该 provider 的 stream 事实映射到现有的 `ModelStreamDelta` / `ModelFinalResult` 语义
- **AND** 上游 package MUST NOT 收到 provider 特定的 stream payload 或 AI SDK DTO

### Requirement: Tool-call 片段保持顺序和关联
当 provider 跨多个 chunk 流式输出 tool-call 片段时，normalization MUST 在 `agent-model` 内部保持片段顺序和稳定的 tool-call 关联，直到可以产生完整的规范化 tool call。

#### Scenario: Provider 分片流式输出 tool arguments
- **WHEN** tool-call arguments 跨多个 chunk 到达
- **THEN** normalizer MUST 在稳定 id、capability id 和已解析 JSON arguments 一旦可用时，就为该 tool call 发射一个完整的 `ModelStreamDelta.toolCall`
- **AND** 下游消费者 MUST 能够从 `ModelFinalResult.toolCalls` 读取相同的规范化 tool call，而无需解析 provider 原始 chunk、AI SDK stream part 或内部 AI SDK raw part

### Requirement: 流式收敛到相同的 terminal result contract
在零个或多个 `ModelStreamDelta` 项之后，`stream()` SHALL 以与非流式 invocation 相同的 `ModelFinalResult` 语义终止。

`ModelStreamDelta` 和 `ModelFinalResult` 都 MUST 保留双语执行追踪所需的 invocation locale 关联。TS 首版 MAY 通过 invocation 请求和 runtime 拥有的 request context / timeline 关联来保留这一关联，而不是把 `locale` 重复到每个 delta 和 terminal result 中。

terminal result 形状 MUST 保留以下稳定字段：

- `providerResponseId?`
- `providerModelId?`
- `content`
- `reasoning?`
- `finishReason?`
- `usage`
- `toolCalls`
- `safeError?`

#### Scenario: Stream 成功完成
- **WHEN** 某个 stream 以 assistant 输出结束
- **THEN** terminal 项 MUST 是一个可消费的 `ModelFinalResult`

### Requirement: Stream 失败是显式的
如果流式无法产生成功的 terminal result，terminal 结果 MUST 是携带 `safeError` 的显式 `ModelFinalResult`。

仅有 transport 关闭、provider 哨兵帧或 transport 级失败本身 MUST NOT 成为唯一的完成信号。

#### Scenario: Stream normalization 失败
- **WHEN** provider 原生 chunk 或内部 AI SDK raw part 无法被 normalize 为有效的 terminal result
- **THEN** 该 stream MUST 以携带 `safeError` 的显式失败结果结束
