## MODIFIED Requirements

### Requirement: 目标态 request 字段是稳定的调用输入

`providerOptions` SHALL 是一个非空 `JsonObject`。当跨优先级层（profile、prompt template、capability patch、可信 request、hook）合并 `providerOptions` 时，合并 MUST 是顶层浅合并：后层中的键替换前层中的同名键，但仅存在于前层中的键 MUST 被保留。`providerOptions` 内的嵌套对象被整体替换（不做深合并）。

`modelParams` SHALL 是一个可选的 `JsonObject`，承载不透明的 recipe 级 model 参数。它 MUST NOT 被 workflow 或 contract 层解释；provider 把它的字段展开到 HTTP 请求体的顶层。合并时，来自 override 的 `modelParams` 替换来自 base 的 `modelParams`（不做合并）。

当 `thinking.depth` 为 `"OFF"` 时，openai-compatible provider MUST 通过 `transformRequestBody` 通道向 HTTP 请求体注入 `enable_thinking: false`，并且为兼容 vLLM gateway 还 MUST 注入 `chat_template_kwargs: { enable_thinking: false }`。当 `thinking.depth` 为 `"OFF"` 时 provider MUST NOT 发送 `reasoning_effort`。当 `thinking.depth` 为 `undefined` 时，provider MUST NOT 注入任何 reasoning 或 enable_thinking 配置。

#### Scenario: OFF depth 注入 enable_thinking false 和 chat_template_kwargs

- **GIVEN** 一个 model 调用请求带有 `thinking: { depth: "OFF" }`
- **WHEN** openai-compatible provider 准备该调用
- **THEN** HTTP 请求体 MUST 包含 `enable_thinking: false`
- **AND** HTTP 请求体 MUST 包含 `chat_template_kwargs: { enable_thinking: false }`
- **AND** HTTP 请求体 MUST NOT 包含 `reasoning_effort`

#### Scenario: Undefined depth 不注入 reasoning

- **GIVEN** 一个 model 调用请求不带有 `thinking`
- **WHEN** openai-compatible provider 准备该调用
- **THEN** HTTP 请求体 MUST NOT 包含 `reasoning_effort`
- **AND** HTTP 请求体 MUST NOT 包含 `enable_thinking`
- **AND** HTTP 请求体 MUST NOT 包含 `chat_template_kwargs`

#### Scenario: providerOptions 浅合并保留 base 键

- **GIVEN** base `providerOptions` 为 `{ key_a: "base" }`
- **AND** override `providerOptions` 为 `{ key_b: "override" }`
- **WHEN** 这些 options 被合并
- **THEN** 结果 MUST 为 `{ key_a: "base", key_b: "override" }`

#### Scenario: modelParams override 替换 base

- **GIVEN** base `ModelInferenceOptions` 带有 `modelParams: { temperature: 0.5 }`
- **AND** override `ModelInferenceOptions` 带有 `modelParams: { top_p: 0.9 }`
- **WHEN** 这些 options 被合并
- **THEN** 结果 `modelParams` MUST 为 `{ top_p: 0.9 }`

#### Scenario: modelParams 展开进请求体

- **GIVEN** 一个 model 调用请求带有 `modelParams: { temperature: 0.7, seed: 42 }`
- **WHEN** openai-compatible provider 准备该调用
- **THEN** HTTP 请求体 MUST 在顶层包含 `temperature: 0.7` 和 `seed: 42`
