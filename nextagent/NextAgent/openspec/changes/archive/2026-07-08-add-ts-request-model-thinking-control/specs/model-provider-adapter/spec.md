## MODIFIED Requirements

### Requirement: Provider adapter 消费经过检视的调用输入
被选择的 provider adapter SHALL 消费具有 provider 中立或 adapter 定义映射的调用请求字段，包括目标状态字段 `providerKind`、`modelName`、`baseUrl`、`credentialRef`、`messages`、`tools`、`commonOptions`、`providerOptions` 和 `timeoutMs`。该 adapter SHALL 把 `commonOptions` 内的允许列表值映射到 provider 访问，不重新引入平行的顶层选项字段。

这些基线字段 MUST 被视为 contract 检视输入。Provider identity、common option、provider 专属 option、message、tool 和 finish reason MUST 在该 contract 被提升为长期基线之前遵循细化结果。

目标细化 SHALL 保持 `ModelCommonOptions`、adapter 拥有的 `ModelProviderOptions` schema、`ModelMessage`、`ModelMessageContentPart`、`ModelToolDescriptor` 和 `ModelFinishReason` provider 中立。Provider adapter SHALL 在内部把这些 contract 映射为 AI SDK 的 message、tool 定义、provider option 和 finish reason。

`locale` 和 `thinking` SHALL 保持为稳定的调用输入。OpenRouter 支撑的 adapter MUST 在所选 provider 路径支持该控制时，把 request scope 的 `thinking.depth="OFF"` 保持为 provider 原生的推理禁用请求。一旦 `thinking.depth="OFF"` 进入 `ModelInvocationRequest.commonOptions`，adapter MUST NOT 忽略它。本变更不要求为 `LOW`、`MEDIUM`、`HIGH` 提供任何 provider 专属映射；在专门变更定义跨 provider 深度映射之前，这些深度 MAY 继续沿用既有行为。

#### Scenario: Provider 请求被构建
- **WHEN** provider adapter 准备一个 provider 原生请求
- **THEN** 它 MUST 从调用输入推导该请求，而不是重新解析配置来源

#### Scenario: Provider 中立的 tool 被映射到 AI SDK
- **WHEN** provider adapter 准备 AI SDK tool 定义
- **THEN** 细化落地后它 MUST 从 `ModelToolDescriptor` 语义推导
- **AND** 公共 contract MUST NOT 暴露 AI SDK tool DTO

#### Scenario: Provider option 被映射到 AI SDK
- **WHEN** provider adapter 准备 AI SDK provider option
- **THEN** 它 MUST 从已校验的 common option 和 adapter 拥有的 provider option schema / 允许列表条目推导
- **AND** 公共 contract MUST NOT 暴露 AI SDK providerOptions DTO 或 provider 原生 option 对象

#### Scenario: Thinking OFF 被映射为 provider 原生推理禁用
- **WHEN** `ModelInvocationRequest.commonOptions.thinking.depth` 为 `OFF`
- **THEN** OpenRouter 支撑的 adapter MUST 在出站请求上发出 provider 支持的推理禁用选项
- **AND** 出站请求 MUST NOT 要求 provider 为该调用产生推理输出
- **AND** adapter 代码 MUST NOT 要求调用方设置第二个 provider 专属推理字段才能让 `thinking.depth="OFF"` 生效
