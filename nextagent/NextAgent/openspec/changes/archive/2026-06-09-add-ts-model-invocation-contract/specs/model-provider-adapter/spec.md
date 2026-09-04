## ADDED Requirements

### Requirement: Agent-model 拥有内部 provider adapter 能力
`agent-model` SHALL 拥有内部 provider adapter 能力，该能力把稳定的 `ModelInvocationRequest` 转换为 provider 特定的访问行为，并把 provider 原生结果转换为标准 invocation 边界。

该能力是 `agent-model` 内部的，SHALL NOT 引入新的 public 跨模块 invocation contract。

#### Scenario: Invocation 进入 agent-model
- **WHEN** 一个完全解析好的 `ModelInvocationRequest` 进入 `agent-model`
- **THEN** TS 首版 baseline MUST 使用当前的 `providerKind` 字段选择其内部 provider adapter
- **AND** 如果 provider 身份的 contract 精化结论取代了 `providerKind`，长期 adapter 选择语义 MUST 遵循该结论

### Requirement: Provider adapter 消费经过 review 的 invocation 输入
被选中的 provider adapter SHALL 消费具有 provider 中立或 adapter 已定义映射的 invocation 请求字段，包括目标状态字段 `providerKind`、`modelName`、`baseUrl`、`credentialRef`、`messages`、`tools`、`commonOptions`、`providerOptions` 和 `timeoutMs`。adapter SHALL 把 `commonOptions` 内经过 allowlist 的值映射到 provider 访问，而不重新引入平行的顶层 option 字段。

这些 baseline 字段 MUST 被视为 contract review 输入。Provider 身份、公共选项、provider 特定选项、messages、tools 和 finish reason MUST 在该 contract 被提升为长期 baseline 之前遵循精化结论。

目标精化 SHALL 保持 `ModelCommonOptions`、adapter 自有的 `ModelProviderOptions` schema、`ModelMessage`、`ModelMessageContentPart`、`ModelToolDescriptor` 和 `ModelFinishReason` 为 provider 中立。provider adapter SHALL 在内部把这些 contract 映射到 AI SDK 的 message、tool 定义、provider option 和 finish reason。

`locale` 和 `thinking` SHALL 保持为稳定的 invocation 输入。TS 首版 OpenRouter 支撑的 adapter MAY 通过 request-context 关联保留 `locale`，并 MAY 延期 provider 特定的 `thinking` wire 映射，而不是发明不受支持的 provider 原生字段。

#### Scenario: 构建 provider 请求
- **WHEN** provider adapter 准备一个 provider 原生请求
- **THEN** 它 MUST 从 invocation 输入推导该请求，而不是重新解析配置来源

#### Scenario: Provider 中立的 tools 被映射到 AI SDK
- **WHEN** provider adapter 准备 AI SDK tool 定义
- **THEN** 它 MUST 在精化落地之后从 `ModelToolDescriptor` 语义推导它们
- **AND** public contract MUST NOT 暴露 AI SDK tool DTO

#### Scenario: Provider option 被映射到 AI SDK
- **WHEN** provider adapter 准备 AI SDK provider option
- **THEN** 它 MUST 从已校验的公共选项和 adapter 自有的 provider option schema / allowlist 条目推导它们
- **AND** public contract MUST NOT 暴露 AI SDK providerOptions DTO 或 provider 原生 option 对象

### Requirement: Provider SDK 保持为 agent-model 内部
OpenRouter 支撑的 provider adapter SHALL 使用 `@openrouter/ai-sdk-provider@2.9.0` 和 `ai@^6.0.195` 作为 `agent-model` 的内部实现细节。所选的 `ai@^6.0.195` 版本 SHALL 满足 OpenRouter provider package 的 peer dependency `ai@^6.0.0`，并且这些实现选择 SHALL NOT 改变 public model invocation contract。

#### Scenario: 执行 AI SDK invocation
- **WHEN** `agent-model` 通过 `@openrouter/ai-sdk-provider@2.9.0` 和 `ai@^6.0.195` 调用 OpenRouter 支撑的 provider
- **THEN** AI SDK / OpenRouter provider 的 model/client/options/part/error 类型 MUST 保持在 provider adapter 和 normalization 边界之内
- **AND** `ModelInvocationRequest`、`ModelStreamDelta`、`ModelFinalResult`、`agent-core`、`agent-runtime`、channel 层和 public contract MUST NOT 暴露或依赖 AI SDK 类型
- **AND** `credentialRef` 仍 MUST 在构造 SDK provider 之前，由 provider 边界内部的安全 credential resolver 解析

### Requirement: 原始 provider 结果保持在 agent-model 边界之内
provider 原始内容、原始 tool-call payload、原始响应体、原始 stream chunk 以及 AI SDK raw-part 抽象 SHALL 保持在 `agent-model` 边界之内。

如果 adapter 执行 provider 原生的非流式请求，其原始响应 MUST 被交给 invocation 结果 normalization 边界。流式的原始 chunk 或 AI SDK raw part MUST 被交给 stream normalization 边界。原始 provider 输出 MUST NOT 被直接暴露给 `agent-core`、`agent-runtime`、channel 层或用户可见输出。

#### Scenario: Provider 返回原始文本内容
- **WHEN** 某 provider 返回原始的 assistant 内容
- **THEN** 该原始内容 MUST 在任何上层消费之前先通过 `agent-model` normalization 边界

#### Scenario: Provider 返回 terminal metadata
- **WHEN** 某 provider 返回 terminal metadata，例如 response id、model id、usage 或 finish reason
- **THEN** provider adapter MUST 把它转换为标准的 `ModelFinalResult` 字段（包括 provider 中立的 `ModelFinishReason`），并且 MUST NOT 向上游暴露 provider 原生 metadata 对象

#### Scenario: Provider 流式输出原始 chunk
- **WHEN** 某 provider 发出原始流式 chunk，或 AI SDK 暴露等价的 raw part
- **THEN** provider adapter MUST 把它们交给 stream normalization 边界，而不是把它们作为 public stream payload 暴露

### Requirement: Provider adapter 把失败转发到 safe mapping
adapter 产生的 provider 原生失败 SHALL 被转发到 provider error safe mapping，而不是作为原始异常跨模块边界导出。

#### Scenario: Provider adapter 收到错误响应
- **WHEN** 某 provider adapter 收到 provider 原生失败
- **THEN** 该失败 MUST 进入标准的 provider/model safe mapping 路径

### Requirement: Provider adapter 不拥有 fallback 或路由
内部 provider adapter 能力 SHALL NOT 执行跨 profile fallback、业务路由或候选发现。

#### Scenario: 所选 provider 调用失败
- **WHEN** 所选 provider 失败
- **THEN** provider adapter MUST 把失败返回给 invocation 边界，AND 它 MUST NOT 自动选择另一个不同的 profile
