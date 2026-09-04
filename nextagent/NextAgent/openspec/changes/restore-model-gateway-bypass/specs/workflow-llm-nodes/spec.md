## MODIFIED Requirements

### Requirement: Shared LLM Node Execution

Workflow engine MUST 在不调整 Recipe YAML DSL 的前提下，以统一方式执行 `llm-router`、`intent-recognition`、`question-rewriting`、`translation`、`data-analysis`、`param-extract`。

LLM node 的 `inputs.model_params` MUST 按以下方式由 `modelParamsInferenceOptions` 处理：

1. 剥离 `enable_thinking`（布尔值）并转换为 `thinking.depth`：
   - `true` -> `"HIGH"`
   - `false` -> `"OFF"`
   - 缺失或非布尔值 -> 不产生 `thinking` 配置
2. 把其余全部字段（包括 temperature、top_p、max_tokens 等）作为单个不透明的 `JsonObject` 放入 `modelParams`。当没有剩余字段时，MUST NOT 设置 `modelParams`。
3. 当 `model_params` 缺失或不是对象时，`modelParamsInferenceOptions` MUST 返回 `undefined`。

`mergeModelInferenceOptions` MUST 对 `providerOptions` 做浅合并：override 中的顶层 key 替换 base 中的同名 key，但仅存在于 base 中的 key MUST 被保留。override 的 `modelParams` 替换 base 的 `modelParams`（不做合并）。当 base 和 override 的某个字段均为 `undefined` 时，结果 MUST NOT 包含该字段。

#### Scenario: enable_thinking 为 true 产生 HIGH

- **GIVEN** 某节点的 `model_params` 包含 `enable_thinking: true`
- **WHEN** `modelParamsInferenceOptions` 处理这些输入
- **THEN** 返回的 `ModelInferenceOptions` MUST 包含 `thinking: { depth: "HIGH" }`

#### Scenario: enable_thinking 为 false 产生 OFF

- **GIVEN** 某节点的 `model_params` 包含 `enable_thinking: false`
- **WHEN** `modelParamsInferenceOptions` 处理这些输入
- **THEN** 返回的 `ModelInferenceOptions` MUST 包含 `thinking: { depth: "OFF" }`

#### Scenario: enable_thinking 缺失时不产生 thinking

- **GIVEN** 某节点的 `model_params` 不包含 `enable_thinking`
- **WHEN** `modelParamsInferenceOptions` 处理这些输入
- **THEN** 返回的 `ModelInferenceOptions` MUST NOT 包含 `thinking`

#### Scenario: 剩余字段作为 modelParams 透传

- **GIVEN** 某节点的 `model_params` 包含 `temperature: 0.7` 和 `custom_param: "value"`
- **WHEN** `modelParamsInferenceOptions` 处理这些输入
- **THEN** 返回的 `ModelInferenceOptions` MUST 包含带 `temperature: 0.7` 和 `custom_param: "value"` 的 `modelParams`
- **AND** `temperature` MUST NOT 作为 canonical `ModelInferenceOptions` 字段出现

#### Scenario: mergeModelInferenceOptions 浅合并 providerOptions

- **GIVEN** base `ModelInferenceOptions` 含 `providerOptions: { key_a: "base" }`
- **AND** override `ModelInferenceOptions` 含 `providerOptions: { key_b: "override" }`
- **WHEN** `mergeModelInferenceOptions` 合并二者
- **THEN** 结果的 `providerOptions` MUST 同时包含 `key_a: "base"` 和 `key_b: "override"`

#### Scenario: mergeModelInferenceOptions 的 modelParams override 替换 base

- **GIVEN** base `ModelInferenceOptions` 含 `modelParams: { temperature: 0.5 }`
- **AND** override `ModelInferenceOptions` 含 `modelParams: { top_p: 0.9 }`
- **WHEN** `mergeModelInferenceOptions` 合并二者
- **THEN** 结果的 `modelParams` MUST 为 `{ top_p: 0.9 }`

