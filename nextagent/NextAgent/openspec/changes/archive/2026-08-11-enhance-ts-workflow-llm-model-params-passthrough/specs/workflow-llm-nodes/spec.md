## MODIFIED Requirements

### Requirement: Shared LLM Node Execution

Workflow 引擎 MUST 以统一的方式执行 `llm-router`、`intent-recognition`、`question-rewriting`、`translation`、`data-analysis`、`param-extract`，而不调整 Recipe YAML DSL。

LLM 节点的 `inputs.model_params` MUST 由 `modelParamsInferenceOptions` 按如下方式处理：

1. 剥离 `enable_thinking`（boolean）并转换为 `thinking.depth`：
   - `true` -> `"HIGH"`
   - `false` -> `"OFF"`
   - 缺失或非 boolean -> 不产生 `thinking` 配置
2. 把其余所有字段（包括 temperature、top_p、max_tokens 等）放入 `modelParams`，作为一个单一的不透明 `JsonObject`。当不存在其余字段时，MUST NOT 设置 `modelParams`。
3. 当 `model_params` 缺失或不是 object 时，`modelParamsInferenceOptions` MUST 返回 `undefined`。

`mergeModelInferenceOptions` MUST 浅合并 `providerOptions`：override 中的顶层键替换 base 中的同名键，但仅存在于 base 中的键 MUST 被保留。来自 override 的 `modelParams` 替换来自 base 的 `modelParams`（不做合并）。当 base 和 override 的某个字段都为 `undefined` 时，结果 MUST NOT 包含该字段。

#### Scenario: enable_thinking 为 true 时产生 HIGH

- **GIVEN** 某节点的 `model_params` 包含 `enable_thinking: true`
- **WHEN** `modelParamsInferenceOptions` 处理这些 inputs
- **THEN** 返回的 `ModelInferenceOptions` MUST 包含 `thinking: { depth: "HIGH" }`

#### Scenario: enable_thinking 为 false 时产生 OFF

- **GIVEN** 某节点的 `model_params` 包含 `enable_thinking: false`
- **WHEN** `modelParamsInferenceOptions` 处理这些 inputs
- **THEN** 返回的 `ModelInferenceOptions` MUST 包含 `thinking: { depth: "OFF" }`

#### Scenario: enable_thinking 缺失时不产生 thinking

- **GIVEN** 某节点的 `model_params` 不包含 `enable_thinking`
- **WHEN** `modelParamsInferenceOptions` 处理这些 inputs
- **THEN** 返回的 `ModelInferenceOptions` MUST NOT 包含 `thinking`

#### Scenario: 其余字段作为 modelParams 透传

- **GIVEN** 某节点的 `model_params` 包含 `temperature: 0.7` 和 `custom_param: "value"`
- **WHEN** `modelParamsInferenceOptions` 处理这些 inputs
- **THEN** 返回的 `ModelInferenceOptions` MUST 包含带有 `temperature: 0.7` 和 `custom_param: "value"` 的 `modelParams`
- **AND** `temperature` MUST NOT 作为 canonical `ModelInferenceOptions` 字段出现

#### Scenario: mergeModelInferenceOptions 浅合并 providerOptions

- **GIVEN** base `ModelInferenceOptions` 带有 `providerOptions: { key_a: "base" }`
- **AND** override `ModelInferenceOptions` 带有 `providerOptions: { key_b: "override" }`
- **WHEN** `mergeModelInferenceOptions` 合并它们
- **THEN** 结果 `providerOptions` MUST 同时包含 `key_a: "base"` 和 `key_b: "override"`

#### Scenario: mergeModelInferenceOptions 的 modelParams override 替换 base

- **GIVEN** base `ModelInferenceOptions` 带有 `modelParams: { temperature: 0.5 }`
- **AND** override `ModelInferenceOptions` 带有 `modelParams: { top_p: 0.9 }`
- **WHEN** `mergeModelInferenceOptions` 合并它们
- **THEN** 结果 `modelParams` MUST 为 `{ top_p: 0.9 }`
